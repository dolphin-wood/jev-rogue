import { describe, expect, it } from "vitest";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";
import { RngSource } from "../rng.ts";
import {
  PORTAL_ENTER_RADIUS, PORTAL_RISE_MS, enteredPortal, placePortals,
  portalInReach, raisePortals, stepPortals, placeReward,
} from "./exits.ts";
import type { PortalSpec, RewardCardKind } from "./exits.ts";

/** An open room with a solid border, which is the shape every archetype has. */
function openRoom(): Uint8Array {
  const grid = new Uint8Array(GRID_W * GRID_H).fill(Tile.Floor);
  for (let x = 0; x < GRID_W; x++) {
    grid[x] = Tile.Wall;
    grid[(GRID_H - 1) * GRID_W + x] = Tile.Wall;
  }
  for (let y = 0; y < GRID_H; y++) {
    grid[y * GRID_W] = Tile.Wall;
    grid[y * GRID_W + GRID_W - 1] = Tile.Wall;
  }
  return grid;
}

const rng = (): ReturnType<RngSource["stream"]> => new RngSource("exits").stream("t");
const entry = { x: TILE_PX * 1.5, y: (GRID_H / 2) * TILE_PX };

/** A portal spec from a reward kind, since the tests are about placement. */
const spec = (reward: RewardCardKind, elite = false): PortalSpec =>
  ({ reward, elite, type: "combat" });
const specs = (...kinds: RewardCardKind[]): PortalSpec[] => kinds.map((k) => spec(k));

describe("portals", () => {
  it("places one per offered type", () => {
    const portals = placePortals(openRoom(), specs("spell", "affix", "stat"), entry, [], rng());
    expect(portals.map((p) => p.reward)).toEqual(["spell", "affix", "stat"]);
  });

  it("keeps them far enough apart that a press is never ambiguous", () => {
    // Two overlapping interact circles would mean the game guesses which
    // portal the key meant, and a wrong guess ends the room.
    const portals = placePortals(openRoom(), specs("spell", "affix", "gold"), entry, [], rng());
    for (let i = 0; i < portals.length; i++)
      for (let j = i + 1; j < portals.length; j++)
        expect(Math.hypot(
          portals[i]!.x - portals[j]!.x, portals[i]!.y - portals[j]!.y,
        )).toBeGreaterThan(PORTAL_ENTER_RADIUS * 2);
  });

  it("keeps clear of the entry", () => {
    for (const side of [entry, { x: TILE_PX * 10, y: TILE_PX * 1.5 }]) {
      const portals = placePortals(openRoom(), specs("spell", "affix"), side, [], rng());
      for (const p of portals)
        expect(Math.hypot(p.x - side.x, p.y - side.y)).toBeGreaterThanOrEqual(TILE_PX * 4);
    }
  });

  it("never stands the reward on a hazard cell", () => {
    // Spikes laid around the centre, where the pedestal looks first.
    const avoid = new Set<number>();
    const cx = Math.round(GRID_W / 2);
    const cy = Math.round(GRID_H / 2);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) avoid.add((cy + dy) * GRID_W + cx + dx);
    const drop = placeReward(openRoom(), "spell", avoid);
    const gx = Math.floor(drop.x / TILE_PX);
    const gy = Math.floor(drop.y / TILE_PX);
    expect(avoid.has(gy * GRID_W + gx)).toBe(false);
    // Still as central as the hazard allows, not flung to a wall.
    expect(Math.hypot(gx - cx, gy - cy)).toBeLessThanOrEqual(4.5);
  });

  it("keeps clear of the spawn groups", () => {
    const spawns = [{ x: TILE_PX * 8.5, y: TILE_PX * 6.5 }];
    const portals = placePortals(openRoom(), specs("spell", "affix"), entry, spawns, rng());
    for (const p of portals)
      expect(Math.hypot(p.x - spawns[0]!.x, p.y - spawns[0]!.y))
        .toBeGreaterThanOrEqual(TILE_PX * 1.5);
  });

  it("stands on floor with floor all round it", () => {
    const grid = openRoom();
    // Pillars, because an empty arena never exercises the candidate filter.
    for (const [x, y] of [[6, 5], [7, 5], [13, 7], [14, 7]] as const)
      grid[y * GRID_W + x] = Tile.Pillar;
    const portals = placePortals(grid, specs("spell", "affix", "gold"), entry, [], rng());
    for (const p of portals) {
      const gx = Math.floor(p.x / TILE_PX);
      const gy = Math.floor(p.y / TILE_PX);
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as const)
        expect(grid[(gy + dy) * GRID_W + gx + dx]).toBe(Tile.Floor);
    }
  });

  it("is not an exit while shut, however long the player stands on it", () => {
    const portals = placePortals(openRoom(), specs("spell"), entry, [], rng());
    const on = { x: portals[0]!.x, y: portals[0]!.y };
    for (let i = 0; i < 200; i++) stepPortals(portals, 16);
    expect(enteredPortal(portals, on, true)).toBeNull();
    expect(portalInReach(portals, on)).toBeNull();
  });

  it("is never entered by walking onto it", () => {
    // The mistouch this guards: the player is at full speed in the seconds
    // after a fight, and a contact trigger would end the room by accident.
    const portals = placePortals(openRoom(), specs("spell", "affix"), entry, [], rng());
    raisePortals(portals);
    stepPortals(portals, PORTAL_RISE_MS + 20);
    const on = { x: portals[0]!.x, y: portals[0]!.y };
    expect(enteredPortal(portals, on)).toBeNull();
    expect(portalInReach(portals, on)?.reward).toBe("spell");
    expect(enteredPortal(portals, on, true)?.reward).toBe("spell");
  });

  it("is not an exit until it has finished rising", () => {
    // A player standing where a portal comes up must not be able to use it
    // before they have seen it arrive.
    const portals = placePortals(openRoom(), specs("spell"), entry, [], rng());
    const on = { x: portals[0]!.x, y: portals[0]!.y };
    raisePortals(portals);
    stepPortals(portals, PORTAL_RISE_MS - 20);
    expect(enteredPortal(portals, on, true)).toBeNull();
    stepPortals(portals, 40);
    expect(enteredPortal(portals, on, true)?.reward).toBe("spell");
  });

  it("offers the nearest when two are somehow in reach at once", () => {
    // Defends the invariant rather than the placement: whatever the layout, a
    // press has exactly one answer.
    const portals = placePortals(openRoom(), specs("spell", "affix"), entry, [], rng());
    portals[0]!.x = 100; portals[0]!.y = 100;
    portals[1]!.x = 110; portals[1]!.y = 100;
    raisePortals(portals);
    stepPortals(portals, PORTAL_RISE_MS + 20);
    expect(portalInReach(portals, { x: 102, y: 100 })?.reward).toBe("spell");
    expect(portalInReach(portals, { x: 108, y: 100 })?.reward).toBe("affix");
  });

  it("raises every portal at once, and only once", () => {
    const portals = placePortals(openRoom(), specs("spell", "stat"), entry, [], rng());
    raisePortals(portals);
    stepPortals(portals, 200);
    const before = portals.map((p) => p.riseMs);
    raisePortals(portals);
    expect(portals.map((p) => p.riseMs)).toEqual(before);
  });

  it("still places every portal in a room with almost no legal floor", () => {
    // A room that produced fewer portals than types offered would silently
    // drop a door the Director chose; one that produced none would end the run.
    const grid = new Uint8Array(GRID_W * GRID_H).fill(Tile.Wall);
    for (let y = 2; y < 6; y++) for (let x = 2; x < 8; x++) grid[y * GRID_W + x] = Tile.Floor;
    const portals = placePortals(
      grid, specs("spell", "affix", "gold"), { x: TILE_PX * 3, y: TILE_PX * 3 }, [], rng(),
    );
    expect(portals).toHaveLength(3);
    expect(new Set(portals.map((p) => `${p.x},${p.y}`)).size).toBe(3);
  });
});
