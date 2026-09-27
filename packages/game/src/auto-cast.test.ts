import { describe, expect, it } from "vitest";
import {
  AUTO_CAST_DELAY_MS, AUTO_CAST_MAX_WEIGHT, AUTO_CAST_MIN_WEIGHT, AUTO_CAST_MISS_WEIGHT, AUTO_CAST_SPREAD_MS,
  AUTO_CAST_START_WEIGHT, AUTO_CAST_WAIT_MS, AUTO_CAST_MAX_REACH_PX, AutoCaster, autoCastable, autoCastAnyReach,
  autoCastReach,
} from "./auto-cast.ts";
import { ITEMS, TILE_PX } from "@jr/core";

const on = { eligible: true, coming: true, held: true };
const soon = { eligible: false, coming: true, held: true };
/** Held, but sitting the draw out: cooling down, out of reach, or an enchant still running. */
const out = { eligible: false, coming: false, held: true };
const off = { eligible: false, coming: false, held: false };

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
    expect(a.pick(0, [on], true)).toBe(null);
    expect(a.pick(wait - 1, [on], true)).toBe(null);
    expect(a.pick(wait, [on], true)).toBe(0);
    // Pressed once, not every step after.
    expect(a.pick(wait + 16, [on], true)).toBe(null);
  });

  it("starts the beat over when the player presses a key themselves", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [on], true);
    a.noteManual(0);
    expect(a.pick(AUTO_CAST_DELAY_MS, [on], true)).toBe(null);
    expect(a.pick(2 * AUTO_CAST_DELAY_MS, [on], true)).toBe(0);
  });

  it("starts the beat over when no key is left in the draw", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [on], true);
    a.pick(AUTO_CAST_DELAY_MS - 1, [off], true);
    expect(a.pick(AUTO_CAST_DELAY_MS, [on], true)).toBe(null);
  });

  it("holds the beat while the caster is busy, and presses once free", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [on], true);
    expect(a.pick(AUTO_CAST_DELAY_MS, [on], false)).toBe(null);
    expect(a.pick(AUTO_CAST_DELAY_MS + 16, [on], true)).toBe(0);
  });

  it("never casts two keys back to back: the beat starts over after a cast, counted from when the hands are free", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [on, on], true);
    // Both keys are due at once; one goes.
    const first = a.pick(AUTO_CAST_DELAY_MS, [on, on], true);
    expect(first).not.toBe(null);
    // The cast's windup and recovery: no wait runs while it is in the hand.
    const freeAt = AUTO_CAST_DELAY_MS + 500;
    for (let t = AUTO_CAST_DELAY_MS + 16; t < freeAt; t += 16) expect(a.pick(t, [on, on], false)).toBe(null);
    // Free again: the other key was due long ago, but waits a full beat first.
    expect(a.pick(freeAt, [on, on], true)).toBe(null);
    expect(a.pick(freeAt + AUTO_CAST_DELAY_MS - 1, [on, on], true)).toBe(null);
    expect(a.pick(freeAt + AUTO_CAST_DELAY_MS, [on, on], true)).not.toBe(null);
  });

  it("raises every key that loses a draw, sat out or not, and drops the one that casts", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [on, out, off], true);
    // Key 0 is the only one in the draw, and wins it.
    expect(a.pick(AUTO_CAST_DELAY_MS, [on, out, off], true)).toBe(0);
    expect(a.weight(0)).toBeCloseTo(AUTO_CAST_MIN_WEIGHT);
    // Key 1 sat the draw out and is owed for it; key 2 holds nothing and is not.
    expect(a.weight(1)).toBeCloseTo(AUTO_CAST_START_WEIGHT + AUTO_CAST_MISS_WEIGHT);
    expect(a.weight(2)).toBeCloseTo(AUTO_CAST_START_WEIGHT);
    // It grows no further than the cap.
    for (let n = 0, t = 2 * AUTO_CAST_DELAY_MS; n < 20; n++, t += 2 * AUTO_CAST_DELAY_MS) {
      a.pick(t, [on, out, off], true);
      a.pick(t + AUTO_CAST_DELAY_MS, [on, out, off], true);
    }
    expect(a.weight(1)).toBeCloseTo(AUTO_CAST_MAX_WEIGHT);
  });

  it("gives an enchant back its turn once it runs out: it was owed every draw it sat out", () => {
    // Key 0 an enchant on the sword, key 1 a spell always ready (Meteor). While
    // the enchant runs, key 1 takes every turn; once it has run out, the
    // enchant goes first nearly every time.
    let seed = 11;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    let enchantFirst = 0;
    const trials = 200;
    for (let n = 0; n < trials; n++) {
      const a = new AutoCaster(rand);
      let t = 0;
      for (let c = 0; c < 3; c++) {
        for (; t < 1e6; t += 16) if (a.pick(t, [out, on], true) !== null) break;
        t += 16;
      }
      for (; t < 1e6; t += 16) {
        const k = a.pick(t, [on, on], true);
        if (k !== null) { if (k === 0) enchantFirst++; break; }
      }
    }
    expect(enchantFirst / trials).toBeGreaterThan(0.9);
  });

  it("takes the player's press as the key's turn: its weight drops, and the beat starts over", () => {
    const a = new AutoCaster(() => 0);
    // Key 1 sat a draw out and is owed for it.
    a.pick(0, [on, out], true);
    expect(a.pick(AUTO_CAST_DELAY_MS, [on, out], true)).toBe(0);
    expect(a.weight(1)).toBeCloseTo(AUTO_CAST_START_WEIGHT + AUTO_CAST_MISS_WEIGHT);
    // The player casts key 1 by hand: its weight goes down, not up.
    const t = 2 * AUTO_CAST_DELAY_MS;
    a.pick(t, [on, on], true);
    a.noteManual(1);
    expect(a.weight(1)).toBeCloseTo(AUTO_CAST_MIN_WEIGHT);
    // And the beat starts over from the press.
    expect(a.pick(t + AUTO_CAST_DELAY_MS, [on, out], true)).toBe(null);
    expect(a.pick(t + 2 * AUTO_CAST_DELAY_MS, [on, out], true)).toBe(0);
  });

  it("waits for a key drawn before it is back: nothing else is cast, and it goes once it can", () => {
    // The beat's wait (0), then the draw (0.99: the last key in the pool, still coming back).
    const draws = [0, 0.99];
    const a = new AutoCaster(() => draws.shift() ?? 0);
    a.pick(0, [on, soon], true);
    expect(a.pick(AUTO_CAST_DELAY_MS, [on, soon], true)).toBe(null);
    // Key 1 did not cast, so it is not lowered; key 0 lost the draw and gains.
    expect(a.weight(1)).toBeCloseTo(AUTO_CAST_START_WEIGHT);
    expect(a.weight(0)).toBeCloseTo(AUTO_CAST_START_WEIGHT + AUTO_CAST_MISS_WEIGHT);
    // The next beat is kept for key 1: key 0 is ready, but does not go.
    let t = AUTO_CAST_DELAY_MS + 16;
    a.pick(t, [on, soon], true);
    expect(a.pick(t + AUTO_CAST_DELAY_MS, [on, soon], true)).toBe(null);
    // Key 1 is back: the next beat is its.
    t += AUTO_CAST_DELAY_MS + 16;
    a.pick(t, [on, on], true);
    expect(a.pick(t + AUTO_CAST_DELAY_MS, [on, on], true)).toBe(1);
  });

  it("stops waiting for a key that does not come back in time, and draws again", () => {
    const draws = [0, 0.99];
    const a = new AutoCaster(() => draws.shift() ?? 0);
    a.pick(0, [on, soon], true);
    a.pick(AUTO_CAST_DELAY_MS, [on, soon], true);
    // Beats pass with key 1 still not back; past the wait the draw is made again (0 → key 0).
    let t = AUTO_CAST_DELAY_MS + 16;
    let cast: number | null = null;
    for (; t < AUTO_CAST_DELAY_MS + 2 * AUTO_CAST_WAIT_MS && cast === null; t += 16) cast = a.pick(t, [on, soon], true);
    expect(cast).toBe(0);
    expect(t).toBeGreaterThan(AUTO_CAST_DELAY_MS + AUTO_CAST_WAIT_MS);
  });

  it("frees the beats kept for a key the player spends by hand", () => {
    const draws = [0, 0.99];
    const a = new AutoCaster(() => draws.shift() ?? 0);
    a.pick(0, [on, soon], true);
    a.pick(AUTO_CAST_DELAY_MS, [on, soon], true);
    a.noteManual(1);
    const t = AUTO_CAST_DELAY_MS + 16;
    a.pick(t, [on, out], true);
    // The next draw (0) is key 0's, with nothing kept for key 1.
    expect(a.pick(t + AUTO_CAST_DELAY_MS, [on, out], true)).toBe(0);
  });

  it("does not let the short cheap keys starve the long dear one of the bar", () => {
    // 1 s, 3 s and 8 s keys costing 6, 15 and 30 of a 100 bar that refills 6 a
    // second, above a floor of 30, over ten minutes of fight. Left to "first
    // ready goes", the two cheap keys hold the bar under what the 8 s key
    // needs and it casts twice.
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    const a = new AutoCaster(rand);
    const cd = [1000, 3000, 8000];
    const cost = [6, 15, 30];
    const back = [0, 0, 0];
    const casts = [0, 0, 0];
    let mana = 100;
    for (let now = 0; now < 600_000; now += 16) {
      mana = Math.min(100, mana + 6 * 0.016);
      const keys = cd.map((_, i) => ({ eligible: back[i]! <= now && mana - cost[i]! >= 30, coming: back[i]! - now <= 1500, held: true }));
      const k = a.pick(now, keys, true);
      if (k !== null) { casts[k]!++; back[k] = now + cd[k]!; mana -= cost[k]!; }
    }
    expect(casts[2]).toBeGreaterThan(30);
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
