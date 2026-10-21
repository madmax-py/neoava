// Cliente mínimo e isomórfico (Node 18+ e navegador) para os Web Services REST do Moodle.
// Somente leitura por padrão: só chama funções da READ_ONLY_FUNCTIONS. As poucas de WRITE_FUNCTIONS
// (fazer questionário) exigem `allowWrite`; qualquer outra escrita é sempre bloqueada.

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
  "mod_quiz_get_attempt_summary",
  "mod_quiz_get_attempt_review",
]);

/**
 * Únicas funções que gravam no AVA, e só com `allowWrite` (a tela pede confirmação nos passos sem volta).
 * São as que o app oficial usa para fazer questionário e enviar tarefa.
 */
export const WRITE_FUNCTIONS = new Set([
  // Questionário: iniciar, salvar, mudar de página e enviar.
  "mod_quiz_start_attempt",
  "mod_quiz_save_attempt",
  "mod_quiz_process_attempt",
  "mod_quiz_view_attempt",
  // Tarefa: área de rascunho para o texto, iniciar (tarefa com tempo), salvar, enviar para avaliação, remover.
  "core_files_get_unused_draft_itemid",
  "mod_assign_start_submission",
  "mod_assign_save_submission",
  "mod_assign_submit_for_grading",
  "mod_assign_remove_submission",
]);

/** Arquivo gravado na área de rascunho do usuário (resposta do upload.php). */
export interface DraftFile {
  itemid: number;
  filename: string;
  filearea: string;
  filesize?: number;
}

/** Arquivo para enviar: um File do navegador ou um Blob com nome. */
export interface UploadFile {
  name: string;
  blob: Blob;
}

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

/** Valor guardado e quando ele vence (ms). Pode ser devolvido já vencido: o cliente decide o que fazer. */
export interface CacheEntry {
  v: unknown;
  exp: number;
}

export interface Cache {
  get(key: string): CacheEntry | undefined;
  set(key: string, value: unknown, ttlSeconds: number): void;
  clear?(): void;
}

/**
 * Como a chamada chega ao Moodle. Padrão: direto no REST do AVA com o token
 * (no terminal, o token vem do .env; no navegador, do localStorage).
 */
export interface Transport {
  call(wsfunction: string, body: URLSearchParams): Promise<unknown>;
  /** Grava arquivos na área de rascunho do usuário (webservice/upload.php). itemid 0 = área nova. */
  upload(files: UploadFile[], itemid: number): Promise<DraftFile[]>;
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
  /**
   * Dado vencido no cache é devolvido na hora e a versão nova é buscada em segundo plano
   * (default false). Quando a versão nova chega diferente, chama `onUpdate`.
   */
  staleWhileRevalidate?: boolean;
  onUpdate?: (wsfunction: string) => void;
}

export interface CallOptions {
  ttlSeconds?: number;
  /** Ignora o cache e busca de novo (o resultado novo é gravado no cache). */
  refresh?: boolean;
  /** Necessário para as funções de WRITE_FUNCTIONS (as demais continuam bloqueadas). */
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
  #swr: boolean;
  onUpdate?: (wsfunction: string) => void;
  /** Avisa quando uma chamada à rede começa e termina (usado na barra de progresso do login). */
  onNetwork?: (phase: "start" | "end") => void;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    if (opts.transport) this.#transport = opts.transport;
    else if (opts.token) this.#transport = directTransport(this.baseUrl, opts.token);
    else throw new MoodleError("Token não configurado.", "invalidtoken", "-");
    this.#cache = opts.cache;
    this.#ttl = opts.ttlSeconds ?? 15 * 60;
    this.#max = opts.maxConcurrent ?? 2;
    this.#swr = opts.staleWhileRevalidate ?? false;
    this.onUpdate = opts.onUpdate;
  }

  get maskedToken() {
    return this.#transport.describe();
  }

  toString() {
    return `MoodleClient(${this.baseUrl}, ${this.maskedToken})`;
  }

  async call<T = unknown>(wsfunction: string, params: Params = {}, opts: CallOptions = {}): Promise<T> {
    const isReadOnly = isReadOnlyFunction(wsfunction);
    if (!isReadOnly && !(opts.allowWrite && WRITE_FUNCTIONS.has(wsfunction))) {
      throw new MoodleError(`Função bloqueada (somente leitura): ${wsfunction}`, "blockedwrite", wsfunction);
    }

    const body = flattenParams(params);
    // Chave de cache sem o token.
    const key = `${wsfunction}?${body.toString()}`;
    const useCache = isReadOnly && !opts.noStore;
    const ttl = opts.ttlSeconds ?? this.#ttl;
    if (useCache && !opts.refresh) {
      const hit = this.#cache?.get(key);
      if (hit && Date.now() < hit.exp) return hit.v as T;
      if (hit && this.#swr) {
        // Vencido: mostra o que tem e atualiza por trás.
        if (!this.#inflight.has(key)) {
          this.#fetch<T>(wsfunction, body, key, true, ttl)
            .then((fresh) => {
              if (JSON.stringify(fresh) !== JSON.stringify(hit.v)) this.onUpdate?.(wsfunction);
            })
            .catch(() => {}); // sem rede/erro: segue com o que tem; a próxima chamada tenta de novo
        }
        return hit.v as T;
      }
      const pending = this.#inflight.get(key);
      if (pending) return pending as Promise<T>;
    }
    return this.#fetch<T>(wsfunction, body, key, useCache, ttl);
  }

  async #fetch<T>(wsfunction: string, body: URLSearchParams, key: string, store: boolean, ttl: number): Promise<T> {
    this.onNetwork?.("start");
    const p = this.#limited(() => this.#request<T>(wsfunction, body))
      .then((data) => {
        if (store) this.#cache?.set(key, data, ttl);
        return data;
      })
      .finally(() => this.onNetwork?.("end"));
    this.#inflight.set(key, p);
    try {
      return await p;
    } finally {
      if (this.#inflight.get(key) === p) this.#inflight.delete(key);
    }
  }

  /**
   * Envia arquivos para a área de rascunho (o primeiro passo de qualquer envio de arquivo no Moodle).
   * Sozinho não entrega nada: o arquivo só vai para a atividade quando um save_* usa este itemid.
   * Exige allowWrite, como as funções de escrita.
   */
  async uploadDraft(files: UploadFile[], itemid: number, opts: { allowWrite?: boolean } = {}): Promise<DraftFile[]> {
    if (!opts.allowWrite) throw new MoodleError("Envio de arquivo bloqueado (somente leitura).", "blockedwrite", "upload");
    if (!files.length) return [];
    return this.#limited(() => this.#transport.upload(files, itemid));
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
    async upload(files, itemid) {
      const form = new FormData();
      form.set("token", token);
      form.set("filearea", "draft");
      form.set("itemid", String(itemid));
      files.forEach((f, i) => form.append(`file_${i + 1}`, f.blob, f.name));
      let res: Response;
      try {
        res = await fetch(`${base}/webservice/upload.php`, { method: "POST", body: form });
      } catch (e) {
        throw new MoodleError(`Falha de rede no envio do arquivo: ${(e as Error).message}`, "network", "upload");
      }
      if (!res.ok) throw new MoodleError(`HTTP ${res.status} no envio do arquivo`, `http${res.status}`, "upload");
      const data = (await res.json()) as DraftFile[] | { error?: string; errorcode?: string };
      if (!Array.isArray(data)) throw new MoodleError(data.error ?? "Falha no envio do arquivo.", data.errorcode ?? "unknown", "upload");
      return data;
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
  #m = new Map<string, CacheEntry>();
  get(key: string) {
    return this.#m.get(key);
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
