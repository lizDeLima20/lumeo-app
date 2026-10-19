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
const css = `${read("css/livros.css")}\n${read("css/livros-conversion.css")}`;
const js = read("js/livros.js");
const relevantSource = `${html}\n${css}\n${js}`;
const tests = [];
const test = (name, callback) => tests.push([name, callback]);
const normalizeText = (markup) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();

test("headline AIDA e destaque estão exatos", () => {
  const headline = html.match(/<h1\s+id="sales-title"[^>]*>([\s\S]*?)<\/h1>/)?.[1];
  assert.ok(headline);
  assert.equal(normalizeText(headline), "Leia mais livros no celular, com cara de livro de verdade.");
  assert.equal(normalizeText(headline.match(/<span>([\s\S]*?)<\/span>/)?.[1] || ""), "livro de verdade");
});

test("hero não usa altura baseada na viewport", () => {
  assert.equal(/\.sales-hero\s*\{[^}]*\b(?:min-height|height)\s*:[^;}]*(?:dvh|svh|vh)/i.test(css), false);
});

test("garantia aparece no hero, oferta e FAQ", () => {
  assert.equal((html.match(/Garantia de 7 dias/g) || []).length, 2);
  assert.match(js, /\["Tem garantia\?",\s*"Sim\. Você tem 7 dias de garantia/);
});

test("copy comercial não contém condições removidas nem pagamento único", () => {
  assert.doesNotMatch(relevantSource, /Confira as condições de acesso antes de concluir a compra/i);
  assert.doesNotMatch(relevantSource, /pagamento\s+único/i);
});

test("depoimentos vêm logo após a demonstração de leitura", () => {
  const readingStart = html.indexOf('class="sales-how sales-section sales-how--reading"');
  const readingEnd = html.indexOf("</section>", readingStart);
  const nextSection = html.indexOf("<section", readingEnd + 10);
  assert.ok(readingStart >= 0 && readingEnd > readingStart && nextSection > readingEnd);
  assert.match(html.slice(nextSection, nextSection + 100), /class="sales-stories sales-section"/);
});

test("aviso autorizado dos depoimentos substituiu o texto antigo", () => {
  assert.match(html, /Mensagens enviadas por leitores do Lumeo e publicadas com autorização\./);
  assert.doesNotMatch(html, /Não são avaliações verificadas por uma plataforma independente/);
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
    assert.ok(html.includes(file) || file.endsWith("lumeo-logo.webp"), `Referência removida: ${file}`);
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
    const cleanup = mountLivrosTracking({ pixelId: "TEST", checkoutUrl: "https://checkout.test/?produto=livros", windowRef, documentRef, Observer: FakeObserver, sessionStorageRef });
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

test("página de HQs permanece inalterada", () => {
  const expected = {
    "index-hqs.html": "c5fcc8237bccf43f630bb6e3d8fd6bbe4aab019a8f6fd893c7429feb7d41ed4c",
    "css/hqs.css": "82d8bb2e1306d8227ba17388ed898fcc2f66802db7dd110991d7e9dd794736b7",
    "css/hqs-conversion.css": "5e2c10bafa212ef21fd5b7142a8f0e8cb33401cd97445682fe2b8a887b3105c1",
    "js/hqs.js": "23a88a0619dbcbf7bc3b5199e3652ee457dd396d1bbdd4373fefee894b860768",
    "js/hqs-tracking.js": "74bd752d5a7bdcf1aef3f363d386bbadd7ae90af03a5b0b48bd153a68d917919",
    "js/hqs-hero-video.js": "ab0deeb21313d464197c728ada0e6432220fa5f8569fec63744ec405742f8541",
  };
  Object.entries(expected).forEach(([file, hash]) => assert.equal(sha256(file), hash, `${file} foi alterado`));
});

const sectionAt = (className) => {
  const start = html.indexOf(`<section class="${className}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
};

// Ajuste (complemento dos 3 bônus): o selo deixou de ser "BÔNUS INCLUSO: Lumeo Audiolivros" e passou
// a anunciar os 200 audiolivros e as músicas; a posição (no card, antes do botão) continua a mesma.
test("selo de bônus fica no card de oferta do hero, antes do botão", () => {
  const offer = html.match(/<div class="sales-hero__offer"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || "";
  const badge = offer.indexOf("BÔNUS: 200 audiolivros + músicas para ler ouvindo"), button = offer.indexOf("data-hqs-hero-cta");
  assert.ok(badge > 0, "selo ausente no card do hero");
  assert.ok(button > badge, "selo deve vir antes do botão principal");
  assert.match(offer, /class="livros-bonus-badge"/);
});

test("seção .livros-bonus vem logo depois dos 3 passos e tem aria-labelledby", () => {
  const stepsStart = html.indexOf('<section class="sales-how sales-section" aria-labelledby="how-title">');
  const stepsEnd = html.indexOf("</section>", stepsStart);
  const next = html.indexOf("<section", stepsEnd);
  assert.ok(stepsStart >= 0 && stepsEnd > stepsStart);
  assert.match(html.slice(next, next + 80), /^<section class="livros-bonus" aria-labelledby="bonus-title">/);
  assert.match(html, /<h2 id="bonus-title">/);
});

test("headline do bônus é exata", () => {
  const headline = html.match(/<h2 id="bonus-title">([\s\S]*?)<\/h2>/)?.[1];
  assert.equal(normalizeText(headline || ""), "Leia e ouça ao mesmo tempo.");
});

// Ajuste (complemento dos 3 bônus): eyebrow e subheadline novos; a lista de 4 itens virou os 3 cards
// (verificados no teste seguinte) e a nota "Os áudios não acompanham o aplicativo" foi removida.
test("textos do bônus e CTA secundário presentes", () => {
  const bonus = normalizeText(sectionAt("livros-bonus"));
  for (const text of ["3 BÔNUS INCLUSOS", "Chuva tocando, uma música de meditação no fone ou um audiolivro enquanto você vira as páginas. Junto com o leitor, você leva:",
    "Chuva lá fora, trilha tocando e um bom livro aberto. Do seu jeito.", "QUERO LER E OUVIR NO LUMEO"]) assert.ok(bonus.includes(text), `Texto ausente: ${text}`);
  assert.doesNotMatch(sectionAt("livros-bonus"), /sales-button--primary/);
});

test("a seção tem exatamente 3 cards de bônus numerados, na ordem", () => {
  const cards = [...sectionAt("livros-bonus").matchAll(/<li class="livros-bonus__card">([\s\S]*?)<\/li>/g)].map((match) => match[1]);
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((card) => normalizeText(card.match(/<h3>([\s\S]*?)<\/h3>/)?.[1] || "")), ["Lumeo Audiolivros", "200 audiolivros clássicos", "Músicas para leitura"]);
  cards.forEach((card, index) => { assert.match(card, new RegExp(`BÔNUS ${index + 1}<`)); assert.match(card, /class="livros-bonus__icon"/); });
  assert.ok(normalizeText(cards[2]).includes("Diversas músicas e sons para acompanhar a leitura"));
});

// Ajuste (complemento dos 3 bônus): a lista passou de 1 para 3 bônus, numerados.
test("O que você recebe lista o leitor e os 3 bônus acima do preço", () => {
  const card = html.match(/<aside class="sales-price-card"[\s\S]*?<\/aside>/)?.[0] || "";
  const text = normalizeText(card);
  assert.ok(text.includes("O que você recebe:"));
  assert.ok(text.includes("Lumeo: leitor de livros para Android"));
  for (const bonus of ["Bônus 1: Lumeo Audiolivros", "Bônus 2: 200 audiolivros clássicos", "Bônus 3: Músicas para leitura"]) assert.ok(text.includes(bonus), `Ausente: ${bonus}`);
  assert.ok(card.indexOf("O que você recebe") < card.indexOf("data-sales-price"));
  assert.ok(text.includes("MENOS QUE UM LIVRO. BEM MENOS QUE UM LEITOR DIGITAL."));
});

// Ajuste (complemento dos 3 bônus): "Os audiolivros vêm inclusos?" saiu (agora há audiolivros nos bônus)
// e entraram 4 perguntas sobre os bônus; as demais continuam.
test("FAQ tem as perguntas dos bônus e mantém as atuais", () => {
  for (const question of ["Quais são os bônus?", "Que audiolivros vêm na lista de bônus?", "Posso adicionar meus próprios áudios?", "Como recebo os bônus?",
    "O que é o bônus Lumeo Audiolivros?", "Posso ouvir enquanto leio?", "Quais formatos de áudio funcionam?",
    "Como acesso o Lumeo?", "Os livros já vêm inclusos?", "Quais formatos posso adicionar?", "Tem garantia?"]) {
    assert.ok(js.includes(`["${question}"`), `Pergunta ausente: ${question}`);
  }
  assert.match(js, /\["Como recebo os bônus\?", "Junto com o acesso ao Lumeo, depois da confirmação da compra\."\]/);
});

// Ajuste (complemento dos 3 bônus): com audiolivros e músicas nos bônus, as microcopies falam só de livros.
test("microcopies dizem que livros não acompanham e que os bônus vão com o acesso", () => {
  assert.match(html, /<small class="sales-hero__legal">Use com seus próprios livros\. Livros não incluídos\.<\/small>/);
  assert.match(html, /<small>O aplicativo não inclui livros\. Os bônus são enviados junto com o acesso\.<\/small>/);
});

test("frases de que nenhum áudio vem incluso foram removidas", () => {
  const source = `${html}\n${js}`;
  for (const phrase of ["Os áudios não acompanham o aplicativo", "não inclui livros nem áudios", "Livros e áudios não incluídos", "Os audiolivros vêm inclusos?"]) {
    assert.equal(source.includes(phrase), false, `Ainda presente: ${phrase}`);
  }
});

test("página não usa termos proibidos", () => {
  const forbidden = ["grátis", "de graça", "+ 200", "+200", "1.500", "12 Regras", "1984", "Lei da Atração", "pagamento único"];
  const pageSource = `${html}\n${css}\n${js}\n${read("js/mobile-cta.js")}\n${read("js/livros-tracking.js")}`.toLocaleLowerCase("pt-BR");
  forbidden.forEach((term) => assert.equal(pageSource.includes(term.toLocaleLowerCase("pt-BR")), false, `Termo proibido: ${term}`));
});

test("CTA do bônus dispara InitiateCheckout com cta_location bonus", async () => {
  const { mountLivrosTracking } = await import(pathToFileURL(resolve(pageRoot, "js/livros-tracking.js")).href);
  const cta = html.match(/<button[^>]*data-livros-bonus-cta[^>]*>/)?.[0] || "";
  assert.match(cta, /data-sales-cta(?:\s|>)/); assert.match(cta, /data-sales-cta-location="bonus"/);
  const documentListeners = new Map(), assignments = [];
  class FakeObserver { constructor() {} observe() {} disconnect() {} }
  const documentRef = { documentElement: { scrollHeight: 1000 }, head: { append() {} }, createElement: () => ({}), getElementsByTagName: () => [],
    querySelector: () => null, addEventListener: (type, listener) => documentListeners.set(type, listener), removeEventListener() {} };
  const windowRef = { innerHeight: 200, scrollY: 0, location: { href: "https://lumeo.test/index-livros.html", assign: (url) => assignments.push(url) }, addEventListener() {}, removeEventListener() {} };
  const storage = new Map();
  mountLivrosTracking({ pixelId: "TEST", checkoutUrl: "https://checkout.test/", windowRef, documentRef, Observer: FakeObserver,
    sessionStorageRef: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
  const button = { dataset: { salesCtaLocation: "bonus" }, matches: () => false, closest: () => null };
  documentListeners.get("click")({ target: { closest: () => button }, preventDefault() {}, stopImmediatePropagation() {} });
  const checkout = windowRef.fbq.queue.map((args) => [...args]).filter((call) => call[1] === "InitiateCheckout");
  assert.equal(checkout.length, 1); assert.equal(checkout[0][2].cta_location, "bonus");
  assert.equal(assignments.length, 1);
});

test("botão fixo se esconde quando o CTA do bônus está visível", async () => {
  const { mountMobileCtaVisibility } = await import(pathToFileURL(resolve(pageRoot, "js/mobile-cta.js")).href);
  assert.match(js, /mountMobileCtaVisibility\(\{ extraCtaSelectors: \["\[data-livros-bonus-cta\]"\] \}\)/);
  const element = () => { const attributes = new Map(), classes = new Set(); return { dataset: {}, classList: { toggle: (name, force) => force ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name) },
    getAttribute: (name) => attributes.get(name) ?? null, setAttribute: (name, value) => attributes.set(name, String(value)), removeAttribute: (name) => attributes.delete(name) }; };
  const mobile = element(), hero = element(), offer = element(), bonus = element(), observed = [];
  const root = { querySelector: (selector) => ({ ".sales-mobile-cta": mobile, "[data-hqs-hero-cta]": hero, "[data-hqs-offer-cta]": offer, "[data-livros-bonus-cta]": bonus })[selector] };
  class FakeObserver { constructor(callback) { this.callback = callback; FakeObserver.instance = this; } observe(target) { observed.push(target); } disconnect() {} }
  mountMobileCtaVisibility({ root, Observer: FakeObserver, extraCtaSelectors: ["[data-livros-bonus-cta]"] });
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
