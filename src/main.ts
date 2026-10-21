// fontes locais (o CSP só aceita font-src 'self'); só o subconjunto latino
import "@fontsource/tektur/latin-600.css";
import "@fontsource/tektur/latin-800.css";
import "@fontsource/tektur/latin-900.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./style.css";
import { maskToken } from "./moodle/client";
import { loadToken } from "./browser-cache";
import { demo, setup, state } from "./state";
import { errorView, loading } from "./layout";
import { hideTooltip, installTooltip } from "./ui";
import { showTokenScreen } from "./views/login";
import { dashboard } from "./views/dashboard";
import { coursesPage } from "./views/courses";
import { courseView } from "./views/course";
import { quizPage } from "./views/quiz";
import { attemptPage } from "./views/quiz-attempt";
import { assignPage } from "./views/assign";
import { deadlinesPage } from "./views/deadlines";
import { historyPage } from "./views/history";
import { profilePage } from "./views/profile";
import { libraryPage } from "./views/library";

// Import dinâmico: os dados fictícios ficam num arquivo à parte, baixado só ao abrir a demonstração.
if (demo) (await import("./demo")).installDemo();
installTooltip();

/**
 * Rolagem por entrada do histórico, para o botão Voltar/Avançar levar ao mesmo ponto.
 * Cada entrada ganha um id em history.state na primeira vez que é aberta: entrada sem id é navegação
 * nova (vai para o topo); entrada com id é volta/avanço (restaura a rolagem). Não dá para usar o
 * popstate para isso: mudar o # do endereço também dispara popstate.
 */
const scrollByEntry = new Map<string, number>();
let currentEntry: string | null = null;
function historyEntry(): { id: string; traversal: boolean } {
  const st = history.state as { navId?: string } | null;
  if (st?.navId) return { id: st.navId, traversal: true };
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  history.replaceState({ ...(st ?? {}), navId: id }, "");
  return { id, traversal: false };
}

type Screen = (m: RegExpMatchArray, routeId: number) => Promise<unknown>;

/** Telas por endereço: a primeira que casar abre (as mais específicas vêm antes). Sem nenhuma, o painel. */
const routes: [RegExp, Screen][] = [
  [
    /^#\/disciplina\/(\d+)\/questionario\/(\d+)\/tentativa\/(\d+)(?:\/pagina\/(\d+)|\/(resumo))?/,
    (m, id) => attemptPage(+m[1], +m[2], +m[3], m[4] ? +m[4] - 1 : null, id, m[5] ? "resumo" : undefined),
  ],
  [/^#\/disciplina\/(\d+)\/questionario\/(\d+)/, (m, id) => quizPage(+m[1], +m[2], id)],
  [/^#\/disciplina\/(\d+)\/tarefa\/(\d+)/, (m, id) => assignPage(+m[1], +m[2], id)],
  [/^#\/disciplina\/(\d+)/, (m, id) => courseView(+m[1], id)],
  [/^#\/disciplinas/, (_, id) => coursesPage(id)],
  [/^#\/prazos/, (_, id) => deadlinesPage(id)],
  [/^#\/historico/, (_, id) => historyPage(id)],
  [/^#\/biblioteca(?:\/(\d+))?/, (m, id) => libraryPage(Number(m[1]) || null, id)],
  [/^#\/perfil/, (_, id) => profilePage(id)],
];

async function route(opts: { silent?: boolean } = {}) {
  if (!state.client) return showTokenScreen();
  const id = ++state.routeId;
  const silent = !!opts.silent;
  state.hold = false;
  hideTooltip();
  let keepY = window.scrollY;
  if (!silent) {
    if (currentEntry) scrollByEntry.set(currentEntry, window.scrollY);
    const e = historyEntry();
    currentEntry = e.id;
    keepY = e.traversal ? (scrollByEntry.get(e.id) ?? 0) : 0;
  }
  // Com dados no cache a tela fica pronta quase na hora: o carregamento só aparece se demorar.
  const skeleton = silent
    ? undefined
    : setTimeout(
        () => id === state.routeId && (loading(), window.scrollTo(0, 0)),
        150,
      );
  try {
    if (!state.site || state.forceRefresh) {
      state.site = await state.api!.siteInfo({ refresh: state.forceRefresh });
      state.available = new Set(state.site.functions.map((f) => f.name));
    }
    const hash = location.hash;
    const hit = routes.find(([re]) => re.test(hash));
    await (hit ? hit[1](hash.match(hit[0])!, id) : dashboard(id));
    if (id === state.routeId) window.scrollTo(0, keepY);
  } catch (e) {
    if (id === state.routeId && !silent) errorView(e);
  } finally {
    clearTimeout(skeleton);
    if (id === state.routeId) state.forceRefresh = false;
  }
}

state.route = route;
window.addEventListener("hashchange", () => route());

const token = demo ? "demo-token" : loadToken();
if (token) setup(token);
if (import.meta.env.DEV && token)
  console.info(`Token em uso: ${maskToken(token)}`);
route();

// Instalar no celular/computador e abrir sem rede (só em produção: no dev atrapalharia o recarregamento).
if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
