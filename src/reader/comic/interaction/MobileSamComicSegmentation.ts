import { Capacitor, registerPlugin, type Plugin } from "@capacitor/core";
import type { ComicVisualContainer } from "./ComicContainerDetector";
import type { ComicPageAsset, ComicTextRegion, ComicTypography, ComicVisualElement } from "./ComicInteractionTypes";
import type { ComicTextPrompt } from "./ComicRegionOcr";
import { maskArea, readMaskShape, simplifyContour, traceMaskContour, type ComicMask } from "./ComicShapeMask";

interface NativePrompt { id: string; box: [number, number, number, number] }
interface NativeRegion {
  id: string; score: number; promptCoverage: number; maskSolidity: number; decoderMs: number;
  x: number; y: number; width: number; height: number; maskRle: string;
}
interface NativeResult {
  modelVersion: string; analysisWidth: number; analysisHeight: number;
  encoderMs: number; totalMs: number; peakEstimateBytes: number;
  javaHeapUsedBytes: number; nativeHeapAllocatedBytes: number; regions: NativeRegion[];
}
interface ComicSegmentationPlugin extends Plugin {
  segment(options: { imageBase64: string; prompts: NativePrompt[]; pageIndex: number; sourceWidth: number; sourceHeight: number }): Promise<NativeResult>;
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
  const scaleX = pageWidth / response.analysisWidth, scaleY = pageHeight / response.analysisHeight;
  const containers: ComicVisualContainer[] = [];
  const regions: ComicTextRegion[] = [];
  const elements: ComicVisualElement[] = [];
  for (const native of response.regions) {
    const prompt = byId.get(native.id); if (!prompt) continue;
    const crop = decodeMask(native.maskRle, native.width, native.height);
    const full = new Uint8Array(response.analysisWidth * response.analysisHeight);
    for (let y = 0; y < native.height; y++) full.set(crop.data.subarray(y * native.width, (y + 1) * native.width),
      (native.y + y) * response.analysisWidth + native.x);
    const traced = simplifyContour(traceMaskContour(crop), 1.5).map(point => ({ x: point.x + native.x, y: point.y + native.y }));
    if (traced.length < 3) continue;
    const reading = readMaskShape(crop, traced.map(point => ({ x: point.x - native.x, y: point.y - native.y })));
    const bbox = { x0: native.x * scaleX, y0: native.y * scaleY,
      x1: (native.x + native.width) * scaleX, y1: (native.y + native.height) * scaleY };
    const ink = { x0: prompt.bbox.x0, y0: prompt.bbox.y0, x1: prompt.bbox.x1, y1: prompt.bbox.y1 };
    const step = (scaleX + scaleY) / 2;
    const stencil = { data: full, width: response.analysisWidth, height: response.analysisHeight, step, x: 0, y: 0 };
    const typography: ComicTypography = { family: "comic", weight: "normal", italic: false, align: "center",
      capHeight: Math.max(1, prompt.bbox.y1 - prompt.bbox.y0) / pageHeight / Math.max(1, prompt.lines), lines: prompt.lines };
    const soundEffect = isCanonicalSoundEffect(prompt.text);
    const type = soundEffect ? "other" : reading.shape === "rectangle" ? "caption" : "speech";
    const container: ComicVisualContainer = {
      bbox, ink, contour: traced.map(point => ({ x: point.x * scaleX, y: point.y * scaleY })), stencil, artStencil: stencil,
      artBbox: bbox, type, shape: reading.shape, tail: reading.tail, styleConfidence: native.score,
      backgroundColor: "#ffffff", textColor: "#000000", typography,
      inkShare: .2, blockShare: .3, runs: 100, glyphShare: 1, bands: prompt.lines, darkOnLight: true,
    };
    const visual = normalize(bbox, pageWidth, pageHeight), text = normalize(ink, pageWidth, pageHeight);
    // A fully segmented POW/CABUM/ZZZ is useful structural context but is never a speech
    // button. Keeping it in the BODY tree prevents an OCR prompt from being mistaken for
    // dialogue, while preserving its mask-derived position for diagnostics.
    if (soundEffect) {
      elements.push({ id: `effect-${native.id}`, kind: "effect", confidence: native.score, interactive: false,
        zIndex: 200 + elements.length, ...visual, memberships: [], overflowSceneIds: [], reason: "sound-effect" });
      continue;
    }
    containers.push(container);
    regions.push({
      id: native.id, pageIndex, text: prompt.text, ...visual, hitBounds: visual, visualBounds: visual, textBounds: text,
      type, shape: reading.shape, tailDirection: reading.tail, tail: reading.tail,
      ocrConfidence: prompt.confidence, recognitionStatus: prompt.confidence >= .65 ? "recognized" : "needs-review",
      reviewReasons: prompt.confidence >= .65 ? [] : ["low-confidence"], typography,
      styleConfidence: native.score, segmentationConfidence: native.score,
      segmentationNeedsReview: native.score < .88 || native.promptCoverage < .9,
      segmentationMethod: "mobilesam-v1", needsReview: prompt.confidence < .65,
      contour: traced.map(point => ({ x: point.x / response.analysisWidth, y: point.y / response.analysisHeight })),
    });
  }
  console.info(JSON.stringify({ event: "COMIC_ML_PAGE_READY", pageIndex, modelVersion: response.modelVersion,
    prompts: prompts.length, accepted: regions.length, effects: elements.length, encoderMs: response.encoderMs, totalMs: response.totalMs,
    peakEstimateBytes: response.peakEstimateBytes, javaHeapUsedBytes: response.javaHeapUsedBytes,
    nativeHeapAllocatedBytes: response.nativeHeapAllocatedBytes }));
  return { regions, containers, elements, modelVersion: response.modelVersion, encoderMs: response.encoderMs,
    totalMs: response.totalMs, peakEstimateBytes: response.peakEstimateBytes };
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
