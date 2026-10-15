import type { GoogleDriveFolderNode, GoogleDriveLibraryEntry } from "../external/GoogleDriveLibraryRepository";

/** Navigation over a source's cached Drive tree. Pure: the Explore screen asks it what to
 *  show for the folder that is open, never Drive itself. */
export function driveRootOf(nodes: readonly GoogleDriveFolderNode[], sourceId: string): GoogleDriveFolderNode | undefined {
  return nodes.find(node => node.sourceId === sourceId && node.parentFolderId === null);
}

/** Direct subfolders, in natural order ("Vol. 2" before "Vol. 10"), each once. */
export function driveChildFolders(nodes: readonly GoogleDriveFolderNode[], folderId: string): GoogleDriveFolderNode[] {
  const seen = new Set<string>();
  return nodes.filter(node => node.parentFolderId === folderId && !seen.has(node.folderId) && seen.add(node.folderId))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true, sensitivity: "base" }));
}

/** Files directly inside a folder, each once. Entries cached before folders were recorded
 *  (no parentFolderId) belong to their source's root. */
export function driveFilesIn(entries: readonly GoogleDriveLibraryEntry[], sourceId: string, folderId: string, rootId: string): GoogleDriveLibraryEntry[] {
  const seen = new Set<string>();
  return entries.filter(entry => entry.sourceId === sourceId && (entry.parentFolderId ?? rootId) === folderId && !seen.has(entry.fileId) && seen.add(entry.fileId))
    .sort((a, b) => (a.title ?? a.name).localeCompare(b.title ?? b.name, "pt-BR", { numeric: true, sensitivity: "base" }));
}

/** Breadcrumb from the root to the folder (inclusive). Stops on a missing or cyclic parent. */
export function driveTrail(nodes: readonly GoogleDriveFolderNode[], folderId: string): GoogleDriveFolderNode[] {
  const byId = new Map(nodes.map(node => [node.folderId, node])), trail: GoogleDriveFolderNode[] = [], visited = new Set<string>();
  for (let current = byId.get(folderId); current && !visited.has(current.folderId); current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined) {
    visited.add(current.folderId); trail.unshift(current);
  }
  return trail;
}
