/** Prepare the independently drawn reverse-cut keys on the 256 px boss art grid. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const source = join(root, "assets/source/melee/boss-king");
const review = join(root, "art-review/boss-combo-redraw/normalized");
const drafts = join(root, "art-review/boss-combo-redraw/raw");
mkdirSync(review, { recursive: true });
const paletteJson = JSON.parse(readFileSync(join(source, "../boss-king-palette.json"), "utf8")) as {
  ramps: Record<string, string[]>;
};
const palette = Object.entries(paletteJson.ramps).filter(([key]) => key !== "stone")
  .flatMap(([, colors]) => colors)
  .map((hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)));

function box(png: PNG): [number, number, number, number] {
  let x0 = png.width, y0 = png.height, x1 = 0, y1 = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    if (png.data[(y * png.width + x) * 4 + 3]! < 128) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x0 >= x1 || y0 >= y1) throw new Error("empty draft");
  return [x0, y0, x1, y1];
}

function nearest(r: number, g: number, b: number): number[] {
  let chosen = palette[0]!, distance = Infinity;
  for (const color of palette) {
    const score = (r - color[0]!) ** 2 + (g - color[1]!) ** 2 + (b - color[2]!) ** 2;
    if (score < distance) { chosen = color; distance = score; }
  }
  return chosen;
}

function bodyStats(png: PNG): { x: number; area: number } {
  let count = 0, sumX = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    if (png.data[i + 3]! < 200) continue;
    const r = png.data[i]!, g = png.data[i + 1]!, b = png.data[i + 2]!;
    if (b > r + 15 && b > g + 25) continue;
    if (Math.max(r, g, b) - Math.min(r, g, b) < 28 && Math.max(r, g, b) > 120) continue;
    sumX += x; count++;
  }
  return { x: sumX / count, area: count };
}

function normalizeWide(src: PNG, phase: number, size = 336, pivot: [number, number] = [168, 272]): { art: PNG; scale: number; margin: number; bodyArea: number; sourceBodyX: number; sourceFloorY: number } {
  const [x0, y0, x1, y1] = box(src);
  const idle = PNG.sync.read(readFileSync(join(source, `p${phase}/idle0.png`)));
  // The idle body area is counted on its 256px art grid, not the 4x delivery file.
  let idleArea = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = ((y * 4) * idle.width + x * 4) * 4;
    const r = idle.data[i]!, g = idle.data[i + 1]!, b = idle.data[i + 2]!;
    if (idle.data[i + 3]! >= 16 && !(b > r + 15 && b > g + 25)
      && !(Math.max(r, g, b) - Math.min(r, g, b) < 28 && Math.max(r, g, b) > 120)) idleArea++;
  }
  const body = bodyStats(src);
  const scale = Math.sqrt(idleArea / body.area);
  const art = new PNG({ width: size, height: size }); art.data.fill(0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = Math.floor(body.x + (x - pivot[0] + .5) / scale);
    const sy = Math.floor(y1 + (y - pivot[1] + .5) / scale);
    if (sx < 0 || sx >= src.width || sy < 0 || sy >= src.height) continue;
    const si = (sy * src.width + sx) * 4;
    if (src.data[si + 3]! < 200) continue;
    const c = nearest(src.data[si]!, src.data[si + 1]!, src.data[si + 2]!);
    art.data.set([c[0]!, c[1]!, c[2]!, 255], (y * size + x) * 4);
  }
  const margin = Math.min(pivot[0] + (x0 - body.x) * scale, size - (pivot[0] + (x1 - body.x) * scale),
    pivot[1] + (y0 - y1) * scale, size - pivot[1]);
  return { art, scale, margin, bodyArea: bodyStats(art).area, sourceBodyX: body.x, sourceFloorY: y1 };
}

function normalize(src: PNG): { art: PNG; scale: number; bodyCenter: number } {
  const [x0, y0, x1, y1] = box(src);
  // Keep every sword-tip pixel and six art pixels of margin. Character scale
  // is checked separately; fitting an oversized cut should never be silent.
  const scale = Math.min(243 / (x1 - x0 + 1), 214 / (y1 - y0 + 1));
  const width = (x1 - x0 + 1) * scale;
  const left = (256 - width) / 2;
  const floor = 222;
  const art = new PNG({ width: 256, height: 256 }); art.data.fill(0);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const sx = Math.floor(x0 + (x - left + .5) / scale);
    const sy = Math.floor(y1 + (y - floor + .5) / scale);
    if (sx < 0 || sx >= src.width || sy < 0 || sy >= src.height) continue;
    const si = (sy * src.width + sx) * 4;
    if (src.data[si + 3]! < 200) continue;
    const c = nearest(src.data[si]!, src.data[si + 1]!, src.data[si + 2]!);
    art.data.set([c[0]!, c[1]!, c[2]!, 255], (y * 256 + x) * 4);
  }
  // An approximate helm/pelvis center is useful for spotting horizontal
  // drift before any of these keys is approved for the production atlas.
  return { art, scale, bodyCenter: left + (src.width / 2 - x0) * scale };
}

function upscale(art: PNG): PNG {
  const size = art.width * 4;
  const out = new PNG({ width: size, height: size }); out.data.fill(0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const si = (Math.floor(y / 4) * art.width + Math.floor(x / 4)) * 4;
    out.data.set(art.data.subarray(si, si + 4), (y * size + x) * 4);
  }
  return out;
}

function cropFor256(wide: PNG): PNG {
  const out = new PNG({ width: 256, height: 256 }); out.data.fill(0);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const si = ((y + 50) * 336 + x + 40) * 4;
    out.data.set(wide.data.subarray(si, si + 4), (y * 256 + x) * 4);
  }
  return out;
}

const selectedPhase = Number(process.argv.find((arg) => arg.startsWith("--phase="))?.slice(8) ?? 0);
for (const phase of [1, 2, 3].filter((p) => !process.argv.includes("--hook-only") && (!selectedPhase || p === selectedPhase))) for (const pose of [
  ...(phase > 1 ? ["sweep_back_wind", "sweep_back_cross", "sweep_back_cut"] : []),
  "cleave_front_raise", "cleave_front_fall", "cleave_front_cut", "cleave_front_follow",
  "slam_lift", "slam_drive",
]) {
  const edgeDraft = `p${phase}_${pose}_edge_v1.png`;
  const draftName = phase === 3 && process.argv.includes("--use-bare-p3")
      && ["cleave_front_fall", "cleave_front_cut", "cleave_front_follow"].includes(pose)
    ? `p3_${pose}_bare_v1.png`
    : pose.startsWith("cleave_front_") && process.argv.includes("--use-edge-cleave")
      && pose !== "cleave_front_raise" && existsSync(join(drafts, edgeDraft)) ? edgeDraft
    : pose.startsWith("slam_") && process.argv.includes("--use-back-facing-slam")
    ? `p${phase}_${pose}_back_v1.png`
    : `p${phase}_${pose}.png`;
  const src = PNG.sync.read(readFileSync(join(drafts, draftName)));
  const { art, scale, bodyCenter } = normalize(src);
  const target = join(review, `p${phase}_${pose}.png`);
  writeFileSync(target, PNG.sync.write(upscale(art)));
  console.log(`${target}: ${(scale * 100).toFixed(1)}% of draft, approximate center x=${bodyCenter.toFixed(1)}`);
  const wide = normalizeWide(src, phase);
  const wideTarget = join(review, `p${phase}_${pose}_336.png`);
  writeFileSync(wideTarget, PNG.sync.write(upscale(wide.art)));
  console.log(`${wideTarget}: body ${wide.bodyArea}, margin ${wide.margin.toFixed(1)}, scale ${(wide.scale * 100).toFixed(1)}%`);
  if (process.argv.includes("--write-wide") && !pose.startsWith("slam_")
    && (!process.argv.includes("--use-edge-cleave") || pose.startsWith("cleave_front_") && pose !== "cleave_front_raise")) {
    const wideDir = join(source, `wide/p${phase}`);
    mkdirSync(wideDir, { recursive: true });
    writeFileSync(join(wideDir, `${pose}.png`), PNG.sync.write(upscale(wide.art)));
  }
  if (pose.startsWith("slam_")) {
    const fitted = upscale(cropFor256(wide.art));
    const preview = join(review, `p${phase}_${pose}_fit256.png`);
    writeFileSync(preview, PNG.sync.write(fitted));
    if (process.argv.includes("--write"))
      writeFileSync(join(source, `p${phase}/${pose}.png`), PNG.sync.write(fitted));
  }
}

// The lightning invocation has a full-height sword. A 384 px cell preserves
// the idle body's scale and leaves headroom for its tip; the old 256 px draft
// visibly shrank the body, and the 336 px fit clipped the sword at the top.
if (process.argv.includes("--write-storm")) for (const phase of [1, 2, 3]) {
  const src = PNG.sync.read(readFileSync(join(drafts, `p${phase}_lightning_invoke.png`)));
  const fitted = normalizeWide(src, phase, 384, [192, 312]);
  const path = join(source, `wide/p${phase}/storm.png`);
  writeFileSync(path, PNG.sync.write(upscale(fitted.art)));
  console.log(`${path}: body ${fitted.bodyArea}, margin ${fitted.margin.toFixed(1)}, scale ${(fitted.scale * 100).toFixed(1)}%`);
}

// The hook art originally carried a whole outgoing chain and hook. Gameplay
// draws that chain toward its actual target, so bake only the boss pose here.
// These inpainted drafts retain the source canvas composition; resample the
// entire canvas instead of fitting its remaining silhouette and enlarging it.
if (process.argv.includes("--write-hook")) for (const phase of [1, 2, 3]) {
  const src = PNG.sync.read(readFileSync(join(drafts, `p${phase}_hook_no_projectile_v1.png`)));
  const art = new PNG({ width: 256, height: 256 }); art.data.fill(0);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const sx = Math.floor((x + .5) * src.width / 256);
    const sy = Math.floor((y + .5) * src.height / 256);
    const si = (sy * src.width + sx) * 4;
    if (src.data[si + 3]! < 200) continue;
    const c = nearest(src.data[si]!, src.data[si + 1]!, src.data[si + 2]!);
    art.data.set([c[0]!, c[1]!, c[2]!, 255], (y * 256 + x) * 4);
  }
  // Sampling the inpainted outline can open isolated one-pixel seams.
  for (let changed = true; changed;) {
    changed = false;
    for (let y = 1; y < 255; y++) for (let x = 1; x < 255; x++) {
      const i = (y * 256 + x) * 4;
      if (art.data[i + 3]) continue;
      const neighbours = [i - 4, i + 4, i - 256 * 4, i + 256 * 4];
      if (neighbours.filter((j) => art.data[j + 3]! === 255).length >= 3) {
        art.data.set([8, 7, 13, 255], i);
        changed = true;
      }
    }
  }
  const target = join(source, `p${phase}/hook.png`);
  writeFileSync(target, PNG.sync.write(upscale(art)));
  console.log(`${target}: outgoing chain removed at original frame scale`);
}

// Carry the already illustrated first leftward cut onto the same wide art grid
// as the newly drawn rightward return. These frames retain their existing
// character design while the pivot and armour scale cease drifting.
const legacyAnchors = JSON.parse(readFileSync(join(root, "assets/source/melee/boss-king-anchors.json"), "utf8")) as {
  frames: Record<string, { tip: [number, number]; hand_l: [number, number] }>;
};
const wideAnchorFile = join(source, "wide/anchors.json");
const wideAnchors = JSON.parse(readFileSync(wideAnchorFile, "utf8")) as {
  frames: Record<string, { source: string; tip: [number, number]; hand_l: [number, number]; pivot: [number, number] }>;
};
if (process.argv.includes("--write-front")) for (const phase of [2, 3]) for (const pose of [
  "sweep_wind", "sweep_enter", "sweep_mid", "sweep_cut",
]) {
  const original = PNG.sync.read(readFileSync(join(source, `p${phase}/${pose}.png`)));
  const wide = normalizeWide(original, phase);
  const output = join(source, `wide/p${phase}/sweep_front_${pose.replace("sweep_", "")}.png`);
  writeFileSync(output, PNG.sync.write(upscale(wide.art)));
  const key = `boss_p${phase}_sweep_front_${pose.replace("sweep_", "")}`;
  const old = legacyAnchors.frames[`boss_p${phase}_${pose}`]!;
  const transform = ([x, y]: [number, number]): [number, number] => [
    Math.round(168 + (x * 4 - wide.sourceBodyX) * wide.scale),
    Math.round(272 + (y * 4 - wide.sourceFloorY) * wide.scale),
  ];
  wideAnchors.frames[key] = {
    source: `assets/source/melee/boss-king/wide/p${phase}/sweep_front_${pose.replace("sweep_", "")}.png`,
    tip: transform(old.tip), hand_l: transform(old.hand_l), pivot: [168, 272],
  };
  console.log(`${output}: body ${wide.bodyArea}, margin ${wide.margin.toFixed(1)}`);
}
if (process.argv.includes("--write-front")) {
  wideAnchors.frames = Object.fromEntries(Object.entries(wideAnchors.frames)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })));
  writeFileSync(wideAnchorFile, JSON.stringify(wideAnchors, null, 2) + "\n");
}
