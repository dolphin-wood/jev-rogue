import { describe, it, expect } from "vitest";
import { createWorld, step } from "./world.ts";
import { NO_INPUT, PLAYER_RADIUS } from "./types.ts";
import type { World } from "./types.ts";
import {
  FIRE_ENEMY_DAMAGE, FIRE_LIFETIME_MS, FIRE_POOL, FIRE_RADIUS, FIRE_TICK_MS,
  SCORCH_LIFETIME_MS, SCORCH_POOL, fireProgress, lightFire, scorch,
  scorchProgress, stepFires, stepScorches,
} from "./fire.ts";
import { makeEnemy } from "./enemy.ts";
import { acquire } from "./bullets.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";

const src = new RngSource("fire-test");

function world(): World {
  const g = generateRoom(
    { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "combat", src.stream("room"), { plain: true },
  );
  const w = createWorld({
    room: toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" }),
    encounter: null,
    staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), null, null, null, null, null],
    hearts: 6, rng: src.stream("world"),
  });
  w.player.x = 336;
  w.player.y = 208;
  return w;
}

describe("burning ground", () => {
  it("burns for its lifetime and then goes out", () => {
    const w = world();
    lightFire(w, 100, 100);
    expect(w.fires.filter((f) => f.alive)).toHaveLength(1);
    for (let i = 0; i < Math.ceil(FIRE_LIFETIME_MS / 16) + 4; i++) stepFires(w, 16);
    expect(w.fires.filter((f) => f.alive)).toHaveLength(0);
  });

  it("reports the player as burning only while they stand in it", () => {
    const w = world();
    lightFire(w, w.player.x, w.player.y);
    // The first tick fires immediately.
    expect(stepFires(w, FIRE_TICK_MS).playerBurning).toBe(true);
    w.player.x += FIRE_RADIUS * 3;
    expect(stepFires(w, FIRE_TICK_MS).playerBurning).toBe(false);
  });

  it("damages enemies as well as the player, so the terrain is a tool", () => {
    const w = world();
    const e = makeEnemy(1, "rusher", 200, 200, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    const before = e.hp;
    lightFire(w, e.x, e.y);
    for (let i = 0; i < 40; i++) step(w, NO_INPUT);
    expect(e.hp).toBeLessThan(before);
    expect(before - e.hp).toBeGreaterThanOrEqual(FIRE_ENEMY_DAMAGE);
  });

  it("ticks on a cadence rather than every frame", () => {
    /*
     * Measured on an enemy: the player's exposure is now read every step,
     * because it feeds a gauge that fills by the second, while damage to
     * bodies stays on the tick.
     */
    const w = world();
    const e = makeEnemy(1, "rusher", w.player.x + 200, w.player.y, []);
    e.spawnFadeMs = 0;
    w.enemies.push(e);
    lightFire(w, e.x, e.y);
    let burns = 0;
    // One second of steps; at a 520 ms cadence that is two or three ticks.
    for (let i = 0; i < 60; i++) if (stepFires(w, 16.67).enemies.length > 0) burns++;
    expect(burns).toBeGreaterThan(0);
    expect(burns).toBeLessThan(5);
  });

  it("caps how much ground can burn, reusing the oldest patch", () => {
    const w = world();
    for (let i = 0; i < FIRE_POOL + 6; i++) lightFire(w, 64 + i * 3, 64);
    expect(w.fires.filter((f) => f.alive).length).toBeLessThanOrEqual(FIRE_POOL);
    // And the cap does not silently drop the newest request.
    expect(w.fires.some((f) => f.alive && f.x === 64 + (FIRE_POOL + 5) * 3)).toBe(true);
  });

  it("reports its progress so the renderer can fade it out", () => {
    const w = world();
    const f = lightFire(w, 100, 100);
    expect(fireProgress(f)).toBeCloseTo(0, 2);
    stepFires(w, FIRE_LIFETIME_MS / 2);
    expect(fireProgress(f)).toBeGreaterThan(0.4);
    expect(fireProgress(f)).toBeLessThan(0.6);
  });
});

describe("a thrown flame", () => {
  it("lights the ground where its bullet stops", () => {
    const w = world();
    const b = acquire(w.enemyBullets, false);
    expect(b).not.toBeNull();
    b!.alive = true;
    b!.x = 300;
    b!.y = 200;
    b!.vx = 0;
    b!.vy = 0;
    b!.radius = 5;
    b!.lifeMs = 20;
    b!.leavesFire = true;
    for (let i = 0; i < 6; i++) step(w, NO_INPUT);
    const lit = w.fires.filter((f) => f.alive);
    expect(lit).toHaveLength(1);
    expect(lit[0]!.x).toBeCloseTo(300, 0);
  });

  it("leaves nothing when the bullet is an ordinary one", () => {
    const w = world();
    const b = acquire(w.enemyBullets, false);
    b!.alive = true;
    b!.x = 300;
    b!.y = 200;
    b!.vx = 0;
    b!.vy = 0;
    b!.radius = 5;
    b!.lifeMs = 20;
    b!.leavesFire = false;
    for (let i = 0; i < 6; i++) step(w, NO_INPUT);
    expect(w.fires.filter((f) => f.alive)).toHaveLength(0);
  });

  it("fills the fire gauge for lingering and costs nothing for touching", () => {
    /*
     * Fire is a status now, not a heart on a clock: standing in it fills a
     * gauge, a full gauge ignites, and burning drains health for a while. A
     * crossing shows a rising bar and nothing else.
     */
    const brief = world();
    lightFire(brief, brief.player.x, brief.player.y);
    const before = brief.player.hearts;
    for (let i = 0; i < 12; i++) step(brief, NO_INPUT);
    expect(brief.player.hearts).toBe(before);
    expect(brief.player.burnBuild).toBeGreaterThan(0);
    expect(brief.player.burnMs).toBe(0);

    const linger = world();
    lightFire(linger, linger.player.x, linger.player.y);
    for (let i = 0; i < 150; i++) step(linger, NO_INPUT);
    expect(linger.player.burnMs).toBeGreaterThan(0);
    expect(linger.player.hearts).toBeLessThan(before);
    // A status, not a hit: well under a heart in the first second of burning.
    expect(before - linger.player.hearts).toBeLessThan(1);
  });
});

describe("the floor remembers", () => {
  it("leaves a mark where a fire burned out", () => {
    const w = world();
    lightFire(w, 200, 150);
    expect(w.scorches.filter((s) => s.alive)).toHaveLength(0);
    for (let i = 0; i < Math.ceil(FIRE_LIFETIME_MS / 16) + 4; i++) stepFires(w, 16);
    const marks = w.scorches.filter((s) => s.alive);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.x).toBeCloseTo(200, 0);
  });

  it("fades the mark rather than keeping it for the room", () => {
    const w = world();
    scorch(w, 100, 100, FIRE_RADIUS);
    const s = w.scorches.find((x) => x.alive)!;
    expect(scorchProgress(s)).toBeCloseTo(0, 2);
    stepScorches(w, SCORCH_LIFETIME_MS / 2);
    expect(scorchProgress(s)).toBeGreaterThan(0.4);
    stepScorches(w, SCORCH_LIFETIME_MS);
    expect(s.alive).toBe(false);
  });

  it("outlives the fire that made it several times over", () => {
    expect(SCORCH_LIFETIME_MS).toBeGreaterThan(FIRE_LIFETIME_MS * 2);
  });

  it("caps the marks so a busy room is not paved with them", () => {
    const w = world();
    for (let i = 0; i < SCORCH_POOL + 8; i++) scorch(w, 64 + i * 3, 64, FIRE_RADIUS);
    expect(w.scorches.filter((s) => s.alive).length).toBeLessThanOrEqual(SCORCH_POOL);
  });

  it("has no gameplay effect: standing on a mark is free", () => {
    const w = world();
    scorch(w, w.player.x, w.player.y, FIRE_RADIUS);
    const before = w.player.hearts;
    for (let i = 0; i < 120; i++) step(w, NO_INPUT);
    expect(w.player.hearts).toBe(before);
  });
});
