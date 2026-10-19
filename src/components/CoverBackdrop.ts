/**
 * The one way a flat cover (cards, previews, collections, audiobooks) fits its box: the whole
 * cover, centred (object-fit: contain), over a blurred, darkened copy of itself that fills
 * whatever the cover's shape leaves free. Never a crop, never a zoom.
 *
 * The backdrop only loads when it is needed - when the cover's shape differs from its box's -
 * so a shelf of covers that already fit does not carry a second image each.
 */
export function bindCoverBackdrop(host: HTMLElement, image: HTMLImageElement, targetRatio?: () => number | undefined): void {
  host.classList.add("cover-fit"); image.classList.add("cover-fit__image");
  const backdrop = document.createElement("img");
  backdrop.className = "cover-fit__backdrop"; backdrop.alt = ""; backdrop.setAttribute("aria-hidden", "true");
  backdrop.decoding = "async"; backdrop.draggable = false;
  host.prepend(backdrop);
  const sync = (): void => {
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) return;
    const target = targetRatio?.() ?? (host.clientWidth > 0 && host.clientHeight > 0 ? host.clientWidth / host.clientHeight : undefined);
    const band = target === undefined || Math.abs(width / height - target) / target > .03;
    const source = image.currentSrc || image.src;
    if (band && backdrop.getAttribute("src") !== source) { backdrop.referrerPolicy = image.referrerPolicy; backdrop.src = source; }
    else if (!band) backdrop.removeAttribute("src");
  };
  image.addEventListener("load", sync);
  if (image.complete) sync();
}
