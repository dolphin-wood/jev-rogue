import { describe, expect, it } from "vitest";
import { GRID_W, GRID_H, Tile } from "../types.ts";
import {
  chokepoints, convexCorners, detourRatio, footholdRatio, geodesic,
  loopCount, widthProfile,
} from "./melee-metrics.ts";

/** A solid grid, so a test can carve exactly the room it means to measure. */
function solid(): Uint8Array {
  return new Uint8Array(GRID_W * GRID_H).fill(Tile.Wall);
}

function carve(grid: Uint8Array, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) grid[y * GRID_W + x] = Tile.Floor;
}

describe("geodesic distance", () => {
  it("counts steps, not diagonals", () => {
    // Bodies move on a four-connected graph, so a diagonal is two steps. A
    // metric that allowed diagonals would understate every approach time.
    const g = solid();
    carve(g, 1, 1, 5, 5);
    const d = geodesic(g, [1, 1]);
    expect(d[1 * GRID_W + 1]).toBe(0);
    expect(d[1 * GRID_W + 4]).toBe(3);
    expect(d[2 * GRID_W + 2]).toBe(2);
  });

  it("reports unreachable as -1 rather than as far away", () => {
    // Two rooms with no door. "Very distant" and "impossible" must not be the
    // same answer, or an unreachable spawn reads as a slow one.
    const g = solid();
    carve(g, 1, 1, 3, 3);
    carve(g, 8, 1, 10, 3);
    const d = geodesic(g, [1, 1]);
    expect(d[1 * GRID_W + 9]).toBe(-1);
  });
});

describe("detour ratio", () => {
  it("is 1 down a straight corridor", () => {
    const g = solid();
    carve(g, 1, 5, 15, 5);
    expect(detourRatio(g, [1, 5], [[15, 5]])).toBeCloseTo(1, 2);
  });

  it("rises when the route bends around a wall", () => {
    /*
     * The number doc 013 got backwards. An L-shaped route to a spawn that is
     * close in a straight line is exactly the mazing that fights a swing, and
     * this is the measurement that says so.
     */
    const g = solid();
    carve(g, 1, 1, 1, 9);
    carve(g, 1, 9, 9, 9);
    const straightish = detourRatio(g, [1, 1], [[1, 9]]);
    const bent = detourRatio(g, [1, 1], [[9, 9]]);
    expect(straightish).toBeCloseTo(1, 2);
    expect(bent).toBeGreaterThan(1.4);
  });
});

describe("width profile", () => {
  it("calls a corridor tight and an arena open", () => {
    const corridor = solid();
    carve(corridor, 1, 6, 19, 6);
    expect(widthProfile(corridor).tight).toBe(1);

    const arena = solid();
    carve(arena, 1, 1, 19, 11);
    expect(widthProfile(arena).open).toBeGreaterThan(0.3);
  });
});

describe("footholds", () => {
  it("finds none in the middle of open floor", () => {
    // Every interior tile of a wide room has four approaches, which is the
    // always-surrounded room doc 015 warns about.
    const g = solid();
    carve(g, 1, 1, 19, 11);
    const interior = footholdRatio(g);
    // Only the rim qualifies, so the ratio is the perimeter's share.
    expect(interior).toBeLessThan(0.55);
  });

  it("finds every tile of a corridor", () => {
    const g = solid();
    carve(g, 1, 6, 19, 6);
    expect(footholdRatio(g)).toBe(1);
  });
});

describe("convex corners", () => {
  it("counts four for a free-standing pillar and none for a bare room", () => {
    /*
     * The distinction `pillar_count` could not make: a pillar and an alcove
     * can give the same count while affording completely different play.
     */
    const bare = solid();
    carve(bare, 1, 1, 19, 11);
    expect(convexCorners(bare)).toBe(0);

    const pillar = solid();
    carve(pillar, 1, 1, 19, 11);
    pillar[6 * GRID_W + 10] = Tile.Wall;
    expect(convexCorners(pillar)).toBe(4);
  });
});

describe("chokepoints and loops", () => {
  it("finds the one tile joining two halves", () => {
    const g = solid();
    carve(g, 1, 1, 8, 11);
    carve(g, 12, 1, 19, 11);
    carve(g, 9, 6, 11, 6);
    /*
     * Five, not three. The corridor is three tiles, and the two floor tiles
     * either side of it are chokepoints too — each is the sole route from its
     * half into the corridor. The first expectation here was 3, and being
     * wrong about it is the reason this test is worth having: a chokepoint is
     * a property of the graph, not of what looks like a corridor.
     */
    expect(chokepoints(g)).toBe(5);
  });

  it("finds none in an open room, which should be the common case", () => {
    const g = solid();
    carve(g, 1, 1, 19, 11);
    expect(chokepoints(g)).toBe(0);
  });

  it("counts obstacles the player can circle, not cycles in the graph", () => {
    /*
     * The literal reading of "loop count" — `edges - vertices + 1` over the
     * walkable graph — was written first and measured area: every 2x2 patch of
     * floor is a cycle, so this two-tile-wide ring scored 33 and an empty
     * arena scored in the hundreds. What the metric is for is whether the
     * player can put something between themselves and a chaser.
     */
    const corridor = solid();
    carve(corridor, 1, 6, 19, 6);
    expect(loopCount(corridor)).toBe(0);

    const arena = solid();
    carve(arena, 1, 1, 19, 11);
    expect(loopCount(arena)).toBe(0);

    const ring = solid();
    carve(ring, 3, 3, 15, 9);
    for (let y = 5; y <= 7; y++) for (let x = 5; x <= 13; x++) ring[y * GRID_W + x] = Tile.Wall;
    expect(loopCount(ring)).toBe(1);

    const twoPillars = solid();
    carve(twoPillars, 1, 1, 19, 11);
    twoPillars[5 * GRID_W + 6] = Tile.Wall;
    twoPillars[7 * GRID_W + 14] = Tile.Wall;
    expect(loopCount(twoPillars)).toBe(2);
  });
});
