import { describe, it, expect } from "vitest";
import type { ItemInstance } from "../types.ts";
import { LABELS, ROLES } from "../content/tags.ts";
import { ITEMS, plainInstance } from "./items.ts";
import { ALL_PROFILES, REFERENCE_STAFF, STAFF_TABLE, profileKey } from "./staff.ts";
import { CONFIRM, SCREEN, bestLegalPlacement, simulateStaff, simulateStaffDetail } from "./simulate.ts";

function slots(...ids: (string | null)[]): (ItemInstance | null)[] {
  return ids.map((id, i) => (id === null ? null : plainInstance(id, `${id}#${i}`)));
}

/** Doc 006's reference arrangement: one common attack plus one common boost. */
const REFERENCE_ARRANGEMENT = slots("power_rune", "magic_bolt");

describe("simulateStaff (doc 006)", () => {
  it("emits only vocabulary words from doc 010", () => {
    const sim = simulateStaff(REFERENCE_STAFF, slots("power_rune", "magic_bolt", "mana_well"));
    expect(LABELS.mana_sustain).toContain(sim.mana_sustain);
    expect(LABELS.scatter).toContain(sim.scatter);
    expect(LABELS.bottleneck).toContain(sim.bottleneck);
    expect(["spam", "nuke", "area", "dot", "mixed"]).toContain(sim.archetype);
    for (const role of sim.missing_roles) expect(ROLES).toContain(role);
    expect(sim.dps_moving).toBeGreaterThan(0);
    expect(sim.cycle_time).toBeGreaterThan(0);
  });

  it("runs the reference arrangement on all 24 staffs and produces damage", () => {
    for (const profile of ALL_PROFILES) {
      const staff = STAFF_TABLE.get(profileKey(profile))!;
      const sim = simulateStaff(staff, REFERENCE_ARRANGEMENT, ITEMS, CONFIRM);
      expect(sim.dps_moving, profileKey(profile)).toBeGreaterThan(0);
      expect(sim.dps_stationary, profileKey(profile)).toBeGreaterThan(0);
    }
  });

  it("is harder to hit a moving dummy than a standing one", () => {
    const d = simulateStaffDetail(REFERENCE_STAFF, slots("magic_bolt"), ITEMS, CONFIRM);
    expect(d.sim.dps_moving).toBeLessThan(d.sim.dps_stationary);
    expect(d.moving.projectileHits).toBeLessThan(d.moving.projectilesFired);
    expect(d.stationary!.projectileHits).toBe(d.stationary!.projectilesFired);
  });

  it("calls a mana-bankrupt staff starved and blames mana", () => {
    const poor = { ...REFERENCE_STAFF, mana_max: 20, mana_regen: 1 };
    const sim = simulateStaff(poor, slots("void_orb", "greater_power_rune", "glacier_spike"), ITEMS, CONFIRM);
    expect(sim.mana_sustain).toBe("starved");
    expect(sim.bottleneck).toBe("mana");
  });

  it("calls a wide cone wide and blames accuracy", () => {
    const sim = simulateStaff(REFERENCE_STAFF, slots("scatter_shot"), ITEMS, CONFIRM);
    expect(sim.scatter).toBe("wide");
    expect(sim.bottleneck).toBe("accuracy");
  });

  it("reports the roles a staff has no item for", () => {
    const sim = simulateStaff(REFERENCE_STAFF, slots("magic_bolt"), ITEMS, SCREEN);
    expect(sim.missing_roles).toContain("boost");
    expect(sim.missing_roles).toContain("passive");
    expect(sim.missing_roles).not.toContain("attack");
  });

  it("ranks the tags a staff is actually made of", () => {
    const sim = simulateStaff(REFERENCE_STAFF, slots("fire_rune", "ember_dart", "plague_bloom"), ITEMS, SCREEN);
    expect(sim.dominant_tags.length).toBeGreaterThan(0);
    expect(sim.dominant_tags.length).toBeLessThanOrEqual(3);
    expect(sim.dominant_tags).toContain("dot");
  });
});

describe("bestLegalPlacement (doc 006)", () => {
  it("puts a boost in front of the attack it must reach", () => {
    const current = slots("magic_bolt", null, null, null, null, null);
    const report = bestLegalPlacement(REFERENCE_STAFF, current, plainInstance("power_rune", "cand"));
    // Only one position is structurally legal: after the attack the boost
    // reaches nothing, so it is never simulated.
    expect(report.considered).toBe(1);
    expect(report.best.index).toBe(0);
    expect(report.best.sim.dps_moving).toBeGreaterThan(report.current.dps_moving);
  });

  it("tries a passive at a single position, because position is irrelevant", () => {
    const current = slots("magic_bolt", "stone_shard", null, null, null, null);
    const report = bestLegalPlacement(REFERENCE_STAFF, current, plainInstance("mana_well", "cand"));
    expect(report.considered).toBe(1);
    expect(report.best.index).toBe(0);
  });

  it("tries every position for an attack", () => {
    const current = slots("power_rune", "magic_bolt", null, null, null, null);
    const report = bestLegalPlacement(REFERENCE_STAFF, current, plainInstance("stone_shard", "cand"));
    expect(report.considered).toBe(3); // before, between, after
  });

  it("offers a replacement, or the spare inventory, when the staff is full", () => {
    const current = slots("magic_bolt", "magic_bolt", "magic_bolt", "magic_bolt", "magic_bolt", "magic_bolt");
    const report = bestLegalPlacement(REFERENCE_STAFF, current, plainInstance("greater_power_rune", "cand"));
    expect(report.considered).toBeGreaterThan(0);
    // Whatever wins, it is at least as good as keeping the current staff.
    expect(report.best.sim.dps_moving).toBeGreaterThanOrEqual(report.current.dps_moving);
    if (report.best.index !== null) expect(report.best.replaced).not.toBeNull();
  });

  it("keeps a candidate in the spare inventory when nothing it could do helps", () => {
    const current = slots("magic_bolt", "magic_bolt", "magic_bolt", "magic_bolt", "magic_bolt", "magic_bolt");
    const report = bestLegalPlacement(REFERENCE_STAFF, current, plainInstance("thorn_mantle", "cand"));
    // A passive that changes no damage term cannot beat the current staff.
    expect(report.best.index).toBeNull();
    expect(report.deltas).toEqual([]);
  });

  it("reports at most two label transitions, bottleneck first", () => {
    const current = slots("magic_bolt", null, null, null, null, null);
    const report = bestLegalPlacement(
      REFERENCE_STAFF, current, plainInstance("greater_power_rune", "cand"), ITEMS, CONFIRM,
    );
    expect(report.deltas.length).toBeLessThanOrEqual(2);
    if (report.deltas.length === 2) expect(report.deltas[0]!.field).toBe("bottleneck");
    for (const d of report.deltas) expect(d.from).not.toBe(d.to);
  });
});
