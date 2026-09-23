import { describe, it, expect } from "vitest";
import {
  ALL_PROFILES, BANDS, BUDGET, COOLDOWN_FLOOR, FALLBACK_PROFILE, MANA_CEILING,
  STAFF_TABLE, generateStaff, profileKey, staffCost, addSlot,
} from "./staff.ts";

describe("staff generation (doc 006)", () => {
  it("resolves all 24 profiles", () => {
    expect(ALL_PROFILES).toHaveLength(24);
    expect(STAFF_TABLE.size).toBe(24);
  });

  it("keeps every profile inside the 120-point budget", () => {
    for (const profile of ALL_PROFILES) {
      const staff = STAFF_TABLE.get(profileKey(profile))!;
      expect(staffCost(staff), profileKey(profile)).toBeLessThanOrEqual(BUDGET);
    }
  });

  it("puts the most expensive profile at 107.5 before leftovers", () => {
    // Doc 006 names this figure: many / high / quick / regen at its cheapest
    // point inside its own label bands.
    const cost =
      2 * 10 + (BANDS.mana.high[0] - 60) * 0.25 + ((0.2 - BANDS.tempo.quick[1]) / 0.02) * 15 + 15;
    expect(cost).toBeCloseTo(107.5, 10);
  });

  it("lands every stat in its label band", () => {
    for (const profile of ALL_PROFILES) {
      const s = STAFF_TABLE.get(profileKey(profile))!;
      const where = profileKey(profile);
      expect(s.slots, where).toBe(BANDS.slots[profile.slots]);
      const mana = BANDS.mana[profile.mana];
      expect(s.mana_max, where).toBeGreaterThanOrEqual(mana[0]);
      expect(s.mana_max, where).toBeLessThanOrEqual(Math.min(mana[1], MANA_CEILING));
      const tempo = BANDS.tempo[profile.tempo];
      expect(s.cast_interval, where).toBeGreaterThanOrEqual(tempo[0]);
      expect(s.cast_interval, where).toBeLessThanOrEqual(tempo[1]);
      expect(s.cooldown, where).toBeGreaterThanOrEqual(COOLDOWN_FLOOR - 1e-9);
      expect(s.cooldown, where).toBeLessThanOrEqual(1);
      expect(s.mana_regen, where).toBe(profile.special === "regen" ? 12 : 8);
      expect(s.crit_bonus, where).toBe(profile.special === "crit" ? 0.1 : 0);
    }
  });

  it("spends leftovers on cooldown first, then mana", () => {
    // The cheapest profile has the whole budget spare: cooldown hits its floor
    // and mana_max reaches the top of its own band, and the rest is discarded.
    const cheap = generateStaff({ slots: "few", mana: "low", tempo: "steady", special: "none" });
    expect(cheap.cooldown).toBeCloseTo(COOLDOWN_FLOOR, 10);
    expect(cheap.mana_max).toBe(BANDS.mana.low[1]);

    // The most expensive profile has 12.5 points spare: one cooldown step.
    const rich = generateStaff({ slots: "many", mana: "high", tempo: "quick", special: "regen" });
    expect(rich.cooldown).toBeCloseTo(0.9, 10);
    expect(rich.mana_max).toBe(BANDS.mana.high[0] + 10);
  });

  it("uses many / low / steady / none as the reference fallback", () => {
    expect(FALLBACK_PROFILE).toEqual({ slots: "many", mana: "low", tempo: "steady", special: "none" });
    const s = STAFF_TABLE.get(profileKey(FALLBACK_PROFILE))!;
    expect(s.slots).toBe(6);
    expect(s.cast_interval).toBeCloseTo(0.2, 10);
  });

  it("caps rest-room slot picks at eight", () => {
    let s = generateStaff(FALLBACK_PROFILE);
    for (let i = 0; i < 5; i++) s = addSlot(s);
    expect(s.slots).toBe(8);
  });
});
