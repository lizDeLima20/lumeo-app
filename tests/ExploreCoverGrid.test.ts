import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = () => readFileSync("src/styles/catalog.css", "utf8");
const view = () => readFileSync("src/views/PersonalDriveLibraryView.ts", "utf8");
const icon = () => readFileSync("src/views/DownloadProgressIcon.ts", "utf8");

describe("vitrine Explorar: três capas por linha", () => {
  it("usa três colunas proporcionais com espaçamento mínimo e sem cartões", () => {
    const rules = css();
    assert.match(rules, /\.catalog\.personal-drive-library \.catalog__grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:\.25px;margin:0;padding:0\}/);
    assert.match(rules, /\.catalog\.personal-drive-library \.catalog-card\{[^}]*margin:0;padding:0;border:0;[^}]*background:transparent;box-shadow:none\}/);
    assert.match(rules, /\.catalog\.personal-drive-library \.catalog-card__cover img\{[^}]*object-fit:contain/, "a capa nunca é cortada nem deformada");
    assert.match(rules, /-webkit-line-clamp:2;[^}]*font-size:\.68rem/, "título pequeno com no máximo duas linhas");
  });
  it("aproxima a grade das bordas no celular sem criar rolagem horizontal", () => {
    const rules = css();
    assert.match(rules, /@media\(max-width:40rem\)\{\.catalog\.personal-drive-library \.catalog__grid\{margin-inline:calc\(-1rem \+ 1px\)\}\}/, "nunca passa da margem de 1rem do page-shell");
    assert.equal(/personal-drive-library[^{}]*\{[^}]*100vw/.test(rules), false);
  });
  it("mostra só o título na grade, sem ano nem sinopse", () => {
    const source = view();
    assert.equal(source.includes("catalog-card__year"), false);
    assert.match(source, /catalog-card__title/);
  });
});

describe("ícone de download com progresso real", () => {
  it("troca o botão roxo preenchido por um ícone contornado com área de toque de 44px", () => {
    const rules = css();
    assert.match(rules, /\.catalog\.personal-drive-library \.catalog-card__quick-action\{[^}]*width:2\.75rem;height:2\.75rem;[^}]*background:transparent/);
    assert.equal(view().includes("button--primary catalog-card__quick-action"), false);
  });
  it("o anel e a seta seguem só a fração de bytes recebida; sem tamanho, só um indicador de atividade", () => {
    const source = icon();
    assert.match(source, /strokeDashoffset = String\(100 - value\)/);
    assert.match(source, /setAttribute\("height", String\(32 \* value \/ 100\)\)/);
    assert.match(source, /if \(percent == null\) \{ this\.set\("indeterminate"\); return; \}/);
    assert.equal(/setInterval|requestAnimationFrame/.test(source), false, "nenhum progresso simulado");
  });
  it("o toque no ícone não abre os detalhes, a conclusão vem depois de salvar e o livro abre sozinho", () => {
    const source = view();
    assert.match(source, /action\.addEventListener\("click", event => \{ event\.stopPropagation\(\);/);
    assert.match(source, /icon\.set\("done", 100\); await this\.refreshGenres\(\); this\.saved\(book\);[^\n]*\n[^\n]*this\.open\(book\.id\);/);
    assert.match(source, /catch \(error\) \{ button\.disabled = false;[^}]*icon\.set\("error", 0\)/, "falha interrompe a animação e permite tentar de novo");
    assert.equal(/%`/.test(source), false, "nenhuma porcentagem numérica no botão");
  });
});
