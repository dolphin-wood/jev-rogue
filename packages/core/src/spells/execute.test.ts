import { describe, it, expect } from "vitest";
import type { ItemInstance, Staff } from "../types.ts";
import { BASE_ITEMS, plainInstance, registryOf } from "./items.ts";

/**
 * A test-owned multicast. See `parse.test.ts` for why: these tests are the
 * contract for the multicast *kind*, and depending on shipped items made them
 * break when the three multicast items became `repeat` boosts.
 */
const TEST_MULTICAST = {
  id: "test_multicast2",
  kind: "multicast" as const,
  rarity: "uncommon" as const,
  tags: ["multicast"],
  mana: 0,
  // `discount_mult: 1` because the 0.8^(N-1) group discount is the *engine's*
  // rule; the item's own multiplier is a further modifier on top, and these
  // tests are asserting the engine.
  params: { n: 2, discount_mult: 1 },
  description: "A two-unit multicast that exists only for these tests.",
};
const TEST_ITEMS = registryOf([...BASE_ITEMS, TEST_MULTICAST]);
const MC = TEST_MULTICAST.id;
import { parseCastTree } from "./parse.ts";
import { REFERENCE_STAFF } from "./staff.ts";
import { cycleCost, runCastLoop, type CastLoopConfig, type CostContext } from "./execute.ts";

const ctx: CostContext = { items: TEST_ITEMS, dominant: "fire" };
const MOVING: CastLoopConfig = { target: "moving", duration: 10 };

function slots(...ids: (string | null)[]): (ItemInstance | null)[] {
  return ids.map((id, i) => (id === null ? null : plainInstance(id, `${id}#${i}`, TEST_ITEMS)));
}

function staff(over: Partial<Staff>): Staff {
  return { ...REFERENCE_STAFF, ...over };
}

function run(arrangement: (ItemInstance | null)[], over: Partial<Staff> = {}, cfg = MOVING) {
  return runCastLoop(staff(over), parseCastTree(arrangement, TEST_ITEMS), TEST_ITEMS, cfg);
}

describe("mana rules (doc 006)", () => {
  it("skips an attack it cannot pay for and moves the cursor on", () => {
    // void_orb costs 7; the staff can never reach it.
    const res = run(slots("void_orb"), { mana_max: 3, mana_regen: 0 });
    expect(res.castsAttempted).toBeGreaterThan(0);
    expect(res.castsSkipped).toBe(res.castsAttempted);
    expect(res.projectilesFired).toBe(0);
    expect(res.damage).toBe(0);
  });

  it("fires the carrier alone when the subtree is unaffordable", () => {
    // impact_carrier 2 + void_orb 7 = 9 reserved together; only 5 available.
    const res = run(slots("impact_carrier", "void_orb"), { mana_max: 5, mana_regen: 0 });
    expect(res.payloadsArmed).toBe(0);
    expect(res.projectilesFired).toBe(2); // two carriers at 2 mana, then broke
    expect(res.castsSkipped).toBeGreaterThan(0);
  });

  it("reserves the whole subtree when it can", () => {
    const res = run(slots("impact_carrier", "void_orb"), { mana_max: 9, mana_regen: 0 });
    expect(res.payloadsArmed).toBe(1);
    expect(res.manaSpent).toBeCloseTo(9, 10);
  });

  it("skips an entire multicast group rather than part of it", () => {
    // (2 + 3) x 0.8 = 4, and only 3 mana exists.
    const tree = parseCastTree(slots(MC, "magic_bolt", "stone_shard"), TEST_ITEMS);
    expect(cycleCost(tree, ctx)).toBeCloseTo(4, 10);
    const res = run(slots(MC, "magic_bolt", "stone_shard"), { mana_max: 3, mana_regen: 0 });
    expect(res.projectilesFired).toBe(0);
    expect(res.castsSkipped).toBe(res.castsAttempted);
  });

  it("gives the discount to the outermost multicast only", () => {
    // Nested: ((0 + 2 + 2) + 2) x 0.8, not ((2 + 2) x 0.8 + 2) x 0.8.
    const tree = parseCastTree(
      slots(MC, MC, "magic_bolt", "magic_bolt", "magic_bolt"),
      TEST_ITEMS,
    );
    expect(cycleCost(tree, ctx)).toBeCloseTo(6 * 0.8, 10);
  });

  it("applies the cheaper affix to every unit in the scope", () => {
    const rune: ItemInstance = {
      uid: "rune", base: "power_rune", affix: "cheaper", magnitude: 1,
      modifier: { scope_mana_mult: 0.5 }, rarity: "uncommon",
    };
    const tree = parseCastTree([rune, plainInstance("magic_bolt", "a")], TEST_ITEMS);
    // (magic_bolt 2 + rune 1) x 0.5.
    expect(cycleCost(tree, ctx)).toBeCloseTo(1.5, 10);
  });
});

describe("timing and triggers (doc 006)", () => {
  it("advances one unit per cast_interval and rests for the cooldown", () => {
    const res = run(slots("magic_bolt", "magic_bolt", "magic_bolt"), { cast_interval: 0.2, cooldown: 0.4 });
    expect(res.units).toBe(3);
    expect(res.cycleTime).toBeCloseTo(0.8, 10); // (3 - 1) x 0.2 + 0.4
    // Casts land at 0, 0.2, 0.4 | 0.8, 1.0, 1.2 | ... so twelve cycles close
    // inside ten seconds and the thirteenth has fired twice by the end.
    expect(res.cycles).toBe(12);
    expect(res.castsAttempted).toBe(38);
  });

  it("charges a multicast group one tick, not one per item", () => {
    const one = run(slots(MC, "magic_bolt", "magic_bolt"));
    const two = run(slots("magic_bolt", "magic_bolt"));
    expect(one.units).toBe(1);
    expect(two.units).toBe(2);
    expect(one.cycleTime).toBeLessThan(two.cycleTime);
  });

  it("triggers a payload child exactly once per carrier", () => {
    const res = run(slots("impact_carrier", "magic_bolt"));
    expect(res.payloadsArmed).toBeGreaterThan(0);
    expect(res.payloadsTriggered).toBeLessThanOrEqual(res.payloadsArmed);
  });

  it("still triggers once when the carrier pierces", () => {
    // Doc 006: "a carrier with pierce that hits three enemies still triggers
    // once". A wall carrier always reaches its trigger, so armed and triggered
    // must match exactly however much pierce it is given.
    const pierced = run(slots("piercing_rune", "wall_carrier", "magic_bolt"), { mana_regen: 60 });
    expect(pierced.payloadsArmed).toBeGreaterThan(0);
    expect(pierced.payloadsTriggered).toBeLessThanOrEqual(pierced.payloadsArmed);
    // Only the carrier still in flight when the clock stops has yet to fire.
    expect(pierced.payloadsTriggered).toBe(pierced.payloadsArmed - 1);
  });

  it("fires a childless payload as a plain projectile", () => {
    const res = run(slots("impact_carrier"));
    expect(res.payloadsArmed).toBe(0);
    expect(res.projectilesFired).toBeGreaterThan(0);
    expect(res.damage).toBeGreaterThan(0);
  });

  it("does nothing at all with an empty staff", () => {
    const res = run(slots(null, null));
    expect(res.units).toBe(0);
    expect(res.castsAttempted).toBe(0);
    expect(res.damage).toBe(0);
  });
});

describe("damage model (doc 006)", () => {
  it("multiplies by boosts in scope and by passives, and doubles on crit", () => {
    const base = run(slots("magic_bolt"), { crit_bonus: 0 });
    const boosted = run(slots("power_rune", "magic_bolt"), { crit_bonus: 0 });
    const focused = run(slots("arcane_focus", "magic_bolt"), { crit_bonus: 0 });
    const crit = run(slots("magic_bolt"), { crit_bonus: 1 });
    expect(boosted.damage).toBeGreaterThan(base.damage);
    expect(focused.damage).toBeGreaterThan(base.damage);
    // Every hit crits, so each one is worth exactly twice the base hit.
    expect(crit.damage / base.damage).toBeCloseTo(2, 5);
  });

  it("keeps a boost out of a scope it never entered", () => {
    // The boost lives inside the payload, so stone_shard is untouched.
    const inside = run(slots("impact_carrier", "power_rune", "magic_bolt", "stone_shard"));
    const outside = run(slots("power_rune", "impact_carrier", "magic_bolt", "stone_shard"));
    expect(outside.damage).toBeGreaterThan(inside.damage);
  });

  it("is deterministic", () => {
    const a = run(slots("plague_bloom", "fracture_rune", "magic_bolt"));
    const b = run(slots("plague_bloom", "fracture_rune", "magic_bolt"));
    expect(a).toEqual(b);
  });
});
