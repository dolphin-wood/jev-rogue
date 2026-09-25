/**
 * **The reference player presses doc 006's two key-changing options the way
 * the game means them** — a `charge` spell held to a full charge and let go,
 * a `charges` spell pressed only when a press fires — so a run the Director
 * is measured on uses those spells as the browser's player does.
 */
import { describe, expect, it } from "vitest";
import {
  RngSource, createWorld, generateRoom, makeEnemy, plainInstance, step, toRoomPlan, chargeMsOf, ITEMS,
  STEP_MS, NO_INPUT, GRID_W, GRID_H, Tile,
} from "@jr/core";
import type { World } from "@jr/core";
import { referenceInput } from "./player-model.ts";
import { SKILL_PROFILES } from "./skill.ts";
import { hitIncoming, holdsKey, keyWanted } from "./hands.ts";

const src = new RngSource("hands");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "standard", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("r"), { plain: true },
);
const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
const grid = built.grid.slice();
for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
const room = { ...built, grid, zones: [] };

/** The player with one spell, and a pinned body across the room that the sword cannot reach. */
function duel(spell: string): World {
  const w = createWorld({
    room, encounter: null, props: 0, staff: { slots: 3, mana_max: 90 },
    slots: [plainInstance(spell), null, null], hearts: 99, rng: src.stream("w", spell), invincible: true,
  });
  w.player.x = 200;
  w.player.y = 300;
  const e = makeEnemy(w.nextEnemyId++, "rusher", 420, 300, []);
  e.spawnFadeMs = 0; e.awake = true; e.hp = 1e6; e.maxHp = 1e6; e.speed = 0; e.attackCooldownMs = 1e9;
  w.enemies.push(e);
  return w;
}

function play(w: World, ms: number, onStep: (w: World) => void): void {
  const body = w.enemies[0]!;
  const home = { x: body.x, y: body.y };
  for (let t = 0; t < ms; t += STEP_MS) {
    w.player.mana = w.staff.mana_max;
    step(w, referenceInput(w, SKILL_PROFILES.expert));
    body.x = home.x; body.y = home.y; body.attackCooldownMs = 1e9;
    onStep(w);
  }
}

describe("the reference player's hands", () => {
  it("holds a charge spell to a full charge before letting it go", () => {
    const w = duel("arcane_cannon");
    const full = chargeMsOf(ITEMS, "arcane_cannon");
    let held = 0;
    const releases: number[] = [];
    play(w, 8000, (x) => {
      if (x.player.chargeKey === 0) held = x.player.chargeMs;
      else if (held > 0) { releases.push(held); held = 0; }
    });
    expect(releases.length).toBeGreaterThan(1);
    for (const r of releases) expect(r).toBeGreaterThanOrEqual(full);
    expect(w.stats.damageDealt).toBeGreaterThan(0);
  });

  it("presses a charges spell only when a press fires, so its bank refills", () => {
    const w = duel("mana_darts");
    let refused = 0;
    play(w, 6000, (x) => { refused += x.events.filter((e) => e.kind === "cast_refused").length; });
    expect(refused).toBe(0);
    expect(w.stats.shotsFired).toBeGreaterThan(8);
  });

  it("goes round all three keys rather than leaning on the first", () => {
    // Earth Spikes' cooldown is shorter than its own windup and recovery, so
    // pressing the first ready key cast it every time the hands were free and
    // the other two keys never (doc 011, the rotation).
    const w = createWorld({
      room, encounter: null, props: 0, staff: { slots: 3, mana_max: 90 },
      slots: [plainInstance("earth_spikes"), plainInstance("frost_needle"), plainInstance("spark_spray")],
      hearts: 99, rng: src.stream("w", "rotation"), invincible: true,
    });
    w.player.x = 200;
    w.player.y = 300;
    const e = makeEnemy(w.nextEnemyId++, "tank", 330, 300, []);
    e.spawnFadeMs = 0; e.awake = true; e.hp = 1e6; e.maxHp = 1e6; e.speed = 0; e.attackCooldownMs = 1e9;
    w.enemies.push(e);
    const casts = [0, 0, 0];
    const was = [0, 0, 0];
    play(w, 8000, (x) => x.spells.forEach((sl, i) => {
      if (sl && sl.cooldownMs > was[i]! + 1) casts[i]!++;
      was[i] = sl?.cooldownMs ?? 0;
    }));
    for (const n of casts) expect(n).toBeGreaterThan(2);
    expect(Math.max(...casts)).toBeLessThan(3 * Math.min(...casts));
  });

  it("lets a charge spell's key up for the step that fires it, and holds every other key", () => {
    const w = duel("arcane_cannon");
    expect(holdsKey(w, 0)).toBe(true);
    step(w, { ...NO_INPUT, aimX: 420, aimY: 300, spell: 0 });
    w.player.chargeMs = chargeMsOf(ITEMS, "arcane_cannon");
    expect(holdsKey(w, 0)).toBe(false);
    expect(holdsKey(w, 0, "tap")).toBe(false);
    expect(holdsKey(duel("magic_bolt"), 0)).toBe(true);
  });
});

/**
 * **And doc 006's shapes whose key is a moment** (`keyWanted`): a stance as
 * a hit is about to land, an enchant before closing to swing, a trail while
 * moving, a thrown blade at a body it reaches.
 */
describe("the reference player's moments", () => {
  const still = { moving: false, target: null };

  it("raises a stance only when a hit is about to land, and not over one already up", () => {
    const w = duel("counter_stance");
    expect(keyWanted(w, 0, still)).toBe(false);
    // A shot on its way in.
    const b = w.enemyBullets.find((x) => !x.alive)!;
    b.alive = true; b.x = w.player.x + 60; b.y = w.player.y; b.vx = -240; b.vy = 0; b.radius = 3; b.lifeMs = 2000;
    expect(hitIncoming(w, 700)).toBe(true);
    expect(keyWanted(w, 0, still)).toBe(true);
    // A shot passing wide is no threat.
    b.y = w.player.y + 60;
    expect(hitIncoming(w, 700)).toBe(false);
    // A blade winding up within reach.
    const e = w.enemies[0]!;
    e.x = w.player.x + 20; e.attack = "windup"; e.attackMs = 200;
    expect(keyWanted(w, 0, still)).toBe(true);
    step(w, { ...NO_INPUT, aimX: e.x, aimY: e.y, spell: 0 });
    expect(w.player.stance).not.toBeNull();
    expect(keyWanted(w, 0, still)).toBe(false);
  });

  it("raises an enchant with a body a few steps off, and not across the room", () => {
    const w = duel("crescent_edge");
    expect(keyWanted(w, 0, still)).toBe(false);
    w.enemies[0]!.x = w.player.x + 80;
    expect(keyWanted(w, 0, still)).toBe(true);
  });

  it("lays a trail while moving near a body, never standing still", () => {
    const w = duel("cinder_stride");
    w.enemies[0]!.x = w.player.x + 90;
    expect(keyWanted(w, 0, still)).toBe(false);
    expect(keyWanted(w, 0, { moving: true, target: null })).toBe(true);
  });

  it("raises a line of spikes only at a body the line reaches", () => {
    const w = duel("earth_spikes");
    const p = ITEMS.get("earth_spikes")!.params;
    const length = (Number(p["first"]) + (Number(p["count"]) - 1) * Number(p["step"])) * 32;
    expect(keyWanted(w, 0, { moving: false, target: { x: w.player.x + length * 1.6, y: w.player.y } })).toBe(false);
    expect(keyWanted(w, 0, { moving: false, target: { x: w.player.x + length * 0.8, y: w.player.y } })).toBe(true);
  });

  it("throws a blade only at a body it reaches", () => {
    const w = duel("returning_edge");
    const reach = Number(ITEMS.get("returning_edge")!.params["reach"]);
    expect(keyWanted(w, 0, { moving: false, target: { x: w.player.x + reach * 2, y: w.player.y } })).toBe(false);
    expect(keyWanted(w, 0, { moving: false, target: { x: w.player.x + reach * 0.8, y: w.player.y } })).toBe(true);
  });

  it("never presses a stance in a fight where nothing strikes, and lays a trail as it closes", () => {
    const guard = duel("counter_stance");
    let stances = 0;
    play(guard, 6000, (x) => { stances += x.events.filter((e) => e.kind === "spell" && e.what === "stance").length; });
    expect(stances).toBe(0);
    const trail = duel("cinder_stride");
    let trails = 0;
    let movingAtCast = true;
    const before = { x: trail.player.x, y: trail.player.y };
    play(trail, 6000, (x) => {
      for (const e of x.events) if (e.kind === "spell" && e.what === "trail") {
        trails++;
        if (Math.hypot(x.player.x - before.x, x.player.y - before.y) < 0.01) movingAtCast = false;
      }
      before.x = x.player.x; before.y = x.player.y;
    });
    expect(trails).toBeGreaterThan(0);
    expect(movingAtCast).toBe(true);
  });
});
