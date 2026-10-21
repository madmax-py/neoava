// Estrutura das telas: barra lateral (desktop) / barra inferior (celular), carregamento e erros.

import { MoodleError } from "./moodle/client";
import type { SiteInfo } from "./moodle/api";
import { state } from "./state";
import { themeButton } from "./theme";
import { brandMark, h, icon, skeleton, type Child } from "./ui";
import { logout, showTokenScreen } from "./views/login";

const app = document.getElementById("app")!;

const NAV = [
  { href: "#/", label: "Painel", icon: "home" },
  { href: "#/disciplinas", label: "Disciplinas", icon: "book" },
  { href: "#/prazos", label: "Prazos", icon: "calendar" },
  { href: "#/historico", label: "Histórico", icon: "chart" },
  { href: "#/perfil", label: "Perfil", icon: "user" },
];

function activeHref() {
  const here = location.hash || "#/";
  if (here.startsWith("#/disciplina/")) return "#/disciplinas";
  return NAV.find((n) => n.href !== "#/" && here.startsWith(n.href))?.href ?? "#/";
}

function refresh() {
  state.forceRefresh = true;
  state.route();
}

export function shell(...content: (Child | Child[])[]) {
  const active = activeHref();
  const site = state.site;
  const links = NAV.map((n) => h("a", { href: n.href, class: n.href === active ? "active" : "", "aria-current": n.href === active ? "page" : undefined }, icon(n.icon), h("span", {}, n.label)));

  app.replaceChildren(
    h(
      "div",
      { class: "layout" },
      h(
        "aside",
        { class: "sidebar" },
        h("a", { href: "#/", class: "brand" }, brandMark()),
        h("nav", { class: "side-nav", "aria-label": "Navegação principal" }, links),
        h("div", { class: "side-spacer" }),
        themeButton("side-btn", true),
        h("button", { class: "side-btn", onclick: refresh, title: "Buscar dados novos no AVA" }, icon("refresh"), h("span", {}, "Atualizar dados")),
        site &&
          h(
            "div",
            { class: "side-user" },
            avatar(site, 36),
            h("div", { class: "side-user-text" }, h("strong", { title: site.fullname }, displayName(site.fullname)), h("span", {}, site.username)),
            h("button", { class: "icon-btn", onclick: logout, title: "Sair (esquecer token)", "aria-label": "Sair" }, icon("logout", 18)),
          ),
      ),
      h(
        "header",
        { class: "mobile-top" },
        h("a", { href: "#/", class: "brand" }, brandMark()),
        themeButton("icon-btn"),
        h("button", { class: "icon-btn", onclick: refresh, "aria-label": "Atualizar dados" }, icon("refresh")),
        site && h("a", { href: "#/perfil", "aria-label": "Perfil" }, avatar(site, 30)),
      ),
      h(
        "div",
        { class: "content" },
        h("main", {}, ...content),
        h("footer", {}, "As notas vêm do AVA (Moodle) e podem não ser as notas oficiais do sistema acadêmico. Somente leitura, exceto ao fazer um questionário."),
      ),
      h("nav", { class: "bottom-nav", "aria-label": "Navegação" }, NAV.map((n) => h("a", { href: n.href, class: n.href === active ? "active" : "" }, icon(n.icon, 22), h("span", {}, n.label)))),
    ),
  );
}

export function loading() {
  shell(
    h("div", { class: "page-head" }, h("div", { class: "skeleton title" }, h("div", {}))),
    h("div", { class: "tiles" }, [1, 2, 3, 4].map(() => h("div", { class: "stat" }, skeleton(2)))),
    h("div", { class: "bento" }, [8, 4, 7, 5].map((n) => h("div", { class: `card span-${n}` }, skeleton(5)))),
  );
}

export function errorView(e: unknown) {
  if (e instanceof MoodleError && e.needsNewToken) return showTokenScreen(e);
  const msg = e instanceof MoodleError ? `${e.message} (${e.errorcode} em ${e.wsfunction})` : String(e);
  shell(h("div", { class: "error" }, msg), h("button", { onclick: () => state.route() }, "Tentar de novo"));
}

export function pageHead(eyebrow: Child | Child[], title: string, aside?: Child) {
  return h("div", { class: "page-head" }, h("div", {}, h("p", { class: "eyebrow" }, eyebrow), h("h1", {}, title)), aside);
}

/** "MARIA DA SILVA" → "Maria da Silva" (nomes costumam vir em caixa alta do sistema acadêmico). */
export function displayName(full: string) {
  if (full !== full.toUpperCase()) return full;
  const small = new Set(["da", "de", "do", "das", "dos", "e"]);
  return full
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function firstName(full: string) {
  return displayName(full).split(/\s+/)[0] ?? "";
}

/** Foto de perfil do AVA, ou iniciais quando não há foto (ou ela não carrega). */
export function avatar(info: Pick<SiteInfo, "fullname" | "userpictureurl">, size: number) {
  const parts = info.fullname.trim().split(/\s+/);
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  const fallback = h("span", { class: "avatar", style: `--s:${size}px`, title: info.fullname, "aria-label": info.fullname }, initials);
  const url = info.userpictureurl;
  // Silhueta padrão do tema = usuário sem foto.
  if (!url || /\/theme\/image\.php\/.*\/u\/f\d/.test(url)) return fallback;
  const src = url.includes("/pluginfile.php/") && !url.includes("/webservice/") ? state.client!.fileUrl(url.replace("/pluginfile.php/", "/webservice/pluginfile.php/")) : url;
  const img = h("img", { class: "avatar", style: `--s:${size}px`, src, alt: info.fullname, title: info.fullname, referrerpolicy: "no-referrer" });
  img.addEventListener("error", () => img.replaceWith(fallback));
  return img;
}
