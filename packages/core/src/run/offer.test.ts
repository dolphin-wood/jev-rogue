import { describe, expect, it } from "vitest";
import { ITEMS } from "../spells/items.ts";
import { RngSource } from "../rng.ts";
import { makeSpell, slotCost } from "../sim/spells.ts";
import { plainInstance } from "../spells/index.ts";

const STAFF_FOR_COST = { slots: 6, mana_max: 120 };
import { affixFitsHeld, cardPool, emptyHistory, fittingAffixes, heldSpell, offerCards, offerDoors, strengthGroup, offerStatParts, offerStats, ruleOffer } from "./offer.ts";
import { affixFits, affixFitsSpell, affixStrengthFloor, SPELL_AFFIXES, spellAffixById } from "../spells/affixes.ts";
import { PLAYER_TEXT } from "../content/player-text.ts";
import { STAT_UPGRADES } from "./stats.ts";

const rng = (seed = "o"): ReturnType<RngSource["stream"]> =>
  new RngSource(seed).stream("offer");

const item = (id: string) => {
  const base = ITEMS.get(id);
  if (!base) throw new Error(`no item ${id}`);
  return base;
};

describe("ruleOffer", () => {
  it("keeps the portal count already drawn before an offer fallback", () => {
    const run = { roomIndex: 5, lastWasElite: false, critical: false };
    // This stream would draw three doors if ruleOffer chose a fresh count.
    const offer = ruleOffer(ITEMS, new RngSource("muiew8ni-yrz-12").stream("offer"), [], run, "spell", [], {}, 2);
    expect(offer.doors).toHaveLength(2);
  });
});

describe("offerStats", () => {
  it("leads with the cost, because that is what decides affordability", () => {
    // What the cast actually spends, not the item's cost rank.
    expect(offerStats(item("magic_bolt"))).toMatch(new RegExp(`^${slotCost(makeSpell(plainInstance("magic_bolt")), ITEMS, STAFF_FOR_COST)} mana`));
    expect(offerStats(item("void_orb"))).toMatch(/mana/);
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
    // The gap a not-empty assertion cannot see: every card has to say
    // something beyond what it costs.
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
    /*
     * Measured per **part**, not over the whole line. The card draws the
     * parts as a wrapped row of coloured chips (`statRow`), so what has to be
     * readable at a glance is each figure; the line as a whole grew when the
     * element stopped being a word inside the damage and became a part that
     * says what the status is worth. A part longer than this is one that has
     * stopped being a figure and started being a sentence.
     */
    for (const base of ITEMS.values())
      for (const part of offerStatParts(base))
        expect({ id: base.id, part: part.text, len: part.text.length <= 40 })
          .toEqual({ id: base.id, part: part.text, len: true });
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

  it("offers a spell and an affix alongside it", () => {
    const cards = offerCards(ITEMS, rng(), []);
    expect(cards.map((c) => c.kind)).toEqual(["spell", "affix", "gold"]);
  });

  it("deals the mixed offer's affix the way the affix door does: one a held spell can take", () => {
    const held = [heldSpell(ITEMS.get("earth_spikes"))];
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const affix = offerCards(ITEMS, rng(seed), [], undefined, held).find((c) => c.kind === "affix");
      expect(fittingAffixes(held).map((a) => a.id), seed).toContain(affix?.itemId);
    }
  });

  it("prefers what the player does not already hold", () => {
    const owned = ["magic_bolt", "stone_shard"];
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const cards = offerCards(ITEMS, rng(seed), owned);
      const spell = cards.find((c) => c.kind === "spell");
      expect(owned).not.toContain(spell?.itemId);
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

  it("deals only affixes some held spell can take", () => {
    // A staff of one burning field: no chains, no shatters, no repeats.
    for (const seed of ["a", "b", "c", "d", "e", "f"])
      for (const c of offerCards(ITEMS, rng(seed), [], "affix", [{ shape: "field", count: 1, affixes: [] }])) {
        const a = spellAffixById(c.itemId)!;
        expect({ id: c.itemId, ok: affixFits(a, "field") }).toEqual({ id: c.itemId, ok: true });
        expect(c.description).toMatch(/Fits /);
      }
    // Nothing known about the staff: the whole pool is fair game.
    const ids = new Set<string>();
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"])
      for (const c of offerCards(ITEMS, rng(seed), [], "affix")) ids.add(c.itemId);
    expect(ids.has("shatter") || ids.has("repeat") || ids.has("fork") || ids.has("chain") || ids.has("pierce")).toBe(true);
  });

  /**
   * **The dead-combination audit** (reported from play: a scatter-shot build
   * offered Seek, over and over).
   *
   * Seek does nothing on a spell that throws several projectiles — a fan that
   * all bends onto one body is the fan collapsed to one shot — so
   * `affixFitsSpell` refuses to attach it, and the shape filter could not see
   * the difference because both are `bolt`. Every pair of a real spell and a
   * real affix is checked here, so a new spell or a new affix that opens a dead
   * combination fails the build rather than reaching a reward screen.
   */
  it("offers no affix a held spell cannot actually take, over every spell", () => {
    const spells = [...ITEMS.values()];
    const dead: string[] = [];
    const unaffixable: string[] = [];
    for (const spell of spells) {
      const key = heldSpell(spell);
      const fits = fittingAffixes([key]);
      // The filter and the attach rule are the same rule, or one of them lies.
      for (const a of SPELL_AFFIXES) {
        const offered = fits.includes(a);
        const attaches = affixFitsSpell(a, spell, []);
        if (offered !== attaches) dead.push(`${spell.id} x ${a.id}: offered ${offered}, attaches ${attaches}`);
      }
      // A spell nothing fits would fall back to the whole pool, which is the
      // dead card again wearing the fallback's clothes.
      if (fits.length < 2) unaffixable.push(spell.id);
    }
    expect(dead).toEqual([]);
    expect(unaffixable).toEqual([]);

    // And the pool the Director draws from carries the same filter.
    for (const spell of spells) {
      const key = heldSpell(spell);
      for (const c of cardPool(ITEMS, [], "affix", [key]).candidates) {
        const a = spellAffixById(c.id)!;
        expect({ spell: spell.id, affix: c.id, ok: affixFitsHeld(a, key) })
          .toEqual({ spell: spell.id, affix: c.id, ok: true });
      }
    }
  });

  it("names which held spell each affix fits when the staff mixes shapes", () => {
    const held = [heldSpell(item("meteor")), heldSpell(item("shock_arc")), heldSpell(item("magic_bolt"))];
    const candidates = new Map(cardPool(ITEMS, [], "affix", held).candidates.map((c) => [c.id, c]));
    expect(candidates.get("fork")?.compatibleHeldSpellIds).toEqual(["shock_arc", "magic_bolt"]);
    expect(candidates.get("scatter")?.compatibleHeldSpellIds).toEqual(["meteor", "shock_arc", "magic_bolt"]);
    expect(candidates.get("repeat")?.compatibleHeldSpellIds).toEqual(["meteor", "shock_arc", "magic_bolt"]);
  });

  it("never offers an affix a key already holds, and still offers a full key new ones to swap in", () => {
    const spell = [...ITEMS.values()].find((i) => Number(i.params["count"] ?? 1) === 1)!;
    const full = heldSpell(spell, ["ward", "kindle", "resonance"]);
    const offered = fittingAffixes([full]).map((a) => a.id);
    expect(offered).not.toContain("ward");
    expect(offered).not.toContain("kindle");
    expect(offered).toContain("pierce");
  });

  /*
   * **A spell offer to a full staff is both rewards at once** (doc 007).
   *
   * It used to be one: with no key free the pool became the held spells alone,
   * so a run whose keys filled with the first three spells it was shown could
   * never change its mind. Both are real rewards — a copy raises a level, a new
   * spell is a replacement the player may well want — and which of them the
   * offer leans toward is the Director's call, so code only guarantees that
   * both are on the table.
   */
  it("offers a full staff both upgrades and replacements, and guarantees one of each", () => {
    const held = [...ITEMS.values()].slice(0, 3).map((i) => i.id);
    const pool = cardPool(ITEMS, [], "spell", [], {}, { keysFree: false, heldSpells: held });
    const ids = pool.candidates.map((c) => c.id);
    // Both sorts are in the pool: an upgrade of a held key, and a new spell.
    expect(ids.some((id) => held.includes(id))).toBe(true);
    expect(ids.some((id) => !held.includes(id))).toBe(true);
    // And code says so, as the one bound the Director may not draw around.
    expect(pool.guarantee).toHaveLength(2);
    const [upgrades, replacements] = pool.guarantee!;
    expect(upgrades!.every((id) => held.includes(id))).toBe(true);
    expect(replacements!.every((id) => !held.includes(id))).toBe(true);
    // A held spell already at the cap is not an upgrade, so it leaves that group.
    const capped = cardPool(ITEMS, held.slice(0, 1), "spell", [], {}, { keysFree: false, heldSpells: held });
    expect(capped.guarantee?.[0]).not.toContain(held[0]);
  });

  it("guarantees nothing when a key is still free: every spell is an addition", () => {
    const held = [...ITEMS.values()].slice(0, 2).map((i) => i.id);
    expect(cardPool(ITEMS, [], "spell", [], {}, { keysFree: true, heldSpells: held }).guarantee)
      .toBeUndefined();
  });

  it("prefers what the player does not hold, in every kind", () => {
    const owned = offerCards(ITEMS, rng("x"), [], "stat").map((c) => c.itemId);
    const next = offerCards(ITEMS, rng("x"), owned, "stat").map((c) => c.itemId);
    // The same seed, so any difference is the ownership filter doing its job.
    expect(next).not.toEqual(owned);
  });
});

/**
 * **What a card's option says, and in whose voice.**
 *
 * The pool's `description` is the text the Director ranks a card by, and it
 * used to be core's own — which is written for a designer choosing what to
 * build next: "at the lowest mana cost in the attack pool", "suits a spam
 * build", "the only stat that improves every part of the game at once, which
 * is why its step is the smallest in the pool". Every one of those is a
 * verdict about the pool handed to the thing being asked to judge the pool
 * (finding 11). The descriptions are neutral facts now (doc 006, "What a
 * spell tells Jev"), and the option is written from them; `PLAYER_TEXT` is the
 * player's voice and stays with the game's own table.
 */
describe("a candidate's own sentence", () => {
  const held = [heldSpell(item("magic_bolt"), [])];
  const pools = () => [
    cardPool(ITEMS, [], "spell"),
    cardPool(ITEMS, [], "stat"),
    cardPool(ITEMS, [], "affix", held),
  ];

  it("is the content table's neutral description, named once", () => {
    for (const pool of pools())
      for (const c of pool.candidates) {
        const own = ITEMS.get(c.id)?.description ?? spellAffixById(c.id)?.description
          ?? STAT_UPGRADES.find((u) => u.id === c.id)?.description;
        // A spell's sentence opens with its name (doc 010, rule 1); the others are prefixed with it.
        expect(c.description, c.id).toBe(ITEMS.has(c.id) ? own : `${nameOfCard(c.id)}: ${own}`);
        expect(c.description.startsWith(nameOfCard(c.id)), c.id).toBe(true);
      }
  });

  it("carries no verdict about the pool or about a build", () => {
    const verdict = /suits an? \w+ build|in the (attack )?pool|smallest in the pool|the only \w+ that/i;
    for (const pool of pools())
      for (const c of pool.candidates)
        expect(verdict.test(c.description), `${c.id}: ${c.description}`).toBe(false);
  });

  it("has a player line for every card any pool can offer", () => {
    for (const pool of pools())
      for (const c of pool.candidates) expect(PLAYER_TEXT[c.id], c.id).toBeTruthy();
  });
});

/** A card's display name, as `cardText` builds it. */
function nameOfCard(id: string): string {
  const stat = STAT_UPGRADES.find((u) => u.id === id);
  if (stat) return stat.name;
  const affix = spellAffixById(id);
  if (affix) return affix.name;
  return id.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

describe("door strength (a door's grade)", () => {
  it("rises with the run: I early, II mid-run, III for the last fights, an elite one higher", async () => {
    const { baseStrength } = await import("./doors.ts");
    expect([2, 5, 6, 10, 11, 14].map((r) => baseStrength(r, false))).toEqual([1, 1, 2, 2, 3, 3]);
    expect([2, 6, 11].map((r) => baseStrength(r, true))).toEqual([2, 3, 3]);
  });

  it("deals an affix only from a door strong enough for it, a duplicate of a held one included", () => {
    const held = [heldSpell(ITEMS.get("magic_bolt"))];
    const ids = (grade: number) => cardPool(ITEMS, [], "affix", held, { grade }).candidates.map((c) => c.id);
    expect(ids(1)).not.toContain("repeat");
    expect(ids(1)).not.toContain("chain");
    expect(ids(1)).toContain("kindle");
    expect(ids(2)).toContain("fork");
    expect(ids(2)).not.toContain("chain");
    expect(ids(2)).not.toContain("repeat");
    expect(ids(3)).toContain("chain");
    expect(ids(3)).toContain("repeat");
    // Already on the key, it is still a strength-III card to raise.
    const withRepeat = [heldSpell(ITEMS.get("magic_bolt"), ["repeat"])];
    expect(cardPool(ITEMS, [], "affix", withRepeat, { grade: 2 }).candidates.map((c) => c.id)).not.toContain("repeat");
  });

  it("guarantees a strong affix door one card of its own strength, and a strength-I door nothing", () => {
    const held = [heldSpell(ITEMS.get("magic_bolt"))];
    const guarantee = (grade: number) => cardPool(ITEMS, [], "affix", held, { grade }).guarantee;
    expect(guarantee(1)).toBeUndefined();
    for (const grade of [2, 3]) {
      const groups = guarantee(grade)!;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.length).toBeGreaterThan(0);
      for (const id of groups[0]!) expect(affixStrengthFloor(id), id).toBe(grade);
    }
    // Nothing of III fits: the next strength down stands in.
    expect(strengthGroup(["kindle", "fork"], 3)).toEqual(["fork"]);
    expect(strengthGroup(["kindle"], 3)).toEqual([]);
  });

  it("deals a rule affix door a card of its own strength every time", () => {
    const held = [heldSpell(ITEMS.get("magic_bolt"))];
    for (const grade of [2, 3]) for (let seed = 0; seed < 40; seed++) {
      const cards = offerCards(ITEMS, rng(`g${seed}`), [], "affix", held, { grade });
      expect(cards.some((c) => c.grade === grade), `grade ${grade} seed ${seed}`).toBe(true);
      for (const c of cards) expect(c.grade ?? 1).toBeLessThanOrEqual(grade);
    }
  });
});
