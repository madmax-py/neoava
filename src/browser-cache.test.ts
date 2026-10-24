import { beforeEach, describe, expect, it } from "vitest";
import { BrowserCache, loadToken, saveToken, tokenIsRemembered } from "./browser-cache";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("token", () => {
  it("lembrado fica no localStorage", () => {
    saveToken("abc");
    expect(localStorage.getItem("ava-token")).toBe("abc");
    expect(sessionStorage.getItem("ava-token")).toBeNull();
    expect(loadToken()).toBe("abc");
    expect(tokenIsRemembered()).toBe(true);
  });

  it("sem lembrar fica só na aba e apaga o lembrado", () => {
    saveToken("velho");
    saveToken("novo", false);
    expect(localStorage.getItem("ava-token")).toBeNull();
    expect(loadToken()).toBe("novo");
    expect(tokenIsRemembered()).toBe(false);
  });

  it("sair apaga dos dois lugares", () => {
    saveToken("a", false);
    localStorage.setItem("ava-token", "b");
    saveToken(null);
    expect(loadToken()).toBe("");
  });
});

describe("BrowserCache", () => {
  it("grava no sessionStorage quando não é para lembrar", () => {
    const c = new BrowserCache("t:", false);
    c.set("k", { nota: 10 }, 60);
    expect(sessionStorage.getItem("t:k")).toContain("nota");
    expect(localStorage.getItem("t:k")).toBeNull();
  });

  it("clear apaga as duas áreas, só com o prefixo dele", () => {
    localStorage.setItem("t:a", "{}");
    sessionStorage.setItem("t:b", "{}");
    localStorage.setItem("ava-theme", "dark");
    new BrowserCache("t:").clear();
    expect(localStorage.getItem("t:a")).toBeNull();
    expect(sessionStorage.getItem("t:b")).toBeNull();
    expect(localStorage.getItem("ava-theme")).toBe("dark");
  });

  it("vencido continua disponível; velho demais some", () => {
    const c = new BrowserCache("t:");
    localStorage.setItem("t:v", JSON.stringify({ v: 1, exp: Date.now() - 1000 }));
    localStorage.setItem("t:x", JSON.stringify({ v: 2, exp: Date.now() - 8 * 86400 * 1000 }));
    expect(c.get("v")?.v).toBe(1);
    expect(c.get("x")).toBeUndefined();
    expect(localStorage.getItem("t:x")).toBeNull();
  });

  it("expireAll vence tudo sem apagar (na memória e no storage)", () => {
    const c = new BrowserCache("t:");
    c.set("a", 1, 3600);
    localStorage.setItem("t:b", JSON.stringify({ v: 2, exp: Date.now() + 3600_000 }));
    c.expireAll();
    expect(c.get("a")!.exp).toBeLessThanOrEqual(Date.now());
    expect(c.get("a")!.v).toBe(1);
    expect(new BrowserCache("t:").get("b")).toMatchObject({ v: 2 });
    expect(new BrowserCache("t:").get("b")!.exp).toBeLessThanOrEqual(Date.now());
  });
});
