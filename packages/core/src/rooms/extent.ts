/**
 * A room's extent and the map from the base grid to it (doc 017).
 *
 * Rooms come in three sizes, a label the Director picks (`RoomSize`), each an
 * odd number of cells a side so a room has a centre column and a centre row
 * for its doors and its mirror. Everything a room declares — the masks'
 * outlines, the skeletons' rectangles, the archetypes' zone slots and spawn
 * groups, the authored fallbacks — is written once on the **base** grid of
 * 21 x 13 and carried to the room's extent here, so one table of archetypes
 * serves every size and a base-sized room is exactly what it always was.
 *
 * Three maps, for three kinds of thing:
 *
 * - **Edges** (`edgeX`, `edgeY`) stretch an outline: a mask's band, a
 *   skeleton's rectangle. The interior's edges run 1..20 on the base and
 *   1..w-1 on the room, spread evenly.
 * - **Cells** (`cellX`, `cellY`) spread points: a spawn cell lands in the
 *   middle of the block its base cell stretched to.
 * - **Slots** (`slotAt`) move a zone slot without stretching it: a hazard is as
 *   large round a body in a large room as in a small one, only further away.
 *
 * All three commute with the mirror, so a mirrored declaration stays mirrored:
 * the base's centre column lands on the room's.
 */
import { GRID_H, GRID_W } from "../types.ts";
import type { Cell, Extent } from "../types.ts";

/** The grid every declaration is written on. */
export const BASE_EXTENT: Extent = { w: 21, h: 13 };

function check(ext: Extent): void {
  if (ext.w % 2 !== 1 || ext.h % 2 !== 1) throw new Error(`room extent ${ext.w}x${ext.h} must be odd a side`);
  if (ext.w > GRID_W || ext.h > GRID_H) throw new Error(`room extent ${ext.w}x${ext.h} exceeds the ${GRID_W}x${GRID_H} grid`);
}

/** A base interior edge (1..20) at the room's extent (1..w-1). */
export function edgeX(e: number, ext: Extent): number {
  check(ext);
  return 1 + Math.round(((e - 1) * (ext.w - 2)) / (BASE_EXTENT.w - 2));
}

export function edgeY(e: number, ext: Extent): number {
  check(ext);
  return 1 + Math.round(((e - 1) * (ext.h - 2)) / (BASE_EXTENT.h - 2));
}

/** A base cell's column at the extent: the middle of the block it stretches to, mirrored exactly. */
export function cellX(x: number, ext: Extent): number {
  if (x <= 0) return 0;
  if (x >= BASE_EXTENT.w - 1) return ext.w - 1;
  if (x > (BASE_EXTENT.w - 1) / 2) return ext.w - 1 - cellX(BASE_EXTENT.w - 1 - x, ext);
  return Math.floor((edgeX(x, ext) + edgeX(x + 1, ext) - 1) / 2);
}

export function cellY(y: number, ext: Extent): number {
  if (y <= 0) return 0;
  if (y >= BASE_EXTENT.h - 1) return ext.h - 1;
  if (y > (BASE_EXTENT.h - 1) / 2) return ext.h - 1 - cellY(BASE_EXTENT.h - 1 - y, ext);
  return Math.floor((edgeY(y, ext) + edgeY(y + 1, ext) - 1) / 2);
}

export function cellAt(c: Cell, ext: Extent): Cell {
  return [cellX(c[0], ext), cellY(c[1], ext)];
}

/** `[x, y, w, h]` of base cells, stretched to the extent. */
export function rectAt(r: readonly [number, number, number, number], ext: Extent): [number, number, number, number] {
  const x0 = edgeX(r[0], ext), x1 = edgeX(r[0] + r[2], ext);
  const y0 = edgeY(r[1], ext), y1 = edgeY(r[1] + r[3], ext);
  return [x0, y0, x1 - x0, y1 - y0];
}

/**
 * A zone slot moved, not stretched: its cells keep their shape and the slot's
 * middle lands where the base's middle cell does. A slot whose middle falls
 * between two cells is moved by the lower one's.
 */
export function slotAt(cells: readonly Cell[], ext: Extent): Cell[] {
  const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  const mx = Math.floor((Math.min(...xs) + Math.max(...xs)) / 2);
  const my = Math.floor((Math.min(...ys) + Math.max(...ys)) / 2);
  const dx = cellX(mx, ext) - mx, dy = cellY(my, ext) - my;
  return cells.map((c) => [c[0] + dx, c[1] + dy] as Cell);
}

/** The base cell whose stretched block holds a room cell: for drawing a base grid at an extent. */
export function baseCellOf(x: number, y: number, ext: Extent): Cell {
  const find = (v: number, n: number, edge: (e: number) => number, last: number): number => {
    if (v <= 0) return 0;
    if (v >= last) return n - 1;
    for (let b = 1; b < n - 1; b++) if (v < edge(b + 1)) return b;
    return n - 2;
  };
  return [
    find(x, BASE_EXTENT.w, (e) => edgeX(e, ext), ext.w - 1),
    find(y, BASE_EXTENT.h, (e) => edgeY(e, ext), ext.h - 1),
  ];
}

/** How much larger the room's interior is than the base's, for counts that grow with floor. */
export function areaScale(ext: Extent): number {
  return ((ext.w - 2) * (ext.h - 2)) / ((BASE_EXTENT.w - 2) * (BASE_EXTENT.h - 2));
}
