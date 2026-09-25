/**
 * A sprite model's palette: material ramps, darkest first (doc 016).
 *
 * The palette is found from a delivered figure by sorting its pixels into
 * materials **first** and clustering within each, so an accent — an eye, a
 * gem — keeps its own shades rather than losing every vote to the cloth
 * around it. Measured on the player, clustering the whole figure at 24
 * colours lost the eyes.
 */

export type Rgb = readonly [number, number, number];

/** How a material is recognised in a delivered figure. The first rule to match wins. */
export interface MaterialRule {
  readonly material: string;
  /** Shades to find. */
  readonly shades: number;
  /** Hue range in degrees (wrapping allowed: [330, 20]), saturation and lightness ranges, 0..1. */
  readonly hue?: readonly [number, number];
  readonly sat?: readonly [number, number];
  readonly light?: readonly [number, number];
}

export interface Palette {
  /** Material → ramp, darkest first, as `#rrggbb`. `outline` is always present, one shade. */
  readonly ramps: Readonly<Record<string, readonly string[]>>;
}

export function hsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

export const luma = ([r, g, b]: Rgb): number => r * 0.3 + g * 0.59 + b * 0.11;

export const hex = ([r, g, b]: Rgb): string =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

export const rgb = (h: string): Rgb =>
  [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const inRange = (v: number, r: readonly [number, number] | undefined) => !r || (v >= r[0] && v <= r[1]);
const inHue = (h: number, r: readonly [number, number] | undefined) =>
  !r || (r[0] <= r[1] ? h >= r[0] && h <= r[1] : h >= r[0] || h <= r[1]);

export function classify(c: Rgb, rules: readonly MaterialRule[]): string | null {
  const [h, s, l] = hsl(c);
  for (const r of rules) if (inHue(h, r.hue) && inRange(s, r.sat) && inRange(l, r.light)) return r.material;
  return null;
}

const d2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** k-means over colours, seeded along luminance so the result is deterministic. */
export function cluster(cols: readonly Rgb[], k: number): Rgb[] {
  if (cols.length === 0) return [];
  const sorted = [...cols].sort((a, b) => luma(a) - luma(b));
  let c: Rgb[] = [];
  for (let i = 0; i < k; i++) c.push(sorted[Math.min(sorted.length - 1, Math.floor(((i + 0.5) * sorted.length) / k))]!);
  for (let it = 0; it < 40; it++) {
    const acc = c.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (const p of cols) {
      let best = 0;
      for (let j = 1; j < c.length; j++) if (d2(p, c[j]!) < d2(p, c[best]!)) best = j;
      const a = acc[best]!;
      a.r += p[0]; a.g += p[1]; a.b += p[2]; a.n++;
    }
    c = c.map((o, j) => { const a = acc[j]!; return a.n ? [a.r / a.n, a.g / a.n, a.b / a.n] as Rgb : o; });
  }
  const seen = new Set<string>();
  return c.map((v) => v.map(Math.round) as unknown as Rgb)
    .filter((v) => (seen.has(hex(v)) ? false : (seen.add(hex(v)), true)))
    .sort((a, b) => luma(a) - luma(b));
}

/**
 * The palette of a figure. `outline` is the darkest colour common enough to
 * be a line (the sheet's own ink); every other pixel goes to its material and
 * is clustered there. A rule set need not be exhaustive.
 */
export function findPalette(pixels: readonly Rgb[], rules: readonly MaterialRule[], outlineLumaMax = 40): Palette {
  const outline = pixels.filter((p) => luma(p) <= outlineLumaMax);
  const byMaterial = new Map<string, Rgb[]>();
  for (const p of pixels) {
    if (luma(p) <= outlineLumaMax) continue;
    const m = classify(p, rules);
    if (m) (byMaterial.get(m) ?? byMaterial.set(m, []).get(m)!).push(p);
  }
  const ramps: Record<string, string[]> = {
    outline: [hex(cluster(outline.length ? outline : [[16, 12, 24]], 1)[0]!)],
  };
  for (const r of rules) {
    const got = byMaterial.get(r.material);
    if (got?.length) ramps[r.material] = cluster(got, r.shades).map(hex);
  }
  // Pixels no rule claims do not shape any ramp, so a stray tone cannot drag
  // one; `quantise` sends them to the nearest shade of any material.
  return { ramps };
}

/** The shade a colour quantises to: by material rule first, then nearest within it. */
export function quantise(c: Rgb, palette: Palette, rules: readonly MaterialRule[], outlineLumaMax = 40): { material: string; shade: number } {
  if (luma(c) <= outlineLumaMax) return { material: "outline", shade: 0 };
  const ruled = classify(c, rules);
  const candidates = ruled && palette.ramps[ruled] ? [ruled] : Object.keys(palette.ramps);
  let best = { material: "outline", shade: 0 };
  let bd = Infinity;
  for (const m of candidates)
    palette.ramps[m]!.forEach((h, shade) => {
      const d = d2(c, rgb(h));
      if (d < bd) { bd = d; best = { material: m, shade }; }
    });
  return best;
}
