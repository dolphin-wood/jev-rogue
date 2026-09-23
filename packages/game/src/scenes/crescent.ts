/**
 * The crescent: one arc-swing renderer, used by the player's sword and by
 * every enemy blade.
 *
 * It is shared rather than duplicated because the enemy attacks were drawn as
 * a flat filled sector — a `slice()` and a fill — and that reads as a debug
 * overlay, which is exactly what it was. The player's swing had the same
 * problem and took about a dozen rounds of correction to stop looking abstract,
 * and every one of those corrections is a property of *an arc attack* rather
 * than of the player:
 *
 * - **Tapered ends.** A uniform-width band has blunt ends and reads as a
 *   painted stripe. The trail has to come to a point at both ends, which means
 *   filled polygons rather than a stroke, because a stroke is uniform width.
 * - **Alpha along the sweep.** The ground the blade has already passed must be
 *   fainter than where the blade is now, or the whole arc appears at once and
 *   nothing indicates which way it is travelling. Graphics has no gradient
 *   fill, so the gradient *is* the segments.
 * - **A radius ramp.** The tail sits closer in than the head, which is what
 *   makes the shape a crescent instead of an annulus.
 * - **Sparks.** Most of why a hand-drawn crescent reads as energy rather than
 *   as a shape, and they cost three fills. Positioned from the swing's own
 *   angle rather than from random numbers, so they hold still between frames
 *   instead of flickering.
 * - **An inner streak.** The hitbox covers the whole sector from the body out
 *   to `reach`, while the crescent only occupies the outer band, so without a
 *   blade filling the gap a player would reasonably conclude that only the
 *   crescent hits.
 *
 * What differs between the player and an enemy is the palette and the
 * clearance around the body. Nothing about the shape.
 */
import type { SwingBox } from "@jr/core";

/**
 * A swing's palette, dark to bright: the **shadow** that separates the trail
 * from a floor of the same hue, the soft **body** of the smear, the **rim**
 * band along the outer edge, the white-hot **edge** line, and the sparks.
 */
export interface CrescentStyle {
  readonly shadow: number;
  readonly body: number;
  readonly rim: number;
  readonly edge: number;
  readonly sparkColour: number;
}

export interface CrescentOptions {
  readonly style: CrescentStyle;
  /** Kept for callers; the smear's thickness is a share of the reach now. */
  readonly strokePx: number;
  readonly taperPeak: number;
  readonly segments: number;
  readonly falloff: number;
  readonly sparks: number;
  /** Where the smear's inner edge may reach, so it does not cover the body. */
  readonly bodyClearPx: number;
  /**
   * Drawn no wider than the hitbox, ever. Narrower is allowed and deliberate;
   * the rule is only that the hitbox may never be narrower than the visual.
   */
  readonly radiusScale: number;
  /** 0 to 1: how much of full thickness this frame is at. */
  readonly width: number;
  /** 0 to 1: overall opacity, for fading out through a recovery. */
  readonly fade: number;
  /** 0 to 1: how much of the trail has been eaten from the tail. */
  readonly tailCut: number;
  /**
   * **Where the swing is drawn in the air.** The hitbox is a disc on the
   * floor; a slash is thrown at chest height, and in this three-quarter view
   * that is a raised, flattened ellipse. `lift` raises the centre, `squash`
   * flattens the vertical, `dx`/`dy` move it (a lunge). All default to the
   * floor disc. Flattening only ever narrows the picture inside the hitbox.
   */
  readonly lift?: number;
  readonly squash?: number;
  readonly dx?: number;
  readonly dy?: number;
}

/** Smoothstep, for ramps that should ease rather than kink. */
function ease(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Draws one swing's crescent into `gfx`.
 *
 * **A smear, not a stripe.** The trail is the whole band the blade has swept
 * — from the tip in toward the body, thick behind the blade and thinning to a
 * point at the tail — drawn in four layers: a dark shadow just outside the
 * edge so it reads on a floor of its own hue, a soft body, a brighter rim
 * along the outer edge, and a white edge line. Everything brightens toward
 * the blade, so the direction of travel is in the picture. The blade itself
 * gets a flash along its length and a glint at the tip, and sparks hang off
 * the edge just behind it.
 *
 * Reads the box's live geometry, so the shape shown is the shape tested. The
 * caller owns only the timing-derived numbers: how thick, how faded, and how
 * much of the tail has gone.
 */
export function drawCrescent(
  gfx: Phaser.GameObjects.Graphics, box: SwingBox, o: CrescentOptions,
): void {
  // The whole swept range so far, symmetric about the swing's direction.
  const from = box.facing - (box.sweep * box.sweepDeg * Math.PI) / 360;
  const to = box.angle;
  const span = to - from;
  if (Math.abs(span) < 1e-3) return;
  const R = box.reach * o.radiusScale;
  const inner = Math.max(o.bodyClearPx, R * 0.4);
  const n = Math.max(12, o.segments + 6);
  const st = o.style;
  const cx = box.x + (o.dx ?? 0);
  const cy = box.y - (o.lift ?? 0) + (o.dy ?? 0);
  const sq = o.squash ?? 1;
  /** A point at angle `a` and radius `r`, in the swing's drawn plane. */
  const P = (a: number, r: number): [number, number] => [cx + Math.cos(a) * r, cy + Math.sin(a) * r * sq];

  /** Angle, outer and inner radius, and brightness at `u` (tail 0, blade 1). */
  const at = (u: number) => {
    const k = ease(u);
    const thick = (R - inner) * (0.22 + 0.78 * k) * (0.6 + 0.4 * o.width);
    return { a: from + span * u, outer: R * (0.9 + 0.1 * k), thick, glow: Math.pow(u, 1.4) };
  };
  const band = (u0: number, u1: number, r0: (p: ReturnType<typeof at>) => number, r1: (p: ReturnType<typeof at>) => number) => {
    const p0 = at(u0);
    const p1 = at(u1);
    gfx.beginPath();
    gfx.moveTo(...P(p0.a, r1(p0)));
    gfx.lineTo(...P(p1.a, r1(p1)));
    gfx.lineTo(...P(p1.a, r0(p1)));
    gfx.lineTo(...P(p0.a, r0(p0)));
    gfx.closePath();
    gfx.fillPath();
  };

  for (let i = 0; i < n; i++) {
    const u0 = i / n;
    const u1 = (i + 1) / n;
    const mid = (u0 + u1) / 2;
    if (mid <= o.tailCut) continue;
    // Re-normalised as the tail is cut, so the stub does not brighten on its way out.
    const along = o.tailCut >= 1 ? 0 : (mid - o.tailCut) / (1 - o.tailCut);
    const g = Math.pow(along, Math.max(0.8, o.falloff * 0.8)) * o.fade;
    if (g <= 0.02) continue;
    const p = at(mid);
    // Shadow, just outside the edge.
    gfx.fillStyle(st.shadow, 0.4 * g);
    band(u0, u1, (q) => q.outer + 0.2, (q) => q.outer + 1.8);
    // Body: the whole smear.
    gfx.fillStyle(st.body, 0.3 * g);
    band(u0, u1, (q) => q.outer - q.thick, (q) => q.outer);
    // The denser inner half of the body, toward the edge.
    gfx.fillStyle(st.body, 0.3 * g);
    band(u0, u1, (q) => q.outer - q.thick * 0.55, (q) => q.outer);
    // Rim.
    gfx.fillStyle(st.rim, 0.75 * g);
    band(u0, u1, (q) => q.outer - Math.max(1.6, q.thick * 0.22), (q) => q.outer);
    // Edge line.
    gfx.fillStyle(st.edge, Math.min(1, 0.95 * Math.pow(along, 0.6) * o.fade) * (0.4 + 0.6 * p.glow));
    band(u0, u1, (q) => q.outer - 1.1, (q) => q.outer + 0.3);
  }

  // The blade's flash along its length, and a glint at the tip.
  const head = at(1);
  if (o.tailCut < 0.9) {
    const [ix, iy] = P(head.a, head.outer - head.thick);
    const [jx, jy] = P(head.a, head.outer - head.thick * 0.8);
    const [ox, oy] = P(head.a, head.outer + 1);
    const [tx, ty] = P(head.a, head.outer);
    gfx.lineStyle(2.4, st.rim, 0.35 * o.fade);
    gfx.lineBetween(ix, iy, ox, oy);
    gfx.lineStyle(1, st.edge, 0.85 * o.fade);
    gfx.lineBetween(jx, jy, ox, oy);
    gfx.fillStyle(st.edge, 0.9 * o.fade);
    gfx.fillCircle(tx, ty, 1.6);
    gfx.fillStyle(st.rim, 0.3 * o.fade);
    gfx.fillCircle(tx, ty, 4);
  }

  drawSparks(gfx, from, span, R, o, P);
}

/**
 * Sparks hanging off the edge just behind the blade, thrown outward a little
 * further the older they are. Placed from the swing's own angle rather than
 * from random numbers, so they hold still between frames instead of flickering.
 */
function drawSparks(
  gfx: Phaser.GameObjects.Graphics,
  from: number, span: number, R: number, o: CrescentOptions,
  P: (a: number, r: number) => [number, number],
): void {
  for (let i = 0; i < o.sparks + 2; i++) {
    const behind = (i + 1) / (o.sparks + 3);
    const u = 1 - behind * 0.55;
    if (u <= o.tailCut) continue;
    const a = 0.95 * o.fade * (1 - behind);
    if (a <= 0.04) continue;
    const ang = from + span * u;
    const rr = R * (1.02 + behind * (0.12 + 0.05 * (i % 3)));
    const size = i % 2 === 0 ? 1.6 : 1.1;
    gfx.fillStyle(o.style.sparkColour, a);
    const [x, y] = P(ang, rr);
    gfx.fillRect(x - size / 2, y - size / 2, size, size);
  }
}

/** The player's sword: cold steel, a pale blue smear, a white edge. */
export const PLAYER_CRESCENT: CrescentStyle = {
  shadow: 0x0d0b1f, body: 0x8fd0ff, rim: 0xcfeeff, edge: 0xffffff, sparkColour: 0xe8f6ff,
};

/**
 * An enemy blade: hot, so it never reads as the player's own swing.
 *
 * Colour is the only thing separating "this will hurt me" from "this is my
 * attack" in a busy frame, so the two palettes share no hue. The shape being
 * identical is the point — the player learns one shape and it means *an arc is
 * being swung here*, whoever is swinging it.
 */
export const ENEMY_CRESCENT: CrescentStyle = {
  shadow: 0x2a0b12, body: 0xff5a3c, rim: 0xffa070, edge: 0xfff0d8, sparkColour: 0xffb37a,
};
