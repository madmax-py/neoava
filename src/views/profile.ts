// Perfil: seus dados no AVA (somente leitura).

import { baseData } from "../data";
import { fmtDate, fmtDateTime, stripHtml } from "../format";
import { semesterOf } from "../grades";
import { avatar, displayName, pageHead, shell } from "../layout";
import { api, ifAvailable, opts, site, state } from "../state";
import { card, h, icon, type Child } from "../ui";
import { logout } from "./login";
import jackpotLogo from "../assets/jackpot-logo.png";

const AUTH: Record<string, string> = { manual: "Conta local do AVA", ldap: "Diretório da instituição (LDAP)", oauth2: "Login social / OAuth", saml2: "Login institucional (SSO)", cas: "Login institucional (CAS)" };

function rows(list: [string, Child][]) {
  const visible = list.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false);
  if (!visible.length) return h("p", { class: "empty" }, "Nada informado.");
  return h("dl", { class: "kv" }, visible.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
}

export async function profilePage(id: number) {
  const o = opts();
  const s = site();
  const [profile, badges, base] = await Promise.all([
    ifAvailable("core_user_get_users_by_field", () => api().profile(s.userid, o), null),
    ifAvailable("core_badges_get_user_badges", () => api().badges(o), []),
    baseData(),
  ]);

  const custom = profile?.customfields ?? [];
  const sems = new Set(base.courses.filter((c) => c.startdate).map((c) => semesterOf(c.startdate!)));
  const firstStart = Math.min(...base.courses.map((c) => c.startdate || Infinity));
  const name = displayName(profile?.fullname ?? s.fullname);

  if (id !== state.routeId) return; // o usuário já navegou para outra tela
  shell(
    pageHead("Seus dados no AVA", "Perfil"),
    h(
      "section",
      { class: "card profile-hero" },
      avatar({ fullname: s.fullname, userpictureurl: s.userpictureurl }, 88),
      h(
        "div",
        { class: "profile-id" },
        h("h2", {}, name),
        h("p", { class: "muted" }, [profile?.email, s.username && `Matrícula ${s.username}`].filter(Boolean).join(" · ")),
        h(
          "div",
          { class: "profile-tags" },
          custom.filter((c) => c.value).map((c) => h("span", { class: "chip" }, `${c.name}: ${stripHtml(c.displayvalue ?? c.value)}`)),
        ),
      ),
      h(
        "a",
        { href: `${state.client!.baseUrl}/user/edit.php`, target: "_blank", rel: "noreferrer", class: "button" },
        "Editar no AVA ",
        icon("external", 14),
      ),
    ),
    h(
      "div",
      { class: "bento" },
      h(
        "section",
        { class: "card span-6" },
        h("header", { class: "card-head" }, h("h2", {}, "Dados acadêmicos")),
        rows([
          ...custom.map((c): [string, Child] => [c.name, stripHtml(c.displayvalue ?? c.value)]),
          ["Instituição", profile?.institution],
          ["Departamento", profile?.department],
          ["Código (idnumber)", profile?.idnumber],
          ["Cidade", profile?.city],
        ]),
      ),
      h(
        "section",
        { class: "card span-6" },
        h("header", { class: "card-head" }, h("h2", {}, "Sua trajetória no AVA")),
        h(
          "div",
          { class: "mini-stats" },
          h("div", {}, h("strong", {}, String(base.courses.length)), h("span", {}, "disciplinas")),
          h("div", {}, h("strong", {}, String(base.current.length)), h("span", {}, "no ciclo atual")),
          h("div", {}, h("strong", {}, String(sems.size)), h("span", {}, "semestres")),
          h("div", {}, h("strong", {}, String(badges.length)), h("span", {}, "medalhas")),
        ),
        rows([
          ["Primeira disciplina", Number.isFinite(firstStart) ? `${fmtDate(firstStart)} (${semesterOf(firstStart)})` : null],
          ["Primeiro acesso", profile?.firstaccess ? fmtDate(profile.firstaccess) : null],
          ["Último acesso", profile?.lastaccess ? fmtDateTime(profile.lastaccess) : null],
        ]),
        badges.length > 0 && h("div", { class: "profile-tags" }, badges.map((b) => h("span", { class: "chip good", "data-tip": `Recebida em ${fmtDate(b.dateissued)}` }, `🏅 ${b.name}`))),
      ),
      h(
        "section",
        { class: "card span-6" },
        h("header", { class: "card-head" }, h("h2", {}, "Conta")),
        rows([
          ["Nome", name],
          ["E-mail", profile?.email],
          ["Usuário", s.username],
          ["Forma de login", profile?.auth ? (AUTH[profile.auth] ?? profile.auth) : null],
          ["Idioma", profile?.lang],
        ]),
        profile?.description && h("p", { class: "muted small" }, stripHtml(profile.description)),
      ),
      h(
        "section",
        { class: "card span-6" },
        h("header", { class: "card-head" }, h("h2", {}, "Este app")),
        rows([
          ["AVA", `${s.sitename}`],
          ["Versão do Moodle", s.release?.replace(/\s*\(.*\)/, "")],
          ["Token em uso", h("code", {}, state.client!.maskedToken)],
          ["Funções liberadas", `${state.available.size} (o app usa só as de consulta)`],
        ]),
        h(
          "div",
          { class: "cal-actions" },
          h("button", { onclick: logout }, icon("logout", 16), " Sair e esquecer token"),
        ),
        h("p", { class: "note" }, "Os dados ficam só neste navegador (cache local). Nada é enviado para outro servidor além do próprio AVA."),
      ),
    ),
    h(
      "footer",
      { class: "credits" },
      h("span", {}, `© ${new Date().getFullYear()} · Desenvolvido por `, h("strong", {}, "JACKPOT BUSINESS")),
      h("img", { src: jackpotLogo, alt: "Logo da JACKPOT BUSINESS", width: 28, height: 28 }),
    ),
  );
}

