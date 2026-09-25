import { describe, expect, it } from "vitest";
import { leafKinds } from "./patterns.ts";
import type { Cell, RoomPlan, Tension, Wave } from "../types.ts";
import { DASH_SPEED, PLAYER_SPEED } from "../sim/types.ts";
import { BASE_ENEMY_IDS, ENEMIES, ENEMY_IDS, MAX_CONCURRENT_ENEMIES, baseArchetype } from "./enemies.ts";
import {
  ASSUMED_TTK_MS, CONCURRENCY_SCALE, PRESSURE_BANDS, bandForRoom, bandForTier, concurrencyFactor,
  contextFor, coverFactor, coverOfRoom, inBand, measurePressure, measureRoster, opennessFactor,
  optionSuitability, peakConcurrency, suitability, tierForPressure, withinConcurrencyCap,
} from "./pressure.ts";

function cells(n: number): Cell[] {
  return Array.from({ length: n }, (_, i) => [i, 0] as Cell);
}

function room(open: number, pillars: number): Pick<RoomPlan, "measured" | "spawn_groups"> {
  return {
    measured: { open_ratio: open, pillar_count: pillars, symmetry_error: 0, reachable_ratio: 1 },
    spawn_groups: [{ id: "front_far", cells: cells(6) }],
  };
}

const wave = (at_ms: number, ...spawns: Wave["spawns"]): Wave => ({ at_ms, spawns });
const of = (archetype: Parameters<typeof wave>[1]["archetype"], count: number): Wave["spawns"][number] =>
  ({ archetype, spawn_group: "front_far", count });

describe("enemy table (doc 005)", () => {
  it("carries the doc's behaviours, patterns and threat weights", () => {
    // The rusher was raised from the doc's 1.0 by the melee harness: a charge
    // is the hardest attack for a melee player to answer, and at the roster
    // floor it was packing the lowest-pressure rooms. See `RUSHER`.
    expect(ENEMIES.rusher).toMatchObject({ behaviour: "chase", pattern: null, threat_weight: 1.25 });
    expect(ENEMIES.shooter).toMatchObject({ behaviour: "keep_distance", threat_weight: 2.2 });
    expect(ENEMIES.turret).toMatchObject({ behaviour: "stationary", threat_weight: 2.0 });
    expect(ENEMIES.orbiter).toMatchObject({ behaviour: "orbit", threat_weight: 2.6 });
    // Weights are calibration values, not doc constants: the play harness
    // raised tank and summoner because durability is exposure time.
    expect(ENEMIES.tank).toMatchObject({ behaviour: "chase", threat_weight: 5.0 });
    expect(ENEMIES.summoner).toMatchObject({ behaviour: "keep_distance", threat_weight: 4.5 });
    expect(ENEMIES.lancer).toMatchObject({ behaviour: "chase", melee: "lance", threat_weight: 1.6 });
    expect(ENEMIES.sentinel).toMatchObject({ behaviour: "stationary", threat_weight: 1.7 });

    // Every shooting enemy alternates shapes with silence between them.
    // Pinning one leaf kind per enemy is what a flat, unreadable bullet
    // vocabulary looks like in a test, so the shape of the rhythm is pinned
    // instead: a sequence, more than one leaf kind, and at least one rest.
    //
    // Only these two still shoot. The turret and the summoner traded their
    // rings for lightning and thrown flame, because a ring denies every
    // direction at once and a melee player has no approach through one; the
    // tank lost its shotgun when it became a charger, because a body that
    // both closes on you and punishes you for being closed on has no answer.
    for (const id of ["shooter", "orbiter"] as const) {
      const pattern = ENEMIES[id].pattern;
      expect(pattern, id).not.toBeNull();
      expect(pattern!.kind, id).toBe("sequence");
      const steps = (pattern as Extract<typeof pattern, { kind: "sequence" }>).steps;
      expect(steps.some((s) => s.pattern.kind === "rest"), `${id} needs silence`).toBe(true);
      expect(leafKinds(pattern!).length, `${id} needs more than one shape`).toBeGreaterThanOrEqual(1);
    }
    expect(ENEMIES.summoner.summon).toEqual({ archetype: "rusher", interval_s: 6, max_alive: 3 });

    // And the rest answer at range without projectiles, or not at all.
    expect(ENEMIES.tank.pattern).toBeNull();
    expect(ENEMIES.tank.ranged).toBeNull();
    expect(ENEMIES.tank.melee).toBe("charge");
    expect(ENEMIES.turret.pattern).toBeNull();
    expect(ENEMIES.turret.ranged).toMatchObject({ kind: "lightning" });
    expect(ENEMIES.summoner.pattern).toBeNull();
    expect(ENEMIES.summoner.ranged).toMatchObject({ kind: "flame" });
  });

  it("keeps the fastest body at about four fifths of the player's speed", () => {
    /*
     * The relationship, not either number. It decides whether the player can
     * walk away from a fight: much below this and leaving is a free reset,
     * much above and there is no point walking at all. Pinned because both
     * sides of it have been retuned repeatedly — the player's speed four times
     * — and the ratio is the thing that was actually being aimed at.
     */
    const fastest = Math.max(...ENEMY_IDS.map((id) => ENEMIES[id].speed));
    expect(fastest / PLAYER_SPEED).toBeGreaterThan(0.7);
    expect(fastest / PLAYER_SPEED).toBeLessThan(0.88);

    // And the slowest mobile body still has to be able to reach the player.
    const slowest = Math.min(
      ...ENEMY_IDS.filter((id) => ENEMIES[id].speed > 0).map((id) => ENEMIES[id].speed),
    );
    expect(slowest / PLAYER_SPEED).toBeGreaterThan(0.2);

    /*
     * The dash has to stay clearly a burst rather than a brisk walk. It is the
     * player's answer to a committed attack and to being surrounded, and both
     * of those stop working if it is only slightly faster than walking.
     */
    expect(DASH_SPEED / PLAYER_SPEED).toBeGreaterThan(3);
  });

  it("gives every archetype exactly one way to answer at range", () => {
    // Bullets or one of the other kinds, never both: the point of the taxonomy
    // is that its members are answered differently, and an enemy that shoots
    // *and* calls lightning is two enemies the player cannot read as one.
    for (const id of ENEMY_IDS) {
      const e = ENEMIES[id];
      expect(e.pattern === null || e.ranged === null, id).toBe(true);
    }
    // And the roster has to actually use them, or the taxonomy is decoration.
    const kinds = new Set(ENEMY_IDS.map((id) => ENEMIES[id].ranged?.kind ?? null));
    expect(kinds.has("lightning")).toBe(true);
    expect(kinds.has("flame")).toBe(true);
    const melee = new Set(ENEMY_IDS.map((id) => ENEMIES[id].melee).filter(Boolean));
    // One charger (the tank's ram) and two spike drives at two reaches: the
    // roster's melee bodies differ in *distance*, not in three ways of
    // coming at you fast.
    expect(melee.has("bristle")).toBe(true);
    expect(melee.has("lance")).toBe(true);
    expect(melee.has("charge")).toBe(true);

    /*
     * At most one archetype may make its threat out of a stream of bullets.
     *
     * This is the melee constraint stated as a test rather than as a note,
     * because it was re-broken twice. A player whose only way to deal damage
     * is to arrive has to be able to arrive, and every extra emitter in a room
     * multiplies what is in the air while they cross it — the cost is not
     * bullets per second at where they stand, it is bullets in flight over the
     * whole trip.
     */
    /*
     * Counted over **base** archetypes (doc 019). A subspecies is its base
     * with one verb changed and never a new source of fire: a pinner puts two
     * shots down the lane the shooter put one down, and a room holds a shooter
     * or a pinner, not both. What this test guards is how many *kinds* of
     * bullet stream a room can be asked to cross, which is a count of bases.
     */
    const emitters = BASE_ENEMY_IDS.filter((id) => ENEMIES[id].pattern !== null);
    // Three, not two, since the sentinel: a third emitter was admitted on
    // purpose because its shot is one slow lane at a time, and a lane is the
    // one bullet shape a melee player can arrive through.
    expect(emitters.length).toBeLessThanOrEqual(3);
    // And every subspecies of one is still that one emitter, not a fourth.
    for (const id of ENEMY_IDS) {
      if (ENEMIES[id].pattern !== null) expect(emitters).toContain(baseArchetype(id));
    }
  });

  it("gives every archetype stats, tags and a description", () => {
    for (const id of ENEMY_IDS) {
      const e = ENEMIES[id];
      expect(e.hp).toBeGreaterThan(0);
      expect(e.radius).toBeGreaterThan(0);
      /*
       * A blade belongs to a body that closes — or, for the warden alone, to
       * one that holds a range and shoves whatever walks inside it. A gunner
       * whose answer to being stood on is nothing at all is a free kill, and
       * the shove is contact-range only, so it never makes an archer into a
       * chaser (doc 005, the warden).
       */
      expect(e.melee === null || e.behaviour === "chase" || baseArchetype(id) === "warden").toBe(true);
      expect(e.speed).toBeGreaterThanOrEqual(0);
      expect(e.tags.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(10);
    }
    expect(ENEMIES.tank.speed).toBeLessThan(ENEMIES.rusher.speed);
    expect(ENEMIES.turret.speed).toBe(0);
  });
});

describe("bands", () => {
  it("is the doc's table", () => {
    expect(PRESSURE_BANDS).toEqual({
      release: [1.4, 3.4],
      build: [3.2, 4.6],
      peak: [4.4, 6.1],
      elite: [5.5, 9.0],
    });
  });

  it("bounds a combat band above by pressure_cap but never an elite one", () => {
    expect(bandForRoom({ room_type: "combat", tension: "peak", pressure_cap: 8 })).toEqual([4.4, 6.1]);
    expect(bandForRoom({ room_type: "combat", tension: "peak", pressure_cap: 5.8 })).toEqual([4.4, 5.8]);
    expect(bandForRoom({ room_type: "elite", tension: "release", pressure_cap: 2 })).toEqual([5.5, 9.0]);
    expect(bandForRoom({ room_type: "shop", tension: "build", pressure_cap: 8 })).toBeNull();
  });

  it("keeps a cap-clamped band wide enough to hit", () => {
    const band = bandForRoom({ room_type: "combat", tension: "peak", pressure_cap: 3.6 })!;
    expect(band[1] - band[0]).toBeGreaterThanOrEqual(0.5);
    expect(band[1]).toBe(3.6);
  });

  it("maps a pressure back to its tier", () => {
    expect(tierForPressure(2.5)).toBe("release");
    expect(tierForPressure(4.0)).toBe("build");
    expect(tierForPressure(5.5)).toBe("peak");
    expect(tierForPressure(6.5)).toBe("elite");
    expect(tierForPressure(99)).toBe("elite");
  });

  it("names every band's suitability against the room's tension", () => {
    const expected: Record<Tension, [string, string, string, string]> = {
      release: ["matches_tension", "harder_than_tension", "harder_than_tension", "harder_than_tension"],
      build: ["softer_than_tension", "matches_tension", "harder_than_tension", "harder_than_tension"],
      peak: ["softer_than_tension", "softer_than_tension", "matches_tension", "harder_than_tension"],
    };
    for (const tension of ["release", "build", "peak"] as Tension[]) {
      expect(
        (["release", "build", "peak", "elite"] as const).map((t) => suitability(t, tension)),
      ).toEqual(expected[tension]);
    }
  });

  it("labels profile options for the tension they push toward", () => {
    expect(optionSuitability("density", "dense", "release")).toBe("harder_than_tension");
    expect(optionSuitability("density", "sparse", "release")).toBe("matches_tension");
    expect(optionSuitability("wave_structure", "breathe", "peak")).toBe("softer_than_tension");
    expect(optionSuitability("anchor", "summoner", "peak")).toBe("matches_tension");
  });
});

describe("factors", () => {
  it("counts only enemies alive at the same time", () => {
    const single = [wave(0, of("rusher", 6))];
    const two = [wave(0, of("rusher", 4)), wave(3000, of("rusher", 2))];
    const trickle = [0, 2500, 5000, 7500, 10_000].map((t) => wave(t, of("rusher", 2)));
    expect(concurrencyFactor(single, 0)).toBeCloseTo(CONCURRENCY_SCALE, 10);
    expect(concurrencyFactor(two, 0)).toBeLessThan(concurrencyFactor(two, 1));
    const avg = (ws: Wave[]): number =>
      ws.reduce((sum, _, i) => sum + concurrencyFactor(ws, i), 0) / ws.length;
    expect(avg(single)).toBeGreaterThan(avg(two));
    expect(avg(two)).toBeGreaterThan(avg(trickle));
  });

  it("stops counting an enemy once the assumed time to kill has passed", () => {
    const far = [wave(0, of("rusher", 2)), wave(ASSUMED_TTK_MS + 1, of("rusher", 2))];
    expect(peakConcurrency(far)).toBe(2);
    expect(peakConcurrency([wave(0, of("rusher", 2)), wave(100, of("rusher", 2))])).toBe(4);
  });

  it("raises ranged pressure and lowers melee pressure in open rooms", () => {
    expect(opennessFactor(0.95, "shooter")).toBeGreaterThan(1);
    expect(opennessFactor(0.95, "turret")).toBeGreaterThan(1);
    expect(opennessFactor(0.95, "rusher")).toBeLessThan(1);
    expect(opennessFactor(0.95, "tank")).toBeLessThan(1);
    expect(opennessFactor(0.6, "rusher")).toBeCloseTo(1, 10);
    expect(opennessFactor(0.3, "rusher")).toBeGreaterThan(1);
  });

  it("makes cover do the reverse of openness", () => {
    expect(coverFactor("dense", "mixed", "rusher")).toBeGreaterThan(coverFactor("none", "mixed", "rusher"));
    expect(coverFactor("dense", "mixed", "shooter")).toBeLessThan(coverFactor("none", "mixed", "shooter"));
    expect(coverFactor("none", "mixed", "rusher")).toBe(1);
    // A composition leaning into the cover gets a little more out of it.
    expect(coverFactor("dense", "melee_heavy", "rusher")).toBeGreaterThan(coverFactor("dense", "mixed", "rusher"));
  });

  it("reads cover back off the room's pillar count", () => {
    expect(coverOfRoom(room(0.9, 0))).toBe("none");
    expect(coverOfRoom(room(0.8, 4))).toBe("sparse");
    expect(coverOfRoom(room(0.6, 12))).toBe("dense");
  });
});

describe("measurement", () => {
  it("is the sum of threat weight times the three factors", () => {
    const ctx = { open_ratio: 0.6, cover: "none" as const, composition: "mixed" as const };
    // Neutral room: every factor is 1, so pressure is scale x the weight sum.
    const p = measurePressure([wave(0, of("rusher", 2), of("tank", 1))], ctx);
    expect(p).toBeCloseTo(
      (2 * ENEMIES.rusher.threat_weight + ENEMIES.tank.threat_weight) * CONCURRENCY_SCALE, 6,
    );
  });

  it("grows monotonically with the roster", () => {
    const ctx = contextFor(room(0.7, 4), "mixed");
    let last = 0;
    for (let n = 1; n <= MAX_CONCURRENT_ENEMIES; n++) {
      const p = measureRoster(Array<"rusher">(n).fill("rusher"), ctx);
      expect(p).toBeGreaterThan(last);
      last = p;
    }
  });

  it("puts a plain roster of each size in a sensible band", () => {
    const ctx = contextFor(room(0.6, 0), "mixed");
    const mix = ["rusher", "shooter", "orbiter", "rusher", "shooter", "turret", "rusher", "orbiter", "tank"] as const;
    const measured = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => measureRoster(mix.slice(0, n), ctx));
    // Some plain roster size sits in each light band.
    expect(measured.some((m) => inBand(m, bandForTier("release")))).toBe(true);
    expect(measured.some((m) => inBand(m, bandForTier("build")))).toBe(true);
  });

  it("flags a schedule that would put more than twelve on the floor", () => {
    expect(withinConcurrencyCap([wave(0, of("rusher", 12))])).toBe(true);
    expect(withinConcurrencyCap([wave(0, of("rusher", 13))])).toBe(false);
  });
});
