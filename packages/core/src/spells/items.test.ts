import { describe, it, expect } from "vitest";
import { ARCHETYPES, isKnownTag, RARITIES } from "../content/tags.ts";
import { BASE_ITEMS, ITEMS, STYLE_START, plainInstance } from "./items.ts";

/*
 * Thirty-nine attacks: twelve projectiles, the chaining shock arc, the six
 * shapes that are not projectiles (orbit, field, pillar, dash, vortex, summon),
 * the three role spells (frost nova, seeker swarm, fault line), the three
 * ground eruptions (earth spikes, flame pillars, cinder geysers), the
 * eight spells on doc 006's newer options (mana darts, arcane cannon, doom
 * sigil, frozen orb, contagion, meteor, quake ring, leap slam) and the six
 * on its newer shapes (ball lightning, returning edge, crescent edge, counter
 * stance, cinder stride, toxic cloud). Every item is a self-contained spell:
 * nothing in the pool modifies another.
 */
const ATTACKS = 40;

describe("base items (doc 013 and doc 010)", () => {
  it("ships exactly the forty attacks", () => {
    expect(BASE_ITEMS).toHaveLength(ATTACKS);
    expect(ITEMS.size).toBe(ATTACKS);
  });

  it("has unique snake_case ids", () => {
    const ids = BASE_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("tags only from the closed vocabulary", () => {
    for (const item of BASE_ITEMS) {
      for (const tag of item.tags) expect(isKnownTag(tag), `${item.id}: ${tag}`).toBe(true);
      // Every spell attacks, so role queries for `attack` cover the pool.
      expect(item.tags, item.id).toContain("attack");
      expect(RARITIES).toContain(item.rarity);
    }
  });

  it("obeys doc 010's mechanical description rules", () => {
    for (const item of BASE_ITEMS) {
      expect(item.description.length, item.id).toBeLessThan(220);
      if (!item.numeric_ok) expect(item.description, item.id).not.toMatch(/\d/);
      // Rule 1: name and effect in one clause, so a description starts with
      // the item's own name.
      const name = item.id.split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
      expect(item.description.startsWith(name), `${item.id}: ${item.description}`).toBe(true);
    }
  });

  it("gives every spell the numeric params its executor reads", () => {
    for (const item of BASE_ITEMS) {
      for (const key of ["damage", "speed", "radius", "lifetime"]) {
        expect(typeof item.params[key], `${item.id}.${key}`).toBe("number");
      }
    }
  });

  it("starts every style on one spell of the pool", () => {
    expect(Object.keys(STYLE_START).sort()).toEqual([...ARCHETYPES].sort());
    for (const id of Object.values(STYLE_START)) expect(ITEMS.has(id), id).toBe(true);
  });

  it("makes plain instances that carry the base rarity", () => {
    expect(plainInstance("void_orb")).toEqual({ uid: "void_orb", base: "void_orb", rarity: "rare" });
  });
});

describe("the sword-energy spells' constants", () => {
  it("are the sim's own: the sword's hit and the pool's damage scale", async () => {
    const { SWORD_HIT, SPELL_SCALE } = await import("./items.ts");
    const { SWING_DAMAGE } = await import("../sim/melee.ts");
    const { SPELL_DAMAGE_SCALE } = await import("../sim/cast.ts");
    expect(SWORD_HIT).toBe(SWING_DAMAGE);
    expect(SPELL_SCALE).toBe(SPELL_DAMAGE_SCALE);
  });
});
