/**
 * The live cast loop (design doc 006). The DPS simulator in `spells/` runs a
 * closed version of the same rules for 30 seconds against a dummy; this one
 * advances a cursor a step at a time against the real world.
 *
 * The rules are not restated here: cost, scope and parse all come from
 * `spells/`, so a change to the rules moves both at once and the simulator's
 * numbers stay the numbers the player experiences.
 */
import {
  cycleCost, instanceMana, multicastCost, passiveMods, scopeMods, subtreeCost, emptyScope,
} from "../spells/execute.ts";
import type { CostContext, ScopeMods } from "../spells/execute.ts";
import type { ItemRegistry } from "../spells/items.ts";
import { num, str } from "../spells/items.ts";
import type { CastTree, CastUnit, Element, ItemInstance, Staff } from "../types.ts";
import type { Bullet, Player, World } from "./types.ts";
import { acquire } from "./bullets.ts";
import { normalise } from "./collide.ts";
import { assistAim, seekTargets } from "./aim.ts";
import { arcJumps } from "./affix-hooks.ts";
import { lightFire } from "./fire.ts";
import { raisePillar } from "./props.ts";

/** What the `elemental` affix resolves to at fire time until builds carry one. */
const DOMINANT_ELEMENT: Element = "fire";

export interface FiredShot {
  readonly x: number;
  readonly y: number;
  readonly family: string;
}

/** One unit's worth of projectiles, from an origin toward a target. */
export function fireUnit(
  world: World,
  unit: CastUnit,
  scope: ScopeMods,
  items: ItemRegistry,
  shots: FiredShot[],
  origin?: { x: number; y: number },
  target?: { x: number; y: number },
): void {
  if (unit.kind === "multicast") {
    for (const child of unit.units)
      fireUnit(world, child, mergeInto(scope, unit.boosts, items), items, shots, origin, target);
    return;
  }

  const base = items.get(unit.item.base);
  if (!base) return;
  const mods = mergeInto(scope, unit.boosts, items);

  /*
   * `repeat` fires the whole unit again.
   *
   * It is applied here rather than by the caller because a repeat has to
   * duplicate everything the unit does — its projectile count, its spread, its
   * payload — and the only place that knows all of it is the fire itself.
   *
   * Recursion with the repeat stripped, rather than a loop, so a repeat inside
   * a payload's child scope cannot multiply with the parent's and produce a
   * geometric number of projectiles. One repeat is one extra cast.
   */
  if (mods.repeat >= 1) {
    const once = { ...mods, repeat: 0 };
    const extra = Math.min(MAX_REPEAT, Math.round(mods.repeat));
    for (let i = 0; i <= extra; i++)
      fireOnce(world, unit, once, items, shots, origin, target);
    return;
  }
  fireOnce(world, unit, mods, items, shots, origin, target);
}

/**
 * How many extra casts one spell may stack.
 *
 * The bullet pool is shared with everything else in the air, so an unbounded
 * repeat is a build that silently starves its own other spells — and the cap
 * is the honest place to say so rather than letting the pool decide.
 */
const MAX_REPEAT = 3;

function fireOnce(
  world: World,
  unit: CastUnit,
  mods: ScopeMods,
  items: ItemRegistry,
  shots: FiredShot[],
  origin?: { x: number; y: number },
  target?: { x: number; y: number },
): void {
  const base = items.get(unit.item.base);
  if (!base) return;
  const mod = unit.item.modifier ?? {};

  const damage =
    (num(base.params, "damage") + mods.damageAdd + (mod.damage_add ?? 0)) *
    mods.damageMult * (mod.damage_mult ?? 1);
  const speed = num(base.params, "speed") * mods.speedMult * (mod.speed_mult ?? 1);
  const radius = num(base.params, "radius") * mods.radiusMult * (mod.radius_mult ?? 1);
  const count = Math.max(1, Math.round(num(base.params, "count", 1) + mods.countAdd + (mod.count_add ?? 0)));
  const spread = num(base.params, "spread", 0) + mods.spreadAdd;
  const lifetime = num(base.params, "lifetime", 1.2);
  const element = (mods.element !== "none" ? mods.element : str(base.params, "element", "none")) as Element;

  const from = origin ?? world.player;
  const at = target ?? world.player.aim;
  const raw = normalise(at.x - from.x, at.y - from.y);
  // Player shots get the assist; a payload's child already fires at a
  // specific enemy, so bending it again would be aiming twice.
  const aim = origin ? raw : assistAim(world, from.x, from.y, raw.x, raw.y);
  const baseAngle = Math.atan2(aim.y, aim.x) || 0;
  const isCarrier = unit.kind === "payload";

  /*
   * What this shot curves toward, and how hard.
   *
   * `seek` is the spell's own turn rate in degrees a second and `curve` is how
   * far off the aim it is launched — together they are the quadratic the
   * design asked for: out through a control point to one side, then in to the
   * body. Both are the item's, so the path is part of a spell's identity
   * rather than a global flavour: a needle has neither and flies straight, a
   * bolt has a little of both, a bloom is thrown wide and hauled round.
   *
   * A payload's child is exempt for the same reason it is exempt from the
   * assist: it was already cast at a specific place, and steering it again is
   * aiming twice.
   */
  /*
   * The spell's **shape**. Until this existed every attack was a projectile
   * and the pool differed in speed, count and colour; the shapes below are the
   * ones a projectile cannot be — see doc 013, "Spell shapes".
   *
   * - `orbit`: bodies that circle the player for the lifetime, hitting what
   *   they touch; damage that follows the body, not a target.
   * - `field`: a patch of burning ground at the seek target or ahead of the
   *   hand; ground denied for a while, which a shot cannot do.
   * - `pillar`: a solid raised between the player and what they face; cover
   *   the player can put where they want it.
   *
   * A payload's child is never a shape: a carrier casts a shot where it stops.
   */
  const shape = origin ? "bolt" : str(base.params, "shape", "bolt");
  const seek = origin ? 0 : num(base.params, "seek", 0);
  const curveDeg = origin ? 0 : num(base.params, "curve", 0);
  /*
   * **One target each**, where there are several.
   *
   * With a single target for the whole cast, a five-pellet scatter shot put
   * all five into one body: measured, its damage per mana went from 3 to 15
   * and it became the best single-target spell in the pool, which is the exact
   * opposite of what a spread is for. Ranked by how well each body matches the
   * aim, and handed out one per projectile, a spray covers bodies and a single
   * shot still goes to the one the player meant.
   */
  const marks = seek > 0 || shape !== "bolt" ? seekTargets(world, from.x, from.y, aim.x, aim.y) : [];

  if (shape === "orbit") {
    /*
     * One ring per key. A recast **renews** the blades rather than adding to
     * them: without this, every cast stacked three more and a held key built
     * a wall of steel round the body for as long as the mana lasted — which
     * is a build with no decision in it. The renewal is still worth casting
     * for: it resets the clock and puts the blades back where the body is.
     */
    for (const b of world.playerBullets)
      if (b.alive && b.orbitMs > 0 && b.spellIndex === mods.spellIndex) b.alive = false;
    const orbitRadius = num(base.params, "orbit_radius", 40) * mods.radiusMult;
    const spin = num(base.params, "spin", 300);
    for (let i = 0; i < count; i++) {
      const b = acquire(world.playerBullets, true);
      if (!b) return;
      const angle = (i / count) * Math.PI * 2 + world.player.facing;
      b.orbitMs = lifetime * 1000;
      b.orbitAngle = angle;
      b.orbitRadius = orbitRadius;
      b.orbitDegPerS = spin;
      b.rehitMs = 0;
      b.x = from.x + Math.cos(angle) * orbitRadius;
      b.y = from.y + Math.sin(angle) * orbitRadius;
      b.originX = b.x;
      b.originY = b.y;
      b.vx = 0;
      b.vy = 0;
      b.radius = radius;
      b.damage = damage;
      b.lifeMs = lifetime * 1000;
      // Never spent on a hit: the ring hits what walks into it for as long
      // as it turns, and the rehit clock is what keeps that a rate.
      b.pierce = 1e9;
      b.bounce = 0;
      b.homing = 0;
      b.split = 0;
      b.affixes = mods.affixes;
      b.spellIndex = mods.spellIndex;
      b.manaSpent = mods.manaSpent;
      b.arcLeft = 0;
      b.element = element;
      // A rune's element brings its own power; a spell's own element, the spell's.
      b.elementPower = mods.element !== "none" ? mods.elementPower || 1 : num(base.params, "element_power", 1);
      shots.push({ x: b.x, y: b.y, family: base.id });
    }
    return;
  }

  if (shape === "field") {
    const mark = marks[0] ?? null;
    const reach = num(base.params, "reach", 120);
    const at = mark
      ? { x: mark.x, y: mark.y }
      : { x: from.x + aim.x * reach, y: from.y + aim.y * reach };
    lightFire(world, at.x, at.y, "player", {
      radius: radius * mods.radiusMult, lifeMs: lifetime * 1000, damage,
    });
    shots.push({ x: at.x, y: at.y, family: base.id });
    return;
  }

  if (shape === "dash") {
    const p = world.player;
    if (p.dashMs > 0 || p.strikeMs > 0) return;
    const mark = marks[0] ?? null;
    const dir = mark ? normalise(mark.x - from.x, mark.y - from.y) : aim;
    const ms = lifetime * 1000;
    p.dashMs = ms;
    p.dashX = dir.x;
    p.dashY = dir.y;
    // Mercy frames outlast the travel, as the dash's do: arriving is the
    // moment the body is most exposed.
    p.dashIframeMs = ms + 120;
    p.strikeMs = ms;
    p.strikeDamage = damage;
    p.strikeRadius = radius;
    p.strikeHits.length = 0;
    p.facing = Math.atan2(dir.y, dir.x);
    shots.push({ x: from.x, y: from.y, family: base.id });
    return;
  }

  if (shape === "vortex") {
    const mark = marks[0] ?? null;
    const reach = num(base.params, "reach", 110);
    const at = mark ? { x: mark.x, y: mark.y } : { x: from.x + aim.x * reach, y: from.y + aim.y * reach };
    let slot = world.vortices.find((v) => !v.alive);
    if (!slot) slot = world.vortices.reduce((a, b) => (a.lifeMs <= b.lifeMs ? a : b));
    slot.alive = true;
    slot.x = at.x;
    slot.y = at.y;
    slot.radius = radius * mods.radiusMult;
    slot.lifeMs = lifetime * 1000;
    slot.maxLifeMs = slot.lifeMs;
    slot.pull = num(base.params, "pull", 140);
    slot.tickMs = 0;
    slot.damage = damage;
    slot.spellIndex = mods.spellIndex;
    shots.push({ x: at.x, y: at.y, family: base.id });
    return;
  }

  if (shape === "summon") {
    // One companion at a time: a recast renews it rather than adding another,
    // so the spell is a presence to keep up, not a swarm to stack.
    let pet = world.pets.find((x) => x.alive) ?? world.pets.find((x) => !x.alive);
    if (!pet) pet = world.pets[0]!;
    const fresh = !pet.alive;
    pet.alive = true;
    if (fresh) {
      pet.x = from.x - aim.x * 18;
      pet.y = from.y - aim.y * 18;
      pet.vx = 0;
      pet.vy = 0;
      pet.facing = world.player.facing;
    }
    pet.lifeMs = lifetime * 1000;
    pet.maxLifeMs = pet.lifeMs;
    pet.fireMs = 300;
    pet.intervalMs = num(base.params, "interval", 0.7) * 1000;
    pet.damage = damage;
    pet.range = num(base.params, "reach", 260);
    pet.speed = speed;
    pet.spellIndex = mods.spellIndex;
    pet.attackMs = 0;
    shots.push({ x: pet.x, y: pet.y, family: base.id });
    return;
  }

  if (shape === "pillar") {
    // Reach of the shove a raised ward throws; see below.
    const PILLAR_SHOCK_RADIUS = 58;
    const mark = marks[0] ?? null;
    const reach = num(base.params, "reach", 64);
    // Between the player and what they face, a couple of tiles out: where a
    // shield goes, not where a shot goes.
    const at = mark
      ? { x: from.x + (mark.x - from.x) * 0.45, y: from.y + (mark.y - from.y) * 0.45 }
      : { x: from.x + aim.x * reach, y: from.y + aim.y * reach };
    const bodies = [
      { x: world.player.x, y: world.player.y, radius: 8 },
      ...world.enemies.filter((e) => e.hp > 0).map((e) => ({ x: e.x, y: e.y, radius: e.radius })),
    ];
    const pillar = raisePillar(world.room.grid, at.x, at.y, bodies, lifetime * 1000);
    if (pillar) {
      world.props.push(pillar);
      // A new solid: the flow field is stale, exactly as when one breaks.
      world.flow = null;
      world.flowTile = null;
      shots.push({ x: pillar.x, y: pillar.y, family: base.id });
      /*
       * **It rises hard.** The stone comes up through whatever is next to it:
       * a quarter-second shove outward and one hit, as a pushing vortex. As a
       * wall and nothing else it measured as a dead key — a defence the player
       * could not feel paying off — and a ward that throws back what was
       * about to reach you is a defence that answers.
       */
      let slot = world.vortices.find((v) => !v.alive);
      if (!slot) slot = world.vortices.reduce((a, b) => (a.lifeMs <= b.lifeMs ? a : b));
      slot.alive = true;
      slot.x = pillar.x;
      slot.y = pillar.y;
      slot.radius = PILLAR_SHOCK_RADIUS;
      slot.lifeMs = 250;
      slot.maxLifeMs = 250;
      slot.pull = -420;
      slot.tickMs = 0;
      slot.damage = num(base.params, "damage", 0) * mods.damageMult;
      slot.spellIndex = mods.spellIndex;
    }
    return;
  }

  for (let i = 0; i < count; i++) {
    const offset = count === 1 ? 0 : ((i / (count - 1)) - 0.5) * (spread * Math.PI) / 180;
    const b = acquire(world.playerBullets, true);
    if (!b) return;
    /*
     * The launch offset alternates side per projectile, so a spell that fires
     * several curves them out in both directions and closes like a net rather
     * than like a queue. With no target there is nothing to curve back to, so
     * the offset is not applied — an unaimed cast flies where it was pointed.
     */
    const mark = marks.length > 0 ? marks[i % marks.length]! : null;
    const swing = mark ? (i % 2 === 0 ? 1 : -1) * (curveDeg * Math.PI) / 180 : 0;
    const angle = baseAngle + offset + swing;
    b.x = from.x;
    b.y = from.y;
    b.originX = from.x;
    b.originY = from.y;
    b.targetId = mark ? mark.id : -1;
    b.seekDegPerS = mark ? seek : 0;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.radius = radius;
    b.damage = damage;
    b.lifeMs = lifetime * 1000;
    b.pierce = Math.round(num(base.params, "pierce", 0) + mods.pierceAdd);
    b.bounce = Math.round(mods.bounce);
    b.homing = mods.homing + (mod.homing_add ?? 0);
    b.split = Math.round(mods.split);
    // What the casting spell had attached, so the hit, kill and death hooks
    // can find it on the projectile itself. See `affix-hooks.ts`.
    b.affixes = mods.affixes;
    b.spellIndex = mods.spellIndex;
    b.weight = num(base.params, "weight", 1);
    b.manaSpent = mods.manaSpent;
    // A spell may chain on its own account as well as by affix; see the
    // `chain` param on the attack items and `onHit` in `affix-hooks.ts`.
    b.arcLeft = arcJumps(mods.affixes) + Math.round(num(base.params, "chain", 0));
    b.element = element;
    // A rune's element brings its own power; a spell's own element, the spell's.
      b.elementPower = mods.element !== "none" ? mods.elementPower || 1 : num(base.params, "element_power", 1);
    if (isCarrier) {
      // The carrier keeps flying to its own trigger; the child fires once.
      b.passthrough = num(base.params, "passthrough", 0) > 0;
      b.payloadUnit = unit.child;
    }
    shots.push({ x: b.x, y: b.y, family: base.id });
  }
}

function mergeInto(scope: ScopeMods, boosts: readonly ItemInstance[], items: ItemRegistry): ScopeMods {
  if (boosts.length === 0) return scope;
  const extra = scopeMods(boosts, items, "fire");
  return {
    damageMult: scope.damageMult * extra.damageMult,
    damageAdd: scope.damageAdd + extra.damageAdd,
    speedMult: scope.speedMult * extra.speedMult,
    radiusMult: scope.radiusMult * extra.radiusMult,
    countAdd: scope.countAdd + extra.countAdd,
    spreadAdd: scope.spreadAdd + extra.spreadAdd,
    pierceAdd: scope.pierceAdd + extra.pierceAdd,
    homing: scope.homing + extra.homing,
    bounce: scope.bounce + extra.bounce,
    split: scope.split + extra.split,
    repeat: scope.repeat + extra.repeat,
    // Spell context is inherited, never contributed by a boost.
    affixes: scope.affixes,
    spellIndex: scope.spellIndex,
    manaSpent: scope.manaSpent,
    element: extra.element !== "none" ? extra.element : scope.element,
    elementPower: Math.max(scope.elementPower, extra.elementPower),
    manaMult: scope.manaMult * extra.manaMult,
    manaAdd: scope.manaAdd + extra.manaAdd,
  };
}

/** Every kind goes through the same helpers the DPS simulator uses. */
function unitCost(unit: CastUnit, ctx: CostContext): number {
  if (unit.kind === "multicast") return multicastCost(unit, emptyScope(), ctx);
  return subtreeCost(unit, emptyScope(), ctx);
}

export interface CastStep {
  readonly shots: readonly FiredShot[];
  readonly skipped: boolean;
}

/**
 * Advances the cast cursor by one step. Returns what was fired so the caller
 * can emit events; mutates the player's mana, cursor and timers.
 */
export function stepCast(
  world: World,
  items: ItemRegistry,
  dtMs: number,
): CastStep {
  const p: Player = world.player;
  const staff: Staff = world.staff;
  const tree = world.tree;
  const passives = passiveMods(tree.passives, items);

  p.mana = Math.min(staff.mana_max, p.mana + (staff.mana_regen + passives.regenAdd) * (dtMs / 1000));

  if (p.cooldownMs > 0) {
    p.cooldownMs -= dtMs;
    return { shots: [], skipped: false };
  }
  if (!p.firing || tree.units.length === 0) return { shots: [], skipped: false };

  p.castTimerMs -= dtMs;
  if (p.castTimerMs > 0) return { shots: [], skipped: false };

  const unit = tree.units[p.castIndex];
  if (!unit) {
    p.castIndex = 0;
    p.cooldownMs = staff.cooldown * 1000 * passives.cooldownMult;
    return { shots: [], skipped: false };
  }

  const ctx: CostContext = { items, dominant: DOMINANT_ELEMENT };
  const cost = unitCost(unit, ctx);
  const shots: FiredShot[] = [];
  let skipped = false;

  if (p.mana >= cost) {
    p.mana -= cost;
    fireUnit(world, unit, emptyScope(), items, shots);
  } else {
    // Doc 006: an unaffordable unit is skipped whole, subtree included, and
    // the cursor moves on rather than stalling the staff.
    skipped = true;
  }

  p.castIndex++;
  p.castTimerMs = staff.cast_interval * 1000 * passives.castIntervalMult;
  if (p.castIndex >= tree.units.length) {
    p.castIndex = 0;
    p.cooldownMs = staff.cooldown * 1000 * passives.cooldownMult;
  }

  return { shots, skipped };
}

/**
 * Fires a payload's captured child where the carrier stopped. The child's
 * mana was already reserved when the carrier fired (doc 006), so this never
 * touches the mana pool.
 */
export function firePayloadChild(
  world: World,
  unit: CastUnit,
  x: number,
  y: number,
  items: ItemRegistry,
): FiredShot[] {
  const shots: FiredShot[] = [];
  let target = { x: x + 1, y };
  let best = Infinity;
  for (const e of world.enemies) {
    if (e.hp <= 0) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < best) { best = d; target = { x: e.x, y: e.y }; }
  }
  fireUnit(world, unit, emptyScope(), items, shots, { x, y }, target);
  return shots;
}

/** Mana a full cycle costs, for the HUD and for the sustain label. */
export function cycleManaCost(tree: CastTree, items: ItemRegistry): number {
  return cycleCost(tree, { items, dominant: DOMINANT_ELEMENT });
}

export type { Bullet };
