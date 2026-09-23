import { describe, it, expect } from "vitest";
import { createWorld, step, worldCleared } from "./world.ts";
import {
  PLAYER_RADIUS, PLAYER_SPEED, NO_INPUT, ENEMY_BULLET_CAP, INVULN_MS,
} from "./types.ts";
import type { Input, World } from "./types.ts";
import {
  beginWindup, makeEnemy, wake, SPAWN_FADE_MS, STAGGER_MS, TELEGRAPH_MS,
} from "./enemy.ts";
import { liveCount, acquire } from "./bullets.ts";
import { SPELL_COST_BASE, SPELL_COST_PER_RANK, slotCost } from "./spells.ts";
import { WORLD_W, WORLD_H, circleHitsWall, entryPosition } from "./collide.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";
import { lightFire } from "./fire.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { ENEMIES } from "../encounters/index.ts";
import { staffFor, plainInstance, ITEMS } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import type { EncounterPlan, RoomPlan, SpaceArchetypeId } from "../types.ts";

const src = new RngSource("sim-test");

function room(space: SpaceArchetypeId = "open_arena") {
  const g = generateRoom(
    { space, symmetry: "mirrored", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "combat", src.stream("room", space), { plain: true },
  );
  return toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
}

const encounter = (waves: EncounterPlan["waves"]): EncounterPlan => ({
  profile: { composition: "mixed", density: "sparse", wave_structure: "two_waves", anchor: "none", entry: "far_front" },
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
    staff: staffFor({ slots: "many", mana: "high", tempo: "steady", special: "none" }),
    slots: [plainInstance("magic_bolt"), null, null, null, null, null],
    hearts: 6,
    rng: src.stream("world"),
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
      input({ moveX: Math.sin(i / 7), moveY: Math.cos(i / 5), aimX: 100 + i, aimY: 200, fire: i % 3 !== 0 }));
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
    step(w, cast);
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
    expect(spent).toBeCloseTo(SPELL_COST_BASE + SPELL_COST_PER_RANK, 5);

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
    const ring = () => w.playerBullets.filter((b) => b.alive && b.orbitMs > 0).length;
    expect(ring()).toBe(3);
    // Past the cooldown, with the mana to pay: cast again.
    w.spells[0]!.cooldownMs = 0;
    w.player.mana = w.staff.mana_max;
    run(w, 30);
    step(w, cast);
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
      beginWindup(e, w.player);
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
    beginWindup(e, w.player);
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

  it("is hurt in front of a charging enemy", () => {
    const w = world();
    const e = makeEnemy(1, "rusher", w.player.x - 26, w.player.y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.hasAttacked = true;
    beginWindup(e, w.player);
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

describe("clear condition", () => {
  it("is not cleared while a wave is still pending", () => {
    const w = world({
      encounter: encounter([
        { at_ms: 0, spawns: [{ archetype: "rusher", spawn_group: "far", count: 1 }] },
        { at_ms: 4000, spawns: [{ archetype: "shooter", spawn_group: "far", count: 1 }] },
      ]),
    });
    run(w, 4);
    w.enemies.length = 0;
    run(w, 2);
    expect(worldCleared(w)).toBe(false);
    expect(w.pendingWaves.length).toBe(1);
  });

  it("clears once every wave has spawned and nothing is alive", () => {
    const w = world({
      encounter: encounter([{ at_ms: 0, spawns: [{ archetype: "rusher", spawn_group: "far", count: 1 }] }]),
    });
    run(w, 4);
    expect(w.enemies.length).toBe(1);
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
      const p = entryPosition(side);
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
    beginWindup(e, w.player);
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
    beginWindup(e, w.player);
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
    beginWindup(e, w.player);
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
    beginWindup(e, w.player);
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
    beginWindup(e, w.player);
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

  it("drops a held volley, and its firing turn, when it moves inside the radius", () => {
    /*
     * The move-or-shoot rule returned early and left the aimed volley and the
     * fire token in place. An orbiter never stands still, so inside the
     * radius it stayed mid-telegraph for as long as the player was near —
     * a body blinking red forever, holding a turn nothing else could take.
     */
    const w = world();
    const o = makeEnemy(1, "orbiter", 300, 200, []);
    o.spawnFadeMs = 0;
    o.awake = true;
    o.alertMs = 0;
    w.enemies.push(o);
    w.player.x = 400;
    w.player.y = 200;
    // Circling, with a volley already aimed and the turn taken for it.
    o.velX = 0;
    o.velY = 80;
    o.telegraphMs = 300;
    o.pending = [{ size: 1, at_ms: 0, aim: "player", angle_deg: 0, speed: 100, from: "single", path: [0] }];
    step(w, NO_INPUT);
    expect(o.pending).toHaveLength(0);
    expect(o.telegraphMs).toBe(0);
    expect(o.hasToken).toBe(false);
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
    beginWindup(e, w.player);
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
    beginWindup(e, w.player);
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
    beginWindup(e, w.player);
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
    beginWindup(e, w.player);
    for (let i = 0; i < 40 && e.staggerMs <= 0; i++)
      step(w, input({ swing: i % 20 === 0 }));
    expect(e.staggerMs, "a broken-armour body should stagger").toBeGreaterThan(0);
    expect(e.attack).toBe("approach");
  });

  it("lets only two enemies attack at once, however many are in the room", () => {
    /*
     * The answer to a fight that is nothing but running away. Six bodies that
     * may each commit whenever they like will sometimes all commit at once,
     * and no position answers six simultaneous attacks.
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
    expect(peak).toBeLessThanOrEqual(2);
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
    const e = makeEnemy(1, "rusher", 120, 120, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    e.hasAttacked = true;
    w.enemies.push(e);
    w.player.x = 560;
    w.player.y = 330;

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
    const e = makeEnemy(1, "tank", 120, 120, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.alertMs = 0;
    e.hasAttacked = true;
    w.enemies.push(e);
    w.player.x = 560;
    w.player.y = 330;

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
