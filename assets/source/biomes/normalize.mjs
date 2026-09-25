// Rebuild the three named-cell biome sheets from the versioned painted drafts.
// Run from the repository root: node assets/source/biomes/normalize.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const dir = dirname(fileURLToPath(import.meta.url));
const walls = ['solid', 'n', 'e', 's', 'w', 'ne', 'es', 'sw', 'wn', 'ns', 'ew', 'nes', 'esw', 'swn', 'wne', 'nesw'];
const cornerSource = { ne: 9, es: 10, sw: 11, wn: 12 };
const wallSource = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 5, 6, 7, 4];
const specs = {
  ossuary: { floor: .74, patch: .76 },
  flooded: { floor: .88, patch: .86 },
  furnace: { floor: .92, patch: .9 },
};

function crop(src, x, y, w, h) {
  const out = new PNG({ width: w, height: h });
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const si = ((y + yy) * src.width + x + xx) * 4;
    out.data.set(src.data.subarray(si, si + 4), (yy * w + xx) * 4);
  }
  return out;
}

function cell(src, cols, rows, index, inset = 0) {
  const c = index % cols, r = Math.floor(index / cols);
  const x0 = Math.round(c * src.width / cols) + inset;
  const x1 = Math.round((c + 1) * src.width / cols) - inset;
  const y0 = Math.round(r * src.height / rows) + inset;
  const y1 = Math.round((r + 1) * src.height / rows) - inset;
  return crop(src, x0, y0, x1 - x0, y1 - y0);
}

function resize(src, w, h, gain = 1, opaque = false) {
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(src.width - 1, Math.floor((x + .5) * src.width / w));
    const sy = Math.min(src.height - 1, Math.floor((y + .5) * src.height / h));
    const si = (sy * src.width + sx) * 4, di = (y * w + x) * 4;
    const alpha = opaque ? 255 : src.data[si + 3] >= 135 ? 255 : 0;
    if (!alpha) continue;
    for (let channel = 0; channel < 3; channel++) out.data[di + channel] = Math.min(255, Math.round(src.data[si + channel] * gain));
    out.data[di + 3] = 255;
  }
  return out;
}

function innerCorner(src, corner) {
  const out = new PNG({ width: 64, height: 64 });
  const x0 = corner === 'ne' || corner === 'es' ? 48 : 0;
  const y0 = corner === 'es' || corner === 'sw' ? 48 : 0;
  for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 16; x++) {
    const i = (y * 64 + x) * 4;
    out.data.set(src.data.subarray(i, i + 4), i);
  }
  return out;
}

function sconce(src) {
  let minX = src.width, minY = src.height, maxX = -1, maxY = -1;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    if (src.data[(y * src.width + x) * 4 + 3] < 170) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const content = crop(src, minX, minY, maxX - minX + 1, maxY - minY + 1);
  const scale = Math.min(60 / content.width, 124 / content.height);
  const w = Math.max(1, Math.round(content.width * scale)), h = Math.max(1, Math.round(content.height * scale));
  const small = resize(content, w, h);
  const out = new PNG({ width: 64, height: 128 });
  const x0 = Math.floor((64 - w) / 2), y0 = 128 - h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = (y * w + x) * 4, di = ((y0 + y) * 64 + x0 + x) * 4;
    out.data.set(small.data.subarray(si, si + 4), di);
  }
  return out;
}

function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const si = (y * src.width + x) * 4, di = ((dy + y) * dst.width + dx + x) * 4;
    dst.data.set(src.data.subarray(si, si + 4), di);
  }
}

for (const [id, grade] of Object.entries(specs)) {
  const material = PNG.sync.read(readFileSync(join(dir, 'drafts', `${id}-material.png`)));
  const plainWall = id === 'ossuary' ? PNG.sync.read(readFileSync(join(dir, 'drafts', 'ossuary-plain-wall.png'))) : null;
  const decals = PNG.sync.read(readFileSync(join(dir, 'drafts', `${id}-decals.png`)));
  const details = PNG.sync.read(readFileSync(join(dir, 'drafts', `${id}-patches.png`)));
  const frames = {};
  const sheet = new PNG({ width: 512, height: 1152 });
  let slot = 0;
  const add = (name, art) => {
    const x = slot % 4 * 128, y = Math.floor(slot / 4) * 128;
    blit(sheet, art, x, y);
    frames[name] = { x, y, w: art.width, h: art.height };
    slot++;
  };
  for (let i = 0; i < 4; i++) add(`tile_${id}_floor_${i}`, resize(cell(material, 4, 4, i, 5), 64, 64, grade.floor, true));
  // Long ossuary walls use a separately painted quiet masonry cell. Niches,
  // cobwebs and rubble remain on the corner and compound wall variants.
  const wallArt = wallSource.map((sourceIndex, i) => plainWall && i < 5
    ? resize(plainWall, 64, 64, .75, true)
    : resize(cell(material, 4, 4, sourceIndex, 5), 64, 64, 1, true));
  walls.forEach((name, i) => add(`tile_${id}_wall_${name}`, wallArt[i]));
  for (const corner of Object.keys(cornerSource)) {
    const art = resize(cell(material, 4, 4, cornerSource[corner], 5), 64, 64, 1, true);
    add(`tile_${id}_wall_inner_${corner}`, innerCorner(art, corner));
  }
  for (let i = 0; i < 8; i++) add(`deco_${id}_${i}`, resize(cell(decals, 4, 2, i), 64, 64, .88));
  for (let i = 0; i < 3; i++) add(`patch_${id}_${i}`, resize(cell(details, 2, 2, i), 128, 128, grade.patch));
  add(`prop_${id}_sconce`, sconce(cell(details, 2, 2, 3)));
  writeFileSync(join(dir, `${id}.png`), PNG.sync.write(sheet));
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ image: `${id}.png`, frames }, null, 2) + '\n');
  console.log(`${id}: ${Object.keys(frames).length} painted frames`);
}
