export function shouldShowMobileCta({ heroVisible = false, offerVisible = false, extraVisible = false } = {}) {
  return !heroVisible && !offerVisible && !extraVisible;
}

export function mountMobileCtaVisibility({
  root = globalThis.document,
  Observer = globalThis.IntersectionObserver,
  // Other in-page CTAs that also hide the fixed button while visible (e.g. a bonus section).
  // Without it, only the hero and offer CTAs count, as before.
  extraCtaSelectors = [],
} = {}) {
  const button = root?.querySelector?.(".sales-mobile-cta");
  const heroCta = root?.querySelector?.("[data-hqs-hero-cta]");
  const offerCta = root?.querySelector?.("[data-hqs-offer-cta]");
  if (!button || !heroCta || typeof Observer !== "function") return () => {};

  const originalTabIndex = button.getAttribute("tabindex");
  const extraCtas = extraCtaSelectors.map((selector) => root.querySelector(selector)).filter(Boolean);
  const visibleExtras = new Set();
  const state = { heroVisible: true, offerVisible: false, extraVisible: false };

  const render = () => {
    const visible = shouldShowMobileCta(state);
    button.dataset.mobileCtaReady = "true";
    button.classList.toggle("is-visible", visible);
    if (visible) {
      button.removeAttribute("aria-hidden");
      if (originalTabIndex === null) button.removeAttribute("tabindex");
      else button.setAttribute("tabindex", originalTabIndex);
      return;
    }
    button.setAttribute("aria-hidden", "true");
    button.setAttribute("tabindex", "-1");
  };

  render();
  const observer = new Observer((entries) => {
    entries.forEach((entry) => {
      const isVisible = entry.isIntersecting && entry.intersectionRatio > 0;
      if (entry.target === heroCta) state.heroVisible = isVisible;
      if (entry.target === offerCta) state.offerVisible = isVisible;
      if (extraCtas.includes(entry.target)) {
        if (isVisible) visibleExtras.add(entry.target);
        else visibleExtras.delete(entry.target);
      }
    });
    state.extraVisible = visibleExtras.size > 0;
    render();
  }, { threshold: [0, 0.01, 0.5, 1] });

  observer.observe(heroCta);
  if (offerCta) observer.observe(offerCta);
  extraCtas.forEach((cta) => observer.observe(cta));
  return () => observer.disconnect();
}
