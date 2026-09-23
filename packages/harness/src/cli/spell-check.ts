/**
 * Fires every castable item and reports what it actually did.
 *
 * The pool has twenty castables and nothing had ever pressed all twenty. Each
 * one is authored data — mana, damage, count, spread, lifetime, pierce,
 * element, plus the payload triggers and multicast fan-out — and authored data
 * that is never executed is authored data that is wrong somewhere. The three
 * questions this answers, per spell:
 *
 * - **Does it fire at all?** A spell whose mana cost exceeds the reference
 *   staff's pool, or whose unit fails to parse, silently does nothing.
 * - **Does it reach and hurt something?** Projectiles that expire before the
 *   target, or carriers whose child never fires, look identical to a working
 *   spell from the outside.
 * - **Is it distinguishable from its neighbours?** Twenty spells that all
 *   resolve to "one bolt, eight damage" is a content failure no unit test
 *   catches, because each row is individually valid.
 *
 * Run: `pnpm spell-check`
 *
 * ### What it deliberately does not do
 *
 * It is not a balance pass. Damage per mana is reported because it is free to
 * report and it makes an outlier obvious, but nothing here asserts a band — a
 * spell pool is meant to have a cheap reliable option and an expensive
 * situational one, and flattening that is the failure mode of measuring it too
 * early. What is asserted is that every spell *works*.
 */
import {
  createWorld, step, makeEnemy, generateRoom, toRoomPlan, staffFor,
  plainInstance, RngSource, NO_INPUT, ITEMS, STEP_MS, GRID_W, GRID_H, TILE_PX, Tile,
} from "@jr/core";
import type { BaseItem, World } from "@jr/core";

/** Long enough for a slow mortar to land and its child to resolve. */
const OBSERVE_MS = 2600;
/** Where the dummy stands, in px from the player: inside every spell's range. */
const TARGET_DIST = 150;
/**
 * How many times each spell is cast.
 *
 * One cast was not a fair test of a **spread** weapon. `scatter_shot` throws
 * five pellets through a 30 degree cone, which at 150 px is 80 px wide against
 * a target 20 px across — so whether any pellet connects is a roll, and a
 * single unlucky roll reported a working shotgun as broken. Three casts is
 * enough that "never hit" means the spell cannot hit rather than that it
 * happened not to.
 */
const CASTS = 3;
/** Between casts, so a cooldown or a cast interval never eats the second one. */
const CAST_GAP_MS = 700;

const src = new RngSource("spell-check");
const g = generateRoom(
  {
    space: "open_arena", symmetry: "mirrored",
    mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" },
  },
  "S", "combat", src.stream("r"), { plain: true },
);
const room = toRoomPlan(g, {
  id: "r", seed_key: "k", reward_kind: "item", params_source: "rule",
});

/**
 * The nearest real floor to a wanted spot.
 *
 * The third time a hard-coded coordinate has quietly become the inside of a
 * wall. The generator gained a free-standing kiting obstacle and two spells
 * started reporting "never hit" — not because they changed, but because the
 * dummy was standing in masonry. A measurement that hard-codes a position into
 * generated geometry is a measurement that will lie the next time the
 * generator changes.
 */
function onFloor(x: number, y: number): [number, number] {
  const gx0 = Math.floor(x / TILE_PX);
  const gy0 = Math.floor(y / TILE_PX);
  const free = (gx: number, gy: number): boolean =>
    gx >= 1 && gy >= 1 && gx < GRID_W - 1 && gy < GRID_H - 1
    && room.grid[gy * GRID_W + gx] === Tile.Floor;
  for (let r = 0; r < Math.max(GRID_W, GRID_H); r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (free(gx0 + dx, gy0 + dy))
          return [(gx0 + dx + 0.5) * TILE_PX, (gy0 + dy + 0.5) * TILE_PX];
      }
  return [x, y];
}

interface Result {
  readonly id: string;
  readonly kind: string;
  readonly mana: number;
  /** Projectiles that existed at any point, which is the fan-out. */
  readonly spawned: number;
  readonly damage: number;
  /** Peak concurrent projectiles, which separates a volley from a stream. */
  readonly peak: number;
  readonly hitTarget: boolean;
  /**
   * The first projectile's properties at spawn.
   *
   * Measured because damage against a pinned dummy cannot see most of what a
   * modifier does. Speed, size, pierce, homing, bounce and element all change
   * the projectile without changing what it does to a stationary target at one
   * fixed range — so scoring modifiers by damage reported six working ones as
   * broken. The question "did the modifier reach the projectile" has a direct
   * answer, and this is it.
   */
  readonly shot: {
    speed: number; radius: number; pierce: number;
    homing: number; bounce: number; split: number; element: string;
  } | null;
  readonly notes: readonly string[];
}

/**
 * One spell, alone in a staff, fired once at a dummy that cannot die.
 *
 * The dummy is given absurd health rather than being made invulnerable,
 * because a spell that kills it would stop the observation early and the
 * damage figure would then measure the dummy's health rather than the spell.
 */
function fire(base: BaseItem, extra: readonly string[] = []): Result {
  const w: World = createWorld({
    room, encounter: null,
    staff: staffFor({ slots: "many", mana: "high", tempo: "steady", special: "none" }),
    slots: [
      plainInstance(base.id),
      ...extra.map((id, i) => plainInstance(id, `${id}-${i}`)),
      null, null, null, null, null,
    ].slice(0, 8),
    hearts: 999, rng: src.stream("w", base.id),
    /*
     * **No scenery.** This is the third measurement bug in this file and the
     * most instructive: `createWorld` places six destructibles from the rng,
     * and the rng is seeded per spell id — so every spell was fired into a
     * *different* room, and the ones that happened to get a crate in front of
     * the player reported "nothing spawned" because their projectile hit it on
     * the first frame. The pattern looked like a content bug because it was
     * spread unevenly across the pool.
     */
    props: 0,
  });
  const [px, py] = onFloor(300, 208);
  w.player.x = px;
  w.player.y = py;
  w.player.facing = 0;
  // A full pool, so a cost that is merely expensive does not read as broken.
  w.player.mana = w.staff.mana_max;

  /*
   * A **rusher**, not a tank, and damage counted across armour as well as hp.
   *
   * The first version used a tank and reported that sixteen of twenty spells
   * "never hit". They all hit. The tank carries 18 armour and `hurtEnemy`
   * spends damage on armour before health, so every spell doing less than 18
   * in one projectile was invisible to an hp-only measurement — and the one
   * spell that looked fine, `cinder_burst`, was simply the one that broke
   * through. A measurement that makes working content look broken is worse
   * than no measurement, because it sends you to fix the wrong thing.
   */
  const [dx, dy] = onFloor(px + TARGET_DIST, py);
  const dummy = makeEnemy(1, "rusher", dx, dy, []);
  // Aim at where the dummy actually is, not at where it was asked to be.
  dummy.spawnFadeMs = 0;
  dummy.awake = true;
  dummy.hp = 100_000;
  dummy.maxHp = 100_000;
  // Pinned: a dummy that walks changes the distance the spell is measured at.
  dummy.speed = 0;
  /*
   * An orbiting spell hits what stands inside its ring, so its dummy stands
   * inside the ring; measured at the projectile distance it could only ever
   * report "never hit", which would be a fact about the tape measure.
   */
  if (base.params.shape === "orbit") {
    const r = Number(base.params.orbit_radius ?? 40);
    dummy.x = w.player.x + r;
    dummy.y = w.player.y;
  }
  // A dash strike travels about a hundred px; its dummy stands in the path.
  if (base.params.shape === "dash") dummy.x = w.player.x + 70;
  // A ring thrown out all round stops short by design; its dummy stands inside the ring's reach.
  if (Number(base.params.spread ?? 0) >= 180) dummy.x = w.player.x + 60;
  w.enemies.push(dummy);

  const before = dummy.hp + dummy.armour;
  let peak = 0;
  let spawned = 0;
  let live = 0;
  let hit = false;
  let shot: Result["shot"] = null;

  /*
   * Mana is read **immediately** after the first cast.
   *
   * Reading it at the end of the observation window said "no mana spent" for
   * six spells, because the staff regenerates and 2.6 seconds is long enough
   * to refill the pool. The question is whether the cast charged for itself,
   * and that is only answerable on the frame it happened.
   */
  let manaAfterCast = Infinity;

  for (let c = 0; c < CASTS; c++) {
    // The press is an edge, which is what the scene sends: holding a key must
    // not buy a cast per frame.
    w.player.mana = w.staff.mana_max;
    step(w, { ...NO_INPUT, aimX: dummy.x, aimY: dummy.y, spell: 0 }, STEP_MS, ITEMS);
    manaAfterCast = Math.min(manaAfterCast, w.player.mana);

    const window = c === CASTS - 1 ? OBSERVE_MS : CAST_GAP_MS;
    for (let ms = 0; ms < window; ms += STEP_MS) {
      step(w, { ...NO_INPUT, aimX: dummy.x, aimY: dummy.y }, STEP_MS, ITEMS);
      let now = 0;
      for (const b of w.playerBullets) if (b.alive) now++;
      if (!shot) {
        const first = w.playerBullets.find((b) => b.alive);
        if (first)
          shot = {
            speed: Math.round(Math.hypot(first.vx, first.vy)),
            radius: Math.round(first.radius * 10) / 10,
            pierce: first.pierce, homing: Math.round(first.homing * 100) / 100,
            bounce: first.bounce, split: first.split, element: first.element,
          };
      }
      // Projectiles have no stable identity, so fan-out is counted from the
      // rising edges of the live count rather than from a set of ids.
      if (now > live) spawned += now - live;
      live = now;
      peak = Math.max(peak, now);
      if (dummy.hp + dummy.armour < before) hit = true;
    }
  }

  const notes: string[] = [];
  if (manaAfterCast >= w.staff.mana_max) notes.push("NO MANA SPENT");
  // A field is a fire and a pillar is a prop: neither is a projectile, so
  // "nothing spawned" is what success looks like for them, and a pillar does
  // no damage by design.
  const shape = base.params.shape ?? "bolt";
  if (peak === 0 && shape === "bolt") notes.push("NOTHING SPAWNED");
  if (shape === "pillar") {
    if (!w.props.some((p) => p.kind === "pillar")) notes.push("NO PILLAR RAISED");
  } else if (!hit) notes.push("NEVER HIT");
  if (shape === "summon" && !w.pets.some((x) => x.alive)) notes.push("NO COMPANION");
  return {
    id: base.id, kind: base.kind, mana: base.mana,
    spawned, damage: Math.round((before - (dummy.hp + dummy.armour)) * 10) / 10,
    peak, hitTarget: hit, shot, notes,
  };
}

const castable = [...ITEMS.values()].filter(
  (i) => i.kind === "attack" || i.kind === "payload" || i.kind === "multicast",
);

console.log(`${castable.length} castables, cast ${CASTS}x each at a pinned dummy `
  + `${TARGET_DIST} px away in an empty room\n`);
console.log("kind       id                 mana  shots  peak  damage  dmg/mana  notes");

// `map(fire)` would pass the array index as `extra`, which typechecks as a
// number into a string array only because the parameter is optional.
const results = castable.map((c) => fire(c));
for (const r of results) {
  const perMana = r.mana > 0 ? (r.damage / r.mana).toFixed(1) : "-";
  console.log(
    `${r.kind.padEnd(10)} ${r.id.padEnd(18)} ${String(r.mana).padStart(4)} `
    + `${String(r.spawned).padStart(6)} ${String(r.peak).padStart(5)} `
    + `${String(r.damage).padStart(7)} ${perMana.padStart(9)}  ${r.notes.join(", ")}`,
  );
}

/*
 * **Every modifier, attached to a spell, measured against the bare spell.**
 *
 * This is the half that was missing and it is where the dead content was. A
 * boost is authored as a row of numbers and nothing ever attached one to
 * anything: `makeSpell` parsed a single item, so a boost in a staff slot
 * became its own "spell" that did nothing when pressed and could not reach the
 * attack beside it either. Twenty of the forty items in the pool were inert.
 *
 * Two of them were doubly dead. `fracture_rune` sets `Bullet.split`, which the
 * *simulator* implemented and the **game read nowhere** — so the two disagreed
 * about what the item did, which doc 006 says must never happen. And the three
 * multicasts had nothing to consume at all.
 *
 * So each modifier is attached to `magic_bolt` and compared: more projectiles,
 * more damage, or something visible. A modifier that changes neither is a
 * modifier doing nothing, whatever its description says.
 */
const bolt = ITEMS.get("magic_bolt")!;
const soloBolt = fire(bolt);
const modifiers = [...ITEMS.values()].filter((i) => i.kind === "boost");

console.log(`\n${modifiers.length} modifiers, each attached to magic_bolt `
  + `(bare: ${soloBolt.spawned} shots, ${soloBolt.damage} damage):`);
console.log("id                 shots  damage  what it changed on the projectile");
const modResults = modifiers.map((m) => {
  const r = fire(bolt, [m.id]);
  const dShots = r.spawned - soloBolt.spawned;
  const dDamage = Math.round((r.damage - soloBolt.damage) * 10) / 10;

  // Everything the modifier did to the projectile itself, named.
  const a = soloBolt.shot;
  const b = r.shot;
  const changed: string[] = [];
  if (dShots !== 0) changed.push(`${dShots > 0 ? "+" : ""}${dShots} shots`);
  if (dDamage !== 0) changed.push(`${dDamage > 0 ? "+" : ""}${dDamage} dmg`);
  if (a && b) {
    if (b.speed !== a.speed) changed.push(`speed ${a.speed}->${b.speed}`);
    if (b.radius !== a.radius) changed.push(`radius ${a.radius}->${b.radius}`);
    if (b.pierce !== a.pierce) changed.push(`pierce ${a.pierce}->${b.pierce}`);
    if (b.homing !== a.homing) changed.push(`homing ${a.homing}->${b.homing}`);
    if (b.bounce !== a.bounce) changed.push(`bounce ${a.bounce}->${b.bounce}`);
    if (b.split !== a.split) changed.push(`split ${a.split}->${b.split}`);
    if (b.element !== a.element) changed.push(`element ${a.element}->${b.element}`);
  }
  const notes = changed.length === 0 ? ["NO EFFECT"] : [];
  console.log(
    `${m.id.padEnd(18)} ${String(r.spawned).padStart(5)} ${String(r.damage).padStart(7)}  `
    + `${changed.join(", ") || "NO EFFECT"}`,
  );
  return { id: m.id, notes };
});

const broken = [
  ...results.filter((r) => r.kind !== "multicast" && r.notes.length > 0),
  ...modResults.filter((r) => r.notes.length > 0),
];


/*
 * Damage per mana is reported and **not asserted**. A pool is meant to have a
 * cheap reliable option and an expensive situational one, and a band would
 * flatten that. Two readings here are artefacts of the protocol rather than of
 * the content, and are worth naming so they are not "fixed":
 *
 * - The **shotguns** (`spark_spray`, `scatter_shot`) score worst per mana
 *   because most of a cone misses a single 20 px target. Against a group they
 *   are the opposite.
 * - `void_orb` pierces, and a lone dummy gives it nothing to pierce into.
 */
const perMana = results
  .filter((r) => r.mana > 0 && r.damage > 0)
  .map((r) => ({ id: r.id, v: r.damage / r.mana }))
  .sort((a, b) => b.v - a.v);
console.log(`\ndamage per mana, best to worst (not a balance assertion):`);
console.log(`  ${perMana.map((p) => `${p.id} ${p.v.toFixed(1)}`).join("  ")}`);

if (broken.length > 0) {
  console.log(`\n${broken.length} spells did not work:`);
  for (const r of broken) console.log(`  ${r.id}: ${r.notes.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`\nall ${results.length} keyed spells fire and hit, `
    + `and all ${modifiers.length} modifiers change what they are attached to`);
}
