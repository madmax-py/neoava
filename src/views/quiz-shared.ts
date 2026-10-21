// Questionários: utilidades usadas pela página do quiz (quiz.ts) e pela tentativa (quiz-attempt.ts).

import type { Preflight, Quiz, QuizAttempt } from "../moodle/api";
import { MoodleError } from "../moodle/client";
import { api, opts, site, state } from "../state";
import { confirmDialog, h, type Child } from "../ui";

export const quizHref = (cid: number, qid: number) => `#/disciplina/${cid}/questionario/${qid}`;
export const attemptHref = (cid: number, qid: number, aid: number, page?: number) =>
  `${quizHref(cid, qid)}/tentativa/${aid}${page !== undefined ? `/pagina/${page + 1}` : ""}`;

export const QTYPES: Record<string, string> = {
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

export const WRITE_FNS = ["mod_quiz_save_attempt", "mod_quiz_process_attempt", "mod_quiz_view_attempt"];
export const canAnswer = () => WRITE_FNS.every((f) => state.available.has(f));
export const canStart = () => state.available.has("mod_quiz_start_attempt") && canAnswer();

/** Regras que um front próprio não consegue cumprir (o AVA recusa a tentativa por web services). */
export const BLOCKING_RULES = /seb|safebrowser|ipaddress|offlineattempts|proctoring|delaybetweenattempts_none/;

// ---------- Senha do questionário (só em memória, nunca no localStorage) ----------

export const passwords = new Map<number, string>();
export const preOf = (qid: number): Preflight | undefined => (passwords.has(qid) ? { quizpassword: passwords.get(qid)! } : undefined);
export const isPasswordError = (e: unknown) => e instanceof MoodleError && /preflightdatarequired|passworderror|passwordmismatch/.test(e.errorcode);

/** Executa a chamada; se o AVA pedir a senha do quiz, pergunta e tenta de novo. */
export async function withPassword<T>(qid: number, fn: (pre?: Preflight) => Promise<T>): Promise<T> {
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

export async function loadQuiz(cid: number, qid: number) {
  const o = opts();
  const [courses, quizzes] = await Promise.all([api().courses(site().userid), api().quizzes([cid], o)]);
  const course = courses.find((c) => c.id === cid);
  const quiz = quizzes.find((q) => q.id === qid);
  if (!quiz) throw new Error("Questionário não encontrado nesta disciplina (ou não está visível para você).");
  return { course, quiz };
}

export function scaled(a: QuizAttempt, q: Quiz): number | null {
  if (a.sumgrades === null || a.sumgrades === undefined || !q.sumgrades) return null;
  return (a.sumgrades / q.sumgrades) * q.grade;
}

export function attemptState(a: QuizAttempt) {
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
export function pageCount(a: QuizAttempt): number | null {
  if (!a.layout) return null;
  const zeros = a.layout.split(",").filter((x) => x.trim() === "0").length;
  return Math.max(1, zeros);
}

export function head(course: { id: number; name: string }, title: string, aside?: Child, back?: { href: string; label: string }) {
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

export const errMsg = (e: unknown) => (e instanceof MoodleError ? `${e.message} (${e.errorcode})` : (e as Error)?.message ?? String(e));

/** Navega; se já estiver no mesmo endereço, redesenha a tela (mudar o hash para o mesmo valor não dispara nada). */
export function goTo(hash: string) {
  if (location.hash === hash) state.route();
  else location.hash = hash;
}

/** Atualiza o cache das tentativas depois de iniciar/enviar (para as telas não mostrarem dados velhos). */
export const refreshAttempts = (qid: number) => api().quizAttempts(qid, site().userid, { refresh: true });
