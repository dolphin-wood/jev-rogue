/**
 * Pressure calibration (design doc 005, "Pressure calibration"). The formula's
 * scale and the band edges were set analytically; this measures what the
 * reference player actually loses at each pressure and reports the mapping,
 * so the bands are fitted to play rather than asserted.
 */
import {
  MAX_HEARTS, RngSource, contextFor, createWorld, measurePressure, plainInstance,
  step, worldCleared, STEP_MS, generateRoom, toRoomPlan, PLAYABLE_ARCHETYPES,
} from "@jr/core";
import type { EncounterPlan, EnemyId, RoomPlan } from "@jr/core";
import { referenceInput } from "../play/player-model.ts";

const TIMEOUT_MS = 90_000;
const REPS = 3;
const staff = { slots: 6, mana_max: 120 };
const slots = [plainInstance("magic_bolt"), plainInstance("stone_shard"), null, null, null, null];

function roomFor(i: number): RoomPlan {
  const arch = PLAYABLE_ARCHETYPES[i % PLAYABLE_ARCHETYPES.length]!;
  const src = new RngSource(`cal-room-${i}`);
  const g = generateRoom(
    { space: arch.id, symmetry: "mirrored", size: "standard", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    arch.doors[0]!, "combat", src.stream("r"),
  );
  return toRoomPlan(g, { id: `c${i}`, seed_key: `c${i}`, reward_kind: "item", params_source: "rule" });
}

interface Sample { pressure: number; hearts: number; seconds: number; cleared: boolean; roster: string }
const samples: Sample[] = [];

const MIXES: Record<string, EnemyId[]> = {
  melee: ["rusher", "rusher", "rusher", "orbiter"],
  ranged: ["shooter", "shooter", "turret", "shooter"],
  mixed: ["rusher", "shooter", "orbiter", "turret"],
  heavy: ["tank", "rusher", "shooter", "rusher"],
};

// Rosters are built directly rather than through the band-targeting
// assembler: asking the assembler for a wide band makes it stop at the first
// enemy, which measures nothing.
for (const [mixName, mix] of Object.entries(MIXES)) {
  for (let n = 1; n <= 9; n++) {
    for (let rep = 0; rep < REPS; rep++) {
      const room = roomFor(n * 3 + rep);
      const group = room.spawn_groups[0]!.id;
      const waves = [{
        at_ms: 0,
        spawns: Array.from({ length: n }, (_, i) => ({
          archetype: mix[i % mix.length]!, spawn_group: group, count: 1,
        })),
      }];
      const pressure = measurePressure(waves, contextFor(room, "mixed"));
      const plan: EncounterPlan = {
        profile: { composition: "mixed", density: "normal", wave_structure: "relentless", anchor: "none", entry: "far_front" },
        waves, measured_pressure: pressure, band: [0, 99],
        elite_affixes: [], source: "rule",
      };
      const src = new RngSource(`cal-${mixName}-${n}-${rep}`);
      const w = createWorld({ room, encounter: plan, staff, slots, hearts: MAX_HEARTS, rng: src.stream("g") });
      let ms = 0;
      while (ms < TIMEOUT_MS && w.player.hearts > 0 && !worldCleared(w)) {
        step(w, referenceInput(w));
        ms += STEP_MS;
      }
      samples.push({
        pressure, hearts: w.stats.heartsLost, seconds: ms / 1000,
        cleared: worldCleared(w) && w.player.hearts > 0, roster: `${mixName}x${n}`,
      });
    }
  }
}

samples.sort((a, b) => a.pressure - b.pressure);
const buckets = new Map<number, Sample[]>();
for (const s of samples) {
  const k = Math.floor(s.pressure * 2) / 2;
  buckets.set(k, [...(buckets.get(k) ?? []), s]);
}

console.log(`pressure calibration: ${samples.length} rooms played by the reference player`);
console.log("pressure  rooms  hearts  seconds  cleared");
for (const [k, xs] of [...buckets].sort((a, b) => a[0] - b[0])) {
  const hearts = xs.reduce((a, s) => a + s.hearts, 0) / xs.length;
  const secs = xs.reduce((a, s) => a + s.seconds, 0) / xs.length;
  const cleared = xs.filter((s) => s.cleared).length / xs.length;
  console.log(
    `${k.toFixed(1).padStart(8)}  ${String(xs.length).padStart(5)}  ${hearts.toFixed(2).padStart(6)}  ` +
    `${secs.toFixed(0).padStart(7)}  ${(cleared * 100).toFixed(0).padStart(6)}%`,
  );
}

// Where each band's heart target is crossed.
for (const [band, target] of [["release", 1], ["build", 2], ["peak", 3], ["elite", 4]] as const) {
  const under = samples.filter((s) => s.hearts <= target);
  const edge = under.length ? Math.max(...under.map((s) => s.pressure)) : 0;
  console.log(`${band}: the reference player stays within ${target} hearts up to pressure ${edge.toFixed(2)}`);
}
