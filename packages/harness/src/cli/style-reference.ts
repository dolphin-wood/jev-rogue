/**
 * Extracts frames from the shipped sheet into a reference strip.
 *
 * The delivered art is smooth-drawn but lives at 64 px, which at that size
 * reads as pixel art. Asking a generator to "draw a sword fighter" produces
 * something in its own style at its own resolution; asking it to *edit an
 * attached strip* is what preserved the style the first time. This produces
 * that attachment.
 *
 * Two outputs: one at native size, which is what a generator should edit, and
 * one upscaled with nearest-neighbour, which is for a human to look at.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const NAMES = (process.argv[2] ?? "player_s_idle0,player_n_idle0,player_w_idle0").split(",");
const sheet = PNG.sync.read(readFileSync("assets/sprites.png"));
const sj = JSON.parse(readFileSync("assets/sprites.json", "utf8")) as {
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
};

function strip(scale: number, opaqueBackground: boolean): PNG {
  const cell = 64 * scale;
  const out = new PNG({ width: cell * NAMES.length, height: cell });
  if (opaqueBackground) {
    for (let i = 0; i < out.data.length; i += 4) {
      out.data[i] = 12; out.data[i + 1] = 11; out.data[i + 2] = 31; out.data[i + 3] = 255;
    }
  }
  NAMES.forEach((name, idx) => {
    const f = sj.frames[name];
    if (!f) { console.log(`missing frame: ${name}`); return; }
    for (let y = 0; y < f.h * scale; y++) {
      for (let x = 0; x < f.w * scale; x++) {
        const si = ((f.y + Math.floor(y / scale)) * sheet.width + (f.x + Math.floor(x / scale))) * 4;
        const di = (y * out.width + (idx * cell + x)) * 4;
        const a = sheet.data[si + 3]! / 255;
        if (a <= 0) continue;
        if (opaqueBackground) {
          for (let c = 0; c < 3; c++)
            out.data[di + c] = Math.round(sheet.data[si + c]! * a + out.data[di + c]! * (1 - a));
        } else {
          for (let c = 0; c < 4; c++) out.data[di + c] = sheet.data[si + c]!;
        }
      }
    }
  });
  return out;
}

writeFileSync("assets/source/style-reference.png", PNG.sync.write(strip(1, false)));
writeFileSync("assets/source/style-reference-x4.png", PNG.sync.write(strip(4, true)));
console.log(`assets/source/style-reference.png     native 64px, transparent, for the generator to edit`);
console.log(`assets/source/style-reference-x4.png  4x nearest, opaque, for a human to review`);
console.log(`frames: ${NAMES.join(", ")}`);
