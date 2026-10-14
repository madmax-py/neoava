// Página de uma disciplina.

import type { Assignment, CompletionStatus, GradeItem, Quiz, QuizAttempt, SubmissionStatus } from "../moodle/api";
import { api, ifAvailable, nowS, opts, site, state } from "../state";
import { courseName } from "../data";
import { accumulate, buildMaxIndex, byCategory, CYCLE_MAX, cyclesOf, efficiency, fmtNum, getPassMark, itemMax, passPoints, pointsNeeded, semesterOf, standing, type CycleSummary, type MaxIndex } from "../grades";
import { cycleLegend, cycleSegments, n1, standingChip, standingTone } from "./cycles-ui";
import { cleanGradeHtml, fmtDate, fmtDateTime, fmtRelative, stripHtml } from "../format";
import { shell } from "../layout";
import { card, columnChart, h, legend, modBadge, ring, stackBar, statTile, statusChip } from "../ui";

export async function courseView(id: number, rid: number) {
  const o = opts();
  const uid = site().userid;
  const courses = await api().courses(uid);
  const course = courses.find((c) => c.id === id);
  const [items, assigns, sections, quizzes, completion] = await Promise.all([
    ifAvailable("gradereport_user_get_grade_items", () => api().gradeItems(id, uid, o), []),
    ifAvailable("mod_assign_get_assignments", () => api().assignments([id], o), []),
    ifAvailable("core_course_get_contents", () => api().contents(id, o), []),
    ifAvailable("mod_quiz_get_quizzes_by_courses", () => api().quizzes([id], o), []),
    ifAvailable("core_completion_get_activities_completion_status", () => api().completion(id, uid, o), []),
  ]);
  const doneBy = new Map(completion.map((c) => [c.cmid, c]));
  const tracked = completion.filter((c) => c.hascompletion !== false && c.uservisible !== false);
  const done = tracked.filter(isDone).length;
  const visibleQuizzes = quizzes.filter((q) => q.visible !== false).sort((a, b) => (a.timeclose || Infinity) - (b.timeclose || Infinity));
  const sortedAssigns = [...assigns].sort((a, b) => (a.duedate || Infinity) - (b.duedate || Infinity));
  // Status de cada tarefa/quiz é preenchido depois que a página aparece.
  const assignSlots = new Map(sortedAssigns.map((a) => [a.id, h("div", { class: "status-slot" }, h("span", { class: "chip" }, "…"))]));
  const quizSlots = new Map(visibleQuizzes.map((q) => [q.id, h("div", { class: "status-slot" }, h("span", { class: "chip" }, "…"))]));
  // O quadro de notas do AVA esconde o valor máximo dos itens; recuperamos pela configuração das atividades.
  const idx = buildMaxIndex(assigns, quizzes);
  const acc = accumulate(items, idx);
  // Modelo da instituição: VA1–VA3 de 100 pontos cada, média simples (null se a disciplina não segue).
  const cyc = cyclesOf(items, idx, course);
  const target = passPoints();
  const eff = acc ? efficiency(acc) : null;
  const pass = getPassMark();
  const now = nowS();
  const f = (v: number) => fmtNum(v, 1);

  if (rid !== state.routeId) return; // o usuário já navegou para outra tela
  shell(
    h(
      "div",
      { class: "page-head" },
      h(
        "div",
        {},
        h("p", { class: "eyebrow" }, h("a", { href: "#/disciplinas" }, "← Disciplinas"), course?.startdate ? ` · Semestre ${semesterOf(course.startdate)}` : ""),
        h("h1", {}, course ? courseName(course) : `Disciplina ${id}`),
      ),
      tracked.length
        ? h("div", { class: "head-ring", "data-tip": `Conclusão de atividades\n${done} de ${tracked.length} concluídas` }, ring(done / tracked.length, `${Math.round((done / tracked.length) * 100)}%`, 56), h("span", { class: "small muted" }, `${done}/${tracked.length} atividades`))
        : typeof course?.progress === "number" && ring(course.progress / 100, `${Math.round(course.progress)}%`, 56),
    ),
    cyc
      ? [cycleTiles(cyc, target), cyclesSection(cyc, target)]
      : acc && [
          h(
            "div",
            { class: "tiles" },
            statTile("Aproveitamento", eff === null ? "–" : `${Math.round(eff * 100)}%`, "nas avaliações corrigidas", {
              hero: true,
              tone: eff === null ? undefined : eff >= pass / 10 ? "good" : "bad",
            }),
            statTile("Pontos obtidos", f(acc.earned), `de ${f(acc.earned + acc.lost)} já corrigidos`),
            statTile("Em aberto", f(acc.open), `pts ainda sem nota · total ${f(acc.total)}`),
            statTile("Nota no AVA", acc.courseTotal ?? "–", acc.courseTotal ? "total da disciplina" : "o AVA não mostra o total"),
          ),
          acc.pieces.length > 0 && vaCard(byCategory(items, acc), pass),
        ],
    h(
      "div",
      { class: "dash-grid course" },
      acc &&
        acc.pieces.length > 0 &&
        card(
          h(
            "div",
            { class: "card-title-row" },
            h("h2", {}, "Desempenho por atividade"),
            legend([
              { cls: "s-earned", label: "Corrigida" },
              { cls: "s-open", label: "Sem nota" },
            ]),
          ),
          columnChart(
            acc.pieces.map((p, i) => ({
              label: String(i + 1),
              value: p.pct === null ? null : p.pct * 100,
              tip: `${p.name}\n${p.earned === null ? "Sem nota" : `${fmtNum(p.earned)} de ${fmtNum(p.max)} (${Math.round(p.pct! * 100)}%)`}`,
              cls: p.pct === null ? "" : p.pct >= pass / 10 ? "" : "below",
            })),
            { max: 100, ticks: [0, 50, 100], ref: { value: pass * 10, label: `${pass * 10}%` }, height: 150, fmt: (n) => `${n}%` },
          ),
          h(
            "p",
            { class: "note" },
            "Cada coluna é uma atividade, na ordem do quadro de notas. Passe o mouse para ver o nome.",
            acc.unknown > 0 && ` ${acc.unknown} item(ns) sem valor conhecido não aparecem.`,
          ),
        ),
      card(
        "Notas no AVA",
        items.length
          ? h(
              "table",
              { class: "table" },
              h("thead", {}, h("tr", {}, h("th", {}, "Item"), h("th", { class: "num" }, "Nota"), h("th", { class: "num" }, "Máx."), h("th", { class: "num" }, "%"))),
              h(
                "tbody",
                {},
                items.map((it) =>
                  h(
                    "tr",
                    { class: it.itemtype === "course" ? "total" : it.itemtype === "category" ? "category" : "" },
                    h("td", {}, it.itemtype === "course" ? "Total da disciplina" : (it.itemname ?? "—")),
                    h(
                      "td",
                      { class: "num" },
                      it.gradeformatted || "–",
                      typeof it.passed === "boolean" && [" ", statusChip(it.passed, { ok: "Aprovado", bad: "Reprovado", none: "" })],
                    ),
                    maxCell(it, idx),
                    h("td", { class: "num" }, it.percentageformatted || ""),
                  ),
                ),
              ),
            )
          : h("p", { class: "empty" }, "Sem itens de nota (ou função não liberada para este token)."),
      ),
    ),
    sortedAssigns.length > 0 &&
      card(
        "Tarefas",
        h(
          "ul",
          { class: "events" },
          sortedAssigns.map((a) =>
            h(
              "li",
              { class: `event task${a.duedate && a.duedate < now ? " past" : ""}` },
              h("div", { class: "event-when" }, a.duedate ? [h("strong", {}, fmtRelative(a.duedate)), h("span", {}, fmtDateTime(a.duedate))] : h("span", {}, "sem prazo")),
              h(
                "div",
                { class: "event-body" },
                h("div", { class: "event-title" }, a.name),
                a.intro && h("div", { class: "muted small clamp" }, stripHtml(a.intro)),
                assignSlots.get(a.id),
              ),
            ),
          ),
        ),
      ),
    visibleQuizzes.length > 0 &&
      card(
        "Questionários",
        h(
          "ul",
          { class: "events" },
          visibleQuizzes.map((q) =>
            h(
              "li",
              { class: "event task" },
              h(
                "div",
                { class: "event-when" },
                q.timeclose ? [h("strong", {}, q.timeclose < now ? "encerrado" : `fecha ${fmtRelative(q.timeclose)}`), h("span", {}, fmtDateTime(q.timeclose))] : h("span", {}, "sem prazo"),
              ),
              h(
                "div",
                { class: "event-body" },
                h("div", { class: "event-title" }, q.name),
                h(
                  "div",
                  { class: "muted small" },
                  `vale ${fmtNum(q.grade, 1)}`,
                  q.attempts ? ` · ${q.attempts} tentativa(s) permitida(s)` : " · tentativas ilimitadas",
                  q.timelimit ? ` · ${Math.round(q.timelimit / 60)} min` : "",
                ),
                quizSlots.get(q.id),
              ),
            ),
          ),
        ),
      ),
    sections.length > 0 &&
      card(
        "Conteúdo",
        sections
          .filter((sec) => sec.uservisible !== false && (sec.modules.length || sec.summary))
          .map((sec) =>
            h(
              "details",
              { class: "section" },
              h(
                "summary",
                {},
                sec.name || `Seção ${sec.section}`,
                h("span", { class: "count" }, sectionCount(sec.modules.map((m) => doneBy.get(m.id)), sec.modules.length)),
              ),
              sec.summary && h("p", { class: "muted small" }, stripHtml(sec.summary)),
              h(
                "ul",
                { class: "modules" },
                sec.modules
                  .filter((m) => m.uservisible !== false)
                  .map((m) =>
                    h(
                      "li",
                      { class: doneBy.get(m.id) && isDone(doneBy.get(m.id)!) ? "done" : "" },
                      completionMark(doneBy.get(m.id)),
                      modBadge(m.modname),
                      m.url && /^https?:\/\//i.test(m.url) ? h("a", { href: m.url, target: "_blank", rel: "noreferrer" }, m.name) : h("span", {}, m.name),
                      m.dates?.map((d) => h("span", { class: "muted small" }, ` · ${d.label} ${fmtDate(d.timestamp)}`)),
                      m.modname === "resource" &&
                        m.contents
                          ?.filter((x) => x.type === "file")
                          .map((x) => h("a", { href: state.client!.fileUrl(x.fileurl), target: "_blank", rel: "noreferrer", class: "file" }, `⬇ ${x.filename}`)),
                    ),
                  ),
              ),
            ),
          ),
      ),
  );

  // Uma chamada por tarefa/quiz (cache de 15–20 min, no máximo 2 simultâneas no cliente).
  if (state.available.has("mod_assign_get_submission_status")) {
    for (const a of sortedAssigns) {
      api()
        .submissionStatus(a.id, o)
        .then((st) => rid === state.routeId && assignSlots.get(a.id)!.replaceChildren(...assignStatus(a, st, now)))
        .catch(() => rid === state.routeId && assignSlots.get(a.id)!.replaceChildren(h("span", { class: "chip" }, "status indisponível")));
    }
  } else assignSlots.forEach((el) => el.remove());

  if (state.available.has("mod_quiz_get_user_quiz_attempts")) {
    for (const q of visibleQuizzes) {
      quizStatus(q, uid, now, o)
        .then((els) => rid === state.routeId && quizSlots.get(q.id)!.replaceChildren(...els))
        .catch(() => rid === state.routeId && quizSlots.get(q.id)!.replaceChildren(h("span", { class: "chip" }, "status indisponível")));
    }
  } else quizSlots.forEach((el) => el.remove());
}

function cycleTiles(cy: CycleSummary, target: number) {
  const need = pointsNeeded(cy, target);
  const remaining = cy.cycles.reduce((a, c) => a + (CYCLE_MAX - c.earned - c.lost), 0);
  const st = standing(cy, target);
  return h(
    "div",
    { class: "tiles" },
    statTile("Média projetada", cy.projected === null ? "–" : n1(cy.projected), h("span", {}, standingChip(cy, target), cy.efficiency !== null ? ` aproveitamento ${Math.round(cy.efficiency * 100)}%` : ""), {
      hero: true,
      tone: standingTone(cy, target) === "bad" ? "bad" : undefined,
    }),
    statTile("Média garantida", n1(cy.secured), "com os pontos que você já tem (÷ 3)"),
    statTile("Máximo possível", n1(cy.maxPossible), "tirando nota máxima em tudo que falta"),
    statTile(
      `Para média ${n1(target)}`,
      need > 0 ? `${n1(need)} pts` : "✓",
      need > 0
        ? st === "impossible"
          ? "não dá mais para alcançar"
          : `dos ${n1(remaining)} que ainda podem ser ganhos (${Math.round((need / remaining) * 100)}%)`
        : "média mínima já garantida",
      { tone: st === "impossible" ? "bad" : need === 0 ? "good" : undefined },
    ),
  );
}

/** Os três ciclos lado a lado. */
function cyclesSection(cy: CycleSummary, target: number) {
  return card(
    h("div", { class: "card-title-row" }, h("h2", {}, `Ciclos (${CYCLE_MAX} pontos cada)`), cycleLegend()),
    h(
      "div",
      { class: "cycles-row" },
      cy.cycles.map((c, i) =>
        h(
          "div",
          { class: `cycle-card${i === cy.current ? " current" : ""}` },
          h("h3", {}, c.label, i === cy.current ? h("span", { class: "chip grade" }, "em andamento") : c.avaGrade ? h("span", { class: "chip grade", "data-tip": "Nota do ciclo no AVA" }, `AVA: ${c.avaGrade}`) : null),
          h("div", { class: "cycle-big" }, n1(c.earned), h("small", {}, ` / ${CYCLE_MAX}`)),
          cycleSegments(c),
          h(
            "div",
            { class: "cycle-lines" },
            h("span", {}, `Perdido ${n1(c.lost)} · em aberto ${n1(c.open)}${c.openUnknown ? ` (+${c.openUnknown} sem valor)` : ""}`),
            h("span", {}, c.notReleased > 0 ? `${n1(c.notReleased)} pts ainda não lançados em atividades` : "Todos os pontos já foram lançados"),
            h("span", {}, `${c.graded} de ${c.items} atividade(s) com nota`),
          ),
        ),
      ),
    ),
    cy.loose.count > 0 &&
      h(
        "p",
        { class: "note" },
        `⚠ ${cy.loose.count} atividade(s) ainda fora de qualquer ciclo no AVA (provavelmente serão do próximo): ${cy.loose.names.slice(0, 4).join(", ")}${cy.loose.count > 4 ? "…" : ""}. Não entram na conta.`,
      ),
    h("p", { class: "note" }, `Média final = (${cy.cycles.map((c) => c.label).join(" + ")}) ÷ 3. Notas lançadas somam direto no ciclo, até ${CYCLE_MAX}.`),
  );
}

/** Quanto já foi obtido/perdido/está em aberto em cada VA (categoria do quadro de notas). */
function vaCard(cats: ReturnType<typeof byCategory>, pass: number) {
  if (cats.length < 2) return null;
  const f = (v: number) => fmtNum(v, 1);
  return card(
    h(
      "div",
      { class: "card-title-row" },
      h("h2", {}, "Por avaliação (VA)"),
      legend([
        { cls: "s-earned", label: "Obtido" },
        { cls: "s-lost", label: "Perdido" },
        { cls: "s-open", label: "Em aberto" },
      ]),
    ),
    h(
      "div",
      { class: "acc-list" },
      cats.map((c) => {
        const eff = efficiency(c);
        return h(
          "div",
          { class: "acc-row" },
          h("span", { class: "acc-name" }, c.name, c.avaGrade && h("span", { class: "chip grade va-grade", "data-tip": "Nota desta VA no AVA" }, c.avaGrade)),
          c.total > 0
            ? stackBar(
                [
                  { value: c.earned, cls: "s-earned", tip: `${c.name}\nObtido: ${f(c.earned)} pts` },
                  { value: c.lost, cls: "s-lost", tip: `${c.name}\nPerdido: ${f(c.lost)} pts` },
                  { value: c.open, cls: "s-open", tip: `${c.name}\nEm aberto: ${f(c.open)} pts` },
                ],
                c.total,
              )
            : h("div", { class: "muted small" }, "itens sem valor conhecido"),
          h(
            "div",
            { class: "acc-val" },
            eff === null ? h("span", { class: "muted small" }, c.total ? "sem nota" : "") : h("span", { class: `eff ${eff >= pass / 10 ? "good" : "bad"}` }, `${Math.round(eff * 100)}%`),
            h("div", { class: "small muted" }, c.total ? `${f(c.earned)} / ${f(c.total)} pts` : "", c.unknown ? ` · +${c.unknown} sem valor` : ""),
          ),
        );
      }),
    ),
    h("p", { class: "note" }, "Soma dos valores das atividades de cada VA. Se a VA tiver pesos ou teto, a nota oficial pode ser diferente."),
  );
}

function maxCell(it: GradeItem, idx: MaxIndex) {
  if (it.itemtype !== "mod" && it.itemtype !== "manual") return h("td", { class: "num" }, it.grademax ?? "");
  const mx = itemMax(it, idx);
  if (!mx) return h("td", { class: "num muted", "data-tip": "O AVA não informa o valor deste item" }, "?");
  return h("td", { class: "num", "data-tip": mx.fromActivity ? "Valor tirado da configuração da atividade (o quadro de notas do AVA não mostra)" : "" }, fmtNum(mx.max, mx.max % 1 ? 2 : 0), mx.fromActivity && h("span", { class: "from-act" }, "*"));
}

function isDone(c: CompletionStatus) {
  return c.state === 1 || c.state === 2 || c.state === 3;
}

function completionMark(c?: CompletionStatus) {
  if (!c || c.hascompletion === false) return h("span", { class: "check none" });
  if (c.state === 3) return h("span", { class: "check fail", "data-tip": "Concluída, mas sem atingir a nota mínima" }, "!");
  if (isDone(c)) return h("span", { class: "check ok", "data-tip": c.timecompleted ? `Concluída em ${fmtDateTime(c.timecompleted)}` : "Concluída" }, "✓");
  return h("span", { class: "check todo", "data-tip": "Não concluída" });
}

function sectionCount(states: (CompletionStatus | undefined)[], total: number) {
  const tracked = states.filter((c): c is CompletionStatus => !!c && c.hascompletion !== false);
  return tracked.length ? `${tracked.filter(isDone).length}/${tracked.length}` : String(total);
}

function assignStatus(a: Assignment, st: SubmissionStatus, now: number): HTMLElement[] {
  const la = st.lastattempt;
  const sub = la?.submission ?? la?.teamsubmission;
  const due = la?.extensionduedate || a.duedate;
  const out: HTMLElement[] = [];

  if (la?.submissionsenabled === false) out.push(h("span", { class: "chip" }, "Sem envio pelo AVA"));
  else if (sub?.status === "submitted") out.push(h("span", { class: "chip good" }, "✓ Enviada", sub.timemodified ? ` ${fmtDate(sub.timemodified)}` : ""));
  else if (sub?.status === "draft") out.push(h("span", { class: "chip warn" }, "⏱ Rascunho, não enviado"));
  else if (a.allowsubmissionsfromdate && a.allowsubmissionsfromdate > now) out.push(h("span", { class: "chip" }, `Abre ${fmtDateTime(a.allowsubmissionsfromdate)}`));
  else if (due && due < now) out.push(h("span", { class: "chip bad" }, "✕ Não enviada"));
  else out.push(h("span", { class: "chip" }, "Não enviada"));

  if (la?.extensionduedate) out.push(h("span", { class: "chip" }, `Prorrogada até ${fmtDateTime(la.extensionduedate)}`));

  const grade = cleanGradeHtml(st.feedback?.gradefordisplay).text;
  if (grade && grade !== "-") out.push(h("span", { class: "chip grade" }, `Nota ${grade}`));
  else if (sub?.status === "submitted" && la?.gradingstatus === "notgraded") out.push(h("span", { class: "chip" }, "Aguardando correção"));

  const comment = st.feedback?.plugins?.find((p) => p.type === "comments")?.editorfields?.map((f) => stripHtml(f.text)).join(" ").trim();
  if (comment) out.push(h("details", { class: "feedback" }, h("summary", {}, "Comentário do professor"), h("p", {}, comment)));
  return out;
}

async function quizStatus(q: Quiz, uid: number, now: number, o: { refresh: boolean }): Promise<HTMLElement[]> {
  const attempts: QuizAttempt[] = await api().quizAttempts(q.id, uid, o);
  const finished = attempts.filter((a) => a.state === "finished");
  const open = attempts.find((a) => a.state === "inprogress" || a.state === "overdue");
  const out: HTMLElement[] = [];

  if (open) out.push(h("span", { class: "chip warn" }, "⏱ Tentativa em andamento"));
  else if (finished.length) out.push(h("span", { class: "chip good" }, "✓ Feito"));
  else if (q.timeclose && q.timeclose < now) out.push(h("span", { class: "chip bad" }, "✕ Não feito"));
  else out.push(h("span", { class: "chip" }, "Não iniciado"));

  if (attempts.length) out.push(h("span", { class: "chip" }, `${attempts.length}${q.attempts ? ` de ${q.attempts}` : ""} tentativa(s)`));

  if (finished.length && state.available.has("mod_quiz_get_user_best_grade")) {
    const best = await api().quizBestGrade(q.id, uid, o);
    const dp = Math.min(2, q.decimalpoints ?? 2);
    if (best.hasgrade && typeof best.grade === "number") {
      const ok = best.gradetopass ? best.grade >= best.gradetopass : null;
      out.push(
        h(
          "span",
          { class: `chip grade${ok === false ? " bad" : ""}`, "data-tip": best.gradetopass ? `Nota para aprovação: ${fmtNum(best.gradetopass, dp)}` : "" },
          `Nota ${fmtNum(best.grade, dp)} / ${fmtNum(q.grade, dp)}`,
        ),
      );
    } else out.push(h("span", { class: "chip" }, "Nota ainda não liberada"));
  }
  return out;
}

