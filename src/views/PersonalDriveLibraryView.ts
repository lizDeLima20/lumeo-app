import type { AppState } from "../core/AppState";
import { GoogleDriveAccessError, GoogleDriveLibraryService } from "../external/GoogleDriveLibraryService";
import { GoogleDriveLibraryRepository, type GoogleDriveLibraryEntry, type GoogleDriveLibrarySource } from "../external/GoogleDriveLibraryRepository";
import type { Book } from "../models/Book";
import { PersonalDriveImporter } from "../services/PersonalDriveImporter";
import { PersonalDriveLibraryService } from "../services/PersonalDriveLibraryService";
import { BaseView } from "./BaseView";
import { DownloadProgressIcon } from "./DownloadProgressIcon";

/** Personal Drive shelf. Cached metadata is immediate; saved sources refresh automatically. */
export class PersonalDriveLibraryView extends BaseView {
  private readonly service: PersonalDriveLibraryService;
  private controller: AbortController | null = null;
  public constructor(private readonly state: AppState, private readonly sources: GoogleDriveLibraryRepository,
    drive: GoogleDriveLibraryService, private readonly importer: PersonalDriveImporter,
    private readonly saved: (book: Book) => void, private readonly open: (id: string) => void,
    private readonly refreshGenres: () => Promise<void>, private readonly openLinkModal = false,
    private readonly reclassified: (book: Book) => void = () => undefined) { super(); this.service = new PersonalDriveLibraryService(drive); }
  public override unmount(): void { this.controller?.abort(); this.controller = null; super.unmount(); }

  public render(): HTMLElement {
    const section = this.createElement("section", "catalog catalog--explore page-shell personal-drive-library");
    const heading = this.createElement("div", "personal-drive-library__eyebrow"); heading.append(this.createElement("span", "eyebrow", "Biblioteca pessoal"));
    const welcome = this.createElement("section", "personal-drive-library__welcome");
    welcome.append(this.createElement("h1", "personal-drive-library__welcome-title", "Bem-vindo ao Lumeo"), this.createElement("p", "personal-drive-library__welcome-copy", "Escolha sua preferência"));
    const choices = this.createElement("div", "personal-drive-library__choices");
    const choice = (type: "book" | "comic"): HTMLButtonElement => {
      const comic = type === "comic", button = this.createElement("button", `personal-drive-library__choice personal-drive-library__choice--${type}`) as HTMLButtonElement;
      button.type = "button"; button.setAttribute("aria-label", comic ? "Explorar quadrinhos" : "Explorar livros");
      const shelf = this.createElement("span", "personal-drive-library__choice-covers");
      (comic ? ["HQ", "MARVEL", "DC", "MANGÁ", "MÔNICA", "DRAGON BALL"] : ["DESENVOLVIMENTO", "HISTÓRIA", "CIÊNCIA", "FICÇÃO", "PSICOLOGIA", "NEGÓCIOS"]).forEach((label, index) => {
        const cover = this.createElement("span", `personal-drive-library__choice-cover personal-drive-library__choice-cover--${index + 1}`, label); cover.setAttribute("aria-hidden", "true"); shelf.append(cover);
      });
      const footer = this.createElement("span", "personal-drive-library__choice-footer"); footer.append(this.createElement("span", "personal-drive-library__choice-icon", comic ? "▣" : "▤"), this.createElement("strong", "", comic ? "Quadrinhos" : "Livros"), this.createElement("span", "personal-drive-library__choice-arrow", "→"));
      button.append(shelf, footer); return button;
    };
    const bookChoice = choice("book"), comicChoice = choice("comic"); choices.append(bookChoice, comicChoice); welcome.append(choices);
    const status = this.createElement("p", "catalog__status personal-drive-library__status"); status.setAttribute("role", "status");
    const retry = this.createElement("button", "button button--secondary is-hidden", "Tentar novamente"); retry.type = "button";
    const search = this.createElement("input", "input") as HTMLInputElement; search.type = "search"; search.placeholder = "Pesquisar livros"; search.setAttribute("aria-label", "Pesquisar livros");
    const chips = this.createElement("div", "catalog__genre-carousel"), grid = this.createElement("div", "catalog__grid"), more = this.createElement("button", "button button--secondary catalog__more is-hidden", "Mostrar mais"), controls = this.createElement("div", "catalog__controls"), backToChoice = this.createElement("button", "personal-drive-library__switch", "← Escolher biblioteca");
    backToChoice.type = "button"; controls.append(backToChoice, search, chips);
    const browser = this.createElement("div", "personal-drive-library__browser"); browser.append(controls, status, retry, grid, more); section.append(heading, welcome, browser);
    let mode: "choice" | "book" | "comic" = "choice", entries: GoogleDriveLibraryEntry[] = [], selectedGenre = "", lastSource: GoogleDriveLibrarySource | null = null, visibleLimit = 60;
    const applyMode = (next: "choice" | "book" | "comic"): void => { mode = next; selectedGenre = ""; visibleLimit = 60; welcome.hidden = mode !== "choice"; browser.hidden = mode === "choice"; if (mode !== "choice") { search.placeholder = mode === "comic" ? "Pesquisar quadrinhos" : "Pesquisar livros"; drawFilters(); drawGrid(); } };
    const local = (entry: GoogleDriveLibraryEntry): Book | undefined => this.state.books.find(book => book.catalogBookId === `drive:${entry.fileId}` && book.sourceVersion === version(entry));
    const drawGrid = (): void => {
      const query = fold(search.value), seen = new Set<string>(); const filtered = entries.filter(entry => { if (seen.has(entry.fileId)) return false; seen.add(entry.fileId); return mode !== "choice" && (entry.contentType ?? "book") === mode && (!selectedGenre || entry.genre === selectedGenre) && (!query || fold(`${entry.title ?? ""} ${entry.name} ${entry.author ?? ""}`).includes(query)); }); grid.replaceChildren();
      const cardFor = (entry: GoogleDriveLibraryEntry): HTMLElement => {
        const book = local(entry), card = this.createElement("article", "catalog-card"), coverFrame = this.createElement("div", "catalog-card__cover-frame"), cover = this.createElement("button", "catalog-card__cover") as HTMLButtonElement;
        const title = entry.title || stripExtension(entry.name); cover.type = "button"; cover.setAttribute("aria-label", `Detalhes de ${title}`);
        const image = this.createElement("img", "") as HTMLImageElement; image.alt = `Capa de ${title}`; image.loading = "lazy"; image.decoding = "async"; image.src = book?.cover || entry.coverUrl || entry.thumbnailUrl;
        image.addEventListener("error", () => { image.remove(); cover.append(this.createElement("span", "catalog-card__placeholder", "▣")); }, { once: true }); cover.append(image);
        const info = this.createElement("div", "catalog-card__info"); info.append(this.createElement("strong", "catalog-card__title", title)); if (entry.author) info.append(this.createElement("span", "catalog-card__author", entry.author));
        const action = this.createElement("button", "catalog-card__quick-action") as HTMLButtonElement; action.type = "button"; action.title = book ? "Abrir livro" : "Baixar livro"; action.setAttribute("aria-label", action.title);
        const icon = new DownloadProgressIcon(action, Boolean(book));
        const details = (): void => this.showDetails(entry, local(entry), () => void (local(entry) ? this.open(local(entry)!.id) : download(entry, action, icon)));
        cover.addEventListener("click", details); action.addEventListener("click", event => { event.stopPropagation(); void (book ? this.open(book.id) : download(entry, action, icon)); }); coverFrame.append(cover, action); card.append(coverFrame, info); return card;
      };
      const comics = filtered.filter(entry => entry.contentType === "comic" && entry.collectionPath?.length);
      if (comics.length && !selectedGenre) {
        const sections = new Map<string, GoogleDriveLibraryEntry[]>();
        comics.slice(0, visibleLimit).forEach(entry => { const label = entry.collectionPath![0] || entry.genre; const group = sections.get(label) ?? []; group.push(entry); sections.set(label, group); });
        for (const [label, group] of sections) { const collection = this.createElement("section", "drive-comic-carousel"); collection.append(this.createElement("h2", "drive-comic-carousel__title", label)); const track = this.createElement("div", "drive-comic-carousel__track"); group.forEach(entry => track.append(cardFor(entry))); collection.append(track); grid.append(collection); }
        filtered.filter(entry => !comics.includes(entry)).slice(0, visibleLimit).forEach(entry => grid.append(cardFor(entry)));
      } else filtered.slice(0, visibleLimit).forEach(entry => grid.append(cardFor(entry)));
      if (!grid.childElementCount) grid.append(this.createElement("p", "catalog__status", entries.length ? "Nenhum livro encontrado com este filtro." : "Adicione uma pasta do Google Drive pelo menu."));
      more.classList.toggle("is-hidden", filtered.length <= visibleLimit);
    };
    const drawFilters = (): void => { chips.replaceChildren(); const genres = [...new Set(entries.filter(entry => mode !== "choice" && (entry.contentType ?? "book") === mode).map(entry => entry.genre))].sort((a, b) => a.localeCompare(b, "pt-BR"));
      [["", "Todos"], ...genres.map(name => [name, name] as const)].forEach(([value, label]) => { const chip = this.createElement("button", "catalog__genre-chip", label); chip.type = "button"; chip.setAttribute("aria-pressed", String(selectedGenre === value)); chip.addEventListener("click", () => { selectedGenre = value; visibleLimit = 60; drawFilters(); drawGrid(); }); chips.append(chip); }); };
    const cache = async (): Promise<void> => { entries = await this.sources.entries(); drawFilters(); drawGrid(); };
    const chooseInitialMode = async (): Promise<void> => {
      const savedSources = await this.sources.all(), hasBooks = savedSources.some(source => (source.contentType ?? "book") === "book"), hasComics = savedSources.some(source => source.contentType === "comic");
      applyMode(hasBooks && !hasComics ? "book" : hasComics && !hasBooks ? "comic" : "choice");
    };
    const sync = async (source: GoogleDriveLibrarySource): Promise<boolean> => {
      this.controller?.abort(); const controller = this.controller = new AbortController(); lastSource = source; retry.classList.add("is-hidden"); status.textContent = "Sincronizando biblioteca…";
      try { const existing = await this.sources.entries(source.id), resume = await this.sources.syncState(source.id); await this.service.listProgressively(source, existing, resume, controller.signal, async (batch, state, value) => {
          if (batch.length) { const saved = await this.sources.appendEntries(source.id, batch); entries = [...entries.filter(entry => entry.sourceId !== source.id), ...saved]; drawFilters(); drawGrid(); }
          await this.sources.saveSyncState(source.id, state);
          status.textContent = state.completed ? (value.files > 0 ? `${value.files} livro(s) sincronizado(s).` : "A pasta está vazia ou não possui PDF, EPUB, CBR ou CBZ.") : `Sincronizando: ${value.files} livro(s) encontrados…`;
        }); return true;
      } catch (error) { if (controller.signal.aborted) return false; console.warn(JSON.stringify({ event: "PERSONAL_DRIVE_SYNC_FAILED", sourceId: source.id, reason: error instanceof Error ? error.name : "unknown", detail: safeErrorDetail(error) })); status.textContent = message(error); retry.classList.remove("is-hidden"); return false;
      } finally { if (this.controller === controller) this.controller = null; }
    };
    /* The icon follows the bytes really received; success is shown only after the file is
     * saved locally, and only then the book opens in the reader that fits it. */
    const download = async (entry: GoogleDriveLibraryEntry, button: HTMLButtonElement, icon: DownloadProgressIcon): Promise<void> => {
      if (button.disabled) return;
      const controller = new AbortController(); button.disabled = true; button.setAttribute("aria-busy", "true"); icon.set("downloading", 0); status.textContent = `Baixando ${stripExtension(entry.name)}…`;
      try { const book = await this.importer.importListedFile({ id: entry.fileId, name: entry.name, mimeType: entry.mimeType, size: entry.size, modifiedTime: entry.modifiedTime, resourceKey: entry.resourceKey }, entry.genre, controller.signal, entry.contentType ?? "book", (done, _total, _name, percent) => { if (done > 0) return; icon.progress(percent ?? null); if (percent === 100) icon.set("saving", 100); });
        icon.set("done", 100); await this.refreshGenres(); this.saved(book); status.textContent = `${entry.name} está disponível offline.`;
        await new Promise<void>(resolve => window.setTimeout(resolve, 420)); this.open(book.id);
      } catch (error) { button.disabled = false; button.removeAttribute("aria-busy"); icon.set("error", 0); status.textContent = message(error, true); }
    };
    const openManager = (): void => {
      const dialog = document.createElement("dialog"); dialog.className = "catalog-genre-dialog"; const panel = this.createElement("section", "catalog-genre-dialog__panel personal-drive-library__manager"); panel.append(this.createElement("h2", "", "Adicionar pasta do Google Drive"), this.createElement("p", "personal-drive-library__manager-help", "Adicione o link do Google Drive aqui"));
      const icon = (name: "link" | "folder" | "book" | "comic" | "trash"): SVGSVGElement => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none"); svg.setAttribute("aria-hidden", "true");
        const paths: Record<typeof name, readonly string[]> = {
          link: ["M10.1 13.9a4 4 0 0 0 5.66 0l2.12-2.12a4 4 0 0 0-5.66-5.66l-1.22 1.22", "M13.9 10.1a4 4 0 0 0-5.66 0l-2.12 2.12a4 4 0 0 0 5.66 5.66l1.22-1.22"],
          folder: ["M3 6.75A1.75 1.75 0 0 1 4.75 5h4.04l1.7 1.7H19.25A1.75 1.75 0 0 1 21 8.45v8.8A1.75 1.75 0 0 1 19.25 19H4.75A1.75 1.75 0 0 1 3 17.25z"],
          book: ["M4 5.25A2.25 2.25 0 0 1 6.25 3H11v16H6.25A2.25 2.25 0 0 0 4 21z", "M20 5.25A2.25 2.25 0 0 0 17.75 3H13v16h4.75A2.25 2.25 0 0 1 20 21z"],
          comic: ["M4 4.5h16v15H4z", "M8 4.5v15M16 4.5v15", "M4 9.5h16"],
          trash: ["M4.75 7h14.5", "M9.25 3.75h5.5", "M6.5 7l.75 12.25h9.5L17.5 7", "M10 10.5v5.25M14 10.5v5.25"]
        };
        paths[name].forEach(value => { const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", value); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.8"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round"); svg.append(path); });
        return svg;
      };
      const form = this.createElement("form", "personal-drive-library__link-form"), linkField = this.createElement("label", "personal-drive-library__link-field"), input = this.createElement("input", "") as HTMLInputElement, submit = this.createElement("button", "personal-drive-library__link-submit", "OK"); input.required = true; input.type = "url"; input.placeholder = "Cole o link do Google Drive aqui…"; input.setAttribute("aria-label", input.placeholder); const linkIcon = icon("link"); linkIcon.classList.add("personal-drive-library__link-icon"); linkField.append(linkIcon, input); submit.type = "submit"; form.append(linkField, submit);
      const note = this.createElement("p", "catalog__status"), list = this.createElement("div", "personal-drive-library__source-list"), close = this.createElement("button", "personal-drive-library__close", "← Fechar"); close.type = "button"; close.addEventListener("click", () => dialog.close());
      const reclassify = async (source: GoogleDriveLibrarySource): Promise<void> => { const sourceEntries = await this.sources.entries(source.id), changed = await this.importer.reclassifyListedFiles(sourceEntries.map(entry => entry.fileId), source.contentType ?? "book"); changed.forEach(book => this.reclassified(book)); };
      const renderSources = async (): Promise<void> => { const rows = await this.sources.all(); list.replaceChildren(); rows.forEach((source, index) => { const labelText = source.name || `Link ${index + 1}`, row = this.createElement("div", "personal-drive-library__source"), folder = this.createElement("span", "personal-drive-library__source-folder"), label = this.createElement("span", "personal-drive-library__source-name", labelText), type = this.createElement("button", "personal-drive-library__type") as HTMLButtonElement; folder.append(icon("folder")); type.type = "button"; const updateType = async (): Promise<void> => { const next = (source.contentType ?? "book") === "comic" ? "book" : "comic", updated = await this.sources.updateContentType(source.id, next); if (!updated) return; source = updated; entries = entries.map(entry => entry.sourceId === updated.id ? { ...entry, contentType: updated.contentType } : entry); await reclassify(updated); drawFilters(); drawGrid(); note.textContent = `${updated.name} foi classificado como ${updated.contentType === "comic" ? "HQs e Mangás" : "Livros"}.`; updateTypeButton(); }; const updateTypeButton = (): void => { const comic = (source.contentType ?? "book") === "comic"; type.replaceChildren(icon(comic ? "comic" : "book"), document.createTextNode(comic ? "HQs e Mangás" : "Livros")); type.setAttribute("aria-label", `Alterar ${labelText}: ${comic ? "HQs e Mangás" : "Livros"}`); }; updateTypeButton(); type.addEventListener("click", () => void updateType()); const remove = this.createElement("button", "personal-drive-library__delete"); remove.type = "button"; remove.setAttribute("aria-label", `Remover ${labelText}`); remove.title = "Remover link"; remove.append(icon("trash")); remove.addEventListener("click", () => void (async () => { if (!window.confirm(`Remover ${labelText}? Os livros baixados não serão apagados.`)) return; await this.sources.remove(source.id); entries = entries.filter(entry => entry.sourceId !== source.id); drawFilters(); drawGrid(); await renderSources(); })()); row.append(folder, label, type, remove); list.append(row); }); };
      form.addEventListener("submit", event => void (async () => { event.preventDefault(); submit.disabled = true; try {
        GoogleDriveLibraryRepository.parse(input.value); note.textContent = "Reconhecendo pasta…"; const result = await this.sources.saveLink(input.value); input.value = ""; await reclassify(result.source); entries = entries.map(entry => entry.sourceId === result.source.id ? { ...entry, contentType: result.source.contentType } : entry); await renderSources(); await chooseInitialMode(); dialog.close(); void sync(result.source);
      } catch (error) { note.textContent = message(error); } finally { submit.disabled = false; } })());
      panel.append(form, note, list, close); dialog.append(panel); dialog.addEventListener("close", () => dialog.remove(), { once: true }); document.body.append(dialog); void renderSources(); dialog.showModal();
    };
    bookChoice.addEventListener("click", () => applyMode("book")); comicChoice.addEventListener("click", () => applyMode("comic")); backToChoice.addEventListener("click", () => applyMode("choice"));
    retry.addEventListener("click", () => { if (lastSource) void sync(lastSource); }); search.addEventListener("input", () => { visibleLimit = 60; drawGrid(); }); more.addEventListener("click", () => { visibleLimit += 60; drawGrid(); }); applyMode("choice"); void (async () => { await cache(); const savedSources = await this.sources.all(); await chooseInitialMode(); for (const source of savedSources) { const state = await this.sources.syncState(source.id), cached = await this.sources.entries(source.id); if ((state && !state.completed) || (!state && cached.length === 0)) await sync(source); } if (this.openLinkModal) openManager(); })(); return section;
  }
  private showDetails(entry: GoogleDriveLibraryEntry, book: Book | undefined, action: () => void): void {
    const dialog = document.createElement("dialog"); dialog.className = "catalog-genre-dialog catalog-genre-dialog--details"; const panel = this.createElement("section", "catalog-genre-dialog__panel"); const title = entry.title || stripExtension(entry.name); const cover = this.createElement("img", "catalog-genre-dialog__cover") as HTMLImageElement; cover.src = book?.cover || entry.coverUrl || entry.thumbnailUrl; cover.alt = `Capa de ${title}`; cover.addEventListener("error", () => cover.remove(), { once: true }); panel.append(cover, this.createElement("h2", "", title), this.createElement("p", "catalog-genre-dialog__book", `Gênero: ${entry.genre}`));
    if (entry.author) panel.append(this.createElement("p", "catalog-genre-dialog__book", `Autor: ${entry.author}`));
    if (book?.publicationYear) panel.append(this.createElement("p", "catalog-genre-dialog__book", `Ano: ${book.publicationYear}`));
    const synopsis = cleanText(entry.synopsis) ?? book?.summary ?? book?.description; if (synopsis) panel.append(this.createElement("p", "catalog-genre-dialog__book", synopsis));
    panel.append(this.createElement("p", "catalog-genre-dialog__book", `Formato: ${extension(entry.name).toUpperCase() || "arquivo"}`));
    const actions = this.createElement("div", "catalog-genre-dialog__actions"), close = this.createElement("button", "button button--secondary", "Fechar"), main = this.createElement("button", "button button--primary", book ? "Abrir" : "Baixar"); close.type = "button"; main.type = "button"; close.addEventListener("click", () => dialog.close()); main.addEventListener("click", () => { dialog.close(); action(); }); actions.append(close, main); panel.append(actions); dialog.append(panel); dialog.addEventListener("close", () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal();
  }
}
function version(entry: GoogleDriveLibraryEntry): string { return entry.modifiedTime ?? `${entry.name}:${entry.size ?? ""}`; }
function fold(value: string): string { return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim(); }
function stripExtension(value: string): string { return value.replace(/\.(pdf|epub|cbr|cbz)$/i, ""); }
function extension(value: string): string { return value.match(/\.([a-z0-9]+)$/i)?.[1] ?? ""; }
function message(error: unknown, download = false): string {
  if (error instanceof GoogleDriveAccessError) return ({ DRIVE_ACCOUNT_NOT_AUTHORIZED: "Autorize sua conta Google para acessar a pasta.", DRIVE_FOLDER_FORBIDDEN: "Você não tem permissão para esta pasta.", DRIVE_ITEM_NOT_FOUND: "A pasta não foi encontrada. Confira o link.", DRIVE_CONNECTION_FAILED: "Falha de conexão com o Google Drive." })[error.code];
  if (error instanceof DOMException && error.name === "AbortError") return "Sincronização cancelada.";
  if (error instanceof Error && error.message === "DRIVE_LINK_NOT_FOLDER") return "Cole o link de uma pasta do Google Drive.";
  if (error instanceof Error && /invalidLink|link/i.test(error.message)) return "Link inválido.";
  return download ? "Download bloqueado ou falha de conexão." : "Não foi possível sincronizar a pasta. Tente novamente.";
}
function safeErrorDetail(error: unknown): string | null { return error instanceof Error ? error.message.replace(/Bearer\s+[^\s]+|ya29\.[\w.-]+/g, "[redacted]").slice(0, 160) : null; }
function cleanText(value: unknown): string | undefined { return typeof value === "string" && value.trim() && value !== "undefined" && value !== "null" && value !== "[object Object]" ? value.trim() : undefined; }
