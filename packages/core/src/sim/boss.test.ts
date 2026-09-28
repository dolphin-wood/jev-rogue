/**
 * The shapes the docs describe, asserted rather than left to the bench: the
 * boss costs the same at every moment of the fight (no enrage, doc 020), and
 * the run-progress ramp scales the late rooms and not the opening.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step } from "./world.ts";
import { BOSS_POWER, ENEMY_HP_SCALE, makeEnemy } from "./enemy.ts";
import { NO_INPUT, noMods } from "./types.ts";
import { throneHall } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import { rampFor } from "../encounters/ramp.ts";
import { ENEMIES } from "../encounters/enemies.ts";

describe("the boss's cost", () => {
  it("is the same early and late in the fight, and in every phase: nothing climbs with the clock", () => {
    const seen = new Set<number>();
    for (const [fightMs, phase] of [[0, 1], [60_000, 1], [180_000, 2], [600_000, 3]] as const) {
      const w = createWorld({
        room: throneHall(), encounter: null, props: 0, staff: { slots: 6, mana_max: 120 }, mods: noMods(),
        slots: [plainInstance("magic_bolt"), null, null, null, null, null], hearts: 6, rng: new RngSource("cost").stream("w"),
      });
      const b = makeEnemy(w.nextEnemyId++, "boss", 368, 200, []);
      b.spawnFadeMs = 0; b.awake = true; b.bossFightMs = fightMs; b.phase = phase;
      w.enemies.push(b);
      step(w, NO_INPUT);
      seen.add(b.damageMult);
    }
    /*
     * One value across every clock and every phase: **nothing climbs with the
     * fight**. It is his own figure times the boss band's `power`, because the
     * king takes the run-progress ramp's late damage like any other body — the
     * band was always written to apply to him ("only the beat is the boss's")
     * and it is what holds his blows against the bar levels grow. That is a
     * fact about the *room*, fixed before the first frame, which is exactly
     * the distinction this test exists to keep.
     */
    expect([...seen]).toEqual([BOSS_POWER * rampFor(99).power]);
  });
});

describe("the run-progress ramp's late half", () => {
  it("holds the opening at the column's floor and scales the late ones", () => {
    /*
     * The opening rooms used to sit at ×1 on both figures. Health no longer
     * does — the whole column was raised when the fights measured too easy
     * against the fitted `player` profile — but it is still **flat** across
     * them, which is what "the opening is the opening" means here, and what a
     * body *hits* for is still untouched until the mid run.
     */
    const floor = rampFor(1).hp;
    for (const i of [1, 2, 3]) {
      expect(rampFor(i).hp, `room ${i}`).toBe(floor);
      expect(rampFor(i).power, `room ${i}`).toBe(1);
    }
    // And from there every room a little more than the last, not a step every few rooms (`rampFor`).
    for (let i = 4; i <= 14; i++) {
      expect(rampFor(i).hp, `room ${i}`).toBeGreaterThan(rampFor(i - 1).hp);
      expect(rampFor(i).power, `room ${i}`).toBeGreaterThan(rampFor(i - 1).power);
    }
    // Health moves further than damage: a hit that costs more is a hit that
    // costs more whether or not it was readable.
    expect(rampFor(14).hp).toBeGreaterThan(rampFor(14).power);
  });

  it("makes a late-run body worth more than the same body early", () => {
    const early = makeEnemy(1, "rusher", 0, 0, [], rampFor(2));
    const late = makeEnemy(2, "rusher", 0, 0, [], rampFor(14));
    // The roster carries one global scale on top of its own figures, and the
    // ramp's own multiplier on top of that — which is no longer 1 in the
    // opening rooms: the whole `hp` column was raised when the fights measured
    // too easy against the fitted `player` profile.
    expect(early.maxHp).toBeCloseTo(ENEMIES.rusher.hp * ENEMY_HP_SCALE * rampFor(2).hp, 5);
    expect(late.maxHp).toBeCloseTo(ENEMIES.rusher.hp * ENEMY_HP_SCALE * rampFor(14).hp, 5);
    expect(late.hp).toBe(late.maxHp);
    expect(late.damageMult).toBeCloseTo(rampFor(14).power, 5);
    expect(early.damageMult).toBe(1);
  });
});
