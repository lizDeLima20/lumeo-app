import { mountHqsMarquee } from "./hqs-marquee.js?v=20261024-4";

// Bônus andam para a direita, no sentido contrário ao carrossel de depoimentos.
export function mountHqsBonusCarousel(root = document) {
  const track = root.querySelector("[data-hqs-bonus-track]");
  mountHqsMarquee({
    viewport: track?.closest(".hqs-bonus-premium__viewport"),
    track,
    cardSelector: "[data-hqs-bonus-card]",
    direction: 1,
    speed: 26,
  });
}
