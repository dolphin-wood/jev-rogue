/**
 * Mask generators (doc 004, generator step 1).
 *
 * A mask is the structural layout of a room shape before any obstacle is
 * placed: `Tile.Wall` everywhere the shape excludes, `Tile.Floor` everywhere it
 * includes. Masks are code, never authored files.
 *
 * Grid is 21 x 13 with a wall ring, so the playable interior is x 1..19,
 * y 1..11 and the four doors sit at the edge midpoints.
 */
import { GRID_W, GRID_H, Tile } from "../types.ts";
import type { Cell, DoorSide, Shape } from "../types.ts";

export const INTERIOR_X0 = 1;
export const INTERIOR_X1 = GRID_W - 2; // 19
export const INTERIOR_Y0 = 1;
export const INTERIOR_Y1 = GRID_H - 2; // 11

/** Door cells live in the wall ring at the midpoint of each side. */
export const DOOR_CELL: Readonly<Record<DoorSide, Cell>> = {
  N: [(GRID_W - 1) / 2, 0],
  S: [(GRID_W - 1) / 2, GRID_H - 1],
  W: [0, (GRID_H - 1) / 2],
  E: [GRID_W - 1, (GRID_H - 1) / 2],
};

/** The interior cell a player stands on immediately after walking through. */
export const ENTRY_CELL: Readonly<Record<DoorSide, Cell>> = {
  N: [(GRID_W - 1) / 2, INTERIOR_Y0],
  S: [(GRID_W - 1) / 2, INTERIOR_Y1],
  W: [INTERIOR_X0, (GRID_H - 1) / 2],
  E: [INTERIOR_X1, (GRID_H - 1) / 2],
};

export function idx(x: number, y: number): number {
  return y * GRID_W + x;
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
}

export function inInterior(x: number, y: number): boolean {
  return x >= INTERIOR_X0 && x <= INTERIOR_X1 && y >= INTERIOR_Y0 && y <= INTERIOR_Y1;
}

/** Out-of-bounds reads as wall, so neighbourhood scans need no edge cases. */
export function at(grid: Uint8Array, x: number, y: number): number {
  if (!inBounds(x, y)) return Tile.Wall;
  return grid[idx(x, y)] ?? Tile.Wall;
}

export function put(grid: Uint8Array, x: number, y: number, tile: Tile): void {
  if (inBounds(x, y)) grid[idx(x, y)] = tile;
}

/** Walkable: floor and doorways. Pillars and walls block. */
export function walkable(tile: number): boolean {
  return tile === Tile.Floor || tile === Tile.Door;
}

/** Free floor: walkable and not a doorway, i.e. a cell a feature may occupy. */
export function isFloor(grid: Uint8Array, x: number, y: number): boolean {
  return at(grid, x, y) === Tile.Floor;
}

export function mirrorX(x: number): number {
  return GRID_W - 1 - x;
}

/** "N tiles away" is Manhattan distance everywhere in this module. */
export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

/** A "radius" is Euclidean, as the word implies. */
export function euclid(a: Cell, b: Cell): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function rect(x0: number, y0: number, w: number, h: number): Cell[] {
  const out: Cell[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y]);
  return out;
}

function blank(): Uint8Array {
  return new Uint8Array(GRID_W * GRID_H).fill(Tile.Wall);
}

function carve(grid: Uint8Array, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(grid, x, y, Tile.Floor);
}

/* ------------------------------- the four masks ------------------------------ */

/** Full interior rectangle, 19 x 11. */
export function arenaMask(): Uint8Array {
  const g = blank();
  carve(g, INTERIOR_X0, INTERIOR_Y0, INTERIOR_X1, INTERIOR_Y1);
  return g;
}

/** Central band 19 x 7 (rows 3..9) plus four 3 x 2 alcoves off the long sides. */
export const CORRIDOR_BAND_Y0 = 3;
export const CORRIDOR_BAND_Y1 = 9;
export const CORRIDOR_ALCOVE_X: readonly number[] = [4, 14];

export function corridorMask(): Uint8Array {
  const g = blank();
  carve(g, INTERIOR_X0, CORRIDOR_BAND_Y0, INTERIOR_X1, CORRIDOR_BAND_Y1);
  for (const x of CORRIDOR_ALCOVE_X) {
    carve(g, x, INTERIOR_Y0, x + 2, CORRIDOR_BAND_Y0 - 1);
    carve(g, x, CORRIDOR_BAND_Y1 + 1, x + 2, INTERIOR_Y1);
  }
  return g;
}

/** Interior rectangle with a 7 x 5 block of wall at the centre. */
export const RING_CORE_X0 = 7;
export const RING_CORE_X1 = 13;
export const RING_CORE_Y0 = 4;
export const RING_CORE_Y1 = 8;

export function ringMask(): Uint8Array {
  const g = arenaMask();
  for (let y = RING_CORE_Y0; y <= RING_CORE_Y1; y++) {
    for (let x = RING_CORE_X0; x <= RING_CORE_X1; x++) put(g, x, y, Tile.Wall);
  }
  return g;
}

/** Four 5 x 3 corner blocks of wall, leaving a 19 x 5 arm crossing a 9 x 11 arm. */
export const CROSS_ARM_Y0 = 4;
export const CROSS_ARM_Y1 = 8;
export const CROSS_ARM_X0 = 6;
export const CROSS_ARM_X1 = 14;

export function crossMask(): Uint8Array {
  const g = blank();
  carve(g, INTERIOR_X0, CROSS_ARM_Y0, INTERIOR_X1, CROSS_ARM_Y1);
  carve(g, CROSS_ARM_X0, INTERIOR_Y0, CROSS_ARM_X1, INTERIOR_Y1);
  return g;
}

export function maskFor(shape: Shape): Uint8Array {
  switch (shape) {
    case "arena": return arenaMask();
    case "corridor": return corridorMask();
    case "ring": return ringMask();
    case "cross": return crossMask();
  }
}

/** Number of cells the mask made floor; the denominator of the obstacle ratio. */
export function maskFloorCount(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === Tile.Floor) n++;
  return n;
}

/** Stamps the supported doors into a grid. */
export function applyDoors(grid: Uint8Array, doors: readonly DoorSide[]): void {
  for (const side of doors) {
    const c = DOOR_CELL[side];
    put(grid, c[0], c[1], Tile.Door);
  }
}
