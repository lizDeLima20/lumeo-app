# Hero de HQs — encaixe dos vídeos no tablet e no celular

Leia antes de trocar o vídeo do tablet ou do celular da hero de `index-hqs.html`,
ou antes de mexer nos pontos de encaixe. Todas as medidas abaixo estão em
**pixels da arte** (não em pixels CSS) e valem para qualquer largura de tela,
porque o script reescala tudo proporcionalmente.

## 1. Como a hero é montada

Camadas, de baixo para cima (todas dentro de `.hqs-art-hero`, que mantém a
proporção da arte):

| z-index | Elemento | Papel |
|---|---|---|
| — | `<picture class="hqs-art-hero__art">` | arte aprovada (aparelhos, textos, preço, CTA desenhado) |
| 2 | `.hqs-art-hero__tablet-screen` + `<video>` | vídeo do tablet, projetado em perspectiva |
| 3 | `.hqs-art-hero__phone-screen` + `<video>` | vídeo do celular (fica na frente do tablet) |
| 4 | `<svg class="hqs-art-hero__frame-overlay">` | a mesma arte redesenhada **por cima**, com uma máscara que tem dois furos: as telas |
| 5 | `.hqs-art-hero__cta` | área clicável invisível sobre o botão desenhado |

- **Quem posiciona o vídeo:** `js/hqs-art-hero.js`. Para cada aparelho, a
  constante `GEOMETRY` guarda `source` (tamanho nativo do vídeo) e `points`
  (onde os 4 cantos do vídeo caem na arte). O script calcula uma homografia e
  aplica `matrix3d()`, recalculando em todo redimensionamento.
- **Quem define o que aparece:** os furos (`<path fill="#000">`) da máscara
  `hqs-art-mask-mobile` / `hqs-art-mask-desktop` no `index-hqs.html`. Fora do
  furo a moldura da arte cobre o vídeo.
- **Regra de ouro:** o vídeo precisa sempre ser **maior que o furo** (sobra de
  1–5 px por baixo da moldura). Se o furo sair do vídeo em algum ponto, a arte
  original aparece dentro da tela.

Dois layouts, trocados em **768 px** (`ART_BREAKPOINT` no JS e `48rem` no
CSS/`<picture>`):

| Layout | Arte | Tamanho da arte |
|---|---|---|
| mobile (< 768 px) | `assets/optimized/lumeo-hqs-hero-mobile-approved.webp` | 941 × 1672 |
| desktop (≥ 768 px) | `assets/optimized/lumeo-hqs-hero-desktop-approved.webp` | 1672 × 941 |

## 2. Vídeos atuais

| | Tablet | Celular |
|---|---|---|
| Arquivo | `assets/tutorials/hqs/lumeo-hqs-tablet-two-pages-loop-3s.mp4` | `assets/tutorials/hqs/lumeo-hqs-phone-loop-7s.mp4` |
| Resolução | **720 × 546** (proporção 1,319 : 1, paisagem) | **360 × 830** (proporção 0,434 : 1, retrato) |
| Duração / fps | 2,7 s / 18 fps | 6,5 s / 15 fps |
| Codec | H.264 High, yuv420p, sem áudio | H.264 High, yuv420p, sem áudio |
| Peso | 348 KB | 400 KB |
| Poster | `lumeo-hqs-tablet-two-pages-poster.webp` 720 × 546 | `lumeo-hqs-phone-poster.webp` 360 × 830 |
| Conteúdo | duas páginas de HQ abertas | app Lumeo, barra de status no topo |

O `<video>` ocupa 100% do contêiner com `object-fit: cover`. O contêiner tem
exatamente `source` em px. Se o vídeo novo tiver outra proporção, ele é
cortado (cover) e depois esticado para a tela, ficando deformado. **Mantenha
a mesma proporção.**

## 3. Geometria atual

Pontos sempre na ordem **superior esquerdo, superior direito, inferior
direito, inferior esquerdo**, em px da arte.

### Mobile (arte 941 × 1672)

| | Tablet | Celular |
|---|---|---|
| `source` | `[720, 546]` | `[360, 830]` |
| `points` do vídeo | `[116,758] [676,814] [694,1229] [65,1184]` | `[694,804] [893,789] [889,1270] [664,1264]` |
| Furo da máscara | `M119 762 L648 817.7 Q657 819.5 667 838 L671 860 … L659 1220 L658 1224 L69 1179 Z` | `M692.5 838 C692.8 816 705 805.5 724 802 L876 792 Q887 792 888 804 L886 1253 Q886 1263 876 1263 L676 1260 Q666 1260 666 1249 Z` |

- **Lado direito do tablet:** o furo acompanha o aro dourado do canto do
  tablet até y≈920 e, daí para baixo, o aro esquerdo do celular, que fica na
  frente. Essa parte do tablet é escondida pelo celular **de propósito**.
- **Topo do celular:** o aro sobe para a direita (y≈800 em x=740 → y≈790 em
  x=880). O furo e o vídeo acompanham essa inclinação.
- **Canto superior esquerdo do celular:** arredondado pela curva `C` (raio
  ≈ 30 px da arte), seguindo o aro. A borda esquerda fica ~2 px para dentro do
  aro dourado, que precisa continuar visível.
- **Notch:** `<rect x="752" y="786" width="91" height="41" rx="14.5" fill="#fff">`.
  Branco na máscara = mostra a arte, ou seja, o notch e o aro de cima da arte
  ficam por cima do vídeo.

### Desktop (arte 1672 × 941)

| | Tablet | Celular |
|---|---|---|
| `source` | `[720, 546]` | `[360, 830]` |
| `points` do vídeo | `[803,254] [1370,357] [1356,750] [744,708]` | `[1387,319] [1600,302.5] [1579.5,791] [1349,779.5]` |
| Furo da máscara | `M807 258 L1336 355.4 Q1343 357 1346 363 L1348 365 L1350 380 … L1363 500 … L1344 744.6 L748 703 Z` | `M1386 341.2 C1386.9 329.2 1397.7 318.6 1409.7 317.9 L1577.5 307.6 C1588.5 306.9 1597.1 315.4 1596.6 326.4 L1577.5 764.4 C1576.9 777.4 1565.4 787.8 1552.4 787.1 L1375.5 777.8 C1364.5 777.2 1355.5 767.7 1355.5 756.7 L1355.5 735 L1357.5 700 Z` |
| Notch | — | `<rect x="1444" y="304" width="94" height="28" rx="14" fill="#fff">` |

- **Lado direito do tablet:** igual ao mobile. O furo segue o aro do canto
  do tablet até y≈365 e, daí para baixo, o aro esquerdo do celular
  (x≈1363 em y=500, x≈1344 em y=745).
- **Celular:** a tela é um quadrilátero inclinado, com o topo subindo para a
  direita (y≈318 em x=1410 → y≈308 em x=1577). Os quatro cantos são
  arredondados por curvas `C` com raio ≈ 22 px da arte, seguindo o aro.
  A borda esquerda desce em diagonal até x≈1355 perto da base. O furo fica
  ~2 px para dentro da borda interna do aro dourado.
- Até a correção de 24/10, a geometria desktop era menor que a tela real.
  Aparecia a tela original da arte atrás do vídeo: uma faixa à direita do
  celular e a barra inferior, além de uma faixa escura entre o tablet e o
  celular.

## 4. Área visível dentro de cada vídeo (zona segura)

Quanto de cada borda **do vídeo** fica escondido sob a moldura, em pixels do
próprio vídeo. Os números são o meio de cada borda e a distância mínima de
conteúdo visível até cada canto. Coloque textos e elementos importantes
**dentro da zona segura**.

| Vídeo | Esquerda | Topo | Direita | Base | Cantos (até o 1º ponto visível) | Zona segura recomendada |
|---|---|---|---|---|---|---|
| mobile · tablet 720×546 | ~4 px | ~7–9 px | **5–34 px** (atrás do celular) | ~4–5 px | SE 7 · SD **31** · ID **42** · IE 7 | 12 px nas bordas, **40 px à direita** |
| mobile · celular 360×830 | ~1–2 px | ~1–3 px | ~6–8 px | ~8–10 px | SE **24** · SD 18 · ID 16 · IE 13 | 10 px nas bordas, nada importante a menos de **25 px dos cantos** |
| desktop · tablet 720×546 | ~4 px | ~5–6 px | **3–20 px** (atrás do celular) | ~6 px | SE 6 · SD **36** · ID 18 · IE 7 | 12 px nas bordas, **40 px à direita** |
| desktop · celular 360×830 | ~2–3 px | ~2–5 px | ~4 px | ~4–5 px | SE 19 · SD 22 · ID 21 · IE 24 | 10 px nas bordas, nada importante a menos de **25 px dos cantos** |

Exemplo real: no vídeo atual do celular, o relógio "10:41" fica a ~12 px da
esquerda e ~10 px do topo. Ele só aparece inteiro porque o canto do vídeo foi
recuado para `[694,804]`. Um vídeo novo com relógio mais encostado no canto vai
ter o primeiro dígito cortado pelo arredondamento.

## 5. Como trocar um vídeo

1. **Grave ou exporte na mesma proporção:** tablet 720 × 546, celular 360 × 830.
   Pode ser maior se mantiver a proporção, por exemplo 1440 × 1092. Nesse caso
   atualize `source` em `GEOMETRY` para o tamanho real.
2. **Respeite a zona segura** da seção 4.
3. **Codifique leve e em loop curto:**

   ```bash
   ffmpeg -i entrada.mp4 -vf "scale=720:546:force_original_aspect_ratio=increase,crop=720:546,fps=18" \
     -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 26 -preset slow -an -movflags +faststart \
     assets/tutorials/hqs/lumeo-hqs-tablet-NOVO-v1.mp4
   ffmpeg -i assets/tutorials/hqs/lumeo-hqs-tablet-NOVO-v1.mp4 -frames:v 1 -c:v libwebp -quality 82 \
     assets/tutorials/hqs/lumeo-hqs-tablet-NOVO-v1-poster.webp
   ```

   Para o celular, troque por `360:830` e `fps=15`. A meta de peso é até
   ~500 KB por vídeo.
4. **Use um nome de arquivo novo.** `/assets/*` tem cache de 7 dias no
   navegador (`vercel.json`). Reaproveitar o nome faz visitantes verem o vídeo
   antigo.
5. **Atualize as três referências de cada aparelho:**
   - `index-hqs.html`: `<source src>` e `poster` do `<video>`;
   - `css/hqs-premium-hero-v2.css`: `background-image` de
     `.hqs-art-hero__tablet-screen` / `.hqs-art-hero__phone-screen`. Esse
     poster aparece antes do vídeo carregar e com `prefers-reduced-motion`.
6. **Não mexa em `points` nem nos furos** se a arte e a proporção forem as mesmas.
7. **Valide** (seção 7).

## 6. Se a arte mudar (ou precisar reajustar o encaixe)

- **O furo** fica ~2 px para dentro da borda interna do aro dourado.
  O bezel preto pode aparecer, mas o aro não pode ser coberto pelo vídeo.
- **Os `points` do vídeo** ficam 1–5 px para fora do furo em todas as bordas.
- **Para ver a arte sem o vídeo:** no DevTools, aplique
  `visibility: hidden` em `.hqs-art-hero__tablet-screen`,
  `.hqs-art-hero__phone-screen` e `.hqs-art-hero__frame-overlay`.
  Compare com a versão normal na mesma posição.
- **Para medir:** recorte a arte em resolução nativa com uma grade a cada
  10 px. Leia onde termina o aro (dourado) e começa a tela (escuro), linha por
  linha nas bordas laterais e coluna por coluna no topo.
- **Mudou o canto de cima do vídeo do celular?** Confira se a barra de status
  continua inteira.
- **Cache do JS:** ao alterar `js/hqs-art-hero.js`, incremente o `?v=` do
  import em `js/hqs.js`. Ao alterar `js/hqs.js`, incremente o `?v=` do
  `<script>` em `index-hqs.html`.

## 7. Validação obrigatória

```bash
node scripts/check-hqs-hero-fit.mjs   # o vídeo cobre 100% de cada furo (mobile e desktop)?
node scripts/check-hqs.mjs            # regras da página de HQs
node scripts/check-livros.mjs         # garante que a página de Livros não mudou
```

O `check-hqs-hero-fit.mjs` falha (✗, código 1) quando o furo sai do vídeo e
mostra quanto sobra em cada borda. Em seguida, confira visualmente em 360,
390, 412, 768, 1366 e 1440 px:

- sem overflow horizontal e sem erro no console;
- nenhum pedaço da arte original aparecendo dentro das telas;
- aro dourado visível e não coberto pelo vídeo;
- cantos arredondados acompanhando a moldura;
- textos do vídeo (relógio, títulos) inteiros.

## 8. Pendências conhecidas

- **Mobile, tablet:** a borda inferior do vídeo corta pela metade o texto
  "12 / 84" que existe na barra inferior da arte. Para resolver, desça a base
  do furo e dos `points` do tablet até cobrir essa barra, ou mantenha a barra
  inteira visível.
