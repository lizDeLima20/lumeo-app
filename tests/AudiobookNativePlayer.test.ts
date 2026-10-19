import assert from "node:assert/strict";
import { it } from "node:test";
import type { AudiobookChapter } from "../src/audiobooks/AudiobookLibrary";
import type { NativeAudiobookItem, NativeAudiobookState } from "../src/audiobooks/NativeAudiobook";
import { AudiobookPlayer, nativeItem, resumeAt, type AudiobookPlayerState, type NativeAudiobookPlayer } from "../src/audiobooks/AudiobookPlayer";
import { GoogleDriveLibraryService } from "../src/external/GoogleDriveLibraryService";
import type { AudiobookProgress } from "../src/repositories/AudiobookProgressRepository";

// The page's own <audio> is not used in these tests; Node has none.
class FakeAudio extends EventTarget { preload = ""; src = ""; currentTime = 0; duration = NaN; playbackRate = 1; pause(): void {} load(): void {} play(): Promise<void> { return Promise.resolve(); } removeAttribute(): void { this.src = ""; } }
Object.assign(globalThis, { Audio: FakeAudio, window: globalThis });

const chapters: AudiobookChapter[] = ["1", "2", "3"].map(id => ({ id: `audio:s:${id}`, sourceId: "s", fileId: `f${id}`, name: `${id}.mp3`, title: `Capítulo ${id}`, mimeType: "audio/mpeg", collection: "Saga", folderPath: [], resourceKey: id === "2" ? "rk" : undefined }));

function idle(): NativeAudiobookState { return { id: null, chapter: null, index: -1, count: 0, playing: false, playWhenReady: false, buffering: false, ended: false, idle: true, positionMs: 0, durationMs: 0, speed: 1, cachedPercent: -1 }; }
function nativeFake(initial = idle()) {
  const calls: Array<[string, unknown?]> = []; let listener: ((state: NativeAudiobookState) => void) | null = null; let current = initial;
  const answer = (name: string, args?: unknown) => { calls.push([name, args]); return Promise.resolve(current); };
  const native: NativeAudiobookPlayer = {
    open: options => answer("open", options), play: () => answer("play"), pause: () => answer("pause"), next: () => answer("next"), previous: () => answer("previous"),
    seekTo: options => answer("seekTo", options), seekBy: options => answer("seekBy", options), setSpeed: options => answer("setSpeed", options), getState: () => Promise.resolve(current),
    addListener: (_event, value) => { listener = value; return Promise.resolve({ remove: () => Promise.resolve() }); },
  };
  return { native, calls, emit: (state: Partial<NativeAudiobookState>) => { current = { ...current, ...state }; listener?.(current); } };
}
function progressFake(saved: AudiobookProgress[] = []) {
  const values = new Map(saved.map(value => [value.audiobookId, value]));
  return { values, repository: { get: (id: string) => Promise.resolve(values.get(id) ?? null), save: (value: AudiobookProgress) => { values.set(value.audiobookId, value); return Promise.resolve(); } } };
}
const publicDrive = () => new GoogleDriveLibraryService("", undefined, "public-key", () => Promise.resolve({ packageName: "com.lumeo.reader", sha1: "aa:".repeat(19) + "aa" }));
const noFiles = { get: () => Promise.resolve(null), save: () => Promise.resolve() };
const player = (native: NativeAudiobookPlayer, progress = progressFake().repository, drive = publicDrive()) => new AudiobookPlayer(drive, noFiles as never, progress as never, native);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

it("toca no player nativo com a fila inteira, os cabeçalhos do Drive e a posição salva", async () => {
  const fake = nativeFake(), progress = progressFake([{ audiobookId: chapters[1].id, positionSeconds: 95.5, durationSeconds: 600, updatedAt: "x" }]);
  await player(fake.native, progress.repository).play(chapters[1], chapters);
  const [name, options] = fake.calls.find(([call]) => call === "open")! as [string, { items: NativeAudiobookItem[]; index: number; positionMs: number; play: boolean; headers: Record<string, string> }];
  assert.equal(name, "open");
  assert.deepEqual(options.items.map(item => item.id), chapters.map(chapter => chapter.id));
  assert.equal(options.index, 1); assert.equal(options.positionMs, 95_500);
  // Loaded paused while the tone arm moves, then started.
  assert.equal(options.play, false); assert.equal(fake.calls.at(-1)?.[0], "play");
  assert.equal(options.headers["x-goog-api-key"], "public-key"); assert.equal(options.headers["X-Android-Package"], "com.lumeo.reader");
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.items[1].uri, "https://www.googleapis.com/drive/v3/files/f2?alt=media&supportsAllDrives=true");
  assert.deepEqual(options.items[1].headers, { "X-Goog-Drive-Resource-Keys": "f2/rk" });
  assert.deepEqual(options.items[0].headers, {});
});

it("segue o que a notificação faz: próximo capítulo, pausa e posição salva", async () => {
  const fake = nativeFake(), progress = progressFake(), audio = player(fake.native, progress.repository); let state: AudiobookPlayerState | null = null;
  audio.subscribe(value => { state = value; });
  await audio.play(chapters[0], chapters);
  fake.emit({ id: chapters[0].id, index: 0, count: 3, playing: true, playWhenReady: true, idle: false, positionMs: 12_000, durationMs: 600_000 });
  assert.equal(state!.playing, true); assert.equal(state!.position, 12);
  fake.emit({ id: chapters[1].id, chapter: JSON.stringify(chapters[1]), index: 1, positionMs: 0, durationMs: 300_000 });
  assert.equal(state!.chapter?.id, chapters[1].id); assert.equal(state!.queueIndex, 1);
  fake.emit({ playing: false, playWhenReady: false, positionMs: 42_000 });
  await tick();
  assert.equal(state!.playing, false);
  assert.equal(progress.values.get(chapters[1].id)?.positionSeconds, 42);
});

it("os botões da tela comandam o player nativo", async () => {
  const fake = nativeFake(), audio = player(fake.native);
  await audio.play(chapters[0], chapters);
  fake.emit({ id: chapters[0].id, index: 0, count: 3, playing: true, playWhenReady: true, idle: false, positionMs: 30_000, durationMs: 600_000 });
  fake.calls.length = 0;
  audio.seekBy(-15); audio.seek(120); audio.setSpeed(1.5); audio.pause(); await audio.next(); await audio.previous();
  assert.deepEqual(fake.calls.map(([name, args]) => args === undefined ? name : [name, args]), [["seekBy", { deltaMs: -15_000 }], ["seekTo", { positionMs: 120_000 }], ["setSpeed", { speed: 1.5 }], "pause", "next", "previous"]);
});

it("reabre a tela mostrando o capítulo que a notificação ainda toca", async () => {
  const fake = nativeFake({ ...idle(), id: chapters[2].id, chapter: JSON.stringify(chapters[2]), index: 2, count: 3, idle: false, playing: true, playWhenReady: true, positionMs: 5_000, durationMs: 60_000 });
  const audio = player(fake.native); let state: AudiobookPlayerState | null = null;
  audio.subscribe(value => { state = value; }); await tick();
  assert.equal(state!.chapter?.title, "Capítulo 3"); assert.equal(state!.playing, true);
  await audio.toggle(chapters[2], chapters);
  assert.equal(fake.calls.at(-1)?.[0], "pause");
});

it("ignora eventos do capítulo anterior enquanto o novo é aberto", async () => {
  const fake = nativeFake(), audio = player(fake.native); let state: AudiobookPlayerState | null = null;
  audio.subscribe(value => { state = value; });
  const playing = audio.play(chapters[2], chapters);
  fake.emit({ id: chapters[0].id, index: 0, count: 3, playing: false, idle: false, positionMs: 1_000, durationMs: 600_000 });
  assert.equal(state!.chapter?.id, chapters[2].id);
  await playing;
});

it("recomeça do início um capítulo ouvido até o fim", () => {
  assert.equal(resumeAt(null), 0);
  assert.equal(resumeAt({ positionSeconds: 30 }), 30);
  assert.equal(resumeAt({ positionSeconds: 599, durationSeconds: 600 }), 0);
  assert.equal(nativeItem({ ...chapters[0], coverUrl: "https://example.test/c.jpg" }, "u", {}).artworkUri, "https://example.test/c.jpg");
  assert.equal(nativeItem({ ...chapters[0], coverUrl: "blob:local" }, "u", {}).artworkUri, undefined);
});
