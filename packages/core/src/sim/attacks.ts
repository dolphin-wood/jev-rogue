/**
 * The expansion's attack kinds and the bodies that carry them (research:
 * `docs/research/enemy-expansion.md` §2–§4).
 *
 * Six primitives, each a small pooled entity on the world, so several bodies
 * can carry one and the player learns it once:
 *
 * - **rift** — a ground line, a capsule that grows through its telegraph and
 *   erupts. A zero-length rift is a circle, which is how an emerge, a burst
 *   or a self-destruct lands: one damage path for every "this ground erupts".
 * - **mine** — a seed that is inert, then armed, then bursts on proximity.
 * - **tether** — a line between two things: a ward that armours an ally, a
 *   hook that drags the player, an anchored chain, a sight beam.
 * - **lob** — an arc onto a landing spot fixed at release.
 * - **slow field** — a cool patch that slows the player and does no damage.
 * - **flame** — the warden's fire-shot: a gout of flame out of its gun that
 *   rolls a few tiles out and stops at stone.
 *
 * Two halves. `stepExpansion` is a body's own behaviour — when it plants,
 * rings, dives or throws — and is called from `stepEnemy`. `stepAttacks` moves
 * the entities and lands their damage, once per world step, through `hooks`
 * so this module needs nothing from the world's internals.
 *
 * **Every elite form is a different attack, not a multiplier**: the elite
 * shooter lobs onto the retreat line, the elite turret splits the floor, the
 * elite sentinel's sight line becomes a beam, the elite orbiter sows mines in
 * its own wake, the elite tank's chop cracks the ground ahead, and the elite
 * summoner wards its newest minion. A body is elite when it carries affixes,
 * the same test the lancer's swap uses.
 */
import { TILE_PX, GRID_W, GRID_H } from "../types.ts";
import type { EnemyId } from "../types.ts";
import { baseArchetype } from "../encounters/enemies.ts";
import { PLAYER_RADIUS } from "./types.ts";
import type { Arm, Enemy, Flame, Lob, Mine, PlayerWakeCut, Rift, Shockwave, Tether, WakeTrail, World } from "./types.ts";
import { circleHitsWall, dist2, hasLineOfSight, moveSliding, normalise } from "./collide.ts";
import { lightFire } from "./fire.ts";

/** What the world lends this module to land damage with. */
export interface AttackHooks {
  hurtPlayer(x: number, y: number, cause: string, stunMs: number, hearts: number): void;
  /**
   * Whether the player currently has i-frames — mercy frames or a dash.
   *
   * `hurtPlayer` already refuses a hit during them, but a shockwave needs the
   * answer *before* it decides the band is spent: a ring the player dashed
   * through has not caught them, and it has to stay live for the rest of its
   * travel in case they stop inside it.
   */
  playerInvulnerable(): boolean;
  /** Feeds the player's burn gauge, as standing in fire does. */
  burnPlayer(amount: number): void;
  /** Staggers a body even if armour would refuse it: a cut tether knocks its ringer down. */
  knockDown(e: Enemy, ms: number): void;
  /**
   * Hatches a brooder's coal into a body where it landed (doc 019).
   *
   * A hook rather than a spawn here, because the caps that decide whether a
   * body may arrive at all — the summoner pool, the concurrency cap, the
   * ramp's alive count — live in the world, and a second place that creates
   * enemies is a second place to get them wrong.
   */
  hatch(x: number, y: number, from: EnemyId): void;
}

export function isElite(e: Enemy): boolean {
  return e.affixes.length > 0;
}

/* ================================== rift ================================== */

/** A rift's telegraph and live window: 54 and 14 frames (research §3.1). */
export const RIFT_TELE_MS = 900;
export const RIFT_ACTIVE_MS = 230;
const RIFT_SCAR_MS = 1500;

export function castRift(
  w: World, x: number, y: number, angle: number, length: number,
  opts: { width?: number; teleMs?: number; damage?: number; bolt?: boolean; summon?: boolean; rock?: boolean } = {},
): Rift {
  const r: Rift = {
    alive: true, x, y, angle, length,
    width: opts.width ?? TILE_PX * 0.9,
    teleMs: opts.teleMs ?? RIFT_TELE_MS, teleMaxMs: opts.teleMs ?? RIFT_TELE_MS,
    activeMs: RIFT_ACTIVE_MS, scarMs: RIFT_SCAR_MS,
    damage: opts.damage ?? 1, struck: false,
    ...(opts.bolt ? { bolt: true } : {}),
    ...(opts.bolt && opts.summon ? { summon: true } : {}),
    ...(opts.rock ? { rock: true } : {}),
  };
  w.rifts.push(r);
  w.events.push({ kind: "telegraph", x, y, what: riftName(r, "bolt", "rock") });
  return r;
}

/** What a rift is called in its events and as a cause of hurt: `bolt` and `rock` name the sky's and the roof's. */
function riftName(r: Rift, bolt: string, rock: string): string {
  return r.bolt ? bolt : r.rock ? rock : r.length > 0 ? "rift" : "burst";
}

/** Distance from a point to a rift's spine, which is a segment or, at length 0, a point. */
function riftDistance(r: Rift, x: number, y: number): number {
  const ex = r.x + Math.cos(r.angle) * r.length;
  const ey = r.y + Math.sin(r.angle) * r.length;
  const vx = ex - r.x;
  const vy = ey - r.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - r.x) * vx + (y - r.y) * vy) / len2)) : 0;
  return Math.hypot(x - (r.x + vx * t), y - (r.y + vy * t));
}

export function riftHits(r: Rift, x: number, y: number, radius: number): boolean {
  return riftDistance(r, x, y) <= r.width / 2 + radius;
}

/* =============================== shockwave ================================ */

/**
 * The **ground shockwave**: a ring of broken floor travelling outward from an
 * impact (doc 005, the boss's slam).
 *
 * A `Rift` of zero length is a filled circle, and a filled circle asks one
 * question — *be somewhere else by the time it lands*. That is the question
 * the slam already asked, and the boss's whole escalation is meant to be by
 * **kinds of move**, not by more of one. A travelling band asks the opposite:
 * everywhere is safe eventually and nowhere is safe for long, and the answer
 * is the dash — through the band, during its i-frames — or distance.
 *
 * The numbers are set so a dash crosses it. The player dashes about 150 px in
 * 220 ms of i-frames; the band is 34 px thick and closes at 260 px/s, so the
 * relative closing width the dash has to cover is under 90 px even head-on.
 * Standing still, it is unmissable; moving outward ahead of it, it catches
 * up, because 260 is twice the walk.
 */
export const SHOCK_CHARGE_MS = 520;
export const SHOCK_THICKNESS = 34;
export const SHOCK_SPEED = 260;

export function castShockwave(
  w: World, x: number, y: number,
  opts: {
    chargeMs?: number; inner?: number; thickness?: number;
    speed?: number; maxRadius?: number; damage?: number;
    /** Only the stretch of the ring facing this way, `half` radians either side. */
    facing?: number; half?: number;
    /** A straight edge this wide travelling along `facing`, instead of an arc (`Shockwave.width`). */
    width?: number;
  } = {},
): Shockwave {
  const s: Shockwave = {
    alive: true, x, y,
    chargeMs: opts.chargeMs ?? SHOCK_CHARGE_MS,
    chargeMaxMs: opts.chargeMs ?? SHOCK_CHARGE_MS,
    inner: opts.inner ?? 0,
    thickness: opts.thickness ?? SHOCK_THICKNESS,
    speed: opts.speed ?? SHOCK_SPEED,
    maxRadius: opts.maxRadius ?? TILE_PX * 9,
    damage: opts.damage ?? 1,
    struck: false,
    ...(opts.facing !== undefined && opts.half !== undefined ? { facing: opts.facing, half: opts.half } : {}),
    ...(opts.facing !== undefined && opts.width !== undefined ? { facing: opts.facing, width: opts.width } : {}),
  };
  w.shockwaves.push(s);
  // A band with a charge is a promise, and is cued; one born at once is part of a blow that has its own sound
  // (the king's sword waves, his slam's band), and a second cue on it rang like a bell.
  if (s.chargeMs > 0) w.events.push({ kind: "telegraph", x, y, what: "shockwave" });
  return s;
}

/** Whether a body of `radius` at (x, y) is standing in the live band. */
export function shockwaveHits(s: Shockwave, x: number, y: number, radius: number): boolean {
  if (s.chargeMs > 0) return false;
  if (s.width !== undefined && s.facing !== undefined) {
    const dx = x - s.x, dy = y - s.y;
    const along = dx * Math.cos(s.facing) + dy * Math.sin(s.facing);
    const across = -dx * Math.sin(s.facing) + dy * Math.cos(s.facing);
    return along >= s.inner - radius && along <= s.inner + s.thickness + radius && Math.abs(across) <= s.width / 2 + radius;
  }
  const d = Math.hypot(x - s.x, y - s.y);
  if (d < s.inner - radius || d > s.inner + s.thickness + radius) return false;
  if (s.facing === undefined || s.half === undefined) return true;
  // An arc of the ring: the body's own width widens it, as a blade's arc is widened.
  let off = Math.atan2(y - s.y, x - s.x) - s.facing;
  while (off > Math.PI) off -= Math.PI * 2;
  while (off < -Math.PI) off += Math.PI * 2;
  return Math.abs(off) <= s.half + Math.asin(Math.min(1, radius / Math.max(d, 1)));
}

/* ================================== wake ================================== */

/**
 * **A run's wake**, after Minish Cap's dash attack: the blade held out ahead,
 * and either side of the line the cut's edge rolls off it. It is laid **as
 * the runner goes**, in short stretches — one pair for every `stepPx` of
 * ground, set off at the moment the runner passes that ground — so it
 * unfolds behind the runner as a widening V, the nearest stretch just
 * leaving the line while the first is already out at its reach. Each
 * stretch is a short straight edge (`Shockwave.width`) travelling out
 * square to the run.
 *
 * It replaced two long edges born along the whole run at once when it
 * ended, which pushed out as two parallel slabs: correct, and read as a
 * wall being shoved rather than as something the run left behind it.
 */
export function startWake(
  x: number, y: number, dirX: number, dirY: number,
  spec: { stepPx: number; reachPx: number; inner: number; thick: number; speed: number; damage: number },
  byPlayer?: PlayerWakeCut,
): WakeTrail {
  return {
    fromX: x, fromY: y, dirX, dirY, ...spec, laid: 0, group: { struck: false },
    ...(byPlayer ? { byPlayer } : {}),
  };
}

/**
 * Lays the stretches of `t` the runner has passed on its way to (x, y).
 * `final` is the run ending there: what is left short of a whole stretch is
 * laid as a shorter one, if it is worth one. Returns how many were laid.
 */
export function layWake(w: World, t: WakeTrail, x: number, y: number, final = false): number {
  // Only the ground along the run counts: a shove sideways lays nothing.
  let along = (x - t.fromX) * t.dirX + (y - t.fromY) * t.dirY;
  let n = 0;
  const facing = Math.atan2(t.dirY, t.dirX);
  const lay = (len: number): void => {
    const cx = t.fromX + t.dirX * len / 2, cy = t.fromY + t.dirY * len / 2;
    for (const side of [-1, 1]) {
      const s = castShockwave(w, cx, cy, {
        chargeMs: 0, inner: t.inner, thickness: t.thick, speed: t.speed,
        maxRadius: t.inner + t.reachPx, damage: t.damage, facing: facing + side * Math.PI / 2, width: len,
      });
      s.wake = t.group;
      s.wakeIndex = t.laid;
      if (t.byPlayer) s.byPlayer = t.byPlayer;
    }
    t.fromX += t.dirX * len;
    t.fromY += t.dirY * len;
    t.laid++;
    n++;
  };
  while (along >= t.stepPx) {
    lay(t.stepPx);
    along -= t.stepPx;
  }
  if (final && along >= t.stepPx / 3) lay(along);
  return n;
}

/* ================================== arm =================================== */

/**
 * **The rotating arm** (doc 005, "patterns that force a direction").
 *
 * The limb is laid out at full length and held still for `ARM_TELE_MS` — long
 * enough to read *where it starts and which way it will turn* — and then it
 * sweeps. Two answers, and the player picks one per sweep: **dash through it**
 * on the i-frames, or **run the way it turns** and stay ahead of the tip. Both
 * are footwork; neither is a flinch.
 *
 * The rate is set against the player's walk. The arm's tip at 96 px out at
 * 2.2 rad/s moves at about 210 px/s, against a walk of 150 — so outrunning it
 * at the tip is impossible and outrunning it *near the anchor* is easy, which
 * is the whole geometry lesson: inside a turning arm you circle, outside it
 * you leave. The dash crosses the 20 px limb in a fraction of its 220 ms of
 * i-frames from any angle.
 */
export const ARM_TELE_MS = 620;
export const ARM_WIDTH = 20;
/** One hit per this long: a sweep charges the player once, not per frame. */
const ARM_HIT_COOLDOWN_MS = 1100;

export function castArm(
  w: World, owner: Enemy, angle: number,
  opts: {
    spin: number; length: number; activeMs: number;
    inner?: number; width?: number; teleMs?: number; damage?: number;
  },
): Arm {
  const a: Arm = {
    alive: true, owner: owner.id, x: owner.x, y: owner.y, angle,
    spin: opts.spin, inner: opts.inner ?? owner.radius * 0.6, length: opts.length,
    width: opts.width ?? ARM_WIDTH,
    teleMs: opts.teleMs ?? ARM_TELE_MS, teleMaxMs: opts.teleMs ?? ARM_TELE_MS,
    activeMs: opts.activeMs, activeMaxMs: opts.activeMs,
    damage: opts.damage ?? 1, hitCooldownMs: 0,
  };
  w.arms.push(a);
  w.events.push({ kind: "telegraph", x: owner.x, y: owner.y, what: "arm" });
  return a;
}

/**
 * Whether a body of `radius` at (x, y) is touching the limb.
 *
 * The limb is a capsule from `inner` to `length` along `angle`, which is
 * exactly what the renderer draws: the drawing takes its two endpoints from
 * this same geometry, so the steel the player sees is the steel that cuts.
 */
export function armHits(a: Arm, x: number, y: number, radius: number): boolean {
  if (a.teleMs > 0 || a.activeMs <= 0) return false;
  return armDistance(a, x, y) <= a.width / 2 + radius;
}

/** Distance from a point to the limb's spine. */
export function armDistance(a: Arm, x: number, y: number): number {
  const ux = Math.cos(a.angle);
  const uy = Math.sin(a.angle);
  const x0 = a.x + ux * a.inner;
  const y0 = a.y + uy * a.inner;
  const vx = ux * (a.length - a.inner);
  const vy = uy * (a.length - a.inner);
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / len2)) : 0;
  return Math.hypot(x - (x0 + vx * t), y - (y0 + vy * t));
}

/** How far a rift reaches along its line before stone stops it. */
export function lineToWall(w: World, x: number, y: number, angle: number, max: number): number {
  const step = 6;
  for (let d = step; d <= max; d += step) {
    if (circleHitsWall(w.room.grid, x + Math.cos(angle) * d, y + Math.sin(angle) * d, 2)) return d - step;
  }
  return max;
}

/* ================================== mine ================================== */

/** Inert for 48 frames, then armed; a fuse of 8 s; bursts inside 0.8 tile, hurts inside 1.2. */
export const MINE_INERT_MS = 800;
/*
 * Mines were the largest single cause of hearts lost twice: at six a body a
 * sower carpeted the floor it circles, and at three, once rooms played in
 * rounds, a room's sowers kept a field of them down for its whole length.
 * Two a body, and a shorter fuse, so the floor clears as the fight moves.
 */
const MINE_FUSE_MS = 6000;
const MINES_PER_BODY = 2;
export const MINE_TRIGGER = TILE_PX * 0.65;
export const MINE_BLAST = TILE_PX * 1.0;
/**
 * How long a burst is on screen after it has landed. Exported because the
 * renderer plays three drawn frames across it, and a hard-coded copy there
 * silently stops matching the moment this changes.
 */
export const MINE_BURST_MS = 300;

/**
 * Set off, a seed flashes this long before it bursts. It burst on the frame
 * it was touched, with a blast wider than its trigger, so touching one was a
 * hit with nothing to answer; now the touch is the warning and the dash out
 * is the answer.
 */
export const MINE_PRIME_MS = 320;

const DEATH_SEED_PX = 36;
const DEATH_SEED_INERT_MS = 1200;

export function plantMine(
  w: World, owner: number, x: number, y: number, inertMs = MINE_INERT_MS, by?: string,
): Mine {
  const m: Mine = {
    alive: true, x, y, inertMs, fuseMs: MINE_FUSE_MS, primeMs: 0, burstMs: 0, owner, damage: 0.5,
    by: by ?? byId(w, owner)?.archetype ?? "room",
  };
  w.mines.push(m);
  return m;
}

function minesOf(w: World, owner: number): number {
  return w.mines.filter((m) => m.alive && m.burstMs <= 0 && m.owner === owner).length;
}

function detonate(w: World, m: Mine, hooks: AttackHooks): void {
  if (m.burstMs > 0) return;
  m.burstMs = MINE_BURST_MS;
  w.events.push({ kind: "hazard_tick", x: m.x, y: m.y, what: "mine" });
  if (dist2(m.x, m.y, w.player.x, w.player.y) <= (MINE_BLAST + PLAYER_RADIUS) ** 2)
    hooks.hurtPlayer(m.x, m.y, `mine:${m.by}`, 0, m.damage);
}

/* ================================= tether ================================= */

function tether(
  w: World, kind: Tether["kind"], from: number, to: number, x1: number, y1: number,
  phase: Tether["phase"], ms: number, damage = 0,
): Tether {
  const t: Tether = { alive: true, kind, from, to, x1, y1, phase, ms, cutMs: 0, damage, pulseMs: 0 };
  w.tethers.push(t);
  return t;
}

function byId(w: World, id: number): Enemy | undefined {
  return w.enemies.find((e) => e.id === id && e.hp > 0);
}

/** The two ends of a tether now: the near body, and the far body or point. */
export function tetherEnds(w: World, t: Tether): { x0: number; y0: number; x1: number; y1: number } | null {
  const a = byId(w, t.from);
  if (!a) return null;
  if (t.to >= 0) {
    const b = byId(w, t.to);
    if (!b) return null;
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }
  return { x0: a.x, y0: a.y, x1: t.x1, y1: t.y1 };
}

function segmentDistance(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / len2)) : 0;
  return Math.hypot(px - (x0 + vx * t), py - (y0 + vy * t));
}

/** Armour a ward gives: a tank's worth (research §2.2). */
export const WARD_ARMOUR = 18;
/**
 * The line **does not trickle the shield back**; the toll does, all at once
 * (`toll`).
 *
 * It used to feed at 7.5 armour a second, which made the ringer's actual
 * move — the clap — redundant: the shield came back whether or not the bell
 * rang, so there was nothing to interrupt and nothing to time. Putting the
 * whole refill on the toll is what turns the ringer from a body with a
 * passive aura into a body with a **window**.
 */
/** Standing in a ward line this long cuts it: 20 frames. */
const WARD_CUT_MS = 330;
/** A cut line knocks its ringer down for a second: the cut is a reward, not a toll. */
const WARD_CUT_STAGGER_MS = 1000;

function grantWard(e: Enemy, amount: number): void {
  const add = Math.max(0, amount - e.wardArmour);
  e.wardArmour += add;
  e.armour += add;
  e.maxArmour = Math.max(e.maxArmour, e.armour);
}

/**
 * Damage taken out of armour comes out of the ward first, so a shield the
 * player has broken through is a shield the ringer has to pay for again.
 * Called from the one place armour is spent (`damageEnemy`).
 */
export function spendWard(e: Enemy, amount: number): void {
  if (e.wardArmour > 0) e.wardArmour = Math.max(0, e.wardArmour - amount);
}

function stripWard(e: Enemy): void {
  if (e.wardArmour <= 0) return;
  e.armour = Math.max(0, e.armour - e.wardArmour);
  e.wardArmour = 0;
}

/** Whether a body already carries a ward from any tether. */
function warded(w: World, id: number): boolean {
  return w.tethers.some((t) => t.alive && t.kind === "ward" && t.to === id);
}

/**
 * The bell rings: every ally still on one of this ringer's lines has its
 * shield put straight back to full, and a pulse of light is sent down the
 * line to say so (`Tether.pulseMs`; the shield pops full when it arrives).
 *
 * Instant rather than a faster feed, because the point is a **moment**: the
 * player who was three hits from breaking an ally has to see the three hits
 * given back, and a shield that creeps back up is a number nobody watches.
 * What the toll costs the player is measured in the windup it takes, not in
 * health, so the answer is the interrupt (`interruptToll`).
 */
function toll(w: World, e: Enemy): void {
  for (const t of w.tethers) {
    if (!t.alive || t.kind !== "ward" || t.from !== e.id || t.to < 0) continue;
    const ally = byId(w, t.to);
    if (!ally) continue;
    grantWard(ally, WARD_ARMOUR);
    t.pulseMs = TOLL_PULSE_MS;
  }
  w.hasteFields.push({
    alive: true, x: e.x, y: e.y,
    radius: HASTE_FIELD_RADIUS, lifeMs: HASTE_FIELD_MS, maxLifeMs: HASTE_FIELD_MS,
  });
  w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "toll" });
}

/**
 * **A hit during the windup stops the toll** (doc 005, the bellringer).
 *
 * Called from the one place a body takes damage. It is the whole reason the
 * windup is 820 ms and drawn on the floor: the ringer is asking the player to
 * leave what they are fighting and come and shut it up, and a question with
 * no way to answer it is not a question. The circle goes with it, so what the
 * player sees is the thing they interrupted stopping.
 */
export function interruptToll(w: World, e: Enemy): void {
  if (e.pose !== "field") return;
  e.pose = "";
  e.poseMs = 0;
  e.moveMs = TOLL_INTERRUPT_MS;
  for (const r of w.rifts)
    if (r.alive && r.length === 0 && r.teleMs > 0 && dist2(r.x, r.y, e.x, e.y) < 16) r.alive = false;
  w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: "toll_interrupted" });
}

/* ================================== lob =================================== */

export function throwLob(
  w: World, e: Enemy, x1: number, y1: number, lands: Lob["lands"], radius: number, damage: number, flightMs = 700,
): void {
  const x = Math.max(TILE_PX, Math.min((GRID_W - 1) * TILE_PX, x1));
  const y = Math.max(TILE_PX, Math.min((GRID_H - 1) * TILE_PX, y1));
  w.lobs.push({ alive: true, x0: e.x, y0: e.y, x1: x, y1: y, t: 0, flightMs, lands, radius, damage, from: e.archetype });
  w.events.push({ kind: "shot", x: e.x, y: e.y, what: `lob:${e.archetype}` });
}

/* ============================ body behaviours ============================= */

/** Poses a body holds still through: the move is the whole of what it is doing. */
export const PLANTED_POSES: ReadonlySet<string> = new Set([
  "musket_windup", "musket_fire", "musket_second", "musket_reload", "cast", "field", "burst", "peal_windup", "windup_hook", "anchor_cast", "lash_windup",
  "flare_windup", "bloom_cast", "telegraph", "telegraph_walk", "lob_windup", "cinder_windup",
]);

/** Whether the body is posed in a move that holds it still. */
export function planted(e: Enemy): boolean {
  return e.pose !== "" && PLANTED_POSES.has(e.pose);
}

function pose(e: Enemy, name: string, ms: number): void {
  e.pose = name;
  e.poseMs = ms;
}

/**
 * The warden's fire-shot (research §2.1, reworked): the arm is a gun, and the
 * drawn frames are its aim — the windup raises it to load, the lunge levels
 * it. Raised for most of a second with its reach drawn on the floor; then a
 * spreading burst of dragon's-breath fire out of the muzzle that rolls out a
 * few tiles and stops at stone; then a long reload in which it stands. It
 * is one hit on whatever it rolls over, and it sets the player burning; it
 * leaves nothing on the floor. The answer is distance, a wall, or being on
 * it while it reloads.
 */
export const MUSKET_WINDUP_MS = 950;
const MUSKET_FIRE_MS = 260;
const MUSKET_RELOAD_MS = 1300;
/** The elite's second barrel follows this soon after the first. */
const MUSKET_SECOND_MS = 380;
export const MUSKET_SPREAD_DEG = 48;
/** How far the flame rolls out, in px, unless a wall stops it first. */
export const MUSKET_RANGE = TILE_PX * 2.8;
/** How long the flame takes to roll out to its reach. */
export const FLAME_ROLL_MS = 50;
/**
 * How long the gout stays on screen, rolling out and then guttering. It only
 * hurts in its first moment, so this is all picture: a shot is a bang and a
 * breath of smoke, and smoke hanging in the lane for most of a second read as
 * the shot still being there.
 */
export const FLAME_LIFE_MS = 520;
/** Where the muzzle is, out from the body's centre along the aim. */
const MUSKET_MUZZLE_PX = 20;
const FLAME_RAYS = 7;
const MUSKET_HITSTOP_MS = 34;
const MUSKET_RECOIL = 90;
const FLAME_BURN = 0.35;

/**
 * The flame's reach along each of its rays, from `x, y` along `aim`: each ray
 * stops at the first wall. Shared with the renderer, which draws the
 * telegraph and the flame to the same shape the damage uses.
 */
export function flameRays(w: World, x: number, y: number, aim: number): number[] {
  const half = (MUSKET_SPREAD_DEG / 2) * Math.PI / 180;
  const out: number[] = [];
  for (let i = 0; i < FLAME_RAYS; i++) {
    const a = aim - half + (2 * half * i) / (FLAME_RAYS - 1);
    out.push(lineToWall(w, x, y, a, MUSKET_RANGE));
  }
  return out;
}

/** Where a warden's muzzle is: out along the aim, or its centre when the muzzle would be in stone. */
export function muzzleOf(w: World, e: Enemy, aim: number): { x: number; y: number } {
  const x = e.x + Math.cos(aim) * MUSKET_MUZZLE_PX;
  const y = e.y - 3 + Math.sin(aim) * MUSKET_MUZZLE_PX;
  if (circleHitsWall(w.room.grid, x, y, 2) || !hasLineOfSight(w.room.grid, e.x, e.y, x, y)) return { x: e.x, y: e.y };
  return { x, y };
}

function fireMusket(w: World, e: Enemy): void {
  // Along the gun, which is where the telegraph was drawn: the body turned to
  // follow the player at its own rate while it was raised, and a shot that
  // snapped to the live position would land outside its own warning.
  const aim = e.facing;
  const m = muzzleOf(w, e, aim);
  w.flames.push({ alive: true, owner: e.id, x: m.x, y: m.y, aim, rays: flameRays(w, m.x, m.y, aim), ms: 0, hit: false });
  // The shot is a blow, not a hiss: the world holds for two frames and the
  // gun throws its bearer back a step. It shakes nothing unless it hits.
  w.hitstopMs = Math.max(w.hitstopMs, MUSKET_HITSTOP_MS);
  e.knockX -= Math.cos(aim) * MUSKET_RECOIL;
  e.knockY -= Math.sin(aim) * MUSKET_RECOIL;
  w.events.push({ kind: "shot", x: m.x, y: m.y, what: "musket", facing: aim });
}

/** The flame's reach at angle `a` off its aim, between its rays. */
function flameReach(f: Flame, a: number): number {
  const half = (MUSKET_SPREAD_DEG / 2) * Math.PI / 180;
  const t = ((a + half) / (2 * half)) * (f.rays.length - 1);
  const i = Math.max(0, Math.min(f.rays.length - 2, Math.floor(t)));
  const k = Math.max(0, Math.min(1, t - i));
  return f.rays[i]! * (1 - k) + f.rays[i + 1]! * k;
}

function stepFlame(w: World, f: Flame, dtMs: number, hooks: AttackHooks): void {
  f.ms += dtMs;
  if (f.ms >= FLAME_LIFE_MS) { f.alive = false; return; }
  const front = MUSKET_RANGE * Math.min(1, f.ms / FLAME_ROLL_MS);
  const p = w.player;
  if (!f.hit && f.ms < FLAME_ROLL_MS + 80) {
    const d = Math.hypot(p.x - f.x, p.y - f.y);
    let da = Math.atan2(p.y - f.y, p.x - f.x) - f.aim;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const half = (MUSKET_SPREAD_DEG / 2) * Math.PI / 180;
    // Inside the flame's front, its spread and its reach on that line (a
    // wall between is a wall between), allowing for the body's own size.
    if (Math.abs(da) <= half + PLAYER_RADIUS / Math.max(8, d) && d - PLAYER_RADIUS <= Math.min(front, flameReach(f, Math.max(-half, Math.min(half, da))))) {
      f.hit = true;
      hooks.hurtPlayer(f.x, f.y, "flame:warden", 0, 1);
      hooks.burnPlayer(FLAME_BURN);
    }
  }
}
const RING_CAST_MS = 660;
/**
 * The **toll** (doc 005, the bellringer).
 *
 * The ringer is the roster's one support body, and a support whose signature
 * move damages the player is a support pretending to be an attacker. So the
 * toll does no damage at all: it is **maintenance**, and what it maintains is
 * the wards. Every ally the ringer still has a line to has its shield put
 * straight back to full, instantly, however much of it the player had just
 * cut through.
 *
 * That makes the fight a question about *timing* rather than about standing
 * somewhere. Either break the body you are on before the next toll lands, or
 * cut the line, or — the answer the move is really built around — **hit the
 * ringer while it is winding up**, which stops the toll dead (`TOLL_CUE`).
 * The ringer is no longer a body to kill eventually; it is a body with a
 * window, and the window is drawn on the floor for `FIELD_CAST_MS`.
 *
 * What the clap leaves behind is a patch that **hurries its allies**, not one
 * that slows the player: the lingering half of a support's move belongs on
 * the bodies it supports. It is not drawn on the floor (see `HasteField`).
 *
 * 820 ms of windup because that is a reaction plus a crossing: long enough to
 * be answered by a player who is on the other side of the room and has to
 * decide to come, which is what makes the interrupt a real choice.
 */
const FIELD_CAST_MS = 820;
const TOLL_RADIUS = TILE_PX * 2.1;
/** The ringing the clap leaves, and how much faster it makes a body inside it. */
const HASTE_FIELD_MS = 2500;
const HASTE_FIELD_RADIUS = TOLL_RADIUS;
export const HASTE_SPEED = 1.35;
/** How long a hurried body coasts after leaving the patch. */
const HASTE_CARRY_MS = 300;
/** How long the conduction pulse takes to run from the ringer to an ally. */
export const TOLL_PULSE_MS = 220;
/** After an interrupted toll, the ringer waits this long before trying again. */
const TOLL_INTERRUPT_MS = 2600;
const PEAL_WINDUP_MS = 1100;
const PEAL_RADIUS = TILE_PX * 4;
const PEAL_WARD_MS = 4000;
const ALONE_MS = 1500;
const BURST_MS = 800;
const HOOK_AIM_MS = 730;
const HOOK_FLY_MS = 330;
const HOOK_LENGTH = TILE_PX * 6;
const DRAG_MS = 520;
/** Of the lash, the part left after the player lands: a reaction plus a dash. */
const LASH_AFTER_MS = 460;
/**
 * The lash's reach. The drag stops the player about 41 px from the caster
 * (its radius plus a tile), so this covers where they land with a step's
 * worth to spare — the answer is to move, not to have been elsewhere.
 */
const LASH_RADIUS = TILE_PX * 1.8;
const CHAIN_MS = 5000;
const CHAIN_LENGTH = TILE_PX * 5;
const DELVE_SURFACE_MS = 2600;
const DIVE_MS = 500;
const DELVE_UNDER_MAX_MS = 1200;
const EMERGE_MS = 600;
const CINDER_TRAIL_MS = 660;
const FLARE_MS = 1000;
const LOB_WINDUP_MS = 800;

/**
 * A body's own move, once per step while awake. `seen` is where it believes
 * the player is (its perception, not the live position); `live` is the
 * player itself, for the few moves that are allowed to track while placed.
 */
export function stepExpansion(
  w: World, e: Enemy, dtMs: number, seen: { x: number; y: number },
): void {
  if (e.poseMs > 0) {
    e.poseMs -= dtMs;
    if (e.poseMs <= 0) finishPose(w, e, seen);
  }
  if (e.moveMs > 0) e.moveMs -= dtMs;
  const gap = Math.hypot(seen.x - e.x, seen.y - e.y);
  const free = e.poseMs <= 0 && e.attack === "approach";

  /*
   * **Dispatched on the base, branched on the id** (doc 019). A subspecies is
   * its base's body with one verb changed, so it takes the same case and
   * differs inside it — `case "bellringer"` is where both the bellringer and
   * the pealer live, and which of the two is standing there decides whether it
   * tolls or peals. Keying the switch on the id instead would have made every
   * subspecies a body that does nothing at all, silently.
   */
  switch (baseArchetype(e.archetype)) {
    case "bellringer": {
      const allies = w.enemies.filter((o) => o !== e && o.hp > 0 && o.archetype !== "bellringer" && o.spawnFadeMs <= 0);
      if (allies.length === 0) e.aloneMs += dtMs;
      else e.aloneMs = 0;
      // A support with nothing to support rings itself apart (research §2.2).
      if (e.aloneMs >= ALONE_MS && e.pose !== "burst") {
        pose(e, "burst", BURST_MS);
        castRift(w, e.x, e.y, 0, 0, { width: TILE_PX * 4, teleMs: BURST_MS, damage: 1 });
        break;
      }
      if (free && e.moveMs <= 0 && e.archetype !== "pealer") {
        pose(e, "field", FIELD_CAST_MS);
        /*
         * The circle the player sees grow *is* the clap's reach, and it deals
         * nothing: `damage: 0`. It is there to say **where** and **when**, so
         * the player can decide to be at the ringer before the ring closes.
         * Kept as a rift rather than as a bespoke telegraph because it is the
         * same growing circle the delver's emergence uses, which the player
         * has already learned to read as a clock.
         */
        castRift(w, e.x, e.y, 0, 0, { width: TOLL_RADIUS * 2, teleMs: FIELD_CAST_MS, damage: 0 });
        e.moveMs = 7000;
      }
      break;
    }
    case "delver":
      stepDelve(w, e, dtMs, seen);
      break;
    case "cinderling": {
      // While it burns it leaves a trail, and the elite flares on a full gauge.
      if (e.burnMs > 0 && e.moveMs <= 0 && e.pose === "") {
        lightFire(w, e.x, e.y, "enemy", { radius: TILE_PX * 0.5, lifeMs: 1600 });
        e.moveMs = CINDER_TRAIL_MS;
      }
      if (e.archetype === "emberling" && e.burnBuild >= 0.95 && e.pose === "") pose(e, "flare_windup", FLARE_MS);
      break;
    }
    /*
     * The shooter's pin shot and the orbiter's seedwake are gone (doc 019).
     * Both were doc 005 elite moves, and both answered like another archetype
     * already in the roster — a lob is the cinderling's and a seed is the
     * sower's — so the player learned nothing from meeting them. The pinner
     * puts a second shot down the shooter's own lane and the wisp curls the
     * orbiter's own shot, which are the same bodies asked one step harder.
     */
    default:
      break;
  }
}

/** The end of a posed move: what it was winding up to do. */
function finishPose(w: World, e: Enemy, seen: { x: number; y: number }): void {
  const was = e.pose;
  e.pose = "";
  e.poseMs = 0;
  switch (was) {
    case "musket_windup":
      fireMusket(w, e);
      // The elite's second barrel: a beat later, from where it stands.
      pose(e, e.archetype === "fusilier" && e.casts % 2 === 1 ? "musket_second" : "musket_fire", MUSKET_FIRE_MS);
      break;
    case "musket_second":
      pose(e, "musket_windup", MUSKET_SECOND_MS);
      e.casts++;
      break;
    case "musket_fire":
      // Reloading: smoke at the muzzle, the body standing — its opening.
      pose(e, "musket_reload", MUSKET_RELOAD_MS);
      break;
    case "field":
      toll(w, e);
      break;
    case "burst":
      // The ring it telegraphed has gone off; the ringer goes with it.
      e.hp = 0;
      break;
    case "peal_windup": {
      for (const o of w.enemies) {
        if (o === e || o.hp <= 0 || baseArchetype(o.archetype) === "bellringer") continue;
        if (dist2(o.x, o.y, e.x, e.y) > PEAL_RADIUS * PEAL_RADIUS) continue;
        grantWard(o, WARD_ARMOUR * 0.7);
        tether(w, "ward", e.id, o.id, 0, 0, "live", PEAL_WARD_MS);
      }
      pose(e, "peal_release", 400);
      w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "peal" });
      break;
    }
    case "cast": {
      // The ward attaches to the nearest ally it can see.
      const ally = w.enemies
        .filter((o) => o !== e && o.hp > 0 && o.archetype !== "bellringer" && o.spawnFadeMs <= 0 && !warded(w, o.id)
          && hasLineOfSight(w.room.grid, e.x, e.y, o.x, o.y))
        .sort((a, b) => dist2(a.x, a.y, e.x, e.y) - dist2(b.x, b.y, e.x, e.y))[0];
      if (ally) {
        tether(w, "ward", e.id, ally.id, 0, 0, "hold", 0);
        grantWard(ally, WARD_ARMOUR);
      }
      break;
    }
    case "windup_hook": {
      const hook = w.tethers.find((t) => t.alive && t.kind === "hook" && t.from === e.id && t.phase === "aim");
      if (hook) { hook.phase = "fly"; hook.ms = HOOK_FLY_MS; }
      pose(e, "fire", HOOK_FLY_MS);
      break;
    }
    case "anchor_cast": {
      const a = Math.atan2(seen.y - e.y, seen.x - e.x);
      const len = lineToWall(w, e.x, e.y, a, CHAIN_LENGTH);
      tether(w, "chain", e.id, -1, e.x + Math.cos(a) * len, e.y + Math.sin(a) * len, "live", CHAIN_MS, 0.5);
      break;
    }
    case "flare_windup": {
      // A ring of burning ground at once, and the gauge spent on it.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = e.x + Math.cos(a) * TILE_PX * 2;
        const y = e.y + Math.sin(a) * TILE_PX * 2;
        if (!circleHitsWall(w.room.grid, x, y, 6)) lightFire(w, x, y, "enemy", { radius: TILE_PX * 0.7, lifeMs: 2600 });
      }
      e.burnMs = 0;
      e.burnBuild = 0;
      e.burnSources = 0;
      w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "flare" });
      break;
    }
    case "lob": {
      // The elite shooter's pin shot, onto the line the player would back away along.
      const v = normalise(seen.x - e.x, seen.y - e.y);
      throwLob(w, e, seen.x + v.x * TILE_PX * 1.5, seen.y + v.y * TILE_PX * 1.5, "burst", TILE_PX * 1.4, 1, 750);
      break;
    }
    case "lob_windup":
      /*
       * The brooder throws a coal that **hatches** where it lands, rather than
       * one that burns (doc 019). The summoner's reinforcements arrive at the
       * summoner, so the player can meet them on the way in; the brooder's
       * arrive where the player is standing, so there is no ground that is
       * safely far from it. Same arc, same tell, same 700 ms of flight.
       */
      throwLob(w, e, seen.x, seen.y, e.archetype === "brooder" ? "hatch" : "fire",
        TILE_PX * 0.85, e.archetype === "brooder" ? 0 : 0.5, 700);
      break;
    case "bloom_cast": {
      // Eight seeds round where it saw the player, with two gaps to read.
      for (let i = 0; i < 8; i++) {
        if (i === 2 || i === 6) continue;
        const a = (i / 8) * Math.PI * 2;
        const x = seen.x + Math.cos(a) * TILE_PX * 1.8;
        const y = seen.y + Math.sin(a) * TILE_PX * 1.8;
        if (!circleHitsWall(w.room.grid, x, y, 4)) plantMine(w, e.id, x, y, 900);
      }
      break;
    }
    default:
      break;
  }
}

/**
 * The ranged attack of an expansion body, on its archetype's clock (called
 * from `fire` where lightning and flame are). `seen` is its perception.
 */
export function castRanged(w: World, e: Enemy, kind: string, seen: { x: number; y: number }): void {
  const toward = Math.atan2(seen.y - e.y, seen.x - e.x);
  switch (kind) {
    case "rift": {
      if (e.pose !== "") return;
      e.casts++;
      if (e.archetype === "quaker") {
        /*
         * Fissure Walk: four short cracks walking toward the player, each
         * placed ahead of the last and erupting a beat after it appears. The
         * placement is the telegraph, so they may follow the live position.
         */
        pose(e, "telegraph_walk", 700);
        const p = w.player;
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        for (let i = 0; i < 4; i++) {
          const t = Math.min(1, (0.35 + i * 0.22));
          const x = e.x + (p.x - e.x) * t;
          const y = e.y + (p.y - e.y) * t;
          castRift(w, x - Math.cos(toward) * TILE_PX * 0.75, y - Math.sin(toward) * TILE_PX * 0.75, toward, Math.min(TILE_PX * 1.5, d),
            { teleMs: 420 + i * 200, damage: 0.8 });
        }
        return;
      }
      pose(e, "telegraph", RIFT_TELE_MS);
      const len = lineToWall(w, e.x, e.y, toward, TILE_PX * 6);
      /*
       * One line, from the rifter toward where it saw you, and nothing else.
       * Every third cast used to add a second crack across the first, through
       * that point. It closed the one answer the rifter teaches, stepping
       * across the line, and since perception lags it landed where the player
       * had been: a crack at right angles to nothing, in empty floor.
       */
      castRift(w, e.x, e.y, toward, len);
      return;
    }
    case "musket": {
      if (e.pose !== "") return;
      e.casts++;
      pose(e, "musket_windup", MUSKET_WINDUP_MS);
      return;
    }
    case "ward": {
      if (e.pose !== "") return;
      if (e.archetype === "pealer") {
        pose(e, "peal_windup", PEAL_WINDUP_MS);
        return;
      }
      // One ward at a time; the ranged clock is its re-arm delay.
      if (w.tethers.some((t) => t.alive && t.kind === "ward" && t.from === e.id)) return;
      pose(e, "cast", RING_CAST_MS);
      return;
    }
    case "hook": {
      if (e.pose !== "" || w.tethers.some((t) => t.alive && t.from === e.id)) return;
      if (e.archetype === "chainer") {
        pose(e, "anchor_cast", 600);
        return;
      }
      // The chain lies on the floor along the line it will be thrown: the line is the telegraph.
      const len = lineToWall(w, e.x, e.y, toward, HOOK_LENGTH);
      tether(w, "hook", e.id, -1, e.x + Math.cos(toward) * len, e.y + Math.sin(toward) * len, "aim", HOOK_AIM_MS);
      pose(e, "windup_hook", HOOK_AIM_MS);
      w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "hook" });
      return;
    }
    case "lob": {
      if (e.pose !== "") return;
      pose(e, "lob_windup", LOB_WINDUP_MS);
      return;
    }
    case "mine": {
      if (e.archetype === "planter") {
        e.casts++;
        if (e.casts % 4 === 0 && e.pose === "") pose(e, "bloom_cast", 900);
        return;
      }
      if (minesOf(w, e.id) < MINES_PER_BODY) plantMine(w, e.id, e.x, e.y);
      return;
    }
    default:
      return;
  }
}

/** The elite turret's lightning is a rift instead: the lane, not the spot. */
export function riftLance(w: World, e: Enemy, seen: { x: number; y: number }): void {
  const a = Math.atan2(seen.y - e.y, seen.x - e.x);
  castRift(w, e.x, e.y, a, lineToWall(w, e.x, e.y, a, TILE_PX * 6));
}

/**
 * The slam's shockwave: a ring on the floor round the body that struck it.
 *
 * A zero-length rift, which is the roster's one "this ground erupts" — so it
 * is drawn, timed and resolved exactly like a delver's emergence or a
 * bellringer's toll, and the player has met the shape before. Short to grow,
 * because the blade's own windup was the warning and this is the follow
 * through; weaker than the blade, because it is the part that reaches.
 */
export const SLAM_SHOCK_RADIUS = TILE_PX * 2.3;
export function shockRing(w: World, e: Enemy): void {
  castRift(w, e.x, e.y, 0, 0, { width: SLAM_SHOCK_RADIUS * 2, teleMs: 300, damage: 0.5 });
}

/** The elite tank's chop sends a crack forward from where it lands. */
export function shockCleave(w: World, e: Enemy): void {
  const reach = TILE_PX * 1.2;
  const x = e.x + Math.cos(e.facing) * reach;
  const y = e.y + Math.sin(e.facing) * reach;
  castRift(w, x, y, e.facing, lineToWall(w, x, y, e.facing, TILE_PX * 4), { teleMs: 330, damage: 0.8 });
}

/** The elite sentinel's shot is its sight line made real: live for 20 frames, no travel time. */
export function sightBeam(w: World, e: Enemy, seen: { x: number; y: number }): void {
  const a = Math.atan2(seen.y - e.y, seen.x - e.x);
  const len = lineToWall(w, e.x, e.y, a, TILE_PX * 22);
  tether(w, "beam", e.id, -1, e.x + Math.cos(a) * len, e.y + Math.sin(a) * len, "live", 330, 1.2);
  w.events.push({ kind: "shot", x: e.x, y: e.y, what: "beam" });
}

/* --------------------------------- delver --------------------------------- */

function stepDelve(w: World, e: Enemy, dtMs: number, seen: { x: number; y: number }): void {
  e.delveMs -= dtMs;
  switch (e.delve) {
    case "surface":
      if (e.delveMs <= 0 && e.attack === "approach") {
        e.delve = "diving";
        e.delveMs = DIVE_MS;
        e.airborne = true;
        pose(e, "burrow", DIVE_MS);
      }
      return;
    case "diving":
      if (e.delveMs <= 0) {
        // The heading is locked as it goes under; the mound travels a straight line.
        const v = normalise(seen.x - e.x, seen.y - e.y);
        e.delveX = v.x;
        e.delveY = v.y;
        e.delve = "under";
        // Under for at most 1.2 s: it cannot be hit down there, and at 2 s a
        // body spent most of its cycle out of reach ("its invulnerability is
        // so long").
        e.delveMs = Math.min(DELVE_UNDER_MAX_MS, Math.max(600, (Math.hypot(seen.x - e.x, seen.y - e.y) / (e.speed * 1.4)) * 1000));
      }
      return;
    case "under": {
      const dt = dtMs / 1000;
      const r = moveSliding(w.room.grid, e, e.delveX * e.speed * 1.4 * dt, e.delveY * e.speed * 1.4 * dt, e.radius);
      e.vx = e.delveX * e.speed * 1.4;
      e.vy = e.delveY * e.speed * 1.4;
      if (e.delveMs <= 0 || (r.blockedX && r.blockedY)) {
        e.delve = "emerging";
        e.delveMs = EMERGE_MS;
        // Coming up is the opening: it can be hit from the moment it breaks
        // the surface, not only once it stands there.
        e.airborne = false;
        pose(e, "emerge", EMERGE_MS);
        // Where the mound stopped is where it erupts, fixed 36 frames ahead.
        castRift(w, e.x, e.y, 0, 0, { width: TILE_PX * 2.4, teleMs: EMERGE_MS, damage: 0.9 });
        // Breach Line: two more behind and ahead along its heading.
        if (e.archetype === "burrower") {
          for (let i = 1; i <= 2; i++) {
            const x = e.x + e.delveX * TILE_PX * 1.6 * i;
            const y = e.y + e.delveY * TILE_PX * 1.6 * i;
            if (!circleHitsWall(w.room.grid, x, y, 4))
              castRift(w, x, y, 0, 0, { width: TILE_PX * 1.8, teleMs: EMERGE_MS + i * 400, damage: 0.7 });
          }
        }
      }
      return;
    }
    case "emerging":
      if (e.delveMs <= 0) {
        e.delve = "surface";
        e.delveMs = DELVE_SURFACE_MS;
        e.airborne = false;
        e.attackCooldownMs = Math.max(e.attackCooldownMs, 500);
      }
      return;
  }
}

/** Whether a body is under the floor: it neither moves by steering nor can be touched. */
export function submerged(e: Enemy): boolean {
  return e.delve !== "surface";
}

/* ============================== world step ================================ */

/**
 * Moves every expansion entity one step and lands what it lands.
 */
export function stepAttacks(w: World, dtMs: number, hooks: AttackHooks): void {
  const p = w.player;

  for (const r of w.rifts) {
    if (!r.alive) continue;
    if (r.teleMs > 0) {
      r.teleMs -= dtMs;
      if (r.teleMs <= 0) w.events.push({ kind: "hazard_tick", x: r.x, y: r.y, what: riftName(r, "lightning", "rockfall") });
      continue;
    }
    if (r.activeMs > 0) {
      r.activeMs -= dtMs;
      if (!r.struck && riftHits(r, p.x, p.y, PLAYER_RADIUS)) {
        r.struck = true;
        hooks.hurtPlayer(p.x, p.y, riftName(r, "lightning", "rockfall"), 0, r.damage);
      }
      continue;
    }
    r.scarMs -= dtMs;
    if (r.scarMs <= 0) r.alive = false;
  }

  for (const m of w.mines) {
    if (!m.alive) continue;
    if (m.burstMs > 0) {
      m.burstMs -= dtMs;
      if (m.burstMs <= 0) m.alive = false;
      continue;
    }
    // Primed: it has been set off and is about to go; see `MINE_PRIME_MS`.
    if (m.primeMs > 0) {
      m.primeMs -= dtMs;
      if (m.primeMs <= 0) detonate(w, m, hooks);
      continue;
    }
    m.fuseMs -= dtMs;
    // A seed nobody set off goes out quietly. It burst when its fuse ran out,
    // with no warning, on whoever happened to be fighting beside it.
    if (m.fuseMs <= 0) { m.alive = false; continue; }
    if (m.inertMs > 0) { m.inertMs -= dtMs; continue; }
    // Armed: the player coming near sets it off, and so does the sword or a fire.
    const near = dist2(m.x, m.y, p.x, p.y) <= (MINE_TRIGGER + PLAYER_RADIUS) ** 2;
    const burning = w.fires.some((f) => f.alive && dist2(f.x, f.y, m.x, m.y) <= f.radius * f.radius);
    if (near || burning || swordReaches(w, m.x, m.y)) {
      m.primeMs = MINE_PRIME_MS;
      w.events.push({ kind: "telegraph", x: m.x, y: m.y, what: "mine_primed" });
    }
  }

  for (const t of w.tethers) {
    if (!t.alive) continue;
    stepTether(w, t, dtMs, hooks);
  }

  for (const l of w.lobs) {
    if (!l.alive) continue;
    l.t += dtMs / l.flightMs;
    if (l.t < 1) continue;
    l.alive = false;
    w.events.push({ kind: "hazard_tick", x: l.x1, y: l.y1, what: `lob:${l.lands}` });
    if (l.lands === "fire") lightFire(w, l.x1, l.y1, "enemy");
    // A hatching coal is a body arriving, which only the world can make.
    if (l.lands === "hatch") hooks.hatch(l.x1, l.y1, l.from);
    if (dist2(l.x1, l.y1, p.x, p.y) <= (l.radius + PLAYER_RADIUS) ** 2)
      hooks.hurtPlayer(l.x1, l.y1, `lob:${l.from}`, 0, l.damage);
  }

  for (const f of w.flames) if (f.alive) stepFlame(w, f, dtMs, hooks);

  /*
   * The travelling band. It charges where it was born — the tell — and then
   * its inner edge runs outward; the player is caught by standing in the band
   * without i-frames, and a dash across it is the answer the move is for.
   */
  for (const s of w.shockwaves) {
    if (!s.alive) continue;
    if (s.chargeMs > 0) {
      s.chargeMs -= dtMs;
      if (s.chargeMs <= 0) w.events.push({ kind: "hazard_tick", x: s.x, y: s.y, what: "shockwave" });
      continue;
    }
    s.inner += s.speed * (dtMs / 1000);
    if (s.inner > s.maxRadius) { s.alive = false; continue; }
    /*
     * Stone stops it, as it stops the rifter's crack: a band that runs
     * through a pillar and hits the player standing behind it is a hit with
     * no answer, and the pillars are the arena's own answer to the move.
     */
    // A wake the player laid cuts bodies, not them (`stepPlayerWakes` in world.ts).
    if (s.byPlayer) continue;
    if (!s.struck && !s.wake?.struck && !hooks.playerInvulnerable() && shockwaveHits(s, p.x, p.y, PLAYER_RADIUS)
      && hasLineOfSight(w.room.grid, s.x, s.y, p.x, p.y)) {
      s.struck = true;
      if (s.wake) s.wake.struck = true;
      hooks.hurtPlayer(p.x, p.y, "shockwave", 0, s.damage);
    }
  }

  /*
   * The rotating arms. The anchor is re-read from the owner every step, so a
   * limb on a body that is walking sweeps a disc that walks with it; an arm
   * whose owner is dead or gone withdraws rather than hanging in the air.
   */
  for (const a of w.arms) {
    if (!a.alive) continue;
    const owner = w.enemies.find((e) => e.id === a.owner);
    if (!owner || owner.hp <= 0) { a.alive = false; continue; }
    a.x = owner.x;
    a.y = owner.y;
    if (a.hitCooldownMs > 0) a.hitCooldownMs -= dtMs;
    if (a.teleMs > 0) {
      a.teleMs -= dtMs;
      if (a.teleMs <= 0) w.events.push({ kind: "hazard_tick", x: a.x, y: a.y, what: "arm" });
      continue;
    }
    a.activeMs -= dtMs;
    if (a.activeMs <= 0) { a.alive = false; continue; }
    a.angle += a.spin * (dtMs / 1000);
    if (a.hitCooldownMs <= 0 && !hooks.playerInvulnerable() && armHits(a, p.x, p.y, PLAYER_RADIUS)) {
      a.hitCooldownMs = ARM_HIT_COOLDOWN_MS;
      hooks.hurtPlayer(p.x, p.y, "arm", 0, a.damage);
    }
  }

  /*
   * The bell's ringing: it hurries the bodies standing in it, and nothing
   * else. `hastedMs` is topped up rather than set, so a body leaving the
   * patch coasts out of the cue instead of snapping out of it.
   */
  for (const f of w.hasteFields) {
    if (!f.alive) continue;
    f.lifeMs -= dtMs;
    if (f.lifeMs <= 0) { f.alive = false; continue; }
    for (const e of w.enemies) {
      if (e.hp <= 0 || baseArchetype(e.archetype) === "bellringer") continue;
      if (dist2(f.x, f.y, e.x, e.y) <= f.radius * f.radius) e.hastedMs = Math.max(e.hastedMs, HASTE_CARRY_MS);
    }
  }

  w.rifts = w.rifts.filter((r) => r.alive);
  w.shockwaves = w.shockwaves.filter((s) => s.alive);
  w.arms = w.arms.filter((a) => a.alive);
  w.mines = w.mines.filter((m) => m.alive);
  w.tethers = w.tethers.filter((t) => t.alive);
  w.lobs = w.lobs.filter((l) => l.alive);
  w.hasteFields = w.hasteFields.filter((f) => f.alive);
  w.flames = w.flames.filter((f) => f.alive);
}

/** Whether the player's live swing reaches a point: a mine is destructible. */
function swordReaches(w: World, x: number, y: number): boolean {
  const s = w.swing;
  if (!s.active) return false;
  const dx = x - s.x;
  const dy = y - s.y;
  if (dx * dx + dy * dy > s.reach * s.reach) return false;
  let da = Math.atan2(dy, dx) - s.angle;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  return Math.abs(da) <= s.halfArc + 0.2;
}

/** Half of the arc a body counts as its front. */
const FRONT_HALF_ARC = (60 * Math.PI) / 180;

/** Whether a point is inside a body's front arc. */
export function inFront(e: Enemy, x: number, y: number): boolean {
  let da = Math.atan2(y - e.y, x - e.x) - e.facing;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  return Math.abs(da) <= FRONT_HALF_ARC;
}

function stepTether(w: World, t: Tether, dtMs: number, hooks: AttackHooks): void {
  const p = w.player;
  const owner = byId(w, t.from);
  const ends = tetherEnds(w, t);
  if (!owner || !ends) {
    // Either end gone: the line goes, and a ward takes its armour with it.
    t.alive = false;
    if (t.kind === "ward" && t.to >= 0) { const b = byId(w, t.to); if (b) stripWard(b); }
    return;
  }
  const onLine = segmentDistance(p.x, p.y, ends.x0, ends.y0, ends.x1, ends.y1) <= PLAYER_RADIUS + 4;
  switch (t.kind) {
    case "ward": {
      if (t.phase === "live") {
        t.ms -= dtMs;
        if (t.ms <= 0) { t.alive = false; const b = byId(w, t.to); if (b) stripWard(b); }
        return;
      }
      // The pulse the toll sent down the line, running out to the ally.
      if (t.pulseMs > 0) t.pulseMs = Math.max(0, t.pulseMs - dtMs);
      // Standing in the line cuts it (research §2.2): the line is a place the player is invited into.
      t.cutMs = onLine ? t.cutMs + dtMs : Math.max(0, t.cutMs - dtMs * 0.5);
      if (t.cutMs >= WARD_CUT_MS) {
        t.alive = false;
        const b = byId(w, t.to);
        if (b) stripWard(b);
        hooks.knockDown(owner, WARD_CUT_STAGGER_MS);
        w.events.push({ kind: "enemy_hit", x: (ends.x0 + ends.x1) / 2, y: (ends.y0 + ends.y1) / 2, what: "tether_cut" });
      }
      return;
    }
    case "hook": {
      t.ms -= dtMs;
      if (t.phase === "aim") {
        if (t.ms <= 0) { t.phase = "fly"; t.ms = HOOK_FLY_MS; }
        return;
      }
      if (t.phase === "fly") {
        // The head travels out along the drawn line; the player on it is caught.
        const k = 1 - Math.max(0, t.ms) / HOOK_FLY_MS;
        const hx = ends.x0 + (ends.x1 - ends.x0) * k;
        const hy = ends.y0 + (ends.y1 - ends.y0) * k;
        if (dist2(hx, hy, p.x, p.y) <= (PLAYER_RADIUS + 8) ** 2 && p.invulnMs <= 0 && p.dashIframeMs <= 0) {
          t.phase = "drag";
          t.ms = DRAG_MS;
          const v = normalise(owner.x - p.x, owner.y - p.y);
          const pull = Math.max(0, Math.hypot(owner.x - p.x, owner.y - p.y) - owner.radius - TILE_PX);
          p.dragMs = DRAG_MS;
          p.dragX = p.x + v.x * Math.min(pull, TILE_PX * 4);
          p.dragY = p.y + v.y * Math.min(pull, TILE_PX * 4);
          /*
           * The king's chain costs nothing and hands them to his sword: all
           * the way in, to the ground in front of him where his cuts go out
           * (doc 020; the slash is wound up as they land, in world.ts). A
           * hurt here would also have given them the mercy frames the cut
           * then fell inside.
           */
          if (owner.archetype === "boss") {
            const stand = owner.radius + PLAYER_RADIUS + 18;
            const front = !circleHitsWall(w.room.grid, owner.x, owner.y + stand, PLAYER_RADIUS);
            p.dragX = front ? owner.x : owner.x - v.x * stand;
            p.dragY = front ? owner.y + stand : owner.y - v.y * stand;
            return;
          }
          // The snarecaster's is a tug.
          hooks.hurtPlayer(owner.x, owner.y, "hook", 200, 0.5 * owner.damageMult);
          /*
           * **The lash** (doc 005, the snarecaster). A grab that reels the
           * player in and then does nothing is a grab that helped them: it
           * put a melee player exactly where they wanted to be, for half a
           * heart. So the chain comes round the caster's own feet.
           *
           * The circle is cast *now*, with the drag inside its growth, so the
           * player is watching it close while they are being pulled into it —
           * `LASH_AFTER_MS` of it is left once they land, which is the
           * reaction floor plus a dash. Answering it is the dash the hook
           * should have been dodged with in the first place, one beat late.
           */
          if (baseArchetype(owner.archetype) === "snarecaster") {
            pose(owner, "lash_windup", DRAG_MS + LASH_AFTER_MS);
            castRift(w, owner.x, owner.y, 0, 0,
              { width: LASH_RADIUS * 2, teleMs: DRAG_MS + LASH_AFTER_MS, damage: 0.8 });
          }
          return;
        }
        if (t.ms <= 0) {
          // A miss: the whip-back cuts behind it a beat later (research §2.4).
          t.phase = "hold";
          t.ms = 400;
        }
        return;
      }
      if (t.phase === "hold") {
        if (t.ms <= 0) {
          t.alive = false;
          const behind = Math.hypot(p.x - owner.x, p.y - owner.y) < TILE_PX * 2.4 && !inFront({ ...owner, facing: Math.atan2(t.y1 - owner.y, t.x1 - owner.x) }, p.x, p.y);
          if (behind) hooks.hurtPlayer(owner.x, owner.y, "whip", 0, 0.7);
        }
        return;
      }
      if (t.phase === "drag" && t.ms <= 0) t.alive = false;
      return;
    }
    case "chain":
    case "beam": {
      t.ms -= dtMs;
      if (t.ms <= 0) { t.alive = false; return; }
      if (onLine) hooks.hurtPlayer(p.x, p.y, t.kind, 0, t.damage);
      return;
    }
  }
}


/**
 * What a body's death does to the expansion's entities: a ringer's wards go
 * with it (research §7.1, Hades' Voidstone), a sower sheds its seeds armed,
 * and a snarecaster's chain drops.
 */
export function onExpansionDeath(w: World, e: Enemy): void {
  for (const t of w.tethers) {
    if (!t.alive || (t.from !== e.id && t.to !== e.id)) continue;
    t.alive = false;
    if (t.kind === "ward" && t.to >= 0) { const b = byId(w, t.to); if (b) stripWard(b); }
  }
  if (baseArchetype(e.archetype) === "sower") {
    /*
     * Its seeds scatter as it bursts: flung out past arm's length, and slow
     * to arm. They fell at 14 px and armed at once, then after the ordinary
     * delay — either way under a player who had just killed it with the
     * sword, and measured, the largest single cause of hearts lost.
     */
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + e.id;
      const r = DEATH_SEED_PX + (i % 2) * 8;
      const x = e.x + Math.cos(a) * r;
      const y = e.y + Math.sin(a) * r;
      if (!circleHitsWall(w.room.grid, x, y, 4)) plantMine(w, e.id, x, y, DEATH_SEED_INERT_MS, "sower");
    }
  }
}

/** Whether the player is being dragged this step, and where to. */
export function dragStep(w: World, dtMs: number): boolean {
  const p = w.player;
  if (p.dragMs <= 0) return false;
  p.dragMs -= dtMs;
  const k = Math.min(1, dtMs / Math.max(dtMs, p.dragMs + dtMs));
  const dx = (p.dragX - p.x) * k;
  const dy = (p.dragY - p.y) * k;
  moveSliding(w.room.grid, p, dx, dy, PLAYER_RADIUS);
  return true;
}
