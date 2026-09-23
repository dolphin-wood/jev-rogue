import { describe, it, expect } from "vitest";
import type { CastUnit, ItemInstance } from "../types.ts";
import { BASE_ITEMS, plainInstance, registryOf } from "./items.ts";
import { parseCastTree, tickCount, MAX_DEPTH } from "./parse.ts";
import { cycleCost, type CostContext } from "./execute.ts";

/**
 * A registry with a **test-owned** multicast in it.
 *
 * These tests are the contract for doc 006's parser: how `multicast N`
 * consumes units, how scopes nest, how the discount applies. That contract is
 * about the *kind*, not about any particular item — and depending on shipped
 * content made them break the day the three multicast items became `repeat`
 * boosts, because doc 013's keyed spells left them nothing to consume.
 *
 * So the fixture is declared here. The parser keeps its tests whatever the
 * content pool does, and the content pool is free to stop shipping a kind.
 */
const TEST_MULTICAST = {
  id: "test_multicast2",
  kind: "multicast" as const,
  rarity: "uncommon" as const,
  tags: ["multicast"],
  mana: 0,
  params: { n: 2, discount_mult: 1 },
  description: "A two-unit multicast that exists only for the parser's tests.",
};
/** A three-unit one, for the "too few units remain" rule. */
const TEST_MULTICAST3 = {
  ...TEST_MULTICAST,
  id: "test_multicast3",
  params: { n: 3, discount_mult: 1 },
};
const TEST_ITEMS = registryOf([...BASE_ITEMS, TEST_MULTICAST, TEST_MULTICAST3]);
const MC = TEST_MULTICAST.id;
const MC3 = TEST_MULTICAST3.id;

const ctx: CostContext = { items: TEST_ITEMS, dominant: "fire" };

function slots(...ids: (string | null)[]): (ItemInstance | null)[] {
  // Built against the test registry, so the fixture multicast resolves.
  return ids.map((id, i) => (id === null ? null : plainInstance(id, `${id}#${i}`, TEST_ITEMS)));
}

function boostIds(unit: CastUnit): string[] {
  return unit.boosts.map((b) => b.base);
}

/** Doc 006, "Worked examples". These four are the contract for the parser,
 *  the scope rules, the tick count and the mana price of a cycle. */
describe("worked examples (doc 006)", () => {
  it("[multicast2, payload_onhit, attack_a, attack_b] is one unit costing (payload + a + b) x 0.8", () => {
    const tree = parseCastTree(slots(MC, "impact_carrier", "magic_bolt", "stone_shard"), TEST_ITEMS);
    expect(tree.units).toHaveLength(1);
    expect(tickCount(tree)).toBe(1);

    const group = tree.units[0]!;
    expect(group.kind).toBe("multicast");
    if (group.kind !== "multicast") throw new Error("unreachable");
    expect(group.units).toHaveLength(2);

    const carrier = group.units[0]!;
    expect(carrier.kind).toBe("payload");
    if (carrier.kind !== "payload") throw new Error("unreachable");
    expect(carrier.item.base).toBe("impact_carrier");
    expect(carrier.child?.item.base).toBe("magic_bolt");

    expect(group.units[1]!.kind).toBe("attack");
    expect(group.units[1]!.item.base).toBe("stone_shard");

    // No boosts anywhere, so the price is exactly doc 006's formula.
    expect(cycleCost(tree, ctx)).toBeCloseTo((2 + 2 + 3) * 0.8, 10);
  });

  it("[boost_dmg, attack_a, multicast2, attack_b, attack_c] boosts all three attacks in two ticks", () => {
    const tree = parseCastTree(
      slots("power_rune", "magic_bolt", MC, "stone_shard", "spark_spray"),
      TEST_ITEMS,
    );
    expect(tickCount(tree)).toBe(2);

    const first = tree.units[0]!;
    expect(first.item.base).toBe("magic_bolt");
    expect(boostIds(first)).toEqual(["power_rune"]);

    const group = tree.units[1]!;
    if (group.kind !== "multicast") throw new Error("expected a multicast");
    expect(group.units.map((u) => u.item.base)).toEqual(["stone_shard", "spark_spray"]);
    // The multicast scope opened after the boost, so the boost reaches inside.
    for (const u of group.units) expect(boostIds(u)).toEqual(["power_rune"]);

    // magic_bolt pays for the rune it uses; the group pays for both of its own.
    expect(cycleCost(tree, ctx)).toBeCloseTo(2 + 1 + (3 + 1 + (3 + 1)) * 0.8, 10);
  });

  it("[attack_a, boost_dmg, payload_onhit, attack_b, attack_c] leaves only attack_a unboosted", () => {
    const tree = parseCastTree(
      slots("magic_bolt", "power_rune", "impact_carrier", "stone_shard", "spark_spray"),
      TEST_ITEMS,
    );
    expect(tickCount(tree)).toBe(3);

    expect(boostIds(tree.units[0]!)).toEqual([]);

    const payload = tree.units[1]!;
    if (payload.kind !== "payload") throw new Error("expected a payload");
    expect(boostIds(payload)).toEqual(["power_rune"]);
    expect(payload.child?.item.base).toBe("stone_shard");
    expect(boostIds(payload.child!)).toEqual(["power_rune"]);

    // Same root scope, later position.
    expect(tree.units[2]!.item.base).toBe("spark_spray");
    expect(boostIds(tree.units[2]!)).toEqual(["power_rune"]);

    expect(cycleCost(tree, ctx)).toBeCloseTo(2 + (2 + 1) + (3 + 1) + (3 + 1), 10);
  });

  it("[payload_onhit, boost_dmg, attack_a, attack_b] keeps the boost inside the payload scope", () => {
    const tree = parseCastTree(
      slots("impact_carrier", "power_rune", "magic_bolt", "stone_shard"),
      TEST_ITEMS,
    );
    expect(tickCount(tree)).toBe(2);

    const payload = tree.units[0]!;
    if (payload.kind !== "payload") throw new Error("expected a payload");
    // The carrier sits before the boost, so it is not boosted itself.
    expect(boostIds(payload)).toEqual([]);
    expect(payload.child?.item.base).toBe("magic_bolt");
    expect(boostIds(payload.child!)).toEqual(["power_rune"]);

    // attack_b is a separate root unit and the boost never escapes upward.
    expect(tree.units[1]!.item.base).toBe("stone_shard");
    expect(boostIds(tree.units[1]!)).toEqual([]);

    expect(cycleCost(tree, ctx)).toBeCloseTo(2 + (2 + 1) + 3, 10);
  });
});

describe("parse rules", () => {
  it("removes passives from the sequence and keeps them on the tree", () => {
    const tree = parseCastTree(slots("mana_well", "magic_bolt", "keen_eye"), TEST_ITEMS);
    expect(tree.units).toHaveLength(1);
    expect(tree.passives.map((p) => p.base)).toEqual(["mana_well", "keen_eye"]);
  });

  it("skips empty slots without consuming a capture", () => {
    const tree = parseCastTree(slots("impact_carrier", null, "magic_bolt"), TEST_ITEMS);
    const payload = tree.units[0]!;
    if (payload.kind !== "payload") throw new Error("expected a payload");
    expect(payload.child?.item.base).toBe("magic_bolt");
  });

  it("consumes the next unit, not the next slot", () => {
    // A boost between the payload and its child is not a unit.
    const tree = parseCastTree(slots("impact_carrier", "swift_rune", "power_rune", "magic_bolt"), TEST_ITEMS);
    expect(tree.units).toHaveLength(1);
    const payload = tree.units[0]!;
    if (payload.kind !== "payload") throw new Error("expected a payload");
    expect(boostIds(payload.child!)).toEqual(["swift_rune", "power_rune"]);
  });

  it("takes what exists when too few units remain", () => {
    const partial = parseCastTree(slots(MC3, "magic_bolt", "stone_shard"), TEST_ITEMS);
    const group = partial.units[0]!;
    if (group.kind !== "multicast") throw new Error("expected a multicast");
    expect(group.n).toBe(3);
    expect(group.units).toHaveLength(2);

    const orphan = parseCastTree(slots("impact_carrier"), TEST_ITEMS);
    const payload = orphan.units[0]!;
    if (payload.kind !== "payload") throw new Error("expected a payload");
    expect(payload.child).toBeNull();
  });

  it("gives a one-unit multicast no discount", () => {
    const tree = parseCastTree(slots(MC, "magic_bolt"), TEST_ITEMS);
    expect(cycleCost(tree, ctx)).toBeCloseTo(2, 10);
  });

  it("recursive consumption: a payload after a multicast resolves its own child first", () => {
    const tree = parseCastTree(
      slots(MC, "impact_carrier", "magic_bolt", "fuse_carrier", "stone_shard"),
      TEST_ITEMS,
    );
    expect(tree.units).toHaveLength(1);
    const group = tree.units[0]!;
    if (group.kind !== "multicast") throw new Error("expected a multicast");
    expect(group.units).toHaveLength(2);
    expect(group.units.map((u) => u.item.base)).toEqual(["impact_carrier", "fuse_carrier"]);
  });

  it("caps nesting at three and reports the dropped slots", () => {
    // payload -> payload -> payload -> attack: the innermost child is dropped.
    const tree = parseCastTree(
      slots("impact_carrier", "impact_carrier", "impact_carrier", "impact_carrier", "magic_bolt"),
      TEST_ITEMS,
    );
    expect(tree.units).toHaveLength(1);
    let depth = 1;
    let unit = tree.units[0]!;
    while (unit.kind === "payload" && unit.child) {
      unit = unit.child;
      depth++;
    }
    expect(depth).toBe(MAX_DEPTH);
    expect(tree.droppedForDepth).toEqual([3, 4]);
  });
});
