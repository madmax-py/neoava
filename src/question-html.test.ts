import { beforeAll, describe, expect, it } from "vitest";
import { questionFields, renderQuestionHtml } from "./question-html";
import { setup } from "./state";

const AVA = __MOODLE_URL__;

/** Renderiza e devolve o HTML resultante, para conferir o que sobrou. */
function render(html: string, editable = false): string {
  const div = document.createElement("div");
  div.appendChild(renderQuestionHtml(html, editable));
  return div.innerHTML;
}

beforeAll(() => setup("tokendeteste123"));

describe("renderQuestionHtml: o que nunca pode passar", () => {
  it.each([
    ["script", `<p>a</p><script>alert(1)</script>`],
    ["script em maiúsculas", `<SCRIPT>alert(1)</SCRIPT>`],
    ["style", `<style>body{display:none}</style>`],
    ["iframe", `<iframe name="mal.example"></iframe>`],
    ["svg com onload", `<svg onload="alert(1)"><circle/></svg>`],
    ["math", `<math><mi>x</mi></math>`],
    ["object/embed", `<object data="x.swf"></object><embed src="x.swf">`],
    ["form e botão", `<form action="https://mal.example"><button>ok</button></form>`],
    ["base", `<base href="https://mal.example/">`],
    ["meta refresh", `<meta http-equiv="refresh" content="0;url=https://mal.example">`],
  ])("%s", (_, html) => {
    const out = render(html);
    expect(out).not.toMatch(/<(script|style|iframe|svg|math|object|embed|form|button|base|meta)\b/i);
    expect(out).not.toMatch(/alert|mal\.example/);
  });

  it("remove atributos de evento e de estilo", () => {
    const out = render(`<p onclick="alert(1)" OnMouseOver="alert(2)" style="position:fixed">x</p><img src="https://x.example/a.png" onerror="alert(3)">`);
    expect(out).not.toMatch(/on\w+=|style=|alert/i);
  });

  it("links javascript:, data: e vbscript: perdem o href", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x"]) {
      const out = render(`<a href="${href}">clique</a>`);
      expect(out, href).not.toMatch(/href=/);
      expect(out).toContain("clique");
    }
  });

  it("links http(s) abrem em outra aba sem referrer", () => {
    const out = render(`<a href="https://exemplo.com/x">x</a>`);
    expect(out).toContain(`href="https://exemplo.com/x"`);
    expect(out).toContain(`rel="noreferrer"`);
    expect(out).toContain(`target="_blank"`);
  });

  it("imagens: só https, data:image raster e arquivos do AVA", () => {
    expect(render(`<img src="http://externo.example/a.png" alt="foto">`)).toBe("[imagem: foto]");
    expect(render(`<img src="javascript:alert(1)">`)).toBe("");
    expect(render(`<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="svg">`)).toBe("[imagem: svg]");
    expect(render(`<img src="data:image/png;base64,AAAA">`)).toContain(`src="data:image/png;base64,AAAA"`);
    expect(render(`<img src="https://externo.example/a.png">`)).toContain(`referrerpolicy="no-referrer"`);
  });

  it("o token só vai para arquivos do próprio AVA", () => {
    const own = render(`<img src="${AVA}/pluginfile.php/1/question/x.png">`);
    expect(own).toContain("/webservice/pluginfile.php/1/question/x.png");
    expect(own).toContain("token=tokendeteste123");
    expect(render(`<img src="https://externo.example/pluginfile.php/1/x.png">`)).not.toContain("token=");
  });

  it("botões e campos de arquivo/envio são removidos", () => {
    const out = render(`<input type="submit" value="Enviar"><input type="file" name="f"><input type="image" src="x"><input type="radio" name="q1:1_answer" value="0">`, true);
    expect(out).not.toMatch(/submit|type="file"|type="image"/);
    expect(out).toContain(`type="radio"`);
  });
});

describe("renderQuestionHtml: o que precisa continuar funcionando", () => {
  it("prefixa classes e ids para não colidir com o app", () => {
    const out = render(`<div class="que multichoice" id="question-1-2"><label for="q1:2_answer0">A</label><input id="q1:2_answer0" type="radio" name="q1:2_answer" value="0"></div>`, true);
    expect(out).toContain(`class="m-que m-multichoice"`);
    expect(out).toContain(`id="mq-question-1-2"`);
    expect(out).toContain(`for="mq-q1:2_answer0"`);
    expect(out).toContain(`name="q1:2_answer"`);
  });

  it("descarta classes com caracteres estranhos", () => {
    expect(render(`<span class="ok x&quot;y">t</span>`)).toContain(`class="m-ok"`);
  });

  it("fora do modo de responder, campos ficam desativados", () => {
    expect(render(`<input type="text" name="a"><select name="b"><option>1</option></select><textarea name="c">oi</textarea>`)).toMatch(/^(?:.*disabled.*){3}$/s);
    expect(render(`<input type="text" name="a">`, true)).not.toContain("disabled");
  });

  it("textarea mantém o texto, sem interpretar HTML", () => {
    const out = render(`<textarea name="c">&lt;b&gt;oi&lt;/b&gt;</textarea>`, true);
    expect(out).toContain("&lt;b&gt;oi&lt;/b&gt;");
  });

  it("tags desconhecidas somem mas o texto fica", () => {
    expect(render(`<custom-tag><font color="red">texto</font></custom-tag>`)).toBe("texto");
  });

  it("partes do Moodle que o app desenha são removidas", () => {
    expect(render(`<div class="info">Questão 1</div><div class="qtext">Pergunta</div>`)).not.toContain("Questão 1");
  });

  it("ícones de certo/errado viram marcas de texto", () => {
    const out = render(`<i class="icon fa fa-check text-success" title="Correto"></i><i class="icon fa fa-xmark" aria-label="Incorreto"></i>`);
    expect(out).toContain("✓");
    expect(out).toContain("✕");
    expect(out).not.toContain("<i ");
  });
});

describe("questionFields", () => {
  it("lista os campos com rótulos e o que já está marcado", () => {
    const html = `
      <input type="hidden" name="q1:1_:sequencecheck" value="3">
      <input type="radio" id="a0" name="q1:1_answer" value="0"><label for="a0">Alternativa A</label>
      <input type="radio" id="a1" name="q1:1_answer" value="1" checked><label for="a1">Alternativa B</label>
      <select name="q1:2_sub0"><option value="0">Escolher…</option><option value="2" selected>Dois</option></select>
      <input type="submit" name="next" value="Próxima">
      <textarea name="q1:3_answer">resposta</textarea>`;
    const f = questionFields(html);
    expect(f.map((x) => x.name)).toEqual(["q1:1_:sequencecheck", "q1:1_answer", "q1:1_answer", "q1:2_sub0", "q1:3_answer"]);
    expect(f[0]).toMatchObject({ type: "hidden", value: "3", label: "" });
    expect(f[1]).toMatchObject({ label: "Alternativa A", checked: false });
    expect(f[2]).toMatchObject({ label: "Alternativa B", checked: true });
    expect(f[3]).toMatchObject({ type: "select", value: "2", checked: true });
    expect(f[4]).toMatchObject({ type: "textarea", value: "resposta" });
  });
});
