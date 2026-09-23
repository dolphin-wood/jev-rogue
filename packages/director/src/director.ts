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
  BASE_ITEMS, ITEMS, PRESSURE_BANDS, RngSource,
  affixedInstance, assembleEncounterDetailed, applyEliteAffixes, affixContext, enumerateAffixSets,
  bandForRoom, counterScore, filterForCharter,
  generateRoom, legalDoorSets, pacingLabels, resolveAffixTable, sampleOne,
  sampleUniform, sampleWithoutReplacement, staffFor, toRoomPlan, withTemperature,
  allowedTensions, PLAYABLE_ARCHETYPES, rankIn, FEATURES,
  assemblePortals, kindSetKey, parseKindSetKey, SCHOOL_OF,
} from "@jr/core";
import type {
  BaseItem, CounterScore, Distribution, EncounterProfile, ItemInstance, RoomPlan,
  RoomType, Rng, RunContext, SpaceArchetypeId, Tension,
  PortalChoices, RewardCardKind, SpellSchool, StatFamily, NpcKind,
} from "@jr/core";
import { EvaluatorError } from "./types.ts";
import type { ChoiceQuestion, Decision, DecisionSource, RequestMeta } from "./types.ts";
import type { DistributionSource } from "./source.ts";
import { flatTable, jevSource, tableSource } from "./source.ts";
import { ruleTable } from "./weights.ts";
import { choiceQuestion, clampFreeText, INTENT_CLAUSE } from "./questions/common.ts";
import {
  buildRoomQuestions, buildZoneQuestions, moodFrom, roomRound1State, roomRound2State,
  spaceOptions, zoneQuestionName, ROOM_TEMPERATURES, ZONE_TEMPERATURE, coverOfArchetype,
} from "./questions/room.ts";
import { labelSet } from "./describe.ts";
import type {
  CardOrigin, CardPlan, CardRequest, DoorPlan, DoorRef, OfferPlan, OfferRequest, PortalPlan, RewardPlan,
  RoomPlanResult, OfferCard,
} from "./plans.ts";
import { doorSetKey, parseDoorSetKey } from "./questions/doors.ts";

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
  planRoom(ctx: RunContext, door: DoorRef, tension: Tension, alongside?: OfferRequest): Promise<RoomPlanResult>;
  planRewards(ctx: RunContext, roomType: RoomType): Promise<RewardPlan>;
  /** Doc 003's per-portal question, over the legal answers code enumerated. */
  planPortals(ctx: RunContext, choices: PortalChoices): Promise<PortalPlan>;
  /** Doc 007's offer, over the legal cards code enumerated for one reward kind. */
  planCards(ctx: RunContext, req: CardRequest): Promise<CardPlan>;
  /** Portals and card offers in one request, for a room with no room plan to ride on (a vendor's). */
  planOffer(ctx: RunContext, req: OfferRequest): Promise<OfferPlan>;
}

export interface DirectorDeps {
  readonly evaluate?: import("./types.ts").Evaluator;
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
  readonly questions: Readonly<Record<string, ChoiceQuestion>>;
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
  readonly questions: Record<string, ChoiceQuestion>;
  readonly state: Record<string, unknown>;
  finish(answer: { dists: Record<string, Distribution>; source: DecisionSource; path?: string }): T;
}

const TEMPERATURE = {
  door_set: 0.7, next_tension: 0.6, encounter: 0.7, reward: 0.9, portal: 0.8,
} as const;

/** Blend weight on style rather than needs, by run progress (doc 007). */
const STYLE_WEIGHT: Record<string, number> = { early: 0.35, mid: 0.25, late: 0.15, pre_boss: 0.15 };
const VARIETY_TEMPERATURE = { low: 0.4, medium: 0.7, high: 1.0 } as const;

export function createDirector(mode: DirectorArm, deps: DirectorDeps = {}): Director {
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
  /** The questions in an answer that the rule table filled because Jev declined them. */
  const declinedIn = new WeakMap<Record<string, Distribution>, ReadonlySet<string>>();

  async function ask(
    questions: Record<string, ChoiceQuestion>,
    state: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<{ dists: Record<string, Distribution>; source: DecisionSource; path?: string }> {
    if (Object.keys(questions).length === 0)
      return { dists: {}, source: primary.kind };
    const use = consecutiveFailures >= 3 && mode === "jev" ? fallback : primary;
    const seen = (dists: Record<string, Distribution>, source: DecisionSource, path?: string) => {
      try {
        deps.observe?.({ meta, state, questions, dists, source, ...(path ? { fallback_path: path } : {}) });
      } catch { /* a readout never breaks a plan */ }
    };
    try {
      const r = await use.distributions(questions, state, meta, signal);
      if (use.kind === "jev") consecutiveFailures = 0;
      const dists = { ...r.dists };
      if (r.declined?.length) {
        // A declined question goes to the rule table alone; the request's
        // other answers stand (doc 002).
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
      seen({ ...r.dists }, fallback.kind, path);
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
  ): Decision {
    const dist = dists[name];
    if (!dist) throw new Error(`no distribution for "${name}"`);
    if (declinedIn.get(dists)?.has(name)) { source = fallback.kind; path = "declined"; }
    const tuned = withTemperature(dist, temperature);
    const choice = sampleOne(tuned, rng);
    return {
      choice, probabilities: tuned, confidence: null, source, question: name,
      ...(path ? { fallback_path: path as Decision["fallback_path"] } : {}),
    };
  }

  /**
   * Doc 003's per-portal questions, and how their answers become portals.
   * Split from the request so the questions can ride in another request
   * that shares their state (`planRoom`'s round 1); `planPortals` asks them
   * alone.
   */
  function portalAsk(ctx: RunContext, choices: PortalChoices): Asked<PortalPlan> {
    const labels = labelSet(ctx.labels as unknown as Record<string, unknown>);
    const opt = (id: string, description: string) => ({ id, description });
    const questions: Record<string, ChoiceQuestion> = {
      portal_kinds: choiceQuestion({
        labels,
        instructions:
          "Choose which rewards the portals out of this room offer, one kind per portal. Stat upgrades " +
          "movement, survival, mana or the sword; spell is a new castable; affix modifies a held spell; " +
          "gold is spent at the merchant. Weigh health, gold and what the build lacks. " + INTENT_CLAUSE,
        options: choices.kindSets.map((set) => opt(kindSetKey(set), `${set.join(", ")}.`)),
      }),
      spell_school: choiceQuestion({
        labels,
        instructions: "If a portal offers a spell, which school should it promise? Favour the player's style.",
        options: choices.schools.map((sc) => opt(sc, `${sc} spells: ${schoolSpells(sc)}.`)),
      }),
      stat_family: choiceQuestion({
        labels,
        instructions: "If a portal offers a stat, which family should it promise? Survival when hurt, mana when mana is tight.",
        options: choices.families.map((f) => opt(f, FAMILY_TEXT[f] ?? `${f} upgrades.`)),
      }),
    };
    if (choices.elite) {
      questions.elite_portal = choiceQuestion({
        labels,
        instructions: "Choose whether one of these portals leads to an elite fight, harder and graded up, from how the player is doing.",
        options: [
          opt("none", "Every portal is a normal fight. Fits a hurt player, heavy recent damage, or slow clears."),
          opt("elite", "One portal is an elite fight: harder, for a better reward. Fits health full or ok with fast or normal clears."),
        ],
      });
      questions.elite_kind = choiceQuestion({
        labels,
        instructions: "If one portal is elite, which reward should sit behind the harder fight?",
        options: ["stat", "spell", "affix", "gold"].map((k) => opt(k, `The ${k} portal is the elite one.`)),
      });
      questions.elite_grade = choiceQuestion({
        labels,
        instructions: "Choose how much better the elite portal's reward is, from how the player is doing.",
        options: [
          opt("2", "Graded up once. Fits a player who is doing well: clears fast, health full or ok."),
          opt("3", "Graded up twice, the best roll. Fits a player who is behind: clears slowly or has taken heavy damage, and needs the harder fight to pay."),
        ],
      });
    }
    if (choices.lateGrade)
      questions.normal_grade = choiceQuestion({
        labels,
        instructions: "Choose whether the normal portals' rewards are graded up this late in the run, from how the player is doing.",
        options: [
          opt("1", "Ordinary rewards. Fits a player who is doing well: clears fast, health full or ok."),
          opt("2", "Graded up once. Fits a player who is behind: clears slowly or has taken heavy damage, and must catch up before the boss."),
        ],
      });
    if (choices.npc)
      questions.npc_room = choiceQuestion({
        labels,
        // How often a vendor may appear is capped in code (`portalChoices`);
        // the question is only whether one fits now, and which.
        instructions:
          "Does one portal lead to a vendor instead of a fight? A vendor trades gold for power, so it is " +
          "only worth a portal when there is gold to spend.",
        options: [
          opt("none", "No vendor; every portal is a fight. Fits when gold is poor, or when the player wants fights."),
          opt("merchant", "One portal leads to the merchant, who sells a new card for gold. Fits when gold is ok or rich and the build still lacks pieces."),
          opt("smith", "One portal leads to the blacksmith, who raises a held spell's level for gold. Fits when gold is ok or rich and the build is already set, late in the run."),
        ],
      });

    return {
      questions,
      state: { portal_count: String(choices.count) },
      finish({ dists, source, path }) {
        const rng = new RngSource(ctx.seed).stream("portals", ctx.room_index);
        const decisions: Decision[] = [];
        const take = (name: string, temp = TEMPERATURE.portal) => {
          const d = decide(name, dists, source, rng, temp, path);
          decisions.push(d);
          return d.choice;
        };
        const kinds = parseKindSetKey(take("portal_kinds"));
        const school = take("spell_school") as SpellSchool;
        const family = take("stat_family") as StatFamily;
        let eliteKind: RewardCardKind | null = null;
        let eliteGrade: 2 | 3 = 2;
        if (choices.elite && take("elite_portal") === "elite") {
          // The elite kind is sampled among the kinds actually on offer: code
          // renormalises the answer rather than asking a question that depends
          // on another question's answer (doc 002: questions are independent).
          const d = restrictTo(dists.elite_kind!, kinds);
          const pick = sampleOne(withTemperature(d, TEMPERATURE.portal), rng);
          decisions.push({ choice: pick, probabilities: d, confidence: null, source, question: "elite_kind" });
          eliteKind = pick as RewardCardKind;
          eliteGrade = take("elite_grade") === "3" ? 3 : 2;
        }
        const normalGrade = choices.lateGrade && take("normal_grade") === "2" ? 2 : 1;
        const npc = choices.npc ? take("npc_room") : "none";
        const doors = assemblePortals({
          kinds, eliteKind, eliteGrade, normalGrade, school, family,
          npc: npc === "none" ? null : (npc as NpcKind),
        });
        return { room_index: ctx.room_index, doors, source, decisions };
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
      room_index: ctx.room_index, blended: {}, variety: "medium" as const, source: "rule" as const, decisions: [],
    };
    if (want <= 0 || pool.candidates.length === 0)
      return { done: { ...empty, ids: forced, origins: forced.map(() => "forced" as const) } };
    if (pool.candidates.length <= want) {
      const ids = [...forced, ...pool.candidates.map((c) => c.id)];
      return { done: { ...empty, ids, origins: ids.map((id) => (forced.includes(id) ? "forced" : "sampled") as CardOrigin) } };
    }

    const labels = labelSet(ctx.labels as unknown as Record<string, unknown>);
    const shared = { options: pool.candidates.map((c) => ({ id: c.id, description: c.description })), labels };
    const what = pool.kind === "spell" ? "spell" : pool.kind === "stat" ? "stat upgrade" : "affix";
    const offStyle = pool.candidates.filter((c) => !c.facts.includes("style"));
    const named: Record<string, ChoiceQuestion> = {
      overall: choiceQuestion({
        ...shared,
        instructions:
          `Which ${what} most deserves to appear in this offer, weighing intent, actual preference and ` +
          "build needs together? " + INTENT_CLAUSE,
      }),
      for_style: choiceQuestion({ ...shared, short: true, instructions: `Which ${what} best matches the player's stated and revealed style, ignoring build needs?` }),
      for_needs: choiceQuestion({ ...shared, short: true, instructions: `Which ${what} best addresses what the build lacks right now, ignoring style?` }),
      variety: choiceQuestion({
        labels,
        instructions:
          "How much surprise does this player need in this offer? High when they have pivoted or the " +
          "build is mixed; low when they are on plan with a clear bottleneck.",
        options: [
          { id: "low", description: "Offer what the build obviously wants." },
          { id: "medium", description: "Mostly on target with some spread." },
          { id: "high", description: "Spread widely; the player is exploring." },
        ],
      }),
    };
    if (req.temptation && offStyle.length >= 2)
      named.temptation = choiceQuestion({
        options: offStyle.map((c) => ({ id: c.id, description: c.description })), labels,
        instructions: `Which of these off-style ${what}s would most tempt this player to deviate from their plan?`,
      });

    const questions = Object.fromEntries(Object.entries(named).map(([k, q]) => [`${prefix}${k}`, q]));
    const facts = Object.fromEntries(pool.candidates.map((c) => [c.id, c.facts.join(" ") || "plain"]));
    return {
      questions,
      state: { [`${prefix}reward_kind`]: pool.kind, [`${prefix}card_facts`]: facts },
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
        const blended = blend(dists.overall!, dists.for_style!, dists.for_needs!, w);
        const tuned = withTemperature(blended, VARIETY_TEMPERATURE[variety]);

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
        return { room_index: ctx.room_index, ids, origins, blended, variety, source, decisions };
      },
    };
  }

  /** Portals and card offers as one set of questions; see `OfferRequest`. */
  function offerAsk(ctx: RunContext, req: OfferRequest): Asked<OfferPlan> {
    const portals = req.portals ? portalAsk(ctx, req.portals) : null;
    const cards = (req.cards ?? []).map((c) => cardAsk(ctx, c, c.salt ? `${c.salt}__` : ""));
    const asked = cards.filter((c): c is Asked<CardPlan> => !("done" in c));
    const parts = [...(portals ? [portals] : []), ...asked];
    return {
      questions: mergeQuestions(parts.map((p) => p.questions)),
      state: Object.assign({}, ...parts.map((p) => p.state)),
      finish(answer) {
        return {
          ...(portals ? { portals: portals.finish(answer) } : {}),
          cards: cards.map((c) => ("done" in c ? c.done : c.finish(answer))),
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
    async planDoors(ctx) {
      const pacing = pacingLabels({
        room_index: ctx.room_index, history: ctx.history,
        health: ctx.labels.health, recent_damage: ctx.labels.recent_damage,
        rest_owed: restOwed(ctx), tensions: ctx.history.tensions,
      });
      const tensions = allowedTensions(pacing.tension_cap);
      const labels = labelSet(ctx.labels as unknown as Record<string, unknown>);

      const questions: Record<string, ChoiceQuestion> = {};
      if (tensions.length > 1)
        questions.next_tension = choiceQuestion({
          instructions:
            "Choose the intended intensity of the next combat room, within the permitted range. " +
            "After heavy damage lean to release; after fast clears lean to build or peak.",
          options: tensions.map((t) => ({ id: t, description: TENSION_TEXT[t] })),
          labels,
        });

      const meta: RequestMeta = { run_id: ctx.run_id, room_index: ctx.room_index, door_slot: null, round: 1, purpose: "doors" };
      const { dists, source, path } = await ask(questions, flatState(ctx, { ...pacing }), meta);
      const rng = new RngSource(ctx.seed).stream("decision", ctx.room_index, null, 1);

      const tensionD = tensions.length > 1
        ? decide("next_tension", dists, source, rng, TEMPERATURE.next_tension, path)
        : { choice: tensions[0]!, probabilities: { [tensions[0]!]: 1 }, confidence: null, source: "rule" as const, question: "next_tension" };

      return {
        room_index: ctx.room_index,
        sets_offered: [],
        tension: tensionD.choice as Tension,
        source: { door_set: "rule", tension: tensionD.source },
        decisions: [tensionD],
      };
    },

    async planRoom(ctx, door, tension, alongside) {
      const pacing = pacingLabels({
        room_index: ctx.room_index, history: ctx.history,
        health: ctx.labels.health, recent_damage: ctx.labels.recent_damage,
        rest_owed: restOwed(ctx), tensions: ctx.history.tensions,
      });
      const entry: "N" | "E" | "S" | "W" = "S";
      const spaces = spaceOptions({ last_spaces: ctx.history.spaces, entry_side: entry });
      const state1 = roomRound1State({
        room_type: door.room_type, tension, labels: ctx.labels, last_spaces: ctx.history.spaces,
      });
      const q1 = buildRoomQuestions({ spaces, state: state1, labels: ctx.labels });
      const meta1: RequestMeta = {
        run_id: ctx.run_id, room_index: ctx.room_index, door_slot: door.door_slot, round: 1, purpose: "room",
      };
      // The offer rides in round 1: the same state, independent questions.
      const offerQ = alongside ? offerAsk(ctx, alongside) : null;
      const r1 = await ask(
        offerQ ? mergeQuestions([q1, offerQ.questions]) : q1,
        offerQ ? { ...flatState(ctx, offerQ.state), ...state1 } : state1 as unknown as Record<string, unknown>,
        meta1,
      );
      const offer = offerQ?.finish(r1);
      const rng1 = new RngSource(ctx.seed).stream("decision", ctx.room_index, door.door_slot, 1);

      const decisions: Decision[] = [];
      const pick = (name: string, temp: number) => {
        const d = decide(name, r1.dists, r1.source, rng1, temp, r1.path);
        decisions.push(d);
        return d.choice;
      };
      const space = pick("space", ROOM_TEMPERATURES.space ?? 0.8) as SpaceArchetypeId;
      const symmetry = pick("symmetry", ROOM_TEMPERATURES.symmetry ?? 0.9) as "mirrored" | "asymmetric";
      const mood = moodFrom({
        temperature: pick("mood_temperature", ROOM_TEMPERATURES.mood_temperature ?? 0.9),
        brightness: pick("mood_brightness", ROOM_TEMPERATURES.mood_brightness ?? 0.9),
        particles: pick("mood_particles", ROOM_TEMPERATURES.mood_particles ?? 0.9),
      });

      // The last two outlines are kept out of the draw (doc 004, "Skeletons").
      const generated = generateRoom({ space, symmetry, mood }, entry, door.room_type, rng1, {
        avoid: (ctx.history.skeletons ?? []).slice(0, 2),
      });
      const base = toRoomPlan(generated, {
        id: `${ctx.run_id}/${ctx.room_index}/${door.door_slot}`,
        seed_key: `decision:${ctx.room_index}:${door.door_slot}`,
        reward_kind: "item",
        params_source: r1.source,
      });

      // Round 2 sees the room that exists, not the one that was asked for.
      const state2 = roomRound2State(state1, base);
      const q2: Record<string, ChoiceQuestion> = {
        ...buildZoneQuestions({ zones: base.zones, hazard_cap: pacing.hazard_cap, state: state2, labels: ctx.labels }),
        ...encounterQuestions(ctx, base, tension),
      };
      const meta2: RequestMeta = { ...meta1, round: 2 };
      const r2 = await ask(q2, state2 as unknown as Record<string, unknown>, meta2);
      const rng2 = new RngSource(ctx.seed).stream("decision", ctx.room_index, door.door_slot, 2);

      const zones = base.zones.map((z) => {
        const name = zoneQuestionName(z.id);
        if (!r2.dists[name]) return z;
        const d = decide(name, r2.dists, r2.source, rng2, ZONE_TEMPERATURE, r2.path);
        decisions.push(d);
        return { ...z, feature: d.choice };
      });

      const profile = { ...pickProfile(r2, rng2, decisions, decide), rounds: roundsFor(door.room_type, tension) };
      const band = bandForRoom({ room_type: door.room_type, tension, pressure_cap: ctx.labels.pressure_cap });
      const assembled = needsEncounter(door.room_type) && band
        ? assembleEncounterDetailed(profile, base, band, rng2, { source: r2.source })
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
        door, plan,
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

    async planOffer(ctx, req) {
      const q = offerAsk(ctx, req);
      const meta: RequestMeta = { run_id: ctx.run_id, room_index: ctx.room_index, door_slot: null, round: 1, purpose: "offer" };
      return q.finish(await ask(q.questions, flatState(ctx, q.state), meta));
    },

    async planPortals(ctx, choices) {
      const q = portalAsk(ctx, choices);
      const meta: RequestMeta = { run_id: ctx.run_id, room_index: ctx.room_index, door_slot: null, round: 1, purpose: "portals" };
      return q.finish(await ask(q.questions, flatState(ctx, q.state), meta));
    },

    async planCards(ctx, req) {
      const q = cardAsk(ctx, req);
      if ("done" in q) return q.done;
      const meta: RequestMeta = { run_id: ctx.run_id, room_index: ctx.room_index, door_slot: null, round: 1, purpose: `cards:${req.pool.kind}${req.salt ? `:${req.salt}` : ""}` };
      return q.finish(await ask(q.questions, flatState(ctx, q.state), meta));
    },

    async planRewards(ctx, roomType) {
      const pool = eligiblePool(ctx, roomType);
      const labels = labelSet(ctx.labels as unknown as Record<string, unknown>);
      const shared = {
        options: pool.map((i) => ({ id: i.id, description: i.description })),
        labels,
      };
      const questions: Record<string, ChoiceQuestion> = {
        overall: choiceQuestion({
          ...shared,
          instructions:
            "Which item most deserves to appear in this offer, weighing intent, actual preference and " +
            "build needs together? " + INTENT_CLAUSE,
        }),
        for_style: choiceQuestion({ ...shared, short: true, instructions: "Which item best matches the player's stated and revealed style, ignoring build needs?" }),
        for_needs: choiceQuestion({ ...shared, short: true, instructions: "Which item best addresses the build's bottleneck and missing roles, ignoring style?" }),
        variety: choiceQuestion({
          labels,
          instructions:
            "How much surprise does this player need in this offer? High when they have pivoted or the " +
            "build is mixed; low when they are on plan with a clear bottleneck.",
          options: [
            { id: "low", description: "Offer what the build obviously wants." },
            { id: "medium", description: "Mostly on target with some spread." },
            { id: "high", description: "Spread widely; the player is exploring." },
          ],
        }),
      };

      const meta: RequestMeta = { run_id: ctx.run_id, room_index: ctx.room_index, door_slot: null, round: 1, purpose: "rewards" };
      const { dists, source, path } = await ask(questions, flatState(ctx), meta);
      const rng = new RngSource(ctx.seed).stream("reward", ctx.room_index);
      const wildRng = new RngSource(ctx.seed).stream("wildcard", ctx.room_index);

      const decisions: Decision[] = [];
      const take = (name: string, temp: number) => {
        const d = decide(name, dists, source, rng, temp, path);
        decisions.push(d);
        return d;
      };
      const varietyD = take("variety", 1);
      const variety = varietyD.choice as keyof typeof VARIETY_TEMPERATURE;

      const w = STYLE_WEIGHT[ctx.labels.run_progress] ?? 0.25;
      const blended = blend(dists.overall!, dists.for_style!, dists.for_needs!, w);
      const tuned = withTemperature(blended, VARIETY_TEMPERATURE[variety]);

      const sampled = sampleWithoutReplacement(tuned, 2, rng);
      const wildcard = sampleUniform(pool.map((i) => i.id), sampled, wildRng);
      const chosen = [...sampled, ...(wildcard ? [wildcard] : [])];

      const table = resolveAffixTable();
      const offer: OfferCard[] = chosen.map((id, n) => {
        const item = itemFor(id, table);
        return {
          kind: "item", item,
          origin: n < sampled.length ? "sampled" : "wildcard",
          rank: rankIn(blended, id), blended: blended[id] ?? 0,
        };
      });
      while (offer.length < 3) offer.push({ kind: "gold", gold: 20, origin: "filler" });

      return {
        room_index: ctx.room_index, room_type: roomType, offer,
        ranks: offer.map((c) => (c.kind === "item" ? c.rank : -1)),
        blended, variety, affix_intent: "none", trimmed_items: [],
        pool: pool.map((i) => i.id),
        pity: { fired: false, role: null, skipped: false, source: null },
        temptation: { fired: false, base: null, unasked: false, source: null },
        source: { overall: source, style: source, needs: source, variety: source, affix_intent: "rule" },
        decisions,
      };
    },
  };
}

/* -------------------------------- helpers --------------------------------- */

/** A distribution cut down to some keys and renormalised; uniform if they held nothing. */
function restrictTo(d: Distribution, keys: readonly string[]): Distribution {
  const total = keys.reduce((a, k) => a + (d[k] ?? 0), 0);
  return Object.fromEntries(keys.map((k) => [k, total > 0 ? (d[k] ?? 0) / total : 1 / keys.length]));
}

/** The spells a school holds, named, for its option description. */
function schoolSpells(school: string): string {
  return Object.entries(SCHOOL_OF as Record<string, string>)
    .filter(([, sc]) => sc === school)
    .map(([id]) => id.replace(/_/g, " "))
    .join(", ");
}

const FAMILY_TEXT: Record<string, string> = {
  movement: "Movement: speed, dash cooldown, stride.",
  survival: "Survival: health, healing, steadier footing.",
  mana: "Mana: a deeper pool, faster regeneration, mana from hits.",
  sword: "Sword: damage, reach, swing speed.",
};


const notConfigured: import("./types.ts").Evaluator = async () => {
  throw new EvaluatorError("http", "jev mode needs an evaluator");
};

const TENSION_TEXT: Record<Tension, string> = {
  release: "Low intensity, a recovery room.",
  build: "Moderate intensity that keeps the run moving.",
  peak: "The hardest room the run currently allows.",
};

function describeSet(set: readonly RoomType[]): string {
  return `${set.length === 1 ? "A single door" : `${set.length} doors`}: ${set.join(", ")}.`;
}

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
function mergeQuestions(sets: readonly Record<string, ChoiceQuestion>[]): Record<string, ChoiceQuestion> {
  const out: Record<string, ChoiceQuestion> = {};
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
    run_progress: ctx.labels.run_progress,
    gold: ctx.labels.gold,
    build_range: ctx.labels.build.range,
    archetype: ctx.labels.build.archetype,
    bottleneck: ctx.labels.build.bottleneck,
    mana_sustain: ctx.labels.build.mana_sustain,
    consistency: ctx.labels.preference.consistency,
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

function encounterQuestions(ctx: RunContext, room: RoomPlan, tension: Tension): Record<string, ChoiceQuestion> {
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
      score: counterScore(c, ctx.labels.build.range, ctx.labels.build.archetype) as CounterScore,
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
    melee_heavy: "Mostly melee bodies that close in. Presses a long-range build; suits build and peak rooms.",
    ranged_heavy: "Mostly shooters that keep their distance. Presses a short-range build; suits build and peak rooms.",
    mixed: "An even mix of melee and ranged bodies. Presses nothing in particular; suits any room, and release most.",
    siege: "Slow, heavy bodies and turrets that hold ground: a long fight. Suits peak rooms with health to spare.",
  };
  const DENSITY: Record<string, string> = {
    sparse: "Few bodies: a breather. Suits release rooms, and a player with heavy recent damage.",
    normal: "A normal count. Suits build rooms.",
    dense: "Many bodies at once: the hardest crowd. Suits peak rooms with health full or ok.",
  };
  const WAVES: Record<string, string> = {
    single: "Everything arrives at once: one hard burst. Suits peak rooms.",
    two_waves: "A fight, a pause, then a second fight. Suits build rooms and elite rooms.",
    trickle: "A few bodies at a time, steadily. Suits release rooms and a hurt player.",
  };
  const ANCHOR: Record<string, string> = {
    none: "No priority target. Suits slow clears, low health, and release rooms.",
    tank: "A slow, armoured body worth focusing. Suits fast or normal clears in a build or peak room.",
    summoner: "A summoner that keeps adding bodies until it dies. Only for fast clears in a peak room.",
  };
  const ENTRY: Record<string, string> = {
    far_front: "From the far side: the most time to see them coming. Suits release rooms and a hurt player.",
    flanks: "From both sides at once: the player has to turn. Suits build rooms.",
    surround: "From all round: the hardest entry. Only with health full and little recent damage.",
    turrets_center: "Turrets in the middle with bodies round them: a fixed threat to work round.",
  };
  return {
    composition: choiceQuestion({
      labels,
      instructions: "Choose the enemy mix for this room, from its tension and the build's range.",
      options: (compositions.length ? compositions : (["mixed"] as const)).map((c) => opt(c, COMPOSITION[c]!)),
    }),
    density: choiceQuestion({
      labels,
      instructions: "Choose how many bodies this room holds, from its tension and the player's health and recent damage.",
      options: (["sparse", "normal", "dense"] as const).map((d) => opt(d, DENSITY[d]!)),
    }),
    wave_structure: choiceQuestion({
      labels,
      instructions: "Choose how the room releases its enemies, from its tension and the player's health.",
      /*
       * An elite room always has a second wave. A single burst let an elite
       * fight end in one exchange — the player read it, answered it, and it
       * was over — which is the easy version of the room the portal promised
       * was harder. A code constraint, so no answer can choose it.
       */
      options: (room.room_type === "elite" ? ["two_waves", "trickle"] as const : ["single", "two_waves", "trickle"] as const)
        .map((v) => opt(v, WAVES[v]!)),
    }),
    anchor: choiceQuestion({
      labels,
      instructions: "Choose whether the room has a priority target, from how fast the player clears rooms.",
      // A summoner outproduces a low-tier player's damage, so the room stops
      // ending rather than getting harder. Code keeps it to the top bands
      // instead of asking Jev to judge a soft-lock.
      options: ((tension === "peak" || room.room_type === "elite"
        ? ["none", "tank", "summoner"]
        : ["none", "tank"]) as readonly string[])
        .map((a) => opt(a, ANCHOR[a]!)),
    }),
    entry: choiceQuestion({
      labels,
      instructions: "Choose where the enemies arrive from, from the room's tension and the player's health.",
      options: (entries.length ? entries : (["far_front"] as const)).map((e) => opt(e, ENTRY[e]!)),
    }),
  };
}

/**
 * How many rounds a fight plays (doc 014): a build room three, every other
 * room two. A code rule, not a question — it is how long a room is, which
 * is the pacing unit the whole run is sized against, and each round is still
 * the profile Jev chose.
 */
export function roundsFor(roomType: RoomType, tension: Tension): number {
  if (roomType === "elite") return 2;
  // A peak is intense because it is short at its height; a build room is the
  // long one.
  return tension === "build" ? 3 : 2;
}

function pickProfile(
  r2: { dists: Record<string, Distribution>; source: DecisionSource; path?: string },
  rng: Rng,
  decisions: Decision[],
  decideFn: DecideFn,
): EncounterProfile {
  const get = (name: string, fallback: string) => {
    if (!r2.dists[name]) return fallback;
    const d = decideFn(name, r2.dists, r2.source, rng, TEMPERATURE.encounter, r2.path);
    decisions.push(d);
    return d.choice;
  };
  return {
    composition: get("composition", "mixed") as EncounterProfile["composition"],
    density: get("density", "normal") as EncounterProfile["density"],
    wave_structure: get("wave_structure", "two_waves") as EncounterProfile["wave_structure"],
    anchor: get("anchor", "none") as EncounterProfile["anchor"],
    entry: get("entry", "far_front") as EncounterProfile["entry"],
  };
}

type DecideFn = (
  name: string, dists: Record<string, Distribution>, source: DecisionSource,
  rng: Rng, temperature: number, path?: string,
) => Decision;

function eligiblePool(ctx: RunContext, roomType: RoomType): BaseItem[] {
  const owned = new Set(ctx.slots.flatMap((s) => (s ? [s.base] : [])).concat(ctx.inventory.map((i) => i.base)));
  const tiers = roomType === "elite" || roomType === "treasure"
    ? ["uncommon", "rare"] : ["common", "uncommon"];
  return BASE_ITEMS.filter((i) => tiers.includes(i.rarity) && !owned.has(i.id)).slice(0, 20);
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

let uid = 0;
function itemFor(base: string, _table: ReturnType<typeof resolveAffixTable>): ItemInstance {
  const def = BASE_ITEMS.find((i) => i.id === base)!;
  return { uid: `i${uid++}`, base, affix: null, magnitude: 1, modifier: null, rarity: def.rarity };
}

export { ITEMS, PRESSURE_BANDS, PLAYABLE_ARCHETYPES, affixedInstance };
