/**
 * The room generator (doc 004, "Generator (code)").
 *
 * Six steps: mask, obstacles, zone slots, spawn groups, validate, measure;
 * then the retry and relax policy. Everything random comes from the passed-in
 * `Rng`, so a room is a pure function of (params, entry, room type, seed).
 *
 * Obstacles are placed as rectangular blocks - pillars (1x1 or 2x2) and wall
 * stubs (up to 5 long) - onto free floor that is neither reserved for a zone
 * slot or a spawn cell nor inside the entry's clear radius. Every placement is
 * rejected unless the grid still satisfies the readability floors and every
 * door and reserved cell is still reachable, so a finished layout is correct by
 * construction and step 5 is a check rather than a filter.
 *
 * Note on the openness bands: the doc gives tight as 18-28%. With the 3-tile
 * width floor enforced (see `validate.ts`) the densest legal packing is a
 * lattice of blocks separated by 3-wide lanes, and once the reserved cells and
 * the entry clearance are carved out of the narrow masks, 18% is out of reach
 * for `cross_tight`: measured over the whole 12 x 2 x 4 x 20 sweep it relaxed
 * 43 of 80 mirrored rooms at 18%, and 3 of 80 at 16%. `measure.ts` therefore
 * uses 16-26% for tight and pulls mixed's top from 18% to 16% so the three
 * bands stay contiguous and disjoint.
 */
import { ROOM_EXTENT, Tile } from "../types.ts";
import type {
  Cell, Cover, DoorSide, Extent, RoomParams, RoomPlan, RoomType, RewardKind, SpaceArchetype,
  SpawnGroup, Symmetry, ZoneSlot,
} from "../types.ts";
import { DOOR_SIDES } from "../types.ts";
import type { Rng } from "../rng.ts";
import { clearanceField, loopCount } from "./melee-metrics.ts";
import {
  BOSS_COVER_CLEARANCE, archetype as archetypeById, archetypeAt,
} from "./archetypes.ts";
import {
  INTERIOR_X0, INTERIOR_Y0, applyDoors, at, doorCell, entryCell, idx, inInterior,
  interiorX1, interiorY1, maskFor, mirrorX,
} from "./masks.ts";
import { bandsFor, measureRoom, measurementProblems, floodFill } from "./measure.ts";
import type { RoomMetrics } from "./measure.ts";
import { authoredFor, authoredGrid } from "./authored.ts";
import type { AuthoredRoom } from "./authored.ts";
import { bossCentreDistance, entryClearCells, narrowNear, validateRoom } from "./validate.ts";
import { inSkeleton, skeletonById, skeletonMask, skeletonsFor } from "./skeletons.ts";
import type { Skeleton } from "./skeletons.ts";

/** Seeds tried before a parameter is relaxed (doc 004 step 7). */
export const MAX_SEED_ATTEMPTS = 5;
/** Seeds tried after relaxing, before the authored fallback. */
export const MAX_RELAXED_ATTEMPTS = 2;

export interface RoomZone {
  readonly id: string;
  readonly cells: readonly Cell[];
  readonly feature: string | "none";
}

/**
 * The generator's output. It is everything a `RoomPlan` needs about the space;
 * `toRoomPlan` adds the run-level fields the generator cannot know.
 */
export interface GeneratedRoom {
  readonly params: RoomParams;
  readonly room_type: RoomType;
  /** The archetype actually built, which differs from the request after a relax; at the room's extent. */
  readonly effective: SpaceArchetype;
  /** The room's size in cells (`params.size`). */
  readonly extent: Extent;
  /** The outline the room was built in (`skeletons.ts`); the shape's own id for an authored room. */
  readonly skeleton: string;
  /** That outline's mask, which the measurements and validation were taken against. */
  readonly mask: Uint8Array;
  readonly grid: Uint8Array;
  readonly doors: readonly DoorSide[];
  readonly entry: DoorSide;
  readonly zones: readonly RoomZone[];
  readonly spawn_groups: readonly SpawnGroup[];
  readonly measured: RoomMetrics;
  readonly layout: "generated" | "authored";
  /** Seeds consumed, including the failed ones. */
  readonly attempts: number;
  readonly relaxed: boolean;
  readonly authored_id: string | null;
}

/** Doc 004: the entry is the requested side if supported, else the first
 *  supported side clockwise from it. Fixed before generation, never revisited. */
export function resolveEntry(a: SpaceArchetype, preferred: DoorSide): DoorSide {
  if (a.doors.includes(preferred)) return preferred;
  const start = DOOR_SIDES.indexOf(preferred);
  for (let i = 1; i <= DOOR_SIDES.length; i++) {
    const side = DOOR_SIDES[(start + i) % DOOR_SIDES.length]!;
    if (a.doors.includes(side)) return side;
  }
  throw new Error(`archetype ${a.id} supports no doors`);
}

/** One step toward the neighbour label: dense -> sparse -> none, tight -> mixed
 *  -> open. Cover is relaxed first because it is the harder of the two. */
export function relaxArchetype(a: SpaceArchetype): SpaceArchetype | null {
  if (a.cover === "dense") return { ...a, cover: "sparse" };
  if (a.openness === "tight") return { ...a, openness: "mixed" };
  if (a.cover === "sparse") return { ...a, cover: "none" };
  if (a.openness === "mixed") return { ...a, openness: "open" };
  return null;
}

/* ------------------------------ obstacle blocks ----------------------------- */

interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

function mirrorBox(b: Box, ext: Extent): Box {
  return { x: mirrorX(b.x + b.w - 1, ext), y: b.y, w: b.w, h: b.h };
}

interface Placer {
  readonly grid: Uint8Array;
  readonly mask: Uint8Array;
  /** 1 where an obstacle may never go. */
  readonly blocked: Uint8Array;
  /** 1 where this generator put an obstacle. */
  readonly added: Uint8Array;
  readonly mirrored: boolean;
  readonly entryCell: Cell;
  readonly doorCells: readonly Cell[];
  readonly mustReach: readonly Cell[];
  readonly ext: Extent;
}

function boxFits(p: Placer, b: Box, isPillar: boolean): boolean {
  if (b.x < 1 || b.y < 1 || b.x + b.w > p.ext.w - 1 || b.y + b.h > p.ext.h - 1) return false;
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = idx(x, y);
      if (p.grid[i] !== Tile.Floor) return false;
      if (p.blocked[i] === 1) return false;
    }
  }
  // Pillars stay 8-separated from every other obstacle so they read - and
  // count - as distinct blocks. Stubs only avoid touching pillars.
  for (let y = b.y - 1; y < b.y + b.h + 1; y++) {
    for (let x = b.x - 1; x < b.x + b.w + 1; x++) {
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue;
      const t = at(p.grid, x, y);
      if (t === Tile.Pillar) return false;
      if (isPillar && inBoundsIdx(x, y, p.ext) && p.added[idx(x, y)] === 1) return false;
    }
  }
  return true;
}

/**
 * Where two solids meet **at a corner only**: a 2×2 of cells with solid on one
 * diagonal and floor on the other. The wall on one side and the block on the
 * other look like they close the space between them and do not quite — a
 * pinch no body can pass and no eye reads as a wall — and a space closed off
 * by one is closed off by a point. Walls either share an edge or keep a tile
 * apart. Returns the top-left of each such window inside the given bounds.
 */
function pinches(grid: Uint8Array, ext: Extent, x0 = 0, y0 = 0, x1 = ext.w - 2, y1 = ext.h - 2): [number, number][] {
  const solid = (x: number, y: number) => {
    const t = at(grid, x, y);
    return t === Tile.Wall || t === Tile.Pillar;
  };
  const out: [number, number][] = [];
  for (let y = Math.max(0, y0); y <= Math.min(ext.h - 2, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(ext.w - 2, x1); x++) {
      const a = solid(x, y), b = solid(x + 1, y), c = solid(x, y + 1), d = solid(x + 1, y + 1);
      if ((a && d && !b && !c) || (b && c && !a && !d)) out.push([x, y]);
    }
  return out;
}

/**
 * Closes the corner-only meetings a layout still has — ones its mask or its
 * fixtures made, which placement cannot refuse — by filling one of the
 * window's two floor cells, so the two solids share an edge. A fill that would
 * cut the room's floor apart, or take a reserved cell, is not made; the other
 * cell is tried, and failing both, the room keeps the pinch and the
 * validation that follows decides.
 */
function closePinches(grid: Uint8Array, entryCell: readonly [number, number], reserved: Uint8Array, mirrored: boolean, ext: Extent): void {
  const floorCount = (g: Uint8Array) => { let n = 0; const seen = floodFill(g, entryCell); for (let i = 0; i < g.length; i++) if (seen[i] === 1) n++; return n; };
  for (let pass = 0; pass < 8; pass++) {
    const found = pinches(grid, ext);
    if (found.length === 0) return;
    let changed = false;
    for (const [x, y] of found) {
      const window: [number, number][] = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
      const floors = window.filter(([cx, cy]) => at(grid, cx, cy) === Tile.Floor);
      if (floors.length !== 2) continue;
      const before = floorCount(grid);
      for (const [cx, cy] of floors) {
        const cells: [number, number][] = mirrored && mirrorX(cx, ext) !== cx ? [[cx, cy], [mirrorX(cx, ext), cy]] : [[cx, cy]];
        if (cells.some(([ux, uy]) => reserved[idx(ux, uy)] === 1 || at(grid, ux, uy) !== Tile.Floor)) continue;
        for (const [ux, uy] of cells) grid[idx(ux, uy)] = Tile.Wall;
        if (floorCount(grid) === before - cells.length) { changed = true; break; }
        for (const [ux, uy] of cells) grid[idx(ux, uy)] = Tile.Floor;
      }
    }
    if (!changed) return;
  }
}

function inBoundsIdx(x: number, y: number, ext: Extent): boolean {
  return x >= 0 && y >= 0 && x < ext.w && y < ext.h;
}

function connected(p: Placer): boolean {
  const seen = floodFill(p.grid, p.entryCell);
  for (const d of p.doorCells) if (seen[idx(d[0], d[1])] !== 1) return false;
  for (const c of p.mustReach) if (seen[idx(c[0], c[1])] !== 1) return false;
  return true;
}

/** Places a block (and its mirror when mirrored). Returns the cells taken. */
function tryPlace(p: Placer, b: Box, tile: Tile, isPillar: boolean): number {
  const boxes = p.mirrored ? [b, mirrorBox(b, p.ext)] : [b];
  for (const bb of boxes) if (!boxFits(p, bb, isPillar)) return 0;
  const changed: number[] = [];
  for (const bb of boxes) {
    for (let y = bb.y; y < bb.y + bb.h; y++) {
      for (let x = bb.x; x < bb.x + bb.w; x++) {
        const i = idx(x, y);
        if (p.grid[i] !== Tile.Floor) continue;
        p.grid[i] = tile;
        p.added[i] = 1;
        changed.push(i);
      }
    }
  }
  let bad = false;
  for (const bb of boxes) {
    if (narrowNear(p.grid, bb.x, bb.y, bb.w, bb.h)) { bad = true; break; }
    // Touching another solid only at a corner: placed elsewhere instead.
    if (pinches(p.grid, p.ext, bb.x - 1, bb.y - 1, bb.x + bb.w, bb.y + bb.h).length > 0) { bad = true; break; }
  }
  if (!bad && !connected(p)) bad = true;
  if (bad) {
    for (const i of changed) { p.grid[i] = Tile.Floor; p.added[i] = 0; }
    return 0;
  }
  return changed.length;
}

/**
 * Every position a w x h block could take. Under `mirrored` only the left half
 * is offered, because each placement is mirrored. A pillar must additionally
 * leave the centre column free, or it would touch its own reflection and the
 * pair would read - and be counted - as a single block.
 */
function candidates(p: Placer, w: number, h: number, rng: Rng, pillar: boolean): Box[] {
  const out: Box[] = [];
  const { w: W, h: H } = p.ext;
  const centre = (W - 1) / 2;
  const maxX = p.mirrored
    ? Math.min(W - 1 - w, centre - w + (pillar ? 0 : 1))
    : W - 1 - w;
  for (let y = 1; y + h <= H - 1; y++) {
    for (let x = 1; x <= maxX; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const i = idx(x + dx, y + dy);
          if (p.mask[i] !== Tile.Floor || p.blocked[i] === 1) { ok = false; break; }
        }
      }
      if (ok) out.push({ x, y, w, h });
    }
  }
  // A 1x1 pillar on the centre column is its own mirror: it is the only way a
  // mirrored room can hold an odd number of pillars, which some masks need to
  // reach the dense band at all.
  if (p.mirrored && pillar && w === 1) {
    for (let y = 1; y + h <= H - 1; y++) {
      let ok = true;
      for (let dy = 0; dy < h; dy++) {
        const i = idx(centre, y + dy);
        if (p.mask[i] !== Tile.Floor || p.blocked[i] === 1) { ok = false; break; }
      }
      if (ok) out.push({ x: centre, y, w, h });
    }
  }
  return rng.shuffle(out);
}

/** True when mirroring a box maps it onto itself. */
function selfMirrored(b: Box, ext: Extent): boolean {
  return mirrorX(b.x + b.w - 1, ext) === b.x;
}

/**
 * How many pillars to aim for: any count in the cover's band at the room's
 * extent, and under `mirrored` an even one, since pillars there come in pairs.
 */
function pillarTargetFor(a: SpaceArchetype, symmetry: Symmetry, rng: Rng, ext: Extent): number {
  const [lo, hi] = bandsFor(a, ext).pillars;
  if (hi === 0) return 0;
  const options: number[] = [];
  for (let n = lo; n <= hi; n++) if (symmetry !== "mirrored" || n % 2 === 0) options.push(n);
  return rng.pick(options.length > 0 ? options : [hi]);
}

const STUB_SIZES: readonly (readonly [number, number])[] = [
  [5, 2], [2, 5], [4, 2], [2, 4], [3, 3], [3, 2], [2, 3],
  [5, 1], [1, 5], [4, 1], [1, 4], [3, 1], [1, 3],
];

/** How much of a box's 1-ring is already solid: wall, pillar or off-mask. */
function contactScore(p: Placer, b: Box): number {
  let n = 0;
  for (let y = b.y - 1; y < b.y + b.h + 1; y++) {
    for (let x = b.x - 1; x < b.x + b.w + 1; x++) {
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue;
      const t = at(p.grid, x, y);
      if (t === Tile.Wall || t === Tile.Pillar) n++;
    }
  }
  return n;
}

function countObstacles(p: Placer): number {
  let n = 0;
  for (let i = 0; i < p.added.length; i++) if (p.added[i] === 1) n++;
  return n;
}

function buildBlocked(
  mask: Uint8Array,
  a: SpaceArchetype,
  entry: DoorSide,
  mirrored: boolean,
  ext: Extent,
): { blocked: Uint8Array; mustReach: Cell[] } {
  const blocked = new Uint8Array(mask.length);
  const mustReach: Cell[] = [];
  const reserve = (cell: Cell): void => {
    blocked[idx(cell[0], cell[1])] = 1;
    if (mirrored) blocked[idx(mirrorX(cell[0], ext), cell[1])] = 1;
  };
  for (const z of a.zoneSlots) for (const c of z.cells) { reserve(c); mustReach.push(c); }
  for (const g of a.spawnGroups) for (const c of g.cells) { reserve(c); mustReach.push(c); }
  for (const c of entryClearCells(mask, entry, ext)) blocked[idx(c[0], c[1])] = 1;
  // Doorways need their approach kept open on both sides of the mirror line.
  for (const side of a.doors) {
    const c = entryCell(side, ext);
    blocked[idx(c[0], c[1])] = 1;
    if (mirrored) blocked[idx(mirrorX(c[0], ext), c[1])] = 1;
  }
  if (a.boss === true) {
    for (let y = 0; y < ext.h; y++) {
      for (let x = 0; x < ext.w; x++) {
        if (!inInterior(x, y, ext)) continue;
        if (bossCentreDistance(x, y, ext) < BOSS_COVER_CLEARANCE) blocked[idx(x, y)] = 1;
      }
    }
  }
  return { blocked, mustReach };
}

interface Attempt { grid: Uint8Array; metrics: RoomMetrics; skeleton: Skeleton; effective: SpaceArchetype }

function attemptLayout(
  archetype: SpaceArchetype,
  symmetry: Symmetry,
  entry: DoorSide,
  rng: Rng,
  skeleton: Skeleton,
  ext: Extent,
): Attempt | null {
  const a = inSkeleton(archetype, skeleton);
  const mask = skeletonMask(skeleton, ext);
  const grid = mask.slice();
  applyDoors(grid, a.doors, ext);
  const mirrored = symmetry === "mirrored";
  const { blocked, mustReach } = buildBlocked(mask, a, entry, mirrored, ext);
  const p: Placer = {
    grid, mask, blocked, added: new Uint8Array(mask.length), mirrored,
    entryCell: entryCell(entry, ext),
    doorCells: a.doors.map((s) => doorCell(s, ext)),
    mustReach,
    ext,
  };

  // step 2a: pillars, whose count is the cover label.
  const wantPillars = pillarTargetFor(a, symmetry, rng, ext);
  const sizes: readonly (readonly [number, number])[] =
    a.openness === "open" ? [[1, 1]] : [[2, 2], [1, 1]];
  let placedPillars = 0;
  for (const [w, h] of sizes) {
    if (placedPillars >= wantPillars) break;
    // Pillars are tried against the walls first too: on the narrow masks a
    // pillar dropped mid-lane costs three tiles of clearance on every side and
    // the stubs can then never reach a tight obstacle ratio.
    const boxes = candidates(p, w, h, rng, true);
    const score = new Map<Box, number>();
    for (const b of boxes) score.set(b, contactScore(p, b));
    boxes.sort((l, r) => (score.get(r) ?? 0) - (score.get(l) ?? 0));
    for (const box of boxes) {
      if (placedPillars >= wantPillars) break;
      const step = mirrored && !selfMirrored(box, ext) ? 2 : 1;
      if (placedPillars + step > wantPillars) continue;
      if (tryPlace(p, box, Tile.Pillar, true) > 0) placedPillars += step;
    }
  }
  // Falling short of the drawn target is fine as long as the cover band is
  // still met; only the band is a promise made to Jev.
  if (placedPillars < bandsFor(a, ext).pillars[0]) return null;

  /*
   * **The first audience's floor is bare** (doc 022, "The arena"): no stub and
   * no kiting block, because a wall his band stops at, or a block the player
   * trips on mid-dash, teaches something other than the king. What stands in
   * that room is the braziers, and his blows break them. `open`'s band starts
   * at none, so a bare room is inside it.
   */
  if (a.id === "audience_arena") {
    const metrics = measureRoom(grid, mask, p.entryCell, ext);
    const v = validateRoom({ grid, mask, archetype: a, entry, zones: a.zoneSlots, spawnGroups: a.spawnGroups, ext });
    if (!v.ok || measurementProblems(metrics, a, symmetry, ext).length > 0) return null;
    return { grid, metrics, skeleton, effective: a };
  }

  // step 2b: wall stubs until the obstacle ratio reaches the openness band.
  // Stubs are tried against the cells they touch first, so blockwork grows off
  // the mask walls and off itself and the free floor stays in 3-wide lanes;
  // scattering them would stall well short of the tight band.
  const band = bandsFor(a, ext).obstacle;
  const span = band[1] - band[0];
  const targetRatio = band[0] + span * rng.range(0.25, 0.6);
  const maskFloor = (() => { let n = 0; for (let i = 0; i < mask.length; i++) if (mask[i] === Tile.Floor) n++; return n; })();
  const target = Math.round(targetRatio * maskFloor);
  /*
   * The kiting obstacle's budget is **reserved before the stubs spend it**.
   *
   * Placed after the stub pass it never fitted: stubs fill to the ceiling
   * exactly — measured at 16 of 16 on `open_arena` — so there was not one cell
   * left for the thing the room is required to have. A requirement that runs
   * last is a requirement that never happens.
   */
  const ceiling = Math.floor(band[1] * maskFloor);
  const stubCeiling = Math.max(0, ceiling - KITING_RESERVE);
  const stubBoxes: Box[] = [];
  for (const [w, h] of STUB_SIZES) stubBoxes.push(...candidates(p, w, h, rng, false));
  let placed = countObstacles(p);
  for (let pass = 0; pass < 4 && placed < target; pass++) {
    const ordered = rng.shuffle(stubBoxes);
    const score = new Map<Box, number>();
    for (const b of ordered) score.set(b, contactScore(p, b) * 4 + b.w * b.h);
    ordered.sort((l, r) => (score.get(r) ?? 0) - (score.get(l) ?? 0));
    let progress = false;
    for (const box of ordered) {
      if (placed >= target) break;
      if (placed + box.w * box.h * (mirrored ? 2 : 1) > stubCeiling) continue;
      const got = tryPlace(p, box, Tile.Wall, false);
      if (got > 0) { placed += got; progress = true; }
    }
    if (!progress) break;
  }

  placeKitingObstacle(p, ceiling);
  closePinches(grid, p.entryCell, p.blocked, mirrored, ext);

  const metrics = measureRoom(grid, mask, p.entryCell, ext);
  const v = validateRoom({ grid, mask, archetype: a, entry, zones: a.zoneSlots, spawnGroups: a.spawnGroups, ext });
  if (!v.ok) return null;
  if (measurementProblems(metrics, a, symmetry, ext).length > 0) return null;
  return { grid, metrics, skeleton, effective: a };
}

/**
 * Guarantees the room contains something the player can run **all the way
 * around**: the kiting obstacle.
 *
 * Measured across the twelve archetypes, five produced rooms with none —
 * `open_arena`, `long_corridor`, `broken_corridor`, `choked_corridor` and
 * `cross_open`. In those, a cornered player has no geometry to use, and that
 * matters more than it sounds: the fastest body runs at 80% of the player, so
 * over the whole diagonal of a base-sized room the player gains under two tiles.
 * Running is not an escape. Putting something between yourself and a chaser
 * is.
 *
 * ### Why it works against a flow field
 *
 * Enemies path on a flow field, so they never take a wrong turn and cannot be
 * lost. What they *can* be made to do is **reverse**: as the player circles an
 * obstacle, the shorter way round flips at the antipode, so the chaser turns
 * about while the player does not. Turn rate was cut to 7 rad/s and scaled by
 * body weight, so that reversal costs real time — which is what converts a
 * lump of wall into a tactic.
 *
 * ### Why this does not fight the cover bands
 *
 * The first plan was a free-standing **pillar**, which collides with
 * `cover: "none"` archetypes whose pillar band is 0..0 — and those are exactly
 * the open rooms that need one. It turned out not to be a conflict at all:
 * `countPillars` counts connected components of `Tile.Pillar` specifically,
 * and stubs are `Tile.Wall`. So this places a wall block, which touches the
 * cover label not at all and spends only obstacle ratio, under the same
 * ceiling as every other stub.
 *
 * The reason no stub was ever free-standing is also mechanical rather than
 * deliberate: stubs are sorted by `contactScore` descending, so they always
 * grow off existing geometry. This is the one that is placed by the opposite
 * rule.
 */
/**
 * Cells held back from the stub pass for the kiting obstacle: a 2x2 and its
 * mirror image.
 */
const KITING_RESERVE = 8;

function placeKitingObstacle(p: Placer, ceiling: number): void {
  if (loopCount(p.grid) > 0) return;

  /*
   * The most open cell in the room, which is by construction free-standing.
   * Scored by clearance so the block lands where there is room to circle it,
   * not in a corner where going round means going round the corner.
   */
  const clear = clearanceField(p.grid);
  const candidates: { box: Box; score: number }[] = [];
  for (const [w, h] of [[2, 2], [1, 1]] as const) {
    for (let y = INTERIOR_Y0; y <= interiorY1(p.ext) - (h - 1); y++)
      for (let x = INTERIOR_X0; x <= interiorX1(p.ext) - (w - 1); x++) {
        const box: Box = { x, y, w, h };
        if (countObstacles(p) + w * h * (p.mirrored ? 2 : 1) > ceiling) continue;
        // Free-standing is the whole point, so anything touching is rejected
        // rather than merely scored down.
        if (contactScore(p, box) > 0) continue;
        let score = Infinity;
        let free = true;
        for (let dy = 0; dy < h && free; dy++)
          for (let dx = 0; dx < w && free; dx++) {
            const i = idx(x + dx, y + dy);
            // Reserved cells — zone slots, spawn groups, the entry's clear
            // radius — are skipped here rather than left for `tryPlace` to
            // refuse. `cross_open` picked the single best cell, which was a
            // reserved one, and placed nothing at all.
            if (p.blocked[i] === 1 || p.grid[i] !== Tile.Floor) { free = false; break; }
            score = Math.min(score, clear[i] ?? 0);
          }
        if (free) candidates.push({ box, score });
      }
    if (candidates.length > 0) break;
  }
  // Best first, then the next one: a single guess that fails leaves the room
  // without the thing it is required to have, and there is no signal that it
  // did.
  candidates.sort((l, r) => r.score - l.score);
  for (const c of candidates) if (tryPlace(p, c.box, Tile.Wall, false) > 0) return;

}

function zonesOf(slots: readonly ZoneSlot[]): RoomZone[] {
  return slots.map((z) => ({ id: z.id, cells: z.cells, feature: "none" as const }));
}

function fromAuthored(
  params: RoomParams,
  roomType: RoomType,
  preferred: DoorSide,
  room: AuthoredRoom,
  attempts: number,
  ext: Extent,
): GeneratedRoom {
  const a = archetypeAt(room.archetype, ext);
  const entry = resolveEntry(a, preferred);
  const grid = authoredGrid(room, ext);
  const mask = maskFor(a.shape, ext);
  return {
    params,
    room_type: roomType,
    effective: a,
    extent: ext,
    skeleton: a.shape,
    mask,
    grid,
    doors: a.doors,
    entry,
    zones: zonesOf(a.zoneSlots),
    spawn_groups: a.spawnGroups,
    measured: measureRoom(grid, mask, entryCell(entry, ext), ext),
    layout: "authored",
    attempts,
    relaxed: true,
    authored_id: room.id,
  };
}

/**
 * Generates a room, retrying and relaxing per doc 004 step 7: five seeds, then
 * one relaxed parameter for two more, then the authored fallback.
 *
 * Each attempt draws its skeleton from the ones the archetype fits
 * (`skeletonsFor`), leaving out those in `avoid` — the run's last outlines —
 * while any other is left, so two rooms in a row do not share one. `plain`
 * builds in the shape's own outline instead, for a room whose contents are
 * placed at fixed points (a test, a measurement, the vendor room).
 */
export function generateRoom(
  params: RoomParams,
  entryRequest: DoorSide,
  roomType: RoomType,
  rng: Rng,
  opts: { readonly avoid?: readonly string[]; readonly plain?: boolean } = {},
): GeneratedRoom {
  const ext = ROOM_EXTENT[params.size];
  const base = archetypeAt(archetypeById(params.space), ext);
  const entry = resolveEntry(base, entryRequest);
  const mirrored = params.symmetry === "mirrored";
  let attempts = 0;
  const draw = (a: SpaceArchetype): Skeleton => {
    const fits = skeletonsFor(a, mirrored, entry, ext);
    if (opts.plain) return skeletonById(a.shape);
    const fresh = fits.filter((s) => !(opts.avoid ?? []).includes(s.id));
    return rng.pick(fresh.length > 0 ? fresh : fits);
  };
  const built = (got: Attempt, relaxed: boolean): GeneratedRoom => ({
    params, room_type: roomType, effective: got.effective, extent: ext, skeleton: got.skeleton.id,
    mask: skeletonMask(got.skeleton, ext), grid: got.grid, doors: got.effective.doors, entry,
    zones: zonesOf(got.effective.zoneSlots), spawn_groups: got.effective.spawnGroups, measured: got.metrics,
    layout: "generated", attempts, relaxed, authored_id: null,
  });

  for (let i = 0; i < MAX_SEED_ATTEMPTS; i++) {
    attempts++;
    const got = attemptLayout(base, params.symmetry, entry, rng, draw(base), ext);
    if (got) return built(got, false);
  }

  const relaxed = relaxArchetype(base);
  if (relaxed) {
    for (let i = 0; i < MAX_RELAXED_ATTEMPTS; i++) {
      attempts++;
      const got = attemptLayout(relaxed, params.symmetry, entry, rng, draw(relaxed), ext);
      if (got) return built(got, true);
    }
  }

  return fromAuthored(params, roomType, entry, authoredFor(base.shape), attempts, ext);
}

/** Lifts a generated room into the `RoomPlan` of doc 004, adding run-level fields. */
export function toRoomPlan(
  room: GeneratedRoom,
  extra: {
    id: string;
    seed_key: string;
    reward_kind: RewardKind;
    params_source?: "jev" | "rule" | "random";
  },
): RoomPlan {
  return {
    id: extra.id,
    room_type: room.room_type,
    params: room.params,
    measured: {
      open_ratio: room.measured.open_ratio,
      pillar_count: room.measured.pillar_count,
      symmetry_error: room.measured.symmetry_error,
      reachable_ratio: room.measured.reachable_ratio,
    },
    grid: room.grid,
    extent: room.extent,
    skeleton: room.skeleton,
    doors: room.doors,
    entry: room.entry,
    zones: room.zones,
    spawn_groups: room.spawn_groups,
    encounter: null,
    reward_kind: extra.reward_kind,
    source: {
      params: extra.params_source ?? "jev",
      layout: room.layout,
      encounter: "none",
    },
    seed_key: extra.seed_key,
  };
}

/** Debug aid: the room's extent of the grid as rows of characters. */
export function renderGrid(grid: Uint8Array, ext: Extent): string {
  const chars = [".", "#", "O", "+"];
  const rows: string[] = [];
  for (let y = 0; y < ext.h; y++) {
    let row = "";
    for (let x = 0; x < ext.w; x++) row += chars[grid[idx(x, y)] ?? 1] ?? "?";
    rows.push(row);
  }
  return rows.join("\n");
}
