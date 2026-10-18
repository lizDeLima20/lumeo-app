/** Download states a details page shows, the same ones the card's round button goes through. */
export type DriveItemDownloadState = "idle" | "downloading" | "indeterminate" | "saving" | "done" | "error";

export interface DriveItemDownloadUpdate { state: DriveItemDownloadState; percent: number | null; message?: string; }

export interface DriveItemDetailsInput {
  kind: "book" | "comic";
  title: string;
  /** Shown above the title: the genre of a book, the collection of a comic. */
  eyebrow?: string;
  author?: string;
  /** Label and value pairs; only the ones the metadata really has. */
  facts: ReadonlyArray<readonly [string, string]>;
  synopsis?: string;
  coverUrl?: string;
  /** The generic Lumeo cover, shown while there is no artwork or when it fails to load. */
  placeholder: () => HTMLElement;
  /** Artwork found later (a cover still being resolved for the card). */
  resolveCover?: (signal: AbortSignal) => Promise<string | null>;
  downloaded: () => boolean;
  /** Where a download of this item already stands (one started from the card), if any. */
  current: () => DriveItemDownloadUpdate | null;
  /** Follows the item's download, wherever it was started; returns the unsubscribe. */
  watch: (listener: (update: DriveItemDownloadUpdate) => void) => () => void;
  /** Starts the shared download; it does nothing when one is already running. */
  download: () => void;
  open: () => void;
}

/** What the single main button says. Progress is real: a percentage only when it is known. */
export function driveDetailsActionLabel(downloaded: boolean, update: DriveItemDownloadUpdate | null): string {
  if (downloaded || update?.state === "done") return "Abrir";
  switch (update?.state) {
    case "downloading": return update.percent == null ? "Baixando…" : `Baixando ${Math.round(Math.max(0, Math.min(100, update.percent)))}%`;
    case "indeterminate": return "Baixando…";
    case "saving": return "Salvando…";
    case "error": return "Tentar novamente";
    default: return "Baixar";
  }
}

let sequence = 0;

/**
 * The page a book or a comic of the Explore shelves opens to: back, the cover, what it is and
 * one main button - Baixar, its real progress, then Abrir.
 *
 * It is a full-screen dialog over the shelf, so the shelf keeps its scroll, its covers and the
 * card's own download progress underneath. The download is the shelf's own (the card's round
 * button and this button follow the same one), so it can never run twice. Android's back and
 * the Voltar button both close it; the shelf's page is not rebuilt.
 */
export class DriveItemDetails {
  private dialog: HTMLDialogElement | null = null;
  private stop: (() => void) | null = null;
  private covers: AbortController | null = null;
  private inHistory = false;
  private afterBack: (() => void) | null = null;
  private readonly onPopState = (): void => {
    if (!this.inHistory) return;
    this.inHistory = false;
    const then = this.afterBack; this.afterBack = null;
    this.close();
    then?.();
  };

  public show(input: DriveItemDetailsInput): void {
    this.close();
    const id = `drive-details-${++sequence}`;
    const dialog = document.createElement("dialog");
    dialog.className = "drive-details"; dialog.dataset.kind = input.kind;
    dialog.setAttribute("aria-labelledby", `${id}-title`);
    const page = element("div", "drive-details__page");

    const bar = element("div", "drive-details__bar");
    const back = element("button", "drive-details__back") as HTMLButtonElement;
    back.type = "button";
    back.append(chevron(), element("span", "", "Voltar"));
    back.addEventListener("click", () => this.dismiss());
    bar.append(back);

    const cover = element("div", "drive-details__cover");
    this.covers = new AbortController();
    this.mountCover(cover, input, this.covers.signal);

    const heading = element("div", "drive-details__heading");
    if (input.eyebrow) heading.append(element("p", "drive-details__eyebrow", input.eyebrow));
    const title = element("h1", "drive-details__title", input.title); title.id = `${id}-title`;
    heading.append(title);
    if (input.author) heading.append(element("p", "drive-details__author", input.author));

    page.append(bar, cover, heading);
    if (input.facts.length) {
      const facts = element("dl", "drive-details__facts");
      input.facts.forEach(([label, value]) => {
        const item = element("div", "drive-details__fact");
        item.append(element("dt", "", label), element("dd", "", value));
        facts.append(item);
      });
      page.append(facts);
    }
    if (input.synopsis) {
      // A long synopsis scrolls inside its own box: the cover and the button stay in place.
      const synopsis = element("div", "drive-details__synopsis");
      synopsis.tabIndex = 0; synopsis.setAttribute("aria-label", "Sinopse");
      synopsis.append(element("p", "", input.synopsis));
      page.append(synopsis);
      const mark = (): void => {
        const more = synopsis.scrollHeight - synopsis.clientHeight - synopsis.scrollTop > 2;
        synopsis.classList.toggle("drive-details__synopsis--more", more);
      };
      synopsis.addEventListener("scroll", mark, { passive: true });
      requestAnimationFrame(mark);
      window.addEventListener("resize", mark);
      dialog.addEventListener("close", () => window.removeEventListener("resize", mark), { once: true });
    }

    const footer = element("div", "drive-details__footer");
    const note = element("p", "drive-details__note"); note.setAttribute("role", "status"); note.hidden = true;
    const action = element("button", "drive-details__action") as HTMLButtonElement; action.type = "button";
    const fill = element("span", "drive-details__progress"); fill.setAttribute("aria-hidden", "true");
    const label = element("span", "drive-details__label");
    action.append(fill, label);
    footer.append(note, action);
    page.append(footer);

    let update = input.current();
    const paint = (): void => {
      const downloaded = input.downloaded() || update?.state === "done";
      const busy = !downloaded && (update?.state === "downloading" || update?.state === "indeterminate" || update?.state === "saving");
      action.dataset.state = downloaded ? "open" : update?.state ?? "idle";
      label.textContent = driveDetailsActionLabel(downloaded, update);
      action.disabled = busy;
      action.setAttribute("aria-busy", String(busy));
      const percent = update?.state === "saving" ? 100 : update?.state === "downloading" ? update.percent ?? 0 : 0;
      action.style.setProperty("--drive-details-progress", String(Math.max(0, Math.min(100, percent)) / 100));
      const failed = !downloaded && update?.state === "error";
      note.hidden = !failed; note.textContent = failed ? update?.message ?? "Não foi possível baixar." : "";
    };
    this.stop = input.watch(next => { update = next; paint(); });
    paint();
    action.addEventListener("click", () => {
      if (input.downloaded() || update?.state === "done") { this.dismiss(input.open); return; }
      if (action.disabled) return;
      update = { state: "downloading", percent: 0 }; paint();
      input.download();
    });

    dialog.append(page);
    // Escape on a keyboard: the same as Voltar.
    dialog.addEventListener("cancel", event => { event.preventDefault(); this.dismiss(); });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog);
    this.dialog = dialog;
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    page.scrollTop = 0;
    // An entry of its own in the history: Android's back closes this page, not the shelf.
    try {
      window.history.pushState(window.history.state, "", window.location.href);
      this.inHistory = true;
      window.addEventListener("popstate", this.onPopState);
    } catch { this.inHistory = false; }
  }

  /** Closes the page, through the history when it has an entry there, then runs `then`. */
  public dismiss(then?: () => void): void {
    if (!this.dialog) { then?.(); return; }
    if (this.inHistory) { this.afterBack = then ?? null; window.history.back(); return; }
    this.close(); then?.();
  }

  /** Closes at once, without touching the history (the shelf itself is leaving). */
  public close(): void {
    window.removeEventListener("popstate", this.onPopState);
    this.stop?.(); this.stop = null;
    this.covers?.abort(); this.covers = null;
    const dialog = this.dialog; this.dialog = null;
    if (dialog) { if (dialog.open) dialog.close(); dialog.remove(); }
  }

  private mountCover(root: HTMLElement, input: DriveItemDetailsInput, signal: AbortSignal): void {
    const placeholder = input.placeholder();
    placeholder.classList.add("drive-details__placeholder");
    root.append(placeholder);
    const image = element("img", "drive-details__image") as HTMLImageElement;
    image.alt = `Capa de ${input.title}`; image.decoding = "async";
    const show = (url: string, retry: boolean): void => {
      image.addEventListener("load", () => { placeholder.remove(); if (!image.parentNode) root.append(image); }, { once: true });
      image.addEventListener("error", () => { image.remove(); if (retry) resolve(); }, { once: true });
      image.src = url;
    };
    const resolve = (): void => {
      if (!input.resolveCover) return;
      void input.resolveCover(signal).then(url => { if (url && !signal.aborted && url !== image.src) show(url, false); }).catch(() => undefined);
    };
    if (input.coverUrl) show(input.coverUrl, true); else resolve();
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function chevron(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M14.5 5.5 8 12l6.5 6.5"); path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}
