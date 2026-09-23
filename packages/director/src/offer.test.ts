import { describe, expect, it } from "vitest";
import {
  ITEMS, MAX_HEARTS, bucketClearSpeed, bucketGold, bucketHealth, bucketMovementPressure,
  bucketRecentDamage, bucketRunProgress, cardPool, cardsFor, emptyHistory, plainInstance,
  portalChoices, RngSource, schoolOf, simulateStaff, staffFor,
} from "@jr/core";
import type { RunContext, RunShape } from "@jr/core";
import { createDirector } from "./director.ts";
import { FALLBACK } from "./types.ts";
import type { Evaluator } from "./types.ts";

function ctx(index: number, opts: { hearts?: number; gold?: number; seed?: string } = {}): RunContext {
  const staff = staffFor({ slots: "many", mana: "high", tempo: "steady", special: "none" });
  const slots = [plainInstance("magic_bolt"), null, null];
  const sim = simulateStaff(staff, slots, ITEMS);
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
      build: {
        archetype: sim.archetype, bottleneck: sim.bottleneck, mana_sustain: sim.mana_sustain, range: "mid",
        missing_roles: sim.missing_roles, dominant_tags: sim.dominant_tags,
      },
      preference: { dominant: sim.dominant_tags.slice(0, 3), consistency: "on_plan" },
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
        if (x.reward === "spell" && !x.npc) expect(x.school).toBeTruthy();
        if (x.reward === "stat") expect(x.family).toBeTruthy();
        expect([1, 2, 3]).toContain(x.grade);
        if (x.difficulty === "elite") expect(x.grade).toBeGreaterThanOrEqual(2);
      }
      expect(plan.decisions.some((x) => x.question === "portal_kinds")).toBe(true);
    }
  });

  it("offers no elite where the rules forbid one, and no vendor early or twice running", async () => {
    const d = createDirector("rule");
    for (let seed = 0; seed < 30; seed++) {
      const early = portalChoices(run(2), new RngSource(`e${seed}`).stream("c"));
      expect(early.elite).toBe(false);
      expect(early.npc).toBe(false);
      const after = portalChoices(run(6, { lastWasElite: true, lastWasNpc: true }), new RngSource(`a${seed}`).stream("c"));
      expect(after.elite).toBe(false);
      expect(after.npc).toBe(false);
      const plan = await d.planPortals(ctx(6), after);
      expect(plan.doors.every((x) => x.difficulty === "normal" && !x.npc)).toBe(true);
    }
  });

  it("sometimes, and rarely, puts a vendor behind one door", async () => {
    const d = createDirector("rule");
    let vendors = 0;
    const n = 300;
    for (let seed = 0; seed < n; seed++) {
      const choices = portalChoices(run(7), new RngSource(`v${seed}`).stream("c"), 3);
      const plan = await d.planPortals(ctx(7, { seed: `v${seed}`, gold: 60 }), choices);
      const v = plan.doors.filter((x) => x.npc);
      expect(v.length).toBeLessThanOrEqual(1);
      vendors += v.length;
    }
    expect(vendors).toBeGreaterThan(0);
    expect(vendors / n).toBeLessThan(0.3);
  });

  it("falls back to the rule table when Jev fails, per portal question", async () => {
    const broken: Evaluator = async () => { throw new Error("offline"); };
    const d = createDirector("jev", { evaluate: broken });
    const plan = await d.planPortals(ctx(5), portalChoices(run(5), new RngSource("f").stream("c"), 3));
    expect(plan.source).toBe("rule");
    expect(plan.doors.length).toBe(3);
  });

  it("hands only a declined question to the rule table; the request's other answers stand", async () => {
    const declining: Evaluator = async (req) => ({
      answers: Object.fromEntries(Object.entries(req.questions).map(([name, q]) => {
        const keys = Object.keys(q.criteria);
        const choice = name === "stat_family" ? FALLBACK : keys.find((k) => k !== FALLBACK)!;
        return [name, { choice, probabilities: Object.fromEntries(keys.map((k) => [k, k === choice ? 1 : 0])), confidence: null }];
      })),
      usage: { input_tokens: null },
    });
    const d = createDirector("jev", { evaluate: declining });
    const plan = await d.planPortals(ctx(5), portalChoices(run(5), new RngSource("f").stream("c"), 3));
    const by = Object.fromEntries(plan.decisions.map((x) => [x.question, x]));
    expect(by["stat_family"]).toMatchObject({ source: "rule", fallback_path: "declined" });
    expect(by["portal_kinds"]?.source).toBe("jev");
    expect(by["spell_school"]?.source).toBe("jev");
  });
});

describe("the Director's cards (doc 007)", () => {
  it("keeps a door's promise: a school with enough spells is the whole pool", async () => {
    const d = createDirector("rule");
    const promise = { school: "flame", grade: 2 };
    const pool = cardPool(ITEMS, ["magic_bolt"], "spell", [], promise, { style: "dot" });
    const plan = await d.planCards(ctx(4), { room_index: 4, pool, count: 3, pity: false, temptation: false });
    const cards = cardsFor(ITEMS, "spell", plan.ids, promise);
    expect(cards.length).toBe(3);
    const flame = cards.filter((c) => schoolOf(c.itemId) === "flame").length;
    const inSchool = pool.forced.length + pool.candidates.filter((c) => c.facts.includes("promised")).length;
    expect(flame).toBe(Math.min(3, inSchool));
    for (const c of cards) expect(c.grade).toBe(2);
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
    const pool = cardPool(ITEMS, [], "affix", ["bolt"], {}, {});
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
    expect(seen.map((r) => r.meta.purpose)).toEqual(["portals", "cards:stat:shop-stat"]);
    for (const r of seen) {
      expect(r.state.health).toBeTruthy();
      for (const name of Object.keys(r.questions)) expect(Object.keys(r.dists[name] ?? {}).length).toBeGreaterThan(0);
    }
    expect(seen[1]!.state.card_facts).toBeTruthy();
  });
});

describe("the offer asked in one request (doc 002: parallel questions)", () => {
  const cardsReq = (index: number, salt?: string, kind: "stat" | "affix" | "spell" = "stat") => ({
    room_index: index, pool: cardPool(ITEMS, [], kind, ["bolt"], {}, { hurt: true }), count: salt ? 1 : 3,
    pity: false, temptation: false, ...(salt ? { salt } : {}),
  });

  it("rides in the room's round 1 and answers as the separate requests would", async () => {
    const seen: import("./director.ts").ObservedRequest[] = [];
    const d = createDirector("rule", { observe: (r) => seen.push(r) });
    const choices = portalChoices(run(5), new RngSource("m").stream("c"), 3);
    const req = cardsReq(5);
    const room = await d.planRoom(ctx(5), { room_index: 5, door_slot: 0, room_type: "combat" }, "build", { portals: choices, cards: [req] });
    expect(seen.map((r) => `${r.meta.purpose}:${r.meta.round}`)).toEqual(["room:1", "room:2"]);
    expect(Object.keys(seen[0]!.questions)).toEqual(expect.arrayContaining(["space", "portal_kinds", "overall", "variety"]));
    const alone = createDirector("rule");
    expect(room.offer?.portals?.doors).toEqual((await alone.planPortals(ctx(5), choices)).doors);
    expect(room.offer?.cards[0]?.ids).toEqual((await alone.planCards(ctx(5), req)).ids);
  });

  it("asks a vendor's three shelves and its portals together, each shelf scoped by its salt", async () => {
    const seen: import("./director.ts").ObservedRequest[] = [];
    const d = createDirector("rule", { observe: (r) => seen.push(r) });
    const shelves = [cardsReq(8, "shop_stat", "stat"), cardsReq(8, "shop_affix", "affix"), cardsReq(8, "shop_spell", "spell")];
    const plan = await d.planOffer(ctx(8), { portals: portalChoices(run(8), new RngSource("v").stream("c"), 3), cards: shelves });
    expect(seen.length).toBe(1);
    expect(seen[0]!.questions.shop_stat__overall).toBeTruthy();
    expect(seen[0]!.state.shop_affix__card_facts).toBeTruthy();
    expect(plan.portals?.doors.length).toBe(3);
    const alone = createDirector("rule");
    for (const [i, req] of shelves.entries())
      expect(plan.cards[i]?.ids).toEqual((await alone.planCards(ctx(8), req)).ids);
  });
});

describe("elite rooms", () => {
  it("always arrive in more than one wave", async () => {
    const d = createDirector("rule");
    for (let seed = 0; seed < 20; seed++) {
      const room = await d.planRoom(ctx(5, { seed: `el${seed}` }), { room_index: 5, door_slot: 0, room_type: "elite" }, "peak");
      expect(room.plan.encounter?.waves.length ?? 0, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(room.profile?.wave_structure).not.toBe("single");
    }
  });
});

describe("the rule arm follows the build (task 9)", () => {
  const blended = async (needs: Parameters<typeof cardPool>[5]) => {
    const pool = cardPool(ITEMS, [], "affix", ["bolt"], {}, needs);
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

  it("weighs toward what eases the build's bottleneck", async () => {
    const plain = await blended({ style: "spam" });
    const aim = await blended({ style: "spam", bottleneck: "accuracy" });
    expect(aim.seek!).toBeGreaterThan(plain.seek! * 1.1);
  });

  it("follows the build the keys reveal, not only the style stated", async () => {
    const plain = await blended({ style: "spam" });
    const dot = await blended({ style: "spam", revealed: ["dot"] });
    expect(dot.blight!).toBeGreaterThan(plain.blight! * 1.05);
  });
});
