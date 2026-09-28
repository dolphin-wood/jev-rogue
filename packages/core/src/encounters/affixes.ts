/**
 * Elite affixes (design doc 005, "Elite affixes") under the Director charter
 * (doc 001, "No nullification" and "Hard counters are opt-in").
 *
 * Code enumerates the legal sets; Jev picks one. After the pick, code applies
 * the set, re-measures pressure with the affix multipliers and degrades the
 * encounter until it sits back inside the elite band.
 */
import type {
  EliteAffix, EncounterPlan, EncounterProfile, EnemyId, RoomPlan, RunHistory,
} from "../types.ts";
import { ENEMIES, MAX_CONCURRENT_ENEMIES, SUMMONER_MINION_CAP } from "./enemies.ts";
import { PRESSURE_BANDS, contextFor, inBand, round3 } from "./pressure.ts";
import { bandError, buildFromRoster, maxCountFor } from "./assemble.ts";

/* ------------------------------ definitions ------------------------------- */

export interface AffixDef {
  readonly id: EliteAffix;
  readonly hp_mult: number;
  /** Poise granted to a body that has none (`Enemy.poise`); a body that has some has it doubled instead. */
  readonly poise: number;
  readonly speed_mult: number;
  /**
   * Multiplier on the **rest between turns**; below 1 comes round sooner.
   *
   * Never on a telegraph. Every tell is set from its own constant and reads no
   * affix, which is what lets an elite be answered with the moves the player
   * already learned (doc 019).
   */
  readonly rest_mult: number;
  /** Doc 005: armored 1.3, swift 1.3, others 1.15. */
  readonly pressure_mult: number;
  /** Charter cap on how many enemies in one encounter may carry it. */
  readonly max_enemies: number | null;
  readonly description: string;
}

/* ---------------------------- the elite tier ------------------------------ */

/**
 * **What every elite is, before its affix says anything** (doc 019).
 *
 * An elite is the same fight, more expensive to get wrong — not a different
 * fight. So the numbers that move are the ones that change what a mistake
 * costs, and the ones that would change *what the answer is* do not move at
 * all:
 *
 * - **Health ×2** — the health bar is the one number that never surprises the
 *   player in the middle of an attack.
 * - **Damage ×1.3** — every attack's answer is unchanged; only the price of
 *   missing it moves.
 * - **Speed ×1.15**, and never a commit speed: the fastest elite body in the
 *   roster still moves at half the player's 240, so no elite can outrun a
 *   retreat, and a ram is the ram the player learned.
 * - **Rests ×0.85** — the gap *between* turns, which is pressure without
 *   being a shorter question.
 *
 * And **no telegraph is ever shortened**. Every tell in the sim is set from
 * its own constant — a windup from `MELEE_ATTACKS`, an aim from `AIM_MS`, a
 * cast from its pose's duration — and none of them reads an affix. That is
 * the contract the tier rests on, and `elite-fairness.test.ts` measures it
 * rather than trusting it.
 */
export const ELITE_HP = 2.0;
export const ELITE_DAMAGE = 1.3;
export const ELITE_SPEED = 1.15;
export const ELITE_REST = 0.85;

/** Poise an `armored` elite carries when its body has none: two sword hits in a row before one interrupts it. */
export const ARMORED_POISE = 18;

export const AFFIXES: Readonly<Record<EliteAffix, AffixDef>> = {
  armored: {
    id: "armored",
    /*
     * **Poise, not health** (doc 019).
     *
     * At ×2 health an `armored` elite was 3.2 tanks, which is a body the
     * player hits until something else kills them. Poise is the more
     * interesting rule anyway: a single hit no longer interrupts it, so the
     * affix changes a verb rather than a bar — and the elite's own ×2 stays
     * the only thing that lengthens the bar. A body with poise of its own has
     * it doubled (`makeEnemy`).
     */
    hp_mult: 1,
    poise: ARMORED_POISE,
    speed_mult: 1,
    rest_mult: 1,
    pressure_mult: 1.3,
    max_enemies: null,
    description: "Armoured: it takes a burst of hits, not one, to interrupt it.",
  },
  swift: {
    id: "swift",
    hp_mult: 1,
    poise: 0,
    /*
     * **No extra speed.** The enrage already gives every elite ×1.15, and doc
     * 019 caps an elite there so nothing can outrun a retreat; +35% on top was
     * a body the player cannot disengage from, which is not a harder fight but
     * a different one.
     *
     * So swift is the one affix that moves the **cadence**: it presses, at the
     * only place doc 019 lets pressure come from, the rest between turns.
     */
    speed_mult: 1,
    rest_mult: 0.8,
    pressure_mult: 1.3,
    max_enemies: null,
    description: "Swift: it comes round again sooner, though every tell is the same length.",
  },
  burning: {
    id: "burning",
    hp_mult: 1,
    poise: 0,
    speed_mult: 1,
    rest_mult: 1,
    pressure_mult: 1.15,
    max_enemies: null,
    description: "Bullets apply fire on hit.",
  },
  splitting: {
    id: "splitting",
    hp_mult: 1,
    poise: 0,
    speed_mult: 1,
    rest_mult: 1,
    pressure_mult: 1.15,
    max_enemies: null,
    description: "Dies into two rushers.",
  },
  shielded: {
    id: "shielded",
    hp_mult: 1,
    poise: 0,
    speed_mult: 1,
    rest_mult: 1,
    pressure_mult: 1.15,
    // Doc 001: at most one enemy per encounter.
    max_enemies: 1,
    description: "Immune to elements; only direct damage lands.",
  },
  volatile: {
    id: "volatile",
    hp_mult: 1,
    poise: 0,
    speed_mult: 1,
    rest_mult: 1,
    pressure_mult: 1.15,
    // Two a room at most: a burst on every elite was the elite's whole identity.
    max_enemies: 2,
    description: "On death, eight spikes grow out of the body, hang for half a second, then fly; step between two of them.",
  },
};

export const ELITE_AFFIX_IDS: readonly EliteAffix[] = [
  "armored", "swift", "burning", "splitting", "shielded", "volatile",
];

/** Doc 005: never `armored` with `shielded`. */
export const FORBIDDEN_PAIRS: readonly (readonly [EliteAffix, EliteAffix])[] = [["armored", "shielded"]];

/** Doc 005: `splitting` is excluded at this roster size and above. */
export const SPLITTING_ROSTER_LIMIT = 8;

/** Doc 001: `shielded` in at most this share of a run's rooms. */
export const SHIELDED_ROOM_SHARE_PERCENT = 30;

/* -------------------------------- context --------------------------------- */

export interface AffixContext {
  readonly roster_size: number;
  /** Rooms the run has already resolved. */
  readonly rooms_seen: number;
  readonly shielded_rooms: number;
  /** True when the build has no non-elemental damage path at all. */
  readonly build_elemental_only: boolean;
}

export function affixContext(
  rosterSize: number,
  history: Pick<RunHistory, "rooms" | "shielded_rooms">,
  buildElementalOnly: boolean,
): AffixContext {
  return {
    roster_size: rosterSize,
    rooms_seen: history.rooms.length,
    shielded_rooms: history.shielded_rooms,
    build_elemental_only: buildElementalOnly,
  };
}

/** Doc 005 + doc 001: is this single affix legal for this encounter at all? */
export function affixAllowed(id: EliteAffix, ctx: AffixContext): boolean {
  if (id === "splitting" && ctx.roster_size >= SPLITTING_ROSTER_LIMIT) return false;
  if (id === "shielded") {
    // A build whose only damage path is elemental would be nullified.
    if (ctx.build_elemental_only) return false;
    // Prospective, like the showcase floor: offered only if taking it would
    // leave the run at or under the share, counting the room being planned.
    // A retrospective test permits a transient overshoot (0 of 2 allows it,
    // making 1 of 3 = 33%), and doc 001 states this as an invariant, not as a
    // trailing average.
    if ((ctx.shielded_rooms + 1) * 100 > SHIELDED_ROOM_SHARE_PERCENT * (ctx.rooms_seen + 1)) {
      return false;
    }
  }
  return true;
}

export function pairAllowed(a: EliteAffix, b: EliteAffix): boolean {
  if (a === b) return false;
  return !FORBIDDEN_PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

/** Every legal set of one or two affixes, in a stable order. */
export function enumerateAffixSets(ctx: AffixContext): EliteAffix[][] {
  const legal = ELITE_AFFIX_IDS.filter((id) => affixAllowed(id, ctx));
  const sets: EliteAffix[][] = legal.map((id) => [id]);
  for (let i = 0; i < legal.length; i++) {
    for (let j = i + 1; j < legal.length; j++) {
      const a = legal[i]!;
      const b = legal[j]!;
      if (pairAllowed(a, b)) sets.push([a, b]);
    }
  }
  return sets;
}

/**
 * **Exactly one affix, legal for this body** (doc 019).
 *
 * A pair was two new rules to read on a body that already reads as harder —
 * and with the enrage carrying health, damage, speed and cadence, the affix is
 * the only thing left that says what *kind* of harder this one is. One is
 * enough to say it.
 *
 * The draw is even over what is legal, because the judgement is all in the
 * enumeration: the charter filters, the roster size and this body's own
 * exclusions. What survives them differs only in flavour, which is why doc 005
 * keeps this a code decision rather than a Jev question.
 */
export function affixesFor(id: EnemyId, ctx: AffixContext, rng: { next(): number }): EliteAffix[] {
  const excluded = new Set(ENEMIES[id].affix_excluded ?? []);
  const legal = ELITE_AFFIX_IDS.filter((a) => !excluded.has(a) && affixAllowed(a, ctx));
  if (legal.length === 0) return [];
  return [legal[Math.min(legal.length - 1, Math.floor(rng.next() * legal.length))]!];
}

export function isLegalAffixSet(set: readonly EliteAffix[], ctx: AffixContext): boolean {
  if (set.length < 1 || set.length > 2) return false;
  if (new Set(set).size !== set.length) return false;
  if (!set.every((id) => affixAllowed(id, ctx))) return false;
  if (set.length === 2 && !pairAllowed(set[0]!, set[1]!)) return false;
  return true;
}

/* ------------------------------ stat effects ------------------------------ */

export interface AffixedStats {
  readonly hp_mult: number;
  readonly speed_mult: number;
  /** On the rest between turns only. Never on a tell (doc 019). */
  readonly rest_mult: number;
  /** Flat poise the set grants a body with none of its own. */
  readonly poise: number;
  /** What a hit costs the player, as a multiple: an elite's is `ELITE_DAMAGE`. */
  readonly damage_mult: number;
}

/**
 * What a body's affixes do to its stats, **including the enrage** every elite
 * carries before its affix says anything (doc 019).
 *
 * One place rather than two: the enrage used to be applied at `makeEnemy` and
 * the affixes here, so "what is an elite" was a question with two answers and
 * the fairness rules could only be checked in one of them.
 */
export function affixStats(set: readonly EliteAffix[]): AffixedStats {
  if (set.length === 0) {
    return { hp_mult: 1, speed_mult: 1, rest_mult: 1, poise: 0, damage_mult: 1 };
  }
  let hp = ELITE_HP;
  let speed = ELITE_SPEED;
  let rest = ELITE_REST;
  let poise = 0;
  for (const id of set) {
    const def = AFFIXES[id];
    hp *= def.hp_mult;
    speed *= def.speed_mult;
    rest *= def.rest_mult;
    poise += def.poise;
  }
  return {
    hp_mult: round3(hp), speed_mult: round3(speed), rest_mult: round3(rest),
    poise, damage_mult: ELITE_DAMAGE,
  };
}

/**
 * The factor the re-measurement applies to the whole encounter. An affix
 * capped to N enemies only lifts that share of the roster, which is what
 * keeps `shielded` from being priced as if the whole room had it.
 */
export function affixPressureMultiplier(set: readonly EliteAffix[], rosterSize: number): number {
  let m = 1;
  for (const id of set) {
    const def = AFFIXES[id];
    const share = def.max_enemies === null ? 1 : Math.min(1, def.max_enemies / Math.max(1, rosterSize));
    m *= 1 + (def.pressure_mult - 1) * share;
  }
  return m;
}

/** How many enemies in the roster actually carry each affix. */
export function affixCarriers(set: readonly EliteAffix[], rosterSize: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of set) {
    const def = AFFIXES[id];
    out[id] = def.max_enemies === null ? rosterSize : Math.min(def.max_enemies, rosterSize);
  }
  return out;
}

/* ---------------------------- re-measurement ------------------------------ */

export type AffixDegradation =
  | "none"
  | "roster_shrunk"
  | "first_affix_only"
  | "roster_refitted"
  | "affixes_dropped";

export interface AffixApplication {
  readonly plan: EncounterPlan;
  readonly affixes: readonly EliteAffix[];
  readonly roster: readonly EnemyId[];
  /** Pressure of the degraded roster with the affix multiplier applied. */
  readonly measured_pressure: number;
  readonly multiplier: number;
  readonly degradation: AffixDegradation;
  readonly within_band: boolean;
  readonly carriers: Record<string, number>;
}

export interface ApplyAffixesInput {
  readonly plan: EncounterPlan;
  readonly roster: readonly EnemyId[];
  readonly room: Pick<RoomPlan, "measured" | "spawn_groups">;
  readonly affixes: readonly EliteAffix[];
  /** Trickle wave sizes from the assembly, so degradation keeps its shape. */
  readonly chunks?: readonly number[];
  readonly band?: readonly [number, number];
}

function resize(roster: readonly EnemyId[], n: number): EnemyId[] {
  const out: EnemyId[] = [];
  for (let i = 0; i < n; i++) out.push(roster[i % roster.length]!);
  return out;
}

function populationCap(roster: readonly EnemyId[]): number {
  return roster.includes("summoner") ? MAX_CONCURRENT_ENEMIES - SUMMONER_MINION_CAP : MAX_CONCURRENT_ENEMIES;
}

/**
 * Doc 005: "After applying the set, pressure is re-measured with affix
 * multipliers and must stay within the elite band; otherwise the roster
 * shrinks by one and re-measures, then the affix set drops to its first
 * affix only."
 *
 * Those two steps are tried in exactly that order. When neither lands, the
 * roster keeps being refitted and, in the last resort, the set is dropped,
 * so an elite room never ships outside its band.
 */
export function applyEliteAffixes(input: ApplyAffixesInput): AffixApplication {
  const band = input.band ?? PRESSURE_BANDS.elite;
  const profile: EncounterProfile = input.plan.profile;
  const ctx = contextFor(input.room, profile.composition);
  const chunks = input.chunks ?? [];
  const cap = Math.min(populationCap(input.roster), maxCountFor(profile));
  const n0 = input.roster.length;

  const attempt = (
    size: number,
    set: readonly EliteAffix[],
    degradation: AffixDegradation,
  ): AffixApplication => {
    const roster = resize(input.roster, Math.max(1, Math.min(cap, size)));
    const candidate = buildFromRoster(roster, profile, input.room, chunks, ctx);
    const multiplier = affixPressureMultiplier(set, roster.length);
    const pressure = round3(candidate.pressure * multiplier);
    const plan: EncounterPlan = {
      ...input.plan,
      waves: candidate.waves,
      measured_pressure: pressure,
      band: [band[0], band[1]],
      elite_affixes: [...set],
    };
    return {
      plan,
      affixes: [...set],
      roster,
      measured_pressure: pressure,
      multiplier: round3(multiplier),
      degradation,
      within_band: inBand(pressure, band),
      carriers: affixCarriers(set, roster.length),
    };
  };

  const full = input.affixes;
  const firstOnly = full.length > 0 ? [full[0]!] : [];

  const ladder: AffixApplication[] = [];
  const push = (a: AffixApplication): AffixApplication | null => {
    ladder.push(a);
    return a.within_band ? a : null;
  };

  // The doc's path, in order.
  let hit = push(attempt(n0, full, "none"));
  if (hit) return hit;
  hit = push(attempt(n0 - 1, full, "roster_shrunk"));
  if (hit) return hit;
  hit = push(attempt(n0 - 1, firstOnly, "first_affix_only"));
  if (hit) return hit;

  // Last resort: refit the roster with the reduced set, then drop the set.
  for (const set of [firstOnly, [] as EliteAffix[]]) {
    const degradation: AffixDegradation = set.length > 0 ? "roster_refitted" : "affixes_dropped";
    for (let d = 2; d <= Math.max(n0, cap); d++) {
      for (const size of [n0 - d, n0 + d - 1]) {
        if (size < 1 || size > cap) continue;
        const a = push(attempt(size, set, degradation));
        if (a) return a;
      }
    }
  }

  // Nothing landed: hand back whichever attempt came closest, honestly flagged.
  let best = ladder[0]!;
  for (const a of ladder) {
    if (bandError(a.measured_pressure, band) < bandError(best.measured_pressure, band)) best = a;
  }
  return best;
}
