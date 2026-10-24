// Coordenadas medidas nas artes aprovadas de Livros. A ordem dos pontos é:
// superior esquerdo, superior direito, inferior direito, inferior esquerdo.
export const LIVROS_HERO_GEOMETRY = {
  mobile: {
    art: [1024, 1536],
    tablet: { source: [720, 458], points: [[164, 674], [676, 770], [710, 1112], [115, 1058]] },
    phone: { source: [360, 830], points: [[758, 738], [936, 724], [934, 1131], [721, 1118]] },
  },
  desktop: {
    art: [1672, 941],
    tablet: { source: [720, 458], points: [[802, 230], [1378, 348], [1350, 748], [728, 690]] },
    phone: { source: [360, 830], points: [[1391, 354], [1586, 339], [1574, 778], [1372, 770]] },
  },
};

function solveLinearSystem(matrix, values) {
  const size = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    if (Math.abs(divisor) < 1e-12) throw new Error("Quadrilátero inválido para homografia.");
    for (let index = column; index <= size; index += 1) rows[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index <= size; index += 1) rows[row][index] -= factor * rows[column][index];
    }
  }
  return rows.map((row) => row[size]);
}

function homography(width, height, points) {
  const source = [[0, 0], [width, 0], [width, height], [0, height]];
  const equations = [];
  const values = [];
  source.forEach(([x, y], index) => {
    const [u, v] = points[index];
    equations.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    equations.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  });
  return solveLinearSystem(equations, values);
}

function toMatrix3d([h11, h12, h13, h21, h22, h23, h31, h32]) {
  return `matrix3d(${[
    h11, h21, 0, h31,
    h12, h22, 0, h32,
    0, 0, 1, 0,
    h13, h23, 0, 1,
  ].map((value) => Number(value.toFixed(10))).join(",")})`;
}

function applyProjection(element, device, scaleX, scaleY) {
  const [width, height] = device.source;
  const points = device.points.map(([x, y]) => [x * scaleX, y * scaleY]);
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  element.style.transform = toMatrix3d(homography(width, height, points));
}

export function mountLivrosArtHero({ root = document, windowRef = window } = {}) {
  const hero = root.querySelector(".livros-art-hero");
  const tablet = hero?.querySelector(".livros-art-hero__tablet-screen");
  const phone = hero?.querySelector(".livros-art-hero__phone-screen");
  if (!hero || !tablet || !phone) return () => {};

  let lastSignature = "";
  const update = () => {
    const bounds = hero.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    // A proporção renderizada acompanha o mesmo media query das artes e evita
    // uma leitura intermediária do viewport exatamente durante o breakpoint.
    const mode = bounds.width / bounds.height > 1 ? "desktop" : "mobile";
    const geometry = LIVROS_HERO_GEOMETRY[mode];
    const signature = `${mode}:${bounds.width.toFixed(3)}:${bounds.height.toFixed(3)}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    applyProjection(tablet, geometry.tablet, bounds.width / geometry.art[0], bounds.height / geometry.art[1]);
    applyProjection(phone, geometry.phone, bounds.width / geometry.art[0], bounds.height / geometry.art[1]);
    // Só a moldura do modo visível baixa a arte: a do outro modo fica com display: none.
    const overlay = hero.querySelector(`.livros-art-hero__frame-overlay--${mode} image[data-href]`);
    if (overlay && !overlay.getAttribute("href")) overlay.setAttribute("href", overlay.dataset.href);
    hero.dataset.artMode = mode;
  };

  // Mesmo padrão de HQs: os vídeos da hero só começam a baixar depois da arte, que é o que
  // aparece primeiro na tela.
  const videos = [...hero.querySelectorAll("video")];
  const loadHeroVideos = () => {
    if (windowRef.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    videos.forEach((video) => {
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      const source = video.querySelector("source[data-src]");
      if (source && !source.getAttribute("src")) { source.src = source.dataset.src; video.load(); }
      video.play().catch(() => {});
    });
  };
  const art = hero.querySelector(".livros-art-hero__art img");
  if (!art || art.complete) loadHeroVideos();
  else {
    art.addEventListener("load", loadHeroVideos, { once: true });
    art.addEventListener("error", loadHeroVideos, { once: true });
  }

  const resizeObserver = new ResizeObserver(update);
  resizeObserver.observe(hero);
  windowRef.addEventListener("resize", update, { passive: true });
  update();

  const whatsapp = root.querySelector("[data-sales-whatsapp]");
  const nudge = root.querySelector(".hqs-whatsapp-nudge");
  let overlapObserver;
  if (whatsapp && "IntersectionObserver" in windowRef) {
    overlapObserver = new IntersectionObserver(([entry]) => {
      const blocked = entry.isIntersecting;
      whatsapp.classList.toggle("sales-whatsapp--clear-livros-hero", blocked);
      nudge?.classList.toggle("hqs-whatsapp-nudge--clear-livros-hero", blocked);
    }, { threshold: 0.05 });
    overlapObserver.observe(phone);
  }

  return () => {
    resizeObserver.disconnect();
    overlapObserver?.disconnect();
    windowRef.removeEventListener("resize", update);
  };
}
