/**
 * Counter scoring and the Director charter's showcase floor (design doc 001,
 * "Director charter"; doc 005, profile table "Charter filter").
 *
 * Code decides whether a room may counter the build at all; Jev only decides
 * how. That decision is the prospective test in `filterForCharter`.
 */
import type { BuildArchetype, CounterScore, Range as RangeTag } from "../content/tags.ts";
import type { Composition, RoomType, RunHistory } from "../types.ts";

/** Doc 001: at least 40% of a run's combat rooms must be showcase rooms. */
export const SHOWCASE_FLOOR_PERCENT = 40;

/* ------------------------------ counter score ----------------------------- */

/**
 * Doc 005: "melee_heavy vs long range and ranged_heavy vs short". Positive
 * means the composition presses the build, negative means it lets the build
 * work.
 */
export const RANGE_DELTA: Readonly<Record<Composition, Readonly<Record<RangeTag, number>>>> = {
  melee_heavy: { short: -1, mid: 0, long: +1 },
  ranged_heavy: { short: +1, mid: 0, long: -1 },
  // Turrets deny ground from a fixed spot: murder up close, free targets far away.
  siege: { short: +1, mid: 0, long: -1 },
  mixed: { short: 0, mid: 0, long: 0 },
};

/**
 * The archetype axis only breaks ties, so the doc's range rule always wins
 * where it applies.
 */
export const ARCHETYPE_DELTA: Readonly<Record<BuildArchetype, Readonly<Record<Composition, number>>>> = {
  // Slow, expensive hits hate a swarm of cheap fast bodies and love fat turrets.
  nuke: { melee_heavy: +1, ranged_heavy: 0, siege: -1, mixed: 0 },
  // Area damage is paid for by clumps; spread-out ranged lines waste it.
  area: { melee_heavy: -1, ranged_heavy: +1, siege: 0, mixed: 0 },
  // Cheap repeat casting clears bodies faster than anything else.
  spam: { melee_heavy: -1, ranged_heavy: 0, siege: 0, mixed: 0 },
  // Damage over time needs the target to survive long enough to tick.
  dot: { melee_heavy: +1, ranged_heavy: 0, siege: -1, mixed: 0 },
  // A build that fights inside the sword's reach wants the bodies to come to it.
  melee: { melee_heavy: -1, ranged_heavy: +1, siege: +1, mixed: 0 },
  mixed: { melee_heavy: 0, ranged_heavy: 0, siege: 0, mixed: 0 },
};

export function counterScore(
  composition: Composition,
  buildRange: RangeTag,
  buildArchetype: BuildArchetype,
): CounterScore {
  const byRange = RANGE_DELTA[composition][buildRange];
  if (byRange > 0) return "counters";
  if (byRange < 0) return "favours";
  const byArchetype = ARCHETYPE_DELTA[buildArchetype][composition];
  if (byArchetype > 0) return "counters";
  if (byArchetype < 0) return "favours";
  return "neutral";
}

/** Doc 001: a showcase room is one scored `favours` or `neutral`. */
export function isShowcase(score: CounterScore): boolean {
  return score !== "counters";
}

/* ----------------------------- showcase floor ----------------------------- */

export interface ShowcaseTally {
  /** Combat rooms already scored. Elite rooms are not counted. */
  readonly combat_rooms: number;
  /** Of those, the ones scored `favours` or `neutral`. */
  readonly showcase_rooms: number;
}

function isTally(x: unknown): x is ShowcaseTally {
  return typeof x === "object" && x !== null && "combat_rooms" in x && "showcase_rooms" in x;
}

export type ShowcaseHistory = ShowcaseTally | Pick<RunHistory, "rooms" | "counter_scores">;

/**
 * Pairs stored counter scores with the rooms they were scored for. Elite
 * rooms carry an encounter and therefore a score, but count on neither side
 * of the ratio because their door was opt-in (doc 001).
 */
export function tallyShowcase(history: ShowcaseHistory): ShowcaseTally {
  if (isTally(history)) return history;
  const combatOnly = history.rooms.filter((r) => r === "combat");
  const withEncounter = history.rooms.filter((r) => r === "combat" || r === "elite");
  // Scores are stored one per encounter; a run that only stores combat scores
  // is accepted too, so the tally never silently slips by one.
  const scored =
    history.counter_scores.length === combatOnly.length && combatOnly.length !== withEncounter.length
      ? combatOnly
      : withEncounter;
  let combat_rooms = 0;
  let showcase_rooms = 0;
  const n = Math.min(scored.length, history.counter_scores.length);
  for (let i = 0; i < n; i++) {
    if (scored[i] !== "combat") continue;
    combat_rooms++;
    if (isShowcase(history.counter_scores[i]!)) showcase_rooms++;
  }
  return { combat_rooms, showcase_rooms };
}

/**
 * Doc 001: "a `counters` option is offered only if choosing it would leave
 * the ratio at or above 40% INCLUDING the room being planned." Integer
 * arithmetic, so 4/10 is exactly at the floor rather than a rounding call.
 */
export function counterAllowed(history: ShowcaseHistory, roomType: RoomType = "combat"): boolean {
  // An elite room counts on neither side, so it cannot move the ratio.
  if (roomType !== "combat") return true;
  const t = tallyShowcase(history);
  return t.showcase_rooms * 100 >= SHOWCASE_FLOOR_PERCENT * (t.combat_rooms + 1);
}

/** The ratio this room would leave behind if a `counters` option were taken. */
export function prospectiveShowcaseRatio(history: ShowcaseHistory, choice: CounterScore): number {
  const t = tallyShowcase(history);
  const showcase = t.showcase_rooms + (isShowcase(choice) ? 1 : 0);
  return showcase / (t.combat_rooms + 1);
}

export interface CounterOption<T> {
  readonly value: T;
  readonly score: CounterScore;
}

/**
 * Drops every `counters` option whose selection would put the run below the
 * showcase floor. `mixed` always scores `neutral`, so a composition list can
 * never be emptied by this filter.
 */
export function filterForCharter<T>(
  options: readonly CounterOption<T>[],
  history: ShowcaseHistory,
  roomType: RoomType = "combat",
): CounterOption<T>[] {
  if (counterAllowed(history, roomType)) return [...options];
  return options.filter((o) => isShowcase(o.score));
}

/**
 * The composition options a room may offer, already scored and filtered.
 * Doc 005 also drops the value equal to `last_profiles[0].composition` when
 * three or more remain.
 */
export const COMPOSITIONS: readonly Composition[] = ["melee_heavy", "ranged_heavy", "mixed", "siege"];

export function compositionOptions(opts: {
  readonly build_range: RangeTag;
  readonly build_archetype: BuildArchetype;
  readonly history: ShowcaseHistory;
  readonly room_type?: RoomType;
  readonly last_composition?: Composition | null;
}): CounterOption<Composition>[] {
  const scored = COMPOSITIONS.map((value) => ({
    value,
    score: counterScore(value, opts.build_range, opts.build_archetype),
  }));
  let kept = filterForCharter(scored, opts.history, opts.room_type ?? "combat");
  const last = opts.last_composition ?? null;
  if (last !== null && kept.length >= 3) {
    const trimmed = kept.filter((o) => o.value !== last);
    if (trimmed.length >= 2) kept = trimmed;
  }
  return kept;
}
