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
import { deadlinesPage } from "./views/deadlines";
import { historyPage } from "./views/history";
import { profilePage } from "./views/profile";

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
    const qz = hash.match(/^#\/disciplina\/(\d+)\/questionario\/(\d+)(?:\/tentativa\/(\d+)(?:\/pagina\/(\d+)|\/(resumo))?)?/);
    const m = hash.match(/^#\/disciplina\/(\d+)/);
    if (qz?.[3]) await attemptPage(Number(qz[1]), Number(qz[2]), Number(qz[3]), qz[4] ? Number(qz[4]) - 1 : null, id, qz[5] ? "resumo" : undefined);
    else if (qz) await quizPage(Number(qz[1]), Number(qz[2]), id);
    else if (m) await courseView(Number(m[1]), id);
    else if (hash.startsWith("#/disciplinas")) await coursesPage(id);
    else if (hash.startsWith("#/prazos")) await deadlinesPage(id);
    else if (hash.startsWith("#/historico")) await historyPage(id);
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
