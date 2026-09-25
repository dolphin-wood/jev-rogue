/** Match the ground-strike drawings' armour mass to the Crypt King's guard. */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = fileURLToPath(new URL("../../../../assets/source/melee/boss-king/", import.meta.url));
// Narrowing x alone preserves each crouched pose's height and matches armour mass.
// Run repair-boss-king-ink.ts --write afterward to close resampling pinholes.
const width = 256;

function armourArea(image: PNG): number {
  let area = 0;
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const i = ((y * 4) * 1024 + x * 4) * 4;
    if (image.data[i + 3]! < 16) continue;
    const r = image.data[i]!, g = image.data[i + 1]!, b = image.data[i + 2]!;
    if (b > r + 15 && b > g + 25) continue; // cape
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi - lo < 28 && hi > 120) continue; // steel blade
    area++;
  }
  return area;
}

for (const phase of [1, 2, 3]) for (const pose of ["slam", "cleave_stuck"]) {
  const dir = join(root, `p${phase}`);
  const source = join(dir, `${pose}.png`), original = join(dir, `${pose}_unscaled.png`);
  if (!existsSync(original)) copyFileSync(source, original);
  const before = PNG.sync.read(readFileSync(original));
  if (before.width !== 1024 || before.height !== 1024) throw new Error(`${original}: expected 1024×1024`);
  const idle = PNG.sync.read(readFileSync(join(dir, "idle0.png")));
  const scale = Math.min(1, Math.max(.75, armourArea(idle) / armourArea(before)));
  const after = new PNG({ width: 1024, height: 1024 });
  after.data.fill(0);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const sx = Math.round(128 + (x - 128) / scale);
    if (sx < 0 || sx >= width) continue;
    const from = ((y * 4) * 1024 + sx * 4) * 4;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      const to = (((y * 4 + dy) * 1024 + x * 4 + dx) * 4);
      after.data.set(before.data.subarray(from, from + 4), to);
    }
  }
  writeFileSync(source, PNG.sync.write(after));
  console.log(`p${phase}/${pose}: narrowed to ${Math.round(scale * 100)}% about the body's centre`);
}
