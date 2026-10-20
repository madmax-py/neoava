// HTML das questões do Moodle: limpeza para exibir e inventário dos campos do formulário.
//
// O Moodle devolve cada questão já renderizada em HTML. Aqui ele é lido com DOMParser (que não
// executa scripts nem carrega nada) e reconstruído só com tags e atributos de uma lista fechada.
// Scripts, estilos, eventos, botões e formulários ficam de fora; os campos ficam desativados.

import { state } from "./state";

/** Tags mantidas (com os filhos). Qualquer outra tag é desembrulhada: some, mas o texto dentro fica. */
const KEEP = new Set([
  "div", "span", "p", "br", "hr", "b", "strong", "i", "em", "u", "s", "sub", "sup", "small", "code", "pre", "blockquote",
  "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "img", "a", "figure", "figcaption", "label", "fieldset", "legend", "input", "select", "option", "optgroup", "textarea",
]);

/** Tags removidas junto com tudo que tem dentro. */
const DROP = new Set(["script", "style", "noscript", "template", "iframe", "frame", "object", "embed", "button", "form", "link", "meta", "base", "audio", "video", "canvas", "svg", "math"]);

/** Atributos permitidos por tag (além de class, id e title, que valem para todas). */
const ATTRS: Record<string, string[]> = {
  label: ["for"],
  input: ["type", "name", "value", "checked", "size", "maxlength"],
  select: ["name", "multiple"],
  option: ["value", "selected"],
  optgroup: ["label"],
  textarea: ["name", "rows", "cols"],
  img: ["alt", "width", "height"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan", "scope"],
  ol: ["start", "type"],
  col: ["span"],
  colgroup: ["span"],
};

/** Tipos de input mostrados. Botões, envio de arquivo etc. não aparecem. */
const INPUT_TYPES = new Set(["radio", "checkbox", "text", "number", "hidden"]);

/** Partes do HTML do Moodle que não fazem sentido aqui (o cabeçalho da questão é desenhado pelo app). */
const DROP_CLASSES = ["info", "questionflag", "im-controls", "submitbtns", "questionflagsavebutton"];

/** class="que multichoice" → "m-que m-multichoice": evita colisão com as classes do app. */
const prefixClasses = (v: string) =>
  v
    .split(/\s+/)
    .filter((c) => /^[\w-]+$/.test(c))
    .map((c) => `m-${c}`)
    .join(" ");

/** ids e "for" ganham prefixo; os nomes do Moodle têm ":" (q123:1_answer0), o que é válido em id. */
const prefixId = (v: string) => `mq-${v}`;

/** Endereço de imagem seguro: arquivo do AVA (com token), https externo ou data:image. */
function imageSrc(raw: string): string | null {
  const base = __MOODLE_URL__;
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol === "data:") return /^data:image\/(png|jpe?g|gif|webp);/i.test(raw) ? raw : null;
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.origin === new URL(base).origin) {
    // Arquivos das questões só abrem com token pelo endpoint de web services.
    if (u.pathname.includes("/pluginfile.php/") && !u.pathname.includes("/webservice/")) {
      u.pathname = u.pathname.replace("/pluginfile.php/", "/webservice/pluginfile.php/");
    }
    return u.pathname.includes("/webservice/pluginfile.php/") ? state.client!.fileUrl(u.toString()) : u.toString();
  }
  return u.protocol === "https:" ? u.toString() : null;
}

function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw, __MOODLE_URL__);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Ícones de certo/errado do Moodle (<i class="fa fa-check">) viram texto. */
function iconText(el: Element): Node | null {
  const cls = el.getAttribute("class") ?? "";
  const label = el.getAttribute("aria-label") || el.getAttribute("title") || "";
  if (/fa-check/.test(cls)) return chip("✓", "good", label);
  if (/fa-(xmark|times|remove|close)/.test(cls)) return chip("✕", "bad", label);
  if (/fa-(square-check|circle-half|adjust)/.test(cls)) return chip("◐", "warn", label);
  return label ? document.createTextNode(` ${label} `) : null;
}

function chip(text: string, tone: string, label: string) {
  const s = document.createElement("span");
  s.className = `q-mark ${tone}`;
  s.textContent = text;
  if (label) s.title = label;
  return s;
}

function clean(node: Node, out: Node) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.appendChild(document.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    const cls = el.getAttribute("class") ?? "";
    if (DROP_CLASSES.some((c) => cls.split(/\s+/).includes(c))) continue;
    if (tag === "i" && /\bfa-|\bicon\b/.test(cls)) {
      const t = iconText(el);
      if (t) out.appendChild(t);
      continue;
    }
    if (!KEEP.has(tag)) {
      clean(el, out); // desembrulha
      continue;
    }
    if (tag === "input" && !INPUT_TYPES.has((el.getAttribute("type") ?? "text").toLowerCase())) continue;

    const copy = document.createElement(tag);
    if (cls) copy.className = prefixClasses(cls);
    const id = el.getAttribute("id");
    if (id) copy.id = prefixId(id);
    const title = el.getAttribute("title");
    if (title) copy.title = title;
    for (const a of ATTRS[tag] ?? []) {
      const v = el.getAttribute(a);
      if (v === null) continue;
      copy.setAttribute(a, a === "for" ? prefixId(v) : v);
    }
    if (tag === "img") {
      const src = imageSrc(el.getAttribute("src") ?? "");
      if (!src) {
        const alt = el.getAttribute("alt");
        if (alt) out.appendChild(document.createTextNode(`[imagem: ${alt}]`));
        continue;
      }
      copy.setAttribute("src", src);
      copy.setAttribute("referrerpolicy", "no-referrer");
      copy.setAttribute("loading", "lazy");
    }
    if (tag === "a") {
      const href = safeHref(el.getAttribute("href") ?? "");
      if (href) {
        copy.setAttribute("href", href);
        copy.setAttribute("target", "_blank");
        copy.setAttribute("rel", "noreferrer");
      }
    }
    // Somente leitura: nada pode ser marcado ou digitado.
    if (tag === "input" || tag === "select" || tag === "textarea") copy.setAttribute("disabled", "");
    if (tag === "textarea") copy.textContent = el.textContent ?? "";
    else clean(el, copy);
    out.appendChild(copy);
  }
}

/** HTML de uma questão do Moodle → fragmento seguro para exibir (campos desativados). */
export function renderQuestionHtml(html: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const frag = document.createDocumentFragment();
  clean(doc.body, frag);
  return frag;
}

// ---------- Inventário dos campos ----------

export interface QuestionField {
  /** Nome que o Moodle espera de volta (ex.: q123:1_answer, q123:1_:sequencecheck). */
  name: string;
  type: string;
  value: string;
  /** Texto da opção (alternativa) ou do rótulo do campo. */
  label: string;
  /** Já marcado/selecionado no AVA (resposta salva). */
  checked: boolean;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

function labelOf(el: Element, doc: Document): string {
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => text(doc.getElementById(id)))
      .join(" ")
      .trim();
    if (t) return t;
  }
  const id = el.getAttribute("id");
  if (id) {
    const lab = Array.from(doc.querySelectorAll("label")).find((l) => l.getAttribute("for") === id);
    if (lab) return text(lab);
  }
  const wrap = el.closest("label");
  if (wrap) return text(wrap);
  return el.getAttribute("aria-label") ?? "";
}

/**
 * Lista os campos do formulário da questão, na ordem do HTML. É o que uma futura versão de
 * "responder" precisaria devolver ao Moodle (nome → valor). Inclui os ocultos (sequencecheck etc.).
 */
export function questionFields(html: string): QuestionField[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: QuestionField[] = [];
  for (const el of Array.from(doc.querySelectorAll("input, select, textarea"))) {
    const name = el.getAttribute("name");
    if (!name) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      const sel = el as HTMLSelectElement;
      const chosen = Array.from(sel.options).filter((o) => o.hasAttribute("selected"));
      out.push({
        name,
        type: "select",
        value: chosen.map((o) => o.value).join(", "),
        label: `${labelOf(el, doc)} · opções: ${Array.from(sel.options).map((o) => `${o.value}=${text(o)}`).join(" | ")}`.replace(/^ · /, ""),
        checked: chosen.length > 0 && chosen.some((o) => o.value !== "" && o.value !== "0"),
      });
      continue;
    }
    const type = tag === "textarea" ? "textarea" : (el.getAttribute("type") ?? "text").toLowerCase();
    if (type === "submit" || type === "button" || type === "image" || type === "reset") continue;
    out.push({
      name,
      type,
      value: tag === "textarea" ? (el.textContent ?? "") : (el.getAttribute("value") ?? ""),
      label: type === "hidden" ? "" : labelOf(el, doc),
      checked: el.hasAttribute("checked"),
    });
  }
  return out;
}
