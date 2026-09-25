/** Normalize the B8 model drawings onto the shared art-pixel grid. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const melee = fileURLToPath(new URL("../../../../assets/source/melee/", import.meta.url));
const originals = fileURLToPath(new URL("../../../../assets/source/originals/", import.meta.url));
const palette = JSON.parse(readFileSync(join(melee, "boss-king-palette.json"), "utf8"));
const colors: [number, number, number][] = Object.entries(palette.ramps)
  .filter(([r]) => r !== "stone")
  .flatMap(([, ramp]) => (ramp as string[]).map((h) => [
    parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
  ] as [number, number, number]));

type Rect = readonly [number, number, number, number];
interface Figure { id: number; area: number; box: Rect }
function figures(src: PNG, minArea = 5000): { labels: Uint16Array; parts: Figure[] } {
  const labels = new Uint16Array(src.width * src.height), parts: Figure[] = [];
  let next = 0;
  for (let p = 0; p < labels.length; p++) {
    if (labels[p] || src.data[p * 4 + 3]! < 220) continue;
    const id = ++next, stack = [p]; labels[p] = id;
    let area = 0, x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
    while (stack.length) {
      const n = stack.pop()!, x = n % src.width, y = Math.floor(n / src.width);
      area++; x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      for (const [dx, dy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]] as const) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= src.width || yy < 0 || yy >= src.height) continue;
        const q = yy * src.width + xx;
        if (labels[q] || src.data[q * 4 + 3]! < 220) continue;
        labels[q] = id; stack.push(q);
      }
    }
    if (area >= minArea) parts.push({ id, area, box: [x0, y0, x1 + 1, y1 + 1] });
  }
  return { labels, parts };
}
function union(parts: readonly Figure[]): Rect {
  return [Math.min(...parts.map((f) => f.box[0])), Math.min(...parts.map((f) => f.box[1])),
    Math.max(...parts.map((f) => f.box[2])), Math.max(...parts.map((f) => f.box[3]))];
}
function bounds(src: PNG, rect: Rect): Rect {
  let x0 = rect[2], y0 = rect[3], x1 = rect[0] - 1, y1 = rect[1] - 1;
  for (let y = rect[1]; y < rect[3]; y++) for (let x = rect[0]; x < rect[2]; x++) {
    if (src.data[(y * src.width + x) * 4 + 3]! < 220) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x1 < x0 || y1 < y0) throw new Error(`empty panel ${rect}`);
  return [x0, y0, x1 + 1, y1 + 1];
}
function panel(src: PNG, col: number, row: number, cols: number, rows: number): Rect {
  return [Math.floor(col * src.width / cols), Math.floor(row * src.height / rows),
    Math.floor((col + 1) * src.width / cols), Math.floor((row + 1) * src.height / rows)];
}
function nearest(r: number, g: number, b: number): [number, number, number] {
  let color = colors[0]!, d0 = Infinity;
  for (const c of colors) {
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < d0) { d0 = d; color = c; }
  }
  return color;
}
function draw(src: PNG, crop: Rect, size: readonly [number, number],
  scale: number, origin: readonly [number, number], target: readonly [number, number],
  selection?: { labels: Uint16Array; ids: ReadonlySet<number> }): PNG {
  const out = new PNG({ width: size[0], height: size[1] }); out.data.fill(0);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const sx = Math.floor(origin[0] + (x + .5 - target[0]) / scale);
    const sy = Math.floor(origin[1] + (y + .5 - target[1]) / scale);
    if (sx < crop[0] || sx >= crop[2] || sy < crop[1] || sy >= crop[3]) continue;
    const s = (sy * src.width + sx) * 4;
    if (src.data[s + 3]! < 220) continue;
    if (selection && !selection.ids.has(selection.labels[sy * src.width + sx]!)) continue;
    const d = (y * out.width + x) * 4;
    const c = nearest(src.data[s]!, src.data[s + 1]!, src.data[s + 2]!);
    out.data.set([...c, 255], d);
  }
  return out;
}
function writeArt(path: string, art: PNG): void {
  const out = new PNG({ width: art.width * 4, height: art.height * 4 }); out.data.fill(0);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const s = (Math.floor(y / 4) * art.width + Math.floor(x / 4)) * 4;
    out.data.set(art.data.subarray(s, s + 4), (y * out.width + x) * 4);
  }
  writeFileSync(path, PNG.sync.write(out));
}
function sheet(cells: PNG[], cols: number): PNG {
  const w = cells[0]!.width, h = cells[0]!.height;
  const out = new PNG({ width: w * cols, height: h * Math.ceil(cells.length / cols) }); out.data.fill(0);
  cells.forEach((cell, i) => {
    const ox = (i % cols) * w, oy = Math.floor(i / cols) * h;
    for (let y = 0; y < h; y++)
      out.data.set(cell.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * out.width + ox) * 4);
  });
  return out;
}
function flipX(src: PNG): PNG {
  const out = new PNG({ width: src.width, height: src.height });
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++)
    out.data.set(src.data.subarray((y * src.width + x) * 4, (y * src.width + x + 1) * 4),
      (y * src.width + src.width - 1 - x) * 4);
  return out;
}

for (const p of [1, 2, 3]) {
  const src = PNG.sync.read(readFileSync(join(melee, `boss-king-p${p}-identity-draft.png`)));
  const box = bounds(src, [0, 0, src.width, src.height]);
  const scale = Math.min(236 / (box[2] - box[0]), 200 / (box[3] - box[1]));
  const identity = draw(src, [0, 0, src.width, src.height], [256, 256], scale,
    [(box[0] + box[2]) / 2, box[3]], [128, 224]);
  writeArt(join(originals, `boss-king-p${p}.png`), identity);
  console.log(`p${p} identity ${scale.toFixed(3)} × ${box}`);

  const arms = PNG.sync.read(readFileSync(join(melee, `boss-king-p${p}-arms-draft.png`)));
  const armComponents = figures(arms);
  const splitY = arms.height * .5;
  const upper = armComponents.parts.filter((f) => (f.box[1] + f.box[3]) / 2 < splitY)
    .sort((a, b) => a.box[0] - b.box[0]);
  const lower = armComponents.parts.filter((f) => (f.box[1] + f.box[3]) / 2 >= splitY);
  if (upper.length !== 5) throw new Error(`p${p} upper arms: expected 5, found ${upper.length}`);
  const thresholds = p === 2 ? [330, 725, 1025, 1350] : p === 3 ? [375, 875, 1150, 1470] : [370, 840, 1155, 1438];
  const lowerGroups = Array.from({ length: 5 }, () => [] as Figure[]);
  for (const f of lower) {
    const cx = (f.box[0] + f.box[2]) / 2;
    let k = 0; while (k < 4 && cx >= thresholds[k]!) k++;
    lowerGroups[k]!.push(f);
  }
  if (lowerGroups.some((g) => !g.length)) throw new Error(`p${p} arms: empty lower pose`);
  const groups = [...upper.map((f) => [f]), ...lowerGroups];
  const armCells: PNG[] = [];
  for (let i = 0; i < 10; i++) {
    const group = groups[i]!, b = union(group);
    // Keep the panel's shoulder coordinates, rather than centring each pose's
    // hand. The raised and flung fists then stay attached to the same torso.
    const localShoulder = p === 1 ? 130 : p === 2 ? 155 : 150;
    const factor = Math.min(.42, 234 / (b[2] - b[0]), 214 / (b[3] - b[1]));
    const painted = draw(arms, b, [256, 256], factor,
      [(b[0] + b[2]) / 2, (i < 5 ? 0 : splitY) + localShoulder], [128, 74],
      { labels: armComponents.labels, ids: new Set(group.map((g) => g.id)) });
    // The phase-II draft placed its forward cut to image-left while I and III
    // place it right. Normalise the authored facing before the game mirrors.
    const f = p === 2 && i === 3 ? flipX(painted) : painted;
    armCells.push(f);
    writeArt(join(melee, `boss-king/p${p}/arm_${i}.png`), f);
  }
  writeArt(join(melee, `boss-king-p${p}-arms.png`), sheet(armCells, 5));

  const keys = PNG.sync.read(readFileSync(join(melee, `boss-king-p${p}-keys-draft.png`)));
  const keyComponents = figures(keys).parts.sort((a, b) => a.box[0] - b.box[0]);
  if (keyComponents.length !== 4) throw new Error(`p${p} keys: expected 4, found ${keyComponents.length}`);
  const keyNames = ["kneel", "crouch", "air", "stagger"];
  const keyCells: PNG[] = [];
  for (let i = 0; i < 4; i++) {
    const chosen = keyComponents[i]!, b = chosen.box;
    const factor = Math.min(238 / (b[2] - b[0]), 202 / (b[3] - b[1]));
    const f = draw(keys, b, [256, 256], factor,
      [(b[0] + b[2]) / 2, b[3]], [128, i === 2 ? 218 : 224],
      { labels: figures(keys).labels, ids: new Set([chosen.id]) });
    keyCells.push(f);
    writeArt(join(melee, `boss-king/p${p}/model_${keyNames[i]}.png`), f);
  }
  writeArt(join(melee, `boss-king-p${p}-keys.png`), sheet(keyCells, 4));
}

const sword = PNG.sync.read(readFileSync(join(melee, "boss-king-sword-draft.png")));
const sb = bounds(sword, [0, 0, sword.width, sword.height]);
const swordScale = Math.min(48 / (sb[2] - sb[0]), 170 / (sb[3] - sb[1]));
writeArt(join(melee, "boss-king-sword.png"), draw(sword,
  [0, 0, sword.width, sword.height], [64, 192], swordScale,
  [(sb[0] + sb[2]) / 2, sb[3]], [32, 182]));
console.log(`sword art scale ${swordScale.toFixed(3)}, grip approximately [32, 158]`);

const fists = PNG.sync.read(readFileSync(join(melee, "boss-king-fists-draft.png")));
const fistCells: PNG[] = [];
for (let p = 0; p < 3; p++) {
  const cell = panel(fists, p, 0, 3, 2), b = bounds(fists, cell);
  const factor = Math.min(25 / (b[2] - b[0]), 25 / (b[3] - b[1]));
  const f = draw(fists, cell, [64, 64], factor,
    [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], [32, 32]);
  fistCells.push(f);
  writeArt(join(melee, `boss-king/fist_p${p + 1}.png`), f);
}
writeArt(join(melee, "boss-king-fists.png"), sheet(fistCells, 3));
