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
 * Doc 013's test for an affix was that it be a *use* of `firePayloadChild`
 * and the world's events rather than a request for new machinery. That holds:
 * `fork` and `shatter` set the split count that `splitBullets` already reads;
 * `repeat` is the scope's own `repeat`; `bloom` is a fire patch; `retort` and
 * `slipstream` fire the spell's own unit at a target through the same
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
import type { CastUnit, Element } from "../types.ts";
import { spellAffixById } from "../spells/affixes.ts";
import type { AffixEffect } from "../spells/affixes.ts";
import type { Bullet, Enemy, World } from "./types.ts";
import type { SpellSlot } from "./spells.ts";
import { acquire } from "./bullets.ts";
import { lightFire } from "./fire.ts";

/** One affix on one spell, at one of its three tiers. */
export interface AttachedAffix {
  readonly id: string;
  readonly tier: 1 | 2 | 3;
}

/** The effect an attached affix has at its current tier, or null if unknown. */
export function effectOf(a: AttachedAffix): AffixEffect | null {
  const def = spellAffixById(a.id);
  return def ? def.tiers[a.tier - 1]!.effect : null;
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
  fire(unit: CastUnit, origin: { x: number; y: number }, target: { x: number; y: number }): void;
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
/** How far a `chain` arc will look for its next body. */
const ARC_SPEED = 520;
/** The reach of an arc from a spell that chains without an affix saying so. */
const ARC_DEFAULT_RANGE = 170;
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
    element: Element | null; elementPower: number;
  };
} {
  let repeat = 0;
  let split = 0;
  let spreadDirs = 0;
  const mods = {
    pierceAdd: 0, homing: 0, bounce: 0, damageMult: 1, radiusMult: 1, speedMult: 1,
    element: null as Element | null, elementPower: 0,
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
    if (e.element) { mods.element = e.element; mods.elementPower = Math.max(mods.elementPower, e.power ?? 1); }
  }
  for (const a of at(affixes, "cast")) {
    const e = effectOf(a);
    if (!e) continue;
    if (e.kind === "repeat") repeat += e.extra;
    if (e.kind === "spread") spreadDirs += e.dirs;
  }
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
export function onCast(w: World, slot: SpellSlot): void {
  const ward = find(at(slot.affixes, "cast"), "ward");
  if (ward && ward.kind === "ward")
    w.wards.push({
      x: w.player.x, y: w.player.y, radius: WARD_RADIUS,
      shots: ward.shots, lifeMs: WARD_LIFE_MS,
    });
}

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
        const d = Math.hypot(next.x - b.x, next.y - b.y) || 1;
        child.alive = true;
        child.x = b.x;
        child.y = b.y;
        child.vx = ((next.x - b.x) / d) * ARC_SPEED;
        child.vy = ((next.y - b.y) / d) * ARC_SPEED;
        child.radius = Math.max(2, b.radius * 0.8);
        // Not rounded up to one: a fourth jump doing what a third did would
        // make the halving a lie. Fractional damage is what the sim carries.
        child.damage = b.damage * ARC_DAMAGE;
        child.lifeMs = 900;
        child.element = b.element;
        child.elementPower = b.elementPower;
        child.affixes = b.affixes;
        child.spellIndex = b.spellIndex;
        child.manaSpent = 0;
        child.arcLeft = b.arcLeft - 1;
        // The arc is drawn as a line from the body it left to the body it is
        // reaching, so it has to remember where it started.
        child.originX = b.x;
        child.originY = b.y;
        child.targetId = next.id;
        // Fast and straight: a chain is not a projectile that can be dodged.
        child.seekDegPerS = 720;
        // Carries the parent's hit list, so an arc never bounces back to the
        // body it just left.
        child.hitIds = [...b.hitIds, e.id];
        child.split = 0;
        child.pierce = 0;
        child.bounce = 0;
        child.homing = 0;
        child.payloadUnit = null;
        child.passthrough = false;
        w.events.push({ kind: "shot", x: b.x, y: b.y, what: "arc" });
      }
    }
  }

  if (hits.length === 0) return;

  const mark = find(hits, "mark");
  if (mark && mark.kind === "mark") {
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
 * `harvest` bursts where it fell; `echo` refunds the cast. The refund is a
 * fraction of what the cast actually cost, recorded on the projectile at cast
 * time, so a cheaper build refunds less in absolute terms and the affix cannot
 * be turned into a mana engine by attaching it to something free.
 */
export function onKill(w: World, b: Bullet, e: Enemy, sim: HookSim): void {
  const kills = at(b.affixes, "kill");
  if (kills.length === 0) return;

  const harvest = find(kills, "burst");
  if (harvest && harvest.kind === "burst")
    burst(w, e.x, e.y, harvest.radiusPx, BURST_DAMAGE, sim, "harvest");

  const echo = find(kills, "refund");
  if (echo && echo.kind === "refund" && b.manaSpent > 0) {
    w.player.mana = Math.min(w.staff.mana_max, w.player.mana + b.manaSpent * echo.fraction);
    w.events.push({ kind: "pickup", x: e.x, y: e.y, what: "echo" });
  }

  // `haste`: the kill takes a share off this spell's cooldown.
  const haste = find(kills, "haste");
  const slot = b.spellIndex >= 0 ? w.spells[b.spellIndex] : null;
  if (haste && haste.kind === "haste" && slot && slot.cooldownMs > 0) {
    slot.cooldownMs *= 1 - haste.fraction;
    w.events.push({ kind: "pickup", x: e.x, y: e.y, what: "haste" });
  }
}

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
  for (const slot of w.spells) {
    if (!slot || !slot.unit) continue;
    const r = find(at(slot.affixes, "hurt"), "riposte");
    if (!r || r.kind !== "riposte") continue;
    const targets = nearestN(w, fromX, fromY, r.targets);
    for (const t of targets) sim.fire(slot.unit, w.player, t);
  }
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
  for (const slot of w.spells) {
    if (!slot || !slot.unit) continue;
    const r = find(at(slot.affixes, "dash"), "riposte");
    if (!r || r.kind !== "riposte" || firedThisDash >= r.targets) continue;
    sim.fire(slot.unit, w.player, e);
    fired = true;
  }
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
