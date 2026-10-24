import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(resolve(pageRoot, relativePath), "utf8");
const sha256 = (relativePath) => createHash("sha256").update(readFileSync(resolve(pageRoot, relativePath))).digest("hex");
const html = read("index-livros.html");
const hqsHtml = read("index-hqs.html");
const css = `${read("css/livros.css")}\n${read("css/livros-conversion.css")}\n${read("css/livros-art-hero.css")}\n${read("css/livros-bonus-premium.css")}\n${read("css/livros-testimonials-premium.css")}\n${read("css/livros-demo-compact.css")}`;
const js = read("js/livros.js");
const sharedJs = read("js/shared.js");
const relevantSource = `${html}\n${css}\n${js}`;
const tests = [];
const test = (name, callback) => tests.push([name, callback]);
const normalizeText = (markup) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();

test("headline acessível acompanha exatamente a arte aprovada", () => {
  const headline = html.match(/<h1\s+id="sales-title"[^>]*>([\s\S]*?)<\/h1>/)?.[1];
  assert.ok(headline);
  assert.equal(normalizeText(headline), "Você ama ler. Está na hora de amar como você lê.");
});

test("hero não usa altura baseada na viewport", () => {
  assert.equal(/\.sales-hero\s*\{[^}]*\b(?:min-height|height)\s*:[^;}]*(?:dvh|svh|vh)/i.test(css), false);
});

test("não anuncia garantia ou condição comercial ainda não configurada", () => {
  assert.doesNotMatch(`${html}\n${js}`, /Garantia de 7 dias|7 dias de garantia/i);
});

test("copy comercial não contém condições removidas nem pagamento único", () => {
  assert.doesNotMatch(relevantSource, /Confira as condições de acesso antes de concluir a compra/i);
  assert.doesNotMatch(relevantSource, /pagamento\s+único/i);
});

test("relatos de Livros são reativados e identificados como mensagens reconstituídas", () => {
  assert.match(html, /class="sales-testimonials sales-section livros-testimonials"/);
  assert.doesNotMatch(html, /class="sales-testimonials sales-section livros-testimonials"[^>]*hidden/);
  assert.match(html, /EXEMPLOS ILUSTRATIVOS/);
  assert.match(html, /não são capturas originais nem comprovação/);
  assert.match(html, /rafaela\.webp/);
  assert.match(html, /milena\.webp/);
  assert.match(html, /jorge\.webp/);
  assert.match(html, /antonio\.webp/);
  assert.equal((html.match(/data-testimonial-avatar="whatsapp"/g) || []).length, 4);
  assert.doesNotMatch(html, /data-testimonial-image="assets\/depoimentos\/renato\.webp"/);
});

test("depoimentos de Livros ficam logo após os bônus no padrão premium", () => {
  const bonus = html.indexOf('class="livros-bonus-premium"');
  const testimonials = html.indexOf('class="sales-testimonials sales-section livros-testimonials"');
  const benefits = html.indexOf('class="sales-benefits sales-section"');
  assert.ok(bonus >= 0 && testimonials > bonus && benefits > testimonials);
  assert.match(html, /Quem ama ler merece uma experiência melhor\./);
  assert.match(html, /Conheça as experiências de quem já utiliza o Lumeo\./);
  assert.equal((html.match(/data-testimonial-card/g) || []).length, 4);
  assert.match(js, /mountLivrosTestimonials\(\)/);
  // Mesmo componente dos depoimentos de HQs (js/hqs-marquee.js): loop, arraste, pausa e
  // rolagem vertical livre sobre os cards.
  const marquee = read("js/livros-testimonials-marquee.js");
  const component = read("js/hqs-marquee.js");
  assert.match(marquee, /mountHqsMarquee\(/);
  assert.match(marquee, /direction:\s*1/);
  assert.match(marquee, /marquee\?\.pause\(\)/);
  assert.match(marquee, /marquee\?\.resume\(\)/);
  assert.match(marquee, /MutationObserver/);
  assert.match(component, /pointerdown/);
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.livros-testimonials \.sales-testimonials__carousel \{[^}]*touch-action: pan-y/);
  assert.match(css, /\.livros-testimonials \.sales-testimonials__track \* \{ touch-action: pan-y; \}/);
  assert.match(css, /height:\s*clamp\(15rem, 30svh, 17rem\)/);
});

test("demonstração compacta fica após os depoimentos e preserva os vídeos de Livros", () => {
  const testimonials = html.indexOf('class="sales-testimonials sales-section livros-testimonials"');
  const tutorials = html.indexOf('class="livros-tutorials"');
  const benefits = html.indexOf('class="sales-benefits sales-section"');
  assert.ok(testimonials >= 0 && tutorials > testimonials && benefits > tutorials);
  const section = sectionAt("livros-tutorials");
  assert.match(section, /Veja o Lumeo em ação\./);
  assert.match(section, /Adicione seus livros com facilidade/);
  assert.match(section, /Descubra uma leitura do seu jeito/);
  assert.match(section, /Organize seus livros digitais e tenha suas leituras sempre à mão\./);
  assert.match(section, /Ajuste sua experiência, vire as páginas e aproveite cada momento da leitura\./);
  assert.equal((section.match(/<video/g) || []).length, 2);
  assert.equal((section.match(/\bautoplay\b/g) || []).length, 2);
  assert.equal((section.match(/\bmuted\b/g) || []).length, 2);
  assert.equal((section.match(/\bloop\b/g) || []).length, 2);
  assert.equal((section.match(/\bplaysinline\b/g) || []).length, 2);
  assert.match(section, /data-src="assets\/tutorials\/lumeo-importar-drive\.mp4"/);
  assert.match(section, /data-src="assets\/tutorials\/lumeo-leitura-pomodoro\.mp4"/);
  assert.match(css, /object-fit:\s*contain/);
  assert.match(css, /touch-action:\s*pan-x pan-y/);
  assert.match(css, /\.livros-tutorials\s*\{[\s\S]*?margin-top:\s*5px/);
});

test("vídeo leve do hero está configurado e os arquivos existem", () => {
  const video = html.match(/<video[^>]*data-books-hero-video[^>]*>/i)?.[0];
  assert.ok(video);
  for (const attribute of ["autoplay", "muted", "loop", "playsinline", "poster", "aria-hidden"]) {
    assert.match(video, new RegExp(`\\b${attribute}(?:=|\\s|>)`, "i"));
  }
  assert.match(video, /preload="metadata"/i);
  const source = html.match(/<source[^>]*data-src="assets\/tutorials\/livros\/lumeo-livros-hero\.mp4"[^>]*>/i)?.[0];
  assert.ok(source);
  assert.doesNotMatch(source, /\ssrc=/i);
  assert.equal(existsSync(resolve(pageRoot, "assets/tutorials/livros/lumeo-livros-hero.mp4")), true);
  assert.equal(existsSync(resolve(pageRoot, "assets/tutorials/livros/lumeo-livros-hero-poster.webp")), true);
});

test("economia de dados mantém o poster sem carregar o vídeo", async () => {
  const { mountBooksHeroVideo } = await import(pathToFileURL(resolve(pageRoot, "js/livros-hero-video.js")).href);
  const source = { dataset: { src: "assets/tutorials/livros/lumeo-livros-hero.mp4" } };
  const video = {
    dataset: {},
    poster: "assets/tutorials/livros/lumeo-livros-hero-poster.webp",
    querySelectorAll: () => [source],
    load() { this.loadCalls = (this.loadCalls || 0) + 1; },
    pause() { this.pauseCalls = (this.pauseCalls || 0) + 1; },
    play() { this.playCalls = (this.playCalls || 0) + 1; return Promise.resolve(); },
  };
  const root = { hidden: false, querySelector: () => video, addEventListener() {}, removeEventListener() {} };
  const windowRef = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  mountBooksHeroVideo({ root, windowRef, navigatorRef: { connection: { saveData: true, effectiveType: "4g" } }, Observer: null });
  assert.equal(source.src, undefined);
  assert.equal(video.loadCalls || 0, 0);
  assert.equal(video.playCalls || 0, 0);
  assert.equal(video.dataset.posterOnly, "true");
});

test("assets anteriores continuam referenciados e inalterados", () => {
  const expected = {
    "assets/optimized/lumeo-logo.webp": "f2f0cf2e7feb9ee8d9a3ced10ff8119597918fe0f7f003d8007d131a100f07ef",
    "assets/tutorials/lumeo-importar-drive-poster.svg": "589a8c684143638b3c154c194b201ea79ea159093d18cd641ba4977b4f9fbbdb",
    "assets/tutorials/lumeo-importar-drive.mp4": "a1ab5b92dc3ef7d603443b18279185a2f0c81da00ac9ced6eec3883f74c89247",
    "assets/tutorials/lumeo-leitura-pomodoro-poster.svg": "569f4d98ae10d987cec8cefc1a00558af694e419da281d0f6d62b5e4592eac55",
    "assets/tutorials/lumeo-leitura-pomodoro.mp4": "977b6031112969f438e73c7436008e13c77eaf2bf085303728eacdaabd2242b0",
    "assets/animacoes/lumeo-virada-pagina.webp": "1a0df3ab887b8b5faacea627f54b756d142b2ad34dfb0d141a0fd5c162adbb59",
    "assets/optimized/lumeo-library-mobile.webp": "7160d445728de0f26a46fd502635c5730ba93c70452b19276aa2d63cb87b9cea",
    "assets/depoimentos/rafaela.webp": "869e61ea9fc1ec1b540a5428de1ffacb080a8c2787f167c20a0959c043f6c342",
    "assets/depoimentos/renato.webp": "ce5aabfadecc79258b7a9b0544a037a5732444ffa92244dcedaf718aaab0feb1",
    "assets/depoimentos/milena.webp": "1d6f61512855ff7ba88fcdd42f0b0a2ba6162caf044ee91f173d502c8212f952",
    "assets/depoimentos/jorge.webp": "798f0154f4785cb9a5392eb4666371d490a66962704177ec0cdbc8232064dad2",
    "assets/depoimentos/antonio.webp": "5025ec1515ec6d4d974dc2e829b9e2ecfb19ed5b3286c64629a4c2f1eab59646",
  };
  Object.entries(expected).forEach(([file, hash]) => {
    assert.ok(html.includes(file) || hqsHtml.includes(file) || file.endsWith("lumeo-logo.webp"), `Referência removida: ${file}`);
    assert.equal(sha256(file), hash, `${file} foi alterado`);
  });
});

test("botão fixo cobre os CTAs de Livros", async () => {
  const { mountMobileCtaVisibility } = await import(pathToFileURL(resolve(pageRoot, "js/mobile-cta.js")).href);
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
  const mobile = createElement(), hero = createElement(), offer = createElement();
  const root = { querySelector: (selector) => ({ ".sales-mobile-cta": mobile, "[data-hqs-hero-cta]": hero, "[data-hqs-offer-cta]": offer })[selector] };
  class FakeObserver {
    constructor(callback) { this.callback = callback; FakeObserver.instance = this; }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const cleanup = mountMobileCtaVisibility({ root, Observer: FakeObserver });
  FakeObserver.instance.callback([{ target: hero, isIntersecting: false, intersectionRatio: 0 }, { target: offer, isIntersecting: false, intersectionRatio: 0 }]);
  assert.equal(mobile.classList.contains("is-visible"), true);
  FakeObserver.instance.callback([{ target: offer, isIntersecting: true, intersectionRatio: 0.6 }]);
  assert.equal(mobile.classList.contains("is-visible"), false);
  assert.equal(mobile.getAttribute("aria-hidden"), "true");
  cleanup();
});

test("Pixel de Livros envia InitiateCheckout com payload e localização", async () => {
  const { mountLivrosTracking } = await import(pathToFileURL(resolve(pageRoot, "js/livros-tracking.js")).href);
  for (const location of ["header", "hero", "offer", "sticky"]) {
    const documentListeners = new Map(), windowListeners = new Map(), storage = new Map(), scripts = [], assignments = [];
    const offer = {};
    class FakeObserver { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} }
    const documentRef = {
      documentElement: { scrollHeight: 1000, scrollTop: 0 },
      head: { append: (script) => scripts.push(script) },
      createElement: () => ({}), getElementsByTagName: () => [],
      querySelector: (selector) => selector === ".sales-offer" ? offer : null,
      addEventListener: (type, listener) => documentListeners.set(type, listener),
      removeEventListener: (type) => documentListeners.delete(type),
    };
    const windowRef = {
      innerHeight: 200, scrollY: 0,
      location: { href: "https://lumeo.test/index-livros.html?utm_source=meta", assign: (url) => assignments.push(url) },
      addEventListener: (type, listener) => windowListeners.set(type, listener),
      removeEventListener: (type) => windowListeners.delete(type),
    };
    const sessionStorageRef = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) };
    const cleanup = mountLivrosTracking({ pixelId: "TEST", checkoutUrl: "https://checkout.test/?produto=livros", windowRef, documentRef, Observer: FakeObserver, sessionStorageRef, hasConsent: () => true });
    const button = { dataset: { salesCtaLocation: location }, matches: () => false, closest: () => null };
    const event = { target: { closest: () => button }, preventDefault() {}, stopImmediatePropagation() {} };
    documentListeners.get("click")(event);
    documentListeners.get("click")(event);
    const calls = windowRef.fbq.queue.map((args) => [...args]);
    const checkoutEvents = calls.filter((call) => call[0] === "track" && call[1] === "InitiateCheckout");
    assert.equal(checkoutEvents.length, 1);
    assert.equal(checkoutEvents[0][2].content_name, "Lumeo Livros");
    assert.equal(checkoutEvents[0][2].value, 9.99);
    assert.equal(checkoutEvents[0][2].currency, "BRL");
    assert.equal(checkoutEvents[0][2].cta_location, location);
    assert.match(assignments[0], /utm_source=meta/);
    cleanup();
  }
});

test("Pixel de Livros não carrega nem envia eventos sem consentimento", async () => {
  const { mountLivrosTracking } = await import(pathToFileURL(resolve(pageRoot, "js/livros-tracking.js")).href);
  const scripts = [], windowListeners = new Map();
  const windowRef = { location: { href: "https://lumeo.test/livros", assign() {} }, addEventListener: (name, listener) => windowListeners.set(name, listener), removeEventListener() {} };
  const documentRef = { head: { append: (script) => scripts.push(script) }, createElement: () => ({}), getElementsByTagName: () => [], querySelector: () => null, addEventListener() {}, removeEventListener() {} };
  const cleanup = mountLivrosTracking({ pixelId: "TEST", windowRef, documentRef, Observer: null, hasConsent: () => false });
  assert.equal(scripts.length, 0);
  assert.equal(windowRef.fbq, undefined);
  windowListeners.get("lumeo:sales-analytics-consent-change")({ detail: { choice: "accepted" } });
  assert.equal(scripts.length, 1);
  assert.equal(windowRef.fbq.queue.filter((call) => call[0] === "track" && call[1] === "PageView").length, 1);
  cleanup();
});

test("vídeo otimizado respeita codec, tamanho, duração e ausência de áudio", () => {
  const videoPath = resolve(pageRoot, "assets/tutorials/livros/lumeo-livros-hero.mp4");
  const posterPath = resolve(pageRoot, "assets/tutorials/livros/lumeo-livros-hero-poster.webp");
  assert.ok(statSync(videoPath).size <= 1_200_000);
  assert.ok(statSync(posterPath).size <= 60_000);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,codec_name,width,pix_fmt", "-of", "json", videoPath], { encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const metadata = JSON.parse(probe.stdout);
  const video = metadata.streams.find((stream) => stream.codec_type === "video");
  assert.equal(video.codec_name, "h264");
  assert.equal(video.pix_fmt, "yuv420p");
  assert.ok(video.width <= 540);
  assert.ok(Number(metadata.format.duration) >= 4 && Number(metadata.format.duration) <= 8);
  assert.equal(metadata.streams.some((stream) => stream.codec_type === "audio"), false);
});

// As duas páginas oferecem agora os mesmos 3 bônus (decisão do proprietário): coleção de HQs e
// mangás, 1.500 livros digitais e 200 audiolivros, entregues por link separado do Google Drive.
test("a página de HQs mantém proposta própria e descreve os 3 bônus separados", () => {
  assert.match(hqsHtml, /data-sales-catalog="hqs"/);
  assert.match(hqsHtml, /quadrinhos e mangás/i);
  for (const bonus of [/coleção de HQs da Turma da Mônica/i, /1\.500 livros digitais/i, /200 (?:audiolivros|audiobooks)/i]) assert.match(hqsHtml, bonus);
  assert.match(hqsHtml, /bônus são disponibilizados separadamente por links do Google Drive/i);
  assert.match(hqsHtml, /Acesso por link do Google Drive/i);
  assert.match(hqsHtml, /ampliação automatizada de balões é experimental/i);
  assert.doesNotMatch(hqsHtml, /inteligência artificial|IA que amplia/i);
});

const sectionAt = (className) => {
  const start = html.indexOf(`<section class="${className}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
};













test("blocos de oferta interna e dúvidas frequentes foram removidos", () => {
  assert.doesNotMatch(html, /class="sales-offer sales-section"/);
  assert.doesNotMatch(html, /class="sales-faq sales-section"/);
  assert.doesNotMatch(html, /data-sales-faq|id="offer-title"|id="faq-title"/);
  assert.doesNotMatch(js, /function mountFaq|mountFaq\(\)/);
});

test("todos os CTAs de Livros usam o checkout real da Hotmart", () => {
  const checkoutUrl = "https://pay.hotmart.com/U108112778D?off=fxd7x748&checkoutMode=10&utm_source=chatgpt.com&bid=1792550316944";
  assert.ok(sharedJs.includes(`livros: "${checkoutUrl}"`));
  assert.match(sharedJs, /checkoutProviders: Object\.freeze\(\{ livros: "hotmart", hqs: "hotmart" \}\)/);
  const buttons = [...html.matchAll(/<button[^>]*data-sales-cta[^>]*>/g)].map((match) => match[0]);
  assert.equal(buttons.length, 5);
  buttons.forEach((button) => assert.match(button, /data-sales-cta-location="(?:hero|testimonials|audiobooks|sticky|final)"/));
  assert.match(js, /mountLivrosTracking\(\{ checkoutUrl: SALES_CONFIG\.checkoutUrls\.livros \}\)/);
});

test("botão flutuante de WhatsApp usa o número autorizado", () => {
  assert.match(html, /class="sales-whatsapp"[^>]*data-sales-whatsapp[^>]*hidden/);
  assert.match(html, /css\/sales-whatsapp\.css/);
  assert.match(sharedJs, /whatsappNumber: "5511911082804"/);
  assert.match(sharedJs, /https:\/\/wa\.me\/\$\{whatsappNumber\}/);
});







test("página não usa condições comerciais não confirmadas", () => {
  const forbidden = ["grátis", "de graça", "12 Regras", "1984", "Lei da Atração", "pagamento único", "Garantia de 7 dias"];
  const pageSource = `${html}\n${css}\n${js}\n${read("js/mobile-cta.js")}\n${read("js/livros-tracking.js")}`.toLocaleLowerCase("pt-BR");
  forbidden.forEach((term) => assert.equal(pageSource.includes(term.toLocaleLowerCase("pt-BR")), false, `Termo proibido: ${term}`));
});

test("CTA da seção de audiolivros mantém o rastreamento e localização próprios", async () => {
  const { mountLivrosTracking } = await import(pathToFileURL(resolve(pageRoot, "js/livros-tracking.js")).href);
  const cta = html.match(/<button[^>]*data-livros-audiobooks-cta[^>]*>/)?.[0] || "";
  assert.match(cta, /data-sales-cta(?:\s|>)/); assert.match(cta, /data-sales-cta-location="audiobooks"/);
  const documentListeners = new Map(), assignments = [];
  class FakeObserver { constructor() {} observe() {} disconnect() {} }
  const documentRef = { documentElement: { scrollHeight: 1000 }, head: { append() {} }, createElement: () => ({}), getElementsByTagName: () => [],
    querySelector: () => null, addEventListener: (type, listener) => documentListeners.set(type, listener), removeEventListener() {} };
  const windowRef = { innerHeight: 200, scrollY: 0, location: { href: "https://lumeo.test/index-livros.html", assign: (url) => assignments.push(url) }, addEventListener() {}, removeEventListener() {} };
  const storage = new Map();
  mountLivrosTracking({ pixelId: "TEST", checkoutUrl: "https://checkout.test/", windowRef, documentRef, Observer: FakeObserver, hasConsent: () => true,
    sessionStorageRef: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
  const button = { dataset: { salesCtaLocation: "audiobooks" }, matches: () => false, closest: () => null };
  documentListeners.get("click")({ target: { closest: () => button }, preventDefault() {}, stopImmediatePropagation() {} });
  const checkout = windowRef.fbq.queue.map((args) => [...args]).filter((call) => call[1] === "InitiateCheckout");
  assert.equal(checkout.length, 1); assert.equal(checkout[0][2].cta_location, "audiobooks");
  assert.equal(assignments.length, 1);
});

test("botão fixo se esconde quando o CTA de audiolivros está visível", async () => {
  const { mountMobileCtaVisibility } = await import(pathToFileURL(resolve(pageRoot, "js/mobile-cta.js")).href);
  assert.match(js, /mountMobileCtaVisibility\(\{ extraCtaSelectors: \["\[data-livros-audiobooks-cta\]"\] \}\)/);
  const element = () => { const attributes = new Map(), classes = new Set(); return { dataset: {}, classList: { toggle: (name, force) => force ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name) },
    getAttribute: (name) => attributes.get(name) ?? null, setAttribute: (name, value) => attributes.set(name, String(value)), removeAttribute: (name) => attributes.delete(name) }; };
  const mobile = element(), hero = element(), offer = element(), bonus = element(), observed = [];
  const root = { querySelector: (selector) => ({ ".sales-mobile-cta": mobile, "[data-hqs-hero-cta]": hero, "[data-hqs-offer-cta]": offer, "[data-livros-audiobooks-cta]": bonus })[selector] };
  class FakeObserver { constructor(callback) { this.callback = callback; FakeObserver.instance = this; } observe(target) { observed.push(target); } disconnect() {} }
  mountMobileCtaVisibility({ root, Observer: FakeObserver, extraCtaSelectors: ["[data-livros-audiobooks-cta]"] });
  assert.ok(observed.includes(bonus));
  FakeObserver.instance.callback([{ target: hero, isIntersecting: false, intersectionRatio: 0 }, { target: offer, isIntersecting: false, intersectionRatio: 0 }]);
  assert.equal(mobile.classList.contains("is-visible"), true);
  FakeObserver.instance.callback([{ target: bonus, isIntersecting: true, intersectionRatio: 0.5 }]);
  assert.equal(mobile.classList.contains("is-visible"), false); assert.equal(mobile.getAttribute("aria-hidden"), "true");
  FakeObserver.instance.callback([{ target: bonus, isIntersecting: false, intersectionRatio: 0 }]);
  assert.equal(mobile.classList.contains("is-visible"), true);
});

test("carrossel de bônus é contínuo, arrastável e respeita movimento reduzido", () => {
  // Mesmo componente do bônus de HQs; em sentido contrário aos depoimentos de Livros.
  const carousel = read("js/livros-bonus-carousel.js");
  const component = read("js/hqs-marquee.js");
  assert.match(carousel, /mountHqsMarquee\(/);
  assert.match(carousel, /direction:\s*-1/);
  assert.match(component, /cloneNode\(true\)/);
  assert.match(component, /pointerdown/);
  assert.doesNotMatch(component, /setAttribute\("inert"/);
  // pan-y: o gesto vertical sobre o bônus rola a página (pan-x bloqueava).
  assert.match(css, /body\[data-sales-catalog="livros"\] \.hqs-marquee \{[^}]*touch-action: pan-y/);
  assert.doesNotMatch(read("css/livros-bonus-premium.css"), /touch-action:\s*pan-x;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("check-hqs.mjs continua passando", () => {
  const result = spawnSync(process.execPath, [resolve(pageRoot, "scripts/check-hqs.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("oferta isolada de HQs e bônus preservados conforme orientação", async () => {
  const { SALES_CONFIG } = await import(pathToFileURL(resolve(pageRoot, "js/shared.js")).href);
  assert.equal(SALES_CONFIG.livrosPrice, 9.99);
  assert.equal(SALES_CONFIG.price, 9.99);
  assert.match(html, /QUERO ACESSAR O LUMEO/);
  assert.match(html, /R\$ 9,99/);
  assert.equal((html.match(/R\$ 39,99/g) || []).length, 1, "o preço anterior deve existir somente na cópia acessível da arte aprovada");
  assert.doesNotMatch(html + js, /R\$ 29,90|somente até hoje|<del>/i);
  const bonusText = normalizeText(sectionAt("livros-bonus-premium"));
  assert.match(bonusText, /1\.500 LIVROS EM PDF/i);
  assert.match(bonusText, /200 AUDIOBOOKS/i);
  assert.ok(html.indexOf('class="livros-bonus-premium"') < html.indexOf('class="sales-testimonials'));
  assert.equal((html.match(/<li><strong>0[1-5]<\/strong>/g)||[]).length, 5);
  assert.match(html, /TURMA DA MÔNICA/);
  assert.match(html, /não possui vínculo com Amazon ou Kindle/);
});
test("hero usa a arte aprovada, dois vídeos e CTA transparente", () => {
  const heroStart = html.indexOf('<section class="livros-art-hero"');
  const hero = html.slice(heroStart, html.indexOf("</section>", heroStart));
  assert.match(hero, /lumeo-livros-hero-mobile-approved\.webp/);
  assert.match(hero, /lumeo-livros-hero-desktop-approved\.webp/);
  assert.equal((hero.match(/<video autoplay muted loop playsinline/g) || []).length, 2);
  assert.match(hero, /class="livros-art-hero__cta"[^>]*data-sales-cta/);
  assert.match(hero, /EU QUERO O MELHOR/);
});

test("seção de bônus explica a entrega externa pelo Google Drive", () => {
  const start = html.indexOf('<section class="livros-bonus-premium"');
  const end = html.indexOf("</section>", start);
  const section = html.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(section, /aria-labelledby="livros-bonus-title"/);
  assert.match(section, /<h2 id="livros-bonus-title">/);
  assert.match(section, /data-livros-audiobooks-cta/);
  assert.match(section, /BÔNUS INCLUÍDOS/);
  assert.equal((section.match(/Entrega por link do Google Drive/g) || []).length, 3);
});

test("seção restaura os bônus e preserva a separação do aplicativo", () => {
  const headline = html.match(/<h2 id="livros-bonus-title">([\s\S]*?)<\/h2>/)?.[1];
  assert.equal(normalizeText(headline || ""), "🎁 Seu Lumeo vem com ainda mais histórias para aproveitar!");
  assert.match(sectionAt("livros-bonus-premium"), /1\.500/);
  assert.match(sectionAt("livros-bonus-premium"), /200/);
});

test("descrição esclarece que os bônus não ficam pré-instalados", () => {
  const bonus = normalizeText(sectionAt("livros-bonus-premium"));
  for (const text of ["1.500", "200", "sem livros pré-instalados", "QUERO MEU LUMEO + BÔNUS"]) assert.ok(bonus.includes(text), `Texto ausente: ${text}`);
});

test("a seção tem exatamente os três bônus anunciados e ícones do Drive", () => {
  const section = sectionAt("livros-bonus-premium");
  const cards = [...section.matchAll(/<article class="livros-bonus-card" data-livros-bonus-card>([\s\S]*?)<\/article>/g)].map((match) => match[1]);
  assert.equal(cards.length, 3);
  assert.match(section, /LIVROS EM PDF/);
  assert.match(section, /AUDIOBOOKS/);
  assert.match(section, /TURMA DA MÔNICA/);
  cards.forEach((card) => assert.match(card, /livros-bonus-drive/));
});

test("oferta final preserva preço, bônus e checkout após a remoção dos blocos", () => {
  const final = html.match(/<section class="editorial-final">[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(final, /R\$ 9,99/);
  assert.match(final, /com os bônus apresentados nesta página/);
  assert.match(final, /data-sales-cta-location="final"/);
  assert.match(final, /QUERO ACESSAR O LUMEO/);
});

test("microcopies diferenciam o app da entrega separada dos bônus", () => {
  assert.match(html, /aplicativo Lumeo começa sem livros pré-instalados/i);
  assert.match(html, /bônus são entregues separadamente por links do Google Drive/i);
});

test("página anuncia somente os bônus comerciais autorizados pelo proprietário", () => {
  const source = `${normalizeText(html)}\n${js}`;
  assert.match(source, /200 AUDIOBOOKS/i);
  assert.match(source, /1\.500 LIVROS EM PDF/i);
  assert.doesNotMatch(source, /músicas para ler ouvindo|Músicas para leitura/i);
  assert.match(source, /Google Drive/i);
});

test("frases de que nenhum áudio vem incluso foram removidas", () => {
  const source = `${html}\n${js}`;
  for (const phrase of ["Os áudios não acompanham o aplicativo", "não inclui livros nem áudios", "Livros e áudios não incluídos", "Os audiolivros vêm inclusos?"]) {
    assert.equal(source.includes(phrase), false, `Ainda presente: ${phrase}`);
  }
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
