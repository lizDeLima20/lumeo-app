import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CoverRatioCache, SHELF_RATIO_DEFAULT, SHELF_RATIO_MAX, SHELF_RATIO_MIN, coverNeedsBand, shelfCoverRatio, type CoverRatioStore } from "../src/components/CoverRatio";

const styles = ["catalog", "collections", "home", "library", "book-physical", "components"].map(name => readFileSync(`src/styles/${name}.css`, "utf8")).join("\n");
const rules = [...styles.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(match => ({ selector: match[1]!.trim(), body: match[2]! }));
/** The boxes and images of every cover shown outside the reader. */
const COVER_SURFACE = /catalog-card__cover|catalog-detail__cover|drive-comic-card__cover|book-quick-preview|audiobook-cover|book-front-face|physical-front|cover-fit__image/;
const surfaceRules = rules.filter(rule => COVER_SURFACE.test(rule.selector) && !/cover-fit__backdrop/.test(rule.selector));
const source = (path: string) => readFileSync(path, "utf8");

describe("capas fora do leitor: sempre inteiras, sem corte nem zoom", () => {
  it("nenhuma regra de capa (catálogo, prévia, HQ, audiolivro, estante 3D) usa object-fit: cover", () => {
    assert.deepEqual(surfaceRules.filter(rule => /object-fit:\s*cover/.test(rule.body)).map(rule => rule.selector), []);
  });

  it("nenhuma imagem de capa é ampliada (scale) nem medida em vw/dvh", () => {
    const images = surfaceRules.filter(rule => /\bimg\b|__image/.test(rule.selector));
    assert.deepEqual(images.filter(rule => /scale\(/.test(rule.body)).map(rule => rule.selector), []);
    assert.deepEqual(images.filter(rule => /\d(vw|dvh|svh)/.test(rule.body)).map(rule => rule.selector), []);
  });

  it("as imagens de capa declaram contain", () => {
    const declared = surfaceRules.filter(rule => /\bimg\b|__image/.test(rule.selector) && /object-fit/.test(rule.body));
    assert.ok(declared.length >= 7, "catálogo, detalhes, Explorar, HQ, audiolivro, prévia e estante 3D");
    declared.forEach(rule => assert.match(rule.body, /object-fit:\s*contain/, rule.selector));
  });

  it("só o fundo desfocado usa cover, e ele preenche a caixa sem escalar a capa", () => {
    const backdrop = rules.find(rule => /^\.cover-fit > \.cover-fit__backdrop$/.test(rule.selector))!;
    assert.match(backdrop.body, /object-fit:\s*cover\s*!important/);
    assert.match(backdrop.body, /filter:\s*blur\(/);
    assert.doesNotMatch(backdrop.body, /display:\s*none/, "o fundo nunca é escondido, só fica sem imagem quando a capa já encaixa");
  });

  it("todas as telas ligam a capa ao fundo desfocado", () => {
    for (const [path, count] of [["src/views/PersonalDriveLibraryView.ts", 1], ["src/views/CatalogExplorerView.ts", 2], ["src/views/DriveCollectionGenreView.ts", 1], ["src/views/CatalogBookView.ts", 1],
      ["src/views/ComicDetailsView.ts", 1], ["src/views/AudiobooksView.ts", 1], ["src/components/BookQuickPreview.ts", 1], ["src/components/Book3DFaces.ts", 1]] as const)
      assert.equal(source(path).split("bindCoverBackdrop(").length - 1, count, path);
  });

  it("na estante 3D o fundo só aparece quando a capa está fora da faixa de proporção", () => {
    assert.match(styles, /\.physical-front:not\(\[data-cover-band\]\) \.cover-fit__backdrop\{display:none\}/);
    assert.match(source("src/components/Book3DFaces.ts"), /coverNeedsBand\(width, height\)\) face\.dataset\.coverBand = "true"/);
  });

  it("a capa fica presa à face 3D: uma capa alta não vaza nem é cortada pela borda da face", () => {
    assert.match(styles, /\.physical-front > \.cover-fit__image\{position:absolute;inset:0;width:100%;height:100%\}/);
  });

  it("a face do livro 3D e a altura acompanham a proporção da capa, com transição curta desligável", () => {
    assert.match(source("src/components/Book3DFactory.ts"), /const aspectRatio = measured === undefined \? SHELF_RATIO_DEFAULT : shelfCoverRatio\(measured, 1\);/);
    assert.match(source("src/components/Book3DFaces.ts"), /"--physical-height", `calc\(\(var\(--physical-width\) - 6px\) \/ \$\{ratio\} \+ 6px\)`, "important"/);
    assert.match(source("src/components/Book3D.ts"), /Book3DFace\.shape\(object, this\.model\.dimensions\.aspectRatio\)/);
    assert.match(styles, /book-3d--ratio-shift \{ transition: --lit-front 800ms[^}]*--physical-height 220ms ease-out/);
    assert.match(styles, /prefers-reduced-motion: reduce\) \{ \.book-3d\.book-3d--physical\.book-3d--ratio-shift \{ transition: none/);
  });
});

describe("proporção da capa na estante 3D", () => {
  it("capa 2:3 fica em 0,667, dentro da faixa", () => {
    assert.ok(Math.abs(shelfCoverRatio(1000, 1500) - 2 / 3) < 1e-9);
    assert.equal(coverNeedsBand(1000, 1500), false);
  });
  it("capa quadrada é limitada a 0,78 e pede o fundo", () => {
    assert.equal(shelfCoverRatio(500, 500), SHELF_RATIO_MAX);
    assert.equal(coverNeedsBand(500, 500), true);
  });
  it("capa muito estreita (1:2) é limitada a 0,60 e pede o fundo", () => {
    assert.equal(shelfCoverRatio(500, 1000), SHELF_RATIO_MIN);
    assert.equal(coverNeedsBand(500, 1000), true);
  });
  it("largura ou altura zero, negativa ou inválida dão a proporção padrão, sem erro", () => {
    for (const [width, height] of [[0, 100], [100, 0], [0, 0], [-5, 10], [Number.NaN, 10], [10, Infinity]] as const) {
      assert.equal(shelfCoverRatio(width, height), SHELF_RATIO_DEFAULT);
      assert.equal(coverNeedsBand(width, height), false);
    }
  });
  it("um livro de proporção dentro da faixa não pede fundo e mantém a proporção exata", () => {
    for (const ratio of [.62, .667, .7, .75]) { assert.equal(coverNeedsBand(ratio * 1000, 1000), false); assert.ok(Math.abs(shelfCoverRatio(ratio * 1000, 1000) - ratio) < 1e-9); }
  });
});

describe("proporção guardada por livro", () => {
  const memory = (): CoverRatioStore & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } }; };
  it("guarda e devolve a proporção medida da mesma capa", () => {
    const cache = new CoverRatioCache(memory());
    cache.set("livro-1", "data:image/png;base64,AAAA", 0.6667);
    assert.equal(cache.get("livro-1", "data:image/png;base64,AAAA"), 0.6667);
    assert.equal(cache.get("livro-2", "data:image/png;base64,AAAA"), undefined);
  });
  it("uma capa diferente do mesmo livro é medida de novo", () => {
    const cache = new CoverRatioCache(memory());
    cache.set("livro-1", "data:image/png;base64,AAAA", 0.6667);
    assert.equal(cache.get("livro-1", "data:image/png;base64,BBBBBBB"), undefined);
  });
  it("valor corrompido ou armazenamento bloqueado não derrubam nada", () => {
    const store = memory(); store.data.set("lumeo:cover-ratio:v1:x", "lixo");
    assert.equal(new CoverRatioCache(store).get("x", "c"), undefined);
    const blocked: CoverRatioStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const cache = new CoverRatioCache(blocked);
    cache.set("y", "capa", 0.7);
    assert.equal(cache.get("y", "capa"), 0.7, "a cópia em memória serve a sessão");
    assert.equal(new CoverRatioCache(null).get("z", "c"), undefined);
  });
  it("proporção inválida não é guardada", () => {
    const store = memory(); new CoverRatioCache(store).set("a", "c", 0); new CoverRatioCache(store).set("a", "c", Number.NaN);
    assert.equal(store.data.size, 0);
  });
});
