import type { ImportedFile } from "../importers/BookImporter";
import { GoogleDriveUrlParser } from "../importers/GoogleDriveUrlParser";
import { LocalFileImporter } from "../importers/LocalFileImporter";
import { Genre } from "../models/Genre";
import { Book, type BookContentType } from "../models/Book";
import type { BookRepository } from "../repositories/BookRepository";
import type { GenreRepository } from "../repositories/GenreRepository";
import { GoogleDriveLibraryService, type GoogleLibraryFile } from "../external/GoogleDriveLibraryService";
import type { ImportManager, ImportMetadata } from "./ImportManager";
import type { CoverService } from "./CoverService";
import { resolvePersonalDriveGenre } from "./PersonalDriveGenreResolver";

/** Imports only files the signed-in Google account can read. No cookies, server proxy or
 * catalogue is involved. Folder names are copied into local genres and never written back. */
export class PersonalDriveImporter {
  public constructor(private readonly drive: GoogleDriveLibraryService, private readonly imports: ImportManager,
    private readonly books: BookRepository, private readonly genres: GenreRepository, private readonly covers: CoverService) {}

  public async importLink(link: string, signal: AbortSignal, progress: (done: number, total: number | null, name: string) => void): Promise<Book[]> {
    await this.drive.prepare();
    if (!this.drive.authorized) await this.drive.connect();
    const parsed = new GoogleDriveUrlParser().parse(link);
    if (parsed.kind === "invalid") throw new Error("Informe um link válido do Google Drive.");
    if (parsed.kind === "file") {
      const file = await this.drive.metadata(parsed.fileId, undefined, signal);
      if (file.mimeType === GoogleDriveLibraryService.FOLDER) {
        const files: Array<{ file: GoogleLibraryFile; genre: string }> = [];
        await this.walk(file.id, resolvePersonalDriveGenre(file.name), signal, files);
        const saved: Book[] = [];
        for (let index = 0; index < files.length; index++) saved.push(await this.importFile(files[index]!.file, files[index]!.genre, signal, progress, index, files.length));
        return saved;
      }
      return [await this.importFile(file, "Sem gênero", signal, progress, 0, 1)];
    }
    const files: Array<{ file: GoogleLibraryFile; genre: string }> = [];
    const root = await this.drive.metadata(parsed.folderId, undefined, signal);
    await this.walk(parsed.folderId, resolvePersonalDriveGenre(root.name), signal, files);
    if (files.length === 0) throw new Error("DRIVE_FOLDER_EMPTY");
    const saved: Book[] = [];
    for (let index = 0; index < files.length; index++) saved.push(await this.importFile(files[index]!.file, files[index]!.genre, signal, progress, index, files.length));
    return saved;
  }

  /** Imports one item chosen from the personal Drive shelf. Listing and downloading stay
   * separate, so a large folder never fills device storage unexpectedly. */
  public async importListedFile(file: GoogleLibraryFile, genre: string, signal: AbortSignal,
    contentType: BookContentType = "book",
    progress: (done: number, total: number | null, name: string, percent?: number | null) => void): Promise<Book> {
    await this.drive.prepare(); if (!this.drive.authorized) await this.drive.connect();
    // The listed entry already carries its final genre (resolved while listing, or a catalog
    // folder's exact name); resolving again would rename a catalog genre on download.
    return this.importFile(file, genre.trim() || "Sem gênero", signal, progress, 0, 1, contentType);
  }

  /** Reclassifies only downloaded PDFs from this source. The original file, cover, id and
   * reading position survive; CBR/CBZ are always comics independently of folder choice. */
  public async reclassifyListedFiles(fileIds: readonly string[], contentType: BookContentType): Promise<Book[]> {
    const ids = new Set(fileIds.map(id => `drive:${id}`));
    const books = await this.books.getAll(), updated: Book[] = [];
    for (const book of books) {
      if (!book.catalogBookId || !ids.has(book.catalogBookId) || book.fileType !== "pdf" || book.contentType === contentType) continue;
      const next = copyWithContentType(book, contentType); await this.books.save(next); updated.push(next);
    }
    return updated;
  }

  private async walk(folderId: string, genre: string, signal: AbortSignal, output: Array<{ file: GoogleLibraryFile; genre: string }>, page?: string): Promise<void> {
    if (signal.aborted) throw new DOMException("Importação cancelada.", "AbortError");
    const listing = await this.drive.list(folderId, undefined, signal, page);
    for (const file of listing.files) {
      if (file.mimeType === GoogleDriveLibraryService.FOLDER) await this.walk(file.id, resolvePersonalDriveGenre(file.name || genre), signal, output);
      else output.push({ file, genre });
    }
    if (listing.nextPageToken) await this.walk(folderId, genre, signal, output, listing.nextPageToken);
  }

  private async importFile(file: GoogleLibraryFile, genreName: string, signal: AbortSignal, progress: (done: number, total: number | null, name: string, percent?: number | null) => void, done: number, total: number | null, requestedContentType: BookContentType = "book"): Promise<Book> {
    const sourceId = `drive:${file.id}`;
    const existing = (await this.books.getAll()).find(book => book.catalogBookId === sourceId);
    const sourceVersion = file.modifiedTime ?? `${file.name}:${file.size ?? ""}`;
    const expectedContentType = fileIsComicArchive(file) ? "comic" : requestedContentType;
    if (existing?.sourceVersion === sourceVersion) {
      const result = existing.contentType === expectedContentType || existing.fileType !== "pdf" ? existing : copyWithContentType(existing, expectedContentType);
      if (result !== existing) await this.books.save(result);
      progress(done + 1, total, file.name, 100); return result;
    }
    const downloaded = await this.drive.download(file, signal, percent => progress(done, total, file.name, percent));
    const imported: ImportedFile = await new LocalFileImporter().import(downloaded, "google-drive");
    const genre = await this.genre(genreName);
    const title = imported.suggestedTitle || file.name;
    const metadata: ImportMetadata = { title, author: "", genreId: existing?.genreId ?? genre.id,
      readingStatus: "unread", cover: await this.covers.fromBookFile(imported.file, imported.fileType, title), contentType: imported.fileType === "cbr" || imported.fileType === "cbz" ? "comic" : requestedContentType };
    const book = await this.imports.save(imported, metadata, undefined, { catalogBookId: sourceId, sourceVersion, replaceBookId: existing?.id, signal });
    progress(done + 1, total, file.name, 100); return book;
  }
  private async genre(name: string): Promise<Genre> {
    const all = await this.genres.getAll(); const found = all.find(item => Genre.sameName(item.name, name));
    if (found) return found;
    const genre = new Genre(crypto.randomUUID(), name || "Sem gênero"); await this.genres.save(genre); return genre;
  }
}
function fileIsComicArchive(file: Pick<GoogleLibraryFile, "name" | "mimeType">): boolean { return /\.(cbr|cbz)$/i.test(file.name) || /(?:cbr|cbz|comicbook)/i.test(file.mimeType); }
function copyWithContentType(book: Book, contentType: BookContentType): Book {
  return new Book({ id: book.id, title: book.title, author: book.author, genreId: book.genreId, cover: book.cover, fileType: book.fileType, fileName: book.fileName, fileSize: book.fileSize, mimeType: book.mimeType, readingStatus: book.readingStatus, createdAt: book.createdAt, updatedAt: new Date(), currentLocation: book.currentLocation, progressPercent: book.progressPercent, collectionId: book.collectionId, conversionStatus: book.conversionStatus, availability: book.availability, volume: book.volume, summary: book.summary, description: book.description, publicationYear: book.publicationYear, series: book.series, documentMode: book.documentMode, textCapability: book.textCapability, limaCapability: book.limaCapability, offlineAvailability: book.offlineAvailability, contentType, collectionPath: book.collectionPath, catalogBookId: book.catalogBookId, sourceVersion: book.sourceVersion, source: book.source });
}
