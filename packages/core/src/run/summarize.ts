/**
 * The only module allowed to turn numbers into labels (design doc 002,
 * "State conventions"). Every threshold lives here so the vocabulary in doc 010
 * and the words in option descriptions can never drift apart.
 */
import type {
  BuildArchetype, ClearSpeed, Consistency, CounterScore, Gold, Health,
  RecentDamage, RunProgress, SummaryLabels, Tension,
} from "../types.ts";
import type { Archetype } from "../content/tags.ts";
import { REGULAR_ROOMS } from "./pacing.ts";

export const MAX_HEARTS = 6;

export function bucketHealth(hearts: number, max = MAX_HEARTS): Health {
  const f = hearts / max;
  if (hearts <= 1) return "critical";
  if (f <= 0.5) return "low";
  if (f < 1) return "ok";
  return "full";
}

/** Hearts lost across the last two rooms. */
export function bucketRecentDamage(heartsLost: number): RecentDamage {
  if (heartsLost === 0) return "none";
  if (heartsLost <= 2) return "some";
  return "heavy";
}

export function bucketClearSpeed(actualMs: number, expectedMs: number): ClearSpeed {
  if (expectedMs <= 0) return "normal";
  const r = actualMs / expectedMs;
  if (r <= 0.7) return "fast";
  if (r >= 1.3) return "slow";
  return "normal";
}

/** Near-misses per second across the last room, a proxy for how squeezed the player was. */
export function bucketMovementPressure(nearMissesPerSecond: number): "light" | "heavy" {
  return nearMissesPerSecond >= 1.5 ? "heavy" : "light";
}

export function bucketGold(gold: number): Gold {
  if (gold < 20) return "poor";
  if (gold < 60) return "ok";
  return "rich";
}

export function bucketRunProgress(roomIndex: number): RunProgress {
  if (roomIndex >= REGULAR_ROOMS) return "pre_boss";
  if (roomIndex <= 3) return "early";
  if (roomIndex <= 6) return "mid";
  return "late";
}

/**
 * Two consecutive picks outside the preset's tag set count as a pivot, which
 * the reward instructions treat as the new intent (doc 007).
 */
export function bucketConsistency(recentPickTags: readonly (readonly string[])[], preset: Archetype): Consistency {
  const offPlan = recentPickTags.slice(-3).map((tags) => !tags.includes(preset));
  const last2 = offPlan.slice(-2);
  if (last2.length === 2 && last2.every(Boolean)) return "pivoted";
  return offPlan.some(Boolean) ? "drifting" : "on_plan";
}

/** Top-n tags by count, ties broken by name so the label is stable. */
export function dominantTags(counts: Readonly<Record<string, number>>, n = 3): string[] {
  return Object.entries(counts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([t]) => t);
}

/**
 * Share of combat rooms that were showcase rooms, and the prospective share if
 * one more room of the given score were added (doc 001, "Showcase floor").
 * Elite rooms count on neither side, so callers pass combat rooms only.
 */
export const SHOWCASE_FLOOR = 0.4;

export function showcaseRatio(scores: readonly CounterScore[]): number {
  if (scores.length === 0) return 1;
  const showcase = scores.filter((s) => s !== "counters").length;
  return showcase / scores.length;
}

export function showcaseRatioWith(scores: readonly CounterScore[], next: CounterScore): number {
  return showcaseRatio([...scores, next]);
}

/** True when offering a countering option would breach the floor. */
export function countersWouldBreachFloor(scores: readonly CounterScore[]): boolean {
  return showcaseRatioWith(scores, "counters") < SHOWCASE_FLOOR;
}

export interface RawRunState {
  readonly hearts: number;
  readonly heartsLostLastTwoRooms: number;
  readonly lastClearMs: number;
  readonly expectedClearMs: number;
  readonly nearMissesPerSecond: number;
  readonly gold: number;
  readonly roomIndex: number;
  readonly recentPickTags: readonly (readonly string[])[];
  readonly tagCounts: Readonly<Record<string, number>>;
  readonly preset: Archetype;
  readonly build: {
    readonly archetype: BuildArchetype;
    readonly bottleneck: SummaryLabels["build"]["bottleneck"];
    readonly mana_sustain: SummaryLabels["build"]["mana_sustain"];
    readonly range: SummaryLabels["build"]["range"];
    readonly missing_roles: SummaryLabels["build"]["missing_roles"];
    readonly dominant_tags: readonly string[];
  };
  readonly tensions: readonly Tension[];
}

export function summarize(
  raw: RawRunState,
  pacing: { tension_cap: SummaryLabels["tension_cap"]; hazard_cap: SummaryLabels["hazard_cap"]; pressure_cap: number },
): SummaryLabels {
  return {
    health: bucketHealth(raw.hearts),
    recent_damage: bucketRecentDamage(raw.heartsLostLastTwoRooms),
    clear_speed: bucketClearSpeed(raw.lastClearMs, raw.expectedClearMs),
    movement_pressure_recent: bucketMovementPressure(raw.nearMissesPerSecond),
    run_progress: bucketRunProgress(raw.roomIndex),
    gold: bucketGold(raw.gold),
    tension_cap: pacing.tension_cap,
    hazard_cap: pacing.hazard_cap,
    pressure_cap: pacing.pressure_cap,
    build: raw.build,
    preference: {
      dominant: dominantTags(raw.tagCounts),
      consistency: bucketConsistency(raw.recentPickTags, raw.preset),
    },
  };
}

/** Every value that reaches Jev must be a label or a small enum, never a raw number. */
export function assertNoRawNumbers(state: unknown, path = "state"): void {
  if (typeof state === "number")
    throw new Error(`${path} is a raw number; buckets belong in summarize.ts`);
  if (Array.isArray(state)) state.forEach((v, i) => assertNoRawNumbers(v, `${path}[${i}]`));
  else if (state && typeof state === "object")
    for (const [k, v] of Object.entries(state)) assertNoRawNumbers(v, `${path}.${k}`);
}
