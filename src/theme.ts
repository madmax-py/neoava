// Tema: segue o sistema, ou claro/escuro fixo escolhido pelo usuário (salvo no navegador).
// O index.html aplica o tema salvo antes da primeira pintura; aqui ficam o botão e a troca.

import { h, icon } from "./ui";

type Pref = "system" | "light" | "dark";

const KEY = "ava-theme";
const ORDER: Pref[] = ["system", "light", "dark"];
const LABEL: Record<Pref, string> = { system: "Tema do sistema", light: "Tema claro", dark: "Tema escuro" };
const ICON: Record<Pref, string> = { system: "monitor", light: "sun", dark: "moon" };
const media = matchMedia("(prefers-color-scheme: dark)");

function load(): Pref {
  try {
    const v = localStorage.getItem(KEY) as Pref | null;
    return v && ORDER.includes(v) ? v : "system";
  } catch {
    return "system";
  }
}

let pref = load();

function apply() {
  document.documentElement.dataset.theme = pref === "system" ? (media.matches ? "dark" : "light") : pref;
}

media.addEventListener("change", () => pref === "system" && apply());
apply();

function fill(btn: HTMLElement, withLabel: boolean) {
  btn.title = `${LABEL[pref]} (clique para trocar)`;
  btn.setAttribute("aria-label", LABEL[pref]);
  btn.replaceChildren(icon(ICON[pref]), ...(withLabel ? [h("span", {}, LABEL[pref])] : []));
}

function cycle() {
  pref = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // modo privado / storage bloqueado: vale só para esta aba
  }
  apply();
  document.querySelectorAll<HTMLElement>("[data-theme-btn]").forEach((b) => fill(b, b.dataset.themeBtn === "label"));
}

/** Botão que alterna Sistema → Claro → Escuro. `withLabel` mostra o nome ao lado do ícone (barra lateral). */
export function themeButton(cls: string, withLabel = false) {
  const btn = h("button", { class: cls, onclick: cycle, "data-theme-btn": withLabel ? "label" : "icon" });
  fill(btn, withLabel);
  return btn;
}
