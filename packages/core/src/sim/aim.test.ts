import { describe, it, expect } from "vitest";
import { assistAim, turnToward, angleDelta, ASSIST_CONE_DEG, ASSIST_RANGE } from "./aim.ts";
import { createWorld } from "./world.ts";
import { makeEnemy } from "./enemy.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { staffFor, plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import type { World } from "./types.ts";

const src = new RngSource("aim");

function world(): World {
  const g = generateRoom(
    { space: "open_arena", symmetry: "mirrored", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "combat", src.stream("room"), { plain: true },
  );
  return createWorld({
    room: toRoomPlan(g, { id: "a", seed_key: "a", reward_kind: "item", params_source: "rule" }),
    encounter: null,
    staff: staffFor({ slots: "many", mana: "high", tempo: "steady", special: "none" }),
    slots: [plainInstance("magic_bolt"), null, null, null, null, null],
    hearts: 6, rng: src.stream("w"),
  });
}

/** Degrees between two unit vectors. */
function degBetween(ax: number, ay: number, bx: number, by: number): number {
  return (Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180) / Math.PI;
}

describe("aim assist", () => {
  it("does nothing when no enemy is near the shot", () => {
    const w = world();
    const r = assistAim(w, 100, 100, 1, 0);
    expect(r.assisted).toBe(false);
    expect([r.x, r.y]).toEqual([1, 0]);
  });

  it("bends a near miss toward the target", () => {
    const w = world();
    const e = makeEnemy(1, "shooter", 300, 120, []);
    e.spawnFadeMs = 0;
    w.enemies.push(e);
    // Firing due east from (100,100): the enemy is a few degrees off.
    const before = degBetween(1, 0, e.x - 100, e.y - 100);
    const r = assistAim(w, 100, 100, 1, 0);
    expect(r.assisted).toBe(true);
    const after = degBetween(r.x, r.y, e.x - 100, e.y - 100);
    expect(after).toBeLessThan(before);
    // It closes most of the gap but never all of it: the player still aims.
    expect(after).toBeGreaterThan(0);
  });

  it("refuses a target outside the cone, so it is not an auto-aim", () => {
    const w = world();
    const e = makeEnemy(1, "shooter", 200, 400, []);
    e.spawnFadeMs = 0;
    w.enemies.push(e);
    const off = degBetween(1, 0, e.x - 100, e.y - 100);
    expect(off).toBeGreaterThan(ASSIST_CONE_DEG * 2);
    expect(assistAim(w, 100, 100, 1, 0).assisted).toBe(false);
  });

  it("refuses a target beyond range, and one still fading in", () => {
    const w = world();
    const far = makeEnemy(1, "shooter", 100 + ASSIST_RANGE + 50, 100, []);
    far.spawnFadeMs = 0;
    w.enemies.push(far);
    expect(assistAim(w, 100, 100, 1, 0).assisted).toBe(false);

    w.enemies.length = 0;
    const fading = makeEnemy(2, "shooter", 300, 100, []);
    w.enemies.push(fading);
    expect(assistAim(w, 100, 100, 1, 0).assisted).toBe(false);
  });

  it("widens the cone for a wide body, which is easier to hit anyway", () => {
    const w = world();
    const tank = makeEnemy(1, "tank", 300, 148, []);
    tank.spawnFadeMs = 0;
    w.enemies.push(tank);
    const withTank = assistAim(w, 100, 100, 1, 0).assisted;

    w.enemies.length = 0;
    const rusher = makeEnemy(2, "rusher", 300, 148, []);
    rusher.spawnFadeMs = 0;
    w.enemies.push(rusher);
    const withRusher = assistAim(w, 100, 100, 1, 0).assisted;

    expect(withTank).toBe(true);
    expect([withTank, withRusher]).not.toEqual([false, true]);
  });

  it("prefers the enemy closest to the line, not the closest enemy", () => {
    const w = world();
    const nearButOff = makeEnemy(1, "shooter", 180, 118, []);
    const farButOn = makeEnemy(2, "shooter", 400, 101, []);
    nearButOff.spawnFadeMs = 0;
    farButOn.spawnFadeMs = 0;
    w.enemies.push(nearButOff, farButOn);
    const r = assistAim(w, 100, 100, 1, 0);
    expect(r.assisted).toBe(true);
    expect(degBetween(r.x, r.y, farButOn.x - 100, farButOn.y - 100))
      .toBeLessThan(degBetween(r.x, r.y, nearButOff.x - 100, nearButOff.y - 100));
  });
});

describe("turning", () => {
  it("never snaps, and arrives", () => {
    let facing = 0;
    const target = Math.PI;
    const first = turnToward(facing, target, 16.67);
    expect(first).not.toBe(target);
    expect(Math.abs(first)).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) facing = turnToward(facing, target, 16.67);
    expect(Math.abs(angleDelta(facing, target))).toBeLessThan(1e-6);
  });

  it("takes the short way round the wrap", () => {
    const facing = 3.0;
    const target = -3.0;
    const next = turnToward(facing, target, 16.67);
    // Going the short way increases the angle past pi and wraps, it does not
    // sweep back down through zero.
    expect(next).toBeGreaterThan(facing);
  });

  it("snaps only when already within one step", () => {
    expect(turnToward(1.0, 1.0001, 16.67)).toBe(1.0001);
  });
});
