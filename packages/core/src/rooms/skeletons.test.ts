import { describe, expect, it } from "vitest";
import type { Mood, Symmetry } from "../types.ts";
import { RngSource } from "../rng.ts";
import { BOSS_ARCHETYPES, PLAYABLE_ARCHETYPES } from "./archetypes.ts";
import { generateRoom, resolveEntry } from "./generate.ts";
import { SKELETONS, skeletonMask, skeletonSymmetric, skeletonsFor } from "./skeletons.ts";
import { validateRoom } from "./validate.ts";

const MOOD: Mood = { temperature: "cold", brightness: "dim", particle_intensity: "calm" };
const SYMMETRIES: readonly Symmetry[] = ["mirrored", "asymmetric"];

describe("room skeletons (doc 004)", () => {
  it("gives every skeleton a room it can hold, and every shape more than one outline", () => {
    for (const s of SKELETONS) {
      const used = PLAYABLE_ARCHETYPES.some((a) =>
        SYMMETRIES.some((sym) => skeletonsFor(a, sym === "mirrored", resolveEntry(a, "S")).includes(s)));
      expect(used, s.id).toBe(true);
    }
    for (const a of PLAYABLE_ARCHETYPES)
      expect(skeletonsFor(a, true, resolveEntry(a, "S")).length, a.id).toBeGreaterThanOrEqual(3);
  });

  it("builds every archetype in every skeleton it fits, valid and without falling back", () => {
    for (const a of PLAYABLE_ARCHETYPES)
      for (const sym of SYMMETRIES)
        for (const side of a.doors) {
          const entry = resolveEntry(a, side);
          const fits = skeletonsFor(a, sym === "mirrored", entry);
          for (const s of fits) {
            const avoid = fits.filter((x) => x !== s).map((x) => x.id);
            let relaxed = 0;
            for (let seed = 0; seed < 4; seed++) {
              const room = generateRoom({ space: a.id, symmetry: sym, mood: MOOD }, entry, "combat",
                new RngSource(`sk-${s.id}-${seed}`).stream("room"), { avoid });
              expect(room.layout, `${a.id}/${sym}/${entry} in ${s.id}`).toBe("generated");
              expect(room.skeleton).toBe(s.id);
              if (room.relaxed) relaxed++;
              const check = validateRoom({
                grid: room.grid, mask: room.mask, archetype: room.effective, entry: room.entry,
                zones: room.zones, spawnGroups: room.spawn_groups,
              });
              expect(check.problems, `${a.id}/${sym} in ${s.id}`).toEqual([]);
            }
            expect(relaxed, `${a.id}/${sym}/${entry} in ${s.id}`).toBeLessThanOrEqual(1);
          }
        }
  });

  it("builds a mirrored room only in a symmetric outline, and a boss arena only in the plain one", () => {
    for (const a of PLAYABLE_ARCHETYPES)
      for (const s of skeletonsFor(a, true, resolveEntry(a, "S"))) expect(skeletonSymmetric(s), s.id).toBe(true);
    for (const a of BOSS_ARCHETYPES)
      expect(skeletonsFor(a, true, resolveEntry(a, "S")).map((s) => s.id)).toEqual([a.shape]);
  });

  it("keeps the outlines in `avoid` out of the draw while another fits", () => {
    const a = PLAYABLE_ARCHETYPES.find((x) => x.id === "open_arena")!;
    const fits = skeletonsFor(a, true, resolveEntry(a, "S"));
    const avoid = fits.slice(0, 2).map((s) => s.id);
    for (let seed = 0; seed < 30; seed++) {
      const room = generateRoom({ space: a.id, symmetry: "mirrored", mood: MOOD }, "S", "combat",
        new RngSource(`avoid-${seed}`).stream("room"), { avoid });
      expect(avoid).not.toContain(room.skeleton);
    }
  });

  it("makes each outline differ from its shape's plain one", () => {
    for (const s of SKELETONS) {
      if (s.id === s.shape) continue;
      const plain = skeletonMask(SKELETONS.find((x) => x.id === s.shape)!);
      const mask = skeletonMask(s);
      let changed = 0;
      for (let i = 0; i < mask.length; i++) if (mask[i] !== plain[i]) changed++;
      expect(changed, s.id).toBeGreaterThanOrEqual(4);
    }
  });
});
