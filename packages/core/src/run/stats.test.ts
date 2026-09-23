import { describe, expect, it } from "vitest";
import { noMods } from "../sim/types.ts";
import { STAT_UPGRADES, applyStat, statById, statIcon, statLine } from "./stats.ts";

describe("the intrinsic stat pool", () => {
  it("has unique ids and names", () => {
    expect(new Set(STAT_UPGRADES.map((s) => s.id)).size).toBe(STAT_UPGRADES.length);
    expect(new Set(STAT_UPGRADES.map((s) => s.name)).size).toBe(STAT_UPGRADES.length);
  });

  it("is mostly build-agnostic, which is what makes the stat door safe", () => {
    /*
     * Doc 013 asks "whether intrinsic stats touch spells at all" and declines
     * to answer, warning that a sword-only pool leaves a spell-heavy build
     * finding it weak. Once `stat` is a door the player *chooses*, the answer
     * is forced: most of what is behind it must be usable by anybody, or the
     * door is a trap for half the builds in the game.
     */
    const swordOnly = STAT_UPGRADES.filter((s) => s.family === "sword").length;
    expect(swordOnly / STAT_UPGRADES.length).toBeLessThan(0.4);
  });

  it("carries healing, because nothing else does any more", () => {
    /*
     * The rest room is gone. Kill drops offset about a fifth of the run's
     * attrition by design, so without an upgrade that heals, a run is a
     * monotonic decline in which two early hits decide the outcome.
     */
    expect(STAT_UPGRADES.some((s) => s.family === "survival" && s.magnitude >= 1)).toBe(true);
  });

  it("changes exactly one modifier per upgrade", () => {
    // One number, doc 013's rule. An upgrade that moves two is an upgrade the
    // player cannot compare against the other two cards.
    const base = noMods();
    for (const up of STAT_UPGRADES) {
      const after = applyStat(base, up.id);
      const changed = (Object.keys(base) as (keyof typeof base)[])
        .filter((k) => base[k] !== after[k]);
      expect({ id: up.id, changed }).toEqual({ id: up.id, changed: [changed[0]] });
    }
  });

  it("moves every modifier in the improving direction", () => {
    const base = noMods();
    for (const up of STAT_UPGRADES) {
      const after = applyStat(base, up.id);
      // Cooldowns and recovery are better when smaller; everything else when
      // larger. Asserted per upgrade so a sign error cannot hide.
      const smallerIsBetter = ["second_wind", "swift_hand"].includes(up.id);
      const key = (Object.keys(base) as (keyof typeof base)[])
        .find((k) => base[k] !== after[k])!;
      expect({ id: up.id, better: smallerIsBetter ? after[key] < base[key] : after[key] > base[key] })
        .toEqual({ id: up.id, better: true });
    }
  });

  it("stacks multiplicatively, so the tenth is worth what the first was", () => {
    let m = noMods();
    for (let i = 0; i < 3; i++) m = applyStat(m, "fleet");
    expect(m.speed).toBeCloseTo(1.08 ** 3, 6);
  });

  it("never drives a cooldown to zero, however many are stacked", () => {
    // Additive reduction reaching zero is an infinite fire rate.
    let m = noMods();
    for (let i = 0; i < 40; i++) m = applyStat(m, "swift_hand");
    expect(m.swingRecovery).toBeGreaterThan(0);
  });

  it("ignores an unknown id rather than throwing", () => {
    expect(applyStat(noMods(), "not_a_stat")).toEqual(noMods());
    expect(statById("not_a_stat")).toBeNull();
  });

  it("reads an improvement as an improvement", () => {
    // "-12% cooldown" is a number the player has to translate into "better".
    expect(statLine(statById("second_wind")!)).toContain("dash recovery");
    expect(statLine(statById("vigour")!)).toBe("+10 health");
    for (const up of STAT_UPGRADES) expect(statLine(up).length).toBeGreaterThan(4);
  });

  it("names an icon for every upgrade", () => {
    // The names are the art request; a test is what keeps the work order and
    // the pool from drifting apart.
    for (const up of STAT_UPGRADES) expect(statIcon(up)).toBe(`icon_stat_${up.id}`);
  });
});
