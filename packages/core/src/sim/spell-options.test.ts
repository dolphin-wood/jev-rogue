/**
 * **The rules of doc 006's newer options, one at a time.**
 *
 * Each option is one rule added to a shape the simulation already had —
 * a bank on a bolt, a held charge, a delayed mark, shards thrown in flight,
 * a poison that jumps, a marked landing, rings of ground, a leap, an
 * implosion — and each rule is the kind of thing that is easy to get almost
 * right: a bank that stops filling while the key is held, a charge that charges on
 * the press, a mark laid twice, a jump that fires while its carrier lives.
 * So each is pinned here by the sentence doc 006 says it with.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step } from "./world.ts";
import { NO_INPUT, STEP_MS } from "./types.ts";
import type { Enemy, Input, World } from "./types.ts";
import { makeEnemy, ENEMY_POISON_MS } from "./enemy.ts";
import { seekTargets } from "./aim.ts";
import { attachAffix, bankOf, chargeMsOf, slotCost } from "./spells.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { ITEMS, plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";

const src = new RngSource("spell-options");
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

function arena(spell: string, seed = spell, gridOverride?: Uint8Array): World {
  const w = createWorld({
    room: gridOverride ? { ...room, grid: gridOverride } : room, encounter: null, props: 0,
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

/** Steps `n` times with the same input, holding the player and the bodies in place. */
function run(w: World, input: Input, n: number, pinned: readonly Enemy[] = []): void {
  const home = pinned.map((e) => ({ x: e.x, y: e.y }));
  for (let i = 0; i < n; i++) {
    step(w, input);
    pinned.forEach((e, k) => { e.x = home[k]!.x; e.y = home[k]!.y; e.attackCooldownMs = 1e9; });
  }
}

const hurt = (e: Enemy): number => e.maxHp - e.hp;

describe("charges (Mana Darts)", () => {
  const item = ITEMS.get("mana_darts")!;
  const max = Number(item.params["charges"]);
  const every = Number(item.params["charge_ms"]);

  it("starts full, caps at its charges, and fires the whole bank for one cast's cost", () => {
    const w = arena("mana_darts");
    const e = body(w, 150, 0);
    expect(bankOf(w.spells[0]!, ITEMS)).toBe(max);
    const cost = slotCost(w.spells[0]!, ITEMS, w.staff);
    const before = w.player.mana;
    step(w, at(e.x, e.y, { spell: 0 }));
    expect(w.playerBullets.filter((b) => b.alive).length).toBe(max);
    expect(before - w.player.mana).toBeCloseTo(cost, 1);
    expect(bankOf(w.spells[0]!, ITEMS)).toBe(0);
    // Left alone for many charges' worth, it banks no more than its cap.
    run(w, at(e.x, e.y), Math.ceil((every * (max + 3)) / STEP_MS), [e]);
    expect(bankOf(w.spells[0]!, ITEMS)).toBe(max);
  });

  it("held down, looses each charge as it banks; let up, banks them", () => {
    const w = arena("mana_darts");
    const e = body(w, 150, 0);
    step(w, at(e.x, e.y, { spell: 0 }));
    // Held down for four charges' time: the key casts whenever a charge
    // arrives, like any held key, so the bank never piles up and darts keep coming.
    let casts = 0;
    for (let i = 0; i < Math.ceil((every * 4) / STEP_MS); i++) {
      const mana = w.player.mana;
      run(w, at(e.x, e.y, { spell: 0 }), 1, [e]);
      if (w.player.mana < mana - 0.5) casts++;
      expect(bankOf(w.spells[0]!, ITEMS)).toBeLessThanOrEqual(1);
    }
    expect(casts).toBeGreaterThanOrEqual(3);
    // Let up for just over two charges' time: they bank.
    run(w, at(e.x, e.y), Math.ceil((every * 2) / STEP_MS) + 1, [e]);
    expect(bankOf(w.spells[0]!, ITEMS)).toBeGreaterThanOrEqual(2);
  });

  it("refuses a press on an empty bank as a cooldown", () => {
    const w = arena("mana_darts");
    const e = body(w, 150, 0);
    step(w, at(e.x, e.y, { spell: 0 }));
    // Past the cast's recovery and short of one charge's time.
    run(w, at(e.x, e.y), 14, [e]);
    expect(w.player.castRecoverMs).toBeLessThanOrEqual(0);
    expect(bankOf(w.spells[0]!, ITEMS)).toBe(0);
    step(w, at(e.x, e.y, { spell: 0 }));
    const refused = w.events.find((ev) => ev.kind === "cast_refused");
    expect(refused?.what).toBe("cooldown");
  });
});

describe("charge (Arcane Cannon)", () => {
  const full = chargeMsOf(ITEMS, "arcane_cannon");

  /** Holds the key `ms`, lets it up, and returns the damage the shot dealt and the mana it cost. */
  function shot(ms: number): { damage: number; manaHeld: number; manaAfter: number; before: number; weight: number } {
    const w = arena("arcane_cannon", `hold:${ms}`);
    const e = body(w, 150, 0);
    const before = w.player.mana;
    run(w, at(e.x, e.y, { spell: 0 }), Math.max(1, Math.round(ms / STEP_MS)), [e]);
    const manaHeld = w.player.mana;
    step(w, at(e.x, e.y));
    const manaAfter = w.player.mana;
    const weight = w.playerBullets.find((b) => b.alive)?.weight ?? 0;
    run(w, at(e.x, e.y), 60, [e]);
    return { damage: hurt(e), manaHeld, manaAfter, before, weight };
  }

  it("costs nothing while held and its whole cost on release", () => {
    const s = shot(full / 2);
    const cost = slotCost({ item: plainInstance("arcane_cannon"), affixes: [], cooldownMs: 0, level: 1 }, ITEMS, { slots: 3, mana_max: 90 });
    // Regeneration only while held.
    expect(s.manaHeld).toBeGreaterThanOrEqual(s.before - 0.01);
    expect(s.manaAfter).toBeCloseTo(s.manaHeld - cost, 0);
  });

  it("a tap does less than a full charge, and only a full charge staggers", () => {
    const tap = shot(STEP_MS);
    const whole = shot(full + 50);
    expect(tap.damage).toBeGreaterThan(0);
    expect(whole.damage).toBeGreaterThan(tap.damage * 2.5);
    expect(tap.weight).toBeLessThan(1.2);
    expect(whole.weight).toBeGreaterThanOrEqual(1.2);
  });

  it("slows the caster while held", () => {
    const moved = (spell: number | null): number => {
      const w = arena("arcane_cannon", `move:${spell}`);
      if (spell !== null) step(w, at(PX + 150, PY, { spell }));
      const x0 = w.player.x;
      for (let i = 0; i < 30; i++) step(w, at(PX + 150, PY, { spell, moveX: 1 }));
      return w.player.x - x0;
    };
    expect(moved(0)).toBeLessThan(moved(null) * 0.7);
  });

  it("is cancelled by a dash at no cost, and starts no cooldown", () => {
    const w = arena("arcane_cannon");
    const e = body(w, 150, 0);
    run(w, at(e.x, e.y, { spell: 0 }), 30, [e]);
    expect(w.player.chargeKey).toBe(0);
    const mana = w.player.mana;
    step(w, at(e.x, e.y, { spell: 0, dash: true, moveX: 1 }));
    expect(w.player.chargeKey).toBe(-1);
    // Still held through the dash, it does not start again; let up after,
    // nothing fires and nothing is paid.
    run(w, at(e.x, e.y, { spell: 0 }), 20, [e]);
    expect(w.player.chargeKey).toBe(-1);
    run(w, at(e.x, e.y), 30, [e]);
    expect(hurt(e)).toBe(0);
    expect(w.player.mana).toBeGreaterThanOrEqual(mana);
    expect(w.spells[0]!.cooldownMs).toBeLessThanOrEqual(0);
  });
});

describe("doom (Doom Sigil)", () => {
  const item = ITEMS.get("doom_sigil")!;
  const doom = Number(item.params["doom"]);

  it("marks on a hit, cannot be marked again until it bursts, and bursts on the body and beside it", () => {
    const w = arena("doom_sigil");
    const e = body(w, 120, 0);
    const beside = body(w, 150, 12);
    step(w, at(e.x, e.y, { spell: 0 }));
    let frames = 0;
    while (e.doomMs <= 0 && frames++ < 120) run(w, at(e.x, e.y), 1, [e, beside]);
    expect(e.doomMs).toBeGreaterThan(0);
    const first = e.doomMs;
    // A second shot lands while the mark counts down: the mark is not laid again.
    w.spells[0]!.cooldownMs = 0;
    w.player.castRecoverMs = 0;
    step(w, at(e.x, e.y, { spell: 0 }));
    run(w, at(e.x, e.y), 30, [e, beside]);
    expect(e.doomMs).toBeLessThan(first);
    expect(hurt(beside)).toBe(0);
    // Then it bursts, and the body beside it is caught.
    run(w, at(e.x, e.y), Math.ceil(doom / STEP_MS), [e, beside]);
    expect(e.doomMs).toBe(0);
    expect(hurt(beside)).toBeGreaterThan(0);
  });

  it("bursts where its body died, on its own clock", () => {
    const w = arena("doom_sigil");
    const e = body(w, 120, 0);
    const beside = body(w, 140, 12);
    step(w, at(e.x, e.y, { spell: 0 }));
    let frames = 0;
    while (e.doomMs <= 0 && frames++ < 120) run(w, at(e.x, e.y), 1, [e, beside]);
    expect(e.doomMs).toBeGreaterThan(0);
    e.hp = 0;
    run(w, at(PX + 300, PY), 2, [beside]);
    expect(w.enemies.includes(e)).toBe(false);
    expect(w.dooms).toHaveLength(1);
    expect(hurt(beside)).toBe(0);
    run(w, at(PX + 300, PY), Math.ceil(doom / STEP_MS) + 2, [beside]);
    expect(w.dooms).toHaveLength(0);
    expect(hurt(beside)).toBeGreaterThan(0);
  });

  it("reports its burst as status damage", () => {
    const w = arena("doom_sigil");
    const e = body(w, 120, 0);
    step(w, at(e.x, e.y, { spell: 0 }));
    const tags: string[] = [];
    for (let i = 0; i < Math.ceil(doom / STEP_MS) + 60; i++) {
      step(w, at(e.x, e.y));
      for (const ev of w.events) if (ev.kind === "damage") tags.push(String(ev.what));
    }
    expect(tags).toContain("hp:dot:doom");
  });
});

describe("emit (Frozen Orb)", () => {
  it("throws shards while it flies and bursts into a ring where it ends", () => {
    const w = arena("frozen_orb");
    step(w, at(PX + 400, PY, { spell: 0 }));
    let most = 0;
    let bursts = 0;
    for (let i = 0; i < 200; i++) {
      step(w, at(PX + 400, PY));
      most = Math.max(most, w.playerBullets.filter((b) => b.alive).length);
      bursts += w.events.filter((ev) => ev.kind === "shot" && ev.what === "emit_burst").length;
    }
    const ring = Number(ITEMS.get("frozen_orb")!.params["emit"]);
    expect(bursts).toBe(1);
    expect(most).toBeGreaterThan(ring);
  });

  it("gives its shards the spell's element and none of its affixes", () => {
    const w = arena("frozen_orb");
    w.spells[0] = attachAffix(w.spells[0]!, "fork")!;
    step(w, at(PX + 400, PY, { spell: 0 }));
    run(w, at(PX + 400, PY), 30);
    const shards = w.playerBullets.filter((b) => b.alive && b.emitMs === 0);
    expect(shards.length).toBeGreaterThan(0);
    for (const s of shards) {
      expect(s.element).toBe("ice");
      expect(s.affixes).toHaveLength(0);
    }
  });
});

describe("contagion (Contagion)", () => {
  function poisoned(): { w: World; carrier: Enemy; near: Enemy[]; far: Enemy } {
    const w = arena("contagion");
    const carrier = body(w, 120, 0);
    const near = [body(w, 150, 20), body(w, 150, -20), body(w, 170, 0), body(w, 120, 40)];
    const far = body(w, 400, 0);
    let frames = 0;
    while (carrier.contagion <= 0 && frames++ < 600) {
      w.player.mana = w.staff.mana_max;
      run(w, at(carrier.x, carrier.y, { spell: 0 }), 1, [carrier, ...near, far]);
    }
    run(w, at(carrier.x, carrier.y), 2, [carrier, ...near, far]);
    return { w, carrier, near, far };
  }

  it("does not jump while its carrier lives", () => {
    const { w, carrier, near, far } = poisoned();
    expect(carrier.contagion).toBeGreaterThan(0);
    expect(carrier.poisonMs).toBeGreaterThan(0);
    const before = near.map((e) => e.poisonMs);
    run(w, at(PX - 300, PY), 60, [carrier, ...near, far]);
    expect(near.map((e) => e.contagion)).toEqual(near.map(() => 0));
    for (const [i, e] of near.entries()) expect(e.poisonMs).toBeLessThanOrEqual(before[i]!);
  });

  it("jumps on its carrier's death to at most its count of bodies within reach, which carry it on", () => {
    const { w, carrier, near, far } = poisoned();
    const n = Number(ITEMS.get("contagion")!.params["contagion"]);
    carrier.hp = 0;
    run(w, at(PX - 300, PY), 1, [...near, far]);
    const caught = near.filter((e) => e.contagion > 0 && e.poisonMs > 0);
    expect(caught.length).toBe(Math.min(n, near.length));
    expect(far.poisonMs).toBe(0);
    for (const e of caught) expect(e.poisonMs).toBeLessThanOrEqual(ENEMY_POISON_MS);
    // A second death passes it on again, and never back onto a carrier.
    caught[0]!.hp = 0;
    run(w, at(PX - 300, PY), 1, [...near, far]);
    expect(near.filter((e) => e.hp > 0 && e.contagion > 0).length).toBeGreaterThanOrEqual(caught.length - 1);
  });
});

describe("telegraph (Meteor)", () => {
  const item = ITEMS.get("meteor")!;
  const telegraph = Number(item.params["telegraph_ms"]);
  const windup = Number(item.params["windup_ms"]);

  it("marks the ground and lands after the telegraph, not before", () => {
    const w = arena("meteor");
    const e = body(w, 150, 0);
    step(w, at(e.x, e.y, { spell: 0 }));
    // Through the windup and most of the telegraph: marked, and nothing hit.
    run(w, at(e.x, e.y), Math.floor((windup + telegraph - 60) / STEP_MS), [e]);
    const marked = w.eruptions.filter((c) => c.alive && !c.fired);
    expect(marked.length).toBeGreaterThan(0);
    expect(marked[0]!.telegraphMs).toBe(telegraph);
    expect(hurt(e)).toBe(0);
    run(w, at(e.x, e.y), Math.ceil(200 / STEP_MS), [e]);
    expect(hurt(e)).toBeGreaterThan(0);
  });

  /** A wall `dx` tiles east of the caster, from the top of the room to the bottom. */
  const wallAt = (dx: number) => {
    const walled = grid.slice();
    const wx = Math.floor(PX / TILE_PX) + dx;
    for (let y = 1; y < GRID_H - 1; y++) walled[y * GRID_W + wx] = Tile.Wall;
    return walled;
  };
  const marked = (w: World) => w.eruptions.filter((c) => c.alive && !c.fired);

  /*
   * Reported from play: "no rock came down at all". The seek cone could
   * choose a body behind a wall and the line of sight then refused the only
   * cell, or with nothing in the cone the landing went `reach` tiles ahead
   * through a near wall; either way the cast spent its mana on nothing. A rock
   * from above seeks the whole screen and needs no line of sight.
   */
  const castAt = (w: World, x: number, y: number, pinned: Enemy[] = []) => {
    step(w, at(x, y, { spell: 0 }));
    run(w, at(x, y), Math.ceil(windup / STEP_MS) + 2, pinned);
  };

  it("comes down on a body behind a wall", () => {
    const w = arena("meteor", "hidden", wallAt(3));
    const hidden = body(w, 150, 0);
    castAt(w, hidden.x, hidden.y, [hidden]);
    expect(marked(w)).toHaveLength(1);
    expect(marked(w)[0]!.x).toBeCloseTo(hidden.x, 0);
    expect(marked(w)[0]!.y).toBeCloseTo(hidden.y, 0);
  });

  it("finds a body anywhere on screen, and still takes the one it is aimed at first", () => {
    const w = arena("meteor", "behind");
    const behind = body(w, -150, 0);
    castAt(w, PX + 200, PY, [behind]);
    expect(marked(w)[0]!.x).toBeCloseTo(behind.x, 0);

    const w2 = arena("meteor", "faced");
    const faced = body(w2, 120, 60);
    const other = body(w2, -150, 0);
    castAt(w2, PX + 200, PY, [faced, other]);
    expect(marked(w2)[0]!.x).toBeCloseTo(faced.x, 0);
  });

  it("does not reach a body off screen", () => {
    const w = arena("meteor", "far");
    const far = body(w, 400, 0);
    castAt(w, far.x, far.y, [far]);
    expect(marked(w)).toHaveLength(1);
    expect(marked(w)[0]!.x).toBeLessThan(far.x - 100);
  });

  it("with no body on screen, lands on the ground ahead short of the wall", () => {
    const w = arena("meteor", "walled", wallAt(3));
    step(w, at(PX + 200, PY, { spell: 0 }));
    run(w, at(PX + 200, PY), Math.ceil(windup / STEP_MS) + 2);
    expect(marked(w)).toHaveLength(1);
    const c = marked(w)[0]!;
    expect(c.x).toBeGreaterThan(PX);
    expect(c.x).toBeLessThan((Math.floor(PX / TILE_PX) + 3) * TILE_PX);
  });

  it("misses a body that walks out of the mark", () => {
    const w = arena("meteor");
    const e = body(w, 150, 0);
    step(w, at(e.x, e.y, { spell: 0 }));
    run(w, at(e.x, e.y), Math.floor(windup / STEP_MS) + 2, [e]);
    e.x += 120;
    run(w, at(e.x, e.y), Math.ceil((telegraph + 400) / STEP_MS), [e]);
    expect(hurt(e)).toBe(0);
  });
});

/*
 * **A seeking spell prefers a body it can reach.** The seek cone ranked by
 * angle and distance alone, so a body behind a pillar outranked one in the
 * open beside it: a homing shot curved into the pillar, a line of spikes ran
 * into it, and Cinder Geysers put every cell on the far side and had them
 * all refused. A body behind a wall still counts; it just comes after every
 * body the caster can see.
 */
describe("seeking past a pillar", () => {
  const pillar = (() => {
    const g2 = grid.slice();
    const tx = Math.floor(PX / TILE_PX) + 3, ty = Math.floor(PY / TILE_PX);
    for (const dy of [-1, 0, 1]) g2[(ty + dy) * GRID_W + tx] = Tile.Wall;
    return g2;
  })();

  it("ranks the bodies it can see before the one behind a pillar", () => {
    const w = arena("magic_bolt", "rank", pillar);
    const hidden = body(w, 200, 0);
    const seen = body(w, 150, 100);
    const ranked = seekTargets(w, PX, PY, 1, 0).map((t) => t.id);
    expect(ranked).toEqual([seen.id, hidden.id]);
  });

  for (const spell of ["magic_bolt", "earth_spikes", "cinder_geysers", "arc_lance"])
    it(`${spell} reaches the body in the open, not the pillar`, () => {
      const w = arena(spell, `pillar-${spell}`, pillar);
      const hidden = body(w, 200, 0);
      const seen = body(w, 150, 100);
      step(w, at(hidden.x, hidden.y, { spell: 0 }));
      run(w, at(hidden.x, hidden.y), Math.ceil(1500 / STEP_MS), [hidden, seen]);
      expect(hurt(seen), spell).toBeGreaterThan(0);
    });
});

describe("the ring pattern (Quake Ring)", () => {
  it("goes off round the caster in successive rings, each later than the last", () => {
    const w = arena("quake_ring");
    step(w, at(PX + 100, PY, { spell: 0 }));
    run(w, at(PX + 100, PY), Math.ceil(Number(ITEMS.get("quake_ring")!.params["windup_ms"]) / STEP_MS) + 1);
    const cells = w.eruptions.filter((c) => c.alive);
    expect(cells.length).toBeGreaterThan(12);
    const byRing = new Map<number, number>();
    for (const c of cells) {
      const r = Math.round(Math.hypot(c.x - PX, c.y - PY));
      byRing.set(r, Math.max(byRing.get(r) ?? 0, c.delayMs));
    }
    const radii = [...byRing.keys()].sort((a, b) => a - b);
    expect(radii.length).toBe(Number(ITEMS.get("quake_ring")!.params["count"]));
    for (let i = 1; i < radii.length; i++) expect(byRing.get(radii[i]!)!).toBeGreaterThan(byRing.get(radii[i - 1]!)!);
  });

  it("stops at a wall: no cell goes off on the far side of one", () => {
    // A wall a tile east of the caster, from top to bottom of the room.
    const walled = grid.slice();
    const wx = Math.floor(PX / TILE_PX) + 1;
    for (let y = 1; y < GRID_H - 1; y++) walled[y * GRID_W + wx] = Tile.Wall;
    const w = arena("quake_ring", "walled", walled);
    step(w, at(PX - 100, PY, { spell: 0 }));
    run(w, at(PX - 100, PY), 30);
    const cells = w.eruptions.filter((c) => c.alive || c.fired);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) expect(c.x).toBeLessThan(wx * TILE_PX);
  });

  it("hits each body once, however many cells it stands in", () => {
    const w = arena("quake_ring");
    const e = body(w, 36, 0);
    step(w, at(PX + 100, PY, { spell: 0 }));
    let hits = 0;
    for (let i = 0; i < 60; i++) {
      step(w, at(PX + 100, PY));
      hits += w.events.filter((ev) => ev.kind === "enemy_hit" && ev.what === e.archetype).length;
      e.x = PX + 36; e.y = PY;
    }
    expect(hits).toBe(1);
  });

  it("reaches what flies: a ground spell is still the player's spell", () => {
    const w = arena("quake_ring");
    const e = body(w, 36, 0);
    const flyer = makeEnemy(w.nextEnemyId++, "shooter", PX - 36, PY, []);
    Object.assign(flyer, { spawnFadeMs: 0, awake: true, hp: 100_000, maxHp: 100_000, speed: 0, attackCooldownMs: 1e9 });
    w.enemies.push(flyer);
    step(w, at(PX + 100, PY, { spell: 0 }));
    run(w, at(PX + 100, PY), 60, [e, flyer]);
    expect(hurt(e)).toBeGreaterThan(0);
    expect(hurt(flyer)).toBeGreaterThan(0);
  });
});

describe("land (Leap Slam)", () => {
  it("leaps to the body it seeks, untouchable, and comes down in rings round the landing", () => {
    const w = arena("leap_slam");
    const e = body(w, 110, 0);
    const beside = body(w, 110, 30);
    step(w, at(e.x, e.y, { spell: 0 }));
    let untouchable = false;
    let landed: { x: number; y: number } | null = null;
    for (let i = 0; i < 90 && !landed; i++) {
      step(w, at(e.x, e.y));
      if (w.player.dashIframeMs > 0) untouchable = true;
      if (w.events.some((ev) => ev.kind === "shot" && ev.what === "land")) landed = { x: w.player.x, y: w.player.y };
    }
    expect(untouchable).toBe(true);
    expect(landed).not.toBeNull();
    // Against the body, not short of it and not through it.
    const gap = Math.hypot(e.x - landed!.x, e.y - landed!.y);
    expect(gap).toBeLessThan(e.radius + 14);
    expect(landed!.x).toBeLessThan(e.x);
    // Nothing was cut in the air; the landing hurts it and the body beside it.
    run(w, at(e.x, e.y), 40, [e, beside]);
    expect(hurt(e)).toBeGreaterThan(0);
    expect(hurt(beside)).toBeGreaterThan(0);
  });

  it("does not move the player when it is cast free", () => {
    const w = arena("leap_slam");
    w.spells[0] = attachAffix(w.spells[0]!, "retort")!;
    const e = body(w, 90, 0);
    w.player.invulnMs = 0;
    const b = w.enemyBullets.find((x) => !x.alive)!;
    b.alive = true; b.x = PX; b.y = PY; b.vx = 0; b.vy = 0; b.radius = 3; b.lifeMs = 5000; b.damage = 1; b.from = "shooter";
    step(w, NO_INPUT);
    const x = w.player.x;
    run(w, NO_INPUT, 20, [e]);
    expect(w.player.dashMs).toBeLessThanOrEqual(0);
    expect(Math.abs(w.player.x - x)).toBeLessThan(12);
    expect(hurt(e)).toBeGreaterThan(0);
  });
});

describe("collapse (Void Maw)", () => {
  it("implodes as the pull ends, on the bodies still inside it and no others", () => {
    const w = arena("void_maw");
    const inside = body(w, 110, 0);
    const outside = body(w, 110, 120);
    // Pinned away from the pull's centre, so its ticks never reach them: what they take is the implosion.
    const radius = Number(ITEMS.get("void_maw")!.params["radius"]);
    step(w, at(inside.x, inside.y, { spell: 0 }));
    run(w, at(inside.x, inside.y), 6, [inside, outside]);
    const v = w.vortices.find((x) => x.alive)!;
    expect(v).toBeDefined();
    inside.x = v.x + radius * 0.85;
    inside.y = v.y;
    outside.x = v.x + radius + 30;
    outside.y = v.y;
    const life = v.lifeMs;
    run(w, at(PX - 300, PY), Math.floor(life / STEP_MS) - 2, [inside, outside]);
    const beforeIn = hurt(inside);
    const beforeOut = hurt(outside);
    run(w, at(PX - 300, PY), 6, [inside, outside]);
    expect(hurt(inside)).toBeGreaterThan(beforeIn);
    expect(hurt(outside)).toBe(beforeOut);
  });
});
