import { mountHqsMarquee } from "./hqs-marquee.js?v=20261024-4";

// Mesmo componente do carrossel de bônus de HQs: loop infinito, pausa ao segurar, arraste
// exato, retomada suave e rolagem vertical livre. Aqui os bônus andam para a esquerda,
// no sentido contrário ao carrossel de depoimentos de Livros.
export function mountLivrosBonusCarousel(root = document) {
  const track = root.querySelector("[data-livros-bonus-track]");
  const marquee = mountHqsMarquee({
    viewport: track?.closest(".livros-bonus-premium__viewport"),
    track,
    cardSelector: "[data-livros-bonus-card]",
    direction: -1,
    speed: 26,
  });
  return () => marquee?.pause();
}
