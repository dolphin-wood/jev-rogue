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
import { TILE_PX } from "../types.ts";
import { hasLineOfSight } from "./collide.ts";

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
/** Added to a hidden body's score: more than any angle and distance can make. */
const HIDDEN_LAST = 100;

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
    /*
     * Angle first, distance as the tiebreaker, at about a degree per 40 px —
     * and a body the caster cannot see after every body it can. Ranked by
     * angle alone, one behind a pillar outranked one in the open beside it,
     * and a homing shot curved into the pillar; it still counts, last.
     */
    const hidden = !hasLineOfSight(world.room.grid, x, y, e.x, e.y);
    found.push({ id: e.id, x: e.x, y: e.y, score: angle + dist / 40 / 57.3 + (hidden ? HIDDEN_LAST : 0) });
  }
  found.sort((a, b) => a.score - b.score);
  return found.map(({ id, x: ex, y: ey }) => ({ id, x: ex, y: ey }));
}

/**
 * **The view, as the simulation can know it**: the 16 x 9 tiles the camera
 * shows (the game's `VIEW_TILES_W` / `VIEW_TILES_H`, restated because the
 * scene cannot be imported here), centred on the player and held inside the
 * room as the camera is, then drawn in by the camera's dead zone (34 x 20 px)
 * — the view's centre may sit that far from the player, so a body inside the
 * narrowed box is on screen wherever inside the dead zone it sits.
 */
const VIEW_HALF_W = (16 * TILE_PX) / 2;
const VIEW_HALF_H = (9 * TILE_PX) / 2;
const VIEW_SLACK_X = 34;
const VIEW_SLACK_Y = 20;

/**
 * **Every living body on screen**, best first, and no wall in the way: for a
 * spell that comes down from above anywhere the player can see (Meteor).
 *
 * The bodies inside the seek cone come first, **nearest first**; the rest
 * after them, by angle from `dir`. Ranked by angle alone, as `seekTargets`
 * ranks its cone, a degree of angle outweighed forty pixels of distance, so a
 * body at the far edge of the screen dead on the aim beat the one a few tiles
 * away just off it — and the rock went somewhere the player was not looking.
 * Inside the cone the player has already said "that way"; which one is then
 * the nearest.
 */
export function screenTargets(
  world: World, x: number, y: number, dirX: number, dirY: number,
): { id: number; x: number; y: number }[] {
  const cone = (SEEK_CONE_DEG * Math.PI) / 180;
  const roomW = world.room.extent.w * TILE_PX, roomH = world.room.extent.h * TILE_PX;
  const cx = VIEW_HALF_W * 2 >= roomW ? roomW / 2 : Math.max(VIEW_HALF_W, Math.min(roomW - VIEW_HALF_W, x));
  const cy = VIEW_HALF_H * 2 >= roomH ? roomH / 2 : Math.max(VIEW_HALF_H, Math.min(roomH - VIEW_HALF_H, y));
  const found: { id: number; x: number; y: number; score: number }[] = [];
  for (const e of world.enemies) {
    if (e.hp <= 0 || e.spawnFadeMs > 0) continue;
    if (Math.abs(e.x - cx) > VIEW_HALF_W - VIEW_SLACK_X || Math.abs(e.y - cy) > VIEW_HALF_H - VIEW_SLACK_Y) continue;
    const dx = e.x - x, dy = e.y - y, dist = Math.hypot(dx, dy);
    const angle = dist < 1 ? 0 : angleBetween(dirX, dirY, dx / dist, dy / dist);
    const inCone = angle <= cone;
    // In the cone: by distance, ahead of everything outside it (at most a screen's width, well under the offset).
    found.push({ id: e.id, x: e.x, y: e.y, score: inCone ? dist : OUTSIDE_CONE + angle + dist / 40 / 57.3 });
  }
  found.sort((a, b) => a.score - b.score);
  return found.map(({ id, x: ex, y: ey }) => ({ id, x: ex, y: ey }));
}

/** Put before every score outside the cone, so it outranks any distance on screen. */
const OUTSIDE_CONE = 1e6;

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
