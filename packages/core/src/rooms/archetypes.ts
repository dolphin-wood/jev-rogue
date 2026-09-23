/**
 * The space archetypes (doc 004, "Round 1: space parameters").
 *
 * An archetype is a feasible (shape, openness, cover) triple together with the
 * zone slots and spawn groups its mask *guarantees* are free floor. That
 * guarantee is the whole point: a `ring` walls off its 7 x 5 centre, so it
 * declares arcs rather than a centre slot and the "hazard inside a wall" class
 * of bug disappears by construction instead of being detected per seed.
 *
 * Every declared cell is checked by `checkArchetypeDeclarations` and by the
 * test sweep: free floor under the mask, far enough from every supported door
 * for a hazard (>= 4 tiles) or a spawn (>= 6 tiles), and disjoint from the
 * other declarations.
 */
import type {
  Cell, Cover, DoorSide, Openness, Shape, SpaceArchetype, SpaceArchetypeId,
  SpawnGroup, ZoneSlot,
} from "../types.ts";
import { DOOR_CELL, isFloor, manhattan, maskFor, rect } from "./masks.ts";

/** A hazard may not sit within this many tiles of any supported door. */
export const HAZARD_DOOR_CLEARANCE = 4;
/** A spawn cell must be at least this many tiles from every supported entry. */
export const SPAWN_ENTRY_CLEARANCE = 6;
/** No obstacle may be placed inside this radius of the entry door. */
export const ENTRY_CLEAR_RADIUS = 5;

const slot = (id: string, cells: Cell[]): ZoneSlot => ({ id, cells });
const group = (id: string, cells: Cell[]): SpawnGroup => ({ id, cells });
const c = (...cells: [number, number][]): Cell[] => cells.map(([x, y]) => [x, y] as Cell);

/* ------------------------------ arena (4 doors) ----------------------------- */

const ARENA_DOORS: readonly DoorSide[] = ["N", "E", "S", "W"];

const A_CENTRE = slot("centre", rect(8, 5, 5, 3));
const A_EDGE_N = slot("edge_n", rect(4, 1, 3, 3));
const A_EDGE_S = slot("edge_s", rect(14, 9, 3, 3));

const A_FAR = group("far", c([8, 4], [12, 4], [8, 8], [12, 8]));
const A_FLANK_L = group("flank_l", c([5, 4], [6, 4], [5, 8], [6, 8]));
const A_FLANK_R = group("flank_r", c([15, 4], [14, 4], [15, 8], [14, 8]));
const A_SURROUND = group("surround", c([7, 3], [13, 3], [7, 9], [13, 9], [7, 6], [13, 6]));

/* ---------------------------- corridor (E/W doors) --------------------------- */
/* The band is seven rows tall; N and S doors would open into a two-row stub and
 * would put every lane slot inside the four-tile hazard clearance, so a
 * corridor is entered from its ends. */

const CORRIDOR_DOORS: readonly DoorSide[] = ["E", "W"];

const C_LANE_N = slot("lane_n", c([8, 4], [9, 4], [10, 4], [11, 4], [12, 4]));
const C_LANE_S = slot("lane_s", c([8, 8], [9, 8], [10, 8], [11, 8], [12, 8]));
const C_ALCOVE_W = slot("alcove_w", rect(4, 2, 3, 3));
const C_ALCOVE_E = slot("alcove_e", rect(14, 2, 3, 3));

const C_FAR = group("far", c([9, 6], [10, 6], [11, 6], [10, 5]));
const C_FLANK_L = group("flank_l", c([6, 5], [7, 5], [6, 7], [7, 7]));
const C_FLANK_R = group("flank_r", c([13, 5], [14, 5], [13, 7], [14, 7]));

/* ------------------------------ ring (E/W doors) ----------------------------- */
/* The necks above and below the core are three rows tall and centred on x = 10,
 * so an N or S door would leave nowhere for `arc_n` / `arc_s` to sit outside the
 * hazard clearance. */

const RING_DOORS: readonly DoorSide[] = ["E", "W"];

const R_ARC_N = slot("arc_n", c([8, 3], [9, 2], [10, 2], [11, 2], [12, 3]));
const R_ARC_S = slot("arc_s", c([8, 9], [9, 10], [10, 10], [11, 10], [12, 9]));

const R_OUTER = group("ring_outer", c([9, 1], [11, 1], [9, 11], [11, 11]));
const R_FLANK_L = group("flank_l", c([2, 2], [3, 2], [2, 10], [3, 10]));
const R_FLANK_R = group("flank_r", c([18, 2], [17, 2], [18, 10], [17, 10]));

/* ------------------------------ cross (4 doors) ------------------------------ */

const CROSS_DOORS: readonly DoorSide[] = ["N", "E", "S", "W"];

/* Every cross declaration is its own mirror or paired with its mirror. That
 * matters: under `mirrored` the generator must also keep the reflection of a
 * reserved cell free, and on the cross - whose arms are only five and nine
 * tiles across - a declaration that is not mirror-closed costs twice the floor
 * and puts the tight obstacle band out of reach. */
const X_CENTRE = slot("centre", rect(8, 5, 5, 3));
const X_CORNER_NE = slot("corner_ne", rect(14, 4, 3, 3));
const X_CORNER_NW = slot("corner_nw", rect(4, 4, 3, 3));

const X_FAR = group("far", c([8, 4], [12, 4], [8, 8], [12, 8]));
const X_FLANK_L = group("flank_l", c([5, 7], [6, 7], [5, 8], [6, 8]));
const X_FLANK_R = group("flank_r", c([15, 7], [14, 7], [15, 8], [14, 8]));
const X_SURROUND = group("surround", c([7, 3], [13, 3], [7, 9], [13, 9], [7, 6], [13, 6]));

/* --------------------------------- the table -------------------------------- */

interface Def {
  id: SpaceArchetypeId;
  shape: Shape;
  openness: Openness;
  cover: Cover;
  doors: readonly DoorSide[];
  zoneSlots: readonly ZoneSlot[];
  spawnGroups: readonly SpawnGroup[];
  boss?: boolean;
  description: string;
}

const DEFS: readonly Def[] = [
  {
    id: "open_arena", shape: "arena", openness: "open", cover: "none", doors: ARENA_DOORS,
    zoneSlots: [A_CENTRE, A_EDGE_N, A_EDGE_S],
    spawnGroups: [A_FAR, A_FLANK_L, A_FLANK_R, A_SURROUND],
    description: "A wide empty arena with nothing to hide behind; short range builds close the gap easily.",
  },
  {
    id: "scattered_arena", shape: "arena", openness: "mixed", cover: "sparse", doors: ARENA_DOORS,
    zoneSlots: [A_CENTRE, A_EDGE_N],
    spawnGroups: [A_FAR, A_FLANK_L, A_FLANK_R, A_SURROUND],
    description: "An open arena broken by a few pillars; enough cover to break line of sight, not enough to hide.",
  },
  {
    id: "pillared_arena", shape: "arena", openness: "mixed", cover: "dense", doors: ARENA_DOORS,
    zoneSlots: [A_EDGE_N, A_EDGE_S],
    spawnGroups: [A_FAR, A_FLANK_L, A_FLANK_R],
    description: "An arena of standing pillars; long shots need angles and enemies appear from behind cover.",
  },
  {
    id: "tight_arena", shape: "arena", openness: "tight", cover: "dense", doors: ARENA_DOORS,
    zoneSlots: [A_EDGE_N, A_EDGE_S],
    spawnGroups: [A_FAR, A_FLANK_L, A_FLANK_R],
    description: "A cluttered arena with little clear floor; movement matters more than range.",
  },
  {
    id: "long_corridor", shape: "corridor", openness: "open", cover: "none", doors: CORRIDOR_DOORS,
    zoneSlots: [C_LANE_N, C_LANE_S],
    spawnGroups: [C_FAR, C_FLANK_L, C_FLANK_R],
    description: "A long clear hall entered from one end; long range builds dominate the lane.",
  },
  {
    id: "broken_corridor", shape: "corridor", openness: "mixed", cover: "sparse", doors: CORRIDOR_DOORS,
    zoneSlots: [C_LANE_N, C_ALCOVE_E],
    spawnGroups: [C_FAR, C_FLANK_L, C_FLANK_R],
    description: "A hall interrupted by scattered blocks and side alcoves; the lane is still readable.",
  },
  {
    id: "gallery", shape: "corridor", openness: "mixed", cover: "dense", doors: CORRIDOR_DOORS,
    zoneSlots: [C_ALCOVE_E, C_ALCOVE_W],
    spawnGroups: [C_FAR, C_FLANK_L, C_FLANK_R],
    description: "A colonnade: two rows of pillars down a hall with alcoves on both sides.",
  },
  {
    id: "choked_corridor", shape: "corridor", openness: "tight", cover: "sparse", doors: CORRIDOR_DOORS,
    zoneSlots: [C_ALCOVE_E, C_ALCOVE_W],
    spawnGroups: [C_FAR, C_FLANK_L],
    description: "A hall narrowed by heavy blockwork; the fight happens at short range whether you want it or not.",
  },
  {
    id: "open_ring", shape: "ring", openness: "open", cover: "none", doors: RING_DOORS,
    zoneSlots: [R_ARC_N, R_ARC_S],
    spawnGroups: [R_OUTER, R_FLANK_L, R_FLANK_R],
    description: "A clear loop around a solid core; you can always circle away, never shoot across.",
  },
  {
    id: "cover_ring", shape: "ring", openness: "mixed", cover: "dense", doors: RING_DOORS,
    zoneSlots: [R_ARC_N, R_ARC_S],
    spawnGroups: [R_OUTER, R_FLANK_L, R_FLANK_R],
    description: "A loop around a solid core with pillars on the outer track; circling costs line of sight.",
  },
  {
    id: "cross_open", shape: "cross", openness: "open", cover: "sparse", doors: CROSS_DOORS,
    zoneSlots: [X_CENTRE, X_CORNER_NE],
    spawnGroups: [X_FAR, X_FLANK_L, X_FLANK_R, X_SURROUND],
    description: "Four clear arms meeting at a wide junction; every door leads straight to the middle.",
  },
  {
    id: "cross_tight", shape: "cross", openness: "tight", cover: "dense", doors: CROSS_DOORS,
    zoneSlots: [X_CORNER_NE, X_CORNER_NW],
    spawnGroups: [X_FAR, X_FLANK_L, X_FLANK_R],
    description: "A crossing clogged with cover; the arms become short, blind approaches.",
  },
  /* boss arenas: arena shaped, differing only in cover (doc 004, "Boss arena") */
  {
    id: "boss_open", shape: "arena", openness: "open", cover: "none", doors: ARENA_DOORS, boss: true,
    zoneSlots: [], spawnGroups: [A_SURROUND],
    description: "A bare boss arena: nothing between you and it.",
  },
  {
    id: "boss_scattered", shape: "arena", openness: "open", cover: "sparse", doors: ARENA_DOORS, boss: true,
    zoneSlots: [], spawnGroups: [A_SURROUND],
    description: "A boss arena with a handful of pillars around the edge of the fighting floor.",
  },
  {
    id: "boss_pillared", shape: "arena", openness: "open", cover: "dense", doors: ARENA_DOORS, boss: true,
    zoneSlots: [], spawnGroups: [A_SURROUND],
    description: "A boss arena ringed with pillars; the centre stays clear for the fight.",
  },
];

export const SPACE_ARCHETYPES: readonly SpaceArchetype[] = DEFS.map((d) => ({
  id: d.id,
  shape: d.shape,
  openness: d.openness,
  cover: d.cover,
  doors: d.doors,
  zoneSlots: d.zoneSlots,
  spawnGroups: d.spawnGroups,
  ...(d.boss ? { boss: true as const } : {}),
  description: d.description,
}));

const BY_ID = new Map<SpaceArchetypeId, SpaceArchetype>(SPACE_ARCHETYPES.map((a) => [a.id, a]));

export function archetype(id: SpaceArchetypeId): SpaceArchetype {
  const a = BY_ID.get(id);
  if (!a) throw new Error(`unknown space archetype ${id}`);
  return a;
}

export const PLAYABLE_ARCHETYPES: readonly SpaceArchetype[] =
  SPACE_ARCHETYPES.filter((a) => a.boss !== true);
export const BOSS_ARCHETYPES: readonly SpaceArchetype[] =
  SPACE_ARCHETYPES.filter((a) => a.boss === true);

/** The boss arena keeps this block clear and all cover at least 3 tiles away. */
export const BOSS_CENTRE: readonly Cell[] = rect(7, 4, 7, 5);
export const BOSS_COVER_CLEARANCE = 3;

/* -------------------------- declaration self-check -------------------------- */

/**
 * Proves the design claim: every declared cell is free floor under the mask for
 * every symmetry setting (the mask does not depend on symmetry, and obstacle
 * placement reserves these cells and their mirrors), far enough from the doors,
 * and not shared between a zone and a spawn.
 */
export function checkArchetypeDeclarations(a: SpaceArchetype): string[] {
  const problems: string[] = [];
  const mask = maskFor(a.shape);
  const seenZone = new Map<string, string>();

  for (const z of a.zoneSlots) {
    if (z.cells.length === 0) problems.push(`${a.id}/${z.id}: empty slot`);
    for (const cell of z.cells) {
      const key = `${cell[0]},${cell[1]}`;
      if (!isFloor(mask, cell[0], cell[1])) problems.push(`${a.id}/${z.id}: ${key} is not mask floor`);
      const prev = seenZone.get(key);
      if (prev) problems.push(`${a.id}/${z.id}: ${key} already used by ${prev}`);
      seenZone.set(key, z.id);
      for (const side of a.doors) {
        if (manhattan(cell, DOOR_CELL[side]) < HAZARD_DOOR_CLEARANCE) {
          problems.push(`${a.id}/${z.id}: ${key} is within ${HAZARD_DOOR_CLEARANCE} of door ${side}`);
        }
      }
    }
  }

  for (const g of a.spawnGroups) {
    if (g.cells.length === 0) problems.push(`${a.id}/${g.id}: empty spawn group`);
    for (const cell of g.cells) {
      const key = `${cell[0]},${cell[1]}`;
      if (!isFloor(mask, cell[0], cell[1])) problems.push(`${a.id}/${g.id}: ${key} is not mask floor`);
      const z = seenZone.get(key);
      if (z) problems.push(`${a.id}/${g.id}: ${key} collides with zone ${z}`);
      for (const side of a.doors) {
        if (manhattan(cell, DOOR_CELL[side]) < SPAWN_ENTRY_CLEARANCE) {
          problems.push(`${a.id}/${g.id}: ${key} is within ${SPAWN_ENTRY_CLEARANCE} of entry ${side}`);
        }
      }
    }
  }

  if (a.shape === "ring" && a.zoneSlots.some((z) => z.id === "centre")) {
    problems.push(`${a.id}: a ring may not declare a centre zone slot`);
  }
  if (a.shape === "ring" && a.spawnGroups.some((g) => g.id === "centre")) {
    problems.push(`${a.id}: a ring may not declare a centre spawn group`);
  }
  return problems;
}
