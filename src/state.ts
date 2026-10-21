// Estado compartilhado da aplicação (cliente, usuário atual, navegação).

import { MoodleClient, MoodleError } from "./moodle/client";
import { createApi, type Api, type SiteInfo } from "./moodle/api";
import { LocalStorageCache } from "./browser-cache";

export const demo = import.meta.env.DEV && new URLSearchParams(location.search).has("demo");
export const cache = new LocalStorageCache(demo ? "ava-demo:" : undefined);

export const state = {
  client: null as MoodleClient | null,
  api: null as Api | null,
  site: null as SiteInfo | null,
  available: new Set<string>(),
  /** "Atualizar" foi clicado: a próxima rodada ignora o cache. */
  forceRefresh: false,
  /** Incrementa a cada navegação; resultados assíncronos de telas antigas são descartados. */
  routeId: 0,
  /**
   * A tela atual tem edição em andamento (responder questionário, editar envio): dados novos que
   * chegarem em segundo plano não redesenham a tela. Volta a false a cada navegação.
   */
  hold: false,
  /** Preenchido pelo main.ts (evita import circular). `silent`: redesenha sem carregamento nem rolagem. */
  route: async (_opts?: { silent?: boolean }) => {},
};

export function setup(token: string) {
  state.client = new MoodleClient({ baseUrl: __MOODLE_URL__, token, cache, staleWhileRevalidate: true, onUpdate: scheduleSilentRefresh });
  state.api = createApi(state.client);
}

let pending: ReturnType<typeof setTimeout> | undefined;
/**
 * Chegou versão nova de algum dado que já estava na tela (o cache mostrou a versão vencida):
 * redesenha a página atual sem carregamento, mantendo a rolagem. Várias atualizações seguidas
 * viram um redesenho só. Nunca interrompe edição, diálogo aberto ou campo com foco.
 */
function scheduleSilentRefresh() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    const busy =
      state.hold ||
      !!document.querySelector("dialog[open]") ||
      !!document.activeElement?.closest("main input, main textarea, main select");
    if (busy) return; // o dado novo já está no cache: aparece na próxima navegação
    void state.route({ silent: true });
  }, 400);
}

/** Atalhos para quem já sabe que está logado. */
export const api = () => state.api!;
export const site = () => state.site!;
export const opts = () => ({ refresh: state.forceRefresh });

export const DAY = 86400;
export const nowS = () => Date.now() / 1000;

/**
 * Executa a chamada só se o token tiver acesso à função; senão devolve o fallback.
 * Falta de permissão numa função esvazia só aquela seção, sem derrubar a página.
 */
export function ifAvailable<T>(fn: string, p: () => Promise<T>, fallback: T): Promise<T> {
  if (!state.available.has(fn)) return Promise.resolve(fallback);
  return p().catch((e) => {
    if (e instanceof MoodleError && e.errorcode === "nopermissions") {
      console.warn(`Sem permissão em ${fn}: ${e.message}`);
      return fallback;
    }
    throw e;
  });
}
