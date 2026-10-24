// Carrossel em loop infinito para a página de HQs (bônus e depoimentos).
// - Anda sozinho com transform; segurar pausa na hora; arrastar na horizontal move os cards
//   exatamente com o dedo; soltar retoma a velocidade suavemente, sem voltar a posição.
// - Gesto vertical é da página: o viewport usa touch-action: pan-y e nenhum handler chama
//   preventDefault, então o navegador rola a página normalmente.
// - Cópias para o loop são aria-hidden e fora do Tab, mas continuam tocáveis.

const DRAG_THRESHOLD = 6;
const RESUME_TIME = 0.45;

// dragThreshold/horizontalRatio: quanto o dedo precisa andar, e quão mais na horizontal que
// na vertical, para virar arraste. Valores maiores protegem deslizes verticais que começam tortos.
export function mountHqsMarquee({ viewport, track, cardSelector, direction = -1, speed = 26, onTap, dragThreshold = DRAG_THRESHOLD, horizontalRatio = 1 }) {
  if (!viewport || !track || track.dataset.marqueeMounted === "true") return null;
  const originals = [...track.querySelectorAll(cardSelector)];
  if (originals.length < 2) return null;
  track.dataset.marqueeMounted = "true";
  viewport.classList.add("hqs-marquee");
  track.classList.add("hqs-marquee__track");
  track.querySelectorAll("img").forEach((image) => { image.draggable = false; });

  const cardAttribute = cardSelector.match(/^\[([\w-]+)\]$/)?.[1];
  const clones = [];
  const addSet = () => {
    originals.forEach((card) => {
      const clone = card.cloneNode(true);
      if (cardAttribute) clone.removeAttribute(cardAttribute);
      clone.setAttribute("aria-hidden", "true");
      clone.removeAttribute("tabindex");
      clone.removeAttribute("aria-label");
      clone.removeAttribute("role");
      clone.dataset.marqueeClone = "true";
      clone.querySelectorAll("a, button, [tabindex]").forEach((node) => node.setAttribute("tabindex", "-1"));
      track.append(clone);
      clones.push(clone);
    });
  };

  let setWidth = 0;
  let position = 0;
  const measure = () => {
    if (!clones.length) addSet();
    // getBoundingClientRect tem precisão subpixel; offsetLeft arredondaria e a volta do loop pularia.
    setWidth = clones[0].getBoundingClientRect().left - originals[0].getBoundingClientRect().left;
    if (setWidth <= 0) return;
    const needed = Math.ceil(viewport.clientWidth / setWidth) + 1;
    while (clones.length / originals.length + 1 < needed) addSet();
    position = wrap(position);
    render();
  };
  const wrap = (value) => (setWidth ? (((value % setWidth) - setWidth) % setWidth) : value);
  const render = () => { track.style.transform = `translate3d(${position.toFixed(2)}px, 0, 0)`; };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let factor = 1;
  let held = false;
  let paused = false;
  let visible = false;
  let frame = 0;
  let lastTime = 0;

  const tick = (time) => {
    frame = 0;
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
    lastTime = time;
    const target = held || paused || reducedMotion.matches ? 0 : 1;
    factor = target === 0 ? 0 : factor + (1 - factor) * (1 - Math.exp(-dt / RESUME_TIME));
    if (factor > 0.0005 && setWidth) {
      position = wrap(position + direction * speed * factor * dt);
      render();
    }
    if (visible && !reducedMotion.matches) frame = window.requestAnimationFrame(tick);
  };
  const start = () => {
    if (frame || !visible || reducedMotion.matches) return;
    lastTime = 0;
    frame = window.requestAnimationFrame(tick);
  };
  const stop = () => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
  };

  // Gestos: decide a direção depois de um pequeno limiar.
  let pointerId = null;
  let mode = "idle";
  let startX = 0;
  let startY = 0;
  let startPosition = 0;
  let suppressClickUntil = 0;

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || pointerId !== null) return;
    pointerId = event.pointerId;
    mode = "pending";
    startX = event.clientX;
    startY = event.clientY;
    startPosition = position;
    held = true;
    factor = 0;
  });
  viewport.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (mode === "pending") {
      if (Math.abs(dx) > dragThreshold && Math.abs(dx) > Math.abs(dy) * horizontalRatio) {
        mode = "drag";
        viewport.classList.add("is-dragging");
        try { viewport.setPointerCapture(pointerId); } catch {}
      } else if (Math.abs(dy) > dragThreshold) {
        release();
        return;
      }
    }
    if (mode === "drag") {
      position = wrap(startPosition + dx);
      render();
    }
  });
  const release = () => {
    if (mode === "drag") suppressClickUntil = performance.now() + 350;
    if (pointerId !== null && viewport.hasPointerCapture?.(pointerId)) viewport.releasePointerCapture(pointerId);
    viewport.classList.remove("is-dragging");
    pointerId = null;
    mode = "idle";
    held = false;
    start();
  };
  viewport.addEventListener("pointerup", (event) => { if (event.pointerId === pointerId) release(); });
  viewport.addEventListener("pointercancel", (event) => { if (event.pointerId === pointerId) release(); });
  // No toque o card tem captura implícita; ao passá-la para o viewport, o card emite
  // lostpointercapture, que sobe até aqui. Só a perda de captura do próprio viewport conta.
  viewport.addEventListener("lostpointercapture", (event) => {
    if (event.target === viewport && event.pointerId === pointerId && mode === "drag") release();
  });

  viewport.addEventListener("click", (event) => {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const card = event.target.closest(`${cardSelector}, [data-marquee-clone]`);
    if (card && onTap) onTap(card);
  }, true);

  const observer = "IntersectionObserver" in window
    ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; visible ? start() : stop(); })
    : null;
  if (observer) observer.observe(viewport);
  else { visible = true; }

  new ResizeObserver(measure).observe(viewport);
  reducedMotion.addEventListener("change", () => (reducedMotion.matches ? stop() : start()));
  measure();
  start();

  return {
    pause() { paused = true; factor = 0; },
    resume() { paused = false; start(); },
    get position() { return position; },
  };
}
