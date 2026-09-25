/**
 * The tiered fallback rosters (design doc 005, "Assembly" step 6: "one
 * authored roster per tier, six total").
 *
 * The four named pressure bands are not six tiers, so the elite band -- three
 * whole points wide against 1.0 to 1.5 for the others -- is authored in three
 * slices. That gives six rosters whose authored pressures step evenly from
 * 1.6 up to 7.5.
 *
 * A preset is an authored *roster order*, not a fixed count: the roster is
 * taken as a prefix (cycling if it must grow) and count-fitted to the room it
 * lands in, because openness and cover move a fixed roster by up to 20%.
 * Every preset mixes melee and ranged bodies so those two corrections cancel.
 */
import type { EncounterProfile, EnemyId } from "../types.ts";

export type PresetTier = "release" | "build" | "peak" | "elite_low" | "elite_mid" | "elite_high";

export const PRESET_TIERS: readonly PresetTier[] = [
  "release", "build", "peak", "elite_low", "elite_mid", "elite_high",
];

export interface EncounterPreset {
  readonly tier: PresetTier;
  /** The slice of pressure space this roster was authored for. */
  readonly band: readonly [number, number];
  readonly profile: EncounterProfile;
  /** Authored order; cycled when the fit needs more bodies than are listed. */
  readonly roster: readonly EnemyId[];
  readonly description: string;
}

const RELEASE: EncounterPreset = {
  tier: "release",
  band: [1.4, 3.4],
  profile: { composition: "mixed", density: "sparse", wave_structure: "relentless", anchor: "none", entry: "far_front" },
  roster: ["rusher", "shooter", "rusher", "orbiter", "rusher", "rusher"],
  description: "A handful of bodies and one aimed gun: room to breathe.",
};

const BUILD: EncounterPreset = {
  tier: "build",
  band: [3.2, 4.6],
  profile: { composition: "mixed", density: "normal", wave_structure: "relentless", anchor: "none", entry: "far_front" },
  roster: ["rusher", "shooter", "orbiter", "rusher", "shooter", "turret", "tank"],
  description: "A working fight: chip damage from range while rushers close.",
};

/*
 * No preset holds two of a heavy. The elite tiers used to be built by stacking
 * tanks and turrets — six tanks at the ceiling — which is exactly what
 * `ROSTER_CAP` now forbids the assembler, and a fallback that breaks the rule
 * the assembler keeps is not a fallback. One tank, one turret, one summoner,
 * and the tiers rise by how full the room is behind them.
 */
const PEAK: EncounterPreset = {
  tier: "peak",
  band: [4.4, 6.1],
  profile: { composition: "mixed", density: "dense", wave_structure: "relentless", anchor: "tank", entry: "flanks" },
  roster: ["tank", "rusher", "shooter", "orbiter", "rusher", "shooter", "turret", "orbiter", "rusher"],
  description: "A full room with a tank screening the shooters behind it.",
};

const ELITE_LOW: EncounterPreset = {
  tier: "elite_low",
  band: [5.5, 6.9],
  profile: { composition: "mixed", density: "dense", wave_structure: "steady", anchor: "tank", entry: "surround" },
  roster: [
    "tank", "rusher", "shooter", "orbiter", "rusher", "shooter",
    "turret", "orbiter", "rusher", "shooter", "orbiter",
  ],
  description: "Elite floor: a packed room, pressure from every side at once.",
};

const ELITE_MID: EncounterPreset = {
  tier: "elite_mid",
  band: [6.9, 7.6],
  profile: { composition: "mixed", density: "dense", wave_structure: "steady", anchor: "tank", entry: "surround" },
  /*
   * A sentinel and a warden where two rushers were. The three elite presets
   * have to measure in order, and the middle one is the smallest of them —
   * ten bodies against the low tier's eleven — so once the ranged archetypes
   * were repriced it fell behind the tier below it. It rises by weight rather
   * than by count, which is what a middle elite room should be: fewer bodies,
   * each of them worth reading.
   */
  roster: [
    "tank", "summoner", "turret", "orbiter", "orbiter", "shooter",
    "shooter", "sentinel", "warden", "rusher",
  ],
  description: "Elite middle: one of each heavy, and the summoner keeps the floor full.",
};

const ELITE_HIGH: EncounterPreset = {
  tier: "elite_high",
  band: [7.6, 9.0],
  profile: { composition: "mixed", density: "dense", wave_structure: "steady", anchor: "tank", entry: "surround" },
  /*
   * A warden in place of the third rusher. The ceiling preset has to measure
   * above the one below it, and at the concurrency cap it cannot do that by
   * being bigger — twelve bodies in one wave take a larger concurrency
   * discount than ten, so the extra rusher was costing it pressure. It gets
   * there by being *heavier* instead, which is also what "the hardest legal
   * room" should mean.
   */
  roster: [
    "tank", "summoner", "turret", "orbiter", "orbiter", "orbiter",
    "shooter", "shooter", "shooter", "warden", "rusher", "rusher",
  ],
  description: "Elite ceiling: every heavy once and the room full behind them, the hardest legal room in the run.",
};

export const PRESETS: Readonly<Record<PresetTier, EncounterPreset>> = {
  release: RELEASE,
  build: BUILD,
  peak: PEAK,
  elite_low: ELITE_LOW,
  elite_mid: ELITE_MID,
  elite_high: ELITE_HIGH,
};

/** The authored roster for the band, chosen by which tier's own band sits
 *  closest to the requested band's midpoint. */
export function presetForBand(band: readonly [number, number]): EncounterPreset {
  const mid = (band[0] + band[1]) / 2;
  let best = PRESETS.release;
  let bestDistance = Infinity;
  for (const tier of PRESET_TIERS) {
    const p = PRESETS[tier];
    const d = mid < p.band[0] ? p.band[0] - mid : mid > p.band[1] ? mid - p.band[1] : 0;
    if (d < bestDistance - 1e-9) {
      bestDistance = d;
      best = p;
    }
  }
  return best;
}

/** The preset roster extended or trimmed to `count`, cycling the order. */
export function presetRoster(preset: EncounterPreset, count: number): EnemyId[] {
  const out: EnemyId[] = [];
  for (let i = 0; i < count; i++) out.push(preset.roster[i % preset.roster.length]!);
  return out;
}
