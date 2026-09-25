/** Turn B8 draft boards into palette-limited, hard-alpha 4× boss frames. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = fileURLToPath(new URL("../../../../assets/source/melee/", import.meta.url));
const ramps = JSON.parse(readFileSync(join(root, "boss-king-palette.json"), "utf8")).ramps as Record<string, string[]>;
const rgb = (hex: string): readonly [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];
const body = Object.entries(ramps).filter(([name]) => name !== "stone").flatMap(([, colors]) => colors).map(rgb);
const chainColors = [...ramps.outline!, ...ramps.iron!].map(rgb);

interface Figure { id: number; area: number; minX: number; minY: number; maxX: number; maxY: number }
function components(src: PNG): { labels: Uint16Array; figures: Figure[] } {
  const w = src.width, h = src.height, labels = new Uint16Array(w * h), figures: Figure[] = [];
  let next = 0;
  for (let p = 0; p < labels.length; p++) {
    if (labels[p] || src.data[p * 4 + 3]! < 220) continue;
    const id = ++next, stack = [p]; labels[p] = id;
    let area = 0, minX = w, minY = h, maxX = -1, maxY = -1;
    while (stack.length) {
      const q = stack.pop()!, x = q % w, y = Math.floor(q / w);
      area++; minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (const [dx, dy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]] as const) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
        const n = yy * w + xx;
        if (labels[n] || src.data[n * 4 + 3]! < 220) continue;
        labels[n] = id; stack.push(n);
      }
    }
    if (area > 1000) figures.push({ id, area, minX, minY, maxX, maxY });
  }
  return { labels, figures };
}

function nearest(r: number, g: number, b: number, colors: readonly (readonly [number, number, number])[]): readonly [number, number, number] {
  let chosen = colors[0]!, best = Infinity;
  for (const color of colors) {
    const d = (r - color[0]) ** 2 + (g - color[1]) ** 2 + (b - color[2]) ** 2;
    if (d < best) { chosen = color; best = d; }
  }
  return chosen;
}

function sample(src: PNG, labels: Uint16Array | undefined, id: number | undefined,
  sourceX: number, sourceFloorY: number, scale: number, size: number,
  colors: readonly (readonly [number, number, number])[], floor = size / 2 + 91): PNG {
  const out = new PNG({ width: size, height: size }); out.data.fill(0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = sourceX + (x + .5 - size / 2) / scale;
    const sy = sourceFloorY + (y + .5 - floor) / scale;
    let r = 0, g = 0, b = 0, count = 0;
    for (const [dx, dy] of [[0,0],[-.3,0],[.3,0],[0,-.3],[0,.3]] as const) {
      const xx = Math.floor(sx + dx / scale), yy = Math.floor(sy + dy / scale);
      if (xx < 0 || xx >= src.width || yy < 0 || yy >= src.height) continue;
      const p = yy * src.width + xx, i = p * 4;
      if (src.data[i + 3]! < 220 || (labels && labels[p] !== id)) continue;
      r += src.data[i]!; g += src.data[i + 1]!; b += src.data[i + 2]!; count++;
    }
    if (count < 3) continue;
    out.data.set([...nearest(r / count, g / count, b / count, colors), 255], (y * size + x) * 4);
  }
  return out;
}

function margin(frame: PNG): number {
  let left = frame.width, top = frame.height, right = -1, bottom = -1;
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    if (!frame.data[(y * frame.width + x) * 4 + 3]) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < 0) throw new Error("Empty boss frame");
  return Math.min(left, top, frame.width - 1 - right, frame.height - 1 - bottom);
}

function upscale(frame: PNG): PNG {
  const out = new PNG({ width: frame.width * 4, height: frame.height * 4 }); out.data.fill(0);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const i = (Math.floor(y / 4) * frame.width + Math.floor(x / 4)) * 4;
    out.data.set(frame.data.subarray(i, i + 4), (y * out.width + x) * 4);
  }
  return out;
}

function flipHorizontal(frame: PNG): PNG {
  const out = new PNG({ width: frame.width, height: frame.height }); out.data.fill(0);
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    const from = (y * frame.width + x) * 4;
    const to = (y * frame.width + frame.width - 1 - x) * 4;
    out.data.set(frame.data.subarray(from, from + 4), to);
  }
  return out;
}

function strip(frames: PNG[]): PNG {
  const size = frames[0]!.height;
  const out = new PNG({ width: size * frames.length, height: size }); out.data.fill(0);
  frames.forEach((frame, i) => {
    for (let y = 0; y < size; y++)
      out.data.set(frame.data.subarray(y * size * 4, (y + 1) * size * 4), (y * out.width + i * size) * 4);
  });
  return out;
}

function deliver(frame: PNG, path: string): void {
  const m = margin(frame);
  if (m < 6) throw new Error(`${path}: ${m}px margin; need 6px`);
  writeFileSync(join(root, path), PNG.sync.write(upscale(frame)));
  console.log(`${path}: ${frame.width} art px, margin ${m}`);
}

/** Crop a single disconnected cell when the art intentionally has flying parts. */
function panelMask(src: PNG, left: number, top: number, right: number, bottom: number): Uint16Array {
  const labels = new Uint16Array(src.width * src.height);
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const p = y * src.width + x;
    if (src.data[p * 4 + 3]! >= 220) labels[p] = 1;
  }
  return labels;
}

function bounds(labels: Uint16Array, src: PNG): Figure {
  let minX = src.width, minY = src.height, maxX = -1, maxY = -1, area = 0;
  for (let p = 0; p < labels.length; p++) if (labels[p]) {
    const x = p % src.width, y = Math.floor(p / src.width);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); area++;
  }
  return { id: 1, area, minX, minY, maxX, maxY };
}

function sheetFigures(src: PNG, rows: number, cols: number): { labels: Uint16Array; figures: Figure[] } {
  const { labels, figures } = components(src);
  if (figures.length !== rows * cols) throw new Error(`Expected ${rows * cols} connected figures, found ${figures.length}`);
  const result: Figure[] = [];
  for (let row = 0; row < rows; row++) {
    const segment = figures.filter((f) => Math.floor((f.minY + f.maxY) / 2 / (src.height / rows)) === row)
      .sort((a, b) => a.minX - b.minX);
    if (segment.length !== cols) throw new Error(`Row ${row}: expected ${cols} figures, got ${segment.length}`);
    result.push(...segment);
  }
  return { labels, figures: result };
}

const walk = ["walk0", "walk1", "walk2", "walk3", "walk4", "walk5"];
const moveA = ["sweep_wind", "sweep_cut", "sweep_recover", "cleave_cut", "cleave_stuck", "chain_wind"];
const moveB = ["chain_cast", "chain_follow", "hook_wind", "hook_reel", "hit0", "hit1"];
const poses = [...walk, ...moveA, ...moveB, "stagger0", "stagger1"];

const frames = new Map<string, PNG>();
for (const phase of [1, 2, 3] as const) {
  for (const [kind, names] of [["walk", walk], ["moves-a", moveA], ["moves-b", moveB]] as const) {
    const src = PNG.sync.read(readFileSync(join(root, `boss-king-p${phase}-${kind}-draft.png`)));
    const { labels, figures } = sheetFigures(src, 2, 3);
    const baseScale = phase === 3 && kind === "moves-b" ? .36 : phase === 3 ? .42 : .43;
    for (let i = 0; i < names.length; i++) {
      const figure = figures[i]!;
      const center = (figure.minX + figure.maxX) / 2;
      // The sweep can span two draft cells. Preserve its whole blade by a
      // small per-pose fit while keeping the same frame/world origin.
      const scale = Math.min(baseScale, 242 / (figure.maxX - figure.minX + 1),
        213 / (figure.maxY - figure.minY + 1));
      let frame = sample(src, labels, figure.id, center, figure.maxY, scale, 256, body);
      // The draft reversed the sword hand in the second half of P2's walk.
      if (phase === 2 && kind === "walk" && i >= 3) frame = flipHorizontal(frame);
      frames.set(`p${phase}/${names[i]}`, frame);
    }
  }
}

const stagger = PNG.sync.read(readFileSync(join(root, "boss-king-stagger-draft.png")));
const staggerFigures = sheetFigures(stagger, 2, 3);
for (const phase of [1, 2, 3] as const) for (let row = 0; row < 2; row++) {
  const figure = staggerFigures.figures[row * 3 + phase - 1]!;
  const frame = sample(stagger, staggerFigures.labels, figure.id,
    (figure.minX + figure.maxX) / 2, figure.maxY, .36, 256, body);
  frames.set(`p${phase}/stagger${row}`, frame);
}

const stuck = PNG.sync.read(readFileSync(join(root, "boss-king-cleave-stuck-draft.png")));
const stuckFigures = sheetFigures(stuck, 1, 3);
for (const phase of [1, 2, 3] as const) {
  const figure = stuckFigures.figures[phase - 1]!;
  const frame = sample(stuck, stuckFigures.labels, figure.id,
    (figure.minX + figure.maxX) / 2, figure.maxY, .31, 256, body);
  frames.set(`p${phase}/cleave_stuck`, frame);
}

for (const phase of [1, 2, 3] as const) {
  const ordered: PNG[] = [];
  for (const pose of poses) {
    const f = frames.get(`p${phase}/${pose}`)!;
    deliver(f, `boss-king/p${phase}/${pose}.png`);
    ordered.push(f);
  }
  // The work order's 5×4 board is a contact/delivery sheet. Runtime keeps
  // individual frames so their coordinates and sword-tip anchors remain exact.
  const board = new PNG({ width: 256 * 5, height: 256 * 4 }); board.data.fill(0);
  ordered.forEach((f, i) => {
    const ox = (i % 5) * 256, oy = Math.floor(i / 5) * 256;
    for (let y = 0; y < 256; y++)
      board.data.set(f.data.subarray(y * 256 * 4, (y + 1) * 256 * 4), ((oy + y) * board.width + ox) * 4);
  });
  writeFileSync(join(root, `boss-king-p${phase}-moves.png`), PNG.sync.write(upscale(board)));
}

// Third phase has shed its cape. This redraw replaces only the old slam,
// keeping the crown attached and the three chains visibly rooted at the heart.
{
  const src = PNG.sync.read(readFileSync(join(root, "boss-king-p3-slam-nocape-draft.png")));
  const { labels, figures } = components(src);
  const figure = figures.sort((a, b) => b.area - a.area)[0]!;
  deliver(sample(src, labels, figure.id, (figure.minX + figure.maxX) / 2,
    figure.maxY, .23, 256, body), "boss-king/p3/slam.png");
}

// Two unbinding poses include nearby disconnected debris; the separate
// fragment sheet is what the renderer actually throws along its own paths.
{
  const src = PNG.sync.read(readFileSync(join(root, "boss-king-unbind-draft.png")));
  const width = src.width / 2;
  const delivered: PNG[] = [];
  for (let i = 0; i < 2; i++) {
    const mask = panelMask(src, i * width, 0, (i + 1) * width, src.height);
    const fig = bounds(mask, src);
    const frame = sample(src, mask, 1, (fig.minX + fig.maxX) / 2,
      fig.maxY, .26, 256, body);
    deliver(frame, `boss-king/unbind_${i + 1}.png`);
    delivered.push(frame);
  }
  writeFileSync(join(root, "boss-king-unbind.png"), PNG.sync.write(upscale(strip(delivered))));
}

for (const [kind, names, colors] of [
  ["debris", ["pauldron_l", "pauldron_r", "helm", "breastplate_l", "breastplate_r", "cape"], body],
  ["chain", ["link_face", "link_edge", "hook_head"], chainColors],
] as const) {
  const src = PNG.sync.read(readFileSync(join(root, `boss-king-${kind}-draft.png`)));
  const cellWidth = src.width / names.length;
  const delivered: PNG[] = [];
  for (let i = 0; i < names.length; i++) {
    const mask = panelMask(src, i * cellWidth, 0, (i + 1) * cellWidth, src.height);
    const fig = bounds(mask, src);
    const scale = Math.min(kind === "chain" ? .105 : .14,
      50 / (fig.maxX - fig.minX + 1), 50 / (fig.maxY - fig.minY + 1));
    const frame = sample(src, mask, 1, (fig.minX + fig.maxX) / 2,
      (fig.minY + fig.maxY) / 2, scale, 64, colors, 32);
    deliver(frame, `boss-king/${kind}_${names[i]}.png`);
    delivered.push(frame);
  }
  writeFileSync(join(root, `boss-king-${kind}.png`), PNG.sync.write(upscale(strip(delivered))));
}
