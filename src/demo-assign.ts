// Tarefas do modo demonstração: simula o Moodle com estado em memória (até recarregar a página).
// Upload para a área de rascunho, salvar, enviar para avaliação, remover e tarefa com tempo.

const now = () => Math.floor(Date.now() / 1000);
const D = 86400;

export const assignFunctions = [
  "mod_assign_get_assignments",
  "mod_assign_get_submission_status",
  "core_files_get_unused_draft_itemid",
  "mod_assign_start_submission",
  "mod_assign_save_submission",
  "mod_assign_submit_for_grading",
  "mod_assign_remove_submission",
];

interface DemoFile {
  filename: string;
  blob: Blob;
  url: string;
  time: number;
}
interface DemoSub {
  status: "new" | "draft" | "submitted" | "reopened";
  files: DemoFile[];
  text: string;
  timemodified: number;
  timestarted?: number;
  graded?: boolean;
}
interface Setup {
  files?: { max: number; maxbytes: number; types: string };
  text?: { wordlimit: number };
  drafts: boolean;
  statement?: string;
  cutoffDays?: number;
  timelimit?: number;
  intro: string;
  introFile?: string;
  initial: () => DemoSub;
}

const demoFile = (filename: string, content: string, type = "application/pdf"): DemoFile => {
  const blob = new Blob([content], { type });
  return { filename, blob, url: URL.createObjectURL(blob), time: now() - 2 * D };
};
const empty = (): DemoSub => ({ status: "new", files: [], text: "", timemodified: 0 });

/** Configuração por tarefa (os ids batem com os eventos de prazo do demo). */
const SETUP: Record<number, Setup> = {
  900: {
    files: { max: 3, maxbytes: 0, types: "" },
    drafts: false,
    cutoffDays: 3,
    intro: "<p>Resolva a lista e envie as respostas (foto ou PDF). <b>Sem rascunho:</b> salvar já entrega.</p>",
    initial: empty,
  },
  902: {
    files: { max: 1, maxbytes: 2 * 1024 * 1024, types: ".pdf" },
    drafts: true,
    statement: "Declaro que este relatório é de minha autoria e que citei todas as fontes usadas.",
    intro: "<p>Envie o relatório do Lab 3 em <strong>um único PDF</strong> de até 2 MB, seguindo o roteiro anexo.</p>",
    introFile: "roteiro-lab3.pdf",
    initial: () => ({ status: "draft", files: [demoFile("relatorio-v1.pdf", "%PDF-1.4 rascunho do relatório")], text: "", timemodified: now() - 3600 }),
  },
  903: {
    files: { max: 3, maxbytes: 10 * 1024 * 1024, types: "" },
    text: { wordlimit: 200 },
    drafts: true,
    intro: "<p>Envie o código do projeto (zip) e um resumo de até 200 palavras.</p>",
    initial: () => ({
      status: "submitted",
      files: [demoFile("projeto-entrega2.zip", "PK demo", "application/zip")],
      text: "<p>Implementamos o módulo de <b>cadastro</b> e os testes de integração.</p><p>Faltou a tela de relatórios.</p>",
      timemodified: now() - 5 * D,
      graded: true,
    }),
  },
  905: {
    text: { wordlimit: 0 },
    drafts: false,
    intro: "<p>Responda no texto online: quais índices você criaria para a consulta do exercício 4? Justifique.</p>",
    initial: empty,
  },
  906: {
    files: { max: 2, maxbytes: 5 * 1024 * 1024, types: "document" },
    drafts: true,
    timelimit: 3600,
    intro: "<p>Tarefa com <b>tempo limite de 1 hora</b>: ao iniciar, o tempo começa a contar. Envie o documento do protótipo.</p>",
    initial: empty,
  },
};

const subs = new Map<number, DemoSub>();
const sub = (id: number) => {
  if (!subs.has(id)) subs.set(id, (SETUP[id]?.initial ?? empty)());
  return subs.get(id)!;
};

// Área de rascunho: itemid → arquivos.
const drafts = new Map<number, DemoFile[]>();
let nextDraft = 7000;

interface Ev {
  id: number;
  activityname: string;
  modulename: string;
  timesort: number;
  course: { id: number };
}

const fileOut = (f: DemoFile) => ({ filename: f.filename, filepath: "/", filesize: f.blob.size, fileurl: f.url, timemodified: f.time, mimetype: f.blob.type });

function assignmentOut(e: Ev) {
  const s = SETUP[e.id] ?? { drafts: true, intro: "<p>Descrição da tarefa de exemplo.</p>", initial: empty, files: { max: 1, maxbytes: 0, types: "" } };
  const configs: { plugin: string; subtype: string; name: string; value: string }[] = [];
  const c = (plugin: string, name: string, value: string | number) => configs.push({ plugin, subtype: "assignsubmission", name, value: String(value) });
  c("file", "enabled", s.files ? 1 : 0);
  if (s.files) {
    c("file", "maxfilesubmissions", s.files.max);
    c("file", "maxsubmissionsizebytes", s.files.maxbytes);
    c("file", "filetypeslist", s.files.types);
  }
  c("onlinetext", "enabled", s.text ? 1 : 0);
  if (s.text) {
    c("onlinetext", "wordlimit", s.text.wordlimit);
    c("onlinetext", "wordlimitenabled", s.text.wordlimit ? 1 : 0);
  }
  return {
    id: e.id,
    cmid: e.id,
    course: e.course.id,
    name: e.activityname,
    grade: 10,
    duedate: e.timesort,
    cutoffdate: s.cutoffDays ? e.timesort + s.cutoffDays * D : 0,
    allowsubmissionsfromdate: 0,
    submissiondrafts: s.drafts ? 1 : 0,
    nosubmissions: 0,
    requiresubmissionstatement: s.statement ? 1 : 0,
    submissionstatement: s.statement,
    teamsubmission: 0,
    timelimit: s.timelimit ?? 0,
    intro: s.intro,
    introattachments: s.introFile ? [fileOut(demoFile(s.introFile, "%PDF roteiro"))] : [],
    configs,
  };
}

function isOpen(e: Ev) {
  const s = SETUP[e.id];
  const limit = s?.cutoffDays ? e.timesort + s.cutoffDays * D : Infinity;
  return now() <= limit;
}

const warn = (warningcode: string, message: string) => [{ item: "", itemid: 0, warningcode, message }];

export function assignRespond(fn: string, p: URLSearchParams, events: Ev[]): unknown {
  if (/save_submission|submit_for_grading|start_submission|remove_submission|unused_draft/.test(fn)) console.info(`[demo] escrita: ${fn} ${decodeURIComponent(p.toString()).replace(/wstoken=[^&]*&?/, "").slice(0, 200)}`);
  const assigns = events.filter((e) => e.modulename === "assign");
  const byId = (id: number) => assigns.find((e) => e.id === id);
  switch (fn) {
    case "mod_assign_get_assignments": {
      const cid = Number(p.get("courseids[0]"));
      return { courses: [{ id: cid, assignments: assigns.filter((e) => e.course.id === cid).map(assignmentOut) }] };
    }
    case "mod_assign_get_submission_status": {
      const id = Number(p.get("assignid"));
      const e = byId(id);
      if (!e) return { exception: "demo", errorcode: "invalidrecord", message: "Tarefa não encontrada" };
      const s = SETUP[id];
      const st = sub(id);
      const open = isOpen(e);
      const canedit = open && !(s?.drafts !== false && st.status === "submitted");
      const plugins = [
        ...(s?.files ? [{ type: "file", name: "Envio de arquivos", fileareas: [{ area: "submission_files", files: st.files.map(fileOut) }] }] : []),
        ...(s?.text ? [{ type: "onlinetext", name: "Texto online", editorfields: [{ name: "onlinetext", description: "Texto online", text: st.text, format: 1 }] }] : []),
      ];
      return {
        lastattempt: {
          submission: { id, userid: 1, attemptnumber: 0, status: st.status, timecreated: st.timemodified, timemodified: st.timemodified, timestarted: st.timestarted, plugins },
          submissiongroupmemberswhoneedtosubmit: [],
          submissionsenabled: true,
          locked: false,
          graded: !!st.graded,
          canedit,
          caneditowner: canedit,
          cansubmit: !!s?.drafts && st.status === "draft",
          extensionduedate: null,
          timelimit: s?.timelimit ?? 0,
          blindmarking: false,
          gradingstatus: st.graded ? "graded" : "notgraded",
        },
        feedback: st.graded
          ? {
              gradefordisplay: "8,50 / 10,00",
              gradeddate: now() - 2 * D,
              plugins: [
                { type: "comments", name: "Comentários de feedback", editorfields: [{ name: "comments", text: "<p>Bom trabalho! Faltou documentar a <b>API de relatórios</b>. Veja as anotações no PDF.</p>", format: 1 }] },
                { type: "file", name: "Arquivos de feedback", fileareas: [{ area: "feedback_files", files: [fileOut(demoFile("correcao-anotada.pdf", "%PDF correção"))] }] },
              ],
            }
          : undefined,
        warnings: [],
      };
    }
    case "core_files_get_unused_draft_itemid": {
      const itemid = nextDraft++;
      drafts.set(itemid, []);
      return { component: "user", contextid: 1, userid: 1, filearea: "draft", itemid, warnings: [] };
    }
    case "mod_assign_start_submission": {
      const id = Number(p.get("assignid"));
      sub(id).timestarted = now();
      return { submissionid: id, warnings: [] };
    }
    case "mod_assign_save_submission": {
      const id = Number(p.get("assignmentid"));
      const e = byId(id);
      const s = SETUP[id];
      const st = sub(id);
      if (!e || !isOpen(e)) return warn("submissionnotopen", "Esta tarefa não está aceitando envios.");
      if (s?.drafts !== false && st.status === "submitted") return warn("submissionlocked", "O envio já foi enviado para avaliação.");
      const fid = p.get("plugindata[files_filemanager]");
      const text = p.get("plugindata[onlinetext_editor][text]");
      const newFiles = fid !== null ? (drafts.get(Number(fid)) ?? []) : st.files;
      if (s?.files) {
        if (newFiles.length > s.files.max) return warn("toomanyfiles", `No máximo ${s.files.max} arquivo(s).`);
        if (s.files.types === ".pdf" && newFiles.some((f) => !f.filename.toLowerCase().endsWith(".pdf"))) return warn("filetype", "Tipo de arquivo não permitido: só .pdf.");
      }
      const newText = text ?? st.text;
      if (!newFiles.length && !newText.replace(/<[^>]*>/g, "").trim()) return warn("submissionempty", "Nada foi enviado.");
      st.files = newFiles.map((f) => ({ ...f, time: now() }));
      st.text = newText;
      st.status = s?.drafts === false ? "submitted" : "draft";
      st.timemodified = now();
      return [];
    }
    case "mod_assign_submit_for_grading": {
      const id = Number(p.get("assignmentid"));
      const s = SETUP[id];
      const st = sub(id);
      if (s?.statement && p.get("acceptsubmissionstatement") !== "1") return warn("submissionstatementrequired", "Você precisa aceitar a declaração de autoria.");
      if (st.status !== "draft") return warn("nodraft", "Não há rascunho para enviar.");
      st.status = "submitted";
      st.timemodified = now();
      return [];
    }
    case "mod_assign_remove_submission": {
      const id = Number(p.get("assignid"));
      const st = sub(id);
      st.files = [];
      st.text = "";
      st.status = "new";
      st.timemodified = now();
      return { status: true, warnings: [] };
    }
  }
  return undefined;
}

/** Simula webservice/upload.php: grava os arquivos na área de rascunho (itemid 0 = nova). */
export function demoUpload(form: FormData) {
  let itemid = Number(form.get("itemid") ?? 0);
  if (!itemid) {
    itemid = nextDraft++;
    drafts.set(itemid, []);
  }
  const area = drafts.get(itemid) ?? [];
  drafts.set(itemid, area);
  const out = [];
  for (const [key, value] of form) {
    if (!key.startsWith("file_") || !(value instanceof Blob)) continue;
    let name = (value as File).name || "arquivo";
    // Como o Moodle: nome repetido na mesma área ganha sufixo.
    for (let n = 1; area.some((f) => f.filename === name); n++) name = name.replace(/( \(\d+\))?(\.[^.]+)?$/, ` (${n})$2`);
    area.push({ filename: name, blob: value, url: URL.createObjectURL(value), time: now() });
    out.push({ component: "user", contextid: 1, userid: "1", filearea: "draft", filename: name, filepath: "/", itemid, license: "allrightsreserved", author: "Demo", source: "" });
  }
  console.info(`[demo] upload: ${out.map((f) => f.filename).join(", ")} → área ${itemid}`);
  return out;
}
