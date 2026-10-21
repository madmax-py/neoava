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
import { attemptPage, quizPage } from "./views/quiz";
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
  const skeleton = silent ? undefined : setTimeout(() => id === state.routeId && (loading(), window.scrollTo(0, 0)), 150);
  try {
    if (!state.site || state.forceRefresh) {
      state.site = await state.api!.siteInfo({ refresh: state.forceRefresh });
      state.available = new Set(state.site.functions.map((f) => f.name));
    }
    const hash = location.hash;
    const qz = hash.match(/^#\/disciplina\/(\d+)\/questionario\/(\d+)(?:\/tentativa\/(\d+)(?:\/pagina\/(\d+)|\/(resumo))?)?/);
    const m = hash.match(/^#\/disciplina\/(\d+)/);
    const tf = hash.match(/^#\/disciplina\/(\d+)\/tarefa\/(\d+)/);
    if (qz?.[3]) await attemptPage(Number(qz[1]), Number(qz[2]), Number(qz[3]), qz[4] ? Number(qz[4]) - 1 : null, id, qz[5] ? "resumo" : undefined);
    else if (qz) await quizPage(Number(qz[1]), Number(qz[2]), id);
    else if (tf) await assignPage(Number(tf[1]), Number(tf[2]), id);
    else if (m) await courseView(Number(m[1]), id);
    else if (hash.startsWith("#/disciplinas")) await coursesPage(id);
    else if (hash.startsWith("#/prazos")) await deadlinesPage(id);
    else if (hash.startsWith("#/historico")) await historyPage(id);
    else if (hash.startsWith("#/biblioteca")) await libraryPage(Number(hash.split("/")[2]) || null, id);
    else if (hash.startsWith("#/perfil")) await profilePage(id);
    else await dashboard(id);
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
if (import.meta.env.DEV && token) console.info(`Token em uso: ${maskToken(token)}`);
route();
