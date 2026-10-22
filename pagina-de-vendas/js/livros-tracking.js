import { SALES_CONFIG } from "./shared.js";
import { META_PIXEL_ID } from "./hqs-tracking-config.js";
import { createMetaPixel, createViewContentController, mergeCheckoutAttribution } from "./hqs-tracking.js";
import { hasAnalyticsConsent, SALES_CONSENT_EVENT } from "./sales-consent.js";

export const LIVROS_EVENT_PAYLOAD = Object.freeze({
  content_name: "Lumeo Livros",
  content_category: "Aplicativo",
  value: SALES_CONFIG.livrosPrice,
  currency: "BRL",
});

export const LIVROS_CHECKOUT_SESSION_KEY = "lumeo:livros:initiate-checkout:v1";

function resolveBooksCtaLocation(target) {
  const button = target?.closest?.("[data-sales-cta]");
  if (!button) return "";
  if (button.dataset.salesCtaLocation) return button.dataset.salesCtaLocation;
  if (button.matches?.(".sales-header__cta")) return "header";
  if (button.closest?.("[data-sales-modal]")) return "modal";
  return "";
}

function readSession(storage) {
  try {
    return storage?.getItem?.(LIVROS_CHECKOUT_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSession(storage) {
  try {
    storage?.setItem?.(LIVROS_CHECKOUT_SESSION_KEY, "1");
  } catch {
    // A compra continua mesmo se o navegador bloquear sessionStorage.
  }
}

export function mountLivrosTracking({
  pixelId = META_PIXEL_ID,
  checkoutUrl = "",
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  Observer = globalThis.IntersectionObserver,
  sessionStorageRef = globalThis.sessionStorage,
  hasConsent = () => hasAnalyticsConsent(),
} = {}) {
  if (!windowRef || !documentRef) return () => {};
  let consented = Boolean(hasConsent());
  let basePixel = consented ? createMetaPixel({ pixelId, windowRef, documentRef }) : null;
  let pageViewTracked = false;
  const tracker = {
    enabled: Boolean(consented && basePixel?.enabled),
    track: (eventName, details = {}) => consented && basePixel?.enabled
      ? basePixel.track(eventName, { ...LIVROS_EVENT_PAYLOAD, ...details }) : false,
  };
  const sendPageView = () => {
    if (!pageViewTracked && tracker.enabled) { tracker.track("PageView"); pageViewTracked = true; }
  };
  sendPageView();
  const onConsentChange = (event) => {
    consented = event?.detail?.choice === "accepted";
    if (consented && !basePixel) basePixel = createMetaPixel({ pixelId, windowRef, documentRef });
    tracker.enabled = Boolean(consented && basePixel?.enabled);
    sendPageView();
  };
  windowRef.addEventListener?.(SALES_CONSENT_EVENT, onConsentChange);

  const trackViewContent = createViewContentController({ tracker });
  const offer = documentRef.querySelector?.(".sales-offer");
  let observer;
  if (offer && typeof Observer === "function") {
    observer = new Observer((entries) => {
      if (entries.some((entry) => entry.target === offer && entry.isIntersecting)) trackViewContent();
    }, { threshold: [0, 0.15] });
    observer.observe(offer);
  }

  const onScroll = () => {
    const root = documentRef.documentElement;
    const scrollTop = Number(windowRef.scrollY ?? root?.scrollTop ?? 0);
    const scrollable = Math.max(1, Number(root?.scrollHeight || 0) - Number(windowRef.innerHeight || 0));
    if (scrollTop / scrollable >= 0.5) trackViewContent();
  };
  windowRef.addEventListener?.("scroll", onScroll, { passive: true });

  let checkoutTrackedInMemory = false;
  const onCheckoutClick = (event) => {
    const ctaLocation = resolveBooksCtaLocation(event.target);
    if (!ctaLocation || !checkoutUrl) return;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    if (!checkoutTrackedInMemory && !readSession(sessionStorageRef)) {
      if (consented && tracker.enabled) tracker.track("InitiateCheckout", { cta_location: ctaLocation });
      checkoutTrackedInMemory = true;
      writeSession(sessionStorageRef);
    }
    windowRef.location.assign(mergeCheckoutAttribution(checkoutUrl, windowRef.location.href));
  };
  documentRef.addEventListener?.("click", onCheckoutClick, true);

  return () => {
    observer?.disconnect?.();
    windowRef.removeEventListener?.("scroll", onScroll);
    windowRef.removeEventListener?.(SALES_CONSENT_EVENT, onConsentChange);
    documentRef.removeEventListener?.("click", onCheckoutClick, true);
  };
}
