import type { ComicTextRegion } from "./ComicInteractionTypes";

/** Removes pieces of the surrounding drawing that came along with a balloon.
 *
 *  A balloon is paper (white or a light tint), its lettering and its inked outline. What does
 *  not belong is coloured artwork reaching in from outside: below a balloon whose text box ran
 *  into the panel, or where the segmentation mask leaked a little past the outline. Such a
 *  piece is a coloured patch that touches the edge of the cutout (the crop border, or the
 *  transparent area around a masked balloon). Each one is hidden, with the thin dark strokes
 *  of the drawing right next to it.
 *
 *  What is never hidden: a patch that reaches the middle of the lettering, a patch that is a
 *  large part of the cutout (a coloured caption box is its own background), lettering, and
 *  anything if the result would hide too much. Only alpha is lowered. Returns how many pixels
 *  were hidden. */
export function comicTrimArtScraps(image: { data: Uint8ClampedArray; width: number; height: number }, region: ComicTextRegion): number {
  const { data, width, height } = image;
  const count = width * height;
  if (width < 8 || height < 8 || data.length !== count * 4) return 0;

  // The lettering, mapped into this image: its core is never touched, its box only loosely.
  const crop = region.visualBounds, text = region.textBounds;
  let core = { x0: width * .3, y0: height * .3, x1: width * .7, y1: height * .7 };
  let box = { x0: 0, y0: 0, x1: width, y1: height };
  if (crop && text && crop.width > 0 && crop.height > 0 && text.width > 0 && text.height > 0) {
    const x0 = ((text.x - crop.x) / crop.width) * width, x1 = ((text.x + text.width - crop.x) / crop.width) * width;
    const y0 = ((text.y - crop.y) / crop.height) * height, y1 = ((text.y + text.height - crop.y) / crop.height) * height;
    box = { x0, y0, x1, y1 };
    const insetX = (x1 - x0) * .18, insetY = (y1 - y0) * .18;
    core = { x0: x0 + insetX, y0: y0 + insetY, x1: x1 - insetX, y1: y1 - insetY };
  }

  // The colour the lettering sits on (median of the lighter pixels of the text core): a patch
  // of that same colour is the balloon or caption itself, never a piece of drawing.
  const paper = [[], [], []] as number[][];
  for (let y = Math.max(0, Math.floor(core.y0)); y < Math.min(height, Math.ceil(core.y1)); y++) for (let x = Math.max(0, Math.floor(core.x0)); x < Math.min(width, Math.ceil(core.x1)); x++) {
    const p = (y * width + x) * 4; if (data[p + 3]! === 0) continue;
    if (.2126 * data[p]! + .7152 * data[p + 1]! + .0722 * data[p + 2]! < 120) continue;
    paper[0]!.push(data[p]!); paper[1]!.push(data[p + 1]!); paper[2]!.push(data[p + 2]!);
  }
  const median = (values: number[]): number => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 255; };
  const ground = paper[0]!.length ? paper.map(median) : [255, 255, 255];

  // Drawing is what is far from that colour and is not ink: green or grey art next to a white
  // balloon, pink or blue art next to a yellow caption. Ink (lettering, outlines) never counts.
  const colored = new Uint8Array(count);
  let opaque = 0;
  for (let i = 0; i < count; i++) {
    const p = i * 4; if (data[p + 3]! === 0) continue;
    opaque++;
    const r = data[p]!, g = data[p + 1]!, b = data[p + 2]!;
    if (.2126 * r + .7152 * g + .0722 * b < 60) continue;
    // A half-transparent pixel is the cutout's own soft edge, not drawing.
    if (data[p + 3]! < 200) continue;
    if (Math.hypot(r - ground[0]!, g - ground[1]!, b - ground[2]!) > 70) colored[i] = 1;
  }
  if (opaque === 0) return 0;

  // Coloured patches that touch the cutout's edge, one connected patch at a time.
  const label = new Int32Array(count).fill(-1);
  const transparent = (x: number, y: number): boolean => x < 0 || y < 0 || x >= width || y >= height || data[(y * width + x) * 4 + 3]! === 0;
  const remove = new Uint8Array(count);
  let patches = 0;
  const queue = new Int32Array(count);
  for (let start = 0; start < count; start++) {
    if (!colored[start] || label[start] !== -1) continue;
    const sx = start % width, sy = (start - sx) / width;
    if (!(transparent(sx - 1, sy) || transparent(sx + 1, sy) || transparent(sx, sy - 1) || transparent(sx, sy + 1))) continue;
    let head = 0, tail = 0, area = 0, inCore = false;
    queue[tail++] = start; label[start] = patches;
    while (head < tail) {
      const i = queue[head++]!, x = i % width, y = (i - x) / width; area++;
      if (x >= core.x0 && x <= core.x1 && y >= core.y0 && y <= core.y1) inCore = true;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (colored[j] && label[j] === -1) { label[j] = patches; queue[tail++] = j; }
      }
    }
    // The caption's own coloured background, or anything reaching the lettering: keep.
    // Too small to be a piece of drawing (a few blended pixels along an edge): leave it.
    // Lettering is ink and never counted as drawing; the middle of the text is protected too.
    if (!inCore && area >= Math.max(24, count * .002) && area <= count * .35) for (let k = 0; k < tail; k++) remove[queue[k]!] = 1;
    patches++;
  }

  // The drawing's own dark strokes right beside a removed patch go with it - outside the
  // lettering's box only.
  // Dark strokes within 2 px (further would start eating the balloon's own outline), the
  // greyish blend between drawing and paper within 3 px.
  const fringe = new Uint8Array(count);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (remove[i] || data[i * 4 + 3]! === 0) continue;
    if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) continue;
    const p = i * 4, luminance = .2126 * data[p]! + .7152 * data[p + 1]! + .0722 * data[p + 2]!;
    if (luminance > 200) continue;
    const reach = luminance < 120 ? 2 : 3;
    search: for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height && remove[yy * width + xx]) { fringe[i] = 1; break search; }
    }
  }

  let hidden = 0;
  for (let i = 0; i < count; i++) if (remove[i] || fringe[i]) hidden++;
  // Something unexpected (most of the balloon looks like drawing): leave it as it was.
  if (hidden === 0 || hidden > opaque * .45) return 0;
  for (let i = 0; i < count; i++) if (remove[i] || fringe[i]) data[i * 4 + 3] = 0;
  return hidden;
}
