/**
 * Enemy behaviour and firing (design doc 005). Movement is four rules and no
 * pathfinding; firing expands the declared pattern over the step window, so
 * the shape of a volley is data and adding an enemy is adding a pattern.
 */
import { ENEMIES, expandPattern } from "../encounters/index.ts";
import type { BulletEmission } from "../encounters/patterns.ts";
import type { BossPhase } from "../encounters/enemies.ts";
import { affixStats } from "../encounters/affixes.ts";
import type { EliteAffix, EnemyId, MeleeKind } from "../types.ts";
import { TILE_PX, GRID_W, GRID_H } from "../types.ts";
import { PLAYER_RADIUS } from "./types.ts";
import type { Enemy, World } from "./types.ts";
import {
  ENEMY_BULLET_CAP, SUMMONER_INTERVAL_S, SUMMONER_MINION_CAP, MAX_CONCURRENT_ENEMIES, BOSS_PHASES, bossPhaseAt } from "../encounters/enemies.ts";

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
  wallSlamSquareness, MELEE_ATTACKS,
} from "./melee.ts";
import {
  castRanged, isElite, planted, riftLance, shockCleave, sightBeam, stepExpansion, submerged,
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
const PERCEPTION_MS: Readonly<Record<EnemyId, number>> = {
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
};

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
const GAIT: Readonly<Record<EnemyId, { periodMs: number; duty: number; burst: number }>> = {
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
};

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

/** How long a full ice gauge freezes a body. */
export const ENEMY_FREEZE_MS = 1300;
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
export const ENRAGED_SPEED = 1.15;
export const ENRAGED_INTERVAL = 0.85;
const KEEP_DISTANCE = 180;
/**
 * The distance a `keep_distance` body holds, by archetype. The warden's gun
 * throws flame a few tiles, not across the room: at the shooters' 180 it
 * stood out of its own reach and never touched anyone.
 */
function keepDistance(e: Enemy): number {
  return e.archetype === "warden" ? 84 : KEEP_DISTANCE;
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
 * How much armour each archetype starts with, taken out of its health rather
 * than added to it: the tank is still 42 points to kill, but the first 18 of
 * them buy the right to interrupt it.
 */
/**
 * Armour by archetype. The boss's definition promised "a tank's armour" and
 * this table did not have it, so it was fought as a large rusher: measured, it
 * died in 2.6 s to seven swings and four spells, taking no heart off the
 * player. Three times a tank's, because the player arrives with a full run's
 * worth of damage upgrades and the armour is the phase the fight opens with.
 */
const ARMOUR: Partial<Record<EnemyId, number>> = { tank: 24, boss: 60 };

/** Whether hit stun applies. Armour is immunity, and armour can be broken. */
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

export function canStagger(e: Enemy): boolean {
  return e.armour <= 0;
}

/** How long the break flash runs. */
export const ARMOUR_BREAK_MS = 260;

/**
 * A charge slamming into a wall should be felt, not merely seen. The world
 * owns the trauma accumulator, so the enemy module asks rather than writes.
 */
function impactShake(world: World, e: Enemy): void {
  world.trauma = Math.min(1, world.trauma + 0.35);
  world.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: `wall:${e.archetype}` });
}

/** Claims one of the room's attack tokens, if any are free. */
function takeToken(world: World, e: Enemy): boolean {
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
export function stagger(world: World, e: Enemy): void {
  if (!canStagger(e)) return;
  e.staggerMs = STAGGER_MS;
  e.attack = "approach";
  e.attackMs = 0;
  e.swing.active = false;
  e.swing.trackingMs = 0;
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
/**
 * Patrol speed, as a fraction of the body's own.
 *
 * Slow on two counts: it has to read as *not chasing anything*, and the pauses
 * between legs are where the standing animation plays, so a patrol that
 * hurries spends its time travelling instead of being looked at.
 */
const IDLE_SPEED = 0.2;

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
function patrols(e: Enemy): boolean {
  const fastest = Math.max(...Object.values(ENEMIES).map((d) => d.speed));
  return ENEMIES[e.archetype].speed >= fastest * 0.6;
}

export function makeEnemy(
  id: number,
  archetype: EnemyId,
  x: number,
  y: number,
  affixes: readonly EliteAffix[],
): Enemy {
  const def = ENEMIES[archetype];
  /*
   * Elite bodies are **enraged** before their affixes say anything: 15%
   * faster on the floor and 15% faster to attack, drawn warm and pink. A
   * harder room used to be the same bodies with longer health bars, which
   * reads as the sword being weak; a body that is visibly quicker reads as
   * the room being harder. The affixes multiply on top.
   */
  const base = affixStats(affixes);
  const stats = affixes.length > 0
    ? { ...base, speed_mult: base.speed_mult * ENRAGED_SPEED, interval_mult: base.interval_mult * ENRAGED_INTERVAL }
    : base;
  return {
    id, archetype, x, y,
    hp: def.hp * stats.hp_mult,
    maxHp: def.hp * stats.hp_mult,
    radius: def.radius,
    speed: def.speed * stats.speed_mult,
    affixes,
    // Offset per enemy: a room where everything fires on the same beat reads
    // as one enemy copied, not as several.
    patternMs: (id * 397) % 1700,
    telegraphMs: def.pattern || def.ranged ? TELEGRAPH_MS : 0,
    phase: 1,
    gapPx: 9999,
    bossCast: "none", bossCastMs: 0, bossMoveMs: 2600, bossMoveIndex: 0, bossAddsPhase: 1,
    bossTargetX: 0, bossTargetY: 0, airborne: false,
    pending: [],
    summonMs: SUMMONER_FIRST_MS,
    minions: 0,
    closeIn: false, blinkCooldownMs: 0, pulseCooldownMs: 0, spikeMs: 0, strikesCast: 0, meleeKind: null,
    burnMs: 0, burnSources: 0, poisonStacks: 0, poisonMs: 0, slowMs: 0,
    burnBuild: 0, poisonBuild: 0, chillBuild: 0, frozenMs: 0, buildFedMs: 0, dotShown: 0, dotShowMs: 0,
    spawnFadeMs: SPAWN_FADE_MS + SPAWN_TELEGRAPH_MS,
    hitFlashMs: 0,
    marked: false,
    staggerMs: 0,
    armour: (ARMOUR[archetype] ?? 0) * stats.hp_mult,
    maxArmour: (ARMOUR[archetype] ?? 0) * stats.hp_mult,
    armourBreakMs: 0,
    brakeMs: 0,
    alertMs: 0,
    velX: 0,
    velY: 0,
    hasToken: false,
    hasFireToken: false,
    retreatMs: RETREAT_BUDGET_MS,
    windedMs: 0,
    attackCooldownMs: 0,
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
    wardArmour: 0,
    delve: "surface",
    delveMs: 2500,
    delveX: 0,
    delveY: 0,
    aloneMs: 0,
    idleRole: idleRoleFor(archetype, id),
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
  if (def.behaviour === "stationary" || archetype === "tank" || archetype === "warden" || archetype === "boss") return "guard";
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

/** The first neighbour wakes this long after the body that raised the alarm, the furthest this much later. */
const WAKE_RIPPLE_MS = 140;
const WAKE_RIPPLE_SPREAD_MS = 260;
/**
 * How much further a noise carries than sight: the sword and the dash are
 * heard through walls, inside this multiple of a body's aggro range.
 */
const HEAR_MULT = 0.85;

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
  if (e.idleRole === "sleeper") return d2 <= (base * 0.4) ** 2;
  const noisy = world.swing.active || p.dashMs > 0;
  if (noisy && d2 <= (base * HEAR_MULT) ** 2) return true;
  if (d2 > base * base) return false;
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
      e.wanderPauseMs = 600 + world.rng.next() * 900;
      return { dx: 0, dy: 0 };
    }
    const a = world.rng.next() * Math.PI * 2;
    const r = IDLE_DRIFT * (0.35 + world.rng.next() * 0.65);
    e.wanderX = e.homeX + Math.cos(a) * r;
    e.wanderY = e.homeY + Math.sin(a) * r;
    // Short: a patrol should be mostly walking. At half a second to two
    // seconds it stood far more than it moved, and a body standing still is
    // drawn from a single frame — so the room looked unanimated.
    // A real stop, long enough for the standing animation to play a cycle.
    e.wanderPauseMs = 900 + world.rng.next() * 1600;
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
  const slow = (e.slowMs > 0 ? 0.6 : 1) * (e.archetype === "boss" ? bossPhase(e).speed : 1)
    // Fire feeds the cinderling: it burns faster than it walks (research §2.6).
    * (e.archetype === "cinderling" && e.burnMs > 0 ? 1.3 : 1);
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
  const speed = e.speed * slow * dt;
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
      if (e.archetype === "boss" && e.bossCast !== "none") return { dx: 0, dy: 0 };
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
      if (e.windedMs > 0) {
        // Holding: it will still strafe, but it does not give ground.
        const tx0 = -direct.y * e.strafe;
        const ty0 = direct.x * e.strafe;
        return { dx: tx0 * STRAFE_WEIGHT * amble, dy: ty0 * STRAFE_WEIGHT * amble };
      }
      const sign = wantsBack ? -1 : range > keepDistance(e) * 1.2 ? 1 : 0;
      if (sign < 0 && field) {
        const away = followField(field, e.x, e.y, true);
        if (away) return { dx: away.x * speed, dy: away.y * speed };
      }
      const tx = -direct.y * e.strafe;
      const ty = direct.x * e.strafe;
      // Backing away is committed; holding a range and working sideways ambles.
      const pace = sign < 0 ? speed : amble;
      return {
        dx: (direct.x * sign + tx * STRAFE_WEIGHT) * pace,
        dy: (direct.y * sign + ty * STRAFE_WEIGHT) * pace,
      };
    }

    case "orbit": {
      if (!visible || jammed) {
        const v = toward();
        return { dx: v.x * speed, dy: v.y * speed };
      }
      const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
      // The sower circles wide, so its ring of seeds closes on the player over the fight.
      const orbit = e.archetype === "sower" ? ORBIT_RADIUS * 1.3 : ORBIT_RADIUS;
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
    e.swing.trackingMs = Math.max(0, e.attackMs - (spec.windupMs - MELEE.trackMs));
    if (e.swing.trackingMs > 0) {
      const seen = seenPlayer(world, e);
      const v = normalise(seen.x - e.x, seen.y - e.y);
      e.swing.facing = Math.atan2(v.y, v.x);
      e.swing.angle = e.swing.facing;
    }
    e.swing.active = false;
  } else if (e.attack === "lunge") {
    e.swing.trackingMs = 0;
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
      // Shock Cleave: the elite tank's chop cracks the floor ahead of it.
      if (e.meleeKind === "cleave" && e.archetype === "tank" && isElite(e)) {
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
      e.attackMs = spec.recoverMs;
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
      if (spec.brakeMs > 0) {
        e.brakeMs = spec.brakeMs;
        world.trauma = Math.min(1, world.trauma + 0.22);
        world.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: `brake:${e.archetype}` });
      } else {
        e.velX = 0;
        e.velY = 0;
      }
      break;
    case "recover":
      e.attack = "approach";
      e.attackMs = 0;
      // The turn is over: hand the token back and stand down for a beat, so
      // one body cannot hold a token permanently by re-committing instantly.
      dropToken(world, e);
      e.attackCooldownMs = restAfter(world, e, spec.restMs);
      break;
  }
}

/**
 * Enters the windup: the state machine's one entry action, so the timer and
 * the armed blade cannot come apart. Exported because the entry action is what
 * a test of the attack has to drive, and reproducing it at the call site is how
 * a test ends up asserting against a state the simulation never reaches.
 */
export function beginWindup(e: Enemy, target: { x: number; y: number }): void {
  e.meleeKind = chooseMelee(e);
  const spec = meleeSpec(e);
  e.attack = "windup";
  /*
   * Planted means planted. The windup asks for no movement, but the velocity
   * ramp let the strafe the body was in carry on decaying through it, so a
   * spike drive that began in reach had slid out of it by the time it fired.
   * A body that has decided to attack stops on the spot.
   */
  e.velX = 0;
  e.velY = 0;
  e.attackMs = spec?.windupMs ?? MELEE.windupMs;
  if (!spec) return;
  // Armed inert, so the telegraph the renderer draws *is* the hitbox.
  const v = normalise(target.x - e.x, target.y - e.y);
  armMeleeAttack(e.swing, spec, e.x, e.y, Math.atan2(v.y, v.x), e.strafe);
  /*
   * The first attack this body makes in the room does no damage. Lidén's
   * "miss the first time": the shape, the reach and the rhythm are all shown
   * at full strength, and the player is not charged a heart for learning them.
   */
  if (!e.hasAttacked) e.swing.damage = 0;
  e.hasAttacked = true;
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
  if (e.archetype === "tank") return e.closeIn ? "cleave" : "charge";
  // The boss: by phase, and by distance within the phase.
  if (e.archetype === "boss") {
    const ph = bossPhase(e);
    return e.closeIn ? ph.melee.near : e.gapPx > ph.farPx ? ph.melee.far : ph.melee.far === "charge" ? "slash" : ph.melee.far;
  }
  return ENEMIES[e.archetype].melee;
}

/** Inside this the boss swings rather than shoots. */
const BOSS_PATTERN_MIN_GAP = 95;

/** The boss's current phase entry. */
export function bossPhase(e: Enemy): BossPhase {
  return BOSS_PHASES[Math.min(BOSS_PHASES.length, Math.max(1, e.phase)) - 1]!;
}

/**
 * Advances the boss's phase from its health, and marks the change.
 *
 * A phase change is a beat: the volley in hand is dropped, the body stands
 * for most of a second, the room shakes, and the renderer swaps the sheet.
 * Without the pause the player is told "it is different now" while being
 * shot at, which is a message they cannot read.
 */
const PHASE_CHANGE_PAUSE_MS = 800;

function stepBossPhase(world: World, e: Enemy): void {
  if (e.archetype !== "boss" || e.hp <= 0) return;
  const next = bossPhaseAt(e.hp / Math.max(1, e.maxHp));
  if (next === e.phase) return;
  e.phase = next;
  // Armoured again for the new phase (Hades' rule: the break is the reward
  // for a phase, not a state the fight stays in).
  e.armour = e.maxArmour;
  e.bossCast = "none";
  e.bossCastMs = 0;
  e.airborne = false;
  e.bossMoveMs = 1400;
  e.bossMoveIndex = 0;
  e.pending = [];
  e.telegraphMs = 0;
  dropFireToken(world, e);
  e.attackCooldownMs = Math.max(e.attackCooldownMs, PHASE_CHANGE_PAUSE_MS);
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
  if (e.archetype === "rusher" && world.rng.next() < 0.35) return restMs * 0.3;
  return restMs;
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
  const reach = e.radius + PLAYER_RADIUS + (meleeSpec(e)?.commitRange ?? MELEE.range);

  switch (e.attack) {
    case "approach": {
      const gap2 = dist2(e.x, e.y, p.x, p.y);
      const ready = e.attackCooldownMs <= 0;

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
        if (clear && gap2 <= reach * reach && takeToken(world, e)) {
          beginWindup(e, p);
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
      const ring = reach * WAITING_RING;
      const gap = Math.sqrt(gap2) || 1;
      const v = toward();
      // Sideways, plus whatever correction holds the ring.
      const radial = (gap - ring) / ring;
      const drift = Math.max(-1, Math.min(1, radial * 2.5));
      return {
        dx: (-v.y * e.strafe * WAITING_STRAFE + v.x * drift) * amble,
        dy: (v.x * e.strafe * WAITING_STRAFE + v.y * drift) * amble,
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

export function stepEnemy(world: World, e: Enemy, dtMs: number): void {
  const dt = dtMs / 1000;

  if (e.spawnFadeMs > 0) {
    e.spawnFadeMs -= dtMs;
    return;
  }

  // Elements tick before movement so a slow applies the same frame it lands.
  if (e.slowMs > 0) e.slowMs -= dtMs;
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
    if (e.archetype === "cinderling") e.hp = Math.min(e.maxHp, e.hp + 2 * Math.max(1, e.burnSources) * dt);
    else e.dotShown += 2 * Math.max(1, e.burnSources) * dt;
    if (e.burnMs <= 0) e.burnSources = 0;
    e.burnBuild = Math.max(0, e.burnMs / 3000);
  } else if (e.buildFedMs <= 0) e.burnBuild = Math.max(0, e.burnBuild - 0.35 * dt);
  if (e.poisonMs > 0) {
    e.poisonMs -= dtMs;
    e.dotShown += e.poisonStacks * dt;
    if (e.poisonMs <= 0) e.poisonStacks = 0;
    e.poisonBuild = Math.max(0, e.poisonMs / 4000);
  } else if (e.buildFedMs <= 0) e.poisonBuild = Math.max(0, e.poisonBuild - 0.35 * dt);

  /*
   * Status damage lands twice a second as one whole number — rounded down,
   * at least one — rather than as a sliver every frame: damage is always an
   * integer, and a tick is a thing the player can see and count.
   */
  e.dotShowMs -= dtMs;
  if (e.dotShowMs <= 0) {
    e.dotShowMs = 500;
    if (e.dotShown > 0) {
      const tick = Math.max(1, Math.floor(e.dotShown * world.dealtMult));
      e.hp -= tick;
      world.stats.damageDealt += tick;
      world.events.push({ kind: "damage", x: e.x, y: e.y - e.radius, what: e.burnMs > 0 ? "dot:burn" : "dot:poison", amount: tick });
      e.dotShown = Math.max(0, e.dotShown - tick / Math.max(0.01, world.dealtMult));
    }
    if (e.burnMs <= 0 && e.poisonMs <= 0) e.dotShown = 0;
  }
  if (e.hitFlashMs > 0) e.hitFlashMs -= dtMs;
  if (e.armourBreakMs > 0) e.armourBreakMs -= dtMs;
  /*
   * Braking: the velocity is shed gradually rather than being cut or coasting.
   * 0.94 per frame carries it about 52 px — a tile and a half — with the last
   * of it trailing off, which is the curve a heavy thing stopping has.
   */
  if (e.brakeMs > 0) {
    e.brakeMs -= dtMs;
    e.velX *= 0.94;
    e.velY *= 0.94;
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
  if (e.alertMs > 0) {
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
    if (!e.awake && noticesPlayer(world, e)) {
      wake(world, e);
    } else if (!e.awake) {
      /*
       * Not yet in the fight, but alive: it patrols near where it was placed.
       * See `wanderStep` for why this is a destination rather than a drift.
       */
      const walks = (e.idleRole === "patrol" || e.idleRole === "idler") && patrols(e);
      const d = walks ? wanderStep(e, world, dt, dtMs) : { dx: 0, dy: 0 };
      /*
       * A body that holds its ground still looks around. Without it a
       * non-patrolling dormant enemy is frozen in one direction for the whole
       * time the player is picking their way past it, which is both dull and
       * misreads as a rendering fault.
       */
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
    if (hasLineOfSight(world.room.grid, e.x, e.y, seen.x, seen.y)) {
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

  e.strafeMs -= dtMs;
  if (e.strafeMs <= 0) {
    e.strafe = e.strafe === 1 ? -1 : 1;
    e.strafeMs = 1400 + ((e.id * 173) % 1100);
  }

  const before = { x: e.x, y: e.y };
  const sep = separation(world, e);
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
  if (e.attack === "lunge") {
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
  const dx = e.velX * dt + sep.x * dt;
  const dy = e.velY * dt + sep.y * dt;
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
        e.attack = "approach";
        e.attackMs = 0;
        e.swing.active = false;
        e.velX = 0;
        e.velY = 0;
        dropToken(world, e);
        e.attackCooldownMs = restAfter(world, e, spec.restMs);
        impactShake(world, e);
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
  if (gap < e.lastGap - STUCK_PROGRESS_PX) {
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
    if (e.spikeMs <= 0 && e.hp > 0) spikeVolley(world, e, SPIKE_FLY_SPEED, 0.8, e.swing.reach + 4);
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
 * Out to here, a ranged body must be standing still to shoot. See `fire`.
 *
 * Cut from 210, which was a third of the room's width: the rule bit at mid
 * range, where a shooter is *supposed* to be dangerous, and stacked with the
 * silence radius, the aim window and the fire cap until ranged enemies dealt
 * literally zero damage across sixteen runs. It should bite when the player is
 * genuinely closing, which is inside about four tiles.
 */
const REPOSITION_RADIUS = 125;

/** Above this speed a body counts as repositioning rather than holding. */
const MOVING_TO_SHOOT_PX_PER_S = 22;

function fire(world: World, e: Enemy, dtMs: number): void {
  const def = ENEMIES[e.archetype];
  if (!def.pattern && !def.ranged) return;
  // One threat at a time: the pattern holds while a signature move runs, and
  // while the player is in sword range — up close the boss is the blade, and
  // an aimed volley from arm's length cannot be read, only eaten.
  if (e.archetype === "boss" && (e.bossCast !== "none" || e.gapPx < BOSS_PATTERN_MIN_GAP)) return;

  /*
   * Silenced at close range, and the pattern clock stops with it — so backing
   * off does not release a volley that was charging while the player was on
   * top of it. The exception is a body with a blade, which is supposed to be
   * dangerous up close; nothing in the roster has both.
   */
  /*
   * A ranged body either moves or shoots, never both.
   *
   * The design writing on this is unanimous and it is the piece that was
   * missing: **an archer must not have a completely safe firing position.**
   * A shooter that backpedals while firing has one, because its own retreat is
   * free — it can hold its distance and its rhythm at the same time, and the
   * player closing gains nothing until they arrive.
   *
   * Two rules, from the inside out. Inside `PANIC_RADIUS` it is silent
   * altogether, which is the reward for arriving. Out to `REPOSITION_RADIUS`
   * it may shoot **only if it is standing still** — so the moment the player
   * commits to closing, it has to choose, and whichever it chooses gives the
   * player something. Beyond that it is a shooter at range and behaves like
   * one.
   *
   * Anything with a blade is exempt; nothing in the roster has both.
   */
  // The warden's gun is a close weapon — a flame, not a shot — so the rule
  // that a shooter does not fire at a player on top of it does not apply.
  if (def.melee === null && e.archetype !== "warden") {
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
      dropFireToken(world, e);
      return;
    }
    if (gap2 <= REPOSITION_RADIUS * REPOSITION_RADIUS
      && Math.hypot(e.velX, e.velY) > MOVING_TO_SHOOT_PX_PER_S) {
      /*
       * Moving, so not shooting — and **not holding** either. This returned
       * with the aimed volley and its firing turn intact, so a body that kept
       * moving inside the radius (the orbiter, whose whole behaviour is to
       * move) sat frozen mid-telegraph: blinking red for as long as the
       * player stayed close, and holding one of the room's three firing turns
       * so that everything else shot less. The volley is dropped as the panic
       * branch drops it; it can aim again once it is standing still.
       */
      e.pending = [];
      e.telegraphMs = 0;
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
      if (e.archetype === "sentinel" && isElite(e)) sightBeam(world, e, seenPlayer(world, e));
      else release(world, e, e.pending as readonly BulletEmission[]);
      e.pending = [];
    }
    dropFireToken(world, e);
    return;
  }

  const stats = affixStats(e.affixes);
  const scaled = dtMs / stats.interval_mult;

  /*
   * The two non-projectile kinds run off the same clock the patterns do, so
   * an archetype's cadence means one thing whatever it is throwing, and elite
   * affixes that speed up a volley speed these up identically.
   */
  if (def.ranged) {
    const period = def.ranged.interval_s * 1000;
    const before = e.patternMs;
    e.patternMs += scaled;
    if (Math.floor(before / period) === Math.floor(e.patternMs / period)) return;
    if (def.ranged.kind === "lightning") {
      // Rift Lance: the elite turret splits the floor toward you instead.
      if (isElite(e)) riftLance(world, e, seenPlayer(world, e));
      else castStrike(world, e);
    } else if (def.ranged.kind === "flame") throwFlame(world, e);
    else castRanged(world, e, def.ranged.kind, seenPlayer(world, e));
    return;
  }

  // The boss reads its phase's pattern, at its phase's pace.
  const phase = e.archetype === "boss" ? bossPhase(e) : null;
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
  e.telegraphMs = AIM_MS;
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
    if (e.pending.length > 0) release(world, e, e.pending as readonly BulletEmission[]);
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

/**
 * Claims one of the room's firing turns. Held from the moment a volley is
 * decided until it has been released, so the cap covers the wind-up as well as
 * the shot — the wind-up is when the player is being asked to move.
 */
function takeFireToken(world: World, e: Enemy): boolean {
  if (e.hasFireToken) return true;
  if (world.fireTokens <= 0) return false;
  world.fireTokens--;
  e.hasFireToken = true;
  return true;
}

export function dropFireToken(world: World, e: Enemy): void {
  if (!e.hasFireToken) return;
  e.hasFireToken = false;
  world.fireTokens++;
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

/** Fires a held volley, aimed at where the body last saw the player. */
/** How fast a lancer's spikes travel once they leave it, and how long they hang first. */
const SPIKE_FLY_SPEED = 140;
export const SPIKE_HANG_MS = 280;
const SPIKE_COUNT = 8;

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

export function release(world: World, e: Enemy, emissions: readonly BulletEmission[], fromRadius = 0): void {
  if (liveCount(world.enemyBullets) + emissions.length > ENEMY_BULLET_CAP) return;

  // Aimed where it last saw them, so strafing works at all.
  const aimed = seenPlayer(world, e);
  for (const em of emissions) {
    const aim = em.aim === "player"
      ? Math.atan2(aimed.y - e.y, aimed.x - e.x)
      : (Number(String(em.aim).slice(6)) * Math.PI) / 180;
    const angle = aim + (em.angle_deg * Math.PI) / 180;
    const b = acquire(world.enemyBullets, false);
    if (!b) return;
    // `fromRadius` starts a shot away from the centre: the lancer's spikes
    // break off at their tips, not out of its middle.
    b.x = e.x + Math.cos(angle) * fromRadius;
    b.y = e.y + Math.sin(angle) * fromRadius;
    b.vx = Math.cos(angle) * em.speed;
    b.vy = Math.sin(angle) * em.speed;
    b.radius = ENEMY_BULLET_RADIUS * em.size;
    b.damage = ENEMY_BULLET_DAMAGE;
    b.element = e.affixes.includes("burning") ? "fire" : "none";
    b.elementPower = 1;
    b.from = e.archetype;
  }
  // Which way the volley left, for the muzzle flash: along its first shot.
  const first = emissions[0];
  const facing = first
    ? (first.aim === "player" ? Math.atan2(aimed.y - e.y, aimed.x - e.x) : (Number(String(first.aim).slice(6)) * Math.PI) / 180) + (first.angle_deg * Math.PI) / 180
    : e.facing;
  world.events.push({ kind: "shot", x: e.x, y: e.y, what: e.archetype, facing, amount: emissions.length });
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
  b.damage = ENEMY_BULLET_DAMAGE;
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
function summon(world: World, e: Enemy, dtMs: number): void {
  const def = ENEMIES[e.archetype];
  if (!def.summon) return;
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
  world.enemies.push(makeEnemy(world.nextEnemyId++, rule.archetype, at.x, at.y, e.affixes));
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
