/**
 * Circles against circles, and circles against the tile grid. There is no
 * pathfinding and no broadphase: at a dozen enemies and a few hundred bullets
 * on a 21x13 grid, the naive loops are well inside the 4 ms step budget and a
 * spatial index would cost more to keep correct than it saves.
 */
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";
import type { Vec } from "./types.ts";

export const WORLD_W = GRID_W * TILE_PX;
export const WORLD_H = GRID_H * TILE_PX;

export function tileAt(grid: Uint8Array, x: number, y: number): number {
  const tx = Math.floor(x / TILE_PX);
  const ty = Math.floor(y / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return Tile.Wall;
  return grid[ty * GRID_W + tx] ?? Tile.Wall;
}

/**
 * Whether a body may occupy this point.
 *
 * `Door` counts as solid, which it did not before, and the omission let the
 * player walk into a doorway and stand *inside the border wall*: doors are cut
 * into the border, so a non-solid door is a hole in the room. Walking east in
 * an open arena ended with the player's whole body between world x 657 and
 * 671, inside the wall tile spanning 640 to 672, with `circleHitsWall`
 * reporting no collision because the tile it sampled was a door.
 *
 * Doc 003 has the player leaving a cleared room by walking through a door. When
 * that is implemented the transition must fire **on contact**, not by admitting
 * the body into the tile, because a doorway is a threshold and never a place to
 * stand. Until then a door is simply a wall the room generator has labelled.
 */
export function isSolid(grid: Uint8Array, x: number, y: number): boolean {
  const t = tileAt(grid, x, y);
  return t === Tile.Wall || t === Tile.Pillar || t === Tile.Door || t === Tile.Prop;
}

/** Four probes on the circle, which is enough at this tile size. */
export function circleHitsWall(grid: Uint8Array, x: number, y: number, r: number): boolean {
  return (
    isSolid(grid, x - r, y) || isSolid(grid, x + r, y) ||
    isSolid(grid, x, y - r) || isSolid(grid, x, y + r)
  );
}

/**
 * Probes only the leading edge of a move, at three points across it.
 *
 * Testing the whole circle instead would wedge anything that already overlaps
 * a wall: its trailing edge stays inside the tile, so every direction reads
 * as blocked and the body can never back out. Spawns, knockback and a slide
 * into a corner all produce that state, so escaping it has to be possible.
 */
function edgeBlocked(grid: Uint8Array, x: number, y: number, r: number, dx: number, dy: number): boolean {
  const ex = dx === 0 ? 0 : Math.sign(dx) * r;
  const ey = dy === 0 ? 0 : Math.sign(dy) * r;
  // Across the leading edge: centre and both shoulders.
  const sx = ey === 0 ? 0 : r * 0.7;
  const sy = ex === 0 ? 0 : r * 0.7;
  return (
    isSolid(grid, x + ex, y + ey) ||
    isSolid(grid, x + ex - sx, y + ey - sy) ||
    isSolid(grid, x + ex + sx, y + ey + sy)
  );
}

/**
 * Moves a circle one axis at a time, sliding along whichever axis is blocked
 * so a body never sticks to a wall it merely brushes.
 */
/**
 * Pushes a circle out of any wall it is overlapping, one axis at a time.
 *
 * Leading-edge probing alone is not enough: a body that is already partly
 * inside a tile passes every test while it slides *along* the wall, and ends
 * up inside it. Spawns, knockback and a corner slide all produce that state,
 * so the only reliable answer is to check after moving and push back out.
 */
export function depenetrate(grid: Uint8Array, pos: Vec, r: number): boolean {
  if (!circleHitsWall(grid, pos.x, pos.y, r)) return false;
  for (const step of [1, 2, 4, 8, 16]) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = clamp(pos.x + dx! * step, r, WORLD_W - r);
      const ny = clamp(pos.y + dy! * step, r, WORLD_H - r);
      if (!circleHitsWall(grid, nx, ny, r)) {
        pos.x = nx;
        pos.y = ny;
        return true;
      }
    }
  }
  return false;
}

export function moveSliding(
  grid: Uint8Array,
  pos: Vec,
  dx: number,
  dy: number,
  r: number,
): { moved: boolean; blockedX: boolean; blockedY: boolean } {
  let blockedX = false;
  let blockedY = false;
  // Probed at the destination, not the origin: probing the origin lets a body
  // step into a wall by one frame's distance before the next probe catches it.
  if (dx !== 0) {
    const nx = clamp(pos.x + dx, r, WORLD_W - r);
    if (edgeBlocked(grid, nx, pos.y, r, dx, 0)) blockedX = true;
    else pos.x = nx;
  }
  if (dy !== 0) {
    const ny = clamp(pos.y + dy, r, WORLD_H - r);
    if (edgeBlocked(grid, pos.x, ny, r, 0, dy)) blockedY = true;
    else pos.y = ny;
  }
  // Whatever the probes let through, nothing ends a step inside a wall.
  depenetrate(grid, pos, r);
  return { moved: !blockedX || !blockedY, blockedX, blockedY };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function circlesOverlap(
  ax: number, ay: number, ar: number,
  bx: number, by: number, br: number,
): boolean {
  const r = ar + br;
  return dist2(ax, ay, bx, by) <= r * r;
}

export function normalise(x: number, y: number): Vec {
  const len = Math.hypot(x, y);
  return len === 0 ? { x: 0, y: 0 } : { x: x / len, y: y / len };
}

export function cellCentre(cell: readonly [number, number]): Vec {
  return { x: (cell[0] + 0.5) * TILE_PX, y: (cell[1] + 0.5) * TILE_PX };
}

/** Where the player stands when entering through a side. */
export function entryPosition(side: "N" | "E" | "S" | "W"): Vec {
  const mid = { x: WORLD_W / 2, y: WORLD_H / 2 };
  const inset = TILE_PX * 1.5;
  switch (side) {
    case "N": return { x: mid.x, y: inset };
    case "S": return { x: mid.x, y: WORLD_H - inset };
    case "W": return { x: inset, y: mid.y };
    case "E": return { x: WORLD_W - inset, y: mid.y };
  }
}

/**
 * Whether a straight line between two points clears the walls. Stepped at
 * half a tile, which is finer than any obstacle the generator places.
 */
export function hasLineOfSight(grid: Uint8Array, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const steps = Math.ceil(Math.hypot(dx, dy) / (TILE_PX / 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isSolid(grid, ax + dx * t, ay + dy * t)) return false;
  }
  return true;
}
