import { MoodleError, requestToken } from "../moodle/client";
import { saveToken } from "../browser-cache";
import { cache, setup, state } from "../state";
import { brandMark, h } from "../ui";

const app = document.getElementById("app")!;

function useToken(t: string) {
  saveToken(t);
  cache.clear();
  state.site = null;
  setup(t);
  location.hash = "#/";
  state.route();
}

export function logout() {
  if (!confirm("Sair? O token salvo neste navegador e o cache serão apagados.")) return;
  saveToken(null);
  cache.clear();
  location.hash = "";
  location.reload();
}

export function showTokenScreen(error?: MoodleError) {
  const user = h("input", { name: "username", placeholder: "Matrícula", autocomplete: "username", spellcheck: "false" });
  const pass = h("input", { name: "password", type: "password", placeholder: "Senha", autocomplete: "current-password" });
  const loginBtn = h("button", { type: "submit", class: "primary" }, "Entrar");
  const loginMsg = h("div", { class: "error", hidden: true });
  const tokenInput = h("input", { type: "password", placeholder: "Cole o token aqui", autocomplete: "off", spellcheck: "false" });
  const current = state.client?.maskedToken;

  app.replaceChildren(
    h(
      "section",
      { class: "login-screen" },
      h(
        "div",
        { class: "login-card" },
        h("div", { class: "brand big" }, brandMark(32)),
        h("p", { class: "muted" }, "Suas notas, prazos e disciplinas do AVA UniEvangélica num só lugar."),
        error &&
          h("div", { class: "error" }, error.needsNewToken ? `Sua sessão expirou ou foi revogada (${error.errorcode}). Entre de novo.` : `Erro: ${error.message}`),
        h(
          "form",
          {
            class: "login",
            onsubmit: async (e) => {
              e.preventDefault();
              const u = user.value.trim();
              if (!u || !pass.value) return;
              loginBtn.disabled = true;
              loginBtn.textContent = "Entrando…";
              loginMsg.hidden = true;
              try {
                const t = await requestToken(__MOODLE_URL__, u, pass.value);
                pass.value = "";
                useToken(t);
              } catch (err) {
                pass.value = "";
                loginMsg.textContent = err instanceof MoodleError ? err.message : String(err);
                loginMsg.hidden = false;
                loginBtn.disabled = false;
                loginBtn.textContent = "Entrar";
                pass.focus();
              }
            },
          },
          user,
          pass,
          loginBtn,
        ),
        loginMsg,
        h(
          "p",
          { class: "muted small" },
          "A senha vai direto para o AVA (",
          h("code", {}, "login/token.php"),
          ", mesmo fluxo do app oficial do Moodle) e não é guardada. Só o token fica salvo neste navegador.",
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
                if (t) useToken(t);
              },
            },
            tokenInput,
            h("button", { type: "submit" }, "Usar token"),
          ),
        ),
        current &&
          h(
            "div",
            { class: "account-row" },
            h("span", { class: "muted small" }, `Token atual: ${current}`),
            h("span", { class: "spacer" }),
            h("a", { href: "#/", class: "small" }, "Voltar ao painel"),
            h("button", { class: "link small", type: "button", onclick: logout }, "Sair"),
          ),
      ),
    ),
  );
  user.focus();
}
