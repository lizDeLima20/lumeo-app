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
const css = `${read("css/livros.css")}\n${read("css/livros-conversion.css")}`;
const js = read("js/livros.js");
const sharedJs = read("js/shared.js");
const relevantSource = `${html}\n${css}\n${js}`;
const tests = [];
const test = (name, callback) => tests.push([name, callback]);
const normalizeText = (markup) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();

test("headline AIDA e destaque estão exatos", () => {
  const headline = html.match(/<h1\s+id="sales-title"[^>]*>([\s\S]*?)<\/h1>/)?.[1];
  assert.ok(headline);
  assert.equal(normalizeText(headline), "Seus livros organizados. Sua leitura do seu jeito.");
});

test("hero não usa altura baseada na viewport", () => {
  assert.equal(/\.sales-hero\s*\{[^}]*\b(?:min-height|height)\s*:[^;}]*(?:dvh|svh|vh)/i.test(css), false);
});

test("não anuncia garantia ou condição comercial ainda não configurada", () => {
  assert.doesNotMatch(`${html}\n${js}`, /Garantia de 7 dias|7 dias de garantia/i);
  assert.match(html, /condições de pagamento serão exibidas no checkout antes da confirmação/i);
});

test("copy comercial não contém condições removidas nem pagamento único", () => {
  assert.doesNotMatch(relevantSource, /Confira as condições de acesso antes de concluir a compra/i);
  assert.doesNotMatch(relevantSource, /pagamento\s+único/i);
});

test("relatos de Livros são reativados e identificados como mensagens reconstituídas", () => {
  assert.match(html, /class="sales-testimonials sales-section"/);
  assert.doesNotMatch(html, /class="sales-testimonials sales-section"[^>]*hidden/);
  assert.match(html, /EXEMPLOS ILUSTRATIVOS/);
  assert.match(html, /não são capturas originais nem comprovação/);
  assert.match(html, /rafaela\.webp/);
  assert.match(html, /milena\.webp/);
  assert.match(html, /jorge\.webp/);
  assert.match(html, /antonio\.webp/);
  assert.equal((html.match(/data-testimonial-avatar="whatsapp"/g) || []).length, 4);
  assert.doesNotMatch(html, /data-testimonial-image="assets\/depoimentos\/renato\.webp"/);
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
  for (const bonus of [/coleção de HQs da Turma da Mônica/i, /1\.500 livros digitais/i, /200 audiolivros/i]) assert.match(hqsHtml, bonus);
  assert.match(hqsHtml, /bônus são entregues por link separado e não ficam pré-instalados no aplicativo/i);
  assert.match(hqsHtml, /Entregues por link separado do Google Drive após a compra/i);
  assert.match(hqsHtml, /ampliação automatizada de balões é experimental/i);
  assert.doesNotMatch(hqsHtml, /inteligência artificial|IA que amplia/i);
});

const sectionAt = (className) => {
  const start = html.indexOf(`<section class="${className}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
};













test("FAQ responde formatos, áudio e compra sem prometer garantia", () => {
  for (const question of ["O Lumeo vem com livros ou áudios?", "Como funcionam os audiolivros?", "Posso adicionar meus próprios áudios?", "Como funciona a compra?",
    "Posso ouvir enquanto leio?", "Quais formatos de áudio funcionam?",
    "Como acesso o Lumeo?", "Os livros já vêm inclusos?", "Quais formatos posso adicionar?"]) {
    assert.ok(js.includes(`["${question}"`), `Pergunta ausente: ${question}`);
  }
  assert.doesNotMatch(js, /Tem garantia\?/);
  assert.match(js, /\["Como funciona a compra\?", "Ao tocar em um botão de compra, você será direcionado ao checkout seguro da Hotmart/);
});

test("todos os CTAs de Livros usam o checkout real da Hotmart", () => {
  const checkoutUrl = "https://pay.hotmart.com/U108112778D?off=fxd7x748&checkoutMode=10&utm_source=chatgpt.com&bid=1792550316944";
  assert.ok(sharedJs.includes(`livros: "${checkoutUrl}"`));
  assert.match(sharedJs, /checkoutProviders: Object\.freeze\(\{ livros: "hotmart", hqs: "hotmart" \}\)/);
  const buttons = [...html.matchAll(/<button[^>]*data-sales-cta[^>]*>/g)].map((match) => match[0]);
  assert.equal(buttons.length, 6);
  buttons.forEach((button) => assert.match(button, /data-sales-cta-location="(?:hero|testimonials|audiobooks|offer|sticky|final)"/));
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

test("mockup do player: imagem existente ou disco em CSS que respeita reduced-motion", () => {
  const image = sectionAt("livros-bonus").match(/assets\/audiolivros\/player\.(?:png|webp)/)?.[0];
  if (image) { assert.equal(existsSync(resolve(pageRoot, image)), true); return; }
  assert.match(sectionAt("livros-bonus"), /class="livros-bonus__disc"/);
  const animation = css.match(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.livros-bonus__disc \{ animation:[^}]+\}\s*\}/);
  assert.ok(animation, "a rotação do disco deve existir só sem prefers-reduced-motion");
  assert.equal((css.match(/livros-bonus-spin \d/g) || []).length, 1, "a animação não pode ser aplicada fora do media query");
  assert.match(css, /\.livros-bonus__phone \{[^}]*aspect-ratio:/);
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
  assert.doesNotMatch(html + js, /R\$ (?:29,90|39,99)|somente até hoje|<del>/i);
  assert.match(html, /1\.500 livros digitais/);
  assert.match(html, /200 audiolivros/);
  assert.ok(html.indexOf('class="sales-how sales-section"') < html.indexOf('class="sales-testimonials'));
  assert.equal((html.match(/<li><strong>0[1-5]<\/strong>/g)||[]).length, 5);
  assert.match(html, /controles|Ouça por capítulos/);
  assert.match(html, /não possui vínculo com Amazon ou Kindle/);
});
test("hero destaca o aplicativo e os bônus entregues separadamente", () => {
  const heroStart = html.indexOf('<section class="sales-hero"');
  const hero = html.slice(heroStart, html.indexOf("</section>", heroStart));
  assert.match(hero, /ACESSO AO LUMEO/);
  assert.match(hero, /QUERO ACESSAR O LUMEO/);
  assert.match(hero, /Os arquivos não vêm pré-instalados/);
  assert.match(hero, /3 bônus da oferta/);
  assert.match(html, /1\.500 livros digitais/);
  assert.match(hero, /entregues separadamente pelo Google Drive/);
});

test("seção de bônus explica a entrega externa pelo Google Drive", () => {
  const start = html.indexOf('<section class="livros-bonus"');
  const end = html.indexOf("</section>", start);
  const section = html.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(section, /aria-labelledby="audiobooks-title"/);
  assert.match(section, /<h2 id="audiobooks-title">/);
  assert.match(section, /data-livros-audiobooks-cta/);
  assert.match(section, /BÔNUS EXCLUSIVOS/);
  assert.match(section, /acesso separado pelo Google Drive/);
});

test("seção restaura os bônus e preserva a separação do aplicativo", () => {
  const headline = html.match(/<h2 id="audiobooks-title">([\s\S]*?)<\/h2>/)?.[1];
  assert.equal(normalizeText(headline || ""), "Mais leitura para aproveitar no Lumeo.");
  assert.match(sectionAt("livros-bonus"), /1\.500 livros digitais/);
  assert.match(sectionAt("livros-bonus"), /200 audiolivros/);
});

test("descrição esclarece que os bônus não ficam pré-instalados", () => {
  const audio = normalizeText(sectionAt("livros-bonus"));
  for (const text of ["1.500 livros digitais", "200 audiolivros", "não ficam pré-instalados no aplicativo", "QUERO CONHECER O LUMEO"]) assert.ok(audio.includes(text), `Texto ausente: ${text}`);
});

test("a seção tem os três bônus anunciados e o recurso de reprodução", () => {
  const cards = [...sectionAt("livros-bonus").matchAll(/<li class="livros-bonus__card">([\s\S]*?)<\/li>/g)].map((match) => match[1]);
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((card) => normalizeText(card.match(/<h3>([\s\S]*?)<\/h3>/)?.[1] || "")), ["1.500 livros digitais", "200 audiolivros", "Coleção de HQs e mangás", "Ouça por capítulos"]);
  cards.forEach((card) => assert.match(card, /class="livros-bonus__icon"/));
});

test("a oferta discrimina o aplicativo e os bônus entregues separadamente", () => {
  const card = html.match(/<aside class="sales-price-card"[\s\S]*?<\/aside>/)?.[0] || "";
  const text = normalizeText(card);
  assert.ok(text.includes("O que você recebe:"));
  assert.ok(text.includes("Aplicativo leitor para Android"));
  for (const item of ["Aplicativo leitor para Android", "Bônus: 1.500 livros digitais", "Bônus: 200 audiolivros", "Biblioteca e progresso locais"]) assert.ok(text.includes(item), `Ausente: ${item}`);
  assert.ok(card.indexOf("O que você recebe") < card.indexOf("data-sales-price"));
  assert.ok(text.includes("PREÇO DO APLICATIVO"));
  assert.ok(text.includes("bônus são entregues separadamente por link do Google Drive"));
});

test("microcopies diferenciam o app da entrega separada dos bônus", () => {
  assert.match(html, /Aplicativo leitor \+ bônus por link após a compra/);
  assert.match(html, /bônus são entregues separadamente por link do Google Drive/i);
});

test("página anuncia somente os bônus comerciais autorizados pelo proprietário", () => {
  const source = `${html}\n${js}`;
  assert.match(source, /200 audiolivros/i);
  assert.match(source, /1\.500 livros/i);
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
