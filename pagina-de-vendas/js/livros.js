import { SALES_CONFIG, bindCommercialActions, money, mountHeader, openModal } from "./shared.js";
import { loadCatalog } from "./catalogo.js";
import { mountBooksHeroVideo } from "./livros-hero-video.js";
import { mountLivrosTracking } from "./livros-tracking.js";
import { mountMobileCtaVisibility } from "./mobile-cta.js";
import { mountAnalyticsConsent } from "./sales-consent.js";
import { mountTestimonials } from "./testimonials-carousel.js";

mountHeader(document.querySelector("[data-sales-header]"));
document.querySelector(".sales-header__cta")?.setAttribute("data-sales-cta-location", "header");
mountAnalyticsConsent();
mountLivrosTracking({ checkoutUrl: SALES_CONFIG.checkoutUrls.livros });
bindCommercialActions();
document.querySelector("[data-sales-year]").textContent = String(new Date().getFullYear());
document.querySelectorAll("[data-sales-price]").forEach((node) => { node.textContent = money(SALES_CONFIG.price); });

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
  const article = document.createElement("article"); article.className = "sales-demo-book";
  const cover = document.createElement("button"); cover.type = "button"; cover.className = "sales-demo-book__cover"; cover.setAttribute("aria-label", `Ver detalhes de ${item.titulo}`);
  const image = document.createElement("img"); image.src = item.capa; image.alt = `Capa de ${item.titulo}`; image.loading = "lazy"; image.decoding = "async"; image.width = 180; image.height = 270;
  const download = document.createElement("button"); download.type = "button"; download.className = "sales-demo-book__download"; download.dataset.demoDownload = item.id; download.setAttribute("aria-pressed", String(downloaded.has(item.id))); download.textContent = downloaded.has(item.id) ? "✓" : "↓"; download.setAttribute("aria-label", `Simular download de ${item.titulo}`);
  const title = document.createElement("h3"); title.textContent = item.titulo;
  cover.append(image); cover.addEventListener("click", () => openBookDetails(item)); download.addEventListener("click", () => setDownloadState(item.id)); article.append(cover, download, title); return article;
}

function mountLibrary(items) {
  const root = document.querySelector("[data-sales-library]"); if (!root) return;
  const useful = items.filter((item) => item?.capa && item?.titulo);
  const selected = [...useful.filter((item) => item.sinopse), ...useful.filter((item) => !item.sinopse)].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 20);
  if (selected.length < 2) { root.textContent = "A demonstração da biblioteca está sendo preparada."; return; }
  const middle = Math.ceil(selected.length / 2);
  [selected.slice(0, middle), selected.slice(middle)].forEach((row, index) => {
    const rail = document.createElement("div"); rail.className = `sales-library__rail${index ? " sales-library__rail--reverse" : ""}`; rail.setAttribute("aria-label", `Exemplos de biblioteca, linha ${index + 1}`);
    [...row, ...row].forEach((item) => rail.append(bookCard(item))); root.append(rail);
  });
}

function mountFaq() {
  const root = document.querySelector("[data-sales-faq]"); if (!root) return;
  const rows = [
    ["Como acesso o Lumeo?", "Após a confirmação da compra, você recebe as orientações de acesso ao aplicativo Lumeo."],
    ["O Lumeo funciona no celular?", "Sim. O Lumeo foi pensado para celulares Android e possui interface adaptada para telas móveis."],
    ["Posso usar no tablet?", "Sim. Em tablets Android, você aproveita mais espaço para a biblioteca e para as páginas."],
    ["Os livros já vêm inclusos?", "O aplicativo é um leitor pessoal. Após a compra, esta oferta entrega por link separado do Google Drive acesso à coleção anunciada de 1.500 livros digitais; os arquivos não ficam pré-instalados no app."],
    ["Posso adicionar meus próprios arquivos?", "Sim. Você pode selecionar arquivos compatíveis no aparelho ou adicionar uma pasta autorizada do Google Drive."],
    ["Quais formatos posso adicionar?", "Esta página trata da leitura de PDF e EPUB. A compatibilidade pode variar conforme o arquivo e a versão instalada."],
    ["O Lumeo vem com livros ou áudios?", "Após a compra, a oferta entrega por link separado do Google Drive os bônus anunciados de 1.500 livros digitais e 200 audiolivros. Eles não ficam instalados automaticamente no aplicativo."],
    ["Como funcionam os audiolivros?", "Após a compra, o bônus de 200 audiolivros é entregue por link separado do Google Drive. No Lumeo, o player reproduz os arquivos MP3 adicionados por você, com download por faixa quando você solicita a reprodução."],
    ["Posso ouvir enquanto leio?", "Sim. O áudio continua tocando no mini player enquanto você lê outro livro no Lumeo."],
    ["Posso adicionar meus próprios áudios?", "Sim. Você adiciona pastas de áudio do Google Drive, como audiolivros, cursos ou playlists."],
    ["Quais formatos de áudio funcionam?", "Arquivos MP3."],
    ["O Lumeo ajuda a organizar minha leitura?", "Sim. Biblioteca visual, pesquisa, gêneros, progresso e leitura offline ajudam você a encontrar e retomar seus arquivos."],
    ["Como funcionam lembretes e Pomodoro?", "Você pode organizar sessões por tempo ou páginas, programar pausas e criar lembretes de leitura no Android."],
    ["Como funciona a compra?", "O pagamento será concluído em um checkout externo quando a integração da Hotmart estiver configurada. As condições serão apresentadas antes da confirmação."],
  ];
  root.replaceChildren(...rows.map(([question, answer]) => { const details = document.createElement("details"); const summary = document.createElement("summary"), text = document.createElement("p"); summary.textContent = question; text.textContent = answer; details.append(summary, text); return details; }));
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
    videos.forEach((video) => video.play().catch(() => {}));
    return;
  }
  const visibility = new Map();
  let focusedVideo = null;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => visibility.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0));
    if (focusedVideo && (visibility.get(focusedVideo) || 0) >= .2 && !focusedVideo.paused) return;
    const nextVideo = [...visibility.entries()]
      .filter(([, ratio]) => ratio >= .4)
      .sort(([, first], [, second]) => second - first)[0]?.[0];
    if (nextVideo) {
      focusedVideo = nextVideo;
      pauseOthers(nextVideo);
      nextVideo.play().catch(() => {});
    } else {
      focusedVideo = null;
      videos.forEach((video) => video.pause());
    }
  }, { threshold: [.2, .4, .8] });
  videos.forEach((video) => observer.observe(video));
}

mountFaq(); mountTestimonials(); mountTutorials(); mountBooksHeroVideo(); mountMobileCtaVisibility({ extraCtaSelectors: ["[data-livros-audiobooks-cta]"] });
try { mountLibrary((await loadCatalog("livros")).items || []); }
catch (error) { const root = document.querySelector("[data-sales-library]"); if (root) root.textContent = "Não foi possível carregar a demonstração da biblioteca."; console.error("Lumeo demo library unavailable", error); }
