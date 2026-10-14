// Histórico: nota de cada ciclo (VA1–VA3 / Fase 1–3) das disciplinas atuais + disciplinas anteriores.
// O AVA não mostra a nota dos ciclos: ela é a soma das atividades de cada ciclo (máx. 100).

import { state } from "../state";
import { courseName, cycleData, type CourseStats } from "../data";
import { CYCLE_MAX, getPassMark, mean, parseGrade, semesterOf, type Cycle } from "../grades";
import { pageHead, shell } from "../layout";
import { card, h, statusChip } from "../ui";
import { cycleLegend, cycleSegments, n1 } from "./cycles-ui";

/** Atividades do ciclo com a nota de cada uma (para o tooltip). */
function cycleTip(st: CourseStats, c: Cycle) {
  const acts = st.items.filter((i) => (i.itemtype === "mod" || i.itemtype === "manual") && i.categoryid === c.id);
  const lines = acts.map((i) => `${i.itemname ?? "Atividade"}: ${typeof i.graderaw === "number" ? n1(i.graderaw) : "sem nota"}`);
  return [`${c.label}: ${n1(c.earned)} de ${CYCLE_MAX}`, ...(lines.length ? lines : ["Nenhuma atividade lançada"])].join("\n");
}

function cycleCard(n: number, stats: CourseStats[]) {
  const rows = stats.map((st) => ({ st, c: st.cycles!.cycles[n] }));
  const avg = mean(rows.filter((r) => r.c.graded > 0).map((r) => r.c.earned));
  return card(
    h(
      "div",
      { class: "card-title-row" },
      h("h2", {}, `Ciclo ${n + 1} `, h("span", { class: "muted small" }, `VA${n + 1} · Fase ${n + 1}`)),
      h("span", { class: "muted small" }, avg === null ? "sem notas ainda" : `média ${n1(avg)} / ${CYCLE_MAX}`),
    ),
    h(
      "div",
      { class: "meters" },
      rows.map(({ st, c }) =>
        h(
          "div",
          { class: "meter-row", "data-tip": cycleTip(st, c) },
          h("a", { href: `#/disciplina/${st.course.id}`, class: "meter-label", title: courseName(st.course) }, courseName(st.course)),
          cycleSegments(c),
          h("span", { class: "meter-val" }, c.graded > 0 ? h("strong", {}, n1(c.earned)) : "–"),
        ),
      ),
    ),
  );
}

export async function historyPage(id: number) {
  const { past, gradeBy, stats } = await cycleData();
  const pass = getPassMark();
  const cyclic = stats.filter((st) => st.cycles).sort((a, b) => courseName(a.course).localeCompare(courseName(b.course), "pt-BR"));
  const other = stats.filter((st) => !st.cycles);

  if (id !== state.routeId) return; // o usuário já navegou para outra tela
  shell(
    pageHead("Notas por ciclo", "Histórico"),
    h(
      "div",
      { class: "alert warn", role: "note" },
      h("strong", {}, "! Estas notas podem estar incorretas"),
      h(
        "span",
        {},
        "Os valores vêm exatamente do que está lançado no AVA. Se algum professor lançar uma nota errada, deixar de lançar, ou colocar a atividade no ciclo errado, a soma aqui também fica errada. Na dúvida, confira com o professor ou no sistema acadêmico.",
      ),
    ),
    cyclic.length
      ? [
          h("div", { class: "card-title-row" }, h("p", { class: "muted small" }, `Soma das atividades de cada ciclo (máx. ${CYCLE_MAX}). Passe o mouse para ver as atividades.`), cycleLegend()),
          ...[0, 1, 2].map((n) => cycleCard(n, cyclic)),
          other.length > 0 && h("p", { class: "note" }, `Sem ciclos no AVA (não aparecem acima): ${other.map((st) => courseName(st.course)).join(", ")}.`),
        ]
      : h("p", { class: "empty" }, "Nenhuma disciplina com ciclos (VA1–VA3 / Fase 1–3) no semestre atual."),
    past.length > 0 &&
      card(
        "Disciplinas anteriores",
        h(
          "table",
          { class: "table" },
          h("thead", {}, h("tr", {}, h("th", {}, "Disciplina"), h("th", {}, "Semestre"), h("th", { class: "num" }, "Nota no AVA"), h("th", {}, ""))),
          h(
            "tbody",
            {},
            [...past]
              .sort((a, b) => (b.startdate ?? 0) - (a.startdate ?? 0))
              .map((c) => {
                const g = parseGrade(gradeBy.get(c.id));
                return h(
                  "tr",
                  {},
                  h("td", {}, h("a", { href: `#/disciplina/${c.id}` }, courseName(c))),
                  h("td", { class: "muted" }, c.startdate ? semesterOf(c.startdate) : "–"),
                  h("td", { class: "num" }, gradeBy.get(c.id) ?? "–"),
                  h("td", {}, statusChip(g === null ? null : g >= pass)),
                );
              }),
          ),
        ),
      ),
  );
}
