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
import { PLAYER_RADIUS } from "./types.ts";
import type { Enemy, Flame, Lob, Mine, Rift, Tether, World } from "./types.ts";
import { circleHitsWall, dist2, hasLineOfSight, moveSliding, normalise } from "./collide.ts";
import { lightFire } from "./fire.ts";

/** What the world lends this module to land damage with. */
export interface AttackHooks {
  hurtPlayer(x: number, y: number, cause: string, stunMs: number, hearts: number): void;
  /** Feeds the player's burn gauge, as standing in fire does. */
  burnPlayer(amount: number): void;
  /** Staggers a body even if armour would refuse it: a cut tether knocks its ringer down. */
  knockDown(e: Enemy, ms: number): void;
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
  opts: { width?: number; teleMs?: number; damage?: number } = {},
): Rift {
  const r: Rift = {
    alive: true, x, y, angle, length,
    width: opts.width ?? TILE_PX * 0.9,
    teleMs: opts.teleMs ?? RIFT_TELE_MS, teleMaxMs: opts.teleMs ?? RIFT_TELE_MS,
    activeMs: RIFT_ACTIVE_MS, scarMs: RIFT_SCAR_MS,
    damage: opts.damage ?? 1, struck: false,
  };
  w.rifts.push(r);
  w.events.push({ kind: "telegraph", x, y, what: length > 0 ? "rift" : "burst" });
  return r;
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

/** How far a rift reaches along its line before stone stops it. */
function lineToWall(w: World, x: number, y: number, angle: number, max: number): number {
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
const MINE_BURST_MS = 300;

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
  const t: Tether = { alive: true, kind, from, to, x1, y1, phase, ms, cutMs: 0, damage };
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

function stripWard(e: Enemy): void {
  if (e.wardArmour <= 0) return;
  e.armour = Math.max(0, e.armour - e.wardArmour);
  e.wardArmour = 0;
}

/** Whether a body already carries a ward from any tether. */
function warded(w: World, id: number): boolean {
  return w.tethers.some((t) => t.alive && t.kind === "ward" && t.to === id);
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
  "musket_windup", "musket_fire", "musket_second", "musket_reload", "cast", "field", "burst", "peal_windup", "windup_hook", "anchor_cast",
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
/** How long the gout stays on screen, rolling out and then guttering. */
export const FLAME_LIFE_MS = 900;
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
const FIELD_CAST_MS = 500;
const SLOW_FIELD_MS = 4000;
const SLOW_FIELD_RADIUS = TILE_PX * 2.5;
const PEAL_WINDUP_MS = 1100;
const PEAL_RADIUS = TILE_PX * 4;
const PEAL_WARD_MS = 4000;
const ALONE_MS = 1500;
const BURST_MS = 800;
const HOOK_AIM_MS = 730;
const HOOK_FLY_MS = 330;
const HOOK_LENGTH = TILE_PX * 6;
const DRAG_MS = 520;
const CHAIN_MS = 5000;
const CHAIN_LENGTH = TILE_PX * 5;
const DELVE_SURFACE_MS = 2600;
const DIVE_MS = 500;
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
  const elite = isElite(e);
  const free = e.poseMs <= 0 && e.attack === "approach";

  switch (e.archetype) {
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
      if (free && e.moveMs <= 0 && !elite) {
        pose(e, "field", FIELD_CAST_MS);
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
      if (elite && e.burnBuild >= 0.95 && e.pose === "") pose(e, "flare_windup", FLARE_MS);
      break;
    }
    case "shooter": {
      // Pin Shot: onto the retreat line, 1.5 tiles behind where it saw the player.
      if (elite && free && e.moveMs <= 0 && gap > 90) {
        pose(e, "lob", LOB_WINDUP_MS);
        e.moveMs = 5200;
      }
      break;
    }
    case "orbiter": {
      // Seedwake: its own path is where the seeds are.
      if (elite && e.moveMs <= 0) {
        if (minesOf(w, e.id) < MINES_PER_BODY) plantMine(w, e.id, e.x, e.y);
        e.moveMs = 1600;
      }
      break;
    }
    case "summoner": {
      // Ward Tether: its newest minion, armoured while the line holds.
      if (elite && e.moveMs <= 0 && !w.tethers.some((t) => t.alive && t.from === e.id)) {
        const minion = w.enemies.filter((o) => o.hp > 0 && o.archetype === "rusher" && o.spawnFadeMs <= 0 && !warded(w, o.id))
          .sort((a, b) => b.id - a.id)[0];
        if (minion) {
          tether(w, "ward", e.id, minion.id, 0, 0, "hold", 0);
          grantWard(minion, WARD_ARMOUR);
        }
        e.moveMs = 1500;
      }
      break;
    }
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
      pose(e, isElite(e) && e.casts % 2 === 1 ? "musket_second" : "musket_fire", MUSKET_FIRE_MS);
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
      w.slowFields.push({ alive: true, x: e.x, y: e.y, radius: SLOW_FIELD_RADIUS, lifeMs: SLOW_FIELD_MS, maxLifeMs: SLOW_FIELD_MS });
      break;
    case "burst":
      // The ring it telegraphed has gone off; the ringer goes with it.
      e.hp = 0;
      break;
    case "peal_windup": {
      for (const o of w.enemies) {
        if (o === e || o.hp <= 0 || o.archetype === "bellringer") continue;
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
      throwLob(w, e, seen.x, seen.y, "fire", TILE_PX * 0.85, 0.5, 700);
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
  const elite = isElite(e);
  const toward = Math.atan2(seen.y - e.y, seen.x - e.x);
  switch (kind) {
    case "rift": {
      if (e.pose !== "") return;
      e.casts++;
      if (elite) {
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
      castRift(w, e.x, e.y, toward, len);
      // Every third is a cross: the same line and one across it, through where it saw you.
      if (e.casts % 3 === 0) {
        const across = toward + Math.PI / 2;
        castRift(w, seen.x - Math.cos(across) * TILE_PX * 2.5, seen.y - Math.sin(across) * TILE_PX * 2.5, across, TILE_PX * 5);
      }
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
      if (elite) {
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
      if (elite) {
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
      if (elite) {
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
        e.delveMs = Math.min(2000, Math.max(900, (Math.hypot(seen.x - e.x, seen.y - e.y) / (e.speed * 1.4)) * 1000));
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
        pose(e, "emerge", EMERGE_MS);
        // Where the mound stopped is where it erupts, fixed 36 frames ahead.
        castRift(w, e.x, e.y, 0, 0, { width: TILE_PX * 2.4, teleMs: EMERGE_MS, damage: 0.9 });
        // Breach Line: two more behind and ahead along its heading.
        if (isElite(e)) {
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
      if (r.teleMs <= 0) w.events.push({ kind: "hazard_tick", x: r.x, y: r.y, what: r.length > 0 ? "rift" : "burst" });
      continue;
    }
    if (r.activeMs > 0) {
      r.activeMs -= dtMs;
      if (!r.struck && riftHits(r, p.x, p.y, PLAYER_RADIUS)) {
        r.struck = true;
        hooks.hurtPlayer(p.x, p.y, r.length > 0 ? "rift" : "burst", 0, r.damage);
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
    if (dist2(l.x1, l.y1, p.x, p.y) <= (l.radius + PLAYER_RADIUS) ** 2)
      hooks.hurtPlayer(l.x1, l.y1, `lob:${l.from}`, 0, l.damage);
  }

  p.slowed = false;
  for (const f of w.flames) if (f.alive) stepFlame(w, f, dtMs, hooks);

  for (const f of w.slowFields) {
    if (!f.alive) continue;
    f.lifeMs -= dtMs;
    if (f.lifeMs <= 0) { f.alive = false; continue; }
    if (dist2(f.x, f.y, p.x, p.y) <= f.radius * f.radius) p.slowed = true;
  }

  w.rifts = w.rifts.filter((r) => r.alive);
  w.mines = w.mines.filter((m) => m.alive);
  w.tethers = w.tethers.filter((t) => t.alive);
  w.lobs = w.lobs.filter((l) => l.alive);
  w.slowFields = w.slowFields.filter((f) => f.alive);
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
          hooks.hurtPlayer(owner.x, owner.y, "hook", 200, 0.5);
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
  if (e.archetype === "sower") {
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
