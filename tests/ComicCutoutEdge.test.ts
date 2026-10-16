import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { comicSmoothCutoutEdge } from "../src/reader/comic/interaction/ComicCutoutEdge";

/** A round balloon cut on a coarse grid (cells of `step` px), then enlarged: a staircase
 *  border, a white fill, a black inked ring just inside it and black letters in the middle. */
function staircaseBalloon(size: number, step: number) {
  const data = new Uint8ClampedArray(size * size * 4), centre = size / 2, radius = size * .42;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cellX = Math.floor(x / step) * step + step / 2, cellY = Math.floor(y / step) * step + step / 2;
    const inside = Math.hypot(cellX - centre, cellY - centre) <= radius;
    const distance = Math.hypot(x - centre, y - centre);
    const ink = (distance > radius - 6 && distance < radius - 3) || (Math.abs(y - centre) < 6 && Math.abs(x - centre) < radius * .5 && x % 7 < 4);
    const p = (y * size + x) * 4, value = ink ? 20 : 250;
    data[p] = data[p + 1] = data[p + 2] = value; data[p + 3] = inside ? 255 : 0;
  }
  return { data, width: size, height: size, centre, radius };
}

/** How far the half-alpha border wanders from the true circle, in pixels (mean). */
function roughness(image: ReturnType<typeof staircaseBalloon>): number {
  let sum = 0, n = 0;
  for (let a = 0; a < 360; a += 2) {
    const dx = Math.cos(a * Math.PI / 180), dy = Math.sin(a * Math.PI / 180);
    let edge = 0;
    for (let t = 0; t < image.width / 2; t += .5) {
      const x = Math.round(image.centre + dx * t), y = Math.round(image.centre + dy * t);
      if (image.data[(y * image.width + x) * 4 + 3]! >= 128) edge = t;
    }
    sum += Math.abs(edge - image.radius); n++;
  }
  return sum / n;
}

describe("borda dos recortes ampliados", () => {
  it("arredonda a escada da máscara sem crescer para fora, sem apagar letras nem o contorno", () => {
    const before = staircaseBalloon(240, 12), after = staircaseBalloon(240, 12);
    const changed = comicSmoothCutoutEdge(after, 12);
    assert.ok(changed > 0);
    assert.ok(roughness(after) < roughness(before), `escada ${roughness(before).toFixed(2)}px → ${roughness(after).toFixed(2)}px`);
    for (let i = 0; i < after.width * after.height; i++) {
      const p = i * 4;
      assert.ok(after.data[p + 3]! <= before.data[p + 3]!, "nunca revela o que estava transparente");
      if (before.data[p]! < 140) assert.equal(after.data[p + 3], before.data[p + 3], "letras e contorno ficam intactos");
      assert.equal(after.data[p], before.data[p], "a cor nunca muda");
    }
  });

  it("o miolo do balão não muda; um recorte retangular inteiro (fallback) também não", () => {
    const balloon = staircaseBalloon(160, 8), centre = (80 * 160 + 80) * 4, alpha = balloon.data[centre + 3];
    comicSmoothCutoutEdge(balloon, 8);
    assert.equal(balloon.data[centre + 3], alpha);
    // Entirely opaque rectangle: its only border is the crop's own edge. That edge softens a
    // little but the rectangle stays a rectangle, and nothing inside changes.
    const box = { data: new Uint8ClampedArray(50 * 30 * 4).fill(255), width: 50, height: 30 };
    comicSmoothCutoutEdge(box, 3);
    assert.equal(box.data[(15 * 50 + 25) * 4 + 3], 255);
  });
});
