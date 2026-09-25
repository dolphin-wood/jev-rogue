/**
 * Picking up a spell mid-room changes one key. The other two keep their
 * affixes, their levels, their cooldowns and their banks: those live on the
 * keyed slot, and `equipItem` alone rebuilt every slot from its bare item.
 */
import { describe, expect, it } from "vitest";
import {
  RngSource, attachAffix, createWorld, generateRoom, plainInstance, toRoomPlan, withLevel, ITEMS,
} from "@jr/core";
import type { World } from "@jr/core";
import { equipKeepingOthers } from "./equip-keys.ts";

const src = new RngSource("equip-keys");
function world(): World {
  const g = generateRoom(
    { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "combat", src.stream("room"), { plain: true },
  );
  return createWorld({
    room: toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" }),
    encounter: null, props: 0,
    staff: { slots: 6, mana_max: 90 },
    slots: [plainInstance("shock_arc"), plainInstance("mana_darts"), null, null, null, null],
    hearts: 6, rng: src.stream("world"),
  });
}

describe("equipping one key", () => {
  it("leaves the other keys' spells, levels, affixes, cooldowns and banks untouched", () => {
    const w = world();
    const first = withLevel(attachAffix(w.spells[0]!, "resonance", 2)!, 3);
    first.cooldownMs = 420;
    w.spells[0] = first;
    const second = w.spells[1]!;
    second.bank = 2;
    second.bankMs = 300;
    second.cooldownMs = 150;

    expect(equipKeepingOthers(w, "returning_edge", "re-1", ITEMS)).toBe(true);

    expect(w.spells[2]?.item.base).toBe("returning_edge");
    expect(w.spells[0]).toBe(first);
    expect(w.spells[0]!.level).toBe(3);
    expect(w.spells[0]!.affixes.map((a) => [a.id, a.tier])).toEqual([["resonance", 2]]);
    expect(w.spells[0]!.cooldownMs).toBe(420);
    expect(w.spells[1]).toBe(second);
    expect(w.spells[1]!.bank).toBe(2);
    expect(w.spells[1]!.bankMs).toBe(300);
    expect(w.spells[1]!.cooldownMs).toBe(150);
  });

  it("replaces only the key it is given", () => {
    const w = world();
    const first = withLevel(w.spells[0]!, 4);
    w.spells[0] = first;
    expect(equipKeepingOthers(w, "counter_stance", "cs-1", ITEMS, 1)).toBe(true);
    expect(w.spells[0]).toBe(first);
    expect(w.spells[1]?.item.base).toBe("counter_stance");
    expect(w.spells[1]?.level).toBe(1);
    expect(w.slots[1]?.base).toBe("counter_stance");
  });
});
