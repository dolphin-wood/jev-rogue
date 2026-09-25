/**
 * Runtime palette swaps (doc 019, "Art, and what it costs").
 *
 * A subspecies is the base body's frames in a different palette, and an elite
 * is any body's palette shifted warm. Both used to mean copies of the atlas: a
 * thirteen-subspecies roster packed as its own models measured at **+58% on
 * the character half of a 6.6 MB atlas** that is already packed 4096 wide, and
 * the elite's tint is `setTint(0xffa8b8)`, a flat multiply that eats the
 * body's own shading rather than moving it.
 *
 * Both are the same operation, and doc 016 is what makes it exact: *every
 * colour of a composed frame is in the body's palette by construction*, at
 * most 32 of them. So a swap is a lookup from one palette's colours to
 * another's — not a nearest-colour match, not a hue rotation over arbitrary
 * pixels — and it is **matched by material and shade index**, so "the cloth's
 * third shade" becomes "the cloth's third shade", whatever either colour is.
 *
 * This module is the pure half: the tables, the CPU reference and a reference
 * fragment source. Nothing here imports Phaser, so it is tested in node.
 *
 * What ships reads `LUT_MAX` and `parseHex` from here and builds the table
 * from the one the **pipeline** wrote into `sprites.json`
 * (`fx/subspecies-visuals.ts`), which is the same operation done where the
 * palettes actually live. `buildLut` and `applyLut` stay because they are the
 * executable statement of the rules — a material the target does not name is
 * left alone, a shorter ramp clamps, a pair that changes nothing is dropped —
 * and the tests here are what hold the shader honest about them. `LUT_FRAG`
 * is the bare lookup; the shipping shader is Phaser's own single-texture
 * source with that lookup spliced in, so tint and tint-fill keep working.
 */

/** A palette as `assets/models/<body>/palette.json` holds it: material → shades, darkest first. */
export type Ramps = Readonly<Record<string, readonly string[]>>;

export type Rgb = readonly [number, number, number];

/** One entry of the table: this exact colour becomes that one. */
export interface LutPair {
  readonly material: string;
  readonly shade: number;
  readonly from: Rgb;
  readonly to: Rgb;
}

/**
 * Doc 016 holds a body's palette at 32 colours ("At most 32 colours in all;
 * the player has 25"), so a table can never be longer and the shader's loop
 * is a fixed bound rather than a guess.
 */
export const LUT_MAX = 32;

const HEX = /^#([0-9a-fA-F]{6})$/;

export function parseHex(hex: string): Rgb {
  const m = HEX.exec(hex.trim());
  if (!m) throw new Error(`palette: expected #rrggbb, got ${hex}`);
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

const sameRgb = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export interface Lut {
  readonly pairs: readonly LutPair[];
  /**
   * Source colours that appear in more than one ramp. The first ramp in the
   * source palette's own order wins, because a lookup is by colour and cannot
   * know which material a pixel came from — a body whose trim and belt share
   * an exact shade swaps both together, and this names it rather than letting
   * it be a surprise later.
   */
  readonly shared: readonly string[];
}

/**
 * The table taking `from`'s colours to `to`'s.
 *
 * Three rules, each of which exists so a subspecies palette can be written as
 * only what differs:
 *
 * - **A material `to` does not name is left alone**, so a palette that changes
 *   one ramp is a file with one ramp in it.
 * - **A shorter target ramp clamps to its last shade**, so a three-shade
 *   accent can stand in for a five-shade one without the top two going
 *   transparent or wrapping round to the shadow.
 * - **A pair that changes nothing is dropped**, so `buildLut(p, p)` is empty
 *   and the renderer can skip the body entirely.
 */
export function buildLut(from: Ramps, to: Ramps): Lut {
  const pairs: LutPair[] = [];
  const seen = new Map<string, string>();
  const shared: string[] = [];
  for (const [material, ramp] of Object.entries(from)) {
    const target = to[material];
    ramp.forEach((hex, shade) => {
      const key = hex.toLowerCase();
      const owner = seen.get(key);
      if (owner !== undefined) {
        if (owner !== material && !shared.includes(key)) shared.push(key);
        return;
      }
      seen.set(key, material);
      if (!target || target.length === 0) return;
      const src = parseHex(hex);
      const dst = parseHex(target[Math.min(shade, target.length - 1)]!);
      if (sameRgb(src, dst)) return;
      pairs.push({ material, shade, from: src, to: dst });
    });
  }
  if (pairs.length > LUT_MAX) {
    throw new Error(`palette swap: ${pairs.length} pairs, over the ${LUT_MAX} a body may hold`);
  }
  return { pairs, shared };
}

/**
 * The CPU reference, over RGBA bytes in place.
 *
 * It is what the tests measure the shader's rules against, and it is also the
 * path a canvas-backed context takes: baking one body's frames once costs less
 * than a pipeline that will not run there at all.
 *
 * **Fully transparent pixels are skipped** rather than mapped, because the
 * atlas pads with zeroed RGBA and a zeroed pixel matches any palette entry
 * that happens to be black.
 */
export function applyLut(rgba: Uint8ClampedArray | Uint8Array, lut: Lut): number {
  if (lut.pairs.length === 0) return 0;
  const table = new Map<number, Rgb>();
  for (const p of lut.pairs) table.set((p.from[0] << 16) | (p.from[1] << 8) | p.from[2], p.to);
  let swapped = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const hit = table.get((rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!);
    if (!hit) continue;
    rgba[i] = hit[0];
    rgba[i + 1] = hit[1];
    rgba[i + 2] = hit[2];
    swapped++;
  }
  return swapped;
}

/* ------------------------------- the enrage ------------------------------- */

/** Hue the elite shift pulls toward, in degrees: the warm pink the tint named. */
export const ENRAGE_HUE = 345;
/** How far toward it a colour is carried, and how much chroma it gains. */
export const ENRAGE_PULL = 0.55;
export const ENRAGE_CHROMA = 1.25;

export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60;
  else if (max === gg) h = ((bb - rr) / d + 2) * 60;
  else h = ((rr - gg) / d + 4) * 60;
  return [h, s, l];
}

export function hslToRgb([h, s, l]: readonly [number, number, number]): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = l - c / 2;
  const t: Rgb = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x]
    : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  return [Math.round((t[0] + m) * 255), Math.round((t[1] + m) * 255), Math.round((t[2] + m) * 255)];
}

/** The shortest way round the circle from `a` to `b`, in degrees. */
function towardHue(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

/**
 * An elite's palette: every ramp carried toward the warm pink, chroma raised,
 * **lightness never raised**.
 *
 * The clamp is doc 016's value band, which the roster is inside because it is
 * applied where a delivered frame is made. A shift that brightened a body
 * would take it back out of the band at exactly the moment the room is busiest
 * — and the outline is left alone entirely, because two rings of near-black
 * ink is most of what separates a body from the floor.
 */
export function enrageRamps(ramps: Ramps, pull = ENRAGE_PULL): Ramps {
  const out: Record<string, string[]> = {};
  for (const [material, ramp] of Object.entries(ramps)) {
    if (material === "outline") { out[material] = [...ramp]; continue; }
    out[material] = ramp.map((hex) => {
      const [h, s, l] = rgbToHsl(parseHex(hex));
      const shifted: [number, number, number] = [
        towardHue(h, ENRAGE_HUE, pull),
        Math.min(1, s * ENRAGE_CHROMA),
        l,
      ];
      return toHex(hslToRgb(shifted));
    });
  }
  return out;
}

/* ------------------------------- the shader ------------------------------- */

/**
 * The fragment source, as a table of up to 32 exact pairs rather than an
 * indexed-palette texture.
 *
 * An indexed lookup is the usual way and it needs the atlas re-authored as
 * indices, which is the atlas copy this module exists to avoid. Thirty-two
 * comparisons a pixel over the handful of bodies in a room is nothing, and
 * the comparison is exact to half a byte because both sides came out of the
 * same palette file.
 */
export const LUT_FRAG = `
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec3 uFrom[${LUT_MAX}];
uniform vec3 uTo[${LUT_MAX}];
uniform int uCount;
varying vec2 outTexCoord;
void main() {
  vec4 c = texture2D(uMainSampler, outTexCoord);
  if (c.a > 0.0) {
    for (int i = 0; i < ${LUT_MAX}; i++) {
      if (i >= uCount) break;
      if (all(lessThan(abs(c.rgb - uFrom[i]), vec3(0.002)))) { c.rgb = uTo[i]; break; }
    }
  }
  gl_FragColor = c;
}
`;

/** The table as the two uniform arrays the source declares, padded to `LUT_MAX`. */
export function lutUniforms(lut: Lut): { from: Float32Array; to: Float32Array; count: number } {
  const from = new Float32Array(LUT_MAX * 3);
  const to = new Float32Array(LUT_MAX * 3);
  lut.pairs.forEach((p, i) => {
    for (let k = 0; k < 3; k++) {
      from[i * 3 + k] = p.from[k]! / 255;
      to[i * 3 + k] = p.to[k]! / 255;
    }
  });
  return { from, to, count: lut.pairs.length };
}
