import type { StorageAdapter } from "../services/StorageService";
import { I18nManager } from "../i18n/I18nManager";

/** Local routing choice for one Drive source. It never changes anything in Drive. */
export type GoogleDriveLibraryContentType = "book" | "comic" | "audiobook";
/** A source taken off the shelf: its listing, folders and sync state are kept so it can come back. */
export interface GoogleDriveRemovedSource { source: GoogleDriveLibrarySource; removedAt: string; origin: string; }
/** One change to the list of sources, kept on the device so a missing source can be explained. */
export interface GoogleDriveSourceEvent { at: string; action: "added" | "removed" | "restored" | "renamed" | "retyped" | "refused" | "purged"; sourceId: string; name: string; origin: string; detail?: string; }

export interface GoogleDriveLibrarySource {
  id: string; userId: string; name: string; folderUrl: string; folderId: string;
  /** The owner's local choice for PDFs in this Drive folder. Older records mean book. */
  contentType?: GoogleDriveLibraryContentType;
  /** The folder's own name in Drive, kept apart from `name` (which the person may customise). */
  driveName?: string;
  createdAt: string; updatedAt: string;
}
/** One folder below (or at) a source's root. The tree keeps Drive's real hierarchy at any
 *  depth; only the root is a category, every other folder is a child of its parent. */
export interface GoogleDriveFolderNode {
  sourceId: string; folderId: string; parentFolderId: string | null; name: string; depth: number; resourceKey?: string;
  /** Every page of this folder has been listed. */
  listed?: boolean;
  /** This folder could not be listed (e.g. no permission); the rest of the tree goes on. */
  error?: string;
}
/** A cached, metadata-only Drive item. Its presence never means the file was copied to
 * the device; the local Book record is created only after the person taps Baixar. */
export interface GoogleDriveLibraryEntry {
  sourceId: string; fileId: string; name: string; mimeType: string; size?: string;
  modifiedTime?: string; resourceKey?: string; genre: string; thumbnailUrl: string;
  title?: string; author?: string; synopsis?: string; coverUrl?: string; coverDriveFileId?: string;
  /** Folder names below a HQ source. They are metadata for collection sections, never
   * independent root genres. */
  collectionPath?: string[];
  contentType?: GoogleDriveLibraryContentType;
  /** Folder that directly holds this file, and its path below the source root. */
  parentFolderId?: string;
  folderPath?: Array<{ id: string; name: string }>;
  /** Drive's short-lived thumbnail URL from the listing, used to build a cached cover. */
  thumbnailLink?: string;
}
export interface GoogleDriveSyncTask { folderId: string; genre: string; resourceKey?: string; pageToken?: string; collectionPath?: string[];
  /** Ancestry below the source root (ids and names); empty for the root itself. */
  folderPath?: Array<{ id: string; name: string }>; }
export interface GoogleDriveLibrarySyncState {
  queue: GoogleDriveSyncTask[]; completed: boolean; updatedAt: string;
  /** Durable foreground-resume counters. Results themselves live in the entry cache. */
  folders?: number; files?: number; current?: string;
  /** Listing version that wrote this state (PERSONAL_DRIVE_SYNC_VERSION); absent = before v2. */
  version?: number;
  /** Catalog reading rules that wrote it (PERSONAL_DRIVE_CATALOG_RULES); absent = before rules 1. */
  catalogRules?: number;
}
export class GoogleDriveLibraryRepository {
  private queue: Promise<unknown> = Promise.resolve();
  /** Sources registered while nobody is signed in belong to the device. Without this
   *  the modal opened onto a dead end - no name field, no link field, no way to add -
   *  and blamed disk space for it. That is precisely the state a 400 from
   *  /auth/refresh leaves the app in, and registering a Drive folder has nothing to do
   *  with being signed in. Once a session exists its own bucket is used again. */
  public static readonly deviceOwner = "device";
  private readonly owner: string;
  public constructor(private readonly storage: StorageAdapter, userId: string) {
    this.owner = userId.trim() || GoogleDriveLibraryRepository.deviceOwner;
  }
  public static parse(value: string): { folderId: string; folderUrl: string } {
    try {
      const url = new URL(value.trim());
      const match = /^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)\/?$/.exec(url.pathname);
      if (url.protocol !== "https:" || url.hostname !== "drive.google.com" || url.port || url.username || url.password || !match) throw new Error();
      const clean = new URL(`https://drive.google.com/drive/folders/${match[1]}`);
      const key = url.searchParams.get("resourcekey");
      if (key) { if (!/^[\w-]+$/.test(key)) throw new Error(); clean.searchParams.set("resourcekey", key); }
      return { folderId: match[1]!, folderUrl: clean.href };
    } catch { throw new Error(I18nManager.shared.t("google.invalidLink")); }
  }
  public async all(): Promise<GoogleDriveLibrarySource[]> {
    return (await this.storage.load<GoogleDriveLibrarySource[]>(`googleLibraries:${this.owner}`) ?? []).filter(row => row.userId === this.owner);
  }
  private mutate<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action); this.queue = result.catch(() => undefined); return result;
  }
  /** The only way the list of sources is written. It never loses a source silently: rows of
   *  another owner are kept, and a write that would drop a source is refused unless that
   *  source is the one being removed. */
  private async writeSources(next: GoogleDriveLibrarySource[], dropping?: string): Promise<void> {
    const stored = await this.storage.load<GoogleDriveLibrarySource[]>(`googleLibraries:${this.owner}`) ?? [];
    const kept = new Set(next.map(row => row.id));
    const lost = stored.filter(row => row.userId === this.owner && row.id !== dropping && !kept.has(row.id));
    if (lost.length) {
      for (const row of lost) await this.log("refused", row, "writeSources", `a write would have dropped ${row.id}`);
      throw new Error("DRIVE_SOURCE_LIST_SHRINK");
    }
    await this.storage.save(`googleLibraries:${this.owner}`, [...stored.filter(row => row.userId !== this.owner), ...next]);
  }
  private async log(action: GoogleDriveSourceEvent["action"], source: Pick<GoogleDriveLibrarySource, "id" | "name">, origin: string, detail?: string): Promise<void> {
    const event: GoogleDriveSourceEvent = { at: new Date().toISOString(), action, sourceId: source.id, name: source.name, origin, ...(detail ? { detail } : {}) };
    console.info(JSON.stringify({ event: `PERSONAL_DRIVE_SOURCE_${action.toUpperCase()}`, ...event }));
    const history = await this.storage.load<GoogleDriveSourceEvent[]>(`googleLibrariesLog:${this.owner}`).catch(() => null) ?? [];
    await this.storage.save(`googleLibrariesLog:${this.owner}`, [...history, event].slice(-200)).catch(() => undefined);
  }
  /** What happened to the list of sources, oldest first (the last 200 changes). */
  public async history(): Promise<GoogleDriveSourceEvent[]> { return await this.storage.load<GoogleDriveSourceEvent[]>(`googleLibrariesLog:${this.owner}`) ?? []; }
  /** Sources taken off the shelf and their data, newest first; any of them can be restored. */
  public async removed(): Promise<GoogleDriveRemovedSource[]> {
    return (await this.storage.load<GoogleDriveRemovedSource[]>(`googleLibrariesRemoved:${this.owner}`) ?? []).filter(row => row.source.userId === this.owner).reverse();
  }
  public save(name: string, link: string, id?: string): Promise<GoogleDriveLibrarySource> {
    return this.mutate(async () => {
      if (!name.trim() || name.trim().length > 100) throw new Error(I18nManager.shared.t("externalLibrary.invalidName"));
      const parsed = GoogleDriveLibraryRepository.parse(link), rows = await this.all();
      const previous = rows.find(row => row.id === id), now = new Date().toISOString();
      const source: GoogleDriveLibrarySource = { ...parsed, id: previous?.id ?? crypto.randomUUID(), userId: this.owner,
        name: name.trim(), contentType: previous?.contentType ?? "book", createdAt: previous?.createdAt ?? now, updatedAt: now };
      await this.writeSources([...rows.filter(row => row.id !== source.id), source]); await this.log(previous ? "renamed" : "added", source, "save"); return source;
    });
  }
  /** New personal-library flow: labels are deliberately local and automatic.  Keep the
   * older save(name, link) API above for existing non-Android callers and migrations. */
  public saveLink(link: string, contentType: GoogleDriveLibraryContentType = "book", name?: string, driveName?: string): Promise<{ source: GoogleDriveLibrarySource; created: boolean }> {
    return this.mutate(async () => {
      const parsed = GoogleDriveLibraryRepository.parse(link), rows = await this.all();
      const duplicate = rows.find(row => row.folderId === parsed.folderId);
      if (duplicate) {
        // A person can paste the same shared folder later with its resource key. Keep
        // that key locally; otherwise a stale saved URL would fail authorization while
        // the UI misleadingly calls the repeated link a successful update.
        const displayName = name?.trim();
        if (displayName && displayName !== duplicate.name && nameTaken(rows, displayName, duplicate.id)) throw new Error("DRIVE_SOURCE_NAME_TAKEN");
        const refreshed = duplicate.folderUrl === parsed.folderUrl && (duplicate.contentType ?? "book") === contentType && (!displayName || displayName === duplicate.name) ? duplicate : { ...duplicate, folderUrl: parsed.folderUrl, contentType, name: displayName || duplicate.name, driveName: driveName?.trim() || duplicate.driveName, updatedAt: new Date().toISOString() };
        if (refreshed !== duplicate) await this.writeSources(rows.map(row => row.id === duplicate.id ? refreshed : row));
        return { source: refreshed, created: false };
      }
      // The folder of a source removed before: it comes back with everything already listed.
      const removedRows = await this.storage.load<GoogleDriveRemovedSource[]>(`googleLibrariesRemoved:${this.owner}`) ?? [];
      const previous = removedRows.find(row => row.source.userId === this.owner && row.source.folderId === parsed.folderId);
      if (previous) {
        const wanted = name?.trim() || previous.source.name;
        const restored: GoogleDriveLibrarySource = { ...previous.source, folderUrl: parsed.folderUrl, contentType, name: nameTaken(rows, wanted) ? freeName(rows, wanted) : wanted,
          ...(driveName?.trim() ? { driveName: driveName.trim() } : {}), updatedAt: new Date().toISOString() };
        await this.writeSources([...rows, restored]);
        await this.storage.save(`googleLibrariesRemoved:${this.owner}`, removedRows.filter(row => row !== previous));
        if (restored.name !== previous.source.name) await this.retitleEntries(restored.id, restored.name);
        await this.log("restored", restored, "saveLink");
        return { source: restored, created: false };
      }
      const now = new Date().toISOString();
      // The personal Drive sheet deliberately keeps one URL field. A folder name can be
      // resolved later during listing; until then a stable local fallback keeps the row
      // useful and editable without forcing people to type duplicate information.
      const displayName = name?.trim() || `Link ${rows.length + 1}`;
      if (displayName.length > 100) throw new Error(I18nManager.shared.t("externalLibrary.invalidName"));
      if (nameTaken(rows, displayName)) throw new Error("DRIVE_SOURCE_NAME_TAKEN");
      const source: GoogleDriveLibrarySource = { ...parsed, id: crypto.randomUUID(), userId: this.owner,
        name: displayName, contentType, ...(driveName?.trim() ? { driveName: driveName.trim() } : {}), createdAt: now, updatedAt: now };
      await this.writeSources([...rows, source]); await this.log("added", source, "saveLink");
      return { source, created: true };
    });
  }
  /** Changes only local routing metadata. Files, covers, downloads and Drive folders stay untouched. */
  public updateContentType(id: string, contentType: GoogleDriveLibraryContentType): Promise<GoogleDriveLibrarySource | null> {
    return this.mutate(async () => {
      const rows = await this.all(), previous = rows.find(row => row.id === id);
      if (!previous) return null;
      const source = { ...previous, contentType, updatedAt: new Date().toISOString() };
      await this.writeSources(rows.map(row => row.id === id ? source : row));
      // A book/HQ entry is not an audio chapter. Rebuild metadata when crossing this
      // boundary, while leaving downloaded files, their progress and the Drive source intact.
      if ((previous.contentType === "audiobook") !== (contentType === "audiobook")) {
        await this.storage.save(`googleLibraryEntries:${this.owner}:${id}`, []);
        await this.clearSyncState(id);
      } else {
        const entries = await this.entries(id);
        await this.storage.save(`googleLibraryEntries:${this.owner}:${id}`, entries.map(entry => ({ ...entry, contentType })));
      }
      await this.log("retyped", source, "updateContentType", contentType);
      return source;
    });
  }
  /** Gives an automatic "Link N" source the folder's real name once it is known. */
  public rename(id: string, name: string): Promise<GoogleDriveLibrarySource | null> {
    return this.mutate(async () => {
      const clean = name.trim(); if (!clean || clean.length > 100) return null;
      const rows = await this.all(), current = rows.find(row => row.id === id); if (!current || current.name === clean) return current ?? null;
      // The name is the source's category: two sources with one name would merge into one chip.
      if (nameTaken(rows, clean, id)) throw new Error("DRIVE_SOURCE_NAME_TAKEN");
      const updated = { ...current, name: clean, updatedAt: new Date().toISOString() };
      await this.writeSources(rows.map(row => row.id === id ? updated : row));
      // The source is one category: its entries follow the new name.
      await this.retitleEntries(id, clean);
      await this.log("renamed", updated, "rename", `${current.name} → ${clean}`);
      return updated;
    });
  }
  private async retitleEntries(sourceId: string, name: string): Promise<void> {
    const entries = await this.entries(sourceId);
    if (entries.length) await this.storage.save(`googleLibraryEntries:${this.owner}:${sourceId}`, entries.map(entry => ({ ...entry, genre: name })));
  }
  public async entries(sourceId?: string): Promise<GoogleDriveLibraryEntry[]> {
    if (sourceId) return await this.storage.load<GoogleDriveLibraryEntry[]>(`googleLibraryEntries:${this.owner}:${sourceId}`) ?? [];
    const groups = await Promise.all((await this.all()).map(source => this.entries(source.id)));
    return groups.flat();
  }
  public async saveEntries(sourceId: string, entries: GoogleDriveLibraryEntry[]): Promise<void> {
    await this.storage.save(`googleLibraryEntries:${this.owner}:${sourceId}`, entries);
  }
  public async appendEntries(sourceId: string, incoming: GoogleDriveLibraryEntry[]): Promise<GoogleDriveLibraryEntry[]> {
    return this.mutate(async () => {
      const current = await this.entries(sourceId), byId = new Map(current.map(entry => [entry.fileId, entry]));
      incoming.forEach(entry => byId.set(entry.fileId, entry));
      // A source is one category named like the source. A sync started before a rename still
      // carries the old name, so the stored name wins (and heals entries written meanwhile).
      const category = await this.categoryOf(sourceId);
      const saved = [...byId.values()].map(entry => category && entry.genre !== category ? { ...entry, genre: category } : entry);
      await this.storage.save(`googleLibraryEntries:${this.owner}:${sourceId}`, saved); return saved;
    });
  }
  /** The category name of a source, or null while it still has an automatic "Link N" name
   *  (its entries then carry the folder's real name until the sync renames the source). */
  private async categoryOf(sourceId: string): Promise<string | null> {
    const name = (await this.all()).find(row => row.id === sourceId)?.name.trim();
    return name && !/^Link\s+\d+$/i.test(name) ? name : null;
  }
  public async folders(sourceId: string): Promise<GoogleDriveFolderNode[]> {
    return await this.storage.load<GoogleDriveFolderNode[]>(`googleLibraryFolders:${this.owner}:${sourceId}`) ?? [];
  }
  /** Upserts folders by id: a folder is stored once however many times it is listed, and
   *  "listed" never goes back to false once every page of it was read. */
  public async appendFolders(sourceId: string, incoming: readonly GoogleDriveFolderNode[]): Promise<GoogleDriveFolderNode[]> {
    return this.mutate(async () => {
      const byId = new Map((await this.folders(sourceId)).map(node => [node.folderId, node]));
      for (const node of incoming) { const previous = byId.get(node.folderId); byId.set(node.folderId, { ...previous, ...node, listed: Boolean(previous?.listed || node.listed) }); }
      const category = await this.categoryOf(sourceId);
      const saved = [...byId.values()].map(node => category && node.parentFolderId === null && node.name !== category ? { ...node, name: category } : node);
      await this.storage.save(`googleLibraryFolders:${this.owner}:${sourceId}`, saved); return saved;
    });
  }
  public async syncState(sourceId: string): Promise<GoogleDriveLibrarySyncState | null> { return await this.storage.load<GoogleDriveLibrarySyncState>(`googleLibrarySync:${this.owner}:${sourceId}`); }
  public async saveSyncState(sourceId: string, state: GoogleDriveLibrarySyncState): Promise<void> { await this.storage.save(`googleLibrarySync:${this.owner}:${sourceId}`, state); }
  public async clearSyncState(sourceId: string): Promise<void> { await this.storage.remove(`googleLibrarySync:${this.owner}:${sourceId}`); }
  /** Takes a source off the shelf. Nothing is deleted: its listing, folders and sync state stay
   *  on the device, the removal is recorded with where it came from, and `restore` (or adding
   *  the same folder again) brings it back as it was. */
  public remove(id: string, origin = "unknown"): Promise<void> { return this.mutate(async () => {
    const rows = await this.all(), source = rows.find(row => row.id === id);
    if (!source) return;
    const removedRows = await this.storage.load<GoogleDriveRemovedSource[]>(`googleLibrariesRemoved:${this.owner}`) ?? [];
    await this.storage.save(`googleLibrariesRemoved:${this.owner}`, [...removedRows.filter(row => row.source.id !== id), { source, removedAt: new Date().toISOString(), origin }]);
    await this.writeSources(rows.filter(row => row.id !== id), id);
    await this.log("removed", source, origin);
  }); }
  /**
   * Deletes a source from the trash for good: its row and the metadata this device kept for
   * it (files listed, folders, sync state). Only a source already in the trash can be deleted,
   * so an active one is never lost by one tap. The Drive folder itself is never touched, and
   * books, comics and audio already downloaded stay on the device. The same link can then be
   * added again as a new source, listed from scratch. The history keeps a "purged" line.
   */
  public purge(id: string, origin = "unknown"): Promise<boolean> { return this.mutate(async () => {
    const removedRows = await this.storage.load<GoogleDriveRemovedSource[]>(`googleLibrariesRemoved:${this.owner}`) ?? [];
    const gone = removedRows.find(row => row.source.id === id && row.source.userId === this.owner);
    if (!gone || (await this.all()).some(row => row.id === id)) return false;
    await this.storage.save(`googleLibrariesRemoved:${this.owner}`, removedRows.filter(row => row !== gone));
    await this.storage.remove(`googleLibraryEntries:${this.owner}:${id}`);
    await this.storage.remove(`googleLibraryFolders:${this.owner}:${id}`);
    await this.storage.remove(`googleLibrarySync:${this.owner}:${id}`);
    await this.log("purged", gone.source, origin);
    return true;
  }); }
  /** Puts a removed source back with its data; a name taken meanwhile gets a number. */
  public restore(id: string, origin = "unknown"): Promise<GoogleDriveLibrarySource | null> { return this.mutate(async () => {
    const removedRows = await this.storage.load<GoogleDriveRemovedSource[]>(`googleLibrariesRemoved:${this.owner}`) ?? [];
    const previous = removedRows.find(row => row.source.id === id && row.source.userId === this.owner);
    if (!previous) return null;
    const rows = await this.all();
    if (rows.some(row => row.id === id || row.folderId === previous.source.folderId)) { await this.storage.save(`googleLibrariesRemoved:${this.owner}`, removedRows.filter(row => row !== previous)); return rows.find(row => row.id === id || row.folderId === previous.source.folderId) ?? null; }
    const restored = { ...previous.source, name: nameTaken(rows, previous.source.name) ? freeName(rows, previous.source.name) : previous.source.name, updatedAt: new Date().toISOString() };
    await this.writeSources([...rows, restored]);
    await this.storage.save(`googleLibrariesRemoved:${this.owner}`, removedRows.filter(row => row !== previous));
    if (restored.name !== previous.source.name) await this.retitleEntries(restored.id, restored.name);
    await this.log("restored", restored, origin);
    return restored;
  }); }
}

/** "Romance (2)", "Romance (3)"…: the first variant of a name no source uses. */
function freeName(rows: readonly GoogleDriveLibrarySource[], name: string): string {
  for (let index = 2; ; index++) { const candidate = `${name} (${index})`; if (!nameTaken(rows, candidate)) return candidate; }
}

/** Source names are categories, so they are unique regardless of case and accents. */
function nameTaken(rows: readonly GoogleDriveLibrarySource[], name: string, exceptId?: string): boolean {
  const fold = (value: string): string => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim();
  return rows.some(row => row.id !== exceptId && fold(row.name) === fold(name));
}
