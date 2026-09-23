/**
 * Affixes and their build-time calibration (design doc 006, "Item affixes:
 * Jev intent, generated modifier").
 *
 * Jev picks an intent; code turns it into a concrete modifier per item kind and
 * then calibrates its magnitude until the affixed item measures inside the
 * rarity band above its base, or gives up and drops the affix. Calibration
 * depends only on `(base, affix, starting magnitude)` and the reference
 * arrangements, never on the player's staff, so the whole table resolves once.
 */

import type { AffixId, BaseItem, ItemInstance, Staff } from "../types.ts";
import type { Rarity } from "../content/tags.ts";
import { ITEMS, baseOf, plainInstance, type ItemRegistry } from "./items.ts";
import { DOMINANT_ELEMENT_CODE } from "./execute.ts";
import { REFERENCE_STAFF, staffFor } from "./staff.ts";
import { simulateStaff, type SimOptions } from "./simulate.ts";

export const AFFIX_IDS: readonly AffixId[] = ["homing", "cheaper", "wider", "heavier", "elemental"];

export type AffixRarity = Extract<Rarity, "uncommon" | "rare">;

/** Doc 006: "uncommon 1.15 to 1.35x base value, rare 1.35 to 1.7x". */
export const RARITY_BANDS: Readonly<Record<AffixRarity, readonly [number, number]>> = {
  uncommon: [1.15, 1.35],
  rare: [1.35, 1.7],
};

/** Doc 006: "Rare cards receive the modifier at 1.5x magnitude." */
export const START_MAGNITUDE: Readonly<Record<AffixRarity, number>> = { uncommon: 1, rare: 1.5 };
/** Doc 006: "0 < m <= 1.5". */
export const MAX_MAGNITUDE = 1.5;
export const MIN_MAGNITUDE = 0.05;
/** Doc 006: "scale the modifier magnitude toward the band up to 3 times". */
export const MAX_RESCALES = 3;

/* ------------------------------- the modifier ------------------------------ */

/**
 * The concrete deltas an intent becomes on a given base item, at magnitude `m`.
 * Returns null when the intent is not applicable to the kind, which doc 006
 * requires to fall to `none` (homing on a passive).
 *
 * `scope_*` keys act on everything fired inside the item's scope; the bare keys
 * act on the item's own projectile.
 */
export function affixModifier(
  base: BaseItem,
  affix: AffixId,
  m: number,
): Record<string, number> | null {
  const scoped = base.kind === "boost" || base.kind === "payload" || base.kind === "multicast";
  // A payload is both a carrier projectile and a scope, so a payload takes the
  // attack-side modifier too where one exists.
  const carrier = base.kind === "payload";

  switch (affix) {
    case "homing":
      if (base.kind === "passive") return null;
      if (scoped) return carrier ? { scope_homing: 0.25 * m, homing: 0.25 * m } : { scope_homing: 0.25 * m };
      return { homing: 0.25 * m };
    case "cheaper":
      if (base.kind === "passive") return { regen_add: 2 * m };
      if (scoped) {
        const scope = { scope_mana_mult: Math.max(0.2, 1 - 0.2 * m) };
        return carrier ? { ...scope, mana_mult: Math.max(0.2, 1 - 0.25 * m) } : scope;
      }
      return { mana_mult: Math.max(0.2, 1 - 0.25 * m) };
    case "wider":
      if (base.kind === "passive") return { tracking_add: 0.3 * m };
      if (scoped) {
        const scope = { scope_count_add: 1 * m };
        return carrier ? { ...scope, radius_mult: 1 + 0.5 * m } : scope;
      }
      return { radius_mult: 1 + 0.5 * m, spread_add: 6 * m };
    case "heavier":
      if (base.kind === "passive") return { crit_add: 0.05 * m };
      if (scoped) {
        const scope = { scope_damage_mult: 1 + 0.3 * m };
        return carrier
          ? { ...scope, damage_mult: 1 + 0.3 * m, speed_mult: Math.max(0.3, 1 - 0.15 * m) }
          : scope;
      }
      return { damage_mult: 1 + 0.3 * m, speed_mult: Math.max(0.3, 1 - 0.15 * m) };
    case "elemental":
      if (base.kind === "passive") return { element_tick_mult: 1 + 0.4 * m };
      if (scoped) {
        const scope = { scope_element_code: DOMINANT_ELEMENT_CODE, scope_element_power: m };
        return carrier ? { ...scope, element_code: DOMINANT_ELEMENT_CODE, element_power: m } : scope;
      }
      return { element_code: DOMINANT_ELEMENT_CODE, element_power: m };
  }
}

export function affixedInstance(
  baseId: string,
  affix: AffixId,
  rarity: AffixRarity,
  magnitude: number,
  uid = `${baseId}:${affix}:${rarity}`,
  items: ItemRegistry = ITEMS,
): ItemInstance {
  const base = baseOf({ base: baseId }, items);
  const modifier = affixModifier(base, affix, magnitude);
  if (!modifier) return { ...plainInstance(baseId, uid, items), rarity };
  return { uid, base: baseId, affix, magnitude, modifier, rarity };
}

/* ------------------------- the reference arrangements ---------------------- */

/** Doc 006's reference attack: the cheapest common attack, so a boost's own
 *  contribution is not drowned out by the attack it rides on. */
export const REFERENCE_ATTACK = "magic_bolt";
export const REFERENCE_SECOND_ATTACK = "stone_shard";
/** A passive carrying the `elemental` intent scales element ticks, so its
 *  reference arrangements must contain an element to scale. */
export const REFERENCE_ELEMENTAL_ATTACK = "ember_dart";

/** Calibration measures on the moving target only, but for the simulator's
 *  full 30 s: a 10 s window is short enough that a full starting mana pool
 *  hides the mana economy, and the `cheaper` intent would measure as a no-op. */
export const CALIBRATION: SimOptions = { duration: 30, targets: ["moving"] };

/**
 * The quick four-slot staff, used for the second reference arrangement.
 *
 * Doc 006 says "reference arrangements", plural, and it has to be plural: on a
 * comfortable staff the `cheaper` intent changes nothing at all, so measured
 * there alone every cheaper affix would degrade to `none`. The lean
 * arrangement shows what an affix does to one spell; the pressed one fills the
 * staff so the mana economy binds. An affix is judged on its best case, which
 * is also how doc 006's balance rules read boosts ("in *some* reference
 * arrangement").
 */
export const PRESSED_STAFF = staffFor({ slots: "few", mana: "low", tempo: "quick", special: "none" });

export interface ReferenceArrangement {
  readonly staff: Staff;
  readonly slots: readonly (ItemInstance | null)[];
}

function copies(inst: ItemInstance, n: number): ItemInstance[] {
  return Array.from({ length: n }, (_, i) => ({ ...inst, uid: `${inst.uid}#${i}` }));
}

export function referenceArrangements(
  base: BaseItem,
  inst: ItemInstance,
  items: ItemRegistry = ITEMS,
): ReferenceArrangement[] {
  const a = (id: string, uid: string) => plainInstance(id, uid, items);
  switch (base.kind) {
    case "attack":
      return [
        { staff: REFERENCE_STAFF, slots: [inst] },
        { staff: PRESSED_STAFF, slots: copies(inst, 4) },
      ];
    case "passive":
      return [
        { staff: REFERENCE_STAFF, slots: [inst, a(REFERENCE_ELEMENTAL_ATTACK, "ref_a")] },
        {
          staff: PRESSED_STAFF,
          slots: [inst, a(REFERENCE_ELEMENTAL_ATTACK, "ref_a"), a(REFERENCE_ELEMENTAL_ATTACK, "ref_b"), a(REFERENCE_ELEMENTAL_ATTACK, "ref_c")],
        },
      ];
    case "multicast":
      return [
        { staff: REFERENCE_STAFF, slots: [inst, a(REFERENCE_ATTACK, "ref_a"), a(REFERENCE_SECOND_ATTACK, "ref_b")] },
        {
          staff: PRESSED_STAFF,
          slots: [inst, a(REFERENCE_ATTACK, "ref_a"), a(REFERENCE_SECOND_ATTACK, "ref_b"), a(REFERENCE_ATTACK, "ref_c")],
        },
      ];
    case "boost":
      return [
        { staff: REFERENCE_STAFF, slots: [inst, a(REFERENCE_ATTACK, "ref_a")] },
        {
          staff: PRESSED_STAFF,
          slots: [inst, a(REFERENCE_ATTACK, "ref_a"), a(REFERENCE_ATTACK, "ref_b"), a(REFERENCE_ATTACK, "ref_c")],
        },
      ];
    case "payload":
      return [
        { staff: REFERENCE_STAFF, slots: [inst, a(REFERENCE_ATTACK, "ref_a")] },
        {
          staff: PRESSED_STAFF,
          slots: [inst, a(REFERENCE_ATTACK, "ref_a"), ...copies(inst, 1).map((c) => ({ ...c, uid: "carrier_b" })), a(REFERENCE_ATTACK, "ref_b")],
        },
      ];
  }
}

/** One dps_moving reading per reference arrangement, in a stable order. */
function measure(base: BaseItem, inst: ItemInstance, items: ItemRegistry): number[] {
  return referenceArrangements(base, inst, items).map((r) =>
    simulateStaff(r.staff, r.slots, items, CALIBRATION).dps_moving,
  );
}

/** An affix is in band when its best reference arrangement is. */
function bestRatio(baseValues: readonly number[], values: readonly number[]): number {
  let best = 0;
  for (let i = 0; i < values.length; i++) {
    const b = baseValues[i] ?? 0;
    if (b <= 0) continue;
    best = Math.max(best, (values[i] ?? 0) / b);
  }
  return best;
}

/* ------------------------------- calibration ------------------------------- */

export interface ResolvedAffix {
  readonly base: string;
  readonly affix: AffixId;
  readonly rarity: AffixRarity;
  /** 0 when the affix was dropped. */
  readonly magnitude: number;
  readonly modifier: Readonly<Record<string, number>> | null;
  /** Measured value relative to the unaffixed base in the same arrangement. */
  readonly ratio: number;
  readonly attempts: number;
  /** `dropped` means the shipped card carries no affix (doc 006's `none`). */
  readonly status: "in_band" | "dropped";
}

export function calibrate(
  baseId: string,
  affix: AffixId,
  rarity: AffixRarity,
  items: ItemRegistry = ITEMS,
  baseValueHint?: readonly number[],
): ResolvedAffix {
  const base = baseOf({ base: baseId }, items);
  const dropped = (ratio: number, attempts: number, magnitude = 0): ResolvedAffix => ({
    base: baseId, affix, rarity, magnitude, modifier: null, ratio, attempts, status: "dropped",
  });

  if (!affixModifier(base, affix, START_MAGNITUDE[rarity])) return dropped(1, 0);

  const baseValues = baseValueHint ?? measure(base, plainInstance(baseId, "cand", items), items);
  if (!baseValues.some((v) => v > 0)) return dropped(0, 0);

  const [lo, hi] = RARITY_BANDS[rarity];
  const target = (lo + hi) / 2;
  let m = START_MAGNITUDE[rarity];
  let ratio = 0;

  for (let attempt = 0; attempt <= MAX_RESCALES; attempt++) {
    const inst = affixedInstance(baseId, affix, rarity, m, "cand", items);
    ratio = bestRatio(baseValues, measure(base, inst, items));
    if (ratio >= lo && ratio <= hi) {
      return {
        base: baseId, affix, rarity, magnitude: m,
        modifier: inst.modifier, ratio, attempts: attempt + 1, status: "in_band",
      };
    }
    if (attempt === MAX_RESCALES) break;
    // Scale the magnitude toward the band. The effect of an affix is not
    // linear in its magnitude, so this is an iteration, not a solve.
    const gain = ratio - 1;
    const next = Math.abs(gain) > 1e-6 ? m * ((target - 1) / gain) : m * 1.5;
    const clamped = Math.min(MAX_MAGNITUDE, Math.max(MIN_MAGNITUDE, next));
    if (Math.abs(clamped - m) < 1e-4) return dropped(ratio, attempt + 1);
    m = clamped;
  }
  return dropped(ratio, MAX_RESCALES + 1);
}

export type AffixTable = ReadonlyMap<string, ResolvedAffix>;

export function affixKey(baseId: string, affix: AffixId, rarity: AffixRarity): string {
  return `${baseId}|${affix}|${rarity}`;
}

let cached: AffixTable | null = null;

/**
 * The resolved table for every (base, affix, rarity). Memoized rather than a
 * top-level const: it costs a few hundred simulations, and importing an item
 * definition should not pay for that.
 */
export function resolveAffixTable(items: ItemRegistry = ITEMS): AffixTable {
  if (items === ITEMS && cached) return cached;
  const table = new Map<string, ResolvedAffix>();
  for (const base of items.values()) {
    const baseValues = measure(base, plainInstance(base.id, "cand", items), items);
    for (const affix of AFFIX_IDS) {
      for (const rarity of ["uncommon", "rare"] as const) {
        table.set(affixKey(base.id, affix, rarity), calibrate(base.id, affix, rarity, items, baseValues));
      }
    }
  }
  if (items === ITEMS) cached = table;
  return table;
}

export function lookupAffix(
  baseId: string,
  affix: AffixId,
  rarity: AffixRarity,
  table: AffixTable = resolveAffixTable(),
): ResolvedAffix {
  const row = table.get(affixKey(baseId, affix, rarity));
  if (!row) throw new Error(`no calibrated affix for ${affixKey(baseId, affix, rarity)}`);
  return row;
}

/**
 * The shipped card: the calibrated magnitude and its resolved deltas, or an
 * unaffixed instance at the offer's rarity when calibration dropped the affix.
 */
export function applyAffix(
  uid: string,
  baseId: string,
  affix: AffixId,
  rarity: AffixRarity,
  table: AffixTable = resolveAffixTable(),
  items: ItemRegistry = ITEMS,
): ItemInstance {
  const row = lookupAffix(baseId, affix, rarity, table);
  if (row.status === "dropped" || !row.modifier) {
    return { ...plainInstance(baseId, uid, items), rarity };
  }
  return { uid, base: baseId, affix, magnitude: row.magnitude, modifier: row.modifier, rarity };
}

/** Doc 006: affixed items display as "Base name, Affix". */
export function affixLabel(baseId: string, affix: AffixId | null): string {
  return affix ? `${baseId}, ${affix}` : baseId;
}
