/** Paint the previously occluded torso under B8's independently moving arms. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const dir = fileURLToPath(new URL("../../../../assets/source/melee/", import.meta.url));
const palette = JSON.parse(readFileSync(join(dir, "boss-king-palette.json"), "utf8"));
const colours: number[][] = Object.entries(palette.ramps)
  .filter(([r]) => r !== "stone")
  .flatMap(([, v]) => (v as string[]).map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))));

for (const phase of [1, 2, 3]) {
  const src = PNG.sync.read(readFileSync(join(dir, `boss-king-p${phase}-torso-draft.png`)));
  let x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    if (src.data[(y * src.width + x) * 4 + 3]! < 220) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x1 < x0) throw new Error(`p${phase}: empty torso`);
  const targetHeight = phase === 3 ? 91 : 100;
  const scale = Math.min(104 / (x1 - x0 + 1), targetHeight / (y1 - y0 + 1));
  const top = phase === 3 ? 52 : 43;
  const cell = new PNG({ width: 1024, height: 1024 }); cell.data.fill(0);
  for (let ay = 0; ay < 256; ay++) for (let ax = 0; ax < 256; ax++) {
    const sx = Math.floor((x0 + x1) / 2 + (ax + .5 - 128) / scale);
    const sy = Math.floor(y0 + (ay + .5 - top) / scale);
    if (sx < x0 || sx > x1 || sy < y0 || sy > y1) continue;
    const source = (sy * src.width + sx) * 4;
    if (src.data[source + 3]! < 220) continue;
    const colour = colours.reduce((best, next) => {
      const d = (c: number[]) => c.reduce((sum, v, i) => sum + (v - src.data[source + i]!) ** 2, 0);
      return d(next) < d(best) ? next : best;
    }, colours[0]!);
    for (let yy = ay * 4; yy < ay * 4 + 4; yy++) for (let xx = ax * 4; xx < ax * 4 + 4; xx++)
      cell.data.set([...colour, 255], (yy * cell.width + xx) * 4);
  }
  writeFileSync(join(dir, `boss-king/p${phase}/model_torso.png`), PNG.sync.write(cell));
  console.log(`p${phase} torso: ${scale.toFixed(3)}x, art y${top}–${top + Math.round((y1 - y0 + 1) * scale)}`);
}
