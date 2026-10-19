import type { GoogleDriveLibraryService } from "../external/GoogleDriveLibraryService";
import type { GoogleDriveLibraryEntry } from "../external/GoogleDriveLibraryRepository";
import { cbzCoverByRange } from "./CbzRangeCover";
import { cbrCoverArchiveByRange } from "./RarRangeCover";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

/** Where a cover came from; logged so a missing cover can be explained. */
export type DriveCoverSource = "catalog" | "catalog-file" | "cache" | "drive-thumbnail" | "cbz-first-page" | "cbr-first-page" | "local-file" | "none";

export interface DriveCoverCache { get(key: string): Promise<string | null>; save(key: string, dataUrl: string): Promise<void>; }

export interface DriveCoverDependencies {
  drive: Pick<GoogleDriveLibraryService, "range" | "thumbnailLink">;
  cache: DriveCoverCache;
  /** The downloaded file, when the book is already on the device; never fetched for a cover. */
  localFile: (entry: GoogleDriveLibraryEntry) => Promise<Blob | null>;
  /** First page of a local file as an image (PDF render, archive page, EPUB cover). */
  firstPage: (file: Blob, entry: GoogleDriveLibraryEntry) => Promise<Blob | null>;
  /** Shrinks an image to a light WebP data URL. */
  thumbnail: (image: Blob) => Promise<string>;
  fetcher?: typeof fetch;
  /** Makes sure Drive calls carry a token (the same silent step a sync or download takes). */
  authorize?: () => Promise<void>;
}

const MAX_PARALLEL = 3;
/** A catalog's cover file is read whole only up to this size. */
const MAX_COVER_FILE_BYTES = 2 * 1024 * 1024;
/** Covers kept in memory so a redrawn card shows its cover at once (about 50 KB each). */
const RECENT_COVERS = 120;
/** A file with no cover is not asked again for a while (every redraw would repeat its requests). */
const MISSING_RETRY_MS = 5 * 60_000;

/**
 * Covers for Drive entries, in this order:
 *   1. the catalog's own cover (coverUrl / coverDriveFileId), shown as is;
 *   2. a cover already processed on this device (WebP data URL in the local cache);
 *   3. Drive's thumbnail of the file (thumbnailLink, refreshed once if it expired);
 *   4. for CBZ/CBR, the first page read by byte ranges (a few MB at most, never the archive);
 *      the real format is sniffed from the first bytes, since many ".cbr" files are ZIPs;
 *   5. for a file already downloaded, its first page;
 *   6. nothing: the card keeps its placeholder. A file is never downloaded for its cover.
 * Each result is cached by file id + modification time, so an edited file gets a new one.
 */
export class PersonalDriveCoverResolver {
  private readonly pending = new Map<string, { job: Promise<string | null>; signal?: AbortSignal }>();
  private readonly waiting: Array<() => void> = [];
  private running = 0;
  private access: Promise<boolean> | null = null;
  private readonly recent = new Map<string, string>();
  private readonly missing = new Map<string, number>();
  public constructor(private readonly deps: DriveCoverDependencies) {}

  public static key(entry: Pick<GoogleDriveLibraryEntry, "fileId" | "modifiedTime">): string { return `drive-cover:${entry.fileId}:${entry.modifiedTime ?? ""}`; }

  /** The catalog cover, if any, without any network or cache access. */
  public static immediate(entry: GoogleDriveLibraryEntry): string | null { return entry.coverUrl || null; }

  /** A cover resolved recently in this session, without waiting: the one already processed
   *  here first (it worked), else the catalog's URL. */
  public peek(entry: GoogleDriveLibraryEntry): string | null {
    return this.recent.get(PersonalDriveCoverResolver.key(entry)) ?? PersonalDriveCoverResolver.immediate(entry);
  }

  /** `catalogFailed`: the catalog's cover URL did not load on this device, so the cover is made
   *  from the cover file itself (or the other sources below) instead of that URL. */
  public resolve(entry: GoogleDriveLibraryEntry, signal?: AbortSignal, catalogFailed = false): Promise<string | null> {
    const immediate = catalogFailed ? this.recent.get(PersonalDriveCoverResolver.key(entry)) ?? null : this.peek(entry);
    if (immediate) return Promise.resolve(immediate);
    const key = PersonalDriveCoverResolver.key(entry);
    // A job queued for a card that left the screen is skipped when its turn comes, so a newer
    // request for the same cover does not join it.
    const existing = this.pending.get(key); if (existing && !existing.signal?.aborted) return existing.job;
    if (Date.now() - (this.missing.get(key) ?? -Infinity) < MISSING_RETRY_MS) return Promise.resolve(null);
    let skipped = false;
    // A cover already made on this device is read straight away: it never waits in the queue
    // behind covers that still have to come from the network.
    const job = this.deps.cache.get(key).catch(() => null).then(cached => cached ?? this.limited(() => { skipped = Boolean(signal?.aborted); return skipped ? Promise.resolve(null) : this.produce(entry, key); })).then(url => {
      if (!url && !skipped) this.missing.set(key, Date.now());
      if (url) { this.recent.delete(key); this.recent.set(key, url); if (this.recent.size > RECENT_COVERS) this.recent.delete(this.recent.keys().next().value!); }
      return url;
    }).finally(() => { if (this.pending.get(key)?.job === job) this.pending.delete(key); });
    this.pending.set(key, { job, signal }); return job;
  }

  /** Runs to the end once started, even if its card left the screen: the result is cached. */
  private async produce(entry: GoogleDriveLibraryEntry, key: string): Promise<string | null> {
    const started = Date.now(); let requests = 0, bytesRead = 0;
    const attempt = async (source: DriveCoverSource, image: () => Promise<Blob | null>): Promise<string | null> => {
      try {
        const blob = await image(); if (!blob || !blob.type.startsWith("image/")) return null;
        const dataUrl = await this.deps.thumbnail(blob);
        await this.deps.cache.save(key, dataUrl).catch(() => undefined);
        console.info(JSON.stringify({ event: "DRIVE_COVER_READY", fileId: entry.fileId, source, bytes: dataUrl.length, ms: Date.now() - started, rangeRequests: requests, bytesRead }));
        return dataUrl;
      } catch (error) {
        console.warn(JSON.stringify({ event: "DRIVE_COVER_ATTEMPT_FAILED", fileId: entry.fileId, source, reason: error instanceof Error ? error.message : "unknown" }));
        return null;
      }
    };
    const controller = new AbortController().signal;
    // A catalog names its cover file in covers/: read it through the Drive API (a few dozen KB)
    // when the catalog's public URL cannot be loaded here.
    // Entries cached before the id was stored still name the file in their URL (".../d/<id>").
    const coverFileId = entry.coverDriveFileId ?? /^https:\/\/lh3\.googleusercontent\.com\/d\/([\w-]+)/.exec(entry.coverUrl ?? "")?.[1];
    if (coverFileId) {
      const fromFile = await attempt("catalog-file", async () => {
        const { bytes, total } = await this.deps.drive.range({ id: coverFileId }, 0, MAX_COVER_FILE_BYTES - 1, controller);
        requests++; bytesRead += bytes.length;
        if (total !== null && total > bytes.length) throw new Error("COVER_FILE_TOO_LARGE");
        return imageBlob(bytes);
      });
      if (fromFile) return fromFile;
    }
    // Without a token every Drive request below fails.
    if (!await this.authorized()) { console.info(JSON.stringify({ event: "DRIVE_COVER_PLACEHOLDER", fileId: entry.fileId, reason: "not-authorized" })); return null; }
    // Drive has no thumbnail for CBR/CBZ (its endpoint answers 404), so they skip straight to
    // the ranged first page unless the listing did offer a link.
    const comicArchive = /\.(cbz|cbr)$/i.test(entry.name);
    if (entry.thumbnailLink || !comicArchive) {
      const viaListing = entry.thumbnailLink ? await attempt("drive-thumbnail", () => this.fetchImage(entry.thumbnailLink!)) : null;
      if (viaListing) return viaListing;
      // Listing links last a few hours, and entries cached by older versions have none: ask
      // Drive for a fresh one once.
      const fresh = await this.deps.drive.thumbnailLink({ id: entry.fileId, resourceKey: entry.resourceKey }, controller).catch(() => null);
      const viaFresh = fresh ? await attempt("drive-thumbnail", () => this.fetchImage(fresh)) : null;
      if (viaFresh) return viaFresh;
    }
    if (comicArchive && entry.size && Number(entry.size) > 0) {
      const size = Number(entry.size);
      const read = async (start: number, end: number) => {
        const { bytes } = await this.deps.drive.range({ id: entry.fileId, resourceKey: entry.resourceKey }, start, end, controller);
        requests++; bytesRead += bytes.length; return bytes;
      };
      const magic = await read(0, 7).catch(() => null);
      if (magic && magic[0] === 0x50 && magic[1] === 0x4b) {
        const fromZip = await attempt("cbz-first-page", () => cbzCoverByRange(read, size));
        if (fromZip) return fromZip;
      } else if (magic && magic[0] === 0x52 && magic[1] === 0x61 && magic[2] === 0x72 && magic[3] === 0x21) {
        // A one-page RAR cut from the archive, decoded by the reader's own libarchive.
        const fromRar = await attempt("cbr-first-page", async () => { const mini = await cbrCoverArchiveByRange(read, size); return mini ? this.deps.firstPage(mini, { ...entry, name: "cover.cbr" }) : null; });
        if (fromRar) return fromRar;
      }
    }
    const local = await this.deps.localFile(entry).catch(() => null);
    if (local) { const fromLocal = await attempt("local-file", () => this.deps.firstPage(local, entry)); if (fromLocal) return fromLocal; }
    console.info(JSON.stringify({ event: "DRIVE_COVER_PLACEHOLDER", fileId: entry.fileId, format: /\.([a-z0-9]+)$/i.exec(entry.name)?.[1]?.toLowerCase() ?? "" }));
    return null;
  }

  private authorized(): Promise<boolean> {
    if (!this.deps.authorize) return Promise.resolve(true);
    // Shared by the covers waiting at the same time; cheap once a token is held, and asked
    // again later so an expired token is renewed.
    return this.access ??= this.deps.authorize().then(() => true, error => {
      console.warn(JSON.stringify({ event: "DRIVE_COVER_AUTHORIZATION_FAILED", reason: error instanceof Error ? error.message : "unknown" }));
      return false;
    }).finally(() => { this.access = null; });
  }

  private async fetchImage(url: string): Promise<Blob | null> {
    // Drive's thumbnailLink is a 220 px preview ("...=s220"); three covers per row need more.
    const sized = url.replace(/=s\d+$/, "=s400");
    const response = await (this.deps.fetcher ?? driveImageFetch)(sized, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.blob();
  }

  private async limited<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= MAX_PARALLEL) await new Promise<void>(resolve => this.waiting.push(resolve));
    this.running++;
    try { return await task(); }
    finally { this.running--; this.waiting.shift()?.(); }
  }
}

/** The bytes of an image file as a typed Blob (JPEG, PNG, WebP or GIF), else null. */
export function imageBlob(bytes: Uint8Array): Blob | null {
  const at = (index: number, ...values: number[]) => values.every((value, offset) => bytes[index + offset] === value);
  const type = at(0, 0xff, 0xd8, 0xff) ? "image/jpeg" : at(0, 0x89, 0x50, 0x4e, 0x47) ? "image/png" : at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50) ? "image/webp" : at(0, 0x47, 0x49, 0x46, 0x38) ? "image/gif" : null;
  return type ? new Blob([new Uint8Array(bytes)], { type }) : null;
}

/** Drive's image hosts send no CORS headers, so the WebView cannot read their bytes with
 *  fetch; on Android the request goes through the native HTTP client instead. */
export const driveImageFetch: typeof fetch = async (input, init) => {
  if (!Capacitor.isNativePlatform()) return fetch(input, init);
  const response = await CapacitorHttp.get({ url: String(input), responseType: "blob" });
  const type = Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? "application/octet-stream";
  const binary = atob(typeof response.data === "string" ? response.data : ""), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Response(bytes, { status: response.status, headers: { "content-type": type } });
};

/** Shrinks an image to a WebP data URL (360 px wide: sharp at three covers per row). */
export async function driveCoverThumbnail(image: Blob, width = 360): Promise<string> {
  const bitmap = await createImageBitmap(image);
  try {
    const scale = Math.min(1, width / bitmap.width), canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d"); if (!context) throw new Error("COVER_CANVAS_UNAVAILABLE");
    context.imageSmoothingQuality = "high"; context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", .82));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error("COVER_ENCODE_FAILED");
    return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
  } finally { bitmap.close(); }
}

/** First page of a file already on the device: PDF rendered, CBR/CBZ first image. EPUB and
 *  anything else return null (their cover comes from Drive's thumbnail or the catalog). */
export async function driveLocalFirstPage(file: Blob, entry: Pick<GoogleDriveLibraryEntry, "name">): Promise<Blob | null> {
  const format = /\.([a-z0-9]+)$/i.exec(entry.name)?.[1]?.toLowerCase();
  if (format === "pdf") {
    const { PdfCoverExtractor } = await import("./PdfCoverExtractor");
    return PdfCoverExtractor.extract(file instanceof File ? file : new File([file], entry.name, { type: "application/pdf" }));
  }
  if (format === "cbz" || format === "cbr") {
    const { ComicArchiveSource } = await import("../reader/comic/ComicArchiveSource");
    const archive = new ComicArchiveSource(format);
    try { await archive.open(file); return await archive.image(1); } finally { await archive.close(); }
  }
  return null;
}
