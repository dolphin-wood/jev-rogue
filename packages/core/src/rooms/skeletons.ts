/**
 * Room skeletons (doc 004, "Skeletons"): the outline a room is built inside.
 *
 * An archetype fixes a **shape** — arena, corridor, ring, cross — and the
 * zone slots and spawn groups that shape guarantees. Four shapes on one
 * 21 x 13 grid were four outlines, so every arena had the same rectangle and
 * every ring the same block in the middle, and the rooms read as repeats of
 * each other however the obstacles fell. A skeleton varies the outline under
 * a shape: rectangles walled off (a corner cut, a waist pinched, a quadrant
 * gone) and rectangles opened up (a bay off a corridor, a gap through a
 * ring's core). The archetype's declarations are **untouched**, and a skeleton
 * is only used for an archetype whose every declared cell it leaves as floor,
 * so what the archetype promises Jev is still true by construction.
 *
 * Which skeleton a room gets is a generation detail, not a decision: code
 * draws it from the ones legal for the archetype, symmetry and entry, and
 * keeps the last two out of the draw (`generateRoom`'s `avoid`).
 */
import { Tile } from "../types.ts";
import type { DoorSide, Extent, Shape, SpaceArchetype, SpaceArchetypeId } from "../types.ts";
import { entryCell, idx, isFloor, maskFor, mirrorX } from "./masks.ts";
import { BASE_EXTENT, rectAt } from "./extent.ts";
import { entryClearCells } from "./validate.ts";

/** `[x, y, w, h]` in base grid cells, stretched to a room's extent (`extent.ts`). */
type Rect = readonly [number, number, number, number];

export interface Skeleton {
  readonly id: string;
  readonly shape: Shape;
  readonly description: string;
  /** Rectangles of the shape's mask turned to wall. */
  readonly walls: readonly Rect[];
  /** Rectangles of wall opened to floor. */
  readonly floors: readonly Rect[];
  /** Doors whose approach a wall takes; the room is built without them. */
  readonly closes: readonly DoorSide[];
  /**
   * Archetypes this outline leaves too little floor for: measured, their
   * builds in it relaxed a label or fell back to an authored room.
   */
  readonly except: readonly SpaceArchetypeId[];
}

const sk = (
  shape: Shape, id: string, description: string,
  parts: { walls?: Rect[]; floors?: Rect[]; closes?: DoorSide[]; except?: SpaceArchetypeId[] } = {},
): Skeleton => ({
  id, shape, description, walls: parts.walls ?? [], floors: parts.floors ?? [], closes: parts.closes ?? [],
  except: parts.except ?? [],
});

/** A rectangle and its reflection across the centre column. */
const pair = (r: Rect): Rect[] => [r, [mirrorX(r[0] + r[2] - 1, BASE_EXTENT), r[1], r[2], r[3]]];

export const SKELETONS: readonly Skeleton[] = [
  /* arena: the full 19 x 11 interior */
  sk("arena", "arena", "The full rectangle."),
  sk("arena", "arena_octagon", "Stepped corners: an octagon.", {
    walls: [
      ...pair([1, 1, 3, 1]), ...pair([1, 2, 2, 1]), ...pair([1, 3, 1, 1]),
      ...pair([1, 11, 3, 1]), ...pair([1, 10, 2, 1]), ...pair([1, 9, 1, 1]),
    ],
    except: ["tight_arena"],
  }),
  sk("arena", "arena_waist", "Both side walls pushed in at the middle: an hourglass lying down.", {
    walls: [...pair([1, 4, 3, 5])], closes: ["E", "W"],
  }),
  sk("arena", "arena_horseshoe", "The top wall bitten in at the centre: a horseshoe open to the entry.", {
    walls: [[7, 1, 7, 2], ...pair([1, 1, 2, 2])], closes: ["N"],
  }),
  sk("arena", "arena_notched", "One top corner gone: an L.", {
    walls: [[14, 1, 6, 3]],
  }),
  sk("arena", "arena_bastions", "Square bastions in all four corners.", {
    walls: [...pair([1, 1, 3, 2]), ...pair([1, 10, 3, 2])],
  }),

  /* corridor: a 19 x 7 band with four alcoves */
  sk("corridor", "corridor", "The band and its four alcoves."),
  sk("corridor", "corridor_bays", "A third bay opened on each side, at the centre.", {
    floors: [[8, 1, 5, 2], [8, 10, 5, 2]],
  }),
  sk("corridor", "corridor_sealed", "The alcoves walled up: a plain hall.", {
    walls: [...pair([4, 1, 3, 2]), ...pair([4, 10, 3, 2])],
  }),
  sk("corridor", "corridor_pinched", "The band narrowed at its middle.", {
    walls: [[9, 3, 3, 1], [9, 9, 3, 1]],
  }),
  // The entry end stays full height: its clear radius is the player's arrival.
  sk("corridor", "corridor_funnel", "The far end narrowed to a throat.", {
    walls: [[18, 3, 2, 2], [18, 8, 2, 2]],
  }),

  /* ring: a loop round a 7 x 5 core */
  sk("ring", "ring", "A loop round one solid core."),
  sk("ring", "ring_twin", "The core split by a lane: a figure of eight.", {
    floors: [[9, 4, 3, 5]],
  }),
  sk("ring", "ring_bars", "The core hollowed to two long bars.", {
    floors: [[7, 5, 7, 3]],
  }),
  sk("ring", "ring_wide", "A wider core and a tighter loop.", {
    walls: [...pair([6, 4, 1, 5])], except: ["cover_ring"],
  }),

  /* cross: a 19 x 5 arm over a 9 x 11 arm */
  sk("cross", "cross", "Two arms crossing."),
  sk("cross", "cross_stubby", "The side arms cut short.", {
    walls: [...pair([1, 4, 2, 5])], closes: ["E", "W"], except: ["cross_tight"],
  }),
  sk("cross", "cross_plaza", "The corners of the junction opened: a plaza with four mouths.", {
    floors: [...pair([3, 2, 3, 2]), ...pair([3, 9, 3, 2])],
  }),
  sk("cross", "cross_crown", "Only the upper corners of the junction opened: a crown over the entry arm.", {
    floors: [...pair([3, 2, 3, 2])],
  }),
  sk("cross", "cross_tee", "The top arm walled off: a T.", {
    walls: [[6, 1, 9, 2]], closes: ["N"], except: ["cross_tight"],
  }),
];

const BY_ID = new Map(SKELETONS.map((s) => [s.id, s]));

export function skeletonById(id: string): Skeleton {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`unknown skeleton ${id}`);
  return s;
}

const MASKS = new Map<string, Uint8Array>();

/** A skeleton's mask at an extent: its shape's, with its walls and floors applied. Shared; do not mutate. */
export function skeletonMask(s: Skeleton, ext: Extent): Uint8Array {
  const key = `${s.id}:${ext.w}x${ext.h}`;
  const cached = MASKS.get(key);
  if (cached) return cached;
  const mask = maskFor(s.shape, ext).slice();
  const fill = (rects: readonly Rect[], tile: Tile) => {
    for (const r of rects) {
      const [x0, y0, w, h] = rectAt(r, ext);
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) mask[idx(x, y)] = tile;
    }
  };
  fill(s.floors, Tile.Floor);
  fill(s.walls, Tile.Wall);
  MASKS.set(key, mask);
  return mask;
}

/** True when the mask is its own reflection, so a mirrored room can be built in it. */
export function skeletonSymmetric(s: Skeleton, ext: Extent): boolean {
  const mask = skeletonMask(s, ext);
  for (let y = 0; y < ext.h; y++)
    for (let x = 0; x < ext.w; x++)
      if (mask[idx(x, y)] !== mask[idx(mirrorX(x, ext), y)]) return false;
  return true;
}

/** The archetype as built in a skeleton: without the doors the skeleton closes. */
export function inSkeleton(a: SpaceArchetype, s: Skeleton): SpaceArchetype {
  return s.closes.length === 0 ? a : { ...a, doors: a.doors.filter((d) => !s.closes.includes(d)) };
}

/**
 * Whether a room of this archetype can be built in the skeleton: the same
 * shape, symmetric when the room is mirrored, the entry still a door, every
 * declared cell still floor, and no new wall inside the entry's clear radius.
 * The boss arenas keep their plain outline: the fight is the room.
 */
export function skeletonFits(a: SpaceArchetype, s: Skeleton, mirrored: boolean, entry: DoorSide, ext: Extent): boolean {
  if (s.shape !== a.shape || s.except.includes(a.id)) return false;
  if (a.boss === true) return s.walls.length === 0 && s.floors.length === 0;
  if (mirrored && !skeletonSymmetric(s, ext)) return false;
  if (s.closes.includes(entry)) return false;
  const mask = skeletonMask(s, ext);
  const doors = inSkeleton(a, s).doors;
  for (const d of doors) {
    const c = entryCell(d, ext);
    if (!isFloor(mask, c[0], c[1])) return false;
  }
  for (const z of a.zoneSlots) for (const c of z.cells) if (!isFloor(mask, c[0], c[1])) return false;
  for (const g of a.spawnGroups) for (const c of g.cells) if (!isFloor(mask, c[0], c[1])) return false;
  const base = maskFor(a.shape, ext);
  for (const c of entryClearCells(base, entry, ext)) if (!isFloor(mask, c[0], c[1])) return false;
  return true;
}

/** Every skeleton a room of this archetype (at the extent), symmetry and entry can be built in. */
export function skeletonsFor(a: SpaceArchetype, mirrored: boolean, entry: DoorSide, ext: Extent): Skeleton[] {
  return SKELETONS.filter((s) => skeletonFits(a, s, mirrored, entry, ext));
}
