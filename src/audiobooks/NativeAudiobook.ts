import { Capacitor, registerPlugin, type Plugin, type PluginListenerHandle } from "@capacitor/core";

export interface NativeAudiobookItem { id: string; uri: string; title: string; collection: string; artworkUri?: string; headers?: Record<string, string>; chapter: string; }
/** What the Android player is doing, sent on every change and every second while playing. */
export interface NativeAudiobookState {
  id: string | null; chapter: string | null; index: number; count: number; playing: boolean; playWhenReady: boolean; buffering: boolean; ended: boolean; idle: boolean;
  positionMs: number; durationMs: number; speed: number; cachedPercent: number; error?: string;
}
interface NativeAudiobookPlugin extends Plugin {
  open(options: { items: NativeAudiobookItem[]; index: number; positionMs: number; speed: number; play: boolean; headers: Record<string, string> }): Promise<NativeAudiobookState>;
  play(): Promise<NativeAudiobookState>; pause(): Promise<NativeAudiobookState>; stop(): Promise<NativeAudiobookState>;
  next(): Promise<NativeAudiobookState>; previous(): Promise<NativeAudiobookState>;
  seekTo(options: { positionMs: number }): Promise<NativeAudiobookState>; seekBy(options: { deltaMs: number }): Promise<NativeAudiobookState>;
  setSpeed(options: { speed: number }): Promise<NativeAudiobookState>; getState(): Promise<NativeAudiobookState>;
  addListener(event: "state", listener: (state: NativeAudiobookState) => void): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<NativeAudiobookPlugin>("NativeAudiobook");

/**
 * Lumeo's Android audiobook player (Media3 in a foreground service): a chapter keeps playing
 * with the app in the background and is controlled from the notification, the lock screen and
 * headsets. Elsewhere (the web build) `available` is false and the in-page player is used.
 */
export const NativeAudiobook = {
  get available(): boolean { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("NativeAudiobook"); },
  plugin,
};
