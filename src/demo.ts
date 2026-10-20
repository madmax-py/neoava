// Modo demonstração (só em `npm run dev`, com ?demo na URL): responde às chamadas do Moodle
// com dados fictícios, sem tocar na rede. Útil para mexer no visual sem token.

const now = Math.floor(Date.now() / 1000);
const D = 86400;
const ts = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d, 12) / 1000);

const thisYear = new Date().getFullYear();
const curSemStart = new Date().getMonth() < 6 ? ts(thisYear, 2, 1) : ts(thisYear, 8, 1);

const current = [
  { id: 101, fullname: "Engenharia de Software II", progress: 62 },
  { id: 102, fullname: "Banco de Dados Avançado", progress: 48 },
  { id: 103, fullname: "Redes de Computadores", progress: 71 },
  { id: 104, fullname: "Inteligência Artificial", progress: 35 },
  { id: 105, fullname: "Ética e Cidadania", progress: 88 },
].map((c) => ({ ...c, shortname: c.fullname, startdate: curSemStart, enddate: curSemStart + 150 * D, lastaccess: now - D }));

const pastDefs: [number, string, number, string][] = [
  [201, "Algoritmos e Estruturas de Dados", ts(thisYear - 1, 2, 1), "8,40"],
  [202, "Cálculo II", ts(thisYear - 1, 2, 1), "6,20"],
  [203, "Arquitetura de Computadores", ts(thisYear - 1, 2, 1), "7,80"],
  [204, "Sistemas Operacionais", ts(thisYear - 1, 8, 1), "7,10"],
  [205, "Engenharia de Software I", ts(thisYear - 1, 8, 1), "9,00"],
  [206, "Probabilidade e Estatística", ts(thisYear - 1, 8, 1), "5,40"],
  [207, "Programação Web", ts(thisYear - 2, 8, 1), "8,90"],
  [208, "Lógica Matemática", ts(thisYear - 2, 8, 1), "7,30"],
];
const past = pastDefs.map(([id, fullname, start]) => ({ id, fullname, shortname: fullname, startdate: start, enddate: start + 150 * D, progress: 100 }));

const items: Record<number, [string, number, number | null][]> = {
  101: [["Prova 1", 3, 2.4], ["Projeto — entrega 1", 2, 1.8], ["Seminário", 1, 0.9], ["Prova 2", 3, null], ["Projeto — entrega 2", 1, null]],
  102: [["Lista SQL", 1, 0.7], ["Prova 1", 4, 2.6], ["Trabalho prático", 2, null], ["Prova 2", 3, null]],
  103: [["Lab 1", 1, 1], ["Lab 2", 1, 0.8], ["Prova 1", 4, 3.6], ["Lab 3", 1, null], ["Prova 2", 3, null]],
  104: [["Quiz 1", 1, 0.4], ["Prova 1", 4, 2.1], ["Projeto IA", 3, null], ["Prova 2", 2, null]],
  105: [["Fórum 1", 2, 2], ["Fórum 2", 2, 1.7], ["Estudo de caso", 3, 2.9], ["Atividade final", 3, null]],
};

// Média "até agora" (como o Moodle com "excluir notas vazias"): obtido / máximo já corrigido, em escala 10.
const currentGrades: Record<number, string> = Object.fromEntries(
  Object.entries(items).map(([id, list]) => {
    const graded = list.filter((i) => i[2] !== null);
    const got = graded.reduce((s, i) => s + (i[2] as number), 0);
    const max = graded.reduce((s, i) => s + i[1], 0);
    return [id, ((got / max) * 10).toFixed(2).replace(".", ",")];
  }),
);

// Modelo da instituição: VA1/VA2/VA3 de 100 pontos. Na demo, notas lançadas ficam na VA1 e o resto na VA2.
// A disciplina 105 fica sem categorias, para mostrar o caso "fora do modelo".
function gradeItems(courseid: number) {
  const list = (items[courseid] ?? []).map(([n, mx, g]) => [n, mx * 10, g === null ? null : g * 10] as const);
  const fmt = (n: number) => n.toFixed(2).replace(".", ",");
  const cyclic = courseid !== 105;
  const cat = (n: number) => courseid * 10 + n;
  return {
    usergrades: [
      {
        courseid,
        gradeitems: [
          ...list.map(([itemname, grademax, graderaw], i) => ({
            id: courseid * 100 + i,
            itemname,
            itemtype: "mod",
            itemmodule: i % 2 ? "quiz" : "assign",
            categoryid: cyclic ? cat(graderaw === null ? 2 : 1) : null,
            grademax,
            graderaw,
            // Simula o ícone de aprovado/reprovado que o AVA anexa quando o item tem nota para aprovação.
            gradeformatted:
              graderaw === null
                ? "-"
                : `${fmt(graderaw)} ${graderaw / grademax < 0.6 ? '<i class="icon fa fa-xmark text-danger fa-fw inline" title="Falha" role="img" aria-label="Falha"></i>' : '<i class="icon fa fa-check text-success fa-fw inline" title="Aprovado" role="img" aria-label="Aprovado"></i>'}`,
            percentageformatted: graderaw === null ? "-" : `${fmt((graderaw / grademax) * 100)} %`,
            gradedategraded: graderaw === null ? null : now - ((courseid + i * 3) % 12) * D - 3600 * i,
          })),
          ...(cyclic ? [1, 2, 3].map((n) => ({ id: cat(n) + 5000, itemname: `VA${n}`, itemtype: "category", iteminstance: cat(n), gradeformatted: "-" })) : []),
          { id: courseid * 100 + 99, itemname: "MÉDIA FINAL", itemtype: "course", gradeformatted: "-" },
        ],
      },
    ],
  };
}

const evDefs: [string, string, number, number][] = [
  ["Lista de exercícios 3", "assign", 104, -2 * D],
  ["Quiz — Normalização", "quiz", 102, 0.3 * D],
  ["Relatório do Lab 3", "assign", 103, 1.2 * D],
  ["Projeto — entrega 2", "assign", 101, 4 * D],
  ["Fórum: dilemas éticos", "forum", 105, 4.4 * D],
  ["Trabalho prático", "assign", 102, 9 * D],
  ["Projeto IA — protótipo", "assign", 104, 12 * D],
  ["Prova 2 (questionário)", "quiz", 103, 19 * D],
];
const events = evDefs.map(([name, mod, cid, off], i) => {
  const c = current.find((x) => x.id === cid)!;
  return {
    id: 900 + i,
    name: `${name} é para ${off < 0 ? "estava" : ""}`,
    activityname: name,
    modulename: mod,
    eventtype: "due",
    timestart: now + off,
    timesort: now + off,
    overdue: off < 0,
    course: { id: cid, fullname: c.fullname, shortname: c.shortname },
  };
});

const functions = [
  "core_webservice_get_site_info",
  "core_enrol_get_users_courses",
  "gradereport_overview_get_course_grades",
  "gradereport_user_get_grade_items",
  "mod_assign_get_assignments",
  "core_calendar_get_action_events_by_timesort",
  "core_course_get_contents",
  "mod_assign_get_submission_status",
  "mod_quiz_get_quizzes_by_courses",
  "mod_quiz_get_user_quiz_attempts",
  "mod_quiz_get_user_best_grade",
  "core_completion_get_activities_completion_status",
  "core_calendar_get_calendar_export_token",
  "core_user_get_users_by_field",
  "core_badges_get_user_badges",
  "core_calendar_get_calendar_events",
  "mod_quiz_get_quiz_access_information",
  "mod_quiz_get_attempt_access_information",
  "mod_quiz_get_quiz_required_qtypes",
  "mod_quiz_get_attempt_data",
  "mod_quiz_get_attempt_review",
].map((name) => ({ name, version: "demo" }));

const quizDefs = (cid: number) => [
  { id: cid * 100 + 1, name: "Quiz Avaliativo — Aula 4", timeclose: now - 6 * D, attempts: 2, grade: 1, state: "done" },
  { id: cid * 100 + 2, name: "Quiz Avaliativo — Aula 5", timeclose: now + 3 * D, attempts: 2, grade: 1, state: "progress" },
  { id: cid * 100 + 3, name: "Quiz de revisão", timeclose: now - 2 * D, attempts: 0, grade: 2, state: "none" },
  { id: cid * 100 + 4, name: "Simulado VA2", timeclose: now + 15 * D, attempts: 3, grade: 2, state: "none" },
];

const allQuizzes = () => current.flatMap((c) => quizDefs(c.id));
const findQuiz = (id: number) => allQuizzes().find((x) => x.id === id);

function demoAttempts(q: ReturnType<typeof quizDefs>[number]) {
  if (q.state === "none") return [];
  // Disciplinas ímpares usam navegação livre; pares, sequencial (no AVA isso varia por quiz).
  const free = Math.floor(q.id / 100) % 2 === 1;
  return [
    { id: q.id * 10 + 1, attempt: 1, state: "finished", timestart: now - 8 * D, timefinish: now - 8 * D + 903, sumgrades: 6, currentpage: 1, layout: "1,2,0,3,4,0", free },
    ...(q.state === "progress" ? [{ id: q.id * 10 + 2, attempt: 2, state: "inprogress", timestart: now - 600, timefinish: 0, sumgrades: null, currentpage: 0, layout: "1,2,0,3,4,0", free }] : []),
  ];
}

/** HTML no formato que o Moodle 4.x/5.x devolve para cada tipo de questão. */
function demoQuestions(aid: number, review: boolean) {
  const uid = aid;
  const radio = (slot: number, opts: string[], chosen: number | null, right: number, multiLetters = true) =>
    opts
      .map((t, i) => {
        const id = `q${uid}:${slot}_answer${i}`;
        const mark = review && chosen === i ? (i === right ? ' <i class="icon fa fa-check text-success fa-fw" title="Correto" aria-label="Correto"></i>' : ' <i class="icon fa fa-xmark text-danger fa-fw" title="Incorreto" aria-label="Incorreto"></i>') : "";
        const cls = review && chosen === i ? (i === right ? " correct" : " incorrect") : "";
        return `<div class="r${i % 2}${cls}"><input type="radio" name="q${uid}:${slot}_answer" value="${i}" id="${id}" aria-labelledby="${id}_label"${chosen === i ? ' checked="checked"' : ""}${review ? ' disabled="disabled"' : ""}><div class="d-flex w-auto" id="${id}_label" data-region="answer-label">${multiLetters ? `<span class="answernumber">${"abcde"[i]}. </span>` : ""}<div class="flex-fill ms-1">${t}</div></div>${mark}</div>`;
      })
      .join("");
  const wrap = (slot: number, type: string, stateCls: string, body: string, outcome = "") =>
    `<div id="question-${uid}-${slot}" class="que ${type} deferredfeedback ${stateCls}"><div class="info"><h3 class="no">Questão <span class="qno">${slot}</span></h3><div class="state">x</div><div class="grade">Vale 2,50 ponto(s).</div><div class="questionflag editable"><input type="hidden" name="q${uid}:${slot}_:flagged" value="0"><input type="checkbox" id="q${uid}:${slot}_:flaggedcheckbox" name="q${uid}:${slot}_:flagged" value="1"><label id="q${uid}:${slot}_:flaggedlabel" for="q${uid}:${slot}_:flaggedcheckbox">Marcar questão</label></div></div><div class="content"><div class="formulation clearfix"><h4 class="accesshide">Texto da questão</h4><input type="hidden" name="q${uid}:${slot}_:sequencecheck" value="${review ? 3 : 1}">${body}</div>${outcome}</div></div><script>alert("isto nunca deve rodar")</script>`;
  const outcome = (txt: string) => (review ? `<div class="outcome clearfix"><h4 class="accesshide">Feedback</h4><div class="feedback"><div class="rightanswer">${txt}</div></div></div>` : "");
  const qs = [
    {
      slot: 1, type: "multichoice", page: 0,
      body: `<div class="qtext"><p>Qual forma normal elimina <strong>dependências transitivas</strong>?</p></div><fieldset class="ablock no-overflow visual-scroll-x"><legend class="prompt h6 fw-normal visually-hidden">Escolha uma opção:</legend><div class="answer">${radio(1, ["1FN", "2FN", "3FN", "FNBC"], review ? 2 : 2, 2)}</div></fieldset>`,
      right: true, out: "A resposta correta é: 3FN",
    },
    {
      slot: 2, type: "truefalse", page: 0,
      body: `<div class="qtext"><p>Toda relação na FNBC também está na 3FN.</p><p><img src="https://avagrad.unievangelica.edu.br/pluginfile.php/123/question/questiontext/1/2/45/diagrama.png" alt="Diagrama de dependências" onerror="alert(1)" width="320"></p></div><fieldset class="ablock"><legend class="prompt h6 fw-normal visually-hidden">Escolha uma opção:</legend><div class="answer">${radio(2, ["Verdadeiro", "Falso"], review ? 1 : null, 0, false)}</div></fieldset>`,
      right: false, out: "A resposta correta é 'Verdadeiro'.",
    },
    {
      slot: 3, type: "shortanswer", page: 1,
      body: `<div class="qtext"><p>Qual comando SQL remove uma tabela inteira, incluindo a estrutura?</p></div><div class="ablock form-inline"><label for="q${uid}:3_answer">Resposta:</label><span class="answer"><input type="text" name="q${uid}:3_answer" id="q${uid}:3_answer" size="30" class="form-control d-inline" value="${review ? "DROP TABLE" : ""}"${review ? ' readonly="readonly"' : ""}></span></div>`,
      right: true, out: "A resposta correta é: DROP TABLE",
    },
    {
      slot: 4, type: "multichoice", page: 1,
      body: `<div class="qtext"><p>Em um índice B-Tree, a busca por igualdade tem custo:</p><a href="javascript:alert(1)">link malicioso</a></div><fieldset class="ablock"><legend class="prompt h6 fw-normal visually-hidden">Escolha uma opção:</legend><div class="answer">${radio(4, ["O(1)", "O(log n)", "O(n)", "O(n log n)"], review ? 0 : null, 1)}</div></fieldset>`,
      right: false, out: "A resposta correta é: O(log n)",
    },
  ];
  return qs.map((q) => {
    const answered = review || q.slot === 1;
    const state = review ? (q.right ? "gradedright" : "gradedwrong") : answered ? "complete" : "todo";
    return {
      slot: q.slot,
      type: q.type,
      page: q.page,
      number: q.slot,
      html: wrap(q.slot, q.type, review ? (q.right ? "correct" : "incorrect") : answered ? "answersaved" : "notyetanswered", q.body, outcome(q.out)),
      flagged: q.slot === 4 && !review,
      state,
      status: review ? (q.right ? "Correto" : "Incorreto") : answered ? "Resposta salva" : "Ainda não respondida",
      mark: review ? (q.right ? "2,50" : "0,00") : undefined,
      maxmark: 2.5,
      sequencecheck: review ? 3 : 1,
      blockedbyprevious: false,
    };
  });
}

function respond(fn: string, p: URLSearchParams): unknown {
  switch (fn) {
    case "core_webservice_get_site_info":
      return { sitename: "AVA (demonstração)", siteurl: "", userid: 1, release: "5.1.4 (Build: demo)", fullname: "MARIA DEMONSTRAÇÃO SILVA", username: "2024100123", userpictureurl: "https://avagrad.unievangelica.edu.br/theme/image.php/snap/core/1/u/f1", functions };
    case "core_enrol_get_users_courses":
      return [...current, ...past];
    case "gradereport_overview_get_course_grades":
      return {
        grades: [
          ...Object.entries(currentGrades).map(([id, grade]) => ({ courseid: Number(id), grade, rawgrade: grade })),
          ...pastDefs.map(([id, , , grade]) => ({ courseid: id, grade, rawgrade: grade })),
        ],
      };
    case "gradereport_user_get_grade_items":
      return gradeItems(Number(p.get("courseid")));
    case "core_calendar_get_action_events_by_timesort":
      return { events };
    case "mod_assign_get_assignments": {
      const cid = Number(p.get("courseids[0]"));
      return {
        courses: [
          {
            id: cid,
            assignments: events
              .filter((e) => e.course.id === cid && e.modulename === "assign")
              .map((e) => ({ id: e.id, cmid: e.id, course: cid, name: e.activityname, duedate: e.timesort, intro: "<p>Descrição da tarefa de exemplo.</p>" })),
          },
        ],
      };
    }
    case "core_course_get_contents":
      return [
        { id: 1, section: 0, name: "Geral", summary: "", modules: [{ id: 1, name: "Plano de ensino", modname: "resource", url: "#", contents: [] }, { id: 2, name: "Avisos", modname: "forum", url: "#" }] },
        { id: 2, section: 1, name: "Unidade 1", summary: "<p>Introdução</p>", modules: [{ id: 3, name: "Slides — aula 1", modname: "resource", url: "#" }, { id: 4, name: "Quiz 1", modname: "quiz", url: "#" }] },
      ];
    case "mod_assign_get_submission_status": {
      const id = Number(p.get("assignid"));
      const ev = events.find((e) => e.id === id);
      const submitted = id % 3 !== 0;
      return {
        lastattempt: {
          submission: { status: submitted ? "submitted" : ev && ev.timesort > now ? "draft" : "new", timemodified: now - 3 * D },
          gradingstatus: submitted && id % 2 ? "graded" : "notgraded",
          submissionsenabled: true,
        },
        feedback:
          submitted && id % 2
            ? {
                gradefordisplay: '1,70 / 2,00 <i class="icon fa fa-check text-success" title="Aprovado" aria-label="Aprovado"></i>',
                plugins: [{ type: "comments", name: "Comentários", editorfields: [{ name: "comments", text: "<p>Bom trabalho! Faltou detalhar os <b>critérios de aceitação</b>.</p>" }] }],
              }
            : undefined,
      };
    }
    case "mod_quiz_get_quizzes_by_courses": {
      const cid = Number(p.get("courseids[0]"));
      return {
        quizzes: quizDefs(cid).map((q) => ({
          ...q,
          coursemodule: q.id,
          course: cid,
          timeopen: 0,
          timelimit: 1800,
          sumgrades: 10,
          decimalpoints: 2,
          visible: true,
          navmethod: cid % 2 === 1 ? "free" : "sequential",
          intro: "<p>Responda com base no material da <b>aula</b>. Boa prova!</p>",
        })),
      };
    }
    case "mod_quiz_get_user_quiz_attempts": {
      const q = findQuiz(Number(p.get("quizid")));
      return { attempts: q ? demoAttempts(q) : [] };
    }
    case "mod_quiz_get_quiz_access_information":
      return {
        canattempt: true,
        canmanage: false,
        canpreview: false,
        canreviewmyattempts: true,
        canviewreports: false,
        accessrules: ["Tempo limite: 30 minutos", "Tentativas permitidas: 2", "Este questionário fecha em <b>sexta-feira</b>."],
        activerulenames: ["quizaccess_timelimit", "quizaccess_numattempts", "quizaccess_openclosedate"],
        preventaccessreasons: [],
        warnings: [],
      };
    case "mod_quiz_get_attempt_access_information": {
      const aid = Number(p.get("attemptid"));
      const a = aid ? allQuizzes().flatMap(demoAttempts).find((x) => x.id === aid) : undefined;
      return {
        endtime: a && a.state === "inprogress" ? a.timestart + 1800 : undefined,
        isfinished: a ? a.state === "finished" : false,
        preventnewattemptreasons: a?.state === "inprogress" ? ["Você já tem uma tentativa em andamento."] : [],
        warnings: [],
      };
    }
    case "mod_quiz_get_quiz_required_qtypes":
      return { questiontypes: ["multichoice", "truefalse", "shortanswer", "ddwtos"], warnings: [] };
    case "mod_quiz_get_attempt_data": {
      const aid = Number(p.get("attemptid"));
      const a = allQuizzes().flatMap(demoAttempts).find((x) => x.id === aid);
      const page = Number(p.get("page"));
      if (!a || a.state !== "inprogress") return { exception: "moodle_quiz_exception", errorcode: "attemptalreadyclosed", message: "Esta tentativa já foi finalizada." };
      if (page !== a.currentpage && !a.free) return { exception: "moodle_quiz_exception", errorcode: "outofsequenceaccess", message: "Acesso fora de sequência." };
      const qs = demoQuestions(aid, false).filter((q) => q.page === page);
      return { attempt: a, messages: [], nextpage: page >= 1 ? -1 : page + 1, questions: qs, warnings: [] };
    }
    case "mod_quiz_get_attempt_review": {
      const aid = Number(p.get("attemptid"));
      const a = allQuizzes().flatMap(demoAttempts).find((x) => x.id === aid);
      return {
        grade: "0,60",
        attempt: a,
        additionaldata: [
          { id: "startedon", title: "Iniciado em", content: "quarta-feira, 8 out 2026, 19:02" },
          { id: "state", title: "Estado", content: "Finalizada" },
          { id: "completedon", title: "Concluída em", content: "quarta-feira, 8 out 2026, 19:17" },
          { id: "timetaken", title: "Tempo empregado", content: "15 minutos 3 segundos" },
          { id: "marks", title: "Avaliar", content: "6,00/10,00" },
          { id: "grade", title: "Nota", content: "<b>0,60</b> de um máximo de 1,00(<b>60</b>%)" },
        ],
        questions: demoQuestions(aid, true),
        warnings: [],
      };
    }
    case "mod_quiz_get_user_best_grade":
      return Number(p.get("quizid")) % 2 ? { hasgrade: true, grade: 0.8, gradetopass: 0.6 } : { hasgrade: false };
    case "core_completion_get_activities_completion_status":
      return {
        statuses: [1, 2, 3, 4].map((cmid) => ({ cmid, modname: "resource", instance: cmid, state: cmid <= 2 ? 1 : 0, timecompleted: cmid <= 2 ? now - cmid * D : 0, hascompletion: true, uservisible: true })),
      };
    case "core_user_get_users_by_field":
      return [
        {
          id: 1,
          username: "2024100123",
          firstname: "MARIA DEMONSTRAÇÃO",
          lastname: "SILVA",
          fullname: "MARIA DEMONSTRAÇÃO SILVA",
          email: "maria.demo@exemplo.edu.br",
          institution: "UniEVANGÉLICA",
          department: "",
          idnumber: "2024100123",
          auth: "ldap",
          lang: "pt_br",
          firstaccess: ts(thisYear - 2, 8, 3),
          lastaccess: now - 3600,
          customfields: [
            { type: "text", shortname: "CUSTOM_FIELD_1", name: "Unidade Física", value: "Anápolis" },
            { type: "text", shortname: "CUSTOM_FIELD_2", name: "Curso", value: "Engenharia de Software" },
            { type: "text", shortname: "CUSTOM_FIELD_3", name: "Período", value: "5º" },
          ],
        },
      ];
    case "core_calendar_get_calendar_events":
      return {
        events: [
          { id: 1, name: "Ajustes de Grupos é devido", courseid: 105, modulename: "forum", instance: 1, eventtype: "due", timestart: now - 6 * D },
          { id: 2, name: "Trabalho prático está marcado(a) para esta data", courseid: 102, modulename: "assign", instance: 905, eventtype: "due", timestart: now - 2 * D },
          { id: 3, name: "Término de Quiz de revisão", courseid: 102, modulename: "quiz", instance: 10203, eventtype: "close", timestart: now - 1 * D + 3600 },
        ].filter((e) => e.timestart >= Number(p.get("options[timestart]")) && e.timestart <= Number(p.get("options[timeend]"))),
      };
    case "core_badges_get_user_badges":
      return { badges: [] };
    case "core_calendar_get_calendar_export_token":
      return { token: "demo0000000000000000000000000000000000000" };
    default:
      return { exception: "demo", errorcode: "invalidrecord", message: `Demo não implementa ${fn}` };
  }
}

export function installDemo() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/webservice/rest/server.php")) return realFetch(input, init);
    const p = new URLSearchParams(String(init?.body ?? ""));
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
    return new Response(JSON.stringify(respond(p.get("wsfunction") ?? "", p)), { headers: { "Content-Type": "application/json" } });
  };
}
