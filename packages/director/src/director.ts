/**
 * The Director (design docs 002, 003, 004, 005, 007).
 *
 * One implementation, parameterised by where distributions come from. Jev,
 * the rule table and flat random therefore share every option filter, every
 * generator and every sampler, and a blind test compares the one part that
 * differs. The fallback contract lives here: any failure of the Jev source
 * hands that single decision to the rule source, never to random.
 */
import {
  ITEMS, PRESSURE_BANDS, RngSource,
  assembleEncounterDetailed, applyEliteAffixes, affixContext, enumerateAffixSets,
  bandForRoom, counterScore, filterForCharter,
  generateRoom, pacingLabels, sampleOne,
  sampleUniform, sampleWithoutReplacement, toRoomPlan, withTemperature,
  allowedTensions, PLAYABLE_ARCHETYPES, FEATURES,
  assemblePortals, SCHOOL_OF,
  rampDensities, rampAnchors, rampSubspecies, rampElitePresence, rampFor, rampRoster,
  keysLean, UNMEASURED, PORTAL_NEED_TEMPERATURE, PORTAL_TAIL_TEMPERATURE, NPC_MIN_NEED,
  buildFacts, NO_BUILD, enemy, isAudienceRoom, audienceZones, biomeFor, BIOME_TEMPERATURE,
} from "@jr/core";
import type {
  CounterScore, Distribution, EncounterProfile, RoomPlan,
  RoomSize, RoomType, Rng, RunContext, SpaceArchetypeId, Tension, Density, Anchor,
  PortalChoices, RewardCardKind, NpcKind, EnemyId, SubspeciesWeight, ElitePresence,
  KeysLean,
} from "@jr/core";
import { EvaluatorError, FALLBACK, NOUL_YES } from "./types.ts";
import type { ChoiceQuestion, Decision, NoulQuestion, Question, DecisionSource, RequestMeta } from "./types.ts";
import type { DistributionSource } from "./source.ts";
import { flatTable, jevSource, tableSource } from "./source.ts";
import { ruleTable } from "./weights.ts";
import { ruleTensionWeights } from "./rule.ts";
import { choiceQuestion, clampFreeText, INTENT_CLAUSE, offeredKeys } from "./questions/common.ts";
import type { QuestionStyle } from "./questions/common.ts";
import {
  ANCHOR_SPEC, COMPOSITION_SPEC, DENSITY_SPEC, ELITE_GRADE_SPEC, ELITE_PORTAL_SPEC, ELITE_PRESENCE_SPEC,
  ENTRY_SPEC, KIND_SPEC, NORMAL_GRADE_SPEC, NPC_SPEC,
  SUBSPECIES_WEIGHT_SPEC, VARIETY_SPEC,
  WAVES_SPEC, cardNegativesDiscriminate, cardNotFor, subspeciesSpec,
} from "./questions/specs.ts";
import { briefingFrom } from "./briefing.ts";
import type { BriefingCardPool, BriefingRoomNow } from "./briefing.ts";
import { decidingPhrases } from "./deciding.ts";
import { FIT_FIELDS, grounded, unground } from "./questions/fits.ts";
import type { Fit } from "./questions/fits.ts";
import {
  CARD_REPEAT_FLOOR, CARD_REPEAT_PENALTY, cardsShown, doorStreaksSpent, goldOverdue, recentHistory,
  staleFirst, tensionsAfter,
} from "./questions/history.ts";
import {
  AFFIX_INTENT_INSTRUCTIONS, AFFIX_INTENT_WEIGHT, AFFIX_LANES, affixIntentOptions, laneFromText,
} from "./questions/affixes.ts";
import type { AffixIntent } from "./questions/affixes.ts";
import {
  buildRoomQuestions, buildZoneQuestions, moodFrom, roomRound1State, roomRound2State,
  spaceOptions, zoneQuestionName, LOOK_REPEAT_PENALTY, ROOM_TEMPERATURES, ZONE_TEMPERATURE, coverOfArchetype,
} from "./questions/room.ts";
import { labelSet } from "./describe.ts";
import type {
  CardOrigin, CardPlan, CardRequest, DoorPlan, DoorRef, OfferPlan, OfferRequest, PortalPlan,
  RoomPlanResult,
} from "./plans.ts";

/** The three runtime arms. `scripted` is a replay mode and lives in trace.ts. */
export type DirectorArm = "jev" | "rule" | "random";

export interface Director {
  readonly mode: DirectorArm;
  planDoors(ctx: RunContext): Promise<DoorPlan>;
  /**
   * The room. With `alongside`, the room's own offer rides in round 1: it
   * reads the same state and does not depend on the room, so it costs no
   * request of its own (`RoomPlanResult.offer`).
   */
  /**
   * `suggested` is used only when the pacing cap leaves a single legal
   * tension; otherwise round 1 decides it and the answer comes back on
   * `RoomPlanResult.tension`.
   */
  planRoom(ctx: RunContext, door: DoorRef, suggested: Tension, alongside?: OfferRequest): Promise<RoomPlanResult>;
  /** Doc 003's per-portal question, over the legal answers code enumerated. */
  planPortals(ctx: RunContext, choices: PortalChoices): Promise<PortalPlan>;
  /** Doc 007's offer, over the legal cards code enumerated for one reward kind. */
  planCards(ctx: RunContext, req: CardRequest): Promise<CardPlan>;
  /** Portals and card offers in one request, for a room with no room plan to ride on (a vendor's). */
  planOffer(ctx: RunContext, req: OfferRequest): Promise<OfferPlan>;
}

export interface DirectorDeps {
  readonly evaluate?: import("./types.ts").Evaluator;
  /**
   * **Which state format every request carries** (doc 002, and the A/B this
   * switch exists for).
   *
   * `labels` is the state the Director has always sent: a flat table of label
   * values, with each option ending in a `Fits when <field> is <value>` clause.
   * `briefing` sends the run written out as a designer would want it read
   * (`briefing.ts`), with each option written as a spec. Both arms ask the same
   * questions over the same code-filtered options, so a run of each on the same
   * seeds differs in exactly one thing.
   *
   * It changes only what **Jev** is sent. The rule table reads the structured
   * facts either way, because a weight table cannot read prose and a rule arm
   * that suddenly could not see the state would stop being a control.
   */
  readonly state_format?: QuestionStyle;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  /**
   * Sees every request as it was answered: the state sent, every question
   * with its options, the distribution each came back with, and which arm
   * answered. For readouts (the debug panel, the room plan page); the
   * Director does not depend on it.
   */
  readonly observe?: (request: ObservedRequest) => void;
}

/** One request to the Director's distribution source, as it was answered. */
export interface ObservedRequest {
  readonly meta: RequestMeta;
  readonly state: Readonly<Record<string, unknown>>;
  readonly questions: Readonly<Record<string, Question>>;
  readonly dists: Readonly<Record<string, Distribution>>;
  readonly source: DecisionSource;
  /** Set when the primary source failed and the rule table answered instead. */
  readonly fallback_path?: string;
}

/**
 * Questions that can travel in any request sharing their state, and how to
 * turn the answers into a plan. `state` is what they add to the shared
 * state; `finish` samples from the distributions the request came back with.
 */
interface Asked<T> {
  readonly questions: Record<string, Question>;
  readonly state: Record<string, unknown>;
  finish(answer: Answered): T;
}

/**
 * What the briefing arm needs beyond the run context: the room round 1 built
 * and the pools the offer is choosing from. The questions themselves supply
 * the rest (`decidingPhrases`).
 */
interface BriefFor {
  readonly ctx: RunContext;
  readonly room?: BriefingRoomNow;
  readonly cards?: readonly BriefingCardPool[];
  readonly roomType?: string;
  readonly doorIn?: string;
}

/** One request's answers, as `Asked.finish` reads them. */
interface Answered {
  dists: Record<string, Distribution>;
  source: DecisionSource;
  path?: string;
}

/**
 * The portals, in two rounds: the kinds and the difficulty first, then the
 * promises on the doors that answer produced (`portalAsk`).
 */
interface PortalDraft {
  readonly kinds: readonly RewardCardKind[];
  readonly eliteKind: RewardCardKind | null;
  readonly eliteGrade: 1 | 2 | 3;
  readonly normalGrade: 1 | 2 | 3;
  readonly npc: NpcKind | null;
  /** Carried between the rounds so the whole plan draws from one stream. */
  readonly rng: Rng;
  readonly source: DecisionSource;
  readonly path?: string;
  readonly decisions: readonly Decision[];
}

interface PortalAsk {
  readonly questions: Record<string, Question>;
  readonly state: Record<string, unknown>;
  draft(answer: Answered): PortalDraft;
  follow(draft: PortalDraft): { questions: Record<string, Question>; state: Record<string, unknown> };
  finish(draft: PortalDraft, answer: Answered | null): PortalPlan;
}

/*
 * How far a decision is drawn from Jev's answer rather than taken from its
 * top. Below 1 sharpens. A decision that is about getting it right (which
 * family a stat door promises, how the fight is built) is taken close to the
 * top: at 0.8 a 65 / 20 / 10 distribution went to something other than its
 * first answer about one time in four, a dozen decisions a room, and the plan
 * page read as a reroll on every other line. Variety that has to exist is
 * code's (`LOOK_REPEAT_PENALTY`, the card novelty term), not the sampler's.
 *
 * These now hold for the rule and random arms only. A question Jev answers is
 * read by its confidence instead (`JEV_CONFIDENT`, in `decide`): a temperature
 * below one re-reads Jev's second option as weaker than Jev said it was, and
 * measured with the run principle in the school's instruction, that turned
 * Jev's own 0.46 on the last school back into a repeat 78% of the time.
 */
const TEMPERATURE = {
  next_tension: 0.4, encounter: 0.4, reward: 0.9, portal: 0.4,
} as const;

/**
 * **At or above this, Jev's own `choice` is taken; below it, its distribution
 * is drawn from as given.** TypeSafe's suggested floor for "genuinely unsure".
 */
export const JEV_CONFIDENT = 0.5;

/**
 * **Questions about how often, drawn from Jev's distribution as given.**
 *
 * `JEV_CONFIDENT` takes Jev's top option outright at confidence 0.5, which is
 * right for a question about getting one room right — which grade, which
 * lane. These are not that. Each asks what kind of room this one is, and what
 * matters is how often each kind comes up over a run: a Jev that puts 0.3 on
 * the second answer is saying it should happen about a third of the time,
 * and the threshold made that never. Measured over four full runs on the
 * live model, it cut `breathe` waves from 22% to 12%, `tank` anchors from 15%
 * to 8%, ice patches from 12% to 6%, a lone elite from 37% to 29% and
 * release rooms from 15% to 10% — every one of them the minority answer, and
 * each the kind of rate the findings kept proposing rule floors for (finding
 * 27). Drawn as given, the rate is still Jev's.
 */
const AS_GIVEN: ReadonlySet<string> = new Set([
  "next_tension", "composition", "wave_structure", "anchor", "elite_presence", "subspecies_weight",
  "symmetry", "mood_temperature", "mood_brightness", "mood_particles",
]);
const asGiven = (name: string) => AS_GIVEN.has(name) || name.startsWith("zone_");

/** TypeSafe's confidence for a Choice: 1 on a single peak, 0 on a flat spread. */
export function choiceConfidence(dist: Distribution): number {
  const values = Object.values(dist);
  if (values.length < 2) return 1;
  const peak = Math.max(...values);
  return Math.max(0, Math.min(1, (values.length * peak - 1) / (values.length - 1)));
}

/** The option with the most mass; the first of a tie, in the distribution's order. */
function topOf(dist: Distribution): string {
  let best = "", mass = -1;
  for (const [k, v] of Object.entries(dist)) if (v > mass) { best = k; mass = v; }
  return best;
}

/** Blend weight on style rather than needs, by run progress (doc 007). */
const STYLE_WEIGHT: Record<string, number> = { early: 0.35, mid: 0.25, late: 0.15, pre_boss: 0.15 };
const VARIETY_TEMPERATURE = { low: 0.4, medium: 0.7, high: 1.0 } as const;

/**
 * **How sharply a per-card fit is read**, by the Director's own `variety`
 * answer: an offer is drawn in proportion to each card's yes raised to this
 * power.
 *
 * A Noul's yes is a judgement of one card, not a share of a pool, so it is
 * far flatter than a choice distribution: drawn as given, a style's own
 * spells took about 43% of an offer against 25% of the pool, which is barely
 * a lean. Squared to raised to the fourth, the same answers gave 61% to 83%,
 * with the coldest card of the style still at 0.66 to 0.24 of a uniform share
 * (jev-findings 35). So `high` is the square and `low` the fourth power, and
 * which one applies is still Jev's.
 */
const FIT_SHARPNESS = { low: 4, medium: 3, high: 2 } as const;

/** The Noul that asks whether one card belongs on this screen. */
export function fitName(id: string): string {
  return `fit_${id}`;
}

/**
 * **How a card's fit is judged, once a request** rather than once a card.
 *
 * It was the tail of every card's instruction — about 500 characters, the
 * same in all seventy of a door request's Nouls. In the state once, on ten
 * logged spell offers, the cards' yes correlated 0.97–0.98 with the per-card
 * wording (a repeat of that wording: 0.99), "only fire spells" still took
 * fire to 55% and a named spell still led all ten offers, and the spell
 * pool's request came to 10.7k input tokens against 14.7k (jev-findings 35).
 * The criteria stay on each question: they are what a yes is weighed
 * against, and naming the player's words there is what made the words count.
 */
export const CARD_JUDGING =
  "Each fit question asks whether one card belongs on this reward screen. Judge it against the build as held " +
  "spells writes it out — every key with its level, its school, its element, what it costs and what is already " +
  "attached to it — against the player's stated style, and against the player's own words (the line \"In their " +
  "own words\"). When those words ask for a kind of card or name one, a card they ask for belongs on the screen " +
  "ahead of any card they do not; when they typed nothing, go by the build and the style. " + INTENT_CLAUSE;

function fitQuestion(
  card: { readonly id: string }, text: string, what: string, extra: string,
): NoulQuestion {
  return {
    type: "noul",
    instructions:
      `Would ${titleOfId(card.id)} be a good ${what} to show this player on this reward screen? ${text} ` +
      "Judge it as card judging in the state says." + extra,
    /*
     * **The player's words are in the criteria, not only in the judging.**
     * Worded as "it fits this build and this player now", a card the player
     * had named was judged mostly against the build: over ten logged spell
     * offers, "I only want Frozen Orb" moved Frozen Orb from 2% to 10% of the
     * sampled slots and to the top of one; "only fire spells" moved fire from
     * 11% to 18%. The choice questions had done better (44% and top of all
     * ten; 40%). Naming the words as a way to be worth a place took the same
     * requests to 36% and top of all ten, and fire to 55%, with the typed-
     * nothing requests unchanged (jev-findings 35).
     */
    criteria: {
      true: "Worth a place on the screen: what the player's own words ask for, or a fit for this build and this player now.",
      false: "Not worth a place: not what the player asked for, and wrong for this build or off where the player is going.",
    },
  };
}

function titleOfId(id: string): string {
  return id.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Each card's yes, as a distribution over the pool. */
function cardFit(ids: readonly string[], dists: Readonly<Record<string, Distribution>>): Distribution {
  const yes = ids.map((id) => Math.max(0, dists[fitName(id)]?.[NOUL_YES] ?? 0));
  const total = yes.reduce((a, b) => a + b, 0);
  return Object.fromEntries(ids.map((id, i) => [id, total > 0 ? yes[i]! / total : 1 / ids.length]));
}

/**
 * The offer's temperature, asked once and shared by every offer (doc 007).
 *
 * Asked as three bare sentences it came back `low` for every offer of two runs
 * at 0.98 confidence, which pins every offer at temperature 0.4 and makes the
 * reward pool a short list the player sees again and again. The three options
 * now name the labels that separate them.
 */
/**
 * **The Director's brief**, appended to the questions that shape an offer.
 *
 * It is the one place in the codebase where roguelike reward-design practice
 * is written down *as words Jev can match* rather than as a rule code applies.
 * Every clause is something the genre does deliberately and this game was not
 * doing:
 *
 * - *Vary the kinds.* Hades never shows the same god three chambers running;
 *   Slay the Spire's map alternates elites, shops and campfires; Isaac's room
 *   types rotate. Measured here before this existed: once the affix slots
 *   opened, the affix badge was on nearly every offer and the player stopped
 *   choosing at all.
 * - *Help an unformed build take shape first.* Slay the Spire front-loads
 *   commons and card draw; Hades' early boons are the ones that define a run
 *   and its duos only exist once two gods are held; Dead Cells opens with
 *   mutations and weapons rather than scrap.
 * - *Alternate safe and greedy.* Hades' chamber rewards, Dead Cells' cursed
 *   chests, Balatro's blind skips: the run is a rhythm of banking and betting,
 *   and two greedy offers running is a difficulty spike the player did not
 *   choose.
 * - *Reward commitment, never punish it.* Hades pays for stacking one god;
 *   Balatro pays for committing to a hand type; Slay the Spire's archetype
 *   cards get better as you take more of them. A Director that answers the
 *   build's gaps and nothing else quietly taxes the player for specialising.
 * - *Let the player finish something.* Isaac's half-collected transformations
 *   and Hades' one-boon-short duos are the genre's own complaint about
 *   themselves; an offer that completes a thing already started is worth more
 *   than a better card that starts a fourth.
 *
 * Stated as the brief, not as rules: code's job here is only to keep every
 * legal option on the list (doc 002).
 */
/**
 * The standing principles, as **instructions** — even-handed, and about the
 * craft rather than about any one option (finding 4).
 *
 * **The variety paragraph is gone.** It used to open this: the same badge
 * several rooms running stops being a choice, the state counts the run of
 * them for you, and keeping the run varied is yours. Measured with the code
 * cap off, the longest same-kind streak was 7 without those sentences and 10
 * with them (finding 5) — a classifier answers states, and a paragraph about
 * sequences turns into a paragraph about doors, which raises doors. Variety
 * is `DOOR_STREAK_CAP` and the two portal temperatures now, and it is said
 * here not at all.
 */
export const DIRECTOR_BRIEF =
  "You are the Director of a roguelike run, and these are the standing principles of the craft. Help a "
  + "build that has not taken shape yet take one, before offering anything that pays off only through a "
  + "build. Alternate the safe answer and the greedy one rather than pressing either twice. Reward "
  + "commitment rather than taxing it: a player building one thing wants more of it, and finishing "
  + "something started is worth more than starting a fourth. Leave the run somewhere to go — a build with "
  + "every slot full and nothing raised has raising left, not widening. And a run that has gone wrong can "
  + "be saved: when the last rooms went badly, answer with what would turn it round rather than with what "
  + "the plan said.";

/*
 * **The fact it is read off, named first and alone.** The instruction used to
 * name the off-style count *and* which way the keys lean, and to say what a
 * player "wants" in each case. The keys lean the stated style in nine states
 * of ten — the starter is on every staff — so the second fact answered the
 * question before the first was read, and `variety` came back `low` in 84% of
 * offers, 9 of 14 with two off-style picks running (jev-findings 28, 30). The
 * keys stay in the state; the question names the cards the player kept.
 */
const VARIETY_QUESTION = {
  instructions:
    "How widely should this offer be drawn from the fit ranking? Answer from the cards the player has " +
    "kept (off style picks): how many of the last three are off the style they stated, and how many of " +
    "the newest two.",
  options: [
    {
      id: "low",
      description: grounded(
        "A narrow draw: the top of the fit ranking takes the slots.",
        ["off_style_picks", "none"], ["damage_rate", "low"],
      ),
      spec: VARIETY_SPEC.low!,
    },
    {
      id: "medium",
      description: grounded(
        "A middling draw: near the top of the fit ranking, now and then further down.",
        ["off_style_picks", "one"], ["run_progress", "mid", "late"],
      ),
      spec: VARIETY_SPEC.medium!,
    },
    {
      id: "high",
      description: grounded(
        "A wide draw: cards ranked low appear beside the ones ranked first.",
        ["off_style_picks", "two_running"], ["keys_lean", "mixed"], ["run_progress", "early"],
      ),
      spec: VARIETY_SPEC.high!,
    },
  ],
} as const;

export function createDirector(mode: DirectorArm, deps: DirectorDeps = {}): Director {
  const style: QuestionStyle = deps.state_format ?? "labels";
  const briefed = style === "briefing" && mode === "jev";
  const rule = tableSource("rule", ruleTable);
  const random = tableSource("random", flatTable);
  const primary: DistributionSource =
    mode === "jev"
      ? jevSource(deps.evaluate ?? notConfigured, deps.now)
      : mode === "rule" ? rule : random;
  // Doc 002: every failure path routes to the rule table, never to random.
  const fallback = mode === "random" ? random : rule;
  const signal = deps.signal ?? new AbortController().signal;

  let consecutiveFailures = 0;
  /*
   * **The sparse-room cap is the rule arm's.** It was written because no arm
   * could see the run; Jev's briefing now carries every room as it was built,
   * so it holds only for the rule and random arms, whose tables cannot read
   * it. The door-kind streak cap stays on every arm. There is no school cap:
   * a door no longer promises a school (`mainTypeOf`).
   */
  const capRuns = mode !== "jev";
  /** The questions in an answer that the rule table filled because Jev declined them. */
  const declinedIn = new WeakMap<Record<string, Distribution>, ReadonlySet<string>>();
  /** Questions answered by the rule table without being asked, and why (`no_history`). */
  const unaskedIn = new WeakMap<Record<string, Distribution>, ReadonlySet<string>>();

  /**
   * **Room 5: the king's first audience** (doc 022). Everything about the room
   * is code's — its arena, its size, its look, its edges and the fight it opens
   * as — because the room is the run's shape, like the vendors' stop and the
   * throne hall, and doc 002 does not ask a question with one answer. What is
   * still asked is the reward its door promised: the offer rides in a request
   * of its own, as a vendor room's does.
   *
   * - **The arena** is `audience_arena`: open, no cover, `compact` so it fits
   *   the view at a zoom near the throne hall's (doc 022, "The view"), mirrored.
   * - **The look** is the throne hall's own light, the same framing and the
   *   same room the player will meet him in again.
   * - **The edges** are braziers and at most one floor feature (`audienceZones`).
   * - **The fight** is one round of the build band, no subspecies, no elites:
   *   these bodies are there to be crushed, and the world never calls the rest.
   * - **The tension** is recorded as `peak`, so the beat after it is the
   *   trough (doc 014) — at room 6, the ramp's steepest step.
   */
  async function planAudience(ctx: RunContext, door: DoorRef, alongside?: OfferRequest): Promise<RoomPlanResult> {
    const rng = new RngSource(ctx.seed).stream("decision", ctx.room_index, door.door_slot, 1);
    const mood = { temperature: "cold", brightness: "dim", particle_intensity: "calm" } as const;
    const generated = generateRoom(
      { space: "audience_arena", symmetry: "mirrored", size: "compact", mood }, "S", "combat", rng,
    );
    const base = toRoomPlan(generated, {
      id: `${ctx.run_id}/${ctx.room_index}/${door.door_slot}`,
      seed_key: `decision:${ctx.room_index}:${door.door_slot}`,
      reward_kind: "item",
      params_source: "rule",
    });
    const zones = audienceZones(base.zones, rng);
    const profile: EncounterProfile = {
      composition: "mixed", density: "sparse", wave_structure: "steady", anchor: "none", entry: "far_front", rounds: 1,
    };
    const band = bandForRoom({ room_type: "combat", tension: "build", pressure_cap: ctx.labels.pressure_cap });
    const assembled = band
      ? assembleEncounterDetailed(profile, base, band, rng, { source: "rule", room_index: ctx.room_index })
      : null;
    // The first wave only: the roof gives before a second would be called, and a second is never queued.
    const encounter = assembled ? { ...assembled.plan, waves: assembled.plan.waves.slice(0, 1), elite_affixes: [] } : null;
    let offer: OfferPlan | undefined;
    if (alongside) {
      const q = offerAsk(ctx, alongside);
      const meta: RequestMeta = { run_id: ctx.run_id, room_index: ctx.room_index, door_slot: door.door_slot, round: 1, purpose: "room" };
      const brief: BriefFor = { ctx, ...(alongside.cards?.length ? { cards: cardPools(alongside) } : {}) };
      const stage = q.first(await ask(q.questions, flatState(ctx, q.state), meta, brief));
      offer = Object.keys(stage.questions).length === 0
        ? stage.finish(null)
        : stage.finish(await ask(stage.questions, flatState(ctx, stage.state), { ...meta, round: 2 }, brief));
    }
    const plan: RoomPlan = {
      ...base, zones, encounter,
      source: { ...base.source, params: "rule", encounter: encounter ? "rule" : "none" },
    };
    return {
      door, plan, tension: "peak",
      source: {
        params: "rule", mood: "rule", reward_kind: "rule", zones: "rule",
        encounter: "rule", affixes: null, layout: generated.layout,
      },
      profile: { composition: profile.composition, density: profile.density, wave_structure: profile.wave_structure, anchor: profile.anchor, entry: profile.entry },
      elite_affixes: [],
      trimmed: false,
      decisions: [{
        choice: "audience_arena", probabilities: { audience_arena: 1 }, confidence: null, source: "rule",
        question: "space (the king's first audience, doc 022)",
      }],
      ...(offer ? { offer } : {}),
    };
  }

  async function ask(
    questions: Record<string, Question>,
    state: Record<string, unknown>,
    meta: RequestMeta,
    /**
     * What the briefing arm sends instead of `state`. The rule table still
     * reads `state`, so the two arms differ in what Jev sees and in nothing
     * else; the observer is shown whichever was actually sent.
     */
    brief?: BriefFor,
  ): Promise<{ dists: Record<string, Distribution>; source: DecisionSource; path?: string }> {
    if (Object.keys(questions).length === 0)
      return { dists: {}, source: primary.kind };
    const use = consecutiveFailures >= 3 && mode === "jev" ? fallback : primary;
    /*
     * **The two states are not interchangeable, and the rule table always gets
     * the labels.**
     *
     * The weight table is a function of label values; hand it a briefing and
     * every weight reads `undefined` and every distribution comes back
     * uniform. That matters on exactly the paths where it is least visible:
     * a question Jev declines, and a request that failed. A single reassigned
     * variable would have made the briefing arm's fallbacks *random* while the
     * label arm's stayed the rule table — the two arms differing in something
     * other than the thing under test, on the rooms where it is hardest to see.
     */
    const sent = briefed && brief && use.kind === "jev"
      ? {
        briefing: briefingFrom(brief.ctx, { ...brief, deciding: decidingPhrases(Object.keys(questions)) }),
        // Per-card questions carry the Director's brief and how a card is judged once, beside the run.
        ...Object.fromEntries(["director_brief", "card_judging"].flatMap((k) =>
          typeof state[k] === "string" ? [[k, state[k]]] : [])),
      }
      : state;
    const seen = (
      dists: Record<string, Distribution>, source: DecisionSource, path?: string,
      shown: Record<string, unknown> = source === "jev" ? sent : state,
    ) => {
      try {
        // The readout shows what was actually sent: to Jev when Jev was asked, even if it failed.
        deps.observe?.({
          meta, state: shown, questions, dists, source,
          ...(path ? { fallback_path: path } : {}),
        });
      } catch { /* a readout never breaks a plan */ }
    };
    try {
      const r = await use.distributions(questions, sent, meta, signal);
      if (use.kind === "jev") consecutiveFailures = 0;
      const dists = { ...r.dists };
      if (r.declined?.length) {
        // A declined question goes to the rule table alone, with the labels it
        // reads; the request's other answers stand (doc 002).
        const only = Object.fromEntries(r.declined.map((n) => [n, questions[n]!]));
        const filled = await fallback.distributions(only, state, meta, signal);
        Object.assign(dists, filled.dists);
        declinedIn.set(dists, new Set(r.declined));
      }
      seen({ ...dists }, r.source, r.declined?.length ? `declined: ${r.declined.join(", ")}` : undefined);
      return { dists, source: r.source };
    } catch (e) {
      consecutiveFailures++;
      const path = e instanceof EvaluatorError ? e.path : "invalid";
      const r = await fallback.distributions(questions, state, meta, signal);
      // A failed request was still sent to Jev: the readout shows what Jev was sent, not the labels the table read after.
      seen({ ...r.dists }, fallback.kind, path, use.kind === "jev" ? sent : state);
      return { dists: { ...r.dists }, source: fallback.kind, path };
    }
  }

  function decide(
    name: string,
    dists: Record<string, Distribution>,
    source: DecisionSource,
    rng: Rng,
    temperature: number,
    path?: string,
    /**
     * A distribution to draw from **in place of** the one in `dists` — a
     * code term applied to Jev's own answer, such as the penalty on the
     * previous room's look or anchor (`LOOK_REPEAT_PENALTY`).
     *
     * It is a parameter rather than a modified copy of `dists` because
     * `declinedIn` is keyed on the object: hand `decide` a fresh object and a
     * question the rule table filled loses the mark saying so, and the plan
     * page credits Jev with an answer Jev declined to give.
     */
    override?: Distribution,
  ): Decision {
    const dist = override ?? dists[name];
    if (!dist) throw new Error(`no distribution for "${name}"`);
    if (declinedIn.get(dists)?.has(name)) { source = fallback.kind; path = "declined"; }
    else if (unaskedIn.get(dists)?.has(name)) { source = fallback.kind; path = "no_history"; }
    if (source === "jev") {
      /*
       * **Jev's answer, read the way TypeSafe documents it**: its `choice`
       * when it is confident, and when it is not — when it says two or more
       * answers are each defensible — its distribution as given, with no
       * temperature re-reading the second option's share. The confidence is
       * TypeSafe's own statistic, taken over the distribution actually drawn
       * from (after code filtered the options and any repeat penalty).
       */
      const confidence = choiceConfidence(dist);
      const choice = confidence >= JEV_CONFIDENT && !asGiven(name) ? topOf(dist) : sampleOne(dist, rng);
      return {
        choice, probabilities: dist, confidence, source, question: name,
        ...(path ? { fallback_path: path as Decision["fallback_path"] } : {}),
      };
    }
    const tuned = withTemperature(dist, temperature);
    const choice = sampleOne(tuned, rng);
    return {
      choice, probabilities: tuned, confidence: null, source, question: name,
      ...(path ? { fallback_path: path as Decision["fallback_path"] } : {}),
    };
  }

  /**
   * `decide`, with the **last room's answer weighed down** before the draw.
   *
   * The one place code touches a look answer, and the smallest thing that
   * does the job: the option the previous room already used keeps
   * `LOOK_REPEAT_PENALTY` of its mass and the rest is renormalised over what
   * is left. The decision that is recorded is the perturbed one, so the plan
   * page shows the distribution the room was actually drawn from rather than
   * a distribution and then a different answer.
   *
   * A question with one option left, and a first room with nothing before it,
   * come through untouched.
   */
  function pickAvoiding(
    name: string, temperature: number, last: string | undefined,
    answer: Answered, rng: Rng, into: Decision[],
  ): string {
    const dist = answer.dists[name];
    if (!dist) throw new Error(`no distribution for "${name}"`);
    const penalised = !last || last === "none" || Object.keys(dist).length <= 1
      ? dist
      : reweight(dist, (id) => (id === last ? LOOK_REPEAT_PENALTY : 1));
    const d = decide(name, answer.dists, answer.source, rng, temperature, answer.path, penalised);
    into.push(d);
    return d.choice;
  }

  /**
   * Doc 003's per-portal questions, and how their answers become portals.
   *
   * Split from the request so the questions can ride in another request that
   * shares their state (`planRoom`'s round 1); `planPortals` asks them alone.
   *
   * **In two stages.** Which kinds the portals offer is asked first; *what a
   * spell door promises* and *what a stat door promises* are asked after, and
   * only for the doors the first answer actually produced. They were asked
   * every room, unconditionally, alongside the kinds — so two questions in
   * three were answered for doors that did not exist, and the state they read
   * was the state of a room whose portals had not been decided yet. Where
   * there is a second round to ride in (a room's), the follow-up costs no
   * request; a vendor's room, which has no round 2, pays for one.
   */
  function portalAsk(ctx: RunContext, choices: PortalChoices): PortalAsk {
    const labels = labelSet(ctx.labels as unknown as Record<string, unknown>);
    const opt = (id: string, description: string) => ({ id, description });
    /*
     * **One question, single options, ranked** (doc 003).
     *
     * It used to be `portal_kinds`, over every legal *combination* of kinds:
     * "stat + spell + affix" against "spell + affix + gold" and so on. With
     * three doors drawn from four kinds every bundle shares two thirds of its
     * content with every other, so the options were near-identical sentences
     * and the answer went to whichever happened to carry one more matching
     * clause. It also threw the ranking away: a set says nothing about which
     * door the player needs *most*, which is the only thing the offer wants.
     *
     * Now it asks for the need, over single kinds, and code assigns the doors
     * from the answer: the top `count` distinct options, sampled without
     * replacement at `PORTAL_NEED_TEMPERATURE`. The rooms with no fight in
     * them are options of the same question, so a vendor wins a door only by
     * outranking a reward rather than through a second question of its own.
     */
    /*
     * **A badge shown four offers running leaves the list** (`DOOR_STREAK_CAP`).
     *
     * This is the one bound here that the Director is given every chance to
     * make unnecessary and does not. Measured on live Jev over eight seeds and
     * 120 offers with the cap off — a neutral briefing, no streak counts, no
     * variety paragraph in the brief, nothing on the options about a repeated
     * badge — the longest same-kind streak was **10 offers running** for
     * affix, 7 for spell and 6 for stat. Jev is a classifier: each offer is a
     * fresh state, and it cannot see that it has answered the same way nine
     * times (finding 5). The earlier readings of 7 and 10 were taken with
     * those sentences in the state, which made it worse; with them gone it is
     * no better.
     *
     * So the fourth offer is where code stops offering the kind, for **every**
     * kind that has been on all four — two often streak together. It keeps the
     * other kinds and every vendor on the list, so it narrows nothing the
     * player could have wanted.
     */
    /*
     * Two of the four are often spent at once. Withhold only as many as leave
     * enough reward kinds to fill the already-drawn portal count; a vendor is
     * optional and cannot make up a missing door. When three have tripped the
     * cap together, the longest runs go first and the others continue.
     */
    const withheld = new Set<string>();
    for (const kind of doorStreaksSpent(ctx.history.doors_offered)) {
      if (choices.kinds.length - withheld.size <= Math.max(2, choices.count)) break;
      withheld.add(kind);
    }
    choices = { ...choices, kinds: choices.kinds.filter((k) => !withheld.has(k)) };
    const needOptions = [
      ...choices.kinds.map((k) => ({ ...opt(k, KIND_CLAUSE[k] ?? k), ...(KIND_SPEC[k] ? { spec: KIND_SPEC[k]! } : {}) })),
      ...choices.npcKinds.map((k) => ({ ...opt(k, NPC_CLAUSE[k]!), ...(NPC_SPEC[k] ? { spec: NPC_SPEC[k]! } : {}) })),
    ];
    const questions: Record<string, Question> = {
      portal_need: choiceQuestion({
        labels, style,
        instructions:
          DIRECTOR_BRIEF + " " +
          "Which reward does this player need most right now? One option per portal badge; the highest " +
          "answers become the portals out of this room, in that order. Start from build shape and from what " +
          "the keys are actually holding — held spells names every spell with its level, its element, what " +
          "it costs and what is already attached to it, and spell levels, affix slots open and casts per " +
          "bar say what is left to do to it. A staff whose slots are full has nothing an affix can go on; " +
          "a staff whose levels have never moved is a staff a spell door raises. Then weigh what the last " +
          "rooms measured: how many bodies each shot hit, how often the bar refused a cast, how much of the " +
          "fight it spent under the cheapest key, how fast the casts and the damage came, and what took the " +
          "most health. " +
          /*
           * **The player's own words are one of the needs.** The briefing has
           * always carried them, but this question never said to read them,
           * and the one sentence it had about them (`INTENT_CLAUSE`) only
           * fenced them in — so a player who typed "faster attacks" met a
           * question that ranked from the staff and the last rooms and set
           * their sentence aside. The kind whose cards do what they asked
           * for is named here as a need among the others, not above them.
           */
          "If the player typed what they want, read it as a need beside those: the door whose cards "
          + "give them what they asked for — whatever language they wrote it in — is one they need. "
          + INTENT_CLAUSE,
        options: needOptions,
      }),
    };
    if (choices.elite) {
      /*
       * **Press the player who is doing well.** Measured on the live model,
       * the first wording of this question answered `none` for eighteen of
       * twenty rooms while the state said health full, clears fast and no
       * recent damage — a question that reads the state and then ignores it.
       * Both options said "fits" over a disjunction of four label
       * combinations, which is two conditions to carry through one match, so
       * neither matched and the safe-sounding option won. One crisp condition
       * per option, and the design intent stated in the instructions.
       */
      questions.elite_portal = choiceQuestion({
        labels, style,
        instructions:
          "Choose whether one of these portals leads to an elite fight, harder and graded up. A player who " +
          "is doing well should be pressed; a player who is behind should be let off. Answer from health, " +
          "recent damage and clear speed.",
        options: [
          { ...opt("none", grounded(
            "Every portal is a normal fight: the run keeps its current pitch.",
            ["clear_speed", "slow"], ["health", "low", "critical"], ["recent_damage", "heavy"],
            ["last_room_kind", "elite"], ["since_release", "long"], ["damage_rate", "low"],
          )), spec: ELITE_PORTAL_SPEC.none! },
          { ...opt("elite", grounded(
            "One portal is an elite fight: harder, for a reward graded up.",
            ["clear_speed", "fast", "normal"], ["health", "ok", "full"], ["recent_damage", "none", "some"],
            ["last_room_kind", "rest"], ["damage_rate", "high"],
          )), spec: ELITE_PORTAL_SPEC.elite! },
        ],
      });
      /*
       * The grades were asked as the option ids "1", "2" and "3" with the
       * whole condition in prose. Confidence came back at about 0.26 with a
       * fifth of the mass on the escape option, and the answer never moved.
       * The ids are now words, and each says its one condition.
       */
      /*
       * **A catch-up, not the grade.** A door's strength is set by how far the
       * run has come (`baseStrength`): later rooms deal better spells, bigger
       * stats and the strongest affixes. What is asked is only whether a run
       * that is behind gets one more on top, so the question is not asked
       * where there is no more to give.
       */
      if ((choices.strength?.elite ?? 2) < 3)
        questions.elite_grade = choiceQuestion({
          labels, style,
          instructions:
            "The elite portal's reward already comes one strength above this point of the run. Choose whether " +
            "it goes one strength further, as a catch-up for a run that is behind; answer from health, recent " +
            "damage and clear speed.",
          options: [
            { ...opt("raised", grounded(
              "The elite door's own strength for this point of the run.",
              ["clear_speed", "fast", "normal"], ["health", "ok", "full"], ["recent_damage", "none", "some"],
            )), spec: ELITE_GRADE_SPEC.raised! },
            { ...opt("best", grounded(
              "One strength further, as far as strength goes.",
              ["clear_speed", "slow"], ["health", "low", "critical"], ["recent_damage", "heavy"],
            )), spec: ELITE_GRADE_SPEC.best! },
          ],
        });
    }
    if (choices.lateGrade)
      questions.normal_grade = choiceQuestion({
        labels, style,
        instructions:
          "The normal portals' rewards come at the strength this point of the run deals; later rooms deal " +
          "stronger ones on their own. Choose whether they go one strength further, as a catch-up for a run " +
          "that is behind; answer from health, recent damage and clear speed.",
        options: [
          { ...opt("ordinary", grounded(
            "The run's own strength for this point.",
            ["clear_speed", "fast", "normal"], ["health", "ok", "full"], ["recent_damage", "none", "some"],
          )), spec: NORMAL_GRADE_SPEC.ordinary! },
          { ...opt("raised", grounded(
            "One strength past the run's own, for a run that is behind.",
            ["clear_speed", "slow"], ["health", "low", "critical"], ["recent_damage", "heavy"],
          )), spec: NORMAL_GRADE_SPEC.raised! },
        ],
      });
    return {
      questions,
      state: {
        portal_count: COUNT_WORD[choices.count] ?? "three",
        held_schools: heldSchools(ctx),
      },
      draft({ dists, source, path }) {
        const rng = new RngSource(ctx.seed).stream("portals", ctx.room_index);
        const decisions: Decision[] = [];
        const take = (name: string, temp = TEMPERATURE.portal) => {
          const d = decide(name, dists, source, rng, temp, path);
          decisions.push(d);
          return d.choice;
        };
        /*
         * **The ranking, and the constraints applied to it.** Code filtered
         * what could be asked before asking; what is left is the order, and a
         * conflict falls through to the next-ranked option rather than being
         * re-asked.
         */
        /*
         * The escape option leaves the ranking. "None of these fits" is an
         * answer to a question that picks one thing; a ranking has nowhere to
         * put it, and left in it would have become a door with `fallback`
         * written on the badge.
         */
        const asked = restrictTo(dists.portal_need!, [...choices.kinds, ...choices.npcKinds]);
        // A run gets at most one optional vendor room. Jev tended to spend it
        // on the smith, while the merchant lets the player choose among three
        // kinds and refresh the shelf. Keep the model's ranking, but make the
        // more flexible vendor win close calls when both are legal.
        const leaned = source === "jev" && choices.npcKinds.includes("merchant") && choices.npcKinds.includes("smith")
          ? reweight(asked, (id) => id === "merchant" ? 1.5 : id === "smith" ? 0.4 : 1)
          : asked;
        // A room with no fight that the Director barely weighed leaves the
        // ranking, so the spread tail cannot hand it a door (`NPC_MIN_NEED`).
        const rankedNeed = restrictTo(leaned, Object.keys(leaned).filter((k) =>
          !(k in NPC_MIN_NEED) || leaned[k]! >= NPC_MIN_NEED[k as NpcKind]));
        const need = withTemperature(rankedNeed, PORTAL_NEED_TEMPERATURE);
        /*
         * **The first door sharp, the rest spread** (`PORTAL_TAIL_TEMPERATURE`).
         * One temperature cannot do both: sharp enough that the top need wins
         * the first door is sharp enough that the second and third are fixed
         * too, and with three doors from four kinds that is the same three
         * badges every room. The top answer is drawn from the sharpened
         * distribution; the rest of the ranking from the spread one.
         */
        const first = sampleOne(need, rng);
        const rest = sampleWithoutReplacement(
          withTemperature(rankedNeed, PORTAL_TAIL_TEMPERATURE), Object.keys(rankedNeed).length, rng,
        );
        const ranked = [first, ...rest.filter((k) => k !== first)];
        const npcSet = new Set<string>(choices.npcKinds);
        const kinds: RewardCardKind[] = [];
        let npc: NpcKind | null = null;
        /*
         * The doors are the **top `count` entries of the ranking**, so a room
         * with no fight in it takes a door only by outranking a reward the
         * player could have had instead. Taking one the moment it appeared
         * anywhere in the ranking put the merchant on 99% of offers: with
         * seven options and three doors, something is always a vendor
         * somewhere down the list.
         */
        let slots = 0;
        for (const pick of ranked) {
          if (slots >= choices.count) break;
          if (npcSet.has(pick)) {
            // At most one, and never the only way on: a refused option falls
            // through to the next-ranked one rather than costing a door.
            if (npc || choices.count < 2) continue;
            npc = pick as NpcKind;
            slots++;
            continue;
          }
          if (kinds.includes(pick as RewardCardKind)) continue;
          kinds.push(pick as RewardCardKind);
          slots++;
        }
        /*
         * `assemblePortals` builds one door per kind and then lets the vendor
         * replace the **last** of them, so the kind list is always `count`
         * long; the vendor eats the lowest-ranked reward. Anything still short
         * — every remaining option refused by a constraint — is filled from
         * what is legal, in the order it is legal.
         */
        for (const k of staleFirst(choices.kinds, ctx.history.doors_offered) as RewardCardKind[])
          if (kinds.length < choices.count && !kinds.includes(k)) kinds.push(k);
        /*
         * **The gold floor** (`GOLD_FLOOR_ROOMS`).
         *
         * Gold is the one kind the Director never ranks first — zero times in
         * about a hundred rooms, five runs running, with the purse and the
         * merchant's prices spelled out in the state — so its share of the
         * doors comes only from the tail of the ranking, and a run can go ten
         * rooms without the badge. That is a rate, which is a sequence
         * property, which is code's (findings 5 and 6).
         *
         * It takes the **last** door, the lowest-ranked one, so the reward
         * the Director actually asked for is untouched; and only where there
         * is more than one door, or the floor would be overriding the top
         * need rather than standing beside it.
         */
        if (choices.count >= 2 && choices.kinds.includes("gold")
          && !kinds.includes("gold") && goldOverdue(ctx.history.doors_offered)) {
          if (kinds.length >= choices.count) kinds[kinds.length - 1] = "gold";
          else kinds.push("gold");
        }
        decisions.push({
          choice: [...kinds, ...(npc ? [npc] : [])].join(" > "),
          probabilities: need, confidence: null, source, question: "portal_need",
          ...(path ? { fallback_path: path as Decision["fallback_path"] } : {}),
        });

        let eliteKind: RewardCardKind | null = null;
        // The run's own strength for this point (`baseStrength`); the answers are a catch-up on top.
        const strength = choices.strength ?? { normal: 1, elite: 2 };
        let eliteGrade: 1 | 2 | 3 = strength.elite;
        if (choices.elite && take("elite_portal") === "elite") {
          /*
           * **Which door is the hard one comes out of the same ranking.** It
           * was a question of its own over all four kinds, restricted
           * afterwards to the ones on offer — a second combination question
           * answering something the need already says. Doc 003 puts the elite
           * behind what the player most lacks, so it is the need distribution
           * over the doors that exist, drawn at the same temperature.
           */
          const d = restrictTo(need, kinds);
          const pick = sampleOne(d, rng);
          decisions.push({
            choice: pick, probabilities: d, confidence: null, source,
            question: "elite_kind (from the need ranking)",
          });
          eliteKind = pick as RewardCardKind;
          if (strength.elite < 3 && take("elite_grade") === "best") eliteGrade = (strength.elite + 1) as 2 | 3;
        }
        const normalGrade = (choices.lateGrade && strength.normal < 3 && take("normal_grade") === "raised"
          ? strength.normal + 1 : strength.normal) as 1 | 2 | 3;
        return { kinds, eliteKind, eliteGrade, normalGrade, npc, rng, source, path, decisions };
      },
      /*
       * **Nothing is asked after the kinds.** A spell door named a school and a
       * stat door a family, each asked in a round of its own and then forced
       * onto the cards; the badge now names what the door's cards are
       * (`mainTypeOf`), decided with the doors, so there is no promise left
       * to ask for.
       */
      follow() {
        return { questions: {}, state: {} };
      },
      finish(draft) {
        const doors = assemblePortals({
          kinds: draft.kinds, eliteKind: draft.eliteKind, eliteGrade: draft.eliteGrade,
          normalGrade: draft.normalGrade, npc: draft.npc,
        });
        return { room_index: ctx.room_index, doors, source: draft.source, decisions: [...draft.decisions] };
      },
    };
  }

  /**
   * Doc 007's offer questions for one pool, and how their answers become
   * cards. A pool too small to choose from is answered without asking
   * (`done`). Split from the request as `portalAsk` is. `prefix` scopes the
   * question names and state keys when several pools share one request.
   */
  function cardAsk(ctx: RunContext, req: CardRequest, prefix = ""): Asked<CardPlan> | { readonly done: CardPlan } {
    const { pool } = req;
    const room = new RngSource(ctx.seed);
    const rng = room.stream("reward", ctx.room_index, req.salt ?? null);
    const wildRng = room.stream("wildcard", ctx.room_index, req.salt ?? null);
    const forced = pool.forced.slice(0, req.count);
    const want = req.count - forced.length;
    const empty = {
      room_index: ctx.room_index, blended: {}, variety: "medium" as const, source: "rule" as const,
      decisions: [], affix_intent: null,
    };
    if (want <= 0 || pool.candidates.length === 0)
      return { done: { ...empty, ids: forced, origins: forced.map(() => "forced" as const) } };
    if (pool.candidates.length <= want) {
      const ids = [...forced, ...pool.candidates.map((c) => c.id)];
      return { done: { ...empty, ids, origins: ids.map((id) => (forced.includes(id) ? "forced" : "sampled") as CardOrigin) } };
    }

    const labels = labelSet(ctx.labels as unknown as Record<string, unknown>);
    // Whether "answers nothing in particular" says anything about this pool.
    const discriminating = cardNegativesDiscriminate(pool.candidates);
    /*
     * **One voice a card.** A candidate's own sentence is what it does; the
     * briefing's build section describes what is *held*, and the card facts
     * ride in the briefing as flags rather than as a second description. So a
     * spell that is both held and on offer is written out once, here.
     */
    /*
     * **A copy says where it goes.** A copy of a held spell carries the same
     * description as the spell does, so on an early screen the card that
     * raises key 1 and the cards that would fill keys 2 and 3 read as the same
     * kind of card, and the copy's only mark was one more flag ("a copy of
     * something on the staff"): Jev put it first at about 0.75 on every early
     * spell screen, and a run held one key into room 4 (jev-findings 29). The
     * sentence added here is the fact of what taking it does to the keys —
     * which key it raises, and that it fills none — not a reason against it.
     */
    const described = (c: (typeof pool.candidates)[number]): string => {
      if (pool.kind !== "spell" || !c.facts.includes("upgrade")) return c.description;
      const at = ctx.slots.findIndex((sl) => sl?.base === c.id);
      if (at < 0) return c.description;
      const empty = ctx.slots.flatMap((sl, i) => (sl === null ? [i + 1] : []));
      return `${c.description} This card is a copy of the spell on key ${at + 1}: taken, it raises that key's `
        + `level and fills no key${empty.length ? `, so ${keyList(empty)} ${empty.length === 1 ? "stays" : "stay"} empty` : ""}.`;
    };
    const shared = {
      /*
       * A candidate's own sentence is what it is; what it is *not* for comes
       * off its own row in the content tables (`cardNotFor`) — a spell's
       * shape, spread, range, element and cost, an affix's lane, a stat's
       * family. Every card carries one, because an option with nothing it is
       * wrong for is the one every state falls into (finding 2), and the
       * offer is the longest option list the Director sends.
       */
      options: pool.candidates.map((c) => ({
        id: c.id, description: described(c),
        spec: { what: described(c), ...maybeNotFor(cardNotFor(c.id, c.facts, discriminating)) },
      })),
      labels, style,
    };
    const what = pool.kind === "spell" ? "spell" : pool.kind === "stat" ? "stat upgrade" : "affix";
    const namedSpellFit = pool.kind === "affix" && pool.candidates.some((c) => c.compatibleHeldSpellIds)
      ? " The state lists the offered affixes each held spell can take. If the player's words name a spell, "
        + "count an affix as answering that wish only when it is in that spell's list."
      : "";
    const offStyle = pool.candidates.filter((c) => !c.facts.includes("style"));
    /*
     * **Jev judges each card on its own** (jev-findings 35). The three choice
     * questions below ask which card is *the* answer, and a distribution over
     * "which one is best" puts next to nothing on the second-best card of a
     * style however well it fits — measured, a third of the spell pool drew
     * under a quarter of a uniform offer's share, and half of each style's own
     * spells were never on a screen in two runs of it. A Noul per card asks
     * whether that card belongs here, and one card's yes costs no other card
     * anything. The rule arm keeps the choice questions: it is the control.
     */
    const perCard = mode === "jev";
    const fits: Record<string, NoulQuestion> = perCard
      ? Object.fromEntries(pool.candidates.map((c) => {
        const notFor = cardNotFor(c.id, c.facts, discriminating);
        return [fitName(c.id), fitQuestion(c, `${described(c)}${notFor ? ` Not for: ${notFor}` : ""}`, what, namedSpellFit)];
      }))
      : {};
    const named: Record<string, Question> = perCard ? {
      ...fits,
      variety: choiceQuestion({ ...VARIETY_QUESTION, labels, style }),
    } : {
      /*
       * **This is the Director's main job.** Every other question shapes a
       * room; this one reads twenty-five spell descriptions, twenty-odd affix
       * descriptions or twelve stat descriptions against a build written out
       * key by key and against a sentence the player typed themselves, and
       * says which of them belongs in front of this person. It is the one
       * decision that is genuinely semantic — no weight table can read "Shock
       * Arc, level 5, storm school, no element, dear to cast, carries rime,
       * harvest, blight, no affix slot left" and conclude that a fourth affix
       * is worth nothing here — so it gets the whole brief and the whole build.
       */
      overall: choiceQuestion({
        ...shared,
        instructions:
          DIRECTOR_BRIEF + " " +
          `Which ${what} most deserves to appear in this offer? Read each candidate's own description ` +
          "against the build as held spells writes it out — every key with its level, its school, its " +
          "element, what it costs and what is already attached to it — and against the player's own words " +
          "in intent free text, which is the one input they wrote themselves. Every card on the list can go " +
          "on the staff as it stands: a new spell fills the first empty key, a copy of a held spell raises " +
          "that key's level and fills no key, and an affix goes on a key that does not carry it yet. " +
          INTENT_CLAUSE + namedSpellFit,
      }),
      for_style: choiceQuestion({
        ...shared, short: true,
        instructions:
          `Which ${what} best matches the player's style, ignoring build needs? The style is three things: ` +
          "what they stated (intent preset), what they typed in their own words (intent free text), and " +
          "what the keys actually lean (keys lean, dominant tags and the elements in held spells). When " +
          "off style picks is two running, the keys are the intent, not the preset. A player who has " +
          "committed to one direction should be offered more of it, not taxed for specialising." + namedSpellFit,
      }),
      for_needs: choiceQuestion({
        ...shared, short: true,
        instructions:
          `Which ${what} best addresses what the build lacks right now, ignoring style? Read it off the ` +
          "build itself — held spells, spell levels, affix slots open, casts per bar and mana stats taken " +
          "— and off what the last rooms measured: hits per shot, mana refused, mana short time, cast " +
          "rate, damage rate and what hurt the player most." + namedSpellFit,
      }),
      variety: choiceQuestion({ ...VARIETY_QUESTION, labels, style }),
    };
    /*
     * Doc 007's affix intent, asked only where it can matter: an affix offer.
     * It rides in the same request as the cards it steers, so it costs no
     * request of its own, and it is scoped by the same prefix as the rest when
     * a vendor's shelves share one.
     */
    if (pool.kind === "affix")
      named.affix_intent = choiceQuestion({
        labels, style, instructions: AFFIX_INTENT_INSTRUCTIONS, options: affixIntentOptions(),
      });
    if (req.temptation && offStyle.length >= 2)
      named.temptation = choiceQuestion({
        options: offStyle.map((c) => ({
          id: c.id, description: c.description,
          spec: { what: c.description, ...maybeNotFor(cardNotFor(c.id, c.facts, discriminating)) },
        })),
        labels, short: true, style,
        /*
         * "Which would most tempt this player to deviate from their plan" is
         * two hops — model the player, then model the deviation — and it came
         * back at about 0.11 confidence, which is a uniform draw with extra
         * steps. It is now the one-hop question code actually needs.
         */
        instructions:
          `None of these ${what}s belongs to the player's stated style. Which of them is the strongest ` +
          "card on its own terms, judged only by what it does?",
      });

    const questions = Object.fromEntries(Object.entries(named).map(([k, q]) => [`${prefix}${k}`, q]));
    const facts = Object.fromEntries(pool.candidates.map((c) => [c.id, c.facts.join(" ") || "plain"]));
    const compatibility = pool.kind === "affix" && pool.candidates.some((c) => c.compatibleHeldSpellIds)
      ? Object.fromEntries(ctx.slots.flatMap((slot) => slot ? [[slot.base, pool.candidates
        .filter((c) => c.compatibleHeldSpellIds?.includes(slot.base)).map((c) => c.id).join(" ")]] : []))
      : null;
    return {
      questions,
      state: {
        // The brief once for every card, rather than once in each card's question.
        ...(perCard ? { director_brief: DIRECTOR_BRIEF, card_judging: CARD_JUDGING } : {}),
        [`${prefix}reward_kind`]: pool.kind, [`${prefix}card_facts`]: facts,
        ...(compatibility ? { [`${prefix}affixes_by_spell`]: compatibility } : {}),
      },
      finish(answer) {
        const { source, path } = answer;
        const dists = Object.fromEntries(Object.entries(answer.dists).flatMap(([k, d]) =>
          k.startsWith(prefix) ? [[k.slice(prefix.length), d]] : []));
        const declined = declinedIn.get(answer.dists);
        if (declined) declinedIn.set(dists, new Set([...declined].flatMap((k) =>
          k.startsWith(prefix) ? [k.slice(prefix.length)] : [])));
        const decisions: Decision[] = [];
        const varietyD = decide("variety", dists, source, rng, 1, path);
        decisions.push(varietyD);
        const variety = varietyD.choice as keyof typeof VARIETY_TEMPERATURE;
        const w = STYLE_WEIGHT[ctx.labels.run_progress] ?? 0.25;
        let blended = perCard
          ? cardFit(pool.candidates.map((c) => c.id), dists)
          : blend(dists.overall!, dists.for_style!, dists.for_needs!, w);

        /*
         * The affix intent tilts the offer the blend already produced, rather
         * than filtering it: doc 007 keeps every legal card in the pool and
         * lets a fact move its weight, and a lane is a fact about the build's
         * direction. Code applies it on both arms, so the arms still differ in
         * exactly one thing — which lane was chosen.
         */
        let affixIntent: AffixIntent | null = null;
        if (dists.affix_intent) {
          const d = decide("affix_intent", dists, source, rng, TEMPERATURE.reward, path);
          decisions.push(d);
          affixIntent = d.choice as AffixIntent;
          const lane = AFFIX_LANES[affixIntent];
          if (lane) blended = reweight(blended, (id) => (lane.affixes.includes(id) ? AFFIX_INTENT_WEIGHT : 1));
        }
        /*
         * **A card the run has already shown keeps less of its mass**
         * (`CARD_REPEAT_PENALTY`). Applied after the temperature, so the two
         * do not fight over the same knob: the variety answer decides how
         * sharply the *fit* is read, and this decides how much a repeat costs.
         */
        const shown = cardsShown(ctx.history.journal);
        const tuned = reweight(
          withTemperature(blended, perCard ? 1 / FIT_SHARPNESS[variety] : VARIETY_TEMPERATURE[variety]),
          (id) => Math.max(CARD_REPEAT_FLOOR, CARD_REPEAT_PENALTY ** (shown.get(id) ?? 0)),
        );

        // Doc 007: two sampled and one wildcard for a three-card offer; a
        // one-card shelf is sampled outright.
        const sampledN = req.count >= 3 ? Math.max(0, want - 1) : want;
        const sampled = sampleWithoutReplacement(tuned, Math.min(sampledN, pool.candidates.length), rng);
        const ids = [...forced, ...sampled];
        const origins: CardOrigin[] = [...forced.map(() => "forced" as const), ...sampled.map(() => "sampled" as const)];
        if (ids.length < req.count) {
          const rest = pool.candidates.filter((c) => !ids.includes(c.id));
          const needs = rest.filter((c) => c.facts.includes("need"));
          let extra: string | null = null;
          let origin: CardOrigin = "wildcard";
          if (req.pity && needs.length > 0) {
            // The highest-blended card of a need; code picks, as doc 007 has it.
            extra = needs.reduce((a, b) => ((blended[b.id] ?? 0) > (blended[a.id] ?? 0) ? b : a)).id;
            origin = "pity";
          } else if (req.temptation) {
            const off = rest.filter((c) => !c.facts.includes("style"));
            if (off.length >= 2 && dists.temptation) {
              const d = restrictTo(dists.temptation, off.map((c) => c.id));
              extra = sampleOne(d, rng);
              decisions.push({ choice: extra, probabilities: d, confidence: null, source, question: "temptation" });
            } else extra = off[0]?.id ?? null;
            if (extra) origin = "temptation";
          }
          if (!extra) extra = sampleUniform(pool.candidates.map((c) => c.id), ids, wildRng);
          if (extra) { ids.push(extra); origins.push(origin); }
        }
        /*
         * **The door's promise is one card, not the offer.** A school or a
         * family on the portal guarantees a card of it; the rest of the offer
         * is drawn from the whole pool, as any other. When nothing promised
         * was drawn, the first sampled card gives way to the promised card the
         * blend likes best. Locking the offer to the school — two to four
         * spells — made a third of a run's offers exact repeats.
         */
        const promised = pool.candidates.filter((c) => c.facts.includes("promised")).map((c) => c.id);
        if (promised.length > 0 && !ids.some((id) => promised.includes(id))) {
          const at = origins.findIndex((o) => o === "sampled");
          const pick = promised.reduce((a, b) => ((blended[b] ?? 0) > (blended[a] ?? 0) ? b : a));
          if (at >= 0) { ids[at] = pick; origins[at] = "promised"; }
        }
        /*
         * **One of each, where the pool says the two are not comparable**
         * (`CardPool.guarantee`). A spell offer to a full staff holds both
         * upgrades of held spells and new spells to replace one with; an
         * offer that came out all one sort asks the player a question they
         * did not have. Code fills the *last* slot the Director drew, with
         * the missing group's highest-blended card — so the Director keeps
         * its top pick and its lean, and only loses the tail.
         */
        /*
         * **One card the run has not shown yet**, where the pool has one.
         *
         * The penalty above spreads the offer; it cannot promise anything,
         * and an offer of three cards the player has already turned down
         * twice is exactly the complaint. So the *last* slot the Director
         * drew — the lowest-ranked of them, and the wildcard's own slot where
         * there is one — gives way to the highest-blended card the run has
         * never put on a screen. The top pick is never touched: this is the
         * tail, as the `guarantee` below is.
         */
        if (ids.length >= 2 && ids.every((id) => shown.has(id))) {
          const fresh = pool.candidates.filter((c) => !shown.has(c.id) && !ids.includes(c.id));
          if (fresh.length > 0) {
            const pick = fresh.reduce((a, b) => ((blended[b.id] ?? 0) > (blended[a.id] ?? 0) ? b : a));
            ids[ids.length - 1] = pick.id;
            origins[origins.length - 1] = "wildcard";
          }
        }
        for (const group of pool.guarantee ?? []) {
          if (ids.length < 2 || group.some((id) => ids.includes(id))) continue;
          const available = group.filter((id) => !ids.includes(id));
          if (available.length === 0) continue;
          const pick = available.reduce((a, b) => ((blended[b] ?? 0) > (blended[a] ?? 0) ? b : a));
          ids[ids.length - 1] = pick;
          origins[origins.length - 1] = "guaranteed";
        }
        return {
          room_index: ctx.room_index, ids, origins, blended, variety, source, decisions,
          affix_intent: affixIntent,
        };
      },
    };
  }

  /**
   * Portals and card offers as one set of questions; see `OfferRequest`.
   *
   * The cards finish in the first round. The portals do not: their promises
   * are asked in a second round, over the doors the first round produced
   * (`portalAsk`), so `first` hands back a half-finished plan and `rest` says
   * what is still to ask.
   */
  interface OfferAsked {
    readonly questions: Record<string, Question>;
    readonly state: Record<string, unknown>;
    first(answer: Answered): OfferStage;
  }
  interface OfferStage {
    readonly cards: readonly CardPlan[];
    /** Empty when there is nothing left to ask; otherwise ride them in a later request. */
    readonly questions: Record<string, Question>;
    readonly state: Record<string, unknown>;
    finish(answer: Answered | null): OfferPlan;
  }

  function offerAsk(ctx: RunContext, req: OfferRequest): OfferAsked {
    const portals = req.portals ? portalAsk(ctx, req.portals) : null;
    const cards = (req.cards ?? []).map((c) => cardAsk(ctx, c, c.salt ? `${c.salt}__` : ""));
    const asked = cards.filter((c): c is Asked<CardPlan> => !("done" in c));
    const parts = [...(portals ? [portals] : []), ...asked];
    return {
      questions: mergeQuestions(parts.map((p) => p.questions)),
      state: Object.assign({}, ...parts.map((p) => p.state)),
      first(answer) {
        const done = cards.map((c) => ("done" in c ? c.done : c.finish(answer)));
        const draft = portals ? portals.draft(answer) : null;
        const next = portals && draft ? portals.follow(draft) : { questions: {}, state: {} };
        return {
          cards: done,
          questions: next.questions,
          state: next.state,
          finish(second) {
            return {
              ...(portals && draft ? { portals: portals.finish(draft, second) } : {}),
              cards: done,
            };
          },
        };
      },
    };
  }

  return {
    mode,

    /*
     * The next room's tension, asked when the player leaves a room: it is the
     * one decision that reads how the room just played. What the portals
     * offer is `planPortals`, asked at the room's entry with the offer; the
     * old six-type `door_set` question is gone with the types (doc 003).
     */
    /*
     * **No Jev request.** The next room's pitch used to be asked here, as the
     * player left the previous room, which made a combat room cost three
     * sequential calls: this one, then the room's two rounds. `next_tension`
     * now rides in the room's round 1, where it reads the same state and costs
     * nothing extra, so a room is two requests again.
     *
     * What is left is the pacing envelope, which is code: the cap the run's
     * history allows, and a tension drawn from the rule table inside it so
     * that a caller which needs a pitch before the room exists — the scene
     * labels the portals with one — still has an answer. The room's own plan
     * carries the decided tension (`RoomPlanResult.tension`), and that is the
     * one the fight is built from.
     */
    async planDoors(ctx) {
      const pacing = pacingLabels({
        room_index: ctx.room_index, history: ctx.history,
        health: ctx.labels.health, recent_damage: ctx.labels.recent_damage,
        rest_owed: restOwed(ctx), tensions: ctx.history.tensions,
      });
      const tensions = tensionsAfter(allowedTensions(pacing.tension_cap), recentHistory(ctx.history));
      const rng = new RngSource(ctx.seed).stream("decision", ctx.room_index, null, 1);
      const probabilities = ruleTensionWeights(tensions, ctx.labels);
      const choice = tensions.length > 1
        ? sampleOne(withTemperature(probabilities, TEMPERATURE.next_tension), rng)
        : tensions[0]!;
      const tensionD: Decision = {
        choice, probabilities, confidence: null, source: "rule", question: "next_tension (advisory)",
      };
      return {
        room_index: ctx.room_index,
        sets_offered: [],
        tension: choice as Tension,
        source: { door_set: "rule", tension: "rule" },
        decisions: [tensionD],
      };
    },

    async planRoom(ctx, door, suggested, alongside) {
      // The king's first audience is the run's shape, not a question (doc 022).
      if (isAudienceRoom(ctx.room_index) && (door.room_type === "combat" || door.room_type === "elite"))
        return planAudience(ctx, door, alongside);
      const pacing = pacingLabels({
        room_index: ctx.room_index, history: ctx.history,
        health: ctx.labels.health, recent_damage: ctx.labels.recent_damage,
        rest_owed: restOwed(ctx), tensions: ctx.history.tensions,
      });
      const recent = recentHistory(ctx.history);
      // A peak never follows a peak: a hard rule, so it leaves the option list
      // rather than being asked for in prose (doc 002).
      const tensions = tensionsAfter(allowedTensions(pacing.tension_cap), recent);
      const entry: "N" | "E" | "S" | "W" = "S";
      const spaces = spaceOptions({ last_spaces: ctx.history.spaces, entry_side: entry });
      const state1 = roomRound1State({
        room_type: door.room_type, tension_cap: pacing.tension_cap, labels: ctx.labels,
        intent_preset: ctx.intent.preset, recent, last_spaces: ctx.history.spaces,
        keys_lean: keysLeanOf(ctx),
        held_elements: buildFactsOf(ctx).held_elements,
      });
      const q1 = buildRoomQuestions({ spaces, state: state1, labels: ctx.labels, tensions, style });
      const meta1: RequestMeta = {
        run_id: ctx.run_id, room_index: ctx.room_index, door_slot: door.door_slot, round: 1, purpose: "room",
      };
      // The offer rides in round 1: the same state, independent questions.
      const offerQ = alongside ? offerAsk(ctx, alongside) : null;
      /*
       * **The first room's look is not asked.** Every look option is written
       * around the room before it, and before the first room there is none:
       * Jev read four questions with nothing that could decide them and
       * declined all four. They go to the rule table unasked, and the plan
       * page says why rather than calling it a decline.
       */
      const firstLook: string[] = ctx.room_index <= 1 && recent.last_symmetry === "none"
        ? ["symmetry", "mood_temperature", "mood_brightness", "mood_particles"].filter((n) => q1[n]) : [];
      /*
       * **A depth's light is the depth's** (`BIOME_TEMPERATURE`): the flooded
       * catacombs are cold and the undercroft warm, so the question has one
       * answer there and is not asked (doc 002).
       */
      const depthTemperature = BIOME_TEMPERATURE[biomeFor(door.room_index)];
      const askQ1 = Object.fromEntries(Object.entries(q1).filter(([n]) =>
        !firstLook.includes(n) && !(depthTemperature && n === "mood_temperature")));
      const r1 = await ask(
        offerQ ? mergeQuestions([askQ1, offerQ.questions]) : askQ1,
        offerQ ? { ...flatState(ctx, offerQ.state), ...state1 } : state1 as unknown as Record<string, unknown>,
        meta1,
        { ctx, roomType: door.room_type, ...(alongside ? { cards: cardPools(alongside) } : {}) },
      );
      if (firstLook.length) {
        const filled = await fallback.distributions(
          Object.fromEntries(firstLook.map((n) => [n, q1[n]!])),
          state1 as unknown as Record<string, unknown>, meta1, signal,
        );
        Object.assign(r1.dists, filled.dists);
        unaskedIn.set(r1.dists, new Set(firstLook));
      }
      // The offer's first round. What is left of it — a spell door's school, a
      // stat door's family — rides in round 2, where the doors exist.
      const offerStage = offerQ?.first(r1);
      const rng1 = new RngSource(ctx.seed).stream("decision", ctx.room_index, door.door_slot, 1);

      const decisions: Decision[] = [];
      const pick = (name: string, temp: number) => {
        const d = decide(name, r1.dists, r1.source, rng1, temp, r1.path);
        decisions.push(d);
        return d.choice;
      };
      /*
       * The pitch comes out of the same request as the shape. Neither read the
       * other: they read the player.
       */
      const tension: Tension = tensions.length > 1
        ? pick("next_tension", TEMPERATURE.next_tension) as Tension
        : (tensions[0] ?? suggested);
      const space = pick("space", ROOM_TEMPERATURES.space ?? 0.8) as SpaceArchetypeId;
      /*
       * **The look alternates in code** (`LOOK_REPEAT_PENALTY`).
       *
       * The intent is in the four questions' instructions, where it belongs —
       * a floor lit the same colour every room stops being a place — and the
       * state carries the last room's look as a plain fact. What the state no
       * longer carries is the streak line, because a sentence counting how
       * long an answer has held is the sentence finding 5a measured; and what
       * the instructions cannot do is make a classifier vary, because variety
       * is a property of a sequence and each call is its own state (finding
       * 5). Measured on eight seeds with both of those in place,
       * `mood_particles` still came back `calm` in 92% of rooms.
       *
       * So the last room's answer is multiplied down before the draw. It is a
       * penalty, not a ban: a room can look like the one before it, and the
       * Director's judgement still wins where it is held strongly. Applied
       * after the temperature, so the two do not fight over the same knob.
       */
      const lookPick = (name: string, temp: number, last: string | undefined) =>
        pickAvoiding(name, temp, last, r1, rng1, decisions);
      /*
       * Weighed down only once a look has **held for two rooms**. Penalising
       * any repeat turned the look into a flip-flop: Jev gives similar states
       * the same answer, the room before had usually taken it, so the penalty
       * pushed nearly every room to the other option — a fixed pattern of its
       * own, and a reroll mark on every look line. A look may repeat once;
       * the third room in a row is the one it steers away from.
       */
      const moods = ctx.history.moods ?? [];
      const syms = ctx.history.symmetries ?? [];
      const heldTwice = <T,>(xs: readonly T[], read: (x: T) => string | undefined): string | undefined => {
        const a = xs[0] === undefined ? undefined : read(xs[0]);
        const b = xs[1] === undefined ? undefined : read(xs[1]);
        return a !== undefined && a === b ? a : undefined;
      };
      const symmetry = lookPick("symmetry", ROOM_TEMPERATURES.symmetry ?? 0.9,
        heldTwice(syms, (x) => x)) as "mirrored" | "asymmetric";
      const size = pick("size", ROOM_TEMPERATURES.size ?? 0.8) as RoomSize;
      const mood = moodFrom({
        temperature: depthTemperature
          ?? lookPick("mood_temperature", ROOM_TEMPERATURES.mood_temperature ?? 0.9, heldTwice(moods, (m) => m.temperature)),
        brightness: lookPick("mood_brightness", ROOM_TEMPERATURES.mood_brightness ?? 0.9, heldTwice(moods, (m) => m.brightness)),
        particles: lookPick("mood_particles", ROOM_TEMPERATURES.mood_particles ?? 0.9, heldTwice(moods, (m) => m.particle_intensity)),
      });

      // The last two outlines are kept out of the draw (doc 004, "Skeletons").
      const generated = generateRoom({ space, symmetry, size, mood }, entry, door.room_type, rng1, {
        avoid: (ctx.history.skeletons ?? []).slice(0, 2),
      });
      const base = toRoomPlan(generated, {
        id: `${ctx.run_id}/${ctx.room_index}/${door.door_slot}`,
        seed_key: `decision:${ctx.room_index}:${door.door_slot}`,
        reward_kind: "item",
        params_source: r1.source,
      });

      // Round 2 sees the room that exists, not the one that was asked for.
      const state2 = roomRound2State(state1, base, tension);
      const q2: Record<string, Question> = {
        ...buildZoneQuestions({
          zones: base.zones, extent: base.extent, hazard_cap: pacing.hazard_cap,
          state: state2, labels: ctx.labels, style, biome: biomeFor(door.room_index),
        }),
        ...encounterQuestions(ctx, base, tension, door.room_index, style, capRuns),
        ...(offerStage?.questions ?? {}),
      };
      const meta2: RequestMeta = { ...meta1, round: 2 };
      const r2 = await ask(
        q2,
        { ...(state2 as unknown as Record<string, unknown>), ...(offerStage?.state ?? {}) },
        meta2,
        {
          ctx, roomType: door.room_type,
          room: {
            space: base.params.space, size: base.params.size, symmetry: base.params.symmetry,
            mood: base.params.mood,
            openness: state2.open_ratio_label, cover: state2.cover_label,
            zones: base.zones.map((z) => z.id),
            spawnGroups: base.spawn_groups.map((g) => g.id),
            hazardCap: pacing.hazard_cap, tension,
            waves: roundsFor(door.room_type, tension),
            // The ramp's own two counts, so the density question's options can
            // say what they cost and the state can say what the room allows.
            bodyCap: rampRoster(door.room_index),
            aliveCap: rampFor(door.room_index).alive,
          },
        },
      );
      const offer = offerStage?.finish(Object.keys(offerStage.questions).length > 0 ? r2 : null);
      const rng2 = new RngSource(ctx.seed).stream("decision", ctx.room_index, door.door_slot, 2);

      const zones = base.zones.map((z) => {
        const name = zoneQuestionName(z.id);
        if (!r2.dists[name]) return z;
        const d = decide(name, r2.dists, r2.source, rng2, ZONE_TEMPERATURE, r2.path);
        decisions.push(d);
        return { ...z, feature: d.choice };
      });

      const profile = {
        ...pickProfile(r2, rng2, decisions, decide, {
          // A missing answer must not land outside the ramp either, so the
          // default is the first density this room is allowed rather than a
          // fixed one — `dense` is not offered before room 3.
          density: densitiesOffered(ctx, door.room_index, capRuns)[0]!,
          anchor: anchorsFor(door.room_index, tension === "peak" || door.room_type === "elite")[0]!,
        }, ctx.history.profiles.at(-1)?.anchor),
        rounds: roundsFor(door.room_type, tension),
      };
      const band = bandForRoom({ room_type: door.room_type, tension, pressure_cap: ctx.labels.pressure_cap });
      const assembled = needsEncounter(door.room_type) && band
        // The run-progress ramp sizes the roster here as well as at the world (doc 005).
        ? assembleEncounterDetailed(profile, base, band, rng2, { source: r2.source, room_index: door.room_index })
        : null;
      let encounter = assembled?.plan ?? null;
      let affixSource: typeof r2.source | null = null;

      /*
       * An elite room carries an elite affix set — doc 005's "one or two
       * affixes, re-measured against the elite band, degraded until it fits".
       *
       * This was never wired: `affixes: null` was written into the result and
       * the encounter shipped with an empty set, so an elite room was an
       * ordinary room at a higher band. The player read it as "the same enemies
       * take longer to kill", which is the one way a harder room should not
       * feel harder. The set is drawn from the legal ones for this roster and
       * run, two affixes where the cap allows and one otherwise, and
       * `applyEliteAffixes` keeps the plan inside the band by shrinking the
       * roster or dropping to the first affix rather than by shipping a room
       * that is out of band.
       */
      if (assembled && encounter && door.room_type === "elite") {
        const actx = affixContext(assembled.diagnostics.roster.length, ctx.history, false);
        const legal = enumerateAffixSets(actx);
        const wantPair = ctx.labels.pressure_cap >= 5;
        const pool = legal.filter((set) => set.length === (wantPair ? 2 : 1));
        const candidates = pool.length > 0 ? pool : legal;
        if (candidates.length > 0) {
          const set = candidates[Math.floor(rng2.next() * candidates.length)]!;
          const applied = applyEliteAffixes({
            plan: encounter, roster: assembled.diagnostics.roster, chunks: assembled.diagnostics.chunks,
            room: base, affixes: set, band: band ?? undefined,
          });
          encounter = applied.plan;
          affixSource = r2.source;
          // Drawn evenly by code from the legal sets, not asked: the record
          // says so, with the draw it was.
          decisions.push({
            choice: applied.affixes.join("+") || "none",
            probabilities: Object.fromEntries(candidates.map((c) => [c.join("+"), 1 / candidates.length])),
            confidence: null, source: "rule", question: "elite_affixes (code draw)",
          });
        }
      }

      const plan: RoomPlan = {
        ...base,
        zones: dedupeResources(zones),
        encounter,
        source: { ...base.source, params: r1.source, encounter: encounter ? r2.source : "none" },
      };

      return {
        door, plan, tension,
        source: {
          params: r1.source, mood: r1.source, reward_kind: "rule",
          zones: r2.source, encounter: encounter ? r2.source : "rule",
          affixes: affixSource, layout: generated.layout,
        },
        profile: needsEncounter(door.room_type) ? profile : null,
        elite_affixes: encounter?.elite_affixes ?? [],
        trimmed: false,
        decisions,
        ...(offer ? { offer } : {}),
      };
    },

    /*
     * A room with no plan to ride on — a vendor's. Its portals' promises have
     * no round 2 to travel in, so they pay for a second request of their own,
     * and only when there is something to promise.
     */
    async planOffer(ctx, req) {
      const q = offerAsk(ctx, req);
      const meta: RequestMeta = { run_id: ctx.run_id, room_index: ctx.room_index, door_slot: null, round: 1, purpose: req.purpose ?? "offer" };
      const brief: BriefFor = { ctx, ...(req.cards?.length ? { cards: cardPools(req) } : {}) };
      const stage = q.first(await ask(q.questions, flatState(ctx, q.state), meta, brief));
      if (Object.keys(stage.questions).length === 0) return stage.finish(null);
      return stage.finish(await ask(stage.questions, flatState(ctx, stage.state), { ...meta, round: 2 }, brief));
    },

    async planPortals(ctx, choices) {
      const q = portalAsk(ctx, choices);
      const meta: RequestMeta = { run_id: ctx.run_id, room_index: ctx.room_index, door_slot: null, round: 1, purpose: "portals" };
      const draft = q.draft(await ask(q.questions, flatState(ctx, q.state), meta, { ctx }));
      const next = q.follow(draft);
      if (Object.keys(next.questions).length === 0) return q.finish(draft, null);
      return q.finish(draft, await ask(next.questions, flatState(ctx, next.state), { ...meta, round: 2 }, { ctx }));
    },

    async planCards(ctx, req) {
      const q = cardAsk(ctx, req);
      if ("done" in q) return q.done;
      const meta: RequestMeta = { run_id: ctx.run_id, room_index: ctx.room_index, door_slot: null, round: 1, purpose: `cards:${req.pool.kind}${req.salt ? `:${req.salt}` : ""}` };
      return q.finish(await ask(q.questions, flatState(ctx, q.state), meta, { ctx, cards: cardPools({ cards: [req] }) }));
    },

  };
}

/* -------------------------------- helpers --------------------------------- */

/**
 * The offer's pools as the briefing reports them: which candidates the machinery
 * has tagged, and which of the pity and temptation clocks are armed.
 *
 * The candidates' *descriptions* stay on the options, so a spell is written out
 * once per request; what goes in the state is the part the options cannot
 * carry, which is what the offer machinery is going to do with them.
 */
function cardPools(req: { readonly cards?: readonly CardRequest[] }): BriefingCardPool[] {
  return (req.cards ?? []).map((c) => ({
    kind: c.pool.kind,
    ...(c.salt ? { where: c.salt.replace(/_/g, " ") } : {}),
    candidates: c.pool.candidates.map((x) => ({
      id: x.id, facts: x.facts,
      ...(x.compatibleHeldSpellIds ? { compatibleHeldSpellIds: x.compatibleHeldSpellIds } : {}),
    })),
    ...(c.pity ? { pity: true } : {}),
    ...(c.temptation ? { temptation: true } : {}),
    ...(c.pool.guarantee?.length ? { guarantee: c.pool.guarantee } : {}),
  }));
}

/** An optional `not_for`, as a spread, so an absent one adds no key. */
function maybeNotFor(text: string | undefined): { not_for?: string } {
  return text === undefined ? {} : { not_for: text };
}

/** A distribution with each key's mass multiplied, then renormalised. */
function reweight(d: Distribution, factor: (id: string) => number): Distribution {
  const raw = Object.entries(d).map(([k, v]) => [k, v * factor(k)] as const);
  const total = raw.reduce((a, [, v]) => a + v, 0);
  if (total <= 0) return d;
  return Object.fromEntries(raw.map(([k, v]) => [k, v / total]));
}

/** A distribution cut down to some keys and renormalised; uniform if they held nothing. */
function restrictTo(d: Distribution, keys: readonly string[]): Distribution {
  const total = keys.reduce((a, k) => a + (d[k] ?? 0), 0);
  return Object.fromEntries(keys.map((k) => [k, total > 0 ? (d[k] ?? 0) / total : 1 / keys.length]));
}

/** The schools the player can already cast, as labels, for `spell_school`. */
function heldSchools(ctx: RunContext): string[] {
  const held = [...ctx.slots.flatMap((s) => (s ? [s.base] : [])), ...ctx.inventory.map((i) => i.base)];
  return [...new Set(held.flatMap((id) => {
    const school = (SCHOOL_OF as Record<string, string>)[id];
    return school ? [school] : [];
  }))].sort();
}

/**
 * One reward kind, said once: what it pays and when it is worth a portal.
 * `portal_kinds` joins the clauses of the kinds in a set, `elite_kind` puts one
 * behind the harder fight. Written as whole sentences so that joining three of
 * them reads as three sentences rather than as one run-on.
 */
/*
 * **The four kinds partition `build_shape`, one each, and nothing else.**
 *
 * They used to overlap on whatever label seemed to suit: `stat` claimed a tight
 * mana bar, `spell` claimed early progress, `affix` claimed late progress and a
 * build with no gaps. Two of those labels turned out to be stuck — `mana_sustain`
 * read `tight` in 50 rooms of 56 and `build_gaps` read `some` in all 56 — so
 * `stat` matched every state, `affix` matched none, and the measured answer to
 * "what should the elite fight pay?" was stat at 99%, spell at 1.3%, affix and
 * gold at nothing. The first is gone from the state and the second is fixed
 * (`flatState`), but the
 * deeper fault was the grounding: four options competing on a shared pile of
 * conditions is a question whose answer is decided by how many conditions each
 * option happened to be written with.
 *
 * So each kind owns **one level of one field**, and the field is doc 007's
 * completion signal, because that is what actually decides which currency is
 * worth anything right now:
 *
 * - **raw** — keys are empty, so a spell is worth more than any amount of
 *   anything else. This is Slay the Spire front-loading commons and Hades
 *   handing out the boons that define a run first.
 * - **forming** — the keys are full and bare, so an affix is what turns three
 *   spells into a build.
 * - **formed** — nothing left to fill, so a stat raises what is there, and gold
 *   buys the specific thing the shelf has that the floor did not offer.
 *
 * The second clause on each is the one *other* reason that currency can be
 * urgent, and the four second clauses name four different fields, so no option
 * can win by matching the same underlying fact twice.
 */
/**
 * **"Not this one", said in the canonical clause shape.**
 *
 * A fit clause can only assert that a field *is* one of some values, which is
 * the right constraint — Jev matches a state to a description, and a negation
 * is not something a match can carry. But the values of a field are closed, so
 * "every value but mine" is a positive clause that means exactly the negation.
 *
 * Adding one to all four reward kinds is therefore a constant on all four,
 * except for the one kind the label names, which loses it. That is the whole
 * mechanism: the badge the player has seen three rooms running keeps every
 * argument it had and simply stops being the one with the most matching
 * clauses, so the next-best need takes the door. No die is rolled, and no
 * option leaves the list — a player who genuinely still needs affixes still
 * gets them, just not by default.
 */
function notThisOne(field: "door_offered_running" | "door_skipped_most", kind: string): Fit {
  return [field, ...(FIT_FIELDS[field] as readonly string[]).filter((v) => v !== kind)] as Fit;
}

const KIND_CLAUSE: Readonly<Record<string, string>> = {
  spell: grounded(
    "A spell portal fills an empty key with a new castable, and to a full staff it offers both copies of " +
    "the spells already held — which raise their level — and new spells to replace one with.",
    ["build_shape", "raw"], ["build_gaps", "some"], ["spell_levels", "all_base"],
    notThisOne("door_offered_running", "spell"), notThisOne("door_skipped_most", "spell"),
  ),
  affix: grounded(
    "An affix portal attaches a modifier to a spell already held, in one of that key's affix slots; it fills no key.",
    ["build_shape", "forming"], ["hits_per_shot", "few"], ["affix_slots_open", "few", "many"],
    notThisOne("door_offered_running", "affix"), notThisOne("door_skipped_most", "affix"),
  ),
  stat: grounded(
    "A stat portal raises movement, survival, mana or the sword, the player rather than a spell; the mana " +
    "family makes the bar bigger or refill faster. It fills no key and no affix slot.",
    ["build_shape", "formed"], ["health", "low", "critical"], ["casts_per_bar", "few"],
    ["mana_stats_taken", "none"],
    notThisOne("door_offered_running", "stat"), notThisOne("door_skipped_most", "stat"),
  ),
  gold: grounded(
    "A gold portal scatters a purse, which is spent at a merchant or a smith in a later room rather than " +
    "taken in this one.",
    ["gold", "poor"], ["run_progress", "mid", "late"],
    notThisOne("door_offered_running", "gold"), notThisOne("door_skipped_most", "gold"),
  ),
};

/**
 * The rooms with **no fight** in them, as options of the need question.
 *
 * They used to be a separate yes/no/which question (`npc_room`) asked after
 * the kinds were settled, with its own escape option — so a vendor competed
 * against "no vendor" rather than against the rewards it would displace, and
 * a live run put the merchant on the portal list in nine rooms of sixteen.
 * Ranked against the rewards, a vendor takes a door only when it is worth
 * more than one.
 */
const NPC_CLAUSE: Readonly<Record<string, string>> = {
  merchant: grounded(
    "The merchant, who sells a spell, an affix or a stat for gold: the player buys whichever the purse " +
    "covers and can pay to refresh the shelf instead of keeping one of three cards dealt. There is no fight, " +
    "so it costs the room's reward.",
    ["build_shape", "raw", "forming"], ["gold", "ok", "rich"],
  ),
  smith: grounded(
    "The blacksmith, who raises a held spell's level for gold. There is no fight, so it costs the room's reward.",
    ["gold", "rich"], ["run_progress", "late", "pre_boss"],
  ),
  fountain: grounded(
    "A fountain, one drink of which restores half the health bar. There is no fight, so it costs this " +
    "room's reward.",
    ["health", "low", "critical"], ["recent_damage", "heavy"], ["hurt_by", "shots", "blades"],
  ),
};

/**
 * `preference.consistency` as the count it is taken from: the verdict said
 * what code concluded about the player, this says what code counted.
 */
const OFF_STYLE: Readonly<Record<string, string>> = {
  on_plan: "none", drifting: "one", pivoted: "two_running",
};

/** Which style the keys lean, from the tags on the spells actually held. */
function keysLeanOf(ctx: RunContext): KeysLean {
  return keysLean(ctx.slots.flatMap((s) => (s ? [ITEMS.get(s.base)?.tags ?? []] : [])));
}

/**
 * **The staff, as facts** (`run/build-facts.ts`), from whatever the caller
 * gave. `ctx.power` carries the levels and affixes; a caller that has none —
 * a test, the opening room — gets three bare keys, which is what it holds.
 *
 * Computed once per request rather than memoised: it is a loop over three
 * keys, and a cache keyed on a context would be a second source of truth for
 * the one thing the offer is about.
 */
function buildFactsOf(ctx: RunContext): ReturnType<typeof buildFacts> {
  const keys = ctx.slots.flatMap((s, i) => (s ? [{
    base: s.base,
    level: ctx.power?.levels[i] ?? 1,
    affixes: ctx.power?.affixes[i] ?? [],
  }] : []));
  if (keys.length === 0) return NO_BUILD;
  return buildFacts({
    keys, items: ITEMS,
    manaMax: ctx.power?.mana_max ?? ctx.staff.mana_max,
    statsTaken: ctx.history.stats_taken ?? [],
  });
}

/** "key 2", "keys 2 and 3". */
function keyList(keys: readonly number[]): string {
  return keys.length === 1 ? `key ${keys[0]}` : `keys ${keys.slice(0, -1).join(", ")} and ${keys.at(-1)}`;
}

/** Doc 002 keeps raw numbers out of the state, the portal count included. */
const COUNT_WORD: Readonly<Record<number, string>> = { 1: "one", 2: "two", 3: "three" };


const notConfigured: import("./types.ts").Evaluator = async () => {
  throw new EvaluatorError("http", "jev mode needs an evaluator");
};

/**
 * Doc 003: rest is forced while two consecutive rooms took heavy damage and
 * none has been entered since. Keying it on `rests_entered === 0` instead
 * caps a run at one rest however badly it is going, which is how a nine-room
 * run becomes pure attrition.
 */
function restOwed(ctx: RunContext): boolean {
  if (ctx.labels.recent_damage !== "heavy") return false;
  const since = [...ctx.history.rooms].reverse().indexOf("rest");
  return since === -1 || since >= 2;
}

/** Several question sets as one request's; two with one name is a bug, not a merge. */
function mergeQuestions(sets: readonly Record<string, Question>[]): Record<string, Question> {
  const out: Record<string, Question> = {};
  for (const set of sets)
    for (const [name, q] of Object.entries(set)) {
      if (name in out) throw new Error(`question "${name}" asked twice in one request`);
      out[name] = q;
    }
  return out;
}

function flatState(ctx: RunContext, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    health: ctx.labels.health,
    recent_damage: ctx.labels.recent_damage,
    clear_speed: ctx.labels.clear_speed,
    movement_pressure_recent: ctx.labels.movement_pressure_recent,
    run_progress: ctx.labels.run_progress,
    gold: ctx.labels.gold,
    /*
     * **Facts, not verdicts** (doc 002): what the last two fights measured
     * (`run/observed.ts`), plus the two things that really are facts about the
     * staff: which style its keys lean, and how much of it is filled in.
     */
    ...(ctx.labels.observed ?? UNMEASURED),
    keys_lean: keysLeanOf(ctx),
    /*
     * **What is actually on the staff** (`run/build-facts.ts`).
     *
     * Everything above says how the last two fights *went*; nothing said what
     * the player is holding. So the offer question — which is entirely a
     * question about the held build — was answered without it, and once the
     * affix slots opened the affix door won essentially every room, because
     * no fact could say the slots were nearly full or that the levels had
     * never moved. Five labels an option can be grounded on, and one line per
     * key for the card questions to read a candidate's description against.
     */
    ...buildFactsOf(ctx),
    /*
     * **A gap is an empty key**: the thing the player can see on their own
     * staff, and what the spell portal's "fits when build gaps is some" is
     * grounded on.
     */
    build_gaps: ctx.slots.some((s) => s === null) ? "some" : "none",
    /** Doc 007's completion signal; absent reads as the middle. */
    build_shape: ctx.labels.build_shape ?? "forming",
    dominant_tags: ctx.labels.preference.dominant,
    /*
     * How many of the last three cards were outside the style the player
     * stated, which is the measurement `consistency` was a verdict about
     * ("on plan", "drifting", "pivoted" say what code concluded; this says
     * what it counted).
     */
    off_style_picks: OFF_STYLE[ctx.labels.preference.consistency] ?? "none",
    intent_preset: ctx.intent.preset,
    /*
     * The lane the player's own words name (doc 007), as a label, because a
     * label is what Jev matches. The sentence itself still travels verbatim
     * below: the label is the part an option can be grounded on, the sentence
     * is the nuance no keyword table holds.
     */
    typed_intent: laneFromText(clampFreeText(ctx.intent.free_text)) ?? "none",
    ...recentHistory(ctx.history),
    intent: { preset: ctx.intent.preset, ...(clampFreeText(ctx.intent.free_text) ? { free_text: clampFreeText(ctx.intent.free_text) } : {}) },
    ...extra,
  };
}

function needsEncounter(t: RoomType): boolean {
  return t === "combat" || t === "elite";
}

/** Doc 004: two zones that picked the same resource keep one. */
function dedupeResources(zones: RoomPlan["zones"]): RoomPlan["zones"] {
  const seen = new Set<string>();
  return zones.map((z) => {
    if (z.feature === "none") return z;
    const res = featureResource(z.feature);
    if (!res) return z;
    if (seen.has(res)) return { ...z, feature: "none" as const };
    seen.add(res);
    return z;
  });
}

/**
 * Looked up in **FEATURES**, which is what a zone holds. It looked in
 * `BASE_ITEMS` — the spell pool — so `resource` was undefined for every
 * feature id and the dedupe never fired. All four floor hazards share
 * `resource: "floor_hazard"`, which is the design saying one hazard per room;
 * rooms were getting up to three.
 */
function featureResource(id: string): string | undefined {
  return FEATURES.find((f) => f.id === id)?.resource;
}

function encounterQuestions(
  ctx: RunContext, room: RoomPlan, tension: Tension, roomIndex: number, style?: QuestionStyle, capRuns = true,
): Record<string, Question> {
  if (!needsEncounter(room.room_type)) return {};
  const labels = labelSet(ctx.labels as unknown as Record<string, unknown>);
  const groups = room.spawn_groups.map((g) => g.id);
  const entries = (["far_front", "flanks", "surround", "turrets_center"] as const).filter((e) =>
    e === "far_front" ? groups.some((g) => g.startsWith("far") || g.startsWith("ring"))
    : e === "flanks" ? groups.some((g) => g.startsWith("flank"))
    : e === "surround" ? groups.includes("surround")
    : groups.includes("centre") || groups.includes("center"),
  );
  const compositions = filterForCharter(
    (["melee_heavy", "ranged_heavy", "mixed", "siege"] as const).map((c) => ({
      value: c,
      score: counterScore(c, ctx.labels.build.range, keysLeanOf(ctx)) as CounterScore,
    })),
    ctx.history,
    room.room_type,
  ).map((o) => o.value);

  const opt = (id: string, description: string) => ({ id, description });
  /*
   * Every option says when it fits, in labels the state carries (tension,
   * health, recent_damage, clear_speed, build_range): Jev matches a state to
   * a description, and a bare name ("mixed enemy mix") gave it nothing to
   * match, so it spread mass onto the escape option.
   */
  const COMPOSITION: Record<string, string> = {
    melee_heavy: grounded(
      "Mostly melee bodies that close in, so range is the answer and footwork is the cost.",
      ["sword_share", "none"], ["tension", "build", "peak"], ["hurt_by", "shots"],
    ),
    ranged_heavy: grounded(
      "Mostly shooters that keep their distance, so closing the gap is the answer.",
      ["sword_share", "most"], ["tension", "build", "peak"], ["hurt_by", "blades"],
    ),
    mixed: grounded(
      "An even mix of melee and ranged bodies: presses nothing in particular.",
      ["tension", "release"], ["sword_share", "some"], ["keys_lean", "mixed"],
    ),
    siege: grounded(
      "Slow, heavy bodies and turrets that hold ground: a long fight.",
      ["tension", "peak"], ["health", "full"], ["damage_rate", "high"],
    ),
  };
  const DENSITY: Record<string, string> = {
    sparse: grounded(
      "The fewest bodies a fight is built with: a short room.",
      ["tension", "release"], ["recent_damage", "heavy"], ["health", "low", "critical"],
      ["since_release", "long"], ["damage_rate", "low"],
    ),
    normal: grounded(
      "A middling count over the room's whole fight.",
      ["tension", "build"], ["health", "ok"], ["recent_damage", "some"], ["since_release", "a_while"],
      ["damage_rate", "fair"],
    ),
    dense: grounded(
      "As many bodies as this room allows: the longest fight.",
      ["tension", "peak"], ["health", "full"], ["clear_speed", "fast"], ["since_release", "just"],
      ["damage_rate", "high"],
    ),
  };
  /**
   * **How hard the room presses** (doc 019).
   *
   * It used to ask for the *shape* a roster was split into — a burst, two
   * waves, a trickle — which is a planning detail the player never sees as
   * such. What they feel is how soon the next beat arrives once they have
   * dealt with this one, so that is what is asked, and the two knobs it moves
   * are `PACING` in the sim. Everything that makes a fight safe stays in code.
   */
  const WAVES: Record<string, string> = {
    breathe: grounded(
      "The floor clears before the next group arrives: room to breathe between them.",
      ["tension", "release"], ["health", "low", "critical"], ["recent_damage", "heavy"],
      ["last_tension", "peak"], ["damage_rate", "low"], ["damage_trend", "rising"],
    ),
    steady: grounded(
      "The next group arrives as the last of this one falls: a fight that keeps moving.",
      ["tension", "build"], ["health", "ok"], ["clear_speed", "normal"],
      ["damage_rate", "fair"],
    ),
    relentless: grounded(
      "The next group arrives while this one is still standing: no gap to reset in.",
      ["tension", "peak"], ["health", "full"], ["clear_speed", "fast"], ["last_room_kind", "rest"],
      ["damage_rate", "high"],
    ),
  };
  const ANCHOR: Record<string, string> = {
    none: grounded(
      "No priority target: the room is a crowd, not a problem to solve.",
      ["clear_speed", "slow"], ["health", "low", "critical"], ["tension", "release"],
      ["damage_rate", "low"], ["damage_trend", "rising"],
    ),
    tank: grounded(
      "A slow, armoured body to focus first: the room has an order to kill in.",
      ["clear_speed", "fast", "normal"], ["tension", "build", "peak"], ["health", "ok", "full"],
      ["damage_rate", "fair", "high"],
    ),
    summoner: grounded(
      "A summoner that keeps adding bodies until it dies: the room does not end until it does.",
      ["clear_speed", "fast"], ["tension", "peak"], ["health", "full"],
    ),
  };
  const ENTRY: Record<string, string> = {
    /*
     * `far_front` and `flanks` carry the partition, because they are the two
     * every room's spawn groups support; `surround` and `turrets_center` are
     * offered only by the archetypes that declare those groups, so a question
     * that leaned on them would be ungrounded in most rooms.
     */
    far_front: grounded(
      "From the far side: the most time to see them coming.",
      ["tension", "release"], ["health", "low", "critical"], ["recent_damage", "heavy"],
    ),
    flanks: grounded(
      "From both sides at once: the player has to turn.",
      ["tension", "build", "peak"], ["health", "ok", "full"], ["recent_damage", "none", "some"],
    ),
    surround: grounded(
      "From all round: the hardest entry, and nowhere to back into.",
      ["health", "full"], ["recent_damage", "none"], ["clear_speed", "fast"],
    ),
    turrets_center: grounded(
      "Turrets in the middle with bodies round them: a fixed threat to work round.",
      ["sword_share", "none"], ["tension", "peak"], ["keys_lean", "area"],
    ),
  };
  /**
   * **Which subspecies this room shows** (doc 019).
   *
   * Grounded in what the twist *asks of the player* rather than in its
   * flavour, so the clauses partition a state instead of restating a name.
   * Taken over the whole set, every level of `build_range` and of
   * `movement_pressure_recent` appears, so no state falls through to the
   * escape option (doc 002, "Some field must be covered end to end").
   */
  const SUBSPECIES_OPTIONS: Record<string, string> = {
    lancer: grounded(
      "Rushers that drive their spikes from a tile further out, and let them fly.",
      ["sword_share", "none"], ["movement_pressure_recent", "light"],
    ),
    breaker: grounded(
      "A heavy whose chop splits the floor ahead of it: out of reach is not out of the way.",
      ["sword_share", "none"], ["clear_speed", "fast"],
    ),
    pinner: grounded(
      "Shooters that put two shots down one lane: step off it, and keep going.",
      ["sword_share", "most"], ["keys_lean", "spam"],
    ),
    watcher: grounded(
      "Emplacements whose drawn line is the shot, with nothing to dodge after it fires.",
      ["sword_share", "most"], ["keys_lean", "nuke"],
    ),
    wisp: grounded(
      "Circlers whose shots curl after you for a moment: move late, not early.",
      ["sword_share", "some"], ["keys_lean", "area"],
    ),
    planter: grounded(
      "Seeds planted in a ring round you with two ways out.",
      ["sword_share", "some"], ["keys_lean", "dot"],
    ),
    beacon: grounded(
      "Lightning that leaves the ground burning: leave the mark and stay off it.",
      ["keys_lean", "nuke"], ["clear_speed", "fast"],
    ),
    quaker: grounded(
      "Four cracks walking toward you one after another: cross the first and keep moving.",
      ["keys_lean", "area"], ["movement_pressure_recent", "light"],
    ),
    chainer: grounded(
      "A chain anchored across the floor: the room is smaller until it dies.",
      ["movement_pressure_recent", "light"], ["clear_speed", "normal"],
    ),
    burrower: grounded(
      "A burrower that comes up three times along its line: leave the line, not the spot.",
      ["movement_pressure_recent", "heavy"], ["clear_speed", "normal"],
    ),
    emberling: grounded(
      "Coals that flare into a ring of fire when they burn: hit them alight from outside a tile.",
      ["sword_share", "some"], ["clear_speed", "slow"],
    ),
    fusilier: grounded(
      "Gunners that fire a second barrel off to one side: step through the cone, not around it.",
      ["sword_share", "most"], ["clear_speed", "slow"],
    ),
    pealer: grounded(
      "A ringer that wards everything near it at once: there is no line to cut, so it dies first.",
      ["clear_speed", "fast"], ["damage_rate", "high"],
    ),
    brooder: grounded(
      "Coals that hatch where they land: its reinforcements arrive on top of you.",
      ["movement_pressure_recent", "heavy"], ["damage_rate", "high"],
    ),
  };
  /**
   * A variant's spec, from the **enemy table** rather than from a second
   * hand-written table: its own sentence, the body it varies — which the
   * change is only legible against — and the tags that say which kind of
   * pressure it is more of. A body the table does not know keeps its sentence
   * and gets no negative rather than an invented one.
   */
  const subspeciesSpecFor = (id: string): { readonly what: string; readonly not_for?: string } => {
    const what = unground(SUBSPECIES_OPTIONS[id] ?? id);
    try {
      const def = enemy(id as EnemyId) as { base?: string; tags?: readonly string[]; threat_weight?: number };
      if (!def.base) return { what };
      return subspeciesSpec({
        description: what, base: def.base, tags: def.tags ?? [], threat: def.threat_weight ?? 0,
      });
    } catch { return { what }; }
  };
  const SUBSPECIES_WEIGHT: Record<string, string> = {
    none: grounded(
      "Plain bodies only: nothing in the room behaves differently from what it looks like.",
      ["run_progress", "early"], ["damage_rate", "low"], ["last_room_kind", "elite"],
      ["health", "low", "critical"],
    ),
    some: grounded(
      "A few of the room's bodies are variants: enough to notice, not enough to relearn.",
      ["run_progress", "mid"], ["damage_rate", "fair"], ["clear_speed", "normal"],
    ),
    many: grounded(
      "Most of what can be a variant is one: the room reads familiar and answers differently.",
      ["run_progress", "late", "pre_boss"], ["damage_rate", "high"], ["clear_speed", "fast"],
      ["last_room_kind", "rest"],
    ),
  };
  const ELITE_PRESENCE: Record<string, string> = {
    none: grounded(
      "No elites: every body in the room is the ordinary kind.",
      ["health", "low", "critical"], ["recent_damage", "heavy"], ["damage_trend", "rising"],
      ["damage_rate", "low"],
    ),
    one: grounded(
      "One enraged body hidden in the room, dropping a heal and a coin when it falls.",
      // `ok` and `full`, so that health is covered end to end against `none`'s
      // `low or critical` even at the ramp step that offers only these two.
      ["health", "ok", "full"], ["tension", "build"], ["damage_rate", "fair"], ["last_room_kind", "rest"],
    ),
    two: grounded(
      "Two enraged bodies: the room has two things in it to pick a kill order for.",
      ["health", "full"], ["clear_speed", "fast"], ["tension", "peak"], ["damage_rate", "high"],
    ),
  };

  /*
   * The slate a room offers, at most six of the unlocked ids (doc 002 measured
   * short lists far better than long ones), rotated by the room index so
   * different rooms offer different slates rather than the same first six all
   * run. `none` is an ordinary option, not the escape: a room with no variants
   * in it is a real answer.
   */
  const unlocked = rampSubspecies(roomIndex);
  const slate = unlocked.length <= 6
    ? [...unlocked]
    : Array.from({ length: 6 }, (_, i) => unlocked[(roomIndex * 3 + i) % unlocked.length]!);

  const questions: Record<string, Question> = {
    composition: choiceQuestion({
      labels,
      instructions:
        /*
         * It used to read the mix "from the build's range and the build's
         * archetype" — two labels removed as verdicts (doc 002), one of them
         * hard-coded `mid` — and to say that a mix "that suits it makes the
         * room a showcase, and the run needs both": a verdict, and a sentence
         * about a sequence (finding 15). It names the facts the options are
         * written from instead, and keeps the two-sidedness without the
         * verdict: measured over 12 logged states (jev-findings 30), naming
         * the facts alone put 0.82 of the mass on `ranged_heavy`, the old
         * sentence 0.51, this one 0.74. What spread the old one was the
         * sentence about the run, which is a sequence property and code's.
         *
         * The run's sentence is back, as a principle naming no mix, now
         * that the briefing prints each fight as it was built: replayed over
         * two live runs, it took the mass on the previous room's mix from
         * 0.78 to 0.58 (and a spell door's school, given the same sentence,
         * from 0.87 to 0.46).
         */
        "Choose the enemy mix for this room, from its tension and from how the player fights: how much of " +
        "the damage the sword does (sword share), what has been taking their health (hurt by) and which way " +
        "the keys lean. A mix can press the way the player fights, or play into it; either is an answer. " +
        "The recent fights, and the mix each was built on, are in the state. A run whose fights have kept " +
        "being built on one mix has settled into it, which a run should not; before any fight, this weighs nothing.",
      options: (compositions.length ? compositions : (["mixed"] as const))
        .map((c) => ({ ...opt(c, COMPOSITION[c]!), spec: COMPOSITION_SPEC[c]! })),
      style,
    }),
    /*
     * **The ramp filters before either arm answers** (005's ramp, doc 002's
     * "code removes illegal options"). A fourteen-fight run's caps were
     * written for its late rooms; applied from the first door they let room 1
     * arrive as a wall. The clamp inside the assembler stays as the floor, but
     * an option the ramp forbids is never offered, so neither arm can ask for
     * a dense room before the player has a build and then have it quietly
     * taken away. Rooms 1 and 2 are offered sparse and normal — two real
     * answers, since a room-1 total of twelve sits above both of their
     * targets and what holds the opening gentle is the four-at-once cap.
     */
    density: choiceQuestion({
      labels,
      /*
       * **The total, not the crowd.** How many bodies stand on the floor
       * together is the run-progress ramp's and no answer moves it; what this
       * sets is how many the room holds over its whole fight. Said once here
       * rather than on each option, where it would be three arguments.
       */
      instructions:
        "Choose how many bodies this room holds over its whole fight, from its tension and the player's "
        + "health and recent damage. Each option names how many it asks for in one round of fighting, and "
        + "the room above says how many rounds it plays and how many bodies it may hold in all. This is the "
        + "room's total rather than its crowd: how many stand on the floor together is fixed for this room "
        + "and stated with it, so a larger count is a longer fight rather than a thicker one.",
      options: densitiesOffered(ctx, roomIndex, capRuns).map((d) => ({ ...opt(d, DENSITY[d]!), spec: DENSITY_SPEC[d]! })),
      style,
    }),
    wave_structure: choiceQuestion({
      labels,
      instructions:
        "Choose how hard this room presses: how soon the next group of enemies arrives once the player "
        + "has dealt with the one in front of them. Read it from the room's tension and how the player is doing.",
      /*
       * **An elite room cannot breathe.** The door promised a harder room, and
       * a fight that lets the floor clear between every group is the easy
       * version of it — the player takes each group alone and the room is a
       * queue. A code constraint, so no answer can choose it.
       */
      options: (room.room_type === "elite" ? ["steady", "relentless"] as const : ["breathe", "steady", "relentless"] as const)
        .map((v) => ({ ...opt(v, WAVES[v]!), spec: WAVES_SPEC[v]! })),
      style,
    }),
    anchor: choiceQuestion({
      labels,
      instructions:
        /*
         * **No sentence making one option's case** (finding 4). The line that
         * used to close this — "a run needs both, or the rooms that do have
         * something to aim at stop reading as different" — argues for `none`
         * from the instructions, which are read before the options, and
         * `none` came back in 85% of rooms.
         */
        "Choose whether this room has a priority target. An anchor changes what kind of fight the room is, "
        + "not how hard it is: with one, the room has an order to kill in and a body the player has to "
        + "solve; without one, it is a crowd the player clears in whatever order they like. Answer from how "
        + "fast this player has been clearing and from what the room is pitched at.",
      // A summoner outproduces a low-tier player's damage, so the room stops
      // ending rather than getting harder. Code keeps it to the top bands
      // instead of asking Jev to judge a soft-lock, and the ramp keeps every
      // anchor out of the opening rooms.
      options: anchorsFor(roomIndex, tension === "peak" || room.room_type === "elite")
        .map((a) => ({ ...opt(a, ANCHOR[a]!), spec: ANCHOR_SPEC[a]! })),
      style,
    }),
    entry: choiceQuestion({
      labels,
      instructions: "Choose where the enemies arrive from, from the room's tension and the player's health.",
      options: (entries.length ? entries : (["far_front"] as const))
        .map((e) => ({ ...opt(e, ENTRY[e]!), spec: ENTRY_SPEC[e]! })),
      style,
    }),
    /*
     * **One question, ranked, for both slots** (doc 003's conversion).
     *
     * It was two questions over the same slate, `subspecies_a` and
     * `subspecies_b`, each with its own `none`. Two independent answers over
     * one list is a combination question wearing a disguise: they could name
     * the same body (code then kept it once, so one slot was wasted), the
     * second had to be told in prose that it was the second, and neither said
     * which of the two the room wanted *more*. One ranked answer says both.
     *
     * **`none` is not an option of it.** It was, as a stop — a ranking that
     * put it first was a room with no variants — and measured it took 71% of
     * rooms. It is a yes-or-no wearing a which-one: the question reads a slate
     * of bodies and one of its options is not a body. Whether the room has
     * variants at all is `subspecies_weight`, where `none` was already an
     * answer, so the two `none`s were the same answer asked twice and this one
     * outranked a real body to give it.
     */
    /*
     * With `none` gone the slate can be empty — the ramp unlocks no variant
     * before room 3 — and a question with no options is not a question. The
     * weight question answers `none` on its own there.
     */
    ...(slate.length === 0 ? {} : { subspecies: choiceQuestion({
      labels,
      instructions:
        "Which kinds of variant body does this room want, most first? A variant is a body the player "
        + "knows with one thing about it changed, so it is answered differently without being a new enemy "
        + "to learn. The room takes at most two, because a room where everything is a variant has no "
        + "ordinary body left to read the strangeness against. Whether the room shows any at all is a "
        + "different question; this one is only which, if it does. Read it from how the player has been "
        + "fighting — how much of their damage is the blade, how many bodies each shot hits, how fast "
        + "they clear — and from which way their keys lean.",
      // A variant's own sentence says what it asks of the player; what it is
      // not for is read off the enemy table — the body it varies, which the
      // change is only legible against, and the pressure its tags add more of.
      options: slate.map((id) => ({
        ...opt(id, SUBSPECIES_OPTIONS[id]!),
        spec: subspeciesSpecFor(id),
      })),
      style,
    }) }),
    subspecies_weight: choiceQuestion({
      labels,
      instructions:
        "Does this room show variant bodies at all, and if so how much of it is made of them? In a room "
        + "of plain bodies each behaves as the player has already met it; in a room of variants some "
        + "answer differently from how they look. Answer from how far the run has come and how the "
        + "player's build is doing. The ramp caps how far this can go; this is where inside that it sits.",
      options: (rampFor(roomIndex).subspecies ? ["none", "some", "many"] : ["none"])
        .filter((w) => w !== "many" || roomIndex >= 6)
        .map((w) => ({ ...opt(w, SUBSPECIES_WEIGHT[w]!), spec: SUBSPECIES_WEIGHT_SPEC[w]! })),
      style,
    }),
    /*
     * How many elites a **normal** room hides. An elite room is not asked: its
     * door already promised elites, so there is nothing left to prefer.
     */
    elite_presence: choiceQuestion({
      labels,
      instructions:
        "Choose how many enraged bodies this room hides, from the player's health and how the last rooms "
        + "went. An enraged body is the same fight at twice the health and a little more damage, and it "
        + "drops a heal and a coin when it falls.",
      options: (room.room_type === "elite" ? ["none"] : rampElitePresence(roomIndex))
        .map((p) => ({ ...opt(p, ELITE_PRESENCE[p]!), spec: ELITE_PRESENCE_SPEC[p]! })),
      style,
    }),
  };
  /*
   * **A question with one option is not asked.** The ramp leaves the opening
   * rooms a single anchor, and an elite room a single elite presence; asked
   * anyway, Jev declines a choice that is no choice, the room reads
   * "declined: anchor" and the request carries a question for nothing. The one
   * option is the answer, and the profile's own fallback (`pickProfile`)
   * applies it. Density is not one of these any more — rooms 1 and 2 choose
   * between sparse and normal, because the body caps that make the opening
   * gentle are the crowd and the hit, not the count (005's ramp).
   */
  for (const [name, q] of Object.entries(questions))
    if (offeredKeys(q).length < 2) delete questions[name];
  return questions;
}

/**
 * **Easing off runs at most `SPARSE_RUN_MAX` rooms.** The densities offered,
 * less `sparse` once that many fights running have been sparse. A player who
 * kept getting hurt was answered with a sparse room after almost every fight
 * — four of the last five before the king, five and four bodies each, a
 * quarter-minute long — and the run's climb went flat where it should rise.
 * Both arms read "hurt" the same way and neither can see a run of answers,
 * so the run is capped in code (finding 5), as the doors' streaks are. When
 * only one density is left the question is not asked and that one is the
 * room's.
 */
const SPARSE_RUN_MAX = 2;

function densitiesOffered(ctx: RunContext, roomIndex: number, capRuns = true): Density[] {
  const all = densitiesFor(roomIndex);
  if (!capRuns) return all;
  const recent = ctx.history.profiles.slice(-SPARSE_RUN_MAX);
  if (recent.length < SPARSE_RUN_MAX || recent.some((p) => p.density !== "sparse")) return all;
  const kept = all.filter((d) => d !== "sparse");
  return kept.length > 0 ? kept : all;
}

/** The densities this point in the run allows, in the question's order. */
function densitiesFor(roomIndex: number): Density[] {
  const allowed = new Set<string>(rampDensities(roomIndex));
  const kept = (["sparse", "normal", "dense"] as const).filter((d) => allowed.has(d));
  // The ramp always allows at least `sparse`; the guard is for a future step
  // that allows none, which would be a question with no options.
  return kept.length > 0 ? [...kept] : ["sparse"];
}

/** The anchors this point in the run allows, narrowed further by the band. */
function anchorsFor(roomIndex: number, topBand: boolean): Anchor[] {
  const allowed = new Set<string>(rampAnchors(roomIndex));
  const byBand: readonly Anchor[] = topBand ? ["none", "tank", "summoner"] : ["none", "tank"];
  const kept = byBand.filter((a) => allowed.has(a));
  return kept.length > 0 ? [...kept] : ["none"];
}

/**
 * How many rounds a fight plays (doc 014): a release room one, every other
 * room two. A code rule, not a question — it is how long a room is, which
 * is the pacing unit the whole run is sized against, and each round is still
 * the profile Jev chose.
 */
export function roundsFor(roomType: RoomType, tension: Tension): number {
  // Played, three rounds of a build room went on and on; a release room is a
  // breather and plays once. Two rounds everywhere else.
  if (roomType === "elite") return 2;
  return tension === "release" ? 1 : 2;
}

function pickProfile(
  r2: { dists: Record<string, Distribution>; source: DecisionSource; path?: string },
  rng: Rng,
  decisions: Decision[],
  decideFn: DecideFn,
  /** Defaults for a question that was not answered; must be ramp-legal. */
  fallbacks: { density: Density; anchor: Anchor },
  /** The last room's anchor, which this one's is drawn away from. */
  lastAnchor?: Anchor,
): EncounterProfile {
  const get = (name: string, fallback: string, avoid?: string) => {
    const dist = r2.dists[name];
    if (!dist) return fallback;
    /*
     * **The anchor alternates in code**, like the look (`LOOK_REPEAT_PENALTY`).
     *
     * Whether a room has a body worth killing first is the one encounter
     * decision that is about the *run* rather than about the room: an anchored
     * room only reads as one against a plain one. That argument used to be in
     * the question's instructions — "a run needs both, or the rooms that do
     * have something to aim at stop reading as different" — and it is finding
     * 4's mistake, a sentence in the instructions making one option's case,
     * with `none` the option it made it for. Removing it was right and it was
     * not enough: measured on eight seeds before and after, `none` took 85%
     * of rooms and then 87%. A classifier cannot alternate, however it is
     * asked (finding 5).
     *
     * So the argument is gone from the prose and the mechanism is here: the
     * answer the last room used keeps a third of its mass. Nothing is
     * forbidden, and a run of plain rooms is still reachable — it just has to
     * be chosen again each time rather than by default.
     */
    const tuned = avoid && avoid in dist && Object.keys(dist).length > 1
      ? reweight(dist, (id) => (id === avoid ? LOOK_REPEAT_PENALTY : 1))
      : undefined;
    const d = decideFn(name, r2.dists, r2.source, rng, TEMPERATURE.encounter, r2.path, tuned);
    decisions.push(d);
    return d.choice;
  };
  /*
   * **The two slots, from one ranking.** Distinct by construction, in the
   * order the Director wanted them, and `none` stops the list: first means a
   * room of plain bodies, second means a room with one variant in it.
   */
  /*
   * **The weight is the yes-or-no**, so it is read first and an answer of
   * `none` means the slate is not used at all. The two questions only mean
   * anything together (doc 002: a cross-question constraint is code), and
   * this is that constraint stated once instead of `none` appearing as an
   * option in both lists.
   */
  const weight = get("subspecies_weight", "none") as SubspeciesWeight;
  const subspecies = weight === "none"
    ? []
    : rankTop(r2, "subspecies", rng, decisions, decideFn, SUBSPECIES_SLOTS) as EnemyId[];
  return {
    composition: get("composition", "mixed") as EncounterProfile["composition"],
    density: get("density", fallbacks.density) as EncounterProfile["density"],
    wave_structure: get("wave_structure", "steady") as EncounterProfile["wave_structure"],
    anchor: get("anchor", fallbacks.anchor, lastAnchor) as EncounterProfile["anchor"],
    entry: get("entry", "far_front") as EncounterProfile["entry"],
    subspecies,
    // A weight with nothing to weigh, or a slate with no weight, is `none`:
    // the two answers only mean anything together (doc 002, cross-question
    // constraints are code).
    subspecies_weight: subspecies.length === 0 ? "none" : weight,
    elite_presence: get("elite_presence", "none") as ElitePresence,
  };
}

type DecideFn = (
  name: string, dists: Record<string, Distribution>, source: DecisionSource,
  rng: Rng, temperature: number, path?: string, override?: Distribution,
) => Decision;

/** How many kinds of variant body one room may hold (doc 019). */
export const SUBSPECIES_SLOTS = 2;

/**
 * **The top `n` distinct answers to a question**, sampled without replacement
 * at the ranking temperature, with `none` and the escape option acting as
 * stops.
 *
 * This is the shape every question that fills several slots now takes: single
 * options, one ranking, code assigns the slots. A question that offered
 * pre-built *combinations* asked Jev to compare bundles that mostly overlap,
 * and threw away the one thing the answer should carry — which of them the
 * room wants most.
 */
function rankTop(
  answer: { dists: Record<string, Distribution>; source: DecisionSource; path?: string },
  name: string,
  rng: Rng,
  decisions: Decision[],
  decideFn: DecideFn,
  n: number,
): string[] {
  const raw = answer.dists[name];
  if (!raw) return [];
  const tuned = withTemperature(raw, PORTAL_NEED_TEMPERATURE);
  const ranked = sampleWithoutReplacement(tuned, Object.keys(tuned).length, rng);
  const out: string[] = [];
  for (const pick of ranked) {
    if (out.length >= n) break;
    // `none` is where the list stops, and so is the escape option: both mean
    // "nothing more belongs here".
    if (pick === "none" || pick === FALLBACK) break;
    if (!out.includes(pick)) out.push(pick);
  }
  void decideFn;
  decisions.push({
    choice: out.join(" > ") || "none",
    probabilities: tuned,
    confidence: null,
    source: answer.source,
    question: name,
    ...(answer.path ? { fallback_path: answer.path as Decision["fallback_path"] } : {}),
  });
  return out;
}

function blend(overall: Distribution, style: Distribution, needs: Distribution, w: number): Distribution {
  const keys = new Set([...Object.keys(overall), ...Object.keys(style), ...Object.keys(needs)]);
  const out: Record<string, number> = {};
  let total = 0;
  for (const k of keys) {
    const v = 0.5 * (overall[k] ?? 0) + 0.5 * w * (style[k] ?? 0) + 0.5 * (1 - w) * (needs[k] ?? 0);
    out[k] = v;
    total += v;
  }
  if (total <= 0) return Object.fromEntries([...keys].map((k) => [k, 1 / keys.size]));
  for (const k of keys) out[k]! /= total;
  return out;
}

export { ITEMS, PRESSURE_BANDS, PLAYABLE_ARCHETYPES };
