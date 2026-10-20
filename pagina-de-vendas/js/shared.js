import { hasAnalyticsConsent } from "./sales-consent.js";

export const SALES_CONFIG = Object.freeze({
  productName: "Lumeo",
  price: 9.99,
  currency: "BRL",
  checkoutUrls: Object.freeze({ livros: "", hqs: "" }),
  whatsappNumber: "",
  checkoutProvider: "pending",
  metaPixelId: "",
});

export function trackSalesEvent(eventName, details = {}) {
  const payload = { event: eventName, product: SALES_CONFIG.productName, price: SALES_CONFIG.price, ...details };
  if (hasAnalyticsConsent()) {
    window.dataLayer?.push(payload);
    if (typeof window.fbq === "function") window.fbq("trackCustom", eventName, payload);
  }
  window.dispatchEvent(new CustomEvent("lumeo:sales-event", { detail: payload }));
}

export function money(value = SALES_CONFIG.price) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: SALES_CONFIG.currency,
  }).format(value);
}

export function mountHeader(root) {
  if (!root) return;
  const wrapper = document.createElement("div");
  wrapper.className = "sales-header__inner";
  wrapper.innerHTML = `
    <a class="sales-brand" href="index-livros.html" aria-label="${SALES_CONFIG.productName}">
      <img src="assets/optimized/lumeo-logo.webp" alt="" width="160" height="160" />
      <span>${SALES_CONFIG.productName}<small>Leia · Evolua · Transforme</small></span>
    </a>
    <button class="sales-header__cta" type="button" data-sales-cta>Quero acessar</button>`;
  root.replaceChildren(wrapper);
}

export function closeModal() {
  const modal = document.querySelector("[data-sales-modal]");
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  modal.replaceChildren();
}

export function openModal(markup, onOpen) {
  const modal = document.querySelector("[data-sales-modal]");
  if (!modal) return;
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  modal.innerHTML = markup;
  modal.querySelectorAll("[data-sales-close]").forEach((button) => button.addEventListener("click", closeModal));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  }, { once: true });
  onOpen?.(modal);
}

export function showPurchaseNotice() {
  const catalog = document.body?.dataset?.salesCatalog === "hqs" ? "hqs" : "livros";
  const checkoutUrl = SALES_CONFIG.checkoutUrls[catalog];
  trackSalesEvent("lumeo_checkout_intent", { provider: SALES_CONFIG.checkoutProvider, catalog });
  if (checkoutUrl) {
    window.location.assign(checkoutUrl);
    return;
  }
  openModal(`
    <article class="sales-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="sales-checkout-title">
      <button class="sales-modal__close" type="button" data-sales-close aria-label="Fechar">×</button>
      <p class="sales-eyebrow">Lumeo</p>
      <h2 id="sales-checkout-title">Compra ainda não disponível</h2>
      <p>O preço informado é ${money()}. O link de pagamento desta página ainda está sendo configurado; nenhum pagamento foi iniciado.</p>
      <button class="sales-button sales-button--primary" type="button" data-sales-close>Entendi</button>
    </article>`);
}

export function bindCommercialActions(scope = document) {
  scope.querySelectorAll("[data-sales-cta]").forEach((button) => {
    if (button.dataset.salesBound) return;
    button.dataset.salesBound = "true";
    button.addEventListener("click", showPurchaseNotice);
  });

  const whatsApp = document.querySelector("[data-sales-whatsapp]");
  const whatsappNumber = String(SALES_CONFIG.whatsappNumber || "").replace(/\D/g, "");
  if (whatsApp && whatsappNumber.length >= 10 && whatsappNumber.length <= 15) {
    whatsApp.hidden = false;
    whatsApp.addEventListener("click", () => {
      const message = encodeURIComponent("Olá! Gostaria de tirar uma dúvida sobre o aplicativo Lumeo.");
      window.open(`https://wa.me/${whatsappNumber}?text=${message}`, "_blank", "noopener");
    });
  }
}

export function openSynopsis(item) {
  trackSalesEvent("lumeo_book_details_opened", { bookId: item.id, genre: item.genero || "unknown" });
  const summary = item.sinopse || "Uma leitura disponível para explorar no Lumeo.";
  openModal(`
    <article class="sales-modal__dialog sales-book-modal" role="dialog" aria-modal="true" aria-labelledby="sales-modal-title">
      <button class="sales-modal__close" type="button" data-sales-close aria-label="Fechar">×</button>
      <img src="${item.capa}" alt="Capa de ${item.titulo}" />
      <div>
        <p class="sales-eyebrow">${item.genero || "Catálogo Lumeo"}</p>
        <h2 id="sales-modal-title">${item.titulo}</h2>
        <p class="sales-book-modal__author">${item.autor || "Autor não informado"}</p>
        <p>${summary}</p>
        <button class="sales-button sales-button--primary" type="button" data-sales-cta>QUERO LER NO LUMEO</button>
      </div>
    </article>`, bindCommercialActions);
}
