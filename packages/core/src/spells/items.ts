/**
 * The spell pool: thirty-nine attacks, each a self-contained spell that goes on
 * one of the three keys (doc 013). Nothing in the pool modifies another spell.
 *
 * Tags come only from the closed vocabulary of doc 010 (`content/tags.ts`).
 * Rarity is *not* repeated as a tag: `BaseItem.rarity` already carries it.
 *
 * Descriptions follow doc 010's rules and doc 006, "What a spell tells Jev":
 * a **neutral fact**, the spell's name and what it does in one clause, a
 * second clause only for another effect — its delivery, reach, element and
 * what the key does when held or rested — and never who it suits, how it
 * compares with the rest of the pool, or whether it is good. No digits unless
 * `numeric_ok`, under 220 characters. A description is the card's `what` for
 * the Director (`cardPool`); what a spell is *not* for is derived from its
 * parameters (`spellNegative` in the Director), not written here.
 */

import type { Archetype, BaseItem, ItemInstance } from "../types.ts";

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
 *   was pointed at. Near zero is a thrown rock. **A spread does not seek**
 *   (spells of several shots are at 0): a fan whose every shot bends onto
 *   the one body is the whole fan on that body, which made each spread spell
 *   a heavy bolt that could not miss. The one spell that is several seeking
 *   shots, Seeker Swarm, pays for it with low damage per dart.
 * - `curve` — degrees off the aim it is launched, alternating side per
 *   projectile. With `seek` it is a quadratic arc out and back in; without a
 *   target to come back to it does not apply.
 * - `chain` — how many bodies it arcs to after the first, without needing the
 *   `chain` affix attached.
 */
const ATTACKS: readonly BaseItem[] = [
  {
    id: "magic_bolt",
    rarity: "common",
    tags: ["attack", "mid", "none", "spam"],
    mana: 2,
    // Trimmed a touch with the re-level: the plainest spell in the pool should not also sit at
    // the top of its cluster.
    params: { damage: 6.8, speed: 600, radius: 4, count: 1, spread: 0, lifetime: 1.2, pierce: 0, element: "none", seek: 90, curve: 0, weight: 1 },
    description:
      "Magic Bolt fires one quick projectile that steers gently toward the body it was cast at.",
  },
  {
    id: "shock_arc",
    rarity: "common",
    tags: ["attack", "mid", "none", "spam"],
    mana: 2,
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
    // Raised: at 0.47 of the sword it was the weakest generalist in the pool, and a starting key
    // cannot be the worst key.
    params: {
      damage: 6.8, speed: 900, radius: 3, count: 1, spread: 0, lifetime: 0.75,
      pierce: 0, element: "none", seek: 480, curve: 0, chain: 2, weight: 0.7,
      // Held, three seeking sparks a second that each found three bodies emptied rooms by themselves.
      cooldown_scale: 1.5,
    },
    description:
      "Shock Arc throws a short-lived spark that steers hard onto a body and leaps from it to up to two more nearby, each jump doing less than the last.",
  },
  {
    id: "spark_spray",
    rarity: "common",
    tags: ["attack", "short", "none", "spam", "melee"],
    mana: 3,
    // Per-spark damage down because the bench now measures it at arm's length, where a spell
    // tagged `melee` is meant to be used and where all three sparks land.
    params: { damage: 3.15, speed: 680, radius: 3, count: 3, spread: 10, lifetime: 0.9, pierce: 0, element: "none", seek: 0, curve: 10, weight: 0.4 },
    description:
      "Spark Spray throws a short fan of three sparks straight ahead, none of which steers.",
  },
  {
    id: "stone_shard",
    rarity: "common",
    tags: ["attack", "mid", "none", "nuke"],
    mana: 3,
    // Trimmed: the whole pool was re-levelled against the sword, and the shard no longer needs
    // the lead it had over spells that were half of it.
    params: { damage: 9.5, speed: 340, radius: 6, count: 1, spread: 0, lifetime: 1.4, pierce: 0, element: "none", seek: 30, curve: 0, weight: 2.2, cooldown_scale: 1.4,
    },
    description:
      "Stone Shard heaves one slow shard of stone that barely steers, after a windup that slows the caster.",
  },
  {
    id: "earth_spikes",
    rarity: "common",
    tags: ["attack", "mid", "none", "nuke"],
    /*
     * **Four mana, a long windup and a long cooldown.** It was three mana — a
     * common bolt's price — on a short windup, so the Heavy style's opener
     * cast about as often as a spam spell while hitting for seven a spike
     * *and* staggering whatever it caught, which is the "too frequent, high
     * damage, and a stun" report. A nuke is meant to be slow, dear and worth
     * waiting for; the stagger is the payoff for the wait (and a body cannot
     * be held in one: see `SPELL_STAGGER_IMMUNE_MS`).
     *
     * Five, and then four, put it under the pool's damage-per-second band once
     * a line's cell had to come down far enough not to delete a first-room
     * body in one press — a body takes exactly one cell of the line, so the
     * cell *is* the spell's whole hit, where a fan lands seven at once. What
     * keeps it slow is the 380 ms windup, the recovery and the cooldown
     * scale, which are the things the player feels; the price was doing the
     * same job twice, and doing it badly.
     */
    mana: 3,
    /*
     * The Heavy style's first key, after the ground spells of the action
     * RPGs that throw a line of spikes up out of the floor: five cells ahead,
     * each a beat after the last, each heavy enough to stop what it catches.
     * It hits what stands in its line and nothing off it, and nothing that
     * flies — a spell about where the bodies are, not a shot at one.
     */
    // Raised: the Heavy style's opener measured at 0.44 of the sword, the weakest nuke in the
    // pool.
    /*
     * **The caster keeps walking through the heave** (`move_scale` 0.85, was
     * 0.5). The windup is the commitment; the slow was a second one, and on
     * the only key a Heavy run starts with it cost the room. Pressed as often
     * as it came up, a 700 ms windup and recovery at half speed held the
     * caster slowed for most of a fight, so a body that keeps its distance
     * was never closed on: measured with the reference player, the key made
     * a lone room-1 shooter take 12.8 s and 4.5 HP against 4.2 s and none
     * for the sword alone, and room 1 took 36 s and 10 HP against 16 s and
     * 1.4 for Barrage. At 0.85 the same shooter is the sword's 4.7 s, and
     * the pinned-dummy figures the bench asserts do not move.
     */
    params: {
      damage: 10.1, speed: 0, radius: 13, count: 5, spread: 0, lifetime: 0.4, pierce: 0, element: "none",
      seek: 0, curve: 0, weight: 1.8, shape: "eruption", eruption: "earth", pattern: "line",
      step: 1, first: 1.2, delay_ms: 65, windup_ms: 380, recover_ms: 320, move_scale: 0.85, cooldown_scale: 1.35,
    },
    description:
      "Earth Spikes drives a line of stone spikes up out of the floor ahead after a windup, one after another, staggering what they catch. The line stops at the first wall.",
  },
  {
    id: "flame_pillars",
    rarity: "uncommon",
    tags: ["attack", "mid", "fire", "dot", "area"],
    mana: 5,
    params: {
      /*
       * A lighter pillar, slower to light. At five cells and 1.4 power it
       * set a whole pack alight on the second cast and measured at three
       * times the pool's pack median — the burn is most of what it deals
       * (111% of its own hit damage), so the lever is how much ground it
       * lights and how fast, not how hard the pillar itself lands.
       *
       * Re-levelled against the sword: **the pillars now carry about a third
       * of the spell** and the fire the rest. At 97% status there was nothing
       * for an affix to multiply — a status saturates, so more casts and more
       * shots added nothing — and it was the one spell in the pool no build
       * could carry past the sword. A longer stride, because a line of five
       * at one tile apart reached only the near edge of a pack and measured
       * at 0.69 of its own single-target damage against six bodies, which is
       * a lane weapon that does not cover a lane.
       */
      damage: 4.3, speed: 0, radius: 13, count: 5, spread: 0, lifetime: 0.4, pierce: 0, element: "fire",
      element_power: 0.58, seek: 0, curve: 0, weight: 0.8, shape: "eruption", eruption: "fire", pattern: "line",
      step: 1.45, first: 1.2, delay_ms: 80, burn_ms: 1800, windup_ms: 150, recover_ms: 240, move_scale: 0.55,
    },
    description:
      "Flame Pillars raises a line of fire columns ahead, one after another; each sets what it hits burning, and the floor under each keeps burning for a while.",
  },
  {
    id: "cinder_geysers",
    rarity: "rare",
    tags: ["attack", "mid", "fire", "area"],
    mana: 5,
    // Raised: the weakest area spell in the pool at 0.50 of the sword, and the one whose level
    // pays back most (its hit and the fire it leaves both scale).
    params: {
      /*
       * Six scattered eruptions light a lot of ground, and since the burn is
       * most of what a fire spell deals that made it six times the pool's
       * pack median. Four is still the widest spread in the pool, and the
       * gauge fills on the third hit rather than the second, so a pack burns
       * because the player kept casting into it rather than at once.
       */
      damage: 2.85, speed: 0, radius: 15, count: 4, spread: 0, lifetime: 0.4, pierce: 0, element: "fire",
      element_power: 0.7, seek: 0, curve: 0, weight: 1.2, shape: "eruption", eruption: "fire", pattern: "scatter",
      reach: 4, area: 1.6, delay_ms: 60, burn_ms: 850, windup_ms: 200, recover_ms: 280, move_scale: 0.5,
    },
    description:
      "Cinder Geysers bursts fire out of the floor under the body it seeks and at points scattered round it, each on its own beat, and the ground stays alight a moment.",
  },
  {
    id: "ember_dart",
    rarity: "common",
    tags: ["attack", "mid", "fire", "dot"],
    mana: 3,
    /*
     * **Three damage, and it lights on the second hit.** At six damage and a
     * gauge that needed three hits, a body died on the hit that would have
     * lit it — the burn this spell is named for never happened, which is the
     * report. The direct damage is now a third of what a burn is worth, so
     * the spell's value is the status: 3 + 3 up front, then fifteen over the
     * three seconds it burns.
     *
     * **The second hit may come up to about two and a half seconds after the
     * first** (`element_power` 2.4, was 1.6). At 1.6 a hit filled 0.58 of the
     * gauge, which drains from 0.6 s after a hit, so the second had to land
     * inside a second or the first was wasted: the bench's key, pressed on
     * every cooldown, always made it, and a player pressing about once a
     * second and a half never did — measured with the `average` profile,
     * room 1 took 36 s and 17 HP on a dart that never lit. It still lights on
     * the second hit, never the first.
     */
    params: { damage: 2.1, speed: 560, radius: 4, count: 1, spread: 0, lifetime: 1.2, pierce: 0, element: "fire", element_power: 2.4, seek: 90, curve: 18, weight: 0.8 },
    description:
      "Ember Dart fires a curving dart that fills the burn gauge of the body it hits until it catches fire.",
  },
  {
    id: "frost_needle",
    rarity: "common",
    tags: ["attack", "control", "mid", "ice", "spam"],
    mana: 2,
    // Raised into the cluster from 0.53 of the sword.
    params: { damage: 6.8, speed: 760, radius: 3, count: 1, spread: 0, lifetime: 1.3, pierce: 0, element: "ice", element_power: 0.7, seek: 60, curve: 0, weight: 0.8 },
    description:
      "Frost Needle fires a fast needle of ice that slows the body it hits and fills its chill gauge toward a freeze.",
  },
  {
    id: "venom_spit",
    rarity: "uncommon",
    tags: ["attack", "short", "poison", "dot"],
    mana: 3,
    // Raised, and poisons harder: it was under the cluster and its status was doing too little of
    // the work.
    params: { damage: 2.5, speed: 440, radius: 5, count: 1, spread: 0, lifetime: 1.1, pierce: 0, element: "poison", element_power: 3.8, status_scale: 1.5, seek: 120, curve: 26, weight: 0.8 },
    description:
      "Venom Spit spits a short-range, curving glob that poisons the body it hits; each further hit on a poisoned body adds a stack.",
  },
  {
    id: "arc_lance",
    rarity: "uncommon",
    tags: ["attack", "long", "none", "nuke"],
    mana: 5,
    // Trimmed into the cluster with the re-level.
    params: { damage: 13.4, speed: 880, radius: 4, count: 1, spread: 0, lifetime: 1.6, pierce: 1, element: "none", seek: 420, curve: 0, weight: 1.2, cooldown_scale: 1.4 },
    description:
      "Arc Lance sends a fast lance that steers hard onto a body and passes through it to one more behind.",
  },
  {
    id: "scatter_shot",
    rarity: "uncommon",
    tags: ["attack", "short", "none", "area"],
    mana: 4,
    /*
     * **A real cone.** At 20 degrees all five pellets still landed on one
     * body two tiles out — 26 dps on a single target, which is a nuke's
     * figure from an area spell, and the shotgun identity was missing
     * entirely. At 60 the pellets are 15 degrees apart, so a body catches one
     * or two at mid range and all five only at point blank: great up close,
     * weak at range, which is the whole of what a shotgun is. Per-pellet
     * damage comes down to pay for the close-range case.
     *
     * Then five pellets at 15 degrees apart were reported as a spell that
     * mostly misses: a body a couple of tiles out caught one, and whether it
     * caught any depended on where it stood in the gaps. Seven pellets across
     * 50 degrees, about 8 apart and a touch larger, keep the cone and its falloff
     * but land two to four on a body at the range the spell is used at, for
     * the same total at point blank.
     */
    // Per-pellet damage down: measured point blank, where every pellet lands, it was the best
    // single-target spell in the pool.
    params: { damage: 2.27, speed: 460, radius: 3.6, count: 7, spread: 50, lifetime: 0.7, pierce: 0, element: "none", seek: 0, curve: 14, weight: 0.5 },
    description:
      "Scatter Shot sprays a wide cone of pellets that fly a short way; a body close to the caster is hit by more of them than one further off.",
  },
  {
    id: "cinder_burst",
    rarity: "uncommon",
    tags: ["attack", "mid", "fire", "area", "dot"],
    /*
     * Cheaper, lighter per mote, hotter, and the motes now punch through the
     * first body. It was tagged `area` and measured at exactly its own
     * single-target damage against six bodies — a single-target spell wearing
     * the tag — and at 49% status it was a fire spell that barely burned.
     */
    mana: 4,
    params: { damage: 1.75, speed: 500, radius: 5, count: 2, spread: 10, lifetime: 1.1, pierce: 1, element: "fire", element_power: 1.45, seek: 0, curve: 22, weight: 0.8 },
    description:
      "Cinder Burst fires a pair of curving burning motes that pass through the first body each one hits.",
  },
  {
    id: "glacier_spike",
    rarity: "rare",
    tags: ["attack", "control", "mid", "ice", "nuke"],
    mana: 6,
    params: { damage: 16.5, speed: 420, radius: 6, count: 1, spread: 0, lifetime: 1.5, pierce: 0, element: "ice", element_power: 1.6, seek: 40, curve: 0, weight: 1.8, cooldown_scale: 1.5,
    },
    description:
      "Glacier Spike drives one large, slow spike of ice that slows the body it hits and fills a large share of its chill gauge.",
  },
  {
    id: "void_orb",
    rarity: "rare",
    tags: ["attack", "long", "none", "area"],
    mana: 7,
    params: { damage: 17.7, speed: 150, radius: 9, count: 1, spread: 0, lifetime: 4.2, pierce: 2, element: "none", seek: 50, curve: 0, weight: 2.4, cooldown_scale: 2.2,
    },
    description:
      "Void Orb sends a slow, heavy orb that passes through two bodies and knocks back each body it hits.",
  },
  {
    id: "plague_bloom",
    rarity: "rare",
    tags: ["attack", "mid", "poison", "dot", "area"],
    /*
     * Cheaper, and a fourth spore. It measured at 0.16 of the sword, the
     * worst key in the pool by a wide margin, and a rare card the player is
     * offered at the cost of two real ones cannot be the weakest thing they
     * own. The spores themselves stayed light: the poison is the spell.
     */
    mana: 5,
    params: { damage: 1.9, speed: 420, radius: 4, count: 4, spread: 22, lifetime: 1.1, pierce: 0, element: "poison", element_power: 3.3, status_scale: 1.5, seek: 0, curve: 30, weight: 0.6 },
    description:
      "Plague Bloom scatters a spray of spores that do not steer and poison each body they touch.",
  },
  /*
   * The three shapes that are not projectiles — see `fireOnce` in
   * `sim/cast.ts` and doc 013, "Spell shapes". Each fills a role no shot can:
   * damage that follows the body, ground denied for a while, and cover placed
   * where the player wants it.
   */
  {
    id: "spirit_blades",
    rarity: "common",
    // Blade only: a second style tag would make `keys_lean` read a Blade run as `mixed`.
    tags: ["attack", "short", "none", "melee"],
    mana: 4,
    params: {
      /*
       * Three damage a blade and a wider ring, from 2.5 and 40 px. The Blade
       * style's opener was the slowest of the five starters to put a body
       * down, and the reason was reach rather than damage: at 40 px the ring
       * sat inside the distance a body stands at when it arrives, so the
       * blades spent much of their four seconds cutting air. 48 px is the
       * width of the space a body actually occupies when it closes. The
       * identity is unchanged — many small hits, paid for by standing in the
       * rush — and it is still the cheapest damage in the pool per hit.
       *
       * Damage per blade set by the **pack** rather than by one body: a ring
       * turning through six bodies is five times what it does to one, so at
       * cluster-level single-target damage it cleared a crowd faster than the
       * sword does, which is not a thing a base spell may do.
       */
      shape: "orbit", damage: 3.8, speed: 0, radius: 5, count: 3, spread: 0, lifetime: 4,
      pierce: 0, element: "none", orbit_radius: 48, spin: 300, seek: 0, curve: 0,
    },
    description:
      "Spirit Blades sets three blades circling close round the caster for a few seconds, cutting each body they pass through; a recast renews the ring rather than adding to it.",
  },
  {
    id: "wildfire_field",
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
       *
       * What actually fixed the overlap was the rule in `resolveFires`: a
       * body pays the burning-ground toll **once**, however many patches it
       * is standing in. That halved the spell on its own, and these figures
       * are it re-levelled afterwards — the patch itself is worth more now,
       * and re-lighting ground that is already alight is worth nothing.
       */
      shape: "field", damage: 3.9, speed: 0, radius: 34, count: 1, spread: 0, lifetime: 5.6,
      pierce: 0, element: "fire", element_power: 0.35, status_scale: 1.35, reach: 120, seek: 0, curve: 0,
    },
    description:
      "Wildfire Field sets a patch of ground alight under the nearest body, burning whatever stands in it until it dies down.",
  },
  {
    id: "blink_strike",
    rarity: "uncommon",
    tags: ["attack", "short", "none", "nuke", "melee"],
    mana: 4,
    /*
     * Raised from 0.24 of the sword, and then held down by the **pack**: the
     * dash cuts everything it passes through, so what it does to six bodies
     * is five times what it does to one, and that is what sets the number.
     */
    params: {
      shape: "dash", damage: 11.0, speed: 0, radius: 12, count: 1, spread: 0, lifetime: 0.22,
      pierce: 0, element: "none", seek: 0, curve: 0, windup_ms: 0, recover_ms: 120,
    },
    description:
      "Blink Strike throws the caster a short way forward, cutting each body passed through once; the caster cannot be hit during the travel.",
  },
  {
    id: "void_maw",
    rarity: "uncommon",
    tags: ["attack", "mid", "none", "area"],
    mana: 6,
    /*
     * Raised from 0.17 of the sword. It still sits at the bottom of the pool
     * on one body and at six times that on a crowd, which is the trade an
     * area specialist is allowed to make.
     */
    params: {
      /*
       * `collapse` (doc 006): as the pull ends it implodes on whatever it
       * still holds. Part of what the ticks dealt moved into the implosion,
       * so gathering a pack and keeping it gathered is what the spell pays
       * for, and a body that walks out before the end misses the larger part.
       */
      shape: "vortex", damage: 1.6, speed: 0, radius: 70, count: 1, spread: 0, lifetime: 3,
      pierce: 0, element: "none", reach: 110, pull: 140, seek: 0, curve: 0, collapse_damage: 6,
    },
    description:
      "Void Maw opens a pull under the nearest body that drags the bodies round it inward for a few seconds, hurting what it holds, then implodes on every body still inside.",
  },
  {
    id: "spirit_ally",
    rarity: "rare",
    tags: ["attack", "mid", "none", "spam"],
    mana: 6,
    // Trimmed into the cluster with the re-level.
    params: {
      shape: "summon", damage: 9.8, speed: 150, radius: 6, count: 1, spread: 0, lifetime: 8,
      pierce: 0, element: "none", reach: 260, interval: 0.7, seek: 0, curve: 0,
    },
    description:
      "Spirit Ally calls a companion that follows the caster and shoots the nearest body in reach on its own clock for a while; a recast renews it.",
  },
  /*
   * Three roles the pool had no spell for (task 6), each built from the bolt
   * rather than a new shape: an answer to being surrounded, an answer to not
   * being able to aim, and an answer to a corridor.
   */
  {
    id: "frost_nova",
    rarity: "uncommon",
    tags: ["attack", "short", "ice", "control", "area", "melee"],
    mana: 3,
    // An odd count, so one shard flies down the aim: with twelve the body aimed at stood in the gap.
    // Cheaper and heavier: at 0.17 of the sword it was the worst key in the pool, and the answer
    // to being surrounded is the wrong thing to ration.
    params: { damage: 7.5, speed: 380, radius: 5, count: 11, spread: 330, lifetime: 0.38, pierce: 1, element: "ice", element_power: 0.8, seek: 0, curve: 0, weight: 0.5 },
    description:
      "Frost Nova throws a ring of ice shards out from the caster that stops a short way out, slowing each body it hits and filling its chill gauge.",
  },
  {
    id: "seeker_swarm",
    rarity: "uncommon",
    tags: ["attack", "long", "none", "spam", "tracking"],
    mana: 4,
    // Raised into the cluster from 0.53 of the sword.
    params: { damage: 2.7, speed: 420, radius: 3, count: 4, spread: 70, lifetime: 1.6, pierce: 0, element: "none", seek: 520, curve: 22, weight: 0.3 },
    description:
      "Seeker Swarm looses a handful of small darts that each steer hard onto the nearest body.",
  },
  {
    id: "fault_line",
    rarity: "uncommon",
    tags: ["attack", "long", "none", "nuke", "area"],
    mana: 5,
    // Raised: at 0.21 of the sword a corridor spell was a bad key in a corridor too.
    params: { damage: 12.6, speed: 720, radius: 6, count: 1, spread: 0, lifetime: 0.5, pierce: 99, element: "none", seek: 0, curve: 0, weight: 1.8, cooldown_scale: 1.4 },
    description:
      "Fault Line drives a blade of stone straight ahead that passes through every body in its line.",
  },
  {
    id: "stone_ward",
    rarity: "common",
    tags: ["attack", "short", "none", "control", "melee"],
    mana: 3,
    params: {
      shape: "pillar", damage: 9, speed: 0, radius: 14, count: 1, spread: 0, lifetime: 6,
      pierce: 0, element: "none", reach: 64, seek: 0, curve: 0,
    },
    description:
      "Stone Ward raises a stone pillar between the caster and what they face, shoving and hurting what stands beside it; it blocks bodies and shots from either side until worn down.",
  },
  /*
   * Eight spells on the newer options (doc 006, "The rules of the newer
   * shapes and options"): each is an existing shape with one rule added, so
   * the cast, the affix hooks and the balance gates already know what it is.
   * Priced by what the option asks of the player — convenience costs damage,
   * risk earns it — and every figure is provisional, held to the bench.
   */
  {
    id: "mana_darts",
    rarity: "uncommon",
    tags: ["attack", "mid", "none", "spam"],
    mana: 2,
    params: {
      /*
       * `charges`: a dart banked every `charge_ms` while the key rests, up
       * to five, all of them loosed by one press for one cast's price. The
       * charge rate is the ceiling on damage per second, so the bench taps
       * on every charge, which is the fastest and dearest way to hold it.
       * The darts seek (the discounted half of the band), and a bank of
       * five in a fan is the Barrage choice between press often and release
       * at once.
       */
      damage: 5.9, speed: 640, radius: 3, count: 1, spread: 16, lifetime: 1.1, pierce: 0, element: "none",
      seek: 260, curve: 8, weight: 0.5, charges: 5, charge_ms: 420,
    },
    description:
      "Mana Darts banks a dart while its key is left alone, up to five; a press looses every banked dart at once, in a tight fan that steers onto the body in front.",
  },
  {
    id: "arcane_cannon",
    rarity: "rare",
    tags: ["attack", "long", "none", "nuke"],
    mana: 5,
    params: {
      /*
       * `charge`: held to charge for up to `charge` ms with the caster at
       * half speed, released to fire; the shot grows from a quarter at a tap
       * to the whole figure (`chargeScale`), and a full charge staggers. The
       * premium half of the band, and a single hit toward the slow-nuke
       * ceiling: the charge is a second of standing in a fight doing nothing.
       * No windup of its own — the charge is the windup.
       */
      damage: 20, speed: 720, radius: 7, count: 1, spread: 0, lifetime: 1.2, pierce: 2, element: "none",
      seek: 60, curve: 0, weight: 1.4, charge: 900, windup_ms: 0, recover_ms: 200, move_scale: 0.5,
    },
    description:
      "Arcane Cannon charges while its key is held, slowing the caster, and fires on release: a piercing shot that grows with the charge. A full charge staggers; a dash cancels it unpaid.",
  },
  {
    id: "doom_sigil",
    rarity: "uncommon",
    tags: ["attack", "mid", "none", "nuke", "dot"],
    mana: 4,
    params: {
      /*
       * `doom`: the bolt marks the body and the mark bursts `doom` ms later
       * for `doom_damage` round it. The burst is the spell — most of what it
       * deals, which is what the Affliction gate asks of a `dot` spell — and
       * the delay is the risk, so it is priced in the upper half. The
       * cooldown outlasts the mark, so the next cast finds the body free to
       * be marked again rather than spending a press on a hit that cannot.
       */
      damage: 9, speed: 520, radius: 5, count: 1, spread: 0, lifetime: 1.3, pierce: 0, element: "none",
      seek: 150, curve: 10, weight: 1, doom: 2200, doom_damage: 30, doom_radius: 40, cooldown_scale: 6,
    },
    description:
      "Doom Sigil fires a bolt that marks the body it hits; a few seconds later the mark bursts, hurting it and what stands beside it. A marked body cannot be marked again until then.",
  },
  {
    id: "frozen_orb",
    rarity: "rare",
    tags: ["attack", "mid", "ice", "control", "area"],
    mana: 6,
    params: {
      /*
       * `emit`: a slow orb that passes through everything, throwing a chilling
       * shard every `emit_ms` in a turning direction and bursting into a ring
       * of `emit` of them where it ends. An orb aims itself across the room,
       * so it is priced in the lower half; its cooldown is as long as the orb
       * flies, so a held key keeps one in the air rather than a flock.
       */
      damage: 11, speed: 140, radius: 8, count: 1, spread: 0, lifetime: 2, pierce: 99, element: "ice",
      element_power: 0.5, seek: 0, curve: 0, weight: 0.8, emit: 10, emit_ms: 120, emit_damage: 3.8,
      cooldown_scale: 3.6,
    },
    description:
      "Frozen Orb sends a slow orb of ice through everything in its path, throwing chilling shards round itself as it flies and bursting into a ring of them at the end.",
  },
  {
    id: "contagion",
    rarity: "rare",
    tags: ["attack", "mid", "poison", "dot"],
    mana: 4,
    params: {
      /*
       * `contagion`: a heavy poison, and a body carrying it passes it on when
       * it dies, to up to `contagion` bodies within `contagion_reach`, which
       * carry it on in turn. The jump is worth nothing to a body that will
       * not die, so the bench's pinned dummies measure the poison alone; the
       * rest of its value is in a real room.
       */
      damage: 2.9, speed: 460, radius: 5, count: 1, spread: 0, lifetime: 1.2, pierce: 0, element: "poison",
      element_power: 4.2, status_scale: 1.6, seek: 140, curve: 20, weight: 0.8, contagion: 3, contagion_reach: 96,
    },
    description:
      "Contagion fires a glob of heavy poison. When a body poisoned by it dies, the poison jumps to a few bodies nearby, which carry it on in turn.",
  },
  {
    id: "meteor",
    rarity: "rare",
    tags: ["attack", "long", "fire", "nuke"],
    mana: 6,
    params: {
      /*
       * `telegraph_ms`: the ground under the body it seeks is marked, and
       * the rock lands after the telegraph — one cell, large, burning the
       * floor after (`burn_ms`), as a flame eruption does. The telegraph is
       * the risk (a body can walk out), so the hit goes toward the slow-nuke
       * ceiling. The bench's bodies are pinned and cannot walk out, so it
       * measures the landing that a moving room will sometimes refuse.
       */
      damage: 24, speed: 0, radius: 34, count: 1, spread: 0, lifetime: 0.4, pierce: 0, element: "fire",
      element_power: 0.4, seek: 0, curve: 0, weight: 2.2, shape: "eruption", eruption: "fire", pattern: "scatter",
      reach: 5, area: 0, delay_ms: 0, telegraph_ms: 700, burn_ms: 500, windup_ms: 250, recover_ms: 300,
      move_scale: 0.5, cooldown_scale: 4,
    },
    description:
      "Meteor marks the ground under the body it seeks; a moment later a burning rock lands in the mark, hitting all within it and leaving the floor alight. A body can walk out of the mark.",
  },
  {
    id: "quake_ring",
    rarity: "uncommon",
    tags: ["attack", "short", "none", "area", "melee"],
    // Rank 5 and two and a half times the cooldown its price gives it: every
    // body round the caster, staggered, twice a second, was the strongest key
    // in the pool against a crowd.
    mana: 5,
    params: {
      /*
       * The `ring` pattern: rings of cells round the caster, `step` tiles
       * apart, each a beat after the last, hitting each body once between
       * them and staggering it. Cast from inside the crowd, so the bench
       * measures it at arm's length; set by the pack, as every spell that
       * hits all round the caster is.
       *
       * Two rings, their cells spread wider (`ring_spacing`): three dense
       * rings raised sixty-odd spikes a cast and covered half the screen,
       * which read as alarming rather than as a spell. A body is hit once a
       * cast either way, so what came down was the clutter, not the damage.
       */
      damage: 9.8, speed: 0, radius: 14, count: 2, spread: 0, lifetime: 0.4, pierce: 0, element: "none",
      seek: 0, curve: 0, weight: 1.4, shape: "eruption", eruption: "earth", pattern: "ring",
      first: 1.1, step: 1.1, ring_spacing: 2.2, delay_ms: 110, windup_ms: 220, recover_ms: 280, move_scale: 0.5, cooldown_scale: 2.5,
    },
    description:
      "Quake Ring breaks the ground in rings out from the caster, one after another, hitting and staggering each body once. A wall stops it.",
  },
  {
    id: "leap_slam",
    rarity: "uncommon",
    tags: ["attack", "short", "none", "nuke", "melee"],
    mana: 5,
    params: {
      /*
       * `land`: the dash goes to the body it seeks, untouchable in the air
       * and cutting nothing, and comes down in `land` rings of erupting
       * ground — a cell on the landing and a ring round it. A leap into the
       * pack is the premium end of the band, held down by the pack: the
       * landing hits everything round it.
       */
      shape: "dash", damage: 12.5, speed: 0, radius: 16, count: 1, spread: 0, lifetime: 0.3, pierce: 0,
      element: "none", seek: 0, curve: 0, weight: 1.6, land: 2, first: 0, step: 1.2, delay_ms: 90,
      eruption: "earth", windup_ms: 120, recover_ms: 260, cooldown_scale: 1.6,
    },
    description:
      "Leap Slam leaps at the body it seeks, untouchable in the air, and lands in a ring of broken ground that hits everything round the landing.",
  },
  /*
   * Six spells on doc 006's five newer shapes, and the field that honours
   * its element. Priced as the rest of the pool is, by what the delivery asks
   * of the player (doc 006, "Pricing delivery"): an orb, a trail, an enchant
   * and a field keep working without the player and sit in the lower half of
   * the band; a stance commits the caster to standing in the hit and sits in
   * the upper half; a thrown blade is aimed and caught, and sits between.
   * Descriptions are the neutral facts doc 006 asks for — what the spell
   * does, and nothing about who it suits. Every figure is provisional, held
   * to the bench (`pnpm spell-bench`) and its three scenarios.
   */
  {
    id: "ball_lightning",
    rarity: "uncommon",
    tags: ["attack", "mid", "none", "spam"],
    mana: 4,
    params: {
      /*
       * `orb`: drifts at `speed` from the hand toward the body sought and
       * strikes the nearest body within `zap_reach` every `zap_ms`, up to
       * `max_alive` from the key, the newest replacing the oldest. No contact
       * damage — its damage is its strikes. Lower half of the band: it aims
       * itself and keeps striking while the caster does something else.
       * Measured at the far station: it is thrown, and it drifts into reach
       * of a body across the room on its own.
       */
      shape: "orb", damage: 2.45, speed: 45, radius: 7, count: 1, spread: 0, lifetime: 3.6, pierce: 0,
      element: "none", seek: 0, curve: 0, weight: 0.3, zap_ms: 350, zap_reach: 90, max_alive: 3,
      windup_ms: 60, recover_ms: 160, move_scale: 0.8,
    },
    description:
      "Ball Lightning sends a slow orb drifting from the hand that strikes the nearest body in reach several times a second; a few can be out at once, and a new one replaces the oldest.",
  },
  {
    id: "returning_edge",
    rarity: "common",
    tags: ["attack", "short", "none", "melee"],
    mana: 3,
    params: {
      /*
       * `boomerang`: a spectral sword thrown `reach` px, slowing, and coming
       * back to where the caster is by then, cutting each body once each way.
       * Aimed and caught, so the middle of the band. Measured at arm's length,
       * where a spell tagged `melee` is meant to be used: its reach covers the
       * close pack both ways, and a body at the far station stands past it.
       */
      shape: "boomerang", damage: 5.6, speed: 360, return_speed: 380, reach: 110, radius: 9, count: 1, spread: 0,
      lifetime: 2.5, pierce: 0, element: "none", seek: 0, curve: 0, weight: 1, windup_ms: 60, recover_ms: 140,
      move_scale: 0.7, cooldown_scale: 2,
    },
    description:
      "Returning Edge throws a spectral sword ahead that slows, turns and comes back to wherever the caster is, cutting each body once on the way out and once on the way back.",
  },
  {
    id: "crescent_edge",
    rarity: "common",
    tags: ["attack", "short", "none", "melee"],
    mana: 4,
    params: {
      /*
       * `enchant`: for `enchant_ms` every sword swing, hit or miss, also
       * throws a wave as its active window ends — the middle of the arc the
       * blade's tip traced, flying forward at the swing's size — `wave_reach`
       * past the swing and through every body it crosses; the sword's own
       * figures do not change. `speed` flies that in a quarter second;
       * `radius` is half the band's thickness, so a body at the swing's edge
       * is crossed by both. Lower half of the band, since it works off swings the player
       * makes anyway, and measured in the bench's swinging scenario on the
       * waves alone. Its cooldown outlasts the enchant (`lastingMs`), so a
       * held key keeps one up.
       */
      shape: "enchant", damage: 4.1, speed: 320, radius: 12, count: 1, spread: 0, lifetime: 5, pierce: 0,
      element: "none", seek: 0, curve: 0, weight: 0.6, enchant_ms: 5000, wave_reach: 80,
      windup_ms: 0, recover_ms: 80, move_scale: 1,
    },
    description:
      "Crescent Edge enchants the sword for a while: every swing, hit or miss, also throws a crescent wave ahead that passes through each body in its reach. A recast renews it.",
  },
  {
    id: "counter_stance",
    rarity: "uncommon",
    tags: ["attack", "short", "none", "melee"],
    mana: 4,
    params: {
      /*
       * `stance`: for `stance_ms` the caster is slowed and cannot swing; the
       * first enemy hit that would land is cancelled, the caster is
       * untouchable for a moment, and the stance answers with a spin slash
       * of the spell's damage within `answer_radius`, staggering; with
       * nothing taken it answers anyway at `expire_share`. The premium half
       * of the band — the caster has to stand where the hit is going to land
       * — measured in the bench's attacked scenario. Thrown seldom, so its
       * one cut is a slow nuke's.
       */
      shape: "stance", damage: 21.6, speed: 0, radius: 56, answer_radius: 56, count: 1, spread: 0, lifetime: 0.7,
      pierce: 0, element: "none", seek: 0, curve: 0, weight: 1.6, stance_ms: 700, expire_share: 0.4,
      windup_ms: 0, recover_ms: 60, move_scale: 0.45, cooldown_scale: 2.2,
    },
    description:
      "Counter Stance raises a short guard that slows the caster and holds the sword; the next hit that would land is cancelled and answered with a spin slash that staggers. Untouched, it answers at a fraction as it ends.",
  },
  {
    id: "dash_slash",
    rarity: "uncommon",
    tags: ["attack", "short", "none", "melee"],
    mana: 4,
    params: {
      /*
       * A `dash` with a **wake** (`wake_reach`), after Minish Cap's dash
       * attack: the sword held out ahead through a short run, cutting each
       * body it passes once, and either side of the line the cut's edge
       * rolls off it — a stretch every `wake_step` px, each set off as the
       * player passes, out `wake_reach` px at `wake_speed` — cutting each
       * body it crosses at `wake_share` of the run's cut — a body the run
       * itself cut is not cut again. Where Blink Strike is a line, this is
       * a line and the ground beside it: a pack that parts round the player
       * is still cut. Aimed and committed to, so the middle of the band,
       * held down by the pack as the other dashes are; measured, a wake that
       * cut the run's own bodies a second time put its pack at eight times
       * its single, past every other dash.
       */
      shape: "dash", damage: 10.5, speed: 0, radius: 12, count: 1, spread: 0, lifetime: 0.26,
      pierce: 0, element: "none", seek: 0, curve: 0, weight: 1.1, windup_ms: 40, recover_ms: 140,
      wake_reach: 40, wake_share: 0.55, wake_step: 10, wake_speed: 240, wake_thick: 12,
    },
    description:
      "Dash Slash runs the caster a short way forward with the sword held out, cutting each body passed through; the cut's edge rolls off either side of the run and cuts what it crosses. The run cannot be hit.",
  },
  {
    id: "cinder_stride",
    rarity: "uncommon",
    tags: ["attack", "short", "fire", "dot"],
    mana: 4,
    params: {
      /*
       * `trail`: for `trail_ms` a patch of burning ground every `drop_px` of
       * the caster's travel, each burning `patch_ms`. Distance, not time:
       * standing still lays nothing. The caster's own ground never burns the
       * caster. Lower half of the band, as ground that works on its own; its
       * damage is the burn it lights, and it is measured in the bench's
       * walking scenario. Its cooldown outlasts the trail (`lastingMs`).
       */
      shape: "trail", damage: 3.6, speed: 0, radius: 20, count: 1, spread: 0, lifetime: 4, pierce: 0,
      element: "fire", element_power: 0.35, status_scale: 1.15, seek: 0, curve: 0, trail_ms: 4000, drop_px: 18, patch_ms: 2200,
      windup_ms: 0, recover_ms: 60, move_scale: 1,
    },
    description:
      "Cinder Stride sets the ground alight behind the caster for a few seconds: a patch for every stride walked, none while standing still, burning what steps in it and never the caster.",
  },
  {
    id: "toxic_cloud",
    rarity: "uncommon",
    tags: ["attack", "mid", "poison", "dot"],
    mana: 5,
    params: {
      /*
       * A `field` of the poison element (doc 006): a cloud under the nearest
       * body that poisons and slows what stands in it, and burns nothing.
       * Lower half of the band, as a field is; its damage is the poison.
       * The cooldown outlasts the cloud (doc 006, "Mana, cooldown and
       * level"), so a held key keeps one cloud up rather than a carpet.
       */
      shape: "field", damage: 1.9, speed: 0, radius: 36, count: 1, spread: 0, lifetime: 5, pierce: 0,
      element: "poison", element_power: 0.5, status_scale: 1.45, reach: 120, seek: 0, curve: 0, cooldown_scale: 10.5,
    },
    description:
      "Toxic Cloud spreads a cloud of poison under the nearest body that poisons and slows everything standing in it until it thins away.",
  },
];

export const BASE_ITEMS: readonly BaseItem[] = ATTACKS;

/**
 * **The one spell a run starts with**, by the style the player chose: it goes
 * on the first key and the other two start empty. Shared by the scene and the
 * harness so a measured run starts where a played one does.
 */
export const STYLE_START: Readonly<Record<Archetype, string>> = {
  spam: "shock_arc", nuke: "earth_spikes", area: "scatter_shot", dot: "ember_dart", melee: "crescent_edge",
};

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
 *  a content bug, and silently dropping it would hide it. */
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

/** An instance of a base item: what a slot holds and an offer hands out. */
export function plainInstance(baseId: string, uid = baseId, items: ItemRegistry = ITEMS): ItemInstance {
  const base = baseOf({ base: baseId }, items);
  return { uid, base: baseId, rarity: base.rarity };
}
