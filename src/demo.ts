// Modo demonstração (só em `npm run dev`, com ?demo na URL): responde às chamadas do Moodle
// com dados fictícios, sem tocar na rede. Útil para mexer no visual sem token.

import { quizFunctions, quizRespond } from "./demo-quiz";
import { assignFunctions, assignRespond, demoUpload } from "./demo-assign";

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

// [nome, valor (0–10), nota, prazo em dias a partir de hoje]
const items: Record<number, [string, number, number | null, number?][]> = {
  101: [["Prova 1", 3, 2.4, -40], ["Projeto — entrega 1", 2, 1.8, -35], ["Seminário", 1, 0.9], ["Prova 2", 3, null, 10], ["Projeto — entrega 2", 1, null, 4]],
  102: [["Lista SQL", 1, 1, -45], ["Prova 1", 4, 2.6, -38], ["Trabalho prático", 2, null, 9], ["Prova 2", 3, null, 14]],
  103: [["Lab 1", 1, 1], ["Lab 2", 1, 0.8], ["Prova 1", 4, 3.6, -36], ["Lab 3", 1, null], ["Prova 2", 3, null, 19]],
  104: [["Quiz 1", 1, 0.9], ["Prova 1", 4, 2.1, -37], ["Projeto IA", 3, null, 12], ["Prova 2", 2, null, -3]],
  105: [["Fórum 1", 2, 2], ["Fórum 2", 2, 1.7], ["Estudo de caso", 3, 2.9], ["Avaliação escrita", 3, null, -5]],
};
const isExamName = (n: string) => /prova|avalia[çc][ãa]o escrita/i.test(n);

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
            itemmodule: isExamName(itemname) || i % 2 === 0 ? "assign" : "quiz",
            iteminstance: courseid * 100 + i,
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
  "core_calendar_get_action_events_by_timesort",
  "core_course_get_contents",
  "core_completion_get_activities_completion_status",
  "core_calendar_get_calendar_export_token",
  "core_user_get_users_by_field",
  "core_badges_get_user_badges",
  "core_calendar_get_calendar_events",
  ...quizFunctions,
  ...assignFunctions,
].map((name) => ({ name, version: "demo" }));

// Materiais publicados ao longo do semestre. A 101 nomeia as seções por VA; as outras usam semanas
// (o ciclo sai da data de publicação).
const materialDefs: [string, string, number, string?][] = [
  ["Slides — aula 1: introdução", "resource", 3, "aula01.pdf"],
  ["Vídeo: visão geral da disciplina", "url", 5],
  ["Lista de exercícios 1", "resource", 12, "lista01.pdf"],
  ["Leitura complementar — capítulo 2", "page", 18],
  ["Slides — aula 4", "resource", 26, "aula04.pptx"],
  ["Material de apoio da VA1", "folder", 33],
  ["Gabarito comentado da Prova 1", "resource", 44, "gabarito-p1.pdf"],
  ["Slides — aula 7", "resource", 52, "aula07.pdf"],
  ["Artigo: estudo de caso", "url", 58],
  ["Lista de exercícios 2", "resource", 66, "lista02.pdf"],
  ["Apostila da unidade 3", "book", 74],
  ["Slides — aula 10", "resource", 80, "aula10.pdf"],
];
function contents(cid: number) {
  const base = "https://avagrad.unievangelica.edu.br/webservice/pluginfile.php/0/mod_resource/content/1";
  const mod = (i: number, [name, modname, day, file]: (typeof materialDefs)[number]) => {
    const t = curSemStart + day * D + cid * 3600;
    const files =
      modname === "folder"
        ? ["resumo.pdf", "mapa-mental.png", "exercicios-extras.pdf"].map((f) => ({ type: "file", filename: f, fileurl: `${base}/${f}`, timecreated: t, timemodified: t }))
        : modname === "resource"
          ? [{ type: "file", filename: file!, fileurl: `${base}/${file}`, timecreated: t, timemodified: t }]
          : [{ type: modname === "url" ? "url" : "file", filename: name, fileurl: "https://exemplo.org/material", timecreated: t, timemodified: t }];
    return { id: cid * 1000 + i, name, modname, url: `https://avagrad.unievangelica.edu.br/mod/${modname}/view.php?id=${cid * 1000 + i}`, contents: files };
  };
  const published = materialDefs.filter(([, , day]) => curSemStart + day * D < now);
  const geral = { id: 1, section: 0, name: "Geral", summary: "", modules: [mod(900, ["Plano de ensino", "resource", 0, "plano-de-ensino.pdf"]), { id: cid * 1000 + 901, name: "Avisos", modname: "forum", url: "#" }] };
  if (cid === 101) {
    const by = (lo: number, hi: number) => published.map((m, i) => [m, i] as const).filter(([m]) => m[2] >= lo && m[2] < hi).map(([m, i]) => mod(i, m));
    return [
      geral,
      { id: 2, section: 1, name: "VA1 — Requisitos", summary: "", modules: by(0, 40) },
      { id: 3, section: 2, name: "VA2 — Arquitetura", summary: "", modules: [...by(40, 200), { id: 101999, name: "Projeto — entrega 2", modname: "assign", url: "#" }] },
      { id: 4, section: 3, name: "VA3 — Testes", summary: "", modules: [] },
    ];
  }
  // Sem data em um item: cai em "Sem ciclo identificado".
  const weeks = published.map((m, i) => ({ id: 10 + i, section: i + 1, name: `Semana ${i + 1}`, summary: "", modules: [mod(i, m)] }));
  weeks.push({ id: 99, section: 99, name: "Extras", summary: "", modules: [{ id: cid * 1000 + 950, name: "Canal da disciplina", modname: "url", url: "https://avagrad.unievangelica.edu.br/mod/url/view.php?id=1", contents: [] } as never] });
  return [geral, ...weeks];
}

type AssignCourses = { courses: { id: number; assignments: Record<string, unknown>[] }[] };

/** Provas e entregas do quadro de notas viram tarefas com prazo, para o painel saber quando aconteceram. */
function withGradebookAssigns(r: AssignCourses): AssignCourses {
  return {
    courses: r.courses.map((c) => ({
      ...c,
      assignments: [
        ...c.assignments,
        ...(items[c.id] ?? []).flatMap(([name, , , due], i) =>
          due === undefined || !(isExamName(name) || i % 2 === 0) ? [] : [{ id: c.id * 100 + i, cmid: c.id * 100 + i, course: c.id, name, duedate: now + due * D, intro: "" }],
        ),
      ],
    })),
  };
}

function respond(fn: string, p: URLSearchParams): unknown {
  if (fn.startsWith("mod_quiz_")) return quizRespond(fn, p, current.map((c) => c.id));
  const assignResult = assignRespond(fn, p, events);
  if (fn === "mod_assign_get_assignments") return withGradebookAssigns(assignResult as AssignCourses);
  if (assignResult !== undefined) return assignResult;
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
    case "core_course_get_contents":
      return contents(Number(p.get("courseid")));
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
    if (url.includes("/webservice/upload.php") && init?.body instanceof FormData) {
      await new Promise((r) => setTimeout(r, 300));
      return new Response(JSON.stringify(demoUpload(init.body)), { headers: { "Content-Type": "application/json" } });
    }
    if (!url.includes("/webservice/rest/server.php")) return realFetch(input, init);
    const p = new URLSearchParams(String(init?.body ?? ""));
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
    return new Response(JSON.stringify(respond(p.get("wsfunction") ?? "", p)), { headers: { "Content-Type": "application/json" } });
  };
}
