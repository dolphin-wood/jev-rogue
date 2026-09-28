import { describe, expect, it } from "vitest";
import {
  AUTO_CAST_DELAY_MS, AUTO_CAST_MAX_WEIGHT, AUTO_CAST_MIN_WEIGHT, AUTO_CAST_MISS_WEIGHT, AUTO_CAST_SPREAD_MS,
  AUTO_CAST_START_WEIGHT, AUTO_CAST_MAX_REACH_PX, AutoCaster, autoCastable, autoCastAnyReach, autoCastReach,
} from "./auto-cast.ts";
import type { AutoCastBar } from "./auto-cast.ts";
import { ITEMS, TILE_PX } from "@jr/core";

/** A key that can go now. */
const on = { held: true, ready: true, cost: 0 };
/** Held, but sitting the draw out: cooling down, out of reach, or still running. */
const out = { held: true, ready: false, cost: 0 };
/** An empty key, or one holding a spell the assist never presses. */
const off = { held: false, ready: false, cost: 0 };
const full: AutoCastBar = { mana: 100, floor: 30, max: 100 };
/** A deterministic stream for the draws. */
const lcg = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };

describe("auto-cast", () => {
  it("never presses a spell that moves the body: every dash, Dash Slash among them", () => {
    const dashes = [...ITEMS.values()].filter((i) => i.params["shape"] === "dash").map((i) => i.id);
    expect(dashes).toEqual(expect.arrayContaining(["blink_strike", "leap_slam", "dash_slash"]));
    for (const id of dashes) expect(autoCastable(ITEMS.get(id)!.params, 0), id).toBe(false);
    expect(autoCastable(ITEMS.get("magic_bolt")!.params, 0)).toBe(true);
  });

  it("waits a random beat before a key presses itself, never pressing it at once", () => {
    const a = new AutoCaster(() => 0.5);
    const wait = AUTO_CAST_DELAY_MS + 0.5 * AUTO_CAST_SPREAD_MS;
    expect(a.pick(0, [on], true, full)).toBe(null);
    expect(a.pick(wait - 1, [on], true, full)).toBe(null);
    expect(a.pick(wait, [on], true, full)).toBe(0);
    // Pressed once, not every step after.
    expect(a.pick(wait + 16, [on], true, full)).toBe(null);
  });

  it("starts the beat over when the player presses a key, and counts the press as that key's turn", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [on, on], true, full);
    a.noteManual(1);
    expect(a.weight(1)).toBeCloseTo(AUTO_CAST_MIN_WEIGHT);
    expect(a.pick(AUTO_CAST_DELAY_MS, [on, out], true, full)).toBe(null);
    expect(a.pick(2 * AUTO_CAST_DELAY_MS, [on, out], true, full)).toBe(0);
  });

  it("holds the beat while the caster is busy, and presses once free", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [on], true, full);
    expect(a.pick(AUTO_CAST_DELAY_MS, [on], false, full)).toBe(null);
    expect(a.pick(AUTO_CAST_DELAY_MS + 16, [on], true, full)).toBe(0);
  });

  it("skips the frame when nothing can go, moving no weight, and casts the moment something can", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [out, out], true, full);
    for (let t = AUTO_CAST_DELAY_MS; t < 5 * AUTO_CAST_DELAY_MS; t += 16) expect(a.pick(t, [out, out], true, full)).toBe(null);
    expect(a.weight(0)).toBeCloseTo(AUTO_CAST_START_WEIGHT);
    expect(a.weight(1)).toBeCloseTo(AUTO_CAST_START_WEIGHT);
    expect(a.pick(5 * AUTO_CAST_DELAY_MS, [out, on], true, full)).toBe(1);
  });

  it("never casts two keys back to back: the beat starts over after a cast, counted from when the hands are free", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [on, on], true, full);
    expect(a.pick(AUTO_CAST_DELAY_MS, [on, on], true, full)).not.toBe(null);
    // The cast's windup and recovery.
    const freeAt = AUTO_CAST_DELAY_MS + 500;
    for (let t = AUTO_CAST_DELAY_MS + 16; t < freeAt; t += 16) expect(a.pick(t, [on, on], false, full)).toBe(null);
    // Free again: the other key waits a full beat first.
    expect(a.pick(freeAt, [on, on], true, full)).toBe(null);
    expect(a.pick(freeAt + AUTO_CAST_DELAY_MS - 1, [on, on], true, full)).toBe(null);
    expect(a.pick(freeAt + AUTO_CAST_DELAY_MS, [on, on], true, full)).not.toBe(null);
  });

  it("raises every key that loses a draw, sat out or not, and drops the one that casts", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [on, out, off], true, full);
    // Key 0 is the only one that can go, and does.
    expect(a.pick(AUTO_CAST_DELAY_MS, [on, out, off], true, full)).toBe(0);
    expect(a.weight(0)).toBeCloseTo(AUTO_CAST_MIN_WEIGHT);
    // Key 1 sat the draw out and is owed for it; key 2 holds nothing and is not.
    expect(a.weight(1)).toBeCloseTo(AUTO_CAST_START_WEIGHT + AUTO_CAST_MISS_WEIGHT);
    expect(a.weight(2)).toBeCloseTo(AUTO_CAST_START_WEIGHT);
    // It grows no further than the cap.
    for (let n = 0, t = 2 * AUTO_CAST_DELAY_MS; n < 20; n++, t += 2 * AUTO_CAST_DELAY_MS) {
      a.pick(t, [on, out, off], true, full);
      a.pick(t + AUTO_CAST_DELAY_MS, [on, out, off], true, full);
    }
    expect(a.weight(1)).toBeCloseTo(AUTO_CAST_MAX_WEIGHT);
  });

  it("gives an enchant back its turn once it runs out: it was owed every draw it sat out", () => {
    // Key 0 an enchant on the sword, key 1 a spell always ready (Meteor). While
    // the enchant runs, key 1 takes every turn; once it has run out, the
    // enchant goes first nearly every time.
    const rand = lcg(11);
    let enchantFirst = 0;
    const trials = 200;
    for (let n = 0; n < trials; n++) {
      const a = new AutoCaster(rand);
      let t = 0;
      for (let c = 0; c < 3; c++) {
        for (; t < 1e6; t += 16) if (a.pick(t, [out, on], true, full) !== null) break;
        t += 16;
      }
      for (; t < 1e6; t += 16) {
        const k = a.pick(t, [on, on], true, full);
        if (k !== null) { if (k === 0) enchantFirst++; break; }
      }
    }
    expect(enchantFirst / trials).toBeGreaterThan(0.9);
  });

  it("saves the bar for the key most owed: nothing is cast while it is back but short", () => {
    const a = new AutoCaster(() => 0.5);
    const beat = AUTO_CAST_DELAY_MS + 0.5 * AUTO_CAST_SPREAD_MS;
    const cheap = { held: true, ready: true, cost: 5 };
    const dear = { held: true, ready: true, cost: 50 };
    // Key 1 is owed: it sat a draw out.
    a.pick(0, [cheap, out], true, full);
    expect(a.pick(beat, [cheap, out], true, full)).toBe(0);
    // Back now, but 60 in the bar pays for it only down to 10, under the floor of 30.
    const short = { mana: 60, floor: 30, max: 100 };
    let t = beat + 16;
    a.pick(t, [cheap, dear], true, short);
    for (t += beat; t < 6 * beat; t += 16) expect(a.pick(t, [cheap, dear], true, short)).toBe(null);
    // The bar fills to 80: it goes (the draw, 0.5 of weights 0.1 and 1.5, lands on it).
    expect(a.pick(t, [cheap, dear], true, { mana: 80, floor: 30, max: 100 })).toBe(1);
  });

  it("does not save for a key the bar could never pay for", () => {
    const a = new AutoCaster(() => 0);
    // Key 1 sits a draw out, so it is the most owed.
    a.pick(0, [on, out], true, full);
    a.pick(AUTO_CAST_DELAY_MS, [on, out], true, full);
    // Back, but it costs more than the bar holds above the floor: key 0 goes rather than the bar waiting forever.
    const never = { held: true, ready: true, cost: 90 };
    const t = 2 * AUTO_CAST_DELAY_MS;
    a.pick(t, [on, never], true, full);
    expect(a.pick(t + AUTO_CAST_DELAY_MS, [on, never], true, full)).toBe(0);
  });

  it("does not let the short cheap keys starve the long dear one of the bar", () => {
    // 1 s, 3 s and 8 s keys costing 6, 15 and 30 of a 100 bar that refills 6 a
    // second, above a floor of 30, over ten minutes of fight, each cast holding
    // the hands for half a second. Drawn only among what can go, with nothing
    // saved, the 8 s key went 8 times.
    const a = new AutoCaster(lcg(7));
    const cd = [1000, 3000, 8000];
    const cost = [6, 15, 30];
    const back = [0, 0, 0];
    const casts = [0, 0, 0];
    let mana = 100;
    let busy = 0;
    for (let now = 0; now < 600_000; now += 16) {
      mana = Math.min(100, mana + 6 * 0.016);
      const keys = cd.map((_, i) => ({ held: true, ready: back[i]! <= now, cost: cost[i]! }));
      const k = a.pick(now, keys, now >= busy, { mana, floor: 30, max: 100 });
      if (k !== null) { casts[k]!++; back[k] = now + cd[k]!; mana -= cost[k]!; busy = now + 500; }
    }
    expect(casts[2]).toBeGreaterThan(40);
    expect(casts[0]! / casts[2]!).toBeLessThan(4);
  });

  it("gives every spell a reach of its own, short spells short and none past the screen", () => {
    const reach = (id: string) => autoCastReach(ITEMS.get(id)!.params!);
    // An enchant and a companion are cast at the fight, whatever their reach says.
    expect(autoCastAnyReach(ITEMS.get("crescent_edge")!.params!)).toBe(true);
    expect(autoCastAnyReach(ITEMS.get("spirit_ally")!.params!)).toBe(true);
    expect(autoCastAnyReach(ITEMS.get("meteor")!.params!)).toBe(false);
    for (const [id, item] of ITEMS) {
      if (!item.params) continue;
      const r = autoCastReach(item.params);
      expect(r, id).toBeGreaterThan(0);
      expect(r, id).toBeLessThanOrEqual(AUTO_CAST_MAX_REACH_PX);
    }
    // A ring round the caster and a nova are close-in; a bolt flies far.
    expect(reach("quake_ring")).toBeLessThan(4 * TILE_PX);
    expect(reach("frost_nova")).toBeLessThan(6 * TILE_PX);
    expect(reach("magic_bolt")).toBeGreaterThan(8 * TILE_PX);
    // A line of spikes reaches its last cell and no further.
    expect(reach("earth_spikes")).toBeLessThan(reach("magic_bolt"));
  });
});
