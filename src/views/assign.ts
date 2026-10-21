// Tarefa: enunciado, seu envio (arquivos e texto online), editar/salvar, enviar para avaliação e feedback.
//
// Escrita no AVA só acontece aqui e nos questionários, e só com as funções de WRITE_FUNCTIONS do cliente:
// - salvar pede confirmação quando a tarefa não usa rascunho (salvar já entrega);
// - "Enviar para avaliação" e "Remover envio" sempre pedem confirmação.
//
// Como o Moodle grava um envio de arquivo: (1) upload para a área de rascunho, (2) save_submission com o
// itemid dessa área. A área SUBSTITUI os arquivos do envio, então os que você mantém são baixados e
// enviados de novo junto com os novos (o app oficial faz o mesmo).

import type { Assignment, MoodleFile, Submission, SubmissionStatus } from "../moodle/api";
import { MoodleError, type UploadFile } from "../moodle/client";
import { api, nowS, opts, site, state } from "../state";
import { courseName } from "../data";
import { cleanGradeHtml, fmtDateTime, fmtRelative, stripHtml } from "../format";
import { shell } from "../layout";
import { renderMoodleHtml } from "../question-html";
import { card, confirmDialog, h, statTile, type Child } from "../ui";

export const assignHref = (cid: number, aid: number) => `#/disciplina/${cid}/tarefa/${aid}`;

const WRITE_FNS = ["mod_assign_save_submission", "core_files_get_unused_draft_itemid"];
const canWrite = () => WRITE_FNS.every((f) => state.available.has(f));

// ---------- Configuração da tarefa ----------

/** Grupos de tipos de arquivo do Moodle mais comuns → extensões. Grupo desconhecido: o AVA valida. */
const TYPE_GROUPS: Record<string, string[]> = {
  document: [".doc", ".docx", ".epub", ".gdoc", ".odt", ".ott", ".oth", ".pdf", ".rtf"],
  spreadsheet: [".csv", ".gsheet", ".ods", ".ots", ".xls", ".xlsx", ".xlsm"],
  presentation: [".gslides", ".odp", ".otp", ".pps", ".ppt", ".pptx", ".pptm"],
  image: [".ai", ".bmp", ".gdraw", ".gif", ".ico", ".jpe", ".jpeg", ".jpg", ".pct", ".pic", ".pict", ".png", ".svg", ".svgz", ".tif", ".tiff", ".webp"],
  web_image: [".gif", ".jpe", ".jpeg", ".jpg", ".png", ".svg", ".svgz", ".webp"],
  archive: [".7z", ".gz", ".rar", ".tar", ".tgz", ".zip"],
  audio: [".aac", ".aif", ".aiff", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".wav", ".wma"],
  video: [".avi", ".flv", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".ogv", ".webm", ".wmv"],
  html_track: [".vtt"],
};

interface Limits {
  files: { enabled: boolean; max: number; maxbytes: number; types: string[] | null; label: string };
  text: { enabled: boolean; wordlimit: number | null };
}

function cfg(a: Assignment, plugin: string, name: string) {
  return a.configs?.find((c) => c.subtype === "assignsubmission" && c.plugin === plugin && c.name === name)?.value;
}

function limitsOf(a: Assignment): Limits {
  const raw = (cfg(a, "file", "filetypeslist") ?? "").trim();
  let types: string[] | null = null;
  const parts = raw ? raw.split(/[\s,;]+/).filter(Boolean) : [];
  if (parts.length && !parts.includes("*")) {
    const exts: string[] = [];
    let unknown = false;
    for (const p of parts) {
      if (p.startsWith(".")) exts.push(p.toLowerCase());
      else if (TYPE_GROUPS[p]) exts.push(...TYPE_GROUPS[p]);
      else unknown = true; // tipo MIME ou grupo que não conhecemos: deixa o AVA validar
    }
    if (!unknown) types = [...new Set(exts)];
  }
  const wl = Number(cfg(a, "onlinetext", "wordlimit") ?? 0);
  return {
    files: {
      enabled: cfg(a, "file", "enabled") === "1",
      max: Number(cfg(a, "file", "maxfilesubmissions") ?? 0) || 20,
      maxbytes: Number(cfg(a, "file", "maxsubmissionsizebytes") ?? 0),
      types,
      label: parts.length && !parts.includes("*") ? parts.join(", ") : "qualquer tipo",
    },
    text: { enabled: cfg(a, "onlinetext", "enabled") === "1", wordlimit: cfg(a, "onlinetext", "wordlimitenabled") === "1" && wl > 0 ? wl : null },
  };
}

const extOf = (name: string) => (name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();

function fmtBytes(n?: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** Contagem de palavras parecida com a do Moodle (sem HTML, separando por espaço). */
const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Texto simples → HTML (parágrafos por linha em branco, quebra de linha → <br>). */
function textToHtml(text: string) {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** HTML do envio → texto editável. */
function htmlToText(html: string) {
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}
/** O texto tem formatação que se perderia ao editar como texto simples? */
const hasFormatting = (html: string) => /<(b|strong|i|em|u|ul|ol|table|img|a|h\d|span style|sup|sub)\b/i.test(html);

// ---------- Envio atual ----------

function currentSubmission(a: Assignment, st: SubmissionStatus): Submission | undefined {
  const la = st.lastattempt;
  return a.teamsubmission ? (la?.teamsubmission ?? la?.submission) : (la?.submission ?? la?.teamsubmission);
}
const filesOf = (sub?: Submission) => sub?.plugins?.find((p) => p.type === "file")?.fileareas?.find((f) => f.area === "submission_files")?.files ?? [];
const textOf = (sub?: Submission) => sub?.plugins?.find((p) => p.type === "onlinetext")?.editorfields?.[0]?.text ?? "";

function statusChip(a: Assignment, st: SubmissionStatus, now: number) {
  const sub = currentSubmission(a, st);
  const la = st.lastattempt;
  const due = la?.extensionduedate || a.duedate;
  if (a.nosubmissions) return h("span", { class: "chip" }, "Sem envio pelo AVA");
  switch (sub?.status) {
    case "submitted":
      return h("span", { class: "chip good" }, "✓ Enviada para avaliação");
    case "draft":
      return h("span", { class: "chip warn" }, "⏱ Rascunho (não enviado)");
    case "reopened":
      return h("span", { class: "chip warn" }, "↺ Reaberta pelo professor");
    default:
      return due && due < now ? h("span", { class: "chip bad" }, "✕ Não enviada") : h("span", { class: "chip" }, "Não enviada");
  }
}

const errMsg = (e: unknown) => (e instanceof MoodleError ? `${e.message}${/^(warning|unknown)$/.test(e.errorcode) ? "" : ` (${e.errorcode})`}` : (e as Error)?.message ?? String(e));

function fileLink(f: MoodleFile) {
  return h(
    "a",
    { href: state.client!.fileUrl(f.fileurl), target: "_blank", rel: "noreferrer", class: "file-link" },
    `📄 ${f.filename}`,
    f.filesize ? h("span", { class: "muted small" }, ` · ${fmtBytes(f.filesize)}`) : null,
  );
}

// ---------- Página ----------

export async function assignPage(cid: number, aid: number, rid: number) {
  const uid = site().userid;
  const [courses, assigns] = await Promise.all([api().courses(uid), api().assignments([cid])]);
  const course = courses.find((c) => c.id === cid);
  const a = assigns.find((x) => x.id === aid);
  if (!a) throw new Error("Tarefa não encontrada nesta disciplina (ou não está visível para você).");
  // Do cache (na hora); se vencido, a versão nova chega em segundo plano e a tela se atualiza.
  // Depois de salvar/enviar a situação é sempre buscada de novo.
  const st = await api().submissionStatus(aid, opts());
  if (rid !== state.routeId) return;

  const now = nowS();
  const la = st.lastattempt;
  const sub = currentSubmission(a, st);
  const lim = limitsOf(a);
  const files = filesOf(sub);
  const text = textOf(sub);
  const hasContent = files.length > 0 || stripHtml(text).length > 0;
  const due = la?.extensionduedate || a.duedate;
  const drafts = a.submissiondrafts === 1;
  const timed = (a.timelimit ?? la?.timelimit ?? 0) > 0;
  const started = !timed || !!sub?.timestarted;
  const editable = !!la?.canedit && canWrite() && !a.nosubmissions;
  const cname = course ? courseName(course) : `Disciplina ${cid}`;
  const grade = cleanGradeHtml(st.feedback?.gradefordisplay).text;
  const msg = h("div", {});

  const refresh = async () => {
    await api().submissionStatus(aid, { refresh: true }).catch(() => {});
    state.route();
  };
  const fail = (what: string, e: unknown) => msg.replaceChildren(h("div", { class: "error" }, `${what}: ${errMsg(e)}`));

  // ---- ações ----
  const startTimed = async (btn: HTMLButtonElement) => {
    const r = await confirmDialog({
      title: "Iniciar a tarefa?",
      body: h("p", {}, h("strong", {}, `O tempo de ${Math.round((a.timelimit ?? la?.timelimit ?? 0) / 60)} min começa agora`), " e continua correndo mesmo se você fechar a página."),
      confirmLabel: "Iniciar",
    });
    if (!r.ok) return;
    btn.disabled = true;
    try {
      await api().startSubmission(aid);
      await refresh();
    } catch (e) {
      btn.disabled = false;
      fail("Não foi possível iniciar", e);
    }
  };

  const submit = async (btn: HTMLButtonElement) => {
    const r = await confirmDialog({
      title: "Enviar para avaliação?",
      body: [
        h("p", {}, h("strong", {}, "Depois de enviar, você não poderá mais mudar o envio"), " (só se o professor reabrir)."),
        h("p", {}, files.length ? `${files.length} arquivo(s): ${files.map((f) => f.filename).join(", ")}` : "Nenhum arquivo.", stripHtml(text) ? ` Texto com ${countWords(stripHtml(text))} palavra(s).` : ""),
      ],
      confirmLabel: "Enviar para avaliação",
      danger: true,
      checkbox: a.requiresubmissionstatement ? stripHtml(a.submissionstatement ?? "") || "Declaro que este trabalho é de minha autoria." : undefined,
    });
    if (!r.ok) return;
    btn.disabled = true;
    btn.textContent = "Enviando…";
    try {
      await api().submitForGrading(aid, !!a.requiresubmissionstatement);
      await refresh();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Enviar para avaliação";
      fail("Não foi possível enviar", e);
    }
  };

  const remove = async (btn: HTMLButtonElement) => {
    const r = await confirmDialog({
      title: "Remover o envio?",
      body: h("p", {}, "Os arquivos e o texto deste envio serão apagados do AVA."),
      confirmLabel: "Remover",
      danger: true,
    });
    if (!r.ok) return;
    btn.disabled = true;
    try {
      await api().removeSubmission(aid, uid);
      await refresh();
    } catch (e) {
      btn.disabled = false;
      fail("Não foi possível remover", e);
    }
  };

  // ---- cartão "Seu envio" ----
  const view = () =>
    h(
      "div",
      {},
      hasContent
        ? [
            files.length > 0 && h("div", { class: "file-list" }, files.map(fileLink)),
            stripHtml(text) && h("div", { class: "qhtml submitted-text" }, renderMoodleHtml(text)),
            sub?.timemodified && h("p", { class: "note" }, `Última alteração: ${fmtDateTime(sub.timemodified)}`),
          ]
        : h("p", { class: "empty" }, "Nada enviado ainda."),
      la?.submissiongroupmemberswhoneedtosubmit?.length
        ? h("p", { class: "note" }, `Envio em grupo: ${la.submissiongroupmemberswhoneedtosubmit.length} membro(s) ainda precisam confirmar.`)
        : null,
    );

  const actions: HTMLElement[] = [];
  if (editable && timed && !started) {
    const b: HTMLButtonElement = h("button", { class: "primary", onclick: () => startTimed(b) }, "Iniciar tarefa");
    actions.push(b);
  } else if (editable) {
    actions.push(
      h(
        "button",
        {
          class: "primary",
          onclick: () => {
            state.hold = true; // editando: atualização em segundo plano não redesenha a tela
            slot.replaceChildren(editor());
          },
        },
        hasContent ? "Editar envio" : "Adicionar envio",
      ),
    );
    if (hasContent) {
      const b: HTMLButtonElement = h("button", { class: "ghost", onclick: () => remove(b) }, "Remover envio");
      actions.push(b);
    }
  }
  if (la?.cansubmit && drafts && sub?.status !== "submitted" && state.available.has("mod_assign_submit_for_grading")) {
    const b: HTMLButtonElement = h("button", { class: "danger", onclick: () => submit(b) }, "Enviar para avaliação");
    actions.push(h("span", { class: "spacer" }), b);
  }

  // ---- editor ----
  const editor = () => {
    const kept: MoodleFile[] = [...files];
    const added: File[] = [];
    const original = htmlToText(text);
    const list = h("div", { class: "file-list editable" });
    const problems = h("div", {});
    const progress = h("p", { class: "note", "aria-live": "polite" });
    const input = h("input", { type: "file", multiple: lim.files.max > 1, accept: lim.files.types?.join(",") ?? "", hidden: true });
    const area = h("textarea", { rows: 10, placeholder: "Escreva sua resposta…" }, original);
    const counter = h("span", { class: "muted small" });

    const validate = (): string[] => {
      const out: string[] = [];
      const total = kept.length + added.length;
      if (lim.files.enabled && total > lim.files.max) out.push(`No máximo ${lim.files.max} arquivo(s); você tem ${total}.`);
      for (const f of added) {
        if (lim.files.maxbytes && f.size > lim.files.maxbytes) out.push(`“${f.name}” tem ${fmtBytes(f.size)}; o limite é ${fmtBytes(lim.files.maxbytes)}.`);
        if (lim.files.types && !lim.files.types.includes(extOf(f.name))) out.push(`“${f.name}”: tipo não aceito (${lim.files.label}).`);
        if (f.size === 0) out.push(`“${f.name}” está vazio.`);
      }
      if (lim.text.enabled && lim.text.wordlimit && countWords(area.value) > lim.text.wordlimit) out.push(`O texto passou do limite de ${lim.text.wordlimit} palavras.`);
      return out;
    };
    const redraw = () => {
      list.replaceChildren(
        ...kept.map((f, i) =>
          h("div", { class: "file-row" }, fileLink(f), h("span", { class: "chip" }, "já enviado"), h("button", { type: "button", class: "icon-btn", "aria-label": `Tirar ${f.filename}`, onclick: () => (kept.splice(i, 1), redraw()) }, "✕")),
        ),
        ...added.map((f, i) =>
          h(
            "div",
            { class: "file-row" },
            h("span", { class: "file-link" }, `📄 ${f.name}`, h("span", { class: "muted small" }, ` · ${fmtBytes(f.size)}`)),
            h("span", { class: "chip grade" }, "novo"),
            h("button", { type: "button", class: "icon-btn", "aria-label": `Tirar ${f.name}`, onclick: () => (added.splice(i, 1), redraw()) }, "✕"),
          ),
        ),
      );
      if (!kept.length && !added.length) list.append(h("p", { class: "empty" }, "Nenhum arquivo."));
      const p = validate();
      problems.replaceChildren(...(p.length ? [h("div", { class: "error" }, h("ul", {}, p.map((x) => h("li", {}, x))))] : []));
      const wc = countWords(area.value);
      counter.textContent = lim.text.wordlimit ? `${wc} / ${lim.text.wordlimit} palavras` : `${wc} palavra(s)`;
      counter.className = `small ${lim.text.wordlimit && wc > lim.text.wordlimit ? "bad-text" : "muted"}`;
    };
    const addFiles = (fl: FileList | null) => {
      for (const f of Array.from(fl ?? [])) {
        // Mesmo nome: o novo substitui o antigo.
        const k = kept.findIndex((x) => x.filename === f.name);
        if (k >= 0) kept.splice(k, 1);
        const n = added.findIndex((x) => x.name === f.name);
        if (n >= 0) added.splice(n, 1);
        added.push(f);
      }
      input.value = "";
      redraw();
    };
    input.addEventListener("change", () => addFiles(input.files));
    area.addEventListener("input", redraw);

    const drop = h(
      "label",
      { class: "dropzone" },
      input,
      h("strong", {}, "Escolher arquivos"),
      h("span", { class: "muted small" }, " ou arraste aqui"),
      h(
        "div",
        { class: "muted small" },
        `Até ${lim.files.max} arquivo(s) · ${lim.files.maxbytes ? `até ${fmtBytes(lim.files.maxbytes)} cada` : "tamanho máximo definido pelo AVA"} · ${lim.files.label}`,
      ),
    );
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      addFiles(e.dataTransfer?.files ?? null);
    });

    const saveLabel = drafts ? "Salvar rascunho" : "Salvar e entregar";
    const save = async (btn: HTMLButtonElement) => {
      const p = validate();
      if (p.length) return problems.scrollIntoView({ block: "center" });
      const textChanged = area.value.trim() !== original.trim();
      if (lim.files.enabled && !kept.length && !added.length && !(lim.text.enabled && area.value.trim())) {
        return problems.replaceChildren(h("div", { class: "error" }, "O envio está vazio: adicione um arquivo ou escreva o texto."));
      }
      if (!drafts) {
        const r = await confirmDialog({
          title: "Salvar e entregar?",
          body: h("p", {}, "Esta tarefa não tem rascunho: ", h("strong", {}, "salvar já entrega o envio"), ". Enquanto o prazo estiver aberto, você ainda pode editar."),
          confirmLabel: "Salvar e entregar",
          checkbox: a.requiresubmissionstatement ? stripHtml(a.submissionstatement ?? "") || "Declaro que este trabalho é de minha autoria." : undefined,
        });
        if (!r.ok) return;
      }
      btn.disabled = true;
      cancel.disabled = true;
      try {
        let filesItem: number | undefined;
        if (lim.files.enabled) {
          const all: UploadFile[] = [];
          // Os que você manteve são baixados e enviados de novo (a área de rascunho substitui o envio).
          for (const [i, f] of kept.entries()) {
            progress.textContent = `Preparando arquivo já enviado ${i + 1} de ${kept.length}…`;
            const res = await fetch(state.client!.fileUrl(f.fileurl));
            if (!res.ok) throw new Error(`Não foi possível baixar “${f.filename}” para manter no envio (HTTP ${res.status}).`);
            all.push({ name: f.filename, blob: await res.blob() });
          }
          all.push(...added.map((f) => ({ name: f.name, blob: f as Blob })));
          if (!all.length) filesItem = await api().newDraftArea();
          else {
            filesItem = 0;
            for (const [i, f] of all.entries()) {
              progress.textContent = `Enviando arquivo ${i + 1} de ${all.length}: ${f.name}…`;
              const r = await api().uploadDraft([f], filesItem);
              filesItem = r[0]?.itemid ?? filesItem;
            }
          }
        }
        let textData: { html: string; itemid: number } | undefined;
        if (lim.text.enabled) {
          progress.textContent = "Salvando texto…";
          const html = textChanged ? textToHtml(area.value) : text;
          textData = { html, itemid: await api().newDraftArea() };
        }
        progress.textContent = "Salvando o envio no AVA…";
        await api().saveSubmission(aid, { files: filesItem, text: textData });
        progress.textContent = "";
        await refresh();
      } catch (e) {
        progress.textContent = "";
        btn.disabled = false;
        cancel.disabled = false;
        problems.replaceChildren(h("div", { class: "error" }, `Não foi possível salvar: ${errMsg(e)}`));
      }
    };
    const saveBtn: HTMLButtonElement = h("button", { class: "primary", onclick: () => save(saveBtn) }, saveLabel);
    const cancel: HTMLButtonElement = h(
      "button",
      {
        onclick: () => {
          state.hold = false;
          slot.replaceChildren(h("div", {}, view(), actionRow()));
        },
      },
      "Cancelar",
    );

    redraw();
    return h(
      "div",
      { class: "assign-editor" },
      lim.files.enabled && [h("h3", {}, "Arquivos"), list, drop],
      lim.text.enabled && [
        h("h3", {}, "Texto online"),
        area,
        h("div", { class: "editor-foot" }, counter, hasFormatting(text) && h("span", { class: "muted small" }, "⚠ Se você mudar o texto, a formatação anterior (negrito, listas…) vira texto simples.")),
      ],
      problems,
      progress,
      h("div", { class: "attempt-actions" }, cancel, h("span", { class: "spacer" }), saveBtn),
      h(
        "p",
        { class: "note" },
        drafts
          ? "Salvar grava um rascunho no AVA; o professor só recebe depois de “Enviar para avaliação”."
          : "Nesta tarefa não há rascunho: salvar já entrega. Dá para editar enquanto o prazo estiver aberto.",
      ),
    );
  };

  const actionRow = () => (actions.length ? h("div", { class: "attempt-actions" }, actions) : null);
  const slot = h("div", {}, view(), actionRow());

  const types = [lim.files.enabled && "Arquivo", lim.text.enabled && (lim.files.enabled ? "texto" : "Texto")].filter(Boolean).join(" + ");
  // "8,50 / 10,00" → valor grande "8,50" e "de 10,00" embaixo.
  const [gradeValue, gradeMax] = grade && grade !== "-" ? grade.split(/\s*\/\s*/) : ["", ""];
  const deadlineNote =
    !la?.canedit && !a.nosubmissions && sub?.status !== "submitted"
      ? a.allowsubmissionsfromdate && a.allowsubmissionsfromdate > now
        ? `O envio abre ${fmtDateTime(a.allowsubmissionsfromdate)}.`
        : "O AVA não está aceitando envios nesta tarefa agora (prazo encerrado ou envio bloqueado)."
      : null;
  const intro = a.intro && stripHtml(a.intro) ? a.intro : "";
  const introFiles = st.assignmentdata?.attachments?.intro ?? a.introattachments ?? [];

  shell(
    h(
      "div",
      { class: "page-head" },
      h("div", {}, h("p", { class: "eyebrow" }, h("a", { href: `#/disciplina/${cid}` }, `← ${cname}`)), h("h1", {}, a.name)),
      h("div", { class: "status-slot" }, statusChip(a, st, now), timed && sub?.timestarted && a.timelimit ? countdown(sub.timestarted + a.timelimit) : null),
    ),
    h(
      "div",
      { class: "tiles" },
      statTile(
        due && due < now ? "Prazo encerrado" : "Prazo",
        due ? fmtRelative(due) : "sem prazo",
        due ? `${fmtDateTime(due)}${la?.extensionduedate ? " · prorrogado" : ""}` : undefined,
        { tone: due && due < now && sub?.status !== "submitted" ? "bad" : undefined },
      ),
      // No Moodle, sem data de corte o envio atrasado é aceito (só fica marcado como atrasado).
      statTile(
        a.cutoffdate && due && a.cutoffdate >= now ? "Aceita com atraso até" : "Envio atrasado",
        !due ? "–" : a.cutoffdate ? (a.cutoffdate < now ? "encerrado" : fmtRelative(a.cutoffdate)) : "aceito",
        !due ? "a tarefa não tem prazo" : a.cutoffdate ? fmtDateTime(a.cutoffdate) : "sem data de corte; fica marcado como atrasado",
      ),
      statTile(
        "Nota",
        gradeValue || "–",
        gradeValue ? [gradeMax && `de ${gradeMax}`, st.feedback?.gradeddate && ` · corrigida ${fmtDateTime(st.feedback.gradeddate)}`].filter(Boolean).join("") : "ainda sem nota",
        { hero: true },
      ),
      statTile("Envio", types || "–", drafts ? "com rascunho" : "salvar já entrega"),
    ),
    (intro || introFiles.length > 0) && card("Enunciado", intro && h("div", { class: "qhtml" }, renderMoodleHtml(intro)), introFiles.length > 0 && h("div", { class: "file-list" }, introFiles.map(fileLink))),
    msg,
    card(
      h("div", { class: "card-title-row" }, h("h2", {}, "Seu envio"), sub?.attemptnumber ? h("span", { class: "chip" }, `Tentativa ${sub.attemptnumber + 1}`) : null),
      deadlineNote && h("div", { class: "notice" }, deadlineNote),
      a.nosubmissions ? h("p", { class: "empty" }, "Esta tarefa não recebe envio pelo AVA.") : slot,
      !canWrite() && h("p", { class: "note" }, "Seu token não tem as funções de envio; esta tela fica somente leitura."),
    ),
    feedbackCard(st),
  );
}

function feedbackCard(st: SubmissionStatus): Child {
  const fb = st.feedback;
  if (!fb?.plugins?.length) return null;
  const parts: Child[] = [];
  for (const p of fb.plugins) {
    for (const ed of p.editorfields ?? []) if (stripHtml(ed.text)) parts.push(h("div", { class: "qhtml feedback-text" }, renderMoodleHtml(ed.text)));
    const fl = (p.fileareas ?? []).flatMap((a) => a.files ?? []);
    if (fl.length) parts.push(h("div", { class: "file-list" }, h("span", { class: "muted small" }, `${p.name}:`), fl.map(fileLink)));
  }
  return parts.length ? card("Avaliação do professor", parts) : null;
}

function countdown(end: number) {
  const el = h("span", { class: "chip warn" });
  let started = false;
  const tick = () => {
    if (started && !el.isConnected) return clearInterval(timer);
    started = true;
    const left = Math.round(end - Date.now() / 1000);
    if (left <= 0) {
      el.className = "chip bad";
      el.textContent = "⏱ Tempo esgotado";
      return clearInterval(timer);
    }
    const hh = Math.floor(left / 3600);
    const mm = Math.floor((left % 3600) / 60);
    el.textContent = `⏱ ${hh ? `${hh}h ` : ""}${mm}min restantes`;
  };
  const timer = setInterval(tick, 1000);
  tick();
  return el;
}
