import { bindCoverBackdrop } from "../components/CoverBackdrop";
import { AudiobookPlayer, type AudiobookPlayerState } from "../audiobooks/AudiobookPlayer";
import { collectionsFromDrive, type AudiobookChapter, type AudiobookCollection, type AudiobookSourceState } from "../audiobooks/AudiobookLibrary";
import { GoogleDriveLibraryRepository } from "../external/GoogleDriveLibraryRepository";
import { PERSONAL_DRIVE_SYNC_VERSION, PersonalDriveLibraryService } from "../services/PersonalDriveLibraryService";
import { BaseView } from "./BaseView";

interface AudiobooksDependencies { sources: GoogleDriveLibraryRepository; service: PersonalDriveLibraryService; player: AudiobookPlayer; onAdd: () => void; }

/** One audio engine stays alive while this view swaps between shelf, miniplayer and full player. */
export class AudiobooksView extends BaseView {
  public constructor(private readonly dependencies: AudiobooksDependencies, private readonly onBack: () => void) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "page-shell audiobooks-view");
    const back = this.createElement("button", "link-button", this.t("ui.common.back")); back.type = "button"; back.addEventListener("click", this.onBack);
    const status = this.createElement("p", "audiobooks-shelf__status", "Carregando audiolivros…"), shelf = this.createElement("div", "audiobooks-shelf");
    const main = this.createMainPlayer(), mini = this.createMiniPlayer(), full = this.createFullPlayer(); let collections: AudiobookCollection[] = [], active: AudiobookChapter | null = null, playerHistoryOpen = false, visualChapterId = "", chapterListId = "", selectedCollectionId = "";
    const finishClose = (): void => { full.root.classList.remove("is-open"); window.setTimeout(() => { if (!full.root.classList.contains("is-open")) full.root.hidden = true; }, 280); };
    const closeFull = (fromHistory = false): void => {
      if (!full.root.classList.contains("is-open")) return;
      if (!fromHistory && playerHistoryOpen) { window.history.back(); return; }
      playerHistoryOpen = false; finishClose();
    };
    const onPopState = (): void => closeFull(true);
    const openFull = (): void => {
      if (!active || full.root.classList.contains("is-open")) return;
      try { window.history.pushState(window.history.state, "", window.location.href); playerHistoryOpen = true; } catch { playerHistoryOpen = false; }
      full.root.hidden = false; requestAnimationFrame(() => full.root.classList.add("is-open"));
    };
    mini.root.addEventListener("click", openFull); full.close.addEventListener("click", () => closeFull()); full.backdrop.addEventListener("click", () => closeFull()); window.addEventListener("popstate", onPopState);
    const previous = (): void => { void this.dependencies.player.previous().catch(() => undefined); }, next = (): void => { void this.dependencies.player.next().catch(() => undefined); };
    full.previous.addEventListener("click", previous); full.next.addEventListener("click", next); main.previous.addEventListener("click", previous); main.next.addEventListener("click", next);
    const rewind = (): void => this.dependencies.player.seekBy(-15), forward = (): void => this.dependencies.player.seekBy(15), seekMain = (): void => this.dependencies.player.seek(Number(main.timeline.value));
    full.rewind.addEventListener("click", rewind); full.forward.addEventListener("click", forward); main.rewind.addEventListener("click", rewind); main.forward.addEventListener("click", forward);
    full.speed.addEventListener("change", () => this.dependencies.player.setSpeed(Number(full.speed.value))); main.speed.addEventListener("change", () => this.dependencies.player.setSpeed(Number(main.speed.value))); full.timeline.addEventListener("input", () => this.dependencies.player.seek(Number(full.timeline.value))); main.timeline.addEventListener("input", seekMain);
    const changePlayback = (): void => { if (active) void this.dependencies.player.toggle(active, this.collectionFor(active, collections)?.chapters).catch(() => undefined); };
    mini.toggle.addEventListener("click", event => { event.stopPropagation(); changePlayback(); }); full.toggle.addEventListener("click", changePlayback); main.toggle.addEventListener("click", changePlayback); main.visual.addEventListener("click", openFull);
    const toggleList = (): void => { full.chapterList.hidden = !full.chapterList.hidden; full.listButton.setAttribute("aria-expanded", String(!full.chapterList.hidden)); };
    full.listButton.addEventListener("click", toggleList);
    const renderState = (state: AudiobookPlayerState): void => {
      mini.root.hidden = !state.chapter; if (!state.chapter) { main.toggle.disabled = true; main.previous.disabled = true; main.next.disabled = true; return; } active = state.chapter; const collection = this.collectionFor(active, collections), subtitle = active.volume || collection?.title || active.collection;
      if (visualChapterId !== active.id) { visualChapterId = active.id; mini.cover.replaceChildren(this.cover(active)); main.visual.replaceChildren(this.turntable(active)); full.cover.replaceChildren(this.turntable(active)); main.visual.classList.add("has-track"); full.cover.classList.add("has-track"); }
      mini.title.textContent = active.title; mini.collection.textContent = subtitle; mini.progress.style.setProperty("--audiobook-progress", String(progressRatio(state))); mini.root.classList.toggle("is-playing", state.playing); mini.toggle.disabled = state.downloading; mini.toggle.textContent = state.downloading ? "…" : state.playing ? "❚❚" : "▶";
      main.title.textContent = active.title; main.collection.textContent = subtitle; main.toggle.disabled = state.downloading; main.toggle.textContent = state.downloading ? "…" : state.cueing ? "■" : state.playing ? "❚❚" : "▶"; main.previous.disabled = state.queueIndex <= 0 && state.position <= 3; main.next.disabled = state.queueIndex < 0 || state.queueIndex >= state.queueLength - 1; main.rewind.disabled = state.duration <= 0; main.forward.disabled = state.duration <= 0; main.timeline.disabled = state.duration <= 0; main.timeline.max = String(Math.max(1, state.duration)); main.timeline.value = String(Math.min(state.position, state.duration || 0)); main.elapsed.textContent = clock(state.position); main.total.textContent = clock(state.duration); main.speed.value = String(state.speed); main.visual.classList.toggle("is-playing", state.playing); main.visual.classList.toggle("is-cueing", state.cueing); main.visual.classList.toggle("is-downloading", state.downloading); main.status.textContent = state.downloading ? `Aguarde o download… ${percent(state.progress)}%` : state.cueing ? "Posicionando a agulha…" : state.playing ? "Reproduzindo" : "Pronto para reproduzir";
      full.title.textContent = active.title; full.collection.textContent = subtitle; full.timeline.max = String(Math.max(1, state.duration)); full.timeline.value = String(Math.min(state.position, state.duration || 0)); full.elapsed.textContent = clock(state.position); full.total.textContent = clock(state.duration); full.toggle.disabled = state.downloading; full.toggle.textContent = state.downloading ? `${state.progress ?? 0}%` : state.cueing ? "■" : state.playing ? "❚❚" : "▶"; full.previous.disabled = state.queueIndex <= 0 && state.position <= 3; full.next.disabled = state.queueIndex < 0 || state.queueIndex >= state.queueLength - 1; full.speed.value = String(state.speed); full.root.classList.toggle("is-downloading", state.downloading);
      full.cover.classList.toggle("is-playing", state.playing); full.cover.classList.toggle("is-cueing", state.cueing); full.cover.classList.toggle("is-downloading", state.downloading); full.download.hidden = !state.downloading && !state.cueing; full.download.textContent = state.downloading ? `Aguarde o download… ${percent(state.progress)}%` : state.cueing ? "Posicionando a agulha…" : "";
      if (chapterListId !== `${collection?.id ?? ""}:${active.id}`) { chapterListId = `${collection?.id ?? ""}:${active.id}`; this.renderChapterList(full.chapterList, collection, active, chapter => { void this.dependencies.player.play(chapter, collection?.chapters).catch(() => undefined); }); }
      if (state.error) status.textContent = state.error;
    };
    const unsubscribe = this.dependencies.player.subscribe(renderState);
    // Each Audiolivros source is listed on its own, and its LP shows where that listing stands.
    const syncing = new Set<string>(), relisted = new Set<string>(), sourceStates = new Map<string, AudiobookSourceState>();
    const sync = async (sourceId: string): Promise<void> => {
      if (syncing.has(sourceId)) return;
      const source = (await this.dependencies.sources.all()).find(value => value.id === sourceId && value.contentType === "audiobook"); if (!source) return;
      syncing.add(sourceId); sourceStates.set(sourceId, { status: "syncing" }); requestDraw();
      try {
        const cached = await this.dependencies.sources.entries(source.id), resume = await this.dependencies.sources.syncState(source.id);
        await this.dependencies.service.listProgressively(source, cached, resume, new AbortController().signal, async (batch, state, _progress, folders) => {
          // A source retyped or removed meanwhile keeps nothing from this listing.
          const current = (await this.dependencies.sources.all()).find(value => value.id === source.id);
          if (current?.contentType !== "audiobook") return;
          if (folders.length) await this.dependencies.sources.appendFolders(source.id, folders);
          if (batch.length) await this.dependencies.sources.appendEntries(source.id, batch);
          await this.dependencies.sources.saveSyncState(source.id, state); requestDraw();
        });
        sourceStates.delete(sourceId);
      } catch (error) { sourceStates.set(sourceId, { status: "error", message: error instanceof Error && error.message ? error.message : "Não foi possível ler esta pasta do Google Drive." }); }
      finally { syncing.delete(sourceId); requestDraw(); }
    };
    // Redraws asked for while one is running collapse into one more.
    let drawing: Promise<void> | null = null, drawAgain = false;
    const requestDraw = (): void => { if (drawing) { drawAgain = true; return; } drawing = draw().catch(error => { status.textContent = error instanceof Error ? error.message : "Não foi possível abrir a biblioteca de audiolivros."; }).finally(() => { drawing = null; if (drawAgain) { drawAgain = false; requestDraw(); } }); };
    // Built once: the LPs below are kept and only updated, so a disc that slides out or back is
    // the same element and its transition runs to the end.
    const query = this.createElement("input", "input audiobooks-shelf__search") as HTMLInputElement; query.type = "search"; query.placeholder = "Pesquisar audiolivros"; query.setAttribute("aria-label", query.placeholder);
    const carousel = this.createElement("div", "audiobook-collections-carousel"), list = this.createElement("div", "audiobooks-collections"), cards = new Map<string, { item: HTMLButtonElement; art: HTMLElement; artKey: string; title: HTMLElement; count: HTMLElement }>();
    const cardFor = (collection: AudiobookCollection) => {
      const known = cards.get(collection.id); if (known) return known;
      const item = this.createElement("button", "audiobook-collection-card") as HTMLButtonElement; item.type = "button"; item.dataset.collectionId = collection.id;
      const art = this.collectionArt(collection), title = this.createElement("strong", "audiobook-collection-card__title"), count = this.createElement("small", "audiobook-collection-card__count");
      item.append(art, title, count);
      let dragged = false, origin = 0;
      item.addEventListener("pointerdown", event => { origin = event.clientX; dragged = false; }); item.addEventListener("pointermove", event => { if (Math.abs(event.clientX - origin) > 8) dragged = true; });
      // First touch opens the LP, the second closes it.
      item.addEventListener("click", event => { if (dragged) { event.preventDefault(); return; } const closing = selectedCollectionId === collection.id; selectedCollectionId = closing ? "" : collection.id; display(closing ? "close" : "open"); });
      const card = { item, art, artKey: collectionArtKey(collection), title, count }; cards.set(collection.id, card); return card;
    };
    // The chapter list lives in a shell that opens and closes (height and fade) under the
    // carousel. Its content is rebuilt only when the open collection, the search or the
    // chapters change - a sync page or a second render does not restart the animation.
    const listInner = this.createElement("div", "audiobooks-collections__inner"); list.append(listInner);
    let listKey = "", closeTimer = 0;
    const openList = (): void => {
      window.clearTimeout(closeTimer);
      if (list.classList.contains("is-open")) return;
      list.removeAttribute("inert"); list.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => list.classList.add("is-open"));
    };
    const closeList = (): void => {
      if (!list.classList.contains("is-open")) { if (!listKey) listInner.replaceChildren(); return; }
      list.classList.remove("is-open"); list.setAttribute("inert", ""); list.setAttribute("aria-hidden", "true");
      // Emptied once the collapse is over, so nothing invisible is left to take a touch.
      closeTimer = window.setTimeout(() => { if (!list.classList.contains("is-open")) { listInner.replaceChildren(); listKey = ""; } }, 560);
    };
    list.setAttribute("inert", ""); list.setAttribute("aria-hidden", "true");
    const display = (intent?: "open" | "close"): void => {
      const term = fold(query.value);
      const available = collections.filter(collection => !term || fold(collection.title).includes(term) || collection.chapters.some(chapter => fold(`${chapter.title} ${chapter.volume ?? ""}`).includes(term)));
      if (!available.some(value => value.id === selectedCollectionId)) selectedCollectionId = "";
      available.forEach((collection, index) => {
        const card = cardFor(collection), expanded = collection.id === selectedCollectionId;
        if (card.artKey !== collectionArtKey(collection)) { const art = this.collectionArt(collection); card.art.replaceWith(art); card.art = art; card.artKey = collectionArtKey(collection); }
        card.title.textContent = collection.title; card.count.textContent = collectionSummary(collection); card.item.dataset.status = collection.status ?? "ready";
        card.item.classList.toggle("is-expanded", expanded); card.item.setAttribute("aria-expanded", String(expanded));
        // Moved only when its place changed: re-inserting an element would cut its transition.
        if (carousel.children[index] !== card.item) carousel.insertBefore(card.item, carousel.children[index] ?? null);
      });
      for (const [id, card] of cards) if (!available.some(value => value.id === id)) { card.item.remove(); cards.delete(id); }
      const collection = collections.find(value => value.id === selectedCollectionId);
      if (!collection) {
        // Closing by a tap brings the carousel back into view while the list folds away, so
        // the page does not jump when the content above the fold gets shorter.
        if (intent === "close" && carousel.getBoundingClientRect().top < 72) window.scrollBy({ top: carousel.getBoundingClientRect().top - 96, behavior: "smooth" });
        closeList(); status.textContent = available.length ? "Toque em uma coleção para ver os capítulos." : "Nenhum audiolivro encontrado."; return;
      }
      const chapters = collection.chapters.filter(chapter => !term || fold(`${collection.title} ${chapter.title} ${chapter.volume ?? ""}`).includes(term));
      const key = `${collection.id}\u0000${term}\u0000${chapters.length}\u0000${collection.status ?? ""}`;
      if (key !== listKey) {
        listKey = key;
        const panel = this.createElement("section", "audiobook-collection"), heading = this.createElement("h2", "audiobook-collection__title", collection.title);
        if (!collection.chapters.length) panel.append(heading, this.createElement("p", "audiobook-collection__notice", collectionNotice(collection)));
        else {
          const items = this.createElement("ol", "audiobook-collection__chapters");
          // About a screen of rows opens with the list, one after another, so the opening is
          // seen at its real pace; the rest of a long collection follows once it is open, a
          // few dozen per frame, without animating rows that are still below the fold.
          const row = (index: number) => { const value = this.chapter(chapters[index]!, index + 1, collection.chapters); value.style.setProperty("--i", String(Math.min(index, 12))); return value; };
          const first = Math.min(chapters.length, 24);
          for (let index = 0; index < first; index++) items.append(row(index));
          panel.append(heading, items);
          let next = first;
          const more = (): void => {
            if (listKey !== key || !items.isConnected) return;
            const end = Math.min(chapters.length, next + 40), batch = document.createDocumentFragment();
            for (; next < end; next++) { const value = row(next); value.classList.add("audiobook-chapter--later"); batch.append(value); }
            items.append(batch); if (next < chapters.length) requestAnimationFrame(more);
          };
          if (next < chapters.length) window.setTimeout(() => requestAnimationFrame(more), 600);
        }
        listInner.replaceChildren(panel);
      }
      openList();
      // Opened by a tap: the title and the first chapters come into view, gently.
      if (intent === "open") window.setTimeout(() => { const top = list.getBoundingClientRect().top, room = window.innerHeight; if (top > room * .62) window.scrollBy({ top: top - room * .38, behavior: "smooth" }); }, 120);
      if (!collection.chapters.length) { status.textContent = ""; return; }
      status.textContent = collection.status === "syncing" ? `${chapters.length} capítulo${chapters.length === 1 ? "" : "s"} até agora. Lendo o restante da pasta…` : `${chapters.length} capítulo${chapters.length === 1 ? "" : "s"} nesta coleção.`;
    };
    query.addEventListener("input", () => display());
    const draw = async (): Promise<void> => {
      const sources = await this.dependencies.sources.all(), entries = await this.dependencies.sources.entries(); collections = collectionsFromDrive(sources, entries, sourceStates);
      for (const source of sources.filter(value => value.contentType === "audiobook")) {
        const syncState = await this.dependencies.sources.syncState(source.id), cached = entries.filter(entry => entry.sourceId === source.id && entry.contentType === "audiobook");
        // A folder that was listed empty is read once more each time this screen opens: its
        // audio may have been added since, or the listing may have run under another type.
        const emptyBefore = Boolean(syncState?.completed) && cached.length === 0 && !relisted.has(source.id);
        if ((syncState && !syncState.completed) || (!syncState && cached.length === 0) || syncState?.version !== PERSONAL_DRIVE_SYNC_VERSION || emptyBefore) { if (emptyBefore) relisted.add(source.id); void sync(source.id); }
      }
      if (!collections.length) { cards.clear(); carousel.replaceChildren(); shelf.replaceChildren(this.empty()); status.textContent = ""; return; }
      if (query.parentElement !== shelf) shelf.replaceChildren(query, carousel, list);
      display();
    };
    section.append(back, main.root, status, shelf, mini.root, full.root); requestDraw(); section.addEventListener("DOMNodeRemoved", () => { unsubscribe(); window.removeEventListener("popstate", onPopState); }, { once: true }); return section;
  }
  private createMainPlayer() { const root = this.createElement("section", "audiobook-main-player"), visual = this.createElement("button", "audiobook-main-player__visual") as HTMLButtonElement, copy = this.createElement("div", "audiobook-main-player__copy"), title = this.createElement("strong", "audiobook-main-player__title", "Escolha um capítulo"), collection = this.createElement("span", "audiobook-main-player__collection", "Selecione uma coleção abaixo"), status = this.createElement("span", "audiobook-main-player__status", "Pronto para ouvir"), timeline = this.createElement("input", "audiobook-main-player__timeline") as HTMLInputElement, elapsed = this.createElement("span", "audiobook-main-player__time", "0:00"), total = this.createElement("span", "audiobook-main-player__time", "0:00"), controls = this.createElement("div", "audiobook-main-player__controls"), previous = button("▮◀", "Faixa anterior"), toggle = button("▶", "Reproduzir ou pausar"), next = button("▶▮", "Próxima faixa"), secondary = this.createElement("div", "audiobook-main-player__secondary"), rewind = button("↺ 15", "Retroceder 15 segundos"), forward = button("15 ↻", "Avançar 15 segundos"), speed = document.createElement("select"); visual.type = "button"; visual.setAttribute("aria-label", "Abrir player completo"); visual.append(this.turntable()); timeline.type = "range"; timeline.min = "0"; timeline.max = "1"; timeline.step = ".1"; timeline.value = "0"; timeline.disabled = true; timeline.setAttribute("aria-label", "Posição do áudio"); speed.setAttribute("aria-label", "Velocidade"); [0.75, 1, 1.25, 1.5, 1.75, 2].forEach(value => { const option = document.createElement("option"); option.value = String(value); option.textContent = `${String(value).replace(".", ",")}×`; speed.append(option); }); speed.value = "1"; previous.disabled = true; toggle.disabled = true; next.disabled = true; rewind.disabled = true; forward.disabled = true; controls.append(previous, toggle, next); secondary.append(rewind, speed, forward); const times = this.createElement("div", "audiobook-main-player__times"); times.append(elapsed, total); copy.append(title, collection, status); root.append(visual, copy, timeline, times, controls, secondary); return { root, visual, title, collection, status, timeline, elapsed, total, previous, toggle, next, rewind, forward, speed }; }
  private createMiniPlayer() { const root = this.createElement("section", "audiobook-miniplayer"), cover = this.createElement("span", "audiobook-miniplayer__cover"), copy = this.createElement("span", "audiobook-miniplayer__copy"), title = this.createElement("strong", "audiobook-miniplayer__title"), collection = this.createElement("small", "audiobook-miniplayer__collection"), toggle = this.createElement("button", "audiobook-miniplayer__toggle", "▶") as HTMLButtonElement, progress = this.createElement("span", "audiobook-miniplayer__progress"); root.hidden = true; root.setAttribute("role", "button"); root.tabIndex = 0; toggle.type = "button"; toggle.setAttribute("aria-label", "Reproduzir ou pausar"); copy.append(title, collection); root.append(cover, copy, toggle, progress); return { root, cover, title, collection, toggle, progress }; }
  private createFullPlayer() { const root = this.createElement("section", "audiobook-full-player"), backdrop = this.createElement("button", "audiobook-full-player__backdrop") as HTMLButtonElement, panel = this.createElement("div", "audiobook-full-player__panel"), close = this.createElement("button", "audiobook-full-player__close", "⌄  Fechar") as HTMLButtonElement, cover = this.createElement("div", "audiobook-full-player__cover"), title = this.createElement("h2", "audiobook-full-player__title"), collection = this.createElement("p", "audiobook-full-player__collection"), download = this.createElement("p", "audiobook-full-player__download"), timeline = this.createElement("input", "audiobook-full-player__timeline") as HTMLInputElement, elapsed = this.createElement("span", "audiobook-full-player__time", "0:00"), total = this.createElement("span", "audiobook-full-player__time", "0:00"), previous = button("▮◀", "Faixa anterior"), rewind = button("↺ 15", "Retroceder 15 segundos"), toggle = button("▶", "Reproduzir"), forward = button("15 ↻", "Avançar 15 segundos"), next = button("▶▮", "Próxima faixa"), speed = document.createElement("select"), listButton = button("☷ Capítulos", "Abrir lista de capítulos"), chapterList = this.createElement("ol", "audiobook-full-player__chapters"); root.hidden = true; backdrop.type = "button"; backdrop.setAttribute("aria-label", "Fechar player"); close.type = "button"; close.setAttribute("aria-label", "Voltar para audiolivros"); download.hidden = true; download.setAttribute("role", "status"); timeline.type = "range"; timeline.min = "0"; timeline.max = "1"; timeline.step = "0.1"; timeline.value = "0"; timeline.setAttribute("aria-label", "Posição"); speed.className = "audiobook-full-player__speed"; speed.setAttribute("aria-label", "Velocidade"); [0.75, 1, 1.25, 1.5, 1.75, 2].forEach(value => { const option = document.createElement("option"); option.value = String(value); option.textContent = `${String(value).replace(".", ",")}×`; speed.append(option); }); speed.value = "1"; const times = this.createElement("div", "audiobook-full-player__times"); times.append(elapsed, total); const controls = this.createElement("div", "audiobook-full-player__controls"); controls.append(previous, rewind, toggle, forward, next); const options = this.createElement("div", "audiobook-full-player__options"); options.append(speed, listButton); chapterList.hidden = true; panel.append(close, cover, title, collection, download, timeline, times, controls, options, chapterList); root.append(backdrop, panel); return { root, backdrop, close, cover, title, collection, download, timeline, elapsed, total, previous, rewind, toggle, forward, next, speed, listButton, chapterList }; }
  private empty(): HTMLElement { const empty = this.createElement("div", "audiobooks-empty"), icon = this.createElement("span", "audiobooks-empty__icon", "♫"), add = this.createElement("button", "button button--primary audiobooks-empty__add", "Adicionar pasta de audiolivros") as HTMLButtonElement; icon.setAttribute("aria-hidden", "true"); add.type = "button"; add.addEventListener("click", this.dependencies.onAdd); empty.append(icon, this.createElement("h2", "audiobooks-empty__title", "Sua biblioteca de audiolivros está vazia"), this.createElement("p", "audiobooks-empty__copy", "Em Explorar livros, adicione uma pasta do Google Drive e escolha Audiolivros. Só os capítulos que você reproduzir serão baixados."), add); return empty; }
  private collectionArt(collection: AudiobookCollection): HTMLElement { const root = this.createElement("span", "audiobook-lp"), sleeve = this.createElement("span", "audiobook-lp__sleeve"), disc = this.createElement("span", "audiobook-lp__disc"), label = this.createElement("span", "audiobook-lp__label"), hole = this.createElement("span", "audiobook-lp__hole"), chapter = collection.chapters.find(value => value.coverUrl || value.thumbnailUrl) ?? collection.chapters[0], url = chapter?.coverUrl || chapter?.thumbnailUrl; if (url) { const image = document.createElement("img"); image.src = url; image.alt = ""; image.loading = "lazy"; image.addEventListener("error", () => { image.remove(); sleeve.classList.add("is-fallback"); sleeve.append(this.createElement("span", "audiobook-lp__brand", "LUMEO"), this.createElement("span", "audiobook-lp__note", "♫")); }, { once: true }); sleeve.append(image); } else { sleeve.classList.add("is-fallback"); sleeve.append(this.createElement("span", "audiobook-lp__brand", "LUMEO"), this.createElement("span", "audiobook-lp__note", "♫")); } label.textContent = "♫"; disc.append(label, hole); root.append(disc, sleeve); return root; }
  /** Decorative record: its label belongs to the rotating platter; the tone arm stays still. */
  private turntable(chapter?: AudiobookChapter): HTMLElement { const turntable = this.createElement("div", "audiobook-turntable"), record = this.createElement("span", "audiobook-turntable__record"), label = this.createElement("span", "audiobook-turntable__label"), brand = this.createElement("span", "audiobook-turntable__brand", "LUMEO"), note = this.createElement("span", "audiobook-turntable__note", "♫"), hole = this.createElement("span", "audiobook-turntable__hole"), arm = this.createElement("span", "audiobook-turntable__arm"), stylus = this.createElement("span", "audiobook-turntable__stylus"), url = chapter?.coverUrl || chapter?.thumbnailUrl; turntable.setAttribute("aria-hidden", "true"); if (url) { const image = document.createElement("img"); image.className = "audiobook-turntable__cover"; image.src = url; image.alt = ""; image.addEventListener("error", () => { image.remove(); label.append(brand, note); }, { once: true }); label.append(image); } else label.append(brand, note); record.append(label, hole); arm.append(stylus); turntable.append(record, arm); return turntable; }
  private cover(chapter: AudiobookChapter, large = false): HTMLElement { const cover = this.createElement("div", large ? "audiobook-cover audiobook-cover--large" : "audiobook-cover"), url = chapter.coverUrl || chapter.thumbnailUrl; if (url) { const image = document.createElement("img"); image.src = url; image.alt = `Capa de ${chapter.collection}`; image.loading = "lazy"; image.addEventListener("error", () => { image.remove(); cover.classList.add("audiobook-cover--placeholder"); cover.textContent = "♫"; }, { once: true }); cover.append(image); bindCoverBackdrop(cover, image); } else { cover.classList.add("audiobook-cover--placeholder"); cover.textContent = "♫"; } return cover; }
  private chapter(chapter: AudiobookChapter, number: number, queue: readonly AudiobookChapter[]): HTMLElement { const item = this.createElement("li", "audiobook-chapter"), copy = this.createElement("div", "audiobook-chapter__copy"), title = this.createElement("strong", "audiobook-chapter__title", `${number}. ${chapter.title}`), meta = this.createElement("span", "audiobook-chapter__meta", chapter.volume || humanSize(chapter.size)), art = this.cover(chapter); copy.append(title, meta); const action = this.createElement("button", "audiobook-chapter__play", "▶") as HTMLButtonElement; action.type = "button"; action.setAttribute("aria-label", `Reproduzir ${chapter.title}`); action.addEventListener("click", () => void this.dependencies.player.toggle(chapter, queue).catch(() => undefined)); item.append(art, copy, action); return item; }
  private renderChapterList(list: HTMLElement, collection: AudiobookCollection | undefined, active: AudiobookChapter, play: (chapter: AudiobookChapter) => void): void { list.replaceChildren(); if (!collection) return; collection.chapters.forEach((chapter, index) => { const item = this.createElement("li", "audiobook-full-player__chapter"), action = this.createElement("button", "") as HTMLButtonElement, copy = this.createElement("span", "audiobook-full-player__chapter-copy"), title = this.createElement("strong", "", `${index + 1}. ${chapter.title}`), meta = this.createElement("small", "", chapter.volume || humanSize(chapter.size)); action.type = "button"; action.classList.toggle("is-current", chapter.id === active.id); action.setAttribute("aria-label", `Reproduzir ${chapter.title}`); copy.append(title, meta); action.append(this.cover(chapter), copy, this.createElement("span", "audiobook-full-player__chapter-action", chapter.id === active.id ? "❚❚" : "▶")); action.addEventListener("click", () => play(chapter)); item.append(action); list.append(item); }); }
  private collectionFor(chapter: AudiobookChapter, collections: readonly AudiobookCollection[]): AudiobookCollection | undefined { return collections.find(collection => collection.id === chapter.sourceId); }
}
function button(text: string, label: string): HTMLButtonElement { const value = document.createElement("button"); value.type = "button"; value.textContent = text; value.setAttribute("aria-label", label); return value; }
function clock(seconds: number): string { const whole = Math.max(0, Math.round(seconds)), minutes = Math.floor(whole / 60), remaining = whole % 60; return `${minutes}:${String(remaining).padStart(2, "0")}`; }
function progressRatio(state: AudiobookPlayerState): number { return state.duration > 0 ? Math.max(0, Math.min(1, state.position / state.duration)) : 0; }
function percent(value: number | null): number { return Math.max(0, Math.min(100, Math.round(value ?? 0))); }
function humanSize(value?: string): string { const bytes = Number(value); return Number.isFinite(bytes) && bytes > 0 ? `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : "Capítulo"; }
function fold(value: string): string { return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR"); }

/** What the LP says under its title. */
function collectionSummary(collection: AudiobookCollection): string {
  const count = collection.chapters.length, chapters = `${count} capítulo${count === 1 ? "" : "s"}`;
  switch (collection.status) {
    case "syncing": return count ? `${chapters} · sincronizando…` : "Sincronizando…";
    case "empty": return "Pasta sem áudio";
    case "error": return "Sem acesso à pasta";
    default: return chapters;
  }
}
/** The message in place of the chapter list when a collection has none yet. */
function collectionNotice(collection: AudiobookCollection): string {
  if (collection.status === "syncing") return "Lendo esta pasta e as subpastas no Google Drive. Os capítulos aparecem aqui assim que forem encontrados.";
  if (collection.status === "error") return `${collection.message ?? "Não foi possível ler esta pasta do Google Drive."} Confira se o link está compartilhado com a sua conta e abra esta tela de novo.`;
  return "Nenhum arquivo de áudio foi encontrado nesta pasta nem nas subpastas. Formatos aceitos: MP3, M4A, M4B, AAC, OGG, OPUS, WAV e FLAC. A pasta é lida de novo sempre que esta tela abre.";
}
/** The LP sleeve shows the first chapter cover found; a new one replaces the art. */
function collectionArtKey(collection: AudiobookCollection): string {
  const chapter = collection.chapters.find(value => value.coverUrl || value.thumbnailUrl) ?? collection.chapters[0];
  return chapter?.coverUrl || chapter?.thumbnailUrl || "";
}
