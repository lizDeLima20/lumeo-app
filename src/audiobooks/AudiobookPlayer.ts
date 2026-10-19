import type { GoogleLibraryFile } from "../external/GoogleDriveLibraryService";
import { GoogleDriveLibraryService } from "../external/GoogleDriveLibraryService";
import { AudiobookProgressRepository } from "../repositories/AudiobookProgressRepository";
import { LocalAudiobookFileStore } from "../services/LocalAudiobookFileStore";
import type { AudiobookChapter } from "./AudiobookLibrary";
import { NativeAudiobook, type NativeAudiobookItem, type NativeAudiobookState } from "./NativeAudiobook";

export interface AudiobookPlayerState { chapter: AudiobookChapter | null; playing: boolean; downloading: boolean; cueing: boolean; progress: number | null; position: number; duration: number; speed: number; queueIndex: number; queueLength: number; error?: string; }
type Listener = (state: AudiobookPlayerState) => void;
/** The Android player, as far as this class uses it (a stand-in in tests). */
export type NativeAudiobookPlayer = Pick<typeof NativeAudiobook.plugin, "open" | "play" | "pause" | "next" | "previous" | "seekTo" | "seekBy" | "setSpeed" | "getState" | "addListener">;

/** A single player. On Android, chapters play in Lumeo's native player, which goes on in the
 * background with controls in the notification and on the lock screen; it streams from Drive
 * and keeps each chapter on the device. Elsewhere, or if that player cannot read a chapter,
 * chapters download in full once, then use a private OPFS/IDB blob URL offline. The Drive
 * service owns the public-vs-private transport decision. */
export class AudiobookPlayer {
  private readonly audio = new Audio(); private url: string | null = null; private active: AudiobookChapter | null = null; private listeners = new Set<Listener>(); private queue: AudiobookChapter[] = [];
  private state: AudiobookPlayerState = { chapter: null, playing: false, downloading: false, cueing: false, progress: null, position: 0, duration: 0, speed: 1, queueIndex: -1, queueLength: 0 };
  private playingRequest: Promise<void> | null = null;
  private cueGeneration = 0;
  private lastPersist = 0;
  /** Whether the active chapter is in the native player (false: this page's audio element). */
  private nativeActive = false;
  /** The tone arm is still moving to the record: the native player waits for it. */
  private nativeCueing = false;
  /** Chapters already retried after the native player failed them, so a retry is tried once. */
  private readonly nativeRetried = new Set<string>();
  /** A chapter being handed to the native player; until then its events are of the old one. */
  private nativeOpening: string | null = null;
  public constructor(private readonly drive: GoogleDriveLibraryService, private readonly files: LocalAudiobookFileStore, private readonly progress: AudiobookProgressRepository,
    private readonly native: NativeAudiobookPlayer | null = NativeAudiobook.available ? NativeAudiobook.plugin : null) {
    this.audio.preload = "metadata";
    this.audio.addEventListener("loadedmetadata", () => { this.update({ duration: finite(this.audio.duration), progress: null }); void this.resumeSavedPosition(); });
    this.audio.addEventListener("timeupdate", () => { this.update({ position: finite(this.audio.currentTime), duration: finite(this.audio.duration) }); void this.persist(false); });
    this.audio.addEventListener("play", () => this.update({ playing: true, cueing: false, error: undefined }));
    this.audio.addEventListener("pause", () => { this.update({ playing: false, cueing: false }); void this.persist(true); });
    this.audio.addEventListener("ended", () => { this.update({ playing: false, cueing: false, position: finite(this.audio.duration) }); void this.persist(true); void this.next().catch(() => undefined); });
    this.audio.addEventListener("error", () => this.update({ playing: false, downloading: false, cueing: false, error: "Não foi possível reproduzir este arquivo de áudio." }));
    if (this.native) {
      void this.native.addListener("state", value => this.nativeState(value)).catch(() => undefined);
      // A chapter may still be playing from before this screen was (re)opened.
      void this.native.getState().then(value => this.nativeState(value)).catch(() => undefined);
    }
  }
  public subscribe(listener: Listener): () => void { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  public async toggle(chapter: AudiobookChapter, queue?: readonly AudiobookChapter[]): Promise<void> {
    if (queue?.length) this.setQueue(queue);
    if (this.active?.id === chapter.id && (this.state.playing || this.state.cueing)) { this.pause(); return; }
    if (this.active?.id === chapter.id && this.nativeActive && this.native) { await this.cueNative(chapter.id); return; }
    if (this.active?.id === chapter.id && this.audio.src) { await this.cueAndPlay(chapter.id); return; }
    await this.play(chapter, queue);
  }
  public async play(chapter: AudiobookChapter, queue?: readonly AudiobookChapter[]): Promise<void> {
    if (queue?.length) this.setQueue(queue);
    if (this.playingRequest) return this.playingRequest;
    this.playingRequest = this.begin(chapter).finally(() => { this.playingRequest = null; }); return this.playingRequest;
  }
  public pause(): void {
    this.cueGeneration += 1; this.nativeCueing = false; this.update({ cueing: false });
    if (this.nativeActive) void this.native?.pause().catch(() => undefined); else this.audio.pause();
  }
  public async next(): Promise<void> {
    if (this.nativeActive && this.native) { this.cueGeneration += 1; this.nativeCueing = false; await this.native.next(); return; }
    const next = queuedNext(this.queue, this.active?.id); if (next) await this.play(next);
  }
  public async previous(): Promise<void> {
    if (this.nativeActive && this.native) { this.cueGeneration += 1; this.nativeCueing = false; await this.native.previous(); return; }
    const previous = queuedPrevious(this.queue, this.active?.id); if (previous) await this.play(previous);
  }
  public setSpeed(speed: number): void {
    const safe = [0.75, 1, 1.25, 1.5, 1.75, 2].includes(speed) ? speed : 1; this.audio.playbackRate = safe; this.update({ speed: safe });
    if (this.nativeActive) void this.native?.setSpeed({ speed: safe }).catch(() => undefined);
  }
  public seekBy(seconds: number): void {
    if (this.nativeActive) { if (!this.state.duration) return; this.update({ position: clamp(this.state.position + seconds, 0, this.state.duration) }); void this.native?.seekBy({ deltaMs: Math.round(seconds * 1000) }).catch(() => undefined); return; }
    if (!Number.isFinite(this.audio.duration)) return; this.audio.currentTime = clamp(this.audio.currentTime + seconds, 0, this.audio.duration);
  }
  public seek(position: number): void {
    if (this.nativeActive) { if (!this.state.duration) return; const target = clamp(position, 0, this.state.duration); this.update({ position: target }); void this.native?.seekTo({ positionMs: Math.round(target * 1000) }).catch(() => undefined); return; }
    if (!Number.isFinite(this.audio.duration)) return; this.audio.currentTime = clamp(position, 0, this.audio.duration);
  }
  /** Closes this screen's player. A chapter in the native player goes on: it belongs to the
   *  notification from then on, and is stopped there. */
  public dispose(): void { this.cueGeneration += 1; this.audio.pause(); this.audio.removeAttribute("src"); this.revoke(); this.listeners.clear(); }
  private setQueue(chapters: readonly AudiobookChapter[]): void { this.queue = [...chapters]; const index = this.queue.findIndex(value => value.id === this.active?.id); if (!this.nativeActive) this.update({ queueIndex: index, queueLength: this.queue.length }); }
  private async begin(chapter: AudiobookChapter): Promise<void> {
    if (this.native) {
      try { await this.startNative(chapter, false); return; }
      catch { this.nativeActive = false; /* The page's own player below downloads the chapter instead. */ }
    }
    await this.start(chapter);
  }
  /** The chapter's whole queue goes to the native player, so the notification can move between
   *  chapters on its own; it starts where the chapter was left. */
  private async startNative(chapter: AudiobookChapter, privateSession: boolean): Promise<void> {
    const native = this.native!;
    this.cueGeneration += 1; this.audio.pause(); this.audio.removeAttribute("src"); this.revoke();
    // The chapter playing now stops at once; its last events are not this chapter's.
    if (this.nativeActive) void native.pause().catch(() => undefined);
    this.active = chapter; this.nativeActive = true; this.nativeCueing = true; this.nativeOpening = chapter.id;
    const queue = this.queue.some(value => value.id === chapter.id) ? this.queue : [chapter], index = queue.findIndex(value => value.id === chapter.id);
    this.update({ chapter, playing: false, downloading: false, cueing: true, progress: null, position: 0, duration: 0, queueIndex: index, queueLength: queue.length, error: undefined });
    const access = await this.drive.mediaAccess(privateSession).catch(() => null);
    if (!access) { this.nativeActive = false; this.nativeCueing = false; this.nativeOpening = null; throw new Error("DRIVE_MEDIA_UNAVAILABLE"); }
    const items = queue.map(value => { const file = access.file({ id: value.fileId, resourceKey: value.resourceKey }); return nativeItem(value, file.uri, file.headers); });
    const positionMs = Math.round(resumeAt(await this.progress.get(chapter.id).catch(() => null)) * 1000);
    this.lastPersist = Date.now();
    const open = () => native.open({ items, index, positionMs, speed: this.state.speed, play: false, headers: access.headers }).finally(() => { if (this.nativeOpening === chapter.id) this.nativeOpening = null; });
    await this.cueNative(chapter.id, open);
  }
  /** Same tone-arm wait as the page's player: the chapter is loaded meanwhile, and starts once
   *  the arm reaches the record. */
  private async cueNative(chapterId: string, prepare?: () => Promise<unknown>): Promise<void> {
    const generation = ++this.cueGeneration;
    this.nativeCueing = true; this.update({ playing: false, cueing: true, error: undefined });
    await Promise.all([prepare?.(), new Promise<void>(resolve => window.setTimeout(resolve, 560))]);
    if (generation !== this.cueGeneration || this.active?.id !== chapterId) return;
    this.nativeCueing = false;
    await this.native!.play();
  }
  private nativeState(value: NativeAudiobookState): void {
    if (!this.nativeActive) {
      // A chapter left playing (or paused) in the notification when this screen was opened.
      if (!value.id || !value.count || value.idle) return;
      this.nativeActive = true;
    }
    if (this.nativeOpening && value.id !== this.nativeOpening) return;
    const known = value.id ? this.queue.find(item => item.id === value.id) ?? (this.active?.id === value.id ? this.active : parseChapter(value.chapter)) : null;
    const chapter = known ?? this.active;
    if (chapter && chapter.id !== this.active?.id) {
      // The notification, a headset or the end of a chapter moved on: resume where that one was left.
      this.active = chapter; this.lastPersist = Date.now(); void this.resumeNativeChapter(chapter.id, value);
    }
    const wasPlaying = this.state.playing;
    this.update({ chapter, playing: value.playing, cueing: this.nativeCueing || (value.buffering && value.playWhenReady), downloading: false, progress: null,
      position: value.positionMs / 1000, duration: value.durationMs / 1000, speed: value.speed || this.state.speed, queueIndex: value.index, queueLength: value.count,
      error: value.error ? "Não foi possível reproduzir este capítulo agora. Verifique a conexão e tente de novo." : undefined });
    if (value.id && (value.durationMs > 0 || value.positionMs > 0)) void this.persistNative(value, (wasPlaying && !value.playing) || value.ended);
    if (value.error && chapter) void this.recoverNative(chapter, value.error);
  }
  private async resumeNativeChapter(chapterId: string, value: NativeAudiobookState): Promise<void> {
    if (value.positionMs > 1_000) return;
    const at = resumeAt(await this.progress.get(chapterId).catch(() => null));
    if (at > 0 && this.active?.id === chapterId) await this.native?.seekTo({ positionMs: Math.round(at * 1000) }).catch(() => undefined);
  }
  /** A chapter Drive refused publicly is retried with the private session already granted; one
   *  the native player cannot read at all falls back to the page's own player, once. */
  private async recoverNative(chapter: AudiobookChapter, error: string): Promise<void> {
    if (this.nativeRetried.has(chapter.id)) return; this.nativeRetried.add(chapter.id);
    console.warn(JSON.stringify({ event: "AUDIOBOOK_NATIVE_ERROR", error }));
    if (error === "ERROR_CODE_IO_BAD_HTTP_STATUS" && this.drive.privateSessionReady) { await this.startNative(chapter, true).catch(() => undefined); return; }
    // Offline, a chapter downloaded earlier by the page's player is still there to be heard.
    const offlineCopy = error.startsWith("ERROR_CODE_IO_NETWORK") && !!(await this.files.get(chapter.id).catch(() => null));
    if (offlineCopy || error.startsWith("ERROR_CODE_PARSING") || error.startsWith("ERROR_CODE_DECODING") || error.startsWith("ERROR_CODE_DECODER") || error.startsWith("ERROR_CODE_AUDIO_TRACK")) {
      await this.native?.pause().catch(() => undefined); this.nativeActive = false; await this.start(chapter).catch(() => undefined);
    }
  }
  private async persistNative(value: NativeAudiobookState, force: boolean): Promise<void> {
    const now = Date.now(); if (!force && now - this.lastPersist < 5_000) return; this.lastPersist = now;
    await this.progress.save({ audiobookId: value.id!, positionSeconds: value.positionMs / 1000, durationSeconds: value.durationMs / 1000 || undefined, updatedAt: new Date().toISOString() }).catch(() => undefined);
  }
  private async start(chapter: AudiobookChapter): Promise<void> {
    this.cueGeneration += 1; this.audio.pause(); this.revoke(); this.active = chapter; this.nativeActive = false; const index = this.queue.findIndex(value => value.id === chapter.id); this.update({ chapter, playing: false, downloading: false, cueing: false, progress: null, position: 0, duration: 0, queueIndex: index, queueLength: this.queue.length, error: undefined });
    let blob = await this.files.get(chapter.id);
    if (!blob) {
      this.update({ downloading: true, cueing: false, progress: 0 }); const signal = new AbortController().signal;
      try { const file = await this.drive.downloadAudio({ id: chapter.fileId, name: chapter.name, mimeType: chapter.mimeType, size: chapter.size, modifiedTime: chapter.modifiedTime, resourceKey: chapter.resourceKey } satisfies GoogleLibraryFile, signal, value => this.update({ progress: value })); blob = file; await this.files.save(chapter.id, file); }
      catch (error) { this.update({ downloading: false, cueing: false, progress: null, error: message(error) }); throw error; }
    }
    this.url = URL.createObjectURL(blob); this.audio.src = this.url; this.audio.playbackRate = this.state.speed; this.audio.load(); this.update({ downloading: false, progress: null });
    await this.cueAndPlay(chapter.id);
  }
  /** Gives the tone arm enough time to reach the record before audio and rotation start. */
  private async cueAndPlay(chapterId: string): Promise<void> {
    const generation = ++this.cueGeneration;
    this.update({ playing: false, cueing: true, error: undefined });
    await new Promise<void>(resolve => window.setTimeout(resolve, 560));
    if (generation !== this.cueGeneration || this.active?.id !== chapterId) return;
    this.update({ cueing: false });
    await this.audio.play().catch(error => { this.update({ cueing: false, error: "A reprodução foi bloqueada ou o formato não é suportado neste dispositivo." }); throw error; });
  }
  private async resumeSavedPosition(): Promise<void> {
    const chapter = this.active; if (!chapter || chapter.id !== this.active?.id) return;
    const saved = await this.progress.get(chapter.id); if (!saved || saved.positionSeconds <= 0 || !Number.isFinite(this.audio.duration)) return;
    this.audio.currentTime = clamp(saved.positionSeconds, 0, Math.max(0, this.audio.duration - .25)); this.update({ position: this.audio.currentTime });
  }
  private async persist(force: boolean): Promise<void> {
    const chapter = this.active; if (!chapter || !Number.isFinite(this.audio.currentTime)) return;
    const now = Date.now(); if (!force && now - this.lastPersist < 5_000) return;
    this.lastPersist = now; await this.progress.save({ audiobookId: chapter.id, positionSeconds: finite(this.audio.currentTime), durationSeconds: finite(this.audio.duration) || undefined, updatedAt: new Date().toISOString() }).catch(() => undefined);
  }
  private update(change: Partial<AudiobookPlayerState>): void { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener(this.state)); }
  private revoke(): void { if (this.url) URL.revokeObjectURL(this.url); this.url = null; }
}
function finite(value: number): number { return Number.isFinite(value) ? value : 0; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function message(error: unknown): string { return error instanceof Error && error.message ? error.message : "Não foi possível baixar este capítulo."; }
/** Where a chapter starts again: where it was left, or from the top once it was heard to the end. */
export function resumeAt(saved: { positionSeconds: number; durationSeconds?: number } | null): number {
  if (!saved || !(saved.positionSeconds > 0)) return 0;
  return saved.durationSeconds && saved.positionSeconds >= saved.durationSeconds - 2 ? 0 : saved.positionSeconds;
}
/** A chapter for the native queue: the Drive URL and headers, with what the notification shows. */
export function nativeItem(chapter: AudiobookChapter, uri: string, headers: Record<string, string>): NativeAudiobookItem {
  const artwork = chapter.coverUrl ?? chapter.thumbnailUrl;
  return { id: chapter.id, uri, title: chapter.title, collection: chapter.collection, headers, chapter: JSON.stringify(chapter), ...(artwork?.startsWith("https://") ? { artworkUri: artwork } : {}) };
}
function parseChapter(value: string | null): AudiobookChapter | null {
  if (!value) return null;
  try { const chapter = JSON.parse(value) as AudiobookChapter; return typeof chapter?.id === "string" && typeof chapter.fileId === "string" ? chapter : null; } catch { return null; }
}
/** Pure helpers keep queue navigation testable without a browser audio implementation. */
export function queuedNext(queue: readonly AudiobookChapter[], currentId?: string): AudiobookChapter | undefined { const index = queue.findIndex(value => value.id === currentId); return index >= 0 ? queue[index + 1] : undefined; }
export function queuedPrevious(queue: readonly AudiobookChapter[], currentId?: string): AudiobookChapter | undefined { const index = queue.findIndex(value => value.id === currentId); return index > 0 ? queue[index - 1] : undefined; }
