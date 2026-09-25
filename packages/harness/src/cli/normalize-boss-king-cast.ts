/** Fit the king's ranged-cast source pair to his combat guard without cropping spell effects. */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = fileURLToPath(new URL("../../../../assets/source/melee/boss-king/", import.meta.url));
const S = 256;
const index = (x: number, y: number): number => ((y * 4) * 1024 + x * 4) * 4;

function armourArea(image: PNG): number {
  let area = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = index(x, y);
    if (image.data[i + 3]! < 16) continue;
    const r = image.data[i]!, g = image.data[i + 1]!, b = image.data[i + 2]!;
    if (b > r + 15 && b > g + 25) continue;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi - lo < 28 && hi > 120) continue;
    area++;
  }
  return area;
}

function bottom(image: PNG): number {
  for (let y = S - 1; y >= 0; y--) for (let x = 0; x < S; x++)
    if ((x < 95 || x > 160) && image.data[index(x, y) + 3]! >= 128) return y;
  throw new Error("empty boss source");
}

for (const phase of [1, 2, 3]) {
  const dir = join(root, `p${phase}`);
  const guard = PNG.sync.read(readFileSync(join(dir, "idle0.png")));
  for (const pose of ["tele", "tele1"]) {
    const file = join(dir, `${pose}.png`), backup = join(dir, `${pose}_unscaled.png`);
    if (!existsSync(backup)) copyFileSync(file, backup);
  }
  const original = PNG.sync.read(readFileSync(join(dir, "tele_unscaled.png")));
  const scale = Math.sqrt(armourArea(guard) / armourArea(original));
  const targetBottom = bottom(guard), sourceBottom = bottom(original);
  for (const pose of ["tele", "tele1"]) {
    const file = join(dir, `${pose}.png`), backup = join(dir, `${pose}_unscaled.png`);
    const before = PNG.sync.read(readFileSync(backup));
    const after = new PNG({ width: 1024, height: 1024 }); after.data.fill(0);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const sx = Math.round(128 + (x - 128) / scale);
      const sy = Math.round(sourceBottom + (y - targetBottom) / scale);
      if (sx < 0 || sx >= S || sy < 0 || sy >= S) continue;
      const from = index(sx, sy);
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++)
        after.data.set(before.data.subarray(from, from + 4), (((y * 4 + dy) * 1024 + x * 4 + dx) * 4));
    }
    writeFileSync(file, PNG.sync.write(after));
  }
  console.log(`p${phase}: tele pair fit at ${(scale * 100).toFixed(1)}%`);
}
