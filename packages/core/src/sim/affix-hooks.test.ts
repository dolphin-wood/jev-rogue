/**
 * Every affix, attached to a spell, observed doing the thing its card says.
 *
 * This is the test the pool was not allowed to be offered without. Each case
 * builds an empty arena, attaches one affix to `magic_bolt`, does the thing
 * that should trigger it, and asserts on a consequence a player could see —
 * more projectiles, a second body hurt, mana returned, a fire on the floor.
 *
 * The bare spell is measured alongside in every case rather than assumed,
 * because the point is the *difference* the affix makes, and a baseline that
 * drifts would turn every one of these into a test of the baseline.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step } from "./world.ts";
import { NO_INPUT } from "./types.ts";
import type { World } from "./types.ts";
import { makeEnemy } from "./enemy.ts";
import { attachAffix } from "./spells.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { staffFor, plainInstance, ITEMS } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";
import type { Input } from "./types.ts";

const src = new RngSource("affix-hooks");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("room"), { plain: true },
);
const room = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });

/** The nearest open floor to a point, so no body is ever placed in a wall. */
function onFloor(x: number, y: number): [number, number] {
  const gx0 = Math.floor(x / TILE_PX);
  const gy0 = Math.floor(y / TILE_PX);
  const free = (gx: number, gy: number): boolean =>
    gx >= 1 && gy >= 1 && gx < GRID_W - 1 && gy < GRID_H - 1
    && room.grid[gy * GRID_W + gx] === Tile.Floor;
  for (let r = 0; r < GRID_W; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (free(gx0 + dx, gy0 + dy)) return [(gx0 + dx + 0.5) * TILE_PX, (gy0 + dy + 0.5) * TILE_PX];
      }
  return [x, y];
}

const [PX, PY] = onFloor(300, 208);

/** A world with `magic_bolt` on key 0 and, optionally, one affix on it. */
function arena(affix?: { id: string; tier?: 1 | 2 | 3 }): World {
  const w = createWorld({
    room, encounter: null, props: 0,
    staff: staffFor({ slots: "many", mana: "high", tempo: "steady", special: "none" }),
    slots: [plainInstance("magic_bolt"), null, null, null, null, null],
    hearts: 6, rng: src.stream("w", affix?.id ?? "bare"),
  });
  w.player.x = PX;
  w.player.y = PY;
  w.player.facing = 0;
  w.player.mana = w.staff.mana_max;
  if (affix) {
    let slot = w.spells[0]!;
    for (let t = 0; t < (affix.tier ?? 1); t++) slot = attachAffix(slot, affix.id) ?? slot;
    w.spells[0] = slot;
  }
  return w;
}

/** A pinned body that cannot die unless the test wants it to. */
function dummy(w: World, dx: number, dy: number, hp = 100_000) {
  const [x, y] = onFloor(PX + dx, PY + dy);
  const e = makeEnemy(w.nextEnemyId++, "rusher", x, y, []);
  e.spawnFadeMs = 0;
  e.awake = true;
  e.hp = hp;
  e.maxHp = Math.max(hp, e.maxHp);
  e.speed = 0;
  w.enemies.push(e);
  return e;
}

const aimAt = (t: { x: number; y: number }, extra: Partial<Input> = {}): Input =>
  ({ ...NO_INPUT, aimX: t.x, aimY: t.y, ...extra });

/**
 * Casts key 0 once and runs `frames`. Returns how many projectiles the cast
 * itself produced, plus what was seen along the way.
 *
 * `spawned` counts pool slots going dead-to-alive **between** frames, so it is
 * blind to a shard that reuses its dead parent's slot within one frame — which
 * is what every fork and shatter does. Those are therefore asserted on the
 * `split` event the world emits, not on this count; the count is for casts.
 * `sawFire` is tracked per frame because a tier-one field lasts 1.4 s and a
 * check at the end of the run can land after it has gone out.
 */
function castAndRun(
  w: World, target: { x: number; y: number }, frames = 120,
): { spawned: number; splits: number; sawFire: boolean } {
  const wasAlive = w.playerBullets.map((b) => b.alive);
  let spawned = 0;
  let splits = 0;
  let sawFire = false;
  const observe = (): void => {
    w.playerBullets.forEach((b, i) => {
      if (b.alive && !wasAlive[i]) spawned++;
      wasAlive[i] = b.alive;
    });
    splits += w.events.filter((e) => e.kind === "shot" && e.what === "split").length;
    if (w.fires.some((f) => f.alive)) sawFire = true;
  };
  step(w, aimAt(target, { spell: 0 }));
  observe();
  for (let i = 0; i < frames; i++) {
    step(w, aimAt(target));
    observe();
  }
  return { spawned, splits, sawFire };
}

describe("cast affixes", () => {
  it("repeat fires the spell again", () => {
    const bare = castAndRun(arena(), { x: PX + 150, y: PY }).spawned;
    const twice = castAndRun(arena({ id: "repeat" }), { x: PX + 150, y: PY }).spawned;
    const thrice = castAndRun(arena({ id: "repeat", tier: 2 }), { x: PX + 150, y: PY }).spawned;
    expect(twice).toBe(bare * 2);
    expect(thrice).toBe(bare * 3);
  });

  it("repeat's second cast comes a beat later, not in the same frame", () => {
    /*
     * It came in the same frame, on the same aim, and the two copies
     * overlapped exactly: double damage and nothing to see. "Casts twice"
     * was reported as doing nothing.
     */
    const bare = castAndRun(arena(), { x: PX + 150, y: PY }, 0).spawned;
    const w = arena({ id: "repeat" });
    const first = castAndRun(w, { x: PX + 150, y: PY }, 0).spawned;
    expect(first).toBe(bare);
    const later = castAndRun(w, { x: PX + 150, y: PY }, 10).spawned;
    // The follow-up frames hold the echo and nothing else (the key is held
    // down again by the helper, but the slot is on cooldown).
    expect(later).toBeGreaterThanOrEqual(bare);
  });

  it("scatter casts in the other directions too", () => {
    const bare = castAndRun(arena(), { x: PX + 150, y: PY }).spawned;
    // Tier 1 adds one direction, behind; tier 2 adds three.
    expect(castAndRun(arena({ id: "scatter" }), { x: PX + 150, y: PY }).spawned).toBe(bare * 2);
    expect(castAndRun(arena({ id: "scatter", tier: 2 }), { x: PX + 150, y: PY }).spawned).toBe(bare * 4);
  });

  it("ward leaves a rune that eats an enemy projectile", () => {
    const w = arena({ id: "ward" });
    expect(w.wards).toHaveLength(0);
    castAndRun(w, { x: PX + 150, y: PY }, 2);
    expect(w.wards).toHaveLength(1);
    expect(w.wards[0]!.shots).toBe(1);
    // An enemy shot crossing the rune is consumed and spends the rune.
    const b = w.enemyBullets.find((x) => !x.alive)!;
    b.alive = true; b.x = w.wards[0]!.x; b.y = w.wards[0]!.y; b.vx = 0; b.vy = 0;
    b.radius = 3; b.lifeMs = 5000; b.damage = 1;
    const hearts = w.player.hearts;
    step(w, NO_INPUT);
    expect(b.alive).toBe(false);
    expect(w.player.hearts).toBe(hearts);
    expect(w.wards).toHaveLength(0);
  });
});

describe("hit affixes", () => {
  it("fork breaks the shot into shards on impact", () => {
    const bareW = arena();
    dummy(bareW, 150, 0);
    expect(castAndRun(bareW, bareW.enemies[0]!).splits).toBe(0);
    const forkW = arena({ id: "fork" });
    dummy(forkW, 150, 0);
    // The projectile left the cast carrying the split, and came apart on the hit.
    expect(castAndRun(forkW, forkW.enemies[0]!).splits).toBe(1);
  });

  it("chain arcs from the body it hit to the next one", () => {
    const w = arena({ id: "chain" });
    const first = dummy(w, 150, 0);
    const second = dummy(w, 150, 60);
    castAndRun(w, first);
    expect(first.hp).toBeLessThan(100_000);
    // The second body was never aimed at and was still hurt.
    expect(second.hp).toBeLessThan(100_000);
  });

  it("brand marks on the first hit and detonates on the second", () => {
    const one = arena({ id: "brand" });
    const t1 = dummy(one, 150, 0);
    castAndRun(one, t1);
    expect(t1.marked).toBe(true);
    const oneHit = 100_000 - t1.hp;

    const two = arena({ id: "brand" });
    const t2 = dummy(two, 150, 0);
    castAndRun(two, t2, 60);
    castAndRun(two, t2, 60);
    expect(t2.marked).toBe(false);
    // Two hits plus a detonation is more than two hits.
    expect(100_000 - t2.hp).toBeGreaterThan(oneHit * 2);
  });
});

describe("kill affixes", () => {
  it("harvest bursts where the body fell", () => {
    const w = arena({ id: "harvest" });
    const victim = dummy(w, 150, 0, 1);
    // Placed relative to where the victim actually landed, not to the player:
    // `onFloor` may have nudged the victim off a wall cell, and a bystander
    // measured from the original point can end up outside the burst.
    const bystander = dummy(w, victim.x - PX, victim.y - PY + 36);
    castAndRun(w, victim);
    expect(w.enemies.includes(victim)).toBe(false);
    expect(bystander.hp).toBeLessThan(100_000);
  });

  it("echo returns mana on a kill", () => {
    const bare = arena();
    dummy(bare, 150, 0, 1);
    castAndRun(bare, bare.enemies[0]!, 30);
    const echo = arena({ id: "echo" });
    dummy(echo, 150, 0, 1);
    castAndRun(echo, echo.enemies[0]!, 30);
    // Same regen over the same frames, so the difference is the refund.
    expect(echo.player.mana).toBeGreaterThan(bare.player.mana);
  });
});

describe("death affixes", () => {
  it("bloom leaves a field where the shot ran out", () => {
    // Aimed at nothing: the shot ends on the far wall, which counts as running
    // out — at this room size nearly every miss does.
    expect(castAndRun(arena(), { x: PX + 40, y: PY }, 100).sawFire).toBe(false);
    expect(castAndRun(arena({ id: "bloom" }), { x: PX + 40, y: PY }, 100).sawFire).toBe(true);
  });

  it("shatter breaks the shot on a wall", () => {
    // Fired straight into the east border, which is the nearest wall.
    expect(castAndRun(arena(), { x: PX + 600, y: PY }, 90).splits).toBe(0);
    expect(castAndRun(arena({ id: "shatter" }), { x: PX + 600, y: PY }, 90).splits).toBe(1);
  });
});

describe("hurt and dash affixes", () => {
  it("retort fires back at what hit the player", () => {
    const w = arena({ id: "retort" });
    const attacker = dummy(w, 120, 0);
    w.player.invulnMs = 0;
    // An enemy shot lands on the player.
    const b = w.enemyBullets.find((x) => !x.alive)!;
    b.alive = true; b.x = w.player.x; b.y = w.player.y; b.vx = 0; b.vy = 0;
    b.radius = 3; b.lifeMs = 5000; b.damage = 1; b.from = "shooter";
    step(w, NO_INPUT);
    expect(w.player.hearts).toBeCloseTo(6 - 0.6, 5);
    // A free cast appeared, heading for the attacker.
    const shots = w.playerBullets.filter((x) => x.alive);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots[0]!.vx).toBeGreaterThan(0);
    void attacker;
  });

  it("slipstream casts at a body the dash passes through", () => {
    const w = arena({ id: "slipstream" });
    const body = dummy(w, 40, 0);
    // Dash east, straight through it.
    step(w, { ...NO_INPUT, moveX: 1, dash: true, aimX: PX + 64, aimY: PY });
    let fired = 0;
    for (let i = 0; i < 12; i++) {
      step(w, { ...NO_INPUT, moveX: 1, aimX: PX + 64, aimY: PY });
      fired = Math.max(fired, w.playerBullets.filter((x) => x.alive).length);
    }
    expect(fired).toBeGreaterThan(0);
    expect(w.player.slipFired).toBe(1);
    void body;
  });
});

describe("attaching", () => {
  it("upgrades a duplicate instead of taking a second slot", () => {
    const w = arena({ id: "fork" });
    const again = attachAffix(w.spells[0]!, "fork")!;
    expect(again.affixes).toHaveLength(1);
    expect(again.affixes[0]!.tier).toBe(2);
  });

  it("caps at three tiers and three slots", () => {
    let slot = arena().spells[0]!;
    for (let i = 0; i < 5; i++) slot = attachAffix(slot, "fork")!;
    expect(slot.affixes[0]!.tier).toBe(3);
    slot = attachAffix(slot, "chain")!;
    slot = attachAffix(slot, "brand")!;
    expect(attachAffix(slot, "harvest")).toBeNull();
    // A duplicate still fits when the slots are full: it takes none.
    expect(attachAffix(slot, "chain")).not.toBeNull();
  });
});
