/**
 * Room questions (design doc 004). Round 1 asks what kind of space this room
 * should be; round 2 asks what fills each declared zone slot.
 *
 * Jev never sees a tile. Shape, openness and cover are not three questions but
 * one over twelve feasible space archetypes (doc 002, "coupled parameters are
 * one question"), and hazard and spawn placement are not questions at all:
 * each archetype declares the slots its own mask guarantees are free floor, so
 * the conflict class disappears by construction and Jev only says what fills a
 * slot that already exists.
 */
import {
  COVER_BANDS, FEATURES, OPENNESS_BANDS, PLAYABLE_ARCHETYPES, coverOfRoom,
  featuresForCap, featuresForZone,
} from "@jr/core";
import type {
  Cover, Feature, HazardCap, Mood, Openness, RoomPlan, RoomType, SpaceArchetype,
  SpaceArchetypeId, SummaryLabels, Symmetry, Tension,
} from "@jr/core";
import { labelSet } from "../describe.ts";
import type { ChoiceQuestion } from "../types.ts";
import { INTENT_CLAUSE, choiceQuestion } from "./common.ts";

/** Doc 004's table: space 0.8, symmetry 0.9, mood 0.9. */
export const ROOM_TEMPERATURES: Readonly<Record<string, number>> = {
  space: 0.8,
  symmetry: 0.9,
  mood_temperature: 0.9,
  mood_brightness: 0.9,
  mood_particles: 0.9,
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
  cap: HazardCap, cells: readonly (readonly [number, number])[] = [],
): readonly Feature[] {
  return cells.length > 0 ? featuresForZone(cap, cells) : featuresForCap(cap);
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
  readonly tension: Tension;
  readonly hazard_cap: HazardCap;
  readonly health: SummaryLabels["health"];
  /** The encounter questions weigh these (doc 005): heavy damage lightens a room, fast clears earn an anchor. */
  readonly recent_damage: SummaryLabels["recent_damage"];
  readonly clear_speed: SummaryLabels["clear_speed"];
  readonly movement_pressure_recent: SummaryLabels["movement_pressure_recent"];
  readonly build_range: SummaryLabels["build"]["range"];
  readonly last_shapes: readonly string[];
}

export function roomRound1State(input: {
  readonly room_type: RoomType;
  readonly tension: Tension;
  readonly labels: SummaryLabels;
  readonly last_spaces: readonly SpaceArchetypeId[];
}): RoomRound1State {
  return {
    room_type: input.room_type,
    run_progress: input.labels.run_progress,
    tension: input.tension,
    hazard_cap: input.labels.hazard_cap,
    health: input.labels.health,
    recent_damage: input.labels.recent_damage,
    clear_speed: input.labels.clear_speed,
    movement_pressure_recent: input.labels.movement_pressure_recent,
    build_range: input.labels.build.range,
    last_shapes: input.last_spaces.slice(0, SPACE_MEMORY),
  };
}

export interface RoomRound2State extends RoomRound1State {
  readonly zones: readonly string[];
  readonly spawn_groups: readonly string[];
  readonly open_ratio_label: Openness;
  readonly cover_label: Cover;
}

export function roomRound2State(
  round1: RoomRound1State,
  room: Pick<RoomPlan, "measured" | "zones" | "spawn_groups">,
): RoomRound2State {
  return {
    ...round1,
    zones: room.zones.map((z) => z.id),
    spawn_groups: room.spawn_groups.map((g) => g.id),
    open_ratio_label: opennessLabel(room.measured.open_ratio),
    cover_label: coverLabel(room),
  };
}

/* -------------------------------- questions -------------------------------- */

const SYMMETRY_TEXT: Readonly<Record<Symmetry, string>> = {
  mirrored: "A mirrored layout: the room reads at a glance and both halves offer the same routes.",
  asymmetric: "An asymmetric layout: harder to read, and the variety a release room can afford.",
};

const MOOD_TEXT: Readonly<Record<string, string>> = {
  cold: "Cold light: a still, clinical room.",
  warm: "Warm light: an active, pressing room.",
  dim: "Dim: contrast falls and the bullets carry the eye.",
  bright: "Bright: the whole floor is legible at once.",
  calm: "Calm particles: nothing competes with the enemy patterns.",
  busy: "Busy particles: the room feels alive and slightly noisier.",
};

export function buildRoomQuestions(input: {
  readonly spaces: readonly SpaceArchetype[];
  readonly state: RoomRound1State;
  readonly labels: SummaryLabels;
}): Record<string, ChoiceQuestion> {
  const labels = labelSet({ ...input.state, build: { range: input.state.build_range } });

  return {
    space: choiceQuestion({
      instructions:
        "Choose the kind of space this room should be. Each option is one feasible combination of shape, " +
        "openness and cover, already checked to be buildable. Vary against the shapes of the last rooms; " +
        "corridors and rings suit a long-range build, open arenas suit a short-range one. " +
        INTENT_CLAUSE,
      options: input.spaces.map((a) => ({
        id: a.id,
        description: a.description,
      })),
      labels,
    }),
    symmetry: choiceQuestion({
      instructions:
        "Choose whether the layout is mirrored or asymmetric. Mirrored reads faster under pressure; " +
        "asymmetric buys variety when the room is a release.",
      options: (["mirrored", "asymmetric"] as const).map((id) => ({
        id,
        description: SYMMETRY_TEXT[id],
      })),
      labels,
    }),
    mood_temperature: moodQuestion(
      "Choose the colour temperature of this room. Mood is look only; it never changes the layout.",
      ["cold", "warm"],
      labels,
    ),
    mood_brightness: moodQuestion(
      "Choose how bright this room reads. Mood is look only; it never changes the layout.",
      ["dim", "bright"],
      labels,
    ),
    mood_particles: moodQuestion(
      "Choose how busy the ambient particles are. Mood is look only; it never changes the layout.",
      ["calm", "busy"],
      labels,
    ),
  };
}

function moodQuestion(
  instructions: string,
  options: readonly string[],
  labels: ReturnType<typeof labelSet>,
): ChoiceQuestion {
  return choiceQuestion({
    instructions,
    options: options.map((id) => ({ id, description: MOOD_TEXT[id] ?? id })),
    labels,
  });
}

/** Question name for a zone slot; one question per slot (doc 002). */
export function zoneQuestionName(zoneId: string): string {
  return `zone_${zoneId}`;
}

/** Doc 004: one question per declared slot, features matching the slot kind
 *  plus `none`, which is an ordinary gameplay answer and not the escape. */
export function buildZoneQuestions(input: {
  readonly zones: readonly { readonly id: string; readonly cells: readonly (readonly [number, number])[] }[];
  readonly hazard_cap: HazardCap;
  readonly state: RoomRound2State;
  readonly labels: SummaryLabels;
}): Record<string, ChoiceQuestion> {
  const labels = labelSet({
    ...input.state,
    build: { range: input.state.build_range },
    mana_sustain: input.labels.build.mana_sustain,
  });
  const questions: Record<string, ChoiceQuestion> = {};
  for (const zone of input.zones) {
    // A solid is never offered for a slot in the middle of the arena; see
    // `centralZone`. The Director is not asked a question whose best answer
    // would be furniture standing where the fight is.
    const offered = zoneFeatureOptions(input.hazard_cap, zone.cells);
    questions[zoneQuestionName(zone.id)] = choiceQuestion({
      instructions:
        `Choose what fills the ${zone.id} zone of this room. The slot takes at most one feature, and ` +
        "`none` is a real answer: an empty zone is often the right room. Weigh what the player has been " +
        "taking damage from and how much movement pressure they are already under.",
      options: [
        ...offered.map((f) => ({
          id: f.id,
          description: f.description,
          ...(f.tags.includes("mana_regen") ? { jev_hints: { favor_when: ["mana_sustain:tight"] } } : {}),
        })),
        { id: "none", description: "Leave the zone empty: clean floor and one less thing to read." },
      ],
      labels,
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
