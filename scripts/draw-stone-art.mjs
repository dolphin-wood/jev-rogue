/**
 * The stone school's own sprites, which `normalize-spell-art.mjs` does not
 * make: a tumbling chunk for Stone Shard and Mortar's shell, and a stone
 * burst for a shell landing.
 *
 * - `vfx_stone_chunk_0..3` (24 x 24) and `vfx_stone_shell_0..3` (32 x 32)
 *   are drawn here: a faceted rock, each
 *   face shaded by how squarely it meets a light from the top left, outlined
 *   once, turned a quarter of a facet further each frame so four frames loop
 *   as a tumble.
 * - `vfx_stone_impact_0..3` (128 x 128) are the painted meteor impact drafts
 *   reduced to the stone palette: the thrown debris and the dust stay, and
 *   the fire becomes the dust it is thrown up with. The draft's first frame,
 *   the meteor's own dark rock arriving, is left out: the shell that lands
 *   is the chunk drawn above.
 *
 * Run from the repository root: `node scripts/draw-stone-art.mjs`, then
 * `pnpm assets:art`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const root = new URL("../assets/source/spells/", import.meta.url).pathname;
const hex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
const OUTLINE = hex("0d0b1f");
// Dark to light: the stone's shadow side to its lit ridge.
const STONE = ["3c3330", "5a4c40", "6f6252", "8a7a66", "a8977f", "c5b7a3", "e2d8c7"].map(hex);
const DUST = ["0d0b1f", "3c3330", "5a4c40", "6f6252", "8a7a66", "9a8a78", "b8a88f", "c5b7a3", "e2d8c7"].map(hex);

function put(png, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (y * png.width + x) * 4;
  png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
}
const alphaAt = (png, x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? 0 : png.data[(y * png.width + x) * 4 + 3]);

/* ------------------------------ the chunk ------------------------------- */

// The rock's outline, as radii round its centre: lumpy, never round.
const RIM = [6.2, 5.0, 6.6, 5.4, 6.0, 4.8, 6.4];
// Where the faces meet: off the centre toward the light, so the lit faces are the small ones.
const PEAK = [-0.9, -1.2];
const LIGHT = [-0.62, -0.78];

function chunk(frame, size) {
  const k = size / 16, c = size / 2 - 0.5;
  const peak = [PEAK[0] * k, PEAK[1] * k];
  const png = new PNG({ width: size, height: size }); png.data.fill(0);
  const turn = (frame / 4) * ((Math.PI * 2) / RIM.length);
  const rim = RIM.map((r, i) => {
    const a = turn + (i / RIM.length) * Math.PI * 2;
    return [Math.cos(a) * r * k, Math.sin(a) * r * k];
  });
  // Each face is the triangle from the peak to one edge of the rim.
  const faces = rim.map((p, i) => {
    const q = rim[(i + 1) % rim.length];
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const out = Math.hypot(mid[0] - peak[0], mid[1] - peak[1]) || 1;
    // A face tilts away from the peak: its normal leans the way it points.
    const lit = ((mid[0] - peak[0]) / out) * LIGHT[0] + ((mid[1] - peak[1]) / out) * LIGHT[1];
    const shade = Math.max(0, Math.min(STONE.length - 2, Math.round((lit + 1) / 2 * (STONE.length - 2))));
    return { p, q, shade };
  });
  const inTri = (x, y, a, b, d) => {
    const s = (u, v, w) => (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1]);
    const pt = [x, y];
    const d1 = s(pt, a, b), d2 = s(pt, b, d), d3 = s(pt, d, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x + 0.5 - c, py = y + 0.5 - c;
    const face = faces.find((f) => inTri(px, py, peak, f.p, f.q));
    if (face) put(png, x, y, STONE[face.shade]);
  }
  // A lone pixel sticking out at a corner reads as a hair, not as stone: off.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!alphaAt(png, x, y)) continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => alphaAt(png, x + dx, y + dy)).length;
    if (n <= 1) png.data[(y * size + x) * 4 + 3] = 0;
  }
  const shadeOf = (x, y) => STONE.findIndex((k) => { const i = (y * size + x) * 4; return png.data[i] === k[0] && png.data[i + 1] === k[1] && png.data[i + 2] === k[2]; });
  // The rim toward the light is caught a step brighter; the rim away from it falls a step darker.
  const lift = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!alphaAt(png, x, y)) continue;
    const k = shadeOf(x, y);
    if (!alphaAt(png, x - 1, y) || !alphaAt(png, x, y - 1)) lift.push([x, y, Math.min(STONE.length - 2, k + 1)]);
    else if (!alphaAt(png, x + 1, y) || !alphaAt(png, x, y + 1)) lift.push([x, y, Math.max(0, k - 1)]);
  }
  for (const [x, y, k] of lift) put(png, x, y, STONE[k]);
  // A few pits in the stone, on a fixed pattern so the frames agree.
  for (const [px, py] of [[9, 9], [6, 10], [10, 6], [5, 7]]) {
    const x = Math.round(px * k), y = Math.round(py * k);
    if (!alphaAt(png, x, y)) continue;
    put(png, x, y, STONE[Math.max(0, shadeOf(x, y) - 2)]);
  }
  // The ridge the faces meet at catches the light.
  put(png, Math.round(c + peak[0] - 0.5), Math.round(c + peak[1] - 0.5), STONE[STONE.length - 1]);
  // One outline, outside the rock.
  const body = new Set();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (alphaAt(png, x, y)) body.add(y * size + x);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (body.has(y * size + x)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => body.has((y + dy) * size + x + dx) && x + dx >= 0 && x + dx < size))
      put(png, x, y, OUTLINE);
  }
  return png;
}

/* ------------------------------ the impact ------------------------------ */

function nearest([r, g, b], palette) {
  let best = palette[0], error = Infinity;
  for (const c of palette) {
    const dr = (r - c[0]) * 0.9, dg = (g - c[1]) * 1.15, db = b - c[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < error) { error = d; best = c; }
  }
  return best;
}

/** A painted pixel in the stone palette: fire is lifted to dust by its brightness, not matched by its hue. */
function stoned([r, g, b]) {
  const warm = r - b > 70 && r > 150;
  if (!warm) return nearest([r, g, b], DUST);
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  const i = Math.max(4, Math.min(DUST.length - 1, Math.round(4 + ((lum - 110) / 145) * (DUST.length - 5))));
  return DUST[i];
}

function impacts() {
  const src = PNG.sync.read(readFileSync(join(root, "drafts", "meteor-impact.png")));
  const cols = 5, w = 128, h = 128, cw = 116, ch = 98;
  for (let i = 1; i < cols; i++) {
    const x0 = Math.floor((i * src.width) / cols), x1 = Math.floor(((i + 1) * src.width) / cols);
    let bx0 = x1, by0 = src.height, bx1 = x0 - 1, by1 = -1;
    for (let y = 0; y < src.height; y++) for (let x = x0; x < x1; x++) {
      if (src.data[(y * src.width + x) * 4 + 3] < 150) continue;
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
    }
    bx1++; by1++;
    const dst = new PNG({ width: w, height: h }); dst.data.fill(0);
    const dx0 = Math.floor((w - cw) / 2), dy0 = Math.floor((h - ch) / 2);
    for (let dy = 0; dy < ch; dy++) for (let dx = 0; dx < cw; dx++) {
      const sx = Math.min(bx1 - 1, bx0 + Math.floor(((dx + 0.5) * (bx1 - bx0)) / cw));
      const sy = Math.min(by1 - 1, by0 + Math.floor(((dy + 0.5) * (by1 - by0)) / ch));
      const si = (sy * src.width + sx) * 4;
      if (src.data[si + 3] < 160) continue;
      put(dst, dx0 + dx, dy0 + dy, stoned([src.data[si], src.data[si + 1], src.data[si + 2]]));
    }
    writeFileSync(join(root, `vfx_stone_impact_${i - 1}.png`), PNG.sync.write(dst));
  }
}

// Stone Shard's chunk at 12 world px, Mortar's shell at 16.
for (let f = 0; f < 4; f++) {
  writeFileSync(join(root, `vfx_stone_chunk_${f}.png`), PNG.sync.write(chunk(f, 24)));
  writeFileSync(join(root, `vfx_stone_shell_${f}.png`), PNG.sync.write(chunk(f, 32)));
}
impacts();
console.log("Drew the stone chunk and the stone impact under", root);
