/**
 * **Every other sentence the Director writes for Jev, swept for verdicts.**
 *
 * `spell-text.test.ts` sweeps the cards: a spell's behaviour, its negative,
 * each affix's and stat's own text. The rest of what Jev reads is the door and
 * offer options, the room options, the style the player chose and the
 * instructions — and those carried the same kind of sentence long after the
 * cards were cleaned: "the only door that changes what the player can do at
 * all", "which is how three separate spells become one build", "the best roll
 * the game has", a composition read "from the build's range and the build's
 * archetype" (two labels removed as verdicts, doc 002) where "one that suits
 * it makes the room a showcase", and a style card reading "slow, expensive
 * spells that end fights". The standing rule (doc 006, doc 010 rule 2):
 * everything sent to Jev is a neutral fact — no verdict, no ranking against
 * the pool, no removed label.
 *
 * The word lists differ by what the text is. An **option** or a **state
 * line** says what a thing is, so a superlative is a ranking and is out. An
 * **instruction** asks the question, and "which spell best matches" is the
 * question rather than a verdict; what it may not do is state one as a
 * premise. The Director's brief is exempt: it is doc 007's standing
 * principles of the craft, stated as principles on purpose, and a change to it
 * is a change to that doc.
 */
import { describe, expect, it } from "vitest";
import {
  ARCHETYPES, ITEMS, MAX_HEARTS, STYLE_CARDS, STYLE_START, RngSource, bucketClearSpeed, bucketGold,
  bucketHealth, bucketMovementPressure, bucketRecentDamage, bucketRunProgress, cardPool, emptyHistory,
  gapOf, heldDominantTags, plainInstance, portalChoices,
} from "@jr/core";
import type { Archetype, RunContext } from "@jr/core";
import { THE_GAME } from "./briefing.ts";
import { DIRECTOR_BRIEF, createDirector } from "./director.ts";
import type { ObservedRequest } from "./director.ts";
import type { QuestionStyle } from "./questions/common.ts";
import { optionText } from "./questions/common.ts";
import * as SPECS from "./questions/specs.ts";
import { LANE_SPEC } from "./questions/affixes.ts";
import type { OptionSpec } from "./types.ts";

/**
 * What an option or a state line may not say. `only` is swept as a pool
 * comparison ("the only door", "the one place") rather than as a word: "it
 * strikes only what drifts within it" is a fact about the spell.
 */
const OPTION_VERDICTS: readonly RegExp[] = [
  /\bsuits?\b/i, /\bbetter\b/i, /\bworse\b/i, /\bbest\b/i, /\bweak(er|est)?\b/i, /\bstrong(er|est)?\b/i,
  /\bpowerful\b/i, /\breliable\b/i, /\bworth\b/i, /\bpays? (off|for)\b/i, /\bthe only\b/i,
  /\bthe one place\b/i, /\bshowcase/i, /\bideal\b/i, /\bperfect\b/i, /\bthan any\b/i,
  // The removed labels (doc 002, "State is facts, not verdicts").
  /\barchetype\b/i, /\bbuild'?s range\b/i, /\bbottleneck\b/i, /\bmana sustain\b/i, /\bconsistency\b/i,
];

/** What an instruction may not say: the same, less the words a question is asked in. */
const INSTRUCTION_VERDICTS: readonly RegExp[] = OPTION_VERDICTS.filter(
  (v) => !["\\bbest\\b", "\\bstrong(er|est)?\\b"].includes(v.source),
);

const hits = (list: readonly RegExp[], text: string) => list.filter((v) => v.test(text)).map((v) => v.source);

function ctx(preset: Archetype, over: { index?: number; hearts?: number; gold?: number } = {}): RunContext {
  const index = over.index ?? 9;
  const slots = [plainInstance(STYLE_START[preset]), null, null];
  return {
    run_id: preset, seed: preset, room_index: index,
    labels: {
      health: bucketHealth(over.hearts ?? MAX_HEARTS),
      recent_damage: bucketRecentDamage(0),
      clear_speed: bucketClearSpeed(30_000, 30_000),
      movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(index),
      gold: bucketGold(over.gold ?? 40),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "drifting" },
    },
    staff: { slots: 6, mana_max: 120 }, slots, inventory: [],
    history: { ...emptyHistory(), rooms: ["combat", "combat"], tensions: ["peak", "build"], hearts_lost: [1, 2] },
    intent: { preset },
  };
}

/** Every request the Director makes for one room of each style, in either state format. */
async function requests(style: QuestionStyle): Promise<ObservedRequest[]> {
  const seen: ObservedRequest[] = [];
  for (const preset of ARCHETYPES) {
    const director = createDirector("rule", { observe: (r) => seen.push(r), state_format: style });
    const c = ctx(preset, preset === "melee" ? { hearts: 2, gold: 90 } : {});
    const choices = portalChoices(
      { roomIndex: c.room_index, lastWasElite: false, critical: false, style: preset },
      new RngSource(c.seed).stream("count"), 3,
    );
    const needs = { style: preset, revealed: c.labels.preference.dominant, gap: gapOf(c.labels.observed) };
    const held = [STYLE_START[preset]!];
    await director.planRoom(
      c, { room_index: c.room_index, door_slot: 0, room_type: "combat" }, "build",
      {
        portals: choices,
        cards: [
          { room_index: c.room_index, pool: cardPool(ITEMS, [], "spell", [], {}, { ...needs, heldSpells: held }), count: 3, pity: false, temptation: true },
          {
            room_index: c.room_index, count: 3, pity: false, temptation: false, salt: "affix",
            pool: cardPool(ITEMS, [], "affix", [{ shape: "bolt", count: 1, affixes: [] }], {}, needs),
          },
        ],
      },
    );
    await director.planRoom(c, { room_index: c.room_index, door_slot: 1, room_type: "elite" }, "peak");
  }
  return seen;
}

function specTexts(spec: OptionSpec): string[] {
  return [spec.what, spec.not_for ?? "", ...(spec.examples ?? [])];
}

describe("every other sentence the Director writes for Jev is a neutral fact", () => {
  it("has no verdict in any hand-written option spec", () => {
    const tables = Object.entries(SPECS).filter(([name]) => name.endsWith("_SPEC")) as [string, unknown][];
    expect(tables.length).toBeGreaterThan(15);
    const bad: string[] = [];
    for (const [name, table] of [...tables, ["LANE_SPEC", LANE_SPEC] as const]) {
      const specs = "what" in (table as object) ? { one: table as OptionSpec } : table as Record<string, OptionSpec>;
      for (const [id, spec] of Object.entries(specs))
        for (const text of specTexts(spec))
          for (const v of hits(OPTION_VERDICTS, text)) bad.push(`${name}.${id}: ${v} in "${text}"`);
    }
    expect(bad).toEqual([]);
  });

  it("describes each style by what its spells do, naming the starter the style begins with", () => {
    for (const id of ARCHETYPES) {
      const does = STYLE_CARDS[id].does;
      expect(hits(OPTION_VERDICTS, does), `${id}: ${does}`).toEqual([]);
      expect(does, id).not.toMatch(/\d/);
      const starter = STYLE_START[id]!.split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
      expect(does, `${id} names its starter`).toContain(`Starts with ${starter}`);
    }
    // The Blade line was written for an orbit starter; its starter is an enchant.
    expect(STYLE_CARDS.melee.does).toMatch(/enchant/);
    expect(STYLE_CARDS.melee.does).not.toMatch(/circle/);
  });

  it("has no verdict in the glossary", () => {
    for (const line of THE_GAME.split("\n")) expect(hits(OPTION_VERDICTS, line), line).toEqual([]);
  });

  for (const style of ["labels", "briefing"] as const)
    it(`asks every question without a verdict in its instruction or its options (${style})`, async () => {
      const bad = new Set<string>();
      const all = await requests(style);
      const asked = new Set(all.flatMap((r) => Object.keys(r.questions)));
      for (const q of ["portal_need", "overall", "variety", "composition", "subspecies_weight", "affix_intent"])
        expect([...asked].some((n) => n === q || n.endsWith(`__${q}`)), `${q} in ${[...asked].join(" ")}`).toBe(true);
      for (const r of all)
        for (const [name, q] of Object.entries(r.questions)) {
          const instruction = q.instructions.split(DIRECTOR_BRIEF).join(" ");
          for (const v of hits(INSTRUCTION_VERDICTS, instruction)) bad.add(`${name} instructions: ${v}`);
          for (const [id, option] of Object.entries(q.criteria))
            for (const v of hits(OPTION_VERDICTS, optionText(option))) bad.add(`${name}.${id}: ${v} in "${optionText(option)}"`);
        }
      expect([...bad]).toEqual([]);
    });
});

describe("a copy of a held spell says where it goes", () => {
  it("names the key it raises and the keys it leaves empty, on both arms", async () => {
    for (const style of ["labels", "briefing"] as const) {
      const seen: string[] = [];
      for (const r of await requests(style))
        for (const [name, q] of Object.entries(r.questions))
          if (name.endsWith("overall"))
            for (const option of Object.values(q.criteria)) {
              const text = optionText(option);
              if (/This card is a copy of the spell on key/.test(text)) seen.push(text);
            }
      expect(seen.length, style).toBeGreaterThan(0);
      for (const text of seen)
        expect(text, style).toMatch(/This card is a copy of the spell on key 1: taken, it raises that key's level and fills no key, so keys 2 and 3 stay empty\./);
    }
  });
});
