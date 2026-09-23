/**
 * Doc 015's room metrics: what a melee fight cares about.
 *
 * The generator optimises `open_ratio` and `pillar_count`, which are **cover**
 * metrics — they describe what blocks a bullet. That was the right set when
 * the design was a bullet-hell and it prices nothing a swing cares about: how
 * wide the space is relative to the arc's reach, whether anywhere in it lets
 * the player put a wall at their back, and how long the approach takes.
 *
 * Doc 015 also corrects doc 013's guess that melee wants mazing. It does not.
 * Obstacles obstruct the player's swing and movement more than the enemies',
 * so the detour ratio's target is **low**. This file is the measurement that
 * makes that arguable with numbers rather than by assertion.
 *
 * Everything here is pure over a grid, so a test can build a room by hand and
 * assert a metric on it. That matters more than usual: several of these are
 * easy to define plausibly and get subtly wrong, and a metric that is wrong in
 * the same direction as the intuition it was built to check is worthless.
 */
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";
import { ARC_REACH } from "../sim/melee.ts";
import type { Cell } from "../types.ts";

/** The arc's reach in tiles. Doc 013's `BLADE_REACH` plus its base spread. */
export const REACH_TILES = ARC_REACH / TILE_PX;

function walkable(grid: Uint8Array, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H
    && grid[y * GRID_W + x] === Tile.Floor;
}

/** Breadth-first step counts from a cell, `-1` where unreachable. */
export function geodesic(grid: Uint8Array, from: Cell): Int16Array {
  const dist = new Int16Array(GRID_W * GRID_H).fill(-1);
  if (!walkable(grid, from[0], from[1])) return dist;
  const queue: number[] = [from[1] * GRID_W + from[0]];
  dist[queue[0]!] = 0;
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const x = at % GRID_W;
    const y = (at / GRID_W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!walkable(grid, nx, ny)) continue;
      const key = ny * GRID_W + nx;
      if (dist[key] !== -1) continue;
      dist[key] = dist[at]! + 1;
      queue.push(key);
    }
  }
  return dist;
}

/**
 * Geodesic over Euclidean distance, entry to each spawn. **Mazing, quantified.**
 *
 * Doc 015's target is 1.1 to 1.3. 1.0 is a bare floor — a straight run — and
 * above 1.5 is a maze that fights the swing. Doc 013 assumed high was good and
 * that was the error this number exists to keep from recurring.
 */
export function detourRatio(grid: Uint8Array, entry: Cell, spawns: readonly Cell[]): number {
  const dist = geodesic(grid, entry);
  let sum = 0;
  let n = 0;
  for (const s of spawns) {
    const steps = dist[s[1] * GRID_W + s[0]] ?? -1;
    if (steps <= 0) continue;
    const straight = Math.hypot(s[0] - entry[0], s[1] - entry[1]);
    if (straight < 1) continue;
    sum += steps / straight;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Per-tile clearance: the distance transform of the walkable mask.
 *
 * "Narrow relative to reach" is otherwise a phrase rather than a measurement.
 * Chebyshev rather than Euclidean, because the thing being measured is how far
 * a body can be pushed before it meets a wall, and bodies move on both axes.
 */
export function clearanceField(grid: Uint8Array): Int16Array {
  const out = new Int16Array(GRID_W * GRID_H).fill(-1);
  const queue: number[] = [];
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      if (walkable(grid, x, y)) continue;
      out[y * GRID_W + x] = 0;
      queue.push(y * GRID_W + x);
    }
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const x = at % GRID_W;
    const y = (at / GRID_W) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
        const key = ny * GRID_W + nx;
        if (out[key] !== -1) continue;
        out[key] = out[at]! + 1;
        queue.push(key);
      }
  }
  return out;
}

export interface WidthProfile {
  /** Fraction of walkable tiles too tight to swing freely in. */
  readonly tight: number;
  /** Fraction between one and two reaches: the working range. */
  readonly mid: number;
  /** Fraction in the open, where nothing backs the player. */
  readonly open: number;
}

/**
 * The width histogram. **A deliberate mix across rooms is the point**, not any
 * single target — which is why this returns three numbers and no verdict.
 */
export function widthProfile(grid: Uint8Array): WidthProfile {
  const clear = clearanceField(grid);
  let tight = 0;
  let mid = 0;
  let open = 0;
  let n = 0;
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      if (!walkable(grid, x, y)) continue;
      const c = clear[y * GRID_W + x]!;
      n++;
      if (c <= REACH_TILES) tight++;
      else if (c <= 2 * REACH_TILES) mid++;
      else open++;
    }
  return n === 0
    ? { tight: 0, mid: 0, open: 0 }
    : { tight: tight / n, mid: mid / n, open: open / n };
}

/**
 * Tiles with three or fewer open approaches: the **footholds**.
 *
 * A room with none is a room where the player can always be surrounded, which
 * doc 015 draws from the Foothold pattern and from Tartarus being walled in on
 * purpose. Counted over the four cardinal directions, because that is how a
 * body arrives.
 */
export function footholdRatio(grid: Uint8Array): number {
  let footholds = 0;
  let n = 0;
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      if (!walkable(grid, x, y)) continue;
      n++;
      let open = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
        if (walkable(grid, x + dx, y + dy)) open++;
      if (open <= 3) footholds++;
    }
  return n > 0 ? footholds / n : 0;
}

/**
 * Convex corners, **replacing `pillar_count`**.
 *
 * A convex corner is what affords stepping out, attacking and stepping back. A
 * free-standing pillar contributes four and a wall alcove two, so this
 * separates arrangements that the pillar count reports as identical. Doc 015
 * calls it the direct reframe of the existing metric.
 */
export function convexCorners(grid: Uint8Array): number {
  let corners = 0;
  for (let y = 1; y < GRID_H - 1; y++)
    for (let x = 1; x < GRID_W - 1; x++) {
      if (walkable(grid, x, y)) continue;
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const)
        // Solid here, floor on both adjacent sides: the outside of a corner.
        if (walkable(grid, x + dx, y) && walkable(grid, x, y + dy)) corners++;
    }
  return corners;
}

/**
 * The 90th-percentile count of walkable tiles inside one arc sweep.
 *
 * **The only metric that prices a free arc swing at all.** High where a wall or
 * a corner backs the player, because the swing then covers floor an enemy must
 * cross rather than floor behind it. It is the formal version of what MMO
 * players call corner pulling.
 *
 * Sampled at the four facings the game actually snaps to, not at a continuum:
 * a yield only reachable at 37 degrees is a yield the player cannot use.
 *
 * **Reported as the mean, not doc 015's 90th percentile.** At a reach of 1.8
 * tiles the sector covers the adjacent ring and nothing further, so the whole
 * range of the metric is 1 to 3 — and the 90th percentile asks "is there a
 * good spot somewhere in this room", to which every room that is not a bare
 * corridor answers 3. Measured across the twelve archetypes it returned
 * exactly 3.0 for all of them, which is a metric reporting nothing.
 *
 * The mean asks what the *typical* tile pays, which is the question with an
 * answer that differs between rooms. `arcYieldBest` keeps the percentile for
 * anyone who wants doc 015's original.
 */
export function arcYield(grid: Uint8Array): number {
  const all = arcYields(grid);
  if (all.length === 0) return 0;
  return Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 100) / 100;
}

/** Doc 015's original: the best spot in the room, at the 90th percentile. */
export function arcYieldBest(grid: Uint8Array): number {
  const all = [...arcYields(grid)].sort((a, b) => a - b);
  return all.length === 0 ? 0 : all[Math.floor(all.length * 0.9)]!;
}

function arcYields(grid: Uint8Array): number[] {
  const half = (170 * Math.PI) / 360;
  const r = REACH_TILES;
  const yields: number[] = [];
  for (let y = 1; y < GRID_H - 1; y++)
    for (let x = 1; x < GRID_W - 1; x++) {
      if (!walkable(grid, x, y)) continue;
      let best = 0;
      for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        let hit = 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const d = Math.hypot(dx, dy);
            if (d > r) continue;
            if (!walkable(grid, x + dx, y + dy)) continue;
            let a = Math.atan2(dy, dx) - facing;
            while (a > Math.PI) a -= Math.PI * 2;
            while (a < -Math.PI) a += Math.PI * 2;
            if (Math.abs(a) <= half) hit++;
          }
        best = Math.max(best, hit);
      }
      yields.push(best);
    }
  return yields;
}

/**
 * Cells whose removal disconnects the room: **chokepoints**.
 *
 * Doc 015's target is 0 to 2, and 0 should be common. A chokepoint is a forced
 * collision point, which is good for a ranged fight and a trap for a melee one
 * — it is the tile the player gets pinned against.
 *
 * Computed by removal and reflood rather than by an articulation-point pass.
 * The grid is 21 x 13, so the naive version costs nothing and is obviously
 * correct, which is worth more here than an algorithm.
 */
export function chokepoints(grid: Uint8Array): number {
  const first = firstFloor(grid);
  if (!first) return 0;
  const total = countReachable(grid, first);
  let count = 0;
  for (let y = 1; y < GRID_H - 1; y++)
    for (let x = 1; x < GRID_W - 1; x++) {
      if (!walkable(grid, x, y)) continue;
      const copy = grid.slice();
      copy[y * GRID_W + x] = Tile.Wall;
      const start = firstFloor(copy);
      if (!start) continue;
      if (countReachable(copy, start) < total - 1) count++;
    }
  return count;
}

function firstFloor(grid: Uint8Array): Cell | null {
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++)
      if (walkable(grid, x, y)) return [x, y];
  return null;
}

function countReachable(grid: Uint8Array, from: Cell): number {
  const dist = geodesic(grid, from);
  let n = 0;
  for (const d of dist) if (d >= 0) n++;
  return n;
}

/**
 * Obstacles the player can walk all the way around: **the kiting budget**.
 *
 * Doc 015 asks for "loop count", and the literal reading — independent cycles
 * in the walkable graph, `edges - vertices + 1` — was written first and is
 * useless here. On a four-connected grid every 2x2 patch of floor is a cycle,
 * so an empty arena scores in the hundreds and a two-tile-wide ring scores 33.
 * That is a measure of **area**, not of whether the player can circle out of a
 * corner.
 *
 * What the metric is for is the thing a player does when cornered: put an
 * obstacle between themselves and a chaser and go round it. So it counts
 * exactly that — solid regions entirely enclosed by reachable floor. An open
 * arena scores 0, which is correct and is the point: there is nothing to
 * circle, and being cornered there is final.
 *
 * The border wall is excluded by construction, since it touches the edge.
 */
export function loopCount(grid: Uint8Array): number {
  const seen = new Uint8Array(GRID_W * GRID_H);
  let loops = 0;
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      if (walkable(grid, x, y) || seen[y * GRID_W + x]) continue;
      // Flood this solid region, noting whether it reaches the border.
      const stack: number[] = [y * GRID_W + x];
      seen[stack[0]!] = 1;
      let touchesEdge = false;
      let size = 0;
      while (stack.length > 0) {
        const at = stack.pop()!;
        const cx = at % GRID_W;
        const cy = (at / GRID_W) | 0;
        size++;
        if (cx === 0 || cy === 0 || cx === GRID_W - 1 || cy === GRID_H - 1) touchesEdge = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
          const key = ny * GRID_W + nx;
          if (seen[key] || walkable(grid, nx, ny)) continue;
          seen[key] = 1;
          stack.push(key);
        }
      }
      if (!touchesEdge && size > 0) loops++;
    }
  return loops;
}

export interface MeleeMetrics {
  readonly detour: number;
  readonly width: WidthProfile;
  readonly footholds: number;
  readonly corners: number;
  readonly arcYield: number;
  readonly chokepoints: number;
  readonly loops: number;
  /** Seconds to contact per spawn, sorted, at the given speed in tiles/s. */
  readonly contactSeconds: readonly number[];
}

export function measureMelee(
  grid: Uint8Array, entry: Cell, spawns: readonly Cell[], tilesPerSecond: number,
): MeleeMetrics {
  const dist = geodesic(grid, entry);
  const contact = spawns
    .map((s) => dist[s[1] * GRID_W + s[0]] ?? -1)
    .filter((d) => d > 0)
    .map((d) => Math.round((d / tilesPerSecond) * 10) / 10)
    .sort((a, b) => a - b);
  return {
    detour: Math.round(detourRatio(grid, entry, spawns) * 100) / 100,
    width: widthProfile(grid),
    footholds: footholdRatio(grid),
    corners: convexCorners(grid),
    arcYield: arcYield(grid),
    chokepoints: chokepoints(grid),
    loops: loopCount(grid),
    contactSeconds: contact,
  };
}
