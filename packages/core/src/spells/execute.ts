/**
 * The cast loop and the deterministic projectile model (design doc 006,
 * "Mana", "Timing and triggers", "Damage", "Simulator").
 *
 * Pure and self-contained: no DOM, no Phaser, no randomness. The game renders
 * what this produces; the simulator reads the totals. Everything that is a
 * *model* of something the real game would resolve against many enemies is
 * called out in a comment, because those are the places where the simulator's
 * number is a proxy rather than a measurement.
 */

import { GRID_H, GRID_W, TILE_PX } from "../types.ts";
import type { CastTree, CastUnit, ItemInstance, PayloadTrigger, Staff } from "../types.ts";
import type { Element } from "../content/tags.ts";
import { baseOf, num, str, type ItemRegistry } from "./items.ts";

/* ------------------------------ arena and dummy ---------------------------- */

export const ARENA_HALF_W = (GRID_W * TILE_PX) / 2;
export const ARENA_HALF_H = (GRID_H * TILE_PX) / 2;
/** The dummy orbits the caster at this radius; the caster stands at the origin. */
export const TARGET_DISTANCE = 160;
export const TARGET_RADIUS = 16;
/** Doc 006: "a dummy moving at 120 px/s in a circle". */
export const TARGET_SPEED = 120;
/**
 * How much of the perfect intercept lead the caster applies, as a deterministic
 * wobble rather than a constant.
 *
 * A constant would make accuracy binary: the dummy orbits at a fixed radius and
 * speed, so for any given projectile speed the residual error is the same on
 * every shot and the attack either always hits or always misses. The wobble
 * models a caster whose tracking drifts, which is what makes hit rate a
 * gradient that projectile speed, size and homing can each move. Its period is
 * chosen not to divide any cast interval, so no build syncs to it.
 */
export const LEAD_BASE = 0.6;
export const LEAD_SWING = 0.4;
export const LEAD_PERIOD = 1.7;

export function leadFactor(t: number): number {
  return LEAD_BASE + LEAD_SWING * Math.sin((2 * Math.PI * t) / LEAD_PERIOD);
}
/**
 * A piercing projectile can only strike the single dummy once, so pierce is
 * credited as expected extra targets instead. This is the one damage term that
 * is a proxy for enemy count rather than a simulated hit.
 */
export const PIERCE_TARGET_VALUE = 0.35;
/** Fire stacking is multiplicative; without a cap a long dot build diverges. */
export const MAX_FIRE_SOURCES = 4;
const SPLIT_DAMAGE = 0.5;
const SPLIT_SPEED = 0.8;
const SPLIT_RADIUS = 0.7;
const SPLIT_LIFETIME = 0.5;
/** Radians per second of turn available at homing strength 1. */
const HOMING_TURN_RATE = 6;

export type TargetKind = "stationary" | "moving";

export interface CastLoopConfig {
  readonly target: TargetKind;
  /** Simulated seconds. Doc 006 uses 30 for confirmation, 10 for screening. */
  readonly duration: number;
  readonly dt?: number;
  /** Element the `elemental` affix infuses when it says "the build's dominant". */
  readonly dominantElement?: Element;
}

export interface CastLoopResult {
  readonly damage: number;
  readonly directDamage: number;
  readonly dotDamage: number;
  readonly projectilesFired: number;
  readonly projectileHits: number;
  readonly castsAttempted: number;
  readonly castsSkipped: number;
  readonly payloadsArmed: number;
  readonly payloadsTriggered: number;
  readonly manaSpent: number;
  readonly manaRegenerated: number;
  readonly idleTime: number;
  readonly cycles: number;
  readonly cycleTime: number;
  readonly units: number;
  readonly meanSpread: number;
  readonly duration: number;
}

/* ------------------------------ derived modifiers -------------------------- */

/** Whole-staff modifiers contributed by passives (doc 006, "Parse"). */
export interface PassiveMods {
  readonly damageMult: number;
  readonly damageAdd: number;
  readonly critAdd: number;
  readonly regenAdd: number;
  readonly castIntervalMult: number;
  readonly cooldownMult: number;
  readonly trackingAdd: number;
  readonly elementTickMult: number;
  readonly thorns: number;
  readonly lifesteal: number;
}

const NO_PASSIVES: PassiveMods = {
  damageMult: 1, damageAdd: 0, critAdd: 0, regenAdd: 0, castIntervalMult: 1,
  cooldownMult: 1, trackingAdd: 0, elementTickMult: 1, thorns: 0, lifesteal: 0,
};

export function passiveMods(passives: readonly ItemInstance[], items: ItemRegistry): PassiveMods {
  const m = { ...NO_PASSIVES };
  for (const inst of passives) {
    const p = baseOf(inst, items).params;
    const mod = inst.modifier ?? {};
    m.damageMult *= num(p, "damage_mult", 1);
    m.damageAdd += num(p, "damage_add", 0);
    m.critAdd += num(p, "crit_add", 0) + (mod["crit_add"] ?? 0);
    m.regenAdd += num(p, "regen_add", 0) + (mod["regen_add"] ?? 0);
    m.castIntervalMult *= num(p, "cast_interval_mult", 1);
    m.cooldownMult *= num(p, "cooldown_mult", 1);
    m.trackingAdd += num(p, "tracking_add", 0) + (mod["tracking_add"] ?? 0);
    m.elementTickMult *= mod["element_tick_mult"] ?? 1;
    m.thorns += num(p, "thorns", 0);
    m.lifesteal += num(p, "lifesteal", 0);
  }
  return m;
}

/** Everything a scope contributes to the projectiles fired inside it. */
export interface ScopeMods {
  damageMult: number;
  damageAdd: number;
  speedMult: number;
  radiusMult: number;
  countAdd: number;
  spreadAdd: number;
  pierceAdd: number;
  homing: number;
  bounce: number;
  split: number;
  /**
   * Extra casts of the whole unit, from a `repeat` modifier.
   *
   * Doc 006's `multicast N` fires the next N units *simultaneously*, which
   * needs N different items and is meaningless for a single keyed spell — doc
   * 013 replaced the staff sequence with three keys, so the three multicast
   * items had nothing to consume and did nothing at all. `repeat` is the
   * concept that survives the change: the same spell, cast again.
   */
  repeat: number;
  element: Element;
  elementPower: number;
  /** Multiplier on the mana of every projectile-firing unit in the scope. */
  manaMult: number;
  /** Mana the scope's boosts add to each projectile-firing unit in it. */
  manaAdd: number;
  /**
   * The casting spell's context, inherited unchanged into every nested scope.
   *
   * Not modifiers at all — these identify *which spell is casting* so the
   * projectiles it produces can carry that back to the world's hooks. They
   * ride the scope because it is the one thing that already flows from the
   * keypress down through every payload child, and threading three more
   * parameters through the recursive `fireUnit` would say the same thing worse.
   */
  affixes: readonly { readonly id: string; readonly tier: 1 | 2 | 3 }[];
  spellIndex: number;
  manaSpent: number;
}

export function emptyScope(): ScopeMods {
  return {
    damageMult: 1, damageAdd: 0, speedMult: 1, radiusMult: 1, countAdd: 0, spreadAdd: 0,
    pierceAdd: 0, homing: 0, bounce: 0, split: 0, repeat: 0,
    element: "none", elementPower: 0,
    manaMult: 1, manaAdd: 0,
    affixes: [], spellIndex: -1, manaSpent: 0,
  };
}

export function mergeScope(a: ScopeMods, b: ScopeMods): ScopeMods {
  return {
    damageMult: a.damageMult * b.damageMult,
    damageAdd: a.damageAdd + b.damageAdd,
    speedMult: a.speedMult * b.speedMult,
    radiusMult: a.radiusMult * b.radiusMult,
    countAdd: a.countAdd + b.countAdd,
    spreadAdd: a.spreadAdd + b.spreadAdd,
    pierceAdd: a.pierceAdd + b.pierceAdd,
    homing: a.homing + b.homing,
    bounce: a.bounce + b.bounce,
    split: a.split + b.split,
    repeat: a.repeat + b.repeat,
    element: b.element !== "none" ? b.element : a.element,
    elementPower: b.element !== "none" ? b.elementPower : a.elementPower,
    manaMult: a.manaMult * b.manaMult,
    manaAdd: a.manaAdd + b.manaAdd,
    // Spell context is the outer scope's, always: a payload child belongs to
    // the spell that fired the carrier.
    affixes: a.affixes,
    spellIndex: a.spellIndex,
    manaSpent: a.manaSpent,
  };
}

const ELEMENTS_BY_CODE: readonly Element[] = ["none", "fire", "poison", "ice"];
/** `modifier` is `Record<string, number>`, so the `elemental` affix's "the
 *  build's dominant element" travels as a code resolved at fire time. */
export const DOMINANT_ELEMENT_CODE = 4;

export function elementOfCode(code: number, dominant: Element): Element {
  const i = Math.round(code);
  if (i === DOMINANT_ELEMENT_CODE) return dominant;
  return ELEMENTS_BY_CODE[i] ?? "none";
}

/** The `scope_*` half of an affix: what a boost, payload or multicast item
 *  grants to everything fired inside its scope (doc 006, affix table). */
export function affixScope(inst: ItemInstance, dominant: Element): ScopeMods {
  const s = emptyScope();
  const mod = inst.modifier;
  if (!mod) return s;
  s.homing += mod["scope_homing"] ?? 0;
  s.manaMult *= mod["scope_mana_mult"] ?? 1;
  s.countAdd += mod["scope_count_add"] ?? 0;
  s.damageMult *= mod["scope_damage_mult"] ?? 1;
  const code = mod["scope_element_code"];
  if (code !== undefined) {
    s.element = elementOfCode(code, dominant);
    s.elementPower = mod["scope_element_power"] ?? 1;
  }
  return s;
}

/** The boost items attached to a unit, folded into one bundle. */
export function scopeMods(
  boosts: readonly ItemInstance[],
  items: ItemRegistry,
  dominant: Element,
): ScopeMods {
  let s = emptyScope();
  for (const inst of boosts) {
    const base = baseOf(inst, items);
    const p = base.params;
    const one = emptyScope();
    one.damageMult = num(p, "damage_mult", 1);
    one.speedMult = num(p, "speed_mult", 1);
    one.radiusMult = num(p, "radius_mult", 1);
    one.countAdd = num(p, "count_add", 0);
    one.spreadAdd = num(p, "spread", 0);
    one.pierceAdd = num(p, "pierce_add", 0);
    one.homing = num(p, "homing", 0);
    one.bounce = num(p, "bounce", 0);
    one.split = num(p, "split", 0);
    one.repeat = num(p, "repeat", 0);
    const el = str(p, "element", "none");
    if (el !== "none") {
      one.element = el as Element;
      one.elementPower = num(p, "element_power", 1);
    }
    // Doc 006 gives every boost a mana cost but no tick of its own, so the cost
    // rides on each projectile-firing unit the boost reaches.
    one.manaAdd = base.mana;
    s = mergeScope(s, mergeScope(one, affixScope(inst, dominant)));
  }
  return s;
}

/** An instance's own mana after its affix (`cheaper` on an attack or carrier). */
export function instanceMana(inst: ItemInstance, items: ItemRegistry): number {
  const base = baseOf(inst, items);
  return base.mana * (inst.modifier?.["mana_mult"] ?? 1);
}

/* ---------------------------------- costs ---------------------------------- */

export interface CostContext {
  readonly items: ItemRegistry;
  readonly dominant: Element;
}

/** Cost of one projectile-firing unit: its own mana plus the mana of the
 *  boosts reaching it, scaled by every `cheaper` multiplier in scope. */
function firingCost(unit: CastUnit, carrier: ScopeMods, ctx: CostContext): number {
  const scope = mergeScope(carrier, scopeMods(unit.boosts, ctx.items, ctx.dominant));
  return (instanceMana(unit.item, ctx.items) + scope.manaAdd) * scope.manaMult;
}

/**
 * Cost of a unit including its whole subtree, with **no** multicast discount.
 * Doc 006: "the discount exponent is N-1 of the outermost multicast only", so a
 * nested multicast contributes its raw sum to the group it sits in.
 */
export function subtreeCost(unit: CastUnit, carrier: ScopeMods, ctx: CostContext): number {
  if (unit.kind === "attack") return firingCost(unit, carrier, ctx);
  if (unit.kind === "payload") {
    const own = firingCost(unit, carrier, ctx);
    if (!unit.child) return own;
    const inner = mergeScope(carrier, affixScope(unit.item, ctx.dominant));
    return own + subtreeCost(unit.child, inner, ctx);
  }
  const inner = mergeScope(carrier, affixScope(unit.item, ctx.dominant));
  let sum = instanceMana(unit.item, ctx.items);
  for (const child of unit.units) sum += subtreeCost(child, inner, ctx);
  return sum;
}

/** Price of firing a multicast group: `sum × 0.8^(N-1)` over the units it
 *  actually captured, so a group that captured one unit gets no discount. */
export function multicastCost(
  unit: Extract<CastUnit, { kind: "multicast" }>,
  carrier: ScopeMods,
  ctx: CostContext,
): number {
  const inner = mergeScope(carrier, affixScope(unit.item, ctx.dominant));
  let sum = instanceMana(unit.item, ctx.items);
  for (const child of unit.units) sum += subtreeCost(child, inner, ctx);
  const captured = Math.max(1, unit.units.length);
  const extra = num(baseOf(unit.item, ctx.items).params, "discount_mult", 1);
  return sum * Math.pow(0.8, captured - 1) * extra;
}

/** What one full cycle of the tree costs if nothing is skipped. */
export function cycleCost(tree: CastTree, ctx: CostContext): number {
  const root = emptyScope();
  let total = 0;
  for (const unit of tree.units) {
    total += unit.kind === "multicast" ? multicastCost(unit, root, ctx) : subtreeCost(unit, root, ctx);
  }
  return total;
}

/* -------------------------------- projectiles ------------------------------ */

interface Carrier {
  readonly child: CastUnit;
  readonly trigger: PayloadTrigger;
  readonly carrierMods: ScopeMods;
  fired: boolean;
}

interface Projectile {
  x: number; y: number; vx: number; vy: number;
  speed: number;
  radius: number;
  /** Pre-crit, pre-flat damage. */
  damage: number;
  flat: number;
  pierce: number;
  homing: number;
  bounces: number;
  splits: number;
  element: Element;
  elementPower: number;
  life: number;
  /** A carrier that must survive its first contact to reach its trigger. */
  passthrough: boolean;
  hitOnce: boolean;
  generation: number;
  carrier: Carrier | null;
  alive: boolean;
}

interface FireSource { until: number; power: number }

/* ---------------------------------- engine --------------------------------- */

export function runCastLoop(
  staff: Staff,
  tree: CastTree,
  items: ItemRegistry,
  cfg: CastLoopConfig,
): CastLoopResult {
  const dt = cfg.dt ?? 1 / 60;
  const dominant: Element = cfg.dominantElement ?? "fire";
  const ctx: CostContext = { items, dominant };
  const mods = passiveMods(tree.passives, items);

  const castInterval = Math.max(dt, staff.cast_interval * mods.castIntervalMult);
  const cooldown = Math.max(dt, staff.cooldown * mods.cooldownMult);
  const regen = staff.mana_regen + mods.regenAdd;
  const critChance = Math.max(0, Math.min(1, staff.crit_bonus + mods.critAdd));
  const unitCount = tree.units.length;
  const cycleTime = unitCount === 0 ? cooldown : (unitCount - 1) * castInterval + cooldown;

  let mana = staff.mana_max;
  let cursor = 0;
  let nextCastAt = 0;
  let t = 0;

  let damage = 0;
  let directDamage = 0;
  let dotDamage = 0;
  let projectilesFired = 0;
  let projectileHits = 0;
  let castsAttempted = 0;
  let castsSkipped = 0;
  let payloadsArmed = 0;
  let payloadsTriggered = 0;
  let manaSpent = 0;
  let manaRegenerated = 0;
  let cycles = 0;
  let spreadSum = 0;
  let spreadShots = 0;
  /** Deterministic stand-in for a crit roll: expected rate, no randomness. */
  let critAcc = 0;
  /** Fractional `+count` accrues instead of rounding a boost away. */
  const countAcc = new Map<number, number>();

  const projectiles: Projectile[] = [];

  // Target state.
  let angle = -Math.PI / 2;
  let tx = 0;
  let ty = -TARGET_DISTANCE;
  let slowUntil = -1;
  let slowPower = 0;
  const burns: FireSource[] = [];
  const poisons: FireSource[] = [];

  function targetVelocity(): { vx: number; vy: number } {
    if (cfg.target === "stationary") return { vx: 0, vy: 0 };
    const slowed = t < slowUntil ? 1 - Math.min(0.8, 0.4 * slowPower) : 1;
    const v = TARGET_SPEED * slowed;
    return { vx: -Math.sin(angle) * v, vy: Math.cos(angle) * v };
  }

  /** Partial intercept lead: see LEAD_FACTOR. */
  function aimAt(ox: number, oy: number, speed: number): { dx: number; dy: number } {
    const v = targetVelocity();
    const dist = Math.hypot(tx - ox, ty - oy);
    const flight = speed > 0 ? dist / speed : 0;
    const lead = leadFactor(t);
    const px = tx + v.vx * flight * lead;
    const py = ty + v.vy * flight * lead;
    const len = Math.hypot(px - ox, py - oy) || 1;
    return { dx: (px - ox) / len, dy: (py - oy) / len };
  }

  function applyElement(el: Element, power: number): void {
    if (el === "fire") burns.push({ until: t + 3, power });
    else if (el === "poison") poisons.push({ until: t + 4, power });
    else if (el === "ice") {
      slowUntil = t + 2;
      slowPower = Math.max(slowPower, power);
    }
  }

  function spawn(p: Projectile): void {
    projectiles.push(p);
    projectilesFired++;
  }

  function spawnFrom(
    unit: CastUnit,
    ox: number,
    oy: number,
    carrierMods: ScopeMods,
    childCarrier: Carrier | null,
  ): void {
    const base = baseOf(unit.item, items);
    const p = base.params;
    const own = unit.item.modifier ?? {};
    const scope = mergeScope(carrierMods, scopeMods(unit.boosts, items, dominant));

    const speed = num(p, "speed", 400) * scope.speedMult * (own["speed_mult"] ?? 1);
    const radius = num(p, "radius", 4) * scope.radiusMult * (own["radius_mult"] ?? 1);
    const dmg =
      num(p, "damage", 0) * scope.damageMult * (own["damage_mult"] ?? 1) * mods.damageMult;
    const flat = scope.damageAdd + mods.damageAdd;
    const pierce = num(p, "pierce", 0) + scope.pierceAdd;
    const homing = scope.homing + (own["homing"] ?? 0) + mods.trackingAdd;

    let element: Element = str(p, "element", "none") as Element;
    let elementPower = element === "none" ? 0 : 1;
    const ownCode = own["element_code"];
    if (ownCode !== undefined) {
      element = elementOfCode(ownCode, dominant);
      elementPower = own["element_power"] ?? 1;
    }
    if (scope.element !== "none") {
      element = scope.element;
      elementPower = scope.elementPower;
    }

    const rawCount = Math.max(0, num(p, "count", 1) + scope.countAdd + (own["count_add"] ?? 0));
    let count = Math.floor(rawCount);
    const frac = rawCount - count;
    if (frac > 0) {
      const acc = (countAcc.get(unit.slot) ?? 0) + frac;
      if (acc >= 1) {
        count++;
        countAcc.set(unit.slot, acc - 1);
      } else countAcc.set(unit.slot, acc);
    }
    if (count < 1) count = 1;

    const spread = num(p, "spread", 0) + scope.spreadAdd + (own["spread_add"] ?? 0);
    spreadSum += spread;
    spreadShots++;

    const aim = aimAt(ox, oy, speed);
    const baseAngle = Math.atan2(aim.dy, aim.dx);
    const step = count > 1 ? (spread * Math.PI) / 180 / (count - 1) : 0;
    const start = count > 1 ? baseAngle - ((spread * Math.PI) / 180) / 2 : baseAngle;

    for (let i = 0; i < count; i++) {
      const a = start + step * i;
      spawn({
        x: ox, y: oy,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        speed, radius, damage: dmg, flat, pierce, homing,
        bounces: scope.bounce, splits: scope.split,
        element, elementPower,
        life: num(p, "lifetime", 1.2),
        passthrough: num(p, "passthrough", 0) > 0,
        hitOnce: false,
        generation: 0,
        // Only the first projectile of a volley carries the payload child, so
        // the child triggers once per carrier and not once per projectile.
        carrier: i === 0 ? childCarrier : null,
        alive: true,
      });
    }
  }

  /** Fire a unit whose mana is already paid for. */
  function fireFree(unit: CastUnit, ox: number, oy: number, carrierMods: ScopeMods): void {
    if (unit.kind === "attack") {
      spawnFrom(unit, ox, oy, carrierMods, null);
      return;
    }
    if (unit.kind === "payload") {
      const inner = mergeScope(carrierMods, affixScope(unit.item, dominant));
      const child: Carrier | null = unit.child
        ? {
            child: unit.child,
            trigger: str(baseOf(unit.item, items).params, "trigger", "on_hit") as PayloadTrigger,
            carrierMods: inner,
            fired: false,
          }
        : null;
      if (child) payloadsArmed++;
      spawnFrom(unit, ox, oy, carrierMods, child);
      return;
    }
    const inner = mergeScope(carrierMods, affixScope(unit.item, dominant));
    for (const child of unit.units) fireFree(child, ox, oy, inner);
  }

  /** Top of a tick: resolve mana, then fire. Returns false if the unit was
   *  skipped for want of mana, which still costs the tick. */
  function payAndFire(unit: CastUnit): boolean {
    const root = emptyScope();
    if (unit.kind === "multicast") {
      const cost = multicastCost(unit, root, ctx);
      if (mana < cost) return false;
      mana -= cost;
      manaSpent += cost;
      fireFree(unit, 0, 0, root);
      return true;
    }
    if (unit.kind === "payload") {
      const full = subtreeCost(unit, root, ctx);
      if (mana >= full) {
        mana -= full;
        manaSpent += full;
        fireFree(unit, 0, 0, root);
        return true;
      }
      // Doc 006: insufficient mana for the subtree fires the carrier alone.
      const own = subtreeCost({ ...unit, child: null }, root, ctx);
      if (mana < own) return false;
      mana -= own;
      manaSpent += own;
      fireFree({ ...unit, child: null }, 0, 0, root);
      return true;
    }
    const cost = subtreeCost(unit, root, ctx);
    if (mana < cost) return false;
    mana -= cost;
    manaSpent += cost;
    fireFree(unit, 0, 0, root);
    return true;
  }

  function trigger(p: Projectile, event: PayloadTrigger): void {
    const c = p.carrier;
    if (!c || c.fired || c.trigger !== event) return;
    c.fired = true;
    payloadsTriggered++;
    fireFree(c.child, p.x, p.y, c.carrierMods);
  }

  function split(p: Projectile): void {
    if (p.splits <= 0 || p.generation > 0) return;
    const n = Math.round(p.splits);
    const baseAngle = Math.atan2(p.vy, p.vx);
    for (let i = 0; i < n; i++) {
      const a = baseAngle + ((i - (n - 1) / 2) * Math.PI) / 9;
      const speed = p.speed * SPLIT_SPEED;
      spawn({
        x: p.x, y: p.y,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        speed,
        radius: p.radius * SPLIT_RADIUS,
        damage: p.damage * SPLIT_DAMAGE,
        flat: p.flat * SPLIT_DAMAGE,
        pierce: 0,
        homing: p.homing,
        bounces: 0,
        splits: 0,
        element: p.element,
        elementPower: p.elementPower,
        life: SPLIT_LIFETIME,
        passthrough: false,
        hitOnce: false,
        generation: p.generation + 1,
        carrier: null,
        alive: true,
      });
    }
  }

  function credit(p: Projectile): void {
    critAcc += critChance;
    const crit = critAcc >= 1;
    if (crit) critAcc -= 1;
    const raw = (p.damage * (crit ? 2 : 1) + p.flat) * (1 + p.pierce * PIERCE_TARGET_VALUE);
    damage += raw;
    directDamage += raw;
    projectileHits++;
    if (p.element !== "none") applyElement(p.element, Math.max(1e-6, p.elementPower));
  }

  /** Closest approach of the step's segment to the dummy, so a fast projectile
   *  cannot tunnel through it at 60 Hz. */
  function segmentHits(x0: number, y0: number, x1: number, y1: number, radius: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    let s = 0;
    if (len2 > 0) s = Math.max(0, Math.min(1, ((tx - x0) * dx + (ty - y0) * dy) / len2));
    const cx = x0 + dx * s;
    const cy = y0 + dy * s;
    return Math.hypot(tx - cx, ty - cy) <= radius + TARGET_RADIUS;
  }

  const steps = Math.round(cfg.duration / dt);
  for (let step = 0; step < steps; step++) {
    // 1. casts due this frame.
    if (unitCount > 0) {
      while (nextCastAt <= t + 1e-9) {
        const unit = tree.units[cursor];
        if (!unit) break;
        castsAttempted++;
        if (!payAndFire(unit)) castsSkipped++;
        if (cursor === unitCount - 1) {
          cursor = 0;
          cycles++;
          nextCastAt += cooldown;
        } else {
          cursor++;
          nextCastAt += castInterval;
        }
      }
    }

    // 2. dots, which are damage the caster never has to aim.
    const fireN = burns.length;
    if (fireN > 0) {
      let power = 0;
      for (const b of burns) power = Math.max(power, b.power);
      const tick = 2 * power * Math.pow(2, Math.min(fireN, MAX_FIRE_SOURCES) - 1) * mods.elementTickMult;
      const d = tick * dt;
      damage += d;
      dotDamage += d;
    }
    if (poisons.length > 0) {
      let tick = 0;
      for (const s of poisons) tick += 1 * s.power;
      const d = tick * mods.elementTickMult * dt;
      damage += d;
      dotDamage += d;
    }

    // 3. projectiles.
    for (const p of projectiles) {
      if (!p.alive) continue;
      if (p.homing > 0) {
        const want = Math.atan2(ty - p.y, tx - p.x);
        const have = Math.atan2(p.vy, p.vx);
        let diff = want - have;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const maxTurn = HOMING_TURN_RATE * p.homing * dt;
        const a = have + Math.max(-maxTurn, Math.min(maxTurn, diff));
        p.vx = Math.cos(a) * p.speed;
        p.vy = Math.sin(a) * p.speed;
      }
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;

      if (!p.hitOnce && segmentHits(p.x, p.y, nx, ny, p.radius)) {
        p.hitOnce = true;
        credit(p);
        trigger(p, "on_hit");
        if (!p.passthrough) {
          p.alive = false;
          split(p);
          continue;
        }
      }

      p.x = nx;
      p.y = ny;

      const outX = Math.abs(p.x) > ARENA_HALF_W - p.radius;
      const outY = Math.abs(p.y) > ARENA_HALF_H - p.radius;
      if (outX || outY) {
        if (p.bounces > 0) {
          p.bounces--;
          if (outX) {
            p.vx = -p.vx;
            p.x = Math.sign(p.x) * (ARENA_HALF_W - p.radius);
          }
          if (outY) {
            p.vy = -p.vy;
            p.y = Math.sign(p.y) * (ARENA_HALF_H - p.radius);
          }
        } else {
          trigger(p, "on_wall");
          p.alive = false;
          split(p);
          continue;
        }
      }

      p.life -= dt;
      if (p.life <= 0) {
        trigger(p, "on_expire");
        p.alive = false;
        split(p);
      }
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      if (!projectiles[i]!.alive) projectiles.splice(i, 1);
    }

    // 4. target and mana.
    if (cfg.target === "moving") {
      const slowed = t < slowUntil ? 1 - Math.min(0.8, 0.4 * slowPower) : 1;
      angle += ((TARGET_SPEED * slowed) / TARGET_DISTANCE) * dt;
      tx = Math.cos(angle) * TARGET_DISTANCE;
      ty = Math.sin(angle) * TARGET_DISTANCE;
    }
    for (let i = burns.length - 1; i >= 0; i--) if (burns[i]!.until <= t) burns.splice(i, 1);
    for (let i = poisons.length - 1; i >= 0; i--) if (poisons[i]!.until <= t) poisons.splice(i, 1);

    const before = mana;
    mana = Math.min(staff.mana_max, mana + regen * dt);
    manaRegenerated += mana - before;
    t += dt;
  }

  return {
    damage, directDamage, dotDamage,
    projectilesFired, projectileHits,
    castsAttempted, castsSkipped,
    payloadsArmed, payloadsTriggered,
    manaSpent, manaRegenerated,
    idleTime: unitCount === 0 ? cfg.duration : cycles * cooldown,
    cycles, cycleTime, units: unitCount,
    meanSpread: spreadShots > 0 ? spreadSum / spreadShots : 0,
    duration: cfg.duration,
  };
}
