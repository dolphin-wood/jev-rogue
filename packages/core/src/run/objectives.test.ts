import { describe, expect, it } from "vitest";
import { OBJECTIVE_CHANCE, OBJECTIVE_FIRST_ROOM, objectiveFor } from "./objectives.ts";
import { RUN_COMBAT_ROOMS, RUN_GUARDIAN_ROOM, audienceRoomFor } from "./doors.ts";

describe("room objectives: where they fall (doc 025)", () => {
  it("fall only in ordinary fights from room 3, never in a fixed fight, and never two rooms running", () => {
    let count = 0, rooms = 0;
    for (let s = 0; s < 200; s++) {
      const seed = `obj-${s}`;
      let last: string | null = null;
      for (let i = 1; i <= RUN_COMBAT_ROOMS + 2; i++) {
        const o = objectiveFor(seed, i, "combat");
        expect(objectiveFor(seed, i, "elite")).toBeNull();
        if (i < OBJECTIVE_FIRST_ROOM || i > RUN_COMBAT_ROOMS || i === RUN_GUARDIAN_ROOM || i === audienceRoomFor(seed)) expect(o).toBeNull();
        if (last) expect(o, `${seed} room ${i}`).toBeNull();
        if (i >= OBJECTIVE_FIRST_ROOM && i <= RUN_COMBAT_ROOMS) { rooms++; if (o) count++; }
        expect(objectiveFor(seed, i, "combat")).toBe(o);
        last = o;
      }
    }
    // A little under the chance: the fixed fights and the no-two-running rule take some.
    expect(count / rooms).toBeGreaterThan(OBJECTIVE_CHANCE * 0.5);
    expect(count / rooms).toBeLessThan(OBJECTIVE_CHANCE);
  });
});
