import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeMask } from "../src/reader/comic/interaction/MobileSamComicSegmentation";
import { simplifyContour, traceMaskContour } from "../src/reader/comic/interaction/ComicShapeMask";
import { comicPointInContour } from "../src/reader/comic/interaction/ComicSilhouette";

function encodedRuns(...runs: number[]): string {
  const bytes: number[] = [];
  for (let value of runs) {
    while (value >= 128) { bytes.push((value & 127) | 128); value >>>= 7; }
    bytes.push(value);
  }
  return Buffer.from(bytes).toString("base64");
}

test("decodes MobileSAM alternating RLE without turning the bounding box into the mask", () => {
  // 5x4, a separate 3x2 body surrounded by transparent pixels.
  const mask = decodeMask(encodedRuns(6, 3, 2, 3, 6), 5, 4);
  assert.deepEqual([...mask.data], [
    0, 0, 0, 0, 0,
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    0, 0, 0, 0, 0,
  ]);
});

test("a MobileSAM contour answers only inside its mask", () => {
  const mask = decodeMask(encodedRuns(6, 3, 2, 3, 2, 3, 6), 5, 5);
  const contour = simplifyContour(traceMaskContour(mask), .1).map(point => ({ x: point.x / 5, y: point.y / 5 }));
  assert.equal(comicPointInContour(contour, { x: .5, y: .5 }), true);
  assert.equal(comicPointInContour(contour, { x: .05, y: .05 }), false);
  assert.equal(comicPointInContour(contour, { x: .95, y: .5 }), false);
});

test("rejects an empty or truncated native mask record", () => {
  assert.throws(() => decodeMask(encodedRuns(20), 5, 4), /COMIC_ML_INVALID_MASK/);
  assert.throws(() => decodeMask(encodedRuns(2, 2), 5, 4), /COMIC_ML_INVALID_MASK/);
});

test("Android never revives heuristic balloons when native ML rejects a page", () => {
  const source = readFileSync(new URL("../src/reader/comic/interaction/ComicPageRegionReader.ts", import.meta.url), "utf8");
  const androidBranch = source.slice(source.indexOf('Capacitor.getPlatform() === "android"'), source.indexOf("const found ="));
  assert.match(androidBranch, /COMIC_ML_NO_VALID_MASKS/);
  assert.match(androidBranch, /COMIC_ML_PAGE_FAILED/);
  assert.doesNotMatch(androidBranch, /detectComicContainersMultiScale/);
});

test("native validation rejects fragmented masks instead of exporting broken balloons", () => {
  const source = readFileSync(new URL("../android/app/src/main/java/com/lumeo/reader/ComicSegmentationPlugin.java", import.meta.url), "utf8");
  assert.match(source, /MIN_MASK_SOLIDITY = 0\.68f/);
  assert.match(source, /maskSolidity >= MIN_MASK_SOLIDITY/);
  assert.match(source, /"fragmented-mask"/);
});

test("prompts travel with their own coordinate space and the plugin never scales them from the decoded bitmap", () => {
  const bridge = readFileSync(new URL("../src/reader/comic/interaction/MobileSamComicSegmentation.ts", import.meta.url), "utf8");
  assert.match(bridge, /sourceWidth: pageWidth, sourceHeight: pageHeight/);
  const plugin = readFileSync(new URL("../android/app/src/main/java/com/lumeo/reader/ComicSegmentationPlugin.java", import.meta.url), "utf8");
  assert.match(plugin, /call\.getInt\("sourceWidth", 0\)/);
  assert.match(plugin, /ComicModelGeometry\.of\(bounds\.outWidth, bounds\.outHeight, promptWidth, promptHeight, MODEL_SIDE\)/);
  assert.match(plugin, /geometry\.toModel\(/);
  // The BODY v4 defect: the scale came from the inSampleSize-reduced bitmap.
  assert.doesNotMatch(plugin, /MODEL_SIDE \/ \(float\) Math\.max\(source\.getWidth\(\), source\.getHeight\(\)\)/);
  assert.doesNotMatch(plugin, /box\.getDouble\(\d\) \* scale/);
});
