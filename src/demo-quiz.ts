// Questionários do modo demonstração: simula o Moodle com estado em memória.
// Iniciar, salvar e enviar mudam a tentativa de verdade (até recarregar a página), e o
// sequencecheck é validado como no Moodle: resposta com sequencecheck velho é ignorada em silêncio.

const now = () => Math.floor(Date.now() / 1000);
const D = 86400;
const TIMELIMIT = 1800;
const PASSWORD = "1234";

export const quizFunctions = [
  "mod_quiz_get_quizzes_by_courses",
  "mod_quiz_get_user_quiz_attempts",
  "mod_quiz_get_user_best_grade",
  "mod_quiz_get_quiz_access_information",
  "mod_quiz_get_attempt_access_information",
  "mod_quiz_get_quiz_required_qtypes",
  "mod_quiz_get_attempt_data",
  "mod_quiz_get_attempt_summary",
  "mod_quiz_get_attempt_review",
  "mod_quiz_start_attempt",
  "mod_quiz_save_attempt",
  "mod_quiz_process_attempt",
  "mod_quiz_view_attempt",
];

interface DemoQuiz {
  id: number;
  course: number;
  name: string;
  timeclose: number;
  attempts: number;
  grade: number;
  free: boolean;
  password: boolean;
}

interface DemoAttempt {
  id: number;
  quiz: number;
  attempt: number;
  state: "inprogress" | "finished" | "overdue" | "abandoned";
  timestart: number;
  timefinish: number;
  currentpage: number;
  answers: Record<string, string>;
  /** sequencecheck atual de cada slot. */
  seq: Record<number, number>;
}

const t0 = now();
function quizzesOf(cid: number): DemoQuiz[] {
  const free = cid % 2 === 1; // disciplinas ímpares: navegação livre; pares: sequencial
  return [
    { id: cid * 100 + 1, course: cid, name: "Quiz Avaliativo — Aula 4", timeclose: t0 - 6 * D, attempts: 2, grade: 1, free, password: false },
    { id: cid * 100 + 2, course: cid, name: "Quiz Avaliativo — Aula 5", timeclose: t0 + 3 * D, attempts: 2, grade: 1, free, password: false },
    { id: cid * 100 + 3, course: cid, name: "Quiz de revisão", timeclose: t0 - 2 * D, attempts: 0, grade: 2, free, password: false },
    { id: cid * 100 + 4, course: cid, name: cid % 2 ? "Simulado VA2" : "Simulado VA2 (com senha 1234)", timeclose: t0 + 15 * D, attempts: 3, grade: 2, free, password: cid % 2 === 0 },
  ];
}

// ---------- questões ----------

interface QDef {
  slot: number;
  type: string;
  page: number;
  text: string;
  options?: string[];
  letters?: boolean;
  right: string;
  rightText: string;
  img?: boolean;
}
const QUESTIONS: QDef[] = [
  { slot: 1, type: "multichoice", page: 0, text: "Qual forma normal elimina <strong>dependências transitivas</strong>?", options: ["1FN", "2FN", "3FN", "FNBC"], letters: true, right: "2", rightText: "3FN" },
  { slot: 2, type: "truefalse", page: 0, text: "Toda relação na FNBC também está na 3FN.", options: ["Verdadeiro", "Falso"], right: "0", rightText: "'Verdadeiro'", img: true },
  { slot: 3, type: "shortanswer", page: 1, text: "Qual comando SQL remove uma tabela inteira, incluindo a estrutura?", right: "drop table", rightText: "DROP TABLE" },
  { slot: 4, type: "multichoice", page: 1, text: "Em um índice B-Tree, a busca por igualdade tem custo:", options: ["O(1)", "O(log n)", "O(n)", "O(n log n)"], letters: true, right: "1", rightText: "O(log n)" },
];
const MAXMARK = 2.5;
const LAYOUT = "1,2,0,3,4,0";

const isRight = (q: QDef, v: string | undefined) => v !== undefined && v.trim().toLowerCase() === q.right;
const sumgrades = (a: DemoAttempt) => QUESTIONS.reduce((s, q) => s + (isRight(q, a.answers[`q${a.id}:${q.slot}_answer`]) ? MAXMARK : 0), 0);

function questionHtml(a: DemoAttempt, q: QDef, review: boolean): string {
  const name = `q${a.id}:${q.slot}_answer`;
  const chosen = a.answers[name];
  const dis = review ? ' disabled="disabled"' : "";
  let body: string;
  if (q.options) {
    const opts = q.options
      .map((t, i) => {
        const id = `${name}${i}`;
        const sel = chosen === String(i);
        const ok = String(i) === q.right;
        const mark = review && sel ? (ok ? ' <i class="icon fa fa-check text-success fa-fw" title="Correto" aria-label="Correto"></i>' : ' <i class="icon fa fa-xmark text-danger fa-fw" title="Incorreto" aria-label="Incorreto"></i>') : "";
        const cls = review && sel ? (ok ? " correct" : " incorrect") : "";
        return `<div class="r${i % 2}${cls}"><input type="radio" name="${name}" value="${i}" id="${id}" aria-labelledby="${id}_label"${sel ? ' checked="checked"' : ""}${dis}><div class="d-flex w-auto" id="${id}_label" data-region="answer-label">${q.letters ? `<span class="answernumber">${"abcde"[i]}. </span>` : ""}<div class="flex-fill ms-1">${t}</div></div>${mark}</div>`;
      })
      .join("");
    body = `<fieldset class="ablock no-overflow visual-scroll-x"><legend class="prompt h6 fw-normal visually-hidden">Escolha uma opção:</legend><div class="answer">${opts}</div></fieldset>`;
  } else {
    body = `<div class="ablock form-inline"><label for="${name}">Resposta:</label><span class="answer"><input type="text" name="${name}" id="${name}" size="30" class="form-control d-inline" value="${chosen ?? ""}"${review ? ' readonly="readonly"' : ""}></span></div>`;
  }
  const img = q.img ? `<p><img src="https://avagrad.unievangelica.edu.br/pluginfile.php/123/question/questiontext/1/2/45/diagrama.png" alt="Diagrama de dependências" onerror="alert(1)" width="320"></p>` : "";
  const outcome = review ? `<div class="outcome clearfix"><h4 class="accesshide">Feedback</h4><div class="feedback"><div class="rightanswer">A resposta correta é: ${q.rightText}</div></div></div>` : "";
  const stateCls = review ? (isRight(q, chosen) ? "correct" : "incorrect") : chosen !== undefined && chosen !== "" ? "answersaved" : "notyetanswered";
  return `<div id="question-${a.id}-${q.slot}" class="que ${q.type} deferredfeedback ${stateCls}"><div class="info"><h3 class="no">Questão <span class="qno">${q.slot}</span></h3><div class="questionflag editable"><input type="hidden" name="q${a.id}:${q.slot}_:flagged" value="0"><input type="checkbox" id="q${a.id}:${q.slot}_:flaggedcheckbox" name="q${a.id}:${q.slot}_:flagged" value="1"><label for="q${a.id}:${q.slot}_:flaggedcheckbox">Marcar questão</label></div></div><div class="content"><div class="formulation clearfix"><h4 class="accesshide">Texto da questão</h4><input type="hidden" name="q${a.id}:${q.slot}_:sequencecheck" value="${a.seq[q.slot]}"><div class="qtext"><p>${q.text}</p>${img}</div>${body}</div>${outcome}</div></div><script>alert("isto nunca deve rodar")</script>`;
}

function questionData(a: DemoAttempt, q: QDef, review: boolean, withHtml = true) {
  const v = a.answers[`q${a.id}:${q.slot}_answer`];
  const answered = v !== undefined && v !== "";
  const right = isRight(q, v);
  return {
    slot: q.slot,
    type: q.type,
    page: q.page,
    number: q.slot,
    html: withHtml ? questionHtml(a, q, review) : "",
    flagged: false,
    state: review ? (right ? "gradedright" : answered ? "gradedwrong" : "gaveup") : answered ? "complete" : "todo",
    status: review ? (right ? "Correto" : answered ? "Incorreto" : "Não respondida") : answered ? "Resposta salva" : "Ainda não respondida",
    mark: review ? (right ? "2,50" : "0,00") : undefined,
    maxmark: MAXMARK,
    sequencecheck: a.seq[q.slot],
    blockedbyprevious: false,
  };
}

// ---------- estado ----------

const store = new Map<number, DemoAttempt[]>();
const freshSeq = () => Object.fromEntries(QUESTIONS.map((q) => [q.slot, 1]));
function attemptsOf(q: DemoQuiz): DemoAttempt[] {
  if (!store.has(q.id)) {
    const list: DemoAttempt[] = [];
    const n = q.id % 100;
    if (n === 1 || n === 2) {
      const id = q.id * 10 + 1;
      list.push({ id, quiz: q.id, attempt: 1, state: "finished", timestart: t0 - 8 * D, timefinish: t0 - 8 * D + 903, currentpage: 1, answers: { [`q${id}:1_answer`]: "2", [`q${id}:2_answer`]: "1", [`q${id}:3_answer`]: "DROP TABLE", [`q${id}:4_answer`]: "0" }, seq: { 1: 3, 2: 3, 3: 3, 4: 3 } });
    }
    if (n === 2) {
      const id = q.id * 10 + 2;
      list.push({ id, quiz: q.id, attempt: 2, state: "inprogress", timestart: t0 - 600, timefinish: 0, currentpage: 0, answers: { [`q${id}:1_answer`]: "2" }, seq: { 1: 2, 2: 1, 3: 1, 4: 1 } });
    }
    store.set(q.id, list);
  }
  return store.get(q.id)!;
}

let allIds: number[] = [];
const allQuizzes = () => allIds.flatMap(quizzesOf);
const findQuiz = (id: number) => allQuizzes().find((q) => q.id === id);
function findAttempt(id: number): { a: DemoAttempt; q: DemoQuiz } | null {
  for (const q of allQuizzes()) {
    const a = attemptsOf(q).find((x) => x.id === id);
    if (a) return { a, q };
  }
  return null;
}

function publicAttempt(a: DemoAttempt) {
  const q = findQuiz(a.quiz)!;
  return {
    id: a.id,
    quiz: a.quiz,
    attempt: a.attempt,
    state: a.state,
    timestart: a.timestart,
    timefinish: a.timefinish,
    timemodified: a.timefinish || a.timestart,
    currentpage: a.currentpage,
    layout: LAYOUT,
    sumgrades: a.state === "finished" ? sumgrades(a) : null,
    _free: q.free,
  };
}

const err = (errorcode: string, message: string) => ({ exception: "moodle_quiz_exception", errorcode, message });

/** Lê data[i][name]/data[i][value] (e preflightdata) do corpo da requisição. */
function pairs(p: URLSearchParams, key: string): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; p.has(`${key}[${i}][name]`); i++) out.push([p.get(`${key}[${i}][name]`)!, p.get(`${key}[${i}][value]`) ?? ""]);
  return out;
}

function checkPassword(q: DemoQuiz, p: URLSearchParams) {
  if (!q.password) return null;
  const pw = pairs(p, "preflightdata").find(([n]) => n === "quizpassword")?.[1];
  if (pw === undefined) return err("preflightdatarequired", "Dados de pré-verificação necessários");
  if (pw !== PASSWORD) return err("passworderror", "A senha informada está incorreta.");
  return null;
}

function expireIfNeeded(a: DemoAttempt) {
  if (a.state === "inprogress" && now() > a.timestart + TIMELIMIT) {
    a.state = "finished";
    a.timefinish = a.timestart + TIMELIMIT;
  }
}

/** Aplica respostas como o Moodle: só nos slots cujo sequencecheck confere. */
function applyAnswers(a: DemoAttempt, data: [string, string][], bumpSeq: boolean) {
  const map = new Map(data);
  const slots = (map.get("slots") ?? QUESTIONS.map((q) => q.slot).join(",")).split(",").map(Number);
  let ignored = 0;
  for (const slot of slots) {
    const sc = map.get(`q${a.id}:${slot}_:sequencecheck`);
    if (sc === undefined) continue;
    if (Number(sc) !== a.seq[slot]) {
      ignored++;
      continue;
    }
    const name = `q${a.id}:${slot}_answer`;
    const v = map.get(name);
    const before = a.answers[name];
    if (v !== undefined) a.answers[name] = v;
    if (bumpSeq && v !== undefined && v !== before) a.seq[slot]++;
  }
  if (ignored) console.warn(`[demo] ${ignored} slot(s) ignorado(s) por sequencecheck desatualizado`);
}

export function quizRespond(fn: string, p: URLSearchParams, courseIds: number[]): unknown {
  allIds = courseIds;
  if (/_(start|save|process|view)_attempt$/.test(fn)) console.info(`[demo] escrita: ${fn} ${decodeURIComponent(p.toString()).replace(/wstoken=[^&]*&?/, "")}`);
  const num = (k: string) => Number(p.get(k));
  switch (fn) {
    case "mod_quiz_get_quizzes_by_courses": {
      const ids = [...p.keys()].filter((k) => k.startsWith("courseids[")).map((k) => Number(p.get(k)));
      return {
        quizzes: ids.flatMap((cid) => quizzesOf(cid).map((q) => ({
          id: q.id,
          coursemodule: q.id,
          course: cid,
          name: q.name,
          timeopen: 0,
          timeclose: q.timeclose,
          timelimit: TIMELIMIT,
          attempts: q.attempts,
          grade: q.grade,
          sumgrades: 10,
          decimalpoints: 2,
          visible: true,
          navmethod: q.free ? "free" : "sequential",
          intro: "<p>Responda com base no material da <b>aula</b>. Boa prova!</p>",
        }))),
      };
    }
    case "mod_quiz_get_user_quiz_attempts": {
      const q = findQuiz(num("quizid"));
      if (!q) return { attempts: [] };
      attemptsOf(q).forEach(expireIfNeeded);
      return { attempts: attemptsOf(q).map(publicAttempt) };
    }
    case "mod_quiz_get_user_best_grade": {
      const q = findQuiz(num("quizid"));
      const done = q ? attemptsOf(q).filter((a) => a.state === "finished") : [];
      if (!q || !done.length) return { hasgrade: false };
      return { hasgrade: true, grade: (Math.max(...done.map(sumgrades)) / 10) * q.grade, gradetopass: 0.6 * q.grade };
    }
    case "mod_quiz_get_quiz_access_information": {
      const q = findQuiz(num("quizid"))!;
      const closed = q.timeclose < now();
      return {
        canattempt: true,
        canmanage: false,
        canpreview: false,
        canreviewmyattempts: true,
        canviewreports: false,
        accessrules: [
          "Tempo limite: 30 minutos",
          q.attempts ? `Tentativas permitidas: ${q.attempts}` : "Tentativas ilimitadas",
          ...(q.password ? ["Para tentar este questionário você precisa saber a senha."] : []),
        ],
        activerulenames: ["quizaccess_timelimit", "quizaccess_numattempts", "quizaccess_openclosedate", ...(q.password ? ["quizaccess_password"] : [])],
        preventaccessreasons: closed ? ["Este questionário foi encerrado."] : [],
        warnings: [],
      };
    }
    case "mod_quiz_get_attempt_access_information": {
      const q = findQuiz(num("quizid"))!;
      const list = attemptsOf(q);
      list.forEach(expireIfNeeded);
      const aid = num("attemptid");
      const a = list.find((x) => x.id === aid);
      const used = list.filter((x) => x.state !== "abandoned").length;
      const reasons: string[] = [];
      if (q.timeclose < now()) reasons.push("Este questionário foi encerrado.");
      else if (list.some((x) => x.state === "inprogress")) reasons.push("Você já tem uma tentativa em andamento.");
      else if (q.attempts && used >= q.attempts) reasons.push("Não são permitidas mais tentativas.");
      return {
        endtime: a && a.state === "inprogress" ? a.timestart + TIMELIMIT : undefined,
        isfinished: a ? a.state === "finished" : false,
        ispreflightcheckrequired: q.password,
        preventnewattemptreasons: reasons,
        warnings: [],
      };
    }
    case "mod_quiz_get_quiz_required_qtypes":
      return { questiontypes: ["multichoice", "truefalse", "shortanswer"], warnings: [] };

    case "mod_quiz_start_attempt": {
      const q = findQuiz(num("quizid"));
      if (!q) return err("invalidrecord", "Questionário não encontrado");
      const pw = checkPassword(q, p);
      if (pw) return pw;
      const list = attemptsOf(q);
      list.forEach(expireIfNeeded);
      if (list.some((x) => x.state === "inprogress")) return err("attemptstillinprogress", "Ainda há uma tentativa em andamento.");
      if (q.attempts && list.length >= q.attempts) return err("nomoreattempts", "Não são permitidas mais tentativas.");
      const n = list.length + 1;
      const a: DemoAttempt = { id: q.id * 10 + n, quiz: q.id, attempt: n, state: "inprogress", timestart: now(), timefinish: 0, currentpage: 0, answers: {}, seq: freshSeq() };
      list.push(a);
      return { attempt: publicAttempt(a), warnings: [] };
    }
    case "mod_quiz_get_attempt_data": {
      const f = findAttempt(num("attemptid"));
      if (!f) return err("invalidrecord", "Tentativa não encontrada");
      const pw = checkPassword(f.q, p);
      if (pw) return pw;
      expireIfNeeded(f.a);
      if (f.a.state !== "inprogress") return err("attemptalreadyclosed", "Esta tentativa já foi finalizada.");
      const page = num("page");
      if (!f.q.free && page !== f.a.currentpage && page !== f.a.currentpage + 1) return err("outofsequenceaccess", "Acesso fora de sequência.");
      return {
        attempt: publicAttempt(f.a),
        messages: [],
        nextpage: page >= 1 ? -1 : page + 1,
        questions: QUESTIONS.filter((x) => x.page === page).map((x) => questionData(f.a, x, false)),
        warnings: [],
      };
    }
    case "mod_quiz_view_attempt": {
      const f = findAttempt(num("attemptid"));
      if (!f) return err("invalidrecord", "Tentativa não encontrada");
      const page = num("page");
      if (!f.q.free && page !== f.a.currentpage && page !== f.a.currentpage + 1) return err("outofsequenceaccess", "Acesso fora de sequência.");
      f.a.currentpage = page;
      return { status: true, warnings: [] };
    }
    case "mod_quiz_get_attempt_summary": {
      const f = findAttempt(num("attemptid"));
      if (!f) return err("invalidrecord", "Tentativa não encontrada");
      return { questions: QUESTIONS.map((x) => questionData(f.a, x, false, false)), warnings: [] };
    }
    case "mod_quiz_save_attempt": {
      const f = findAttempt(num("attemptid"));
      if (!f) return err("invalidrecord", "Tentativa não encontrada");
      const pw = checkPassword(f.q, p);
      if (pw) return pw;
      expireIfNeeded(f.a);
      if (f.a.state !== "inprogress") return err("attemptalreadyclosed", "Esta tentativa já foi finalizada.");
      applyAnswers(f.a, pairs(p, "data"), false); // salvamento automático não muda o sequencecheck
      return { status: true, warnings: [] };
    }
    case "mod_quiz_process_attempt": {
      const f = findAttempt(num("attemptid"));
      if (!f) return err("invalidrecord", "Tentativa não encontrada");
      const pw = checkPassword(f.q, p);
      if (pw) return pw;
      if (f.a.state !== "inprogress") return err("attemptalreadyclosed", "Esta tentativa já foi finalizada.");
      applyAnswers(f.a, pairs(p, "data"), true);
      if (p.get("finishattempt") === "1") {
        f.a.state = "finished";
        f.a.timefinish = now();
      }
      return { state: f.a.state, warnings: [] };
    }
    case "mod_quiz_get_attempt_review": {
      const f = findAttempt(num("attemptid"));
      if (!f) return err("invalidrecord", "Tentativa não encontrada");
      const g = (sumgrades(f.a) / 10) * f.q.grade;
      const fmt = (n: number) => n.toFixed(2).replace(".", ",");
      return {
        grade: fmt(g),
        attempt: publicAttempt(f.a),
        additionaldata: [
          { id: "state", title: "Estado", content: "Finalizada" },
          { id: "timetaken", title: "Tempo empregado", content: `${Math.max(1, Math.round((f.a.timefinish - f.a.timestart) / 60))} minutos` },
          { id: "marks", title: "Avaliar", content: `${fmt(sumgrades(f.a))}/10,00` },
          { id: "grade", title: "Nota", content: `<b>${fmt(g)}</b> de um máximo de ${fmt(f.q.grade)}` },
        ],
        questions: QUESTIONS.map((x) => questionData(f.a, x, true)),
        warnings: [],
      };
    }
    default:
      return err("invalidrecord", `Demo não implementa ${fn}`);
  }
}
