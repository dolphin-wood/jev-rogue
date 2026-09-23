/**
 * Writes every code-drawn effect sheet (`packages/game/src/fx/sheets.ts`) to
 * one PNG, scaled up, frames in rows, so the drawings can be judged without
 * starting the game.
 *
 * Run: `pnpm fx:preview [out.png]`
 */
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { bakeSheets } from "../../../game/src/fx/sheets.ts";
import { MUSKET_RANGE, MUSKET_SPREAD_DEG } from "@jr/core";

const out = process.argv[2] ?? "fx-preview.png";
const S = 4;
const PAD = 6;
const sheets = bakeSheets({ blastLen: Math.round(MUSKET_RANGE * 2), blastSpreadDeg: MUSKET_SPREAD_DEG });
const rowW = sheets.map((s) => s.frames.reduce((t, f) => t + f.w * S + PAD, PAD));
const rowH = sheets.map((s) => Math.max(...s.frames.map((f) => f.h)) * S + PAD);
const W = Math.max(...rowW);
const H = rowH.reduce((a, b) => a + b, PAD);
const png = new PNG({ width: W, height: H });
for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 44; png.data[i + 1] = 40; png.data[i + 2] = 72; png.data[i + 3] = 255; }
let y0 = PAD;
sheets.forEach((s, r) => {
  let x0 = PAD;
  for (const f of s.frames) {
    for (let y = 0; y < f.h * S; y++)
      for (let x = 0; x < f.w * S; x++) {
        const si = (Math.floor(y / S) * f.w + Math.floor(x / S)) * 4;
        if (f.data[si + 3] === 0) continue;
        const di = ((y0 + y) * W + x0 + x) * 4;
        png.data.set(f.data.subarray(si, si + 4), di);
      }
    x0 += f.w * S + PAD;
  }
  y0 += rowH[r]!;
});
writeFileSync(out, PNG.sync.write(png));
console.log(`${sheets.length} sheets → ${out}`);
