import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { comicCrispLettering } from "../src/reader/comic/interaction/ComicLetteringCrisp";

/** A white balloon with one black bar of lettering, enlarged with a soft ramp at its edges. */
function softLetter(width: number, height: number, colour?: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const distance = Math.abs(x - width / 2) - 6, t = Math.min(1, Math.max(0, (distance + 4) / 8)); // 8-px grey ramp
    const value = Math.round(30 + t * 215), p = (y * width + x) * 4;
    const [r, g, b] = colour && t > .95 ? colour : [value, value, value];
    data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
  }
  return { data, width, height };
}
const ramp = (image: { data: Uint8ClampedArray; width: number }, y: number): number => {
  let grey = 0; for (let x = 0; x < image.width; x++) { const v = image.data[(y * image.width + x) * 4]!; if (v > 60 && v < 200) grey++; } return grey;
};

describe("letras nítidas no balão ampliado", () => {
  it("a borda cinza de cada letra fica curta e firme, sem mudar a transparência", () => {
    const image = softLetter(80, 20), before = ramp(image, 10);
    assert.ok(comicCrispLettering(image) > 0);
    assert.ok(ramp(image, 10) <= before * .65, `rampa ${before}px → ${ramp(image, 10)}px`);
    for (let i = 3; i < image.data.length; i += 4) assert.equal(image.data[i], 255);
    // Paper stays paper, ink stays ink.
    assert.ok(image.data[(10 * 80 + 1) * 4]! > 235 && image.data[(10 * 80 + 40) * 4]! < 50);
  });

  it("arte colorida não muda", () => {
    const image = softLetter(80, 20, [230, 200, 40]), copy = new Uint8ClampedArray(image.data);
    comicCrispLettering(image);
    for (let i = 0; i < copy.length; i += 4) if (copy[i] === 230 && copy[i + 1] === 200) assert.deepEqual([...image.data.slice(i, i + 4)], [...copy.slice(i, i + 4)]);
  });

  it("um recorte sem papel e tinta (tudo escuro ou liso) fica como está", () => {
    const dark = { data: new Uint8ClampedArray(40 * 10 * 4).map((_, i) => i % 4 === 3 ? 255 : 40), width: 40, height: 10 };
    assert.equal(comicCrispLettering(dark), 0);
  });
});
