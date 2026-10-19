import { I18nManager } from "../i18n/I18nManager";
import { BookDownloadError, StartTelemetry } from "../diagnostics/StartTelemetry";
import { GoogleDriveAuthorizationError, GoogleDriveAuthorizationProvider } from "../services/GoogleDriveAuthorizationProvider";
import { GoogleIdentityServices } from "../services/GoogleIdentityServices";
import { NativeGoogleDriveAuthorization } from "../services/NativeGoogleDriveAuthorization";
import { PublicGoogleDriveTransport, type PublicDriveRequestFailure } from "./PublicGoogleDriveTransport";
export interface GoogleLibraryFile { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; resourceKey?: string;
  /** Drive's own short-lived thumbnail URL (hours), when Drive rendered one. */
  thumbnailLink?: string; hasThumbnail?: boolean; }
class GoogleDriveRequestError extends Error {
  public constructor(public readonly status: number, public readonly reason?: string, cause?: unknown) { super("Google Drive request failed"); this.name = "GoogleDriveRequestError"; Object.defineProperty(this, "cause", { value: cause, enumerable: false }); }
}
export class GoogleDriveAccessError extends Error {
  public constructor(public readonly code: "DRIVE_ACCOUNT_NOT_AUTHORIZED" | "DRIVE_FOLDER_FORBIDDEN" | "DRIVE_ITEM_NOT_FOUND" | "DRIVE_CONNECTION_FAILED" | "DRIVE_PUBLIC_KEY_REJECTED" | "DRIVE_RATE_LIMITED" | "DRIVE_DOWNLOAD_REQUIRES_AUTH") { super(code); this.name = "GoogleDriveAccessError"; }
}
export class GoogleDriveLibraryService {
  public static readonly FOLDER = "application/vnd.google-apps.folder";
  /** Largest catalog.json accepted (characters): ~4 KB per record leaves room for ~8000 books. */
  public static readonly MAX_CATALOG_CHARS = 32 * 1024 * 1024;
  private token = ""; private expires = 0; private loading: Promise<void> | null = null;
  private readonly downloads = new Map<string, Promise<File>>();
  private readonly authorization: GoogleDriveAuthorizationProvider;
  private readonly publicTransport: PublicGoogleDriveTransport;
  // Keep Window as the receiver on Android WebView. Passing bare `fetch` and invoking it
  // as a class property throws "Illegal invocation" on some Chromium builds.
  public constructor(private readonly clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "", private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
    publicApiKey = import.meta.env?.VITE_GOOGLE_DRIVE_PUBLIC_API_KEY ?? "", publicIdentity?: ConstructorParameters<typeof PublicGoogleDriveTransport>[2]) {
    this.authorization = new GoogleDriveAuthorizationProvider(clientId);
    this.publicTransport = new PublicGoogleDriveTransport(publicApiKey, fetcher, publicIdentity);
  }
  public get configured(): boolean { return this.publicTransport.configured || this.authorization.configured; }
  /** A configured public transport can list public links without an OAuth token. */
  public get authorized(): boolean { return this.publicTransport.configured || (!!this.token && Date.now() < this.expires); }
  public get publicConfigured(): boolean { return this.publicTransport.configured; }
  private error(): Error { return new Error(I18nManager.shared.t("google.failed")); }
  public prepare(): Promise<void> {
    if (!this.configured) return Promise.reject(new Error(I18nManager.shared.t("google.notConfigured")));
    // Android must never load Google Identity Services in the embedded WebView.
    // The native plugin owns consent and returns the short-lived Drive token.
    if (this.publicTransport.configured || NativeGoogleDriveAuthorization.available || (this.authorization.configured && !this.clientId)) return Promise.resolve();
    return this.loading ??= GoogleIdentityServices.load().then(() => undefined).catch(() => { this.loading = null; throw this.error(); });
  }
  /** Called by the explicit Connect button; native Android uses Google Identity. */
  public async connect(): Promise<void> {
    try { this.token = await this.authorization.accessToken(); this.expires = Date.now() + 55 * 60_000; }
    catch (error) {
      if (error instanceof GoogleDriveAuthorizationError && (error.code === "GOOGLE_OAUTH_ACCESS_DENIED" || error.code === "GOOGLE_OAUTH_CANCELLED")) throw new GoogleDriveAccessError("DRIVE_ACCOUNT_NOT_AUTHORIZED");
      throw new GoogleDriveAccessError("DRIVE_CONNECTION_FAILED");
    }
  }
  public dispose(): void { this.token = ""; this.expires = 0; this.authorization.clear(); }
  private async request(path: string, signal: AbortSignal, resource?: { id: string; key?: string }, extra: Record<string, string> = {}, allowInteractivePrivateFallback = false): Promise<Response> {
    // A link shared as “anyone with the link” is always attempted through the independent
    // API-key transport first. This deliberately has no bearer token, so public folders do
    // not cause the restricted Drive consent screen to appear.
    if (this.publicTransport.configured) {
      const publicResponse = await this.publicTransport.request(path, signal, resource, extra);
      if (publicResponse.ok) return publicResponse;
      const failure = await PublicGoogleDriveTransport.failure(publicResponse);
      if (!this.authorizedPrivate() && (!allowInteractivePrivateFallback || !this.mayUsePrivateFallback(failure))) throw new GoogleDriveRequestError(failure.status, failure.reason);
      // A private/unshared link is retried only via the pre-existing native OAuth transport.
      // Invalid/restricted keys, quota, and network errors never prompt for Drive access.
      if (!this.authorizedPrivate()) await this.connect();
    }
    if (!this.authorizedPrivate()) throw this.error();
    const headers: Record<string, string> = { ...extra, Authorization: `Bearer ${this.token}` };
    if (resource?.key) headers["X-Goog-Drive-Resource-Keys"] = `${resource.id}/${resource.key}`;
    const response = await this.fetcher(`https://www.googleapis.com/drive/v3/${path}`, {
      headers, signal, credentials: "omit", referrerPolicy: "no-referrer",
    });
    if (response.status === 401) this.dispose();
    if (!response.ok) throw new GoogleDriveRequestError(response.status, (await PublicGoogleDriveTransport.failure(response)).reason); return response;
  }
  private authorizedPrivate(): boolean { return !!this.token && Date.now() < this.expires; }
  private mayUsePrivateFallback(failure: PublicDriveRequestFailure): boolean {
    if (failure.status === 404) return true;
    if (failure.status !== 403) return false;
    // Only content-visibility denials may be made accessible by a user consent. A rejected
    // Android key, a disabled API, or a quota denial must be shown as such instead.
    return ["insufficientFilePermissions", "insufficientPermissions", "notFound", "fileNotFound"].includes(failure.reason ?? "");
  }
  public async list(id: string, key: string | undefined, signal: AbortSignal, pageToken?: string): Promise<{ files: GoogleLibraryFile[]; nextPageToken?: string }> {
    const result = await this.listRaw(id, key, signal, pageToken);
    return { ...result, files: result.files.filter(file => file.mimeType === GoogleDriveLibraryService.FOLDER || /\.(pdf|epub|cbr|cbz)$/i.test(file.name)) };
  }
  /** Metadata-only folder page used by the local structured-catalog resolver. It is still
   * the official authenticated Drive API; callers must never scrape the Drive HTML UI. */
  public async listRaw(id: string, key: string | undefined, signal: AbortSignal, pageToken?: string, pageSize = 100): Promise<{ files: GoogleLibraryFile[]; nextPageToken?: string }> {
    if (!/^[\w-]+$/.test(id)) throw this.error();
    const timed = portableTimeout(signal, 30_000);
    try {
      const folder = await (await this.request(`files/${encodeURIComponent(id)}?fields=mimeType&supportsAllDrives=true`, timed.signal, { id, key }, {}, true)).json() as GoogleLibraryFile;
      if (folder.mimeType !== GoogleDriveLibraryService.FOLDER) throw this.error();
      const query = new URLSearchParams({ q: `'${id}' in parents and trashed=false`, pageSize: String(Math.min(1000, Math.max(1, pageSize))),
        fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,resourceKey,thumbnailLink,hasThumbnail)", orderBy: "folder,name_natural", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
      if (pageToken) query.set("pageToken", pageToken);
      const result = await (await this.request(`files?${query}`, timed.signal, { id, key })).json() as { files: GoogleLibraryFile[]; nextPageToken?: string };
      return { ...result, files: Array.isArray(result.files) ? result.files : [] };
    } catch (error) {
      if (error instanceof GoogleDriveRequestError) throw this.accessError(error.status, error.reason);
      throw error;
    } finally { timed.dispose(); }
  }
  /** A byte range of a file (inclusive end), for reading only what a cover needs - for
   *  instance a CBZ's central directory and first image - never the whole file. */
  public async range(file: Pick<GoogleLibraryFile, "id" | "resourceKey">, start: number, end: number, signal: AbortSignal): Promise<{ bytes: Uint8Array; total: number | null }> {
    if (!/^[\w-]+$/.test(file.id) || start < 0 || end < start) throw this.error();
    const timed = portableTimeout(signal, 30_000);
    try {
      const response = await this.request(`files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, timed.signal, { id: file.id, key: file.resourceKey }, { Range: `bytes=${start}-${end}` });
      const total = Number(/\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1]) || null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      // A server that ignores Range sends the whole file: refuse instead of keeping it.
      if (response.status !== 206 && bytes.length > end - start + 1) throw new Error("DRIVE_RANGE_UNSUPPORTED");
      return { bytes, total };
    } catch (error) { if (error instanceof GoogleDriveRequestError) throw this.accessError(error.status, error.reason); throw error; }
    finally { timed.dispose(); }
  }
  /** A fresh thumbnail link: the one from the listing expires after a few hours. */
  public async thumbnailLink(file: Pick<GoogleLibraryFile, "id" | "resourceKey">, signal: AbortSignal): Promise<string | null> {
    if (!/^[\w-]+$/.test(file.id)) throw this.error();
    const timed = portableTimeout(signal, 30_000);
    try {
      const value = await (await this.request(`files/${encodeURIComponent(file.id)}?fields=thumbnailLink&supportsAllDrives=true`, timed.signal, { id: file.id, key: file.resourceKey })).json() as { thumbnailLink?: string };
      return value.thumbnailLink ?? null;
    } catch (error) { if (error instanceof GoogleDriveRequestError) throw this.accessError(error.status, error.reason); throw error; }
    finally { timed.dispose(); }
  }
  /** Finds a small structural file without guessing where it lands in paginated order. */
  public async childNamed(folderId: string, name: string, key: string | undefined, signal: AbortSignal): Promise<GoogleLibraryFile | null> {
    if (!/^[\w-]+$/.test(folderId) || !name || name.length > 255) throw this.error();
    const timed = portableTimeout(signal, 30_000);
    try {
      const query = new URLSearchParams({ q: `'${folderId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed=false`, pageSize: "2",
        fields: "files(id,name,mimeType,size,modifiedTime,resourceKey)", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
      const result = await (await this.request(`files?${query}`, timed.signal, { id: folderId, key })).json() as { files?: GoogleLibraryFile[] };
      return result.files?.[0] ?? null;
    } catch (error) { if (error instanceof GoogleDriveRequestError) throw this.accessError(error.status, error.reason); throw error; }
    finally { timed.dispose(); }
  }
  /** Reads a small Drive metadata document locally. Catalogs never pass through a server. */
  public async json(file: GoogleLibraryFile, signal: AbortSignal): Promise<unknown> {
    if (!/\.json$/i.test(file.name)) throw new Error("DRIVE_CATALOG_NOT_JSON");
    // A catalog of a few thousand books with synopses is several MB (Romance: 4234 records,
    // 8.5 MB); slow mobile links need more than the usual 30 s to bring it.
    const timed = portableTimeout(signal, 120_000);
    try {
      const response = await this.request(`files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, timed.signal, { id: file.id, key: file.resourceKey });
      const body = await response.text();
      if (body.length > GoogleDriveLibraryService.MAX_CATALOG_CHARS) throw new Error("DRIVE_CATALOG_TOO_LARGE");
      if (/^\s*(?:<!doctype|<html|<head)/i.test(body)) throw new Error("DRIVE_CATALOG_INVALID");
      try { return JSON.parse(body) as unknown; } catch { throw new Error("DRIVE_CATALOG_INVALID"); }
    } catch (error) {
      if (error instanceof GoogleDriveRequestError) throw this.accessError(error.status, error.reason);
      throw error;
    } finally { timed.dispose(); }
  }
  /** Read the canonical name and type before importing a shared file URL. */
  public async metadata(id: string, key: string | undefined, signal: AbortSignal): Promise<GoogleLibraryFile> {
    if (!/^[\w-]+$/.test(id)) throw this.error();
    const timed = portableTimeout(signal, 30_000);
    try {
      const file = await (await this.request(`files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime,resourceKey&supportsAllDrives=true`, timed.signal, { id, key }, {}, true)).json() as GoogleLibraryFile;
      if (!file.id || !file.name || (file.mimeType !== GoogleDriveLibraryService.FOLDER && !/\.(pdf|epub|cbr|cbz)$/i.test(file.name))) throw this.error();
      return file;
    } catch (error) {
      if (error instanceof GoogleDriveRequestError) throw this.accessError(error.status, error.reason);
      throw error;
    } finally { timed.dispose(); }
  }
  public async download(file: GoogleLibraryFile, signal: AbortSignal, progress: (percent: number | null) => void): Promise<File> {
    if (this.downloads.has(file.id)) throw new BookDownloadError("DOWNLOAD_ALREADY_RUNNING", "PREPARING", file.id);
    const job = this.downloadWithRetry(file, signal, progress).finally(() => this.downloads.delete(file.id));
    this.downloads.set(file.id, job); return job;
  }
  /** Downloads one audiobook chapter only after the user presses Play. This remains
   * separate from the stricter book reader download validation. */
  public async downloadAudio(file: GoogleLibraryFile, signal: AbortSignal, progress: (percent: number | null) => void): Promise<File> {
    if (this.downloads.has(file.id)) throw new BookDownloadError("DOWNLOAD_ALREADY_RUNNING", "PREPARING", file.id);
    const job = this.downloadAudioWithRetry(file, signal, progress).finally(() => this.downloads.delete(file.id));
    this.downloads.set(file.id, job); return job;
  }
  private async downloadAudioWithRetry(file: GoogleLibraryFile, signal: AbortSignal, progress: (percent: number | null) => void): Promise<File> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.downloadAudioOnce(file, signal, progress); }
      catch (error) { last = error; if (!(error instanceof BookDownloadError) || !error.retryable || signal.aborted || attempt === 2) throw error; await new Promise<void>(resolve => setTimeout(resolve, 250 * (attempt + 1))); }
    }
    throw last;
  }
  private async downloadAudioOnce(file: GoogleLibraryFile, signal: AbortSignal, progress: (percent: number | null) => void): Promise<File> {
    const max = 512 * 1024 * 1024, size = Number(file.size) || 0;
    if (size > max || !/\.(mp3|m4a|aac|ogg|opus|wav)$/i.test(file.name)) throw new BookDownloadError("EPUB_INVALID", "VALIDATING", file.id);
    const endpoint = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`;
    StartTelemetry.request(file.id, endpoint, "DOWNLOADING");
    const timed = portableTimeout(signal, 180_000);
    try {
      const response = await this.request(`files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, timed.signal, { id: file.id, key: file.resourceKey });
      const reader = response.body?.getReader(); if (!reader) throw new BookDownloadError("MOBILE_API_UNSUPPORTED", "DOWNLOADING", file.id);
      progress(size ? 0 : null); let bytes = 0; const chunks: BlobPart[] = [];
      try { while (true) { assertNotAborted(timed.signal); const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > max) throw new BookDownloadError("EPUB_INVALID", "VALIDATING", file.id);
        chunks.push(new Uint8Array(value).buffer); progress(size ? Math.min(100, Math.round(bytes / size * 100)) : null);
      } } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      assertNotAborted(timed.signal); if (size && bytes !== size) throw new BookDownloadError("DOWNLOAD_NETWORK_FAILED", "DOWNLOADING", file.id, undefined, true);
      StartTelemetry.request(file.id, endpoint, "VALIDATING"); return new File(chunks, file.name, { type: file.mimeType || audioMime(file.name) });
    } catch (error) { const typed = this.classifyDownloadError(error, file.id, timed.timedOut); StartTelemetry.failed(file.id, endpoint, typed.stage, error, typed.status); throw typed; }
    finally { timed.dispose(); }
  }
  private async downloadWithRetry(file: GoogleLibraryFile, signal: AbortSignal, progress: (percent: number | null) => void): Promise<File> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.downloadOnce(file, signal, progress); }
      catch (error) {
        last = error;
        if (!(error instanceof BookDownloadError) || !error.retryable || signal.aborted || attempt === 2) throw error;
        await new Promise<void>(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw last;
  }
  private async downloadOnce(file: GoogleLibraryFile, signal: AbortSignal, progress: (percent: number | null) => void): Promise<File> {
    const max = 256 * 1024 * 1024, size = Number(file.size) || 0;
    if (size > max || !/\.(pdf|epub|cbr|cbz)$/i.test(file.name)) throw new BookDownloadError("EPUB_INVALID", "VALIDATING", file.id);
    const endpoint = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`;
    StartTelemetry.request(file.id, endpoint, "DOWNLOADING");
    const timed = portableTimeout(signal, 120_000);
    try {
      const response = await this.request(`files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, timed.signal, { id: file.id, key: file.resourceKey });
      const reader = response.body?.getReader(); if (!reader) throw new BookDownloadError("MOBILE_API_UNSUPPORTED", "DOWNLOADING", file.id);
      progress(size ? 0 : null);
      let bytes = 0; const chunks: BlobPart[] = [];
      try { while (true) { assertNotAborted(timed.signal); const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > max) throw new BookDownloadError("EPUB_INVALID", "VALIDATING", file.id);
        chunks.push(new Uint8Array(value).buffer); progress(size ? Math.min(100, Math.round(bytes / size * 100)) : null);
      } } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      assertNotAborted(timed.signal); if (size && bytes !== size) throw new BookDownloadError("DOWNLOAD_NETWORK_FAILED", "DOWNLOADING", file.id, undefined, true);
      StartTelemetry.request(file.id, endpoint, "VALIDATING");
      const fallback = file.name.endsWith(".epub") ? "application/epub+zip" : file.name.endsWith(".cbz") ? "application/x-cbz" : file.name.endsWith(".cbr") ? "application/x-cbr" : "application/pdf";
      return new File(chunks, file.name, { type: file.mimeType || fallback });
    } catch (error) {
      const typed = this.classifyDownloadError(error, file.id, timed.timedOut);
      StartTelemetry.failed(file.id, endpoint, typed.stage, error, typed.status); throw typed;
    } finally { timed.dispose(); }
  }
  private classifyDownloadError(error: unknown, bookId: string, timedOut: boolean): BookDownloadError {
    if (error instanceof BookDownloadError) return error;
    if (error instanceof GoogleDriveRequestError) {
      const code = error.status === 401 ? "DOWNLOAD_HTTP_401" : error.status === 403 ? "DOWNLOAD_HTTP_403" : error.status === 404 ? "DOWNLOAD_HTTP_404" : error.status === 429 ? "DOWNLOAD_HTTP_429" : "DOWNLOAD_URL_FAILED";
      return new BookDownloadError(code, "DOWNLOADING", bookId, error.status, error.status >= 500 || error.status === 429, error);
    }
    if (timedOut) return new BookDownloadError("DOWNLOAD_TIMEOUT", "DOWNLOADING", bookId, undefined, true, error);
    if (error instanceof DOMException && error.name === "AbortError") return new BookDownloadError("DOWNLOAD_NETWORK_FAILED", "DOWNLOADING", bookId, undefined, true, error);
    return new BookDownloadError(globalThis.navigator?.onLine === false ? "DOWNLOAD_NETWORK_FAILED" : "DOWNLOAD_CORS_FAILED", "DOWNLOADING", bookId, undefined, true, error);
  }
  private accessError(status: number, reason?: string): GoogleDriveAccessError {
    if (status === 429 || ["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "quotaExceeded"].includes(reason ?? "")) return new GoogleDriveAccessError("DRIVE_RATE_LIMITED");
    if (["keyInvalid", "accessNotConfigured", "ipRefererBlocked", "forbidden"].includes(reason ?? "")) return new GoogleDriveAccessError("DRIVE_PUBLIC_KEY_REJECTED");
    if (status === 401) return new GoogleDriveAccessError("DRIVE_ACCOUNT_NOT_AUTHORIZED");
    if (status === 403) return new GoogleDriveAccessError("DRIVE_FOLDER_FORBIDDEN");
    if (status === 404) return new GoogleDriveAccessError("DRIVE_ITEM_NOT_FOUND");
    return new GoogleDriveAccessError("DRIVE_CONNECTION_FAILED");
  }
}

function assertNotAborted(signal: AbortSignal): void { if (signal.aborted) throw new DOMException("Download cancelado.", "AbortError"); }
function audioMime(name: string): string {
  const extension = name.split(".").pop()?.toLocaleLowerCase("en-US");
  return extension === "mp3" ? "audio/mpeg" : extension === "m4a" ? "audio/mp4" : extension === "aac" ? "audio/aac" : extension === "wav" ? "audio/wav" : extension === "opus" ? "audio/ogg; codecs=opus" : "audio/ogg";
}
function portableTimeout(parent: AbortSignal, milliseconds: number): { signal: AbortSignal; timedOut: boolean; dispose(): void } {
  const controller = new AbortController(); let timedOut = false;
  const abort = (): void => controller.abort(); parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, milliseconds);
  return { signal: controller.signal, get timedOut() { return timedOut; }, dispose: () => { clearTimeout(timer); parent.removeEventListener("abort", abort); } };
}
