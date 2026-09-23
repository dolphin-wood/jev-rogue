import { describe, expect, it } from "vitest";
import { placeProps } from "./props.ts";
import { GRID_W, GRID_H, Tile } from "../types.ts";
import { RngSource } from "../rng.ts";

describe("placeProps keeps the floor one region", () => {
  it("never stands a prop on a cut vertex, even one with floor on every side", () => {
    // Two halls joined only through (10,6). The cells above and below it are
    // dead-end pockets, so (10,6) has floor on all four sides and is still
    // the only way across.
    const grid = new Uint8Array(GRID_W * GRID_H).fill(Tile.Wall);
    const floor = (x: number, y: number) => { grid[y * GRID_W + x] = Tile.Floor; };
    for (let y = 2; y <= 10; y++) for (let x = 2; x <= 8; x++) floor(x, y);
    for (let y = 2; y <= 10; y++) for (let x = 12; x <= 18; x++) floor(x, y);
    floor(9, 6); floor(10, 6); floor(11, 6);
    floor(10, 5); floor(10, 7);
    // Also make (9,6)/(11,6) not eligible so only (10,6) is the tempting cell.
    for (let k = 0; k < 40; k++) {
      const g = new Uint8Array(grid);
      const props = placeProps(g, new RngSource(`cut-${k}`).stream("props"), [], 12);
      expect(props.some((p) => p.gx === 10 && p.gy === 6)).toBe(false);
      // And the two halls can still reach each other: (2,2) to (18,10).
      let reach = 0;
      const seen = new Uint8Array(g.length); const q = [2 * GRID_W + 2]; seen[q[0]!] = 1;
      while (q.length) { const c = q.pop()!; reach++; const cx = c % GRID_W, cy = (c - cx) / GRID_W;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) { const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue; const ni = ny * GRID_W + nx;
          if (!seen[ni] && g[ni] === Tile.Floor) { seen[ni] = 1; q.push(ni); } } }
      const floorCount = g.reduce((a, v) => a + (v === Tile.Floor ? 1 : 0), 0);
      expect(reach).toBe(floorCount);
    }
  });
});
