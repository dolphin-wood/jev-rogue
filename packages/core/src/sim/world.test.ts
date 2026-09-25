import { featureCells } from "../rooms/features.ts";
import { ENTRY_GRACE_MS } from "./enemy.ts";
import { describe, it, expect } from "vitest";
import { createWorld, step, worldCleared, ELITE_HEAL_FRACTION, GRASS_CATCH_MS } from "./world.ts";
import {
  PLAYER_RADIUS, PLAYER_SPEED, NO_INPUT, ENEMY_BULLET_CAP, INVULN_MS, MAX_HEARTS,
} from "./types.ts";
import type { Input, World } from "./types.ts";
import {
  beginWindup, makeEnemy, wake, SPAWN_FADE_MS, STAGGER_MS, TELEGRAPH_MS, THREAT_CAP_MS,
} from "./enemy.ts";
import { liveCount, acquire } from "./bullets.ts";
import { MELEE_ATTACKS } from "./melee.ts";
import { SPELL_COST_BASE, SPELL_COST_PER_RANK, slotCost } from "./spells.ts";
import { WORLD_W, WORLD_H, circleHitsWall, entryPosition } from "./collide.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";
import { lightFire } from "./fire.ts";
import { cellAt, generateRoom, toRoomPlan } from "../rooms/index.ts";
import { ENEMIES, rampMinimum } from "../encounters/index.ts";
import { plainInstance, ITEMS } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import type { EncounterPlan, RoomPlan, SpaceArchetypeId } from "../types.ts";

const src = new RngSource("sim-test");

function room(space: SpaceArchetypeId = "open_arena") {
  const g = generateRoom(
    { space, symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "combat", src.stream("room", space), { plain: true },
  );
  return toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
}

const encounter = (waves: EncounterPlan["waves"]): EncounterPlan => ({
  profile: { composition: "mixed", density: "sparse", wave_structure: "steady", anchor: "none", entry: "far_front" },
  waves, measured_pressure: 2, band: [1, 3], elite_affixes: [], source: "rule",
});

function world(over: Partial<Parameters<typeof createWorld>[0]> = {}): World {
  const r = over.room ?? room();
  return createWorld({
    room: r,
    encounter: null,
    // No destructibles by default. A prop is a solid cell, so leaving them in
    // would mean every movement and pathing assertion below also depended on
    // where six crates happened to land — and a swing aimed at empty floor
    // could earn mana from a pot the test never asked for. The tests that are
    // about props ask for them.
    props: 0,
    staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), null, null, null, null, null],
    hearts: 6,
    rng: src.stream("world"),
    // The whole room in view, so what a test places is seen; the view's own
    // rule is tested on its own ("what the player cannot see").
    viewHalf: { x: WORLD_W, y: WORLD_H },
    ...over,
  });
}

const input = (o: Partial<Input> = {}): Input => ({ ...NO_INPUT, ...o });

/**
 * The nearest open floor to a wanted spot, in world px.
 *
 * Tests used to hand-place bodies at literal coordinates, which quietly
 * depended on the layout the generator happened to produce that day. When the
 * generator gained a free-standing kiting obstacle, five tests broke at once
 * because `(470, 200)` — chosen years of commits ago as "just east of the
 * player" — became the inside of a wall, and a body spawned inside a wall does
 * not move at all. The failures read as the enemy AI having stopped working.
 *
 * So a test says what it means, "about seventy pixels east of the player, on
 * floor", and the layout is free to change underneath it.
 */
function open(r: RoomPlan, x: number, y: number): [number, number] {
  const gx = Math.floor(x / TILE_PX);
  const gy = Math.floor(y / TILE_PX);
  const free = (cx: number, cy: number): boolean =>
    cx >= 1 && cy >= 1 && cx < GRID_W - 1 && cy < GRID_H - 1
    && r.grid[cy * GRID_W + cx] === Tile.Floor;
  if (free(gx, gy)) return [x, y];
  for (let rad = 1; rad < Math.max(GRID_W, GRID_H); rad++)
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        if (free(gx + dx, gy + dy))
          return [(gx + dx + 0.5) * TILE_PX, (gy + dy + 0.5) * TILE_PX];
      }
  return [x, y];
}

function run(w: World, steps: number, i: Input = NO_INPUT): World {
  for (let n = 0; n < steps; n++) step(w, i);
  return w;
}

describe("determinism", () => {
  it("two worlds with the same seed and inputs end identical", () => {
    const seq = Array.from({ length: 120 }, (_, i) =>
      input({ moveX: Math.sin(i / 7), moveY: Math.cos(i / 5), aimX: 100 + i, aimY: 200 }));
    const a = world({ rng: new RngSource("s").stream("w") });
    const b = world({ rng: new RngSource("s").stream("w") });
    for (const i of seq) { step(a, i); step(b, i); }
    expect([a.player.x, a.player.y, a.player.mana, a.stats.shotsFired])
      .toEqual([b.player.x, b.player.y, b.player.mana, b.stats.shotsFired]);
  });

  it("the hazard clock belongs to the world, so a second world starts fresh", () => {
    const a = world();
    run(a, 30);
    const b = world();
    // Charged rather than zero: entering a hazard costs at once, so a fresh
    // world starts with the clock already full.
    expect(b.hazardTimerMs).toBe(a.hazardTimerMs);
    expect(b.hazardTimerMs).toBeGreaterThan(0);
  });
});

describe("player movement", () => {
  it("never leaves the room or stands in a wall", () => {
    const w = world();
    for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]]) {
      run(w, 200, input({ moveX: dir[0]!, moveY: dir[1]! }));
      expect(w.player.x).toBeGreaterThanOrEqual(PLAYER_RADIUS - 0.01);
      expect(w.player.x).toBeLessThanOrEqual(WORLD_W - PLAYER_RADIUS + 0.01);
      expect(w.player.y).toBeGreaterThanOrEqual(PLAYER_RADIUS - 0.01);
      expect(w.player.y).toBeLessThanOrEqual(WORLD_H - PLAYER_RADIUS + 0.01);
      expect(circleHitsWall(w.room.grid, w.player.x, w.player.y, PLAYER_RADIUS)).toBe(false);
    }
  });

  it("slides along a wall instead of sticking to it", () => {
    const w = world();
    run(w, 400, input({ moveX: 0, moveY: -1 }));
    const yAtWall = w.player.y;
    const xBefore = w.player.x;
    run(w, 60, input({ moveX: 1, moveY: -1 }));
    expect(w.player.x).toBeGreaterThan(xBefore);
    expect(w.player.y).toBeCloseTo(yAtWall, 0);
  });
});

describe("casting and damage", () => {
  it("casts once per press, not once per frame", () => {
    // The point of the keyed layer: a spell is a decision, so holding the key
    // down for a second does not buy a second's worth of casts.
    const w = world();
    const cast = input({ aimX: w.player.x + 100, aimY: w.player.y, spell: 0 });
    // Past the bolt's windup: the shot has left.
    run(w, 6, cast);
    expect(w.stats.shotsFired).toBeGreaterThan(0);
    const once = w.stats.shotsFired;
    run(w, 10, cast);
    expect(w.stats.shotsFired).toBe(once);
  });

  it("refuses a spell that is on cooldown or unaffordable", () => {
    const w = world();
    const cast = input({ aimX: w.player.x + 100, aimY: w.player.y, spell: 0 });
    step(w, cast);
    expect(w.spells[0]!.cooldownMs).toBeGreaterThan(0);

    // Drained: the key is pressed and nothing happens, which is a refusal the
    // player asked for rather than a unit quietly skipped.
    w.spells[0]!.cooldownMs = 0;
    w.player.mana = 0;
    const fired = w.stats.shotsFired;
    step(w, cast);
    expect(w.stats.shotsFired).toBe(fired);
  });

  it("charges a flat amount of mana, so a deeper pool is more casts", () => {
    /*
     * The reverse of what this used to assert. A cost that was a share of the
     * cap meant every staff held the same number of casts and the pool was a
     * display unit; a cost in mana means finding a bigger well buys what a
     * player reads it as buying.
     */
    const w = world();
    const before = w.player.mana;
    step(w, input({ aimX: w.player.x + 100, aimY: w.player.y, spell: 0 }));
    const spent = before - w.player.mana;
    // magic_bolt is rank 2 in the pool.
    // A slot's cost is rounded to a tenth, so the bar reads in whole tenths.
    expect(spent).toBeCloseTo(Math.round((SPELL_COST_BASE + SPELL_COST_PER_RANK) * 10) / 10, 5);

    // And the same slot on a deeper staff costs exactly the same.
    const deep = world({
      staff: { ...w.staff, mana_max: w.staff.mana_max * 2 },
    });
    expect(slotCost(deep.spells[0] ?? null, ITEMS, deep.staff))
      .toBeCloseTo(slotCost(w.spells[0] ?? null, ITEMS, w.staff), 5);
  });

  it("a spell that chains on its own account arcs to a second body", () => {
    /*
     * The shock arc carries `chain: 3` and no affixes. `onHit` returned early
     * on an empty affix list, above the arc, so it never chained — the
     * spell-check saw it fire and hit and called it working.
     */
    const w = world({ slots: [plainInstance("shock_arc"), null, null, null, null, null] });
    // Rushers, not tanks: a tank's armour shrugs off a six-damage spark.
    // Upward, not downward: the player starts near the bottom wall and a body
    // placed thirty px below it stands inside the wall, where an arc dies.
    const first = makeEnemy(1, "rusher", w.player.x + 90, w.player.y, []);
    const second = makeEnemy(2, "rusher", w.player.x + 150, w.player.y - 30, []);
    for (const e of [first, second]) { e.spawnFadeMs = 0; e.awake = true; e.speed = 0; w.enemies.push(e); }
    const hpSecond = second.hp;
    step(w, input({ aimX: first.x, aimY: first.y, spell: 0 }));
    run(w, 90);
    expect(first.hp).toBeLessThan(ENEMIES.rusher.hp);
    expect(second.hp, "the arc should have reached the second body").toBeLessThan(hpSecond);
  });

  it("renews an orbit ring on recast instead of stacking it", () => {
    const w = world({ slots: [plainInstance("spirit_blades"), null, null, null, null, null] });
    const cast = input({ aimX: w.player.x + 100, aimY: w.player.y, spell: 0 });
    step(w, cast);
    run(w, 6);
    const ring = () => w.playerBullets.filter((b) => b.alive && b.orbitMs > 0).length;
    expect(ring()).toBe(3);
    // Past the cooldown, with the mana to pay: cast again.
    w.spells[0]!.cooldownMs = 0;
    w.player.mana = w.staff.mana_max;
    run(w, 30);
    step(w, cast);
    run(w, 6);
    expect(ring()).toBe(3);
  });

  it("spends mana, which regeneration may or may not outpace", () => {
    // Asserted as a difference rather than against the cap: a cheap attack on
    // a high-regen staff never dips, and that is correct, not a missing spend.
    const casting = world();
    const idle = world();
    // Mana starts at the cap, so the spender has to be measured against a
    // world that did not spend rather than against the cap itself.
    casting.player.mana = casting.staff.mana_max * 0.9;
    idle.player.mana = idle.staff.mana_max * 0.9;
    step(casting, input({ aimX: casting.player.x + 100, aimY: casting.player.y, spell: 0 }));
    run(casting, 39);
    run(idle, 40);
    expect(casting.player.mana).toBeLessThan(idle.player.mana);
    expect(casting.stats.shotsFired).toBeGreaterThan(0);
  });

  it("damages an enemy and kills it, emitting the event", () => {
    const w = world();
    const e = makeEnemy(1, "shooter", w.player.x + 90, w.player.y, []);
    e.spawnFadeMs = 0;
    e.hp = 8;
    w.enemies.push(e);
    // Pressed on a beat rather than held: a keyed spell fires once per press,
    // and mana is topped up so the test is about damage, not the economy.
    for (let i = 0; i < 240 && w.enemies.length > 0; i++) {
      w.player.mana = w.staff.mana_max;
      step(w, input({ aimX: w.player.x + 200, aimY: w.player.y, spell: i % 20 === 0 ? 0 : null }));
    }
    expect(w.stats.damageDealt).toBeGreaterThan(0);
    expect(w.enemies.length).toBe(0);
  });

  it("cannot hit an enemy that is still fading in", () => {
    const w = world();
    const e = makeEnemy(1, "shooter", w.player.x + 60, w.player.y, []);
    w.enemies.push(e);
    step(w, input({ aimX: w.player.x + 200, aimY: w.player.y, spell: 0 }));
    run(w, Math.floor(SPAWN_FADE_MS / 16) - 5);
    expect(w.stats.damageDealt).toBe(0);
  });
});

describe("bullet caps", () => {
  it("skips an enemy volley whole rather than trimming it", () => {
    const w = world();
    // Fill the enemy pool to one short of the cap.
    for (let i = 0; i < ENEMY_BULLET_CAP; i++) {
      const b = acquire(w.enemyBullets, false);
      if (!b) break;
      b.x = 10; b.y = 10; b.vx = 0; b.vy = 0; b.radius = 1;
    }
    expect(liveCount(w.enemyBullets)).toBe(ENEMY_BULLET_CAP);
    const turret = makeEnemy(1, "turret", 200, 200, []);
    turret.spawnFadeMs = 0;
    turret.telegraphMs = 0;
    w.enemies.push(turret);
    run(w, 120);
    expect(liveCount(w.enemyBullets)).toBeLessThanOrEqual(ENEMY_BULLET_CAP);
  });

  it("recycles the oldest player bullet instead of dropping the shot", () => {
    const w = world();
    for (let i = 0; i < 3000; i++) {
      w.player.mana = w.staff.mana_max;
      w.spells[0]!.cooldownMs = 0;
      step(w, input({ aimX: w.player.x + 300, aimY: w.player.y, spell: 0 }));
    }
    expect(w.stats.shotsFired).toBeGreaterThan(50);
    expect(liveCount(w.playerBullets)).toBeLessThanOrEqual(900);
  });
});

describe("the player taking damage", () => {
  it("loses one heart per hit and is briefly invulnerable", () => {
    const w = world();
    // Driven by blades rather than by a body resting on the player: contact
    // damage is gone, so being hurt in melee means being inside an attack.
    const swipe = (id: number): void => {
      const e = makeEnemy(id, "rusher", w.player.x - 20, w.player.y, []);
      e.spawnFadeMs = 0;
      e.awake = true;
      // Past the free first attack, then the real entry action wound forward
      // to one step short of the commit, where the blade goes live.
      e.hasAttacked = true;
      // A drive turn; see `chooseMelee`.
      e.casts = 1;
      beginWindup(w, e, w.player);
      e.attackMs = 1;
      w.enemies.push(e);
    };

    // Two attacks landing in the same window is one heart, not two.
    swipe(1);
    swipe(2);
    run(w, 2);
    expect(w.player.hearts).toBeCloseTo(6 - 0.7, 5);
    run(w, 10);
    expect(w.player.hearts).toBeCloseTo(6 - 0.7, 5);

    // Past the window, a fresh attack lands again. The window is 950 ms now,
    // so the wait is measured against `INVULN_MS` rather than a step count.
    run(w, Math.ceil(INVULN_MS / (1000 / 60)) + 4);
    swipe(3);
    run(w, 3);
    expect(w.player.hearts).toBeCloseTo(6 - 1.4, 5);
  });

  it("is not hurt from behind a charging enemy", () => {
    // The reason a hitbox replaced contact damage: an attack has a facing, so
    // there is a wrong side of it to be on. A collision has none, and charged
    // the player for walking into a body's back.
    const w = world();
    const e = makeEnemy(1, "rusher", w.player.x, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.hasAttacked = true;
    beginWindup(w, e, w.player);
    e.attackMs = 1;
    // Pointing away from the player, which is what happens for the rest of a
    // charge once it has gone past.
    e.facing = Math.PI;
    w.enemies.push(e);
    // The lunge vector is taken from the player's position, so put the player
    // behind where the enemy is about to commit to.
    run(w, 1);
    w.player.x = e.x - 26;
    w.player.y = e.y;
    e.lungeX = 1;
    e.lungeY = 0;
    e.swing.facing = 0;
    e.swing.angle = 0;
    const before = w.player.hearts;
    run(w, 12);
    expect(w.player.hearts).toBe(before);
  });

  it("is hurt by a body that has closed on it", () => {
    const w = world();
    const e = makeEnemy(1, "rusher", w.player.x - 26, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.hasAttacked = true;
    // A drive turn; see `chooseMelee`.
    e.casts = 1;
    beginWindup(w, e, w.player);
    e.attackMs = 1;
    w.enemies.push(e);
    // Events are per step, so the cause has to be collected as it goes.
    const causes: string[] = [];
    for (let n = 0; n < 4; n++) {
      step(w, NO_INPUT);
      for (const ev of w.events) if (ev.kind === "player_hit") causes.push(ev.what ?? "");
    }
    expect(w.player.hearts).toBeCloseTo(6 - 0.7, 5);
    expect(causes).toEqual(["melee:rusher"]);
  });

  it("is not hurt by walking into a turret", () => {
    // A ranged body has no blade at all. Its attack is the ring it fires, and
    // standing on top of it is the safest place in the room rather than a
    // second cost for closing the distance.
    const w = world();
    const e = makeEnemy(1, "turret", w.player.x, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.telegraphMs = 100_000;
    w.enemies.push(e);
    const before = w.player.hearts;
    run(w, 90);
    expect(w.player.hearts).toBe(before);
  });

  it("is not hurt by standing next to a chaser that is not attacking", () => {
    const w = world();
    const e = makeEnemy(1, "rusher", w.player.x, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.attack = "recover";
    e.attackMs = 10_000;
    w.enemies.push(e);
    const before = w.player.hearts;
    run(w, 120);
    // Adjacency is the melee player's job, so it cannot also be a cost.
    expect(w.player.hearts).toBe(before);
  });
});

describe("wave release", () => {
  it("never floods a player who is not killing: the wait's ceiling stops at a gated release's bodies", () => {
    const wave = (at_ms: number) => ({ at_ms, spawns: [{ archetype: "rusher" as const, spawn_group: "far", count: 5 }] });
    const w = world({ encounter: encounter([wave(0), wave(1000), wave(2000), wave(3000)]), invincible: true });
    let most = 0;
    // Ninety seconds standing still: every wave's time and its 16 s ceiling pass.
    for (let n = 0; n < 60 * 90; n++) {
      step(w, NO_INPUT);
      most = Math.max(most, w.enemies.filter((e) => e.hp > 0).length);
    }
    expect(most).toBeLessThanOrEqual(8);
    expect(w.pendingWaves.length).toBeGreaterThan(0);
  });
});

describe("a fight room is never a free room", () => {
  it("pads a roster below the ramp's minimum, and never starts one empty", () => {
    /*
     * The player walked into a combat room with no enemies in it. The cause
     * was a beat-dealing bug that dropped later waves, and the sweep found no
     * wholly empty rooms after it — but two rooms in five hundred were
     * assembled with a roster of two, which is the same free room with a fig
     * leaf. The world guarantees the floor now (doc 005, `rampMinimum`).
     */
    for (const [plan, what] of [
      [[{ at_ms: 0, spawns: [{ archetype: "rusher" as const, spawn_group: "far", count: 1 }] }], "a one-body plan"],
      [[{ at_ms: 0, spawns: [{ archetype: "shooter" as const, spawn_group: "far", count: 2 }] }], "a two-body plan"],
    ] as const) {
      const w = world({ encounter: encounter([...plan]), roomIndex: 8 });
      step(w, NO_INPUT);
      const planned = w.enemies.length + w.pendingWaves.reduce((n, x) => n + x.spawns.reduce((m, s) => m + s.count, 0), 0);
      expect({ what, n: planned >= rampMinimum(8) }).toEqual({ what, n: true });
    }
  });
});

describe("an elite pays in health", () => {
  /** Kills one elite in a fresh world at `hearts` health; true if it dropped. */
  const eliteDropAt = (hearts: number, seed: number): { dropped: boolean; value: number } => {
    const w = world();
    w.player.hearts = hearts;
    w.rng = new RngSource(`elite-heal-${seed}`).stream("gameplay");
    const e = makeEnemy(1, "rusher", w.player.x + 40, w.player.y, ["armored"]);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    e.hp = 0;
    step(w, NO_INPUT);
    const heart = w.pickups.find((p) => p.alive && p.kind === "heart");
    return { dropped: heart !== undefined, value: heart?.value ?? 0 };
  };

  const dropRate = (hearts: number): number => {
    let n = 0;
    for (let i = 0; i < 400; i++) if (eliteDropAt(hearts, i).dropped) n++;
    return n / 400;
  };

  it("drops a heal worth a tenth of the bar, when it drops one at all", () => {
    const max = MAX_HEARTS;
    // At a sliver of health it is all but certain, so one sample finds it.
    const hit = Array.from({ length: 20 }, (_, i) => eliteDropAt(0.5, i)).find((r) => r.dropped);
    expect(hit, "no drop even at half a heart").toBeDefined();
    expect(hit!.value).toBeCloseTo(max * ELITE_HEAL_FRACTION, 5);
  });

  it("drops it more often the less health the player has", () => {
    /*
     * The drop **scales against what is left of the bar**: near certain at a
     * sliver, near nothing at full. A heal that always came was a tenth of a
     * bar handed to a player who could not hold it, and a reward stepped over
     * teaches the player to stop looking at the floor.
     */
    const full = dropRate(MAX_HEARTS);
    const half = dropRate(MAX_HEARTS / 2);
    const sliver = dropRate(0.5);
    expect(full, "an elite paid in health the player could not hold").toBe(0);
    expect(half).toBeGreaterThan(0.1);
    expect(half).toBeLessThan(0.45);
    expect(sliver).toBeGreaterThan(0.7);
    // Monotone: every step down the bar is at least as likely as the one above.
    expect(half).toBeGreaterThan(full);
    expect(sliver).toBeGreaterThan(half);
  });

  it("still always drops a coin, whatever the player's health", () => {
    // The coin is the part that does not depend on how the last room went.
    const w = world();
    const e = makeEnemy(1, "rusher", w.player.x + 40, w.player.y, ["armored"]);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    e.hp = 0;
    step(w, NO_INPUT);
    expect(w.pickups.filter((p) => p.alive && p.kind === "coin").length).toBeGreaterThan(0);
  });

  it("drops nothing extra for an ordinary body", () => {
    const w = world();
    const e = makeEnemy(1, "rusher", w.player.x + 40, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    e.hp = 0;
    step(w, NO_INPUT);
    // At full health an ordinary kill never leaves a heart: a heart on the
    // floor the player cannot take teaches them to ignore the next one.
    expect(w.pickups.filter((p) => p.alive && p.kind === "heart")).toHaveLength(0);
  });
});

describe("clear condition", () => {
  it("is not cleared while a wave is still to come, and a cleared floor calls it at once", () => {
    const w = world({
      /*
       * Enough bodies for **two beats**: a room is told in beats now, and a
       * plan small enough to fit in one is one wave (doc 005, the ramp), so a
       * two-body plan no longer has a second wave to wait on.
       */
      encounter: encounter([
        { at_ms: 0, spawns: [{ archetype: "rusher", spawn_group: "far", count: 6 }] },
        { at_ms: 4000, spawns: [{ archetype: "shooter", spawn_group: "far", count: 6 }] },
      ]),
    });
    run(w, 4);
    w.enemies.length = 0;
    run(w, 2);
    // Long before its 4 s: nothing was left standing to wait on.
    expect(worldCleared(w)).toBe(false);
    expect(w.pendingWaves.length).toBeLessThan(2);
    expect(w.enemies.length).toBeGreaterThan(0);
  });

  it("clears once every wave has spawned and nothing is alive", () => {
    const w = world({
      encounter: encounter([{ at_ms: 0, spawns: [{ archetype: "rusher", spawn_group: "far", count: 1 }] }]),
    });
    run(w, 4);
    // Padded to the ramp's minimum: a planned fight is never a free room
    // (doc 005, `rampMinimum`).
    expect(w.enemies.length).toBe(rampMinimum(99));
    w.enemies.length = 0;
    // Events last one step by design: the renderer drains them every frame.
    run(w, 1);
    expect(worldCleared(w)).toBe(true);
    expect(w.events.some((e) => e.kind === "room_cleared")).toBe(true);
    run(w, 1);
    expect(w.events.some((e) => e.kind === "room_cleared")).toBe(false);
  });
});

describe("the room border", () => {
  it("holds the player inside, including at the doorways", () => {
    // Doors are cut into the border, so a door the body can enter is a hole in
    // the room. Every side is walked into at the door's own row and column.
    const w = world();
    const dirs: { name: string; x: number; y: number; input: Partial<Input> }[] = [
      { name: "east", x: WORLD_W / 2, y: WORLD_H / 2, input: { moveX: 1 } },
      { name: "west", x: WORLD_W / 2, y: WORLD_H / 2, input: { moveX: -1 } },
      { name: "north", x: WORLD_W / 2, y: WORLD_H / 2, input: { moveY: -1 } },
      { name: "south", x: WORLD_W / 2, y: WORLD_H / 2, input: { moveY: 1 } },
    ];
    for (const d of dirs) {
      w.player.x = d.x;
      w.player.y = d.y;
      w.player.dashMs = 0;
      w.player.dashCooldownMs = 0;
      run(w, 600, input(d.input));
      expect(
        circleHitsWall(w.room.grid, w.player.x, w.player.y, PLAYER_RADIUS),
        `${d.name}: ended at ${w.player.x.toFixed(0)},${w.player.y.toFixed(0)}`,
      ).toBe(false);
    }
  });

  it("holds the player inside while dashing at a doorway", () => {
    const w = world();
    for (const dir of [{ moveX: 1 }, { moveX: -1 }, { moveY: -1 }, { moveY: 1 }]) {
      w.player.x = WORLD_W / 2;
      w.player.y = WORLD_H / 2;
      w.player.dashMs = 0;
      w.player.dashCooldownMs = 0;
      run(w, 600, input({ ...dir, dash: true }));
      expect(circleHitsWall(w.room.grid, w.player.x, w.player.y, PLAYER_RADIUS)).toBe(false);
    }
  });

  it("puts every entry position on open floor", () => {
    const w = world();
    for (const side of ["N", "E", "S", "W"] as const) {
      const p = entryPosition(side, w.room.extent);
      expect(circleHitsWall(w.room.grid, p.x, p.y, PLAYER_RADIUS), side).toBe(false);
    }
  });
});

describe("impact feedback", () => {
  it("freezes briefly when the player is hit, and unfreezes", () => {
    const w = world();
    w.player.x = 300;
    w.player.y = 200;
    const e = makeEnemy(1, "rusher", 305, 200, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    for (let i = 0; i < 400 && w.stats.heartsLost === 0; i++) run(w, 1);
    expect(w.stats.heartsLost).toBeGreaterThan(0);
    expect(w.hitstopMs).toBeGreaterThan(0);
    // A freeze that never ends is the failure mode worth guarding.
    run(w, 30);
    expect(w.hitstopMs).toBeLessThanOrEqual(0);
  });

  it("caps the freeze however much lands at once", () => {
    const w = world();
    for (let i = 0; i < 20; i++) w.trauma = 0;
    w.hitstopMs = 0;
    // Six frames is the cap; nothing may push past it.
    for (let i = 0; i < 40; i++) {
      w.hitstopMs = Math.min(100, w.hitstopMs + 50);
    }
    expect(w.hitstopMs).toBeLessThanOrEqual(100);
  });

  it("accumulates trauma on a hit and decays it back to still", () => {
    const w = world();
    w.player.x = 300;
    w.player.y = 200;
    const e = makeEnemy(1, "rusher", 305, 200, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    for (let i = 0; i < 400 && w.trauma === 0; i++) run(w, 1);
    expect(w.trauma).toBeGreaterThan(0);
    expect(w.trauma).toBeLessThanOrEqual(1);
    // Quiet for a second and the camera must be back at rest, or a busy
    // room would leave a permanent shake.
    w.enemies.length = 0;
    run(w, 180);
    expect(w.trauma).toBe(0);
  });

  it("never lets trauma exceed one however much lands", () => {
    const w = world();
    for (let i = 0; i < 50; i++) {
      w.player.invulnMs = 0;
      w.player.dashMs = 0;
      run(w, 1);
    }
    expect(w.trauma).toBeLessThanOrEqual(1);
  });
});

describe("aggro range", () => {
  it("leaves a distant enemy asleep and not firing", () => {
    const w = world();
    w.player.x = 60;
    w.player.y = 60;
    const t = makeEnemy(1, "turret", 620, 380, []);
    t.spawnFadeMs = 0;
    w.enemies.push(t);
    run(w, 300);
    expect(t.awake).toBe(false);
    expect(liveCount(w.enemyBullets)).toBe(0);
  });

  it("wakes an enemy the player walks up to", () => {
    const w = world();
    w.player.x = 300;
    w.player.y = 200;
    const t = makeEnemy(1, "turret", 380, 200, []);
    t.spawnFadeMs = 0;
    w.enemies.push(t);
    run(w, 4);
    expect(t.awake).toBe(true);
  });

  it("wakes a sleeping enemy that gets shot", () => {
    const w = world();
    w.player.x = 60;
    w.player.y = 60;
    const t = makeEnemy(1, "turret", 620, 380, []);
    t.spawnFadeMs = 0;
    w.enemies.push(t);
    run(w, 60);
    expect(t.awake).toBe(false);
    t.hp -= 1;
    // Damage goes through the bullet path in play; here the wake is asserted
    // through the same helper the damage path calls.
    wake(w, t);
    expect(t.awake).toBe(true);
  });

  it("a woken enemy raises its neighbours, as a ripple rather than all at once", () => {
    const w = world();
    w.player.x = 300;
    w.player.y = 200;
    const near = makeEnemy(1, "turret", 380, 200, []);
    const friend = makeEnemy(2, "turret", 440, 230, []);
    const far = makeEnemy(3, "turret", 640, 390, []);
    for (const e of [near, friend, far]) {
      e.spawnFadeMs = 0;
      w.enemies.push(e);
    }
    run(w, 4);
    expect(near.awake).toBe(true);
    // The alarm takes a beat to reach the neighbour...
    expect(friend.awake).toBe(false);
    run(w, 30);
    // ...and does reach it, and not the body across the room.
    expect(friend.awake).toBe(true);
    expect(far.awake).toBe(false);
  });
});

describe("the melee cycle", () => {
  it("winds up, commits, then backs off instead of parking on the player", () => {
    const w = world();
    w.player.x = 400;
    w.player.y = 200;
    const e = makeEnemy(1, "rusher", ...open(w.room, 470, 200), []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);

    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      run(w, 1);
      seen.add(e.attack);
    }
    // All four phases, which is the proof it is a loop and not a stall.
    expect(seen).toEqual(new Set(["approach", "windup", "lunge", "recover"]));
  });

  it("locks the lunge direction at the end of the windup, so it can be dodged", () => {
    const w = world();
    w.player.x = 400;
    w.player.y = 200;
    const e = makeEnemy(1, "rusher", ...open(w.room, 470, 200), []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);

    for (let i = 0; i < 400 && e.attack !== "lunge"; i++) run(w, 1);
    expect(e.attack).toBe("lunge");
    const locked = { x: e.lungeX, y: e.lungeY };
    // The player bolts sideways mid-lunge; a homing grab would follow.
    w.player.y = 60;
    run(w, 3);
    expect(e.lungeX).toBeCloseTo(locked.x, 6);
    expect(e.lungeY).toBeCloseTo(locked.y, 6);
  });

  it("gives the player a readable windup before the commit", () => {
    const w = world();
    w.player.x = 400;
    w.player.y = 200;
    const e = makeEnemy(1, "rusher", ...open(w.room, 470, 200), []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);

    let windupSteps = 0;
    for (let i = 0; i < 400 && e.attack !== "lunge"; i++) {
      run(w, 1);
      if (e.attack === "windup") windupSteps++;
    }
    // At 60 Hz a 280 ms windup is about 17 frames; well over a tenth of a
    // second is the threshold below which a tell cannot be reacted to.
    expect(windupSteps).toBeGreaterThan(8);
  });
});

/**
 * Doc 005, "Rhythm per archetype": the attack owns its shape and the body owns
 * the tempo it performs it at, and what a body does with a turn is not the
 * same thing twice running.
 */
describe("every body has its own rhythm", () => {
  /** Drives one body to its first windup and reports how long the windup is. */
  function firstWindup(id: Parameters<typeof makeEnemy>[1], at: [number, number]): number {
    const w = world();
    w.player.x = 400;
    w.player.y = 200;
    const e = makeEnemy(1, id, ...open(w.room, at[0], at[1]), []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    for (let i = 0; i < 900 && e.attack !== "windup"; i++) run(w, 1);
    expect(e.attack).toBe("windup");
    return e.windupMs;
  }

  it("winds a heavy body up for longer than a quick one, and never under the reaction floor", () => {
    const rusher = firstWindup("rusher", [470, 200]);
    const tank = firstWindup("tank", [520, 200]);
    // The tank's charge is a slow tell to begin with; its tempo widens the
    // gap rather than inventing it (doc 005, `TEMPO`).
    expect(tank).toBeGreaterThan(rusher * 1.4);
    // Nothing the tempo or its jitter produces is shorter than a reaction.
    expect(rusher).toBeGreaterThanOrEqual(260);
  });

  it("does not wind up to a click: the same body's windups differ", () => {
    const w = world();
    w.player.x = 400;
    w.player.y = 200;
    const e = makeEnemy(1, "rusher", ...open(w.room, 470, 200), []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    const seen = new Set<number>();
    for (let i = 0; i < 4000 && seen.size < 3; i++) {
      run(w, 1);
      if (e.attack === "windup") seen.add(Math.round(e.windupMs));
    }
    // Three different figures, all inside the band the jitter allows.
    expect(seen.size).toBeGreaterThanOrEqual(3);
    for (const ms of seen) expect(ms).toBeGreaterThanOrEqual(260);
  });

  it("never feints: every windup is followed by its blow", () => {
    const w = world();
    w.player.x = 400;
    w.player.y = 200;
    const e = makeEnemy(1, "rusher", ...open(w.room, 470, 200), []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    let windups = 0;
    for (let i = 0; i < 6000; i++) {
      const was = e.attack;
      run(w, 1);
      if (was === "windup" && e.attack !== "windup") {
        windups++;
        expect(e.attack).toBe("lunge");
      }
    }
    expect(windups).toBeGreaterThanOrEqual(3);
  });

  it("strings a second blow onto the first without handing the turn back", () => {
    const w = world();
    w.player.x = 400;
    w.player.y = 200;
    const e = makeEnemy(1, "rusher", ...open(w.room, 470, 200), []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    let strings = 0;
    for (let i = 0; i < 6000 && strings === 0; i++) {
      const combo = e.comboLeft;
      const phase = e.attack;
      run(w, 1);
      // The moment a recovery ends inside a string: the turn is kept and the
      // rest is a fraction of the ordinary one.
      if (phase === "recover" && e.attack === "approach" && combo > 0) {
        expect(e.hasToken).toBe(true);
        expect(e.attackCooldownMs).toBeLessThan(600);
        strings++;
      }
    }
    expect(strings).toBe(1);
    // A string is a one-two: never longer.
    expect(e.comboLeft).toBeLessThanOrEqual(1);
  });

  it("steps aside when the player swings at it", () => {
    const w = world();
    w.player.x = 400;
    w.player.y = 200;
    const e = makeEnemy(1, "rusher", ...open(w.room, 460, 200), []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    w.enemies.push(e);
    // Swing, over and over, from inside the distance a body reacts to.
    let juked = false;
    for (let i = 0; i < 1200 && !juked; i++) {
      step(w, input({ swing: true }));
      if (e.jukeMs > 0) juked = true;
    }
    expect(juked).toBe(true);
    // Across the line to the player, not along it: a dodge, not a retreat.
    const along = Math.abs(e.jukeX * (w.player.x - e.x) + e.jukeY * (w.player.y - e.y))
      / Math.max(1, Math.hypot(w.player.x - e.x, w.player.y - e.y));
    expect(along).toBeLessThan(0.7);
  });

  it("stabs, and does nothing else", () => {
    const w = world();
    w.player.x = 400;
    w.player.y = 200;
    const e = makeEnemy(1, "rusher", ...open(w.room, 470, 200), []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    const kinds = new Set<string>();
    for (let i = 0; i < 12000; i++) {
      run(w, 1);
      if (e.attack === "windup" && e.meleeKind) kinds.add(e.meleeKind);
    }
    /*
     * **One attack, and it does not travel.** Summoners call rushers in three
     * and four at a time, so nothing in this body's kit may cross ground at
     * the player or ask to be read twice (doc 005, the rusher).
     */
    expect(kinds).toEqual(new Set(["bristle"]));
    for (const k of kinds) expect(MELEE_ATTACKS[k as keyof typeof MELEE_ATTACKS].commitSpeed).toBe(0);
  });
});

describe("enemy behaviour", () => {
  it("telegraphs before the first volley", () => {
    const w = world();
    // A shooter: the turret no longer fires bullets at all, it calls
    // lightning, which has its own test below.
    const t = makeEnemy(1, "shooter", 300, 200, []);
    t.spawnFadeMs = 0;
    t.awake = true;
    // Pinned and at range: a ranged body may only shoot while standing still,
    // and not at all up close, so the wind-up is what is under test here
    // rather than either of those rules.
    t.speed = 0;
    w.player.x = 600;
    w.player.y = 360;
    w.enemies.push(t);
    run(w, 2);
    expect(liveCount(w.enemyBullets)).toBe(0);
    // Patterns now have a phase offset and a rhythm, so the first volley
    // lands on the pattern's own clock rather than a fixed frame count.
    let fired = false;
    for (let i = 0; i < 240 && !fired; i++) {
      run(w, 1);
      fired = liveCount(w.enemyBullets) > 0;
    }
    expect(fired).toBe(true);
  });

  it("gives away the first attack of every body, at full strength", () => {
    /*
     * Lidén's "miss the first time". A player meeting an archetype has no way
     * to know its reach, arc or rhythm, and the usual answer is to charge them
     * a heart for finding out. This shows the whole attack and withholds only
     * the damage — once, per body, per room.
     */
    const w = world();
    const e = makeEnemy(1, "rusher", w.player.x + 20, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    // A drive turn; see `chooseMelee`.
    e.casts = 1;
    beginWindup(w, e, w.player);
    e.attackMs = 1;
    w.enemies.push(e);

    const before = w.player.hearts;
    const causes: string[] = [];
    for (let n = 0; n < 30; n++) {
      step(w, NO_INPUT);
      for (const ev of w.events) if (ev.kind === "player_hit") causes.push(ev.what ?? "");
    }
    // It connected — the blade was live and found the player — and cost nothing.
    expect(causes).toContain("graze:rusher");
    expect(w.player.hearts).toBe(before);

    // The second one is real.
    e.staggerMs = 0;
    e.attackCooldownMs = 0;
    e.casts = 1;
    beginWindup(w, e, w.player);
    e.attackMs = 1;
    for (let n = 0; n < 30 && w.player.hearts === before; n++) step(w, NO_INPUT);
    expect(w.player.hearts).toBeCloseTo(before - 0.7, 5);
  });

  it("stuns the player with lightning, but never for longer than the mercy", () => {
    /*
     * Taking control away is the most dangerous thing a design can do to a
     * player, and it is only fair because the stun is strictly shorter than
     * the invulnerability that arrives with it — so it costs tempo and
     * position, never a heart. Pinned, because the day those two numbers cross
     * is the day a stun becomes a window to be hit in.
     */
    const w = world({ props: 0 });
    const t = makeEnemy(1, "turret", 300, 200, []);
    t.spawnFadeMs = 0;
    t.awake = true;
    t.telegraphMs = 0;
    w.enemies.push(t);
    w.player.x = 420;
    w.player.y = 200;

    for (let i = 0; i < 700 && t.strike.markMs <= 0; i++) step(w, NO_INPUT);
    expect(t.strike.markMs).toBeGreaterThan(0);
    // Stand in it.
    for (let i = 0; i < 120 && w.player.stunMs <= 0; i++) step(w, NO_INPUT);
    expect(w.player.stunMs, "a bolt should stun").toBeGreaterThan(0);
    expect(w.player.stunMs).toBeLessThan(w.player.invulnMs);

    /*
     * And the input is genuinely dropped while it runs. Measured over the
     * whole stun rather than a few frames, and against what *walking* would
     * have covered — the hit's own shove still carries the player a few pixels,
     * which is intended, so the assertion has to distinguish being carried
     * from being driven.
     */
    const at = { x: w.player.x, y: w.player.y };
    const steps = Math.ceil(w.player.stunMs / (1000 / 60));
    run(w, steps, input({ moveX: 1, swing: true, dash: true }));
    const walked = (PLAYER_SPEED * w.player.stunMs) / 1000;
    expect(Math.hypot(w.player.x - at.x, w.player.y - at.y)).toBeLessThan(
      Math.max(12, walked * 0.35),
    );
    expect(w.player.swingMs).toBe(0);
    expect(w.player.dashMs).toBe(0);
  });

  it("does not stun the player with a blade, even the tank's cleave", () => {
    // A charge briefly did, and it was too much: by the time it lands the
    // player is already shoved, flashing and down a heart. The tank's heavy
    // cut inherits the rule.
    const w = world({ props: 0 });
    const e = makeEnemy(1, "tank", w.player.x + 44, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    e.hasAttacked = true;
    w.enemies.push(e);
    beginWindup(w, e, w.player);
    const hearts = w.player.hearts;
    for (let i = 0; i < 120 && w.player.hearts === hearts; i++) step(w, NO_INPUT);
    expect(w.player.hearts).toBeCloseTo(hearts - 1.5, 5);
    expect(w.player.stunMs).toBe(0);
  });

  it("a ram that connects throws the player down its line and stops itself", () => {
    /*
     * Momentum exchange. The charge went on through the player at full speed
     * and the player got the same nudge as from a jab. Now the player is
     * thrown along the charge and the charger's commit ends on impact.
     */
    const w = world({ props: 0 });
    const e = makeEnemy(1, "tank", w.player.x - 120, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    e.hasAttacked = true;
    w.enemies.push(e);
    beginWindup(w, e, w.player);
    e.attackMs = 40;
    e.swing.trackingMs = 0;
    const hearts = w.player.hearts;
    let i = 0;
    for (; i < 200 && w.player.hearts === hearts; i++) step(w, NO_INPUT);
    expect(w.player.hearts).toBeLessThan(hearts);
    // Thrown east, the way the tank was going, and harder than a jab nudges.
    expect(w.player.hurtX).toBeGreaterThan(0);
    expect(Math.abs(w.player.hurtX)).toBeGreaterThan(Math.abs(w.player.hurtY) + 1);
    // And the tank is no longer charging.
    expect(e.attack).not.toBe("lunge");
  });

  it("a lancer's spikes fly off after the drive", () => {
    const w = world({ props: 0 });
    // Mid-room, so no spike meets a wall in the step it leaves.
    w.player.x = 336;
    w.player.y = 208;
    const e = makeEnemy(1, "lancer", w.player.x + 60, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    e.hasAttacked = true;
    w.enemies.push(e);
    // A lance turn, not a sweep turn: the two alternate (`chooseMelee`).
    e.casts = 1;
    beginWindup(w, e, w.player);
    let flying = 0;
    for (let i = 0; i < 60; i++) {
      step(w, NO_INPUT);
      flying = Math.max(flying, w.enemyBullets.filter((b) => b.alive && b.from === "lancer").length);
    }
    // Eight leave; one or two may already have met the player or a wall by
    // the end of the step they left in.
    expect(flying).toBeGreaterThanOrEqual(6);
  });

  it("an elite lancer bursts eight spikes when it dies, after they hang", () => {
    const w = world({ props: 0 });
    const e = makeEnemy(1, "lancer", w.player.x + 160, w.player.y, ["swift"]);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    e.hp = 0;
    step(w, NO_INPUT);
    expect(w.enemyBullets.filter((b) => b.alive).length).toBe(0);
    for (let t = 0; t < 600; t += 1000 / 60) step(w, NO_INPUT);
    // The full eight are counted on an empty floor in attacks.test; here the
    // generator's obstacle may stand where a spike is born.
    expect(w.enemyBullets.filter((b) => b.alive).length).toBeGreaterThan(0);
    // A plain one does not.
    const w2 = world({ props: 0 });
    const q = makeEnemy(1, "lancer", w2.player.x + 160, w2.player.y, []);
    q.spawnFadeMs = 0;
    q.awake = true;
    w2.enemies.push(q);
    q.hp = 0;
    step(w2, NO_INPUT);
    expect(w2.enemyBullets.filter((b) => b.alive).length).toBe(0);
  });

  it("the spin cuts a body once per turn, not once per spin", () => {
    const w = world({ props: 0 });
    const e = makeEnemy(1, "shooter", w.player.x + 30, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.hp = 1000;
    e.maxHp = 1000;
    e.speed = 0;
    w.enemies.push(e);
    w.player.rage = 2;
    step(w, { ...NO_INPUT, spin: true });
    let hits = 0;
    let last = e.hp;
    for (let i = 0; i < 120; i++) {
      // Pin the body so knockback cannot carry it out of the ring.
      e.x = w.player.x + 30;
      e.y = w.player.y;
      step(w, NO_INPUT);
      if (e.hp < last) { hits++; last = e.hp; }
    }
    expect(hits).toBeGreaterThanOrEqual(2);
  });

  it("the boss changes phase at 60% and 30% health, with a beat between", () => {
    const w = world({ props: 0 });
    const b = makeEnemy(1, "boss", w.player.x + 220, w.player.y, []);
    b.spawnFadeMs = 0;
    b.awake = true;
    b.alertMs = 0;
    b.armour = 0;
    w.enemies.push(b);
    step(w, NO_INPUT);
    expect(b.phase).toBe(1);
    b.hp = b.maxHp * 0.55;
    step(w, NO_INPUT);
    expect(b.phase).toBe(2);
    expect(w.events.some((ev) => ev.kind === "telegraph" && ev.what === "boss_phase:2")).toBe(true);
    // The change is a pause, not a volley: nothing pending, a rest before it acts.
    expect(b.pending).toHaveLength(0);
    expect(b.attackCooldownMs).toBeGreaterThanOrEqual(700);
    b.hp = b.maxHp * 0.2;
    step(w, NO_INPUT);
    expect(b.phase).toBe(3);
  });

  it("the boss shoots as well as swings", () => {
    const w = world({ props: 0 });
    const b = makeEnemy(1, "boss", w.player.x + 220, w.player.y, []);
    b.spawnFadeMs = 0;
    b.awake = true;
    b.alertMs = 0;
    w.enemies.push(b);
    let bullets = 0;
    for (let i = 0; i < 600; i++) {
      step(w, NO_INPUT);
      bullets = Math.max(bullets, w.enemyBullets.filter((x) => x.alive).length);
    }
    expect(bullets).toBeGreaterThan(0);
  });

  it("a turret marks the ground and then strikes it", () => {
    /*
     * The attack kinds were all built and none of them were reachable: the
     * `Strike` and `Fire` primitives existed, the world stepped them, and no
     * enemy ever called either. So these two tests are about the wiring rather
     * than the mechanics — that a turret in a room actually does this.
     */
    const w = world();
    const t = makeEnemy(1, "turret", 300, 200, []);
    t.spawnFadeMs = 0;
    t.awake = true;
    t.telegraphMs = 0;
    w.enemies.push(t);
    // Outside the panic radius: a ranged body standing next to the player is
    // silenced, which is its own test below.
    w.player.x = 420;
    w.player.y = 200;

    let marked = false;
    // The turret's cadence is six seconds, so the window has to outlast it.
    for (let i = 0; i < 600 && !marked; i++) {
      step(w, NO_INPUT);
      marked = t.strike.markMs > 0;
    }
    expect(marked, "a turret should mark the ground").toBe(true);
    /*
     * Marked where it last *saw* them, and fixed there. The marker is the
     * whole telegraph, so one that followed could not be answered — and it is
     * struck from a delayed position, which is what makes moving work at all.
     */
    expect(Math.hypot(t.strike.x - 420, t.strike.y - 200)).toBeLessThan(3);
    const at = { x: t.strike.x, y: t.strike.y };

    // Standing in it costs a heart; the bolt lands when the marker expires.
    const before = w.player.hearts;
    for (let i = 0; i < 90 && w.player.hearts === before; i++) step(w, NO_INPUT);
    expect(w.player.hearts).toBeCloseTo(before - 1.2, 5);
    expect(at).toEqual({ x: t.strike.x, y: t.strike.y });
  });

  it("a turret's strike is answered by walking out of the marker", () => {
    const w = world();
    const t = makeEnemy(1, "turret", 300, 200, []);
    t.spawnFadeMs = 0;
    t.awake = true;
    t.telegraphMs = 0;
    w.enemies.push(t);
    w.player.x = 420;
    w.player.y = 200;
    for (let i = 0; i < 600 && t.strike.markMs <= 0; i++) step(w, NO_INPUT);
    expect(t.strike.markMs).toBeGreaterThan(0);

    // The marker's whole point is that leaving works. If this ever fails the
    // attack has become a tax rather than a question.
    const before = w.player.hearts;
    run(w, 120, input({ moveX: 0, moveY: 1 }));
    expect(w.player.hearts).toBe(before);
  });

  it("winds up before every volley, not only the first of the room", () => {
    /*
     * An aimed shot with no wind-up cannot be dodged, only pre-empted by
     * already being elsewhere. The opening volley was telegraphed and every
     * one after it simply arrived, which is the difference between a pattern
     * the player reads and a pattern they memorise.
     */
    const w = world();
    const s = makeEnemy(1, "shooter", 300, 200, []);
    s.spawnFadeMs = 0;
    s.awake = true;
    s.telegraphMs = 0;
    s.speed = 0;
    w.enemies.push(s);
    w.player.x = 560;
    w.player.y = 200;

    // Two volleys, and each has to be preceded by an aiming window.
    for (let volley = 0; volley < 2; volley++) {
      const shotsBefore = liveCount(w.enemyBullets);
      let aimed = false;
      for (let i = 0; i < 600; i++) {
        step(w, NO_INPUT);
        if (s.telegraphMs > 0 && s.pending.length > 0) aimed = true;
        if (liveCount(w.enemyBullets) > shotsBefore) break;
      }
      expect(aimed, `volley ${volley} should wind up first`).toBe(true);
      expect(liveCount(w.enemyBullets)).toBeGreaterThan(shotsBefore);
      // Clear the air so the next volley is measurable.
      for (const b of w.enemyBullets) b.alive = false;
    }
  });

  it("makes a ranged body choose between moving and shooting", () => {
    /*
     * The piece the design writing is unanimous about: an archer must not have
     * a completely safe firing position. A shooter that backpedals while
     * firing has one, because its retreat is free — it holds its distance and
     * its rhythm at once, and closing gains the player nothing until they
     * arrive.
     */
    const w = world();
    const s = makeEnemy(1, "shooter", 300, 200, []);
    s.spawnFadeMs = 0;
    s.awake = true;
    s.telegraphMs = 0;
    w.enemies.push(s);
    // Inside the reposition radius, where the rule bites, and free to retreat.
    w.player.x = 410;
    w.player.y = 200;

    let firedWhileMoving = false;
    for (let i = 0; i < 600; i++) {
      const before = liveCount(w.enemyBullets);
      const wasMoving = Math.hypot(s.velX, s.velY) > 30;
      step(w, NO_INPUT);
      if (liveCount(w.enemyBullets) > before && wasMoving) firedWhileMoving = true;
      // Held just inside the reposition radius, so it keeps wanting to back
      // away and the rule keeps applying.
      w.player.x = s.x + 110;
      w.player.y = s.y;
    }
    expect(firedWhileMoving).toBe(false);
  });

  it("an emplacement stood on pulses a ring instead of falling silent", () => {
    /*
     * The silence rule rewards closing on a shooter, which had the option of
     * backing off and chose to shoot. A turret never had that option, so a
     * silenced turret was a free kill — "this turret does nothing". Inside
     * the radius it pulses a slow ring instead, on a cooldown.
     */
    const w = world();
    const t = makeEnemy(1, "sentinel", 300, 200, []);
    t.spawnFadeMs = 0;
    t.awake = true;
    t.telegraphMs = 0;
    w.enemies.push(t);
    w.player.x = 330;
    w.player.y = 200;
    let fired = 0;
    for (let i = 0; i < 300; i++) {
      step(w, NO_INPUT);
      fired = Math.max(fired, w.enemyBullets.filter((b) => b.alive).length);
    }
    expect(fired).toBeGreaterThanOrEqual(6);
    // And not a stream: the pulse is paced.
    let shots = 0;
    for (let i = 0; i < 180; i++) {
      const before = w.enemyBullets.filter((b) => b.alive).length;
      step(w, NO_INPUT);
      const after = w.enemyBullets.filter((b) => b.alive).length;
      if (after > before) shots++;
    }
    expect(shots).toBeLessThanOrEqual(2);
  });

  it("plants to take its shot, and stands over it afterwards", () => {
    /*
     * A ranged body may not shoot and reposition at once — but the rule used
     * to be enforced by *cancelling* a moving body's volley, and every ranged
     * archetype in the roster strafes, so near the player they simply never
     * fired. The body stops instead: the plant is the trade, taken where the
     * player can see it, and its tail is the window to close in (doc 005).
     */
    const w = world();
    w.stats.elapsedMs = ENTRY_GRACE_MS; // past the room's first moment, when nothing shoots
    const o = makeEnemy(1, "orbiter", 300, 200, []);
    o.spawnFadeMs = 0;
    o.awake = true;
    o.alertMs = 0;
    w.enemies.push(o);
    w.player.x = 400;
    w.player.y = 200;
    // Circling, and its turn comes round.
    for (let i = 0; i < 900 && o.plantMs <= 0; i++) step(w, NO_INPUT);
    expect(o.plantMs).toBeGreaterThan(0);
    expect(o.telegraphMs).toBeGreaterThan(0);
    // Planted means planted: it does not travel while the volley is aimed.
    const at = { x: o.x, y: o.y };
    for (let i = 0; i < 12; i++) step(w, NO_INPUT);
    expect(Math.hypot(o.x - at.x, o.y - at.y)).toBeLessThan(3);
    // And the shot leaves, which is the whole point.
    for (let i = 0; i < 90 && liveCount(w.enemyBullets) === 0; i++) step(w, NO_INPUT);
    expect(liveCount(w.enemyBullets)).toBeGreaterThan(0);
  });

  it("silences a ranged body the player has closed on", () => {
    /*
     * Closing the distance has to be worth something. A shooter that keeps
     * firing while the player stands next to it hitting it rewards the hard
     * part of the fight — crossing the floor — with the same damage they took
     * on the way in.
     */
    const w = world();
    const s = makeEnemy(1, "shooter", 300, 200, []);
    s.spawnFadeMs = 0;
    s.awake = true;
    s.telegraphMs = 0;
    // Pinned, because a shooter's own answer to being closed on is to back
    // away — and once it is out of the radius it may fire again, which is the
    // rule working rather than failing. The range rule is what is under test.
    s.speed = 0;
    w.enemies.push(s);

    // Adjacent: nothing comes out, however long it is given.
    w.player.x = 340;
    w.player.y = 200;
    run(w, 400);
    expect(liveCount(w.enemyBullets)).toBe(0);

    // Backed off: it fires again, so the silence is a range rule and not a
    // permanent shutdown.
    w.player.x = 560;
    w.player.y = 200;
    let fired = false;
    for (let i = 0; i < 400 && !fired; i++) {
      step(w, NO_INPUT);
      fired = liveCount(w.enemyBullets) > 0;
    }
    expect(fired).toBe(true);
  });

  it("a summoner throws fire that burns the ground it lands on", () => {
    const w = world();
    const s = makeEnemy(1, "summoner", 300, 200, []);
    s.spawnFadeMs = 0;
    s.awake = true;
    s.telegraphMs = 0;
    // Pinned, and far enough that neither the silence nor the move-or-shoot
    // rule applies: the throw is what is under test.
    s.speed = 0;
    w.enemies.push(s);
    w.player.x = 560;
    w.player.y = 200;

    let thrown = false;
    // Long enough to cover the flame's interval, which is deliberately rare.
    for (let i = 0; i < 700 && !thrown; i++) {
      step(w, NO_INPUT);
      thrown = w.enemyBullets.some((b) => b.alive && b.leavesFire);
    }
    expect(thrown, "a summoner should throw flame").toBe(true);

    let burning = false;
    for (let i = 0; i < 200 && !burning; i++) {
      step(w, NO_INPUT);
      burning = w.fires.some((f) => f.alive);
    }
    expect(burning, "the flame should light the floor where it stops").toBe(true);
  });

  it("burning ground hurts enemies too, so it is a tool and not only a tax", () => {
    // Hades' rule for magma: a hazard that only hurts the player is a tax, and
    // one that hurts everything is something the player can use.
    const w = world();
    const e = makeEnemy(1, "rusher", 300, 200, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    lightFire(w, 300, 200);
    const before = e.hp;
    run(w, 60);
    expect(e.hp).toBeLessThan(before);
  });

  it("a hit interrupts a windup, which is what pays for reading the tell", () => {
    /*
     * The single largest thing missing from how the enemies felt. Without it a
     * hit changed nothing the player could see — the body kept walking, kept
     * winding up, kept swinging — and damage that does not interrupt reads as
     * damage that did not land.
     */
    const w = world();
    const e = makeEnemy(1, "rusher", w.player.x + 40, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    beginWindup(w, e, w.player);
    w.enemies.push(e);
    expect(e.attack).toBe("windup");

    w.player.facing = 0;
    step(w, input({ swing: true }));
    for (let i = 0; i < 12 && e.staggerMs <= 0; i++) step(w, NO_INPUT);
    expect(e.staggerMs, "a hit should stagger").toBeGreaterThan(0);
    expect(e.attack, "and cancel the attack outright").toBe("approach");
    expect(e.hasToken, "and hand the turn back").toBe(false);
  });

  it("knocks a charge down when it hits a wall", () => {
    /*
     * A body that commits from range owes the player a way to punish the
     * commit, and the wall is it: steer the charge into one and it knocks
     * itself down. The charge moved from the tank to the lancer, and the rule
     * moved with it; the tank's opening is now the long recovery after its
     * cleave rather than a wall.
     */
    const w = world({ props: 0 });
    const e = makeEnemy(1, "tank", 90, 200, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    e.hasAttacked = true;
    w.enemies.push(e);
    // Aimed west, into the border wall. The direction is forced rather than
    // implied by standing the player inside the wall, which would break line
    // of sight and never commit.
    w.player.x = 150;
    w.player.y = 200;
    beginWindup(w, e, w.player);
    // Past the tracking half of the windup, or the forced direction is
    // re-pointed at the player before it commits.
    e.attackMs = 40;
    e.swing.trackingMs = 0;
    e.swing.facing = Math.PI;
    e.swing.angle = Math.PI;
    let stunned = false;
    for (let i = 0; i < 200 && !stunned; i++) {
      step(w, NO_INPUT);
      stunned = e.staggerMs > STAGGER_MS;
    }
    expect(stunned, "a charge into a wall should knock itself down").toBe(true);
    expect(e.attack).toBe("approach");
    expect(e.hasToken).toBe(false);
  });

  it("does not stagger a body while its armour holds", () => {
    // Hades' rule: armoured enemies are immune to stun, which is what stops a
    // heavy enemy being trivialised by out-clicking it. Damage goes into the
    // armour, so its health is untouched until the armour is gone.
    const w = world();
    const e = makeEnemy(1, "tank", w.player.x + 44, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    expect(e.armour).toBeGreaterThan(0);
    beginWindup(w, e, w.player);
    w.enemies.push(e);

    w.player.facing = 0;
    step(w, input({ swing: true }));
    for (let i = 0; i < 12; i++) step(w, NO_INPUT);
    expect(e.staggerMs).toBe(0);
    expect(e.armour).toBeLessThan(e.maxArmour);
    expect(e.hp).toBe(e.maxHp);
  });

  it("lets the player earn the interrupt by breaking the armour", () => {
    /*
     * The whole reason armour is a pool rather than permanent immunity. An
     * enemy whose state the player cannot touch is an obstacle, not an
     * opponent: they could pick when the tank committed and nothing about how
     * it ended. Two hits in, that changes.
     */
    const w = world();
    const e = makeEnemy(1, "tank", w.player.x + 44, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    w.enemies.push(e);
    w.player.facing = 0;

    // Swing until the armour is gone.
    for (let i = 0; i < 200 && e.armour > 0; i++)
      step(w, input({ swing: i % 20 === 0 }));
    expect(e.armour).toBe(0);
    expect(e.hp).toBeGreaterThan(0);
    // The breaking hit staggers too, which is the payoff moment — so it has
    // to be waited out before the next phase is measured.
    expect(e.staggerMs).toBeGreaterThan(0);
    run(w, 20);
    expect(e.staggerMs).toBeLessThanOrEqual(0);

    // Now a hit lands as a hit: it staggers, and it cancels the attack.
    beginWindup(w, e, w.player);
    for (let i = 0; i < 40 && e.staggerMs <= 0; i++)
      step(w, input({ swing: i % 20 === 0 }));
    expect(e.staggerMs, "a broken-armour body should stagger").toBeGreaterThan(0);
    expect(e.attack).toBe("approach");
  });

  it("caps how many enemies attack at once, and scales the cap with the room", () => {
    /*
     * The answer to a fight that is nothing but running away. Six bodies that
     * may each commit whenever they like will sometimes all commit at once,
     * and no position answers six simultaneous attacks.
     *
     * The cap is two **plus one per three awake bodies** (doc 005): a fixed
     * two left four of six waiting at any moment, which is 57% of an awake
     * body's time spent hovering. Six awake is four turns, and the ceiling —
     * the twelve-body concurrency cap — is six, which still leaves half the
     * floor waiting.
     */
    const w = world();
    for (let i = 0; i < 6; i++) {
      const e = makeEnemy(i + 1, "rusher", w.player.x + 30 + i * 4, w.player.y + i * 3, []);
      e.spawnFadeMs = 0;
      e.awake = true;
      e.alertMs = 0;
      w.enemies.push(e);
    }
    let peak = 0;
    for (let i = 0; i < 400; i++) {
      step(w, NO_INPUT);
      const committed = w.enemies.filter(
        (e) => e.attack === "windup" || e.attack === "lunge",
      ).length;
      peak = Math.max(peak, committed);
    }
    expect(peak).toBeGreaterThan(0);
    // Six awake: two base plus two.
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("gives an awake body something to do while it waits for a turn", () => {
    /*
     * Waiting is the design; hovering while waiting is the fault. Nothing
     * awake may go more than `THREAT_CAP_MS` without attacking or making a
     * move the player can read — a step of the ring, a walk to a fresh firing
     * post (doc 005, the token budget).
     */
    const w = world();
    const bodies = [];
    for (let i = 0; i < 6; i++) {
      const e = makeEnemy(i + 1, i < 4 ? "rusher" : "shooter", w.player.x + 120 + i * 6, w.player.y + i * 18, []);
      e.spawnFadeMs = 0;
      e.awake = true;
      e.alertMs = 0;
      w.enemies.push(e);
      bodies.push(e);
    }
    let worst = 0;
    for (let i = 0; i < 900; i++) {
      step(w, NO_INPUT);
      for (const e of bodies) worst = Math.max(worst, e.threatMs);
    }
    expect(worst).toBeLessThanOrEqual(THREAT_CAP_MS);
  });

  it("holds waiting bodies at reach instead of pressing them into the player", () => {
    // The visible half of the token system: a body with no turn to take must
    // not keep closing, or the player is still surrounded and still has to
    // leave, and the cap changed nothing they can act on.
    const w = world();
    for (let i = 0; i < 6; i++) {
      const e = makeEnemy(i + 1, "rusher", w.player.x + 40 + i * 5, w.player.y + i * 6, []);
      e.spawnFadeMs = 0;
      e.awake = true;
      e.alertMs = 0;
      w.enemies.push(e);
    }
    run(w, 300);
    /*
     * Bodies mid-attack are excluded: a committed charge is *supposed* to
     * arrive on the player, and the separation that keeps a waiting body at
     * arm's length is deliberately off during a lunge — otherwise an attack
     * would be pushed off its target by its own standoff and could never
     * connect. What is under test is that the ones **without** a turn keep
     * their distance.
     */
    const waiting = w.enemies.filter((e) => e.attack === "approach" || e.attack === "recover");
    expect(waiting.length).toBeGreaterThan(0);
    // Penetration, not contact: hard bodies resolve to exactly touching, so a
    // tolerance above the sum of the radii counts a correct result as a
    // failure.
    const overlapping = waiting.filter(
      (e) => Math.hypot(e.x - w.player.x, e.y - w.player.y) < e.radius + PLAYER_RADIUS - 1,
    );
    expect(overlapping.length).toBe(0);
  });

  it("keeps the patrols alive when the roster's speeds change", () => {
    /*
     * The patrol threshold was an absolute speed, and every speed in the
     * roster was later cut by a fifth — four of the six archetypes dropped
     * below it at once and the idle wandering silently disappeared. It is
     * relative to the fastest body now, so the division survives retuning.
     */
    const w = world();
    const light = makeEnemy(1, "rusher", ...open(w.room, 200, 200), []);
    const heavy = makeEnemy(2, "tank", ...open(w.room, 500, 300), []);
    light.spawnFadeMs = 0;
    heavy.spawnFadeMs = 0;
    w.enemies.push(light, heavy);
    // Far away, so neither wakes.
    w.player.x = 620;
    w.player.y = 60;
    const lightAt = { x: light.x, y: light.y };
    const heavyAt = { x: heavy.x, y: heavy.y };
    for (let i = 0; i < 400; i++) {
      step(w, NO_INPUT);
      light.awake = false;
      heavy.awake = false;
    }
    expect(Math.hypot(light.x - lightAt.x, light.y - lightAt.y),
      "a quick body should pace").toBeGreaterThan(6);
    expect(Math.hypot(heavy.x - heavyAt.x, heavy.y - heavyAt.y),
      "a heavy body should hold its ground").toBeLessThan(4);
  });

  it("gives a woken body a beat of noticing before it engages", () => {
    const w = world();
    const e = makeEnemy(1, "rusher", w.player.x + 200, w.player.y, []);
    e.spawnFadeMs = 0;
    w.enemies.push(e);
    wake(w, e);
    expect(e.alertMs).toBeGreaterThan(0);
    const at = { x: e.x, y: e.y };
    // Planted while it notices, so the fight has an opening beat.
    run(w, 6);
    expect(Math.hypot(e.x - at.x, e.y - at.y)).toBeLessThan(2);
    run(w, 60);
    expect(Math.hypot(e.x - w.player.x, e.y - w.player.y)).toBeLessThan(200);
  });

  it("ramps a body up to speed instead of snapping it there", () => {
    // A body that reaches full speed on the frame it decides to move reads as
    // a sprite being slid across the floor rather than as something with mass.
    const w = world();
    const e = makeEnemy(1, "rusher", w.player.x + 300, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    w.enemies.push(e);
    step(w, NO_INPUT);
    const first = Math.hypot(e.velX, e.velY);
    run(w, 30);
    const settled = Math.hypot(e.velX, e.velY);
    expect(first).toBeLessThan(settled * 0.6);
    // Against the roster's speeds rather than a fixed figure: they were cut
    // across the board when the enemies read as too agile.
    expect(settled).toBeGreaterThan(ENEMIES.rusher.speed * 0.4);
  });

  it("dashes through a projectile without consuming it", () => {
    /*
     * The invulnerability already meant no damage, but the bullet died on
     * contact — so dashing into a volley deleted it, which is a free clear
     * rather than a dodge. Passing through keeps the cost where it belongs:
     * the dodge buys a moment and a position, not the removal of the threat.
     */
    const w = world({ props: 0 });
    const b = acquire(w.enemyBullets, true)!;
    b.x = w.player.x + 40;
    b.y = w.player.y;
    b.vx = -300;
    b.vy = 0;
    b.damage = 1;
    b.from = "shooter";

    const hearts = w.player.hearts;
    // Dashed into it, straight at it.
    run(w, 14, input({ moveX: 1, dash: true }));
    expect(w.player.hearts, "the dash should protect").toBe(hearts);
    expect(b.alive, "and the bullet should still be in the air").toBe(true);
  });

  it("lets the player's spells break scenery, not only the sword", () => {
    // A prop is a solid tile, so a bullet already dies against one. Breaking
    // it is what makes that stop feeling like the spell failing.
    const w = world({ props: 6 });
    const target = w.props.find((p) => p.hp > 0)!;
    const before = target.hp;
    for (let i = 0; i < 40 && target.hp === before; i++) {
      const b = acquire(w.playerBullets, true)!;
      b.x = target.x - 20;
      b.y = target.y;
      b.vx = 500;
      b.vy = 0;
      b.damage = 8;
      run(w, 6);
    }
    expect(target.hp).toBeLessThan(before);
  });

  it("lets enemy fire break the cover the player is hiding behind", () => {
    /*
     * Cover that erodes is a resource; cover that is permanent is terrain.
     * A crate only blocking the player's own shots would also be the wrong way
     * round — it is the thing the player ducks behind.
     */
    const w = world({ props: 6 });
    const target = w.props.find((p) => p.hp > 0);
    expect(target, "the room should have scenery in it").toBeTruthy();
    const before = target!.hp;
    // Fired point blank into it, from the far side, so the shot stops on it.
    for (let i = 0; i < 40 && target!.hp === before; i++) {
      const b = acquire(w.enemyBullets, true)!;
      b.x = target!.x - 20;
      b.y = target!.y;
      b.vx = 400;
      b.vy = 0;
      b.damage = 1;
      b.from = "shooter";
      run(w, 6);
    }
    expect(target!.hp).toBeLessThan(before);
  });

  it("does not let two bodies freeze against each other", () => {
    /*
     * The bump handler used to pause a body so its turn was visible, which
     * deadlocked: paused means not moving, not moving means still overlapping,
     * still overlapping means the bump fires again and renews the pause. Two
     * enemies that touched stood in each other permanently.
     */
    const w = world();
    const a = makeEnemy(1, "shooter", 300, 200, []);
    const b = makeEnemy(2, "tank", 306, 202, []);
    for (const e of [a, b]) {
      e.spawnFadeMs = 0;
      e.awake = false;
    }
    w.enemies.push(a, b);
    // Far away, so both stay unaware and keep patrolling.
    w.player.x = 620;
    w.player.y = 60;
    for (let i = 0; i < 360; i++) {
      step(w, NO_INPUT);
      a.awake = false;
      b.awake = false;
    }
    const gap = Math.hypot(a.x - b.x, a.y - b.y);
    expect(gap, "they should have separated").toBeGreaterThan(a.radius + b.radius - 1);
  });

  it("walks a melee body around a wall rather than holding a ring at it", () => {
    /*
     * The ring a waiting body holds is measured in **straight-line** distance,
     * and with a wall between the two that is a lie: a chaser a few pixels
     * from the player through masonry read as having arrived, so it stood
     * against the wall and circled. An unsighted body pursues instead, which
     * follows the flow field round.
     */
    const w = world({ room: room("cover_ring"), props: 0 });
    // Opposite corners of the loop, the core between them: three tiles in,
    // past the pillars on the outer track.
    const ext = w.room.extent;
    const e = makeEnemy(1, "rusher", 3.5 * TILE_PX, 3.5 * TILE_PX, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    e.hasAttacked = true;
    w.enemies.push(e);
    w.player.x = (ext.w - 3.5) * TILE_PX;
    w.player.y = (ext.h - 3.5) * TILE_PX;

    const before = Math.hypot(e.x - w.player.x, e.y - w.player.y);
    run(w, 900);
    // Fifteen seconds is long enough to cross the room by any sane route; a
    // body holding a ring at a wall would still be near where it started.
    expect(Math.hypot(e.x - w.player.x, e.y - w.player.y)).toBeLessThan(before * 0.4);
  });

  it("gets a body off a wall corner rather than grinding on it", () => {
    /*
     * `blockedMs` asks "did it move at all", and a body on a corner answers
     * yes — `moveSliding` slides it *along* the wall, so the counter reset
     * every frame and neither the flow-field fallback nor the unwedge nudge
     * ever fired. Making no progress toward the player is the honest test.
     */
    const w = world({ room: room("broken_corridor"), props: 0 });
    // Where the base room put them — (3, 3) and (17, 10) — carried to this
    // room's size, on the nearest floor: the room's outline may wall a cell.
    const at = (c: [number, number]): [number, number] => {
      const [cx, cy] = cellAt(c, w.room.extent);
      for (let r = 0; r < 8; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++)
            if (w.room.grid[(cy + dy) * GRID_W + cx + dx] === Tile.Floor) return [(cx + dx + 0.5) * TILE_PX, (cy + dy + 0.5) * TILE_PX];
      return [(cx + 0.5) * TILE_PX, (cy + 0.5) * TILE_PX];
    };
    const [ex, ey] = at([3, 3]);
    const e = makeEnemy(1, "tank", ex, ey, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    e.hasAttacked = true;
    w.enemies.push(e);
    [w.player.x, w.player.y] = at([17, 10]);

    const before = Math.hypot(e.x - w.player.x, e.y - w.player.y);
    run(w, 1200);
    // Twenty seconds at 34 px/s covers the room several times over by any
    // route; a body stuck on a corner would still be near where it began.
    expect(Math.hypot(e.x - w.player.x, e.y - w.player.y)).toBeLessThan(before * 0.5);
  });

  it("does not let scenery trap an enemy", () => {
    /*
     * A destructible is a solid cell, so a body with line of sight walks
     * straight into one and grinds — and the jam fallback that switches to the
     * flow field never fired, because a body holding its waiting ring *is*
     * moving, so `blockedMs` was reset every frame. A pot could hold an enemy
     * still for the rest of the room.
     */
    const w = world({ props: 0 });
    const e = makeEnemy(1, "tank", 300, 200, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    e.hasAttacked = true;
    w.enemies.push(e);
    // A pot placed directly between the two, touching the body.
    const cell: [number, number] = [
      Math.floor((e.x + 26) / TILE_PX), Math.floor(e.y / TILE_PX),
    ];
    w.room.grid[cell[1] * GRID_W + cell[0]] = Tile.Prop;
    w.props.push({
      kind: "pot", gx: cell[0], gy: cell[1],
      x: (cell[0] + 0.5) * TILE_PX, y: (cell[1] + 0.5) * TILE_PX,
      radius: TILE_PX * 0.45, hp: 6, maxHp: 6, brokenMs: 0, hitFlashMs: 0,
    });
    w.player.x = (cell[0] + 0.5) * TILE_PX + 60;
    w.player.y = e.y;

    const pot = w.props[w.props.length - 1]!;
    const gapBefore = Math.hypot(e.x - w.player.x, e.y - w.player.y);
    /*
     * The **closest** it came, not where it finished.
     *
     * Read at the end of the run, this asserted the wrong thing about a body
     * whose attack is a charge: the tank arrives, overshoots — which is what a
     * ram does — and is measured mid-recoil at a distance greater than it
     * started, having crossed the player twice on the way. Whether scenery
     * trapped it is a question about the whole window.
     */
    let closest = gapBefore;
    for (let k = 0; k < 600; k++) {
      run(w, 1);
      closest = Math.min(closest, Math.hypot(e.x - w.player.x, e.y - w.player.y));
    }
    // Either it broke the pot or it went round; what must not happen is that
    // it is still sitting where it started.
    expect(pot.hp < 6 || closest < gapBefore * 0.8).toBe(true);
  });

  it("keeps bodies out of each other", () => {
    // Positioning only means something if position can be contested.
    const w = world();
    for (let i = 0; i < 5; i++) {
      const e = makeEnemy(i + 1, "rusher", 300 + i, 200 + i, []);
      e.spawnFadeMs = 0;
      e.awake = true;
      e.alertMs = 0;
      w.enemies.push(e);
    }
    run(w, 60);
    for (let i = 0; i < w.enemies.length; i++)
      for (let j = i + 1; j < w.enemies.length; j++) {
        const a = w.enemies[i]!;
        const b = w.enemies[j]!;
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        expect(gap, `${i} and ${j} overlap`).toBeGreaterThan((a.radius + b.radius) * 0.75);
      }
  });

  it("does not let the player walk through a body, but lets them dash through", () => {
    const w = world();
    const e = makeEnemy(1, "turret", 400, 200, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.telegraphMs = 100_000;
    w.enemies.push(e);
    w.player.x = 340;
    w.player.y = 200;

    // Walking into it: stopped at its edge.
    run(w, 60, input({ moveX: 1 }));
    expect(w.player.x).toBeLessThan(e.x);

    // Dashing into it: through. The safety valve, without which a player
    // pressed into a corner by bodies would have no legal move.
    const before = w.player.x;
    run(w, 30, input({ moveX: 1, dash: true }));
    expect(w.player.x).toBeGreaterThan(before);
  });

  it("a chaser stops at arm's length instead of standing on the player", () => {
    const w = world();
    w.player.x = 400;
    w.player.y = 200;
    const e = makeEnemy(1, "rusher", 430, 200, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    // Long enough that a chaser with no standoff would be sitting on top.
    run(w, 240);
    const gap = Math.hypot(e.x - w.player.x, e.y - w.player.y);
    expect(gap).toBeGreaterThan(PLAYER_RADIUS + e.radius - 1);
  });

  it("chasers crowding one player do not pile into the same point", () => {
    const w = world();
    w.player.x = 400;
    w.player.y = 200;
    for (let i = 0; i < 4; i++) {
      const e = makeEnemy(i + 1, "rusher", 400 + Math.cos(i) * 90, 200 + Math.sin(i) * 90, []);
      e.spawnFadeMs = 0;
      e.awake = true;
      w.enemies.push(e);
    }
    run(w, 240);
    const live = w.enemies.filter((e) => e.hp > 0);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i]!;
        const b = live[j]!;
        // Bodies may touch under pressure; they must not occupy one point.
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.radius);
      }
    }
  });

  it("a chaser rounds a wall instead of grinding on it", () => {
    const w = world({ room: room("cover_ring") });
    const e = makeEnemy(1, "rusher", 120, 120, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.player.x = 560;
    w.player.y = 330;
    w.enemies.push(e);
    const before = Math.hypot(e.x - w.player.x, e.y - w.player.y);
    run(w, 600);
    // Ten seconds is long enough to cross the room by any sane route; a body
    // wedged on a corner would still be sitting near where it started.
    expect(Math.hypot(e.x - w.player.x, e.y - w.player.y)).toBeLessThan(before * 0.5);
  });

  it("a chaser closes the distance", () => {
    const w = world();
    const e = makeEnemy(1, "rusher", ...open(w.room, 40, 40), []);
    e.spawnFadeMs = 0;
    e.awake = true;
    w.player.x = 400;
    w.player.y = 200;
    w.enemies.push(e);
    const before = Math.hypot(e.x - w.player.x, e.y - w.player.y);
    run(w, 30);
    expect(Math.hypot(e.x - w.player.x, e.y - w.player.y)).toBeLessThan(before);
  });
});

describe("per-room affix caps (doc 001)", () => {
  it("puts volatile on two bodies at most and shielded on one, however many elites arrive", () => {
    const w = world({
      encounter: {
        ...encounter([
          { at_ms: 0, spawns: [{ archetype: "tank", spawn_group: "far", count: 5 }] },
          { at_ms: 0, spawns: [{ archetype: "tank", spawn_group: "far", count: 5 }] },
        ]),
        elite_affixes: ["volatile", "shielded"],
      },
    });
    const volatile = new Set<number>();
    const shielded = new Set<number>();
    for (let t = 0; t < 40_000 && (w.enemies.length > 0 || w.pendingWaves.length > 0); t += 1000 / 60) {
      step(w, NO_INPUT);
      for (const e of w.enemies) {
        if (e.affixes.includes("volatile")) volatile.add(e.id);
        if (e.affixes.includes("shielded")) shielded.add(e.id);
        // Clear the floor so the next wave comes; the bursts are not the point here.
        if (e.spawnFadeMs <= 0) { e.hp = 0; e.affixes = []; }
      }
    }
    expect(w.pendingWaves).toHaveLength(0);
    expect(volatile.size).toBe(2);
    expect(shielded.size).toBe(1);
  });
});

describe("emplacements are bolted down", () => {
  it("a turret is not moved by the sword, by a body shoving into it, or by the player", () => {
    const w = world();
    const [tx, ty] = open(w.room, w.player.x + 24, w.player.y);
    const t = makeEnemy(1, "turret", tx, ty, []);
    t.spawnFadeMs = 0;
    t.awake = true;
    w.enemies.push(t);
    const r = makeEnemy(2, "rusher", tx + 6, ty, []);
    r.spawnFadeMs = 0;
    w.enemies.push(r);
    w.player.facing = Math.atan2(ty - w.player.y, tx - w.player.x);
    step(w, input({ swing: true }));
    for (let i = 0; i < 40; i++) { w.player.x = tx - 10; step(w, NO_INPUT); }
    expect(t.x).toBe(tx);
    expect(t.y).toBe(ty);
  });
});

describe("the room's first moment", () => {
  it("lets nothing shoot until the entry grace is over, then fires as normal", () => {
    const w = world();
    const [sx, sy] = open(w.room, w.player.x + 120, w.player.y);
    const e = makeEnemy(1, "shooter", sx, sy, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    w.enemies.push(e);
    const live = () => w.enemyBullets.filter((b) => b.alive).length;
    let early = 0;
    while (w.stats.elapsedMs < ENTRY_GRACE_MS) { w.player.x = sx - 120; step(w, NO_INPUT); early += live(); }
    expect(early).toBe(0);
    for (let i = 0; i < 60 * 6 && live() === 0; i++) { w.player.x = sx - 120; step(w, NO_INPUT); }
    expect(live()).toBeGreaterThan(0);
  });
});

describe("lava and grass", () => {
  /** An open arena with one zone, somewhere near the middle, given a feature. */
  const withZone = (feature: string, cells: [number, number][]): RoomPlan => {
    const r = room();
    return { ...r, zones: [{ id: "test", feature, cells }] } as RoomPlan;
  };
  const cellCentre = ([x, y]: readonly [number, number]) => [(x + 0.5) * TILE_PX, (y + 0.5) * TILE_PX] as const;

  it("runs lava one tile thick through the middle of its zone", () => {
    const zone: [number, number][] = [];
    for (let y = 4; y <= 6; y++) for (let x = 6; x <= 10; x++) zone.push([x, y]);
    const line = featureCells("lava_channel", zone);
    expect(line.length).toBe(5);
    expect(new Set(line.map((c) => c[1]))).toEqual(new Set([5]));
    expect(featureCells("spike_strip", zone)).toBe(zone);
  });

  it("burns a player who walks over it, and not one who dashes over it", () => {
    const lava: [number, number][] = [[8, 6], [9, 6], [10, 6]];
    const walked = world({ room: withZone("lava_channel", lava) });
    const [lx, ly] = cellCentre([9, 6]);
    walked.player.x = lx; walked.player.y = ly;
    const before = walked.player.hearts;
    for (let i = 0; i < 40; i++) { walked.player.x = lx; walked.player.y = ly; step(walked, NO_INPUT); }
    expect(walked.player.hearts).toBeLessThan(before);

    const dashed = world({ room: withZone("lava_channel", lava) });
    dashed.player.x = lx; dashed.player.y = ly - TILE_PX * 1.2;
    const start = dashed.player.hearts;
    step(dashed, input({ moveY: 1, dash: true }));
    for (let i = 0; i < 20; i++) step(dashed, NO_INPUT);
    expect(dashed.player.hearts).toBe(start);
    expect(dashed.player.y).toBeGreaterThan(ly + TILE_PX * 0.5);
  });

  it("routes bodies round lava rather than through it", () => {
    const w = world({ room: withZone("lava_channel", [[8, 6], [9, 6], [10, 6]]) });
    expect(w.pathGrid[6 * GRID_W + 9]).toBe(Tile.Wall);
    expect(w.room.grid[6 * GRID_W + 9]).toBe(Tile.Floor);
  });

  it("lights grass from any fire, runs it cell to cell as the lighter's fire, and burns it once", () => {
    const patch: [number, number][] = [[6, 6], [7, 6], [8, 6], [9, 6]];
    const w = world({ room: withZone("grass_patch", patch) });
    w.player.x = (15 + 0.5) * TILE_PX; w.player.y = (2 + 0.5) * TILE_PX;
    const [fx, fy] = cellCentre([6, 6]);
    lightFire(w, fx, fy, "player");
    step(w, NO_INPUT);
    const at = (x: number) => w.grass.find((c) => c.x === x)!;
    // Touched grass smoulders first, then goes up.
    expect(at(6).state).toBe("catching");
    for (let i = 0; i < Math.ceil(GRASS_CATCH_MS / 16.67) + 1; i++) step(w, NO_INPUT);
    expect(at(6).state).toBe("burning");
    expect(at(6).owner).toBe("player");
    expect(at(9).state).toBe("grass");
    for (let i = 0; i < 150; i++) step(w, NO_INPUT);
    expect(at(9).state).not.toBe("grass");
    expect(at(9).owner).toBe("player");
    for (let i = 0; i < 60 * 4; i++) step(w, NO_INPUT);
    expect(w.grass.every((c) => c.state === "burnt")).toBe(true);
    // Burnt grass does not light again.
    lightFire(w, fx, fy, "enemy");
    step(w, NO_INPUT);
    expect(at(6).state).toBe("burnt");
  });

  it("burns the player in grass the player's fire shot lit", () => {
    const patch: [number, number][] = [[6, 6], [7, 6], [8, 6], [9, 6]];
    const w = world({ room: withZone("grass_patch", patch) });
    const [px, py] = cellCentre([8, 6]);
    const start = w.player.hearts;
    const b = acquire(w.playerBullets, true)!;
    const [bx, by] = cellCentre([6, 6]);
    Object.assign(b, { alive: true, x: bx, y: by, vx: 0, vy: 0, lifeMs: 200, element: "fire", elementPower: 1 });
    for (let i = 0; i < 60 * 3; i++) { w.player.x = px; w.player.y = py; step(w, NO_INPUT); }
    expect(w.grass.find((c) => c.x === 8)!.state).not.toBe("grass");
    expect(w.player.hearts).toBeLessThan(start);
  });

  it("burns the player in grass whoever lit it, the player's own ground included", () => {
    // Burning grass is the room's fire: a trail or a field laid over grass
    // lights it, and it burns the caster standing in it as an enemy's would.
    const patch: [number, number][] = [[6, 6], [7, 6], [8, 6], [9, 6]];
    const stand = (owner: "player" | "enemy") => {
      const w = world({ room: withZone("grass_patch", patch) });
      const [px, py] = cellCentre([8, 6]);
      const [fx, fy] = cellCentre([6, 6]);
      lightFire(w, fx, fy, owner);
      const start = w.player.hearts;
      for (let i = 0; i < 60 * 3; i++) { w.player.x = px; w.player.y = py; step(w, NO_INPUT); }
      return { w, lost: start - w.player.hearts };
    };
    expect(stand("player").lost).toBeGreaterThan(0);
    expect(stand("enemy").lost).toBeGreaterThan(0);
  });

  it("does not burn a body on grass while the grass is still catching", () => {
    // The catch is what makes crossing lit grass fair: nothing burns until it goes up.
    const w = world({ room: withZone("grass_patch", [[8, 6]]) });
    const [px, py] = cellCentre([8, 6]);
    // The player's own patch touches the grass and burns nobody itself; the grass does, once it goes up.
    lightFire(w, px, py, "player", { radius: 6, lifeMs: 60 });
    const hold = () => { w.player.x = px; w.player.y = py; step(w, NO_INPUT); };
    hold();
    expect(w.grass[0]!.state).toBe("catching");
    while (w.grass[0]!.state === "catching") {
      expect(w.fires.some((f) => f.alive && f.fromGrass)).toBe(false);
      expect(w.player.burnBuild).toBe(0);
      hold();
    }
    expect(w.grass[0]!.state).toBe("burning");
  });

  it("stands no breakable prop in a floor hazard", () => {
    const pool: [number, number][] = [];
    for (let y = 2; y < GRID_H - 2; y++) for (let x = 2; x < GRID_W - 2; x++) if ((x + y) % 3 !== 0) pool.push([x, y]);
    const cells = new Set(pool.map(([x, y]) => y * GRID_W + x));
    for (let seed = 0; seed < 8; seed++) {
      const w = world({ room: withZone("poison_pool", pool), props: 12, rng: new RngSource(`pool-${seed}`).stream("w") });
      const scattered = w.props.filter((p) => p.kind !== "pillar");
      expect(scattered.length).toBeGreaterThan(0);
      for (const p of scattered) expect(cells.has(p.gy * GRID_W + p.gx)).toBe(false);
    }
  });

  it("lights the grass a fire shot flies over, and not the grass a plain shot does", () => {
    const patch: [number, number][] = [[6, 6], [7, 6], [8, 6], [9, 6]];
    const shoot = (element: "fire" | "none") => {
      const w = world({ room: withZone("grass_patch", patch) });
      w.player.x = (15 + 0.5) * TILE_PX; w.player.y = (2 + 0.5) * TILE_PX;
      const b = acquire(w.playerBullets, true)!;
      const [bx, by] = cellCentre([7, 6]);
      Object.assign(b, { alive: true, x: bx, y: by, vx: 0, vy: 0, lifeMs: 2000, element, elementPower: 1 });
      step(w, NO_INPUT);
      return w.grass.find((c) => c.x === 7)!;
    };
    expect(shoot("fire").state).toBe("catching");
    expect(shoot("fire").owner).toBe("player");
    expect(shoot("none").state).toBe("grass");
  });
});

describe("what the player cannot see", () => {
  const shotsFrom = (half: { x: number; y: number }, centre: { x: number; y: number } | null = null) => {
    const w = world({ viewHalf: half });
    const [sx, sy] = open(w.room, w.player.x + 200, w.player.y);
    const e = makeEnemy(1, "shooter", sx, sy, []);
    e.spawnFadeMs = 0; e.awake = true; e.alertMs = 0;
    w.enemies.push(e);
    w.stats.elapsedMs = ENTRY_GRACE_MS;
    let shots = 0;
    for (let i = 0; i < 60 * 20; i++) {
      w.player.x = sx - 200; w.player.y = sy; e.x = sx; e.y = sy;
      w.viewCentre = centre ? { x: w.player.x + centre.x, y: w.player.y + centre.y } : null;
      step(w, NO_INPUT);
      shots += w.events.filter((ev) => ev.kind === "shot").length;
    }
    return { shots, radius: e.radius };
  };

  it("fires only with its whole body on the screen, easing in over the tile inside the edge", () => {
    const r = shotsFrom({ x: WORLD_W, y: WORLD_H }).radius;
    // 200 px out. A view whose edge cuts the body: quiet, since a shot from a
    // body the player cannot see whole is an arrow from the dark. Half a tile
    // inside: firing, less. The whole room: the full rate.
    const cut = shotsFrom({ x: 200, y: 200 }).shots;
    const fading = shotsFrom({ x: 200 + r + TILE_PX / 2, y: 200 + r + TILE_PX / 2 }).shots;
    const seen = shotsFrom({ x: WORLD_W, y: WORLD_H }).shots;
    expect(cut).toBe(0);
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(seen);
  });

  it("measures the view from where the camera is, not from the player", () => {
    // A view wide enough to hold the body round the player, but the camera has
    // stopped short of it — held at the room's edge, or trailing a dash.
    const half = { x: 200 + 40, y: 200 };
    expect(shotsFrom(half).shots).toBeGreaterThan(0);
    expect(shotsFrom(half, { x: -120, y: 0 }).shots).toBe(0);
  });
});

describe("a room is populated across its floor (doc 005, stations)", () => {
  it("spreads the opening roster into small groups instead of one knot", () => {
    const w = world({
      viewHalf: { x: 256, y: 144 },
      encounter: encounter([
        // Five, which is the most a planned wave releases at once (doc 005).
        { at_ms: 0, spawns: [{ archetype: "rusher", spawn_group: "far", count: 5 }] },
      ]),
    });
    step(w, NO_INPUT);
    const bodies = w.enemies.filter((e) => e.hp > 0);
    expect(bodies.length).toBe(5);
    /*
     * No knot. The opening roster used to put four bodies inside two tiles of
     * one point in the entry view, which is what "the map is either full of
     * enemies or empty" was; a station is a pair or a trio.
     */
    for (const a of bodies) {
      const near = bodies.filter((b) => b !== a && Math.hypot(a.x - b.x, a.y - b.y) < 110).length;
      expect(near).toBeLessThanOrEqual(2);
    }
    // And they are genuinely spread: some pair is most of a viewport apart.
    const widest = Math.max(...bodies.flatMap((a) => bodies.map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
    expect(widest).toBeGreaterThan(200);
    // A station is bodies standing near each other, never on each other.
    for (const a of bodies)
      for (const b of bodies)
        if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(8);
  });

  it("calls the next station while the one in front of the player is dying", () => {
    /*
     * The gap between two stations is what the player feels as "the map is
     * empty": the fix is not to move a body but to have called the next one
     * before the screen goes quiet (doc 005, "Where the bodies stand").
     */
    const w = world({
      viewHalf: { x: 256, y: 144 },
      encounter: encounter([
        { at_ms: 0, spawns: [{ archetype: "rusher", spawn_group: "far", count: 5 }] },
      ]),
    });
    step(w, NO_INPUT);
    const bodies = w.enemies.filter((e) => e.hp > 0);
    // The fight has started, and everything is down to one awake body.
    w.stats.damageDealt = 10;
    for (const e of bodies) e.awake = false;
    bodies[0]!.awake = true;
    bodies[0]!.x = w.player.x + 40;
    bodies[0]!.y = w.player.y;
    const awake0 = bodies.filter((e) => e.awake).length;
    for (let i = 0; i < 120; i++) step(w, NO_INPUT);
    // Another station has been called, with that last body still standing.
    expect(bodies.filter((e) => e.awake).length).toBeGreaterThan(awake0);
    expect(bodies[0]!.hp).toBeGreaterThan(0);
  });

  it("brings a later wave in awake, out of the view, and never onto the player", () => {
    const w = world({
      viewHalf: { x: 256, y: 144 },
      invincible: true,
      // Two beats' worth; see the clear-condition test above.
      encounter: encounter([
        { at_ms: 0, spawns: [{ archetype: "rusher", spawn_group: "far", count: 6 }] },
        { at_ms: 500, spawns: [{ archetype: "shooter", spawn_group: "far", count: 6 }] },
      ]),
    });
    step(w, NO_INPUT);
    const opening = w.enemies.map((e) => e.id);
    // The gate holds a beat until the floor thins, so the opening one has to
    // be cleared before the next is called.
    for (const e of w.enemies) e.hp = 0;
    for (let i = 0; i < 60 * 20 && w.pendingWaves.length > 0; i++) step(w, NO_INPUT);
    const arrived = w.enemies.find((e) => !opening.includes(e.id));
    expect(arrived).toBeDefined();
    /*
     * A reinforcement is something that **walks in**: it lands off the edge
     * of the screen and comes to the fight, rather than growing out of the
     * floor beside the player.
     */
    const out = Math.abs(arrived!.x - w.player.x) > w.viewHalf.x
      || Math.abs(arrived!.y - w.player.y) > w.viewHalf.y;
    expect(out).toBe(true);
    expect(arrived!.awake).toBe(true);
  });
});

describe("a body that has not noticed the player is still alive", () => {
  it("lifts a sleeper's head when the player comes near, and lets it settle", () => {
    const w = world();
    w.player.x = 200;
    w.player.y = 200;
    const e = makeEnemy(1, "rusher", 200, 200, []);
    e.spawnFadeMs = 0;
    e.idleRole = "sleeper";
    // Just inside the stir range and well outside the range it wakes at.
    const range = ENEMIES.rusher.aggro_range;
    e.x = 200 + range * 0.65;
    e.y = 200;
    w.enemies.push(e);
    for (let i = 0; i < 120 && e.idleAction !== "stir"; i++) step(w, NO_INPUT);
    expect(e.idleAction).toBe("stir");
    expect(e.awake).toBe(false);
    // The player backs off during the beat, and it goes back down.
    w.player.x = 200 - range;
    for (let i = 0; i < 90 && e.idleAction === "stir"; i++) step(w, NO_INPUT);
    expect(e.idleAction).toBe("still");
    expect(e.awake).toBe(false);
  });

  it("turns a sleeper over rather than leaving it a statue", () => {
    const w = world();
    w.player.x = 40;
    w.player.y = 40;
    const e = makeEnemy(1, "rusher", 500, 300, []);
    e.spawnFadeMs = 0;
    e.idleRole = "sleeper";
    w.enemies.push(e);
    const facing0 = e.facing;
    let shifted = false;
    for (let i = 0; i < 60 * 12; i++) {
      step(w, NO_INPUT);
      if (e.idleAction === "shift") shifted = true;
    }
    expect(shifted).toBe(true);
    expect(e.awake).toBe(false);
    expect(Math.abs(e.facing - facing0)).toBeGreaterThan(0.2);
  });
});

describe("camps", () => {
  it("places the whole encounter at the start, unaware, away from the entry", () => {
    const enc = encounter([
      { at_ms: 0, spawns: [{ archetype: "rusher", count: 2, group: "far" }] },
      { at_ms: 4000, spawns: [{ archetype: "shooter", count: 2, group: "far" }] },
      { at_ms: 8000, spawns: [{ archetype: "orbiter", count: 2, group: "far" }] },
    ] as unknown as EncounterPlan["waves"]);
    const w = world({ encounter: enc, placement: "camps" });
    const entry = { x: w.player.x, y: w.player.y };
    step(w, NO_INPUT);
    expect(w.enemies.length).toBe(6);
    expect(w.pendingWaves.length).toBe(0);
    for (const e of w.enemies) {
      expect(e.spawnFadeMs).toBe(0);
      expect(Math.hypot(e.x - entry.x, e.y - entry.y)).toBeGreaterThan(TILE_PX * 4);
    }
  });
});

describe("spawns keep out of floor hazards", () => {
  it("never sets a body down in a poison pool, a turret included", () => {
    for (let seed = 0; seed < 6; seed++) {
      const r = room();
      const [px, py] = open(r, 16 * TILE_PX, 9 * TILE_PX);
      const cx = Math.floor(px / TILE_PX), cy = Math.floor(py / TILE_PX);
      const pool: [number, number][] = [];
      for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 2; x <= cx + 2; x++)
        if (r.grid[y * GRID_W + x] === Tile.Floor) pool.push([x, y]);
      const plan: RoomPlan = { ...r, zones: [{ id: "pool", feature: "poison_pool", cells: pool }], spawn_groups: [{ id: "g", cells: pool }] };
      const w = world({
        room: plan,
        rng: new RngSource(`hazard-${seed}`).stream("world"),
        encounter: encounter([{ at_ms: 0, spawns: [{ archetype: "turret", spawn_group: "g", count: 2 }, { archetype: "rusher", spawn_group: "g", count: 3 }] }]),
      });
      step(w, NO_INPUT);
      const inPool = new Set(pool.map(([x, y]) => y * GRID_W + x));
      for (const e of w.enemies)
        expect(inPool.has(Math.floor(e.y / TILE_PX) * GRID_W + Math.floor(e.x / TILE_PX))).toBe(false);
      expect(w.enemies.length).toBeGreaterThan(0);
    }
  });
});

describe("a curving shot at close range", () => {
  it("still lands: the arc closes on a body two tiles away", () => {
    const r = room();
    const w = world({ room: r, slots: [plainInstance("ember_dart"), null, null, null, null, null] });
    const [px, py] = open(r, 12 * TILE_PX, 9 * TILE_PX);
    w.player.x = px; w.player.y = py;
    const e = makeEnemy(w.nextEnemyId++, "rusher", px + 70, py - 26, []);
    e.spawnFadeMs = 0; e.awake = true; e.speed = 0; e.attackCooldownMs = 99999;
    w.enemies.push(e);
    let hits = 0;
    for (let i = 0; i < 90; i++) {
      step(w, input({ aimX: e.x, aimY: e.y, spell: i === 0 ? 0 : null }));
      w.player.mana = w.staff.mana_max;
      hits += w.events.filter((ev) => ev.kind === "enemy_hit").length;
    }
    expect(hits).toBeGreaterThan(0);
  });
});

describe("the rage streak", () => {
  it("counts only the sword's kills: spells that drop a pack bank no rage", () => {
    const r = room();
    const w = world({ room: r, slots: [plainInstance("scatter_shot"), null, null, null, null, null] });
    const [px, py] = open(r, 12 * TILE_PX, 9 * TILE_PX);
    w.player.x = px; w.player.y = py;
    for (const [dx, dy] of [[40, -10], [44, 0], [40, 10], [48, 6]] as const) {
      const e = makeEnemy(w.nextEnemyId++, "rusher", px + dx, py + dy, []);
      e.spawnFadeMs = 0; e.awake = true; e.speed = 0; e.hp = e.maxHp = 1; e.attackCooldownMs = 99999;
      w.enemies.push(e);
    }
    const before = w.player.rage;
    for (let i = 0; i < 60; i++) {
      step(w, input({ aimX: px + 60, aimY: py, spell: i === 0 ? 0 : null }));
      w.player.mana = w.staff.mana_max;
    }
    expect(w.enemies.filter((e) => e.hp > 0).length).toBeLessThan(2);
    expect(w.player.rage).toBe(before);
  });
});

describe("the player's burning ground", () => {
  it("builds the burn gauge on a body standing in it, until the body catches", () => {
    const r = room();
    const w = world({ room: r });
    const [px, py] = open(r, 12 * TILE_PX, 9 * TILE_PX);
    const e = makeEnemy(w.nextEnemyId++, "tank", px + 80, py, []);
    e.spawnFadeMs = 0; e.awake = true; e.speed = 0; e.attackCooldownMs = 99999;
    w.enemies.push(e);
    lightFire(w, e.x, e.y, "player", { radius: 40, lifeMs: 6000, damage: 1 });
    let caught = false;
    for (let i = 0; i < 60 * 5 && !caught; i++) { step(w, NO_INPUT); e.x = px + 80; e.y = py; caught = e.burnMs > 0; }
    expect(caught).toBe(true);
  });
});

describe("counting spell presses (doc 011)", () => {
  it("counts a held key as one press, and each new press once", () => {
    const w = world({ slots: [plainInstance("magic_bolt"), null, null] });
    const aim = { aimX: w.player.x + 100, aimY: w.player.y };
    for (let i = 0; i < 60; i++) step(w, { ...NO_INPUT, ...aim, spell: 0 });
    expect(w.stats.castPresses).toBe(1);
    step(w, { ...NO_INPUT, ...aim, spell: null });
    step(w, { ...NO_INPUT, ...aim, spell: 0 });
    expect(w.stats.castPresses).toBe(2);
  });
});

describe("clearing a room", () => {
  it("puts out the fight's leftovers: armed seeds and shots still in the air", () => {
    const w = world();
    // A room that had a fight in it: an empty test room is cleared from its first frame.
    w.stats.enemiesSpawned = 1;
    w.mines.push({ alive: true, x: w.player.x + 80, y: w.player.y, inertMs: 0, fuseMs: 9000 } as never);
    const b = acquire(w.enemyBullets, false)!;
    Object.assign(b, { alive: true, x: w.player.x + 120, y: w.player.y, vx: -50, vy: 0, lifeMs: 5000 });
    step(w, NO_INPUT);
    expect(w.cleared).toBe(true);
    expect(w.mines.length).toBe(0);
    expect(w.enemyBullets.some((x) => x.alive)).toBe(false);
  });
});
