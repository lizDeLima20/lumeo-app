import { Capacitor, registerPlugin } from "@capacitor/core";

interface NativeGoogleDriveAuthorizationPlugin {
  authorize(options: { scope: string }): Promise<{ accessToken: string }>;
}

const nativeAuthorization = registerPlugin<NativeGoogleDriveAuthorizationPlugin>("GoogleDriveAuthorization");

/** Google Identity Services on Android, which owns the account/consent UI. */
export class NativeGoogleDriveAuthorization {
  public static get available(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  }

  public static async accessToken(scope: string): Promise<string> {
    const result = await nativeAuthorization.authorize({ scope });
    if (!result.accessToken?.trim()) throw new Error("GOOGLE_OAUTH_ACCESS_DENIED");
    return result.accessToken;
  }
}
