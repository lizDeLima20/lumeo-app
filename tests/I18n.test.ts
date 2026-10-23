import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EN_US } from "../src/i18n/locales/en-US";
import { ES } from "../src/i18n/locales/es";
import { PT_BR } from "../src/i18n/locales/pt-BR";
import { DEFAULT_LOCALE, I18nManager, LocaleFormatter, LocaleRepository, TranslationDictionary, type SupportedLocale } from "../src/i18n/I18nManager";
import type { TranslationCatalog } from "../src/i18n/locales/pt-BR";
import type { StorageAdapter } from "../src/services/StorageService";

class MemoryStorage implements StorageAdapter {
  public readonly values = new Map<string, unknown>();
  public async load<T>(key: string): Promise<T | null> { return this.values.get(key) as T ?? null; }
  public async save<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
  public async remove(key: string): Promise<void> { this.values.delete(key); }
}

const create = (storage = new MemoryStorage()) => ({ storage, manager: new I18nManager(new LocaleRepository(storage), new TranslationDictionary(), new LocaleFormatter()) });
const keys = (catalog: object): string[] => Object.keys(catalog).sort();

describe("I18nManager", () => {
  it("registers exactly the initial supported locales", () => {
    const { manager } = create();
    assert.deepEqual(manager.getAvailableLocales(), ["pt-BR", "en-US", "es"]);
    assert.equal(DEFAULT_LOCALE, "pt-BR");
  });
  it("maps browser locale variants to the supported catalog", () => {
    const { manager } = create();
    assert.equal(manager.detect("pt-PT"), "pt-BR"); assert.equal(manager.detect("en-GB"), "en-US");
    assert.equal(manager.detect("es-MX"), "es"); assert.equal(manager.detect(["ja-JP", "en-GB"]), "en-US");
  });
  it("restores a saved manual locale before browser detection", async () => {
    const pair = create(); await pair.manager.setLocale("es");
    const restored = new I18nManager(new LocaleRepository(pair.storage), new TranslationDictionary(), new LocaleFormatter());
    assert.equal(await restored.initialize("en-GB"), "es");
  });
  it("falls back safely for unsupported stored locale", async () => {
    const storage = new MemoryStorage(); await storage.save("locale", "de"); const { manager } = create(storage);
    assert.equal(await manager.initialize("en-GB"), "en-US");
  });
  it("falls back to pt-BR when a non-base catalog misses a key", () => {
    const incomplete = { ...EN_US } as Record<string, string>; delete incomplete["reader.back"];
    const dictionary = new TranslationDictionary({ "pt-BR": PT_BR, "en-US": incomplete as TranslationCatalog, es: ES });
    assert.equal(dictionary.translate("en-US", "reader.back"), PT_BR["reader.back"]);
  });
  it("notifies runtime listeners and updates document language", async () => {
    const previous = (globalThis as { document?: unknown }).document, root = { lang: "" };
    Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: root, dispatchEvent: () => true } });
    try {
      const { manager } = create(); let seen: SupportedLocale | null = null;
      manager.subscribe(locale => { seen = locale; }); await manager.setLocale("en-US");
      assert.equal(seen, "en-US"); assert.equal(root.lang, "en-US");
    } finally { Object.defineProperty(globalThis, "document", { configurable: true, value: previous }); }
  });
  it("interpolates and pluralizes using locale rules", async () => {
    const { manager } = create();
    assert.equal(manager.t("format.pageOf", { current: 2, total: 10 }), "Página 2 de 10");
    assert.equal(manager.plural("format.books", 1), "1 livro"); assert.equal(manager.plural("format.books", 2), "2 livros");
    await manager.setLocale("en-US"); assert.equal(manager.plural("format.books", 2), "2 books");
  });
  it("translates the shared application chrome, reader and cloud-import copy", async () => {
    const { manager } = create(); await manager.setLocale("en-US");
    assert.equal(manager.t("ui.auth.login"), "Sign in"); assert.equal(manager.t("reader.animation.carousel"), "Vertical swipe");
    assert.equal(manager.t("import.download.cancel"), "Cancel download");
    await manager.setLocale("es");
    assert.equal(manager.t("ui.library.title"), "Mi biblioteca"); assert.equal(manager.t("reader.scan.scannedText"), "Texto escaneado");
    assert.equal(manager.t("import.remote.add"), "Añadir a la biblioteca");
  });
  it("centralizes locale-aware date, number, size and time formatting", () => {
    const formatter = new LocaleFormatter();
    assert.equal(formatter.number(1234.56, "pt-BR"), "1.234,56"); assert.equal(formatter.number(1234.56, "en-US"), "1,234.56");
    assert.match(formatter.date("2026-09-11T12:00:00.000Z", "en-US"), /9\/11\/2026/);
    assert.equal(formatter.fileSize(1_572_864, "en-US"), "1.5 MB"); assert.equal(formatter.duration(120, "es"), "2 horas");
  });
  it("keeps every base key in English and Spanish", () => {
    assert.deepEqual(keys(EN_US), keys(PT_BR)); assert.deepEqual(keys(ES), keys(PT_BR));
  });
  /**
   * Having a key present isn't the same as it being translated: EN_US and ES both spread
   * `...PT_BR` as their base, so a key with no explicit override still exists but silently
   * carries the Portuguese text. This test catches that leftover case specifically, while
   * allowing legitimate exceptions where the EN/ES word is genuinely identical to Portuguese
   * on its own merit: proper nouns and brand names (Google Drive, OneDrive, Lumeo, Pomodoro),
   * and real cognates shared by the three languages (e.g. "Normal", "Original", "Capítulo",
   * "Preparando…") rather than copy nobody translated yet.
   */
  it("flags Portuguese text left untranslated in English/Spanish, outside known legitimate exceptions", () => {
    const EN_LEGITIMATE_MATCHES = new Set([
      "google.title", "ui.catalog.sources.statusLine", "ui.book.status", "ui.import.fromGoogle", "ui.import.fromOneDrive",
      "ui.catalog.volume", "ui.catalog.volumeLabel", "ui.study.original", "drive.linkN", "reader.weight.normal",
      "reader.spacing.normal", "reader.paper.natural", "reader.layout", "reader.margin.normal", "reader.pomodoro.title",
      "reader.scan.original", "reader.scan.normal", "reader.pagination.reflow", "storage.local",
    ]);
    const ES_LEGITIMATE_MATCHES = new Set([
      "google.title", "externalLibrary.title", "externalLibrary.settings", "externalLibrary.cancel", "externalLibrary.open",
      "import.remote.format", "import.remote.openExisting", "import.processing.library", "ui.comic.arc",
      "ui.catalog.sources.catalogFound", "ui.navigation.library", "ui.navigation.settings", "ui.book.edit", "ui.book.format",
      "ui.edit.bookTitle", "ui.edit.author", "ui.common.cancel", "ui.common.edit", "ui.common.open", "ui.common.preparing",
      "ui.common.optional", "ui.common.confirm", "ui.import.importing", "ui.import.fromGoogle", "ui.import.fromOneDrive",
      "ui.catalog.eyebrow", "ui.catalog.format", "ui.catalog.preparing", "ui.catalog.validating", "ui.catalog.sync",
      "ui.catalog.syncing", "ui.settings.lightTheme", "ui.study.notes", "ui.study.bookmarks", "ui.study.sort",
      "ui.study.groupChapter", "ui.study.review", "ui.study.editNote", "ui.study.previous", "ui.study.original",
      "ui.study.targetLanguage", "ui.study.lookupDefinition", "ui.chapter.moveUp", "ui.device.title", "ui.device.authorize",
      "ui.license.reconnect", "drive.all", "drive.syncing", "drive.restore", "drive.restoreNamed", "drive.factFormat",
      "details.open", "audio.chapterCount", "audio.rewind", "audio.chapters", "audio.openChapterList", "audio.chapter",
      "audio.badgeSyncing", "readerView.editNote", "readerView.pageN", "readerView.go", "readerView.open",
      "import.stageOrganizing", "import.stageChapters", "import.stageFinalizing", "import.noteTitle", "import.noteAuthor",
      "reader.previousPage", "reader.comic.preparingPercent", "reader.text", "reader.font.modern", "reader.weight.normal",
      "reader.spacing.compact", "reader.spacing.normal", "reader.paper", "reader.paper.natural", "reader.pages",
      "reader.margin.normal", "reader.pomodoro.title", "reader.pomodoro.break", "reader.pomodoro.pages",
      "reader.pomodoro.pauses", "reader.pomodoro.chipBreak", "reader.pomodoro.goalType.pages", "reader.pomodoro.expand",
      "reader.pomodoro.pagesProgress", "reader.reminder.sun", "reader.reminder.sat", "ui.study.page", "reader.theme",
      "reader.theme.paper", "reader.theme.light", "reader.animation.slide", "reader.animation.carousel",
      "reader.imageProfile", "reader.language", "selection.note", "selection.dictionary", "selection.context",
      "selection.copy", "onboarding.language", "settings.language", "reader.scan.original", "reader.scan.scannedText",
      "reader.scan.soft", "reader.scan.normal", "reader.regionHighlight.markArea", "reader.pagination.reflow",
      "reader.pagination.original", "offline.reconnecting", "storage.used", "storage.local", "storage.persistent",
      "diagnostics.title", "diagnostics.copy", "library.versionCancel", "catalog.findBook", "format.pageOf",
      "reader.card.locationValue", "reader.card.definition", "reader.card.lookupDefinition", "reader.card.looking",
      "nav.map", "nav.openTab", "nav.search", "nav.title", "selection.dictionaryLabel",
      "study.notebook.colorBlue", "study.notebook.colorGreen", "study.notebook.colorPink",
      "study.notebook.definitionLabel", "study.notebook.editNote", "study.notebook.filterAnnotation",
      "study.notebook.filterBookmark", "study.notebook.groupByChapter", "study.notebook.noteLabel",
      "study.notebook.previousEntry", "study.notebook.sortLabel", "study.notebook.typeAnnotation",
      "study.notebook.typeBookmark", "ui.book.openLabel",
    ]);
    const unexpectedEn = keys(PT_BR).filter(key => EN_US[key] === PT_BR[key] && !EN_LEGITIMATE_MATCHES.has(key));
    const unexpectedEs = keys(PT_BR).filter(key => ES[key] === PT_BR[key] && !ES_LEGITIMATE_MATCHES.has(key));
    assert.deepEqual(unexpectedEn, [], `English keys still carrying untranslated Portuguese text: ${unexpectedEn.join(", ")}`);
    assert.deepEqual(unexpectedEs, [], `Spanish keys still carrying untranslated Portuguese text: ${unexpectedEs.join(", ")}`);
  });
});
