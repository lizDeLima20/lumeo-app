import { GoogleDriveLibraryService, type GoogleLibraryFile } from "../external/GoogleDriveLibraryService";
import type { GoogleDriveLibraryContentType, GoogleDriveLibraryEntry } from "../external/GoogleDriveLibraryRepository";
import { driveThumbnailUrl } from "./PersonalDriveCatalogResolver";

/**
 * Structured Drive book folders, read on the device.
 *
 *   <Categoria>/            <- name of the source and of the genre
 *   ├── books/              <- the book files
 *   ├── covers/             <- the cover images
 *   └── catalog.json        <- one record per book
 *
 * The former Lumeo server did this work (server/src/catalog/StructuredDriveCatalogProvider.ts,
 * PublicCatalogJsonReader): it found catalog.json in the folder listing, read it by its real
 * file id and turned each record into a catalogue book. Here the same steps run locally through
 * the authorised Drive API; no server is involved. A root without catalog.json whose
 * subfolders each have the structure yields one category per subfolder.
 *
 * catalog.json ids may be stale: books and covers are matched against the real listing of
 * books/ and covers/, by id first and then by the file name in bookPath / coverPath.
 */
export type DriveCatalogApi = Pick<GoogleDriveLibraryService, "listRaw" | "json">;

export interface DriveCatalogCategory {
  name: string; folderId: string; resourceKey?: string;
  books: GoogleLibraryFile; covers?: GoogleLibraryFile; catalog: GoogleLibraryFile;
}
export interface DriveFolderDescription { folderId: string; folderName: string; children: string[]; categories: DriveCatalogCategory[]; }
export interface DriveCatalogStats { records: number; booksResolved: number; booksFailed: number; coversExpected: number; coversResolved: number; coversFailed: number; synopses: number; }

export interface CatalogRow {
  title?: unknown; author?: unknown; genre?: unknown; synopsis?: unknown; summary?: unknown; description?: unknown; bookId?: unknown;
  format?: unknown; bookPath?: unknown; coverPath?: unknown; driveFileId?: unknown; bookDriveFileId?: unknown; downloadUrl?: unknown;
  coverDriveFileId?: unknown; coverUrl?: unknown; fileSize?: unknown; resourceKey?: unknown; sourceName?: unknown;
}
export interface ResolvedCatalogBook {
  file: GoogleLibraryFile; title: string; author: string; synopsis?: string;
  coverUrl: string; coverDriveFileId?: string; coverSource: "coverUrl" | "coverDriveFileId" | "coverPath" | "placeholder";
}

const READABLE = /\.(pdf|epub|cbr|cbz)$/i;
const MIME: Record<string, string> = { pdf: "application/pdf", epub: "application/epub+zip", cbz: "application/vnd.comicbook+zip", cbr: "application/vnd.comicbook-rar" };

/** Structure of a root folder: itself when it has books/ + catalog.json, otherwise each
 *  subfolder that has them. Covers are optional for detection, required for real covers. */
export async function describeDriveFolder(api: DriveCatalogApi, root: GoogleLibraryFile, key: string | undefined, signal: AbortSignal): Promise<DriveFolderDescription> {
  const children = await listAll(api, root.id, key, signal);
  const own = structureOf(root.name, root.id, key, children);
  const categories: DriveCatalogCategory[] = [];
  if (own) categories.push(own);
  else {
    for (const folder of children.filter(item => item.mimeType === GoogleDriveLibraryService.FOLDER)) {
      // A subfolder the account cannot open is simply not a catalog; the others still count.
      const inner = await listAll(api, folder.id, folder.resourceKey, signal).catch(error => {
        if (signal.aborted) throw error;
        console.warn(JSON.stringify({ event: "DRIVE_SUBFOLDER_UNREADABLE", folderId: folder.id, reason: error instanceof Error ? error.message : "unknown" })); return [] as GoogleLibraryFile[];
      });
      const category = structureOf(folder.name, folder.id, folder.resourceKey, inner);
      if (category) categories.push(category);
    }
  }
  const books = own?.books, covers = own?.covers, catalog = own?.catalog;
  console.info(`[DriveSource] folderId=${root.id} folderName=${root.name} children=${JSON.stringify(children.map(item => item.name).slice(0, 50))}`);
  console.info(`[DriveBooks] booksFolderFound=${Boolean(books) || categories.length > 0} coversFolderFound=${Boolean(covers) || categories.some(value => value.covers)} catalogFound=${Boolean(catalog) || categories.length > 0}${catalog ? ` catalogFileId=${catalog.id}` : ""} categories=${JSON.stringify(categories.map(value => value.name))}`);
  return { folderId: root.id, folderName: root.name, children: children.map(item => item.name), categories };
}

/** Every catalog book of a category as cached Drive entries (metadata only, nothing downloaded). */
export interface DriveCatalogPlacement { genre: string; parentFolderId: string; folderPath: Array<{ id: string; name: string }>; }

export async function readDriveCatalogCategory(api: DriveCatalogApi, category: DriveCatalogCategory, sourceId: string,
  contentType: GoogleDriveLibraryContentType, signal: AbortSignal, placement?: DriveCatalogPlacement): Promise<{ entries: GoogleDriveLibraryEntry[]; stats: DriveCatalogStats }> {
  const document = await api.json(category.catalog, signal);
  const rows = catalogRows(document);
  if (!rows) throw new Error("DRIVE_CATALOG_INVALID");
  const bookFiles = (await listAll(api, category.books.id, category.books.resourceKey, signal)).filter(item => READABLE.test(item.name));
  const coverFiles = category.covers ? (await listAll(api, category.covers.id, category.covers.resourceKey, signal)).filter(item => item.mimeType !== GoogleDriveLibraryService.FOLDER) : [];
  // Without a placement the genre is the category folder exactly as named in Drive
  // ("Desenvolvimento pessoal"); a source places its catalogs inside its own single category.
  const genre = placement?.genre ?? (category.name.trim() || "Sem gênero");
  const parentFolderId = placement?.parentFolderId ?? category.folderId, folderPath = placement?.folderPath ?? [];
  const stats: DriveCatalogStats = { records: rows.length, booksResolved: 0, booksFailed: 0, coversExpected: 0, coversResolved: 0, coversFailed: 0, synopses: 0 };
  const entries: GoogleDriveLibraryEntry[] = [], seen = new Set<string>();
  for (const row of rows) {
    const book = resolveCatalogRecord(row, bookFiles, coverFiles);
    if (!book) { stats.booksFailed++; continue; }
    if (seen.has(book.file.id)) continue;
    seen.add(book.file.id); stats.booksResolved++;
    if (book.synopsis) stats.synopses++;
    const hasCover = Boolean(text(row.coverUrl) || text(row.coverDriveFileId) || text(row.coverPath));
    if (hasCover) stats.coversExpected++;
    if (book.coverSource !== "placeholder") stats.coversResolved++;
    else if (hasCover) stats.coversFailed++;
    entries.push({ sourceId, fileId: book.file.id, name: book.file.name, mimeType: book.file.mimeType, size: book.file.size,
      modifiedTime: book.file.modifiedTime, resourceKey: book.file.resourceKey, genre, contentType, collectionPath: folderPath.map(step => step.name), parentFolderId, folderPath,
      title: book.title, author: book.author, synopsis: book.synopsis, coverUrl: book.coverUrl || undefined,
      coverDriveFileId: book.coverDriveFileId, thumbnailUrl: book.coverUrl });
  }
  console.info(`[DriveBooks] folderName=${category.name} catalogFound=true catalogFileId=${category.catalog.id} catalogRecords=${rows.length} booksInFolder=${bookFiles.length} booksResolved=${stats.booksResolved} booksFailed=${stats.booksFailed} synopses=${stats.synopses}`);
  console.info(`[DriveCovers] folderName=${category.name} coversInFolder=${coverFiles.length} expected=${stats.coversExpected} resolved=${stats.coversResolved} failed=${stats.coversFailed}`);
  return { entries, stats };
}

/**
 * One catalog record → the real book file and its cover.
 * Book: bookDriveFileId / driveFileId present in books/ → bookPath file name in books/ →
 *       downloadUrl id present in books/ → the declared id as a last resort.
 * Cover: coverUrl (https) → coverDriveFileId present in covers/ → coverPath file name in
 *        covers/ → the declared coverDriveFileId → placeholder (empty URL).
 */
export function resolveCatalogRecord(row: CatalogRow, bookFiles: readonly GoogleLibraryFile[], coverFiles: readonly GoogleLibraryFile[]): ResolvedCatalogBook | null {
  const byId = (files: readonly GoogleLibraryFile[], id: string | undefined) => id ? files.find(file => file.id === id) : undefined;
  const byName = (files: readonly GoogleLibraryFile[], path: string | undefined) => {
    if (!path) return undefined;
    const name = basename(path), folded = fold(name);
    return files.find(file => file.name === name) ?? files.find(file => fold(file.name) === folded);
  };
  const declaredId = text(row.bookDriveFileId) ?? text(row.driveFileId);
  const urlId = driveIdFromUrl(text(row.downloadUrl));
  let file = byId(bookFiles, declaredId) ?? byName(bookFiles, text(row.bookPath)) ?? byId(bookFiles, urlId);
  if (!file) {
    // Not in books/: trust a declared id only if the record says which readable format it is.
    const id = declaredId ?? urlId, format = (text(row.format) ?? extension(text(row.bookPath) ?? "")).toLowerCase();
    if (!id || !MIME[format]) return null;
    const name = basename(text(row.bookPath) ?? "") || `${text(row.title) ?? id}.${format}`;
    file = { id, name: READABLE.test(name) ? name : `${name}.${format}`, mimeType: MIME[format]!, resourceKey: text(row.resourceKey) };
  }
  const title = catalogTitle(row, file.name), author = text(row.author) ?? "";
  const synopsis = text(row.synopsis) ?? text(row.summary) ?? text(row.description);
  const coverUrl = https(row.coverUrl);
  const declaredCover = text(row.coverDriveFileId);
  const cover = byId(coverFiles, declaredCover) ?? byName(coverFiles, text(row.coverPath));
  // The URL is shown first; the cover file's id is kept too, so a device that cannot load that
  // URL makes the cover from the file itself.
  if (coverUrl) return { file, title, author, synopsis, coverUrl, coverDriveFileId: cover?.id ?? declaredCover, coverSource: "coverUrl" };
  if (cover) return { file, title, author, synopsis, coverUrl: driveThumbnailUrl(cover.id, cover.id), coverDriveFileId: cover.id, coverSource: cover.id === declaredCover ? "coverDriveFileId" : "coverPath" };
  if (declaredCover) return { file, title, author, synopsis, coverUrl: driveThumbnailUrl(declaredCover, declaredCover), coverDriveFileId: declaredCover, coverSource: "coverDriveFileId" };
  return { file, title, author, synopsis, coverUrl: "", coverSource: "placeholder" };
}

/** Bumped when reading a catalog changes what is stored for its books; book sources read
 *  with older rules are read once again. 1: titles that are ids or slugs give way to sourceName. */
export const PERSONAL_DRIVE_CATALOG_RULES = 1;

/** The title people read. Some catalogs carry the EPUB's own metadata title, which can be a
 *  hash or a slug ("1b95f813d4e0…", "ConfissoesdoHomemErotico2"); the original file name
 *  (sourceName, "Confissões do Homem Erótico.epub") then names the book. The record stays the
 *  same - file, cover and synopsis keep their ids. */
export function catalogTitle(row: CatalogRow, fileName: string): string {
  const declared = text(row.title), sourceName = text(row.sourceName), original = sourceName ? stem(basename(sourceName)) : undefined;
  if (declared && !looksLikeCode(declared)) return declared;
  if (original && !looksLikeCode(original)) return original;
  return declared ?? original ?? stem(fileName);
}

/** An id or a slug rather than a title: long hex, "bk_<hash>", or one long token joined by
 *  hyphens, underscores, digits or camel case. */
function looksLikeCode(value: string): boolean {
  const clean = value.trim();
  if (/^(bk[_\s-]?)?[0-9a-f]{16,}$/i.test(clean)) return true;
  if (/\s/.test(clean)) return false;
  return clean.length >= 16 && /[-_\d]|[a-z][A-Z]/.test(clean);
}

/** A bare array of records or { books: [...] }; anything else is not a catalog. */
export function catalogRows(document: unknown): CatalogRow[] | null {
  const values = Array.isArray(document) ? document : document && typeof document === "object" ? (document as { books?: unknown }).books : null;
  return Array.isArray(values) ? values.filter((value): value is CatalogRow => Boolean(value) && typeof value === "object") : null;
}

function structureOf(name: string, folderId: string, resourceKey: string | undefined, children: readonly GoogleLibraryFile[]): DriveCatalogCategory | null {
  const folder = (wanted: string) => children.find(item => item.mimeType === GoogleDriveLibraryService.FOLDER && fold(item.name) === wanted);
  const catalog = children.find(item => item.mimeType !== GoogleDriveLibraryService.FOLDER && item.name.toLocaleLowerCase("en-US") === "catalog.json");
  const books = folder("books");
  return books && catalog ? { name, folderId, resourceKey, books, covers: folder("covers"), catalog } : null;
}

async function listAll(api: DriveCatalogApi, folderId: string, key: string | undefined, signal: AbortSignal): Promise<GoogleLibraryFile[]> {
  const files: GoogleLibraryFile[] = []; let pageToken: string | undefined;
  do {
    // books/ and covers/ hold thousands of files: Drive's largest page keeps it to a few requests.
    const page = await api.listRaw(folderId, key, signal, pageToken, 1000);
    files.push(...page.files); pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function https(value: unknown): string | undefined { const raw = text(value); try { const url = raw ? new URL(raw) : null; return url?.protocol === "https:" ? url.href : undefined; } catch { return undefined; } }
function basename(value: string): string { const last = value.split("?")[0]!.split(/[\\/]/).pop() ?? ""; try { return decodeURIComponent(last); } catch { return last; } }
function stem(value: string): string { return value.replace(/\.[^.]+$/, ""); }
function extension(value: string): string { return /\.([a-z0-9]+)$/i.exec(value)?.[1] ?? ""; }
function fold(value: string): string { return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim(); }
function driveIdFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return url.searchParams.get("id") ?? /\/d\/([\w-]+)/.exec(url.pathname)?.[1] ?? undefined; } catch { return undefined; }
}
