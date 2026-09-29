/**
 * **Every spell, as Jev reads it** (doc 006, "What a spell tells Jev").
 *
 * Jev reads a spell three ways: its behaviour in the briefing's build section
 * (`spellBehaviour`, written from its parameters), what a card of it is not
 * for (`spellNegative`, also from its parameters), and the one line a held key
 * gets in the label state (`held_spells`, from `buildFacts`). All three are
 * generated, so a new spell, shape or option can land on a branch nobody
 * wrote — an empty clause, a bolt's words on an orb, a figure where a word
 * belongs — and nothing but rendering every item would show it.
 *
 * And all three are **neutral facts**: what the spell does, never who it
 * suits, how it ranks against the pool, or whether it is good. The verdict
 * words below are the ones the old designer prose used ("suits a spam build",
 * "hits harder than any other common attack", "rewards letting a group
 * gather") and the vocabulary of the removed build-simulator labels
 * ("bottleneck", "mana sustain", "scope").
 */
import { describe, expect, it } from "vitest";
import { BASE_ITEMS, ITEMS, SPELL_AFFIXES, STAT_UPGRADES, buildFacts, cardPool, affixFitsSpell } from "@jr/core";
import type { BaseItem } from "@jr/core";
import { spellBehaviour } from "./briefing.ts";
import { spellNegative, cardNotFor } from "./questions/specs.ts";
import { AFFIX_LANES, AFFIX_INTENTS } from "./questions/affixes.ts";

/** The verdict words doc 006 rules out, as whole words or phrases. */
const VERDICTS: readonly RegExp[] = [
  /\bsuits?\b/i, /\bbetter\b/i, /\bworse\b/i, /\bbest\b/i, /\bweak(er|est)?\b/i, /\bstrong(er|est)?\b/i,
  /\bpowerful\b/i, /\breliable\b/i, /\blowest\b/i, /\bhighest\b/i, /\brewards?\b/i, /\bpays? for\b/i,
  /\bideal\b/i, /\bperfect\b/i, /\bmana sustain\b/i, /\bbottleneck\b/i, /\bscope\b/i, /\bthan any\b/i,
];

function verdictsIn(text: string): string[] {
  return VERDICTS.filter((v) => v.test(text)).map((v) => v.source);
}

/**
 * The briefing is where figures are allowed (doc 002: "lost 9 of 60, nearly
 * one of 6 hearts"), and a behaviour line is a list of them — but each has to
 * be a **figure of something**, read off a parameter: a number followed by its
 * unit or by the thing it counts, or a cap ("up to 3"). A bare number that
 * counts nothing is a leak from a template.
 */
const FIGURE = /(?:up to )?\d+(?:\.\d+)?(?:°| ?%| (?:ms|s|px)\b| (?:damage|more|bod(?:y|ies)|shards?|projectiles|blades|rings|eruptions|shots|from the key|mana)\b)/g;

/** Every level a key can be held at, and a spread of affixes that fit it. */
function heldLines(item: BaseItem): string[] {
  const fitting = SPELL_AFFIXES.filter((a) => affixFitsSpell(a, item, [])).map((a) => a.id);
  const lines: string[] = [];
  for (const level of [1, 3, 5])
    for (const affixes of [[], fitting.slice(0, 1), fitting.slice(0, 3)]) {
      const facts = buildFacts({
        keys: [{ base: item.id, level, affixes: affixes.map((id) => ({ id, tier: 1 })) }],
        items: ITEMS, manaMax: 90,
      });
      lines.push(facts.held_spells[item.id]!);
    }
  return lines;
}

describe("every spell, as the Director reads it (doc 006)", () => {
  it("has a behaviour line with no empty clause, whatever its shape and options", () => {
    for (const item of BASE_ITEMS) {
      const text = spellBehaviour(item);
      expect(text.length, item.id).toBeGreaterThan(20);
      expect(text, item.id).not.toMatch(/,\s*,|,\s*\.$|\bundefined\b|\bnull\b|\bNaN\b/);
      expect(verdictsIn(text), `${item.id}: ${text}`).toEqual([]);
      // A shape the switch does not know falls to the bolt's words; only a bolt may read as one.
      const shape = typeof item.params["shape"] === "string" ? item.params["shape"] : "bolt";
      if (shape !== "bolt") expect(text, item.id).not.toMatch(/^(one projectile|\d+ projectiles)/);
    }
  });

  it("gives every figure in a behaviour line the thing it measures", () => {
    for (const item of BASE_ITEMS)
      for (const level of [1, 5]) {
        const bare = spellBehaviour(item, level).replace(FIGURE, "").match(/\d/g);
        expect(bare, `${item.id}@${level}: ${spellBehaviour(item, level)}`).toBeNull();
      }
  });

  it("says what each option does when a spell has one", () => {
    const has = (k: string) => BASE_ITEMS.filter((i) => typeof i.params[k] === "number" && (i.params[k] as number) > 0);
    for (const i of has("charges")) expect(spellBehaviour(i), i.id).toMatch(/banks one shot/);
    for (const i of has("charge")) expect(spellBehaviour(i), i.id).toMatch(/holding the key charges it/);
    for (const i of has("doom")) expect(spellBehaviour(i), i.id).toMatch(/mark bursts/);
    for (const i of has("emit")) expect(spellBehaviour(i), i.id).toMatch(/throws a shard/);
    for (const i of has("contagion")) expect(spellBehaviour(i), i.id).toMatch(/poison jumps/);
    for (const i of has("telegraph_ms")) expect(spellBehaviour(i), i.id).toMatch(/ground is marked/);
    for (const i of has("land")) expect(spellBehaviour(i), i.id).toMatch(/leaps/);
    for (const i of has("collapse_damage")) expect(spellBehaviour(i), i.id).toMatch(/implodes/);
    for (const i of BASE_ITEMS.filter((x) => x.params["pattern"] === "ring"))
      expect(spellBehaviour(i), i.id).toMatch(/rings of eruptions/);
  });

  it("has a negative for every spell, with no digit and no verdict", () => {
    const seen = new Set<string>();
    for (const item of BASE_ITEMS) {
      const text = spellNegative(item);
      expect(text.length, item.id).toBeGreaterThan(20);
      expect(text, item.id).not.toMatch(/\d/);
      expect(verdictsIn(text), `${item.id}: ${text}`).toEqual([]);
      seen.add(text);
    }
    // Written off each spell's own row, so the pool does not collapse onto a
    // handful of sentences (finding 18: a negative true of the whole pool
    // distinguishes nothing).
    expect(seen.size).toBeGreaterThanOrEqual(BASE_ITEMS.length * 0.6);
  });

  it("writes a held key's line for every spell, with no figure but its level", () => {
    for (const item of BASE_ITEMS)
      for (const line of heldLines(item)) {
        expect(line.startsWith(item.id.split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ")), line)
          .toBe(true);
        expect(line.replace(/level \d of \d/, ""), line).not.toMatch(/\d/);
        expect(verdictsIn(line), line).toEqual([]);
        expect(line, line).toMatch(/\b(cheap|moderate|dear) (to cast|a press|on release)\b/);
      }
  });

  it("prices a banked key by the press and a charged key on release", () => {
    const line = (id: string) => heldLines(ITEMS.get(id)!)[0]!;
    expect(line("mana_darts")).toMatch(/banks while it rests/);
    expect(line("mana_darts")).toMatch(/ a press\b/);
    expect(line("arcane_cannon")).toMatch(/charged while the key is held/);
    expect(line("arcane_cannon")).toMatch(/ on release\b/);
    expect(line("magic_bolt")).toMatch(/ to cast\b/);
  });
});

describe("every card's own text, as the Director reads it", () => {
  it("is a neutral fact for every spell, affix and stat", () => {
    for (const item of BASE_ITEMS) expect(verdictsIn(item.description), item.id).toEqual([]);
    for (const a of SPELL_AFFIXES) {
      expect(verdictsIn(a.description), a.id).toEqual([]);
      expect(verdictsIn(a.text), `${a.id}: ${a.text}`).toEqual([]);
    }
    for (const u of STAT_UPGRADES) expect(verdictsIn(u.description), u.id).toEqual([]);
  });

  it("sends the card's what and its not_for without a verdict, over every pool", () => {
    const pools = [
      cardPool(ITEMS, [], "spell"),
      cardPool(ITEMS, [], "stat"),
      cardPool(ITEMS, [], "affix"),
    ];
    for (const pool of pools)
      for (const c of pool.candidates) {
        expect(verdictsIn(c.description), `${c.id}: ${c.description}`).toEqual([]);
        const not = cardNotFor(c.id, c.facts, true) ?? "";
        expect(not.length, c.id).toBeGreaterThan(0);
        expect(verdictsIn(not), `${c.id}: ${not}`).toEqual([]);
        expect(not, c.id).not.toMatch(/\d/);
      }
  });

  it("gives every affix lane a neutral what and not_for", () => {
    for (const id of AFFIX_INTENTS) expect(verdictsIn(AFFIX_LANES[id].text), id).toEqual([]);
  });
});
