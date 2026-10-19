/**
 * The shape of a book on the 3D shelf follows its cover, like real books on a real shelf: the
 * face keeps its width and takes its height from the cover's proportion, so the cover fits
 * the face exactly (object-fit: contain) with no band and no crop. Very wide or very narrow
 * covers stop at the limits below and sit on their own blurred backdrop instead.
 */
export const SHELF_RATIO_MIN = 0.6;
export const SHELF_RATIO_MAX = 0.78;
export const SHELF_RATIO_DEFAULT = 2 / 3;

/** Width over height of the cover, limited to what the shelf can hold; a missing or invalid
 *  size gives the default shape. */
export function shelfCoverRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return SHELF_RATIO_DEFAULT;
  return Math.min(SHELF_RATIO_MAX, Math.max(SHELF_RATIO_MIN, width / height));
}

/** True when the cover's own shape is outside the shelf's limits: it needs the backdrop. */
export function coverNeedsBand(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  return Math.abs(shelfCoverRatio(width, height) - width / height) / (width / height) > .03;
}

export interface CoverRatioStore { getItem(key: string): string | null; setItem(key: string, value: string): void; }

function browserStore(): CoverRatioStore | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/**
 * The measured proportion of each book's cover, kept so the shelf opens already in the right
 * shape. It lives beside the library data but apart from `Book`: several paths rebuild a Book
 * from a subset of its fields, and a value kept there would be lost. A different cover image
 * (another signature) is measured again.
 */
export class CoverRatioCache {
  public static readonly shared = new CoverRatioCache();
  private readonly memory = new Map<string, string>();
  public constructor(private readonly store: CoverRatioStore | null = browserStore()) {}

  /** The cover's own width / height, if it was measured for this very cover image. */
  public get(bookId: string, cover: string): number | undefined {
    const key = this.key(bookId), raw = this.read(key);
    if (!raw) return undefined;
    const [signature, ratio] = raw.split("|");
    const value = Number(ratio);
    return signature === this.signature(cover) && Number.isFinite(value) && value > 0 ? value : undefined;
  }

  public set(bookId: string, cover: string, ratio: number): void {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    const key = this.key(bookId), value = `${this.signature(cover)}|${ratio.toFixed(4)}`;
    this.memory.set(key, value);
    try { this.store?.setItem(key, value); } catch { /* storage full or blocked: the memory copy still serves this session */ }
  }

  private read(key: string): string | null {
    try { return this.store?.getItem(key) ?? this.memory.get(key) ?? null; } catch { return this.memory.get(key) ?? null; }
  }
  private key(bookId: string): string { return `lumeo:cover-ratio:v1:${bookId}`; }
  private signature(cover: string): string { return `${cover.length}:${cover.slice(-40)}`; }
}
