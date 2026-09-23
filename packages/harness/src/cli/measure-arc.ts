/**
 * Does a 1.8-tile arc read as two different weapons depending on the room?
 *
 * Doc 013's first open question, and the one it says can only be answered by
 * measurement. **Arc yield** is doc 015's proposed metric: for every position
 * and facing a player could swing from, how much reachable floor falls inside
 * the sector. Where a wall or corner backs the player the yield rises, because
 * the bodies that can reach them are compressed into the arc.
 *
 * If corridors yield markedly more than arenas, the arc is two weapons and the
 * reach is right. If every archetype yields the same, it is one weapon and the
 * reach is doing nothing, which would be a reason to change it before 195
 * frames of art are drawn against it.
 */
import { generateRoom, toRoomPlan, PLAYABLE_ARCHETYPES, RngSource } from "@jr/core";
import { GRID_W, GRID_H, TILE_PX, Tile } from "@jr/core";
import { ARC_DEG, ARC_REACH, makeSwingBox, sectorHits } from "@jr/core";

const SEEDS = Number(process.argv[2] ?? 4);
const src = new RngSource("arc");
const HALF = ((ARC_DEG / 2) * Math.PI) / 180;
const FACINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
/** A body the arc might catch: the smallest enemy radius in the roster. */
const BODY_R = 9;

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}

console.log(`arc ${ARC_DEG} degrees, reach ${ARC_REACH.toFixed(0)}px (${(ARC_REACH / TILE_PX).toFixed(1)} tiles), body radius ${BODY_R}`);
console.log("archetype            mean  p90  max   backed%");
const rows: { id: string; mean: number; p90: number; max: number; backed: number }[] = [];

for (const a of PLAYABLE_ARCHETYPES) {
  const yields: number[] = [];
  let backed = 0, positions = 0;

  for (let s = 0; s < SEEDS; s++) {
    const g = generateRoom(
      { space: a.id, symmetry: "mirrored", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
      "S", "combat", src.stream("r", a.id, String(s)),
    );
    const r = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
    const solid = (tx: number, ty: number): boolean => {
      if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return true;
      const t = r.grid[ty * GRID_W + tx];
      return t !== Tile.Floor;
    };

    for (let ty = 1; ty < GRID_H - 1; ty++) {
      for (let tx = 1; tx < GRID_W - 1; tx++) {
        if (solid(tx, ty)) continue;
        const px = (tx + 0.5) * TILE_PX;
        const py = (ty + 0.5) * TILE_PX;
        positions++;
        // A foothold: three or fewer of the eight neighbours are open.
        let open = 0;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]])
          if (!solid(tx + dx!, ty + dy!)) open++;
        if (open <= 5) backed++;

        let best = 0;
        for (const facing of FACINGS) {
          const box = makeSwingBox();
          box.x = px; box.y = py; box.facing = facing;
          box.halfArc = HALF; box.reach = ARC_REACH;
          let n = 0;
          // Count the floor cells a body could stand in and be caught.
          const span = Math.ceil(ARC_REACH / TILE_PX) + 1;
          for (let oy = -span; oy <= span; oy++)
            for (let ox = -span; ox <= span; ox++) {
              const cx = tx + ox, cy = ty + oy;
              if (solid(cx, cy)) continue;
              if (ox === 0 && oy === 0) continue;
              if (sectorHits(box, { x: (cx + 0.5) * TILE_PX, y: (cy + 0.5) * TILE_PX }, BODY_R)) n++;
            }
          if (n > best) best = n;
        }
        yields.push(best);
      }
    }
  }
  const mean = yields.reduce((s, v) => s + v, 0) / Math.max(1, yields.length);
  const row = { id: a.id, mean, p90: pct(yields, 0.9), max: Math.max(...yields), backed: (backed / Math.max(1, positions)) * 100 };
  rows.push(row);
  console.log(
    row.id.padEnd(20) + mean.toFixed(1).padStart(5) + String(row.p90).padStart(5) +
    String(row.max).padStart(5) + row.backed.toFixed(0).padStart(9),
  );
}

const byMean = [...rows].sort((x, y) => y.mean - x.mean);
const spread = byMean[0]!.mean / byMean[byMean.length - 1]!.mean;
console.log(`\nspread between the most and least generous archetype: ${spread.toFixed(2)}x`);
console.log(`most generous: ${byMean[0]!.id}   least: ${byMean[byMean.length - 1]!.id}`);
console.log(spread >= 1.5
  ? "The arc is two different weapons depending on the room."
  : "The arc is one weapon everywhere; the room is not changing its value.");

/* ---------------------------------------------------------------------------
 * The same question, asked of the simulation instead of the geometry.
 *
 * Floor area inside the arc turned out not to vary by room, because at 1.8
 * tiles the arc never reaches a wall. But the mechanism by which a corridor
 * would make a wide swing better is not floor area: it is that a corridor
 * compresses *approaching bodies* into a line. That is a pathing effect, so it
 * has to be measured by letting enemies actually path in.
 * ------------------------------------------------------------------------- */

const { createWorld, step, makeEnemy, staffFor, plainInstance, NO_INPUT } = await import("@jr/core");

console.log("\nenemies caught per connecting swing, four chasers pathing in:");
console.log("archetype            hits/swing  swings  total");

for (const a of PLAYABLE_ARCHETYPES) {
  let hits = 0, swings = 0;
  for (let s = 0; s < SEEDS; s++) {
    const g = generateRoom(
      { space: a.id, symmetry: "mirrored", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
      "S", "combat", src.stream("sim", a.id, String(s)),
    );
    const room = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
    const w = createWorld({
      room, encounter: null,
      staff: staffFor({ slots: "many", mana: "high", tempo: "steady", special: "none" }),
      slots: [plainInstance("magic_bolt"), null, null, null, null, null],
      hearts: 999, rng: src.stream("w", a.id, String(s)),
    });
    // The four open floor cells furthest from the player. Placing at the
    // literal corners put bodies inside walls in every corridor archetype,
    // where they could never move and the count read as zero.
    const open: { tx: number; ty: number; d: number }[] = [];
    for (let ty = 1; ty < GRID_H - 1; ty++)
      for (let tx = 1; tx < GRID_W - 1; tx++) {
        if (room.grid[ty * GRID_W + tx] !== Tile.Floor) continue;
        const dx = (tx + 0.5) * TILE_PX - w.player.x;
        const dy = (ty + 0.5) * TILE_PX - w.player.y;
        open.push({ tx, ty, d: dx * dx + dy * dy });
      }
    open.sort((x, y) => y.d - x.d);
    const spots = open.slice(0, 4);
    if (spots.length < 4) { console.log(`${a.id}: only ${spots.length} open cells`); continue; }
    spots.forEach(({ tx, ty }, i) => {
      const e = makeEnemy(i + 1, "rusher", (tx + 0.5) * TILE_PX, (ty + 0.5) * TILE_PX, []);
      e.spawnFadeMs = 0;
      e.awake = true;
      e.hp = 1e9;
      e.maxHp = 1e9;
      w.enemies.push(e);
    });

    // Swing on a fixed cadence for twenty seconds and count what connects.
    for (let i = 0; i < 60 * 20; i++) {
      const doSwing = i % 24 === 0;
      if (doSwing) swings++;
      const before = w.stats.damageDealt;
      step(w, { ...NO_INPUT, swing: doSwing });
      const dealt = w.stats.damageDealt - before;
      if (dealt > 0) hits += Math.round(dealt / 9);
    }
  }
  console.log(
    a.id.padEnd(20) + (hits / Math.max(1, swings)).toFixed(2).padStart(10) +
    String(swings).padStart(8) + String(hits).padStart(7),
  );
}
