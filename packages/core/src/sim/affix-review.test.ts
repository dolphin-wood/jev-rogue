/**
 * **What the spell-by-affix review changed** (`pnpm spell-bench matrix`):
 * the pairs that fitted and made the spell worse or did nothing are no longer
 * dealt, a heavy blow fills a status gauge by its weight, an aftershock is a
 * share of the spell's own hit, and a doom mark's burst is the spell's hit.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step } from "./world.ts";
import { NO_INPUT } from "./types.ts";
import type { Enemy, World } from "./types.ts";
import { makeEnemy } from "./enemy.ts";
import { attachAffix } from "./spells.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { ITEMS } from "../spells/items.ts";
import { EXPANSE_RADIUS, LINGER_DURATION, SPELL_AFFIXES, affixFitsSpell } from "../spells/affixes.ts";
import { RngSource } from "../rng.ts";
import { GRID_W, GRID_H, Tile } from "../types.ts";

const src = new RngSource("affix-review");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("room"), { plain: true },
);
const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
const grid = built.grid.slice();
for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
const room = { ...built, grid, zones: [] };
const PX = 300, PY = 300;

function world(spell: string, affixes: readonly string[] = []): World {
  const w = createWorld({
    room, encounter: null, props: 0, staff: { slots: 6, mana_max: 200 },
    slots: [plainInstance(spell), null, null, null, null, null], hearts: 6, rng: src.stream(spell, affixes.join()),
  });
  w.player.x = PX; w.player.y = PY; w.player.facing = 0;
  for (const id of affixes) w.spells[0] = attachAffix(w.spells[0]!, id) ?? w.spells[0]!;
  return w;
}

function body(w: World, dx: number, dy: number): Enemy {
  const e = makeEnemy(w.nextEnemyId++, "rusher", PX + dx, PY + dy, []);
  e.spawnFadeMs = 0; e.awake = true; e.hp = 1e6; e.maxHp = 1e6; e.speed = 0; e.attackCooldownMs = 1e9;
  w.enemies.push(e);
  return e;
}

const aim = { ...NO_INPUT, aimX: PX + 200, aimY: PY };
function press(w: World, frames: number): void {
  for (let t = 0; t < frames; t++) {
    w.player.mana = w.staff.mana_max;
    step(w, t === 0 ? { ...aim, spell: 0 } : aim);
    w.player.hearts = 6;
  }
}

const fits = (affix: string, spell: string) =>
  affixFitsSpell(SPELL_AFFIXES.find((a) => a.id === affix)!, ITEMS.get(spell)!, []);

describe("pairs that fitted and made the spell worse", () => {
  it("deals no fork or seek to a spell that passes through bodies", () => {
    for (const id of ["arc_lance", "fault_line", "void_orb", "arcane_cannon", "frozen_orb", "cinder_burst"]) {
      expect(fits("fork", id), id).toBe(false);
      expect(fits("seek", id), id).toBe(false);
    }
    expect(fits("fork", "magic_bolt")).toBe(true);
  });

  it("casts no guard free and puts no rune in the way of the hit it waits for", () => {
    for (const a of ["retort", "slipstream", "parting", "ward"]) expect(fits(a, "counter_stance"), a).toBe(false);
  });

  it("casts a run with a wake (Dash Slash) free nowhere: it would be a standing cut", () => {
    for (const a of ["slipstream", "retort", "resonance", "parting", "whirl"]) expect(fits(a, "dash_slash"), a).toBe(false);
    expect(fits("resonance", "blink_strike")).toBe(true);
  });

  it("puts no element on a pillar, and no second recall after the blades are home", () => {
    for (const a of ["kindle", "rime", "blight"]) expect(fits(a, "stone_ward"), a).toBe(false);
    expect(fits("repeat", "blade_recall")).toBe(false);
  });

  it("keeps casting behind on a dash away for the spells pressed up close", () => {
    for (const i of ITEMS.values())
      expect(fits("parting", i.id), i.id).toBe(!(i.tags ?? []).includes("long") && i.params["shape"] !== "stance" && !(Number(i.params["wake_reach"] ?? 0) > 0));
  });
});

describe("a heavy blow fills a gauge by its weight", () => {
  it("sets a body burning with one Mortar shell", () => {
    const w = world("mortar", ["kindle"]);
    const e = body(w, 150, 0);
    press(w, 80);
    expect(e.burnMs).toBeGreaterThan(0);
  });

  it("leaves a light spell needing more than one hit", () => {
    const w = world("magic_bolt", ["kindle"]);
    const e = body(w, 120, 0);
    for (let t = 0; t < 40 && e.hp === e.maxHp; t++) { w.player.mana = 200; step(w, t === 0 ? { ...aim, spell: 0 } : aim); }
    expect(e.hp).toBeLessThan(e.maxHp);
    expect(e.burnMs).toBe(0);
    expect(e.burnBuild).toBeGreaterThan(0);
  });
});

describe("an aftershock is a share of the spell's own hit", () => {
  const shock = (spell: string) => {
    const w = world(spell, ["aftershock"]);
    body(w, 120, 0);
    w.player.mana = 200;
    step(w, { ...aim, spell: 0 });
    for (let t = 0; t < 20 && w.dooms.length === 0; t++) step(w, aim);
    return w.dooms.find((d) => d.tag === "aftershock")?.damage ?? 0;
  };

  it("bursts harder under a heavy spell than under a light one", () => {
    expect(shock("glacier_spike")).toBeGreaterThan(shock("magic_bolt") * 1.5);
    expect(shock("spark_spray")).toBeLessThan(shock("magic_bolt"));
  });
});

describe("a doom mark bursts as the spell's hit", () => {
  it("puts the spell's element on every body the burst reaches", () => {
    const w = world("doom_sigil", ["blight"]);
    const marked = body(w, 120, 0);
    const beside = body(w, 128, 14);
    press(w, 360);
    expect(marked.poisonMs + marked.poisonBuild).toBeGreaterThan(0);
    expect(beside.poisonMs + beside.poisonBuild).toBeGreaterThan(0);
  });
});

describe("expanse makes the spell's area larger, whatever its shape", () => {
  /** The area figure one cast of each shape leaves in the world, read the moment it is there. */
  const AREA: readonly [string, (w: World) => number | undefined][] = [
    ["magic_bolt", (w) => w.playerBullets.find((b) => b.alive)?.radius],
    ["spirit_blades", (w) => w.playerBullets.find((b) => b.alive && b.orbitMs > 0)?.radius],
    ["wildfire_field", (w) => w.fires.find((f) => f.alive)?.radius],
    ["void_maw", (w) => w.vortices.find((v) => v.alive)?.radius],
    ["earth_spikes", (w) => w.eruptions.find((c) => c.alive)?.radius],
    ["returning_edge", (w) => w.playerBullets.find((b) => b.alive && b.delivery === "boomerang")?.radius],
    ["ball_lightning", (w) => w.orbs.find((o) => o.alive)?.zapReach],
    ["mortar", (w) => w.playerBullets.find((b) => b.alive && b.delivery === "lob")?.lobRadius],
    ["void_ray", (w) => w.beams.find((b) => b.alive)?.width],
    ["cinder_stride", (w) => w.player.trail?.patch.radius],
    ["counter_stance", (w) => w.player.stance?.radius],
    ["blink_strike", (w) => (w.player.strikeRadius > 0 ? w.player.strikeRadius : undefined)],
  ];
  const areaOf = (spell: string, read: (w: World) => number | undefined, affixes: readonly string[]) => {
    const w = world(spell, affixes);
    body(w, 110, 0);
    for (let t = 0; t < 40; t++) {
      w.player.mana = w.staff.mana_max;
      step(w, t === 0 ? { ...aim, spell: 0 } : aim);
      const a = read(w);
      if (a !== undefined && a > 0) return a;
    }
    return 0;
  };

  for (const [spell, read] of AREA)
    it(`on ${spell}`, () => {
      expect(fits("expanse", spell)).toBe(true);
      const bare = areaOf(spell, read, []);
      expect(bare).toBeGreaterThan(0);
      expect(areaOf(spell, read, ["expanse"])).toBeCloseTo(bare * EXPANSE_RADIUS, 0);
    });

  it("keeps a ring of blades at arm's length: its blades are larger, not further out", () => {
    const ring = (affixes: readonly string[]) => {
      const w = world("spirit_blades", affixes);
      step(w, { ...aim, spell: 0 });
      for (let t = 0; t < 10; t++) step(w, aim);
      return w.playerBullets.find((b) => b.alive && b.orbitMs > 0)!.orbitRadius;
    };
    expect(ring(["expanse"])).toBe(ring([]));
  });
});

describe("linger makes what a spell leaves last longer, whatever its shape", () => {
  /** How long the thing one cast of each lasting shape leaves has to live, read the moment it is there. */
  const TIME: readonly [string, (w: World) => number | undefined][] = [
    ["spirit_blades", (w) => w.playerBullets.find((b) => b.alive && b.orbitMs > 0)?.orbitMs],
    ["wildfire_field", (w) => w.fires.find((f) => f.alive)?.lifeMs],
    ["void_maw", (w) => w.vortices.find((v) => v.alive)?.lifeMs],
    ["spirit_ally", (w) => w.pets.find((p) => p.alive)?.lifeMs],
    ["ball_lightning", (w) => w.orbs.find((o) => o.alive)?.lifeMs],
    ["cinder_stride", (w) => w.player.trail?.ms],
    ["crescent_edge", (w) => w.player.enchant?.ms],
  ];
  const timeOf = (spell: string, read: (w: World) => number | undefined, affixes: readonly string[]) => {
    const w = world(spell, affixes);
    body(w, 110, 0);
    for (let t = 0; t < 40; t++) {
      w.player.mana = w.staff.mana_max;
      step(w, t === 0 ? { ...aim, spell: 0 } : aim);
      const a = read(w);
      if (a !== undefined && a > 0) return a;
    }
    return 0;
  };

  for (const [spell, read] of TIME)
    it(`on ${spell}`, () => {
      expect(fits("linger", spell)).toBe(true);
      const bare = timeOf(spell, read, []);
      expect(bare).toBeGreaterThan(0);
      // Read on the same step of the cast, so the one step's run-down is on both sides.
      expect(timeOf(spell, read, ["linger"]) / bare).toBeCloseTo(LINGER_DURATION, 1);
    });

  it("is dealt to no shot, whose lifetime is its range", () => {
    for (const id of ["magic_bolt", "stone_shard", "returning_edge", "earth_spikes", "dash_slash"]) expect(fits("linger", id), id).toBe(false);
  });
});
