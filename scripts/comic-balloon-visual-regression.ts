import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { detectComicContainers } from "../src/reader/comic/interaction/ComicContainerDetector";
import { comicAdaptiveCropBounds, comicCutoutMask, comicMaskedPixels } from "../src/reader/comic/interaction/ComicObjectCutout";

interface Raster { width:number;height:number;data:Uint8ClampedArray }
const page:Raster={width:520,height:360,data:new Uint8ClampedArray(520*360*4)};
for(let i=0;i<page.width*page.height;i++){page.data[i*4]=88;page.data[i*4+1]=32;page.data[i*4+2]=118;page.data[i*4+3]=255;}
const pixel=(x:number,y:number,colour:[number,number,number]):void=>{if(x<0||y<0||x>=page.width||y>=page.height)return;const i=(y*page.width+x)*4;page.data[i]=colour[0];page.data[i+1]=colour[1];page.data[i+2]=colour[2];};
const ellipse=(cx:number,cy:number,rx:number,ry:number,fill:[number,number,number],ink:[number,number,number]):void=>{
  for(let y=cy-ry;y<=cy+ry;y++)for(let x=cx-rx;x<=cx+rx;x++)if(((x-cx)/rx)**2+((y-cy)/ry)**2<=1)pixel(x,y,fill);
  for(let line=-1;line<=1;line++)for(let word=-2;word<=2;word++)for(let y=0;y<6;y++)for(let x=0;x<8;x++)pixel(cx+word*20+x-4,cy+line*15+y-3,ink);
};
ellipse(125,150,78,54,[250,218,68],[32,24,15]);
ellipse(270,150,70,50,[75,164,230],[8,20,38]);
ellipse(400,150,72,52,[246,244,238],[20,20,22]);

const image=page as ImageData;
const containers=detectComicContainers(image,{step:1});
if(containers.length!==3)throw new Error(`Esperados 3 balões; detectados ${containers.length}`);
const center=containers.sort((a,b)=>a.bbox.x0-b.bbox.x0)[1]!;
const art=center.artBbox??center.bbox;
const crop=comicAdaptiveCropBounds(art,containers,page.width,page.height,center);
const width=crop.x1-crop.x0,height=crop.y1-crop.y0,pixels=new Uint8ClampedArray(width*height*4);
for(let y=0;y<height;y++)pixels.set(page.data.subarray(((crop.y0+y)*page.width+crop.x0)*4,((crop.y0+y)*page.width+crop.x1)*4),y*width*4);
const source={width,height,data:pixels} as ImageData;
const fixed=comicCutoutMask(source,crop,center,containers);
if(fixed.method!=="component-mask")throw new Error("A regressão visual não produziu máscara confiável");

const output="docs/validation/comic-baloes-universal";
await mkdir(output,{recursive:true});
await sharp(Buffer.from(page.data),{raw:{width:page.width,height:page.height,channels:4}}).png().toFile(`${output}/painel-roxo-sintetico.png`);
// Reconstituição do comportamento antigo: retângulo opaco de um agrupamento incorreto,
// abrangendo o vizinho esquerdo e terminando antes da parte inferior.
const legacy={left:40,top:92,width:305,height:92};
await sharp(Buffer.from(page.data),{raw:{width:page.width,height:page.height,channels:4}}).extract(legacy).png().toFile(`${output}/antes-retangulo-legado-simulado.png`);
const after=comicMaskedPixels(source,fixed.alpha);
await sharp(Buffer.from(after),{raw:{width,height,channels:4}}).png().toFile(`${output}/depois-mascara-componente.png`);
process.stdout.write(JSON.stringify({containers:containers.length,method:fixed.method,confidence:fixed.confidence,holesFilled:fixed.holesFilled,
  transparent:[...fixed.alpha].filter(value=>value===0).length,total:fixed.alpha.length,crop}));
