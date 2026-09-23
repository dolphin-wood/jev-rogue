import { describe, it, expect } from "vitest";
import { isKnownTag, isKnownLabelRef, RARITIES } from "../content/tags.ts";
import { BASE_ITEMS, ITEMS, plainInstance } from "./items.ts";

/**
 * Doc 006's table, with one correction the design forced.
 *
 * The three `multicast` items are `boost`s now. Doc 006's `multicast N`
 * consumes the next N units *of a staff sequence* and fires them together; doc
 * 013 replaced that sequence with three independently keyed spells holding one
 * item each, so all three had nothing to consume and did nothing at all —
 * measured by `pnpm spell-check`, which fired every item in the pool.
 *
 * They kept their names and their place in the rarity ladder and became
 * `repeat` modifiers: the same spell, cast again. The `multicast` *kind* stays
 * in the schema, unused, because it is the right shape for a future item that
 * fires two genuinely different spells at once.
 */
// Thirteen attacks, not twelve: `shock_arc` is the second starting spell and
// the pool's only chaining attack. See doc 006's table.
// Nineteen attacks: twelve projectiles, the chaining shock arc, and the six
// shapes that are not projectiles (orbit, field, pillar, dash, vortex, summon).
// Twenty-two with the three role spells: frost nova, seeker swarm, fault line.
const COUNTS = { attack: 22, boost: 15, passive: 8, payload: 5, multicast: 0 } as const;

describe("base items (doc 006 and doc 010)", () => {
  it("ships exactly the 50 items of doc 006's table", () => {
    expect(BASE_ITEMS).toHaveLength(50);
    for (const [kind, n] of Object.entries(COUNTS)) {
      expect(BASE_ITEMS.filter((i) => i.kind === kind), kind).toHaveLength(n);
    }
  });

  it("has unique snake_case ids", () => {
    const ids = BASE_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("tags only from the closed vocabulary", () => {
    for (const item of BASE_ITEMS) {
      for (const tag of item.tags) expect(isKnownTag(tag), `${item.id}: ${tag}`).toBe(true);
      // The kind is always among the role tags, so role queries and kind
      // queries never disagree.
      expect(item.tags, item.id).toContain(item.kind);
      expect(RARITIES).toContain(item.rarity);
    }
  });

  it("references only known labels from jev_hints", () => {
    for (const item of BASE_ITEMS) {
      for (const ref of [...(item.jev_hints?.favor_when ?? []), ...(item.jev_hints?.avoid_when ?? [])]) {
        expect(isKnownLabelRef(ref), `${item.id}: ${ref}`).toBe(true);
      }
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

  it("gives every kind the numeric params its executor reads", () => {
    for (const item of BASE_ITEMS) {
      const p = item.params;
      if (item.kind === "attack" || item.kind === "payload") {
        for (const key of ["damage", "speed", "radius", "lifetime"]) {
          expect(typeof p[key], `${item.id}.${key}`).toBe("number");
        }
      }
      if (item.kind === "payload") {
        expect(["on_hit", "on_expire", "on_wall"]).toContain(p["trigger"]);
      }
      if (item.kind === "multicast") expect([2, 3]).toContain(p["n"]);
      if (item.kind === "passive") expect(item.mana).toBe(0);
    }
  });

  it("covers all three payload triggers", () => {
    const triggers = new Set(
      BASE_ITEMS.filter((i) => i.kind === "payload").map((i) => i.params["trigger"]),
    );
    expect([...triggers].sort()).toEqual(["on_expire", "on_hit", "on_wall"]);
  });

  it("makes plain instances that carry the base rarity", () => {
    const inst = plainInstance("void_orb");
    expect(inst).toEqual({
      uid: "void_orb", base: "void_orb", affix: null, magnitude: 0, modifier: null, rarity: "rare",
    });
    expect(ITEMS.get("void_orb")?.kind).toBe("attack");
  });
});
