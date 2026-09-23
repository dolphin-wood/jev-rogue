/**
 * The pressure formula and the tension bands (design doc 005, "Assembly"
 * steps 1 and 5).
 *
 *   pressure = SUM over enemies of
 *     threat_weight
 *       x concurrency_factor(wave)
 *       x openness_factor(open_ratio)
 *       x cover_factor(cover, composition)
 *
 * Every constant below is an estimate until the harness (011) calibrates it
 * against hearts lost, which is why they are named exports rather than
 * literals buried in the sum.
 */
import type {
  Composition, Cover, EnemyId, RoomPlan, RoomType, Tension, Wave,
} from "../types.ts";
import type { Suitability } from "../content/tags.ts";
import { MAX_CONCURRENT_ENEMIES, enemyClass, threatWeight } from "./enemies.ts";

/* --------------------------------- bands ---------------------------------- */

export type PressureTier = "release" | "build" | "peak" | "elite";

export const TIER_ORDER: readonly PressureTier[] = ["release", "build", "peak", "elite"];

/** Doc 005 step 1. Elite ignores `pressure_cap`; combat does not. */
/**
 * Re-based against the measured pressure of the rooms each tier is meant to
 * hold (doc 005's calibration clause). The old table — 1–2, 2–3.5, 3.5–5,
 * 5–8 — admitted one or two bodies at release and three or four at build,
 * which with a sword that kills a rusher in two swings was a five-second room.
 * The fixed-count probe in the harness gave: mixed trickle 3 bodies 2.8,
 * 5 → 3.8, 9 → 4.7, 12 → 5.0, 24 → 5.9; mixed single 12 → 6.0; melee single
 * 9 → 6.5, 12 → 8.1; ranged trickle tops out near 3.8. So release is a light
 * ranged trickle or two or three mixed bodies; build a mixed trickle of five
 * to nine; peak a mixed trickle of nine to twenty or a single wave of five to
 * twelve; elite a heavy single wave, which a trickle cannot reach.
 */
/*
 * Re-based a third time, and measured over the composition space rather
 * than guessed. Release's ceiling rose from 2.75 to 3.4 so a light room is
 * four to nine bodies, not two or three. A first attempt raised every band
 * (release to 3.9, build 3.9–5.1, peak 5.1–6.3) and the ranged compositions,
 * whose pressure tops out near 3.8, could no longer reach build at all: two
 * rooms in three fell back to the same preset, and every room looked alike.
 * These bands overlap slightly so a composition near an edge fits one or the
 * other.
 */
export const PRESSURE_BANDS: Readonly<Record<PressureTier, readonly [number, number]>> = {
  release: [1.4, 3.4],
  build: [3.2, 4.6],
  peak: [4.4, 6.1],
  // Overlaps peak by design: the elite floor sits where a heavy trickle of
  // sixteen or more bodies lands (5.5–5.9), so an elite room may be the
  // longest fight in the run and not only the densest single wave.
  elite: [5.5, 9.0],
};

/** Narrowest band a `pressure_cap` clamp is allowed to leave behind. */
export const MIN_BAND_WIDTH = 0.5;

export function tierForTension(tension: Tension): PressureTier {
  return tension;
}

export function bandForTier(tier: PressureTier): readonly [number, number] {
  return PRESSURE_BANDS[tier];
}

/** The tier whose band contains `p`; clamped at both ends. */
export function tierForPressure(p: number): PressureTier {
  if (p < PRESSURE_BANDS.release[1]) return "release";
  if (p < PRESSURE_BANDS.build[1]) return "build";
  if (p < PRESSURE_BANDS.peak[1]) return "peak";
  return "elite";
}

export function inBand(p: number, band: readonly [number, number]): boolean {
  return p >= band[0] - 1e-9 && p <= band[1] + 1e-9;
}

/**
 * Doc 005 step 1. Combat rooms take the tension's band bounded above by
 * `pressure_cap`; elite rooms take the elite band regardless. Non-combat rooms
 * have no encounter and return null.
 */
export function bandForRoom(opts: {
  readonly room_type: RoomType;
  readonly tension: Tension;
  readonly pressure_cap: number;
}): readonly [number, number] | null {
  if (opts.room_type === "elite") return PRESSURE_BANDS.elite;
  if (opts.room_type !== "combat") return null;
  const [lo, hi] = PRESSURE_BANDS[tierForTension(opts.tension)];
  const cappedHi = Math.min(hi, opts.pressure_cap);
  let cappedLo = Math.min(lo, cappedHi);
  if (cappedHi - cappedLo < MIN_BAND_WIDTH) cappedLo = Math.max(0, cappedHi - MIN_BAND_WIDTH);
  return [cappedLo, cappedHi];
}

/**
 * The suitability word every option description ends with (doc 005, profile
 * table): how the tier an option pushes toward compares with the tension
 * already chosen for the room.
 */
export function suitability(profileTier: PressureTier, tension: Tension): Suitability {
  const a = TIER_ORDER.indexOf(profileTier);
  const b = TIER_ORDER.indexOf(tierForTension(tension));
  if (a < b) return "softer_than_tension";
  if (a > b) return "harder_than_tension";
  return "matches_tension";
}

/* -------------------------------- factors --------------------------------- */

/**
 * Scales a raw threat-weight sum into the 1.0-8.0 band space.
 *
 * Solved rather than guessed. With a mean threat weight of 1.73 across the
 * four compositions, requiring the midpoint of each density range to land in
 * the matching band leaves 0.26 <= scale <= 0.32, and sweeping the whole
 * profile space x four rooms x four bands puts the fewest encounters on the
 * fallback presets at 0.33: a single-wave sparse roster reads ~2.0, a normal
 * one ~3.4, a dense one ~5.1 and a twelve-body elite roster ~6.9. Above 0.34
 * sparse rosters start overshooting the release band.
 */
export const CONCURRENCY_SCALE = 0.33;

/** How long the pressure model assumes an enemy survives once it spawns. */
export const ASSUMED_TTK_MS = 6000;

/** Open ratio at which openness is neutral. */
export const OPENNESS_PIVOT = 0.6;
/** Swing per unit of open ratio, applied with opposite signs per enemy class. */
export const OPENNESS_SWING = 0.5;
export const OPENNESS_CLAMP: readonly [number, number] = [0.6, 1.4];

/** Cover strength per label. */
export const COVER_VALUE: Readonly<Record<Cover, number>> = { none: 0, sparse: 0.5, dense: 1 };
/** Swing per unit of cover, applied with opposite signs per enemy class. */
export const COVER_SWING = 0.2;
/** Extra credit when the composition's lean matches the enemy that cover helps. */
export const COMPOSITION_ALIGNMENT = 0.05;

const COMPOSITION_LEAN: Readonly<Record<Composition, "melee" | "ranged" | null>> = {
  melee_heavy: "melee",
  ranged_heavy: "ranged",
  siege: "ranged",
  mixed: null,
};

/**
 * Doc 005 step 5: "Concurrency counts only enemies alive at the same time
 * under the wave schedule." For the wave at index `i`, the share of the
 * roster that is on the floor when that wave lands.
 */
export function concurrencyFactor(waves: readonly Wave[], waveIndex: number): number {
  const wave = waves[waveIndex];
  if (!wave) return 0;
  const total = waves.reduce((n, w) => n + waveSize(w), 0);
  if (total === 0) return 0;
  const t = wave.at_ms;
  let alive = 0;
  for (const w of waves) {
    if (w.at_ms <= t && t < w.at_ms + ASSUMED_TTK_MS) alive += waveSize(w);
  }
  return CONCURRENCY_SCALE * (alive / total);
}

/** Open rooms raise ranged pressure and lower melee pressure (doc 005 step 5). */
export function opennessFactor(openRatio: number, id: EnemyId): number {
  const sign = enemyClass(id) === "ranged" ? 1 : -1;
  const f = 1 + sign * OPENNESS_SWING * (openRatio - OPENNESS_PIVOT);
  return Math.min(OPENNESS_CLAMP[1], Math.max(OPENNESS_CLAMP[0], f));
}

/** Cover does the reverse of openness, and the composition's lean tilts it. */
export function coverFactor(cover: Cover, composition: Composition, id: EnemyId): number {
  const klass = enemyClass(id);
  const value = COVER_VALUE[cover];
  const sign = klass === "melee" ? 1 : -1;
  const lean = COMPOSITION_LEAN[composition];
  const align = lean === null ? 0 : (lean === klass ? 1 : -1) * COMPOSITION_ALIGNMENT * value;
  return (1 + sign * COVER_SWING * value) * (1 + align);
}

/** Doc 004 exposes cover as a label on the space archetype; a plan carries the
 *  measurement instead, so cover is read back off the pillar count. */
export const COVER_PILLAR_THRESHOLD = 6;

export function coverOfRoom(room: Pick<RoomPlan, "measured">): Cover {
  const pillars = room.measured.pillar_count;
  if (pillars <= 0) return "none";
  return pillars <= COVER_PILLAR_THRESHOLD ? "sparse" : "dense";
}

/* ------------------------------- measurement ------------------------------ */

export interface PressureContext {
  readonly open_ratio: number;
  readonly cover: Cover;
  readonly composition: Composition;
}

export function waveSize(wave: Wave): number {
  return wave.spawns.reduce((n, s) => n + s.count, 0);
}

/** Enemies scheduled to be on the floor at the busiest moment of the plan. */
export function peakConcurrency(waves: readonly Wave[]): number {
  let peak = 0;
  for (const w of waves) {
    let alive = 0;
    for (const other of waves) {
      if (other.at_ms <= w.at_ms && w.at_ms < other.at_ms + ASSUMED_TTK_MS) alive += waveSize(other);
    }
    peak = Math.max(peak, alive);
  }
  return peak;
}

/** Doc 005 step 5. */
export function measurePressure(waves: readonly Wave[], ctx: PressureContext): number {
  let total = 0;
  for (let i = 0; i < waves.length; i++) {
    const cf = concurrencyFactor(waves, i);
    for (const spawn of waves[i]!.spawns) {
      const per =
        threatWeight(spawn.archetype) *
        cf *
        opennessFactor(ctx.open_ratio, spawn.archetype) *
        coverFactor(ctx.cover, ctx.composition, spawn.archetype);
      total += per * spawn.count;
    }
  }
  return round3(total);
}

/** Same sum against a bare roster placed in one wave; used while sizing. */
export function measureRoster(roster: readonly EnemyId[], ctx: PressureContext): number {
  return measurePressure([{ at_ms: 0, spawns: roster.map((a) => ({ archetype: a, spawn_group: "", count: 1 })) }], ctx);
}

export function contextFor(room: Pick<RoomPlan, "measured">, composition: Composition): PressureContext {
  return { open_ratio: room.measured.open_ratio, cover: coverOfRoom(room), composition };
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Doc 005, "Validation": concurrent enemies never exceed 12. */
export function withinConcurrencyCap(waves: readonly Wave[]): boolean {
  return peakConcurrency(waves) <= MAX_CONCURRENT_ENEMIES;
}

/* --------------------------- option suitability --------------------------- */

/**
 * The tier each profile option pushes toward, used only to append the
 * suitability word to an option description (doc 005, profile table).
 *
 * Composition tiers follow the mean threat weight of each mix in
 * `MIX_RATIOS`: melee_heavy 1.50, siege 1.65, ranged_heavy 1.70, mixed 2.08.
 */
export const OPTION_TIERS = {
  composition: {
    melee_heavy: "release",
    siege: "build",
    ranged_heavy: "build",
    mixed: "peak",
  },
  density: { sparse: "release", normal: "build", dense: "peak" },
  wave_structure: { trickle: "release", two_waves: "build", single: "peak" },
  anchor: { none: "release", tank: "build", summoner: "peak" },
  entry: { far_front: "release", turrets_center: "build", flanks: "build", surround: "peak" },
} as const satisfies Record<string, Record<string, PressureTier>>;

export type ProfileParam = keyof typeof OPTION_TIERS;

export function optionTier<P extends ProfileParam>(
  param: P,
  value: keyof (typeof OPTION_TIERS)[P],
): PressureTier {
  return (OPTION_TIERS[param] as Record<string, PressureTier>)[value as string] as PressureTier;
}

/** The word appended to an option description for the room's tension. */
export function optionSuitability<P extends ProfileParam>(
  param: P,
  value: keyof (typeof OPTION_TIERS)[P],
  tension: Tension,
): Suitability {
  return suitability(optionTier(param, value), tension);
}
