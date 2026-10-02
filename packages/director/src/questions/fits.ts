/**
 * Grounded fit clauses (design doc 002, "Every option says when it fits, in
 * labels the request's state carries").
 *
 * Jev matches a state to a description. An option whose text names no label the
 * state holds gives it nothing to match, and the unmatched mass lands on the
 * escape option. So every option in every question ends with a clause built
 * here, and only here, in one canonical shape:
 *
 *     Fits when health is low or critical.
 *
 * The shape is canonical so it can be checked mechanically: `fitPairs` reads
 * the clauses back out of a finished description, and `questions.test.ts`
 * asserts that every field named is a field the request's state actually
 * carries and every value is a level that field can take. A clause typed by
 * hand at a call site would pass unread; one built here cannot.
 *
 * Only label **values** appear, never numbers and never prose conditions such
 * as "the build is already set", which read as a fit but bind to nothing.
 */

/** The state fields a fit clause may name, with every level each can take. */
export const FIT_FIELDS = {
  health: ["critical", "low", "ok", "full"],
  recent_damage: ["none", "some", "heavy"],
  clear_speed: ["slow", "normal", "fast"],
  movement_pressure_recent: ["light", "heavy"],
  run_progress: ["early", "mid", "late", "pre_boss"],
  gold: ["poor", "ok", "rich"],
  tension: ["release", "build", "peak"],
  tension_cap: ["release_only", "build_allowed", "peak_allowed"],
  hazard_cap: ["none", "low", "high"],
  room_type: ["combat", "elite", "treasure", "shop", "rest", "boss"],
  /*
   * **Facts, not verdicts** (doc 002). What used to be here — `build_range`,
   * `archetype`, `bottleneck`, `mana_sustain`, `build_power`, `consistency` —
   * were classifications of the player made by code, three of them out of an
   * offline simulator rather than out of play. They are replaced by the
   * quantities they were guessing at, each measured in the rooms just played
   * (`run/observed.ts`), so an option cites what happened and Jev draws the
   * conclusion.
   */
  keys_lean: ["spam", "nuke", "area", "dot", "melee", "mixed"],
  off_style_picks: ["none", "one", "two_running"],
  mana_refused: ["never", "sometimes", "often"],
  mana_short_time: ["little", "some", "most"],
  hits_per_shot: ["few", "one", "several"],
  cast_rate: ["slow", "steady", "rapid"],
  damage_rate: ["low", "fair", "high"],
  sword_share: ["none", "some", "most"],
  hurt_by: ["nothing", "shots", "blades", "hazards"],
  intent_preset: ["spam", "nuke", "area", "dot", "melee"],
  last_tension: ["release", "build", "peak", "none"],
  since_release: ["just", "a_while", "long"],
  last_room_kind: ["combat", "elite", "rest", "none"],
  damage_trend: ["rising", "steady", "falling"],
  /*
   * **What the run has been offering, and what the player does with it**
   * (`history.ts`). A reward kind's option names every value of
   * `door_offered_running` *but its own*, which is how the canonical clause
   * shape says "not this one" — the repeated kind loses one matching clause
   * and the others keep it.
   */
  door_offered_running: ["none", "spell", "affix", "stat", "gold"],
  door_taken_lean: ["none", "mixed", "spell", "affix", "stat", "gold"],
  door_skipped_most: ["none", "spell", "affix", "stat", "gold"],
  /*
   * The look of the room just built, so the four look-only questions can
   * alternate instead of being decided, all four of them, by the same three
   * health labels.
   */
  last_mood_temperature: ["cold", "warm", "none"],
  last_mood_brightness: ["dim", "bright", "none"],
  last_mood_particles: ["calm", "busy", "none"],
  last_symmetry: ["mirrored", "asymmetric", "none"],
  /*
   * **The staff, as facts** (`run/build-facts.ts`). The state used to say how
   * complete the build was and never what was on it, so nothing could ground
   * an option on "the levels have not moved" or "the bar buys three casts".
   */
  spell_levels: ["all_base", "some_raised", "mostly_raised"],
  affix_slots_open: ["none", "few", "many"],
  held_elements: ["none", "one", "several"],
  casts_per_bar: ["many", "some", "few"],
  mana_stats_taken: ["none", "one", "several"],
  build_shape: ["raw", "forming", "formed"],
  build_gaps: ["some", "none"],
  portal_count: ["one", "two", "three"],
  open_ratio_label: ["open", "mixed", "tight"],
  cover_label: ["none", "sparse", "dense"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type FitField = keyof typeof FIT_FIELDS;

/** One condition: a field, and the levels of it the option suits. */
export type Fit = readonly [FitField, ...string[]];

const pretty = (field: string): string => field.replace(/_/g, " ");

function clause(fit: Fit): string {
  const [field, ...values] = fit;
  const legal = FIT_FIELDS[field] as readonly string[];
  for (const v of values)
    if (!legal.includes(v)) throw new Error(`"${v}" is not a level of ${field}`);
  if (values.length === 0) throw new Error(`fit on ${field} names no level`);
  const list = values.length === 1
    ? values[0]!
    : `${values.slice(0, -1).join(", ")} or ${values.at(-1)!}`;
  return `${pretty(field)} is ${list}`;
}

/**
 * The sentence appended to an option's description. Several conditions read as
 * alternatives, never as a conjunction: Jev cannot carry two conditions through
 * one match, and an option that needs both is an option whose two halves should
 * have been two options.
 *
 * They are separated by a semicolon rather than by "or", so that a value list
 * inside one condition ("low or critical") and the boundary between two
 * conditions are different marks, and the clause can be read back exactly.
 */
export function fits(...conditions: readonly Fit[]): string {
  if (conditions.length === 0) throw new Error("an option needs at least one fit condition");
  return `Fits when ${conditions.map(clause).join("; when ")}.`;
}

/** The static half of an option, plus its fit clause. */
export function grounded(text: string, ...conditions: readonly Fit[]): string {
  return `${text.trim().replace(/\s+$/, "")} ${fits(...conditions)}`;
}

/**
 * The static half again, with the fit clause taken back off.
 *
 * A fit clause asserts a field of a state that the briefing arm does not send,
 * so on that arm it is a claim about nothing. Every option there should carry
 * a written spec instead; this is the floor for the ones code generates from a
 * content table, where there is no hand-written spec to use.
 */
export function unground(text: string): string {
  return text.replace(/\s*Fits when [^.]*\.\s*$/, "").trim();
}

/** One clause of a fit sentence, up to the semicolon or the full stop. */
const CLAUSE = /Fits when ([^.]*)\./g;
const CONDITION = /([a-z ]+?) is ([a-z_]+(?:(?:, | or )[a-z_]+)*)/g;

/**
 * Every (field, value) a finished description asserts, for the grounding test.
 * Reads the canonical shape back; prose outside a fit sentence is ignored,
 * which is what the shape is for — an option that says "gold is spent at the
 * merchant" is describing a reward, not claiming a state.
 */
export function fitPairs(description: string): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = [];
  for (const sentence of description.matchAll(CLAUSE))
    for (const condition of sentence[1]!.split("; ")) {
      // One condition per segment: a second "<field> is <value>" in the same
      // segment would be prose that happened to read like one.
      const m = CONDITION.exec(condition.replace(/^when /, ""));
      CONDITION.lastIndex = 0;
      if (!m) continue;
      const field = m[1]!.trim().replace(/ /g, "_");
      if (!(field in FIT_FIELDS)) continue;
      for (const value of m[2]!.split(/, | or /)) out.push({ field, value });
    }
  return out;
}
