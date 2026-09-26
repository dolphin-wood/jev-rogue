/**
 * The arc melee swing (design doc 013).
 *
 * Every number here is measured from a shipped game rather than chosen, because
 * the one question this module exists to answer is whether a reach of 1.8 tiles
 * feels right in a room 19 tiles wide, and that question is only meaningful if
 * everything else is calibrated.
 *
 * **Geometry, from A Link to the Past's own tables.** The arc is 80 degrees
 * wide, not the 180 the folklore claims; the wide cleave in that game is the
 * spin attack, gated behind 48 frames of charge. Tip radius runs 17 to 29 px
 * on a 16 px tile, which is about 1.8 tiles.
 *
 * **Choreography, from bobbylight/ZeldaJS**, whose gameplay logic is
 * frame-counted and therefore ports directly. A 15-frame swing in which only
 * frames 4 to 11 carry a hitbox: under half the animation does anything, and
 * that is what makes the attack a commitment rather than a spray.
 *
 * **The hitbox is a spawned entity carrying a `hitid`**, not a per-frame query
 * against the player's position. Nuclear Throne's `Slash`, CrossCode's proxies
 * and Oracle of Ages all converge on this, and it suits a fixed-timestep
 * headless simulation better because the hitbox is state a test can inspect
 * between ticks.
 */
import { TILE_PX } from "../types.ts";
import { PLAYER_RADIUS } from "./types.ts";
import type { Enemy, Player, Strike, Vec, World } from "./types.ts";
import { throwWave } from "./shapes.ts";

/* -------------------------------- constants ------------------------------- */

const FRAME_MS = 1000 / 60;

/** Frames 0-3: no hitbox. The player's own tell. */
export const SWING_WINDUP_MS = 4 * FRAME_MS;
/** Frames 4-11: the only window with a hitbox. */
export const SWING_ACTIVE_MS = 8 * FRAME_MS;
/** Frames 12-14, then frame 15 releases the player. */
export const SWING_RECOVER_MS = 4 * FRAME_MS;
export const SWING_TOTAL_MS = SWING_WINDUP_MS + SWING_ACTIVE_MS + SWING_RECOVER_MS;
/**
 * How soon after a swing ends the next one still continues the chain, and
 * the conjured blade is still out. Long enough for a player tapping or
 * holding the key to be chaining, short enough that a swing after walking
 * somewhere summons it again.
 */
export const SWING_CHAIN_MS = 350;

/**
 * **Three swings — a cut, a cut back, a thrust — then the sword rests.**
 *
 * A held key used to swing forever at
 * one swing every 16 frames, faster than any windup in the roster, so a
 * player standing still and holding it killed most bodies before their first
 * turn and never had to move. Slowing the swing would cost what makes it feel
 * good, so each swing keeps its speed and the *run* is bounded instead, after
 * Hades, whose combo ends in a recovery the enemies' attacks land in.
 *
 * The run is a shape the player can see coming, after Hades' swing, chop and
 * thrust: the second cut crosses back the way the first came, and the third
 * is a thrust straight along the facing — narrower, longer, harder and
 * heavier, the finisher the rest follows. The rest is after the third swing
 * of a chain (`SWING_CHAIN_MS`) ends; the player walks at full pace through
 * it, and a dash clears it — so the way to keep the blade going is to move.
 */
export const SWING_RUN = 3;
export const SWING_BREATH_MS = 400;
/**
 * The thrust. Its steel starts short and the reach is mostly spread, so the
 * blade is seen to drive out across the active frames; it ends about a sixth
 * further than a cut. Half a cut's width, since it does not sweep.
 */
export const THRUST_STEEL = 0.8;
export const THRUST_SPREAD = 1.6;
export const THRUST_HALF_DEG = 14;
export const THRUST_DAMAGE = 1.5;
export const THRUST_KNOCKBACK = 1.6;

/**
 * Total coverage of one swing: the angle the blade's tip travels through.
 *
 * **Widened from the measured 80 degrees, deliberately.** A Link to the Past
 * sweeps 79.3 degrees to the sides, and that number drove the first version.
 * It produced a visual nobody could accept: an 80 degree arc at this reach is
 * 63 px long and 26 px thick, which is a stubby lozenge rather than a
 * crescent, and three attempts at drawing it failed for that geometric reason
 * rather than any bug.
 *
 * The cost of widening was measured rather than guessed. Across the room set,
 * geometric coverage roughly doubles from 3.5 to 6.9 cells, but **enemies
 * actually caught per connecting swing moves only from 2.36 to 2.60**, about
 * ten percent, because chasers cluster at their standoff distance and are
 * already inside the narrow arc. So the area is nearly free in practice, and
 * the reason the reference number was low does not transfer: ALttP's tile is
 * half the size of this one, so the same angle covers far less of its room.
 *
 * Split into an instantaneous blade and a sweep, because a swing is a small
 * hitbox travelling rather than a wide one appearing, and because a spin is
 * then the same primitive with more degrees.
 */
export const ARC_DEG = 170;
/** How wide the blade's hitbox is at any instant. */
export const BLADE_DEG = 34;
/** So the tip travels this far, and blade plus sweep is the total coverage. */
export const SWEEP_DEG = ARC_DEG - BLADE_DEG;
/**
 * Reach, split into the steel and the crescent that spreads past it.
 *
 * The sprite draws the character and the sword as one image, so a sword that
 * covers more ground without getting longer reads as wrong. The blade's reach
 * is therefore **fixed at what the sprite depicts**, and everything the affix
 * and stat systems add pushes the crescent's **outer** edge further out while
 * its inner edge stays at the steel.
 *
 * This is a spreading crescent and **not a projectile**: nothing detaches and
 * flies off. The band widens outward during the swing and how far it spreads
 * *is* the attack's range, which is the one thing a reach upgrade changes.
 *
 * The baseline total is the 1.8 tiles measured from ALttP. Past the steel the
 * renderer draws a **magic blade** out to the reach while the sword swings
 * (`drawMagicBlade` in the scene), so the range the player gets is the blade
 * they see, and a reach upgrade lengthens it.
 */
/**
 * **The blade swings about the body's centre**, which is drawn this far above
 * the footing. The hitbox and the crescent share it, so a swing is the same
 * circle whichever way it faces; enemies are drawn about their own centres,
 * so this is also where a swing meets them.
 */
export const SWING_ORIGIN_LIFT = 7;

export const BLADE_REACH = TILE_PX * 1.0;
export const SPREAD_BASE = TILE_PX * 0.8;
/** The measured baseline, preserved: blade plus the base projected edge. */
export const ARC_REACH = BLADE_REACH + SPREAD_BASE;

export const SWING_DAMAGE = 9;
/**
 * 80, down from 220.
 *
 * Measured with the player standing still and swinging at a body 26 px away:
 * every hit moved it about 16 px further off, so the third swing missed and
 * the player had to walk after their own target. A stationary turret slid
 * across the floor. Against a reach of 32 px that grows to 58, an impulse that
 * moves the target half the reach per hit means the player can never stand
 * and trade — which is the whole exchange doc 013 asks the melee design to
 * make possible.
 *
 * It was the mechanism behind nine two-minute timeouts in a twelve-run sweep,
 * all of them "cannot finish a turret". Feedback is what knockback is for and
 * a few pixels of shove is enough for that; interrupting the body is
 * `stagger`'s job, not the impulse's.
 */
export const SWING_KNOCKBACK = 80;

/**
 * Mana returned per connected hit, as a **fraction of the player's maximum**.
 *
 * A flat figure would kill the loop exactly when the build is most developed:
 * a late-run player with three times the cap would find that hitting things
 * barely moved the bar, so the reason to close distance would evaporate at the
 * point they had most invested in being able to.
 *
 * **0.035, down from 0.09.** At a ninth of the bar a swing paid for most of a
 * cast, so a player in melee range never ran out and mana stopped being a
 * limiter at all — nothing in the surveyed roguelikes hands back a resource
 * that fast as a baseline (`docs/research/combat-balance-references.md`). At
 * this rate **about two connecting hits fund one cast of a cheap spell**,
 * which is the exchange the design is for: closing is how you afford standing
 * away.
 *
 * **Mana is the limiter that binds.** A spell has a cooldown as well, and a
 * thing gated on two limiters is really gated on one — the other is slack and
 * silently does nothing. The cooldown is a floor on how fast one key may be
 * tapped (`spellCooldownMs`, a quarter second plus a little for a dear
 * spell); the bar is what says how many casts a fight contains. If a spell's
 * cooldown ever becomes the thing the player waits on, that spell is
 * mispriced, not well gated.
 */
export const MANA_PER_HIT_FRACTION = 0.06;

/**
 * Movement during a swing, by phase.
 *
 * The swing only ever **slows** the player's own movement, and never moves
 * them itself. A forward lunge — a swing with a direction held becoming a
 * step — is forced displacement: it moves the player somewhere they did not
 * choose, which reads as losing control. A flat heavy slow across the whole
 * swing reads as sludge. So the windup keeps enough to reposition, the active
 * frames most of the pace, and the recovery hands movement straight back.
 */
export const SWING_WINDUP_MOVE = 0.35;
export const SWING_ACTIVE_MOVE = 0.7;
export const SWING_RECOVER_MOVE = 1;

export type SwingPhase = "none" | "windup" | "active" | "recover";

/* ------------------------------- the hitbox ------------------------------- */

/**
 * One swing's hitbox. `hitIds` is the deduplication: a hitbox that lives for
 * eight frames must not hit the same body eight times, and recording who has
 * been hit is cheaper and more obvious than trying to make the geometry
 * exclusive.
 */
export interface SwingBox {
  active: boolean;
  /** Origin, captured at the start of the swing and held. */
  x: number;
  y: number;
  /**
   * Centre of the whole sweep, in radians, locked when the swing starts. It
   * does not track: a swing that follows its target is a homing grab.
   */
  facing: number;
  /** Half the blade's instantaneous width, in radians. */
  halfArc: number;
  /**
   * Total degrees the blade travels, signed by `sweep`. 50 for a normal swing;
   * a spin spell passes 360 times however many rotations it wants, which is
   * the reason this is a number rather than a constant.
   */
  sweepDeg: number;
  /** Where the blade is right now, in radians. Derived, not authored. */
  angle: number;
  /**
   * Where the blade was last step. The hit test covers the whole arc between
   * the two, so a blade that turns further in one step than it is wide — a
   * spin turns 37 degrees a step with a 34 degree blade — cannot pass over a
   * body without touching it.
   */
  lastAngle: number;
  /**
   * For an enemy attack, how long the telegraph will still follow the player.
   * Published on the box rather than left in `enemy.ts` because whether a
   * sidestep can work at all depends on it, and anything reading the box to
   * decide a dodge — the renderer, the reference player — would otherwise have
   * to re-derive it from timings it does not own.
   */
  trackingMs: number;
  /** Fixed, and what the character sprite depicts. */
  bladeReach: number;
  /**
   * How far the crescent spreads past the steel. **This is the attack's
   * range**, and the only part of it an upgrade changes.
   */
  spread: number;
  /**
   * How far the hitbox reaches right now: the steel, plus however much the
   * crescent has spread so far. Derived, not authored.
   */
  reach: number;
  damage: number;
  knockback: number;
  /**
   * Which way the blade crosses the body. **Every swing is the same motion**;
   * the sign only tracks which facing is drawn mirrored.
   *
   * Set from the facing by `sweepFor`, so the blade always travels the same
   * way relative to the body even though one facing is drawn mirrored. A spin
   * spell also reverses it.
   */
  sweep: 1 | -1;
  /** Whether this swing continues a chain (`SWING_CHAIN_MS`): the conjured blade is already out. */
  chained: boolean;
  /** The player's third swing of a run: a straight thrust, not a sweep (`SWING_RUN`). */
  thrust: boolean;
  hitIds: number[];
  ageMs: number;
}

export function makeSwingBox(): SwingBox {
  return {
    active: false, x: 0, y: 0, facing: 0, halfArc: 0, sweepDeg: 0, angle: 0, lastAngle: 0,
    trackingMs: 0, bladeReach: 0, spread: 0, reach: 0,
    damage: 0, knockback: 0, sweep: 1, chained: false, thrust: false, hitIds: [], ageMs: 0,
  };
}

/** Smallest signed angle from `a` to `b`, in radians. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Whether a body of radius `r` at `p` is inside the sector.
 *
 * The body's radius widens the sector rather than being tested as a point, so
 * a large enemy clipped by the edge of the arc is hit. Boghog's shmup rule
 * applies to melee too: a player should be able to hit something they are
 * standing next to without micro-adjusting in the heat of the moment.
 */
export function sectorHits(box: SwingBox, p: Vec, r: number): boolean {
  const dx = p.x - box.x;
  const dy = p.y - box.y;
  const dist = Math.hypot(dx, dy);
  if (dist > box.reach + r) return false;
  // Anything overlapping the origin is inside the sector whatever the angle.
  if (dist <= r) return true;
  const spread = Math.asin(Math.min(1, r / Math.max(dist, 0.001)));
  // Against the blade's *current* angle, not the centre of the whole sweep.
  return Math.abs(angleDelta(box.angle, Math.atan2(dy, dx))) <= box.halfArc + spread;
}

/**
 * `sectorHits` over the arc the blade crossed this step, from `lastAngle` to
 * `angle`, rather than at the one angle it ended on.
 */
export function sweptHits(box: SwingBox, p: Vec, r: number): boolean {
  const dx = p.x - box.x;
  const dy = p.y - box.y;
  const dist = Math.hypot(dx, dy);
  if (dist > box.reach + r) return false;
  if (dist <= r) return true;
  const margin = box.halfArc + Math.asin(Math.min(1, r / Math.max(dist, 0.001)));
  // How far the blade travelled, in its own direction of travel.
  const travelled = Math.abs(box.angle - box.lastAngle);
  if (travelled + margin * 2 >= Math.PI * 2) return true;
  // The body's angle past the blade's start, measured the way it turns.
  let d = angleDelta(box.lastAngle, Math.atan2(dy, dx)) * Math.sign(box.sweep || 1);
  if (d < -margin) d += Math.PI * 2;
  return d >= -margin && d <= travelled + margin;
}

/* -------------------------------- the swing -------------------------------- */

/**
 * Where in the swing the player is, in **unstretched** ms.
 *
 * A spin runs the same three phases as a swing, several times longer, so the
 * phase clocks read the elapsed time divided by the stretch: every function
 * below keeps its constants and the spin simply plays them slowly.
 */
export function swingElapsed(p: Player): number {
  return SWING_TOTAL_MS - p.swingMs / Math.max(1, p.swingStretch);
}

export function swingPhase(p: Player): SwingPhase {
  if (p.swingMs <= 0) return "none";
  const elapsed = swingElapsed(p);
  if (elapsed < SWING_WINDUP_MS) return "windup";
  if (elapsed < SWING_WINDUP_MS + SWING_ACTIVE_MS) return "active";
  return "recover";
}

export function canSwing(p: Player): boolean {
  if (p.dashMs > 0) return false;
  if (p.swingBreathMs > 0) return false;
  // A stance holds the sword (doc 006): the guard is the key's, not the blade's.
  if (p.stance) return false;
  if (p.swingMs <= 0) return true;
  // The last swing of a run plays out whole, so its rest is never cancelled into.
  if (p.swingRun >= SWING_RUN) return false;
  /*
   * `swift_hand` cuts the recovery: the last part of it can be cancelled into
   * the next swing. It multiplied `mods.swingRecovery` and nothing read it.
   * Never for the spin, whose recovery is its commitment.
   */
  const cut = SWING_RECOVER_MS * (1 - (p.mods?.swingRecovery ?? 1)) * 4;
  return p.swingStretch === 1 && p.swingMs <= cut;
}

/**
 * The spin: two and a half turns of the blade, for one segment of **rage**.
 *
 * The one thing the sword cannot otherwise do is answer being surrounded; a
 * swing has a front and a rusher behind you is behind it. It was costed in
 * mana first, and on mana it competed with every spell and lost — so it has
 * a gauge of its own, filled by the sword and spent a whole segment at a
 * time (see `Player.rage`). It lasts three times a swing, so the turns can be
 * seen as turns; reaches a third further and hits harder, because a spin that
 * dealt swing damage would be a swing in a circle; and each body is struck
 * once however many times the blade passes it.
 */
export const SPIN_RAGE = 1;
export const SPIN_TURNS = 2.5;
export const SPIN_SWEEP_DEG = 360 * SPIN_TURNS;
export const SPIN_STRETCH = 3;
export const SPIN_REACH_MULT = 1.35;
/*
 * Per hit, and the spin hits once per turn: two and a half turns at 1.3 of a
 * swing each is what the rage buys — more than a swing per pass, because a
 * charge is earned and the spin should feel like spending it. The
 * knockback is cut to keep bodies inside the ring for the next pass.
 */
export const SPIN_DAMAGE_MULT = 1.3;
export const SPIN_KNOCKBACK_MULT = 0.5;

/**
 * Whether a spin can start now. **It cancels a swing at any point** —
 * windup, active or recovery — because it is the answer to being surrounded,
 * and an answer that waits for the swing in progress to finish arrives a
 * quarter second after the hit it was for. Only a dash, or a spin already
 * turning, holds it back.
 */
export function canSpin(p: Player): boolean {
  if (p.dashMs > 0) return false;
  if (p.stance) return false;
  return p.swingMs <= 0 || p.swingStretch === 1;
}

export function beginSpin(p: Player, world: World): boolean {
  if (!canSpin(p) || p.rage < SPIN_RAGE) return false;
  p.rage -= SPIN_RAGE;
  // Cut the swing in progress, so `beginSwing` starts clean. The spin is
  // not a swing of the run and cancels its rest: it goes whenever it is pressed.
  p.swingMs = 0;
  p.swingRun = 0;
  p.swingBreathMs = 0;
  beginSwing(p, world);
  p.swingRun = 0;
  p.swingStretch = SPIN_STRETCH;
  p.spinTurn = 0;
  p.swingMs = SWING_TOTAL_MS * SPIN_STRETCH;
  const box = world.swing;
  box.sweepDeg = SPIN_SWEEP_DEG;
  box.bladeReach = BLADE_REACH * SPIN_REACH_MULT * (p.mods?.swordReach ?? 1);
  box.reach = box.bladeReach;
  box.damage = SWING_DAMAGE * SPIN_DAMAGE_MULT * (p.mods?.swordDamage ?? 1);
  box.knockback = SWING_KNOCKBACK * SPIN_KNOCKBACK_MULT;
  return true;
}

/**
 * Starts a swing, taking its direction from the player's facing **now**.
 *
 * **Every swing is identical, including its direction.** An earlier version
 * ran a three-hit chain whose third hit did double damage with more reach,
 * after Moonlighter, and two others alternated which way the blade crossed
 * the body — the second after Carian Slicer, tried beside the 2D Zeldas'
 * one stroke repeated and judged worse. A combo asks the player to track
 * where they are in a sequence, and that attention is better spent on the
 * enemies. One motion, every time, is a thing the player never has to think
 * about.
 *
 * A swing that starts within `SWING_CHAIN_MS` of the last one ending, or
 * cancels its recovery, is marked `chained`. That changes nothing it does;
 * it tells the renderer the conjured blade is already out, so it is not
 * summoned again.
 *
 * Each swing locks its own direction and every swing re-aims, so the facing
 * keeps updating during one for the sprite and for the next, while this box
 * keeps the centre it was given. Letting the *live* hitbox follow the facing
 * would let a turning player sweep a full circle, which would dissolve the
 * point of a bounded arc.
 */
export function beginSwing(p: Player, world: World): void {
  if (!canSwing(p)) return;
  // Chained if it comes before the last swing has finished or soon after.
  const chained = p.swung && (p.swingMs > 0 || p.chainMs > 0);
  p.swingRun = chained ? p.swingRun + 1 : 1;

  p.swingMs = SWING_TOTAL_MS;
  p.swingStretch = 1;
  p.swingFacing = p.facing;

  const box = world.swing;
  box.active = false;
  box.x = p.x;
  box.y = p.y - SWING_ORIGIN_LIFT;
  box.facing = p.swingFacing;
  box.halfArc = ((BLADE_DEG / 2) * Math.PI) / 180;
  box.sweepDeg = SWEEP_DEG;
  box.angle = p.swingFacing;
  // `keen_edge` and `long_reach`, which were recorded and never read.
  box.bladeReach = BLADE_REACH * (p.mods?.swordReach ?? 1);
  box.spread = SPREAD_BASE;
  box.reach = box.bladeReach;
  box.damage = SWING_DAMAGE * (p.mods?.swordDamage ?? 1);
  box.knockback = SWING_KNOCKBACK;
  box.sweep = sweepFor(p.swingFacing);
  box.thrust = false;
  // The run's shape: the second cut comes back, the third is the thrust.
  if (p.swingRun === 2) box.sweep = box.sweep === 1 ? -1 : 1;
  else if (p.swingRun >= SWING_RUN) {
    box.thrust = true;
    box.sweepDeg = 0;
    box.halfArc = (THRUST_HALF_DEG * Math.PI) / 180;
    box.bladeReach *= THRUST_STEEL;
    box.spread = SPREAD_BASE * THRUST_SPREAD * (p.mods?.swordReach ?? 1);
    box.reach = box.bladeReach;
    box.damage *= THRUST_DAMAGE;
    box.knockback *= THRUST_KNOCKBACK;
  }
  p.swung = true;
  box.chained = chained;
  box.lastAngle = bladeAngle(box, p);
  box.hitIds.length = 0;
  box.ageMs = 0;
}

/**
 * Advances the swing and resolves hits.
 *
 * Returns the bodies struck this step in resolution order, which callers use
 * for events and effects. The order is deterministic — **nearest first, then
 * leftmost** — because a simulation that must reproduce from a seed cannot
 * leave "which of these two did the arc hit first" to array order. The rule is
 * Crypt of the NecroDancer's, and it is stated there as a game rule rather
 * than as an implementation detail.
 */
export function stepSwing(world: World, dtMs: number): Enemy[] {
  const p = world.player;
  const box = world.swing;

  if (p.swingMs <= 0) {
    if (p.chainMs > 0) p.chainMs -= dtMs;
    if (p.swingBreathMs > 0) p.swingBreathMs -= dtMs;
    box.active = false;
    return [];
  }

  p.swingMs -= dtMs;
  if (p.swingMs <= 0) {
    p.chainMs = SWING_CHAIN_MS;
    // The end of a run: the sword rests, and the chain after it starts afresh.
    if (p.swingRun >= SWING_RUN && p.swingStretch === 1) {
      p.swingBreathMs = SWING_BREATH_MS;
      p.swingRun = 0;
      p.chainMs = 0;
    }
  }
  box.ageMs += dtMs;
  // The swing is attached to the body. Anchoring it where the swing started
  // left the arc behind whenever the player kept moving, which is most of the
  // time now that the active frames allow 70% speed.
  box.x = p.x;
  box.y = p.y - SWING_ORIGIN_LIFT;
  const phase = swingPhase(p);
  const wasActive = box.active;
  box.active = phase === "active";
  box.lastAngle = wasActive ? box.angle : bladeAngle({ ...box }, { ...p, swingMs: p.swingMs + dtMs });
  box.angle = bladeAngle(box, p);
  box.reach = bladeReach(box, p);
  /*
   * The spin hits **once per turn**. The dedup list that makes a swing one
   * hit however many frames a body spends in it was making the spin one hit
   * too, across two and a half turns — a long swing with a long animation.
   * Clearing the list as the blade comes round again makes it a blender: a
   * body that stays inside is cut on every pass, and the knockback is small
   * so it stays inside.
   */
  if (p.swingStretch > 1 && box.active) {
    const t = Math.max(0, Math.min(1, (swingElapsed(p) - SWING_WINDUP_MS) / SWING_ACTIVE_MS));
    const turn = Math.floor(t * SPIN_TURNS);
    if (turn !== p.spinTurn) {
      p.spinTurn = turn;
      box.hitIds.length = 0;
    }
  }

  if (p.swingMs <= 0) box.active = false;
  /*
   * **An enchant's wave** (doc 006) leaves as the active window ends, once a
   * swing, whether or not the swing connected: the blade's tip has finished
   * its arc, and that arc is what flies on (`throwWave`). It is thrown by the
   * swing, not by a hit. The spin is the rage's move and throws none — a
   * wave is what a swing does under the enchant, and the spin is not a swing
   * the player chose to make four times a second. A swing cut off before its
   * window ends (a stance, a spin) has no finished arc and throws none.
   */
  if (wasActive && !box.active && p.swingMs > 0 && p.swingStretch === 1 && p.enchant) throwWave(world);
  if (!box.active) return [];

  const struck: Enemy[] = [];
  for (const e of world.enemies) {
    if (e.hp <= 0 || e.spawnFadeMs > 0 || e.airborne) continue;
    if (box.hitIds.includes(e.id)) continue;
    if (!sweptHits(box, e, e.radius)) continue;
    struck.push(e);
  }

  struck.sort((a, b) => {
    const da = (a.x - box.x) ** 2 + (a.y - box.y) ** 2;
    const db = (b.x - box.x) ** 2 + (b.y - box.y) ** 2;
    if (da !== db) return da - db;
    if (a.x !== b.x) return a.x - b.x;
    return a.y - b.y;
  });
  for (const e of struck) box.hitIds.push(e.id);
  return struck;
}

/**
 * Where the blade is, given how far through its active window the swing is.
 *
 * Travels from one end of the sweep to the other across the active frames, in
 * the direction `sweep` gives it, so alternate strikes cross the body the
 * other way. Outside the active window it sits at the start, which is what the
 * windup pose should read against.
 */
export function bladeAngle(box: SwingBox, p: Player): number {
  const elapsed = swingElapsed(p);
  const t = Math.max(0, Math.min(1, (elapsed - SWING_WINDUP_MS) / SWING_ACTIVE_MS));
  const half = ((box.sweepDeg / 2) * Math.PI) / 180;
  /*
   * **A slash, not a sweep.** At a constant rate the blade crossed its arc
   * like a broom; a cut is thrown — most of the arc in the first frames, then
   * the blade decelerating into its follow-through. Ease-out cubic: two
   * thirds of the arc by 30% of the active window. The spin keeps a constant
   * rate, because it is counted in whole turns.
   */
  const u = p.swingStretch > 1 ? t : 1 - Math.pow(1 - t, 3);
  return box.facing + box.sweep * (-half + u * 2 * half);
}

/**
 * How far the hitbox reaches at this instant.
 *
 * The steel is covered from the first active frame; the crescent spreads
 * outward across the active window, so a body at the far edge is struck
 * **later** than one next to the player. That is both readable and correct —
 * the player watches the crescent reach out and cross the gap.
 */
export function bladeReach(box: SwingBox, p: Player): number {
  // The spin is drawn as one ring at its full reach from the first turn, and
  // the hitbox is that ring: growing it across two and a half turns left the
  // first turn a third short of the light the player sees.
  if (p.swingStretch > 1) return fullReach(box);
  const elapsed = swingElapsed(p);
  const t = Math.max(0, Math.min(1, (elapsed - SWING_WINDUP_MS) / SWING_ACTIVE_MS));
  // On the blade's own curve (`bladeAngle`), so the crescent is as far out as
  // the blade is far round: a body at the arc's centre is reached as the blade
  // crosses it, not after.
  return box.bladeReach + box.spread * (1 - Math.pow(1 - t, 3));
}

/** Reach once the crescent has fully spread, which is what an upgrade sets. */
export function fullReach(box: SwingBox): number {
  return box.bladeReach + box.spread;
}

/**
 * How far the blade is pulled back from **rest** during the windup, in degrees.
 *
 * Anticipation, and the useful part of getting it wrong twice is what it says
 * about where anticipation belongs.
 *
 * The first version rotated the blade from rest all the way to the far end of
 * the arc, plus 26 degrees of overshoot. The arc is 136 degrees wide, so that
 * made the visible travel per swing about 230 degrees — out to one extreme,
 * across to the other, back to rest. Swung repeatedly that does not read as
 * attacking; it reads as **waving the sword side to side**, which is what was
 * reported.
 *
 * The blade is the wrong thing to carry it. A wide arc already spends most of
 * a circle on the stroke itself, so any pre-travel competes with the stroke
 * for the same motion. The **body** carries anticipation instead, and the art
 * for it already exists — `player_*_windup` is a drawn wind-up pose, used for
 * exactly these four frames.
 *
 * So the blade barely moves: 14 degrees back from where it rests, which at
 * this reach is a few pixels of tip travel. Enough to be a load, not enough to
 * be a stroke of its own. The 68 degree jump to the arc's start still happens
 * on the activation frame, and it is invisible because the crescent appears on
 * the same frame and is what the eye tracks.
 */
const ANTICIPATE_DEG = 14;

/**
 * Where the blade is **drawn**, through the whole swing rather than only while
 * it can hit something.
 *
 * `bladeAngle` answers the same question for the hitbox, and only for the
 * eight active frames, because outside them there is nothing to hit. That is
 * right for the simulation and not enough for the drawing: the sword is a
 * separate layer now, so the four windup frames and the four recovery frames
 * are eight frames of animation that were being spent holding still.
 *
 * Three phases, which are the three parts of any swing:
 *
 * - **Windup** pulls back past the start of the arc, easing *out* so it
 *   arrives at the extreme early and hangs there — the hold before a strike is
 *   what sells the strike.
 * - **Active** is `bladeAngle`, unchanged, so the drawing and the hitbox agree
 *   exactly on the frames where agreeing matters.
 * - **Recovery** eases from the end of the arc back to rest, easing *in* so
 *   the settle decelerates rather than stopping.
 *
 * Pure, and here rather than in the renderer, because "where is the blade"
 * should have one answer a test can read.
 */
export function drawnBladeAngle(box: SwingBox, p: Player, restAngle: number): number {
  const phase = swingPhase(p);
  if (phase === "none") return restAngle;

  const half = ((Math.abs(box.sweepDeg) / 2) * Math.PI) / 180;
  const back = (ANTICIPATE_DEG * Math.PI) / 180;
  const end = box.facing + box.sweep * half;
  if (phase === "windup") {
    const elapsed = swingElapsed(p);
    const t = Math.min(1, elapsed / SWING_WINDUP_MS);
    // Ease out: most of the load in the first frames, then a hold. The hold
    // before a strike is what sells the strike.
    const e = 1 - (1 - t) * (1 - t);
    return restAngle - box.sweep * back * e;
  }
  if (phase === "active") return bladeAngle(box, p);

  /*
   * Recovery **holds the blade where the stroke ended**.
   *
   * It used to ease back toward rest across the four recovery frames, which
   * was wrong in a way that was easy to misread as an art bug: the crescent is
   * drawn from the arc's start to the blade's angle, so a sword returning to
   * rest while the trail stayed out put the two on **opposite sides of the
   * body** for a fifth of a second. That is what "the fake sword is still
   * there" was — not a second sword, one sword and its own trail disagreeing
   * about where the sword was.
   *
   * Holding is also what a slash does. The blade finishes out where it landed;
   * the arm comes back afterwards, once the strike is over. The single-frame
   * return to rest happens when the swing ends, by which point the crescent
   * has faded and the body is back on its idle pose, so nothing is tracking
   * the blade closely enough to see it.
   */
  return end;
}

/**
 * Total degrees a swing covers: the blade's own width plus how far it travels.
 * A spin spell sets `sweepDeg` to 360 times its rotations, and this is what a
 * renderer uses to know how much trail to draw.
 */
export function totalCoverageDeg(box: SwingBox): number {
  return Math.abs(box.sweepDeg) + (box.halfArc * 2 * 180) / Math.PI;
}

/**
 * Configures a swing as a spin: the blade rotates `rotations` full turns
 * rather than crossing the body once.
 *
 * A spin is emphatically **not** a 360 degree sector appearing at once, which
 * would strike everything around the player in a single frame. It is the same
 * narrow blade travelling further, so it sweeps past bodies in sequence, and a
 * body already struck this rotation is skipped — the `hitIds` reset per turn
 * is what lets a multi-rotation spin hit the same target once per rotation.
 */
export function makeSpin(box: SwingBox, rotations: number): void {
  box.sweepDeg = 360 * rotations;
}

/* ------------------------------ attack kinds ------------------------------ */

/**
 * The five ways a thing can attack, and the point of the taxonomy is that each
 * is answered by a **different movement**: sideways out of a line, backwards
 * out of reach, away entirely, across a path, and off a place and staying off.
 *
 * A projectile can only invalidate standing in its path, which is one tactic,
 * and is why a roster whose every member shoots reads as a roster of one.
 */
export type AttackKind =
  | "thrust" | "slash" | "whirlwind" | "charge" | "projectile" | "lightning";

export interface MeleeAttackSpec {
  readonly kind: import("../types.ts").MeleeKind;
  /** Instantaneous blade width, in degrees. */
  readonly bladeDeg: number;
  /** Degrees the blade travels. Zero for a thrust; 360 per turn for a spin. */
  readonly sweepDeg: number;
  /** Reach in tiles, for legibility at the call site. */
  readonly reachTiles: number;
  readonly damage: number;
  readonly knockback: number;
  /**
   * How fast the body travels while the attack is live, as a multiple of its
   * own speed. It belongs to the attack rather than to the enemy because it is
   * half of what makes each kind dodged differently: a thrust that charges is
   * answered sideways, and a slash that stands still is answered backwards.
   * Both properties come apart if the movement is one shared constant.
   */
  readonly commitSpeed: number;
  /**
   * The cycle's own timings, in ms.
   *
   * Per attack rather than one shared set, because how long a body takes to
   * start, commit and recover **is** the attack. A tank's ram has to be slow
   * to start — its answer is leaving the lane, and the player needs time to
   * pick a direction and travel — long in flight, and slow to recover, which
   * is the whole reward for having got out of the way. Sharing the rusher's
   * 280/190/460 would have made the two charges differ only in speed.
   */
  readonly windupMs: number;
  readonly lungeMs: number;
  readonly recoverMs: number;
  /**
   * Whether hitting a wall mid-commit staggers the attacker.
   *
   * The answer to an armoured body that cannot be interrupted. A tank ignores
   * hit stun by design, so without this the player has agency over its timing
   * and none over its state; with it, the wall does what the player cannot,
   * and *steering* the charge becomes the skill. It is the oldest trick in the
   * genre for exactly this problem.
   */
  readonly stunsOnWall: boolean;
  /**
   * The gap at which this attack commits, in px between the bodies' edges.
   *
   * Per attack, because it *is* the attack. This was one shared constant of 46
   * px for everything, which made the charge meaningless: a ram that has to
   * touch you before it starts is not a ram, and it then travelled its whole
   * length **past** the player — so the same number that made it pointless
   * also made it look absurdly long.
   *
   * A charge commits from across the room and covers roughly that distance, so
   * it arrives where the player was rather than overshooting by five tiles.
   */
  readonly commitRange: number;
  /**
   * How long this body stands down after the attack, in ms.
   *
   * Per attack, because how often something happens is as much a part of what
   * it is as how far it reaches. A jab can come every second and a half; a ram
   * that telegraphs for half a second, crosses five tiles and spends nearly a
   * second recovering is an **event**, and events that arrive every three
   * seconds stop being events.
   */
  /**
   * The pause **after** an attack resolves, before the body may commit again.
   *
   * Cut — thrust and slash from 1300, the charge from 2800, the whirlwind from
   * 2000 — because the rests were tuned one archetype at a time against a
   * player who had to walk into reach, and the sum of them read as every body
   * taking one swing and then queuing. Cut to 800/1900/1400 first, which
   * overshot: three bodies in reach at that cadence leaves no window to swing
   * in at all. These are the figures between. A melee enemy that is not
   * threatening to attack is scenery the player walks past, and with a cycle
   * near two and a half seconds most of a fight was spent next to bodies doing
   * nothing. The windup is still the tell and it is untouched, so what gets
   * denser is the threat, not the unreadability.
   */
  readonly restMs: number;
  /**
   * How fast the body drifts backwards during the recovery, as a fraction of
   * its own speed.
   *
   * Per attack, because it is the shape of the ending. A jab hops back out of
   * range, which re-opens the gap the player needs. A ram **stops** — a mass
   * that has just thrown itself across a room does not glide gracefully
   * backwards, it plants, and planting is what makes the recovery the window
   * it is supposed to be.
   */
  readonly recoilSpeed: number;
  /**
   * How long this attack spends skidding to a halt, in ms, or 0 for one that
   * has nothing to brake from.
   *
   * Declared next to `recoverMs` and deliberately **equal** to it for the
   * charge, because for a ram the skid *is* the recovery: the weight is in the
   * stopping, so once it has stopped there is nothing left to recover from.
   * They were separate numbers and drifted — a 320 ms brake inside a 620 ms
   * recovery left the body standing still for a third of a second after the
   * skid had finished, which is dead air in the middle of the best moment the
   * attack has.
   */
  readonly brakeMs: number;
}

/**
 * The three melee kinds are the same primitive with different numbers, not
 * three systems. A thrust is narrow, long and does not sweep, so it is dodged
 * sideways; a slash is wide, short and sweeps once, so it is dodged backwards;
 * a whirlwind sweeps all the way round, so the only answer is not to be there.
 */
export const MELEE_ATTACKS: Readonly<Record<MeleeAttackSpec["kind"], MeleeAttackSpec>> = {
  /**
   * A charge with a blade on the front of it.
   *
   * The reach is short — about a body — because the travel is the reach. The
   * earlier 2.6 tiles was written for a planted poke, and on a body moving at
   * 3.1x it was unanswerable: an enemy that commits from 63 px away and also
   * projects 83 px of steel has already hit you when it asks the question.
   *
   * What this replaces is contact damage, and the reason it is better is that
   * contact damage has **neither direction nor timing**: it charged the player
   * for touching a body from any angle at any moment, including for walking
   * into its back. A hitbox on the front during the commit can be dodged by
   * moving aside, and standing behind a charging body is safe, which is what
   * makes the charge readable rather than a tax on being close.
   */
  thrust: {
    kind: "thrust", bladeDeg: 34, sweepDeg: 0, reachTiles: 1.1,
    // In hearts. The attacks differ in what they cost as well as in how they
    // move: a thrust is the light hit, a slash the standard one, the charge
    // the heavy one, the whirlwind between. Health is fractional for this.
    damage: 0.7, knockback: 150, commitSpeed: 3.1,
    windupMs: 280, lungeMs: 190, recoverMs: 460, stunsOnWall: false,
    commitRange: 46, restMs: 1000, recoilSpeed: 0.55, brakeMs: 0,
  },
  /**
   * Planted and wide. A heavy body should not also be fast, so the slash
   * trades the charge for arc: it barely moves, and the answer is to be
   * outside its reach rather than to the side of it.
   *
   * Cut from 1.6 tiles, which left no room to stand. Against the tank's 16 px
   * body the player's arc lands out to 73.6 px between centres and a 1.6-tile
   * slash landed in to 58 px, so the band where the player hits and is not hit
   * was 15.6 px wide — and the tank closes at 52 px/s, which crosses it in
   * 0.3 s, about one swing. Measured, the reference player was hit at a median
   * of 49 px against a 51 px reach: it was not losing the spacing game, there
   * was no spacing game. At 1.2 tiles the band is 28 px and lasts half a
   * second, which is a hit and a step back.
   */
  slash: {
    kind: "slash", bladeDeg: 40, sweepDeg: 60, reachTiles: 1.2,
    damage: 1.0, knockback: 240, commitSpeed: 0.3,
    windupMs: 320, lungeMs: 220, recoverMs: 520, stunsOnWall: false,
    commitRange: 46, restMs: 1000, recoilSpeed: 0.35, brakeMs: 0,
  },
  /**
   * The ram: a heavy body using itself as the weapon.
   *
   * It replaced the tank's slash because a sword sweep is the wrong reading of
   * a slow armoured mass — a thing that size should come *through* you, and
   * "charges you down" is legible from its silhouette in a way "sweeps a wide
   * arc" never was.
   *
   * It is a different question from the rusher's thrust rather than a bigger
   * one. The rusher asks for a sidestep inside 190 ms; the ram is telegraphed
   * for half a second, crosses five tiles, and cannot be interrupted because
   * the body is armoured — so the answer is not a flinch but **leaving the
   * lane**, chosen early and committed to. And because it stuns itself on a
   * wall, where the player stands while it winds up decides where it ends up,
   * which turns the arena into part of the fight.
   *
   * The reach is short: it is the body that hits, not a weapon, so the hitbox
   * is a wide front rather than a projecting blade.
   *
   * **The distance is the attack, and it matches the range it commits from.**
   * At 7x its own 34 px/s it covers about 165 px in 700 ms, against a commit
   * range of 150 — so it crosses the gap it announced and stops, rather than
   * continuing that far *past* the player. Two earlier versions were wrong in
   * opposite directions for the same reason: with a shared 46 px commit range
   * it began at contact and then overshot by five tiles, which read as both
   * pointless and absurd. And before that it moved 20 px, because the
   * acceleration ramp was being applied to the commit as well as the approach;
   * the launch is exempt from it now.
   */
  charge: {
    kind: "charge", bladeDeg: 74, sweepDeg: 0, reachTiles: 0.95,
    damage: 1.5, knockback: 420, commitSpeed: 7,
    /*
     * The recovery **is** the skid, so the two are the same number.
     *
     * 900 ms of recovery stopped the fight while the player took it; 620 with
     * a 320 ms brake inside it left the body standing still for the remainder,
     * which is dead air. At 440 the charge arrives, slides a tile and a half
     * while the dust comes off it, and is back on its feet the moment it
     * stops — and the player punishes it *during* the slide, which is a better
     * moment than punishing it afterwards because they have to chase it.
     *
     * The real opening is still the wall slam, which is 1200 ms and has to be
     * set up.
     */
    windupMs: 520, lungeMs: 700, recoverMs: 440, brakeMs: 440, stunsOnWall: true,
    // Its whole cycle is already over two seconds; with a short rest on top it
    // was charging about every three, which is too often for something this
    // large to still read as a commitment.
    restMs: 2200,
    // It stops dead. Drifting backwards at half speed for nine hundred
    // milliseconds was most of what read as the charge "sliding for ages and
    // even drifting" — a ram ends by planting, and the plant is the opening.
    recoilSpeed: 0,
    // Four and a half tiles, and it covers about that — so the telegraph is
    // "it is coming from over there" and the charge arrives where the player
    // was standing rather than sailing five tiles past them.
    commitRange: 150,
  },
  /**
   * The lancer's spikes: the rusher's drive, **from further out**. Same
   * shape — no travel, no sweep, all round — with half a tile more reach and
   * a longer windup to pay for it, so the pace the rusher can be kept at is
   * inside the lancer's reach and the player has to find the next step back.
   * It was a long thrust committed from four tiles, which was the tank's ram
   * at a smaller size; the roster wants one charger, not three.
   */
  lance: {
    kind: "lance", bladeDeg: 360, sweepDeg: 0, reachTiles: 1.5,
    damage: 0.8, knockback: 240, commitSpeed: 0,
    windupMs: 400, lungeMs: 180, recoverMs: 520, stunsOnWall: false,
    // Reach 48 + the player's 10 is 58 from the centre; 34 between edges (8
    // + 10 + 34 = 52) commits inside it. See `bristle`.
    // A long rest: each drive is also eight shots, and measured at 1400 the
    // spikes were a third of all hearts lost in a run.
    commitRange: 34, restMs: 1900, recoilSpeed: 0, brakeMs: 0,
  },
  /**
   * The tank's greatsword: a **planted, wide, heavy cut**. It does not travel
   * — a step in, no more — because the roster already has two bodies that
   * close the gap with a blade (the rusher's thrust and the lancer's charge),
   * and a third made the tank a slower one of them. What the tank owns
   * instead is the ground around it: a hundred and ten degrees of front for
   * a heart and a half, with a long windup to read and a long recovery to
   * punish. The answer is to be outside the arc when it lands and inside the
   * body's reach when it is recovering, which is a rhythm, not a sidestep.
   */
  /**
   * The tank's second move: the greatsword raised over its head and brought
   * straight down. No sweep — it is a chop, not a slash — so the hitbox is a
   * narrow, long wedge in front of the body, and the answer is a step to
   * either side rather than out of range. Used when the player is on top of
   * the tank or behind it, where the ram cannot start; the long windup is the
   * raise, and it is the biggest single hit in the roster.
   */
  cleave: {
    kind: "cleave", bladeDeg: 44, sweepDeg: 0, reachTiles: 1.5,
    damage: 1.6, knockback: 340, commitSpeed: 0.3,
    windupMs: 620, lungeMs: 240, recoverMs: 640, stunsOnWall: false,
    commitRange: 60, restMs: 1800, recoilSpeed: 0.2, brakeMs: 0,
  },
  /**
   * No direction to dodge and nowhere safe but out of reach. The tank's
   * second move — the slam — when the player is on top of it or behind it,
   * where the cleave's front cannot reach; and kept for spells and elites.
   */
  /**
   * The lancer's spin: the body curls into a shell of blades and **slides**
   * at the player for a second, turning twice, in the manner of a kicked
   * Koopa shell — everything inside the ring is cut, all round, for as long
   * as it turns. It moves in a straight line and cannot steer, so the
   * answer is to step out of its line, or to stand a pace outside the ring
   * and cut (the player's arc lands out to about 74 px, the ring to about 32);
   * it stuns itself
   * on a wall, so a room's geometry ends it. It is a cooldown move — see
   * `SPIN_COOLDOWN_MS` in `enemy.ts` — and the lancer thrusts in between.
   * The slide is slower than a charge on purpose: fast enough to have to be
   * dodged, slow enough that stepping aside and cutting as it passes works.
   */
  /**
   * The rusher's attack: it walks up and drives its spikes out **in eight
   * directions at once**. No travel, no sweep, all round and short — a
   * porcupine, not a charger. The rusher thrust and the lancer lanced, and
   * with the tank's ram that was three bodies whose answer was "come at you
   * fast"; the roster wants one. The answer to this one is spacing: the
   * player's arc lands out to about 74 px and the spikes to about 32, so a
   * body that has to walk into sword range to prick is cut on the way in and
   * again in its recovery. The rusher's second move survives the change:
   * about a third of its drives are followed by another almost at once.
   */
  bristle: {
    kind: "bristle", bladeDeg: 360, sweepDeg: 0, reachTiles: 1.0,
    damage: 0.7, knockback: 260, commitSpeed: 0,
    windupMs: 320, lungeMs: 160, recoverMs: 460, stunsOnWall: false,
    /*
     * A planted attack has to commit from **inside its own reach**: the
     * commit gap is measured between the bodies' edges and the hit from the
     * centre, so with 40 here the drive began at up to 58 px from a target it
     * could touch at 42, and it never landed. 20 puts the commit at 38.
     */
    commitRange: 20, restMs: 1200, recoilSpeed: 0, brakeMs: 0,
  },
  /**
   * A sliding, turning shell of blades. **No body uses it at present.** It was
   * the lancer's opener for a day: the mechanic was fine, and the drawing was
   * not — a still sprite rotated by the renderer read as twitching, and the
   * shell wants drawn spin frames it does not have. Kept as a spec because the
   * kind is in the union; the art work order does not ask for the frames
   * until a body needs them.
   */
  whirlwind: {
    kind: "whirlwind", bladeDeg: 30, sweepDeg: 720, reachTiles: 1.0,
    damage: 1.0, knockback: 300, commitSpeed: 1.2,
    windupMs: 480, lungeMs: 1000, recoverMs: 560, stunsOnWall: true,
    commitRange: 110, restMs: 1500, recoilSpeed: 0.2, brakeMs: 140,
  },
  /*
   * The four below exist because the roster's melee had become **all travel**.
   * Every body's answer was a commitment that crossed ground — the rusher and
   * the delver stabbed, the tank rammed, the lancer drove — so three quarters
   * of the attacks in a fight were "something is arriving at you at speed",
   * and the only thing the player ever had to read was a direction and a
   * moment. Reported as "it's all dash attacks", and it was.
   *
   * These travel a fraction of a body length or none, so the question they
   * ask is **shape**: where the steel is, not when it arrives. Each has a
   * silhouette the player can name — a twin arc, a ring, a long sweep, a
   * shove — so the telegraph carries the answer as well as the warning.
   */
  /**
   * The rusher's **claw**: two short swipes across a quarter-turn, a step in
   * behind each rather than a lunge. Half a heart a swipe, so the pair is
   * worth about one drive — and the second is the point of it, because the
   * player who steps out of the first is stepping into where the second is
   * going. It is always strung (see `chooseMelee`), which is the only attack
   * in the roster that is.
   */
  claw: {
    kind: "claw", bladeDeg: 52, sweepDeg: 95, reachTiles: 1.05,
    damage: 0.5, knockback: 170, commitSpeed: 0.45,
    windupMs: 300, lungeMs: 170, recoverMs: 380, stunsOnWall: false,
    commitRange: 34, restMs: 1100, recoilSpeed: 0.25, brakeMs: 0,
  },
  /**
   * The tank's **overhead slam**: the greatsword goes up and comes straight
   * down where it stands, and the floor answers with a ring. It does not
   * travel at all, which is the whole difference from the ram — the ram asks
   * the player to leave a lane, the slam asks them to leave a *place*, and
   * the ring is what makes the place bigger than the blade.
   *
   * The blade is short and the ring is wide and weaker, so standing on it is
   * a heart and a half and standing near it is half of one. See
   * `SLAM_SHOCK_RADIUS`.
   */
  slam: {
    kind: "slam", bladeDeg: 360, sweepDeg: 0, reachTiles: 1.25,
    damage: 1.2, knockback: 380, commitSpeed: 0,
    windupMs: 640, lungeMs: 200, recoverMs: 620, stunsOnWall: false,
    commitRange: 26, restMs: 1900, recoilSpeed: 0, brakeMs: 0,
  },
  /**
   * The lancer's **sweep**: the spear swung flat through most of a turn, at
   * its full reach, slowly. Nothing else in the roster is answered by ducking
   * *inside* a weapon — the reach is 1.65 tiles and the body is 8, so the
   * ground between the lancer's feet and its spear tip is the safe place, and
   * a player who has learned to back out of the spike drive is exactly wrong
   * for it.
   */
  sweep: {
    kind: "sweep", bladeDeg: 26, sweepDeg: 210, reachTiles: 1.65,
    damage: 0.9, knockback: 260, commitSpeed: 0.15,
    windupMs: 500, lungeMs: 360, recoverMs: 540, stunsOnWall: false,
    commitRange: 44, restMs: 1800, recoilSpeed: 0.1, brakeMs: 0,
  },
  /**
   * The warden's **shield bash**: a short shove with the plate, for a player
   * who has walked inside a gun. It barely reaches and it barely hurts; what
   * it does is **throw them back out**, which is the whole point — a heavy
   * gunner's problem is somebody standing on it while it reloads, and its
   * answer should be to make room rather than to out-damage them.
   */
  /**
   * **The boss's backhand: his answer to a player behind him.**
   *
   * His cuts go out of his front (`bossAim`), so the ground behind him — above
   * him on the screen — is where a melee player would stand for ever. When
   * his turn comes with them there and close (`chooseBossAct`), this is one
   * of the two things he does: an arm swung round to wherever they are.
   *
   * The reach is 2.4 tiles, **further than the player's own arc lands**
   * (about 80 px between centres against this body), so there is no place
   * behind him that hits him and is outside this; the arc is 120° swept
   * through another 90°, so sidestepping inside it does not work either; and
   * the knockback is the largest in the game, to put the player back out in
   * front of him.
   */
  maul: {
    kind: "maul", bladeDeg: 120, sweepDeg: 90, reachTiles: 2.4,
    damage: 1, knockback: 520, commitSpeed: 0.2,
    windupMs: 560, lungeMs: 260, recoverMs: 600, stunsOnWall: false,
    commitRange: 70, restMs: 1500, recoilSpeed: 0.1, brakeMs: 0,
  },
  /*
   * **The Crypt King's greatsword** (doc 020). The boss's blades were the
   * roster's slash and cleave, whose reach — 1.2 and 1.5 tiles from the body's
   * centre — ended half a tile past the edge of a body drawn four tiles tall
   * with a sword two tiles long. They are his own now, sized to the sword that
   * is drawn, and each asks one question the other does not.
   *
   * The **greatsweep** is the heavy one: the sword brought flat all the way
   * round his front, 190° at 2.5 tiles — wound up long, swung whole (every
   * key of the front cut), felt in the hands (a freeze and a shake), and
   * thrown on as a sword wave as wide as the cut. 2.5 tiles is where the
   * player's own arc ends, so the player fighting at the tip of their sword
   * is just outside it and the one hugging him is not; his back is safe; its
   * recovery, the sword carried past and the body over its front knee, is
   * the opening. It is everything the slash is not.
   *
   * The **greatcleave** is the sword driven straight down as far ahead as the
   * arms go: 3.5 tiles long and narrow — 14°, about a body wide where it lands
   * — so it is answered by one step sideways, and it outranges everything but
   * a spell. The blade bites into the floor, and pulling it out is the
   * longest recovery he has.
   *
   * Both commit from a gap well inside their reach, so a player who has not
   * moved when the windup starts is in it; the windups are held to the beat
   * (`beginWindup`), so the cut lands on the music. The sweep carries the body
   * back a step as it recovers, which puts him outside the gap where he
   * shoots (`BOSS_PATTERN_MIN_GAP`), so a string is followed by a volley and
   * the fight alternates the two rather than becoming a sword fight only.
   */
  greatsweep: {
    kind: "greatsweep", bladeDeg: 30, sweepDeg: 160, reachTiles: 2.5,
    damage: 1, knockback: 360, commitSpeed: 0.3,
    windupMs: 900, lungeMs: 280, recoverMs: 900, stunsOnWall: false,
    commitRange: 40, restMs: 3800, recoilSpeed: 0.35, brakeMs: 0,
  },
  greatcleave: {
    kind: "greatcleave", bladeDeg: 14, sweepDeg: 0, reachTiles: 3.5,
    damage: 1, knockback: 300, commitSpeed: 0.9,
    windupMs: 700, lungeMs: 160, recoverMs: 1200, stunsOnWall: false,
    commitRange: 70, restMs: 3800, recoilSpeed: 0, brakeMs: 0,
  },
  /*
   * The **greatslash**: the light cut the king's strings are made of (doc 020,
   * `BossPhase.strings`), and the sweep's opposite. Narrow — 100° all told —
   * and long, 3 tiles, with a stride into it (`commitSpeed`), so it reaches
   * past the player's own and a step back is not always far enough; quick to
   * wind (480 ms) and quick to throw, so two of them can be laid a beat and a
   * half apart and the heavy blow after them still has room to wait. No
   * wave: its danger is the rhythm, not the ground past it. Alone it recovers
   * like any cut; inside a string it does not recover at all.
   */
  greatslash: {
    kind: "greatslash", bladeDeg: 30, sweepDeg: 70, reachTiles: 3,
    damage: 1, knockback: 200, commitSpeed: 1.1,
    windupMs: 480, lungeMs: 160, recoverMs: 600, stunsOnWall: false,
    commitRange: 52, restMs: 3800, recoilSpeed: 0.2, brakeMs: 0,
  },
  /*
   * The **dashcut**: the king's run at a player keeping their distance, the
   * sword out in front. It crouches for the windup with the line drawn, then
   * crosses about six tiles in a third of a second, cutting everything along
   * the way — so it is answered by leaving the line, not the range — and it
   * stops in a skid with the sword dragged behind, which is the opening. Into
   * a wall it stuns itself, so where the player stands when it crouches
   * decides where it ends up.
   */
  dashcut: {
    kind: "dashcut", bladeDeg: 50, sweepDeg: 0, reachTiles: 1.6,
    damage: 1, knockback: 380, commitSpeed: 8,
    windupMs: 760, lungeMs: 300, recoverMs: 900, stunsOnWall: true,
    commitRange: 150, restMs: 3800, recoilSpeed: 0, brakeMs: 300,
  },
  bash: {
    kind: "bash", bladeDeg: 96, sweepDeg: 0, reachTiles: 0.95,
    damage: 0.6, knockback: 460, commitSpeed: 0.8,
    windupMs: 380, lungeMs: 160, recoverMs: 520, stunsOnWall: false,
    commitRange: 22, restMs: 2200, recoilSpeed: 0.3, brakeMs: 0,
  },
};

/** Arms a swing box from an attack spec, aimed along `facing` from `x, y`. */
export function armMeleeAttack(
  box: SwingBox, spec: MeleeAttackSpec, x: number, y: number, facing: number, sweep: 1 | -1,
  damageMult = 1,
): void {
  box.active = false;
  box.x = x;
  box.y = y;
  box.facing = facing;
  box.angle = facing;
  box.halfArc = ((spec.bladeDeg / 2) * Math.PI) / 180;
  box.sweepDeg = spec.sweepDeg;
  // An enemy's reach is all steel: nothing in the roster projects a crescent,
  // so there is nothing to spread and the hitbox is at full length at once.
  box.bladeReach = TILE_PX * spec.reachTiles;
  box.spread = 0;
  box.reach = box.bladeReach;
  box.damage = spec.damage * damageMult;
  box.knockback = spec.knockback;
  box.sweep = sweep;
  box.hitIds.length = 0;
  box.ageMs = 0;
}

/**
 * Advances an armed box over `t` in [0, 1] of its active window and returns
 * whether anything new is inside it. Separate from `stepSwing`, which is bound
 * to the player's own timers.
 */
export function advanceBox(box: SwingBox, t: number): void {
  const half = ((box.sweepDeg / 2) * Math.PI) / 180;
  box.angle = box.facing + box.sweep * (-half + Math.max(0, Math.min(1, t)) * 2 * half);
  box.active = true;
}

/* ------------------------------- the strike ------------------------------- */

/**
 * How long the marker sits before the bolt lands.
 *
 * Longer than a reaction window on purpose. The player does not have to flinch
 * out of the way, they have to **travel** out of it: at 240 px per second a
 * radius of 1.2 tiles takes about 160 ms to leave, on top of the 250 ms
 * reaction floor. The rest of the budget is because the marker has to be
 * *noticed* while the player is busy with something else, which a telegraph
 * attached to an enemy does not.
 */
/**
 * How square a wall impact is, as the cosine of the angle to the surface.
 *
 * The blocked axis **is** the surface normal, so squareness falls straight out
 * of the dot product. A corner blocks both axes and counts as head-on at any
 * angle, since there is no direction left to slide along.
 *
 * Pure and exported so the rule can be tested as geometry. Testing it through
 * a generated room instead means the assertion depends on where that room
 * happens to put its pillars, which is how the first version of that test
 * failed: the charge was grazing the wall it was aimed along and hitting
 * something else head-on.
 */
export function wallSlamSquareness(
  blockedX: boolean, blockedY: boolean, lungeX: number, lungeY: number,
): number {
  if (blockedX && blockedY) return 1;
  if (!blockedX && !blockedY) return 0;
  const nx = blockedX ? 1 : 0;
  const ny = blockedY ? 1 : 0;
  return Math.abs(lungeX * nx) + Math.abs(lungeY * ny);
}

export const STRIKE_MARK_MS = 900;
export const STRIKE_FLASH_MS = 180;
export const STRIKE_RADIUS = TILE_PX * 1.2;

export function makeStrike(): Strike {
  return { markMs: 0, flashMs: 0, x: 0, y: 0, radius: STRIKE_RADIUS, damage: 1 };
}

export function strikeMarked(s: Strike): boolean {
  return s.markMs > 0;
}

export function strikeFlashing(s: Strike): boolean {
  return s.flashMs > 0;
}

/** Places a marker. The spot is fixed here and never moves again. */
export function markStrike(s: Strike, x: number, y: number): void {
  s.markMs = STRIKE_MARK_MS;
  s.flashMs = 0;
  s.x = x;
  s.y = y;
  s.radius = STRIKE_RADIUS;
}

/**
 * Advances a marker. Returns true on the single step the bolt lands, which is
 * when a caller applies its damage; a strike hits once and is over, so there
 * is no retrigger rule to get wrong.
 */
export function stepStrike(s: Strike, dtMs: number): boolean {
  if (s.flashMs > 0) {
    s.flashMs -= dtMs;
    return false;
  }
  if (s.markMs <= 0) return false;
  s.markMs -= dtMs;
  if (s.markMs > 0) return false;
  s.flashMs = STRIKE_FLASH_MS;
  return true;
}

export function strikeHits(s: Strike, px: number, py: number, r: number): boolean {
  return Math.hypot(px - s.x, py - s.y) <= s.radius + r;
}

/** Mana a connected hit returns, scaled to the cap so it never goes stale. */
export function manaPerHit(manaMax: number): number {
  return manaMax * MANA_PER_HIT_FRACTION;
}

/**
 * Which way the blade travels, given the direction being faced.
 *
 * The swing must always go the same way **relative to the character's body**,
 * and for one facing that means reversing it in world space. The east facing
 * is drawn by mirroring the west sprite, and a horizontal mirror does not
 * change **vertical** order — but the world sweep's vertical order does
 * differ between the two:
 *
 * - facing west, the blade travels 112 to 248 degrees, which reads as down,
 *   then left, then up;
 * - facing east at the same sign, it travels -68 to +68, which reads as up,
 *   then right, then down.
 *
 * So the mirrored sprite still shows a bottom-to-top swing while the world
 * sweep goes top to bottom, and the two disagree. Reversing the sign for that
 * facing lines them up.
 *
 * This does not make swings differ from one another: the sign is a function of
 * the direction faced, not of how many swings have been thrown, so within any
 * facing every swing is identical.
 */
export function sweepFor(facing: number): 1 | -1 {
  const deg = ((facing * 180) / Math.PI + 360) % 360;
  const mirrored = deg < 45 || deg >= 315;
  return mirrored ? -1 : 1;
}

/**
 * Snaps a movement vector to one of four facings.
 *
 * Four rather than eight is not only an art-budget decision: an eight-way lock
 * makes the swing's commitment vaguer, and Zelda 1 cannot attack diagonally at
 * all. Movement stays eight-directional; only the body's facing snaps.
 */
export function snapFacing(dx: number, dy: number, current: number): number {
  if (dx === 0 && dy === 0) return current;
  return Math.abs(dx) >= Math.abs(dy)
    ? (dx > 0 ? 0 : Math.PI)
    : (dy > 0 ? Math.PI / 2 : -Math.PI / 2);
}

/** How much of the player's own input speed survives, by phase. */
export function swingMoveScale(p: Player): number {
  switch (swingPhase(p)) {
    case "windup": return SWING_WINDUP_MOVE;
    case "active": return SWING_ACTIVE_MOVE;
    case "recover": return SWING_RECOVER_MOVE;
    default: return 1;
  }
}

/**
 * A dash cancels a swing outright.
 *
 * Hyper Light Drifter orders dash above sword above gun, and that single
 * ordering generates all of its cancel behaviour. One priority replaces a
 * matrix of per-move windows, and it is the largest single thing that keeps a
 * committed attack from feeling like a trap.
 */
export function cancelSwing(p: Player): void {
  p.swingMs = 0;
}
