/**
 * `simulateStaff` and `bestLegalPlacement` (design doc 006, "Simulator" and
 * "Evaluating a candidate item").
 *
 * The simulator is the game minus rendering, input and enemies: it runs the
 * same parse and the same cast loop, and turns the totals into the closed
 * label vocabulary of doc 010. Only the labels reach Jev.
 */

import type { BaseItem, CastTree, ItemInstance, Staff, StaffSim } from "../types.ts";
import type { Bottleneck, BuildArchetype, Element, ManaSustain, Role, Scatter } from "../content/tags.ts";
import { baseOf, ITEMS, type ItemRegistry } from "./items.ts";
import { parseCastTree } from "./parse.ts";
import { runCastLoop, type CastLoopResult, type TargetKind } from "./execute.ts";

/** Doc 006 confirms on both targets for 30 s and screens on the moving target
 *  for 10 s; both configurations go through this one function. */
export const CONFIRM: SimOptions = { duration: 30, targets: ["stationary", "moving"] };
export const SCREEN: SimOptions = { duration: 10, targets: ["moving"] };

export interface SimOptions {
  readonly duration?: number;
  readonly targets?: readonly TargetKind[];
  readonly dt?: number;
  readonly dominantElement?: Element;
}

/** Roles a staff is expected to cover; anything absent is a missing role. */
export const REQUIRED_ROLES: readonly Role[] = [
  "attack", "boost", "passive", "tracking", "sustain", "mana_regen",
];

const SCATTER_TIGHT = 8;
const SCATTER_WIDE = 20;
const SKIP_STARVED = 0.25;
const SKIP_TIGHT = 0.02;
const HIT_RATE_ACCURATE = 0.55;
const IDLE_SHARE_SLOW = 0.5;
/** Below this the staff is not killing anything, whatever else is true. */
const DPS_FLOOR = 12;

function manaSustainOf(res: CastLoopResult, regenPerSecond: number): ManaSustain {
  const skip = res.castsAttempted > 0 ? res.castsSkipped / res.castsAttempted : 0;
  if (skip >= SKIP_STARVED) return "starved";
  if (skip > SKIP_TIGHT) return "tight";
  const demand = res.manaSpent / res.duration;
  return demand > regenPerSecond * 0.9 ? "tight" : "comfortable";
}

function scatterOf(res: CastLoopResult): Scatter {
  if (res.meanSpread < SCATTER_TIGHT) return "tight";
  if (res.meanSpread < SCATTER_WIDE) return "medium";
  return "wide";
}

function equippedBases(slots: readonly (ItemInstance | null)[], items: ItemRegistry): BaseItem[] {
  const out: BaseItem[] = [];
  for (const inst of slots) if (inst) out.push(baseOf(inst, items));
  return out;
}

function archetypeOf(bases: readonly BaseItem[], dotShare: number): BuildArchetype {
  const tally: Record<string, number> = { spam: 0, nuke: 0, area: 0, dot: 0, melee: 0 };
  for (const b of bases) {
    for (const tag of b.tags) if (tag in tally) tally[tag] = (tally[tag] ?? 0) + 1;
  }
  // Damage that actually arrived as a dot counts as evidence for `dot`.
  if (dotShare > 0.35) tally["dot"] = (tally["dot"] ?? 0) + 1;
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const first = ranked[0];
  const second = ranked[1];
  if (!first || first[1] === 0) return "mixed";
  if (second && second[1] === first[1]) return "mixed";
  return first[0] as BuildArchetype;
}

function bottleneckOf(
  moving: CastLoopResult,
  sustain: ManaSustain,
  dpsMoving: number,
  castInterval: number,
  cooldown: number,
): Bottleneck {
  if (moving.units === 0) return "damage";
  if (sustain === "starved") return "mana";
  const hitRate = moving.projectilesFired > 0 ? moving.projectileHits / moving.projectilesFired : 0;
  if (hitRate < HIT_RATE_ACCURATE) return "accuracy";
  const active = moving.units * castInterval;
  if (cooldown / (active + cooldown) > IDLE_SHARE_SLOW) return "cast_frequency";
  if (dpsMoving < DPS_FLOOR) return "damage";
  return "none";
}

function missingRolesOf(bases: readonly BaseItem[]): Role[] {
  const have = new Set<string>();
  for (const b of bases) for (const tag of b.tags) have.add(tag);
  return REQUIRED_ROLES.filter((r) => !have.has(r));
}

function dominantTagsOf(bases: readonly BaseItem[]): string[] {
  const tally = new Map<string, number>();
  for (const b of bases) {
    for (const tag of b.tags) {
      if (tag === "none") continue; // the element placeholder is not a signal
      tally.set(tag, (tally.get(tag) ?? 0) + 1);
    }
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([tag]) => tag);
}

export interface SimDetail {
  readonly sim: StaffSim;
  readonly tree: CastTree;
  readonly stationary: CastLoopResult | null;
  readonly moving: CastLoopResult;
}

export function simulateStaffDetail(
  staff: Staff,
  slots: readonly (ItemInstance | null)[],
  items: ItemRegistry = ITEMS,
  opts: SimOptions = CONFIRM,
): SimDetail {
  const duration = opts.duration ?? 30;
  const targets = opts.targets ?? ["stationary", "moving"];
  const tree = parseCastTree(slots, items);
  const cfg = { duration, dt: opts.dt, dominantElement: opts.dominantElement };

  const moving = runCastLoop(staff, tree, items, { ...cfg, target: "moving" });
  const stationary = targets.includes("stationary")
    ? runCastLoop(staff, tree, items, { ...cfg, target: "stationary" })
    : null;

  const bases = equippedBases(slots, items);
  const dpsMoving = moving.damage / duration;
  // Screening skips the stationary target; the labels it feeds never read it.
  const dpsStationary = stationary ? stationary.damage / duration : dpsMoving;

  const passiveRegen = tree.passives.reduce(
    (sum, inst) => sum + (Number(baseOf(inst, items).params["regen_add"] ?? 0) + (inst.modifier?.["regen_add"] ?? 0)),
    0,
  );
  const sustain = manaSustainOf(moving, staff.mana_regen + passiveRegen);
  const dotShare = moving.damage > 0 ? moving.dotDamage / moving.damage : 0;

  const sim: StaffSim = {
    dps_stationary: dpsStationary,
    dps_moving: dpsMoving,
    mana_sustain: sustain,
    cycle_time: moving.cycleTime,
    scatter: scatterOf(moving),
    archetype: archetypeOf(bases, dotShare),
    bottleneck: bottleneckOf(moving, sustain, dpsMoving, staff.cast_interval, staff.cooldown),
    missing_roles: missingRolesOf(bases),
    dominant_tags: dominantTagsOf(bases),
  };
  return { sim, tree, stationary, moving };
}

export function simulateStaff(
  staff: Staff,
  slots: readonly (ItemInstance | null)[],
  items: ItemRegistry = ITEMS,
  opts: SimOptions = CONFIRM,
): StaffSim {
  return simulateStaffDetail(staff, slots, items, opts).sim;
}

/* --------------------- evaluating a candidate item ------------------------ */

export interface Placement {
  /** Index the candidate occupies, or null for "leave it in spare inventory". */
  readonly index: number | null;
  readonly slots: readonly (ItemInstance | null)[];
  readonly replaced: ItemInstance | null;
  readonly sim: StaffSim;
}

export interface LabelDelta {
  readonly field: "bottleneck" | "mana_sustain" | "archetype";
  readonly from: string;
  readonly to: string;
}

export interface PlacementReport {
  readonly current: StaffSim;
  readonly best: Placement;
  readonly considered: number;
  /** At most two transitions, most important first (doc 010, rule 3). */
  readonly deltas: readonly LabelDelta[];
}

export interface PlacementOptions extends SimOptions {
  /** Present when the staff is full: the swap into spare inventory is legal. */
  readonly allowInventory?: boolean;
}

/** A unit-producing item: the thing a boost needs to its right and a payload
 *  or multicast needs to capture. */
function producesUnit(base: BaseItem): boolean {
  return base.kind === "attack" || base.kind === "payload" || base.kind === "multicast";
}

/**
 * Structural pruning (doc 006, "Prune placements"): positions that cannot
 * change the tree are never simulated.
 */
function legalIndices(
  arrangementLength: number,
  candidate: BaseItem,
  after: (index: number) => readonly (ItemInstance | null)[],
  items: ItemRegistry,
): number[] {
  if (candidate.kind === "passive") return [0]; // position is irrelevant
  const out: number[] = [];
  for (let i = 0; i < arrangementLength; i++) {
    if (candidate.kind === "attack") {
      out.push(i);
      continue;
    }
    const arranged = after(i);
    let followed = false;
    for (let j = i + 1; j < arranged.length; j++) {
      const inst = arranged[j];
      if (inst && producesUnit(baseOf(inst, items))) {
        followed = true;
        break;
      }
    }
    if (followed) out.push(i);
  }
  return out;
}

function deltasBetween(current: StaffSim, best: StaffSim): LabelDelta[] {
  const all: LabelDelta[] = [];
  if (current.bottleneck !== best.bottleneck)
    all.push({ field: "bottleneck", from: current.bottleneck, to: best.bottleneck });
  if (current.mana_sustain !== best.mana_sustain)
    all.push({ field: "mana_sustain", from: current.mana_sustain, to: best.mana_sustain });
  if (current.archetype !== best.archetype)
    all.push({ field: "archetype", from: current.archetype, to: best.archetype });
  return all.slice(0, 2);
}

/**
 * Best legal placement: try the candidate everywhere it could legally go and
 * keep the arrangement with the highest `dps_moving`.
 */
export function bestLegalPlacement(
  staff: Staff,
  slots: readonly (ItemInstance | null)[],
  candidate: ItemInstance,
  items: ItemRegistry = ITEMS,
  opts: PlacementOptions = SCREEN,
): PlacementReport {
  const width = Math.max(staff.slots, slots.length);
  const current = slots.slice(0, width);
  while (current.length < width) current.push(null);
  const currentSim = simulateStaff(staff, current, items, opts);

  const base = baseOf(candidate, items);
  const occupied = current.filter((s): s is ItemInstance => s !== null);
  const hasFreeSlot = occupied.length < width;

  const arrangements: { index: number; slots: (ItemInstance | null)[]; replaced: ItemInstance | null }[] = [];

  if (hasFreeSlot) {
    // A free slot means insertion, not overwrite: order is the whole game.
    const insert = (i: number): (ItemInstance | null)[] => {
      const next = [...occupied];
      next.splice(i, 0, candidate);
      const padded: (ItemInstance | null)[] = [...next];
      while (padded.length < width) padded.push(null);
      return padded;
    };
    const indices = legalIndices(occupied.length + 1, base, insert, items);
    for (const i of indices) arrangements.push({ index: i, slots: insert(i), replaced: null });
  } else {
    const replace = (i: number): (ItemInstance | null)[] => {
      const next = [...current];
      next[i] = candidate;
      return next;
    };
    const indices = legalIndices(width, base, replace, items);
    for (const i of indices) arrangements.push({ index: i, slots: replace(i), replaced: current[i] ?? null });
  }

  let best: Placement = {
    index: null,
    slots: current,
    replaced: null,
    sim: currentSim,
  };
  // With a free slot the candidate is always equipped; a full staff may prefer
  // the spare-inventory swap, which is the "keep what you have" option.
  let bestDps = hasFreeSlot && arrangements.length > 0 ? -Infinity : currentSim.dps_moving;
  if (hasFreeSlot && arrangements.length === 0) {
    // Nothing structural to gain (e.g. a boost with no attack anywhere): the
    // only legal arrangement is still to append it at the end.
    const appended: (ItemInstance | null)[] = [...occupied, candidate];
    while (appended.length < width) appended.push(null);
    arrangements.push({ index: occupied.length, slots: appended, replaced: null });
  }
  if (opts.allowInventory === false && arrangements.length > 0) bestDps = -Infinity;

  for (const a of arrangements) {
    const sim = simulateStaff(staff, a.slots, items, opts);
    if (sim.dps_moving > bestDps) {
      bestDps = sim.dps_moving;
      best = { index: a.index, slots: a.slots, replaced: a.replaced, sim };
    }
  }

  return {
    current: currentSim,
    best,
    considered: arrangements.length,
    deltas: deltasBetween(currentSim, best.sim),
  };
}
