import type { ComicPageHierarchy, ComicTextRegion } from "./ComicInteractionTypes";
import type { ComicRect } from "../ComicLayout";
import { comicRegionBounds } from "./ComicRegionBounds";

/** The colours of the three rectangles, so a page can be audited at a glance: what may be
 *  touched, what the balloon is made of, and where the words were found. */
export const COMIC_DEBUG_COLOURS = { hit: "#2f6fed", visual: "#008c69", text: "#de651a" } as const;

/** Opt-in drawing only. No event handlers, hit targets or expanded balloons.
 *
 *  Meant for one question as much as for the other: is what we read correct, and is there
 *  any visible text on this page with no region at all? */
export function drawComicInteractionDebug(context: CanvasRenderingContext2D, regions: readonly ComicTextRegion[], art: ComicRect,
  enabled = false, hierarchy?: ComicPageHierarchy): void {
  if (!enabled) return;
  context.save(); context.font = "12px sans-serif";
  // BODY and scenes are diagnostic-only: the reader never uses these rectangles as hit
  // areas. This makes panel association and overflow visible without changing gestures.
  for (const scene of hierarchy?.scenes ?? []) {
    context.strokeStyle = scene.kind === "panel" ? "#7c3aed" : "#64748b";
    context.lineWidth = 1; context.setLineDash([5, 3]);
    context.strokeRect(art.x + scene.x * art.width, art.y + scene.y * art.height, scene.width * art.width, scene.height * art.height);
    context.fillStyle = "#4c1d95"; context.fillText(scene.id, art.x + scene.x * art.width + 2, art.y + scene.y * art.height + 12);
  }
  for (const region of regions) {
    const bounds = comicRegionBounds(region);
    for (const [key, rect] of [["hit", bounds.hit], ["visual", bounds.visual], ["text", bounds.text]] as const) {
      context.strokeStyle = COMIC_DEBUG_COLOURS[key];
      context.lineWidth = key === "visual" ? 2 : 1;
      context.setLineDash(key === "text" ? [4, 3] : []);
      context.strokeRect(art.x + rect.x * art.width, art.y + rect.y * art.height, rect.width * art.width, rect.height * art.height);
    }
    context.setLineDash([]);
    const x = art.x + bounds.hit.x * art.width, y = art.y + bounds.hit.y * art.height;
    const review = region.recognitionStatus === "needs-review";
    const label = `${region.id} ${Math.round((region.ocrConfidence ?? 0) * 100)}%${review ? " ⚑" : ""}`;
    const labelY = Math.max(art.y + 14, y);
    context.fillStyle = review ? "#ffe9d6" : "#fff";
    context.fillRect(x, labelY - 13, context.measureText(label).width + 4, 15);
    context.fillStyle = "#111"; context.fillText(label, x + 2, labelY - 1);
  }
  for (const element of hierarchy?.elements?.filter(value => !value.interactive) ?? []) {
    context.strokeStyle = element.kind === "effect" ? "#e11d48" : "#94a3b8";
    context.lineWidth = 2; context.setLineDash([2, 2]);
    context.strokeRect(art.x + element.x * art.width, art.y + element.y * art.height, element.width * art.width, element.height * art.height);
    context.setLineDash([]); context.fillStyle = "#e11d48";
    context.fillText(`${element.kind}:${element.id}`, art.x + element.x * art.width + 2, art.y + element.y * art.height + 12);
  }
  context.restore();
}
