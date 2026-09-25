/**
 * Every moment a shape announces (the world's `"spell"` events, doc 006) is
 * heard: none falls through to silence, each names a sound that exists, and
 * a stance's weak answer does not sound like its full one.
 */
import { describe, expect, it } from "vitest";
import { shapeEventSound, spellSound } from "./spell-sfx.ts";
import { SFX_NAMES } from "./sfx.ts";

const SHAPE_EVENTS = [
  "orb", "orb_strike", "boomerang_turn", "boomerang_caught", "trail", "enchant",
  "wave", "stance", "stance_guard", "stance_answer",
] as const;

describe("shape event sounds", () => {
  it("gives every shape event a sound that exists", () => {
    for (const what of SHAPE_EVENTS) {
      const s = shapeEventSound(what);
      expect(s, what).not.toBeNull();
      if (s !== "cast" && s) expect(SFX_NAMES as readonly string[]).toContain(s.name);
    }
  });

  it("plays the spell's own cast for a shape started on the caster, and that spell has one", () => {
    for (const [what, spell] of [["orb", "ball_lightning"], ["trail", "cinder_stride"], ["enchant", "crescent_edge"], ["stance", "counter_stance"]] as const) {
      expect(shapeEventSound(what)).toBe("cast");
      expect(spellSound(spell).cast, spell).not.toBeNull();
    }
  });

  it("answers a guard that ran out differently from one that took a hit", () => {
    const full = shapeEventSound("stance_answer", 1);
    const weak = shapeEventSound("stance_answer", 0.4);
    expect(full).not.toEqual(weak);
  });
});
