import { Capacitor } from "@capacitor/core";
import type { FrontendEnvironmentConfig } from "../config/EnvironmentConfig";

/** Native-only diagnostics. This intentionally performs no readiness probe or backend request. */
export class AndroidRuntimeDiagnostics {
  public static start(_config: FrontendEnvironmentConfig): void {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
    console.info("LUMEO_ANDROID_PERSONAL_LIBRARY_READY", JSON.stringify({
      origin: this.safeUrl(globalThis.location?.origin ?? ""),
      callback: "com.lumeo.reader://auth/callback",
      packageName: "com.lumeo.reader",
      googleDriveAuthorization: "native",
    }));
  }

  private static safeUrl(value: string): string | null {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
    catch { return value.startsWith("/") ? value : null; }
  }
}
