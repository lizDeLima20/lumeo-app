import type { Book } from "../../../models/Book";
import { ComicConversionService } from "./ComicConversionService";
import { ComicPdfConverter } from "./ComicPdfConverter";
import { ComicArchiveConverter } from "./ComicArchiveConverter";

/** Foreground preparation of downloaded comics. The converter checkpoints each page in
 * IndexedDB; on restart the local library supplies the queue and completed pages resume.
 * Android may suspend the WebView, so this makes no background execution promise. */
export class ComicPreparationQueue {
  private readonly pending = new Map<string, Book>();
  private active: AbortController | null = null;
  private timer = 0;
  private started = false;

  public constructor(private readonly books: () => Promise<readonly Book[]>,
    private readonly file: (id: string) => Promise<Blob | null>,
    private readonly reading: () => boolean) {}

  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    document.addEventListener("visibilitychange", this.visibility);
    for (const book of await this.books()) this.enqueue(book);
  }

  public enqueue(book: Book): void {
    if (book.contentType !== "comic" || !["pdf", "cbr", "cbz"].includes(book.fileType)) return;
    this.pending.set(book.id, book);
    this.schedule();
  }

  public pause(): void { this.active?.abort(); }

  private readonly visibility = (): void => { if (document.hidden) this.pause(); else this.schedule(); };

  private schedule(): void {
    if (this.active || this.timer || !this.pending.size) return;
    this.timer = window.setTimeout(() => { this.timer = 0; void this.run(); }, 1500);
  }

  private async run(): Promise<void> {
    if (this.active || !this.pending.size) return;
    if (document.hidden || this.reading()) { this.schedule(); return; }
    const [id, book] = this.pending.entries().next().value as [string, Book];
    const controller = this.active = new AbortController();
    try {
      const blob = await this.file(id);
      controller.signal.throwIfAborted();
      if (!blob) { this.pending.delete(id); return; }
      const converter = book.fileType === "pdf" ? new ComicPdfConverter() : new ComicArchiveConverter(book.fileType as "cbr" | "cbz");
      await new ComicConversionService(converter).open({ bookId: id, blob, title: book.title, fileName: book.fileName, contentType: "comic" }, {
        signal: controller.signal,
        onPageStarted: () => { if (document.hidden || this.reading()) controller.abort(); controller.signal.throwIfAborted(); },
        onPageReady: async () => { await new Promise<void>(resolve => window.setTimeout(resolve, 40)); },
      });
      this.pending.delete(id);
    } catch (error) {
      if (!controller.signal.aborted) {
        this.pending.delete(id);
        console.warn("COMIC_PREPARATION_FAILED", { bookId: id, reason: error instanceof Error ? error.name : "unknown" });
      }
    } finally {
      if (this.active === controller) this.active = null;
      this.schedule();
    }
  }
}
