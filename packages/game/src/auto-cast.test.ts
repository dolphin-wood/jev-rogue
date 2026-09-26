import { describe, expect, it } from "vitest";
import { AUTO_CAST_DELAY_MS, AUTO_CAST_SPREAD_MS, AutoCaster } from "./auto-cast.ts";

const on = { eligible: true };
const off = { eligible: false };

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

  it("draws each wait afresh", () => {
    const draws = [0, 1];
    const a = new AutoCaster(() => draws.shift() ?? 0);
    expect(a.pick(0, [on, on], true)).toBe(null);
    expect(a.pick(AUTO_CAST_DELAY_MS, [on, on], true)).toBe(0);
    expect(a.pick(AUTO_CAST_DELAY_MS + AUTO_CAST_SPREAD_MS - 1, [off, on], true)).toBe(null);
    expect(a.pick(AUTO_CAST_DELAY_MS + AUTO_CAST_SPREAD_MS, [off, on], true)).toBe(1);
  });

  it("starts every wait over when the player presses a key themselves", () => {
    const a = new AutoCaster(() => 0);
    a.pick(0, [on], true);
    a.noteManual();
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
});
