import { describe, expect, it } from "vitest";
import { RngSource } from "../rng.ts";
import type { EnemyId, Cell, EliteAffix, EncounterProfile, RoomPlan, RoomType } from "../types.ts";
import {
  AFFIXES, ELITE_AFFIX_IDS, SHIELDED_ROOM_SHARE_PERCENT, SPLITTING_ROSTER_LIMIT, affixAllowed,
  affixCarriers, affixContext, affixPressureMultiplier, affixStats, applyEliteAffixes,
  enumerateAffixSets, isLegalAffixSet, pairAllowed,
} from "./affixes.ts";
import { assembleEncounterDetailed } from "./assemble.ts";
import { MAX_CONCURRENT_ENEMIES } from "./enemies.ts";
import { PRESSURE_BANDS, inBand } from "./pressure.ts";

function makeRoom(open: number, pillars: number, groups: { id: string; n: number }[]): Pick<RoomPlan, "measured" | "spawn_groups"> {
  return {
    measured: { open_ratio: open, pillar_count: pillars, symmetry_error: 0, reachable_ratio: 1 },
    spawn_groups: groups.map((g, i) => ({
      id: g.id,
      cells: Array.from({ length: g.n }, (_, j) => [j + 1, i + 1] as Cell),
    })),
  };
}

const ROOMS = [
  makeRoom(0.92, 0, [{ id: "front_far", n: 5 }, { id: "flank_east", n: 4 }, { id: "flank_west", n: 4 }, { id: "center", n: 4 }]),
  makeRoom(0.68, 6, [{ id: "far_north", n: 6 }, { id: "side_left", n: 4 }, { id: "side_right", n: 4 }]),
  makeRoom(0.44, 14, [{ id: "front_far", n: 4 }, { id: "flank_east", n: 4 }, { id: "flank_west", n: 4 }]),
];

const openContext = { roster_size: 6, rooms_seen: 4, shielded_rooms: 0, build_elemental_only: false };

describe("affix table (doc 005)", () => {
  it("is the doc's six affixes with their effects", () => {
    expect(ELITE_AFFIX_IDS).toEqual(["armored", "swift", "burning", "splitting", "shielded", "volatile"]);
    expect(AFFIXES.armored.hp_mult).toBeCloseTo(1.6, 6);
    expect(AFFIXES.swift.speed_mult).toBeCloseTo(1.35, 6);
    expect(AFFIXES.swift.interval_mult).toBeCloseTo(0.8, 6);
    expect(AFFIXES.shielded.max_enemies).toBe(1);
    for (const id of ELITE_AFFIX_IDS) expect(AFFIXES[id].description.length).toBeGreaterThan(10);
  });

  it("prices armored and swift at 1.3 and everything else at 1.15", () => {
    expect(AFFIXES.armored.pressure_mult).toBeCloseTo(1.3, 6);
    expect(AFFIXES.swift.pressure_mult).toBeCloseTo(1.3, 6);
    for (const id of ["burning", "splitting", "shielded", "volatile"] as EliteAffix[]) {
      expect(AFFIXES[id].pressure_mult).toBeCloseTo(1.15, 6);
    }
  });

  it("multiplies stats across a set", () => {
    expect(affixStats(["armored", "swift"])).toEqual({ hp_mult: 1.6, speed_mult: 1.35, interval_mult: 0.8 });
    expect(affixStats([])).toEqual({ hp_mult: 1, speed_mult: 1, interval_mult: 1 });
  });

  it("prices a capped affix for the share of the roster that carries it", () => {
    expect(affixPressureMultiplier(["armored"], 8)).toBeCloseTo(1.3, 6);
    // shielded touches one enemy in eight, so it is not priced as a whole room.
    expect(affixPressureMultiplier(["shielded"], 8)).toBeCloseTo(1 + 0.15 / 8, 6);
    expect(affixCarriers(["shielded", "swift"], 8)).toEqual({ shielded: 1, swift: 8 });
  });
});

describe("legal set enumeration", () => {
  it("never puts armored with shielded", () => {
    expect(pairAllowed("armored", "shielded")).toBe(false);
    expect(pairAllowed("shielded", "armored")).toBe(false);
    const sets = enumerateAffixSets(openContext);
    for (const set of sets) {
      expect(set.includes("armored") && set.includes("shielded")).toBe(false);
    }
  });

  it("offers every single and every legal pair", () => {
    const sets = enumerateAffixSets(openContext);
    expect(sets.filter((s) => s.length === 1)).toHaveLength(6);
    expect(sets.filter((s) => s.length === 2)).toHaveLength(15 - 1);
    expect(sets.every((s) => isLegalAffixSet(s, openContext))).toBe(true);
  });

  it("drops splitting once the roster reaches eight", () => {
    expect(affixAllowed("splitting", { ...openContext, roster_size: SPLITTING_ROSTER_LIMIT - 1 })).toBe(true);
    expect(affixAllowed("splitting", { ...openContext, roster_size: SPLITTING_ROSTER_LIMIT })).toBe(false);
    const big = enumerateAffixSets({ ...openContext, roster_size: 10 });
    expect(big.flat()).not.toContain("splitting");
  });

  it("drops shielded when the build's only damage path is elemental", () => {
    const ctx = { ...openContext, build_elemental_only: true };
    expect(affixAllowed("shielded", ctx)).toBe(false);
    expect(enumerateAffixSets(ctx).flat()).not.toContain("shielded");
  });

  it("drops shielded once the run has used it in 30% of rooms", () => {
    expect(affixAllowed("shielded", { ...openContext, rooms_seen: 10, shielded_rooms: 2 })).toBe(true);
    expect(affixAllowed("shielded", { ...openContext, rooms_seen: 10, shielded_rooms: 3 })).toBe(false);
    expect(affixAllowed("shielded", { ...openContext, rooms_seen: 3, shielded_rooms: 1 })).toBe(false);
    expect(SHIELDED_ROOM_SHARE_PERCENT).toBe(30);
  });

  it("builds its context from the run history", () => {
    const ctx = affixContext(
      7,
      { rooms: ["combat", "elite", "shop"] as RoomType[], shielded_rooms: 1 },
      false,
    );
    expect(ctx).toEqual({ roster_size: 7, rooms_seen: 3, shielded_rooms: 1, build_elemental_only: false });
    expect(affixAllowed("shielded", ctx)).toBe(false); // 1 of 3 is already over 30%
  });

  it("rejects a malformed set outright", () => {
    expect(isLegalAffixSet([], openContext)).toBe(false);
    expect(isLegalAffixSet(["swift", "swift"], openContext)).toBe(false);
    expect(isLegalAffixSet(["swift", "burning", "volatile"], openContext)).toBe(false);
  });
});

describe("re-measurement after applying a set", () => {
  const profile: EncounterProfile =
    { composition: "mixed", density: "dense", wave_structure: "single", anchor: "tank", entry: "surround" };

  it("never leaves the elite band, for every legal set in every room", () => {
    const degradations = new Set<string>();
    for (let r = 0; r < ROOMS.length; r++) {
      const room = ROOMS[r]!;
      const base = assembleEncounterDetailed(
        profile, room, PRESSURE_BANDS.elite, new RngSource("affix").stream("decision", r, "N", 2),
      );
      expect(inBand(base.plan.measured_pressure, PRESSURE_BANDS.elite)).toBe(true);

      for (const set of enumerateAffixSets({ ...openContext, roster_size: base.diagnostics.roster.length })) {
        const out = applyEliteAffixes({
          plan: base.plan,
          roster: base.diagnostics.roster,
          chunks: base.diagnostics.chunks,
          room,
          affixes: set,
        });
        degradations.add(out.degradation);
        expect(out.within_band).toBe(true);
        expect(inBand(out.measured_pressure, PRESSURE_BANDS.elite)).toBe(true);
        expect(out.plan.measured_pressure).toBe(out.measured_pressure);
        expect(out.roster.length).toBeLessThanOrEqual(MAX_CONCURRENT_ENEMIES);
        // The set only ever degrades toward its own first affix.
        expect(out.affixes.length).toBeLessThanOrEqual(set.length);
        for (const id of out.affixes) expect(set).toContain(id);
        if (out.affixes.length > 0) expect(out.affixes[0]).toBe(set[0]);
        // shielded lands on one enemy at most, whatever the roster size.
        if (out.affixes.includes("shielded")) expect(out.carriers.shielded).toBe(1);
      }
    }
    /*
     * The doc's degradation path is actually exercised, not merely available.
     * Assembled rosters hold one heavy each now (`ROSTER_CAP`), which rarely
     * overshoots the band under a set, so the shrink is provoked deliberately:
     * a full twelve-body roster under the two heaviest multipliers.
     */
    const room = ROOMS[0]!;
    const base = assembleEncounterDetailed(
      profile, room, PRESSURE_BANDS.elite, new RngSource("affix").stream("decision", 0, "N", 2),
    );
    const padded: EnemyId[] = [...base.diagnostics.roster];
    while (padded.length < MAX_CONCURRENT_ENEMIES) padded.push("orbiter");
    const heavy = applyEliteAffixes({
      plan: base.plan, roster: padded, chunks: base.diagnostics.chunks, room, affixes: ["armored", "swift"],
    });
    degradations.add(heavy.degradation);
    expect(heavy.within_band).toBe(true);
    // Something had to give to keep a twelve-body roster under two
    // multipliers in band: a smaller roster, a refit, or the first affix only.
    expect(heavy.degradation).not.toBe("none");
  });

  it("shrinks the roster before it touches the affix set", () => {
    const room = ROOMS[2]!;
    const base = assembleEncounterDetailed(
      profile, room, PRESSURE_BANDS.elite, new RngSource("affix-order").stream("decision", 1, "N", 2),
    );
    const out = applyEliteAffixes({
      plan: base.plan,
      roster: base.diagnostics.roster,
      chunks: base.diagnostics.chunks,
      room,
      affixes: ["armored", "swift"],
    });
    expect(out.within_band).toBe(true);
    // `roster_refitted` is the rung below `first_affix_only` on the doc's
    // ladder: the roster has already been shrunk and the set already cut to
    // its first affix. Either way the roster gave before the set did.
    if (out.degradation === "first_affix_only" || out.degradation === "roster_refitted") {
      expect(out.affixes).toEqual(["armored"]);
      expect(out.roster.length).toBeLessThan(base.diagnostics.roster.length);
    } else {
      expect(out.affixes).toEqual(["armored", "swift"]);
      expect(out.roster.length).toBeLessThanOrEqual(base.diagnostics.roster.length);
    }
  });

  it("carries the affixes and the re-measured pressure on the plan it returns", () => {
    const room = ROOMS[0]!;
    const base = assembleEncounterDetailed(
      profile, room, PRESSURE_BANDS.elite, new RngSource("affix-plan").stream("decision", 0, "N", 2),
    );
    const out = applyEliteAffixes({
      plan: base.plan, roster: base.diagnostics.roster, chunks: base.diagnostics.chunks, room, affixes: ["burning"],
    });
    expect(out.plan.elite_affixes).toEqual(out.affixes);
    expect(out.plan.band).toEqual([5.5, 9]);
    expect(out.multiplier).toBeGreaterThanOrEqual(1);
    expect(out.plan.waves.length).toBeGreaterThan(0);
  });
});
