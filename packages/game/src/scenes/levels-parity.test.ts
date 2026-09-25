/**
 * **The harness and the game level the same way** — the standing rule that a
 * measured run and a played run must build the world from the same facts.
 *
 * Experience is carried by the *run*, not by the world: the world is thrown
 * away at every portal, so each caller has to hand the total in and take it
 * back out. That is two lines each, in two packages, and forgetting either of
 * them fails silently — a browser run would simply stay at level 1 while every
 * number the harness printed said level 7. Exactly the shape of the bug
 * `room-index.test.ts` was written for, so it is pinned the same way: by
 * reading both sources and asserting the four lines exist.
 *
 * The behaviour itself lives in `core/run/levels.ts` and is tested there; what
 * cannot be tested there is that both callers actually call it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const scene = readFileSync(new URL("./play.ts", import.meta.url), "utf8");
const harness = readFileSync(
  new URL("../../../harness/src/play/run.ts", import.meta.url), "utf8",
);

describe("experience crosses the portal in both callers", () => {
  it("is handed to the world the game builds", () => {
    const call = scene.indexOf("this.world = createWorld({");
    expect(call).toBeGreaterThan(0);
    const body = scene.slice(call, scene.indexOf("});", call));
    expect(body).toMatch(/\bxp:\s*this\.runXp\b/);
  });

  it("is handed to the world the harness builds", () => {
    const call = harness.indexOf("const world = createWorld({");
    expect(call).toBeGreaterThan(0);
    const body = harness.slice(call, harness.indexOf("});", call));
    expect(body).toMatch(/\bxp\b/);
  });

  it("is taken back off the world when the room ends, in both", () => {
    expect(scene).toMatch(/this\.runXp\s*=\s*this\.world\.xp\b/);
    expect(harness).toMatch(/\bxp\s*=\s*world\.xp\b/);
  });

  it("never rebuilds the player's modifiers without the level", () => {
    /*
     * **The bug that was reported: "at level 4 the sword still hits 9".**
     *
     * The scene rebuilds `player.mods` when a stat card is taken, and it did
     * it from `withLevels(this.mods, levelAt(this.runXp).level)` — but
     * `runXp` is the run's *carried* total and is only refreshed at the
     * portal, so a card taken after the fight rebuilt the body at the level
     * the room started on and dropped everything that room had paid for. The
     * sword went back to 9 and stayed there.
     *
     * Two things keep it fixed: `liveMods` reads the live world's level, and
     * the scene keeps `runXp` in step as the world pays it. Both are asserted,
     * and every assignment to `player.mods` in the scene has to go through
     * `liveMods`.
     */
    expect(scene).toMatch(/private liveMods\(\): PlayerMods \{\s*\n\s*return withLevels\(this\.mods, this\.world\?\.level/);
    expect(scene).toMatch(/this\.runXp = this\.world\.xp;\n\s*\}\n/);
    const assignments = [...scene.matchAll(/player\.mods = (.+);/g)].map((m) => m[1]);
    expect(assignments.length).toBeGreaterThan(0);
    for (const rhs of assignments) expect(rhs, rhs).toBe("this.liveMods()");
  });

  it("is never combined with the stat cards before it is handed in", () => {
    /*
     * `createWorld` folds the level into the body itself (`withLevels`), so
     * what both callers pass as `mods` is the **card half alone**. Passing an
     * already-levelled set would apply the level twice, and the symptom — the
     * player's damage creeping up every time a room was rebuilt — is the kind
     * that is noticed late and diagnosed slowly.
     */
    expect(scene).toMatch(/mods:\s*this\.mods,/);
    expect(harness).toMatch(/rng: src\.stream\("gameplay", index\), mods, rage, xp,/);
  });
});
