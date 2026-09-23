import { describe, it, expect } from "vitest";
import { BASE_ITEMS, ITEMS, plainInstance } from "./items.ts";
import {
  AFFIX_IDS, CALIBRATION, MAX_MAGNITUDE, MAX_RESCALES, RARITY_BANDS, START_MAGNITUDE,
  affixModifier, affixedInstance, applyAffix, lookupAffix, referenceArrangements,
  resolveAffixTable, type AffixRarity,
} from "./affix.ts";
import { simulateStaff } from "./simulate.ts";

const RARITIES: readonly AffixRarity[] = ["uncommon", "rare"];
const table = resolveAffixTable();

describe("affix modifiers (doc 006)", () => {
  it("covers every base item at both offer rarities", () => {
    expect(table.size).toBe(BASE_ITEMS.length * AFFIX_IDS.length * RARITIES.length);
  });

  it("drops homing on a passive, which has nothing to steer", () => {
    for (const item of BASE_ITEMS.filter((i) => i.kind === "passive")) {
      expect(affixModifier(item, "homing", 1)).toBeNull();
      for (const rarity of RARITIES) {
        expect(lookupAffix(item.id, "homing", rarity, table).status).toBe("dropped");
      }
    }
  });

  it("gives a scoped item scope deltas and an attack its own", () => {
    const boost = ITEMS.get("power_rune")!;
    expect(Object.keys(affixModifier(boost, "homing", 1)!)).toEqual(["scope_homing"]);
    const attack = ITEMS.get("magic_bolt")!;
    expect(Object.keys(affixModifier(attack, "heavier", 1)!)).toEqual(["damage_mult", "speed_mult"]);
    // A payload is both a carrier projectile and a scope, so it takes both.
    const payload = ITEMS.get("impact_carrier")!;
    const mod = affixModifier(payload, "heavier", 1)!;
    expect(mod).toHaveProperty("scope_damage_mult");
    expect(mod).toHaveProperty("damage_mult");
  });

  it("scales the modifier with the magnitude", () => {
    const attack = ITEMS.get("magic_bolt")!;
    expect(affixModifier(attack, "heavier", 1)!["damage_mult"]).toBeCloseTo(1.3, 10);
    expect(affixModifier(attack, "heavier", 1.5)!["damage_mult"]).toBeCloseTo(1.45, 10);
  });

  it("starts rare at 1.5x magnitude", () => {
    expect(START_MAGNITUDE.uncommon).toBe(1);
    expect(START_MAGNITUDE.rare).toBe(1.5);
  });
});

describe("calibration (doc 006)", () => {
  it("lands every base x affix x rarity in its band or drops to none", () => {
    for (const row of table.values()) {
      const where = `${row.base} ${row.affix} ${row.rarity}`;
      if (row.status === "dropped") {
        expect(row.modifier, where).toBeNull();
        continue;
      }
      const [lo, hi] = RARITY_BANDS[row.rarity];
      expect(row.ratio, where).toBeGreaterThanOrEqual(lo);
      expect(row.ratio, where).toBeLessThanOrEqual(hi);
      expect(row.modifier, where).not.toBeNull();
      expect(row.magnitude, where).toBeGreaterThan(0);
      expect(row.magnitude, where).toBeLessThanOrEqual(MAX_MAGNITUDE);
    }
  });

  it("never rescales more than three times", () => {
    for (const row of table.values()) {
      expect(row.attempts, `${row.base} ${row.affix} ${row.rarity}`).toBeLessThanOrEqual(MAX_RESCALES + 1);
    }
  });

  it("keeps every affix intent useful for some item", () => {
    for (const affix of AFFIX_IDS) {
      const inBand = [...table.values()].filter((r) => r.affix === affix && r.status === "in_band");
      expect(inBand.length, affix).toBeGreaterThan(0);
    }
  });

  it("reproduces the recorded ratio when the arrangement is re-simulated", () => {
    // Calibration is a build-time table the run only looks up, so a stored row
    // has to be reproducible from the instance it describes.
    const row = [...table.values()].find((r) => r.status === "in_band" && r.base === "power_rune")!;
    const base = ITEMS.get(row.base)!;
    const affixed = affixedInstance(row.base, row.affix, row.rarity, row.magnitude, "cand");
    expect(affixed.modifier).toEqual(row.modifier);

    const plainRefs = referenceArrangements(base, plainInstance(row.base, "cand"));
    const affixedRefs = referenceArrangements(base, affixed);
    let best = 0;
    for (let i = 0; i < plainRefs.length; i++) {
      const a = simulateStaff(plainRefs[i]!.staff, plainRefs[i]!.slots, ITEMS, CALIBRATION).dps_moving;
      const b = simulateStaff(affixedRefs[i]!.staff, affixedRefs[i]!.slots, ITEMS, CALIBRATION).dps_moving;
      if (a > 0) best = Math.max(best, b / a);
    }
    expect(best).toBeCloseTo(row.ratio, 6);
  });

  it("memoizes: the table is resolved once", () => {
    expect(resolveAffixTable()).toBe(table);
  });
});

describe("shipped cards", () => {
  it("hands out an unaffixed instance at the offer rarity when the affix was dropped", () => {
    const row = [...table.values()].find((r) => r.status === "dropped")!;
    const inst = applyAffix("u1", row.base, row.affix, row.rarity, table);
    expect(inst.affix).toBeNull();
    expect(inst.modifier).toBeNull();
    expect(inst.rarity).toBe(row.rarity);
    expect(inst.base).toBe(row.base);
  });

  it("stores the resolved deltas on the instance, not a recipe", () => {
    const row = [...table.values()].find((r) => r.status === "in_band")!;
    const inst = applyAffix("u2", row.base, row.affix, row.rarity, table);
    expect(inst.affix).toBe(row.affix);
    expect(inst.magnitude).toBe(row.magnitude);
    expect(inst.modifier).toEqual(row.modifier);
  });

  it("lets two instances of one base with different affixes coexist", () => {
    const a = applyAffix("u3", "magic_bolt", "heavier", "uncommon", table);
    const b = applyAffix("u4", "magic_bolt", "wider", "rare", table);
    expect(a.base).toBe(b.base);
    expect(a.uid).not.toBe(b.uid);
    const sim = simulateStaff(
      referenceArrangements(ITEMS.get("magic_bolt")!, a)[0]!.staff, [a, b], ITEMS, CALIBRATION,
    );
    expect(sim.dps_moving).toBeGreaterThan(0);
  });
});
