import { openModal } from "./shared.js";

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
})[character]);

export function mountTestimonials(root = document.querySelector("[data-testimonials-carousel]")) {
  const track = root?.querySelector("[data-testimonials-track]");
  const previous = root?.querySelector("[data-testimonials-previous]");
  const next = root?.querySelector("[data-testimonials-next]");
  const indicatorsRoot = root?.querySelector("[data-testimonials-indicators]");
  if (!root || !track || !previous || !next || !indicatorsRoot) return;

  const cards = [...track.querySelectorAll(".sales-testimonial")];
  if (!cards.length) return;

  const closestIndex = () => cards.reduce((best, card, index) => (
    Math.abs(card.offsetLeft - track.scrollLeft) < Math.abs(cards[best].offsetLeft - track.scrollLeft) ? index : best
  ), 0);

  const goTo = (index) => {
    const target = Math.max(0, Math.min(cards.length - 1, index));
    track.scrollTo({ left: cards[target].offsetLeft, behavior: "smooth" });
  };

  const indicators = cards.map((_, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Ir ao relato ${index + 1}`);
    button.addEventListener("click", () => goTo(index));
    indicatorsRoot.append(button);
    return button;
  });

  const sync = () => {
    const active = closestIndex();
    indicators.forEach((button, index) => button.setAttribute("aria-current", String(index === active)));
    previous.disabled = active === 0;
    next.disabled = active === cards.length - 1;
  };

  previous.addEventListener("click", () => goTo(closestIndex() - 1));
  next.addEventListener("click", () => goTo(closestIndex() + 1));
  track.addEventListener("scroll", sync, { passive: true });

  track.querySelectorAll("[data-testimonial-image]").forEach((button) => {
    button.addEventListener("click", () => openModal(`
      <article class="sales-modal__dialog sales-testimonial-modal" role="dialog" aria-modal="true" aria-label="Relato ampliado">
        <button class="sales-modal__close" type="button" data-sales-close aria-label="Fechar">×</button>
        <div class="sales-testimonial-modal__image" data-testimonial-avatar="${escapeHtml(button.dataset.testimonialAvatar)}">
          <img src="${escapeHtml(button.dataset.testimonialImage)}" alt="${escapeHtml(button.dataset.testimonialAlt)}" />
        </div>
      </article>`));
  });

  sync();
}
