/**
 * **A room objective in play** (doc 025): the world's half of
 * `run/objectives.ts`. While it runs the room keeps sending bodies — its own
 * waves again, a beat apart — and it is not clear however empty it stands;
 * when it is met, whatever still stands falls and the room clears.
 */
import { makeEnemy } from "./enemy.ts";
import type { Enemy, World } from "./types.ts";
import { GRID_W, TILE_PX, Tile } from "../types.ts";
import type { EnemyId } from "../types.ts";
import { rampFor } from "../encounters/ramp.ts";
import type { RoomObjective } from "../run/objectives.ts";

/**
 * **How long a hold lasts**, by how deep the room is: long enough to make
 * surviving, rather than clearing, the room's focus — 42 s once the run is
 * deep, and less early on, where 42 s against a starter build was the
 * longest room of the run by far. It also ends early for a player killing
 * fast (`HOLD_QUOTA`), so the length follows the build as well as the floor.
 */
export const HOLD_MS = 42_000;
export const HOLD_MS_EARLY = 24_000;
/** The rooms the hold's length is drawn between: the first a hold can be, and where it reaches its full length. */
const OBJECTIVE_EARLY_ROOM = 3;
const OBJECTIVE_FULL_ROOM = 12;
/**
 * A hold is also met by killing this many times the room's own roster, once
 * half its clock has run: a build that clears the refills as they come is
 * not kept waiting on the timer.
 */
export const HOLD_QUOTA = 2;
const depth = (roomIndex: number) =>
  Math.max(0, Math.min(1, (roomIndex - OBJECTIVE_EARLY_ROOM) / (OBJECTIVE_FULL_ROOM - OBJECTIVE_EARLY_ROOM)));
/** A hold's clock in room `roomIndex`, ms. */
export function holdMsFor(roomIndex: number): number {
  return Math.round(HOLD_MS_EARLY + (HOLD_MS - HOLD_MS_EARLY) * depth(roomIndex));
}
/** Time to read the objective, targets and arena before anything may attack. */
export const OBJECTIVE_ENTRY_GRACE_MS = 3000;
/** How many emplacements a destroy room stands, at its deepest; three early, four in the middle (`destroyTargetsFor`). */
export const DESTROY_TARGETS = 5;
export function destroyTargetsFor(roomIndex: number): number {
  return depth(roomIndex) < 0.34 ? 3 : depth(roomIndex) < 0.67 ? 4 : DESTROY_TARGETS;
}
/**
 * **What they are**: every kind of emplacement the roster has, so the room
 * asks four answers at once — step off the lightning's mark, stay off the
 * beacon's burning ground, step out of the sentinel's lane, be out of the
 * watcher's line before it lights. Each kind stands once before any stands
 * twice.
 */
export const DESTROY_KINDS: readonly EnemyId[] = ["turret", "beacon", "sentinel", "watcher"];
/** How much sturdier a target is than the same body in an ordinary room: each one is a thing to break, not a swing. Less early. */
export const DESTROY_TARGET_HP = 2;
const DESTROY_TARGET_HP_EARLY = 1.4;
export function destroyHpFor(roomIndex: number): number {
  return DESTROY_TARGET_HP_EARLY + (DESTROY_TARGET_HP - DESTROY_TARGET_HP_EARLY) * depth(roomIndex);
}
/** How soon after the room's waves are spent it sends them again. */
const REFILL_GAP_MS = 4000;
/**
 * How many times a destroy room sends its waves again: enough that leaving the
 * turrets is costly, few enough that a room cannot be farmed for experience.
 */
const DESTROY_REFILLS = 2;

type PendingWave = World["pendingWaves"][number];

export interface ObjectiveState {
  readonly kind: RoomObjective;
  /** Time it has run. */
  ms: number;
  /** The room's own waves, to send again. */
  readonly waves: readonly PendingWave[];
  refills: number;
  done: boolean;
  /** A hold's clock (`holdMsFor`), and the kills that meet it early (`HOLD_QUOTA`); a destroy room's emplacements. */
  readonly holdMs: number;
  readonly quota: number;
  kills: number;
  readonly targets: number;
}

export function makeObjective(kind: RoomObjective, waves: readonly PendingWave[], roomIndex: number): ObjectiveState {
  const roster = waves.reduce((t, wv) => t + wv.spawns.length, 0);
  return {
    kind, ms: 0, waves: waves.map((wv) => ({ ...wv, spawns: wv.spawns.map((sp) => ({ ...sp })) })), refills: 0, done: false,
    holdMs: holdMsFor(roomIndex), quota: Math.max(1, roster * HOLD_QUOTA), kills: 0, targets: destroyTargetsFor(roomIndex),
  };
}

/** The turrets still standing in a destroy room. */
export function targetsLeft(w: World): number {
  return w.enemies.filter((e) => e.objectiveTarget && e.hp > 0 && !e.gone).length;
}

/** Seconds a hold has left, rounded up; 0 once met. */
export function holdLeftS(w: World): number {
  const o = w.objective;
  return o && o.kind === "hold" && !o.done ? Math.ceil(Math.max(0, o.holdMs - o.ms) / 1000) : 0;
}

/**
 * **The turrets take their ground** for a destroy room: three cells of the
 * room's spawn groups, each as far as the floor allows from the door and from
 * the others, with floor round each.
 */
export function placeTargets(w: World): void {
  const grid = w.room.grid, p = w.player;
  const open = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (grid[(y + dy) * GRID_W + x + dx] !== Tile.Floor) return false;
    return true;
  };
  const cells = w.room.spawn_groups.flatMap((g) => g.cells).filter(([x, y]) => open(x, y))
    .map(([x, y]) => ({ x: (x + 0.5) * TILE_PX, y: (y + 0.5) * TILE_PX }))
    .filter((c) => !w.props.some((q) => q.hp > 0 && Math.hypot(q.x - c.x, q.y - c.y) < TILE_PX * 1.2));
  const chosen: { x: number; y: number }[] = [];
  const count = w.objective?.targets ?? DESTROY_TARGETS;
  for (let n = 0; n < count && cells.length > 0; n++) {
    let best = cells[0]!, bestD = -1;
    for (const c of cells) {
      const d = Math.min(Math.hypot(c.x - p.x, c.y - p.y), ...chosen.map((o) => Math.hypot(c.x - o.x, c.y - o.y) * 1.5));
      if (d > bestD) { bestD = d; best = c; }
    }
    chosen.push(best);
    cells.splice(cells.indexOf(best), 1);
  }
  const kinds = [...DESTROY_KINDS];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(w.rng.next() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
  }
  chosen.forEach((at, i) => {
    const kind = kinds[i % kinds.length]!;
    const t = makeEnemy(w.nextEnemyId++, kind, at.x, at.y, [], rampFor(w.roomIndex));
    t.hp = t.maxHp = Math.round(t.maxHp * destroyHpFor(w.roomIndex));
    t.objectiveTarget = true;
    t.awake = true;
    t.attackLockMs = OBJECTIVE_ENTRY_GRACE_MS;
    t.telegraphMs = 0;
    t.pending = [];
    w.enemies.push(t);
  });
}

export function stepObjective(w: World, dtMs: number): void {
  const o = w.objective;
  if (!o || o.done) return;
  o.ms += dtMs;
  const met = o.kind === "hold"
    ? o.ms >= o.holdMs || (o.kills >= o.quota && o.ms >= o.holdMs / 2)
    : targetsLeft(w) === 0;
  if (met) { finish(w, o); return; }
  // Spent: the room sends its waves again, a beat after the last.
  const mayRefill = o.kind === "hold" || o.refills < DESTROY_REFILLS;
  if (w.pendingWaves.length === 0 && mayRefill && o.waves.length > 0) {
    o.refills++;
    const at = w.stats.elapsedMs + REFILL_GAP_MS;
    w.pendingWaves = o.waves.map((wv, i) => ({ ...wv, atMs: at + i * REFILL_GAP_MS, spawns: wv.spawns.map((sp) => ({ ...sp })) }));
  }
}

/** Met: nothing more comes, and whatever still stands falls, paying nothing (they were not the player's kills). */
function finish(w: World, o: ObjectiveState): void {
  o.done = true;
  w.pendingWaves = [];
  for (const e of w.enemies as Enemy[]) {
    if (e.hp <= 0 || e.gone) continue;
    e.gone = true;
    e.summoned = true;
    w.events.push({ kind: "enemy_killed", x: e.x, y: e.y, what: e.archetype, facing: e.facing });
  }
  w.events.push({ kind: "telegraph", x: w.player.x, y: w.player.y, what: `objective_met:${o.kind}` });
}
