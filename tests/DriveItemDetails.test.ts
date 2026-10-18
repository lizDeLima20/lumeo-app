import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { driveDetailsActionLabel } from "../src/views/DriveItemDetails";

const css = () => readFileSync("src/styles/catalog.css", "utf8");
const view = () => readFileSync("src/views/PersonalDriveLibraryView.ts", "utf8");
const details = () => readFileSync("src/views/DriveItemDetails.ts", "utf8");
const router = () => readFileSync("src/core/Router.ts", "utf8");
const rule = (selector: string): string => css().match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^}]*)\\}`))?.[1] ?? "";

describe("tela de detalhes de livros e HQs: um único botão principal", () => {
  it("mostra Baixar, o progresso real, e depois só Abrir", () => {
    assert.equal(driveDetailsActionLabel(false, null), "Baixar");
    assert.equal(driveDetailsActionLabel(false, { state: "downloading", percent: 42.4 }), "Baixando 42%");
    assert.equal(driveDetailsActionLabel(false, { state: "downloading", percent: null }), "Baixando…", "sem tamanho conhecido não inventa porcentagem");
    assert.equal(driveDetailsActionLabel(false, { state: "indeterminate", percent: null }), "Baixando…");
    assert.equal(driveDetailsActionLabel(false, { state: "saving", percent: 100 }), "Salvando…");
    assert.equal(driveDetailsActionLabel(false, { state: "done", percent: 100 }), "Abrir");
    assert.equal(driveDetailsActionLabel(true, null), "Abrir");
    assert.equal(driveDetailsActionLabel(false, { state: "error", percent: 0 }), "Tentar novamente");
  });

  it("usa o mesmo download do botão redondo do card, sem repetir", () => {
    const source = view();
    assert.match(source, /if \(button\.disabled \|\| downloads\.has\(entry\.fileId\)\) return;/);
    assert.match(source, /download: \(\) => void download\(entry, action, icon\)/, "a tela aciona o download do próprio card");
    assert.match(source, /action\.addEventListener\("click", event => \{ event\.stopPropagation\(\);/, "o botão redondo continua baixando direto");
    assert.match(source, /cover\.addEventListener\("click", details\)/, "a capa só abre os detalhes");
    assert.match(source, /if \(watchers\.get\(entry\.fileId\)\?\.size\) return;/, "com a tela aberta o leitor não abre sozinho: o botão vira Abrir");
  });

  it("reconhece como baixada a cópia no aparelho que perdeu a versão ao salvar o progresso", () => {
    assert.match(view(), /book\.sourceVersion === version\(entry\) \|\| \(!book\.sourceVersion && book\.availability === "AVAILABLE"\)/);
  });

  it("o card redesenhado pela sincronização continua mostrando o download em andamento", () => {
    assert.match(view(), /cards\.set\(entry\.fileId, \{ action, icon \}\); const running = downloads\.get\(entry\.fileId\); if \(running\) paint\(\{ action, icon \}, running\);/);
    assert.match(view(), /const card = cards\.get\(fileId\); if \(card\) paint\(card, update\);/);
  });

  it("baixar na Explorar não troca de tela: os detalhes ficam abertos e viram Abrir", () => {
    const app = readFileSync("src/core/App.ts", "utf8");
    assert.match(app, /book => void this\.addBook\(book, false\), id => this\.openLibraryBook\(id\)/);
    assert.match(app, /if \(showDetails\) this\.router\.navigate\("book", \{ id: book\.id \}\);/);
  });

  it("não mostra sinopse vazia nem informação inventada", () => {
    const source = details();
    assert.match(source, /if \(input\.synopsis\) \{/);
    assert.match(source, /if \(input\.facts\.length\)/);
    assert.match(view(), /synopsis: cleanText\(entry\.synopsis\) \?\? cleanText\(book\?\.summary\) \?\? cleanText\(book\?\.description\)/);
  });
});

describe("tela de detalhes: capa inteira e tudo dentro da tela", () => {
  it("mantém a proporção da capa, sem cortar nem esticar", () => {
    assert.match(rule(".drive-details__image"), /object-fit:contain/);
    assert.match(rule(".drive-details__image"), /width:100%;height:100%/);
    assert.match(rule(".drive-details__cover"), /height:clamp\(8\.5rem,32dvh,17\.5rem\);min-height:min\(20dvh,8rem\)/, "capa moderada: cerca de um terço da altura da tela, menor em telas pequenas");
  });

  it("ocupa a tela respeitando as áreas seguras, sem rolagem lateral", () => {
    const page = rule(".drive-details__page");
    assert.match(page, /^[^;]*;?.*padding:\.5rem max\(1rem,env\(safe-area-inset-right\)\) max\(1rem,env\(safe-area-inset-bottom\)\) max\(1rem,env\(safe-area-inset-left\)\)/, "fora do leitor o WebView já fica abaixo da barra de status: o topo não é somado de novo");
    assert.match(page, /overflow-x:hidden/);
    assert.match(rule(".drive-details__title"), /overflow-wrap:anywhere/, "título longo quebra a linha");
  });

  it("dois toques rápidos no botão não ampliam a página", () => {
    assert.match(rule(".drive-details"), /touch-action:manipulation/);
  });

  it("sinopse longa rola dentro da própria caixa", () => {
    assert.match(rule(".drive-details__synopsis"), /overflow-y:auto/);
    assert.match(rule(".drive-details__footer"), /margin-top:auto/, "o botão fica embaixo");
  });

  it("botão dourado discreto no lugar do roxo forte", () => {
    const button = rule(".drive-details__action");
    assert.match(button, /background:linear-gradient\(180deg,#e9c47a,#d3a24f\)/);
    assert.match(button, /color:#2b1d08/);
    assert.equal(/color-primary/.test(button), false);
  });

  it("o Voltar do Android fecha a tela sem refazer a estante", () => {
    assert.match(details(), /window\.history\.pushState\(window\.history\.state, "", window\.location\.href\)/);
    assert.match(router(), /requested === this\.activeRoute && params\.toString\(\) === this\.activeParameters\.toString\(\)\) return;/);
  });
});
