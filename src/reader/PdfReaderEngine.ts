import { getDocument, GlobalWorkerOptions, PasswordResponses, type PDFDocumentLoadingTask,
  type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { I18nManager } from "../i18n/I18nManager";

GlobalWorkerOptions.workerSrc = workerUrl;

export class PdfPasswordCancelledError extends Error {}
export type PasswordProvider = (incorrectPassword: boolean) => Promise<string | null>;

export class PdfReaderEngine {
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private document: PDFDocumentProxy | null = null;
  private passwordCancelled = false;

  public async open(blob: Blob, passwordProvider: PasswordProvider): Promise<void> {
    await this.close();
    this.passwordCancelled = false;
    this.loadingTask = getDocument({ data: await blob.arrayBuffer() });
    this.loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
      void passwordProvider(reason === PasswordResponses.INCORRECT_PASSWORD).then((password) => {
        if (password === null) { this.passwordCancelled = true; void this.loadingTask?.destroy(); return; }
        updatePassword(password);
      });
    };
    try { this.document = await this.loadingTask.promise; }
    catch (error) {
      if (this.passwordCancelled) throw new PdfPasswordCancelledError(I18nManager.shared.t("error.pdf.passwordCancelled"));
      throw error;
    }
  }

  public get totalPages(): number { return this.document?.numPages ?? 0; }
  public async getPage(pageNumber: number): Promise<PDFPageProxy> {
    if (!this.document) throw new Error(I18nManager.shared.t("error.pdf.notLoaded"));
    return this.document.getPage(pageNumber);
  }
  public async close(): Promise<void> {
    if (this.loadingTask) await this.loadingTask.destroy();
    this.loadingTask = null; this.document = null;
  }
}
