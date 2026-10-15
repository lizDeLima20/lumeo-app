import type { GoogleLibraryFile } from "../external/GoogleDriveLibraryService";

export interface PersonalDriveCatalogMetadata {
  title: string;
  author: string;
  synopsis?: string;
  genre?: string;
  coverUrl?: string;
  coverDriveFileId?: string;
}

interface CatalogRow { title?: unknown; author?: unknown; genre?: unknown; synopsis?: unknown; summary?: unknown; description?: unknown;
  format?: unknown; bookId?: unknown; bookPath?: unknown; driveFileId?: unknown; bookDriveFileId?: unknown; downloadUrl?: unknown;
  coverPath?: unknown; coverDriveFileId?: unknown; coverUrl?: unknown; }

/** Normalises the catalog.json shapes published by the former catalogue without carrying
 * its server dependency into the personal app.  It is intentionally permissive about
 * optional fields, but never renders arbitrary objects as visible text. */
export class PersonalDriveCatalogResolver {
  public constructor(private readonly document: unknown, private readonly siblings: readonly GoogleLibraryFile[]) {}

  public resolve(file: GoogleLibraryFile): PersonalDriveCatalogMetadata | null {
    const row = this.rows().find(value => this.matches(value, file));
    if (!row) return null;
    const title = text(row.title) ?? stem(file.name);
    const coverId = text(row.coverDriveFileId) ?? this.fileIdForPath(text(row.coverPath));
    const result: PersonalDriveCatalogMetadata = { title, author: text(row.author) ?? "" };
    const description = synopsis(row), genre = text(row.genre), coverUrl = https(row.coverUrl);
    if (description) result.synopsis = description;
    if (genre) result.genre = genre;
    if (coverId) result.coverDriveFileId = coverId;
    if (coverUrl) result.coverUrl = coverUrl;
    return result;
  }

  private rows(): CatalogRow[] {
    const root = this.document && typeof this.document === "object" ? this.document as { books?: unknown } : null;
    const values = Array.isArray(this.document) ? this.document : root?.books;
    return Array.isArray(values) ? values.filter((value): value is CatalogRow => Boolean(value) && typeof value === "object") : [];
  }
  private matches(row: CatalogRow, file: GoogleLibraryFile): boolean {
    const ids = [text(row.driveFileId), text(row.bookDriveFileId), text(row.bookId)].filter(Boolean);
    if (ids.includes(file.id)) return true;
    const target = [text(row.bookPath), text(row.downloadUrl)].filter(Boolean).map(value => basename(value!));
    return target.includes(file.name) || (text(row.title) ? fold(stem(file.name)) === fold(text(row.title)!) : false);
  }
  private fileIdForPath(path: string | undefined): string | undefined {
    if (!path) return undefined;
    const name = basename(path);
    return this.siblings.find(file => file.name === name)?.id;
  }
}

export function driveThumbnailUrl(fileId: string | undefined, fallbackId: string): string {
  const id = fileId || fallbackId;
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w400`;
}
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function synopsis(row: CatalogRow): string | undefined { return text(row.synopsis) ?? text(row.summary) ?? text(row.description); }
function https(value: unknown): string | undefined { const raw = text(value); try { const url = raw ? new URL(raw) : null; return url?.protocol === "https:" ? url.href : undefined; } catch { return undefined; } }
function basename(value: string): string { try { return decodeURIComponent(value.split("?")[0]!.split("/").pop() ?? ""); } catch { return value.split("?")[0]!.split("/").pop() ?? ""; } }
function stem(value: string): string { return value.replace(/\.[^.]+$/, ""); }
function fold(value: string): string { return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim(); }
