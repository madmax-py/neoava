// Prazos: próximos 30 dias e link da agenda.

import { MoodleError } from "../moodle/client";
import type { ActionEvent } from "../moodle/api";
import { api, site, state } from "../state";
import { baseData, closedName, closedRow, courseWeek, dayLabel, deadlineStrip, eventRow, isLate, recentClosed, upcomingLinks } from "../data";
import { pageHead, shell } from "../layout";
import { showTokenScreen } from "./login";
import { card, h } from "../ui";

export async function deadlinesPage(id: number) {
  const { events, current, courses } = await baseData();
  const [closed, links] = await Promise.all([recentClosed(current, 7), upcomingLinks(events)]);
  const missed = closed.filter((c) => c.status === "missed");
  const lateOpen = closed.filter((c) => c.status === "late-open" || c.status === "draft");
  const groups = new Map<string, ActionEvent[]>();
  for (const ev of events) {
    const k = isLate(ev) ? "Atrasados" : dayLabel.format(ev.timesort * 1000);
    groups.set(k, [...(groups.get(k) ?? []), ev]);
  }
  if (id !== state.routeId) return; // o usuário já navegou para outra tela
  const startOf = new Map(courses.map((c) => [c.id, c]));
  const row = (ev: ActionEvent) => eventRow(ev, { week: courseWeek(ev.timesort, startOf.get(ev.course?.id ?? 0)), linkToAva: true, localHref: links.get(ev.id) });
  shell(
    pageHead("Próximos 30 dias", "Prazos"),
    (missed.length > 0 || lateOpen.length > 0) &&
      h(
        "div",
        { class: "alert" },
        missed.length > 0 && h("div", {}, h("strong", {}, `✕ ${missed.length} prazo(s) encerrado(s) sem entrega nos últimos 7 dias: `), missed.map((m) => closedName(m.event)).join(", "), "."),
        lateOpen.length > 0 && h("div", {}, h("strong", {}, `! Ainda dá tempo: `), lateOpen.map((m) => closedName(m.event)).join(", "), " (aceita envio atrasado ou está em rascunho)."),
      ),
    card("Entregas por dia", deadlineStrip(events)),
    events.length
      ? [...groups].map(([day, list]) => h("section", { class: "day-group" }, h("h3", {}, day), h("ul", { class: "events" }, list.map(row))))
      : h("p", { class: "empty" }, "🎉 Nada pendente nos próximos 30 dias."),
    closed.length > 0 &&
      h(
        "section",
        { class: "day-group" },
        h("h3", {}, "Encerrados nos últimos 7 dias"),
        h("ul", { class: "events" }, closed.map((c) => closedRow(c, { week: courseWeek(c.event.timestart, c.course), linkToAva: true }))),
      ),
    state.available.has("core_calendar_get_calendar_export_token") && calendarCard(),
  );
}

/**
 * Link .ics para assinar o calendário do AVA no Google Agenda/celular.
 * O token só é pedido ao clicar, nunca vai para o cache e só existe nesta tela.
 */
function calendarCard() {
  const body = h("div", { class: "cal-body" });
  const gen = h("button", { class: "primary" }, "Gerar meu link da agenda");
  gen.addEventListener("click", async () => {
    gen.disabled = true;
    gen.textContent = "Gerando…";
    try {
      const token = await api().calendarExportToken();
      const url = `${state.client!.baseUrl}/calendar/export_execute.php?${new URLSearchParams({
        userid: String(site().userid),
        authtoken: token,
        preset_what: "all",
        preset_time: "recentupcoming",
      })}`;
      const webcal = url.replace(/^https?:/, "webcal:");
      const input = h("input", { readonly: true, value: url, class: "cal-url", onfocus: (e) => (e.target as HTMLInputElement).select() });
      const copy = h("button", {}, "Copiar");
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(url);
          copy.textContent = "Copiado ✓";
        } catch {
          input.select();
          copy.textContent = "Use Ctrl+C";
        }
      });
      body.replaceChildren(
        h("div", { class: "cal-row" }, input, copy),
        h(
          "div",
          { class: "cal-actions" },
          h("a", { href: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`, target: "_blank", rel: "noreferrer", class: "button" }, "Adicionar ao Google Agenda"),
          h("a", { href: webcal, class: "button" }, "Abrir no app de agenda (celular/Outlook/Apple)"),
        ),
        h(
          "p",
          { class: "note" },
          "⚠ Este link é pessoal: quem tiver ele consegue ver seus prazos. Não compartilhe. Ele deixa de funcionar se você trocar a senha do AVA. ",
          "A agenda inclui eventos recentes e próximos; o app de agenda atualiza sozinho (o Google pode levar algumas horas).",
        ),
      );
    } catch (e) {
      if (e instanceof MoodleError && e.needsNewToken) return showTokenScreen(e);
      gen.disabled = false;
      gen.textContent = "Gerar meu link da agenda";
      body.append(h("div", { class: "error" }, e instanceof MoodleError ? e.message : String(e)));
    }
  });
  body.append(gen);
  return card(
    "Assinar no Google Agenda ou no celular",
    h("p", { class: "muted small" }, "Gera um link do calendário do próprio AVA. Seus prazos passam a aparecer na sua agenda e se atualizam sozinhos."),
    body,
  );
}

