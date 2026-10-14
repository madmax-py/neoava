// Disciplinas: cartões do ciclo atual + lista das anteriores.

import { cycleData, courseName, isLate } from "../data";
import { efficiency, fmtNum, getPassMark, parseGrade, passPoints, semesterOf } from "../grades";
import { cycleMini, n1, standingChip, standingTone } from "./cycles-ui";
import { fmtDateTime, fmtRelative } from "../format";
import { pageHead, shell } from "../layout";
import { nowS, state } from "../state";
import { card, h, ring, stackBar, statusChip } from "../ui";

export async function coursesPage(id: number) {
  const d = await cycleData();
  const pass = getPassMark();
  const target = passPoints();
  const now = nowS();

  if (id !== state.routeId) return; // o usuário já navegou para outra tela
  shell(
    pageHead("Ciclo atual", "Disciplinas"),
    d.stats.length
      ? h(
          "div",
          { class: "course-grid" },
          d.stats.map(({ course, acc, cycles: cy, events }) => {
            const eff = acc ? efficiency(acc) : null;
            const next = events.filter((e) => !isLate(e)).sort((a, b) => a.timesort - b.timesort)[0];
            const late = events.filter(isLate).length;
            const graded = acc?.pieces.filter((p) => p.earned !== null).length ?? 0;
            const totalItems = (acc?.pieces.length ?? 0) + (acc?.unknown ?? 0);
            return h(
              "a",
              { href: `#/disciplina/${course.id}`, class: "course-card" },
              h(
                "div",
                { class: "cc-head" },
                h("h3", { title: courseName(course) }, courseName(course)),
                typeof course.progress === "number" && h("div", { "data-tip": `${Math.round(course.progress)}% das atividades concluídas` }, ring(course.progress / 100, `${Math.round(course.progress)}%`, 46)),
              ),
              cy
                ? [
                    h(
                      "div",
                      { class: "cc-stats" },
                      h("div", {}, h("span", { class: "muted small" }, "Projeção"), h("strong", { class: `eff ${standingTone(cy, target) ?? ""}` }, cy.projected === null ? "–" : n1(cy.projected))),
                      h("div", {}, h("span", { class: "muted small" }, "Garantido"), h("strong", {}, n1(cy.secured))),
                      h("div", {}, h("span", { class: "muted small" }, "Máx. possível"), h("strong", {}, n1(cy.maxPossible))),
                    ),
                    cycleMini(cy),
                    h("div", {}, standingChip(cy, target)),
                  ]
                : [
                    h(
                      "div",
                      { class: "cc-stats" },
                      h("div", {}, h("span", { class: "muted small" }, "Aproveitamento"), h("strong", { class: `eff ${eff === null ? "" : eff >= pass / 10 ? "good" : "bad"}` }, eff === null ? "–" : `${Math.round(eff * 100)}%`)),
                      h("div", {}, h("span", { class: "muted small" }, "Pontos"), h("strong", {}, acc ? `${fmtNum(acc.earned)} / ${fmtNum(acc.total)}` : "–")),
                      h("div", {}, h("span", { class: "muted small" }, "Corrigidas"), h("strong", {}, `${graded}/${totalItems}`)),
                    ),
                    acc && acc.total > 0
                      ? stackBar(
                          [
                            { value: acc.earned, cls: "s-earned", tip: `Obtido: ${fmtNum(acc.earned)} pts` },
                            { value: acc.lost, cls: "s-lost", tip: `Perdido: ${fmtNum(acc.lost)} pts` },
                            { value: acc.open, cls: "s-open", tip: `Em aberto: ${fmtNum(acc.open)} pts` },
                          ],
                          acc.total,
                        )
                      : h("div", { class: "stack empty-stack" }),
                    h("span", { class: "small muted" }, "Sem VA1–VA3 no AVA: mostrando a soma dos itens."),
                  ],
              h(
                "div",
                { class: "cc-foot" },
                late > 0 && h("span", { class: "chip bad" }, `! ${late} atrasada(s)`),
                next
                  ? h("span", { class: "small muted", "data-tip": fmtDateTime(next.timesort) }, `Próxima: ${next.activityname ?? next.name} · ${fmtRelative(next.timesort)}`)
                  : h("span", { class: "small muted" }, "Nada pendente"),
              ),
            );
          }),
        )
      : h("p", { class: "empty" }, "Nenhuma disciplina no ciclo atual."),
    d.past.length > 0 &&
      card(
        "Disciplinas anteriores",
        h(
          "table",
          { class: "table" },
          h("thead", {}, h("tr", {}, h("th", {}, "Disciplina"), h("th", {}, "Semestre"), h("th", { class: "num" }, "Nota no AVA"), h("th", {}, ""))),
          h(
            "tbody",
            {},
            [...d.past]
              .sort((a, b) => (b.startdate ?? 0) - (a.startdate ?? 0))
              .map((c) => {
                const g = parseGrade(d.gradeBy.get(c.id));
                return h(
                  "tr",
                  {},
                  h("td", {}, h("a", { href: `#/disciplina/${c.id}` }, courseName(c))),
                  h("td", { class: "muted" }, c.startdate ? semesterOf(c.startdate) : "–"),
                  h("td", { class: "num" }, d.gradeBy.get(c.id) ?? "–"),
                  h("td", {}, g !== null && statusChip(g >= pass)),
                );
              }),
          ),
        ),
      ),
    h("p", { class: "note" }, `Atualizado ${fmtRelative(now)}. Cada ciclo (VA1–VA3) vale 100 pontos; a média final é a média simples dos 3. Projeção = mantendo o aproveitamento atual.`),
  );
}
