/**
 * Room questions (design doc 004). Round 1 asks what kind of space this room
 * should be and how large (doc 017); round 2 asks what fills each declared
 * zone slot.
 *
 * Jev never sees a tile. Shape, openness and cover are not three questions but
 * one over twelve feasible space archetypes (doc 002, "coupled parameters are
 * one question"), and hazard and spawn placement are not questions at all:
 * each archetype declares the slots its own mask guarantees are free floor, so
 * the conflict class disappears by construction and Jev only says what fills a
 * slot that already exists.
 */
import {
  COVER_BANDS, FEATURES, OPENNESS_BANDS, PLAYABLE_ARCHETYPES, ROOM_SIZES, coverOfRoom,
  featuresForCap, featuresForZone, UNMEASURED,
} from "@jr/core";
import type {
  Cover, Extent, Feature, HazardCap, KeysLean, Mood, ObservedLabels, Openness, RoomPlan, RoomSize,
  RoomType, SpaceArchetype, SpaceArchetypeId, SummaryLabels, Symmetry, Tension,
  BuildFacts,
} from "@jr/core";
import { labelSet } from "../describe.ts";
import type { ChoiceQuestion } from "../types.ts";
import { INTENT_CLAUSE, choiceQuestion } from "./common.ts";
import type { QuestionStyle } from "./common.ts";
import {
  MOOD_SPEC, SIZE_SPEC, SYMMETRY_SPEC, TENSION_SPEC, EMPTY_ZONE_SPEC, featureSpec, spaceSpec,
} from "./specs.ts";
import { grounded } from "./fits.ts";
import type { RecentHistory } from "./history.ts";

/**
 * **How much of its mass the last room's look keeps** (`pickAvoiding`).
 *
 * A third, which is a nudge rather than a veto. The four look questions each
 * state the alternation as design intent in their instructions and each read
 * the last room's look as a fact in the state, and measured over eight seeds
 * with both of those in place `mood_particles` still answered `calm` in 92%
 * of rooms and `mood_temperature` `cold` in 68%. That is finding 5 in its
 * plainest form: alternation is a property of a *sequence*, and a classifier
 * answering one state at a time cannot hold one. So the penalty is code's,
 * applied to Jev's own distribution just before the draw.
 *
 * A third rather than a tenth because the Director is still right about the
 * room often enough to be allowed to repeat itself: at 0.33 an answer held at
 * 0.9 still wins about three times in four, and one held at 0.6 gives way.
 */
export const LOOK_REPEAT_PENALTY = 0.33;

/** Doc 004's table: space 0.8, symmetry 0.9, mood 0.9; size (doc 017) is a pacing decision like space, 0.8. */
export const ROOM_TEMPERATURES: Readonly<Record<string, number>> = {
  space: 0.6,
  symmetry: 0.6,
  size: 0.5,
  // The look keeps more spread than the rest, and a repeat is weighed down in
  // code on top (`LOOK_REPEAT_PENALTY`).
  mood_temperature: 0.7,
  mood_brightness: 0.7,
  mood_particles: 0.7,
};

/** Doc 004 gives no temperature for the per-slot feature questions; a zone is
 *  a variety decision like symmetry, so it takes the same 0.7 the other
 *  per-slot picks in 005 use. */
export const ZONE_TEMPERATURE = 0.7;

/* ------------------------------ option filters ----------------------------- */

export interface SpaceFilter {
  /** Archetypes used by the last rooms, most recent first (doc 004). */
  readonly last_spaces: readonly SpaceArchetypeId[];
  /**
   * Doc 004 also says to drop archetypes "whose shape does not support the
   * fixed entry side", while doc 003 says a run leaving northward into a
   * corridor enters from the first supported side clockwise instead. Both
   * cannot hold: the second only happens if corridors were offered. Rotation
   * wins by default, because doc 003 states its observable consequence
   * ("north-south corridors never occur") as a fact about the finished game.
   */
  readonly entry_side?: "N" | "E" | "S" | "W";
  readonly drop_unsupported_entry?: boolean;
}

/** Doc 004: "drops the archetypes used in the last two rooms". */
export const SPACE_MEMORY = 2;

export function spaceOptions(filter: SpaceFilter): SpaceArchetype[] {
  const recent = new Set(filter.last_spaces.slice(0, SPACE_MEMORY));
  let kept = PLAYABLE_ARCHETYPES.filter((a) => !recent.has(a.id));
  if (kept.length === 0) kept = [...PLAYABLE_ARCHETYPES];
  if (filter.drop_unsupported_entry === true && filter.entry_side) {
    const side = filter.entry_side;
    const supported = kept.filter((a) => a.doors.includes(side));
    if (supported.length > 0) kept = supported;
  }
  return kept;
}

/** Doc 004: when `hazard_cap` is `none`, only non-hazard features are offered. */
export function zoneFeatureOptions(
  cap: HazardCap, cells: readonly (readonly [number, number])[], ext: Extent,
): readonly Feature[] {
  return cells.length > 0 ? featuresForZone(cap, cells, ext) : featuresForCap(cap);
}

/* ------------------------------ label helpers ------------------------------ */

/**
 * The openness label a measured room reports back to round 2. The bands are
 * stated on the obstacle ratio, which is one minus `open_ratio` (doc 004,
 * step 6), so the conversion happens here rather than at three call sites.
 */
export function opennessLabel(openRatio: number): Openness {
  const obstacle = 1 - openRatio;
  let best: Openness = "open";
  let bestDistance = Infinity;
  for (const [label, band] of Object.entries(OPENNESS_BANDS) as [Openness, readonly [number, number]][]) {
    if (obstacle >= band[0] && obstacle <= band[1]) return label;
    const d = obstacle < band[0] ? band[0] - obstacle : obstacle - band[1];
    if (d < bestDistance) {
      bestDistance = d;
      best = label;
    }
  }
  return best;
}

export function coverLabel(room: Pick<RoomPlan, "measured">): Cover {
  return coverOfRoom(room);
}

/** Doc 010 vocabulary for the pillar-count bands, used in descriptions only. */
export function coverOfArchetype(a: SpaceArchetype): Cover {
  void COVER_BANDS;
  return a.cover;
}

/* --------------------------------- state ---------------------------------- */

export interface RoomRound1State {
  readonly room_type: RoomType;
  readonly run_progress: SummaryLabels["run_progress"];
  /**
   * The range `next_tension` may answer within, as a label. The tension itself
   * is **not** here: round 1 decides it, so a round-1 question that read it
   * would depend on an answer from its own request.
   */
  readonly tension_cap: SummaryLabels["tension_cap"];
  readonly hazard_cap: HazardCap;
  readonly health: SummaryLabels["health"];
  /** The encounter questions weigh these (doc 005): heavy damage lightens a room, fast clears earn an anchor. */
  readonly recent_damage: SummaryLabels["recent_damage"];
  readonly clear_speed: SummaryLabels["clear_speed"];
  readonly movement_pressure_recent: SummaryLabels["movement_pressure_recent"];
  /**
   * The facts the room and encounter options name. Doc 002 reads an
   * instruction or an option that names a label as a promise that the label is
   * in the state, and doc 010 adds that the label must be a **fact**: a
   * quantity that was measured, named for what was measured. `build_range`,
   * `archetype`, `mana_sustain` and `build_power` stood here and were none of
   * those — they were code's classification of the player, and three of the
   * four came out of an offline build simulator rather than out of play.
   */
  /** Which style the keys lean, as a tally of their tags (`keysLean`). */
  readonly keys_lean: KeysLean;
  /**
   * What the last two fights measured (`run/observed.ts`), spread flat into
   * the state: the facts that replaced the simulated verdicts.
   */
  readonly mana_refused: ObservedLabels["mana_refused"];
  readonly mana_short_time: ObservedLabels["mana_short_time"];
  readonly hits_per_shot: ObservedLabels["hits_per_shot"];
  readonly cast_rate: ObservedLabels["cast_rate"];
  readonly damage_rate: ObservedLabels["damage_rate"];
  readonly sword_share: ObservedLabels["sword_share"];
  readonly hurt_by: ObservedLabels["hurt_by"];
  readonly intent_preset: string;
  /**
   * What the run has been doing (`history.ts`). `next_tension` is the main
   * reader: without it the arc is a sequence of locally correct answers that
   * reads as noise.
   */
  readonly last_tension: RecentHistory["last_tension"];
  readonly since_release: RecentHistory["since_release"];
  readonly last_room_kind: RecentHistory["last_room_kind"];
  readonly damage_trend: RecentHistory["damage_trend"];
  /**
   * What the last room looked like, so the four look-only questions can
   * alternate rather than all four being decided by the player's health.
   */
  readonly last_mood_temperature: RecentHistory["last_mood_temperature"];
  readonly last_mood_brightness: RecentHistory["last_mood_brightness"];
  readonly last_mood_particles: RecentHistory["last_mood_particles"];
  readonly last_symmetry: RecentHistory["last_symmetry"];
  /** What the keys carry between them (`run/build-facts.ts`); `mood_temperature` reads it. */
  readonly held_elements: BuildFacts["held_elements"];

  readonly last_shapes: readonly string[];
}

export function roomRound1State(input: {
  readonly room_type: RoomType;
  readonly tension_cap: SummaryLabels["tension_cap"];
  readonly labels: SummaryLabels;
  readonly intent_preset: string;
  readonly recent: RecentHistory;
  readonly last_spaces: readonly SpaceArchetypeId[];
  /** Which style the keys lean, tallied from their tags (`keysLean`). */
  readonly keys_lean: KeysLean;
  /** What the keys carry between them; `mood_temperature` is grounded on it. */
  readonly held_elements: BuildFacts["held_elements"];
}): RoomRound1State {
  return {
    room_type: input.room_type,
    run_progress: input.labels.run_progress,
    tension_cap: input.tension_cap,
    hazard_cap: input.labels.hazard_cap,
    health: input.labels.health,
    recent_damage: input.labels.recent_damage,
    clear_speed: input.labels.clear_speed,
    movement_pressure_recent: input.labels.movement_pressure_recent,
    // Facts about the staff and about the rooms just played; no verdicts
    // (doc 002, `run/observed.ts`).
    keys_lean: input.keys_lean,
    held_elements: input.held_elements,
    intent_preset: input.intent_preset,
    ...input.recent,
    ...(input.labels.observed ?? UNMEASURED),
    last_shapes: input.last_spaces.slice(0, SPACE_MEMORY),
  };
}

export interface RoomRound2State extends RoomRound1State {
  /** Round 1's answer, which round 2 is entitled to read: it is a later request. */
  readonly tension: Tension;
  readonly zones: readonly string[];
  readonly spawn_groups: readonly string[];
  readonly open_ratio_label: Openness;
  readonly cover_label: Cover;
}

export function roomRound2State(
  round1: RoomRound1State,
  room: Pick<RoomPlan, "measured" | "zones" | "spawn_groups">,
  tension: Tension,
): RoomRound2State {
  return {
    ...round1,
    tension,
    zones: room.zones.map((z) => z.id),
    spawn_groups: room.spawn_groups.map((g) => g.id),
    open_ratio_label: opennessLabel(room.measured.open_ratio),
    cover_label: coverLabel(room),
  };
}

/* -------------------------------- questions -------------------------------- */

/*
 * **Round 1 never names the tension.**
 *
 * The tension is now decided *inside* round 1 (`next_tension`), and doc 002
 * answers every question of a request independently: a room question that said
 * "fits when tension is peak" would be matching a label that this request is
 * simultaneously deciding, which is a dependency Jev cannot honour and a
 * promise the state cannot keep. Every round-1 option is therefore grounded on
 * the labels the tension question itself reads — health, recent damage, clear
 * speed, run progress and the room type — so the room and its pitch are
 * decided from the same evidence rather than one from the other.
 *
 * Round 2 is a separate request and *does* carry the decided tension, which is
 * why the encounter questions still name it.
 */
/*
 * **Four questions that were one question asked four times.**
 *
 * `symmetry`, `mood_temperature`, `mood_brightness` and `mood_particles` were
 * each grounded on the same partition of the same three labels — health,
 * recent damage and clear speed — with the safe side taking the hurt player
 * and the interesting side taking the healthy one. Measured over three live
 * Jev runs: `mood_temperature` warm 100%, `mood_particles` busy 100%,
 * `symmetry` asymmetric 94%, `mood_brightness` dim 91%, every one of them at
 * about 0.95 confidence. That is not Jev failing to answer; it is four
 * questions whose answer was already determined by a state that barely moves,
 * because a player who is coping is the common case and these say nothing
 * else about the room.
 *
 * Two changes, and both are facts rather than dice:
 *
 * - **Each now names a different field.** Symmetry is about reading a room
 *   under pressure, so it keeps health. The look questions are about the
 *   *room*, so they are grounded on the room type, how far the run has come
 *   and what the keys carry — fields that move through a run where health
 *   does not.
 * - **Each is told what the last room looked like** (`last_symmetry`,
 *   `last_mood_*`), and each option is grounded on the *other* answer. That is
 *   the same design rule doc 004 already applies to the space archetype —
 *   don't show the same thing twice running — stated as a fact Jev can match
 *   rather than as a filter code applies afterwards.
 */
const SYMMETRY_TEXT: Readonly<Record<Symmetry, string>> = {
  mirrored: grounded(
    "A mirrored layout: both halves offer the same routes, so the room reads at a glance.",
    ["health", "low", "critical"], ["recent_damage", "heavy"], ["last_symmetry", "asymmetric"],
  ),
  asymmetric: grounded(
    "An asymmetric layout: harder to read, and the variety a player who is coping can afford.",
    ["health", "ok", "full"], ["clear_speed", "normal", "fast"], ["last_symmetry", "mirrored", "none"],
  ),
};

const SIZE_TEXT: Readonly<Record<RoomSize, string>> = {
  compact: grounded(
    "A compact room, half again the view: the fight is found at once and the walk is short.",
    ["health", "low", "critical"], ["recent_damage", "heavy"],
    ["room_type", "treasure", "shop", "rest"],
  ),
  standard: grounded(
    "A standard room, three quarters again the view: the fight has a middle, an approach and a way round.",
    ["health", "ok"], ["clear_speed", "normal"], ["recent_damage", "some"],
  ),
  vast: grounded(
    "A vast room, twice the view: groups met one at a time, the longest fight and the longest walk.",
    ["health", "full"], ["clear_speed", "fast"], ["room_type", "elite"],
  ),
};

/**
 * Mood is look only, so each side is tied to something about the **room and
 * the run** rather than to the player's health, which the room questions
 * beside it already read. The alternation clause (`last_mood_*`) is what stops
 * a run of sixteen identical rooms: the honest fact is "the last one was warm",
 * and a Director told that will vary without code rolling a die for it.
 */
const MOOD_TEXT: Readonly<Record<string, string>> = {
  /*
   * **`room_type` is not a fact about the room here.** Grounding warm on
   * "combat or elite" and cold on the rest reads sensibly and is, in a run of
   * fourteen fights, a constant: warm came back at 98% with the alternation
   * clause already in place, because every room the question is asked about is
   * a combat room and that clause decided it every time. The fields left are
   * the ones that actually move over a run.
   */
  /*
   * **Two clauses a side, and the same two fields on both.**
   *
   * Every extra field is another chance for one side to match, and for a
   * look-only question there is no field it *has* to read — so the more of them
   * there are, the more likely one of them is a near-constant that decides the
   * question by itself. Measured, three did in turn: `room_type` is `combat`
   * for fourteen rooms of sixteen, so warm took 98%; `hazard_cap` is `high`
   * whenever the player is above two hearts, so once the harness stopped
   * pinning it, bright took 100%.
   *
   * So each question names its alternation fact and exactly **one** other, and
   * that other has to be a field that genuinely moves room to room — which,
   * for a question with no subject of its own, is a short list. Both fields are
   * covered end to end across the two options (doc 002), and the last room's
   * answer is what actually decides it, which is the design intent: the one
   * real rule about a look-only choice is not to make the same one sixteen
   * times running.
   */
  cold: grounded(
    "Cold light: a still, clinical room, and the deeper, older part of the place.",
    ["last_mood_temperature", "warm"], ["run_progress", "late", "pre_boss"],
  ),
  warm: grounded(
    "Warm light: an active, lived-in room where something is still burning.",
    ["last_mood_temperature", "cold", "none"], ["run_progress", "early", "mid"],
  ),
  dim: grounded(
    "Dim: contrast falls and the bullets carry the eye.",
    ["last_mood_brightness", "bright", "none"], ["damage_trend", "falling", "steady"],
  ),
  bright: grounded(
    "Bright: the whole floor is legible at once, hazards included.",
    ["last_mood_brightness", "dim"], ["damage_trend", "rising"],
  ),
  calm: grounded(
    "Calm particles: nothing competes with the enemy patterns.",
    ["last_mood_particles", "busy"], ["movement_pressure_recent", "heavy"],
  ),
  busy: grounded(
    "Busy particles: the room feels alive and slightly noisier.",
    ["last_mood_particles", "calm", "none"], ["movement_pressure_recent", "light"],
  ),
};

/**
 * What a space archetype is *for*, in labels. The archetype table's own
 * sentence says what the room looks like; these say who it suits, on the two
 * axes the mask fixes — cover decides whose range the room favours, openness
 * decides how much floor there is to dodge on. Without them `space` was the
 * lowest-confidence question in the run (about 0.23 on the live model) and
 * four of twelve archetypes took every room.
 */
function spaceFit(a: SpaceArchetype): string {
  /*
   * Range comes from the **shape**, not from the cover count: a lane is held
   * from its end whatever stands in it, and an arena is crossed. That is the
   * relation the archetype table's own sentences state ("long range builds
   * dominate the lane", "short range builds close the gap easily") and the
   * one the control's weights encode. A tight room is short range whatever
   * its shape, because there is no line to hold.
   */
  const range: Parameters<typeof grounded>[1] =
    a.openness === "tight" ? ["sword_share", "most"]
    : a.shape === "corridor" || a.shape === "ring" ? ["sword_share", "none"]
    : a.shape === "cross" || a.cover === "dense" ? ["sword_share", "some"]
    : ["sword_share", "most"];
  /* Open floor is room to dodge on, which is what a hurt player needs. */
  const room: Parameters<typeof grounded>[1] =
    a.openness === "tight" ? ["health", "full"]
    : a.openness === "open" ? ["health", "low", "critical"]
    : ["health", "ok"];
  /* Cover is what breaks a line the player is being shot along. */
  const pressure: Parameters<typeof grounded>[1] =
    a.cover === "dense" ? ["movement_pressure_recent", "heavy"]
    : ["movement_pressure_recent", "light"];
  return grounded(a.description, range, room, pressure);
}

export function buildRoomQuestions(input: {
  readonly spaces: readonly SpaceArchetype[];
  readonly state: RoomRound1State;
  readonly labels: SummaryLabels;
  /** The tensions the pacing cap permits. One is not a decision, so it is not asked. */
  readonly tensions: readonly Tension[];
  /** Which state format the request carries; see `QuestionStyle`. */
  readonly style?: QuestionStyle;
}): Record<string, ChoiceQuestion> {
  const labels = labelSet(input.state as unknown as Record<string, unknown>);
  const style = input.style;

  return {
    /*
     * The room's pitch, asked **with** the room rather than before it.
     *
     * It used to be its own request, made as the player left the previous room
     * so the portals could be planned, which cost every combat room a third
     * sequential call. It reads the same state as the room questions and none
     * of them may read its answer (doc 002: questions in one request are
     * answered independently), so it belongs here and the room costs two.
     */
    ...(input.tensions.length > 1 ? {
      next_tension: choiceQuestion({
        instructions:
          "Choose how hard this room is pitched, within the permitted range. This is the room's pitch, not " +
          "its shape, and it is the one decision that is about the whole run rather than about this room. " +
          "A run is paced by contrast: a hard room reads as hard because of the quiet one before it, and " +
          "a run held at one pitch — all moderate or all hard — has no shape whatever that pitch is. So " +
          "read the series as well as the player: how the player is doing, and what the last fights have " +
          "been pitched at and how long it is since the run let up.",
        options: input.tensions.map((t) => ({ id: t, description: TENSION_TEXT[t], spec: TENSION_SPEC[t]! })),
        labels, style,
      }),
    } : {}),
    space: choiceQuestion({
      instructions:
        "Choose the kind of space this room should be. Each option is one feasible combination of shape, " +
        "openness and cover, already checked to be buildable. Cover decides whose range the room favours " +
        "and open floor decides how much room there is to dodge on, so weigh how much of the damage the " +
        "sword did, the player's health and recent damage. The shapes of the last rooms are already out " +
        "of the list, so no option repeats one of them. " + INTENT_CLAUSE,
      options: input.spaces.map((a) => ({
        id: a.id,
        description: spaceFit(a),
        // The archetype's own sentence is what the space is; what it is not
        // for is read off its openness, its cover and its shape (`spaceSpec`).
        spec: spaceSpec(a),
      })),
      labels, style,
    }),
    symmetry: choiceQuestion({
      instructions:
        "Choose whether the layout is mirrored or asymmetric. Mirrored reads faster under pressure; " +
        "asymmetric buys variety when the player is coping. A place is somewhere the player is " +
        "travelling through, and a floor built the same way every room stops being one.",
      options: (["mirrored", "asymmetric"] as const).map((id) => ({
        id,
        description: SYMMETRY_TEXT[id],
        spec: SYMMETRY_SPEC[id]!,
      })),
      labels, style,
    }),
    size: choiceQuestion({
      instructions:
        "Choose how large this room is, from the room type and how the player is doing. A larger room spreads " +
        "the same kind of fight over more floor and more time, and asks for more walking to reach it.",
      options: ROOM_SIZES.map((id) => ({ id, description: SIZE_TEXT[id], spec: SIZE_SPEC[id]! })),
      labels, style,
    }),
    /*
     * The three look questions each name their own field and each carry the
     * last room's answer, so a run of sixteen rooms is not sixteen copies of
     * one room. Mood is look only; it never changes the layout.
     */
    mood_temperature: moodQuestion(
      "Choose the colour temperature of this room. A place is somewhere the player is travelling " +
      "through, and a floor lit the same colour every room stops being one. Cold is the deeper, older " +
      "part of the place; warm is where something is still alight. Mood is look only; it never changes " +
      "the layout.",
      ["cold", "warm"],
      labels, style,
    ),
    mood_brightness: moodQuestion(
      "Choose how bright this room reads. Brightness is a trade, not a difficulty: bright makes the whole " +
      "floor legible at once and hides nothing, dim drops the floor back so the lit things — bullets, " +
      "fire, the marks an enemy draws before it fires — are what the eye follows. Neither is the safe " +
      "one, and a place lit the same way every room stops being a place. Mood is look only; it never " +
      "changes the layout.",
      ["dim", "bright"],
      labels, style,
    ),
    mood_particles: moodQuestion(
      "Choose how busy the ambient particles are. Busy air makes a room feel inhabited and costs a little " +
      "legibility; calm air leaves the enemy patterns alone. The same answer every room is scenery rather " +
      "than mood. Mood is look only; it never changes the layout.",
      ["calm", "busy"],
      labels, style,
    ),
  };
}

function moodQuestion(
  instructions: string,
  options: readonly string[],
  labels: ReturnType<typeof labelSet>,
  style?: QuestionStyle,
): ChoiceQuestion {
  return choiceQuestion({
    instructions,
    options: options.map((id) => ({ id, description: MOOD_TEXT[id] ?? id, spec: MOOD_SPEC[id]! })),
    labels, style,
  });
}

/**
 * Who a zone feature suits, in labels, from its own tags. The feature table
 * says what a feature does to the floor; this says when the floor should do it.
 * Asked without it, the live model answered `none` for 50 of 55 slots, which is
 * a room library of empty rooms.
 */
function featureFit(f: Feature): string {
  const fit = FEATURE_FIT[f.id];
  if (fit) return grounded(f.description, ...fit);
  // A feature with no entry still has to say something a state can match.
  return grounded(f.description, ["tension", "build", "peak"], ["health", "ok", "full"], ["hazard_cap", "high"]);
}

/**
 * One fit per feature, not one per tag.
 *
 * Derived from the tags, the four floor hazards came out with the same
 * sentence, because they share `hazard` and `area_denial`; four options that
 * read alike are one option asked four times, and the live model answered the
 * edge slots at about 0.2 confidence while answering the centre slot, whose
 * list is shorter, at 0.99. Each feature now names the thing that is different
 * about it: what it charges the player for.
 */
const FEATURE_FIT: Readonly<Record<string, readonly Parameters<typeof grounded>[1][]>> = {
  // Hurts on contact: only where the player has the health and the room to spare.
  spike_strip: [["health", "full"], ["movement_pressure_recent", "light"], ["recent_damage", "none"]],
  // No damage at all, so it is the hazard a hurt player can still be asked to read.
  ice_patch: [["health", "ok"], ["recent_damage", "some"], ["tension", "build"]],
  // Charges for standing still in it, which is what a slow clear is doing.
  poison_pool: [["clear_speed", "slow"], ["tension", "build", "peak"], ["keys_lean", "dot", "area"]],
  // Splits the floor into two halves to shoot across.
  lava_channel: [["sword_share", "none"], ["tension", "peak"], ["health", "full"]],
  // Harmless until something lights it, so it is the fire build's own trap.
  grass_patch: [["keys_lean", "dot"], ["tension", "peak"], ["clear_speed", "fast"]],
  // The only option that gives rather than takes: cover to break a firing line.
  brazier: [["sword_share", "none", "some"], ["recent_damage", "heavy"], ["health", "low", "critical"]],
  // Adds a body's worth of ranged pressure from a fixed place.
  turret_mount: [["tension", "peak"], ["health", "full"], ["clear_speed", "fast"]],
};

/** The tension options, grounded on the same labels the room questions read. */
const TENSION_TEXT: Readonly<Record<Tension, string>> = {
  release: grounded(
    "Low intensity, a recovery room: the run gives the player something back.",
    ["health", "low", "critical"], ["recent_damage", "heavy"], ["clear_speed", "slow"],
    ["since_release", "long"], ["last_tension", "peak"], ["damage_rate", "low"],
  ),
  build: grounded(
    "Moderate intensity that keeps the run moving.",
    ["health", "ok"], ["recent_damage", "some"], ["clear_speed", "normal"],
    ["since_release", "a_while"], ["last_tension", "release"], ["damage_rate", "fair"],
  ),
  peak: grounded(
    "The hardest room the run currently allows.",
    ["health", "full"], ["clear_speed", "fast"], ["recent_damage", "none"],
    ["since_release", "just"], ["last_room_kind", "rest"], ["damage_rate", "high"],
  ),
};

/** Question name for a zone slot; one question per slot (doc 002). */
export function zoneQuestionName(zoneId: string): string {
  return `zone_${zoneId}`;
}

/** Doc 004: one question per declared slot, features matching the slot kind
 *  plus `none`, which is an ordinary gameplay answer and not the escape. */
export function buildZoneQuestions(input: {
  readonly zones: readonly { readonly id: string; readonly cells: readonly (readonly [number, number])[] }[];
  readonly extent: Extent;
  readonly hazard_cap: HazardCap;
  readonly state: RoomRound2State;
  readonly labels: SummaryLabels;
  readonly style?: QuestionStyle;
}): Record<string, ChoiceQuestion> {
  const labels = labelSet(input.state as unknown as Record<string, unknown>);
  const questions: Record<string, ChoiceQuestion> = {};
  for (const zone of input.zones) {
    // A solid is never offered for a slot in the middle of the arena; see
    // `centralZone`. The Director is not asked a question whose best answer
    // would be furniture standing where the fight is.
    const offered = zoneFeatureOptions(input.hazard_cap, zone.cells, input.extent);
    questions[zoneQuestionName(zone.id)] = choiceQuestion({
      instructions:
        `Choose what fills the ${zone.id} zone of this room. The slot takes at most one feature. A ` +
        "feature is what makes a floor a place rather than a surface: a hazard charges the player for " +
        "where they stand, cover gives them somewhere to be, and an empty slot leaves the fight to the " +
        "bodies in it. Every one of those is a real answer, `none` included, and a room of nothing but " +
        "plain floor is as much a decision as a room full of hazards. Weigh the room's tension, the " +
        "player's health and how much movement pressure they are already under.",
      options: [
        ...offered.map((f) => ({
          id: f.id,
          description: featureFit(f),
          // The feature table says what the thing does to the floor, which is
          // the whole of what it is; the fit clause was code's guess at when.
          // What it is not for comes off its own tags and hazard budget.
          spec: featureSpec(f),
          // The fact, not the verdict: a mana font is worth more to a player
          // whose bar spent the last fights under the cheapest key's cost.
          ...(f.tags.includes("mana_regen") ? { jev_hints: { favor_when: ["mana_short_time:most"] } } : {}),
        })),
        {
          id: "none",
          description: grounded(
            "Leave the zone empty: clean floor and one less thing to read.",
            ["health", "low", "critical"], ["recent_damage", "heavy"],
            ["movement_pressure_recent", "heavy"], ["tension", "release"],
          ),
          spec: EMPTY_ZONE_SPEC,
        },
      ],
      labels, style: input.style,
    });
  }
  return questions;
}

/** All feature ids, for the round-2 post-filters. */
export const FEATURE_IDS: readonly string[] = FEATURES.map((f) => f.id);

/** Assembles the mood the three mood answers describe. */
export function moodFrom(answers: {
  readonly temperature: string;
  readonly brightness: string;
  readonly particles: string;
}): Mood {
  return {
    temperature: answers.temperature === "warm" ? "warm" : "cold",
    brightness: answers.brightness === "bright" ? "bright" : "dim",
    particle_intensity: answers.particles === "busy" ? "busy" : "calm",
  };
}
