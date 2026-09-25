/**
 * A contact sheet of a sprite model, for review by eye (doc 016).
 *
 * One row per facing: every frame the model delivers, in `anims.json` order,
 * at 4×. With `--poses a,b,c` it shows those poses instead; with `--against`
 * each pose is followed by the delivered frame it replaces and a difference
 * image (red where only the delivered frame has a pixel, cyan where only the model does,
 * yellow where both do in different colours). `--parts` adds the part map:
 * each placed part in its own colour.
 *
 * Run: `pnpm sprite:preview <body> [--poses stand,walk0] [--against] [--parts] [--zoom 4] [--delivery] [--out file.png]`
 */
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { deliveredFrame } from "../assets/art.ts";
import { MANIFEST } from "../assets/manifest.ts";
import { compose, loadModel, toPng, type Composed, type Facing } from "../assets/models.ts";

const args = process.argv.slice(2);
const body = args[0];
if (!body) throw new Error("usage: sprite-preview <body> [--poses a,b] [--against] [--parts] [--zoom n] [--out file]");
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const Z = Number(opt("--zoom") ?? 4);
const out = opt("--out") ?? `${process.env.TMPDIR ?? "/tmp"}/sprite-${body}.png`;
const against = args.includes("--against");
const showParts = args.includes("--parts");
const delivery = args.includes("--delivery");
const only = opt("--facings")?.split(",") as Facing[] | undefined;

const model = loadModel(body);
/** The delivered frame a pose stands in for, as the sheets make it. */
function delivered(name: string): PNG | null {
  const spec = MANIFEST.find((f) => f.name === name);
  try { return spec ? deliveredFrame(spec) : null; } catch { return null; }
}

const PART_COLOURS = [[230, 90, 90], [90, 200, 110], [90, 140, 240], [240, 200, 70], [200, 110, 230], [80, 210, 220], [240, 150, 60], [160, 160, 160]];
function partImage(c: Composed): PNG {
  const png = new PNG({ width: c.w, height: c.h });
  png.data.fill(0);
  const names = [...new Set(model.rig.facings.s.parts.map((p) => p.name))];
  for (const p of [...c.placed].sort((a, b) => a.depth - b.depth)) {
    const col = PART_COLOURS[names.indexOf(p.part) % PART_COLOURS.length]!;
    const d = p.drawing;
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
      const s = d.px[y * d.w + x];
      const fx = p.x + x, fy = p.y + y;
      if (!s || fx < 0 || fy < 0 || fx >= c.w || fy >= c.h) continue;
      const shade = s.material === "outline" ? 0.45 : 1;
      png.data.set([col[0]! * shade, col[1]! * shade, col[2]! * shade, 255], (fy * c.w + fx) * 4);
    }
  }
  return png;
}

function diffImage(a: PNG, b: PNG): PNG {
  const png = new PNG({ width: a.width, height: a.height });
  png.data.fill(0);
  for (let i = 0; i < a.data.length; i += 4) {
    const pa = a.data[i + 3]! > 0, pb = b.data[i + 3]! > 0;
    if (pa && !pb) png.data.set([235, 60, 60, 255], i);
    else if (!pa && pb) png.data.set([60, 220, 235, 255], i);
    else if (pa && pb) {
      const same = Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) + Math.abs(a.data[i + 2]! - b.data[i + 2]!) < 60;
      png.data.set(same ? [70, 66, 90, 255] : [235, 210, 60, 255], i);
    }
  }
  return png;
}

const rows: PNG[][] = [];
const facings = (only ?? model.anims.facings) as Facing[];
for (const facing of facings) {
  const poses = opt("--poses")?.split(",")
    ?? Object.values(model.anims.frames);
  const names = opt("--poses") ? null : Object.keys(model.anims.frames).map((t) => t.replace("{f}", facing));
  const row: PNG[] = [];
  poses.forEach((pose, i) => {
    const c = compose(model, facing, pose);
    const png = toPng(model, c);
    row.push(png);
    if (showParts) row.push(partImage(c));
    if (against) {
      const name = names?.[i] ?? `${body}_${facing}_${pose === "stand" ? "idle0" : pose}`;
      const ref = delivered(name);
      if (ref) row.push(ref, diffImage(ref, png));
    }
  });
  rows.push(row);
}

// A row of twenty-four frames is unreadable at 4x, so a row wraps: with
// `--cols` each facing's frames run over as many lines as they need, which is
// how a cycle is judged — frames side by side, spacing compared.
const wrap = Number(opt("--cols") ?? 0);
if (wrap > 0) {
  const wrapped: PNG[][] = [];
  for (const row of rows) for (let i = 0; i < row.length; i += wrap) wrapped.push(row.slice(i, i + wrap));
  rows.length = 0;
  rows.push(...wrapped);
}

const gap = delivery ? 0 : 6;
const cellW = Math.max(...rows.flat().map((p) => p.width)) * Z + gap;
const cellH = Math.max(...rows.flat().map((p) => p.height)) * Z + gap;
const cols = Math.max(...rows.map((r) => r.length));
const sheet = new PNG({ width: cols * cellW, height: rows.length * cellH });
if (!delivery) for (let i = 0; i < sheet.data.length; i += 4) sheet.data.set([38, 34, 56, 255], i);
rows.forEach((row, r) => row.forEach((png, c) => {
  for (let y = 0; y < png.height * Z; y++) for (let x = 0; x < png.width * Z; x++) {
    const si = (((y / Z) | 0) * png.width + ((x / Z) | 0)) * 4;
    if (!png.data[si + 3]) continue;
    sheet.data.set(png.data.subarray(si, si + 4), ((r * cellH + y) * sheet.width + c * cellW + x) * 4);
  }
}));
writeFileSync(out, PNG.sync.write(sheet));
console.log(`${rows.flat().length} images → ${out}`);
