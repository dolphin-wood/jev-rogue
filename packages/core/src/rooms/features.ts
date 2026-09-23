/**
 * The feature library (doc 004, "Feature library").
 *
 * Eight features fill the zone slots a room declares. Jev answers one question
 * per declared slot in round 2, so a feature never collides with another and
 * never overfills the room; the only cross-slot rules are the `resource`
 * post-filter (two slots that pick features sharing a resource keep the
 * higher-probability one) and the hazard budget against `hazard_cap`.
 */
import type { Feature } from "../types.ts";
import type { HazardCap } from "../content/tags.ts";

export const FEATURES: readonly Feature[] = [
  {
    id: "spike_strip",
    description: "Spike strip: damages on contact and restricts movement. Over-punishes a player already under movement pressure.",
    tags: ["hazard", "damage_zone", "movement_pressure"],
    slot_kind: "zone",
    hazard_budget: 2,
    /** The one feature that simply hurts. */
    hazard_effect: "contact",
    resource: "floor_hazard",
  },
  {
    id: "poison_pool",
    description: "Poison pool: a slow damage tick while standing in it. Denies the ground rather than the moment.",
    tags: ["hazard", "damage_zone", "area_denial"],
    slot_kind: "zone",
    hazard_budget: 2,
    /** Denies the ground rather than the moment, which its description always said and the simulation never did. */
    hazard_effect: "slow_tick",
    resource: "floor_hazard",
  },
  {
    id: "ice_patch",
    description: "Ice patch: sliding movement across the zone. Cheap pressure that rewards planning a path.",
    tags: ["hazard", "slow_zone", "movement_pressure"],
    slot_kind: "zone",
    hazard_budget: 1,
    /** No damage. It was drawn and described as sliding movement and implemented as a second spike strip. */
    hazard_effect: "slip",
    resource: "floor_hazard",
  },
  {
    id: "crumble_floor",
    description: "Crumbling floor: collapses three seconds after it is stood on. Punishes camping, not movement.",
    tags: ["hazard", "area_denial"],
    slot_kind: "zone",
    hazard_budget: 1,
    /** Punishes camping, not movement — so crossing it is free. */
    hazard_effect: "collapse",
    resource: "floor_hazard",
  },
  {
    id: "brazier",
    description: "Brazier: a solid pillar that blocks bodies and bullets both ways and breaks when shot enough. Cover you can spend.",
    fixture: "brazier",
    tags: ["cover"],
    slot_kind: "zone",
    hazard_budget: 0,
    /** Cover. It costs a slot, not a heart. */
    hazard_effect: "none",
  },
  {
    id: "turret_mount",
    description: "Turret mount: turns the zone into a turret spawn. Adds ranged pressure from a fixed place.",
    tags: ["hazard", "ranged_pressure", "area_denial"],
    slot_kind: "zone",
    hazard_budget: 3,
    /** A plinth for a turret to stand on. It was charging the player a heart for standing where the turret stands, which was 21% of all damage in the game. */
    hazard_effect: "none",
  },
];

export type FeatureId = (typeof FEATURES)[number]["id"];

/*
 * The mana font is gone. It was a basin that paid mana to anyone standing
 * within reach of it, and it paid for something the design already pays for
 * three ways — a full bar on entering a room, the sword's hit-to-earn, and
 * broken scenery — while asking the player to stand still in a game whose
 * every other rule asks them to move. Its reach ignored walls and it rolled
 * into corners, so the floor ring was mostly drawn over stone.
 */

/**
 * The spike strip's clock: out for the second half of every period, retracted
 * for the first. **One function for the simulation and the renderer**, so the
 * spikes bite exactly when they are drawn out and never when they are drawn
 * flat. The period was about half a second, which read as a shiver and, since
 * the damage ignored it, was also a lie; 2.4 s is a beat a player can time a
 * crossing to, which is what a spike strip is for.
 */
export const SPIKE_PERIOD_MS = 2400;
export function spikesOut(elapsedMs: number): boolean {
  return (elapsedMs % SPIKE_PERIOD_MS) >= SPIKE_PERIOD_MS / 2;
}

const BY_ID = new Map<string, Feature>(FEATURES.map((f) => [f.id, f]));

export function feature(id: string): Feature {
  const f = BY_ID.get(id);
  if (!f) throw new Error(`unknown feature ${id}`);
  return f;
}

/** Features grouped by the `resource` they compete for (the round-2 post-filter). */
export function featuresByResource(): ReadonlyMap<string, readonly Feature[]> {
  const out = new Map<string, Feature[]>();
  for (const f of FEATURES) {
    const key = f.resource ?? f.id;
    const list = out.get(key);
    if (list) list.push(f);
    else out.set(key, [f]);
  }
  return out;
}

/** Sum of `hazard_budget` allowed in one room per hazard cap (doc 003 / 004). */
export const HAZARD_CAP_BUDGET: Readonly<Record<HazardCap, number>> = {
  none: 0,
  low: 3,
  high: 6,
};

export function isHazard(f: Feature): boolean {
  return f.hazard_budget > 0;
}

/** The features a slot may be offered under a cap; `none` hides every hazard. */
export function featuresForCap(cap: HazardCap): readonly Feature[] {
  return cap === "none" ? FEATURES.filter((f) => !isHazard(f)) : FEATURES;
}

/**
 * The middle of the arena, in grid cells: the band a fight actually happens in.
 *
 * Deliberately generous. A room is 21 x 13 and this is its middle third by
 * width and its middle five rows, which is where the player and everything
 * chasing them spend a fight.
 */
const CORE_X = [7, 13] as const;
const CORE_Y = [4, 8] as const;

/**
 * Whether a zone sits in the middle of the room.
 *
 * A **solid** belongs at the edge of a fight, never in the middle of it. The
 * feature library is offered slot by slot and knows nothing about where the
 * slot is, so `A_CENTRE` — a five-by-three rectangle across the middle of the
 * open arena — could draw a mirror pillar and stand it exactly where the
 * player and everything chasing them have to be. Cover at the edge of the
 * floor is a decision about where to fight; cover in the centre is furniture
 * in the way of the fight.
 *
 * Floor hazards are not restricted this way: a hazard in the middle is the
 * whole point of a hazard, because the player can choose to cross it.
 */
export function centralZone(cells: readonly (readonly [number, number])[]): boolean {
  if (cells.length === 0) return false;
  let inside = 0;
  for (const [x, y] of cells)
    if (x >= CORE_X[0] && x <= CORE_X[1] && y >= CORE_Y[0] && y <= CORE_Y[1]) inside++;
  return inside * 2 > cells.length;
}

/** What may fill one zone: the cap's features, minus solids in the middle. */
export function featuresForZone(
  cap: HazardCap, cells: readonly (readonly [number, number])[],
): readonly Feature[] {
  const offered = featuresForCap(cap);
  return centralZone(cells) ? offered.filter((f) => !f.fixture) : offered;
}

export function totalHazardBudget(chosen: readonly (Feature | null)[]): number {
  let n = 0;
  for (const f of chosen) if (f) n += f.hazard_budget;
  return n;
}

/**
 * Fills a room's zone slots the way the Director's rule arm does, for rooms
 * built without it.
 *
 * The browser scene builds rooms straight from `generateRoom`, whose zones all
 * come out `feature: "none"`; only the harness went through the Director. So
 * the game the player was actually playing had **no floor hazards at all**,
 * while the harness measured a game in which hazards were most of the damage.
 * Two games, one set of numbers.
 *
 * The weights are the rule arm's even hand — `none` at 2, every offered
 * feature at 1 — under the same `hazard_cap`, with the same one-per-resource
 * dedupe. Not shared with the Director's code path, because that path is a
 * question for Jev with a rule fallback and this is only the fallback; but
 * the numbers are the same numbers and a test holds them together.
 */
export function assignZoneFeatures<
  Z extends { readonly id: string; readonly feature: string; readonly cells: readonly (readonly [number, number])[] },
>(
  zones: readonly Z[],
  cap: HazardCap,
  rng: { next(): number },
): Z[] {
  const weightNone = 2;
  const seen = new Set<string>();
  return zones.map((z) => {
    const offered = featuresForZone(cap, z.cells);
    const total = weightNone + offered.length;
    let roll = rng.next() * total;
    let picked: Feature | null = null;
    if (roll >= weightNone) {
      roll -= weightNone;
      picked = offered[Math.min(offered.length - 1, Math.floor(roll))] ?? null;
    }
    if (!picked) return z;
    if (picked.resource) {
      if (seen.has(picked.resource)) return z;
      seen.add(picked.resource);
    }
    return { ...z, feature: picked.id };
  });
}
