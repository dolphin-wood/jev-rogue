/**
 * Mask generators (doc 004, generator step 1).
 *
 * A mask is the structural layout of a room shape before any obstacle is
 * placed: `Tile.Wall` everywhere the shape excludes, `Tile.Floor` everywhere it
 * includes. Masks are code, never authored files.
 *
 * A room is its extent (`extent.ts`) with a wall ring, so the playable
 * interior is x 1..w-2, y 1..h-2 and the four doors sit at the edge
 * midpoints. The grid past the extent is wall.
 */
import { GRID_W, GRID_H, Tile } from "../types.ts";
import type { Cell, DoorSide, Extent, Shape } from "../types.ts";
import { edgeX, edgeY } from "./extent.ts";

/** The playable interior: inside the wall ring, x 1..w-2 and y 1..h-2. */
export const interiorX1 = (ext: Extent): number => ext.w - 2;
export const interiorY1 = (ext: Extent): number => ext.h - 2;
export const INTERIOR_X0 = 1;
export const INTERIOR_Y0 = 1;

/** Door cells live in the wall ring at the midpoint of each side. */
export function doorCell(side: DoorSide, ext: Extent): Cell {
  switch (side) {
    case "N": return [(ext.w - 1) / 2, 0];
    case "S": return [(ext.w - 1) / 2, ext.h - 1];
    case "W": return [0, (ext.h - 1) / 2];
    case "E": return [ext.w - 1, (ext.h - 1) / 2];
  }
}

/** The interior cell a player stands on immediately after walking through. */
export function entryCell(side: DoorSide, ext: Extent): Cell {
  switch (side) {
    case "N": return [(ext.w - 1) / 2, INTERIOR_Y0];
    case "S": return [(ext.w - 1) / 2, interiorY1(ext)];
    case "W": return [INTERIOR_X0, (ext.h - 1) / 2];
    case "E": return [interiorX1(ext), (ext.h - 1) / 2];
  }
}

export function idx(x: number, y: number): number {
  return y * GRID_W + x;
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
}

export function inInterior(x: number, y: number, ext: Extent): boolean {
  return x >= INTERIOR_X0 && x <= interiorX1(ext) && y >= INTERIOR_Y0 && y <= interiorY1(ext);
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

export function mirrorX(x: number, ext: Extent): number {
  return ext.w - 1 - x;
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

/*
 * The four masks, drawn on the base grid's lines (`extent.ts`) and stretched
 * to the room: a band or a core keeps its share of the room at every size.
 */

/** Full interior rectangle: 19 x 11 on the base. */
export function arenaMask(ext: Extent): Uint8Array {
  const g = blank();
  carve(g, INTERIOR_X0, INTERIOR_Y0, interiorX1(ext), interiorY1(ext));
  return g;
}

/** Central band (base rows 3..9) plus four alcoves (base 3 x 2) off the long sides. */
export const CORRIDOR_BAND_Y0 = 3;
export const CORRIDOR_BAND_Y1 = 9;
export const CORRIDOR_ALCOVE_X: readonly number[] = [4, 14];

export function corridorMask(ext: Extent): Uint8Array {
  const g = blank();
  const b0 = edgeY(CORRIDOR_BAND_Y0, ext), b1 = edgeY(CORRIDOR_BAND_Y1 + 1, ext) - 1;
  carve(g, INTERIOR_X0, b0, interiorX1(ext), b1);
  for (const x of CORRIDOR_ALCOVE_X) {
    const a0 = edgeX(x, ext), a1 = edgeX(x + 3, ext) - 1;
    carve(g, a0, INTERIOR_Y0, a1, b0 - 1);
    carve(g, a0, b1 + 1, a1, interiorY1(ext));
  }
  return g;
}

/** Interior rectangle with a block of wall at the centre: 7 x 5 on the base. */
export const RING_CORE_X0 = 7;
export const RING_CORE_X1 = 13;
export const RING_CORE_Y0 = 4;
export const RING_CORE_Y1 = 8;

export function ringMask(ext: Extent): Uint8Array {
  const g = arenaMask(ext);
  for (let y = edgeY(RING_CORE_Y0, ext); y < edgeY(RING_CORE_Y1 + 1, ext); y++) {
    for (let x = edgeX(RING_CORE_X0, ext); x < edgeX(RING_CORE_X1 + 1, ext); x++) put(g, x, y, Tile.Wall);
  }
  return g;
}

/** Four corner blocks of wall, leaving a 19 x 5 arm crossing a 9 x 11 arm on the base. */
export const CROSS_ARM_Y0 = 4;
export const CROSS_ARM_Y1 = 8;
export const CROSS_ARM_X0 = 6;
export const CROSS_ARM_X1 = 14;

export function crossMask(ext: Extent): Uint8Array {
  const g = blank();
  carve(g, INTERIOR_X0, edgeY(CROSS_ARM_Y0, ext), interiorX1(ext), edgeY(CROSS_ARM_Y1 + 1, ext) - 1);
  carve(g, edgeX(CROSS_ARM_X0, ext), INTERIOR_Y0, edgeX(CROSS_ARM_X1 + 1, ext) - 1, interiorY1(ext));
  return g;
}

const MASKS = new Map<string, Uint8Array>();

/** A shape's mask at an extent. Shared; do not mutate. */
export function maskFor(shape: Shape, ext: Extent): Uint8Array {
  const key = `${shape}:${ext.w}x${ext.h}`;
  const cached = MASKS.get(key);
  if (cached) return cached;
  const m = shape === "arena" ? arenaMask(ext)
    : shape === "corridor" ? corridorMask(ext)
    : shape === "ring" ? ringMask(ext)
    : crossMask(ext);
  MASKS.set(key, m);
  return m;
}

/** Number of cells the mask made floor; the denominator of the obstacle ratio. */
export function maskFloorCount(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === Tile.Floor) n++;
  return n;
}

/** Stamps the supported doors into a grid. */
export function applyDoors(grid: Uint8Array, doors: readonly DoorSide[], ext: Extent): void {
  for (const side of doors) {
    const c = doorCell(side, ext);
    put(grid, c[0], c[1], Tile.Door);
  }
}
