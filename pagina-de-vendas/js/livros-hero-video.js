import { hydrateHeroVideo, shouldUsePosterOnly } from "./hqs-hero-video.js";

export function mountBooksHeroVideo({
  root = globalThis.document,
  windowRef = globalThis.window,
  navigatorRef = globalThis.navigator,
  Observer = globalThis.IntersectionObserver,
} = {}) {
  const video = root?.querySelector?.("[data-books-hero-video]");
  if (!video || !windowRef) return () => {};
  const reducedMotion = windowRef.matchMedia?.("(prefers-reduced-motion: reduce)") || { matches: false, addEventListener() {} };
  const connection = navigatorRef?.connection || navigatorRef?.mozConnection || navigatorRef?.webkitConnection;
  let isVisible = true;

  const sync = () => {
    const posterOnly = shouldUsePosterOnly({ connection, reducedMotion: reducedMotion.matches });
    video.dataset.posterOnly = String(posterOnly);
    if (posterOnly || !isVisible || root.hidden) {
      video.pause();
      return;
    }
    hydrateHeroVideo(video);
    video.play().catch(() => {});
  };

  reducedMotion.addEventListener?.("change", sync);
  connection?.addEventListener?.("change", sync);
  root.addEventListener?.("visibilitychange", sync);
  let observer;
  if (typeof Observer === "function") {
    observer = new Observer(([entry]) => {
      isVisible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
      sync();
    }, { threshold: [0, 0.25, 0.6] });
    observer.observe(video);
  }
  sync();

  return () => {
    observer?.disconnect?.();
    reducedMotion.removeEventListener?.("change", sync);
    connection?.removeEventListener?.("change", sync);
    root.removeEventListener?.("visibilitychange", sync);
  };
}
