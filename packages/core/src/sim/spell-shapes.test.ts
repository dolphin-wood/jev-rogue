/**
 * **The rules of doc 006's newer shapes, one at a time**, and the field that
 * honours its element.
 *
 * Each shape is a sentence in doc 006 and each sentence is easy to get almost
 * right: a blade that hits a body three times as it passes, or flies home to
 * where it was thrown from; an orb that also hurts what it touches, or a
 * fourth orb that joins three; a trail that drops on a clock, so standing
 * still lays ground; an enchant that throws its wave only when the swing
 * lands, or quietly makes the sword hit harder; a stance that eats every hit
 * rather than the first, or answers nothing when nothing came; a poison
 * cloud that burns. So each is pinned here by the sentence it is said with.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step, STANCE_GUARD_MS } from "./world.ts";
import { NO_INPUT, STEP_MS } from "./types.ts";
import type { Enemy, Input, World } from "./types.ts";
import { makeEnemy } from "./enemy.ts";
import { lastingMs, slotCooldownMs, slotCost } from "./spells.ts";
import { fireUnit } from "./cast.ts";
import { freeCastScope } from "./spells.ts";
import { fullReach, SWING_ACTIVE_MS, SWING_DAMAGE, SWING_DAMAGE as SWORD_DAMAGE } from "./melee.ts";
import { waveCentre, waveRadius } from "./shapes.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { ITEMS, plainInstance } from "../spells/index.ts";
import { SPELL_DAMAGE_SCALE } from "./cast.ts";
import { RngSource } from "../rng.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";

const src = new RngSource("spell-shapes");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("room"), { plain: true },
);
const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
const grid = built.grid.slice();
for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
const room = { ...built, grid, zones: [] };
const PX = 304;
const PY = 304;

function arena(spell: string, seed = spell): World {
  const w = createWorld({
    room, encounter: null, props: 0,
    staff: { slots: 3, mana_max: 90 },
    slots: [plainInstance(spell), null, null],
    hearts: 6, rng: src.stream("w", seed),
  });
  w.player.x = PX;
  w.player.y = PY;
  w.player.facing = 0;
  return w;
}

function body(w: World, dx: number, dy: number, hp = 100_000): Enemy {
  const e = makeEnemy(w.nextEnemyId++, "rusher", PX + dx, PY + dy, []);
  e.spawnFadeMs = 0;
  e.awake = true;
  e.hp = hp;
  e.maxHp = Math.max(hp, e.maxHp);
  e.speed = 0;
  e.attackCooldownMs = 1e9;
  w.enemies.push(e);
  return e;
}

const at = (x: number, y: number, extra: Partial<Input> = {}): Input => ({ ...NO_INPUT, aimX: x, aimY: y, ...extra });

/** Steps `n` times, holding the bodies (and, unless told otherwise, the player) in place. */
function run(w: World, input: Input | ((i: number) => Input), n: number, pinned: readonly Enemy[] = [], holdPlayer = true): void {
  const home = pinned.map((e) => ({ x: e.x, y: e.y }));
  const me = { x: w.player.x, y: w.player.y };
  for (let i = 0; i < n; i++) {
    step(w, typeof input === "function" ? input(i) : input);
    pinned.forEach((e, k) => { e.x = home[k]!.x; e.y = home[k]!.y; e.attackCooldownMs = 1e9; e.attack = "approach"; });
    if (holdPlayer) { w.player.x = me.x; w.player.y = me.y; }
  }
}

const hurt = (e: Enemy): number => e.maxHp - e.hp;
const hitsOn = (w: World, e: Enemy): number =>
  w.events.filter((ev) => ev.kind === "enemy_hit" && ev.what === e.archetype && Math.hypot(ev.x - e.x, ev.y - e.y) < e.radius + 12).length;

/**
 * Presses the key and steps until the cast has left the hand: a spell with a
 * windup is not out on the step its key goes down.
 */
function press(w: World, input: Input, pinned: readonly Enemy[] = []): void {
  step(w, { ...input, spell: 0 });
  for (let i = 0; i < 30 && w.player.castPending >= 0; i++) run(w, { ...input, spell: null }, 1, pinned);
}

/** An enemy shot landing on the player this step. */
function shoot(w: World): void {
  const b = w.enemyBullets.find((x) => !x.alive)!;
  b.alive = true; b.x = w.player.x; b.y = w.player.y; b.vx = 0; b.vy = 0;
  b.radius = 3; b.lifeMs = 200; b.damage = 1; b.from = "shooter";
}

describe("boomerang (Returning Edge)", () => {
  const item = ITEMS.get("returning_edge")!;
  const reach = Number(item.params["reach"]);

  it("hits each body once on the way out and once on the way back", () => {
    const w = arena("returning_edge");
    const near = body(w, 40, 0);
    const far = body(w, 80, 0);
    let nearHits = 0;
    let farHits = 0;
    press(w, at(near.x, near.y), [near, far]);
    for (let i = 0; i < 240 && w.playerBullets.some((b) => b.alive && b.delivery === "boomerang"); i++) {
      step(w, at(near.x, near.y));
      nearHits += hitsOn(w, near);
      farHits += hitsOn(w, far);
      near.x = PX + 40; near.y = PY; far.x = PX + 80; far.y = PY;
    }
    expect(nearHits).toBe(2);
    expect(farHits).toBe(2);
  });

  it("turns at its reach and comes back to where the caster is now, not where it was thrown from", () => {
    const w = arena("returning_edge");
    press(w, at(PX + 200, PY));
    const blade = w.playerBullets.find((b) => b.alive && b.delivery === "boomerang")!;
    let furthest = 0;
    let caughtAt: { x: number; y: number } | null = null;
    for (let i = 0; i < 300; i++) {
      // The caster walks away downward while the blade is out.
      step(w, at(PX + 200, PY, { moveY: 1 }));
      if (blade.alive) furthest = Math.max(furthest, blade.x - PX);
      const caught = w.events.find((ev) => ev.kind === "spell" && ev.what === "boomerang_caught");
      if (caught) { caughtAt = { x: caught.x, y: caught.y }; break; }
    }
    expect(furthest).toBeGreaterThan(reach * 0.9);
    expect(furthest).toBeLessThan(reach + 12);
    expect(caughtAt).not.toBeNull();
    // Caught where the caster had got to: well below the throw.
    expect(caughtAt!.y - PY).toBeGreaterThan(60);
    expect(Math.hypot(caughtAt!.x - w.player.x, caughtAt!.y - w.player.y)).toBeLessThan(2);
  });

  it("slows on the way out", () => {
    const w = arena("returning_edge");
    press(w, at(PX + 200, PY));
    const blade = w.playerBullets.find((b) => b.alive && b.delivery === "boomerang")!;
    const early = Math.hypot(blade.vx, blade.vy);
    let late = early;
    for (let i = 0; i < 200 && !blade.returning; i++) { late = Math.hypot(blade.vx, blade.vy); run(w, at(PX + 200, PY), 1); }
    expect(blade.returning).toBe(true);
    expect(late).toBeLessThan(early * 0.5);
  });

  it("cast free, is thrown toward the hook's body", () => {
    const w = arena("returning_edge");
    const e = body(w, 0, 90);
    fireUnit(w, w.spells[0]!.item, freeCastScope(w.spells[0]!, 0), ITEMS, [], w.player, e);
    const blade = w.playerBullets.find((b) => b.alive && b.delivery === "boomerang")!;
    expect(blade.vy).toBeGreaterThan(0);
    expect(Math.abs(blade.vx)).toBeLessThan(1e-6);
  });
});

describe("orb (Ball Lightning)", () => {
  const item = ITEMS.get("ball_lightning")!;
  const max = Number(item.params["max_alive"]);

  it("keeps at most its cap from one key alive, a new one replacing the oldest", () => {
    const w = arena("ball_lightning");
    const born: number[] = [];
    for (let k = 0; k < max + 2; k++) {
      w.spells[0]!.cooldownMs = 0;
      w.player.castRecoverMs = 0;
      w.player.mana = w.staff.mana_max;
      press(w, at(PX + 200, PY));
      born.push(w.orbs.filter((o) => o.alive).reduce((t, o) => Math.max(t, o.born), 0));
      const alive = w.orbs.filter((o) => o.alive && o.spellIndex === 0);
      expect(alive.length).toBe(Math.min(k + 1, max));
    }
    const alive = w.orbs.filter((o) => o.alive && o.spellIndex === 0).map((o) => o.born).sort((a, b) => a - b);
    // The oldest two went; the newest `max` remain.
    expect(alive).toEqual(born.slice(-max));
  });

  it("deals no contact damage: every blow a body takes is a strike", () => {
    const w = arena("ball_lightning");
    // Standing right in the orb's drift, so it passes through it.
    const e = body(w, 40, 0);
    let strikes = 0;
    let hits = 0;
    press(w, at(PX + 200, PY), [e]);
    for (let i = 0; i < 200; i++) {
      run(w, at(PX + 200, PY), 1, [e]);
      strikes += w.events.filter((ev) => ev.kind === "spell" && ev.what === "orb_strike").length;
      hits += w.events.filter((ev) => ev.kind === "enemy_hit" && ev.what === "rusher").length;
    }
    expect(strikes).toBeGreaterThan(3);
    expect(hits).toBe(strikes);
    const per = Math.floor(Number(item.params["damage"]) * SPELL_DAMAGE_SCALE);
    expect(hurt(e)).toBe(per * strikes);
  });

  it("strikes the nearest body in reach, on its own clock", () => {
    const w = arena("ball_lightning");
    const near = body(w, 50, 10);
    const far = body(w, 50, 70);
    press(w, at(PX + 50, PY), [near, far]);
    const targets: number[] = [];
    const times: number[] = [];
    for (let i = 0; i < 90; i++) {
      run(w, at(PX + 50, PY), 1, [near, far]);
      for (const ev of w.events) if (ev.kind === "spell" && ev.what === "orb_strike") { targets.push(ev.amount!); times.push(i); }
    }
    expect(targets.length).toBeGreaterThan(2);
    expect(new Set(targets)).toEqual(new Set([near.id]));
    const gap = (times[2]! - times[1]!) * STEP_MS;
    expect(gap).toBeGreaterThanOrEqual(Number(item.params["zap_ms"]) - STEP_MS);
    expect(gap).toBeLessThanOrEqual(Number(item.params["zap_ms"]) + STEP_MS);
  });
});

describe("trail (Cinder Stride)", () => {
  const item = ITEMS.get("cinder_stride")!;
  const dropPx = Number(item.params["drop_px"]);
  const patches = (w: World) => w.fires.filter((f) => f.alive && f.owner === "player").length;

  it("drops by the distance travelled, not by time, and nothing while standing still", () => {
    const still = arena("cinder_stride", "still");
    step(still, at(PX + 100, PY, { spell: 0 }));
    run(still, at(PX + 100, PY), 120);
    expect(patches(still)).toBe(0);

    // The same 180 px walked in 60 steps and in 120: the same patches.
    const counted = (steps: number): number => {
      const w = arena("cinder_stride", `walk${steps}`);
      step(w, at(PX + 100, PY, { spell: 0 }));
      let laid = 0;
      const was = w.fires.map((f) => f.alive);
      for (let i = 0; i < steps; i++) {
        w.player.x += 180 / steps;
        step(w, at(PX + 400, PY));
        w.fires.forEach((f, k) => { if (f.alive && !was[k]) laid++; was[k] = f.alive; });
      }
      return laid;
    };
    const fast = counted(60);
    const slow = counted(120);
    expect(fast).toBe(Math.floor(180 / dropPx));
    expect(slow).toBe(fast);
  });

  it("never harms the caster, who walks through it", () => {
    const w = arena("cinder_stride");
    step(w, at(PX + 100, PY, { spell: 0 }));
    // Back and forth over the same ground for three seconds.
    run(w, (i) => at(PX + 100, PY, { moveX: Math.floor(i / 30) % 2 === 0 ? 1 : -1 }), 180, [], false);
    expect(patches(w)).toBeGreaterThan(3);
    expect(w.player.hearts).toBe(6);
    expect(w.player.burnBuild).toBe(0);
    expect(w.player.burnMs).toBe(0);
  });

  it("sets the grass it crosses alight, and that fire is the room's", () => {
    // A strip of grass along the walk: the trail lights it, and burning grass
    // burns whoever stands in it — the caster pacing back and forth included.
    const strip: [number, number][] = [];
    for (let x = Math.floor(PX / 32) - 3; x <= Math.floor(PX / 32) + 6; x++)
      for (let y = Math.floor(PY / 32) - 1; y <= Math.floor(PY / 32) + 1; y++) strip.push([x, y]);
    const w = createWorld({
      room: { ...room, zones: [{ id: "grass", feature: "grass_patch", cells: strip }] } as typeof room,
      encounter: null, props: 0, staff: { slots: 3, mana_max: 90 },
      slots: [plainInstance("cinder_stride"), null, null], hearts: 6, rng: src.stream("w", "grass"),
    });
    w.player.x = PX;
    w.player.y = PY;
    step(w, at(PX + 100, PY, { spell: 0 }));
    run(w, (i) => at(PX + 100, PY, { moveX: Math.floor(i / 30) % 2 === 0 ? 1 : -1 }), 180, [], false);
    expect(w.grass.filter((c) => c.state !== "grass").length).toBeGreaterThan(3);
    expect(w.fires.some((f) => f.alive && f.fromGrass) || w.grass.some((c) => c.state === "burnt")).toBe(true);
    expect(w.player.burnBuild > 0 || w.player.hearts < 6).toBe(true);
  });

  it("burns a body it is laid under", () => {
    const w = arena("cinder_stride");
    const e = body(w, 30, 0);
    step(w, at(PX + 100, PY, { spell: 0 }));
    run(w, (i) => at(PX + 100, PY, { moveX: Math.floor(i / 20) % 2 === 0 ? 1 : -1 }), 240, [e], false);
    expect(hurt(e)).toBeGreaterThan(0);
    expect(e.burnMs > 0 || e.burnBuild > 0).toBe(true);
  });
});

describe("enchant (Crescent Edge)", () => {
  const item = ITEMS.get("crescent_edge")!;
  const waves = (w: World) => w.events.filter((ev) => ev.kind === "spell" && ev.what === "wave").length;

  it("throws a wave from a swing that misses as well as from one that lands", () => {
    const miss = arena("crescent_edge", "miss");
    step(miss, at(PX + 100, PY, { spell: 0 }));
    let thrown = 0;
    for (let i = 0; i < 40; i++) { step(miss, at(PX + 100, PY, { swing: i === 0 })); thrown += waves(miss); }
    expect(thrown).toBe(1);

    const hit = arena("crescent_edge", "hit");
    // At the edge of the swing, where the tip's arc leaves from: the sword and the wave both reach it.
    const e = body(hit, 50, 0);
    step(hit, at(PX + 100, PY, { spell: 0 }));
    thrown = 0;
    for (let i = 0; i < 40; i++) { step(hit, at(PX + 100, PY, { swing: i === 0 })); thrown += waves(hit); }
    expect(thrown).toBe(1);
    // The sword's blow and the wave's, both on the body.
    const wave = Math.floor(Number(item.params["damage"]) * SPELL_DAMAGE_SCALE);
    expect(hurt(e)).toBe(SWING_DAMAGE + wave);
  });

  it("passes through every body in its reach", () => {
    const w = arena("crescent_edge");
    const bodies = [body(w, 70, 0), body(w, 90, 0)];
    step(w, at(PX + 100, PY, { spell: 0 }));
    run(w, (i) => at(PX + 100, PY, { swing: i === 0 }), 40, bodies);
    for (const e of bodies) expect(hurt(e)).toBeGreaterThan(0);
  });

  it("leaves as the swing's active window ends, from the arc the tip traced", () => {
    const w = arena("crescent_edge", "release");
    step(w, at(PX + 100, PY, { spell: 0 }));
    run(w, at(PX + 100, PY), 20);
    let when = -1, lastLive = -1, firstLive = -1;
    for (let i = 0; i < 40 && when < 0; i++) {
      step(w, at(PX + 100, PY, { swing: i === 0 }));
      if (w.swing.active) { lastLive = i; if (firstLive < 0) firstLive = i; }
      if (waves(w) > 0) when = i;
    }
    // Not on the blade's first live frame: on the first frame after its last.
    expect(lastLive - firstLive + 1).toBe(Math.round(SWING_ACTIVE_MS / STEP_MS));
    expect(when).toBe(lastLive + 1);
    const wave = w.playerBullets.find((b) => b.alive && b.delivery === "wave")!;
    // Centred on the swing, at its reach, facing the swing's way.
    expect(wave.originX).toBeCloseTo(w.swing.x, 5);
    expect(wave.originY).toBeCloseTo(w.swing.y, 5);
    expect(waveRadius(wave)).toBeCloseTo(fullReach(w.swing), 5);
    expect(Math.atan2(wave.vy, wave.vx)).toBeCloseTo(w.swing.facing, 5);
    // It flies forward without growing: its centre moves `wave_reach` along the facing, its radius stays the reach.
    let far = 0;
    for (let i = 0; i < 60 && wave.alive; i++) {
      step(w, at(PX + 100, PY));
      if (!wave.alive) break;
      expect(waveRadius(wave)).toBeCloseTo(fullReach(w.swing), 5);
      far = waveCentre(wave).x - wave.originX;
    }
    expect(wave.alive).toBe(false);
    expect(far).toBeCloseTo(Number(item.params["wave_reach"]), 0);
  });

  it("hits along its arc, not in a disc: the flanks as well as the middle, nothing beside or behind, nothing inside", () => {
    const w = arena("crescent_edge", "arc");
    const R = fullReach(w.swing) || 57.6;
    // Where the flying arc passes, forty pixels out: its middle, and forty-five degrees off it either way.
    const on = (deg: number) => body(w, 40 + Math.cos((deg * Math.PI) / 180) * R, Math.sin((deg * Math.PI) / 180) * R);
    const middle = on(0);
    const left = on(-45);
    const right = on(45);
    // Square to the side and behind the caster: the arc never covers them.
    const beside = body(w, 0, 90);
    const behind = body(w, -80, 0);
    // Inside the swing's edge, where the wave has already left from.
    const inside = body(w, 6, -16);
    const bodies = [middle, left, right, beside, behind, inside];
    step(w, at(PX + 100, PY, { spell: 0 }));
    run(w, (i) => at(PX + 100, PY, { swing: i === 0 }), 50, bodies);
    // Each once, and only by the wave: none of them is in the sword's reach.
    const wave = Math.floor(Number(item.params["damage"]) * SPELL_DAMAGE_SCALE);
    for (const e of [middle, left, right]) expect(hurt(e)).toBe(wave);
    for (const e of [beside, behind]) expect(hurt(e)).toBe(0);
    // The body next to the caster takes the sword's blow and no wave.
    expect(hurt(inside)).toBe(SWING_DAMAGE);
  });

  it("flies over the room's geometry: a wall between it and a body cuts nothing", () => {
    const w = arena("crescent_edge", "wall");
    const grid = w.room.grid.slice();
    const col = Math.floor((PX + 80) / TILE_PX);
    for (let r = Math.floor((PY - 20) / TILE_PX); r <= Math.floor((PY + 20) / TILE_PX); r++) grid[r * GRID_W + col] = Tile.Wall;
    (w as { room: World["room"] }).room = { ...w.room, grid };
    const past = body(w, 120, 0);
    step(w, at(PX + 100, PY, { spell: 0 }));
    run(w, (i) => at(PX + 100, PY, { swing: i === 0 }), 50, [past]);
    expect(hurt(past)).toBe(Math.floor(Number(item.params["damage"]) * SPELL_DAMAGE_SCALE));
  });

  it("is thrown by no spin", () => {
    const w = arena("crescent_edge", "spin");
    step(w, at(PX + 100, PY, { spell: 0 }));
    w.player.rage = 1;
    let thrown = 0;
    for (let i = 0; i < 90; i++) { step(w, at(PX + 100, PY, { spin: i === 0 })); thrown += waves(w); }
    expect(w.player.rage).toBe(0);
    expect(thrown).toBe(0);
  });

  it("leaves the sword's own numbers as they were", () => {
    const plain = arena("magic_bolt", "plain");
    const enchanted = arena("crescent_edge", "enchanted");
    step(enchanted, at(PX + 100, PY, { spell: 0 }));
    for (const w of [plain, enchanted]) run(w, at(PX + 100, PY, { swing: true }), 6);
    expect(enchanted.swing.damage).toBe(plain.swing.damage);
    expect(enchanted.swing.reach).toBe(plain.swing.reach);
    expect(enchanted.swing.bladeReach).toBe(plain.swing.bladeReach);
  });

  it("is renewed by a recast, and ends when it runs out", () => {
    const w = arena("crescent_edge");
    const full = Number(item.params["enchant_ms"]);
    step(w, at(PX + 100, PY, { spell: 0 }));
    run(w, at(PX + 100, PY), 60);
    expect(w.player.enchant!.ms).toBeLessThan(full - 900);
    // A recast (the key's cooldown outlasts it, so a free cast stands in for it).
    fireUnit(w, w.spells[0]!.item, freeCastScope(w.spells[0]!, 0), ITEMS, [], w.player, w.player);
    expect(w.player.enchant!.ms).toBe(full);
    run(w, at(PX + 100, PY), Math.ceil(full / STEP_MS) + 2);
    expect(w.player.enchant).toBeNull();
    let thrown = 0;
    for (let i = 0; i < 30; i++) { step(w, at(PX + 100, PY, { swing: i === 0 })); thrown += waves(w); }
    expect(thrown).toBe(0);
  });
});

describe("dash with a wake (Dash Slash)", () => {
  it("lays its wake a stretch at a time as the player passes, each stretch set off where they then were", () => {
    const w = arena("dash_slash");
    press(w, at(PX + 300, PY));
    const laidAt: number[][] = [];
    for (let i = 0; i < 40 && (w.player.strikeMs > 0 || i === 0); i++) {
      step(w, at(PX + 300, PY));
      laidAt.push(w.shockwaves.filter((s) => s.byPlayer).map((s) => s.x));
    }
    const all = w.shockwaves.filter((s) => s.byPlayer);
    // Many short stretches, in pairs either side of the run, not two long edges.
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(all.length % 2).toBe(0);
    for (const s of all) expect(s.width!).toBeLessThanOrEqual(12);
    expect(new Set(all.map((s) => Math.round(Math.sin(s.facing!)))).size).toBe(2);
    // They came one step after another, not all at once.
    const counts = laidAt.map((xs) => xs.length);
    expect(counts.filter((n, i) => i > 0 && n > counts[i - 1]!).length).toBeGreaterThanOrEqual(4);
    // And the earlier ones are further out: the wake opens behind the run.
    const upper = all.filter((s) => Math.sin(s.facing!) < 0).sort((a, b) => a.x - b.x);
    expect(upper[0]!.inner).toBeGreaterThan(upper[upper.length - 1]!.inner);
  });

  it("its wake cuts a body beside the run the run missed, once; one the run cut, not again; never the player", () => {
    const w = arena("dash_slash");
    const side = body(w, 70, 38);
    const onPath = body(w, 100, 0);
    const hearts = w.player.hearts;
    let sideHits = 0, pathHits = 0;
    press(w, at(PX + 300, PY), [side, onPath]);
    for (let i = 0; i < 60; i++) {
      w.player.invulnMs = 0;
      w.player.dashIframeMs = 0;
      step(w, at(PX + 300, PY));
      sideHits += hitsOn(w, side);
      pathHits += hitsOn(w, onPath);
      side.x = PX + 70; side.y = PY + 38;
      onPath.x = PX + 100; onPath.y = PY;
      onPath.knockX = 0; onPath.knockY = 0; side.knockX = 0; side.knockY = 0;
    }
    expect(sideHits).toBe(1);
    expect(pathHits).toBe(1);
    const cut = Number(ITEMS.get("dash_slash")!.params["wake_share"]);
    expect(hurt(side)).toBeLessThan(hurt(onPath) * (cut + 0.05));
    expect(w.player.hearts).toBe(hearts);
  });
});

describe("Dash Slash's shove", () => {
  it("throws a body the run cuts well off the line, to its own side, and staggers it", () => {
    const w = arena("dash_slash");
    const e = body(w, 90, 6);
    press(w, at(PX + 300, PY));
    let staggered = false;
    for (let i = 0; i < 60; i++) { step(w, at(PX + 300, PY)); staggered ||= e.staggerMs > 0; }
    // Down the side it stood on, about two tiles, and far more than Blink Strike's nudge.
    expect(e.y - (PY + 6)).toBeGreaterThan(40);
    expect(staggered).toBe(true);

    const b = arena("blink_strike");
    const f = body(b, 90, 6);
    press(b, at(PX + 300, PY));
    for (let i = 0; i < 60; i++) step(b, at(PX + 300, PY));
    expect(Math.abs(f.y - (PY + 6))).toBeLessThan((e.y - (PY + 6)) / 2);
  });

  it("throws a body its wake cuts on the way the wake rolls", () => {
    const w = arena("dash_slash");
    // A body dead ahead holds the run on its line, so the other is left to the wake.
    const ahead = body(w, 110, 0);
    const e = body(w, 70, -38);
    press(w, at(PX + 300, PY), [ahead]);
    for (let i = 0; i < 60; i++) run(w, at(PX + 300, PY), 1, [ahead], false);
    expect(hurt(e)).toBeGreaterThan(0);
    expect((PY - 38) - e.y).toBeGreaterThan(30);
  });
});

describe("sword energy is the sword's damage", () => {
  it("cuts twice as hard when the sword does, and the base figure is the same swings at a plain sword", () => {
    const cut = (swordDamage: number): number => {
      const w = arena("dash_slash");
      w.player.mods = { ...w.player.mods, swordDamage };
      const e = body(w, 90, 0);
      press(w, at(PX + 300, PY), [e]);
      run(w, at(PX + 300, PY), 40, [e], false);
      return hurt(e);
    };
    expect(cut(2) / cut(1)).toBeCloseTo(2, 1);
    for (const id of ["dash_slash", "crescent_edge"]) {
      const p = ITEMS.get(id)!.params;
      expect(Number(p["damage"]) * SPELL_DAMAGE_SCALE, id).toBeCloseTo(Number(p["sword"]) * SWORD_DAMAGE, 1);
    }
  });

  it("puts the sword's damage into Crescent Edge's waves", () => {
    const w = arena("crescent_edge");
    press(w, at(PX + 300, PY));
    const plain = w.player.enchant!.damage;
    const v = arena("crescent_edge");
    v.player.mods = { ...v.player.mods, swordDamage: 1.5 };
    press(v, at(PX + 300, PY));
    expect(v.player.enchant!.damage / plain).toBeCloseTo(1.5, 2);
  });
});

describe("stance (Counter Stance)", () => {
  const item = ITEMS.get("counter_stance")!;
  const full = Math.floor(Number(item.params["damage"]) * SPELL_DAMAGE_SCALE);
  const share = Number(item.params["expire_share"]);
  const answers = (w: World) => w.events.filter((ev) => ev.kind === "spell" && ev.what === "stance_answer");

  it("cancels exactly one hit, buys a moment of invulnerability, and answers it", () => {
    const w = arena("counter_stance");
    const e = body(w, 30, 0);
    step(w, at(PX + 100, PY, { spell: 0 }));
    expect(w.player.stance).not.toBeNull();
    step(w, at(PX + 100, PY));
    shoot(w);
    step(w, at(PX + 100, PY));
    const answered = answers(w);
    expect(w.player.hearts).toBe(6);
    expect(answered.length).toBe(1);
    expect(answered[0]!.amount).toBe(1);
    expect(w.player.stance).toBeNull();
    expect(w.player.invulnMs).toBeGreaterThan(STANCE_GUARD_MS - 2 * STEP_MS);
    expect(hurt(e)).toBe(full);
    // It staggered what it cut.
    expect(e.staggerImmuneMs).toBeGreaterThan(0);
    // The next hit, once the moment has passed, lands.
    run(w, at(PX + 100, PY), Math.ceil(STANCE_GUARD_MS / STEP_MS) + 2, [e]);
    shoot(w);
    step(w, at(PX + 100, PY));
    expect(w.player.hearts).toBeLessThan(6);
  });

  it("answers anyway at its expiry share when nothing lands", () => {
    const w = arena("counter_stance");
    const e = body(w, 30, 0);
    step(w, at(PX + 100, PY, { spell: 0 }));
    const seen: number[] = [];
    for (let i = 0; i < Math.ceil(Number(item.params["stance_ms"]) / STEP_MS) + 3; i++) {
      run(w, at(PX + 100, PY), 1, [e]);
      for (const a of answers(w)) seen.push(a.amount!);
    }
    expect(seen).toEqual([share]);
    expect(hurt(e)).toBe(Math.floor(Number(item.params["damage"]) * SPELL_DAMAGE_SCALE * share));
  });

  it("slows the caster and holds the sword while it lasts", () => {
    const free = arena("magic_bolt", "free");
    const guarded = arena("counter_stance", "guarded");
    step(guarded, at(PX + 100, PY, { spell: 0 }));
    // Past the cast's own recovery, still inside the guard.
    run(guarded, at(PX + 100, PY), 8);
    for (const w of [free, guarded]) { w.player.x = PX; w.player.y = PY; run(w, at(PX + 100, PY, { moveX: 1 }), 6, [], false); }
    expect(guarded.player.stance).not.toBeNull();
    expect(guarded.player.x - PX).toBeLessThan((free.player.x - PX) * 0.6);
    for (const w of [free, guarded]) step(w, at(PX + 100, PY, { swing: true }));
    expect(guarded.player.swingMs).toBe(0);
    expect(free.player.swingMs).toBeGreaterThan(0);
  });

  it("is dropped by a dash, which answers at the expiry share", () => {
    const w = arena("counter_stance");
    const e = body(w, 30, 0);
    step(w, at(PX + 100, PY, { spell: 0 }));
    step(w, at(PX + 100, PY, { dash: true, moveX: -1 }));
    const answered = answers(w);
    expect(answered.map((a) => a.amount)).toEqual([share]);
    expect(w.player.stance).toBeNull();
    expect(w.player.dashMs).toBeGreaterThan(0);
    expect(hurt(e)).toBeGreaterThan(0);
  });
});

describe("field of poison (Toxic Cloud)", () => {
  it("poisons and slows what stands in it, and does not burn", () => {
    const w = arena("toxic_cloud");
    const e = body(w, 100, 0);
    press(w, at(e.x, e.y), [e]);
    const cloud = w.fires.find((f) => f.alive && f.owner === "player")!;
    expect(cloud.element).toBe("poison");
    let slowed = false;
    let poisonTicks = 0;
    for (let i = 0; i < 180; i++) {
      run(w, at(e.x, e.y), 1, [e]);
      if (e.slowMs > 0) slowed = true;
      poisonTicks += w.events.filter((ev) => ev.kind === "damage" && ev.what === "hp:poison").length;
      expect(e.burnBuild).toBe(0);
      expect(e.burnMs).toBe(0);
    }
    expect(slowed).toBe(true);
    expect(e.poisonMs).toBeGreaterThan(0);
    expect(hurt(e)).toBeGreaterThan(0);
    expect(poisonTicks).toBeGreaterThan(3);
  });

  it("leaves no scorch and never harms the caster standing in it", () => {
    const w = arena("toxic_cloud");
    // Cast at the caster's own feet: nothing sought, the cloud lands at its reach; walk into it.
    press(w, at(PX + 100, PY));
    const cloud = w.fires.find((f) => f.alive && f.owner === "player")!;
    w.player.x = cloud.x;
    w.player.y = cloud.y;
    run(w, at(PX + 200, PY), Math.ceil(cloud.lifeMs / STEP_MS) + 5);
    expect(w.player.hearts).toBe(6);
    expect(w.player.poisonBuild).toBe(0);
    expect(w.player.poisonMs).toBe(0);
    expect(w.scorches.some((s) => s.alive)).toBe(false);
  });
});

describe("what keeps coming after the press outlasts the cooldown's floor (doc 006)", () => {
  it("holds a trail, an enchant and an orb's cap, and Toxic Cloud's cloud, to the rule", () => {
    for (const id of ["cinder_stride", "crescent_edge", "ball_lightning", "toxic_cloud"]) {
      const w = arena(id);
      const slot = w.spells[0]!;
      const cd = slotCooldownMs(slot, ITEMS, slotCost(slot, ITEMS, w.staff));
      const p = ITEMS.get(id)!.params;
      const lasts = id === "toxic_cloud" ? Number(p["lifetime"]) * 1000 : lastingMs(ITEMS, id);
      expect(lasts, id).toBeGreaterThan(0);
      expect(cd, id).toBeGreaterThanOrEqual(lasts);
    }
    expect(lastingMs(ITEMS, "ball_lightning")).toBe(
      (Number(ITEMS.get("ball_lightning")!.params["lifetime"]) * 1000) / Number(ITEMS.get("ball_lightning")!.params["max_alive"]),
    );
  });
});
