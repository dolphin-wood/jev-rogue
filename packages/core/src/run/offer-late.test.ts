/**
 * **Two rules for the late run**: an affix the player keeps turning down
 * stops being dealt (`exhaustedAffixes`), and a strong door's new spell comes
 * with an affix (`innateAffix`) — the same one in the pool the Director
 * judges, on the card the screen deals, and on the key it goes onto.
 */
import { describe, expect, it } from "vitest";
import { ITEMS } from "../spells/items.ts";
import { RngSource } from "../rng.ts";
import { affixFitsSpell, affixStrengthFloor, spellAffixById } from "../spells/affixes.ts";
import {
  AFFIX_DECLINES, INNATE_GRADE, cardPool, cardsFor, exhaustedAffixes, heldSpell, innateAffix, offerCards,
} from "./offer.ts";
import type { RunJournalEntry } from "../types.ts";

const room = (index: number, keys: string[], passed: string[]): RunJournalEntry =>
  ({ index, type: "combat", keys, passed_over: passed } as RunJournalEntry);

describe("an affix turned down twice against the same keys", () => {
  it("is not dealt again", () => {
    const journal = [room(1, ["shock_arc"], ["harvest", "ward"]), room(2, ["shock_arc"], ["harvest", "kindle"])];
    expect(AFFIX_DECLINES).toBe(2);
    expect(exhaustedAffixes(journal, ["shock_arc"], ITEMS)).toEqual(["harvest"]);
  });

  it("comes back once a spell that can take it is on a key", () => {
    // Spillover needs a spell with an element; Ember Dart has one, and it arrived after the refusals.
    const journal = [room(1, ["shock_arc"], ["spillover"]), room(2, ["shock_arc"], ["spillover"])];
    expect(exhaustedAffixes(journal, ["shock_arc"], ITEMS)).toContain("spillover");
    expect(exhaustedAffixes(journal, ["shock_arc", "ember_dart"], ITEMS)).not.toContain("spillover");
    // And a spell that cannot take it resets nothing: Earth Spikes takes no hit affix.
    const bolt = [room(1, ["shock_arc"], ["brand"]), room(2, ["shock_arc"], ["brand"])];
    expect(exhaustedAffixes(bolt, ["shock_arc", "earth_spikes"], ITEMS)).toContain("brand");
  });

  it("counts only affixes, and a taken card is no refusal", () => {
    const journal = [room(1, ["shock_arc"], ["magic_bolt", "fleet"]), room(2, ["shock_arc"], ["magic_bolt", "fleet"])];
    expect(exhaustedAffixes(journal, ["shock_arc"], ITEMS)).toEqual([]);
  });

  it("leaves the pool, unless the screen would come up short without it", () => {
    const held = [heldSpell(ITEMS.get("shock_arc"), [])];
    const full = cardPool(ITEMS, [], "affix", held, { grade: 1 }, {});
    const out = cardPool(ITEMS, [], "affix", held, { grade: 1 }, { exhausted: ["harvest"] });
    expect(full.candidates.map((c) => c.id)).toContain("harvest");
    expect(out.candidates.map((c) => c.id)).not.toContain("harvest");
    const everything = full.candidates.map((c) => c.id);
    const starved = cardPool(ITEMS, [], "affix", held, { grade: 1 }, { exhausted: everything });
    expect(starved.candidates.length).toBeGreaterThanOrEqual(3);
  });
});

describe("a strong door's new spell", () => {
  const promise = { grade: INNATE_GRADE, style: "nuke", salt: "seed:7", held: ["earth_spikes"] };

  it("comes with one affix it can take, of strength I or II", () => {
    for (const item of ITEMS.values()) {
      const a = innateAffix(ITEMS, item.id, INNATE_GRADE, { ...promise, held: [] });
      expect(a, item.id).not.toBeNull();
      expect(affixFitsSpell(a!, item, []), `${item.id} + ${a!.id}`).toBe(true);
      expect(affixStrengthFloor(a!.id)).toBeLessThanOrEqual(2);
    }
  });

  it("comes with nothing below strength III, and a copy of a held spell brings nothing", () => {
    expect(innateAffix(ITEMS, "mortar", INNATE_GRADE - 1, promise)).toBeNull();
    expect(innateAffix(ITEMS, "earth_spikes", INNATE_GRADE, promise)).toBeNull();
  });

  it("is the same affix in the Director's pool and on the card dealt", () => {
    const pool = cardPool(ITEMS, [], "spell", [heldSpell(ITEMS.get("earth_spikes"), [])], promise, {});
    const cards = cardsFor(ITEMS, "spell", ["mortar", "earth_spikes"], promise);
    const mortar = cards.find((c) => c.itemId === "mortar")!;
    const innate = mortar.affixes?.[0];
    expect(innate).toBeDefined();
    const name = spellAffixById(innate!)!.name;
    expect(pool.candidates.find((c) => c.id === "mortar")!.description).toContain(`comes with ${name}`);
    expect(mortar.statParts?.some((p) => p.key === "card.innate" && p.args?.["affix"] === innate)).toBe(true);
    expect(cards.find((c) => c.itemId === "earth_spikes")!.affixes).toBeUndefined();
  });

  it("differs from room to room, and leans to the run's style", () => {
    const seen = new Set<string>();
    for (let r = 0; r < 30; r++) seen.add(innateAffix(ITEMS, "magic_bolt", INNATE_GRADE, { ...promise, salt: `s:${r}`, held: [] })!.id);
    expect(seen.size).toBeGreaterThan(1);
    const rule = offerCards(ITEMS, new RngSource("late").stream("o"), [], "spell", [], { ...promise, held: [] });
    for (const c of rule) expect(c.affixes?.length, c.itemId).toBe(1);
  });
});
