/**
 * Live simulation state (design doc 008). Everything here runs in core at a
 * fixed 60 Hz step with no DOM and no Phaser, so the headless harness plays
 * the same game the player does rather than an approximation of it.
 *
 * Entities are mutated in place and recycled through pools: at 900 player and
 * 600 enemy bullets, allocating per frame would dominate the step.
 */
import type {
  Element, EliteAffix, EnemyId, ItemInstance, RoomPlan, Staff, MeleeKind } from "../types.ts";
import type { CastTree, CastUnit } from "../types.ts";
import type { Rng } from "../rng.ts";
import type { FlowField } from "./flow.ts";
import type { SwingBox } from "./melee.ts";
import type { SpellSlot } from "./spells.ts";
import type { Destructible } from "./props.ts";
import type { Pickup } from "./pickups.ts";
import type { Portal, RewardDrop, RoomOffer } from "./exits.ts";
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
  /** Payload carriers cast their child where they stop. */
  /** A carrier holds the unit it will cast where it stops (doc 006). */
  payloadUnit: CastUnit | null;
  /** Carriers keep flying through enemies until their own trigger fires. */
  passthrough: boolean;
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
  spellIndex: number;
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
  spellIndex: number;
  /** Counts down after a shot, for the attack pose. */
  attackMs: number;
  /** Where round the player it is wandering to, and when it picks the next spot. */
  wanderA?: number;
  wanderR?: number;
  wanderMs?: number;
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
 * - `ward`: a support's line to an ally, which armours it; cut by standing in it.
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
  /** How long the player has stood in a ward line, toward cutting it. */
  cutMs: number;
  damage: number;
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
  /** What it does on landing: a burst in a circle, or a patch of burning ground. */
  lands: "burst" | "fire";
  radius: number;
  damage: number;
  from: EnemyId;
}

/** A cool, still, non-damaging patch that slows the player (research §3.7). */
export interface SlowField {
  alive: boolean;
  x: number;
  y: number;
  radius: number;
  lifeMs: number;
  maxLifeMs: number;
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

export interface Fire {
  /**
   * Who lit it. A fire burns everything that is not its owner: the summoner's
   * flame hurts the summoner's allies, and the player's `bloom` must not hurt
   * the player — a melee design makes them stand where their spells land, so
   * a self-burning fire spell is a fire spell that cannot be used.
   */
  owner: "player" | "enemy";
  alive: boolean;
  x: number;
  y: number;
  radius: number;
  lifeMs: number;
  maxLifeMs: number;
  /** Per-patch damage clock, so two overlapping patches do not double-tick. */
  tickMs: number;
  damage: number;
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
   * safe centre) or a leap (up, over, and down on a marked spot). While one
   * runs the boss neither walks, swings nor shoots. See `stepBoss` in world.
   */
  bossCast: "none" | "slam" | "leap";
  bossCastMs: number;
  /** Counts down to the next signature move. */
  bossMoveMs: number;
  bossMoveIndex: number;
  /** The last phase whose adds have been called. */
  bossAddsPhase: number;
  /** Where a leap comes down, fixed when it is marked. */
  bossTargetX: number;
  bossTargetY: number;
  /** In the air during a leap: nothing hits it, and it is not drawn on the floor. */
  airborne: boolean;
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
  /** Burn, poison and slow, applied by elements. */
  burnMs: number;
  burnSources: number;
  poisonStacks: number;
  /** Fire and poison gauges, 0..1: filled by hits, the status's clock once it runs. */
  burnBuild: number;
  poisonBuild: number;
  /** The ice gauge, 0..1: hits fill it and slow the body; full, it freezes. */
  chillBuild: number;
  /** Frozen solid: it cannot move or act. Counts down; the gauge is its clock. */
  frozenMs: number;
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
  /** Carrying a `brand`. The next branded hit detonates it. */
  marked: boolean;
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
   * Armour: an outer pool that absorbs damage and, while it lasts, makes the
   * body immune to hit stun.
   *
   * The first version of this was permanent immunity on one archetype, and
   * that was wrong for a reason worth keeping: an enemy whose state the player
   * cannot touch is an obstacle, not an opponent. The player could choose when
   * the tank committed and nothing about how it ended.
   *
   * Hades' answer is that armour is an **extra health bar** — immune while it
   * holds, ordinary once it is gone — so the right to interrupt is something
   * the player earns two hits into the fight rather than something the design
   * withholds. It also gives the tank two phases out of one stat: unstoppable,
   * then answerable.
   */
  armour: number;
  maxArmour: number;
  /** Counts down after the armour breaks, for the flash that sells it. */
  armourBreakMs: number;
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
  /** Armour granted by a ward, on top of the body's own; removed when the ward goes. */
  wardArmour: number;
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
  /** Index into the parsed cast tree's units. */
  castIndex: number;
  castTimerMs: number;
  cooldownMs: number;
  firing: boolean;
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
   * The **dash strike**: a spell that spends mana to move the body through
   * the bodies in its way, hurting each once, with mercy frames for the
   * travel. `strikeMs` is what is left of it; `strikeHits` the ids already
   * struck. The one spell that buys defence, which is what makes mana a
   * survival resource and not only a damage one.
   */
  strikeMs: number;
  strikeDamage: number;
  strikeRadius: number;
  strikeHits: number[];
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
  /** Standing in a slow field this step; read by the movement. */
  slowed: boolean;
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
  /** Health or armour lost by a body, for damage numbers: `what` is hp, armour or dot:<kind>. */
  | "damage"
  /**
   * A shot stopped by a wall, where it struck: `what` is who fired it (an
   * enemy archetype, or `player:<element>`), `facing` its travel.
   */
  | "bullet_wall"
  /** An enemy shot that ran out of life in the air. */
  | "bullet_spent";

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
  readonly fire: boolean;
  readonly dash?: boolean;
  /**
   * Which spell key went down this frame, or null. An index rather than three
   * booleans because two spells cast on the same frame is not a state the
   * design has: a cast is a decision, and pressing two keys at once is one
   * decision arriving twice.
   */
  readonly spell?: number | null;
  /** The melee swing. Free, always available, and the mana source. */
  readonly swing?: boolean;
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

export const NO_INPUT: Input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false };

export interface WorldStats {
  heartsLost: number;
  damageDealt: number;
  shotsFired: number;
  nearMisses: number;
  elapsedMs: number;
}

export interface World {
  tick: number;
  room: RoomPlan;
  player: Player;
  staff: Staff;
  slots: readonly (ItemInstance | null)[];
  tree: CastTree;
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
  /** Spell vortices: pull points that drag bodies inward and tick on them. */
  vortices: Vortex[];
  /** Summoned companions that follow the player and shoot. */
  pets: Pet[];
  /** Runes left by the `ward` affix, which stop enemy projectiles. */
  wards: Ward[];
  /** A normal room's stray elite's affixes, empty for none; see `strayEliteFor`. */
  strayElite: readonly EliteAffix[];
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
  /** Sword hits counted toward each spell's `resonance` cast. */
  resonance: number[];
  /**
   * Casts owed by the `repeat` affix, each fired a beat after the last. A
   * repeat used to recurse inside the cast, which put the second copy in
   * the same frame, on the same aim, overlapping the first pixel for pixel
   * — it doubled the damage and was invisible. "Casts twice" has to be seen
   * twice.
   */
  echoes: { slot: number; delayMs: number }[];
  /** Marks left where fire burned out or lightning landed. */
  scorches: Scorch[];
  /** The expansion's attack kinds (`attacks.ts`). Small, so plain arrays pruned each step. */
  rifts: Rift[];
  mines: Mine[];
  tethers: Tether[];
  lobs: Lob[];
  slowFields: SlowField[];
  flames: Flame[];
  /** Spikes growing out of bodies that just died, before they fly; see `DeathBurst`. */
  deathBursts: DeathBurst[];
  /** Kills in the current streak, and how long it stays open; see `killPays`. */
  streak: number;
  streakMs: number;
  /** How long the room has held only unaware bodies; see `stepQuiet`. */
  quietMs: number;
  /** Waves not yet released, in schedule order. */
  pendingWaves: { atMs: number; spawns: { archetype: EnemyId; group: string; count: number }[] }[];
  affixes: readonly EliteAffix[];
  events: WorldEvent[];
  stats: WorldStats;
  rng: Rng;
  nextEnemyId: number;
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
  /** Hazards tick on a shared clock that belongs to the world, not the module. */
  hazardTimerMs: number;
  /** Shared path to the player, recomputed when the player changes tile. */
  flow: FlowField | null;
  flowTile: readonly [number, number] | null;
  /** When the last wave after the opening was released; see `releaseWaves`. */
  lastWaveMs: number;
}
