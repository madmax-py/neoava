// Questionários: página do quiz (regras e tentativas) e página de uma tentativa (questões ou revisão).
// Somente leitura: nada aqui inicia, salva, navega ou envia tentativa no AVA.

import type { AttemptAccess, Quiz, QuizAttempt, QuizQuestion } from "../moodle/api";
import { api, ifAvailable, nowS, opts, site, state } from "../state";
import { courseName } from "../data";
import { fmtNum } from "../grades";
import { fmtDateTime, fmtRelative, stripHtml } from "../format";
import { shell } from "../layout";
import { questionFields, renderQuestionHtml } from "../question-html";
import { card, h, statTile, type Child } from "../ui";

const quizHref = (cid: number, qid: number) => `#/disciplina/${cid}/questionario/${qid}`;
const attemptHref = (cid: number, qid: number, aid: number, page?: number) =>
  `${quizHref(cid, qid)}/tentativa/${aid}${page !== undefined ? `/pagina/${page + 1}` : ""}`;

const QTYPES: Record<string, string> = {
  multichoice: "Múltipla escolha",
  truefalse: "Verdadeiro/falso",
  shortanswer: "Resposta curta",
  numerical: "Numérica",
  essay: "Dissertativa",
  match: "Associação",
  randomsamatch: "Associação (aleatória)",
  gapselect: "Lacunas (seleção)",
  ddwtos: "Arrastar para o texto",
  ddimageortext: "Arrastar para imagem",
  ddmarker: "Marcadores na imagem",
  multianswer: "Respostas embutidas (Cloze)",
  calculated: "Calculada",
  calculatedsimple: "Calculada simples",
  calculatedmulti: "Calculada (múltipla escolha)",
  description: "Descrição (sem resposta)",
  random: "Aleatória",
  ordering: "Ordenação",
};
/** Tipos cujos campos o app já entende bem (para a futura etapa de responder). */
const SIMPLE_QTYPES = new Set(["multichoice", "truefalse", "shortanswer", "numerical", "essay", "description", "match", "gapselect"]);

async function loadQuiz(cid: number, qid: number) {
  const o = opts();
  const [courses, quizzes] = await Promise.all([api().courses(site().userid), api().quizzes([cid], o)]);
  const course = courses.find((c) => c.id === cid);
  const quiz = quizzes.find((q) => q.id === qid);
  if (!quiz) throw new Error("Questionário não encontrado nesta disciplina (ou não está visível para você).");
  return { course, quiz };
}

function scaled(a: QuizAttempt, q: Quiz): number | null {
  if (a.sumgrades === null || a.sumgrades === undefined || !q.sumgrades) return null;
  return (a.sumgrades / q.sumgrades) * q.grade;
}

function attemptState(a: QuizAttempt) {
  switch (a.state) {
    case "inprogress":
      return h("span", { class: "chip warn" }, "⏱ Em andamento");
    case "overdue":
      return h("span", { class: "chip bad", "data-tip": "O tempo acabou; o AVA ainda aceita o envio por um período de tolerância" }, "⚠ Tempo esgotado");
    case "finished":
      return h("span", { class: "chip good" }, "✓ Finalizada");
    case "abandoned":
      return h("span", { class: "chip bad", "data-tip": "Não foi enviada a tempo e não conta nota" }, "✕ Abandonada");
    default:
      return h("span", { class: "chip" }, a.state);
  }
}

/** Número de páginas da tentativa, pelo layout ("1,2,0,3,0" = 2 páginas). */
function pageCount(a: QuizAttempt): number | null {
  if (!a.layout) return null;
  const zeros = a.layout.split(",").filter((x) => x.trim() === "0").length;
  return Math.max(1, zeros);
}

function head(course: { id: number; name: string }, title: string, aside?: Child, back?: { href: string; label: string }) {
  return h(
    "div",
    { class: "page-head" },
    h(
      "div",
      {},
      h("p", { class: "eyebrow" }, h("a", { href: back?.href ?? `#/disciplina/${course.id}` }, `← ${back?.label ?? course.name}`)),
      h("h1", {}, title),
    ),
    aside,
  );
}

const readOnlyNote = () =>
  h(
    "p",
    { class: "note" },
    "Somente leitura: esta tela não inicia, salva nem envia tentativas. Para responder, use o AVA ou o app oficial do Moodle.",
  );

// ---------- Página do questionário ----------

export async function quizPage(cid: number, qid: number, rid: number) {
  const o = opts();
  const uid = site().userid;
  const { course, quiz } = await loadQuiz(cid, qid);
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

  shell(
    head({ id: cid, name: cname }, quiz.name),
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
              const link = isOpen ? "Ver questões →" : a.state === "finished" && canReview ? "Revisão →" : null;
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
      readOnlyNote(),
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
              access.activerulenames.some((n) => /seb|safebrowser|ipaddress|password/.test(n)) &&
                h(
                  "p",
                  { class: "note" },
                  "⚠ Este questionário tem regra de senha, rede ou Safe Exam Browser. Um front próprio pode não conseguir abrir tentativas nele.",
                ),
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
                qtypes.map((t) => h("span", { class: `chip${SIMPLE_QTYPES.has(t) ? "" : " warn"}`, "data-tip": t }, QTYPES[t] ?? t)),
              ),
              qtypes.some((t) => !SIMPLE_QTYPES.has(t)) &&
                h("p", { class: "note" }, "Tipos em amarelo usam campos mais elaborados (arrastar, embutidos…). Confira o inventário de campos ao abrir uma tentativa."),
            ]
          : h("p", { class: "empty" }, "O AVA não informou os tipos."),
      ),
    ),
  );
}

// ---------- Página de uma tentativa ----------

export async function attemptPage(cid: number, qid: number, aid: number, pageParam: number | null, rid: number) {
  const o = opts();
  const uid = site().userid;
  const { course, quiz } = await loadQuiz(cid, qid);
  const attempts = await api().quizAttempts(qid, uid, o);
  const attempt = attempts.find((a) => a.id === aid);
  if (!attempt) throw new Error("Tentativa não encontrada (use “Atualizar dados” se ela acabou de ser criada no AVA).");
  const cname = course ? courseName(course) : `Disciplina ${cid}`;
  const back = { href: quizHref(cid, qid), label: quiz.name };
  const title = `Tentativa ${attempt.attempt}`;

  if (attempt.state === "finished") return reviewView(cid, aid, rid, { cname, back, title });
  if (attempt.state === "abandoned") {
    if (rid !== state.routeId) return;
    return shell(head({ id: cid, name: cname }, title, attemptState(attempt), back), card("Tentativa abandonada", h("p", { class: "empty" }, "Esta tentativa não foi enviada a tempo e não tem questões para mostrar.")));
  }

  const access = await ifAvailable("mod_quiz_get_attempt_access_information", () => api().attemptAccess(qid, aid, o), null as AttemptAccess | null);
  const now = nowS();
  const expired = attempt.state === "overdue" || (!!access?.endtime && access.endtime < now);
  const free = quiz.navmethod === "free";
  const current = attempt.currentpage ?? 0;
  const pages = pageCount(attempt);
  // Navegação sequencial: o AVA só deixa ler a página atual (e pedir outra daria erro).
  const page = free && pageParam !== null ? pageParam : current;

  const headEl = head({ id: cid, name: cname }, title, h("div", { class: "status-slot" }, attemptState(attempt), access?.endtime ? countdown(access.endtime) : null), back);
  const body = h("div", {});

  const load = async () => {
    body.replaceChildren(card("Carregando questões…", h("div", { class: "skeleton" }, h("div", {}), h("div", {}), h("div", {}))));
    try {
      const data = await api().attemptData(aid, page);
      if (rid !== state.routeId) return;
      body.replaceChildren(
        h(
          "div",
          { class: "q-list" },
          data.messages.length > 0 ? h("div", { class: "notice" }, data.messages.map((m) => h("p", {}, stripHtml(m)))) : null,
        pager(cid, qid, aid, page, pages, free, current),
        data.questions.map((q) => questionCard(q, "attempt")),
        data.questions.length === 0 && card("Página vazia", h("p", { class: "empty" }, "Nenhuma questão nesta página.")),
          pager(cid, qid, aid, page, pages, free, current),
        ),
      );
    } catch (e) {
      if (rid !== state.routeId) return;
      body.replaceChildren(h("div", { class: "error" }, `Não foi possível ler as questões: ${(e as Error).message}`), h("button", { onclick: load }, "Tentar de novo"));
    }
  };

  if (rid !== state.routeId) return;
  shell(
    headEl,
    h(
      "div",
      { class: "notice" },
      h("strong", {}, "Visualização somente leitura. "),
      "Os campos estão desativados e nada é salvo. O que já estiver marcado é a resposta salva no AVA.",
      !free && ` Este questionário usa navegação sequencial: o AVA só mostra a página atual${pages ? ` (${current + 1} de ${pages})` : ""}.`,
    ),
    body,
  );

  if (expired) {
    // Abrir uma tentativa vencida faz o AVA processar o fim do tempo (enviar ou abandonar),
    // o que aconteceria de qualquer forma — mas só com um clique explícito.
    body.replaceChildren(
      card(
        "Tempo esgotado",
        h(
          "p",
          {},
          "O tempo desta tentativa acabou. Ao ler as questões, o AVA pode finalizar ou abandonar a tentativa automaticamente (o mesmo que aconteceria na próxima vez que você a abrisse no AVA).",
        ),
        h("button", { onclick: load }, "Carregar mesmo assim"),
      ),
    );
  } else await load();
}

async function reviewView(cid: number, aid: number, rid: number, ctx: { cname: string; back: { href: string; label: string }; title: string }) {
  const review = await api().attemptReview(aid, opts());
  if (rid !== state.routeId) return;
  shell(
    head({ id: cid, name: ctx.cname }, ctx.title, h("div", { class: "status-slot" }, attemptState(review.attempt), review.grade && h("span", { class: "chip grade" }, `Nota ${review.grade}`)), ctx.back),
    review.additionaldata.length > 0 &&
      card(
        "Resumo",
        h(
          "table",
          { class: "table kv" },
          h("tbody", {}, review.additionaldata.map((d) => h("tr", {}, h("th", {}, stripHtml(d.title)), h("td", {}, stripHtml(d.content))))),
        ),
      ),
    review.questions.length
      ? review.questions.map((q) => questionCard(q, "review"))
      : card("Revisão", h("p", { class: "empty" }, "As opções de revisão deste questionário não mostram as questões agora.")),
    h("p", { class: "note" }, "O que aparece na revisão (respostas certas, feedback, nota) segue as opções definidas pelo professor no AVA."),
  );
}

/** Cronômetro até o fim do tempo da tentativa (atualiza sozinho enquanto a página está aberta). */
function countdown(end: number) {
  const el = h("span", { class: "chip", "data-tip": `Expira em ${fmtDateTime(end)}` });
  const tick = () => {
    const left = Math.round(end - Date.now() / 1000);
    if (!el.isConnected && el.dataset.started) return clearInterval(timer);
    el.dataset.started = "1";
    if (left <= 0) {
      el.className = "chip bad";
      el.textContent = "⏱ Tempo esgotado";
      return clearInterval(timer);
    }
    const hh = Math.floor(left / 3600);
    const mm = Math.floor((left % 3600) / 60);
    const ss = left % 60;
    el.className = `chip ${left < 300 ? "bad" : "warn"}`;
    el.textContent = `⏱ ${hh ? `${hh}h ` : ""}${String(mm).padStart(hh ? 2 : 1, "0")}min ${String(ss).padStart(2, "0")}s`;
  };
  const timer = setInterval(tick, 1000);
  tick();
  return el;
}

function pager(cid: number, qid: number, aid: number, page: number, pages: number | null, free: boolean, current: number) {
  if (!pages || pages < 2) return null;
  return h(
    "nav",
    { class: "pager", "aria-label": "Páginas da tentativa" },
    h("span", { class: "muted small" }, "Página"),
    Array.from({ length: pages }, (_, i) =>
      free
        ? h("a", { href: attemptHref(cid, qid, aid, i), class: `page-link${i === page ? " active" : ""}`, "aria-current": i === page ? "page" : undefined }, String(i + 1))
        : h("span", { class: `page-link${i === page ? " active" : " locked"}`, "data-tip": i === current ? "Página atual da tentativa" : "Navegação sequencial: só a página atual pode ser lida" }, String(i + 1)),
    ),
  );
}

function questionState(q: QuizQuestion, mode: "attempt" | "review") {
  const st = q.state ?? "";
  const tone = /gradedright/.test(st) ? "good" : /gradedwrong|gaveup/.test(st) ? "bad" : /gradedpartial|invalid/.test(st) ? "warn" : st === "complete" ? "good" : "";
  const label = q.status || (mode === "attempt" ? (st === "complete" ? "Respondida" : "Ainda não respondida") : st);
  return label ? h("span", { class: `chip${tone ? ` ${tone}` : ""}` }, label) : null;
}

function questionCard(q: QuizQuestion, mode: "attempt" | "review") {
  const fields = questionFields(q.html);
  const answerFields = fields.filter((f) => f.type !== "hidden");
  const isDescription = q.type === "description";
  const num = q.questionnumber || (q.number ? String(q.number) : "");
  return h(
    "section",
    { class: "card question" },
    h(
      "header",
      { class: "card-head card-title-row" },
      h("h2", {}, isDescription ? "Informação" : `Questão ${num || q.slot}`),
      h(
        "div",
        { class: "status-slot" },
        h("span", { class: "chip", "data-tip": q.type }, QTYPES[q.type] ?? q.type),
        !isDescription && questionState(q, mode),
        q.mark !== undefined && q.mark !== null && q.mark !== ""
          ? h("span", { class: "chip grade" }, `${q.mark}${q.maxmark ? ` / ${fmtNum(q.maxmark, 2)}` : ""}`)
          : q.maxmark && !isDescription
            ? h("span", { class: "chip" }, `vale ${fmtNum(q.maxmark, 2)}`)
            : null,
        q.flagged && h("span", { class: "chip warn" }, "⚑ Marcada"),
        q.blockedbyprevious && h("span", { class: "chip", "data-tip": "Só abre depois de responder a anterior" }, "🔒 Bloqueada"),
      ),
    ),
    h("div", { class: "qhtml" }, renderQuestionHtml(q.html)),
    fields.length > 0 &&
      h(
        "details",
        { class: "fields" },
        h("summary", {}, `Campos do formulário (${answerFields.length} de resposta + ${fields.length - answerFields.length} ocultos)`),
        h("p", { class: "note" }, "É isto que o AVA espera de volta ao salvar a resposta (nome → valor). Os ocultos, como o sequencecheck, precisam ir junto."),
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            { class: "table fields-table" },
            h("thead", {}, h("tr", {}, h("th", {}, "Nome"), h("th", {}, "Tipo"), h("th", {}, "Valor"), h("th", {}, "Rótulo"), h("th", {}, "Marcado"))),
            h(
              "tbody",
              {},
              fields.map((f) =>
                h(
                  "tr",
                  { class: f.type === "hidden" ? "hidden-field" : "" },
                  h("td", {}, h("code", {}, f.name)),
                  h("td", {}, f.type),
                  h("td", {}, h("code", {}, f.value || "∅")),
                  h("td", {}, f.label),
                  h("td", {}, f.checked ? "✓" : ""),
                ),
              ),
            ),
          ),
        ),
      ),
  );
}
