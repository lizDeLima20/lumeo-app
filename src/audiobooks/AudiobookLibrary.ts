import type { GoogleDriveLibraryEntry, GoogleDriveLibrarySource } from "../external/GoogleDriveLibraryRepository";

export interface AudiobookChapter {
  id: string; sourceId: string; fileId: string; name: string; title: string; mimeType: string; size?: string; modifiedTime?: string; resourceKey?: string;
  collection: string; volume?: string; folderPath: string[]; thumbnailUrl?: string; coverUrl?: string;
}
export interface AudiobookCollection { id: string; title: string; chapters: AudiobookChapter[]; }

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
export function collectionsFromDrive(sources: readonly GoogleDriveLibrarySource[], entries: readonly GoogleDriveLibraryEntry[]): AudiobookCollection[] {
  const bySource = new Map(sources.filter(isAudiobookSource).map(source => [source.id, source]));
  const collections = new Map<string, AudiobookCollection>();
  for (const entry of entries) { const source = bySource.get(entry.sourceId); if (!source || entry.contentType !== "audiobook") continue;
    const chapter = chapterFromEntry(entry, source), collection = collections.get(source.id) ?? { id: source.id, title: chapter.collection, chapters: [] };
    collection.chapters.push(chapter); collections.set(source.id, collection);
  }
  return [...collections.values()].map(collection => ({ ...collection, chapters: [...collection.chapters].sort(naturalChapterOrder) })).sort((a, b) => a.title.localeCompare(b.title, "pt-BR", { numeric: true }));
}
export function naturalChapterOrder(a: Pick<AudiobookChapter, "volume" | "title" | "name">, b: Pick<AudiobookChapter, "volume" | "title" | "name">): number {
  return `${a.volume ?? ""}\u0000${a.title || a.name}`.localeCompare(`${b.volume ?? ""}\u0000${b.title || b.name}`, "pt-BR", { numeric: true, sensitivity: "base" });
}
export function stripExtension(value: string): string { return value.replace(/\.(mp3|m4a|aac|ogg|opus|wav)$/i, ""); }
