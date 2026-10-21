// Wrappers tipados das funções de consulta. Os tipos cobrem só os campos usados aqui;
// o Moodle devolve mais coisas.

import type { CallOptions, MoodleClient } from "./client";
import { cleanGradeHtml, stripHtml } from "../format";

export interface SiteInfo {
  sitename: string;
  siteurl: string;
  userid: number;
  username: string;
  fullname: string;
  /** Foto de perfil. Sem foto, o Moodle devolve a silhueta padrão do tema (.../theme/image.php/.../u/f1). */
  userpictureurl?: string;
  release?: string;
  version?: string;
  functions: { name: string; version: string }[];
}

export interface Course {
  id: number;
  enablecompletion?: boolean;
  shortname: string;
  fullname: string;
  displayname?: string;
  visible?: number;
  hidden?: boolean;
  progress?: number | null;
  completed?: boolean;
  startdate?: number;
  enddate?: number;
  lastaccess?: number | null;
  isfavourite?: boolean;
}

export interface CourseGrade {
  courseid: number;
  grade: string;
  rawgrade: string | null;
  rank?: number;
}

export interface GradeItem {
  id: number;
  itemname: string | null;
  itemtype: string;
  itemmodule: string | null;
  iteminstance?: number;
  categoryid?: number | null;
  cmid?: number;
  gradedategraded?: number | null;
  gradeishidden?: boolean;
  gradeformatted?: string;
  graderaw?: number | null;
  grademin?: number;
  grademax?: number;
  percentageformatted?: string;
  weightformatted?: string;
  feedback?: string;
  /** Preenchido pelo cliente quando o AVA marca aprovado/reprovado no item (ícone no HTML). */
  passed?: boolean | null;
}

export interface CalendarEvent {
  id: number;
  name: string;
  courseid: number;
  modulename?: string;
  instance?: number;
  /** due, close, open, course, user, site… */
  eventtype: string;
  timestart: number;
}

export interface Assignment {
  id: number;
  cmid: number;
  course: number;
  name: string;
  /** Nota máxima da tarefa (negativo = escala). */
  grade?: number;
  duedate: number;
  /** Depois do prazo, aceita envio atrasado até esta data (0 = sem corte). */
  cutoffdate?: number;
  allowsubmissionsfromdate?: number;
  intro?: string;
}

export interface ActionEvent {
  id: number;
  name: string;
  activityname?: string;
  modulename?: string;
  instance?: number;
  eventtype: string;
  timestart: number;
  timesort: number;
  overdue?: boolean;
  url?: string;
  course?: { id: number; fullname: string; shortname: string };
  action?: { name: string; url: string; actionable: boolean; itemcount?: number };
}

export interface ModuleContent {
  type: string;
  filename: string;
  fileurl: string;
  filesize?: number;
  timemodified?: number;
  mimetype?: string;
}

export interface CourseModule {
  id: number;
  name: string;
  modname: string;
  url?: string;
  visible?: number;
  uservisible?: boolean;
  description?: string;
  contents?: ModuleContent[];
  dates?: { label: string; timestamp: number }[];
}

export interface CourseSection {
  id: number;
  name: string;
  section: number;
  summary?: string;
  visible?: number;
  uservisible?: boolean;
  modules: CourseModule[];
}

export interface SubmissionStatus {
  lastattempt?: {
    submission?: { status: string; timemodified?: number };
    teamsubmission?: { status: string; timemodified?: number };
    gradingstatus?: string;
    graded?: boolean;
    extensionduedate?: number;
    submissionsenabled?: boolean;
  };
  feedback?: {
    gradefordisplay?: string;
    gradeddate?: number;
    plugins?: { type: string; name: string; editorfields?: { name: string; text: string; format?: number }[] }[];
  };
}

export interface Quiz {
  id: number;
  coursemodule: number;
  course: number;
  name: string;
  timeopen: number;
  timeclose: number;
  timelimit?: number;
  /** Tentativas permitidas (0 = ilimitadas). */
  attempts: number;
  /** Nota máxima do questionário. */
  grade: number;
  sumgrades: number;
  grademethod?: number;
  decimalpoints?: number;
  visible?: boolean;
  /** "free" (qualquer página) ou "sequential" (só a página atual, sem voltar). */
  navmethod?: string;
  intro?: string;
}

export interface QuizAttempt {
  id: number;
  attempt: number;
  state: "inprogress" | "overdue" | "finished" | "abandoned" | string;
  timestart: number;
  timefinish: number;
  /** Pontos brutos (escala sumgrades do quiz); null se as opções de revisão escondem a nota. */
  sumgrades: number | null;
  /** Página em que a tentativa está (0 = primeira). */
  currentpage?: number;
  /** Ordem das questões: números dos slots, com 0 marcando o fim de cada página (ex.: "1,2,0,3,0"). */
  layout?: string;
  timemodified?: number;
}

export interface QuizAccess {
  canattempt: boolean;
  canreviewmyattempts: boolean;
  /** Descrição das regras (tempo limite, senha, rede, Safe Exam Browser…). */
  accessrules: string[];
  activerulenames: string[];
  /** Motivos que impedem entrar no questionário agora. */
  preventaccessreasons: string[];
}

export interface AttemptAccess {
  /** Hora em que a tentativa expira (0/ausente = sem tempo limite). */
  endtime?: number;
  isfinished: boolean;
  ispreflightcheckrequired?: boolean;
  preventnewattemptreasons: string[];
}

/** Uma questão como o Moodle devolve: o HTML já renderizado, com os campos do formulário. */
export interface QuizQuestion {
  slot: number;
  type: string;
  page: number;
  html: string;
  /** Número exibido ("1", "2"…); vazio em blocos de descrição. */
  number?: number;
  questionnumber?: string;
  flagged: boolean;
  /** Estado interno: todo, complete, invalid, gradedright, gradedwrong, gradedpartial… */
  state?: string;
  /** Texto do estado ("Ainda não respondida", "Correta"…). */
  status?: string;
  mark?: string;
  maxmark?: number;
  sequencecheck?: number;
  blockedbyprevious?: boolean;
}

export interface AttemptData {
  attempt: QuizAttempt;
  messages: string[];
  /** Próxima página, ou -1 se esta é a última. */
  nextpage: number;
  questions: QuizQuestion[];
}

export interface AttemptReview {
  grade: string;
  attempt: QuizAttempt;
  /** Linhas do resumo (Iniciado em, Concluída em, Tempo, Notas, Feedback…), com HTML. */
  additionaldata: { id: string; title: string; content: string }[];
  questions: QuizQuestion[];
}

export interface CompletionStatus {
  cmid: number;
  modname: string;
  instance: number;
  /** 0 incompleto · 1 completo · 2 completo e aprovado · 3 completo e reprovado */
  state: number;
  timecompleted: number;
  hascompletion?: boolean;
  isoverallcomplete?: boolean;
  uservisible?: boolean;
}

export interface UserProfile {
  id: number;
  username: string;
  firstname: string;
  lastname: string;
  fullname: string;
  email?: string;
  department?: string;
  institution?: string;
  idnumber?: string;
  auth?: string;
  lang?: string;
  city?: string;
  country?: string;
  description?: string;
  firstaccess?: number;
  lastaccess?: number;
  profileimageurl?: string;
  customfields?: { type: string; value: string; displayvalue?: string; name: string; shortname: string }[];
}

const MIN = 60;

/** Par nome → valor de um campo do formulário da questão, no formato que o Moodle espera. */
export interface FormPair {
  name: string;
  value: string;
}

/** Dados de pré-verificação (ex.: { quizpassword: "…" } para quiz com senha). */
export type Preflight = Record<string, string>;
const preflight = (p?: Preflight) => (p ? Object.entries(p).map(([name, value]) => ({ name, value })) : undefined);

/** Campos formatados do quadro de notas podem trazer HTML (ícones de aprovado/reprovado). */
function cleanItem(i: GradeItem): GradeItem {
  const grade = cleanGradeHtml(i.gradeformatted);
  const pct = cleanGradeHtml(i.percentageformatted);
  return {
    ...i,
    itemname: i.itemname && i.itemname.includes("<") ? stripHtml(i.itemname) : i.itemname,
    gradeformatted: grade.text,
    percentageformatted: pct.text,
    weightformatted: cleanGradeHtml(i.weightformatted).text,
    passed: grade.passed ?? pct.passed,
  };
}

export function createApi(c: MoodleClient) {
  return {
    siteInfo: (o?: CallOptions) =>
      c.call<SiteInfo>("core_webservice_get_site_info", {}, { ttlSeconds: 60 * MIN, ...o }),

    courses: (userid: number, o?: CallOptions) =>
      c.call<Course[]>("core_enrol_get_users_courses", { userid }, { ttlSeconds: 60 * MIN, ...o }),

    overviewGrades: (o?: CallOptions) =>
      c
        .call<{ grades: CourseGrade[] }>("gradereport_overview_get_course_grades", {}, { ttlSeconds: 20 * MIN, ...o })
        .then((r) => r.grades.map((g) => ({ ...g, grade: cleanGradeHtml(g.grade).text }))),

    /** userid é obrigatório na prática: sem ele o Moodle tenta listar a turma toda (nopermissions). */
    gradeItems: (courseid: number, userid: number, o?: CallOptions) =>
      c
        .call<{ usergrades: { gradeitems: GradeItem[] }[] }>(
          "gradereport_user_get_grade_items",
          { courseid, userid },
          { ttlSeconds: 20 * MIN, ...o },
        )
        .then((r) => (r.usergrades[0]?.gradeitems ?? []).map(cleanItem)),

    assignments: (courseids: number[], o?: CallOptions) =>
      c
        .call<{ courses: { id: number; assignments: Assignment[] }[] }>(
          "mod_assign_get_assignments",
          { courseids },
          { ttlSeconds: 20 * MIN, ...o },
        )
        .then((r) => r.courses.flatMap((x) => x.assignments)),

    submissionStatus: (assignid: number, o?: CallOptions) =>
      c.call<SubmissionStatus>("mod_assign_get_submission_status", { assignid }, { ttlSeconds: 15 * MIN, ...o }),

    quizzes: (courseids: number[], o?: CallOptions) =>
      c
        .call<{ quizzes: Quiz[] }>("mod_quiz_get_quizzes_by_courses", { courseids }, { ttlSeconds: 60 * MIN, ...o })
        .then((r) => r.quizzes),

    quizAttempts: (quizid: number, userid: number, o?: CallOptions) =>
      c
        .call<{ attempts: QuizAttempt[] }>(
          "mod_quiz_get_user_quiz_attempts",
          { quizid, userid, status: "all", includepreviews: false },
          { ttlSeconds: 20 * MIN, ...o },
        )
        .then((r) => r.attempts),

    /** Nota oficial do quiz segundo o método de avaliação (maior, média, primeira, última). */
    quizBestGrade: (quizid: number, userid: number, o?: CallOptions) =>
      c.call<{ hasgrade: boolean; grade?: number; gradetopass?: number }>(
        "mod_quiz_get_user_best_grade",
        { quizid, userid },
        { ttlSeconds: 20 * MIN, ...o },
      ),

    quizAccess: (quizid: number, o?: CallOptions) =>
      c.call<QuizAccess>("mod_quiz_get_quiz_access_information", { quizid }, { ttlSeconds: 5 * MIN, ...o }),

    attemptAccess: (quizid: number, attemptid: number, o?: CallOptions) =>
      c.call<AttemptAccess>("mod_quiz_get_attempt_access_information", { quizid, attemptid }, { ttlSeconds: 5 * MIN, ...o }),

    quizQtypes: (quizid: number, o?: CallOptions) =>
      c
        .call<{ questiontypes: string[] }>("mod_quiz_get_quiz_required_qtypes", { quizid }, { ttlSeconds: 60 * MIN, ...o })
        .then((r) => r.questiontypes),

    /**
     * Questões de uma página de uma tentativa em andamento. Só lê: não salva nada, não muda de página.
     * Nunca vai para o cache (a tentativa muda a cada resposta).
     */
    attemptData: (attemptid: number, page: number, pre?: Preflight) =>
      c.call<AttemptData>("mod_quiz_get_attempt_data", { attemptid, page, preflightdata: preflight(pre) }, { noStore: true }),

    /** Situação de cada questão antes de enviar (sem o HTML). */
    attemptSummary: (attemptid: number, pre?: Preflight) =>
      c
        .call<{ questions: QuizQuestion[] }>("mod_quiz_get_attempt_summary", { attemptid, preflightdata: preflight(pre) }, { noStore: true })
        .then((r) => r.questions),

    // ---------- Escrita (fazer o questionário). Cada uma exige allowWrite; a tela confirma iniciar e enviar. ----------

    /** Abre uma tentativa nova. Conta no limite de tentativas e o tempo começa a correr. */
    startAttempt: (quizid: number, pre?: Preflight) =>
      c
        .call<{ attempt: QuizAttempt }>("mod_quiz_start_attempt", { quizid, preflightdata: preflight(pre) }, { allowWrite: true })
        .then((r) => r.attempt),

    /** Salvamento automático (como o do AVA): grava as respostas sem "avançar" a questão. */
    saveAttempt: (attemptid: number, data: FormPair[], pre?: Preflight) =>
      c.call<{ status: boolean }>("mod_quiz_save_attempt", { attemptid, data, preflightdata: preflight(pre) }, { allowWrite: true }),

    /**
     * Salva as respostas da página (como o botão "Próxima página" do AVA).
     * Com finish = true, ENVIA a tentativa para correção — não tem volta.
     */
    processAttempt: (attemptid: number, data: FormPair[], finish: boolean, pre?: Preflight, timeup = false) =>
      c.call<{ state: string }>(
        "mod_quiz_process_attempt",
        { attemptid, data, finishattempt: finish, timeup, preflightdata: preflight(pre) },
        { allowWrite: true },
      ),

    /** Registra a página atual da tentativa (necessário para avançar na navegação sequencial). */
    viewAttempt: (attemptid: number, page: number, pre?: Preflight) =>
      c.call<{ status: boolean }>("mod_quiz_view_attempt", { attemptid, page, preflightdata: preflight(pre) }, { allowWrite: true }),

    /** Revisão de uma tentativa finalizada (todas as páginas). O que aparece depende das opções de revisão do quiz. */
    attemptReview: (attemptid: number, o?: CallOptions) =>
      c.call<AttemptReview>("mod_quiz_get_attempt_review", { attemptid, page: -1 }, { ttlSeconds: 30 * MIN, ...o }),

    completion: (courseid: number, userid: number, o?: CallOptions) =>
      c
        .call<{ statuses: CompletionStatus[] }>(
          "core_completion_get_activities_completion_status",
          { courseid, userid },
          { ttlSeconds: 20 * MIN, ...o },
        )
        .then((r) => r.statuses),

    /**
     * Token de exportação do calendário. É uma credencial (dá acesso de leitura ao seu calendário),
     * por isso nunca vai para o cache.
     */
    calendarExportToken: () =>
      c.call<{ token: string }>("core_calendar_get_calendar_export_token", {}, { noStore: true }).then((r) => r.token),

    /**
     * Eventos do calendário num intervalo, incluindo os já encerrados
     * (o get_action_events só traz o que ainda tem ação pendente).
     */
    calendarEvents: (courseids: number[], from: number, to: number, o?: CallOptions) => {
      // Arredonda para a hora cheia para reaproveitar o cache.
      const h = (t: number) => Math.floor(t / 3600) * 3600;
      return c
        .call<{ events: CalendarEvent[] }>(
          "core_calendar_get_calendar_events",
          { events: { courseids }, options: { userevents: 1, siteevents: 1, timestart: h(from), timeend: h(to) + 3600 } },
          { ttlSeconds: 15 * MIN, ...o },
        )
        .then((r) => r.events);
    },

    /** Seus próprios dados de perfil (somente leitura). */
    profile: (userid: number, o?: CallOptions) =>
      c
        .call<UserProfile[]>("core_user_get_users_by_field", { field: "id", values: [userid] }, { ttlSeconds: 60 * MIN, ...o })
        .then((r) => r[0] ?? null),

    badges: (o?: CallOptions) =>
      c
        .call<{ badges: { id: number; name: string; dateissued: number; badgeurl?: string }[] }>("core_badges_get_user_badges", {}, { ttlSeconds: 60 * MIN, ...o })
        .then((r) => r.badges ?? []),

    /** Próximos prazos de todas as disciplinas numa única chamada. */
    upcoming: (days = 30, limitnum = 50, o?: CallOptions) => {
      // Arredonda para a hora cheia para o cache funcionar entre chamadas próximas.
      const from = Math.floor(Date.now() / 1000 / 3600) * 3600 - 7 * 86400; // inclui atrasados da última semana
      return c
        .call<{ events: ActionEvent[] }>(
          "core_calendar_get_action_events_by_timesort",
          { timesortfrom: from, timesortto: from + (days + 7) * 86400, limitnum },
          { ttlSeconds: 15 * MIN, ...o },
        )
        .then((r) => r.events);
    },

    contents: (courseid: number, o?: CallOptions) =>
      c.call<CourseSection[]>("core_course_get_contents", { courseid }, { ttlSeconds: 30 * MIN, ...o }),
  };
}

export type Api = ReturnType<typeof createApi>;
