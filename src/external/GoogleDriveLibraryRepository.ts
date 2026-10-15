import type { StorageAdapter } from "../services/StorageService";
import { I18nManager } from "../i18n/I18nManager";

export type GoogleDriveLibraryContentType = "book" | "comic";
export interface GoogleDriveLibrarySource {
  id: string; userId: string; name: string; folderUrl: string; folderId: string;
  /** The owner's local choice for PDFs in this Drive folder. Older records mean book. */
  contentType?: GoogleDriveLibraryContentType;
  createdAt: string; updatedAt: string;
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
}
export interface GoogleDriveSyncTask { folderId: string; genre: string; resourceKey?: string; pageToken?: string; collectionPath?: string[]; }
export interface GoogleDriveLibrarySyncState {
  queue: GoogleDriveSyncTask[]; completed: boolean; updatedAt: string;
  /** Durable foreground-resume counters. Results themselves live in the entry cache. */
  folders?: number; files?: number; current?: string;
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
  public save(name: string, link: string, id?: string): Promise<GoogleDriveLibrarySource> {
    return this.mutate(async () => {
      if (!name.trim() || name.trim().length > 100) throw new Error(I18nManager.shared.t("externalLibrary.invalidName"));
      const parsed = GoogleDriveLibraryRepository.parse(link), rows = await this.all();
      const previous = rows.find(row => row.id === id), now = new Date().toISOString();
      const source: GoogleDriveLibrarySource = { ...parsed, id: previous?.id ?? crypto.randomUUID(), userId: this.owner,
        name: name.trim(), contentType: previous?.contentType ?? "book", createdAt: previous?.createdAt ?? now, updatedAt: now };
      await this.storage.save(`googleLibraries:${this.owner}`, [...rows.filter(row => row.id !== source.id), source]); return source;
    });
  }
  /** New personal-library flow: labels are deliberately local and automatic.  Keep the
   * older save(name, link) API above for existing non-Android callers and migrations. */
  public saveLink(link: string, contentType: GoogleDriveLibraryContentType = "book", name?: string): Promise<{ source: GoogleDriveLibrarySource; created: boolean }> {
    return this.mutate(async () => {
      const parsed = GoogleDriveLibraryRepository.parse(link), rows = await this.all();
      const duplicate = rows.find(row => row.folderId === parsed.folderId);
      if (duplicate) {
        // A person can paste the same shared folder later with its resource key. Keep
        // that key locally; otherwise a stale saved URL would fail authorization while
        // the UI misleadingly calls the repeated link a successful update.
        const displayName = name?.trim();
        const refreshed = duplicate.folderUrl === parsed.folderUrl && (duplicate.contentType ?? "book") === contentType && (!displayName || displayName === duplicate.name) ? duplicate : { ...duplicate, folderUrl: parsed.folderUrl, contentType, name: displayName || duplicate.name, updatedAt: new Date().toISOString() };
        if (refreshed !== duplicate) await this.storage.save(`googleLibraries:${this.owner}`, rows.map(row => row.id === duplicate.id ? refreshed : row));
        return { source: refreshed, created: false };
      }
      const now = new Date().toISOString();
      // The personal Drive sheet deliberately keeps one URL field. A folder name can be
      // resolved later during listing; until then a stable local fallback keeps the row
      // useful and editable without forcing people to type duplicate information.
      const displayName = name?.trim() || `Link ${rows.length + 1}`;
      if (displayName.length > 100) throw new Error(I18nManager.shared.t("externalLibrary.invalidName"));
      const source: GoogleDriveLibrarySource = { ...parsed, id: crypto.randomUUID(), userId: this.owner,
        name: displayName, contentType, createdAt: now, updatedAt: now };
      await this.storage.save(`googleLibraries:${this.owner}`, [...rows, source]);
      return { source, created: true };
    });
  }
  /** Changes only local routing metadata. Files, covers, downloads and Drive folders stay untouched. */
  public updateContentType(id: string, contentType: GoogleDriveLibraryContentType): Promise<GoogleDriveLibrarySource | null> {
    return this.mutate(async () => {
      const rows = await this.all(), previous = rows.find(row => row.id === id);
      if (!previous) return null;
      const source = { ...previous, contentType, updatedAt: new Date().toISOString() };
      await this.storage.save(`googleLibraries:${this.owner}`, rows.map(row => row.id === id ? source : row));
      const entries = await this.entries(id);
      await this.storage.save(`googleLibraryEntries:${this.owner}:${id}`, entries.map(entry => ({ ...entry, contentType })));
      return source;
    });
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
      incoming.forEach(entry => byId.set(entry.fileId, entry)); const saved = [...byId.values()];
      await this.storage.save(`googleLibraryEntries:${this.owner}:${sourceId}`, saved); return saved;
    });
  }
  public async syncState(sourceId: string): Promise<GoogleDriveLibrarySyncState | null> { return await this.storage.load<GoogleDriveLibrarySyncState>(`googleLibrarySync:${this.owner}:${sourceId}`); }
  public async saveSyncState(sourceId: string, state: GoogleDriveLibrarySyncState): Promise<void> { await this.storage.save(`googleLibrarySync:${this.owner}:${sourceId}`, state); }
  public async clearSyncState(sourceId: string): Promise<void> { await this.storage.remove(`googleLibrarySync:${this.owner}:${sourceId}`); }
  public remove(id: string): Promise<void> { return this.mutate(async () => {
    await this.storage.save(`googleLibraries:${this.owner}`, (await this.all()).filter(row => row.id !== id));
    await this.storage.remove(`googleLibraryEntries:${this.owner}:${id}`);
    await this.storage.remove(`googleLibrarySync:${this.owner}:${id}`);
  }); }
}
