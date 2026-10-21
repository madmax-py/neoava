import { describe, expect, it, vi } from "vitest";
import {
  MemoryCache,
  MoodleClient,
  READ_ONLY_FUNCTIONS,
  WRITE_FUNCTIONS,
  checkMoodleResponse,
  flattenParams,
  isReadOnlyFunction,
  maskToken,
  type Transport,
} from "./client";

/** Transporte falso: registra as chamadas e responde com `reply`. */
function fakeTransport(reply: (fn: string, body: URLSearchParams) => unknown = () => ({ ok: true })) {
  const calls: { fn: string; body: string }[] = [];
  const t: Transport = {
    async call(fn, body) {
      calls.push({ fn, body: body.toString() });
      return reply(fn, body);
    },
    upload: vi.fn(async () => []),
    fileUrl: (u) => u,
    describe: () => "fake",
  };
  return { t, calls };
}

const client = (t: Transport, extra: Partial<ConstructorParameters<typeof MoodleClient>[0]> = {}) =>
  new MoodleClient({ baseUrl: "https://ava.example/", transport: t, ...extra });

describe("trava de somente leitura", () => {
  it("nenhuma função da lista de leitura tem cara de escrita", () => {
    for (const fn of READ_ONLY_FUNCTIONS) expect(isReadOnlyFunction(fn), fn).toBe(true);
  });

  it("nenhuma função de escrita passa como leitura", () => {
    for (const fn of WRITE_FUNCTIONS) expect(isReadOnlyFunction(fn), fn).toBe(false);
  });

  it("as listas não se sobrepõem", () => {
    for (const fn of WRITE_FUNCTIONS) expect(READ_ONLY_FUNCTIONS.has(fn), fn).toBe(false);
  });

  it("funções fora das listas são bloqueadas mesmo com allowWrite", async () => {
    const { t, calls } = fakeTransport();
    const c = client(t);
    for (const fn of ["core_user_update_users", "mod_forum_add_discussion", "core_course_view_course", "mod_assign_get_participant"]) {
      await expect(c.call(fn, {}, { allowWrite: true }), fn).rejects.toMatchObject({ errorcode: "blockedwrite" });
    }
    expect(calls).toHaveLength(0);
  });

  it("funções de escrita exigem allowWrite e nunca vão para o cache", async () => {
    const { t, calls } = fakeTransport();
    const cache = new MemoryCache();
    const c = client(t, { cache });
    await expect(c.call("mod_quiz_save_attempt", { attemptid: 1 })).rejects.toMatchObject({ errorcode: "blockedwrite" });
    await c.call("mod_quiz_save_attempt", { attemptid: 1 }, { allowWrite: true });
    await c.call("mod_quiz_save_attempt", { attemptid: 1 }, { allowWrite: true });
    expect(calls).toHaveLength(2);
    expect(cache.get("mod_quiz_save_attempt?attemptid=1")).toBeUndefined();
  });

  it("upload exige allowWrite", async () => {
    const { t } = fakeTransport();
    await expect(client(t).uploadDraft([{ name: "a.txt", blob: new Blob(["a"]) }], 0)).rejects.toMatchObject({ errorcode: "blockedwrite" });
    expect(t.upload).not.toHaveBeenCalled();
  });
});

describe("flattenParams", () => {
  it("achata no formato do Moodle", () => {
    const p = flattenParams({
      courseids: [1, 2],
      options: [{ name: "x", value: true }],
      data: { a: { b: "c" } },
      skip: undefined,
      nada: null,
      falso: false,
    });
    expect([...p.entries()]).toEqual([
      ["courseids[0]", "1"],
      ["courseids[1]", "2"],
      ["options[0][name]", "x"],
      ["options[0][value]", "1"],
      ["data[a][b]", "c"],
      ["falso", "0"],
    ]);
  });
});

describe("cache", () => {
  it("dentro da validade não chama o servidor de novo; refresh força", async () => {
    const { t, calls } = fakeTransport();
    const c = client(t, { cache: new MemoryCache() });
    await c.call("core_webservice_get_site_info");
    await c.call("core_webservice_get_site_info");
    expect(calls).toHaveLength(1);
    await c.call("core_webservice_get_site_info", {}, { refresh: true });
    expect(calls).toHaveLength(2);
  });

  it("noStore não lê nem grava", async () => {
    const { t, calls } = fakeTransport();
    const c = client(t, { cache: new MemoryCache() });
    await c.call("core_calendar_get_calendar_export_token", {}, { noStore: true });
    await c.call("core_calendar_get_calendar_export_token", {}, { noStore: true });
    expect(calls).toHaveLength(2);
  });

  it("chamadas iguais em andamento são reaproveitadas", async () => {
    const { t, calls } = fakeTransport();
    const c = client(t, { cache: new MemoryCache() });
    await Promise.all([c.call("core_webservice_get_site_info"), c.call("core_webservice_get_site_info")]);
    expect(calls).toHaveLength(1);
  });

  it("vencido: devolve o antigo na hora, atualiza por trás e avisa se mudou", async () => {
    let n = 0;
    const { t, calls } = fakeTransport(() => ({ n: ++n }));
    const cache = new MemoryCache();
    cache.set("core_webservice_get_site_info?", { n: 0 }, -1); // já vencido
    const onUpdate = vi.fn();
    const c = client(t, { cache, staleWhileRevalidate: true, onUpdate });
    expect(await c.call("core_webservice_get_site_info")).toEqual({ n: 0 });
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith("core_webservice_get_site_info"));
    expect(calls).toHaveLength(1);
    expect(await c.call("core_webservice_get_site_info")).toEqual({ n: 1 });
  });

  it("a chave do cache não leva o token", async () => {
    const cache = new MemoryCache();
    const set = vi.spyOn(cache, "set");
    const c = new MoodleClient({ baseUrl: "https://ava.example", token: "segredo123456", cache });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: 1 })));
    try {
      await c.call("core_webservice_get_site_info");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(set.mock.calls[0][0]).not.toContain("segredo");
  });
});

describe("limite de requisições simultâneas", () => {
  it("no máximo 2 ao mesmo tempo", async () => {
    let active = 0;
    let peak = 0;
    const { t } = fakeTransport(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return {};
    });
    const c = client(t);
    await Promise.all([1, 2, 3, 4, 5].map((i) => c.call("core_course_get_contents", { courseid: i })));
    expect(peak).toBe(2);
  });
});

describe("erros", () => {
  it("o Moodle responde 200 com exceção no corpo", () => {
    expect(() => checkMoodleResponse({ exception: "x", errorcode: "invalidtoken", message: "Token inválido" }, "f")).toThrow("Token inválido");
    expect(checkMoodleResponse([{ exception: 1 }], "f")).toEqual([{ exception: 1 }]);
  });

  it("maskToken", () => {
    expect(maskToken("abcdefghijkl")).toBe("abcd…ijkl");
    expect(maskToken("curto")).toBe("••••");
  });
});
