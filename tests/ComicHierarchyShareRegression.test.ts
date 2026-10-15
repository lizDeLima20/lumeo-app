import assert from "node:assert/strict";
import test from "node:test";
import { comicBuildVisualHierarchy, comicDetectScenes, normalizeComicShare, COMIC_SHARE_TOLERANCE } from "../src/reader/comic/interaction/ComicVisualHierarchy";
import { ComicInteractionValidator } from "../src/reader/comic/interaction/ComicInteractionValidator";
import type { ComicPage, ComicPageHierarchy, ComicVisualElement } from "../src/reader/comic/interaction/ComicInteractionTypes";

/* Regression for the BODY v4 defect seen on the Infinix: a sound effect lying wholly inside
 * a panel measured maskShare = 1.0000000000000002, the validator threw "Interseção de
 * elemento visual inválida." and the whole page failed (Mônica page 3 in the preparation
 * queue, page 21 in the reader). */

function fourPanels(width = 100, height = 80): ImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const at = (y * width + x) * 4; data[at] = data[at + 1] = data[at + 2] = 90; data[at + 3] = 255; }
  };
  fill(3, 3, 47, 37); fill(53, 3, 97, 37); fill(3, 43, 47, 77); fill(53, 43, 97, 77);
  return { width, height, data } as ImageData;
}

function effect(id: string, x: number, y: number, width: number, height: number): ComicVisualElement {
  return { id, kind: "effect", confidence: .8, interactive: false, zIndex: 200, x, y, width, height, memberships: [], overflowSceneIds: [], reason: "sound-effect" };
}

function pageWith(hierarchy: ComicPageHierarchy): ComicPage {
  return { index: 2, id: "page-3", imagePath: "pages/003.webp", mimeType: "image/webp", cover: false, regions: [], hierarchy };
}

const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

test("an effect wholly inside a panel gets maskShare exactly 1 and the page validates", () => {
  const image = fourPanels();
  const scenes = comicDetectScenes(image, 2);
  const panel = scenes[0]!;
  // Deterministic grid of effects inside the first panel; several of them overflow 1 in raw
  // float arithmetic, which is precisely what failed on the device.
  const elements: ComicVisualElement[] = [];
  let rawOverflow = 0;
  for (let i = 0; i < 40; i++) {
    const width = panel.width * (.1 + (i % 7) * .05), height = panel.height * (.1 + (i % 5) * .07);
    const x = panel.x + (panel.width - width) * ((i * 37) % 100) / 100, y = panel.y + (panel.height - height) * ((i * 53) % 100) / 100;
    const element = effect(`effect-${i}`, x, y, width, height);
    if (overlap(element, panel) / (width * height) > 1) rawOverflow++;
    elements.push(element);
  }
  assert.ok(rawOverflow > 0, "the fixture must reproduce the 1.0000000000000002 share");
  const hierarchy = comicBuildVisualHierarchy(2, image, [], [], image.width, image.height, elements);
  for (const element of hierarchy.elements!) {
    assert.equal(element.sceneId, panel.id);
    assert.equal(element.memberships[0]!.maskShare, 1, `${element.id} is wholly inside its panel`);
    assert.ok(element.memberships.every(value => value.maskShare >= 0 && value.maskShare <= 1));
    assert.deepEqual(element.overflowSceneIds, []);
  }
  assert.equal(new ComicInteractionValidator().validatePage(pageWith(hierarchy)), true);
});

test("overflow across panels is still measured, not rounded away", () => {
  const image = fourPanels();
  const scenes = comicDetectScenes(image, 2);
  // Straddles the vertical gutter between the two top panels.
  const straddling = effect("pow", .3, .1, .4, .2);
  const hierarchy = comicBuildVisualHierarchy(2, image, [], [], image.width, image.height, [straddling]);
  const element = hierarchy.elements![0]!;
  const shares = element.memberships.map(value => value.maskShare);
  assert.ok(shares.length >= 2 && shares.every(value => value > 0 && value < 1), `partial shares: ${shares}`);
  assert.equal(element.overflowSceneIds.length, 1);
  assert.ok(scenes.some(scene => scene.id === element.overflowSceneIds[0]));
  assert.equal(new ComicInteractionValidator().validatePage(pageWith(hierarchy)), true);
});

test("only rounding is tolerated: real out-of-range shares are still rejected", () => {
  assert.equal(normalizeComicShare(1.0000000000000002), 1);
  assert.equal(normalizeComicShare(-1e-12), 0);
  assert.equal(normalizeComicShare(.9999999999999997), 1);
  assert.equal(normalizeComicShare(.5), .5);
  assert.equal(normalizeComicShare(1.01), 1.01);
  assert.ok(Number.isNaN(normalizeComicShare(Number.NaN)));
  assert.ok(COMIC_SHARE_TOLERANCE <= 1e-9);

  const image = fourPanels();
  const base = comicBuildVisualHierarchy(2, image, [], [], image.width, image.height, [effect("pow", .1, .1, .1, .1)]);
  const withShare = (maskShare: number): ComicPage => pageWith({ ...base, elements: base.elements!.map(value => ({ ...value, memberships: [{ ...value.memberships[0]!, maskShare }] })) });
  const validator = new ComicInteractionValidator();
  assert.equal(validator.validatePage(withShare(1.0000000000000002)), true, "a stored rounding residue is accepted");
  for (const invalid of [1.01, 1 + 1e-6, -0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => validator.validatePage(withShare(invalid)), /Interseção de elemento visual inválida/, `share ${invalid}`);
  }
  const unknownScene: ComicPage = pageWith({ ...base, elements: base.elements!.map(value => ({ ...value, memberships: [{ sceneId: "nowhere", maskShare: 1 }] })) });
  assert.throws(() => validator.validatePage(unknownScene), /Interseção de elemento visual inválida/);
});
