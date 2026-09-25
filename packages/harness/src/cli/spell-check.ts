/**
 * Fires every spell in the pool and reports what it actually did.
 *
 * Each spell is authored data — mana, damage, count, spread, lifetime, pierce,
 * element, shape — and authored data that is never executed is authored data
 * that is wrong somewhere. The three questions this answers, per spell:
 *
 * - **Does it fire at all?** A spell whose mana cost exceeds the reference
 *   staff's pool silently does nothing.
 * - **Does it reach and hurt something?** Projectiles that expire before the
 *   target look identical to a working spell from the outside.
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
  createWorld, step, makeEnemy, generateRoom, toRoomPlan,
  plainInstance, RngSource, NO_INPUT, ITEMS, STEP_MS, GRID_W, GRID_H, TILE_PX, Tile,
} from "@jr/core";
import type { BaseItem, World } from "@jr/core";
import { holdsKey } from "../play/hands.ts";

/** Long enough for the slowest spell to land and its lingering effect to resolve. */
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
    // Compact: at the standard size the room's kiting block stood on venom
    // spit's curve from the caster to the dummy, and it reported never hitting.
    size: "compact",
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
  readonly mana: number;
  /** Projectiles that existed at any point, which is the fan-out. */
  readonly spawned: number;
  readonly damage: number;
  /** Peak concurrent projectiles, which separates a volley from a stream. */
  readonly peak: number;
  readonly hitTarget: boolean;
  readonly notes: readonly string[];
}

/**
 * One spell, alone in a staff, fired once at a dummy that cannot die.
 *
 * The dummy is given absurd health rather than being made invulnerable,
 * because a spell that kills it would stop the observation early and the
 * damage figure would then measure the dummy's health rather than the spell.
 */
function fire(base: BaseItem): Result {
  const w: World = createWorld({
    room, encounter: null,
    staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance(base.id), null, null, null, null, null],
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
  // So do rings of ground round the caster.
  if (base.params.pattern === "ring") dummy.x = w.player.x + 60;
  /*
   * Doc 006's newer shapes, each where it reaches: a thrown blade inside its
   * throw, an enchant's wave and a stance's answer beside the caster, and a
   * trail's dummy on the ground the caster walks back and forth over.
   */
  const shape0 = String(base.params.shape ?? "bolt");
  if (shape0 === "boomerang") dummy.x = w.player.x + Math.min(70, Number(base.params.reach ?? 110) * 0.6);
  if (shape0 === "enchant" || shape0 === "stance" || shape0 === "trail") dummy.x = w.player.x + 36;
  w.enemies.push(dummy);
  const dx0 = dummy.x, dy0 = dummy.y;

  const before = dummy.hp + dummy.armour;
  let peak = 0;
  let spawned = 0;
  let live = 0;
  let hit = false;

  /*
   * Mana is read **immediately** after the first cast.
   *
   * Reading it at the end of the observation window said "no mana spent" for
   * six spells, because the staff regenerates and 2.6 seconds is long enough
   * to refill the pool. The question is whether the cast charged for itself,
   * and that is only answerable on the frame it happened.
   */
  let manaAfterCast = Infinity;
  /*
   * What doc 006's options leave in the world, by the events they report:
   * the doom mark bursting, the orb's ring of shards, the leap landing, the
   * pull imploding. A spell with the option that never reports its event
   * has the option in its params and not in its behaviour.
   */
  const whats = new Set<string>();
  let marked = false;
  let volley = 0;
  const charge = Number(base.params.charge ?? 0);
  /*
   * What the newer shapes need of the hands: an enchant's caster swings (the
   * waves leave only from swings), a trail's walks (the ground is laid only
   * by travel), and a stance's is struck — a shot lands on the caster a few
   * frames into each guard. What the sword's own blows did is kept apart, so
   * an enchant is judged on its waves.
   */
  const hands = (ms: number) => ({
    ...(shape0 === "enchant" ? { swing: true } : {}),
    ...(shape0 === "trail" ? { moveX: Math.floor(ms / 500) % 2 === 0 ? 1 : -1 } : {}),
  });
  let struck = 0;
  let throughGuard = 0;
  let patchesLaid = 0;
  let casterBurned = false;
  let poisoned = false;
  let burnedByCloud = false;

  for (let c = 0; c < CASTS; c++) {
    // The press is an edge, which is what the scene sends: holding a key must
    // not buy a cast per frame.
    w.player.mana = w.staff.mana_max;
    /*
     * A `charge` spell is held to a full charge and then let go, which is
     * the cast; the mana is read after the release, which is when it is
     * paid (`holdsKey`). Everything else is the one press.
     */
    if (charge > 0) {
      for (let ms = 0; ms < charge + 500 && holdsKey(w, 0); ms += STEP_MS)
        step(w, { ...NO_INPUT, aimX: dummy.x, aimY: dummy.y, spell: 0 }, STEP_MS, ITEMS);
      step(w, { ...NO_INPUT, aimX: dummy.x, aimY: dummy.y }, STEP_MS, ITEMS);
    } else step(w, { ...NO_INPUT, aimX: dummy.x, aimY: dummy.y, spell: 0 }, STEP_MS, ITEMS);
    manaAfterCast = Math.min(manaAfterCast, w.player.mana);
    if (c === 0) volley = w.playerBullets.filter((b) => b.alive).length;

    const window = c === CASTS - 1 ? OBSERVE_MS : CAST_GAP_MS;
    const wasPatches = w.fires.map((f) => f.alive);
    let shot = false;
    for (let ms = 0; ms < window; ms += STEP_MS) {
      // Struck once a guard, while it is up: the check is the guard's, not the cooldown's.
      if (shape0 === "stance" && !shot && ms >= 150 && w.player.stance) {
        shot = true;
        const b = w.enemyBullets.find((x) => !x.alive);
        if (b) {
          b.alive = true; b.x = w.player.x; b.y = w.player.y; b.vx = 0; b.vy = 0;
          b.radius = 3; b.lifeMs = 200; b.damage = 1; b.from = "shooter";
          struck++;
        }
      }
      step(w, { ...NO_INPUT, aimX: dummy.x, aimY: dummy.y, ...hands(ms) }, STEP_MS, ITEMS);
      w.fires.forEach((f, k) => { if (f.alive && !wasPatches[k] && f.owner === "player") patchesLaid++; wasPatches[k] = f.alive; });
      if (w.player.burnBuild > 0 || w.player.burnMs > 0 || w.player.poisonBuild > 0) casterBurned = true;
      if (dummy.poisonMs > 0) poisoned = true;
      if (base.params.element === "poison" && (dummy.burnBuild > 0 || dummy.burnMs > 0)) burnedByCloud = true;
      // The trail's dummy and the stance's stay where they were put.
      dummy.x = dx0; dummy.y = dy0;
      let now = 0;
      for (const b of w.playerBullets) if (b.alive) now++;
      // Projectiles have no stable identity, so fan-out is counted from the
      // rising edges of the live count rather than from a set of ids.
      if (now > live) spawned += now - live;
      live = now;
      peak = Math.max(peak, now);
      // An enchant's own evidence is what its waves did, not the sword's blows.
      if (shape0 === "enchant" ? w.stats.damageDealt - w.stats.swordDamage > 0 : dummy.hp + dummy.armour < before) hit = true;
      for (const ev of w.events) if (ev.what) whats.add(`${ev.kind}:${ev.what}`);
      // The shot the stance was struck with, landing anyway.
      if (shape0 === "stance") throughGuard += w.events.filter((ev) => ev.kind === "player_hit" && ev.what === "bullet:shooter").length;
      if (w.eruptions.some((x) => x.alive && !x.fired && x.telegraphMs > 0)) marked = true;
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
  // Doc 006's options, each by what it leaves behind.
  const p = base.params;
  if (Number(p.charges ?? 0) > 1 && volley < Number(p.charges)) notes.push(`BANK LOOSED ${volley} OF ${p.charges}`);
  if (Number(p.doom ?? 0) > 0 && !whats.has("eruption:doom")) notes.push("DOOM NEVER BURST");
  if (Number(p.emit ?? 0) > 0 && !whats.has("shot:emit_burst")) notes.push("NO SHARD RING");
  if (Number(p.contagion ?? 0) > 0 && dummy.contagion <= 0 && !whats.has("shot:contagion")) notes.push("NO CONTAGION CARRIED");
  if (Number(p.telegraph_ms ?? 0) > 0 && !marked) notes.push("GROUND NEVER MARKED");
  if (Number(p.land ?? 0) > 0 && !whats.has("shot:land")) notes.push("NEVER LANDED");
  if (Number(p.collapse_damage ?? 0) > 0 && !whats.has("eruption:collapse")) notes.push("NEVER COLLAPSED");
  // Doc 006's newer shapes, each by the rule it is said with.
  if (shape === "orb" && !whats.has("spell:orb_strike")) notes.push("ORB NEVER STRUCK");
  if (shape === "boomerang" && (!whats.has("spell:boomerang_turn") || !whats.has("spell:boomerang_caught"))) notes.push("BLADE NEVER CAME BACK");
  if (shape === "enchant" && !whats.has("spell:wave")) notes.push("NO WAVE THROWN");
  if (shape === "trail") {
    if (patchesLaid === 0) notes.push("NO GROUND LAID");
    if (casterBurned) notes.push("CASTER HARMED BY OWN GROUND");
  }
  if (shape === "stance") {
    if (struck === 0 || !whats.has("spell:stance_guard")) notes.push("NO HIT CANCELLED");
    if (throughGuard > 0) notes.push("A HIT LANDED THROUGH THE GUARD");
    if (!whats.has("spell:stance_answer")) notes.push("NEVER ANSWERED");
  }
  if (shape === "field" && p.element === "poison") {
    if (!poisoned) notes.push("CLOUD NEVER POISONED");
    if (burnedByCloud) notes.push("CLOUD BURNED");
    if (casterBurned) notes.push("CASTER HARMED BY OWN GROUND");
  }
  return {
    id: base.id, mana: base.mana,
    spawned, damage: Math.round((before - (dummy.hp + dummy.armour)) * 10) / 10,
    peak, hitTarget: hit, notes,
  };
}

const spells = [...ITEMS.values()];

console.log(`${spells.length} spells, cast ${CASTS}x each at a pinned dummy `
  + `${TARGET_DIST} px away in an empty room\n`);
console.log("id                 mana  shots  peak  damage  dmg/mana  notes");

const results = spells.map((c) => fire(c));
for (const r of results) {
  const perMana = r.mana > 0 ? (r.damage / r.mana).toFixed(1) : "-";
  console.log(
    `${r.id.padEnd(18)} ${String(r.mana).padStart(4)} `
    + `${String(r.spawned).padStart(6)} ${String(r.peak).padStart(5)} `
    + `${String(r.damage).padStart(7)} ${perMana.padStart(9)}  ${r.notes.join(", ")}`,
  );
}

const broken = results.filter((r) => r.notes.length > 0);

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
  console.log(`\nall ${results.length} keyed spells fire and hit`);
}
