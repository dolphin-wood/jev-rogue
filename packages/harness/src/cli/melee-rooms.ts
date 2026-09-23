/**
 * Doc 015's room metrics, measured across every archetype.
 *
 * The generator optimises `open_ratio` and `pillar_count` — cover metrics,
 * which describe what blocks a bullet. Doc 015 replaces them for the melee
 * design and this prints its set, so the gap between what is optimised and
 * what matters is visible rather than argued about.
 *
 * Run: `pnpm melee-rooms [seeds]`
 */
import {
  generateRoom, PLAYABLE_ARCHETYPES, RngSource, ENTRY_CELL, measureMelee,
} from "@jr/core";
import type { Cell } from "@jr/core";

const SEEDS = Number(process.argv[2] ?? 8);
const src = new RngSource("melee-rooms");

/** The roster's median speed, in tiles per second, for time-to-contact. */
const TILES_PER_S = 58 / 32;

interface Row {
  id: string;
  detour: number;
  tight: number;
  open: number;
  footholds: number;
  corners: number;
  arc: number;
  chokes: number;
  loops: number;
  first: number;
  last: number;
}

const rows: Row[] = [];
for (const a of PLAYABLE_ARCHETYPES) {
  const acc: Row = {
    id: a.id, detour: 0, tight: 0, open: 0, footholds: 0,
    corners: 0, arc: 0, chokes: 0, loops: 0, first: 0, last: 0,
  };
  let n = 0;
  for (let s = 0; s < SEEDS; s++) {
    const g = generateRoom(
      {
        space: a.id, symmetry: "mirrored",
        mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" },
      },
      "S", "combat", src.stream("r", a.id, String(s)),
    );
    const spawns: Cell[] = g.spawn_groups.flatMap((sg) => [...sg.cells]);
    const m = measureMelee(g.grid, ENTRY_CELL[g.entry], spawns, TILES_PER_S);
    acc.detour += m.detour;
    acc.tight += m.width.tight;
    acc.open += m.width.open;
    acc.footholds += m.footholds;
    acc.corners += m.corners;
    acc.arc += m.arcYield;
    acc.chokes += m.chokepoints;
    acc.loops += m.loops;
    acc.first += m.contactSeconds[0] ?? 0;
    acc.last += m.contactSeconds.at(-1) ?? 0;
    n++;
  }
  for (const k of Object.keys(acc) as (keyof Row)[])
    if (k !== "id") (acc[k] as number) /= n;
  rows.push(acc);
}

console.log(`doc 015 metrics, mean of ${SEEDS} seeds per archetype\n`);
console.log("archetype       detour  tight%  open%  foot%  corners  arc  chokes  loops  contact s");
for (const r of rows)
  console.log(
    `${r.id.padEnd(15)} ${r.detour.toFixed(2).padStart(6)} `
    + `${(r.tight * 100).toFixed(0).padStart(6)} ${(r.open * 100).toFixed(0).padStart(6)} `
    + `${(r.footholds * 100).toFixed(0).padStart(6)} ${r.corners.toFixed(1).padStart(8)} `
    + `${r.arc.toFixed(1).padStart(4)} ${r.chokes.toFixed(1).padStart(7)} `
    + `${r.loops.toFixed(1).padStart(6)}  ${r.first.toFixed(1)} to ${r.last.toFixed(1)}`,
  );

/*
 * The targets are doc 015's, and they are reported rather than asserted
 * because this is a diagnosis, not a gate. Turning them into a gate before
 * knowing how far the current generator is from them would mean tuning the
 * targets to what the generator already does, which is the opposite of the
 * point.
 */
const mean = (f: (r: Row) => number): number => rows.reduce((s, r) => s + f(r), 0) / rows.length;
console.log("\nagainst doc 015's targets:");
const detour = mean((r) => r.detour);
console.log(`  detour ratio      ${detour.toFixed(2)}  target 1.1 to 1.3  `
  + `${detour >= 1.1 && detour <= 1.3 ? "in band" : detour < 1.1 ? "TOO STRAIGHT" : "TOO MAZY"}`);
const chokes = mean((r) => r.chokes);
console.log(`  chokepoints       ${chokes.toFixed(1)}  target 0 to 2, 0 common  `
  + `${chokes <= 2 ? "ok" : "TOO MANY"}`);
const loops = mean((r) => r.loops);
console.log(`  kiting obstacles  ${loops.toFixed(1)}  target: not zero, or a corner is final  `
  + `${loops >= 1 ? "ok" : "NOTHING TO CIRCLE"}`);
const spread = rows.map((r) => r.last - r.first);
const widest = Math.max(...spread);
console.log(`  contact spread    ${Math.min(...spread).toFixed(1)} to ${widest.toFixed(1)} s  `
  + "target: a spread, so an approach order exists to choose");
