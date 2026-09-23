/**
 * Burning ground (design doc 005, the thrown-flame attack kind).
 *
 * The one attack kind that changes the terrain instead of threatening a spot.
 * Its whole value is duration: a lightning strike punishes being somewhere at
 * an instant and is then over, so the player steps out and back; a fire
 * **takes floor out of play while it burns**, which shrinks the arena and
 * forces the fight into less of it.
 *
 * That matters most for a melee player, and deliberately so. Doc 001 permits
 * an encounter to pressure a build as long as it never nullifies it, and this
 * is the tool that pressures a player who has to close.
 */
import type { Fire, Scorch, World } from "./types.ts";
import { circlesOverlap } from "./collide.ts";
import { TILE_PX } from "../types.ts";

/** How many patches may burn at once, so a room cannot be carpeted. */
export const FIRE_POOL = 24;
export const FIRE_LIFETIME_MS = 3200;
export const FIRE_RADIUS = TILE_PX * 0.85;
/**
 * Damage cadence. Slower than the bullet contact rate on purpose: standing in
 * fire should cost the player a heart for lingering, not for touching.
 */
export const FIRE_TICK_MS = 520;
/** What a tick does to an enemy, against 1 heart to the player. */
export const FIRE_ENEMY_DAMAGE = 4;

/**
 * Marks outlive the thing that made them by several seconds, which is long
 * enough to read as a consequence and short enough that a busy room does not
 * end up paved with them.
 */
/**
 * Also a cap on how many marks can exist, not only a pool size. Overlapping
 * marks are what turned the floor into a stain, so the oldest is recycled
 * rather than a new one being added beside it.
 */
export const SCORCH_POOL = 8;
/**
 * Shortened from 9000 ms, but still several times the fire that made it: a
 * mark whose whole point is that the floor remembers cannot expire with the
 * thing it is remembering.
 *
 * Permanence is worth having at a *rate*. Nine-second marks against a strike
 * every few seconds meant three or four were always on the floor, overlapping
 * into pale patches — which broke the rule the decal exists under, that a
 * floor mark has to be ignorable at a glance. What actually fixed that was
 * merging marks that land on the same ground (see `scorch`) and drawing them
 * at a third of the opacity; the lifetime only needed trimming.
 */
export const SCORCH_LIFETIME_MS = 7000;

export function makeScorchPool(): Scorch[] {
  return Array.from({ length: SCORCH_POOL }, () => ({
    alive: false, x: 0, y: 0, radius: FIRE_RADIUS, lifeMs: 0, maxLifeMs: SCORCH_LIFETIME_MS,
  }));
}

/** Leaves a mark, reusing the faintest slot when the pool is full. */
export function scorch(w: World, x: number, y: number, radius: number): void {
  /*
   * A mark already covering this spot is refreshed rather than joined.
   *
   * Two marks on the same ground are what a stain is: each is faint enough to
   * ignore and the pair is not, and a turret striking the same area repeatedly
   * built them up until the floor looked soiled rather than scarred.
   */
  const near = w.scorches.find(
    (sc) => sc.alive && Math.hypot(sc.x - x, sc.y - y) < Math.max(sc.radius, radius) * 0.7,
  );
  const slot = near
    ?? w.scorches.find((sc) => !sc.alive)
    ?? w.scorches.reduce((a, b) => (a.lifeMs <= b.lifeMs ? a : b));
  slot.alive = true;
  slot.x = x;
  slot.y = y;
  slot.radius = radius;
  slot.lifeMs = SCORCH_LIFETIME_MS;
  slot.maxLifeMs = SCORCH_LIFETIME_MS;
}

export function stepScorches(w: World, dtMs: number): void {
  for (const s of w.scorches) {
    if (!s.alive) continue;
    s.lifeMs -= dtMs;
    if (s.lifeMs <= 0) s.alive = false;
  }
}

/** How faded a mark is, for the renderer. */
export function scorchProgress(s: Scorch): number {
  return 1 - s.lifeMs / Math.max(1, s.maxLifeMs);
}

export function makeFirePool(): Fire[] {
  return Array.from({ length: FIRE_POOL }, () => ({
    alive: false, x: 0, y: 0, radius: FIRE_RADIUS,
    lifeMs: 0, maxLifeMs: FIRE_LIFETIME_MS, tickMs: 0, damage: 1, owner: "enemy" as const,
  }));
}

/**
 * Lights a patch, reusing the oldest slot when the pool is full.
 *
 * Reusing the oldest rather than refusing is what keeps the cap from turning
 * into a way to disable the attack: an enemy that has thrown its share simply
 * replaces its own earliest patch.
 */
export function lightFire(
  w: World, x: number, y: number, owner: "player" | "enemy" = "enemy",
  /** A spell's field is sized and costed by the spell; an enemy's is the default. */
  shape: { radius?: number; lifeMs?: number; damage?: number } = {},
): Fire {
  let slot = w.fires.find((f) => !f.alive);
  if (!slot) {
    slot = w.fires.reduce((a, b) => (a.lifeMs <= b.lifeMs ? a : b));
  }
  slot.alive = true;
  slot.x = x;
  slot.y = y;
  slot.radius = shape.radius ?? FIRE_RADIUS;
  slot.lifeMs = shape.lifeMs ?? FIRE_LIFETIME_MS;
  slot.maxLifeMs = slot.lifeMs;
  slot.tickMs = 0;
  // Per tick, on a body standing in it. An enemy's fire is a heart-scale
  // hazard and uses `FIRE_ENEMY_DAMAGE`; a player's field carries the spell's.
  slot.damage = shape.damage ?? 1;
  slot.owner = owner;
  return slot;
}

/** How far through its life a patch is, for the renderer to fade it out. */
export function fireProgress(f: Fire): number {
  return 1 - f.lifeMs / Math.max(1, f.maxLifeMs);
}

/**
 * Ages every patch and reports who is standing in one.
 *
 * Returns the enemies to damage and whether the player is in fire, rather than
 * applying damage itself, because the player's invulnerability and the enemy
 * death path both belong to the world module.
 */
export function stepFires(
  w: World, dtMs: number,
): { enemies: { id: number; damage: number }[]; playerBurning: boolean } {
  const enemies: { id: number; damage: number }[] = [];
  let playerBurning = false;

  for (const f of w.fires) {
    if (!f.alive) continue;
    f.lifeMs -= dtMs;
    if (f.lifeMs <= 0) {
      f.alive = false;
      // The floor remembers where it burned.
      scorch(w, f.x, f.y, f.radius);
      continue;
    }
    // The player's exposure is read **every step**, because it feeds a gauge
    // that fills by the second; the enemies' damage stays on the tick.
    if (f.owner !== "player" && circlesOverlap(f.x, f.y, f.radius, w.player.x, w.player.y, 0)) playerBurning = true;

    f.tickMs -= dtMs;
    if (f.tickMs > 0) continue;
    f.tickMs = FIRE_TICK_MS;

    for (const e of w.enemies) {
      if (e.hp <= 0 || e.spawnFadeMs > 0) continue;
      if (circlesOverlap(f.x, f.y, f.radius, e.x, e.y, e.radius))
        enemies.push({ id: e.id, damage: f.owner === "player" ? f.damage : FIRE_ENEMY_DAMAGE });
    }
  }
  return { enemies, playerBurning };
}
