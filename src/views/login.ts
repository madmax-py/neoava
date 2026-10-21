import { MoodleError, requestToken } from "../moodle/client";
import { saveToken } from "../browser-cache";
import { cache, demo, setup, state } from "../state";
import { brandMark, h, playIntro } from "../ui";
import { warmUp } from "../prefetch";

const app = document.getElementById("app")!;

/**
 * Entra com o token. Com `btn`, o botão mostra o círculo de carregamento (e a barra de progresso) enquanto os dados
 * de todas as telas vão para o cache; assim, depois de entrar, cada página abre na hora.
 */
async function useToken(t: string, btn?: HTMLButtonElement, remember = true) {
  saveToken(t, remember);
  cache.clear();
  cache.persistent = remember;
  state.site = null;
  setup(t);
  if (btn) {
    btn.disabled = true;
    btn.classList.add("loading");
    showSpinner(btn);
    btn.style.setProperty("--p", "0");
    try {
      await warmUp((f) => btn.style.setProperty("--p", String(f)));
    } catch {
      // Token recusado ou AVA fora do ar: o route() abaixo tenta de novo e mostra o erro.
      state.site = null;
    }
  }
  location.hash = "#/";
  state.route();
}

export function logout() {
  // Na demonstração, "Sair" só fecha a demo: o login real (se houver) continua salvo.
  if (demo) return exitDemo();
  if (!confirm("Sair? O token salvo neste navegador e o cache serão apagados."))
    return;
  saveToken(null);
  cache.clear();
  location.hash = "";
  location.reload();
}

export function showTokenScreen(error?: MoodleError) {
  const user = h("input", {
    name: "username",
    placeholder: "Matrícula",
    autocomplete: "username",
    spellcheck: "false",
  });
  const pass = h("input", {
    name: "password",
    type: "password",
    placeholder: "Senha",
    autocomplete: "current-password",
  });
  const remember = h("input", { type: "checkbox", checked: true });
  const loginBtn = h("button", { type: "submit", class: "primary" }, "Entrar");
  const loginMsg = h("div", { class: "error", hidden: true });
  const tokenInput = h("input", {
    type: "password",
    placeholder: "Cole o token aqui",
    autocomplete: "off",
    spellcheck: "false",
  });
  const tokenBtn = h("button", { type: "submit" }, "Usar token");
  const current = state.client?.maskedToken;

  app.replaceChildren(
    h(
      "section",
      { class: "login-screen" },
      h(
        "div",
        { class: "login-card" },
        h("div", { class: "brand big" }, brandMark(32)),
        h(
          "p",
          { class: "muted" },
          "Suas notas, prazos e disciplinas do AVA UniEvangélica num só lugar.",
        ),
        error &&
          h(
            "div",
            { class: "error" },
            error.needsNewToken
              ? `Sua sessão expirou ou foi revogada (${error.errorcode}). Entre de novo.`
              : `Erro: ${error.message}`,
          ),
        h(
          "form",
          {
            class: "login",
            onsubmit: async (e) => {
              e.preventDefault();
              const u = user.value.trim();
              if (!u || !pass.value) return;
              loginBtn.disabled = true;
              showSpinner(loginBtn);
              loginMsg.hidden = true;
              try {
                const t = await requestToken(__MOODLE_URL__, u, pass.value);
                pass.value = "";
                await useToken(t, loginBtn, remember.checked);
              } catch (err) {
                pass.value = "";
                loginMsg.textContent =
                  err instanceof MoodleError ? err.message : String(err);
                loginMsg.hidden = false;
                loginBtn.disabled = false;
                loginBtn.removeAttribute("aria-label");
                loginBtn.textContent = "Entrar";
                pass.focus();
              }
            },
          },
          user,
          pass,
          h(
            "label",
            {
              class: "remember muted small",
              title: "Desmarque em computador compartilhado: o acesso e as notas somem ao fechar a aba.",
            },
            remember,
            " Lembrar neste computador",
          ),
          loginBtn,
        ),
        loginMsg,
        h(
          "div",
          { class: "demo-entry" },
          h(
            "button",
            { type: "button", class: "ghost", onclick: openDemo },
            "Ver demonstração",
          ),
          h(
            "span",
            { class: "muted small" },
            "Conta fictícia com dados de exemplo. Não acessa o AVA.",
          ),
        ),
        h(
          "p",
          { class: "muted small" },
          "A senha vai direto para o AVA (",
          h("code", {}, "login/token.php"),
          ", mesmo fluxo do app oficial do Moodle) e não é guardada. Só o token fica salvo neste navegador; sem “Lembrar”, ele some ao fechar a aba.",
        ),
        h(
          "details",
          {},
          h("summary", { class: "muted small" }, "Já tenho um token"),
          h(
            "form",
            {
              class: "inline",
              onsubmit: (e) => {
                e.preventDefault();
                const t = tokenInput.value.trim();
                if (t) void useToken(t, tokenBtn, remember.checked);
              },
            },
            tokenInput,
            tokenBtn,
          ),
        ),
        current &&
          h(
            "div",
            { class: "account-row" },
            h("span", { class: "muted small" }, `Token atual: ${current}`),
            h("span", { class: "spacer" }),
            h("a", { href: "#/", class: "small" }, "Voltar ao painel"),
            h(
              "button",
              { class: "link small", type: "button", onclick: logout },
              "Sair",
            ),
          ),
      ),
    ),
  );
  const screen = app.querySelector(".login-screen")!;
  screen.classList.add("intro-bg");
  playIntro([...screen.querySelector(".login-card")!.children], 70);
  user.focus();
}

/** Abre a demonstração (conta fictícia), sem mexer no login real. */
export function openDemo() {
  location.href = `${location.pathname}?demo#/`;
}

export function exitDemo() {
  location.href = location.pathname;
}

/** Troca o texto do botão por um círculo girando (o leitor de tela continua ouvindo "Entrando"). */
function showSpinner(btn: HTMLButtonElement) {
  btn.setAttribute("aria-label", "Entrando");
  btn.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }));
}
