import { describe, expect, it } from "vitest";
import { ROOM_EXTENT, ROOM_SIZES } from "../types.ts";
import type { Mood, SpaceArchetype, Symmetry } from "../types.ts";
import { RngSource } from "../rng.ts";
import { BOSS_ARCHETYPES, PLAYABLE_ARCHETYPES, archetypeAt } from "./archetypes.ts";
import { generateRoom, resolveEntry } from "./generate.ts";
import { SKELETONS, skeletonMask, skeletonSymmetric, skeletonsFor } from "./skeletons.ts";
import { validateRoom } from "./validate.ts";

const MOOD: Mood = { temperature: "cold", brightness: "dim", particle_intensity: "calm" };
const SYMMETRIES: readonly Symmetry[] = ["mirrored", "asymmetric"];
const EXTENTS = ROOM_SIZES.map((size) => ({ size, ext: ROOM_EXTENT[size] }));
/** The skeletons an archetype fits at a size. */
const fitsAt = (a: SpaceArchetype, mirrored: boolean, entry: Parameters<typeof resolveEntry>[1], ext: (typeof EXTENTS)[number]["ext"]) =>
  skeletonsFor(archetypeAt(a, ext), mirrored, entry, ext);

describe("room skeletons (doc 004)", () => {
  it("gives every skeleton a room it can hold, and every shape more than one outline", () => {
    for (const { size, ext } of EXTENTS) {
      for (const s of SKELETONS) {
        const used = PLAYABLE_ARCHETYPES.some((a) =>
          SYMMETRIES.some((sym) => fitsAt(a, sym === "mirrored", resolveEntry(a, "S"), ext).includes(s)));
        expect(used, `${s.id} ${size}`).toBe(true);
      }
      for (const a of PLAYABLE_ARCHETYPES)
        expect(fitsAt(a, true, resolveEntry(a, "S"), ext).length, `${a.id} ${size}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("builds every archetype in every skeleton it fits, valid and without falling back", () => {
    for (const a of PLAYABLE_ARCHETYPES)
      for (const sym of SYMMETRIES)
        for (const [k, side] of a.doors.entries()) {
          // Each door at a different size, so the sweep covers all three without tripling.
          const { size, ext } = EXTENTS[k % EXTENTS.length]!;
          const entry = resolveEntry(a, side);
          const fits = fitsAt(a, sym === "mirrored", entry, ext);
          for (const s of fits) {
            const avoid = fits.filter((x) => x !== s).map((x) => x.id);
            let relaxed = 0;
            for (let seed = 0; seed < 8; seed++) {
              const room = generateRoom({ space: a.id, symmetry: sym, size, mood: MOOD }, entry, "combat",
                new RngSource(`sk-${s.id}-${seed}`).stream("room"), { avoid });
              expect(room.layout, `${a.id}/${sym}/${entry}/${size} in ${s.id}`).toBe("generated");
              expect(room.skeleton).toBe(s.id);
              if (room.relaxed) relaxed++;
              const check = validateRoom({
                grid: room.grid, mask: room.mask, archetype: room.effective, entry: room.entry,
                zones: room.zones, spawnGroups: room.spawn_groups, ext: room.extent,
              });
              expect(check.problems, `${a.id}/${sym}/${size} in ${s.id}`).toEqual([]);
            }
            expect(relaxed, `${a.id}/${sym}/${entry}/${size} in ${s.id}`).toBeLessThanOrEqual(2);
          }
        }
  });

  it("builds a mirrored room only in a symmetric outline, and a boss arena only in the plain one", () => {
    for (const { ext } of EXTENTS) {
      for (const a of PLAYABLE_ARCHETYPES)
        for (const s of fitsAt(a, true, resolveEntry(a, "S"), ext)) expect(skeletonSymmetric(s, ext), s.id).toBe(true);
      for (const a of BOSS_ARCHETYPES)
        expect(fitsAt(a, true, resolveEntry(a, "S"), ext).map((s) => s.id)).toEqual([a.shape]);
    }
  });

  it("keeps the outlines in `avoid` out of the draw while another fits", () => {
    const a = PLAYABLE_ARCHETYPES.find((x) => x.id === "open_arena")!;
    const fits = fitsAt(a, true, resolveEntry(a, "S"), ROOM_EXTENT.standard);
    const avoid = fits.slice(0, 2).map((s) => s.id);
    for (let seed = 0; seed < 30; seed++) {
      const room = generateRoom({ space: a.id, symmetry: "mirrored", size: "standard", mood: MOOD }, "S", "combat",
        new RngSource(`avoid-${seed}`).stream("room"), { avoid });
      expect(avoid).not.toContain(room.skeleton);
    }
  });

  it("makes each outline differ from its shape's plain one", () => {
    for (const { size, ext } of EXTENTS)
      for (const s of SKELETONS) {
        if (s.id === s.shape) continue;
        const plain = skeletonMask(SKELETONS.find((x) => x.id === s.shape)!, ext);
        const mask = skeletonMask(s, ext);
        let changed = 0;
        for (let i = 0; i < mask.length; i++) if (mask[i] !== plain[i]) changed++;
        expect(changed, `${s.id} ${size}`).toBeGreaterThanOrEqual(4);
      }
  });
});
