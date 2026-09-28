/**
 * Where a body is in its walk cycle, carried across the stops that break it.
 *
 * `enemyFrame` picks a walk frame from the distance travelled and an idle
 * frame from the clock, which is right for a body that only ever walks or
 * only ever stands. One that stops and starts every second — the Frontier
 * Veteran closing on the player — cut from the middle of a stride straight to
 * standing, feet snapping together, and started again from wherever its
 * travelled distance pointed, feet snapping apart. It read as the step being
 * reset rather than taken.
 *
 * So a stop finishes the step: the cycle keeps running on the clock until
 * the frame just before a foot comes down, and only then stands. A start
 * picks up from standing at the frame just after a foot leaves, alternating
 * feet with the last stop, and from there follows the ground as before.
 *
 * Written for a cycle whose feet pass through the middle at `n/2 - 1` and
 * `n - 1` and land wide at `0` and `n/2` (`MotionSpec.step.even`).
 */

/** How long a frame of the finishing step is held, ms: the walk's own pace. */
export const SETTLE_FRAME_MS = 110;
/** How long a walk may cover no ground before it counts as a stop, ms: longer than a tick or a stumble. */
export const STILL_MS = 120;

export interface Stride {
  /** Where the walk has got to, 0..n-1. */
  frame: number;
  /** Progress towards the next frame, in frames. */
  carry: number;
  /** Standing (or doing something other than walking) rather than walking. */
  resting: boolean;
  /** The travelled distance at the last update. */
  travelled: number;
  /** The tick of the last update. */
  tick: number;
  /** How long the walk has covered no ground, ms. */
  stillMs: number;
  /** The facing last drawn (`stickyFacing`), or null before the first. */
  facing: Facing | null;
  /**
   * The walk frame on screen, or null while standing. It is `frame` as it
   * was a tick ago: a new frame goes up a tick after the walk reaches it, so
   * when an attack or a hit takes over on that next tick the frame is never
   * shown, rather than flashed for one tick between the stride and the windup.
   */
  drawn: number | null;
  /** How long `drawn` has been on screen, ms. */
  drawnMs: number;
}

export function newStride(travelled: number, tick: number): Stride {
  return { frame: 0, carry: 0, resting: true, travelled, tick, stillMs: 0, facing: null, drawn: null, drawnMs: 0 };
}

/** A drawn facing; `e` is the west frames mirrored. */
export type Facing = "s" | "w" | "n" | "e";
const CENTRE_DEG: Record<Facing, number> = { e: 0, s: 90, w: 180, n: 270 };
/** How far past a boundary between facings the body must turn before it is drawn the other way, degrees. */
export const FACING_MARGIN_DEG = 12;

/**
 * The facing to draw for `facingRad`, holding the last one drawn until the
 * body has turned clearly past the boundary. Read straight off the angle, a
 * body tracking the player along a diagonal flipped between two facings a
 * tick at a time — the whole drawing turning away and back.
 */
export function stickyFacing(last: Facing | null, facingRad: number): Facing {
  const deg = (((facingRad * 180) / Math.PI) % 360 + 360) % 360;
  const raw: Facing = deg >= 45 && deg < 135 ? "s" : deg >= 135 && deg < 225 ? "w" : deg >= 225 && deg < 315 ? "n" : "e";
  if (last === null || raw === last) return raw;
  const off = Math.abs((((deg - CENTRE_DEG[last]) % 360) + 540) % 360 - 180);
  return off <= 45 + FACING_MARGIN_DEG ? last : raw;
}

/** The frame a foot is just about to come down on, from which the body can stand. */
const isExit = (frame: number, n: number) => frame === n / 2 - 1 || frame === n - 1;

/**
 * The pose to show instead of `pose` (`walk2`, or `idle0` to stand), or
 * `null` to show `pose`.
 *
 * `pose` is what `enemyFrame` chose (`walk3`, `idle1`, `windup` …); `stride`
 * is the body's px per frame, `tickMs` the sim step. Only a walk or an idle
 * is ever replaced; anything else counts as standing. A walk that covers no
 * ground — a body sliding to a halt, which moves without walking — is a stop.
 */
export function settleStride(
  s: Stride, pose: string, travelled: number, tick: number,
  n: number, stride: number, tickMs: number,
): string | null {
  const moved = Math.max(0, travelled - s.travelled);
  const dtMs = Math.max(0, tick - s.tick) * tickMs;
  s.travelled = travelled;
  s.tick = tick;
  if (n < 4 || n % 2 !== 0) return null;
  // A new tick: what the walk reached last tick goes up now.
  if (dtMs > 0 && !s.resting) {
    if (s.drawn === s.frame) s.drawnMs += dtMs;
    else { s.drawn = s.frame; s.drawnMs = 0; }
  }
  const stand = (to: string | null): string | null => { s.resting = true; s.carry = 0; s.drawn = null; return to; };

  const walking = pose.startsWith("walk");
  s.stillMs = walking && moved === 0 ? s.stillMs + dtMs : 0;
  // A walk still covering ground, or only just paused: carry on with it.
  if (walking && (moved > 0 || (!s.resting && s.stillMs < STILL_MS))) {
    if (s.resting) {
      // From standing, at once: the foot opposite the one that last came down leaves first.
      s.frame = s.frame === n / 2 - 1 ? n / 2 + 1 : 1;
      s.carry = 0;
      s.resting = false;
      s.drawn = s.frame;
      s.drawnMs = 0;
      return `walk${s.frame}`;
    }
    s.carry += moved / Math.max(1e-6, stride);
    while (s.carry >= 1) { s.carry -= 1; s.frame = (s.frame + 1) % n; }
    return `walk${s.drawn ?? s.frame}`;
  }

  if (!walking && !pose.startsWith("idle")) {
    // An attack, a hit, a sleep: the next walk starts as from standing.
    if (!s.resting) { stand(null); s.frame = n - 1; }
    return null;
  }

  // Standing: the idle as chosen, or the stand for a walk going nowhere.
  const still = walking ? "idle0" : null;
  if (s.resting) return still;
  /*
   * Stopped mid-stride: finish the step on the clock, then stand — once the
   * last frame of it has been on screen for half a frame, so it is seen
   * rather than flashed for a tick.
   */
  s.carry += dtMs / SETTLE_FRAME_MS;
  while (s.carry >= 1 && !isExit(s.frame, n)) { s.carry -= 1; s.frame = (s.frame + 1) % n; }
  if (isExit(s.frame, n) && s.drawn === s.frame && s.drawnMs >= SETTLE_FRAME_MS / 2) {
    s.frame = s.drawn;
    return stand(still);
  }
  return `walk${s.drawn ?? s.frame}`;
}
