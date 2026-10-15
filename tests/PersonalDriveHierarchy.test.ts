import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zipSync, strToU8 } from "fflate";
import { GoogleDriveAccessError, GoogleDriveLibraryService, type GoogleLibraryFile } from "../src/external/GoogleDriveLibraryService";
import { GoogleDriveLibraryRepository, type GoogleDriveFolderNode, type GoogleDriveLibraryEntry, type GoogleDriveLibrarySource } from "../src/external/GoogleDriveLibraryRepository";
import type { StorageAdapter } from "../src/services/StorageService";
import { PERSONAL_DRIVE_SYNC_VERSION, PersonalDriveLibraryService } from "../src/services/PersonalDriveLibraryService";
import { driveChildFolders, driveFilesIn, driveRootOf, driveTrail } from "../src/services/PersonalDriveFolderTree";
import { cbzCoverByRange, firstCbzPage, readCbzDirectory } from "../src/services/CbzRangeCover";
import { PersonalDriveCoverResolver } from "../src/services/PersonalDriveCoverResolver";
import { cbrCoverArchiveByRange, firstRarPage, planRar } from "../src/services/RarRangeCover";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FOLDER = GoogleDriveLibraryService.FOLDER;
const folder = (id: string, name: string): GoogleLibraryFile => ({ id, name, mimeType: FOLDER });
const file = (id: string, name: string, mimeType = "application/x-cbr", extra: Partial<GoogleLibraryFile> = {}): GoogleLibraryFile => ({ id, name, mimeType, size: "1000", modifiedTime: "2026-10-01T00:00:00Z", ...extra });

/* The reference source: HQs da Marvel → X-Men → Série → Volume → files, plus files and folders
 * side by side, a folder the account cannot open, and pagination. */
const tree: Record<string, GoogleLibraryFile[]> = {
  root: [folder("xmen", "X-Men"), folder("vingadores", "Vingadores"), folder("proibida", "Privada"), file("capa", "Especial.pdf", "application/pdf")],
  xmen: [folder("serie", "[1980] A Saga da Fênix Negra"), file("x1", "X-Men 001.cbz", "application/x-cbz"), file("x2", "X-Men 002.cbr")],
  serie: [folder("vol1", "Volume 1"), folder("vol10", "Volume 10"), folder("vol2", "Volume 2")],
  vol1: [file("v1a", "Fênix 01.cbr"), file("v1b", "Fênix 02.cbz", "application/x-cbz"), file("v1c", "Fênix 03.pdf", "application/pdf")],
  vol2: [file("v2a", "Fênix 04.cbr")], vol10: [],
  vingadores: [file("av1", "Vingadores 01.cbr"), file("av2", "Vingadores 02.cbr"), file("av3", "Vingadores 03.cbr")],
};

function fakeDrive(options: { pageSize?: number; forbidden?: string[]; log?: string[]; dropped?: Record<string, number> } = {}) {
  const pageSize = options.pageSize ?? 2, log = options.log ?? [];
  return {
    authorized: true, prepare: async () => undefined, connect: async () => undefined,
    metadata: async () => folder("root", "Hq's"),
    listRaw: async (id: string, _key: string | undefined, _signal: AbortSignal, pageToken?: string) => {
      log.push(`${id}:${pageToken ?? 0}`);
      if (options.forbidden?.includes(id)) throw new GoogleDriveAccessError("DRIVE_FOLDER_FORBIDDEN");
      if (options.dropped?.[id]) { options.dropped[id]--; throw new GoogleDriveAccessError("DRIVE_CONNECTION_FAILED"); }
      const items = tree[id] ?? [], start = pageToken ? Number(pageToken) : 0, next = start + pageSize;
      return { files: items.slice(start, next), nextPageToken: next < items.length ? String(next) : undefined };
    },
    list: async () => ({ files: [] }), json: async () => null, childNamed: async () => null,
  } as unknown as GoogleDriveLibraryService;
}
const source: GoogleDriveLibrarySource = { id: "src", userId: "personal", name: "HQs da Marvel", driveName: "Hq's", contentType: "comic",
  folderId: "root", folderUrl: "https://drive.google.com/drive/folders/root", createdAt: "", updatedAt: "" };

async function syncAll(drive: GoogleDriveLibraryService, priority?: () => string | null, retryDelaysMs: readonly number[] = [0, 0]) {
  const entries: GoogleDriveLibraryEntry[] = [], byId = new Map<string, GoogleDriveFolderNode>();
  let final: unknown = null;
  const result = await new PersonalDriveLibraryService(drive).listProgressively(source, [], null, new AbortController().signal, async (batch, state, _progress, folders) => {
    entries.push(...batch); folders.forEach(node => byId.set(node.folderId, { ...byId.get(node.folderId), ...node, listed: Boolean(byId.get(node.folderId)?.listed || node.listed) }));
    final = state;
  }, { priority, retryDelaysMs });
  return { entries, nodes: [...byId.values()], final: final as { completed: boolean; version: number }, result };
}

describe("one category per source, Drive's real tree below it", () => {
  it("keeps every folder at any depth as a child of the previous one, with files beside subfolders", async () => {
    const { entries, nodes, final } = await syncAll(fakeDrive({ forbidden: ["proibida"] }));
    assert.equal(final.completed, true); assert.equal(final.version, PERSONAL_DRIVE_SYNC_VERSION);
    // Every file belongs to the single category, as a comic, never to a subfolder genre.
    assert.deepEqual([...new Set(entries.map(entry => entry.genre))], ["HQs da Marvel"]);
    assert.ok(entries.every(entry => entry.contentType === "comic"), "a HQ source never appears in Livros, PDFs included");
    // No file lost, none duplicated.
    const ids = entries.map(entry => entry.fileId).sort();
    assert.deepEqual(ids, ["av1", "av2", "av3", "capa", "v1a", "v1b", "v1c", "v2a", "x1", "x2"]);
    const byId = new Map(nodes.map(node => [node.folderId, node]));
    assert.equal(byId.get("root")!.parentFolderId, null);
    assert.equal(byId.get("xmen")!.parentFolderId, "root"); assert.equal(byId.get("serie")!.parentFolderId, "xmen");
    assert.equal(byId.get("vol1")!.parentFolderId, "serie"); assert.equal(byId.get("vol1")!.depth, 3);
    const fenix = entries.find(entry => entry.fileId === "v1a")!;
    assert.equal(fenix.parentFolderId, "vol1");
    assert.deepEqual(fenix.folderPath!.map(step => step.name), ["X-Men", "[1980] A Saga da Fênix Negra", "Volume 1"]);
    // The inaccessible folder is marked; nothing else stopped.
    assert.equal(byId.get("proibida")!.error, "DRIVE_FOLDER_FORBIDDEN");
    assert.ok(nodes.filter(node => node.folderId !== "proibida").every(node => node.listed));
  });

  it("a dropped connection is retried before a folder is given up", async () => {
    const recovered = await syncAll(fakeDrive({ dropped: { vingadores: 2 } }));
    assert.ok(["av1", "av2", "av3"].every(id => recovered.entries.some(entry => entry.fileId === id)));
    assert.equal(recovered.nodes.find(node => node.folderId === "vingadores")!.error, undefined);
    const lost = await syncAll(fakeDrive({ dropped: { vingadores: 5 } }));
    assert.equal(lost.nodes.find(node => node.folderId === "vingadores")!.error, "DRIVE_CONNECTION_FAILED");
    assert.equal(lost.final.completed, true);
  });

  it("the folder open on screen is listed before the rest of the queue", async () => {
    const log: string[] = [];
    await syncAll(fakeDrive({ log }), () => "vingadores");
    const firstVingadores = log.findIndex(call => call.startsWith("vingadores:")), firstXmen = log.findIndex(call => call.startsWith("xmen:"));
    assert.ok(firstVingadores >= 0 && firstVingadores < firstXmen, `priority honoured: ${log.join(" ")}`);
    // No folder page requested twice.
    assert.equal(new Set(log).size, log.length);
  });

  it("navigates the cached tree: subfolders in natural order, files of the open folder only, breadcrumb", async () => {
    const { entries, nodes } = await syncAll(fakeDrive());
    assert.equal(driveRootOf(nodes, "src")!.folderId, "root");
    assert.deepEqual(driveChildFolders(nodes, "root").map(node => node.name), ["Privada", "Vingadores", "X-Men"]);
    assert.deepEqual(driveChildFolders(nodes, "serie").map(node => node.name), ["Volume 1", "Volume 2", "Volume 10"]);
    assert.deepEqual(driveFilesIn(entries, "src", "root", "root").map(entry => entry.fileId), ["capa"]);
    assert.deepEqual(driveFilesIn(entries, "src", "vol1", "root").map(entry => entry.name), ["Fênix 01.cbr", "Fênix 02.cbz", "Fênix 03.pdf"]);
    assert.deepEqual(driveTrail(nodes, "vol1").map(node => node.name), ["HQs da Marvel", "X-Men", "[1980] A Saga da Fênix Negra", "Volume 1"]);
    // Old cached entries without a parent are shown at the root, not lost.
    assert.equal(driveFilesIn([{ ...entries[0]!, fileId: "legacy", parentFolderId: undefined }], "src", "root", "root").length, 1);
  });
});

describe("source storage", () => {
  const memory = (): StorageAdapter => { const values = new Map<string, unknown>(); return { load: async <T>(key: string) => (values.get(key) as T) ?? null, save: async (key, value) => { values.set(key, value); }, remove: async key => { values.delete(key); } }; };

  it("keeps the Drive name apart from a custom name; renaming moves the category", async () => {
    const repository = new GoogleDriveLibraryRepository(memory(), "personal");
    const { source: saved } = await repository.saveLink("https://drive.google.com/drive/folders/root", "comic", "HQs da Marvel", "Hq's");
    assert.equal(saved.name, "HQs da Marvel"); assert.equal(saved.driveName, "Hq's"); assert.equal(saved.folderId, "root"); assert.equal(saved.contentType, "comic");
    await repository.appendEntries(saved.id, [{ sourceId: saved.id, fileId: "a", name: "a.cbr", mimeType: "x", genre: "HQs da Marvel", thumbnailUrl: "" }]);
    await repository.rename(saved.id, "Marvel Clássicos");
    assert.equal((await repository.all())[0]!.driveName, "Hq's");
    assert.deepEqual((await repository.entries(saved.id)).map(entry => entry.genre), ["Marvel Clássicos"]);
  });

  it("refuses a second source with the same name (it would share the category chip)", async () => {
    const repository = new GoogleDriveLibraryRepository(memory(), "personal");
    const { source: marvel } = await repository.saveLink("https://drive.google.com/drive/folders/root", "comic", "Marvel", "Hq's");
    await assert.rejects(repository.saveLink("https://drive.google.com/drive/folders/xmen", "comic", "marvel", "X-Men"), /DRIVE_SOURCE_NAME_TAKEN/);
    const { source: xmen } = await repository.saveLink("https://drive.google.com/drive/folders/xmen", "comic", "X-Men", "X-Men");
    await assert.rejects(repository.rename(xmen.id, "Márvel"), /DRIVE_SOURCE_NAME_TAKEN/);
    assert.equal((await repository.rename(marvel.id, "HQs da Marvel"))?.name, "HQs da Marvel");
    assert.deepEqual((await repository.all()).map(row => row.name), ["HQs da Marvel", "X-Men"]);
  });

  it("entries and the root written by a sync started before a rename take the new name", async () => {
    const repository = new GoogleDriveLibraryRepository(memory(), "personal");
    const { source: saved } = await repository.saveLink("https://drive.google.com/drive/folders/root", "comic", "Marvel", "Hq's");
    await repository.appendEntries(saved.id, [{ sourceId: saved.id, fileId: "a", name: "a.cbr", mimeType: "x", genre: "Marvel", thumbnailUrl: "" }]);
    await repository.rename(saved.id, "HQs da Marvel");
    // The sync still running holds the old name.
    const entries = await repository.appendEntries(saved.id, [{ sourceId: saved.id, fileId: "b", name: "b.cbr", mimeType: "x", genre: "Marvel", thumbnailUrl: "" }]);
    assert.deepEqual(entries.map(entry => entry.genre), ["HQs da Marvel", "HQs da Marvel"]);
    const folders = await repository.appendFolders(saved.id, [{ sourceId: saved.id, folderId: "root", parentFolderId: null, name: "Marvel", depth: 0 }, { sourceId: saved.id, folderId: "x", parentFolderId: "root", name: "X-Men", depth: 1 }]);
    assert.deepEqual(folders.map(node => node.name), ["HQs da Marvel", "X-Men"]);
  });

  it("stores each folder once and never forgets that it was fully listed", async () => {
    const repository = new GoogleDriveLibraryRepository(memory(), "personal");
    const node = { sourceId: "s", folderId: "f", parentFolderId: "root", name: "X-Men", depth: 1 };
    await repository.appendFolders("s", [{ ...node, listed: true }]);
    await repository.appendFolders("s", [{ ...node, listed: false }, { ...node, folderId: "g", name: "Série" }]);
    const folders = await repository.folders("s");
    assert.equal(folders.length, 2); assert.equal(folders.find(value => value.folderId === "f")!.listed, true);
  });
});

/* A real CBZ, read only through byte ranges. */
function cbz(): Uint8Array {
  const big = new Uint8Array(400_000).map((_, i) => (i * 7919) % 251); // incompressible filler page
  return zipSync({
    "__MACOSX/._page01.jpg": strToU8("junk"), ".hidden.png": strToU8("junk"),
    "comic/page10.jpg": [big, { level: 0 }], "comic/page2.jpg": [big, { level: 0 }],
    "comic/page01.jpg": [strToU8("\xff\xd8\xff COVER BYTES ".repeat(50)), { level: 9 }],
    "comic/info.txt": strToU8("not a page"),
  });
}

describe("CBZ cover by byte ranges", () => {
  it("finds the first page in natural order and inflates it without reading the archive", async () => {
    const archive = cbz(); let bytesRead = 0;
    const read = async (start: number, end: number) => { bytesRead += end - start + 1; return archive.slice(start, end + 1); };
    const entries = await readCbzDirectory(read, archive.length);
    assert.equal(firstCbzPage(entries)!.name, "comic/page01.jpg");
    const blob = (await cbzCoverByRange(read, archive.length))!;
    assert.equal(blob.type, "image/jpeg");
    assert.match(new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer())), /COVER BYTES/);
    assert.ok(bytesRead < archive.length / 2, `read ${bytesRead} of ${archive.length} bytes`);
  });

  it("refuses something that is not a zip", async () => {
    const junk = new Uint8Array(5000);
    await assert.rejects(readCbzDirectory(async (s, e) => junk.slice(s, e + 1), junk.length), /CBZ_NOT_ZIP/);
  });
});

describe("Drive covers", () => {
  const entry = (extra: Partial<GoogleDriveLibraryEntry>): GoogleDriveLibraryEntry => ({ sourceId: "s", fileId: "f1", name: "Fênix 01.cbr", mimeType: "x", genre: "HQs", thumbnailUrl: "", modifiedTime: "t", ...extra });
  function resolver(over: { fetcher?: typeof fetch; range?: (s: number, e: number) => Promise<Uint8Array>; fresh?: string | null; local?: Blob | null; cache?: Map<string, string> } = {}) {
    const cache = over.cache ?? new Map<string, string>(), calls: string[] = [];
    const value = new PersonalDriveCoverResolver({
      drive: { range: async (_f, s, e) => { calls.push(`range:${s}-${e}`); return { bytes: await over.range!(s, e), total: null }; }, thumbnailLink: async () => { calls.push("fresh-link"); return over.fresh ?? null; } } as never,
      cache: { get: async key => cache.get(key) ?? null, save: async (key, url) => { cache.set(key, url); } },
      localFile: async () => over.local ?? null, firstPage: async () => new Blob(["page"], { type: "image/jpeg" }),
      thumbnail: async blob => `data:image/webp;base64,${blob.size}`, fetcher: over.fetcher ?? (async () => { calls.push("fetch"); return new Response(null, { status: 403 }); }) as typeof fetch,
    });
    return { value, cache, calls };
  }

  it("uses the catalog cover first and a processed cover next, without network", async () => {
    const { value, calls } = resolver({ cache: new Map([["drive-cover:f1:t", "data:cached"]]) });
    assert.equal(await value.resolve(entry({ coverUrl: "https://example.test/c.webp" })), "https://example.test/c.webp");
    assert.equal(await value.resolve(entry({})), "data:cached");
    assert.deepEqual(calls, []);
  });

  it("caches Drive's thumbnail, retries once with a fresh link, and never downloads a file", async () => {
    let n = 0;
    const fetcher = (async (url: string) => { n++; return url === "fresh" ? new Response(new Blob(["img"], { type: "image/png" })) : new Response(null, { status: 403 }); }) as unknown as typeof fetch;
    const { value, cache, calls } = resolver({ fetcher, fresh: "fresh" });
    const url = await value.resolve(entry({ thumbnailLink: "expired" }));
    assert.match(url!, /^data:image\/webp/); assert.equal(n, 2); assert.deepEqual(calls, ["fresh-link"]);
    assert.equal(cache.get("drive-cover:f1:t"), url);
  });

  it("a cover still queued when its card left the screen is skipped; asking again works", async () => {
    const archive = cbz(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const { value, calls } = resolver({ range: async (s, e) => { await gate; return archive.slice(s, e + 1); } });
    const busy = ["a", "b", "c"].map(id => value.resolve(entry({ fileId: id, name: `${id}.cbz`, size: String(archive.length) })));
    const screen = new AbortController();
    const queued = value.resolve(entry({ fileId: "q", name: "q.cbz", size: String(archive.length) }), screen.signal);
    screen.abort(); release(); await Promise.all(busy);
    assert.equal(await queued, null);
    // Three covers made, each with the same number of reads: nothing was read for the skipped one.
    const before = calls.length;
    assert.match((await value.resolve(entry({ fileId: "q", name: "q.cbz", size: String(archive.length) }), new AbortController().signal))!, /^data:image\/webp/);
    assert.equal(before, 3 * (calls.length - before));
  });

  it("CBZ without a thumbnail: first page by ranges; CBR without one: placeholder until downloaded", async () => {
    const archive = cbz();
    const { value, calls } = resolver({ range: async (s, e) => archive.slice(s, e + 1) });
    assert.match((await value.resolve(entry({ fileId: "z", name: "X-Men 001.cbz", size: String(archive.length) })))!, /^data:image\/webp/);
    // Signature sniff + end record + directory + local header + page: never the archive.
    assert.ok(calls.every(call => call.startsWith("range:")) && calls.length <= 5, calls.join(" "));
    const cbr = resolver({});
    assert.equal(await cbr.value.resolve(entry({ fileId: "r" })), null);
    // A file with no cover is not asked again on the next redraw.
    const asked = cbr.calls.length;
    assert.equal(await cbr.value.resolve(entry({ fileId: "r" })), null); assert.equal(cbr.calls.length, asked);
    const downloaded = resolver({ local: new Blob(["file"]) });
    assert.match((await downloaded.value.resolve(entry({ fileId: "d" })))!, /^data:image\/webp/);
  });

  it("one request per cover even when the card asks twice", async () => {
    let n = 0;
    const fetcher = (async () => { n++; return new Response(new Blob(["img"], { type: "image/png" })); }) as unknown as typeof fetch;
    const { value } = resolver({ fetcher });
    const [a, b] = await Promise.all([value.resolve(entry({ thumbnailLink: "t" })), value.resolve(entry({ thumbnailLink: "t" }))]);
    assert.equal(a, b); assert.equal(n, 1);
  });
});

/* A stored (uncompressed) RAR4 built byte by byte, pages deliberately out of order. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
function rar4(files: Array<[string, Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])];
  const block = (type: number, flags: number, fields: Uint8Array): Uint8Array => {
    const size = 7 + fields.length, out = new Uint8Array(size), view = new DataView(out.buffer);
    view.setUint8(2, type); view.setUint16(3, flags, true); view.setUint16(5, size, true); out.set(fields, 7);
    view.setUint16(0, crc32(out.subarray(2)) & 0xffff, true); return out;
  };
  parts.push(block(0x73, 0, new Uint8Array(6)));
  for (const [name, data] of files) {
    const nameBytes = new TextEncoder().encode(name), fields = new Uint8Array(25 + nameBytes.length), view = new DataView(fields.buffer);
    view.setUint32(0, data.length, true); view.setUint32(4, data.length, true); view.setUint8(8, 2); view.setUint32(9, crc32(data), true);
    view.setUint32(13, 0x5a000000, true); view.setUint8(17, 20); view.setUint8(18, 0x30); view.setUint16(19, nameBytes.length, true); view.setUint32(21, 0x20, true);
    fields.set(nameBytes, 25); parts.push(block(0x74, 0x8000, fields), data);
  }
  parts.push(new Uint8Array([0xc4, 0x3d, 0x7b, 0x00, 0x40, 0x07, 0x00]));
  const total = parts.reduce((sum, part) => sum + part.length, 0), out = new Uint8Array(total); let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

describe("CBR cover by byte ranges", () => {
  const big = new Uint8Array(300_000).fill(7), cover = new TextEncoder().encode("\xff\xd8 THE COVER ".repeat(40));
  const archive = rar4([["pg 02.jpg", big], ["pg 10.jpg", big], ["pg 01.jpg", cover], ["notes.txt", new Uint8Array(10)]]);
  it("walks only the headers, picks the first page in natural order and cuts a one-page archive", async () => {
    let bytes = 0; const read = async (s: number, e: number) => { bytes += e - s + 1; return archive.slice(s, e + 1); };
    const plan = (await planRar(read, archive.length))!;
    assert.equal(plan.version, 4); assert.deepEqual(plan.entries.map(entry => entry.name), ["pg 02.jpg", "pg 10.jpg", "pg 01.jpg", "notes.txt"]);
    assert.equal(firstRarPage(plan)!.name, "pg 01.jpg");
    const mini = new Uint8Array(await (await cbrCoverArchiveByRange(read, archive.length))!.arrayBuffer());
    assert.ok(bytes < archive.length / 2, `read ${bytes} of ${archive.length}`);
    assert.ok(new TextDecoder("latin1").decode(mini).includes("THE COVER"));
    assert.ok(mini.length < 2_000);
    // When unrar is installed, the cut archive must pass its own CRC check.
    let unrar = true; try { execFileSync("unrar", ["-?"], { stdio: "ignore" }); } catch (error) { unrar = (error as { status?: number }).status !== undefined && (error as { code?: string }).code !== "ENOENT"; }
    if (unrar) {
      const dir = mkdtempSync(join(tmpdir(), "lumeo-rar-")); writeFileSync(join(dir, "mini.rar"), mini);
      assert.match(execFileSync("unrar", ["t", join(dir, "mini.rar")], { encoding: "utf8" }), /All OK/);
    }
  });
  it("stops walking once four pages came in natural order, but walks a disordered archive whole", async () => {
    const pages = Array.from({ length: 30 }, (_, index) => [`page ${String(index + 1).padStart(2, "0")}.jpg`, new Uint8Array(2_000).fill(index)] as [string, Uint8Array]);
    const count = (bytes: Uint8Array) => { let calls = 0; return { read: async (s: number, e: number) => { calls++; return bytes.slice(s, e + 1); }, calls: () => calls }; };
    const sorted = rar4(pages), sortedReader = count(sorted);
    const sortedPlan = (await planRar(sortedReader.read, sorted.length))!;
    assert.equal(sortedPlan.entries.length, 4); assert.equal(firstRarPage(sortedPlan)!.name, "page 01.jpg");
    assert.ok(sortedReader.calls() <= 6, `${sortedReader.calls()} requests`);
    // Unpadded numbers stored in plain name order: "1, 10, 11, 12…" is sorted, its first page is 1.
    const plain = rar4(["1", "10", "11", "12", "13", "2", "3"].map(name => [`x ${name}.jpg`, new Uint8Array(500)] as [string, Uint8Array]));
    const plainPlan = (await planRar(async (s, e) => plain.slice(s, e + 1), plain.length))!;
    assert.equal(plainPlan.entries.length, 4); assert.equal(firstRarPage(plainPlan)!.name, "x 1.jpg");
    const shuffled = rar4([pages[1]!, pages[0]!, ...pages.slice(2)]), shuffledReader = count(shuffled);
    const shuffledPlan = (await planRar(shuffledReader.read, shuffled.length))!;
    assert.equal(shuffledPlan.entries.length, 30); assert.equal(firstRarPage(shuffledPlan)!.name, "page 01.jpg");
  });
  it("refuses solid or encrypted archives instead of guessing", async () => {
    const solid = archive.slice(); const view = new DataView(solid.buffer); view.setUint16(7 + 3, 0x08, true);
    assert.equal(await planRar(async (s, e) => solid.slice(s, e + 1), solid.length), null);
  });
});
