import { SALES_CONFIG, bindCommercialActions, money, mountHeader, openModal } from "./shared.js";
import { mountMobileCtaVisibility } from "./mobile-cta.js";
import { mountAnalyticsConsent } from "./sales-consent.js";
import { mountHqsTracking } from "./hqs-tracking.js";
import { mountTestimonials } from "./testimonials-carousel.js";

mountHeader(document.querySelector("[data-sales-header]"));
document.querySelector(".sales-header__cta")?.setAttribute("data-hqs-cta-location", "header");
mountAnalyticsConsent();
mountHqsTracking({ checkoutUrl: SALES_CONFIG.checkoutUrls.hqs });
bindCommercialActions();
document.querySelector("[data-sales-year]").textContent = String(new Date().getFullYear());
document.querySelectorAll("[data-sales-price]").forEach((node) => { node.textContent = money(SALES_CONFIG.price); });

const examples = [
  { id: "x-factor-119", title: "Capa ilustrativa · coleção 01", cover: "assets/hqs/x-factor-119.jpg" },
  { id: "x-factor-120", title: "Capa ilustrativa · coleção 02", cover: "assets/hqs/x-factor-120.jpg" },
  { id: "x-factor-132", title: "Capa ilustrativa · coleção 03", cover: "assets/hqs/x-factor-132.jpg" },
];

function openCover(item) {
  openModal(`
    <article class="sales-modal__dialog sales-book-modal" role="dialog" aria-modal="true" aria-labelledby="hqs-cover-title">
      <button class="sales-modal__close" type="button" data-sales-close aria-label="Fechar">×</button>
      <img src="${item.cover}" alt="${item.title}" />
      <div><p class="sales-eyebrow">DEMONSTRAÇÃO VISUAL</p><h2 id="hqs-cover-title">${item.title}</h2><p>Esta capa aparece apenas como exemplo da organização visual. Quadrinhos não acompanham o aplicativo.</p><button class="sales-button sales-button--primary" type="button" data-sales-cta data-hqs-cta-location="modal">QUERO ORGANIZAR MINHAS HQs</button></div>
    </article>`, bindCommercialActions);
}

function coverCard(item) {
  const article = document.createElement("article");
  article.className = "hqs-cover";
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", `Ver ${item.title}`);
  const image = document.createElement("img");
  image.src = item.cover;
  image.alt = item.title;
  image.loading = "lazy";
  image.decoding = "async";
  const title = document.createElement("h3");
  title.textContent = item.title;
  button.append(image);
  button.addEventListener("click", () => openCover(item));
  article.append(button, title);
  return article;
}

function mountLibrary() {
  const root = document.querySelector("[data-hqs-library]");
  if (!root) return;
  [examples, [...examples].reverse()].forEach((items, index) => {
    const rail = document.createElement("div");
    rail.className = `hqs-library__rail${index ? " hqs-library__rail--reverse" : ""}`;
    [...items, ...items, ...items].forEach((item) => rail.append(coverCard(item)));
    root.append(rail);
  });
  const notice = document.createElement("p");
  notice.className = "hqs-library__notice";
  notice.textContent = "Exemplos visuais de uma coleção pessoal. Os quadrinhos não acompanham o aplicativo.";
  root.append(notice);
}

function mountFaq() {
  const root = document.querySelector("[data-hqs-faq]");
  if (!root) return;
  const rows = [
    ["O que é o Lumeo?", "O Lumeo é um aplicativo leitor e organizador para a sua biblioteca pessoal no Android."],
    ["A compra inclui HQs?", "O valor é referente ao aplicativo leitor. Como bônus, após a compra você recebe por link separado do Google Drive uma coleção de HQs da Turma da Mônica, 1.500 livros digitais e 200 audiolivros. Eles não ficam pré-instalados no aplicativo, e você também pode usar seus próprios arquivos."],
    ["Como adiciono meus próprios quadrinhos?", "Você pode selecionar arquivos compatíveis no dispositivo ou adicionar uma pasta autorizada do Google Drive."],
    ["Posso usar links do Google Drive?", "Sim. O aplicativo oferece importação de links autorizados do Google Drive para sua biblioteca pessoal."],
    ["Quais formatos de HQ são compatíveis?", "A biblioteca de HQs aceita PDF, CBR e CBZ. Recursos específicos podem variar conforme o arquivo e a versão instalada do aplicativo."],
    ["Como funciona a experiência de leitura de HQs?", "O Lumeo possui uma experiência de leitura visual para HQs. Recursos específicos podem variar conforme o arquivo e a versão instalada do aplicativo."],
    ["Funciona em celular e tablet Android?", "Sim. O Lumeo foi pensado para uso em celulares e tablets Android."],
    ["Como funciona a compra?", "Ao tocar em um botão de compra, você será direcionado ao checkout seguro da Hotmart, onde verá as condições antes da confirmação do pagamento."],
    ["Como recebo acesso após a compra?", "Após a confirmação da compra, você recebe as orientações de acesso ao aplicativo Lumeo."],
  ];
  root.replaceChildren(...rows.map(([question, answer]) => {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const text = document.createElement("p");
    summary.textContent = question;
    text.textContent = answer;
    details.append(summary, text);
    return details;
  }));
}

function mountTutorials() {
  const videos = [...document.querySelectorAll("[data-hqs-tutorial]")];
  if (!videos.length) return;

  const timelines = {
    "hqs-drive": [
      [0, "Veja como é fácil adicionar suas HQs ao Lumeo."],
      [2, "Comece colando o link da pasta do Google Drive."],
      [4.6, "Selecione HQs e Mangás para classificar a pasta."],
      [10.1, "Toque em Adicionar e aguarde o carregamento."],
      [14.1, "Pronto! Explore suas capas e encontre a próxima HQ para ler."],
    ],
    "hqs-reading": [
      [0, "Conheça a interface do leitor de HQs."],
      [5, "A demonstração mostra recursos que podem variar por arquivo e versão."],
      [8.8, "A ampliação automatizada de balões não funciona em todas as páginas."],
      [13, "Personalize a aparência da sua leitura."],
      [15.6, "Escolha tema, brilho e outras preferências disponíveis."],
      [18.2, "Organize seu tempo com o Pomodoro Lumeo."],
      [22.1, "Configure lembretes para manter sua rotina de leitura."],
    ],
  };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const visibility = new Map(videos.map((video) => [video, 0]));
  const typingTimers = new WeakMap();
  const captionIndexes = new WeakMap();
  const previousTimes = new WeakMap();
  let focusedVideo = null;

  const clearTyping = (video) => {
    const timer = typingTimers.get(video);
    if (timer) window.clearInterval(timer);
    typingTimers.delete(video);
  };

  const resetCaptions = (video) => {
    clearTyping(video);
    const captions = video.closest(".hqs-tutorial-card")?.querySelector("[data-tutorial-captions]");
    captions?.replaceChildren();
    captionIndexes.set(video, -1);
  };

  const typeCaption = (video, captions, text) => {
    clearTyping(video);
    captions.querySelectorAll("p").forEach((line) => line.removeAttribute("data-typing"));
    const line = document.createElement("p");
    line.dataset.typing = "true";
    captions.append(line);
    while (captions.children.length > 4) captions.firstElementChild?.remove();

    let index = 0;
    const write = () => {
      index += 1;
      line.textContent = text.slice(0, index);
      if (index >= text.length) {
        line.removeAttribute("data-typing");
        clearTyping(video);
      }
    };
    write();
    typingTimers.set(video, window.setInterval(write, 30));
  };

  const syncCaption = (video) => {
    const captions = video.closest(".hqs-tutorial-card")?.querySelector("[data-tutorial-captions]");
    const timeline = timelines[video.dataset.tutorialKey] || [];
    if (!captions || !timeline.length) return;

    const previousTime = previousTimes.get(video) ?? 0;
    if (video.currentTime + 0.4 < previousTime) {
      resetCaptions(video);
      const visibleVideos = videos.filter((candidate) => (visibility.get(candidate) || 0) >= 0.4);
      if (focusedVideo === video && visibleVideos.length > 1) {
        const currentIndex = visibleVideos.indexOf(video);
        const nextVideo = visibleVideos[(currentIndex + 1) % visibleVideos.length];
        focusedVideo = nextVideo;
        video.pause();
        playWhenReady(nextVideo);
        previousTimes.set(video, video.currentTime);
        return;
      }
    }
    previousTimes.set(video, video.currentTime);

    const nextIndex = timeline.reduce(
      (last, [start], index) => (video.currentTime >= start ? index : last),
      -1,
    );
    if (nextIndex >= 0 && nextIndex !== (captionIndexes.get(video) ?? -1)) {
      captionIndexes.set(video, nextIndex);
      typeCaption(video, captions, timeline[nextIndex][1]);
    }
  };

  const hydrate = (video) => {
    if (video.dataset.hydrated === "true") return;
    const source = video.querySelector("source[data-src]");
    if (!source?.dataset.src) return;
    source.src = source.dataset.src;
    video.dataset.hydrated = "true";
    video.preload = "metadata";
    video.load();
  };

  const pauseOthers = (current) => {
    videos.forEach((candidate) => {
      if (candidate !== current && !candidate.paused) candidate.pause();
    });
  };

  const playWhenReady = (video) => {
    if (reducedMotion.matches || document.hidden) return;
    hydrate(video);
    pauseOthers(video);
    const play = () => {
      if (focusedVideo !== video || reducedMotion.matches || document.hidden) return;
      video.play().catch(() => {});
    };
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) play();
    else video.addEventListener("canplay", play, { once: true });
  };

  const selectVisibleVideo = () => {
    if (reducedMotion.matches || document.hidden) {
      focusedVideo = null;
      videos.forEach((video) => video.pause());
      return;
    }
    const nextVideo = [...visibility.entries()]
      .filter(([, ratio]) => ratio >= 0.4)
      .sort(([, first], [, second]) => second - first)[0]?.[0] || null;
    if (!nextVideo) {
      focusedVideo = null;
      videos.forEach((video) => video.pause());
      return;
    }
    focusedVideo = nextVideo;
    playWhenReady(nextVideo);
  };

  videos.forEach((video) => {
    video.muted = true;
    video.loop = true;
    captionIndexes.set(video, -1);
    previousTimes.set(video, 0);
    video.addEventListener("timeupdate", () => syncCaption(video));
    video.addEventListener("play", () => {
      pauseOthers(video);
      syncCaption(video);
    });
  });

  reducedMotion.addEventListener("change", selectVisibleVideo);
  document.addEventListener("visibilitychange", selectVisibleVideo);

  if (!("IntersectionObserver" in window)) {
    hydrate(videos[0]);
    focusedVideo = videos[0];
    playWhenReady(videos[0]);
    return;
  }

  const preloadObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      hydrate(entry.target);
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "600px 0px", threshold: 0 });

  const playbackObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      visibility.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
    });
    selectVisibleVideo();
  }, { threshold: [0, 0.2, 0.4, 0.65, 0.85] });

  videos.forEach((video) => {
    preloadObserver.observe(video);
    playbackObserver.observe(video);
  });
}

function controlReaderVideo() {
  const video = document.querySelector("[data-hqs-reader-demo]");
  if (!video) return;
  const hydrate = () => {
    if (video.dataset.hydrated) return;
    video.querySelectorAll("source[data-src]").forEach((source) => { source.src = source.dataset.src; });
    video.dataset.hydrated = "true";
    video.load();
  };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const sync = () => {
    if (reducedMotion.matches) video.pause();
    else { hydrate(); video.play().catch(() => {}); }
  };
  reducedMotion.addEventListener("change", sync);
  if (!("IntersectionObserver" in window)) { sync(); return; }
  new IntersectionObserver(([entry]) => {
    if (reducedMotion.matches) return;
    if (entry.isIntersecting && entry.intersectionRatio >= .35) { hydrate(); video.play().catch(() => {}); }
    else video.pause();
  }, { threshold: [.1, .35] }).observe(video);
}

mountLibrary();
mountFaq();
mountTestimonials();
mountTutorials();
controlReaderVideo();
mountMobileCtaVisibility();
