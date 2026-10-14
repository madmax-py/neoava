// Passo 3: disciplinas (pontos por ciclo e projeção da média) e próximos prazos.
// Uso: npm run resumo [-- --refresh]
import { fmtDateTime, fmtRelative } from "../src/format";
import { buildMaxIndex, cyclesOf, fmtNum, isCurrent, passPoints, standing, type Standing } from "../src/grades";
import { handleError, makeClient, refresh } from "./node-client";

const STAND: Record<Standing, string> = { secured: "✓ garantida", "on-track": "↗ no caminho", "at-risk": "! em risco", impossible: "✕ fora alcance", "no-data": "sem notas" };

const { api } = makeClient();
try {
  const info = await api.siteInfo();
  const has = new Set(info.functions.map((f) => f.name));
  const o = { refresh };

  const [courses, events] = await Promise.all([
    api.courses(info.userid, o),
    has.has("core_calendar_get_action_events_by_timesort") ? api.upcoming(30, 50, o) : Promise.resolve([]),
  ]);
  const current = courses.filter((c) => !c.hidden && isCurrent(c));
  const ids = current.map((c) => c.id);
  // Valor máximo de cada atividade (o quadro de notas do AVA não mostra): 2 chamadas agregadas.
  const [assigns, quizzes] = ids.length ? await Promise.all([api.assignments(ids, o), api.quizzes(ids, o)]) : [[], []];
  const idx = buildMaxIndex(assigns, quizzes);
  const target = passPoints();

  console.log(`\n${info.fullname} — ${info.sitename}\n`);
  console.log(`DISCIPLINAS DO CICLO (VA1/VA2/VA3 de 100 pts; média = soma ÷ 3; mínimo ${target}) — notas do AVA, podem não ser as oficiais`);
  for (const c of current) {
    const cy = cyclesOf(await api.gradeItems(c.id, info.userid, o), idx, c);
    if (!cy) {
      console.log(`  ${"".padEnd(34)}  ${c.fullname}  (sem VA1–VA3 no AVA)`);
      continue;
    }
    const vas = cy.cycles.map((x, i) => `${x.label} ${fmtNum(x.earned, 0).padStart(3)}${i === cy.current ? "*" : " "}`).join(" ");
    const proj = cy.projected === null ? "  –" : fmtNum(cy.projected, 0).padStart(3);
    console.log(`  ${vas}  proj ${proj}  ${STAND[standing(cy, target)].padEnd(14)} ${c.fullname}`);
  }
  console.log("  (* = ciclo em andamento; proj = média final mantendo o aproveitamento atual)");

  const now = Date.now() / 1000;
  console.log("\nPRÓXIMOS PRAZOS (30 dias, horário de Brasília)");
  if (!events.length) console.log("  nenhum");
  for (const ev of events) {
    const late = ev.overdue || ev.timesort < now ? " [ATRASADO]" : "";
    console.log(`  ${fmtDateTime(ev.timesort).padEnd(22)} ${fmtRelative(ev.timesort).padEnd(12)} ${ev.activityname ?? ev.name}${late}`);
    if (ev.course) console.log(`  ${"".padEnd(35)} ${ev.course.fullname}`);
  }
  console.log();
} catch (e) {
  handleError(e);
}
