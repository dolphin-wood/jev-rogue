/**
 * The 40 base items of design doc 006: 12 attack, 12 boost, 8 passive,
 * 5 payload, 3 multicast.
 *
 * Tags come only from the closed vocabulary of doc 010 (`content/tags.ts`).
 * Rarity is *not* repeated as a tag: `BaseItem.rarity` already carries it, and
 * duplicating it would swamp `dominant_tags` in every simulation.
 *
 * Descriptions follow doc 010's rules: name and effect in one clause, who it
 * suits in a second clause using label words, no digits unless `numeric_ok`,
 * under 220 characters.
 */

import type { BaseItem, ItemInstance } from "../types.ts";

/** Lookup by `BaseItem.id`. Everything downstream takes one of these. */
export type ItemRegistry = ReadonlyMap<string, BaseItem>;

/* --------------------------------- attacks -------------------------------- */

/**
 * `params` for an attack: damage, speed (px/s), radius (px), count, spread
 * (degrees, total cone), lifetime (s), pierce, element.
 *
 * Plus three that give a spell a **path and a behaviour of its own**, because
 * until they existed every attack in the pool was the same dot travelling in
 * the same straight line at a different speed:
 *
 * - `seek` — degrees a second the shot turns toward the body it was cast at,
 *   which is both the aim assist a keyboard-only game needs and the curve the
 *   shot traces. Raised across the pool (the bolt 90 → 180) after the first
 *   figures left shots sliding past bodies that were moving at all; a shot
 *   that seeks is still a shot to line up, but it should not miss a body it
 *   was pointed at. Near zero is a thrown rock.
 * - `curve` — degrees off the aim it is launched, alternating side per
 *   projectile. With `seek` it is a quadratic arc out and back in; without a
 *   target to come back to it does not apply.
 * - `chain` — how many bodies it arcs to after the first, without needing the
 *   `chain` affix attached.
 */
const ATTACKS: readonly BaseItem[] = [
  {
    id: "magic_bolt",
    kind: "attack",
    rarity: "common",
    tags: ["attack", "mid", "none", "spam"],
    mana: 2,
    params: { damage: 8, speed: 600, radius: 4, count: 1, spread: 0, lifetime: 1.2, pierce: 0, element: "none", seek: 180, curve: 0 },
    description:
      "Magic Bolt fires a single quick projectile at the lowest mana cost in the attack pool. Suits a spam build and keeps mana sustain comfortable.",
  },
  {
    id: "shock_arc",
    kind: "attack",
    rarity: "common",
    tags: ["attack", "mid", "none", "spam"],
    mana: 3,
    /*
     * The second starting spell, and the pool's only one that is about **where
     * the bodies are standing** rather than about the one in front of you.
     *
     * Weaker than the bolt on one body: five damage where the starting bolt
     * does eight. What it buys is the chain — two jumps, each at half the
     * last — so against three bunched bodies it deals about nine, and against
     * one it is the worse key. That is the decision a second key should be
     * asking about. It seeks, because lightning that can be side-stepped is a
     * slow bullet with a bright drawing on it, but not so hard that it cannot
     * be cast past a body.
     *
     * Pulled back from six damage, three jumps and a rank-2 cost: at those
     * figures it cleared rooms on its own, pressed without looking, and the
     * sword had no job. A third rank costs 10 mana and about half a second
     * more of cooldown, which is a swing's worth of earning per cast.
     */
    params: {
      damage: 7, speed: 900, radius: 3, count: 1, spread: 0, lifetime: 0.75,
      pierce: 0, element: "none", seek: 300, curve: 0, chain: 2,
    },
    description:
      "Shock Arc throws a short-lived spark that leaps from the body it hits to up to two more nearby, each jump doing well under half the last. Weaker than a bolt against one target, better where enemies bunch.",
  },
  {
    id: "spark_spray",
    kind: "attack",
    rarity: "common",
    tags: ["attack", "short", "none", "spam", "melee"],
    mana: 3,
    params: { damage: 3, speed: 680, radius: 3, count: 3, spread: 18, lifetime: 0.9, pierce: 0, element: "none", seek: 140, curve: 10 },
    description:
      "Spark Spray throws a short fan of sparks. Suits a spam build at short range and widens scatter when accuracy is already the bottleneck.",
  },
  {
    id: "stone_shard",
    kind: "attack",
    rarity: "common",
    tags: ["attack", "mid", "none", "nuke"],
    mana: 3,
    params: { damage: 12, speed: 340, radius: 6, count: 1, spread: 0, lifetime: 1.4, pierce: 0, element: "none", seek: 60, curve: 0, weight: 2.2,
    },
    description:
      "Stone Shard lobs one shard that hits harder than any other common attack. Suits a nuke build when the bottleneck is damage.",
    jev_hints: { favor_when: ["bottleneck:damage"] },
  },
  {
    id: "ember_dart",
    kind: "attack",
    rarity: "common",
    tags: ["attack", "mid", "fire", "dot"],
    mana: 3,
    params: { damage: 6, speed: 560, radius: 4, count: 1, spread: 0, lifetime: 1.2, pierce: 0, element: "fire", element_power: 1.0, seek: 210, curve: 18 },
    description:
      "Ember Dart sets its target burning on impact. Suits a dot build and carries fire into a scope that has no element.",
  },
  {
    id: "frost_needle",
    kind: "attack",
    rarity: "common",
    tags: ["attack", "control", "mid", "ice", "spam"],
    mana: 3,
    params: { damage: 8, speed: 760, radius: 3, count: 1, spread: 0, lifetime: 1.3, pierce: 0, element: "ice", element_power: 0.7, seek: 130, curve: 0 },
    description:
      "Frost Needle chills its target and slows it. Fills the control role and answers an accuracy bottleneck.",
    jev_hints: { favor_when: ["bottleneck:accuracy"] },
  },
  {
    id: "venom_spit",
    kind: "attack",
    rarity: "uncommon",
    tags: ["attack", "short", "poison", "dot"],
    mana: 3,
    params: { damage: 6, speed: 440, radius: 5, count: 1, spread: 0, lifetime: 1.1, pierce: 0, element: "poison", element_power: 1.15, seek: 190, curve: 26 },
    description:
      "Venom Spit leaves stacking poison on impact. Suits a dot build at short range and rewards a fast cast frequency.",
  },
  {
    id: "arc_lance",
    kind: "attack",
    rarity: "uncommon",
    tags: ["attack", "long", "none", "nuke"],
    mana: 5,
    params: { damage: 16, speed: 880, radius: 4, count: 1, spread: 0, lifetime: 1.6, pierce: 1, element: "none", seek: 100, curve: 0 },
    description:
      "Arc Lance sends a fast lance that passes through its target. Suits a nuke build at long range when the bottleneck is damage.",
  },
  {
    id: "scatter_shot",
    kind: "attack",
    rarity: "uncommon",
    tags: ["attack", "short", "none", "area"],
    mana: 4,
    params: { damage: 3.6, speed: 460, radius: 3, count: 5, spread: 30, lifetime: 0.7, pierce: 0, element: "none", seek: 150, curve: 14 },
    description:
      "Scatter Shot sprays a cone of pellets. Suits an area build at short range and pushes scatter wide.",
  },
  {
    id: "cinder_burst",
    kind: "attack",
    rarity: "uncommon",
    tags: ["attack", "mid", "fire", "area", "dot"],
    mana: 5,
    params: { damage: 9, speed: 500, radius: 5, count: 2, spread: 10, lifetime: 1.1, pierce: 0, element: "fire", element_power: 0.75, seek: 190, curve: 22 },
    description:
      "Cinder Burst fires a pair of burning motes. Suits a build that mixes area and dot, and pulls mana sustain toward tight.",
  },
  {
    id: "glacier_spike",
    kind: "attack",
    rarity: "rare",
    tags: ["attack", "control", "mid", "ice", "nuke"],
    mana: 6,
    params: { damage: 22, speed: 420, radius: 6, count: 1, spread: 0, lifetime: 1.5, pierce: 0, element: "ice", element_power: 1.6, seek: 130, curve: 0, weight: 1.8,
    },
    description:
      "Glacier Spike drives one large icy spike that slows what it hits. Suits a nuke build and answers a damage bottleneck at mid range.",
  },
  {
    id: "void_orb",
    kind: "attack",
    rarity: "rare",
    tags: ["attack", "long", "none", "area"],
    mana: 7,
    params: { damage: 18, speed: 300, radius: 9, count: 1, spread: 0, lifetime: 2.2, pierce: 2, element: "none", seek: 170, curve: 0, weight: 1.6,
    },
    description:
      "Void Orb drifts slowly and passes through everything it touches. Suits an area build at long range when mana sustain is comfortable.",
    jev_hints: { avoid_when: ["mana_sustain:starved"] },
  },
  {
    id: "plague_bloom",
    kind: "attack",
    rarity: "rare",
    tags: ["attack", "mid", "poison", "dot", "area"],
    mana: 6,
    params: { damage: 10, speed: 420, radius: 4, count: 3, spread: 22, lifetime: 1.1, pierce: 0, element: "poison", element_power: 0.6, seek: 160, curve: 30 },
    description:
      "Plague Bloom scatters spores that poison on contact. Suits a dot build and spreads scatter wide.",
  },
  /*
   * The three shapes that are not projectiles — see `fireOnce` in
   * `sim/cast.ts` and doc 013, "Spell shapes". Each fills a role no shot can:
   * damage that follows the body, ground denied for a while, and cover placed
   * where the player wants it.
   */
  {
    id: "spirit_blades",
    kind: "attack",
    rarity: "common",
    tags: ["attack", "short", "none", "area", "melee"],
    mana: 4,
    params: {
      shape: "orbit", damage: 3, speed: 0, radius: 5, count: 3, spread: 0, lifetime: 4,
      pierce: 0, element: "none", orbit_radius: 40, spin: 300, seek: 0, curve: 0,
    },
    description:
      "Spirit Blades set three blades circling the caster for a while, cutting whatever they pass through again and again; a recast renews the ring rather than adding to it. Rewards standing in the rush.",
  },
  {
    id: "wildfire_field",
    kind: "attack",
    rarity: "uncommon",
    tags: ["attack", "mid", "fire", "dot"],
    mana: 5,
    params: {
      /*
       * Measured (`pnpm spell-bench`): at 3 damage, 40 px and 4 s it dealt
       * seven times the pool's median to a pack, because every cast is its
       * own patch and patches overlap. A field is the area specialist and
       * should be the best key against a crowd — at about two and a half
       * times the median, not seven.
       */
      shape: "field", damage: 1.6, speed: 0, radius: 34, count: 1, spread: 0, lifetime: 3,
      pierce: 0, element: "fire", element_power: 0.35, reach: 120, seek: 0, curve: 0,
    },
    description:
      "Wildfire Field sets the ground alight under the nearest enemy, burning everything that stands in it until it dies down. Denies a patch of floor rather than hitting a body.",
  },
  {
    id: "blink_strike",
    kind: "attack",
    rarity: "uncommon",
    tags: ["attack", "short", "none", "nuke", "melee"],
    mana: 4,
    params: {
      shape: "dash", damage: 8, speed: 0, radius: 12, count: 1, spread: 0, lifetime: 0.22,
      pierce: 0, element: "none", seek: 0, curve: 0,
    },
    description:
      "Blink Strike throws the caster forward through whatever stands in the way, cutting each body once and untouchable for the travel. A dodge that hits, and the one spell that buys safety.",
  },
  {
    id: "void_maw",
    kind: "attack",
    rarity: "uncommon",
    tags: ["attack", "mid", "none", "area"],
    mana: 6,
    params: {
      shape: "vortex", damage: 1.4, speed: 0, radius: 70, count: 1, spread: 0, lifetime: 3,
      pierce: 0, element: "none", reach: 110, pull: 140, seek: 0, curve: 0,
    },
    description:
      "Void Maw opens a pull under the nearest enemy that drags everything around it inward for a few seconds, nicking what it holds. Gathers a scattered room into one place for the sword.",
  },
  {
    id: "spirit_ally",
    kind: "attack",
    rarity: "rare",
    tags: ["attack", "mid", "none", "spam"],
    mana: 6,
    params: {
      shape: "summon", damage: 6, speed: 150, radius: 6, count: 1, spread: 0, lifetime: 8,
      pierce: 0, element: "none", reach: 260, interval: 0.7, seek: 0, curve: 0,
    },
    description:
      "Spirit Ally calls a companion that follows a step behind and shoots the nearest enemy on its own for a while. Damage that keeps coming while the caster is busy staying alive.",
  },
  /*
   * Three roles the pool had no spell for (task 6), each built from the bolt
   * rather than a new shape: an answer to being surrounded, an answer to not
   * being able to aim, and an answer to a corridor.
   */
  {
    id: "frost_nova",
    kind: "attack",
    rarity: "uncommon",
    tags: ["attack", "short", "ice", "control", "area", "melee"],
    mana: 5,
    // An odd count, so one shard flies down the aim: with twelve the body aimed at stood in the gap.
    params: { damage: 7, speed: 380, radius: 5, count: 11, spread: 330, lifetime: 0.38, pierce: 1, element: "ice", element_power: 0.8, seek: 0, curve: 0 },
    description:
      "Frost Nova throws a ring of ice shards out from the caster that stops short, chilling everything close. The answer to being surrounded, and wasted at range.",
  },
  {
    id: "seeker_swarm",
    kind: "attack",
    rarity: "uncommon",
    tags: ["attack", "long", "none", "spam", "tracking"],
    mana: 4,
    params: { damage: 3.2, speed: 420, radius: 3, count: 4, spread: 70, lifetime: 1.6, pierce: 0, element: "none", seek: 520, curve: 22 },
    description:
      "Seeker Swarm looses a handful of darts that hunt down the nearest bodies on their own. Weak for its cost against one target, but it never misses.",
  },
  {
    id: "fault_line",
    kind: "attack",
    rarity: "uncommon",
    tags: ["attack", "long", "none", "nuke", "area"],
    mana: 5,
    params: { damage: 9, speed: 720, radius: 6, count: 1, spread: 0, lifetime: 0.5, pierce: 99, element: "none", seek: 0, curve: 0, weight: 1.8 },
    description:
      "Fault Line drives a blade of stone straight through everything in a line. Built for a corridor or a queue of bodies, and ordinary against one.",
  },
  {
    id: "stone_ward",
    kind: "attack",
    rarity: "common",
    tags: ["attack", "short", "none", "control", "melee"],
    mana: 3,
    params: {
      shape: "pillar", damage: 9, speed: 0, radius: 14, count: 1, spread: 0, lifetime: 6,
      pierce: 0, element: "none", reach: 64, seek: 0, curve: 0,
    },
    description:
      "Stone Ward raises a pillar between the caster and what they face, throwing back and hurting what stood beside it. It blocks bodies and bullets both ways until worn down.",
  },
];

/* --------------------------------- boosts --------------------------------- */

/** `params` for a boost: any of damage_mult, speed_mult, radius_mult,
 *  count_add, spread, pierce_add, homing, bounce, split, element,
 *  element_power. A boost never occupies a tick; its mana is paid by every
 *  projectile-firing unit in its scope. */
const BOOSTS: readonly BaseItem[] = [
  {
    id: "power_rune",
    kind: "boost",
    rarity: "common",
    tags: ["boost", "none", "nuke"],
    mana: 1,
    params: { damage_mult: 1.35 },
    description:
      "Power Rune multiplies the damage of every attack after it in its scope. Suits a nuke build when the bottleneck is damage.",
    jev_hints: { favor_when: ["bottleneck:damage"] },
  },
  {
    id: "greater_power_rune",
    kind: "boost",
    rarity: "rare",
    tags: ["boost", "none", "nuke"],
    mana: 4,
    params: { damage_mult: 1.8 },
    description:
      "Greater Power Rune multiplies damage further than any other boost in the pool. Suits a nuke build and pulls mana sustain toward tight.",
  },
  {
    id: "swift_rune",
    kind: "boost",
    rarity: "common",
    tags: ["boost", "none", "spam"],
    mana: 1,
    params: { speed_mult: 1.5 },
    description:
      "Swift Rune speeds up every projectile after it in its scope. Answers an accuracy bottleneck against a moving target.",
    jev_hints: { favor_when: ["bottleneck:accuracy"] },
  },
  {
    id: "heavy_rune",
    kind: "boost",
    rarity: "common",
    tags: ["boost", "none", "area"],
    mana: 1,
    params: { radius_mult: 1.6 },
    description:
      "Heavy Rune enlarges every projectile after it in its scope. Suits an area build and answers an accuracy bottleneck.",
  },
  {
    id: "twin_rune",
    kind: "boost",
    rarity: "uncommon",
    tags: ["boost", "none", "spam"],
    mana: 2,
    params: { count_add: 1, spread: 8 },
    description:
      "Twin Rune adds a projectile to every attack after it in its scope. Suits a spam build and widens scatter.",
  },
  {
    id: "piercing_rune",
    kind: "boost",
    rarity: "uncommon",
    tags: ["boost", "long", "none", "area"],
    mana: 2,
    params: { pierce_add: 2 },
    description:
      "Piercing Rune lets projectiles after it pass through their targets. Suits an area build at long range.",
  },
  {
    id: "seeker_rune",
    kind: "boost",
    rarity: "uncommon",
    tags: ["boost", "tracking", "none", "spam"],
    mana: 2,
    params: { homing: 0.6 },
    description:
      "Seeker Rune steers projectiles after it toward the target. Fills the tracking role and answers an accuracy bottleneck.",
    jev_hints: { favor_when: ["bottleneck:accuracy"] },
  },
  {
    id: "ricochet_rune",
    kind: "boost",
    rarity: "uncommon",
    tags: ["boost", "none", "area"],
    mana: 2,
    params: { bounce: 2 },
    description:
      "Ricochet Rune makes projectiles after it bounce off walls instead of dying. Suits an area build in a tight room.",
  },
  {
    id: "fracture_rune",
    kind: "boost",
    rarity: "rare",
    tags: ["boost", "none", "area"],
    mana: 3,
    params: { split: 3 },
    description:
      "Fracture Rune splits projectiles after it into fragments when they die. Suits an area build and keeps scatter wide.",
  },
  {
    id: "fire_rune",
    kind: "boost",
    rarity: "common",
    tags: ["boost", "fire", "dot"],
    mana: 1,
    params: { element: "fire", element_power: 1 },
    description:
      "Fire Rune infuses every attack after it in its scope with fire. Suits a dot build and stacks with other fire sources.",
  },
  {
    id: "venom_rune",
    kind: "boost",
    rarity: "common",
    tags: ["boost", "poison", "dot"],
    mana: 1,
    params: { element: "poison", element_power: 1 },
    description:
      "Venom Rune infuses every attack after it in its scope with poison. Suits a dot build and rewards a fast cast frequency.",
  },
  {
    id: "frost_rune",
    kind: "boost",
    rarity: "common",
    tags: ["boost", "control", "ice"],
    mana: 1,
    params: { element: "ice", element_power: 1 },
    description:
      "Frost Rune infuses every attack after it in its scope with ice. Fills the control role and answers an accuracy bottleneck.",
  },
];

/* -------------------------------- passives -------------------------------- */

/** A passive is never a unit and never pays mana; it modifies the whole staff.
 *  `arcane_focus` is the eighth passive doc 006's table counts but does not
 *  name; it exists so the damage formula's passive multiplier and flat terms
 *  both have a base-item source. */
const PASSIVES: readonly BaseItem[] = [
  {
    id: "mana_well",
    kind: "passive",
    rarity: "common",
    tags: ["passive", "mana_regen", "sustain", "none"],
    mana: 0,
    params: { regen_add: 3 },
    description:
      "Mana Well raises the staff's mana regeneration wherever it sits. Fills the mana_regen role and moves mana sustain toward comfortable.",
    jev_hints: { favor_when: ["mana_sustain:starved", "bottleneck:mana"] },
  },
  {
    id: "quick_hands",
    kind: "passive",
    rarity: "uncommon",
    tags: ["passive", "engine", "none", "spam"],
    mana: 0,
    params: { cast_interval_mult: 0.85 },
    description:
      "Quick Hands shortens the interval between casts. Answers a cast frequency bottleneck and pulls mana sustain toward starved.",
    jev_hints: { favor_when: ["bottleneck:cast_frequency"] },
  },
  {
    id: "cooling_vents",
    kind: "passive",
    rarity: "uncommon",
    tags: ["passive", "engine", "none", "spam"],
    mana: 0,
    params: { cooldown_mult: 0.75 },
    description:
      "Cooling Vents shortens the cooldown between cycles. Answers a cast frequency bottleneck and shortens cycle time.",
    jev_hints: { favor_when: ["bottleneck:cast_frequency"] },
  },
  {
    id: "keen_eye",
    kind: "passive",
    rarity: "uncommon",
    tags: ["passive", "none", "nuke"],
    mana: 0,
    params: { crit_add: 0.12 },
    description:
      "Keen Eye raises the staff's critical chance. Suits a nuke build when the bottleneck is damage.",
  },
  {
    id: "thorn_mantle",
    kind: "passive",
    rarity: "common",
    tags: ["passive", "sustain", "short", "none"],
    mana: 0,
    params: { thorns: 4 },
    description:
      "Thorn Mantle hurts anything that touches the caster. Fills the sustain role for a build fighting at short range.",
  },
  {
    id: "siphon_ward",
    kind: "passive",
    rarity: "rare",
    tags: ["passive", "sustain", "none"],
    mana: 0,
    params: { lifesteal: 0.06 },
    description:
      "Siphon Ward returns a share of spell damage as health. Fills the sustain role when recent damage is heavy.",
    jev_hints: { favor_when: ["health:low", "recent_damage:heavy"] },
  },
  {
    id: "homing_lens",
    kind: "passive",
    rarity: "uncommon",
    tags: ["passive", "tracking", "none"],
    mana: 0,
    params: { tracking_add: 0.35 },
    description:
      "Homing Lens gives every projectile the staff fires a pull toward the target. Fills the tracking role and answers an accuracy bottleneck.",
    jev_hints: { favor_when: ["bottleneck:accuracy"] },
  },
  {
    id: "arcane_focus",
    kind: "passive",
    rarity: "rare",
    tags: ["passive", "none", "nuke"],
    mana: 0,
    params: { damage_mult: 1.18, damage_add: 1 },
    description:
      "Arcane Focus sharpens every projectile the staff fires, raising its damage. Suits a nuke build when the bottleneck is damage.",
  },
];

/* -------------------------------- payloads -------------------------------- */

/** `params` for a payload: carrier damage, speed, radius, lifetime, pierce,
 *  trigger, and `passthrough` (a carrier that must survive its first contact to
 *  reach its trigger: an `on_expire` fuse or an `on_wall` dart). */
const PAYLOADS: readonly BaseItem[] = [
  {
    id: "impact_carrier",
    kind: "payload",
    rarity: "common",
    tags: ["payload", "mid", "none"],
    mana: 2,
    params: { damage: 5, speed: 560, radius: 5, lifetime: 1.3, pierce: 0, passthrough: 0, trigger: "on_hit" },
    description:
      "Impact Carrier flies out and casts the spell it captured where it strikes. Reserves the captured spell's mana when it fires.",
  },
  {
    id: "fuse_carrier",
    kind: "payload",
    rarity: "common",
    tags: ["payload", "mid", "none", "area"],
    mana: 2,
    params: { damage: 4, speed: 380, radius: 6, lifetime: 0.45, pierce: 0, passthrough: 1, trigger: "on_expire" },
    description:
      "Fuse Carrier drifts past its target and casts the spell it captured when its fuse runs out. Suits an area build at mid range.",
  },
  {
    id: "wall_carrier",
    kind: "payload",
    rarity: "uncommon",
    tags: ["payload", "long", "none", "area"],
    mana: 3,
    params: { damage: 6, speed: 700, radius: 4, lifetime: 2, pierce: 0, passthrough: 1, trigger: "on_wall" },
    description:
      "Wall Carrier flies on until it meets a wall, then casts the spell it captured there. Suits an area build in a tight room.",
  },
  {
    id: "piercing_carrier",
    kind: "payload",
    rarity: "uncommon",
    tags: ["payload", "long", "none", "nuke"],
    mana: 4,
    params: { damage: 8, speed: 620, radius: 4, lifetime: 1.4, pierce: 1, passthrough: 0, trigger: "on_hit" },
    description:
      "Piercing Carrier punches through its target and casts the spell it captured on the way. Suits a nuke build at long range.",
  },
  {
    id: "mortar_carrier",
    kind: "payload",
    rarity: "rare",
    tags: ["payload", "mid", "none", "area"],
    mana: 5,
    params: { damage: 12, speed: 300, radius: 8, lifetime: 0.65, pierce: 0, passthrough: 1, trigger: "on_expire" },
    description:
      "Mortar Carrier arcs out slowly and casts the spell it captured when it expires. Suits an area build and pulls mana sustain toward tight.",
  },
];

/* ------------------------------- multicasts ------------------------------- */

/** `params.n` is the number of units captured; `discount_mult` is an extra
 *  factor on top of the 0.8^(N-1) rule. Multicast items cost no mana of their
 *  own, so the group price is exactly doc 006's formula over its units. */
const MULTICASTS: readonly BaseItem[] = [
  {
    id: "double_cast",
    kind: "boost",
    rarity: "uncommon",
    tags: ["boost", "none", "spam"],
    mana: 2,
    params: { repeat: 1 },
    description:
      "Double Cast fires the spell it is attached to a second time. Suits any build and doubles whatever that spell already does, for twice the mana.",
  },
  {
    id: "triple_cast",
    kind: "boost",
    rarity: "rare",
    tags: ["boost", "none", "spam"],
    mana: 3,
    params: { repeat: 2 },
    description:
      "Triple Cast fires the spell it is attached to twice more. Suits a spam build and turns one press into a volley.",
  },
  {
    id: "chorus_cast",
    kind: "boost",
    rarity: "rare",
    tags: ["boost", "none", "spam"],
    mana: 3,
    params: { repeat: 3 },
    description:
      "Chorus Cast fires the spell it is attached to three more times. Suits a nuke build where one cast is already expensive.",
  },
];

export const BASE_ITEMS: readonly BaseItem[] = [
  ...ATTACKS, ...BOOSTS, ...PASSIVES, ...PAYLOADS, ...MULTICASTS,
];

export function registryOf(items: readonly BaseItem[]): ItemRegistry {
  const map = new Map<string, BaseItem>();
  for (const item of items) {
    if (map.has(item.id)) throw new Error(`duplicate base item id ${item.id}`);
    map.set(item.id, item);
  }
  return map;
}

export const ITEMS: ItemRegistry = registryOf(BASE_ITEMS);

/** Throws rather than returning undefined: a slot holding an unknown base id is
 *  a content bug, and silently dropping it would hide it from the simulator. */
export function baseOf(instance: { readonly base: string }, items: ItemRegistry = ITEMS): BaseItem {
  const base = items.get(instance.base);
  if (!base) throw new Error(`unknown base item ${instance.base}`);
  return base;
}

export function num(params: Readonly<Record<string, number | string>>, key: string, fallback = 0): number {
  const v = params[key];
  return typeof v === "number" ? v : fallback;
}

export function str(params: Readonly<Record<string, number | string>>, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === "string" ? v : fallback;
}

/** An unaffixed instance of a base item. Slots, offers and the simulator only
 *  ever see instances (doc 006, "Base items and item instances"). */
export function plainInstance(baseId: string, uid = baseId, items: ItemRegistry = ITEMS): ItemInstance {
  const base = baseOf({ base: baseId }, items);
  return { uid, base: baseId, affix: null, magnitude: 0, modifier: null, rarity: base.rarity };
}
