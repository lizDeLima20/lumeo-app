import { Capacitor } from "@capacitor/core";

export type FrontendEnvironment = "development" | "test" | "production";

export interface FrontendEnvironmentConfig {
  appEnv: FrontendEnvironment;
  appVersion: string;
  appBaseUrl: string;
  bffBaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export class EnvironmentConfig {
  public constructor(private readonly env: ImportMetaEnv = import.meta.env, private readonly isNativeAndroid = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {}

  public read(): FrontendEnvironmentConfig {
    return {
      appEnv: this.normalize(this.env.VITE_APP_ENV ?? this.env.MODE),
      appVersion: this.env.VITE_APP_VERSION ?? "0.1.0",
      appBaseUrl: this.env.VITE_APP_BASE_URL ?? globalThis.location?.origin ?? "",
      bffBaseUrl: this.apiBaseUrl(),
      supabaseUrl: this.env.VITE_SUPABASE_URL ?? "",
      supabasePublishableKey: this.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? this.env.VITE_SUPABASE_ANON_KEY ?? "",
    };
  }

  private apiBaseUrl(): string {
    // The Android app is a personal library. Its local-file and Google Drive
    // flows never use a BFF, regardless of values left in a developer shell.
    // Keeping this empty also prevents a Capacitor WebView from resolving an
    // accidental relative /api request against https://localhost.
    if (this.isNativeAndroid()) {
      return "";
    }
    // Production BFF is served by the same Vercel deployment. Never bake a
    // developer's localhost override into production requests.
    if (this.env.PROD || this.env.MODE === "production") return "/api";
    return this.env.VITE_API_URL?.replace(/\/$/, "") || "http://localhost:3000/api";
  }

  public assertNoFrontendSecrets(keys: readonly string[] = Object.keys(this.env)): boolean {
    return keys.every((key) => !/(SERVICE_ROLE|ROLE_KEY|DEVICE_HASH_SECRET|HMAC|PRIVATE_KEY|PAYMENT_SECRET|SECRET_KEY|SECRET)$/i.test(key));
  }

  public assertNoSecretValues(values: readonly string[]): boolean {
    return values.every((value) => !/^sb_secret_/i.test(value));
  }

  private normalize(value?: string): FrontendEnvironment {
    if (value === "production" || value === "test") return value;
    return "development";
  }
}
