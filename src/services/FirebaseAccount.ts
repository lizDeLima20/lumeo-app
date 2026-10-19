import { Capacitor, registerPlugin, type Plugin } from "@capacitor/core";

export interface FirebaseAccountUser { uid: string; email: string | null; displayName: string | null; photoUrl: string | null; }
export interface FirebaseAccountState { configured: boolean; user?: FirebaseAccountUser; }

interface FirebaseAccountPlugin extends Plugin {
  current(): Promise<FirebaseAccountState>;
  signInWithGoogle(): Promise<FirebaseAccountState>;
  signOut(): Promise<FirebaseAccountState>;
}

const NativeFirebaseAccount = registerPlugin<FirebaseAccountPlugin>("FirebaseAccount");

/** Error codes the native side answers with; anything else is a generic failure. */
export type FirebaseAccountErrorCode = "NOT_CONFIGURED" | "NO_WEB_CLIENT" | "CANCELLED" | "NO_ACCOUNT" | "GOOGLE_FAILED" | "FIREBASE_FAILED" | "UNKNOWN";

export class FirebaseAccountError extends Error {
  public constructor(public readonly code: FirebaseAccountErrorCode, message: string) { super(message); }
}

/**
 * The Lumeo account on Android: Firebase Authentication signed in with Google. The session is
 * kept by Firebase on the device, so a signed-in reader opens straight to the library, even
 * offline. Only the Android app has it; elsewhere `required` is false and nothing changes.
 */
export class FirebaseAccount {
  public static get required(): boolean {
    return typeof window !== "undefined" && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("FirebaseAccount");
  }

  public static async current(): Promise<FirebaseAccountState> {
    return NativeFirebaseAccount.current();
  }

  /** Google's account picker, then Firebase. The first sign-in with an account creates it. */
  public static async signInWithGoogle(): Promise<FirebaseAccountUser> {
    try {
      const state = await NativeFirebaseAccount.signInWithGoogle();
      if (!state.user) throw new FirebaseAccountError("FIREBASE_FAILED", "O Firebase não devolveu a conta.");
      return state.user;
    } catch (error) {
      if (error instanceof FirebaseAccountError) throw error;
      const code = (error as { code?: string }).code;
      const known: FirebaseAccountErrorCode[] = ["NOT_CONFIGURED", "NO_WEB_CLIENT", "CANCELLED", "NO_ACCOUNT", "GOOGLE_FAILED", "FIREBASE_FAILED"];
      throw new FirebaseAccountError(known.includes(code as FirebaseAccountErrorCode) ? code as FirebaseAccountErrorCode : "UNKNOWN",
        error instanceof Error && error.message ? error.message : "Não foi possível entrar com o Google.");
    }
  }

  public static async signOut(): Promise<void> {
    await NativeFirebaseAccount.signOut();
  }
}
