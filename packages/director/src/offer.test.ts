import { describe, expect, it } from "vitest";
import {
  ITEMS, MAX_HEARTS, bucketClearSpeed, bucketGold, bucketHealth, bucketMovementPressure,
  bucketRecentDamage, bucketRunProgress, cardPool, cardsFor, emptyHistory, heldSpell, plainInstance,
  portalChoices, RngSource, schoolOf, heldDominantTags, NPC_OFFERS_MAX, RUN_COMBAT_ROOMS,
} from "@jr/core";
import type { RunContext, RunShape } from "@jr/core";
import { createDirector } from "./director.ts";
import { FALLBACK } from "./types.ts";
import type { Evaluator } from "./types.ts";
import { optionText } from "./questions/common.ts";

function ctx(
  index: number,
  opts: { hearts?: number; gold?: number; seed?: string; shape?: "raw" | "forming" | "formed" } = {},
): RunContext {
  const staff = { slots: 6, mana_max: 120 };
  const slots = [plainInstance("magic_bolt"), null, null];
  const seed = opts.seed ?? "offer-test";
  return {
    run_id: seed, seed, room_index: index,
    labels: {
      health: bucketHealth(opts.hearts ?? MAX_HEARTS),
      recent_damage: bucketRecentDamage(0),
      clear_speed: bucketClearSpeed(30_000, 30_000),
      movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(index),
      gold: bucketGold(opts.gold ?? 0),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "on_plan" },
      build_shape: opts.shape ?? "forming",
    },
    staff, slots, inventory: [], history: emptyHistory(), intent: { preset: "dot" },
  };
}

const run = (roomIndex: number, over: Partial<RunShape> = {}): RunShape =>
  ({ roomIndex, lastWasElite: false, critical: false, style: "dot", ...over });

describe("the Director's portals (doc 003)", () => {
  it("answers every portal with a legal, distinct kind, and at most one elite, never first", async () => {
    const d = createDirector("rule");
    for (let seed = 0; seed < 60; seed++) {
      const r = run(3 + (seed % 10));
      const choices = portalChoices(r, new RngSource(`p${seed}`).stream("count"));
      const plan = await d.planPortals(ctx(r.roomIndex, { seed: `p${seed}` }), choices);
      expect(plan.doors.length).toBe(choices.count);
      const fights = plan.doors.filter((x) => !x.npc);
      expect(new Set(fights.map((x) => x.reward)).size).toBe(fights.length);
      const elites = plan.doors.filter((x) => x.difficulty === "elite");
      expect(elites.length).toBeLessThanOrEqual(1);
      if (plan.doors.length > 1) expect(plan.doors[0]!.difficulty).toBe("normal");
      for (const x of plan.doors) {
        // A door promises nothing beyond its kind; its badge is read off its cards later.
        expect(x.schools).toBeUndefined();
        expect(x.families).toBeUndefined();
        expect([1, 2, 3]).toContain(x.grade);
        if (x.difficulty === "elite") expect(x.grade).toBeGreaterThanOrEqual(2);
      }
      expect(plan.decisions.some((x) => x.question === "portal_need")).toBe(true);
    }
  });

  it("offers no elite where the rules forbid one, and no vendor early or twice running", async () => {
    const d = createDirector("rule");
    for (let seed = 0; seed < 30; seed++) {
      const early = portalChoices(run(1), new RngSource(`e${seed}`).stream("c"));
      expect(early.elite).toBe(false);
      expect(early.npcKinds).toEqual([]);
      const after = portalChoices(run(6, { lastWasElite: true, lastWasNpc: true }), new RngSource(`a${seed}`).stream("c"));
      expect(after.elite).toBe(false);
      expect(after.npcKinds).toEqual([]);
      const plan = await d.planPortals(ctx(6), after);
      expect(plan.doors.every((x) => x.difficulty === "normal" && !x.npc)).toBe(true);
    }
  });

  it("puts no vendor on a door the need ranking barely weighed, and the smith needs more than the merchant", async () => {
    // Jev ranks spell first and spreads a small share over everything else.
    const lean = (smith: number, merchant: number): Evaluator => async (req) => ({
      answers: Object.fromEntries(Object.entries(req.questions).map(([name, question]) => {
        const keys = Object.keys(question.criteria).filter((id) => id !== FALLBACK);
        const p = (id: string) => name !== "portal_need" ? 1 / keys.length
          : id === "smith" ? smith : id === "merchant" ? merchant : id === "spell" ? 0.8 : 0.01;
        const total = keys.reduce((a, id) => a + p(id), 0);
        return [name, {
          choice: keys[0]!, confidence: null,
          probabilities: { ...Object.fromEntries(keys.map((id) => [id, p(id) / total])), [FALLBACK]: 0 },
        }];
      })),
      usage: { input_tokens: null },
    });
    const vendorsOver = async (evaluate: Evaluator) => {
      const seen = new Set<string>();
      for (let seed = 0; seed < 30; seed++) {
        const choices = portalChoices(run(6), new RngSource(`v${seed}`).stream("c"), 3);
        const plan = await createDirector("jev", { evaluate }).planPortals(ctx(6, { seed: `v${seed}`, gold: 60 }), choices);
        expect(plan.decisions.find((d) => d.question === "portal_need")?.source).toBe("jev");
        for (const door of plan.doors) if (door.npc) seen.add(door.npc);
      }
      return seen;
    };
    expect(await vendorsOver(lean(0.03, 0.03))).toEqual(new Set());
    // The same share the merchant clears is not enough for the smith.
    expect(await vendorsOver(lean(0.2, 0))).toEqual(new Set());
    expect(await vendorsOver(lean(0, 0.2))).toEqual(new Set(["merchant"]));
  });

  it("puts no fountain on a door the need ranking barely weighed, and one where it leads", async () => {
    const d = createDirector("rule");
    let low = 0;
    let high = 0;
    for (let seed = 0; seed < 40; seed++) {
      const choices = portalChoices(run(7, { hurt: true }), new RngSource(`f${seed}`).stream("c"), 3);
      expect(choices.npcKinds).toContain("fountain");
      const fine = await d.planPortals(ctx(7, { seed: `f${seed}`, hearts: 4 }), choices);
      const dying = await d.planPortals(ctx(7, { seed: `f${seed}`, hearts: 1 }), choices);
      if (fine.doors.some((x) => x.npc === "fountain")) low++;
      if (dying.doors.some((x) => x.npc === "fountain")) high++;
    }
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(20);
  });

  /*
   * Doc 003's early economy, measured **over a run** rather than per offer,
   * because the cap is what a player actually meets: `NPC_OFFERS_MAX` bounds
   * how many times a run may put a vendor on the portal list at all, and
   * `NPC_ROOMS_MAX` how many it may enter. Per offer the rate says nothing —
   * the merchant is one of seven ranked options and lands in the top three
   * often — and it is the cap plus the ranking together that decide what the
   * run looks like.
   */
  it("meets a vendor a few times a run while the build is unformed, and less once it is formed", async () => {
    const d = createDirector("rule");
    const runOffers = async (shape: "raw" | "forming" | "formed", seed: string) => {
      let npcOffers = 0;
      let npcRooms = 0;
      let lastWasNpc = false;
      for (let room = 1; room <= RUN_COMBAT_ROOMS; room++) {
        const choices = portalChoices(
          { ...run(room), npcOffers, npcRooms, lastWasNpc },
          new RngSource(`${seed}-${room}`).stream("c"), 3,
        );
        const plan = await d.planPortals(ctx(room, { seed: `${seed}-${room}`, gold: 60, shape }), choices);
        const vendor = plan.doors.filter((x) => x.npc && x.npc !== "fountain");
        expect(vendor.length).toBeLessThanOrEqual(1);
        lastWasNpc = vendor.length > 0;
        if (vendor.length > 0) { npcOffers++; npcRooms++; }
      }
      return npcOffers;
    };
    const unformed = await runOffers("raw", "eco-raw");
    const formed = await runOffers("formed", "eco-formed");
    // Bounded by code, and reached while the build is unformed.
    expect(unformed).toBeGreaterThan(0);
    expect(unformed).toBeLessThanOrEqual(NPC_OFFERS_MAX);
    expect(formed).toBeLessThanOrEqual(unformed);
  });

  /*
   * Doc 003's conversion: one question over single kinds, and code assigns the
   * doors from the ranking. The properties that matter are that the doors are
   * distinct, that there are exactly `count` of them, that at most one is a
   * room with no fight, and that a constraint makes an option fall through
   * rather than cost a door.
   */
  it("assigns the doors from one ranked answer, distinct and never short", async () => {
    const d = createDirector("rule", { observe: (r) => seen.push(r) });
    const seen: import("./director.ts").ObservedRequest[] = [];
    for (let seed = 0; seed < 40; seed++) {
      seen.length = 0;
      const count = 1 + (seed % 3);
      const choices = portalChoices(run(6), new RngSource(`r${seed}`).stream("c"), count);
      const plan = await d.planPortals(ctx(6, { seed: `r${seed}`, gold: 60 }), choices);
      // One question, single options, no combinations.
      const asked = Object.keys(seen[0]!.questions);
      expect(asked).toContain("portal_need");
      for (const id of Object.keys(seen[0]!.questions.portal_need!.criteria))
        expect(id).not.toContain("+");
      // The doors: exactly `count`, distinct in what they promise, at most one
      // with no fight in it, and never a vendor as the only way on.
      expect(plan.doors.length).toBe(count);
      const vendors = plan.doors.filter((x) => x.npc);
      expect(vendors.length).toBeLessThanOrEqual(1);
      if (count === 1) expect(vendors.length).toBe(0);
      const fights = plan.doors.filter((x) => !x.npc);
      expect(new Set(fights.map((x) => x.reward)).size).toBe(fights.length);
      // The escape option never becomes a door.
      for (const x of plan.doors) expect(["stat", "spell", "affix", "gold"]).toContain(x.reward);
    }
  });

  it("keeps enough kinds for three doors when two badges have reached the streak cap", async () => {
    const seen: import("./director.ts").ObservedRequest[] = [];
    const d = createDirector("rule", { observe: (r) => seen.push(r) });
    const base = ctx(12, { seed: "muiew8ni-yrz-12" });
    const history = { ...base.history, doors_offered: [
      ["affix", "stat"], ["affix", "stat"],
      ["affix", "gold", "stat"], ["affix", "spell", "stat"],
    ] };
    const choices = portalChoices(
      run(12, { lastWasNpc: true }), new RngSource("muiew8ni-yrz-12").stream("portal-count"), 3,
    );
    const plan = await d.planPortals({ ...base, history }, choices);
    expect(Object.keys(seen[0]!.questions.portal_need!.criteria).filter((id) => id !== "fallback")).toHaveLength(3);
    expect(plan.doors).toHaveLength(3);
  });

  it("asks nothing after the kinds: a room's portals ride in its round 1 alone", async () => {
    const d = createDirector("rule", { observe: (r) => seen.push(r) });
    const seen: import("./director.ts").ObservedRequest[] = [];
    for (let seed = 0; seed < 20; seed++) {
      seen.length = 0;
      const choices = portalChoices(run(6), new RngSource(`q${seed}`).stream("c"), 3);
      const room = await d.planRoom(
        ctx(6, { seed: `q${seed}` }), { room_index: 6, door_slot: 0, room_type: "combat" }, "build",
        { portals: choices },
      );
      const round1 = seen.find((r) => r.meta.round === 1)!;
      const round2 = seen.find((r) => r.meta.round === 2)!;
      expect(Object.keys(round1.questions)).toContain("portal_need");
      for (const r of [round1, round2]) {
        expect(Object.keys(r.questions)).not.toContain("spell_school");
        expect(Object.keys(r.questions)).not.toContain("stat_family");
      }
      expect(room.offer?.portals?.doors.length).toBe(3);
    }
  });

  it("falls back to the rule table when Jev fails, per portal question", async () => {
    const broken: Evaluator = async () => { throw new Error("offline"); };
    const d = createDirector("jev", { evaluate: broken });
    const plan = await d.planPortals(ctx(5), portalChoices(run(5), new RngSource("f").stream("c"), 3));
    expect(plan.source).toBe("rule");
    expect(plan.doors.length).toBe(3);
  });

  it("prefers the merchant over the smith when Jev rates both vendors equally", async () => {
    const even: Evaluator = async (req) => ({
      answers: Object.fromEntries(Object.entries(req.questions).map(([name, question]) => {
        const keys = Object.keys(question.criteria);
        const ids = keys.filter((id) => id !== FALLBACK);
        return [name, {
          choice: ids[0]!, probabilities: Object.fromEntries(keys.map((id) => [id, id === FALLBACK ? 0 : 1 / ids.length])),
          confidence: null,
        }];
      })),
      usage: { input_tokens: null },
    });
    const choices = portalChoices(run(6), new RngSource("vendor-balance").stream("c"), 3);
    expect(choices.npcKinds).toEqual(expect.arrayContaining(["merchant", "smith"]));
    const plan = await createDirector("jev", { evaluate: even })
      .planPortals(ctx(6, { seed: "vendor-balance", gold: 60 }), choices);
    const need = plan.decisions.find((decision) => decision.question === "portal_need");
    expect(need?.source).toBe("jev");
    // At an even rating the smith falls under its floor (`NPC_MIN_NEED`) and
    // leaves the ranking altogether.
    expect(need!.probabilities.merchant).toBeGreaterThan(need!.probabilities.smith ?? 0);
  });

  it("hands only a declined question to the rule table; the request's other answers stand", async () => {
    const declining: Evaluator = async (req) => ({
      answers: Object.fromEntries(Object.entries(req.questions).map(([name, q]) => {
        const keys = Object.keys(q.criteria);
        const choice = name === "normal_grade" ? FALLBACK : keys.find((k) => k !== FALLBACK)!;
        return [name, { choice, probabilities: Object.fromEntries(keys.map((k) => [k, k === choice ? 1 : 0])), confidence: null }];
      })),
      usage: { input_tokens: null },
    });
    const d = createDirector("jev", { evaluate: declining });
    // Late in the run, where a normal door's grade is asked beside the need.
    const plan = await d.planPortals(ctx(12), portalChoices(run(12), new RngSource("f").stream("c"), 3));
    const by = Object.fromEntries(plan.decisions.map((x) => [x.question, x]));
    expect(by["normal_grade"]).toMatchObject({ source: "rule", fallback_path: "declined" });
    expect(by["portal_need"]?.source).toBe("jev");
  });
});

describe("the Director's cards (doc 007)", () => {
  it("lists each held spell's compatible affixes once in Jev's state", async () => {
    const evaluate: Evaluator = async (req) => ({
      answers: Object.fromEntries(Object.entries(req.questions).map(([name, question]) => {
        const ids = Object.keys(question.criteria);
        const choice = ids.find((id) => id !== FALLBACK)!;
        return [name, {
          choice, probabilities: Object.fromEntries(ids.map((id) => [id, id === choice ? 1 : 0])),
          confidence: null,
        }];
      })),
      usage: { input_tokens: null },
    });
    for (const state_format of ["labels", "briefing"] as const) {
      const seen: import("./director.ts").ObservedRequest[] = [];
      const director = createDirector("jev", { evaluate, state_format, observe: (request) => seen.push(request) });
      const run = {
        ...ctx(4), slots: [plainInstance("meteor"), plainInstance("shock_arc"), plainInstance("magic_bolt")],
        intent: { preset: "area" as const, free_text: "想要多重陨石" },
      };
      const held = [heldSpell(ITEMS.get("meteor")), heldSpell(ITEMS.get("shock_arc")), heldSpell(ITEMS.get("magic_bolt"))];
      const pool = cardPool(ITEMS, [], "affix", held);
      await director.planCards(run, { room_index: 4, pool, count: 3, pity: false, temptation: false });
      const overall = seen[0]!.questions.overall!;
      expect(overall.instructions).toContain("only when it is in that spell's list");
      expect(optionText(overall.criteria["fork"]!)).not.toContain("Can attach to these held spells");
      if (state_format === "labels") {
        const bySpell = seen[0]!.state["affixes_by_spell"] as Record<string, string>;
        expect(bySpell["meteor"]?.split(" ")).toContain("scatter");
        expect(bySpell["meteor"]?.split(" ")).not.toContain("fork");
        expect(bySpell["shock_arc"]?.split(" ")).toContain("fork");
        expect(bySpell["magic_bolt"]?.split(" ")).toContain("fork");
      } else {
        const lines = (seen[0]!.state["briefing"] as string).split("\n");
        const meteor = lines.find((line) => line.includes("Meteor can take these affixes from this offer:"));
        const arc = lines.find((line) => line.includes("Shock Arc can take these affixes from this offer:"));
        const bolt = lines.find((line) => line.includes("Magic Bolt can take these affixes from this offer:"));
        expect(meteor).toContain("Scatter");
        expect(meteor).not.toContain("Fork");
        expect(arc).toContain("Fork");
        expect(bolt).toContain("Fork");
      }
    }
  });

  it("keeps a door's promise as one card, and draws the rest from the whole pool", async () => {
    const d = createDirector("rule");
    const promise = { school: "flame", grade: 2 };
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const pool = cardPool(ITEMS, ["magic_bolt"], "spell", [], promise, { style: "dot" });
      // The pool is every spell, the school's marked.
      expect(pool.candidates.length).toBeGreaterThan(10);
      const plan = await d.planCards(ctx(4, { seed: `p${seed}` }), { room_index: 4, pool, count: 3, pity: false, temptation: false });
      const cards = cardsFor(ITEMS, "spell", plan.ids, promise);
      expect(cards.length).toBe(3);
      expect(cards.filter((c) => schoolOf(c.itemId) === "flame").length).toBeGreaterThanOrEqual(1);
      for (const c of cards) expect(c.grade).toBe(2);
      seen.add([...plan.ids].sort().join("|"));
    }
    // A school of four spells used to be the whole offer: a handful of sets.
    expect(seen.size).toBeGreaterThan(15);
  });

  it("deals three distinct cards, two sampled and a wildcard", async () => {
    const d = createDirector("rule");
    const pool = cardPool(ITEMS, [], "stat", [], {}, { style: "melee", hurt: true });
    const plan = await d.planCards(ctx(4), { room_index: 4, pool, count: 3, pity: false, temptation: false });
    expect(new Set(plan.ids).size).toBe(3);
    expect(plan.origins).toEqual(["sampled", "sampled", "wildcard"]);
  });

  it("leans on need: a hurt player sees survival more than an even draw would give", async () => {
    const d = createDirector("rule");
    let survival = 0;
    const n = 80;
    for (let seed = 0; seed < n; seed++) {
      const pool = cardPool(ITEMS, [], "stat", [], {}, { hurt: true });
      const plan = await d.planCards(ctx(4, { seed: `h${seed}`, hearts: 1 }), { room_index: 4, pool, count: 3, pity: false, temptation: false });
      survival += cardsFor(ITEMS, "stat", plan.ids).filter((c) => ["wrath", "vigour", "steady_nerve"].includes(c.itemId)).length;
    }
    // Three survival stats of twelve: an even draw is 0.75 per offer.
    expect(survival / n).toBeGreaterThan(0.9);
  });

  it("gives pity the wildcard slot, and temptation an off-style card", async () => {
    const d = createDirector("rule");
    const pool = cardPool(ITEMS, [], "stat", [], {}, { style: "melee", hurt: true });
    const pity = await d.planCards(ctx(4), { room_index: 4, pool, count: 3, pity: true, temptation: false });
    expect(pity.origins[2]).toBe("pity");
    const need = pool.candidates.find((c) => c.id === pity.ids[2]);
    expect(need?.facts).toContain("need");
    const tempt = await d.planCards(ctx(4), { room_index: 4, pool, count: 3, pity: false, temptation: true });
    expect(tempt.origins[2]).toBe("temptation");
    expect(pool.candidates.find((c) => c.id === tempt.ids[2])?.facts).not.toContain("style");
  });

  it("stocks a one-card shelf", async () => {
    const d = createDirector("rule");
    const pool = cardPool(ITEMS, [], "affix", [{ shape: "bolt", count: 1, affixes: [] }], {}, {});
    const plan = await d.planCards(ctx(15), { room_index: 15, pool, count: 1, pity: false, temptation: false, salt: "shop-affix" });
    expect(plan.ids.length).toBe(1);
  });
});

describe("the Director's readout hook", () => {
  it("reports every request with its state, questions and distributions", async () => {
    const seen: import("./director.ts").ObservedRequest[] = [];
    const d = createDirector("rule", { observe: (r) => seen.push(r) });
    await d.planPortals(ctx(5), portalChoices(run(5), new RngSource("o").stream("c"), 3));
    const pool = cardPool(ITEMS, [], "stat", [], {}, { hurt: true });
    await d.planCards(ctx(5), { room_index: 5, pool, count: 3, pity: false, temptation: false, salt: "shop-stat" });
    // Asked alone, the portals are one request: there is no promise to ask after the kinds.
    expect(seen.map((r) => `${r.meta.purpose}:${r.meta.round}`))
      .toEqual(["portals:1", "cards:stat:shop-stat:1"]);
    for (const r of seen) {
      expect(r.state.health).toBeTruthy();
      for (const name of Object.keys(r.questions)) expect(Object.keys(r.dists[name] ?? {}).length).toBeGreaterThan(0);
    }
    expect(seen.at(-1)!.state.card_facts).toBeTruthy();
  });
});

describe("the offer asked in one request (doc 002: parallel questions)", () => {
  const cardsReq = (index: number, salt?: string, kind: "stat" | "affix" | "spell" = "stat") => ({
    room_index: index, pool: cardPool(ITEMS, [], kind, [{ shape: "bolt", count: 1, affixes: [] }], {}, { hurt: true }), count: salt ? 1 : 3,
    pity: false, temptation: false, ...(salt ? { salt } : {}),
  });

  it("rides in the room's round 1 and answers as the separate requests would", async () => {
    const seen: import("./director.ts").ObservedRequest[] = [];
    const d = createDirector("rule", { observe: (r) => seen.push(r) });
    const choices = portalChoices(run(6), new RngSource("m").stream("c"), 3);
    const req = cardsReq(6);
    const room = await d.planRoom(ctx(6), { room_index: 6, door_slot: 0, room_type: "combat" }, "build", { portals: choices, cards: [req] });
    expect(seen.map((r) => `${r.meta.purpose}:${r.meta.round}`)).toEqual(["room:1", "room:2"]);
    expect(Object.keys(seen[0]!.questions)).toEqual(expect.arrayContaining(["space", "portal_need", "overall", "variety"]));
    const alone = createDirector("rule");
    expect(room.offer?.portals?.doors).toEqual((await alone.planPortals(ctx(6), choices)).doors);
    expect(room.offer?.cards[0]?.ids).toEqual((await alone.planCards(ctx(6), req)).ids);
  });

  it("asks a vendor's three shelves and its portals together, each shelf scoped by its salt", async () => {
    const seen: import("./director.ts").ObservedRequest[] = [];
    const d = createDirector("rule", { observe: (r) => seen.push(r) });
    const shelves = [cardsReq(8, "shop_stat", "stat"), cardsReq(8, "shop_affix", "affix"), cardsReq(8, "shop_spell", "spell")];
    const plan = await d.planOffer(ctx(8), { portals: portalChoices(run(8), new RngSource("v").stream("c"), 3), cards: shelves });
    // One request for the shelves and the portals' need ranking; a second,
    // small one for the promises, and only if a spell or stat door won one.
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.length).toBeLessThanOrEqual(2);
    expect(seen[0]!.questions.shop_stat__overall).toBeTruthy();
    expect(seen[0]!.state.shop_affix__card_facts).toBeTruthy();
    if (seen[1])
      expect(Object.keys(seen[1].questions).every((n) => n === "spell_school" || n === "stat_family")).toBe(true);
    expect(plan.portals?.doors.length).toBe(3);
    const alone = createDirector("rule");
    for (const [i, req] of shelves.entries())
      expect(plan.cards[i]?.ids).toEqual((await alone.planCards(ctx(8), req)).ids);
  });

  it("refreshes three merchant shelves in one Jev request", async () => {
    const seen: import("./director.ts").ObservedRequest[] = [];
    const evaluate: Evaluator = async (req) => ({
      answers: Object.fromEntries(Object.entries(req.questions).map(([name, question]) => {
        const ids = Object.keys(question.criteria);
        const choice = ids.find((id) => id !== FALLBACK)!;
        return [name, {
          choice, probabilities: Object.fromEntries(ids.map((id) => [id, id === choice ? 1 : 0])),
          confidence: null,
        }];
      })),
      usage: { input_tokens: null },
    });
    const shelves = [cardsReq(8, "reroll_shop_1_stat", "stat"),
      cardsReq(8, "reroll_shop_1_affix", "affix"), cardsReq(8, "reroll_shop_1_spell", "spell")];
    const plan = await createDirector("jev", { evaluate, observe: (request) => seen.push(request) })
      .planOffer(ctx(8), { cards: shelves, purpose: "reroll_shop_1" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.meta.purpose).toBe("reroll_shop_1");
    expect(plan.cards).toHaveLength(3);
    expect(plan.cards.every((card) => card.source === "jev")).toBe(true);
  });
});

describe("elite rooms", () => {
  it("always arrive in more than one wave", async () => {
    const d = createDirector("rule");
    for (let seed = 0; seed < 20; seed++) {
      const room = await d.planRoom(ctx(6, { seed: `el${seed}` }), { room_index: 6, door_slot: 0, room_type: "elite" }, "peak");
      expect(room.plan.encounter?.waves.length ?? 0, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(room.profile?.wave_structure).not.toBe("single");
    }
  });
});

describe("the rule arm follows the build (task 9)", () => {
  const blended = async (needs: Parameters<typeof cardPool>[5]) => {
    const pool = cardPool(ITEMS, [], "affix", [{ shape: "bolt", count: 1, affixes: [] }], {}, needs);
    const plan = await createDirector("rule").planCards(ctx(6), { room_index: 6, pool, count: 3, pity: false, temptation: false });
    return plan.blended;
  };

  it("weighs an infusion up when the keys carry its element", async () => {
    const plain = await blended({ style: "spam" });
    const fire = await blended({ style: "spam", elements: ["fire"] });
    expect(fire.kindle!).toBeGreaterThan(plain.kindle! * 1.1);
    // And nothing leaves the pool: every legal affix still has weight.
    expect(Object.values(fire).every((p) => p > 0)).toBe(true);
  });

  it("weighs toward what eases what the last rooms were shortest of", async () => {
    const plain = await blended({ style: "spam" });
    const aim = await blended({ style: "spam", gap: "accuracy" });
    expect(aim.seek!).toBeGreaterThan(plain.seek! * 1.1);
  });

  it("follows the build the keys reveal, not only the style stated", async () => {
    const plain = await blended({ style: "spam" });
    const dot = await blended({ style: "spam", revealed: ["dot"] });
    expect(dot.blight!).toBeGreaterThan(plain.blight! * 1.05);
  });
});

describe("the offer to a full staff, and the run's own history", () => {
  /** Three keys, the first two levelled, the third bare. */
  const fullStaff = (index = 8): RunContext => {
    const base = ctx(index);
    const held = [...ITEMS.values()].filter((i) => Number(i.params["damage"] ?? 0) > 0).slice(0, 3);
    return {
      ...base,
      slots: held.map((i) => plainInstance(i.id)),
      labels: { ...base.labels, build_shape: "formed" },
    };
  };

  /*
   * Doc 007: with every key taken a spell card is two different rewards — a
   * copy raises a level, a new spell replaces one — and the player should get
   * to choose between them rather than be handed one.
   */
  it("always puts both an upgrade and a replacement in a full staff's spell offer", async () => {
    const c = fullStaff();
    const held = c.slots.flatMap((s) => (s ? [s.base] : []));
    const pool = cardPool(ITEMS, [], "spell", [], {}, { keysFree: false, heldSpells: held });
    expect(pool.guarantee).toHaveLength(2);
    for (let seed = 0; seed < 20; seed++) {
      const plan = await createDirector("rule").planCards(
        { ...c, seed: `full${seed}`, run_id: `full${seed}` },
        { room_index: 8, pool, count: 3, pity: false, temptation: false },
      );
      expect(plan.ids.some((id) => held.includes(id))).toBe(true);
      expect(plan.ids.some((id) => !held.includes(id))).toBe(true);
    }
  });

  /*
   * Doc 002's "not this one": a badge on every one of the last three offers
   * loses one matching clause the others keep, so the offer moves on. It is a
   * damping, not a filter — the kind stays on the list.
   */
  it("damps a reward kind the run has offered three rooms running", async () => {
    const d = createDirector("rule");
    const base = fullStaff(6);
    const need = async (running: string[][]) => {
      const c: RunContext = { ...base, history: { ...base.history, doors_offered: running } };
      const plan = await d.planPortals(c, portalChoices(run(6), new RngSource("x").stream("c")));
      const dist = plan.decisions.find((x) => x.question === "portal_need")?.probabilities ?? {};
      return dist;
    };
    const varied = await need([["affix", "stat"], ["spell", "gold"], ["stat", "gold"]]);
    const stuck = await need([["affix", "stat"], ["affix", "gold"], ["affix", "spell"]]);
    expect(stuck["affix"]!).toBeLessThan(varied["affix"]!);
    // Damped, never removed: a player who still needs affixes still gets them.
    expect(stuck["affix"]!).toBeGreaterThan(0);
  });

  /*
   * The look-only questions were 91% to 100% one answer each because all four
   * read the same three health labels. They now read the last room's answer.
   */
  it("varies the room's look from the last room's, on the same player state", async () => {
    const d = createDirector("rule");
    const look = async (last: "mirrored" | "asymmetric") => {
      const base = fullStaff(6);
      const c: RunContext = {
        ...base,
        history: { ...base.history, symmetries: [last], moods: [{ temperature: "warm", brightness: "dim", particle_intensity: "busy" }] },
      };
      const plan = await d.planRoom(c, { room_index: 6, door_slot: 0, room_type: "combat" }, "build");
      return plan.decisions.find((x) => x.question === "symmetry")?.probabilities ?? {};
    };
    const afterMirrored = await look("mirrored");
    const afterAsymmetric = await look("asymmetric");
    expect(afterMirrored["asymmetric"]!).toBeGreaterThan(afterAsymmetric["asymmetric"]!);
  });
});
