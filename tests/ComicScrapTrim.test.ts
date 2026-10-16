import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { comicTrimArtScraps } from "../src/reader/comic/interaction/ComicScrapTrim";
import type { ComicTextRegion } from "../src/reader/comic/interaction/ComicInteractionTypes";

/** 120x60 crop: white balloon paper, black letters in the middle, a black outline row at y=44,
 *  and a green piece of the drawing below it (y > 46) touching the crop edge. */
function crop(captionColour?: [number, number, number]) {
  const width = 120, height = 60, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4; let c: [number, number, number] = captionColour ?? [250, 248, 240];
    if (y === 44) c = [20, 20, 20];
    else if (y > 46 && !captionColour) c = [90, 170, 140];
    else if (y >= 20 && y <= 34 && x >= 30 && x <= 90 && x % 6 < 3) c = [15, 15, 15];
    data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
  }
  const region = { id: "b", pageIndex: 0, text: "OI", x: 0, y: 0, width: 1, height: 1, type: "speech", shape: "balloon", tailDirection: "none",
    visualBounds: { x: 0, y: 0, width: 1, height: 1 }, textBounds: { x: 25 / 120, y: 18 / 60, width: 70 / 120, height: 18 / 60 } } as unknown as ComicTextRegion;
  return { image: { data, width, height }, region };
}
const alpha = (image: { data: Uint8ClampedArray; width: number }, x: number, y: number): number => image.data[(y * image.width + x) * 4 + 3]!;

describe("retalhos do desenho ao redor dos balões", () => {
  it("o pedaço de desenho colorido encostado na borda some; letras, papel e contorno ficam", () => {
    const { image, region } = crop();
    assert.ok(comicTrimArtScraps(image, region) > 0);
    assert.equal(alpha(image, 60, 55), 0, "desenho verde embaixo");
    assert.equal(alpha(image, 60, 10), 255, "papel do balão");
    assert.equal(alpha(image, 60, 44), 255, "contorno preto");
    for (let y = 20; y <= 34; y++) for (let x = 30; x <= 90; x++) assert.equal(alpha(image, x, y), 255, "letras");
  });

  it("uma legenda colorida (o próprio fundo) não é apagada", () => {
    const { image, region } = crop([240, 210, 60]);
    assert.equal(comicTrimArtScraps(image, region), 0);
    assert.equal(alpha(image, 5, 5), 255);
  });

  it("cor que chega ao miolo do texto nunca é tocada", () => {
    const { image, region } = crop();
    // Coloured lettering connected to the drawing below: reaches the text core, so it all stays.
    for (let y = 26; y <= 59; y++) { const p = (y * 120 + 60) * 4; image.data[p] = 200; image.data[p + 1] = 40; image.data[p + 2] = 40; }
    comicTrimArtScraps(image, region);
    assert.equal(alpha(image, 60, 30), 255);
  });
});
