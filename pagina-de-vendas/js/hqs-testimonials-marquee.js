import { openModal } from "./shared.js";

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
})[character]);

export function mountHqsTestimonials(root = document.querySelector("[data-testimonials-carousel]")) {
  const track = root?.querySelector("[data-testimonials-track]");
  const cards = [...(track?.querySelectorAll("[data-testimonial-card]") || [])];
  if (!track || !cards.length || track.dataset.marqueeMounted === "true") return;

  track.dataset.marqueeMounted = "true";
  cards.forEach((card) => {
    const clone = card.cloneNode(true);
    clone.removeAttribute("data-testimonial-card");
    clone.removeAttribute("tabindex");
    clone.removeAttribute("role");
    clone.removeAttribute("aria-label");
    clone.setAttribute("aria-hidden", "true");
    clone.setAttribute("inert", "");
    clone.dataset.testimonialClone = "true";
    track.append(clone);
  });

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let previousTime = 0;
  let interacting = false;
  let resumeTimer = 0;
  let pointerStartX = 0;
  let pointerMoved = false;

  const loopWidth = () => track.scrollWidth / 2;
  const animate = (time) => {
    if (!previousTime) previousTime = time;
    const elapsed = Math.min(time - previousTime, 50);
    previousTime = time;
    if (!interacting && !reducedMotion.matches) {
      track.scrollLeft += elapsed * .022;
      const width = loopWidth();
      if (width && track.scrollLeft >= width) track.scrollLeft -= width;
    }
    frame = window.requestAnimationFrame(animate);
  };

  const pauseForInteraction = () => {
    interacting = true;
    window.clearTimeout(resumeTimer);
  };
  const resumeAfterInteraction = () => {
    window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(() => { interacting = false; }, 900);
  };

  const openCard = (card) => openModal(`
    <article class="sales-modal__dialog sales-testimonial-modal" role="dialog" aria-modal="true" aria-label="Relato ampliado">
      <button class="sales-modal__close" type="button" data-sales-close aria-label="Fechar">×</button>
      <div class="sales-testimonial-modal__image" data-testimonial-avatar="${escapeHtml(card.dataset.testimonialAvatar)}">
        <img src="${escapeHtml(card.dataset.testimonialImage)}" alt="${escapeHtml(card.dataset.testimonialAlt)}" />
      </div>
    </article>`);

  cards.forEach((card) => {
    card.addEventListener("click", (event) => {
      if (pointerMoved) { event.preventDefault(); pointerMoved = false; return; }
      openCard(card);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openCard(card);
    });
  });

  track.addEventListener("pointerdown", (event) => {
    pointerStartX = event.clientX;
    pointerMoved = false;
    pauseForInteraction();
  }, { passive: true });
  track.addEventListener("pointermove", (event) => {
    if (interacting && Math.abs(event.clientX - pointerStartX) > 8) pointerMoved = true;
  }, { passive: true });
  track.addEventListener("pointerup", resumeAfterInteraction, { passive: true });
  track.addEventListener("pointercancel", resumeAfterInteraction, { passive: true });
  track.addEventListener("touchend", resumeAfterInteraction, { passive: true });
  track.addEventListener("wheel", () => { pauseForInteraction(); resumeAfterInteraction(); }, { passive: true });

  frame = window.requestAnimationFrame(animate);
  window.addEventListener("pagehide", () => window.cancelAnimationFrame(frame), { once: true });
}
