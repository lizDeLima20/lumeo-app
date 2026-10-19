import { Capacitor, registerPlugin } from "@capacitor/core";

interface NativeGoogleDrivePublicIdentityPlugin {
  callerIdentity(): Promise<{ packageName: string; sha1: string }>;
}

const nativeIdentity = registerPlugin<NativeGoogleDrivePublicIdentityPlugin>("GoogleDrivePublicIdentity");

/**
 * The Cloud Console Android restriction is evaluated from these two request headers.
 * They are read from the package actually running on the device instead of being copied
 * into the WebView bundle.  The fingerprint is public certificate metadata, never a key.
 */
export class NativeGoogleDrivePublicIdentity {
  public static get available(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  }

  public static async callerIdentity(): Promise<{ packageName: string; sha1: string } | null> {
    if (!this.available) return null;
    const result = await nativeIdentity.callerIdentity();
    return result.packageName?.trim() && result.sha1?.trim()
      ? { packageName: result.packageName.trim(), sha1: result.sha1.trim() }
      : null;
  }
}
