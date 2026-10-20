export const SALES_CONSENT_KEY = "lumeo:sales-analytics-consent:v1";
export const SALES_CONSENT_EVENT = "lumeo:sales-analytics-consent-change";

export function hasAnalyticsConsent(storage = globalThis.localStorage) {
  try { return storage?.getItem?.(SALES_CONSENT_KEY) === "accepted"; }
  catch { return false; }
}

function saveChoice(storage, choice) {
  try { storage?.setItem?.(SALES_CONSENT_KEY, choice); }
  catch { /* A decisão ainda vale para a sessão atual. */ }
}

export function mountAnalyticsConsent({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  storage = globalThis.localStorage,
  EventCtor = globalThis.CustomEvent,
} = {}) {
  const panel = documentRef?.querySelector?.("[data-sales-consent]");
  if (!panel) return () => {};
  const body = documentRef.body;
  const show = () => { panel.hidden = false; body?.classList?.add?.("sales-consent-open"); };
  const hide = () => { panel.hidden = true; body?.classList?.remove?.("sales-consent-open"); };
  const notify = (choice) => {
    const event = EventCtor ? new EventCtor(SALES_CONSENT_EVENT, { detail: { choice } }) : { type: SALES_CONSENT_EVENT, detail: { choice } };
    windowRef?.dispatchEvent?.(event);
  };
  if (hasAnalyticsConsent(storage) || (() => { try { return storage?.getItem?.(SALES_CONSENT_KEY) === "rejected"; } catch { return false; } })()) hide();
  else show();

  const accept = panel.querySelector?.("[data-consent-accept]");
  const reject = panel.querySelector?.("[data-consent-reject]");
  const open = documentRef.querySelector?.("[data-sales-open-consent]");
  const onAccept = () => { saveChoice(storage, "accepted"); hide(); notify("accepted"); };
  const onReject = () => { saveChoice(storage, "rejected"); hide(); notify("rejected"); };
  const onOpen = () => show();
  accept?.addEventListener?.("click", onAccept);
  reject?.addEventListener?.("click", onReject);
  open?.addEventListener?.("click", onOpen);
  return () => {
    accept?.removeEventListener?.("click", onAccept);
    reject?.removeEventListener?.("click", onReject);
    open?.removeEventListener?.("click", onOpen);
    hide();
  };
}
