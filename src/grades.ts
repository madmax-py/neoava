// Cálculos do dashboard: ciclo atual, normalização de notas e pontos acumulados.
// Tudo aqui é aproximação a partir do AVA — pesos/categorias do Moodle podem mudar o resultado oficial.

import type { Course, GradeItem } from "./moodle/api";
import { TZ } from "./format";

const DAY = 86400;

/** "2026/2" a partir do início da disciplina (1º semestre: jan–jun). */
export function semesterOf(ts: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "numeric" }).formatToParts(ts * 1000);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = Number(parts.find((p) => p.type === "month")!.value);
  return `${year}/${month <= 6 ? 1 : 2}`;
}

/** Disciplina do ciclo atual: já começou (ou começa em breve) e não terminou há mais de 15 dias. */
export function isCurrent(c: Course, now = Date.now() / 1000): boolean {
  const start = c.startdate ?? 0;
  const end = c.enddate ?? 0;
  if (start > now + 30 * DAY) return false;
  if (end) return end >= now - 15 * DAY;
  // Sem data de término: considera atual se começou nos últimos ~7 meses.
  return start >= now - 210 * DAY;
}

/**
 * Converte a nota formatada do Moodle para escala 0–10.
 * "7,50" → 7.5 · "75,00 %" → 7.5 · "85" (escala 0–100) → 8.5 · "-" → null
 */
export function parseGrade(formatted: string | null | undefined): number | null {
  if (!formatted) return null;
  const m = formatted.replace(/\s/g, "").match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (formatted.includes("%") || n > 10) return Math.min(10, n / 10);
  return n;
}

export interface GradedPiece {
  id: number;
  name: string;
  module: string | null;
  /** Nota obtida (pontos). null = ainda sem nota. */
  earned: number | null;
  max: number;
  pct: number | null;
  /** Data em que a nota foi lançada (quando o AVA informa). */
  gradedAt: number | null;
  /** O máximo veio da configuração da atividade (o quadro de notas do AVA esconde). */
  maxFromActivity: boolean;
  /** Categoria do quadro de notas (ex.: VA1, VA2). */
  categoryid: number | null;
}

export interface Accumulation {
  /** Soma dos valores conhecidos dos itens (pontos). */
  total: number;
  /** Pontos obtidos nas atividades já corrigidas. */
  earned: number;
  /** Pontos perdidos nas atividades já corrigidas. */
  lost: number;
  /** Pontos de atividades ainda sem nota. */
  open: number;
  /** Itens de nota cujo valor máximo não é conhecido (não entram nas contas). */
  unknown: number;
  /** Itens sem valor conhecido mas que já têm nota. */
  unknownGraded: number;
  /** Nota do total da disciplina no AVA, se o AVA mostrar. */
  courseTotal: string | null;
  pieces: GradedPiece[];
}

/** Valor máximo de cada atividade, por módulo e instância (ex.: "assign:123" → 2). */
export type MaxIndex = Map<string, number>;

export function buildMaxIndex(assigns: { id: number; grade?: number }[], quizzes: { id: number; grade: number }[]): MaxIndex {
  const m: MaxIndex = new Map();
  for (const a of assigns) if (typeof a.grade === "number" && a.grade > 0) m.set(`assign:${a.id}`, a.grade);
  for (const q of quizzes) if (q.grade > 0) m.set(`quiz:${q.id}`, q.grade);
  return m;
}

/** Valor máximo do item: do próprio quadro de notas, ou da configuração da atividade. */
export function itemMax(i: GradeItem, idx?: MaxIndex): { max: number; fromActivity: boolean } | null {
  if (typeof i.grademax === "number" && i.grademax > 0) return { max: i.grademax, fromActivity: false };
  const m = i.itemmodule && i.iteminstance ? idx?.get(`${i.itemmodule}:${i.iteminstance}`) : undefined;
  return m ? { max: m, fromActivity: true } : null;
}

/**
 * Soma simples dos itens de nota com valor conhecido, em pontos.
 * Não tenta reproduzir pesos/categorias do Moodle: é "quanto já ganhei / perdi / falta corrigir".
 */
export function accumulate(items: GradeItem[], idx?: MaxIndex): Accumulation | null {
  const gradeItems = items.filter((i) => i.itemtype === "mod" || i.itemtype === "manual");
  if (!gradeItems.length) return null;
  const pieces: GradedPiece[] = [];
  let unknown = 0;
  let unknownGraded = 0;
  for (const i of gradeItems) {
    const earned = typeof i.graderaw === "number" ? i.graderaw : null;
    const mx = itemMax(i, idx);
    if (!mx) {
      unknown++;
      if (earned !== null) unknownGraded++;
      continue;
    }
    pieces.push({
      id: i.id,
      name: i.itemname ?? "Atividade",
      module: i.itemmodule,
      earned,
      max: mx.max,
      pct: earned === null ? null : Math.max(0, Math.min(1, earned / mx.max)),
      gradedAt: i.gradedategraded ?? null,
      maxFromActivity: mx.fromActivity,
      categoryid: i.categoryid ?? null,
    });
  }
  let earned = 0;
  let lost = 0;
  let open = 0;
  for (const p of pieces) {
    if (p.earned === null) open += p.max;
    else {
      earned += Math.min(p.earned, p.max);
      lost += Math.max(0, p.max - p.earned);
    }
  }
  const totalItem = items.find((i) => i.itemtype === "course");
  const ct = totalItem?.gradeformatted && totalItem.gradeformatted !== "-" ? totalItem.gradeformatted : null;
  return { total: earned + lost + open, earned, lost, open, unknown, unknownGraded, courseTotal: ct, pieces };
}

export interface CategoryBreakdown {
  id: number;
  name: string;
  /** Nota da categoria no AVA, quando ele mostra. */
  avaGrade: string | null;
  earned: number;
  lost: number;
  open: number;
  total: number;
  unknown: number;
  items: number;
}

/**
 * Agrupa por categoria do quadro de notas (VA1, VA2…). O item da categoria tem iteminstance = id da categoria.
 * Itens fora de qualquer categoria nomeada ficam em "Outros".
 */
export function byCategory(items: GradeItem[], acc: Accumulation): CategoryBreakdown[] {
  const cats = items.filter((i) => i.itemtype === "category" && i.iteminstance);
  const out = new Map<number, CategoryBreakdown>();
  const get = (id: number) => {
    if (!out.has(id)) {
      const c = cats.find((x) => x.iteminstance === id);
      out.set(id, { id, name: c?.itemname ?? "Outros", avaGrade: c?.gradeformatted && c.gradeformatted !== "-" ? c.gradeformatted : null, earned: 0, lost: 0, open: 0, total: 0, unknown: 0, items: 0 });
    }
    return out.get(id)!;
  };
  for (const c of cats) get(c.iteminstance!);
  for (const p of acc.pieces) {
    const b = get(p.categoryid ?? 0);
    b.items++;
    b.total += p.max;
    if (p.earned === null) b.open += p.max;
    else {
      b.earned += Math.min(p.earned, p.max);
      b.lost += Math.max(0, p.max - p.earned);
    }
  }
  for (const i of items) {
    if ((i.itemtype === "mod" || i.itemtype === "manual") && !acc.pieces.some((p) => p.id === i.id)) {
      const b = get(i.categoryid ?? 0);
      b.unknown++;
      b.items++;
    }
  }
  return [...out.values()].filter((b) => b.items > 0 || b.avaGrade);
}

// ---------- Modelo da UniEvangélica: 3 ciclos de 100 pontos ----------
// Cada ciclo (VA1, VA2, VA3 — ou "FASE 1/2/3" nas on-line) vale até 100 pontos: as atividades do ciclo
// somam pontos diretamente. A média final é a média simples dos 3 ciclos (0–100).

export const CYCLE_MAX = 100;
const CYCLE_NAME = /\b(VA|FASE|CICLO)\s*0?(\d)\b/i;

/**
 * Ciclo de uma categoria: pelo nome dela, ou — se o AVA deixou a categoria sem nome — pelos nomes das
 * atividades dentro dela, quando todas apontam para o mesmo ciclo (ex.: "FASE 01 - ENTREGA").
 */
function cycleOfCategory(cat: GradeItem, items: GradeItem[]): { n: number; kind: string } | null {
  const own = CYCLE_NAME.exec(cat.itemname ?? "");
  if (own) return { n: Number(own[2]), kind: own[1].toUpperCase() };
  if (cat.itemname?.trim()) return null;
  const kids = items.filter((i) => (i.itemtype === "mod" || i.itemtype === "manual") && i.categoryid === cat.iteminstance);
  const found = kids.map((i) => CYCLE_NAME.exec(i.itemname ?? ""));
  if (!found.length || found.some((m) => !m)) return null;
  const keys = new Set(found.map((m) => `${m![1].toUpperCase()}${m![2]}`));
  return keys.size === 1 ? { n: Number(found[0]![2]), kind: found[0]![1].toUpperCase() } : null;
}

export interface Cycle {
  /** id da categoria no quadro de notas. */
  id: number;
  /** "VA1", "VA2"… */
  label: string;
  /** Pontos obtidos (soma direta das notas, limitada a 100). */
  earned: number;
  /** Pontos perdidos em atividades corrigidas (só das que têm valor conhecido). */
  lost: number;
  /** Pontos de atividades lançadas e ainda sem nota (valor conhecido). */
  open: number;
  /** Atividades sem nota e sem valor conhecido. */
  openUnknown: number;
  /** Pontos que o professor ainda não distribuiu em atividades (100 − o que já existe). */
  notReleased: number;
  /** Nota do ciclo no AVA, quando ele mostra. */
  avaGrade: string | null;
  items: number;
  graded: number;
}

export interface CycleSummary {
  cycles: Cycle[];
  /** Índice do ciclo em andamento (pelas datas da disciplina, ou o último com nota). */
  current: number;
  /** Itens fora das 3 categorias (ainda não atribuídos a um ciclo). */
  loose: { count: number; earned: number; names: string[] };
  /** Média com o que já foi obtido (o que está garantido): Σ obtido / 3. */
  secured: number;
  /** Maior média ainda possível: tirando nota máxima em tudo que falta. */
  maxPossible: number;
  /** Projeção mantendo o aproveitamento atual no que falta. */
  projected: number | null;
  /** Aproveitamento nas atividades corrigidas com valor conhecido (0–1). */
  efficiency: number | null;
}

/** Reconhece VA1–VA3 (ou FASE/CICLO 1–3) e calcula pontos por ciclo. null se a disciplina não segue o modelo. */
export function cyclesOf(items: GradeItem[], idx?: MaxIndex, course?: Pick<Course, "startdate" | "enddate">, now = Date.now() / 1000): CycleSummary | null {
  const cats = items
    .filter((i) => i.itemtype === "category" && i.iteminstance)
    .flatMap((c) => {
      const cy = cycleOfCategory(c, items);
      return cy ? [{ cat: c, ...cy }] : [];
    })
    .sort((a, b) => a.n - b.n);
  if (cats.length !== 3 || cats.map((c) => c.n).join() !== "1,2,3") return null;

  const gradeItems = items.filter((i) => i.itemtype === "mod" || i.itemtype === "manual");
  const cycles: Cycle[] = cats.map(({ cat, n, kind }) => {
    const kids = gradeItems.filter((i) => i.categoryid === cat.iteminstance);
    let earned = 0;
    let lost = 0;
    let open = 0;
    let openUnknown = 0;
    let graded = 0;
    for (const i of kids) {
      const mx = itemMax(i, idx);
      if (typeof i.graderaw === "number") {
        graded++;
        const g = Math.max(0, i.graderaw);
        earned += mx ? Math.min(g, mx.max) : g;
        if (mx) lost += Math.max(0, mx.max - g);
      } else if (mx) open += mx.max;
      else openUnknown++;
    }
    earned = Math.min(CYCLE_MAX, earned);
    lost = Math.min(CYCLE_MAX - earned, lost);
    open = Math.min(CYCLE_MAX - earned - lost, open);
    const g = cat.gradeformatted && cat.gradeformatted !== "-" ? cat.gradeformatted : null;
    return {
      id: cat.iteminstance!,
      label: kind === "VA" ? `VA${n}` : `${kind.charAt(0)}${kind.slice(1).toLowerCase()} ${n}`,
      earned,
      lost,
      open,
      openUnknown,
      notReleased: Math.max(0, CYCLE_MAX - earned - lost - open),
      avaGrade: g,
      items: kids.length,
      graded,
    };
  });

  const catIds = new Set(cycles.map((c) => c.id));
  const looseItems = gradeItems.filter((i) => !catIds.has(i.categoryid ?? -1));
  const loose = {
    count: looseItems.length,
    earned: looseItems.reduce((a, i) => a + (typeof i.graderaw === "number" ? Math.max(0, i.graderaw) : 0), 0),
    names: looseItems.map((i) => i.itemname ?? "Atividade"),
  };

  // Ciclo atual: pelo calendário da disciplina (início→fim dividido em 3), ou adiante se já houver nota num ciclo posterior.
  let current = 0;
  const start = course?.startdate ?? 0;
  const end = course?.enddate ?? 0;
  if (start && end > start) current = Math.max(0, Math.min(2, Math.floor((3 * (now - start)) / (end - start))));
  cycles.forEach((c, i) => {
    if (c.graded > 0) current = Math.max(current, i);
  });

  const sumEarned = cycles.reduce((a, c) => a + c.earned, 0);
  const sumLost = cycles.reduce((a, c) => a + c.lost, 0);
  const eff = sumEarned + sumLost > 0 ? sumEarned / (sumEarned + sumLost) : null;
  const remaining = cycles.reduce((a, c) => a + (CYCLE_MAX - c.earned - c.lost), 0);
  return {
    cycles,
    current,
    loose,
    secured: sumEarned / 3,
    maxPossible: (sumEarned + remaining) / 3,
    projected: eff === null ? null : (sumEarned + eff * remaining) / 3,
    efficiency: eff,
  };
}

/** Pontos que ainda faltam (somando os 3 ciclos) para chegar à média `target` (0–100). */
export function pointsNeeded(s: CycleSummary, target: number) {
  return Math.max(0, target * 3 - s.cycles.reduce((a, c) => a + c.earned, 0));
}

/** Situação em relação à média mínima. */
export type Standing = "secured" | "on-track" | "at-risk" | "impossible" | "no-data";
export function standing(s: CycleSummary, target: number): Standing {
  if (s.secured >= target) return "secured";
  if (s.efficiency === null && s.secured === 0) return "no-data";
  if (s.maxPossible < target) return "impossible";
  if (s.projected !== null && s.projected >= target) return "on-track";
  return "at-risk";
}

/** Aproveitamento nas avaliações já corrigidas (0–1), ou null se nada foi corrigido. */
export function efficiency(a: { earned: number; lost: number }): number | null {
  return a.earned + a.lost > 0 ? a.earned / (a.earned + a.lost) : null;
}

export function fmtNum(n: number, digits = 1): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// ---------- Preferência: média mínima de aprovação ----------
// Guardada na escala 0–10 (ex.: 6 = média 60 de 100), como antes.

const PASS_KEY = "ava-pass-mark";
export function getPassMark(): number {
  try {
    const v = Number(localStorage.getItem(PASS_KEY));
    return v > 0 && v <= 10 ? v : 6;
  } catch {
    return 6;
  }
}
export function setPassMark(v: number) {
  try {
    localStorage.setItem(PASS_KEY, String(v));
  } catch {}
}
/** Média mínima em pontos (0–100). */
export const passPoints = () => getPassMark() * 10;
