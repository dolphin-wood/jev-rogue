/**
 * Headless balance harness (design doc 011). It runs `packages/core` without
 * Phaser and reports the numbers calibration needs, rather than only passing
 * or failing: a preset rate or a relax rate is something a designer reads and
 * acts on, and hiding it behind a green tick would waste the run.
 */
import { peakConcurrency,
  assembleEncounterDetailed, PRESSURE_BANDS, inBand,
  RngSource, MAX_CONCURRENT_ENEMIES, filterForCharter, tallyShowcase,
  generateRoom, PLAYABLE_ARCHETYPES, ROOM_SIZES, validateRoom,
} from "@jr/core";
import type {
  Anchor, Composition, Density, EncounterProfile, EntryPattern,
  RoomPlan, WaveStructure, RoomType, CounterScore, CounterOption,
} from "@jr/core";

const COMPOSITIONS: Composition[] = ["melee_heavy", "ranged_heavy", "mixed", "siege"];
const DENSITIES: Density[] = ["sparse", "normal", "dense"];
const WAVES: WaveStructure[] = ["relentless", "steady", "breathe"];
const ANCHORS: Anchor[] = ["none", "tank", "summoner"];
const ENTRIES: EntryPattern[] = ["far_front", "flanks", "surround", "turrets_center"];

type RoomFixture = Pick<RoomPlan, "measured" | "spawn_groups">;

function fixture(openRatio: number, pillars: number): RoomFixture {
  return {
    measured: { open_ratio: openRatio, pillar_count: pillars, symmetry_error: 0, reachable_ratio: 1 },
    spawn_groups: [
      { id: "far", cells: [[10, 2], [9, 2], [11, 2], [10, 3], [9, 3]] },
      { id: "flank_left", cells: [[2, 6], [2, 7], [3, 6], [3, 7]] },
      { id: "flank_right", cells: [[18, 6], [18, 7], [17, 6], [17, 7]] },
      { id: "surround", cells: [[10, 10], [9, 10], [11, 10], [10, 9]] },
      { id: "center", cells: [[10, 6], [10, 7]] },
    ],
  };
}

const ROOMS: [string, RoomFixture][] = [
  ["open", fixture(0.85, 0)],
  ["mixed", fixture(0.7, 4)],
  ["covered", fixture(0.55, 7)],
  ["tight", fixture(0.45, 8)],
];

function allProfiles(): EncounterProfile[] {
  const out: EncounterProfile[] = [];
  for (const composition of COMPOSITIONS)
    for (const density of DENSITIES)
      for (const wave_structure of WAVES)
        for (const anchor of ANCHORS)
          for (const entry of ENTRIES)
            out.push({ composition, density, wave_structure, anchor, entry });
  return out;
}

function encounterSweep(): boolean {
  const src = new RngSource("harness-encounters");
  const profiles = allProfiles();
  let total = 0;
  let outOfBand = 0;
  let concurrencyBreaches = 0;
  const presetByTier = new Map<string, { total: number; preset: number }>();

  for (const [tier, band] of Object.entries(PRESSURE_BANDS))
    for (const [roomName, room] of ROOMS)
      for (const [i, profile] of profiles.entries()) {
        const { plan, diagnostics } = assembleEncounterDetailed(
          profile, room, band, src.stream("enc", tier, roomName, i),
        );
        total++;
        if (!inBand(plan.measured_pressure, band)) outOfBand++;
        // Bodies on screen together, not bodies in the roster: a trickle may
        // schedule more than the cap over the whole fight and never stand
        // more than two chunks of it up at once.
        if (peakConcurrency(plan.waves) > MAX_CONCURRENT_ENEMIES) concurrencyBreaches++;
        const e = presetByTier.get(tier) ?? { total: 0, preset: 0 };
        e.total++;
        if (diagnostics.outcome === "preset") e.preset++;
        presetByTier.set(tier, e);
      }

  console.log(`encounters: ${total} assemblies over ${profiles.length} profiles x ${ROOMS.length} rooms x 4 bands`);
  for (const [tier, e] of presetByTier)
    console.log(`  ${tier}: ${((e.preset / e.total) * 100).toFixed(0)}% reached a preset`);
  console.log(`  out of band: ${outOfBand}`);
  console.log(`  concurrency cap breaches: ${concurrencyBreaches}`);
  return outOfBand === 0 && concurrencyBreaches === 0;
}

/**
 * Doc 011: over simulated runs, the showcase floor must hold in every run.
 * This is a bug check, not a metric, so any single breach fails the harness.
 */
function charterSweep(runs = 200): boolean {
  const src = new RngSource("harness-charter");
  let worst = 1;
  let breaches = 0;

  for (let run = 0; run < runs; run++) {
    const rng = src.stream("charter", run);
    const history: { rooms: RoomType[]; counter_scores: CounterScore[] } = { rooms: [], counter_scores: [] };

    for (let room = 0; room < 9; room++) {
      // Elite rooms carry a score but count on neither side of the ratio.
      const type: RoomType = rng.next() < 0.25 ? "elite" : "combat";
      // The adversarial case: always take the hardest option the filter allows.
      const options: CounterOption<CounterScore>[] =
        (["counters", "neutral", "favours"] as CounterScore[]).map((s) => ({ value: s, score: s }));
      const allowed = filterForCharter(options, history, type);
      const chosen = allowed[0]?.value ?? "neutral";
      history.rooms.push(type);
      history.counter_scores.push(chosen);
    }

    const tally = tallyShowcase(history);
    if (tally.combat_rooms === 0) continue;
    const ratio = tally.showcase_rooms / tally.combat_rooms;
    worst = Math.min(worst, ratio);
    if (ratio < 0.4 - 1e-9) breaches++;
  }

  console.log(`charter: ${runs} adversarial runs, worst showcase ratio ${(worst * 100).toFixed(1)}%, ${breaches} breaches`);
  if (breaches) console.log("  FAIL: the showcase floor can be walked below one room at a time");
  return breaches === 0;
}

/**
 * Doc 004: every archetype crossed with both symmetry values over many seeds
 * must generate a valid, in-band room, with a relax rate under 10 percent.
 */
function roomSweep(seeds = 20): boolean {
  const src = new RngSource("harness-rooms");
  let total = 0, relaxed = 0, authored = 0, invalid = 0;
  const bySpace = new Map<string, number>();

  for (const arch of PLAYABLE_ARCHETYPES)
    for (const symmetry of ["mirrored", "asymmetric"] as const)
      for (let seed = 0; seed < seeds; seed++) {
        const entry = arch.doors[seed % arch.doors.length]!;
        const room = generateRoom(
          { space: arch.id, symmetry, size: ROOM_SIZES[seed % ROOM_SIZES.length]!, mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
          entry, "combat", src.stream("room", arch.id, symmetry, seed),
        );
        total++;
        if (room.layout === "authored") authored++;
        else if (room.relaxed) { relaxed++; bySpace.set(arch.id, (bySpace.get(arch.id) ?? 0) + 1); }
        // Re-validate independently: the generator already validates, so a
        // failure here would mean its own check and this one disagree.
        const check = validateRoom({
          grid: room.grid,
          mask: room.mask,
          archetype: room.effective,
          entry: room.entry,
          zones: room.zones,
          spawnGroups: room.spawn_groups,
          ext: room.extent,
        });
        if (!check.ok) { invalid++; if (invalid <= 2) console.log(`    invalid ${arch.id}/${symmetry}/${seed}: ${check.problems.join("; ")}`); }
      }

  const rate = relaxed / total;
  console.log(`rooms: ${total} generations over ${PLAYABLE_ARCHETYPES.length} archetypes x 2 symmetries x ${seeds} seeds`);
  console.log(`  relaxed: ${relaxed} (${(rate * 100).toFixed(2)}%), authored fallbacks: ${authored}, invalid: ${invalid}`);
  for (const [space, n] of [...bySpace].sort((a, b) => b[1] - a[1]).slice(0, 3))
    console.log(`    ${space}: ${n}`);
  if (rate >= 0.1) console.log("  FAIL: relax rate at or above 10%, fold the offending parameter into the archetype table");
  if (invalid) console.log("  FAIL: a generated room did not validate");
  return rate < 0.1 && invalid === 0;
}

let ok = true;
ok = roomSweep() && ok;
ok = encounterSweep() && ok;
ok = charterSweep() && ok;

console.log(ok ? "harness: OK" : "harness: FAIL");
process.exit(ok ? 0 : 1);
