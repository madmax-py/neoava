// Biblioteca: tudo o que os professores publicaram no ciclo, por disciplina, separado por ciclo e por tipo.

import type { CourseModule } from "../moodle/api";
import { api, ifAvailable, opts, state } from "../state";
import { courseName, cycleData, cycleSplit, KIND_LABEL, materialsOf, type CycleSplit, type Material, type MaterialKind } from "../data";
import type { CycleSummary } from "../grades";
import { fmtDate } from "../format";
import { pageHead, shell } from "../layout";
import { card, h, modBadge } from "../ui";

const KINDS: MaterialKind[] = ["file", "link", "page"];

export async function libraryPage(courseId: number | null, id: number) {
  const d = await cycleData();
  const o = opts();
  const contents = await Promise.all(d.current.map((c) => ifAvailable("core_course_get_contents", () => api().contents(c.id, o), []).catch(() => [])));
  const libs = d.stats.map((s, i) => {
    const split = cycleSplit(s.course, s.items, s.cycles, d.dl);
    return { ...s, split, materials: materialsOf(contents[i], split) };
  });
  const sel = libs.find((l) => l.course.id === courseId) ?? libs[0];

  if (id !== state.routeId) return; // o usuário já navegou para outra tela
  if (!sel) return shell(pageHead("Biblioteca", "Materiais do ciclo"), h("p", { class: "empty" }, "Nenhuma disciplina no ciclo atual."));

  const list = h("div", { class: "lib-cycles" }, cycleGroups(sel.materials, sel.cycles, sel.split));
  const filter = h(
    "div",
    { class: "lib-filter", role: "group", "aria-label": "Filtrar por tipo" },
    [["all", "Tudo"], ...KINDS.map((k) => [k, KIND_LABEL[k]])].map(([k, label], i) =>
      h(
        "button",
        {
          type: "button",
          class: i === 0 ? "active" : "",
          "aria-pressed": String(i === 0),
          onclick: (e) => {
            list.dataset.kind = k;
            for (const b of filter.querySelectorAll("button")) {
              b.classList.toggle("active", b === e.currentTarget);
              b.setAttribute("aria-pressed", String(b === e.currentTarget));
            }
          },
        },
        label,
        h("span", { class: "count" }, String(k === "all" ? sel.materials.length : sel.materials.filter((m) => m.kind === k).length)),
      ),
    ),
  );

  shell(
    pageHead("Biblioteca", "Materiais do ciclo"),
    h(
      "nav",
      { class: "lib-tabs", "aria-label": "Disciplinas" },
      libs.map((l) =>
        h(
          "a",
          { href: `#/biblioteca/${l.course.id}`, class: l === sel ? "active" : "", "aria-current": l === sel ? "page" : undefined },
          h("span", {}, courseName(l.course)),
          h("span", { class: "count" }, String(l.materials.length)),
        ),
      ),
    ),
    card(
      h("div", { class: "card-title-row" }, h("h2", {}, courseName(sel.course)), filter),
      h("p", { class: "note lib-how" }, splitNote(sel.split, sel.cycles, sel.materials)),
      sel.materials.length ? list : h("p", { class: "empty" }, "O professor ainda não publicou materiais (arquivos, links ou páginas) nesta disciplina."),
    ),
  );
}

function cycleLabel(n: number, cycles: CycleSummary | null) {
  return cycles?.cycles[n - 1]?.label ?? `Ciclo ${n}`;
}

function splitNote(split: CycleSplit, cycles: CycleSummary | null, materials: Material[]) {
  const byDate = materials.some((m) => m.by === "date");
  const bySection = materials.some((m) => m.by === "section");
  const parts: string[] = [];
  if (bySection) parts.push("Materiais em seções com o nome do ciclo (VA1, Fase 2, 3º ciclo…) ficam nesse ciclo.");
  if (byDate && split)
    parts.push(
      split.kind === "exams"
        ? `${bySection ? "Os demais vão" : "Separados"} pela data de publicação: ${cycleLabel(1, cycles)} até ${fmtDate(split.ends[0])} e ${cycleLabel(2, cycles)} até ${fmtDate(split.ends[1])}, prazos das últimas avaliações de cada ciclo.`
        : `${bySection ? "Os demais vão" : "Separados"} pela data de publicação, dividindo o período da disciplina em três partes iguais (o AVA não tem prazos de prova suficientes para marcar os ciclos). Pode errar perto da virada de um ciclo.`,
    );
  if (materials.some((m) => m.cycle === null)) parts.push("Os que não têm data nem seção identificável ficam em “Sem ciclo identificado”.");
  return parts.join(" ") || "Materiais em ordem de publicação.";
}

function cycleGroups(materials: Material[], cycles: CycleSummary | null, split: CycleSplit) {
  const order: (number | null)[] = [1, 2, 3, 0, null];
  return order.map((n) => {
    const list = materials.filter((m) => m.cycle === n);
    if (!list.length) return null;
    const title = n === null ? "Sem ciclo identificado" : n === 0 ? "Geral da disciplina" : cycleLabel(n, cycles);
    // A faixa de datas só explica o agrupamento quando foi a data que decidiu o ciclo.
    const range = n && split && list.some((m) => m.by === "date") ? (n === 1 ? `até ${fmtDate(split.ends[0])}` : n === 2 ? `${fmtDate(split.ends[0])} – ${fmtDate(split.ends[1])}` : `depois de ${fmtDate(split.ends[1])}`) : "";
    const current = n !== null && n > 0 && cycles ? cycles.current === n - 1 : false;
    return h(
      "details",
      { class: `lib-cycle${current ? " current" : ""}`, open: true },
      h(
        "summary",
        {},
        h("span", { class: "lib-cycle-title" }, title),
        current && h("span", { class: "chip grade" }, "em andamento"),
        range && h("span", { class: "muted small" }, range),
        h("span", { class: "count" }, String(list.length)),
      ),
      KINDS.map((k) => {
        const items = list.filter((m) => m.kind === k).sort((a, b) => (a.postedAt ?? Infinity) - (b.postedAt ?? Infinity) || a.section.section - b.section.section);
        return items.length > 0 && h("section", { class: "lib-kind", "data-kind": k }, h("h3", {}, KIND_LABEL[k]), h("ul", { class: "lib-items" }, items.map(itemRow)));
      }),
    );
  });
}

function itemRow(m: Material) {
  const mod = m.module;
  const files = (mod.contents ?? []).filter((x) => x.type === "file");
  return h(
    "li",
    {},
    h("span", { class: "lib-date num" }, m.postedAt ? fmtDate(m.postedAt) : "—"),
    h(
      "div",
      { class: "lib-main" },
      h("div", { class: "lib-title" }, modBadge(mod.modname), avaLink(mod)),
      h("span", { class: "event-course" }, m.section.name || `Seção ${m.section.section}`),
      (mod.modname === "resource" || mod.modname === "folder") &&
        files.length > 0 &&
        h(
          "div",
          { class: "lib-files" },
          files.slice(0, 6).map((x) => h("a", { href: state.client!.fileUrl(x.fileurl), target: "_blank", rel: "noreferrer", class: "file" }, `⬇ ${x.filename}`)),
          files.length > 6 && h("span", { class: "muted small" }, `+${files.length - 6} arquivo(s) na pasta`),
        ),
    ),
  );
}

function avaLink(mod: CourseModule) {
  return mod.url && /^https?:\/\//i.test(mod.url) ? h("a", { href: mod.url, target: "_blank", rel: "noreferrer", title: "Abrir no AVA" }, mod.name, h("span", { class: "ext" }, " ↗")) : h("span", {}, mod.name);
}
