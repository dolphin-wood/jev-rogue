/**
 * Where the conjured blade is.
 *
 * **The hit is the truth.** The blade's point is on the arc the simulation is
 * actually sweeping — the swing's own centre, plus its reach along its
 * current angle — so what the player sees is what hits. Its root is the drawn
 * crystal in the staff's head *when the drawing agrees with the cut*, and the
 * hand when it does not.
 *
 * That last clause is the whole of the hard-won part. Three tries got it
 * wrong in three ways, and each looked like a different bug:
 *
 * - rooted on a small circle around the swing box and aimed at the arc, so
 *   the blade floated six to eight pixels off the staff it was supposed to
 *   grow from;
 * - rooted on the crystal and aimed at the arc, so it left the staff at an
 *   angle the staff was not pointing and, from the side, ran back through
 *   the body;
 * - rooted on the crystal and aimed **along the staff**, which is right for a
 *   still frame and wrong in play: the aim is continuous and there are five
 *   drawn keys per facing, so the drawn staff can be most of a right angle
 *   from the actual cut. The blade then pointed somewhere the attack was not,
 *   at whatever length the two origins happened to differ by — three body
 *   heights, down and to the left, in the report that ended it.
 *
 * So the point is the sim's and the root is the drawing's, and the root is
 * only used while it is on the cut's side of the body, still ahead of the
 * point, and no further from it than the reach. Otherwise the hand carries
 * it. A blade that cannot be grown from the staff honestly is grown from the
 * fist, which is never wrong, only less pretty.
 */

export interface ConjuredBlade {
  /** Where the blade starts. */
  readonly rootX: number;
  readonly rootY: number;
  /** Root to point, in radians. */
  readonly angle: number;
  /** Where the blade ends: on the hit arc, always. */
  readonly pointX: number;
  readonly pointY: number;
  /** False when the drawn staff disagreed with the cut and the hand carried it. */
  readonly fromCrystal: boolean;
}

/** How far past the reach a root may sit before the hand takes over, in px. */
export const BLADE_SLACK_PX = 2;
/** How far the blade may lie off the cut's own line before the hand takes over. */
export const MAX_BLADE_SKEW_DEG = 35;

export interface BladeInput {
  /** The swing's own centre, which the arc is measured from. */
  readonly centre: readonly [number, number];
  /** The fallback root: the hand the sim carries round the arc. */
  readonly hand: readonly [number, number];
  /** The drawn staff's crystal, or null for a frame that draws no staff. */
  readonly crystal: readonly [number, number] | null;
  /** The point on the hit arc: centre + reach along the current angle. */
  readonly point: readonly [number, number];
  readonly reach: number;
}

export function conjuredBlade(i: BladeInput): ConjuredBlade {
  const [px, py] = i.point;
  const dx = px - i.centre[0], dy = py - i.centre[1];
  const dl = Math.hypot(dx, dy) || 1;
  const ux = dx / dl, uy = dy / dl;
  const root = (() => {
    const c = i.crystal;
    if (!c) return i.hand;
    // On the cut's side of the body, or the blade crosses it.
    if ((c[0] - i.centre[0]) * ux + (c[1] - i.centre[1]) * uy < 0) return i.hand;
    // Still behind the point, or the blade points back down the cut.
    if ((px - c[0]) * ux + (py - c[1]) * uy <= 0) return i.hand;
    // No longer than the attack reaches.
    if (Math.hypot(px - c[0], py - c[1]) > i.reach + BLADE_SLACK_PX) return i.hand;
    // And not so far off to one side that the blade lies across the cut
    // rather than along it: a crystal beside the body passes the tests above
    // and still leaves the blade grazing the shoulder it came from.
    if (angleGapDeg(Math.atan2(py - c[1], px - c[0]), Math.atan2(uy, ux)) > MAX_BLADE_SKEW_DEG) return i.hand;
    return c;
  })();
  return {
    rootX: root[0], rootY: root[1],
    angle: Math.atan2(py - root[1], px - root[0]),
    pointX: px, pointY: py,
    fromCrystal: root === i.crystal,
  };
}

/** Degrees between two angles, 0 to 180. */
export function angleGapDeg(a: number, b: number): number {
  const d = Math.abs(((a - b) * 180) / Math.PI) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * The staff through a swing, and the blade that continues it.
 *
 * **The staff stops being a drawn pose and becomes a sprite the renderer
 * turns.** Five drawn keys per facing cannot follow a continuous aim: asked
 * to, they produced a staff held upside down with its crystal at the floor,
 * and a blade leaving it at an angle the staff was not pointing. So through a
 * cut the staff is one drawing rotated to the cut's own angle, gripped a
 * little out from the swing's centre, crystal always outward. The blade is
 * the same line continued from the crystal, and its point is on the arc the
 * simulation is sweeping, so what is seen is what hits.
 *
 * The angle is **snapped** to a fixed set of steps. A pixel sprite turned by
 * a continuous angle resamples its own edges differently every frame and
 * crawls; at 32 steps the staff moves in visible clicks that read as a fast
 * sweep, and each click is a stable set of pixels.
 */
export const STAFF_ANGLE_STEPS = 32;

/**
 * The staff **in every state**, not only through a cut.
 *
 * It used to be two staffs: one composed into the idle, walk and cast frames
 * by the model, and a second sprite the renderer turned through a swing. They
 * were drawn from the same part, which hid the real cost — two things to keep
 * agreeing about where a hand is, and a jump in position and in depth on the
 * frame a swing began, because the drawn one hung off the arm's joint and the
 * sprite hung off a grip the renderer worked out for itself.
 *
 * Now no player frame draws a staff. The model still owns the drawing and,
 * per frame, where the fist is (`hand`) and which way the staff points
 * (`staffAngleDeg`); the renderer places one sprite on those numbers, in the
 * idle exactly as in the cut. The only thing that changes through a swing is
 * where the angle comes from: the cut, rather than the pose.
 */
export interface HeldStaff {
  /** The fist, which is where the sprite is turned about. */
  readonly gripX: number;
  readonly gripY: number;
  /** Which way the staff points, crystal outward, in radians. */
  readonly angle: number;
  readonly crystalX: number;
  readonly crystalY: number;
  /**
   * Where the sprite's **centre** goes.
   *
   * The sprite is cut with its own grip at the frame's centre, and that grip
   * is one particular point on the shaft. A facing that holds the staff
   * higher up — the back view does, by five art pixels — would otherwise put
   * its crystal five pixels out of place, so the sprite slides along its own
   * axis by the difference instead. The fist still lands on `grip`.
   */
  readonly spriteX: number;
  readonly spriteY: number;
}

/**
 * The staff held at an angle the pose gives, rather than one a cut gives.
 *
 * `flipX` mirrors the lean with the body: a facing drawn mirrored holds the
 * staff mirrored, or the east-facing idle leans the way the west one does and
 * the crystal crosses the head.
 */
export function heldStaff(i: {
  readonly grip: readonly [number, number];
  readonly angleDeg: number;
  readonly flipX: boolean;
  /** Grip to crystal along the shaft, in world px, for **this frame**. */
  readonly gripToCrystal: number;
  /** Grip to crystal in the sprite as it was cut, in world px. */
  readonly spriteGripToCrystal: number;
}): HeldStaff {
  const raw = (i.angleDeg * Math.PI) / 180;
  const angle = i.flipX ? Math.PI - raw : raw;
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const [gripX, gripY] = i.grip;
  const slide = i.gripToCrystal - i.spriteGripToCrystal;
  return {
    gripX, gripY, angle,
    crystalX: gripX + ux * i.gripToCrystal,
    crystalY: gripY + uy * i.gripToCrystal,
    spriteX: gripX + ux * slide,
    spriteY: gripY + uy * slide,
  };
}

/** The same slide, for a staff whose angle came from a cut (`swingStaff`). */
export function staffSpriteCentre(
  s: { readonly gripX: number; readonly gripY: number; readonly angle: number },
  gripToCrystal: number, spriteGripToCrystal: number,
): { x: number; y: number } {
  const slide = gripToCrystal - spriteGripToCrystal;
  return { x: s.gripX + Math.cos(s.angle) * slide, y: s.gripY + Math.sin(s.angle) * slide };
}

export interface SwingStaff {
  /** The angle actually drawn: the cut's, snapped to a step. */
  readonly angle: number;
  readonly gripX: number;
  readonly gripY: number;
  readonly crystalX: number;
  readonly crystalY: number;
  /** The blade's point, on the hit arc. */
  readonly tipX: number;
  readonly tipY: number;
}

export function swingStaff(i: {
  readonly centre: readonly [number, number];
  /**
   * The **drawn** sword hand, after the body's own transform. The staff is
   * gripped where the fist is, not on a circle around the swing box: the
   * circle put its butt above the head with the hand holding nothing.
   */
  readonly grip: readonly [number, number];
  /** The cut's current angle, from the simulation. */
  readonly angle: number;
  /** How far the attack reaches, which is where the blade ends. */
  readonly reach: number;
  /** Grip to crystal along the staff, from the staff sprite's own anchors. */
  readonly gripToCrystal: number;
  readonly steps?: number;
}): SwingStaff {
  const steps = i.steps ?? STAFF_ANGLE_STEPS;
  const quantum = (Math.PI * 2) / steps;
  const [gripX, gripY] = i.grip;
  /*
   * The tip is the attack's: on the arc, at the cut's own angle from the
   * swing's centre. The staff then points **from the fist at that tip**,
   * which is not quite the cut's angle, because the fist is a few pixels off
   * the centre and a hand does not hold a stick along a radius. Aiming the
   * staff at the cut's angle instead left the blade — which has to reach the
   * tip — leaving the crystal at up to fifteen degrees off the shaft, and
   * that gap is exactly what "the blade doesn't continue the staff" was.
   * Grip, crystal and tip are one line now, and the snapping is the only
   * thing that can part them.
   */
  const tipX = i.centre[0] + Math.cos(i.angle) * i.reach;
  const tipY = i.centre[1] + Math.sin(i.angle) * i.reach;
  const angle = Math.round(Math.atan2(tipY - gripY, tipX - gripX) / quantum) * quantum;
  const ux = Math.cos(angle), uy = Math.sin(angle);
  return {
    angle, gripX, gripY,
    crystalX: gripX + ux * i.gripToCrystal,
    crystalY: gripY + uy * i.gripToCrystal,
    tipX, tipY,
  };
}
