/** Normalises the expansion drafts onto their real final pixel grids. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const OUT = new URL("../../../../assets/source/melee/", import.meta.url);
type Bounds = readonly [number, number, number, number];

function bounds(p: PNG, left: number, top: number, right: number, bottom: number): Bounds {
  let l = right, t = bottom, r = left, b = top;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    if (p.data[(y * p.width + x) * 4 + 3]! <= 180) continue;
    l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x + 1); b = Math.max(b, y + 1);
  }
  if (r <= l || b <= t) throw new Error(`Empty expansion cell ${left},${top},${right},${bottom}`);
  return [l, t, r, b];
}

function cuts(raw: PNG, horizontal: boolean, parts: number): number[] {
  const length = horizontal ? raw.width : raw.height, cross = horizontal ? raw.height : raw.width;
  const occupancy = new Int32Array(length);
  for (let at = 0; at < length; at++) for (let other = 0; other < cross; other++) {
    const x = horizontal ? at : other, y = horizontal ? other : at;
    if (raw.data[(y * raw.width + x) * 4 + 3]! > 180) occupancy[at]!++;
  }
  const out = [0];
  for (let part = 1; part < parts; part++) {
    const nominal = part * length / parts, radius = Math.floor(length / parts * 0.42);
    let best = Math.round(nominal), bestScore = Infinity, bestDistance = Infinity;
    for (let at = Math.max(4, Math.floor(nominal - radius)); at <= Math.min(length - 5, Math.ceil(nominal + radius)); at++) {
      let score = 0;
      for (let d = -3; d <= 3; d++) score += occupancy[at + d]!;
      const distance = Math.abs(at - nominal);
      if (score < bestScore || (score === bestScore && distance < bestDistance)) {
        best = at; bestScore = score; bestDistance = distance;
      }
    }
    out.push(best);
  }
  out.push(length);
  return out;
}

function render(raw: PNG, box: Bounds, width: number, height: number, padding: number): PNG {
  const [l,t,r,b] = box;
  const scale = Math.min((width - padding * 2) / (r - l), (height - padding * 2) / (b - t));
  const w = Math.max(1, Math.round((r-l)*scale)), h = Math.max(1, Math.round((b-t)*scale));
  const out = new PNG({ width, height }); out.data.fill(0);
  const x0 = Math.floor((width-w)/2), y0 = Math.floor((height-h)/2);
  for (let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const sx=Math.min(r-1,l+Math.floor((x+.5)*(r-l)/w)), sy=Math.min(b-1,t+Math.floor((y+.5)*(b-t)/h));
    const si=(sy*raw.width+sx)*4, di=((y0+y)*width+x0+x)*4;
    if(raw.data[si+3]!<=180) continue;
    out.data.set(raw.data.subarray(si,si+3),di); out.data[di+3]=255;
  }
  return out;
}

function upscale4(p: PNG): PNG {
  const out=new PNG({width:p.width*4,height:p.height*4}); out.data.fill(0);
  for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){const si=(y*p.width+x)*4;for(let yy=0;yy<4;yy++)for(let xx=0;xx<4;xx++)out.data.set(p.data.subarray(si,si+4),(((y*4+yy)*out.width+x*4+xx)*4));}
  return out;
}

function grid(draft:string,output:string,cols:number,rows:number,target:number):void{
  const raw=PNG.sync.read(readFileSync(new URL(draft,OUT))), xs=cuts(raw,true,cols), ys=cuts(raw,false,rows);
  const sheet=new PNG({width:cols*target,height:rows*target}); sheet.data.fill(0);
  const padding=target===96?9:6;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const cell=render(raw,bounds(raw,xs[col]!,ys[row]!,xs[col+1]!,ys[row+1]!),target,target,padding);
    PNG.bitblt(cell,sheet,0,0,target,target,col*target,row*target);
  }
  writeFileSync(new URL(output,OUT),PNG.sync.write(upscale4(sheet)));
}

function single(draft:string,output:string,width:number,height:number):void{
  const raw=PNG.sync.read(readFileSync(new URL(draft,OUT)));
  const image=render(raw,bounds(raw,0,0,raw.width,raw.height),width,height,3);
  writeFileSync(new URL(output,OUT),PNG.sync.write(upscale4(image)));
}

mkdirSync(OUT,{recursive:true});
grid("enemy-warden-expansion-draft.png","enemy-warden-expansion.png",4,3,96);
grid("enemy-bellringer-expansion-draft.png","enemy-bellringer-expansion.png",4,3,64);
grid("enemy-rifter-expansion-draft.png","enemy-rifter-expansion.png",3,3,64);
grid("enemy-snarecaster-expansion-draft.png","enemy-snarecaster-expansion.png",4,3,64);
grid("enemy-delver-expansion-draft.png","enemy-delver-expansion.png",4,3,64);
grid("enemy-cinderling-expansion-draft.png","enemy-cinderling-expansion.png",4,3,64);
grid("enemy-sower-expansion-draft.png","enemy-sower-expansion.png",4,3,64);
single("weapon-warden-shield-draft.png","weapon-warden-shield.png",64,96);
console.log("expansion drafts normalized to hard final-resolution pixels");
