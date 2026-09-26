/**
 * The short recent history, as labels (design doc 002, "State conventions").
 *
 * The state already says where the run is (`run_progress`) and how the player
 * is (`health`, `recent_damage`, `clear_speed`), but not what the run has been
 * *doing*. Without that, `next_tension` cannot see that it has already sent two
 * peaks, and the arc it produces is a sequence of locally correct answers that
 * reads as noise: three hard rooms running, or five builds without a breather.
 *
 * Jev cannot reason over a sequence, so none of this is a list and none of it
 * is a number. Code walks the history and emits one label each, exactly as
 * `summarize.ts` does for the player.
 */
import type { RunHistory, Tension } from "@jr/core";

export type LastTension = Tension | "none";
export type SinceRelease = "just" | "a_while" | "long";
export type LastRoomKind = "combat" | "elite" | "rest" | "none";
export type DamageTrend = "rising" | "steady" | "falling";
/** A reward kind, or `none` where the run has not shown one. */
export type DoorKind = "spell" | "affix" | "stat" | "gold" | "none";
export type DoorLean = DoorKind | "mixed";
export type LastMoodTemperature = "cold" | "warm" | "none";
export type LastMoodBrightness = "dim" | "bright" | "none";
export type LastMoodParticles = "calm" | "busy" | "none";
export type LastSymmetry = "mirrored" | "asymmetric" | "none";

export interface RecentHistory {
  /** The tension of the previous combat room, or `none` before the first. */
  readonly last_tension: LastTension;
  /** How long since the run last let up. */
  readonly since_release: SinceRelease;
  /** What the previous room was, with every vendor counting as a rest. */
  readonly last_room_kind: LastRoomKind;
  /** Whether the last room cost more than the one before it. */
  readonly damage_trend: DamageTrend;
  /**
   * **Which reward kind has been on the badge several rooms running**, or
   * `none` where the last rooms varied.
   *
   * Reported from play: once the affix slots opened, essentially every offer
   * put an affix door in front of the player, and the choice stopped being
   * one — "you just close your eyes and pick affix". The Director was not
   * wrong room by room; it could not see that it had given the same answer
   * six times, because Jev cannot count and the state carried no history of
   * the offer at all. This is that history, as one label.
   *
   * Every reward kind's option is grounded on **every value but its own**
   * (`KIND_CLAUSE`), which is how a fit clause says "not this one": when the
   * label reads `affix`, the affix option loses a matching clause that the
   * other three keep, and the offer moves on.
   */
  readonly door_offered_running: DoorKind;
  /** Which kind the player has walked through most this run, or `mixed`. */
  readonly door_taken_lean: DoorLean;
  /**
   * Which kind the player has been offered and **passed over** most — the
   * preference they revealed by not taking it, which is the half of revealed
   * preference the picks cannot show.
   */
  readonly door_skipped_most: DoorKind;
  /** The look of the room just built, so the look-only questions can alternate. */
  readonly last_mood_temperature: LastMoodTemperature;
  readonly last_mood_brightness: LastMoodBrightness;
  readonly last_mood_particles: LastMoodParticles;
  readonly last_symmetry: LastSymmetry;
}

/**
 * The damage series' direction, over the last two rooms that had one.
 *
 * `recent_damage` is the *sum* over the last two rooms, so it cannot say
 * whether things are getting worse or better — two rooms at one heart each and
 * a quiet room followed by a two-heart one are the same label. Rooms that cost
 * nothing are skipped rather than counted as an improvement, or a rest room
 * would read as the run easing off when nothing about the fights had changed.
 *
 * `steady` when there is not yet a series to read, which is also what a caller
 * that does not populate `hearts_lost` gets.
 */
export function damageTrend(hearts: readonly number[] | undefined): DamageTrend {
  if (!hearts || hearts.length < 2) return "steady";
  const fought = hearts.filter((h) => h > 0);
  const last = fought.at(-1);
  const before = fought.at(-2);
  if (last === undefined || before === undefined) return "steady";
  if (last > before) return "rising";
  if (last < before) return "falling";
  return "steady";
}

/** Doc 003's offerable types, sorted into the three kinds a question can weigh. */
function kindOf(room: string | undefined): LastRoomKind {
  if (room === undefined) return "none";
  if (room === "elite") return "elite";
  if (room === "combat" || room === "boss") return "combat";
  // Treasure, the shop and every vendor room — the merchant, the blacksmith
  // and the fountain — are the run letting up, whatever they sell.
  return "rest";
}

/**
 * Combat rooms since the run last let up: since the last `release` room, or
 * since the last room that was not a fight at all. Bucketed, because the
 * question is "is the player due a breather", not "how many".
 */
export function sinceRelease(history: RunHistory): SinceRelease {
  let n = 0;
  for (let i = history.rooms.length - 1; i >= 0; i--) {
    const kind = kindOf(history.rooms[i]);
    if (kind === "rest") break;
    if (history.tensions[i] === "release") break;
    n++;
  }
  if (n <= 1) return "just";
  if (n <= 3) return "a_while";
  return "long";
}

/** The reward kinds a door label can be, for the three door facts. */
const DOOR_KINDS: readonly DoorKind[] = ["spell", "affix", "stat", "gold"];

/**
 * How many rooms in a row count as "again": three. Two is a coincidence — with
 * four kinds and three doors, any given kind appears about three offers in
 * four — and four is a whole quarter of the run spent on one badge before the
 * Director is told.
 */
export const DOOR_RUN_LENGTH = 3;

/**
 * The kind that has been on the badge for the last `DOOR_RUN_LENGTH` offers
 * running. Not "the commonest", which would name a kind that merely happens to
 * be popular: only a kind that appeared in *every* one of the last few offers
 * is one the player has stopped choosing about.
 */
export function doorOfferedRunning(offered: readonly (readonly string[])[] | undefined): DoorKind {
  const recent = (offered ?? []).slice(-DOOR_RUN_LENGTH);
  if (recent.length < DOOR_RUN_LENGTH) return "none";
  for (const kind of DOOR_KINDS) if (recent.every((room) => room.includes(kind))) return kind;
  return "none";
}

/**
 * **The hard cap on a streak**, as against `DOOR_RUN_LENGTH`, which is when
 * the Director is *told*.
 *
 * Telling it is the right first move and it is not enough on its own: measured
 * on the live model with the fact in the state, one run still put an affix
 * badge on twelve consecutive offers and a spell badge on nine. A badge shown
 * four rooms running has stopped being a choice whatever the reason for it, so
 * the fourth is where code tries to stop offering it — a safety bound of the
 * kind doc 002 reserves for code. The caller keeps enough reward kinds to fill
 * the already-drawn number of doors.
 */
export const DOOR_STREAK_CAP = 4;

/**
 * **Every** kind that has been on all of the last `DOOR_STREAK_CAP` offers,
 * which are the ones code withholds from this one.
 *
 * It used to return one, the first in `DOOR_KINDS` order, and two kinds streak
 * together more often than that reading allows: with three doors drawn from
 * four kinds, a room that offers spell and affix four times running has two
 * spent badges and the cap withheld only spell. Measured on a live run, that
 * is exactly what happened — rooms 1 to 4 all offered spell *and* affix, spell
 * was withheld, and affix went on to a fifth offer with the cap nominally at
 * four. The bound is worth having only if it holds, so it holds for each.
 */
export function doorStreaksSpent(offered: readonly (readonly string[])[] | undefined): DoorKind[] {
  const rooms = offered ?? [];
  if (rooms.length < DOOR_STREAK_CAP) return [];
  const run = (kind: DoorKind) => trailingOffers(rooms, kind);
  return DOOR_KINDS.filter((kind) => run(kind) >= DOOR_STREAK_CAP)
    // Longest first, because three kinds can trip the cap at once and only so
    // many may leave a list that still has to fill every door: the caller
    // withholds from the front of this until the drawn count would be short.
    // Then the badge that runs on is the one that has run on least.
    .sort((a, b) => run(b) - run(a));
}

/** How many offers, counting back from the last, a kind has been on without a gap. */
function trailingOffers(rooms: readonly (readonly string[])[], kind: DoorKind): number {
  let n = 0;
  for (let i = rooms.length - 1; i >= 0 && rooms[i]!.includes(kind); i--) n++;
  return n;
}

/**
 * **How long a run may go without the gold door being on the list.**
 *
 * Gold is the one reward the Director never ranks first: measured over five
 * runs of about a hundred rooms each, it was the top need zero times, before
 * and after the briefing spelled out what a purse would buy at the next stop
 * (finding 6). That is not a fault in the state — it is a classifier reading
 * four options and gold being the one that is never the answer to "what does
 * this build need" — so the fix is not another fact. It is a floor.
 *
 * Five rooms, which is about a third of the fights: often enough that the
 * merchant's shelf at the stop is affordable and that a player who wants none
 * of stat, spell and affix has an out, rare enough that a run is not paid in
 * a currency with one place to spend it.
 */
export const GOLD_FLOOR_ROOMS = 5;

/**
 * Whether the gold badge has been off the list for `GOLD_FLOOR_ROOMS` offers.
 * False at the start of a run, when there is nothing yet to be overdue.
 */
export function goldOverdue(offered: readonly (readonly string[])[] | undefined): boolean {
  const rooms = offered ?? [];
  if (rooms.length < GOLD_FLOOR_ROOMS) return false;
  return rooms.slice(-GOLD_FLOOR_ROOMS).every((room) => !room.includes("gold"));
}

/**
 * **How much of its mass a card keeps for each time it has already been on a
 * reward screen this run.**
 *
 * Reported from play: "the spells and affixes feel like the same ones over and
 * over". Measured on eight seeds, every one of the twenty affixes reached a
 * screen *across the eight runs* — and a single run saw 8.4 of them, with the
 * five commonest taking 75% of its affix slots and 4.6 of its cards being ones
 * it had shown before. The pool is not too small; the sampling keeps landing
 * in the same corner of it, because the build that makes a card fit in room 5
 * is the same build in room 6.
 *
 * Which is finding 5 again: what the player is complaining about is a property
 * of the *sequence*, and Jev answers states. So the fit stays Jev's and the
 * spread is code's — each previous appearance multiplies the card's mass by
 * this, down to `CARD_REPEAT_FLOOR`, so a card the run keeps reaching for can
 * still come back and has to earn it each time.
 */
export const CARD_REPEAT_PENALTY = 0.45;
/**
 * The least a card is ever worth, however often it has been shown. A card the
 * build genuinely wants — the one upgrade for the one key — must not fall out
 * of the pool because the offer has been right about it four times.
 */
export const CARD_REPEAT_FLOOR = 0.12;

/**
 * How many times each card id has been on a reward screen this run, taken or
 * passed over. The journal holds the room the player is in nowhere, so this is
 * the rooms behind them.
 */
export function cardsShown(
  journal: readonly { readonly picked?: readonly string[]; readonly passed_over?: readonly string[] }[] | undefined,
): ReadonlyMap<string, number> {
  const seen = new Map<string, number>();
  for (const room of journal ?? [])
    for (const id of [...(room.picked ?? []), ...(room.passed_over ?? [])])
      seen.set(id, (seen.get(id) ?? 0) + 1);
  return seen;
}

/**
 * How long ago each reward kind was last on an offer, most stale first.
 *
 * The ranking decides the doors; where the ranking runs out — every remaining
 * option refused by a constraint — code has to fill the rest, and it filled
 * them in the order `REWARD_KINDS` happens to be written in. Gold is last in
 * that list, so gold got the leftovers of the leftovers and reached 2% of all
 * portals offered. Filling from the stalest kind first is the same fallback
 * with the arbitrary order taken out of it.
 */
export function staleFirst(
  kinds: readonly string[], offered: readonly (readonly string[])[] | undefined,
): string[] {
  const rooms = offered ?? [];
  const lastSeen = (k: string) => {
    for (let i = rooms.length - 1; i >= 0; i--) if (rooms[i]!.includes(k)) return rooms.length - i;
    return Number.POSITIVE_INFINITY;
  };
  return [...kinds].sort((a, b) => lastSeen(b) - lastSeen(a));
}

/** The kind the player walked through most, or `mixed` where two tie. */
export function doorTakenLean(taken: readonly string[] | undefined): DoorLean {
  return leader<DoorLean>(
    DOOR_KINDS.map((k) => [k as DoorLean, (taken ?? []).filter((t) => t === k).length] as const),
    "mixed",
  );
}

/**
 * The kind offered most often and taken least: what the player keeps walking
 * past. A kind never offered cannot be skipped, so the count is offers minus
 * takes and a kind with nothing to its name is not the answer.
 */
export function doorSkippedMost(
  offered: readonly (readonly string[])[] | undefined, taken: readonly string[] | undefined,
): DoorKind {
  return leader<DoorKind>(DOOR_KINDS.map((k) => [
    k,
    (offered ?? []).filter((room) => room.includes(k)).length - (taken ?? []).filter((t) => t === k).length,
  ] as const), "none");
}

/** The single highest count, or the tie word when nothing leads. */
function leader<T extends string>(counts: readonly (readonly [T, number])[], tie: T): T {
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const first = ranked[0];
  const second = ranked[1];
  if (!first || first[1] <= 0) return "none" as T;
  return second && second[1] === first[1] ? tie : first[0];
}

export function recentHistory(history: RunHistory): RecentHistory {
  const mood = history.moods?.[0];
  const symmetry = history.symmetries?.[0];
  return {
    last_tension: history.tensions.at(-1) ?? "none",
    since_release: sinceRelease(history),
    last_room_kind: kindOf(history.rooms.at(-1)),
    damage_trend: damageTrend(history.hearts_lost),
    door_offered_running: doorOfferedRunning(history.doors_offered),
    door_taken_lean: doorTakenLean(history.doors_taken),
    door_skipped_most: doorSkippedMost(history.doors_offered, history.doors_taken),
    last_mood_temperature: mood?.temperature ?? "none",
    last_mood_brightness: mood?.brightness ?? "none",
    last_mood_particles: mood?.particle_intensity ?? "none",
    last_symmetry: symmetry ?? "none",
  };
}

/**
 * Doc 002 keeps a hard rule out of the prose and in the option list: **a peak
 * never follows a peak.** Core's pacing cap only drops to `build_allowed`
 * after *two* peaks running, which permits the pair; this removes the second
 * one, so no answer can produce it.
 */
export function tensionsAfter(
  allowed: readonly Tension[], recent: RecentHistory,
): readonly Tension[] {
  if (recent.last_tension !== "peak") return allowed;
  const kept = allowed.filter((t) => t !== "peak");
  return kept.length > 0 ? kept : allowed;
}
