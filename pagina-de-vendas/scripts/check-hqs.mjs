import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(resolve(pageRoot, relativePath), "utf8");
const html = read("index-hqs.html");
const hqsCss = read("css/hqs.css");
const conversionCss = read("css/hqs-conversion.css");
const premiumHeroCss = read("css/hqs-premium-hero-v2.css");
const hqsJs = read("js/hqs.js");
const mobileCtaJs = read("js/mobile-cta.js");
const trackingJs = read("js/hqs-tracking.js");
const trackingConfigJs = read("js/hqs-tracking-config.js");
const sharedJs = read("js/shared.js");
const relevantSource = [html, hqsCss, conversionCss, premiumHeroCss, hqsJs, mobileCtaJs, trackingJs, trackingConfigJs].join("\n");

const tests = [];
const test = (name, callback) => tests.push([name, callback]);
const normalizeText = (markup) => markup
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .replace(/\s+([.,!?;:])/g, "$1")
  .trim();
const sha256 = (relativePath) => createHash("sha256").update(readFileSync(resolve(pageRoot, relativePath))).digest("hex");

test("headline da hero é a copy escolhida", () => {
  const headline = html.match(/<h1\s+id="sales-title"[^>]*>([\s\S]*?)<\/h1>/)?.[1];
  assert.ok(headline, "H1 #sales-title não encontrado");
  assert.equal(normalizeText(headline), "Depois que você vê suas HQs no Lumeo, não quer voltar atrás.");
  assert.match(html, /Organize, visualize e leia sua coleção com uma experiência muito mais envolvente no Android\./);
  assert.match(html, /De <del>R\$ 39,99<\/del><br \/>por<\/span><strong data-sales-price>R\$ 9,99<\/strong>/);
});

test("hero sem altura baseada na viewport", () => {
  const css = `${hqsCss}\n${conversionCss}`;
  const viewportHeight = /\.hqs-hero\s*\{[^}]*\b(?:min-height|height)\s*:[^;}]*(?:dvh|svh|vh)/i;
  assert.equal(viewportHeight.test(css), false, ".hqs-hero ainda usa altura baseada na viewport");
});

test("relatos de HQs são reativados, separados e identificados como reconstituídos", () => {
  assert.match(html, /class="sales-testimonials hqs-section"/);
  assert.doesNotMatch(html, /class="sales-testimonials hqs-section"[^>]*hidden/);
  assert.match(html, /RELATOS DE LEITORES · MENSAGENS RECONSTITUÍDAS/);
  assert.match(html, /As imagens não são capturas originais das conversas/);
  assert.match(html, /renato\.webp/);
  assert.match(html, /pamela-hqs\.webp/);
  assert.match(html, /rodrigo-hqs\.webp/);
  assert.equal((html.match(/data-testimonial-avatar="whatsapp"/g) || []).length, 1);
  assert.equal((html.match(/data-testimonial-avatar="android"/g) || []).length, 2);
  assert.doesNotMatch(html, /rafaela\.webp|milena\.webp|jorge\.webp|antonio\.webp/);
});

test("não anuncia garantia ou condição comercial não confirmada", () => {
  assert.doesNotMatch(`${html}\n${hqsJs}`, /Garantia de 7 dias|7 dias de garantia|Tem garantia\?/i);
  assert.match(html, /condições de pagamento serão exibidas no checkout antes da confirmação/i);
});

test("proposta HQs é separada e descreve limitações do recurso experimental", () => {
  assert.match(html, /Depois que você vê\s*<br\s*\/?>(?:\s*)suas HQs no Lumeo,/);
  assert.match(html, /EU QUERO O MELHOR/);
  // Os mesmos 3 bônus da página de Livros (decisão do proprietário), entregues à parte.
  assert.match(html, /bônus são entregues por link separado e não ficam pré-instalados no aplicativo/i);
  assert.match(html, /Entregues por link separado do Google Drive após a compra/i);
  assert.match(html, /ampliação automatizada de balões é experimental/i);
  assert.doesNotMatch(html, /IA que amplia|inteligência artificial que reconhece/i);
  for (const bonus of [/coleção de HQs da Turma da Mônica/i, /1\.500 livros digitais/i, /200 audiolivros/i]) assert.match(html, bonus);
  assert.match(hqsJs, /A biblioteca de HQs aceita PDF, CBR e CBZ/);
});

test("todos os CTAs de HQs usam o checkout real da Hotmart", () => {
  const checkoutUrl = "https://pay.hotmart.com/U108112778D?off=okhw2htf&checkoutMode=10";
  assert.ok(sharedJs.includes(`hqs: "${checkoutUrl}"`));
  assert.match(sharedJs, /checkoutProviders: Object\.freeze\(\{ livros: "hotmart", hqs: "hotmart" \}\)/);
  const buttons = [...html.matchAll(/<button[^>]*data-sales-cta[^>]*>/g)].map((match) => match[0]);
  assert.equal(buttons.length, 4);
  buttons.forEach((button) => assert.match(button, /data-hqs-cta-location="(?:hero|testimonials|offer|sticky)"/));
  assert.match(hqsJs, /data-hqs-cta-location="modal"/);
  assert.match(hqsJs, /mountHqsTracking\(\{ checkoutUrl: SALES_CONFIG\.checkoutUrls\.hqs \}\)/);
  assert.match(hqsJs, /\["Como funciona a compra\?", "Ao tocar em um botão de compra, você será direcionado ao checkout seguro da Hotmart/);
});

test("botão flutuante de WhatsApp está disponível em HQs", () => {
  assert.match(html, /class="sales-whatsapp"[^>]*data-sales-whatsapp[^>]*hidden/);
  assert.match(html, /css\/sales-whatsapp\.css/);
  assert.match(sharedJs, /whatsappNumber: "5511911082804"/);
});

test("SEO básico, políticas e rotas Vercel estão presentes", () => {
  for (const page of [html, readFileSync(resolve(pageRoot, "index-livros.html"), "utf8")]) {
    assert.match(page, /<meta name="description" content="[^"]+"/);
    assert.match(page, /<meta property="og:title" content="[^"]+"/);
    assert.match(page, /href="privacidade\.html"/);
    assert.match(page, /href="termos\.html"/);
  }
  const vercel = JSON.parse(readFileSync(resolve(pageRoot, "vercel.json"), "utf8"));
  for (const [route, destination, file] of [["/", "/index-livros", "index-livros.html"], ["/livros", "/index-livros", "index-livros.html"], ["/hqs", "/index-hqs", "index-hqs.html"], ["/privacidade", "/privacidade", "privacidade.html"], ["/termos", "/termos", "termos.html"]]) {
    assert.ok(vercel.rewrites.some((rewrite) => rewrite.source === route && [destination, `${destination}.html`].includes(rewrite.destination)), `Rota ausente: ${route}`);
    assert.equal(existsSync(resolve(pageRoot, file)), true, `Destino ausente: ${file}`);
  }
  assert.match(read("privacidade.html"), /Google API Services User Data Policy[\s\S]*Limited Use/);
  assert.match(read("termos.html"), /responsabilidade possuir os direitos/);
  assert.match(read("termos.html"), /PDF, CBR e CBZ/);
});

test("sem promessa de pagamento único", () => {
  assert.doesNotMatch(relevantSource, /pagamento\s+único/i);
});

test("hero usa os vídeos reais no tablet e no celular", () => {
  const videoTags = [...html.matchAll(/<video[^>]*poster="assets\/tutorials\/hqs\/lumeo-hqs-(?:tablet-two-pages|phone)-poster\.webp"[^>]*>/gi)].map((match) => match[0]);
  assert.equal(videoTags.length, 2, "Vídeos do tablet e do celular não encontrados");
  videoTags.forEach((videoTag) => {
    for (const attribute of ["autoplay", "muted", "loop", "playsinline"]) assert.match(videoTag, new RegExp(`\\b${attribute}\\b`, "i"));
  });
  assert.match(html, /lumeo-hqs-tablet-two-pages-loop-3s\.mp4/);
  assert.match(html, /lumeo-hqs-phone-loop-7s\.mp4/);
  assert.match(html, /class="hqs-hero__tablet-frame"/);
  assert.match(html, /class="hqs-hero__phone-frame"/);
  assert.match(premiumHeroCss, /lumeo-hqs-futuristic-background-v2\.webp/);
  const features = html.match(/<ul class="hqs-reference-features"[\s\S]*?<\/ul>/)?.[0] || "";
  assert.equal((features.match(/<li>/g) || []).length, 4);
  assert.match(features, /MP3[\s\S]*Via Google Drive/);
});

test("seção de leitura contém uma única nota", () => {
  assert.equal((html.match(/class="hqs-reading__note"/g) || []).length, 1);
  assert.equal((html.match(/Demonstração visual\. Os recursos podem variar conforme o arquivo e a versão do app\./g) || []).length, 1);
});

test("mídias e capas anteriores continuam referenciadas", () => {
  const requiredHtmlAssets = [
    "assets/tutorials/hqs/lumeo-hqs-importar-google-drive.mp4",
    "assets/tutorials/hqs/lumeo-hqs-baloes-leitura-pomodoro.mp4",
    "assets/animacoes/lumeo-hqs-virada.mp4",
  ];
  requiredHtmlAssets.forEach((asset) => assert.ok(html.includes(asset), `Referência removida: ${asset}`));
  ["x-factor-119.jpg", "x-factor-120.jpg", "x-factor-132.jpg"].forEach((asset) => {
    assert.ok(hqsJs.includes(asset), `Capa removida: ${asset}`);
  });
});

test("lógica do CTA fixo", async () => {
  const modulePath = pathToFileURL(resolve(pageRoot, "js/mobile-cta.js")).href;
  const { mountMobileCtaVisibility, shouldShowMobileCta } = await import(modulePath);
  assert.equal(shouldShowMobileCta({ heroVisible: true, offerVisible: false }), false);
  assert.equal(shouldShowMobileCta({ heroVisible: false, offerVisible: true }), false);
  assert.equal(shouldShowMobileCta({ heroVisible: false, offerVisible: false }), true);

  const createElement = () => {
    const attributes = new Map();
    const classes = new Set();
    return {
      dataset: {},
      classList: { toggle: (name, force) => force ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name) },
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: (name) => attributes.delete(name),
    };
  };
  const mobile = createElement();
  const hero = createElement();
  const offer = createElement();
  const root = { querySelector: (selector) => ({
    ".sales-mobile-cta": mobile,
    "[data-hqs-hero-cta]": hero,
    "[data-hqs-offer-cta]": offer,
  })[selector] };
  class FakeObserver {
    constructor(callback) { this.callback = callback; FakeObserver.instance = this; }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const cleanup = mountMobileCtaVisibility({ root, Observer: FakeObserver });
  assert.equal(mobile.getAttribute("aria-hidden"), "true");
  assert.equal(mobile.getAttribute("tabindex"), "-1");
  FakeObserver.instance.callback([
    { target: hero, isIntersecting: false, intersectionRatio: 0 },
    { target: offer, isIntersecting: false, intersectionRatio: 0 },
  ]);
  assert.equal(mobile.classList.contains("is-visible"), true);
  assert.equal(mobile.getAttribute("aria-hidden"), null);
  FakeObserver.instance.callback([{ target: offer, isIntersecting: true, intersectionRatio: 0.6 }]);
  assert.equal(mobile.classList.contains("is-visible"), false);
  assert.equal(mobile.getAttribute("aria-hidden"), "true");
  cleanup();
  assert.equal(FakeObserver.instance.disconnected, true);
});

test("estilos base da página de Livros preservados", () => {
  const expected = {
    "css/livros.css": "3ce6ccb14e9e487410620017d9bf241f85f620e95458dc5014fac612f0f916dc",
  };
  Object.entries(expected).forEach(([file, hash]) => assert.equal(sha256(file), hash, `${file} foi alterado`));
});

const trackingModule = await import(pathToFileURL(resolve(pageRoot, "js/hqs-tracking.js")).href);
const {
  CHECKOUT_SESSION_KEY,
  createMetaPixel,
  mergeCheckoutAttribution,
  mountHqsTracking,
} = trackingModule;

function createTrackingEnvironment({ pixelId = "TEST-PIXEL", checkoutUrl = "", storageMap = new Map(), hasConsent = () => true } = {}) {
  const scripts = [];
  const documentListeners = new Map();
  const windowListeners = new Map();
  const storage = storageMap;
  const assignments = [];
  const offer = { id: "offer" };
  class FakeObserver {
    constructor(callback) { this.callback = callback; FakeObserver.instances.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  FakeObserver.instances = [];
  const documentRef = {
    documentElement: { scrollHeight: 1200, scrollTop: 0 },
    head: { append: (node) => scripts.push(node) },
    createElement: (tagName) => ({ tagName, async: false, src: "" }),
    getElementsByTagName: () => [],
    querySelector: (selector) => selector === ".hqs-offer" ? offer : null,
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    removeEventListener: (type) => documentListeners.delete(type),
  };
  const windowRef = {
    innerHeight: 200,
    scrollY: 0,
    location: {
      href: "https://lumeo.test/index-hqs.html?utm_source=meta&utm_campaign=hqs&fbclid=abc123",
      assign: (url) => assignments.push(url),
    },
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    removeEventListener: (type) => windowListeners.delete(type),
  };
  const sessionStorageRef = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  const cleanup = mountHqsTracking({
    pixelId,
    checkoutUrl,
    windowRef,
    documentRef,
    Observer: FakeObserver,
    sessionStorageRef,
    hasConsent,
  });
  const calls = () => (windowRef.fbq?.queue || []).map((args) => [...args]);
  return {
    assignments,
    calls,
    cleanup,
    documentListeners,
    FakeObserver,
    offer,
    scripts,
    storage,
    windowListeners,
    windowRef,
  };
}

function createCtaTarget(location) {
  const selectorByLocation = {
    header: ".sales-header__cta",
    hero: "[data-hqs-hero-cta]",
    offer: "[data-hqs-offer-cta]",
    sticky: ".sales-mobile-cta",
  };
  const button = {
    dataset: {},
    matches: (selector) => selector === selectorByLocation[location],
    closest: () => null,
  };
  return { closest: (selector) => selector === "[data-sales-cta]" ? button : null };
}

test("Pixel real está configurado e valor vazio continua desativando o carregamento", async () => {
  const configModule = await import(pathToFileURL(resolve(pageRoot, "js/hqs-tracking-config.js")).href);
  assert.equal(configModule.META_PIXEL_ID, "1633181614853911");
  assert.match(sharedJs, /metaPixelId: "1633181614853911"/);
  const scripts = [];
  const windowRef = {};
  const documentRef = {
    querySelector: () => null,
    createElement: () => ({}),
    getElementsByTagName: () => [],
    head: { append: (script) => scripts.push(script) },
  };
  const pixel = createMetaPixel({ pixelId: "", windowRef, documentRef });
  assert.equal(pixel.enabled, false);
  assert.equal(pixel.track("PageView"), false);
  assert.equal(windowRef.fbq, undefined);
  assert.equal(scripts.length, 0);
});

test("Pixel de teste injeta script assíncrono e envia PageView uma vez", () => {
  const environment = createTrackingEnvironment();
  assert.equal(environment.scripts.length, 1);
  assert.equal(environment.scripts[0].async, true);
  assert.equal(environment.scripts[0].src, "https://connect.facebook.net/en_US/fbevents.js");
  const pageViews = environment.calls().filter((call) => call[0] === "track" && call[1] === "PageView");
  assert.equal(pageViews.length, 1);
  assert.deepEqual(pageViews[0][2], {
    content_name: "Lumeo HQs",
    content_category: "Aplicativo",
    value: 9.99,
    currency: "BRL",
  });
  environment.cleanup();
});

test("Pixel fica bloqueado até consentimento explícito", () => {
  const environment = createTrackingEnvironment({ hasConsent: () => false });
  assert.equal(environment.scripts.length, 0);
  assert.equal(environment.windowRef.fbq, undefined);
  environment.windowListeners.get("lumeo:sales-analytics-consent-change")({ detail: { choice: "accepted" } });
  assert.equal(environment.scripts.length, 1);
  assert.equal(environment.calls().filter((call) => call[0] === "track" && call[1] === "PageView").length, 1);
  environment.windowListeners.get("lumeo:sales-analytics-consent-change")({ detail: { choice: "rejected" } });
  environment.FakeObserver.instances[0].callback([{ target: environment.offer, isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(environment.calls().filter((call) => call[0] === "track" && call[1] === "ViewContent").length, 0);
  environment.cleanup();
});

test("ViewContent ocorre uma vez entre interseção e rolagem", () => {
  const environment = createTrackingEnvironment();
  const observer = environment.FakeObserver.instances[0];
  observer.callback([{ target: environment.offer, isIntersecting: true, intersectionRatio: 0.5 }]);
  observer.callback([{ target: environment.offer, isIntersecting: true, intersectionRatio: 1 }]);
  environment.windowRef.scrollY = 700;
  environment.windowListeners.get("scroll")();
  environment.windowListeners.get("scroll")();
  const viewContent = environment.calls().filter((call) => call[0] === "track" && call[1] === "ViewContent");
  assert.equal(viewContent.length, 1);
  environment.cleanup();
});

test("InitiateCheckout identifica cada CTA e dispara uma vez por sessão", () => {
  for (const location of ["header", "hero", "offer", "sticky"]) {
    const environment = createTrackingEnvironment({ checkoutUrl: "https://checkout.test/comprar?produto=hqs" });
    const click = environment.documentListeners.get("click");
    const event = { target: createCtaTarget(location), preventDefault() {}, stopImmediatePropagation() {} };
    click(event);
    click(event);
    const events = environment.calls().filter((call) => call[0] === "track" && call[1] === "InitiateCheckout");
    assert.equal(events.length, 1, `Evento duplicado em ${location}`);
    assert.equal(events[0][2].value, 9.99);
    assert.equal(events[0][2].currency, "BRL");
    assert.equal(events[0][2].cta_location, location);
    assert.equal(environment.storage.get(CHECKOUT_SESSION_KEY), "1");
    assert.equal(environment.assignments.length, 2);
    environment.cleanup();
  }

  const persistentStorage = new Map();
  const firstLoad = createTrackingEnvironment({ checkoutUrl: "https://checkout.test/comprar", storageMap: persistentStorage });
  firstLoad.documentListeners.get("click")({
    target: createCtaTarget("hero"),
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  firstLoad.cleanup();
  const secondLoad = createTrackingEnvironment({ checkoutUrl: "https://checkout.test/comprar", storageMap: persistentStorage });
  secondLoad.documentListeners.get("click")({
    target: createCtaTarget("offer"),
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  assert.equal(secondLoad.calls().filter((call) => call[1] === "InitiateCheckout").length, 0);
  assert.equal(secondLoad.assignments.length, 1, "O bloqueio do evento não pode bloquear a navegação");
  secondLoad.cleanup();
});

test("UTMs e fbclid são mesclados no checkout sem duplicação", () => {
  const merged = new URL(mergeCheckoutAttribution(
    "https://checkout.test/comprar?produto=hqs&utm_source=antiga",
    "https://lumeo.test/index-hqs.html?utm_source=meta&utm_campaign=quadrinhos&fbclid=xyz",
  ));
  assert.equal(merged.searchParams.get("produto"), "hqs");
  assert.equal(merged.searchParams.get("utm_source"), "meta");
  assert.equal(merged.searchParams.get("utm_campaign"), "quadrinhos");
  assert.equal(merged.searchParams.get("fbclid"), "xyz");
  assert.equal(merged.searchParams.getAll("utm_source").length, 1);
});

test("assets otimizados do hero existem e respeitam a meta", () => {
  const assets = [
    "assets/tutorials/hqs/lumeo-hqs-tablet-two-pages-loop-3s.mp4",
    "assets/tutorials/hqs/lumeo-hqs-tablet-two-pages-poster.webp",
    "assets/tutorials/hqs/lumeo-hqs-phone-loop-7s.mp4",
    "assets/tutorials/hqs/lumeo-hqs-phone-poster.webp",
    "assets/optimized/lumeo-hqs-futuristic-background-v2.webp",
    "assets/optimized/lumeo-hqs-original-gold-underline.webp",
  ];
  assets.forEach((asset) => {
    assert.equal(existsSync(resolve(pageRoot, asset)), true, `Asset ausente: ${asset}`);
    assert.ok(statSync(resolve(pageRoot, asset)).size < 500_000, `Asset acima da meta: ${asset}`);
  });
  assert.match(html, /lumeo-hqs-tablet-two-pages-loop-3s\.mp4/);
  assert.match(html, /lumeo-hqs-phone-loop-7s\.mp4/);
});

test("assets anteriores usados pela página permanecem inalterados", () => {
  const expected = {
    "assets/tutorials/hqs/lumeo-hqs-baloes-leitura-pomodoro.mp4": "30e1bf7d18f4c3b4b6cc21eefa52603e110de2aba9ab0521e6a8f0dc39c17dad",
    "assets/tutorials/hqs/lumeo-hqs-baloes-leitura-pomodoro-poster.webp": "d8c2adfd758ebd5783db8c1d26206595996e4116994dde51c8d1aed710d44fcc",
    "assets/tutorials/hqs/lumeo-hqs-importar-google-drive.mp4": "24f2b1ab1c77267f12796494032b79337ad3d768713ca2684c9fef9f926179e4",
    "assets/tutorials/hqs/lumeo-hqs-importar-google-drive-poster.webp": "906fd3d8c7422bfd03ec4b94e90bc5e00a17eeafa1ae640a0223b3ce14a565da",
    "assets/animacoes/lumeo-hqs-virada.mp4": "ad8b46bbf69945fb3a32e1e145c719ab19b086678882279fd01fabd0747084bf",
    "assets/hqs/x-factor-119.jpg": "c7f27d978fdaf9a803444e82962e7d8720be40f766b9c1ece656a6ae36ff3e9f",
    "assets/hqs/x-factor-120.jpg": "f9517c8fc577f6fb5a9fff0e7539ec647aa14244c697e1744e2a8be2afcb4e0f",
    "assets/hqs/x-factor-132.jpg": "843677055156266802e9ca6c9d74837c19c396a5d62c3f7504946385390424f0",
    "assets/logo/lumeo-logo.png": "b4775517cc33db91519d772ef5fd808065ed931c962b00aae78737f37e682032",
    "assets/optimized/lumeo-logo.webp": "f2f0cf2e7feb9ee8d9a3ced10ff8119597918fe0f7f003d8007d131a100f07ef",
  };
  Object.entries(expected).forEach(([file, hash]) => assert.equal(sha256(file), hash, `${file} foi alterado`));
});

let failures = 0;
for (const [name, callback] of tests) {
  try {
    await callback();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}: ${error.message}`);
  }
}

if (failures) {
  console.error(`\n${failures} verificação(ões) falharam.`);
  process.exit(1);
}
console.log(`\n${tests.length} verificações concluídas com sucesso.`);
