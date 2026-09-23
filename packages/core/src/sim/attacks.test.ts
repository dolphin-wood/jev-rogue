import { describe, it, expect } from "vitest";
import { createWorld, step } from "./world.ts";
import { NO_INPUT } from "./types.ts";
import type { Enemy, Input, World } from "./types.ts";
import { makeEnemy, wake } from "./enemy.ts";
import { castRift, flameRays, plantMine, FLAME_ROLL_MS, MINE_INERT_MS, MINE_PRIME_MS, MUSKET_RANGE, RIFT_TELE_MS, WARD_ARMOUR } from "./attacks.ts";
import { lightFire } from "./fire.ts";
import { DEATH_BURST_MS } from "./world.ts";
import { liveCount } from "./bullets.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";
import type { EliteAffix } from "../types.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { staffFor, plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";

const src = new RngSource("attacks-test");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
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
    staff: staffFor({ slots: "many", mana: "high", tempo: "steady", special: "none" }),
    slots: [plainInstance("magic_bolt"), null, null],
    hearts: 6, rng: src.stream("w"),
  });
  w.player.x = 320;
  w.player.y = 208;
  return w;
}

const idle: Input = NO_INPUT;

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
});

describe("the delver", () => {
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

describe("elite attacks are different attacks", () => {
  it("the elite turret splits the floor instead of calling lightning", () => {
    const w = world();
    const t = body(w, "turret", 180, 0, ["armored"]);
    t.patternMs = 0;
    run(w, 6500);
    expect(w.rifts.length + w.stats.heartsLost).toBeGreaterThan(0);
    expect(t.strike.markMs).toBeLessThanOrEqual(0);
  });

  it("the elite sower plants a ring round the player", () => {
    const w = world();
    const s = body(w, "sower", 180, 0, ["armored"]);
    s.casts = 3;
    for (let i = 0; i < 600 && w.mines.length < 4; i++) step(w, idle);
    expect(w.mines.length).toBeGreaterThanOrEqual(4);
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


