/**
 * Decals must be darker than the floor they sit on.
 *
 * A crack in stone is a gap, which is a shadow. Drawn lighter than the floor
 * it reads as **emitting light**, which turns damage into decoration's
 * opposite: the first delivery's cracks were mistaken for lightning bolts,
 * and lightning is an enemy attack. Two things that look alike where one of
 * them kills you is the failure the decal rules exist to prevent.
 *
 * Rubble and bones are exempt: those are objects lying on the floor and
 * legitimately catch light. Everything that represents damage to the floor
 * itself — cracks, stains, scorches — must be darker than it.
 */
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

/** Decals that represent damage to the surface, so must read as shadow. */
const MUST_BE_DARKER = ["deco_crack_", "deco_stain_", "deco_scorch"];

const dir = process.argv[2] ?? "assets";
const sheet = PNG.sync.read(readFileSync(`${dir}/sprites.png`));
const sj = JSON.parse(readFileSync(`${dir}/sprites.json`, "utf8")) as {
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
};

/** Mean luminance of a frame's sufficiently opaque pixels. */
function luminance(name: string): { mean: number; opaque: number } {
  const f = sj.frames[name];
  if (!f) return { mean: NaN, opaque: 0 };
  let sum = 0, n = 0;
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const i = ((f.y + y) * sheet.width + (f.x + x)) << 2;
      if (sheet.data[i + 3]! < 160) continue;
      sum += 0.2126 * sheet.data[i]! + 0.7152 * sheet.data[i + 1]! + 0.0722 * sheet.data[i + 2]!;
      n++;
    }
  return { mean: n === 0 ? NaN : sum / n, opaque: n };
}

const floors = Object.keys(sj.frames).filter((k) => k.startsWith("tile_floor_"));
if (floors.length === 0) {
  console.error("no floor tiles to compare against");
  process.exit(2);
}
const floorMean = floors.reduce((s, k) => s + luminance(k).mean, 0) / floors.length;
console.log(`floor luminance, mean over ${floors.length} tiles: ${floorMean.toFixed(1)}\n`);

let fail = 0;
for (const name of Object.keys(sj.frames).filter((k) => k.startsWith("deco_")).sort()) {
  const { mean, opaque } = luminance(name);
  if (opaque === 0) { console.log(`  ----  ${name.padEnd(16)} empty`); continue; }
  const checked = MUST_BE_DARKER.some((p) => name.startsWith(p));
  const ok = !checked || mean < floorMean;
  if (!ok) fail++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(16)} luminance ${mean.toFixed(1).padStart(6)}  ` +
    (checked
      ? ok ? `darker than the floor by ${(floorMean - mean).toFixed(1)}` : `BRIGHTER than the floor by ${(mean - floorMean).toFixed(1)} — reads as light, not damage`
      : "object on the floor, not checked"),
  );
}
console.log(fail === 0 ? "\ndecals: OK" : `\ndecals: ${fail} read as light rather than as damage`);
process.exit(fail === 0 ? 0 : 1);
