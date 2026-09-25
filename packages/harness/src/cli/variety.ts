/**
 * How alike the generated rooms are (doc 004, "Variety").
 *
 * For each archetype and symmetry, a batch of rooms from different seeds, and
 * two numbers per batch:
 *
 * - **obstacle overlap**: the mean Jaccard index of the obstacle cells the
 *   generator added, over every pair. 1 is the same layout every time.
 * - **tile sameness**: the mean share of interior cells that hold the same
 *   tile in both rooms of a pair — what the eye compares, since the outline
 *   counts too.
 * - **outlines**: how many distinct skeletons the batch was built in.
 *
 * Run with `pnpm variety [rooms per batch]`.
 */
import { GRID_H, GRID_W, RngSource, SPACE_ARCHETYPES, Tile, generateRoom } from "@jr/core";

const N = Number(process.argv[2] ?? 24);
const mood = { temperature: "cold", brightness: "dim", particle_intensity: "calm" } as const;

function obstacleCells(grid: Uint8Array, mask: Uint8Array): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < grid.length; i++) if (mask[i] === Tile.Floor && grid[i] !== Tile.Floor && grid[i] !== Tile.Door) out.add(i);
  return out;
}

function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
}

function sameness(a: Uint8Array, b: Uint8Array): number {
  let same = 0;
  let n = 0;
  for (let y = 1; y < GRID_H - 1; y++)
    for (let x = 1; x < GRID_W - 1; x++) {
      const i = y * GRID_W + x;
      n++;
      if ((a[i] === Tile.Floor) === (b[i] === Tile.Floor)) same++;
    }
  return same / n;
}

const rows: [string, number, number, number, number][] = [];
for (const a of SPACE_ARCHETYPES.filter((x) => x.boss !== true)) {
  for (const symmetry of ["mirrored", "asymmetric"] as const) {
    const rooms = Array.from({ length: N }, (_, s) =>
      generateRoom({ space: a.id, symmetry, size: "standard", mood }, "S", "combat", new RngSource(`variety-${s}`).stream("room")));
    const obs = rooms.map((r) => obstacleCells(r.grid, r.mask));
    let jac = 0;
    let same = 0;
    let pairs = 0;
    for (let i = 0; i < N; i++)
      for (let j = i + 1; j < N; j++) {
        jac += jaccard(obs[i]!, obs[j]!);
        same += sameness(rooms[i]!.grid, rooms[j]!.grid);
        pairs++;
      }
    const distinct = new Set(rooms.map((r) => Array.from(r.grid).join(""))).size;
    const outlines = new Set(rooms.map((r) => r.skeleton)).size;
    rows.push([`${a.id}/${symmetry}`, jac / pairs, same / pairs, distinct, outlines]);
  }
}
const pad = (s: string, n: number) => s.padEnd(n);
console.log(`${pad("archetype", 30)} overlap  sameness  distinct/${N}  outlines`);
for (const [name, j, s, d, o] of rows)
  console.log(`${pad(name, 30)} ${j.toFixed(2).padStart(7)}  ${s.toFixed(2).padStart(8)}  ${String(d).padStart(11)}  ${String(o).padStart(8)}`);
const mean = (k: 1 | 2) => rows.reduce((t, r) => t + r[k], 0) / rows.length;
console.log(`${pad("mean", 30)} ${mean(1).toFixed(2).padStart(7)}  ${mean(2).toFixed(2).padStart(8)}`);
