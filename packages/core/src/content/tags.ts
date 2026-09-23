/**
 * The closed vocabulary shared by summarizers, content tags, option
 * descriptions and instructions (design doc 010). Adding a value means editing
 * this file, and `content:check` rejects anything outside it.
 */

export const ROLES = [
  "attack", "boost", "passive", "payload", "multicast",
  "engine", "control", "sustain", "tracking", "mana_regen",
] as const;
export type Role = (typeof ROLES)[number];

export const RANGES = ["short", "mid", "long"] as const;
export type Range = (typeof RANGES)[number];

export const ELEMENTS = ["fire", "poison", "ice", "none"] as const;
export type Element = (typeof ELEMENTS)[number];

/** Item and preset archetypes. `mixed` is summarizer-only and tags no content. */
export const ARCHETYPES = ["spam", "nuke", "area", "dot", "melee"] as const;
export type Archetype = (typeof ARCHETYPES)[number];
export type BuildArchetype = Archetype | "mixed";

export const PRESSURE_KINDS = [
  "movement_pressure", "ranged_pressure", "melee_heavy", "ranged_heavy", "area_denial",
] as const;
export type PressureKind = (typeof PRESSURE_KINDS)[number];

export const HAZARD_TAGS = ["hazard", "slow_zone", "damage_zone", "cover", "utility"] as const;
export type HazardTag = (typeof HAZARD_TAGS)[number];

export const RARITIES = ["common", "uncommon", "rare"] as const;
export type Rarity = (typeof RARITIES)[number];

export const ALL_TAGS: readonly string[] = [
  ...ROLES, ...RANGES, ...ELEMENTS, ...ARCHETYPES, ...PRESSURE_KINDS, ...HAZARD_TAGS, ...RARITIES,
];

export function isKnownTag(tag: string): boolean {
  return ALL_TAGS.includes(tag);
}

/* ---- summary labels: the only words allowed in Jev state (doc 010) ---- */

export const LABELS = {
  health: ["critical", "low", "ok", "full"],
  recent_damage: ["none", "some", "heavy"],
  clear_speed: ["slow", "normal", "fast"],
  movement_pressure_recent: ["light", "heavy"],
  run_progress: ["early", "mid", "late", "pre_boss"],
  gold: ["poor", "ok", "rich"],
  tension: ["release", "build", "peak"],
  tension_cap: ["release_only", "build_allowed", "peak_allowed"],
  hazard_cap: ["none", "low", "high"],
  mana_sustain: ["starved", "tight", "comfortable"],
  bottleneck: ["damage", "cast_frequency", "mana", "accuracy", "none"],
  consistency: ["on_plan", "drifting", "pivoted"],
  suitability: ["softer_than_tension", "matches_tension", "harder_than_tension"],
  scatter: ["tight", "medium", "wide"],
  counter_score: ["favours", "neutral", "counters"],
} as const;

export type LabelField = keyof typeof LABELS;
export type LabelValue<F extends LabelField> = (typeof LABELS)[F][number];

export type Health = LabelValue<"health">;
export type RecentDamage = LabelValue<"recent_damage">;
export type ClearSpeed = LabelValue<"clear_speed">;
export type RunProgress = LabelValue<"run_progress">;
export type Gold = LabelValue<"gold">;
export type Tension = LabelValue<"tension">;
export type TensionCap = LabelValue<"tension_cap">;
export type HazardCap = LabelValue<"hazard_cap">;
export type ManaSustain = LabelValue<"mana_sustain">;
export type Bottleneck = LabelValue<"bottleneck">;
export type Consistency = LabelValue<"consistency">;
export type Suitability = LabelValue<"suitability">;
export type Scatter = LabelValue<"scatter">;
export type CounterScore = LabelValue<"counter_score">;

/** A label reference used by `jev_hints`, e.g. "bottleneck:accuracy". */
export function isKnownLabelRef(ref: string): boolean {
  const [field, value] = ref.split(":");
  if (!field || !value) return false;
  const values = (LABELS as Record<string, readonly string[]>)[field];
  return !!values && values.includes(value);
}
