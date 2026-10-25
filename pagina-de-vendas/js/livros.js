import { SALES_CONFIG, bindCommercialActions, money, mountHeader, openModal } from "./shared.js";
import { loadCatalog } from "./catalogo.js";
import { mountLivrosTracking } from "./livros-tracking.js";
import { mountMobileCtaVisibility } from "./mobile-cta.js";
import { mountAnalyticsConsent } from "./sales-consent.js";
import { mountLivrosArtHero } from "./livros-art-hero.js?v=20261024-2";
import { mountLivrosBonusCarousel } from "./livros-bonus-carousel.js?v=20261024-2";
import { mountLivrosTestimonials } from "./livros-testimonials-marquee.js?v=20261024-2";
import { mountHqsMarquee } from "./hqs-marquee.js?v=20261024-4";

mountHeader(document.querySelector("[data-sales-header]"));
mountLivrosArtHero();
mountLivrosBonusCarousel();
mountLivrosTestimonials();
document.querySelector(".sales-header__cta")?.setAttribute("data-sales-cta-location", "header");
mountAnalyticsConsent();
mountLivrosTracking({ checkoutUrl: SALES_CONFIG.checkoutUrls.livros });
bindCommercialActions();
document.querySelector("[data-sales-year]").textContent = String(new Date().getFullYear());
document.querySelectorAll("[data-sales-price]").forEach((node) => { node.textContent = money(SALES_CONFIG.livrosPrice); });

const downloaded = new Set();
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

function setDownloadState(id, active = true) {
  if (active) downloaded.add(id);
  document.querySelectorAll(`[data-demo-download="${CSS.escape(id)}"]`).forEach((button) => {
    button.setAttribute("aria-pressed", String(downloaded.has(id)));
    button.textContent = downloaded.has(id) ? "✓" : "↓";
    button.setAttribute("aria-label", downloaded.has(id) ? "Download simulado concluído" : "Simular download");
  });
}

function openBookDetails(item) {
  const summary = item.sinopse || "Sinopse não disponível nesta demonstração.";
  const isDownloaded = downloaded.has(item.id);
  openModal(`
    <article class="sales-modal__dialog sales-book-modal" role="dialog" aria-modal="true" aria-labelledby="sales-book-title">
      <button class="sales-modal__close" type="button" data-sales-close aria-label="Fechar">×</button>
      <img src="${escapeHtml(item.capa)}" alt="Capa de ${escapeHtml(item.titulo)}" />
      <div><p class="sales-eyebrow">Demonstração visual · ${escapeHtml(item.genero || "Biblioteca")}</p><h2 id="sales-book-title">${escapeHtml(item.titulo)}</h2><p class="sales-book-modal__author">${escapeHtml(item.autor || "Autor não informado")}</p><p>${escapeHtml(summary)}</p></div>
      <div class="sales-book-modal__actions"><button class="sales-button sales-button--secondary" type="button" data-demo-modal-download>${isDownloaded ? "Baixado ✓" : "Baixar"}</button><button class="sales-button sales-button--primary" type="button" data-demo-read>Ler</button><p class="sales-book-modal__status" data-demo-status aria-live="polite"></p></div>
    </article>`, (modal) => {
      const status = modal.querySelector("[data-demo-status]");
      modal.querySelector("[data-demo-modal-download]")?.addEventListener("click", (event) => {
        setDownloadState(item.id); event.currentTarget.textContent = "Baixado ✓";
        status.textContent = "Simulação concluída. No aplicativo, o arquivo escolhido fica disponível offline.";
      });
      modal.querySelector("[data-demo-read]")?.addEventListener("click", () => {
        status.textContent = "Demonstração: no Lumeo, este botão abre o arquivo que você adicionou.";
      });
    });
}

function bookCard(item) {
  const article = document.createElement("article"); article.className = "sales-demo-book"; article.dataset.demoBook = item.id;
  const cover = document.createElement("button"); cover.type = "button"; cover.className = "sales-demo-book__cover"; cover.setAttribute("aria-label", `Ver detalhes de ${item.titulo}`);
  const image = document.createElement("img"); image.src = item.capa; image.alt = `Capa de ${item.titulo}`; image.loading = "lazy"; image.decoding = "async"; image.width = 180; image.height = 270;
  const download = document.createElement("button"); download.type = "button"; download.className = "sales-demo-book__download"; download.dataset.demoDownload = item.id; download.setAttribute("aria-pressed", String(downloaded.has(item.id))); download.textContent = downloaded.has(item.id) ? "✓" : "↓"; download.setAttribute("aria-label", `Simular download de ${item.titulo}`);
  const title = document.createElement("h3"); title.textContent = item.titulo;
  // Os cliques são tratados no carrossel (mountLibrary), para valerem também nas cópias do loop.
  cover.append(image); article.append(cover, download, title); return article;
}

function mountLibrary(items) {
  const root = document.querySelector("[data-sales-library]"); if (!root) return;
  const useful = items.filter((item) => item?.capa && item?.titulo);
  const selected = [...useful.filter((item) => item.sinopse), ...useful.filter((item) => !item.sinopse)].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 20);
  if (selected.length < 2) { root.textContent = "A demonstração da biblioteca está sendo preparada."; return; }
  const byId = new Map(selected.map((item) => [item.id, item]));
  const marquees = [];
  const middle = Math.ceil(selected.length / 2);
  // Mesmo carrossel dos bônus e depoimentos: loop infinito, segurar pausa, arrastar move as capas
  // com o dedo e o gesto vertical rola a página. A primeira fileira anda para a esquerda, a segunda para a direita.
  [selected.slice(0, middle), selected.slice(middle)].forEach((row, index) => {
    const viewport = document.createElement("div"); viewport.className = "sales-library__viewport"; viewport.setAttribute("role", "group"); viewport.setAttribute("aria-label", `Exemplos de biblioteca, linha ${index + 1}`);
    const rail = document.createElement("div"); rail.className = `sales-library__rail${index ? " sales-library__rail--reverse" : ""}`;
    row.forEach((item) => rail.append(bookCard(item)));
    viewport.append(rail); root.append(viewport);
    // Depois de um arraste o carrossel cancela o clique (fase de captura), então só toques simples chegam aqui.
    viewport.addEventListener("click", (event) => {
      const item = byId.get(event.target.closest(".sales-demo-book")?.dataset.demoBook);
      if (!item) return;
      if (event.target.closest(".sales-demo-book__download")) setDownloadState(item.id);
      else if (event.target.closest(".sales-demo-book__cover")) { marquees.forEach((marquee) => marquee?.pause()); openBookDetails(item); }
    });
    marquees.push(mountHqsMarquee({ viewport, track: rail, cardSelector: ".sales-demo-book", direction: index ? 1 : -1, speed: index ? 22 : 26, dragThreshold: 8, horizontalRatio: 1.4 }));
  });
  const modal = document.querySelector("[data-sales-modal]");
  if (modal) new MutationObserver(() => { if (modal.hidden) marquees.forEach((marquee) => marquee?.resume()); }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
}

function mountTutorials() {
  const videos = [...document.querySelectorAll("[data-sales-tutorial]")];
  const timelines = {
    drive: [
      [0, "Veja como é fácil adicionar sua biblioteca ao Lumeo."],
      [3.6, "Copie o link da sua pasta no Google Drive."],
      [7.2, "Cole o link dentro do aplicativo."],
      [10.8, "Escolha a categoria da sua coleção."],
      [14.3, "Confirme e aguarde a renderização."],
      [18.1, "Quanto mais livros, mais tempo a sincronização pode levar."],
      [22.1, "Os títulos começam a aparecer na sua biblioteca."],
      [26.3, "Explore ou pesquise pelo nome do livro."],
      [30.1, "Assim fica muito mais fácil encontrar o que deseja."],
    ],
    reading: [
      [0, "O Lumeo oferece uma experiência de leitura imersiva."],
      [3.7, "Abra o livro e acompanhe as páginas com conforto."],
      [7.4, "Ajuste fonte e aparência do seu jeito."],
      [11.2, "Deixe a leitura mais agradável no seu Android."],
      [15, "Use o Pomodoro para organizar seu tempo."],
      [18.3, "Defina pausas, sessões e seu ritmo de estudo."],
      [21.3, "Crie lembretes para manter sua rotina de leitura."],
    ],
  };
  const hydrate = (video) => {
    if (video.dataset.hydrated) return;
    video.querySelectorAll("source[data-src]").forEach(source => { source.src = source.dataset.src; });
    video.dataset.hydrated = "true"; video.load();
  };
  const activeVideos = new Set();
  let typingTimer;
  const pauseOthers = (current) => videos.forEach((candidate) => {
    if (candidate !== current && !candidate.paused) {
      candidate.pause();
      activeVideos.delete(candidate);
    }
  });
  const typeCaption = (captions, text) => {
    captions.querySelectorAll("p").forEach((line) => line.removeAttribute("data-typing"));
    const line = document.createElement("p");
    line.dataset.typing = "true";
    captions.append(line);
    while (captions.children.length > 4) captions.firstElementChild.remove();
    clearInterval(typingTimer);
    let index = 0;
    const write = () => {
      line.textContent = text.slice(0, index);
      if (index >= text.length) {
        line.removeAttribute("data-typing");
        clearInterval(typingTimer);
      }
      index += 1;
    };
    write();
    typingTimer = setInterval(write, 26);
  };
  videos.forEach((video) => {
    const captions = video.closest(".sales-tutorial-card")?.querySelector("[data-tutorial-captions]");
    const timeline = timelines[video.dataset.tutorialKey] || [];
    let captionIndex = -1;
    video.addEventListener("pointerdown", () => hydrate(video), { once: true });
    video.addEventListener("focus", () => hydrate(video), { once: true });
    video.muted = true;
    video.loop = true;
    const syncCaption = () => {
      const nextIndex = timeline.reduce((last, [start], index) => (video.currentTime >= start ? index : last), -1);
      if (nextIndex !== captionIndex && captions && nextIndex >= 0) {
        captionIndex = nextIndex;
        typeCaption(captions, timeline[nextIndex][1]);
      }
    };
    video.addEventListener("timeupdate", syncCaption);
    video.addEventListener("play", () => { pauseOthers(video); activeVideos.add(video); syncCaption(); });
    video.addEventListener("pause", () => activeVideos.delete(video));
    video.addEventListener("ended", () => { captionIndex = -1; });
  });
  if (!("IntersectionObserver" in window)) {
    videos.forEach(hydrate);
    return;
  }
  const visibility = new Map();
  let focusedVideo = null;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      visibility.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
      if (entry.isIntersecting) hydrate(entry.target);
    });
    if (focusedVideo && (visibility.get(focusedVideo) || 0) >= .2 && !focusedVideo.paused) return;
    const nextVideo = [...visibility.entries()]
      .filter(([, ratio]) => ratio >= .4)
      .sort(([, first], [, second]) => second - first)[0]?.[0];
    if (nextVideo) {
      focusedVideo = nextVideo;
      pauseOthers(nextVideo);
      hydrate(nextVideo);
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && !navigator.connection?.saveData) nextVideo.play().catch(() => {});
    } else {
      focusedVideo = null;
      videos.forEach((video) => video.pause());
    }
  }, { threshold: [.2, .4, .8] });
  videos.forEach((video) => observer.observe(video));
}

// O botão do WhatsApp (com o selo "Dúvidas" e a seta) some enquanto ficaria por cima de algum texto,
// preço, botão ou link da oferta final e do rodapé; volta assim que a área fica livre.
function mountWhatsappFinalClearance(root = document) {
  const whatsapp = root.querySelector("[data-sales-whatsapp]");
  const nudge = root.querySelector(".hqs-whatsapp-nudge");
  const guarded = [...root.querySelectorAll(".livros-final-cta__inner > *, .livros-footer > img, .livros-footer > p, .livros-footer a, .livros-footer button")];
  if (!whatsapp || !guarded.length) return;
  let frame = 0;
  const check = () => {
    frame = 0;
    const zone = whatsapp.getBoundingClientRect();
    const label = nudge?.getBoundingClientRect();
    // A seta animada fica acima do ícone, fora das caixas do botão e do selo.
    const top = zone.top - 30, left = Math.min(zone.left, label?.width ? label.left : zone.left);
    const covered = !whatsapp.hidden && guarded.some((element) => {
      const box = element.getBoundingClientRect();
      return box.width && box.left < zone.right && box.right > left && box.top < zone.bottom && box.bottom > top;
    });
    whatsapp.classList.toggle("sales-whatsapp--clear-livros-final", covered);
    nudge?.classList.toggle("hqs-whatsapp-nudge--clear-livros-final", covered);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(check); };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });
  new MutationObserver(schedule).observe(whatsapp, { attributes: true, attributeFilter: ["hidden"] });
  schedule();
}

// Como em HQs, a barra fixa some na oferta final; aqui também durante toda a seção e o rodapé, para não cobrir textos nem links.
mountTutorials(); mountWhatsappFinalClearance(); mountMobileCtaVisibility({ extraCtaSelectors: ["[data-livros-audiobooks-cta]", "#final-cta", ".livros-footer"] });
try { mountLibrary((await loadCatalog("livros")).items || []); }
catch (error) { const root = document.querySelector("[data-sales-library]"); if (root) root.textContent = "Não foi possível carregar a demonstração da biblioteca."; console.error("Lumeo demo library unavailable", error); }
