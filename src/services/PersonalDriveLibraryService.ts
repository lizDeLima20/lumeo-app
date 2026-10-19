import { GoogleDriveAccessError, GoogleDriveLibraryService, type GoogleLibraryFile } from "../external/GoogleDriveLibraryService";
import type { GoogleDriveFolderNode, GoogleDriveLibraryEntry, GoogleDriveLibrarySource, GoogleDriveLibrarySyncState, GoogleDriveSyncTask } from "../external/GoogleDriveLibraryRepository";
import { resolvePersonalDriveGenre } from "./PersonalDriveGenreResolver";
import { PersonalDriveCatalogResolver, driveThumbnailUrl } from "./PersonalDriveCatalogResolver";
import { PERSONAL_DRIVE_CATALOG_RULES, describeDriveFolder, readDriveCatalogCategory, type DriveFolderDescription } from "./PersonalDriveCatalogSource";
import { GoogleDriveLibraryRepository } from "../external/GoogleDriveLibraryRepository";

/** Bumped when listing learns something new; an older completed sync is redone once.
 *  v2 read structured catalog folders (books/ + covers/ + catalog.json).
 *  v3 keeps Drive's real folder tree: one category per source, every subfolder a child.
 *  v4 accepts catalog.json above 4 MB (those sources were listed as empty). */
export const PERSONAL_DRIVE_SYNC_VERSION = 5;

export interface PersonalDriveListingProgress { folders: number; files: number; current: string; }
export interface PersonalDriveListingOptions {
  /** The folder the person has open: listed next, before the rest of the queue. */
  priority?: () => string | null;
  /** Waits before listing a folder again after a dropped connection (default 1 s, then 3 s). */
  retryDelaysMs?: readonly number[];
}
type PageCallback = (entries: GoogleDriveLibraryEntry[], state: GoogleDriveLibrarySyncState, progress: PersonalDriveListingProgress,
  folders: GoogleDriveFolderNode[]) => Promise<void>;
const METADATA_BATCH_SIZE = 24;
const READABLE_BOOK = /\.(pdf|epub|cbr|cbz)$/i;
/** Audio is listed as metadata only. Playback is the only operation that downloads a chapter. */
export const READABLE_AUDIO = /\.(mp3|m4a|aac|ogg|opus|wav)$/i;
export function isReadableForSource(name: string, contentType: GoogleDriveLibrarySource["contentType"]): boolean {
  return contentType === "audiobook" ? READABLE_AUDIO.test(name) : READABLE_BOOK.test(name);
}

/**
 * Page-by-page Drive walker. The caller checkpoints every page before continuing, so an
 * interrupted foreground sync resumes without ever queuing book downloads.
 *
 * A source is ONE category (its display name). Its folders keep Drive's hierarchy at any
 * depth: each listed folder becomes a node with its parent, and each file records the folder
 * that holds it, so the Explore screen navigates the real tree. Nothing is downloaded.
 */
export class PersonalDriveLibraryService {
  public constructor(private readonly drive: GoogleDriveLibraryService) {}

  /** Reads a pasted folder link before it is saved: its real name and whether it holds a
   *  structured catalog (books/ + covers/ + catalog.json). */
  public async describeLink(link: string, signal: AbortSignal): Promise<DriveFolderDescription> {
    const parsed = GoogleDriveLibraryRepository.parse(link), key = keyOf(parsed.folderUrl);
    await this.drive.prepare(); if (!this.drive.authorized) await this.drive.connect();
    const root = await this.drive.metadata(parsed.folderId, key, signal);
    if (root.mimeType !== GoogleDriveLibraryService.FOLDER) throw new Error("DRIVE_LINK_NOT_FOLDER");
    return describeDriveFolder(this.drive, root, key, signal);
  }

  /** The folder's real name, from its metadata alone (one request). Adding a source needs
   *  nothing more: catalogs inside it are recognised while it syncs. */
  public async folderName(link: string, signal: AbortSignal): Promise<string> {
    const parsed = GoogleDriveLibraryRepository.parse(link);
    await this.drive.prepare(); if (!this.drive.authorized) await this.drive.connect();
    const root = await this.drive.metadata(parsed.folderId, keyOf(parsed.folderUrl), signal);
    if (root.mimeType !== GoogleDriveLibraryService.FOLDER) throw new Error("DRIVE_LINK_NOT_FOLDER");
    return root.name;
  }

  /** Lists a source page by page. Resolves with the folder's real name. */
  public async listProgressively(source: GoogleDriveLibrarySource, existing: readonly GoogleDriveLibraryEntry[], resume: GoogleDriveLibrarySyncState | null,
    signal: AbortSignal, page: PageCallback, options: PersonalDriveListingOptions = {}): Promise<{ folderName: string }> {
    console.info(JSON.stringify({ event: "PERSONAL_DRIVE_SYNC_STARTED", sourceId: source.id, resumed: Boolean(resume?.queue.length) }));
    await this.drive.prepare(); if (!this.drive.authorized) await this.drive.connect();
    const root = await this.drive.metadata(source.folderId, resourceKey(source), signal);
    if (root.mimeType !== GoogleDriveLibraryService.FOLDER) throw new Error("DRIVE_LINK_NOT_FOLDER");
    // The one category of this source: the name the person chose, else the folder's own.
    const category = (/^Link\s+\d+$/i.test(source.name) ? "" : source.name.trim()) || root.name.trim() || resolvePersonalDriveGenre(root.name);
    const contentType = source.contentType ?? "book";
    const rootNode: GoogleDriveFolderNode = { sourceId: source.id, folderId: root.id, parentFolderId: null, name: category, depth: 0, resourceKey: root.resourceKey ?? resourceKey(source) };

    // Structured catalog folders (books/ + covers/ + catalog.json) are recognised while
    // walking, in whichever folder they are - the root or any subfolder - so the tree stays
    // one category and nothing is listed twice.
    const resumable = Boolean(resume?.queue.length) && !resume?.completed && resume?.version === PERSONAL_DRIVE_SYNC_VERSION;
    const known = new Set(existing.map(entry => entry.fileId)), seen = new Set(known), catalogued = new Set<string>(); let folders = resume?.folders ?? 0, files = Math.max(existing.length, resume?.files ?? 0);
    const state: GoogleDriveLibrarySyncState = resumable && resume ? { ...resume, queue: [...resume.queue], completed: false } : {
      version: PERSONAL_DRIVE_SYNC_VERSION, catalogRules: PERSONAL_DRIVE_CATALOG_RULES,
      queue: [{ folderId: root.id, genre: category, resourceKey: rootNode.resourceKey, collectionPath: [], folderPath: [] }], completed: false,
      folders, files, current: root.name, updatedAt: new Date().toISOString(),
    };
    // Every folder ever queued in this run (or still queued from a resumed one): never twice.
    const queued = new Set(state.queue.map(task => task.folderId));
    // The first durable checkpoint exists before the first potentially long Drive page.
    await page([], { ...state, queue: [...state.queue] }, { folders, files, current: state.current ?? root.name }, [rootNode]);
    while (state.queue.length) {
      if (signal.aborted) throw new DOMException("Listagem cancelada.", "AbortError");
      // The folder open on screen jumps the queue (its first page, or its next one).
      const wanted = options.priority?.();
      if (wanted) { const at = state.queue.findIndex(task => task.folderId === wanted); if (at > 0) state.queue.unshift(...state.queue.splice(at, 1)); }
      const task = state.queue[0]!;
      const depth = task.folderPath?.length ?? 0;
      const node: GoogleDriveFolderNode = task.folderId === root.id ? rootNode : { sourceId: source.id, folderId: task.folderId,
        parentFolderId: task.folderPath && task.folderPath.length > 1 ? task.folderPath[task.folderPath.length - 2]!.id : root.id,
        name: task.folderPath?.at(-1)?.name ?? task.genre, depth, resourceKey: task.resourceKey };
      const compatibleDrive = this.drive as GoogleDriveLibraryService & { listRaw?: GoogleDriveLibraryService["listRaw"]; childNamed?: GoogleDriveLibraryService["childNamed"] };
      let raw: { files: GoogleLibraryFile[]; nextPageToken?: string };
      const listOnce = () => compatibleDrive.listRaw ? compatibleDrive.listRaw(task.folderId, task.resourceKey, signal, task.pageToken) : this.drive.list(task.folderId, task.resourceKey, signal, task.pageToken);
      try {
        // A dropped connection is retried; a folder is marked inaccessible only when Drive says so
        // or the network keeps failing.
        for (let attempt = 0; ; attempt++) {
          try { raw = await listOnce(); break; }
          catch (error) {
            const wait = (options.retryDelaysMs ?? [1_000, 3_000])[attempt];
            if (wait === undefined || signal.aborted || !(error instanceof GoogleDriveAccessError) || error.code !== "DRIVE_CONNECTION_FAILED") throw error;
            console.warn(JSON.stringify({ event: "PERSONAL_DRIVE_FOLDER_RETRY", sourceId: source.id, folderId: task.folderId, attempt: attempt + 1 }));
            await new Promise(resolve => setTimeout(resolve, wait));
          }
        }
      } catch (error) {
        // An inaccessible subfolder is marked and skipped; only the root stops the source.
        if (task.folderId === root.id || signal.aborted || !(error instanceof GoogleDriveAccessError)) throw error;
        console.warn(JSON.stringify({ event: "PERSONAL_DRIVE_FOLDER_SKIPPED", sourceId: source.id, folderId: task.folderId, reason: error.code }));
        state.queue = state.queue.slice(1);
        const skipped: GoogleDriveLibrarySyncState = { ...state, queue: [...state.queue], completed: state.queue.length === 0, version: PERSONAL_DRIVE_SYNC_VERSION, updatedAt: new Date().toISOString() };
        await page([], skipped, { folders, files, current: node.name }, [{ ...node, listed: true, error: error.code }]);
        continue;
      }
      const listing = { ...raw, files: raw.files.filter(item => item.mimeType === GoogleDriveLibraryService.FOLDER || isReadableForSource(item.name, contentType)) };
      // A folder's own cover is optional metadata, never a chapter and never a download.
      // Drive gives image thumbnails in the same listing; use only clear cover names so a
      // random illustration cannot silently become the collection art.
      const audioFolderCover = contentType === "audiobook" ? raw.files.find(item => /^(cover|capa|folder|front)(?:[ ._-]|$).*\.(jpe?g|png|webp)$/i.test(item.name) && Boolean(item.thumbnailLink)) : undefined;
      const catalogFile = task.pageToken ? null : compatibleDrive.childNamed ? await compatibleDrive.childNamed(task.folderId, "catalog.json", task.resourceKey, signal) : raw.files.find(item => item.name.toLocaleLowerCase("en-US") === "catalog.json") ?? null;
      let catalog: PersonalDriveCatalogResolver | null = null;
      if (catalogFile && contentType !== "audiobook") {
        try { catalog = new PersonalDriveCatalogResolver(await this.drive.json(catalogFile, signal), raw.files); }
        catch (error) { console.warn(JSON.stringify({ event: "DRIVE_CATALOG_INVALID", sourceId: source.id, folderId: task.folderId, reason: error instanceof Error ? error.message : "unknown" })); }
      }
      const entries: GoogleDriveLibraryEntry[] = [], children: GoogleDriveSyncTask[] = [], childNodes: GoogleDriveFolderNode[] = []; const foldersBeforePage = folders;
      const path = task.folderPath ?? [];
      // A catalog folder: its books come from catalog.json with real titles, synopses and
      // covers; its books/ and covers/ folders are storage, not folders to browse.
      const structure = contentType === "audiobook" || task.pageToken ? null : catalogStructure(raw.files);
      if (structure && typeof this.drive.json === "function") {
        try {
          const { entries: records } = await readDriveCatalogCategory(this.drive, { name: node.name, folderId: task.folderId, resourceKey: task.resourceKey, ...structure },
            source.id, contentType, signal, { genre: category, parentFolderId: task.folderId, folderPath: path });
          // Catalog records are written again even when already cached: a re-read brings their
          // corrected titles, covers and synopses (stored by file id, never duplicated).
          for (const entry of records) if (!catalogued.has(entry.fileId)) { catalogued.add(entry.fileId); seen.add(entry.fileId); entries.push(entry); }
        } catch (error) { console.warn(JSON.stringify({ event: "DRIVE_CATALOG_INVALID", sourceId: source.id, folderId: task.folderId, reason: error instanceof Error ? error.message : "unknown" })); }
      }
      for (const item of listing.files) {
        if (structure && (item.id === structure.books.id || item.id === structure.covers?.id)) continue;
        if (item.mimeType === GoogleDriveLibraryService.FOLDER) {
          if (queued.has(item.id)) continue;
          queued.add(item.id); folders++;
          const childPath = [...path, { id: item.id, name: item.name }];
          children.push({ folderId: item.id, genre: category, resourceKey: item.resourceKey, collectionPath: childPath.map(step => step.name), folderPath: childPath });
          childNodes.push({ sourceId: source.id, folderId: item.id, parentFolderId: task.folderId, name: item.name, depth: childPath.length, resourceKey: item.resourceKey });
        } else if (!seen.has(item.id)) {
          seen.add(item.id);
          const entry = toEntry(source.id, item, category, contentType, task.folderId, path, catalog?.resolve(item) ?? undefined);
          if (audioFolderCover?.thumbnailLink && !entry.coverUrl) { entry.coverUrl = audioFolderCover.thumbnailLink; entry.thumbnailUrl = audioFolderCover.thumbnailLink; }
          entries.push(entry);
        }
      }
      const nextQueue = state.queue.slice(1);
      if (listing.nextPageToken) nextQueue.unshift({ ...task, pageToken: listing.nextPageToken });
      nextQueue.push(...children);
      const finishedFolder = !listing.nextPageToken;
      console.info(JSON.stringify({ event: "PERSONAL_DRIVE_PAGE_LISTED", sourceId: source.id, folderId: task.folderId, depth, files: entries.length, subfolders: children.length, queuedFolders: nextQueue.length, hasNextPage: !finishedFolder }));
      const pageNodes = [{ ...node, listed: finishedFolder }, ...childNodes];
      const batchSize = entries.length <= METADATA_BATCH_SIZE ? 8 : METADATA_BATCH_SIZE;
      const chunks = entries.length ? Array.from({ length: Math.ceil(entries.length / batchSize) }, (_, index) => entries.slice(index * batchSize, (index + 1) * batchSize)) : [[]];
      for (let index = 0; index < chunks.length; index++) {
        if (signal.aborted) throw new DOMException("Listagem cancelada.", "AbortError");
        const chunk = chunks[index]!; files += chunk.filter(entry => !known.has(entry.fileId)).length;
        const last = index === chunks.length - 1;
        const checkpoint: GoogleDriveLibrarySyncState = { version: PERSONAL_DRIVE_SYNC_VERSION, catalogRules: state.catalogRules ?? PERSONAL_DRIVE_CATALOG_RULES, queue: last ? [...nextQueue] : [...state.queue], completed: last && nextQueue.length === 0,
          folders: last ? folders : foldersBeforePage, files, current: chunk.at(-1)?.name ?? listing.files.at(-1)?.name ?? node.name, updatedAt: new Date().toISOString() };
        await page(chunk, checkpoint, { folders: checkpoint.folders ?? folders, files, current: checkpoint.current ?? node.name }, last ? pageNodes : []);
        // Yield a browser task so even one small Drive response paints progressively.
        if (!last) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      state.queue = nextQueue; state.completed = nextQueue.length === 0; state.folders = folders; state.files = files; state.updatedAt = new Date().toISOString();
    }
    console.info(JSON.stringify({ event: "PERSONAL_DRIVE_SYNC_FINISHED", sourceId: source.id, files, folders }));
    return { folderName: root.name };
  }
}
/** books/ + catalog.json (covers/ optional) among a folder's children. */
function catalogStructure(children: readonly GoogleLibraryFile[]): { books: GoogleLibraryFile; covers?: GoogleLibraryFile; catalog: GoogleLibraryFile } | null {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim();
  const books = children.find(item => item.mimeType === GoogleDriveLibraryService.FOLDER && fold(item.name) === "books");
  const covers = children.find(item => item.mimeType === GoogleDriveLibraryService.FOLDER && fold(item.name) === "covers");
  const catalog = children.find(item => item.mimeType !== GoogleDriveLibraryService.FOLDER && item.name.toLocaleLowerCase("en-US") === "catalog.json");
  return books && catalog ? { books, covers, catalog } : null;
}
function keyOf(folderUrl: string): string | undefined { try { return new URL(folderUrl).searchParams.get("resourcekey") ?? undefined; } catch { return undefined; } }
function resourceKey(source: GoogleDriveLibrarySource): string | undefined { return keyOf(source.folderUrl); }
function toEntry(sourceId: string, file: GoogleLibraryFile, genre: string, contentType: GoogleDriveLibrarySource["contentType"], parentFolderId: string,
  folderPath: Array<{ id: string; name: string }>, metadata?: ReturnType<PersonalDriveCatalogResolver["resolve"]>): GoogleDriveLibraryEntry {
  const value = metadata ?? undefined;
  // Only a catalog's own cover is used as a URL here; anything else is resolved and cached by
  // the cover resolver (Drive's thumbnail, the first page, or the placeholder).
  const coverUrl = value?.coverUrl ?? (value?.coverDriveFileId ? driveThumbnailUrl(value.coverDriveFileId, file.id) : undefined);
  return { sourceId, fileId: file.id, name: file.name, mimeType: file.mimeType, size: file.size, modifiedTime: file.modifiedTime, resourceKey: file.resourceKey,
    genre, contentType, collectionPath: folderPath.map(step => step.name), parentFolderId, folderPath, thumbnailLink: file.thumbnailLink,
    title: value?.title, author: value?.author, synopsis: value?.synopsis, coverUrl, coverDriveFileId: value?.coverDriveFileId, thumbnailUrl: coverUrl ?? "" };
}
