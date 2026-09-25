/**
 * **A thrown crescent of energy, drawn in the game's pixels** — the enchant's
 * wave (doc 006) and the king's sword wave (doc 020) share it.
 *
 * After Getsuga Tenshō: a solid crescent, fat in the middle and drawn to two
 * sharp tips, its concave side toward whoever threw it. From its leading edge
 * in: a dark lip just outside the edge, so it stands off a floor of any hue
 * (the one edge line it has — nothing round the back or the tips); a thin
 * band of the light; the white-hot core; and the light again, broken up and
 * ragged along the trailing side where the energy tears off. The edge
 * flickers — a few texels of the lip and the ragged tail change every other
 * frame — and as it fades the tips are eaten first, so it dissolves inward
 * to its middle rather than blinking out.
 *
 * Every mark lands on the art's own texel grid (`TELE_PIX`), in hard bands
 * and whole texels, run-length filled a row at a time: no gradient, no
 * translucent disc, no stroke. It is the same grid the telegraphs and the
 * sprites quantise to, so it sits beside them as pixel art does.
 *
 * Headless, like `telegraph.ts`: it draws through `Pen`.
 */
import type { Pen } from "./ground.ts";
import { TELE_PIX } from "./telegraph.ts";

export interface CrescentWave {
  /** The arc's centre and radius: the leading edge is the arc at `radius`. */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** The way it faces (and flies), and half the angle it spans. */
  readonly facing: number;
  readonly half: number;
  /** Depth of the crescent at its middle, world px. */
  readonly thick: number;
  /** 1 while it flies, falling to 0 as it dissolves: eats the tips, thins it, fades it. */
  readonly life: number;
  /** A launch flash: the whole crescent white-hot while this is set. */
  readonly flash: boolean;
  /** Frame clock, for the flicker. */
  readonly tick: number;
  /** A per-wave number, so two waves do not flicker in step. */
  readonly seed: number;
  readonly palette: WavePalette;
}

/** Dark to bright: the lip outside the edge, the light, the light half-way to white, and the core. */
export interface WavePalette {
  readonly lip: number;
  readonly aura: number;
  readonly mid: number;
  readonly core: number;
}

/** Mixes two colours, `k` of the way from `a` to `b`. */
export function mix(a: number, b: number, k: number): number {
  const ch = (s: number) => {
    const x = (a >> s) & 255, y = (b >> s) & 255;
    return Math.round(x + (y - x) * k) << s;
  };
  return ch(16) | ch(8) | ch(0);
}

/** A palette from a spell's light: its glow as the aura, white at the core, the lip its dark. */
export function wavePalette(glow: number, core: number): WavePalette {
  return { lip: mix(glow, 0x0d0b1f, 0.78), aura: glow, mid: mix(glow, core, 0.55), core: 0xffffff };
}

/** A hash of three integers into [0, 1). */
function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Which band a texel is in: 0 none, 1 lip, 2 aura, 3 mid, 4 core. */
function bandAt(o: CrescentWave, px: number, py: number, half: number, thick: number, flick: number): number {
  const dx = px - o.x, dy = py - o.y;
  const d = Math.hypot(dx, dy);
  let off = Math.atan2(dy, dx) - o.facing;
  off = Math.atan2(Math.sin(off), Math.cos(off));
  const u = off / half;
  if (Math.abs(u) >= 1) return 0;
  // Fat in the middle, drawn to a point at each tip.
  const h = thick * Math.pow(1 - u * u, 0.8);
  const lip = TELE_PIX * 1.5;
  if (d > o.radius + lip || d < o.radius - h) return 0;
  const ix = Math.round(px / TELE_PIX), iy = Math.round(py / TELE_PIX);
  if (d > o.radius) {
    // The lip: broken for a texel here and there, changing with the flicker.
    return hash(ix, iy, flick) < 0.18 ? 0 : 1;
  }
  const q = (o.radius - d) / Math.max(TELE_PIX, h);
  // The trailing side tears: its last stretch is ragged, and the rag moves.
  if (q > 0.72 && hash(ix, iy, flick + 7) < (q - 0.72) * 2.2) return 0;
  if (o.flash) return q < 0.85 ? 4 : 3;
  if (q < 0.12) return 3;
  if (q < 0.5 && h > TELE_PIX * 3) return 4;
  if (q < 0.7) return 3;
  return 2;
}

/**
 * Draws one crescent wave. `alpha` is the pen's opacity for the whole of it:
 * the bands are hard, and a fade is the whole shape going, which is how a
 * sprite fades.
 */
export function drawCrescentWave(pen: Pen, o: CrescentWave, alpha = 1): void {
  const life = Math.max(0, Math.min(1, o.life));
  if (life <= 0 || alpha <= 0) return;
  // The tips go first: the span closes toward the middle as it dissolves, and it thins.
  const half = o.half * (0.35 + 0.65 * life);
  const thick = o.thick * (0.45 + 0.55 * life);
  const flick = (o.tick >> 1) + o.seed * 31;
  const colours = [0, o.palette.lip, o.palette.aura, o.palette.mid, o.palette.core];
  // The rows the crescent can touch.
  const r1 = o.radius + TELE_PIX * 2;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i <= 12; i++) {
    const a = o.facing - half + (2 * half * i) / 12;
    for (const r of [o.radius - thick, r1]) {
      const x = o.x + Math.cos(a) * r, y = o.y + Math.sin(a) * r;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  const P = TELE_PIX;
  const gx0 = Math.floor(x0 / P) * P - P, gx1 = Math.ceil(x1 / P) * P + P;
  const gy0 = Math.floor(y0 / P) * P - P, gy1 = Math.ceil(y1 / P) * P + P;
  // Each texel's band once, then each band's runs a row at a time.
  const cols = Math.round((gx1 - gx0) / P) + 1, rows = Math.round((gy1 - gy0) / P) + 1;
  const grid = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) grid[j * cols + i] = bandAt(o, gx0 + i * P + P / 2, gy0 + j * P + P / 2, half, thick, flick);
  for (let band = 1; band <= 4; band++) {
    pen.fillStyle(colours[band]!, alpha);
    for (let j = 0; j < rows; j++) {
      let from = -1;
      for (let i = 0; i <= cols; i++) {
        const on = i < cols && grid[j * cols + i] === band;
        if (on && from < 0) from = i;
        else if (!on && from >= 0) { pen.fillRect(gx0 + from * P, gy0 + j * P, (i - from) * P, P); from = -1; }
      }
    }
  }
}

/**
 * Points along the crescent's trailing side, for the wisps it sheds: `n` of
 * them spread across its span, just inside its back edge.
 */
export function waveTrailPoints(o: CrescentWave, n: number): { x: number; y: number }[] {
  const half = o.half * (0.35 + 0.65 * Math.max(0, Math.min(1, o.life)));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const u = (Math.random() * 2 - 1) * 0.9;
    const a = o.facing + u * half;
    const r = o.radius - o.thick * Math.pow(1 - u * u, 0.8) * (0.6 + 0.4 * Math.random());
    out.push({ x: o.x + Math.cos(a) * r, y: o.y + Math.sin(a) * r });
  }
  return out;
}

/**
 * The delivered impact frame for an impact `t` of the way through (0 to 1),
 * always one of the three that exist. A longer-lived impact — a wave's cut, a
 * guard's clash — starts below 0, and `vfx_impact_-1` is not a frame: Phaser
 * drew the sheet's base frame for it, the whole atlas from its top-left
 * corner, which is the boss, flashed over every body a wave cut.
 */
export function impactFrame(t: number): string {
  return `vfx_impact_${Math.max(0, Math.min(2, Math.floor(Math.max(0, t) * 3)))}`;
}

/**
 * Every atlas frame the spell effects ask for by name, including delivered
 * spell animations and the reused sword, shards, glint, and impact frames.
 * A missing name is
 * not an invisible sprite in Phaser, it is the whole sheet.
 */
export const SPELL_FX_FRAMES: readonly string[] = [
  "weapon_player_sword",
  "bullet_player_a_0", "bullet_player_a_1",
  "bullet_player_c_0", "bullet_player_c_1",
  "vfx_impact_0", "vfx_impact_1", "vfx_impact_2",
  ...["launch_0", "launch_1", "fly_0", "fly_1", "fly_2", "fly_3", "dissolve_0", "dissolve_1", "dissolve_2", "dissolve_3"]
    .map((phase) => `vfx_crescent_wave_${phase}`),
  ...Array.from({ length: 4 }, (_, i) => [
    `vfx_meteor_rock_${i}`, `vfx_frost_orb_${i}`, `vfx_ball_lightning_${i}`,
    `vfx_arc_seg_${i}`, `vfx_doom_burst_${i}`, `vfx_vortex_${i}`,
    `vfx_vortex_gather_${i}`, `vfx_landing_dust_${i}`, `vfx_gas_puff_${i}`,
  ]).flat(),
  ...Array.from({ length: 5 }, (_, i) => [
    `vfx_meteor_impact_${i}`, `vfx_doom_rune_${i}`, `vfx_guard_answer_${i}`,
  ]).flat(),
  "vfx_arc_cap_0", "vfx_arc_cap_1", "vfx_contagion_glob_0", "vfx_contagion_glob_1",
];
