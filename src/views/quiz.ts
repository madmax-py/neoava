// Questionários: página do quiz (regras, tentativas, iniciar) e página de uma tentativa
// (responder, revisar antes de enviar, ou ver a revisão da tentativa finalizada).
//
// Escrita no AVA só acontece aqui, e só com as funções de WRITE_FUNCTIONS do cliente:
// - iniciar e enviar pedem confirmação explícita;
// - as respostas são salvas automaticamente enquanto você responde (como o AVA faz no navegador);
// - se o tempo acabar com a página aberta, a tentativa é enviada (como o AVA faz no navegador).

//
// Este arquivo tem a página do questionário; a tentativa fica em quiz-attempt.ts.

import type { AttemptAccess, QuizAttempt } from "../moodle/api";
import { MoodleError } from "../moodle/client";
import { api, ifAvailable, nowS, opts, site, state } from "../state";
import { courseName } from "../data";
import { fmtNum } from "../grades";
import { fmtDateTime, fmtRelative, stripHtml } from "../format";
import { shell } from "../layout";
import { NEEDS_MOODLE_JS } from "../question-html";
import { card, confirmDialog, h, statTile } from "../ui";
import {
  attemptHref,
  QTYPES,
  canAnswer,
  canStart,
  BLOCKING_RULES,
  passwords,
  withPassword,
  loadQuiz,
  scaled,
  attemptState,
  head,
  errMsg,
  refreshAttempts,
} from "./quiz-shared";

// ---------- Página do questionário ----------

export async function quizPage(cid: number, qid: number, rid: number) {
  const o = opts();
  const uid = site().userid;
  const { course, quiz } = await loadQuiz(cid, qid);
  // Do cache (na hora); se estiver vencido, a versão nova chega em segundo plano e a tela se atualiza.
  // O AVA confere tudo de novo ao iniciar, então um dado velho aqui no máximo vira uma mensagem de erro.
  const [attempts, access, qtypes, best] = await Promise.all([
    ifAvailable("mod_quiz_get_user_quiz_attempts", () => api().quizAttempts(qid, uid, o), [] as QuizAttempt[]),
    ifAvailable("mod_quiz_get_quiz_access_information", () => api().quizAccess(qid, o), null),
    ifAvailable("mod_quiz_get_quiz_required_qtypes", () => api().quizQtypes(qid, o), [] as string[]),
    ifAvailable("mod_quiz_get_user_best_grade", () => api().quizBestGrade(qid, uid, o), null),
  ]);
  const open = attempts.find((a) => a.state === "inprogress" || a.state === "overdue");
  const attAccess = await ifAvailable(
    "mod_quiz_get_attempt_access_information",
    () => api().attemptAccess(qid, open?.id ?? 0, o),
    null as AttemptAccess | null,
  );
  if (rid !== state.routeId) return;

  const now = nowS();
  const dp = Math.min(2, quiz.decimalpoints ?? 2);
  const used = attempts.filter((a) => a.state !== "abandoned").length;
  const cname = course ? courseName(course) : `Disciplina ${cid}`;
  const canReview = access?.canreviewmyattempts !== false;
  const blockingRule = access?.activerulenames.find((n) => BLOCKING_RULES.test(n));
  const hasPassword = !!access?.activerulenames.some((n) => /password/.test(n));
  const unanswerable = qtypes.filter((t) => NEEDS_MOODLE_JS.has(t));
  const blockers = [...(access?.preventaccessreasons ?? []), ...(attAccess?.preventnewattemptreasons ?? [])];
  const startable = !open && !!access?.canattempt && blockers.length === 0 && !blockingRule && canStart();

  const start = async (btn: HTMLButtonElement) => {
    const r = await confirmDialog({
      title: `Iniciar a tentativa ${used + 1}?`,
      body: [
        h(
          "ul",
          {},
          h("li", {}, quiz.attempts ? `Ela conta no limite: será a ${used + 1}ª de ${quiz.attempts}.` : "Tentativas ilimitadas."),
          quiz.timelimit
            ? h("li", {}, h("strong", {}, `O tempo de ${Math.round(quiz.timelimit / 60)} min começa agora`), " e continua correndo mesmo se você fechar a página.")
            : h("li", {}, "Sem tempo limite."),
          h("li", {}, "As respostas são salvas no AVA automaticamente. Nada vai para correção até você clicar em Enviar."),
          quiz.timelimit && h("li", {}, "Se o tempo acabar com esta página aberta, a tentativa é enviada automaticamente, como no AVA."),
          unanswerable.length > 0 && h("li", {}, `Há questões de arrastar/ordenar (${unanswerable.map((t) => QTYPES[t] ?? t).join(", ")}) que só podem ser respondidas no AVA.`),
        ),
      ],
      confirmLabel: "Iniciar tentativa",
      password: hasPassword && !passwords.has(qid) ? { label: "Senha do questionário" } : undefined,
    });
    if (!r.ok) return;
    if (r.password) passwords.set(qid, r.password);
    btn.disabled = true;
    btn.textContent = "Iniciando…";
    try {
      const a = await withPassword(qid, (pre) => api().startAttempt(qid, pre));
      await refreshAttempts(qid);
      location.hash = attemptHref(cid, qid, a.id);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Iniciar tentativa";
      startMsg.replaceChildren(h("div", { class: "error" }, `Não foi possível iniciar: ${errMsg(e)}`));
      // Pode ter sido criada em outro lugar (AVA/app): recarrega a lista.
      if (e instanceof MoodleError && e.errorcode === "attemptstillinprogress") state.route();
    }
  };
  const startMsg = h("div", {});
  const startBtn: HTMLButtonElement = h("button", { class: "primary", onclick: () => start(startBtn) }, "Iniciar tentativa");

  shell(
    head(
      { id: cid, name: cname },
      quiz.name,
      open && canAnswer()
        ? h("a", { href: attemptHref(cid, qid, open.id), class: "button primary-link" }, open.state === "overdue" ? "Ver tentativa →" : "Continuar tentativa →")
        : startable
          ? startBtn
          : null,
    ),
    startMsg,
    h(
      "div",
      { class: "tiles" },
      statTile(
        "Nota",
        best?.hasgrade && typeof best.grade === "number" ? fmtNum(best.grade, dp) : "–",
        `de ${fmtNum(quiz.grade, dp)}${best?.gradetopass ? ` · aprovação ${fmtNum(best.gradetopass, dp)}` : ""}`,
        { hero: true, tone: best?.hasgrade && best.gradetopass && typeof best.grade === "number" ? (best.grade >= best.gradetopass ? "good" : "bad") : undefined },
      ),
      statTile("Tentativas", `${used}${quiz.attempts ? ` / ${quiz.attempts}` : ""}`, quiz.attempts ? `${Math.max(0, quiz.attempts - used)} restante(s)` : "ilimitadas"),
      statTile(
        quiz.timeclose && quiz.timeclose < now ? "Encerrou" : "Fecha",
        quiz.timeclose ? fmtRelative(quiz.timeclose) : "sem prazo",
        quiz.timeclose ? fmtDateTime(quiz.timeclose) : quiz.timeopen ? `abriu ${fmtDateTime(quiz.timeopen)}` : undefined,
      ),
      statTile("Tempo limite", quiz.timelimit ? `${Math.round(quiz.timelimit / 60)} min` : "–", quiz.timelimit ? "conta a partir do início da tentativa" : "sem tempo limite"),
    ),
    quiz.intro && stripHtml(quiz.intro) && card("Descrição", h("p", { class: "muted" }, stripHtml(quiz.intro))),
    card(
      "Tentativas",
      attempts.length
        ? h(
            "ul",
            { class: "events" },
            attempts.map((a) => {
              const g = scaled(a, quiz);
              const isOpen = a.state === "inprogress" || a.state === "overdue";
              const link = isOpen ? (canAnswer() && a.state === "inprogress" ? "Continuar →" : "Ver questões →") : a.state === "finished" && canReview ? "Revisão →" : null;
              return h(
                "li",
                { class: `event task${isOpen ? " soon" : ""}` },
                h("div", { class: "event-when" }, h("strong", {}, fmtRelative(a.timestart)), h("span", {}, fmtDateTime(a.timestart))),
                h(
                  "div",
                  { class: "event-body" },
                  h("div", { class: "event-title" }, link ? h("a", { href: attemptHref(cid, qid, a.id), class: "event-link" }, `Tentativa ${a.attempt}`) : `Tentativa ${a.attempt}`),
                  h(
                    "div",
                    { class: "status-slot" },
                    attemptState(a),
                    g !== null && h("span", { class: "chip grade" }, `Nota ${fmtNum(g, dp)} / ${fmtNum(quiz.grade, dp)}`),
                    a.timefinish ? h("span", { class: "chip" }, `Enviada ${fmtDateTime(a.timefinish)}`) : null,
                    link && h("a", { href: attemptHref(cid, qid, a.id), class: "small" }, link),
                  ),
                ),
              );
            }),
          )
        : h("p", { class: "empty" }, "Nenhuma tentativa ainda."),
      open && quiz.timelimit && attAccess?.endtime
        ? h("p", { class: "note" }, `A tentativa em andamento expira ${fmtRelative(attAccess.endtime)} (${fmtDateTime(attAccess.endtime)}). O tempo corre mesmo com a página fechada.`)
        : null,
      blockingRule &&
        h("p", { class: "note" }, "⚠ Este questionário exige Safe Exam Browser, rede específica ou outra regra que só o AVA cumpre. Faça-o pelo AVA."),
      !canStart() && h("p", { class: "note" }, "Seu token não tem as funções de fazer questionário; esta tela fica somente leitura."),
    ),
    h(
      "div",
      { class: "dash-grid course" },
      card(
        "Regras de acesso",
        access
          ? [
              h(
                "div",
                { class: "status-slot" },
                access.canattempt ? h("span", { class: "chip good" }, "✓ Você pode fazer este questionário") : h("span", { class: "chip bad" }, "✕ Sem permissão para tentar"),
                access.canreviewmyattempts ? h("span", { class: "chip" }, "Revisão permitida") : h("span", { class: "chip" }, "Sem revisão"),
              ),
              access.preventaccessreasons.length > 0 &&
                h("div", { class: "error" }, h("strong", {}, "O AVA está bloqueando o acesso agora:"), h("ul", {}, access.preventaccessreasons.map((r) => h("li", {}, stripHtml(r))))),
              attAccess && attAccess.preventnewattemptreasons.length > 0 &&
                h("div", { class: "notice" }, h("strong", {}, "Nova tentativa bloqueada:"), h("ul", {}, attAccess.preventnewattemptreasons.map((r) => h("li", {}, stripHtml(r))))),
              access.accessrules.length
                ? h("ul", { class: "rules" }, access.accessrules.map((r) => h("li", {}, stripHtml(r))))
                : h("p", { class: "empty" }, "Nenhuma regra especial."),
            ]
          : h("p", { class: "empty" }, "Informação não liberada para este token."),
      ),
      card(
        "Tipos de questão",
        qtypes.length
          ? [
              h(
                "div",
                { class: "status-slot" },
                qtypes.map((t) => h("span", { class: `chip${NEEDS_MOODLE_JS.has(t) ? " warn" : ""}`, "data-tip": t }, QTYPES[t] ?? t)),
              ),
              unanswerable.length > 0 && h("p", { class: "note" }, "Tipos em amarelo (arrastar, ordenar) dependem do AVA: essas questões ficam para responder lá."),
            ]
          : h("p", { class: "empty" }, "O AVA não informou os tipos."),
      ),
    ),
  );
}
