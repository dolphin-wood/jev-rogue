/**
 * **What the last rooms measured**, bucketed (design docs 002, 010, 011).
 *
 * The rule this file exists to hold: *a state label is a fact — a quantity
 * that was measured, with its buckets named for what was measured — never a
 * verdict about the player or the build.* `mana refused: never / sometimes /
 * often` is a fact. `mana_sustain: tight` is a verdict, and so were
 * `bottleneck: mana`, `archetype: nuke` and `build_power: weak`. Classifying
 * the build and deciding what it needs is **Jev's** job, done through the
 * questions and their options; code's job is to measure one quantity per label
 * and bucket it.
 *
 * It matters because the verdicts were wrong in a way nobody could see from
 * the outside. `mana_sustain` came from an offline cast loop firing on
 * cooldown — a prediction about a bot, not a record of a player — and it read
 * `tight` for 50 rooms of 56 while the same runs refused **0 of 27,978** ready
 * presses for mana. Every option grounded on it therefore fitted every state,
 * and the measured result was the elite portal's reward answering `stat` at
 * 99%. The fix is not a better verdict. It is to stop shipping verdicts.
 *
 * Every field below is a count or a duration the simulation recorded while the
 * player was playing (`WorldStats`), taken over the **last two fights** — the
 * same window `recent_damage` uses, because one room is a sample of one and a
 * whole run is a history the labels already carry elsewhere.
 */
import type { WorldStats } from "../sim/types.ts";

/** One fight's measurements, as the world recorded them. */
export type RoomMeasure = Pick<
  WorldStats,
  | "elapsedMs" | "damageDealt" | "swordDamage" | "shotsFired" | "shotHits"
  | "castPresses" | "castRefusedMana" | "manaBelowKeyMs"
  | "hurtByRanged" | "hurtByMelee" | "hurtByHazard"
>;

export function emptyMeasure(): RoomMeasure {
  return {
    elapsedMs: 0, damageDealt: 0, swordDamage: 0, shotsFired: 0, shotHits: 0,
    castPresses: 0, castRefusedMana: 0, manaBelowKeyMs: 0,
    hurtByRanged: 0, hurtByMelee: 0, hurtByHazard: 0,
  };
}

/** The fields of `WorldStats` this module reads, copied off a finished room. */
export function measureOf(stats: WorldStats): RoomMeasure {
  return {
    elapsedMs: stats.elapsedMs, damageDealt: stats.damageDealt, swordDamage: stats.swordDamage,
    shotsFired: stats.shotsFired, shotHits: stats.shotHits,
    castPresses: stats.castPresses, castRefusedMana: stats.castRefusedMana,
    manaBelowKeyMs: stats.manaBelowKeyMs,
    hurtByRanged: stats.hurtByRanged, hurtByMelee: stats.hurtByMelee, hurtByHazard: stats.hurtByHazard,
  };
}

/** How many fights the labels are taken over, as `recent_damage` is. */
export const OBSERVED_WINDOW = 2;

function sum(rooms: readonly RoomMeasure[]): RoomMeasure {
  return rooms.slice(-OBSERVED_WINDOW).reduce((a, r) => ({
    elapsedMs: a.elapsedMs + r.elapsedMs,
    damageDealt: a.damageDealt + r.damageDealt,
    swordDamage: a.swordDamage + r.swordDamage,
    shotsFired: a.shotsFired + r.shotsFired,
    shotHits: a.shotHits + r.shotHits,
    castPresses: a.castPresses + r.castPresses,
    castRefusedMana: a.castRefusedMana + r.castRefusedMana,
    manaBelowKeyMs: a.manaBelowKeyMs + r.manaBelowKeyMs,
    hurtByRanged: a.hurtByRanged + r.hurtByRanged,
    hurtByMelee: a.hurtByMelee + r.hurtByMelee,
    hurtByHazard: a.hurtByHazard + r.hurtByHazard,
  }), emptyMeasure());
}

/**
 * The labels. Each name says what was counted and each value says how much of
 * it there was; none of them says what it means.
 */
export interface ObservedLabels {
  /** Share of **ready** spell presses the bar refused. */
  readonly mana_refused: "never" | "sometimes" | "often";
  /**
   * Share of fight time the bar spent **under the cheapest key's cost** — not
   * under zero. The bar almost never empties; it sits in single figures and
   * refuses because what is left will not pay for the key.
   */
  readonly mana_short_time: "little" | "some" | "most";
  /**
   * Bodies struck per projectile fired. It can exceed one — a shot that
   * pierces or splits hits several — so the top bucket is `several` rather
   * than a share of a whole.
   */
  readonly hits_per_shot: "few" | "one" | "several";
  /** Spell casts a minute. */
  readonly cast_rate: "slow" | "steady" | "rapid";
  /** Damage dealt a second. */
  readonly damage_rate: "low" | "fair" | "high";
  /** Share of the damage the player dealt that the blade did. */
  readonly sword_share: "none" | "some" | "most";
  /** Which family took the most health: what the player was actually killed by. */
  readonly hurt_by: "nothing" | "shots" | "blades" | "hazards";
}

/**
 * **Thresholds.** One measured quantity each, with cut points a person would
 * recognise in their own session, fitted on the `novice` and `average` skill
 * profiles rather than on the expert model (doc 011) — the expert sits at one
 * end of nearly every one of these, and a scale calibrated on it puts every
 * human in a single bucket, which is the failure this whole file is about.
 *
 * Measured over `pnpm play rule 6 <profile>`; the figures are in doc 010.
 */
export const OBSERVED_CUTS = {
  /**
   * A refusal in twenty is noticeable; one in six is the run's problem.
   *
   * Measured, this label is `never` for every profile and every room — which
   * is the finding, not a fault in the label. Mana genuinely does not stop
   * anybody: 0 of 27,978 ready presses were refused across the reference runs.
   * The verdict it replaced claimed the opposite in nine rooms of ten, and
   * every option grounded on that verdict fitted every state. A fact that
   * always reads `never` tells the Director something true — do not sell this
   * player mana — where the verdict told it something false.
   */
  manaRefusedSometimes: 0.05,
  manaRefusedOften: 0.16,
  /**
   * A fifth of the fight under the cheapest key is a pause in the rotation;
   * half of it is a wall. This one does move: the novice and the average
   * profile cast slowly enough never to reach it, and the expert's rotation
   * sits under the cheapest key for about half of every fight.
   */
  manaShortSome: 0.2,
  manaShortMost: 0.5,
  /**
   * Bodies struck per shot. A novice's rooms run from 0.2 up; a practised
   * player is around 1, and above it the spell is piercing or splitting.
   */
  hitsPerShotOne: 0.5,
  hitsPerShotSeveral: 1,
  /**
   * Casts a minute. Measured: novice 7, average 40, expert 100. The cuts sit
   * between them, so a human reads `slow` or `steady` and only a rotation
   * nobody runs reads `rapid`.
   */
  castRateSteady: 15,
  castRateRapid: 60,
  /** Damage a second. Measured: novice 3.5, average 20, expert 25. */
  damageRateFair: 12,
  damageRateHigh: 26,
  /**
   * The blade's share of the damage dealt: novice 0.71, average 0.41, expert
   * 0.27 — a person fights closer than the model does, and this is the label
   * that says so where the hardcoded `build_range: "mid"` said nothing.
   */
  swordShareSome: 0.15,
  swordShareMost: 0.55,
} as const;

/** What a run that has not fought yet reads as: nothing measured, nothing claimed. */
export const UNMEASURED: ObservedLabels = {
  mana_refused: "never", mana_short_time: "little", hits_per_shot: "one",
  cast_rate: "steady", damage_rate: "fair", sword_share: "none", hurt_by: "nothing",
};

const band = <T extends string>(v: number, lo: number, hi: number, out: readonly [T, T, T]): T =>
  (v >= hi ? out[2] : v >= lo ? out[1] : out[0]);

/**
 * **The figures the buckets were taken from**, over the same window.
 *
 * The buckets are what an option is grounded on; a reader is better served by
 * both — "about 41 casts a minute, reads as steady" says what was measured and
 * what the game makes of it, and a Director given only the second cannot tell
 * a rotation at the bottom of `steady` from one at the top of it. Null where
 * nothing has been measured, so a run that has not fought says so.
 */
export interface ObservedFigures {
  readonly castsPerMinute: number;
  readonly damagePerSecond: number;
  readonly bodiesPerShot: number;
  readonly swordShare: number;
}

export function observedFigures(rooms: readonly RoomMeasure[]): ObservedFigures | null {
  const m = sum(rooms);
  if (m.elapsedMs <= 0) return null;
  const seconds = m.elapsedMs / 1000;
  const share = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    castsPerMinute: (m.castPresses * 60) / seconds,
    damagePerSecond: m.damageDealt / seconds,
    bodiesPerShot: share(m.shotHits, m.shotsFired),
    swordShare: share(m.swordDamage, m.damageDealt),
  };
}

export function observedLabels(rooms: readonly RoomMeasure[]): ObservedLabels {
  const m = sum(rooms);
  /*
   * Nothing fought yet, so nothing to report. Returning the buckets a row of
   * zeros lands in would claim the player casts slowly, hits nothing and does
   * no damage — three verdicts about a run that has not started, which is the
   * mistake this whole file exists to stop.
   */
  if (m.elapsedMs <= 0) return UNMEASURED;
  const seconds = m.elapsedMs / 1000;
  const share = (a: number, b: number) => (b > 0 ? a / b : 0);
  const c = OBSERVED_CUTS;
  const hurt: readonly (readonly [ObservedLabels["hurt_by"], number])[] = [
    ["shots", m.hurtByRanged], ["blades", m.hurtByMelee], ["hazards", m.hurtByHazard],
  ];
  const worst = hurt.reduce((a, b) => (b[1] > a[1] ? b : a));
  return {
    mana_refused: band(share(m.castRefusedMana, m.castPresses), c.manaRefusedSometimes, c.manaRefusedOften,
      ["never", "sometimes", "often"]),
    mana_short_time: band(share(m.manaBelowKeyMs, m.elapsedMs), c.manaShortSome, c.manaShortMost,
      ["little", "some", "most"]),
    hits_per_shot: band(share(m.shotHits, m.shotsFired), c.hitsPerShotOne, c.hitsPerShotSeveral,
      ["few", "one", "several"]),
    cast_rate: band(seconds > 0 ? (m.castPresses * 60) / seconds : 0, c.castRateSteady, c.castRateRapid,
      ["slow", "steady", "rapid"]),
    damage_rate: band(seconds > 0 ? m.damageDealt / seconds : 0, c.damageRateFair, c.damageRateHigh,
      ["low", "fair", "high"]),
    sword_share: band(share(m.swordDamage, m.damageDealt), c.swordShareSome, c.swordShareMost,
      ["none", "some", "most"]),
    hurt_by: worst[1] <= 0 ? "nothing" : worst[0],
  };
}

