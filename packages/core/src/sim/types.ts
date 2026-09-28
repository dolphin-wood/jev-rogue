/**
 * Live simulation state (design doc 008). Everything here runs in core at a
 * fixed 60 Hz step with no DOM and no Phaser, so the headless harness plays
 * the same game the player does rather than an approximation of it.
 *
 * Entities are mutated in place and recycled through pools: at 900 player and
 * 600 enemy bullets, allocating per frame would dominate the step.
 */
import type {
  Element, ElementPowers, EliteAffix, EnemyId, ItemInstance, RoomPlan, Staff, MeleeKind } from "../types.ts";
import type { Rng } from "../rng.ts";
import type { AffixContext } from "../encounters/affixes.ts";
import type { BossScript } from "../encounters/enemies.ts";
import type { AudienceState } from "./audience.ts";
import type { GuardianState } from "./guardian.ts";
import type { ObjectiveState } from "./objective.ts";
import type { FlowField } from "./flow.ts";
import type { SwingBox } from "./melee.ts";
import type { SpellSlot } from "./spells.ts";
import type { Destructible } from "./props.ts";
import type { Pickup } from "./pickups.ts";
import type { Portal, PortalSpec, RewardDrop, RoomOffer } from "./exits.ts";
import type { AttachedAffix, Ward } from "./affix-hooks.ts";

export const STEP_MS = 1000 / 60;
/**
 * Lowered to 120, by way of 115, 170 and 200, from 240.
 *
 * The figure is a **relationship, not a speed**: the fastest body in the
 * roster runs at a bit under 80% of it (92 against 120, so 77%). That is the number worth holding, because it is
 * what decides whether the player can walk away from a fight — at 80% a rusher
 * closes slowly and relentlessly, so leaving is a decision with a cost rather
 * than a free reset, and the dash becomes the way out instead of the stroll.
 *
 * 240 was itself a raise from 180, and the reason given was that at 180 a
 * crossing took nearly four seconds and no bullet pattern is fun when you
 * cannot get out of its way. **That reasoning no longer binds.** The roster has
 * two emitters left rather than six, neither fires a spread, the bullets are
 * 3.4 px rather than 7, and every volley winds up before it fires — so the
 * floor is no longer something to sprint across before the next wall of fire
 * arrives.
 *
 * What the high speed cost was weight. The player outran every consequence:
 * enemies could not commit to a position because the player had already left
 * it, and their attacks felt weightless because nothing done with the ground
 * mattered. A crossing is now about six seconds, the dash is **five times**
 * walking pace rather than two and a half, and a step is a decision rather
 * than a correction.
 */
export const PLAYER_SPEED = 120;
/**
 * Smaller than the sprite on purpose. A hitbox that matches what you see is
 * the classic way a bullet hell feels unfair: near misses register as hits
 * and the player cannot tell why.
 */
export const PLAYER_RADIUS = 7;

/* Dash (design doc 001 reversed; see the note there).
 * Excluding it was a mistake. Movement-only dodging in a room this size
 * leaves nothing to do about a volley already in the air, which is exactly
 * the "too easy to get hit, and dodging is not fun" complaint. */
/*
 * The dash, shortened.
 *
 * 620 px per second for 170 ms carried the player 105 px, which is 3.3 tiles
 * in a room 21 tiles wide — a sixth of the floor per press. A dodge should
 * clear an attack, not cross the arena, so it is cut to about two tiles and
 * made quicker, which also reads as snappier.
 */
export const DASH_SPEED = 580;
export const DASH_MS = 110;
/**
 * How long the dash makes the player untouchable, counted from its start.
 *
 * **Longer than the dash itself**, which is the whole point and was the bug.
 * It used to be 85 ms of a 110 ms dash — invulnerable for most of the travel
 * and vulnerable for the last 25 ms and every millisecond after. So a dash
 * into a bullet's path arrived safely and was then hit by the bullet it had
 * just dodged, and the answer to "what is a dodge for" was genuinely nothing.
 *
 * The genre answers this the same way everywhere: the dodge is invulnerable
 * for its whole duration **plus a grace window on the far side**, because the
 * thing being dodged takes time to pass through where the player was. Enter
 * the Gungeon's roll is invulnerable for effectively all of it; Hades' dash is
 * short and fully covered.
 *
 * 110 ms of travel plus 90 ms of grace is 200 ms of cover for a 64 px hop,
 * against a cooldown of 420 ms — so it clears an attack and is not a way to
 * live in the middle of a volley.
 */
export const DASH_IFRAME_MS = DASH_MS + 90;
export const DASH_COOLDOWN_MS = 420;
/**
 * Mercy after a hit.
 *
 * Raised from 600 ms. Six hearts at one heart a hit is not many for a design
 * that requires the player to **cross fire to do anything at all**, and the
 * failure it produced was the worst kind: dying on the way in, before the
 * fight the room was built around had started. A longer window does not make
 * any single attack weaker — it makes a bad moment survivable, which is the
 * difference between a mistake and a run ending.
 *
 * Paired with `HURT_NUDGE`, which moves the player off the line they were hit
 * on, so the window cannot be spent standing in the same stream.
 */
export const INVULN_MS = 950;

/**
 * How hard a hit shoves the player, as a **share of their walking speed**.
 *
 * Zelda's answer, and it is about fairness rather than feel: invulnerability
 * alone leaves the player exactly where they were hit, so the moment it lapses
 * the same stream or the same blade takes the next heart. Being moved is what
 * turns a hit into an event with a recovery instead of the first of several.
 *
 * Relative, because it was absolute and the relationship broke silently. At
 * 180 px/s against a walk of 240 it was three quarters of a step — a shove.
 * The player's speed was then cut to 120 and the same 180 became **150% of
 * walking**, so a hit flung them further than they could run, and during a
 * lightning stun it read as the player sprinting away while supposedly unable
 * to act.
 */
const HURT_NUDGE_FRACTION = 0.75;
export const HURT_NUDGE = PLAYER_SPEED * HURT_NUDGE_FRACTION;
export const HURT_NUDGE_MS = 180;

/**
 * How long each kind of hit takes the player's control away.
 *
 * Inside `INVULN_MS`, which is what makes it fair: see `Player.stunMs`. The
 * marker sits on the ground for 900 ms before the bolt lands, so the player
 * had time to leave and chose not to.
 */
export const STUN_LIGHTNING_MS = 620;

// The caps and the heart count have one definition each, in the modules that
// own them. Re-declaring them here would let the assembler plan against one
// number while the simulation enforced another.
export {
  ENEMY_BULLET_CAP, PLAYER_BULLET_POOL, BULLET_LIFETIME_S,
} from "../encounters/enemies.ts";
export { MAX_HEARTS } from "../run/summarize.ts";

/**
 * How much **health** one heart is worth on screen. The simulation keeps
 * hearts, fractional since statuses drain them; the player reads a bar with
 * a number on it, and every place that shows or names health uses this one
 * scale so a card's "+10 health" is the bar's ten.
 */
export const HP_PER_HEART = 10;

export interface Vec {
  x: number;
  y: number;
}

export interface Bullet {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  lifeMs: number;
  pierce: number;
  bounce: number;
  homing: number;
  split: number;
  element: Element;
  elementPower: number;
  /**
   * Every element it carries, by gauge-filling power. `element` above is only
   * the loudest of these, for the renderer; this is what feeds the statuses.
   * See `ElementPowers`.
   */
  powers: ElementPowers;
  /**
   * **What this hit is worth to everything that triggers on a hit** — the
   * element gauges, `brand`, `harvest` — as a multiple of one ordinary hit.
   * Risk of Rain 2's proc coefficient, and for its reason: without it the way
   * to build any on-hit effect is to fire the most pieces, so a seven-pellet
   * cone fills a poison gauge seven times faster than a bolt for the same
   * damage and every on-hit affix collapses onto one spell. A piece of a
   * multi-hit is worth a fraction; a slow heavy hit is worth more than one.
   * See `procWeight` in `cast.ts`. A status tick is worth **zero**, which is
   * what stops a burn feeding the burn that lit it.
   */
  proc: number;
  /**
   * The damage multiplier of the build that fired this, carried so the status
   * it lights ticks as hard as the build hits: see `Enemy.statusMult`.
   */
  statusMult: number;
  hitIds: number[];
  /**
   * What the spell that fired this had attached. Written at cast, read when
   * the projectile hits, dies or kills — see `affix-hooks.ts`. Empty for
   * anything an enemy fires.
   */
  affixes: readonly AttachedAffix[];
  /** Which of the three keys fired it, or -1. */
  spellIndex: number;
  /** What that cast cost, so a refund is a fraction of a real number. */
  manaSpent: number;
  /**
   * How heavy the shot lands, 1 for most: a heavy shot knocks a body back
   * further, freezes the frame longer and shakes the room. From the item's
   * `weight` param.
   */
  weight: number;
  /** Arcs a `chain` projectile may still make. */
  arcLeft: number;
  /**
   * Where the shot came into being, in world px.
   *
   * Kept so the renderer can draw what a projectile *is* rather than only
   * where it is now: a bolt's streak runs back along its own path, and a
   * chain arc is drawn as a line from the body it left to the body it is
   * reaching, which without an origin is not reconstructable from a position
   * and a velocity.
   */
  originX: number;
  originY: number;
  /**
   * The enemy this shot is steering toward, or -1.
   *
   * Homing used to be aimed at `w.enemies.find(isActive)` — the first live
   * body in the array, the same one for every projectile in the air, whoever
   * each of them was fired at. A shot that curves has to curve toward the
   * thing it was aimed at or the curve is a lie, so the target is chosen once
   * at cast and carried.
   */
  targetId: number;
  /**
   * Degrees per second this shot turns toward `targetId`, on top of `homing`.
   *
   * This is what makes a spell's path its own. A needle flies straight, a
   * bolt bends in over its flight, and a bloom is launched wide and hauled
   * back — the arc it traces is a quadratic curve from the hand, through the
   * launch offset, into the body, which is the shape the design asked for and
   * costs one number per projectile rather than a stored spline.
   */
  seekDegPerS: number;
  /**
   * How much longer the bullet may steer, in ms: **0 is unlimited** (a seeking
   * spell curves all the way in), a positive budget counts down, and -1 is a
   * budget that has been spent. The wisp's curl is bounded (doc 019) so that
   * the shot is answered by moving **late** rather than by outrunning it.
   */
  seekMs: number;
  /**
   * An **orbiting** shot circles the player instead of travelling: `orbitMs`
   * is how long it has left, `orbitAngle` where it is on the circle, and
   * `orbitRadius` how far out. It ignores walls, never dies on a hit, and
   * clears its hit list every `rehitMs` so a body standing in the ring keeps
   * taking damage. The one spell shape whose damage follows the player's
   * body rather than a target, which is what makes standing in a rush a
   * decision rather than a mistake.
   */
  orbitMs: number;
  orbitAngle: number;
  orbitRadius: number;
  orbitDegPerS: number;
  rehitMs: number;
  /**
   * Leaves a patch of fire where it stops. This is how the thrown-flame attack
   * kind works: the travel and the collision are the ordinary bullet path, and
   * only the ending differs.
   */
  leavesFire: boolean;
  /**
   * Who fired it, for the damage tally. "Bullets are a third of all damage" is
   * not actionable; "the orbiter's inward fan is a third of all damage" names a
   * pattern to retune.
   */
  from: string;
  /**
   * A `doom` shot (doc 006): the mark it leaves on the body it hits — how long
   * until the mark bursts, what the burst deals and how wide. Zero `doomMs` is
   * a shot that marks nothing. See `Enemy.doomMs`.
   */
  doomMs: number;
  doomDamage: number;
  doomRadius: number;
  /**
   * An `emit` shot (doc 006): every `emitMs` of flight it throws a shard
   * along `emitAngle`, which turns with each shard, and when it dies it bursts
   * into `emitRing` of them. `emitClock` counts down to the next shard. Zero
   * `emitMs` is a shot that throws nothing.
   */
  emitMs: number;
  emitClock: number;
  emitAngle: number;
  emitDamage: number;
  emitRing: number;
  /**
   * A `contagion` shot (doc 006): a body this leaves poisoned carries the
   * contagion, and its death passes the poison on to up to this many bodies
   * within `contagionReach`. Zero is a shot that carries none.
   */
  contagion: number;
  contagionReach: number;
  /**
   * **What kind of thing of the spell this is** (doc 006's shapes), for the
   * world's rules and the renderer's drawing: a `shot` flies and dies as a
   * projectile always has; a `boomerang` flies out, turns and comes back to
   * the caster (`returning`, below); a `strike` is an orb's blow, born on the
   * body it hits; a `wave` is an enchant's crescent thrown by a sword swing.
   */
  delivery: BulletDelivery;
  /**
   * A `boomerang`: whether it has turned for home, how far its outward flight
   * runs in all and how much of it is left, the speed it was thrown at, and
   * the speed it comes back at. The flight slows as the distance left runs
   * out, and the return steers at where the caster is **now**.
   */
  returning: boolean;
  outPx: number;
  outLeftPx: number;
  launchSpeed: number;
  returnSpeed: number;
}

/** See `Bullet.delivery`. */
export type BulletDelivery = "shot" | "boomerang" | "strike" | "wave";

/**
 * A strike landed at a point without the player going there: a dash spell
 * cast free (`resonance`, `retort`, `slipstream`, a `scatter` side cast).
 * A sword hit must never throw the player across the room, so the free cast
 * of a dash is its cut, delivered where it was aimed, and resolved on the
 * next step by `stepDashStrike`.
 */
export interface FreeStrike {
  x: number;
  y: number;
  radius: number;
  damage: number;
  element: Element;
  powers: ElementPowers;
  proc: number;
  statusMult: number;
  spellIndex: number;
}

/**
 * A `doom` mark whose body died before it burst (doc 006). The burst still
 * goes off, on its own clock, where the body fell: marking a pack and then
 * killing into it is the play the delay asks for, and a mark that vanished
 * with its body would punish the kill.
 */
export interface LooseDoom {
  x: number;
  y: number;
  ms: number;
  damage: number;
  radius: number;
  spellIndex: number;
}

/**
 * A `land` dash in the air (doc 006): the ring of erupting ground it comes
 * down in, waiting for the travel to end. Read off the spell at the cast and
 * spent where the player actually lands, which a wall may make short of the
 * body it was aimed at.
 */
export interface Landing {
  damage: number;
  radius: number;
  rings: number;
  first: number;
  step: number;
  delayMs: number;
  /** How far apart a ring's cells stand along its circle, in cell radii (`ring_spacing`). */
  spacing: number;
  weight: number;
  kind: "earth" | "fire";
  element: Element;
  elementPower: number;
  powers: ElementPowers;
  proc: number;
  statusMult: number;
  burnMs: number;
  spellIndex: number;
}

/**
 * A **vortex**: a spell that changes where the enemies are.
 *
 * Nothing else in the pool does. A projectile hits what is standing where
 * it is; a vortex drags what is scattered into one clump, which is the setup
 * the sword and every area spell want and could not make for themselves. It
 * pulls every step and ticks a little damage on what it holds.
 */
export interface Vortex {
  alive: boolean;
  x: number;
  y: number;
  radius: number;
  lifeMs: number;
  maxLifeMs: number;
  /** Pull, in px/s at the rim, falling off toward the centre. */
  pull: number;
  tickMs: number;
  damage: number;
  /**
   * The element it carries and how hard, and how hard the build that made it
   * burns (`Enemy.statusMult`). `kindle`, `rime` and `blight` say they fit
   * every spell shape, and until these three fields existed they were a card
   * that attached to a dash, a pull or a companion and did nothing.
   */
  element: Element;
  elementPower: number;
  /**
   * Every element it carries, by gauge-filling power. `element` above is only
   * the loudest of these, for the renderer; this is what feeds the statuses.
   * See `ElementPowers`.
   */
  powers: ElementPowers;
  /** What one of these is worth to on-hit effects; see `Bullet.proc`. */
  proc: number;
  statusMult: number;
  spellIndex: number;
  /**
   * What it deals, once, to every body still inside `radius` when the pull
   * ends (`collapse`, doc 006); 0 for a vortex that simply lets go.
   */
  collapseDamage: number;
}

/**
 * One cell of a **ground eruption**: a spell that is not a projectile but the
 * floor going off, cell by cell along a line or across a spread — spikes of
 * stone, columns of fire. Each waits its turn (`delayMs`), goes off once on
 * what stands in it, and is drawn for a moment after.
 */
export interface Eruption {
  alive: boolean;
  x: number;
  y: number;
  /** Until it goes off. */
  delayMs: number;
  /** Since it went off, for the drawing. */
  ageMs: number;
  fired: boolean;
  radius: number;
  damage: number;
  element: string;
  elementPower: number;
  /**
   * Every element it carries, by gauge-filling power. `element` above is only
   * the loudest of these, for the renderer; this is what feeds the statuses.
   * See `ElementPowers`.
   */
  powers: ElementPowers;
  /** The damage multiplier of the build that made it; see `Enemy.statusMult`. */
  /** What one of these is worth to on-hit effects; see `Bullet.proc`. */
  proc: number;
  statusMult: number;
  /** Its mass, as a shot's (`Bullet.weight`): the knockback and whether it staggers. */
  weight: number;
  /** Fire left on the cell after, ms; 0 for none. */
  burnMs: number;
  kind: "earth" | "fire";
  spellIndex: number;
  /**
   * The cast it belongs to, for a line; 0 for a scatter. A line's cells hit a
   * body once between them: each pushed it on into the next, so one body
   * took every cell of a line of five, staggered five times over.
   */
  castId: number;
  /**
   * How long the cell was marked on the floor before it goes off, in ms; 0
   * for an ordinary cell. A `telegraph_ms` eruption (doc 006) is a landing
   * the bodies can see coming, and the renderer draws the mark for as long
   * as `delayMs` runs against this.
   */
  telegraphMs: number;
}

/**
 * A **companion**: damage that does not need the player's attention.
 *
 * It follows a step behind and fires at the nearest body in range on its own
 * clock, for as long as it lasts. A projectile is spent the instant it is
 * fired; a companion keeps paying while the player is busy dodging a tank,
 * which is the role the survey found no projectile can fill.
 */
export interface Pet {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  lifeMs: number;
  maxLifeMs: number;
  fireMs: number;
  intervalMs: number;
  damage: number;
  range: number;
  speed: number;
  /**
   * The element it carries and how hard, and how hard the build that made it
   * burns (`Enemy.statusMult`). `kindle`, `rime` and `blight` say they fit
   * every spell shape, and until these three fields existed they were a card
   * that attached to a dash, a pull or a companion and did nothing.
   */
  element: Element;
  elementPower: number;
  /**
   * Every element it carries, by gauge-filling power. `element` above is only
   * the loudest of these, for the renderer; this is what feeds the statuses.
   * See `ElementPowers`.
   */
  powers: ElementPowers;
  /** What one of these is worth to on-hit effects; see `Bullet.proc`. */
  proc: number;
  statusMult: number;
  spellIndex: number;
  /** Counts down after a shot, for the attack pose. */
  attackMs: number;
  /** Where round the player it is wandering to, and when it picks the next spot. */
  wanderA?: number;
  wanderR?: number;
  wanderMs?: number;
}

/**
 * An **orb** (doc 006): a slow sphere drifting from where it was cast, which
 * strikes the nearest body within `zapReach` every `zapMs`. It has no body of
 * its own — nothing touches it and it touches nothing — so its whole damage
 * is its strikes, each a `strike` bullet born on the body it hits so that
 * the hit resolves, and fires the spell's hit and kill affixes, exactly as a
 * shot's does. At most the item's `max_alive` from one key; a new one
 * replaces that key's oldest (`born`).
 */
export interface Orb {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Drawn size only: an orb collides with nothing. */
  radius: number;
  lifeMs: number;
  maxLifeMs: number;
  /** Counts down to the next strike; held at zero while nothing is in reach. */
  zapClockMs: number;
  zapMs: number;
  zapReach: number;
  damage: number;
  element: Element;
  elementPower: number;
  powers: ElementPowers;
  proc: number;
  statusMult: number;
  affixes: readonly AttachedAffix[];
  spellIndex: number;
  manaSpent: number;
  /** When it was cast, in world ticks: the oldest of a key's orbs is the one a new one replaces. */
  born: number;
  /** The body it struck last and when, for the renderer's arc; -1 before its first strike. */
  lastTargetId: number;
}

/**
 * A patch of burning ground: the sixth attack kind, and the only one that
 * changes the terrain rather than threatening a position.
 *
 * Its value over the lightning strike is duration. A strike punishes being
 * somewhere at one instant and is then gone, so the player steps out and
 * steps back. A fire **removes floor from play while it burns**, which shrinks
 * the arena, and enemy-driven terrain change is exactly what the interview
 * research names as the way to make level design matter to a melee fight —
 * ahead of adding obstacles.
 *
 * **It damages enemies too.** A hazard that only hurts the player is a tax; one
 * that hurts everything is a tool, and knocking a body into it is a use of the
 * terrain rather than a workaround. This is Hades' rule for magma, which
 * "hurts anybody who touches it".
 */
/**
 * A burn mark: no gameplay effect, only that the floor remembers.
 *
 * Permanence is the thirteenth item on Jan Willem Nijman's ordering in *The
 * Art of Screenshake*, ahead of camera work and screen shake, and the reason
 * is that a world which shows what happened in it reads as a place rather
 * than as a stage. Both the thrown flame and the lightning strike leave the
 * same mark, so the reading is uniform and one decal serves both.
 *
 * It fades rather than persisting to the end of the room. A room of 30 to 40
 * seconds can take several strikes, and accumulating marks would collide with
 * the rule that a floor decal must be ignorable at a glance.
 */
export interface Scorch {
  alive: boolean;
  x: number;
  y: number;
  radius: number;
  lifeMs: number;
  maxLifeMs: number;
}

/**
 * A ground line that erupts (`rift`, research §3.1): a capsule from the
 * caster toward the player, growing through its telegraph and live for a
 * moment. Fixed the instant it is drawn; it never re-aims.
 */
export interface Rift {
  alive: boolean;
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  /** Counting down while the crack grows; then `activeMs`, then the scar. */
  teleMs: number;
  teleMaxMs: number;
  activeMs: number;
  scarMs: number;
  /** In hearts. */
  damage: number;
  /** Whether this rift has already struck the player. */
  struck: boolean;
  /** A bolt from the sky rather than a crack in the floor (the king's storm): the same circle, drawn and heard as lightning. */
  bolt?: boolean;
  /** A stone out of the roof (the king's fall into phase III, `BOSS_METEOR_MS`): the same circle, drawn and heard as rock. */
  rock?: boolean;
  /** A bolt of the king's call at a phase change rather than his storm: drawn violet, the same blow. */
  summon?: boolean;
}

/**
 * A delayed seed (`mine`, research §3.2): inert, then armed, then a burst on
 * proximity or when its fuse runs out. It outlives the dash that crossed it.
 */
export interface Mine {
  alive: boolean;
  x: number;
  y: number;
  /** Inert while positive; armed after. */
  inertMs: number;
  /** Goes out, harmlessly, when this runs out unless something set it off. */
  fuseMs: number;
  /** Set off and about to burst while positive; see `MINE_PRIME_MS`. */
  primeMs: number;
  /** After detonating: the burst's flash. */
  burstMs: number;
  owner: number;
  damage: number;
  /** What planted it, for the record of what hurt the player. */
  by: string;
}

/**
 * A taut line between two things (`tether`, research §3.3). Always two
 * visible endpoints, which is what tells it apart from a sight line.
 *
 * - `ward`: a support's line to an ally, which heals it; cut by standing in it.
 * - `hook`: a thrown chain — aimed along a drawn line, flying, then dragging.
 * - `chain`: an elite snarecaster's line anchored across the floor; crossing it costs.
 * - `beam`: an elite sentinel's sight line made real, for an instant.
 */
export interface Tether {
  alive: boolean;
  kind: "ward" | "hook" | "chain" | "beam";
  /** The enemy at the near end. */
  from: number;
  /** The enemy at the far end, or -1 for a point (`x1, y1`). */
  to: number;
  x1: number;
  y1: number;
  phase: "aim" | "fly" | "hold" | "drag" | "live";
  ms: number;
  /**
   * The king's hook only: when on his fight clock (`Enemy.bossFightMs`) it
   * leaves the floor. The aim counts down in steps, and a step frozen by
   * hitstop is not counted while his clock — the music's — runs on, so a
   * freeze inside the aim threw the chain late and off the beat. It is set
   * from this before every step instead.
   */
  dueAt?: number;
  /** How long the player has stood in a ward line, toward cutting it. */
  cutMs: number;
  damage: number;
  /**
   * A **conduction pulse** running out along a ward line, in ms remaining
   * (0 when none). The toll refills the shield at the far end instantly; this
   * is the light that travels from the ringer to the ally to say so, and the
   * shield is drawn popping full when it arrives. Sim-side so the renderer
   * does not have to guess when a toll happened.
   */
  pulseMs: number;
}

/** An arcing throw with a landing ring (`lob`, research §3.4). The landing point is fixed at release. */
export interface Lob {
  alive: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  flightMs: number;
  /**
   * What it does on landing: a burst in a circle, a patch of burning ground,
   * or — the brooder's coal — a body (doc 019).
   */
  lands: "burst" | "fire" | "hatch";
  radius: number;
  damage: number;
  from: EnemyId;
}

/**
 * The ringing a bell-clap leaves behind (doc 005, the bellringer).
 *
 * It used to be a cold patch that slowed the *player*, and it was the one
 * effect in the game nobody could name: a tint on the floor that took a
 * quarter of the walk away for no reason the player could see. A support
 * body's lingering effect belongs on the bodies it supports, so the patch
 * **hurries its allies** instead — a rusher that arrives a beat early is a
 * thing the player can read off the rusher.
 *
 * It is deliberately **not drawn on the floor**: the cue is on the bodies
 * that are inside it (`Enemy.hastedMs`), because that is where the effect is.
 */
export interface HasteField {
  alive: boolean;
  x: number;
  y: number;
  radius: number;
  lifeMs: number;
  maxLifeMs: number;
}

/**
 * An **expanding ring of broken ground** (doc 005, the boss's slam).
 *
 * A filled circle is a `Rift`, and a filled circle is a move whose answer is
 * "be elsewhere". This is the other question: the ground breaks at the impact
 * and the break *travels*, so the ground that is safe now is the ground that
 * kills in half a second and the ground that just killed is safe. The answer
 * is to dash **through** the band — the dash's i-frames are what crossing it
 * means — or to already be beyond its reach.
 *
 * Geometry is an annulus: live between `inner` and `inner + thickness`, with
 * `inner` growing at `speed` px/s until it passes `maxRadius`. A charge-up
 * (`chargeMs`) holds it at its birth radius first, which is the tell.
 */
export interface Shockwave {
  alive: boolean;
  x: number;
  y: number;
  /** Counting down before the ring starts to travel: the charge-up tell. */
  chargeMs: number;
  chargeMaxMs: number;
  /** Inner edge of the live band, in px. The leading edge is `inner + thickness`. */
  inner: number;
  thickness: number;
  /** px/s the band travels outward. */
  speed: number;
  /** The band is gone once its inner edge passes this. */
  maxRadius: number;
  /** In hearts. */
  damage: number;
  /** One hit per wave: a ring that has caught the player is spent. */
  struck: boolean;
  /** The props this wave has already broken stone off (`bossStrikesProps`), by index. */
  propsStruck?: number[];
  /**
   * A wave that is only a stretch of the ring — the king's sword wave (doc 020)
   * — facing this way, this many radians either side. Absent: the whole ring.
   */
  facing?: number;
  half?: number;
  /**
   * A wave that is a **straight edge** rather than an arc — the greatcleave's,
   * a vertical cut seen from above — this many px across, running along
   * `facing`: it hits a band `thickness` long and `width` wide that travels
   * out from (x, y), and does not widen as it goes.
   */
  width?: number;
  /**
   * The wake it is one stretch of (`layWake`): a run leaves many short edges
   * either side of it, one for each stretch of ground it crosses, and they
   * are one attack — the first to catch the player spends all of them.
   */
  wake?: WakeGroup;
  /** Which stretch of its wake this is, counted from where the run began: what a renderer stripes by. */
  wakeIndex?: number;
  /**
   * A wake the **player** laid (the Dash Slash, `layWake`): it cuts the
   * bodies it crosses rather than the player, once each across the whole
   * wake, and never breaks stone.
   */
  byPlayer?: PlayerWakeCut;
}

/** The stretches of one wake, which strike as one (`Shockwave.wake`). */
export interface WakeGroup {
  struck: boolean;
}

/** What a player's wake cuts with, shared by every stretch of it. */
export interface PlayerWakeCut {
  damage: number;
  element: string;
  powers: ElementPowers;
  proc: number;
  statusMult: number;
  spellIndex: number;
  /** Bodies already cut by this wake, by id: one cut each, however many stretches cross them. */
  hits: number[];
  /**
   * The shove, px/s before a body's size divides it: the run's cut throws a
   * body off its line, the wake throws it on the way the wake rolls. Heavy
   * on purpose — a Dash Slash parts a pack.
   */
  knock: number;
  /** Heavy enough, it staggers what it cuts (`spellStagger`). */
  weight: number;
  /** `momentum`: px the run goes on for each body its cut goes through, and how many more times it may. */
  momentumPx: number;
  momentumLeft: number;
  /** `undertow`: the wake draws bodies in to the line at this share of its shove, and the run only nudges. 0 for none. */
  pull: number;
  /** `finale`: the run's end throws its cut on ahead at this share of the cut, this far; 0 for none. */
  finaleShare: number;
  finaleReach: number;
  /** The run's own cut, which a `finale` throws a share of. */
  runDamage: number;
}

/**
 * **A wake being laid** (`layWake`): where the next stretch starts, which way
 * the run is going, and what each stretch is. The run drops a stretch every
 * `stepPx` it covers, centred where it now is, so each edge sets off the
 * moment the runner passes — the wake unfolds behind the runner rather than
 * appearing along the whole line at once.
 */
export interface WakeTrail {
  fromX: number;
  fromY: number;
  dirX: number;
  dirY: number;
  stepPx: number;
  /** How far off the line each edge rolls, px, from `inner`. */
  reachPx: number;
  inner: number;
  thick: number;
  speed: number;
  damage: number;
  /** Stretches laid so far. */
  laid: number;
  group: WakeGroup;
  byPlayer?: PlayerWakeCut;
}

/**
 * **A rotating arm**: a limb anchored on a body that lies still while it is
 * read and then sweeps a circle, cutting everything along its length.
 *
 * It is the one threat in the game whose safe place is *a direction to be
 * going in*. A ring says "be in a gap", a rift says "be off this line", a
 * shockwave says "dash the band" — an arm turning at a fixed rate says "run
 * the way it is turning, or dash through it", and that is footwork: the
 * answer changes every frame with where the arm is now.
 *
 * The anchor follows its owner, so an arm on a walking boss drags the whole
 * threatened disc around with it and standing still is never the answer.
 */
export interface Arm {
  alive: boolean;
  /** The body it grows out of; the anchor is kept on it each step. */
  owner: number;
  x: number;
  y: number;
  /** Where the limb points now, in radians. */
  angle: number;
  /** Radians per second, signed: which way it turns. */
  spin: number;
  /** The limb runs from `inner` to `length` out of the anchor. */
  inner: number;
  length: number;
  width: number;
  /** Lying still, drawn at full length, before it starts to turn. */
  teleMs: number;
  teleMaxMs: number;
  /** Turning. Once this is spent the limb withdraws. */
  activeMs: number;
  activeMaxMs: number;
  /** In hearts. */
  damage: number;
  /**
   * After a hit the limb cannot hit again until this is spent, so a player
   * caught by it is not shredded by the same sweep frame after frame — they
   * pay once and have their mercy frames to get out.
   */
  hitCooldownMs: number;
}

/** The warden's fire-shot, rolling out from its muzzle; see `stepFlame`. */
export interface Flame {
  alive: boolean;
  owner: number;
  x: number;
  y: number;
  aim: number;
  /** Its reach along each ray across the spread, each cut short by the first wall. */
  rays: number[];
  ms: number;
  /** Whether it has already struck the player: one hit a shot. */
  hit: boolean;
}

/** One cell of grass: whole until fire reaches it, burning for a while, then burnt for good. */
export interface GrassCell {
  readonly x: number;
  readonly y: number;
  /**
   * `catching` is the beat between a flame touching the grass and the grass
   * going up (`GRASS_CATCH_MS`): nothing burns yet, so a body that crosses
   * the grass as it is lit, or dashes through, is past it when it catches.
   */
  state: "grass" | "catching" | "burning" | "burnt";
  /** Time in its current state. */
  ms: number;
  /** Whoever lit it owns its fire, and the fire it spreads — for the kill's credit only. */
  owner: "player" | "enemy";
  /** Whether it has passed its fire on to its neighbours yet. */
  spread: boolean;
}

export interface Fire {
  /**
   * Who lit it. A fire burns everything that is not its owner: the summoner's
   * flame hurts the summoner's allies, and the player's `bloom` must not hurt
   * the player — a melee design makes them stand where their spells land, so
   * a self-burning fire spell is a fire spell that cannot be used.
   */
  owner: "player" | "enemy";
  /**
   * **What the ground does** (doc 006, the `field` shape): `fire` burns what
   * stands in it, as every patch always has; `poison` is a cloud that
   * poisons and slows what stands in it and burns nothing — it lights no
   * grass, feeds no cinderling and leaves no scorch.
   */
  element: "fire" | "poison";
  /**
   * A fire the grass lit. It does not light grass itself: the grass spreads on
   * its own clock. It burns **everyone**, the player who lit the grass too.
   */
  fromGrass: boolean;
  alive: boolean;
  x: number;
  y: number;
  radius: number;
  lifeMs: number;
  maxLifeMs: number;
  /** Per-patch damage clock, so two overlapping patches do not double-tick. */
  tickMs: number;
  damage: number;
  /**
   * Every element it carries, by gauge-filling power. `element` above is only
   * the loudest of these, for the renderer; this is what feeds the statuses.
   * See `ElementPowers`.
   */
  powers: ElementPowers;
  /** The damage multiplier of the build that made it; see `Enemy.statusMult`. */
  /** What one of these is worth to on-hit effects; see `Bullet.proc`. */
  proc: number;
  statusMult: number;
}

/**
 * A body's death, delayed: its spikes grow out of where it fell, hang, and
 * then fly in the eight compass directions. The delay is the answer — a
 * player who killed it at arm's length has the beat to step between two
 * spikes — and it is the lancer's own attack (drive, hang, fly) at its death.
 */
export interface DeathBurst {
  readonly x: number;
  readonly y: number;
  /** The body that died, kept for its archetype and affixes (the shots carry them). */
  readonly body: Enemy;
  readonly kind: "lance" | "volatile";
  /** How far out the spikes stand while they hang, and where they fly from. */
  readonly reach: number;
  readonly totalMs: number;
  /** The share of `totalMs` the spikes take to grow; they hang for the rest. */
  readonly growShare: number;
  ms: number;
}

export interface Enemy {
  id: number;
  archetype: EnemyId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  affixes: readonly EliteAffix[];
  /**
   * Another body put this one on the floor: a summoner's minion, a brooder's
   * hatchling. It pays no experience, because a tap that never runs dry is a
   * tap a run could farm levels out of (`run/levels.ts`).
   */
  summoned?: true;
  /** Pattern clock, in ms since the enemy became active. */
  patternMs: number;
  /**
   * Wind-up left before the shot this body has already decided to take.
   *
   * **Every** volley is telegraphed now, not only the first of a room. It used
   * to fire the moment its pattern clock came round, so after the opening
   * volley the shots arrived with no warning at all — and an aimed shot with
   * no wind-up cannot be dodged, it can only be pre-empted by already being
   * somewhere else. The `tele` pose exists for each ranged archetype and was
   * being shown for one 300 ms window per room.
   */
  telegraphMs: number;
  /** The boss's phase, 1..3; 1 for everything else. See `BOSS_PHASES`. */
  phase: number;
  /**
   * The boss's signature move in progress: a slam (a shockwave ring with a
   * safe centre), a leap (up, over, and down on a marked spot), a quake (the
   * sword into the floor and cracks out along the compass) or a hook (the
   * chain out, and the player reeled onto the greatsword). While one runs the
   * boss neither walks, swings nor shoots. See `stepBoss` in world.
   */
  /**
   * How long this boss has been fighting, in ms: the fight's **beat clock**
   * (doc 020). It runs through hitstop, so it is real time since the fight
   * began, which is the time the music plays in. Nothing he does climbs with it.
   */
  bossFightMs: number;
  bossCast: "none" | "slam" | "leap" | "quake" | "hook" | "storm" | "meteor";
  /** Time left in the current move, rederived every step from `bossCastEndAt` so hitstop cannot delay it. */
  bossCastMs: number;
  /** On `bossFightMs`: when the current move ends. */
  bossCastEndAt: number;
  /** On `bossFightMs`: when the current move's chain commits — the hook's throw. */
  bossCommitAt: number;
  /** On `bossFightMs`: when the blade being wound up comes down. */
  bossBladeAt: number;
  /**
   * On `bossFightMs`: when the next move, `bossNext`, is to be started so it
   * commits on the grid; -1 while none is queued. Absolute, because hitstop
   * advances the clock in jumps and a countdown would step over its window.
   */
  bossStartAt: number;
  bossNext: "none" | "slam" | "leap" | "quake" | "hook" | "storm";
  /** The blows still to come in the blade string in hand (`BossPhase.strings`). */
  bossString: import("../encounters/enemies.ts").BossBlow[];
  /** On `bossFightMs`: when the string's opening blow landed, which its blows are laid from; -1 before. */
  bossStringAt0: number;
  /** How many blows the string in hand has in all, the opening one included. */
  bossStringN: number;
  /** Whether the blade being wound up follows another in a string, and which blow of it. */
  bossLinked: boolean;
  bossLinkedBlow: import("../encounters/enemies.ts").BossBlow | null;
  /** Whether his hook has caught the player: when the drag ends, the slash it set up is wound up at once. */
  bossHooked: boolean;
  /** How many bolts of the storm in hand he has called down so far. */
  bossBolts: number;
  /**
   * Whether the string in hand is drawn mirrored, fixed by its opening cut:
   * the whole combination faces one way (the front and return sweeps
   * between them carry the sword back and forth), never a flip per blow.
   */
  bossComboFlip: boolean;
  /**
   * The rest between his turns: counts down to the moment he chooses the next
   * one (`chooseBossAct` in world.ts). Set when a turn ends, of whatever kind.
   */
  bossMoveMs: number;
  bossMoveIndex: number;
  /** The blade he has chosen and is walking in to throw; null when his turn is something else, or over. */
  bossBlade: MeleeKind | null;
  /** How long he has walked after `bossBlade` without reaching the player; past a limit he chooses again. */
  bossPlanMs: number;
  /** A volley turn: how much of it is left. He fires only inside one. */
  bossVolleyMs: number;
  /** What his last turn was, so the next is never the same one twice running. */
  bossLastAct: string;
  /** Whether he was in a turn last step: the edge out of one is where the rest starts. */
  bossBusy: boolean;
  /** The last phase whose adds have been called. */
  bossAddsPhase: number;
  /**
   * **The roar** at a phase change: time left in it. He stands where he is,
   * armour breaking off him, and roars; nothing he does and nothing done to
   * him counts until it is over — he cannot be hurt (`hurtEnemy`). 0 otherwise.
   */
  bossRoarMs: number;
  /**
   * **The call** after the roar: time left in it. The greatsword held up, the
   * phase's adds rising about him, and violet bolts called down after the
   * player a beat apart. He stands through it too, but can be struck.
   */
  bossSummonMs: number;
  /**
   * **Which meeting this is** (doc 022): the first audience in room 5, or the
   * final in the throne hall. Absent for the one fight he was before the
   * document — the bench, the lab and the tests that predate it.
   */
  bossScript?: BossScript;
  /**
   * His entrance into the first audience: he is up out of the room and comes
   * down on his mark as the meteor's landing does, but on nobody — no band, no
   * struck ground, no hurt (`stepBossMeteor`).
   */
  bossEntrance?: boolean;
  /** One of a destroy room's turrets (doc 025): bringing all of them down ends the fight. */
  objectiveTarget?: true;
  /** Room 10's guardian (doc 024): a warden that is the Frontier Veteran (`sim/guardian.ts`). */
  guardian?: GuardianState;
  /** Going back up out of the room at the end of the first audience (`stepBossMeteor`). */
  bossLeaving?: boolean;
  /**
   * Gone out of the room without dying: taken off the floor at the end of the
   * step, with nothing a death pays (`step`, the kill filter).
   */
  gone?: boolean;
  /** Where a leap comes down, fixed when it is marked. */
  bossTargetX: number;
  bossTargetY: number;
  /** In the air during a leap: nothing hits it, and it is not drawn on the floor. */
  airborne: boolean;
  /**
   * The leap: where it left the floor, and how high it is right now in px.
   * The renderer lifts the sprite by `bossLift` over the ground position the
   * sim has it at (under the mark while it is up; see `BOSS_LEAP_MS`).
   */
  bossFromX: number;
  bossFromY: number;
  bossLift: number;
  /**
   * How much further the king's dashcut runs, px (`MELEE_ATTACKS.dashcut`):
   * set at the commit to just past where the player stood, so a dash that
   * misses ends there rather than in the far wall.
   */
  dashLeftPx: number;
  /** The wake the dashcut's run is laying in phase III (`bossDashWake`), or null. */
  dashWake: WakeTrail | null;
  /** The hop back before the dashcut's windup, ms left (`stepBossHop` in world.ts). */
  bossHopMs: number;
  /** Distance to the player last step, for choices that depend on range. */
  gapPx: number;
  /**
   * The volley waiting on that wind-up.
   *
   * Held rather than recomputed, so the rhythm the pattern declared is
   * preserved and only shifted by the wind-up; the *aim* is still taken when
   * it actually fires, from the position the body last saw.
   */
  pending: readonly unknown[];
  /**
   * How much retreating this body has left before it has to hold, in ms.
   *
   * A `keep_distance` body could back away indefinitely, which made the
   * ranged archetypes uncatchable in practice: the player closes at 240 and a
   * shooter flees at 58, but a player who is also dodging and whose swing
   * halves their speed never quite arrives, and the shooter always has one
   * more step to take. An archer must not have a completely safe position,
   * and "one more step, forever" is one.
   *
   * So retreating is a budget. Spent, the body has to stand for a moment
   * before it can give ground again — and that moment is the window the
   * player has been closing for.
   */
  retreatMs: number;
  /** Counts down while winded, when the retreat budget has run out. */
  windedMs: number;
  /** Set while a summoner is between minions. */
  /**
   * What this body's hits cost the player, as a multiple (doc 019). 1 for
   * everything but an elite, which is `ELITE_DAMAGE`: an elite is the same
   * fight, and only the price of getting it wrong moves.
   */
  damageMult: number;
  summonMs: number;
  minions: number;
  /**
   * The second moves. A body with one attack is a body the player solves
   * once; each archetype has a second thing it does and these carry the
   * state for it: `closeIn` picks the tank's slash over its charge when the
   * player is on top of it, `blinkCooldownMs` paces the summoner's escape,
   * `strikesCast` alternates the turret between marking where the player is
   * and where they are going.
   */
  closeIn: boolean;
  blinkCooldownMs: number;
  /** Paces an emplacement's point-blank pulse; see `pulse` in `enemy.ts`. */
  pulseCooldownMs: number;
  /** The lancer's spikes, driven out and hanging: counts down to their flight. */
  spikeMs: number;
  strikesCast: number;
  /** The attack chosen at windup, held until it resolves; see `meleeSpec`. */
  meleeKind: MeleeKind | null;
  /**
   * The rhythm of the turn in hand (doc 005, "Rhythm per archetype").
   *
   * `windupMs` is how long *this* windup runs, which is the attack's own
   * figure scaled by the archetype's tempo and jittered a little. It is held
   * on the body rather than read back off the spec because the spec no longer
   * knows: the whole point is that two rushers do not wind up on the same
   * beat, and the tracking window is measured from the windup that is
   * actually running.
   */
  windupMs: number;
  /**
   * What an **unaware** body is doing, for the renderer to draw and for a
   * test to assert on. A room of bodies that have not noticed the player yet
   * is most of what the player sees before a fight starts, and a statue reads
   * as a prop or as a bug — so every idle role has something it is visibly
   * busy with, and this names it.
   *
   * - `still` — standing, between actions.
   * - `shift` — a sleeper turning over: the facing swings and the body nudges.
   * - `scan` — a guard sweeping its look across its post.
   * - `step` — a guard walking a tile or two off its post and back.
   * - `gather` — two unaware bodies drifting together to stand as a pair.
   * - `stir` — a sleeper with its head up, looking at something it half
   *   heard; it either settles or wakes when `stirMs` runs out.
   *
   * It is `still` for every awake body, whatever that body is doing.
   */
  idleAction: "still" | "shift" | "scan" | "step" | "gather" | "stir";
  /**
   * Counts down while a sleeper has its head up (`idleAction` of `stir`), and
   * runs negative afterwards as the cooldown before it may lift it again.
   *
   * The stir is a **stealth beat**: one readable moment between "it has not
   * seen me" and "it has", which a body that goes from asleep to charging in
   * a single frame does not give.
   */
  stirMs: number;
  /**
   * Set while a string is running, so an attack that is **always** a pair —
   * the claw — asks for its second blow once rather than on every blow of it,
   * which would be a body clawing forever.
   */
  strung: boolean;
  /** Attacks left in the string this body is in the middle of; see `COMBO`. */
  comboLeft: number;
  /**
   * A **sidestep**: a short lateral burst when the player commits to a swing
   * or a dash nearby. It is what makes a body read as reacting to the player
   * rather than as walking a line at them.
   */
  jukeMs: number;
  jukeX: number;
  jukeY: number;
  jukeCooldownMs: number;
  /**
   * **Planted to shoot.** A ranged body stops where it stands for its aim,
   * its shot and a beat afterwards, and moves for none of it.
   *
   * This replaces a rule that read well and played as nothing: a body inside
   * four tiles was allowed to shoot *only while standing still*, and every
   * ranged archetype in the roster strafes, so measured in a mixed room an
   * orbiter fired twice in thirty seconds and a summoner once. They were
   * cancelling themselves. Planting says the same thing the old rule meant to
   * — an archer may not shoot and reposition at once — as an action the body
   * takes rather than as a shot it silently loses, and the tail of the plant
   * is the window the player has been closing for.
   */
  plantMs: number;
  /** Burn, poison and slow, applied by elements. */
  burnMs: number;
  burnSources: number;
  poisonStacks: number;
  /** Fire and poison gauges, 0..1: filled by hits, the status's clock once it runs. */
  burnBuild: number;
  poisonBuild: number;
  /** The clock of a body standing in lava: it burns on each tick (`stepLava`). */
  lavaMs: number;
  /**
   * **One burning-ground toll at a time**, however many patches the body is
   * standing in. Counts down from `FIRE_TICK_MS` after a patch bills it; see
   * `resolveFires`.
   */
  groundBurnMs: number;
  /** The same toll for the player's poison clouds, on its own clock so a cloud and a fire both bill. */
  groundPoisonMs: number;
  /** The ice gauge, 0..1: hits fill it and slow the body; full, it freezes. */
  chillBuild: number;
  /** Frozen solid: it cannot move or act. Counts down; the gauge is its clock. */
  frozenMs: number;
  /**
   * **How hard the build that lit it burns or poisons**: the damage multiplier
   * of the spell whose hit filled the gauge (its level, and any affix that
   * multiplies damage). A status used to tick a flat `BURN_DPS` whatever lit
   * it, so a levelled, affixed damage-over-time spell ticked exactly as hard
   * as a level-one one and only its mana cost went up — levelling a dot spell
   * made it *worse*. See `applyElementTo` in `world.ts`.
   */
  statusMult: number;
  /** Holds the gauges a moment after a hit before they drain. */
  buildFedMs: number;
  /** Status damage not yet reported as a number, and the clock that reports it. */
  dotShown: number;
  dotShowMs: number;
  poisonMs: number;
  slowMs: number;
  spawnFadeMs: number;
  /** Counts down after damage so the renderer can flash the sprite. */
  hitFlashMs: number;
  /** The last eruption line (`Eruption.castId`) that hit it; a line hits a body once. */
  eruptionCastId: number;
  /** Carrying a `brand`. The next branded hit detonates it. */
  marked: boolean;
  /**
   * A `doom` mark (doc 006): how long until it bursts, what the burst deals,
   * how wide, and which key's spell laid it. While `doomMs` runs the body
   * cannot be marked again — a second hit is a hit, not a second payoff —
   * and a body that dies first hands the mark to `World.dooms`.
   */
  doomMs: number;
  doomDamage: number;
  doomRadius: number;
  doomSpell: number;
  /**
   * Carrying `contagion` (doc 006): the most bodies its poison jumps to when
   * it dies, and how far; 0 for none. Lasts while its poison does.
   */
  contagion: number;
  contagionReach: number;
  /**
   * Hit stun. While it runs the body does not move and its attack does not
   * advance; landing a hit **cancels** whatever it was doing.
   *
   * This is the single largest thing missing from how the enemies felt, and
   * the reason is that without it a hit changes nothing the player can see
   * beyond a number they cannot read: the body kept walking, kept winding up,
   * kept swinging. Damage that does not interrupt reads as damage that did not
   * land. Hades' rule is that most attacks inflict a small stun which
   * interrupts enemy attacks and movements, and that is what this is.
   */
  staggerMs: number;
  /**
   * Counts down after a **spell** has staggered this body, and refuses the
   * next one while it runs.
   *
   * A heavy spell's stagger is meant to be the payoff for a slow, expensive
   * cast; without a window it is a lock, because the cast can come round
   * again before the body has recovered and one key holds a body still for as
   * long as there is mana. The sword is exempt: its stagger is already paid
   * for by being in reach.
   */
  staggerImmuneMs: number;
  /**
   * How long this body has gone without attacking or making a **visible
   * threat move** — a sidestep, a step of the ring, a walk to a
   * fresh firing angle.
   *
   * A room holds a fixed number of attack turns, so most of its bodies are
   * not attacking at any moment and that is the design (doc 005). What is not
   * the design is that they look like they have forgotten the fight:
   * measured, an awake body spent 57% of its time waiting for a turn, and it
   * spent it hovering. Nothing awake may sit above `THREAT_CAP_MS` without
   * doing *something* the player can read.
   */
  threatMs: number;
  /** Where a ranged body is walking to take its next shot from, and when it re-picks. */
  postX: number;
  postY: number;
  postMs: number;
  /** How long it may still spend walking to that post before it simply stands. */
  relocateMs: number;
  /**
   * **Poise**: how much of a beating it takes before a hit interrupts it.
   * Hidden: there is no bar for it, only what a hit does — a hit it holds
   * through rings off it (`poise_hold`), and the hit that breaks it knocks
   * it into a long stagger (`poise_break`).
   *
   * It replaced armour, an outer pool of health that had to be spent before
   * the body could be interrupted, and was gone for good once spent: a heavy
   * body was unstoppable for two hits and then interrupted by every hit after,
   * so it could be held in stagger to its death. Poise comes back. It fills
   * again once the body has gone `POISE_RECOVER_MS` unhit, and after a break
   * the body cannot be broken again for `POISE_GUARD_MS`, so a heavy body is
   * interrupted by a burst of hits, not held down by a stream of them.
   *
   * Zero for most bodies: any hit interrupts them, as it always did.
   */
  poise: number;
  maxPoise: number;
  /** Time since the last hit on its poise; at `POISE_RECOVER_MS` it fills again. */
  poiseIdleMs: number;
  /** After a break, the time left before it can be broken again. Hits land; they neither wear it nor interrupt. */
  poiseGuardMs: number;
  /** Counts down after a break, for the flash that sells it. */
  poiseBreakMs: number;
  /**
   * Counts down while a charge is braking, in ms.
   *
   * A ram's ending needs weight. Letting the velocity decay on the ordinary
   * ramp took two seconds and read as drifting; zeroing it read as the body
   * being switched off. What it should be is a **hard stop** — a short,
   * violent deceleration with the mass visibly arriving — and that is a phase
   * of its own rather than a number, because the renderer has to lean the body
   * back and throw dust for exactly as long as it lasts.
   */
  brakeMs: number;
  /**
   * Set while a body has noticed the player but not yet engaged.
   *
   * Waking straight into a charge makes the fight start without an opening
   * beat, so the player is reacting before they know there is anything to
   * react to. A moment of *noticing* — planted, with a sound and a mark — is
   * what turns engagement into an event, and it is the "brief preparation
   * window" a rusher needs before it is fair.
   */
  alertMs: number;
  /**
   * Smoothed velocity, in px/s, which is what the body actually moves by.
   *
   * Steering produces a desired velocity and this ramps toward it. A body that
   * snaps to full speed on the frame it decides to move has no weight — it
   * reads as a sprite being slid across the floor rather than as something
   * with mass — and it also makes every enemy feel identical whatever its
   * speed, because the only difference is the size of the slide.
   */
  velX: number;
  velY: number;
  facing: number;
  /**
   * The last place this body looked, and how long until it looks again.
   *
   * Facing used to be re-aimed at the player every single frame, which reads
   * as a tracking turret: a room of creatures whose heads swivel in lockstep
   * with the player's movement, never wrong, never late. It is unnerving
   * rather than threatening, and it tells the player that nothing they do with
   * their position is hidden from anything.
   *
   * So a body **glances**. It samples where the player is every few hundred
   * milliseconds and turns toward that at its own turn rate, which means its
   * head is usually a little behind and occasionally quite wrong — and being
   * occasionally wrong is what makes it a creature.
   */
  lookX: number;
  lookY: number;
  glanceMs: number;
  /**
   * Position in this body's locomotion cycle, in ms.
   *
   * Nothing alive travels at a constant speed. Pursuit at a fixed velocity is
   * the oldest robotic tell there is — it is how a homing missile moves, and a
   * room of them reads as machinery whatever the sprites look like. A creature
   * pushes, settles, pushes again.
   *
   * The cycle is fast and its average is 1, so the balance the roster was
   * tuned at is untouched: only the texture of the movement changes.
   */
  gaitMs: number;
  /** Which way it is working around the player, flipped periodically. */
  strafe: 1 | -1;
  strafeMs: number;
  /** Measured velocity, for aim leading. */
  vx: number;
  vy: number;
  /**
   * Distance walked, in px, for the walk cycle.
   *
   * Integrated rather than derived from the clock so the cadence is tied to
   * the ground the body covers. A timed cycle slides its feet whenever the
   * speed changes, and every body ends up with the same gait whatever it
   * weighs; on distance, one stride length makes a rusher scurry and a tank
   * plod for free.
   */
  travelled: number;
  /** Knockback impulse, decaying; hits have to push or they read as nothing. */
  knockX: number;
  knockY: number;
  blockedMs: number;
  /**
   * How long this body has failed to get any closer to the player, in ms, and
   * the gap it was last measured at.
   *
   * `blockedMs` asks "did it move at all", which a body grinding on a corner
   * answers yes to — `moveSliding` slides it *along* the wall, so the counter
   * reset every frame and neither the flow-field fallback nor the unwedge
   * nudge ever fired. It ground back and forth on the corner for the rest of
   * the room.
   *
   * Making no progress is the honest test. It catches the corner, the pot, the
   * oscillation between a field direction and a slide that opposes it, and
   * whatever the next one turns out to be — because it measures the thing that
   * is actually wrong rather than one cause of it.
   */
  stuckMs: number;
  lastGap: number;
  nudge: Vec;
  /**
   * False until the player comes inside `aggro_range` with a clear line, the
   * enemy is hit, or a woken neighbour raises the alarm. A sleeping enemy
   * neither moves at the player nor fires.
   */
  awake: boolean;
  /** Where it was placed, so an unaware body wanders around home, not at you. */
  homeX: number;
  homeY: number;
  /**
   * Where an unaware body is walking, and how long it is pausing on arrival.
   *
   * A patrol with a destination, rather than a force toward a moving point.
   * The first version was the latter — a slow pull toward a spot orbiting
   * home — and because the pull was tiny the direction flipped every few
   * frames, so the body jittered in place and its facing spun to follow. It
   * read as a twitch. Walking somewhere and stopping reads as an animal.
   */
  wanderX: number;
  wanderY: number;
  wanderPauseMs: number;
  /** Melee attack cycle; see `MELEE` in `enemy.ts`. */
  attack: AttackPhase;
  attackMs: number;
  /**
   * Whether this body currently holds one of the room's attack tokens.
   *
   * See `ATTACK_TOKENS`. Held from the start of the windup to the end of the
   * recovery, and dropped immediately if the body is staggered or killed, so
   * a stagger does not only interrupt one attack — it hands the turn to
   * somebody else.
   */
  hasToken: boolean;
  /**
   * Whether this body holds one of the room's firing turns. See
   * `World.fireTokens`: held across the wind-up as well as the shot, because
   * the wind-up is when the player is being asked to move.
   */
  hasFireToken: boolean;
  /**
   * How long a ranged cast — a strike, a flame, a musket, a rift, a hook —
   * keeps its firing turn: through its own wind-up, which is when the player
   * is being asked to move, as a volley's turn covers its aim.
   */
  fireTokenMs: number;
  /** Set after an attack, so the same body does not immediately re-commit. */
  attackCooldownMs: number;
  /**
   * False until this body has committed to one attack in this room.
   *
   * **Its first attack does no damage.** Lars Lidén's rule from *Artificial
   * Stupidity: The Art of Intentional Mistakes* — have the enemy "miss the
   * first time", so the attack indicates its direction and timing without
   * costing the player anything. The whole shape of the attack is shown at
   * full strength; only the damage is withheld.
   *
   * It is the cheapest fairness there is. A player meeting an archetype for
   * the first time cannot know its reach, its arc or its rhythm, and the
   * genre's usual answer is to charge them a heart for finding out. This
   * teaches the same thing for free, once, and never again — and because the
   * body is committed and recovering either way, the free attack is also the
   * player's first opening.
   */
  hasAttacked: boolean;
  /** Direction locked at the end of the windup, so a lunge can be dodged. */
  lungeX: number;
  lungeY: number;
  /**
   * This enemy's melee hitbox, for the thrust, slash and whirlwind kinds. One
   * per body rather than a pool: a body is never mid-two-attacks, and twelve
   * boxes is nothing against the bullet pools.
   */
  swing: SwingBox;
  /** The lightning strike, the one attack kind that is not a swing. */
  strike: Strike;
  /**
   * A drawn action that is not a melee phase — a warden levelling its musket, a
   * bellringer striking its bell, a delver under the floor — named as the pose
   * the renderer draws, or "" for none. `poseMs` counts it down.
   */
  pose: string;
  poseMs: number;
  /** The expansion's own clock for its second move, per archetype (`attacks.ts`). */
  moveMs: number;
  /** How many times the ranged attack has fired, for patterns that alternate (the rifter's cross). */
  casts: number;
  /** A ward's healing on this body, as a share of its health a second; 0 when no ward holds it (`sim/attacks.ts`). */
  wardHeal: number;
  /**
   * How long this body is still hurried by a bell's ringing (`HasteField`).
   *
   * Set from the field each step it stands in one and counted down outside
   * it, so the cue on the body has a moment of fall-off rather than blinking
   * off at the edge. The renderer reads it; the movement reads it.
   */
  hastedMs: number;
  /**
   * The delver's cycle: on the surface, going under, travelling as a mound,
   * or coming up. Under and going under are untargetable (`airborne`).
   */
  delve: "surface" | "diving" | "under" | "emerging";
  delveMs: number;
  /** The mound's heading, locked when it goes under. */
  delveX: number;
  delveY: number;
  /** How long a bellringer has been without an ally to ward. */
  aloneMs: number;
  /**
   * What an unaware body is doing before it notices the player (research:
   * `docs/research/idle-pursuit-pacing.md`): standing guard and scanning,
   * walking a short beat, wandering near where it was placed, or asleep.
   */
  idleRole: "guard" | "patrol" | "idler" | "sleeper";
  /** Counting down to waking, when a neighbour's alarm is spreading to it. */
  wakeDelayMs: number;
  /** How long the player has been out of this body's sight, and how long it has searched. */
  lostMs: number;
  searchMs: number;
}

/**
 * A lightning strike: a marker on the ground, then a hit at that spot.
 *
 * Chosen over a laser because it is the purest form of the one thing no other
 * attack kind does — **it punishes a place rather than a moment**, so it is
 * the only attack that can take a foothold away from the player, and the only
 * one that makes them move when nothing is near them.
 *
 * Three properties fall out of the shape rather than needing rules. **The
 * marker is the telegraph**, and it shows exactly where, which a charge-up
 * pose cannot. **Tracking is not a question**: the spot is fixed when marked.
 * And **cover is no answer**, because it strikes from above, which is a
 * tactic nothing else in the roster can take away.
 */
export interface Strike {
  /** Counting down while the marker is on the ground and nothing has hit yet. */
  markMs: number;
  /** Counting down after the hit, for the flash. Damage is applied once. */
  flashMs: number;
  /** The marked spot, fixed when the marker is placed. */
  x: number;
  y: number;
  radius: number;
  damage: number;
}

/**
 * A melee enemy runs a loop rather than a state: close, wind up, commit,
 * recover. Standing still at contact range is what makes a chaser read as
 * furniture, and lunging without a windup makes it read as unfair. The
 * windup is the enemy's question and the dodge is the player's answer.
 */
export type AttackPhase = "approach" | "windup" | "lunge" | "recover";

/**
 * What the run has permanently improved about the player.
 *
 * Every player number in this file is a module constant, which was right while
 * there was nothing to grow them — and doc 003's `stat` door is exactly that.
 * So the constants stay the **baseline** and this is what a run multiplies
 * them by, rather than the constants becoming mutable and the reference values
 * being lost.
 *
 * Multipliers rather than flat additions, for the reason doc 013 gives about
 * mana: a flat figure goes proportionally worthless as the thing it adds to
 * grows, so the last upgrade a player finds would be the one that mattered
 * least. `maxHearts` is the exception and is flat, because hearts are counted
 * and a fraction of one is not a thing.
 */
export interface PlayerMods {
  speed: number;
  dashCooldown: number;
  dashRange: number;
  invuln: number;
  maxHearts: number;
  manaMax: number;
  manaRegen: number;
  manaPerHit: number;
  swordDamage: number;
  swordReach: number;
  swingRecovery: number;
  /** Segments on the rage gauge; two to start, one per `wrath` upgrade. */
  rageMax: number;
}

export function noMods(): PlayerMods {
  return {
    speed: 1, dashCooldown: 1, dashRange: 1, invuln: 1, maxHearts: 0,
    manaMax: 1, manaRegen: 1, manaPerHit: 1,
    swordDamage: 1, swordReach: 1, swingRecovery: 1,
    rageMax: 2,
  };
}

export interface Player {
  x: number;
  y: number;
  hearts: number;
  /** See `PlayerMods`: what the run has permanently improved. */
  mods: PlayerMods;
  invulnMs: number;
  mana: number;
  /**
   * A spell being wound up: the key it was pressed on (-1 for none), until it
   * leaves, and what it cost. Then the **recovery** runs: no other cast, and
   * movement at `castMoveScale` through both (`castTiming`).
   */
  castPending: number;
  castWindupMs: number;
  castCost: number;
  castRecoverMs: number;
  castMoveScale: number;
  /**
   * A `charge` spell being held (doc 006): the key (-1 for none) and how long
   * it has been held. Nothing is paid until the key comes up; a dash or a
   * stun puts the charge out at no cost. Movement runs at `castMoveScale`
   * for as long as it is held.
   */
  chargeKey: number;
  chargeMs: number;
  /**
   * The key whose charge was put out (a dash, a stun), ignored until it comes
   * up; -1 for none. Without it the key still held through the dash started
   * a fresh charge on the next step, and letting go then fired a tap the
   * player never asked for, at a whole cast's price.
   */
  chargeVoid: number;
  /** The ring a `land` dash comes down in, while it is in the air; see `Landing`. */
  landing: Landing | null;
  aim: Vec;
  facing: number;
  /** Remaining dash, and the direction it committed to when it started. */
  dashMs: number;
  /** Bodies the `slipstream` affix has fired at during this dash. */
  slipFired: number;
  /**
   * Remaining invulnerability from the dash, on its own clock.
   *
   * Separate from `dashMs` because it outlives the travel: derived from the
   * dash timer it could only ever end when the movement did, which is what
   * made the dodge unable to dodge anything.
   */
  dashIframeMs: number;
  /**
   * Knockback from the last hit taken, decaying. See `HURT_NUDGE`: mercy
   * frames alone leave the player standing in whatever hit them.
   */
  hurtX: number;
  hurtY: number;
  hurtMs: number;
  /**
   * Elemental **build-up**, 0 to 1, and the status it becomes.
   *
   * Fire and poison do not take a heart on touch. Standing in burning ground
   * or a poison pool fills the matching gauge; at full it empties and the
   * status begins — burning drains health for three seconds, poison for four
   * and slows — and a gauge that is not being fed drains back down. So a
   * quick crossing costs nothing but a rising bar over the player's head, and
   * lingering costs a status the player watched arrive. Health is fractional
   * for this reason: a heart is the unit the HUD shows, not the smallest
   * amount that can be lost.
   */
  burnBuild: number;
  poisonBuild: number;
  /** Set while the gauge was fed this step, so decay waits a moment. */
  burnFedMs: number;
  poisonFedMs: number;
  burnMs: number;
  poisonMs: number;
  /** The shared clock a status drains health on. */
  dotTickMs: number;
  /**
   * **Rage**, in segments, for the spin. Earned by the sword — a fraction per
   * connecting swing, more for a kill — and spent a whole segment at a time,
   * so the spin is something the fight itself pays for: a player who has been
   * swinging has it, a player who has been casting does not. Separate from
   * mana on purpose; on mana it competed with every spell and lost.
   */
  rage: number;
  /** How much longer than a swing the current swing lasts: 1, or the spin's. */
  swingStretch: number;
  /** Which turn of the spin the blade is on, so each turn may hit a body again. */
  spinTurn: number;
  /** A spin press waiting for the moment it can start; see `SPIN_BUFFER_MS`. */
  spinBufferMs: number;
  /**
   * The last spell key pressed, **kept for a moment** when the press could
   * not cast yet — another spell still recovering, a cooldown about to end —
   * so it goes the moment it can; -1 for none. One slot: a newer press
   * replaces it. See `SPELL_BUFFER_MS`.
   */
  spellBuffer: number;
  /** What is left of `spellBuffer`'s window, in ms. */
  spellBufferMs: number;
  /**
   * The **dash strike**: a spell that spends mana to move the body through
   * the bodies in its way, hurting each once, with mercy frames for the
   * travel. `strikeMs` is what is left of it; `strikeHits` the ids already
   * struck. The one spell that buys defence, which is what makes mana a
   * survival resource and not only a damage one.
   */
  strikeMs: number;
  strikeDamage: number;
  strikeRadius: number;
  /** The elements the dash cuts with, and the build behind it; see `Vortex`. */
  strikeElement: Element;
  strikeElementPower: number;
  strikePowers: ElementPowers;
  /** What a dash hit is worth to on-hit effects; see `Bullet.proc`. */
  strikeProc: number;
  strikeStatusMult: number;
  strikeHits: number[];
  /**
   * The wake a Dash Slash is laying as it goes (`layWake`), or null: the
   * sword held out ahead through the run, and either side of it the cut's
   * edge rolling off the line, one short stretch for every stretch run.
   */
  strikeWake: WakeTrail | null;
  /**
   * How long the player is still sliding, in ms.
   *
   * Ice does no damage — it takes away the ability to stop, which the feature
   * library described from the start and the simulation implemented as a
   * second spike strip. A movement game can charge for movement in a way that
   * is interesting; charging a heart for touching the floor is not it.
   */
  /**
   * How long the player cannot act, in ms.
   *
   * Taking control away is the most dangerous thing a design can do to a
   * player, and it is only fair here because of what already surrounds it:
   * **every stun is strictly shorter than `INVULN_MS`.** The player is
   * untouchable for the whole of it, so a stun costs them tempo and position
   * and never a heart — they lose their turn, not the fight.
   *
   * Only two things stun: a lightning bolt, which they were given nearly a
   * second of marked ground to leave, and a charge, which telegraphed for half
   * a second from five tiles away. Both are attacks the player was *told*
   * about, so being caught by one is a mistake with a consequence rather than
   * a tax on being in the room.
   */
  stunMs: number;
  /**
   * Being dragged by a snarecaster's hook: the player is carried toward
   * `dragX, dragY` and gets no input until it lets go.
   */
  dragMs: number;
  dragX: number;
  dragY: number;
  slipMs: number;
  /** Carried velocity while sliding, in px/s. */
  slideX: number;
  slideY: number;
  dashCooldownMs: number;
  dashX: number;
  dashY: number;
  /** Remaining swing, counting down through windup, active and recovery. */
  swingMs: number;
  /** The facing the swing locked when it started; it does not track. */
  swingFacing: number;
  /** Whether the player has swung yet: the first swing of all is never a chain's. */
  swung: boolean;
  /** What is left of the window in which the next swing continues the chain. */
  chainMs: number;
  /** Swings in the current chain, for the rest after `SWING_RUN` (see `SWING_BREATH_MS`). */
  swingRun: number;
  /** The rest the sword takes after a run of `SWING_RUN` swings; no swing while it lasts. */
  swingBreathMs: number;
  /** A `trail` spell running on the caster (doc 006), or null; see `Trail`. */
  trail: Trail | null;
  /** An `enchant` spell running on the sword, or null; see `Enchant`. */
  enchant: Enchant | null;
  /** A `stance` being held, or null; see `Stance`. */
  stance: Stance | null;
}

/**
 * **A `trail`** (doc 006): for `ms` more, a patch of the spell's ground is
 * dropped every `dropPx` of the caster's travel. Travel, not time: the
 * distance walked since the last patch is carried in `carriedPx`, measured
 * from `lastX, lastY`, so standing still drops nothing and a dash drops a
 * line of them. What each patch is, is `patch`.
 */
export interface Trail {
  ms: number;
  maxMs: number;
  dropPx: number;
  carriedPx: number;
  lastX: number;
  lastY: number;
  patch: {
    readonly radius: number; readonly lifeMs: number; readonly damage: number;
    readonly statusMult: number; readonly powers: ElementPowers; readonly proc: number;
    /** A poison spell's trail is a line of cloud, every other a line of fire; see `Fire.element`. */
    readonly element: "fire" | "poison";
  };
  spellIndex: number;
}

/**
 * **An `enchant`** (doc 006): for `ms` more, every sword swing also throws a
 * wave along the swing's facing — a `wave` bullet of these figures, reaching
 * `reachPx` and passing through every body — and the sword's own numbers do
 * not change. A recast renews it.
 */
export interface Enchant {
  ms: number;
  maxMs: number;
  damage: number;
  radius: number;
  speed: number;
  reachPx: number;
  weight: number;
  element: Element;
  elementPower: number;
  powers: ElementPowers;
  proc: number;
  statusMult: number;
  affixes: readonly AttachedAffix[];
  spellIndex: number;
  manaSpent: number;
}

/**
 * **A `stance`** (doc 006): for `ms` more the caster is slowed to
 * `moveScale` and cannot swing. The first enemy hit that would land is
 * cancelled and answered with a spin slash of `damage` within `radius` of
 * the caster; if nothing lands, it answers anyway at `expireShare` of it as
 * it ends. See `answerStance` in `world.ts`.
 */
export interface Stance {
  ms: number;
  maxMs: number;
  damage: number;
  radius: number;
  expireShare: number;
  moveScale: number;
  weight: number;
  element: Element;
  powers: ElementPowers;
  proc: number;
  statusMult: number;
  spellIndex: number;
}

export interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lifeMs: number;
  maxLifeMs: number;
  kind: "hit" | "kill" | "heal" | "pickup" | "muzzle";
}

export type WorldEventKind =
  | "player_hit" | "enemy_hit" | "enemy_killed" | "wave_spawned"
  | "room_cleared" | "shot" | "telegraph" | "hazard_tick" | "dash" | "pickup"
  | "reward_shown" | "reward_taken" | "portals_open" | "portal_entered"
  /** Health lost by a body, for damage numbers: `what` is hp or dot:<kind>. */
  | "damage"
  /**
   * A shot stopped by a wall, where it struck: `what` is who fired it (an
   * enemy archetype, or `player:<element>`), `facing` its travel.
   */
  | "bullet_wall"
  /** An enemy shot that ran out of life in the air. */
  | "bullet_spent"
  /** A cell of erupting ground went off: `what` is earth or fire. */
  | "eruption"
  /**
   * Experience from a kill, at the body it came off: `amount` is the points.
   * Published rather than left as a number on the world so a renderer can
   * make the bar jump by the right amount without diffing a total.
   */
  | "xp"
  /** A level was reached. `amount` is the new level. See `run/levels.ts`. */
  | "level_up"
  /**
   * A spell key was pressed and nothing came out. `what` is why —
   * `mana`, `cooldown`, `busy` or `empty`, as `SpellStep.refused` says it —
   * and `amount` is which of the three keys it was.
   *
   * Announced because **the player pressed a key**. The refusal was known
   * inside `stepSpells` and thrown away by `stepWorld`, so the bar sitting a
   * point or two under the cost looked exactly like a dropped input.
   */
  | "cast_refused"
  /**
   * The spin key was pressed with no rage charge banked. `what` is `rage`.
   * Said for the same reason as `cast_refused`: a key that does nothing
   * without a word reads as a dropped input.
   */
  | "spin_refused"
  /**
   * **A spell shape doing something that is not a hit** (doc 006), for the
   * renderer and the mixer: `what` is `orb` (an orb cast), `orb_strike` (an
   * orb's blow, from the orb at `x, y` to the body it struck), `boomerang_turn`,
   * `boomerang_caught`, `trail` and `enchant` (started or renewed on the
   * caster), `wave` (an enchant's wave thrown), `stance` (a guard raised),
   * `stance_guard` (a hit cancelled by it) and `stance_answer` (the spin slash;
   * `amount` is the share of the spell's damage it answered at, 1 or the
   * expiry share).
   */
  | "spell";

export interface WorldEvent {
  kind: WorldEventKind;
  x: number;
  y: number;
  /** Enemy archetype, bullet family or hazard id, whichever applies. */
  what?: string;
  amount?: number;
  /**
   * Which way the body was facing, in radians, for events that outlive it.
   * The death silhouette needs it and the simulation is the only thing that
   * still knows: by the time the renderer sees the event, the body is gone.
   */
  facing?: number;
}

export interface Input {
  readonly moveX: number;
  readonly moveY: number;
  readonly aimX: number;
  readonly aimY: number;
  readonly dash?: boolean;
  /**
   * Which spell key went down this frame, or null. An index rather than three
   * booleans because two spells cast on the same frame is not a state the
   * design has: a cast is a decision, and pressing two keys at once is one
   * decision arriving twice.
   */
  readonly spell?: number | null;
  /**
   * The `spell` press came from the **auto-cast assist**, not the player's
   * hand. Its cast keeps its windup and recovery — the timing, and one
   * spell at a time — but does not slow the caster: a stride the player is
   * making is not the assist's to break. The assist is opted into, beside
   * the damage multipliers, so being a little better than a hand press is
   * its to be.
   */
  readonly spellAuto?: boolean;
  /** The melee swing. Free, always available, and the mana source. */
  readonly swing?: boolean;
  /** Aim a newly started melee swing at the nearest enemy within its reach. */
  readonly autoMeleeAim?: boolean;
  /** The spin, on its own key: a full circle for `SPIN_MANA`. */
  readonly spin?: boolean;
  /**
   * Take a reward, or step through a portal. A **just-pressed edge**, like the
   * spell index and for the same reason: both are decisions the player cannot
   * take back, and neither may be bought by holding a key down.
   *
   * It exists because proximity alone was not enough. Walking onto a reward
   * took it, and the player is at their fastest in the seconds after a fight —
   * so the beat that is supposed to be a choice between three cards was
   * decided by whichever one happened to be under the foot they won on. A
   * portal was worse: a mistouch there ends the room.
   */
  readonly interact?: boolean;
}

export const NO_INPUT: Input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };

/**
 * What the room **measured**, as against what a simulator predicted about it
 * (design docs 002 and 011: the state Jev reads is facts, not verdicts).
 *
 * Every field here is a count or a duration of something that happened while
 * the player was playing. The labels the Director reads are buckets of these
 * and of nothing else (`run/observed.ts`), which is why they live on the world
 * rather than in the harness: the browser and the harness must measure the
 * same things in the same place or the two arms are not comparable.
 */
export interface WorldStats {
  /** Bodies this room has put on the floor, for the fight-room floor (doc 005). */
  enemiesSpawned: number;
  heartsLost: number;
  damageDealt: number;
  shotsFired: number;
  nearMisses: number;
  elapsedMs: number;
  /**
   * Spell keys **pressed** — counted on the key going down, not on every step
   * it is held — and how many of those presses the mana bar refused.
   */
  castPresses: number;
  castRefusedMana: number;
  /** Time the bar spent under the **cheapest** keyed spell's cost, in ms. */
  manaBelowKeyMs: number;
  /** Player projectiles that struck a body, against `shotsFired`. */
  shotHits: number;
  /** Of `damageDealt`, the share the blade did: what "fights close" measures. */
  swordDamage: number;
  /** Health lost by family, as `player_hit` names the cause. */
  hurtByRanged: number;
  hurtByMelee: number;
  hurtByHazard: number;
  /**
   * Health lost **per body**, keyed by the archetype the cause names
   * (`melee:tank`, `bullet:shooter`) or by the hazard's feature id.
   *
   * The three families above say what kind of thing took the health; this says
   * which one. A designer reading a run back wants "the tanks took two hearts
   * and everything else took one" rather than "melee took three", because the
   * first names a body to change and the second names a category.
   */
  hurtByEnemy: Record<string, number>;
  /**
   * The lowest the health bar reached this room. `heartsLost` is a total, so a
   * room the player finished at four hearts having passed through one reads
   * the same as a steady grind — and the close call is the thing a designer
   * most wants to know about.
   */
  heartsLow: number;
}

export interface World {
  tick: number;
  room: RoomPlan;
  player: Player;
  staff: Staff;
  slots: readonly (ItemInstance | null)[];
  /**
   * The three keyed spells (doc 013). Mutable in place because the cooldowns
   * live on them, and fixed at `SPELL_SLOTS` long so a key always maps to an
   * index whether or not anything is bound to it.
   */
  spells: (SpellSlot | null)[];
  enemies: Enemy[];
  playerBullets: Bullet[];
  enemyBullets: Bullet[];
  particles: Particle[];
  /**
   * Destructible scenery. It lives on the world rather than on the room plan
   * because breaking one changes the grid, and a room plan is shared between
   * replays of the same seed.
   */
  props: Destructible[];
  /**
   * Drops on the floor. A kill that produces nothing is a kill the player has
   * no reason to seek out beyond the door being locked, which makes a fight a
   * toll rather than a choice.
   */
  pickups: Pickup[];
  /** Coins collected this room, for the run to bank when it ends. */
  gold: number;
  /**
   * **The run's experience and the level it has reached** (`run/levels.ts`).
   *
   * Carried in at `createWorld` and carried out by the run, exactly as gold
   * and rage are, because the world is rebuilt every room and would otherwise
   * forget it. The level is derived from `xp` and kept beside it only so a
   * renderer and the level-up check do not each have to walk the table.
   */
  xp: number;
  level: number;
  /**
   * The staff's mana cap **before** the run's modifiers, so a level reached
   * mid-fight can re-derive the cap rather than multiply the already-modified
   * one and drift a point a level.
   */
  staffManaBase: number;
  /**
   * The modifiers the **stat cards** have given, without the level's share.
   *
   * `player.mods` is these plus the level (`withLevels`), recomputed on every
   * level-up. Keeping the card half separately is what stops a level being
   * applied twice: the run hands in what the cards did, and the level's
   * contribution is derived from a number rather than accumulated.
   */
  baseMods: PlayerMods;
  /**
   * True from the moment the room clears until the offer is answered.
   *
   * The simulation holds only the **gate**: while this is set nothing can
   * leave, and that is all it needs to know. Which card is offered, what it
   * says and what taking it does belong to the run and the UI — see
   * `exits.ts`. False for the whole room in the harness, which asks for worlds
   * with no offer because a measurement ends when the last enemy dies.
   */
  rewardPending: boolean;
  /**
   * The reward standing on the floor, or null. The player opens the offer by
   * standing next to it and pressing interact; see `exits.ts` for why there is
   * an object between the fight and the card screen at all.
   */
  rewardDrop: RewardDrop | null;
  /** The ways out. Placed at room start, shut until the offer is answered. */
  portals: Portal[];
  /** The doors this room offers, made into `portals` when the way out opens. */
  portalSpecs: readonly PortalSpec[];
  /**
   * Where something the player talks to stands — the vendors and the fountain
   * — which the portals open clear of. Set by the scene, which places them.
   * Without it the pre-boss stop's one door could rise on the fountain's cell,
   * under its sprite and inside its prompt: E drank instead of leaving, and
   * the boss door looked like it had never opened.
   */
  portalKeepClear: readonly { x: number; y: number }[];
  /**
   * The portal the player walked into, or null. The scene reads it and loads
   * the next room; the simulation does not know what a next room is.
   */
  exited: Portal | null;
  /**
   * What this room will offer on clearing, or null in the harness. Held so the
   * cards are decided before the fight (doc 003's reward pipeline) rather than
   * at the moment of clearing.
   */
  offer: RoomOffer | null;
  /** Burning ground, from the thrown-flame attack kind. */
  fires: Fire[];
  /**
   * The room's grass, a cell each (`stepGrass`): whole, burning, or burnt.
   * It burns once, and fire runs through it cell to cell.
   */
  grass: GrassCell[];
  /**
   * The grid bodies route on: the room's own, with lava as wall, so they go
   * round a channel rather than wading it. Sight lines and collision use the
   * room's grid; a body knocked into lava still burns.
   */
  pathGrid: Uint8Array;
  /** Spell vortices: pull points that drag bodies inward and tick on them. */
  vortices: Vortex[];
  /** Ground eruptions: the cells of a stone or fire line going off in turn. */
  eruptions: Eruption[];
  /** Summoned companions that follow the player and shoot. */
  pets: Pet[];
  /** Orbs cast by `orb` spells, pooled; see `Orb`. */
  orbs: Orb[];
  /** Runes left by the `ward` affix, which stop enemy projectiles. */
  wards: Ward[];
  /**
   * How hard this room presses (doc 019): the Director's pacing answer, as
   * the two knobs that decide it. The caps that make a fight safe are not
   * here — they stay in code, where an answer cannot reach them.
   */
  pacing: { readonly preRelease: number; readonly gapMs: number };
  /**
   * How many elites a **normal** room hides (doc 019): the Director's
   * `elite_presence`, converted and capped by `normalEliteCount`. An elite
   * room uses `affixes` instead — its door already promised it.
   */
  normalElites: number;
  /** What the affix draw is filtered against: the charter's caps and shares. */
  affixCtx: AffixContext;
  /** Bodies spawned as elites so far this room. */
  elitesPlaced: number;
  /** Bodies spawned this room carrying each affix, for the per-room caps in `AFFIXES`. */
  affixPlaced: Partial<Record<EliteAffix, number>>;
  /**
   * The player's difficulty settings: every point of damage the player deals
   * and every heart they lose is scaled by these. 1 is the game as tuned.
   */
  dealtMult: number;
  takenMult: number;
  /** A testing setting: the player loses no health at all, from anything. */
  invincible: boolean;
  /**
   * A testing setting, for the boss lab (the debug panel's BOSS tab): which of
   * the boss's own decisions are held. A held move rotation, blade or volley
   * is not started by the boss; `queueBossMove` and `forceBossBlade` start
   * one on demand, and it then plays exactly as it does in a fight. Absent in
   * every run, the harness and the bench.
   */
  bossHold?: { moves: boolean; blades: boolean; volleys: boolean };
  /**
   * Set while the boss has yet to enter — the king's entrance, when he is only
   * the throne's drawing (doc 020): the room is empty of bodies but not clear.
   */
  awaitingBoss?: boolean;
  /** The king's first audience, in room 5 (doc 022): the drop-in's state (`sim/audience.ts`). */
  audience?: AudienceState;
  /** Room 10's guardian fight (doc 024): seen whole from the first frame. */
  guardianRoom?: boolean;
  /** The room's objective in play (doc 025, `sim/objective.ts`). */
  objective?: ObjectiveState;
  /** Whether this room leaves a chest when it clears (doc 026). */
  chestDue?: boolean;
  /** The chest on the floor once the room has cleared (doc 026); `open` once the player has touched it. */
  chest?: { x: number; y: number; open: boolean };
  /**
   * Half the camera's view, px: what the player can see. A body fires only
   * from wholly inside it, and closes slower further off (`firePresence`).
   * Set by the camera; a default otherwise.
   */
  viewHalf: { x: number; y: number };
  /**
   * Where the camera's view is centred, px, or null to take it as centred on
   * the player. The camera trails the player and stops at the room's edge,
   * so the two part near a wall and during a dash, and a body measured from
   * the player could be off the screen and still count as in view.
   */
  viewCentre: { x: number; y: number } | null;
  /**
   * How the encounter reaches the floor: `waves`, released over the fight at
   * the spawn groups, or `camps`, all of it placed when the room starts, in a
   * few groups spread away from the entry, unaware, each waking as one
   * (`placeCamps`).
   */
  placement: "waves" | "camps";

  /** Sword hits counted toward each spell's `resonance` cast. */
  resonance: number[];
  /**
   * Casts owed by the `repeat` affix, each fired a beat after the last. A
   * repeat used to recurse inside the cast, which put the second copy in
   * the same frame, on the same aim, overlapping the first pixel for pixel
   * — it doubled the damage and was invisible. "Casts twice" has to be seen
   * twice.
   */
  /**
   * `repeat` echoes owed: the slot, when, and which copy (1 is the first).
   * `charge` and `volley` are the press's own figures — how far a `charge`
   * spell was held and how many shots a `charges` spell loosed — so an echo
   * is the cast that was made, not a fresh full one.
   */
  echoes: { slot: number; delayMs: number; n?: number; charge?: number; volley?: number }[];
  /** Dash cuts cast free, waiting for the next step; see `FreeStrike`. */
  freeStrikes: FreeStrike[];
  /** `doom` marks whose bodies died first, still counting down; see `LooseDoom`. */
  dooms: LooseDoom[];
  /** Marks left where fire burned out or lightning landed. */
  scorches: Scorch[];
  /** The expansion's attack kinds (`attacks.ts`). Small, so plain arrays pruned each step. */
  rifts: Rift[];
  mines: Mine[];
  tethers: Tether[];
  lobs: Lob[];
  hasteFields: HasteField[];
  shockwaves: Shockwave[];
  /** Rotating limbs, anchored on the bodies that grew them; see `Arm`. */
  arms: Arm[];
  flames: Flame[];
  /** Spikes growing out of bodies that just died, before they fly; see `DeathBurst`. */
  deathBursts: DeathBurst[];
  /** Kills in the current streak, and how long it stays open; see `killPays`. */
  streak: number;
  streakMs: number;
  /** True while a sword blow is landing, so a kill knows the sword made it; see `killPays`. */
  swordBlow: boolean;
  /** How long the room has held only unaware bodies; see `stepQuiet`. */
  quietMs: number;
  /** Waves not yet released, in schedule order. */
  pendingWaves: { atMs: number; spawns: { archetype: EnemyId; group: string; count: number }[] }[];
  affixes: readonly EliteAffix[];
  events: WorldEvent[];
  stats: WorldStats;
  rng: Rng;
  nextEnemyId: number;
  /** Numbers each eruption line (`Eruption.castId`); starts at 1. */
  nextEruptionCast: number;
  /** The spell key held last step, so a press is counted when it goes down (`castPresses`). */
  lastSpellKey: number | null;
  cleared: boolean;
  /**
   * Impact freeze, in ms. While positive the whole simulation holds still.
   *
   * Nijman's "sleep": one or two frames on a hit is below the threshold at
   * which a player reads it as a stutter, and above the threshold at which
   * they feel the collision land. Kept short deliberately, because Sakurai's
   * objection applies here with force: a freeze also stops the bullets the
   * player was already reading, so every frame of it is borrowed from them.
   */
  hitstopMs: number;
  /**
   * Camera shake as a single accumulator in [0, 1], after Eiserloh's trauma
   * model. Events add to it and it decays; the renderer squares it. One
   * accumulator rather than a shake per event is what stops a busy moment
   * from summing into a seizure, and the square is what lets a small hit and
   * a death share one scale without the small hit being visible noise.
   */
  trauma: number;
  /**
   * The player's swing hitbox. One, reused: a swing is never concurrent with
   * another swing, and an object that outlives the step is what lets a test
   * inspect the hitbox between ticks rather than inferring it.
   */
  swing: SwingBox;
  /**
   * Where the player has been, newest last, one entry per step.
   *
   * Enemies steer, aim and commit against a position **from this history**
   * rather than against the live one. Without it every body in the room was
   * reacting on the frame the player moved, while the player reacts in about
   * a quarter of a second — so the enemies were always ahead, their pursuit
   * was perfect, and a fight was a pile of things that had already turned to
   * face you. "Their reaction speed is far faster than mine" is not a
   * difficulty setting, it is an asymmetry, and this is where it lived.
   *
   * A ring buffer on the world rather than a per-enemy copy: one history
   * serves everybody, and each body reads it at its own depth so a group does
   * not react in unison.
   */
  playerTrail: { x: number; y: number }[];
  /**
   * Attack tokens left in the room.
   *
   * A body must take one to start an attack and returns it when the attack is
   * over, so **only this many things can be attacking at once** however many
   * are in the room. Everything else holds at striking distance and waits.
   *
   * This is the standard answer to the complaint that a fight is nothing but
   * running away, and the reason is arithmetic rather than taste: six bodies
   * that may each commit whenever they like will, often enough, all commit at
   * once, and there is no position that answers six simultaneous attacks. The
   * Arkham games cap it at two or three; a shared pool with acquire-and-return
   * is how it is normally built. What it buys beyond fairness is *legibility* —
   * some enemies engage while the rest reposition, which the player can read
   * as a rhythm instead of as noise.
   */
  attackTokens: number;
  /**
   * Volleys allowed in the air at once, across every ranged body in the room.
   *
   * The same principle as `attackTokens`, applied to shooting, and for the
   * same reason: the player's job is to cross the floor, and what stops them
   * is not any one pattern but **the sum of every pattern firing at once**.
   * Three shooters each behaving reasonably is unreasonable, and no rebalance
   * of a single archetype can fix that — it is a property of the room.
   *
   * At one, a room with three shooters delivers a third of the fire without a
   * single pattern number changing, and the fire it does deliver is legible:
   * one body is aiming, so there is one thing to read and one direction to
   * move. The rest are visibly holding, which is information rather than
   * noise.
   */
  fireTokens: number;
  /** The base firing-turn budget, before the scaling by awake bodies. */
  fireTokenCap: number;
  /** Where in the run this room is (1-based), for the ramp (doc 005). */
  roomIndex: number;
  /** The early economy's multiplier on a kill's coin drop; see `createWorld`. */
  coinBoost: number;
  /**
   * How many enemy bullets may be in the air before no body is given a turn
   * to fire. The turns cap how many bodies are shooting; this caps what they
   * have already shot, which a slow volley keeps in the room for seconds
   * after its turn is over.
   */
  flightBudget: number;
  /** Hazards tick on a shared clock that belongs to the world, not the module. */
  hazardTimerMs: number;
  /** Shared path to the player, recomputed when the player changes tile. */
  flow: FlowField | null;
  flowTile: readonly [number, number] | null;
  /** When the last wave after the opening was released; see `releaseWaves`. */
  lastWaveMs: number;
}
