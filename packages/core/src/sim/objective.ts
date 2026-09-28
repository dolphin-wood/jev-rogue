/**
 * **A room objective in play** (doc 025): the world's half of
 * `run/objectives.ts`. While it runs the room keeps sending bodies — its own
 * waves again, a beat apart — and it is not clear however empty it stands;
 * when it is met, whatever still stands falls and the room clears.
 */
import { makeEnemy } from "./enemy.ts";
import type { Enemy, World } from "./types.ts";
import { GRID_W, TILE_PX, Tile } from "../types.ts";
import { rampFor } from "../encounters/ramp.ts";
import type { RoomObjective } from "../run/objectives.ts";

/** How long a hold lasts: a room's length at the pacing doc 014 sizes a fight to. */
export const HOLD_MS = 22_000;
/** How many turrets a destroy room stands. */
export const DESTROY_TARGETS = 3;
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
}

export function makeObjective(kind: RoomObjective, waves: readonly PendingWave[]): ObjectiveState {
  return { kind, ms: 0, waves: waves.map((wv) => ({ ...wv, spawns: wv.spawns.map((sp) => ({ ...sp })) })), refills: 0, done: false };
}

/** The turrets still standing in a destroy room. */
export function targetsLeft(w: World): number {
  return w.enemies.filter((e) => e.objectiveTarget && e.hp > 0 && !e.gone).length;
}

/** Seconds a hold has left, rounded up; 0 once met. */
export function holdLeftS(w: World): number {
  const o = w.objective;
  return o && o.kind === "hold" && !o.done ? Math.ceil(Math.max(0, HOLD_MS - o.ms) / 1000) : 0;
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
  for (let n = 0; n < DESTROY_TARGETS && cells.length > 0; n++) {
    let best = cells[0]!, bestD = -1;
    for (const c of cells) {
      const d = Math.min(Math.hypot(c.x - p.x, c.y - p.y), ...chosen.map((o) => Math.hypot(c.x - o.x, c.y - o.y) * 1.5));
      if (d > bestD) { bestD = d; best = c; }
    }
    chosen.push(best);
    cells.splice(cells.indexOf(best), 1);
  }
  for (const at of chosen) {
    const t = makeEnemy(w.nextEnemyId++, "turret", at.x, at.y, [], rampFor(w.roomIndex));
    t.objectiveTarget = true;
    t.awake = true;
    w.enemies.push(t);
  }
}

export function stepObjective(w: World, dtMs: number): void {
  const o = w.objective;
  if (!o || o.done) return;
  o.ms += dtMs;
  const met = o.kind === "hold" ? o.ms >= HOLD_MS : targetsLeft(w) === 0;
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
