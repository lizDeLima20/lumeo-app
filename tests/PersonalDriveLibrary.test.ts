import assert from "node:assert/strict";
import { it } from "node:test";
import { GoogleDriveLibraryRepository } from "../src/external/GoogleDriveLibraryRepository";
import type { StorageAdapter } from "../src/services/StorageService";
import { PersonalDriveLibraryService } from "../src/services/PersonalDriveLibraryService";
import { resolvePersonalDriveGenre } from "../src/services/PersonalDriveGenreResolver";
import { Book } from "../src/models/Book";
import { ComicContentTypeResolver } from "../src/reader/comic/ComicContentType";
import { PersonalDriveImporter } from "../src/services/PersonalDriveImporter";

class Memory implements StorageAdapter {
  private values = new Map<string, unknown>();
  async load<T>(key: string): Promise<T | null> { return this.values.get(key) as T ?? null; }
  async save<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
  async remove(key: string): Promise<void> { this.values.delete(key); }
}
const url = "https://drive.google.com/drive/folders/folder_123";

it("normalizes known Drive folder genres but preserves personal names", () => {
  assert.equal(resolvePersonalDriveGenre("História"), "História");
  assert.equal(resolvePersonalDriveGenre("AUTO AJUDA"), "Autoajuda");
  assert.equal(resolvePersonalDriveGenre("Ficção-científica"), "Ficção Científica");
  assert.equal(resolvePersonalDriveGenre("Leituras da Ana"), "Leituras da Ana");
});

it("keeps one saved link, preserves an explicit source name, and persists metadata separately from downloads", async () => {
  const storage = new Memory(), repository = new GoogleDriveLibraryRepository(storage, "personal");
  const first = await repository.saveLink(url, "book", "História"), repeated = await repository.saveLink(url + "?resourcekey=safe-key", "book", "História");
  assert.equal(first.created, true); assert.equal(repeated.created, false); assert.equal((await repository.all()).length, 1);
  assert.match(repeated.source.folderUrl, /resourcekey=safe-key/);
  const second = await repository.saveLink("https://drive.google.com/drive/folders/folder_456", "book", "Romance");
  assert.equal(second.source.name, "Romance"); assert.equal((await repository.all()).length, 2);
  await repository.saveEntries(first.source.id, [{ sourceId: first.source.id, fileId: "pdf", name: "book.pdf", mimeType: "application/pdf", genre: "História", thumbnailUrl: "https://example.test/cover" }]);
  assert.equal((await repository.entries()).length, 1);
});

it("persists the reader choice for a link and updates only its cached metadata", async () => {
  const storage = new Memory(), repository = new GoogleDriveLibraryRepository(storage, "personal");
  const created = await repository.saveLink(url, "comic", "HQ Marvel");
  assert.equal(created.source.contentType, "comic");
  await repository.saveEntries(created.source.id, [{ sourceId: created.source.id, fileId: "pdf", name: "almanaque.pdf", mimeType: "application/pdf", genre: "HQs", thumbnailUrl: "https://example.test/cover", contentType: "comic" }]);
  const updated = await repository.updateContentType(created.source.id, "book");
  assert.equal(updated?.contentType, "book");
  assert.equal((await repository.entries(created.source.id))[0]?.contentType, "book");
  const afterRestart = new GoogleDriveLibraryRepository(storage, "personal");
  assert.equal((await afterRestart.all())[0]?.folderId, "folder_123"); assert.equal((await afterRestart.all())[0]?.contentType, "book");
});

it("routes a Drive PDF as a comic only after explicit folder classification", () => {
  const base = { id: "pdf", title: "Almanaque", author: "", genreId: "hqs", cover: "cover", fileType: "pdf" as const, fileName: "almanaque.pdf", fileSize: 1, mimeType: "application/pdf", readingStatus: "unread" as const };
  const resolver = new ComicContentTypeResolver();
  assert.equal(resolver.isComic(new Book({ ...base, contentType: "book" })), false);
  assert.equal(resolver.isComic(new Book({ ...base, contentType: "comic" })), true);
  assert.equal(resolver.isComic(new Book({ ...base, fileType: "cbz", fileName: "almanaque.cbz", contentType: "comic" })), true);
});

it("keeps an already downloaded PDF and its progress when a link is reclassified", async () => {
  const existing = new Book({ id: "local-pdf", catalogBookId: "drive:pdf", sourceVersion: "same", title: "Almanaque", author: "", genreId: "hqs", cover: "cover", fileType: "pdf", fileName: "almanaque.pdf", fileSize: 1, mimeType: "application/pdf", readingStatus: "reading", progressPercent: 42, currentLocation: "comic:12", contentType: "book" });
  const saved: Book[] = [];
  const importer = new PersonalDriveImporter({ prepare: async () => undefined, authorized: true } as never, {} as never,
    { getAll: async () => [existing], save: async (book: Book) => { saved.push(book); } } as never, {} as never, {} as never);
  const result = await importer.importListedFile({ id: "pdf", name: "almanaque.pdf", mimeType: "application/pdf", modifiedTime: "same" }, "HQs", new AbortController().signal, "comic", () => undefined);
  assert.equal(result.id, existing.id); assert.equal(result.contentType, "comic"); assert.equal(result.progressPercent, 42); assert.equal(result.currentLocation, "comic:12"); assert.equal(saved[0]?.contentType, "comic");
});

it("lists Drive pages progressively, checkpoints queue state, and never downloads", async () => {
  const calls: string[] = [];
  const fake = {
    authorized: true, prepare: async () => { calls.push("prepare"); }, connect: async () => { calls.push("connect"); },
    metadata: async () => ({ id: "root", name: "História", mimeType: "application/vnd.google-apps.folder" }),
    list: async (id: string, _key: string | undefined, _signal: AbortSignal, page?: string) => {
      calls.push(`list:${id}:${page ?? "first"}`);
      if (id === "root" && !page) return { files: [{ id: "root-pdf", name: "Raiz.pdf", mimeType: "application/pdf" }, { id: "self", name: "Auto Ajuda", mimeType: "application/vnd.google-apps.folder" }], nextPageToken: "next" };
      if (id === "root") return { files: [{ id: "root-second", name: "Outra.pdf", mimeType: "application/pdf" }] };
      return { files: [{ id: "nested-epub", name: "Filho.epub", mimeType: "application/epub+zip" }] };
    },
  };
  const service = new PersonalDriveLibraryService(fake as never);
  const pages: string[][] = [];
  await service.listProgressively({ id: "link", userId: "personal", name: "Link 1", folderId: "root", folderUrl: url, createdAt: "", updatedAt: "" }, [], null, new AbortController().signal,
    async (entries, state) => { pages.push(entries.map(item => `${item.name}:${item.genre}:${item.parentFolderId}:${(item.folderPath ?? []).map(step => step.name).join("/")}`)); assert.ok(state.completed || state.queue.length > 0); });
  // One category (the source); the subfolder is a child of it, never a genre of its own.
  assert.deepEqual(pages.filter(batch => batch.length), [["Raiz.pdf:História:root:"], ["Outra.pdf:História:root:"], ["Filho.epub:História:self:Auto Ajuda"]]);
  assert.deepEqual(calls, ["prepare", "list:root:first", "list:root:next", "list:self:first"]);
});

for (const count of [100, 1_000, 10_000]) it(`streams ${count} metadata entries in bounded Drive pages`, async () => {
  let calls = 0, received = 0, largestBatch = 0;
  const fake = { authorized: true, prepare: async () => undefined, connect: async () => undefined,
    metadata: async () => ({ id: "root", name: "História", mimeType: "application/vnd.google-apps.folder" }),
    list: async (_id: string, _key: string | undefined, _signal: AbortSignal, token?: string) => {
      const start = Number(token ?? "0"), end = Math.min(count, start + 100); calls++;
      return { files: Array.from({ length: end - start }, (_, index) => ({ id: `id-${start + index}`, name: `Livro ${start + index}.pdf`, mimeType: "application/pdf" })), nextPageToken: end < count ? String(end) : undefined };
    },
  };
  await new PersonalDriveLibraryService(fake as never).listProgressively({ id: "link", userId: "personal", name: "Link 1", folderId: "root", folderUrl: url, createdAt: "", updatedAt: "" }, [], null, new AbortController().signal,
    async (entries) => { received += entries.length; largestBatch = Math.max(largestBatch, entries.length); });
  assert.equal(received, count); assert.equal(largestBatch, 24); assert.equal(calls, count / 100);
});

it("persists a resumable cursor before listing and keeps the completed checkpoint", async () => {
  const checkpoints: { queue: { pageToken?: string }[]; completed: boolean; files?: number }[] = [];
  const fake = { authorized: true, prepare: async () => undefined, connect: async () => undefined,
    metadata: async () => ({ id: "root", name: "História", mimeType: "application/vnd.google-apps.folder" }),
    list: async (_id: string, _key: string | undefined, _signal: AbortSignal, token?: string) => ({
      files: [{ id: token ? "two" : "one", name: `${token ? "Dois" : "Um"}.pdf`, mimeType: "application/pdf" }], nextPageToken: token ? undefined : "next",
    }),
  };
  await new PersonalDriveLibraryService(fake as never).listProgressively({ id: "link", userId: "personal", name: "Link 1", folderId: "root", folderUrl: url, createdAt: "", updatedAt: "" }, [], null,
    new AbortController().signal, async (_entries, state) => { checkpoints.push(structuredClone(state)); });
  assert.equal(checkpoints[0]?.queue[0]?.folderId, "root");
  assert.equal(checkpoints.at(-1)?.completed, true); assert.equal(checkpoints.at(-1)?.files, 2);
});

it("reveals a small Drive folder in more than one render batch", async () => {
  const batches: number[] = [];
  const fake = { authorized: true, prepare: async () => undefined, connect: async () => undefined,
    metadata: async () => ({ id: "root", name: "HQs", mimeType: "application/vnd.google-apps.folder" }),
    list: async () => ({ files: Array.from({ length: 17 }, (_, index) => ({ id: String(index), name: `${index}.pdf`, mimeType: "application/pdf" })) }),
  };
  await new PersonalDriveLibraryService(fake as never).listProgressively({ id: "link", userId: "personal", name: "Link 1", folderId: "root", folderUrl: url, createdAt: "", updatedAt: "" }, [], null,
    new AbortController().signal, async entries => { if (entries.length) batches.push(entries.length); });
  assert.deepEqual(batches, [8, 8, 1]);
});

it("reads catalog.json before listing files and retains a comic collection path", async () => {
  const fake = { authorized: true, prepare: async () => undefined, connect: async () => undefined,
    metadata: async () => ({ id: "root", name: "Marvel", mimeType: "application/vnd.google-apps.folder" }),
    childNamed: async () => ({ id: "catalog", name: "catalog.json", mimeType: "application/json" }),
    json: async () => ({ books: [{ driveFileId: "issue", title: "Vingadores 001", author: "Stan", synopsis: "Uma edição", coverDriveFileId: "cover" }] }),
    listRaw: async (id: string) => id === "root" ? { files: [{ id: "vingadores", name: "Os Vingadores", mimeType: "application/vnd.google-apps.folder" }] } :
      { files: [{ id: "issue", name: "001.cbz", mimeType: "application/x-cbz" }, { id: "cover", name: "001.webp", mimeType: "image/webp" }] },
  };
  const batches: import("../src/external/GoogleDriveLibraryRepository").GoogleDriveLibraryEntry[][] = [];
  await new PersonalDriveLibraryService(fake as never).listProgressively({ id: "source", userId: "personal", name: "HQ Marvel", folderId: "root", folderUrl: url, contentType: "comic", createdAt: "", updatedAt: "" }, [], null, new AbortController().signal,
    async entries => { if (entries.length) batches.push(entries); });
  const issue = batches.flat()[0]!;
  assert.equal(issue.genre, "HQ Marvel"); assert.deepEqual(issue.collectionPath, ["Os Vingadores"]);
  assert.equal(issue.title, "Vingadores 001"); assert.equal(issue.author, "Stan"); assert.equal(issue.synopsis, "Uma edição");
  assert.match(issue.coverUrl!, /thumbnail\?id=cover/);
});
