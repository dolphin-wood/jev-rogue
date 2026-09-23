/** Prints the canonical rosters against their bands, for recalibration. */
import { ENEMIES, measurePressure, bandForTier, inBand } from "@jr/core";

const MIX = ["rusher", "shooter", "orbiter", "rusher", "shooter", "turret", "tank"] as const;
const ctx = { open_ratio: 0.6, cover: "none" as const, composition: "mixed" as const };

const pressureOf = (n: number): number =>
  measurePressure(
    [{
      at_ms: 0,
      spawns: MIX.slice(0, n).map((a) => ({ archetype: a, spawn_group: "front_far", count: 1 })),
    }],
    ctx,
  );

console.log("weights:", Object.entries(ENEMIES).map(([k, v]) => `${k}=${v.threat_weight}`).join(" "));
for (const [n, tier] of [[4, "release"], [6, "build"], [7, "peak"]] as const) {
  const p = pressureOf(n);
  const band = bandForTier(tier);
  console.log(`${tier.padEnd(8)} n=${n}  pressure ${p.toFixed(2)}  band ${JSON.stringify(band)}  ${inBand(p, band) ? "in" : "OUT"}`);
}
