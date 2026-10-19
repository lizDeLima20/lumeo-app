import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { collectionsFromDrive, type AudiobookSourceState } from "../src/audiobooks/AudiobookLibrary";
import { GoogleDriveLibraryRepository, type GoogleDriveLibraryEntry } from "../src/external/GoogleDriveLibraryRepository";
import { isReadableForSource } from "../src/services/PersonalDriveLibraryService";
import type { StorageAdapter } from "../src/services/StorageService";

class Memory implements StorageAdapter {
  private rows = new Map<string, unknown>();
  public async load<T>(key: string): Promise<T | null> { return structuredClone(this.rows.get(key) as T) ?? null; }
  public async save<T>(key: string, value: T): Promise<void> { this.rows.set(key, structuredClone(value)); }
  public async remove(key: string): Promise<void> { this.rows.delete(key); }
}

const link = (folder: string) => `https://drive.google.com/drive/folders/${folder}`;
const chapters = (sourceId: string, prefix: string, count: number): GoogleDriveLibraryEntry[] => Array.from({ length: count }, (_, index) => ({
  sourceId, fileId: `${prefix}-${index + 1}`, name: `${prefix} ${index + 1}.mp3`, mimeType: "audio/mpeg", genre: prefix, thumbnailUrl: "", contentType: "audiobook" as const,
}));
const titles = (repo: GoogleDriveLibraryRepository, states?: ReadonlyMap<string, AudiobookSourceState>) =>
  Promise.all([repo.all(), repo.entries()]).then(([sources, entries]) => collectionsFromDrive(sources, entries, states));

describe("vários links de Audiolivros: um LP por pasta", () => {
  it("três pastas cadastradas viram três coleções independentes, com nome, ordem e capítulos próprios", async () => {
    const repo = new GoogleDriveLibraryRepository(new Memory(), "personal");
    const big = (await repo.saveLink(link("pasta200"), "audiobook", "02 - + 200 Audiobooks")).source;
    const meditation = (await repo.saveLink(link("pastaMedit"), "audiobook", "Meditação")).source;
    const courses = (await repo.saveLink(link("pastaCursos"), "audiobook", "Cursos")).source;
    assert.equal(new Set([big.id, meditation.id, courses.id]).size, 3, "IDs exclusivos por fonte");
    await repo.appendEntries(big.id, chapters(big.id, "Livro", 4));
    await repo.appendEntries(meditation.id, chapters(meditation.id, "Respiração", 2));
    await repo.appendEntries(courses.id, chapters(courses.id, "Aula", 3));
    const collections = await titles(repo);
    assert.deepEqual(collections.map(value => value.title), ["02 - + 200 Audiobooks", "Meditação", "Cursos"], "na ordem em que foram cadastradas");
    assert.deepEqual(collections.map(value => value.chapters.length), [4, 2, 3]);
    for (const collection of collections) assert.ok(collection.chapters.every(chapter => chapter.sourceId === collection.id), `${collection.title} só tem os próprios capítulos`);
    assert.equal(new Set(collections.flatMap(value => value.chapters.map(chapter => chapter.id))).size, 9, "nenhum capítulo repetido ou misturado");
  });

  it("cadastrar outra pasta não sobrescreve a coleção que já existe", async () => {
    const repo = new GoogleDriveLibraryRepository(new Memory(), "personal");
    const first = (await repo.saveLink(link("a"), "audiobook", "Primeira")).source;
    await repo.appendEntries(first.id, chapters(first.id, "A", 3));
    const second = (await repo.saveLink(link("b"), "audiobook", "Segunda")).source;
    await repo.appendEntries(second.id, chapters(second.id, "B", 1));
    const collections = await titles(repo);
    assert.equal(collections.find(value => value.id === first.id)?.chapters.length, 3);
    assert.equal(collections.find(value => value.id === second.id)?.chapters.length, 1);
  });

  it("remover tira o LP; restaurar (pela lista ou colando o link) devolve a coleção com seus capítulos", async () => {
    const repo = new GoogleDriveLibraryRepository(new Memory(), "personal");
    const big = (await repo.saveLink(link("pasta200"), "audiobook", "02 - + 200 Audiobooks")).source;
    const meditation = (await repo.saveLink(link("pastaMedit"), "audiobook", "Meditação")).source;
    const courses = (await repo.saveLink(link("pastaCursos"), "audiobook", "Cursos")).source;
    for (const [source, prefix, count] of [[big, "Livro", 4], [meditation, "Respiração", 2], [courses, "Aula", 3]] as const) await repo.appendEntries(source.id, chapters(source.id, prefix, count));

    await repo.remove(meditation.id, "lixeira");
    assert.deepEqual((await titles(repo)).map(value => value.title), ["02 - + 200 Audiobooks", "Cursos"]);
    assert.equal((await repo.removed()).length, 1, "a fonte removida fica guardada, não é apagada");
    assert.equal((await repo.entries(meditation.id)).length, 2, "os capítulos da removida continuam salvos");

    await repo.restore(meditation.id, "modal");
    let collections = await titles(repo);
    assert.equal(collections.find(value => value.title === "Meditação")?.chapters.length, 2);

    await repo.remove(courses.id, "lixeira");
    const again = await repo.saveLink(link("pastaCursos"), "audiobook");
    assert.equal(again.source.id, courses.id, "colar o mesmo link restaura a mesma fonte, com o mesmo ID");
    collections = await titles(repo);
    assert.deepEqual(collections.map(value => value.chapters.length).sort(), [2, 3, 4]);
    assert.equal((await repo.removed()).length, 0);
  });

  it("fechar e reabrir o app mantém as três coleções e seus capítulos", async () => {
    const storage = new Memory();
    const repo = new GoogleDriveLibraryRepository(storage, "personal");
    for (const [folder, name, count] of [["p1", "02 - + 200 Audiobooks", 4], ["p2", "Meditação", 2], ["p3", "Cursos", 3]] as const) {
      const source = (await repo.saveLink(link(folder), "audiobook", name)).source; await repo.appendEntries(source.id, chapters(source.id, name, count));
    }
    const reopened = new GoogleDriveLibraryRepository(storage, "personal");
    const collections = await titles(reopened);
    assert.deepEqual(collections.map(value => [value.title, value.chapters.length]), [["02 - + 200 Audiobooks", 4], ["Meditação", 2], ["Cursos", 3]]);
  });
});

describe("LP aparece mesmo sem capítulos, com o estado da pasta", () => {
  it("pasta ainda sendo lida, sem áudio ou sem acesso: o LP existe e diz por quê", async () => {
    const repo = new GoogleDriveLibraryRepository(new Memory(), "personal");
    const listing = (await repo.saveLink(link("lendo"), "audiobook", "Cursos")).source;
    const empty = (await repo.saveLink(link("vazia"), "audiobook", "Meditação")).source;
    const denied = (await repo.saveLink(link("negada"), "audiobook", "Privada")).source;
    // The state Meditação was found in on the Infinix: listing completed with no audio.
    await repo.saveSyncState(empty.id, { queue: [], completed: true, updatedAt: "x", files: 0, version: 5 });
    const states = new Map<string, AudiobookSourceState>([[listing.id, { status: "syncing" }], [denied.id, { status: "error", message: "Você não tem permissão para esta pasta." }]]);
    const collections = await titles(repo, states);
    assert.deepEqual(collections.map(value => [value.title, value.status]), [["Cursos", "syncing"], ["Meditação", "empty"], ["Privada", "error"]]);
    assert.equal(collections[2]?.message, "Você não tem permissão para esta pasta.");
  });

  it("os capítulos já encontrados ficam disponíveis enquanto o resto da pasta é lido", async () => {
    const repo = new GoogleDriveLibraryRepository(new Memory(), "personal");
    const source = (await repo.saveLink(link("grande"), "audiobook", "Grande")).source;
    await repo.appendEntries(source.id, chapters(source.id, "Cap", 5));
    const [collection] = await titles(repo, new Map([[source.id, { status: "syncing" as const }]]));
    assert.equal(collection?.status, "syncing"); assert.equal(collection?.chapters.length, 5);
  });

  it("fontes de livros e HQs nunca viram LP, e capítulos de outro tipo não entram", async () => {
    const repo = new GoogleDriveLibraryRepository(new Memory(), "personal");
    const books = (await repo.saveLink(link("livros"), "book", "Autoajuda")).source;
    const audio = (await repo.saveLink(link("audio"), "audiobook", "Áudio")).source;
    await repo.appendEntries(books.id, [{ sourceId: books.id, fileId: "x", name: "x.pdf", mimeType: "application/pdf", genre: "Autoajuda", thumbnailUrl: "", contentType: "book" }]);
    await repo.appendEntries(audio.id, [{ ...chapters(audio.id, "Cap", 1)[0]!, contentType: "book" }]);
    const collections = await titles(repo);
    assert.deepEqual(collections.map(value => value.title), ["Áudio"]);
    assert.equal(collections[0]?.status, "empty");
  });
});

describe("tela de audiolivros", () => {
  const view = readFileSync("src/views/AudiobooksView.ts", "utf8"), styles = readFileSync("src/styles/home.css", "utf8");
  it("pasta lida vazia é lida de novo quando a tela abre (uma vez por abertura), sem apagar nada", () => {
    assert.match(view, /const emptyBefore = Boolean\(syncState\?\.completed\) && cached\.length === 0 && !relisted\.has\(source\.id\);/);
  });
  it("uma listagem de fonte trocada de tipo ou removida no meio do caminho não grava nada", () => {
    assert.match(view, /if \(current\?\.contentType !== "audiobook"\) return;/);
  });
  it("os LPs são mantidos entre toques e sincronizações: o disco é o mesmo elemento e a transição vai até o fim", () => {
    assert.match(view, /const known = cards\.get\(collection\.id\); if \(known\) return known;/);
    assert.match(view, /if \(carousel\.children\[index\] !== card\.item\) carousel\.insertBefore/);
    assert.doesNotMatch(view, /carousel\.replaceChildren\(\); list\.replaceChildren\(\)/, "o carrossel não é recriado a cada toque");
  });
  it("o vinil desliza em cerca de 900 ms nos dois sentidos, só com transform", () => {
    assert.match(styles, /\.audiobook-lp__disc \{[^}]*transition:transform 900ms cubic-bezier\(\.45,0,\.25,1\); will-change:transform;/);
    assert.match(styles, /\.audiobook-collection-card\.is-expanded \.audiobook-lp__disc \{ transform:translateX\(46%\)/);
  });
  it("aceita também M4B e FLAC, que o WebView do Android reproduz", () => {
    for (const name of ["a.m4b", "b.flac", "c.mp3"]) assert.equal(isReadableForSource(name, "audiobook"), true);
    assert.match(readFileSync("src/external/GoogleDriveLibraryService.ts", "utf8"), /\\\.\(mp3\|m4a\|m4b\|aac\|ogg\|opus\|wav\|flac\)\$\/i\.test\(file\.name\)/);
  });
});

describe("lixeira: excluir definitivamente", () => {
  const purgeView = readFileSync("src/views/PersonalDriveLibraryView.ts", "utf8");
  it("só exclui fonte que já está na lixeira; uma fonte ativa nunca é apagada por um toque", async () => {
    const repo = new GoogleDriveLibraryRepository(new Memory(), "personal");
    const active = (await repo.saveLink(link("ativa"), "audiobook", "Ativa")).source;
    assert.equal(await repo.purge(active.id, "teste"), false);
    assert.equal((await repo.all()).length, 1);
  });

  it("apaga o registro e os metadados locais da lista, sem mexer nas outras fontes", async () => {
    const storage = new Memory(), repo = new GoogleDriveLibraryRepository(storage, "personal");
    const keep = (await repo.saveLink(link("fica"), "audiobook", "Fica")).source;
    const gone = (await repo.saveLink(link("sai"), "audiobook", "Meditação")).source;
    await repo.appendEntries(keep.id, chapters(keep.id, "F", 2)); await repo.appendEntries(gone.id, chapters(gone.id, "M", 3));
    await repo.appendFolders(gone.id, [{ sourceId: gone.id, folderId: "sub", parentFolderId: "sai", name: "Sub", depth: 1 }]);
    await repo.saveSyncState(gone.id, { queue: [], completed: true, updatedAt: "x", files: 3, version: 5 });
    await repo.remove(gone.id, "lixeira");
    assert.equal(await repo.purge(gone.id, "lixeira-definitiva"), true);
    assert.equal((await repo.removed()).length, 0, "saiu da lixeira");
    assert.equal(await repo.restore(gone.id, "modal"), null, "não pode mais ser restaurada");
    assert.deepEqual([(await repo.entries(gone.id)).length, (await repo.folders(gone.id)).length, await repo.syncState(gone.id)], [0, 0, null]);
    assert.equal((await repo.entries(keep.id)).length, 2, "a outra fonte continua intacta");
    assert.equal((await repo.history()).at(-1)?.action, "purged", "o histórico registra a exclusão");
  });

  it("depois de excluir, o mesmo link pode ser cadastrado de novo, como fonte nova e lida do zero", async () => {
    const repo = new GoogleDriveLibraryRepository(new Memory(), "personal");
    const first = (await repo.saveLink(link("medit"), "audiobook", "Meditação")).source;
    await repo.appendEntries(first.id, chapters(first.id, "M", 2));
    await repo.saveSyncState(first.id, { queue: [], completed: true, updatedAt: "x", files: 0, version: 5 });
    await repo.remove(first.id, "lixeira"); await repo.purge(first.id, "lixeira-definitiva");
    const again = await repo.saveLink(link("medit"), "audiobook", "Meditação");
    assert.equal(again.created, true, "é um cadastro novo, não uma restauração");
    assert.notEqual(again.source.id, first.id);
    assert.equal(await repo.syncState(again.source.id), null, "a pasta será lida do zero");
    const [collection] = await titles(repo);
    assert.equal(collection?.title, "Meditação"); assert.equal(collection?.chapters.length, 0);
  });

  it("a lixeira oferece Restaurar e Excluir definitivamente, com confirmação que diz o que fica", () => {
    assert.match(purgeView, /purge\.setAttribute\("aria-label", `Excluir definitivamente \$\{gone\.name\}`\)/);
    assert.match(purgeView, /window\.confirm\(`Excluir definitivamente[^`]*A pasta no Google Drive e os arquivos já baixados não serão apagados/);
    assert.match(purgeView, /row\.append\(folder, name, restore, purge\)/);
  });
});

describe("toque sem seleção azul e lista de capítulos animada", () => {
  const base = readFileSync("src/styles/base.css", "utf8"), styles = readFileSync("src/styles/home.css", "utf8"), view = readFileSync("src/views/AudiobooksView.ts", "utf8");
  it("o destaque azul de toque do WebView é desligado no app inteiro", () => {
    assert.match(base, /html \{ -webkit-tap-highlight-color: transparent; \}/);
  });
  it("botões, cartões, LPs, capítulos e menus não selecionam texto nem arrastam imagens num toque longo", () => {
    const rule = /([^{}]+)\{\s*-webkit-user-select: none; user-select: none; -webkit-touch-callout: none;\s*\}/.exec(base);
    assert.ok(rule, "regra de controles");
    for (const selector of ["button", "[role=\"button\"]", ".catalog-card", ".audiobook-collection-card", ".audiobook-chapter", ".mobile-bottom-navigation", ".navigation-drawer"]) assert.ok(rule![1]!.includes(selector), selector);
    assert.doesNotMatch(rule![1]!, /reader|reflow|comic-canvas|open-book/, "páginas dos leitores continuam selecionáveis");
    assert.match(base, /input, textarea, \[contenteditable="true"\], \[contenteditable=""\] \{ -webkit-user-select: text; user-select: text;/, "campos de digitação continuam selecionáveis");
    assert.match(base, /\[role="button"\]:focus-visible[^{]*\{ outline: 3px solid/, "foco por teclado continua visível");
  });
  it("a lista abre e fecha por altura e opacidade em cerca de meio segundo, e fechada não recebe toques", () => {
    assert.match(styles, /\.audiobooks-collections \{ display: grid; grid-template-rows: 0fr;[^}]*visibility: hidden; pointer-events: none; transition: grid-template-rows 520ms/);
    assert.match(styles, /\.audiobooks-collections\.is-open \{ grid-template-rows: 1fr; opacity: 1; visibility: visible; pointer-events: auto;/);
    assert.match(view, /list\.classList\.remove\("is-open"\); list\.setAttribute\("inert", ""\);/, "fechada fica inerte");
  });
  it("os capítulos surgem um após o outro, e o movimento reduzido é respeitado", () => {
    assert.match(styles, /animation: audiobook-chapter-in 420ms[^;]*both; animation-delay: calc\(var\(--i, 12\) \* 28ms \+ 140ms\);/);
    assert.match(view, /value\.style\.setProperty\("--i", String\(Math\.min\(index, 12\)\)\)/);
    assert.match(styles, /prefers-reduced-motion: reduce\) \{ \.audiobooks-collections, \.audiobooks-collections\.is-open \{ transition: none; \}/);
  });
  it("coleções longas abrem com cerca de uma tela de capítulos animados; o resto entra depois, sem animar", () => {
    assert.match(view, /const first = Math\.min\(chapters\.length, 24\);/);
    assert.match(view, /value\.classList\.add\("audiobook-chapter--later"\)/);
    assert.match(styles, /\.audiobooks-collections\.is-open \.audiobook-chapter--later \{ animation: none; \}/);
  });
  it("o miniplayer fica acima do menu inferior fixo, sem cobri-lo", () => {
    assert.match(styles, /\.audiobook-miniplayer \{ position: fixed; right: \.55rem; bottom: calc\(5rem \+ env\(safe-area-inset-bottom, 0px\)\);/);
  });
  it("a lista só é reconstruída quando muda a coleção, a busca ou os capítulos", () => {
    assert.match(view, /if \(key !== listKey\) \{/);
    assert.doesNotMatch(view, /const term = fold\(query\.value\); list\.replaceChildren\(\);/);
  });
});
