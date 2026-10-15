import { GoogleDriveLibraryService, type GoogleLibraryFile } from "../external/GoogleDriveLibraryService";
import type { GoogleDriveLibraryEntry, GoogleDriveLibrarySource, GoogleDriveLibrarySyncState, GoogleDriveSyncTask } from "../external/GoogleDriveLibraryRepository";
import { resolvePersonalDriveGenre } from "./PersonalDriveGenreResolver";
import { PersonalDriveCatalogResolver, driveThumbnailUrl } from "./PersonalDriveCatalogResolver";
import { describeDriveFolder, readDriveCatalogCategory, type DriveFolderDescription } from "./PersonalDriveCatalogSource";
import { GoogleDriveLibraryRepository } from "../external/GoogleDriveLibraryRepository";

/** Bumped when listing learns something new; an older completed sync is redone once. v2 reads
 *  structured catalog folders (books/ + covers/ + catalog.json). */
export const PERSONAL_DRIVE_SYNC_VERSION = 2;

export interface PersonalDriveListingProgress { folders: number; files: number; current: string; }
const METADATA_BATCH_SIZE = 24;

/** Page-by-page Drive walker. The caller checkpoints every page before continuing, so an
 * interrupted foreground sync resumes without ever queuing book downloads. */
export class PersonalDriveLibraryService {
  public constructor(private readonly drive: GoogleDriveLibraryService) {}

  /** Reads a pasted folder link before it is saved: its real name and whether it is a
   *  structured catalog source (then always Livros, one genre per category). */
  public async describeLink(link: string, signal: AbortSignal): Promise<DriveFolderDescription> {
    const parsed = GoogleDriveLibraryRepository.parse(link), key = keyOf(parsed.folderUrl);
    await this.drive.prepare(); if (!this.drive.authorized) await this.drive.connect();
    const root = await this.drive.metadata(parsed.folderId, key, signal);
    if (root.mimeType !== GoogleDriveLibraryService.FOLDER) throw new Error("DRIVE_LINK_NOT_FOLDER");
    return describeDriveFolder(this.drive, root, key, signal);
  }

  /** Lists a source page by page. Resolves with the folder's real name. */
  public async listProgressively(source: GoogleDriveLibrarySource, existing: readonly GoogleDriveLibraryEntry[], resume: GoogleDriveLibrarySyncState | null,
    signal: AbortSignal, page: (entries: GoogleDriveLibraryEntry[], state: GoogleDriveLibrarySyncState, progress: PersonalDriveListingProgress) => Promise<void>): Promise<{ folderName: string }> {
    console.info(JSON.stringify({ event: "PERSONAL_DRIVE_SYNC_STARTED", sourceId: source.id, resumed: Boolean(resume?.queue.length) }));
    await this.drive.prepare(); if (!this.drive.authorized) await this.drive.connect();
    const root = await this.drive.metadata(source.folderId, resourceKey(source), signal);
    if (root.mimeType !== GoogleDriveLibraryService.FOLDER) throw new Error("DRIVE_LINK_NOT_FOLDER");
    // Structured catalog folders first: books/ + covers/ + catalog.json at the root, or in each
    // subfolder. Those books carry their real titles, synopses and covers; the generic folder
    // walk below would only see bare files and treat books/ and covers/ as genres.
    const resumable = Boolean(resume?.queue.length) && !resume?.completed && resume?.version === PERSONAL_DRIVE_SYNC_VERSION;
    if (!resumable && typeof this.drive.listRaw === "function" && typeof this.drive.json === "function") {
      const description = await describeDriveFolder(this.drive, root, resourceKey(source), signal);
      if (description.categories.length) {
        let total = 0;
        for (const category of description.categories) {
          if (signal.aborted) throw new DOMException("Listagem cancelada.", "AbortError");
          const { entries } = await readDriveCatalogCategory(this.drive, category, source.id, "book", signal);
          total += entries.length;
          await page(entries, { queue: [], completed: false, version: PERSONAL_DRIVE_SYNC_VERSION, folders: description.categories.length, files: total,
            current: category.name, updatedAt: new Date().toISOString() }, { folders: description.categories.length, files: total, current: category.name });
        }
        await page([], { queue: [], completed: true, version: PERSONAL_DRIVE_SYNC_VERSION, folders: description.categories.length, files: total,
          current: root.name, updatedAt: new Date().toISOString() }, { folders: description.categories.length, files: total, current: root.name });
        console.info(JSON.stringify({ event: "PERSONAL_DRIVE_SYNC_FINISHED", sourceId: source.id, files: total, catalogs: description.categories.length }));
        return { folderName: root.name };
      }
    }
    const seen = new Set(existing.map(entry => entry.fileId)); let folders = resume?.folders ?? 0, files = Math.max(existing.length, resume?.files ?? 0);
    const state: GoogleDriveLibrarySyncState = resumable && resume ? { ...resume, queue: [...resume.queue], completed: false } : {
      version: PERSONAL_DRIVE_SYNC_VERSION,
      queue: [{ folderId: root.id, genre: /^Link\s+\d+$/i.test(source.name) ? resolvePersonalDriveGenre(root.name) : source.name || resolvePersonalDriveGenre(root.name), resourceKey: root.resourceKey ?? resourceKey(source), collectionPath: [] }], completed: false,
      folders, files, current: root.name, updatedAt: new Date().toISOString(),
    };
    // The first durable checkpoint exists before the first potentially long Drive page.
    await page([], { ...state, queue: [...state.queue] }, { folders, files, current: state.current ?? root.name });
    while (state.queue.length) {
      if (signal.aborted) throw new DOMException("Listagem cancelada.", "AbortError");
      const task = state.queue[0]!;
      // Resolve catalog.json before exposing the folder's books. The prior server did this
      // centrally; the personal edition does it locally through the same authorised API.
      const compatibleDrive = this.drive as GoogleDriveLibraryService & { listRaw?: GoogleDriveLibraryService["listRaw"]; childNamed?: GoogleDriveLibraryService["childNamed"] };
      const raw = compatibleDrive.listRaw ? await compatibleDrive.listRaw(task.folderId, task.resourceKey, signal, task.pageToken) : await this.drive.list(task.folderId, task.resourceKey, signal, task.pageToken);
      const listing = { ...raw, files: raw.files.filter(item => item.mimeType === GoogleDriveLibraryService.FOLDER || /\.(pdf|epub|cbr|cbz)$/i.test(item.name)) };
      const catalogFile = task.pageToken ? null : compatibleDrive.childNamed ? await compatibleDrive.childNamed(task.folderId, "catalog.json", task.resourceKey, signal) : raw.files.find(item => item.name.toLocaleLowerCase("en-US") === "catalog.json") ?? null;
      let catalog: PersonalDriveCatalogResolver | null = null;
      if (catalogFile) {
        try { catalog = new PersonalDriveCatalogResolver(await this.drive.json(catalogFile, signal), raw.files); }
        catch (error) { console.warn(JSON.stringify({ event: "DRIVE_CATALOG_INVALID", sourceId: source.id, folderId: task.folderId, reason: error instanceof Error ? error.message : "unknown" })); }
      }
      const entries: GoogleDriveLibraryEntry[] = [], children: GoogleDriveSyncTask[] = []; const foldersBeforePage = folders;
      for (const item of listing.files) {
        if (item.mimeType === GoogleDriveLibraryService.FOLDER) { folders++; children.push({ folderId: item.id, genre: source.contentType === "comic" ? task.genre : resolvePersonalDriveGenre(item.name), resourceKey: item.resourceKey, collectionPath: [...(task.collectionPath ?? []), item.name] }); }
        else if (!seen.has(item.id)) { seen.add(item.id); entries.push(toEntry(source.id, item, task.genre, source.contentType ?? "book", task.collectionPath ?? [], catalog?.resolve(item) ?? undefined)); }
      }
      const nextQueue = state.queue.slice(1);
      if (listing.nextPageToken) nextQueue.unshift({ ...task, pageToken: listing.nextPageToken });
      nextQueue.push(...children);
      console.info(JSON.stringify({ event: "PERSONAL_DRIVE_PAGE_LISTED", sourceId: source.id, files: entries.length, queuedFolders: state.queue.length, hasNextPage: Boolean(listing.nextPageToken) }));
      const batchSize = entries.length <= METADATA_BATCH_SIZE ? 8 : METADATA_BATCH_SIZE;
      const chunks = entries.length ? Array.from({ length: Math.ceil(entries.length / batchSize) }, (_, index) => entries.slice(index * batchSize, (index + 1) * batchSize)) : [[]];
      for (let index = 0; index < chunks.length; index++) {
        if (signal.aborted) throw new DOMException("Listagem cancelada.", "AbortError");
        const chunk = chunks[index]!; files += chunk.length;
        const last = index === chunks.length - 1;
        const checkpoint: GoogleDriveLibrarySyncState = { version: PERSONAL_DRIVE_SYNC_VERSION, queue: last ? [...nextQueue] : [...state.queue], completed: last && nextQueue.length === 0,
          folders: last ? folders : foldersBeforePage, files, current: chunk.at(-1)?.name ?? listing.files.at(-1)?.name ?? task.genre, updatedAt: new Date().toISOString() };
        await page(chunk, checkpoint, { folders: checkpoint.folders ?? folders, files, current: checkpoint.current ?? task.genre });
        // Yield a browser task so even one small Drive response paints progressively.
        if (!last) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      state.queue = nextQueue; state.completed = nextQueue.length === 0; state.folders = folders; state.files = files; state.updatedAt = new Date().toISOString();
    }
    console.info(JSON.stringify({ event: "PERSONAL_DRIVE_SYNC_FINISHED", sourceId: source.id, files }));
    return { folderName: root.name };
  }
}
function keyOf(folderUrl: string): string | undefined { try { return new URL(folderUrl).searchParams.get("resourcekey") ?? undefined; } catch { return undefined; } }
function resourceKey(source: GoogleDriveLibrarySource): string | undefined { try { return new URL(source.folderUrl).searchParams.get("resourcekey") ?? undefined; } catch { return undefined; } }
function toEntry(sourceId: string, file: GoogleLibraryFile, genre: string, contentType: "book" | "comic", collectionPath: string[], metadata?: ReturnType<PersonalDriveCatalogResolver["resolve"]>): GoogleDriveLibraryEntry {
  const value = metadata ?? undefined, resolvedGenre = value?.genre ? resolvePersonalDriveGenre(value.genre) : genre;
  const coverUrl = value?.coverUrl ?? driveThumbnailUrl(value?.coverDriveFileId, file.id);
  return { sourceId, fileId: file.id, name: file.name, mimeType: file.mimeType, size: file.size, modifiedTime: file.modifiedTime, resourceKey: file.resourceKey,
    genre: resolvedGenre, contentType, collectionPath, title: value?.title, author: value?.author, synopsis: value?.synopsis,
    coverUrl, coverDriveFileId: value?.coverDriveFileId, thumbnailUrl: coverUrl };
}
