/** A one-pixel inhale drawn inside the king's planted idle silhouette. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = fileURLToPath(new URL("../../../../assets/source/melee/boss-king/", import.meta.url));
const palette = JSON.parse(readFileSync(new URL("../../../../assets/source/melee/boss-king-palette.json", import.meta.url), "utf8")) as {
  ramps: { heart: string[] };
};
const heart = palette.ramps.heart.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
type Ellipse = readonly [x: number, y: number, radiusX: number, radiusY: number, lift: number];
const regions: Record<1 | 2 | 3, { motion: Ellipse[]; core: readonly [number, number, number, number] }> = {
  1: { motion: [[92, 78, 23, 27, 2], [161, 78, 23, 27, 2], [127, 92, 26, 22, 1]], core: [116, 78, 141, 108] },
  2: { motion: [[102, 94, 19, 26, 2], [153, 94, 19, 26, 2], [127, 101, 25, 23, 1]], core: [115, 80, 141, 118] },
  3: { motion: [[109, 91, 23, 17, 2], [145, 91, 23, 17, 2], [127, 105, 27, 20, 1]], core: [113, 80, 144, 119] },
};

function artPixel(image: PNG, x: number, y: number): Uint8Array {
  const i = (((y * 4) + 2) * image.width + x * 4 + 2) * 4;
  return image.data.subarray(i, i + 4);
}

function inhale(phase: 1 | 2 | 3): void {
  const base = PNG.sync.read(readFileSync(join(root, `p${phase}/idle0.png`)));
  if (base.width !== 1024 || base.height !== 1024) throw new Error(`p${phase}: expected 1024px idle0`);
  const art = new PNG({ width: 256, height: 256 });
  let changed = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const own = artPixel(base, x, y);
    let color: Uint8Array | number[] = own;
    let lift = 0;
    for (const [cx, cy, rx, ry, maximum] of regions[phase].motion) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d < 1) lift = Math.max(lift, d < .5 ? maximum : 1);
    }
    if (lift && own[3]! >= 128 && y + lift < 256) {
      const raised = artPixel(base, x, y + lift);
      // Keep every outer contour pixel, cape, crown, sword and foot fixed.
      if (raised[3]! >= 128) color = raised;
    }
    const [left, top, right, bottom] = regions[phase].core;
    if (x >= left && x <= right && y >= top && y <= bottom && own[3]! >= 128) {
      const shade = heart.findIndex((rgb) => rgb.every((channel, i) => channel === color[i]));
      if (shade >= 0 && shade < heart.length - 1) color = [...heart[shade + 1]!, 255];
    }
    const i = (y * 256 + x) * 4;
    art.data.set(color, i);
    if (art.data[i]! !== own[0] || art.data[i + 1]! !== own[1] || art.data[i + 2]! !== own[2]) changed++;
    if (art.data[i + 3]! !== own[3]) throw new Error(`p${phase}: altered outline at ${x},${y}`);
  }
  const out = new PNG({ width: 1024, height: 1024 });
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    const i = ((y >> 2) * 256 + (x >> 2)) * 4;
    out.data.set(art.data.subarray(i, i + 4), (y * 1024 + x) * 4);
  }
  // idle3 is the same high point of the two-beat loop if that key is packed later.
  for (const pose of ["idle1", "idle3"])
    writeFileSync(join(root, `p${phase}/${pose}.png`), PNG.sync.write(out));
  console.log(`p${phase}: ${changed} interior art pixels changed; alpha silhouette unchanged`);
}

for (const phase of [1, 2, 3] as const) inhale(phase);
