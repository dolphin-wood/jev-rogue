import { BOSS_PALM_PX, ENTRY_GRACE_MS, bossPalmOf, release } from "./enemy.ts";
import { describe, it, expect } from "vitest";
import { createWorld, step } from "./world.ts";
import { NO_INPUT } from "./types.ts";
import type { Enemy, Input, World } from "./types.ts";
import { makeEnemy, wake } from "./enemy.ts";
import { castRift, castShockwave, flameRays, plantMine, FLAME_ROLL_MS, MINE_INERT_MS, MINE_PRIME_MS, MUSKET_RANGE, RIFT_TELE_MS, SHOCK_THICKNESS, WARD_ARMOUR } from "./attacks.ts";
import { lightFire } from "./fire.ts";
import { DEATH_BURST_MS, hurtEnemy } from "./world.ts";
import { liveCount } from "./bullets.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";
import type { EliteAffix } from "../types.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";

const src = new RngSource("attacks-test");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("room"), { plain: true },
);
const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
/*
 * The arena with its interior cleared. These tests are about the attacks, and
 * the generator's kiting obstacle sits in the middle of the room — exactly
 * where a line from a body to the player runs.
 */
const grid = built.grid.slice();
for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
const room = { ...built, grid };

function world(): World {
  const w = createWorld({
    room, encounter: null, props: 0,
    staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), null, null],
    hearts: 6, rng: src.stream("w"),
  });
  w.player.x = 320;
  w.player.y = 208;
  return w;
}

const idle: Input = NO_INPUT;

/** Damage a body the way anything that hits it does. */
function hurt(w: World, e: Enemy, amount: number): void {
  hurtEnemy(w, e, amount);
}

/** The enemy bullets actually in the air. */
const liveBullets = (w: World) => w.enemyBullets.filter((b) => b.alive);

function run(w: World, ms: number, input: Input = idle): void {
  for (let t = 0; t < ms; t += 1000 / 60) step(w, input);
}

/** An awake body of `id` at an offset from the player, on floor. */
function body(w: World, id: Parameters<typeof makeEnemy>[1], dx: number, dy: number, affixes: EliteAffix[] = []): Enemy {
  let x = w.player.x + dx;
  let y = w.player.y + dy;
  const gx = Math.floor(x / TILE_PX);
  const gy = Math.floor(y / TILE_PX);
  if (w.room.grid[gy * GRID_W + gx] !== Tile.Floor) { x = w.player.x + dx / 2; y = w.player.y + dy / 2; }
  const e = makeEnemy(w.nextEnemyId++, id, x, y, affixes);
  e.spawnFadeMs = 0;
  w.enemies.push(e);
  wake(w, e);
  e.alertMs = 0;
  return e;
}

describe("rift", () => {
  it("does nothing while it grows, then strikes a body on its line once", () => {
    const w = world();
    const hearts = w.player.hearts;
    castRift(w, w.player.x - 80, w.player.y, 0, 160);
    run(w, RIFT_TELE_MS - 100);
    expect(w.player.hearts).toBe(hearts);
    run(w, 400);
    expect(w.player.hearts).toBeLessThan(hearts);
    const after = w.player.hearts;
    run(w, 1200);
    expect(w.player.hearts).toBe(after);
  });

  it("misses a body standing off its line: the answer is across it", () => {
    const w = world();
    const hearts = w.player.hearts;
    castRift(w, w.player.x - 80, w.player.y - 40, 0, 160);
    run(w, RIFT_TELE_MS + 400);
    expect(w.player.hearts).toBe(hearts);
  });
});

describe("a blast lands when it is drawn", () => {
  it("does no damage before the fuse ends, and lands on the frame the blast is called", () => {
    /*
     * The report was that a mine's damage is judged before its explosion.
     * The sim's half of that is pinned here: nothing is charged for a primed
     * seed until `MINE_PRIME_MS` has run, and the heart and the `hazard_tick`
     * that the renderer opens the blast on arrive on the **same** step. (The
     * renderer's half was that the three drawn frames grow with their index,
     * so the hit landed on the smallest of them; it plays them the other way
     * round now.)
     */
    const w = world();
    const hearts = w.player.hearts;
    const m = plantMine(w, -1, w.player.x + 44, w.player.y, 0);
    let primedAt = -1;
    let hurtAt = -1;
    let blastAt = -1;
    for (let f = 0; f < 240 && m.alive; f++) {
      step(w, { ...idle, moveX: 1 });
      for (const ev of w.events) {
        if (ev.kind === "telegraph" && ev.what === "mine_primed" && primedAt < 0) primedAt = f;
        if (ev.kind === "hazard_tick" && ev.what === "mine" && blastAt < 0) blastAt = f;
      }
      if (hurtAt < 0 && w.player.hearts < hearts) hurtAt = f;
    }
    expect(primedAt).toBeGreaterThanOrEqual(0);
    expect(hurtAt).toBeGreaterThanOrEqual(0);
    // The blast and the heart are the same step, never the heart first.
    expect(blastAt).toBe(hurtAt);
    // And the whole fuse ran before either: 320 ms is 19 frames at 60 Hz.
    expect(hurtAt - primedAt).toBeGreaterThanOrEqual(Math.floor(MINE_PRIME_MS / (1000 / 60)) - 1);
  });
});

describe("mine", () => {
  it("is safe while inert, bursts once armed and approached", () => {
    const w = world();
    const hearts = w.player.hearts;
    plantMine(w, -1, w.player.x + 4, w.player.y);
    run(w, MINE_INERT_MS - 200);
    expect(w.player.hearts).toBe(hearts);
    // Armed, it is set off, flashes, and bursts on a player who stayed.
    run(w, 200 + MINE_PRIME_MS + 100);
    expect(w.player.hearts).toBeLessThan(hearts);
  });

  it("can be escaped once set off: the flash is the warning", () => {
    const w = world();
    const hearts = w.player.hearts;
    plantMine(w, -1, w.player.x + 4, w.player.y, 0);
    step(w, idle);
    expect(w.mines[0]!.primeMs).toBeGreaterThan(0);
    // Walk out of the blast before it goes.
    for (let t = 0; t < MINE_PRIME_MS + 200; t += 1000 / 60) { w.player.x -= 3; step(w, idle); }
    expect(w.player.hearts).toBe(hearts);
  });

  it("goes out quietly when nothing sets it off", () => {
    const w = world();
    const m = plantMine(w, -1, w.player.x + 200, w.player.y, 0);
    run(w, 7000);
    expect(m.alive).toBe(false);
    expect(m.burstMs).toBe(0);
  });

  it("is set off by fire from a distance", () => {
    const w = world();
    const hearts = w.player.hearts;
    const m = plantMine(w, -1, w.player.x + 120, w.player.y, 0);
    lightFire(w, m.x, m.y, "player");
    run(w, MINE_PRIME_MS + 100);
    expect(w.mines.every((x) => !x.alive || x.burstMs > 0)).toBe(true);
    expect(w.player.hearts).toBe(hearts);
  });
});

describe("the warden's fire-shot", () => {
  const armed = (w: World, dx: number) => {
    const e = body(w, "warden", dx, 0);
    e.x = w.player.x + dx;
    e.y = w.player.y;
    for (let i = 0; i < 600 && e.pose !== "musket_windup"; i++) { w.player.x = e.x - dx; step(w, idle); }
    return e;
  };

  it("is raised with nothing fired, then rolls out a flame that hits once and burns", () => {
    const w = world();
    const e = armed(w, 80);
    expect(e.pose).toBe("musket_windup");
    expect(w.flames).toHaveLength(0);
    const hearts = w.player.hearts;
    for (let i = 0; i < 120 && e.pose === "musket_windup"; i++) { w.player.x = e.x - 80; w.player.y = e.y; step(w, idle); }
    expect(w.flames).toHaveLength(1);
    run(w, FLAME_ROLL_MS + 100);
    expect(w.player.hearts).toBe(hearts - 1);
    expect(w.player.burnBuild + (w.player.burnMs > 0 ? 1 : 0)).toBeGreaterThan(0);
  });

  it("does not reach past its range", () => {
    const w = world();
    const e = armed(w, MUSKET_RANGE + 40);
    const hearts = w.player.hearts;
    for (let i = 0; i < 200; i++) { w.player.x = e.x - (MUSKET_RANGE + 40); w.player.y = e.y; step(w, idle); }
    expect(w.player.hearts).toBe(hearts);
  });

  it("stops at stone", () => {
    const w = world();
    const x = w.player.x;
    const y = w.player.y;
    const open = flameRays(w, x, y, 0);
    const grid = w.room.grid.slice();
    for (let gy = 0; gy < GRID_H; gy++) grid[gy * GRID_W + Math.floor((x + 48) / TILE_PX)] = Tile.Wall;
    const walled = { ...w, room: { ...w.room, grid } } as World;
    const cut = flameRays(walled, x, y, 0);
    expect(Math.max(...cut)).toBeLessThan(Math.min(...open));
    expect(Math.max(...cut)).toBeLessThan(64);
  });

  it("stands to reload after firing: its opening", () => {
    const w = world();
    const e = armed(w, 150);
    for (let i = 0; i < 900 && e.pose !== "musket_reload"; i++) step(w, idle);
    expect(e.pose).toBe("musket_reload");
    const x0 = e.x;
    run(w, 600);
    expect(Math.abs(e.x - x0)).toBeLessThan(1);
  });
});

describe("the bellringer's ward", () => {
  it("armours its ally, is cut by standing in it, and goes with the ringer", () => {
    const w = world();
    const ally = body(w, "shooter", 0, -120);
    const ringer = body(w, "bellringer", 0, 120);
    ringer.x = w.player.x + 150;
    ringer.y = w.player.y;
    ally.x = w.player.x - 150;
    ally.y = w.player.y;
    const armour0 = ally.armour;
    // Hold the player off the line until the ward lands.
    w.player.y += 60;
    for (let i = 0; i < 300 && ally.wardArmour <= 0; i++) step(w, idle);
    expect(ally.wardArmour).toBe(WARD_ARMOUR);
    expect(ally.armour).toBeGreaterThanOrEqual(armour0 + WARD_ARMOUR);

    // Stand on the line — both ends move, so keep to it — and it cuts, and the armour goes.
    for (let i = 0; i < 40; i++) {
      w.player.x = (ally.x + ringer.x) / 2;
      w.player.y = (ally.y + ringer.y) / 2;
      step(w, idle);
    }
    expect(ally.wardArmour).toBe(0);
    expect(w.tethers.filter((t) => t.kind === "ward")).toHaveLength(0);
  });

  /**
   * A ringer and one ally, both planted, on a line the player is nowhere
   * near. Planted because a ward line that wanders across the player is cut,
   * and these tests are about the bell rather than about the cut.
   */
  function ringed(w: World): { ringer: Enemy; ally: Enemy } {
    const ally = body(w, "shooter", 0, -120);
    const ringer = body(w, "bellringer", 100, 0);
    ringer.x = w.player.x + 150;
    ringer.y = w.player.y;
    ally.x = w.player.x - 150;
    ally.y = w.player.y;
    ringer.speed = 0;
    ally.speed = 0;
    w.player.y += 90;
    for (let i = 0; i < 400 && ally.wardArmour <= 0; i++) step(w, idle);
    return { ringer, ally };
  }

  it("does not trickle the shield back: only a toll puts it on", () => {
    const w = world();
    const { ringer, ally } = ringed(w);
    expect(ally.wardArmour).toBe(WARD_ARMOUR);
    // Cut half of it out, as a sword would, and keep the ringer from ringing.
    ally.armour -= WARD_ARMOUR / 2;
    ally.wardArmour -= WARD_ARMOUR / 2;
    // No bell in this window: any windup already running is called off.
    ringer.pose = "";
    ringer.poseMs = 0;
    for (let i = 0; i < 120; i++) { ringer.moveMs = 9000; step(w, idle); }
    expect(ally.wardArmour).toBeCloseTo(WARD_ARMOUR / 2, 1);
  });

  it("tolls: the circle does no damage, and every tethered ally is refilled at once", () => {
    const w = world();
    const { ringer, ally } = ringed(w);
    expect(ally.wardArmour).toBe(WARD_ARMOUR);
    // Break most of the shield, then let the bell ring.
    ally.armour -= WARD_ARMOUR * 0.8;
    ally.wardArmour -= WARD_ARMOUR * 0.8;
    for (let i = 0; i < 900 && ringer.pose !== "field"; i++) { ringer.moveMs = 0; step(w, idle); }
    expect(ringer.pose).toBe("field");
    // The telegraph is a circle on the ringer's own ground, and it is harmless.
    const toll = w.rifts.find((r) => r.alive && r.length === 0 && Math.hypot(r.x - ringer.x, r.y - ringer.y) < 4);
    expect(toll).toBeDefined();
    expect(toll!.damage).toBe(0);
    // Stand in it, so "no damage" is measured where damage would land —
    // inside the circle, and clear of the ward line so nothing is cut.
    w.player.x = ringer.x;
    w.player.y = ringer.y + 40;
    w.events.length = 0;
    for (let i = 0; i < 120 && w.hasteFields.length === 0; i++) step(w, idle);
    expect(w.events.some((e) => e.kind === "player_hit" && e.what === "burst")).toBe(false);
    // The clap: the shield is whole again, and the pulse is running down the line.
    expect(ally.wardArmour).toBeCloseTo(WARD_ARMOUR, 1);
    expect(w.tethers.some((t) => t.kind === "ward" && t.pulseMs > 0)).toBe(true);
    // The ringing it leaves hurries the allies standing in it, and does
    // nothing at all to the player.
    expect(w.hasteFields).toHaveLength(1);
    ally.x = ringer.x + 20;
    ally.y = ringer.y;
    run(w, 100);
    expect(ally.hastedMs).toBeGreaterThan(0);
  });

  it("is interrupted by a hit during the windup", () => {
    const w = world();
    const { ringer, ally } = ringed(w);
    for (let i = 0; i < 900 && ringer.pose !== "field"; i++) { ringer.moveMs = 0; step(w, idle); }
    expect(ringer.pose).toBe("field");
    ally.armour -= WARD_ARMOUR * 0.8;
    ally.wardArmour -= WARD_ARMOUR * 0.8;
    // A hit on the ringer, mid-windup: the pose drops and the circle goes.
    hurt(w, ringer, 5);
    expect(ringer.pose).toBe("");
    expect(w.rifts.filter((r) => r.alive && r.length === 0 && Math.hypot(r.x - ringer.x, r.y - ringer.y) < 4))
      .toHaveLength(0);
    // And nothing is refilled: no clap, no field.
    run(w, 1500);
    expect(ally.wardArmour).toBeCloseTo(WARD_ARMOUR * 0.2, 1);
    expect(w.hasteFields).toHaveLength(0);
  });
});

describe("the ground shockwave", () => {
  /** Put the player exactly `d` px from the wave's centre, due east. */
  const at = (w: World, s: { x: number; y: number }, d: number): void => {
    w.player.x = s.x + d;
    w.player.y = s.y;
  };

  it("hits a player standing on the band", () => {
    const w = world();
    const s = castShockwave(w, w.player.x, w.player.y, { chargeMs: 0, inner: 100, speed: 0, damage: 1 });
    at(w, s, 100 + SHOCK_THICKNESS / 2);
    const hearts0 = w.player.hearts;
    run(w, 100);
    expect(w.player.hearts).toBeLessThan(hearts0);
  });

  it("misses a player inside it and one beyond it", () => {
    for (const d of [40, 260]) {
      const w = world();
      const s = castShockwave(w, w.player.x, w.player.y, { chargeMs: 0, inner: 100, speed: 0, damage: 1 });
      at(w, s, d);
      const hearts0 = w.player.hearts;
      run(w, 100);
      expect(w.player.hearts).toBe(hearts0);
    }
  });

  it("misses a player dashing through it", () => {
    const w = world();
    const s = castShockwave(w, w.player.x, w.player.y, { chargeMs: 0, inner: 100, speed: 0, damage: 1 });
    at(w, s, 100 + SHOCK_THICKNESS / 2);
    w.player.dashMs = 200;
    w.player.dashIframeMs = 200;
    const hearts0 = w.player.hearts;
    run(w, 100);
    expect(w.player.hearts).toBe(hearts0);
  });

  it("charges before it travels, and its band moves outward", () => {
    const w = world();
    const s = castShockwave(w, w.player.x + 400, w.player.y, { inner: 0 });
    expect(s.chargeMs).toBeGreaterThan(0);
    run(w, 200);
    expect(s.inner).toBe(0);
    run(w, 700);
    expect(s.inner).toBeGreaterThan(0);
    const was = s.inner;
    run(w, 200);
    expect(s.inner).toBeGreaterThan(was);
  });
});

describe("the snarecaster's hook", () => {
  it("drags a player caught on its line toward it", () => {
    const w = world();
    const s = body(w, "snarecaster", 150, 0);
    s.x = w.player.x + 150;
    s.y = w.player.y;
    const x0 = w.player.x;
    for (let i = 0; i < 600 && w.player.dragMs <= 0; i++) step(w, idle);
    expect(w.player.dragMs).toBeGreaterThan(0);
    run(w, 600);
    expect(w.player.x).toBeGreaterThan(x0 + 40);
  });

  it("lashes the ground round itself once the drag lands", () => {
    const w = world();
    const s = body(w, "snarecaster", 150, 0);
    s.x = w.player.x + 150;
    s.y = w.player.y;
    for (let i = 0; i < 600 && w.player.dragMs <= 0; i++) step(w, idle);
    expect(w.player.dragMs).toBeGreaterThan(0);
    // The chain comes round its own feet: a circle on the caster, growing
    // while the player is still being reeled in (doc 005, the snarecaster).
    expect(s.pose).toBe("lash_windup");
    const lash = w.rifts.find((r) => r.length === 0 && Math.hypot(r.x - s.x, r.y - s.y) < 4);
    expect(lash).toBeDefined();
    expect(lash!.teleMs).toBeGreaterThan(400);
  });
});

describe("a flyer that can see the player attacks", () => {
  /*
   * The regression this pins: two flying bodies hovered and never attacked.
   * Two causes, both of which made a body stop where it was and go quiet —
   * a `keep_distance` body that could never give ground sat inside the
   * point-blank silence radius forever, and an orbiter was permanently
   * "stuck" because the stuck test asks whether a body is getting nearer the
   * player and an orbiter never is. Both produced nought or one attack in
   * twenty seconds where the cadence asks for six to twelve.
   */
  const SECS = 20;

  /** How many times `id` attacks in twenty seconds, placed `dx, dy` from the player. */
  function attacks(id: Parameters<typeof makeEnemy>[1], dx: number, dy: number): number {
    const w = world();
    const e = body(w, id, dx, dy);
    let n = 0;
    let mines = 0;
    for (let i = 0; i < SECS * 60; i++) {
      step(w, idle);
      for (const ev of w.events) if (ev.kind === "shot" && String(ev.what).includes(id)) n++;
      // A sower's attack is a seed, which is not a shot.
      if (w.mines.length > mines) n += w.mines.length - mines;
      mines = w.mines.length;
      // Held up, so the count is a cadence rather than a time to live.
      e.hp = e.maxHp;
    }
    return n;
  }

  for (const [dx, dy, where] of [[40, 0, "at point blank"], [120, 0, "at mid range"], [200, 0, "across the room"]] as const) {
    it(`has the shooter firing ${where}`, () => {
      expect(attacks("shooter", dx, dy)).toBeGreaterThanOrEqual(5);
    });
    it(`has the orbiter firing ${where}`, () => {
      expect(attacks("orbiter", dx, dy)).toBeGreaterThanOrEqual(5);
    });
    it(`has the sower seeding ${where}`, () => {
      expect(attacks("sower", dx, dy)).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("the delver", () => {
  it("erupts where a walk away from the mark always clears it", () => {
    /*
     * The dive's fairness, pinned as a number. It is answered by **leaving
     * the circle**, and the circle is fixed when the mound stops — the
     * heading locks as the body goes under, so nothing about the eruption
     * tracks the player after that. Measured: a 600 ms telegraph, a mound at
     * 54 px/s against the player's 120, about 103 px of travel, one dive
     * every 4.7 s, landing a median 47 px from the player — and a plain walk
     * straight out, started on the frame the mark appears, clears it every
     * time.
     */
    let erupted = 0;
    let hit = 0;
    for (let t = 0; t < 8; t++) {
      const w = world();
      const d = body(w, "delver", 150, 0);
      let phase = d.delve;
      for (let i = 0; i < 25 * 60; i++) {
        const mark = w.rifts.find((r) => r.alive && r.teleMs > 0 && r.length === 0);
        const away = mark ? Math.atan2(w.player.y - mark.y, w.player.x - mark.x) : 0;
        step(w, mark ? { ...idle, moveX: Math.cos(away), moveY: Math.sin(away) } : idle);
        for (const ev of w.events) if (ev.kind === "player_hit" && String(ev.what).includes("burst")) hit++;
        if (d.delve === "emerging" && phase === "under") erupted++;
        phase = d.delve;
        d.hp = d.maxHp;
      }
    }
    expect(erupted).toBeGreaterThan(20);
    expect((erupted - hit) / erupted).toBeGreaterThanOrEqual(0.95);
  });

  it("goes under, cannot be touched there, and erupts where the mound stops", () => {
    const w = world();
    const d = body(w, "delver", 120, 0);
    d.delveMs = 0;
    run(w, 700);
    expect(d.delve === "under" || d.delve === "diving").toBe(true);
    expect(d.airborne).toBe(true);
    for (let i = 0; i < 400 && d.delve !== "emerging"; i++) step(w, idle);
    expect(w.rifts.some((r) => r.length === 0)).toBe(true);
  });
});

describe("the cinderling", () => {
  it("does not set itself alight, and does not paint the room", () => {
    /*
     * The loop this pins: it lobs a coal, walks into the pool, catches, trails
     * fire while it burns, stands in the trail, which refreshes the burn —
     * and burns for the rest of the room, lighting every tile it crosses. Its
     * own fire feeds it health and nothing else now; only the player's lights
     * it (doc 005, the cinderling).
     */
    const w = world();
    const c = body(w, "cinderling", 150, 0);
    for (let i = 0; i < 20 * 60; i++) step(w, idle);
    expect(c.burnMs).toBe(0);
    // Its coals, and nothing beyond them: a lob every 3.8 s over twenty
    // seconds is a handful of pools, not a floor.
    expect(w.fires.filter((f) => f.alive).length).toBeLessThanOrEqual(6);
  });

  it("is healed by burning ground, not hurt", () => {
    const w = world();
    const c = body(w, "cinderling", 150, 0);
    c.hp = c.maxHp - 10;
    lightFire(w, c.x, c.y, "player", { damage: 3 });
    const hp0 = c.hp;
    run(w, 1200);
    expect(c.hp).toBeGreaterThan(hp0);
  });
});

describe("a subspecies is one verb changed (doc 019)", () => {
  /*
   * These were elite tests. Doc 005 made an elite a different attack *and* a
   * stat package, at about one room in seven — too rare to learn, which is
   * what an attack has to be. The attacks came down to the subspecies tier,
   * which a room may hold a fifth of, and the elite tier kept the enrage.
   */
  it("the beacon leaves the ground burning where the turret only marks it", () => {
    const w = world();
    w.stats.elapsedMs = ENTRY_GRACE_MS; // past the room's first moment, when nothing shoots
    const b = body(w, "beacon", 180, 0);
    b.patternMs = 0;
    run(w, 6500);
    expect(w.fires.filter((f) => f.alive).length).toBeGreaterThan(0);
  });

  it("the turret's own strike leaves no fire: the ground is free again at once", () => {
    const w = world();
    w.stats.elapsedMs = ENTRY_GRACE_MS;
    const t = body(w, "turret", 180, 0);
    t.patternMs = 0;
    run(w, 6500);
    expect(w.fires.filter((f) => f.alive).length).toBe(0);
  });

  it("the planter rings the player with seeds where the sower drops them underfoot", () => {
    const w = world();
    const s = body(w, "planter", 180, 0);
    s.casts = 3;
    for (let i = 0; i < 600 && w.mines.length < 4; i++) step(w, idle);
    expect(w.mines.length).toBeGreaterThanOrEqual(4);
  });

  it("the wisp's shot curls, and stops curling", () => {
    const w = world();
    w.stats.elapsedMs = ENTRY_GRACE_MS;
    const o = body(w, "wisp", 190, 0);
    o.patternMs = 0;
    for (let i = 0; i < 600 && liveBullets(w).length === 0; i++) step(w, idle);
    const b = liveBullets(w)[0];
    expect(b, "the wisp fired nothing").toBeTruthy();
    expect(b!.seekDegPerS).toBeGreaterThan(0);
    // Bounded: the curl is over well before the shot arrives, so it is
    // answered by moving late rather than by outrunning it.
    expect(b!.seekMs).toBeGreaterThan(0);
    run(w, 900);
    expect(b!.seekMs).toBeLessThan(0);
  });

  it("the orbiter's shot flies straight", () => {
    const w = world();
    w.stats.elapsedMs = ENTRY_GRACE_MS;
    const o = body(w, "orbiter", 190, 0);
    o.patternMs = 0;
    for (let i = 0; i < 600 && liveBullets(w).length === 0; i++) step(w, idle);
    const b = liveBullets(w)[0];
    expect(b, "the orbiter fired nothing").toBeTruthy();
    expect(b!.seekDegPerS).toBe(0);
  });

  it("the brooder's coal hatches a body where it lands", () => {
    const w = world();
    w.stats.elapsedMs = ENTRY_GRACE_MS;
    const b = body(w, "brooder", 200, 0);
    b.patternMs = 0;
    const before = w.enemies.length;
    run(w, 12000);
    expect(w.enemies.length).toBeGreaterThan(before);
    // Where it landed, not at the brooder: that is the whole twist.
    const born = w.enemies.filter((e) => e.archetype === "rusher");
    expect(born.length).toBeGreaterThan(0);
  });
});

describe("the expansion keeps to the room", () => {
  it("every new archetype runs a minute of a fight without leaving the floor", () => {
    for (const id of ["warden", "bellringer", "rifter", "snarecaster", "delver", "cinderling", "sower"] as const) {
      for (const affixes of [[], ["armored"]] as EliteAffix[][]) {
        const w = world();
        const e = body(w, id, 140, 60, affixes);
        body(w, "rusher", -140, 40);
        run(w, 8000);
        expect(e.x, id).toBeGreaterThan(0);
        expect(e.x, id).toBeLessThan(GRID_W * TILE_PX);
        expect(e.y, id).toBeGreaterThan(0);
        expect(e.y, id).toBeLessThan(GRID_H * TILE_PX);
        expect(Number.isFinite(w.player.x) && Number.isFinite(w.player.y), id).toBe(true);
      }
    }
  });
});

describe("a death that bursts waits before it flies", () => {
  for (const [id, affixes, kind] of [["lancer", ["swift"], "lance"], ["shooter", ["volatile"], "volatile"]] as const) {
    it(`${kind}: the spikes hang where the body fell, then fly`, () => {
      const w = world();
      const e = body(w, id, 80, 0, [...affixes]);
      e.attackCooldownMs = 1e9;
      e.spikeMs = 0;
      e.hp = 0;
      step(w, idle);
      expect(w.enemies.includes(e)).toBe(false);
      expect(w.deathBursts).toHaveLength(1);
      // Nothing flies while the spikes hang, and the room is not clear yet.
      run(w, DEATH_BURST_MS[kind] - 100);
      expect(liveCount(w.enemyBullets)).toBe(0);
      run(w, 200);
      expect(w.deathBursts).toHaveLength(0);
      expect(liveCount(w.enemyBullets)).toBe(8);
    });
  }
});



describe("the king's heart volley leaves his raised palm", () => {
  it("starts every shot at the palm, and aims from there", () => {
    const w = world();
    const king = body(w, "boss", 0, 140);
    const palm = bossPalmOf(w, king);
    expect(palm).toEqual({ x: king.x + BOSS_PALM_PX.x, y: king.y + BOSS_PALM_PX.y });
    release(w, king, [
      { at_ms: 0, aim: "fixed:0", angle_deg: 0, speed: 100, size: 1, from: "ring", path: [0, 0] },
      { at_ms: 0, aim: "fixed:0", angle_deg: 180, speed: 100, size: 1, from: "ring", path: [0, 1] },
    ], 0, palm);
    for (const b of liveBullets(w)) expect([b.x, b.y]).toEqual([palm.x, palm.y]);
  });

  it("backs in towards his centre when the palm would be in stone", () => {
    const w = world();
    const king = body(w, "boss", 0, -140);
    // A wall across where his palm is.
    const gy = Math.floor((king.y + BOSS_PALM_PX.y) / TILE_PX);
    for (let x = 0; x < GRID_W; x++) w.room.grid[gy * GRID_W + x] = Tile.Wall;
    const at = bossPalmOf(w, king);
    expect(at.y).toBeGreaterThan(king.y + BOSS_PALM_PX.y);
    expect(at.y).toBeLessThanOrEqual(king.y);
    expect(Math.floor(at.y / TILE_PX)).not.toBe(gy);
  });
});
