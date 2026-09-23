/**
 * Validates a swing-strip delivery against what the renderer does with it.
 *
 * Four properties, each of which the renderer depends on and none of which is
 * visible by looking at the strip:
 *
 * - **It tiles.** A spin repeats the strip around the circle, so the left edge
 *   column must join the right edge column invisibly.
 * - **Its cross-section is symmetric.** Alternate strikes sweep the other way,
 *   which flips the renderer's idea of which side faces outward; an
 *   asymmetric cross-section turns inside out on every second swing.
 * - **It is uniform along its length.** The fade from the bright leading edge
 *   to the faint tail is applied per point by the renderer, so a gradient in
 *   the texture is applied twice.
 * - **It fills its height.** The renderer maps the full texture height onto
 *   the crescent's radial depth, so vertical margin is not margin: it is
 *   transparent padding inside the crescent.
 */
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

const path = process.argv[2];
if (!path) {
  console.error("usage: check-swing-strip <strip.png>");
  process.exit(2);
}
const img = PNG.sync.read(readFileSync(path));
const px = (x: number, y: number): number[] => {
  const i = (y * img.width + x) << 2;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
};
const worst = (a: number[], b: number[]): number =>
  Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

console.log(`${path}: ${img.width}x${img.height}`);
let fail = 0;
const report = (ok: boolean, label: string, detail: string): void => {
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(20)} ${detail}`);
};

// Tiling.
let seamWorst = 0;
for (let y = 0; y < img.height; y++) seamWorst = Math.max(seamWorst, worst(px(0, y), px(img.width - 1, y)));
report(seamWorst < 24, "tiles left to right", `worst edge-column difference ${seamWorst}, limit 24`);

// Symmetry about the horizontal centre line.
let asym = 0, samples = 0;
for (let y = 0; y < Math.floor(img.height / 2); y++)
  for (let x = 0; x < img.width; x += 7) { asym += worst(px(x, y), px(x, img.height - 1 - y)); samples++; }
const asymMean = asym / Math.max(1, samples);
report(asymMean < 20, "symmetric section", `mean mirrored difference ${asymMean.toFixed(1)}, limit 20`);

// Uniformity along the length.
const col: number[] = [];
for (let x = 0; x < img.width; x++) {
  let sum = 0;
  for (let y = 0; y < img.height; y++) sum += px(x, y)[3]!;
  col.push(sum / img.height);
}
const q = img.width >> 2;
const first = col.slice(0, q).reduce((s, v) => s + v, 0) / q;
const last = col.slice(-q).reduce((s, v) => s + v, 0) / q;
report(Math.abs(first - last) < 12, "uniform lengthwise", `first quarter ${first.toFixed(0)} against last ${last.toFixed(0)}, limit 12`);

// Vertical fill.
let top = img.height, bot = -1;
for (let y = 0; y < img.height; y++)
  for (let x = 0; x < img.width; x++)
    if (px(x, y)[3]! > 32) { if (y < top) top = y; if (y > bot) bot = y; break; }
const fill = bot < 0 ? 0 : ((bot - top + 1) / img.height) * 100;
report(fill > 88, "fills its height", `band covers ${fill.toFixed(0)}% of the frame, minimum 88%`);

console.log(fail === 0 ? "\nswing strip: OK" : `\nswing strip: ${fail} check(s) failed`);
process.exit(fail === 0 ? 0 : 1);
