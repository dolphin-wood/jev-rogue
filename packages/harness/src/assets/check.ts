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
  if (x === 0 && y === 0) return 0;
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/* --------------------------------- check ---------------------------------- */

export function checkAssets(dir: string): Report {
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

    const saturated: [number, number][] = [];
    const edges: { hue: number; x: number; y: number }[] = [];
    let opaque = 0, soft = 0, clear = 0, protectedPixels = 0, luminanceSum = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (let y = 0; y < rect.h; y++)
      for (let x = 0; x < rect.w; x++) {
        const i = ((rect.y + y) * png.width + (rect.x + x)) * 4;
        const a = png.data[i + 3]!;
        if (a === 0) { clear++; continue; }
        opaque++;
        luminanceSum += 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
        const [h, s, lightness] = hsl(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
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
        else if (s > 0.25 && lightness > 0.12) saturated.push([h, s]);
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

    const hue = dominantHue(saturated);
    dominant[name] = hue;
    saturatedShare[name] = saturated.length / opaque;
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
      if (saturated.length > 0 && share > MAX_FRINGE_SHARE)
        add("fringe", name, `${(share * 100).toFixed(0)}% of saturated edge pixels sit more than ${MAX_FRINGE_HUE_DEG} degrees from both the dominant hue and nearby opaque paint`);
    }

    if (spec.centred) {
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

  const floorLuminances = Object.entries(meanLuminance)
    .filter(([name]) => name.startsWith("tile_floor_"))
    .map(([, value]) => value);
  const floorMean = floorLuminances.reduce((sum, value) => sum + value, 0) / floorLuminances.length;
  for (const [name, value] of Object.entries(meanLuminance)) {
    if (!name.startsWith("enemy_")) continue;
    const gap = Math.abs(value - floorMean);
    if (Number.isFinite(floorMean) && gap < 12)
      add("enemy-floor-contrast", name, `mean luminance ${value.toFixed(1)} is only ${gap.toFixed(1)} from floor mean ${floorMean.toFixed(1)}, minimum 12`);
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
