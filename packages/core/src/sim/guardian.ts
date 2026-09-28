/**
 * **The Drowned Warden**: room 10's guardian (doc 024).
 *
 * The warden's body with a guardian's state: its armour, its blunderbuss and
 * its shield shove, and the tank's ram (`chooseMelee`). A head-on wall knocks
 * it out and breaks its armour (`guardianWallSlam`). Three phases on its own
 * bar: at 60% the armour grows back and a squad comes, and from then on a wall
 * slam throws a ring of broken floor; at 30% it rams twice and fires twice. It
 * is not a new archetype, so the warden's frames, death and renderer all hold;
 * nothing assembles it into an ordinary room.
 */
import { makeEnemy } from "./enemy.ts";
import type { Enemy, World } from "./types.ts";
import type { EnemyId } from "../types.ts";
import { rampFor } from "../encounters/ramp.ts";
import { ENEMIES } from "../encounters/enemies.ts";
import { bossSummonSpots } from "./world.ts";

/** Its bar. Sized for a room-10 build to take 40 to 60 s; `pnpm play` sets it (doc 024). */
export const GUARDIAN_HP = 1300;
/**
 * What its blows and shots cost, as a multiple of a warden's. Not the room's
 * ramp band (×1.45 at room 10): on a body that rams and sprays from across the
 * room that measured at five and a half hearts a fight, and nearly every run
 * ended here.
 */
export const GUARDIAN_POWER = 0.5;
/**
 * What one hit of its spray costs, in hearts: a warden's shot is a whole heart
 * and a burn, and it was the larger half of what the guardian cost a weaker
 * player — the burn stays, the heart does not.
 */
export const GUARDIAN_FLAME = 0.6;
/**
 * Its blunderbuss's period, as a multiple of a warden's 4.2 s. A warden's shot
 * is its whole threat; the guardian's is half of it, with the ram the other
 * half, and at a warden's pace the spray alone cost about four hearts a fight.
 */
export const GUARDIAN_SHOT_EVERY = 2;
/** Armour it opens with and grows back at phase II: until it breaks, nothing interrupts it. */
export const GUARDIAN_ARMOUR = 60;
/** How much larger it is than a warden, drawn and in body: not necessarily a whole number (doc 024). */
export const GUARDIAN_SCALE = 2;
/** Where its phases begin, as a share of its bar. */
export const GUARDIAN_PHASES: readonly number[] = [0.6, 0.3];
/** What its death pays in experience: an ordinary room's take, at its top (`KING_AUDIENCE_XP`'s reasoning). */
export const GUARDIAN_XP = 110;
/** The squad that comes at phase II: bodies the player has known since the opening rooms. */
export const GUARDIAN_SQUAD: readonly EnemyId[] = ["rusher", "shooter", "rusher"];
/** In phase III the second ram comes this soon off the first's recovery. */
const GUARDIAN_CHAIN_REST_MS = 260;

export interface GuardianState {
  /** Rams run back to back so far in phase III (0 or 1): the second comes off the first's recovery. */
  chained: number;
  /** Whether it was in a charge last step, to see the one that just ended. */
  wasCharging: boolean;
}

/** The guardian, standing where it is put, on the room's ramp for damage and its own bar. */
export function makeGuardian(id: number, x: number, y: number, roomIndex: number): Enemy {
  const e = makeEnemy(id, "warden", x, y, [], { power: GUARDIAN_POWER });
  e.guardian = { chained: 0, wasCharging: false };
  e.hp = e.maxHp = GUARDIAN_HP;
  e.armour = e.maxArmour = GUARDIAN_ARMOUR;
  e.radius = Math.round(e.radius * GUARDIAN_SCALE);
  /*
   * The tank's pace, so its ram is the tank's ram: a charge runs at seven
   * times the body's walk, and at the warden's 46 that is 322 px/s, faster
   * than the player can run from — a ram answered only by the dash.
   */
  e.speed = ENEMIES.tank.speed;
  e.phase = 1;
  e.awake = true;
  return e;
}

/** Its phase at this share of its bar. */
export function guardianPhaseAt(hpFraction: number): number {
  let phase = 1;
  GUARDIAN_PHASES.forEach((at, i) => { if (hpFraction <= at) phase = i + 2; });
  return phase;
}

/**
 * One step of what the guardian is beyond a warden: its phase changes, and the
 * second ram of phase III. Its movement, shots and blows are the warden's.
 */
export function stepGuardian(w: World, e: Enemy): void {
  const g = e.guardian;
  if (!g || e.hp <= 0) return;
  const next = guardianPhaseAt(e.hp / Math.max(1, e.maxHp));
  if (next > e.phase) {
    e.phase = next;
    w.trauma = Math.min(1, w.trauma + 0.5);
    w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: `guardian_phase:${next}` });
    if (next === 2) {
      // The plate grows back, and a squad comes.
      e.armour = e.maxArmour;
      w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: "guardian_rearm" });
      bossSummonSpots(w, e, GUARDIAN_SQUAD.length).forEach((s, i) => {
        const add = makeEnemy(w.nextEnemyId++, GUARDIAN_SQUAD[i]!, s.x, s.y, [], rampFor(w.roomIndex));
        add.awake = true;
        add.summoned = true;
        w.enemies.push(add);
        w.events.push({ kind: "hazard_tick", x: s.x, y: s.y, what: "boss_summon" });
      });
    }
  }
  const charging = e.attack !== "approach" && e.meleeKind === "charge";
  if (g.wasCharging && !charging) {
    // Phase III: the ram comes again off the first's recovery, once.
    if (e.phase >= 3 && g.chained === 0 && e.staggerMs <= 0) {
      g.chained = 1;
      e.attackCooldownMs = Math.min(e.attackCooldownMs, GUARDIAN_CHAIN_REST_MS);
    } else g.chained = 0;
  }
  g.wasCharging = charging;
}

/** Whether this body's next blow is the ram rather than the shove: the ram from range, the shove on top of it. */
export function guardianMelee(e: Enemy): "charge" | "bash" {
  return e.closeIn ? "bash" : "charge";
}
