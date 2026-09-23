/**
 * Projects the approved Part-A ImageGen drafts onto the game's real pixel
 * grid. Drafts remain beside these outputs for art review; production sources
 * are exact 4x nearest-neighbour sheets so packing cannot soften their edges.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const OUT = new URL("../../../../assets/source/melee/", import.meta.url);

type Bounds = readonly [number, number, number, number];

function contentBounds(p: PNG, left: number, top: number, right: number, bottom: number): Bounds {
  let l = right, t = bottom, r = left, b = top;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    if (p.data[(y * p.width + x) * 4 + 3]! <= 180) continue;
    l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x + 1); b = Math.max(b, y + 1);
  }
  if (r <= l || b <= t) throw new Error(`Empty generated cell ${left},${top},${right},${bottom}`);
  return [l, t, r, b];
}

function renderCell(raw: PNG, [l, t, r, b]: Bounds, target: number, padding: number): PNG {
  const scale = Math.min((target - padding * 2) / (r - l), (target - padding * 2) / (b - t));
  const w = Math.max(1, Math.round((r - l) * scale));
  const h = Math.max(1, Math.round((b - t) * scale));
  const x0 = Math.floor((target - w) / 2), y0 = Math.floor((target - h) / 2);
  const out = new PNG({ width: target, height: target });
  out.data.fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(r - 1, l + Math.floor((x + 0.5) * (r - l) / w));
    const sy = Math.min(b - 1, t + Math.floor((y + 0.5) * (b - t) / h));
    const si = (sy * raw.width + sx) * 4;
    if (raw.data[si + 3]! <= 180) continue;
    const di = ((y0 + y) * target + x0 + x) * 4;
    out.data.set(raw.data.subarray(si, si + 3), di);
    out.data[di + 3] = 255;
  }
  return out;
}

function upscale4(p: PNG): PNG {
  const out = new PNG({ width: p.width * 4, height: p.height * 4 });
  out.data.fill(0);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const si = (y * p.width + x) * 4;
    for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) {
      const di = (((y * 4 + yy) * out.width) + x * 4 + xx) * 4;
      out.data.set(p.data.subarray(si, si + 4), di);
    }
  }
  return out;
}

/** ImageGen leaves clear gutters, but they are not mathematically even. */
function gridCuts(raw: PNG, horizontal: boolean, parts: number): number[] {
  const length = horizontal ? raw.width : raw.height;
  const cross = horizontal ? raw.height : raw.width;
  const occupancy = new Int32Array(length);
  for (let at = 0; at < length; at++) for (let other = 0; other < cross; other++) {
    const x = horizontal ? at : other, y = horizontal ? other : at;
    if (raw.data[(y * raw.width + x) * 4 + 3]! > 180) occupancy[at]!++;
  }
  const cuts = [0];
  for (let part = 1; part < parts; part++) {
    const nominal = part * length / parts;
    const radius = Math.floor(length / parts * 0.42);
    let best = Math.round(nominal), bestScore = Infinity, bestDistance = Infinity;
    for (let candidate = Math.max(4, Math.floor(nominal - radius)); candidate <= Math.min(length - 5, Math.ceil(nominal + radius)); candidate++) {
      let score = 0;
      for (let d = -3; d <= 3; d++) score += occupancy[candidate + d]!;
      const distance = Math.abs(candidate - nominal);
      if (score < bestScore || (score === bestScore && distance < bestDistance)) {
        best = candidate; bestScore = score; bestDistance = distance;
      }
    }
    cuts.push(best);
  }
  cuts.push(length);
  return cuts;
}

function normaliseGrid(
  draft: string, output: string, cols: number, rows: number, target: number,
  padding = target >= 256 ? 20 : target >= 96 ? 10 : target >= 64 ? 6 : 3,
): void {
  const raw = PNG.sync.read(readFileSync(new URL(draft, OUT)));
  const sheet = new PNG({ width: cols * target, height: rows * target });
  sheet.data.fill(0);
  const xs = gridCuts(raw, true, cols), ys = gridCuts(raw, false, rows);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const left = xs[col]!, right = xs[col + 1]!;
    const top = ys[row]!, bottom = ys[row + 1]!;
    const cell = renderCell(raw, contentBounds(raw, left, top, right, bottom), target, padding);
    PNG.bitblt(cell, sheet, 0, 0, target, target, col * target, row * target);
  }
  writeFileSync(new URL(output, OUT), PNG.sync.write(upscale4(sheet)));
}

function normaliseRect(draft: string, output: string, width: number, height: number): void {
  const raw = PNG.sync.read(readFileSync(new URL(draft, OUT)));
  const [l, t, r, b] = contentBounds(raw, 0, 0, raw.width, raw.height);
  const scale = Math.min((width - 2) / (r - l), (height - 2) / (b - t));
  const w = Math.max(1, Math.round((r - l) * scale));
  const h = Math.max(1, Math.round((b - t) * scale));
  const out = new PNG({ width, height });
  out.data.fill(0);
  const x0 = Math.floor((width - w) / 2), y0 = Math.floor((height - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(r - 1, l + Math.floor((x + 0.5) * (r - l) / w));
    const sy = Math.min(b - 1, t + Math.floor((y + 0.5) * (b - t) / h));
    const si = (sy * raw.width + sx) * 4;
    if (raw.data[si + 3]! <= 180) continue;
    const di = ((y0 + y) * width + x0 + x) * 4;
    out.data.set(raw.data.subarray(si, si + 3), di);
    out.data[di + 3] = 255;
  }
  writeFileSync(new URL(output, OUT), PNG.sync.write(upscale4(out)));
}

/** Keep the rotating barrel compact and put its authored pivot at x=13. */
function normaliseSentinelBarrel(): void {
  const raw = PNG.sync.read(readFileSync(new URL("enemy-sentinel-barrel-draft.png", OUT)));
  const [l, t, r, b] = contentBounds(raw, 0, 0, raw.width, raw.height);
  const scale = Math.min(40 / (r - l), 16 / (b - t));
  const w = Math.max(1, Math.round((r - l) * scale));
  const h = Math.max(1, Math.round((b - t) * scale));
  const out = new PNG({ width: 64, height: 64 });
  out.data.fill(0);
  // The generated collar centre sits about five output pixels into the crop.
  // Starting at x=8 lands that centre on the renderer's 0.2 origin (12.8 px).
  const x0 = 8, y0 = Math.floor((64 - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(r - 1, l + Math.floor((x + 0.5) * (r - l) / w));
    const sy = Math.min(b - 1, t + Math.floor((y + 0.5) * (b - t) / h));
    const si = (sy * raw.width + sx) * 4;
    if (raw.data[si + 3]! <= 180) continue;
    const di = ((y0 + y) * 64 + x0 + x) * 4;
    out.data.set(raw.data.subarray(si, si + 3), di);
    out.data[di + 3] = 255;
  }
  writeFileSync(new URL("enemy-sentinel-barrel.png", OUT), PNG.sync.write(upscale4(out)));
}

function recolourTankGem(): void {
  const file = new URL("enemy-tank-weapon.png", OUT);
  const p = PNG.sync.read(readFileSync(file));
  for (let i = 0; i < p.data.length; i += 4) {
    const r = p.data[i]!, g = p.data[i + 1]!, b = p.data[i + 2]!;
    if (p.data[i + 3]! && b > r * 1.15 && g > r * 1.1) {
      const value = Math.max(r, g, b);
      p.data[i] = Math.min(255, Math.round(value * 1.05));
      p.data[i + 1] = Math.round(value * 0.68);
      p.data[i + 2] = Math.round(value * 0.18);
    }
  }
  writeFileSync(file, PNG.sync.write(p));
}

function makeSpikeVariants(): void {
  normaliseRect("enemy-lancer-spike-draft.png", "enemy-lancer-spike-gold.png", 16, 6);
  const goldFile = new URL("enemy-lancer-spike-gold.png", OUT);
  const boneFile = new URL("enemy-lancer-spike-bone.png", OUT);
  const p = PNG.sync.read(readFileSync(goldFile));
  for (let i = 0; i < p.data.length; i += 4) {
    if (!p.data[i + 3]) continue;
    const value = Math.max(p.data[i]!, p.data[i + 1]!, p.data[i + 2]!);
    if (value > 75 && p.data[i]! > p.data[i + 2]!) {
      p.data[i] = Math.min(245, Math.round(value * 0.98));
      p.data[i + 1] = Math.min(235, Math.round(value * 0.91));
      p.data[i + 2] = Math.min(220, Math.round(value * 0.82));
    }
  }
  writeFileSync(boneFile, PNG.sync.write(p));
}

mkdirSync(OUT, { recursive: true });
normaliseGrid("enemy-lancer-walk-draft.png", "enemy-lancer-walk.png", 4, 3, 64);
normaliseGrid("enemy-lancer-idle-dormant-draft.png", "enemy-lancer-idle-dormant.png", 4, 3, 64);
normaliseGrid("enemy-lancer-actions-draft.png", "enemy-lancer-actions.png", 4, 3, 64);
normaliseGrid("enemy-lancer-death-burst-draft.png", "enemy-lancer-death-burst.png", 2, 1, 64, 4);
normaliseGrid("enemy-sentinel-draft.png", "enemy-sentinel.png", 3, 3, 64, 5);
normaliseGrid("boss-p1-actions-draft.png", "boss-p1-actions.png", 3, 2, 256);
normaliseGrid("boss-p2-actions-draft.png", "boss-p2-actions.png", 3, 2, 256);
normaliseGrid("boss-p3-actions-draft.png", "boss-p3-actions.png", 3, 2, 256);
normaliseGrid("enemy-rusher-bristle-draft.png", "enemy-rusher-actions.png", 2, 3, 64, 5);
normaliseGrid("enemy-tank-weapon-draft.png", "enemy-tank-weapon.png", 1, 1, 64, 2);
recolourTankGem();
normaliseSentinelBarrel();
makeSpikeVariants();
console.log("Part A drafts normalized onto exact 4x pixel sources");
