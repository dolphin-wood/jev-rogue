/**
 * Room geometry, measured. Produces the table in `docs/planning/015`.
 *
 * The generator optimises `open_ratio` and `pillar_count`, which are cover
 * metrics: they describe what blocks a bullet. A melee fight cares about other
 * properties, chiefly how wide the space is relative to the swing's reach and
 * whether anywhere in it constrains where enemies may stand. This prints both
 * so the gap between them is visible rather than argued about.
 */
import { generateRoom, toRoomPlan, PLAYABLE_ARCHETYPES, RngSource } from "@jr/core";
import { GRID_W, GRID_H, Tile } from "@jr/core";

const SEEDS = Number(process.argv[2] ?? 4);
const src = new RngSource("measure");

console.log("archetype           open%  pillars  widest  narrow-rows  solid-interior");
for (const a of PLAYABLE_ARCHETYPES) {
  let open = 0, pillars = 0, widest = 0, narrow = 0, interior = 0, n = 0;
  for (let s = 0; s < SEEDS; s++) {
    const g = generateRoom(
      { space: a.id, symmetry: "mirrored", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
      "S", "combat", src.stream("r", a.id, String(s)),
    );
    const r = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
    open += r.measured.open_ratio;
    pillars += r.measured.pillar_count;

    let w = 0;
    for (let y = 1; y < GRID_H - 1; y++) {
      let run = 0, rowMax = 0, rowFloor = 0;
      for (let x = 1; x < GRID_W - 1; x++) {
        const t = r.grid[y * GRID_W + x];
        // Doors are solid to bodies, so they are not part of a clear run.
        if (t === Tile.Floor) { run++; rowFloor++; if (run > rowMax) rowMax = run; }
        else run = 0;
      }
      if (rowMax > w) w = rowMax;
      if (rowFloor > 0 && rowMax <= 3) narrow++;
    }
    widest += w;
    for (let y = 1; y < GRID_H - 1; y++)
      for (let x = 1; x < GRID_W - 1; x++) {
        const t = r.grid[y * GRID_W + x];
        if (t === Tile.Wall || t === Tile.Pillar) interior++;
      }
    n++;
  }
  console.log(
    a.id.padEnd(20) +
    ((open / n) * 100).toFixed(0).padStart(4) +
    (pillars / n).toFixed(1).padStart(9) +
    (widest / n).toFixed(1).padStart(8) +
    (narrow / n).toFixed(1).padStart(13) +
    (interior / n).toFixed(0).padStart(16),
  );
}
console.log("\nInterior is 19x11 = 209 tiles. A widest run of 19 is the full interior width.");
