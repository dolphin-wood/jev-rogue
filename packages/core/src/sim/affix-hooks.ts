/**
 * Where the twelve affixes actually fire.
 *
 * `spells/affixes.ts` is the pool: what each affix is, at which of seven
 * moments it goes off, and what its three tiers do. This is the other half —
 * the code at each of those seven moments that looks at what is attached to
 * the spell and does it. The pool was authored first and deliberately **not
 * offered** until this existed, because an affix whose hook fires nothing is
 * the multicast bug freshly painted: a card that says it does something and
 * does not.
 *
 * ### The shape: one function per hook, all fed the same way
 *
 * A spell slot carries its attached affixes. When it casts, they ride along
 * on the cast scope and are written onto every projectile the cast produces,
 * so a bullet knows what it is carrying when it hits, dies or kills. The
 * hooks that are not about a projectile — cast, hurt, dash — read the slot
 * directly. Nothing here reaches back into the item registry: an affix is
 * resolved to its tier's effect once, and the effect is what the hook applies.
 *
 * ### Why several effects reuse existing machinery
 *
 * Doc 013's test for an affix was that it be a *use* of the simulation's
 * existing moments rather than a request for new machinery. That holds:
 * `fork` and `shatter` set the split count that `splitBullets` already reads;
 * `repeat` fires the spell again as echoes; `bloom` is a fire patch; `retort`
 * and `slipstream` fire the spell itself at a target through the same
 * `fireUnit` a keypress uses. The genuinely new things are small — a mark on
 * an enemy, a ward that eats bullets, an arc that seeks the next body — and
 * each is a few lines.
 *
 * The one honest caveat is `bloom`: the "field" it leaves is a fire patch, so
 * it burns whatever the spell's element is. The fire system is the only
 * lingering-zone mechanism the simulation has, and a second one for the sake
 * of purity would be a second thing to balance. The card says "leaves a
 * field", which is true.
 */
import type { Element } from "../types.ts";
import { addPower, copyPowers, dominantElement, noPowers } from "../content/tags.ts";
import { PROC_CHAIN, SPELL_DAMAGE_SCALE } from "./cast.ts";
import { ITEMS } from "../spells/items.ts";
import { SWING_DAMAGE } from "./melee.ts";
import { levelDamageMult } from "./spells.ts";
import type { ElementPowers } from "../types.ts";
import { spellAffixById } from "../spells/affixes.ts";
import type { AffixEffect } from "../spells/affixes.ts";
import type { Bullet, Enemy, World } from "./types.ts";
import type { SpellSlot } from "./spells.ts";
import { acquire } from "./bullets.ts";
import { lightFire } from "./fire.ts";
import { circleHitsWall } from "./collide.ts";

/** One affix on one spell, at one of its three tiers. */
export interface AttachedAffix {
  readonly id: string;
}

/** The effect an attached affix has at its current tier, or null if unknown. */
export function effectOf(a: AttachedAffix): AffixEffect | null {
  const def = spellAffixById(a.id);
  return def ? def.effect : null;
}

/**
 * The world calls the hooks with these, rather than the hooks importing them.
 *
 * `hurtEnemy` and the impact feedback live in `world.ts` and importing them
 * here would make the two modules import each other. Passing what a hook needs
 * also states, in one place, everything an affix is allowed to do to the world:
 * hurt a body, and cast the spell again.
 */
export interface HookSim {
  hurt(e: Enemy, amount: number): void;
  /**
   * Casts the spell in slot `spellIndex`, free, from `origin` at `target`.
   *
   * **The slot, not the item.** Fired through an empty scope, a cast loses
   * everything that says *which* spell this is: the slot index the renderer
   * looks the art up by, the affixes, the element and the level. A
   * `resonance` or `retort` cast came out as a generic pale bolt instead of
   * the spell the player put on the key.
   */
  fire(spellIndex: number, origin: { x: number; y: number }, target: { x: number; y: number }): void;
  /** Puts `power` of an element's gauge on a body, as a hit carrying it would (`spillover`). */
  status(e: Enemy, element: "fire" | "ice" | "poison", power: number): void;
  /** Staggers a body as a spell of this weight would (`slam`). */
  stagger(e: Enemy, weight: number): void;
}

/** A rune left on the floor by `ward`, which stops enemy projectiles. */
export interface Ward {
  x: number;
  y: number;
  radius: number;
  shots: number;
  lifeMs: number;
}

export const WARD_RADIUS = 18;
export const WARD_LIFE_MS = 6000;
/**
 * The floor under a chained copy's speed, so a slow spell's chain still
 * arrives while the pack is still a pack.
 */
const ARC_MIN_SPEED = 320;
/** The reach of an arc from a spell that chains without an affix saying so. */
const ARC_DEFAULT_RANGE = 170;
/**
 * What a chained copy keeps of the shot that made it, besides its identity:
 * its size, and how long it has to reach the next body.
 */
const ARC_SIZE = 0.65;
const ARC_LIFE_MS = 900;
/**
 * Fraction of the parent's damage an arc carries: **half**, each jump.
 *
 * It was 0.7 and one jump. Halving per jump is what lets a chain be long
 * without being a multiplier: two jumps from a 5-damage spark deal 5, 2.5
 * and 1.25, which is about 9 spread over three bodies — worth pressing where
 * they bunch and never the best answer to one of them.
 */
/*
 * Down from a half. At a half the two jumps of the starting shock were worth
 * three quarters of the first hit again, and pressed without looking it
 * cleared bunched rooms on its own; at 0.4 the chain is worth about half
 * the first hit, so it is a bonus for grouping, not the spell's main body.
 */
const ARC_DAMAGE = 0.4;
/**
 * What a `mark` detonation deals, as a share of the triggering hit. Cut from
 * 1.5: measured on a pack, a tier-three brand dealt five times the bare bolt,
 * the strongest single affix in the pool by a distance.
 */
const MARK_DAMAGE = 1.0;
/** What a `harvest` burst deals, flat, so it scales with tier and not with the kill. */
const BURST_DAMAGE = 6;

function find(affixes: readonly AttachedAffix[], kind: AffixEffect["kind"]): AffixEffect | null {
  for (const a of affixes) {
    const e = effectOf(a);
    if (e && e.kind === kind) return e;
  }
  return null;
}

function hookOf(id: string): string | null {
  return spellAffixById(id)?.hook ?? null;
}

/** The attached affixes that fire at a given moment. */
function at(affixes: readonly AttachedAffix[], hook: string): AttachedAffix[] {
  return affixes.filter((a) => hookOf(a.id) === hook);
}

/* ---------------------------------- cast ---------------------------------- */

/**
 * What the cast-time affixes add to the scope a spell fires with.
 *
 * `repeat` and the split counts ride the existing scope fields. `spread` is
 * returned separately because it is not a property of a projectile but of the
 * cast: the same unit fired again in other directions.
 */
export function castAdditions(affixes: readonly AttachedAffix[]): {
  repeat: number; split: number; spreadDirs: number;
  /** What the `shape` affixes do to the projectile, as scope changes. */
  mods: {
    pierceAdd: number; homing: number; bounce: number; damageMult: number; radiusMult: number; speedMult: number;
    /** Every element the affixes grant, by power: `kindle` **and** `blight`. */
    elements: ElementPowers;
    element: Element | null; elementPower: number;
  };
} {
  let repeat = 0;
  let split = 0;
  let spreadDirs = 0;
  const mods = {
    pierceAdd: 0, homing: 0, bounce: 0, damageMult: 1, radiusMult: 1, speedMult: 1,
    elements: noPowers(), element: null as Element | null, elementPower: 0,
  };
  for (const a of affixes) {
    const e = effectOf(a);
    if (!e || e.kind !== "shape") continue;
    mods.pierceAdd += e.pierce ?? 0;
    mods.homing += e.homing ?? 0;
    mods.bounce += e.bounce ?? 0;
    mods.damageMult *= e.damage ?? 1;
    mods.radiusMult *= e.radius ?? 1;
    mods.speedMult *= e.speed ?? 1;
    /*
     * **Two element affixes are two elements**, and two of the same are one
     * element twice as strong. `kindle` used to overwrite `rime`, so the
     * second card the player attached silently deleted the first.
     */
    if (e.element) addPower(mods.elements, e.element, e.power ?? 1);
  }
  for (const a of at(affixes, "cast")) {
    const e = effectOf(a);
    if (!e) continue;
    if (e.kind === "repeat") repeat += e.extra;
    if (e.kind === "spread") spreadDirs += e.dirs;
  }
  mods.element = dominantElement(mods.elements) === "none" ? null : dominantElement(mods.elements);
  mods.elementPower = mods.element ? mods.elements[mods.element as "fire"] : 0;
  // `fork` is a hit affix, but the split count has to be on the projectile
  // before it dies, so it is set at cast and consumed by `splitBullets`.
  const fork = find(at(affixes, "hit"), "split");
  if (fork && fork.kind === "split") split += fork.count;
  return { repeat, split, spreadDirs, mods };
}

/**
 * Casting with `ward` attached leaves a rune where the caster stood.
 *
 * The only affix that makes standing still correct, briefly: the rune stops
 * enemy projectiles for a few shots, and it is where the player was, not where
 * they are — so it rewards casting from a spot and holding it.
 */
export function onCast(w: World, slot: SpellSlot, spellIndex = -1, cost = 0): void {
  const casts = at(slot.affixes, "cast");
  const ward = find(casts, "ward");
  if (ward && ward.kind === "ward")
    w.wards.push({
      x: w.player.x, y: w.player.y, radius: WARD_RADIUS,
      shots: ward.shots, lifeMs: WARD_LIFE_MS,
    });
  /*
   * `repulse`: the bodies close round the caster are thrown back, by the
   * same knockback a blow gives, so a plated body or the king holds (`stepEnemy`).
   */
  const repulse = find(casts, "repulse");
  if (repulse && repulse.kind === "repulse") {
    const p = w.player;
    let shoved = 0;
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.spawnFadeMs > 0) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > repulse.radiusPx + e.radius) continue;
      const push = repulse.push / Math.max(1, e.radius / 10);
      e.knockX += (dx / d) * push;
      e.knockY += (dy / d) * push;
      armSlam(slot.affixes, e);
      shoved++;
    }
    if (shoved > 0) w.events.push({ kind: "shot", x: p.x, y: p.y, what: "repulse" });
  }
  /*
   * `aftershock`: a delayed burst under the nearest body, through the same
   * loose marks a doom leaves (`World.dooms`), worth a share of **one of the
   * spell's own hits** at its level. It was a share of the press's mana, the
   * same whatever the spell did with it, so on a weak or many-piece spell it
   * was most of the damage — seven times Stone Ward's on a pack — and on
   * every spell alike it was the best rare affix there was.
   */
  const shock = find(casts, "aftershock");
  if (shock && shock.kind === "aftershock" && cost > 0) {
    const [t] = nearestN(w, w.player.x, w.player.y, 1);
    if (t && Math.hypot(t.x - w.player.x, t.y - w.player.y) <= shock.rangePx) {
      w.dooms.push({
        x: t.x, y: t.y, ms: shock.delayMs, radius: shock.radiusPx,
        damage: Math.max(1, Math.round(spellHit(slot) * AFTERSHOCK_SHARE)), spellIndex, tag: "aftershock",
      });
      w.events.push({ kind: "hazard_tick", x: t.x, y: t.y, what: "aftershock_mark" });
    }
  }
}

/**
 * `lodestar`: where the cast lands instead of the aim — the nearest body in
 * reach of the caster — or null for a slot without it or a room with no
 * body in reach, where the cast goes where it was aimed.
 */
export function lodestarTarget(w: World, slot: SpellSlot): { x: number; y: number } | null {
  const l = find(at(slot.affixes, "cast"), "lodestar");
  if (!l || l.kind !== "lodestar") return null;
  const [t] = nearestN(w, w.player.x, w.player.y, 1);
  return t && Math.hypot(t.x - w.player.x, t.y - w.player.y) <= l.rangePx ? { x: t.x, y: t.y } : null;
}

/** Whether this shot puts out the enemy shots it touches (`intercept`). */
export function intercepts(b: Bullet): boolean {
  return find(at(b.affixes, "cast"), "intercept") !== null;
}

/** The share of its health under which a hit from this shot fells a body (`cull`), or 0. */
export function cullShare(b: Bullet): number {
  const c = find(at(b.affixes, "hit"), "cull");
  return c && c.kind === "cull" ? c.share : 0;
}

/** Arms a `slam` on a body just thrown by a spell carrying it. */
function armSlam(affixes: readonly AttachedAffix[], e: Enemy): void {
  const slam = find(at(affixes, "hit"), "slam");
  if (!slam || slam.kind !== "slam") return;
  e.slamMs = Math.max(e.slamMs, slam.windowMs);
  e.slamImpact = Math.max(e.slamImpact, slam.impact);
}

/** The knockback, px/s, under which a body meeting a wall is only stopped, not slammed. */
const SLAM_MIN_SPEED = 60;
/** How heavy a slam is, as a spell's weight, for the stagger. */
const SLAM_WEIGHT = 2;

/**
 * `slam`: a body thrown while its window runs, and stopped by a wall or a prop
 * in the direction it is thrown, takes the blow and staggers. Once a throw:
 * the window closes on the impact.
 */
export function stepSlams(w: World, dtMs: number, sim: HookSim): void {
  for (const e of w.enemies) {
    if (e.slamMs <= 0) continue;
    e.slamMs -= dtMs;
    if (e.hp <= 0) { e.slamMs = 0; continue; }
    const v = Math.hypot(e.knockX, e.knockY);
    if (v < SLAM_MIN_SPEED) continue;
    const ux = e.knockX / v, uy = e.knockY / v;
    if (!circleHitsWall(w.room.grid, e.x + ux * 3, e.y + uy * 3, e.radius)) continue;
    e.slamMs = 0;
    sim.hurt(e, e.slamImpact);
    sim.stagger(e, SLAM_WEIGHT);
    e.knockX = 0;
    e.knockY = 0;
    w.events.push({ kind: "enemy_hit", x: e.x + ux * e.radius, y: e.y + uy * e.radius, what: "slam", amount: e.slamImpact });
  }
}

/** A spell's `afterimage`, for the world to read when one of its pulls, companions or orbs runs out. */
export function afterimageOf(slot: SpellSlot | null | undefined): number {
  if (!slot) return 0;
  const a = find(at(slot.affixes, "end"), "afterimage");
  return a && a.kind === "afterimage" ? a.rangePx : 0;
}

/** The nearest body to a point within `range`, for a free cast from there. */
export function nearestWithin(w: World, x: number, y: number, range: number): Enemy | null {
  const [t] = nearestN(w, x, y, 1);
  return t && Math.hypot(t.x - x, t.y - y) <= range ? t : null;
}

/**
 * What an `aftershock` deals, as a share of one of the spell's hits: a
 * little over a third of it again, on the body and whatever stands beside it.
 */
export const AFTERSHOCK_SHARE = 0.35;

/** One of this key's hits at its level, as the card prints it: a sword-energy spell's in swings of the sword. */
function spellHit(slot: SpellSlot): number {
  const params = (ITEMS.get(slot.item.base)?.params ?? {}) as Record<string, unknown>;
  const sword = Number(params["sword"] ?? 0);
  const base = sword > 0 ? sword * SWING_DAMAGE : Number(params["damage"] ?? 0) * SPELL_DAMAGE_SCALE;
  return base * levelDamageMult(slot.level ?? 1);
}

/**
 * The sword's spin started. Any spell with `whirl` is cast, free, at the
 * nearest bodies — one cast a body, as `retort` casts at the one that hit.
 */
export function onSpin(w: World, sim: HookSim, skip: (spellIndex: number) => boolean = () => false): void {
  w.spells.forEach((slot, i) => {
    if (!slot || skip(i)) return;
    const r = find(at(slot.affixes, "spin"), "whirl");
    if (!r || r.kind !== "whirl") return;
    for (const t of nearestN(w, w.player.x, w.player.y, r.targets)) sim.fire(i, w.player, t);
  });
}

/** How many casts a key's `whirl` makes of a spin, or 0 for a key without it. */
export function whirlTargets(slot: SpellSlot): number {
  const r = find(at(slot.affixes, "spin"), "whirl");
  return r && r.kind === "whirl" ? r.targets : 0;
}

/**
 * What a `drag` hit does to the body in place of the shot's own shove: a
 * pull toward the caster, at this many px/s, or 0 for a shot without it.
 * Read by the hit in `world.ts`, which owns the knockback.
 */
export function dragPull(b: Bullet): number {
  const drag = find(at(b.affixes, "hit"), "drag");
  return drag && drag.kind === "drag" ? drag.px * DRAG_PER_PX : 0;
}

/**
 * A knockback of `v` px/s carries a body about `v / 10.8` px as it decays
 * (`stepEnemy`: ×0.82 a step at sixty steps a second), so this turns the
 * affix's distance into the shove that travels it.
 */
const DRAG_PER_PX = 10.8;

/**
 * The extra directions a `spread` cast fires in, as unit vectors about the aim.
 *
 * One extra is straight behind; three is behind and both sides; five is every
 * sixty degrees. Evenly spaced so the cast reads as a shape rather than a
 * spray, and never including the aim itself, which the main cast already took.
 */
export function spreadDirections(aimX: number, aimY: number, dirs: number): { x: number; y: number }[] {
  if (dirs <= 0) return [];
  const base = Math.atan2(aimY, aimX);
  const out: { x: number; y: number }[] = [];
  const step = (Math.PI * 2) / (dirs + 1);
  for (let i = 1; i <= dirs; i++) {
    const a = base + step * i;
    out.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return out;
}

/** How many arcs a `chain` projectile starts with, from the affix's tier. */
export function arcJumps(affixes: readonly AttachedAffix[]): number {
  const arc = find(at(affixes, "hit"), "arc");
  return arc && arc.kind === "arc" ? arc.jumps : 0;
}

/* ----------------------------------- hit ---------------------------------- */

/**
 * A projectile with affixes overlapped a body.
 *
 * `chain` seeks the next body and carries on; `brand` marks the body, and a
 * second hit on a marked body detonates it. `fork` is not here — it is a split
 * count set at cast and applied when the projectile dies, which on a hit is
 * the next thing that happens.
 */
export function onHit(w: World, b: Bullet, e: Enemy, sim: HookSim): void {
  const hits = at(b.affixes, "hit");
  /*
   * No early return on an empty affix list. There was one, and it sat above
   * the arc: a spell that chains **on its own account** — the starting shock
   * arc — carries no affixes, so it returned here and never chained. The
   * spell-check said every spell "fires and hits", which it did; the hit was
   * just the end of it.
   */

  /*
   * A chain is a chain whether it came from the affix or from the spell.
   *
   * This required the `chain` affix to be attached, so an attack item that
   * arcs on its own account — the starting shock spell — had `arcLeft` set and
   * nothing read it. The affix now supplies the *range* when it is present and
   * the default stands in when it is not.
   */
  const arc = find(hits, "arc");
  if (b.arcLeft > 0) {
    const range = arc && arc.kind === "arc" ? arc.rangePx : ARC_DEFAULT_RANGE;
    const next = nearestOther(w, e, b.x, b.y, range, b.hitIds);
    if (next) {
      const child = acquire(w.playerBullets, false);
      if (child) {
        /*
         * **The chain releases a smaller copy of the spell, not an arc.**
         *
         * It used to make a generic fast white streak at a fixed 520 px/s,
         * which meant the affix looked and behaved identically on all twelve
         * attacks: a chained void orb and a chained frost needle were the
         * same object. That is the one thing an affix must not do — the spell
         * on the key is the player's decision, and an affix that erases it
         * makes every build's chain the same chain.
         *
         * So the child keeps the parent's **identity**: `spellIndex` (which
         * is what the renderer takes the shape and the light from), element,
         * element power, and the parent's own speed. What it loses is
         * everything that would make it a multiplier — it is smaller, it does
         * a fraction of the damage, and it carries none of the parent's
         * pierce, bounce or split. A weaker second casting of the
         * same spell, aimed at the next body.
         */
        const d = Math.hypot(next.x - b.x, next.y - b.y) || 1;
        const speed = Math.max(ARC_MIN_SPEED, Math.hypot(b.vx, b.vy));
        child.alive = true;
        child.x = b.x;
        child.y = b.y;
        child.vx = ((next.x - b.x) / d) * speed;
        child.vy = ((next.y - b.y) / d) * speed;
        child.radius = Math.max(2, b.radius * ARC_SIZE);
        // Not rounded up to one: a fourth jump doing what a third did would
        // make the halving a lie. Fractional damage is what the sim carries.
        child.damage = b.damage * ARC_DAMAGE;
        child.lifeMs = ARC_LIFE_MS;
        child.element = b.element;
        child.elementPower = b.elementPower;
        copyPowers(child.powers, b.powers);
        // A jump is a lesser copy in what it triggers as well as in what it
        // deals: Risk of Rain 2 discounts a chained hit twice, and so do we.
        child.proc = b.proc * PROC_CHAIN;
        child.statusMult = b.statusMult;
        child.affixes = b.affixes;
        child.spellIndex = b.spellIndex;
        child.weight = b.weight * ARC_SIZE;
        child.leavesFire = b.leavesFire;
        child.manaSpent = 0;
        child.arcLeft = b.arcLeft - 1;
        // A copy is drawn as the spell is, and a bolt's streak runs back along
        // its own path, so it has to remember where it started.
        child.originX = b.x;
        child.originY = b.y;
        child.targetId = next.id;
        // It still homes hard on the body it was released at: the affix's
        // promise is that the hit reaches the next target, not that a second
        // shot is fired in its general direction.
        child.seekDegPerS = 720;
        child.seekMs = 0;
        // Carries the parent's hit list, so a copy never comes back to the
        // body it just left.
        child.hitIds = [...b.hitIds, e.id];
        child.split = 0;
        child.pierce = 0;
        child.bounce = 0;
        child.homing = 0;
        child.orbitMs = 0;
        w.events.push({ kind: "shot", x: b.x, y: b.y, what: "arc" });
      }
    }
  }

  if (hits.length === 0) return;

  // `slam`: the throw this hit is about to give arms the wall.
  armSlam(b.affixes, e);

  /*
   * `overload`: the hit's damage charges the body — the damage itself, not
   * cut by the proc share as a trigger is, since the damage already is the
   * rate: cut again, the spells that hit most often, whose affix this is,
   * charged slowest of all. At the charge, lightning strikes it and what
   * stands beside it, and the charge starts again.
   */
  const over = find(hits, "overload");
  if (over && over.kind === "overload") {
    e.overload += b.damage;
    if (e.overload >= over.charge) {
      e.overload = 0;
      burst(w, e.x, e.y, over.radiusPx, over.strike, sim, "overload");
    }
  }

  const mark = find(hits, "mark");
  // A pellet of a cone marks a body a fraction as often as a bolt does: an
  // on-hit trigger is bought with the hit's proc weight, not with its count.
  if (mark && mark.kind === "mark" && (b.proc >= 1 || w.rng.next() < b.proc)) {
    if (e.marked) {
      e.marked = false;
      burst(w, e.x, e.y, mark.radiusPx, Math.round(b.damage * MARK_DAMAGE), sim, "brand");
    } else {
      e.marked = true;
    }
  }
}

function nearestOther(
  w: World, not: Enemy, x: number, y: number, range: number, exclude: readonly number[],
): Enemy | null {
  let best: Enemy | null = null;
  let bestD = range;
  for (const o of w.enemies) {
    if (o === not || o.hp <= 0 || o.spawnFadeMs > 0 || exclude.includes(o.id)) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

/* ---------------------------------- kill ---------------------------------- */

/**
 * A body died to a projectile carrying affixes.
 *
 * `harvest` bursts where it fell; `haste` takes cooldown off. Nothing on a
 * spell gives mana back — Echo did, and a spell that paid for itself left
 * the sword, which is what supplies mana, with nothing to do.
 */
export function onKill(w: World, b: Bullet, e: Enemy, sim: HookSim): void {
  const kills = at(b.affixes, "kill");
  if (kills.length === 0) return;

  const harvest = find(kills, "burst");
  if (harvest && harvest.kind === "burst")
    burst(w, e.x, e.y, harvest.radiusPx, BURST_DAMAGE, sim, "harvest");

  /*
   * `spillover`: what the body carried goes on to the bodies round it — a
   * burn, chill or poison running or building on it, and the element of the
   * hit that killed it, which lands after the kill and so is not on the body
   * yet — each at two hits' worth, so a spread status still has to be finished.
   */
  const spill = find(kills, "spill");
  if (spill && spill.kind === "spill") {
    const carried: ("fire" | "ice" | "poison")[] = [];
    if (e.burnMs > 0 || e.burnBuild > 0 || b.powers.fire > 0) carried.push("fire");
    if (e.frozenMs > 0 || e.chillBuild > 0 || b.powers.ice > 0) carried.push("ice");
    if (e.poisonMs > 0 || e.poisonBuild > 0 || b.powers.poison > 0) carried.push("poison");
    if (carried.length > 0) {
      let reached = 0;
      for (const o of w.enemies) {
        if (o === e || o.hp <= 0 || o.spawnFadeMs > 0) continue;
        if (Math.hypot(o.x - e.x, o.y - e.y) > spill.radiusPx + o.radius) continue;
        for (const el of carried) sim.status(o, el, SPILL_POWER);
        reached++;
      }
      if (reached > 0) w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "spillover" });
    }
  }

  // `haste`: the kill takes a share off this spell's cooldown.
  const haste = find(kills, "haste");
  const slot = b.spellIndex >= 0 ? w.spells[b.spellIndex] : null;
  if (haste && haste.kind === "haste" && slot && slot.cooldownMs > 0) {
    slot.cooldownMs *= 1 - haste.fraction;
    w.events.push({ kind: "pickup", x: e.x, y: e.y, what: "haste" });
  }
}

/** The element power a spilled status lands with: about two ordinary hits of gauge. */
const SPILL_POWER = 2;

/** Hurts every other body within `radius` of a point. */
function burst(
  w: World, x: number, y: number, radius: number, damage: number, sim: HookSim, what: string,
): void {
  for (const o of w.enemies) {
    if (o.hp <= 0 || o.spawnFadeMs > 0) continue;
    if (Math.hypot(o.x - x, o.y - y) > radius + o.radius) continue;
    sim.hurt(o, damage);
  }
  w.events.push({ kind: "enemy_hit", x, y, what, amount: damage });
}

/* -------------------------------- expire, wall ------------------------------ */

/**
 * A projectile ran out, or stopped on geometry.
 *
 * `bloom` leaves a field where it ran out. `shatter` returns the count to
 * split into on a wall, which the caller hands to `splitBullets` — the split
 * itself already exists and does the right thing given a count.
 */
export function onExpire(w: World, b: Bullet): void {
  const bloom = find(at(b.affixes, "expire"), "field");
  if (bloom && bloom.kind === "field") {
    const f = lightFire(w, b.x, b.y, "player");
    f.radius = bloom.radiusPx;
    f.lifeMs = bloom.durationMs;
  }
}

export function wallSplitCount(b: Bullet): number {
  const shatter = find(at(b.affixes, "wall"), "split");
  return shatter && shatter.kind === "split" ? shatter.count : 0;
}

/* ------------------------------- hurt, dash -------------------------------- */

/**
 * The player took a hit. Any spell with `retort` fires back at what did it.
 *
 * Free, and at the attacker's position rather than along the facing: the
 * point is that a mistake does not become three, and a riposte the player has
 * to aim is a riposte that arrives after the second hit.
 */
export function onHurt(w: World, fromX: number, fromY: number, sim: HookSim): void {
  w.spells.forEach((slot, i) => {
    if (!slot) return;
    const r = find(at(slot.affixes, "hurt"), "riposte");
    if (!r || r.kind !== "riposte") return;
    for (const t of nearestN(w, fromX, fromY, r.targets)) sim.fire(i, w.player, t);
  });
}

/**
 * A dash began at `from`. Any spell with `parting` casts, free, from there at
 * the nearest body in reach: once a dash, before the dash has carried the
 * caster anywhere, so it is the spot left behind that fires.
 */
export function onDashStart(w: World, from: { x: number; y: number }, sim: HookSim): void {
  w.spells.forEach((slot, i) => {
    if (!slot) return;
    const r = find(at(slot.affixes, "dash"), "parting");
    if (!r || r.kind !== "parting") return;
    const [t] = nearestN(w, from.x, from.y, 1);
    if (t && Math.hypot(t.x - from.x, t.y - from.y) <= r.rangePx) sim.fire(i, { x: from.x, y: from.y }, t);
  });
}

/**
 * The player dashed through a body. Any spell with `slipstream` casts at it.
 *
 * `targets` is the most bodies one dash may fire at, counted by the caller
 * across the dash, so passing through a crowd at tier one still only casts
 * once.
 */
export function onDashThrough(w: World, e: Enemy, firedThisDash: number, sim: HookSim): boolean {
  let fired = false;
  w.spells.forEach((slot, i) => {
    if (!slot) return;
    const r = find(at(slot.affixes, "dash"), "riposte");
    if (!r || r.kind !== "riposte" || firedThisDash >= r.targets) return;
    sim.fire(i, w.player, e);
    fired = true;
  });
  return fired;
}

function nearestN(w: World, x: number, y: number, n: number): Enemy[] {
  return w.enemies
    .filter((e) => e.hp > 0 && e.spawnFadeMs <= 0)
    .map((e) => ({ e, d: Math.hypot(e.x - x, e.y - y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((p) => p.e);
}

/* --------------------------------- wards ----------------------------------- */

/** Advances the wards and drops the spent or expired ones. */
export function stepWards(w: World, dtMs: number): void {
  for (const ward of w.wards) ward.lifeMs -= dtMs;
  w.wards = w.wards.filter((ward) => ward.shots > 0 && ward.lifeMs > 0);
}

/** Whether a ward stopped this enemy projectile, spending one of its shots. */
export function wardStops(w: World, b: Bullet): boolean {
  for (const ward of w.wards) {
    if (ward.shots <= 0) continue;
    if (Math.hypot(ward.x - b.x, ward.y - b.y) > ward.radius + b.radius) continue;
    ward.shots--;
    w.events.push({ kind: "enemy_hit", x: b.x, y: b.y, what: "ward" });
    return true;
  }
  return false;
}
