/**
 * **The king's first audience: the drop-in** (doc 022, "The drop-in").
 *
 * Room 5 opens as an ordinary fight. Once the player has killed one body, or
 * after `AUDIENCE_TRIGGER_MS`, the roof gives:
 *
 * 1. **The rumble** (`AUDIENCE_RUMBLE_MS`): the room shakes, every body staggers
 *    where it stands and is shoved a step away from the player, and the room's
 *    later waves are never called.
 * 2. **The stones**: each body gets a falling stone of its own, the meteor's
 *    rock, marked on it and landing `BOSS_METEOR_MARK_MS` later, a few a beat.
 *    Or, on a coin flip as they begin, every one of them is a bolt of his
 *    storm instead (`AudienceState.bolts`): the whole room one way, never
 *    mixed. No mark is drawn over the player. The stone kills the body under it, and
 *    out of the bodies come the hearts: what the player is missing, pulled to
 *    them, and `CRASH_HEARTS_SPARE` more that wait on the floor.
 * 3. **The landing**: his mark far across the room (`KING_DROP_MIN_PX`), and he
 *    comes down on it hurting nobody (`beginKingEntrance`).
 *
 * Every death has a cause the player can see, and none of them reaches the
 * player: a body two steps away dying while the player stands untouched, or a
 * band that kills bodies and passes through the player, would ask "why not
 * me?" with no answer on screen. So the room is cleared by stones, one each.
 */
import { BEAT_MS } from "./beat.ts";
import { castRift } from "./attacks.ts";
import { makeKing } from "./enemy.ts";
import { drop } from "./pickups.ts";
import { GRID_W, TILE_PX, Tile } from "../types.ts";
import { MAX_HEARTS, PLAYER_RADIUS } from "./types.ts";
import type { Enemy, World } from "./types.ts";
import { BOSS_METEOR_LAND_PX, BOSS_METEOR_MARK_MS, beginKingEntrance, hazardCells } from "./world.ts";

/** The opening stretch, at most: the roof gives this long after the room opens if no body has died. */
export const AUDIENCE_TRIGGER_MS = 5000;
/** Bodies the player kills before the roof gives: one, which is enough to make room 5 look like room 4. */
export const AUDIENCE_TRIGGER_KILLS = 1;
/** The rumble before the first stone is marked: the room shaking, the bodies reeling, the view pulling out. */
export const AUDIENCE_RUMBLE_MS = 1500;
/** Stones marked together, a beat apart: the room comes down a few bodies at a time. */
export const AUDIENCE_STONES_PER_BEAT = 3;
/** Hearts left on the floor past what fills the bar: the fight's reserve (doc 022, step 4). */
export const CRASH_HEARTS_SPARE = 3;
/** His landing mark's least distance from the player: eight tiles, and as far as the floor allows. */
export const KING_DROP_MIN_PX = TILE_PX * 8;
/** How far a body is shoved away from the player at the rumble: about a step (knockback is a decaying speed). */
const RUMBLE_SHOVE_SPEED = 360;
/** The meteor's rock, drawn and sized as the fall into phase III draws it. */
const STONE_RADIUS = 22;
/** What a stone costs anyone under it — the player too, since a rock is a rock — never the last of the bar. */
const STONE_DAMAGE = 0.5;
/** The rumble's held tremor (trauma is squared by the camera: a steady shake, not a blow). */
const RUMBLE_TRAUMA = 0.6;
/** How far his mark stays off the side and bottom walls, and off the top one, where his body rises, in cells. */
const DROP_SIDE_MARGIN = 3;
const DROP_TOP_MARGIN = 4;
/** A beat after the last stone before his mark goes down. */
const DROP_AFTER_STONES_MS = BEAT_MS;

export type AudiencePhase = "setup" | "rumble" | "stones" | "fight" | "done";

export interface AudienceStone {
  /** The body it falls on (`Enemy.id`). */
  readonly target: number;
  /** When it is marked, and when it lands, on the audience's own clock. */
  readonly markAt: number;
  readonly landAt: number;
  x: number;
  y: number;
  marked: boolean;
  landed: boolean;
}

export interface AudienceState {
  phase: AudiencePhase;
  /** Time since the room opened. */
  ms: number;
  /** When the current phase began, on `ms`. */
  phaseAt: number;
  /** Bodies killed before the roof gave. */
  kills: number;
  stones: AudienceStone[];
  /** Whether the room is cleared by bolts out of the sky rather than stones out of the roof: all of it, one way. */
  bolts: boolean;
  /** Hearts still to come out of the bodies: the ones that fill the bar first, then the spare. */
  fillLeft: number;
  spareLeft: number;
  /** The king, once he is in the room. */
  king: number | null;
}

export function makeAudience(): AudienceState {
  return { phase: "setup", ms: 0, phaseAt: 0, kills: 0, stones: [], bolts: false, fillLeft: 0, spareLeft: 0, king: null };
}

/** Counts a body killed while the room is still pretending to be room 4. */
export function audienceKill(w: World): void {
  if (w.audience?.phase === "setup") w.audience.kills++;
}

/** Whether the room's own bodies still fight: not once the roof has started to give. */
export function audienceHolds(w: World): boolean {
  const a = w.audience;
  return !!a && (a.phase === "rumble" || a.phase === "stones");
}

export function stepAudience(w: World, dtMs: number): void {
  const a = w.audience;
  if (!a || a.phase === "done") return;
  a.ms += dtMs;
  const since = a.ms - a.phaseAt;
  switch (a.phase) {
    case "setup":
      if (a.kills >= AUDIENCE_TRIGGER_KILLS || a.ms >= AUDIENCE_TRIGGER_MS) beginRumble(w, a);
      return;
    case "rumble":
      w.trauma = Math.max(w.trauma, RUMBLE_TRAUMA);
      holdBodies(w);
      if (since >= AUDIENCE_RUMBLE_MS) beginStones(w, a);
      return;
    case "stones":
      holdBodies(w);
      stepStones(w, a);
      if (a.stones.every((s) => s.landed) && a.ms >= lastLanding(a) + DROP_AFTER_STONES_MS) beginDrop(w, a);
      return;
    case "fight":
      keepSpareOffHazards(w);
      if (!w.enemies.some((e) => e.id === a.king)) finish(w, a);
      return;
  }
}

function to(a: AudienceState, phase: AudiencePhase): void {
  a.phase = phase;
  a.phaseAt = a.ms;
}

function beginRumble(w: World, a: AudienceState): void {
  to(a, "rumble");
  // The room's later waves never come: these bodies are there to be crushed.
  w.pendingWaves.length = 0;
  // Nothing the bodies had already thrown lands on the player now.
  for (const b of w.enemyBullets) if (b.alive) {
    b.alive = false;
    w.events.push({ kind: "bullet_spent", x: b.x, y: b.y, what: b.from });
  }
  w.mines = [];
  w.lobs = [];
  w.rifts = [];
  w.shockwaves = [];
  w.arms = [];
  const p = w.player;
  for (const e of w.enemies) {
    if (e.hp <= 0) continue;
    const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
    e.knockX = (dx / d) * RUMBLE_SHOVE_SPEED;
    e.knockY = (dy / d) * RUMBLE_SHOVE_SPEED;
  }
  holdBodies(w);
  w.events.push({ kind: "telegraph", x: p.x, y: p.y, what: "audience_rumble" });
}

/** Every body reels where it stands until its stone lands: no turn, no shot, no walk. */
function holdBodies(w: World): void {
  for (const e of w.enemies) {
    if (e.archetype === "boss" || e.hp <= 0) continue;
    e.staggerMs = Math.max(e.staggerMs, 500);
    e.stunMs = Math.max(e.stunMs, 500);
    e.attack = "approach";
    e.attackMs = 0;
    e.swing.active = false;
    e.swing.trackingMs = 0;
    e.telegraphMs = 0;
    e.awake = true;
  }
}

function beginStones(w: World, a: AudienceState): void {
  to(a, "stones");
  // Stones or bolts, the whole room the same way: a coin flip each audience.
  a.bolts = w.rng.next() < 0.5;
  // The farthest first, so the room comes down toward the player and the ones beside them go last.
  const p = w.player;
  const bodies = w.enemies
    .filter((e) => e.archetype !== "boss" && e.hp > 0)
    .sort((x, y) => Math.hypot(y.x - p.x, y.y - p.y) - Math.hypot(x.x - p.x, x.y - p.y));
  a.stones = bodies.map((e, i) => {
    const markAt = a.ms + Math.floor(i / AUDIENCE_STONES_PER_BEAT) * BEAT_MS;
    return { target: e.id, markAt, landAt: markAt + BOSS_METEOR_MARK_MS, x: e.x, y: e.y, marked: false, landed: false };
  });
  // What fills the bar, and the reserve on top (`CRASH_HEARTS_SPARE`).
  const max = MAX_HEARTS + p.mods.maxHearts;
  a.fillLeft = Math.max(0, Math.ceil(max - p.hearts - 1e-6));
  a.spareLeft = CRASH_HEARTS_SPARE;
  w.events.push({ kind: "telegraph", x: p.x, y: p.y, what: "audience_stones" });
}

function lastLanding(a: AudienceState): number {
  return a.stones.reduce((t, s) => Math.max(t, s.landAt), a.phaseAt);
}

/**
 * Where a body's stone is marked: on the body, unless that disc would reach
 * the player, when it is moved to the body's far side — still over the body,
 * clear of the player.
 */
function stoneSpot(w: World, e: Enemy): { x: number; y: number } {
  const p = w.player;
  const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
  const clear = STONE_RADIUS + PLAYER_RADIUS + 4;
  if (d >= clear) return { x: e.x, y: e.y };
  const push = Math.min(clear - d, STONE_RADIUS + e.radius - 2);
  return { x: e.x + (dx / d) * push, y: e.y + (dy / d) * push };
}

function stepStones(w: World, a: AudienceState): void {
  const p = w.player;
  for (const s of a.stones) {
    const body = w.enemies.find((e) => e.id === s.target && e.hp > 0);
    if (!s.marked && a.ms >= s.markAt) {
      s.marked = true;
      if (body) {
        const at = stoneSpot(w, body);
        s.x = at.x;
        s.y = at.y;
      }
      castRift(w, s.x, s.y, 0, 0, {
        width: STONE_RADIUS * 2, teleMs: s.landAt - a.ms,
        ...(a.bolts ? { bolt: true } : { rock: true }),
        // A rock is a rock and a bolt a bolt, but neither ever takes the last of the bar.
        damage: Math.min(STONE_DAMAGE, Math.max(0, p.hearts - STONE_DAMAGE)),
      });
    }
    if (s.marked && !s.landed && a.ms >= s.landAt) {
      s.landed = true;
      const x = body?.x ?? s.x, y = body?.y ?? s.y;
      if (body) crush(w, body);
      spillHearts(w, a, x, y, a.stones.filter((o) => !o.landed).length + 1);
    }
  }
}

/**
 * The stone kills the body under it, and nothing a kill by the player pays:
 * no experience, no loot, no death burst. It is taken off the floor as a death
 * is drawn, and its hearts are the audience's own (`spillHearts`).
 */
function crush(w: World, e: Enemy): void {
  e.gone = true;
  e.summoned = true;
  w.events.push({ kind: "enemy_killed", x: e.x, y: e.y, what: e.archetype, facing: e.facing });
}

/**
 * Hearts out of a crushed body: its share of what is still to come, spread
 * over the stones left. The first to come fill the bar and fly to the player;
 * the last are the spare, and wait on the floor.
 */
function spillHearts(w: World, a: AudienceState, x: number, y: number, stonesLeft: number): void {
  const total = a.fillLeft + a.spareLeft;
  const n = stonesLeft <= 1 ? total : Math.ceil(total / stonesLeft);
  for (let i = 0; i < n; i++) {
    if (a.fillLeft > 0) {
      a.fillLeft--;
      const h = drop(w.pickups, "heart", x, y, w.rng);
      h.value = 0;
      h.homing = true;
    } else if (a.spareLeft > 0) {
      a.spareLeft--;
      const h = drop(w.pickups, "heart", x, y, w.rng);
      h.value = 0;
      h.reserve = true;
    }
  }
}

function beginDrop(w: World, a: AudienceState): void {
  to(a, "fight");
  // A room whose bodies were all dead before the roof gave still pays its hearts.
  if (a.fillLeft + a.spareLeft > 0) spillHearts(w, a, w.player.x, w.player.y, 1);
  const at = dropSpot(w);
  const king = makeKing(w.nextEnemyId++, at.x, at.y, "audience");
  beginKingEntrance(king, at.x, at.y);
  w.enemies.push(king);
  a.king = king.id;
  w.awaitingBoss = false;
  w.cleared = false;
  w.events.push({ kind: "telegraph", x: at.x, y: at.y, what: "audience_drop" });
}

/**
 * **His mark: across the room from the player** (doc 022, step 3). The point
 * opposite the player through the room's centre, moved to the nearest cell
 * that is at least `KING_DROP_MIN_PX` from the player, floor with floor round
 * it, off every floor hazard and clear of every standing prop — and held off
 * the walls, so a body four tiles tall lands whole inside the room and clear
 * of the HUD over its top edge rather than in a corner under the minimap. A
 * room too small for the least distance gives its farthest such cell.
 */
export function dropSpot(w: World): { x: number; y: number } {
  const ext = w.room.extent, grid = w.room.grid, p = w.player;
  const hazards = hazardCells(w);
  const floor = (x: number, y: number): boolean => grid[y * GRID_W + x] === Tile.Floor && !hazards.has(y * GRID_W + x);
  const propClear = TILE_PX * 2 + BOSS_METEOR_LAND_PX * 0.5;
  const cx = (ext.w / 2) * TILE_PX, cy = (ext.h / 2) * TILE_PX;
  const tx = 2 * cx - p.x, ty = 2 * cy - p.y;
  let best: { x: number; y: number; score: number } | null = null;
  let farthest: { x: number; y: number; d: number } | null = null;
  for (let gy = DROP_TOP_MARGIN; gy < ext.h - DROP_SIDE_MARGIN; gy++)
    for (let gx = DROP_SIDE_MARGIN; gx < ext.w - DROP_SIDE_MARGIN; gx++) {
      let open = true;
      for (let dy = -1; dy <= 1 && open; dy++) for (let dx = -1; dx <= 1 && open; dx++) open = floor(gx + dx, gy + dy);
      if (!open) continue;
      const x = (gx + 0.5) * TILE_PX, y = (gy + 0.5) * TILE_PX;
      // Clear of the braziers, which are the fight's cover; a pot under the mark is smashed by the landing.
      if (w.props.some((q) => q.hp > 0 && q.kind === "brazier" && Math.hypot(q.x - x, q.y - y) < propClear)) continue;
      const d = Math.hypot(x - p.x, y - p.y);
      if (!farthest || d > farthest.d) farthest = { x, y, d };
      if (d < KING_DROP_MIN_PX) continue;
      const score = Math.hypot(x - tx, y - ty) + w.rng.next() * TILE_PX;
      if (!best || score < best.score) best = { x, y, score };
    }
  return best ?? farthest ?? { x: cx, y: cy };
}

/** A spare heart never lies in a floor hazard: a reserve the player has to be hurt to reach is no reserve. */
function keepSpareOffHazards(w: World): void {
  const hazards = hazardCells(w);
  if (hazards.size === 0) return;
  for (const h of w.pickups) {
    if (!h.alive || !h.reserve || h.vx !== 0 || h.vy !== 0) continue;
    const gx = Math.floor(h.x / TILE_PX), gy = Math.floor(h.y / TILE_PX);
    if (!hazards.has(gy * GRID_W + gx)) continue;
    for (let r = 1; r < 8; r++) {
      let moved = false;
      for (let dy = -r; dy <= r && !moved; dy++)
        for (let dx = -r; dx <= r && !moved; dx++) {
          const cx = gx + dx, cy = gy + dy, c = cy * GRID_W + cx;
          if (cx < 1 || cy < 1 || w.room.grid[c] !== Tile.Floor || hazards.has(c)) continue;
          h.x = (cx + 0.5) * TILE_PX;
          h.y = (cy + 0.5) * TILE_PX;
          moved = true;
        }
      if (moved) break;
    }
  }
}

/** He has gone: what is left of the reserve comes home with the room's coins. */
function finish(w: World, a: AudienceState): void {
  to(a, "done");
  for (const h of w.pickups) if (h.alive && h.reserve) { h.reserve = false; h.homing = true; }
}
