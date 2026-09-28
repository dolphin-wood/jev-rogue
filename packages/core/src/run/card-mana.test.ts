/**
 * The mana a spell's panel prints is the mana its cast spends — **after the
 * affixes are on it**.
 *
 * `offerStatParts` prices a spell from its base cost and its level, because it
 * is handed an item and an item has no affixes. Every panel that drew a
 * *slotted* spell through it therefore quoted the bare spell: a bolt carrying
 * a tier-three fork and a tier-three chain read "10 mana" over a key that
 * spends twenty-two. The same trap is waiting for any new screen, so this
 * casts the spell for real and compares three figures that must agree:
 *
 * 1. what `slotCost` says the slot costs,
 * 2. what the mana bar actually loses on the cast,
 * 3. what `slotStatParts` — the line every panel draws — prints.
 *
 * It is the mana half of `card-damage.test.ts`, and for the same reason: a
 * cost the player only meets at the bar is a cost they were not offered.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step } from "../sim/world.ts";
import { runStaff, slotCost } from "../sim/spells.ts";
import { plainInstance, ITEMS } from "../spells/index.ts";
import { attachAffix, withLevel } from "../sim/spells.ts";
import { affixCostMult, COUNT_AFFIXES, SPELL_AFFIXES, affixFitsSpell, affixSurchargePct, AFFIX_SURCHARGE } from "../spells/affixes.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { RngSource } from "../rng.ts";
import { GRID_H, GRID_W, Tile } from "../types.ts";
import { NO_INPUT, STEP_MS } from "../sim/types.ts";
import { slotStatParts } from "./offer.ts";

const src = new RngSource("card-mana");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "standard", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("r"), { plain: true },
);
const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
const grid = built.grid.slice();
for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
const room = { ...built, grid };

/**
 * Casts the spell once with these affixes on it and returns what the bar lost,
 * beside what the slot claims to cost and what the panel prints.
 */
function cast(id: string, affixes: readonly [string, number][], level: number): {
  spent: number; claimed: number; printed: string;
} {
  const w = createWorld({
    room, encounter: null, props: 0, staff: runStaff(),
    slots: [plainInstance(id), null, null], hearts: 999, rng: src.stream("w", id, level, affixes.join()),
    invincible: true,
  });
  let slot = w.spells[0]!;
  for (const [a] of affixes) slot = attachAffix(slot, a) ?? slot;
  if (level > 1) slot = withLevel(slot, level);
  w.spells[0] = slot;
  const claimed = slotCost(slot, ITEMS, w.staff);
  // A full bar, so a cast is never refused for want of mana.
  w.player.mana = w.staff.mana_max;
  const before = w.player.mana;
  let spent = 0;
  for (let t = 0; t < 2000; t += STEP_MS) {
    step(w, { ...NO_INPUT, aimX: w.player.x + 200, aimY: w.player.y, spell: t === 0 ? 0 : -1 });
    if (w.player.mana < before) { spent = before - w.player.mana; break; }
  }
  const def = ITEMS.get(id)!;
  const mana = slotStatParts(def, level, claimed).find((p) => p.tone === "mana");
  return { spent, claimed, printed: mana?.text ?? "" };
}

describe("the mana a panel prints (doc 013)", () => {
  /**
   * A maxed shock arc with fork and repeat, the two affixes that still pay
   * (`chain` went free: see `COUNT_AFFIXES`), each its one surcharge,
   * multiplied. The surcharge is the whole point of the card, so it is
   * pinned as a number rather than left to drift.
   */
  it("charges a stacked count build each surcharge, multiplied", () => {
    const bare = cast("shock_arc", [], 5);
    const stacked = cast("shock_arc", [["fork", 1], ["repeat", 1]], 5);
    expect(stacked.claimed / bare.claimed).toBeCloseTo((1 + AFFIX_SURCHARGE) ** 2, 1);
  });

  it("prints what the bar loses, with affixes attached", () => {
    const cases: readonly (readonly [string, [string, number][], number])[] = [
      ["magic_bolt", [], 1],
      ["magic_bolt", [["fork", 3]], 1],
      ["magic_bolt", [["fork", 3], ["chain", 3]], 5],
      ["magic_bolt", [["seek", 3]], 3],
      ["shock_arc", [["repeat", 2], ["pierce", 3]], 4],
      ["frost_needle", [["scatter", 3]], 5],
    ];
    for (const [id, affixes, level] of cases) {
      const r = cast(id, affixes, level);
      const what = `${id} lv${level} ${affixes.map((a) => a.join("")).join("+") || "bare"}`;
      expect(r.spent, what).toBeGreaterThan(0);
      expect(r.spent, what).toBeCloseTo(r.claimed, 5);
      // And the line the panel draws quotes that same figure.
      expect(r.printed, what).toContain(String(Math.round(r.claimed * 10) / 10));
    }
  });

  /**
   * The rule itself, rather than one spell's arithmetic: the affixes that
   * multiply how often a press lands pay, and the ones that only change a
   * shot's path do not. `seek` in particular — its surcharge was removed on
   * purpose, and putting it back makes every spell it is meant to rescue
   * worse.
   */
  it("charges the count affixes and nothing else", () => {
    for (const a of SPELL_AFFIXES) {
      const mult = affixCostMult(a.id);
      if (COUNT_AFFIXES.includes(a.id)) {
        expect(mult, a.id).toBeCloseTo(1 + AFFIX_SURCHARGE, 10);
        expect(affixSurchargePct(a.id), a.id).toBe(Math.round(AFFIX_SURCHARGE * 100));
      } else {
        expect(mult, a.id).toBe(1);
        expect(affixSurchargePct(a.id), a.id).toBeNull();
      }
    }
    expect(affixCostMult("seek")).toBe(1);
  });

  /** Every count affix has at least one spell it can actually go on. */
  it("leaves every charging affix attachable", () => {
    for (const id of COUNT_AFFIXES) {
      const a = SPELL_AFFIXES.find((x) => x.id === id)!;
      const fits = [...ITEMS.values()].filter((i) => affixFitsSpell(a, i, []));
      expect(fits.length, id).toBeGreaterThan(0);
    }
  });
});
