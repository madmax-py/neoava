// Painel: visão geral do ciclo atual.

import { closedName, cycleData, courseName, deadlineStrip, eventRow, isLate, recentClosed, weeksGrid, type ClosedItem, type CourseStats } from "../data";
import { DAY, nowS, site, state } from "../state";
import { CYCLE_MAX, fmtNum, getPassMark, mean, parseGrade, passPoints, pointsNeeded, semesterOf, setPassMark, standing, type GradedPiece } from "../grades";
import { cycleLegend, cycleMini, n1, standingChip, standingTone } from "./cycles-ui";
import { fmtDateTime, fmtRelative } from "../format";
import { avatar, firstName, shell } from "../layout";
import type { ActionEvent, Course } from "../moodle/api";
import { card, columnChart, donut, h, heatmap, meterList, rangeList, statTile, statusChip } from "../ui";

const pts = (n: number) => fmtNum(n, n >= 100 ? 0 : 1);
const pctTxt = (f: number) => `${Math.round(f * 100)}%`;

function tone(f: number | null, pass: number) {
  if (f === null) return undefined;
  return f >= pass / 10 ? "good" : f >= pass / 10 - 0.1 ? "warn" : "bad";
}

export async function dashboard(id: number) {
  const d = await cycleData();
  const missed = (await recentClosed(d.current, 7)).filter((c) => c.status === "missed");
  const pass = getPassMark();
  const now = nowS();
  const stats = d.stats;

  const pieces = stats.flatMap((s) => (s.acc?.pieces ?? []).map((p) => ({ ...p, course: s.course })));
  const graded = pieces.filter((p) => p.pct !== null);

  const target = passPoints();
  const cyclic = stats.filter((s) => s.cycles);
  const withProj = cyclic.filter((s) => s.cycles!.projected !== null);
  const projAvg = mean(withProj.map((s) => s.cycles!.projected!));
  const curAvg = mean(cyclic.map((s) => s.cycles!.cycles[s.cycles!.current].earned));
  const curLabels = [...new Set(cyclic.map((s) => s.cycles!.cycles[s.cycles!.current].label))];
  const curLabel = curLabels.length === 1 ? curLabels[0] : "";
  const risky = cyclic.filter((s) => ["at-risk", "impossible"].includes(standing(s.cycles!, target)));

  const late = d.events.filter(isLate);
  const todo7 = d.events.filter((e) => !isLate(e) && e.timesort - now <= 7 * DAY);
  const semester = d.current.length ? semesterOf(Math.max(...d.current.map((c) => c.startdate ?? 0))) : semesterOf(now);

  if (id !== state.routeId) return; // o usuário já navegou para outra tela
  shell(
    h(
      "div",
      { class: "page-head" },
      h(
        "div",
        { class: "greeting" },
        avatar(site(), 56),
        h("div", {}, h("p", { class: "eyebrow" }, `Semestre ${semester}`), h("h1", {}, `Olá, ${firstName(site().fullname)}`)),
      ),
      h("div", { class: "head-aside" }, h("span", { class: "muted small" }, `${d.current.length} disciplina(s) no ciclo`), passInput(pass)),
    ),

    h(
      "div",
      { class: "tiles" },
      statTile(
        "Média projetada",
        projAvg === null ? "–" : n1(projAvg),
        projAvg === null
          ? "sem notas suficientes ainda"
          : h("span", {}, statusChip(projAvg >= target, { ok: "Acima da média", bad: "Abaixo da média", none: "" }), ` mínimo ${n1(target)} · média de ${withProj.length} disciplina(s)`),
        { hero: true },
      ),
      statTile(
        `Ciclo atual${curLabel ? ` (${curLabel})` : ""}`,
        curAvg === null ? "–" : n1(curAvg),
        curAvg === null ? "nenhuma disciplina com VA1–VA3" : `pontos de ${CYCLE_MAX}, em média por disciplina`,
      ),
      statTile(
        "Entregas em 7 dias",
        String(todo7.length),
        late.length || missed.length
          ? h(
              "span",
              {},
              late.length > 0 && h("span", { class: "chip bad" }, `! ${late.length} atrasada(s)`),
              missed.length > 0 && h("span", { class: "chip bad", "data-tip": missed.map((m) => `• ${closedName(m.event)}`).join("\n") }, `✕ ${missed.length} perdida(s) em 7 dias`),
            )
          : "nenhuma atrasada ou perdida",
        { tone: late.length || missed.length ? "bad" : undefined },
      ),
      statTile(
        "Disciplinas em risco",
        String(risky.length),
        risky.length
          ? h("span", { "data-tip": risky.map((r) => `• ${courseName(r.course)}`).join("\n") }, risky.map((r) => shortName(courseName(r.course))).join(", "))
          : cyclic.length
            ? "todas no caminho da média"
            : "–",
        { tone: risky.length ? "bad" : cyclic.length ? "good" : undefined },
      ),
    ),

    h(
      "div",
      { class: "bento" },
      span(cyclesCard(stats, target), 8),
      span(currentCycleCard(cyclic, curLabel), 4),
      span(todoCard(d.events, late, missed), 7),
      span(heatCard(d.events), 5),
      span(projectionCard(cyclic, target), 6),
      span(recentCard(graded), 6),
      span(distributionCard(graded, pass), 6),
      ...bottomRow(d.current, d.past, d.gradeBy, pass),
    ),
  );
}

/** Largura do card na grade de 12 colunas. */
function span(el: HTMLElement, n: number) {
  el.classList.add(`span-${n}`);
  return el;
}

const shortName = (n: string) => (n.length > 22 ? `${n.slice(0, 21)}…` : n);

/** Uma linha por disciplina: VA1/VA2/VA3 (0–100 cada) + projeção e situação. */
function cyclesCard(stats: CourseStats[], target: number) {
  const cyclic = stats.filter((s) => s.cycles).sort((a, b) => (b.cycles!.projected ?? -1) - (a.cycles!.projected ?? -1));
  const other = stats.filter((s) => !s.cycles);
  return card(
    h("div", { class: "card-title-row" }, h("h2", {}, "Disciplinas por ciclo"), cycleLegend()),
    cyclic.length
      ? h(
          "div",
          { class: "acc-list" },
          cyclic.map(({ course, cycles: cy }) =>
            h(
              "div",
              { class: "acc-row cyc-row" },
              h("a", { href: `#/disciplina/${course.id}`, class: "acc-name", title: courseName(course) }, courseName(course)),
              cycleMini(cy!, `${courseName(course)} · `),
              h(
                "div",
                { class: "acc-val" },
                h("span", { class: `eff ${standingTone(cy!, target) ?? ""}`, "data-tip": "Média final projetada (0–100)" }, cy!.projected === null ? "–" : n1(cy!.projected)),
                h("div", {}, standingChip(cy!, target)),
              ),
            ),
          ),
        )
      : h("p", { class: "empty" }, "Nenhuma disciplina com VA1, VA2 e VA3 no quadro de notas."),
    h(
      "p",
      { class: "note" },
      `Cada ciclo vale ${CYCLE_MAX} pontos; a média final é a média simples dos 3. O número à direita é a projeção mantendo seu aproveitamento atual. `,
      other.length > 0 && `Fora do modelo (estrutura diferente no AVA): ${other.map((o) => courseName(o.course)).join(", ")}.`,
    ),
  );
}

/** Rosca do ciclo em andamento, somando todas as disciplinas. */
function currentCycleCard(cyclic: CourseStats[], label: string) {
  const cur = cyclic.map((s) => s.cycles!.cycles[s.cycles!.current]);
  const sum = (f: (c: (typeof cur)[number]) => number) => cur.reduce((a, c) => a + f(c), 0);
  const earned = sum((c) => c.earned);
  const lost = sum((c) => c.lost);
  const open = sum((c) => c.open);
  const notReleased = sum((c) => c.notReleased);
  const total = cur.length * CYCLE_MAX;
  const row = (cls: string, name: string, v: number) =>
    h("li", {}, h("span", { class: `swatch ${cls}` }), h("span", { class: "pl-label" }, name), h("strong", {}, n1(v)), h("span", { class: "muted small" }, total ? pctTxt(v / total) : ""));
  return card(
    `Ciclo atual${label ? ` · ${label}` : ""}`,
    cur.length
      ? h(
          "div",
          { class: "points" },
          donut(
            [
              { value: earned, cls: "s-earned", label: "Obtido", tip: `Obtido\n${n1(earned)} pts` },
              { value: lost, cls: "s-lost", label: "Perdido", tip: `Perdido\n${n1(lost)} pts` },
              { value: open, cls: "s-open", label: "Em aberto", tip: `Em aberto\n${n1(open)} pts` },
              { value: notReleased, cls: "s-notreleased", label: "Não lançado", tip: `Ainda não lançado\n${n1(notReleased)} pts` },
            ],
            { value: n1(earned / cur.length), label: `média de ${CYCLE_MAX}` },
          ),
          h("ul", { class: "points-legend" }, row("s-earned", "Obtido", earned), row("s-lost", "Perdido", lost), row("s-open", "Em aberto", open), row("s-notreleased", "Não lançado", notReleased)),
        )
      : h("p", { class: "empty" }, "Sem disciplinas com ciclos."),
    cur.length > 0 && h("p", { class: "note" }, `Soma de ${cur.length} disciplina(s) × ${CYCLE_MAX} pts. "Não lançado" = pontos que ainda não viraram atividade no AVA.`),
  );
}

/** Faixa de cada disciplina: de "garantido" até "máximo possível", com a projeção marcada. */
function projectionCard(cyclic: CourseStats[], target: number) {
  const rows = [...cyclic]
    .filter((s) => standing(s.cycles!, target) !== "no-data")
    .sort((a, b) => (a.cycles!.projected ?? 0) - (b.cycles!.projected ?? 0))
    .map(({ course, cycles: cy }) => {
      const need = pointsNeeded(cy!, target);
      return {
        label: courseName(course),
        href: `#/disciplina/${course.id}`,
        lo: cy!.secured,
        hi: cy!.maxPossible,
        mark: cy!.projected,
        display: cy!.projected === null ? "–" : n1(cy!.projected),
        tone: standingTone(cy!, target),
        tip: [
          courseName(course),
          `Garantido: ${n1(cy!.secured)}`,
          cy!.projected !== null ? `Projeção: ${n1(cy!.projected)} (aproveitamento ${pctTxt(cy!.efficiency ?? 0)})` : "",
          `Máximo possível: ${n1(cy!.maxPossible)}`,
          need > 0 ? `Faltam ${n1(need)} pts (somando os ciclos) para média ${n1(target)}` : `Média ${n1(target)} garantida`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    });
  return card(
    h("div", { class: "card-title-row" }, h("h2", {}, "Projeção da média final"), h("span", { class: "muted small" }, "0–100")),
    rows.length ? rangeList(rows, { max: CYCLE_MAX, ref: target, refLabel: `mín. ${n1(target)}`, ticks: [0, 50, 100] }) : h("p", { class: "empty" }, "Sem notas suficientes para projetar."),
    rows.length > 0 &&
      h(
        "p",
        { class: "note" },
        "Azul escuro = média já garantida · faixa clara = até onde ainda dá para chegar · bolinha = projeção mantendo o aproveitamento atual · linha = média mínima.",
      ),
  );
}

function todoCard(events: ActionEvent[], late: ActionEvent[], missed: ClosedItem[]) {
  const upcoming = events.filter((e) => !isLate(e));
  return card(
    h("div", { class: "card-title-row" }, h("h2", {}, "A fazer"), h("a", { href: "#/prazos", class: "small" }, "ver todos →")),
    missed.length > 0 &&
      h(
        "a",
        { href: "#/prazos", class: "alert compact" },
        h("strong", {}, `✕ Não entregue: `),
        missed.map((m) => `${closedName(m.event)} (${fmtDateTime(m.event.timestart)})`).join(", "),
      ),
    h("p", { class: "muted small chart-cap" }, "Entregas por dia · próximos 14 dias"),
    deadlineStrip(events),
    events.length ? h("ul", { class: "events compact" }, [...late, ...upcoming].slice(0, 5).map((ev) => eventRow(ev))) : h("p", { class: "empty" }, "🎉 Nada pendente nos próximos 30 dias."),
  );
}

function heatCard(events: ActionEvent[]) {
  const { grid, labels } = weeksGrid(events, 5);
  const busiest = grid.flat().reduce((a, c) => (c.count > a.count ? c : a), grid[0][0]);
  return card(
    "Próximas 5 semanas",
    heatmap(grid, ["S", "T", "Q", "Q", "S", "S", "D"], labels),
    busiest.count > 1 && h("p", { class: "note" }, `Dia mais cheio: ${busiest.tip.split("\n")[0]} (${busiest.count} entregas).`),
  );
}

function recentCard(graded: (GradedPiece & { course: Course })[]) {
  const dated = graded.filter((p) => p.gradedAt).sort((a, b) => b.gradedAt! - a.gradedAt!);
  const list = (dated.length ? dated : graded).slice(0, 6);
  return card(
    h("div", { class: "card-title-row" }, h("h2", {}, "Últimas notas lançadas"), h("span", { class: "muted small" }, `${graded.length} corrigidas no ciclo`)),
    list.length
      ? h(
          "ul",
          { class: "recent" },
          list.map((p) =>
            h(
              "li",
              {},
              h(
                "div",
                { class: "recent-main" },
                h("span", { class: "recent-name", title: p.name }, p.name),
                h("a", { href: `#/disciplina/${p.course.id}`, class: "event-course" }, courseName(p.course)),
              ),
              h(
                "div",
                { class: "recent-side" },
                h("span", { class: `grade-pill ${tone(p.pct, getPassMark()) ?? ""}` }, `${fmtNum(p.earned!, 2)} / ${fmtNum(p.max, p.max % 1 ? 2 : 0)}`),
                h("span", { class: "muted small", "data-tip": p.gradedAt ? `Lançada em ${fmtDateTime(p.gradedAt)}` : "" }, p.gradedAt ? fmtRelative(p.gradedAt) : ""),
              ),
            ),
          ),
        )
      : h("p", { class: "empty" }, "Nenhuma nota lançada ainda neste ciclo."),
  );
}

function distributionCard(graded: GradedPiece[], pass: number) {
  const bins = [
    { label: "<50%", lo: 0, hi: 0.5 },
    { label: "50–59", lo: 0.5, hi: 0.6 },
    { label: "60–69", lo: 0.6, hi: 0.7 },
    { label: "70–79", lo: 0.7, hi: 0.8 },
    { label: "80–89", lo: 0.8, hi: 0.9 },
    { label: "90–100", lo: 0.9, hi: 1.01 },
  ];
  const counts = bins.map((b) => graded.filter((p) => p.pct! >= b.lo && p.pct! < b.hi));
  // Folga no topo para o rótulo da coluna mais alta não encostar no título.
  const max = Math.max(1, ...counts.map((c) => c.length)) * 1.2;
  return card(
    h("div", { class: "card-title-row" }, h("h2", {}, "Distribuição das suas notas"), h("span", { class: "muted small" }, "% do valor de cada avaliação")),
    graded.length
      ? columnChart(
          bins.map((b, i) => ({
            label: b.label,
            value: counts[i].length,
            showValue: counts[i].length ? String(counts[i].length) : undefined,
            cls: b.hi <= pass / 10 ? "below" : "",
            tip: [`${b.label}${b.label.endsWith("%") ? "" : "%"} do valor`, `${counts[i].length} avaliação(ões)`, ...counts[i].slice(0, 6).map((p) => `• ${p.name}`), counts[i].length > 6 ? `… e mais ${counts[i].length - 6}` : ""].filter(Boolean).join("\n"),
          })),
          { max, height: 140, hideEmpty: true },
        )
      : h("p", { class: "empty" }, "Sem avaliações corrigidas ainda."),
    graded.length > 0 && h("p", { class: "note" }, `Faixas em cinza ficam abaixo da média mínima (${pass * 10}%).`),
  );
}

function progressCard(current: Course[]) {
  const rows = current
    .filter((c) => typeof c.progress === "number")
    .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))
    .map((c) => ({
      label: courseName(c),
      href: `#/disciplina/${c.id}`,
      value: (c.progress ?? 0) / 100,
      display: `${Math.round(c.progress ?? 0)}%`,
      tip: `${courseName(c)}\n${Math.round(c.progress ?? 0)}% das atividades concluídas`,
    }));
  return card(
    "Conclusão por disciplina",
    rows.length ? meterList(rows) : h("p", { class: "empty" }, "O AVA não informa o progresso destas disciplinas."),
    h("p", { class: "note" }, "Atividades marcadas como concluídas no AVA (vistas, enviadas ou feitas)."),
  );
}

function historyCard(past: Course[], current: Course[], gradeBy: Map<number, string>, pass: number) {
  const bySem = new Map<string, number[]>();
  for (const c of [...past, ...current]) {
    const g = parseGrade(gradeBy.get(c.id));
    if (g === null || !c.startdate) continue;
    const k = semesterOf(c.startdate);
    bySem.set(k, [...(bySem.get(k) ?? []), g]);
  }
  if (!bySem.size) return null;
  const curSem = current[0]?.startdate ? semesterOf(current[0].startdate) : null;
  const sems = [...bySem.keys()].sort().slice(-8);
  return card(
    h("div", { class: "card-title-row" }, h("h2", {}, "Histórico de médias")),
    columnChart(
      sems.map((k) => {
        const avg = mean(bySem.get(k)!)!;
        return {
          label: k,
          value: avg,
          tip: `${k}${k === curSem ? " (em andamento)" : ""}\nMédia: ${fmtNum(avg)}\n${bySem.get(k)!.length} disciplina(s)`,
          showValue: fmtNum(avg),
          highlight: k === curSem,
          cls: k === curSem ? "current" : "",
        };
      }),
      { max: 10, ticks: [0, 5, 10], ref: { value: pass, label: fmtNum(pass) }, height: 150, fmt: (n) => String(n) },
    ),
    h("a", { href: "#/historico", class: "small" }, "histórico completo →"),
  );
}

function bottomRow(current: Course[], past: Course[], gradeBy: Map<number, string>, pass: number) {
  const hist = historyCard(past, current, gradeBy, pass);
  const prog = progressCard(current);
  if (!hist) return [span(prog, 12)];
  return [span(prog, 6), span(hist, 6)];
}

/** Média mínima para aprovação, em pontos (0–100). Guardada internamente em 0–10. */
export function passInput(pass: number) {
  return h(
    "label",
    { class: "small muted pass-label", title: "Média final mínima para aprovação (0–100)" },
    "média mínima ",
    h("input", {
      type: "number",
      min: 10,
      max: 100,
      step: 5,
      value: pass * 10,
      class: "pass-input",
      onchange: (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        if (v > 0 && v <= 100) {
          setPassMark(v / 10);
          state.route();
        }
      },
    }),
  );
}
