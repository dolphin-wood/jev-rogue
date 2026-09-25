/** Crop the painted draft sheets into exact, hard-alpha atlas frames. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const root = new URL("../assets/source/spells/", import.meta.url).pathname;
const draft = join(root, "drafts");
mkdirSync(draft, { recursive: true });

// The twelve ImageGen drafts are versioned in assets/source/spells/drafts/.
// The normalizer never depends on a private generation cache.

const palettes = {
  spirit: ["0d0b1f", "6a5795", "b9a7ff", "d5caff", "f4f0ff", "ffffff"],
  storm: ["0d0b1f", "1d5a86", "4c8dbc", "9ad2ff", "d8f4ff", "ffffff"],
  frost: ["0d0b1f", "1d5a86", "4b99ce", "7fc4ef", "d8f4ff", "f2fbff", "ffffff"],
  flame: ["0d0b1f", "32252a", "4a3428", "8a6a48", "a68d72", "dd5a2b", "ff8a3a", "ffc44a", "fff1c0", "ffffff"],
  void: ["0d0b1f", "211036", "3a1a70", "56349b", "7a4fd6", "ae86ec", "e2d0ff", "ffffff"],
  mint: ["0d0b1f", "155a54", "2b9c8e", "7fe8c0", "baf9dc", "e6fff4", "ffffff"],
  venom: ["0d0b1f", "1f4a14", "397b22", "6fdc5a", "a4ef83", "e8ffd4", "ffffff"],
  dust: ["0d0b1f", "3c3330", "6f6252", "9a8a78", "c5b7a3", "e2d8c7"],
};
for (const [key, vals] of Object.entries(palettes)) palettes[key] = vals.map((hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)));
const cache = new Map();
function sheet(name) { if (!cache.has(name)) cache.set(name, PNG.sync.read(readFileSync(join(draft, `${name}.png`)))); return cache.get(name); }
function nearest(r, g, b, palette) {
  let best = palette[0], error = Infinity;
  for (const c of palette) {
    const dr = (r - c[0]) * 0.9, dg = (g - c[1]) * 1.15, db = b - c[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < error) { error = d; best = c; }
  }
  return best;
}
function bounds(src, rect) {
  let x0 = rect[2], y0 = rect[3], x1 = rect[0] - 1, y1 = rect[1] - 1;
  for (let y = rect[1]; y < rect[3]; y++) for (let x = rect[0]; x < rect[2]; x++) {
    if (src.data[(y * src.width + x) * 4 + 3] < 150) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1 + 1, y1 + 1];
}
function write(name, srcName, rect, w, h, contentW, contentH, paletteName, position = "center") {
  const src = sheet(srcName), [sx0, sy0, sx1, sy1] = bounds(src, rect);
  if (sx1 <= sx0 || sy1 <= sy0) throw new Error(`Empty art: ${name}`);
  const dst = new PNG({ width: w, height: h }); dst.data.fill(0);
  const dw = Math.min(w, contentW), dh = Math.min(h, contentH);
  const dx0 = position === "crescent" ? 86 - dw : Math.floor((w - dw) / 2);
  const dy0 = position === "crescent" ? 2 : Math.floor((h - dh) / 2);
  for (let dy = 0; dy < dh; dy++) for (let dx = 0; dx < dw; dx++) {
    const sx = Math.min(sx1 - 1, sx0 + Math.floor((dx + 0.5) * (sx1 - sx0) / dw));
    const sy = Math.min(sy1 - 1, sy0 + Math.floor((dy + 0.5) * (sy1 - sy0) / dh));
    const si = (sy * src.width + sx) * 4, di = ((dy0 + dy) * w + dx0 + dx) * 4;
    if (src.data[si + 3] < 160) continue;
    const c = nearest(src.data[si], src.data[si + 1], src.data[si + 2], palettes[paletteName]);
    dst.data[di] = c[0]; dst.data[di + 1] = c[1]; dst.data[di + 2] = c[2]; dst.data[di + 3] = 255;
  }
  if (name.startsWith("vfx_arc_seg_")) {
    // The painted strand reaches both tile edges at a fixed middle texel.
    // The renderer can repeat 32-art-pixel segments without a visible seam.
    for (const x of [0, w - 1]) for (const [y, rgb] of [[7, [154, 210, 255]], [8, [255, 255, 255]], [9, [154, 210, 255]]]) {
      const i = (y * w + x) * 4;
      dst.data.set([...rgb, 255], i);
    }
  }
  writeFileSync(join(root, `${name}.png`), PNG.sync.write(dst));
}
function grid(name, srcName, cols, rows, frameNames, size, content, palette, position = "center") {
  const src = sheet(srcName);
  for (let i = 0; i < frameNames.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const x0 = Math.floor(col * src.width / cols), x1 = Math.floor((col + 1) * src.width / cols);
    const y0 = Math.floor(row * src.height / rows), y1 = Math.floor((row + 1) * src.height / rows);
    write(frameNames[i], srcName, [x0, y0, x1, y1], ...size, ...content, palette, position);
  }
}
grid("crescent", "crescent-wave", 5, 2,
  ["launch_0", "launch_1", "fly_0", "fly_1", "fly_2", "fly_3", "dissolve_0", "dissolve_1", "dissolve_2", "dissolve_3"].map((s) => `vfx_crescent_wave_${s}`),
  [96, 192], [50, 188], "spirit", "crescent");
grid("rock", "meteor-rock", 4, 1, Array.from({ length: 4 }, (_, i) => `vfx_meteor_rock_${i}`), [32, 32], [29, 29], "flame");
grid("impact", "meteor-impact", 5, 1, Array.from({ length: 5 }, (_, i) => `vfx_meteor_impact_${i}`), [128, 128], [116, 98], "flame");
grid("frost", "frost-orb", 4, 1, Array.from({ length: 4 }, (_, i) => `vfx_frost_orb_${i}`), [32, 32], [29, 29], "frost");
grid("storm", "ball-lightning", 4, 1, Array.from({ length: 4 }, (_, i) => `vfx_ball_lightning_${i}`), [32, 32], [29, 29], "storm");
grid("arc", "arc", 6, 1, Array.from({ length: 4 }, (_, i) => `vfx_arc_seg_${i}`), [32, 16], [32, 12], "storm");
{
  const src = sheet("arc");
  for (let i = 0; i < 2; i++) {
    const x0 = Math.floor((4 + i) * src.width / 6), x1 = Math.floor((5 + i) * src.width / 6);
    write(`vfx_arc_cap_${i}`, "arc", [x0, 0, x1, src.height], 16, 16, 14, 14, "storm");
  }
}
{
  const cuts = [[0, 115], [115, 224], [224, 332], [332, 443], [443, 552], [552, 760], [760, 954], [954, 1150], [1150, 1330]];
  for (let i = 0; i < 9; i++) write(i < 5 ? `vfx_doom_rune_${i}` : `vfx_doom_burst_${i - 5}`, "doom", [cuts[i][0], 450, cuts[i][1], 750], i < 5 ? 32 : 96, i < 5 ? 32 : 96, i < 5 ? 25 : 86, i < 5 ? 25 : 86, "void");
}
grid("vortex", "vortex", 4, 2,
  [...Array.from({ length: 4 }, (_, i) => `vfx_vortex_${i}`), ...Array.from({ length: 4 }, (_, i) => `vfx_vortex_gather_${i}`)],
  [128, 128], [118, 118], "void");
grid("guard", "guard-answer", 5, 1, Array.from({ length: 5 }, (_, i) => `vfx_guard_answer_${i}`), [128, 128], [116, 116], "mint");
grid("glob", "contagion-glob", 2, 1, Array.from({ length: 2 }, (_, i) => `vfx_contagion_glob_${i}`), [16, 16], [13, 13], "venom");
grid("dust", "landing-dust", 4, 1, Array.from({ length: 4 }, (_, i) => `vfx_landing_dust_${i}`), [128, 64], [118, 52], "dust");
grid("gas", "gas-puff", 4, 1, Array.from({ length: 4 }, (_, i) => `vfx_gas_puff_${i}`), [32, 32], [28, 28], "venom");
console.log("Normalized spell sprites and preserved drafts under", root);
