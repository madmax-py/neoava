// Peças visuais do modelo de 3 ciclos (VA1–VA3, 100 pontos cada), usadas por várias telas.

import { CYCLE_MAX, fmtNum, standing, type Cycle, type CycleSummary, type Standing } from "../grades";
import { h, legend, stackBar } from "../ui";

export const n1 = (v: number) => fmtNum(v, v % 1 ? 1 : 0);

const STANDING: Record<Standing, [string, string, string]> = {
  secured: ["good", "✓ Média garantida", "Você já tem pontos suficientes para a média mínima."],
  "on-track": ["good", "↗ No caminho", "Mantendo o aproveitamento atual, você passa da média mínima."],
  "at-risk": ["warn", "! Em risco", "Mantendo o aproveitamento atual, você fica abaixo da média mínima."],
  impossible: ["bad", "✕ Fora de alcance", "Mesmo tirando nota máxima em tudo que falta, não chega à média mínima."],
  "no-data": ["", "Sem notas ainda", "Nenhuma nota lançada nos ciclos."],
};

export function standingTone(s: CycleSummary, target: number): "good" | "warn" | "bad" | undefined {
  const t = STANDING[standing(s, target)][0];
  return t ? (t as "good" | "warn" | "bad") : undefined;
}

export function standingChip(s: CycleSummary, target: number) {
  const [cls, label, tip] = STANDING[standing(s, target)];
  return h("span", { class: `chip standing ${cls}`, "data-tip": tip }, label);
}

export function cycleSegments(c: Cycle, prefix = "") {
  return stackBar(
    [
      { value: c.earned, cls: "s-earned", tip: `${prefix}${c.label}\nObtido: ${n1(c.earned)} de ${CYCLE_MAX}` },
      { value: c.lost, cls: "s-lost", tip: `${prefix}${c.label}\nPerdido: ${n1(c.lost)}` },
      { value: c.open, cls: "s-open", tip: `${prefix}${c.label}\nEm aberto: ${n1(c.open)} (atividades lançadas, sem nota)${c.openUnknown ? ` + ${c.openUnknown} sem valor conhecido` : ""}` },
    ],
    CYCLE_MAX,
  );
}

/** Três mini barras lado a lado (VA1, VA2, VA3), cada uma de 0 a 100. */
export function cycleMini(s: CycleSummary, prefix = "") {
  return h(
    "div",
    { class: "cycle-mini" },
    s.cycles.map((c, i) =>
      h(
        "div",
        { class: i === s.current ? "current" : "" },
        h("div", { class: "cm-label" }, h("span", {}, c.label), h("strong", {}, n1(c.earned))),
        cycleSegments(c, prefix),
      ),
    ),
  );
}

export function cycleLegend() {
  return legend([
    { cls: "s-earned", label: "Obtido" },
    { cls: "s-lost", label: "Perdido" },
    { cls: "s-open", label: "Em aberto" },
    { cls: "s-notreleased", label: "Não lançado" },
  ]);
}
