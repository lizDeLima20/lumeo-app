import type { GoogleLibraryFile } from "../external/GoogleDriveLibraryService";
import { GoogleDriveLibraryService } from "../external/GoogleDriveLibraryService";
import { AudiobookProgressRepository } from "../repositories/AudiobookProgressRepository";
import { LocalAudiobookFileStore } from "../services/LocalAudiobookFileStore";
import type { AudiobookChapter } from "./AudiobookLibrary";

export interface AudiobookPlayerState { chapter: AudiobookChapter | null; playing: boolean; downloading: boolean; progress: number | null; position: number; duration: number; speed: number; queueIndex: number; queueLength: number; error?: string; }
type Listener = (state: AudiobookPlayerState) => void;

/** A single foreground player. Chapters download in full once, then use a private OPFS/IDB
 * blob URL offline. The Drive service owns the public-vs-private transport decision. */
export class AudiobookPlayer {
  private readonly audio = new Audio(); private url: string | null = null; private active: AudiobookChapter | null = null; private listeners = new Set<Listener>(); private queue: AudiobookChapter[] = [];
  private state: AudiobookPlayerState = { chapter: null, playing: false, downloading: false, progress: null, position: 0, duration: 0, speed: 1, queueIndex: -1, queueLength: 0 };
  private playingRequest: Promise<void> | null = null;
  public constructor(private readonly drive: GoogleDriveLibraryService, private readonly files: LocalAudiobookFileStore, private readonly progress: AudiobookProgressRepository) {
    this.audio.preload = "metadata";
    this.audio.addEventListener("loadedmetadata", () => { this.update({ duration: finite(this.audio.duration), progress: null }); void this.resumeSavedPosition(); });
    this.audio.addEventListener("timeupdate", () => { this.update({ position: finite(this.audio.currentTime), duration: finite(this.audio.duration) }); void this.persist(false); });
    this.audio.addEventListener("play", () => this.update({ playing: true, error: undefined }));
    this.audio.addEventListener("pause", () => { this.update({ playing: false }); void this.persist(true); });
    this.audio.addEventListener("ended", () => { this.update({ playing: false, position: finite(this.audio.duration) }); void this.persist(true); void this.next().catch(() => undefined); });
    this.audio.addEventListener("error", () => this.update({ playing: false, downloading: false, error: "Não foi possível reproduzir este arquivo de áudio." }));
  }
  public subscribe(listener: Listener): () => void { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  public async toggle(chapter: AudiobookChapter, queue?: readonly AudiobookChapter[]): Promise<void> {
    if (queue?.length) this.setQueue(queue);
    if (this.active?.id === chapter.id && this.state.playing) { this.audio.pause(); return; }
    if (this.active?.id === chapter.id && this.audio.src) { await this.audio.play(); return; }
    await this.play(chapter, queue);
  }
  public async play(chapter: AudiobookChapter, queue?: readonly AudiobookChapter[]): Promise<void> {
    if (queue?.length) this.setQueue(queue);
    if (this.playingRequest) return this.playingRequest;
    this.playingRequest = this.start(chapter).finally(() => { this.playingRequest = null; }); return this.playingRequest;
  }
  public pause(): void { this.audio.pause(); }
  public async next(): Promise<void> { const next = queuedNext(this.queue, this.active?.id); if (next) await this.play(next); }
  public async previous(): Promise<void> { if (this.audio.currentTime > 3) { this.seek(0); return; } const previous = queuedPrevious(this.queue, this.active?.id); if (previous) await this.play(previous); }
  public setSpeed(speed: number): void { const safe = [0.75, 1, 1.25, 1.5, 1.75, 2].includes(speed) ? speed : 1; this.audio.playbackRate = safe; this.update({ speed: safe }); }
  public seekBy(seconds: number): void { if (!Number.isFinite(this.audio.duration)) return; this.audio.currentTime = clamp(this.audio.currentTime + seconds, 0, this.audio.duration); }
  public seek(position: number): void { if (!Number.isFinite(this.audio.duration)) return; this.audio.currentTime = clamp(position, 0, this.audio.duration); }
  public dispose(): void { this.audio.pause(); this.audio.removeAttribute("src"); this.revoke(); this.listeners.clear(); }
  private setQueue(chapters: readonly AudiobookChapter[]): void { this.queue = [...chapters]; const index = this.queue.findIndex(value => value.id === this.active?.id); this.update({ queueIndex: index, queueLength: this.queue.length }); }
  private async start(chapter: AudiobookChapter): Promise<void> {
    this.audio.pause(); this.revoke(); this.active = chapter; const index = this.queue.findIndex(value => value.id === chapter.id); this.update({ chapter, playing: false, downloading: false, progress: null, position: 0, duration: 0, queueIndex: index, queueLength: this.queue.length, error: undefined });
    let blob = await this.files.get(chapter.id);
    if (!blob) {
      this.update({ downloading: true, progress: 0 }); const signal = new AbortController().signal;
      try { const file = await this.drive.downloadAudio({ id: chapter.fileId, name: chapter.name, mimeType: chapter.mimeType, size: chapter.size, modifiedTime: chapter.modifiedTime, resourceKey: chapter.resourceKey } satisfies GoogleLibraryFile, signal, value => this.update({ progress: value })); blob = file; await this.files.save(chapter.id, file); }
      catch (error) { this.update({ downloading: false, progress: null, error: message(error) }); throw error; }
    }
    this.url = URL.createObjectURL(blob); this.audio.src = this.url; this.audio.playbackRate = this.state.speed; this.audio.load(); this.update({ downloading: false, progress: null });
    await this.audio.play().catch(error => { this.update({ error: "A reprodução foi bloqueada ou o formato não é suportado neste dispositivo." }); throw error; });
  }
  private async resumeSavedPosition(): Promise<void> {
    const chapter = this.active; if (!chapter || chapter.id !== this.active?.id) return;
    const saved = await this.progress.get(chapter.id); if (!saved || saved.positionSeconds <= 0 || !Number.isFinite(this.audio.duration)) return;
    this.audio.currentTime = clamp(saved.positionSeconds, 0, Math.max(0, this.audio.duration - .25)); this.update({ position: this.audio.currentTime });
  }
  private async persist(force: boolean): Promise<void> {
    const chapter = this.active; if (!chapter || !Number.isFinite(this.audio.currentTime)) return;
    const now = Date.now(); const last = Number((this as unknown as { lastPersist?: number }).lastPersist ?? 0); if (!force && now - last < 5_000) return;
    (this as unknown as { lastPersist: number }).lastPersist = now; await this.progress.save({ audiobookId: chapter.id, positionSeconds: finite(this.audio.currentTime), durationSeconds: finite(this.audio.duration) || undefined, updatedAt: new Date().toISOString() }).catch(() => undefined);
  }
  private update(change: Partial<AudiobookPlayerState>): void { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener(this.state)); }
  private revoke(): void { if (this.url) URL.revokeObjectURL(this.url); this.url = null; }
}
function finite(value: number): number { return Number.isFinite(value) ? value : 0; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function message(error: unknown): string { return error instanceof Error && error.message ? error.message : "Não foi possível baixar este capítulo."; }
/** Pure helpers keep queue navigation testable without a browser audio implementation. */
export function queuedNext(queue: readonly AudiobookChapter[], currentId?: string): AudiobookChapter | undefined { const index = queue.findIndex(value => value.id === currentId); return index >= 0 ? queue[index + 1] : undefined; }
export function queuedPrevious(queue: readonly AudiobookChapter[], currentId?: string): AudiobookChapter | undefined { const index = queue.findIndex(value => value.id === currentId); return index > 0 ? queue[index - 1] : undefined; }
