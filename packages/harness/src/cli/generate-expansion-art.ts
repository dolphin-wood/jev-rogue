/** Code-authored expansion VFX at their real final pixel resolution. */
import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const OUT = new URL("../../../../assets/source/melee/", import.meta.url);
type C = readonly [number,number,number,number];
const ink=[13,11,31,255] as const, shadow=[43,45,84,255] as const, body=[74,84,128,255] as const;
const light=[135,146,181,255] as const, bone=[232,227,216,255] as const, cool=[63,169,245,255] as const;
const hot=[255,63,164,255] as const, amber=[245,166,35,255] as const, warm=[255,85,68,255] as const;
const green=[74,190,105,255] as const, earth=[126,83,57,255] as const;
const png=(w:number,h:number)=>{const p=new PNG({width:w,height:h});p.data.fill(0);return p;};
function px(p:PNG,x:number,y:number,c:C){x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=p.width||y>=p.height)return;p.data.set(c,(y*p.width+x)*4);}
function line(p:PNG,x0:number,y0:number,x1:number,y1:number,c:C,w=1){const n=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));for(let i=0;i<=n;i++){const x=x0+(x1-x0)*i/Math.max(1,n),y=y0+(y1-y0)*i/Math.max(1,n);for(let yy=-Math.floor(w/2);yy<=Math.floor(w/2);yy++)for(let xx=-Math.floor(w/2);xx<=Math.floor(w/2);xx++)px(p,x+xx,y+yy,c);}}
function ellipse(p:PNG,cx:number,cy:number,rx:number,ry:number,c:C){for(let y=Math.floor(cy-ry);y<=Math.ceil(cy+ry);y++)for(let x=Math.floor(cx-rx);x<=Math.ceil(cx+rx);x++)if(((x-cx)/rx)**2+((y-cy)/ry)**2<=1)px(p,x,y,c);}
function ring(p:PNG,cx:number,cy:number,rx:number,ry:number,c:C,step=4){for(let a=0;a<360;a+=step){const q=a*Math.PI/180;px(p,cx+Math.cos(q)*rx,cy+Math.sin(q)*ry,c);}}
function diamond(p:PNG,cx:number,cy:number,r:number,c:C){for(let y=-r;y<=r;y++)for(let x=-r;x<=r;x++)if(Math.abs(x)+Math.abs(y)<=r)px(p,cx+x,cy+y,c);}
function upscale4(p:PNG){const out=png(p.width*4,p.height*4);for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){const si=(y*p.width+x)*4;for(let yy=0;yy<4;yy++)for(let xx=0;xx<4;xx++)out.data.set(p.data.subarray(si,si+4),(((y*4+yy)*out.width+x*4+xx)*4));}return out;}
function write(name:string,p:PNG){writeFileSync(new URL(name,OUT),PNG.sync.write(upscale4(p)));}
function idx(name:string){return Number(name.at(-1));}

export const VFX64 = [
  ...Array.from({length:4},(_,i)=>`vfx_rift_seg_${i}`), ...Array.from({length:2},(_,i)=>`vfx_rift_cap_${i}`),
  ...Array.from({length:3},(_,i)=>`vfx_rift_burst_${i}`), ...Array.from({length:2},(_,i)=>`vfx_tether_seg_${i}`),
  ...Array.from({length:3},(_,i)=>`vfx_tether_node_${i}`), ...Array.from({length:3},(_,i)=>`vfx_ward_aura_${i}`),
  ...Array.from({length:3},(_,i)=>`vfx_lob_shadow_${i}`), ...Array.from({length:2},(_,i)=>`vfx_lob_ring_${i}`),
  ...Array.from({length:4},(_,i)=>`vfx_beam_seg_${i}`), ...Array.from({length:2},(_,i)=>`vfx_beam_cap_${i}`),
  ...Array.from({length:3},(_,i)=>`vfx_plate_spark_${i}`), ...Array.from({length:4},(_,i)=>`vfx_plate_disc_${i}`),
  ...Array.from({length:4},(_,i)=>`vfx_slowfield_${i}`), ...Array.from({length:2},(_,i)=>`vfx_mine_seed_${i}`),
  ...Array.from({length:4},(_,i)=>`vfx_mine_armed_${i}`), ...Array.from({length:3},(_,i)=>`vfx_mine_burst_${i}`),
  ...Array.from({length:2},(_,i)=>`vfx_chain_seg_${i}`), ...Array.from({length:2},(_,i)=>`vfx_chain_hook_${i}`),
  ...Array.from({length:4},(_,i)=>`vfx_chain_live_${i}`), ...Array.from({length:4},(_,i)=>`vfx_mound_${i}`),
  ...Array.from({length:3},(_,i)=>`vfx_emerge_ring_${i}`),
] as const;

function draw64(p:PNG,name:string,ox:number,oy:number):void{
  const q=(x:number,y:number,c:C)=>px(p,ox+x,oy+y,c), L=(x0:number,y0:number,x1:number,y1:number,c:C,w=1)=>line(p,ox+x0,oy+y0,ox+x1,oy+y1,c,w);
  const E=(x:number,y:number,rx:number,ry:number,c:C)=>ellipse(p,ox+x,oy+y,rx,ry,c), R=(x:number,y:number,rx:number,ry:number,c:C,s=4)=>ring(p,ox+x,oy+y,rx,ry,c,s);
  const n=idx(name);
  if(name.startsWith("vfx_rift_seg")){const ys=[35,34,32,31][n]!;L(0,ys,15,ys-2,ink,5);L(15,ys-2,25,ys+3,ink,5);L(25,ys+3,40,ys-3,ink,5);L(40,ys-3,52,ys+1,ink,5);L(52,ys+1,63,ys,ink,5);L(0,ys,15,ys-2,n<2?warm:amber,n+1);L(15,ys-2,25,ys+3,n<2?warm:amber,n+1);L(25,ys+3,40,ys-3,n<2?warm:bone,n+1);L(40,ys-3,52,ys+1,n<2?warm:amber,n+1);L(52,ys+1,63,ys,n<2?warm:amber,n+1);}
  else if(name.startsWith("vfx_rift_cap")){L(n?0:32,32,n?32:63,32,ink,7);L(n?0:32,32,n?32:63,32,warm,3);E(n?34:30,32,6,6,ink);E(n?34:30,32,3,3,amber);}
  else if(name.startsWith("vfx_rift_burst")){L(0,38,63,38,ink,7);L(0,38,63,38,n===1?bone:amber,3);for(let x=4+n;x<64;x+=10){L(x,37,x+(n%2?2:-2),18-n*3,ink,5);L(x,36,x+(n%2?2:-2),20-n*3,n===1?bone:warm,2);}}
  else if(name.startsWith("vfx_tether_seg")){L(0,30,63,30,ink,5);L(0,34,63,34,ink,5);L(0,30,63,30,n?bone:light,1);L(0,34,63,34,n?light:body,1);for(let x=4;x<64;x+=8)q(x,32,n?bone:cool);}
  else if(name.startsWith("vfx_tether_node")){R(32,32,13+n*2,10+n,ink,3);R(32,32,10+n*2,7+n,n===1?bone:light,3);diamond(p,ox+32,oy+32,4,n===2?amber:body);}
  else if(name.startsWith("vfx_ward_aura")){R(32,32,25+n,16+n,ink,3);R(32,32,22+n,14+n,n===1?bone:cool,3);for(let a=0;a<8;a++){const t=a*Math.PI/4;q(32+Math.cos(t)*(18+n),32+Math.sin(t)*(11+n),n===2?amber:light);}}
  else if(name.startsWith("vfx_lob_shadow")){E(32,36,9+n*5,4+n*3,ink);E(32,35,5+n*3,2+n*2,shadow);}
  else if(name.startsWith("vfx_lob_ring")){R(32,32,n?24:18,n?16:11,ink,2);R(32,32,n?21:15,n?14:9,warm,2);for(let a=0;a<4;a++){const t=a*Math.PI/2;L(32+Math.cos(t)*25,32+Math.sin(t)*17,32+Math.cos(t)*29,32+Math.sin(t)*20,bone);}}
  else if(name.startsWith("vfx_beam_seg")){L(0,32,63,32,ink,9);L(0,32,63,32,n%2?bone:cool,n===3?5:3);if(n>1)L(0,30,63,30,bone,1);}
  else if(name.startsWith("vfx_beam_cap")){L(0,32,42,32,ink,9);L(0,32,42,32,n?bone:cool,3);for(let y=-9;y<=9;y++)for(let x=42;x<59;x++)if(Math.abs(y)<=Math.floor((58-x)/2))q(x,32+y,n?bone:cool);}
  else if(name.startsWith("vfx_plate_spark")){for(let a=0;a<7;a++){const t=(a/7*Math.PI*1.5)+n*.25;L(32+Math.cos(t)*5,32+Math.sin(t)*5,32+Math.cos(t)*(15+n*4),32+Math.sin(t)*(15+n*4),a%2?amber:bone,a%3?1:2);}}
  else if(name.startsWith("vfx_plate_disc")){E(32,32,22,14,ink);E(32,32,18,11,body);R(32,32,14,8,n%2?bone:light,3);L(18+n,32,46-n,32,amber,2);}
  else if(name.startsWith("vfx_slowfield")){R(32,34,27-n,16-n,ink,3);R(32,34,24-n,14-n,n%2?cool:light,3);for(let x=10+n;x<56;x+=9)q(x,34+((x+n)%7)-3,cool);}
  else if(name.startsWith("vfx_mine_seed")){E(32,35,5+n*2,4+n,ink);diamond(p,ox+32,oy+32,3+n,body);R(32,34,17-n*4,11-n*2,n?light:shadow,4);}
  else if(name.startsWith("vfx_mine_armed")){E(32,35,8,6,ink);diamond(p,ox+32,oy+32,5,n%2?warm:amber);R(32,34,13+n*3,9+n*2,n%2?bone:warm,3);}
  else if(name.startsWith("vfx_mine_burst")){for(let a=0;a<10;a++){const t=a*Math.PI/5;L(32+Math.cos(t)*3,32+Math.sin(t)*3,32+Math.cos(t)*(12+n*6),32+Math.sin(t)*(12+n*6),a%2?warm:bone,n===1?2:1);}E(32,32,4+n*2,4+n*2,amber);}
  else if(name.startsWith("vfx_chain_seg")){for(let x=-2;x<66;x+=10){E(x+5,32+(x/10%2?2:-2),6,4,ink);R(x+5,32+(x/10%2?2:-2),4,2,n?light:body,4);}}
  else if(name.startsWith("vfx_chain_hook")){L(4,32,40,32,ink,7);L(4,32,40,32,light,3);R(45,34,11,12,ink,3);R(45,34,7,8,n?bone:light,3);L(45,42,55,50,ink,5);L(45,42,55,50,bone,2);}
  else if(name.startsWith("vfx_chain_live")){L(0,32,63,32,ink,7);for(let x=0;x<64;x+=8)L(x,32,x+4,27+(x/8+n)%2*10,n%2?cool:bone,2);}
  else if(name.startsWith("vfx_mound")){E(32,39,22+n,9+n/2,ink);E(32,37,18+n,7,earth);for(let x=18;x<48;x+=8){diamond(p,ox+x+n%2*2,oy+34+(x%3),3,x%2?light:body);}}
  else if(name.startsWith("vfx_emerge_ring")){R(32,35,13+n*7,8+n*4,ink,3);R(32,35,10+n*7,6+n*4,n===2?bone:earth,3);for(let a=0;a<6+n*2;a++){const t=a*Math.PI/(3+n);diamond(p,ox+32+Math.cos(t)*(12+n*7),oy+35+Math.sin(t)*(7+n*4),2,light);}}
}

function make64():void{const cols=9,rows=7,p=png(cols*64,rows*64);VFX64.forEach((name,i)=>draw64(p,name,(i%cols)*64,Math.floor(i/cols)*64));write("expansion-vfx-64.png",p);}
function make32():void{const p=png(8*32,32);for(let i=0;i<8;i++){const ox=i*32,n=i%4;ellipse(p,ox+16,18,7+n%2,6+n%2,ink);diamond(p,ox+16,16,5+n%2,hot);px(p,ox+14,14,bone);if(i>=4){line(p,ox+10,23,ox+22,10,ink,5);line(p,ox+11,22,ox+21,11,hot,2);px(p,ox+20,11,amber);}}write("expansion-vfx-32.png",p);}
function make128():void{const p=png(4*128,128);for(let n=0;n<4;n++){const ox=n*128,r=18+n*13;ring(p,ox+64,64,r,r*.72,ink,2);ring(p,ox+64,64,r-3,(r-3)*.72,n===3?bone:cool,2);for(let a=0;a<8;a++){const t=a*Math.PI/4;diamond(p,ox+64+Math.cos(t)*r,64+Math.sin(t)*r*.72,2,n%2?bone:light);}}write("expansion-vfx-128.png",p);}

mkdirSync(OUT,{recursive:true});make64();make32();make128();
console.log(`expansion VFX written: ${VFX64.length}x64, 8x32, 4x128`);
