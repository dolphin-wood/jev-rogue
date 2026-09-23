/**
 * Measurement and band comparison (doc 004, generator step 6).
 *
 * The generator is not trusted to have produced what the labels asked for: the
 * finished grid is measured and compared against the archetype's bands, and a
 * room that misses them is thrown away rather than shown.
 *
 * `RoomMeasurements.open_ratio` is the share of the mask's floor that is still
 * open; the doc's openness bands are stated as *obstacle* ratios, which is
 * `1 - open_ratio` and is reported as `obstacle_ratio`.
 */
import { GRID_W, Tile } from "../types.ts";
import type { Cover, Openness, RoomMeasurements, SpaceArchetype, Symmetry } from "../types.ts";
import { at, idx, inInterior, maskFloorCount, mirrorX } from "./masks.ts";

export type Band = readonly [lo: number, hi: number];

/**
 * Obstacle-ratio bands per openness (doc 004 step 2).
 *
 * `tight` is 16-26% rather than the doc's 18-28%: with the readability floor
 * enforced (every floor cell inside some 3x3 block of free floor) plus the
 * reserved zone/spawn cells and the clear radius around the entry, 28% is not
 * reachable on any mask and 18% is not reachable on all of them. See the
 * module notes in `generate.ts`.
 */
export const OPENNESS_BANDS: Readonly<Record<Openness, Band>> = {
  open: [0, 0.08],
  mixed: [0.08, 0.16],
  tight: [0.16, 0.26],
};

/** Pillar-count bands per cover (doc 004 step 2). */
export const COVER_BANDS: Readonly<Record<Cover, Band>> = {
  none: [0, 0],
  sparse: [2, 4],
  dense: [5, 8],
};

export interface RoomMetrics extends RoomMeasurements {
  /** Share of the mask's floor taken by pillars and wall stubs. */
  readonly obstacle_ratio: number;
  readonly mask_floor: number;
  readonly free_floor: number;
  readonly reachable_floor: number;
  readonly obstacle_cells: number;
}

export function inMetricBand(value: number, band: Band): boolean {
  return value >= band[0] - 1e-9 && value <= band[1] + 1e-9;
}

/** Pillar blocks are 8-connected components of `Tile.Pillar`. */
export function countPillars(grid: Uint8Array): number {
  const seen = new Uint8Array(grid.length);
  let n = 0;
  const stack: number[] = [];
  for (let y = 0; y < grid.length / GRID_W; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = idx(x, y);
      if (grid[i] !== Tile.Pillar || seen[i] === 1) continue;
      n++;
      seen[i] = 1;
      stack.push(x, y);
      while (stack.length > 0) {
        const cy = stack.pop()!;
        const cx = stack.pop()!;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (at(grid, nx, ny) !== Tile.Pillar) continue;
            const ni = idx(nx, ny);
            if (seen[ni] === 1) continue;
            seen[ni] = 1;
            stack.push(nx, ny);
          }
        }
      }
    }
  }
  return n;
}

/** Share of interior cells whose mirror across x holds a different tile. */
export function symmetryError(grid: Uint8Array): number {
  let total = 0;
  let bad = 0;
  for (let y = 0; y < grid.length / GRID_W; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!inInterior(x, y)) continue;
      total++;
      if (at(grid, x, y) !== at(grid, mirrorX(x), y)) bad++;
    }
  }
  return total === 0 ? 0 : bad / total;
}

/** Cells reachable from `start` over floor and doorways. */
export function floodFill(grid: Uint8Array, start: readonly [number, number]): Uint8Array {
  const seen = new Uint8Array(grid.length);
  const s = at(grid, start[0], start[1]);
  if (s !== Tile.Floor && s !== Tile.Door) return seen;
  const stack: number[] = [start[0], start[1]];
  seen[idx(start[0], start[1])] = 1;
  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const steps: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of steps) {
      const nx = x + dx;
      const ny = y + dy;
      const t = at(grid, nx, ny);
      if (t !== Tile.Floor && t !== Tile.Door) continue;
      const ni = idx(nx, ny);
      if (seen[ni] === 1) continue;
      seen[ni] = 1;
      stack.push(nx, ny);
    }
  }
  return seen;
}

export function measureRoom(
  grid: Uint8Array,
  mask: Uint8Array,
  entryCell: readonly [number, number],
): RoomMetrics {
  const maskFloor = maskFloorCount(mask);
  const reached = floodFill(grid, entryCell);
  let free = 0;
  let reachable = 0;
  for (let i = 0; i < grid.length; i++) {
    if (mask[i] !== Tile.Floor) continue;
    if (grid[i] === Tile.Floor) {
      free++;
      if (reached[i] === 1) reachable++;
    }
  }
  const obstacles = maskFloor - free;
  return {
    open_ratio: maskFloor === 0 ? 0 : free / maskFloor,
    obstacle_ratio: maskFloor === 0 ? 0 : obstacles / maskFloor,
    pillar_count: countPillars(grid),
    symmetry_error: symmetryError(grid),
    reachable_ratio: maskFloor === 0 ? 0 : reachable / maskFloor,
    mask_floor: maskFloor,
    free_floor: free,
    reachable_floor: reachable,
    obstacle_cells: obstacles,
  };
}

export function bandsFor(a: SpaceArchetype): { obstacle: Band; pillars: Band } {
  return { obstacle: OPENNESS_BANDS[a.openness], pillars: COVER_BANDS[a.cover] };
}

/**
 * Compares a measured room against the archetype's bands. An empty list means
 * the room is what the labels asked for.
 */
export function measurementProblems(
  m: RoomMetrics,
  a: SpaceArchetype,
  symmetry: Symmetry,
): string[] {
  const problems: string[] = [];
  const bands = bandsFor(a);
  if (!inMetricBand(m.obstacle_ratio, bands.obstacle)) {
    problems.push(
      `obstacle ratio ${m.obstacle_ratio.toFixed(3)} outside ${a.openness} band ` +
      `${bands.obstacle[0]}..${bands.obstacle[1]}`,
    );
  }
  if (!inMetricBand(m.pillar_count, bands.pillars)) {
    problems.push(
      `pillar count ${m.pillar_count} outside ${a.cover} band ` +
      `${bands.pillars[0]}..${bands.pillars[1]}`,
    );
  }
  if (symmetry === "mirrored" && m.symmetry_error > 0) {
    problems.push(`symmetry error ${m.symmetry_error.toFixed(3)} but symmetry is mirrored`);
  }
  return problems;
}
