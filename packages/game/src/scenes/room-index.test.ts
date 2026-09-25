/**
 * The world is told which room of the run it is. Left out, `createWorld`
 * takes room 99, and every room in the browser ran the late run's ramp while
 * the harness — which passes it — measured the early one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("the game's world", () => {
  it("is created with the room's index", () => {
    const src = readFileSync(new URL("./play.ts", import.meta.url), "utf8");
    const call = src.indexOf("this.world = createWorld({");
    expect(call).toBeGreaterThan(0);
    const body = src.slice(call, src.indexOf("});", call));
    expect(body).toMatch(/\broomIndex:\s*index\b/);
  });
});
