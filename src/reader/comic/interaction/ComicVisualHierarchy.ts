import type { ComicVisualContainer } from "./ComicContainerDetector";
import type { ComicPageHierarchy, ComicRegionHierarchy, ComicScene, ComicTailDirection, ComicTextRegion, ComicVisualElement, NormalizedBounds } from "./ComicInteractionTypes";

interface PixelSource { width: number; height: number; data: Uint8ClampedArray; }

/** Rounding slack allowed on a share in [0, 1]. Normalized geometry is a few float
 *  operations deep, so a box wholly inside a scene can measure 1.0000000000000002; any
 *  real geometric error is many orders of magnitude larger than this. */
export const COMIC_SHARE_TOLERANCE = 1e-9;

/** Snaps a share that is within rounding of 0 or 1 (on either side) onto that bound. Anything further
 *  out (or not finite) is returned unchanged so the validator still rejects it. */
export function normalizeComicShare(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) <= COMIC_SHARE_TOLERANCE) return 0;
  if (Math.abs(value - 1) <= COMIC_SHARE_TOLERANCE) return 1;
  return value;
}

/** Read a small structural view only. The full-resolution bitmap stays reserved for the
 * original balloon cutouts, while panel/gutter analysis needs far fewer pixels. */
export function comicHierarchySample(canvas: HTMLCanvasElement, longestSide = 512): PixelSource {
  const scale = Math.min(1, longestSide / Math.max(canvas.width, canvas.height));
  const width = Math.max(1, Math.round(canvas.width * scale)), height = Math.max(1, Math.round(canvas.height * scale));
  const sample = document.createElement("canvas"); sample.width = width; sample.height = height;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas indisponível para hierarquia visual.");
  context.drawImage(canvas, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  sample.width = sample.height = 0;
  return image;
}

/**
 * Builds a conservative scene/balloon tree. It deliberately does not crop a balloon to a
 * panel: a dialogue balloon may visibly overflow its originating panel. MobileSAM masks
 * remain the authoritative geometry; panel analysis supplies only relationships.
 */
export function comicBuildVisualHierarchy(pageIndex: number, image: PixelSource,
  containers: readonly ComicVisualContainer[], regions: ComicTextRegion[], pageWidth = image.width, pageHeight = image.height,
  elements: ComicVisualElement[] = []): ComicPageHierarchy {
  const scenes = comicDetectScenes(image, pageIndex);
  const byId = new Map(containers.map((container, index) => [regions[index]?.id, container]));
  const children: Record<string, string[]> = Object.fromEntries(scenes.map(scene => [scene.id, []]));
  regions.forEach((region, index) => {
    const container = byId.get(region.id) ?? containers[index];
    const memberships = container ? membershipsFor(container, scenes, pageWidth, pageHeight) : boundsMemberships(region, scenes);
    const dominant = memberships[0] ?? { sceneId: scenes[0]!.id, maskShare: 1 };
    const tailSceneCandidate = container ? tailCandidate(container, scenes, pageWidth, pageHeight) : undefined;
    const overlapsSceneIds = memberships.filter(member => member.sceneId !== dominant.sceneId && member.maskShare > .01).map(member => member.sceneId);
    const hierarchy: ComicRegionHierarchy = {
      sceneId: dominant.sceneId, memberships, zIndex: 100 + index,
      overlapsSceneIds, tailSceneCandidate,
    };
    region.hierarchy = hierarchy;
    children[dominant.sceneId]?.push(region.id);
    elements.push({ ...region, id: `element-${region.id}`, kind: region.type === "caption" ? "narration" : "balloon",
      confidence: region.segmentationConfidence ?? region.styleConfidence ?? 0,
      interactive: true, regionId: region.id, zIndex: hierarchy.zIndex,
      memberships, sceneId: dominant.sceneId, overflowSceneIds: overlapsSceneIds });
  });
  // Non-interactive observations share the same scene-association contract as balloons.
  // Their presence must never create a hit target; this is how a recognised "POW" stays
  // visible in diagnostics without becoming an accidental dialogue button.
  for (const element of elements) {
    const memberships = boundsMemberships(element, scenes);
    const dominant = memberships[0];
    element.memberships = memberships;
    element.sceneId = dominant?.sceneId;
    element.overflowSceneIds = memberships.filter(value => value.sceneId !== dominant?.sceneId && value.maskShare > .01).map(value => value.sceneId);
  }
  return { version: "visual-hierarchy-v2", rootId: `page-${pageIndex + 1}-body`, scenes, sceneChildren: children, elements, characters: [] };
}

/** Detects regular panels from light gutters. Pages without dependable dividers intentionally
 * become one freeform scene; this is safer than inventing rectangles around artwork. */
export function comicDetectScenes(image: PixelSource, pageIndex: number): ComicScene[] {
  const width = image.width, height = image.height;
  const rows = separatorBands(image, "row"), columns = separatorBands(image, "column");
  const horizontal = intervals(rows, height), vertical = intervals(columns, width);
  const candidates: NormalizedBounds[] = [];
  // A typical comic has full-width horizontal gutters but vertical splits only in one
  // row. Find columns inside each row independently so a lower two-panel scene does not
  // incorrectly split the full-width panel above it.
  if (horizontal.length > 1) {
    for (const y of horizontal) {
      const local = intervals(separatorBands(image, "column", 0, y.start, width, y.end), width);
      const rowColumns = local.length > 1 ? local : [{ start: 0, end: width }];
      for (const x of rowColumns) addSceneCandidate(candidates, image, x.start, y.start, x.end, y.end);
    }
  } else if (vertical.length > 1) {
    for (const x of vertical) addSceneCandidate(candidates, image, x.start, 0, x.end, height);
  }
  const source = candidates.length >= 2 ? candidates : [{ x: 0, y: 0, width: 1, height: 1 }];
  return source.map((bounds, index) => ({ id: `page-${pageIndex + 1}-scene-${index + 1}`,
    ...bounds, kind: candidates.length >= 2 ? "panel" : "freeform", confidence: candidates.length >= 2 ? .72 : .25, zIndex: index }));
}

function addSceneCandidate(output: NormalizedBounds[], image: PixelSource, x0: number, y0: number, x1: number, y1: number): void {
  const bounds = { x: x0 / image.width, y: y0 / image.height, width: (x1 - x0) / image.width, height: (y1 - y0) / image.height };
  if (bounds.width * bounds.height >= .025 && containsArtwork(image, x0, y0, x1, y1)) output.push(bounds);
}

function separatorBands(image: PixelSource, axis: "row" | "column", xStart = 0, yStart = 0, xEnd = image.width, yEnd = image.height): { start: number; end: number }[] {
  const long = axis === "row" ? yEnd - yStart : xEnd - xStart, cross = axis === "row" ? xEnd - xStart : yEnd - yStart;
  const marked: boolean[] = [];
  for (let point = 0; point < long; point++) {
    let light = 0, dark = 0;
    for (let other = 0; other < cross; other++) {
      const x = axis === "row" ? xStart + other : xStart + point, y = axis === "row" ? yStart + point : yStart + other;
      const offset = (y * image.width + x) * 4;
      const luma = (image.data[offset]! * 54 + image.data[offset + 1]! * 183 + image.data[offset + 2]! * 19) >> 8;
      if (luma >= 242) light++;
      if (luma <= 48) dark++;
    }
    // Printed panel rules can be white gutters or black strokes. Requiring a long
    // cross-page run keeps lettering, character outlines and scenery from becoming a
    // divider by accident.
    marked.push(light / Math.max(1, cross) >= .91 || dark / Math.max(1, cross) >= .62);
  }
  const bands: { start: number; end: number }[] = [];
  for (let index = 0; index < marked.length;) {
    if (!marked[index]) { index++; continue; }
    const start = index; while (index < marked.length && marked[index]) index++;
    const end = index;
    // Outer paper margins are not panel dividers. Very broad light artwork is not either.
    if (start > long * .015 && end < long * .985 && end - start <= Math.max(2, long * .1)) {
      const offset = axis === "row" ? yStart : xStart;
      bands.push({ start: start + offset, end: end + offset });
    }
  }
  return bands;
}

function intervals(bands: readonly { start: number; end: number }[], length: number): { start: number; end: number }[] {
  const edges = [0, ...bands.flatMap(band => [band.start, band.end]), length].sort((a, b) => a - b);
  const output: { start: number; end: number }[] = [];
  for (let index = 0; index + 1 < edges.length; index += 2) {
    const start = edges[index]!, end = edges[index + 1]!;
    if (end - start >= Math.max(8, length * .06)) output.push({ start, end });
  }
  // The alternating list above is only meaningful when there are actual gaps. Build the
  // conventional complement as a fallback for a single divider.
  if (output.length < 2 && bands.length) {
    let cursor = 0; const complement: { start: number; end: number }[] = [];
    for (const band of bands) { if (band.start > cursor) complement.push({ start: cursor, end: band.start }); cursor = band.end; }
    if (cursor < length) complement.push({ start: cursor, end: length });
    return complement.filter(value => value.end - value.start >= Math.max(8, length * .06));
  }
  return output;
}

function containsArtwork(image: PixelSource, x0: number, y0: number, x1: number, y1: number): boolean {
  const stride = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 32));
  let samples = 0, nonPaper = 0;
  for (let y = y0; y < y1; y += stride) for (let x = x0; x < x1; x += stride) {
    const offset = (y * image.width + x) * 4;
    const luma = (image.data[offset]! * 54 + image.data[offset + 1]! * 183 + image.data[offset + 2]! * 19) >> 8;
    samples++; if (luma < 238) nonPaper++;
  }
  return nonPaper / Math.max(1, samples) >= .025;
}

function membershipsFor(container: ComicVisualContainer, scenes: readonly ComicScene[], pageWidth: number, pageHeight: number) {
  const stencil = container.artStencil ?? container.stencil;
  const totals = new Map(scenes.map(scene => [scene.id, 0])); let total = 0;
  for (let y = 0; y < stencil.height; y++) for (let x = 0; x < stencil.width; x++) {
    if (!stencil.data[y * stencil.width + x]) continue;
    total++;
    const point = { x: (stencil.x + (x + .5) * stencil.step) / pageWidth, y: (stencil.y + (y + .5) * stencil.step) / pageHeight };
    for (const scene of scenes) if (inside(point, scene)) totals.set(scene.id, (totals.get(scene.id) ?? 0) + 1);
  }
  return scenes.map(scene => ({ sceneId: scene.id, maskShare: normalizeComicShare((totals.get(scene.id) ?? 0) / Math.max(1, total)) }))
    .filter(value => value.maskShare > 0).sort((a, b) => b.maskShare - a.maskShare || a.sceneId.localeCompare(b.sceneId));
}

function boundsMemberships(region: NormalizedBounds, scenes: readonly ComicScene[]) {
  const area = region.width * region.height;
  return scenes.map(scene => ({ sceneId: scene.id, maskShare: normalizeComicShare(overlap(region, scene) / Math.max(.000001, area)) }))
    .filter(value => value.maskShare > 0).sort((a, b) => b.maskShare - a.maskShare || a.sceneId.localeCompare(b.sceneId));
}

function tailCandidate(container: ComicVisualContainer, scenes: readonly ComicScene[], pageWidth: number, pageHeight: number) {
  if (container.tail === "none" || !container.contour.length) return undefined;
  const tip = tailTip(container.tail, container.contour, pageWidth, pageHeight);
  const [dx, dy] = directionVector(container.tail);
  for (const distance of [.02, .04, .07, .1, .14]) {
    const point = { x: tip.x + dx * distance, y: tip.y + dy * distance };
    const scene = scenes.find(value => inside(point, value));
    if (scene) return { sceneId: scene.id, direction: container.tail, confidence: Math.max(.35, container.styleConfidence * .7), characterConfirmed: false as const };
  }
  return undefined;
}

function tailTip(direction: ComicTailDirection, points: readonly { x: number; y: number }[], width: number, height: number) {
  const [dx, dy] = directionVector(direction);
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  center.x /= points.length; center.y /= points.length;
  const point = points.reduce((best, value) => ((value.x - center.x) * dx + (value.y - center.y) * dy > (best.x - center.x) * dx + (best.y - center.y) * dy ? value : best), points[0]!);
  return { x: point.x / width, y: point.y / height };
}

function directionVector(direction: ComicTailDirection): [number, number] {
  const vectors: Record<ComicTailDirection, [number, number]> = { none: [0, 0], up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0], "up-left": [-.707, -.707], "up-right": [.707, -.707], "down-right": [.707, .707], "down-left": [-.707, .707] };
  return vectors[direction];
}

function inside(point: { x: number; y: number }, box: NormalizedBounds): boolean { return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height; }
function overlap(a: NormalizedBounds, b: NormalizedBounds): number { return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)); }
