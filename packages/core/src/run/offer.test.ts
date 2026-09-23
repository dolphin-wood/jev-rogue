import { describe, expect, it } from "vitest";
import { ITEMS } from "../spells/items.ts";
import { RngSource } from "../rng.ts";
import { castableAlone, makeSpell, slotCost } from "../sim/spells.ts";
import { plainInstance, staffFor } from "../spells/index.ts";

const STAFF_FOR_COST = staffFor({ slots: "many", mana: "high", tempo: "steady", special: "none" });
import { emptyHistory, offerCards, offerDoors, offerStats } from "./offer.ts";
import { affixFits, spellAffixById } from "../spells/affixes.ts";

const rng = (seed = "o"): ReturnType<RngSource["stream"]> =>
  new RngSource(seed).stream("offer");

const item = (id: string) => {
  const base = ITEMS.get(id);
  if (!base) throw new Error(`no item ${id}`);
  return base;
};

describe("offerStats", () => {
  it("leads with the cost, because that is what decides affordability", () => {
    // What the cast actually spends, not the item's cost rank.
    expect(offerStats(item("magic_bolt"))).toMatch(new RegExp(`^${slotCost(makeSpell(plainInstance("magic_bolt"), ITEMS), ITEMS, STAFF_FOR_COST)} mana`));
    expect(offerStats(item("void_orb"))).toMatch(/mana/);
  });

  it("reads a multiplier as the change, not the factor", () => {
    // 1.35 is "+35%", which is the question the player is asking. Printing
    // "1.35 damage" makes them do the arithmetic.
    expect(offerStats(item("power_rune"))).toContain("+35% damage");
    expect(offerStats(item("greater_power_rune"))).toContain("+80% damage");
    expect(offerStats(item("swift_rune"))).toContain("+50% speed");
    expect(offerStats(item("heavy_rune"))).toContain("+60% size");
  });

  it("reads an additive modifier as a count", () => {
    expect(offerStats(item("twin_rune"))).toContain("+1 projectiles");
    expect(offerStats(item("piercing_rune"))).toContain("+2 pierce");
  });

  it("says how many extra times a repeat modifier casts", () => {
    /*
     * These were `multicast` items and are `boost`s with a `repeat` now: doc
     * 006's multicast consumes the next N units of a *staff sequence*, which
     * doc 013's three keyed spells do not have, so all three did nothing at
     * all. The concept that survived is "cast the same spell again".
     */
    expect(offerStats(item("double_cast"))).toContain("+1 extra cast");
    expect(offerStats(item("triple_cast"))).toContain("+2 extra casts");
    expect(offerStats(item("chorus_cast"))).toContain("+3 extra casts");
  });

  it("leaves out the simulation's own numbers", () => {
    /*
     * `params` also carries flight speed, lifetime and spread in degrees.
     * Those are how the thing works, not how good it is, and printing them
     * buries the figure that matters. This is the assertion that keeps the
     * allow-list an allow-list.
     */
    const line = offerStats(item("magic_bolt"));
    expect(line).not.toMatch(/lifetime|spread|600|1\.2/);
  });

  it("names the effect, not just the cost", () => {
    /*
     * The gap a not-empty assertion cannot see. `frost_rune` has an element
     * and no numeric parameter, so its line was "1 mana" — technically
     * non-empty, and it told the player nothing about what the rune does.
     * Every card has to say something beyond what it costs.
     */
    for (const base of ITEMS.values()) {
      const line = offerStats(base);
      const onlyCost = /^[\d.]+ mana$/.test(line);
      expect({ id: base.id, line, onlyCost }).toEqual({ id: base.id, line, onlyCost: false });
    }
  });

  it("produces something for every item in the pool", () => {
    // A blank stat line would be an empty gold row on the card, which reads as
    // a rendering failure rather than as "this one has no numbers".
    for (const base of ITEMS.values())
      expect({ id: base.id, line: offerStats(base).length > 0 })
        .toEqual({ id: base.id, line: true });
  });

  it("stays short enough to be read in a glance", () => {
    for (const base of ITEMS.values())
      expect({ id: base.id, len: offerStats(base).length <= 34 })
        .toEqual({ id: base.id, len: true });
  });
});

describe("offerCards", () => {
  it("always offers gold, and offers it last", () => {
    // Gold is the decline. The portals are gated on answering the offer, so
    // without a safe pick the gate would be a forced commitment.
    const cards = offerCards(ITEMS, rng(), []);
    expect(cards.at(-1)?.kind).toBe("gold");
    expect(cards.filter((c) => c.kind === "gold")).toHaveLength(1);
  });

  it("offers a castable and a modifier alongside it", () => {
    const cards = offerCards(ITEMS, rng(), []);
    expect(cards.map((c) => c.kind)).toEqual(["spell", "affix", "gold"]);
  });

  it("prefers what the player does not already hold", () => {
    const owned = ["magic_bolt", "stone_shard"];
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const cards = offerCards(ITEMS, rng(seed), owned);
      const spell = cards.find((c) => c.kind === "spell");
      expect(owned).not.toContain(spell?.itemId);
    }
  });

  it("never offers a spell that cannot work in a slot on its own", () => {
    /*
     * The trap this closes: a multicast parsed into a single keyed slot has no
     * children to repeat, so `fireUnit` iterates an empty list and the key does
     * nothing — no shot, no mana spent, no refusal reported. Offering one cost
     * the player a slot *and* the two real options on the same screen.
     *
     * Asserted across many seeds rather than once, because the pick is random
     * and a single draw proves nothing about the pool it drew from.
     */
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const spell = offerCards(ITEMS, rng(seed), []).find((c) => c.kind === "spell");
      const base = ITEMS.get(spell?.itemId ?? "");
      expect({ seed, id: spell?.itemId, ok: !!base && castableAlone(base) })
        .toEqual({ seed, id: spell?.itemId, ok: true });
    }
  });

  it("gives every card a name, a stat line and rules text", () => {
    for (const c of offerCards(ITEMS, rng(), [])) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.stats.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});

describe("offerDoors", () => {
  const base = {
    history: emptyHistory(), health: "full" as const,
    recent_damage: "none" as const, rest_owed: false,
  };

  it("offers the widest legal set, which is the baseline Jev has to beat", () => {
    const doors = offerDoors({ ...base, room_index: 4 });
    expect(doors.length).toBe(3);
  });

  it("returns a forced set unchanged", () => {
    // After room 9 the only legal set is the boss, and there is nothing to
    // choose — which is correct behaviour rather than a special case.
    expect(offerDoors({ ...base, room_index: 9 })).toEqual(["boss"]);
  });

  it("never offers a type the pacing rules forbid", () => {
    // Rule 6: treasure is entered at most twice per run.
    const history = { ...emptyHistory(), treasures_entered: 2 };
    const doors = offerDoors({ ...base, room_index: 5, history });
    expect(doors).not.toContain("treasure");
  });

  it("leans toward what the player has seen least", () => {
    const history = { ...emptyHistory(), rooms: ["combat", "combat", "combat"] as const };
    const doors = offerDoors({ ...base, room_index: 4, history });
    expect(doors.some((t) => t !== "combat")).toBe(true);
  });
});

describe("a kind-driven offer", () => {
  it("deals three cards of the door's kind, and only that kind", () => {
    /*
     * Doc 003 moves the currency decision to the portal, so the cards are
     * three answers to one question rather than three incomparable things.
     */
    for (const kind of ["stat", "spell", "affix"] as const) {
      const cards = offerCards(ITEMS, rng(kind), [], kind);
      expect({ kind, n: cards.length }).toEqual({ kind, n: 3 });
      expect(cards.every((c) => c.kind === kind)).toBe(true);
    }
  });

  it("shows no cards for gold, because three identical cards is not a choice", () => {
    expect(offerCards(ITEMS, rng(), [], "gold")).toEqual([]);
  });

  it("never repeats an item inside one offer", () => {
    // Two identical cards spend a slot to say the same thing twice.
    for (const kind of ["stat", "spell", "affix"] as const)
      for (const seed of ["a", "b", "c", "d"]) {
        const ids = offerCards(ITEMS, rng(seed), [], kind).map((c) => c.itemId);
        expect({ kind, seed, unique: new Set(ids).size }).toEqual({ kind, seed, unique: ids.length });
      }
  });

  it("gives every card in every kind a name, numbers and rules text", () => {
    for (const kind of ["stat", "spell", "affix"] as const)
      for (const c of offerCards(ITEMS, rng(kind), [], kind)) {
        expect({ kind, id: c.itemId, ok: c.label.length > 0 }).toEqual({ kind, id: c.itemId, ok: true });
        expect({ kind, id: c.itemId, ok: c.stats.length > 0 }).toEqual({ kind, id: c.itemId, ok: true });
        expect({ kind, id: c.itemId, ok: c.description.length > 20 })
          .toEqual({ kind, id: c.itemId, ok: true });
      }
  });

  it("offers a spell that can work alone, whatever the kind asked for", () => {
    for (const seed of ["a", "b", "c", "d", "e"])
      for (const c of offerCards(ITEMS, rng(seed), [], "spell")) {
        const base = ITEMS.get(c.itemId);
        expect({ id: c.itemId, ok: !!base && castableAlone(base) })
          .toEqual({ id: c.itemId, ok: true });
      }
  });

  it("deals only affixes some held spell can take", () => {
    // A staff of one burning field: no chains, no shatters, no repeats.
    for (const seed of ["a", "b", "c", "d", "e", "f"])
      for (const c of offerCards(ITEMS, rng(seed), [], "affix", ["field"])) {
        const a = spellAffixById(c.itemId)!;
        expect({ id: c.itemId, ok: affixFits(a, "field") }).toEqual({ id: c.itemId, ok: true });
        expect(c.description).toMatch(/Fits /);
      }
    // Nothing known about the staff: the whole pool is fair game.
    const ids = new Set<string>();
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"])
      for (const c of offerCards(ITEMS, rng(seed), [], "affix")) ids.add(c.itemId);
    expect(ids.has("shatter") || ids.has("repeat") || ids.has("fork")).toBe(true);
  });

  it("prefers what the player does not hold, in every kind", () => {
    const owned = offerCards(ITEMS, rng("x"), [], "stat").map((c) => c.itemId);
    const next = offerCards(ITEMS, rng("x"), owned, "stat").map((c) => c.itemId);
    // The same seed, so any difference is the ownership filter doing its job.
    expect(next).not.toEqual(owned);
  });
});
