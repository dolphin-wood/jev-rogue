/**
 * Enemy behaviour and firing (design doc 005). Movement is four rules and no
 * pathfinding; firing expands the declared pattern over the step window, so
 * the shape of a volley is data and adding an enemy is adding a pattern.
 */
import { BEAT_MS, BOSS_RAGE_TEMPO, beats, untilGrid } from "./beat.ts";
import { ENEMIES, baseArchetype, fillSubspecies, expandPattern, rampFor, resistOf } from "../encounters/index.ts";
import type { BulletEmission } from "../encounters/patterns.ts";
import type { BossPhase } from "../encounters/enemies.ts";
import { affixStats } from "../encounters/affixes.ts";
import type { EliteAffix, EnemyId, MeleeKind } from "../types.ts";
import { TILE_PX, GRID_W, GRID_H } from "../types.ts";
import { PLAYER_RADIUS, PLAYER_SPEED } from "./types.ts";
import type { Enemy, World } from "./types.ts";
import {
  ENEMY_BULLET_CAP, SUMMONER_INTERVAL_S, SUMMONER_MINION_CAP, MAX_CONCURRENT_ENEMIES, BOSS_PHASES, bossPhaseAt, kingHp, KING_RETREAT_AT } from "../encounters/enemies.ts";
import type { BossScript } from "../encounters/enemies.ts";
import { GUARDIAN_ATTACK_GAP_MULT, GUARDIAN_ATTACK_RANGE_MULT, GUARDIAN_CHARGE_GAP_MULT, GUARDIAN_SHOT_EVERY, GUARDIAN_STANCE, GUARDIAN_WALL_STANCE, wearStance } from "./guardian.ts";

const SUMMONER_INTERVAL_MS = SUMMONER_INTERVAL_S * 1000;
/**
 * The first summon, from spawn. Not the full interval: a summoner that stands
 * for six seconds before it does anything reads as a body that does nothing,
 * and the player has walked past it before it has explained itself.
 */
const SUMMONER_FIRST_MS = 1500;
import { acquire, liveCount } from "./bullets.ts";
import { moveSliding, normalise, dist2, hasLineOfSight, circleHitsWall } from "./collide.ts";
import { distanceAt, followField, UNREACHABLE } from "./flow.ts";
import { turnToward } from "./aim.ts";
import {
  makeStrike, makeSwingBox, armMeleeAttack, advanceBox, markStrike, strikeMarked,
  wallSlamSquareness, MELEE_ATTACKS, ENEMY_MELEE_DAMAGE,
} from "./melee.ts";
import {
  HASTE_SPEED, cancelDive, castRanged, castShockwave, isElite, layWake, startWake, planted, riftLance, shockCleave, shockRing, sightBeam,
  stepExpansion, submerged,
} from "./attacks.ts";

/**
 * How far behind the player each archetype's perception runs, in ms.
 *
 * The player reacts in about a quarter of a second. An enemy reading the live
 * position reacts in none, and the result is not a hard fight but an unfair
 * one: perfect pursuit, perfect aim, and a ring of bodies already facing you
 * wherever you go. So every body is given a lag of its own, and the roster
 * uses it as a character trait rather than a global handicap.
 *
 * - The **rusher** is quick-witted at 130 ms, which is still slower than a
 *   player and is what keeps it threatening.
 * - The **tank** is slow at 320 ms, so it can be led: walk across its face
 *   and it commits to where you were, which is the whole reason its charge
 *   can be dodged and steered into a wall.
 * - Ranged bodies sit between, because aiming at a stale position is what
 *   makes strafing work at all — a turret that marks exactly where you stand
 *   the instant you stand there is not answerable by moving.
 */
// Stated for the base bodies; every subspecies takes its base's (doc 019).
const PERCEPTION_MS: Readonly<Record<EnemyId, number>> = fillSubspecies<number>({
  /*
   * The boss reacts fastest in the roster, deliberately.
   *
   * Perception lag is the roster's fairness mechanism — a body decides from
   * where the player *was*, so a sidestep works. 90 ms still leaves a readable
   * window, and this is the one fight the player arrived at on purpose, on
   * tells they have practised all run, with a finished build to answer them.
   */
  boss: 90,
  rusher: 130,
  shooter: 190,
  turret: 230,
  orbiter: 170,
  tank: 320,
  summoner: 150,
  // Variants: the lancer reads as its parent the rusher does, the sentinel as the turret.
  lancer: 130,
  sentinel: 230,
  // The expansion: the heavy and the planted read slowly, the quick ones fast.
  warden: 300,
  bellringer: 200,
  rifter: 240,
  snarecaster: 180,
  delver: 160,
  cinderling: 220,
  sower: 210,
});

/**
 * How often a body looks up to see where the player is, in ms.
 *
 * Between glances it keeps turning toward the last place it looked, so its
 * head is usually a little behind and sometimes plainly wrong. That is the
 * difference between a creature and a tracking turret, and the turret was the
 * first thing this was: aiming the facing at the live position every frame
 * made a room of enemies swivel in lockstep with the player, never late and
 * never mistaken, which is unnerving rather than dangerous.
 *
 * Half a second is long enough for a player crossing a body's front to get
 * behind it and short enough that it does not look oblivious.
 */
const GLANCE_MS = 520;

/**
 * Where a body is currently looking, which is where it last saw the player
 * rather than where they are.
 *
 * Updated on the glance clock in `stepEnemy`. A body that has not glanced yet
 * this cycle keeps turning toward its stale target, which is what lets the
 * player break its line of sight by moving.
 */
export function facingTarget(_world: World, e: Enemy): { x: number; y: number } {
  return { x: e.lookX, y: e.lookY };
}

/**
 * Where a body believes the player is.
 *
 * Offset per enemy id as well as per archetype, so a group of the same kind
 * does not read the same frame and turn as one animal.
 */
export function seenPlayer(world: World, e: Enemy): { x: number; y: number } {
  const trail = world.playerTrail;
  if (trail.length === 0) return world.player;
  // A subspecies perceives as its base: it is the same body with one verb
  // changed, and reaction time is not the verb.
  const lagMs = PERCEPTION_MS[e.archetype] + (e.id % 4) * 25;
  const back = Math.round(lagMs / (1000 / 60));
  return trail[Math.max(0, trail.length - 1 - back)] ?? world.player;
}

/**
 * Each archetype's gait: how long one push-and-settle cycle takes, and what
 * share of it is the push.
 *
 * The values are characterisations rather than tuning. A rusher pushes hardest
 * and most often; a tank is always moving and always heavy. The ranged bodies
 * sit between.
 *
 * **Gentler and slower than the first attempt**, which was a stutter rather
 * than a rhythm. A 1.7x burst over 55% of a 620 ms cycle implies a settle of
 * 0.14 — very nearly a dead stop, twice a second — so pursuit read as
 * walk-stop-walk instead of as something breathing. The bursts are now 1.1 to
 * 1.3 over cycles of one to two seconds, which puts the settle at half speed
 * or better and gives the cycle time to be felt as a gait.
 *
 * Every entry is normalised so the average multiplier is exactly 1. The
 * roster's speeds were balanced against a constant velocity and this changes
 * only what they feel like, never what they average.
 */
const GAIT: Readonly<Record<EnemyId, { periodMs: number; duty: number; burst: number }>> = fillSubspecies<{ periodMs: number; duty: number; burst: number }>({
  rusher: { periodMs: 1100, duty: 0.6, burst: 1.3 },
  shooter: { periodMs: 1300, duty: 0.6, burst: 1.25 },
  orbiter: { periodMs: 1500, duty: 0.7, burst: 1.18 },
  summoner: { periodMs: 1400, duty: 0.6, burst: 1.22 },
  tank: { periodMs: 1900, duty: 0.75, burst: 1.1 },
  /*
   * The boss does not amble. A gait is push-and-settle — it makes a body look
   * like it is deciding — and the one thing this body must never look like is
   * undecided. A flat multiplier keeps it walking at you without pause, which
   * is most of what makes it feel inevitable.
   */
  boss: { periodMs: 1000, duty: 1, burst: 1 },
  // Stationary: a gait it never uses, declared so the table is total.
  turret: { periodMs: 1000, duty: 1, burst: 1 },
  lancer: { periodMs: 1000, duty: 0.55, burst: 1.35 },
  sentinel: { periodMs: 1000, duty: 1, burst: 1 },
  warden: { periodMs: 2000, duty: 0.75, burst: 1.1 },
  bellringer: { periodMs: 1500, duty: 0.6, burst: 1.2 },
  rifter: { periodMs: 1000, duty: 1, burst: 1 },
  snarecaster: { periodMs: 1400, duty: 0.6, burst: 1.22 },
  delver: { periodMs: 1100, duty: 0.6, burst: 1.3 },
  cinderling: { periodMs: 1600, duty: 0.7, burst: 1.15 },
  // It floats: a slow even drift, no footfall.
  sower: { periodMs: 1000, duty: 1, burst: 1 },
});

/**
 * The speed multiplier this body is at right now.
 *
 * Normalised so the cycle averages 1: whatever is not spent on the burst is
 * taken off the settle, so a gait never quietly changes an archetype's speed.
 */
/** How much of each gait's authored push-and-settle is used. */
const GAIT_DEPTH = 0.5;

export function gaitScale(e: Enemy): number {
  const g = GAIT[e.archetype];
  if (g.duty >= 1) return 1;
  // Half the authored swing: at full depth the settle half of the cycle
  // nearly stopped a body, which read as hesitating, not as breathing.
  const burst = 1 + (g.burst - 1) * GAIT_DEPTH;
  // burst * duty + settle * (1 - duty) = 1
  const settle = Math.max(0, (1 - burst * g.duty) / (1 - g.duty));
  return (e.gaitMs % g.periodMs) / g.periodMs < g.duty ? burst : settle;
}

export const TELEGRAPH_MS = 300;
/**
 * How long a body takes to arrive.
 *
 * Raised from 500 ms, which was not enough for the arrival to be an event: the
 * old version was an alpha fade plus a squash and read as a sprite being
 * switched on. At 700 there was time for the ground to open, the body to rise
 * out of it and the landing to land. Cut again to 550, with the ring
 * telegraph before it cut from 1100 to 650, once the two became one motion
 * (the body climbs while the rings pulse): 1.8 s of arrival was reported as
 * slow, and 1.2 s still shows the whole climb. The enemy is intangible for
 * all of it, so a shorter spawn is a shorter grace period, not a harder one.
 */
export const SPAWN_FADE_MS = 380;

/**
 * **What every body's health is multiplied by**, once, on top of its own
 * figure, its elite affixes and the room's ramp.
 *
 * A spell is thrown about once a second where the sword swings nearly four
 * times a second, so a spell that is worth casting has to land several
 * swings' worth in one hit. At the health the roster was written for — a
 * first-room rusher at 20, three swings — a hit that size is a one-shot, and
 * a pool levelled to the sword by damage per second deleted the first room
 * before the player had pressed a second key.
 *
 * Raising the roster together is the one lever that lets both be true: the
 * sword still ends a first-room body in five swings, a starting spell still
 * takes two or three casts, and neither is trivial. One number rather than
 * thirty edited figures, because the *shape* of the roster — what a rusher is
 * worth against a tank — is right and only its scale against the player's
 * damage was wrong. The ramp curve is untouched and multiplies on top.
 *
 * `pnpm spell-bench` prints both counts and asserts them.
 */
export const ENEMY_HP_SCALE = 1.0;

/**
 * What a status ticks for, per second (a poison's figure is per stack, and a
 * full gauge gives two).
 *
 * **The tick is where a damage-over-time spell's value lives** (doc 006). It
 * was 2 a second for a burn, which over its three seconds is six damage —
 * less than one hit of the spell that lit it, so every "dot" spell in the
 * pool was really a direct-damage spell with a decoration, and the honest
 * play was to ignore the element entirely. At five a second a burn is fifteen
 * and a poison twenty, which is most of what those spells do; their direct
 * damage came down to pay for it.
 */
/*
 * **Burn is fast and short; poison is slow and long.** Fifteen damage over
 * three seconds put a dot spell ahead of a nuke — Venom Spit at mana 3 was
 * worth thirteen a cast against Stone Shard's twelve — and a status that
 * out-damages a direct spell of its tier is a status the player takes for the
 * damage rather than for the element. A dot may sit slightly *below* parity,
 * because it keeps working while the player moves on to the next body.
 *
 * The two differ in character rather than in size: a burn is ten over two and
 * a half seconds, a poison fourteen over five in two stacks.
 */
/**
 * How often a status ticks. A burn's 2.5 s is ten of these and a poison's
 * 5 s is twenty, so no partial tick is ever lost at the end.
 */
export const DOT_TICK_MS = 250;

/*
 * **These move with `SPELL_DAMAGE_SCALE`, by the same factor.** That scale
 * multiplies every hit and no status, so a spell whose damage *is* its status
 * — the dart, the spit, the bloom, most of the fire line — tracks these two
 * numbers and nothing else, and the whole damage-over-time line falls out of
 * the pool's band the moment the two are moved apart (`pnpm spell-bench`).
 */
/**
 * **What a body carrying two different elements takes on every hit.**
 *
 * Hades' *Privileged Status*, and for the same reason: elements now stack and
 * coexist rather than overwrite, so a second card of the element you already
 * have is playable — and without this it would be as good as a second
 * element, which makes the reward screen's choice a non-choice. A body that
 * is burning *and* poisoned is worth more than one that is burning twice.
 *
 * Modest on purpose, and it is **not a reaction**: there is nothing to
 * discover, no pair that does something special, and the third element adds
 * nothing over the second. Just a reason to spread.
 */
export const STATUS_BREADTH_MULT = 1.25;

/** How many different elements are running on this body, of fire, poison, ice. */
export function statusBreadth(e: Enemy): number {
  let n = 0;
  if (e.burnMs > 0) n++;
  if (e.poisonMs > 0) n++;
  if (e.frozenMs > 0 || e.slowMs > 0) n++;
  return n;
}

export const BURN_DPS = 6.6;
export const POISON_DPS_PER_STACK = 2.5;

/**
 * How long a status runs once the gauge fills, and how many stacks it starts
 * with. A burn ignites at one source, a poison at two — see `applyElementTo`
 * in `world.ts`, which is the only thing that sets them.
 */
/** A burn is short and a poison is long; see `BURN_DPS`. */
export const ENEMY_BURN_MS = 2500;
export const ENEMY_POISON_MS = 5000;
export const ENEMY_BURN_SOURCES = 1;
export const ENEMY_POISON_STACKS = 2;

/** How long a full ice gauge freezes a body. */
export const ENEMY_FREEZE_MS = 1300;

/**
 * **Shatter.** The first hit on a frozen body breaks the ice and lands at
 * this multiple: freezing is the setup, and this is the payoff that makes ice
 * a build rather than a slow.
 */
export const SHATTER_MULT = 3;
/**
 * Before the body climbs out, the floor says where: rings widen from the
 * spawn point for this long, then the fade begins. A spawn used to be a body
 * appearing where nothing was, which for a bullet hell is the one thing that
 * must not happen — the player reads the floor to plan, and a floor that can
 * grow a rusher without notice cannot be planned on. The whole span is grace:
 * `isActive` is false until the fade ends, as before.
 */
export const SPAWN_TELEGRAPH_MS = 380;
/** What every elite body gets on top of its affixes; see `makeEnemy`. */
/** Doc 005: the fastest body in the roster stays under this share of the player's walk. */
export const ROSTER_SPEED_CEILING = 0.88;
export const ENRAGED_SPEED = 1.15;
export const ENRAGED_INTERVAL = 0.85;
const KEEP_DISTANCE = 180;
/**
 * The distance a `keep_distance` body holds, by archetype. The warden's gun
 * throws flame a few tiles, not across the room: at the shooters' 180 it
 * stood out of its own reach and never touched anyone.
 */
function keepDistance(e: Enemy): number {
  return baseArchetype(e.archetype) === "warden" ? 84 : KEEP_DISTANCE;
}

/**
 * How long a body may give ground before it has to hold, and how long it holds.
 *
 * A second and a half of retreat carries a shooter about 85 px at its speed,
 * which is enough to re-open a gap it has lost but not enough to cross a room
 * backwards. The three-quarter-second hold afterwards is the player's window.
 */
const RETREAT_BUDGET_MS = 1500;
const WINDED_MS = 750;
const ORBIT_RADIUS = 150;
const BLOCKED_NUDGE_MS = 320;
/**
 * Cut from 5. The player's own hitbox is radius 7, so a bullet at 5 scaled by
 * a pattern's 1.4 was radius 7 — **as big as the whole player** — and two of
 * them side by side closed a lane a body could have walked through. A
 * projectile in a melee game has to be something the player reads as a dot to
 * step past, not a disc to be somewhere else from.
 */
const ENEMY_BULLET_RADIUS = 3.4;
const ENEMY_BULLET_DAMAGE = 1;
const SEPARATION_FORCE = 190;
/** How much of a ranged enemy's motion is sideways rather than in and out. */
const STRAFE_WEIGHT = 0.75;
/** Gap a body keeps from the player's edge, so it never sits inside the sprite. */
const STANDOFF = 4;
const PLAYER_SEPARATION_FORCE = 260;
/** Stuck for this long means the sight line is lying; switch to the field. */
const JAM_MS = 220;
/** How much closer a body has to get for it to count as making progress. */
const STUCK_PROGRESS_PX = 3;

/**
 * The melee cycle. A windup long enough to read, a lunge short enough to feel
 * committed, and a recovery that gives the player the window to answer.
 * Roughly Zelda's Darknut rhythm: the enemy asks, you answer, it pays.
 */
export const MELEE = {
  /** Gap at which an approaching body commits to the windup. */
  range: 46,
  windupMs: 280,
  /**
   * How much of the windup the attack spends still tracking the player. After
   * this it is locked and the rest of the windup is the player's window.
   *
   * Without it the whole taxonomy in `MELEE_ATTACKS` was aspirational. A
   * telegraph that tracks until the instant it commits cannot be dodged by
   * angle, because every sidestep is answered by the blade turning, so the
   * only answer left to any attack is distance — and "a thrust is dodged
   * sideways, a slash backwards" collapses into one dodge for everything.
   *
   * 130 ms of locked windup plus the 190 ms lunge is 320 ms to leave the
   * sector, which clears the 250 ms reaction floor the strike marker is also
   * sized against.
   */
  trackMs: 150,
  lungeMs: 190,
  recoverMs: 460,
  /** Backward drift during recovery, as a fraction of base speed. */
  recoilSpeed: 0.55,
  /**
   * How long a body stands down after an attack before it may take another
   * turn. Without it the same enemy reclaims the token the instant it drops
   * it, and a two-token cap becomes two enemies attacking forever while the
   * rest never engage at all.
   */
  /*
   * Raised from 700 ms.
   *
   * A rusher's whole cycle is 280 windup + 190 lunge + 460 recover, so at 700
   * it was committing about every 1.6 s — and with two turns in the room that
   * is an attack landing every 0.8 s, forever. The rest is what makes a fight
   * have gaps in it, and gaps are where the player does anything other than
   * defend.
   */
  restMs: 1300,
} as const;

/**
 * Each archetype's **rhythm** (doc 005, "Rhythm per archetype").
 *
 * The attack owns its shape — reach, arc, damage, how far it travels — and the
 * body owns the *tempo* it performs it at. Without this every melee body in
 * the roster wound up in 280 ms and recovered in 460, so a rusher, a delver
 * and a tank differed in what they did and never in how they felt doing it,
 * and a room of them beat like a metronome.
 *
 * `windup` and `recover` scale the attack's own figures, `rest` the pause
 * after it, `aim` the ranged wind-up (`AIM_MS`). Quick nervous bodies come in
 * under 1 and heavy ones over it, and the sum is what the player hears: a
 * rusher's twitch against a warden's heave.
 *
 * **The floor is fairness, not taste.** A windup is only a question if the
 * player can answer it, so `WINDUP_FLOOR_MS` holds the shortest tell in the
 * game above the 250 ms reaction figure the strike marker is also sized
 * against, whatever the tempo would otherwise do.
 */
interface Tempo {
  readonly windup: number;
  readonly recover: number;
  readonly rest: number;
  readonly aim: number;
}
const DEFAULT_TEMPO: Tempo = { windup: 1, recover: 1, rest: 1, aim: 1 };
const TEMPO: Readonly<Partial<Record<EnemyId, Tempo>>> = {
  // Nervous: it commits early, recovers fast and comes back at you.
  rusher: { windup: 0.86, recover: 0.9, rest: 0.75, aim: 1 },
  lancer: { windup: 0.94, recover: 1, rest: 0.85, aim: 1 },
  delver: { windup: 0.9, recover: 0.95, rest: 0.8, aim: 1 },
  // Heavy: everything it does is announced early and paid for late.
  tank: { windup: 1.18, recover: 1.1, rest: 1, aim: 1 },
  warden: { windup: 1.15, recover: 1.1, rest: 1, aim: 1.2 },
  // Emplacements think slowly and hit from a long way off.
  turret: { windup: 1, recover: 1, rest: 1, aim: 1.2 },
  sentinel: { windup: 1, recover: 1, rest: 1, aim: 1.15 },
  rifter: { windup: 1, recover: 1, rest: 1, aim: 1.15 },
  // Skittish shooters: a short aim, so closing on one is urgent.
  shooter: { windup: 1, recover: 1, rest: 1, aim: 0.85 },
  orbiter: { windup: 1, recover: 1, rest: 1, aim: 0.9 },
  snarecaster: { windup: 1, recover: 1, rest: 1, aim: 0.95 },
  cinderling: { windup: 1, recover: 1, rest: 1, aim: 1.1 },
  sower: { windup: 1, recover: 1, rest: 1, aim: 1.05 },
  bellringer: { windup: 1, recover: 1, rest: 1, aim: 1 },
  summoner: { windup: 1, recover: 1, rest: 1, aim: 1 },
  // The boss keeps the roster's baseline, because its tells are the ones the
  // player has been practising all run and it must not read as a new body.
  boss: { windup: 1, recover: 1, rest: 1, aim: 1 },
};

function tempoOf(e: Enemy): Tempo {
  return TEMPO[e.archetype] ?? DEFAULT_TEMPO;
}

/** No tell in the game is shorter than this, whatever a tempo asks for. */
const WINDUP_FLOOR_MS = 260;
/**
 * How much a single commit's timing wanders around its tempo, either way.
 *
 * "Their actions are stiff and predictable" is mostly this: a body whose
 * windup is exactly 280 ms every time can be answered by counting rather
 * than by watching. A twelfth either way is under the eye's threshold for
 * *unfairness* — the tell is the same tell, at the same reach — and well over
 * its threshold for **sameness**.
 */
const TIMING_JITTER = 0.12;

function jittered(world: World, ms: number): number {
  return ms * (1 + (world.rng.next() * 2 - 1) * TIMING_JITTER);
}

/*
 * **No feints.** A windup is always followed by its blow: the tell is a
 * promise, and one that was sometimes not kept taught the player to wait on
 * it rather than read it — and on the king, whose moves are never
 * interrupted, a blade raised and put away read as the game breaking.
 */

/**
 * How often an attack is followed straight away by another, and how long a
 * string may run.
 *
 * The rusher already did this through `restAfter`, and it was the one body in
 * the roster anybody described as lively. A string is readable because every
 * blow in it keeps its own full windup; what changes is that the recovery the
 * player was going to punish is sometimes not there.
 */
const COMBO: Readonly<Partial<Record<EnemyId, number>>> = {
  rusher: 0.35, lancer: 0.25, delver: 0.3, tank: 0.18, boss: 0.3,
};
/*
 * One extra blow, so a string is a **one-two** and never a three. At two the
 * elite rooms' worst cases went from three and a half hearts to six: a body
 * that is allowed three attacks on one turn is holding the room's attack
 * token for four seconds, and against an enraged elite that is most of a
 * heart bar. The point of a string is that the recovery is sometimes not
 * there, and one repetition says that.
 */
const COMBO_MAX = 1;
/** The pause inside a string, as a share of the attack's ordinary rest. */
const COMBO_REST = 0.22;

/**
 * The **sidestep**: how likely a body is to hop aside when the player commits
 * to a swing or a dash within reach of it, and how long the hop lasts.
 *
 * This is the cheapest reactivity there is and it changes the read of a fight
 * completely: an enemy that moves *because of something the player did* is
 * thinking, and one that walks the same line into the same swing is not.
 * Chasers jump sideways to keep the angle; ranged bodies hop backwards, which
 * is the same instinct pointed the other way.
 */
const JUKE: Readonly<Partial<Record<EnemyId, number>>> = {
  rusher: 0.5, lancer: 0.45, delver: 0.45, orbiter: 0.5, shooter: 0.45,
  snarecaster: 0.4, bellringer: 0.4, sower: 0.35, cinderling: 0.3, summoner: 0.3,
};
const JUKE_MS = 240;
const JUKE_SPEED = 1.9;
const JUKE_COOLDOWN_MS = 1500;
/** Within this of the player, a swing or a dash is worth reacting to. */
const JUKE_NOTICE_PX = 108;

/**
 * Beyond this gap a spiked body stabs instead of bristling: see `chooseMelee`.
 * Inside it the drive's own commit range (20 px between edges) takes over.
 */
const LUNGE_FROM_PX = 40;

/**
 * Hit stun, in ms, and why it is this long.
 *
 * The player's whole swing is 267 ms, of which 8 frames carry a hitbox. A
 * stagger has to outlast the recovery enough that a second swing can land on a
 * still-stunned body — otherwise the first hit buys nothing and pressing the
 * advantage is impossible — while being far shorter than the time needed to
 * kill anything, or the answer to every enemy becomes mashing.
 */
/**
 * How much of this body's skid is left, from 1 at the moment it lands to 0
 * when it stops.
 *
 * Exposed because the brake's length is a property of the attack now rather
 * than one shared constant, and the renderer should not have to look up an
 * attack spec to fade out some dust.
 */
export function brakeFraction(e: Enemy): number {
  const total = meleeSpec(e)?.brakeMs ?? 0;
  return total > 0 ? Math.max(0, Math.min(1, e.brakeMs / total)) : 0;
}

export const STAGGER_MS = 190;

/**
 * How square a wall impact has to be to knock a charge down, as the cosine of
 * the angle to the surface normal.
 *
 * 0.62 is about 52 degrees: comfortably head-on stuns, a glancing hit slides
 * along. Any threshold is arbitrary; what matters is that there *is* one, so
 * that charging along a wall is a thing the player can make happen rather than
 * an instant self-knockout.
 */
const WALL_SLAM_COS = 0.62;

/**
 * How long a wall slam lasts.
 *
 * Far longer than an ordinary stagger, because it is not one: it is the only
 * moment an armoured body is open, and the player had to earn it by steering
 * something that cannot be interrupted into something that can stop it. A
 * punish window has to be long enough to be worth the setup — this is about
 * four swings.
 */
const WALL_SLAM_STUN_MS = 1200;

/**
 * How fast a body reaches the speed it is steering at, in px/s².
 *
 * Cut from 900, which is the single largest reason the enemies read as
 * *agile*. At 900 a rusher went from a standstill to full speed in an eighth
 * of a second, which means it could also **reverse** in an eighth of a second
 * — so nothing the player did with their position ever committed an enemy to
 * anything. Raw speed was never the problem: the fastest body in the roster
 * moves at 112 against the player's 240.
 *
 * 320 overshot the other way: with weight scaling it down again, a body took
 * up to most of a second to get going and as long to stop, and the roster
 * read as sluggish. At 700 a rusher reverses in about a quarter of a second —
 * still slow enough to commit it to a direction and walk round it, which is
 * what juking needs — and a heavy body gets half of it (`ACCEL_WEIGHT_FLOOR`).
 */
const ACCEL = 700;
/**
 * The least of `ACCEL` a heavy body gets. Weight was scaling the ramp down to
 * a third, so a heavy body took most of a second to get going and as long to
 * stop, on top of a low top speed and a slow turn: the roster read as
 * sluggish rather than weighty. Weight belongs in the windup — how long the
 * body announces a move — not in every step it takes. See `turnScale`.
 */
const ACCEL_WEIGHT_FLOOR = 0.5;

/**
 * How far from the view's edge a retreating body stops giving ground.
 *
 * Measured with `viewMargin`, not `pastView`. `pastView` is **0 for every
 * body that is anywhere in view** — it only measures how far *outside* the
 * view a body is — so testing it against a small negative figure was true for
 * every visible body, and the rule "stop backing off at the edge" came out as
 * "never back off at all". A shooter the player walked up to therefore stayed
 * at point blank forever, where it is silenced, which is the two flying
 * bodies that hovered and never attacked.
 *
 * 24 px rather than 12 so a body settles at the edge instead of stepping in
 * and out of the test at its own walking speed.
 */
const EDGE_HOLD_PX = 24;

/**
 * How long a ranged body holds a firing post before it picks a fresh one, and
 * the longest any awake body may go without attacking or making a threat move.
 */
/**
 * How long a ranged body holds a post before it looks for a fresh one, how
 * long it may spend walking there, and how near counts as arrived. Standing
 * is the default and the walk is the exception: see the `keep_distance` case.
 */
const RANGED_POST_MS = 3400;
const RELOCATE_MS = 900;
const POST_ARRIVE_PX = 24;
/** How long a circling body travels before it holds for a window. */
const ORBIT_ARC_MS = 1200;
/** How often a waiting melee body commits to a step of the ring. */
const RING_STEP_MS = 1400;
/** How much nearer, in px a step, counts as closing on the player. */
const CLOSING_PX = 0.3;
export const THREAT_CAP_MS = 3000;

/** Speed multiplier for a body holding at reach without a turn to attack. */
const WAITING_STRAFE = 0.85;

/**
 * How much further out a body waits than the range it would commit from.
 *
 * It used to hold at exactly its striking distance, which meant six bodies
 * with two turns between them still formed a ring at arm's length — the cap
 * changed how often the player was hit and nothing about being surrounded.
 * Waiting a body-and-a-half further out leaves the floor around the player
 * theirs, and it makes the two that *are* committed visible as the two that
 * came closer.
 */
const WAITING_RING = 1.7;

/**
 * How long a body must spend approaching after it notices, before it may take
 * its first turn.
 *
 * Lidén's "move before firing": an enemy that attacks on the frame it engages
 * gives the player no chance to register that a fight has started. The alert
 * beat says *it has seen me*; this says *and it is coming*, and only then does
 * anything land.
 */
const ENGAGE_DELAY_MS = 420;

/**
 * How long a body spends noticing the player before it engages.
 *
 * A charge that begins on the same frame the enemy wakes gives the player
 * nothing to read: the rusher's tell is the windup, and the windup is 280 ms
 * after it has already closed the distance. A planted beat with a sound and a
 * mark is the "brief preparation window" a rushing enemy needs to be fair
 * rather than cheap.
 */
export const ALERT_MS = 320;

/**
 * **Poise by archetype** (`Enemy.poise`, doc 027): the poise damage a burst
 * of hits has to deal before one interrupts it. **Every body has some**, and
 * nothing short of the break interrupts it: a sword held down used to flinch
 * every idle body in reach and push its next attack back, so the late run was
 * a room of bodies waiting to be hit.
 *
 * **How much is set by how long its attacks are announced**, because poise is
 * what lets a body finish an attack the player is standing in. A held sword
 * lands about every 400 ms, so a body whose windup is `W` long is hit at most
 * ⌈W / 400⌉ times before it commits; the poise covers that and a little more,
 * and never so much that a body with a tell under a reaction's length cannot
 * be stopped by anything the player has. Figures are at the ramp's scale 1;
 * `poiseOf` multiplies them by the room's `hp` and `poise` (at room 8 a sword
 * hit is about 15 and the ramp about ×1.85):
 *
 * | tier | bodies | tells | base | at room 8 |
 * |---|---|---|---|---|
 * | the quick blades | rusher, delver, burrower | 280–320 ms | 12 | 2 hits |
 * | the long blades | lancer, warden, fusilier | 380–400 ms, the gun 950 | 18–20 | 3 hits |
 * | the heavy | tank, breaker | 520–640 ms | 28 | 4 hits |
 * | the gunners | shooter, turret, orbiter, sentinel, sower and theirs, the cinderlings | an aim of 320 ms | 8 | 1 hit |
 * | the casters | summoner, bellringer, rifter, snarecaster and theirs | 620–900 ms | 12 | 2 hits |
 *
 * The gunners are the lowest: they keep their distance, and a sword that
 * reaches one should break it. They are not zero, so a gunner the player
 * stands on still gets its shot off inside the break's guard. Not the boss:
 * nothing interrupts him (`canStagger`), and his weight is his health and the
 * turns he takes (`chooseBossAct`). The Frontier Veteran's is its stance.
 */
const POISE: Readonly<Record<string, number>> = {
  rusher: 12, delver: 12, burrower: 12,
  lancer: 18, warden: 20, fusilier: 20,
  tank: 28, breaker: 28,
  shooter: 8, turret: 8, orbiter: 8, sentinel: 8, sower: 8, cinderling: 8,
  summoner: 12, bellringer: 12, rifter: 12, snarecaster: 12,
};
/** The poise a body's tier gives it, at the ramp's scale 1; a subspecies has its base body's unless it is named. */
function tierPoise(archetype: EnemyId): number {
  return POISE[archetype] ?? POISE[baseArchetype(archetype)] ?? 8;
}
/**
 * The bodies whose poise is **armour**: a blow they hold through rings off
 * them with sparks and the armour sound (`poise_hold`). Every body has poise
 * now, and a rusher that clanged like plate under every swing would be a
 * rusher wearing plate; the rest show theirs on the bar alone.
 */
export function plated(e: Pick<Enemy, "archetype" | "affixes">): boolean {
  const base = baseArchetype(e.archetype);
  return base === "tank" || base === "warden" || e.affixes.includes("armored");
}
/**
 * A body's poise: its tier's, scaled as its health is by the room (the
 * player's damage grows over the run, and a figure that did not would be two
 * hits in room 1 and a tap in room 14), softened in the opening rooms by
 * `Ramp.poise`, and doubled by an `armored` affix.
 */
function poiseOf(archetype: EnemyId, affixPoise: number, scale: { readonly hp?: number; readonly poise?: number }): number {
  const own = tierPoise(archetype) * (scale.hp ?? 1) * (scale.poise ?? 1);
  return Math.round(affixPoise > 0 ? own * 2 : own);
}
/**
 * **Poise recovers, slowly, and only once the body is left alone.**
 *
 * It used to be whole again the instant a body had gone 1.5 s unhit, so a
 * player who dodged one attack lost every hit they had put into it — which
 * punishes exactly the play the poise is there to ask for. Now nothing comes
 * back for `POISE_REGEN_DELAY_MS`, which is longer than a dodge and the
 * attack it answered, and then it refills at `POISE_REGEN_PER_S` of the bar a
 * second: a player who steps out and back in keeps most of their work, and one
 * who walks away for good finds it whole again.
 */
export const POISE_REGEN_DELAY_MS = 2000;
export const POISE_REGEN_PER_S = 0.4;
/**
 * **A break is an interrupt, not a stun.** The flinch it knocks the body into
 * is longer than an ordinary hit's (`STAGGER_MS`) and cancels what it had
 * started, but it stays under the knockdown's length: a stun — the long,
 * helpless window with its mark over the head — is a wall's (`WALL_SLAM_STUN_MS`),
 * and a break shown as one read as a body forever dazed.
 */
export const POISE_BREAK_STAGGER_MS = 350;
/**
 * After a break, how long before it can be broken again, counted from the
 * end of the break's stagger: without it the next burst would break it again
 * the moment it stood, and a heavy body could be held down to its death.
 */
export const POISE_GUARD_MS = 1500;

/**
 * Whether this body is currently trying to back away from the player.
 *
 * Read from its own perception, so a body gives ground because of where it
 * thinks the player is — the same position it aims and commits at.
 */
function givingGround(world: World, e: Enemy): boolean {
  if (ENEMIES[e.archetype].behaviour !== "keep_distance") return false;
  const p = seenPlayer(world, e);
  return Math.hypot(p.x - e.x, p.y - e.y) < keepDistance(e) * 0.8;
}

/** Whether the body is in an attack it has started: a melee windup or lunge, or a shot being aimed or fired. */
export function midAttack(e: Enemy): boolean {
  return e.attack === "windup" || e.attack === "lunge" || e.telegraphMs > 0 || e.pending.length > 0;
}

/**
 * Whether an ordinary hit interrupts it. A body with poise is interrupted
 * only by the hit that breaks it (`hurtEnemy`, `stagger(…, force)`).
 */
export function canStagger(e: Enemy): boolean {
  // The king is never interrupted: every move he starts, he finishes, and the opening is the rest after it.
  return e.archetype !== "boss" && e.maxPoise <= 0;
}

/** How long the break flash runs. */
export const POISE_BREAK_MS = 260;

/**
 * A charge slamming into a wall should be felt, not merely seen. The world
 * owns the trauma accumulator, so the enemy module asks rather than writes.
 */
function impactShake(world: World, e: Enemy): void {
  // Seen and heard, not shaken: the screen moves only for the player's own
  // hurt (doc 008). A body braking or hitting a wall shook it several times
  // a fight, none of them the player's.
  world.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: `wall:${e.archetype}` });
}

/**
 * **How often this body takes its turn**, from the run-progress ramp.
 *
 * One multiplier for both halves of a turn's clock — the pause after a melee
 * attack (`restAfter`) and the clock a ranged pattern runs on (`fire`) — so
 * "attack frequency" is one number per band of the run rather than thirty
 * per-archetype cadences. Every windup, marker and aim keeps its own length;
 * this only moves how soon the next one starts, so no telegraph is shortened.
 *
 * The **boss is exempt**: it runs its own phase pace and its own enrage
 * (`BossPhase.rate`), and it is being redesigned separately.
 */
function turnRate(world: World, e: Enemy): number {
  return e.archetype === "boss" ? 1 : rampFor(world.roomIndex).rate;
}

/** Claims one of the room's attack tokens, if any are free. */
function takeToken(world: World, e: Enemy): boolean {
  // A boss is the fight, not another member of its squad: adds cannot spend its turns.
  if (e.guardian) {
    // All Veteran attacks share one post-action window. `wasAttacking` also
    // closes the single frame between an animation ending in this layer and
    // `stepGuardian` observing that edge later in the world step.
    if (e.guardian.actionGapMs > 0 || e.guardian.wasAttacking) return false;
    // Its own due move has priority over starting a generic warden attack in
    // the frame before `stepGuardian` gets to claim it.
    if (!e.guardian.chainNext
      && (e.guardian.callMs <= 0 || e.guardian.stakesMs <= 0 || e.guardian.volleyMs <= 0)) return false;
    e.guardian.wasAttacking = true;
    return true;
  }
  if (e.archetype === "boss") return true;
  if (e.hasToken) return true;
  if (world.attackTokens <= 0) return false;
  world.attackTokens--;
  e.hasToken = true;
  return true;
}

/**
 * Applies hit stun: the body stops, and whatever it was doing is cancelled.
 *
 * The cancel is the part that matters. Hades' rule is that most attacks
 * inflict a small stun which **interrupts enemy attacks and movements**, and
 * interrupting the attack is what pays the player for reading a tell and
 * hitting first. A stagger that only froze the movement would leave the attack
 * clock running, so a hit landed during a windup would delay the lunge without
 * stopping it — worse than no stagger, because by then the telegraph has
 * finished and the player has stopped watching for it.
 *
 * The token goes back too, so a stagger does not merely interrupt one attack:
 * it hands the turn to somebody else.
 *
 * Armoured bodies are exempt, which is the same rule Hades uses to stop a
 * heavy enemy being trivialised by mashing. See `canStagger`.
 */
export function stagger(world: World, e: Enemy, ms = STAGGER_MS, force = false): void {
  if (!force && !canStagger(e)) return;
  if (e.archetype === "boss") return;
  e.staggerMs = Math.max(e.staggerMs, ms);
  e.attack = "approach";
  e.attackMs = 0;
  e.swing.active = false;
  e.swing.trackingMs = 0;
  // And the string it was in the middle of: a hit that only interrupted one
  // blow of a combination would be a hit that bought the player nothing.
  e.comboLeft = 0;
  e.bossString = [];
  e.bossStringAt0 = -1;
  e.bossLinked = false;
  // And a delver's dive, which it had only begun (`cancelDive`).
  cancelDive(e);
  dropToken(world, e);
  // And its aim: a hit interrupts a shot being lined up, which is the same
  // rule as interrupting a windup and for the same reason.
  e.pending = [];
  e.telegraphMs = 0;
  dropFireToken(world, e);
  e.attackCooldownMs = Math.max(
    e.attackCooldownMs, (meleeSpec(e)?.restMs ?? MELEE.restMs) * 0.5,
  );
}

export function dropToken(world: World, e: Enemy): void {
  if (!e.hasToken) return;
  e.hasToken = false;
  world.attackTokens++;
}

/** A woken enemy wakes others this close, so a group reacts as a group. */
const ALERT_RADIUS = 150;
/** Sleeping bodies drift this far around where they were placed. */
/** How far an unaware body strays from where it was placed, in px. */
const IDLE_DRIFT = 44;
/** How often a guard's next move is a step off its post rather than a shuffle. */
const GUARD_STEP_CHANCE = 0.34;
/** How often an idler or a patrol goes to stand with a neighbour, and how far it looks. */
const GATHER_CHANCE = 0.28;
const GATHER_RANGE = 140;
/**
 * A sleeper turns over on this clock, and the turn takes this long.
 *
 * A dormant body was drawn from one frame and never moved at all, which reads
 * as a prop — and worse, as the difference between "alive" and "scenery" being
 * invisible until the player is already inside its range.
 */
const SLEEP_SHIFT_MS = 2600;
const SLEEP_SHIFT_SPREAD_MS = 2600;
const SLEEP_SHIFT_TURN_MS = 700;
/**
 * How near a sleeper the player has to come for it to lift its head, as a
 * share of its aggro range, how long the head stays up, and how near they
 * must still be when it goes down again for the body to wake instead of
 * settling.
 *
 * It wakes at 0.4 of its range on its own (`noticesPlayer`), so the stir is
 * the beat *before* that: the player gets one warning that costs them nothing
 * if they back off, which is what makes creeping past a sleeper a decision.
 */
const STIR_RANGE = 0.7;
const STIR_MS = 600;
const STIR_WAKE_RANGE = 0.5;
/** A sleeper that has settled does not lift its head again for this long. */
const STIR_COOLDOWN_MS = 2400;

/**
 * Patrol speed, as a fraction of the body's own.
 *
 * Slow on two counts: it has to read as *not chasing anything*, and the pauses
 * between legs are where the standing animation plays, so a patrol that
 * hurries spends its time travelling instead of being looked at.
 */
const IDLE_SPEED = 0.4;

/**
 * How fast a body turns and accelerates, relative to the roster's quickest.
 *
 * Taken from its own speed, so weight is declared once in the stat line and
 * shows up in the turn, the lean, the bob, the gait and the time it takes to
 * get going — rather than being authored five times and drifting apart.
 */
function turnScale(e: Enemy): number {
  const fastest = Math.max(...Object.values(ENEMIES).map((d) => d.speed));
  return Math.max(0.35, Math.min(1, ENEMIES[e.archetype].speed / fastest));
}

/**
 * Which bodies pace, and which simply stand.
 *
 * Not everything should wander — a room where every enemy is strolling reads
 * as a zoo, and the requirement was only that a waiting body is not a frozen
 * frame, which the drawn idle pair already answers. So the quick archetypes
 * pace and the heavy ones hold their ground, which is the same division their
 * combat behaviour makes.
 *
 * Measured against the **fastest body in the roster** rather than an absolute
 * speed, because an absolute one silently stopped being true: the threshold
 * was 70 px/s, every speed in the roster was then cut by a fifth to make the
 * enemies read as less agile, and four of the six archetypes fell below it at
 * once. The patrols simply disappeared, and nothing said so.
 */
/**
 * Whether an unaware body walks at all. Everything that can move does — a
 * slow body walks slowly — except an emplacement. Only the quick third of
 * the roster used to, so the summoner, the sower and the ringer stood where
 * they spawned for as long as the player let them: "the idle ones just
 * stand there".
 */
function patrols(e: Enemy): boolean {
  return ENEMIES[e.archetype].behaviour !== "stationary";
}

export function makeEnemy(
  id: number,
  archetype: EnemyId,
  x: number,
  y: number,
  affixes: readonly EliteAffix[],
  /**
   * What the run has made of this body: the room's `hp` and `power` from the
   * ramp (doc 005). One argument rather than a field read off the world, so
   * a body's numbers are fixed at the moment it is created and nothing can
   * change what it is worth halfway through a fight.
   */
  scale: { readonly hp?: number; readonly power?: number; readonly poise?: number } = {},
): Enemy {
  const def = ENEMIES[archetype];
  /*
   * Elite bodies are **enraged** before their affixes say anything: 15%
   * faster on the floor and 15% faster to attack, drawn warm and pink. A
   * harder room used to be the same bodies with longer health bars, which
   * reads as the sword being weak; a body that is visibly quicker reads as
   * the room being harder. The affixes multiply on top.
   */
  // `affixStats` carries the enrage as well as the affix (doc 019), so what an
  // elite is has one answer rather than two.
  const stats = affixStats(affixes);
  /*
   * **The enrage may not outrun doc 005's roster rule.**
   *
   * The fastest body in the roster moves at under 0.88 of the player's walk,
   * which is what makes disengaging possible at all. ×1.15 on the lancer's 104
   * is 119.6 against a player at 120 — a body the player cannot walk away
   * from, which is not a harder fight but a different one. So the elite's
   * speed is the smaller of its multiple and the roster's own ceiling; every
   * body but the two fastest gets the full ×1.15.
   */
  const speed = Math.min(def.speed * stats.speed_mult, PLAYER_SPEED * ROSTER_SPEED_CEILING);
  const hp = def.hp * stats.hp_mult * (scale.hp ?? 1) * ENEMY_HP_SCALE;
  return {
    id, archetype, x, y,
    hp,
    maxHp: hp,
    radius: def.radius,
    speed,
    affixes,
    // Offset per enemy: a room where everything fires on the same beat reads
    // as one enemy copied, not as several.
    patternMs: (id * 397) % 1700,
    telegraphMs: def.pattern || def.ranged ? TELEGRAPH_MS : 0,
    phase: 1,
    gapPx: 9999,
    hastedMs: 0,
    bossFightMs: 0, bossCast: "none", bossCastMs: 0, bossCastEndAt: 0, bossCommitAt: 0, bossBladeAt: 0, bossStartAt: -1, bossNext: "none", bossString: [], bossStringAt0: -1, bossStringN: 1, bossLinked: false, bossLinkedBlow: null, bossHooked: false, bossBolts: 0, bossComboFlip: false, bossMoveMs: 2600, bossMoveIndex: 0, bossBlade: null, bossPlanMs: 0, bossVolleyMs: 0, bossLastAct: "", bossBusy: false, bossAddsPhase: 1, bossRoarMs: 0, bossSummonMs: 0,
    bossTargetX: 0, bossTargetY: 0, airborne: false,
    bossFromX: 0, bossFromY: 0, bossLift: 0, dashLeftPx: 0, dashWake: null, bossHopMs: 0,
    pending: [],
    damageMult: stats.damage_mult * (scale.power ?? 1),
    summonMs: SUMMONER_FIRST_MS,
    minions: 0,
    closeIn: false, blinkCooldownMs: 0, pulseCooldownMs: 0, spikeMs: 0, strikesCast: 0, meleeKind: null,
    windupMs: MELEE.windupMs, strung: false, comboLeft: 0,
    jukeMs: 0, jukeX: 0, jukeY: 0, jukeCooldownMs: 0, plantMs: 0,
    burnMs: 0, burnSources: 0, poisonStacks: 0, poisonMs: 0, slowMs: 0,
    burnBuild: 0, poisonBuild: 0, lavaMs: 0, groundBurnMs: 0, groundPoisonMs: 0, chillBuild: 0, frozenMs: 0, buildFedMs: 0, statusMult: 1, dotShown: 0, dotShowMs: 0,
    spawnFadeMs: SPAWN_FADE_MS + SPAWN_TELEGRAPH_MS,
    hitFlashMs: 0,
    eruptionCastId: 0,
    marked: false,
    doomMs: 0, doomDamage: 0, doomRadius: 0, doomSpell: -1,
    contagion: 0, contagionReach: 0,
    staggerMs: 0,
    stunMs: 0,
    hideMs: 0,
    sinkMs: 0,
    staggerImmuneMs: 0,
    threatMs: 0,
    postX: x, postY: y, postMs: (id * 331) % 1200, relocateMs: 0,
    poise: poiseOf(archetype, stats.poise, scale),
    maxPoise: poiseOf(archetype, stats.poise, scale),
    poiseIdleMs: 0,
    poiseGuardMs: 0,
    poiseBreakMs: 0,
    brakeMs: 0,
    alertMs: 0,
    velX: 0,
    velY: 0,
    hasToken: false,
    hasFireToken: false,
    fireTokenMs: 0,
    retreatMs: RETREAT_BUDGET_MS,
    windedMs: 0,
    attackCooldownMs: 0,
    attackLockMs: 0,
    hasAttacked: false,
    /*
     * Varied per body rather than 0.
     *
     * Every enemy used to start facing due east, and a body that neither
     * patrols nor wakes never turns — so a room of dormant enemies all stared
     * the same way, and from the other side of them it read as the sprite's
     * mirroring being broken. The golden angle spreads consecutive ids, and
     * ids are assigned in spawn order, which correlates with position.
     */
    facing: (id * 2.399963) % (Math.PI * 2),
    // Offset per body, so a group does not step in unison.
    gaitMs: (id * 271) % 1000,
    /*
     * Seeded away from the body itself. Initialised to its own position, the
     * direction to look at was `atan2(0, 0)` — exactly **east** — so every
     * body spent its first glance interval facing right whatever was around
     * it, and one that never moves or wakes faced east forever.
     */
    lookX: x + Math.cos(id * 2.399963) * 32,
    lookY: y + Math.sin(id * 2.399963) * 32,
    // Glance at once, rather than after a full interval of facing nowhere.
    glanceMs: 0,
    strafe: id % 2 === 0 ? 1 : -1,
    strafeMs: 1200 + ((id * 311) % 900),
    vx: 0,
    vy: 0,
    travelled: 0,
    knockX: 0,
    knockY: 0,
    blockedMs: 0,
    stuckMs: 0,
    lastGap: Infinity,
    nudge: { x: 0, y: 0 },
    swing: makeSwingBox(),
    strike: makeStrike(),
    awake: false,
    wanderX: x,
    wanderY: y,
    // Staggered, so a row of bodies does not step off together.
    wanderPauseMs: (id * 311) % 700,
    homeX: x,
    homeY: y,
    attack: "approach",
    attackMs: 0,
    lungeX: 0,
    lungeY: 0,
    pose: "",
    poseMs: 0,
    // Offset per body, so two of a kind do not use their second move together.
    moveMs: 2400 + ((id * 613) % 1800),
    casts: 0,
    wardHeal: 0,
    delve: "surface",
    delveMs: 2500,
    delveX: 0,
    delveY: 0,
    aloneMs: 0,
    idleRole: idleRoleFor(archetype, id),
    idleAction: "still",
    // Staggered per body, so a row of sleepers does not turn over together.
    stirMs: -((id * 907) % 2600),
    wakeDelayMs: 0,
    lostMs: 0,
    searchMs: 0,
  };
}

/**
 * The role a body plays before the fight finds it, mixed within a group so
 * a room is never a row of identical statues (research: idle roles). An
 * emplacement or a heavy stands guard; a quick body patrols a short beat or,
 * one in three, sleeps; the ranged loiter.
 */
function idleRoleFor(archetype: EnemyId, id: number): Enemy["idleRole"] {
  const def = ENEMIES[archetype];
  const base = baseArchetype(archetype);
  if (def.behaviour === "stationary" || base === "tank" || base === "warden" || base === "boss") return "guard";
  if (def.melee !== null) return id % 3 === 0 ? "sleeper" : "patrol";
  return id % 4 === 0 ? "sleeper" : "idler";
}

/** Fading enemies cannot deal or take damage, so a spawn is never a free hit. */
export function isActive(e: Enemy): boolean {
  return e.spawnFadeMs <= 0 && !e.airborne;
}

/**
 * Wakes `e` and everything near it. Exported because a hit has to wake its
 * target wherever the damage is applied: shooting a sleeping enemy and having
 * it keep dozing is worse than no aggro range at all.
 */
export function wake(world: World, e: Enemy): void {
  if (e.awake) return;
  e.awake = true;
  e.wakeDelayMs = 0;
  // Idle actions belong to bodies that have not noticed the player.
  e.idleAction = "still";
  // The pattern clock starts on waking, so a woken shooter telegraphs before
  // its first volley rather than firing the instant it notices you.
  e.patternMs = 0;
  /*
   * One beat of noticing before it engages. A charge that begins on the frame
   * the enemy wakes gives the player nothing to read, because the rusher's
   * tell is its windup and the windup happens after it has already closed the
   * distance. See `ALERT_MS`.
   */
  e.alertMs = ALERT_MS;
  // Lidén's "move before firing": it closes first, and only then may it
  // commit. See `ENGAGE_DELAY_MS`.
  e.attackCooldownMs = Math.max(e.attackCooldownMs, ALERT_MS + ENGAGE_DELAY_MS);
  const woken = ENEMIES[e.archetype];
  e.telegraphMs = woken.pattern || woken.ranged ? TELEGRAPH_MS : 0;
  /*
   * The alarm spreads as a **ripple**, not a switch: each neighbour wakes a
   * beat later the further it stands, so a room lights up visibly from the
   * body that saw you, and the player gets to see the group turn.
   */
  for (const other of world.enemies) {
    if (other.awake || other.hp <= 0) continue;
    const d2 = dist2(other.x, other.y, e.x, e.y);
    if (d2 > ALERT_RADIUS * ALERT_RADIUS) continue;
    const delay = WAKE_RIPPLE_MS + (Math.sqrt(d2) / ALERT_RADIUS) * WAKE_RIPPLE_SPREAD_MS;
    other.wakeDelayMs = other.wakeDelayMs > 0 ? Math.min(other.wakeDelayMs, delay) : delay;
  }
}

/**
 * A sleeper's stealth beat: head up, a look, then down again or awake.
 *
 * Deterministic from the world's own stream like every other idle decision,
 * and gated by a cooldown so a player standing at the edge of the range does
 * not make a body nod at them forever.
 */
function stir(world: World, e: Enemy, dtMs: number): void {
  const range = ENEMIES[e.archetype].aggro_range;
  const p = world.player;
  const d2 = dist2(e.x, e.y, p.x, p.y);
  if (e.idleAction === "stir") {
    e.stirMs -= dtMs;
    if (e.stirMs > 0) return;
    /*
     * Down again, or up. It wakes only if the player is still well inside the
     * range *and* it can see them — so backing off during the beat works, and
     * so does breaking the line, which is the whole point of the beat.
     */
    if (d2 <= (range * STIR_WAKE_RANGE) ** 2 && hasLineOfSight(world.room.grid, e.x, e.y, p.x, p.y)) {
      e.idleAction = "still";
      wake(world, e);
      return;
    }
    e.idleAction = "still";
    e.stirMs = -STIR_COOLDOWN_MS;
    return;
  }
  if (e.stirMs < 0) { e.stirMs = Math.min(0, e.stirMs + dtMs); return; }
  if (d2 > (range * STIR_RANGE) ** 2) return;
  e.idleAction = "stir";
  e.stirMs = STIR_MS;
  e.lookX = p.x;
  e.lookY = p.y;
  world.events.push({ kind: "telegraph", x: e.x, y: e.y, what: `stir:${e.archetype}` });
}

/** The first neighbour wakes this long after the body that raised the alarm, the furthest this much later. */
const WAKE_RIPPLE_MS = 140;
const WAKE_RIPPLE_SPREAD_MS = 260;
/**
 * How much further a noise carries than sight: the sword and the dash are
 * heard through walls, inside this multiple of a body's aggro range.
 */
const HEAR_MULT = 0.85;
/** How much further a body sees while a fight goes on inside its aggro range. */
const FIGHT_SIGHT_MULT = 1.3;

/**
 * Has the player been noticed?
 *
 * By **sight** — inside the aggro range with a clear line; a guard sees in a
 * cone in front of it, and a sleeper sees nothing at all until the player is
 * close enough to wake it — or by **hearing**: the sword swinging or a dash,
 * through walls, inside a slightly smaller ring. A sleeper sleeps through
 * noise at range too, which is what makes it a body the player can reach
 * first and hit for the ambush.
 */
function noticesPlayer(world: World, e: Enemy): boolean {
  const base = ENEMIES[e.archetype].aggro_range;
  const p = world.player;
  const d2 = dist2(e.x, e.y, p.x, p.y);
  /*
   * **A fight nearby is heard.** The alarm is a ripple at the moment a body
   * wakes; after it, nothing more was heard, so a body just past the ripple
   * slept on nine tiles from a fight it could see. A body with a waking
   * neighbour inside its own aggro range is listening: it sees further, and
   * even a sleeper stirs at the whole range rather than a third of it.
   */
  const fightNear = world.enemies.some((o) => o !== e && o.awake && o.hp > 0 && dist2(o.x, o.y, e.x, e.y) <= base * base);
  if (e.idleRole === "sleeper") return d2 <= (base * (fightNear ? 1 : 0.4)) ** 2;
  const noisy = world.swing.active || p.dashMs > 0;
  if (noisy && d2 <= (base * HEAR_MULT) ** 2) return true;
  const sight = fightNear ? base * FIGHT_SIGHT_MULT : base;
  if (d2 > sight * sight) return false;
  if (e.idleRole === "guard" && d2 > (base * 0.45) ** 2) {
    let da = Math.atan2(p.y - e.y, p.x - e.x) - e.facing;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > GUARD_CONE) return false;
  }
  return hasLineOfSight(world.room.grid, e.x, e.y, p.x, p.y);
}

/** Out of sight this long, a body stops to search; it searches this long. */
const LOST_BEFORE_SEARCH_MS = 1800;
const SEARCH_MS = 900;

/** Half the cone a guard watches, beyond close range: 70°, a wide look ahead. */
const GUARD_CONE = (70 * Math.PI) / 180;

/**
 * Movement for a sleeping enemy: a slow drift around where it was placed.
 * Perfectly still bodies read as scenery and rob the wake of its moment.
 */
/**
 * An unaware body's patrol: walk to a point near home, pause, pick another.
 *
 * Wandering rather than standing still, because a room of motionless bodies
 * reads as a room of props — the player cannot tell what is alive until it
 * comes at them. And a destination rather than a force, because a force this
 * small changes sign every few frames and the body vibrates.
 *
 * Slow, so it is legible as "not yet in the fight": a patrolling body moving
 * at a third of its combat speed is obviously not chasing anything.
 */
function wanderStep(e: Enemy, world: World, dt: number, dtMs: number): { dx: number; dy: number } {
  if (e.wanderPauseMs > 0) {
    e.wanderPauseMs -= dtMs;
    return { dx: 0, dy: 0 };
  }
  const dx = e.wanderX - e.x;
  const dy = e.wanderY - e.y;
  // 5 px was inside the arrival slop of its own first step, so a body spawned
  // on its target paused immediately and then again on every arrival.
  if (Math.hypot(dx, dy) < 4) {
    /*
     * Arrived: stand for a moment, then go on. A patrol walks a beat — the
     * same two ends, turn and turn about — and an idler wanders anywhere near
     * home; the two read differently at a glance, which is the point.
     */
    if (e.idleRole === "patrol") {
      const a = e.id * 2.399963;
      const side = Math.hypot(e.x - (e.homeX + Math.cos(a) * IDLE_DRIFT), e.y - (e.homeY + Math.sin(a) * IDLE_DRIFT)) < 8 ? -1 : 1;
      e.wanderX = e.homeX + Math.cos(a) * IDLE_DRIFT * side;
      e.wanderY = e.homeY + Math.sin(a) * IDLE_DRIFT * side;
      e.wanderPauseMs = 300 + world.rng.next() * 600;
      return { dx: 0, dy: 0 };
    }
    const a = world.rng.next() * Math.PI * 2;
    /*
     * A guard keeps its post — but a sentry that never leaves the same square
     * foot is a bollard. One arrival in three it **walks a tile or two off**
     * and comes back on the next; the rest are the shuffle and a long look
     * across its cone. See `Enemy.idleAction`.
     */
    if (e.idleRole === "guard") {
      const patrolOff = world.rng.next() < GUARD_STEP_CHANCE
        && Math.hypot(e.x - e.homeX, e.y - e.homeY) < TILE_PX;
      const g = patrolOff ? TILE_PX * (1 + world.rng.next()) : IDLE_DRIFT * 0.18 * world.rng.next();
      e.wanderX = e.homeX + Math.cos(a) * g;
      e.wanderY = e.homeY + Math.sin(a) * g;
      e.idleAction = patrolOff ? "step" : "scan";
      e.wanderPauseMs = patrolOff ? 500 + world.rng.next() * 500 : 1600 + world.rng.next() * 1600;
      return { dx: 0, dy: 0 };
    }
    /*
     * And now and then two unaware bodies **gather**: one walks over to stand
     * with a neighbour. It costs one destination and it is the cheapest thing
     * in the game that makes a room read as inhabited rather than populated.
     */
    const mate = world.rng.next() < GATHER_CHANCE
      ? world.enemies.find((o) => o !== e && o.hp > 0 && !o.awake && o.idleRole !== "sleeper"
        && dist2(o.x, o.y, e.x, e.y) < GATHER_RANGE * GATHER_RANGE)
      : undefined;
    if (mate) {
      const to = normalise(mate.x - e.x, mate.y - e.y);
      e.wanderX = mate.x - to.x * (e.radius + mate.radius + 8);
      e.wanderY = mate.y - to.y * (e.radius + mate.radius + 8);
      e.idleAction = "gather";
      e.wanderPauseMs = 900 + world.rng.next() * 1200;
      return { dx: 0, dy: 0 };
    }
    const r = IDLE_DRIFT * (0.35 + world.rng.next() * 0.65);
    e.wanderX = e.homeX + Math.cos(a) * r;
    e.wanderY = e.homeY + Math.sin(a) * r;
    e.idleAction = "still";
    // Short: a patrol should be mostly walking. At half a second to two
    // seconds it stood far more than it moved, and a body standing still is
    // drawn from a single frame — so the room looked unanimated.
    // A real stop, long enough for the standing animation to play a cycle.
    e.wanderPauseMs = 500 + world.rng.next() * 900;
    return { dx: 0, dy: 0 };
  }
  const v = normalise(dx, dy);
  const speed = e.speed * IDLE_SPEED * dt;
  return { dx: v.x * speed, dy: v.y * speed };
}

/**
 * Where around the player this body wants to stand, as an angle offset.
 *
 * **Offset pursuit**, which is Craig Reynolds' name for it: instead of every
 * pursuer steering at the target's exact position, each steers at a point
 * offset from it. That one change is the difference between a group that
 * converges into a queue on one line — glued to the player, shoving each other
 * for the same pixel, which is what "the tracking is awkward" was — and a
 * group that arrives from distinct angles and reads as a surround.
 *
 * Derived from the body's id rather than assigned, so it is deterministic, it
 * costs nothing to maintain, and two enemies of the same kind never pick the
 * same side. The golden angle spreads consecutive ids as far apart as
 * possible, which matters because a room's enemies are numbered in spawn
 * order and spawn order correlates with position.
 */
function pursuitOffset(e: Enemy): number {
  const GOLDEN = 2.399963;
  return e.id * GOLDEN;
}

/**
 * Arrival: how much to ease off inside the approach, from Reynolds again.
 *
 * A body that seeks at full speed until the instant it arrives overshoots,
 * gets pushed back out by the standoff, and comes in again — which is the
 * jitter at contact range. Easing over the last stretch settles it instead.
 */
function arrivalScale(gap: number, want: number): number {
  const slow = want * 1.8;
  if (gap >= slow) return 1;
  return Math.max(0.25, (gap - want * 0.6) / (slow - want * 0.6));
}

/**
 * Steering for one enemy.
 *
 * Straight at the player when the line is clear, and along the shared flow
 * field when it is not. Straight-line-only pursuit is what makes an enemy
 * look stupid: it presses into the pillar between it and you and stays there.
 * Field-only pursuit looks stupid the other way, snapping between tile
 * centres on an empty floor. The switch is line of sight.
 */
function moveFor(e: Enemy, world: World, dt: number): { dx: number; dy: number } {
  // Where it *believes* the player is. See `seenPlayer`.
  const p = seenPlayer(world, e);
  // A posed move holds the body where it is: the move is what it is doing.
  if (planted(e)) return { dx: 0, dy: 0 };
  // Searching: it lost the player and stops to look round. See `SEARCH_MS`.
  if (e.searchMs > 0) return { dx: 0, dy: 0 };
  /*
   * Mid-sidestep, everything else is off: the hop is a whole decision and a
   * short one. It overrides the steering rather than adding to it, because a
   * lateral burst summed with a pursuit vector is a body that drifts, and
   * what has to read is that it **moved because the player swung**.
   */
  if (e.jukeMs > 0) {
    const s = e.speed * dt * JUKE_SPEED * closePresence(world, e);
    return { dx: e.jukeX * s, dy: e.jukeY * s };
  }
  // Taking its shot: planted for the aim, the volley and the beat after it.
  // See `Enemy.plantMs`.
  if (e.plantMs > 0) return { dx: 0, dy: 0 };
  const slow = (e.slowMs > 0 ? 0.6 : 1) * (e.archetype === "boss" ? bossPhase(e).speed : 1)
    // Fire feeds the cinderling: it burns faster than it walks (research §2.6).
    * (baseArchetype(e.archetype) === "cinderling" && e.burnMs > 0 ? 1.3 : 1)
    // A bell's ringing hurries whoever is standing in it (doc 005).
    * (e.hastedMs > 0 ? HASTE_SPEED : 1);
  /*
   * Two speeds, and which one a branch uses is a statement about intent.
   *
   * `speed` is steady: a body **closing on the player** runs at one pace.
   * Applying the gait here was wrong and it was the loudest thing wrong with
   * the movement — every enemy following the player surged and eased several
   * times on the way in, which does not read as breathing, it reads as
   * indecision. Something that has decided to come at you commits to it.
   *
   * `amble` carries the gait, and it is for everything that is *not* closing:
   * holding a ring with no turn to take, orbiting, working sideways at range.
   * That is where a push-and-settle rhythm reads as an animal choosing its
   * moment rather than as a stutter.
   *
   * Neither applies to a commitment: a charge has to cover the distance it
   * announced, and one that launched during the settle half of its cycle would
   * fall short of its own telegraph.
   */
  const speed = e.speed * slow * dt * closePresence(world, e);
  const amble = e.attack === "lunge" ? speed : speed * gaitScale(e);
  const def = ENEMIES[e.archetype];
  if (def.behaviour === "stationary") return { dx: 0, dy: 0 };

  const visible = hasLineOfSight(world.room.grid, e.x, e.y, p.x, p.y);
  const direct = normalise(p.x - e.x, p.y - e.y);
  const field = world.flow;

  /**
   * Toward the player: the straight line when visible and not jammed, the
   * field otherwise.
   *
   * `blockedMs` is in the condition because line of sight is a point test
   * while movement is a circle. A body can see the player through a gap it
   * cannot fit through, and then it holds the direct vector and grinds on
   * the corner forever. Being stuck is the evidence the straight line is a
   * lie, whatever the sight line says.
   */
  // Either evidence will do: pressed against something, or simply not
  // getting anywhere. See `Enemy.stuckMs`.
  const jammed = e.blockedMs > JAM_MS || e.stuckMs > JAM_MS;
  const toward = (): { x: number; y: number } => {
    if (visible && !jammed) return direct;
    if (!field) return direct;
    return followField(field, e.x, e.y) ?? direct;
  };

  switch (def.behaviour) {
    case "chase":
      // A boss mid-move is planted: the move is the attack.
      if (e.archetype === "boss" && (e.bossCast !== "none" || e.bossHopMs > 0)) return { dx: 0, dy: 0 };
      if (meleeSpec(e)) return meleeStep(e, world, speed, amble, toward);
      // No blade: chase and nothing else, rather than stalling in a cycle
      // whose phases nothing advances.
      return { dx: toward().x * speed, dy: toward().y * speed };

    case "keep_distance": {
      // Standing on a radius and shooting is the dullest thing a ranged
      // enemy can do. Working around the player while it holds range reads
      // as an opponent choosing an angle.
      // Path distance, not straight-line: a shooter on the far side of a wall
      // is close on the map and far in the room, and backing away from it
      // through the wall is the behaviour that looks broken.
      const steps = field ? distanceAt(field, e.x, e.y) : UNREACHABLE;
      const range = steps === UNREACHABLE
        ? Math.hypot(p.x - e.x, p.y - e.y)
        : steps * TILE_PX;
      if (!visible) {
        const v = toward();
        return { dx: v.x * speed, dy: v.y * speed };
      }
      /*
       * **A gunner with a shield.** A `keep_distance` body never ran the melee
       * cycle, so the one archetype carrying a plate had no answer to a player
       * standing on it. This routes it in only for the two cases that matter —
       * an attack already under way, and a player inside the shove's own reach
       * — and never into the waiting ring, which is a melee body's holding
       * pattern and would turn an archer into a brawler.
       */
      {
        const spec = meleeSpec(e);
        if (spec && e.attack !== "approach") return meleeStep(e, world, speed, amble, toward);
        if (spec && e.attackCooldownMs <= 0 && e.attackLockMs <= 0) {
          const reach = e.radius + PLAYER_RADIUS
            + spec.commitRange * (e.guardian && spec.kind !== "charge" ? GUARDIAN_ATTACK_RANGE_MULT : 1);
          if (Math.hypot(p.x - e.x, p.y - e.y) <= reach && takeToken(world, e)) {
            beginWindup(world, e, p);
            return { dx: 0, dy: 0 };
          }
        }
      }
      /*
       * Give ground, but only out of a budget.
       *
       * Retreating used to be free and unlimited, which made the ranged
       * archetypes uncatchable: the player closes at 240 and a shooter flees
       * at 58, yet a player who is also dodging — and whose swing halves their
       * speed — never quite arrives, because there is always one more step
       * back. "One more step, forever" is a completely safe firing position,
       * which is the thing an archer must not have.
       *
       * Spent, it stands and is winded. That hold is the window the player has
       * been closing for, and it is also when the body is worth hitting, so
       * the chase has a payoff rather than an asymptote.
       */
      const wantsBack = range < keepDistance(e) * 0.8;
      /*
       * **Crowded is not a thing to be winded about.** The winded hold is the
       * player's window at range; inside the silence radius the body is not
       * firing anyway, so holding there is not a window, it is a body that
       * has given up. It was also how the ranged archetypes ended up living
       * at 33 px from the player: spend the budget, hold, be closed on, and
       * there is no step back left. Inside `PANIC_RADIUS` it always gives
       * ground, and the budget is what stops it doing so forever.
       */
      const wantsBack0 = range < keepDistance(e) * 0.8;
      /*
       * **A ranged body stands at a post and shoots from it.**
       *
       * It changes post now and then — a fresh sight line, a step round the
       * flank — but the standing is the point and the walk is the exception.
       * It was the other way round: a fresh angle every 1.5 s with a small
       * arrival radius meant a shooter was **moving 73% of the time** and an
       * orbiter 64%, and the player's report was simply that they could not
       * be hit. A body that is never still is not a fight, it is a chase.
       *
       * So the relocation is **short and committed**: a new post about every
       * 3.4 s, a wide arrival radius so it settles rather than creeping onto
       * an exact pixel, and a hard budget (`RELOCATE_MS`) after which it
       * stands wherever it got to. Everything else is standing — and standing
       * is when it can be shot, which is the window the player needs.
       */
      if (!e.hasFireToken && e.telegraphMs <= 0 && e.plantMs <= 0 && e.poseMs <= 0) {
        if (e.postMs <= 0) {
          const want = keepDistance(e);
          const a = Math.atan2(e.y - p.y, e.x - p.x)
            + (world.rng.next() < 0.5 ? -1 : 1) * (0.5 + world.rng.next() * 0.7);
          const px = p.x + Math.cos(a) * want;
          const py = p.y + Math.sin(a) * want;
          if (!circleHitsWall(world.room.grid, px, py, e.radius)) {
            e.postX = px;
            e.postY = py;
            e.postMs = RANGED_POST_MS;
            e.relocateMs = RELOCATE_MS;
            e.threatMs = 0;
          } else {
            e.postMs = 400;
          }
        }
        const dx0 = e.postX - e.x;
        const dy0 = e.postY - e.y;
        if (e.relocateMs > 0 && Math.hypot(dx0, dy0) > POST_ARRIVE_PX) {
          const v = normalise(dx0, dy0);
          e.threatMs = 0;
          return { dx: v.x * speed, dy: v.y * speed };
        }
        /*
         * Posted. It holds still rather than strafing: a shooter that drifts
         * sideways for ever between shots is the same unhittable body with a
         * smaller radius, and its threat is the shot, not the footwork.
         */
        if (!wantsBack0) return { dx: 0, dy: 0 };
      }
      const crowded = range < PANIC_RADIUS;
      if (e.windedMs > 0 && !crowded) {
        // Holding: it will still strafe, but it does not give ground.
        const tx0 = -direct.y * e.strafe;
        const ty0 = direct.x * e.strafe;
        return { dx: tx0 * STRAFE_WEIGHT * amble, dy: ty0 * STRAFE_WEIGHT * amble };
      }
      /*
       * **An archer does not back off the screen.** Giving ground is what
       * keeps a shooter a shooter, but a body that retreats past the edge of
       * the view is a body the player cannot fight and cannot see, and the
       * room reads as empty while it is still full. At the edge it holds and
       * strafes instead, which is the same hold the spent retreat budget
       * gives and is already the player's window.
       */
      const atEdge = viewMargin(world, e) < EDGE_HOLD_PX;
      const sign = wantsBack && !atEdge ? -1 : range > keepDistance(e) * 1.2 ? 1 : 0;
      if (sign < 0 && field) {
        const away = followField(field, e.x, e.y, true);
        if (away) return { dx: away.x * speed, dy: away.y * speed };
      }
      const tx = -direct.y * e.strafe;
      const ty = direct.x * e.strafe;
      // Backing away is committed; holding a range and working sideways ambles.
      const pace = sign < 0 ? speed : amble;
      /*
       * And it backs away **straight**. At the full strafe weight the sideways
       * component was as large as the retreat, so a body trying to re-open a
       * gap spent most of its speed going round the player instead of away
       * from them — which is the other half of why they were found living
       * inside their own silence radius. Circling is for a body that is
       * already at its range.
       */
      const strafe = sign < 0 ? STRAFE_WEIGHT * 0.35 : STRAFE_WEIGHT;
      return {
        dx: (direct.x * sign + tx * strafe) * pace,
        dy: (direct.y * sign + ty * strafe) * pace,
      };
    }

    case "orbit": {
      if (!visible || jammed) {
        const v = toward();
        return { dx: v.x * speed, dy: v.y * speed };
      }
      /*
       * **It circles in arcs, not for ever.** A body that never stops moving
       * cannot be hit, and the player's report was exactly that: measured, an
       * orbiter was in motion 64% of the time and a sower 84%. So the circle
       * comes in bouts — `ORBIT_ARC_MS` of travel, then it holds where it is
       * until its post clock comes round again. The hold is the window the
       * player shoots into, and it is also when it takes its own shot, since
       * a planted body is what the firing rules want anyway.
       */
      if (e.postMs <= 0) {
        e.postMs = RANGED_POST_MS;
        e.relocateMs = ORBIT_ARC_MS;
        e.threatMs = 0;
      }
      if (e.relocateMs <= 0) return { dx: 0, dy: 0 };
      const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
      // The sower circles wide, so its ring of seeds closes on the player over the fight.
      const orbit = baseArchetype(e.archetype) === "sower" ? ORBIT_RADIUS * 1.3 : ORBIT_RADIUS;
      const radial = (d - orbit) / orbit;
      /*
       * The circle turns back at a wall. It always ran the same way round,
       * and a circle that met a corner pressed into it — the orbiter sat in
       * the corner sliding on the spot. It looks a body-width ahead along the
       * way it is circling, and reverses when that is stone.
       */
      const ahead = e.radius + 10;
      const gx = -direct.y * e.strafe;
      const gy = direct.x * e.strafe;
      if (circleHitsWall(world.room.grid, e.x + gx * ahead, e.y + gy * ahead, e.radius * 0.8))
        e.strafe = (e.strafe === 1 ? -1 : 1) as 1 | -1;
      const tx = -direct.y * e.strafe;
      const ty = direct.x * e.strafe;
      // Circling is not closing, so it ambles: the gait is what makes an
      // orbit read as a creature choosing its moment rather than as a dial.
      return {
        dx: (tx + direct.x * radial) * amble,
        dy: (ty + direct.y * radial) * amble,
      };
    }
  }
}

/**
 * Keeps bodies out of each other. Without it a wave arrives as one clump
 * occupying a single tile, which looks like a rendering bug and plays like
 * one enemy with a lot of health.
 */
function separation(world: World, e: Enemy): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const add = (ox: number, oy: number, want: number, force: number): void => {
    const dx = e.x - ox;
    const dy = e.y - oy;
    const d = Math.hypot(dx, dy);
    if (d >= want || d < 0.001) return;
    const push = (want - d) / want;
    x += (dx / d) * push * force;
    y += (dy / d) * push * force;
  };

  for (const other of world.enemies) {
    if (other === e || other.hp <= 0) continue;
    add(other.x, other.y, e.radius + other.radius, SEPARATION_FORCE);
  }
  // The player too. A chaser aims at the player's centre, so without this it
  // walks in and parks on top: a heart every invulnerability window, and a
  // sprite sitting inside the player's own.
  // Not during a lunge: a committed attack that gets pushed off the player
  // by its own standoff can never connect, and reads as a body bouncing off
  // an invisible shell. The recoil phase re-opens the gap instead.
  if (e.attack !== "lunge") {
    add(world.player.x, world.player.y, e.radius + PLAYER_RADIUS + STANDOFF, PLAYER_SEPARATION_FORCE);
  }
  return { x, y };
}

/**
 * The melee loop, advanced one step.
 *
 * The phases are driven by `attackMs`, counted down in `stepEnemy`, so the
 * timing is the same whatever the frame rate. `approach` is the only phase
 * that steers; once the windup ends the direction is frozen, which is what
 * makes the lunge dodgeable rather than a homing grab.
 */
/**
 * Counts the melee cycle down and performs the phase transitions. Split from
 * `meleeStep` because the timer has to advance exactly once per step, while
 * the steering function is a pure read of the current phase.
 */
function advanceMelee(e: Enemy, world: World, dtMs: number): void {
  const spec = meleeSpec(e);
  if (!spec) return;
  if (e.attackMs > 0) e.attackMs -= dtMs;

  /*
   * The blade exists for the whole windup, inert, and the renderer draws it as
   * the telegraph. That is the point of arming it early: the tell is then
   * literally the hitbox, so it cannot lie about reach or arc, and the player
   * is reading the attack rather than a decoration of it.
   *
   * It tracks the player while winding up and stops at the commit. Tracking
   * throughout would be a homing grab; not tracking at all would mean the tell
   * appears before the enemy has decided, and could be walked out of for free.
   */
  if (e.attack === "windup") {
    // Measured against the windup that is actually running, not the one the
    // spec declares: the tempo and its jitter move it. See `Enemy.windupMs`.
    e.swing.trackingMs = Math.max(0, e.attackMs - (e.windupMs - MELEE.trackMs));
    if (e.swing.trackingMs > 0) {
      const seen = seenPlayer(world, e);
      const v = normalise(seen.x - e.x, seen.y - e.y);
      e.swing.facing = bossAim(e, v.x, v.y);
      e.swing.angle = e.swing.facing;
    }
    e.swing.active = false;
  } else if (e.attack === "lunge") {
    e.swing.trackingMs = 0;
    // A travelling melee body carries its hitbox with it. Leaving the box at
    // the windup origin made long charges visually pass through the player
    // while the resolver kept testing empty space behind the body.
    e.swing.x = e.x;
    e.swing.y = e.y;
    // Where the blade is now, from how far through the commit window it is.
    advanceBox(e.swing, 1 - Math.max(0, e.attackMs) / spec.lungeMs);
  } else {
    e.swing.active = false;
  }

  if (e.attackMs > 0) return;

  switch (e.attack) {
    case "approach":
      break;
    case "windup": {
      /*
       * The claw is **always a pair**: it asks for its second swipe here, and
       * only once per string (`Enemy.strung`), or it would swipe forever.
       */
      if (e.meleeKind === "claw" && !e.strung) e.comboLeft = Math.max(e.comboLeft, 1);
      e.strung = e.comboLeft > 0;
      // The commitment: the direction stops being read here and is held. It is
      // taken from the box, so what the player was shown is what commits.
      e.lungeX = Math.cos(e.swing.facing);
      e.lungeY = Math.sin(e.swing.facing);
      /*
       * The sprite's facing is snapped to the charge, not merely frozen.
       *
       * These are two separate values — `facing` drives the drawing and turns
       * at a bounded rate, `lungeX/Y` is the committed direction — and during
       * the windup the first is still catching up to the second. Freezing it
       * as-is therefore let a tank charge one way while looking another. It
       * has decided; the head goes with the body.
       */
      e.facing = e.swing.facing;
      e.attack = "lunge";
      e.attackMs = spec.lungeMs;
      if (e.guardian && e.meleeKind === "charge") {
        // A short freeze and camera thump make the ram land with weight even
        // when it misses the player and only tears through the floor.
        world.hitstopMs = Math.max(world.hitstopMs, 45);
        world.trauma = Math.min(1, world.trauma + 0.14);
      }
      /*
       * **The king's dashcut runs to the player, not to the wall.** It used
       * to cross its whole six tiles whatever was in front of it, so a
       * missed dash ended in the far stonework and the string behind it cut
       * at nothing. It now runs to where they stood along its line and a
       * body past it; a dash that catches them stops there (`dashcutImpact`
       * in world.ts).
       */
      if (e.archetype === "boss" && e.meleeKind === "dashcut") {
        const p = world.player;
        const along = (p.x - e.x) * e.lungeX + (p.y - e.y) * e.lungeY;
        e.dashLeftPx = Math.max(0, along) + BOSS_DASH_PAST_PX;
        e.dashWake = e.phase >= 3 ? startWake(e.x, e.y, e.lungeX, e.lungeY, {
          stepPx: BOSS_WAKE_STEP_PX, reachPx: BOSS_WAKE_REACH_PX, inner: e.radius * 0.6,
          thick: BOSS_WAKE_THICK_PX, speed: BOSS_WAKE_SPEED, damage: BOSS_WAKE_DAMAGE * e.damageMult,
        }) : null;
      }
      /*
       * The slam's **shockwave**: the blade lands on the body's own ground and
       * a ring opens round it, wider than the steel and weaker. It is cast at
       * the commit rather than at the windup so the telegraph the player reads
       * is the blade's, and the ring's own growth is the beat afterwards —
       * stand on it for a heart and a half, near it for half of one.
       */
      if (e.meleeKind === "slam") shockRing(world, e);
      // A string's blows are laid from where its opening blow lands (`BossPhase.strings`).
      if (e.archetype === "boss" && e.bossStringAt0 < 0 && e.bossString.length > 0) e.bossStringAt0 = e.bossBladeAt;
      /*
       * The greatsword arriving (doc 020). The cleave — alone or as a string's
       * last blow — is driven into stone: the fight freezes for three frames
       * and the room shakes, as the slam does, so it lands like one. The sweep
       * shakes it a little; a light slash only just, and never freezes, or a
       * string would stutter.
       */
      if (e.meleeKind === "greatcleave") {
        const reach = TILE_PX * spec.reachTiles * 0.92;
        world.hitstopMs = Math.max(world.hitstopMs, BOSS_CLEAVE_STOP_MS);
        world.trauma = Math.min(1, world.trauma + 0.45);
        world.events.push({ kind: "hazard_tick", x: e.x + e.lungeX * reach, y: e.y + e.lungeY * reach, what: "boss_cleave" });
      }
      if (e.meleeKind === "greatsweep" || e.meleeKind === "greatslash") {
        // The sweep is felt in the hands — a freeze and a shake — and the slash barely: the one is weight, the other speed.
        if (e.meleeKind === "greatsweep") world.hitstopMs = Math.max(world.hitstopMs, BOSS_SWEEP_STOP_MS);
        world.trauma = Math.min(1, world.trauma + (e.meleeKind === "greatsweep" ? 0.35 : 0.06));
        world.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "boss_sweep_cut" });
      }
      /*
       * **The sword wave** (doc 020): the sweep and the cleave throw the arc
       * they cut out past the blade, a crescent of force that travels on
       * across the floor for half what the blow itself costs. It starts where
       * the steel ends, so being out of reach of the cut is not being out of
       * the fight — leave its arc, stand where a pillar breaks it, or dash it.
       * The sweep's is as wide as its cut (the slash throws none: its danger
       * is its rhythm); the cleave's a narrower bolt, thrown at the player as the blade comes down — within
       * `BOSS_WAVE_CLEAVE_TURN` of the line it struck, so it still goes out
       * down the cut — because a bolt aimed where they stood through a
       * 700 ms windup was a bolt everyone had already stepped off.
       */
      if (e.archetype === "boss" && (e.meleeKind === "greatsweep" || e.meleeKind === "greatcleave")) {
        const cleave = e.meleeKind === "greatcleave";
        const half = ((spec.sweepDeg + spec.bladeDeg) * Math.PI) / 360;
        const hearts = bossStringHearts(e.bossStringN - 1 - e.bossString.length, e.bossStringN) * BOSS_WAVE_SHARE;
        if (cleave) {
          /*
           * The cleave's point goes into the floor, so its wave comes out of
           * the floor there, and it is the cut's own shape: a **vertical**
           * edge, which from above is a straight line running along the cut
           * and no wider than a body (`Shockwave.width`) — not a crescent,
           * which is a horizontal sweep's. One step aside answers it.
           */
          const tip = cleaveTip(world, e, TILE_PX * spec.reachTiles);
          let facing = e.swing.facing;
          const turn = angleDeltaRad(facing, Math.atan2(world.player.y - tip.y, world.player.x - tip.x));
          facing += Math.max(-BOSS_WAVE_CLEAVE_TURN, Math.min(BOSS_WAVE_CLEAVE_TURN, turn));
          castShockwave(world, tip.x, tip.y, {
            chargeMs: 0, inner: 0, thickness: BOSS_CLEAVE_EDGE_LONG_PX,
            speed: BOSS_WAVE_SPEED, maxRadius: TILE_PX * 8,
            damage: hearts * e.damageMult, facing, width: BOSS_CLEAVE_EDGE_WIDE_PX,
          });
        } else {
          castShockwave(world, e.x, e.y, {
            chargeMs: 0, inner: TILE_PX * spec.reachTiles, thickness: BOSS_WAVE_THICK_PX,
            speed: BOSS_WAVE_SPEED, maxRadius: TILE_PX * 10,
            damage: hearts * e.damageMult, facing: e.swing.facing, half,
          });
        }
      }
      // Shock Cleave: the elite tank's chop cracks the floor ahead of it.
      if (e.meleeKind === "cleave" && e.archetype === "breaker") {
        shockCleave(world, e);
        e.pose = "cleave_shock";
        e.poseMs = spec.lungeMs + spec.recoverMs;
      }
      e.swing.hitIds.length = 0;
      advanceBox(e.swing, 0);
      break;
    }
    case "lunge":
      e.attack = "recover";
      // The archetype's tempo again: a heavy body takes longer to come back
      // off its own blow than a quick one, which is where the punish window
      // comes from. See `TEMPO`.
      e.attackMs = spec.recoverMs * tempoOf(e).recover;
      // Mid-string, the king does not stop: the recovery is the next blow's start.
      if (e.archetype === "boss" && e.bossString.length > 0) e.attackMs = BOSS_LINK_RECOVER_MS;
      e.swing.active = false;
      // The lancer's spikes, having been driven out, **hang** for a beat and
      // then fly off in the same eight directions: the drive is the melee half
      // and the flight the ranged half of one attack. The hang is what makes
      // the second half answerable — a player who stepped out of the drive is
      // standing right where the spikes are pointed, and needs the beat to
      // find the line between two of them. See `SPIKE_HANG_MS`.
      if (e.meleeKind === "lance") e.spikeMs = SPIKE_HANG_MS;
      /*
       * It brakes, hard.
       *
       * Three versions of this ending were wrong in three ways. Left on the
       * ordinary ramp it took two seconds to stop — at 118 px/s² against a
       * charge speed of 238 — which read as drifting. Zeroed outright it read
       * as the body being switched off. What a mass arriving should look like
       * is a short, violent deceleration: the weight is *in* the stopping, so
       * the stopping needs frames.
       *
       * Only for an attack that has somewhere to arrive; a jab has nothing to
       * brake from.
       */
      // The dashcut plants at the end of its run rather than skidding on past it: a short slide, braked.
      if (e.archetype === "boss" && e.meleeKind === "dashcut") {
        e.velX = e.lungeX * BOSS_DASH_SLIDE;
        e.velY = e.lungeY * BOSS_DASH_SLIDE;
        bossDashWake(world, e);
      }
      if (spec.brakeMs > 0) {
        e.brakeMs = spec.brakeMs;
        // No shake: the screen moves only for the player's own hurt (doc 008).
        world.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: `brake:${e.archetype}` });
      } else {
        e.velX = 0;
        e.velY = 0;
      }
      break;
    case "recover": {
      e.attack = "approach";
      e.attackMs = 0;
      /*
       * **The boss's string** (doc 020): the next blow is wound up at once,
       * at the player where they now are, keeping the turn. A sweep after a
       * sweep comes back the other way. Only the last blow's recovery is the
       * full one, so the opening is after the string, not inside it.
       */
      if (e.archetype === "boss" && e.bossString.length > 0) {
        let next = e.bossString.shift()!;
        // A sweep or a slash goes out of his front only: at a player who has gone round beside or behind him, the backhand instead.
        if ((next.kind === "greatsweep" || next.kind === "greatslash") && (bossLevel(e, world.player) || bossBehind(e, world.player))) next = { ...next, kind: "maul" };
        const cuts = (k: MeleeKind | null): boolean => k === "greatsweep" || k === "greatslash";
        /*
         * Back the other way from the blow just thrown — from its own sweep, not from `strafe`, which the
         * strafe clock turns over on its own (`strafeMs`): turned once during a long windup, it made the
         * flip a no-op, and two front cuts in a row threw the sword from one side of him to the other.
         */
        if (cuts(next.kind) && cuts(e.meleeKind)) e.strafe = e.swing.sweep === 1 ? -1 : 1;
        e.bossLinked = true;
        e.bossLinkedBlow = next;
        beginWindup(world, e, world.player, next.kind);
        e.bossLinked = false;
        e.bossLinkedBlow = null;
        break;
      }
      /*
       * A **string**: sometimes the recovery the player was about to punish
       * is not there, and the next blow comes almost at once. The turn is
       * kept for it, because handing the token back and taking it again would
       * let another body cut in halfway through one animal's combination.
       *
       * Every blow in a string keeps its own full windup, so it is read the
       * same way as any other; what the player loses is the guarantee that
       * one attack means one opening. See `COMBO`.
       */
      if (e.comboLeft > 0) {
        e.comboLeft--;
        e.attackCooldownMs = spec.restMs * COMBO_REST * tempoOf(e).rest;
        break;
      }
      /*
       * **A string is one turn**, so the counter the archetype's move cycle
       * reads only advances at the end of it (`chooseMelee`). Advancing it per
       * blow would change the attack halfway through a combination, which is
       * a telegraph that lied about what it was the start of.
       */
      e.strung = false;
      e.casts++;
      // The turn is over: hand the token back and stand down for a beat, so
      // one body cannot hold a token permanently by re-committing instantly.
      dropToken(world, e);
      const guardianGap = e.guardian
        ? spec.kind === "charge" ? GUARDIAN_CHARGE_GAP_MULT : GUARDIAN_ATTACK_GAP_MULT
        : 1;
      e.attackCooldownMs = restAfter(world, e, spec.restMs * guardianGap);
      break;
    }
  }
}

/**
 * Enters the windup: the state machine's one entry action, so the timer and
 * the armed blade cannot come apart. Exported because the entry action is what
 * a test of the attack has to drive, and reproducing it at the call site is how
 * a test ends up asserting against a state the simulation never reaches.
 */
export function beginWindup(world: World, e: Enemy, target: { x: number; y: number }, kind?: MeleeKind): void {
  // `kind` is the boss lab's, or the next blow of a string: a blade asked for by name rather than chosen.
  e.meleeKind = kind ?? chooseMelee(e);
  // The blade his turn was is thrown: the turn is now the swing.
  if (e.archetype === "boss" && !e.bossLinked) e.bossBlade = null;
  // The string an opening blow starts, from the phase's table; the backhand is never one.
  if (e.archetype === "boss" && !e.bossLinked) {
    e.bossString = e.meleeKind && e.meleeKind !== "maul" ? [...(bossPhase(e).strings[e.meleeKind] ?? [])] : [];
    e.bossStringAt0 = -1;
    e.bossStringN = e.bossString.length + 1;
  }
  const spec = e.meleeKind ? MELEE_ATTACKS[e.meleeKind] : null;
  e.attack = "windup";
  /*
   * Planted means planted. The windup asks for no movement, but the velocity
   * ramp let the strafe the body was in carry on decaying through it, so a
   * spike drive that began in reach had slid out of it by the time it fired.
   * A body that has decided to attack stops on the spot.
   */
  e.velX = 0;
  e.velY = 0;
  /*
   * The windup this body performs, rather than the one the attack declares:
   * the archetype's tempo, jittered a twelfth either way, and never under the
   * reaction floor. See `TEMPO` and `TIMING_JITTER`.
   */
  const t = tempoOf(e);
  // ...and longer again while the run is young: the ramp's `tell` (doc 005).
  const tell = rampFor(world.roomIndex).tell;
  // The floor is real time: the king's windups are on his clock, which runs faster in phase III (`bossTempo`).
  const floor = WINDUP_FLOOR_MS * bossTempo(e);
  e.windupMs = Math.max(floor, jittered(world, (spec?.windupMs ?? MELEE.windupMs) * t.windup * tell));
  /*
   * The boss's blade lands on the beat of its theme (doc 020): an opening
   * blow's windup is held on, by less than a beat, until the commit falls on
   * the grid — only ever longer, so no telegraph is shortened to make the
   * music fit. A blow inside a string lands where the string lays it, on the
   * eighths after the opening one (`BossPhase.strings`), and never under the
   * reaction floor.
   */
  if (e.archetype === "boss") {
    const blow = e.bossLinked ? e.bossLinkedBlow : null;
    if (blow && e.bossStringAt0 >= 0) {
      // Where the string lays it; and where a late opening blow (a freeze) leaves too little for the floor,
      // the next eighth past the floor, so it is still on the grid rather than between two lines.
      const due = e.bossStringAt0 + blow.at * (BEAT_MS / 2) - e.bossFightMs;
      e.windupMs = due >= floor
        ? due : floor + untilGrid(e.bossFightMs + floor, BEAT_MS / 2);
    } else e.windupMs += untilGrid(e.bossFightMs + e.windupMs, BEAT_MS);
    e.bossBladeAt = e.bossFightMs + e.windupMs;
  }
  // The Veteran's ram is a boss-level commitment. Give its tell a little more
  // room so the line can finish, hold, and blink before the body commits.
  if (e.guardian && e.meleeKind === "charge") e.windupMs += 160;
  e.attackMs = e.windupMs;
  if (!spec) return;
  // Armed inert, so the telegraph the renderer draws *is* the hitbox.
  const v = normalise(target.x - e.x, target.y - e.y);
  // The king's blow costs what its place in the string says (`bossStringHearts`), not the spec's figure.
  const mult = e.archetype === "boss"
    ? e.damageMult * bossStringHearts(e.bossStringN - 1 - e.bossString.length, e.bossStringN) / Math.max(0.01, spec.damage)
    : e.damageMult * (e.guardian ? 1 : ENEMY_MELEE_DAMAGE);
  armMeleeAttack(e.swing, spec, e.x, e.y, bossAim(e, v.x, v.y), e.strafe, mult);
  // The Veteran's body is enlarged independently of the warden's attack art.
  // ResolveBodies keeps the player just outside that enlarged disc before the
  // swing resolver runs, so the ram's centre-based box must reach the body's
  // own edge or a contact can be separated before it is tested.
  if (e.guardian && spec.kind === "charge") {
    e.swing.bladeReach = Math.max(e.swing.bladeReach, e.radius + 1);
    e.swing.reach = Math.max(e.swing.reach, e.radius + 1);
  }
  if (e.guardian && spec.kind !== "charge") {
    // Its doubled body used an ordinary body's weapon geometry, making the
    // large sweep and shield visibly pass through the player before hitting.
    e.swing.bladeReach *= GUARDIAN_ATTACK_RANGE_MULT;
    e.swing.reach *= GUARDIAN_ATTACK_RANGE_MULT;
  }
  // The opening cut sets which way the whole string is drawn (`Enemy.bossComboFlip`).
  if (e.archetype === "boss" && (!e.bossLinked || e.bossLinkedBlow === null)) e.bossComboFlip = e.swing.sweep < 0;
  // Every committed melee attack is live, including the first one. The
  // telegraph is the player's warning; a hidden no-damage opening only made a
  // successful collision look broken and gave the first attack a different
  // damage rule from every later one.
  e.hasAttacked = true;
}

/*
 * **Where each of the king's cuts goes** (doc 020). He has one facing, the
 * camera's, mirrored for left and right, and his frames are drawn to it
 * (`boss-king-anchors.json`): the sweep and the slash carry the sword across
 * his front, from his one side round past his feet to the other; the cleave
 * comes down along a line at the player, beside him or in front of him (a
 * string's finisher); the dashcut runs along one side. So the sweeps are
 * always his front half (the one after it comes back the other way), the
 * dashcut is thrown only at a player level with him (`bossLevel`), and a
 * player behind him — where none of his cuts reaches — gets the backhand,
 * which swings round to wherever they are.
 */
const BOSS_FRONT_CUTS = new Set<MeleeKind>(["greatsweep", "greatslash"]);
function bossAim(e: Enemy, vx: number, vy: number): number {
  if (e.archetype === "boss" && e.meleeKind && BOSS_FRONT_CUTS.has(e.meleeKind)) return Math.PI / 2;
  return Math.atan2(vy, vx);
}
/** Within this of his left or right the player is level enough for a cut along a line, radians. */
const BOSS_LEVEL_RAD = (30 * Math.PI) / 180;
/** Whether the player (as he last saw them) is to his left or right rather than above or below. */
export function bossLevel(e: Enemy, at: { x: number; y: number } = { x: e.lookX, y: e.lookY }): boolean {
  const dx = at.x - e.x, dy = at.y - e.y;
  return Math.abs(dy) <= Math.abs(dx) * Math.tan(BOSS_LEVEL_RAD);
}
/** Whether the player is behind him — above him on the screen, past the level band — where his front cuts do not reach. */
export function bossBehind(e: Enemy, at: { x: number; y: number } = { x: e.lookX, y: e.lookY }): boolean {
  return at.y < e.y && !bossLevel(e, at);
}

/** The attack this body commits to, or null for one that only shoots. */
export function meleeSpec(e: Enemy): (typeof MELEE_ATTACKS)[keyof typeof MELEE_ATTACKS] | null {
  // An attack in progress keeps the spec it was armed with: a charge that
  // turned into a slash halfway because the player got close would be a
  // charge whose telegraph lied.
  if (e.attack !== "approach" && e.meleeKind) return MELEE_ATTACKS[e.meleeKind];
  const kind = chooseMelee(e);
  return kind ? MELEE_ATTACKS[kind] : null;
}

function angleDeltaRad(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Which attack this body would open with now. */
function chooseMelee(e: Enemy): MeleeKind | null {
  // The tank: the ram from range, and when the player is on top of it or
  // behind it — where a ram cannot start — the greatsword comes down from
  // overhead instead. The ram stays because it read well.
  /*
   * The tank: the overhead chop when the player is on top of it or behind
   * it, and otherwise **the slam twice for every ram**. The ram is the move
   * everybody remembers and it is also the one that asks the least — leave
   * the lane — so making it one turn in three is what turns the tank from a
   * bull into something that owns the ground it is standing on. It walks all
   * the way in for a slam, and the walk is the tell.
   */
  if (baseArchetype(e.archetype) === "tank") return e.closeIn ? "cleave" : e.casts % 3 === 0 ? "charge" : "slam";
  // The Frontier Veteran (doc 024): the tank's ram from range — twice running when the first misses —
  // and on top of it the shield shove and the gun's sweep by turns.
  if (e.guardian) return e.guardian.chainNext ? "charge" : e.closeIn ? (e.casts % 2 === 0 ? "sweep" : "bash") : "charge";
  // The boss: by phase, and by distance within the phase.
  if (e.archetype === "boss") {
    // Inside a string: the next blow is already decided (`BossPhase.strings`).
    if (e.bossString.length > 0) return e.bossString[0]!.kind;
    // The blade his turn is (`chooseBossAct` in world.ts).
    if (e.bossBlade) return e.bossBlade;
    const ph = bossPhase(e);
    // The run at a player keeping their distance, from phase II: the dashcut.
    // Only along a line he can run, level with him (`bossLevel`).
    if (ph.melee.far === "dashcut" && e.gapPx > ph.farPx && bossLevel(e)) return "dashcut";
    // Behind him, where the sweeps cannot reach: the backhand, round to them.
    if (bossBehind(e)) return "maul";
    // On top of him: the sweep, across his front.
    if (e.closeIn) return ph.melee.near;
    // From phase II the strings open on the light slash too (`BossPhase.strings`), turn and turn about.
    return e.casts % 2 === 0 ? "greatsweep" : "greatslash";
  }
  /*
   * The spiked bodies have **three** moves and only one of them travels.
   *
   * They drove their spikes out where they stood and nothing else, which asks
   * the player for spacing once and then never again; the stab was the first
   * answer to that, and on its own it went too far the other way — every
   * other attack in the room became something arriving at speed. So the cycle
   * is stab, claw, drive: one dash in three, and the other two are shapes.
   *
   * Each is answered differently — a stab is stepped off sideways, a claw's
   * second swipe catches the step, a drive is backed out of — and alternating
   * rather than choosing purely by range is what keeps all three alive, since
   * a stab commits from 63 px, a claw from 51 and a drive from 38, so a body
   * that always took whichever fitted would always be taking the stab. On a
   * claw or a drive turn it keeps walking until it is at that range, and the
   * extra stride is itself the tell.
   */
  /*
   * **The rusher never travels.** It walks up fast and pokes: a two-hit claw
   * swipe, then the all-round spike drive at arm's length, turn and turn
   * about. It had a stab that closed the last stride, and the reason it is
   * gone is the summoner — rushers arrive three and four at a time, and
   * several bodies crossing ground at once is not a fight the player can
   * position against, it is a lock. What makes a group of them dangerous is
   * where they stand, which the attack tokens and the waiting ring govern.
   */
  /*
   * **The rusher has one attack: the stab.** It walks up fast and drives its
   * spikes out, and that is the whole of it. The fan swipe was reported as
   * useless and the charge before it as unmanageable — summoners call rushers
   * in three and four at a time, so nothing in this body's kit may cross
   * ground at the player or ask to be read twice. What makes a pack of them
   * dangerous is where they stand, which the tokens and the waiting ring
   * govern.
   */
  if (e.archetype === "rusher") return ENEMIES[e.archetype].melee;
  /*
   * The lancer is the same stab with its spikes **left standing**: they hang
   * for a beat and then fly outward (`lance`, `SPIKE_HANG_MS`). One move, one
   * question asked twice — step out of the drive, then find the gap between
   * two spikes.
   */
  if (e.archetype === "lancer") return "lance";
  /*
   * The delver keeps a stab, because it is never a crowd: it arrives alone,
   * and its signature is the dive, which is answered by reading the mound
   * rather than by dodging a body.
   */
  if (baseArchetype(e.archetype) === "delver") {
    const turn = e.casts % 3;
    if (turn === 0 && e.gapPx > LUNGE_FROM_PX) return "thrust";
    if (turn === 1) return "claw";
    return ENEMIES[e.archetype].melee;
  }
  /*
   * The lancer alternates the drive and the **sweep**, neither of which
   * travels: its whole character is reach held from a standing body, and a
   * charging lancer was the tank's ram at a smaller size.
   */
  return ENEMIES[e.archetype].melee;
}

/**
 * Where the boss stands between blows, px between the bodies' edges: inside
 * the reach of his sweep and his slash, so a player who stays where he came
 * to is in his next cut, and one who wants out of it has to move.
 */
const BOSS_STAND_GAP_PX = 46;
/** How far inside his standing distance he lets the player be before stepping back out to it, px. */
const BOSS_STAND_SLACK_PX = 4;
/**
 * His pacing between turns: a half swing across their front takes this long;
 * how far to either side it goes, how far it eases back out; his pace at most
 * while following it, at least while it is moving, and how far behind it he
 * has to be for the most.
 */
const BOSS_PACE_MS = 2200;
const BOSS_PACE_SIDE_PX = 40;
const BOSS_PACE_BACK_PX = 24;
const BOSS_PACE_SPEED = 0.55;
const BOSS_PACE_MIN = 0.12;
const BOSS_PACE_EASE_PX = 26;

/** Inside this the boss swings rather than shoots: nearer than where he stands (`BOSS_STAND_GAP_PX`), so he still shoots from there. */
const BOSS_PATTERN_MIN_GAP = 70;


/**
 * **The king for one of his two meetings** (doc 022). His bar is the script's
 * (`kingHp`), and his phases its thresholds (`bossPhaseAt`).
 */
export function makeKing(id: number, x: number, y: number, script?: BossScript): Enemy {
  const e = makeEnemy(id, "boss", x, y, []);
  if (!script) return e;
  e.bossScript = script;
  e.hp = e.maxHp = kingHp(script);
  return e;
}

/**
 * The least health the first audience can leave him on: the retreat's line.
 * Whatever lands past it — a big hit, a burn ticking through the roar — is
 * held there, so he always leaves and is never killed in room 5.
 */
export function kingFloorHp(e: Enemy): number {
  return e.bossScript === "audience" ? Math.ceil(e.maxHp * KING_RETREAT_AT) : 0;
}

/** The boss's current phase entry. */
export function bossPhase(e: Enemy): BossPhase {
  return BOSS_PHASES[Math.min(BOSS_PHASES.length, Math.max(1, e.phase)) - 1]!;
}

/*
 * **Every move costs about a tenth of the bar, and a string climbs to more**
 * (doc 020). A single blow — a sweep, a cleave, the dashcut, the backhand, the
 * slam's strike and its band, a crack of the quake, the leap's landing — is
 * one heart, ten points, in every phase and at every moment of the fight: a
 * late room's body hits about as hard, and the king should hit at least as
 * hard as what the player walked through to reach him. A string's blows climb
 * from eight to twelve (`bossStringHearts`), so its last blow — the one the
 * rhythm was hiding — is the one that hurts most. The phases escalate by what
 * he does (longer strings, more turns, shorter rests), never by a multiplier,
 * and nothing climbs with the clock: a fight that went long is one the player
 * was reading, and it is not made unwinnable for it. The hook costs nothing
 * (it hands them to the slash); a shot of the heart volley is chip
 * (`BOSS_BULLET_DAMAGE`), two points.
 */
export const BOSS_POWER = 1;
/**
 * How much larger the king's shots are than a roster body's: a shot three or
 * four px across beside a body four tiles tall read as a spray of sparks, not
 * as the heart he fires from. Fewer and slower too (`BOSS_PHASES`), so a
 * volley is a few big things to walk between.
 */
const BOSS_SHOT_SCALE = 2.4;
/** One shot of the heart volley, in hearts: chip, so the sword is what is feared. */
export const BOSS_BULLET_DAMAGE = 0.2;
/**
 * Where the heart volley leaves from: the open left palm he raises for it
 * (`tele`, `tele1`), world px from his body's centre. Every phase draws that
 * hand at about art (170, 86) of its 256 px frame, on screen right, and the
 * volley's frames are never mirrored (`bossFlip`), so one point serves all
 * three. Fired from his centre, the shots came out of the floor between his
 * feet, a hand's length below and beside the palm that was lit for them.
 */
export const BOSS_PALM_PX = { x: 21, y: -56 } as const;

/** Where a held volley leaves: the king's raised palm (`BOSS_PALM_PX`), anyone else's body. */
function volleyFrom(world: World, e: Enemy): { x: number; y: number } {
  return e.archetype === "boss" ? bossPalmOf(world, e) : { x: e.x, y: e.y };
}

/**
 * The king's palm, or as near it as the room allows: backed in towards his
 * centre when it is in stone (as `muzzleOf`), since a shot born in a wall is
 * gone before it is seen — before the throne, his raised hand is over its steps.
 */
export function bossPalmOf(world: World, e: Enemy): { x: number; y: number } {
  for (const k of [1, 0.75, 0.5, 0.25]) {
    const x = e.x + BOSS_PALM_PX.x * k;
    const y = e.y + BOSS_PALM_PX.y * k;
    if (!circleHitsWall(world.room.grid, x, y, 2) && hasLineOfSight(world.room.grid, e.x, e.y, x, y)) return { x, y };
  }
  return { x: e.x, y: e.y };
}

/**
 * The hearts blow `i` of an `n`-blow string costs (doc 020): a single blow is
 * one heart; a pair is one and then 1.2; longer strings climb evenly from 0.8
 * to 1.2 — eight, nine, eleven, twelve points for four blows.
 */
export function bossStringHearts(i: number, n: number): number {
  if (n <= 1) return 1;
  if (n === 2) return i === 0 ? 1 : 1.2;
  return 0.8 + (0.4 * i) / (n - 1);
}


/**
 * Advances the boss's phase from its health, and marks the change.
 *
 * A phase change is a beat: the volley in hand is dropped, the room shakes,
 * and the renderer swaps the sheet. Without the pause the player is told "it
 * is different now" while being shot at, which is a message they cannot read.
 *
 * Going up a phase it is more than a beat: **the roar** (`BOSS_ROAR_MS`). He
 * stops dead wherever he is — whatever he was doing is dropped — his armour
 * breaks off him, and he roars, a dark shudder going out through the hall;
 * for all of it he cannot be hurt, so the player's burst is not spent into a
 * cutscene. Then **the call** (`stepBoss` in world.ts): the greatsword up,
 * the phase's adds rising about him, and violet bolts called down after the
 * player a beat apart, so the moment he stands still is not a free one.
 */
const PHASE_CHANGE_PAUSE_MS = 800;
/** The roar at a phase change, ms: five beats standing, armour off, unhurtable. */
export const BOSS_ROAR_MS = beats(5);

/** The king's sword wave: what share of its blow it costs, how thick and fast it runs, and the cleave's arc. */
const BOSS_WAVE_SHARE = 0.5;
const BOSS_WAVE_THICK_PX = 20;
const BOSS_WAVE_SPEED = 300;
/** The cleave's edge: how far it runs along the cut, and how wide it is across it. */
const BOSS_CLEAVE_EDGE_LONG_PX = 30;
const BOSS_CLEAVE_EDGE_WIDE_PX = 18;

/** Where the cleave's point meets the floor: its reach along the cut, short of any wall between. */
function cleaveTip(world: World, e: Enemy, reach: number): { x: number; y: number } {
  const dx = Math.cos(e.swing.facing), dy = Math.sin(e.swing.facing);
  for (let r = reach; r > 0; r -= 4) {
    const x = e.x + dx * r, y = e.y + dy * r;
    if (!circleHitsWall(world.room.grid, x, y, 2) && hasLineOfSight(world.room.grid, e.x, e.y, x, y)) return { x, y };
  }
  return { x: e.x, y: e.y };
}
/** How far the cleave's wave may be turned from the line it struck, toward the player, as it is thrown. */
const BOSS_WAVE_CLEAVE_TURN = (30 * Math.PI) / 180;
/** The freeze the king's cleave costs the frame, ms: three frames, as a greatsword into stone should. */
const BOSS_CLEAVE_STOP_MS = 50;
/** The sweep's freeze as it lands: a little under the cleave's. */
const BOSS_SWEEP_STOP_MS = 40;
/** The recovery between two blows of the boss's string, ms: next to none, the sword carried into the next. */
export const BOSS_LINK_RECOVER_MS = 60;
/** How far past where the player stood the dashcut runs, px: a body's width, so a step off its line is still passed. */
export const BOSS_DASH_PAST_PX = 40;
/** The dashcut's speed as it plants, px/s: a short slide, braked (`brakeMs`). */
export const BOSS_DASH_SLIDE = 90;
/*
 * **The dashcut's wake** (phase III). The run leaves the ground either side
 * of it heaving: a short straight edge each side for every stretch of floor
 * it crosses, each set off as he passes it (`layWake`), rolling out off his
 * line a short way and dying — a bow wave opening behind him, not a blast. A
 * player who stepped off the line to let the run go by is standing where the
 * wake comes, a beat after he passes them; a second step, or the dash,
 * answers it. The stretches are one attack: the first to land spends them all.
 */
const BOSS_WAKE_REACH_PX = TILE_PX * 2.5;
const BOSS_WAKE_SPEED = 150;
const BOSS_WAKE_THICK_PX = 16;
const BOSS_WAKE_DAMAGE = 0.5;
/** One stretch of the wake per this much of the run, px: under half a body, so it reads as one edge unfolding. */
export const BOSS_WAKE_STEP_PX = 12;
/**
 * Lays the wake the run has passed since last step; `final` as it ends, for
 * the last short stretch. The cue sounds with the first stretch, where the
 * wake is seen to start.
 */
export function bossDashWake(world: World, e: Enemy, final = true): void {
  const t = e.dashWake;
  if (!t || e.phase < 3) return;
  const first = t.laid === 0;
  if (layWake(world, t, e.x, e.y, final) > 0 && first)
    world.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "boss_wake" });
  if (final) e.dashWake = null;
}

/**
 * How fast the king's own clock runs against real time (`BOSS_RAGE_TEMPO`):
 * faster from the landing that opens phase III, not before it — the fall
 * into it (`BOSS_METEOR_MS`) is still played at the old tempo.
 */
export function bossTempo(e: Enemy): number {
  return e.archetype === "boss" && e.phase >= 3 && !bossFalling(e) ? BOSS_RAGE_TEMPO : 1;
}

/** The phase the boss piece plays: phase III's layers come in with the landing, as its tempo does. */
export function bossMusicPhase(e: Enemy): number {
  return e.phase >= 3 && bossFalling(e) ? 2 : e.phase;
}

/** Whether he is still on his way into phase III: the roar, or the fall before its landing. */
function bossFalling(e: Enemy): boolean {
  return e.bossRoarMs > 0 || e.bossCast === "meteor" && (e.bossCastMs > 0 || e.bossCastEndAt < 0);
}

function stepBossPhase(world: World, e: Enemy): void {
  if (e.archetype !== "boss" || e.hp <= 0) return;
  const next = bossPhaseAt(e.hp / Math.max(1, e.maxHp), e.bossScript);
  if (next === e.phase) return;
  const prev = e.phase;
  e.phase = next;
  e.bossCast = "none";
  e.bossCastMs = 0;
  e.airborne = false;
  // Out of a leap or a hop, down where he is (a burn can cross a threshold while he is up out of the hall).
  e.bossLift = 0;
  e.bossHopMs = 0;
  e.bossMoveMs = 1400;
  e.bossMoveIndex = 0;
  e.bossBlade = null;
  e.bossVolleyMs = 0;
  e.bossStartAt = -1;
  e.bossNext = "none";
  e.bossString = [];
  e.bossStringAt0 = -1;
  e.bossLinked = false;
  e.pending = [];
  e.telegraphMs = 0;
  dropFireToken(world, e);
  e.attackCooldownMs = Math.max(e.attackCooldownMs, PHASE_CHANGE_PAUSE_MS);
  if (next > prev) {
    // Stopped dead: the blade in hand, the chain out, the stagger he was in, all dropped.
    e.attack = "approach";
    e.attackMs = 0;
    e.swing.active = false;
    e.swing.trackingMs = 0;
    e.staggerMs = 0;
    e.stunMs = 0;
    e.poiseBreakMs = 0;
    e.bossHooked = false;
    e.bossPlanMs = 0;
    e.velX = 0;
    e.velY = 0;
    dropToken(world, e);
    for (const t of world.tethers) if (t.alive && t.from === e.id) t.alive = false;
    e.bossSummonMs = 0;
    e.bossBusy = true;
    // The armour breaks off him and he roars; after it, the call (phase II) or the fall (phase III, `stepBoss`).
    e.bossRoarMs = BOSS_ROAR_MS;
  }
  world.trauma = Math.min(1, world.trauma + 0.5);
  world.events.push({ kind: "telegraph", x: e.x, y: e.y, what: `boss_phase:${next}` });
}

/**
 * The rest after an attack, with the rusher's second move folded in: about a
 * third of its thrusts are followed by another almost at once. A body whose
 * every attack is followed by the same pause is a metronome the player stops
 * hearing; a body that sometimes comes twice has to be watched.
 */
function restAfter(world: World, e: Enemy, restMs: number): number {
  /*
   * The roll for the **next** string is taken here, at the end of a turn, so
   * a body that has just finished one already knows whether it is coming
   * again — and the string it starts is at most `COMBO_MAX` long, so no
   * animal attacks forever. The rusher's old one-in-three second thrust is
   * this rule with its own entry in `COMBO`.
   */
  e.comboLeft = world.rng.next() < (COMBO[e.archetype] ?? 0) ? COMBO_MAX : 0;
  /*
   * And it waits longer between turns while the run is young. The ramp's
   * `tell` lengthens the announcement; this lengthens the gap, which is the
   * half a new player actually needs — measured on the novice profile the
   * rusher was a third of every heart lost not because its tell was missed
   * but because it came round again before the player had moved.
   */
  return jittered(world, restMs * tempoOf(e).rest * rampFor(world.roomIndex).tell / turnRate(world, e));
}

/**
 * The summoner's second move: when the sword gets close it **blinks** to a
 * free spot a few tiles away, once every few seconds, with a puff at both
 * ends so the eye can follow it. A back-line body that can be walked up to
 * and cut down without answering is a target, not an opponent.
 */
const BLINK_TRIGGER_PX = 90;
const BLINK_DISTANCE_PX = 150;
const BLINK_COOLDOWN_MS = 4000;

function blink(world: World, e: Enemy, dtMs: number): void {
  if (e.archetype !== "summoner") return;
  if (e.blinkCooldownMs > 0) { e.blinkCooldownMs -= dtMs; return; }
  if (!e.awake || e.hp <= 0 || e.spawnFadeMs > 0) return;
  const p = world.player;
  const d = Math.hypot(p.x - e.x, p.y - e.y);
  if (d > BLINK_TRIGGER_PX) return;
  const away = Math.atan2(e.y - p.y, e.x - p.x);
  const to = freeSpotNear(world, e.x + Math.cos(away) * BLINK_DISTANCE_PX, e.y + Math.sin(away) * BLINK_DISTANCE_PX, 24, away);
  if (!to) return;
  world.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "blink_from" });
  e.x = to.x;
  e.y = to.y;
  e.velX = 0;
  e.velY = 0;
  world.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "blink_to" });
  e.blinkCooldownMs = BLINK_COOLDOWN_MS;
}

/**
 * The sidestep, rolled once per player commitment.
 *
 * The trigger is the player's own swing or dash, which is the only signal in
 * the game that says *the player has committed to something* — so a body that
 * answers it is reacting rather than running a loop. A chaser hops across the
 * player's line to keep its angle; a ranged body hops away, which is the same
 * instinct pointed the other way. It never fires out of a windup or a lunge:
 * a commitment is a commitment, and a body that could dodge out of its own
 * telegraph would make every tell a lie.
 */
function juke(world: World, e: Enemy, dtMs: number): void {
  if (e.jukeMs > 0) { e.jukeMs -= dtMs; return; }
  if (e.jukeCooldownMs > 0) { e.jukeCooldownMs -= dtMs; return; }
  const chance = JUKE[e.archetype] ?? 0;
  if (chance <= 0 || anchored(e)) return;
  if (e.attack !== "approach" || e.pose !== "" || e.alertMs > 0 || submerged(e)) return;
  const p = world.player;
  // A swing or a dash, and only one the body is close enough to be part of.
  if (!world.swing.active && p.dashMs <= 0) return;
  const d = Math.hypot(p.x - e.x, p.y - e.y);
  if (d > JUKE_NOTICE_PX || d < 1) return;
  if (world.rng.next() >= chance) return;
  const away = { x: (e.x - p.x) / d, y: (e.y - p.y) / d };
  const melee = ENEMIES[e.archetype].melee !== null;
  // Across the line for a body with a blade, straight back for one without.
  const dir = melee
    ? { x: -away.y * e.strafe, y: away.x * e.strafe }
    : away;
  // Into stone is not a dodge: the other side, or nothing.
  const clear = (v: { x: number; y: number }): boolean =>
    !circleHitsWall(world.room.grid, e.x + v.x * e.radius * 2.6, e.y + v.y * e.radius * 2.6, e.radius);
  const pick = clear(dir) ? dir : { x: -dir.x, y: -dir.y };
  if (!clear(pick)) return;
  e.jukeX = pick.x;
  e.jukeY = pick.y;
  e.jukeMs = JUKE_MS;
  e.jukeCooldownMs = JUKE_COOLDOWN_MS;
  world.events.push({ kind: "telegraph", x: e.x, y: e.y, what: `juke:${e.archetype}` });
}

/**
 * Which way a waiting body works round the player: toward their **back**.
 *
 * A ring of bodies all circling the same way round a player who is facing one
 * of them is a carousel; a ring that pulls toward whichever side the player
 * is not looking at is a group flanking. It costs one sign, and it is the
 * whole difference between "the enemies are dumb" and a fight where turning
 * round is something the player has to keep doing.
 */
function flankSign(world: World, e: Enemy): 1 | -1 {
  const p = world.player;
  // The angle from the player to this body, relative to where they are facing.
  let da = Math.atan2(e.y - p.y, e.x - p.x) - p.facing;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  // Already behind them: hold the flank rather than orbiting through the front.
  if (Math.abs(da) > Math.PI * 0.6) return e.strafe;
  return (da > 0 ? 1 : -1) as 1 | -1;
}

function meleeStep(
  e: Enemy,
  world: World,
  /** Steady, for closing on the player. */
  speed: number,
  /** Gaited, for holding a ring with no turn to take. See `moveFor`. */
  amble: number,
  toward: () => { x: number; y: number },
): { dx: number; dy: number } {
  const p = seenPlayer(world, e);
  // The gap this body's own attack commits from; see `commitRange`.
  const spec0 = meleeSpec(e);
  const reach = e.radius + PLAYER_RADIUS
    + (spec0?.commitRange ?? MELEE.range) * (e.guardian && spec0?.kind !== "charge" ? GUARDIAN_ATTACK_RANGE_MULT : 1);

  switch (e.attack) {
    case "approach": {
      const gap2 = dist2(e.x, e.y, p.x, p.y);
      // The king's turns are his own (`chooseBossAct`): he is ready when the one he chose is a blade.
      const ready = e.archetype === "boss" ? e.bossBlade !== null : e.attackCooldownMs <= 0 && e.attackLockMs <= 0;
      // A volley turn is fired standing; and before his first turn he stands in the ceremony (the renderer's pose),
      // whether or not he can see them yet.
      if (e.archetype === "boss" && !ready && (e.bossVolleyMs > 0 || e.bossLastAct === "")) return { dx: 0, dy: 0 };

      /*
       * Out of sight: walk, and do not hold a ring.
       *
       * The ring test below measures **straight-line** distance, and with a
       * wall in between that is a lie — a body six feet from the player
       * through masonry reads as having arrived, so it stood against the wall
       * and circled instead of going round. The `keep_distance` branch already
       * uses path distance for exactly this reason and says so; this one did
       * not.
       *
       * Rather than converting the ring to path distance, an unsighted body
       * simply pursues: `toward` follows the shared flow field when the line
       * is broken, which is the route round. Holding a ring is a thing to do
       * *at* the player, and there is no sense holding position relative to
       * someone you cannot see.
       */
      if (!hasLineOfSight(world.room.grid, e.x, e.y, p.x, p.y) || e.blockedMs > 0) {
        /*
         * Also when pressed against something. A body holding its ring is
         * moving, so the jam fallback never fired for it — being blocked at all
         * is enough evidence that the ring is not where it can stand.
         */
        const v = toward();
        return { dx: v.x * speed, dy: v.y * speed };
      }

      /*
       * **The king keeps no waiting ring.** The ring is how a room of bodies
       * shares its turns; the boss has no one to share with, and holding a ring
       * sized to the blade in hand — the dashcut's, from across the room — walked
       * him backwards into a corner every time the player stood off. Between
       * blows he walks in to just outside his sweep and stands there, which is
       * a king waiting for the player to come to him.
       */
      if (e.archetype === "boss" && !ready) {
        const stand = e.radius + PLAYER_RADIUS + BOSS_STAND_GAP_PX;
        /*
         * **He comes round to face them.** He has one facing, the camera's,
         * and most of what he throws goes out of his front (`bossAim`), so
         * between blows he walks to the spot straight above the player at
         * his standing distance — the player is then in front of him. With
         * the player behind him he goes round their side rather than through
         * them. Where that spot is wall (the player against the north wall)
         * he keeps to the old footing: in to his distance, or out to it.
         */
        /*
         * **Stalking, never standing.** Between turns he is always walking:
         * the spot he makes for swings from one side of the ground in front
         * of them to the other and back on a slow sine, and eases out and in
         * on a slower one — a king circling, sizing the player up. He follows
         * it at a pace in proportion to how far behind it he is
         * (`BOSS_PACE_EASE_PX`), so his speed runs on the same curve: quickest
         * crossing their front, slowing into each turn, never stopped.
         */
        const t = e.bossFightMs / BOSS_PACE_MS;
        const side = Math.sin(t * Math.PI) * BOSS_PACE_SIDE_PX;
        const off = (0.5 - 0.5 * Math.cos(t * Math.PI * 0.5)) * BOSS_PACE_BACK_PX;
        /*
         * **Where he can stand.** Above them first, so they are in front of
         * him; where that is wall (a player against the north wall, in beside
         * the throne) level with them to one side — his own side first —
         * where the cleave and the dashcut go; failing both, below them. A
         * spot is one he fits in and can see them from.
         */
        const mine = e.x >= p.x ? 1 : -1;
        const spots = [
          { x: p.x + side, y: p.y - stand - off, front: true },
          { x: p.x + mine * stand, y: p.y, front: false },
          { x: p.x - mine * stand, y: p.y, front: false },
          { x: p.x + side, y: p.y + stand, front: false },
        ];
        const spot = spots.find((q) => !circleHitsWall(world.room.grid, q.x, q.y, e.radius)
          && hasLineOfSight(world.room.grid, q.x, q.y, p.x, p.y));
        if (spot) {
          const behind = spot.front && e.y > p.y - stand * 0.4 && Math.abs(e.x - p.x) < stand * 0.8;
          // Round their side first when they are behind him, on the side he is already on.
          const tx = behind ? p.x + mine * stand : spot.x;
          const ty = behind ? e.y : spot.y;
          const dx = tx - e.x, dy = ty - e.y;
          const d = Math.hypot(dx, dy);
          if (d < 1e-3) return { dx: 0, dy: 0 };
          // Full pace far from it; within reach of it, in proportion — the curve — and never under a stroll.
          const pace = d > 60 ? 1 : Math.max(BOSS_PACE_MIN, BOSS_PACE_SPEED * Math.min(1, d / BOSS_PACE_EASE_PX));
          return { dx: (dx / d) * speed * pace, dy: (dy / d) * speed * pace };
        }
        if (gap2 > stand * stand) {
          const v = toward();
          return { dx: v.x * speed, dy: v.y * speed };
        }
        // Closer than that — a string carried him in — he steps back out to it, which is where he shoots from.
        if (gap2 < (stand - BOSS_STAND_SLACK_PX) ** 2) {
          const d = Math.sqrt(gap2) || 1;
          return { dx: ((e.x - p.x) / d) * speed * 0.6, dy: ((e.y - p.y) / d) * speed * 0.6 };
        }
        return { dx: 0, dy: 0 };
      }

      /*
       * With a turn to take: close, and commit once in range.
       *
       * The token is only claimed at the moment of committing, not on the way
       * in, so a body walking toward the player does not hold a turn the whole
       * time it travels — otherwise two approaching enemies would lock out
       * everything already in position.
       */
      if (ready) {
        /*
         * Never commit through a wall.
         *
         * A charge is aimed at where the body last saw the player, and without
         * a sight test it would announce and launch at a player standing on
         * the far side of masonry — which looks exactly as stupid as it is,
         * and wastes the one attack the player is supposed to respect.
         */
        const clear = hasLineOfSight(world.room.grid, e.x, e.y, p.x, p.y);
        if (clear && gap2 <= reach * reach && (e.guardian || firePresence(world, e) > 0) && takeToken(world, e)) {
          beginWindup(world, e, p);
          return { dx: 0, dy: 0 };
        }
        if (gap2 > reach * reach) {
          const v = toward();
          return { dx: v.x * speed, dy: v.y * speed };
        }
      }

      /*
       * With no turn to take: hold the waiting ring and circle it.
       *
       * This is the visible half of the token system and the half that answers
       * "the player spends the whole fight running away". A body that cannot
       * attack must not keep pressing in, or the player is still surrounded and
       * still has to leave — the cap would only have changed how often they
       * are hit, not what they can do about it.
       *
       * It **holds a distance** rather than simply circling, which the first
       * version got wrong with consequences: circling on entering the ring
       * meant a body that still had its turn never closed the last few pixels
       * to striking range, so it orbited forever and the melee archetypes
       * stopped attacking altogether. Measured, they fell to five per cent of
       * all damage in the game.
       */
      /*
       * **A waiting body works the ring in steps, not in circles.** Holding a
       * radius for ever is motion without intent; every `RING_STEP_MS` it
       * commits to something the player can read — closing the ring when they
       * are not looking at it, holding when they are — and that is what
       * resets its threat clock (`Enemy.threatMs`).
       */
      if (e.postMs <= 0) {
        e.postMs = RING_STEP_MS;
        e.threatMs = 0;
        // Behind the player is where a waiting body presses.
        let da = Math.atan2(e.y - world.player.y, e.x - world.player.x) - world.player.facing;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        e.closeIn = Math.abs(da) > Math.PI * 0.55;
      }
      const ring = reach * (e.closeIn ? WAITING_RING * 0.72 : WAITING_RING);
      const gap = Math.sqrt(gap2) || 1;
      const v = toward();
      // Sideways, plus whatever correction holds the ring. The side is chosen
      // toward the player's back rather than by the body's own strafe clock,
      // so a waiting group flanks. See `flankSign`.
      const side = flankSign(world, e);
      const radial = (gap - ring) / ring;
      const drift = Math.max(-1, Math.min(1, radial * 2.5));
      return {
        dx: (-v.y * side * WAITING_STRAFE + v.x * drift) * amble,
        dy: (v.x * side * WAITING_STRAFE + v.y * drift) * amble,
      };
    }
    case "windup":
      // Planted, and tracking the player only with its facing. The lunge
      // vector is taken when the windup expires, in `stepEnemy`.
      return { dx: 0, dy: 0 };
    case "lunge": {
      // A charging thrust moves; a planted slash barely does. See `commitSpeed`.
      const commit = meleeSpec(e)?.commitSpeed ?? 0;
      return { dx: e.lungeX * speed * commit, dy: e.lungeY * speed * commit };
    }
    case "recover": {
      // Drifting back out, which opens the gap the player needs to punish —
      // or planting, for an attack whose ending is the stop. See `recoilSpeed`.
      const recoil = meleeSpec(e)?.recoilSpeed ?? MELEE.recoilSpeed;
      return { dx: -e.lungeX * speed * recoil, dy: -e.lungeY * speed * recoil };
    }
  }
}

/**
 * An emplacement — turret, sentinel, rifter — is bolted to the floor: no
 * blow, pull or shove moves it. A turret knocked across the room by a sword
 * was a turret that could be herded, which is not what a fixed gun is.
 */
export function anchored(e: Enemy): boolean {
  return ENEMIES[e.archetype].behaviour === "stationary";
}

/** The centre of the nearest cell a body can stand in, searched outward in rings. */
function freeFloorNear(world: World, x: number, y: number): { x: number; y: number } | null {
  const cx = Math.floor(x / TILE_PX);
  const cy = Math.floor(y / TILE_PX);
  for (let r = 1; r <= 6; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const gx = cx + dx;
        const gy = cy + dy;
        if (gx < 1 || gy < 1 || gx >= GRID_W - 1 || gy >= GRID_H - 1) continue;
        const px = (gx + 0.5) * TILE_PX;
        const py = (gy + 0.5) * TILE_PX;
        if (!circleHitsWall(world.room.grid, px, py, 2)) return { x: px, y: py };
      }
  return null;
}

export function stepEnemy(world: World, e: Enemy, dtMs: number): void {
  const dt = dtMs / 1000;
  // Unlike an ordinary post-attack cooldown, this runs while the body is
  // hidden or emerging: the Veteran entrance's three-second truce includes
  // the smalls' climb out of the floor rather than starting after it.
  if (e.attackLockMs > 0) e.attackLockMs = Math.max(0, e.attackLockMs - dtMs);
  // The king is never moved by the player: no knockback from any hit, spell or shove (as he holds his ground against bodies).
  if (e.archetype === "boss") { e.knockX = 0; e.knockY = 0; }
  if (anchored(e)) {
    e.knockX = 0;
    e.knockY = 0;
    e.nudge.x = 0;
    e.nudge.y = 0;
  }

  if (e.spawnFadeMs > 0) {
    e.spawnFadeMs -= dtMs;
    return;
  }

  /*
   * **Gone to ground** for the Frontier Veteran's volley (`Enemy.hideMs`):
   * nothing this step, and when it is up it rises as a spawn does, the red
   * rings first, so its coming back is read before it can hurt.
   */
  if (e.hideMs > 0) {
    e.hideMs -= dtMs;
    if (e.sinkMs > 0) e.sinkMs -= dtMs;
    e.velX = 0;
    e.velY = 0;
    e.knockX = 0;
    e.knockY = 0;
    if (e.hideMs <= 0) {
      e.airborne = false;
      e.spawnFadeMs = SPAWN_FADE_MS + SPAWN_TELEGRAPH_MS;
      world.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "boss_summon" });
    }
    return;
  }
  if (e.stunMs > 0) e.stunMs -= dtMs;

  /*
   * **A body inside stone is put back on the floor.**
   *
   * Nothing places one there — spawns resolve to free cells — but the world
   * can make a cell solid afterwards, and a body that ends up inside one is
   * stuck for good: `moveSliding` refuses every direction, the unwedge probes
   * find stone on both sides, and with no line of sight it never fires
   * either. What the player sees is an enemy hovering over a wall, ignoring
   * them, that the room can never be cleared without. It is a repair rather
   * than a behaviour, so it happens before anything else this step.
   */
  if (circleHitsWall(world.room.grid, e.x, e.y, 2)) {
    const to = freeFloorNear(world, e.x, e.y);
    if (to) {
      e.x = to.x;
      e.y = to.y;
      e.velX = 0;
      e.velY = 0;
      e.nudge = { x: 0, y: 0 };
      e.blockedMs = 0;
      e.stuckMs = 0;
    }
  }

  // Elements tick before movement so a slow applies the same frame it lands.
  if (e.slowMs > 0) e.slowMs -= dtMs;
  // The bell's hurry, topped up while inside the patch (`stepAttacks`).
  if (e.hastedMs > 0) e.hastedMs -= dtMs;
  /*
   * Frozen: held in place, acting on nothing, until the ice gauge — now the
   * freeze's clock — runs out. Knockback still carries it, so a frozen body
   * can be batted about.
   */
  if (e.frozenMs > 0) {
    e.frozenMs -= dtMs;
    e.chillBuild = Math.max(0, e.frozenMs / ENEMY_FREEZE_MS);
    if (e.frozenMs <= 0) { e.chillBuild = 0; e.slowMs = 0; }
    e.velX = 0;
    e.velY = 0;
    if (e.knockX !== 0 || e.knockY !== 0) {
      moveSliding(world.room.grid, e, e.knockX * dt, e.knockY * dt, e.radius);
      e.knockX *= 0.82;
      e.knockY *= 0.82;
    }
    return;
  }
  if (e.buildFedMs <= 0 && e.chillBuild > 0) e.chillBuild = Math.max(0, e.chillBuild - 0.35 * dt);
  if (e.buildFedMs > 0) e.buildFedMs -= dtMs;
  if (e.burnMs > 0) {
    e.burnMs -= dtMs;
    // The cinderling eats fire: a burn heals it rather than hurting it.
    if (baseArchetype(e.archetype) === "cinderling") e.hp = Math.min(e.maxHp, e.hp + 2 * Math.max(1, e.burnSources) * dt);
    else e.dotShown += BURN_DPS * e.statusMult * Math.max(1, e.burnSources) * dt * resistOf(e.archetype, "fire");
    if (e.burnMs <= 0) e.burnSources = 0;
    e.burnBuild = Math.max(0, e.burnMs / 3000);
  } else if (e.buildFedMs <= 0) e.burnBuild = Math.max(0, e.burnBuild - 0.35 * dt);
  if (e.poisonMs > 0) {
    e.poisonMs -= dtMs;
    e.dotShown += POISON_DPS_PER_STACK * e.statusMult * e.poisonStacks * dt * resistOf(e.archetype, "poison");
    if (e.poisonMs <= 0) e.poisonStacks = 0;
    e.poisonBuild = Math.max(0, e.poisonMs / 4000);
  } else if (e.buildFedMs <= 0) e.poisonBuild = Math.max(0, e.poisonBuild - 0.35 * dt);

  /*
   * Status damage lands twice a second as one whole number — rounded down,
   * at least one — rather than as a sliver every frame: damage is always an
   * integer, and a tick is a thing the player can see and count.
   */
  e.dotShowMs -= dtMs;
  // Nothing done to the king through his roar counts, the burn on him included (`Enemy.bossRoarMs`).
  if (e.bossRoarMs > 0) e.dotShown = 0;
  if (e.dotShowMs <= 0) {
    e.dotShowMs = DOT_TICK_MS;
    /*
     * **A stream of small numbers, not one big one.** At two ticks a second
     * a burn read as two large hits with a gap, which looks like two more
     * spells rather than a status; at four it reads as the body burning.
     * Only whole numbers are shown, so a tick worth less than one carries
     * over to the next rather than rounding up — without that, a poison of
     * 0.7 a tick would pay 1 every time and land 20 damage instead of 14.
     */
    if (e.dotShown * world.dealtMult >= 1) {
      const tick = Math.max(1, Math.floor(e.dotShown * world.dealtMult));
      e.hp -= tick;
      world.stats.damageDealt += tick;
      world.events.push({ kind: "damage", x: e.x, y: e.y - e.radius, what: e.burnMs > 0 ? "dot:burn" : "dot:poison", amount: tick });
      e.dotShown = Math.max(0, e.dotShown - tick / Math.max(0.01, world.dealtMult));
    }
    /*
     * The status is over: pay what is left rather than dropping it. A tick
     * worth less than one carries over, so without this the tail of every
     * burn and poison — up to a point of damage — quietly vanished, and the
     * total never matched the figure the card printed.
     */
    if (e.burnMs <= 0 && e.poisonMs <= 0) {
      const rest = Math.round(e.dotShown * world.dealtMult);
      if (rest > 0) {
        e.hp -= rest;
        world.stats.damageDealt += rest;
        world.events.push({ kind: "damage", x: e.x, y: e.y - e.radius, what: "dot:burn", amount: rest });
      }
      e.dotShown = 0;
    }
  }
  if (e.hitFlashMs > 0) e.hitFlashMs -= dtMs;
  if (e.staggerImmuneMs > 0) e.staggerImmuneMs -= dtMs;
  // The roar and the call: he stands where he is (`stepBossPhase`); `stepBoss` runs their clocks.
  if (e.bossRoarMs > 0 || e.bossSummonMs > 0) {
    e.velX = 0;
    e.velY = 0;
    e.knockX = 0;
    e.knockY = 0;
    e.nudge.x = 0;
    e.nudge.y = 0;
    return;
  }
  /*
   * The threat clock. Anything the player can read as intent resets it: an
   * attack of any phase, a posed move, an aimed volley, a sidestep, and the
   * two waiting moves below. See `Enemy.threatMs`.
   */
  e.threatMs = e.attack !== "approach" || e.pose !== "" || e.plantMs > 0
    || e.telegraphMs > 0 || e.jukeMs > 0 ? 0 : e.threatMs + dtMs;
  if (e.postMs > 0) e.postMs -= dtMs;
  if (e.relocateMs > 0) e.relocateMs -= dtMs;
  if (e.poiseBreakMs > 0) e.poiseBreakMs -= dtMs;
  if (e.poiseGuardMs > 0) e.poiseGuardMs -= dtMs;
  // Poise fills again, slowly, once the body has gone a while unhit (`POISE_REGEN_DELAY_MS`).
  // The clock runs whole or not: a delver reads it too (`DIVE_AFTER_HIT_MS`).
  e.poiseIdleMs = Math.min(60_000, e.poiseIdleMs + dtMs);
  if (e.maxPoise > 0 && e.poise < e.maxPoise && e.poiseIdleMs >= POISE_REGEN_DELAY_MS)
    e.poise = Math.min(e.maxPoise, e.poise + e.maxPoise * POISE_REGEN_PER_S * (dtMs / 1000));
  /*
   * Braking: an ordinary heavy body skids; the Veteran plants much harder.
   * Its charge already launches at full speed, so a strong first-frame drag
   * gives the requested burst -> abrupt stop curve without adding an easing
   * buffer in front of the run. The remaining brake time is the punish pose,
   * not another half-tile of travel.
   */
  if (e.brakeMs > 0) {
    e.brakeMs -= dtMs;
    const drag = e.guardian && e.meleeKind === "charge" ? 0.72 : 0.94;
    e.velX *= drag;
    e.velY *= drag;
    if (e.brakeMs <= 0) {
      e.velX = 0;
      e.velY = 0;
    }
  }
  if (e.attackCooldownMs > 0) e.attackCooldownMs -= dtMs;

  /*
   * The glance. Sampled from its own perception, so what a body looks at is
   * the same stale position it aims and commits at — one lie rather than two.
   */
  e.gaitMs += dtMs;
  e.glanceMs -= dtMs;
  if (e.glanceMs <= 0) {
    e.glanceMs = GLANCE_MS;
    const seen = seenPlayer(world, e);
    e.lookX = seen.x;
    e.lookY = seen.y;
  }

  /*
   * The retreat budget, spent while giving ground and recovered while not.
   * Held here rather than in the steering so it advances once per step
   * whatever the behaviour decides to do with it.
   */
  if (e.windedMs > 0) {
    e.windedMs -= dtMs;
    if (e.windedMs <= 0) e.retreatMs = RETREAT_BUDGET_MS;
  } else if (givingGround(world, e)) {
    e.retreatMs -= dtMs;
    if (e.retreatMs <= 0) e.windedMs = WINDED_MS;
  } else {
    e.retreatMs = Math.min(RETREAT_BUDGET_MS, e.retreatMs + dtMs * 0.5);
  }

  /*
   * Staggered: the body does nothing at all this step.
   *
   * Placed before every other branch on purpose. A stagger that only stopped
   * the movement would leave the attack clock running, so a hit landed during
   * a windup would delay the lunge without cancelling it — which is worse than
   * no stagger, because the tell has already finished and the player has
   * stopped watching for it. The cancel happens in `stagger()`; this is only
   * the freeze.
   */
  if (e.staggerMs > 0) {
    e.staggerMs -= dtMs;
    e.velX *= 0.6;
    e.velY *= 0.6;
    // Knockback still applies, so a struck body is pushed while it reels.
    if (e.knockX !== 0 || e.knockY !== 0) {
      moveSliding(world.room.grid, e, e.knockX * dt, e.knockY * dt, e.radius);
      e.knockX *= 0.82;
      e.knockY *= 0.82;
      if (Math.abs(e.knockX) < 1) e.knockX = 0;
      if (Math.abs(e.knockY) < 1) e.knockY = 0;
    }
    return;
  }

  /*
   * Noticing. Planted, facing the player, for one readable beat before the
   * fight starts. See `ALERT_MS`.
   */
  // A body that is already in a posed move still has to advance that pose;
  // the Veteran's opening alert can overlap the first call's raised-gun frame.
  if (e.alertMs > 0 && e.pose === "") {
    e.alertMs -= dtMs;
    e.facing = turnToward(
      e.facing, Math.atan2(e.lookY - e.y, e.lookX - e.x), dtMs, turnScale(e),
    );
    e.velX = 0;
    e.velY = 0;
    return;
  }

  // A charging body carries its blade. Leaving the origin where the attack
  // started would leave the hitbox behind a thrust that travels three body
  // lengths, which is the same bug the player's crescent had.
  if (e.attack === "windup" || e.attack === "lunge") {
    e.swing.x = e.x;
    e.swing.y = e.y;
  }

  // Asleep: drift near home, do not fire, and check whether the player has
  // come close enough to notice. Everything below this is awake behaviour.
  if (!e.awake) {
    e.patternMs += dtMs;
    // A neighbour's alarm reaching it.
    if (e.wakeDelayMs > 0) {
      e.wakeDelayMs -= dtMs;
      if (e.wakeDelayMs <= 0) wake(world, e);
    }
    /*
     * **The stir**, before anything else decides. A sleeper the player has
     * come within `STIR_RANGE` of lifts its head, looks straight at them for
     * `STIR_MS`, and then either goes back down or comes up — which is the one
     * beat that makes creeping past a dormant body a thing the player is
     * doing rather than a dice roll they find out the result of.
     */
    if (!e.awake && e.idleRole === "sleeper") stir(world, e, dtMs);
    if (!e.awake && e.idleAction === "stir") {
      // Head up: it looks and does nothing else. `stir` wakes it or settles it.
      e.facing = turnToward(e.facing, Math.atan2(e.lookY - e.y, e.lookX - e.x), dtMs, turnScale(e));
      e.vx *= 0.7;
      e.vy *= 0.7;
      e.velX = 0;
      e.velY = 0;
      return;
    }
    // The Veteran room owns one synchronized noticing beat. During its live
    // first second the opening pack may patrol and idle, but ordinary aggro
    // must not wake it early — that produced a first exclamation, a short
    // chase, then a second scripted exclamation and an apparent position pop.
    const waitingForGuardianNotice = world.guardianRoom === true
      && world.enemies.some((o) => o.guardian && o.hp > 0 && o.pose === "guardian_intro" && !o.guardian.introNoticeSent);
    if (!e.awake && !waitingForGuardianNotice && noticesPlayer(world, e)) {
      wake(world, e);
    } else if (!e.awake) {
      /*
       * Not yet in the fight, but alive: it patrols near where it was placed.
       * See `wanderStep` for why this is a destination rather than a drift.
       */
      const walks = e.idleRole !== "sleeper" && patrols(e);
      const d = walks ? wanderStep(e, world, dt, dtMs) : { dx: 0, dy: 0 };
      /*
       * A body that holds its ground still looks around. Without it a
       * non-patrolling dormant enemy is frozen in one direction for the whole
       * time the player is picking their way past it, which is both dull and
       * misreads as a rendering fault.
       */
      /*
       * A sleeper **turns over**: every few seconds it swings its facing round
       * and shifts a few pixels, which is the least a dormant body can do and
       * still read as breathing. It is a different motion from the standing
       * bodies' looking about, which is why it is its own branch and its own
       * `idleAction`.
       */
      if (e.idleRole === "sleeper") {
        e.wanderPauseMs -= dtMs;
        if (e.wanderPauseMs <= 0) {
          e.wanderPauseMs = SLEEP_SHIFT_MS + world.rng.next() * SLEEP_SHIFT_SPREAD_MS;
          const a = e.facing + (world.rng.next() < 0.5 ? -1 : 1) * (0.6 + world.rng.next() * 1.6);
          e.lookX = e.x + Math.cos(a) * 40;
          e.lookY = e.y + Math.sin(a) * 40;
          e.idleAction = "shift";
          e.travelled += 2;
        }
        const want = Math.atan2(e.lookY - e.y, e.lookX - e.x);
        // Slow, and over about as long as the turn takes: a body rolling over.
        e.facing = turnToward(e.facing, want, dtMs, (turnScale(e) * 400) / SLEEP_SHIFT_TURN_MS);
        if (Math.abs(angleDeltaRad(e.facing, want)) < 0.06 && e.idleAction === "shift") e.idleAction = "still";
      }
      // A sleeper does not look about; everything else that stands does.
      if (!walks && e.idleRole !== "sleeper") {
        e.wanderPauseMs -= dtMs;
        if (e.wanderPauseMs <= 0) {
          e.wanderPauseMs = 1400 + world.rng.next() * 2200;
          /*
           * Now and then it looks at a neighbour instead of at nothing: the
           * cheapest "chatter" there is, and a group that glances at each
           * other reads as a group rather than as props placed near each other.
           */
          const mate = world.rng.next() < 0.35
            ? world.enemies.find((o) => o !== e && o.hp > 0 && !o.awake && dist2(o.x, o.y, e.x, e.y) < 110 * 110)
            : undefined;
          if (mate) {
            e.lookX = mate.x;
            e.lookY = mate.y;
          } else {
            const a = world.rng.next() * Math.PI * 2;
            e.lookX = e.x + Math.cos(a) * 40;
            e.lookY = e.y + Math.sin(a) * 40;
          }
        }
        e.facing = turnToward(
          e.facing, Math.atan2(e.lookY - e.y, e.lookX - e.x), dtMs, turnScale(e) * 0.5,
        );
      }
      if (d.dx !== 0 || d.dy !== 0) {
        moveSliding(world.room.grid, e, d.dx, d.dy, e.radius);
        e.facing = turnToward(e.facing, Math.atan2(d.dy, d.dx), dtMs);
        e.travelled += Math.hypot(d.dx, d.dy);
        // So the walk cycle plays: the measured velocity is what the renderer
        // reads, and it is only written on the combat path.
        e.vx = d.dx / dt;
        e.vy = d.dy / dt;
      } else {
        e.vx *= 0.7;
        e.vy *= 0.7;
      }
      e.velX = 0;
      e.velY = 0;
      return;
    }
  }

  /*
   * The expansion's own moves (`attacks.ts`): planting, ringing, diving,
   * throwing. A body under the floor does nothing else this step — it cannot
   * be steered, cannot swing and cannot shoot.
   */
  stepExpansion(world, e, dtMs, seenPlayer(world, e));
  if (submerged(e)) {
    e.gapPx = Math.hypot(world.player.x - e.x, world.player.y - e.y);
    return;
  }

  /*
   * **Losing the player.** A body that cannot see the player for a while
   * stops and looks round before it goes on, rather than tracking them
   * through stone with perfect knowledge (research: pursuit). The flow field
   * still takes it the right way afterwards — it heard which way you went —
   * so a pillar buys the player a beat, not an escape.
   */
  if (ENEMIES[e.archetype].behaviour !== "stationary" && e.archetype !== "boss" && e.attack === "approach") {
    const seen = seenPlayer(world, e);
    /*
     * **A body on screen does not stop to look for you.** The search is for a
     * body that has genuinely lost the player across a room; one standing
     * behind a pillar inside the view is close enough that the pause reads as
     * idling, and it is expensive — a body in the view rectangle with no line
     * to the player was 6.5% of all uncleared room time, the second largest
     * reason a room had nothing on screen.
     */
    if (pastView(world, e) <= 0) {
      e.lostMs = 0;
      e.searchMs = 0;
    } else if (hasLineOfSight(world.room.grid, e.x, e.y, seen.x, seen.y)) {
      e.lostMs = 0;
      e.searchMs = 0;
    } else {
      const before = e.lostMs;
      e.lostMs += dtMs;
      if (before < LOST_BEFORE_SEARCH_MS && e.lostMs >= LOST_BEFORE_SEARCH_MS) {
        e.searchMs = SEARCH_MS;
        const a = world.rng.next() * Math.PI * 2;
        e.lookX = e.x + Math.cos(a) * 40;
        e.lookY = e.y + Math.sin(a) * 40;
      }
    }
  }
  if (e.searchMs > 0) e.searchMs -= dtMs;

  advanceMelee(e, world, dtMs);
  if (e.plantMs > 0) e.plantMs -= dtMs;
  // Reacting to the player's own commitment; see `juke`.
  juke(world, e, dtMs);

  e.strafeMs -= dtMs;
  if (e.strafeMs <= 0) {
    e.strafe = e.strafe === 1 ? -1 : 1;
    e.strafeMs = 1400 + ((e.id * 173) % 1100);
  }

  const before = { x: e.x, y: e.y };
  // The king steps aside for no one: the crowd, and the player, give way to him.
  // A posed attack is planted in the literal sense too: crowd separation
  // must not slide a caller, stake drive or volley order across its own tell.
  const sep = e.archetype === "boss" || planted(e) ? { x: 0, y: 0 } : separation(world, e);
  const moved0 = moveFor(e, world, dt);
  /*
   * Steering names a target velocity; the body ramps toward it.
   *
   * It used to be applied whole on the frame it changed, so every body reached
   * full speed instantly and stopped instantly. That is what made them read as
   * sprites being slid rather than as things with mass, and it flattened the
   * roster too: a tank and a rusher differed only in how fast the slide was,
   * never in how long it took to get going or how far it carried.
   *
   * **`moveFor` returns a per-frame displacement, not a velocity** — it has
   * already multiplied by `dt` internally. Ramping in those units and then
   * scaling by `dt` again divides the whole thing by sixty, which is a body
   * that visibly does not move; so the conversion is written out rather than
   * assumed.
   */
  const desiredX = dt > 0 ? moved0.dx / dt : 0;
  const desiredY = dt > 0 ? moved0.dy / dt : 0;
  /*
   * A committed attack launches instantly; everything else ramps.
   *
   * The ramp was applying to the charge too, and the arithmetic was fatal to
   * it: a tank accelerates at 112 px/s² and its commit window is 620 ms, so it
   * reached barely a third of its charge speed and travelled about 20 px — a
   * ram that did not go anywhere. The anticipation for a charge lives entirely
   * in its half-second windup, which is exactly why the launch itself has to be
   * explosive: the player has already been told, and what they are dodging is
   * the suddenness.
   */
  // A sidestep is exempt for the same reason: a dodge that has to be ramped
  // into is a lean, and the hop is over in four frames.
  if (e.attack === "lunge" || e.jukeMs > 0) {
    e.velX = desiredX;
    e.velY = desiredY;
  } else {
    const dvx = desiredX - e.velX;
    const dvy = desiredY - e.velY;
    const dv = Math.hypot(dvx, dvy);
    // Heavy bodies take longer to get going and longer to stop, from the same
    // weight figure that drives their turn, lean and gait.
    const maxDv = ACCEL * Math.max(ACCEL_WEIGHT_FLOOR, turnScale(e)) * dt;
    if (dv > maxDv && dv > 0) {
      e.velX += (dvx / dv) * maxDv;
      e.velY += (dvy / dv) * maxDv;
    } else {
      e.velX = desiredX;
      e.velY = desiredY;
    }
  }
  // Separation steers a body out of a crowd; an emplacement is the crowd's
  // fixed point, and the other body does the stepping aside.
  const still = anchored(e);
  const dx = still ? 0 : e.velX * dt + sep.x * dt;
  const dy = still ? 0 : e.velY * dt + sep.y * dt;
  // Anything that aims faces the player; only pure bodies face their travel.
  // A shooter that faces the way it is strafing looks like it has lost
  // interest in you, which is the tell that gives an enemy away as a puppet.
  const def = ENEMIES[e.archetype];
  /*
   * Anything that means to hurt the player faces the player.
   *
   * This used to be true only for bodies that shoot or summon, on the
   * reasoning that a pure melee body should face its travel. It is the wrong
   * cut, and the tank showed why the moment it stopped shooting: its facing
   * came off its instantaneous velocity, which oscillates as it circles the
   * waiting ring and is shoved by other bodies, so the sprite mirrored left
   * and right several times a second.
   *
   * Facing the target is also just correct. A body with a blade is *engaging*
   * — where it looks is where it will commit — and a tank that turns to
   * follow whichever way it was last nudged is not reading its own intent.
   * Only a body with no way to hurt the player at all faces its travel.
   */
  /*
   * A committed attack does not turn its head.
   *
   * The direction was locked and the *facing* was not, so a charging tank
   * drifted its head toward the player as it went past — which reads as the
   * charge tracking, and undoes the whole reason the direction is locked in
   * the first place. Whatever it was looking at when it launched is what it
   * looks at until it recovers.
   */
  /*
   * A commitment holds one facing from the moment it locks until it has
   * finished recovering. The recovery used to be excluded, so a tank would
   * charge past the player and then swing its head round to them while it was
   * still sliding — which is the part that read as "it turns during the
   * charge", since the recoil is visually the tail of the same move.
   */
  const committed = e.attack === "lunge" || e.attack === "recover"
    || e.attack === "windup" && e.swing.trackingMs <= 0;
  const engaged = !committed && e.awake && (def.melee !== null || def.pattern !== null
    || def.ranged !== null || def.summon !== null);
  const aimAt = facingTarget(world, e);
  // A travel-facing body needs real motion before it turns, or a stationary
  // jitter spins it.
  const travelling = Math.hypot(dx, dy) > 0.05;
  const wanted = committed
    ? e.facing
    : engaged
      ? Math.atan2(aimAt.y - e.y, aimAt.x - e.x)
      : travelling ? Math.atan2(dy, dx) : e.facing;
  /*
   * Heavy bodies turn slowly.
   *
   * A ram that can reverse instantly is not a ram: measured, a tank charged
   * through the player, snapped round and charged back, several times a
   * second — which is what "the sprite keeps alternating left and right"
   * looked like from the outside. A slow turn is also what makes the charge
   * *steerable*, and therefore dodgeable: the player crosses its face, it
   * commits to where they were, and by the time it can face them again they
   * are behind it.
   */
  // A planted plate cannot turn: that is its cost, and walking round it is the answer.
  if (e.pose !== "plant") e.facing = turnToward(e.facing, wanted, dtMs, turnScale(e));

  if (dx !== 0 || dy !== 0) {
    const before = { x: e.x, y: e.y };
    const r = moveSliding(
      world.room.grid, e,
      dx + (e.nudge.x + e.knockX) * dt,
      dy + (e.nudge.y + e.knockY) * dt,
      e.radius,
    );
    const moved = dist2(before.x, before.y, e.x, e.y) > 0.01;
    // The dashcut's run, spent: it ends where the player stood (`Enemy.dashLeftPx`).
    if (e.attack === "lunge" && e.archetype === "boss" && e.meleeKind === "dashcut") {
      e.dashLeftPx -= Math.sqrt(dist2(before.x, before.y, e.x, e.y));
      if (e.dashLeftPx <= 0) e.attackMs = Math.min(e.attackMs, 0);
      // The wake, laid as he passes (phase III).
      bossDashWake(world, e, false);
    }
    /*
     * A charge that hits a wall knocks itself down.
     *
     * This is the player's only lever on an armoured body. A tank ignores hit
     * stun by design, so without this the player could choose *when* it
     * committed and never anything about how it ended — and an enemy whose
     * state the player cannot touch is an obstacle rather than an opponent.
     * With it, where the player stands while it winds up decides where it
     * finishes, so the arena becomes part of the fight and the recovery window
     * is something earned rather than granted.
     */
    if (e.attack === "lunge" && (r.blockedX || r.blockedY)) {
      const spec = meleeSpec(e);
      /*
       * Head-on knocks it down; a graze slides off.
       *
       * The blocked axis **is** the surface normal, so how square the impact
       * was falls out of the dot product between the charge and that axis.
       * Charging along a wall blocks one axis every frame, and without this
       * test a tank that set off parallel to the stonework knocked itself out
       * immediately — which is both wrong and the opposite of interesting,
       * since steering a charge *along* a wall is exactly the play a corridor
       * should reward.
       *
       * A corner blocks both axes and is head-on whatever the angle.
       */
      const square = wallSlamSquareness(r.blockedX, r.blockedY, e.lungeX, e.lungeY);
      if (spec?.stunsOnWall && square >= WALL_SLAM_COS) {
        e.staggerMs = WALL_SLAM_STUN_MS;
        e.stunMs = WALL_SLAM_STUN_MS;
        e.attack = "approach";
        e.attackMs = 0;
        e.swing.active = false;
        e.velX = 0;
        e.velY = 0;
        // The king stunned on a wall drops the string he was running (`BossPhase.strings`).
        e.bossString = [];
        e.bossStringAt0 = -1;
        dropToken(world, e);
        const guardianGap = e.guardian
          ? spec.kind === "charge" ? GUARDIAN_CHARGE_GAP_MULT : GUARDIAN_ATTACK_GAP_MULT
          : 1;
        e.attackCooldownMs = restAfter(world, e, spec.restMs * guardianGap);
        // A body that has knocked itself out does not come back with the
        // second half of a combination: the slam is the player's window.
        e.comboLeft = 0;
        impactShake(world, e);
        /*
         * **The Frontier Veteran knocked out on the wall** (doc 024): the stun
         * is the fight's opening, and it lands with a break's flash and sound.
         */
        if (e.guardian) {
          e.poiseBreakMs = POISE_BREAK_MS;
          world.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: `poise_break:${e.archetype}` });
          // And it wears its stance deep: the wall is the surest way to its knees (`wearStance`).
          wearStance(world, e, GUARDIAN_STANCE * GUARDIAN_WALL_STANCE);
        }
      }
    }
    // Still a last resort, for the case the field cannot help with: two
    // bodies pressing into the same gap.
    if (!moved || (r.blockedX && r.blockedY)) {
      e.blockedMs += dtMs;
      /*
       * Unwedging, sooner and with a direction.
       *
       * A body pressed into a corner has both axes blocked, so sliding cannot
       * help it and it sat there for a full second before trying anything —
       * long enough to look broken, which is how a retreating `keep_distance`
       * body ended up parked in a corner. A random perpendicular was also as
       * likely to be into the corner as out of it.
       *
       * So it waits a third as long and pushes toward whichever side actually
       * has floor on it.
       */
      if (e.blockedMs > BLOCKED_NUDGE_MS || e.stuckMs > BLOCKED_NUDGE_MS * 3) {
        const perp = { x: -dy, y: dx };
        const len = Math.hypot(perp.x, perp.y) || 1;
        const probe = (sign: number): boolean => !circleHitsWall(
          world.room.grid,
          e.x + (perp.x / len) * sign * e.radius * 2,
          e.y + (perp.y / len) * sign * e.radius * 2,
          e.radius,
        );
        const sign = probe(1) ? 1 : probe(-1) ? -1 : world.rng.next() < 0.5 ? -1 : 1;
        e.nudge = { x: (perp.x / len) * sign * 90, y: (perp.y / len) * sign * 90 };
        e.blockedMs = 0;
        e.stuckMs = 0;
        e.velX = 0;
        e.velY = 0;
      }
    } else {
      e.blockedMs = 0;
      e.nudge = { x: e.nudge.x * 0.9, y: e.nudge.y * 0.9 };
    }
  }

  // Measured rather than derived, so leading works for every behaviour and
  // keeps working when a body is shoved or blocked.
  e.vx = ((e.x - before.x) / dt) * 0.3 + e.vx * 0.7;
  e.vy = ((e.y - before.y) / dt) * 0.3 + e.vy * 0.7;
  e.travelled += Math.hypot(e.x - before.x, e.y - before.y);

  /*
   * Progress, or the lack of it. Measured against the player rather than
   * against the body's own displacement, because sliding along a wall is
   * displacement without progress — which is exactly the case `blockedMs`
   * could not see.
   */
  const gap = Math.hypot(world.player.x - e.x, world.player.y - e.y);
  /*
   * **Only a body that is trying to close counts as stuck.**
   *
   * "Not getting nearer the player" is evidence of a jam for a chaser and
   * meaningless for anything else: an orbiter holds a radius and a
   * `keep_distance` body holds a range, so neither ever closes, so both
   * banked `stuckMs` forever and were permanently `jammed`. And a jammed
   * body abandons its behaviour and walks **straight at the player** — so
   * the orbiter stopped orbiting, parked inside the point-blank silence
   * radius, and hovered there doing nothing. That is the second half of the
   * two flying bodies that never attacked.
   *
   * `blockedMs` still watches every body, because "pressed against something"
   * is evidence for any of them.
   */
  if (ENEMIES[e.archetype].behaviour !== "chase") {
    e.lastGap = gap;
    e.stuckMs = 0;
  } else if (gap < e.lastGap - STUCK_PROGRESS_PX) {
    e.lastGap = gap;
    e.stuckMs = 0;
  } else {
    e.stuckMs += dtMs;
    // Re-baselined on the way out, so drifting further off does not bank
    // credit toward being called stuck again immediately.
    if (gap > e.lastGap) e.lastGap = gap;
  }

  // Knockback decays fast: it is a punctuation mark, not a physics system.
  e.knockX *= 0.82;
  e.knockY *= 0.82;
  if (Math.abs(e.knockX) < 1) e.knockX = 0;
  if (Math.abs(e.knockY) < 1) e.knockY = 0;

  /*
   * **Closing counts.** A body walking at the player is making its intent
   * plain, whether or not it holds a turn, so the threat clock resets while
   * the gap is shrinking. What the clock is for is the body that is neither
   * attacking, nor arriving, nor repositioning.
   */
  if (gap < e.gapPx - CLOSING_PX) e.threatMs = 0;
  e.gapPx = gap;
  stepBossPhase(world, e);
  fire(world, e, dtMs);
  {
    // "On top of it or behind it": inside a body's length, or outside the
    // cleave's front half-arc.
    const dx = world.player.x - e.x;
    const dy = world.player.y - e.y;
    const d = Math.hypot(dx, dy);
    const off = Math.abs(angleDeltaRad(e.facing, Math.atan2(dy, dx)));
    e.closeIn = d < e.radius + 22 || (d < 70 && off > Math.PI * 0.6);
  }
  blink(world, e, dtMs);
  if (e.pulseCooldownMs > 0) e.pulseCooldownMs -= dtMs;
  if (e.spikeMs > 0) {
    e.spikeMs -= dtMs;
    // From the tips, beyond the drive's own reach: inside it the spikes have
    // already had their say.
    if (e.spikeMs <= 0 && e.hp > 0) spikeVolley(world, e, SPIKE_FLY_SPEED, SPIKE_SIZE, e.swing.reach + 4);
  }
  summon(world, e, dtMs);
}

/**
 * How close the player has to be to silence a ranged body, in px.
 *
 * **Closing the distance has to be worth something.** A shooter that keeps
 * firing while the player stands next to it hitting it is the least
 * satisfying exchange in the game: the player has done the hard part — crossed
 * the floor, read the pattern, arrived — and is rewarded with the same damage
 * they were taking on the way in. So arriving is the answer, and inside this
 * radius the body stops shooting and backs off instead.
 *
 * It is also how the genre has always done it. Doom's imps do not throw
 * fireballs in your face, and an Octorok is killed by walking up to it. A
 * ranged enemy's weakness is supposed to be range.
 *
 * Set just outside the player's own arc, so the silence begins slightly before
 * the sword lands rather than after: the player should see it flinch as they
 * commit, not after they have already hit it.
 */
const PANIC_RADIUS = 78;

/**
 * How long a body stands over its own shot once the volley has left, on top
 * of the aim it was already planted for.
 *
 * This is where "arriving at an archer is rewarded" lives now. A shooter that
 * has just fired is a shooter standing still with no answer for a third of a
 * second, so the player who read the aim and closed during it gets a free
 * swing — and the shooter that kept its distance instead never owes one.
 */
const SHOT_RECOVER_MS = 320;

/**
 * How long a body stands over a non-projectile cast — a strike, a gout of
 * flame, a seed, a ward. Shorter than an aimed volley's plant, because most
 * of these carry a telegraph of their own on the floor afterwards.
 */
const RANGED_PLANT_MS = 420;

/**
 * How far a body is past the edge of what the player can see, px: 0 while any
 * of it is in view. The camera follows the player and the room is larger than
 * the view (doc 008). Measured to the nearer edge on each axis, so the view's
 * shape and size — which change with the window and the zoom — and the room's
 * do not change what it means.
 */
/**
 * How far the body is from the nearest edge of what the player can see, in px:
 * positive inside, negative once it has left. The companion to `pastView`,
 * which only measures the outside and reports 0 for everything within.
 */
export function viewMargin(world: World, e: Enemy): number {
  const p = world.viewCentre ?? world.player;
  return Math.min(
    world.viewHalf.x - Math.abs(e.x - p.x) - e.radius,
    world.viewHalf.y - Math.abs(e.y - p.y) - e.radius,
  );
}

export function pastView(world: World, e: Enemy): number {
  const p = world.viewCentre ?? world.player;
  const ox = Math.max(0, Math.abs(e.x - p.x) - e.radius - world.viewHalf.x);
  const oy = Math.max(0, Math.abs(e.y - p.y) - e.radius - world.viewHalf.y);
  return Math.hypot(ox, oy);
}

/**
 * How much of its fire a body keeps: none unless **the whole body is on the
 * screen**, rising to all of it `FIRE_FADE_PX` inside the edge. A body off
 * the screen shows no telegraph, so a shot from it is a hit with no answer
 * ("an arrow from the dark"); it used to keep firing two tiles past the edge.
 * The fade inside keeps the edge from being a line where fire switches on at
 * full rate, so a body stepping into view winds up before it shoots.
 */
export function firePresence(world: World, e: Enemy): number {
  return Math.max(0, Math.min(1, viewMargin(world, e) / FIRE_FADE_PX));
}
const FIRE_FADE_PX = TILE_PX;
/**
 * How fast a body closes: full in view and near it, easing to `OFF_VIEW_SPEED`
 * `CLOSE_FADE_PX` out — so bodies still come to the fight, but none is on the
 * player out of nowhere at a sprint.
 */
function closePresence(world: World, e: Enemy): number {
  return OFF_VIEW_SPEED + (1 - OFF_VIEW_SPEED) * Math.max(0, 1 - pastView(world, e) / CLOSE_FADE_PX);
}
const CLOSE_FADE_PX = TILE_PX * 5;
const OFF_VIEW_SPEED = 0.6;

export function fire(world: World, e: Enemy, dtMs: number): void {
  const def = ENEMIES[e.archetype];
  if (!def.pattern && !def.ranged) return;
  if (e.attackLockMs > 0) return;
  // The Veteran's entrance hands the player a clean three-second turn. Its
  // ranged clock must pause too; `attackCooldownMs` alone gates only melee.
  if (e.guardian && e.guardian.introGraceMs > 0) return;
  if (e.guardian && (e.guardian.actionGapMs > 0 || e.guardian.wasAttacking)) return;
  // The guardian layer runs after the shared enemy layer. Leave a due call,
  // stake drive or volley a clean frame to take the body before its ordinary
  // warden gun can plant it instead.
  if (e.guardian && !e.guardian.chainNext
    && (e.guardian.callMs <= 0 || e.guardian.stakesMs <= 0 || e.guardian.volleyMs <= 0)) return;
  /*
   * **One question at a time** (doc 020). The king fires only when a volley
   * is the turn he chose (`chooseBossAct`), standing: never under a blade or a
   * move, and never in the rest after one, which is the player's.
   */
  if (e.archetype === "boss" && (e.bossVolleyMs <= 0 || e.bossCast !== "none" || e.attack !== "approach")) {
    if (e.telegraphMs > 0 || e.pending.length > 0) { e.pending = []; e.telegraphMs = 0; e.plantMs = 0; dropFireToken(world, e); }
    return;
  }
  // Well past the view it holds its fire and drops what it was aiming; nearer
  // the edge, its clock runs slower in proportion (`firePresence`).
  /*
   * **A destroy room's targets fire across the whole room** (doc 025): off
   * the screen as well as on it. What they throw is read where it lands — a
   * strike's mark at the player's feet, a lane, a line drawn to them — so
   * none of it arrives from the dark, and the room is a clock the player
   * cannot hide from.
   */
  // The guardian remains the source of pressure across its arena. Its attacks
  // are telegraphed at the player, so it does not inherit an ordinary mob's
  // off-screen silence merely because the camera followed the player away.
  const presence = e.objectiveTarget || e.guardian ? 1 : firePresence(world, e);
  if (presence <= 0) {
    if (e.telegraphMs > 0 || e.pending.length > 0) { e.pending = []; e.telegraphMs = 0; e.plantMs = 0; dropFireToken(world, e); }
    return;
  }
  /*
   * Nothing shoots in the room's first moment. Walking in, the whole room saw
   * the player at once — a single screen, and every aggro range covers most
   * of it — so the first thing a room did was every ranged body firing
   * together, and hearts went before the player had read the room.
   */
  if (world.stats.elapsedMs < ENTRY_GRACE_MS) return;
  /*
   * **It has to see you to aim at you.** Every aimed attack — a volley, a
   * musket, a hook, a crack, a strike, a lob — needs a clear line to the
   * player, and one being wound up is dropped when the line breaks, so a
   * pillar is a blind spot and stepping behind it is an answer. Only what
   * does not aim at the player works blind: seeds planted underfoot, a ward
   * on an ally.
   */
  const aims = !!def.pattern || (!!def.ranged && def.ranged.kind !== "mine" && def.ranged.kind !== "ward");
  if (aims && !hasLineOfSight(world.room.grid, e.x, e.y, world.player.x, world.player.y)) {
    // The plant goes with the volley: a body planted for a shot it has just
    // dropped is a body standing still for no reason the player can see.
    if (e.telegraphMs > 0 || e.pending.length > 0) { e.pending = []; e.telegraphMs = 0; e.plantMs = 0; }
    dropFireToken(world, e);
    return;
  }
  // A ranged cast's turn runs out with its wind-up.
  if (e.fireTokenMs > 0) {
    e.fireTokenMs -= dtMs;
    if (e.fireTokenMs <= 0) dropFireToken(world, e);
  }
  // Not into a player at sword range: an aimed volley from arm's length cannot be read, only eaten.
  if (e.archetype === "boss" && e.gapPx < BOSS_PATTERN_MIN_GAP) return;

  /*
   * Silenced at close range, and the pattern clock stops with it — so backing
   * off does not release a volley that was charging while the player was on
   * top of it. The exception is a body with a blade, which is supposed to be
   * dangerous up close; nothing in the roster has both.
   */
  /*
   * A ranged body either moves or shoots, never both — and it is the body
   * that chooses, by **planting**.
   *
   * The design writing on this is unanimous: **an archer must not have a
   * completely safe firing position.** A shooter that backpedals while firing
   * has one, because its own retreat is free.
   *
   * The first version of the rule said a body inside `REPOSITION_RADIUS` may
   * shoot only while standing still, and dropped the volley otherwise. Every
   * ranged archetype in the roster strafes, orbits or gives ground, so what
   * it actually said was that a body near the player never fires at all:
   * measured in a mixed room over thirty seconds, an orbiter got two volleys
   * away, a summoner one gout of flame and a shooter eight shots, against
   * cadences that should have given twelve, four and about twenty.
   *
   * So the body stops instead. When its turn comes it plants for the aim, the
   * shot and a beat afterwards (`SHOT_RECOVER_MS`) and does not move for any
   * of it — the same trade, taken as an action the player can see and punish
   * rather than as a shot that silently never happens. Inside `PANIC_RADIUS`
   * it is still silent altogether and gives ground instead, which is the
   * reward for arriving.
   *
   * Anything with a blade is exempt; nothing in the roster has both.
   */
  // The warden's gun is a close weapon — a flame, not a shot — so the rule
  // that a shooter does not fire at a player on top of it does not apply.
  // Nor to the cinderling: it chases, and its coal is its only attack, so
  // silenced up close it walked onto a player who stood still and did nothing
  // at all. A coal at the feet is telegraphed and lights the floor it and the
  // player share, which is the pressure it is for.
  /*
   * ...and only what **aims at the player**. The silence is the reward for
   * closing on an archer; a body that plants seeds under its own feet or
   * arms an ally is not shooting at anybody, so falling silent only made it
   * a body that stands there doing nothing once the player arrives — which is
   * exactly what the sower was reported as. Same test the sight-line gate
   * above uses, for the same reason.
   */
  if (def.melee === null && aims && e.archetype !== "warden" && e.archetype !== "cinderling") {
    const seen = world.player;
    const gap2 = dist2(e.x, e.y, seen.x, seen.y);
    if (gap2 <= PANIC_RADIUS * PANIC_RADIUS) {
      // An emplacement cannot choose to move, so the move-or-shoot rule has
      // nothing to bite on and silence would make it a free kill: it pulses.
      if (def.behaviour === "stationary") { pulse(world, e, dtMs); return; }
      // Whatever it had charged is dropped, so backing off does not release a
      // volley that was aimed while the player was on top of it.
      e.pending = [];
      e.telegraphMs = 0;
      e.plantMs = 0;
      dropFireToken(world, e);
      return;
    }
  }

  /*
   * Winding up. When it expires, whatever was held fires.
   *
   * The aim is taken here rather than when the volley was scheduled, so a
   * player who moved during the wind-up is shot at where the body last saw
   * them — which is the whole reason the wind-up is dodgeable.
   */
  if (e.telegraphMs > 0) {
    e.telegraphMs -= dtMs;
    if (e.telegraphMs > 0) return;
    world.events.push({ kind: "telegraph", x: e.x, y: e.y, what: e.archetype });
    if (e.pending.length > 0) {
      // Sight Beam: the elite sentinel's line is the shot, with no travel time.
      if (e.archetype === "watcher") sightBeam(world, e, seenPlayer(world, e));
      else release(world, e, e.pending as readonly BulletEmission[], 0, volleyFrom(world, e));
      e.pending = [];
    }
    dropFireToken(world, e);
    return;
  }

  const stats = affixStats(e.affixes);
  const scaled = (dtMs / stats.rest_mult) * presence * turnRate(world, e);

  /*
   * The two non-projectile kinds run off the same clock the patterns do, so
   * an archetype's cadence means one thing whatever it is throwing, and elite
   * affixes that speed up a volley speed these up identically.
   */
  if (def.ranged) {
    // The Frontier Veteran fires less often than a warden: its ram is the other half of its turns (doc 024).
    const period = def.ranged.interval_s * 1000 * (e.guardian ? GUARDIAN_SHOT_EVERY : 1);
    const before = e.patternMs;
    e.patternMs += scaled;
    if (Math.floor(before / period) === Math.floor(e.patternMs / period)) return;
    /*
     * A turn to cast, from the same budget the volleys draw on, and refused
     * the same way: the beat is missed, not queued. A strike, a flame, a
     * musket and a rift were outside the cap, so a room of them was every
     * body attacking at once however many turns the room allowed.
     */
    if (!takeFireToken(world, e)) return;
    e.fireTokenMs = RANGED_TURN_MS;
    /*
     * Planted for its cast, as a volley is for its aim. Several of these
     * already hold the body through a pose (the musket, the hook, a rift);
     * the rest — the strike, the flame, a seed, a ward — had nothing keeping
     * a moving body still, which under the old rule meant they were the casts
     * most often thrown away.
     */
    e.plantMs = Math.max(e.plantMs, RANGED_PLANT_MS);
    e.velX = 0;
    e.velY = 0;
    if (def.ranged.kind === "lightning") {
      /*
       * The beacon's strike is the turret's, and the ground it hits keeps
       * burning (`castStrike`). Doc 005 gave the elite turret a rift lance
       * instead; that was the rifter's attack on the turret's body, and a
       * variant that answers like another archetype teaches the player
       * nothing, so it is gone (doc 019).
       */
      castStrike(world, e);
    } else if (def.ranged.kind === "flame") throwFlame(world, e);
    else castRanged(world, e, def.ranged.kind, seenPlayer(world, e));
    return;
  }

  // The boss reads its phase's pattern, at its phase's pace.
  const phase = e.archetype === "boss" ? bossPhase(e) : null;
  // Its phase's pace, and the enrage on top: a long fight is a faster one.
  const paced = phase ? scaled * phase.rate : scaled;
  const emissions = expandPattern(phase ? phase.pattern : def.pattern!, e.patternMs, paced);
  e.patternMs += paced;
  if (emissions.length === 0) return;

  /*
   * Decided, not yet fired. The volley is held for an aiming window so the
   * player sees the shot coming; see `Enemy.telegraphMs`.
   */
  /*
   * A turn to shoot, claimed from the room's budget.
   *
   * Refused rather than queued: the volley is dropped and the pattern clock
   * carries on, so a body that could not get a turn simply misses that beat
   * instead of firing late. Queueing would defeat the cap — every shot would
   * still arrive, only bunched.
   */
  if (!takeFireToken(world, e)) return;
  e.pending = emissions;
  // The archetype's own aim: a skittish shooter snaps, an emplacement takes
  // its time. Jittered, so a body firing twice does not fire to a click.
  e.telegraphMs = Math.max(AIM_FLOOR_MS, jittered(world, AIM_MS * tempoOf(e).aim));
  // And it plants for the whole of it. See `Enemy.plantMs`. The velocity goes
  // with it, as a windup's does: left on the ramp the body coasts a third of a
  // tile into its own shot, which is neither planted nor moving.
  e.plantMs = e.telegraphMs + SHOT_RECOVER_MS;
  e.velX = 0;
  e.velY = 0;
  return;
}

/**
 * The emplacement's second move: a slow ring at point blank.
 *
 * Ranged bodies fall silent inside `PANIC_RADIUS`, which is the reward for
 * closing on one — but a turret or a sentinel cannot be closed on in that
 * sense, because it never had the option of backing off. A player standing
 * on one and cutting it down for free was the report ("this turret does
 * nothing"). So inside the radius an emplacement **pulses**: a wide-spaced,
 * slow ring every few seconds, telegraphed, that asks the player to step
 * through a gap rather than to leave. It is the one attack in the roster
 * aimed at nobody.
 */
const PULSE_COOLDOWN_MS = 3200;
const PULSE_AIM_MS = 520;
const PULSE_COUNT = 8;
const PULSE_SPEED = 110;

function pulse(world: World, e: Enemy, dtMs: number): void {
  if (e.telegraphMs > 0) {
    e.telegraphMs -= dtMs;
    if (e.telegraphMs > 0) return;
    world.events.push({ kind: "telegraph", x: e.x, y: e.y, what: e.archetype });
    if (e.pending.length > 0) release(world, e, e.pending as readonly BulletEmission[], 0, volleyFrom(world, e));
    e.pending = [];
    dropFireToken(world, e);
    e.pulseCooldownMs = PULSE_COOLDOWN_MS;
    return;
  }
  if (e.pulseCooldownMs > 0) return;
  if (!takeFireToken(world, e)) return;
  const ring: BulletEmission[] = [];
  for (let i = 0; i < PULSE_COUNT; i++)
    ring.push({
      size: 1.1, at_ms: 0, aim: "fixed:0", angle_deg: (360 / PULSE_COUNT) * i,
      speed: PULSE_SPEED, from: "ring", path: [0, i],
    });
  e.pending = ring;
  e.telegraphMs = PULSE_AIM_MS;
}

/** How long after a room starts before anything in it may shoot. */
export const ENTRY_GRACE_MS = 1200;

/**
 * How long a ranged cast holds its firing turn: about the longest of their
 * wind-ups (the musket's 950 ms, the rift's growth, the strike's marker).
 */
const RANGED_TURN_MS = 950;

/**
 * Claims one of the room's firing turns. Held from the moment a volley is
 * decided until it has been released, so the cap covers the wind-up as well as
 * the shot — the wind-up is when the player is being asked to move.
 */
function takeFireToken(world: World, e: Enemy): boolean {
  // Boss fire runs on its own cadence; the summoned squad cannot spend that turn.
  if (e.guardian) {
    e.guardian.wasAttacking = true;
    return true;
  }
  if (e.archetype === "boss") return true;
  if (e.hasFireToken) return true;
  // A destroy room's targets fire on their own clocks, outside the room's budget (doc 025).
  if (world.fireTokens <= 0 && !e.objectiveTarget) return false;
  if (liveCount(world.enemyBullets) >= world.flightBudget) return false;
  if (!e.objectiveTarget) world.fireTokens--;
  e.hasFireToken = true;
  return true;
}

export function dropFireToken(world: World, e: Enemy): void {
  e.fireTokenMs = 0;
  if (!e.hasFireToken) return;
  e.hasFireToken = false;
  if (!e.objectiveTarget) world.fireTokens++;
}

/**
 * How long a ranged body aims before it shoots, in ms.
 *
 * Above the 250 ms reaction floor the design's other telegraphs are sized
 * against, because this one has to be *noticed* while the player is busy
 * closing on something else. Below the travel time of the bullets it precedes,
 * so the wind-up plus the flight is comfortably more than one reaction and the
 * shot is answerable twice: once by moving when it aims and once by moving
 * while the bullet crosses.
 */
export const AIM_MS = 320;
/**
 * The shortest aim any tempo may produce, above the 250 ms reaction floor.
 * The quickest shooter in the roster is meant to feel urgent, not unfair.
 */
export const AIM_FLOOR_MS = 260;

/** Fires a held volley, aimed at where the body last saw the player. */
/** How fast a lancer's spikes travel once they leave it, and how long they hang first. */
const SPIKE_FLY_SPEED = 140;
export const SPIKE_HANG_MS = 280;
const SPIKE_COUNT = 8;
/**
 * How big a flying spike is, as a multiple of the bullet radius.
 *
 * Raised with the drawing: the spikes were a thin stroke and are a heavy
 * spine now, and **what the player sees is what hits** — a spike drawn twice
 * as thick with the old hitbox is the same lie as the reverse.
 */
export const SPIKE_SIZE = 1.1;

/**
 * Eight spikes at the compass points, as bullets. Shared by the lancer's
 * attack and its elite's death, so the two read as the same thing at two
 * moments. Fixed angles, so the gaps are always where they were.
 */
export function spikeVolley(world: World, e: Enemy, speed: number, size: number, fromRadius = 0): void {
  const ring: BulletEmission[] = [];
  for (let i = 0; i < SPIKE_COUNT; i++)
    ring.push({
      size, at_ms: 0, aim: "fixed:0", angle_deg: (360 / SPIKE_COUNT) * i,
      speed, from: "ring", path: [0, i],
    });
  release(world, e, ring, fromRadius);
}

/** How hard the wisp's shot curls, and for how long (doc 019). */
export const WISP_SEEK_DEG_PER_S = 150;
export const WISP_SEEK_MS = 500;

export function release(
  world: World, e: Enemy, emissions: readonly BulletEmission[], fromRadius = 0,
  from: { x: number; y: number } = { x: e.x, y: e.y },
): void {
  if (liveCount(world.enemyBullets) + emissions.length > ENEMY_BULLET_CAP) return;

  // Aimed where it last saw them, so strafing works at all, and off by the
  // ramp's miss — one draw for the whole volley, so a fan keeps its gaps.
  const aimed = seenPlayer(world, e);
  const ramp = rampFor(world.roomIndex);
  const miss = emissions.some((em) => em.aim === "player")
    ? ((world.rng.next() * 2 - 1) * ramp.aimSpreadDeg * Math.PI) / 180
    : 0;
  for (const em of emissions) {
    const aim = em.aim === "player"
      ? Math.atan2(aimed.y - from.y, aimed.x - from.x) + miss
      : (Number(String(em.aim).slice(6)) * Math.PI) / 180;
    const angle = aim + (em.angle_deg * Math.PI) / 180;
    const b = acquire(world.enemyBullets, false);
    if (!b) return;
    // `fromRadius` starts a shot away from the centre: the lancer's spikes
    // break off at their tips, not out of its middle.
    b.x = from.x + Math.cos(angle) * fromRadius;
    b.y = from.y + Math.sin(angle) * fromRadius;
    b.vx = Math.cos(angle) * em.speed * ramp.shotSpeed;
    b.vy = Math.sin(angle) * em.speed * ramp.shotSpeed;
    // The king's are fireballs out of his palm, not a roster body's shot (`BOSS_SHOT_SCALE`).
    b.radius = ENEMY_BULLET_RADIUS * em.size * (e.archetype === "boss" ? BOSS_SHOT_SCALE : 1);
    b.damage = (e.archetype === "boss" ? BOSS_BULLET_DAMAGE : ENEMY_BULLET_DAMAGE) * e.damageMult;
    b.element = e.affixes.includes("burning") ? "fire" : "none";
    b.elementPower = 1;
    b.from = e.archetype;
    /*
     * The wisp's shot **curls** (doc 019): it steers toward the player for the
     * first half second of flight and then flies straight.
     *
     * The orbiter's answer is to step off the line; the wisp's is to break the
     * line **late**, because a step taken early is a step the bullet follows.
     * `seekMs` is what makes it a question rather than a homing missile — the
     * curl is over long before the shot arrives, so it is dodged by timing and
     * never by outrunning.
     */
    if (e.archetype === "wisp") {
      b.seekDegPerS = WISP_SEEK_DEG_PER_S;
      b.seekMs = WISP_SEEK_MS;
    }
  }
  // Which way the volley left, for the muzzle flash: along its first shot.
  const first = emissions[0];
  const facing = first
    ? (first.aim === "player" ? Math.atan2(aimed.y - from.y, aimed.x - from.x) : (Number(String(first.aim).slice(6)) * Math.PI) / 180) + (first.angle_deg * Math.PI) / 180
    : e.facing;
  world.events.push({ kind: "shot", x: from.x, y: from.y, what: e.archetype, facing, amount: emissions.length });
}

/**
 * Marks the ground under the player, to be struck when the marker runs out.
 *
 * At the player's position **now**, and fixed there: the marker is the whole
 * telegraph, so tracking it would make the attack undodgeable and pointless.
 * What the player is being asked is to stop standing where they are standing,
 * and that question only exists if the answer works.
 *
 * One marker per body, so a turret cannot stack a field of them. `Strike` is a
 * single object on the enemy rather than a pool for that reason.
 */
function castStrike(world: World, e: Enemy): void {
  if (strikeMarked(e.strike) || e.strike.flashMs > 0) return;
  // Marked where it last saw them, which is what gives moving a point —
  // and every other strike, marked **ahead** of them along the way they are
  // moving, which is what gives stopping a point. One rule the player
  // learns, then its inversion; the alternation is the turret's second move.
  const seen = seenPlayer(world, e);
  e.strikesCast++;
  const lead = e.strikesCast % 2 === 0 ? 2.5 : 0;
  const now = world.player;
  const p = {
    x: Math.max(TILE_PX, Math.min((GRID_W - 1) * TILE_PX, seen.x + (now.x - seen.x) * lead)),
    y: Math.max(TILE_PX, Math.min((GRID_H - 1) * TILE_PX, seen.y + (now.y - seen.y) * lead)),
  };
  markStrike(e.strike, p.x, p.y);
  world.events.push({ kind: "telegraph", x: p.x, y: p.y, what: `strike:${e.archetype}` });
}

/**
 * Lobs a slow projectile that lights the ground where it stops.
 *
 * Slow on purpose — it is walked around, not dodged, and a fast one would be a
 * bullet with extra steps. The travel is an ordinary bullet and only the
 * ending differs, which is why `Bullet.leavesFire` is a flag rather than a
 * second projectile system.
 */
function throwFlame(world: World, e: Enemy): void {
  const p = seenPlayer(world, e);
  const b = acquire(world.enemyBullets, false);
  if (!b) return;
  const a = Math.atan2(p.y - e.y, p.x - e.x);
  b.x = e.x;
  b.y = e.y;
  b.vx = Math.cos(a) * FLAME_THROW_SPEED;
  b.vy = Math.sin(a) * FLAME_THROW_SPEED;
  b.radius = ENEMY_BULLET_RADIUS * 1.4;
  b.damage = (e.archetype === "boss" ? BOSS_BULLET_DAMAGE : ENEMY_BULLET_DAMAGE) * e.damageMult;
  b.element = "fire";
  b.elementPower = 1;
  b.from = e.archetype;
  b.leavesFire = true;
  // Short: it is meant to land on the floor between the two of them, not to
  // cross the room. Reaching the far wall would make it a projectile again.
  b.lifeMs = FLAME_THROW_LIFETIME_MS;
  world.events.push({ kind: "shot", x: e.x, y: e.y, what: `flame:${e.archetype}` });
}

/** Slow enough to walk around, which is the whole difference from a bullet. */
const FLAME_THROW_SPEED = 150;
const FLAME_THROW_LIFETIME_MS = 1400;

/**
 * Feeds minions into the room, up to a cap on how many are **alive**.
 *
 * The cap used to count how many this body had ever produced, which is a
 * different rule with two opposite failures: a summoner whose minions were all
 * killed could never make another and became harmless, while two summoners
 * each had their own budget so a room could hold eight. `max_alive` says
 * alive, and its own declaration says the figure is shared across every
 * summoner in the encounter — so it is counted over the room, and killing a
 * minion is what buys the next one.
 *
 * The spawn is placed on floor that is actually free, for the same reason wave
 * spawns are: a minion dropped inside a wall or inside a crate never wakes,
 * cannot be reached and cannot be hit, so the room can never be cleared.
 */
/**
 * Hatches a brooder's coal where it landed (doc 019), under the same caps a
 * summon obeys: the pool, the concurrency cap and a free spot on the floor.
 * Exported for `world.ts`'s attack hooks, because `attacks.ts` sees the lob
 * land and the world is what may create a body.
 */
export function hatchMinion(world: World, x: number, y: number, from: EnemyId): boolean {
  const def = ENEMIES[from];
  const rule = def.summon;
  if (!rule) return false;
  const alive = world.enemies.filter(
    (o) => o.archetype === rule.archetype && o.hp > 0 && ENEMIES[o.archetype].summon === null,
  ).length;
  if (alive >= rule.max_alive) return false;
  if (world.enemies.filter(isActive).length >= MAX_CONCURRENT_ENEMIES) return false;
  const at = freeSpotNear(world, x, y, 10 + world.rng.next() * 14, world.rng.next() * Math.PI * 2);
  if (!at) return false;
  const born = makeEnemy(world.nextEnemyId++, rule.archetype, at.x, at.y, [], rampFor(world.roomIndex));
  // It arrives awake: the coal was thrown at the player, and a body that has
  // to be noticed first would land beside them and stand there.
  born.awake = true;
  // A hatchling pays no experience: the coals never stop coming (`run/levels.ts`).
  born.summoned = true;
  world.enemies.push(born);
  return true;
}

function summon(world: World, e: Enemy, dtMs: number): void {
  const def = ENEMIES[e.archetype];
  if (!def.summon) return;
  if (e.attackLockMs > 0) return;
  e.summonMs -= dtMs;
  if (e.summonMs > 0) return;
  e.summonMs = SUMMONER_INTERVAL_MS;

  const rule = def.summon;
  const alive = world.enemies.filter(
    (o) => o.archetype === rule.archetype && o.hp > 0 && ENEMIES[o.archetype].summon === null,
  ).length;
  if (alive >= rule.max_alive) return;
  if (world.enemies.filter(isActive).length >= MAX_CONCURRENT_ENEMIES) return;

  const at = freeSpotNear(world, e.x, e.y, 40 + world.rng.next() * 18, world.rng.next() * Math.PI * 2);
  if (!at) return;
  e.minions++;
  const minion = makeEnemy(world.nextEnemyId++, rule.archetype, at.x, at.y, e.affixes, rampFor(world.roomIndex));
  /*
   * A minion pays no experience. The tap is infinite — one every six seconds
   * for as long as the summoner lives — so a run that was paid for them could
   * stand beside one and level for as long as it liked (`run/levels.ts`). The
   * summoner itself is the most valuable body in the roster, which is where
   * that fight's experience is.
   */
  minion.summoned = true;
  world.enemies.push(minion);
}

/**
 * A point on clear floor near `x, y`, tried around a ring from `from`.
 *
 * Returns null rather than guessing when the body is boxed in — a summoner
 * backed into a corner simply does not get to summon that beat, which reads
 * better than a minion appearing inside the wall behind it.
 */
function freeSpotNear(
  world: World, x: number, y: number, radius: number, from: number,
): { x: number; y: number } | null {
  for (let i = 0; i < 8; i++) {
    const a = from + (i / 8) * Math.PI * 2;
    const px = x + Math.cos(a) * radius;
    const py = y + Math.sin(a) * radius;
    if (px < TILE_PX || py < TILE_PX) continue;
    if (circleHitsWall(world.room.grid, px, py, 10)) continue;
    // And not inside another body, or the two start overlapping.
    if (world.enemies.some((o) => o.hp > 0 && dist2(o.x, o.y, px, py) < (o.radius + 12) ** 2))
      continue;
    return { x: px, y: py };
  }
  return null;
}

export function livingSummoners(world: World): number {
  return world.enemies.filter((e) => ENEMIES[e.archetype].summon !== null && e.hp > 0).length;
}
