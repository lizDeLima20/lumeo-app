import type { ImportedFile } from "../importers/BookImporter";
import { GoogleDriveUrlParser } from "../importers/GoogleDriveUrlParser";
import { LocalFileImporter } from "../importers/LocalFileImporter";
import { Genre } from "../models/Genre";
import type { Book } from "../models/Book";
import type { BookRepository } from "../repositories/BookRepository";
import type { GenreRepository } from "../repositories/GenreRepository";
import { GoogleDriveLibraryService, type GoogleLibraryFile } from "../external/GoogleDriveLibraryService";
import type { ImportManager, ImportMetadata } from "./ImportManager";
import type { CoverService } from "./CoverService";

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
        await this.walk(file.id, "Sem gênero", signal, files);
        const saved: Book[] = [];
        for (let index = 0; index < files.length; index++) saved.push(await this.importFile(files[index]!.file, files[index]!.genre, signal, progress, index, files.length));
        return saved;
      }
      return [await this.importFile(file, "Sem gênero", signal, progress, 0, 1)];
    }
    const files: Array<{ file: GoogleLibraryFile; genre: string }> = [];
    await this.walk(parsed.folderId, "Sem gênero", signal, files);
    if (files.length === 0) throw new Error("DRIVE_FOLDER_EMPTY");
    const saved: Book[] = [];
    for (let index = 0; index < files.length; index++) saved.push(await this.importFile(files[index]!.file, files[index]!.genre, signal, progress, index, files.length));
    return saved;
  }

  private async walk(folderId: string, genre: string, signal: AbortSignal, output: Array<{ file: GoogleLibraryFile; genre: string }>, page?: string): Promise<void> {
    if (signal.aborted) throw new DOMException("Importação cancelada.", "AbortError");
    const listing = await this.drive.list(folderId, undefined, signal, page);
    for (const file of listing.files) {
      if (file.mimeType === GoogleDriveLibraryService.FOLDER) await this.walk(file.id, file.name.trim() || genre, signal, output);
      else output.push({ file, genre });
    }
    if (listing.nextPageToken) await this.walk(folderId, genre, signal, output, listing.nextPageToken);
  }

  private async importFile(file: GoogleLibraryFile, genreName: string, signal: AbortSignal, progress: (done: number, total: number | null, name: string) => void, done: number, total: number | null): Promise<Book> {
    const sourceId = `drive:${file.id}`;
    const existing = (await this.books.getAll()).find(book => book.catalogBookId === sourceId);
    const sourceVersion = file.modifiedTime ?? `${file.name}:${file.size ?? ""}`;
    if (existing?.sourceVersion === sourceVersion) { progress(done + 1, total, file.name); return existing; }
    const downloaded = await this.drive.download(file, signal, () => progress(done, total, file.name));
    const imported: ImportedFile = await new LocalFileImporter().import(downloaded, "google-drive");
    const genre = await this.genre(genreName);
    const title = imported.suggestedTitle || file.name;
    const metadata: ImportMetadata = { title, author: "", genreId: existing?.genreId ?? genre.id,
      readingStatus: "unread", cover: await this.covers.fromBookFile(imported.file, imported.fileType, title), contentType: imported.fileType === "cbr" || imported.fileType === "cbz" ? "comic" : "book" };
    const book = await this.imports.save(imported, metadata, undefined, { catalogBookId: sourceId, sourceVersion, replaceBookId: existing?.id, signal });
    progress(done + 1, total, file.name); return book;
  }
  private async genre(name: string): Promise<Genre> {
    const all = await this.genres.getAll(); const found = all.find(item => Genre.sameName(item.name, name));
    if (found) return found;
    const genre = new Genre(crypto.randomUUID(), name || "Sem gênero"); await this.genres.save(genre); return genre;
  }
}
