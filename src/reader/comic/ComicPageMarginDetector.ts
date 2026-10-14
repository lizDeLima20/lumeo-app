import type { ComicRect } from "./ComicLayout";

export interface ComicPixelPage { width: number; height: number; data: Uint8ClampedArray; }

const FULL_PAGE: ComicRect = { x: 0, y: 0, width: 1, height: 1 };

/** Conservatively removes only continuous, near-white outer columns. A dark mark anywhere
 * in a column protects it, so frames, lettering and artwork are preferred over a tighter
 * crop. Vertical bounds remain untouched: the feature is for scanner gutters, not content
 * reframing. */
export function comicHorizontalContentBounds(page: ComicPixelPage): ComicRect {
  if (page.width < 24 || page.height < 24 || page.data.length < page.width * page.height * 4) return FULL_PAGE;
  const columnHasInk = (x: number): boolean => {
    let ink = 0;
    for (let y = 0; y < page.height; y++) {
      const offset = (y * page.width + x) * 4;
      const red = page.data[offset]!, green = page.data[offset + 1]!, blue = page.data[offset + 2]!, alpha = page.data[offset + 3]!;
      if (alpha > 24 && (red < 238 || green < 238 || blue < 238 || Math.max(red, green, blue) - Math.min(red, green, blue) > 16)) {
        if (++ink >= 2) return true;
      }
    }
    return false;
  };
  let left = 0, right = page.width - 1;
  while (left < right && !columnHasInk(left)) left++;
  while (right > left && !columnHasInk(right)) right--;
  // One sampled source column is retained as a safety guard around the first real mark.
  left = Math.max(0, left - 1); right = Math.min(page.width - 1, right + 1);
  const removed = page.width - (right - left + 1);
  if (removed < Math.max(2, page.width * .006) || right - left + 1 < page.width * .5) return FULL_PAGE;
  return { x: left / page.width, y: 0, width: (right - left + 1) / page.width, height: 1 };
}

/** Downsamples first, keeping analysis bounded even for high-DPI PDF and archive pages. */
export function detectComicPageContent(canvas: HTMLCanvasElement): ComicRect {
  try {
    const scale = Math.min(1, 512 / Math.max(1, canvas.width));
    const width = Math.max(24, Math.round(canvas.width * scale));
    const height = Math.max(24, Math.round(canvas.height * scale));
    const sample = document.createElement("canvas"); sample.width = width; sample.height = height;
    const context = sample.getContext("2d", { willReadFrequently: true });
    if (!context) return FULL_PAGE;
    context.drawImage(canvas, 0, 0, width, height);
    return comicHorizontalContentBounds(context.getImageData(0, 0, width, height));
  } catch { return FULL_PAGE; }
}
