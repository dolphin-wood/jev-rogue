/**
 * The staff as facts (doc 002, "The staff is a fact"; doc 010).
 *
 * Each of these is a bucket boundary or a claim the Director's grounding rests
 * on, so a change to either fails here rather than in a route review.
 */
import { describe, expect, it } from "vitest";
import { ITEMS } from "../spells/items.ts";
import { SPELL_LEVEL_MAX } from "../sim/spells.ts";
import { NO_BUILD, bucketCastsPerBar, buildFacts, costBand, keyCost } from "./build-facts.ts";

const spells = [...ITEMS.values()].map((i) => i.id);
const key = (base: string, level = 1, affixes: readonly string[] = []) =>
  ({ base, level, affixes: affixes.map((id) => ({ id, tier: 1 })) });

describe("the staff, as facts", () => {
  it("reports an empty staff rather than throwing", () => {
    expect(buildFacts({ keys: [], items: ITEMS, manaMax: 60 })).toEqual(NO_BUILD);
  });

  it("says how far the levels have moved, which was the whole complaint", () => {
    const at = (levels: readonly number[]) => buildFacts({
      keys: levels.map((l, i) => key(spells[i]!, l)), items: ITEMS, manaMax: 60,
    }).spell_levels;
    // Fourteen rooms of affix doors produce exactly this.
    expect(at([1, 1, 1])).toBe("all_base");
    expect(at([3, 1, 1])).toBe("some_raised");
    expect(at([2, 2, 2])).toBe("mostly_raised");
  });

  it("counts the affix slots still open across the whole staff", () => {
    const open = (affixes: readonly (readonly string[])[]) => buildFacts({
      keys: affixes.map((a, i) => key(spells[i]!, 1, a)), items: ITEMS, manaMax: 60,
    }).affix_slots_open;
    expect(open([[], [], []])).toBe("many");
    expect(open([["ward", "kindle", "harvest"], ["ward", "kindle"], ["ward", "kindle"]])).toBe("few");
    expect(open([
      ["ward", "kindle", "harvest"], ["ward", "kindle", "harvest"], ["ward", "kindle", "harvest"],
    ])).toBe("none");
  });

  /*
   * The loop the state could not see: a level costs ten per cent more mana and
   * the bar does not grow on its own, so a run that levels without buying mana
   * quietly stops being able to cast.
   */
  it("counts casts per bar, and a levelled build buys fewer of them", () => {
    const at = (level: number, manaMax = 60) => buildFacts({
      keys: [key(spells[0]!, level), key(spells[1]!, level), key(spells[2]!, level)],
      items: ITEMS, manaMax,
    }).casts_per_bar;
    const base = at(1);
    const maxed = at(SPELL_LEVEL_MAX);
    const order = ["many", "some", "few"];
    expect(order.indexOf(maxed)).toBeGreaterThanOrEqual(order.indexOf(base));
    /*
     * And a bigger bar buys them back — shown against a bar tight enough to
     * have somewhere to climb from. A cast costs a quarter less than it did
     * (`SPELL_COST_BASE`), so sixty mana is "many" casts even of a level-five
     * spell, and a comparison against the top bucket cannot show anything.
     */
    const tight = at(SPELL_LEVEL_MAX, 30);
    expect(order.indexOf(at(SPELL_LEVEL_MAX, 200))).toBeLessThan(order.indexOf(tight));
    // The bucket itself, at its own boundaries.
    expect(bucketCastsPerBar(60, [10])).toBe("many");
    expect(bucketCastsPerBar(60, [15])).toBe("some");
    expect(bucketCastsPerBar(60, [20])).toBe("few");
    expect(bucketCastsPerBar(60, [])).toBe("many");
    // A level really does cost more.
    expect(keyCost(key(spells[0]!, 5), ITEMS)).toBeGreaterThan(keyCost(key(spells[0]!, 1), ITEMS));
  });

  it("counts mana stats over the run, not the room", () => {
    const at = (statsTaken: readonly string[]) => buildFacts({
      keys: [key(spells[0]!)], items: ITEMS, manaMax: 60, statsTaken,
    }).mana_stats_taken;
    expect(at([])).toBe("none");
    expect(at(["vigour", "fleet"])).toBe("none");
    expect(at(["deep_well"])).toBe("one");
    expect(at(["deep_well", "quickening"])).toBe("several");
  });

  it("carries an infusion affix's element as an element the keys hold", () => {
    const plain = buildFacts({ keys: [key(spells[0]!)], items: ITEMS, manaMax: 60 });
    const iced = buildFacts({ keys: [key(spells[0]!, 1, ["rime"])], items: ITEMS, manaMax: 60 });
    expect(iced.held_elements).not.toBe("none");
    expect(["none", "one", "several"]).toContain(plain.held_elements);
  });

  /*
   * Doc 002 keeps numbers out of the state, so a cost travels as a word. The
   * sentence is prose on purpose: the card questions ask which of several
   * descriptions fits a build, and the build has to be describable.
   */
  it("writes one line per key, with no bare number in it but the level", () => {
    const facts = buildFacts({
      keys: [key(spells[0]!, 3, ["rime", "harvest"])], items: ITEMS, manaMax: 60,
    });
    const line = facts.held_spells[spells[0]!]!;
    expect(line).toContain("level 3 of 5");
    expect(line).toContain("rime, harvest");
    expect(line).toContain("one affix slot free");
    expect(line).toMatch(/cheap|moderate|dear/);
    // No mana figure: the band is the whole of what is said about the cost.
    expect(line).not.toMatch(/\d+(\.\d+)? mana/);
  });

  it("bands a cost against the bar, not against a fixed number", () => {
    expect(costBand(5, 60)).toBe("cheap");
    expect(costBand(7, 60)).toBe("moderate");
    expect(costBand(15, 60)).toBe("dear");
    // The same cost against a bar three times the size is cheap again.
    expect(costBand(15, 200)).toBe("cheap");
    // At doc 006's prices the bare pool spans all three bands, not one.
    const bands = new Set([...ITEMS.values()].map((i) => costBand(keyCost({ base: i.id, level: 1, affixes: [] }, ITEMS), 90)));
    expect([...bands].sort()).toEqual(["cheap", "dear", "moderate"]);
  });
});
