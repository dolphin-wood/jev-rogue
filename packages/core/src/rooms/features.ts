/**
 * The feature library (doc 004, "Feature library").
 *
 * Eight features fill the zone slots a room declares. Jev answers one question
 * per declared slot in round 2, so a feature never collides with another and
 * never overfills the room; the only cross-slot rules are the `resource`
 * post-filter (two slots that pick features sharing a resource keep the
 * higher-probability one) and the hazard budget against `hazard_cap`.
 */
import type { Extent, Feature } from "../types.ts";
import { rectAt } from "./extent.ts";
import type { HazardCap } from "../content/tags.ts";
import { groundFits } from "./biome.ts";
import type { Biome } from "./biome.ts";

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
  /*
   * `crumble_floor` was here: a floor that took a heart off anyone who stood
   * on it for three seconds. It was removed as a duplicate of the spike
   * strip — both are a floor hazard that charges for dwelling — and because
   * it was unreadable: it was drawn with the decorative crack decal, so the
   * floor that hurt and the floor that did not looked the same, and nothing
   * telegraphed its clock or collapsed when it ran out.
   */
  {
    id: "lava_channel",
    description: "Lava channel: a one-tile line of molten rock across the zone. Walking over it burns; a dash crosses it untouched. Splits a space without closing it.",
    tags: ["hazard", "damage_zone", "movement_pressure"],
    slot_kind: "zone",
    hazard_budget: 2,
    /** A line, never a pool: a dash always clears it and the floor goes round it. See `featureCells`. */
    hazard_effect: "lava",
    resource: "floor_hazard",
  },
  {
    id: "grass_patch",
    description: "Grass: burns once when fire reaches it, and the fire runs through the patch. Grass fire burns everyone in it, whoever lit it: a trap for whoever stands in it when it goes up.",
    tags: ["hazard", "damage_zone", "area_denial"],
    slot_kind: "zone",
    hazard_budget: 1,
    /**
     * Harmless until lit; then it is fire, whose owner is whoever lit it. See
     * `stepGrass`. It shares no resource: grass beside a floor hazard is two
     * different things to cross, not two of one.
     */
    hazard_effect: "none",
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

/**
 * The cells a feature actually covers in its zone.
 *
 * Every feature fills its zone except lava, which runs **one tile thick**
 * along the zone's long axis through its middle: a line a dash (64 px) clears
 * from any side, with floor all round it, so it splits a space without
 * closing it. A pool of it would be a wall that hurts.
 */
export function featureCells(id: string, cells: readonly (readonly [number, number])[]): readonly (readonly [number, number])[] {
  if (id !== "lava_channel" || cells.length === 0) return cells;
  const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const wide = x1 - x0 >= y1 - y0;
  const mid = wide ? Math.round((y0 + y1) / 2) : Math.round((x0 + x1) / 2);
  return cells.filter(([x, y]) => (wide ? y === mid : x === mid));
}

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
  const offered = FEATURES.filter((f) => !UNDRAWN.has(f.id));
  return cap === "none" ? offered.filter((f) => !isHazard(f)) : offered;
}

/**
 * Features the simulation has and no room is given yet, because their art is
 * not drawn. Lava works — it burns, a dash crosses it, bodies route round it —
 * but four versions of it drawn in code each read as a strip laid on the
 * floor rather than a channel in it: the floor is painted art with its own
 * outline and light, and code-drawn lava had neither. It waits on its tiles
 * (`docs/art-workorder-codex.md`).
 */
const UNDRAWN: ReadonlySet<string> = new Set(["lava_channel"]);

/**
 * The middle of the arena, in grid cells: the band a fight actually happens in.
 *
 * Deliberately generous. A room is 21 x 13 and this is its middle third by
 * width and its middle five rows, which is where the player and everything
 * chasing them spend a fight.
 */
/** The middle of the room: base cells 7..13 by 4..8, stretched to the extent. */
const CORE: readonly [number, number, number, number] = [7, 4, 7, 5];

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
export function centralZone(cells: readonly (readonly [number, number])[], ext: Extent): boolean {
  if (cells.length === 0) return false;
  const [x0, y0, w, h] = rectAt(CORE, ext);
  let inside = 0;
  for (const [x, y] of cells)
    if (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h) inside++;
  return inside * 2 > cells.length;
}

/** What may fill one zone: the cap's features, minus solids in the middle. */
export function featuresForZone(
  cap: HazardCap, cells: readonly (readonly [number, number])[], ext: Extent,
  /** The room's depth: only its own ground is offered (`BIOME_GROUND`). */
  biome?: Biome,
): readonly Feature[] {
  const offered = featuresForCap(cap).filter((f) => groundFits(biome, f.id));
  return centralZone(cells, ext) ? offered.filter((f) => !f.fixture) : offered;
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
  ext: Extent,
  biome?: Biome,
): Z[] {
  const weightNone = 2;
  const seen = new Set<string>();
  return zones.map((z) => {
    const offered = featuresForZone(cap, z.cells, ext, biome);
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

/**
 * The floor features the first audience's edge may carry (doc 022, "The
 * arena"): ground that asks something, each within a hazard budget of 2 and
 * drawn (`lava_channel` waits on its tiles, `UNDRAWN`). No
 * `turret_mount` — a turret is a body, and the landing leaves none — and no
 * brazier here, because the braziers are the other edge's.
 */
export const AUDIENCE_FLOOR_FEATURES: readonly string[] = [
  "spike_strip", "poison_pool", "ice_patch", "grass_patch",
];

/**
 * **The first audience's edges**, chosen by code (doc 022): one edge stands
 * braziers, cover the player can spend and one of his blows breaks; the other
 * stands braziers too, or carries at most one floor feature. Which edge is
 * which, and which ground, come from the room's own stream.
 */
export function audienceZones<Z extends { readonly id: string; readonly feature: string }>(
  zones: readonly Z[],
  rng: { next(): number },
): Z[] {
  const braziers = rng.next() < 0.5 ? 0 : 1;
  const ground = rng.next() < 0.5
    ? AUDIENCE_FLOOR_FEATURES[Math.floor(rng.next() * AUDIENCE_FLOOR_FEATURES.length)]!
    : "brazier";
  return zones.map((z, i) => ({ ...z, feature: i === braziers ? "brazier" : ground }));
}
