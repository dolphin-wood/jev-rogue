/**
 * **The four spells on machinery of their own** (doc 006): a ring that grows
 * with each cast, a ring set down on the floor, a shell lobbed over the room,
 * and a beam held on its key. The bench measures what each is worth; this
 * file measures that each does the thing its card says.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step } from "./world.ts";
import { NO_INPUT } from "./types.ts";
import type { Enemy, Input, World } from "./types.ts";
import { makeEnemy } from "./enemy.ts";
import { attachAffix } from "./spells.ts";
import { lodgeBlades } from "./recall.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { ITEMS } from "../spells/items.ts";
import { SPELL_AFFIXES, affixFitsSpell } from "../spells/affixes.ts";
import { RngSource } from "../rng.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";

const src = new RngSource("new-mechanics");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("room"), { plain: true },
);
const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
const grid = built.grid.slice();
for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
const room = { ...built, grid, zones: [] };
const PX = Math.floor(300 / TILE_PX) * TILE_PX + TILE_PX / 2;
const PY = PX;

function world(spell: string, affixes: readonly string[] = [], walls?: (g: Uint8Array) => void): World {
  const r = walls ? { ...room, grid: (() => { const c = room.grid.slice(); walls(c); return c; })() } : room;
  const w = createWorld({
    room: r, encounter: null, props: 0, staff: { slots: 6, mana_max: 200 },
    slots: [plainInstance(spell), null, null, null, null, null], hearts: 6, rng: src.stream(spell, affixes.join()),
  });
  w.player.x = PX;
  w.player.y = PY;
  w.player.facing = 0;
  for (const id of affixes) w.spells[0] = attachAffix(w.spells[0]!, id) ?? w.spells[0]!;
  return w;
}

function body(w: World, dx: number, dy: number, hp = 100_000): Enemy {
  const e = makeEnemy(w.nextEnemyId++, "rusher", PX + dx, PY + dy, []);
  e.spawnFadeMs = 0; e.awake = true; e.hp = hp; e.maxHp = hp; e.speed = 0; e.attackCooldownMs = 1e9;
  w.enemies.push(e);
  return e;
}

const aimRight = { ...NO_INPUT, aimX: PX + 200, aimY: PY };
function run(w: World, frames: number, input: (t: number) => Input): void {
  for (let t = 0; t < frames; t++) {
    w.player.mana = w.staff.mana_max;
    step(w, input(t));
    w.player.hearts = 6;
  }
}

describe("Blade Storm", () => {
  const ring = (w: World) => w.playerBullets.filter((b) => b.alive && b.orbitMs > 0);
  const press = (w: World) => { run(w, 1, () => ({ ...aimRight, spell: 0 })); run(w, 40, () => aimRight); };

  it("adds a blade each cast, and the ring widens and quickens as it grows", () => {
    const w = world("blade_storm");
    const seen: { n: number; r: number; spin: number }[] = [];
    for (let n = 0; n < 5; n++) {
      press(w);
      const r = ring(w);
      seen.push({ n: r.length, r: r[0]!.orbitRadius, spin: r[0]!.orbitDegPerS });
    }
    expect(seen.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.r).toBeGreaterThan(seen[i - 1]!.r);
      expect(seen[i]!.spin).toBeGreaterThan(seen[i - 1]!.spin);
    }
  });

  it("flings the whole ring outward on the sixth, and the next cast starts a new one", () => {
    const w = world("blade_storm");
    for (let n = 0; n < 5; n++) press(w);
    run(w, 1, () => ({ ...aimRight, spell: 0 }));
    expect(ring(w).length).toBe(6);
    run(w, 30, () => aimRight);
    expect(ring(w).length).toBe(0);
    const flung = w.playerBullets.filter((b) => b.alive && b.spellIndex === 0);
    expect(flung.length).toBe(6);
    for (const b of flung) expect(Math.hypot(b.x - w.player.x, b.y - w.player.y)).toBeGreaterThan(70);
    press(w);
    expect(ring(w).length).toBe(1);
  });

  it("cuts a body standing beyond the ring with the burst", () => {
    const w = world("blade_storm");
    const e = body(w, 100, 0);
    for (let n = 0; n < 6; n++) press(w);
    run(w, 30, () => aimRight);
    expect(e.hp).toBeLessThan(e.maxHp);
  });
});

describe("Blade Recall", () => {
  it("does nothing, and spends nothing, with no blade out", () => {
    const w = world("blade_recall");
    body(w, 60, 0);
    w.player.mana = 50;
    step(w, { ...aimRight, spell: 0 });
    expect(w.player.mana).toBeGreaterThanOrEqual(50);
    expect(w.playerBullets.some((b) => b.alive)).toBe(false);
  });

  it("keeps one blade out per blow, up to six, and one outlives its body where it fell", () => {
    const w = world("blade_recall");
    const e = body(w, 30, 0);
    for (let n = 0; n < 8; n++) lodgeBlades(w, e);
    expect(w.lodged.length).toBe(6);
    e.hp = 0;
    run(w, 2, () => aimRight);
    expect(w.lodged.length).toBe(6);
    expect(w.lodged.every((b) => b.enemyId === -1)).toBe(true);
  });

  it("rips every blade out on the press and cuts what stands between it and the caster", () => {
    const w = world("blade_recall");
    const far = body(w, 150, 0);
    const between = body(w, 75, 0);
    for (let n = 0; n < 3; n++) lodgeBlades(w, far);
    // The press, and its windup.
    run(w, 1, () => ({ ...aimRight, spell: 0 }));
    run(w, 6, () => aimRight);
    expect(w.lodged.length).toBe(0);
    run(w, 60, () => aimRight);
    expect(far.hp).toBeLessThan(far.maxHp);
    expect(between.hp).toBeLessThan(between.maxHp);
    // Every blade was caught: none left flying.
    expect(w.playerBullets.some((b) => b.alive && b.delivery === "boomerang")).toBe(false);
  });

  it("calls its blades home by itself on the blow that fills it, without the key", () => {
    const w = world("blade_recall");
    const e = body(w, 22, 0);
    let flew = false;
    for (let t = 0; t < 600 && !flew; t++) {
      w.player.mana = w.staff.mana_max;
      step(w, { ...aimRight, swing: true });
      w.player.hearts = 6;
      if (w.playerBullets.some((b) => b.alive && b.delivery === "boomerang")) flew = true;
    }
    expect(flew).toBe(true);
    expect(w.lodged.length).toBeLessThan(6);
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it("is loaded by the sword's own blows", () => {
    const w = world("blade_recall");
    body(w, 22, 0);
    run(w, 40, () => ({ ...aimRight, swing: true }));
    expect(w.lodged.length).toBeGreaterThan(0);
  });
});

describe("Blade Rift", () => {
  it("spins on the floor where it was set while the caster walks away", () => {
    const w = world("blade_rift");
    run(w, 1, () => ({ ...aimRight, spell: 0 }));
    const blades = w.playerBullets.filter((b) => b.alive && b.orbitMs > 0);
    expect(blades.length).toBe(3);
    const cx = blades[0]!.orbitX, cy = blades[0]!.orbitY;
    expect(cx).toBeGreaterThan(PX + 40);
    run(w, 60, () => ({ ...aimRight, moveX: -1 }));
    expect(w.player.x).toBeLessThan(PX - 20);
    for (const b of w.playerBullets.filter((x) => x.alive && x.orbitMs > 0))
      expect(Math.hypot(b.x - cx, b.y - cy)).toBeLessThan(b.orbitRadius + 1);
  });

  it("cuts a body standing at its centre", () => {
    const w = world("blade_rift");
    const e = body(w, 70, 0);
    run(w, 120, () => ({ ...aimRight, spell: 0 }));
    expect(e.hp).toBeLessThan(e.maxHp);
  });
});

describe("Mortar", () => {
  it("comes down on the body it seeks, not at a fixed reach", () => {
    const w = world("mortar");
    const e = body(w, 110, 30);
    let landed: { x: number; y: number } | null = null;
    for (let t = 0; t < 90 && !landed; t++) {
      w.player.mana = w.staff.mana_max;
      step(w, t === 0 ? { ...aimRight, spell: 0 } : aimRight);
      const ev = w.events.find((v) => v.kind === "eruption" && v.what === "mortar");
      if (ev) landed = { x: ev.x, y: ev.y };
    }
    expect(landed).not.toBeNull();
    expect(Math.hypot(landed!.x - e.x, landed!.y - e.y)).toBeLessThan(8);
  });

  it("flies over a wall and lands on the bodies beyond it", () => {
    // A wall column between the caster and the bodies: a shot would stop on it.
    const wallGx = Math.floor((PX + 60) / TILE_PX);
    const w = world("mortar", [], (c) => { for (let gy = 1; gy < GRID_H - 1; gy++) c[gy * GRID_W + wallGx] = Tile.Wall; });
    const near = body(w, 140, 0);
    const beside = body(w, 150, 22);
    run(w, 90, (t) => (t === 0 ? { ...aimRight, spell: 0 } : aimRight));
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(beside.hp).toBeLessThan(beside.maxHp);
  });

  it("lands its whole damage on every body in reach when it chains", () => {
    const w = world("mortar", ["chain"]);
    const pack = [body(w, 150, 0), body(w, 150, 20), body(w, 150, -20), body(w, 165, 8)];
    run(w, 90, (t) => (t === 0 ? { ...aimRight, spell: 0 } : aimRight));
    const full = ITEMS.get("mortar")!.params["damage"] as number;
    // Each body the shell came down on took the landing, not a chained copy's scrap.
    for (const e of pack) expect(e.maxHp - e.hp).toBeGreaterThanOrEqual(full * 0.5);
  });

  it("strikes nothing on the way", () => {
    const w = world("mortar");
    // Under the flight, a little off the aim: the shell seeks the body on it.
    const between = body(w, 70, 16);
    const target = body(w, 150, 0);
    let lifted = 0;
    for (let t = 0; t < 90; t++) {
      w.player.mana = w.staff.mana_max;
      step(w, t === 0 ? { ...aimRight, spell: 0 } : aimRight);
      for (const b of w.playerBullets) if (b.alive && b.delivery === "lob") lifted = Math.max(lifted, b.lift);
    }
    expect(lifted).toBeGreaterThan(10);
    expect(target.hp).toBeLessThan(target.maxHp);
    // The body it flew over is outside the landing's reach and was never touched.
    expect(between.hp).toBe(between.maxHp);
  });

  it("sets off its hit affixes where it lands, and is not dealt the ones for a shot's flight", () => {
    const w = world("mortar", ["brand"]);
    const e = body(w, 150, 0);
    run(w, 90, (t) => (t === 0 ? { ...aimRight, spell: 0 } : aimRight));
    expect(e.marked).toBe(true);
    const mortar = ITEMS.get("mortar")!;
    for (const id of ["pierce", "seek", "ricochet", "shatter", "fork"])
      expect(affixFitsSpell(SPELL_AFFIXES.find((a) => a.id === id)!, mortar, []), id).toBe(false);
    for (const id of ["brand", "chain", "harvest", "cull", "kindle"])
      expect(affixFitsSpell(SPELL_AFFIXES.find((a) => a.id === id)!, mortar, []), id).toBe(true);
  });
});

describe("Void Ray", () => {
  it("burns what it crosses for as long as the key is held, paying at the press and on while held", () => {
    const w = world("void_ray");
    const e = body(w, 120, 0);
    let spent = 0;
    for (let t = 0; t < 90; t++) {
      const before = w.player.mana = w.staff.mana_max;
      step(w, { ...aimRight, spell: 0 });
      spent += before - w.player.mana;
      w.player.hearts = 6;
    }
    expect(e.hp).toBeLessThan(e.maxHp);
    // Ninety frames held, one beam: the press's cost, and the drain for the second and a half it burned.
    const ray = ITEMS.get("void_ray")!;
    const cost = 5 + 2.5 * ray.mana + Number(ray.params["drain_per_s"]) * 1.5;
    expect(spent).toBeLessThan(cost * 1.3);
    expect(spent).toBeGreaterThan(cost * 0.5);
  });

  it("goes out when the key comes up, and when the caster dashes", () => {
    const w = world("void_ray");
    run(w, 10, () => ({ ...aimRight, spell: 0 }));
    expect(w.beams.some((b) => b.alive)).toBe(true);
    run(w, 2, () => aimRight);
    expect(w.beams.some((b) => b.alive)).toBe(false);
    expect(w.player.channelKey).toBe(-1);

    const d = world("void_ray");
    run(d, 10, () => ({ ...aimRight, spell: 0 }));
    run(d, 1, () => ({ ...aimRight, spell: 0, moveX: 1, dash: true }));
    run(d, 1, () => ({ ...aimRight, moveX: 1 }));
    expect(d.beams.some((b) => b.alive && b.channel)).toBe(false);
  });

  it("turns after a body off the facing's axis, and the bar running dry puts it out", () => {
    const w = world("void_ray");
    // Up and to the right: nowhere on the four ways the facing snaps to.
    const e = body(w, 110, -55);
    run(w, 60, () => ({ ...aimRight, spell: 0 }));
    expect(e.hp).toBeLessThan(e.maxHp);
    const dry = world("void_ray");
    body(dry, 110, 0);
    dry.player.mana = 12;
    for (let t = 0; t < 200 && (t === 0 || dry.player.channelKey >= 0); t++) step(dry, { ...aimRight, spell: 0 });
    expect(dry.player.channelKey).toBe(-1);
    expect(dry.beams.some((b) => b.alive && b.channel)).toBe(false);
  });

  it("is stopped by the first wall", () => {
    const wallGx = Math.floor((PX + 80) / TILE_PX);
    const w = world("void_ray", [], (c) => { for (let gy = 1; gy < GRID_H - 1; gy++) c[gy * GRID_W + wallGx] = Tile.Wall; });
    const beyond = body(w, 160, 0);
    run(w, 40, () => ({ ...aimRight, spell: 0 }));
    const beam = w.beams.find((b) => b.alive)!;
    expect(beam.x1).toBeLessThan(wallGx * TILE_PX + 2);
    expect(beyond.hp).toBe(beyond.maxHp);
  });
});
