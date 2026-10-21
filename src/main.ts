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
import { deadlinesPage } from "./views/deadlines";
import { historyPage } from "./views/history";
import { profilePage } from "./views/profile";
import { libraryPage } from "./views/library";

// import.meta.env.DEV direto aqui para o build de produção não incluir o demo.
if (import.meta.env.DEV && demo) (await import("./demo")).installDemo();
installTooltip();

async function route() {
  if (!state.client) return showTokenScreen();
  const id = ++state.routeId;
  hideTooltip();
  loading();
  window.scrollTo(0, 0);
  try {
    if (!state.site || state.forceRefresh) {
      state.site = await state.api!.siteInfo({ refresh: state.forceRefresh });
      state.available = new Set(state.site.functions.map((f) => f.name));
    }
    const hash = location.hash;
    const m = hash.match(/^#\/disciplina\/(\d+)/);
    if (m) await courseView(Number(m[1]), id);
    else if (hash.startsWith("#/disciplinas")) await coursesPage(id);
    else if (hash.startsWith("#/prazos")) await deadlinesPage(id);
    else if (hash.startsWith("#/historico")) await historyPage(id);
    else if (hash.startsWith("#/biblioteca")) await libraryPage(Number(hash.split("/")[2]) || null, id);
    else if (hash.startsWith("#/perfil")) await profilePage(id);
    else await dashboard(id);
  } catch (e) {
    if (id === state.routeId) errorView(e);
  } finally {
    state.forceRefresh = false;
  }
}

state.route = route;
window.addEventListener("hashchange", route);

const token = demo ? "demo-token" : loadToken();
if (token) setup(token);
if (import.meta.env.DEV && token) console.info(`Token em uso: ${maskToken(token)}`);
route();
