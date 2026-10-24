import { openModal } from "./shared.js";
import { mountHqsMarquee } from "./hqs-marquee.js?v=20261024-4";

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
  if (!track || !cards.length) return;

  const modal = document.querySelector("[data-sales-modal]");
  let marquee = null;
  let returnFocusTo = null;

  // Ao fechar o modal: o carrossel retoma de onde parou e o foco volta ao card (teclado).
  if (modal) {
    new MutationObserver(() => {
      if (!modal.hidden) return;
      marquee?.resume();
      if (returnFocusTo) { returnFocusTo.focus({ preventScroll: true }); returnFocusTo = null; }
    }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
  }

  const openCard = (card, fromKeyboard = false) => {
    const original = cards.find((item) => item.dataset.testimonialImage === card.dataset.testimonialImage) || card;
    returnFocusTo = fromKeyboard ? original : null;
    marquee?.pause();
    openModal(`
    <article class="sales-modal__dialog sales-testimonial-modal" role="dialog" aria-modal="true" aria-label="Relato ampliado">
      <button class="sales-modal__close" type="button" data-sales-close aria-label="Fechar">×</button>
      <div class="sales-testimonial-modal__image" data-testimonial-avatar="${escapeHtml(original.dataset.testimonialAvatar)}">
        <img src="${escapeHtml(original.dataset.testimonialImage)}" alt="${escapeHtml(original.dataset.testimonialAlt)}" />
      </div>
    </article>`, (dialog) => dialog.querySelector("[data-sales-close]")?.focus({ preventScroll: true }));
  };

  cards.forEach((card) => {
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openCard(card, true);
    });
  });

  // Depoimentos andam para a esquerda, no sentido contrário ao carrossel de bônus.
  marquee = mountHqsMarquee({
    viewport: root,
    track,
    cardSelector: "[data-testimonial-card]",
    direction: -1,
    speed: 22,
    dragThreshold: 8,
    horizontalRatio: 1.4,
    onTap: (card) => openCard(card),
  });
}
