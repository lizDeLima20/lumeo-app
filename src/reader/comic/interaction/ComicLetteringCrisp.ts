/** Crisp lettering for an enlarged balloon.
 *
 *  A balloon is enlarged from the few pixels the page actually has, so every letter edge
 *  becomes a soft grey ramp several screen pixels wide - the blur readers see. Comic
 *  lettering is ink on paper: black, or close to it, on white. After a light unsharp pass,
 *  each neutral pixel is pulled towards the ink or the paper it sits between, with a smooth
 *  but steep curve, so letter edges become sharp again without inventing any shape that was
 *  not there.
 *
 *  Only neutral (grey) pixels change - coloured artwork, coloured caption boxes and their
 *  backgrounds are left exactly as they were - and alpha is never touched. The ink and paper
 *  levels are measured on the balloon itself, so a greyish scan is treated by its own tones.
 *  Returns how many pixels changed. */
export function comicCrispLettering(image: { data: Uint8ClampedArray; width: number; height: number }, strength = .85): number {
  const { data, width, height } = image;
  const count = width * height;
  if (count === 0 || data.length !== count * 4) return 0;
  const luminance = new Float32Array(count), neutral = new Uint8Array(count);
  const histogram = new Uint32Array(256);
  let neutrals = 0;
  for (let i = 0; i < count; i++) {
    const p = i * 4, r = data[p]!, g = data[p + 1]!, b = data[p + 2]!;
    const value = .2126 * r + .7152 * g + .0722 * b;
    luminance[i] = value;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (data[p + 3]! > 0 && (max - min) <= Math.max(18, max * .18)) { neutral[i] = 1; neutrals++; histogram[Math.round(value)]!++; }
  }
  if (neutrals < count * .1) return 0;
  const percentile = (share: number): number => { let seen = 0; for (let value = 0; value < 256; value++) { seen += histogram[value]!; if (seen >= neutrals * share) return value; } return 255; };
  const ink = percentile(.04), paper = percentile(.9);
  // Not lettering on paper (a flat or very dark crop): leave it alone.
  if (paper - ink < 90 || paper < 150) return 0;

  // Light unsharp mask on luminance (3x3 box), so the curve below works on firmer edges.
  const sharpened = new Float32Array(count);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || xx < 0 || yy >= height || xx >= width) continue;
      sum += luminance[yy * width + xx]!; n++;
    }
    const i = y * width + x;
    sharpened[i] = luminance[i]! + (luminance[i]! - sum / n) * .8;
  }

  let changed = 0;
  for (let i = 0; i < count; i++) {
    if (!neutral[i]) continue;
    let t = Math.min(1, Math.max(0, (sharpened[i]! - ink) / (paper - ink)));
    t = t * t * (3 - 2 * t); t = t * t * (3 - 2 * t);
    const target = ink * .35 + (255 - ink * .35) * t;
    const p = i * 4, current = luminance[i]!;
    const next = current + (target - current) * strength;
    if (Math.abs(next - current) < 1) continue;
    // Grey stays grey: every channel moves by the same amount.
    const shift = next - current;
    data[p] = data[p]! + shift; data[p + 1] = data[p + 1]! + shift; data[p + 2] = data[p + 2]! + shift;
    changed++;
  }
  return changed;
}
