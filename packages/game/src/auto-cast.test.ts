import { describe, expect, it } from "vitest";
import {
  AUTO_CAST_DELAY_MS, AUTO_CAST_FORGET_MS, AUTO_CAST_MIN_WEIGHT, AUTO_CAST_SPREAD_MS, AUTO_CAST_YIELD_MS,
  AutoCaster, recencyWeight,
} from "./auto-cast.ts";

const on = { eligible: true, coming: true, fits: true };
const soon = { eligible: false, coming: true, fits: true };
const off = { eligible: false, coming: false, fits: false };
/** Ready, but the player is mid-stride. */
const busy = { eligible: true, coming: true, fits: false };

describe("auto-cast", () => {
  it("waits a random moment after a key is ready, never pressing it at once", () => {
    const a = new AutoCaster(() => 0.5);
    const wait = AUTO_CAST_DELAY_MS + 0.5 * AUTO_CAST_SPREAD_MS;
    expect(a.pick(0, [on], true)).toBe(null);
    expect(a.pick(wait - 1, [on], true)).toBe(null);
    expect(a.pick(wait, [on], true)).toBe(0);
    // Pressed once, not every step after.
    expect(a.pick(wait + 16, [on], true)).toBe(null);
  });

  it("starts every wait over when the player presses a key themselves", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [on], true);
    a.noteManual(0, AUTO_CAST_DELAY_MS / 2);
    expect(a.pick(AUTO_CAST_DELAY_MS, [on], true)).toBe(null);
    expect(a.pick(2 * AUTO_CAST_DELAY_MS, [on], true)).toBe(0);
  });

  it("forgets a wait when the key stops being eligible", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [on], true);
    a.pick(AUTO_CAST_DELAY_MS - 1, [off], true);
    expect(a.pick(AUTO_CAST_DELAY_MS, [on], true)).toBe(null);
  });

  it("holds a due key while the caster is busy, and presses it once free", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [on], true);
    expect(a.pick(AUTO_CAST_DELAY_MS, [on], false)).toBe(null);
    expect(a.pick(AUTO_CAST_DELAY_MS + 16, [on], true)).toBe(0);
  });

  it("waits for a gap in the rhythm, without starting its delay again", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [busy], true);
    // Due, but mid-stride the whole time.
    expect(a.pick(AUTO_CAST_DELAY_MS, [busy], true)).toBe(null);
    expect(a.pick(AUTO_CAST_DELAY_MS + 1000, [busy], true)).toBe(null);
    // The first gap: it goes at once, its delay long since served.
    expect(a.pick(AUTO_CAST_DELAY_MS + 1016, [on], true)).toBe(0);
  });

  it("weighs a key just cast low, growing back to full over the forget time", () => {
    expect(recencyWeight(0)).toBeCloseTo(AUTO_CAST_MIN_WEIGHT);
    expect(recencyWeight(AUTO_CAST_FORGET_MS / 2)).toBeCloseTo((1 + AUTO_CAST_MIN_WEIGHT) / 2);
    expect(recencyWeight(AUTO_CAST_FORGET_MS * 3)).toBe(1);
    expect(recencyWeight(Infinity)).toBe(1);
  });

  it("gives the turn to a key still coming back, and casts nothing else while it holds it", () => {
    // Draws in order: key 0's delay (0), then the draw itself (0.99: the last key in the pool).
    const draws = [0, 0.99];
    const a = new AutoCaster(() => draws.shift() ?? 0);
    expect(a.pick(0, [on, soon], true)).toBe(null);
    // Key 0 is due, but the turn went to key 1.
    expect(a.pick(AUTO_CAST_DELAY_MS, [on, soon], true)).toBe(null);
    expect(a.pick(AUTO_CAST_DELAY_MS + 500, [on, soon], true)).toBe(null);
    // Key 1 is back: its own random wait, then it goes.
    const back = AUTO_CAST_DELAY_MS + 600;
    expect(a.pick(back, [on, on], true)).toBe(null);
    expect(a.pick(back + AUTO_CAST_DELAY_MS, [on, on], true)).toBe(1);
  });

  it("draws again once a held turn has waited too long", () => {
    const draws = [0, 0.99];
    const a = new AutoCaster(() => draws.shift() ?? 0);
    a.pick(0, [on, soon], true);
    a.pick(AUTO_CAST_DELAY_MS, [on, soon], true);
    // The redraw (0 after the queue runs out) lands on key 0.
    expect(a.pick(AUTO_CAST_DELAY_MS + AUTO_CAST_YIELD_MS + 1, [on, soon], true)).toBe(0);
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
      const keys = cd.map((_, i) => ({ eligible: back[i]! <= now && mana - cost[i]! >= 30, coming: back[i]! - now <= 1500, fits: true }));
      const k = a.pick(now, keys, true);
      if (k !== null) { casts[k]!++; back[k] = now + cd[k]!; mana -= cost[k]!; }
    }
    expect(casts[2]).toBeGreaterThan(30);
    expect(casts[0]! / casts[2]!).toBeLessThan(4);
  });
});
