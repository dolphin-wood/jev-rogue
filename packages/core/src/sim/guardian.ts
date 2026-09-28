/**
 * **The Drowned Warden**: room 10's guardian (doc 024).
 *
 * The warden's body with a guardian's state: its armour, its blunderbuss and
 * its shield shove, and the tank's ram (`chooseMelee`). A head-on wall knocks
 * it out and breaks its armour (`guardianWallSlam`). It has no phases: an
 * elite's fight is one fight. What it has beyond a warden is **the call**: it
 * raises its arm and the room's dead answer, a squad round it and its plate
 * back on. The first call is its entrance, and it calls again whenever its
 * squad is down to one and the call has come round. It is not a new
 * archetype, so the warden's frames, death and renderer all hold; nothing
 * assembles it into an ordinary room.
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
/** Armour it opens with and grows back with each call: until it breaks, nothing interrupts it. */
export const GUARDIAN_ARMOUR = 60;
/** How much larger it is than a warden, drawn and in body: not necessarily a whole number (doc 024). */
export const GUARDIAN_SCALE = 2;
/** What its death pays in experience: an ordinary room's take, at its top (`KING_AUDIENCE_XP`'s reasoning). */
export const GUARDIAN_XP = 110;
/** The squad a later call brings: bodies the player has known since the opening rooms. */
export const GUARDIAN_SQUAD: readonly EnemyId[] = ["rusher", "shooter", "rusher"];
/** The most bodies its entrance brings, whatever the room's wave held. */
export const GUARDIAN_ENTRANCE_MAX = 4;
/** How long it holds its arm up before the dead answer: the call's telegraph, and the player's window. */
export const GUARDIAN_CALL_MS = 1100;
/** How soon after the room opens it makes its entrance call: the player through the door and looking. */
export const GUARDIAN_ENTRANCE_MS = 500;
/** How long after one call before it may call again. */
export const GUARDIAN_CALL_EVERY_MS = 16_000;
/** It calls again only when its squad is down to this many. */
export const GUARDIAN_CALL_BELOW = 1;

export interface GuardianState {
  /** Time until it may call; it calls once this is out and its squad is thin. */
  callMs: number;
  /** Whether its arm is up in a call, to see the call end. */
  calling: boolean;
  /** Who the call now being made brings: the room's own wave at the entrance, the squad after. */
  answer: EnemyId[];
  /** Where they rise, fixed as the arm goes up and marked on the floor through the call. */
  spots: { x: number; y: number }[];
}

/** The guardian, standing where it is put, on its own bar, with its entrance call to make. */
export function makeGuardian(id: number, x: number, y: number, _roomIndex: number, entrance: readonly EnemyId[] = GUARDIAN_SQUAD): Enemy {
  const e = makeEnemy(id, "warden", x, y, [], { power: GUARDIAN_POWER });
  e.guardian = { callMs: GUARDIAN_ENTRANCE_MS, calling: false, answer: entrance.slice(0, GUARDIAN_ENTRANCE_MAX), spots: [] };
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

/** Its squad still standing: the bodies its calls brought. */
export function guardianSquad(w: World, e: Enemy): number {
  return w.enemies.filter((o) => o !== e && o.hp > 0 && !o.gone).length;
}

/**
 * One step of what the guardian is beyond a warden: **the call**. With the
 * call come round, its squad thin and nothing else in hand, it plants and
 * raises its arm (`guardian_call`, a planted pose) with the marks of what is
 * coming on the floor; when the arm comes down they rise, and its plate is
 * back on. Its movement, shots and blows are the warden's.
 */
export function stepGuardian(w: World, e: Enemy, dtMs: number): void {
  const g = e.guardian;
  if (!g || e.hp <= 0) return;
  if (g.calling) {
    if (e.pose === "guardian_call") return;
    g.calling = false;
    answer(w, e, g.answer, g.spots);
    g.answer = [...GUARDIAN_SQUAD];
    g.spots = [];
    g.callMs = GUARDIAN_CALL_EVERY_MS;
    return;
  }
  if (g.callMs > 0) g.callMs -= dtMs;
  if (g.callMs > 0 || e.attack !== "approach" || e.pose !== "" || e.staggerMs > 0) return;
  if (guardianSquad(w, e) > GUARDIAN_CALL_BELOW) return;
  g.calling = true;
  g.spots = bossSummonSpots(w, e, g.answer.length);
  e.pose = "guardian_call";
  e.poseMs = GUARDIAN_CALL_MS;
  w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "guardian_call" });
}

/** The dead answer: the bodies rise round it, and its plate grows back. */
function answer(w: World, e: Enemy, who: readonly EnemyId[], spots: readonly { x: number; y: number }[]): void {
  if (e.armour < e.maxArmour) {
    e.armour = e.maxArmour;
    w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: "guardian_rearm" });
  }
  w.trauma = Math.min(1, w.trauma + 0.3);
  spots.forEach((s, i) => {
    const add = makeEnemy(w.nextEnemyId++, who[i]!, s.x, s.y, [], rampFor(w.roomIndex));
    add.awake = true;
    add.summoned = true;
    w.enemies.push(add);
    w.events.push({ kind: "hazard_tick", x: s.x, y: s.y, what: "boss_summon" });
  });
}

/** Whether this body's next blow is the ram rather than the shove: the ram from range, the shove on top of it. */
export function guardianMelee(e: Enemy): "charge" | "bash" {
  return e.closeIn ? "bash" : "charge";
}
