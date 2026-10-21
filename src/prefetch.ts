// Pré-carregamento logo depois do login: enquanto o botão "Entrar" mostra o progresso, busca os dados
// de todas as telas e deixa no cache, para cada página abrir na hora. As chamadas são as mesmas que as
// telas fazem (o cache é por função + parâmetros), por isso espelham painel, disciplinas, prazos,
// biblioteca, histórico, perfil e a página de cada disciplina.

import { api, DAY, ifAvailable, site, state } from "./state";
import { cycleData, recentClosed } from "./data";

/**
 * Tempo máximo segurando o botão. Com o AVA lento, entra antes e o resto continua por trás
 * (as telas reaproveitam as chamadas que ainda estão em andamento, sem repetir).
 */
const BUDGET_MS = 12000;

/** Janela de prazo das atividades cujos detalhes são pré-carregados: entregues há pouco ou vencendo em breve. */
const RECENT_DAYS = 14;
const AHEAD_DAYS = 21;

export async function warmUp(onProgress: (frac: number) => void): Promise<void> {
  const client = state.client!;
  let started = 0;
  let finished = 0;
  client.onNetwork = (phase) => (phase === "start" ? started++ : finished++);

  // Barra: metade pelo trabalho real (chamadas terminadas ÷ iniciadas), metade por uma curva de tempo
  // que desacelera. Nunca volta para trás e só chega a 100% quando acaba.
  const t0 = performance.now();
  let shown = 0;
  const tick = () => {
    const real = started ? finished / started : 0;
    const ease = 1 - Math.exp(-(performance.now() - t0) / 4000);
    shown = Math.max(shown, Math.min(0.96, 0.55 * real + 0.45 * ease));
    onProgress(shown);
  };
  const timer = setInterval(tick, 120);
  const quiet = (p: Promise<unknown>) => p.catch(() => undefined);

  const essentials = (async () => {
    // O route() não busca o site de novo se ele já estiver no estado.
    state.site = await api().siteInfo();
    state.available = new Set(state.site.functions.map((f) => f.name));
    const uid = site().userid;

    // Primeiro o que o painel precisa (é a tela que abre depois do login)…
    const d = await cycleData();
    const dash = quiet(recentClosed(d.current, 14));
    // …depois Prazos, Perfil, a página de cada disciplina e a Biblioteca.
    const ids = d.current.map((c) => c.id);
    await Promise.all([
      dash,
      quiet(recentClosed(d.current, 7)),
      quiet(ifAvailable("core_user_get_users_by_field", () => api().profile(uid), null)),
      quiet(ifAvailable("core_badges_get_user_badges", () => api().badges(), [])),
      ...ids.flatMap((id) => [
        quiet(ifAvailable("core_course_get_contents", () => api().contents(id), [])),
        quiet(ifAvailable("mod_assign_get_assignments", () => api().assignments([id]), [])),
        quiet(ifAvailable("mod_quiz_get_quizzes_by_courses", () => api().quizzes([id]), [])),
        quiet(ifAvailable("core_completion_get_activities_completion_status", () => api().completion(id, uid), [])),
      ]),
    ]);
    return d;
  })();

  try {
    await Promise.race([essentials, new Promise((r) => setTimeout(r, BUDGET_MS))]);
  } finally {
    clearInterval(timer);
    client.onNetwork = undefined;
    onProgress(1);
  }

  // Detalhes das atividades (status de envio e tentativas): seguem em segundo plano, sem segurar o login.
  // Só das que têm prazo perto (as que a pessoa provavelmente vai abrir agora); as demais são buscadas
  // quando a página delas for aberta. Assim o login não vira uma varredura do AVA inteiro.
  essentials
    .then((data) => {
      const uid = site().userid;
      const now = Date.now() / 1000;
      const near = (ts: number | undefined) => !!ts && ts > now - RECENT_DAYS * DAY && ts < now + AHEAD_DAYS * DAY;
      if (state.available.has("mod_assign_get_submission_status"))
        for (const a of data.assigns) if (near(a.duedate)) void quiet(api().submissionStatus(a.id));
      if (state.available.has("mod_quiz_get_user_quiz_attempts"))
        for (const q of data.quizzes)
          if (near(q.timeclose))
            void quiet(
              api()
                .quizAttempts(q.id, uid)
                // A nota do questionário só é pedida pela página quando há tentativa finalizada.
                .then(async (at) => {
                  if (at.some((x) => x.state === "finished") && state.available.has("mod_quiz_get_user_best_grade")) await api().quizBestGrade(q.id, uid);
                }),
            );
    })
    .catch(() => undefined);
}
