/**
 * Aiming and aim assist.
 *
 * Two ideas from the twin-stick literature, both invisible when they work:
 *
 * - **Never snap.** A view direction that jumps to the input reads as a
 *   glitch; rotating toward it, even quickly, reads as a character turning.
 * - **Bullet magnetism.** A shot that misses by a hair should hit. The test
 *   is the angle between the shot and the target *after* projecting the
 *   player's aim, not the raw angular error, which shrinks with distance and
 *   would make far targets impossible to assist and near ones magnetic.
 *
 * Assist is deliberately a narrow cone and a partial blend: the player has to
 * keep doing the aiming, and only the last degree or two is given back.
 */
import type { World } from "./types.ts";

/** Half-angle of the assist cone. Wider than this and the game aims for you. */
export const ASSIST_CONE_DEG = 14;
/** How much of the remaining error is removed. 1 would be an auto-aim. */
export const ASSIST_STRENGTH = 0.65;
export const ASSIST_RANGE = 460;

/**
 * The wider cone a **keyed spell** is allowed to seek in, and how far.
 *
 * The sword's assist is deliberately a hair's correction, because a swing is
 * aimed with the body and the player is looking at the arc. A spell is not:
 * the three keys are pressed while the left hand is steering and the facing
 * is whatever the last step left it at, so demanding a fourteen-degree aim
 * from a keyboard is asking the player to line up a shot they have no control
 * to line up with. This is a *seeking* cone, not a bending one — the shot is
 * still launched where the player is facing, and it curves in over its flight
 * (see `Bullet.seekDegPerS`), so a badly aimed cast is a slow arc rather than
 * a shot that teleports onto a body.
 */
export const SEEK_CONE_DEG = 52;
export const SEEK_RANGE = 520;

/**
 * The enemy a keyed spell will curve toward, or null.
 *
 * Picked by angle from the firing direction rather than by distance, because
 * what the player meant is "the one I am facing", and the nearest body may be
 * behind them. Ties are broken toward the closer one.
 */
export function seekTargets(
  world: World, x: number, y: number, dirX: number, dirY: number,
): { id: number; x: number; y: number }[] {
  const cone = (SEEK_CONE_DEG * Math.PI) / 180;
  const found: { id: number; x: number; y: number; score: number }[] = [];
  for (const e of world.enemies) {
    if (e.hp <= 0 || e.spawnFadeMs > 0) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist > SEEK_RANGE || dist < 1) continue;
    const angle = angleBetween(dirX, dirY, dx / dist, dy / dist);
    if (angle > cone) continue;
    // Angle first, distance as the tiebreaker, at about a degree per 40 px.
    found.push({ id: e.id, x: e.x, y: e.y, score: angle + dist / 40 / 57.3 });
  }
  found.sort((a, b) => a.score - b.score);
  return found.map(({ id, x: ex, y: ey }) => ({ id, x: ex, y: ey }));
}

/** The single best target, for a spell that fires one projectile. */
export function seekTarget(
  world: World, x: number, y: number, dirX: number, dirY: number,
): { id: number; x: number; y: number } | null {
  return seekTargets(world, x, y, dirX, dirY)[0] ?? null;
}
/** Radians per second the drawn facing rotates toward the aim. */
/**
 * How fast a body turns, in radians per second.
 *
 * Cut from 14, which is 800 degrees a second — a full reversal in under a
 * quarter of a second, for everything from a jellyfish to an armoured tank.
 * Combined with an acceleration that let them reverse just as fast, it is most
 * of what made the roster feel twitchy rather than dangerous.
 *
 * 7 is 400 degrees a second before the per-archetype weight scaling, so the
 * lightest body still turns briskly and the tank takes most of a second to
 * come about — which is what makes its charge something the player can steer.
 */
export const FACING_TURN_RATE = 7;

export interface Aimed {
  readonly x: number;
  readonly y: number;
  /** The enemy the shot was bent toward, if any. */
  readonly assisted: boolean;
}

function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const dot = ax * bx + ay * by;
  const det = ax * by - ay * bx;
  return Math.abs(Math.atan2(det, dot));
}

/**
 * Bends a firing direction toward the best enemy inside the cone. `dirX/dirY`
 * must be a unit vector.
 */
export function assistAim(
  world: World, x: number, y: number, dirX: number, dirY: number,
  projectileSpeed = 600,
): Aimed {
  const cone = (ASSIST_CONE_DEG * Math.PI) / 180;
  let bestAngle = cone;
  let best: { x: number; y: number } | null = null;

  for (const e of world.enemies) {
    if (e.hp <= 0 || e.spawnFadeMs > 0) continue;
    // Lead the target. Bending toward where a body is, rather than where it
    // will be, leaves anything moving across the shot untouchable: the play
    // harness could not finish rooms whose last survivor was an orbiter.
    const flight = Math.hypot(e.x - x, e.y - y) / Math.max(1, projectileSpeed);
    const dx = e.x + e.vx * flight - x;
    const dy = e.y + e.vy * flight - y;
    const dist = Math.hypot(dx, dy);
    if (dist > ASSIST_RANGE || dist < 1) continue;
    const angle = angleBetween(dirX, dirY, dx / dist, dy / dist);
    // A wide body is easier to hit, so its cone is wider; without this a
    // tank is as hard to assist onto as a bullet-sized rusher.
    const widened = cone + Math.atan2(e.radius, dist);
    if (angle > widened || angle >= bestAngle) continue;
    bestAngle = angle;
    best = { x: dx / dist, y: dy / dist };
  }

  if (!best) return { x: dirX, y: dirY, assisted: false };
  const bx = dirX + (best.x - dirX) * ASSIST_STRENGTH;
  const by = dirY + (best.y - dirY) * ASSIST_STRENGTH;
  const len = Math.hypot(bx, by) || 1;
  return { x: bx / len, y: by / len, assisted: true };
}

/** Shortest signed angular difference, in radians. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Rotates `facing` toward `target` at a bounded rate. Never snaps. */
export function turnToward(
  facing: number, target: number, dtMs: number, rateScale = 1,
): number {
  const max = FACING_TURN_RATE * rateScale * (dtMs / 1000);
  const d = angleDelta(facing, target);
  if (Math.abs(d) <= max) return target;
  return facing + Math.sign(d) * max;
}
