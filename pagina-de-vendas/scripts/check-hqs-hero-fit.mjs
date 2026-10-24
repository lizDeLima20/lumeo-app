// Confere o encaixe dos vídeos da hero de HQs: cada vídeo projetado (GEOMETRY em
// js/hqs-art-hero.js) precisa cobrir 100% do furo da máscara SVG (index-hqs.html).
// Imprime quanto de cada borda do vídeo fica escondido sob a moldura.
// Uso: node scripts/check-hqs-hero-fit.mjs   (explicação em HERO-HQS-VIDEOS.md)
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GEOMETRY } from "../js/hqs-art-hero.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "index-hqs.html"), "utf8");

function maskPaths(mode) {
  const block = html.match(new RegExp(`<mask id="hqs-art-mask-${mode}"[\\s\\S]*?</mask>`))?.[0];
  if (!block) throw new Error(`Máscara hqs-art-mask-${mode} não encontrada em index-hqs.html.`);
  const paths = [...block.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]);
  if (paths.length !== 2) throw new Error(`Esperados 2 furos (tablet, celular) na máscara ${mode}; encontrados ${paths.length}.`);
  return { tablet: paths[0], phone: paths[1] };
}

// Amostra um path SVG com comandos absolutos M, L, Q, C e Z.
function samplePath(d, steps = 32) {
  const tokens = d.match(/[MLQCZ]|-?\d*\.?\d+/g);
  const points = [];
  let index = 0, current = null, start = null;
  const take = () => Number(tokens[index++]);
  const lineTo = (target) => {
    if (current) for (let k = 1; k <= steps; k += 1) points.push([current[0] + (target[0] - current[0]) * k / steps, current[1] + (target[1] - current[1]) * k / steps]);
    else points.push(target);
    current = target;
  };
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === "M") { current = [take(), take()]; start = current; points.push(current); }
    else if (command === "L") lineTo([take(), take()]);
    else if (command === "Q") {
      const c = [take(), take()], end = [take(), take()];
      for (let k = 1; k <= steps; k += 1) {
        const t = k / steps, a = (1 - t) ** 2, b = 2 * (1 - t) * t, e = t * t;
        points.push([a * current[0] + b * c[0] + e * end[0], a * current[1] + b * c[1] + e * end[1]]);
      }
      current = end;
    } else if (command === "C") {
      const c1 = [take(), take()], c2 = [take(), take()], end = [take(), take()];
      for (let k = 1; k <= steps; k += 1) {
        const t = k / steps, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, e = t ** 3;
        points.push([a * current[0] + b * c1[0] + c * c2[0] + e * end[0], a * current[1] + b * c1[1] + c * c2[1] + e * end[1]]);
      }
      current = end;
    } else if (command === "Z") lineTo(start);
    else throw new Error(`Comando de path não suportado: ${command}`);
  }
  return points;
}

function solve(matrix, values) {
  const n = values.length;
  const rows = matrix.map((row, i) => [...row, values[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const div = rows[col][col];
    for (let k = col; k <= n; k += 1) rows[col][k] /= div;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = rows[r][col];
      for (let k = col; k <= n; k += 1) rows[r][k] -= f * rows[col][k];
    }
  }
  return rows.map((row) => row[n]);
}

// Homografia que leva os pontos da arte (quad) de volta ao retângulo do vídeo (w x h).
function artToVideo(width, height, quad) {
  const target = [[0, 0], [width, 0], [width, height], [0, height]];
  const m = [], v = [];
  quad.forEach(([x, y], i) => {
    const [u, w] = target[i];
    m.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); v.push(u);
    m.push([0, 0, 0, x, y, 1, -w * x, -w * y]); v.push(w);
  });
  const [a, b, c, d, e, f, g, h] = solve(m, v);
  return ([x, y]) => { const s = g * x + h * y + 1; return [(a * x + b * y + c) / s, (d * x + e * y + f) / s]; };
}

let failed = false;
for (const mode of ["mobile", "desktop"]) {
  const holes = maskPaths(mode);
  for (const device of ["tablet", "phone"]) {
    const { source: [width, height], points } = GEOMETRY[mode][device];
    const project = artToVideo(width, height, points);
    const hole = samplePath(holes[device]).map(project);
    const xs = hole.map(([x]) => x), ys = hole.map(([, y]) => y);
    const margins = { esquerda: Math.min(...xs), direita: width - Math.max(...xs), topo: Math.min(...ys), base: height - Math.max(...ys) };
    const ok = Object.values(margins).every((value) => value >= 0);
    failed ||= !ok;
    const text = Object.entries(margins).map(([edge, value]) => `${edge} ${value.toFixed(1)}px`).join(" · ");
    console.log(`${ok ? "✓" : "✗"} ${mode.padEnd(7)} ${device.padEnd(6)} vídeo ${width}x${height} — menor parte oculta: ${text}`);
  }
}
if (failed) {
  console.error("\nO furo da máscara sai do vídeo em algum ponto (valor negativo): a arte original aparece dentro da tela. Aumente os pontos do vídeo nessa borda.");
  process.exit(1);
}
console.log("\nTodos os vídeos cobrem 100% dos furos da máscara.");
