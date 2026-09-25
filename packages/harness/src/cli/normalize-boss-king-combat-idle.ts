/** Keep the Crypt King's combat guard and greatcleave windup at one physical scale. */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = fileURLToPath(new URL("../../../../assets/source/melee/", import.meta.url));
const ramps = JSON.parse(readFileSync(join(root, "boss-king-palette.json"), "utf8")).ramps as Record<string, string[]>;
const palette = Object.values(ramps).flat().map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
const heart = ramps.heart!.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
const read = (file: string): PNG => PNG.sync.read(readFileSync(join(root, file)));
const write = (file: string, image: PNG): void => writeFileSync(join(root, file), PNG.sync.write(image));
const pixel = (image: PNG, x: number, y: number): number => (y * image.width + x) * 4;

function bounds(image: PNG): readonly [number, number, number, number] {
  let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (image.data[pixel(image, x, y) + 3]! < 180) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error("empty boss frame");
  return [left, top, right, bottom];
}

function nearest(r: number, g: number, b: number): readonly number[] {
  let match = palette[0]!, distance = Infinity;
  for (const color of palette) {
    const score = (r - color[0]!) ** 2 + (g - color[1]!) ** 2 + (b - color[2]!) ** 2;
    if (score < distance) { match = color; distance = score; }
  }
  return match;
}

function upscale(art: PNG): PNG {
  const out = new PNG({ width: art.width * 4, height: art.height * 4 });
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const source = pixel(art, x >> 2, y >> 2);
    out.data.set(art.data.subarray(source, source + 4), pixel(out, x, y));
  }
  return out;
}

function windup(phase: 1 | 2 | 3, guard: PNG): void {
  const draft = read(`boss-king-p${phase}-windup-revised-draft.png`);
  const [left, top, right, bottom] = bounds(draft);
  const [guardLeft, guardTop, guardRight, guardBottom] = bounds(guard);
  const scale = Math.min((guardRight - guardLeft) / (right - left), (guardBottom - guardTop) / (bottom - top));
  const draftCenter = (left + right) / 2;
  const guardCenter = (guardLeft + guardRight) / 2;
  const out = new PNG({ width: 256, height: 256 }); out.data.fill(0);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const sx = draftCenter + (x * 4 + 2 - guardCenter) / scale;
    const sy = bottom + (y * 4 + 2 - guardBottom) / scale;
    let red = 0, green = 0, blue = 0, count = 0;
    for (const [dx, dy] of [[0, 0], [-.3, 0], [.3, 0], [0, -.3], [0, .3]] as const) {
      const xx = Math.floor(sx + dx / scale), yy = Math.floor(sy + dy / scale);
      if (xx < 0 || xx >= draft.width || yy < 0 || yy >= draft.height) continue;
      const i = pixel(draft, xx, yy);
      if (draft.data[i + 3]! < 180) continue;
      red += draft.data[i]!; green += draft.data[i + 1]!; blue += draft.data[i + 2]!; count++;
    }
    if (count < 3) continue;
    const color = nearest(red / count, green / count, blue / count);
    out.data.set([...color, 255], pixel(out, x, y));
  }
  write(`boss-king/p${phase}/windup.png`, upscale(out));
  console.log(`phase ${phase}: windup fit to guard bounds at ${(scale * 100).toFixed(1)}%`);
}

function breath(phase: 1 | 2 | 3, guard: PNG): void {
  if (guard.width !== 1024 || guard.height !== 1024) throw new Error(`p${phase}: expected 1024×1024 guard`);
  const out = new PNG({ width: 256, height: 256 });
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = pixel(guard, x * 4 + 2, y * 4 + 2), di = pixel(out, x, y);
    out.data.set(guard.data.subarray(i, i + 4), di);
    // A quiet core pulse, fully inside the unchanged silhouette. The guard
    // retains the exact same hands, sword, crown, cape and feet at both keys.
    if (x < 65 || x > 160 || y < 50 || y > 130 || out.data[di + 3] !== 255) continue;
    const shade = heart.findIndex((color) => color.every((value, n) => value === out.data[di + n]));
    if (shade >= 0 && shade < heart.length - 1) out.data.set([...heart[shade + 1]!, 255], di);
  }
  write(`boss-king/p${phase}/idle1.png`, upscale(out));
}

for (const phase of [1, 2, 3] as const) {
  const guard = read(`boss-king/p${phase}/recover.png`);
  const oldIdle = `boss-king/p${phase}/idle0.png`;
  const ceremonial = join(root, `boss-king/p${phase}/idle_ceremonial.png`);
  if (!existsSync(ceremonial)) copyFileSync(join(root, oldIdle), ceremonial);
  copyFileSync(join(root, `boss-king/p${phase}/recover.png`), join(root, oldIdle));
  breath(phase, guard);
  windup(phase, guard);
}
