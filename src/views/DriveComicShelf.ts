import type { GoogleDriveLibraryEntry } from "../external/GoogleDriveLibraryRepository";
import type { DriveSection } from "../services/PersonalDriveFolderTree";

/** Sections mounted at first, then per batch (scrolling near the end or "Mostrar mais"). */
const SECTION_BATCH = 8;
/** Cards mounted per carousel at first, then per batch as it is swiped. */
const CARD_BATCH = 15;

interface MountedSection { element: HTMLElement; track: HTMLElement | null; cards: Map<string, HTMLElement>; limit: number; files: GoogleDriveLibraryEntry[]; }

/**
 * A comic source's Drive tree as one page: each folder a title (its depth in the tree as the
 * heading level), each folder with comics a horizontal carousel of its own. Nothing has to be
 * opened and closed to reach the next series.
 *
 * Built for thousands of comics: only the first sections exist at first and more are appended
 * near the end of the page; each carousel holds a few cards and grows as it is swiped. An update
 * (a sync page, a new cover) never rebuilds what is already on screen: missing sections and cards
 * are inserted in place, so scroll positions, covers and download progress stay.
 */
export class DriveComicShelf {
  public readonly element: HTMLElement;
  private sections: DriveSection[] = [];
  private readonly mounted = new Map<string, MountedSection>();
  private shown = SECTION_BATCH;
  private readonly sentinel: HTMLElement;
  private readonly observer: IntersectionObserver | null;

  public constructor(public readonly sourceId: string, private readonly card: (entry: GoogleDriveLibraryEntry) => HTMLElement, private readonly changed: () => void = () => undefined) {
    this.element = document.createElement("div"); this.element.className = "drive-comic-shelf";
    this.sentinel = document.createElement("div"); this.sentinel.className = "drive-comic-shelf__sentinel"; this.sentinel.setAttribute("aria-hidden", "true");
    this.element.append(this.sentinel);
    // The next sections are mounted while the reader is still a screen or two away from them.
    this.observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(items => { if (items.some(item => item.isIntersecting)) this.showMore(); }, { rootMargin: "0px 0px 1200px 0px" })
      : null;
    this.observer?.observe(this.sentinel);
  }

  public get hasMore(): boolean { return this.sections.length > this.shown; }
  public get mountedSections(): number { return this.mounted.size; }
  public get mountedCards(): number { let total = 0; this.mounted.forEach(value => { total += value.cards.size; }); return total; }

  /** Takes the tree as it is now; sections already on screen are kept and completed in place. */
  public update(sections: DriveSection[]): void {
    this.sections = sections;
    // A section that is already mounted stays mounted even if new folders were found above it.
    sections.forEach((section, index) => { if (this.mounted.has(section.node.folderId)) this.shown = Math.max(this.shown, index + 1); });
    this.mount();
  }

  /** Appends the next batch of sections; never removes the ones shown. */
  public showMore(): void {
    if (!this.hasMore) return;
    this.shown += SECTION_BATCH; this.mount(); this.changed();
    // The observer only reports changes: if the end of the page is still near after this batch,
    // observing again reports it once more and the next batch follows.
    if (this.observer) { this.observer.unobserve(this.sentinel); this.observer.observe(this.sentinel); }
  }

  public dispose(): void { this.observer?.disconnect(); this.mounted.clear(); this.element.remove(); }

  private mount(): void {
    let previous: Element | null = null;
    for (const section of this.sections.slice(0, this.shown)) {
      const value = this.mounted.get(section.node.folderId) ?? this.create(section);
      value.files = section.files;
      // In tree order, right after the previous section: new folders found by the sync land
      // where they belong without moving anything else.
      const expected: Element | null = previous ? previous.nextElementSibling : this.element.firstElementChild;
      if (expected !== value.element) this.element.insertBefore(value.element, expected ?? this.sentinel);
      this.fill(value);
      previous = value.element;
    }
  }

  private create(section: DriveSection): MountedSection {
    const element = document.createElement("section"); element.className = "drive-comic-shelf__section";
    element.dataset.depth = String(Math.min(section.depth, 5)); element.dataset.folderId = section.node.folderId;
    // h2 for the source, h3 for its folders, and so on; deeper than h6 keeps the real level for
    // assistive technology.
    const level = section.depth + 2, title = document.createElement(level <= 6 ? `h${level}` : "div");
    if (level > 6) { title.setAttribute("role", "heading"); title.setAttribute("aria-level", String(level)); }
    title.className = "drive-comic-shelf__title"; title.textContent = section.node.name;
    element.append(title);
    if (section.node.error) element.append(Object.assign(document.createElement("p"), { className: "drive-comic-shelf__note", textContent: "Sem acesso a esta pasta no Google Drive." }));
    const value: MountedSection = { element, track: null, cards: new Map(), limit: CARD_BATCH, files: section.files };
    this.mounted.set(section.node.folderId, value);
    return value;
  }

  /** The carousel of a section: its first cards in order, more as it is swiped to the end. */
  private fill(value: MountedSection): void {
    if (!value.files.length) return;
    if (!value.track) {
      const track = document.createElement("div"); track.className = "drive-comic-shelf__track";
      track.setAttribute("role", "list"); track.setAttribute("aria-label", `${value.element.querySelector(".drive-comic-shelf__title")?.textContent ?? "HQs"}: ${value.files.length} HQ(s)`);
      track.addEventListener("scroll", () => {
        if (value.limit >= value.files.length || track.scrollLeft + track.clientWidth < track.scrollWidth - track.clientWidth) return;
        value.limit += CARD_BATCH; this.fill(value);
      }, { passive: true });
      value.element.append(track); value.track = track;
    }
    let previous: Element | null = null;
    for (const entry of value.files.slice(0, value.limit)) {
      let card = value.cards.get(entry.fileId);
      if (!card) { card = this.card(entry); card.setAttribute("role", "listitem"); value.cards.set(entry.fileId, card); }
      const expected: Element | null = previous ? previous.nextElementSibling : value.track.firstElementChild;
      if (expected !== card) value.track.insertBefore(card, expected);
      previous = card;
    }
  }
}
