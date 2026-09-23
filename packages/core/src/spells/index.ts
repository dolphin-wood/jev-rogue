/** Public surface of the spell and staff system (design doc 006). */

export {
  BASE_ITEMS, ITEMS, registryOf, baseOf, plainInstance, num, str,
  type ItemRegistry,
} from "./items.ts";

export { parseCastTree, tickCount, MAX_DEPTH } from "./parse.ts";

export {
  runCastLoop, passiveMods, scopeMods, affixScope, emptyScope, mergeScope,
  instanceMana, subtreeCost, multicastCost, cycleCost, elementOfCode,
  ARENA_HALF_W, ARENA_HALF_H, TARGET_DISTANCE, TARGET_RADIUS, TARGET_SPEED,
  LEAD_BASE, LEAD_SWING, LEAD_PERIOD, leadFactor, PIERCE_TARGET_VALUE, MAX_FIRE_SOURCES, DOMINANT_ELEMENT_CODE,
  type CastLoopConfig, type CastLoopResult, type CostContext, type PassiveMods,
  type ScopeMods, type TargetKind,
} from "./execute.ts";

export {
  generateStaff, staffFor, staffCost, addSlot,
  STAFF_TABLE, ALL_PROFILES, FALLBACK_PROFILE, REFERENCE_STAFF, profileKey,
  BUDGET, BASELINE, COST, BANDS, COOLDOWN_FLOOR, MANA_CEILING,
} from "./staff.ts";

export {
  affixModifier, affixedInstance, applyAffix, calibrate, resolveAffixTable,
  lookupAffix, affixKey, affixLabel, referenceArrangements, PRESSED_STAFF,
  type ReferenceArrangement,
  AFFIX_IDS, RARITY_BANDS, START_MAGNITUDE, MAX_MAGNITUDE, MAX_RESCALES, CALIBRATION,
  REFERENCE_ATTACK, REFERENCE_SECOND_ATTACK, REFERENCE_ELEMENTAL_ATTACK,
  type AffixRarity, type AffixTable, type ResolvedAffix,
} from "./affix.ts";

export {
  simulateStaff, simulateStaffDetail, bestLegalPlacement,
  CONFIRM, SCREEN, REQUIRED_ROLES,
  type LabelDelta, type Placement, type PlacementOptions, type PlacementReport,
  type SimDetail, type SimOptions,
} from "./simulate.ts";
export * from "./affixes.ts";

export {
  SPELL_SCHOOLS, SCHOOL_OF, SCHOOL_COLOUR, schoolOf, type SpellSchool,
} from "./schools.ts";
