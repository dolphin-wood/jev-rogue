import { describe, expect, it } from "vitest";
import { MANIFEST } from "./manifest.ts";
import { checkSilhouette, loadModel, modelFrameNames, modelFrames, modelNames, place, resolvePose, samePixels, silhouetteChange } from "./models.ts";
import { parsePx, writePx } from "./px.ts";

/**
 * How far a pose may move a part off its joint before it is a pose error.
 *
 * It catches a part sent across the frame — a hand a third of a body from its
 * arm — not a stride. It was 6, which is less than a leg's travel in a walk
 * that reads at 1× (doc 016), so it was capping the animation rather than
 * catching a mistake.
 */
const MAX_OFFSET = 10;
/**
 * Largest share of the silhouette that may change between consecutive frames.
 *
 * It catches a frame that teleports. It was 0.14, which a cycle with a real
 * stride passes through on every contact, so it too was holding the roster
 * still; `amplitude.test.ts` now holds the opposite floor and the two
 * together say what a cycle must look like.
 */
const MAX_POP = 0.32;

const cycles = (frames: readonly string[]) => {
  const out = new Map<string, string[]>();
  for (const name of frames) {
    const m = name.match(/^(.*?)(\d+)$/);
    if (!m) continue;
    (out.get(m[1]!) ?? out.set(m[1]!, []).get(m[1]!)!)[Number(m[2])] = name;
  }
  return [...out.values()].filter((c) => c.length > 1);
};

describe("the .px format", () => {
  it("reads back what it writes", () => {
    const text = [
      "legend outline:k cloth:abc",
      "",
      "part arm.down pivot 1,0",
      "joint hand 1,3",
      ".ab",
      "abc",
      "kc",
      ".k",
      "",
    ].join("\n");
    const px = parsePx(text);
    const again = parsePx(writePx(px.legend, px.parts));
    expect(again.parts).toEqual(px.parts);
    expect(px.parts[0]!.joints.hand).toEqual([1, 3]);
    expect(px.parts[0]!.px[5]).toEqual({ material: "cloth", shade: 2 });
  });
});

for (const name of modelNames()) {
  describe(`sprite model: ${name}`, () => {
    const model = loadModel(name);
    const frames = modelFrames(model);

    it("delivers only frames the manifest lists", () => {
      const listed = new Set(MANIFEST.map((f) => f.name));
      expect([...frames.keys()].filter((f) => !listed.has(f))).toEqual([]);
    });

    it("keeps every part on its joint, within reach", () => {
      for (const facing of model.anims.facings)
        for (const [pose, p] of Object.entries(model.poses[facing]))
          for (const [part, v] of Object.entries(p.parts ?? {})) {
            const at = v && typeof v === "object" ? v.at : undefined;
            if (at) expect(Math.max(Math.abs(at[0]), Math.abs(at[1])), `${facing}/${pose} ${part}`).toBeLessThanOrEqual(MAX_OFFSET);
          }
    });

    it("composes every frame as one silhouette", () => {
      for (const [frame, f] of frames) expect(checkSilhouette(f.composed, model.rig.detached ?? []), frame).toEqual([]);
    });

    it("never lifts every foot at once", () => {
      // A pose lifts a foot by moving it up from where its drawing stands. A
      // key drawn from a delivered frame stands where it was drawn.
      const feet = model.rig.feet ?? [];
      for (const [frame, f] of frames) {
        if (!feet.length || model.poses[f.facing][f.pose]?.between) continue;
        const r = resolvePose(model, f.facing, f.pose);
        const shown = feet.filter((foot) => r.get(foot)?.v);
        if (shown.length) expect(shown.some((foot) => (r.get(foot)!.at?.[1] ?? 0) >= 0), `${frame}: every foot is lifted`).toBe(true);
      }
    });

    it("draws every frame of a cycle, and none that pops", () => {
      // A cycle, not a two-drawing recoil: a hurt is meant to jump.
      for (const cycle of cycles([...frames.keys()]).filter((c) => c.length > 2)) {
        for (let i = 0; i < cycle.length; i++) {
          const a = frames.get(cycle[i]!)!.composed;
          const b = frames.get(cycle[(i + 1) % cycle.length]!)!.composed;
          if (cycle[0]!.includes("idle")) continue;
          expect(samePixels(a, b), `${cycle[i]} and the next are the same drawing`).toBe(false);
          expect(silhouetteChange(a, b), `${cycle[i]} to the next`).toBeLessThanOrEqual(MAX_POP);
        }
      }
    });

    /**
     * An anchor the game hangs a drawn thing on has to be **on** the thing.
     *
     * The magic blade grows out of the player's staff head, which the model
     * reports as the `crystal` anchor. A mirrored staff drawing whose rows
     * had been padded with spaces instead of transparent pixels came back
     * from the parser sheared — every short row shifted left by however many
     * spaces it had — so the drawing moved and the joint did not, and the
     * blade grew out of empty air seven to fourteen pixels from the staff.
     * Nothing caught it: the anchor existed, the silhouette was whole, and
     * the frame composed. What was wrong was that the anchor no longer sat on
     * any crystal.
     *
     * So every anchor that names a material is checked against it: within
     * two pixels of a pixel of that material, in every frame that carries the
     * anchor at all.
     */
    it("puts every anchor on the thing it names", () => {
      const MATERIAL: Record<string, string> = { crystal: "gem" };
      for (const [anchor, material] of Object.entries(MATERIAL)) {
        if (!(anchor in model.rig.anchors)) continue;
        for (const [frame, f] of frames) {
          const at = f.composed.anchors[anchor];
          if (!Array.isArray(at)) continue;
          let best = Infinity;
          f.composed.px.forEach((px, i) => {
            if (px?.material !== material) return;
            best = Math.min(best, Math.hypot((i % f.composed.w) - at[0], ((i / f.composed.w) | 0) - at[1]));
          });
          expect(best, `${frame}: the ${anchor} anchor is ${best.toFixed(1)} px from any ${material} pixel`)
            .toBeLessThanOrEqual(2);
        }
      }
    });

    /**
     * The staff is the renderer's in **every** state, so no pose may carry
     * one of its own.
     *
     * Two staffs were drawn at once for a while: the frame's baked one
     * hanging from the hand, and the rotated sprite over it. It was fixed
     * first for the swing keys only, which left the real fault in place — the
     * idle, the walk and the cast still composed one, so entering a swing
     * swapped one staff for another at a different grip and a different
     * depth. Now the part is out of the rig and out of every pose, and the
     * trap this still guards is that a pose can be an in-between, which used
     * to ignore what the pose asked for and take the nearer pose's drawings
     * whole (`place`). Every pose, every facing.
     */
    it("draws no staff in any pose, since the renderer places its own", () => {
      if (name !== "player") return;
      for (const facing of model.anims.facings)
        for (const pose of Object.keys(model.poses[facing] ?? {})) {
          const parts = place(model, facing, pose).map((p) => p.part);
          expect(parts, `${facing}/${pose} still draws a staff`).not.toContain("staff");
          // The fist overlay is painted by the renderer over the shaft, never
          // composed into the body, where it would sit under the staff.
          expect(parts, `${facing}/${pose} bakes in the fist overlay`).not.toContain("fist_overlay");
        }
    });

    /**
     * Whatever the renderer places needs a number per frame to place it by,
     * and those numbers come from the model rather than a table in the scene.
     */
    it("says how to hold the staff in every frame it delivers", () => {
      if (name !== "player") return;
      for (const [frame, f] of frames)
        for (const key of ["staffAngleDeg", "staffGripPx", "staffDepth"])
          expect(typeof f.composed.anchors[key], `${frame} carries no ${key}`).toBe("number");
    });

    it("gives the game its anchors on every frame", () => {
      const optional = new Set(model.rig.optionalAnchors ?? []);
      for (const anchor of Object.keys(model.rig.anchors).filter((a) => !optional.has(a)))
        for (const [frame, f] of frames) expect(f.composed.anchors[anchor], `${frame} ${anchor}`).toBeDefined();
    });
  });
}

describe("modelFrameNames", () => {
  it("names exactly the frames modelFrames composes", () => {
    // The asset checker reads the names alone; they must not drift from the frames.
    for (const n of modelNames()) {
      const model = loadModel(n);
      expect(modelFrameNames(model), n).toEqual([...modelFrames(model).keys()]);
    }
  });
});
