/** Normalize the painted two-handed boss action keys to the 256px boss grid. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const dir = fileURLToPath(new URL("../../../../assets/source/melee/", import.meta.url));
const ramps = JSON.parse(readFileSync(join(dir, "boss-king-palette.json"), "utf8")).ramps as Record<string, string[]>;
const colors = Object.entries(ramps).filter(([name]) => name !== "stone")
  .flatMap(([, ramp]) => ramp.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))));

for (const phase of [1, 2, 3]) for (const pose of [
  ...["enter", "cross", "mid", "reset", ...(phase === 1 ? [] : ["wind"])].map((key) => `sweep_${key}`),
  ...["raise", "fall", "cut", "hold"].map((key) => `cleave_${key}`),
  "dash_cut", "dash_skid", "recover",
]) {
  const src = PNG.sync.read(readFileSync(join(dir, `boss-king-p${phase}-${pose.replaceAll("_", "-")}-draft.png`)));
  const solid = (i: number) => src.data[i + 3]! >= 220 &&
    Math.max(src.data[i]!, src.data[i + 1]!, src.data[i + 2]!) >= 38;
  let left = src.width, top = src.height, right = -1, bottom = -1;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    if (!solid((y * src.width + x) * 4)) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error(`p${phase}: empty ${pose} drawing`);
  const scale = Math.min(240 / (right - left + 1), 208 / (bottom - top + 1));
  const cx = (left + right) / 2;
  const art = new PNG({ width: 256, height: 256 }); art.data.fill(0);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const sx = Math.floor(cx + (x + .5 - 128) / scale);
    const sy = Math.floor(bottom + (y + .5 - 224) / scale);
    if (sx < 0 || sx >= src.width || sy < 0 || sy >= src.height) continue;
    const source = (sy * src.width + sx) * 4;
    if (!solid(source)) continue;
    const colour = colors.reduce((best, next) => {
      const distance = (c: number[]) => c.reduce((d, channel, i) => d + (channel - src.data[source + i]!) ** 2, 0);
      return distance(next) < distance(best) ? next : best;
    }, colors[0]!);
    art.data.set([...colour, 255], (y * 256 + x) * 4);
  }
  const out = new PNG({ width: 1024, height: 1024 }); out.data.fill(0);
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    const i = (Math.floor(y / 4) * 256 + Math.floor(x / 4)) * 4;
    out.data.set(art.data.subarray(i, i + 4), (y * 1024 + x) * 4);
  }
  writeFileSync(join(dir, `boss-king/p${phase}/${pose}.png`), PNG.sync.write(out));
  console.log(`p${phase} ${pose}: ${scale.toFixed(3)}x`);
}
