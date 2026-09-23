/**
 * Things that fall out of what the player breaks.
 *
 * A kill that produces nothing is a kill the player has no reason to seek out
 * except that the door is locked until the room is empty — so the fight is a
 * toll rather than a choice. A drop is what makes each body worth going to,
 * and it is also the loop that connects the two halves of the run: hearts pay
 * for the next room, gold pays the merchant before the boss.
 *
 * Two kinds, because there are two drawn: a coin and a heart. They behave
 * identically as objects and differ only in what taking one does, which is why
 * this module is small — `kind` is a tag, not a hierarchy.
 *
 * ### They are thrown, not placed
 *
 * A drop appears with an outward velocity and settles, which does three things
 * a static drop cannot: it separates two drops from the same body so they can
 * be told apart and picked up individually, it points away from where the kill
 * happened so the player's eye follows it, and it means a body killed against
 * a wall does not bury its own reward inside the wall.
 */
import { TILE_PX } from "../types.ts";
import type { Rng } from "../rng.ts";

/**
 * `mana` is what every kill pays: a few orbs that refund the spells, so a
 * kill is fuel for the next one rather than only a body fewer.
 */
export type PickupKind = "coin" | "heart" | "mana";

export interface Pickup {
  alive: boolean;
  kind: PickupKind;
  x: number;
  y: number;
  /** Outward throw, decaying, so drops scatter and settle. */
  vx: number;
  vy: number;
  /** Counts down; a drop that is never collected expires. */
  lifeMs: number;
  /**
   * Counts up. A drop cannot be collected for the first moment of its life,
   * so the one that lands on the player is still *seen* to land rather than
   * vanishing into the same frame that spawned it.
   */
  ageMs: number;
}

export const PICKUP_POOL = 64;
export const PICKUP_LIFETIME_MS = 14_000;
/** Long enough to read the drop, short enough not to be a chore. */
const PICKUP_ARM_MS = 220;
export const PICKUP_RADIUS = TILE_PX * 0.32;
/**
 * The radius at which a drop is taken, which is generously larger than the
 * drawing. Walking over a reward and not getting it is the most annoying way
 * for a pickup to work, and nothing is lost by being forgiving: the player has
 * already earned it.
 */
export const PICKUP_MAGNET = TILE_PX * 0.85;
/**
 * From how far a drop **flies to the player**, and how fast it starts.
 *
 * Collection was a touch radius, so a room's coins had to be walked over one
 * by one after the fight — a chore the fight did not earn. Inside the pull
 * radius a drop accelerates toward the player, faster the closer it is, and
 * is taken at the touch radius as before. Hearts and coins alike: whatever
 * dropped is the player's.
 */
export const PICKUP_PULL = TILE_PX * 3.2;
export const PICKUP_PULL_ACCEL = 900;
export const PICKUP_PULL_MAX = 420;
/** How fast a cleared room's coins fly home. */
export const VACUUM_SPEED = 480;

/** How much one coin is worth. */
export const COIN_VALUE = 3;
/** Mana one orb returns. */
export const MANA_ORB = 5;

export function makePickupPool(): Pickup[] {
  return Array.from({ length: PICKUP_POOL }, () => ({
    alive: false, kind: "coin" as PickupKind, x: 0, y: 0,
    vx: 0, vy: 0, lifeMs: 0, ageMs: 0,
  }));
}

/** Throws a drop from `x, y`, reusing the oldest slot when the pool is full. */
export function drop(
  pool: Pickup[], kind: PickupKind, x: number, y: number, rng: Rng,
): Pickup {
  const slot = pool.find((p) => !p.alive)
    ?? pool.reduce((a, b) => (a.lifeMs <= b.lifeMs ? a : b));
  const a = rng.next() * Math.PI * 2;
  const speed = 55 + rng.next() * 50;
  slot.alive = true;
  slot.kind = kind;
  slot.x = x;
  slot.y = y;
  slot.vx = Math.cos(a) * speed;
  slot.vy = Math.sin(a) * speed;
  slot.lifeMs = PICKUP_LIFETIME_MS;
  slot.ageMs = 0;
  return slot;
}

/** Whether this drop may be taken yet. */
export function pickupArmed(p: Pickup): boolean {
  return p.ageMs >= PICKUP_ARM_MS;
}

/** True once a drop is nearly expired, so the renderer can flash it out. */
export function pickupFading(p: Pickup): boolean {
  return p.lifeMs < 2500;
}

/**
 * Advances every drop and returns the ones the player has collected.
 *
 * Movement is integrated here rather than in the world step because a drop's
 * only interaction with the room is the wall test the caller supplies — it
 * does not collide with bodies, and a reward that could be kicked around by a
 * fight would be a reward the player cannot plan to take.
 */
export function stepPickups(
  pool: Pickup[],
  dtMs: number,
  player: { x: number; y: number },
  blocked: (x: number, y: number, r: number) => boolean,
  /**
   * The room is clear: every coin flies to the player from wherever it lies,
   * through walls, so a cleared room is never a walk round its corners to
   * pick up the pay.
   */
  vacuum = false,
): Pickup[] {
  const taken: Pickup[] = [];
  const dt = dtMs / 1000;
  for (const p of pool) {
    if (!p.alive) continue;
    p.ageMs += dtMs;
    p.lifeMs -= dtMs;
    if (p.lifeMs <= 0) {
      p.alive = false;
      continue;
    }
    if (p.vx !== 0 || p.vy !== 0) {
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      if (!blocked(nx, ny, PICKUP_RADIUS)) {
        p.x = nx;
        p.y = ny;
      } else {
        p.vx = 0;
        p.vy = 0;
      }
      p.vx *= 0.86;
      p.vy *= 0.86;
      if (Math.abs(p.vx) < 2) p.vx = 0;
      if (Math.abs(p.vy) < 2) p.vy = 0;
    }
    if (!pickupArmed(p)) continue;
    const dx = player.x - p.x;
    const dy = player.y - p.y;
    const d = Math.hypot(dx, dy);
    if (vacuum && p.kind === "coin" && d > PICKUP_MAGNET) {
      const step = Math.min(d, VACUUM_SPEED * dt);
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
      p.vx = 0;
      p.vy = 0;
      continue;
    }
    if (d <= PICKUP_MAGNET) {
      p.alive = false;
      taken.push(p);
      continue;
    }
    if (d <= PICKUP_PULL) {
      // Flying to the hand, through anything: a coin has no business being
      // stopped by a pot, and the pull is short enough that a wall never
      // stands between a drop and the player who is this close.
      const pull = PICKUP_PULL_ACCEL * (1.2 - d / PICKUP_PULL) * dt;
      const speed = Math.min(PICKUP_PULL_MAX, Math.hypot(p.vx, p.vy) / 0.86 + pull);
      // Velocity only: the throw branch above moves it next step, so a drop
      // is moved once per step whichever branch owns it.
      p.vx = (dx / d) * speed;
      p.vy = (dy / d) * speed;
    }
  }
  return taken;
}
