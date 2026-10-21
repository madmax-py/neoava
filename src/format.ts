export const TZ = "America/Sao_Paulo";

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const dateOnly = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });

/** Timestamp Unix (segundos) → "seg., 14/10, 23:59" no horário de Brasília. */
export function fmtDateTime(ts: number): string {
  return dateTime.format(ts * 1000);
}

export function fmtDate(ts: number): string {
  return dateOnly.format(ts * 1000);
}

/** "em 3 dias", "há 2 h", "agora". */
export function fmtRelative(ts: number, now = Date.now() / 1000): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

/** Remove HTML (descrições do Moodle vêm em HTML). */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Limpa um campo de nota que pode vir com HTML do Moodle.
 * Quando o item tem "nota para aprovação", o AVA anexa um ícone, ex.:
 *   `3,00 <i class="icon fa fa-xmark text-danger" title="Falha" aria-label="Falha">`
 * Devolve o texto puro e, se houver ícone, se passou (true) ou não (false).
 */
export function cleanGradeHtml(value: string | null | undefined): { text: string; passed: boolean | null } {
  if (!value) return { text: value ?? "", passed: null };
  // Sem HTML, mas pode vir com entidades ("0,00&nbsp;/&nbsp;5,00").
  if (!value.includes("<")) return { text: value.includes("&") ? stripHtml(value) : value, passed: null };
  let passed: boolean | null = null;
  if (/text-danger|fa-xmark|fa-times|fa-close/.test(value)) passed = false;
  else if (/text-success|fa-check/.test(value)) passed = true;
  let text = stripHtml(value);
  // Só havia o ícone: usa o rótulo acessível dele ("Falha", "Aprovado"…).
  if (!text && passed === null) text = value.match(/(?:aria-label|title)="([^"]*)"/)?.[1] ?? "";
  return { text, passed };
}
