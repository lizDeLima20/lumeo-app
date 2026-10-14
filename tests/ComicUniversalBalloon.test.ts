import assert from "node:assert/strict";
import { test } from "node:test";
import { detectComicContainers } from "../src/reader/comic/interaction/ComicContainerDetector";
import { comicGroupConnectedContainers } from "../src/reader/comic/interaction/ComicContainerGrouping";
import { ComicHitMap } from "../src/reader/comic/interaction/ComicHitMap";
import { ComicInteractionEngine } from "../src/reader/comic/interaction/ComicInteractionEngine";
import type { ComicDocument, ComicTextRegion } from "../src/reader/comic/interaction/ComicInteractionTypes";
import { comicAdaptiveCropBounds, comicCutoutMask } from "../src/reader/comic/interaction/ComicObjectCutout";

interface Raster { width:number;height:number;data:Uint8ClampedArray }
const raster=(width:number,height:number,colour:[number,number,number]):Raster=>{
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++){data[i*4]=colour[0];data[i*4+1]=colour[1];data[i*4+2]=colour[2];data[i*4+3]=255;}
  return {width,height,data};
};
const pixel=(page:Raster,x:number,y:number,colour:[number,number,number]):void=>{
  if(x<0||y<0||x>=page.width||y>=page.height)return;
  const i=(y*page.width+x)*4;page.data[i]=colour[0];page.data[i+1]=colour[1];page.data[i+2]=colour[2];
};
const ellipse=(page:Raster,cx:number,cy:number,rx:number,ry:number,fill:[number,number,number],ink:[number,number,number]):void=>{
  for(let y=Math.floor(cy-ry);y<=Math.ceil(cy+ry);y++)for(let x=Math.floor(cx-rx);x<=Math.ceil(cx+rx);x++)
    if(((x-cx)/rx)**2+((y-cy)/ry)**2<=1)pixel(page,x,y,fill);
  const wordW=Math.max(3,Math.floor(rx*.12)),wordH=Math.max(3,Math.floor(ry*.12));
  for(let line=-1;line<=1;line++)for(let word=-2;word<=2;word++)
    for(let y=0;y<wordH;y++)for(let x=0;x<wordW;x++)pixel(page,cx+word*Math.floor(rx*.28)+x-wordW/2|0,cy+line*Math.floor(ry*.28)+y-wordH/2|0,ink);
};
const image=(value:Raster):ImageData=>value as ImageData;

test("três balões próximos e coloridos no mesmo quadro continuam três regiões",()=>{
  const page=raster(520,360,[88,32,118]);
  ellipse(page,125,150,78,54,[250,218,68],[32,24,15]);
  ellipse(page,270,150,70,50,[75,164,230],[8,20,38]);
  ellipse(page,400,150,72,52,[246,244,238],[20,20,22]);
  const found=detectComicContainers(image(page),{step:1});
  assert.equal(found.length,3,JSON.stringify(found.map(value=>({box:value.bbox,colour:value.backgroundColor}))));
  assert.equal(comicGroupConnectedContainers(found).length,3,"proximidade no painel roxo não é conexão");
  assert.ok(found.some(value=>value.backgroundColor.toLowerCase().startsWith("#fa")),"amarelo detectado");
  assert.ok(found.some(value=>value.backgroundColor.toLowerCase().includes("4ba4")),"azul detectado");
  const center=[...found].sort((a,b)=>a.bbox.x0-b.bbox.x0)[1]!;
  const crop=comicAdaptiveCropBounds(center.artBbox??center.bbox,found,page.width,page.height,center);
  const width=crop.x1-crop.x0,height=crop.y1-crop.y0,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)data.set(page.data.subarray(((crop.y0+y)*page.width+crop.x0)*4,((crop.y0+y)*page.width+crop.x1)*4),y*width*4);
  const cutout=comicCutoutMask({width,height,data} as ImageData,crop,center,found);
  assert.equal(cutout.method,"component-mask");
  assert.equal(cutout.alpha[(150-crop.y0)*width+195-crop.x0],0,"o vizinho amarelo fica fora");
  assert.equal(cutout.alpha[(150-crop.y0)*width+270-crop.x0],255,"o centro azul permanece inteiro");
});

test("balão preto com texto claro e balão pequeno são detectados sem regra de branco",()=>{
  const page=raster(420,360,[175,95,55]);
  ellipse(page,130,150,76,52,[12,14,18],[246,246,240]);
  ellipse(page,300,150,48,34,[230,110,190],[20,15,20]);
  const found=detectComicContainers(image(page),{step:1});
  assert.equal(found.length,2,JSON.stringify(found.map(value=>({box:value.bbox,colour:value.backgroundColor}))));
  assert.ok(found.some(value=>!value.darkOnLight),"texto claro sobre fundo preto mantém sua polaridade");
  assert.ok(found.some(value=>value.bbox.x1-value.bbox.x0<110),"o balão pequeno não some");
});

const region=(id:string,x:number):ComicTextRegion=>({id,pageIndex:0,text:id,x,y:.2,width:.16,height:.12,
  hitBounds:{x,y:.2,width:.16,height:.12},visualBounds:{x,y:.2,width:.16,height:.12},
  contour:[{x,y:.2},{x:x+.16,y:.2},{x:x+.16,y:.32},{x,y:.32}],shape:"balloon",type:"speech",tailDirection:"none"});

test("hit map preserva o alvo individual após crop e escalas diferentes",()=>{
  const regions=[region("esquerdo",.16),region("central",.39),region("direito",.62)];
  const document={manifest:{},metadata:{},pages:[{index:0,id:"p",imagePath:"p.png",mimeType:"image/png",cover:false,regions}]} as ComicDocument;
  const engine=new ComicInteractionEngine();engine.open(document);
  const contentBounds={x:.1,y:0,width:.8,height:1};
  for(const rect of [{x:12,y:40,width:336,height:600},{x:24,y:80,width:672,height:1200}]){
    const map=new ComicHitMap([{pageIndex:0,rect,contentBounds}],engine);
    for(const candidate of regions){
      const point=ComicHitMap.regionRect(rect,candidate.visualBounds!,contentBounds);
      assert.equal(map.hit({x:point.x+point.width/2,y:point.y+point.height/2})?.region.id,candidate.id);
    }
  }
});
