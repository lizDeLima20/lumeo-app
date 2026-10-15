import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GoogleDriveLibraryService, type GoogleLibraryFile } from "../src/external/GoogleDriveLibraryService";
import { GoogleDriveLibraryRepository, type GoogleDriveLibraryEntry, type GoogleDriveLibrarySyncState } from "../src/external/GoogleDriveLibraryRepository";
import type { StorageAdapter } from "../src/services/StorageService";
import { catalogRows, describeDriveFolder, readDriveCatalogCategory, resolveCatalogRecord } from "../src/services/PersonalDriveCatalogSource";
import { PERSONAL_DRIVE_SYNC_VERSION, PersonalDriveLibraryService } from "../src/services/PersonalDriveLibraryService";

/* The structure published by the former Lumeo catalogue:
 *   Desenvolvimento pessoal/ ├── books/ ├── covers/ └── catalog.json
 * Ids in catalog.json can be stale; books/ and covers/ listings are the truth. */
const FOLDER = GoogleDriveLibraryService.FOLDER;
const folder = (id: string, name: string): GoogleLibraryFile => ({ id, name, mimeType: FOLDER });
const file = (id: string, name: string, mimeType = "application/epub+zip"): GoogleLibraryFile => ({ id, name, mimeType });

function fakeDrive(tree: Record<string, GoogleLibraryFile[]>, documents: Record<string, unknown>, pageSize = 2) {
  const all = Object.values(tree).flat();
  return {
    authorized: true, prepare: async () => undefined, connect: async () => undefined,
    metadata: async (id: string) => all.find(item => item.id === id) ?? folder("root", "Desenvolvimento pessoal"),
    // Paginated like the real API, so a structure split across pages is still found.
    listRaw: async (id: string, _key: string | undefined, _signal: AbortSignal, pageToken?: string) => {
      const items = tree[id] ?? [], start = pageToken ? Number(pageToken) : 0, next = start + pageSize;
      return { files: items.slice(start, next), nextPageToken: next < items.length ? String(next) : undefined };
    },
    list: async () => ({ files: [] }),
    json: async (catalog: GoogleLibraryFile) => documents[catalog.id],
  } as unknown as GoogleDriveLibraryService;
}

const catalog = [
  { bookId: "bk_1", title: "Hábitos Atômicos", author: "James Clear", format: "epub", synopsis: "Pequenas mudanças.",
    bookPath: "books/bk_1.epub", driveFileId: "book-1", coverPath: "covers/bk_1.webp", coverDriveFileId: "cover-1" },
  // Stale ids: both resolved by path through the real listings.
  { bookId: "bk_2", title: "Mindset", author: "Carol Dweck", format: "epub", summary: "Crescimento.",
    bookPath: "books/bk_2.epub", driveFileId: "stale-book", coverPath: "covers/bk_2.webp", coverDriveFileId: "stale-cover" },
  // Only description, cover by explicit https URL.
  { bookId: "bk_3", title: "O Poder do Hábito", author: "Charles Duhigg", format: "pdf", description: "Rotinas.",
    bookPath: "books/bk_3.pdf", coverUrl: "https://example.test/cover-3.webp" },
  // No cover at all: placeholder.
  { bookId: "bk_4", title: "Essencialismo", format: "epub", bookPath: "books/bk_4.epub" },
  // Unreadable format and a record that points nowhere.
  { bookId: "bk_5", title: "Kindle", format: "mobi", bookPath: "books/bk_5.mobi" },
  { bookId: "bk_6", title: "Fantasma", bookPath: "books/nao-existe.epub" },
];
const tree = {
  root: [file("cat", "catalog.json", "application/json"), folder("books", "books"), folder("covers", "covers")],
  books: [file("book-1", "bk_1.epub"), file("book-2", "bk_2.epub"), file("book-3", "bk_3.pdf", "application/pdf"), file("book-4", "bk_4.epub"), file("book-5", "bk_5.mobi", "application/x-mobipocket-ebook")],
  covers: [file("cover-1", "bk_1.webp", "image/webp"), file("cover-2", "bk_2.webp", "image/webp")],
};

describe("structured Drive catalog folders, read on the device", () => {
  it("recognises the folder name, books/, covers/ and catalog.json at the root", async () => {
    const drive = fakeDrive(tree, { cat: catalog });
    const described = await describeDriveFolder(drive, folder("root", "Desenvolvimento pessoal"), undefined, new AbortController().signal);
    assert.equal(described.folderName, "Desenvolvimento pessoal");
    assert.equal(described.categories.length, 1);
    assert.equal(described.categories[0]!.name, "Desenvolvimento pessoal");
    assert.equal(described.categories[0]!.catalog.id, "cat");
    assert.equal(described.categories[0]!.covers?.id, "covers");
  });

  it("maps every catalog field and resolves stale ids through bookPath/coverPath", async () => {
    const drive = fakeDrive(tree, { cat: catalog });
    const [category] = (await describeDriveFolder(drive, folder("root", "Desenvolvimento pessoal"), undefined, new AbortController().signal)).categories;
    const { entries, stats } = await readDriveCatalogCategory(drive, category!, "src", "book", new AbortController().signal);
    assert.deepEqual(entries.map(entry => entry.fileId), ["book-1", "book-2", "book-3", "book-4"]);
    assert.ok(entries.every(entry => entry.genre === "Desenvolvimento pessoal" && entry.contentType === "book"));
    const [habits, mindset, power, essential] = entries as GoogleDriveLibraryEntry[];
    assert.equal(habits!.title, "Hábitos Atômicos"); assert.equal(habits!.author, "James Clear"); assert.equal(habits!.synopsis, "Pequenas mudanças.");
    assert.equal(habits!.coverDriveFileId, "cover-1");
    assert.equal(mindset!.synopsis, "Crescimento.");                 // summary fallback
    assert.equal(mindset!.coverDriveFileId, "cover-2");              // stale coverDriveFileId -> coverPath
    assert.match(mindset!.thumbnailUrl, /thumbnail\?id=cover-2/);
    assert.equal(power!.synopsis, "Rotinas.");                       // description fallback
    assert.equal(power!.coverUrl, "https://example.test/cover-3.webp");
    assert.equal(essential!.thumbnailUrl, "");                       // placeholder, never the book's own preview
    assert.deepEqual(stats, { records: 6, booksResolved: 4, booksFailed: 2, coversExpected: 3, coversResolved: 3, coversFailed: 0, synopses: 3 });
  });

  it("a root without catalog.json whose subfolders have the structure yields one genre per subfolder", async () => {
    const nested = {
      root: [folder("romance", "Romance"), folder("historia", "História"), folder("misc", "Outros")],
      romance: [file("cat-r", "catalog.json", "application/json"), folder("books-r", "books"), folder("covers-r", "covers")],
      historia: [folder("books-h", "books"), file("cat-h", "catalog.json", "application/json")],
      misc: [file("x", "solto.pdf", "application/pdf")],
      "books-r": [file("r1", "r1.epub")], "covers-r": [], "books-h": [file("h1", "h1.pdf", "application/pdf")],
    };
    const drive = fakeDrive(nested, { "cat-r": [{ title: "Romance 1", bookPath: "books/r1.epub" }], "cat-h": { books: [{ title: "História 1", bookPath: "books/h1.pdf" }] } });
    const described = await describeDriveFolder(drive, folder("root", "Raiz"), undefined, new AbortController().signal);
    assert.deepEqual(described.categories.map(value => value.name), ["Romance", "História"]);
    const historia = await readDriveCatalogCategory(drive, described.categories[1]!, "src", "book", new AbortController().signal);
    assert.equal(historia.entries[0]!.genre, "História"); assert.equal(historia.entries[0]!.title, "História 1");
  });

  it("the sync shows the catalog as one genre, completes as v2 and returns the folder's real name", async () => {
    const service = new PersonalDriveLibraryService(fakeDrive(tree, { cat: catalog }));
    const source = { id: "src", userId: "personal", name: "Link 1", folderUrl: "https://drive.google.com/drive/folders/root", folderId: "root", contentType: "book" as const, createdAt: "", updatedAt: "" };
    const pages: GoogleDriveLibraryEntry[][] = []; let last: GoogleDriveLibrarySyncState | null = null;
    const result = await service.listProgressively(source, [], null, new AbortController().signal, async (entries, state) => { pages.push(entries); last = state; });
    assert.equal(result.folderName, "Desenvolvimento pessoal");
    assert.deepEqual([...new Set(pages.flat().map(entry => entry.genre))], ["Desenvolvimento pessoal"]); // never "books" or "covers"
    assert.equal(pages.flat().length, 4);
    assert.equal(last!.completed, true); assert.equal(last!.version, PERSONAL_DRIVE_SYNC_VERSION);
  });

  it("describeLink reads the name before anything is saved, and a Link N source can be renamed", async () => {
    const service = new PersonalDriveLibraryService(fakeDrive(tree, { cat: catalog }));
    const described = await service.describeLink("https://drive.google.com/drive/folders/root", new AbortController().signal);
    assert.equal(described.folderName, "Desenvolvimento pessoal"); assert.equal(described.categories.length, 1);
    const values = new Map<string, unknown>();
    const storage: StorageAdapter = { load: async <T>(key: string) => (values.get(key) as T) ?? null, save: async (key, value) => { values.set(key, value); }, remove: async key => { values.delete(key); } };
    const repository = new GoogleDriveLibraryRepository(storage, "personal");
    const { source } = await repository.saveLink("https://drive.google.com/drive/folders/root", "book");
    assert.equal(source.name, "Link 1");
    assert.equal((await repository.rename(source.id, described.folderName))?.name, "Desenvolvimento pessoal");
    assert.equal((await repository.all())[0]!.name, "Desenvolvimento pessoal");
  });

  it("only arrays of records are catalogs; a record that resolves to nothing is skipped", () => {
    assert.equal(catalogRows({ version: 1 }), null);
    assert.equal(catalogRows("x"), null);
    assert.equal(catalogRows([{ title: "a" }, null, 3])!.length, 1);
    assert.equal(resolveCatalogRecord({ title: "x", bookPath: "books/none.epub" }, [], []), null);
    // A declared id outside books/ is trusted only with a readable format.
    assert.equal(resolveCatalogRecord({ driveFileId: "id", format: "epub", title: "Livro" }, [], [])?.file.id, "id");
    assert.equal(resolveCatalogRecord({ driveFileId: "id", format: "mobi" }, [], []), null);
  });
});
