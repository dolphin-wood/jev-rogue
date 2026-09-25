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
import { clearPowers, noPowers } from "../content/tags.ts";
import type { ElementPowers } from "../types.ts";
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
/**
 * How often burning ground bills what stands in it, and how much.
 *
 * **Standing in a hazard is a slow, small toll; the status it builds is the
 * fast one** (doc 005). The two were the same speed and the ground was the
 * larger of them, which is why a field spell that drops one patch a cast was
 * measured at six times the pool's median against a pack: overlapping patches
 * each billed four damage twice a second, and the burn they lit billed again
 * on top. The ground now asks once a second for one point, and the burn it
 * lights ticks four times a second — so a field's value is the fire it
 * *starts*, which is what a fire spell should be.
 */
export const FIRE_TICK_MS = 1000;
/** What a tick does to an enemy, against 1 heart to the player. */
export const FIRE_ENEMY_DAMAGE = 1;
/**
 * What one tick of the player's ground puts into the gauge of its element, as
 * a share of a hit's (`applyElementTo` in `world.ts`): burning ground into the
 * burn, a poison cloud into the poison. At 1.4 the gauge fills on the second
 * tick, so a body that stays in the player's ground catches in about two
 * seconds. The ground does its element by its nature, so this — not the
 * spell's `element_power` — is what a field or a trail builds with, and
 * what its card forecasts (`statusForecast`).
 */
export const GROUND_STATUS_POWER = 1.4;
/**
 * **A poison cloud bills twice as often as burning ground.** Fire is a toll
 * that lights a fast burn — the burn is where fire's damage lives, and it
 * ticks four times a second on its own. Poison has no such second clock: a
 * poisoned body goes deeper one stack a hit, so a cloud at the ground's once
 * a second took five seconds to reach the depth a spit reaches in two, and
 * a spell whose damage is its poison measured as the weakest key in the
 * pool. A cloud is breathed rather than stood on, and it asks twice a second.
 */
export const CLOUD_TICK_MS = 500;

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
    lifeMs: 0, maxLifeMs: FIRE_LIFETIME_MS, tickMs: 0, damage: 1, powers: noPowers(), proc: 1, statusMult: 1,
    owner: "enemy" as const, element: "fire" as const, fromGrass: false,
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
  shape: GroundShape = {},
): Fire {
  const slot = w.fires.find((f) => !f.alive) ?? w.fires.reduce((a, b) => (a.lifeMs <= b.lifeMs ? a : b));
  return fillPatch(slot, x, y, owner, shape);
}

/** What a patch is made of, where the caller says; see `lightFire`. */
export interface GroundShape {
  radius?: number; lifeMs?: number; damage?: number; statusMult?: number; powers?: ElementPowers; proc?: number;
  /** What the ground does; see `Fire.element`. Fire unless a spell says otherwise. */
  element?: "fire" | "poison";
}

/**
 * **A trail's patch** (doc 006): lit as `lightFire` lights one, except where
 * the pool is full. There the everyday rule — reuse whichever patch has
 * least left — would let the caster walk the room's fire out: a trail drops
 * a patch every few steps, and laid across a warden's flames it would put
 * them out one step at a time. So at the cap (`FIRE_POOL`, shared with every
 * enemy's fire) **a trail eats its own tail**: the player's own spell patch
 * nearest to going out is the one relit here. And where the pool holds none
 * of the player's — all enemy fire and burning grass — the step drops
 * nothing, and the trail has a gap there rather than taking someone else's
 * ground. Returns null for that gap.
 */
export function lightOwnPatch(w: World, x: number, y: number, shape: GroundShape): Fire | null {
  let slot = w.fires.find((f) => !f.alive) ?? null;
  if (!slot)
    for (const f of w.fires)
      if (f.owner === "player" && !f.fromGrass && (!slot || f.lifeMs < slot.lifeMs)) slot = f;
  return slot ? fillPatch(slot, x, y, "player", shape) : null;
}

function fillPatch(slot: Fire, x: number, y: number, owner: "player" | "enemy", shape: GroundShape): Fire {
  slot.alive = true;
  slot.element = shape.element ?? "fire";
  slot.element = shape.element ?? "fire";
  slot.fromGrass = false;
  slot.x = x;
  slot.y = y;
  slot.radius = shape.radius ?? FIRE_RADIUS;
  slot.lifeMs = shape.lifeMs ?? FIRE_LIFETIME_MS;
  slot.maxLifeMs = slot.lifeMs;
  slot.tickMs = 0;
  // Per tick, on a body standing in it. An enemy's fire is a heart-scale
  // hazard and uses `FIRE_ENEMY_DAMAGE`; a player's field carries the spell's.
  slot.damage = shape.damage ?? 1;
  // How hard the build that lit it burns what stands in it; see `Enemy.statusMult`.
  slot.statusMult = shape.statusMult ?? 1;
  slot.proc = shape.proc ?? 1;
  /*
   * **What else the patch carries.** Burning ground burns by its nature; a
   * field cast by a spell that also holds `rime` or `blight` chills or
   * poisons what stands in it too, because the card said it would.
   */
  clearPowers(slot.powers);
  if (shape.powers) {
    slot.powers.fire = shape.powers.fire;
    slot.powers.poison = shape.powers.poison;
    slot.powers.ice = shape.powers.ice;
  }
  slot.owner = owner;
  return slot;
}

/** How far through its life a patch is, for the renderer to fade it out. */
export function fireProgress(f: Fire): number {
  return 1 - f.lifeMs / Math.max(1, f.maxLifeMs);
}

/** One patch's bill against one body, for the world module to apply. */
export interface FireToll {
  id: number;
  damage: number;
  owner: "player" | "enemy";
  statusMult: number;
  /** What a patch's tick is worth to on-hit effects; see `Bullet.proc`. */
  proc: number;
  /** Anything the patch carries besides its own fire; see `lightFire`. */
  powers: ElementPowers;
  /** Whether the patch burns or poisons; see `Fire.element`. */
  element: "fire" | "poison";
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
): { enemies: FireToll[]; playerBurning: boolean } {
  const enemies: FireToll[] = [];
  let playerBurning = false;

  for (const f of w.fires) {
    if (!f.alive) continue;
    f.lifeMs -= dtMs;
    if (f.lifeMs <= 0) {
      f.alive = false;
      // The floor remembers where it burned. A cloud of poison burned nothing.
      if (f.element === "fire") scorch(w, f.x, f.y, f.radius);
      continue;
    }
    // The player's exposure is read **every step**, because it feeds a gauge
    // that fills by the second; the enemies' damage stays on the tick. A
    // grass fire burns whoever stands in it, the player who lit it too,
    // whatever lit it: burning grass is the room's, not the caster's.
    const burnsPlayer = f.owner !== "player" || f.fromGrass;
    if (burnsPlayer && circlesOverlap(f.x, f.y, f.radius, w.player.x, w.player.y, 0)) playerBurning = true;

    f.tickMs -= dtMs;
    if (f.tickMs > 0) continue;
    f.tickMs = f.element === "poison" ? CLOUD_TICK_MS : FIRE_TICK_MS;

    for (const e of w.enemies) {
      if (e.hp <= 0 || e.spawnFadeMs > 0) continue;
      if (circlesOverlap(f.x, f.y, f.radius, e.x, e.y, e.radius))
        enemies.push({
          id: e.id, damage: f.owner === "player" ? f.damage : FIRE_ENEMY_DAMAGE,
          owner: f.owner, statusMult: f.statusMult, powers: f.powers, proc: f.proc, element: f.element,
        });
    }
  }
  return { enemies, playerBurning };
}
