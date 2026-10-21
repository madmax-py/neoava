// Painel: o que fazer agora, o que já passou do prazo e onde estão as dificuldades.
// O quadro de notas do AVA costuma estar incompleto, então o foco são as provas (nota lançada ou não).

import { closedRow, cycleData, courseName, deadlineStrip, eventRow, isLate, recentClosed, weeksGrid, type ClosedItem, type CourseStats } from "../data";
import { DAY, nowS, site, state } from "../state";
import { difficultyOf, fmtNum, getPassMark, semesterOf, setPassMark, type Difficulty, type Exam } from "../grades";
import { fmtDateTime, fmtRelative } from "../format";
import { avatar, firstName, shell } from "../layout";
import type { ActionEvent, Course } from "../moodle/api";
import { card, h, heatmap, modBadge, playIntro, statTile } from "../ui";

const pct = (f: number | null) => (f === null ? "–" : `${Math.round(f * 100)}%`);
const shortName = (n: string) => (n.length > 22 ? `${n.slice(0, 21)}…` : n);

/** A entrada animada só acontece no primeiro desenho do painel depois de abrir o app. */
let introPlayed = false;

export async function dashboard(id: number) {
  const d = await cycleData();
  const closed = await recentClosed(d.current, 14);
  const pass = getPassMark();
  const now = nowS();
  const stats = d.stats;

  const late = d.events.filter(isLate);
  // Encerrados sem entrega que o calendário de ações já não mostra (sem repetir o que já está em `late`).
  const lateKeys = new Set(late.map((e) => `${e.modulename}:${e.instance}`));
  const closedLate = closed.filter((c) => ["missed", "late-open", "draft", "inprogress"].includes(c.status) && !lateKeys.has(`${c.event.modulename}:${c.event.instance}`));
  const upcoming = d.events.filter((e) => !isLate(e));
  const todo7 = upcoming.filter((e) => e.timesort - now <= 7 * DAY);

  const exams = stats.flatMap((s) => s.exams.map((e) => ({ ...e, course: s.course })));
  const gradedExams = exams.filter((e) => e.state === "graded");
  const awaiting = exams.filter((e) => e.state === "awaiting");
  const struggling = stats.filter((s) => s.difficulty.level === "bad" || s.difficulty.level === "warn");
  const semester = d.current.length ? semesterOf(Math.max(...d.current.map((c) => c.startdate ?? 0))) : semesterOf(now);
  const overdueCount = late.length + closedLate.length;

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
      statTile("A fazer · 7 dias", String(todo7.length), upcoming.length > todo7.length ? `${upcoming.length} nos próximos 30 dias` : "nada além disso em 30 dias", { hero: true }),
      statTile("Passaram do prazo", String(overdueCount), overdueCount ? "veja abaixo o que ainda aceita envio" : "nada atrasado nas últimas 2 semanas", {
        tone: overdueCount ? "bad" : "good",
      }),
      statTile(
        "Provas com nota",
        `${gradedExams.length}/${gradedExams.length + awaiting.length}`,
        awaiting.length ? h("span", { class: "chip warn" }, `${awaiting.length} aguardando lançamento`) : "todas as provas feitas já têm nota",
      ),
      statTile(
        "Dificuldade nas provas",
        String(struggling.length),
        struggling.length
          ? h("span", { "data-tip": struggling.map((s) => `• ${courseName(s.course)}: ${s.difficulty.reason}`).join("\n") }, struggling.map((s) => shortName(courseName(s.course))).join(", "))
          : gradedExams.length
            ? "nenhuma disciplina com alerta"
            : "sem provas corrigidas ainda",
        { tone: struggling.some((s) => s.difficulty.level === "bad") ? "bad" : undefined },
      ),
    ),

    h(
      "div",
      { class: "bento" },
      span(difficultyCard(stats, pass), 7),
      span(overdueCard(late, closedLate), 5),
      span(todoCard(d.events, upcoming), 7),
      span(heatCard(d.events), 5),
      span(examsCard(exams, stats), 12),
    ),
  );
  if (!introPlayed) {
    introPlayed = true;
    playIntro([...document.querySelectorAll("main .page-head, main .tiles > *, main .bento > *")]);
  }
}

/** Largura do card na grade de 12 colunas. */
function span(el: HTMLElement, n: number) {
  el.classList.add(`span-${n}`);
  return el;
}

const LEVEL_ORDER = { bad: 0, warn: 1, ok: 2, "no-exam": 3 } as const;
const LEVEL_CHIP = { bad: "bad", warn: "warn", ok: "good", "no-exam": "" } as const;

/** Dificuldade de uma disciplina olhando só um ciclo (ou o semestre todo, com cycle = null). */
function difficultyIn(s: CourseStats, cycle: number | null, pass: number): Difficulty {
  if (cycle === null) return s.difficulty;
  const exams = s.exams.filter((e) => e.cycle === cycle);
  const pieces = (s.acc?.pieces ?? []).filter((p) => s.cycleOfItem.get(p.id) === cycle);
  return difficultyOf(exams, pieces, pass / 10);
}

/** Provas × demais atividades, por disciplina e por ciclo: a nota da prova pesa mais que o total. */
function difficultyCard(stats: CourseStats[], pass: number) {
  const gradedIn = (n: number) => stats.some((s) => s.exams.some((e) => e.cycle === n && e.state === "graded"));
  const options = [...[1, 2, 3].map((n) => ({ key: n as number | null, label: cycleName(n, stats) })), { key: null, label: "Semestre" }];
  // Abre no ciclo mais recente que já tem prova corrigida (o atual costuma ainda não ter).
  let sel = [3, 2, 1].find(gradedIn) ?? currentCycle(stats) ?? null;
  const cur = currentCycle(stats);
  const tabs = h("div", { class: "seg-filter", role: "group", "aria-label": "Mostrar dificuldade do ciclo" });
  const body = h("div", {});
  const render = () => {
    tabs.replaceChildren(
      ...options.map((o) =>
        h(
          "button",
          {
            type: "button",
            class: o.key === sel ? "active" : "",
            "aria-pressed": String(o.key === sel),
            onclick: () => {
              sel = o.key;
              render();
            },
          },
          o.label,
          o.key !== null && o.key === cur && h("span", { class: "dot", title: "ciclo em andamento" }),
        ),
      ),
    );
    body.replaceChildren(difficultyList(stats, sel, pass));
  };
  render();
  return card(
    h("div", { class: "card-title-row" }, h("h2", {}, "Onde está mais difícil"), tabs),
    h("p", { class: "muted small chart-cap" }, `média mínima ${pass * 10}%`),
    body,
    h(
      "p",
      { class: "note" },
      "O quadro de notas do AVA costuma estar incompleto, então o alerta olha primeiro para as provas (Verificação de Aprendizagem): prova abaixo da média, perto do limite ou bem abaixo das outras atividades do mesmo ciclo.",
    ),
  );
}

function difficultyList(stats: CourseStats[], cycle: number | null, pass: number) {
  const rows = stats
    .map((s) => ({ ...s, df: difficultyIn(s, cycle, pass), examsHere: cycle === null ? s.exams : s.exams.filter((e) => e.cycle === cycle) }))
    .sort((a, b) => LEVEL_ORDER[a.df.level] - LEVEL_ORDER[b.df.level] || (a.df.exam ?? 2) - (b.df.exam ?? 2));
  const bar = (label: string, v: number | null, cls: string) =>
    h(
      "div",
      { class: "diff-bar" },
      h("span", { class: "diff-k" }, label),
      h("div", { class: "meter" }, v !== null && h("div", { class: `meter-fill ${cls}`, style: `width:${v * 100}%` })),
      h("span", { class: "meter-val" }, pct(v)),
    );
  return rows.length
      ? h(
          "div",
          { class: "diff-list" },
          rows.map(({ course, df, examsHere: exams }) =>
            h(
              "div",
              { class: `diff-row lvl-${df.level}` },
              h(
                "div",
                { class: "diff-name" },
                h("a", { href: `#/disciplina/${course.id}`, title: courseName(course) }, courseName(course)),
                h("span", { class: `chip ${LEVEL_CHIP[df.level]}` }, df.reason),
              ),
              h(
                "div",
                { class: "diff-bars", "data-tip": [`${df.examsGraded} de ${exams.length} prova(s) com nota`, `Total corrigido: ${pct(df.overall)}`].join("\n") },
                bar("Provas", df.exam, df.level === "bad" ? "bad" : df.level === "warn" ? "warn" : ""),
                bar("Atividades", df.others, "quiet"),
              ),
            ),
          ),
        )
      : h("p", { class: "empty" }, "Nenhuma disciplina no ciclo.");
}

function overdueCard(late: ActionEvent[], closedLate: ClosedItem[]) {
  const total = late.length + closedLate.length;
  return card(
    h("div", { class: "card-title-row" }, h("h2", {}, "Passaram do prazo"), total > 0 && h("span", { class: "chip bad" }, `${total}`)),
    total
      ? h("ul", { class: "events compact" }, late.map((ev) => eventRow(ev)), closedLate.map((c) => closedRow(c)))
      : h("p", { class: "empty" }, "Nada atrasado nas últimas 2 semanas."),
    h("p", { class: "note" }, "Prazos vencidos nas últimas 2 semanas que não foram entregues, ficaram em rascunho ou ainda aceitam envio atrasado."),
  );
}

function todoCard(events: ActionEvent[], upcoming: ActionEvent[]) {
  return card(
    h("div", { class: "card-title-row" }, h("h2", {}, "A fazer"), h("a", { href: "#/prazos", class: "small" }, "ver todos →")),
    h("p", { class: "muted small chart-cap" }, "Entregas por dia · próximos 14 dias"),
    deadlineStrip(events),
    upcoming.length ? h("ul", { class: "events compact" }, upcoming.slice(0, 6).map((ev) => eventRow(ev))) : h("p", { class: "empty" }, "Nada pendente nos próximos 30 dias."),
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

type CourseExam = Exam & { course: Course };

/** Nome do ciclo n como a maioria das disciplinas chama (VA1, Fase 1…). */
function cycleName(n: number, stats: CourseStats[]) {
  const labels = stats.map((s) => s.cycles?.cycles[n - 1]?.label).filter((l): l is string => !!l);
  if (!labels.length) return `Ciclo ${n}`;
  return labels.reduce((best, l) => (labels.filter((x) => x === l).length > labels.filter((x) => x === best).length ? l : best), labels[0]);
}

/** Ciclo em andamento na maioria das disciplinas. */
function currentCycle(stats: CourseStats[]): number | null {
  const votes = stats.filter((s) => s.cycles).map((s) => s.cycles!.current + 1);
  if (!votes.length) return null;
  return [1, 2, 3].reduce((best, n) => (votes.filter((v) => v === n).length > votes.filter((v) => v === best).length ? n : best), votes[0]);
}

/** Provas por ciclo (seletor), cada uma com a situação: nota lançada, feita e sem nota, ou ainda por vir. */
function examsCard(all: CourseExam[], stats: CourseStats[]) {
  const options: { key: string; label: string; list: CourseExam[] }[] = [
    ...[1, 2, 3].map((n) => ({ key: String(n), label: cycleName(n, stats), list: all.filter((e) => e.cycle === n) })),
    ...(all.some((e) => e.cycle === null) ? [{ key: "none", label: "Sem ciclo", list: all.filter((e) => e.cycle === null) }] : []),
    { key: "all", label: "Todos", list: all },
  ];
  const cur = currentCycle(stats);
  let sel = options.find((o) => o.key === String(cur) && o.list.length) ?? options.find((o) => o.list.length && o.key !== "all") ?? options[options.length - 1];

  const body = h("div", {});
  const tabs = h("div", { class: "seg-filter", role: "group", "aria-label": "Mostrar provas do ciclo" });
  const render = () => {
    tabs.replaceChildren(
      ...options.map((o) =>
        h(
          "button",
          {
            type: "button",
            class: o === sel ? "active" : "",
            "aria-pressed": String(o === sel),
            onclick: () => {
              sel = o;
              render();
            },
          },
          o.label,
          o.key === String(cur) && h("span", { class: "dot", title: "ciclo em andamento" }),
          h("span", { class: "count" }, String(o.list.length)),
        ),
      ),
    );
    body.replaceChildren(examSummary(sel.list, sel.key === "all" ? "No semestre" : sel.label), examGroups(sel.list));
  };
  render();
  return card(h("div", { class: "card-title-row" }, h("h2", {}, "Provas do ciclo"), tabs), body);
}

/** "VA1: 4 de 4 provas feitas já têm nota" — deixa claro o que já foi corrigido em cada ciclo. */
function examSummary(list: CourseExam[], label: string) {
  const done = list.filter((e) => e.state === "graded" || e.state === "awaiting");
  const graded = list.filter((e) => e.state === "graded").length;
  const ahead = list.filter((e) => e.state === "upcoming").length;
  if (!list.length) return h("p", { class: "note exam-summary" }, `${label}: nenhuma prova encontrada no quadro de notas.`);
  return h(
    "p",
    { class: "exam-summary" },
    h("strong", {}, `${label}: `),
    done.length ? `${graded} de ${done.length} prova(s) feita(s) já têm nota` : "nenhuma prova feita ainda",
    ahead ? ` · ${ahead} por vir` : "",
    done.length > 0 && graded === done.length ? h("span", { class: "chip good" }, "✓ tudo corrigido") : done.length > graded ? h("span", { class: "chip warn" }, `${done.length - graded} sem nota`) : null,
  );
}

function examGroups(exams: CourseExam[]) {
  const pass = getPassMark() / 10;
  const graded = exams.filter((e) => e.state === "graded").sort((a, b) => (b.gradedAt ?? 0) - (a.gradedAt ?? 0));
  const awaiting = exams.filter((e) => e.state === "awaiting").sort((a, b) => b.due! - a.due!);
  const upcoming = exams.filter((e) => e.state === "upcoming").sort((a, b) => a.due! - b.due!);
  const undated = exams.filter((e) => e.state === "undated");
  const num = (v: number) => fmtNum(v, v % 1 ? 1 : 0);

  const row = (e: CourseExam, side: HTMLElement[]) =>
    h(
      "li",
      {},
      h(
        "div",
        { class: "recent-main" },
        h("span", { class: "recent-name", title: e.name }, modBadge(e.module ?? undefined), e.name),
        h("a", { href: `#/disciplina/${e.course.id}`, class: "event-course" }, courseName(e.course)),
      ),
      h("div", { class: "recent-side" }, ...side),
    );
  const group = (title: string, list: CourseExam[], side: (e: CourseExam) => HTMLElement[]) =>
    list.length > 0 && h("section", { class: "exam-group" }, h("h3", {}, title, h("span", { class: "count" }, String(list.length))), h("ul", { class: "recent" }, list.map((e) => row(e, side(e)))));

  return exams.length
      ? h(
          "div",
          { class: "exam-groups" },
          group("Nota lançada", graded, (e) => [
            h(
              "span",
              { class: `grade-pill ${e.pct === null ? "" : e.pct >= pass ? "good" : e.pct >= pass - 0.1 ? "warn" : "bad"}` },
              e.max ? `${num(e.earned!)} / ${num(e.max)}` : num(e.earned!),
            ),
            h("span", { class: "muted small", "data-tip": e.gradedAt ? `Lançada em ${fmtDateTime(e.gradedAt)}` : "" }, e.gradedAt ? `lançada ${fmtRelative(e.gradedAt)}` : pct(e.pct)),
          ]),
          group("Feita, nota não lançada", awaiting, (e) => [h("span", { class: "chip warn" }, "aguardando nota"), h("span", { class: "muted small" }, `prazo ${fmtRelative(e.due!)}`)]),
          group("Próximas provas", upcoming, (e) => [h("span", { class: "chip" }, fmtRelative(e.due!)), h("span", { class: "muted small" }, fmtDateTime(e.due!))]),
          group("Sem data no AVA", undated, () => [h("span", { class: "chip" }, "sem nota")]),
        )
      : h("p", { class: "empty" }, "Nenhum item com nome de prova (Prova, P1, Exame, Avaliação escrita…) no quadro de notas.");
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
