// Questionários: página do quiz (regras, tentativas, iniciar) e página de uma tentativa
// (responder, revisar antes de enviar, ou ver a revisão da tentativa finalizada).
//
// Escrita no AVA só acontece aqui, e só com as funções de WRITE_FUNCTIONS do cliente:
// - iniciar e enviar pedem confirmação explícita;
// - as respostas são salvas automaticamente enquanto você responde (como o AVA faz no navegador);
// - se o tempo acabar com a página aberta, a tentativa é enviada (como o AVA faz no navegador).

import type { AttemptAccess, FormPair, Preflight, Quiz, QuizAttempt, QuizQuestion } from "../moodle/api";
import { MoodleError } from "../moodle/client";
import { api, ifAvailable, nowS, opts, site, state } from "../state";
import { courseName } from "../data";
import { fmtNum } from "../grades";
import { fmtDateTime, fmtRelative, stripHtml } from "../format";
import { shell } from "../layout";
import { NEEDS_MOODLE_JS, questionFields, renderQuestionHtml } from "../question-html";
import { card, confirmDialog, h, statTile, type Child } from "../ui";

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

const WRITE_FNS = ["mod_quiz_save_attempt", "mod_quiz_process_attempt", "mod_quiz_view_attempt"];
const canAnswer = () => WRITE_FNS.every((f) => state.available.has(f));
const canStart = () => state.available.has("mod_quiz_start_attempt") && canAnswer();

/** Regras que um front próprio não consegue cumprir (o AVA recusa a tentativa por web services). */
const BLOCKING_RULES = /seb|safebrowser|ipaddress|offlineattempts|proctoring|delaybetweenattempts_none/;

// ---------- Senha do questionário (só em memória, nunca no localStorage) ----------

const passwords = new Map<number, string>();
const preOf = (qid: number): Preflight | undefined => (passwords.has(qid) ? { quizpassword: passwords.get(qid)! } : undefined);
const isPasswordError = (e: unknown) => e instanceof MoodleError && /preflightdatarequired|passworderror|passwordmismatch/.test(e.errorcode);

/** Executa a chamada; se o AVA pedir a senha do quiz, pergunta e tenta de novo. */
async function withPassword<T>(qid: number, fn: (pre?: Preflight) => Promise<T>): Promise<T> {
  let error: string | undefined;
  for (let i = 0; i < 4; i++) {
    try {
      return await fn(preOf(qid));
    } catch (e) {
      if (!isPasswordError(e)) throw e;
      if (passwords.has(qid)) error = "Senha incorreta. Tente de novo.";
      passwords.delete(qid);
      const r = await confirmDialog({
        title: "Senha do questionário",
        body: h("p", {}, "Este questionário pede uma senha (informada pelo professor). Ela fica só na memória desta aba."),
        confirmLabel: "Continuar",
        password: { label: "Senha", error },
      });
      if (!r.ok || !r.password) throw new Error("É preciso a senha do questionário para continuar.");
      passwords.set(qid, r.password);
    }
  }
  throw new Error("Senha incorreta.");
}

// ---------- Utilidades ----------

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

const errMsg = (e: unknown) => (e instanceof MoodleError ? `${e.message} (${e.errorcode})` : (e as Error)?.message ?? String(e));

/** Navega; se já estiver no mesmo endereço, redesenha a tela (mudar o hash para o mesmo valor não dispara nada). */
function goTo(hash: string) {
  if (location.hash === hash) state.route();
  else location.hash = hash;
}

/** Atualiza o cache das tentativas depois de iniciar/enviar (para as telas não mostrarem dados velhos). */
const refreshAttempts = (qid: number) => api().quizAttempts(qid, site().userid, { refresh: true });

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

// ---------- Página de uma tentativa ----------

export async function attemptPage(cid: number, qid: number, aid: number, pageParam: number | null, rid: number, mode?: "resumo") {
  // Tela de tentativa: sempre busca o estado atual e nunca é redesenhada por atualização em segundo plano
  // (apagaria o que você está respondendo).
  state.hold = true;
  const uid = site().userid;
  const { course, quiz } = await loadQuiz(cid, qid);
  // Sempre fresco: a página atual e o estado mudam a cada ação.
  const attempts = await api().quizAttempts(qid, uid, { refresh: true });
  const attempt = attempts.find((a) => a.id === aid);
  if (!attempt) throw new Error("Tentativa não encontrada.");
  const cname = course ? courseName(course) : `Disciplina ${cid}`;
  const back = { href: quizHref(cid, qid), label: quiz.name };
  const title = `Tentativa ${attempt.attempt}`;
  const ctx: Ctx = { cid, qid, aid, rid, quiz, attempt, cname, back, title };

  if (attempt.state === "finished") return reviewView(ctx);
  if (attempt.state === "abandoned") {
    if (rid !== state.routeId) return;
    return shell(head({ id: cid, name: cname }, title, attemptState(attempt), back), card("Tentativa abandonada", h("p", { class: "empty" }, "Esta tentativa não foi enviada a tempo e não tem questões para mostrar.")));
  }

  const access = await ifAvailable("mod_quiz_get_attempt_access_information", () => api().attemptAccess(qid, aid, { refresh: true }), null as AttemptAccess | null);
  ctx.endtime = access?.endtime || undefined;
  if (attempt.state === "overdue") return overdueView(ctx);
  const expired = !!ctx.endtime && ctx.endtime < nowS();
  if (expired || !canAnswer()) return readOnlyView(ctx, pageParam, expired);
  if (mode === "resumo") return summaryView(ctx);
  return answerView(ctx, pageParam);
}

interface Ctx {
  cid: number;
  qid: number;
  aid: number;
  rid: number;
  quiz: Quiz;
  attempt: QuizAttempt;
  cname: string;
  back: { href: string; label: string };
  title: string;
  endtime?: number;
}

const summaryHref = (c: Ctx) => `${attemptHref(c.cid, c.qid, c.aid)}/resumo`;

/** Página a mostrar: na navegação sequencial, sempre a atual (o AVA recusa as outras). */
function pageFor(c: Ctx, pageParam: number | null) {
  const free = c.quiz.navmethod === "free";
  const current = c.attempt.currentpage ?? 0;
  return { free, current, page: free && pageParam !== null ? pageParam : current, pages: pageCount(c.attempt) };
}

// ---- Responder ----

async function answerView(c: Ctx, pageParam: number | null) {
  const { free, current, page, pages } = pageFor(c, pageParam);
  const data = await withPassword(c.qid, (pre) => api().attemptData(c.aid, page, pre));
  if (c.rid !== state.routeId) return;

  const isLast = data.nextpage === -1;
  const slots = data.questions.map((q) => q.slot);
  const saveChip = h("span", { class: "chip", "aria-live": "polite" }, "Tudo salvo");
  const form = h("form", { class: "q-list answering", onsubmit: (e) => e.preventDefault() });
  form.append(...data.questions.map((q) => questionCard(q, "answer")));

  // ---- salvamento ----
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  let finished = false;

  const collect = (): FormPair[] => {
    const out: FormPair[] = [{ name: "slots", value: slots.join(",") }];
    for (const [name, value] of new FormData(form)) if (typeof value === "string") out.push({ name, value });
    return out;
  };
  const setChip = (text: string, tone = "") => {
    saveChip.className = `chip${tone ? ` ${tone}` : ""}`;
    saveChip.textContent = text;
  };
  /**
   * O Moodle ignora (em silêncio!) respostas com sequencecheck velho. Depois de cada gravação,
   * relê a página e atualiza só os campos ocultos de sequencecheck — sem mexer no que você está digitando.
   */
  const syncSequence = async () => {
    const fresh = await withPassword(c.qid, (pre) => api().attemptData(c.aid, page, pre));
    for (const q of fresh.questions)
      for (const f of questionFields(q.html))
        if (f.name.endsWith(":sequencecheck")) {
          const el = form.querySelector<HTMLInputElement>(`input[type="hidden"][name="${CSS.escape(f.name)}"]`);
          if (el) el.value = f.value;
        }
  };
  /** Grava a página. "auto" = salvamento automático; "page" = como o botão de próxima página do AVA. */
  const save = (kind: "auto" | "page") => {
    clearTimeout(timer);
    const run = async () => {
      if (finished) return;
      if (kind === "auto" && !dirty) return;
      dirty = false;
      setChip("Salvando…");
      const pairs = collect();
      try {
        await withPassword<unknown>(c.qid, (pre) => (kind === "auto" ? api().saveAttempt(c.aid, pairs, pre) : api().processAttempt(c.aid, pairs, false, pre)));
        await syncSequence();
        setChip(`Salvo às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, "good");
      } catch (e) {
        dirty = true;
        setChip("Não salvou", "bad");
        saveError.replaceChildren(h("div", { class: "error" }, `Não foi possível salvar no AVA: ${errMsg(e)}. Suas respostas continuam na tela; tente “Salvar agora”.`));
        throw e;
      }
      saveError.replaceChildren();
    };
    chain = chain.catch(() => {}).then(run);
    return chain;
  };
  const onEdit = () => {
    dirty = true;
    setChip("Alterações não salvas", "warn");
    clearTimeout(timer);
    timer = setTimeout(() => save("auto").catch(() => {}), 2500);
  };
  form.addEventListener("input", onEdit);
  form.addEventListener("change", onEdit);
  // No Moodle 4+, o texto da alternativa não é um <label>: clicar na linha marca a opção.
  form.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, select, textarea, a, label")) return;
    const row = t.closest(".m-answer > div");
    const input = row?.querySelector<HTMLInputElement>('input[type="radio"], input[type="checkbox"]');
    if (!input || input.disabled) return;
    input.checked = input.type === "radio" ? true : !input.checked;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const leaveGuard = (e: BeforeUnloadEvent) => {
    if (dirty && form.isConnected) e.preventDefault();
  };
  window.addEventListener("beforeunload", leaveGuard);
  // Saiu da tela por outro caminho (menu, voltar): salva o que estiver pendente.
  const onHash = () => {
    if (form.isConnected) return;
    window.removeEventListener("hashchange", onHash);
    window.removeEventListener("beforeunload", leaveGuard);
    if (dirty && !finished) save("auto").catch(() => {});
  };
  window.addEventListener("hashchange", onHash);

  /** Salva esta página, registra a nova página no AVA e navega. */
  const go = async (target: number | "resumo", btn?: HTMLButtonElement) => {
    if (btn) btn.disabled = true;
    try {
      await save("page");
      if (target !== "resumo") await withPassword(c.qid, (pre) => api().viewAttempt(c.aid, target, pre));
      goTo(target === "resumo" ? summaryHref(c) : attemptHref(c.cid, c.qid, c.aid, target));
    } catch {
      if (btn) btn.disabled = false;
    }
  };

  // ---- fim do tempo com a página aberta: envia, como o AVA ----
  const onTimeUp = async () => {
    if (finished || !form.isConnected) return;
    finished = true;
    clearTimeout(timer);
    setChip("Enviando…", "warn");
    try {
      await chain.catch(() => {});
      await withPassword(c.qid, (pre) => api().processAttempt(c.aid, collect(), true, pre, true));
    } catch {
      // O AVA pode já ter fechado a tentativa sozinho; a tela da tentativa mostra o estado real.
    }
    await refreshAttempts(c.qid).catch(() => {});
    if (form.isConnected) goTo(attemptHref(c.cid, c.qid, c.aid));
  };

  const saveError = h("div", {});
  const prevBtn: HTMLButtonElement = h("button", { type: "button", onclick: () => go(page - 1, prevBtn) }, "← Página anterior");
  const nextBtn: HTMLButtonElement = h("button", { type: "button", class: "primary", onclick: () => go(page + 1, nextBtn) }, "Próxima página →");
  const summaryBtn: HTMLButtonElement = h("button", { type: "button", class: isLast ? "primary" : "", onclick: () => go("resumo", summaryBtn) }, "Revisar e enviar");
  const saveBtn = h("button", { type: "button", class: "ghost", onclick: () => save("page").catch(() => {}) }, "Salvar agora");

  shell(
    head(
      { id: c.cid, name: c.cname },
      c.title,
      h("div", { class: "status-slot" }, attemptState(c.attempt), c.endtime ? countdown(c.endtime, onTimeUp) : null, saveChip),
      c.back,
    ),
    data.messages.length > 0 ? h("div", { class: "notice" }, data.messages.map((m) => h("p", {}, stripHtml(m)))) : null,
    h(
      "div",
      { class: "notice info" },
      "As respostas são salvas no AVA automaticamente. Nada vai para correção até você clicar em ",
      h("strong", {}, "Revisar e enviar"),
      " e confirmar.",
      !free && " Navegação sequencial: depois de avançar, não dá para voltar a esta página.",
    ),
    pager(c, page, pages, free, current, (p) => go(p)),
    form,
    data.questions.length === 0 && card("Página vazia", h("p", { class: "empty" }, "Nenhuma questão nesta página.")),
    saveError,
    h(
      "div",
      { class: "attempt-actions" },
      free && page > 0 ? prevBtn : null,
      saveBtn,
      h("span", { class: "spacer" }),
      !isLast ? nextBtn : null,
      summaryBtn,
    ),
  );
}

// ---- Revisar antes de enviar ----

async function summaryView(c: Ctx) {
  const questions = await withPassword(c.qid, (pre) => api().attemptSummary(c.aid, pre));
  if (c.rid !== state.routeId) return;
  const free = c.quiz.navmethod === "free";
  const real = questions.filter((q) => q.type !== "description");
  const pending = real.filter((q) => q.state === "todo" || q.state === "invalid");
  let finished = false;

  const submit = async (btn: HTMLButtonElement) => {
    const r = await confirmDialog({
      title: "Enviar tudo e terminar?",
      body: [
        h("p", {}, h("strong", {}, "Depois de enviar, você não poderá mais mudar as respostas."), " A tentativa vai para correção e conta no limite de tentativas."),
        pending.length > 0
          ? h("p", { class: "error" }, `${pending.length} questão(ões) sem resposta: ${pending.map((q) => q.questionnumber || q.number || q.slot).join(", ")}.`)
          : h("p", {}, "Todas as questões têm resposta salva."),
      ],
      confirmLabel: "Enviar e terminar",
      danger: true,
    });
    if (!r.ok) return;
    btn.disabled = true;
    btn.textContent = "Enviando…";
    try {
      finished = true;
      const res = await withPassword(c.qid, (pre) => api().processAttempt(c.aid, [], true, pre));
      await refreshAttempts(c.qid);
      if (res.state !== "finished") throw new Error(`O AVA respondeu com o estado "${res.state}".`);
      goTo(attemptHref(c.cid, c.qid, c.aid));
    } catch (e) {
      finished = false;
      btn.disabled = false;
      btn.textContent = "Enviar tudo e terminar";
      msg.replaceChildren(h("div", { class: "error" }, `Não foi possível enviar: ${errMsg(e)}`));
    }
  };
  const msg = h("div", {});
  const sendBtn: HTMLButtonElement = h("button", { type: "button", class: "danger", onclick: () => submit(sendBtn) }, "Enviar tudo e terminar");

  shell(
    head(
      { id: c.cid, name: c.cname },
      `${c.title}: resumo`,
      h("div", { class: "status-slot" }, attemptState(c.attempt), c.endtime ? countdown(c.endtime, () => !finished && submitOnTimeUp(c)) : null),
      { href: attemptHref(c.cid, c.qid, c.aid), label: "Voltar às questões" },
    ),
    card(
      h("div", { class: "card-title-row" }, h("h2", {}, "Situação das questões"), h("span", { class: `chip${pending.length ? " warn" : " good"}` }, pending.length ? `${pending.length} sem resposta` : "✓ Todas respondidas")),
      h(
        "ul",
        { class: "summary-list" },
        real.map((q) => {
          const answered = q.state !== "todo" && q.state !== "invalid";
          const label = `Questão ${q.questionnumber || q.number || q.slot}`;
          return h(
            "li",
            {},
            free ? h("a", { href: attemptHref(c.cid, c.qid, c.aid, q.page) }, label) : h("span", {}, label),
            h("span", { class: `chip${answered ? " good" : " warn"}` }, q.status || (answered ? "Resposta salva" : "Ainda não respondida")),
          );
        }),
      ),
      !free && h("p", { class: "note" }, "Navegação sequencial: as páginas anteriores não podem ser reabertas."),
    ),
    msg,
    h(
      "div",
      { class: "attempt-actions" },
      h("a", { href: attemptHref(c.cid, c.qid, c.aid), class: "button" }, "← Voltar às questões"),
      h("span", { class: "spacer" }),
      sendBtn,
    ),
  );
}

/** Tempo acabou na tela de resumo: envia o que já está salvo. */
async function submitOnTimeUp(c: Ctx) {
  try {
    await withPassword(c.qid, (pre) => api().processAttempt(c.aid, [], true, pre, true));
  } catch {}
  await refreshAttempts(c.qid).catch(() => {});
  goTo(attemptHref(c.cid, c.qid, c.aid));
}

// ---- Tempo esgotado (período de tolerância) ----

async function overdueView(c: Ctx) {
  if (c.rid !== state.routeId) return;
  const msg = h("div", {});
  const btn: HTMLButtonElement = h(
    "button",
    {
      class: "danger",
      onclick: async () => {
        const r = await confirmDialog({
          title: "Enviar a tentativa agora?",
          body: h("p", {}, "O tempo acabou. O AVA ainda aceita o envio com as respostas que já estão salvas; não é possível mudá-las."),
          confirmLabel: "Enviar",
          danger: true,
        });
        if (!r.ok) return;
        btn.disabled = true;
        try {
          await withPassword(c.qid, (pre) => api().processAttempt(c.aid, [], true, pre));
          await refreshAttempts(c.qid);
          goTo(attemptHref(c.cid, c.qid, c.aid));
        } catch (e) {
          btn.disabled = false;
          msg.replaceChildren(h("div", { class: "error" }, `Não foi possível enviar: ${errMsg(e)}`));
        }
      },
    },
    "Enviar respostas salvas",
  );
  shell(
    head({ id: c.cid, name: c.cname }, c.title, attemptState(c.attempt), c.back),
    card(
      "Tempo esgotado",
      h("p", {}, "O tempo desta tentativa acabou, mas o AVA ainda aceita o envio por um período de tolerância. Envie agora para que as respostas salvas sejam corrigidas."),
      canAnswer() ? btn : h("p", { class: "note" }, "Seu token não permite enviar; faça isso pelo AVA."),
      msg,
    ),
  );
}

// ---- Somente leitura (sem permissão de escrita, ou tempo já esgotado) ----

async function readOnlyView(c: Ctx, pageParam: number | null, expired: boolean) {
  const { free, current, page, pages } = pageFor(c, pageParam);
  const body = h("div", {});
  const load = async () => {
    body.replaceChildren(card("Carregando questões…", h("div", { class: "skeleton" }, h("div", {}), h("div", {}), h("div", {}))));
    try {
      const data = await withPassword(c.qid, (pre) => api().attemptData(c.aid, page, pre));
      if (c.rid !== state.routeId) return;
      body.replaceChildren(
        h(
          "div",
          { class: "q-list" },
          data.messages.length > 0 ? h("div", { class: "notice" }, data.messages.map((m) => h("p", {}, stripHtml(m)))) : null,
          pager(c, page, pages, free, current),
          data.questions.map((q) => questionCard(q, "view")),
          data.questions.length === 0 && card("Página vazia", h("p", { class: "empty" }, "Nenhuma questão nesta página.")),
        ),
      );
    } catch (e) {
      if (c.rid !== state.routeId) return;
      body.replaceChildren(h("div", { class: "error" }, `Não foi possível ler as questões: ${errMsg(e)}`), h("button", { onclick: load }, "Tentar de novo"));
    }
  };
  if (c.rid !== state.routeId) return;
  shell(
    head({ id: c.cid, name: c.cname }, c.title, h("div", { class: "status-slot" }, attemptState(c.attempt), c.endtime ? countdown(c.endtime) : null), c.back),
    h("div", { class: "notice" }, h("strong", {}, "Visualização somente leitura. "), expired ? "O tempo desta tentativa acabou." : "Seu token não tem as funções de responder questionário.", " Os campos estão desativados e nada é salvo."),
    body,
  );
  if (expired) {
    // Ler uma tentativa vencida faz o AVA processar o fim do tempo (enviar ou abandonar) — só com clique.
    body.replaceChildren(
      card(
        "Tempo esgotado",
        h("p", {}, "Ao ler as questões, o AVA pode finalizar ou abandonar a tentativa automaticamente (o mesmo que aconteceria ao abri-la no AVA)."),
        h("button", { onclick: load }, "Carregar mesmo assim"),
      ),
    );
  } else await load();
}

// ---- Revisão (tentativa finalizada) ----

async function reviewView(c: Ctx) {
  let review;
  try {
    review = await api().attemptReview(c.aid, opts());
  } catch (e) {
    if (c.rid !== state.routeId) return;
    return shell(
      head({ id: c.cid, name: c.cname }, c.title, attemptState(c.attempt), c.back),
      card(
        "Tentativa enviada",
        h("p", {}, "A tentativa está finalizada, mas o AVA não liberou a revisão agora (depende das opções do professor)."),
        h("p", { class: "note" }, errMsg(e)),
        h("a", { href: c.back.href, class: "button" }, "Voltar ao questionário"),
      ),
    );
  }
  if (c.rid !== state.routeId) return;
  shell(
    head({ id: c.cid, name: c.cname }, c.title, h("div", { class: "status-slot" }, attemptState(review.attempt), review.grade && h("span", { class: "chip grade" }, `Nota ${review.grade}`)), c.back),
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
      ? h("div", { class: "q-list" }, review.questions.map((q) => questionCard(q, "view")))
      : card("Revisão", h("p", { class: "empty" }, "As opções de revisão deste questionário não mostram as questões agora.")),
    h("p", { class: "note" }, "O que aparece na revisão (respostas certas, feedback, nota) segue as opções definidas pelo professor no AVA."),
  );
}

// ---------- Componentes ----------

/** Cronômetro até o fim do tempo da tentativa. Chama onExpire uma vez, se a página ainda estiver aberta. */
function countdown(end: number, onExpire?: () => void) {
  const el = h("span", { class: "chip", "data-tip": `Expira em ${fmtDateTime(end)}` });
  let started = false;
  const tick = () => {
    if (started && !el.isConnected) return clearInterval(timer);
    started = true;
    const left = Math.round(end - Date.now() / 1000);
    if (left <= 0) {
      el.className = "chip bad";
      el.textContent = "⏱ Tempo esgotado";
      clearInterval(timer);
      if (onExpire) setTimeout(() => el.isConnected && onExpire(), 0);
      return;
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

function pager(c: Ctx, page: number, pages: number | null, free: boolean, current: number, onGo?: (p: number) => void) {
  if (!pages || pages < 2) return null;
  return h(
    "nav",
    { class: "pager", "aria-label": "Páginas da tentativa" },
    h("span", { class: "muted small" }, "Página"),
    Array.from({ length: pages }, (_, i) =>
      free
        ? h(
            "a",
            {
              href: attemptHref(c.cid, c.qid, c.aid, i),
              class: `page-link${i === page ? " active" : ""}`,
              "aria-current": i === page ? "page" : undefined,
              onclick: onGo
                ? (e: Event) => {
                    e.preventDefault();
                    if (i !== page) onGo(i);
                  }
                : undefined,
            },
            String(i + 1),
          )
        : h("span", { class: `page-link${i === page ? " active" : " locked"}`, "data-tip": i === current ? "Página atual da tentativa" : "Navegação sequencial: só a página atual pode ser aberta" }, String(i + 1)),
    ),
  );
}

function questionState(q: QuizQuestion, mode: "answer" | "view") {
  const st = q.state ?? "";
  const tone = /gradedright/.test(st) ? "good" : /gradedwrong|gaveup/.test(st) ? "bad" : /gradedpartial|invalid/.test(st) ? "warn" : st === "complete" ? "good" : "";
  const label = q.status || (mode === "answer" ? (st === "complete" ? "Respondida" : "Ainda não respondida") : st);
  return label ? h("span", { class: `chip${tone ? ` ${tone}` : ""}` }, label) : null;
}

function questionCard(q: QuizQuestion, mode: "answer" | "view") {
  const fields = questionFields(q.html);
  const answerFields = fields.filter((f) => f.type !== "hidden");
  const isDescription = q.type === "description";
  const needsAva = mode === "answer" && NEEDS_MOODLE_JS.has(q.type);
  const editable = mode === "answer" && !needsAva && !q.blockedbyprevious;
  const num = q.questionnumber || (q.number ? String(q.number) : "");
  return h(
    "section",
    { class: `card question${editable ? " editable" : ""}` },
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
    needsAva && h("div", { class: "notice" }, "Este tipo de questão depende do AVA (arrastar/ordenar). Responda esta pelo AVA; as outras podem ser respondidas aqui."),
    h("div", { class: "qhtml" }, renderQuestionHtml(q.html, editable)),
    mode === "view" &&
      fields.length > 0 &&
      h(
        "details",
        { class: "fields" },
        h("summary", {}, `Campos do formulário (${answerFields.length} de resposta + ${fields.length - answerFields.length} ocultos)`),
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
