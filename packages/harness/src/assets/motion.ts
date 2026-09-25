/**
 * The roster's shared motion: how a sprite model's poses are built from the
 * key drawings a split gives it (doc 016).
 *
 * Every body in the roster animates from the same table. A model says what
 * each of its parts *is* — a body, a head, a foot, a limb, a fin — and how
 * heavy it is, and this file turns that into the poses the atlas needs:
 * a breathing idle, a gait with a real weight shift, an attack with
 * anticipation and follow-through, a recoil, and a sleep that is not a still.
 *
 * Why a table rather than a pose list per body. Sixteen archetypes hand-posed
 * one at a time drift: one gets a six-frame walk and another four, one leans
 * into its windup and another does not, and the roster stops reading as one
 * family. The timings that *should* differ between a rusher and a tank are
 * two numbers — how far a limb travels and how long the body takes to change
 * its mind — so they are the two numbers a body gives, and everything else is
 * shared.
 *
 * Nothing here rotates or scales. Every pose is a variant and a whole-pixel
 * offset, which is the property that keeps a composed frame on the grid.
 */
import type { Facing, Pose, PartPose } from "./models.ts";

/** What a part is, for the purpose of moving it. */
export type Role =
  /** The mass everything else hangs from: bobs with the gait, leads a lunge. */
  | "body"
  /** Follows the body a frame late, so it settles after the body does. */
  | "head"
  /** A leg that takes the ground. Two of them step in opposite phase. */
  | "foot_l" | "foot_r"
  /** A limb that swings against the legs — an arm, a claw, a pincer. */
  | "arm_l" | "arm_r"
  /** Cloth or a carapace fringe: swings after the step, in drawn variants. */
  | "skirt"
  /** A flyer's wing or fin: sways against the bob instead of stepping. */
  | "fin_l" | "fin_r"
  /** Carried and still — a shield, a bell, a barrel. It rides its parent. */
  | "prop";

/** How heavy a body reads, which is the only thing that differs between gaits. */
export type Weight = "light" | "mid" | "heavy";

export interface Timing {
  /** Frames in the walk (or hover) cycle. */
  readonly walk: number;
  /** Frames in the breathing idle and in the sleep. */
  readonly idle: number;
  /** How far a foot travels from its stand position, in pixels. */
  readonly stride: number;
  /** How high the swing foot lifts as it passes under the body. */
  readonly lift: number;
  /** How far a limb swings against the legs. */
  readonly swing: number;
  /** How far the body sinks and rises through the cycle. */
  readonly bob: number;
  /** How far back a body gathers before it commits. */
  readonly gather: number;
  /** How far past the strike the follow-through carries. */
  readonly follow: number;
  /** How far a hit knocks the body off its stand. */
  readonly recoil: number;
}

/**
 * The three weights.
 *
 * A light body takes many quick steps and changes direction in one frame; a
 * heavy one takes fewer, longer ones, gathers further before it commits and
 * carries further past the strike. The walk lengths differ because a long
 * cycle on a fast body is frames nobody sees, and a short one on a slow body
 * is the stop-motion the roster had (`strideFor` in `enemy-frames.ts`).
 *
 * **The travel numbers are large on purpose.** The first set was two pixels of
 * stride and one of bob on a thirty-two pixel body, which measured at 4% of
 * the silhouette changing per frame and 10% between the cycle's extremes: a
 * foot that has not moved, eight times. Frames are easy to add and easy to
 * mistake for animation; what reads at 1× is amplitude. A foot now travels
 * six to seven pixels fore and aft — a fifth of the body — the body bobs two,
 * and the arms swing far enough to break the silhouette's edge.
 * `amplitude.ts` measures it and `amplitude.test.ts` holds the floor, so a
 * body cannot quietly settle back to standing still.
 */
export const TIMING: Record<Weight, Timing> = {
  light: { walk: 8, idle: 4, stride: 7, lift: 4, swing: 4, bob: 2, gather: 7, follow: 8, recoil: 4 },
  mid: { walk: 8, idle: 4, stride: 6, lift: 4, swing: 4, bob: 2, gather: 7, follow: 8, recoil: 4 },
  heavy: { walk: 6, idle: 4, stride: 7, lift: 3, swing: 3, bob: 2, gather: 6, follow: 7, recoil: 3 },
};

/** Which way a facing's body moves: towards the viewer, away, or to the left. */
export const FORWARD: Record<Facing, readonly [number, number]> = {
  s: [0, 1], n: [0, -1], w: [-1, 0],
};

export interface MotionSpec {
  /** Part → what it is. A part with no role is still and rides its parent. */
  readonly roles: Readonly<Record<string, Role>>;
  readonly weight: Weight;
  /**
   * How the body gets about: on legs, hovering (no feet, so it bobs and
   * sways), or fixed in place (an emplacement, which has no gait at all).
   */
  readonly gait: "walk" | "float" | "fixed";
  /** The pose the split left standing, which every generated pose inherits. */
  readonly stand: string;
  /** A drawn gather, if the body has one — the delivered windup frame. */
  readonly crouch?: string;
  /** A drawn commit, if the body has one — the delivered lunge or attack frame. */
  readonly strike?: string;
  /** A drawn slump for the sleeper, if the body has one. */
  readonly slump?: string;
}

const mul = ([x, y]: readonly [number, number], k: number): [number, number] => [Math.round(x * k), Math.round(y * k)];
const add = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [a[0] + b[0], a[1] + b[1]];

/** The parts of a spec with one of the given roles. */
const withRole = (spec: MotionSpec, ...roles: Role[]): string[] =>
  Object.entries(spec.roles).filter(([, r]) => roles.includes(r)).map(([p]) => p);

type Offsets = Record<string, [number, number]>;

/**
 * The breath: how far the body is off its rest on frame `i` of a loop of `n`.
 *
 * The body rises off its rest and settles back **through** it, rather than
 * only lifting: at one pixel of travel a breath that goes up and returns has
 * two of its four frames identical, and a four-frame loop with two drawings
 * in it is a two-frame loop. Rounding a sine gives 0, up, 0, down — four
 * distinct drawings from one pixel of movement, which is the whole trick of a
 * pixel-art idle, and the head a frame behind makes them eight.
 */
export function breath(i: number, n: number, bob: number): number {
  return -bob * Math.round(Math.sin((2 * Math.PI * (((i % n) + n) % n)) / n));
}

/** A pose that inherits `base` and offsets the parts that moved. */
function poseOf(base: string, offsets: Offsets, variants: Record<string, string> = {}): Pose {
  const parts: Record<string, PartPose> = {};
  for (const [part, at] of Object.entries(offsets)) if (at[0] || at[1]) parts[part] = { at };
  for (const [part, v] of Object.entries(variants)) parts[part] = { ...(parts[part] ?? {}), v };
  return { base, ...(Object.keys(parts).length ? { parts } : {}) };
}

/**
 * The gait, frame by frame.
 *
 * Everything moves, not only the feet. The feet step along the facing and the
 * swing foot lifts as it passes under the body; the body rises as a foot
 * passes and, if it is heavy, sinks as one lands; the head follows the body a
 * frame late; the limbs swing against the legs. A flyer has no feet, so its
 * body rides a slow figure of eight and its fins beat against it.
 */
function gaitOffsets(spec: MotionSpec, facing: Facing, i: number, n: number): Offsets {
  const t = TIMING[spec.weight];
  const fwd = FORWARD[facing];
  const phase = (k: number) => (2 * Math.PI * (((k % n) + n) % n)) / n;
  const bobAt = (k: number): number => {
    const c = Math.abs(Math.cos(phase(k))), s = Math.abs(Math.sin(phase(k)));
    if (c > 0.85) return -Math.round(t.bob * bobScale);
    if (spec.weight !== "light" && s > 0.85) return Math.round(t.bob * bobScale);
    return 0;
  };
  /*
   * A step is foreshortened head-on.
   *
   * The side view shows a stride at its full length; the front and back views
   * show the same stride pointing at the camera, which on a flat sprite is a
   * few pixels of travel down the screen. Given the side view's length, a
   * foot leaves the body entirely — it drops below the hem and reads as a
   * boot lying on the floor. Half is what a three-quarter view draws.
   */
  const short = facing === "w" ? 1 : 0.6;
  // Head-on, what the eye has instead of a stride is the body rising and
  // falling, so the bob carries the cycle the foreshortening takes away.
  const bobScale = facing === "w" ? 1 : 1.5;
  const out: Offsets = {};
  if (spec.gait === "float") {
    // A hovering body has no contact to time against, so it drifts: up and
    // down on one clock, and a half-beat of sway on the other, which is what
    // keeps it from reading as a sprite on a sine wave.
    // The drift is in screen space, not the body's: a hovering thing rises and
    // falls on the screen whichever way it is looking. It rises and falls and
    // nothing more — the sway that makes the path a figure of eight lives in
    // the fins. Carried by the body it moved the whole silhouette sideways,
    // and on a body that is mostly tentacle a one-pixel sideways move is a
    // sixth of the drawing changing at once, which pops.
    const up = -Math.round(t.bob * 1.4 * Math.sin(phase(i)));
    for (const p of withRole(spec, "body")) out[p] = [0, up];
    for (const p of withRole(spec, "head")) out[p] = [0, -Math.round(t.bob * 1.4 * Math.sin(phase(i - 1))) - up];
    // A fin beats half as far as a leg strides. A tentacle is two pixels
    // wide, so three pixels of sway is most of its silhouette moving at once
    // and the frame pops rather than drifting.
    for (const [p, sign] of [...withRole(spec, "fin_l").map((p) => [p, 1] as const), ...withRole(spec, "fin_r").map((p) => [p, -1] as const)])
      out[p] = [sign * Math.round((t.swing / 2) * Math.sin(phase(i))), Math.round(t.bob * Math.cos(phase(i))) - up];
    return out;
  }
  // Offsets are read against the part's parent, and every limb hangs from the
  // body, so a limb that should stay where it is while the body bobs has to
  // be given the bob back. The feet take it only when the body rises: a foot
  // pushed down as the body sinks is a foot through the floor.
  const bob = bobAt(i);
  for (const [p, sign] of [...withRole(spec, "foot_l").map((p) => [p, 1] as const), ...withRole(spec, "foot_r").map((p) => [p, -1] as const)]) {
    const along = Math.round(sign * t.stride * short * Math.sin(phase(i)));
    const lift = -Math.round(t.lift * short * Math.max(0, sign * Math.cos(phase(i))) ** 1.5);
    out[p] = add(mul(fwd, along), [0, lift - Math.min(0, bob)]);
  }
  for (const p of withRole(spec, "body")) out[p] = [0, bob];
  for (const p of withRole(spec, "head")) out[p] = [0, bobAt(i - 1) - bob];
  for (const [p, sign] of [...withRole(spec, "arm_l").map((p) => [p, -1] as const), ...withRole(spec, "arm_r").map((p) => [p, 1] as const)])
    out[p] = mul(fwd, Math.round(sign * t.swing * short * Math.sin(phase(i))));
  return out;
}

/** The skirt variant a gait frame is on: pulled back as each step reaches. */
function skirtVariant(spec: MotionSpec, i: number, n: number, have: (v: string) => boolean): Record<string, string> {
  const parts = withRole(spec, "skirt");
  if (!parts.length) return {};
  const s = Math.sin((2 * Math.PI * i) / n);
  const v = s > 0.4 ? "sway_l" : s < -0.4 ? "sway_r" : "stand";
  if (!have(v)) return {};
  return Object.fromEntries(parts.map((p) => [p, v]));
}

/**
 * Every pose a body animates in, given the drawings the split left it.
 *
 * `have(part, variant)` says whether a drawing exists, so a body that was
 * split from three figures uses all three and one split from a single
 * standing figure still gets the whole set, posed from the one drawing it has.
 */
export function motionPoses(
  spec: MotionSpec, facing: Facing, have: (part: string, variant: string) => boolean,
): Record<string, Pose> {
  const t = TIMING[spec.weight];
  const fwd = FORWARD[facing];
  const back = mul(fwd, -1);
  const out: Record<string, Pose> = {};
  const bodies = withRole(spec, "body");
  const heads = withRole(spec, "head");
  const feet = [...withRole(spec, "foot_l"), ...withRole(spec, "foot_r")];
  const arms = [...withRole(spec, "arm_l"), ...withRole(spec, "arm_r")];
  const all = Object.keys(spec.roles);
  const everyPart = (at: [number, number], parts = all): Offsets =>
    Object.fromEntries(parts.map((p) => [p, at]));

  /* The breath. The body rises and falls a pixel over four frames and the
   * head follows it a frame late, which is what makes it a settle rather
   * than a pulse: at no frame is the whole body on one offset. */
  for (let i = 0; i < t.idle; i++) {
    const rise = breath(i, t.idle, t.bob);
    const lag = breath(i - 1, t.idle, t.bob);
    out[`idle${i}`] = poseOf(spec.stand, {
      ...everyPart([0, rise], bodies),
      ...everyPart([0, lag - rise], heads),
      ...everyPart([0, i % 2 ? -1 : 0], arms.length && t.swing > 1 ? arms : []),
      ...everyPart([0, -Math.min(0, rise)], feet),
    });
  }

  /*
   * Looking about: the loop a body runs before it has seen the player.
   *
   * It is a different motion from the awake breath, not the same one slowed
   * down, because those two states are the difference between safe and not
   * and the player reads them at a glance. The breath is vertical and the
   * watch is lateral — the weight shifts from one foot to the other over
   * planted feet and the head goes further than the body, which is a creature
   * scanning a room rather than one holding its guard.
   */
  for (let i = 0; i < t.idle; i++) {
    const lean = Math.round(Math.sin((2 * Math.PI * i) / t.idle));
    out[`watch${i}`] = poseOf(spec.stand, {
      ...everyPart([lean, 0], bodies),
      ...everyPart([lean, breath(i - 1, t.idle, t.bob)], heads),
      ...everyPart([-lean, 0], feet),
    });
  }

  /* The gait. */
  if (spec.gait !== "fixed")
    for (let i = 0; i < t.walk; i++)
      out[`walk${i}`] = poseOf(spec.stand, gaitOffsets(spec, facing, i, t.walk),
        skirtVariant(spec, i, t.walk, (v) => withRole(spec, "skirt").every((p) => have(p, v))));

  /*
   * The attack: gather, commit, carry through, come back.
   *
   * The gather is the drawn crouch where there is one, pulled a little
   * further back than the drawing sits — anticipation is the frame that sells
   * the commit, and the delivered windups were drawn as a stance rather than
   * as a move. The commit is the drawn lunge pushed forward; the follow is
   * that same drawing carried past it with the head leading, which is the
   * frame the delivered sheets never had; the recovery is an in-between on
   * the way back to standing, so the whole move reads as one arc.
   */
  // The body is the root, so a limb follows it without being told to: every
  // whole-figure move here is the body's offset alone.
  const crouch = spec.crouch && have(bodies[0] ?? "", spec.crouch) ? spec.crouch : null;
  out.windup = crouch
    ? poseOf(crouch, { ...everyPart(mul(back, Math.round(t.gather / 2)), bodies), ...everyPart(mul(back, 1), heads) })
    : poseOf(spec.stand, { ...everyPart(mul(back, t.gather), bodies), ...everyPart(mul(back, 1), [...heads, ...arms]) });
  const strike = spec.strike && have(bodies[0] ?? "", spec.strike) ? spec.strike : null;
  out.lunge = strike
    ? poseOf(strike, everyPart(mul(fwd, Math.round(t.follow / 2)), bodies))
    : poseOf(spec.stand, { ...everyPart(mul(fwd, Math.round(t.follow / 2)), bodies), ...everyPart(mul(fwd, 1), [...heads, ...arms]) });
  out.follow = strike
    ? poseOf(strike, { ...everyPart(mul(fwd, t.follow), bodies), ...everyPart(mul(fwd, 1), [...heads, ...arms]) })
    : poseOf(spec.stand, { ...everyPart(mul(fwd, t.follow), bodies), ...everyPart(mul(fwd, 2), [...heads, ...arms]) });
  out.recover = { between: ["follow", spec.stand], t: 0.5 };

  /*
   * The recoil: knocked off the stand and settling back, two frames. It is
   * meant to pop — it is the one place in the set where a frame may jump,
   * because a hit that eases is a hit the player misses.
   */
  out.hit0 = poseOf(spec.stand, {
    ...everyPart(mul(back, t.recoil), bodies),
    ...everyPart(mul(back, 1), heads),
  });
  out.hit1 = poseOf(spec.stand, {
    ...everyPart(add(mul(back, Math.max(1, t.recoil - 2)), [0, -1]), bodies),
    ...everyPart(mul(fwd, 1), heads),
  });

  /*
   * Asleep, and waking.
   *
   * A dormant body used to be one drawing, so a sleeping room was a room of
   * statues. It breathes instead: the same four-frame settle as the idle,
   * slower in the game's clock and around a lower body, on the drawn slump
   * where there is one. `stir` is the head coming up — the frame between
   * noticing and standing, which is what makes the wake-up read as an
   * animal rather than as a state change.
   */
  const slump = spec.slump && have(bodies[0] ?? "", spec.slump) ? spec.slump : null;
  const sunk = Math.max(1, t.bob + 1);
  for (let i = 0; i < t.idle; i++) {
    const rise = breath(i, t.idle, t.bob);
    const lag = breath(i - 1, t.idle, t.bob);
    out[`dormant${i}`] = slump
      ? poseOf(slump, { ...everyPart([0, rise], bodies), ...everyPart([0, lag - rise], heads) })
      : poseOf(spec.stand, {
        ...everyPart([0, sunk + rise], bodies),
        ...everyPart([0, 1 + lag - rise], heads),
        ...everyPart([0, -sunk - Math.min(0, rise)], feet),
      });
  }
  out.stir = slump
    ? poseOf(slump, { ...everyPart([0, -1], bodies), ...everyPart([0, -2], heads) })
    : poseOf(spec.stand, {
      ...everyPart([0, Math.max(0, sunk - 1)], bodies),
      ...everyPart([0, -2], heads),
      ...everyPart([0, 1 - sunk], feet),
    });

  return out;
}

/**
 * The atlas frames a motion set delivers, for `anims.json`.
 *
 * `flat` is for a body drawn once rather than per facing — a turret, a
 * sentinel, the boss — whose frames carry no direction in their names.
 */
export function motionFrames(base: string, spec: MotionSpec, flat = false): Record<string, string> {
  const t = TIMING[spec.weight];
  const frames: Record<string, string> = {};
  const put = (suffix: string, pose: string) => { frames[flat ? `${base}_${suffix}` : `${base}_{f}_${suffix}`] = pose; };
  for (let i = 0; i < t.idle; i++) put(`idle${i}`, `idle${i}`);
  for (let i = 0; i < t.idle; i++) put(`watch${i}`, `watch${i}`);
  if (spec.gait !== "fixed") for (let i = 0; i < t.walk; i++) put(`walk${i}`, `walk${i}`);
  for (const p of ["windup", "lunge", "follow", "recover", "hit0", "hit1", "stir"]) put(p, p);
  for (let i = 0; i < t.idle; i++) put(`dormant${i}`, `dormant${i}`);
  // The names the sheets already delivered, kept so nothing the game asks for
  // by its old name goes missing: `dormant` is the first frame of the sleep.
  put("dormant", "dormant0");
  return frames;
}
