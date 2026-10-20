// Cliente mínimo e isomórfico (Node 18+ e navegador) para os Web Services REST do Moodle.
// Somente leitura: só chama funções da READ_ONLY_FUNCTIONS, a menos que allowWrite seja passado.

export type Params = Record<string, unknown>;

/** Funções de consulta liberadas por padrão. Nada aqui grava ou registra ação no AVA. */
export const READ_ONLY_FUNCTIONS = new Set([
  "core_webservice_get_site_info",
  "core_enrol_get_users_courses",
  "gradereport_overview_get_course_grades",
  "gradereport_user_get_grade_items",
  "gradereport_user_get_grades_table",
  "mod_assign_get_assignments",
  "mod_assign_get_submission_status",
  "core_calendar_get_action_events_by_timesort",
  "core_course_get_contents",
  "mod_quiz_get_quizzes_by_courses",
  "mod_quiz_get_user_quiz_attempts",
  "mod_quiz_get_user_best_grade",
  "core_completion_get_activities_completion_status",
  "core_completion_get_course_completion_status",
  "core_calendar_get_calendar_export_token",
  "core_user_get_users_by_field",
  "core_calendar_get_calendar_events",
  "core_badges_get_user_badges",
  // Questionários (só leitura): regras de acesso, tipos de questão, questões de uma tentativa e revisão.
  // Nenhuma delas inicia, salva ou envia tentativa (isso seria start_/save_/process_attempt).
  "mod_quiz_get_quiz_access_information",
  "mod_quiz_get_attempt_access_information",
  "mod_quiz_get_quiz_required_qtypes",
  "mod_quiz_get_attempt_data",
  "mod_quiz_get_attempt_review",
]);

/** Padrões que indicam escrita/registro de ação. Bloqueados mesmo que alguém os adicione à lista acima. */
const WRITE_PATTERN = /(_view_|_view$|save_|submit_|add_|_update_|_delete_|_create_|_set_|mark_|_start_|_process_)/;

/** Única regra de "somente leitura" do projeto. */
export function isReadOnlyFunction(wsfunction: string): boolean {
  return READ_ONLY_FUNCTIONS.has(wsfunction) && !WRITE_PATTERN.test(wsfunction);
}

export class MoodleError extends Error {
  constructor(
    message: string,
    readonly errorcode: string,
    readonly wsfunction: string,
  ) {
    super(message);
    this.name = "MoodleError";
  }

  /** Token revogado/expirado ou função não liberada para este token. */
  get needsNewToken(): boolean {
    return this.errorcode === "invalidtoken" || this.errorcode === "accessexception";
  }
}

export interface Cache {
  get(key: string): unknown | undefined;
  set(key: string, value: unknown, ttlSeconds: number): void;
  clear?(): void;
}

/**
 * Como a chamada chega ao Moodle. Padrão: direto no REST do AVA com o token
 * (no terminal, o token vem do .env; no navegador, do localStorage).
 */
export interface Transport {
  call(wsfunction: string, body: URLSearchParams): Promise<unknown>;
  fileUrl(url: string): string;
  /** Para exibição (ex.: token mascarado). */
  describe(): string;
}

export interface ClientOptions {
  baseUrl: string;
  /** Token do Web Services (obrigatório se não houver `transport`). */
  token?: string;
  transport?: Transport;
  cache?: Cache;
  /** TTL padrão do cache em segundos (default 15 min). */
  ttlSeconds?: number;
  /** Máximo de requisições simultâneas ao servidor (default 2). */
  maxConcurrent?: number;
}

export interface CallOptions {
  ttlSeconds?: number;
  /** Ignora o cache e busca de novo (o resultado novo é gravado no cache). */
  refresh?: boolean;
  /** Necessário para qualquer função fora da lista de leitura. A UI deve pedir confirmação antes. */
  allowWrite?: boolean;
  /** Não lê nem grava no cache (para respostas que são credenciais). */
  noStore?: boolean;
}

/** Achata objetos/arrays no formato do Moodle: courseids[0]=1, options[0][name]=x. */
export function flattenParams(params: Params, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v !== null && typeof v === "object") flattenParams(v as Params, `${name}[${i}]`, out);
        else out.append(`${name}[${i}]`, String(v));
      });
    } else if (typeof value === "object") {
      flattenParams(value as Params, name, out);
    } else if (typeof value === "boolean") {
      out.append(name, value ? "1" : "0");
    } else {
      out.append(name, String(value));
    }
  }
  return out;
}

/** Mascara o token para exibição: abcd…wxyz. */
export function maskToken(token: string): string {
  return token.length <= 8 ? "••••" : `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export class MoodleClient {
  readonly baseUrl: string;
  #transport: Transport;
  #cache?: Cache;
  #ttl: number;
  #max: number;
  #active = 0;
  #queue: (() => void)[] = [];
  #inflight = new Map<string, Promise<unknown>>();

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    if (opts.transport) this.#transport = opts.transport;
    else if (opts.token) this.#transport = directTransport(this.baseUrl, opts.token);
    else throw new MoodleError("Token não configurado.", "invalidtoken", "-");
    this.#cache = opts.cache;
    this.#ttl = opts.ttlSeconds ?? 15 * 60;
    this.#max = opts.maxConcurrent ?? 2;
  }

  get maskedToken() {
    return this.#transport.describe();
  }

  toString() {
    return `MoodleClient(${this.baseUrl}, ${this.maskedToken})`;
  }

  async call<T = unknown>(wsfunction: string, params: Params = {}, opts: CallOptions = {}): Promise<T> {
    const isReadOnly = isReadOnlyFunction(wsfunction);
    if (!isReadOnly && !opts.allowWrite) {
      throw new MoodleError(`Função bloqueada (somente leitura): ${wsfunction}`, "blockedwrite", wsfunction);
    }

    const body = flattenParams(params);
    // Chave de cache sem o token.
    const key = `${wsfunction}?${body.toString()}`;
    const useCache = isReadOnly && !opts.noStore;
    if (useCache && !opts.refresh) {
      const hit = this.#cache?.get(key);
      if (hit !== undefined) return hit as T;
      const pending = this.#inflight.get(key);
      if (pending) return pending as Promise<T>;
    }

    const p = this.#limited(() => this.#request<T>(wsfunction, body)).then((data) => {
      if (useCache) this.#cache?.set(key, data, opts.ttlSeconds ?? this.#ttl);
      return data;
    });
    this.#inflight.set(key, p);
    try {
      return await p;
    } finally {
      this.#inflight.delete(key);
    }
  }

  /** URL para abrir um arquivo devolvido pela API (pluginfile.php). */
  fileUrl(url: string): string {
    return this.#transport.fileUrl(url);
  }

  async #request<T>(wsfunction: string, params: URLSearchParams): Promise<T> {
    return (await this.#transport.call(wsfunction, params)) as T;
  }

  async #limited<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#max) await new Promise<void>((r) => this.#queue.push(r));
    this.#active++;
    try {
      return await fn();
    } finally {
      this.#active--;
      this.#queue.shift()?.();
    }
  }
}

/** O Moodle responde HTTP 200 mesmo em erro; o erro vem no corpo. */
export function checkMoodleResponse(data: unknown, wsfunction: string): unknown {
  if (data && typeof data === "object" && !Array.isArray(data) && "exception" in data) {
    const d = data as { errorcode?: string; message?: string };
    throw new MoodleError(d.message ?? "Erro desconhecido", d.errorcode ?? "unknown", wsfunction);
  }
  return data;
}

/** Transporte direto para o REST do AVA (terminal e navegador). */
export function directTransport(baseUrl: string, token: string): Transport {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    describe: () => `token=${maskToken(token)}`,
    fileUrl(url) {
      const u = new URL(url, base);
      // O token só vai para arquivos do próprio AVA; links externos ficam como estão.
      if (u.origin !== new URL(base).origin) return u.toString();
      u.searchParams.set("token", token);
      return u.toString();
    },
    async call(wsfunction, params) {
      const body = new URLSearchParams(params);
      body.set("wstoken", token);
      body.set("moodlewsrestformat", "json");
      body.set("wsfunction", wsfunction);
      let res: Response;
      try {
        res = await fetch(`${base}/webservice/rest/server.php`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
      } catch (e) {
        throw new MoodleError(`Falha de rede ao chamar ${wsfunction}: ${(e as Error).message}`, "network", wsfunction);
      }
      if (!res.ok) throw new MoodleError(`HTTP ${res.status} em ${wsfunction}`, `http${res.status}`, wsfunction);
      return checkMoodleResponse(await res.json(), wsfunction);
    },
  };
}

/** Cache em memória (útil em testes e como base). */
export class MemoryCache implements Cache {
  #m = new Map<string, { v: unknown; exp: number }>();
  get(key: string) {
    const e = this.#m.get(key);
    if (!e) return undefined;
    if (Date.now() > e.exp) return void this.#m.delete(key);
    return e.v;
  }
  set(key: string, v: unknown, ttl: number) {
    this.#m.set(key, { v, exp: Date.now() + ttl * 1000 });
  }
  clear() {
    this.#m.clear();
  }
}

/**
 * Troca usuário/senha por um token no /login/token.php (mesmo fluxo do app oficial).
 * A senha só é enviada ao AVA nesta requisição; nada aqui guarda ou loga a senha.
 * Devolve apenas o `token` — o `privatetoken` é descartado.
 */
export async function requestToken(baseUrl: string, username: string, password: string): Promise<string> {
  const body = new URLSearchParams({ username, password, service: "moodle_mobile_app" });
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, "")}/login/token.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (e) {
    throw new MoodleError(`Falha de rede no login: ${(e as Error).message}`, "network", "login");
  }
  if (!res.ok) throw new MoodleError(`HTTP ${res.status} no login`, `http${res.status}`, "login");
  const data = (await res.json()) as { token?: string; error?: string; errorcode?: string };
  if (!data.token) {
    const code = data.errorcode ?? "unknown";
    const msg = code === "invalidlogin" ? "Usuário ou senha inválidos." : (data.error ?? "Falha no login.");
    throw new MoodleError(msg, code, "login");
  }
  return data.token;
}
