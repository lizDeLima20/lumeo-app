/** Smooths the edge of an enlarged balloon cutout, on its alpha channel only.
 *
 *  A cutout's alpha is decided on MobileSAM's analysis grid, a few page pixels per cell,
 *  so its border is a staircase of cell-sized steps; enlarging the balloon two to four times
 *  turns each step into a visible notch. Averaging the alpha over about one step and keeping
 *  the lower of that and the original rounds the steps off along the border, without moving
 *  the border outwards anywhere.
 *
 *  Only ever lowers alpha, and never on dark pixels - lettering and the balloon's own inked
 *  outline stay exactly as they were. It never raises alpha either: a cutout's transparent
 *  pixels do not keep the page's colours (the WebP encoder is free to drop them), so nothing
 *  hidden is ever revealed. Pixels away from the border are untouched. */
export function comicSmoothCutoutEdge(image: { data: Uint8ClampedArray; width: number; height: number }, radius: number): number {
  const { data, width, height } = image;
  const r = Math.max(1, Math.round(radius));
  const count = width * height;
  if (count === 0 || data.length !== count * 4) return 0;
  const alpha = new Float32Array(count);
  for (let i = 0; i < count; i++) alpha[i] = data[i * 4 + 3]!;
  const horizontal = boxBlur(alpha, width, height, r, true);
  const blurred = boxBlur(horizontal, width, height, r, false);
  let changed = 0;
  for (let i = 0; i < count; i++) {
    const original = alpha[i]!;
    if (original === 0) continue;
    const average = blurred[i]!;
    // Inside the cutout, away from any border: the average is full and nothing changes.
    if (average >= 254.5) continue;
    const p = i * 4;
    // Lettering and the inked outline are dark: they are never faded.
    const luminance = .2126 * data[p]! + .7152 * data[p + 1]! + .0722 * data[p + 2]!;
    if (luminance < 140) continue;
    // A soft ramp centred on the half-covered line: the staircase becomes a smooth curve
    // just inside the original border, never outside it.
    const t = Math.min(1, Math.max(0, (average - 255 * .3) / (255 * .45)));
    const eased = t * t * (3 - 2 * t);
    const next = Math.min(original, Math.round(255 * eased));
    if (next < original) { data[p + 3] = next; changed++; }
  }
  return changed;
}

function boxBlur(source: Float32Array, width: number, height: number, r: number, alongX: boolean): Float32Array {
  const out = new Float32Array(source.length);
  const lines = alongX ? height : width, span = alongX ? width : height;
  const at = (line: number, index: number): number => alongX ? line * width + index : index * width + line;
  for (let line = 0; line < lines; line++) {
    let sum = 0;
    // Outside the image counts as transparent, like everything beyond the crop.
    for (let k = -r; k <= r; k++) if (k >= 0 && k < span) sum += source[at(line, k)]!;
    for (let index = 0; index < span; index++) {
      out[at(line, index)] = sum / (2 * r + 1);
      const leaving = index - r, entering = index + r + 1;
      if (leaving >= 0) sum -= source[at(line, leaving)]!;
      if (entering < span) sum += source[at(line, entering)]!;
    }
  }
  return out;
}
