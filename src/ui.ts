// Helpers de DOM e componentes visuais (sem bibliotecas). Nunca usa innerHTML com dados do servidor.

import neoavaLogo from "./assets/neoava-logo.png";

export type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function s(tag: string, attrs: Attrs = {}, ...children: (Child | Child[])[]): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  setAttrs(el, attrs);
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

function setAttrs(el: Element, attrs: Attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v !== undefined) el.setAttribute(k, String(v));
  }
}

// ---------- Tooltip único, acionado por data-tip ----------

let tipEl: HTMLDivElement | null = null;
export function hideTooltip() {
  if (tipEl) tipEl.hidden = true;
}
export function installTooltip() {
  if (tipEl) return;
  tipEl = h("div", { class: "tooltip", role: "tooltip", hidden: true });
  document.body.append(tipEl);
  const show = (e: PointerEvent) => {
    const t = (e.target as Element).closest?.("[data-tip]");
    if (!t) return hide();
    tipEl!.replaceChildren(...t.getAttribute("data-tip")!.split("\n").map((line, i) => h("div", { class: i ? "" : "tip-head" }, line)));
    tipEl!.hidden = false;
    const pad = 12;
    const r = tipEl!.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    tipEl!.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  };
  const hide = hideTooltip;
  document.addEventListener("pointermove", show);
  document.addEventListener("pointerleave", hide);
  document.addEventListener("scroll", hide, { passive: true });
}

// ---------- Componentes ----------

export function card(title: string | Node, ...content: (Child | Child[])[]) {
  return h("section", { class: "card" }, h("header", { class: "card-head" }, typeof title === "string" ? h("h2", {}, title) : title), ...content);
}

export function statTile(label: string, value: string, sub?: Child, opts: { hero?: boolean; tone?: "good" | "warn" | "bad" } = {}) {
  return h(
    "div",
    { class: `stat${opts.hero ? " hero" : ""}${opts.tone ? ` tone-${opts.tone}` : ""}` },
    h("div", { class: "stat-label" }, label),
    h("div", { class: "stat-value" }, value),
    sub !== undefined && h("div", { class: "stat-sub" }, sub),
  );
}

export interface Segment {
  value: number;
  cls: string;
  tip: string;
}

/** Barra horizontal empilhada (100% = total). Segmentos separados por gap de 2px. */
export function stackBar(segments: Segment[], total: number) {
  return h(
    "div",
    { class: "stack" },
    segments
      .filter((sg) => sg.value > 0.0001)
      .map((sg) => h("div", { class: `seg ${sg.cls}`, style: `flex-grow:${sg.value / total}`, "data-tip": sg.tip })),
  );
}

export function legend(items: { cls: string; label: string }[]) {
  return h(
    "div",
    { class: "legend" },
    items.map((i) => h("span", { class: "legend-item" }, h("span", { class: `swatch ${i.cls}` }), i.label)),
  );
}

export interface Column {
  label: string;
  value: number | null;
  tip: string;
  cls?: string;
  /** Rótulo direto no topo (use com moderação). */
  showValue?: string;
  highlight?: boolean;
}

/** Gráfico de colunas em HTML/CSS. Uma série, eixo único, linha de referência opcional. */
export function columnChart(cols: Column[], opts: { max: number; hideEmpty?: boolean; ticks?: number[]; ref?: { value: number; label: string }; height?: number; fmt?: (n: number) => string }) {
  const height = opts.height ?? 160;
  const fmt = opts.fmt ?? ((n: number) => String(n));
  const pct = (v: number) => `${Math.max(0, Math.min(1, v / opts.max)) * 100}%`;
  return h(
    "div",
    { class: `colchart${opts.ticks?.length ? "" : " no-axis"}`, style: `--h:${height}px` },
    h(
      "div",
      { class: "plot" },
      (opts.ticks ?? []).map((t) => h("div", { class: "grid", style: `bottom:${pct(t)}` }, h("span", {}, fmt(t)))),
      opts.ref && h("div", { class: "ref", style: `bottom:${pct(opts.ref.value)}` }, h("span", {}, opts.ref.label)),
      h(
        "div",
        { class: "cols" },
        cols.map((c) =>
          h(
            "div",
            { class: `col${c.highlight ? " hl" : ""}`, "data-tip": c.tip },
            c.value !== null && c.value > 0
              ? h("div", { class: `bar ${c.cls ?? ""}`, style: `height:${pct(c.value)}` }, c.showValue && h("span", { class: "bar-val" }, c.showValue))
              : !opts.hideEmpty && h("div", { class: "bar empty" }),
          ),
        ),
      ),
    ),
    h("div", { class: "xlabels" }, cols.map((c) => h("div", { class: c.highlight ? "hl" : "" }, c.label))),
  );
}

/** Anel de progresso (0–1). */
export function ring(frac: number, label: string, size = 44) {
  const r = (size - 6) / 2;
  const C = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, frac));
  return h(
    "div",
    { class: "ring", style: `width:${size}px;height:${size}px` },
    s(
      "svg",
      { viewBox: `0 0 ${size} ${size}`, width: size, height: size, "aria-hidden": "true" },
      s("circle", { cx: size / 2, cy: size / 2, r, class: "ring-track" }),
      s("circle", {
        cx: size / 2,
        cy: size / 2,
        r,
        class: "ring-fill",
        "stroke-dasharray": `${C * f} ${C}`,
        transform: `rotate(-90 ${size / 2} ${size / 2})`,
      }),
    ),
    h("span", {}, label),
  );
}

export function statusChip(ok: boolean | null, labels = { ok: "Acima da média", bad: "Abaixo da média", none: "Sem nota" }) {
  if (ok === null) return h("span", { class: "chip" }, labels.none);
  return h("span", { class: `chip ${ok ? "good" : "bad"}` }, ok ? "✓ " : "✕ ", ok ? labels.ok : labels.bad);
}

export function skeleton(lines = 3) {
  return h("div", { class: "skeleton" }, Array.from({ length: lines }, () => h("div", {})));
}

/** Ícone curto por tipo de atividade do Moodle. */
export function modBadge(mod?: string) {
  const map: Record<string, string> = {
    assign: "Tarefa",
    quiz: "Quiz",
    forum: "Fórum",
    lesson: "Lição",
    workshop: "Workshop",
    choice: "Escolha",
    feedback: "Pesquisa",
    scorm: "SCORM",
    h5pactivity: "H5P",
    resource: "Arquivo",
    url: "Link",
    page: "Página",
    folder: "Pasta",
    book: "Livro",
    label: "Aviso",
    glossary: "Glossário",
    wiki: "Wiki",
    chat: "Chat",
    data: "Banco de dados",
    bigbluebuttonbn: "Webconferência",
  };
  return h("span", { class: `badge mod-${mod ?? "other"}` }, map[mod ?? ""] ?? "Atividade");
}

// ---------- Gráficos adicionais ----------

export interface DonutPart {
  value: number;
  cls: string;
  label: string;
  tip: string;
}

/** Rosca (parte-do-todo, até 4 fatias) com rótulo central. Fatias separadas por 2px. */
export function donut(parts: DonutPart[], center: { value: string; label: string }, size = 168) {
  const stroke = 22;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const total = parts.reduce((a, p) => a + p.value, 0);
  const visible = parts.filter((p) => p.value > 0);
  const gap = visible.length > 1 ? 2 : 0;
  let offset = 0;
  const arcs = visible.map((p) => {
    const len = (p.value / total) * C;
    const arc = s("circle", {
      cx: size / 2,
      cy: size / 2,
      r,
      class: `donut-arc ${p.cls}`,
      "stroke-width": stroke,
      "stroke-dasharray": `${Math.max(0, len - gap)} ${C}`,
      "stroke-dashoffset": -offset,
      transform: `rotate(-90 ${size / 2} ${size / 2})`,
      "data-tip": p.tip,
    });
    offset += len;
    return arc;
  });
  return h(
    "div",
    { class: "donut", style: `--size:${size}px` },
    s(
      "svg",
      { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: "img", "aria-label": parts.map((p) => `${p.label}: ${p.tip.split("\n").pop()}`).join("; ") },
      s("circle", { cx: size / 2, cy: size / 2, r, class: "donut-track", "stroke-width": stroke }),
      total > 0 ? arcs : null,
    ),
    h("div", { class: "donut-center" }, h("strong", {}, center.value), h("span", {}, center.label)),
  );
}

export interface HeatCell {
  date: string;
  count: number;
  tip: string;
  today?: boolean;
  past?: boolean;
}

/** Mapa de calor semanal (linhas = semanas, colunas = dias). Escala sequencial de um tom. */
export function heatmap(weeks: HeatCell[][], dayNames: string[], weekLabels: string[]) {
  const level = (n: number) => (n <= 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4);
  return h(
    "div",
    { class: "heatmap" },
    h("div", { class: "hm-row hm-head" }, h("span", {}), dayNames.map((d) => h("span", {}, d))),
    weeks.map((w, i) =>
      h(
        "div",
        { class: "hm-row" },
        h("span", { class: "hm-week" }, weekLabels[i]),
        w.map((c) => h("span", { class: `hm-cell l${level(c.count)}${c.today ? " today" : ""}${c.past ? " past" : ""}`, "data-tip": c.tip }, c.count > 0 ? String(c.count) : "")),
      ),
    ),
    h(
      "div",
      { class: "hm-legend" },
      "menos",
      [0, 1, 2, 3, 4].map((l) => h("span", { class: `hm-cell l${l}` })),
      "mais entregas",
    ),
  );
}

export interface MeterRow {
  label: string;
  href?: string;
  value: number; // 0–1
  display: string;
  tip: string;
  tone?: "good" | "warn" | "bad";
}

/** Lista de barras de progresso (uma métrica por linha, 0–100%). */
export function meterList(rows: MeterRow[]) {
  return h(
    "div",
    { class: "meters" },
    rows.map((r) =>
      h(
        "div",
        { class: "meter-row", "data-tip": r.tip },
        r.href ? h("a", { href: r.href, class: "meter-label", title: r.label }, r.label) : h("span", { class: "meter-label", title: r.label }, r.label),
        h("div", { class: "meter" }, h("div", { class: `meter-fill${r.tone ? ` ${r.tone}` : ""}`, style: `width:${Math.max(0, Math.min(1, r.value)) * 100}%` })),
        h("span", { class: "meter-val" }, r.display),
      ),
    ),
  );
}

export interface RangeRow {
  label: string;
  href?: string;
  /** Limite inferior (garantido), superior (máximo possível) e marcador (projeção), em 0–max. */
  lo: number;
  hi: number;
  mark: number | null;
  display: string;
  tone?: "good" | "warn" | "bad";
  tip: string;
}

/** Gráfico de intervalos: uma faixa lo→hi por linha, marcador na projeção e linha de referência. */
export function rangeList(rows: RangeRow[], opts: { max: number; ref?: number; refLabel?: string; ticks?: number[] }) {
  const pct = (v: number) => `${(Math.max(0, Math.min(opts.max, v)) / opts.max) * 100}%`;
  return h(
    "div",
    { class: "ranges" },
    h(
      "div",
      { class: "range-row range-axis" },
      h("span", {}),
      h(
        "div",
        { class: "range-track axis" },
        // Esconde marcas muito próximas da linha de referência para os rótulos não se sobreporem.
        (opts.ticks ?? []).filter((t) => opts.ref === undefined || Math.abs(t - opts.ref) > opts.max * 0.12).map((t) => h("span", { class: "range-tick", style: `left:${pct(t)}` }, String(t))),
        opts.ref !== undefined && h("span", { class: "range-tick ref", style: `left:${pct(opts.ref)}` }, opts.refLabel ?? String(opts.ref)),
      ),
      h("span", {}),
    ),
    rows.map((r) =>
      h(
        "div",
        { class: "range-row", "data-tip": r.tip },
        r.href ? h("a", { href: r.href, class: "range-label", title: r.label }, r.label) : h("span", { class: "range-label", title: r.label }, r.label),
        h(
          "div",
          { class: "range-track" },
          opts.ref !== undefined && h("span", { class: "range-ref", style: `left:${pct(opts.ref)}` }),
          h("span", { class: "range-secured", style: `width:${pct(r.lo)}` }),
          h("span", { class: "range-band", style: `left:${pct(r.lo)};width:calc(${pct(r.hi)} - ${pct(r.lo)})` }),
          r.mark !== null && h("span", { class: `range-mark${r.tone ? ` ${r.tone}` : ""}`, style: `left:${pct(r.mark)}` }),
        ),
        h("span", { class: `range-val${r.tone ? ` ${r.tone}` : ""}` }, r.display),
      ),
    ),
  );
}

// ---------- Marca ----------

/** Logo + nome do app (barra lateral, topo no celular e tela de login). */
export function brandMark(size = 28) {
  return [h("img", { class: "logo", src: neoavaLogo, alt: "", width: size, height: size }), h("span", { class: "wordmark", "aria-label": "NeoAVA" }, h("b", {}, "Neo"), h("span", { class: "out" }, "AVA"))];
}

// ---------- Ícones (traço 1.75, 20px) ----------

const ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  book: "M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3",
  calendar: "M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10h16M8 3v4M16 3v4",
  chart: "M4 20h16M7 16v-5M12 16V7M17 16v-8",
  library: "M5 4h3v16H5zM10 4h3v16h-3zM15 5l3-1 4 15-3 1z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  refresh: "M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4",
  logout: "M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  monitor: "M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM8 20h8M12 16v4",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
};

export function icon(name: keyof typeof ICONS | string, size = 20) {
  return s(
    "svg",
    { viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": 1.75, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "icon" },
    s("path", { d: ICONS[name] ?? "" }),
  );
}
