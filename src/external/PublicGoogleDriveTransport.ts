import { NativeGoogleDrivePublicIdentity } from "../services/NativeGoogleDrivePublicIdentity";

export interface PublicDriveResource { id: string; key?: string; }
export interface PublicDriveRequestFailure { status: number; reason?: string; message?: string; }

/**
 * Anonymous, API-key based transport used only for material explicitly shared as
 * “anyone with the link”.  It owns no OAuth token and never adds Authorization.
 */
export class PublicGoogleDriveTransport {
  public constructor(private readonly apiKey = import.meta.env?.VITE_GOOGLE_DRIVE_PUBLIC_API_KEY ?? "",
    private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private readonly identity: () => Promise<{ packageName: string; sha1: string } | null> = () => NativeGoogleDrivePublicIdentity.callerIdentity()) {}

  public get configured(): boolean { return Boolean(this.apiKey.trim()); }

  public async request(path: string, signal: AbortSignal, resource?: PublicDriveResource, extra: Record<string, string> = {}): Promise<Response> {
    if (!this.configured) throw new Error("DRIVE_PUBLIC_API_KEY_NOT_CONFIGURED");
    const headers: Record<string, string> = { ...extra, "x-goog-api-key": this.apiKey };
    if (resource?.key) headers["X-Goog-Drive-Resource-Keys"] = `${resource.id}/${resource.key}`;
    const caller = await this.identity();
    if (caller) {
      headers["X-Android-Package"] = caller.packageName;
      // Cloud Console accepts its SHA-1 display format with colons, but the Android
      // request header requires the 20-byte digest encoded as 40 Base16 characters.
      const certificate = caller.sha1.replace(/[^0-9a-f]/gi, "").toUpperCase();
      if (/^[A-F0-9]{40}$/.test(certificate)) headers["X-Android-Cert"] = certificate;
    }
    // Never log the path (which can contain a book id) or the API key.
    console.info(JSON.stringify({ event: "DRIVE_PUBLIC_REQUEST", androidIdentity: Boolean(caller), resourceKey: Boolean(resource?.key) }));
    const response = await this.fetcher(`https://www.googleapis.com/drive/v3/${path}`, {
      headers, signal, credentials: "omit", referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      const failure = await PublicGoogleDriveTransport.failure(response);
      // The API response has no credentials. Do not include request URLs or file IDs.
      console.warn(JSON.stringify({ event: "DRIVE_PUBLIC_RESPONSE", status: failure.status, reason: failure.reason ?? null, message: failure.message ?? null,
        androidIdentity: Boolean(caller), androidCertHeader: Boolean(headers["X-Android-Cert"]) }));
    }
    return response;
  }

  /** Google error payloads are small and safe to reduce to their category. */
  public static async failure(response: Response): Promise<PublicDriveRequestFailure> {
    let reason: string | undefined, message: string | undefined;
    try {
      const body = await response.clone().json() as { error?: { errors?: Array<{ reason?: unknown }>; status?: unknown; message?: unknown } };
      const error = body.error;
      reason = typeof error?.errors?.[0]?.reason === "string" ? error.errors[0].reason : typeof error?.status === "string" ? error.status : undefined;
      message = typeof error?.message === "string" ? error.message.slice(0, 160) : undefined;
    } catch { /* Non-JSON failures are classified by HTTP status only. */ }
    return { status: response.status, reason, message };
  }
}
