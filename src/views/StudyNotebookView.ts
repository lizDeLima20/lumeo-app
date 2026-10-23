import type { HighlightColor } from "../models/Highlight";
import type { LimaDocument } from "../lima/LimaDocument";
import { StudyEventBus } from "../reader/study/StudyEventBus";
import { StudyFilterController } from "../reader/study/StudyFilterController";
import { StudyNotebook, type StudyEntry, type StudyEntryType } from "../reader/study/StudyNotebook";
import { StudyNotebookService } from "../reader/study/StudyNotebookService";
import { StudySortController, type StudySort } from "../reader/study/StudySortController";
import { StudyStatisticsService } from "../reader/study/StudyStatisticsService";
import { I18nManager } from "../i18n/I18nManager";

const t = (key: Parameters<typeof I18nManager.shared.t>[0], params?: Parameters<typeof I18nManager.shared.t>[1]) => I18nManager.shared.t(key, params);

export class StudyNotebookView {
  private root: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private notebook: StudyNotebook | null = null;
  private filter: "all" | StudyEntryType = "all";
  private color: HighlightColor | undefined;
  private sort: StudySort = "book";
  private query = "";
  private grouped = true;
  private reviewEntries: StudyEntry[] = [];
  private unsubscribe: () => void = () => undefined;
  public constructor(private readonly bookId: string, private readonly document: LimaDocument, private readonly service: StudyNotebookService, private readonly navigate: (entry: StudyEntry) => void, private readonly edit: (entry: StudyEntry) => void, private readonly remove: (entry: StudyEntry) => void) {
    this.unsubscribe = StudyEventBus.shared.subscribe(event => { if (event.bookId === bookId && this.isOpen) void this.refresh(); });
  }
  public render(): HTMLElement {
    const root = document.createElement("section"); this.root = root; root.className = "study-notebook-view"; root.setAttribute("aria-hidden", "true");
    const header = document.createElement("header"), heading = document.createElement("div"), eyebrow = document.createElement("span"), title = document.createElement("h2"), close = this.button("×", t("study.notebook.close"), () => this.close());
    eyebrow.textContent = t("study.notebook.eyebrow"); title.textContent = t("study.notebook.title"); heading.append(eyebrow, title); header.append(heading, close);
    const controls = document.createElement("div"); controls.className = "study-notebook-controls";
    const filters = this.select(t("study.notebook.filterLabel"), [["all", t("study.notebook.filterAll")], ["highlight", t("study.notebook.filterHighlight")], ["annotation", t("study.notebook.filterAnnotation")], ["bookmark", t("study.notebook.filterBookmark")]], value => { this.filter = value as typeof this.filter; this.paint(); }),
      colors = this.select(t("study.notebook.colorLabel"), [["", t("study.notebook.colorAll")], ["yellow", t("study.notebook.colorYellow")], ["orange", t("study.notebook.colorOrange")], ["green", t("study.notebook.colorGreen")], ["blue", t("study.notebook.colorBlue")], ["pink", t("study.notebook.colorPink")]], value => { this.color = (value || undefined) as HighlightColor | undefined; this.paint(); }),
      sort = this.select(t("study.notebook.sortLabel"), [["book", t("study.notebook.sortBook")], ["newest", t("study.notebook.sortNewest")], ["oldest", t("study.notebook.sortOldest")]], value => { this.sort = value as StudySort; this.paint(); });
    const search = document.createElement("input"); search.type = "search"; search.placeholder = t("study.notebook.searchPlaceholder"); search.setAttribute("aria-label", t("study.notebook.searchPlaceholder")); search.addEventListener("input", () => { this.query = search.value; this.paint() });
    const group = document.createElement("label"), checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = this.grouped; checkbox.addEventListener("change", () => { this.grouped = checkbox.checked; this.paint() }); group.append(checkbox, document.createTextNode(t("study.notebook.groupByChapter")));
    const review = this.button(t("study.notebook.review"), t("study.notebook.startReview"), () => this.startReview());
    controls.append(filters, colors, sort, search, group, review);
    this.content = document.createElement("div"); this.content.className = "study-notebook-content"; root.append(header, controls, this.content); return root;
  }
  public async open(): Promise<void> { this.root?.classList.add("study-notebook-view--open"); this.root?.setAttribute("aria-hidden", "false"); await this.refresh(); this.root?.querySelector<HTMLElement>("button,input,select")?.focus(); }
  public close(): void { this.root?.classList.remove("study-notebook-view--open"); this.root?.setAttribute("aria-hidden", "true"); }
  public get isOpen(): boolean { return Boolean(this.root?.classList.contains("study-notebook-view--open")); }
  public destroy(): void { this.unsubscribe(); }
  private async refresh(): Promise<void> { this.notebook = await this.service.load(this.bookId, this.document); this.paint(); }
  private entries(): StudyEntry[] { if (!this.notebook) return []; return new StudySortController().sort(new StudyFilterController().filter(this.notebook.entries, this.filter, this.color, this.query), this.sort); }
  private paint(): void {
    if (!this.content || !this.notebook) return;
    const entries = this.entries(), statistics = new StudyStatisticsService().calculate(this.notebook.entries), summary = document.createElement("p");
    summary.className = "study-notebook-summary";
    summary.textContent = t("study.notebook.summary", { highlights: statistics.highlights, annotations: statistics.annotations, bookmarks: statistics.bookmarks, chapters: statistics.chaptersWithActivity }) + (statistics.mostStudiedChapter ? t("study.notebook.mostStudied", { chapter: statistics.mostStudiedChapter }) : "");
    this.content.replaceChildren(summary);
    if (!entries.length) { this.content.append(document.createTextNode(t("study.notebook.noEntries"))); return; }
    if (this.grouped) {
      this.service.groupByChapter(entries).forEach(section => {
        const wrapper = document.createElement("section"), title = document.createElement("h3"); title.textContent = section.title;
        const review = this.button(t("study.notebook.reviewChapter"), t("study.notebook.reviewChapterLabel", { chapter: section.title }), () => this.startReview(section.entries));
        wrapper.append(title, review, ...section.entries.map(entry => this.entry(entry))); this.content!.append(wrapper)
      });
    } else this.content.append(...entries.map(entry => this.entry(entry)));
  }
  private entry(entry: StudyEntry): HTMLElement {
    const article = document.createElement("article"); article.className = "study-notebook-entry"; article.dataset.color = entry.highlightColor ?? "";
    const open = this.button(entry.selectedText || t("study.notebook.resumeHere"), t("study.notebook.openPassageIn", { chapter: entry.chapterTitle }), () => this.navigate(entry));
    const meta = document.createElement("small"); meta.textContent = t("study.notebook.entryMeta", { type: this.typeName(entry.type), chapter: entry.chapterTitle, position: Math.floor(entry.position / 10000) + 1 }); article.append(open, meta);
    if (entry.noteText) { const note = document.createElement("p"); note.className = "study-notebook-entry__note"; note.textContent = t("study.notebook.noteLabel", { text: entry.noteText }); article.append(note) }
    if (entry.definitionText) { const value = document.createElement("p"); value.className = "study-notebook-entry__field"; value.textContent = t("study.notebook.definitionLabel", { text: entry.definitionText }); article.append(value) }
    if (entry.translationText) { const value = document.createElement("p"); value.className = "study-notebook-entry__field"; value.textContent = t("study.notebook.translationLabel", { text: entry.translationText }); article.append(value) }
    const actions = document.createElement("div");
    if (entry.type === "annotation") actions.append(this.button(t("ui.common.edit"), t("study.notebook.editNote"), () => this.edit(entry)));
    actions.append(this.button(t("ui.common.remove"), t("study.notebook.removeEntry"), () => this.remove(entry)));
    article.append(actions); return article;
  }
  private startReview(entries = this.entries()): void { if (!this.notebook || !this.content) return; this.reviewEntries = entries; const current = this.notebook.review(entries); this.paintReview(current); }
  private paintReview(entry: StudyEntry | null): void {
    if (!this.content) return;
    if (!entry) { this.content.textContent = t("study.notebook.noEntryToReview"); return; }
    const card = document.createElement("article"); card.className = "study-review-card";
    const type = document.createElement("small"); type.textContent = `${this.typeName(entry.type)} · ${entry.chapterTitle}`;
    const quote = document.createElement("blockquote"); quote.textContent = entry.selectedText;
    if (entry.noteText) { const note = document.createElement("p"); note.textContent = entry.noteText; card.append(type, quote, note) } else card.append(type, quote);
    const actions = document.createElement("div");
    actions.append(
      this.button(t("ui.study.previous"), t("study.notebook.previousEntry"), () => this.paintReview(this.notebook?.reviewPrevious(this.reviewEntries) ?? null)),
      this.button(t("study.notebook.openInBook"), t("study.notebook.openInBook"), () => this.navigate(entry)),
      this.button(t("ui.study.next"), t("study.notebook.nextEntry"), () => this.paintReview(this.notebook?.reviewNext(this.reviewEntries) ?? null)),
      this.button(t("ui.study.exit"), t("study.notebook.exitReview"), () => this.paint())
    );
    card.append(actions); this.content.replaceChildren(card);
  }
  private select(label: string, options: string[][], change: (value: string) => void): HTMLLabelElement { const wrapper = document.createElement("label"); wrapper.append(document.createTextNode(label)); const select = document.createElement("select"); options.forEach(([value, text]) => select.append(new Option(text, value))); select.addEventListener("change", () => change(select.value)); wrapper.append(select); return wrapper; }
  private typeName(type: StudyEntryType): string { return type === "highlight" ? t("study.notebook.typeHighlight") : type === "annotation" ? t("study.notebook.typeAnnotation") : t("study.notebook.typeBookmark"); }
  private button(text: string, label: string, action: () => void): HTMLButtonElement { const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.setAttribute("aria-label", label); button.addEventListener("click", action); return button; }
}
