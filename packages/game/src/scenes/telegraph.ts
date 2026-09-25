/**
 * **Attack warnings, drawn in the game's own pixels.**
 *
 * Every enemy and boss telegraph used to be a Phaser vector stroke:
 * `strokeCircle`, `lineBetween`, `fillEllipse`, `slice`/`arc`, all of them
 * antialiased and alpha-blended. Beside a sprite whose every edge is a hard
 * 1-px outline, a smooth ring does not read as something on the floor — it
 * reads as a HUD overlay pasted over the room, which is what the complaint
 * was.
 *
 * So the warnings are scan-converted here, **on the art's own pixel**.
 *
 * The rules this module keeps, in order of how much they matter:
 *
 * 1. **One texel, never coarser.** `TELE_PIX` is `1 / ART_SCALE` world units,
 *    which is exactly one pixel of a sprite's atlas frame and one texel of the
 *    ground decoration in `groundEdges` (`1 / FX_TEXEL`). A telegraph's step
 *    is therefore the same size on screen as the step in an enemy's outline,
 *    at any zoom, because both are the same number. Where a shape needs to be
 *    heavier it is given **more texels** — a 2-texel rim, a 1-texel liner —
 *    and never a bigger block.
 * 2. **The drawing is the hit area.** Every cell a telegraph puts down lies
 *    inside the shape the simulation tests with, to within the one texel that
 *    snapping to the grid costs, and the cells cover that shape.
 *    `telegraph.test.ts` runs each drawing against a recording pen and checks
 *    both, the way `ground.test.ts` does for the shockwave.
 * 3. **No gradients.** Area is stated with an ordered dither in four
 *    densities, never with alpha. The density *is* the clock: a warning fills
 *    in from a quarter to solid as the commit arrives, which reads at a glance
 *    and survives any floor mood, because it is a change of coverage rather
 *    than a change of value.
 * 4. **No smooth pulses.** "Arming" is limited-frame: marching dashes round a
 *    rim (`march`) and a two-frame blink (`blink`) on the last of the windup.
 * 5. **A hard bright rim, with a dark line behind it.** The outermost texels
 *    of an area are the brightest thing in the drawing — the only part whose
 *    position the player has to read — and the texel inside them is near
 *    black, so the rim holds its edge on a pale floor and on a dark one. The
 *    liner is *inside* the rim, never outside, because outside the rim is
 *    ground the telegraph does not own.
 *
 * Nothing here touches Phaser: it draws through `Pen`, the same slice of
 * `Graphics` `ground.ts` uses, so the harness can bake it to a PNG and the
 * drawing that ships is the drawing that was looked at
 * (`pnpm telegraph:preview`).
 */
import type { Pen, ViewBox } from "./ground.ts";

/**
 * **Art pixels per world pixel.** The renderer's own constant, kept here
 * because this is the headless module and `play.ts` cannot be imported without
 * Phaser; `play.ts` re-exports it, so there is one number.
 */
export const ART_SCALE = 2;

/**
 * **The telegraph's pixel: one art texel.**
 *
 * Derived, not chosen. A body frame is 64 atlas px drawn at `1 / ART_SCALE`
 * over a 32-unit tile, so one atlas pixel is `1 / ART_SCALE` world units; the
 * floor decoration in `groundEdges` steps at `1 / FX_TEXEL`, which is the same
 * number. Anything drawn on this grid quantises exactly as the sprites beside
 * it do, at every zoom, which is the whole of what "matches the art" means.
 *
 * It is deliberately *not* the shockwave's `SHOCK_PIX`. That drawing is
 * upturned stone and wants a chunky step; a warning is a thing laid over the
 * floor next to the bodies, and a step four times the size of theirs is the
 * defect this module exists to remove.
 */
export const TELE_PIX = 1 / ART_SCALE;

/**
 * The weights a shape is drawn at, in **texels**.
 *
 * A single texel is right for a liner and too thin for a boundary the player
 * is judging a dodge against, so a rim gets two, and three when it is about to
 * land. This is how a shape is made heavier: more texels of it, never a
 * bigger pixel.
 */
export const RIM_PX = 2;
export const LINER_PX = 1;

/**
 * The warning band.
 *
 * These are the hues the telegraphs already used — the reds and ambers of
 * `0xff5544` / `0xff8877` / `0xffd08a` — kept, because the room's colour shift
 * moves hue and the player has learned these. What is new is the **value
 * band**: a near-black liner under every rim and a near-white flash at the
 * commit, so a telegraph is read by lightness first and hue second and stays
 * legible on a cold dim floor and a hot bright one alike.
 */
/** The liner behind every rim. Nearly black, faintly red. */
export const TELE_LINER = 0x1b0910;
/** The body of a warning area: the dither's colour while it is filling. */
export const TELE_FILL = 0xff5544;
/** A rim that is armed but not yet arriving. */
export const TELE_RIM = 0xff8877;
/** A rim in its last third: about to hit. */
export const TELE_HOT = 0xffd08a;
/** The commit, and the burst. The brightest value in the band. */
export const TELE_FLASH = 0xfff3d0;
/** The one thing on the floor that means *safe*: come closer. */
export const TELE_SAFE = 0xffffff;
/** The lightning mark's cold blue: not the enemy's own red, on purpose. */
export const TELE_MARK = 0x9ad8ff;

/* ------------------------------------------------------------------ *\
   Clocks
\* ------------------------------------------------------------------ */

/**
 * A two-frame blink on the world tick.
 *
 * `shift` is how many ticks each half lasts as a power of two: 3 is eight
 * ticks, about 7 Hz at 60, which is the fastest a blink stays countable. A
 * smooth alpha pulse says "something is happening"; a blink says "now, now,
 * now", and only the second one is a clock.
 */
export function blink(tick: number, shift = 3): boolean {
  return ((tick >> shift) & 1) === 0;
}

/**
 * The phase for marching dashes, in whole steps.
 *
 * Four steps per cycle: the ants crawl round the rim at a readable pace and,
 * crucially, in **whole texels**, so nothing ever lands between two pixels.
 */
export function march(tick: number, shift = 2): number {
  return (tick >> shift) & 3;
}

/* ------------------------------------------------------------------ *\
   The grid
\* ------------------------------------------------------------------ */

const P = TELE_PIX;

function floorPix(v: number): number { return Math.floor(v / P) * P; }
function ceilPix(v: number): number { return Math.ceil(v / P) * P; }

/** Signed smallest angle from `a` to `b`. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * How many rectangles the telegraphs have asked for since the counter was
 * reset. The preview prints it and the tests assert on it, because scan
 * conversion at one texel is exactly the kind of drawing that is correct and
 * unaffordable.
 */
let rects = 0;
export function teleRects(): number { return rects; }
export function resetTeleRects(): void { rects = 0; }

function put(pen: Pen, x: number, y: number, w: number, h: number): void {
  rects++;
  pen.fillRect(x, y, w, h);
}

/**
 * **The ordered dither, as a line matrix.**
 *
 * Four densities — a quarter, a half, three quarters, solid — chosen by the
 * row alone, so a filled row of an area is one rectangle however wide it is.
 *
 * A Bayer checkerboard would be the prettier kernel and cannot be paid for at
 * this pitch: a single texel checker over a melee sector is twelve thousand
 * one-texel rectangles a frame, because a checkerboard has no runs at all,
 * and over a boss's slam it is a hundred thousand. A line dither is an
 * ordered dither like any other, it quantises on the same one-texel grid, its
 * edges are just as hard — and it costs one rectangle per row. The pitch is
 * four texels, so at any density the gaps are at most three texels: at the
 * game's zoom that is a hatch, not a set of stripes.
 *
 * `DITHER_PITCH` is also what the tests measure coverage against, since a
 * gap in a dither is marked ground with nothing drawn on it.
 */
export const DITHER_PITCH = 4;
const LINE_DITHER = [0, 2, 1, 3];

function litRow(iy: number, level: number): boolean {
  return LINE_DITHER[((iy % DITHER_PITCH) + DITHER_PITCH) % DITHER_PITCH]! < level * DITHER_PITCH;
}

/* ------------------------------------------------------------------ *\
   Primitives
\* ------------------------------------------------------------------ */

/**
 * **The stepped circle, cached per radius.**
 *
 * One quadruple per row — `(iy, x0, x1, grew)` in texels relative to the
 * centre texel — where `grew` is how far the row grew sideways from the last
 * one. It is the scan conversion the shockwave's charge ring uses, with one
 * fix: the growth is taken in absolute value, because the rows *shrink* over
 * the bottom half and a signed growth there collapses to a single texel and
 * leaves the bottom of the circle open.
 *
 * Cached because the shape only depends on the radius in texels: a boss's
 * overstay dial sweeps a few hundred radii over its two seconds and then every
 * one of them is free for the rest of the run. The cache is capped so a
 * pathological radius cannot grow it without bound.
 */
const ringCache = new Map<number, Int16Array>();

export function ringRuns(rc: number): Int16Array {
  const hit = ringCache.get(rc);
  if (hit) return hit;
  const out: number[] = [];
  let last = NaN;
  for (let iy = -rc; iy <= rc; iy++) {
    const dy = iy + 0.5;
    if (Math.abs(dy) >= rc) continue;
    const dx = Math.sqrt(rc * rc - dy * dy);
    const x0 = Math.floor(-dx);
    const x1 = Math.ceil(dx);
    const grew = Math.min(x1 - x0, Number.isNaN(last) ? x1 - x0 : Math.max(1, Math.abs(last - x0)));
    out.push(iy, x0, x1, grew);
    last = x0;
  }
  /*
   * **Both caps are drawn whole.** The first row has no previous row to have
   * grown from, and the last row has no following one — and at the bottom the
   * rows are shrinking, so its growth is measured against a row that was
   * *wider*. Left to the rule, the circle is open at six o'clock by as many
   * texels as the last row spans.
   */
  if (out.length >= 8) {
    out[3] = out[2]! - out[1]!;
    out[out.length - 1] = out[out.length - 2]! - out[out.length - 3]!;
  }
  const arr = Int16Array.from(out);
  if (ringCache.size < 256) ringCache.set(rc, arr);
  return arr;
}

/** How a rim is cut: a slice of it, and/or marching dashes along it. */
export interface RimOpts {
  /** Texels of thickness, drawn **inward** so the outer edge stays on `r`. */
  thick?: number;
  /** Only the part of the ring within `half` of `facing`. */
  arc?: { facing: number; half: number };
  /** Marching ants: `segs` dashes round the whole circle, offset by `phase`. */
  dash?: { segs: number; phase: number };
}

/**
 * A hard-edged ring on the texel grid: the shape every warning boundary is
 * made of.
 *
 * Drawn inward from `r`, so however thick it is the player reads the same
 * edge — the outermost texel — as the boundary. That is the one promise a
 * telegraph makes.
 *
 * Thickness costs nothing: a row of an annulus is still one run per side, so
 * a three-texel rim is the same two rectangles a row that a one-texel rim is.
 */
export function teleRing(
  pen: Pen, cx: number, cy: number, r: number,
  colour: number, alpha: number, view: ViewBox, opts: RimOpts = {},
): void {
  const rc = Math.max(1, Math.round(r / P));
  const thick = Math.max(1, Math.round(opts.thick ?? 1));
  const sx = floorPix(cx);
  const sy = floorPix(cy);
  const cut = opts.arc;
  const dash = opts.dash;
  const runs = ringRuns(rc);
  pen.fillStyle(colour, alpha);
  for (let i = 0; i < runs.length; i += 4) {
    const y = sy + runs[i]! * P;
    if (y + P < view.y0 || y > view.y1) continue;
    const wide = Math.min(runs[i + 2]! - runs[i + 1]!, Math.max(runs[i + 3]!, thick));
    const left = sx + runs[i + 1]! * P;
    const right = sx + (runs[i + 2]! - wide) * P;
    for (const x of right === left ? [left] : [left, right]) {
      if (x + wide * P < view.x0 || x > view.x1) continue;
      if (!cut && !dash) { put(pen, x, y, wide * P, P); continue; }
      /*
       * Cut or dashed: the run is walked a texel at a time and the texels
       * that survive are merged back into runs, so a solid arc still costs
       * one rectangle rather than one per texel.
       */
      let from = -1;
      for (let c = 0; c <= wide; c++) {
        const keep = c < wide && rimKeeps(x + c * P + P / 2 - cx, y + P / 2 - cy, cut, dash);
        if (keep && from < 0) from = c;
        else if (!keep && from >= 0) { put(pen, x + from * P, y, (c - from) * P, P); from = -1; }
      }
    }
  }
}

/** Whether one texel of a rim survives its slice and its dashes. */
function rimKeeps(
  dx: number, dy: number,
  cut: { facing: number; half: number } | undefined,
  dash: { segs: number; phase: number } | undefined,
): boolean {
  const ang = Math.atan2(dy, dx);
  if (cut && Math.abs(angleDelta(cut.facing, ang)) > cut.half) return false;
  if (!dash) return true;
  const k = Math.floor(((ang / (Math.PI * 2)) + 0.5) * dash.segs * 2);
  return ((k + dash.phase) & 1) === 0;
}

/**
 * A dithered area, scan-converted between two bounds and clipped to the
 * camera.
 *
 * `span` gives the row's world x-range; `inside` refines it per texel for
 * anything that is not a disc, and a run is broken only where the shape is.
 * Everything with an area in this module goes through here, so there is
 * exactly one place where "what the drawing covers" is decided.
 */
export function teleArea(
  pen: Pen, colour: number, alpha: number, level: number, view: ViewBox,
  top: number, bottom: number,
  span: (y: number) => readonly [number, number] | null,
  inside: ((x: number, y: number) => boolean) | null,
): void {
  if (level <= 0) return;
  pen.fillStyle(colour, alpha);
  /*
   * A texel is drawn when its **centre** is inside the shape, on both axes.
   * Rounding the span outward instead puts red on ground the attack never
   * reaches, and the edge is the only thing a telegraph promises.
   */
  const first = Math.max(ceilPix(top - P / 2), floorPix(view.y0));
  const last = Math.min(floorPix(bottom - P / 2), ceilPix(view.y1));
  for (let y = first; y <= last; y += P) {
    if (!litRow(Math.round(y / P), level)) continue;
    const s = span(y + P / 2);
    if (!s) continue;
    const x0 = Math.max(ceilPix(s[0] - P / 2), floorPix(view.x0));
    const x1 = Math.min(floorPix(s[1] - P / 2), ceilPix(view.x1));
    if (x1 < x0) continue;
    if (!inside) { put(pen, x0, y, x1 - x0 + P, P); continue; }
    const cy = y + P / 2;
    let from = NaN;
    for (let x = x0; x <= x1 + P; x += P) {
      const on = x <= x1 && inside(x + P / 2, cy);
      if (on && Number.isNaN(from)) from = x;
      else if (!on && !Number.isNaN(from)) { put(pen, from, y, x - from, P); from = NaN; }
    }
  }
}

/** A dithered disc. */
export function teleDisc(
  pen: Pen, cx: number, cy: number, r: number,
  colour: number, alpha: number, level: number, view: ViewBox,
): void {
  if (r <= 0) return;
  teleArea(pen, colour, alpha, level, view, cy - r, cy + r, (y) => {
    const dy = y - cy;
    if (Math.abs(dy) >= r) return null;
    const dx = Math.sqrt(r * r - dy * dy);
    return [cx - dx, cx + dx];
  }, null);
}

/** A dithered sector: the disc, cut to `facing ± half`. */
export function teleSectorFill(
  pen: Pen, cx: number, cy: number, r: number, facing: number, half: number,
  colour: number, alpha: number, level: number, view: ViewBox,
): void {
  if (r <= 0) return;
  if (half >= Math.PI) { teleDisc(pen, cx, cy, r, colour, alpha, level, view); return; }
  const ux = Math.cos(facing);
  const uy = Math.sin(facing);
  const cosH = Math.cos(half);
  teleArea(pen, colour, alpha, level, view, cy - r, cy + r, (y) => {
    const dy = y - cy;
    if (Math.abs(dy) >= r) return null;
    const dx = Math.sqrt(r * r - dy * dy);
    return [cx - dx, cx + dx];
  }, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d < P) return true;
    // `dot >= cos(half) * |d|` is the wedge test without an atan2 per texel.
    return dx * ux + dy * uy >= cosH * d;
  });
}

/** Texels of a stepped line, one to `thick` texels wide, optionally dashed. */
export function teleLine(
  pen: Pen, x0: number, y0: number, x1: number, y1: number,
  colour: number, alpha: number, view: ViewBox,
  opts: { thick?: number; hollow?: boolean; dash?: { on: number; off: number; phase: number } } = {},
): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < P) return;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const nx = -uy;
  const ny = ux;
  const thick = Math.max(1, Math.round(opts.thick ?? 1));
  const d = opts.dash;
  pen.fillStyle(colour, alpha);
  /*
   * The line is walked in half-texels so a diagonal stays unbroken, which
   * means most steps land on the texel the last one did. One remembered key
   * per lane throws those away.
   */
  const lastKey = LANE_KEYS;
  for (let t = 0; t < thick; t++) lastKey[t] = -1;
  for (let s = 0; s <= len; s += P / 2) {
    if (d) {
      const period = d.on + d.off;
      const step = Math.floor(s / P) + d.phase;
      if (((step % period) + period) % period >= d.on) continue;
    }
    for (let t = 0; t < thick; t++) {
      // A liner is only wanted at the edges: every lane between them is
      // covered by the bright line that goes over it, and on a lane that long
      // the saving is most of the drawing.
      if (opts.hollow && t > 0 && t < thick - 1) continue;
      const off = (t - (thick - 1) / 2) * P;
      const x = floorPix(x0 + ux * s + nx * off);
      const y = floorPix(y0 + uy * s + ny * off);
      const key = (Math.round(x / P) & 0xffff) * 65536 + (Math.round(y / P) & 0xffff);
      if (key === lastKey[t]) continue;
      lastKey[t] = key;
      if (x + P < view.x0 || x > view.x1 || y + P < view.y0 || y > view.y1) continue;
      put(pen, x, y, P, P);
    }
  }
}

/** Scratch for `teleLine`: the last texel written in each lane. */
const LANE_KEYS = new Int32Array(16);

/** Radial stubs round a circle: a dial's ticks, or the nicks on a quake. */
export function teleTicks(
  pen: Pen, cx: number, cy: number, r0: number, r1: number, n: number, rot: number,
  colour: number, alpha: number, view: ViewBox, show: (k: number) => boolean = () => true,
): void {
  for (let k = 0; k < n; k++) {
    if (!show(k)) continue;
    const a = rot + (k / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    teleLine(pen, cx + ca * r0, cy + sa * r0, cx + ca * r1, cy + sa * r1, colour, alpha, view,
      { thick: RIM_PX });
  }
}

/* ------------------------------------------------------------------ *\
   The telegraphs
\* ------------------------------------------------------------------ */

/** Where the fill stops: inside the rim and its liner, never under them. */
const INSET = (RIM_PX + LINER_PX) * P;

/**
 * **A straight edge of a sector or a cone, drawn wholly inside it.**
 *
 * A thick line centred on the boundary ray is half outside the shape, and
 * once the texel snapping is added a couple of texels of red land on ground
 * the swing does not reach — which near the body is a whole body-width of
 * angle. So the line is pushed inward by its own half-width and a texel more,
 * and the shape keeps its promise at every distance from the pivot.
 */
function teleEdge(
  pen: Pen, x: number, y: number, a: number, side: -1 | 1, from: number, to: number,
  colour: number, alpha: number, view: ViewBox, dash?: { on: number; off: number; phase: number },
): void {
  const inward = a - side * Math.PI / 2;
  const nx = Math.cos(inward) * (RIM_PX / 2 + 1) * P;
  const ny = Math.sin(inward) * (RIM_PX / 2 + 1) * P;
  teleLine(pen, x + Math.cos(a) * from + nx, y + Math.sin(a) * from + ny,
    x + Math.cos(a) * to + nx, y + Math.sin(a) * to + ny,
    colour, alpha, view, { thick: RIM_PX, dash });
}

/**
 * **The common shape of a warning area**: a dithered body, a near-black liner
 * and a hard bright rim, all inside `r`.
 *
 * `t` is how far the windup has run, 0 to 1. It picks the dither's density and
 * the rim's colour, and past 0.8 the rim blinks — which is the whole of "it is
 * about to happen", stated in two frames rather than in a ramp of alpha.
 */
export function teleWarnDisc(
  pen: Pen, cx: number, cy: number, r: number, t: number, tick: number, view: ViewBox,
  opts: { fill?: number; rim?: number; level?: number } = {},
): void {
  const hot = t > 0.66;
  const level = opts.level ?? 0.25 + 0.5 * Math.min(1, t);
  teleDisc(pen, cx, cy, r - INSET, opts.fill ?? TELE_FILL, 0.55, level, view);
  teleRing(pen, cx, cy, r - RIM_PX * P, TELE_LINER, 0.85, view, { thick: LINER_PX });
  const rim = opts.rim ?? (hot ? TELE_HOT : TELE_RIM);
  teleRing(pen, cx, cy, r, t > 0.8 && !blink(tick, 2) ? TELE_FLASH : rim, 1, view,
    { thick: hot ? RIM_PX + 1 : RIM_PX });
}

/**
 * **The boss's slam.** The ground out to where the wave will pass, and the
 * safe circle at its feet — the one attack whose answer is to come closer.
 */
export function drawSlamTell(
  pen: Pen, x: number, y: number, safe: number, r: number, t: number, tick: number, view: ViewBox,
): void {
  /*
   * **The safe circle is left bare**, and the hazard hatch is an annulus
   * round it.
   *
   * The old drawing filled the whole disc and then stroked a white ring over
   * it, which said "all of this is dangerous, and also here is a circle" —
   * the one attack in the game whose answer is to walk *towards* the boss,
   * drawn as if the middle were the worst of it. Punching the hole is both
   * the truth and the reason the white ring is now the first thing seen: it
   * is the edge of a clean patch of floor, not a line over a red field.
   */
  const level = 0.25 + 0.5 * Math.min(1, t);
  const inner = safe + RIM_PX * P;
  teleArea(pen, TELE_FILL, 0.55, level, view, y - r, y + r, (ry) => {
    const dy = ry - y;
    const rr = r - INSET;
    if (Math.abs(dy) >= rr) return null;
    const dx = Math.sqrt(rr * rr - dy * dy);
    return [x - dx, x + dx];
  }, (px, py) => Math.hypot(px - x, py - y) >= inner);
  teleRing(pen, x, y, r - RIM_PX * P, TELE_LINER, 0.85, view, { thick: LINER_PX });
  const hot = t > 0.66;
  teleRing(pen, x, y, r, t > 0.8 && !blink(tick, 2) ? TELE_FLASH : hot ? TELE_HOT : TELE_RIM, 1, view,
    { thick: hot ? RIM_PX + 1 : RIM_PX });
  /*
   * The safe edge: solid, so it reads as a boundary, with its liner on the
   * hazard side. Inside it one dashed ring marches round — come in.
   */
  teleRing(pen, x, y, safe + RIM_PX * P, TELE_LINER, 0.9, view, { thick: LINER_PX });
  teleRing(pen, x, y, safe, TELE_SAFE, 1, view, { thick: RIM_PX });
  teleRing(pen, x, y, safe - 8, TELE_SAFE, 0.55, view, { dash: { segs: 10, phase: march(tick) & 1 } });
}

/**
 * **Where the boss comes down.** Full size from the first frame — a mark that
 * grows says where the danger will be *later*, which is the one thing a
 * landing marker must not do — with the disc inside it filling as the clock
 * runs.
 *
 * The four approach ticks sit outside the rim on purpose: they are a clock,
 * not a claim on the ground, and they are the part a player reads when they
 * are watching the floor rather than the body. `clock: false` leaves them off,
 * which is how the tests look at the mark's own area.
 */
export function drawLeapMark(
  pen: Pen, x: number, y: number, r: number, safe: number, t: number, tick: number,
  view: ViewBox, opts: { clock?: boolean } = {},
): void {
  // The whole mark, hatched at a quarter: this ground is spoken for.
  teleDisc(pen, x, y, r - INSET, TELE_FILL, 0.5, 0.25, view);
  // And the part of the clock that has run, solid.
  teleDisc(pen, x, y, Math.max(0, r * t - INSET), TELE_FILL, 0.65, Math.min(1, 0.5 + 0.5 * t), view);
  teleRing(pen, x, y, r - RIM_PX * P, TELE_LINER, 0.9, view, { thick: LINER_PX });
  teleRing(pen, x, y, r, t > 0.8 && !blink(tick, 2) ? TELE_FLASH : TELE_HOT, 1, view,
    { thick: RIM_PX + 1 });
  if (safe > 0 && safe < r)
    teleRing(pen, x, y, safe, TELE_SAFE, 0.7, view, { dash: { segs: 10, phase: march(tick) & 1 } });
  if (opts.clock === false) return;
  const r0 = r + 22 * (1 - t);
  teleTicks(pen, x, y, r0, r0 + 8, 4, Math.PI / 4, TELE_HOT, 0.4 + 0.6 * t, view);
}

/**
 * **The overstay dial.** Not a place but a length of time spent in one, drawn
 * as the punish's own reach tightening onto the body.
 *
 * The rim is dashed and the dashes march: sixteen of them, and the ticks
 * inside count off the eighths that have run, so the ring is visibly
 * emptying. In the last third it goes white and blinks, because the last
 * third is the part where leaving is still possible and worth doing.
 */
export function drawOverstayDial(
  pen: Pen, x: number, y: number, r: number, t: number, tick: number, view: ViewBox,
): void {
  const hot = t > 0.66;
  const colour = hot ? (blink(tick, 2) ? TELE_SAFE : TELE_HOT) : TELE_RIM;
  teleRing(pen, x, y, r - RIM_PX * P, TELE_LINER, 0.7, view, { thick: LINER_PX });
  teleRing(pen, x, y, r, colour, 0.5 + 0.5 * t, view,
    { thick: hot ? RIM_PX + 1 : RIM_PX, dash: { segs: 16, phase: march(tick) & 1 } });
  teleTicks(pen, x, y, r - 5, r - RIM_PX * P, 8, -Math.PI / 2, colour, 0.5 + 0.5 * t, view,
    (k) => k / 8 <= t);
}

/**
 * **The quake.** A ring that closes *in* on the boss rather than growing out
 * of it, so it is told apart from the slam before either resolves.
 *
 * Nothing is filled: the quake does not own the ground it is closing over,
 * the cracks that follow do. The nicks point outward from the rim at the
 * bearings the stone is about to give on.
 */
export function drawQuakeTell(
  pen: Pen, x: number, y: number, r: number, toward: number, t: number, tick: number, view: ViewBox,
): void {
  teleRing(pen, x, y, r - RIM_PX * P, TELE_LINER, 0.8, view, { thick: LINER_PX });
  teleRing(pen, x, y, r, t > 0.8 && !blink(tick, 2) ? TELE_FLASH : TELE_FILL, 0.5 + 0.5 * t, view,
    { thick: t > 0.5 ? RIM_PX + 1 : RIM_PX, dash: { segs: 20, phase: march(tick, 1) & 1 } });
  teleTicks(pen, x, y, r, r + 10, 4, toward, TELE_HOT, 0.35 + 0.55 * t, view);
}

/**
 * **A sight line.** The sentinel's threat is a lane, so the lane is drawn: a
 * dashed line marching *outward* from the body through where it last saw the
 * player, and a blinking pip on the point itself.
 *
 * Dashes rather than a stroke because a solid thin line at this length is the
 * most overlay-looking thing there is, and because marching gives the lane a
 * direction — which end the shot comes from is half of what the player needs.
 */
export function drawAimLine(
  pen: Pen, x: number, y: number, ux: number, uy: number, len: number,
  aimX: number, aimY: number, t: number, tick: number, view: ViewBox,
): void {
  // A third on, two thirds off: the lane has to be read across a whole room,
  // and at this pitch a half-and-half dash is a solid line that costs twice.
  const dash = { on: 4, off: 8, phase: -march(tick, 1) * 3 };
  teleLine(pen, x, y, x + ux * len, y + uy * len, TELE_LINER, 0.6, view,
    { thick: RIM_PX + 2, hollow: true, dash });
  teleLine(pen, x, y, x + ux * len, y + uy * len, t > 0.6 ? TELE_HOT : TELE_FILL,
    0.35 + 0.55 * t, view, { thick: RIM_PX, dash });
  if (t < 0.5 || blink(tick, 2)) {
    pen.fillStyle(TELE_LINER, 0.8);
    put(pen, floorPix(aimX) - P * 3, floorPix(aimY) - P * 3, P * 7, P * 7);
    pen.fillStyle(TELE_FLASH, 0.7 + 0.3 * t);
    put(pen, floorPix(aimX) - P * 2, floorPix(aimY) - P * 2, P * 5, P * 5);
  }
}

/**
 * **An all-round tell**: a ring on the body, not an area. The steel goes
 * everywhere, so a filled disc says nothing the shape of the body does not.
 *
 * The two kinds run opposite ways and that is what tells them apart: a spike
 * drive's ring contracts from beyond its reach onto the body, a slam's grows
 * out to the wave's edge. Both march, and both blink on the commit.
 */
export function drawRingTell(
  pen: Pen, x: number, y: number, r: number, colour: number, t: number, tick: number, view: ViewBox,
  opts: { dim?: boolean } = {},
): void {
  const a = opts.dim ? 0.3 + 0.35 * t : 0.6 + 0.4 * t;
  teleRing(pen, x, y, r - RIM_PX * P, TELE_LINER, a * 0.8, view, { thick: LINER_PX });
  teleRing(pen, x, y, r, t > 0.8 && !blink(tick, 2) ? TELE_FLASH : colour, a, view,
    { thick: opts.dim ? RIM_PX : RIM_PX + Math.round(t), dash: { segs: 14, phase: march(tick) & 1 } });
}

/**
 * **The melee sector**: the armed hitbox at full sweep, so it cannot
 * misrepresent reach or arc.
 *
 * The area is the hatch, the boundary is the rim, and the two radial edges
 * close it — an open sector reads as a smear, and the edge is what the "one
 * step backwards" decision is made against. The whole thing is inside
 * `reach`: the liner runs under the rim rather than around it.
 */
export function drawSectorTell(
  pen: Pen, x: number, y: number, reach: number, facing: number, half: number,
  t: number, tick: number, view: ViewBox,
): void {
  const hot = t > 0.66;
  teleSectorFill(pen, x, y, reach - INSET, facing, half, TELE_FILL, 0.55,
    0.25 + 0.5 * Math.min(1, t), view);
  const arc = { facing, half };
  teleRing(pen, x, y, reach - RIM_PX * P, TELE_LINER, 0.85, view, { arc, thick: LINER_PX });
  teleRing(pen, x, y, reach, t > 0.85 && !blink(tick, 2) ? TELE_FLASH : hot ? TELE_HOT : TELE_RIM,
    1, view, { arc, thick: hot ? RIM_PX + 1 : RIM_PX });
  if (half >= Math.PI - 0.01) return;
  for (const s of [-1, 1] as const)
    teleEdge(pen, x, y, facing + s * half, s, RIM_PX * P * 2, reach - RIM_PX * P,
      hot ? TELE_HOT : TELE_RIM, 0.75 + 0.25 * t, view,
      { on: 5, off: 5, phase: march(tick) * 2 });
}

/**
 * **The warden's fire-shot**, ray by ray, cut short where a wall stops it.
 *
 * The shape is the sim's own `flameRays`, so the ground drawn is the ground
 * the pellets reach — including the bite a pillar takes out of it.
 */
export function drawFlameCone(
  pen: Pen, x: number, y: number, aim: number, half: number, rays: readonly number[],
  t: number, tick: number, view: ViewBox,
): void {
  const n = rays.length;
  if (n < 2) return;
  const reachAt = (off: number): number => {
    const u = ((off + half) / (2 * half)) * (n - 1);
    const i = Math.max(0, Math.min(n - 2, Math.floor(u)));
    const k = Math.max(0, Math.min(1, u - i));
    return rays[i]! * (1 - k) + rays[i + 1]! * k;
  };
  const max = Math.max(...rays);
  const ux = Math.cos(aim);
  const uy = Math.sin(aim);
  const cosH = Math.cos(half);
  teleArea(pen, TELE_FILL, 0.55, 0.25 + 0.5 * Math.min(1, t), view, y - max, y + max, (ry) => {
    const dy = ry - y;
    if (Math.abs(dy) >= max) return null;
    const dx = Math.sqrt(max * max - dy * dy);
    return [x - dx, x + dx];
  }, (px, py) => {
    const dx = px - x;
    const dy = py - y;
    const d = Math.hypot(dx, dy);
    if (d < P) return true;
    if (dx * ux + dy * uy < cosH * d) return false;
    return d <= reachAt(angleDelta(aim, Math.atan2(dy, dx))) - INSET;
  });
  /*
   * **The rim is walked by angle, not drawn as a polyline through the tips.**
   *
   * A chord between two tips is fine while the reach changes slowly and is
   * badly wrong where a pillar bites a hole in the spread: there the reach
   * drops from three tiles to one between two neighbouring rays, and a
   * straight line across that gap paints red over a tile the pellets are
   * stopped well short of. Stepping the boundary itself at a texel of arc
   * follows the bite exactly.
   *
   * And the reach a texel is placed at is the **shortest** over a few texels
   * of arc either side of it, because in the bite the boundary is nearly
   * radial: a texel nudged sideways by half its width lands at an angle whose
   * reach is a tile shorter. Taking the minimum makes the rim retreat into
   * the wall's shadow, which is the side to be wrong on.
   */
  const hot = t > 0.66;
  const colour = t > 0.85 && !blink(tick, 2) ? TELE_FLASH : hot ? TELE_HOT : TELE_RIM;
  const step = P / Math.max(1, max);
  const w = (P * 2) / Math.max(1, max);
  const safeReach = (o: number): number => {
    let r = reachAt(o);
    for (let k = -2; k <= 2; k++)
      r = Math.min(r, reachAt(Math.max(-half, Math.min(half, o + (k * w) / 2))));
    return r;
  };
  for (let off = -half; off <= half + step / 2; off += step) {
    const o = Math.min(half, off);
    const a = aim + o;
    const r = Math.max(0, safeReach(o) - RIM_PX * P);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let k = 0; k < RIM_PX + LINER_PX; k++) {
      const liner = k >= RIM_PX;
      const px = floorPix(x + ca * (r - k * P));
      const py = floorPix(y + sa * (r - k * P));
      if (px + P < view.x0 || px > view.x1 || py + P < view.y0 || py > view.y1) continue;
      pen.fillStyle(liner ? TELE_LINER : colour, liner ? 0.85 : 1);
      put(pen, px, py, P, P);
    }
  }
  // The two sides of the spread, so the cone is closed and its edges are the
  // place the player steps past rather than a fade.
  for (const s of [-1, 1] as const)
    teleEdge(pen, x, y, aim + s * half, s, RIM_PX * P * 2,
      Math.max(0, safeReach(s * half) - RIM_PX * P), colour, 0.8, view,
      { on: 5, off: 5, phase: march(tick) * 2 });
}

/**
 * **The lightning mark.** A hard ring at the struck radius and a disc filling
 * inside it, in the cold blue that is this one attack's own colour.
 *
 * It keeps the old drawing's whole argument — the edge states the place at
 * pixel accuracy, the fill states the time — and only changes how both are
 * made: a stepped rim instead of a stroked one, and a hatch that thickens in
 * four steps instead of a translucent disc that grows.
 */
export function drawStrikeMark(
  pen: Pen, x: number, y: number, r: number, left: number, tick: number, view: ViewBox,
): void {
  const t = 1 - left;
  teleDisc(pen, x, y, r - INSET, TELE_MARK, 0.55, 0.25 + 0.75 * t, view);
  teleRing(pen, x, y, r - RIM_PX * P, TELE_LINER, 0.8, view, { thick: LINER_PX });
  /*
   * **Solid, not dashed.** A dash says "a clock is running"; this ring says
   * "the bolt lands inside here", and the two must not look alike. Every rim
   * in this module that is an exact boundary is unbroken, and every ring that
   * is only a countdown — the overstay dial, the quake's gathering, the
   * all-round tells — marches. That is the whole grammar, and it is worth
   * more than any of the individual drawings.
   */
  teleRing(pen, x, y, r, t > 0.8 && !blink(tick, 2) ? TELE_FLASH : TELE_MARK, 1, view,
    { thick: t > 0.6 ? RIM_PX + 1 : RIM_PX });
}

/**
 * **The burst a body leaves**, and **the mine's blast**: a ring at the reach
 * with the ground inside it hatched, tightening as it nears.
 */
export function drawBlastRing(
  pen: Pen, x: number, y: number, r: number, t: number, tick: number, view: ViewBox,
): void {
  teleWarnDisc(pen, x, y, r, t, tick, view, { level: 0.25 + 0.25 * t });
}

/**
 * **A rift opening under the floor**: the heave, then the burst.
 *
 * The heave is the warning disc at the rift's own width. The burst is the
 * same circle gone solid for a few frames with a hard flash rim thrown to its
 * edge — no growing ring outside it, because outside it is ground that was
 * never hit.
 */
export function drawRiftCircle(
  pen: Pen, x: number, y: number, r: number, t: number, tick: number, view: ViewBox,
): void {
  teleWarnDisc(pen, x, y, r, t, tick, view);
}

export function drawRiftBurst(
  pen: Pen, x: number, y: number, r: number, t: number, view: ViewBox,
): void {
  teleDisc(pen, x, y, r - INSET, TELE_FILL, 0.9 * (1 - t), Math.max(0, 1 - t), view);
  teleRing(pen, x, y, r, TELE_FLASH, 1 - t, view, { thick: RIM_PX + Math.round(2 * (1 - t)) });
}
