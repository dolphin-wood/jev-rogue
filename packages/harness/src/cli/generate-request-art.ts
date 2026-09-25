/** Generates the small, topology-driven sheets from the open art request. */
import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const OUT = new URL("../../../../assets/source/melee/", import.meta.url);
const C = {
  ink: [13, 11, 31, 255], shadow: [43, 45, 84, 255], body: [74, 84, 128, 255],
  light: [135, 146, 181, 255], bone: [232, 227, 216, 255], cool: [63, 169, 245, 255],
  hot: [255, 63, 164, 255], amber: [245, 166, 35, 255], red: [220, 52, 55, 255],
  green: [74, 190, 105, 255], violet: [143, 91, 211, 255], warm: [255, 136, 119, 255],
} as const;
type Colour = readonly [number, number, number, number];

function png(w: number, h: number): PNG { const p = new PNG({ width: w, height: h }); p.data.fill(0); return p; }
function px(p: PNG, x: number, y: number, c: Colour): void {
  x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= p.width || y >= p.height) return;
  p.data.set(c, (y * p.width + x) * 4);
}
function rect(p: PNG, x: number, y: number, w: number, h: number, c: Colour): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(p, xx, yy, c);
}
function ellipse(p: PNG, cx: number, cy: number, rx: number, ry: number, c: Colour): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) px(p, x, y, c);
}
function line(p: PNG, x0: number, y0: number, x1: number, y1: number, c: Colour, width = 1): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / Math.max(1, n), y = y0 + (y1 - y0) * i / Math.max(1, n);
    for (let oy = -Math.floor(width / 2); oy <= Math.floor(width / 2); oy++)
      for (let ox = -Math.floor(width / 2); ox <= Math.floor(width / 2); ox++) px(p, x + ox, y + oy, c);
  }
}
function ring(p: PNG, cx: number, cy: number, r: number, c: Colour): void {
  for (let a = 0; a < 360; a += 4) px(p, cx + Math.cos(a * Math.PI / 180) * r, cy + Math.sin(a * Math.PI / 180) * r, c);
}
function diamond(p: PNG, cx: number, cy: number, r: number, c: Colour): void {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (Math.abs(x) + Math.abs(y) <= r) px(p, cx + x, cy + y, c);
}
function triangle(p: PNG, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: Colour): void {
  const minX = Math.floor(Math.min(ax, bx, cx)), maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy)), maxY = Math.ceil(Math.max(ay, by, cy));
  const area = (x1:number,y1:number,x2:number,y2:number,x3:number,y3:number) => (x1*(y2-y3)+x2*(y3-y1)+x3*(y1-y2));
  const A = area(ax, ay, bx, by, cx, cy);
  for (let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++) {
    const s=area(x,y,bx,by,cx,cy), t=area(ax,ay,x,y,cx,cy), u=area(ax,ay,bx,by,x,y);
    if ((A>=0&&s>=0&&t>=0&&u>=0)||(A<0&&s<=0&&t<=0&&u<=0)) px(p,x,y,c);
  }
}
function write(name: string, p: PNG): void { writeFileSync(new URL(name, OUT), PNG.sync.write(p)); }

/** Keep editable sources at the work order's 4x ceiling without interpolation. */
function upscale(p: PNG, factor = 4): PNG {
  const out = png(p.width * factor, p.height * factor);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const si = (y * p.width + x) * 4;
    if (p.data[si + 3] === 0) continue;
    for (let yy = 0; yy < factor; yy++) for (let xx = 0; xx < factor; xx++)
      out.data.set(p.data.subarray(si, si + 4), (((y * factor + yy) * out.width + x * factor + xx) * 4));
  }
  return out;
}

function outlinedLine(p: PNG, x0: number, y0: number, x1: number, y1: number, c: Colour): void {
  line(p, x0, y0, x1, y1, C.ink, 3);
  line(p, x0, y0, x1, y1, c, 1);
}

function outlinedDiamond(p: PNG, x: number, y: number, r: number, c: Colour): void {
  diamond(p, x, y, r + 1, C.ink);
  diamond(p, x, y, r, c);
  px(p, x - 1, y - Math.max(1, r - 1), C.bone);
}

function arrowHead(p: PNG, x: number, y: number, dx: number, dy: number, c: Colour): void {
  const pxn = -dy, pyn = dx;
  outlinedLine(p, x - dx * 3 + pxn * 2, y - dy * 3 + pyn * 2, x, y, c);
  outlinedLine(p, x - dx * 3 - pxn * 2, y - dy * 3 - pyn * 2, x, y, c);
}

function spellIcons(): void {
  const p = png(5 * 16, 4 * 16);
  const attacks = [
    "magic_bolt", "shock_arc", "spark_spray", "stone_shard", "ember_dart", "frost_needle",
    "venom_spit", "arc_lance", "scatter_shot", "cinder_burst", "glacier_spike",
    "void_orb", "plague_bloom",
  ];
  const names = attacks;
  const colours: Record<string, Colour> = {
    magic_bolt: C.cool, shock_arc: C.cool, spark_spray: C.cool, stone_shard: C.light,
    ember_dart: C.amber, frost_needle: C.cool, venom_spit: C.green, arc_lance: C.cool,
    scatter_shot: C.bone, cinder_burst: C.red, glacier_spike: C.cool,
    void_orb: C.violet, plague_bloom: C.green,
  };
  names.forEach((name, i) => {
    const ox=(i%5)*16, oy=Math.floor(i/5)*16, cx=ox+7.5, cy=oy+7.5;
    if (attacks.includes(name)) {
      const col=colours[name]!;
      if (name === "shock_arc") {
        // A single bolt splitting into three targets: unlike the live chain
        // line, the icon communicates topology rather than exact endpoints.
        outlinedLine(p, ox + 3, oy + 13, ox + 7, oy + 8, C.cool);
        outlinedLine(p, ox + 7, oy + 8, ox + 5, oy + 3, C.bone);
        outlinedLine(p, ox + 7, oy + 8, ox + 10, oy + 2, C.cool);
        outlinedLine(p, ox + 7, oy + 8, ox + 13, oy + 6, C.bone);
        px(p, ox + 3, oy + 12, C.bone);
      } else if (name.includes("burst") || name.includes("bloom") || name.includes("spray") || name.includes("scatter")) {
        for (let a=0;a<8;a++) { const q=a*Math.PI/4; line(p,cx+Math.cos(q)*2,cy+Math.sin(q)*2,cx+Math.cos(q)*(name.includes("scatter")?6:5),cy+Math.sin(q)*(name.includes("scatter")?6:5),col,1); }
        diamond(p,cx,cy,2,C.bone);
      } else if (name.includes("orb")) { ellipse(p,cx,cy,5,5,C.ink); ellipse(p,cx,cy,3,3,col); px(p,cx-1,cy-1,C.bone); }
      else { line(p,ox+3,oy+12,ox+12,oy+3,C.ink,3); line(p,ox+4,oy+11,ox+11,oy+4,col,2); px(p,ox+11,oy+4,C.bone); }
    }
  });
  write("spell-icons.png", upscale(p));
}

function affixIcons(): void {
  const p = png(6 * 16, 2 * 16);
  for (let i = 0; i < 12; i++) {
    const ox = (i % 6) * 16, oy = Math.floor(i / 6) * 16;
    const X = (x: number) => ox + x, Y = (y: number) => oy + y;
    if (i === 0) { // fork: one impact becomes two paths
      outlinedLine(p,X(8),Y(13),X(8),Y(8),C.amber);
      outlinedLine(p,X(8),Y(8),X(3),Y(3),C.amber); outlinedLine(p,X(8),Y(8),X(13),Y(3),C.amber);
      arrowHead(p,X(3),Y(3),-1,-1,C.bone); arrowHead(p,X(13),Y(3),1,-1,C.bone);
    } else if (i === 1) { // chain
      for (const [x,y] of [[4,11],[8,8],[12,5]] as const) { ellipse(p,X(x),Y(y),3,2,C.ink); ellipse(p,X(x),Y(y),2,1,C.cool); }
      outlinedLine(p,X(5),Y(10),X(11),Y(6),C.bone);
    } else if (i === 2) { // brand
      outlinedDiamond(p,X(8),Y(7),5,C.warm); outlinedDiamond(p,X(8),Y(7),2,C.amber);
      outlinedLine(p,X(8),Y(11),X(8),Y(14),C.warm);
    } else if (i === 3) { // harvest, kill burst
      ellipse(p,X(8),Y(9),5,4,C.ink); ellipse(p,X(8),Y(9),3,2,C.violet);
      px(p,X(7),Y(9),C.bone); px(p,X(9),Y(9),C.bone);
      for (const [x,y] of [[8,2],[3,4],[13,4]] as const) outlinedLine(p,X(8),Y(6),X(x),Y(y),C.amber);
    } else if (i === 4) { // echo
      for (let a=45;a<315;a+=24) { const q=a*Math.PI/180; px(p,X(6+Math.cos(q)*4),Y(8+Math.sin(q)*4),C.cool); }
      for (let a=225;a<495;a+=24) { const q=a*Math.PI/180; px(p,X(10+Math.cos(q)*4),Y(8+Math.sin(q)*4),C.bone); }
      outlinedDiamond(p,X(8),Y(8),1,C.violet);
    } else if (i === 5) { // bloom on expire
      for (const [x,y] of [[8,3],[12,6],[11,11],[5,11],[4,6]] as const) { ellipse(p,X(x),Y(y),3,2,C.ink); ellipse(p,X(x),Y(y),2,1,C.green); }
      outlinedDiamond(p,X(8),Y(8),2,C.bone);
    } else if (i === 6) { // shatter on wall
      rect(p,X(3),Y(3),7,10,C.ink); rect(p,X(4),Y(4),5,8,C.light);
      outlinedLine(p,X(7),Y(4),X(6),Y(8),C.shadow); outlinedLine(p,X(6),Y(8),X(9),Y(11),C.shadow);
      outlinedDiamond(p,X(12),Y(5),1,C.bone); outlinedDiamond(p,X(13),Y(11),1,C.bone);
    } else if (i === 7) { // repeat cast
      for (let a=20;a<320;a+=18) { const q=a*Math.PI/180; px(p,X(8+Math.cos(q)*5),Y(8+Math.sin(q)*5),C.cool); }
      arrowHead(p,X(13),Y(6),1,-1,C.bone); outlinedDiamond(p,X(8),Y(8),2,C.violet);
    } else if (i === 8) { // scatter cast
      outlinedDiamond(p,X(8),Y(12),2,C.cool);
      for (const [x,y] of [[3,3],[8,2],[13,3]] as const) { outlinedLine(p,X(8),Y(10),X(x),Y(y),C.bone); }
    } else if (i === 9) { // ward cast
      const pts=[[8,2],[13,4],[12,10],[8,14],[4,10],[3,4]] as const;
      for(let n=0;n<pts.length;n++){const a=pts[n]!,b=pts[(n+1)%pts.length]!;outlinedLine(p,X(a[0]),Y(a[1]),X(b[0]),Y(b[1]),C.cool);}
      outlinedDiamond(p,X(8),Y(7),2,C.bone);
    } else if (i === 10) { // retort on hurt
      rect(p,X(3),Y(4),5,8,C.ink); rect(p,X(4),Y(5),3,6,C.warm);
      outlinedLine(p,X(7),Y(8),X(13),Y(4),C.bone); arrowHead(p,X(13),Y(4),1,-1,C.bone);
    } else { // slipstream on dash
      for (let n=0;n<3;n++) outlinedLine(p,X(2),Y(4+n*4),X(11+n),Y(4+n*4),n===1?C.bone:C.cool);
      arrowHead(p,X(14),Y(8),1,0,C.bone);
    }
  }
  write("affix-icons.png", upscale(p));
}

function statIcons(): void {
  const p = png(6 * 16, 2 * 16);
  for (let i = 0; i < 11; i++) {
    const ox=(i%6)*16, oy=Math.floor(i/6)*16, X=(x:number)=>ox+x, Y=(y:number)=>oy+y;
    if (i === 0) { // fleet
      for (let n=0;n<3;n++) { outlinedLine(p,X(2),Y(4+n*4),X(11+n),Y(4+n*4),C.cool); }
    } else if (i === 1) { // second wind
      for(let a=20;a<315;a+=20){const q=a*Math.PI/180;px(p,X(8+Math.cos(q)*5),Y(8+Math.sin(q)*5),C.cool);} arrowHead(p,X(13),Y(6),1,-1,C.bone);
    } else if (i === 2) { // long stride
      outlinedLine(p,X(3),Y(11),X(13),Y(4),C.cool); arrowHead(p,X(13),Y(4),1,-1,C.bone); outlinedLine(p,X(3),Y(13),X(7),Y(13),C.light);
    } else if (i === 3) { // vigour: strongest silhouette
      ellipse(p,X(5),Y(6),4,4,C.ink); ellipse(p,X(11),Y(6),4,4,C.ink); triangle(p,X(2),Y(7),X(14),Y(7),X(8),Y(14),C.ink);
      ellipse(p,X(5),Y(6),2,2,C.red); ellipse(p,X(11),Y(6),2,2,C.red); triangle(p,X(4),Y(7),X(12),Y(7),X(8),Y(12),C.red); px(p,X(5),Y(5),C.bone);
    } else if (i === 4) { // steady nerve
      const pts=[[8,2],[13,4],[12,10],[8,14],[4,10],[3,4]] as const;for(let n=0;n<6;n++){const a=pts[n]!,b=pts[(n+1)%6]!;outlinedLine(p,X(a[0]),Y(a[1]),X(b[0]),Y(b[1]),C.green);} outlinedLine(p,X(8),Y(4),X(8),Y(11),C.bone);
    } else if (i === 5) { // deep well
      ellipse(p,X(8),Y(10),6,4,C.ink); ellipse(p,X(8),Y(10),4,2,C.cool); triangle(p,X(8),Y(2),X(4),Y(9),X(12),Y(9),C.ink); triangle(p,X(8),Y(4),X(6),Y(8),X(10),Y(8),C.cool); px(p,X(7),Y(6),C.bone);
    } else if (i === 6) { // quickening
      outlinedDiamond(p,X(7),Y(8),4,C.cool); for(const [x,y] of [[12,3],[13,8],[11,13]] as const) outlinedLine(p,X(9),Y(8),X(x),Y(y),C.bone);
    } else if (i === 7) { // leeching edge
      outlinedLine(p,X(3),Y(12),X(12),Y(3),C.bone); triangle(p,X(5),Y(4),X(3),Y(8),X(7),Y(8),C.ink); triangle(p,X(5),Y(5),X(4),Y(7),X(6),Y(7),C.cool);
    } else if (i === 8) { // keen edge
      outlinedLine(p,X(3),Y(13),X(12),Y(3),C.bone); outlinedDiamond(p,X(12),Y(3),1,C.amber); px(p,X(9),Y(5),C.bone);
    } else if (i === 9) { // long reach
      outlinedLine(p,X(2),Y(12),X(13),Y(2),C.bone); arrowHead(p,X(13),Y(2),1,-1,C.cool); outlinedLine(p,X(3),Y(13),X(7),Y(13),C.amber);
    } else { // swift hand
      outlinedLine(p,X(6),Y(12),X(13),Y(4),C.bone); for(let n=0;n<3;n++) outlinedLine(p,X(2),Y(4+n*3),X(7),Y(4+n*3),C.cool);
    }
  }
  write("stat-icons.png", upscale(p));
}

function rewardBadges(): void {
  const p=png(5*16,16);
  // stat: three rising bars and a bright arrow
  rect(p,3,10,3,3,C.ink);rect(p,4,10,1,2,C.light);rect(p,7,7,3,6,C.ink);rect(p,8,8,1,4,C.bone);rect(p,11,4,3,9,C.ink);rect(p,12,5,1,7,C.cool);
  // spell: cyan casting crystal
  outlinedDiamond(p,16+8,8,5,C.cool);outlinedDiamond(p,16+8,8,2,C.bone);
  // affix: three linked hook nodes
  for(const [x,y] of [[4,8],[8,4],[12,8]] as const) outlinedDiamond(p,32+x,y,2,C.amber);outlinedLine(p,32+5,7,32+7,5,C.bone);outlinedLine(p,32+9,5,32+11,7,C.bone);
  // gold
  ellipse(p,48+8,8,6,6,C.ink);ellipse(p,48+8,8,4,4,C.amber);line(p,48+8,5,48+8,11,C.bone,1);px(p,48+7,5,C.bone);
  // elite: crown/three-point mark, warm but outside the enemy bullet band
  const o=64;triangle(p,o+2,5,o+5,12,o+8,6,C.ink);triangle(p,o+8,6,o+11,12,o+14,5,C.ink);rect(p,o+4,10,8,4,C.ink);triangle(p,o+4,6,o+6,11,o+8,8,C.warm);triangle(p,o+8,8,o+10,11,o+12,6,C.warm);rect(p,o+5,11,6,2,C.amber);px(p,o+8,10,C.bone);
  write("reward-badges.png",upscale(p));
}

function wardAndBrand(): void {
  const w=png(64,32);
  for(let f=0;f<2;f++){const ox=f*32,cx=ox+16,cy=16;
    for(let a=0;a<360;a+=15){if(((a/15)+f)%6===0)continue;const q=a*Math.PI/180;px(w,cx+Math.cos(q)*12,cy+Math.sin(q)*9,C.ink);px(w,cx+Math.cos(q)*10,cy+Math.sin(q)*7,C.cool);}
    const rot=f?Math.PI/4:0;for(let n=0;n<4;n++){const a=rot+n*Math.PI/2;outlinedLine(w,cx+Math.cos(a)*3,cy+Math.sin(a)*3,cx+Math.cos(a)*8,cy+Math.sin(a)*6,C.bone);} outlinedDiamond(w,cx,cy,3,C.shadow);
  }
  write("ward-rune.png",upscale(w));
  const b=png(16,16);outlinedLine(b,3,4,8,9,C.warm);outlinedLine(b,8,9,13,4,C.warm);outlinedLine(b,5,3,8,6,C.amber);outlinedLine(b,8,6,11,3,C.amber);outlinedDiamond(b,8,11,1,C.bone);write("brand-mark.png",upscale(b));
}

function shadows(): void {
  const p=png(7*96,96);
  const shapes:[[number,number,number,number],[number,number,number,number]][]=[
    [[48,55,25,8],[48,54,15,11]],[[48,55,24,8],[41,54,14,10]],[[48,54,28,9],[48,54,13,13]],
    [[48,54,27,8],[52,52,15,11]],[[48,55,35,10],[48,53,20,14]],[[48,55,27,9],[42,53,14,13]],[[48,55,23,8],[48,53,13,12]],
  ];
  shapes.forEach((pair,i)=>{const ox=i*96;ellipse(p,ox+pair[0][0],pair[0][1],pair[0][2],pair[0][3],C.ink);ellipse(p,ox+pair[1][0],pair[1][1],pair[1][2],pair[1][3],C.ink);});
  write("shadows.png",p);
}

function partAIcons(): void {
  const p = png(7 * 16, 3 * 16);
  const cell = (col: number, row: number) => ({ ox: col * 16, oy: row * 16 });
  const at = (col: number, row: number) => {
    const { ox, oy } = cell(col, row);
    return { X: (x: number) => ox + x, Y: (y: number) => oy + y };
  };

  // Spells: three orbiting blades, ground fire, rune slab, blink slash,
  // inward void and a small spirit ally.
  {
    const {X,Y}=at(0,0); outlinedDiamond(p,X(8),Y(8),1,C.violet);
    for(const [x0,y0,x1,y1] of [[3,8,6,5],[9,3,11,7],[10,11,6,12]] as const) outlinedLine(p,X(x0),Y(y0),X(x1),Y(y1),C.bone);
  }
  {
    const {X,Y}=at(1,0); ellipse(p,X(8),Y(12),6,2,C.ink);
    triangle(p,X(3),Y(12),X(7),Y(3),X(9),Y(12),C.red); triangle(p,X(7),Y(12),X(11),Y(5),X(13),Y(12),C.amber); px(p,X(8),Y(6),C.bone);
  }
  {
    const {X,Y}=at(2,0); rect(p,X(3),Y(2),10,13,C.ink); rect(p,X(5),Y(3),6,10,C.body);
    outlinedDiamond(p,X(8),Y(8),2,C.cool); rect(p,X(4),Y(13),8,2,C.light);
  }
  {
    const {X,Y}=at(3,0); for(let n=0;n<3;n++) outlinedLine(p,X(1),Y(5+n*3),X(7),Y(5+n*3),C.cool);
    outlinedLine(p,X(5),Y(13),X(14),Y(3),C.bone); px(p,X(13),Y(3),C.amber);
  }
  {
    const {X,Y}=at(4,0); ellipse(p,X(8),Y(8),6,6,C.ink); ring(p,X(8),Y(8),4,C.violet);
    for(const [x,y] of [[8,4],[11,8],[8,12],[5,8]] as const) outlinedLine(p,X(x),Y(y),X(8),Y(8),C.violet); diamond(p,X(8),Y(8),1,C.shadow);
  }
  {
    const {X,Y}=at(5,0); ellipse(p,X(8),Y(8),5,6,C.ink); ellipse(p,X(8),Y(8),3,4,C.green);
    px(p,X(7),Y(7),C.bone); px(p,X(10),Y(7),C.bone); triangle(p,X(4),Y(5),X(2),Y(8),X(5),Y(8),C.cool); triangle(p,X(12),Y(5),X(14),Y(8),X(11),Y(8),C.cool);
  }
  // Resonance: blade within a signal ring.
  {
    const {X,Y}=at(6,0); ring(p,X(8),Y(8),6,C.violet); outlinedLine(p,X(4),Y(12),X(12),Y(3),C.bone); diamond(p,X(4),Y(12),1,C.amber);
  }

  // Wrath and room/action badges.
  {
    const {X,Y}=at(0,1); for(let a=20;a<315;a+=20){const q=a*Math.PI/180;px(p,X(8+Math.cos(q)*5),Y(8+Math.sin(q)*5),C.amber);} arrowHead(p,X(13),Y(6),1,-1,C.bone); outlinedLine(p,X(5),Y(10),X(11),Y(5),C.bone);
  }
  {
    const {X,Y}=at(1,1); ellipse(p,X(8),Y(9),6,5,C.ink); ellipse(p,X(8),Y(9),4,3,C.amber); rect(p,X(5),Y(4),6,2,C.ink); outlinedLine(p,X(8),Y(4),X(8),Y(2),C.bone); px(p,X(7),Y(8),C.bone);
  }
  {
    const {X,Y}=at(2,1); rect(p,X(2),Y(5),12,3,C.ink); rect(p,X(4),Y(7),8,6,C.ink); rect(p,X(5),Y(8),6,4,C.light); outlinedLine(p,X(8),Y(2),X(8),Y(8),C.bone); outlinedLine(p,X(4),Y(3),X(12),Y(3),C.amber);
  }
  {
    const {X,Y}=at(3,1); outlinedLine(p,X(3),Y(13),X(13),Y(3),C.bone); px(p,X(11),Y(3),C.amber);
  }
  {
    const {X,Y}=at(4,1); ring(p,X(8),Y(8),6,C.cool); outlinedLine(p,X(4),Y(11),X(12),Y(4),C.bone); arrowHead(p,X(13),Y(6),1,-1,C.amber);
  }
  {
    const {X,Y}=at(5,1); for(let n=0;n<3;n++) outlinedLine(p,X(1),Y(5+n*3),X(7),Y(5+n*3),C.cool); triangle(p,X(7),Y(3),X(14),Y(8),X(7),Y(13),C.ink); triangle(p,X(9),Y(5),X(13),Y(8),X(9),Y(11),C.bone);
  }
  {
    const {X,Y}=at(6,1); const pts=[[8,2],[13,4],[12,10],[8,14],[4,10],[3,4]] as const;
    for(let n=0;n<pts.length;n++){const a=pts[n]!,b=pts[(n+1)%pts.length]!;outlinedLine(p,X(a[0]),Y(a[1]),X(b[0]),Y(b[1]),C.cool);} rect(p,X(7),Y(5),3,6,C.body);
  }

  // Status marks. These are silhouettes, including the alert mark: no font
  // glyphs are involved.
  {
    const {X,Y}=at(0,2); triangle(p,X(3),Y(13),X(8),Y(2),X(13),Y(13),C.ink); triangle(p,X(5),Y(12),X(8),Y(5),X(11),Y(12),C.amber); px(p,X(8),Y(8),C.bone);
  }
  {
    const {X,Y}=at(1,2); ellipse(p,X(8),Y(10),5,4,C.ink); triangle(p,X(8),Y(2),X(3),Y(10),X(13),Y(10),C.ink); ellipse(p,X(8),Y(10),3,2,C.green); triangle(p,X(8),Y(4),X(5),Y(9),X(11),Y(9),C.green); px(p,X(7),Y(7),C.bone);
  }
  {
    const {X,Y}=at(2,2); for(let a=0;a<3;a++){const q=a*Math.PI/3;outlinedLine(p,X(8-Math.cos(q)*6),Y(8-Math.sin(q)*6),X(8+Math.cos(q)*6),Y(8+Math.sin(q)*6),C.cool);} diamond(p,X(8),Y(8),1,C.bone);
  }
  {
    const {X,Y}=at(3,2); diamond(p,X(8),Y(8),7,C.ink); diamond(p,X(8),Y(8),5,C.cool); outlinedLine(p,X(5),Y(6),X(10),Y(11),C.bone);
  }
  {
    const {X,Y}=at(4,2); for(const [x,y] of [[4,5],[8,3],[12,5]] as const){diamond(p,X(x),Y(y),2,C.amber);} for(const [x,y] of [[5,11],[10,11]] as const) outlinedLine(p,X(x-2),Y(y),X(x+2),Y(y),C.bone);
  }
  {
    const {X,Y}=at(5,2); const pts=[[8,2],[13,4],[12,10],[8,14],[4,10],[3,4]] as const;for(let n=0;n<6;n++){const a=pts[n]!,b=pts[(n+1)%6]!;outlinedLine(p,X(a[0]),Y(a[1]),X(b[0]),Y(b[1]),C.light);} outlinedLine(p,X(5),Y(4),X(9),Y(9),C.red); outlinedLine(p,X(9),Y(9),X(7),Y(13),C.red);
  }
  {
    const {X,Y}=at(6,2); rect(p,X(6),Y(2),5,9,C.ink); rect(p,X(8),Y(4),1,5,C.amber); diamond(p,X(8),Y(13),2,C.ink); px(p,X(8),Y(13),C.bone);
  }
  write("part-a-icons.png", upscale(p));
}

function partAShadows(): void {
  const p = png(2 * 64, 64);
  ellipse(p, 32, 43, 25, 8, C.ink); ellipse(p, 32, 42, 15, 11, C.ink);
  ellipse(p, 96, 43, 28, 9, C.ink); ellipse(p, 96, 42, 14, 13, C.ink);
  write("part-a-shadows.png", upscale(p));
  const boss = png(256, 256);
  ellipse(boss, 128, 178, 90, 25, C.ink); ellipse(boss, 128, 173, 55, 35, C.ink);
  write("part-a-boss-shadow.png", upscale(boss));
}

mkdirSync(OUT, { recursive: true });
spellIcons(); shadows(); affixIcons(); statIcons(); rewardBadges(); wardAndBrand(); partAIcons(); partAShadows();
console.log("request art written: spell icons, shadows, reward, affix and Part A UI");
