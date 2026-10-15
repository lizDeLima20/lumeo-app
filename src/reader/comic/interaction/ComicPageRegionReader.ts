import { detectComicContainersMultiScale, comicEncodedMatchesCanvas } from "./ComicMultiScaleDetector";
import { comicGroupConnectedContainers } from "./ComicContainerGrouping";
import { comicReadingOrder, type ComicReadingDirection } from "./ComicReadingOrder";
import { comicPrepareCrop } from "./ComicRegionCrop";
import type { ComicPageAsset, ComicPageHierarchy, ComicTextRegion } from "./ComicInteractionTypes";
import { comicCreateOriginalCutouts } from "./ComicOriginalCutoutSource";
import type { ComicRegionOcr } from "./ComicRegionOcr";
import type { ComicStencil } from "./ComicContainerDetector";
import type { ComicStageRecorder } from "./ComicStageTimer";
import { mobileSamAvailable, segmentComicPageWithMobileSam } from "./MobileSamComicSegmentation";
import { Capacitor } from "@capacitor/core";
import { comicBuildVisualHierarchy, comicHierarchySample } from "./ComicVisualHierarchy";

export interface ComicPageAnalysis { regions: ComicTextRegion[]; hierarchy?: ComicPageHierarchy; }

/** Everything one rendered page goes through: find the containers in colour, then read
 *  each of them from a crop prepared for its own background.
 *
 *  The rendered canvas is only ever read from here - the packaged page image keeps the
 *  artist's colours exactly as they were. */
export async function comicReadPageAnalysis(canvas: HTMLCanvasElement, pageIndex: number, ocr: ComicRegionOcr,
  signal?: AbortSignal, direction: ComicReadingDirection = "ltr", assets?: ComicPageAsset[],
  timer?: ComicStageRecorder, encoded?: ComicPageAsset): Promise<ComicPageAnalysis> {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas indisponivel para leitura de pagina de HQ.");
  // Android uses OCR only as a set of prompts. The contours, masks and touch targets are
  // MobileSAM instances produced by ONNX Runtime in the native process.
  if (encoded && Capacitor.getPlatform() === "android") {
    if (!mobileSamAvailable()) {
      console.error(JSON.stringify({ event: "COMIC_ML_NATIVE_UNAVAILABLE", pageIndex }));
      return { regions: [] };
    }
    const whole = comicEncodedMatchesCanvas(encoded, canvas.width, canvas.height)
      ? new Blob([new Uint8Array(encoded.data)], { type: encoded.mimeType }) : canvas;
    const prompts = await ocr.locateTextPrompts(whole, pageIndex, signal, timer);
    if (!prompts.length) {
      console.warn(JSON.stringify({ event: "COMIC_ML_NO_TEXT_PROMPTS", pageIndex }));
      return { regions: [] };
    }
    try {
      const ml = await segmentComicPageWithMobileSam(encoded, prompts, pageIndex, canvas.width, canvas.height);
      if (assets && ml.regions.length) assets.push(...await comicCreateOriginalCutouts(canvas, ml.regions, ml.containers, encoded));
      if (!ml.regions.length) console.warn(JSON.stringify({ event: "COMIC_ML_NO_VALID_MASKS", pageIndex, prompts: prompts.length }));
      const hierarchy = comicBuildVisualHierarchy(pageIndex, comicHierarchySample(canvas), ml.containers, ml.regions, canvas.width, canvas.height, ml.elements);
      const regions = comicReadingOrder(ml.regions, direction);
      console.info(JSON.stringify({ event: "COMIC_VISUAL_HIERARCHY_READY", pageIndex, scenes: hierarchy.scenes.length,
        regions: regions.length, overflow: regions.filter(region => region.hierarchy?.overlapsSceneIds.length).length }));
      return { regions, hierarchy };
    } catch (error) {
      // A missing balloon is safer than reviving the detector that could turn a panel or
      // character into a target. The page remains completely readable and the failure is
      // available in logcat for a later, versioned reprocessing pass.
      console.error(JSON.stringify({ event: "COMIC_ML_PAGE_FAILED", pageIndex,
        reason: error instanceof Error ? error.message : "unknown" }));
      return { regions: [] };
    }
  }
  // Only the legacy fallback needs a full RGBA copy of the page. Keeping this after the
  // native ML branch avoids holding another high-resolution bitmap while ONNX is active.
  const page = timer
    ? await timer.step("BITMAP_CREATE", () => context.getImageData(0, 0, canvas.width, canvas.height))
    : context.getImageData(0, 0, canvas.width, canvas.height);
  const found = timer
    ? await timer.step("CONTAINER_DETECTION", () => detectComicContainersMultiScale(page, signal))
    : await detectComicContainersMultiScale(page, signal);
  signal?.throwIfAborted();
  // Two balloons joined only by a connector too thin to share a flood fill are still one
  // piece of speech - grouped once, here, so OCR and the cutout that follows agree on
  // exactly the same containers: a click on either lobe opens both, and the mask cut for
  // them is the union the reader actually sees, not a stale pair of smaller shapes.
  const containers = comicGroupConnectedContainers(found);
  // Handed a canvas, the recognition library encodes a PNG of it first - and on a phone a
  // single PNG encode costs seconds, which every candidate on the page then pays. The page
  // was already encoded once for the package, so those bytes are reused as they are, and
  // each crop is encoded the same way the page was: quick to write, small to hand over.
  const scratch = document.createElement("canvas");
  const whole = comicEncodedMatchesCanvas(encoded, canvas.width, canvas.height) ? new Blob([new Uint8Array(encoded!.data)], { type: encoded!.mimeType }) : canvas;
  try {
    const regions = await ocr.recognize(whole, canvas.width, canvas.height, pageIndex, signal, containers, ({ bounds, plan, stencil, background }) => {
      const cropStarted = timer ? Date.now() : 0;
      const width = Math.max(1, bounds.x1 - bounds.x0), height = Math.max(1, bounds.y1 - bounds.y0);
      const source = new ImageData(width, height);
      for (let y = 0; y < height; y++) {
        const from = ((bounds.y0 + y) * page.width + bounds.x0) * 4;
        source.data.set(page.data.subarray(from, from + width * 4), y * width * 4);
      }
      if (stencil) paintOutside(source, bounds, stencil, background);
      const prepared = comicPrepareCrop(source, plan);
      scratch.width = prepared.width; scratch.height = prepared.height;
      scratch.getContext("2d")!.putImageData(prepared, 0, 0);
      const image = comicEncodedCrop(scratch);
      timer?.add("REGION_CROP", Date.now() - cropStarted);
      return image;
    }, timer);
    if (assets) {
      const cutouts = timer
        ? await timer.step("MASK_GENERATION", () => comicCreateOriginalCutouts(canvas, regions, containers, encoded))
        : await comicCreateOriginalCutouts(canvas, regions, containers, encoded);
      assets.push(...cutouts);
    }
    signal?.throwIfAborted();
    // Reading order is the last word on a page, once every region on it is known.
    return { regions: comicReadingOrder(regions, direction) };
  } finally { scratch.width = scratch.height = 0; }
}

/** Compatibility entrypoint used by diagnostic pages and existing callers that need only
 * regions. Converters use `comicReadPageAnalysis` so hierarchy data is persisted. */
export async function comicReadPageRegions(canvas: HTMLCanvasElement, pageIndex: number, ocr: ComicRegionOcr,
  signal?: AbortSignal, direction: ComicReadingDirection = "ltr", assets?: ComicPageAsset[],
  timer?: ComicStageRecorder, encoded?: ComicPageAsset): Promise<ComicTextRegion[]> {
  return (await comicReadPageAnalysis(canvas, pageIndex, ocr, signal, direction, assets, timer, encoded)).regions;
}

/** Paints everything outside the container's silhouette with the container's own colour,
 *  so recognition sees one balloon and nothing of what it was drawn against. */
function paintOutside(crop: ImageData, bounds: { x0: number; y0: number }, stencil: ComicStencil, background?: string): void {
  const colour = parse(background) ?? { r: 255, g: 255, b: 255 };
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    const cellX = Math.floor((bounds.x0 + x - stencil.x) / stencil.step);
    const cellY = Math.floor((bounds.y0 + y - stencil.y) / stencil.step);
    const inside = cellX >= 0 && cellY >= 0 && cellX < stencil.width && cellY < stencil.height
      && stencil.data[cellY * stencil.width + cellX] === 1;
    if (inside) continue;
    const offset = (y * crop.width + x) * 4;
    crop.data[offset] = colour.r; crop.data[offset + 1] = colour.g; crop.data[offset + 2] = colour.b; crop.data[offset + 3] = 255;
  }
}

function parse(colour?: string): { r: number; g: number; b: number } | null {
  if (!colour || !/^#[0-9a-f]{6}$/i.test(colour)) return null;
  const value = Number.parseInt(colour.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** A prepared crop, encoded the way the page itself is. Falls back to the canvas when the
 *  browser cannot write WebP, which only costs what it used to cost. */
function comicEncodedCrop(canvas: HTMLCanvasElement): Promise<Blob | HTMLCanvasElement> {
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob ?? canvas), "image/webp", .95));
}
