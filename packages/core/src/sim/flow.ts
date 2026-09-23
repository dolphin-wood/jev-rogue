/**
 * A flow field from the player over the room grid (replacing doc 005's
 * "no pathfinding" rule).
 *
 * That rule traded away the most visible thing about an enemy — whether it
 * looks like it is coming for you — to save a cost that does not exist. The
 * room is 21 x 13, so a breadth-first sweep is 273 cells, and one field
 * serves every enemy in the room. Recomputed only when the player changes
 * tile, a whole fight costs less than a single frame of bullet integration.
 *
 * Enemies still move straight when they can see the player: a field followed
 * blindly produces grid-flavoured shuffling. The field is for going round
 * things, not for the open floor.
 */
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";

export const UNREACHABLE = -1;

export interface FlowField {
  /** Steps from each cell to the target; UNREACHABLE where no path exists. */
  readonly dist: Int16Array;
  readonly targetTileX: number;
  readonly targetTileY: number;
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

function walkable(grid: Uint8Array, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return false;
  const t = grid[ty * GRID_W + tx];
  // Doors are solid to bodies (see `isSolid`), so the field must not route
  // into a tile nothing can stand in.
  return t === Tile.Floor;
}

export function tileOf(x: number, y: number): [number, number] {
  return [Math.floor(x / TILE_PX), Math.floor(y / TILE_PX)];
}

/** Breadth-first from the target; four-connected, so no corner cutting. */
export function computeFlowField(grid: Uint8Array, targetX: number, targetY: number): FlowField {
  const [tx, ty] = tileOf(targetX, targetY);
  const dist = new Int16Array(GRID_W * GRID_H).fill(UNREACHABLE);
  if (!walkable(grid, tx, ty)) return { dist, targetTileX: tx, targetTileY: ty };

  const queue = new Int32Array(GRID_W * GRID_H);
  let head = 0;
  let tail = 0;
  const start = ty * GRID_W + tx;
  dist[start] = 0;
  queue[tail++] = start;

  while (head < tail) {
    const cell = queue[head++]!;
    const cx = cell % GRID_W;
    const cy = (cell - cx) / GRID_W;
    const next = dist[cell]! + 1;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(grid, nx, ny)) continue;
      const ni = ny * GRID_W + nx;
      if (dist[ni] !== UNREACHABLE) continue;
      dist[ni] = next;
      queue[tail++] = ni;
    }
  }

  return { dist, targetTileX: tx, targetTileY: ty };
}

export function distanceAt(field: FlowField, x: number, y: number): number {
  const [tx, ty] = tileOf(x, y);
  if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return UNREACHABLE;
  return field.dist[ty * GRID_W + tx] ?? UNREACHABLE;
}

/**
 * Unit vector toward the neighbouring tile with the lowest distance, aimed at
 * that tile's centre so a body leaves a doorway cleanly instead of clipping
 * its jamb. Returns null when nothing improves, which means the enemy is
 * either on the target tile or walled off from it.
 */
export function followField(
  field: FlowField,
  x: number,
  y: number,
  away = false,
): { x: number; y: number } | null {
  const [tx, ty] = tileOf(x, y);
  const here = distanceAt(field, x, y);
  if (here === UNREACHABLE) return null;

  let best: [number, number] | null = null;
  let bestScore = here;
  let bestTieBreak = Infinity;
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
    const d = field.dist[ny * GRID_W + nx] ?? UNREACHABLE;
    if (d === UNREACHABLE) continue;
    // Ties are common on open floor, and taking the first one makes bodies
    // hug walls. Breaking on straight-line distance to the target keeps the
    // route looking like something that wants to reach you.
    const tie = (nx - field.targetTileX) ** 2 + (ny - field.targetTileY) ** 2;
    const better = away
      ? d > bestScore || (d === bestScore && best !== null && tie > bestTieBreak)
      : d < bestScore || (d === bestScore && best !== null && tie < bestTieBreak);
    if (better) {
      bestScore = d;
      bestTieBreak = tie;
      best = [nx, ny];
    }
  }
  if (!best) return null;

  const cx = (best[0] + 0.5) * TILE_PX;
  const cy = (best[1] + 0.5) * TILE_PX;
  const len = Math.hypot(cx - x, cy - y);
  return len < 0.001 ? null : { x: (cx - x) / len, y: (cy - y) / len };
}
