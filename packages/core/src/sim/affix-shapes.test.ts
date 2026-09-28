/**
 * **Every affix, on every shape it says it fits, doing something there.**
 *
 * An affix names the shapes it works on, the card prints them, and an offer
 * deals only affixes some held spell can take (doc 013). So a shape on that
 * list is a promise, and a promise nothing checks is how the pool came to
 * hold `resonance` on Spirit Blades — the Blade style's own affix on its own
 * starter — which cast five bolts standing still at the player's feet and
 * dealt nothing, because a free cast always left as a projectile. This is
 * `eruption-affixes.test.ts` widened to the whole table: for each affix and
 * each shape it lists, one spell of that shape is cast (or the affix's hook
 * is set off — a hit taken, a dash through a body, the sword landing) beside
 * the same scenario without the affix, and the difference has to be the
 * thing the affix does.
 *
 * And the other half of the bug: **no free cast of a shape with no speed
 * spawns a bolt that stands still.** Checked over every spell of every such
 * shape, not only the representative.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step } from "./world.ts";
import { NO_INPUT } from "./types.ts";
import type { Enemy, Input, World } from "./types.ts";
import { makeEnemy } from "./enemy.ts";
import { attachAffix } from "./spells.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { ITEMS, plainInstance } from "../spells/index.ts";
import { SPELL_AFFIXES, SPELL_SHAPES, affixFitsSpell, itemShape } from "../spells/affixes.ts";
import type { SpellAffix, SpellShape } from "../spells/affixes.ts";
import { RngSource } from "../rng.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";

const src = new RngSource("affix-shapes");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("room"), { plain: true },
);
const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
/*
 * An empty floor inside the border walls, and no zones, so no fixture stands
 * in the line of a shot: the measurement is of the affix, and a pillar the
 * room happened to put between the caster and the bodies made pierce and
 * seek measure the pillar.
 */
const grid = built.grid.slice();
for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
const room = { ...built, grid, zones: [] };

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

const [PX, PY] = onFloor(300, 300);

/** One spell of each shape: the one every affix that lists the shape is cast on. */
const REPRESENTATIVE: Readonly<Record<SpellShape, string>> = {
  bolt: "magic_bolt", orbit: "spirit_blades", field: "wildfire_field", pillar: "stone_ward",
  dash: "blink_strike", vortex: "void_maw", summon: "spirit_ally", eruption: "earth_spikes",
  boomerang: "returning_edge", orb: "ball_lightning", trail: "cinder_stride", enchant: "crescent_edge",
  stance: "counter_stance",
};

/** The run's own affixes need a wake, which the shape's representative (Blink Strike) has not. */
const RUN_REPRESENTATIVE: Readonly<Record<string, string>> = {
  momentum: "dash_slash", undertow: "dash_slash", finale: "dash_slash",
};

/*
 * Two of doc 006's newer shapes do nothing where the rest are measured, and
 * both by their own rule: a trail lays ground only as the caster walks, and
 * an enchant throws its waves only from sword swings. So in every scenario a
 * trail's caster walks back and forth through the group (a dash scenario
 * dashes instead) and an enchant's caster swings — beside the bare run doing
 * the same, so the difference is still only the affix's.
 */
const walks = (spell: string) => itemShape(ITEMS.get(spell)) === "trail";
const swings = (spell: string) => itemShape(ITEMS.get(spell)) === "enchant";

/**
 * How an affix's hook is set off.
 *
 * - `press`: the key held for ten seconds at a group of bodies, near and far.
 * - `kill`: the same, at bodies that die to a touch.
 * - `wall`: one cast at a wall with nothing in the way, let run out.
 * - `far`: one cast straight ahead past a body beyond the reach a cast seeks
 *   in, so the plain shot flies by it and only a shot that bends finds it.
 * - `hurt`: an enemy shot lands on the player; the key is not pressed.
 * - `dash`: the player dashes through a body; the key is not pressed.
 * - `swing`: the sword swung into a body; the key is not pressed.
 */
type Scenario = "press" | "kill" | "wall" | "far" | "hurt" | "dash" | "swing";

function scenarioOf(a: SpellAffix): Scenario {
  // A shot that bends onto bodies shows it on a shot that was not aimed at one.
  const e = a.effect;
  if (e.kind === "shape" && e.homing) return "far";
  switch (a.hook) {
    case "kill": return "kill";
    case "expire": case "wall": return "wall";
    case "hurt": return "hurt";
    case "dash": return "dash";
    case "swing": return "swing";
    default: return "press";
  }
}

/*
 * Near and far, in a line and off it, and three round the caster's back, so
 * every shape finds something where it lands: blades turning at arm's
 * length, a dash, a line of ground, a pull under the body sought, a shot
 * that passes through the first body into the next.
 */
const GROUP: readonly [number, number][] = [
  [36, 0], [60, 22], [60, -22], [110, 0], [150, 0], [150, 50], [0, 46], [0, -46], [-46, 0],
];

const BODIES: Readonly<Record<Scenario, readonly [number, number][]>> = {
  press: GROUP, kill: GROUP,
  wall: [],
  far: [[600, 70]],
  hurt: [[120, 0], [60, 40]],
  dash: [[40, 0], [80, 30]],
  swing: [[20, 0], [40, 24]],
};

/** Ten seconds: long enough for a ring of blades to run out and an on-hit roll to come up. */
const FRAMES = 600;

/** What one run left behind, counted the same way with the affix and without. */
interface Seen {
  /** Health taken off the bodies, in all. */
  damage: number;
  /**
   * Things the spell put into the world: projectiles born, patches lit,
   * pulls opened, cells of ground gone off, pillars raised, companions
   * called, cuts landed at a point.
   */
  made: number;
  splits: number;
  arcs: number;
  brands: number;
  harvests: number;
  hastes: number;
  fires: number;
  wards: number;
  burn: number;
  poison: number;
  chill: number;
  /** Projectile-frames: how long the spell's shots stayed in the air, summed. */
  airborne: number;
  /** The most projectiles standing still, not orbiting, at any one frame. */
  stationary: number;
  /** A run carried on by a body it cut (`momentum`), and a run's thrown end (`finale`). */
  momentum: number;
  finales: number;
  /** Body-frames being shoved back toward the run's line (`undertow`) rather than off it. */
  inward: number;
}

function run(spell: string, scenario: Scenario, affix?: SpellAffix): Seen {
  const w: World = createWorld({
    room, encounter: null, props: 0,
    staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance(spell), null, null, null, null, null],
    hearts: 6, rng: src.stream("w", spell, scenario, affix?.id ?? "bare"),
  });
  w.player.x = PX;
  w.player.y = PY;
  w.player.facing = 0;
  if (affix) {
    let slot = w.spells[0]!;
    slot = attachAffix(slot, affix.id) ?? slot;
    w.spells[0] = slot;
  }
  const hp = scenario === "kill" ? 1 : 100_000;
  // Exactly where the scenario says: the floor is empty, and a body snapped
  // to a tile centre sat just outside the blades' ring.
  const bodies: Enemy[] = BODIES[scenario].map(([dx, dy]) => {
    const e = makeEnemy(w.nextEnemyId++, "rusher", PX + dx, PY + dy, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.hp = hp;
    e.maxHp = hp;
    e.speed = 0;
    e.attackCooldownMs = 1e9;
    w.enemies.push(e);
    return e;
  });
  const home = bodies.map((e) => ({ x: e.x, y: e.y }));
  const aim = scenario === "wall" ? { x: PX - 600, y: PY } : scenario === "far" ? { x: PX + 700, y: PY } : { x: PX + 150, y: PY };
  const seen: Seen = {
    damage: 0, made: 0, splits: 0, arcs: 0, brands: 0, harvests: 0, hastes: 0, fires: 0,
    wards: 0, burn: 0, poison: 0, chill: 0, airborne: 0, stationary: 0, momentum: 0, finales: 0, inward: 0,
  };
  /*
   * A pool slot counts as a birth when it comes alive **or is renewed** —
   * its clock goes up — because a full pool is written over in place: a
   * held Void Maw keeps all six pulls alive, and a side cast that replaces
   * one is still a pull the affix opened.
   */
  const was = {
    bullets: w.playerBullets.map((b) => b.alive),
    fires: w.fires.map((f) => (f.alive ? f.lifeMs : -1)),
    vortices: w.vortices.map((v) => (v.alive ? v.lifeMs : -1)),
    pets: w.pets.map((p) => (p.alive ? p.lifeMs : -1)),
    orbs: w.orbs.map((o) => (o.alive ? o.lifeMs : -1)),
  };
  const born = (alive: boolean, life: number, before: number): boolean => alive && (before < 0 || life > before);
  let pillars = 0;
  const observe = (): void => {
    w.playerBullets.forEach((b, i) => { if (b.alive && !was.bullets[i]) seen.made++; was.bullets[i] = b.alive; });
    w.fires.forEach((f, i) => {
      if (born(f.alive, f.lifeMs, was.fires[i]!)) { seen.made++; seen.fires++; }
      was.fires[i] = f.alive ? f.lifeMs : -1;
    });
    w.vortices.forEach((v, i) => { if (born(v.alive, v.lifeMs, was.vortices[i]!)) seen.made++; was.vortices[i] = v.alive ? v.lifeMs : -1; });
    w.pets.forEach((p, i) => { if (born(p.alive, p.lifeMs, was.pets[i]!)) seen.made++; was.pets[i] = p.alive ? p.lifeMs : -1; });
    w.orbs.forEach((o, i) => { if (born(o.alive, o.lifeMs, was.orbs[i]!)) seen.made++; was.orbs[i] = o.alive ? o.lifeMs : -1; });
    const raised = w.props.filter((p) => p.kind === "pillar").length;
    if (raised > pillars) { seen.made += raised - pillars; pillars = raised; }
    for (const ev of w.events) {
      if (ev.kind === "eruption") seen.made++;
      if (ev.kind === "shot" && ev.what === "free_strike") seen.made++;
      // A trail, an enchant or a stance started or renewed on the caster.
      if (ev.kind === "spell" && (ev.what === "trail" || ev.what === "enchant" || ev.what === "stance")) seen.made++;
      if (ev.kind === "shot" && ev.what === "split") seen.splits++;
      if (ev.kind === "shot" && ev.what === "arc") seen.arcs++;
      if (ev.kind === "enemy_hit" && ev.what === "brand") seen.brands++;
      if (ev.kind === "enemy_hit" && ev.what === "harvest") seen.harvests++;
      if (ev.kind === "pickup" && ev.what === "haste") seen.hastes++;
      if (ev.kind === "spell" && ev.what === "momentum") seen.momentum++;
      if (ev.kind === "spell" && ev.what === "finale") seen.finales++;
    }
    seen.wards = Math.max(seen.wards, w.wards.length);
    let still = 0;
    for (const b of w.playerBullets) {
      if (!b.alive) continue;
      seen.airborne++;
      if (b.orbitMs <= 0 && Math.hypot(b.vx, b.vy) < 1) still++;
    }
    seen.stationary = Math.max(seen.stationary, still);
    // Summed over the run rather than the peak: a spell of the element
    // already saturates the gauge, and what the affix adds there is how soon
    // and how long it runs, not how high.
    // The run goes along the aim, level with the caster: back toward it is toward PY.
    for (const e of bodies) if (Math.abs(e.knockY) > 1 && (e.y - PY) * e.knockY < 0) seen.inward++;
    for (const e of bodies) {
      seen.burn += e.burnBuild + (e.burnMs > 0 ? 1 + e.burnSources : 0);
      seen.poison += e.poisonBuild + e.poisonStacks;
      seen.chill += e.chillBuild + (e.frozenMs > 0 ? 1 : 0);
    }
  };
  const repin = (): void => {
    bodies.forEach((e, i) => { e.x = home[i]!.x; e.y = home[i]!.y; e.attackCooldownMs = 1e9; e.attack = "approach"; });
  };
  const walking = walks(spell) && scenario !== "dash";
  const input = (t: number): Input => {
    // Back and forth across the group, a second each way.
    const walk = walking ? { moveX: Math.floor(t / 60) % 2 === 0 ? 1 : -1 } : {};
    const base = { ...NO_INPUT, aimX: aim.x, aimY: aim.y, ...walk, ...(swings(spell) ? { swing: true } : {}) };
    switch (scenario) {
      case "press": case "kill": return { ...base, spell: 0 };
      // One cast, let run out: a held ring or pull is renewed, never expires.
      case "wall": case "far": return t === 0 ? { ...base, spell: 0 } : base;
      case "dash": return t === 0 ? { ...base, moveX: 1, dash: true } : t < 14 ? { ...base, moveX: 1 } : base;
      case "swing": return { ...base, swing: true };
      default: return base;
    }
  };
  for (let t = 0; t < FRAMES; t++) {
    w.player.mana = w.staff.mana_max;
    if (scenario === "hurt" && t === 0) {
      w.player.invulnMs = 0;
      const b = w.enemyBullets.find((x) => !x.alive)!;
      b.alive = true; b.x = w.player.x; b.y = w.player.y; b.vx = 0; b.vy = 0;
      b.radius = 3; b.lifeMs = 5000; b.damage = 1; b.from = "shooter";
    }
    step(w, input(t));
    observe();
    repin();
    // The player is held where the scenario put them, except while a dash carries them or a trail walks.
    if (scenario !== "dash" && !walking && w.player.dashMs <= 0 && w.player.strikeMs <= 0) { w.player.x = PX; w.player.y = PY; }
    w.player.hearts = 6;
  }
  seen.damage = bodies.reduce((t, e) => t + Math.max(0, hp - e.hp), 0);
  return seen;
}

/** Whether `withIt` shows what this affix does, against `bare`. */
function observable(a: SpellAffix, bare: Seen, withIt: Seen): boolean {
  const e = a.effect;
  switch (e.kind) {
    case "split": return withIt.splits > bare.splits;
    case "arc": return withIt.arcs > bare.arcs;
    case "mark": return withIt.brands > bare.brands;
    case "burst": return withIt.harvests > bare.harvests;
    case "haste": return withIt.hastes > bare.hastes;
    case "momentum": return withIt.momentum > bare.momentum;
    case "undertow": return withIt.inward > bare.inward;
    case "finale": return withIt.finales > bare.finales;
    case "field": return withIt.fires > bare.fires;
    case "ward": return withIt.wards > bare.wards;
    case "repeat": case "spread": return withIt.made > bare.made;
    // A free cast at a body at arm's length may be born and spent inside one
    // step, so what it did is either the thing it made or the damage it dealt.
    case "riposte": case "resonate": return withIt.made > bare.made || withIt.damage > bare.damage;
    case "shape":
      if (e.element === "fire") return withIt.burn > bare.burn;
      if (e.element === "poison") return withIt.poison > bare.poison;
      if (e.element === "ice") return withIt.chill > bare.chill;
      // Through bodies: more of the group hurt. Toward bodies: the shot that
      // flew past the far body finds it. Off walls:
      // the shot stays in the air after the wall it would have died on.
      if (e.pierce) return withIt.damage > bare.damage;
      if (e.homing) return withIt.damage > bare.damage;
      if (e.bounce) return withIt.airborne > bare.airborne;
      return false;
  }
}

const bareCache = new Map<string, Seen>();
function bare(spell: string, scenario: Scenario): Seen {
  const key = `${spell}:${scenario}`;
  let s = bareCache.get(key);
  if (!s) { s = run(spell, scenario); bareCache.set(key, s); }
  return s;
}

describe("every affix does something on every shape it lists", () => {
  for (const a of SPELL_AFFIXES) {
    for (const shape of a.shapes) {
      const spell = RUN_REPRESENTATIVE[a.id] ?? REPRESENTATIVE[shape];
      it(`${a.id} on ${shape} (${spell})`, () => {
        // The representative must itself be able to take the affix, or the
        // offer would never deal it there and the claim is untested.
        expect(affixFitsSpell(a, ITEMS.get(spell), [])).toBe(true);
        const scenario = scenarioOf(a);
        const seen = run(spell, scenario, a);
        expect({ affix: a.id, shape, seen: observable(a, bare(spell, scenario), seen) })
          .toEqual({ affix: a.id, shape, seen: true });
      });
    }
  }

  it("covers every shape with a representative of that shape", () => {
    for (const shape of SPELL_SHAPES) expect(itemShape(ITEMS.get(REPRESENTATIVE[shape]))).toBe(shape);
  });
});

/**
 * The free casts of every spell that does not fly: none of them may leave a
 * projectile standing still, and each must put its own shape into the world.
 */
describe("a free cast is the spell's own shape", () => {
  const still = [...ITEMS.values()].filter((i) => itemShape(i) !== "bolt");
  const free: readonly [string, Scenario][] = [["retort", "hurt"], ["slipstream", "dash"], ["resonance", "swing"], ["scatter", "press"]];
  for (const item of still) {
    for (const [id, scenario] of free) {
      const a = SPELL_AFFIXES.find((x) => x.id === id)!;
      if (!affixFitsSpell(a, item, [])) continue;
      it(`${id} on ${item.id} leaves no bolt standing and makes its shape`, () => {
        const seen = run(item.id, scenario, a);
        expect(seen.stationary, "a free cast stood a bolt at the caster's feet").toBe(0);
        expect(seen.made).toBeGreaterThan(bare(item.id, scenario).made);
      });
    }
  }
});
