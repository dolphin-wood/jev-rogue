/**
 * A keyed spell leaving the hand (design doc 013): one attack item, fired
 * through the scope its key builds (`sim/spells.ts`), dispatched on its shape.
 *
 * Every spell is self-contained. The scope carries what the key adds — the
 * spell's level, its event affixes' projectile changes and elements, and the
 * identity of the key that cast it — and nothing from any other spell.
 */
import type { ItemRegistry } from "../spells/items.ts";
import { num, str } from "../spells/items.ts";
import type { Element, ElementPowers, ItemInstance } from "../types.ts";
import type { Bullet, Enemy, Landing, PlayerWakeCut, World } from "./types.ts";
import { DASH_SPEED, PLAYER_RADIUS } from "./types.ts";
import { ORB_OFFSET_PX } from "./shapes.ts";
import { takeLodged } from "./recall.ts";
import { acquire } from "./bullets.ts";
import { hasLineOfSight, normalise, tileAt } from "./collide.ts";
import { GRID_H, GRID_W, TILE_PX, Tile } from "../types.ts";
import { assistAim, screenTargets, seekTargets } from "./aim.ts";
import { arcJumps, effectOf } from "./affix-hooks.ts";
import type { AttachedAffix } from "./affix-hooks.ts";
import { lightFire } from "./fire.ts";
import { addPower, addPowers, copyPowers, dominantElement, noPowers } from "../content/tags.ts";
import { raisePillar } from "./props.ts";
import { startWake } from "./attacks.ts";
import { SWING_DAMAGE } from "./melee.ts";

/**
 * What one cast carries onto everything it fires: the key's multipliers, the
 * projectile changes its affixes make, the elements they add, and which key
 * cast it.
 */
export interface ScopeMods {
  damageMult: number;
  speedMult: number;
  radiusMult: number;
  pierceAdd: number;
  homing: number;
  bounce: number;
  split: number;
  /**
   * **Every element the cast carries, by power, added rather than replaced.**
   *
   * `element`/`elementPower` below are the loudest of these. An affix of the
   * spell's own element used to *replace* its power, so Kindle on a fire
   * spell was a dead card and sometimes a downgrade, and a second element
   * cancelled the first.
   */
  elements: ElementPowers;
  element: Element;
  elementPower: number;
  /**
   * Multiplier on the proc weight (`procWeight`) of every piece the cast
   * fires: how much each hit is worth to an on-hit effect, the element gauges
   * included. A `repeat` echo fires at half.
   */
  procMult: number;
  /**
   * The casting spell's context. Not modifiers at all — these identify *which
   * spell is casting* so the projectiles it produces can carry that back to
   * the world's hooks.
   */
  affixes: readonly { readonly id: string }[];
  spellIndex: number;
  manaSpent: number;
  /**
   * How far a `charge` spell was held, as a share of its full charge: 0 is a
   * tap, 1 a full charge (doc 006). Read only by a spell that has `charge`;
   * every cast that was not held — a free cast among them — is a full one.
   */
  charge: number;
  /**
   * How many shots a `charges` spell looses: the charges banked when the key
   * went down (doc 006). 0 reads the item's own `count`, which is what every
   * other spell and every free cast fires.
   */
  volley: number;
}

export function emptyScope(): ScopeMods {
  return {
    damageMult: 1, speedMult: 1, radiusMult: 1,
    pierceAdd: 0, homing: 0, bounce: 0, split: 0,
    elements: noPowers(), element: "none", elementPower: 0,
    procMult: 1,
    affixes: [], spellIndex: -1, manaSpent: 0,
    charge: 1, volley: 0,
  };
}

/**
 * **What a tap of a `charge` spell is worth**, of a full charge: its damage
 * and the size of the shot scale from this at a tap to the whole figure at
 * a full charge, linearly in the time held (doc 006). A quarter, so a tap is
 * still a shot — a key that does nothing on a press is a dead key — but
 * tapping costs a full cast's mana for a quarter of its damage, which is the
 * whole argument for holding.
 */
export const CHARGE_TAP_SHARE = 0.25;
/** And the size of a tapped shot, of a full one: smaller, not a speck. */
const CHARGE_TAP_SIZE = 0.55;
/**
 * The weight a **full** charge lands with, whatever the item's own: doc 006
 * says a full charge staggers, so it is at least the stagger threshold
 * (`SPELL_STAGGER_WEIGHT`, 1.2) with room to shove. Anything short of full is
 * held under it, so the stagger belongs to the full charge alone.
 */
const CHARGE_FULL_WEIGHT = 2;
const CHARGE_PART_WEIGHT_MAX = 1.1;

/** What a `charge` spell's shot is multiplied by, at `share` of a full charge. */
export function chargeScale(share: number): number {
  const s = Math.max(0, Math.min(1, share));
  return CHARGE_TAP_SHARE + (1 - CHARGE_TAP_SHARE) * s;
}

/**
 * What every spell's damage is multiplied by, once, at the point a unit is
 * built.
 *
 * **The staff was not an option before the build came together.** Measured
 * against a pinned body: a sword chain deals 30 dps and the five style
 * starters dealt a third of that at level 1, so the only way to kill anything
 * early was to stand in reach of it, which is the one place a new player
 * cannot survive. A ranged answer that does a fifth of the damage is not a
 * safer choice, it is a worse one.
 *
 * A single scale rather than twenty-five edits, because the *relative* shape
 * of the pool is right and `spell-bench` guards it: that tool swings the
 * sword on the same pinned dummies for the same twenty seconds and reports
 * every spell as a fraction of it, so scaling the pool together moves the one
 * ratio that matters and nothing else.
 *
 * **3.6: big hits, thrown seldom.** A base spell is levelled to about seven
 * eighths of the sword's sustained damage — a real answer to the body in
 * front of you — and because a spell is thrown about once a second against
 * the sword's four swings, that means **each cast lands two to three swings'
 * worth at once**. Slow nukes land more; the bench caps them too.
 *
 * Three other numbers are set by this one and move with it:
 *
 * - `ENEMY_HP_SCALE` in `enemy.ts`. At the roster's old health a hit this
 *   size one-shot the first room, which is the regression this pool was
 *   reported for. The roster went up with the pool, so a first-room body is
 *   two or three casts and about five swings.
 * - `BURN_DPS` and `POISON_DPS_PER_STACK`, also in `enemy.ts`: this scale
 *   multiplies hits and no status, so a spell whose damage *is* its status
 *   falls out of the pool's band unless they move by the same factor.
 * - `SPELL_COST_BASE` in `spells.ts`. Damage per second is damage a hit times
 *   casts a second; the hit is pinned at the top by what a first-room body
 *   survives, so the only way to reach the sword's damage per second was to
 *   make a cast cheaper.
 *
 * What carries a spell *past* the sword is the build: a level is +20% damage
 * for +10% mana, and the pool's largest affixes are worth 1.5x to 1.7x each
 * and multiply (see the bench's `LADDER_FLOOR`).
 */
export const SPELL_DAMAGE_SCALE = 1.85;

/**
 * **What one hit of this spell is worth to everything that triggers on a
 * hit** — the element gauges, `brand`, `harvest` — as a multiple of one
 * ordinary hit. Risk of Rain 2's proc coefficient, adopted for its reason.
 *
 * Without it, the way to build *any* on-hit effect is to fire the most
 * pieces: a seven-pellet cone fills a poison gauge seven times faster than a
 * bolt of the same total damage, so `blight` on Scatter Shot is the best
 * version of every element build and the other twenty-four spells are the
 * wrong answer. The research names that exact pair as the likeliest runaway
 * in this pool (`docs/research/combat-balance-references.md`).
 *
 * So a hit's proc weight is roughly one over the number of pieces it lands,
 * a slow heavy cast is worth more than one, and a status tick is worth zero —
 * which is what stops a burn feeding the burn that lit it.
 */
export function procWeight(params: Readonly<Record<string, number | string>>, count: number): number {
  const pieces = Math.max(1, count);
  // A ring of blades hits the same body over and over for as long as it turns,
  // so each pass is worth least of all.
  // So does an orb, striking several times a second, and an enchant's wave,
  // thrown by every swing of a sword that swings four times a second.
  const shape = str(params, "shape", "bolt");
  const orbit = shape === "orbit" || shape === "orb" || shape === "enchant" ? 0.4 : 1;
  // A spell with a cooldown of its own is thrown seldom and lands heavy.
  const slow = num(params, "cooldown_scale", 1) >= 1.4 ? 1.5 : 1;
  return Math.max(PROC_MIN, Math.min(PROC_MAX, (1 / pieces) * orbit * slow));
}
/** A piece of a wide spread still counts for something; a nuke is capped. */
export const PROC_MIN = 0.15;
export const PROC_MAX = 1.5;
/** What a chained copy and a split shard carry, of the hit that made them. */
export const PROC_CHAIN = 0.3;
export const PROC_SPLIT = 0.5;

export interface FiredShot {
  readonly x: number;
  readonly y: number;
  readonly family: string;
}

/**
 * One cast of a spell, from an origin toward a target.
 *
 * `origin` is set when something other than the hand casts the spell — an
 * affix firing it free (`resonance`, `retort`, `slipstream`) or a `scatter`
 * side cast — and `target` is then where it was cast at: the body struck,
 * the body that hurt the player, the body dashed through, or a point off to
 * one side (`freeCastReach`). Such a cast was already aimed at a specific
 * place, so it gets no aim assist, no seek and no curve.
 *
 * **It is still the spell's own shape.** A free cast used to leave as a
 * projectile whatever the spell was, built from the item's params, and for
 * every shape whose speed is 0 that was a bolt standing still at the
 * caster's feet: measured, `scatter` III on Earth Spikes made twenty-five
 * motionless bolts, and `resonance` — the Blade style's own affix — on
 * Spirit Blades made five and did no damage at all. What each shape does
 * when it is cast *at* something is decided shape by shape below, each with
 * its reason. A projectile is unchanged: it leaves toward the target, as it
 * always did.
 */
export function fireUnit(
  world: World,
  item: ItemInstance,
  mods: ScopeMods,
  items: ItemRegistry,
  shots: FiredShot[],
  origin?: { x: number; y: number },
  target?: { x: number; y: number },
): void {
  const base = items.get(item.base);
  if (!base) return;
  const free = origin !== undefined;

  /*
   * A `charge` spell's shot grows with how long its key was held (doc 006):
   * damage and size from a fraction at a tap to the whole figure at a full
   * charge. Read off the scope, which the key fills in on release; a cast
   * nobody held — an echo of a full charge, a free cast — is full.
   */
  const charged = num(base.params, "charge", 0) > 0;
  const share = Math.max(0, Math.min(1, mods.charge));
  const chargeMult = charged ? chargeScale(share) : 1;
  /*
   * A sword-energy spell (`sword`, `swordShare` in items.ts) hits for that
   * many swings of the sword **as the build has it**, so `keen_edge` sharpens
   * its waves as it does the blade; every other spell for its own figure.
   */
  const swordK = num(base.params, "sword", 0);
  const damage = (swordK > 0 ? swordK * SWING_DAMAGE * (world.player.mods?.swordDamage ?? 1)
    : num(base.params, "damage") * SPELL_DAMAGE_SCALE) * mods.damageMult * chargeMult;
  /*
   * **What the build is worth, as a multiplier**: the spell's level and every
   * affix that multiplies its damage, without the pool-wide scale or
   * the spell's own base figure. Carried onto whatever this fires so the burn
   * or the poison it lights ticks as hard as the hit does — see
   * `Enemy.statusMult`. Without it a level was a straight loss on a spell
   * whose damage *is* its status: the hit it scaled was a tenth of the spell
   * and the mana it cost went up regardless.
   *
   * Times the spell's own `status_scale`: how hard its burn or poison ticks
   * against the roster's standard status. An Affliction spell's value is its
   * status, so this — not its hit — is the lever that sets its level, and
   * raising the hit instead would push the status share under the `dot` gate.
   */
  const statusMult = mods.damageMult * num(base.params, "status_scale", 1);
  /*
   * **Every element this cast carries, added together.** The spell's own
   * element and power, plus each element affix on the key — so `kindle` on
   * Ember Dart makes the burn gauge fill faster instead of replacing it, and
   * `kindle` beside `blight` is a shot that burns *and* poisons. There are no
   * reactions between them: each gauge is its own, each status its own clock.
   */
  const powers = noPowers();
  addPower(powers, str(base.params, "element", "none") as Element, num(base.params, "element_power", 1));
  addPowers(powers, mods.elements);
  // Fire only an affix brought: its burn stacks lower (`ElementPowers.borrowedFire`).
  if (powers.fire > 0 && str(base.params, "element", "none") !== "fire") powers.borrowedFire = true;
  const speed = num(base.params, "speed") * mods.speedMult;
  const radius = num(base.params, "radius") * mods.radiusMult
    * (charged ? CHARGE_TAP_SIZE + (1 - CHARGE_TAP_SIZE) * share : 1);
  /*
   * A `charges` spell looses every charge it banked (`volley`), in the
   * spell's own tight fan; everything else, and every free cast, fires the
   * item's own count.
   */
  const count = mods.volley > 0 ? Math.round(mods.volley) : Math.max(1, Math.round(num(base.params, "count", 1)));
  const spread = num(base.params, "spread", 0);
  const lifetime = num(base.params, "lifetime", 1.2);
  // What the renderer colours it with: the loudest of what it carries.
  const element = dominantElement(powers);
  /*
   * What one piece of this cast is worth to an on-hit effect; see
   * `procWeight`. Off the item's own count, not the volley: a banked dart is
   * the same dart as a tapped one, and a bank of five paying a fifth of a
   * gauge each would charge the player twice for waiting.
   */
  const proc = procWeight(base.params, Math.max(1, Math.round(num(base.params, "count", 1)))) * mods.procMult;
  /*
   * The shot's mass. A full charge staggers (doc 006), so it lands at least
   * at `CHARGE_FULL_WEIGHT`; anything short of full is held under the
   * stagger line, so a tap never interrupts a windup.
   */
  const itemWeight = num(base.params, "weight", 1);
  const weight = !charged ? itemWeight
    : share >= 1 ? Math.max(itemWeight, CHARGE_FULL_WEIGHT)
    : Math.min(itemWeight * chargeMult, CHARGE_PART_WEIGHT_MAX);

  const from = origin ?? world.player;
  const at = target ?? world.player.aim;
  const raw = normalise(at.x - from.x, at.y - from.y);
  // Player shots get the assist; a cast from an origin was already aimed at
  // a specific place, so bending it again would be aiming twice.
  const aim = free ? raw : assistAim(world, from.x, from.y, raw.x, raw.y);
  const baseAngle = Math.atan2(aim.y, aim.x) || 0;

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
   * A cast from an origin is exempt for the same reason it is exempt from the
   * assist: it was already cast at a specific place, and steering it again is
   * aiming twice.
   */
  /*
   * The spell's **shape**. Until this existed every attack was a projectile
   * and the pool differed in speed, count and colour; the shapes below are the
   * ones a projectile cannot be — see doc 006, "Shapes".
   *
   * - `orbit`: bodies that circle the player for the lifetime, hitting what
   *   they touch; damage that follows the body, not a target.
   * - `field`: a patch of burning ground at the seek target or ahead of the
   *   hand; ground denied for a while, which a shot cannot do.
   * - `pillar`: a solid raised between the player and what they face; cover
   *   the player can put where they want it.
   */
  const shape = str(base.params, "shape", "bolt");
  const seek = free ? 0 : num(base.params, "seek", 0);
  const curveDeg = free ? 0 : num(base.params, "curve", 0);
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
  // A lob is put somewhere too — on the body it seeks — though its shape is a bolt's.
  const lobbed = num(base.params, "lob", 0) > 0;
  const marks = !free && (seek > 0 || shape !== "bolt" || lobbed) ? seekTargets(world, from.x, from.y, aim.x, aim.y) : [];
  /*
   * Where a shape that is **put somewhere** goes — a field, a pull, a pillar,
   * the ground going off: for a free cast, the body (or the point) it was
   * cast at, which is what a `retort` or a `resonance` means by "at whatever
   * did it"; for a pressed one, the body the cast sought, if there is one.
   */
  const placed: { x: number; y: number } | null = free ? (target ?? null) : (marks[0] ?? null);

  /*
   * **A lob** (`lob`, Mortar): thrown in an arc to the body the cast sought,
   * or the aim's point at the spell's reach, over whatever stands between.
   * It touches nothing on the way and lands for the whole of its damage on
   * every body within `lob_radius` of where it comes down (`lobLand`).
   */
  if (shape === "bolt" && num(base.params, "lob", 0) > 0) {
    const reach = num(base.params, "reach", 160);
    const spot = placed ?? { x: from.x + aim.x * reach, y: from.y + aim.y * reach };
    const flight = num(base.params, "lob", 0) * 1000;
    for (let i = 0; i < count; i++) {
      const b = acquire(world.playerBullets, true);
      if (!b) return;
      // A volley of several lands in a small spread round the spot, not in one hole.
      const jitter = count > 1 ? ((i / (count - 1)) - 0.5) * num(base.params, "lob_spread", 36) : 0;
      const tx = spot.x - aim.y * jitter, ty = spot.y + aim.x * jitter;
      b.delivery = "lob";
      b.x = from.x; b.y = from.y; b.originX = from.x; b.originY = from.y;
      b.lobMs = flight * (1 + i * 0.12);
      b.lifeMs = b.lobMs;
      b.vx = (tx - from.x) / (b.lobMs / 1000);
      b.vy = (ty - from.y) / (b.lobMs / 1000);
      b.lobRadius = num(base.params, "lob_radius", 36) * mods.radiusMult;
      b.radius = radius;
      b.damage = damage;
      b.pierce = 0; b.bounce = 0; b.homing = 0;
      b.split = mods.split;
      b.affixes = mods.affixes;
      b.spellIndex = mods.spellIndex;
      b.manaSpent = mods.manaSpent;
      b.arcLeft = arcJumps(mods.affixes);
      b.element = element;
      b.elementPower = powers[element as "fire"] ?? 0;
      copyPowers(b.powers, powers);
      b.proc = proc;
      b.statusMult = statusMult;
      b.weight = weight;
      shots.push({ x: b.x, y: b.y, family: base.id });
    }
    return;
  }

  /*
   * **A beam** (`beam`): a line out along the aim that burns what it crosses
   * each tick (`stepBeams`). Pressed, it is channelled — held on its key for
   * up to its `lifetime`, following the caster and the aim; cast free, it is
   * a short flash at the body it was cast at. A press puts out whatever beam
   * the key had; a flash puts out nothing — the flashes a spin casts at three
   * bodies all burn at once, and one cast on being struck leaves the held
   * beam burning.
   */
  if (shape === "beam") {
    if (!free) for (const old of world.beams) if (old.alive && old.spellIndex === mods.spellIndex) old.alive = false;
    const reach = num(base.params, "reach", 200);
    const dir = free && target ? normalise(target.x - from.x, target.y - from.y) : aim;
    const beam = world.beams.find((x) => !x.alive) ?? (() => {
      const fresh = {
        alive: false, x0: 0, y0: 0, x1: 0, y1: 0, reach: 0, width: 0, damage: 0, tickMs: 0, clockMs: 0,
        lifeMs: 0, maxLifeMs: 0, channel: false, element: "none" as Element, powers: noPowers(), proc: 1,
        statusMult: 1, weight: 1, spellIndex: -1, angle: 0, drain: 0,
      };
      world.beams.push(fresh);
      return fresh;
    })();
    beam.alive = true;
    beam.x0 = from.x; beam.y0 = from.y;
    beam.x1 = from.x + dir.x * reach; beam.y1 = from.y + dir.y * reach;
    beam.reach = reach;
    beam.width = radius;
    beam.damage = damage;
    beam.tickMs = num(base.params, "tick_ms", 100);
    // The first tick at once: the line is seen to land as it appears.
    beam.clockMs = 0;
    beam.channel = !free;
    beam.lifeMs = free ? num(base.params, "flash_ms", 300) : lifetime * 1000;
    beam.maxLifeMs = beam.lifeMs;
    beam.element = element;
    copyPowers(beam.powers, powers);
    beam.proc = proc;
    beam.statusMult = statusMult;
    beam.weight = weight;
    beam.spellIndex = mods.spellIndex;
    // Pressed on the body it sought, if one; it turns after bodies from there (`stepBeams`).
    const lit = !free && marks[0] ? normalise(marks[0].x - from.x, marks[0].y - from.y) : dir;
    beam.angle = Math.atan2(lit.y, lit.x);
    beam.x1 = from.x + lit.x * reach; beam.y1 = from.y + lit.y * reach;
    // The press pays the key's cost; held, the bar pays `drain_per_s` on top for as long as it burns.
    beam.drain = free ? 0 : num(base.params, "drain_per_s", 0);
    // A channel the bar pays for by the second has no clock of its own: it lasts as long as the bar does.
    if (beam.drain > 0) { beam.lifeMs = Infinity; beam.maxLifeMs = Infinity; }
    if (!free && mods.spellIndex >= 0) world.player.channelKey = mods.spellIndex;
    world.events.push({ kind: "spell", x: from.x, y: from.y, what: "beam" });
    shots.push({ x: beam.x1, y: beam.y1, family: base.id });
    return;
  }

  if (shape === "orbit") {
    /*
     * One ring per key. A recast **renews** the blades rather than adding to
     * them: without this, every cast stacked three more and a held key built
     * a wall of steel round the body for as long as the mana lasted — which
     * is a build with no decision in it. The renewal is still worth casting
     * for: it resets the clock and puts the blades back where the body is.
     *
     * A free cast renews the ring too, round the caster, exactly as a press
     * does: the blades are the caster's, not the target's, and a ring left
     * turning round a body the sword just struck would be a second spell.
     * So `resonance` on Spirit Blades keeps the ring up for as long as the
     * sword keeps landing, which is the Blade style's whole plan.
     */
    /*
     * **A stacking ring** (`stack_max`, Blade Storm) is the exception: each
     * cast adds its blades to the ring, up to the cap, past which the oldest
     * go, and **each blade keeps its own time**: a press is one more blade,
     * not the whole ring renewed, so a ring stops growing and thins out the
     * moment the key stops being pressed. The ring is re-spaced evenly each time, so
     * it reads as one ring growing rather than as blades piling up, and it
     * widens and quickens with each blade (`orbit_grow`, `spin_grow`).
     *
     * A press on a full ring takes the place of its oldest blade, which
     * dissolves (`orbit_fade`) and deals nothing: a full ring is kept full by
     * pressing, never cashed in, so pressing at the cap is not a free blow.
     */
    const stackMax = Math.round(num(base.params, "stack_max", 0));
    const ring = world.playerBullets.filter((b) => b.alive && b.orbitMs > 0 && b.spellIndex === mods.spellIndex);
    let kept: typeof ring = [];
    if (stackMax > 0) {
      kept = ring.sort((a, b) => b.orbitMs - a.orbitMs).slice(0, Math.max(0, stackMax - count));
      for (const b of ring) if (!kept.includes(b)) {
        b.alive = false;
        world.events.push({ kind: "spell", x: b.x, y: b.y, what: "orbit_fade" });
      }
    } else for (const b of ring) b.alive = false;
    const total = kept.length + count;
    const grown = stackMax > 0 ? Math.max(0, total - 1) : 0;
    // The ring's reach is its own: a larger spell (`expanse`) has larger blades, and a ring pushed out would leave the bodies at arm's length.
    const orbitRadius = num(base.params, "orbit_radius", 40) + grown * num(base.params, "orbit_grow", 0);
    const spin = num(base.params, "spin", 300) + grown * num(base.params, "spin_grow", 0);
    /*
     * **An anchored ring** (`anchor_reach`, Blade Rift) turns round a point
     * on the floor — the body the cast sought, or the aim's point at the
     * reach; cast free, the body it was cast at — instead of round the caster.
     */
    const anchorReach = num(base.params, "anchor_reach", 0);
    const anchor = anchorReach > 0
      ? (placed ?? { x: from.x + aim.x * anchorReach, y: from.y + aim.y * anchorReach })
      : null;
    const cx = anchor?.x ?? world.player.x, cy = anchor?.y ?? world.player.y;
    const start = kept[0]?.orbitAngle ?? world.player.facing;
    const arm = (b: (typeof ring)[number]): void => {
      b.orbitRadius = orbitRadius;
      b.orbitDegPerS = spin;
    };
    kept.forEach((b, k) => {
      b.orbitAngle = start + (k / total) * Math.PI * 2;
      arm(b);
    });
    for (let i = 0; i < count; i++) {
      const b = acquire(world.playerBullets, true);
      if (!b) return;
      const angle = start + ((kept.length + i) / total) * Math.PI * 2;
      b.orbitMs = lifetime * 1000;
      b.orbitAngle = angle;
      arm(b);
      b.rehitMs = 0;
      b.anchored = anchor !== null;
      b.orbitX = cx;
      b.orbitY = cy;
      b.x = cx + Math.cos(angle) * orbitRadius;
      b.y = cy + Math.sin(angle) * orbitRadius;
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
      /*
       * A blade chains as a shot does: `chain` says it fits an orbit, and at
       * zero the blades carried the affix and never released a copy. The
       * blade keeps its count — a ring is not spent by a hit — so each cut
       * on a body releases one lesser copy at the next, on the rehit clock.
       */
      b.arcLeft = arcJumps(mods.affixes);
      b.element = element;
      // An affix's element brings its own power; a spell's own element, the spell's.
      b.elementPower = powers[element as "fire"] ?? 0;
      copyPowers(b.powers, powers);
      b.proc = proc;
      b.statusMult = statusMult;
      shots.push({ x: b.x, y: b.y, family: base.id });
    }
    return;
  }

  if (shape === "field") {
    // A free cast lights the ground under the body it was cast at: the patch
    // is where the fight is, which is where a pressed cast puts it too.
    const reach = num(base.params, "reach", 120);
    const spot = placed
      ? { x: placed.x, y: placed.y }
      : { x: from.x + aim.x * reach, y: from.y + aim.y * reach };
    /*
     * **The element decides what the ground does** (doc 006): a fire field
     * burns what stands in it and a poison field is a cloud that poisons and
     * slows it (`resolveFires`). Either does its own element by its nature,
     * so what it carries on top of that is only what the key's affixes add:
     * `kindle` makes a burning patch burn faster, `blight` a cloud poison
     * harder, and the spell's own element is already the ground's.
     */
    const kind = groundOf(base.params);
    const ground = clonePowers(powers);
    ground[kind] = mods.elements[kind];
    lightFire(world, spot.x, spot.y, "player", {
      radius, lifeMs: lifetime * 1000, damage, statusMult, powers: ground, proc, element: kind,
    });
    shots.push({ x: spot.x, y: spot.y, family: base.id });
    return;
  }

  if (shape === "boomerang" && num(base.params, "lodge_max", 0) > 0) {
    /*
     * **The blades come home** (`lodge_max`, Blade Recall; `recall.ts`):
     * every blade the sword left out for this key rips free at once — a cut
     * on the body it was in, as it leaves — and flies to the caster as a
     * boomerang already on its way back, through everything between. Cast
     * free with no blade out, as a `resonance` may be, it does nothing.
     */
    for (const lodged of takeLodged(world, mods.spellIndex)) {
      const b = acquire(world.playerBullets, true);
      if (!b) return;
      const home = normalise(world.player.x - lodged.x, world.player.y - lodged.y);
      b.delivery = "boomerang";
      b.returning = true;
      b.x = lodged.x;
      b.y = lodged.y;
      b.originX = lodged.x;
      b.originY = lodged.y;
      b.launchSpeed = speed;
      b.returnSpeed = num(base.params, "return_speed", speed) * mods.speedMult;
      b.vx = home.x * speed * 0.35;
      b.vy = home.y * speed * 0.35;
      b.outPx = 0;
      b.outLeftPx = 0;
      b.radius = radius;
      b.damage = damage;
      b.lifeMs = Math.max(lifetime * 1000, 400);
      b.pierce = 1e9;
      b.bounce = 0;
      b.homing = 0;
      b.split = 0;
      b.affixes = mods.affixes;
      b.spellIndex = mods.spellIndex;
      b.manaSpent = mods.manaSpent;
      b.weight = weight;
      b.arcLeft = arcJumps(mods.affixes);
      b.element = element;
      b.elementPower = powers[element as "fire"] ?? 0;
      copyPowers(b.powers, powers);
      b.proc = proc;
      b.statusMult = statusMult;
      world.events.push({ kind: "shot", x: lodged.x, y: lodged.y, what: "recall" });
      shots.push({ x: b.x, y: b.y, family: base.id });
    }
    return;
  }

  if (shape === "boomerang") {
    /*
     * **A blade thrown out and caught again** (doc 006): toward the body the
     * cast sought — or, cast free, the body the hook names — and along the
     * aim with nothing sought. It flies `reach` px, slowing, turns, and comes
     * back to where the caster is by then (`stepBoomerangs`), cutting each
     * body once on the way out and once on the way back. It passes through
     * every body, so it carries no pierce, split or bounce of a shot's.
     */
    const at = free ? (target ?? null) : (marks[0] ?? null);
    const dir = at ? normalise(at.x - from.x, at.y - from.y) : aim;
    const angle0 = Math.atan2(dir.y, dir.x);
    const reach = num(base.params, "reach", 110);
    for (let i = 0; i < count; i++) {
      const offset = count === 1 ? 0 : ((i / (count - 1)) - 0.5) * (spread * Math.PI) / 180;
      const b = acquire(world.playerBullets, true);
      if (!b) return;
      b.delivery = "boomerang";
      b.x = from.x;
      b.y = from.y;
      b.originX = from.x;
      b.originY = from.y;
      b.vx = Math.cos(angle0 + offset) * speed;
      b.vy = Math.sin(angle0 + offset) * speed;
      b.launchSpeed = speed;
      b.returnSpeed = num(base.params, "return_speed", speed) * mods.speedMult;
      b.outPx = reach;
      b.outLeftPx = reach;
      b.returning = false;
      b.radius = radius;
      b.damage = damage;
      // A backstop only: the blade ends when it is caught.
      b.lifeMs = Math.max(lifetime * 1000, 400);
      b.pierce = 1e9;
      b.bounce = 0;
      b.homing = 0;
      b.split = 0;
      b.affixes = mods.affixes;
      b.spellIndex = mods.spellIndex;
      b.manaSpent = mods.manaSpent;
      b.weight = weight;
      b.arcLeft = arcJumps(mods.affixes);
      b.element = element;
      b.elementPower = powers[element as "fire"] ?? 0;
      copyPowers(b.powers, powers);
      b.proc = proc;
      b.statusMult = statusMult;
      shots.push({ x: b.x, y: b.y, family: base.id });
    }
    return;
  }

  if (shape === "orb") {
    /*
     * **A slow orb that strikes on its own clock** (doc 006): thrown toward
     * the body the cast sought, or cast free toward the body the hook names,
     * drifting at the spell's `speed`, and striking the nearest body within
     * `zap_reach` every `zap_ms` (`stepOrbs`). It deals no contact damage —
     * nothing touches it — so its damage is its strikes. At most `max_alive`
     * from one key: a new one replaces that key's oldest.
     */
    const at = free ? (target ?? null) : (marks[0] ?? null);
    const dir = at ? normalise(at.x - from.x, at.y - from.y) : aim;
    const max = Math.max(1, Math.round(num(base.params, "max_alive", 3)));
    const mine = world.orbs.filter((o) => o.alive && o.spellIndex === mods.spellIndex).sort((a, b) => a.born - b.born);
    while (mine.length >= max) mine.shift()!.alive = false;
    const orb = world.orbs.find((o) => !o.alive) ?? world.orbs.reduce((a, b) => (a.born <= b.born ? a : b));
    // Where it leaves the hand, or where a still one is set down (`place_px`): clear of the caster's body.
    const off = num(base.params, "place_px", ORB_OFFSET_PX);
    const x = from.x + dir.x * off, y = from.y + dir.y * off;
    const clear = hasLineOfSight(world.room.grid, from.x, from.y, x, y);
    const zapMs = num(base.params, "zap_ms", 300);
    orb.alive = true;
    orb.x = clear ? x : from.x;
    orb.y = clear ? y : from.y;
    orb.vx = dir.x * speed;
    orb.vy = dir.y * speed;
    orb.radius = radius;
    orb.lifeMs = lifetime * 1000;
    orb.maxLifeMs = orb.lifeMs;
    // The first strike half a beat after it leaves the hand, so it is seen
    // to arrive before it strikes.
    orb.zapClockMs = zapMs * 0.5;
    orb.zapMs = zapMs;
    orb.zapReach = num(base.params, "zap_reach", 90) * mods.radiusMult;
    orb.zapCount = Math.max(1, Math.round(num(base.params, "zap_count", 1)));
    orb.damage = damage;
    orb.element = element;
    orb.elementPower = powers[element as "fire"] ?? 0;
    copyPowers(orb.powers, powers);
    orb.proc = proc;
    orb.statusMult = statusMult;
    orb.affixes = mods.affixes;
    orb.echo = world.castingEcho === true;
    orb.spellIndex = mods.spellIndex;
    orb.manaSpent = mods.manaSpent;
    orb.born = world.tick;
    orb.lastTargetId = -1;
    orb.lastTargetIds = [];
    world.events.push({ kind: "spell", x: orb.x, y: orb.y, what: "orb" });
    shots.push({ x: orb.x, y: orb.y, family: base.id });
    return;
  }

  /*
   * The three shapes that run **on the caster** (doc 006): a trail under
   * their feet, an enchant on their sword, a stance in their guard. A cast of
   * any of them — pressed, echoed or free (`retort`, `slipstream`,
   * `resonance`) — starts it on the caster, or renews the one already
   * running: there is one of each per caster, and the hook's body says
   * nothing about where a thing on the caster goes.
   */
  if (shape === "trail") {
    const p = world.player;
    const ms = num(base.params, "trail_ms", 4000);
    const kind = groundOf(base.params);
    const ground = clonePowers(powers);
    ground[kind] = mods.elements[kind];
    p.trail = {
      ms, maxMs: ms,
      dropPx: Math.max(4, num(base.params, "drop_px", 18)),
      // A renewal keeps the distance already walked toward the next patch.
      carriedPx: p.trail?.carriedPx ?? 0,
      lastX: p.x, lastY: p.y,
      patch: { radius, lifeMs: num(base.params, "patch_ms", 1500), damage, statusMult, powers: ground, proc, element: kind },
      spellIndex: mods.spellIndex,
    };
    world.events.push({ kind: "spell", x: p.x, y: p.y, what: "trail" });
    shots.push({ x: p.x, y: p.y, family: base.id });
    return;
  }

  if (shape === "enchant") {
    const p = world.player;
    const ms = num(base.params, "enchant_ms", 5000);
    p.enchant = {
      ms, maxMs: ms, damage, radius, speed: Math.max(1, speed), reachPx: num(base.params, "wave_reach", 90) * mods.radiusMult,
      weight, element, elementPower: powers[element as "fire"] ?? 0, powers: clonePowers(powers), proc, statusMult,
      affixes: mods.affixes, spellIndex: mods.spellIndex, manaSpent: mods.manaSpent,
    };
    world.events.push({ kind: "spell", x: p.x, y: p.y, what: "enchant" });
    shots.push({ x: p.x, y: p.y, family: base.id });
    return;
  }

  if (shape === "stance") {
    /*
     * **A guard** (doc 006). For `stance_ms` the caster is slowed and the
     * sword is put away — a swing in progress ends here — and the first
     * enemy hit that would land is cancelled and answered (`answerStance` in
     * `world.ts`). A renewal starts the guard's clock again and keeps it one
     * guard: it never answers twice.
     */
    const p = world.player;
    const ms = num(base.params, "stance_ms", 700);
    p.swingMs = 0;
    world.swing.active = false;
    p.stance = {
      ms, maxMs: ms, damage, radius: num(base.params, "answer_radius", 56) * mods.radiusMult,
      expireShare: Math.max(0, Math.min(1, num(base.params, "expire_share", 0.4))),
      moveScale: num(base.params, "move_scale", 0.5), weight: Math.max(weight, STANCE_WEIGHT),
      element, powers: clonePowers(powers), proc, statusMult, spellIndex: mods.spellIndex,
    };
    world.events.push({ kind: "spell", x: p.x, y: p.y, what: "stance" });
    shots.push({ x: p.x, y: p.y, family: base.id });
    return;
  }

  if (shape === "dash") {
    const land = Math.round(num(base.params, "land", 0));
    if (free) {
      /*
       * **A free dash is its cut, delivered at the body, and the player
       * stays where they are.** A sword hit that threw the player at the
       * body it struck, or a hurt that flung them at the attacker, would be
       * the game moving the player's body under their hands; that is never
       * a spell's to do. So `resonance` on Blink Strike cuts the body the
       * sword just hit.
       *
       * A `land` spell's free cast is the same cut, of its landing's damage,
       * and **not** the ring: the ring is what a leap into the pack buys,
       * and a free ring round every point a `scatter` aims at was five
       * landings for one press — measured, a finished Leap Slam went to
       * seven times the sword on a pack, past the bench's ceiling.
       */
      const spot = target ?? from;
      world.freeStrikes.push({
        x: spot.x, y: spot.y, radius: radius + PLAYER_RADIUS, damage, element,
        powers: clonePowers(powers), proc, statusMult, spellIndex: mods.spellIndex,
      });
      shots.push({ x: spot.x, y: spot.y, family: base.id });
      return;
    }
    const p = world.player;
    if (p.dashMs > 0 || p.strikeMs > 0) return;
    const mark = marks[0] ?? null;
    const dir = mark ? normalise(mark.x - from.x, mark.y - from.y) : aim;
    let ms = lifetime * 1000;
    if (land > 0) {
      /*
       * **A leap goes to the body and no further** (doc 006): the travel is
       * cut to what reaches the body the spell sought, stopping a body's
       * width short so the player lands against it rather than inside it,
       * and the ring waits for the landing (`Player.landing`). With nothing
       * sought it goes its full length along the aim and lands there.
       */
      if (mark) {
        const body = world.enemies.find((e) => e.id === mark.id);
        const gap = Math.hypot(mark.x - from.x, mark.y - from.y) - (body?.radius ?? 10) - PLAYER_RADIUS;
        const speedPx = DASH_SPEED * p.mods.dashRange;
        ms = Math.max(LAND_MIN_MS, Math.min(ms, (gap / Math.max(1, speedPx)) * 1000));
      }
      p.landing = landingOf(base, damage, radius, weight, element, powers, proc, statusMult, mods.spellIndex, land);
    } else p.landing = null;
    p.dashMs = ms;
    p.dashX = dir.x;
    p.dashY = dir.y;
    // Mercy frames outlast the travel, as the dash's do: arriving is the
    // moment the body is most exposed.
    p.dashIframeMs = ms + 120;
    p.strikeMs = ms;
    // A leap is in the air: it cuts nothing on the way, and its damage is
    // the ring it lands in.
    p.strikeDamage = land > 0 ? 0 : damage;
    p.strikeSpell = mods.spellIndex;
    p.strikeRadius = radius;
    p.strikeElement = element;
    p.strikeElementPower = powers[element as "fire"] ?? 0;
    copyPowers(p.strikePowers, powers);
    p.strikeProc = proc;
    p.strikeStatusMult = statusMult;
    p.strikeHits.length = 0;
    /*
     * **A Dash Slash** (`wake_reach`): the sword held out ahead through the
     * run, and either side of it the cut's edge rolls off the line, laid a
     * stretch at a time as the player passes (`layWake`) — each body it
     * crosses is cut once by the wake, at `wake_share` of the run's cut.
     */
    const wakeReach = land > 0 ? 0 : num(base.params, "wake_reach", 0) * mods.radiusMult;
    p.strikeWake = wakeReach > 0 ? startWake(from.x, from.y, dir.x, dir.y, {
      stepPx: num(base.params, "wake_step", 10), reachPx: wakeReach, inner: PLAYER_RADIUS,
      thick: num(base.params, "wake_thick", 12), speed: num(base.params, "wake_speed", 240), damage: 0,
    }, {
      damage: damage * num(base.params, "wake_share", 0.5), element, powers: clonePowers(powers), proc, statusMult,
      spellIndex: mods.spellIndex, hits: [], knock: num(base.params, "knock", 0), weight, runDamage: damage,
      ...runAffixes(mods.affixes),
    }) : null;
    p.facing = Math.atan2(dir.y, dir.x);
    shots.push({ x: from.x, y: from.y, family: base.id });
    return;
  }

  if (shape === "eruption") {
    /*
     * **The ground goes off**, cell by cell: a line of `count` cells along
     * the aim — toward the body it seeks, if one is in the cone — starting a
     * little in front of the hand and a `step` of tiles apart, each a beat
     * (`delay_ms`) after the last, stopping at the first wall; or, as a
     * `scatter`, the same cells burst round the target inside `area` tiles,
     * each on its own beat; or, as a `ring`, `count` rings round the caster
     * (see `eruptRing`). Stone spikes or columns of fire: the pool's first
     * spells that are neither a shot nor a thing at the player's side.
     *
     * A free cast is aimed by its target: a line runs from the caster toward
     * it, and a scatter or a ring is centred on it — the body the sword hit,
     * the body that hurt the player.
     *
     * With `telegraph_ms` every cell is marked on the floor first and goes
     * off that much later (doc 006): the body can walk out of the mark, and
     * that risk is what the size of the hit is paid for with.
     */
    const pattern = str(base.params, "pattern", "line");
    const telegraph = Math.max(0, num(base.params, "telegraph_ms", 0));
    const kind = str(base.params, "eruption", "earth") === "fire" ? "fire" : "earth";
    const stepPx = num(base.params, "step", 1) * TILE_PX;
    const first = num(base.params, "first", 1.2) * TILE_PX;
    const delay = num(base.params, "delay_ms", 70);
    const spec: Landing = {
      damage, radius, rings: count, first, step: stepPx, delayMs: delay,
      spacing: num(base.params, "ring_spacing", RING_CELL_SPACING), weight, kind, element,
      elementPower: powers[element as "fire"] ?? 0, powers, proc, statusMult,
      burnMs: num(base.params, "burn_ms", 0), spellIndex: mods.spellIndex,
    };
    if (pattern === "ring") {
      /*
       * Round the caster, or round the body the spell seeks when it seeks
       * one (a `seek` above zero, doc 006); a free cast round the body it was
       * cast at.
       */
      const centre = free ? (target ?? from) : (seek > 0 && marks[0] ? marks[0] : from);
      eruptRing(world, centre, spec, telegraph);
      shots.push({ x: centre.x, y: centre.y, family: base.id });
      return;
    }
    const scatter = pattern === "scatter";
    /*
     * **A landing from above seeks the whole screen** (Meteor). A scatter with
     * a telegraph is a rock coming down out of the sky onto a marked spot, so
     * a wall between has nothing to say about where it can land, and the seek
     * cone only says which bodies come first: the nearest body in the cone,
     * and failing one, the body on screen nearest the aim (`screenTargets`).
     *
     * Reported as "no rock came down at all": the cone chose bodies behind
     * pillars and, with nothing in it, aimed `reach` tiles ahead through a
     * near wall; the line of sight below then refused the only cell, and the
     * cast spent its mana on nothing. With no body on screen it still lands
     * on the ground ahead, short of the first wall.
     */
    const sky = scatter && telegraph > 0;
    /*
     * A scatter out of the floor (Cinder Geysers) still needs the caster's
     * sight, so it takes the first body in the cone it can see: the cone's
     * best could stand behind a pillar, and every cell round it was refused.
     */
    /*
     * **Every rock seeks on its own.** A rock cast at a body — `resonance`'s
     * body struck, `retort`'s attacker — comes down on that body. Any other
     * seeks: a press along the aim, and a `scatter` side cast, which is aimed
     * at a bare point out along its own direction, along that direction and
     * only inside its cone, so a rock thrown behind lands behind and not on
     * the body in front. It used to land on the bare point whatever stood
     * beside it. And a body a rock is already marked on comes after every
     * body that is not, so the press and its side casts — or an echo coming
     * down while the first is — spread over the room instead of stacking on
     * one body; with no other body they stack.
     */
    const atBody = free && target !== undefined && world.enemies.includes(target as Enemy);
    const skyMark = (): { x: number; y: number } | null => {
      const ranked = screenTargets(world, from.x, from.y, aim.x, aim.y, free);
      // Nothing on screen: a side cast lands on its point, a press on the ground ahead (below).
      return ranked.find((t) => !underRock(world, t)) ?? ranked[0] ?? (free ? placed : null);
    };
    const mark = sky && !atBody ? skyMark()
      : free ? placed
        : scatter ? marks.find((m) => hasLineOfSight(world.room.grid, from.x, from.y, m.x, m.y)) ?? null
          : placed;
    const dir = mark ? normalise(mark.x - from.x, mark.y - from.y) : aim;
    const angle0 = Math.atan2(dir.y, dir.x);
    /*
     * A free line starts no further out than the body it was cast at: a
     * `slipstream` fires while the caster is inside the body, and a line
     * whose first cell stood a tile beyond it went off everywhere but there.
     */
    const lineFirst = free && target ? Math.min(first, Math.hypot(target.x - from.x, target.y - from.y)) : first;
    const cells: { x: number; y: number; delayMs: number }[] = [];
    // A scatter bursts round the body it seeks — or `reach` tiles ahead — the
    // first cell on the spot and the rest thrown about it, each on its own beat.
    let reach = num(base.params, "reach", 4) * TILE_PX;
    if (scatter && !mark) {
      const full = reach;
      while (reach > 0 && !hasLineOfSight(world.room.grid, from.x, from.y, from.x + dir.x * reach, from.y + dir.y * reach))
        reach -= TILE_PX / 2;
      // The last point the sight reaches is the wall's face: half a tile back, so the rock lands on the floor.
      if (reach < full) reach = Math.max(0, reach - TILE_PX / 2);
    }
    const centre = mark ? { x: mark.x, y: mark.y } : { x: from.x + dir.x * reach, y: from.y + dir.y * reach };
    const area = num(base.params, "area", 1.6) * TILE_PX * mods.radiusMult;
    for (let i = 0; i < count; i++) {
      let x = from.x + Math.cos(angle0) * (lineFirst + i * stepPx), y = from.y + Math.sin(angle0) * (lineFirst + i * stepPx);
      let wait = i * delay;
      if (scatter) {
        const a = world.rng.next() * Math.PI * 2, r = i === 0 ? 0 : area * Math.sqrt(world.rng.next());
        x = centre.x + Math.cos(a) * r;
        y = centre.y + Math.sin(a) * r;
        wait = i === 0 ? 0 : world.rng.next() * delay * count;
      }
      // A rock from above needs only floor to land on; anything else needs the caster's sight.
      if (sky ? !onFloor(world, x, y) : !hasLineOfSight(world.room.grid, from.x, from.y, x, y)) {
        if (scatter) continue;
        break;
      }
      cells.push({ x, y, delayMs: wait + telegraph });
    }
    placeCells(world, cells, spec, scatter ? 0 : world.nextEruptionCast++, telegraph);
    shots.push({ x: from.x + dir.x * first, y: from.y + dir.y * first, family: base.id });
    return;
  }

  if (shape === "vortex") {
    // A free cast opens the pull under the body it was cast at, as a press
    // opens it under the body it seeks.
    const reach = num(base.params, "reach", 110);
    const spot = placed ? { x: placed.x, y: placed.y } : { x: from.x + aim.x * reach, y: from.y + aim.y * reach };
    let slot = world.vortices.find((v) => !v.alive);
    if (!slot) slot = world.vortices.reduce((a, b) => (a.lifeMs <= b.lifeMs ? a : b));
    slot.alive = true;
    slot.x = spot.x;
    slot.y = spot.y;
    slot.radius = radius;
    slot.lifeMs = lifetime * 1000;
    slot.maxLifeMs = slot.lifeMs;
    slot.pull = num(base.params, "pull", 140);
    slot.tickMs = 0;
    slot.damage = damage;
    slot.element = element;
    slot.elementPower = powers[element as "fire"] ?? 0;
    copyPowers(slot.powers, powers);
    slot.proc = proc;
    slot.statusMult = statusMult;
    slot.spellIndex = mods.spellIndex;
    slot.echo = world.castingEcho === true;
    // `collapse` (doc 006): what the pull deals as it ends, scaled as its hits are.
    slot.collapseDamage = num(base.params, "collapse_damage", 0) * mods.damageMult * SPELL_DAMAGE_SCALE;
    shots.push({ x: spot.x, y: spot.y, family: base.id });
    return;
  }

  if (shape === "summon") {
    // One companion at a time: a recast renews it rather than adding another,
    // so the spell is a presence to keep up, not a swarm to stack. A free
    // cast renews it too, beside the caster: the companion follows the
    // player, and one called to the body the sword struck would only walk back.
    let pet = world.pets.find((x) => x.alive) ?? world.pets.find((x) => !x.alive);
    if (!pet) pet = world.pets[0]!;
    const fresh = !pet.alive;
    pet.alive = true;
    if (fresh) {
      pet.x = world.player.x - aim.x * 18;
      pet.y = world.player.y - aim.y * 18;
      pet.vx = 0;
      pet.vy = 0;
      pet.facing = world.player.facing;
    }
    pet.lifeMs = lifetime * 1000;
    pet.maxLifeMs = pet.lifeMs;
    pet.echo = world.castingEcho === true;
    pet.fireMs = 300;
    pet.intervalMs = num(base.params, "interval", 0.7) * 1000;
    pet.damage = damage;
    pet.element = element;
    pet.elementPower = powers[element as "fire"] ?? 0;
    copyPowers(pet.powers, powers);
    pet.proc = proc;
    pet.statusMult = statusMult;
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
    const reach = num(base.params, "reach", 64);
    // Between the player and what they face, a couple of tiles out: where a
    // shield goes, not where a shot goes. A free cast puts it between the
    // caster and the body it was cast at, for the same reason.
    const spot = placed
      ? { x: from.x + (placed.x - from.x) * 0.45, y: from.y + (placed.y - from.y) * 0.45 }
      : { x: from.x + aim.x * reach, y: from.y + aim.y * reach };
    const bodies = [
      { x: world.player.x, y: world.player.y, radius: 8 },
      ...world.enemies.filter((e) => e.hp > 0).map((e) => ({ x: e.x, y: e.y, radius: e.radius })),
    ];
    const pillar = raisePillar(world.room.grid, spot.x, spot.y, bodies, lifetime * 1000);
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
      slot.radius = PILLAR_SHOCK_RADIUS * mods.radiusMult;
      slot.lifeMs = 250;
      slot.maxLifeMs = 250;
      slot.pull = -420;
      slot.tickMs = 0;
      // The unit's own damage, scale and flat additions included, like every other shape.
      slot.damage = damage;
      slot.spellIndex = mods.spellIndex;
      slot.collapseDamage = 0;
      /*
       * And the cast's elements. The shove's slot was left holding whatever
       * the last vortex out of it carried, so `kindle`, `rime` and `blight` —
       * which say they fit every shape — did nothing on a ward, and a ward
       * raised after a Void Maw could chill with an element it never had.
       */
      slot.element = element;
      slot.elementPower = powers[element as "fire"] ?? 0;
      copyPowers(slot.powers, powers);
      slot.proc = proc;
      slot.statusMult = statusMult;
    }
    return;
  }

  /*
   * The bolt's options (doc 006), read once for every shot of the cast: the
   * mark a `doom` shot leaves, the shards an `emit` shot throws, the poison a
   * `contagion` shot passes on. Each is scaled as the hit is, so a level and
   * a damage affix raise the payoff along with the shot.
   */
  const doomMs = num(base.params, "doom", 0);
  const doomDamage = num(base.params, "doom_damage", 0) * mods.damageMult * SPELL_DAMAGE_SCALE * chargeMult;
  const doomRadius = num(base.params, "doom_radius", DOOM_RADIUS);
  const emitMs = num(base.params, "emit_ms", 0);
  const emitRing = Math.round(num(base.params, "emit", 0));
  const emitDamage = num(base.params, "emit_damage", 0) * mods.damageMult * SPELL_DAMAGE_SCALE * chargeMult;
  const contagion = Math.round(num(base.params, "contagion", 0));
  const contagionReach = num(base.params, "contagion_reach", CONTAGION_REACH);

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
    /*
     * **The arc always closes on its mark.** Thrown its whole `curve` off the
     * line at a body two tiles away, a shot turning at its `seek` rate had
     * turned back a third of the way by the time it drew level, and passed
     * it: an ember dart at close range missed every time and flew on into the
     * wall. A quadratic arc turns back through twice its launch angle over the
     * flight, so the launch is capped at half what the turn rate covers in
     * the time the shot takes to get there; far off the arc is the spell's
     * own, close in it straightens.
     */
    const flightS = mark ? Math.hypot(mark.x - from.x, mark.y - from.y) / Math.max(1, speed) : 0;
    const swingDeg = Math.min(curveDeg, (seek * flightS) / 2);
    const swing = mark ? (i % 2 === 0 ? 1 : -1) * (swingDeg * Math.PI) / 180 : 0;
    /*
     * **A single shot leaves toward the body it seeks.** The attacks snap to
     * four directions, so a bolt launched along the facing had to be turned
     * in flight onto anything off the axis — and a shot's homing was its
     * aim, strong on every bolt alike. Launched at its mark, a shot only
     * corrects in flight, as weakly as it is meant to: lightning holds on
     * hard, a bolt barely, and a body that moves can step out of it. A
     * spread keeps the facing, and does not seek at all.
     */
    const launch = mark && count === 1 ? Math.atan2(mark.y - from.y, mark.x - from.x) : baseAngle + offset;
    const angle = launch + swing;
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
    b.homing = mods.homing;
    b.split = Math.round(mods.split);
    // What the casting spell had attached, so the hit, kill and death hooks
    // can find it on the projectile itself. See `affix-hooks.ts`.
    b.affixes = mods.affixes;
    b.spellIndex = mods.spellIndex;
    b.weight = weight;
    b.manaSpent = mods.manaSpent;
    // A spell may chain on its own account as well as by affix; see the
    // `chain` param on the attack items and `onHit` in `affix-hooks.ts`.
    b.arcLeft = arcJumps(mods.affixes) + Math.round(num(base.params, "chain", 0));
    b.element = element;
    // An affix's element brings its own power; a spell's own element, the spell's.
    b.elementPower = powers[element as "fire"] ?? 0;
    copyPowers(b.powers, powers);
    b.proc = proc;
    b.statusMult = statusMult;
    b.doomMs = doomMs;
    b.doomDamage = doomDamage;
    b.doomRadius = doomRadius;
    b.emitMs = emitMs;
    b.emitClock = emitMs;
    b.emitAngle = angle;
    b.emitDamage = emitDamage;
    b.emitRing = emitRing;
    b.contagion = contagion;
    b.contagionReach = contagionReach;
    shots.push({ x: b.x, y: b.y, family: base.id });
  }
}

/**
 * The least a stance's answer weighs: doc 006 says it staggers what it cuts,
 * so it lands at the stagger line (`SPELL_STAGGER_WEIGHT`, 1.2) whatever the
 * item's own weight.
 */
const STANCE_WEIGHT = 1.2;

/** What a `field` or a `trail` lays: poison ground for a poison spell, fire for every other (doc 006). */
export function groundOf(params: Readonly<Record<string, number | string>>): "fire" | "poison" | "ice" {
  const el = str(params, "element", "none");
  return el === "poison" ? "poison" : el === "ice" ? "ice" : "fire";
}

/** How wide a `doom` mark bursts, in px from the marked body, where the spell does not say. */
export const DOOM_RADIUS = 40;
/** How far a `contagion` poison jumps from the body that died, where the spell does not say. */
export const CONTAGION_REACH = 96;
/**
 * **The run's own affixes** (`momentum`, `undertow`, `finale`), read once at
 * the cast into the wake's figures: how far each cut carries the run on,
 * whether the wake draws in, and what the run throws when it stops.
 */
function runAffixes(affixes: readonly AttachedAffix[]): Pick<PlayerWakeCut,
  "momentumPx" | "momentumLeft" | "pull" | "finaleShare" | "finaleReach"> {
  const out = { momentumPx: 0, momentumLeft: 0, pull: 0, finaleShare: 0, finaleReach: 0 };
  for (const a of affixes) {
    const e = effectOf(a);
    if (e?.kind === "momentum") { out.momentumPx = e.px; out.momentumLeft = e.times; }
    if (e?.kind === "undertow") out.pull = e.pull;
    if (e?.kind === "finale") { out.finaleShare = e.share; out.finaleReach = e.reachPx; }
  }
  return out;
}

/**
 * The shortest leap: a body standing against the caster is still a leap, not
 * a ring cast on the spot, so the untouchable air time is never nothing.
 */
const LAND_MIN_MS = 80;

/**
 * **Where a free cast is aimed when nothing picked a body for it** — a
 * `scatter` side cast, which is a direction and not a target. A shot only
 * needs a direction; a shape that is put somewhere needs a distance, and the
 * spell's own reach is the distance a press would have put it at, so the
 * side casts land where the forward one would have, turned.
 */
export function freeCastReach(base: { readonly params: Readonly<Record<string, number | string>> }): number {
  const shape = str(base.params, "shape", "bolt");
  switch (shape) {
    case "field": return num(base.params, "reach", 120);
    case "vortex": return num(base.params, "reach", 110);
    // A free pillar stands at 0.45 of the way to its target (see the pillar
    // above), so the side target is that much further out for the pillar
    // itself to stand at the spell's reach.
    case "pillar": return num(base.params, "reach", 64) / 0.45;
    // A cut at arm's length round the caster, which is where a dash's body is.
    case "dash": return 40;
    case "eruption":
      return str(base.params, "pattern", "line") === "line" ? 64 : num(base.params, "reach", 4) * TILE_PX;
    // A blade thrown to the side flies its own reach, as the forward one does.
    case "boomerang": return num(base.params, "reach", 110);
    // A trail, an enchant and a stance are on the caster; the point is never read.
    case "trail": case "enchant": case "stance": return 0;
    default: return 64;
  }
}

/** A private copy of a cast's elements, for something that outlives the cast. */
function clonePowers(p: ElementPowers): ElementPowers {
  const out = noPowers();
  copyPowers(out, p);
  return out;
}

/** The ring a `land` dash comes down in, read off its item and its cast's figures. */
function landingOf(
  base: { readonly params: Readonly<Record<string, number | string>> },
  damage: number, radius: number, weight: number, element: Element, powers: ElementPowers,
  proc: number, statusMult: number, spellIndex: number, rings: number,
): Landing {
  return {
    damage, radius, rings,
    first: num(base.params, "first", 0) * TILE_PX,
    step: num(base.params, "step", 1) * TILE_PX,
    delayMs: num(base.params, "delay_ms", 80),
    spacing: num(base.params, "ring_spacing", RING_CELL_SPACING),
    weight, kind: str(base.params, "eruption", "earth") === "fire" ? "fire" : "earth",
    element, elementPower: powers[element as "fire"] ?? 0, powers: clonePowers(powers),
    proc, statusMult, burnMs: num(base.params, "burn_ms", 0), spellIndex,
  };
}

/**
 * How far apart a ring's cells stand along its circle, in cell radii, unless
 * the spell sets its own `ring_spacing`: close enough that a body on the ring
 * cannot stand in a gap, far enough that a ring of cells is not the whole pool.
 */
const RING_CELL_SPACING = 1.5;

/**
 * **Rings of erupting ground round a point** (doc 006's `ring` pattern, and
 * the landing of a `land` dash): `rings` circles, the first `first` px out
 * — a first ring at zero is one cell on the point itself — and each next one
 * `step` px further and a beat (`delayMs`) later, so the ground goes off
 * outward. A cell a wall stands between the centre and is dropped, as a line
 * stops at its first wall: the ground breaks where the shock can reach, and
 * never on the far side of masonry. One cast between all the rings, so a
 * body is hit once however many cells it stands in.
 */
/** Whether a rock already marked on the ground will come down on this body. */
function underRock(world: World, t: { x: number; y: number }): boolean {
  return world.eruptions.some((c) => c.alive && !c.fired && c.telegraphMs > 0
    && Math.hypot(c.x - t.x, c.y - t.y) <= c.radius);
}

/** Whether a landing at this point is on floor a body could stand on, not in a wall or a pillar. */
function onFloor(world: World, x: number, y: number): boolean {
  const t = tileAt(world.room.grid, x, y);
  return t === Tile.Floor || t === Tile.Door;
}

/** With `throughProps`, a prop between the centre and a cell does not drop it (the Frontier Veteran's palisade, `isStone`). */
export function eruptRing(
  world: World, centre: { x: number; y: number }, spec: Landing, telegraphMs: number, leadMs = 0, throughProps = false,
): void {
  const cells: { x: number; y: number; delayMs: number }[] = [];
  for (let i = 0; i < Math.max(1, spec.rings); i++) {
    const r = spec.first + i * spec.step;
    // `leadMs`: a wait before the first ring with no rock drawn over it, the cells cracking the floor (the enemy's ring).
    const wait = i * spec.delayMs + telegraphMs + leadMs;
    if (r < 1) {
      cells.push({ x: centre.x, y: centre.y, delayMs: wait });
      continue;
    }
    const n = Math.max(6, Math.round((Math.PI * 2 * r) / (spec.radius * spec.spacing)));
    // Every other ring turned half a cell, so the gaps of one are covered by the next.
    const turn = i % 2 === 0 ? 0 : Math.PI / n;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + turn;
      const x = centre.x + Math.cos(a) * r, y = centre.y + Math.sin(a) * r;
      // A cell whose centre lands inside the masonry is on no floor at all,
      // whatever the sight line to its edge says.
      const tx = Math.floor(x / TILE_PX), ty = Math.floor(y / TILE_PX);
      if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H || world.room.grid[ty * GRID_W + tx] === Tile.Wall) continue;
      if (!hasLineOfSight(world.room.grid, centre.x, centre.y, x, y, throughProps)) continue;
      cells.push({ x, y, delayMs: wait });
    }
  }
  placeCells(world, cells, spec, world.nextEruptionCast++, telegraphMs);
}

/** Writes eruption cells into the world's pool, recycling what has already gone off first. */
function placeCells(
  world: World, cells: readonly { x: number; y: number; delayMs: number }[], spec: Landing, castId: number,
  telegraphMs: number,
): void {
  for (const c of cells) {
    let slot = world.eruptions.find((v) => !v.alive);
    if (!slot) slot = world.eruptions.reduce((a, b) => (a.fired && !b.fired ? a : b));
    slot.alive = true;
    slot.fired = false;
    slot.x = c.x;
    slot.y = c.y;
    slot.delayMs = c.delayMs;
    slot.ageMs = 0;
    slot.radius = spec.radius;
    slot.damage = spec.damage;
    slot.element = spec.element;
    slot.elementPower = spec.elementPower;
    copyPowers(slot.powers, spec.powers);
    slot.proc = spec.proc;
    slot.statusMult = spec.statusMult;
    slot.weight = spec.weight;
    slot.burnMs = spec.burnMs;
    slot.kind = spec.kind;
    slot.spellIndex = spec.spellIndex;
    slot.castId = castId;
    slot.telegraphMs = telegraphMs;
    slot.hostile = !!spec.hostile;
  }
}

export type { Bullet };
