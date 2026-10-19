import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync("src/styles/reader.css", "utf8");
/** Every rule of reader.css that styles a book cover (the page, its image or its back). */
const rules = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].map(match => ({ selector: match[1]!.trim(), body: match[2]! }))
  .filter(rule => /reader-cover-page(?!__backdrop)|open-book-page--cover|reflow-sheet--cover/.test(rule.selector));

describe("capa do livro no leitor: sempre inteira, sem corte nem zoom", () => {
  it("nenhuma regra da capa usa object-fit: cover (só o fundo desfocado, que é preenchimento)", () => {
    const cropping = rules.filter(rule => /object-fit:\s*cover/.test(rule.body));
    assert.deepEqual(cropping.map(rule => rule.selector), []);
  });

  it("nenhuma regra da capa amplia a imagem (scale) nem a mede em vw/dvh", () => {
    const scaled = rules.filter(rule => /scale\((?!1\))/.test(rule.body) && /cover-page__image|cover-page img/.test(rule.selector));
    assert.deepEqual(scaled.map(rule => rule.selector), [], "o zoom de 1,04 era o corte extra");
    const viewportSized = rules.filter(rule => /cover-page__image/.test(rule.selector) && /\d(vw|dvh|svh)/.test(rule.body));
    assert.deepEqual(viewportSized.map(rule => rule.selector), [], "a imagem usa o tamanho do componente, não o da tela inteira");
  });

  it("a imagem da capa é contain e centralizada em todos os caminhos (celular, tablet, livro aberto)", () => {
    const fitted = rules.filter(rule => /cover-page__image|cover-page img/.test(rule.selector) && /object-fit/.test(rule.body));
    assert.ok(fitted.length >= 5, "celular, reflow, livro aberto, animação e verso");
    fitted.forEach(rule => assert.match(rule.body, /object-fit:\s*contain/, rule.selector));
  });

  it("o fundo desfocado da própria capa preenche as sobras e nunca é escondido", () => {
    const hidden = rules.concat([...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].map(match => ({ selector: match[1]!.trim(), body: match[2]! })))
      .filter(rule => /cover-page__backdrop/.test(rule.selector) && /display:\s*none/.test(rule.body));
    assert.deepEqual(hidden.map(rule => rule.selector), []);
  });

  it("a animação de virar página usa os mesmos nós da capa (clone), então herda a mesma regra", () => {
    const curl = readFileSync("src/reader/page-turn/PageCurl.ts", "utf8");
    assert.match(curl, /cloneNode\(true\)/);
  });
});
