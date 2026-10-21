// Página de uma tentativa de questionário: responder (com salvamento automático), revisar antes de
// enviar, tempo esgotado, somente leitura e revisão da tentativa finalizada.

import type { AttemptAccess, FormPair, Quiz, QuizAttempt, QuizQuestion } from "../moodle/api";
import { api, ifAvailable, nowS, opts, site, state } from "../state";
import { courseName } from "../data";
import { fmtNum } from "../grades";
import { fmtDateTime, stripHtml } from "../format";
import { shell } from "../layout";
import { NEEDS_MOODLE_JS, questionFields, renderQuestionHtml } from "../question-html";
import { card, confirmDialog, h } from "../ui";
import {
  quizHref,
  attemptHref,
  QTYPES,
  canAnswer,
  withPassword,
  loadQuiz,
  attemptState,
  pageCount,
  head,
  errMsg,
  goTo,
  refreshAttempts,
} from "./quiz-shared";

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
