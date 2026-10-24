const ART_BREAKPOINT = 768;

// Antes de trocar um vídeo ou mexer nestes pontos, leia HERO-HQS-VIDEOS.md (medidas, margens e checklist).
export const GEOMETRY = {
  mobile: {
    art: [941, 1672],
    // O vídeo avança alguns pixels sob a moldura. A máscara SVG define o recorte visível exato.
    tablet: { source: [720, 546], points: [[116, 758], [676, 814], [694, 1229], [65, 1184]] },
    phone: { source: [360, 830], points: [[694, 804], [893, 789], [889, 1270], [664, 1264]] },
  },
  desktop: {
    art: [1672, 941],
    tablet: { source: [720, 546], points: [[803, 254], [1370, 357], [1356, 750], [744, 708]] },
    phone: { source: [360, 830], points: [[1387, 319], [1600, 302.5], [1579.5, 791], [1349, 779.5]] },
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
      for (let index = column; index <= size; index += 1) {
        rows[row][index] -= factor * rows[column][index];
      }
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

export function mountHqsArtHero() {
  const hero = document.querySelector(".hqs-art-hero");
  const tablet = hero?.querySelector(".hqs-art-hero__tablet-screen");
  const phone = hero?.querySelector(".hqs-art-hero__phone-screen");
  if (!hero || !tablet || !phone) return;

  let lastSignature = "";
  const update = () => {
    const mode = window.innerWidth >= ART_BREAKPOINT ? "desktop" : "mobile";
    const geometry = GEOMETRY[mode];
    const bounds = hero.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const signature = `${mode}:${bounds.width.toFixed(3)}:${bounds.height.toFixed(3)}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    const scaleX = bounds.width / geometry.art[0];
    const scaleY = bounds.height / geometry.art[1];
    applyProjection(tablet, geometry.tablet, scaleX, scaleY);
    applyProjection(phone, geometry.phone, scaleX, scaleY);
    hero.dataset.artMode = mode;
  };

  const scheduleUpdate = () => update();
  const resizeObserver = new ResizeObserver(scheduleUpdate);
  const mediaQuery = window.matchMedia(`(min-width: ${ART_BREAKPOINT}px)`);
  resizeObserver.observe(hero);
  window.addEventListener("resize", scheduleUpdate, { passive: true });
  mediaQuery.addEventListener("change", scheduleUpdate);
  update();

  const whatsapp = document.querySelector("[data-sales-whatsapp]");
  const nudge = document.querySelector(".hqs-whatsapp-nudge");
  if (whatsapp && "IntersectionObserver" in window) {
    const overlapObserver = new IntersectionObserver(([entry]) => {
      const blocked = entry.isIntersecting;
      whatsapp.classList.toggle("sales-whatsapp--clear-hero-phone", blocked);
      nudge?.classList.toggle("hqs-whatsapp-nudge--clear-hero-phone", blocked);
      if (blocked) whatsapp.setAttribute("tabindex", "-1");
      else whatsapp.removeAttribute("tabindex");
    }, { threshold: 0.05 });
    overlapObserver.observe(phone);
  }
}
