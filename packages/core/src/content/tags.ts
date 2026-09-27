/**
 * The closed vocabulary shared by summarizers, content tags, option
 * descriptions and instructions (design doc 010). Adding a value means editing
 * this file, and `content:check` rejects anything outside it.
 */

/** What a spell is for, beyond its style: every spell attacks, and a few also control or track. */
export const ROLES = ["attack", "control", "tracking"] as const;
export type Role = (typeof ROLES)[number];

export const RANGES = ["short", "mid", "long"] as const;
export type Range = (typeof RANGES)[number];

export const ELEMENTS = ["fire", "poison", "ice", "none"] as const;
export type Element = (typeof ELEMENTS)[number];

/** The three that leave something behind; `none` is the absence of one. */
export const STATUS_ELEMENTS = ["fire", "poison", "ice"] as const;
export type StatusElement = (typeof STATUS_ELEMENTS)[number];

/**
 * **What a thing in flight carries, per element**, as gauge-filling power.
 *
 * One number and one element was the wrong shape twice over. A rune of the
 * spell's own element *replaced* its power instead of adding to it, so Kindle
 * on Ember Dart could be a downgrade and was always a dead card — and the two
 * biggest multipliers in the affix pool were dead on every spell that already
 * had an element. And a shot could only ever be one thing, so Kindle and
 * Blight on one spell meant the second silently cancelled the first.
 *
 * Now they add and they coexist: each element's gauge is fed by its own
 * power, each status runs on its own clock, and a body can burn and be
 * poisoned at once. There are **no cross-element reactions** — a second
 * element is a second status, not a combo to discover.
 */
export interface ElementPowers {
  fire: number;
  poison: number;
  ice: number;
}

export function noPowers(): ElementPowers {
  return { fire: 0, poison: 0, ice: 0 };
}

export function addPower(to: ElementPowers, element: Element | null | undefined, power: number): void {
  if (!element || element === "none" || !(power > 0)) return;
  to[element] += power;
}

export function addPowers(to: ElementPowers, from: ElementPowers): void {
  to.fire += from.fire;
  to.poison += from.poison;
  to.ice += from.ice;
}

export function copyPowers(to: ElementPowers, from: ElementPowers): void {
  to.fire = from.fire;
  to.poison = from.poison;
  to.ice = from.ice;
}

export function clearPowers(to: ElementPowers): void {
  to.fire = 0;
  to.poison = 0;
  to.ice = 0;
}

export function anyPower(p: ElementPowers): boolean {
  return p.fire > 0 || p.poison > 0 || p.ice > 0;
}

/**
 * The one a renderer should colour the shot with: the strongest, ties going
 * to fire, poison, ice in that order. A shot of several elements is drawn as
 * the loudest of them rather than as a fourth colour nobody can name.
 */
export function dominantElement(p: ElementPowers): Element {
  let best: Element = "none";
  let top = 0;
  for (const el of STATUS_ELEMENTS) {
    if (p[el] > top) { top = p[el]; best = el; }
  }
  return best;
}

/** Item and preset archetypes. `mixed` is summarizer-only and tags no content. */
export const ARCHETYPES = ["spam", "nuke", "area", "dot", "melee"] as const;
export type Archetype = (typeof ARCHETYPES)[number];
export type BuildArchetype = Archetype | "mixed";

/**
 * **The style cards**, as the player reads them on the intent screen.
 *
 * The preset is `area` and the card says "Crowd"; a Director told only `area`
 * is being told the id of a thing the player never saw. The card lived in the
 * scene, where nothing outside the browser could read it, so the briefing had
 * to either repeat the words or leave the player's own choice as a bare id.
 */
/*
 * **Two voices, one table.** `desc` is the card's blurb, the player's English
 * on the intent screen (the game's English content table has no entry of its
 * own for it, so this string is what an English player reads). `does` is what
 * the Director reads for the same choice (`briefing.ts`, "The player"): what
 * the spells tagged with the style do, by doc 006's style table — cadence,
 * commitment, geometry, time and movement, the range band and the sword — and
 * the starter the style begins with. The blurb carried verdicts ("spells that
 * end fights", "ground that rewards a bunched room") and a Blade line written
 * for a starter the style no longer has; the Director's line is a neutral
 * fact (doc 006, "What a spell tells Jev"), and the blurb is the copy pass's.
 */
export const STYLE_CARDS: Readonly<Record<Archetype, {
  readonly name: string; readonly desc: string; readonly does: string;
}>> = {
  spam: {
    name: "Barrage", desc: "Cast cheap, fast spells nonstop. Chain and spread your shots.",
    does: "Spells on a short cooldown, pressed often; some bank shots while the key rests and loose the "
      + "banked shots on one press. Starts with Shock Arc, a seeking spark that leaps to up to "
      + "two more nearby bodies.",
  },
  nuke: {
    name: "Heavy", desc: "Fewer casts, bigger hits. Slow, costly spells that end fights.",
    does: "Spells that take a windup, a held charge or a marked landing before one hit that carries the "
      + "cast's damage. Starts with Earth Spikes, a line of stone spikes out of the "
      + "floor after a windup, staggering what they catch.",
  },
  area: {
    name: "Crowd", desc: "Hit many enemies at once with bursts, rings and ground effects.",
    does: "Spells that hit several bodies with one cast: cones, rings, lines through a row, and pulls that "
      + "drag bodies together. Starts with Scatter Shot, a wide cone of pellets that fly a short way.",
  },
  dot: {
    name: "Affliction", desc: "Burn and poison your enemies, then keep moving while the damage ticks.",
    does: "Spells that put a burn or a poison on a body, which deals its damage over the next seconds while "
      + "the player moves; some leave burning or poisoned ground. Starts with Ember Dart, a dart that sets "
      + "its target burning.",
  },
  melee: {
    name: "Blade",
    desc: "Fight up close with the sword, using spells that orbit you or trigger on your swings.",
    does: "Spells used within sword reach: some add to the sword swing, some are set off by it, some cut "
      + "what is close. Starts with Crescent Edge, an enchant: for a while each sword swing also throws its "
      + "crescent forward as a wave.",
  },
};

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
  consistency: ["on_plan", "drifting", "pivoted"],
  suitability: ["softer_than_tension", "matches_tension", "harder_than_tension"],
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
export type Consistency = LabelValue<"consistency">;
export type Suitability = LabelValue<"suitability">;
export type CounterScore = LabelValue<"counter_score">;

/** A label reference used by `jev_hints`, e.g. "health:low". */
export function isKnownLabelRef(ref: string): boolean {
  const [field, value] = ref.split(":");
  if (!field || !value) return false;
  const values = (LABELS as Record<string, readonly string[]>)[field];
  return !!values && values.includes(value);
}
