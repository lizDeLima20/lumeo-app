import { Capacitor, registerPlugin, type Plugin } from "@capacitor/core";

interface ReaderAwakePlugin extends Plugin {
  keep(): Promise<{ awake: boolean }>;
  release(): Promise<{ awake: boolean }>;
}

const NativeReaderAwake = registerPlugin<ReaderAwakePlugin>("ReaderAwake");

interface ScreenWakeLock { released: boolean; release(): Promise<void>; }

/**
 * The screen stays on while a book or a comic is open, and goes back to the phone's own
 * timeout the moment the reader closes. On Android this is the Lumeo window's own
 * keep-screen-on flag (nothing system-wide, nothing in the background); in a browser that
 * offers it, a screen wake lock, asked for again when the page comes back into view since
 * the browser drops it whenever the page is hidden. Anywhere else it does nothing.
 */
export class ReaderScreenAwake {
  private static wanted = false;
  private static lock: ScreenWakeLock | null = null;
  private static listening = false;

  public static async keep(): Promise<void> {
    ReaderScreenAwake.wanted = true;
    if (ReaderScreenAwake.native) { try { await NativeReaderAwake.keep(); } catch { /* the phone's own timeout applies */ } return; }
    ReaderScreenAwake.listen();
    await ReaderScreenAwake.requestWebLock();
  }

  public static async release(): Promise<void> {
    ReaderScreenAwake.wanted = false;
    if (ReaderScreenAwake.native) { try { await NativeReaderAwake.release(); } catch { /* nothing to release */ } return; }
    const lock = ReaderScreenAwake.lock; ReaderScreenAwake.lock = null;
    try { await lock?.release(); } catch { /* already released */ }
  }

  private static get native(): boolean {
    return typeof window !== "undefined" && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ReaderAwake");
  }

  private static async requestWebLock(): Promise<void> {
    const wakeLock = typeof navigator === "object" ? (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<ScreenWakeLock> } }).wakeLock : undefined;
    if (!wakeLock || !ReaderScreenAwake.wanted || (ReaderScreenAwake.lock && !ReaderScreenAwake.lock.released)) return;
    try { ReaderScreenAwake.lock = await wakeLock.request("screen"); } catch { /* not allowed here: the screen's own timeout applies */ }
  }

  private static listen(): void {
    if (ReaderScreenAwake.listening || typeof document === "undefined") return;
    ReaderScreenAwake.listening = true;
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void ReaderScreenAwake.requestWebLock(); });
  }
}
