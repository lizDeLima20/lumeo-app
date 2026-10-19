import type { AppState } from "../core/AppState";
import { GoogleDriveAccessError, GoogleDriveLibraryService } from "../external/GoogleDriveLibraryService";
import { GoogleDriveLibraryRepository, type GoogleDriveFolderNode, type GoogleDriveLibraryEntry, type GoogleDriveLibrarySource } from "../external/GoogleDriveLibraryRepository";
import { DriveComicShelf } from "./DriveComicShelf";
import { PersonalDriveCoverResolver, driveCoverThumbnail, driveLocalFirstPage, type DriveCoverCache } from "../services/PersonalDriveCoverResolver";
import { driveChildFolders, driveFilesIn, driveFirstUnlisted, driveRootOf, driveSections, driveTrail } from "../services/PersonalDriveFolderTree";
import type { Book } from "../models/Book";
import { createLumeoCoverPlaceholder } from "../components/Book3DFaces";
import { PersonalDriveImporter } from "../services/PersonalDriveImporter";
import { PERSONAL_DRIVE_CATALOG_RULES } from "../services/PersonalDriveCatalogSource";
import { PERSONAL_DRIVE_SYNC_VERSION, PersonalDriveLibraryService } from "../services/PersonalDriveLibraryService";
import { BaseView } from "./BaseView";
import { DownloadProgressIcon } from "./DownloadProgressIcon";
import { DriveItemDetails, type DriveItemDetailsInput, type DriveItemDownloadUpdate } from "./DriveItemDetails";
import { bindCoverBackdrop } from "../components/CoverBackdrop";

/** Personal Drive shelf. Cached metadata is immediate; saved sources refresh automatically. */
export class PersonalDriveLibraryView extends BaseView {
  private readonly service: PersonalDriveLibraryService;
  private readonly coverResolver: PersonalDriveCoverResolver;
  private controller: AbortController | null = null;
  private readonly details = new DriveItemDetails();
  public constructor(private readonly state: AppState, private readonly sources: GoogleDriveLibraryRepository,
    drive: GoogleDriveLibraryService, private readonly importer: PersonalDriveImporter,
    private readonly saved: (book: Book) => void, private readonly open: (id: string) => void,
    private readonly refreshGenres: () => Promise<void>, private readonly openLinkModal = false,
    private readonly reclassified: (book: Book) => void = () => undefined,
    covers?: { cache: DriveCoverCache; localFile: (bookId: string) => Promise<Blob | null> }) {
    super(); this.service = new PersonalDriveLibraryService(drive);
    const memory = new Map<string, string>();
    this.coverResolver = new PersonalDriveCoverResolver({ drive, cache: covers?.cache ?? { get: async key => memory.get(key) ?? null, save: async (key, value) => { memory.set(key, value); } },
      localFile: async entry => { const book = this.state.books.find(value => value.catalogBookId === `drive:${entry.fileId}`); return book && covers ? covers.localFile(book.id) : null; },
      firstPage: driveLocalFirstPage, thumbnail: blob => driveCoverThumbnail(blob),
      authorize: async () => { await drive.prepare(); if (!drive.authorized) await drive.connect(); } });
  }
  public override unmount(): void { this.controller?.abort(); this.controller = null; this.details.close(); super.unmount(); }

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
    // Drive tree: each source is one category; its folders are navigated below it.
    let sourcesList: GoogleDriveLibrarySource[] = [], openFolder: { sourceId: string; folderId: string } | null = null, coverObserver: IntersectionObserver | null = null, coversOnScreen = new AbortController(), comicShelf: DriveComicShelf | null = null;
    const folderNodes = new Map<string, GoogleDriveFolderNode[]>();
    const applyMode = (next: "choice" | "book" | "comic"): void => { mode = next; selectedGenre = ""; visibleLimit = 60; welcome.hidden = mode !== "choice"; browser.hidden = mode === "choice"; if (mode !== "choice") { search.placeholder = mode === "comic" ? "Pesquisar quadrinhos" : "Pesquisar livros"; drawFilters(); drawGrid(); } };
    // The copy of this Drive file on the device. A copy whose version was not kept (saving the
    // reading progress or a cloud merge rewrites the book without it) is still that file when
    // it is on the device: it opens instead of being downloaded again.
    const local = (entry: GoogleDriveLibraryEntry): Book | undefined => this.state.books.find(book => book.catalogBookId === `drive:${entry.fileId}`
      && (book.sourceVersion === version(entry) || (!book.sourceVersion && book.availability === "AVAILABLE")));
    // Downloads running now, who follows each one (an open details page), and the book each
    // finished one became - so a details page can show Abrir before the library has it.
    const downloads = new Map<string, DriveItemDownloadUpdate>(), watchers = new Map<string, Set<(update: DriveItemDownloadUpdate) => void>>(), finished = new Map<string, string>();
    // The card on screen for each file: a sync redraw replaces the card a download started on,
    // and the new one shows that download too.
    const cards = new Map<string, { action: HTMLButtonElement; icon: DownloadProgressIcon }>();
    const paint = (card: { action: HTMLButtonElement; icon: DownloadProgressIcon }, update: DriveItemDownloadUpdate): void => {
      const busy = update.state === "downloading" || update.state === "indeterminate" || update.state === "saving";
      if (busy) { card.action.disabled = true; card.action.setAttribute("aria-busy", "true"); } else { card.action.disabled = false; card.action.removeAttribute("aria-busy"); }
      if (update.state === "downloading" || update.state === "indeterminate") card.icon.progress(update.percent); else card.icon.set(update.state, update.state === "error" ? 0 : 100);
    };
    const report = (fileId: string, update: DriveItemDownloadUpdate): void => {
      if (update.state === "done" || update.state === "error") downloads.delete(fileId); else downloads.set(fileId, update);
      const card = cards.get(fileId); if (card) paint(card, update);
      watchers.get(fileId)?.forEach(listener => listener(update));
    };
    // Cards kept across the redraws a sync makes while it lists more pages: the same card is
    // put back, with its cover shown or still loading, instead of a new one asking again.
    // Changing genre, folder or search starts from new cards (resetCovers).
    let kept = new Map<string, { key: string; card: HTMLElement }>();
    const cardFor = (entry: GoogleDriveLibraryEntry): HTMLElement => {
      const key = [version(entry), entry.coverUrl ?? "", entry.title ?? "", entry.author ?? "", local(entry)?.id ?? ""].join("|"), same = kept.get(entry.fileId);
      if (same?.key === key) return same.card;
      const card = makeCard(entry); kept.set(entry.fileId, { key, card }); return card;
    };
    const makeCard = (entry: GoogleDriveLibraryEntry): HTMLElement => {
      const book = local(entry), card = this.createElement("article", "catalog-card"), coverFrame = this.createElement("div", "catalog-card__cover-frame"), cover = this.createElement("button", "catalog-card__cover") as HTMLButtonElement;
      const title = entry.title || stripExtension(entry.name); cover.type = "button"; cover.setAttribute("aria-label", `Detalhes de ${title}`);
      const image = this.createElement("img", "") as HTMLImageElement; image.alt = `Capa de ${title}`; image.loading = "lazy"; image.decoding = "async"; bindCoverBackdrop(cover, image);
      const initial = book?.cover || this.coverResolver.peek(entry), placeholder = createLumeoCoverPlaceholder(title);
      // The generic Lumeo cover is deliberately mounted first. It is removed only
      // after the original image loads; a missing or stale URL keeps the fallback.
      // A book's catalog cover URL that does not load here (a refused or throttled request) is
      // not the end: the cover is made once from the catalog's cover file through the Drive API
      // and cached, so every genre and the next visits show it. Comics are left as they were.
      let retried = entry.contentType === "comic";
      const showRealCover = (url: string): void => {
        // Called before the card is on screen too (catalog or downloaded cover): what matters
        // is that this card still shows its placeholder.
        if (placeholder.parentNode !== cover || image.parentNode) return;
        image.addEventListener("load", () => placeholder.remove(), { once: true });
        image.addEventListener("error", () => {
          image.remove();
          if (retried) return;
          retried = true;
          console.info(JSON.stringify({ event: "DRIVE_COVER_URL_FAILED", fileId: entry.fileId, genre: entry.genre }));
          void this.coverResolver.resolve(entry, coversOnScreen.signal, true).then(next => { if (next && next !== url) showRealCover(next); }).catch(() => undefined);
        }, { once: true });
        image.src = url; cover.append(image);
      };
      cover.append(placeholder);
      // A catalog's cover is a request to Google's image host: asked only for cards near the
      // screen, so opening a genre does not send sixty at once (that is what answered 429).
      // Covers already on the device (data URLs) show at once.
      const remote = Boolean(initial && /^https?:/i.test(initial) && coverObserver);
      if (initial && !remote) showRealCover(initial);
      else {
        // The cached/Drive/first-page artwork is resolved only for visible cards. A comic card
        // that leaves the screen before its turn gives its place in the queue back (a fast
        // swipe past dozens of issues asks for none of them) and asks again when it returns.
        let pending: AbortController | null = null;
        const hydrate = (near = true): void => {
          if (!near) { if (pending && entry.contentType === "comic") { pending.abort(); pending = null; } return; }
          if (initial) { coverObserver?.unobserve(card); showRealCover(initial); return; }
          if (pending) return;
          const request = pending = new AbortController(), screen = coversOnScreen.signal;
          screen.addEventListener("abort", () => request.abort(), { once: true });
          void this.coverResolver.resolve(entry, request.signal).then(url => {
            if (request.signal.aborted) return;
            pending = null; coverObserver?.unobserve(card); if (url) showRealCover(url);
          }).catch(() => undefined);
        };
        if (coverObserver) { (card as HTMLElement & { __hydrate?: (near?: boolean) => void }).__hydrate = hydrate; coverObserver.observe(card); } else hydrate();
      }
      const info = this.createElement("div", "catalog-card__info"); info.append(this.createElement("strong", "catalog-card__title", title)); if (entry.author) info.append(this.createElement("span", "catalog-card__author", entry.author));
      const action = this.createElement("button", "catalog-card__quick-action") as HTMLButtonElement; action.type = "button"; action.title = book ? "Abrir livro" : "Baixar livro"; action.setAttribute("aria-label", action.title);
      const icon = new DownloadProgressIcon(action, Boolean(book));
      cards.set(entry.fileId, { action, icon }); const running = downloads.get(entry.fileId); if (running) paint({ action, icon }, running);
      const details = (): void => this.showDetails(entry, local(entry), {
        coverUrl: image.parentNode === cover && image.complete && image.naturalWidth > 0 ? image.currentSrc || image.src : undefined,
        downloaded: () => Boolean(local(entry) || finished.has(entry.fileId)),
        current: () => downloads.get(entry.fileId) ?? null,
        watch: listener => { const set = watchers.get(entry.fileId) ?? new Set(); set.add(listener); watchers.set(entry.fileId, set); return () => { set.delete(listener); if (!set.size) watchers.delete(entry.fileId); }; },
        download: () => void download(entry, action, icon),
        open: () => { const id = local(entry)?.id ?? finished.get(entry.fileId); if (id) this.open(id); },
      });
      cover.addEventListener("click", details); action.addEventListener("click", event => { event.stopPropagation(); const current = local(entry); void (current ? this.open(current.id) : download(entry, action, icon)); }); coverFrame.append(cover, action); card.append(coverFrame, info); return card;
    };
    const resetCovers = (): void => {
      coverObserver?.disconnect(); kept = new Map();
      // Covers still queued for the cards being replaced are not needed any more.
      coversOnScreen.abort(); coversOnScreen = new AbortController();
      coverObserver = typeof IntersectionObserver === "function" ? new IntersectionObserver(items => items.forEach(item => {
        (item.target as HTMLElement & { __hydrate?: (near?: boolean) => void }).__hydrate?.(item.isIntersecting);
      }), { rootMargin: "300px" }) : null;
    };
    // A comic source is read as one page: its folders as titled sections, each with its own
    // carousel. Kept across redraws so a sync page only completes it.
    const showShelf = (source: GoogleDriveLibrarySource): void => {
      if (comicShelf?.sourceId !== source.id) {
        comicShelf?.dispose(); grid.replaceChildren(); resetCovers();
        comicShelf = new DriveComicShelf(source.id, cardFor, () => more.classList.toggle("is-hidden", !comicShelf?.hasMore));
        grid.append(comicShelf.element);
      }
      const nodes = folderNodes.get(source.id) ?? [], root = driveRootOf(nodes, source.id) ?? { sourceId: source.id, folderId: source.folderId, parentFolderId: null, name: source.name, depth: 0 };
      const sections = driveSections(nodes, entries, source.id, { ...root, name: source.name });
      comicShelf.update(sections);
      more.classList.toggle("is-hidden", !comicShelf.hasMore);
      console.info(`[DriveRender] genre=${source.name} layout=shelf sections=${sections.length} mountedSections=${comicShelf.mountedSections} mountedCards=${comicShelf.mountedCards}`);
    };
    const drawGrid = (fromSync = false): void => {
      const shelfSource = mode === "comic" && selectedGenre && !fold(search.value) ? sourcesList.find(value => value.name === selectedGenre && value.contentType === "comic") : undefined;
      if (shelfSource) { openFolder = null; showShelf(shelfSource); return; }
      comicShelf?.dispose(); comicShelf = null;
      const query = fold(search.value), seen = new Set<string>(); const filtered = entries.filter(entry => { if (seen.has(entry.fileId)) return false; seen.add(entry.fileId); return mode !== "choice" && (entry.contentType ?? "book") === mode && (!selectedGenre || entry.genre === selectedGenre) && (!query || fold(`${entry.title ?? ""} ${entry.name} ${entry.author ?? ""}`).includes(query)); }); grid.replaceChildren();
      // A sync page only adds to what is on screen: its cards and their covers stay.
      if (!fromSync) resetCovers();
      // A selected source is one category: navigate its real Drive folders.
      const activeSource = selectedGenre && !query ? sourcesList.find(value => value.name === selectedGenre && (value.contentType ?? "book") === mode) : undefined;
      if (activeSource) {
        const nodes = folderNodes.get(activeSource.id) ?? [], rootId = driveRootOf(nodes, activeSource.id)?.folderId ?? activeSource.folderId;
        if (openFolder?.sourceId !== activeSource.id || !nodes.some(node => node.folderId === openFolder!.folderId)) openFolder = { sourceId: activeSource.id, folderId: rootId };
        const current = openFolder.folderId, trail = driveTrail(nodes, current), node = nodes.find(value => value.folderId === current);
        const nav = this.createElement("nav", "drive-folder-nav"); nav.setAttribute("aria-label", "Pastas");
        if (trail.length > 1) { const back = this.createElement("button", "drive-folder-nav__back", "← Voltar") as HTMLButtonElement; back.type = "button"; back.addEventListener("click", () => { openFolder = { sourceId: activeSource.id, folderId: trail[trail.length - 2]!.folderId }; visibleLimit = 60; drawGrid(); }); nav.append(back); }
        const crumbs = this.createElement("ol", "drive-folder-nav__path");
        (trail.length ? trail : [{ folderId: rootId, name: activeSource.name } as GoogleDriveFolderNode]).forEach((step, index, all) => {
          const item = this.createElement("li", "drive-folder-nav__crumb"), label = index === 0 ? activeSource.name : step.name;
          if (index === all.length - 1) { item.append(this.createElement("span", "", label)); item.setAttribute("aria-current", "page"); }
          else { const link = this.createElement("button", "drive-folder-nav__crumb-link", label) as HTMLButtonElement; link.type = "button"; link.addEventListener("click", () => { openFolder = { sourceId: activeSource.id, folderId: step.folderId }; visibleLimit = 60; drawGrid(); }); item.append(link); }
          crumbs.append(item);
        });
        nav.append(crumbs); grid.append(nav);
        const subfolders = driveChildFolders(nodes, current);
        if (subfolders.length) {
          const carousel = this.createElement("div", "drive-folder-carousel"); carousel.setAttribute("aria-label", "Subpastas");
          subfolders.forEach(folder => { const chip = this.createElement("button", "drive-folder-carousel__item", folder.error ? `${folder.name} ⚠` : folder.name) as HTMLButtonElement; chip.type = "button";
            if (folder.error) chip.title = "Sem acesso a esta pasta no Google Drive";
            chip.addEventListener("click", () => { openFolder = { sourceId: activeSource.id, folderId: folder.folderId }; visibleLimit = 60; drawGrid(); if (!folder.listed) status.textContent = `Carregando ${folder.name}…`; });
            carousel.append(chip); });
          grid.append(carousel);
        }
        const files = driveFilesIn(entries, activeSource.id, current, rootId).filter(entry => (entry.contentType ?? "book") === mode);
        const shelf = this.createElement("div", "drive-folder-files");
        files.slice(0, visibleLimit).forEach(entry => shelf.append(cardFor(entry)));
        if (files.length) grid.append(shelf);
        else grid.append(this.createElement("p", "catalog__status", node && !node.listed ? "Carregando esta pasta…" : subfolders.length ? "Escolha uma subpasta." : "Esta pasta não tem arquivos."));
        more.classList.toggle("is-hidden", files.length <= visibleLimit);
        console.info(`[DriveRender] genre=${activeSource.name} folder=${node?.name ?? activeSource.name} depth=${node?.depth ?? 0} subfolders=${subfolders.length} booksRendered=${Math.min(files.length, visibleLimit)}`);
        return;
      }
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
      [["", "Todos"], ...genres.map(name => [name, name] as const)].forEach(([value, label]) => { const chip = this.createElement("button", "catalog__genre-chip", label); chip.type = "button"; chip.setAttribute("aria-pressed", String(selectedGenre === value)); chip.addEventListener("click", () => { selectedGenre = value; openFolder = null; visibleLimit = 60; drawFilters(); drawGrid(); }); chips.append(chip); }); };
    const cache = async (): Promise<void> => {
      entries = await this.sources.entries(); sourcesList = await this.sources.all();
      for (const value of sourcesList) folderNodes.set(value.id, await this.sources.folders(value.id));
      drawFilters(); drawGrid();
    };
    const chooseInitialMode = async (): Promise<void> => {
      const savedSources = await this.sources.all(), hasBooks = savedSources.some(source => (source.contentType ?? "book") === "book"), hasComics = savedSources.some(source => source.contentType === "comic");
      applyMode(hasBooks && !hasComics ? "book" : hasComics && !hasBooks ? "comic" : "choice");
    };
    const sync = async (source: GoogleDriveLibrarySource): Promise<boolean> => {
      this.controller?.abort(); const controller = this.controller = new AbortController(); lastSource = source; retry.classList.add("is-hidden"); status.textContent = "Sincronizando biblioteca…";
      try { const existing = await this.sources.entries(source.id), resume = await this.sources.syncState(source.id); const listed = await this.service.listProgressively(source, existing, resume, controller.signal, async (batch, state, value, folders) => {
          if (folders.length) folderNodes.set(source.id, await this.sources.appendFolders(source.id, folders));
          if (batch.length) { const saved = await this.sources.appendEntries(source.id, batch); entries = [...entries.filter(entry => entry.sourceId !== source.id), ...saved]; }
          if (batch.length || folders.length) {
            if (!sourcesList.some(value => value.id === source.id)) sourcesList = await this.sources.all();
            // Inside one of this source's folders only that folder's pages change the screen;
            // redrawing for the rest of the walk would recreate every card while its cover loads.
            const open = openFolder?.sourceId === source.id ? openFolder.folderId : null;
            if (!open || batch.some(entry => entry.parentFolderId === open) || folders.some(node => node.folderId === open || node.parentFolderId === open)) { drawFilters(); drawGrid(true); }
          }
          await this.sources.saveSyncState(source.id, state);
          status.textContent = state.completed ? (value.files > 0 ? `${value.files} livro(s) sincronizado(s).` : "A pasta está vazia ou não possui PDF, EPUB, CBR ou CBZ.") : `Sincronizando: ${value.files} livro(s) encontrados…`;
          if (state.completed) {
            const byGenre = new Map<string, number>(); entries.filter(entry => entry.sourceId === source.id).forEach(entry => byGenre.set(entry.genre, (byGenre.get(entry.genre) ?? 0) + 1));
            byGenre.forEach((count, genre) => console.info(`[DriveRender] genre=${genre} booksRendered=${count}`));
          }
        }, { priority: () => comicShelf?.sourceId === source.id ? driveFirstUnlisted(folderNodes.get(source.id) ?? [], source.folderId) : openFolder?.sourceId === source.id ? openFolder.folderId : null });
        // A source saved as "Link N" takes the folder's real name as soon as it is known.
        if (/^Link\s+\d+$/i.test(source.name) && listed.folderName) { const renamed = await this.sources.rename(source.id, listed.folderName).catch(() => null); if (renamed) { lastSource = renamed; await cache(); } }
        return true;
      } catch (error) { if (controller.signal.aborted) return false; console.warn(JSON.stringify({ event: "PERSONAL_DRIVE_SYNC_FAILED", sourceId: source.id, reason: error instanceof Error ? error.name : "unknown", detail: safeErrorDetail(error) })); status.textContent = message(error); retry.classList.remove("is-hidden"); return false;
      } finally { if (this.controller === controller) this.controller = null; }
    };
    /* The icon follows the bytes really received; success is shown only after the file is
     * saved locally, and only then the book opens in the reader that fits it. */
    const download = async (entry: GoogleDriveLibraryEntry, button: HTMLButtonElement, icon: DownloadProgressIcon): Promise<void> => {
      // One download per file, whether it was asked for on the card or on its details page.
      if (button.disabled || downloads.has(entry.fileId)) return;
      const controller = new AbortController(); button.disabled = true; button.setAttribute("aria-busy", "true"); icon.set("downloading", 0); report(entry.fileId, { state: "downloading", percent: 0 }); status.textContent = `Baixando ${stripExtension(entry.name)}…`;
      try { const contentType = entry.contentType === "comic" ? "comic" : "book"; const book = await this.importer.importListedFile({ id: entry.fileId, name: entry.name, mimeType: entry.mimeType, size: entry.size, modifiedTime: entry.modifiedTime, resourceKey: entry.resourceKey }, entry.genre, controller.signal, contentType, (done, _total, _name, percent) => { if (done > 0) return; icon.progress(percent ?? null); report(entry.fileId, percent == null ? { state: "indeterminate", percent: null } : { state: "downloading", percent }); if (percent === 100) { icon.set("saving", 100); report(entry.fileId, { state: "saving", percent: 100 }); } });
        icon.set("done", 100); finished.set(entry.fileId, book.id); await this.refreshGenres(); this.saved(book); report(entry.fileId, { state: "done", percent: 100 }); status.textContent = `${entry.name} está disponível offline.`;
        // With its details page open, the page's button turns into Abrir instead.
        if (watchers.get(entry.fileId)?.size) return;
        await new Promise<void>(resolve => window.setTimeout(resolve, 420)); this.open(book.id);
      } catch (error) { button.disabled = false; button.removeAttribute("aria-busy"); icon.set("error", 0); report(entry.fileId, { state: "error", percent: 0, message: message(error, true) }); status.textContent = message(error, true); }
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
      const form = this.createElement("form", "personal-drive-library__link-form"), linkField = this.createElement("label", "personal-drive-library__link-field"), input = this.createElement("input", "") as HTMLInputElement, submit = this.createElement("button", "personal-drive-library__link-submit", "OK"); input.required = true;
      // Step 2, after the folder was read: its name (editable) and a local routing choice.
      const confirm = this.createElement("div", "personal-drive-library__confirm"); confirm.hidden = true;
      const nameInput = this.createElement("input", "input personal-drive-library__manual-name") as HTMLInputElement; nameInput.type = "text"; nameInput.maxLength = 100;
      nameInput.placeholder = "Nome da fonte"; nameInput.setAttribute("aria-label", "Nome da fonte");
      const typeRow = this.createElement("div", "personal-drive-library__type-choice"); typeRow.setAttribute("role", "radiogroup"); typeRow.setAttribute("aria-label", "Tipo da fonte");
      const bookType = this.createElement("button", "personal-drive-library__type", "Livros") as HTMLButtonElement, comicType = this.createElement("button", "personal-drive-library__type", "HQs") as HTMLButtonElement, audioType = this.createElement("button", "personal-drive-library__type", "Audiolivros") as HTMLButtonElement;
      const addButton = this.createElement("button", "button button--primary personal-drive-library__add", "Adicionar") as HTMLButtonElement; addButton.type = "button";
      let chosen: GoogleDriveLibrarySource["contentType"] | null = null, pending: { link: string; driveName: string } | null = null;
      const updateConfirm = (): void => { bookType.setAttribute("aria-checked", String(chosen === "book")); comicType.setAttribute("aria-checked", String(chosen === "comic")); audioType.setAttribute("aria-checked", String(chosen === "audiobook")); addButton.disabled = !chosen || !nameInput.value.trim(); };
      ([[bookType, "book"], [comicType, "comic"], [audioType, "audiobook"]] as const).forEach(([button, value]) => { button.type = "button"; button.setAttribute("role", "radio"); button.addEventListener("click", () => { chosen = value; updateConfirm(); }); typeRow.append(button); });
      nameInput.addEventListener("input", updateConfirm); confirm.append(nameInput, typeRow, addButton); updateConfirm(); input.type = "url"; input.placeholder = "Cole o link do Google Drive aqui…"; input.setAttribute("aria-label", input.placeholder); const linkIcon = icon("link"); linkIcon.classList.add("personal-drive-library__link-icon"); linkField.append(linkIcon, input); submit.type = "submit"; form.append(linkField, submit);
      const note = this.createElement("p", "catalog__status"), list = this.createElement("div", "personal-drive-library__source-list"), close = this.createElement("button", "personal-drive-library__close", "← Fechar"); close.type = "button"; close.addEventListener("click", () => dialog.close());
      const reclassify = async (source: GoogleDriveLibrarySource): Promise<void> => { if (source.contentType === "audiobook") return; const sourceEntries = await this.sources.entries(source.id), changed = await this.importer.reclassifyListedFiles(sourceEntries.map(entry => entry.fileId), source.contentType ?? "book"); changed.forEach(book => this.reclassified(book)); };
      const renderSources = async (): Promise<void> => { const rows = await this.sources.all(); list.replaceChildren(); rows.forEach((source, index) => { const labelText = source.name || `Link ${index + 1}`, row = this.createElement("div", "personal-drive-library__source"), folder = this.createElement("span", "personal-drive-library__source-folder"), label = this.createElement("button", "personal-drive-library__source-name", labelText) as HTMLButtonElement, type = this.createElement("button", "personal-drive-library__type") as HTMLButtonElement; folder.append(icon("folder")); type.type = "button"; label.type = "button";
        label.title = source.driveName && source.driveName !== source.name ? `Pasta no Drive: ${source.driveName}. Toque para renomear.` : "Toque para renomear";
        label.addEventListener("click", () => void (async () => { const next = window.prompt("Nome desta fonte", source.name)?.trim(); if (!next || next === source.name) return;
          const renamed = await this.sources.rename(source.id, next).catch(error => { note.textContent = message(error); return null; }); if (!renamed) return; if (selectedGenre === source.name) selectedGenre = renamed.name;
          await cache(); await renderSources(); note.textContent = `Fonte renomeada para ${renamed.name}.`; })()); const typeLabel = (value: GoogleDriveLibrarySource["contentType"]) => value === "comic" ? "HQs e Mangás" : value === "audiobook" ? "Audiolivros" : "Livros"; const updateType = async (): Promise<void> => { const types: GoogleDriveLibrarySource["contentType"][] = ["book", "comic", "audiobook"], current = source.contentType ?? "book", next = types[(types.indexOf(current) + 1) % types.length]!, updated = await this.sources.updateContentType(source.id, next); if (!updated) return; source = updated; entries = entries.map(entry => entry.sourceId === updated.id ? { ...entry, contentType: updated.contentType } : entry); await reclassify(updated); await cache(); drawFilters(); drawGrid(); note.textContent = `${updated.name} foi classificado como ${typeLabel(updated.contentType)}. Sincronizando metadados…`; updateTypeButton(); void sync(updated); }; const updateTypeButton = (): void => { const value = source.contentType ?? "book", comic = value === "comic"; type.replaceChildren(icon(comic ? "comic" : "book"), document.createTextNode(typeLabel(value))); type.setAttribute("aria-label", `Alterar ${labelText}: ${typeLabel(value)}`); }; updateTypeButton(); type.addEventListener("click", () => void updateType()); const remove = this.createElement("button", "personal-drive-library__delete"); remove.type = "button"; remove.setAttribute("aria-label", `Remover ${labelText}`); remove.title = "Remover link"; remove.append(icon("trash")); remove.addEventListener("click", () => void (async () => { if (!window.confirm(`Remover ${labelText}? Ela poderá ser restaurada depois, e os livros baixados não serão apagados.`)) return; await this.sources.remove(source.id, "lixeira"); entries = entries.filter(entry => entry.sourceId !== source.id); sourcesList = sourcesList.filter(value => value.id !== source.id); drawFilters(); drawGrid(); await renderSources(); })()); row.append(folder, label, type, remove); list.append(row); });
        // Removed sources keep their data and can come back as they were.
        const removedRows = await this.sources.removed().catch(() => []);
        if (removedRows.length) {
          list.append(this.createElement("p", "personal-drive-library__removed-title", "Removidas"));
          removedRows.forEach(({ source: gone }) => {
            const row = this.createElement("div", "personal-drive-library__source personal-drive-library__source--removed"), folder = this.createElement("span", "personal-drive-library__source-folder"), name = this.createElement("span", "personal-drive-library__source-name", gone.name), restore = this.createElement("button", "personal-drive-library__type", "Restaurar") as HTMLButtonElement;
            folder.append(icon("folder")); restore.type = "button"; restore.setAttribute("aria-label", `Restaurar ${gone.name}`);
            restore.addEventListener("click", () => void (async () => { restore.disabled = true; const back = await this.sources.restore(gone.id, "modal").catch(error => { note.textContent = message(error); return null; }); if (!back) { restore.disabled = false; return; } await cache(); await renderSources(); note.textContent = `${back.name} foi restaurada.`; })());
            row.append(folder, name, restore); list.append(row);
          });
        }
      };
      form.addEventListener("submit", event => void (async () => { event.preventDefault(); submit.disabled = true; try {
        GoogleDriveLibraryRepository.parse(input.value);
        // The real folder name is read before anything is saved; the person can then rename it
        // and must say whether the folder is Livros or HQs.
        note.textContent = "Lendo pasta…"; chosen = null; pending = { link: input.value, driveName: "" };
        try {
          const folderName = await this.service.folderName(input.value, new AbortController().signal);
          pending.driveName = folderName; nameInput.value = folderName;
          note.textContent = `Pasta encontrada: ${folderName}. Escolha Livros, HQs ou Audiolivros.`;
        } catch (error) {
          console.warn(JSON.stringify({ event: "PERSONAL_DRIVE_DESCRIBE_FAILED", reason: error instanceof Error ? error.message : "unknown" }));
          nameInput.value = ""; note.textContent = "Não foi possível identificar a pasta. Digite um nome e escolha o tipo.";
        }
        confirm.hidden = false; updateConfirm(); nameInput.focus();
      } catch (error) { note.textContent = message(error); } finally { submit.disabled = false; } })());
      addButton.addEventListener("click", () => void (async () => { if (!pending || !chosen || !nameInput.value.trim()) return; addButton.disabled = true; try {
        const result = await this.sources.saveLink(pending.link, chosen, nameInput.value.trim(), pending.driveName || undefined);
        input.value = ""; confirm.hidden = true; pending = null; if (result.source.contentType !== "audiobook") await reclassify(result.source);
        entries = entries.map(entry => entry.sourceId === result.source.id ? { ...entry, contentType: result.source.contentType, genre: result.source.name } : entry);
        await renderSources(); await cache(); await chooseInitialMode(); dialog.close(); void sync(result.source);
      } catch (error) { note.textContent = message(error); updateConfirm(); } })());
      panel.append(form, note, confirm, list, close); dialog.append(panel); dialog.addEventListener("close", () => dialog.remove(), { once: true }); document.body.append(dialog); void renderSources(); dialog.showModal();
    };
    bookChoice.addEventListener("click", () => applyMode("book")); comicChoice.addEventListener("click", () => applyMode("comic")); backToChoice.addEventListener("click", () => applyMode("choice"));
    retry.addEventListener("click", () => { if (lastSource) void sync(lastSource); }); search.addEventListener("input", () => { visibleLimit = 60; drawGrid(); }); more.addEventListener("click", () => { if (comicShelf) { comicShelf.showMore(); return; } visibleLimit += 60; drawGrid(); }); applyMode("choice"); void (async () => { await cache(); const savedSources = await this.sources.all(); await chooseInitialMode();
      // The link modal first: syncs below can take minutes, and one manager open at a time.
      if (this.openLinkModal && section.isConnected && !document.querySelector("dialog[open] .personal-drive-library__manager")) openManager();
      for (const source of savedSources) {
        const state = await this.sources.syncState(source.id), cached = await this.sources.entries(source.id);
        // Book catalogs read with older rules are read once again (comics are not catalogs).
        const olderCatalogRules = (source.contentType ?? "book") === "book" && Boolean(state) && (state!.catalogRules ?? 0) < PERSONAL_DRIVE_CATALOG_RULES;
        if ((state && !state.completed) || (!state && cached.length === 0) || (state && state.version !== PERSONAL_DRIVE_SYNC_VERSION) || olderCatalogRules) await sync(source);
      } })(); return section;
  }
  /** The same page for every book and comic: only what the metadata really has is shown. */
  private showDetails(entry: GoogleDriveLibraryEntry, book: Book | undefined, card: { coverUrl?: string } & Pick<DriveItemDetailsInput, "downloaded" | "current" | "watch" | "download" | "open">): void {
    const comic = entry.contentType === "comic", title = cleanText(entry.title) ?? book?.title ?? stripExtension(entry.name);
    const collection = (entry.collectionPath ?? []).map(name => name.trim()).filter(Boolean).join(" › ");
    const author = cleanText(entry.author) ?? (book?.author && book.author !== "Autor desconhecido" ? cleanText(book.author) : undefined);
    const facts: Array<readonly [string, string]> = [];
    if (book?.publicationYear) facts.push(["Ano", String(book.publicationYear)]);
    if (cleanText(book?.volume)) facts.push(["Edição", book!.volume!.trim()]);
    if (cleanText(book?.series) && book!.series!.trim() !== collection) facts.push(["Série", book!.series!.trim()]);
    facts.push(["Formato", extension(entry.name).toUpperCase() || "Arquivo"]);
    const bytes = Number(entry.size ?? book?.fileSize ?? 0);
    if (bytes > 0) facts.push(["Tamanho", `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`]);
    this.details.show({
      kind: comic ? "comic" : "book", title, author, facts,
      eyebrow: comic ? collection || cleanText(entry.genre) : cleanText(entry.genre),
      synopsis: cleanText(entry.synopsis) ?? cleanText(book?.summary) ?? cleanText(book?.description),
      coverUrl: card.coverUrl ?? (book?.cover || this.coverResolver.peek(entry) || undefined),
      placeholder: () => createLumeoCoverPlaceholder(title),
      resolveCover: signal => this.coverResolver.resolve(entry, signal),
      downloaded: card.downloaded, current: card.current, watch: card.watch, download: card.download, open: card.open,
    });
  }
}
function version(entry: GoogleDriveLibraryEntry): string { return entry.modifiedTime ?? `${entry.name}:${entry.size ?? ""}`; }
function fold(value: string): string { return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim(); }
function stripExtension(value: string): string { return value.replace(/\.(pdf|epub|cbr|cbz)$/i, ""); }
function extension(value: string): string { return value.match(/\.([a-z0-9]+)$/i)?.[1] ?? ""; }
function message(error: unknown, download = false): string {
  if (error instanceof GoogleDriveAccessError) return ({
    DRIVE_ACCOUNT_NOT_AUTHORIZED: "Autorize sua conta Google para acessar esta pasta privada.",
    DRIVE_FOLDER_FORBIDDEN: "Você não tem permissão para esta pasta.",
    DRIVE_ITEM_NOT_FOUND: "A pasta não foi encontrada. Confira o link.",
    DRIVE_CONNECTION_FAILED: "Falha de conexão com o Google Drive.",
    DRIVE_PUBLIC_KEY_REJECTED: "A chave do Drive público não foi aceita neste aplicativo. Confira as restrições Android.",
    DRIVE_RATE_LIMITED: "O Google Drive limitou temporariamente as solicitações. Tente novamente em alguns minutos.",
    DRIVE_DOWNLOAD_REQUIRES_AUTH: "O Google Drive exige autorização para baixar este arquivo.",
  })[error.code];
  if (error instanceof DOMException && error.name === "AbortError") return "Sincronização cancelada.";
  if (error instanceof Error && error.message === "DRIVE_LINK_NOT_FOLDER") return "Cole o link de uma pasta do Google Drive.";
  if (error instanceof Error && error.message === "DRIVE_SOURCE_NAME_TAKEN") return "Já existe uma fonte com este nome. Escolha outro nome.";
  if (error instanceof Error && error.message === "DRIVE_SOURCE_LIST_SHRINK") return "A lista de fontes mudou enquanto era salva. Nada foi apagado; tente de novo.";
  if (error instanceof Error && /invalidLink|link/i.test(error.message)) return "Link inválido.";
  return download ? "Download bloqueado ou falha de conexão." : "Não foi possível sincronizar a pasta. Tente novamente.";
}
function safeErrorDetail(error: unknown): string | null { return error instanceof Error ? error.message.replace(/Bearer\s+[^\s]+|ya29\.[\w.-]+/g, "[redacted]").slice(0, 160) : null; }
function cleanText(value: unknown): string | undefined { return typeof value === "string" && value.trim() && value !== "undefined" && value !== "null" && value !== "[object Object]" ? value.trim() : undefined; }
