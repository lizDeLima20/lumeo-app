import { META_PIXEL_ID } from "./hqs-tracking-config.js";

export const HQS_EVENT_PAYLOAD = Object.freeze({
  content_name: "Lumeo HQs",
  content_category: "Aplicativo",
  value: 9.99,
  currency: "BRL",
});

export const CHECKOUT_SESSION_KEY = "lumeo:hqs:initiate-checkout:v1";
const META_SCRIPT_URL = "https://connect.facebook.net/en_US/fbevents.js";

function createPixelQueue(windowRef) {
  if (typeof windowRef.fbq === "function") return windowRef.fbq;
  const fbq = function pixelQueue() {
    if (typeof fbq.callMethod === "function") fbq.callMethod.apply(fbq, arguments);
    else fbq.queue.push(arguments);
  };
  if (!windowRef._fbq) windowRef._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  windowRef.fbq = fbq;
  return fbq;
}

function injectPixelScript(documentRef) {
  if (documentRef.querySelector?.(`script[src="${META_SCRIPT_URL}"]`)) return;
  const script = documentRef.createElement("script");
  script.async = true;
  script.src = META_SCRIPT_URL;
  const firstScript = documentRef.getElementsByTagName?.("script")?.[0];
  if (firstScript?.parentNode) firstScript.parentNode.insertBefore(script, firstScript);
  else documentRef.head?.append?.(script);
}

export function createMetaPixel({
  pixelId = META_PIXEL_ID,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
} = {}) {
  const normalizedId = String(pixelId || "").trim();
  if (!normalizedId || !windowRef || !documentRef) {
    return { enabled: false, track: () => false };
  }

  const fbq = createPixelQueue(windowRef);
  injectPixelScript(documentRef);
  fbq("init", normalizedId);

  return {
    enabled: true,
    track(eventName, details = {}) {
      fbq("track", eventName, { ...HQS_EVENT_PAYLOAD, ...details });
      return true;
    },
  };
}

export function mergeCheckoutAttribution(checkoutUrl, pageUrl) {
  if (!checkoutUrl) return "";
  const page = new URL(pageUrl);
  const checkout = new URL(checkoutUrl, page);
  page.searchParams.forEach((value, key) => {
    if (key === "fbclid" || key.toLowerCase().startsWith("utm_")) {
      checkout.searchParams.set(key, value);
    }
  });
  return checkout.toString();
}

export function resolveCtaLocation(target) {
  const button = target?.closest?.("[data-sales-cta]");
  if (!button) return "";
  if (button.dataset.hqsCtaLocation) return button.dataset.hqsCtaLocation;
  if (button.matches?.(".sales-header__cta")) return "header";
  if (button.matches?.("[data-hqs-hero-cta]")) return "hero";
  if (button.matches?.("[data-hqs-offer-cta]")) return "offer";
  if (button.matches?.(".sales-mobile-cta")) return "sticky";
  if (button.closest?.("[data-sales-modal]")) return "modal";
  return "";
}

function wasCheckoutTracked(storage) {
  try {
    return storage?.getItem?.(CHECKOUT_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markCheckoutTracked(storage) {
  try {
    storage?.setItem?.(CHECKOUT_SESSION_KEY, "1");
  } catch {
    // Navegação continua mesmo quando o navegador bloqueia sessionStorage.
  }
}

export function createViewContentController({ tracker }) {
  let tracked = false;
  return () => {
    if (tracked || !tracker?.enabled) return false;
    tracked = tracker.track("ViewContent");
    return tracked;
  };
}

export function mountHqsTracking({
  pixelId = META_PIXEL_ID,
  checkoutUrl = "",
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  Observer = globalThis.IntersectionObserver,
  sessionStorageRef = globalThis.sessionStorage,
} = {}) {
  if (!windowRef || !documentRef) return () => {};
  const tracker = createMetaPixel({ pixelId, windowRef, documentRef });
  if (tracker.enabled) tracker.track("PageView");
  let checkoutTrackedInMemory = false;

  const trackViewContent = createViewContentController({ tracker });
  const offer = documentRef.querySelector?.(".hqs-offer");
  let observer;
  if (offer && typeof Observer === "function") {
    observer = new Observer((entries) => {
      if (entries.some((entry) => entry.target === offer && entry.isIntersecting)) {
        trackViewContent();
      }
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

  const onCheckoutClick = (event) => {
    const ctaLocation = resolveCtaLocation(event.target);
    if (!ctaLocation || !checkoutUrl) return;
    const checkoutTarget = mergeCheckoutAttribution(checkoutUrl, windowRef.location.href);
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    if (!checkoutTrackedInMemory && !wasCheckoutTracked(sessionStorageRef)) {
      if (tracker.enabled) tracker.track("InitiateCheckout", { cta_location: ctaLocation });
      checkoutTrackedInMemory = true;
      markCheckoutTracked(sessionStorageRef);
    }
    windowRef.location.assign(checkoutTarget);
  };
  documentRef.addEventListener?.("click", onCheckoutClick, true);

  return () => {
    observer?.disconnect?.();
    windowRef.removeEventListener?.("scroll", onScroll);
    documentRef.removeEventListener?.("click", onCheckoutClick, true);
  };
}
