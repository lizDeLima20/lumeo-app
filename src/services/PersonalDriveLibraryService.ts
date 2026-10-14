import { GoogleDriveLibraryService, type GoogleLibraryFile } from "../external/GoogleDriveLibraryService";
import type { GoogleDriveLibraryEntry, GoogleDriveLibrarySource, GoogleDriveLibrarySyncState, GoogleDriveSyncTask } from "../external/GoogleDriveLibraryRepository";
import { resolvePersonalDriveGenre } from "./PersonalDriveGenreResolver";

export interface PersonalDriveListingProgress { folders: number; files: number; current: string; }
const METADATA_BATCH_SIZE = 24;

/** Page-by-page Drive walker. The caller checkpoints every page before continuing, so an
 * interrupted foreground sync resumes without ever queuing book downloads. */
export class PersonalDriveLibraryService {
  public constructor(private readonly drive: GoogleDriveLibraryService) {}
  public async listProgressively(source: GoogleDriveLibrarySource, existing: readonly GoogleDriveLibraryEntry[], resume: GoogleDriveLibrarySyncState | null,
    signal: AbortSignal, page: (entries: GoogleDriveLibraryEntry[], state: GoogleDriveLibrarySyncState, progress: PersonalDriveListingProgress) => Promise<void>): Promise<void> {
    console.info(JSON.stringify({ event: "PERSONAL_DRIVE_SYNC_STARTED", sourceId: source.id, resumed: Boolean(resume?.queue.length) }));
    await this.drive.prepare(); if (!this.drive.authorized) await this.drive.connect();
    const root = await this.drive.metadata(source.folderId, resourceKey(source), signal);
    if (root.mimeType !== GoogleDriveLibraryService.FOLDER) throw new Error("DRIVE_LINK_NOT_FOLDER");
    const seen = new Set(existing.map(entry => entry.fileId)); let folders = resume?.folders ?? 0, files = Math.max(existing.length, resume?.files ?? 0);
    const state: GoogleDriveLibrarySyncState = resume?.queue.length && !resume.completed ? { ...resume, queue: [...resume.queue], completed: false } : {
      queue: [{ folderId: root.id, genre: resolvePersonalDriveGenre(root.name), resourceKey: root.resourceKey ?? resourceKey(source) }], completed: false,
      folders, files, current: root.name, updatedAt: new Date().toISOString(),
    };
    // The first durable checkpoint exists before the first potentially long Drive page.
    await page([], { ...state, queue: [...state.queue] }, { folders, files, current: state.current ?? root.name });
    while (state.queue.length) {
      if (signal.aborted) throw new DOMException("Listagem cancelada.", "AbortError");
      const task = state.queue[0]!;
      const listing = await this.drive.list(task.folderId, task.resourceKey, signal, task.pageToken);
      const entries: GoogleDriveLibraryEntry[] = [], children: GoogleDriveSyncTask[] = []; const foldersBeforePage = folders;
      for (const item of listing.files) {
        if (item.mimeType === GoogleDriveLibraryService.FOLDER) { folders++; children.push({ folderId: item.id, genre: resolvePersonalDriveGenre(item.name), resourceKey: item.resourceKey }); }
        else if (!seen.has(item.id)) { seen.add(item.id); entries.push(toEntry(source.id, item, task.genre, source.contentType ?? "book")); }
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
        const checkpoint: GoogleDriveLibrarySyncState = { queue: last ? [...nextQueue] : [...state.queue], completed: last && nextQueue.length === 0,
          folders: last ? folders : foldersBeforePage, files, current: chunk.at(-1)?.name ?? listing.files.at(-1)?.name ?? task.genre, updatedAt: new Date().toISOString() };
        await page(chunk, checkpoint, { folders: checkpoint.folders ?? folders, files, current: checkpoint.current ?? task.genre });
        // Yield a browser task so even one small Drive response paints progressively.
        if (!last) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      state.queue = nextQueue; state.completed = nextQueue.length === 0; state.folders = folders; state.files = files; state.updatedAt = new Date().toISOString();
    }
    console.info(JSON.stringify({ event: "PERSONAL_DRIVE_SYNC_FINISHED", sourceId: source.id, files }));
  }
}
function resourceKey(source: GoogleDriveLibrarySource): string | undefined { try { return new URL(source.folderUrl).searchParams.get("resourcekey") ?? undefined; } catch { return undefined; } }
function toEntry(sourceId: string, file: GoogleLibraryFile, genre: string, contentType: "book" | "comic"): GoogleDriveLibraryEntry { return { sourceId, fileId: file.id, name: file.name, mimeType: file.mimeType, size: file.size, modifiedTime: file.modifiedTime, resourceKey: file.resourceKey, genre, contentType, thumbnailUrl: `https://drive.google.com/thumbnail?id=${encodeURIComponent(file.id)}&sz=w400` }; }
