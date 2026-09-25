/**
 * The motion a body has that its frames do not: squash, stretch, recoil, lag.
 *
 * The drawn poses carry the performance — a stride, a gather, a follow
 * through (doc 016). What they cannot carry is the **moment**: the give in a
 * body as a foot lands, the flinch of a hit arriving between two frames, the
 * half-beat a mass takes to change its mind about which way it is facing.
 * Those live on a clock finer than the art's and belong to the renderer.
 *
 * Everything here is derived from sim state and the render clock and applied
 * to the sprite, so the simulation is untouched and two clients given the
 * same world draw the same picture. Nothing is remembered except *when* a
 * body last turned, which is a fact about the drawing and not about the
 * world.
 *
 * Three rules keep it from reading as rubber:
 *
 * - **Area is preserved.** A squash of 8% in height is a stretch of 8% in
 *   width, so the body keeps its mass. Scaling one axis alone reads as the
 *   sprite being pulled about.
 * - **Everything is short.** 60 to 200 ms, with an ease out, so the eye reads
 *   an impact and not a wobble. A body is at rest most of the time.
 * - **Scale lands on whole art pixels.** A pixel sprite scaled by 1.037
 *   resamples its own edges differently every frame, which crawls. The scale
 *   is snapped so the drawn height is a whole number of art pixels; the
 *   effect steps rather than sliding, which at these sizes is what the art
 *   does anyway.
 */

/** How heavy a body reads, the same three classes the rigs use (`motion.ts`). */
export type Weight = "light" | "mid" | "heavy";

export interface BodyFeelInput {
  readonly weight: Weight;
  /** The frame's height in art px, so the scale can land on whole pixels. */
  readonly framePx: number;
  /** The render clock, in ticks. */
  readonly tick: number;
  /** The melee phase the sim is in, and how long is left of it. */
  readonly attack?: string | null;
  readonly attackMs?: number;
  /** Unit vector the body is attacking along; the pull-back is its opposite. */
  readonly aimX?: number;
  readonly aimY?: number;
  /** Milliseconds left of the hit flash, and the unit direction the blow came from. */
  readonly hitMs?: number;
  readonly hitX?: number;
  readonly hitY?: number;
  /** Distance travelled and the stride it is walking on, for the footfall. */
  readonly travelled?: number;
  readonly stride?: number;
  readonly moving?: boolean;
  /**
   * The x of the direction a **running** body is moving, -1 to 1, eased. Given
   * only for the player: it leans into the run and lifts between footfalls.
   * An enemy's gait is its weight, and it is left to the stride.
   */
  readonly moveX?: number;
  /** Milliseconds left of a dash, and of the landing after one. */
  readonly dashMs?: number;
  /** Ticks since the body last flipped between facing west and east. */
  readonly sinceTurn?: number;
  /** A body with no feet: it sways rather than steps. */
  readonly hover?: boolean;
  /** How far into its death the body is, 0 to 1; undefined while alive. */
  readonly dying?: number;
}

export interface BodyFeel {
  /** Multipliers on the sprite's own scale. */
  readonly scaleX: number;
  readonly scaleY: number;
  /** World-pixel offsets, on top of wherever the body is. */
  readonly offX: number;
  readonly offY: number;
  /** Radians, added to whatever lean the sprite already has. */
  readonly tilt: number;
}

/** How far a running body leans into its run, radians, and rises between footfalls, px. */
const RUN_LEAN = 0.14;
const RUN_LIFT_PX = 1.5;

export const REST: BodyFeel = { scaleX: 1, scaleY: 1, offX: 0, offY: 0, tilt: 0 };

/** Milliseconds a tick is worth, matching the sim's step. */
const TICK_MS = 1000 / 60;

/** How much of each effect a weight class takes, and how long it takes it. */
const WEIGHTS: Record<Weight, { squash: number; recoil: number; settle: number; turnMs: number }> = {
  light: { squash: 0.06, recoil: 2, settle: 110, turnMs: 70 },
  mid: { squash: 0.08, recoil: 2.5, settle: 140, turnMs: 90 },
  heavy: { squash: 0.11, recoil: 3, settle: 190, turnMs: 120 },
};

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** Fast at first, then settling: the shape of anything arriving. */
export const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
/** Slow at first, then committing: the shape of anything gathering. */
export const easeIn = (t: number) => clamp01(t) ** 2;

/**
 * A body's weight class from its size.
 *
 * Taken from the radius rather than named per archetype so that a body cannot
 * be given a rig weight here and a different one in its model: both come from
 * how big the thing is.
 */
export function weightOf(radius: number): Weight {
  return radius >= 20 ? "heavy" : radius >= 13 ? "mid" : "light";
}

/** Snaps a scale so the drawn height is a whole number of art pixels. */
function onGrid(scale: number, framePx: number): number {
  return Math.round(framePx * scale) / framePx;
}

/**
 * Squash and stretch about the body's own axes, area preserved.
 *
 * `amount` above zero squashes vertically (a landing), below zero stretches
 * (a leap, a lunge leaving the ground).
 */
function squash(amount: number): { scaleX: number; scaleY: number } {
  const y = 1 - amount;
  return { scaleX: 1 / y, scaleY: y };
}

/**
 * Everything a body is doing, at this instant, that its frames do not say.
 *
 * The effects compose: a body hit mid-lunge recoils *and* keeps its stretch,
 * because both are true. Squash multiplies, offsets and tilts add, and the
 * result is clamped so no combination can turn a sprite inside out.
 */
export function bodyFeel(i: BodyFeelInput): BodyFeel {
  const w = WEIGHTS[i.weight];
  let sx = 1, sy = 1, offX = 0, offY = 0, tilt = 0;
  const apply = (amount: number) => {
    const s = squash(amount);
    sx *= s.scaleX; sy *= s.scaleY;
  };
  const aimX = i.aimX ?? 0, aimY = i.aimY ?? 0;

  /*
   * The footfall. The walk cycle already lands a foot; this is the give in
   * the body as it takes the weight, on the same clock as the drawn stride so
   * the two agree. A heavy body gives more, and more slowly, because its
   * cycle is longer.
   */
  if (i.moving && i.stride && i.stride > 0) {
    const phase = ((i.travelled ?? 0) / i.stride) * Math.PI;
    // Two contacts per cycle, each a short dip rather than a sine: a body is
    // only compressed as the foot lands, not for half of every step.
    const contact = Math.max(0, Math.sin(phase)) ** 6;
    apply(contact * w.squash * 0.7);
    offY += contact * w.squash * 2;
    if (i.moveX !== undefined) {
      // A run, not a walk: the body is off the ground between footfalls, and
      // leans into the direction it is going.
      offY -= (1 - Math.abs(Math.sin(phase))) * RUN_LIFT_PX;
      tilt += i.moveX * RUN_LEAN;
    }
  }

  /*
   * Anticipation, commit, settle.
   *
   * The drawn poses do this in three frames; this puts the *travel* between
   * them. The gather eases in against the attack's direction and stretches
   * the body a little upright, the commit snaps past the rest position along
   * it, and the recovery eases back with the overshoot that makes a heavy
   * thing feel heavy.
   */
  if (i.attack === "windup" && (aimX || aimY)) {
    const t = easeIn(1 - clamp01((i.attackMs ?? 0) / 280));
    offX -= aimX * w.recoil * 1.4 * t;
    offY -= aimY * w.recoil * 1.4 * t;
    apply(-w.squash * 0.5 * t);
    tilt -= aimX * 0.05 * t;
  } else if (i.attack === "lunge" && (aimX || aimY)) {
    const t = easeOut(1 - clamp01((i.attackMs ?? 0) / 190));
    offX += aimX * w.recoil * 1.6 * t;
    offY += aimY * w.recoil * 1.6 * t;
    // Stretched along travel as it leaves, squashing as it arrives.
    apply(-w.squash * (1 - t) + w.squash * 0.6 * t);
    tilt += aimX * 0.07 * t;
  } else if (i.attack === "recover" && (aimX || aimY)) {
    const t = clamp01(1 - (i.attackMs ?? 0) / w.settle);
    // An ease-out with one overshoot: forward, a little past standing, home.
    const back = Math.cos(t * Math.PI * 1.5) * (1 - easeOut(t));
    offX += aimX * w.recoil * back;
    offY += aimY * w.recoil * back;
    apply(w.squash * 0.4 * (1 - easeOut(t)));
  }

  /*
   * A hit is a flinch: knocked back along the blow, squashed, tilted off its
   * feet, all gone inside a fifth of a second. It rides over whatever the
   * body was doing, because being hit does not cancel an attack — it
   * interrupts the *look* of one.
   */
  if (i.hitMs && i.hitMs > 0) {
    const t = clamp01(i.hitMs / 160);
    const k = t * t;
    offX += (i.hitX ?? 0) * w.recoil * k;
    offY += (i.hitY ?? 0) * w.recoil * k;
    apply(w.squash * 1.2 * k);
    tilt += (i.hitX ?? 0) * 0.09 * k;
  }

  /*
   * A dash is the body stretched along its travel and dropped back onto its
   * feet at the end. The landing is the only part with a squash, because
   * that is where the ground is.
   */
  if (i.dashMs && i.dashMs > 0) {
    const t = clamp01(i.dashMs / 160);
    apply(-w.squash * 1.3 * t);
    offY -= 1.5 * t;
  }

  /*
   * Turning. A body that flips between facing west and east has swapped its
   * whole silhouette in one frame, which is a cut the eye notices; a squash
   * across the turn covers it the way an animator covers a cut, with the
   * body compressing through the change.
   */
  if (i.sinceTurn !== undefined) {
    const t = clamp01((i.sinceTurn * TICK_MS) / w.turnMs);
    if (t < 1) {
      const k = 1 - easeOut(t);
      sx *= 1 - 0.12 * k;
      sy *= 1 + 0.06 * k;
    }
  }

  /* A hovering body has no contact to time against, so it drifts on two
   * clocks at once, which keeps it from reading as a sprite on a sine. */
  if (i.hover) {
    offY += Math.sin(i.tick / 17) * 1.4;
    offX += Math.sin(i.tick / 29) * 0.9;
    tilt += Math.sin(i.tick / 23) * 0.02;
  }

  /*
   * Death: a pop before the collapse. The body draws up for a beat — the
   * last thing a struck thing does is stiffen — and then folds, which is
   * what makes a kill land rather than simply stop.
   */
  if (i.dying !== undefined) {
    const t = clamp01(i.dying);
    if (t < 0.3) apply(-w.squash * 2 * (t / 0.3));
    else {
      const k = (t - 0.3) / 0.7;
      apply(w.squash * 2.4 * easeOut(k));
      offY += 3 * easeOut(k);
    }
  }

  const lim = (v: number) => Math.max(0.6, Math.min(1.45, v));
  return {
    scaleX: onGrid(lim(sx), i.framePx),
    scaleY: onGrid(lim(sy), i.framePx),
    offX, offY,
    tilt: Math.max(-0.25, Math.min(0.25, tilt)),
  };
}
