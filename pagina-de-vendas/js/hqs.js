import { SALES_CONFIG, bindCommercialActions, money, mountHeader } from "./shared.js";
import { mountMobileCtaVisibility } from "./mobile-cta.js";
import { mountAnalyticsConsent } from "./sales-consent.js";
import { mountHqsTracking } from "./hqs-tracking.js";
import { mountHqsTestimonials } from "./hqs-testimonials-marquee.js?v=20261024";
import { mountHqsArtHero } from "./hqs-art-hero.js?v=20261024-5";
import { mountHqsBonusCarousel } from "./hqs-bonus-carousel.js?v=20261024-marquee";

mountHeader(document.querySelector("[data-sales-header]"));
mountHqsArtHero();
mountHqsBonusCarousel();
document.querySelector(".sales-header__cta")?.setAttribute("data-hqs-cta-location", "header");
mountAnalyticsConsent();
mountHqsTracking({ checkoutUrl: SALES_CONFIG.checkoutUrls.hqs });
bindCommercialActions();
document.querySelector("[data-sales-year]").textContent = String(new Date().getFullYear());
document.querySelectorAll("[data-sales-price]").forEach((node) => { node.textContent = money(SALES_CONFIG.price); });

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

mountHqsTestimonials();
mountTutorials();
controlReaderVideo();
mountMobileCtaVisibility({ extraCtaSelectors: ['[data-hqs-cta-location="final"]'] });
