/** Convert the Crypt King's additional action and story boards to hard-pixel art. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = fileURLToPath(new URL("../../../../assets/source/melee/", import.meta.url));
const ramps = JSON.parse(readFileSync(join(ROOT, "boss-king-palette.json"), "utf8")).ramps as Record<string, string[]>;
const bodyColors = Object.entries(ramps).filter(([name]) => name !== "stone").flatMap(([, shades]) => shades);
const rgb = (hex: string): readonly [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];
const bodyPalette = bodyColors.map(rgb);
const storyPalette = Object.values(ramps).flat().map(rgb);

interface Figure { id: number; area: number; minX: number; minY: number; maxX: number; maxY: number }
function figures(src: PNG): { labels: Uint16Array; found: Figure[] } {
  const { width: w, height: h } = src;
  const labels = new Uint16Array(w * h), found: Figure[] = [];
  let next = 1;
  for (let p = 0; p < labels.length; p++) {
    if (labels[p] || src.data[p * 4 + 3]! < 220) continue;
    const id = next++, stack = [p]; labels[p] = id;
    let area = 0, minX = w, minY = h, maxX = 0, maxY = 0;
    while (stack.length) {
      const q = stack.pop()!, x = q % w, y = Math.floor(q / w);
      area++; minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
        const n = yy * w + xx;
        if (labels[n] || src.data[n * 4 + 3]! < 220) continue;
        labels[n] = id; stack.push(n);
      }
    }
    if (area > 1000) found.push({ id, area, minX, minY, maxX, maxY });
  }
  return { labels, found };
}

function nearest(r: number, g: number, b: number, palette: readonly (readonly [number, number, number])[]): readonly [number, number, number] {
  let result = palette[0]!, best = Infinity;
  for (const color of palette) {
    const score = (r - color[0]) ** 2 + (g - color[1]) ** 2 + (b - color[2]) ** 2;
    if (score < best) { best = score; result = color; }
  }
  return result;
}

function sample(src: PNG, labels: Uint16Array | undefined, id: number | undefined,
  sourceX: number, sourceFloorY: number, scale: number, size: number,
  palette: readonly (readonly [number, number, number])[], floor = size / 2 + 91): PNG {
  const out = new PNG({ width: size, height: size }); out.data.fill(0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = sourceX + (x + .5 - size / 2) / scale;
    const sy = sourceFloorY + (y + .5 - floor) / scale;
    let r = 0, g = 0, b = 0, count = 0;
    for (const [dx, dy] of [[0, 0], [-.3, 0], [.3, 0], [0, -.3], [0, .3]] as const) {
      const xx = Math.floor(sx + dx / scale), yy = Math.floor(sy + dy / scale);
      if (xx < 0 || xx >= src.width || yy < 0 || yy >= src.height) continue;
      const p = yy * src.width + xx, i = p * 4;
      if (src.data[i + 3]! < 220 || (labels && labels[p] !== id)) continue;
      r += src.data[i]!; g += src.data[i + 1]!; b += src.data[i + 2]!; count++;
    }
    if (count < 3) continue;
    out.data.set([...nearest(r / count, g / count, b / count, palette), 255], (y * size + x) * 4);
  }
  return out;
}

function shifted(src: PNG, dx: number, dy: number): PNG {
  const out = new PNG({ width: src.width, height: src.height }); out.data.fill(0);
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || xx >= src.width || yy < 0 || yy >= src.height) continue;
    out.data.set(src.data.subarray((y * src.width + x) * 4, (y * src.width + x) * 4 + 4), (yy * src.width + xx) * 4);
  }
  return out;
}

function margin(p: PNG): number {
  let minX = p.width, minY = p.height, maxX = -1, maxY = -1;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    if (!p.data[(y * p.width + x) * 4 + 3]) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return Math.min(minX, minY, p.width - 1 - maxX, p.height - 1 - maxY);
}

function deliver(frame: PNG, file: string): void {
  const m = margin(frame);
  if (m < 6) throw new Error(`${file}: only ${m}px of transparent margin`);
  const out = new PNG({ width: frame.width * 4, height: frame.height * 4 }); out.data.fill(0);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const si = (Math.floor(y / 4) * frame.width + Math.floor(x / 4)) * 4;
    out.data.set(frame.data.subarray(si, si + 4), (y * out.width + x) * 4);
  }
  writeFileSync(join(ROOT, file), PNG.sync.write(out));
  console.log(`${file}: ${frame.width}px art grid, margin ${m}`);
}

function panelMask(src: PNG, left: number, right: number): Uint16Array {
  const mask = new Uint16Array(src.width * src.height);
  for (let y = 0; y < src.height; y++) for (let x = left; x < right; x++) {
    const p = y * src.width + x;
    if (src.data[p * 4 + 3]! >= 220) mask[p] = 1;
  }
  return mask;
}

function panelFloor(mask: Uint16Array, width: number): number {
  for (let y = Math.floor(mask.length / width) - 1; y >= 0; y--)
    for (let x = 0; x < width; x++) if (mask[y * width + x]) return y;
  throw new Error("Empty story panel");
}

function strip(frames: readonly PNG[], file: string): void {
  const w = frames.reduce((sum, f) => sum + f.width, 0), h = frames[0]!.height;
  const out = new PNG({ width: w, height: h }); out.data.fill(0);
  let offset = 0;
  for (const frame of frames) {
    if (frame.height !== h) throw new Error(`${file}: mismatched panel heights`);
    for (let y = 0; y < h; y++)
      out.data.set(frame.data.subarray(y * frame.width * 4, (y + 1) * frame.width * 4), (y * w + offset) * 4);
    offset += frame.width;
  }
  const upscale = new PNG({ width: w * 4, height: h * 4 }); upscale.data.fill(0);
  for (let y = 0; y < upscale.height; y++) for (let x = 0; x < upscale.width; x++) {
    const si = (Math.floor(y / 4) * w + Math.floor(x / 4)) * 4;
    upscale.data.set(out.data.subarray(si, si + 4), (y * upscale.width + x) * 4);
  }
  writeFileSync(join(ROOT, file), PNG.sync.write(upscale));
  console.log(`${file}: ${frames.length} story panels`);
}

const poses = ["slam", "leap_gather", "leap_air", "hurt", "hook", "backhand"] as const;
const sizes = [256, 288, 336, 256, 336, 288] as const;
const anchorX = {
  1: [270, 760, 1260, 245, 695, 1260],
  2: [255, 755, 1260, 245, 722, 1270],
  3: [250, 730, 1230, 250, 740, 1270],
} as const;

for (const phase of [1, 2, 3] as const) {
  const src = PNG.sync.read(readFileSync(join(ROOT, `boss-king-p${phase}-extra-draft.png`)));
  const { labels, found } = figures(src);
  // The figures may extend into a neighbour's grid cell, so use connected
  // foreground components rather than a rectangular cell crop.
  const top = found.filter((f) => f.minY < 530).sort((a, b) => a.minX - b.minX);
  const bottom = found.filter((f) => f.minY >= 530).sort((a, b) => a.minX - b.minX);
  const ordered = [...top, ...bottom];
  if (top.length !== 3 || bottom.length !== 3) throw new Error(`phase ${phase}: expected six figures, got ${top.length}+${bottom.length}`);
  for (let i = 0; i < 6; i++) {
    const fig = ordered[i]!;
    const frame = sample(src, labels, fig.id, anchorX[phase][i]!, fig.maxY,
      poses[i] === "hook" && phase !== 3 ? .52 : .49, sizes[i]!, bodyPalette);
    const name = poses[i]!;
    deliver(frame, `boss-king/p${phase}/${name}.png`);
    if (name === "hurt") {
      deliver(frame, `boss-king/p${phase}/hit0.png`);
      deliver(shifted(frame, 2, 1), `boss-king/p${phase}/hit1.png`);
    }
  }
}

// A separate impact sheet keeps the one-knee sword plant distinct from the
// neutral pose. The six-pose boards predate this corrected contact drawing.
const slamSource = PNG.sync.read(readFileSync(join(ROOT, "boss-king-slam-draft.png")));
for (const phase of [1, 2, 3] as const) {
  const left = (phase - 1) * slamSource.width / 3;
  const right = phase * slamSource.width / 3;
  const mask = panelMask(slamSource, left, right);
  const frame = sample(slamSource, mask, 1, (left + right) / 2,
    panelFloor(mask, slamSource.width), phase === 3 ? .30 : .37, 256, bodyPalette);
  deliver(frame, `boss-king/p${phase}/slam.png`);
}

const throneSource = PNG.sync.read(readFileSync(join(ROOT, "boss-king-throne-draft.png")));
const thronePanels: PNG[] = [];
for (let i = 0; i < 2; i++) {
  const left = i * throneSource.width / 2, right = (i + 1) * throneSource.width / 2;
  const mask = panelMask(throneSource, left, right);
  const panel = sample(throneSource, mask, 1, (left + right) / 2,
    panelFloor(mask, throneSource.width), .245, 256, storyPalette, 236);
  deliver(panel, `boss-king/throne_${i === 0 ? "seated" : "empty"}.png`);
  thronePanels.push(panel);
}
strip(thronePanels, "boss-king-throne.png");

const deathSource = PNG.sync.read(readFileSync(join(ROOT, "boss-king-death-draft.png")));
const deathPanels: PNG[] = [];
for (let i = 0; i < 3; i++) {
  const left = i * deathSource.width / 3, right = (i + 1) * deathSource.width / 3;
  const mask = panelMask(deathSource, left, right);
  const panel = sample(deathSource, mask, 1, (left + right) / 2,
    panelFloor(mask, deathSource.width), .32, 256, bodyPalette);
  deliver(panel, `boss-king/death${i}.png`);
  deathPanels.push(panel);
}
strip(deathPanels, "boss-king-death.png");

// B8 action boards and detached phase-change parts supersede the earlier
// copied hit frames and the caped third-phase slam.
await import("./normalize-boss-king-moves.ts");
