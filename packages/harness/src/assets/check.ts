import { loadModel, modelFrameNames, modelNames } from "./models.ts";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  MANIFEST, SIZE, ART_SCALE, MAX_SOFT_ALPHA_SHARE,
  MAX_FRINGE_HUE_DEG, MAX_FRINGE_SHARE, MIN_FRINGE_SAMPLE,
  MIN_BULLET_HUE_SEPARATION_DEG,
} from "./manifest.ts";
import type { FrameSpec } from "./manifest.ts";
import { isProtected, moodTransform } from "../../../core/src/render/mood.ts";
import type { Mood } from "../../../core/src/types.ts";

const ALL_MOODS: Mood[] = (["cold", "warm"] as const).flatMap((t) =>
  (["dim", "bright"] as const).flatMap((b) =>
    (["calm", "busy"] as const).map((p) => ({ temperature: t, brightness: b, particle_intensity: p })),
  ),
);

export interface Atlas {
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
}

export interface Violation {
  rule: string;
  frame: string | null;
  detail: string;
}

export interface Report {
  ok: boolean;
  checked: number;
  /** True when the delivery is the generated stand-in rather than real art. */
  placeholder: boolean;
  violations: Violation[];
  /** Dominant hue per frame, in degrees, for the bullet separation check. */
  dominantHue: Record<string, number>;
}

/* --------------------------------- colour --------------------------------- */

/**
 * `hsl` into a reused buffer, for the per-pixel loop: a fresh tuple for each
 * of a sheet's sixteen million pixels was a fifth of a check spent collecting
 * garbage.
 */
const HSL = new Float64Array(3);
function hslInto(r: number, g: number, b: number): Float64Array {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) { HSL[0] = 0; HSL[1] = 0; HSL[2] = l; return HSL; }
  const d = max - min;
  HSL[1] = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  HSL[0] = 60 * (
    max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0))
    : max === gn ? (bn - rn) / d + 2
    : (rn - gn) / d + 4);
  HSL[2] = l;
  return HSL;
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0))
    : max === gn ? (bn - rn) / d + 2
    : (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Circular mean of the saturated opaque hues, which is the sprite's identity. */
function dominantHue(samples: readonly [number, number][]): number {
  let x = 0, y = 0;
  for (const [h, s] of samples) {
    x += Math.cos((h * Math.PI) / 180) * s;
    y += Math.sin((h * Math.PI) / 180) * s;
  }
  return hueOfSums(x, y);
}

/** `dominantHue` from its running sums, for a loop that does not keep the samples. */
function hueOfSums(x: number, y: number): number {
  if (x === 0 && y === 0) return 0;
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/**
 * How a body is separated from the floor it stands on.
 *
 * The old rule was a single number: an enemy's **mean** luminance had to sit
 * twelve points off the floor's. It is the right idea measured the wrong way,
 * and measuring it that way is what made the roster glow. A mean has no
 * structure — a body of black ink and white plate averages to exactly the
 * floor and scores zero, while a body that is uniformly pale scores well —
 * so the cheapest way to satisfy it was to scale every ramp up until the
 * whole figure was brighter than the stone. In a bright room the mood then
 * lifted it another 14% and the roster read as pale blobs that glow.
 *
 * What actually makes a body readable is that **most of its pixels** differ
 * from the floor, in value *or* in hue. Its outline counts, because two rings
 * of near-black ink against grey stone is separation and always was. Its
 * accents count, because a cyan eye on a blue-grey floor is separation even
 * at the same value. So the rule is a share, not a mean, and a body may be
 * darker than the floor as readily as lighter — which is what a solid thing
 * in a lit room ought to be.
 *
 * It is judged **as the moods tint it**. A mood multiplies lightness by 1.14
 * or 0.86, so a dim room shrinks every gap by a seventh and a bright one
 * clips the top of the ramp toward the floor's own rise; a body has to hold
 * up in the worst of them, not in the untinted sheet nobody ever sees.
 */
const FLOOR_SEPARATION_LUMA = 12;
/** Degrees of hue, at real saturation, that separate a pixel whatever its value. */
const FLOOR_SEPARATION_HUE_DEG = 40;
const FLOOR_SEPARATION_MIN_SATURATION = 0.25;
/** Share of a body's pixels that must be separated, in every mood. */
const MIN_FLOOR_SEPARATION_SHARE = 0.55;

/** The floor's mean luminance and its dominant hue, which bodies are read against. */
function floorStats(png: PNG, atlas: Atlas): { mean: number; hue: number } | null {
  let sum = 0, n = 0;
  const hues: [number, number][] = [];
  for (const [name, rect] of Object.entries(atlas.frames)) {
    // The delivered floor; the finer grains are drawn from it.
    if (!/^tile_floor_\d$/.test(name)) continue;
    for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
      const i = ((rect.y + y) * png.width + (rect.x + x)) * 4;
      if (!png.data[i + 3]) continue;
      sum += 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
      n++;
      const [h, s, l] = hsl(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
      if (s > FLOOR_SEPARATION_MIN_SATURATION && l > 0.12) hues.push([h, s]);
    }
  }
  return n ? { mean: sum / n, hue: dominantHue(hues) } : null;
}

/* ------------------------------ floor grain ------------------------------- */

/**
 * **Everything that lies in the floor layer is drawn at the floor's own art
 * pixel**, and this is how that is measured rather than trusted.
 *
 * A floor tile and a hazard plate are both 64 art px wide and both drawn at
 * `1 / ART_SCALE`, so a frame's *size* says nothing about the size of the
 * pixels inside it. The spike plate shipped as a 32 px drawing scaled up 2x
 * before it was fitted: same rectangle, same frame, holes and rivets twice as
 * coarse as the stones they sat between. It is exactly the defect a size
 * check cannot see, and the player saw it at once.
 *
 * What gives it away is **where the drawing's edges fall**. In art drawn one
 * pixel at a time, a colour change is as likely at an odd column as at an
 * even one. In a drawing doubled on to the grid, every change lands on an
 * even boundary and the odd share collapses — 31% on the delivered plate
 * against 51% on the floor it lay in. Counting seams needs no knowledge of
 * what the frame depicts, so a brushed metal plate, a mossy decal and a stone
 * tile are all judged by the same number.
 *
 * Flat art has few seams to count, so a frame is only judged once it has
 * enough of them to mean something.
 */
const FLOOR_LAYER = /^(tile_|hazard_|deco_)/;
/**
 * How far under the floor's own odd share a frame in that layer may sit.
 *
 * Measured rather than picked: across the delivered terrain, the hazards and
 * the decals the share runs 47.5% to 51%, and the doubled plate sat at 31%.
 * Six points is well clear of the spread and nowhere near the defect.
 */
export const MAX_FLOOR_GRAIN_DRIFT = 0.06;
/** Too few edges to read a stride from; a nearly flat frame is not evidence either way. */
export const MIN_FLOOR_GRAIN_SEAMS = 200;

/**
 * The share of a frame's colour changes that fall on an odd coordinate. Half
 * is art at its own pixel; near zero is art that was doubled.
 */
export function grainShare(
  png: PNG, rect: { x: number; y: number; w: number; h: number },
): { seams: number; odd: number } {
  const at = (x: number, y: number): number => {
    const i = ((y * png.width + x) << 2);
    return png.data[i]! * 16777216 + (png.data[i + 1]! << 16) + (png.data[i + 2]! << 8) + png.data[i + 3]!;
  };
  let odd = 0, even = 0;
  for (let y = 0; y < rect.h; y++)
    for (let x = 1; x < rect.w; x++)
      if (at(rect.x + x, rect.y + y) !== at(rect.x + x - 1, rect.y + y)) { if (x & 1) odd++; else even++; }
  for (let x = 0; x < rect.w; x++)
    for (let y = 1; y < rect.h; y++)
      if (at(rect.x + x, rect.y + y) !== at(rect.x + x, rect.y + y - 1)) { if (y & 1) odd++; else even++; }
  const seams = odd + even;
  return { seams, odd: seams ? odd / seams : 0 };
}

/* --------------------------------- check ---------------------------------- */

export function checkAssets(dir: string): Report {
  // Only the names: composing every model frame to read its key was over
  // half of what a check cost.
  const composed = new Set(modelNames().flatMap((n) => modelFrameNames(loadModel(n))));
  const violations: Violation[] = [];
  const dominant: Record<string, number> = {};
  const saturatedShare: Record<string, number> = {};
  const meanLuminance: Record<string, number> = {};
  const add = (rule: string, frame: string | null, detail: string) =>
    violations.push({ rule, frame, detail });

  const pngPath = join(dir, "sprites.png");
  const jsonPath = join(dir, "sprites.json");
  for (const p of [pngPath, jsonPath])
    if (!existsSync(p)) add("delivery", null, `missing file: ${p}`);
  if (violations.length) return { ok: false, checked: 0, placeholder: false, violations, dominantHue: dominant };

  let atlas: Atlas;
  try {
    atlas = JSON.parse(readFileSync(jsonPath, "utf8")) as Atlas;
  } catch (e) {
    add("delivery", null, `sprites.json is not valid JSON: ${(e as Error).message}`);
    return { ok: false, checked: 0, placeholder: false, violations, dominantHue: dominant };
  }
  if (!atlas.frames || typeof atlas.frames !== "object") {
    add("delivery", null, "sprites.json has no `frames` object");
    return { ok: false, checked: 0, placeholder: false, violations, dominantHue: dominant };
  }

  const png = PNG.sync.read(readFileSync(pngPath));

  const floor = floorStats(png, atlas);
  // Every lightness a mood can apply, so a body is judged in the worst of them.
  const moodLightness = [1, ...new Set(ALL_MOODS.map((m) => moodTransform(m).lightnessMul))];

  const expected = new Map<string, FrameSpec>(MANIFEST.map((f) => [f.name, f]));
  for (const name of expected.keys())
    if (!(name in atlas.frames)) add("completeness", name, "frame missing from the sheet");
  for (const name of Object.keys(atlas.frames))
    if (!expected.has(name)) add("completeness", name, "frame is not in the manifest");

  let checked = 0;
  for (const [name, spec] of expected) {
    const rect = atlas.frames[name];
    if (!rect) continue;
    checked++;

    const wantW = spec.width ?? SIZE[spec.size];
    const wantH = spec.height ?? SIZE[spec.size];
    if (rect.w !== wantW || rect.h !== wantH)
      add("size", name, `expected ${wantW}x${wantH}, got ${rect.w}x${rect.h}`);
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > png.width || rect.y + rect.h > png.height) {
      add("bounds", name, `rect ${rect.x},${rect.y} ${rect.w}x${rect.h} falls outside the sheet`);
      continue;
    }

    // The saturated samples, as `dominantHue`'s running sums and a count.
    let satX = 0, satY = 0, satN = 0;
    const edges: { hue: number; x: number; y: number }[] = [];
    let opaque = 0, soft = 0, clear = 0, protectedPixels = 0, luminanceSum = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    // How much of this body is separated from the floor, per mood lightness.
    // Bodies at body scale. The boss fills a quarter of the room and cannot
    // be lost in the stone, so it is banded in value with the rest of the
    // roster (`enemyValueBand`) without being held to this.
    const isBody = name.startsWith("enemy_");
    const separated = isBody && floor ? moodLightness.map(() => 0) : null;

    for (let y = 0; y < rect.h; y++)
      for (let x = 0; x < rect.w; x++) {
        const i = ((rect.y + y) * png.width + (rect.x + x)) * 4;
        const a = png.data[i + 3]!;
        if (a === 0) { clear++; continue; }
        opaque++;
        luminanceSum += 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
        const c = hslInto(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
        const h = c[0]!, s = c[1]!, lightness = c[2]!;
        if (separated && floor) {
          const luma = 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
          const byHue = s >= FLOOR_SEPARATION_MIN_SATURATION
            && hueDistance(h, floor.hue) >= FLOOR_SEPARATION_HUE_DEG;
          for (let k = 0; k < moodLightness.length; k++) {
            const mul = moodLightness[k]!;
            if (byHue || Math.abs(Math.min(255, luma * mul) - Math.min(255, floor.mean * mul)) >= FLOOR_SEPARATION_LUMA)
              separated[k]!++;
          }
        }
        if (lightness > 0.12 && isProtected(h, s)) protectedPixels++;
        if (a < 255) {
          soft++;
          // Near-black outlines can have a numerically saturated hue while
          // looking black. They are not a coloured matte.
          if (s > 0.4 && lightness > 0.12) edges.push({ hue: h, x, y });
        }
        // Near-black outlines can have an arbitrary numerical hue while
        // looking black. Exclude them here for the same reason they are
        // excluded from the coloured-fringe sample above.
        else if (s > 0.25 && lightness > 0.12) {
          satX += Math.cos((h * Math.PI) / 180) * s;
          satY += Math.sin((h * Math.PI) / 180) * s;
          satN++;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

    if (maxX < 0) { add("empty", name, "frame is fully transparent"); continue; }
    if (clear === 0 && spec.centred)
      add("margin", name, "entity sprite has no transparent margin");

    /*
     * A piecewise animation must not cut a transparent scanline through a
     * body. This is measured from alpha rather than colour so a legitimate
     * dark outline or armour joint is not mistaken for a crack. A row only
     * counts where the same columns are painted immediately above and below;
     * exterior gaps, floating weapons and separated limbs therefore do not.
     */
    if (name.startsWith("enemy_")) {
      const threshold = Math.max(8, Math.floor(rect.w * 0.15));
      for (let y = 1; y < rect.h - 1; y++) {
        let bridged = 0;
        let support = 0;
        for (let x = 0; x < rect.w; x++) {
          const i = ((rect.y + y) * png.width + rect.x + x) * 4;
          const stride = png.width * 4;
          if (png.data[i - stride + 3] === 0 || png.data[i + stride + 3] === 0) continue;
          support++;
          if (png.data[i + 3] === 0) bridged++;
        }
        if (bridged >= threshold && bridged / Math.max(1, support) >= 0.8) {
          add(
            "transparent-seam",
            name,
            `row ${y} has ${bridged} transparent pixels bracketed by painted body pixels`,
          );
          break;
        }
      }
    }

    // Soft alpha belongs on edges. Half a sprite at partial alpha is a matte,
    // not anti-aliasing, and it reads as washed out in game.
    const softShare = soft / opaque;
    if (softShare > MAX_SOFT_ALPHA_SHARE)
      add("soft-alpha", name, `${(softShare * 100).toFixed(0)}% of opaque pixels are partially transparent, limit ${MAX_SOFT_ALPHA_SHARE * 100}%`);

    if (!spec.mayUseHot && !name.startsWith("ui_") && !name.startsWith("icon_") && protectedPixels > 0)
      add("protected-band", name, `${protectedPixels} visible pixels use the reserved enemy-bullet hue band`);

    const hue = hueOfSums(satX, satY);
    dominant[name] = hue;
    saturatedShare[name] = satN / opaque;
    meanLuminance[name] = luminanceSum / opaque;

    // A coloured halo means the art was matted onto a background before the
    // alpha was cut, and it shows as a rim of the wrong colour in game.
    // Needs a real sample: a handful of edge pixels on nearly hard-edged art
    // cannot distinguish a halo from one deliberate accent.
    if (edges.length >= MIN_FRINGE_SAMPLE) {
      const stray = edges.filter((edge) => {
        if (hueDistance(edge.hue, hue) <= MAX_FRINGE_HUE_DEG) return false;
        // Multicolour art has legitimate cyan staves, ivory trim and pink
        // telegraph cores. Compare such edges with nearby opaque paint rather
        // than treating every colour unlike the whole-frame mean as a halo.
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const x = edge.x + dx, y = edge.y + dy;
          if (x < 0 || y < 0 || x >= rect.w || y >= rect.h) continue;
          const i = ((rect.y + y) * png.width + rect.x + x) * 4;
          if (png.data[i + 3] !== 255) continue;
          const [nearHue, nearSaturation, nearLightness] = hsl(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
          if (nearSaturation > 0.25 && nearLightness > 0.12 && hueDistance(edge.hue, nearHue) <= MAX_FRINGE_HUE_DEG)
            return false;
        }
        return true;
      }).length;
      const share = stray / edges.length;
      if (satN > 0 && share > MAX_FRINGE_SHARE)
        add("fringe", name, `${(share * 100).toFixed(0)}% of saturated edge pixels sit more than ${MAX_FRINGE_HUE_DEG} degrees from both the dominant hue and nearby opaque paint`);
    }

    if (separated && floor && opaque) {
      const share = Math.min(...separated) / opaque;
      if (share < MIN_FLOOR_SEPARATION_SHARE)
        add("enemy-floor-contrast", name,
          `only ${(share * 100).toFixed(0)}% of its pixels read against the floor (mean ${(luminanceSum / opaque).toFixed(1)} against floor ${floor.mean.toFixed(1)}), minimum ${MIN_FLOOR_SEPARATION_SHARE * 100}%`);
    }

    // A sprite model's frame is placed by its rig, body on the origin; what it
    // holds or lunges with may carry its bounds off centre (doc 016).
    // The king's feet are registered to a fixed ground point, not the visual
    // centre of the cape + moving blade. The source exporter checks margins.
    if (spec.centred && !composed.has(name) && !/^boss_p[123]_/.test(name)) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const targetX = (rect.w - 1) / 2;
      const targetY = (rect.h - 1) / 2;
      const toleranceX = Math.max(1, rect.w * 0.06);
      const toleranceY = Math.max(1, rect.h * 0.06);
      if (Math.abs(cx - targetX) > toleranceX || Math.abs(cy - targetY) > toleranceY)
        add("centring", name, `content centre (${cx.toFixed(1)}, ${cy.toFixed(1)}) is outside the ${toleranceX.toFixed(1)}x${toleranceY.toFixed(1)}px centring tolerance`);
    }

  }

  /*
   * **The floor layer is drawn at one stride** (`grainShare`). The floor tiles
   * set it, and every hazard, decal and wall piece that lies with them is
   * held to it: a plate whose rivets are twice the size of the stones round
   * them is the one art defect the size and value checks cannot see.
   */
  {
    const floorGrain = Object.entries(atlas.frames)
      .filter(([n]) => /^tile_floor_\d$/.test(n))
      .map(([, r]) => grainShare(png, r))
      .filter((g) => g.seams >= MIN_FLOOR_GRAIN_SEAMS);
    if (floorGrain.length > 0) {
      const reference = floorGrain.reduce((a, g) => a + g.odd, 0) / floorGrain.length;
      const floor = reference - MAX_FLOOR_GRAIN_DRIFT;
      for (const [name, rect] of Object.entries(atlas.frames)) {
        if (!FLOOR_LAYER.test(name)) continue;
        const g = grainShare(png, rect);
        // A nearly flat frame has no stride to read, so it is not judged.
        if (g.seams < MIN_FLOOR_GRAIN_SEAMS || g.odd >= floor) continue;
        add("floor-grain", name,
          `only ${(g.odd * 100).toFixed(0)}% of its ${g.seams} edges fall on an odd pixel, against the `
          + `floor's ${(reference * 100).toFixed(0)}%: its pixels are coarser than the floor it lies in`);
      }
    }
  }

  // The bolt is a tall world-space strike whose landing point is the bottom
  // centre of its frame. These geometry checks keep a visually plausible
  // sprite from drifting away from the procedural ground marker. Its light
  // must also remain decisively above the floor so it cannot read as a crack.
  const boltRect = atlas.frames.vfx_bolt_1;
  if (boltRect) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let bottomCentre = false;
    for (let y = 0; y < boltRect.h; y++) for (let x = 0; x < boltRect.w; x++) {
      const i = ((boltRect.y + y) * png.width + boltRect.x + x) * 4;
      if (png.data[i + 3] === 0) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (y === boltRect.h - 1 && Math.abs(x - (boltRect.w - 1) / 2) <= 8)
        bottomCentre = true;
    }
    const contentW = maxX - minX + 1;
    const contentH = maxY - minY + 1;
    if (!bottomCentre)
      add("lightning-bolt", "vfx_bolt_1", "brightest frame does not land on the bottom-centre anchor");
    if (contentH < contentW * 2)
      add("lightning-bolt", "vfx_bolt_1", `content is ${contentW}x${contentH}; the strike must read vertically`);

    const boltMean = meanLuminance.vfx_bolt_1 ?? NaN;
    const floorMean = floor?.mean ?? NaN;
    if (Number.isFinite(floorMean) && Number.isFinite(boltMean) && boltMean < floorMean + 20)
      add(
        "lightning-bolt",
        "vfx_bolt_1",
        `mean luminance ${boltMean.toFixed(1)} is not at least 20 above the floor mean ${floorMean.toFixed(1)}`,
      );
  }

  // Colour cannot be guaranteed per slot any more, so the readability rule is
  // measured from the art itself: the two bullet families must stay apart.
  const hueOf = (prefix: string) => {
    const hs = Object.entries(dominant).filter(([n]) => n.startsWith(prefix)).map(([, h]) => h);
    return hs.length ? dominantHue(hs.map((h) => [h, 1] as [number, number])) : null;
  };
  const enemy = hueOf("bullet_enemy");
  const player = hueOf("bullet_player");
  if (enemy !== null && player !== null) {
    const gap = hueDistance(enemy, player);
    if (gap < MIN_BULLET_HUE_SEPARATION_DEG)
      add("bullet-separation", null, `enemy and player bullets are ${gap.toFixed(0)} degrees apart in hue, minimum ${MIN_BULLET_HUE_SEPARATION_DEG}`);

    // The base sheet is not what the player sees. Enemy bullets are held
    // fixed by the protected band while everything else rotates with the
    // mood, so the separation has to survive the largest shift any mood
    // applies, not only hold at rest.
    const worstShift = Math.max(...ALL_MOODS.map((m) => Math.abs(moodTransform(m).hueShiftDeg)));
    if (gap - worstShift < MIN_BULLET_HUE_SEPARATION_DEG)
      add(
        "bullet-separation-tinted",
        null,
        `separation falls to ${(gap - worstShift).toFixed(0)} degrees under the strongest mood tint of ${worstShift} degrees, minimum ${MIN_BULLET_HUE_SEPARATION_DEG}`,
      );
  }

  const ok = violations.length === 0;
  const placeholder = existsSync(join(dir, ".placeholder"));
  if (ok)
    writeFileSync(
      join(dir, "palette.json"),
      JSON.stringify({ art: "pixel-look-raster", artScale: ART_SCALE, dominantHue: dominant }, null, 2) + "\n",
    );
  return { ok, checked, placeholder, violations, dominantHue: dominant };
}

export function formatReport(r: Report): string {
  if (r.ok)
    return `assets: OK, ${r.checked} frames checked${r.placeholder ? " (placeholder art, not the real delivery)" : ""}`;
  const byRule = new Map<string, Violation[]>();
  for (const v of r.violations) byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v]);
  const lines = [`assets: FAIL, ${r.violations.length} violations across ${r.checked} frames`];
  for (const [rule, vs] of byRule) {
    lines.push(`  ${rule} (${vs.length})`);
    for (const v of vs.slice(0, 8)) lines.push(`    ${v.frame ?? "-"}: ${v.detail}`);
    if (vs.length > 8) lines.push(`    ... and ${vs.length - 8} more`);
  }
  return lines.join("\n");
}
