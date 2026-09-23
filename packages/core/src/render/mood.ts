/**
 * Room mood for smooth (non-indexed) art (design doc 008).
 *
 * The art is hand-drawn at high resolution, so a sprite carries on the order
 * of a thousand colours and a palette-index swap is impossible. Mood is
 * instead an HSL transform applied to the sheet once per mood and cached.
 *
 * The readability guarantee survives by exclusion rather than by a fixed
 * palette slot: pixels inside a hue band around the enemy-bullet magenta are
 * never touched, so enemy bullets look the same in every room whatever the
 * Director asked for.
 */
import { hslToHex, hexToRgb, rgbToHsl, BASE_PALETTE } from "./palette.ts";
import type { Mood } from "../types.ts";

/** Enemy bullets keep this hue in every room. */
export const PROTECTED_HUE_DEG = rgbToHsl(BASE_PALETTE.hot)[0];
export const PROTECTED_HUE_TOLERANCE_DEG = 25;
export const PROTECTED_MIN_SATURATION = 0.45;

export interface MoodTransform {
  readonly hueShiftDeg: number;
  readonly lightnessMul: number;
  readonly saturationMul: number;
  readonly particleScale: number;
}

export function moodTransform(mood: Mood): MoodTransform {
  return {
    hueShiftDeg: mood.temperature === "warm" ? 14 : -14,
    // A dim room darkens the art; a bright one lifts it without washing it out.
    lightnessMul: mood.brightness === "bright" ? 1.14 : 0.86,
    saturationMul: mood.brightness === "bright" ? 1.05 : 0.94,
    particleScale: mood.particle_intensity === "busy" ? 1.4 : 0.6,
  };
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** True when a pixel belongs to the protected enemy-bullet hue band. */
export function isProtected(hueDeg: number, saturation: number): boolean {
  return (
    saturation >= PROTECTED_MIN_SATURATION &&
    hueDistance(hueDeg, PROTECTED_HUE_DEG) <= PROTECTED_HUE_TOLERANCE_DEG
  );
}

export interface TintReport {
  readonly opaque: number;
  readonly shifted: number;
  readonly protectedPixels: number;
}

/**
 * Applies a mood in place. Fully transparent pixels are skipped; partially
 * transparent ones are shifted like any other, because smooth art has
 * anti-aliased edges and leaving them behind would produce a coloured fringe.
 */
export function tintRGBA(
  data: Uint8Array | Uint8ClampedArray,
  t: MoodTransform,
): TintReport {
  let opaque = 0;
  let shifted = 0;
  let protectedPixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    opaque++;
    const hex = rgbHex(data[i]!, data[i + 1]!, data[i + 2]!);
    const [h, s, l] = rgbToHsl(hex);
    if (isProtected(h, s)) {
      protectedPixels++;
      continue;
    }
    const out = hexToRgb(
      hslToHex(
        h + t.hueShiftDeg,
        Math.max(0, Math.min(1, s * t.saturationMul)),
        Math.max(0, Math.min(1, l * t.lightnessMul)),
      ),
    );
    data[i] = out[0];
    data[i + 1] = out[1];
    data[i + 2] = out[2];
    shifted++;
  }

  return { opaque, shifted, protectedPixels };
}

function rgbHex(r: number, g: number, b: number): string {
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}
