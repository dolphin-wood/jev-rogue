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
import { plainInstance, ITEMS } from "../spells/index.ts";
import { spellShapeOf } from "../render/spell-look.ts";
import { RngSource } from "../rng.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";
import type { Input } from "./types.ts";
import type { Element } from "../types.ts";

const src = new RngSource("affix-hooks");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
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

/** A world with one attack on key 0 and, optionally, one affix on it. */
function arena(affix?: { id: string }, base = "magic_bolt"): World {
  const w = createWorld({
    room, encounter: null, props: 0,
    staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance(base), null, null, null, null, null],
    hearts: 6, rng: src.stream("w", `${affix?.id ?? "bare"}:${base}`),
  });
  w.player.x = PX;
  w.player.y = PY;
  w.player.facing = 0;
  w.player.mana = w.staff.mana_max;
  if (affix) {
    let slot = w.spells[0]!;
    slot = attachAffix(slot, affix.id) ?? slot;
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
    expect(twice).toBe(bare * 2);
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
    // One more direction: behind.
    expect(castAndRun(arena({ id: "scatter" }), { x: PX + 150, y: PY }).spawned).toBe(bare * 2);
  });

  it("ward leaves a rune that eats an enemy projectile", () => {
    const w = arena({ id: "ward" });
    expect(w.wards).toHaveLength(0);
    // Past the bolt's windup, the rune is down.
    castAndRun(w, { x: PX + 150, y: PY }, 6);
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

  /**
   * **A fork's shards are the spell again, smaller.** The first shard is
   * handed its dead parent's own pool slot, and the slot used to be wiped
   * before the parent was read: every shard came out slot -1 and element-less,
   * drawn as a plain bolt whatever had split, and each later shard was cut
   * from the one before it.
   */
  it.each(["frost_needle", "void_orb"])("fork's shards keep %s's slot, element and speed", (base) => {
    const w = arena({ id: "fork" }, base);
    // The orb pierces two bodies and splits on the third.
    const first = dummy(w, 60, 0);
    dummy(w, 110, 0);
    dummy(w, 160, 0);
    step(w, aimAt(first, { spell: 0 }));
    let parent: { speed: number; radius: number; damage: number; element: string } | null = null;
    let shards: { speed: number; radius: number; damage: number; element: string; slot: number }[] = [];
    for (let i = 0; i < 400 && shards.length === 0; i++) {
      step(w, aimAt(first));
      const split = w.events.some((e) => e.kind === "shot" && e.what === "split");
      const live = w.playerBullets.filter((b) => b.alive);
      if (split) shards = live.filter((b) => b.split === 0).map((b) => ({
        speed: Math.hypot(b.vx, b.vy), radius: b.radius, damage: b.damage, element: b.element, slot: b.spellIndex,
      }));
      else if (live[0]) parent = { speed: Math.hypot(live[0].vx, live[0].vy), radius: live[0].radius, damage: live[0].damage, element: live[0].element };
    }
    expect(parent).not.toBeNull();
    // Fork splits in two.
    expect(shards.length).toBe(2);
    for (const s of shards) {
      expect(s.slot).toBe(0);
      expect(s.element).toBe(parent!.element);
      expect(s.speed).toBeCloseTo(parent!.speed, 0);
      expect(s.radius).toBeLessThan(parent!.radius);
      expect(s.damage).toBeLessThan(parent!.damage);
    }
    // Every shard is cut from the parent, not from the shard before it.
    expect(new Set(shards.map((s) => `${s.radius}:${s.damage}`)).size).toBe(1);
  });

  it("chain reaches the next body with a copy of the spell", () => {
    const w = arena({ id: "chain" });
    const first = dummy(w, 150, 0);
    const second = dummy(w, 150, 60);
    castAndRun(w, first);
    expect(first.hp).toBeLessThan(100_000);
    // The second body was never aimed at and was still hurt.
    expect(second.hp).toBeLessThan(100_000);
  });

  /**
   * **What `chain` releases is the spell again, smaller.**
   *
   * The affix used to make one generic fast streak whatever it was attached
   * to, which meant every build's chain looked and behaved the same. The
   * copy has to carry the identity the renderer draws from — the slot it was
   * cast by, its element, and therefore its shape — and to be visibly less
   * than the shot that made it.
   */
  it.each(["frost_needle", "void_orb", "shock_arc"])(
    "releases a weakened copy of %s with the spell's own identity",
    (base) => {
      const w = arena({ id: "chain" }, base);
      const first = dummy(w, 150, 0);
      dummy(w, 150, 60);
      /*
       * The cast's own shot is the first thing in the air; the copy is the
       * next birth after it, since `chain` is the only affix attached.
       */
      step(w, aimAt(first, { spell: 0 }));
      let source: { damage: number; radius: number } | null = null;
      for (let i = 0; i < 120 && !source; i++) {
        step(w, aimAt(first));
        const shot = w.playerBullets.filter((b) => b.alive && b.spellIndex === 0)
          .sort((a, b) => b.damage - a.damage)[0];
        if (shot) source = { damage: shot.damage, radius: shot.radius };
      }
      expect(source).not.toBeNull();
      const born = w.playerBullets.map((b) => b.alive);
      let copy: { spellIndex: number; element: string; damage: number; radius: number } | null = null;
      for (let i = 0; i < 120 && !copy; i++) {
        step(w, aimAt(first));
        w.playerBullets.forEach((b, k) => {
          if (b.alive && !born[k] && b.spellIndex >= 0 && !copy)
            copy = { spellIndex: b.spellIndex, element: b.element, damage: b.damage, radius: b.radius };
          born[k] = b.alive;
        });
      }
      expect(copy).not.toBeNull();
      const slot = w.spells[copy!.spellIndex]!;
      // Identity: the slot that cast it, its element, and so its drawn shape.
      expect(copy!.spellIndex).toBe(0);
      expect(slot.item.base).toBe(base);
      expect(copy!.element).toBe(ITEMS.get(base)!.params.element ?? "none");
      expect(spellShapeOf(slot.item.base, copy!.element as Element))
        .toBe(spellShapeOf(base, copy!.element as Element));
      // Weakened: smaller and softer than the shot that made it.
      expect(copy!.damage).toBeLessThan(source!.damage);
      expect(copy!.radius).toBeLessThan(source!.radius);
    },
  );

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

});

describe("death affixes", () => {
  it("bloom leaves a field where the shot ran out", () => {
    // Aimed at nothing: the shot ends on the far wall, which counts as running
    // out — at this room size nearly every miss does.
    expect(castAndRun(arena(), { x: PX + 40, y: PY }, 100).sawFire).toBe(false);
    expect(castAndRun(arena({ id: "bloom" }), { x: PX + 40, y: PY }, 100).sawFire).toBe(true);
  });

  it("shatter breaks the shot on a wall", () => {
    // Fired straight into the west border, which is the nearest wall.
    expect(castAndRun(arena(), { x: PX - 600, y: PY }, 90).splits).toBe(0);
    expect(castAndRun(arena({ id: "shatter" }), { x: PX - 600, y: PY }, 90).splits).toBe(1);
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

/**
 * **A free cast is the same spell.**
 *
 * `resonance` and `retort` fired through an empty scope, so their shots
 * carried `spellIndex: -1`, no affixes and no element. Everything the renderer
 * knows about a shot's look — the named sprite, the core and glow colours, the
 * element art, the landing sound — is a lookup on the slot that cast it, so a
 * spell auto-cast by an affix came out as a generic pale bolt that did not
 * resemble the one on the key.
 *
 * So the test is on the projectile's identity, not on its picture: the slot
 * index it came from, the affixes it carries, and the element it is infused
 * with. Given those, a hook cast and a pressed cast draw the same.
 */
describe("a spell an affix casts for free is still that spell", () => {
  /** A bolt with a slot, an element and a tier on it, so identity is visible. */
  const infused = (w: World, id: string): void => {
    let slot = w.spells[0]!;
    for (const a of [id, "kindle"]) slot = attachAffix(slot, a) ?? slot;
    w.spells[0] = slot;
  };

  it("retort carries the source spell's slot, affixes and element", () => {
    const w = arena();
    infused(w, "retort");
    dummy(w, 120, 0);
    w.player.invulnMs = 0;
    const b = w.enemyBullets.find((x) => !x.alive)!;
    b.alive = true; b.x = w.player.x; b.y = w.player.y; b.vx = 0; b.vy = 0;
    b.radius = 3; b.lifeMs = 5000; b.damage = 1; b.from = "shooter";
    step(w, NO_INPUT);
    const shots = w.playerBullets.filter((x) => x.alive);
    expect(shots.length, "retort fired nothing").toBeGreaterThan(0);
    for (const s of shots) {
      expect(s.spellIndex, "a retort shot has no spell behind it").toBe(0);
      expect(s.affixes.map((a) => a.id)).toContain("kindle");
      expect(s.element).toBe("fire");
    }
  });

  it("resonance carries them too, and matches what the key casts", () => {
    const w = arena();
    infused(w, "resonance");
    const body = dummy(w, 20, 0);
    // The pressed cast, for comparison. A cast has a windup, so it is run out.
    const seen = (): { spellIndex: number; element: string; affixes: string[] }[] =>
      w.playerBullets.filter((x) => x.alive).map((x) => ({
        spellIndex: x.spellIndex, element: x.element, affixes: x.affixes.map((a) => a.id).sort(),
      }));
    step(w, aimAt(body, { spell: 0 }));
    let pressed = seen();
    for (let i = 0; i < 40 && !pressed.length; i++) { step(w, aimAt(body)); pressed = seen(); }
    expect(pressed.length, "the pressed cast fired nothing").toBeGreaterThan(0);
    for (const b of w.playerBullets) b.alive = false;
    // Then sword hits until the resonance count comes due.
    let free: typeof pressed = [];
    for (let i = 0; i < 40 && !free.length; i++) {
      step(w, aimAt(body, { swing: true }));
      for (let k = 0; k < 20 && !free.length; k++) {
        step(w, aimAt(body));
        if (w.events.some((e) => e.kind === "shot" && e.what === "resonance")) free = seen();
      }
    }
    expect(free.length, "resonance never fired").toBeGreaterThan(0);
    // Same identity as the pressed cast: slot, element, attached affixes.
    expect(free[0]).toEqual(pressed[0]);
  });
});

describe("attaching", () => {
  it("takes an affix once: the same one again changes nothing and takes no slot", () => {
    const w = arena({ id: "fork" });
    const again = attachAffix(w.spells[0]!, "fork")!;
    expect(again.affixes).toEqual([{ id: "fork" }]);
  });

  it("holds three at most", () => {
    let slot = arena().spells[0]!;
    slot = attachAffix(slot, "fork")!;
    slot = attachAffix(slot, "chain")!;
    slot = attachAffix(slot, "brand")!;
    expect(attachAffix(slot, "harvest")).toBeNull();
    // One already held is not a fourth: the key comes back as it was.
    expect(attachAffix(slot, "chain")).toEqual(slot);
  });
});
