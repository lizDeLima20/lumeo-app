import assert from "node:assert/strict";
import { test } from "node:test";
import { unzipSync } from "fflate";
import { comicCutoutMask, comicMaskedPixels, comicMaskCutsInk, comicMaskCutsTextBounds } from "../src/reader/comic/interaction/ComicObjectCutout";

test("mask with a missing part of a text box is rejected regardless of sampled text colour", () => {
  const alpha = new Uint8Array(20 * 20).fill(255);
  for (let y = 8; y < 12; y++) for (let x = 6; x < 10; x++) alpha[y * 20 + x] = 0;
  assert.equal(comicMaskCutsTextBounds(alpha, 20, 20, { x0: 5, y0: 7, x1: 15, y1: 13 }), true);
  assert.equal(comicMaskCutsTextBounds(new Uint8Array(20 * 20).fill(255), 20, 20, { x0: 5, y0: 7, x1: 15, y1: 13 }), false);
});
import type { ComicVisualContainer } from "../src/reader/comic/interaction/ComicContainerDetector";
import { emptyMask, sealComicArtMask } from "../src/reader/comic/interaction/ComicShapeMask";
import { ComicConverter } from "../src/reader/comic/interaction/ComicConverter";
import { ComicLimaDeserializer } from "../src/reader/comic/interaction/ComicLimaDeserializer";
import { ComicInteractionValidator } from "../src/reader/comic/interaction/ComicInteractionValidator";
import { COMIC_LIMA_VERSION, type ComicTextRegion } from "../src/reader/comic/interaction/ComicInteractionTypes";

test("mask preserves original RGB including coloured icons; scenery is transparent", () => {
  const pixels = new Uint8ClampedArray([245,212,15,255, 32,87,156,255, 2,4,9,255, 244,11,77,255]);
  const image = { width: 2, height: 2, data: pixels } as ImageData;
  const cutout = comicMaskedPixels(image, new Uint8Array([255,0,255,0]));
  assert.deepEqual([...cutout], [245,212,15,255,32,87,156,0,2,4,9,255,244,11,77,0]);
  assert.equal(pixels[7],255,"source page is unchanged");
  assert.throws(()=>comicMaskedPixels(image,new Uint8Array(1)), /dimensions/);
});

test("LIMA stores independent image/mask bytes and logical text without losing reading order", async () => {
  const region: ComicTextRegion = { id: "p1-r1", pageIndex:0,x:.1,y:.1,width:.2,height:.2,
    shape:"rectangle",type:"caption",tailDirection:"none",text:"OCR incerto?",readingOrder:3,needsReview:true,
    assetPath:"interaction/assets/p1-r1.png",maskPath:"interaction/assets/p1-r1-mask.png",
    segmentationConfidence:.7,segmentationNeedsReview:true,segmentationMethod:"component-mask" };
  const result = await new ComicConverter().convert({id:"test",title:"HQ",totalPages:1,
    pageProvider:async()=>({path:"pages/001.png",data:new Uint8Array([1]),mimeType:"image/png",cover:false,
      interactionAssets:[{path:region.assetPath!,data:new Uint8Array([2,3]),mimeType:"image/png"},
        {path:region.maskPath!,data:new Uint8Array([4,5]),mimeType:"image/png"}]}),
    regionProvider:async()=>[region]});
  const archive=unzipSync(result.bytes);
  assert.deepEqual([...archive[region.assetPath!]!],[2,3]);
  assert.deepEqual([...archive[region.maskPath!]!],[4,5]);
  const loaded=new ComicLimaDeserializer().deserialize(result.bytes);
  assert.deepEqual(loaded.pages[0]!.regions[0],region);
  assert.equal(loaded.manifest.version, COMIC_LIMA_VERSION);
  assert.throws(()=>new ComicInteractionValidator().validateRegion({...region,assetPath:"../../secret"}), /inseguro/);
});

test("a máscara que corta letras originais é detectada para fallback explícito", () => {
  const data = new Uint8ClampedArray(20 * 20 * 4).fill(255), alpha = new Uint8Array(400).fill(255);
  for (let y = 5; y < 15; y++) for (let x = 8; x < 11; x++) {
    const i = y * 20 + x; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 10;
    if (y > 9) alpha[i] = 0;
  }
  const source = {width:20,height:20,data} as ImageData, box = {x0:4,y0:4,x1:16,y1:16};
  assert.equal(comicMaskCutsInk(source,alpha,box,"#0a0a0a"),true);
  alpha.fill(255);
  assert.equal(comicMaskCutsInk(source,alpha,box,"#0a0a0a"),false);
});

test("frestas da amostragem não transformam letras internas em buracos", () => {
  const mask=emptyMask(30,30);
  for(let y=3;y<27;y++)for(let x=3;x<27;x++)mask.data[y*30+x]=1;
  for(let y=13;y<18;y++)for(let x=13;x<18;x++)mask.data[y*30+x]=0;
  for(let y=17;y<27;y++)mask.data[y*30+15]=0;
  const sealed=sealComicArtMask(mask);
  assert.equal(sealed.data[15*30+15],1);
  assert.equal(sealed.data[1*30+1],0);
});

const cutoutContainer = (stencil: Uint8Array): ComicVisualContainer => ({
  bbox: { x0: 3, y0: 2, x1: 13, y1: 10 }, ink: { x0: 6, y0: 4, x1: 10, y1: 8 },
  contour: [{x:3,y:2},{x:13,y:2},{x:13,y:10},{x:3,y:10}],
  stencil: { data: stencil, width: 10, height: 8, step: 1, x: 3, y: 2 },
  artStencil: { data: stencil, width: 10, height: 8, step: 1, x: 3, y: 2 },
  artBbox: { x0: 3, y0: 2, x1: 13, y1: 10 }, type: "speech", shape: "balloon", tail: "none",
  styleConfidence: .9, backgroundColor: "#ffffff", textColor: "#101010", inkShare: .2,
  blockShare: .3, runs: 60, glyphShare: .95, bands: 2, darkOnLight: true,
  typography: { family:"comic",weight:"normal",italic:false,align:"center",capHeight:.02,lines:2 },
});

test("máscara de componente preserva texto e remove a página e o balão vizinho", () => {
  const width = 20, height = 12, data = new Uint8ClampedArray(width * height * 4).fill(255);
  // Texto original dentro do balão; uma mancha colorida vizinha deve ficar de fora.
  for (let y=4;y<8;y++) for (let x=7;x<9;x++) {
    const offset=(y*width+x)*4; data[offset]=data[offset+1]=data[offset+2]=16;
  }
  for (let y=3;y<10;y++) for (let x=15;x<19;x++) {
    const offset=(y*width+x)*4; data[offset]=30;data[offset+1]=90;data[offset+2]=220;
  }
  const stencil = new Uint8Array(80).fill(1);
  // Um buraco interno simula letras/highlight que a cor de fundo não atravessou.
  stencil[3*10+4]=stencil[3*10+5]=0;
  const result = comicCutoutMask({width,height,data} as ImageData,{x0:0,y0:0,x1:width,y1:height},cutoutContainer(stencil));
  assert.equal(result.method,"component-mask");
  assert.equal(result.alpha[6*width+8],255,"o texto permanece visível");
  assert.equal(result.alpha[6*width+16],0,"a arte vizinha não entra no recorte");
  assert.equal(result.alpha[0],0,"o cenário fora do balão fica transparente");
});

test("segmentação que ainda cortaria texto usa o recorte completo e registra fallback", () => {
  const width=20,height=12,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=4;y<8;y++)for(let x=7;x<9;x++){
    const offset=(y*width+x)*4;data[offset]=data[offset+1]=data[offset+2]=16;
  }
  const stencil=new Uint8Array(80);
  // Um pequeno componente num canto não cobre o bloco de texto conhecido.
  for(let y=0;y<2;y++)for(let x=0;x<2;x++)stencil[y*10+x]=1;
  const result=comicCutoutMask({width,height,data} as ImageData,{x0:0,y0:0,x1:width,y1:height},cutoutContainer(stencil));
  assert.equal(result.method,"original-crop-fallback");
  assert.ok(result.alpha.every(value=>value===255));
});
