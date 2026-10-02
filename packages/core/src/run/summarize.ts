/**
 * The only module allowed to turn numbers into labels (design doc 002,
 * "State conventions"). Every threshold lives here so the vocabulary in doc 010
 * and the words in option descriptions can never drift apart.
 */
import type {
  ClearSpeed, Consistency, CounterScore, Gold, Health,
  RecentDamage, RunProgress, SummaryLabels, Tension,
} from "../types.ts";
import type { ItemRegistry } from "../spells/items.ts";
import type { Archetype } from "../content/tags.ts";
import { RUN_BOSS_ROOM, RUN_COMBAT_ROOMS } from "./doors.ts";

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

/**
 * **How long a room takes a person** (design doc 011, "Skill profiles"), by
 * room index, in seconds.
 *
 * It was a flat 30 seconds, which is the reference player's pace and nobody
 * else's, so every room a human played read `slow` and a label that never moves
 * is a label the Director cannot use. The first correction overshot the other
 * way: it was set from one early session where the opening room went to
 * learning the buttons, and put room 1 at 105 seconds.
 *
 * **Recalibrated against a full played run**: sixteen rooms in 10:06, the boss
 * in 1:05, 24 HP lost over the whole run — so about 38 seconds a fight, with
 * the first one longer and the last few longer again. A curve that calls that
 * run `fast` in every room is as useless as one that calls it `slow`; the
 * anchors are set so an unhurried clear at this player's pace reads `normal`,
 * a sharp one reads `fast`, and a room that goes wrong reads `slow`.
 *
 * The curve falls after the opening rooms — the player learns faster than the
 * rooms grow — and rises again at the end, where the rooms are biggest, and
 * the boss is a fight of its own length.
 *
 * That run was timed to the door, and a room is now timed to its clear
 * (`World.statsAtClear`), so each anchor carries the walk to the reward and on
 * to a door: measured at 1.5 s from the middle of the room, about 5 s from its
 * far corner, so 3 to 6 s in play — a tenth of a room, inside the ±30% that
 * reads `normal`, and only for the three rooms before the player's own median
 * takes over. Refit from a played run's `fightMs` rather than corrected by
 * guess.
 *
 * (The same session is the evidence that the game is currently too easy: 24 HP
 * over sixteen rooms is a run that was never in danger. That is a balance
 * question, not a labelling one, and this curve does not try to answer it.)
 */
export const EXPECTED_CLEAR_SECONDS: readonly (readonly [number, number])[] = [
  [1, 60], [3, 45], [6, 38], [11, 38], [RUN_COMBAT_ROOMS, 45], [RUN_BOSS_ROOM, 75],
];

/** The human baseline for one room, interpolated between the anchors, in ms. */
export function expectedClearMs(roomIndex: number): number {
  const first = EXPECTED_CLEAR_SECONDS[0]!;
  const last = EXPECTED_CLEAR_SECONDS[EXPECTED_CLEAR_SECONDS.length - 1]!;
  if (roomIndex <= first[0]) return first[1] * 1000;
  if (roomIndex >= last[0]) return last[1] * 1000;
  for (let i = 1; i < EXPECTED_CLEAR_SECONDS.length; i++) {
    const a = EXPECTED_CLEAR_SECONDS[i - 1]!;
    const b = EXPECTED_CLEAR_SECONDS[i]!;
    if (roomIndex <= b[0]) return (a[1] + ((b[1] - a[1]) * (roomIndex - a[0])) / (b[0] - a[0])) * 1000;
  }
  return last[1] * 1000;
}

/** How many past rooms the running baseline is taken over, and how far it may drift. */
export const PACE_WINDOW = 5;
const PACE_MIN = 0.2;
const PACE_MAX = 2.5;

/**
 * What this room *should* have taken, for this player.
 *
 * Against the fixed baseline alone the label says how good the player is, which
 * is a fact about them and not about the room — a strong player reads `fast`
 * for a whole run and a new one reads `slow`, and in neither case does the
 * Director learn that *this* room went unusually well. So once there is enough
 * of a run to take one, the expectation is **the player's own recent median**,
 * held inside a band around the human curve so that a run of four-second rooms
 * cannot redefine fast out of existence.
 *
 * `pastMs` is the length of each cleared fight room so far, in room order.
 */
export function expectedClearMsFor(roomIndex: number, pastMs: readonly number[]): number {
  const baseline = expectedClearMs(roomIndex);
  const recent = pastMs.filter((ms) => ms > 0).slice(-PACE_WINDOW);
  if (recent.length < 3) return baseline;
  const sorted = [...recent].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return Math.min(baseline * PACE_MAX, Math.max(baseline * PACE_MIN, median));
}

/**
 * **How much health a run has usually lost by this room**, in points.
 *
 * The state can already say how much the player has lost; it cannot say
 * whether that is a lot. A designer reading a run back always asks the second
 * question, and without an answer "lost 22 of 60" is a number with nothing to
 * compare it to.
 *
 * The anchor is the same played run `EXPECTED_CLEAR_SECONDS` is calibrated on:
 * sixteen rooms, 24 HP lost over the whole of it. The curve is not flat,
 * because the opening rooms are nearly free and the last few are not — so it
 * is a share of the run's total that rises with the square of progress, which
 * puts about a fifth of the loss in the first half.
 */
export const TYPICAL_RUN_HEALTH_LOST = 24;

export function typicalHealthLostBy(roomIndex: number): number {
  const through = Math.max(0, Math.min(1, (roomIndex - 1) / RUN_BOSS_ROOM));
  return TYPICAL_RUN_HEALTH_LOST * through * through;
}

export function bucketClearSpeed(actualMs: number, expectedMs: number): ClearSpeed {
  if (expectedMs <= 0) return "normal";
  const r = actualMs / expectedMs;
  if (r <= 0.7) return "fast";
  if (r >= 1.3) return "slow";
  return "normal";
}

/**
 * **How squeezed the player was**: the share of the last room's time with an
 * enemy bullet within `NEAR_BULLET_PX` of them.
 *
 * It used to take near-misses per second, which nothing measured — both the
 * scene and the harness passed a constant, so `movement_pressure_recent` was
 * `light` for every room of every run and the options grounded on it were
 * grounded on nothing. The playtest log already records the time under fire,
 * in the same way in the browser and in the harness, so that is what it reads.
 *
 * The threshold is a fifth of the room. Measured over reference runs the share
 * runs from nothing to about two fifths, with the median near a fifth, so this
 * splits the rooms that were genuinely a dodging problem from the rest.
 */
export const NEAR_BULLET_HEAVY = 0.2;

export function bucketMovementPressure(nearBulletShare: number): "light" | "heavy" {
  return nearBulletShare >= NEAR_BULLET_HEAVY ? "heavy" : "light";
}

export function bucketGold(gold: number): Gold {
  if (gold < 20) return "poor";
  if (gold < 60) return "ok";
  return "rich";
}

/**
 * Where the run is, over the **fourteen-fight** structure doc 014 sizes the run
 * against.
 *
 * It read the old nine-room shape (`REGULAR_ROOMS`), so from room 9 onward
 * every room of a sixteen-room run said `pre_boss` — half the run, at the one
 * label several door options are grounded on. Measured over four reference
 * runs it came out `pre_boss` for 24 of 56 rooms and `late` for 8, which is
 * the affix door's condition firing in the wrong half of the run and the spell
 * door's ("early or mid") ending five rooms too soon.
 *
 * `pre_boss` now means what it says: the last fight, the vendors' stop, and the
 * boss.
 */
export const RUN_PROGRESS_STEPS: readonly (readonly [number, RunProgress])[] = [
  [4, "early"], [9, "mid"], [RUN_COMBAT_ROOMS - 1, "late"],
];

export function bucketRunProgress(roomIndex: number): RunProgress {
  for (const [last, label] of RUN_PROGRESS_STEPS) if (roomIndex <= last) return label;
  return "pre_boss";
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
 * **The style tags the held spells share most**, most first: the build's
 * revealed preference (doc 007), counted off the keys rather than inferred.
 * The element placeholder `none` is not a signal and is not counted.
 */
export function heldDominantTags(
  slots: readonly ({ readonly base: string } | null)[], items: ItemRegistry,
): string[] {
  const counts: Record<string, number> = {};
  for (const slot of slots) {
    if (!slot) continue;
    for (const tag of items.get(slot.base)?.tags ?? [])
      if (tag !== "none") counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return dominantTags(counts, 3);
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
  readonly build: SummaryLabels["build"];
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
