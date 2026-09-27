import { describe, expect, it } from "vitest";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";
import { RngSource } from "../rng.ts";
import {
  PORTAL_ENTER_RADIUS, PORTAL_RISE_MS, enteredPortal, portalsBefore,
  portalInReach, raisePortals, stepPortals, placeReward, placeRewardNear,
} from "./exits.ts";
import type { PortalSpec, RewardCardKind } from "./exits.ts";

/** The whole grid as one room. */
const FULL = { w: GRID_W, h: GRID_H };

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
/** The portals as the world makes them: in front of a player standing mid-room, facing east. */
const place = (grid: Uint8Array, s: PortalSpec[]) =>
  portalsBefore(grid, FULL, s, { x: (GRID_W / 2) * TILE_PX, y: (GRID_H / 2) * TILE_PX, facing: 0 });

describe("portals in view", () => {
  it("stand in one straight row across the facing, evenly apart, inside the view", () => {
    const half = { x: 256, y: 144 };
    const player = { x: (GRID_W / 2) * TILE_PX, y: (GRID_H / 2) * TILE_PX, facing: -Math.PI / 2 };
    const portals = portalsBefore(openRoom(), FULL, specs("spell", "affix", "stat"), player, [], new Set(), half);
    // Facing up: a level row, every portal on one line, three tiles apart.
    expect(new Set(portals.map((p) => p.y)).size).toBe(1);
    const xs = portals.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBe(3 * TILE_PX);
    expect(xs[2]! - xs[1]!).toBe(3 * TILE_PX);
    for (const p of portals) {
      expect(Math.abs(p.x - player.x)).toBeLessThanOrEqual(half.x);
      expect(Math.abs(p.y - player.y)).toBeLessThanOrEqual(half.y);
    }
  });
});

describe("portals", () => {
  it("places one per offered type", () => {
    const portals = place(openRoom(), specs("spell", "affix", "stat"));
    expect(portals.map((p) => p.reward)).toEqual(["spell", "affix", "stat"]);
  });

  it("keeps them far enough apart that a press is never ambiguous", () => {
    // Two overlapping interact circles would mean the game guesses which
    // portal the key meant, and a wrong guess ends the room.
    const portals = place(openRoom(), specs("spell", "affix", "gold"));
    for (let i = 0; i < portals.length; i++)
      for (let j = i + 1; j < portals.length; j++)
        expect(Math.hypot(
          portals[i]!.x - portals[j]!.x, portals[i]!.y - portals[j]!.y,
        )).toBeGreaterThan(PORTAL_ENTER_RADIUS * 2);
  });

  it("never stands the reward on a hazard cell", () => {
    // Spikes laid around the centre, where the pedestal looks first.
    const avoid = new Set<number>();
    const cx = Math.round(GRID_W / 2);
    const cy = Math.round(GRID_H / 2);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) avoid.add((cy + dy) * GRID_W + cx + dx);
    const drop = placeReward(openRoom(), FULL, "spell", avoid);
    const gx = Math.floor(drop.x / TILE_PX);
    const gy = Math.floor(drop.y / TILE_PX);
    expect(avoid.has(gy * GRID_W + gx)).toBe(false);
    // Still as central as the hazard allows, not flung to a wall.
    expect(Math.hypot(gx - cx, gy - cy)).toBeLessThanOrEqual(4.5);
  });

  it("stands on floor with floor all round it", () => {
    const grid = openRoom();
    // Pillars, because an empty arena never exercises the candidate filter.
    for (const [x, y] of [[6, 5], [7, 5], [13, 7], [14, 7]] as const)
      grid[y * GRID_W + x] = Tile.Pillar;
    const portals = place(grid, specs("spell", "affix", "gold"));
    for (const p of portals) {
      const gx = Math.floor(p.x / TILE_PX);
      const gy = Math.floor(p.y / TILE_PX);
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as const)
        expect(grid[(gy + dy) * GRID_W + gx + dx]).toBe(Tile.Floor);
    }
  });

  it("is not an exit while shut, however long the player stands on it", () => {
    const portals = place(openRoom(), specs("spell"));
    const on = { x: portals[0]!.x, y: portals[0]!.y };
    for (let i = 0; i < 200; i++) stepPortals(portals, 16);
    expect(enteredPortal(portals, on, true)).toBeNull();
    expect(portalInReach(portals, on)).toBeNull();
  });

  it("is never entered by walking onto it", () => {
    // The mistouch this guards: the player is at full speed in the seconds
    // after a fight, and a contact trigger would end the room by accident.
    const portals = place(openRoom(), specs("spell", "affix"));
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
    const portals = place(openRoom(), specs("spell"));
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
    const portals = place(openRoom(), specs("spell", "affix"));
    portals[0]!.x = 100; portals[0]!.y = 100;
    portals[1]!.x = 110; portals[1]!.y = 100;
    raisePortals(portals);
    stepPortals(portals, PORTAL_RISE_MS + 20);
    expect(portalInReach(portals, { x: 102, y: 100 })?.reward).toBe("spell");
    expect(portalInReach(portals, { x: 108, y: 100 })?.reward).toBe("affix");
  });

  it("raises every portal at once, and only once", () => {
    const portals = place(openRoom(), specs("spell", "stat"));
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
    const portals = place(grid, specs("spell", "affix", "gold"));
    expect(portals).toHaveLength(3);
    expect(new Set(portals.map((p) => `${p.x},${p.y}`)).size).toBe(3);
  });
});

describe("the way out, beside the player", () => {
  const player = { x: TILE_PX * 16.5, y: TILE_PX * 3.5 };

  it("raises the reward a couple of tiles from the player, not in the middle of the room", () => {
    const drop = placeRewardNear(openRoom(), "spell", player);
    const d = Math.hypot(drop.x - player.x, drop.y - player.y);
    expect(d).toBeGreaterThan(TILE_PX * 1.5);
    expect(d).toBeLessThan(TILE_PX * 3.5);
  });

  it("makes the portals in a row in front of the player, apart from each other and the reward", () => {
    const grid = openRoom();
    const drop = placeRewardNear(grid, "spell", player);
    const portals = portalsBefore(grid, FULL, specs("spell", "affix", "stat"), { ...player, facing: Math.PI }, [drop]);
    expect(portals.map((p) => p.reward)).toEqual(["spell", "affix", "stat"]);
    for (const p of portals) {
      // Ahead of a player facing west: to their west, a few tiles out.
      expect(p.x).toBeLessThan(player.x);
      expect(Math.hypot(p.x - player.x, p.y - player.y)).toBeLessThanOrEqual(TILE_PX * 5.5);
      expect(Math.hypot(p.x - drop.x, p.y - drop.y)).toBeGreaterThanOrEqual(TILE_PX * 2);
      expect(p.open).toBe(false);
    }
    for (let i = 0; i < portals.length; i++) for (let j = i + 1; j < portals.length; j++)
      expect(Math.hypot(portals[i]!.x - portals[j]!.x, portals[i]!.y - portals[j]!.y)).toBeGreaterThan(PORTAL_ENTER_RADIUS * 2);
  });
});

describe("the vendors' stop's way out", () => {
  /*
   * Reported from play: the boss door never rose at the pre-boss stop. It had
   * — on the fountain's cell, three tiles ahead of a player facing in from the
   * door, under the fountain's sprite and inside its prompt, so E drank.
   */
  it("opens clear of the stalls whichever way the player faces", async () => {
    const { merchantHall } = await import("../rooms/fixed.ts");
    const { createWorld, step } = await import("./world.ts");
    const { NO_INPUT } = await import("./types.ts");
    const { bossExit } = await import("../run/doors.ts");
    const room = merchantHall();
    // Where the scene stands them (`vendorSpots`): merchant, smith, fountain.
    const cx = Math.floor(room.extent.w / 2), cy = Math.floor(room.extent.h / 2 - 1);
    const stalls = [[-4, 0], [4, 0], [0, 3]].map(([dx, dy]) => ({
      x: (cx + dx! + 0.5) * TILE_PX, y: (cy + dy! + 0.5) * TILE_PX,
    }));
    for (const facing of [-Math.PI / 2, 0, Math.PI, Math.PI / 2]) {
      const w = createWorld({
        room, encounter: null, props: 0, staff: { slots: 6, mana_max: 100 },
        slots: [null, null, null, null, null, null], hearts: 3, rng: rng(),
        offer: { cards: [], doors: bossExit(), coins: 0 },
      });
      w.portalKeepClear = stalls;
      w.player.facing = facing;
      step(w, NO_INPUT, 16);
      expect(w.portals).toHaveLength(1);
      for (const s of stalls)
        expect(Math.hypot(w.portals[0]!.x - s.x, w.portals[0]!.y - s.y)).toBeGreaterThanOrEqual(TILE_PX * 2);
    }
  });
});
