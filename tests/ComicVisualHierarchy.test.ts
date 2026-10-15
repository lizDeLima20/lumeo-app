import assert from "node:assert/strict";
import test from "node:test";
import { comicBuildVisualHierarchy, comicDetectScenes } from "../src/reader/comic/interaction/ComicVisualHierarchy";
import type { ComicTextRegion } from "../src/reader/comic/interaction/ComicInteractionTypes";
import type { ComicVisualContainer } from "../src/reader/comic/interaction/ComicContainerDetector";
import { ComicLimaSerializer } from "../src/reader/comic/interaction/ComicLimaSerializer";
import { ComicLimaDeserializer } from "../src/reader/comic/interaction/ComicLimaDeserializer";
import { COMIC_LIMA_VERSION } from "../src/reader/comic/interaction/ComicInteractionTypes";

function page(width = 100, height = 80): ImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const fill = (x0: number, y0: number, x1: number, y1: number, value = 90) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const at = (y * width + x) * 4; data[at] = data[at + 1] = data[at + 2] = value; data[at + 3] = 255;
    }
  };
  // Four panels separated by white gutters at x=48..51 and y=38..41.
  fill(3, 3, 47, 37); fill(53, 3, 97, 37); fill(3, 43, 47, 77); fill(53, 43, 97, 77);
  return { width, height, data } as ImageData;
}

function region(id: string): ComicTextRegion {
  return { id, pageIndex: 0, text: "fala", x: .35, y: .2, width: .32, height: .22, shape: "balloon", type: "speech", tailDirection: "down", contour: [{ x: .35, y: .2 }, { x: .67, y: .2 }, { x: .67, y: .42 }, { x: .35, y: .42 }] };
}

function container(): ComicVisualContainer {
  const width = 32, height = 18, data = new Uint8Array(width * height).fill(1);
  return {
    bbox: { x0: 35, y0: 16, x1: 67, y1: 34 }, ink: { x0: 40, y0: 20, x1: 60, y1: 28 },
    contour: [{ x: 35, y: 16 }, { x: 67, y: 16 }, { x: 67, y: 34 }, { x: 35, y: 34 }],
    stencil: { data, width, height, step: 1, x: 35, y: 16 }, artStencil: { data, width, height, step: 1, x: 35, y: 16 },
    type: "speech", shape: "balloon", tail: "down", styleConfidence: .9, backgroundColor: "#ffffff", textColor: "#000000",
    typography: { family: "comic", weight: "normal", italic: false, align: "center", capHeight: .02, lines: 1 },
    inkShare: .2, blockShare: .3, runs: 80, glyphShare: 1, bands: 1, darkOnLight: true,
  };
}

test("finds a panel grid from gutters and falls back to one freeform scene without them", () => {
  const scenes = comicDetectScenes(page(), 0);
  assert.equal(scenes.length, 4); assert.ok(scenes.every(scene => scene.kind === "panel"));
  const blank = new Uint8ClampedArray(100 * 80 * 4).fill(180);
  assert.deepEqual(comicDetectScenes({ width: 100, height: 80, data: blank }, 0).map(scene => scene.kind), ["freeform"]);
});

test("keeps a balloon whole while recording overlap with two scenes", () => {
  const regions = [region("r1")];
  const hierarchy = comicBuildVisualHierarchy(0, page(), [container()], regions, 100, 80);
  assert.equal(hierarchy.scenes.length, 4);
  assert.equal(regions[0]!.hierarchy?.memberships.length, 2);
  assert.ok(regions[0]!.hierarchy!.overlapsSceneIds.length >= 1);
  assert.equal(regions[0]!.hierarchy?.zIndex, 100);
  assert.equal(hierarchy.characters.length, 0);
});

test("BODY records a non-interactive sound effect without turning it into a balloon", () => {
  const regions = [region("r1")];
  const effect = { id: "effect-pow", kind: "effect" as const, confidence: .88, interactive: false, zIndex: 220,
    x: .08, y: .08, width: .18, height: .12, memberships: [], overflowSceneIds: [], reason: "sound-effect" as const };
  const hierarchy = comicBuildVisualHierarchy(0, page(), [container()], regions, 100, 80, [effect]);
  const recorded = hierarchy.elements?.find(element => element.id === "effect-pow");
  assert.equal(hierarchy.version, "visual-hierarchy-v2");
  assert.equal(recorded?.interactive, false);
  assert.ok(recorded?.sceneId);
  assert.ok((hierarchy.elements?.find(element => element.regionId === "r1")?.interactive));
});

test("persists the compact visual tree in LIMA without duplicating masks", () => {
  const regions = [region("r1")], hierarchy = comicBuildVisualHierarchy(0, page(), [container()], regions, 100, 80);
  const document = {
    manifest: { format: "lima" as const, version: COMIC_LIMA_VERSION, contentType: "comic" as const, documentId: "h", createdAt: "2026-10-14T00:00:00.000Z", generator: "test", metadataPath: "metadata/metadata.json" as const, pagesPath: "pages/" as const, interactionPath: "interaction/" as const,
      pages: [{ index: 0, id: "page-001", imagePath: "pages/001.webp", interactionPath: "interaction/001.json", mimeType: "image/webp" as const, cover: true }] },
    metadata: { id: "h", title: "H", createdAt: "2026-10-14T00:00:00.000Z" },
    pages: [{ index: 0, id: "page-001", imagePath: "pages/001.webp", mimeType: "image/webp" as const, cover: true, regions, hierarchy }],
  };
  const image = new Uint8Array([1, 2, 3]);
  const restored = new ComicLimaDeserializer().deserialize(new ComicLimaSerializer().serialize(document, [{ path: "pages/001.webp", data: image, mimeType: "image/webp" }]));
  assert.equal(restored.manifest.version, 5);
  assert.equal(restored.pages[0]!.hierarchy?.scenes.length, 4);
  assert.equal(restored.pages[0]!.regions[0]!.hierarchy?.overlapsSceneIds.length, 1);
});
