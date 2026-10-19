import type { GoogleDriveLibraryEntry, GoogleDriveLibrarySource } from "../external/GoogleDriveLibraryRepository";

export interface AudiobookChapter {
  id: string; sourceId: string; fileId: string; name: string; title: string; mimeType: string; size?: string; modifiedTime?: string; resourceKey?: string;
  collection: string; volume?: string; folderPath: string[]; thumbnailUrl?: string; coverUrl?: string;
}
/** Where a collection stands: its chapters are listed, still being listed, the folder has no
 *  playable audio, or Drive refused or failed the listing. */
export type AudiobookCollectionStatus = "ready" | "syncing" | "empty" | "error";
export interface AudiobookCollection { id: string; title: string; chapters: AudiobookChapter[]; status?: AudiobookCollectionStatus; message?: string; }
export interface AudiobookSourceState { status: Exclude<AudiobookCollectionStatus, "ready" | "empty">; message?: string; }

export function isAudiobookSource(source: GoogleDriveLibrarySource): boolean { return source.contentType === "audiobook"; }
export function chapterFromEntry(entry: GoogleDriveLibraryEntry, source: GoogleDriveLibrarySource): AudiobookChapter {
  const path = entry.collectionPath ?? [], folderPath = entry.folderPath?.map(step => step.name) ?? path;
  // The source/root is the collection title; nested folders are volumes. This preserves all
  // Drive levels while keeping one listener-friendly collection card.
  const collection = source.name || source.driveName || "Audiolivro";
  return { id: `audio:${entry.sourceId}:${entry.fileId}`, sourceId: entry.sourceId, fileId: entry.fileId, name: entry.name,
    title: stripExtension(entry.title?.trim() || entry.name), mimeType: entry.mimeType, size: entry.size, modifiedTime: entry.modifiedTime,
    resourceKey: entry.resourceKey, collection, volume: folderPath.length ? folderPath.join(" › ") : undefined, folderPath,
    thumbnailUrl: entry.thumbnailLink || entry.thumbnailUrl || undefined, coverUrl: entry.coverUrl };
}
/**
 * One collection - one LP - for every active Audiolivros source, in the order they were added,
 * each with only its own chapters. A source is shown from the moment it is registered: while
 * its folder is still being listed, when it has no playable audio, or when Drive failed, its LP
 * says so instead of the source silently missing from the shelf.
 */
export function collectionsFromDrive(sources: readonly GoogleDriveLibrarySource[], entries: readonly GoogleDriveLibraryEntry[],
  states: ReadonlyMap<string, AudiobookSourceState> = new Map()): AudiobookCollection[] {
  const audio = sources.filter(isAudiobookSource);
  const collections = new Map<string, AudiobookCollection>(audio.map(source => [source.id, { id: source.id, title: source.name || source.driveName || "Audiolivro", chapters: [] }]));
  const bySource = new Map(audio.map(source => [source.id, source]));
  for (const entry of entries) { const source = bySource.get(entry.sourceId); if (!source || entry.contentType !== "audiobook") continue;
    collections.get(source.id)!.chapters.push(chapterFromEntry(entry, source));
  }
  return [...collections.values()].map(collection => {
    const state = states.get(collection.id), chapters = [...collection.chapters].sort(naturalChapterOrder);
    // Chapters already listed stay playable while a later page is still being read.
    const status: AudiobookCollectionStatus = state?.status === "syncing" ? "syncing" : chapters.length ? "ready" : state?.status === "error" ? "error" : "empty";
    return { ...collection, chapters, status, ...(state?.message ? { message: state.message } : {}) };
  });
}
export function naturalChapterOrder(a: Pick<AudiobookChapter, "volume" | "title" | "name">, b: Pick<AudiobookChapter, "volume" | "title" | "name">): number {
  return `${a.volume ?? ""}\u0000${a.title || a.name}`.localeCompare(`${b.volume ?? ""}\u0000${b.title || b.name}`, "pt-BR", { numeric: true, sensitivity: "base" });
}
export function stripExtension(value: string): string { return value.replace(/\.(mp3|m4a|m4b|aac|ogg|opus|wav|flac)$/i, ""); }
