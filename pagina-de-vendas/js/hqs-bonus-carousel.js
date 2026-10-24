export function mountHqsBonusCarousel(root = document) {
  const track = root.querySelector("[data-hqs-bonus-track]");
  const cards = [...(track?.querySelectorAll("[data-hqs-bonus-card]") || [])];
  if (!track || cards.length < 2 || track.dataset.marqueeMounted === "true") return;

  track.dataset.marqueeMounted = "true";
  cards.forEach((card) => {
    const clone = card.cloneNode(true);
    clone.removeAttribute("data-hqs-bonus-card");
    clone.setAttribute("aria-hidden", "true");
    clone.setAttribute("inert", "");
    clone.dataset.hqsBonusClone = "true";
    track.append(clone);
  });

  window.requestAnimationFrame(() => track.classList.add("is-marquee-ready"));
}
