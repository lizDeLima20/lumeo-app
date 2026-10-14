export type ComicLayoutMode = "single" | "spread";

export interface ComicRect { x: number; y: number; width: number; height: number; }
export interface ComicPageFit extends ComicRect {
  viewportAspectRatio: number;
  pageAspectRatio: number;
  scale: number;
  /** Normalized source area actually presented. */
  contentBounds?: ComicRect;
}

/** The one geometry a comic is drawn with. REST, DRAG, ANIMATION, COMPLETE and CANCEL all
 *  read these same numbers, so a page can never change size when a gesture starts or ends.
 *
 *  Both modes share one shape: the page that turns sits to the right of `spineX`. On a
 *  phone that page IS the screen's page and there is no left slot; on the desktop the left
 *  slot mirrors it across the spine - an open book. */
export interface ComicGeometry {
  mode: ComicLayoutMode;
  width: number;
  height: number;
  spineX: number;
  top: number;
  pageWidth: number;
  pageHeight: number;
}

export interface ComicLayoutEnvironment { native: boolean; finePointer: boolean; }
export type ComicSpreadPresentation = "desktop" | "native-landscape";

/** Space the desktop spread leaves around the book: room for the Lumeo round buttons on
 *  top and the arrows at the sides, so the book is never a picture wall-to-wall. */
export const SPREAD_MARGINS = { top: 58, bottom: 26, side: 76 } as const;
/** Native landscape reserves a true side gutter for the vertical reader chrome. The book
 * targets seventy percent of the viewport, but its original page ratio always wins when a
 * short phone cannot physically fit two full portrait pages at that width. */
export const NATIVE_LANDSCAPE_SPREAD = { sideShare: .15, minSide: 52, top: 8, bottom: 8 } as const;

export class ComicLayout {
  /** A native phone opens the existing two-page reader only in landscape. Portrait stays
   * single-page; desktop still requires a wide fine-pointer surface. */
  public static mode(width: number, height: number, environment: ComicLayoutEnvironment): ComicLayoutMode {
    if (environment.native) return width > height ? "spread" : "single";
    return environment.finePointer && width >= 1024 && width > height ? "spread" : "single";
  }

  /** `aspect` is page width / page height, shared by the whole comic. */
  public static geometry(mode: ComicLayoutMode, width: number, height: number, aspect: number, presentation: ComicSpreadPresentation = "desktop"): ComicGeometry {
    const ratio = aspect > 0 && Number.isFinite(aspect) ? aspect : 2 / 3;
    if (mode === "single") {
      // Contain: the largest page of this proportion that fits; only the residue left by
      // the proportion itself is background.
      const [pageWidth, pageHeight] = ComicLayout.fit(width, height, ratio);
      return { mode, width, height, pageWidth, pageHeight,
        spineX: Math.round((width - pageWidth) / 2), top: Math.round((height - pageHeight) / 2) };
    }
    const nativeLandscape = presentation === "native-landscape";
    // A very narrow landscape window still needs a real tap target plus its safe inset;
    // ordinary phones retain the requested 15% gutters exactly.
    const side = nativeLandscape ? Math.max(width * NATIVE_LANDSCAPE_SPREAD.sideShare, NATIVE_LANDSCAPE_SPREAD.minSide) : SPREAD_MARGINS.side;
    const topMargin = nativeLandscape ? NATIVE_LANDSCAPE_SPREAD.top : SPREAD_MARGINS.top;
    const bottomMargin = nativeLandscape ? NATIVE_LANDSCAPE_SPREAD.bottom : SPREAD_MARGINS.bottom;
    const availableWidth = Math.max(1, width - side * 2);
    const availableHeight = Math.max(1, height - topMargin - bottomMargin);
    const [pageWidth, pageHeight] = ComicLayout.fit(Math.floor(availableWidth / 2), availableHeight, ratio);
    return { mode, width, height, pageWidth, pageHeight, spineX: Math.round(width / 2),
      top: Math.round(topMargin + (availableHeight - pageHeight) / 2) };
  }

  /** The side that limits keeps its full length; only the other one is derived. */
  private static fit(width: number, height: number, ratio: number): [number, number] {
    return width / height > ratio
      ? [Math.max(1, Math.round(height * ratio)), Math.max(1, Math.round(height))]
      : [Math.max(1, Math.round(width)), Math.max(1, Math.round(width / ratio))];
  }

  /** The slot a page occupies: "right" is the turning side in both modes. */
  public static slot(geometry: ComicGeometry, side: "left" | "right"): ComicRect {
    const x = side === "right" ? geometry.spineX : geometry.spineX - geometry.pageWidth;
    return { x, y: geometry.top, width: geometry.pageWidth, height: geometry.pageHeight };
  }

  /** Where a bitmap of `width x height` is drawn inside `slot`: contained, centred. A page
   *  whose proportions differ from the comic's is letterboxed, never stretched or cut. */
  public static contain(slot: ComicRect, width: number, height: number): ComicRect {
    if (!width || !height) return slot;
    return ComicLayout.presentationFit(slot, width, height);
  }

  public static presentationFit(slot: ComicRect, width: number, height: number, contentBounds?: ComicRect): ComicPageFit {
    const bounds = contentBounds ?? { x: 0, y: 0, width: 1, height: 1 };
    const contentWidth = Math.max(1, width * bounds.width), contentHeight = Math.max(1, height * bounds.height);
    const scale = Math.min(slot.width / contentWidth, slot.height / contentHeight);
    const drawnWidth = contentWidth * scale, drawnHeight = contentHeight * scale;
    return { x: slot.x + (slot.width - drawnWidth) / 2, y: slot.y + (slot.height - drawnHeight) / 2, width: drawnWidth, height: drawnHeight,
      viewportAspectRatio: slot.width / slot.height, pageAspectRatio: contentWidth / contentHeight, scale, contentBounds };
  }

  /** The comic's page proportion: the median of the sampled pages, so one odd page (a
   *  double splash, a cover with flaps) cannot resize the book for all the others. */
  public static aspect(samples: readonly number[]): number {
    const valid = samples.filter(value => value > 0 && Number.isFinite(value)).sort((a, b) => a - b);
    if (!valid.length) return 2 / 3;
    return valid[Math.floor((valid.length - 1) / 2)] ?? 2 / 3;
  }
}
