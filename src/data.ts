// Busca e agrega os dados usados por várias telas. Tudo passa pelo cache do cliente.

import type { ActionEvent, Assignment, CalendarEvent, Course, GradeItem, Quiz } from "./moodle/api";
import { api, DAY, ifAvailable, nowS, opts, site, state } from "./state";
import { accumulate, buildMaxIndex, cyclesOf, isCurrent, type Accumulation, type CycleSummary, type MaxIndex } from "./grades";
import { fmtDateTime, fmtRelative, TZ } from "./format";
import { columnChart, h, modBadge } from "./ui";

export async function baseData() {
  const o = opts();
  const [courses, grades, events] = await Promise.all([
    api().courses(site().userid, o),
    ifAvailable("gradereport_overview_get_course_grades", () => api().overviewGrades(o), []),
    ifAvailable("core_calendar_get_action_events_by_timesort", () => api().upcoming(30, 50, o), []),
  ]);
  const visible = courses.filter((c) => !c.hidden);
  return {
    courses: visible,
    current: visible.filter((c) => isCurrent(c)),
    past: visible.filter((c) => !isCurrent(c) && (c.startdate ?? 0) < nowS()),
    gradeBy: new Map(grades.map((g) => [g.courseid, g.grade])),
    events,
  };
}

export interface CourseStats {
  course: Course;
  items: GradeItem[];
  acc: Accumulation | null;
  /** Modelo de 3 ciclos de 100 pontos (null se a disciplina não tem VA1–VA3). */
  cycles: CycleSummary | null;
  events: ActionEvent[];
}

/**
 * Dados do ciclo atual: notas detalhadas de cada disciplina + valores máximos das atividades.
 * Custo: 2 chamadas agregadas (tarefas e quizzes de todas as disciplinas) + 1 por disciplina (notas).
 */
export async function cycleData() {
  const base = await baseData();
  const o = opts();
  const ids = base.current.map((c) => c.id);
  const [assigns, quizzes] = ids.length
    ? await Promise.all([
        ifAvailable("mod_assign_get_assignments", () => api().assignments(ids, o), [] as Assignment[]),
        ifAvailable("mod_quiz_get_quizzes_by_courses", () => api().quizzes(ids, o), [] as Quiz[]),
      ])
    : [[], []];
  const idx = buildMaxIndex(assigns, quizzes);
  const items = await Promise.all(
    base.current.map((c) => ifAvailable("gradereport_user_get_grade_items", () => api().gradeItems(c.id, site().userid, o), [] as GradeItem[]).catch(() => [] as GradeItem[])),
  );
  const stats: CourseStats[] = base.current.map((course, i) => ({
    course,
    items: items[i],
    acc: accumulate(items[i], idx),
    cycles: cyclesOf(items[i], idx, course),
    events: base.events.filter((e) => e.course?.id === course.id),
  }));
  return { ...base, assigns, quizzes, idx, stats };
}

export type { MaxIndex };

export function courseName(c: Course) {
  return c.displayname || c.fullname;
}

export function isLate(ev: ActionEvent) {
  return ev.overdue || ev.timesort < nowS();
}

export const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export const dayLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short" });
const weekdayShort = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "narrow" });

/** Semana da disciplina (1 = semana que começa em `startdate`). */
export function courseWeek(ts: number, course?: Pick<Course, "startdate">): number | null {
  const start = course?.startdate;
  if (!start || ts < start) return null;
  return Math.floor((ts - start) / (7 * DAY)) + 1;
}

/** Só aceita links do próprio AVA; senão cai na página da disciplina no AVA. */
function avaUrl(url: string | undefined, courseid?: number): string | undefined {
  const base = state.client?.baseUrl;
  if (!base) return undefined;
  if (url && url.startsWith(`${base}/`)) return url;
  return courseid ? `${base}/course/view.php?id=${courseid}` : undefined;
}

/** Título que abre a atividade no AVA (nova aba) ou texto simples. */
function activityTitle(name: string, url: string | undefined) {
  return url ? h("a", { href: url, target: "_blank", rel: "noreferrer", class: "event-link", title: "Abrir no AVA" }, name, h("span", { class: "ext" }, " ↗")) : h("span", {}, name);
}

export interface EventRowOptions {
  /** Mostra "Semana N" da disciplina. */
  week?: number | null;
  /** O título abre a atividade no AVA em vez de a disciplina neste app. */
  linkToAva?: boolean;
}

export function eventRow(ev: ActionEvent, o: EventRowOptions = {}) {
  const late = isLate(ev);
  const soon = !late && ev.timesort - nowS() < 3 * DAY;
  const name = ev.activityname ?? ev.name;
  return h(
    "li",
    { class: `event${late ? " late" : soon ? " soon" : ""}` },
    h("div", { class: "event-when" }, h("strong", {}, fmtRelative(ev.timesort)), h("span", {}, fmtDateTime(ev.timesort)), o.week && h("span", { class: "event-week" }, `Semana ${o.week}`)),
    h(
      "div",
      { class: "event-body" },
      h("div", { class: "event-title" }, modBadge(ev.modulename), o.linkToAva ? activityTitle(name, avaUrl(ev.url, ev.course?.id)) : h("span", {}, name)),
      ev.course &&
        (o.linkToAva
          ? h("span", { class: "event-course" }, ev.course.fullname)
          : h("a", { href: `#/disciplina/${ev.course.id}`, class: "event-course" }, ev.course.fullname)),
    ),
    late ? h("span", { class: "chip bad" }, "! Atrasado") : soon ? h("span", { class: "chip warn" }, "⏱ Em breve") : null,
  );
}

function groupByDay(events: ActionEvent[]) {
  const byDay = new Map<string, ActionEvent[]>();
  for (const ev of events) {
    const k = dayKey.format(ev.timesort * 1000);
    byDay.set(k, [...(byDay.get(k) ?? []), ev]);
  }
  return byDay;
}

/** Colunas com a quantidade de entregas por dia nos próximos 14 dias. */
export function deadlineStrip(events: ActionEvent[]) {
  const start = nowS();
  const byDay = groupByDay(events.filter((e) => e.timesort >= start - DAY));
  const cols = Array.from({ length: 14 }, (_, i) => {
    const d = start + i * DAY;
    const list = byDay.get(dayKey.format(d * 1000)) ?? [];
    return {
      label: i === 0 ? "hoje" : weekdayShort.format(d * 1000),
      value: list.length,
      tip: [dayLabel.format(d * 1000), list.length ? `${list.length} entrega(s)` : "nada para entregar", ...list.map((e) => `• ${e.activityname ?? e.name}`)].join("\n"),
      highlight: i === 0,
      showValue: list.length ? String(list.length) : undefined,
    };
  });
  return columnChart(cols, { max: Math.max(3, ...cols.map((c) => c.value)), height: 64, hideEmpty: true });
}

/** Semanas (seg–dom) a partir da semana atual, com contagem de entregas por dia. */
export function weeksGrid(events: ActionEvent[], weeks = 5) {
  const now = nowS();
  const byDay = groupByDay(events);
  // Segunda-feira desta semana, no fuso de Brasília.
  const wdName = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(now * 1000);
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wdName);
  const monday = now - wd * DAY;
  const todayKey = dayKey.format(now * 1000);
  const short = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
  const grid = Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const t = monday + (w * 7 + d) * DAY;
      const k = dayKey.format(t * 1000);
      const list = byDay.get(k) ?? [];
      return {
        date: k,
        count: list.length,
        today: k === todayKey,
        past: t < now && k !== todayKey,
        tip: [dayLabel.format(t * 1000), list.length ? `${list.length} entrega(s)` : "nada para entregar", ...list.map((e) => `• ${e.activityname ?? e.name}`)].join("\n"),
      };
    }),
  );
  const labels = grid.map((w, i) => (i === 0 ? "esta" : short.format((monday + i * 7 * DAY) * 1000)));
  return { grid, labels };
}

// ---------- Encerrados recentemente ----------

export type ClosedStatus = "done" | "draft" | "inprogress" | "missed" | "late-open" | "unknown";

export interface ClosedItem {
  event: CalendarEvent;
  course?: Course;
  status: ClosedStatus;
  /** Para tarefas que ainda aceitam envio atrasado. */
  cutoff?: number;
  /** Link da atividade no AVA. */
  url?: string;
}

/**
 * Prazos que venceram nos últimos `days` dias e se você entregou ou não.
 * Custo: 1 chamada de calendário + 1 por tarefa/quiz encerrado (com cache). Normalmente poucos itens.
 */
export async function recentClosed(courses: Course[], days = 7): Promise<ClosedItem[]> {
  if (!courses.length || !state.available.has("core_calendar_get_calendar_events")) return [];
  const o = opts();
  const now = nowS();
  const ids = courses.map((c) => c.id);
  const events = (await api().calendarEvents(ids, now - days * DAY, now, o)).filter(
    (e) => (e.eventtype === "due" || e.eventtype === "close") && e.modulename && e.timestart <= now,
  );
  if (!events.length) return [];
  const assigns = events.some((e) => e.modulename === "assign") ? await ifAvailable("mod_assign_get_assignments", () => api().assignments(ids, o), [] as Assignment[]) : [];
  const uid = site().userid;

  const items = await Promise.all(
    events.map(async (event): Promise<ClosedItem> => {
      const course = courses.find((c) => c.id === event.courseid);
      try {
        if (event.modulename === "assign" && state.available.has("mod_assign_get_submission_status")) {
          const a = assigns.find((x) => x.id === event.instance);
          const st = await api().submissionStatus(event.instance!, o);
          const sub = st.lastattempt?.submission ?? st.lastattempt?.teamsubmission;
          if (st.lastattempt?.submissionsenabled === false) return { event, course, status: "unknown" };
          if (sub?.status === "submitted") return { event, course, status: "done" };
          const cutoff = a?.cutoffdate && a.cutoffdate > now ? a.cutoffdate : undefined;
          if (sub?.status === "draft") return { event, course, status: "draft", cutoff };
          return { event, course, status: cutoff ? "late-open" : "missed", cutoff };
        }
        if (event.modulename === "quiz" && state.available.has("mod_quiz_get_user_quiz_attempts")) {
          const at = await api().quizAttempts(event.instance!, uid, o);
          if (at.some((x) => x.state === "finished")) return { event, course, status: "done" };
          if (at.some((x) => x.state === "inprogress" || x.state === "overdue")) return { event, course, status: "inprogress" };
          return { event, course, status: "missed" };
        }
      } catch {
        /* sem status: mostra só como encerrado */
      }
      return { event, course, status: "unknown" };
    }),
  );
  const base = state.client!.baseUrl;
  // O calendário não traz o link; monta pelo id do módulo (tarefa) ou da instância (questionário).
  const urlOf = (e: CalendarEvent) => {
    const a = e.modulename === "assign" ? assigns.find((x) => x.id === e.instance) : undefined;
    if (a) return `${base}/mod/assign/view.php?id=${a.cmid}`;
    if (e.modulename === "quiz" && e.instance) return `${base}/mod/quiz/view.php?q=${e.instance}`;
    return `${base}/course/view.php?id=${e.courseid}`;
  };
  return items.map((it) => ({ ...it, url: urlOf(it.event) })).sort((a, b) => b.event.timestart - a.event.timestart);
}

/** Nome limpo do evento ("Término de X" / "X é devido" → "X"). */
export function closedName(e: CalendarEvent) {
  return e.name
    .replace(/^(Término de|Fechamento de|Encerramento de)\s+/i, "")
    .replace(/\s+(é devido|está marcado\(a\) para esta data|está marcada para esta data|fecha)$/i, "")
    .trim();
}

const CLOSED_LABEL: Record<ClosedStatus, [string, string]> = {
  done: ["good", "✓ Entregue"],
  draft: ["warn", "⏱ Rascunho não enviado"],
  inprogress: ["warn", "⏱ Tentativa não finalizada"],
  missed: ["bad", "✕ Não entregue"],
  "late-open": ["warn", "! Atrasada — ainda aceita envio"],
  unknown: ["", "Encerrado"],
};

export function closedRow(it: ClosedItem, o: EventRowOptions = {}) {
  const [cls, label] = CLOSED_LABEL[it.status];
  const e = it.event;
  return h(
    "li",
    { class: `event${it.status === "missed" ? " late" : it.status === "done" || it.status === "unknown" ? " past" : " soon"}` },
    h("div", { class: "event-when" }, h("strong", {}, fmtRelative(e.timestart)), h("span", {}, fmtDateTime(e.timestart)), o.week && h("span", { class: "event-week" }, `Semana ${o.week}`)),
    h(
      "div",
      { class: "event-body" },
      h("div", { class: "event-title" }, modBadge(e.modulename), o.linkToAva ? activityTitle(closedName(e), avaUrl(it.url, e.courseid)) : h("span", {}, closedName(e))),
      it.course &&
        (o.linkToAva
          ? h("span", { class: "event-course" }, courseName(it.course))
          : h("a", { href: `#/disciplina/${it.course.id}`, class: "event-course" }, courseName(it.course))),
      it.cutoff && h("div", { class: "small muted" }, `Envio atrasado aceito até ${fmtDateTime(it.cutoff)}`),
    ),
    h("span", { class: `chip ${cls}` }, label),
  );
}
