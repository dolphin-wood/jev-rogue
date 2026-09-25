/**
 * Validation (doc 004, generator step 5) and the readability floors.
 *
 * Distances are Manhattan throughout: "4 tiles from a door", "5 tiles around
 * the entry" and "6 tiles from every supported entry" all count grid steps, so
 * the three floors are stated in one metric.
 *
 * "Corridors at least 3 tiles wide" is enforced as: every floor cell belongs to
 * at least one 3x3 block of free floor. A 3-wide corridor satisfies it, a 1- or
 * 2-wide one cannot, and a single-tile dead end cannot either, so the same
 * predicate carries both floors; the dead-end rule is checked separately as
 * well because it gives a clearer failure message.
 */
import { GRID_H, GRID_W, Tile } from "../types.ts";
import type { Cell, DoorSide, Extent, SpaceArchetype, SpawnGroup, ZoneSlot } from "../types.ts";
import {
  at, doorCell, entryCell, idx, inInterior, manhattan, maskFloorCount,
} from "./masks.ts";
import { floodFill } from "./measure.ts";
import {
  BOSS_COVER_CLEARANCE, ENTRY_CLEAR_RADIUS, HAZARD_DOOR_CLEARANCE,
  SPAWN_ENTRY_CLEARANCE, bossCentre,
} from "./archetypes.ts";

/** Reachable floor must be at least this share of the mask's floor. */
export const MIN_REACHABLE_RATIO = 0.7;

export interface ValidationResult {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly reachable: Uint8Array;
}

function free(grid: Uint8Array, x: number, y: number): boolean {
  return at(grid, x, y) === Tile.Floor;
}

/** True when (x, y) sits inside some 3x3 block of free floor. */
export function hasThreeWideBlock(grid: Uint8Array, x: number, y: number): boolean {
  for (let oy = -2; oy <= 0; oy++) {
    outer: for (let ox = -2; ox <= 0; ox++) {
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          if (!free(grid, x + ox + dx, y + oy + dy)) continue outer;
        }
      }
      return true;
    }
  }
  return false;
}

/** Floor cells that break the 3-tile width floor, scanned over the whole grid. */
export function narrowCells(grid: Uint8Array): Cell[] {
  const out: Cell[] = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!free(grid, x, y)) continue;
      if (!hasThreeWideBlock(grid, x, y)) out.push([x, y]);
    }
  }
  return out;
}

/** Same predicate, restricted to the cells a placement at `box` could break. */
export function narrowNear(
  grid: Uint8Array,
  x0: number, y0: number, w: number, h: number,
): boolean {
  for (let y = y0 - 2; y < y0 + h + 2; y++) {
    for (let x = x0 - 2; x < x0 + w + 2; x++) {
      if (!free(grid, x, y)) continue;
      if (!hasThreeWideBlock(grid, x, y)) return true;
    }
  }
  return false;
}

/** A floor cell with fewer than two walkable orthogonal neighbours. */
export function deadEnds(grid: Uint8Array): Cell[] {
  const out: Cell[] = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!free(grid, x, y)) continue;
      let open = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const t = at(grid, x + dx, y + dy);
        if (t === Tile.Floor || t === Tile.Door) open++;
      }
      if (open < 2) out.push([x, y]);
    }
  }
  return out;
}

/** Mask floor cells inside the entry's clear radius, which must stay free. */
export function entryClearCells(mask: Uint8Array, entry: DoorSide, ext: Extent): Cell[] {
  const door = doorCell(entry, ext);
  const out: Cell[] = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (mask[idx(x, y)] !== Tile.Floor) continue;
      if (manhattan([x, y], door) <= ENTRY_CLEAR_RADIUS) out.push([x, y]);
    }
  }
  return out;
}

/** Manhattan distance from a cell to the nearest cell of the boss centre block. */
export function bossCentreDistance(x: number, y: number, ext: Extent): number {
  let best = Infinity;
  for (const cell of bossCentre(ext)) best = Math.min(best, Math.abs(cell[0] - x) + Math.abs(cell[1] - y));
  return best;
}

export interface ValidateInput {
  readonly grid: Uint8Array;
  readonly mask: Uint8Array;
  readonly archetype: SpaceArchetype;
  readonly entry: DoorSide;
  readonly zones: readonly ZoneSlot[];
  readonly spawnGroups: readonly SpawnGroup[];
  readonly ext: Extent;
}

export function validateRoom(input: ValidateInput): ValidationResult {
  const { grid, mask, archetype: a, entry, zones, spawnGroups, ext } = input;
  const problems: string[] = [];

  if (!a.doors.includes(entry)) problems.push(`entry ${entry} is not a supported door`);

  const start = entryCell(entry, ext);
  const reachable = floodFill(grid, start);
  if (reachable[idx(start[0], start[1])] !== 1) problems.push(`entry cell ${start} is not walkable`);

  for (const side of a.doors) {
    const d = doorCell(side, ext);
    if (reachable[idx(d[0], d[1])] !== 1) problems.push(`door ${side} is not reachable from the entry`);
  }

  const maskFloor = maskFloorCount(mask);
  let reachableFloor = 0;
  for (let i = 0; i < grid.length; i++) {
    if (mask[i] === Tile.Floor && grid[i] === Tile.Floor && reachable[i] === 1) reachableFloor++;
  }
  const ratio = maskFloor === 0 ? 0 : reachableFloor / maskFloor;
  if (ratio < MIN_REACHABLE_RATIO) {
    problems.push(`reachable floor ${(ratio * 100).toFixed(1)}% is below ${MIN_REACHABLE_RATIO * 100}%`);
  }

  for (const z of zones) {
    for (const cell of z.cells) {
      if (!free(grid, cell[0], cell[1])) problems.push(`zone ${z.id}: ${cell} is not free floor`);
      else if (reachable[idx(cell[0], cell[1])] !== 1) problems.push(`zone ${z.id}: ${cell} is unreachable`);
      for (const side of a.doors) {
        if (manhattan(cell, doorCell(side, ext)) < HAZARD_DOOR_CLEARANCE) {
          problems.push(`zone ${z.id}: ${cell} is within ${HAZARD_DOOR_CLEARANCE} tiles of door ${side}`);
        }
      }
    }
  }

  for (const g of spawnGroups) {
    for (const cell of g.cells) {
      if (!free(grid, cell[0], cell[1])) problems.push(`spawn ${g.id}: ${cell} is not free floor`);
      else if (reachable[idx(cell[0], cell[1])] !== 1) problems.push(`spawn ${g.id}: ${cell} is unreachable`);
      for (const side of a.doors) {
        if (manhattan(cell, doorCell(side, ext)) < SPAWN_ENTRY_CLEARANCE) {
          problems.push(`spawn ${g.id}: ${cell} is within ${SPAWN_ENTRY_CLEARANCE} tiles of entry ${side}`);
        }
      }
    }
  }

  const narrow = narrowCells(grid);
  if (narrow.length > 0) {
    problems.push(`${narrow.length} floor cells are in a passage narrower than 3 tiles, first ${narrow[0]}`);
  }
  const ends = deadEnds(grid);
  if (ends.length > 0) problems.push(`${ends.length} single-tile dead ends, first ${ends[0]}`);

  for (const cell of entryClearCells(mask, entry, ext)) {
    if (!free(grid, cell[0], cell[1])) {
      problems.push(`obstacle at ${cell} inside the ${ENTRY_CLEAR_RADIUS}-tile clearance of entry ${entry}`);
      break;
    }
  }

  if (a.boss === true) {
    for (const cell of bossCentre(ext)) {
      if (!free(grid, cell[0], cell[1])) {
        problems.push(`boss centre blocked at ${cell}`);
        break;
      }
    }
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (!inInterior(x, y, ext)) continue;
        if (mask[idx(x, y)] !== Tile.Floor) continue;
        if (free(grid, x, y)) continue;
        if (bossCentreDistance(x, y, ext) < BOSS_COVER_CLEARANCE) {
          problems.push(`boss cover at ${[x, y]} is closer than ${BOSS_COVER_CLEARANCE} tiles to the centre`);
          y = GRID_H;
          break;
        }
      }
    }
  }

  return { ok: problems.length === 0, problems, reachable };
}
