/**
 * Applies a mood's palette substitution to an indexed sprite sheet
 * (design doc 008). Sprites are authored in the eight base colours exactly, so
 * the swap is a lookup per pixel with no blending and no new colours.
 *
 * This is the whole reason the asset spec forbids anti-aliasing and caps each
 * sprite at three opaque colours: a tint would wash the art, a swap keeps it
 * sharp and keeps the enemy-bullet magenta untouched.
 */
import type { DerivedPalette, Palette } from "./palette.ts";
import { BASE_PALETTE, FIXED_SLOTS, SLOTS, substitution } from "./palette.ts";

function packHex(hex: string): number {
  return parseInt(hex.slice(1), 16) >>> 0;
}

/** Substitution as packed 24-bit keys, which is what a per-pixel loop wants. */
export function substitutionTable(
  derived: DerivedPalette,
  base: Palette = BASE_PALETTE,
): Map<number, [number, number, number]> {
  const table = new Map<number, [number, number, number]>();
  for (const [from, to] of substitution(derived, base)) {
    const v = packHex(to);
    table.set(packHex(from), [(v >> 16) & 255, (v >> 8) & 255, v & 255]);
  }
  return table;
}

export interface RecolourReport {
  readonly pixels: number;
  readonly opaque: number;
  readonly substituted: number;
  /** Opaque colours found that are not in the base palette at all. */
  readonly offPalette: readonly string[];
}

/**
 * Recolours RGBA pixel data in place and reports what it saw. Transparent
 * pixels are skipped, so the alpha channel is never touched.
 */
export function recolourRGBA(
  data: Uint8ClampedArray | Uint8Array,
  table: ReadonlyMap<number, [number, number, number]>,
  base: Palette = BASE_PALETTE,
): RecolourReport {
  const known = new Set(SLOTS.map((s) => packHex(base[s])));
  const offPalette = new Set<string>();
  let opaque = 0;
  let substituted = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    opaque++;
    const key = ((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!) >>> 0;
    const to = table.get(key);
    if (to) {
      data[i] = to[0];
      data[i + 1] = to[1];
      data[i + 2] = to[2];
      substituted++;
    } else if (!known.has(key)) {
      offPalette.add("#" + key.toString(16).padStart(6, "0"));
    }
  }

  return { pixels: data.length / 4, opaque, substituted, offPalette: [...offPalette].sort() };
}

/** Slots a swap must never touch, as packed keys, for assertions. */
export function fixedKeys(base: Palette = BASE_PALETTE): Set<number> {
  return new Set(FIXED_SLOTS.map((s) => packHex(base[s])));
}
