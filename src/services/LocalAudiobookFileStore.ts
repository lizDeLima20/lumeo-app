import { AudiobookFileRepository } from "../repositories/AudiobookFileRepository";

/** Separate private namespace so audiobook chapters cannot collide with books or LIMA. */
export class LocalAudiobookFileStore {
  public constructor(private readonly fallback: AudiobookFileRepository, private readonly userId = "personal") {}
  public async save(id: string, blob: Blob): Promise<"opfs" | "indexeddb"> { if (await this.write(id, blob)) return "opfs"; await this.fallback.save(id, blob); return "indexeddb"; }
  public async get(id: string): Promise<Blob | null> { return await this.read(id) ?? this.fallback.get(id); }
  public async exists(id: string): Promise<boolean> { return Boolean(await this.get(id)); }
  private get supported(): boolean { return typeof navigator !== "undefined" && Boolean(navigator.storage) && "getDirectory" in navigator.storage; }
  private async root(): Promise<FileSystemDirectoryHandle | null> {
    if (!this.supported) return null;
    const storage = navigator.storage as StorageManager & { getDirectory(): Promise<FileSystemDirectoryHandle> };
    const root = await storage.getDirectory(), library = await root.getDirectoryHandle("lumeo-audiobooks", { create: true });
    return library.getDirectoryHandle(this.userId.replace(/[^a-zA-Z0-9._-]/g, "_"), { create: true });
  }
  private async write(id: string, blob: Blob): Promise<boolean> { try { const root = await this.root(); if (!root) return false; const handle = await root.getFileHandle(`${id}.audio`, { create: true }), output = await handle.createWritable(); await output.write(blob); await output.close(); return true; } catch { return false; } }
  private async read(id: string): Promise<Blob | null> { try { const root = await this.root(); if (!root) return null; return await (await root.getFileHandle(`${id}.audio`)).getFile(); } catch { return null; } }
}
