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
  const d = Math.sqrt(dx * dx + dy * dy);
  let off = Math.atan2(dy, dx) - o.facing;
  if (off > Math.PI) off -= Math.PI * 2;
  else if (off < -Math.PI) off += Math.PI * 2;
  if (off > Math.PI) off -= Math.PI * 2;
  else if (off < -Math.PI) off += Math.PI * 2;
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
  /*
   * **Only the ring is read.** Nothing outside radius − thick .. radius +
   * lip can be lit, and the box round a wide crescent is mostly the inside
   * of the curve: reading every texel in it was thousands of `bandAt`s a
   * wave, a frame, several waves at once. Each row reads only the one or
   * two spans of it that fall inside the ring.
   */
  const rIn = Math.max(0, o.radius - thick - P), rOut = o.radius + TELE_PIX * 1.5 + P;
  for (let j = 0; j < rows; j++) {
    const py = gy0 + j * P + P / 2;
    const dy = py - o.y;
    if (Math.abs(dy) > rOut) continue;
    const outer = Math.sqrt(rOut * rOut - dy * dy);
    const inner = Math.abs(dy) < rIn ? Math.sqrt(rIn * rIn - dy * dy) : 0;
    for (const [lo, hi] of [[o.x - outer, o.x - inner], [o.x + inner, o.x + outer]] as const) {
      const i0 = Math.max(0, Math.floor((lo - gx0) / P)), i1 = Math.min(cols - 1, Math.ceil((hi - gx0) / P));
      for (let i = i0; i <= i1; i++) grid[j * cols + i] = bandAt(o, gx0 + i * P + P / 2, py, half, thick, flick);
    }
  }
  // One pass over the grid for every band's runs (x, y, width, flattened), then each band in one colour.
  const runs: number[][] = [[], [], [], [], []];
  for (let j = 0; j < rows; j++) {
    const row = j * cols;
    let from = 0, band = grid[row]!;
    for (let i = 1; i <= cols; i++) {
      const next = i < cols ? grid[row + i]! : 0;
      if (next === band) continue;
      if (band > 0) runs[band]!.push(gx0 + from * P, gy0 + j * P, (i - from) * P);
      from = i;
      band = next;
    }
  }
  for (let band = 1; band <= 4; band++) {
    const r = runs[band]!;
    if (r.length === 0) continue;
    pen.fillStyle(colours[band]!, alpha);
    for (let k = 0; k < r.length; k += 3) pen.fillRect(r[k]!, r[k + 1]!, r[k + 2]!, P);
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

/**
 * **A straight edge of force** — the king's greatcleave (doc 020): a vertical
 * cut, so its wave is a blade of light standing on the floor and running
 * along the line of the cut, not a crescent lying on it.
 *
 * The view is three-quarter, so what stands up is drawn up the screen: a
 * sheet rising from the edge's footprint, tallest toward the front, with its
 * top edge white-hot and its foot dark. Seen side-on it is a standing blade;
 * running straight at the camera it narrows to a bright column, which is also
 * what a vertical blade coming at you looks like. The footprint — the band
 * that hits — is drawn on the floor under it in the danger colour.
 */
export interface EdgeWave {
  /** Where it started, which way it runs, and its front and back along that line. */
  readonly x: number;
  readonly y: number;
  readonly facing: number;
  readonly back: number;
  readonly front: number;
  /** Width of the footprint across the line, world px. */
  readonly width: number;
  /** Height of the standing sheet at its tallest, world px up the screen. */
  readonly rise: number;
  readonly life: number;
  readonly tick: number;
  readonly seed: number;
  readonly palette: WavePalette;
}

export function drawEdgeWave(pen: Pen, o: EdgeWave, alpha = 1): void {
  const life = Math.max(0, Math.min(1, o.life));
  if (life <= 0 || alpha <= 0) return;
  const P = TELE_PIX;
  const c = Math.cos(o.facing), s = Math.sin(o.facing);
  const rise = o.rise * (0.4 + 0.6 * life);
  const len = Math.max(P, o.front - o.back);
  const cells = new Map<number, number>();
  const put = (x: number, y: number, band: number): void => {
    const i = Math.floor(x / P), j = Math.floor(y / P);
    const k = j * 100000 + i;
    if ((cells.get(k) ?? 0) < band) cells.set(k, band);
  };
  const flick = (o.tick >> 1) + o.seed * 31;
  // The floor under it: the band that hits, in the danger colour, edged dark, with a hot seam down the cut.
  const halfW = (o.width / 2) * (0.6 + 0.4 * life);
  for (let a = 0; a <= len; a += P / 2)
    for (let b = -halfW; b <= halfW; b += P / 2) {
      const gx = o.x + c * (o.back + a) - s * b, gy = o.y + s * (o.back + a) + c * b;
      put(gx, gy, Math.abs(b) < P / 2 ? 4 : Math.abs(b) > halfW - P ? 1 : 2);
    }
  // The standing sheet: a column up the screen at every step along the line,
  // faint at its foot, brighter as it rises, white-hot along its top edge.
  for (let a = 0; a <= len; a += P / 2) {
    const t = a / len;
    const h = rise * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55) * 0.92), 0.8);
    if (h < P) continue;
    const gx = o.x + c * (o.back + a), gy = o.y + s * (o.back + a);
    const top = h - (hash(Math.floor(a / P), flick, 7) < 0.3 ? P : 0);
    for (let z = 0; z <= top; z += P / 2) {
      const u = z / Math.max(P, top);
      const band = top - z < P ? 5 : u > 0.7 ? 4 : u > 0.35 ? 3 : 2;
      put(gx, gy - z, band);
      // A wedge in section: as wide as the band at its foot, drawn to the edge at the top — so a blade
      // coming straight at the camera, which is the cleave's usual line, still reads as a blade.
      const wedge = halfW * (1 - u) * 0.8;
      for (let b = P / 2; b <= wedge; b += P / 2) {
        put(gx - s * b, gy + c * b - z, Math.min(band, 3));
        put(gx + s * b, gy - c * b - z, Math.min(band, 3));
      }
    }
  }
  const look: readonly (readonly [number, number])[] = [
    [0, 0], [o.palette.lip, 0.55], [o.palette.aura, 0.3], [o.palette.aura, 0.6], [o.palette.mid, 0.9], [o.palette.core, 1],
  ];
  for (let band = 1; band <= 5; band++) {
    pen.fillStyle(look[band]![0], alpha * look[band]![1]);
    for (const [k, v] of cells) {
      if (v !== band) continue;
      const j = Math.floor(k / 100000), i = k - j * 100000;
      pen.fillRect(i * P, j * P, P, P);
    }
  }
}

/**
 * **A run's wake as one edge** (`layWake`). The simulation lays it in short
 * stretches, each set off as the runner passes, and each rolling out on its
 * own — but drawn one by one they read as a row of separate blades. So one
 * side of a wake is drawn as a single standing sheet along a line through
 * all its stretches: at every step along the run, how far out the edge is
 * and how bright is interpolated between the two stretches either side, so
 * the edge is one continuous slant from the runner out to the oldest
 * stretch, and it fades where the stretches do.
 */
export interface WakeStretch {
  /** Centre of the stretch on the run's line, and how far out its band is. */
  readonly x: number;
  readonly y: number;
  readonly inner: number;
  readonly thick: number;
  readonly width: number;
  readonly life: number;
  /** Which stretch of the wake it is, from where the run began (`Shockwave.wakeIndex`); what `paletteOf` reads. */
  readonly index?: number;
}

export interface WakeRibbon {
  /** One side's stretches, in any order. */
  readonly stretches: readonly WakeStretch[];
  /** Which way this side rolls out, radians. */
  readonly facing: number;
  readonly rise: number;
  /** How far behind the edge its trail runs, px, fading back toward the run. */
  readonly trail: number;
  readonly tick: number;
  readonly seed: number;
  readonly palette: WavePalette;
  /**
   * A stretch's own light, by its index, when the wake's elements take turns
   * (`energyTurn`): each quad wears the palette of the stretch it starts at.
   */
  readonly paletteOf?: (index: number) => WavePalette;
}

/** The trail's steps of light, from faintest to the edge's own. */
const WAKE_TRAIL_LEVELS = 4;

/**
 * Drawn as **polygons between neighbouring stretches**, not cell by cell. A
 * wake is a hundred and fifty px of run with a sheet and a trail on each
 * side, and scan-converting that at the telegraph's half-pixel grid was
 * hundreds of thousands of cells a frame — Dash Slash dropped frames. Each
 * side is a dozen stretches, so it is a dozen quads a layer; the corners are
 * snapped to the texel grid so the edges still sit on the game's pixels.
 */
export function drawWakeRibbon(pen: Pen, o: WakeRibbon, alpha = 1): void {
  if (o.stretches.length === 0 || alpha <= 0) return;
  const P = TELE_PIX;
  const snap = (v: number): number => Math.round(v / P) * P;
  const ox = Math.cos(o.facing), oy = Math.sin(o.facing);
  // Along the run: square to the outward direction.
  const ax = -oy, ay = ox;
  const x0 = o.stretches[0]!.x, y0 = o.stretches[0]!.y;
  const pts = o.stretches.map((s) => ({ s, t: (s.x - x0) * ax + (s.y - y0) * ay })).sort((a, b) => a.t - b.t);
  // The ends of the edge are the outer halves of the end stretches.
  const first = pts[0]!, last = pts[pts.length - 1]!;
  const verts = [{ ...first, t: first.t - first.s.width / 2 }, ...pts, { ...last, t: last.t + last.s.width / 2 }];
  const at = (t: number, d: number, up = 0): [number, number] =>
    [snap(x0 + ax * t + ox * d), snap(y0 + ay * t + oy * d - up)];
  const quad = (colour: number, a: number, p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number]): void => {
    if (a <= 0.01) return;
    pen.fillStyle(colour, Math.min(1, a) * alpha);
    pen.beginPath();
    pen.moveTo(p0[0], p0[1]);
    pen.lineTo(p1[0], p1[1]);
    pen.lineTo(p2[0], p2[1]);
    pen.lineTo(p3[0], p3[1]);
    pen.fillPath();
  };
  const flick = hash(o.tick >> 2, o.seed, 5) < 0.25 ? P : 0;
  for (let i = 0; i + 1 < verts.length; i++) {
    const A = verts[i]!, B = verts[i + 1]!;
    if (B.t - A.t < 0.01) continue;
    const la = Math.max(0, Math.min(1, A.s.life)), lb = Math.max(0, Math.min(1, B.s.life));
    const life = (la + lb) / 2;
    if (life <= 0) continue;
    const pal = o.paletteOf && A.s.index !== undefined ? o.paletteOf(A.s.index) : o.palette;
    const depA = A.s.thick * (0.6 + 0.4 * la), depB = B.s.thick * (0.6 + 0.4 * lb);
    const inA = A.s.inner, inB = B.s.inner;
    /*
     * **The trail**: the ground the edge has just crossed, lit behind it in
     * steps that fade back toward the run, fainter as the stretch dies.
     */
    const fromA = Math.max(2, inA - o.trail), fromB = Math.max(2, inB - o.trail);
    for (let k = 0; k < WAKE_TRAIL_LEVELS; k++) {
      const u0 = k / WAKE_TRAIL_LEVELS, u1 = (k + 1) / WAKE_TRAIL_LEVELS;
      const dA0 = fromA + (inA - fromA) * u0, dA1 = fromA + (inA - fromA) * u1;
      const dB0 = fromB + (inB - fromB) * u0, dB1 = fromB + (inB - fromB) * u1;
      quad(k === WAKE_TRAIL_LEVELS - 1 ? pal.mid : pal.aura, 0.4 * u1 * life,
        at(A.t, dA0), at(B.t, dB0), at(B.t, dB1), at(A.t, dA1));
    }
    // The band on the floor that hits: dark-lipped, lit, its leading edge bright.
    quad(pal.lip, 0.55, at(A.t, inA), at(B.t, inB), at(B.t, inB + depB), at(A.t, inA + depA));
    quad(pal.aura, 0.6 * life, at(A.t, inA + P), at(B.t, inB + P), at(B.t, inB + depB - P), at(A.t, inA + depA - P));
    quad(pal.mid, 0.9 * life, at(A.t, inA + depA - 2 * P), at(B.t, inB + depB - 2 * P), at(B.t, inB + depB), at(A.t, inA + depA));
    /*
     * The standing sheet on the band's leading edge, one continuous wall up
     * the screen: lower as a stretch fades, and its hot top edge the first
     * thing it loses.
     */
    const hA = o.rise * (0.35 + 0.65 * la), hB = o.rise * (0.35 + 0.65 * lb);
    const fA = inA + depA, fB = inB + depB;
    const tier = (u0: number, u1: number, colour: number, a: number): void =>
      quad(colour, a, at(A.t, fA, hA * u0), at(B.t, fB, hB * u0), at(B.t, fB, hB * u1), at(A.t, fA, hA * u1));
    tier(0, 0.35, pal.aura, 0.45 * life);
    tier(0.35, 0.8, life > 0.25 ? pal.mid : pal.aura, 0.8 * life);
    const rim = Math.max(0.8, 1 - (2 * P + flick) / Math.max(P, (hA + hB) / 2));
    tier(0.8, rim, life > 0.25 ? pal.mid : pal.aura, 0.85 * life);
    tier(rim, 1, life > 0.5 ? pal.core : pal.mid, life);
  }
}
