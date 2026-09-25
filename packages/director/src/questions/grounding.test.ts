/**
 * Every question Jev is asked, checked against design doc 002's question
 * conventions — mechanically, over the requests the Director actually makes.
 *
 * The rules this enforces were all broken at least once by hand-written option
 * text, and each break cost real calls to find:
 *
 * - an option that names no state label gives Jev nothing to match, and the
 *   unmatched mass lands on the escape option (`npc_room` declined a third of
 *   the time because "the build is already set" binds to nothing);
 * - an option that names a label the request does not carry is the same bug
 *   with a more convincing sentence (`composition` said "presses a long-range
 *   build" to a state that never held `archetype`);
 * - a raw number in state is not a label at all (`pressure_cap: 5`);
 * - two options with the same text are one option asked twice.
 *
 * The requests are collected through `observe`, on the rule arm, so the check
 * runs over the real question builders with no Jev call and no network.
 */
import { describe, expect, it } from "vitest";
import {
  ITEMS, MAX_HEARTS, assertNoRawNumbers, bucketClearSpeed, bucketGold, bucketHealth,
  bucketMovementPressure, bucketRecentDamage, bucketRunProgress, cardPool, emptyHistory, gapOf,
  plainInstance, portalChoices, RngSource, heldDominantTags, } from "@jr/core";
import type { Archetype, RunContext } from "@jr/core";
import { createDirector } from "../director.ts";
import type { ObservedRequest } from "../director.ts";
import { FALLBACK } from "../types.ts";
import { FIT_FIELDS, fitPairs } from "./fits.ts";
import { FALLBACK_TEXT, optionText } from "./common.ts";

function ctx(over: {
  index?: number; hearts?: number; gold?: number; damage?: number; clearMs?: number;
  preset?: Archetype; seed?: string;
} = {}): RunContext {
  const index = over.index ?? 9;
  const staff = { slots: 6, mana_max: 120 };
  const slots = [plainInstance("magic_bolt"), plainInstance("spark_spray"), null];
  const seed = over.seed ?? "grounding";
  return {
    run_id: seed, seed, room_index: index,
    labels: {
      health: bucketHealth(over.hearts ?? MAX_HEARTS),
      recent_damage: bucketRecentDamage(over.damage ?? 0),
      clear_speed: bucketClearSpeed(over.clearMs ?? 30_000, 30_000),
      movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(index),
      gold: bucketGold(over.gold ?? 40),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "on_plan" },
    },
    staff, slots, inventory: [],
    // Ends on a build, not a peak: after a peak `tensionsAfter` removes `peak`
    // from the option list, and a fixture that always did that would never see
    // the question's full option set.
    history: { ...emptyHistory(), rooms: ["combat", "combat"], tensions: ["peak", "build"], hearts_lost: [1, 2] },
    intent: { preset: over.preset ?? "spam" },
  };
}

/** Every request the Director makes for one room, on the rule arm. */
async function requests(over: Parameters<typeof ctx>[0] = {}): Promise<ObservedRequest[]> {
  const seen: ObservedRequest[] = [];
  const director = createDirector("rule", { observe: (r) => seen.push(r) });
  const c = ctx(over);
  const choices = portalChoices(
    { roomIndex: c.room_index, lastWasElite: false, critical: false, style: c.intent.preset },
    new RngSource(c.seed).stream("count"), 3,
  );
  const needs = {
    style: c.intent.preset, revealed: c.labels.preference.dominant,
    gap: gapOf(c.labels.observed),
  };
  const pool = cardPool(ITEMS, [], "spell", [], {}, needs);
  // An affix pool too, because `affix_intent` is only asked for one and would
  // otherwise never be seen by any of the checks below.
  const affixes = cardPool(ITEMS, [], "affix", [{ shape: "bolt", count: 1, affixes: [] }], {}, needs);
  await director.planRoom(
    c, { room_index: c.room_index, door_slot: 0, room_type: "combat" }, "build",
    {
      portals: choices,
      cards: [
        { room_index: c.room_index, pool, count: 3, pity: false, temptation: true },
        { room_index: c.room_index, pool: affixes, count: 3, pity: false, temptation: false, salt: "affix" },
      ],
    },
  );
  await director.planRoom(
    c, { room_index: c.room_index, door_slot: 1, room_type: "elite" }, "peak",
  );
  return seen;
}

/** A state field's value, under either its flat name or a nested path. */
function stateValue(state: Readonly<Record<string, unknown>>, field: string): unknown {
  if (field in state) return state[field];
  for (const v of Object.values(state))
    if (v && typeof v === "object" && !Array.isArray(v) && field in (v as Record<string, unknown>))
      return (v as Record<string, unknown>)[field];
  return undefined;
}

let collected: ObservedRequest[] | null = null;
async function all(): Promise<ObservedRequest[]> {
  if (!collected)
    collected = [
      ...(await requests({ hearts: 6, clearMs: 14_000, gold: 80 })),
      ...(await requests({ hearts: 2, damage: 3, clearMs: 75_000, gold: 5, preset: "melee", seed: "behind" })),
      // Mid-run and unhurt, which is where the pacing cap allows a peak and
      // the rooms declare the spawn groups the late fixtures do not.
      ...(await requests({ index: 5, hearts: 5, clearMs: 20_000, gold: 40, preset: "area", seed: "mid" })),
      // The very first room, where the run-progress ramp is at its tightest.
      ...(await requests({ index: 1, hearts: 6, clearMs: 20_000, gold: 0, seed: "opening" })),
    ];
  return collected;
}

describe("every question is grounded in the state it is asked with (doc 002)", () => {
  /*
   * The shape of the schedule, not just of the questions. A combat room is two
   * requests: `next_tension` rides in round 1 with the room's own questions
   * (doc 004), and `planDoors` asks nothing at all. Asked as a third request it
   * cost every room an extra sequential call for an answer that reads exactly
   * the state round 1 already carries.
   */
  it("asks the tension inside the room's round 1, and makes no separate request for it", async () => {
    const seen = await all();
    const rounds = seen.filter((r) => Object.keys(r.questions).includes("next_tension"));
    expect(rounds.length, "next_tension is never asked").toBeGreaterThan(0);
    for (const r of rounds) {
      expect(r.meta.purpose).toBe("room");
      expect(r.meta.round).toBe(1);
      // It travels with the room's own questions, which is what makes it free.
      expect(Object.keys(r.questions)).toContain("space");
    }
    expect(seen.some((r) => r.meta.purpose === "doors")).toBe(false);
    // Two requests per room, no more: round 1 and round 2.
    const perRoom = new Map<string, number>();
    for (const r of seen.filter((x) => x.meta.purpose === "room")) {
      const k = `${r.meta.run_id}/${r.meta.room_index}/${r.meta.door_slot}`;
      perRoom.set(k, (perRoom.get(k) ?? 0) + 1);
    }
    for (const [room, n] of perRoom) expect(n, `room ${room} made ${n} requests`).toBe(2);
  });

  /*
   * Doc 002: questions in one request are answered independently. A round-1
   * option that named the tension would be matching a label the same request
   * is deciding — a dependency Jev cannot honour, and a label the round-1
   * state deliberately does not carry.
   */
  it("lets no round-1 question read the tension its own request decides", async () => {
    const leaks: string[] = [];
    for (const r of await all()) {
      if (r.meta.purpose !== "room" || r.meta.round !== 1) continue;
      expect(r.state).not.toHaveProperty("tension");
      for (const [name, q] of Object.entries(r.questions)) {
        for (const text of Object.values(q.criteria))
          if (fitPairs(optionText(text)).some((f) => f.field === "tension")) leaks.push(`${name}: an option names the tension`);
        if (q.instructions.includes("tension") && name !== "next_tension")
          leaks.push(`${name}: the instructions name the tension`);
      }
    }
    expect([...new Set(leaks)]).toEqual([]);
  });

  /*
   * Doc 005's ramp is a filter, not a preference: the caps that hold a fight's
   * size were written for the late run, and applied from room 1 they let the
   * opening arrive as a wall. Doc 002 asks that code remove illegal options
   * before either arm answers, so an option the ramp forbids is never offered
   * — the clamp inside the assembler is the floor under that, not the gate.
   */
  it("offers no dense room and no anchor in the opening rooms", async () => {
    const opening = (await all()).filter((r) => r.meta.run_id === "opening" && r.meta.round === 2);
    expect(opening.length).toBeGreaterThan(0);
    for (const r of opening) {
      const density = r.questions["density"];
      const anchor = r.questions["anchor"];
      if (density) expect(Object.keys(density.criteria)).not.toContain("dense");
      if (anchor) {
        expect(Object.keys(anchor.criteria)).not.toContain("tank");
        expect(Object.keys(anchor.criteria)).not.toContain("summoner");
      }
    }
    // ...and the late fixtures still see the whole range, or the filter is a ban.
    const late = (await all()).filter((r) => r.meta.run_id !== "opening" && r.meta.round === 2);
    const densities = new Set(late.flatMap((r) => Object.keys(r.questions["density"]?.criteria ?? {})));
    expect(densities).toContain("dense");
  });

  /** Round 2 is a later request, so it is entitled to the answer. */
  it("carries the run's recent history, as labels rather than as a sequence", async () => {
    const round1 = (await all()).filter((r) => r.meta.purpose === "room" && r.meta.round === 1);
    expect(round1.length).toBeGreaterThan(0);
    for (const r of round1) {
      expect(FIT_FIELDS.last_tension as readonly string[]).toContain(r.state["last_tension"]);
      expect(FIT_FIELDS.since_release as readonly string[]).toContain(r.state["since_release"]);
      expect(FIT_FIELDS.last_room_kind as readonly string[]).toContain(r.state["last_room_kind"]);
      expect(FIT_FIELDS.damage_trend as readonly string[]).toContain(r.state["damage_trend"]);
      expect(FIT_FIELDS.damage_rate as readonly string[]).toContain(r.state["damage_rate"]);
      expect(FIT_FIELDS.keys_lean as readonly string[]).toContain(r.state["keys_lean"]);
      expect(FIT_FIELDS.sword_share as readonly string[]).toContain(r.state["sword_share"]);
    }
  });

  it("does not ask the first room's look, which nothing yet could decide", async () => {
    const opening = (await all()).filter((r) => r.meta.room_index === 1 && r.meta.purpose === "room" && r.meta.round === 1);
    expect(opening.length).toBeGreaterThan(0);
    for (const r of opening)
      for (const name of ["symmetry", "mood_temperature", "mood_brightness", "mood_particles"])
        expect(Object.keys(r.questions), `${name} asked in room 1`).not.toContain(name);
  });

  it("gives round 2 the decided tension", async () => {
    const round2 = (await all()).filter((r) => r.meta.purpose === "room" && r.meta.round === 2);
    expect(round2.length).toBeGreaterThan(0);
    for (const r of round2) expect(["release", "build", "peak"]).toContain(r.state["tension"]);
  });

  it("makes the requests it is supposed to, and no question twice in one request", async () => {
    const seen = await all();
    expect(seen.length).toBeGreaterThan(0);
    const names = new Set(seen.flatMap((r) => Object.keys(r.questions)));
    for (const expected of [
      "next_tension", "space", "symmetry", "size", "mood_temperature", "mood_brightness",
      "mood_particles", "composition", "density", "wave_structure", "anchor", "entry",
      "portal_need", "overall", "for_style", "for_needs", "variety",
      "next_tension",
      // Scoped by the affix offer's salt, so it arrives as `affix__affix_intent`.
      "affix__affix_intent",
    ])
      expect(names, `"${expected}" is never asked`).toContain(expected);
    for (const r of seen)
      expect(Object.keys(r.questions).length).toBe(new Set(Object.keys(r.questions)).size);
  });

  it("names no field the request's state does not carry, and no level that field cannot take", async () => {
    const problems: string[] = [];
    for (const r of await all())
      for (const [name, q] of Object.entries(r.questions))
        for (const [option, text] of Object.entries(q.criteria)) {
          if (option === FALLBACK) continue;
          for (const { field, value } of fitPairs(optionText(text))) {
            const held = stateValue(r.state, field);
            if (held === undefined) problems.push(`${name}/${option}: state has no "${field}"`);
            const legal = FIT_FIELDS[field as keyof typeof FIT_FIELDS] as readonly string[] | undefined;
            if (legal && !legal.includes(value)) problems.push(`${name}/${option}: "${value}" is not a ${field}`);
          }
        }
    expect(problems).toEqual([]);
  });

  it("gives every option a fit clause, so no question can spread its mass onto the escape option", async () => {
    const ungrounded: string[] = [];
    for (const r of await all())
      for (const [name, q] of Object.entries(r.questions)) {
        // The card questions describe content, whose own sentences carry the
        // label words (doc 010); every question code writes for itself must
        // say when its options fit.
        if (["overall", "for_style", "for_needs", "temptation"].includes(name.replace(/^.*__/, ""))) continue;
        for (const [option, text] of Object.entries(q.criteria)) {
          if (option === FALLBACK) continue;
          if (fitPairs(optionText(text)).length === 0) ungrounded.push(`${name}/${option}: ${text}`);
        }
      }
    expect(ungrounded).toEqual([]);
  });

  /*
   * The rule the escape option measures. If no option names the level the
   * state actually holds, every option is a near-miss and the mass goes to
   * `fallback` — which is what `mood_temperature` did: `cold` fitted a release
   * room, `warm` a peak one, and every build room fell between them, at 0.30
   * escape mass on the live model. Some field has to be partitioned.
   */
  it("partitions at least one state field across its options, so every state matches something", async () => {
    /*
     * Taken over the **union** of each question's option sets, because code
     * filters them per room: an elite room may not choose a single wave, a
     * room offers only the entries its own spawn groups support, and a
     * `release_only` cap leaves one tension. Those subsets are allowed to be
     * partial — code removed the rest for reasons Jev does not get a vote on.
     * What may not be partial is the question as written.
     */
    const covered = new Map<string, Map<string, Set<string>>>();
    const sizes = new Map<string, number>();
    const offered = new Map<string, Set<string>>();
    for (const r of await all())
      for (const [name, q] of Object.entries(r.questions)) {
        const key = name.replace(/^zone_.*/, "zone_*").replace(/^.*__/, "");
        const options = Object.entries(q.criteria).filter(([k]) => k !== FALLBACK);
        sizes.set(key, Math.max(sizes.get(key) ?? 0, options.length));
        const ids = offered.get(key) ?? new Set<string>();
        for (const [id] of options) ids.add(id);
        offered.set(key, ids);
        const fields = covered.get(key) ?? new Map<string, Set<string>>();
        for (const [, text] of options)
          for (const { field, value } of fitPairs(optionText(text)))
            fields.set(field, (fields.get(field) ?? new Set()).add(value));
        covered.set(key, fields);
      }

    const gaps: string[] = [];
    for (const [name, fields] of covered) {
      // A question that never offers a choice, and a card question whose
      // options are content descriptions, have nothing to partition.
      if ((sizes.get(name) ?? 0) < 2 || fields.size === 0) continue;
      const whole = [...fields].some(([field, values]) =>
        (FIT_FIELDS[field as keyof typeof FIT_FIELDS] as readonly string[]).every((v) => values.has(v)));
      if (!whole)
        gaps.push(`${name}: no field is covered end to end; options ${offered.get(name)?.size ?? 0} ` +
          `[${[...(offered.get(name) ?? [])].sort().join(",")}]; ` +
          [...fields].map(([f, v]) => `${f}=${[...v].sort().join("/")}`).join(", "));
    }
    expect(gaps).toEqual([]);
  });

  it("offers no two options with the same description, and never an empty one", async () => {
    const duplicates: string[] = [];
    for (const r of await all())
      for (const [name, q] of Object.entries(r.questions)) {
        const texts = Object.entries(q.criteria).filter(([k]) => k !== FALLBACK).map(([, t]) => optionText(t));
        for (const t of texts) expect(t.trim().length, `${name} has an empty option`).toBeGreaterThan(0);
        if (new Set(texts).size !== texts.length) duplicates.push(name);
        expect(optionText(q.criteria[FALLBACK]!)).toBe(FALLBACK_TEXT);
      }
    expect(duplicates).toEqual([]);
  });

  it("sends no raw number to Jev (doc 002, state conventions)", async () => {
    for (const r of await all()) expect(() => assertNoRawNumbers(r.state)).not.toThrow();
  });

  it("names, in its instructions, only labels the request carries", async () => {
    /*
     * Longest phrase first, and each match blanked out before the shorter
     * names are looked for. Otherwise "last tension" counts as a mention of
     * `tension`, and an instruction that correctly names a label the state
     * holds is reported as naming one it does not.
     */
    const fields = Object.keys(FIT_FIELDS).sort((a, b) => b.length - a.length);
    const problems: string[] = [];
    for (const r of await all())
      for (const [name, q] of Object.entries(r.questions)) {
        let text = q.instructions;
        for (const field of fields) {
          const spoken = field.replace(/_/g, " ");
          if (!text.includes(spoken)) continue;
          text = text.split(spoken).join(" ");
          if (stateValue(r.state, field) === undefined)
            problems.push(`${name}: instructions name "${spoken}", which the state does not carry`);
        }
      }
    expect([...new Set(problems)]).toEqual([]);
  });
});
