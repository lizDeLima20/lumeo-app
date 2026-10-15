import { Capacitor, registerPlugin, type Plugin } from "@capacitor/core";
import type { ComicVisualContainer } from "./ComicContainerDetector";
import type { ComicPageAsset, ComicTextRegion, ComicTypography, ComicVisualElement } from "./ComicInteractionTypes";
import type { ComicTextPrompt } from "./ComicRegionOcr";
import { maskArea, readMaskShape, simplifyContour, traceMaskContour, type ComicMask } from "./ComicShapeMask";

interface NativePrompt { id: string; box: [number, number, number, number] }
interface NativeRegion {
  id: string; score: number; promptCoverage: number; maskSolidity: number; decoderMs: number;
  x: number; y: number; width: number; height: number; maskRle: string;
  /** Balloon-first only: detector confidence, detected text block (analysis space), split part. */
  detScore?: number; textBox?: [number, number, number, number]; split?: boolean;
}
interface NativeResult {
  modelVersion: string; analysisWidth: number; analysisHeight: number;
  encoderMs: number; totalMs: number; peakEstimateBytes: number;
  javaHeapUsedBytes: number; nativeHeapAllocatedBytes: number; regions: NativeRegion[];
  detectorMs?: number; detected?: number; split?: number;
}
interface ComicSegmentationPlugin extends Plugin {
  segment(options: { imageBase64: string; prompts: NativePrompt[]; pageIndex: number; sourceWidth: number; sourceHeight: number }): Promise<NativeResult>;
  segmentBalloons(options: { imageBase64: string; prompts: NativePrompt[]; pageIndex: number; sourceWidth: number; sourceHeight: number }): Promise<NativeResult>;
}

const NativeComicSegmentation = registerPlugin<ComicSegmentationPlugin>("ComicSegmentation");

export interface MobileSamPageResult {
  regions: ComicTextRegion[];
  containers: ComicVisualContainer[];
  /** Includes non-interactive observations such as canonical sound effects. */
  elements: ComicVisualElement[];
  modelVersion: string;
  encoderMs: number;
  totalMs: number;
  peakEstimateBytes: number;
}

export function mobileSamAvailable(): boolean {
  return typeof window !== "undefined" && Capacitor.getPlatform() === "android"
    && Capacitor.isPluginAvailable("ComicSegmentation");
}

/** Run the native MobileSAM pair. OCR boxes are prompts only; masks and contours are
 * produced by the model, decoded into the reader's existing container representation. */
export async function segmentComicPageWithMobileSam(asset: ComicPageAsset, prompts: readonly ComicTextPrompt[],
  pageIndex: number, pageWidth: number, pageHeight: number): Promise<MobileSamPageResult> {
  if (!mobileSamAvailable()) throw new Error("COMIC_ML_NATIVE_UNAVAILABLE");
  const response = await NativeComicSegmentation.segment({
    imageBase64: await bytesToBase64(asset.data, asset.mimeType),
    pageIndex,
    // The boxes below are in this canvas's pixels; the plugin maps them from this space.
    sourceWidth: pageWidth, sourceHeight: pageHeight,
    prompts: prompts.map(prompt => ({ id: prompt.id,
      box: [prompt.bbox.x0, prompt.bbox.y0, prompt.bbox.x1, prompt.bbox.y1] })),
  });
  const byId = new Map(prompts.map(prompt => [prompt.id, prompt]));
  const items = response.regions.flatMap(native => {
    const prompt = byId.get(native.id); if (!prompt) return [];
    return [{ native, id: native.id, text: prompt.text, ink: prompt.bbox, lines: prompt.lines, confidence: prompt.confidence }];
  });
  const { regions, containers, elements } = buildRegions(response, items, pageIndex, pageWidth, pageHeight);
  console.info(JSON.stringify({ event: "COMIC_ML_PAGE_READY", pageIndex, modelVersion: response.modelVersion,
    prompts: prompts.length, accepted: regions.length, effects: elements.length, encoderMs: response.encoderMs, totalMs: response.totalMs,
    peakEstimateBytes: response.peakEstimateBytes, javaHeapUsedBytes: response.javaHeapUsedBytes,
    nativeHeapAllocatedBytes: response.nativeHeapAllocatedBytes }));
  return { regions, containers, elements, modelVersion: response.modelVersion, encoderMs: response.encoderMs,
    totalMs: response.totalMs, peakEstimateBytes: response.peakEstimateBytes };
}

interface RegionItem { native: NativeRegion; id: string; text: string; ink: { x0: number; y0: number; x1: number; y1: number }; lines: number; confidence: number; }

/** Turns native masks into the reader's containers and regions. Every pixel of the contour,
 *  hit area and cutout stencil comes from the mask; the item only supplies text. */
function buildRegions(response: NativeResult, items: readonly RegionItem[], pageIndex: number, pageWidth: number, pageHeight: number) {
  const scaleX = pageWidth / response.analysisWidth, scaleY = pageHeight / response.analysisHeight;
  const containers: ComicVisualContainer[] = [];
  const regions: ComicTextRegion[] = [];
  const elements: ComicVisualElement[] = [];
  for (const { native, id, text: words, ink, lines, confidence } of items) {
    const crop = decodeMask(native.maskRle, native.width, native.height);
    const full = new Uint8Array(response.analysisWidth * response.analysisHeight);
    for (let y = 0; y < native.height; y++) full.set(crop.data.subarray(y * native.width, (y + 1) * native.width),
      (native.y + y) * response.analysisWidth + native.x);
    const traced = simplifyContour(traceMaskContour(crop), 1.5).map(point => ({ x: point.x + native.x, y: point.y + native.y }));
    if (traced.length < 3) continue;
    const reading = readMaskShape(crop, traced.map(point => ({ x: point.x - native.x, y: point.y - native.y })));
    const bbox = { x0: native.x * scaleX, y0: native.y * scaleY,
      x1: (native.x + native.width) * scaleX, y1: (native.y + native.height) * scaleY };
    const step = (scaleX + scaleY) / 2;
    const stencil = { data: full, width: response.analysisWidth, height: response.analysisHeight, step, x: 0, y: 0 };
    const typography: ComicTypography = { family: "comic", weight: "normal", italic: false, align: "center",
      capHeight: Math.max(1, ink.y1 - ink.y0) / pageHeight / Math.max(1, lines), lines };
    const soundEffect = isCanonicalSoundEffect(words);
    const type = soundEffect ? "other" : reading.shape === "rectangle" ? "caption" : "speech";
    const container: ComicVisualContainer = {
      bbox, ink, contour: traced.map(point => ({ x: point.x * scaleX, y: point.y * scaleY })), stencil, artStencil: stencil,
      artBbox: bbox, type, shape: reading.shape, tail: reading.tail, styleConfidence: native.score,
      backgroundColor: "#ffffff", textColor: "#000000", typography,
      inkShare: .2, blockShare: .3, runs: 100, glyphShare: 1, bands: lines, darkOnLight: true,
    };
    const visual = normalize(bbox, pageWidth, pageHeight), text = normalize(ink, pageWidth, pageHeight);
    // A fully segmented POW/CABUM/ZZZ is useful structural context but is never a speech
    // button. Keeping it in the BODY tree prevents an OCR prompt from being mistaken for
    // dialogue, while preserving its mask-derived position for diagnostics.
    if (soundEffect) {
      elements.push({ id: `effect-${id}`, kind: "effect", confidence: native.score, interactive: false,
        zIndex: 200 + elements.length, ...visual, memberships: [], overflowSceneIds: [], reason: "sound-effect" });
      continue;
    }
    const read = words.trim().length > 0, recognized = read && confidence >= .65;
    containers.push(container);
    regions.push({
      id, pageIndex, text: words, ...visual, hitBounds: visual, visualBounds: visual, textBounds: text,
      type, shape: reading.shape, tailDirection: reading.tail, tail: reading.tail,
      ocrConfidence: read ? confidence : 0, recognitionStatus: recognized ? "recognized" : "needs-review",
      reviewReasons: recognized ? [] : [read ? "low-confidence" : "no-ocr-text"], typography,
      styleConfidence: native.score, segmentationConfidence: native.score,
      segmentationNeedsReview: native.score < .88 || native.promptCoverage < .9,
      segmentationMethod: "mobilesam-v1", needsReview: !recognized,
      contour: traced.map(point => ({ x: point.x / response.analysisWidth, y: point.y / response.analysisHeight })),
    });
  }
  return { regions, containers, elements };
}

/**
 * Balloon-first page: the native detector finds each balloon by its shape (any colour, read
 * or not), MobileSAM cuts it out whole, and the OCR lines whose centre lies inside a balloon's
 * mask become its text, in reading order. A balloon OCR could not read is still a complete,
 * clickable cutout; it only has no text and is marked for review.
 */
export async function segmentComicBalloonsWithMobileSam(asset: ComicPageAsset, prompts: readonly ComicTextPrompt[],
  pageIndex: number, pageWidth: number, pageHeight: number): Promise<MobileSamPageResult> {
  if (!mobileSamAvailable()) throw new Error("COMIC_ML_NATIVE_UNAVAILABLE");
  const response = await NativeComicSegmentation.segmentBalloons({
    imageBase64: await bytesToBase64(asset.data, asset.mimeType),
    pageIndex, sourceWidth: pageWidth, sourceHeight: pageHeight,
    prompts: prompts.map(prompt => ({ id: prompt.id, box: [prompt.bbox.x0, prompt.bbox.y0, prompt.bbox.x1, prompt.bbox.y1] })),
  });
  const scaleX = pageWidth / response.analysisWidth, scaleY = pageHeight / response.analysisHeight;
  const items: RegionItem[] = response.regions.map(native => {
    const mine = comicPromptsInsideMask(native, scaleX, scaleY, prompts);
    const box = native.textBox
      ? { x0: native.textBox[0] * scaleX, y0: native.textBox[1] * scaleY, x1: native.textBox[2] * scaleX, y1: native.textBox[3] * scaleY }
      : { x0: native.x * scaleX, y0: native.y * scaleY, x1: (native.x + native.width) * scaleX, y1: (native.y + native.height) * scaleY };
    // The cutout keeps the detected text block intact; OCR lines only widen it if they reach further.
    const ink = mine.reduce((value, prompt) => ({ x0: Math.min(value.x0, prompt.bbox.x0), y0: Math.min(value.y0, prompt.bbox.y0),
      x1: Math.max(value.x1, prompt.bbox.x1), y1: Math.max(value.y1, prompt.bbox.y1) }), box);
    const confidence = mine.length ? mine.reduce((sum, prompt) => sum + prompt.confidence, 0) / mine.length : 0;
    return { native, id: `p${pageIndex + 1}-${native.id}`, text: mine.map(prompt => prompt.text.trim()).join("\n"),
      ink, lines: Math.max(1, mine.reduce((sum, prompt) => sum + prompt.lines, 0)), confidence };
  });
  const { regions, containers, elements } = buildRegions(response, items, pageIndex, pageWidth, pageHeight);
  console.info(JSON.stringify({ event: "COMIC_ML_BALLOONS_READY", pageIndex, modelVersion: response.modelVersion,
    detected: response.detected ?? regions.length, accepted: regions.length, split: response.split ?? 0, effects: elements.length,
    withoutText: regions.filter(region => !region.text.trim()).length, ocrLines: prompts.length,
    detectorMs: response.detectorMs, encoderMs: response.encoderMs, totalMs: response.totalMs,
    javaHeapUsedBytes: response.javaHeapUsedBytes, nativeHeapAllocatedBytes: response.nativeHeapAllocatedBytes }));
  return { regions, containers, elements, modelVersion: response.modelVersion, encoderMs: response.encoderMs,
    totalMs: response.totalMs, peakEstimateBytes: response.peakEstimateBytes };
}

/** OCR lines whose centre lies inside the balloon's mask, top to bottom then left to right
 *  (lines of the same row within half a line height read left to right). */
export function comicPromptsInsideMask(native: Pick<NativeRegion, "x" | "y" | "width" | "height" | "maskRle">,
  scaleX: number, scaleY: number, prompts: readonly ComicTextPrompt[]): ComicTextPrompt[] {
  const crop = decodeMask(native.maskRle, native.width, native.height);
  const inside = prompts.filter(prompt => {
    const x = Math.floor((prompt.bbox.x0 + prompt.bbox.x1) / 2 / scaleX) - native.x;
    const y = Math.floor((prompt.bbox.y0 + prompt.bbox.y1) / 2 / scaleY) - native.y;
    return x >= 0 && y >= 0 && x < crop.width && y < crop.height && crop.data[y * crop.width + x] === 1;
  });
  return inside.sort((a, b) => {
    const rowTolerance = Math.min(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0) / 2;
    return Math.abs(a.bbox.y0 - b.bbox.y0) <= rowTolerance ? a.bbox.x0 - b.bbox.x0 : a.bbox.y0 - b.bbox.y0;
  });
}

/** Conservative lexical safeguard, not a pretend visual classifier.  We only remove
 * unambiguous, standalone comic sound effects; all other OCR text remains eligible for
 * MobileSAM interaction and will be rejected only by mask validation. */
function isCanonicalSoundEffect(text: string): boolean {
  const token = text.trim().toLocaleUpperCase("pt-BR").replace(/[^\p{L}\p{N}]/gu, "");
  return /^(POW|CABUM|KABUM|BANG|BOOM|CRASH|PLOFT|SOC|TUM|ZZZ+)$/.test(token);
}

function normalize(box: { x0: number; y0: number; x1: number; y1: number }, width: number, height: number) {
  return { x: Math.max(0, box.x0 / width), y: Math.max(0, box.y0 / height),
    width: Math.min(1, box.x1 / width) - Math.max(0, box.x0 / width),
    height: Math.min(1, box.y1 / height) - Math.max(0, box.y0 / height) };
}

/** Alternating zero/one run lengths, unsigned LEB128. The first run is always zero. */
export function decodeMask(encoded: string, width: number, height: number): ComicMask {
  const binary = atob(encoded), data = new Uint8Array(width * height);
  let offset = 0, cursor = 0, value = 0;
  while (offset < binary.length && cursor < data.length) {
    let count = 0, shift = 0, byte: number;
    do { byte = binary.charCodeAt(offset++); count |= (byte & 127) << shift; shift += 7; } while ((byte & 128) !== 0 && offset < binary.length);
    if (value) data.fill(1, cursor, Math.min(data.length, cursor + count));
    cursor += count; value ^= 1;
  }
  if (cursor !== data.length || maskArea({ width, height, data }) === 0) throw new Error("COMIC_ML_INVALID_MASK");
  return { width, height, data };
}

async function bytesToBase64(bytes: Uint8Array, mime: string): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: mime }));
  });
  return url.slice(url.indexOf(",") + 1);
}
