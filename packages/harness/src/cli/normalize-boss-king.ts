/**
 * Export the approved three-phase Crypt King boards onto the runtime art grid.
 * The drafts remain versioned source; the files in boss-king/ are reproducible
 * 4x nearest-neighbour exports, one file per atlas frame.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = fileURLToPath(new URL("../../../../assets/source/melee/", import.meta.url));
const ramps = JSON.parse(readFileSync(join(ROOT, "boss-king-palette.json"), "utf8")).ramps as Record<string, string[]>;
const colors = Object.entries(ramps).filter(([name]) => name !== "stone").flatMap(([, shades]) => shades).map((hex) => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
] as const);

interface Component { id: number; area: number; minX: number; minY: number; maxX: number; maxY: number }
function components(src: PNG): { labels: Uint8Array; figures: Component[] } {
  const { width: w, height: h } = src;
  const labels = new Uint8Array(w * h), figures: Component[] = [];
  let next = 1;
  for (let p = 0; p < labels.length; p++) {
    if (labels[p] || src.data[p * 4 + 3]! < 128) continue;
    const id = next++, stack = [p]; labels[p] = id;
    let area = 0, minX = w, minY = h, maxX = 0, maxY = 0;
    while (stack.length) {
      const q = stack.pop()!, x = q % w, y = Math.floor(q / w);
      area++; minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
        const n = yy * w + xx;
        if (labels[n] || src.data[n * 4 + 3]! < 128) continue;
        labels[n] = id; stack.push(n);
      }
    }
    if (area > 1000) figures.push({ id, area, minX, minY, maxX, maxY });
  }
  figures.sort((a, b) => a.minX - b.minX);
  if (figures.length !== 5) throw new Error(`Expected five separate king poses, found ${figures.length}`);
  return { labels, figures };
}

const phase = {
  1: { scale: .43, anchorX: [195, 560, 965, 1435, 1960], footY: [580, 633, 622, 590, 580] },
  2: { scale: .37, anchorX: [195, 590, 970, 1480, 1960], footY: [610, 675, 658, 610, 610] },
  3: { scale: .37, anchorX: [205, 600, 980, 1500, 1955], footY: [600, 668, 661, 600, 600] },
} as const;

function quantize(r: number, g: number, b: number): readonly [number, number, number] {
  let best: readonly [number, number, number] = colors[0]!, score = Infinity;
  for (const c of colors) {
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < score) { score = d; best = c; }
  }
  return best;
}

function render(src: PNG, labels: Uint8Array, figure: Component, p: 1 | 2 | 3,
  pose: number, size: number): PNG {
  const cfg = phase[p];
  const out = new PNG({ width: size, height: size }); out.data.fill(0);
  // The foot line stays 91 art pixels below the frame centre in every size.
  // A 336px windup accommodates the raised sword without shrinking/cropping.
  const floor = size / 2 + 91;
  // The first phase commits a deliberate lead-foot step to the left. This
  // separates the cut from its loaded silhouette without moving the feet off
  // the shared ground line or changing the approved weapon drawing.
  const xCenter = p === 1 && pose === 2 ? size / 2 - 6
    : p === 1 && pose === 3 ? size / 2 - 4 : size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = cfg.anchorX[pose]! + (x + .5 - xCenter) / cfg.scale;
    const sy = cfg.footY[pose]! + (y + .5 - floor) / cfg.scale;
    let r = 0, g = 0, b = 0, count = 0;
    for (const [dx, dy] of [[0, 0], [-.3, 0], [.3, 0], [0, -.3], [0, .3]] as const) {
      const xx = Math.floor(sx + dx / cfg.scale), yy = Math.floor(sy + dy / cfg.scale);
      if (xx < 0 || xx >= src.width || yy < 0 || yy >= src.height) continue;
      const si = yy * src.width + xx, i = si * 4;
      if (labels[si] !== figure.id || src.data[i + 3]! < 180) continue;
      r += src.data[i]!; g += src.data[i + 1]!; b += src.data[i + 2]!; count++;
    }
    if (count < 3) continue;
    const c = quantize(r / count, g / count, b / count);
    out.data.set([...c, 255], (y * size + x) * 4);
  }
  return out;
}

function upscale4(p: PNG): PNG {
  const out = new PNG({ width: p.width * 4, height: p.height * 4 }); out.data.fill(0);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const si = (Math.floor(y / 4) * p.width + Math.floor(x / 4)) * 4;
    out.data.set(p.data.subarray(si, si + 4), (y * out.width + x) * 4);
  }
  return out;
}

function margin(p: PNG): number {
  let l = p.width, t = p.height, r = -1, b = -1;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++)
    if (p.data[(y * p.width + x) * 4 + 3]) {
      l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x); b = Math.max(b, y);
    }
  return Math.min(l, t, p.width - 1 - r, p.height - 1 - b);
}

const mapping = {
  idle0: 0, idle1: 4, idle2: 0, idle3: 4,
  windup: 1, commit: 2, follow: 3,
} as const;
const castPlacement = {
  1: { scale: .18, sourceX: 628, sourceFloorY: 1160 },
  2: { scale: .18, sourceX: 515, sourceFloorY: 1320 },
  3: { scale: .165, sourceX: 514, sourceFloorY: 1320 },
} as const;

function castFrame(src: PNG, p: 1 | 2 | 3, pulse: boolean): PNG {
  const { scale, sourceX, sourceFloorY } = castPlacement[p];
  const out = new PNG({ width: 256, height: 256 }); out.data.fill(0);
  const heart = ramps.heart!;
  const brighter = new Map<string, readonly [number, number, number]>();
  heart.forEach((hex, index) => {
    const next = heart[Math.min(heart.length - 1, index + 1)]!;
    brighter.set(hex.toLowerCase(), [parseInt(next.slice(1, 3), 16), parseInt(next.slice(3, 5), 16), parseInt(next.slice(5, 7), 16)]);
  });
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const sx = sourceX + (x + .5 - 128) / scale;
    const sy = sourceFloorY + (y + .5 - 219) / scale;
    let r = 0, g = 0, b = 0, count = 0;
    for (const [dx, dy] of [[0, 0], [-.3, 0], [.3, 0], [0, -.3], [0, .3]] as const) {
      const xx = Math.floor(sx + dx / scale), yy = Math.floor(sy + dy / scale);
      if (xx < 0 || xx >= src.width || yy < 0 || yy >= src.height) continue;
      const i = (yy * src.width + xx) * 4;
      // The generated drafts have a soft background glow. Require body-grade
      // alpha so neither the backdrop nor a coloured fringe enters the atlas.
      if (src.data[i + 3]! < 220) continue;
      r += src.data[i]!; g += src.data[i + 1]!; b += src.data[i + 2]!; count++;
    }
    if (count < 3) continue;
    let c = quantize(r / count, g / count, b / count);
    if (pulse) {
      const key = `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      c = brighter.get(key) ?? c;
    }
    out.data.set([...c, 255], (y * 256 + x) * 4);
  }
  return out;
}
for (const p of [1, 2, 3] as const) {
  const src = PNG.sync.read(readFileSync(join(ROOT, `boss-king-p${p}-slash-draft.png`)));
  const { labels, figures } = components(src);
  const outDir = join(ROOT, "boss-king", `p${p}`);
  mkdirSync(outDir, { recursive: true });
  for (const [name, pose] of Object.entries(mapping)) {
    if (name === "idle1" || name === "idle3") continue;
    const size = name === "windup" || name === "leap" ? 336 : 256;
    const frame = render(src, labels, figures[pose]!, p, pose, size);
    const m = margin(frame);
    if (m < 6) throw new Error(`boss_p${p}_${name}: only ${m}px transparent margin`);
    writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(upscale4(frame)));
    console.log(`boss_p${p}_${name}: ${size} art px, margin ${m}`);
  }
  const cast = PNG.sync.read(readFileSync(join(ROOT, `boss-king-p${p}-cast-draft.png`)));
  for (const [name, pulse] of [["tele", false], ["tele1", true]] as const) {
    const frame = castFrame(cast, p, pulse);
    const m = margin(frame);
    if (m < 6) throw new Error(`boss_p${p}_${name}: only ${m}px transparent margin`);
    writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(upscale4(frame)));
    console.log(`boss_p${p}_${name}: 256 art px, margin ${m}`);
  }
}

// The high point is painted from each planted idle without resizing its outline.
await import("./normalize-boss-king-idle-breath.ts");
// Additional move and story panels are the other half of this delivery.
await import("./normalize-boss-king-extra.ts");
