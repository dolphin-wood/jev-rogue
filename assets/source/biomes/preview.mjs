// Same-mood room comparison with a warm combat warning laid across a patch.
// Run from the repository root: node assets/source/biomes/preview.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const dir = dirname(fileURLToPath(import.meta.url));
const ids = ['ossuary', 'flooded', 'furnace'];
const width = 8 * 64, height = 6 * 64, gap = 24;
const out = new PNG({ width: width * 3 + gap * 2, height });
out.data.fill(0);

function paint(sheet, rect, ox, oy, alpha = 1) {
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
    const si = ((rect.y + y) * sheet.width + rect.x + x) * 4;
    const a = sheet.data[si + 3] / 255 * alpha;
    if (!a) continue;
    const di = ((oy + y) * out.width + ox + x) * 4;
    for (let c = 0; c < 3; c++) out.data[di + c] = Math.round(sheet.data[si + c] * a + out.data[di + c] * (1 - a));
    out.data[di + 3] = 255;
  }
}

ids.forEach((id, index) => {
  const sheet = PNG.sync.read(readFileSync(join(dir, `${id}.png`)));
  const frames = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')).frames;
  const ox = index * (width + gap);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
    const wall = x === 0 || x === 7 || y === 0 || y === 5;
    const name = wall ? `tile_${id}_wall_solid` : `tile_${id}_floor_${(x * 7 + y * 3) % 4}`;
    paint(sheet, frames[name], ox + x * 64, y * 64);
  }
  paint(sheet, frames[`patch_${id}_0`], ox + 2 * 64, 2 * 64, .8);
  paint(sheet, frames[`deco_${id}_0`], ox + 5 * 64, 1 * 64, .75);
  paint(sheet, frames[`deco_${id}_3`], ox + 5 * 64, 4 * 64, .75);
  paint(sheet, frames[`prop_${id}_sconce`], ox + 4 * 64, 0);
  const cx = ox + 3 * 64, cy = 3 * 64;
  for (let y = 64; y < height - 64; y++) for (let x = 64; x < width - 64; x++) {
    const d = Math.hypot(ox + x - cx, y - cy);
    const a = Math.abs(d - 52) < 3 ? .92 : d < 49 ? .1 : 0;
    if (!a) continue;
    const di = (y * out.width + ox + x) * 4;
    for (const [c, value] of [255, 85, 68].entries()) out.data[di + c] = Math.round(value * a + out.data[di + c] * (1 - a));
  }
});
writeFileSync(join(dir, 'comparison.png'), PNG.sync.write(out));
