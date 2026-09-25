/**
 * The affix intent (design doc 007), on the control arm.
 *
 * It is tested here rather than in `offer.test.ts` because the thing under
 * test is not that an offer comes out — that was always true — but that the
 * decision now exists and that it *moves* the offer. Before this, the question
 * had weights and no question: `affix_intent` was written into every plan as
 * `"none"`, so an affix offer for a freezing build and one for a spam build
 * were drawn from the same distribution.
 */
import { describe, expect, it } from "vitest";
import {
  ITEMS, MAX_HEARTS, RngSource, bucketClearSpeed, bucketGold, bucketHealth,
  bucketMovementPressure, bucketRecentDamage, bucketRunProgress, cardPool, gapOf, emptyHistory,
  plainInstance, heldDominantTags, SPELL_SHAPES,
} from "@jr/core";
import type { Archetype, CardPool, RunContext } from "@jr/core";
import { createDirector } from "./director.ts";
import { AFFIX_INTENTS, AFFIX_LANES, laneFromText, laneOf } from "./questions/affixes.ts";

function ctx(over: { preset?: Archetype; text?: string; hearts?: number; seed?: string } = {}): RunContext {
  const staff = { slots: 6, mana_max: 120 };
  const slots = [plainInstance("magic_bolt"), plainInstance("spark_spray"), null];
  const seed = over.seed ?? "affix-intent";
  return {
    run_id: seed, seed, room_index: 7,
    labels: {
      health: bucketHealth(over.hearts ?? MAX_HEARTS),
      recent_damage: bucketRecentDamage(0),
      clear_speed: bucketClearSpeed(30_000, 30_000),
      movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(7),
      gold: bucketGold(40),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "on_plan" },
    },
    staff, slots, inventory: [], history: emptyHistory(),
    intent: { preset: over.preset ?? "spam", ...(over.text ? { free_text: over.text } : {}) },
  };
}

function affixPool(c: RunContext): CardPool {
  return cardPool(ITEMS, [], "affix", [{ shape: "bolt", count: 1, affixes: [] }], {}, {
    style: c.intent.preset, revealed: c.labels.preference.dominant,
    gap: gapOf(c.labels.observed),
  });
}

/** The affixes offered over many rooms, and how often each lane appeared. */
async function offers(c: (seed: string) => RunContext, n = 120) {
  const director = createDirector("rule");
  const ids: string[] = [];
  const lanes = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const run = c(`a${i}`);
    const plan = await director.planCards({ ...run, room_index: i % 12 }, {
      room_index: i % 12, pool: affixPool(run), count: 3, pity: false, temptation: false,
    });
    ids.push(...plan.ids);
    if (plan.affix_intent) lanes.set(plan.affix_intent, (lanes.get(plan.affix_intent) ?? 0) + 1);
  }
  return { ids, lanes };
}

const shareOfLane = (ids: readonly string[], lane: string) =>
  ids.filter((id) => laneOf(id) === lane).length / Math.max(1, ids.length);

describe("the affix intent (doc 007)", () => {
  it("covers every affix exactly once, so a lane names a real set", () => {
    const seen = new Map<string, number>();
    for (const intent of AFFIX_INTENTS)
      for (const id of AFFIX_LANES[intent].affixes) seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const [id, n] of seen) expect(n, `${id} is in more than one lane`).toBe(1);
    // Every affix the game can offer belongs somewhere, or its lane can never
    // be chosen and the reweight silently skips it.
    const all = cardPool(ITEMS, [], "affix", SPELL_SHAPES.map((shape) => ({ shape, count: 1, affixes: [] })), {}, {}).candidates;
    for (const c of all) expect(laneOf(c.id), `${c.id} is in no lane`).not.toBeNull();
  });

  it("is asked for an affix offer and not for a spell or stat one", async () => {
    const director = createDirector("rule");
    const c = ctx();
    const affix = await director.planCards(c, {
      room_index: 7, pool: affixPool(c), count: 3, pity: false, temptation: false,
    });
    expect(affix.affix_intent).not.toBeNull();
    expect(affix.decisions.some((d) => d.question === "affix_intent")).toBe(true);

    const spells = cardPool(ITEMS, [], "spell", [], {}, {});
    const spell = await director.planCards(c, {
      room_index: 7, pool: spells, count: 3, pity: false, temptation: false,
    });
    expect(spell.affix_intent).toBeNull();
    expect(spell.decisions.some((d) => d.question === "affix_intent")).toBe(false);
  });

  it("leaves every legal affix in the pool: a lane tilts the offer, it does not filter it", async () => {
    const { ids } = await offers((seed) => ctx({ seed, text: "freeze everything" }));
    const offered = new Set(ids);
    // Every lane shows up somewhere over a hundred offers, including the four
    // that the chosen lane weighs *down*.
    for (const intent of AFFIX_INTENTS)
      expect([...offered].some((id) => laneOf(id) === intent), `no ${intent} affix was ever offered`).toBe(true);
  });

  it("follows the player's typed words: freezing and shattering pulls the elemental lane", () => {
    expect(laneFromText("I want to freeze things and shatter them")).toBe("elemental");
    expect(laneFromText("burn everything down")).toBe("elemental");
    expect(laneFromText("I keep running out of mana")).toBe("cheaper");
    expect(laneFromText("I can never hit anything")).toBe("homing");
    expect(laneFromText("get me in sword range")).toBe("survival");
    expect(laneFromText("one big hit")).toBe("heavier");
    expect(laneFromText(undefined)).toBeNull();
    expect(laneFromText("something with no keywords at all")).toBeNull();
  });

  it("skews the offer toward the words the player typed", async () => {
    const frozen = await offers((seed) => ctx({ seed, text: "I want to freeze things and shatter them" }));
    const plain = await offers((seed) => ctx({ seed }));
    // The lane the words name is the one chosen most often...
    const modal = [...frozen.lanes].sort((a, b) => b[1] - a[1])[0];
    expect(modal?.[0]).toBe("elemental");
    expect((frozen.lanes.get("elemental") ?? 0) / 120).toBeGreaterThan(0.3);
    // ...and that shows up in the cards, which is the point of the question.
    expect(shareOfLane(frozen.ids, "elemental")).toBeGreaterThan(shareOfLane(plain.ids, "elemental"));
  });

  it("skews the offer toward the stated style when no words were typed", async () => {
    const melee = await offers((seed) => ctx({ seed, preset: "melee" }));
    const spam = await offers((seed) => ctx({ seed, preset: "spam" }));
    expect(shareOfLane(melee.ids, "survival")).toBeGreaterThan(shareOfLane(spam.ids, "survival"));
    expect(shareOfLane(spam.ids, "cheaper")).toBeGreaterThan(shareOfLane(melee.ids, "cheaper"));
  });

  it("answers a hurt player with the lane that keeps them alive", async () => {
    const hurt = await offers((seed) => ctx({ seed, hearts: 1 }), 80);
    const well = await offers((seed) => ctx({ seed, hearts: MAX_HEARTS }), 80);
    expect(hurt.lanes.get("survival") ?? 0).toBeGreaterThan(well.lanes.get("survival") ?? 0);
  });

  it("samples rather than deciding: one lane never takes every offer", async () => {
    const { lanes } = await offers((seed) => ctx({ seed, text: "freeze" }));
    expect(lanes.size, "the lane is argmax, not a sample").toBeGreaterThan(1);
  });
});

/** Kept honest: the seed stream is the reward stream, so offers differ per room. */
it("draws from the reward stream, so two rooms of one run differ", () => {
  const a = new RngSource("x").stream("reward", 1, null).next();
  const b = new RngSource("x").stream("reward", 2, null).next();
  expect(a).not.toBe(b);
});
