import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

it("usa uma única rota de audiobooks no menu e no rodapé, mantendo Ajustes no menu", () => {
  const bottom = source("src/views/MobileBottomNavigation.ts");
  const drawerItems = source("src/navigation/NavigationItem.ts");
  assert.match(bottom, /ui\.navigation\.library[\s\S]*ui\.home\.audiobooks[\s\S]*route: "audiobooks"/);
  assert.match(bottom, /icon: "🎧"/);
  assert.doesNotMatch(bottom, /route: "settings"/);
  assert.match(drawerItems, /ui\.home\.audiobooks", route: "audiobooks"/);
  assert.match(drawerItems, /ui\.settings\.title", route: "settings"/);
});

it("a tela de audiobooks usa o player local e mantém o estado vazio honesto", () => {
  const view = source("src/views/AudiobooksView.ts");
  assert.match(view, /Sua biblioteca de audiolivros está vazia/);
  assert.match(view, /AudiobookPlayer/);
  assert.match(view, /Só os capítulos que você reproduzir serão baixados/);
  assert.match(view, /Adicionar pasta de audiolivros/);
});

it("o player fechado respeita hidden e não deixa backdrop interceptar a biblioteca", () => {
  const styles = source("src/styles/home.css");
  assert.match(styles, /\.audiobook-miniplayer\[hidden\], \.audiobook-full-player\[hidden\] \{ display: none !important; \}/);
  assert.match(styles, /\.audiobook-full-player \{[^}]*pointer-events: none;/);
  assert.match(styles, /\.audiobook-full-player\.is-open \{ pointer-events: auto; \}/);
});

it("mantém player dentro da viewport e usa uma entrada de histórico para Voltar", () => {
  const view = source("src/views/AudiobooksView.ts");
  const styles = source("src/styles/home.css");
  assert.match(view, /window\.history\.pushState/);
  assert.match(view, /window\.history\.back\(\)/);
  assert.match(view, /Aguarde o download/);
  assert.match(styles, /\.audiobook-full-player \{ position: fixed; inset: 0; width: 100dvw;/);
  assert.match(styles, /\.audiobook-full-player__panel \{ width: min\(100dvw, 36rem\)/);
  assert.match(styles, /\.audiobook-miniplayer \{ position: fixed;/);
});

it("mantém o disco contínuo no DOM e coordena capa, agulha e reprodução", () => {
  const view = source("src/views/AudiobooksView.ts");
  const styles = source("src/styles/home.css");
  assert.match(view, /audiobook-turntable__brand", "LUMEO"/);
  assert.match(view, /audiobook-turntable__note", "♫"/);
  assert.match(view, /audiobook-turntable__hole/);
  assert.match(view, /audiobook-turntable__arm/);
  assert.match(view, /visualChapterId !== active\.id/);
  assert.match(view, /audiobook-turntable__cover/);
  assert.match(styles, /\.audiobook-full-player__cover\.is-playing \.audiobook-turntable__record,\.audiobook-main-player__visual\.is-playing \.audiobook-turntable__record \{ animation:audiobook-disc-spin/);
  assert.match(styles, /\.audiobook-main-player__visual\.is-cueing \.audiobook-turntable__arm/);
  assert.doesNotMatch(styles, /audiobook-turntable__arm[^\n]*animation:/);
});

it("exibe o player principal e as coleções em carrossel horizontal", () => {
  const view = source("src/views/AudiobooksView.ts");
  const styles = source("src/styles/home.css");
  assert.match(view, /createMainPlayer/);
  assert.match(view, /audiobook-collections-carousel/);
  assert.match(styles, /\.audiobook-collections-carousel \{[^}]*overflow-x:auto/);
  assert.match(styles, /\.audiobook-main-player \{[^}]*grid-template-columns/);
});

it("aguarda a agulha antes de iniciar o áudio e para durante download", () => {
  const player = source("src/audiobooks/AudiobookPlayer.ts");
  assert.match(player, /cueing: boolean/);
  assert.match(player, /setTimeout\(resolve, 560\)/);
  assert.match(player, /update\(\{ downloading: true, cueing: false/);
  assert.match(player, /await this\.cueAndPlay\(chapter\.id\)/);
});
