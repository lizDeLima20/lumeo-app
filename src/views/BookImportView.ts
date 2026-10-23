import type { ImportedFile } from "../importers/BookImporter";
import type { Book, ReadingStatus } from "../models/Book";
import { Genre } from "../models/Genre";
import { GenreRepository } from "../repositories/GenreRepository";
import { CollectionRepository } from "../repositories/CollectionRepository";
import { Collection } from "../models/Collection";
import { BookMetadataExtractor } from "../metadata/BookMetadataExtractor";
import type { Confidence } from "../metadata/MetadataTypes";
import { GenreSuggestionResolver } from "../metadata/GenreSuggestionResolver";
import { ApiError } from "../services/ApiClient";
import { CoverService } from "../services/CoverService";
import { DuplicateBookImportError, ImportManager } from "../services/ImportManager";
import type { AppState } from "../core/AppState";
import { BaseView } from "./BaseView";
import { I18nManager, type TranslationKey } from "../i18n/I18nManager";
import { ExternalLibrariesPanel } from "./ExternalLibrariesPanel";
import type { OneDriveConnections } from "../external/OneDriveConnections";
import type { OneDriveImportCoordinator } from "../external/OneDriveImportCoordinator";
import { OneDriveError } from "../external/OneDriveError";

const tr = (key: TranslationKey, parameters?: Readonly<Record<string, string | number>>): string => I18nManager.shared.t(key, parameters);

export class BookImportView extends BaseView {
  private externalPanel: ExternalLibrariesPanel | null = null;
  private remoteBusy = false;
  private remotePreview = false;
  private generation = 0;
  private remoteCancel: HTMLButtonElement | null = null;
  private fileSummary: HTMLElement | null = null;
  private imported: ImportedFile | null = null;
  private automaticCover = "";
  private authorInput: HTMLInputElement | null = null; private genreSelect: HTMLSelectElement | null = null;
  private collectionSelect: HTMLSelectElement | null = null; private metadataNote: HTMLElement | null = null;
  private genreSuggestion: HTMLElement | null = null; private collectionSuggestion: HTMLElement | null = null;
  private readonly genreResolver = new GenreSuggestionResolver();
  public constructor(private readonly state: AppState, private readonly manager: ImportManager,
    private readonly genres: GenreRepository, private readonly collections: CollectionRepository, private readonly covers: CoverService,
    private readonly metadataExtractor: BookMetadataExtractor,
    private readonly onSaved: (book: Book) => void, private readonly onCancel: () => void, private readonly onReplaceExisting?: (bookId: string) => Promise<void>,
    private readonly oneDrive?: { connections: OneDriveConnections; coordinator: OneDriveImportCoordinator; initialSourceId?: string; openExisting(id: string): void }) { super(); }

  public override unmount(): void {
    this.generation++; this.oneDrive?.coordinator.cancel();
    void this.oneDrive?.coordinator.discard().catch(() => undefined);
    this.externalPanel?.unmount(); this.externalPanel = null; this.imported = null; this.automaticCover = ""; super.unmount();
  }

  public render(): HTMLElement {
    const section = this.createElement("section", "page-shell import-page");
    const form = this.createElement("form", "import-card");
    form.append(this.createElement("span", "eyebrow", tr("import.eyebrow")), this.createElement("h1", "page-title", tr("import.title")),
      this.createElement("p", "page-subtitle", tr("import.help")));
    const sourceChoices = this.createElement("div", "import-sources");
    const device = this.sourceButton("▣", I18nManager.shared.t("google.device"), I18nManager.shared.t("google.deviceHelp"));
    const comic = this.sourceButton("▧", tr("import.localComic"), tr("import.localComicHelp"));
    // Android personal libraries add Drive folders from the dedicated "+ Adicionar link"
    // flow. Keep this upload screen focused on files that already live on the device.
    sourceChoices.append(device, comic);
    const file = this.input(tr("import.fileAny"), "file"); file.wrapper.classList.add("import-source-panel", "is-hidden"); file.input.required = false; file.input.accept = ".pdf,.epub,.cbr,.cbz,application/pdf,application/epub+zip,application/x-cbr,application/x-cbz";
    const download = this.createElement("p", "download-status"); download.setAttribute("role", "status");
    const metadataNote = this.createElement("p", "metadata-note"); metadataNote.setAttribute("role", "status"); this.metadataNote = metadataNote;
    const title = this.input(tr("ui.edit.bookTitle"), "text"); const author = this.input(tr("ui.edit.author"), "text"); this.authorInput = author.input;
    const genreLabel = this.createElement("label", "field"); genreLabel.append(this.createElement("span", "field__label", tr("ui.edit.genre")));
    const genre = this.createElement("select", "input") as HTMLSelectElement; genre.required = true; this.genreSelect = genre; this.fillGenres(genre); genreLabel.append(genre);
    const genreSuggestion = this.createElement("div", "metadata-suggestion is-hidden"); this.genreSuggestion = genreSuggestion;
    const newGenreRow = this.createElement("div", "inline-form");
    const newGenre = this.createElement("input", "input") as HTMLInputElement; newGenre.placeholder = tr("ui.edit.newGenre"); newGenre.maxLength = 40;
    const createGenre = this.createElement("button", "button button--secondary", tr("ui.edit.createGenre")); createGenre.type = "button";
    createGenre.addEventListener("click", () => void this.createGenre(newGenre, genre)); newGenreRow.append(newGenre, createGenre);
    const collectionLabel = this.createElement("label", "field"); collectionLabel.append(this.createElement("span", "field__label", tr("import.collectionOptional")));
    const collection = this.createElement("select", "input") as HTMLSelectElement; collection.append(new Option(tr("import.noCollection"), "")); this.collectionSelect = collection; collectionLabel.append(collection); void this.fillCollections(collection);
    const collectionSuggestion = this.createElement("div", "metadata-suggestion is-hidden"); this.collectionSuggestion = collectionSuggestion;
    const statusLabel = this.createElement("label", "field"); statusLabel.append(this.createElement("span", "field__label", tr("import.initialStatus")));
    const status = this.createElement("select", "input") as HTMLSelectElement;
    status.append(new Option(tr("ui.book.unread"), "unread"), new Option(tr("ui.book.reading"), "reading"), new Option(tr("ui.book.finished"), "finished")); statusLabel.append(status);
    const coverPreview = this.createElement("div", "cover-preview is-hidden"); const coverImage = this.createElement("img", "") as HTMLImageElement; coverImage.alt = tr("import.coverAlt");
    const coverNote = this.createElement("span", "", tr("import.coverNote")); coverPreview.append(coverImage, coverNote);
    const error = this.createElement("p", "form-error"); error.setAttribute("role", "alert");
    const actions = this.createElement("div", "form-actions");
    const save = this.createElement("button", "button button--primary", tr("import.addToLibrary")); save.type = "submit";
    const cancel = this.createElement("button", "button button--secondary", tr("ui.common.cancel")); cancel.type = "button";
    cancel.addEventListener("click", () => { this.oneDrive?.coordinator.cancel(); this.onCancel(); }); actions.append(save, cancel);
    file.input.addEventListener("change", () => void this.selectFile(file.input, title.input, error, download, coverPreview, coverImage));
    device.addEventListener("click", () => {
      file.input.accept = ".pdf,.epub,.cbr,.cbz,application/pdf,application/epub+zip,application/x-cbr,application/x-cbz";
      file.wrapper.querySelector(".field__label")!.textContent = tr("import.fileAny");
      file.wrapper.classList.remove("is-hidden"); file.input.click();
    });
    comic.addEventListener("click", () => {
      file.input.accept = ".cbr,.cbz,application/x-cbr,application/x-cbz";
      file.wrapper.querySelector(".field__label")!.textContent = tr("import.fileComic");
      file.wrapper.classList.remove("is-hidden"); file.input.click();
    });
    form.append(sourceChoices, file.wrapper);
    form.append(download, coverPreview, metadataNote, title.wrapper, author.wrapper, genreLabel, genreSuggestion, newGenreRow, collectionLabel, collectionSuggestion, statusLabel, error, actions);
    if (this.oneDrive) {
      const cancelDownload = this.createElement("button", "button button--secondary is-hidden", I18nManager.shared.t("import.download.cancel"));
      cancelDownload.type = "button"; this.remoteCancel = cancelDownload;
      cancelDownload.addEventListener("click", () => { this.oneDrive?.coordinator.cancel(); this.imported = null; this.remotePreview = false; });
      const summary = this.createElement("p", "metadata-note"); this.fileSummary = summary;
      form.insertBefore(summary, metadataNote); form.insertBefore(cancelDownload, coverPreview);
      this.externalPanel = new ExternalLibrariesPanel(this.oneDrive.connections,
        async (driveId, item) => {
          if (this.remoteBusy) return;
          this.remoteBusy = true; this.remotePreview = false; this.imported = null; this.automaticCover = "";
          const generation = ++this.generation; save.disabled = true; sourceChoices.inert = true; cancelDownload.classList.remove("is-hidden");
          coverPreview.classList.add("is-hidden"); coverImage.removeAttribute("src"); summary.textContent = ""; error.replaceChildren();
          const progress = (key: Parameters<typeof I18nManager.shared.t>[0], percent?: number | null): void => {
            if (generation === this.generation) download.textContent = `${I18nManager.shared.t(key)}${percent == null ? "" : ` ${percent}%`}`;
          };
          try {
            const preview = await this.oneDrive!.coordinator.prepare(driveId, item.id, progress);
            if (generation !== this.generation) return;
            if (preview.duplicate.kind === "duplicate") {
              error.textContent = I18nManager.shared.t("import.remote.duplicate");
              const id = preview.duplicate.book.id;
              const open = this.createElement("button", "button button--secondary", I18nManager.shared.t("import.remote.openExisting")); open.type = "button";
              open.addEventListener("click", () => this.oneDrive!.openExisting(id)); error.append(open);
              await this.oneDrive!.coordinator.discard(); return;
            }
            this.imported = preview.imported; this.automaticCover = preview.cover; this.remotePreview = true;
            title.input.value = preview.metadata.title.value; author.input.value = preview.metadata.author?.value ?? "";
            coverImage.src = preview.cover; coverPreview.classList.remove("is-hidden");
            summary.textContent = `${I18nManager.shared.t("import.remote.name")}: ${preview.imported.originalName} · ${I18nManager.shared.t("import.remote.format")}: ${preview.imported.fileType.toUpperCase()} · ${I18nManager.shared.t("import.remote.size")}: ${(preview.imported.size / 1048576).toFixed(1)} MB`;
            metadataNote.textContent = I18nManager.shared.t("import.remote.preview");
            if (preview.metadata.genre) await this.suggestGenre(preview.metadata.genre.value);
            if (preview.metadata.collection) await this.suggestCollection(preview.metadata.collection.value);
            title.input.focus();
          } catch (caught) {
            if (generation === this.generation) { this.imported = null; this.remotePreview = false;
              error.textContent = caught instanceof OneDriveError ? caught.message : I18nManager.shared.t("import.remote.failed"); }
          } finally {
            if (generation === this.generation) { this.remoteBusy = false; save.disabled = false; sourceChoices.inert = false; cancelDownload.classList.add("is-hidden"); }
          }
        }, undefined, this.oneDrive.initialSourceId);
      // OneDrive remains available from Settings; the main source area has only
      // Device and Google Drive. Explicit OneDrive navigation still opens it.
      if (this.oneDrive.initialSourceId) form.insertBefore(this.externalPanel.render(), sourceChoices.nextSibling);
    }
    form.addEventListener("submit", (event) => void this.submit(event, { title: title.input, author: author.input, genre, collection, status, error, save,progress:download }));
    section.append(form); return section;
  }
  private async applyImported(imported: ImportedFile, title: HTMLInputElement, status: HTMLElement, preview: HTMLElement, image: HTMLImageElement): Promise<void> {
    this.remotePreview = false; await this.oneDrive?.coordinator.discard(); if (this.fileSummary) this.fileSummary.textContent = "";
    this.imported = imported; if (!title.value) title.value = imported.suggestedTitle; status.textContent = tr("import.preparingCover");
    this.automaticCover = await this.covers.fromBookFile(imported.file, imported.fileType, imported.suggestedTitle);
    image.src = this.automaticCover; preview.classList.remove("is-hidden");
    status.textContent = tr("import.identifying"); if (imported.fileType === "pdf" || imported.fileType === "epub") await this.analyzeMetadata(imported, title);
  }
  private async selectFile(input: HTMLInputElement, title: HTMLInputElement, error: HTMLElement, status: HTMLElement, preview: HTMLElement, image: HTMLImageElement): Promise<void> {
    if (this.remoteBusy) return;
    const file = input.files?.[0]; if (!file) return;
    try { await this.applyImported(await this.manager.select(file), title, status, preview, image); status.textContent = tr("import.prepared"); error.textContent = ""; }
    catch (caught) { this.imported = null; input.value = ""; error.textContent = caught instanceof Error ? caught.message : tr("import.invalidFile"); }
  }
  private async submit(event: SubmitEvent, fields: { title: HTMLInputElement; author: HTMLInputElement; genre: HTMLSelectElement;
    collection: HTMLSelectElement; status: HTMLSelectElement; error: HTMLElement; save: HTMLButtonElement;progress:HTMLElement }): Promise<void> {
    event.preventDefault();
    if (this.remoteBusy) return;
    if (!this.imported) { fields.error.textContent = tr("import.selectFile"); return; }
    fields.save.disabled = true;
    try {
      const metadata = { title: fields.title.value.trim(), author: fields.author.value.trim(),
        contentType: this.imported.fileType === "cbr" || this.imported.fileType === "cbz" ? "comic" as const : "book" as const,
        genreId: fields.genre.value, collectionId: fields.collection.value || undefined, readingStatus: fields.status.value as ReadingStatus, cover: this.automaticCover };
      const options = await this.resolveVersionConflict(this.imported, metadata);
      if(options.cancelled){fields.progress.textContent="";return;}
      if (this.remotePreview && this.oneDrive) {
        this.remoteBusy = true; this.remoteCancel?.classList.remove("is-hidden");
        const book = await this.oneDrive.coordinator.confirm(metadata, options,
          (stage, percent) => { fields.progress.textContent = `${I18nManager.shared.t(stage)}${percent == null ? "" : ` ${percent}%`}`; });
        this.remoteBusy = false; this.remotePreview = false;
        if (options.replaceBookId) await this.onReplaceExisting?.(options.replaceBookId);
        this.onSaved(book); return;
      }
      if(options.replaceBookId) await this.onReplaceExisting?.(options.replaceBookId);
      fields.progress.textContent=tr("import.preparing", { stage: tr("import.stageReading") });this.onSaved(await this.manager.save(this.imported, metadata,step=>{const labels={reading:tr("import.stageReading"),organizing:tr("import.stageOrganizing"),chapters:tr("import.stageChapters"),finalizing:tr("import.stageFinalizing")};fields.progress.textContent=tr("import.preparingPercent", { stage: labels[step.stage], percent: step.percent });},options));
    } catch (caught) { fields.error.textContent = caught instanceof ApiError || caught instanceof Error ? caught.message : tr("import.saveFailed"); }
    finally { this.remoteBusy = false; this.remoteCancel?.classList.add("is-hidden"); fields.save.disabled = false; }
  }
  private async resolveVersionConflict(imported:ImportedFile,metadata:{title:string;author:string}):Promise<{allowPossibleVersion?:boolean;replaceBookId?:string;cancelled?:boolean}>{
    const decision=await this.manager.inspect(imported,metadata);
    if(decision.kind==="duplicate")throw new DuplicateBookImportError(decision);
    if(decision.kind!=="possible-version")return{};
    const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase().trim();
    const answer=normalize(prompt(I18nManager.shared.t("library.versionPrompt"),I18nManager.shared.t("library.versionKeep"))??I18nManager.shared.t("library.versionCancel"));
    if(answer.startsWith(normalize(I18nManager.shared.t("library.versionReplace"))))return{replaceBookId:decision.book.id};
    if(answer.startsWith(normalize(I18nManager.shared.t("library.versionKeep"))))return{allowPossibleVersion:true};
    return{cancelled:true};
  }
  private async createGenre(input: HTMLInputElement, select: HTMLSelectElement): Promise<void> {
    const name = input.value.trim(); if (!name) return;
    const existing = this.state.genres.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const genre = existing ?? new Genre(crypto.randomUUID(), name);
    if (!existing) { await this.genres.save(genre); this.state.library.addGenre(genre); this.state.notify(); }
    this.fillGenres(select); select.value = genre.id; input.value = "";
  }
  private fillGenres(select: HTMLSelectElement): void {
    const selected = select.value; select.replaceChildren(new Option(tr("import.select"), ""));
    this.state.genres.forEach((genre) => select.append(new Option(genre.name, genre.id))); select.value = selected;
  }
  private async analyzeMetadata(imported: ImportedFile, title: HTMLInputElement): Promise<void> {
    try { const detected = await this.metadataExtractor.extract(imported.file, imported.fileType); title.value = detected.title.value;
      if (detected.author && this.authorInput) this.authorInput.value = detected.author.value;
      const notes = [tr("import.noteTitle", { confidence: this.confidence(detected.title.confidence) })]; if (detected.author) notes.push(tr("import.noteAuthor", { confidence: this.confidence(detected.author.confidence) }));
      if (detected.genre) { notes.push(tr("import.noteGenre", { confidence: this.confidence(detected.genre.confidence) })); await this.suggestGenre(detected.genre.value); }
      if (detected.collection) await this.suggestCollection(detected.collection.value);
      if (this.metadataNote) this.metadataNote.textContent = tr("import.autoFilled", { notes: notes.join(" · ") });
    } catch { if (this.metadataNote) this.metadataNote.textContent = tr("import.autoFailed"); }
  }
  private async suggestGenre(name: string): Promise<void> {
    if (!this.genreSelect || !this.genreSuggestion) return; const resolution = this.genreResolver.resolve({ value: name, confidence: "medium" }, this.state.genres);
    if (resolution.kind === "existing") { this.genreSelect.value = resolution.genre.id; this.genreSuggestion.classList.add("is-hidden"); return; }
    this.genreSuggestion.replaceChildren(this.createElement("span", "", tr("import.suggestedGenre", { name }))); const create = this.createElement("button", "button button--secondary", tr("import.createAndUse")); create.type = "button";
    create.addEventListener("click", async () => { if (!this.genreSelect) return; const genre = new Genre(crypto.randomUUID(), name); await this.genres.save(genre); this.state.library.addGenre(genre); this.fillGenres(this.genreSelect); this.genreSelect.value = genre.id; this.genreSuggestion?.classList.add("is-hidden"); });
    this.genreSuggestion.append(create); this.genreSuggestion.classList.remove("is-hidden");
  }
  private async suggestCollection(name: string): Promise<void> {
    if (!this.collectionSelect || !this.collectionSuggestion) return; const existing = await this.collections.findByName(name);
    if (existing) { this.collectionSelect.value = existing.id; return; }
    this.collectionSuggestion.replaceChildren(this.createElement("span", "", tr("import.suggestCollection", { name }))); const create = this.createElement("button", "button button--secondary", tr("import.createAndUse")); create.type = "button";
    create.addEventListener("click", async () => { if (!this.collectionSelect) return; const collection = new Collection(crypto.randomUUID(), name, "author"); await this.collections.save(collection); this.collectionSelect.append(new Option(collection.name, collection.id)); this.collectionSelect.value = collection.id; this.collectionSuggestion?.classList.add("is-hidden"); });
    this.collectionSuggestion.append(create); this.collectionSuggestion.classList.remove("is-hidden");
  }
  private async fillCollections(select: HTMLSelectElement): Promise<void> { (await this.collections.getAll()).forEach(item => select.append(new Option(item.name, item.id))); }
  private confidence(value: Confidence): string { return value === "high" ? tr("import.confidenceHigh") : value === "medium" ? tr("import.confidenceMedium") : tr("import.confidenceLow"); }
  private input(labelText: string, type: string): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
    const wrapper = this.createElement("label", "field"); wrapper.append(this.createElement("span", "field__label", labelText));
    const input = this.createElement("input", "input") as HTMLInputElement; input.type = type; input.required = type !== "file"; wrapper.append(input); return { wrapper, input };
  }
  private sourceButton(icon: string, title: string, description: string): HTMLButtonElement {
    const button = this.createElement("button", "import-source") as HTMLButtonElement; button.type = "button";
    button.append(this.createElement("span", "import-source__icon", icon), this.createElement("strong", "", title), this.createElement("small", "", description)); return button;
  }
}
