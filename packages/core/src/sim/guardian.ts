/**
 * **The Frontier Veteran**: room 10's guardian (doc 024).
 *
 * The warden's body with a guardian's state: a heavy body's poise, its
 * blunderbuss and its shield shove, and the tank's ram (`chooseMelee`). A
 * head-on wall knocks it out (`guardianWallSlam`). It has no phases: an
 * elite's fight is one fight. What it has beyond a warden is **the call**: it
 * raises its arm and the room's dead answer, a squad round it; nothing breaks
 * it while its arm is up. The first call is its entrance, and it calls again whenever its
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
import { castRift, lineToWall } from "./attacks.ts";
import { eruptRing } from "./cast.ts";
import { noPowers } from "../content/tags.ts";
import { GRID_W, TILE_PX, Tile } from "../types.ts";

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
/**
 * Its poise (`Enemy.poise`): about four sword hits in a row at room 10 before
 * one interrupts it, and none while it is still guarded after the last break.
 * It cannot be held down; it can be broken by a burst, or knocked out on a wall.
 */
export const GUARDIAN_POISE = 60;
/** How much larger it is than a warden, drawn and in body: not necessarily a whole number (doc 024). */
export const GUARDIAN_SCALE = 2;
/** What its death pays in experience: an ordinary room's take, at its top (`KING_AUDIENCE_XP`'s reasoning). */
export const GUARDIAN_XP = 110;
/**
 * Hearts its death leaves, flying to the player: the heal after the fight
 * (doc 024). It is the run's second-hardest room, and the rooms after it are
 * the last stretch before the throne; the first audience needs none, since
 * its spare hearts come home when he leaves.
 */
export const GUARDIAN_HEARTS = 2;
/** The squad a later call brings: bodies the player has known since the opening rooms. */
export const GUARDIAN_SQUAD: readonly EnemyId[] = ["rusher", "shooter"];
/** The most bodies its entrance brings, whatever the room's wave held. */
export const GUARDIAN_ENTRANCE_MAX = 4;
/** How long it holds its arm up before the dead answer: the call's telegraph, and the player's window. */
export const GUARDIAN_CALL_MS = 1100;
/** How soon after the room opens it makes its entrance call: the player through the door and looking. */
export const GUARDIAN_ENTRANCE_MS = 500;
/** How long after one call before it may call again. */
export const GUARDIAN_CALL_EVERY_MS = 20_000;
/**
 * **Its stakes** (地刺): the old soldier's other move, the frontier's own —
 * the gun's butt driven into the floor and the ground answering in stakes.
 * Both are rifts, the roster's one "this ground erupts" (`castRift`), so the
 * warning is the one the player has read since the rifter: the lanes or the
 * ring drawn on the floor, then the stakes. It stands planted for all of it.
 *
 * - **The stake line**, at range: three lanes fanned at the player.
 * - **The palisade**, on a player who has stuck to it: rings of stakes
 *   breaking out round it one after another — the player's Quake Ring in its
 *   hands, larger and violet (`eruptRing`, a hostile cast) — so that standing
 *   in its shadow is not the answer to its poise.
 */
export const GUARDIAN_STAKES_EVERY_MS = 6500;
/** How long the stakes' ground is drawn before it erupts. */
export const GUARDIAN_STAKES_TELE_MS = 850;
/** How long it stands planted after they go up: the stakes' own window. */
const GUARDIAN_STAKES_REST_MS = 450;
/** The stake line's lanes, their spread either side of the player, and their reach. */
const STAKE_LANES = 3;
const STAKE_SPREAD = 0.4;
const STAKE_REACH = TILE_PX * 9;
/** Nearer than this the player is "stuck to it", and it throws the palisade instead. */
const PALISADE_NEAR = TILE_PX * 3;
/** The palisade: rings, the gap between them, and the beat between one ring and the next. */
const PALISADE_RINGS = 3;
const PALISADE_STEP = TILE_PX * 1.1;
const PALISADE_RING_MS = 150;
/** Each stake's size, a Quake Ring cell's and a half. */
const PALISADE_CELL = 20;
/**
 * **The volley** (排枪): the commander's own move. Its arm goes up and the
 * drowned line fires across the room out of its walls: lines from one side
 * of the room to the other at any angle, through whatever stands in the
 * room, each run out from its wall in a flash, then held for the player to
 * read, then a bolt of light down the whole of it at once, gone like
 * lightning. One passes near the player, so standing still is never the
 * answer; the rest cut the room into lanes. It keeps fighting while they
 * come due — the lines are the room's, not its.
 */
export const GUARDIAN_VOLLEY_EVERY_MS = 15_000;
/** How long a volley line is drawn before it fires: long, as the player has to read several at once. */
export const GUARDIAN_VOLLEY_TELE_MS = 2000;
/** The lines in a volley, and the beat between one and the next coming due. */
const VOLLEY_LINES = 5;
const VOLLEY_STAGGER_MS = 160;
/** How wide a volley line's hit is. */
const VOLLEY_WIDTH = TILE_PX * 0.6;
/** Its arm raised to give the order, standing. */
const VOLLEY_ORDER_MS = 500;
/**
 * **The ram twice**: a ram that ends without its wall comes round again at
 * once, the second off the first's recovery. Each is another chance at the
 * wall, so the more it rams the more it opens.
 */
const GUARDIAN_CHAIN_REST_MS = 260;
/** What a stake costs, in hearts: a warden's blow at the guardian's power. */
const STAKE_DAMAGE = 1;
/** It calls again only when its squad is down to this many. */
export const GUARDIAN_CALL_BELOW = 1;

export interface GuardianState {
  /** Time until it may call; it calls once this is out and its squad is thin. */
  callMs: number;
  /** Time until it may drive its stakes again. */
  stakesMs: number;
  /** Time until it may order a volley. */
  volleyMs: number;
  /** Whether its last ram has already been followed by a second, and whether the next blow must be one. */
  chained: boolean;
  chainNext: boolean;
  /** Whether it was in a ram last step, to see the one that just ended. */
  wasCharging: boolean;
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
  e.guardian = {
    callMs: GUARDIAN_ENTRANCE_MS, stakesMs: GUARDIAN_STAKES_EVERY_MS / 2, volleyMs: GUARDIAN_VOLLEY_EVERY_MS * 0.6,
    chained: false, chainNext: false, wasCharging: false, calling: false, answer: entrance.slice(0, GUARDIAN_ENTRANCE_MAX), spots: [] };
  e.hp = e.maxHp = GUARDIAN_HP;
  e.poise = e.maxPoise = GUARDIAN_POISE;
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
 * coming on the floor; when the arm comes down they rise. The call is never
 * interrupted: its poise is guarded while the arm is up. Its movement, shots
 * and blows are the warden's.
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
  if (g.stakesMs > 0) g.stakesMs -= dtMs;
  if (g.volleyMs > 0) g.volleyMs -= dtMs;
  // The ram twice: one that ended without its wall comes round again, once.
  const charging = e.attack !== "approach" && e.meleeKind === "charge";
  if (charging) g.chainNext = false;
  if (g.wasCharging && !charging) {
    if (!g.chained && e.staggerMs <= 0) {
      g.chained = true;
      g.chainNext = true;
      e.attackCooldownMs = Math.min(e.attackCooldownMs, GUARDIAN_CHAIN_REST_MS);
    } else g.chained = false;
  }
  g.wasCharging = charging;
  if (e.attack !== "approach" || e.pose !== "" || e.staggerMs > 0 || e.plantMs > 0 || g.chainNext) return;
  const settled = w.stats.elapsedMs > GUARDIAN_ENTRANCE_MS + GUARDIAN_CALL_MS;
  if (g.volleyMs <= 0 && settled) {
    orderVolley(w, e, g);
    return;
  }
  if (g.stakesMs <= 0 && settled) {
    driveStakes(w, e, g);
    return;
  }
  if (g.callMs > 0 || guardianSquad(w, e) > GUARDIAN_CALL_BELOW) return;
  g.calling = true;
  g.spots = bossSummonSpots(w, e, g.answer.length);
  e.pose = "guardian_call";
  e.poseMs = GUARDIAN_CALL_MS;
  e.poiseGuardMs = Math.max(e.poiseGuardMs, GUARDIAN_CALL_MS);
  w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "guardian_call" });
}

/**
 * **The stakes**: planted, the gun's butt down, and the ground drawn where it
 * will erupt — three lanes at the player, or a ring round itself when the
 * player is on it. It holds the pose until they have gone up and a beat after.
 */
function driveStakes(w: World, e: Enemy, g: GuardianState): void {
  g.stakesMs = GUARDIAN_STAKES_EVERY_MS;
  const p = w.player;
  const near = Math.hypot(p.x - e.x, p.y - e.y) < PALISADE_NEAR;
  if (near) {
    eruptRing(w, { x: e.x, y: e.y }, {
      damage: STAKE_DAMAGE, radius: PALISADE_CELL, rings: PALISADE_RINGS, first: e.radius + TILE_PX * 0.5,
      step: PALISADE_STEP, delayMs: PALISADE_RING_MS, spacing: 2, weight: 0, kind: "earth", element: "none",
      elementPower: 0, powers: noPowers(), proc: 0, statusMult: 1, burnMs: 0, spellIndex: -1, hostile: true,
    }, 0, GUARDIAN_STAKES_TELE_MS);
  } else {
    const at = Math.atan2(p.y - e.y, p.x - e.x);
    for (let i = 0; i < STAKE_LANES; i++) {
      const a = at + (i - (STAKE_LANES - 1) / 2) * STAKE_SPREAD;
      const x0 = e.x + Math.cos(a) * e.radius, y0 = e.y + Math.sin(a) * e.radius;
      castRift(w, x0, y0, a, lineToWall(w, x0, y0, a, STAKE_REACH), { teleMs: GUARDIAN_STAKES_TELE_MS, damage: STAKE_DAMAGE });
    }
  }
  e.pose = "guardian_stakes";
  e.poseMs = GUARDIAN_STAKES_TELE_MS + GUARDIAN_STAKES_REST_MS;
  e.velX = 0;
  e.velY = 0;
  w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: near ? "guardian_palisade" : "guardian_stakes" });
}

/**
 * **The volley**: its arm up for the order, and `VOLLEY_LINES` lines across
 * the room from wall to wall, each at its own angle, the first through the
 * ground near the player and the rest anywhere, coming due a beat apart.
 */
function orderVolley(w: World, e: Enemy, g: GuardianState): void {
  g.volleyMs = GUARDIAN_VOLLEY_EVERY_MS;
  const ext = w.room.extent, p = w.player;
  for (let i = 0; i < VOLLEY_LINES; i++) {
    let x: number, y: number;
    if (i === 0) {
      const a = w.rng.next() * Math.PI * 2, d = w.rng.next() * TILE_PX * 1.5;
      x = p.x + Math.cos(a) * d;
      y = p.y + Math.sin(a) * d;
    } else {
      x = (2 + w.rng.next() * (ext.w - 4)) * TILE_PX;
      y = (2 + w.rng.next() * (ext.h - 4)) * TILE_PX;
    }
    const tx = Math.floor(x / TILE_PX), ty = Math.floor(y / TILE_PX);
    if (w.room.grid[ty * GRID_W + tx] !== Tile.Floor) continue;
    const angle = w.rng.next() * Math.PI;
    // Out of the room's walls: the whole room edge to edge, through pillars and all.
    const back = toRoomEdge(ext, x, y, angle + Math.PI), fore = toRoomEdge(ext, x, y, angle);
    const x0 = x + Math.cos(angle + Math.PI) * back, y0 = y + Math.sin(angle + Math.PI) * back;
    const length = back + fore;
    castRift(w, x0, y0, angle, length, {
      width: VOLLEY_WIDTH, teleMs: GUARDIAN_VOLLEY_TELE_MS + i * VOLLEY_STAGGER_MS, damage: STAKE_DAMAGE, beam: true,
    });
  }
  e.pose = "guardian_order";
  e.poseMs = VOLLEY_ORDER_MS;
  e.velX = 0;
  e.velY = 0;
  w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "guardian_volley" });
}

/** How far from a point to the inside of the room's outer wall along an angle. */
function toRoomEdge(ext: { w: number; h: number }, x: number, y: number, angle: number): number {
  const lo = TILE_PX, hx = (ext.w - 1) * TILE_PX, hy = (ext.h - 1) * TILE_PX;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (hx - x) / dx);
  if (dx < -1e-6) t = Math.min(t, (lo - x) / dx);
  if (dy > 1e-6) t = Math.min(t, (hy - y) / dy);
  if (dy < -1e-6) t = Math.min(t, (lo - y) / dy);
  return Math.max(0, t);
}

/** The dead answer: the bodies rise round it. */
function answer(w: World, e: Enemy, who: readonly EnemyId[], spots: readonly { x: number; y: number }[]): void {
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
