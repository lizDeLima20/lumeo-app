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

/** One section of the comic shelf: a folder, how deep it sits below the source, and its own files. */
export interface DriveSection { node: GoogleDriveFolderNode; depth: number; files: GoogleDriveLibraryEntry[]; }

/** The source's tree in reading order: each folder, then its subfolders in natural order, depth
 *  first. A folder is shown when it or a folder below it has files; one with no files of its own
 *  is only a title over its subfolders. A folder Drive refused is kept, so it can say so. */
export function driveSections(nodes: readonly GoogleDriveFolderNode[], entries: readonly GoogleDriveLibraryEntry[], sourceId: string, root: GoogleDriveFolderNode): DriveSection[] {
  const children = new Map<string, GoogleDriveFolderNode[]>(), seenFolders = new Set<string>([root.folderId]);
  for (const node of nodes) {
    if (node.sourceId !== sourceId || node.parentFolderId === null || seenFolders.has(node.folderId)) continue;
    seenFolders.add(node.folderId);
    const siblings = children.get(node.parentFolderId) ?? []; siblings.push(node); children.set(node.parentFolderId, siblings);
  }
  const files = new Map<string, GoogleDriveLibraryEntry[]>(), seenFiles = new Set<string>();
  for (const entry of entries) {
    if (entry.sourceId !== sourceId || seenFiles.has(entry.fileId)) continue;
    seenFiles.add(entry.fileId);
    const folder = entry.parentFolderId ?? root.folderId, list = files.get(folder) ?? []; list.push(entry); files.set(folder, list);
  }
  const natural = (a: string, b: string): number => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
  children.forEach(list => list.sort((a, b) => natural(a.name, b.name)));
  files.forEach(list => list.sort((a, b) => natural(a.title ?? a.name, b.title ?? b.name)));
  // Whether a folder's subtree holds any file, computed once per folder.
  const filled = new Map<string, boolean>();
  const hasFiles = (folderId: string, trail: Set<string>): boolean => {
    const known = filled.get(folderId); if (known !== undefined) return known;
    if (trail.has(folderId)) return false;
    trail.add(folderId);
    const value = Boolean(files.get(folderId)?.length) || (children.get(folderId) ?? []).some(child => hasFiles(child.folderId, trail));
    trail.delete(folderId); filled.set(folderId, value); return value;
  };
  const sections: DriveSection[] = [], visited = new Set<string>();
  const stack: Array<{ node: GoogleDriveFolderNode; depth: number }> = [{ node: root, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (visited.has(node.folderId)) continue;
    visited.add(node.folderId);
    if (node.folderId !== root.folderId && !node.error && !hasFiles(node.folderId, new Set())) continue;
    sections.push({ node, depth, files: files.get(node.folderId) ?? [] });
    const below = children.get(node.folderId) ?? [];
    for (let index = below.length - 1; index >= 0; index--) stack.push({ node: below[index]!, depth: depth + 1 });
  }
  return sections;
}

/** The first folder in reading order that was not listed yet: syncing it next fills the shelf
 *  from the top down. */
export function driveFirstUnlisted(nodes: readonly GoogleDriveFolderNode[], rootId: string): string | null {
  const children = new Map<string, GoogleDriveFolderNode[]>(), byId = new Map(nodes.map(node => [node.folderId, node]));
  for (const node of nodes) if (node.parentFolderId) { const list = children.get(node.parentFolderId) ?? []; list.push(node); children.set(node.parentFolderId, list); }
  children.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true, sensitivity: "base" })));
  const stack = [rootId], visited = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!; if (visited.has(id)) continue; visited.add(id);
    const node = byId.get(id); if (node && !node.listed && !node.error) return id;
    const below = children.get(id) ?? []; for (let index = below.length - 1; index >= 0; index--) stack.push(below[index]!.folderId);
  }
  return null;
}
