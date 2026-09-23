/**
 * Measures the angular extent of a delivered arc sheet against the hitbox.
 *
 * The rule this enforces is that **the hitbox must never be narrower than the
 * visual**. A crescent wider than the sector that actually connects produces
 * the worst complaint an action game can earn — "that clearly hit and did
 * nothing" — and it is invisible in review because a still image of a wide
 * crescent looks better than a still image of a narrow one.
 *
 * Usage: check-arc-art <sheet.png> [cols] [rows]
 */
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { ARC_DEG } from "@jr/core";

const path = process.argv[2];
if (!path) {
  console.error("usage: check-arc-art <sheet.png> [cols] [rows]");
  process.exit(2);
}
const COLS = Number(process.argv[3] ?? 3);
const ROWS = Number(process.argv[4] ?? 3);
/** A crescent may read a little wider than the sector; more than this is a bug. */
const TOLERANCE_DEG = 12;

const img = PNG.sync.read(readFileSync(path));
const cw = Math.floor(img.width / COLS);
const ch = Math.floor(img.height / ROWS);
console.log(`${path}: ${img.width}x${img.height}, ${COLS}x${ROWS} cells of ${cw}x${ch}`);
console.log(`hitbox arc is ${ARC_DEG} degrees; a sweep cell may measure up to ${ARC_DEG + TOLERANCE_DEG}\n`);

let bad = 0;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const cx = c * cw + cw / 2;
    const cy = r * ch + ch / 2;
    const angles: number[] = [];
    let minR = Infinity, maxR = 0, opaque = 0;
    for (let y = r * ch; y < (r + 1) * ch; y++) {
      for (let x = c * cw; x < (c + 1) * cw; x++) {
        if (img.data[((y * img.width + x) << 2) + 3]! < 128) continue;
        opaque++;
        const d = Math.hypot(x - cx, y - cy);
        if (d < 2) continue;
        if (d < minR) minR = d;
        if (d > maxR) maxR = d;
        angles.push(Math.atan2(y - cy, x - cx));
      }
    }
    if (angles.length === 0) { console.log(`  [${r},${c}] empty`); continue; }

    // Extent is a full turn minus the widest gap between occupied angles.
    const s = angles.map((a) => (a + Math.PI * 2) % (Math.PI * 2)).sort((p, q) => p - q);
    let gap = s[0]! + Math.PI * 2 - s[s.length - 1]!;
    for (let i = 1; i < s.length; i++) gap = Math.max(gap, s[i]! - s[i - 1]!);
    const extent = 360 - (gap * 180) / Math.PI;

    // A radial burst legitimately fills the circle; only sweeps are checked.
    const radial = extent > 300;
    const over = !radial && extent > ARC_DEG + TOLERANCE_DEG;
    if (over) bad++;
    console.log(
      `  [${r},${c}] extent ${extent.toFixed(0).padStart(4)} deg  ` +
      `radius ${minR === Infinity ? "-" : minR.toFixed(0)}..${maxR.toFixed(0)} of ${(cw / 2).toFixed(0)}  ` +
      `${radial ? "radial, not checked" : over ? `TOO WIDE by ${(extent - ARC_DEG).toFixed(0)}` : "ok"}`,
    );
  }
}
console.log(bad === 0 ? "\narc art: OK" : `\narc art: ${bad} cell(s) wider than the hitbox`);
process.exit(bad === 0 ? 0 : 1);
