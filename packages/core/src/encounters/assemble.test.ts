import { describe, expect, it } from "vitest";
import { RngSource } from "../rng.ts";
import type {
  Anchor, AssemblableId, BaseEnemyId, Cell, Composition, Density, EncounterPlan, EncounterProfile, EnemyId, EntryPattern,
  RoomPlan, WaveStructure,
} from "../types.ts";
import {
  DENSITY_TARGETS, MAX_COUNT_RETRIES, MIX_RATIOS, TRICKLE_STEP_MS, TWO_WAVE_DELAY_MS,
  assembleEncounter, assembleEncounterDetailed, assignSpawns, buildFromRoster, buildRoster,
  capacityOf, effectivePopulation, groupsFor, maxCountFor, TRICKLE_ROUND_MAX, meanThreatOf, relaxDensity,
  rosterOrder, splitWaves, validateEncounter, MAX_ROSTER, MIN_ROOM_BODIES, ROUND_GAP_MS,
} from "./assemble.ts";
import { ENEMIES, MAX_CONCURRENT_ENEMIES, SUBSPECIES_IDS, SUMMONER_MINION_CAP, canSpawnMinion } from "./enemies.ts";
import { PRESSURE_BANDS, contextFor, inBand, peakConcurrency } from "./pressure.ts";
import { PRESETS, PRESET_TIERS, presetForBand } from "./presets.ts";

/* -------------------------------- fixtures -------------------------------- */

function cells(n: number, y: number): Cell[] {
  return Array.from({ length: n }, (_, i) => [i + 1, y] as Cell);
}

type Room = Pick<RoomPlan, "measured" | "spawn_groups">;

function makeRoom(open: number, pillars: number, groups: { id: string; n: number }[]): Room {
  return {
    measured: { open_ratio: open, pillar_count: pillars, symmetry_error: 0, reachable_ratio: 1 },
    spawn_groups: groups.map((g, i) => ({ id: g.id, cells: cells(g.n, i + 1) })),
  };
}

const ROOMS: Room[] = [
  makeRoom(0.92, 0, [
    { id: "front_far", n: 5 }, { id: "flank_east", n: 4 }, { id: "flank_west", n: 4 }, { id: "center", n: 4 },
  ]),
  makeRoom(0.71, 5, [
    { id: "far_north", n: 6 }, { id: "side_left", n: 3 }, { id: "side_right", n: 3 }, { id: "centre_pit", n: 3 },
  ]),
  makeRoom(0.48, 13, [{ id: "front_far", n: 4 }, { id: "flank_east", n: 3 }, { id: "flank_west", n: 3 }]),
  // A room whose only spawn group is tiny: everything has to overflow.
  makeRoom(0.6, 2, [{ id: "front_far", n: 2 }]),
];

const COMPOSITIONS: Composition[] = ["melee_heavy", "ranged_heavy", "mixed", "siege"];
const DENSITIES: Density[] = ["sparse", "normal", "dense"];
const STRUCTURES: WaveStructure[] = ["relentless", "steady", "breathe"];
const ANCHORS: Anchor[] = ["none", "tank", "summoner"];
const ENTRIES: EntryPattern[] = ["far_front", "flanks", "surround", "turrets_center"];

function profileSpace(): EncounterProfile[] {
  const out: EncounterProfile[] = [];
  for (const composition of COMPOSITIONS) {
    for (const density of DENSITIES) {
      for (const wave_structure of STRUCTURES) {
        for (const anchor of ANCHORS) {
          for (const entry of ENTRIES) out.push({ composition, density, wave_structure, anchor, entry });
        }
      }
    }
  }
  return out;
}

function rosterOf(plan: EncounterPlan): EnemyId[] {
  return plan.waves.flatMap((w) => w.spawns.flatMap((s) => Array<EnemyId>(s.count).fill(s.archetype)));
}

const rng = (key: string): ReturnType<RngSource["stream"]> => new RngSource("assemble-test").stream(key);

/* ---------------------------------- mix ----------------------------------- */

describe("mix (step 2)", () => {
  it("is the doc's ratio table", () => {
    /*
     * The table is over **base** archetypes, and the subspecies sit at zero:
     * they are promoted onto a drawn body rather than drawn (doc 019, and see
     * `withSubspecies` for the apportionment reason). So a composition still
     * says what kind of fight the room is, in the bodies a player can name.
     */
    expect(MIX_RATIOS.melee_heavy).toMatchObject({
      rusher: 0.5, orbiter: 0.15, tank: 0.1, delver: 0.15, cinderling: 0.1, warden: 0,
    });
    expect(MIX_RATIOS.ranged_heavy).toMatchObject({
      shooter: 0.22, turret: 0.12, sentinel: 0.12, orbiter: 0.1,
      bellringer: 0.1, snarecaster: 0.1, sower: 0.08, rifter: 0.08, warden: 0.08,
    });
    expect(MIX_RATIOS.siege).toMatchObject({
      turret: 0.22, sentinel: 0.18, shooter: 0.14, rusher: 0.1,
      rifter: 0.14, warden: 0.12, bellringer: 0.05, sower: 0.05,
    });
    // Every subspecies is at zero in every row, in every composition.
    for (const composition of COMPOSITIONS)
      for (const id of SUBSPECIES_IDS)
        expect(MIX_RATIOS[composition][id as AssemblableId], `${composition}/${id}`).toBe(0);
    for (const composition of COMPOSITIONS) {
      const total = Object.values(MIX_RATIOS[composition]).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 6);
    }
    /*
     * From the roster's own weights — there is one threat table now, not two.
     *
     * This is the mean of the composition **as planned**, over base bodies.
     * Promotion adds weight after the roster exists (a subspecies is priced
     * 1.15 to 1.30 times its base), and the pressure model measures the
     * promoted roster, so the extra is paid for where it is felt rather than
     * priced into the option tier a composition is offered as.
     */
    expect(meanThreatOf("melee_heavy")).toBeCloseTo(1.95, 1);
    expect(meanThreatOf("mixed")).toBeGreaterThan(meanThreatOf("siege"));
  });

  it("draws a roster close to the composition's ratios", () => {
    const order = rosterOrder("melee_heavy", rng("mix"), 20);
    const rushers = order.filter((id) => id === "rusher").length;
    // Above the 0.45 ratio once the capped heavies are spent, which is the cap working.
    expect(rushers / order.length).toBeGreaterThanOrEqual(0.4);
    expect(rushers / order.length).toBeLessThanOrEqual(0.6);
    expect(order).not.toContain("shooter");
    expect(order).not.toContain("turret");
    expect(order).not.toContain("sentinel");
  });

  it("puts the anchor in first, exactly once", () => {
    const order = rosterOrder("ranged_heavy", rng("anchor"));
    const roster = buildRoster(
      { composition: "ranged_heavy", density: "normal", wave_structure: "relentless", anchor: "tank", entry: "far_front" },
      6,
      order,
    );
    expect(roster).toHaveLength(6);
    expect(roster[0]).toBe("tank");
    expect(roster.filter((id) => id === "tank")).toHaveLength(1);
  });

  it("only ever adds or removes the last body when the count changes by one", () => {
    for (const composition of ["melee_heavy", "ranged_heavy", "siege"] as Composition[]) {
      const order = rosterOrder(composition, rng(`monotone-${composition}`));
      const p: EncounterProfile =
        { composition, density: "normal", wave_structure: "relentless", anchor: "none", entry: "surround" };
      for (let n = 1; n < MAX_CONCURRENT_ENEMIES; n++) {
        expect(buildRoster(p, n + 1, order).slice(0, n)).toEqual(buildRoster(p, n, order));
      }
    }
  });

  it("keeps one more body from ever meaning less pressure", () => {
    // The retry loop walks the count by one and trusts the direction it went.
    for (const composition of COMPOSITIONS) {
      const order = rosterOrder(composition, rng(`rise-${composition}`));
      const p: EncounterProfile =
        { composition, density: "dense", wave_structure: "relentless", anchor: "none", entry: "surround" };
      const ctx = contextFor(ROOMS[0]!, composition);
      let last = 0;
      for (let n = 1; n <= MAX_CONCURRENT_ENEMIES; n++) {
        const pressure = buildFromRoster(buildRoster(p, n, order), p, ROOMS[0]!, [], ctx).pressure;
        expect(pressure).toBeGreaterThan(last);
        last = pressure;
      }
    }
  });
});

/* --------------------------------- count ---------------------------------- */

describe("count (step 3)", () => {
  it("is the doc's density table", () => {
    expect(DENSITY_TARGETS).toEqual({ sparse: [5, 7], normal: [9, 12], dense: [14, 18] });
  });

  it("relaxes one step at a time and stops at the ends", () => {
    expect(relaxDensity("sparse", 1)).toBe("normal");
    expect(relaxDensity("normal", 1)).toBe("dense");
    expect(relaxDensity("dense", 1)).toBeNull();
    expect(relaxDensity("normal", -1)).toBe("sparse");
    expect(relaxDensity("sparse", -1)).toBeNull();
  });
});

/* --------------------------------- waves ---------------------------------- */

describe("waves (step 4)", () => {
  const roster: EnemyId[] = ["tank", "rusher", "shooter", "orbiter", "rusher", "turret", "shooter", "rusher"];

  it("puts a single wave at 0 s", () => {
    const waves = splitWaves(roster, "relentless", []);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toMatchObject({ at_ms: 0 });
    expect(waves[0]!.enemies).toHaveLength(roster.length);
  });

  it("splits two waves 60/40 three seconds apart", () => {
    const waves = splitWaves(roster, "steady", []);
    expect(waves).toHaveLength(2);
    expect(waves[0]!.at_ms).toBe(0);
    expect(waves[1]!.at_ms).toBe(TWO_WAVE_DELAY_MS);
    expect(waves[0]!.enemies).toHaveLength(Math.round(roster.length * 0.6));
    expect(waves[0]!.enemies.length + waves[1]!.enemies.length).toBe(roster.length);
  });

  it("trickles two or three every 2.5 s until the roster is exhausted", () => {
    const waves = splitWaves(roster, "breathe", [2, 3, 2, 3]);
    expect(waves.map((w) => w.at_ms)).toEqual([0, TRICKLE_STEP_MS, 2 * TRICKLE_STEP_MS, 3 * TRICKLE_STEP_MS]);
    expect(waves.map((w) => w.enemies.length)).toEqual([2, 3, 2, 1]);
    expect(waves.flatMap((w) => w.enemies)).toEqual(roster);
  });
});

/* ------------------------------ spawn groups ------------------------------ */

describe("spawn assignment (step 4)", () => {
  it("picks groups the entry pattern names, and every group for surround", () => {
    const groups = ROOMS[0]!.spawn_groups;
    expect(groupsFor(groups, "surround", "rusher")).toHaveLength(groups.length);
    expect(groupsFor(groups, "far_front", "rusher").map((g) => g.id)).toEqual(["front_far"]);
    expect(groupsFor(groups, "flanks", "rusher").map((g) => g.id)).toEqual(["flank_east", "flank_west"]);
    expect(groupsFor(groups, "turrets_center", "turret").map((g) => g.id)).toEqual(["center"]);
    expect(groupsFor(groups, "turrets_center", "rusher").map((g) => g.id)).not.toContain("center");
  });

  it("falls back to every group when the room names none of them", () => {
    const odd = makeRoom(0.6, 0, [{ id: "alpha", n: 3 }, { id: "beta", n: 3 }]);
    expect(groupsFor(odd.spawn_groups, "far_front", "rusher")).toHaveLength(2);
  });

  it("defers overflow to the next wave and never drops an enemy", () => {
    const tight = ROOMS[3]!; // one group, two cells
    const roster: EnemyId[] = ["rusher", "rusher", "shooter", "shooter", "turret", "turret", "tank"];
    const planned = splitWaves(roster, "relentless", []);
    const { waves, deferred } = assignSpawns(planned, tight.spawn_groups, "far_front");

    const placed = waves.flatMap((w) => w.spawns.map((s) => s.count)).reduce((a, b) => a + b, 0);
    expect(placed).toBe(roster.length); // nothing dropped
    expect(deferred).toBe(roster.length - 2); // five had to wait
    expect(waves.length).toBeGreaterThan(1);
    // Capacity is per wave, and no wave exceeds it.
    for (const w of waves) {
      const used = w.spawns.reduce((a, s) => a + s.count, 0);
      expect(used).toBeLessThanOrEqual(capacityOf(tight.spawn_groups[0]!));
    }
    // Overflow waves open later than the one they spilled out of.
    expect(waves.map((w) => w.at_ms)).toEqual([...waves].map((w) => w.at_ms).sort((a, b) => a - b));
    expect(new Set(waves.map((w) => w.at_ms)).size).toBe(waves.length);
  });

  it("spreads a wave over the groups the entry allows instead of filling one", () => {
    const roster: EnemyId[] = ["rusher", "rusher", "rusher", "rusher"];
    const { waves, deferred } = assignSpawns(splitWaves(roster, "relentless", []), ROOMS[0]!.spawn_groups, "surround");
    expect(deferred).toBe(0);
    expect(waves).toHaveLength(1);
    expect(new Set(waves[0]!.spawns.map((s) => s.spawn_group)).size).toBe(4);
  });

  it("refuses a room with no spawn groups rather than inventing one", () => {
    expect(() => assignSpawns([{ at_ms: 0, enemies: ["rusher"] }], [], "surround")).toThrow(/spawn group/);
  });
});

/* -------------------------------- assembly -------------------------------- */

describe("assembleEncounter over the whole profile space", () => {
  const profiles = profileSpace();

  it("covers every combination the profile allows", () => {
    expect(profiles).toHaveLength(4 * 3 * 3 * 3 * 4);
  });

  it("lands in the band or reaches a preset, for every profile, room and band", () => {
    let total = 0;
    let outOfBand = 0;
    const outcomes: Record<string, number> = {};
    for (const [tier, band] of Object.entries(PRESSURE_BANDS)) {
      for (let r = 0; r < ROOMS.length; r++) {
        for (const profile of profiles) {
          const { plan, diagnostics } = assembleEncounterDetailed(
            profile,
            ROOMS[r]!,
            band,
            new RngSource("sweep").stream("decision", r, tier, 2),
          );
          total++;
          outcomes[diagnostics.outcome] = (outcomes[diagnostics.outcome] ?? 0) + 1;

          // The doc's promise: in band, or a preset was reached.
          const ok = inBand(plan.measured_pressure, band) || diagnostics.outcome === "preset";
          if (!ok) outOfBand++;
          // Retry budget: five count adjustments per density, two densities.
          expect(diagnostics.retries).toBeLessThanOrEqual(MAX_COUNT_RETRIES * 2);
          if (diagnostics.outcome === "preset") {
            expect(diagnostics.preset).not.toBeNull();
            expect(plan.source).toBe("rule");
          } else {
            expect(plan.source).toBe("jev");
          }
          expect(plan.band).toEqual([band[0], band[1]]);
          expect(validateEncounter(plan, ROOMS[r]!)).toEqual([]);
        }
      }
    }
    expect(outOfBand).toBe(0);
    // With the calibrated scale nothing in the sweep ends up outside its band,
    // preset or not -- this is the regression guard on CONCURRENCY_SCALE.
    expect(outcomes.preset ?? 0).toBeLessThan(total);
  });

  it("gates minions on the shared minion pool and the concurrency cap", () => {
    expect(ENEMIES.summoner.summon?.max_alive).toBe(SUMMONER_MINION_CAP);
    expect(canSpawnMinion(5, 0)).toBe(true);
    expect(canSpawnMinion(5, SUMMONER_MINION_CAP)).toBe(false);
    expect(canSpawnMinion(MAX_CONCURRENT_ENEMIES, 0)).toBe(false);
    expect(canSpawnMinion(MAX_CONCURRENT_ENEMIES - 1, SUMMONER_MINION_CAP - 1)).toBe(true);
  });

  it("never assembles a combat room thinner than the floor, where the band allows it", () => {
    let thin = 0;
    let total = 0;
    for (const [, band] of Object.entries(PRESSURE_BANDS))
      for (let r = 0; r < ROOMS.length; r++)
        for (const profile of profiles) {
          const { diagnostics } = assembleEncounterDetailed(profile, ROOMS[r]!, band, new RngSource("floor").stream("d", r));
          total++;
          if (diagnostics.roster.length < MIN_ROOM_BODIES) thin++;
        }
    // The floor is a preference the band may still overrule, but rarely.
    // Release's ceiling holds a mixed room to four or five; the rest reach it.
    expect(thin / total).toBeLessThan(0.15);
  });

  it("holds the summoner population cap and the 12-enemy concurrency cap", () => {
    for (const [tier, band] of Object.entries(PRESSURE_BANDS)) {
      for (let r = 0; r < ROOMS.length; r++) {
        for (const profile of profiles) {
          const { plan, diagnostics } = assembleEncounterDetailed(
            profile,
            ROOMS[r]!,
            band,
            new RngSource("caps").stream("decision", r, tier, 2),
          );
          const roster = rosterOf(plan);
          // The roster may outnumber the concurrency cap only when it is
          // staged so that it never stands on screen together.
          expect(roster.length).toBeLessThanOrEqual(MAX_ROSTER);
          // The plan's own staging: a thin single wave is restaged as a trickle.
          if (plan.profile.wave_structure !== "breathe") expect(roster.length).toBeLessThanOrEqual(MAX_CONCURRENT_ENEMIES);
          expect(peakConcurrency(plan.waves)).toBeLessThanOrEqual(MAX_CONCURRENT_ENEMIES);
          expect(diagnostics.peak_concurrency).toBeLessThanOrEqual(MAX_CONCURRENT_ENEMIES);
          // Minions only ever land in a slot the cap has left free.
          const summoners = roster.filter((id) => id === "summoner").length;
          let alive = peakConcurrency(plan.waves);
          let minions = 0;
          while (summoners > 0 && canSpawnMinion(alive, minions)) {
            alive++;
            minions++;
          }
          expect(alive).toBeLessThanOrEqual(MAX_CONCURRENT_ENEMIES);
          expect(minions).toBeLessThanOrEqual(SUMMONER_MINION_CAP);
          expect(effectivePopulation(diagnostics.roster)).toBeGreaterThanOrEqual(diagnostics.roster.length);
        }
      }
    }
  });

  it("never schedules more than the cap, summoner anchor or not", () => {
    const p: EncounterProfile =
      { composition: "mixed", density: "dense", wave_structure: "relentless", anchor: "summoner", entry: "surround" };
    expect(maxCountFor(p)).toBe(MAX_CONCURRENT_ENEMIES);
    expect(maxCountFor({ ...p, wave_structure: "steady" })).toBe(MAX_CONCURRENT_ENEMIES);
    expect(maxCountFor({ ...p, wave_structure: "breathe" })).toBe(TRICKLE_ROUND_MAX);
    // Rounds each bring their own share, up to the room's roster ceiling.
    expect(maxCountFor({ ...p, rounds: 2 })).toBe(MAX_CONCURRENT_ENEMIES * 2);
    expect(maxCountFor({ ...p, wave_structure: "breathe", rounds: 3 })).toBe(MAX_ROSTER);
    const plan = assembleEncounter(p, ROOMS[0]!, PRESSURE_BANDS.elite, rng("summoner-anchor"));
    expect(rosterOf(plan)[0]).toBe("summoner");
    expect(rosterOf(plan).length).toBeLessThanOrEqual(MAX_CONCURRENT_ENEMIES);
  });

  it("never drops an enemy: every roster body appears in some wave", () => {
    for (const profile of profileSpace()) {
      const { plan, diagnostics } = assembleEncounterDetailed(
        profile,
        ROOMS[3]!, // the tiny room, where everything overflows
        PRESSURE_BANDS.build,
        rng(`nodrop-${profile.composition}-${profile.entry}`),
      );
      expect(rosterOf(plan).length).toBe(diagnostics.roster.length);
      const counted = new Map<EnemyId, number>();
      for (const id of rosterOf(plan)) counted.set(id, (counted.get(id) ?? 0) + 1);
      for (const id of diagnostics.roster) counted.set(id, (counted.get(id) ?? 0) - 1);
      for (const [, n] of counted) expect(n).toBe(0);
    }
  });

  it("is deterministic in the seed and only in the seed", () => {
    const p: EncounterProfile =
      { composition: "mixed", density: "normal", wave_structure: "steady", anchor: "tank", entry: "flanks" };
    const a = assembleEncounter(p, ROOMS[1]!, PRESSURE_BANDS.build, new RngSource("seed-a").stream("decision", 3, "N", 2));
    const b = assembleEncounter(p, ROOMS[1]!, PRESSURE_BANDS.build, new RngSource("seed-a").stream("decision", 3, "N", 2));
    const c = assembleEncounter(p, ROOMS[1]!, PRESSURE_BANDS.build, new RngSource("seed-b").stream("decision", 3, "N", 2));
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("records the profile it actually built, including a relaxed density", () => {
    for (const profile of profileSpace().slice(0, 40)) {
      const { plan, diagnostics } = assembleEncounterDetailed(
        profile, ROOMS[0]!, PRESSURE_BANDS.peak, rng(`record-${profile.entry}-${profile.anchor}`),
      );
      if (diagnostics.outcome === "density_relaxed") {
        expect(plan.profile.density).toBe(diagnostics.relaxed_density);
      } else if (diagnostics.outcome !== "preset") {
        expect(plan.profile).toEqual(profile);
      }
      expect(plan.elite_affixes).toEqual([]);
    }
  });

  it("flags a plan that breaks spawn-group capacity", () => {
    const plan: EncounterPlan = {
      profile: { composition: "mixed", density: "dense", wave_structure: "relentless", anchor: "none", entry: "surround" },
      waves: [{ at_ms: 0, spawns: [{ archetype: "rusher", spawn_group: "front_far", count: 9 }] }],
      measured_pressure: 3,
      band: [2, 3.5],
      elite_affixes: [],
      source: "jev",
    };
    const issues = validateEncounter(plan, ROOMS[3]!);
    expect(issues.map((i) => i.rule)).toContain("spawn_group_capacity");
  });
});

/* -------------------------------- presets --------------------------------- */

describe("tiered presets (step 6)", () => {
  it("authors one roster per tier, six in all, with rising pressure", () => {
    expect(PRESET_TIERS).toHaveLength(6);
    const ctx = contextFor(ROOMS[0]!, "mixed");
    let last = 0;
    for (const tier of PRESET_TIERS) {
      const preset = PRESETS[tier];
      expect(preset.roster.length).toBeLessThanOrEqual(MAX_CONCURRENT_ENEMIES);
      expect(preset.description.length).toBeGreaterThan(10);
      // The rosters rise; staged as one wave so the elite presets' second
      // wave (an elite room always has one) does not discount the comparison.
      const p = buildFromRoster(preset.roster, { ...preset.profile, wave_structure: "relentless" }, ROOMS[0]!, [], ctx).pressure;
      expect(p).toBeGreaterThan(last);
      last = p;
    }
  });

  it("picks the preset whose own band sits closest to the one asked for", () => {
    expect(presetForBand(PRESSURE_BANDS.release).tier).toBe("release");
    expect(presetForBand(PRESSURE_BANDS.build).tier).toBe("build");
    expect(presetForBand(PRESSURE_BANDS.peak).tier).toBe("peak");
    expect(presetForBand(PRESSURE_BANDS.elite).tier).toBe("elite_mid");
    expect(presetForBand([8.2, 9]).tier).toBe("elite_high");
  });
});

describe("rounds (doc 014)", () => {
  it("make a room longer, not harder: each round is in band, apart from the next", () => {
    const one: EncounterProfile = { composition: "mixed", density: "normal", wave_structure: "steady", anchor: "none", entry: "far_front" };
    const a = assembleEncounterDetailed(one, ROOMS[0]!, PRESSURE_BANDS.build, rng("rounds-1"));
    const b = assembleEncounterDetailed({ ...one, rounds: 3 }, ROOMS[0]!, PRESSURE_BANDS.build, rng("rounds-3"));
    expect(b.diagnostics.in_band).toBe(true);
    expect(b.diagnostics.roster.length).toBeGreaterThan(a.diagnostics.roster.length * 2);
    // No more on the floor at once than a one-round room.
    expect(b.diagnostics.peak_concurrency).toBeLessThanOrEqual(MAX_CONCURRENT_ENEMIES);
    const last = b.plan.waves.at(-1)!.at_ms;
    expect(last).toBeGreaterThan(2 * ROUND_GAP_MS);
  });
});

