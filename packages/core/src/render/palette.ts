/**
 * Room mood as a palette swap (design doc 008). Jev picks three labels; code
 * derives the colours. Readability is a hard constraint that overrides the
 * derivation, because a palette that hides enemy bullets is a bug no matter
 * what the Director asked for.
 *
 * Palette swapping rather than tinting is also what makes the 8-bit sprites
 * recolourable at all: every sprite is authored in the eight base colours.
 */
import type { Mood } from "../types.ts";

export const SLOTS = ["ink", "shadow", "body", "light", "bone", "cool", "hot", "amber"] as const;
export type Slot = (typeof SLOTS)[number];

export type Palette = Readonly<Record<Slot, string>>;

export const BASE_PALETTE: Palette = {
  ink: "#0d0b1f",
  shadow: "#2b2d54",
  body: "#4a5480",
  light: "#8792b5",
  bone: "#e8e3d8",
  cool: "#3fa9f5",
  hot: "#ff3fa4",
  amber: "#f5a623",
};

/** Enemy bullets are never recoloured; readability depends on them being fixed. */
export const FIXED_SLOTS: readonly Slot[] = ["hot"];

/**
 * Only the pairs that actually meet on screen, at game thresholds rather than
 * the WCAG text standard. Bullets fly over floor, never over wall, because a
 * bullet that reaches a wall is destroyed; and every sprite carries a 1px ink
 * outline, so the fill does the separating, not the outline.
 */
export const CONTRAST_RULES: readonly { fg: Slot; bg: Slot; min: number }[] = [
  { fg: "hot", bg: "shadow", min: 3.5 },
  { fg: "cool", bg: "shadow", min: 3 },
  { fg: "light", bg: "shadow", min: 1.5 },
];

/**
 * The two bullet families separate by hue, not by luminance: both are bright
 * saturated colours and their contrast ratio is only about 1.26:1. That is
 * deliberate. Silhouette is the primary guarantee, which is why the asset spec
 * requires enemy bullets to be circles and player bullets to be diamonds,
 * bolts and stars. Hue is the secondary one, checked here.
 */
export const MIN_BULLET_HUE_SEPARATION_DEG = 90;

/** Shortest angular distance between two hues, in degrees. */
export function hueSeparation(a: string, b: string): number {
  const d = Math.abs(rgbToHsl(a)[0] - rgbToHsl(b)[0]) % 360;
  return d > 180 ? 360 - d : d;
}

/* ------------------------------ colour maths ------------------------------ */

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const srgb = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function rgbToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0))
    : max === g ? (b - r) / d + 2
    : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255);
}

/* ------------------------------- derivation ------------------------------- */

export const HUE_SHIFT_DEG = 12;
/** Lightness multipliers applied to the background-ish slots. */
const BRIGHTNESS_STEPS = [0.85, 1.0, 1.15, 1.3] as const;
const DIM_STEP = 0;
const BRIGHT_STEP = 2;
const RECOLOURABLE: readonly Slot[] = ["shadow", "body", "light"];

export interface DerivedPalette {
  readonly palette: Palette;
  readonly mood: Mood;
  /** How far brightness had to be pushed to satisfy the contrast rules. */
  readonly brightnessStep: number;
  readonly adjustedForContrast: boolean;
}

export function particleScale(mood: Mood): number {
  return mood.particle_intensity === "busy" ? 1.4 : 0.6;
}

function applyMood(base: Palette, mood: Mood, step: number): Palette {
  const dir = mood.temperature === "warm" ? 1 : -1;
  const mul = BRIGHTNESS_STEPS[Math.max(0, Math.min(BRIGHTNESS_STEPS.length - 1, step))]!;
  const out: Record<Slot, string> = { ...base };
  for (const slot of RECOLOURABLE) {
    const [h, s, l] = rgbToHsl(base[slot]);
    out[slot] = hslToHex(h + dir * HUE_SHIFT_DEG, s, Math.max(0.03, Math.min(0.92, l * mul)));
  }
  return out;
}

export function violations(p: Palette): string[] {
  return CONTRAST_RULES.flatMap((r) => {
    const got = contrastRatio(p[r.fg], p[r.bg]);
    return got < r.min ? [`${r.fg} on ${r.bg} is ${got.toFixed(2)}:1, needs ${r.min}:1`] : [];
  });
}

/** The requested step first, then nearest neighbours outward. */
export function candidateSteps(start: number): number[] {
  const n = BRIGHTNESS_STEPS.length;
  const clamped = Math.max(0, Math.min(n - 1, start));
  const out = [clamped];
  for (let d = 1; d < n; d++)
    for (const s of [clamped - d, clamped + d])
      if (s >= 0 && s < n) out.push(s);
  return out;
}

/**
 * Derives the room palette, then walks brightness outward from the requested
 * value until the contrast rules hold. The search goes both ways on purpose:
 * this is a light-on-dark game, so a brighter floor *reduces* contrast against
 * the bright enemy-bullet colour, and always stepping toward `bright` would
 * make the very failure it is meant to repair worse.
 *
 * If no step passes, the base palette is returned: a legible room the Director
 * did not ask for beats an illegible one it did.
 */
export function derivePalette(mood: Mood, base: Palette = BASE_PALETTE): DerivedPalette {
  const start = mood.brightness === "dim" ? DIM_STEP : BRIGHT_STEP;
  for (const step of candidateSteps(start)) {
    const palette = applyMood(base, mood, step);
    if (violations(palette).length === 0)
      return { palette, mood, brightnessStep: step, adjustedForContrast: step !== start };
  }
  return { palette: base, mood, brightnessStep: -1, adjustedForContrast: true };
}

/** The substitution map a renderer applies to an indexed sprite sheet. */
export function substitution(derived: DerivedPalette, base: Palette = BASE_PALETTE): Map<string, string> {
  const map = new Map<string, string>();
  for (const slot of SLOTS) {
    if (FIXED_SLOTS.includes(slot)) continue;
    if (base[slot] !== derived.palette[slot]) map.set(base[slot].toLowerCase(), derived.palette[slot].toLowerCase());
  }
  return map;
}
