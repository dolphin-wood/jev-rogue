import { describe, expect, it } from "vitest";
import {
  SPELL_AFFIXES, SPELL_SHAPES, spellAffixById, spellAffixIcon, affixStrengthFloor,
  affixFits, affixFitsLine, itemShape,
} from "./affixes.ts";
import { ITEMS } from "./items.ts";
import type { AffixHook } from "./affixes.ts";

describe("the affix pool", () => {
  it("has unique ids and names", () => {
    expect(new Set(SPELL_AFFIXES.map((a) => a.id)).size).toBe(SPELL_AFFIXES.length);
    expect(new Set(SPELL_AFFIXES.map((a) => a.name)).size).toBe(SPELL_AFFIXES.length);
  });

  it("gives every affix one fixed effect and a strength, I to III", () => {
    // A strength tells affixes apart; it is not a ladder a duplicate climbs.
    for (const a of SPELL_AFFIXES) {
      expect(a.effect, a.id).toBeDefined();
      expect([1, 2, 3], a.id).toContain(affixStrengthFloor(a.id));
    }
    expect(affixStrengthFloor("repeat")).toBe(3);
    expect(affixStrengthFloor("kindle")).toBe(1);
  });

  it("hooks every affix onto a moment the simulation already has", () => {
    /*
     * This is the assertion that keeps the pool implementable. Each of these
     * is a place `sim` already reaches — a projectile's hit, expiry and wall,
     * and the world's events — so an affix is a use of existing moments
     * rather than a request for new machinery.
     */
    const real: readonly AffixHook[] = ["hit", "expire", "wall", "kill", "cast", "hurt", "dash", "swing"];
    for (const a of SPELL_AFFIXES)
      expect({ id: a.id, ok: real.includes(a.hook) }).toEqual({ id: a.id, ok: true });
  });

  it("covers the offensive, the economic and the defensive", () => {
    /*
     * Not a balance assertion — a coverage one. A pool that hooks only `hit`
     * would make every build the same build, because the only decision left
     * would be which projectile carries it.
     */
    const hooks = new Set(SPELL_AFFIXES.map((a) => a.hook));
    expect(hooks.has("hit")).toBe(true);
    expect(hooks.has("kill")).toBe(true);
    expect(hooks.has("cast")).toBe(true);
    // Something that fires when the player is losing, so the pool is not
    // exclusively a reward for already winning.
    expect(hooks.has("hurt") || hooks.has("dash")).toBe(true);
    expect(hooks.size).toBeGreaterThanOrEqual(5);
  });

  it("cannot express a bare number, which is the point", () => {
    /*
     * Doc 013's anti-collapse rule: "An affix adds or changes an event. A
     * spell level and a gold purchase scale numbers." It also says why this
     * has to be schema-enforced rather than trusted — the cheap kind is easier
     * to author, so the pool fills with it silently.
     *
     * The structural guarantee is that `AffixEffect` has no member that names
     * a spell's damage, mana or cooldown. This asserts it over the authored
     * data too, so a future member cannot quietly reintroduce one.
     */
    const forbidden = /damage|mana|cooldown|crit|speed_mult|_mult/;
    for (const a of SPELL_AFFIXES) {
      const keys = Object.keys(a.effect).join(" ");
      expect({ id: a.id, keys, clean: !forbidden.test(keys) })
        .toEqual({ id: a.id, keys, clean: true });
    }
  });

  it("says what it does in words", () => {
    // The card screen exists so an item can be read. An affix with no text is
    // an affix the player has to learn by dying.
    for (const a of SPELL_AFFIXES) {
      expect(a.description.length).toBeGreaterThan(40);
      expect(a.text.length).toBeGreaterThan(8);
    }
  });

  it("names an icon for every affix", () => {
    // The names are the art request. If this list changes, the work order has
    // to change with it, and a test is the only thing that will say so.
    expect(SPELL_AFFIXES.map(spellAffixIcon).sort()).toEqual([
      "icon_affix_blight", "icon_affix_bloom", "icon_affix_brand", "icon_affix_chain",
      "icon_affix_finale", "icon_affix_fork", "icon_affix_harvest", "icon_affix_haste", "icon_affix_kindle",
      "icon_affix_momentum", "icon_affix_pierce", "icon_affix_repeat", "icon_affix_resonance", "icon_affix_retort",
      "icon_affix_ricochet", "icon_affix_rime", "icon_affix_scatter", "icon_affix_seek",
      "icon_affix_shatter", "icon_affix_slipstream", "icon_affix_undertow", "icon_affix_ward",
    ]);
  });

  it("looks up by id and refuses an unknown one", () => {
    expect(spellAffixById("fork")?.name).toBe("Fork");
    expect(spellAffixById("damage_up")).toBeNull();
  });

  it("names the spell shapes it works on, and every shape has takers", () => {
    for (const a of SPELL_AFFIXES) {
      expect(a.shapes.length, a.id).toBeGreaterThan(0);
      for (const s of a.shapes) expect(SPELL_SHAPES).toContain(s);
    }
    // A hook that needs a projectile is not offered to a spell without one.
    for (const a of SPELL_AFFIXES)
      if (a.hook === "hit" || a.hook === "kill" || a.hook === "expire" || a.hook === "wall")
        for (const s of a.shapes) expect(["bolt", "orbit", "boomerang", "orb", "enchant"], `${a.id} on ${s}`).toContain(s);
    expect(affixFits(spellAffixById("shatter")!, "field")).toBe(false);
    expect(affixFits(spellAffixById("ward")!, "summon")).toBe(true);
    // Every shape in the pool has at least one affix that fits it.
    for (const s of SPELL_SHAPES)
      expect(SPELL_AFFIXES.some((a) => affixFits(a, s)), s).toBe(true);
  });

  it("reads an item's shape, with a projectile as the default", () => {
    expect(itemShape(ITEMS.get("magic_bolt"))).toBe("bolt");
    expect(itemShape(ITEMS.get("spirit_blades"))).toBe("orbit");
    expect(itemShape(ITEMS.get("wildfire_field"))).toBe("field");
    expect(itemShape(ITEMS.get("earth_spikes"))).toBe("eruption");
    expect(itemShape(null)).toBe("bolt");
  });

  it("says where it fits, in words the card can carry", () => {
    expect(affixFitsLine(spellAffixById("ward")!)).toBe("fits any spell");
    expect(affixFitsLine(spellAffixById("chain")!)).toBe("fits bolt, boomerang, orb");
  });

  it("fits nine slots with room to choose", () => {
    /*
     * Doc 013: three spells, three affix slots each. A pool barely larger than
     * the slots means every run converges on holding all of them, and the
     * decision disappears. Twelve against nine is thin on purpose — duplicates
     * are supposed to be common, because a duplicate is an upgrade.
     */
    expect(SPELL_AFFIXES.length).toBeGreaterThanOrEqual(12);
  });
});

describe("a spread does not seek", () => {
  it("keeps seek off spells of several shots and apart from scatter", async () => {
    const { affixFitsSpell, spellAffixById } = await import("./affixes.ts");
    const seek = spellAffixById("seek")!;
    const scatter = spellAffixById("scatter")!;
    expect(affixFitsSpell(seek, ITEMS.get("magic_bolt"), [])).toBe(true);
    expect(affixFitsSpell(seek, ITEMS.get("scatter_shot"), [])).toBe(false);
    expect(affixFitsSpell(seek, ITEMS.get("magic_bolt"), ["scatter"])).toBe(false);
    expect(affixFitsSpell(scatter, ITEMS.get("magic_bolt"), ["seek"])).toBe(false);
  });

  it("gives no spell of several shots a seek of its own, but the swarm", () => {
    for (const item of ITEMS.values()) {
      const count = Number(item.params["count"] ?? 1);
      if (count <= 1 || item.id === "seeker_swarm") continue;
      expect(Number(item.params["seek"] ?? 0), item.id).toBe(0);
    }
  });
});

describe("a run with a wake is not cast behind", () => {
  it("keeps scatter off Dash Slash, on the key and on the reward screen alike, and leaves the other dashes theirs", async () => {
    const { affixFitsSpell, spellAffixById } = await import("./affixes.ts");
    const { affixFitsHeld, heldSpell } = await import("../run/offer.ts");
    const scatter = spellAffixById("scatter")!;
    expect(affixFitsSpell(scatter, ITEMS.get("dash_slash"), [])).toBe(false);
    expect(affixFitsHeld(scatter, heldSpell(ITEMS.get("dash_slash")))).toBe(false);
    const slip = spellAffixById("slipstream")!;
    expect(affixFitsSpell(slip, ITEMS.get("dash_slash"), [])).toBe(false);
    expect(affixFitsHeld(slip, heldSpell(ITEMS.get("dash_slash")))).toBe(false);
    for (const id of ["blink_strike", "leap_slam"]) {
      expect(affixFitsSpell(scatter, ITEMS.get(id), []), id).toBe(true);
      expect(affixFitsHeld(scatter, heldSpell(ITEMS.get(id))), id).toBe(true);
    }
  });
});

describe("no pairing that does nothing or reads wrong", () => {
  it("keeps chain and bloom off sword energy and blade rings, and resonance off the enchant", async () => {
    const { affixFitsSpell, spellAffixById } = await import("./affixes.ts");
    const fits = (a: string, s: string): boolean => affixFitsSpell(spellAffixById(a)!, ITEMS.get(s), []);
    expect(fits("chain", "crescent_edge")).toBe(false);
    expect(fits("chain", "spirit_blades")).toBe(false);
    expect(fits("bloom", "crescent_edge")).toBe(false);
    expect(fits("resonance", "crescent_edge")).toBe(false);
    // What they are for is kept.
    expect(fits("chain", "magic_bolt")).toBe(true);
    expect(fits("chain", "returning_edge")).toBe(true);
    expect(fits("resonance", "spirit_blades")).toBe(true);
  });

  it("offers no affix a spell already is: seek on a hard steer, pierce on a shot through everything, fork on a ring", async () => {
    const { affixFitsSpell, spellAffixById } = await import("./affixes.ts");
    const fits = (a: string, s: string): boolean => affixFitsSpell(spellAffixById(a)!, ITEMS.get(s), []);
    for (const s of ["shock_arc", "arc_lance", "mana_darts"]) expect(fits("seek", s), s).toBe(false);
    for (const s of ["fault_line", "frozen_orb"]) expect(fits("pierce", s), s).toBe(false);
    expect(fits("fork", "frost_nova")).toBe(false);
    expect(fits("seek", "magic_bolt")).toBe(true);
    expect(fits("pierce", "arc_lance")).toBe(true);
  });
});
