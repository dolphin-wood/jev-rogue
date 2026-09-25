/**
 * The briefing (`briefing.ts`) and the option specs that go with it.
 *
 * Two kinds of assertion, and the first is the point of the file. A briefing
 * is **a document about the game**, and a document can be wrong: the first
 * draft told Jev there were eight schools including an arcane one, that mana
 * refilled over time and nothing else, and that a room's tension was easy,
 * moderate or hard. None of those was true, all three read perfectly well, and
 * no type or test could have caught any of them. So the facts are asserted
 * against the constants the game actually runs on, and where the briefing
 * quotes a number it is quoted from the same place the game reads it.
 *
 * The second kind is the shape: what a missing field does, what a round-2
 * request carries that a round-1 one does not, and that the briefing arm sends
 * specs where the label arm sends fit clauses.
 */
import { describe, expect, it } from "vitest";
import {
  AFFIX_SLOTS, MERCHANT_PRICE, RUN_BOSS_ROOM, RUN_COMBAT_ROOMS, RUN_SHOP_ROOM, SMITH_PRICE,
  SPELL_SCHOOLS, STAT_FAMILIES, emptyHistory, runStaff,
} from "@jr/core";
import type { RunContext, RunJournalEntry } from "@jr/core";
import { THE_GAME, briefing, briefingFrom, firstSentence, hpWords, spellBehaviour } from "./briefing.ts";
import type { BriefingInput } from "./briefing.ts";
import { AFFIX_LANES } from "./questions/affixes.ts";
import { decidingPhrases } from "./deciding.ts";
import {
  ANCHOR_SPEC, COMPOSITION_SPEC, DENSITY_SPEC, ELITE_GRADE_SPEC, ELITE_PORTAL_SPEC, ELITE_PRESENCE_SPEC,
  ENTRY_SPEC, FAMILY_SPEC, KIND_SPEC, MOOD_SPEC, NORMAL_GRADE_SPEC, NPC_SPEC, SIZE_SPEC, SYMMETRY_SPEC,
  SUBSPECIES_WEIGHT_SPEC, TENSION_SPEC, VARIETY_SPEC, WAVES_SPEC,
} from "./questions/specs.ts";
import { LANE_SPEC } from "./questions/affixes.ts";

/** Every record of hand-written specs, for the rules that hold across all of them. */
const SPEC_RECORDS = {
  ANCHOR_SPEC, COMPOSITION_SPEC, DENSITY_SPEC, ELITE_GRADE_SPEC, ELITE_PORTAL_SPEC, ELITE_PRESENCE_SPEC,
  ENTRY_SPEC, FAMILY_SPEC, KIND_SPEC, LANE_SPEC, MOOD_SPEC, NORMAL_GRADE_SPEC, NPC_SPEC, SIZE_SPEC,
  SUBSPECIES_WEIGHT_SPEC, SYMMETRY_SPEC, TENSION_SPEC, VARIETY_SPEC, WAVES_SPEC,
};
import { createDirector } from "./director.ts";
import type { ObservedRequest } from "./director.ts";
import { EvaluatorError } from "./types.ts";
import type { ChoiceAnswer, ChoiceQuestion, Evaluator } from "./types.ts";
import { optionText } from "./questions/common.ts";
import { ITEMS, RngSource, cardPool, plainInstance, portalChoices } from "@jr/core";

/* --------------------------------------------------------------- fixtures */

function room(index: number, over: Partial<RunJournalEntry> = {}): RunJournalEntry {
  return {
    index, type: "combat", tension: "build", space: "open_arena",
    symmetry: "mirrored", mood: { temperature: "warm", brightness: "dim", particle_intensity: "busy" },
    health_lost: 4, health_low: 50, seconds: 40, expected_seconds: 45,
    hurt_by: "shots", hurt_most_by: "shooter", enemies: ["rusher", "shooter"],
    doors_offered: ["spell", "affix", "stat"], door_taken: "affix",
    picked: ["chain"], passed_over: ["pierce", "seek"],
    ...over,
  };
}

function input(over: Partial<BriefingInput> = {}): BriefingInput {
  return {
    player: {
      style: "Crowd", stylePreset: "area",
      styleMeans: "Hit many at once.",
      ownWords: "I keep getting surrounded",
      ownWordsLane: "wider", ownWordsLaneMeans: AFFIX_LANES.wider.text,
    },
    build: {
      keys: [
        { base: "magic_bolt", level: 2, affixes: [{ id: "repeat", tier: 1 }] },
        { base: "shock_arc", level: 1, affixes: [] },
        null,
      ],
      manaMax: 90, presses: 70, refusedForMana: 3, statsTaken: ["vigour", "vigour"],
      affixSlotsOpen: "few", spellLevels: "some_raised", heldElements: "none", buildShape: "forming",
      dominantTags: ["spam"],
    },
    observed: {
      damage_rate: "fair", hits_per_shot: "one", cast_rate: "steady", sword_share: "some",
      mana_short_time: "little", mana_refused: "never", hurt_by: "shots",
      clear_speed: "normal", recent_damage: "some", movement_pressure_recent: "light",
      castsPerMinute: 41, damagePerSecond: 20, bodiesPerShot: 1.4, swordShare: 0.12, measured: true,
    },
    offers: {
      offStylePicks: "one", keysLean: "spam", statedStyle: "area",
      keptLast: [{ name: "Chain", tags: ["area"] }, { name: "Fleet", tags: ["area", "dot"] }, { name: "Seek", tags: ["spam"] }],
      doorsOffered: [["spell", "affix"], ["affix", "stat", "gold"], ["affix", "spell", "stat"]],
      doorsTaken: ["affix", "affix", "spell"],
    },
    rooms: [1, 2, 3, 4, 5, 6, 7].map((i) => room(i)),
    now: { health: 41, maxHealth: 60, gold: 38, roomIndex: 8, roomType: "combat", deciding: ["a thing"] },
    ...over,
  };
}

/* ----------------------------------------------------------- the glossary */

describe("the glossary states the game as it is", () => {
  it("names every school, and no school the game does not have", () => {
    for (const school of SPELL_SCHOOLS) expect(THE_GAME).toContain(school);
    expect(THE_GAME).toContain(`There are ${SPELL_SCHOOLS.length}`);
    // The first draft invented one, and it read perfectly well.
    expect(THE_GAME.toLowerCase()).not.toContain("arcane");
  });

  it("says where mana comes from in figures, and draws no conclusion from them", () => {
    expect(THE_GAME).toContain("full at the start of every room");
    // About fifty seconds for a full bar, from MANA_REGEN_FRACTION_PER_S, and
    // about seventeen hits from MANA_PER_HIT_FRACTION. Which of the two is the
    // larger supply is arithmetic the reader can do; the state said it for
    // them ("regeneration is a floor under a bad fight, not an income"), which
    // is a verdict about a fact already printed beside it.
    expect(THE_GAME).toContain("50 seconds for a full bar");
    expect(THE_GAME).toContain("17 hits refill it");
    expect(THE_GAME).not.toMatch(/larger supply|not an income/i);
    expect(THE_GAME).toMatch(/too little mana does nothing/);
  });

  it("names the four stat families, which are the stat-family option ids", () => {
    expect(THE_GAME).toContain(STAT_FAMILIES.join(", "));
    expect(THE_GAME).toMatch(/three in each/);
  });

  it("uses the tension vocabulary the question offers, not easy/moderate/hard", () => {
    for (const t of ["release", "build", "peak"]) expect(THE_GAME).toContain(t);
    expect(THE_GAME).toContain("A peak does not follow a peak");
    expect(THE_GAME).toMatch(/pacing cap/);
    expect(THE_GAME).not.toMatch(/easy, moderate or hard/);
  });

  it("explains both senses of elite, the variant, and the three-card reward", () => {
    expect(THE_GAME).toMatch(/elite room/);
    expect(THE_GAME).toMatch(/elite body/);
    expect(THE_GAME).toMatch(/enraged/);
    expect(THE_GAME).toMatch(/three cards and the player keeps one/);
    expect(THE_GAME).toMatch(/Variant: a body the player has met before/);
  });

  it("states the run's shape from the run constants", () => {
    expect(THE_GAME).toContain(`${RUN_COMBAT_ROOMS} fights`);
    expect(THE_GAME).toContain(`${RUN_BOSS_ROOM} rooms in all`);
    expect(THE_GAME).toMatch(/fixed stop with a merchant, a smith and a fountain and no enemies/);
  });

  it("quotes the prices from the constants the game charges", () => {
    expect(THE_GAME).toContain(`spell ${MERCHANT_PRICE["spell"]}`);
    expect(THE_GAME).toContain(`affix ${MERCHANT_PRICE["affix"]}`);
    expect(THE_GAME).toContain(`stat ${MERCHANT_PRICE["stat"]}`);
    for (const level of [1, 2, 3, 4]) expect(THE_GAME).toContain(`${SMITH_PRICE[level]} from level ${level}`);
    // GOLD_ROOM_COINS x COIN_VALUE.
    expect(THE_GAME).toContain("48 gold");
  });

  it("uses one word per thing", () => {
    // "blacksmith" and "shop" are the same two things said twice.
    expect(THE_GAME).not.toMatch(/blacksmith/i);
    expect(THE_GAME).not.toMatch(/\bshop\b/i);
    expect(THE_GAME).not.toMatch(/subspecies/i);
    expect(THE_GAME).toContain(`up to ${AFFIX_SLOTS} affixes`);
  });
});

/* -------------------------------------------------------------- the build */

describe("the build section", () => {
  it("gives a cast's cost as a number and as casts a bar", () => {
    const text = briefing(input());
    expect(text).toMatch(/\d+ mana a cast \(a bar of 90 buys \d+\)/);
    // The band word contradicted the casts line; it is gone.
    expect(text).not.toMatch(/cheap to cast|dear to cast|moderate to cast/);
  });

  it("says 'no element' rather than leaving the phrase out", () => {
    expect(briefing(input())).toContain("no element");
  });

  it("writes a spell's behaviour from its parameters, not from the card's verdict", () => {
    const text = briefing(input());
    // The build section writes the behaviour from the params; the card's own
    // sentence rides on the option, and is not repeated here.
    expect(text).not.toContain(ITEMS.get("magic_bolt")!.description);
    expect(text).toContain("one projectile");
  });

  it("scales a spell's damage by its level", () => {
    const one = spellBehaviour(ITEMS.get("magic_bolt"), 1);
    const five = spellBehaviour(ITEMS.get("magic_bolt"), 5);
    expect(one).not.toEqual(five);
    expect(spellBehaviour(ITEMS.get("shock_arc"))).toContain("chains to 2 more bodies");
    expect(spellBehaviour(ITEMS.get("fault_line"))).toContain("passes through everything");
    expect(spellBehaviour(ITEMS.get("ember_dart"))).toContain("builds fire");
  });

  it("gives each stat its family and its effect", () => {
    expect(briefing(input())).toMatch(/Vigour ×2 \(survival: more health, filled\)/);
  });

  it("reports the staff's affix slots as a count of the total", () => {
    // Two keys held, three slots each; one taken.
    expect(briefing(input())).toContain("Affix slots across the staff: 5 of 6 open");
  });
});

/* -------------------------------------------------------- health and time */

describe("the numbers a designer reads", () => {
  it("frames health damage in hearts as well as in points", () => {
    expect(hpWords(9, 60)).toBe("9 of 60, nearly one of 6 hearts");
    expect(hpWords(0, 60)).toBe("nothing");
    expect(hpWords(12, 60)).toBe("12 of 60, 1.2 of 6 hearts");
  });

  it("gives a clear time against what is usual here", () => {
    expect(briefing(input())).toMatch(/in 40 s, about 45 s is usual here/);
  });

  it("says how the player is doing against the run this game is balanced on", () => {
    expect(briefing(input())).toMatch(/the reference run this game is balanced against had lost about \d+ by room 8/);
  });

  it("says what the purse buys at the merchant", () => {
    expect(briefing(input())).toContain(`stat (${MERCHANT_PRICE["stat"]})`);
    expect(briefing(input({ now: { ...input().now, gold: 0 } }))).toContain("nothing yet");
  });
});

/* ------------------------------------------------------------ the history */

describe("the run so far", () => {
  it("rolls the early rooms up with aggregates, not just a sum", () => {
    const line = briefing(input()).split("\n").find((l) => l.startsWith("- Rooms 1–2"))!;
    expect(line).toContain("combat ×2");
    expect(line).toContain("lost 8 of 60 health in all");
    expect(line).toContain("doors taken affix ×2");
    expect(line).toContain("cards kept Chain ×2");
  });

  it("gives past rooms the space's name and no archetype description", () => {
    const text = briefing(input());
    expect(text).toContain("open arena");
    // The archetype's sentence is a paragraph a room; only the current room gets one.
    expect(text.split("The run so far")[1]!.split("The bodies met")[0])
      .not.toMatch(/An open arena broken by/);
  });

  it("says what was passed over only for the last two rooms", () => {
    const history = briefing(input()).split("The run so far")[1]!.split("The bodies met")[0]!;
    expect(history.match(/passed over/g)?.length).toBe(2);
  });

  it("lists the doors taken even when an early room recorded no doors offered", () => {
    // The old guard dropped the whole line if any of the last three rooms was
    // missing its offer list, which is every run with a vendor stop in it.
    const rooms = [room(1, { doors_offered: [] }), room(2), room(3)];
    expect(briefing(input({ rooms }))).toContain("Doors taken so far: affix ×3");
  });

  it("says plainly that nothing has happened yet in the first room", () => {
    const text = briefing(input({ rooms: [], observed: { measured: false } }));
    expect(text).toContain("No room has been played yet");
    expect(text).toContain("no fight has been played this run");
    expect(text).not.toMatch(/reads as fair/);
  });
});

describe("the bodies met", () => {
  it("tallies what has been met and what took the most health", () => {
    const text = briefing(input());
    expect(text).toContain("rusher in 7 rooms");
    expect(text).toMatch(/Health lost by cause.*: shooter 28/);
  });

  it("names the rooms where the bar dropped to one heart", () => {
    const rooms = [room(1), room(2, { health_low: 8 }), room(3, { health_low: 4 })];
    expect(briefing(input({ rooms }))).toContain("room 2, room 3");
    expect(briefing(input())).toContain("Rooms where the bar dropped to one heart or less: none");
  });
});

/* -------------------------------------------------------------- structure */

describe("the request's own shape", () => {
  it("names every question group the request carries, not one of them", () => {
    const phrases = decidingPhrases([
      "next_tension", "space", "symmetry", "size", "mood_temperature", "mood_brightness",
      "mood_particles", "portal_need", "elite_portal", "elite_grade", "overall", "for_style",
      "for_needs", "variety",
    ]);
    expect(phrases.length).toBeGreaterThan(4);
    expect(phrases.join(" ")).toContain("how hard this room is pitched");
    expect(phrases.join(" ")).toContain("which reward each door out of this room promises");
    // The three moods are one decision and get one phrase.
    expect(phrases.filter((p) => p.includes("colour"))).toHaveLength(1);
  });

  it("gives a shelf's prefixed questions one phrase between them", () => {
    expect(decidingPhrases(["shop_stat__overall", "shop_affix__overall", "shop_spell__variety"]))
      .toHaveLength(1);
  });

  it("carries the decided room only on a round-2 request", () => {
    expect(briefing(input())).not.toContain("This room, as round 1 decided it");
    const withRoom = briefing(input({
      room: {
        space: "open_arena", size: "standard", symmetry: "mirrored",
        mood: { temperature: "warm", brightness: "dim", particle_intensity: "busy" },
        openness: "open", cover: "sparse", zones: ["centre", "edge_n"],
        spawnGroups: ["far", "flank_l"], hazardCap: "high", tension: "build", waves: 2,
        bodyCap: 16, aliveCap: 6,
      },
    }));
    expect(withRoom).toContain("This room, as round 1 decided it");
    // The two counts the density question is answered against: the room's
    // total, and the crowd it is not allowed to exceed.
    expect(withRoom).toContain("Bodies this room may hold over its whole fight: 16");
    expect(withRoom).toContain("Bodies that stand on the floor at once in this room: at most 6");
    expect(withRoom).toContain("Zone slots waiting to be filled: centre, edge_n");
    expect(withRoom).toContain("Places enemies can arrive from: far, flank_l");
    expect(withRoom).toContain("Rounds of fighting this room plays: 2");
    expect(withRoom).toContain("Pitch decided for this room: build");
  });

  it("describes a candidate once: its behaviour is on the option, its tags here", () => {
    const text = briefing(input({
      cards: [{ kind: "affix", candidates: [{ id: "chain", facts: ["style", "need"] }] }],
    }));
    expect(text).toContain("each candidate's own behaviour is on its option below");
    // The facts name what was matched; they do not pronounce on the card.
    expect(text).toContain("Chain: tagged with the stated style, a Ward or Retort affix or a survival stat, offered while health is low");
  });

  it("says when the pity and temptation clocks are armed", () => {
    const text = briefing(input({
      cards: [{ kind: "spell", candidates: [{ id: "void_orb", facts: [] }], pity: true, temptation: true }],
    }));
    expect(text).toContain("A pity card is armed");
    expect(text).toContain("A temptation card is armed");
  });
});

/* -------------------------------------------------------- the latent traps */

describe("firstSentence", () => {
  it("does not cut at a decimal point", () => {
    expect(firstSentence("Move 8.5% faster. It suits everyone.")).toBe("Move 8.5% faster.");
  });
  it("does not cut at an abbreviation", () => {
    expect(firstSentence("Good against a crowd, e.g. a bunched room. Bad alone."))
      .toBe("Good against a crowd, e.g. a bunched room.");
  });
  it("does not cut at an initial", () => {
    expect(firstSentence("Named for J. Smith, who found it. Nothing else."))
      .toBe("Named for J. Smith, who found it.");
  });
  it("returns the whole text when there is no sentence end", () => {
    expect(firstSentence("kills burst")).toBe("kills burst");
    expect(firstSentence(undefined)).toBeNull();
  });
});

describe("the affix lanes describe their own contents correctly", () => {
  it("does not claim any affix gives mana back: none does", () => {
    const cheaper = AFFIX_LANES.cheaper.text;
    expect(cheaper).not.toMatch(/mana/i);
    expect(cheaper).not.toMatch(/Harvest/);
    // Harvest's event is a burst round a kill: more of the room from one cast.
    expect(AFFIX_LANES.cheaper.affixes).not.toContain("harvest");
    expect(AFFIX_LANES.wider.affixes).toContain("harvest");
    expect(AFFIX_LANES.wider.text).toMatch(/Harvest makes a kill burst/);
  });
  it("reads a sentence about pace as a sentence about pace", () => {
    // "clear rooms fast" took a chain-lightning player to the mana lane.
    expect(AFFIX_LANES.cheaper.words).not.toContain("fast");
  });
});

/* ------------------------------------------------------------- the adapter */

describe("briefingFrom", () => {
  const ctx: RunContext = {
    run_id: "t", seed: "t", room_index: 1,
    labels: {
      health: "full", recent_damage: "none", clear_speed: "normal",
      movement_pressure_recent: "light", run_progress: "early", gold: "poor",
      tension_cap: "build_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: [], consistency: "on_plan" },
    },
    staff: runStaff(),
    slots: [null, null, null],
    inventory: [],
    history: emptyHistory(),
    intent: { preset: "area", free_text: "I keep getting surrounded" },
  };

  it("builds a whole briefing from a run context with nothing measured", () => {
    const text = briefingFrom(ctx, { deciding: ["which reward each door promises"] });
    expect(text).toContain("Style: Crowd (area)");
    expect(text).toContain("No room has been played yet");
    expect(text).toContain("no fight has been played this run");
    expect(text).toContain("Key 1: empty");
    // The bar's cap falls back to the six-heart default when none was sent.
    expect(text).toContain("of 60");
  });

  it("reads the player's own words for an affix lane and says which", () => {
    expect(briefingFrom(ctx, { deciding: ["x"] })).toContain("names the wider affix lane");
  });
});

/* ------------------------------------------------------------ the specs */

describe("the option specs", () => {
  it("say what an option is not for, which a fit clause cannot", () => {
    for (const [id, spec] of Object.entries(KIND_SPEC)) {
      expect(spec.what.length, id).toBeGreaterThan(40);
      expect(spec.not_for, id).toBeTruthy();
    }
  });

  /*
   * **Examples are the exception, not the furniture.**
   *
   * Every option used to carry two or three lines of the briefing as
   * examples, which is the answer written down: an example says "a state that
   * looks like this is this option", and three of them on every option of
   * every question is a weight table in prose. They are kept only where two
   * options are genuinely easy to confuse and one line of state is the whole
   * of what separates them. This asserts the list, so adding one is a
   * decision rather than a habit.
   */
  it("keep examples only where two options are easy to confuse", () => {
    const withExamples: string[] = [];
    for (const [name, record] of Object.entries(SPEC_RECORDS))
      for (const [id, spec] of Object.entries(record))
        if (spec.examples?.length) withExamples.push(`${name}.${id}`);
    expect(withExamples.sort()).toEqual([
      // Measured: with the examples gone and nothing else changed, this one
      // went from `tank` 56% to `none` 99%. The options are not confusable as
      // descriptions; they are confusable as states.
      "ANCHOR_SPEC.none", "ANCHOR_SPEC.summoner", "ANCHOR_SPEC.tank",
      // A mirror pair: the same fight from the other side.
      "COMPOSITION_SPEC.melee_heavy", "COMPOSITION_SPEC.ranged_heavy",
      // The four stat families: every state can be read as wanting any of
      // them, so the example is which measured line the option is read off.
      // Measured without them: `survival` 75%.
      "FAMILY_SPEC.mana", "FAMILY_SPEC.movement", "FAMILY_SPEC.survival", "FAMILY_SPEC.sword",
      // The look-only questions, whose one real fact is the last room's look.
      "MOOD_SPEC.bright", "MOOD_SPEC.busy", "MOOD_SPEC.calm", "MOOD_SPEC.cold",
      "MOOD_SPEC.dim", "MOOD_SPEC.warm",
      // Two vendors, both bought with gold, both costing the room's reward.
      "NPC_SPEC.merchant", "NPC_SPEC.smith",
      "SYMMETRY_SPEC.asymmetric", "SYMMETRY_SPEC.mirrored",
      // How widely the offer is drawn: three options that differ only by
      // which value of the off-style count applies (jev-findings 30).
      "VARIETY_SPEC.high", "VARIETY_SPEC.low", "VARIETY_SPEC.medium",
    ]);
  });

  it("give examples in the words the briefing prints", () => {
    /*
     * Not a coincidence to be maintained by hand: the example is the line the
     * run section actually emits for the room just built — and it is **one**
     * line, naming only the part of the look this question answers. The four
     * parts used to arrive as one comma list, so each of these examples quoted
     * three values of fields its own question does not decide.
     */
    expect(MOOD_SPEC["dim"]!.examples).toContain("Last room's brightness: bright");
    const lit = { temperature: "warm", brightness: "bright", particle_intensity: "calm" } as const;
    const printed = briefing(input({
      rooms: [1, 2].map((i) => room(i, { mood: lit, symmetry: "mirrored" })),
    }));
    for (const line of [
      "- Last room's layout: mirrored", "- Last room's light: warm",
      "- Last room's brightness: bright", "- Last room's particles: calm",
    ]) expect(printed).toContain(line);
    expect(printed).not.toContain("Last room's look:");
    /*
      * And **nothing beside it**. The streak line that used to follow — "bright
      * for the last 4 rooms" — is the door-history sentence in another costume,
      * and finding 5a measured what that phrasing does. The alternation lives
      * in the look questions' instructions and in `LOOK_REPEAT_PENALTY`.
      */
    expect(briefing(input({
      rooms: [1, 2, 3, 4].map((i) => room(i, { mood: lit, symmetry: "mirrored" })),
    }))).not.toContain("for the last 4 rooms");
  });

  it("names, in every example, a line the briefing actually prints", () => {
    /*
     * An example is only a mapping Jev can learn if the state it describes is
     * a state the state *has*. Each is written as `<line name>: <a value>`, so
     * the name is checked against a briefing taken with everything measured;
     * the value after it varies by run and is not.
     */
    const measured = briefing(input({
      rooms: [1, 2].map((i) => room(i, {
        mood: { temperature: "warm", brightness: "bright", particle_intensity: "calm" },
        symmetry: "mirrored",
      })),
    }));
    for (const [name, record] of Object.entries(SPEC_RECORDS))
      for (const [id, spec] of Object.entries(record))
        for (const example of spec.examples ?? []) {
          const head = example.slice(0, example.indexOf(":"));
          expect(measured, `${name}.${id}: ${example}`).toContain(`- ${head}:`);
        }
  });

  it("carries no fit clause: there is no label state to match one against", () => {
    for (const spec of Object.values(KIND_SPEC)) {
      expect(spec.what).not.toContain("Fits when");
      expect(spec.not_for).not.toContain("Fits when");
    }
  });

  it("gives every hand-written option something it is wrong for, middles included", () => {
    /*
     * The rule this test exists for, measured: an option with nothing it is
     * wrong for is the one every state falls into. With `not_for` written only
     * on the extremes, the briefing arm answered `next_tension` build in 100%
     * of rooms, `size` standard in 90%, `density` normal in 83% and
     * `elite_presence` one in 90% — every one of them the middle of its list,
     * and every one of them looser than the label arm on the same seeds.
     */
    const bare: string[] = [];
    for (const [name, record] of Object.entries(SPEC_RECORDS))
      for (const [id, spec] of Object.entries(record))
        if (!spec.not_for) bare.push(`${name}.${id}`);
    expect(bare).toEqual([]);
  });
});

/* ------------------------------------------------------------- the switch */

describe("the two state formats as arms", () => {
  const ctx: RunContext = {
    run_id: "t", seed: "t", room_index: 4,
    labels: {
      health: "ok", recent_damage: "some", clear_speed: "normal",
      movement_pressure_recent: "light", run_progress: "early", gold: "ok",
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: [], consistency: "on_plan" },
    },
    staff: runStaff(),
    slots: [null, null, null],
    inventory: [],
    history: emptyHistory(),
    intent: { preset: "spam" },
  };
  const choices = {
    count: 3, kinds: ["spell", "affix", "stat", "gold"] as const, npcKinds: [] as const,
    elite: false, lateGrade: false, schools: SPELL_SCHOOLS, families: STAT_FAMILIES,
  };

  /** Everything Jev was asked, and the state it was asked with. */
  function spy(format: "labels" | "briefing") {
    const seen: { state: Record<string, unknown>; questions: Record<string, ChoiceQuestion> }[] = [];
    const observed: ObservedRequest[] = [];
    const evaluate: Evaluator = async (req) => {
      seen.push({ state: req.state as Record<string, unknown>, questions: req.questions });
      const answers: Record<string, ChoiceAnswer> = {};
      for (const [name, q] of Object.entries(req.questions)) {
        const keys = Object.keys(q.criteria);
        answers[name] = {
          choice: keys[0]!,
          probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0])),
          confidence: 0.9,
        };
      }
      return { answers, usage: { input_tokens: 1 } };
    };
    return { seen, observed, evaluate };
  }

  it("shows the briefing Jev was sent when the request failed, not the labels the rule table read after", async () => {
    const observed: ObservedRequest[] = [];
    const failing: Evaluator = async () => { throw new EvaluatorError("timeout", "timed out"); };
    await createDirector("jev", { evaluate: failing, state_format: "briefing", observe: (r) => observed.push(r) })
      .planPortals(ctx, choices);
    expect(observed[0]!.source).toBe("rule");
    expect(Object.keys(observed[0]!.state)).toEqual(["briefing"]);
  });

  it("sends the briefing on one arm and the label table on the other", async () => {
    const brief = spy("briefing");
    await createDirector("jev", { evaluate: brief.evaluate, state_format: "briefing" }).planPortals(ctx, choices);
    expect(Object.keys(brief.seen[0]!.state)).toEqual(["briefing"]);
    expect(String(brief.seen[0]!.state["briefing"])).toContain("The game");

    const labels = spy("labels");
    await createDirector("jev", { evaluate: labels.evaluate }).planPortals(ctx, choices);
    expect(labels.seen[0]!.state["health"]).toBe("ok");
    expect(labels.seen[0]!.state["briefing"]).toBeUndefined();
  });

  it("writes every option as a spec on the briefing arm, and as a fit clause on the other", async () => {
    const brief = spy("briefing");
    await createDirector("jev", { evaluate: brief.evaluate, state_format: "briefing" }).planPortals(ctx, choices);
    const briefed = brief.seen[0]!.questions["portal_need"]!.criteria;
    for (const [id, option] of Object.entries(briefed)) {
      expect(typeof option, id).toBe("object");
      expect(optionText(option)).not.toContain("Fits when");
    }

    const labels = spy("labels");
    await createDirector("jev", { evaluate: labels.evaluate }).planPortals(ctx, choices);
    const plain = labels.seen[0]!.questions["portal_need"]!.criteria;
    expect(typeof plain["spell"]).toBe("string");
    expect(String(plain["spell"])).toContain("Fits when");
  });

  it("hands the rule table the labels, never the briefing, when a request fails", async () => {
    // A weight table is a function of label values; given a briefing every
    // weight reads undefined and every distribution comes back uniform — so a
    // briefing run's fallbacks would silently be random ones.
    const observed: ObservedRequest[] = [];
    const failing: Evaluator = async () => { throw new EvaluatorError("http", "no"); };
    await createDirector("jev", {
      evaluate: failing, state_format: "briefing", observe: (r) => observed.push(r),
    }).planPortals(ctx, choices);
    expect(observed.length).toBeGreaterThan(0);
    for (const r of observed) {
      expect(r.source).toBe("rule");
      // The readout shows what Jev was sent; the table's answer shows what it read. Labels give
      // it weights, so its distributions are not flat; a briefing would have made every one flat.
      const flat = Object.values(r.dists).every((d) => {
        const ps = Object.values(d);
        return ps.every((p) => Math.abs(p - ps[0]!) < 1e-9);
      });
      expect(flat).toBe(false);
    }
  });
});

describe("every question a whole room asks", () => {
  /** Plans one room on one arm and returns every request it made. */
  async function plan(format: "labels" | "briefing"): Promise<ObservedRequest[]> {
    const seen: ObservedRequest[] = [];
    const evaluate: Evaluator = async (req) => {
      const answers: Record<string, ChoiceAnswer> = {};
      for (const [name, q] of Object.entries(req.questions)) {
        const keys = Object.keys(q.criteria);
        answers[name] = {
          choice: keys[0]!,
          probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0])),
          confidence: 0.9,
        };
      }
      return { answers, usage: { input_tokens: 1 } };
    };
    const ctx: RunContext = {
      run_id: "t", seed: "t", room_index: 9,
      health: 40, max_health: 60, gold: 50,
      labels: {
        health: "ok", recent_damage: "some", clear_speed: "normal",
        movement_pressure_recent: "light", run_progress: "mid", gold: "ok",
        tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
        build: { range: "mid" },
        preference: { dominant: ["spam"], consistency: "on_plan" },
      },
      staff: runStaff(),
      slots: [null, null, null],
      inventory: [],
      history: emptyHistory(),
      intent: { preset: "spam", free_text: "I keep running out of mana" },
    };
    const director = createDirector("jev", {
      evaluate, state_format: format, observe: (r) => seen.push(r),
    });
    await director.planRoom(ctx, { room_index: 9, door_slot: 0, room_type: "combat" }, "build");
    return seen;
  }

  it("writes a spec, never a fit clause, on the briefing arm", async () => {
    const requests = await plan("briefing");
    expect(requests.length).toBe(2);
    let options = 0;
    for (const r of requests)
      for (const [name, q] of Object.entries(r.questions))
        for (const [id, option] of Object.entries(q.criteria)) {
          options++;
          expect(typeof option, `${name}/${id}`).toBe("object");
          const spec = option as { what: string };
          expect(spec.what.trim().length, `${name}/${id}`).toBeGreaterThan(0);
          expect(optionText(option), `${name}/${id}`).not.toContain("Fits when");
        }
    expect(options).toBeGreaterThan(30);
  });

  it("keeps the fit clause on the label arm, and sends the labels", async () => {
    const requests = await plan("labels");
    for (const r of requests) {
      expect(r.state["briefing"]).toBeUndefined();
      for (const q of Object.values(r.questions))
        for (const option of Object.values(q.criteria)) expect(typeof option).toBe("string");
    }
  });

  /*
   * **Every option, generated ones included, says what it is not for**
   * (finding 2). The hand-written records are checked above; this checks the
   * ones code builds from a content table — the spaces, the zone features,
   * the variant bodies and, the longest list of all, the cards.
   */
  it("gives every option of a real request something it is wrong for", async () => {
    const seen: ObservedRequest[] = [];
    const evaluate: Evaluator = async (req) => {
      const answers: Record<string, ChoiceAnswer> = {};
      for (const [name, q] of Object.entries(req.questions)) {
        const keys = Object.keys(q.criteria);
        answers[name] = {
          choice: keys[0]!,
          probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0])),
          confidence: 0.9,
        };
      }
      return { answers, usage: { input_tokens: 1 } };
    };
    const c: RunContext = {
      run_id: "t", seed: "t", room_index: 9,
      health: 40, max_health: 60, gold: 50,
      labels: {
        health: "ok", recent_damage: "some", clear_speed: "normal",
        movement_pressure_recent: "light", run_progress: "mid", gold: "ok",
        tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
        build: { range: "mid" },
        preference: { dominant: ["spam"], consistency: "on_plan" },
      },
      staff: runStaff(), slots: [plainInstance("magic_bolt"), plainInstance("shock_arc"), null],
      inventory: [], history: emptyHistory(), intent: { preset: "spam" },
    };
    const needs = { style: "spam" as const, revealed: ["spam"] };
    const director = createDirector("jev", {
      evaluate, state_format: "briefing", observe: (r) => seen.push(r),
    });
    await director.planRoom(c, { room_index: 9, door_slot: 0, room_type: "combat" }, "build", {
      portals: portalChoices(
        { roomIndex: 9, lastWasElite: false, critical: false, style: "spam" },
        new RngSource("t").stream("count"), 3,
      ),
      cards: [
        { room_index: 9, pool: cardPool(ITEMS, [], "spell", [], {}, needs), count: 3, pity: false, temptation: true },
        {
          room_index: 9, salt: "affix", count: 3, pity: false, temptation: false,
          pool: cardPool(ITEMS, [], "affix", [{ shape: "bolt", count: 1, affixes: [] }], {}, needs),
        },
        { room_index: 9, salt: "stat", pool: cardPool(ITEMS, [], "stat", [], {}, needs), count: 3, pity: false, temptation: false },
      ],
    });
    const bare: string[] = [];
    let options = 0;
    for (const r of seen)
      for (const [name, q] of Object.entries(r.questions))
        for (const [id, option] of Object.entries(q.criteria)) {
          if (id === "fallback") continue;
          options++;
          if (!(option as { not_for?: string }).not_for) bare.push(`${name}/${id}`);
        }
    // The cards alone are more than fifty of these.
    expect(options).toBeGreaterThan(60);
    expect(bare).toEqual([]);
  });

  it("names every question group the request carries in the briefing itself", async () => {
    const [first, second] = await plan("briefing");
    const one = String(first!.state["briefing"]);
    expect(one).toContain("how hard this room is pitched");
    expect(one).toContain("how this room looks");
    expect(one).not.toContain("This room, as round 1 decided it");
    const two = String(second!.state["briefing"]);
    expect(two).toContain("This room, as round 1 decided it");
    expect(two).toContain("what fills each of this room's zone slots");
  });
});

/* ---------------------------------------------------- neutral state text */

/**
 * **The state says what happened; it does not lean on it.**
 *
 * Finding 5a separated the facts from the phrasing. The same four rooms of
 * door history moved the affix option from 3% to 3% as plain counts and to
 * 44% as "chose the spell or stat door every time, never the affix door".
 * What Jev reads as an argument is the emphasis — *every*, *never*, *each
 * time*, *most*, *least* — and a sentence built round one option, whichever
 * way the behaviour ran.
 *
 * So the generated state is swept for those words. The glossary is exempt:
 * it is the rules of the game, where "full at the start of every room" and
 * "a peak does not follow a peak" *are* the fact, and it names no run.
 */
const INTENSIFIERS: readonly RegExp[] = [
  /\bevery\b/i, /\bnever\b/i, /\balways\b/i, /\bonly\b/i, /\bstill\b/i,
  /\bkeeps\b/i, /\bagain\b/i, /\brunning\b/i, /room after room/i,
  /\bmost\b/i, /\bleast\b/i, /\balready\b/i, /\bjust\b/i, /\bsimply\b/i,
  /\beach time\b/i, /\bwalked past\b/i,
];

/**
 * Lines that carry one of those words as part of a **name** rather than as
 * emphasis, and are allowed it.
 *
 * Each is a quantity the game measures and the option specs cite by name, so
 * renaming it would take the examples with it (finding 3). None of them is a
 * sentence about how the player has behaved around an option.
 */
const NEUTRAL_EXCEPTIONS: readonly RegExp[] = [
  /^- What took the most health/,
  /^- Nothing yet: no fight has been played/,
  /^- Not measured:/,
  /^- Nothing has been measured yet/,
  /^- No room has been played yet/,
  /^- Nothing has been offered, taken or passed over/,
  // The glossary's own sentence about the bar, repeated in the build section.
  /^- Mana: a bar of/,
  // A measured bucket whose vocabulary is never / rarely / often.
  /^- Casts the bar refused for want of mana:/,
  // Content: an affix's own effect text, and the lane the typed words name.
  /, tier \d+ of \d+/,
  /^- That lane is:/,
  // The plain per-room lines finding 5a measured as inert.
  /^- Room \d+: /,
  /^- Rooms \d+[–-]\d+, rolled up:/,
];

describe("the state is neutral", () => {
  /** Every line of a briefing below the glossary, from a run in mid flight. */
  function stateLines(over: Partial<BriefingInput> = {}): string[] {
    const text = briefing(input(over));
    const body = text.slice(text.indexOf(THE_GAME) + THE_GAME.length);
    return body.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  it("uses no intensifier and no sentence built round one option", () => {
    const cases: Partial<BriefingInput>[] = [
      {},
      { rooms: [] },
      { rooms: [1, 2, 3, 4, 5].map((i) => room(i, { door_taken: "affix", doors_offered: ["affix", "spell"] })) },
      { offers: { offStylePicks: "two_running", keysLean: "spam" } },
      { cards: [{ kind: "affix", candidates: [{ id: "chain", facts: ["style", "need", "eases", "synergy", "upgrade", "promised"] }] }] },
      { build: { ...input().build, spellLevels: "all_base", heldElements: "none", affixSlotsOpen: "many", buildShape: "raw" } },
      { build: { ...input().build, spellLevels: "mostly_raised", buildShape: "formed" } },
    ];
    const bad: string[] = [];
    for (const over of cases)
      for (const line of stateLines(over)) {
        if (NEUTRAL_EXCEPTIONS.some((ok) => ok.test(line))) continue;
        for (const word of INTENSIFIERS) if (word.test(line)) bad.push(`${word.source}  in  ${line}`);
      }
    expect(bad).toEqual([]);
  });

  /**
   * **And nothing that tells Jev what to do, or pronounces on the player.**
   *
   * The intensifier sweep above catches emphasis; this catches the other half
   * of the same rule. A briefing line may say what was measured ("lost 9 of
   * 60") and may say what the game does ("a key pressed with too little mana
   * does nothing"); it may not say what the Director should answer, and it may
   * not hand over a conclusion the numbers are there for it to draw. The
   * glossary is swept too — a rule of the game is a fact, and "regeneration is
   * a floor under a bad fight, not an income" was a verdict sitting in one.
   */
  const PRESCRIPTIONS: readonly RegExp[] = [
    /\bshould\b/i, /\bought to\b/i, /\bneeds to\b/i, /\bmust\b/i,
    /\bstruggling\b/i, /\bin trouble\b/i, /\bdoing well\b/i, /\bfalling behind\b/i,
    /\bbetter to\b/i, /\bworth more than\b/i, /\bthe safe\b/i, /\bprefer\b/i,
    /\bfavour\b/i, /\bshould lean\b/i, /\bit is time\b/i,
  ];

  it("tells Jev nothing to do, and pronounces on nobody", () => {
    const cases: Partial<BriefingInput>[] = [
      {}, { rooms: [] },
      {
        cards: [{
          kind: "spell", pity: true, temptation: true,
          guarantee: [["magic_bolt"], ["shock_arc", "void_orb"]],
          candidates: [{ id: "magic_bolt", facts: ["upgrade"] }, { id: "void_orb", facts: ["style"] }],
        }],
      },
      {
        room: {
          space: "open_arena", size: "standard", symmetry: "mirrored",
          mood: { temperature: "warm", brightness: "dim", particle_intensity: "busy" },
          openness: "open", cover: "sparse", zones: ["centre"], spawnGroups: ["far"],
          hazardCap: "high", tension: "peak", waves: 2, bodyCap: 16, aliveCap: 6,
        },
      },
    ];
    const bad: string[] = [];
    for (const over of cases)
      for (const line of briefing(input(over)).split("\n").map((l) => l.trim()).filter(Boolean))
        for (const word of PRESCRIPTIONS) if (word.test(line)) bad.push(`${word.source}  in  ${line}`);
    expect(bad).toEqual([]);
  });

  it("has no markdown emphasis anywhere, glossary included", () => {
    expect(briefing(input())).not.toContain("**");
  });

  it("counts the doors rather than narrating them", () => {
    const text = briefing(input());
    expect(text).toMatch(/- Doors offered, \d+ offers so far: spell \d+, affix \d+, stat \d+, gold \d+/);
    expect(text).toMatch(/- Doors taken: spell \d+, affix \d+, stat \d+, gold \d+/);
    // The three sentences finding 5a is about.
    expect(text).not.toMatch(/Walked through most/);
    expect(text).not.toMatch(/Offered most and taken least/);
    expect(text).not.toMatch(/Badges on every one of the last offers/);
  });
});

/* ------------------------------------ the cards kept, and where a card goes */

describe("the facts the offer's shape is read off", () => {
  it("prints the last cards kept with their style tags and the stated-style count (variety)", () => {
    const text = briefing(input({
      offers: {
        keysLean: "spam", statedStyle: "area",
        keptLast: [
          { name: "Shock Arc", tags: ["spam"] },
          { name: "Fleet", tags: ["area", "dot"] },
          { name: "Seek", tags: ["spam"] },
        ],
      },
    }));
    expect(text).toContain("- Last 3 cards kept, oldest first: Shock Arc (tagged spam); Fleet (tagged area, dot); Seek (tagged spam)");
    expect(text).toContain("- Of those, off the stated style: 2 of 3; of the newest two: 1");
    // The bucket it replaces, which printed "1" for one or two off-style picks.
    expect(text).not.toContain("Picks off the stated style");
    expect(briefing(input({ offers: { keysLean: "spam", statedStyle: "area", keptLast: [] } })))
      .toContain("- Cards kept so far: none");
  });

  it("reads the kept cards off the journal, by id or by the harness's snake-cased name", () => {
    const ctx: RunContext = {
      ...minimalContext(),
      history: {
        ...emptyHistory(),
        journal: [
          room(1, { picked: ["shock_arc"] }), room(2, { picked: ["gold"] }),
          room(3, { picked: ["fleet"] }), room(4, { picked: ["kindle"] }),
        ],
      },
    };
    const text = briefingFrom(ctx, { deciding: [] });
    expect(text).toMatch(/- Last 3 cards kept, oldest first: Shock Arc \(tagged spam\); Fleet \(tagged [a-z, ]+\); Kindle \(tagged [a-z, ]+\)/);
  });

  it("gives Jev its own answers for each room so far, one JSON object a room, and no verdict on them", () => {
    const ctx: RunContext = {
      ...minimalContext(),
      history: {
        ...emptyHistory(),
        journal: [
          room(1, { decided: { composition: "ranged_heavy", density: "sparse", spell_school: "spirit" } }),
          room(2, { decided: { composition: "ranged_heavy", density: "normal" } }),
          room(3, {}),
        ],
      },
    };
    const text = briefingFrom(ctx, { deciding: [] });
    expect(text).toContain("- The Director's answers for each room so far, oldest first, one JSON object a room:");
    expect(text).toContain('  {"room":1,"composition":"ranged_heavy","density":"sparse","spell_school":"spirit"}');
    expect(text).toContain('  {"room":2,"composition":"ranged_heavy","density":"normal"}');
    // A room with nothing decided is not a line, and nothing tells Jev what to make of the record.
    expect(text).not.toContain('"room":3');
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.startsWith("- The Director's answers"));
    const section = lines.slice(at, at + 3).join("\n");
    expect(section).not.toMatch(/vary|variety|repeat|again|same/i);
  });

  it("says, for a spell offer with an empty key, where a new spell and a copy go", () => {
    const text = briefing(input({
      cards: [{ kind: "spell", candidates: [
        { id: "magic_bolt", facts: ["style", "upgrade"] }, { id: "ember_dart", facts: ["style"] },
      ] }],
    }));
    expect(text).toContain("- Keys empty now: 3. A new spell taken from this offer goes on key 3; a copy of a "
      + "held spell (Magic Bolt on key 1, Shock Arc on key 2) raises that key's level and leaves key 3 empty");
    // A full staff has nothing to fill, and the line says nothing.
    const full = input().build;
    expect(briefing(input({
      build: { ...full, keys: [full.keys[0]!, full.keys[1]!, { base: "ember_dart", level: 1, affixes: [] }] },
      cards: [{ kind: "spell", candidates: [{ id: "magic_bolt", facts: ["upgrade"] }] }],
    }))).not.toContain("Keys empty now");
  });
});

function minimalContext(): RunContext {
  return {
    run_id: "t", seed: "t", room_index: 5,
    labels: {
      health: "full", recent_damage: "none", clear_speed: "normal",
      movement_pressure_recent: "light", run_progress: "early", gold: "poor",
      tension_cap: "build_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: [], consistency: "drifting" },
    },
    staff: runStaff(),
    slots: [null, null, null],
    inventory: [],
    history: emptyHistory(),
    intent: { preset: "spam" },
  };
}
