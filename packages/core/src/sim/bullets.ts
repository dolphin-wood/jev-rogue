/**
 * Bullet pools and their integration (design docs 005 and 008).
 *
 * The two caps behave differently on purpose: an enemy volley that would
 * exceed 600 is skipped whole, because recycling the oldest enemy bullet
 * would erase a safe lane the player is already committed to; player bullets
 * recycle the oldest, because losing one costs damage, not a life.
 */
import { ENEMY_BULLET_CAP, PLAYER_BULLET_POOL, BULLET_LIFETIME_S } from "../encounters/enemies.ts";

const BULLET_LIFETIME_MS = BULLET_LIFETIME_S * 1000;
import type { Bullet } from "./types.ts";
import { circleHitsWall, clamp, WORLD_W, WORLD_H } from "./collide.ts";

export function makePool(size: number): Bullet[] {
  return Array.from({ length: size }, () => blankBullet());
}

function blankBullet(): Bullet {
  return {
    alive: false, x: 0, y: 0, vx: 0, vy: 0, radius: 4, damage: 0,
    affixes: [], spellIndex: -1, manaSpent: 0, weight: 1, arcLeft: 0,
    originX: 0, originY: 0, targetId: -1, seekDegPerS: 0,
    orbitMs: 0, orbitAngle: 0, orbitRadius: 0, orbitDegPerS: 0, rehitMs: 0,
    lifeMs: 0, pierce: 0, bounce: 0, homing: 0, split: 0,
    element: "none", elementPower: 0, payloadUnit: null,
    passthrough: false, hitIds: [],
    leavesFire: false, from: "",
  };
}

/** Oldest-first recycling for the player pool; null when an enemy volley must be skipped. */
export function acquire(pool: Bullet[], recycleOldest: boolean): Bullet | null {
  let oldest: Bullet | null = null;
  let oldestLife = Infinity;
  for (const b of pool) {
    if (!b.alive) {
      reset(b);
      return b;
    }
    if (b.lifeMs < oldestLife) {
      oldestLife = b.lifeMs;
      oldest = b;
    }
  }
  if (!recycleOldest || !oldest) return null;
  reset(oldest);
  return oldest;
}

function reset(b: Bullet): void {
  b.alive = true;
  b.lifeMs = BULLET_LIFETIME_MS;
  b.pierce = 0;
  b.bounce = 0;
  b.homing = 0;
  b.split = 0;
  b.element = "none";
  b.elementPower = 0;
  b.payloadUnit = null;
  b.passthrough = false;
  b.from = "";
  // Cleared, or a recycled slot keeps it: the pool is shared, so one thrown
  // flame would have made every later bullet out of that slot light the floor.
  b.leavesFire = false;
  b.hitIds.length = 0;
  // A recycled slot must not keep the last spell's affixes: a plain enemy
  // bullet reusing a `chain` bullet's slot would otherwise arc between bodies.
  b.affixes = [];
  b.spellIndex = -1;
  b.manaSpent = 0;
  b.weight = 1;
  b.arcLeft = 0;
  b.originX = b.x;
  b.originY = b.y;
  b.targetId = -1;
  b.seekDegPerS = 0;
  b.orbitMs = 0;
  b.orbitAngle = 0;
  b.orbitRadius = 0;
  b.orbitDegPerS = 0;
  b.rehitMs = 0;
}

export function liveCount(pool: readonly Bullet[]): number {
  let n = 0;
  for (const b of pool) if (b.alive) n++;
  return n;
}

export function hasRoom(pool: readonly Bullet[], needed: number): boolean {
  return liveCount(pool) + needed <= ENEMY_BULLET_CAP;
}

export interface IntegrateResult {
  /** Bullets that stopped this step, for payload triggers and particles. */
  readonly expired: Bullet[];
  readonly hitWall: Bullet[];
}

export function integrate(
  pool: Bullet[],
  grid: Uint8Array,
  dtMs: number,
  /**
   * Where a given shot is steering, if anywhere. Per bullet rather than one
   * target for the pool: see `Bullet.targetId`.
   */
  homingTarget?: ((b: Bullet) => { x: number; y: number } | null) | { x: number; y: number } | null,
): IntegrateResult {
  const expired: Bullet[] = [];
  const hitWall: Bullet[] = [];
  const dt = dtMs / 1000;

  for (const b of pool) {
    if (!b.alive) continue;

    /*
     * An orbiting shot is placed by the world each step, not integrated: it
     * goes where the player goes, through walls and bodies alike, and only
     * its clocks run here.
     */
    if (b.orbitMs > 0) {
      b.orbitMs -= dtMs;
      b.lifeMs -= dtMs;
      if (b.rehitMs > 0) b.rehitMs -= dtMs;
      if (b.orbitMs <= 0 || b.lifeMs <= 0) {
        b.alive = false;
        expired.push(b);
      }
      continue;
    }

    const seeking = b.homing > 0 || b.seekDegPerS > 0;
    const to = seeking
      ? (typeof homingTarget === "function" ? homingTarget(b) : homingTarget ?? null)
      : null;
    if (to) {
      const dx = to.x - b.x;
      const dy = to.y - b.y;
      const len = Math.hypot(dx, dy);
      if (len > 0.001) {
        const speed = Math.hypot(b.vx, b.vy);
        /*
         * Two steerings, one turn. `homing` is the seeker rune's soft pull, a
         * share of the remaining error per step; `seekDegPerS` is the spell's
         * own curve, a **bounded turn rate**, which is what keeps an arc an
         * arc: a shot that may turn ninety degrees a second traces a readable
         * curve into its target, where an unbounded correction snaps straight
         * at it and looks like a tracking bug.
         */
        const want = Math.atan2(dy / len, dx / len);
        const have = Math.atan2(b.vy, b.vx);
        let d = (want - have) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        const byRate = ((b.seekDegPerS * Math.PI) / 180) * dt;
        const byPull = Math.abs(d) * clamp(b.homing * dt * 6, 0, 1);
        const turn = Math.min(Math.abs(d), byRate + byPull);
        const a = have + Math.sign(d) * turn;
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
      }
    }

    const nx = b.x + b.vx * dt;
    const ny = b.y + b.vy * dt;

    if (circleHitsWall(grid, nx, ny, b.radius) || nx < 0 || ny < 0 || nx > WORLD_W || ny > WORLD_H) {
      if (b.bounce > 0) {
        // Reflect on whichever axis is actually blocked.
        if (circleHitsWall(grid, nx, b.y, b.radius) || nx < 0 || nx > WORLD_W) b.vx = -b.vx;
        if (circleHitsWall(grid, b.x, ny, b.radius) || ny < 0 || ny > WORLD_H) b.vy = -b.vy;
        b.bounce--;
      } else {
        b.alive = false;
        hitWall.push(b);
        continue;
      }
    } else {
      b.x = nx;
      b.y = ny;
    }

    b.lifeMs -= dtMs;
    if (b.lifeMs <= 0) {
      b.alive = false;
      expired.push(b);
    }
  }

  return { expired, hitWall };
}

export const POOL_SIZES = { player: PLAYER_BULLET_POOL, enemy: ENEMY_BULLET_CAP } as const;
