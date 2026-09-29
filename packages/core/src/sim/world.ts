/**
 * The fixed-step world (design doc 008). One `step` is 1/60 s of integer
 * milliseconds; nothing here reads a clock, a DOM or a renderer, so the
 * headless harness and the browser run the identical simulation.
 */
import { BAR_MS, BEAT_MS, beats, pastGrid, untilGrid } from "./beat.ts";
import { AFFIXES, ENEMIES, affixesFor, baseArchetype, rampFor, rampMinimum, rampRoster, resistOf, threatWeight } from "../encounters/index.ts";
import { lodgeBlades, stepLodged } from "./recall.ts";
import { ITEMS, plainInstance } from "../spells/index.ts";
import { KING_AUDIENCE_XP, LEVEL_HEARTS, levelAt, withLevels, xpForKill } from "../run/levels.ts";
import type { ItemRegistry } from "../spells/items.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";
import { BORROWED_BURN_SOURCES, STATUS_ELEMENTS, copyPowers, noPowers } from "../content/tags.ts";
import { PROC_SPLIT } from "./cast.ts";
import type { ElementPowers } from "../content/tags.ts";
import type { MeleeKind, SpawnGroup } from "../types.ts";
import type {
  EncounterPlan, ElitePresence, EnemyId, HazardEffect, ItemInstance, RoomPlan, RoomType, Staff, EliteAffix, WaveStructure,
} from "../types.ts";
import type { AffixContext } from "../encounters/affixes.ts";
import type { Rng } from "../rng.ts";
import {
  DASH_COOLDOWN_MS, DASH_IFRAME_MS, DASH_MS, DASH_SPEED,
  HURT_NUDGE, HURT_NUDGE_MS, INVULN_MS, MAX_HEARTS, PLAYER_RADIUS, PLAYER_SPEED, noMods, HP_PER_HEART, NO_INPUT,
  STEP_MS, STUN_LIGHTNING_MS,
} from "./types.ts";
import type { Bullet, DeathBurst, Enemy, GrassCell, Input, Particle, PlayerMods, PlayerWakeCut, World } from "./types.ts";
import { acquire, makePool, integrate, POOL_SIZES } from "./bullets.ts";
import {
  circleHitsWall, circlesOverlap, entryPosition, hasLineOfSight, moveSliding, normalise,
} from "./collide.ts";
import {
  autoMeleeFacing, beginSwing, canSwing, cancelSwing, makeSwingBox, manaPerHit, sectorHits, snapFacing,
  stepStrike, stepSwing, strikeHits, swingMoveScale, beginSpin, SPIN_RAGE, bladeAngle, SWING_ACTIVE_MS, SWING_WINDUP_MS,
} from "./melee.ts";
import { CLOUD_TICK_MS, FIRE_ENEMY_DAMAGE, FIRE_TICK_MS, GROUND_STATUS_POWER, lightFire, makeFirePool, makeScorchPool, scorch, stepFires, stepScorches } from "./fire.ts";
import { eruptRing, fireUnit, PROC_MIN } from "./cast.ts";
import { stepBoomerangs, stepEnchant, stepOrbs, stepTrail, stepWaves, waveCentre, waveHits } from "./shapes.ts";
import {
  afterimageOf, cullShare, dragPull, effectOf, intercepts, nearestWithin, onDashStart, onDashThrough, stepSlams, onExpire, onHit, onHurt, onKill, onSpin, stepWards,
  wallSplitCount, wardStops, whirlTargets,
} from "./affix-hooks.ts";
import type { HookSim } from "./affix-hooks.ts";
import {
  SPELL_SLOTS, MANA_REGEN_FRACTION_PER_S, makeSpell, stepSpells, stepEchoes, ENEMY_BUILD_PER_HIT, cancelCharge, endChannel,
  freeCastScope,
} from "./spells.ts";
import { featureCells, spikesOut } from "../rooms/features.ts";
import { floodFill } from "../rooms/measure.ts";
import {
  breakable, clearPropCell, expiredProps, placeFixtures, placeProps, placeStanding, propHit, stepProps,
  PROP_MANA_FRACTION,
} from "./props.ts";
import { COIN_VALUE, MANA_ORB, burstCoins, drop, makePickupPool, stepPickups } from "./pickups.ts";
import { CHEST_GOLD } from "../run/chest.ts";
import { audienceKill, makeAudience, stepAudience } from "./audience.ts";
import { armGuardianIntroVolley, GUARDIAN_BROKEN_TAKEN, GUARDIAN_HEARTS, GUARDIAN_INTRO_MS, GUARDIAN_INTRO_NOTICE_MS, GUARDIAN_INTRO_PRE_MS, GUARDIAN_INTRO_RECOVERY_MS, GUARDIAN_OPENING_MAX, GUARDIAN_SINK_MS, GUARDIAN_STANCE, GUARDIAN_XP, makeGuardian, stepGuardian, wearStance } from "./guardian.ts";
import { makeObjective, OBJECTIVE_ENTRY_GRACE_MS, placeTargets, stepObjective } from "./objective.ts";
import {
  enteredPortal, makePortal, placeRewardNear, portalsBefore, raisePortals, stepPortals, stepReward,
} from "./exits.ts";
import type { PortalSpec, RoomOffer } from "./exits.ts";
import type { Destructible } from "./props.ts";
import type { SpellSlot } from "./spells.ts";
import type { BulletEmission } from "../encounters/patterns.ts";
import { turnToward, seekTargets } from "./aim.ts";
import { ARM_TELE_MS, castArm, castRift, castRanged, castShockwave, dragStep, flameCovers, interruptToll, layWake, lineToWall, onExpansionDeath, riftHits, shockwaveHits, stepAttacks } from "./attacks.ts";
import type { AttackHooks } from "./attacks.ts";
import { computeFlowField, tileOf } from "./flow.ts";
import {
  anchored, bossStringHearts, hatchMinion, isActive, livingSummoners, makeEnemy, makeKing, kingFloorHp, stepEnemy, stagger, canStagger, midAttack, wake, dropToken,
  dropFireToken, POISE_BREAK_MS, POISE_BREAK_STAGGER_MS, POISE_GUARD_MS, SPAWN_FADE_MS, SPAWN_TELEGRAPH_MS, ENEMY_FREEZE_MS, STAGGER_MS,
  ENEMY_BURN_MS, ENEMY_POISON_MS, ENEMY_BURN_SOURCES, ENEMY_POISON_STACKS, SHATTER_MULT,
  STATUS_BREADTH_MULT, statusBreadth, ALERT_MS,
  meleeSpec, plated, showsPoise, breakStaggerMs,
  spikeVolley, SPIKE_SIZE, release, bossPhase, BOSS_POWER,
  beginWindup, bossBehind, bossLevel, BOSS_ROAR_MS, BOSS_LINK_RECOVER_MS, BOSS_DASH_SLIDE, bossDashWake, bossTempo,
} from "./enemy.ts";
import { feature } from "../rooms/features.ts";

/**
 * How long standing on a hazard costs a heart, once the first touch has.
 *
 * Raised from 700 ms, which is barely more than the 600 ms of invulnerability
 * it grants, so a foot left on a spike strip was losing a heart every seven
 * frames after the invulnerability lapsed — about 1.4 hearts a second, or four
 * seconds from full to dead. Melee made that much worse than it reads, because
 * a player who has to close distance is also being knocked around and chased
 * onto the floor rather than choosing to stand on it: measured, ground hazards
 * were 57% of all damage taken, more than every living thing combined.
 */
const HAZARD_DAMAGE_INTERVAL_MS = 1100;
/**
 * How long a foot may rest on a contact hazard before it bites. 400 ms at the
 * player's 120 px/s is 48 px, a tile and a half: a one-tile strip is crossed
 * for free, a wider one or a pause on it is not. A strip is a thing to step
 * over, not a wall made of damage; at 250 ms it was still a third of every
 * heart the reference player lost, and that player prices it like a bullet.
 */
const HAZARD_GRACE_MS = 400;
const NEAR_MISS_RADIUS = 26;
/** Impulse a hit imparts, scaled down for heavier bodies. */
const KNOCKBACK = 160;
/** The knockback that carries a body one px as it decays (`stepEnemy`, ×0.82 a step): see `dragPull`. */
const DRAG_TRAVEL_INV = 10.8;
/**
 * How long a body cannot be staggered by a spell again, after one has.
 *
 * Twice the stagger a weight of 1.8 buys, so a heavy spell cast on its own
 * cooldown still lands its stagger every time and a heavy spell spammed at
 * one body does not hold it. "A stagger is the payoff for a slow cast, not a
 * lock" (doc 006).
 */
const SPELL_STAGGER_IMMUNE_MS = 900;

/** Staggers a body with a spell, once per `SPELL_STAGGER_IMMUNE_MS`. */
function spellStagger(w: World, e: Enemy, weight: number): void {
  if (e.staggerImmuneMs > 0) return;
  stagger(w, e, STAGGER_MS * weight);
  e.staggerImmuneMs = SPELL_STAGGER_IMMUNE_MS;
}

/**
 * **The sword flinches a body; it does not cancel its attack.**
 *
 * Every connecting blow used to stagger, and a stagger cancels whatever the
 * body was doing and pushes its next attack back. A sword held down swings
 * faster than any windup in the roster, so a held button kept every body in
 * reach from ever attacking — the whole game could be cleared by holding
 * the sword. Now an attack already under way (a windup, a lunge, a shot
 * being aimed) is finished through the blows, and a body the sword has
 * staggered cannot be staggered by it again for `SWORD_STAGGER_IMMUNE_MS`,
 * so a body being hit still gets its turn. A heavy spell (`spellStagger`)
 * still interrupts: that is what the slow cast is for.
 */
const SWORD_STAGGER_IMMUNE_MS = 1000;

function swordStagger(w: World, e: Enemy): void {
  if (e.staggerImmuneMs > 0 || midAttack(e) || !canStagger(e)) return;
  stagger(w, e);
  e.staggerImmuneMs = SWORD_STAGGER_IMMUNE_MS;
}

/** A player's shot at least this heavy (`weight`) staggers what it hits, for `STAGGER_MS` times its weight. */
const SPELL_STAGGER_WEIGHT = 1.2;

/**
 * **What a blow does to poise, as a share of its damage** (doc 027).
 *
 * Mass, not damage, is what makes a body stop: a stream of sparks can kill a
 * rusher without ever making it flinch, and a stone shard stops it. The
 * spell's own `weight` already says which it is — it decides how far a hit
 * pushes and whether it staggered — so it decides this too:
 *
 * - **light** (under 1: sparks, darts, seekers, pellets, sprays): 0.1. They
 *   wear a bar only as a side effect; a build of them has to reach the break
 *   some other way, or not need it.
 * - **the bolt's class** (1 to 1.2): 0.4.
 * - **heavy** (1.2 and over: the cannon, the shard, the glacier spike, the
 *   void orb, the quake): its weight itself, 1.2 to 2.4. A heavy spell cast on
 *   a body in reach of the sword breaks what the sword alone would take two
 *   or three blows to.
 *
 * The sword is `SWORD_POISE`. A tick of a burn, a cloud, lava or a doom
 * mark's slow half is 0: a tick is not a blow.
 */
export function poiseOfWeight(weight: number): number {
  if (weight >= SPELL_STAGGER_WEIGHT) return weight;
  return weight >= 1 ? 0.4 : 0.1;
}
/** The sword's blow is all mass: its damage is its poise. The last of a run lands heavier, and a spin's blows lighter. */
export const SWORD_POISE = 1;
const SWORD_FINISHER_POISE = 1.5;
const SPIN_POISE = 0.5;
/** A dash's cut and a free strike are blades: the sword's own share. */
const STRIKE_POISE = 1;
/** What an effect a hit carries (a chain's arc, a mark's burst, a harvest) does to poise: a little. */
const PROC_POISE = 0.2;

/**
 * Impact freeze and camera trauma per event.
 *
 * Frames, not milliseconds, is how these are actually reasoned about: one
 * frame for a hit that lands, three for a kill, four for taking one. The cap
 * exists for the same reason Sakurai caps Smash's: without it a big enough
 * hit locks the game, and in a bullet hell the frozen frame is one the player
 * needed to read an incoming wall.
 */
const FRAME_MS = 1000 / 60;
const HITSTOP_HIT = FRAME_MS;
/** The run's last cut landing (`SwingBox.finisher`): the heavy blow, held longer than a cut. */
const HITSTOP_FINISH = FRAME_MS * 3;
const HITSTOP_KILL = FRAME_MS * 3;
const HITSTOP_PLAYER_HIT = FRAME_MS * 4;
const HITSTOP_CAP = FRAME_MS * 6;

/*
 * Shake is for the player being hurt, and nothing else. It was also added for
 * every hit and kill the player landed and for enemy attacks landing near
 * them, hit or miss — so a good fight shook constantly, and a shake stopped
 * meaning "that cost you". Those keep their hitstop; only the hurt shakes.
 */
const TRAUMA_HIT = 0;
const TRAUMA_KILL = 0;
const TRAUMA_PLAYER_HIT = 0.55;
/**
 * **The one blow of the player's own that shakes** (doc 008): a rock from
 * above landing. Every other hit and kill the player lands keeps to the rule
 * above; this is the exception the boss's cleave is on the enemy side — a
 * blow the player waited most of a second for, on a long cooldown, rare
 * enough that a shake from it cannot become the constant rumble the rule is
 * there to stop. 0.5 because the camera moves by the square: at the reduced
 * default it is about a pixel and a half, where 0.3 would be under half of one.
 */
const TRAUMA_SKY_LANDING = 0.5;
/** Linear, and fast enough that a quiet second returns the camera to still. */
const TRAUMA_DECAY_PER_S = 1.5;

/**
 * **One freeze per flurry.** After a freeze ends, the player's own blows —
 * every stop up to a kill's — land without freezing for this long. A swing
 * through a pack or a chain jumping body to body hits on consecutive steps,
 * and each hit froze the world one step after the last freeze let go: a
 * pack read `###.###`, a chain `.#.#.#`, and the fight looked like dropped
 * frames. The first blow of a flurry keeps its weight; the rest ride on it.
 * Longer stops — the player hurt, a boss's landing — are never held back.
 */
const HITSTOP_REST_MS = FRAME_MS * 9;

function impact(w: World, stopMs: number, trauma: number): void {
  if (stopMs > HITSTOP_KILL || w.hitstopRestMs <= 0)
    w.hitstopMs = Math.min(HITSTOP_CAP, Math.max(w.hitstopMs, stopMs));
  w.trauma = Math.min(1, w.trauma + trauma);
}
/** Doc 008 item 1: a sprite that does not react to a hit did not get hit. */
/**
 * Long enough to survive a moving body.
 *
 * Was 70 ms, which is four frames, and four frames of white on a rusher
 * travelling 347 px per second mid-charge is genuinely easy to miss. The hit
 * is the player's only confirmation that a swing connected, so it is worth
 * more frames than the hitstop it accompanies.
 */
export const HIT_FLASH_MS = 110;
const PARTICLE_POOL = 256;
/**
 * How many destructibles a room gets.
 *
 * Enough that a room has scenery to work with and few enough that the floor
 * stays legible: at six, a 21-by-13 room is about two per third of it, which
 * is a thing to notice rather than a field to clear. They are also spaced so
 * no two touch, so this is a ceiling rather than a count.
 */
const PROPS_PER_ROOM = 6;
/**
 * How many enemies may be attacking at once, whatever the room holds — the
 * most a room's own figure (`Ramp.tokens`, which climbs over the run) may be.
 *
 * Two was where the Arkham games sit, and it was a flat two from room 3 on,
 * which the late run outgrew: the build that meets room 12 is not the one
 * that met room 3. Three now, reached at room 10. Three is defensible and six is
 * not: there is no position that answers six simultaneous commitments, so a
 * room that allows it has one strategy, which is to keep running. See
 * `World.attackTokens`.
 */
const ATTACK_TOKENS = 3;
/**
 * ...plus one per this many awake bodies.
 *
 * A fixed two was right for the fight it was written against and wrong for a
 * room of six: measured, an awake body spent **57% of its time waiting for a
 * turn** — a melee body 43 to 65% of it in the ring, a ranged body 62 to 79%
 * of it waiting to shoot — which is what "enemies wander about for ages doing
 * nothing" is. The cap exists so that a room cannot commit six bodies at once
 * and leave the player no position to answer from; it does not have to mean
 * that four of six are always idle.
 *
 * Scaling keeps the intent (a fixed share of the room is engaged rather than a
 * fixed number) and holds the ceiling where it matters: at the concurrency cap
 * of twelve it is six turns, which is still half the floor waiting.
 */
const TOKENS_PER_AWAKE = 3;
/**
 * How many steps of the player's path the world remembers, which sets the
 * longest reaction an enemy can have. 24 steps is 400 ms; see `playerTrail`.
 */
const PLAYER_TRAIL_DEPTH = 24;
/**
 * How many ranged bodies may be winding up or shooting at once, at most; the
 * room's own figure is `Ramp.tokens`, as for the blades.
 *
 * Three, for the same reason as `ATTACK_TOKENS`; it was two, and before that
 * one, which was correct when the problem was volume and wrong
 * once the other four constraints landed — every shot is now telegraphed,
 * bodies are silent at close range, they cannot fire while repositioning and
 * they aim at a stale position. Stacked with a cap of one, ranged enemies
 * dealt no damage at all. The cap exists so that three shooters are not three
 * times the fire; it does not need to make them harmless.
 */
const FIRE_TOKENS = 3;
/**
 * The view the simulation assumes when no camera says otherwise: the viewport,
 * one 21 × 13-tile view (doc 017). The harness plays against it.
 */
export const DEFAULT_VIEW_HALF = { x: TILE_PX * 10.5, y: TILE_PX * 6.5 };
/** See `World.flightBudget`. */
const FLIGHT_BUDGET = 60;

export interface CreateWorldOptions {
  readonly room: RoomPlan;
  readonly encounter: EncounterPlan | null;
  readonly staff: Staff;
  readonly slots: readonly (ItemInstance | null)[];
  readonly hearts: number;
  /**
   * What the **stat cards** have improved about the player; see `PlayerMods`.
   * The level's share is added here from `xp`, so a caller hands in the cards
   * and the experience and never the two already combined.
   */
  readonly mods?: PlayerMods;
  /**
   * Experience earned so far this run (`run/levels.ts`). Nothing in a test
   * passes it, so a world with no history starts at level 1.
   */
  readonly xp?: number;
  readonly rng: Rng;
  readonly items?: ItemRegistry;
  /**
   * Destructibles to place, defaulting to `PROPS_PER_ROOM`.
   *
   * Overridable because a prop is a solid cell, so a test measuring how a body
   * routes through a room has to be able to ask for a room with nothing extra
   * standing in it. A pathfinding assertion that fails because a crate spawned
   * in the gap is a test of the placement, not of the pathfinding.
   */
  readonly props?: number;
  /**
   * A normal room's stray elite: when given, one body in the room carries
   * these affixes.
   */
  readonly affixCtx?: AffixContext;
  /** Difficulty settings; see `World.dealtMult`. */
  readonly dealtMult?: number;
  readonly takenMult?: number;
  readonly invincible?: boolean;
  /** See `World.placement`; waves unless set. */
  readonly placement?: "waves" | "camps";
  /** Half the camera's view round the player, px; see `World.viewHalf`. */
  readonly viewHalf?: { x: number; y: number };
  /** Firing turns and the bullets-in-flight budget, when not the defaults. */
  readonly fireTokens?: number;
  /** Where in the run this room is (1-based), for the ramp; the late run when absent. */
  readonly roomIndex?: number;
  /**
   * **The early economy** (doc 003): how far the coin drop from a kill is
   * raised while the build has not taken shape, as a multiplier clamped to
   * `COIN_BOOST_MAX`.
   *
   * Gold only buys anything through a vendor, and the vendors are the thing a
   * half-built run most needs to reach: a spell off the shelf is a key filled,
   * where a stat is a number on a build that does not exist yet. So the run
   * pays more per body while `build_shape` is `raw` or `forming` and settles
   * back to the ordinary rate once it is `formed`. The cap is code's; which
   * doors lead to the vendor is the Director's (`npc_room`).
   */
  readonly coinBoost?: number;
  readonly flightBudget?: number;
  /**
   * Spin charge carried in from the last room. Rage is earned with the sword
   * and banked as charges; a portal that emptied the bank would make a charge
   * saved for the next fight a charge thrown away.
   */
  readonly rage?: number;
  /**
   * What this room offers on clearing. Omitted in tests and in the harness,
   * where no reward is placed and no portal is raised — a room with no exit is
   * the right shape for a measurement that ends when the last enemy dies.
   */
  readonly offer?: RoomOffer;
  /**
   * **The king's first audience** (doc 022): the room opens as an ordinary
   * fight, the roof gives, and he comes down into it. The room is not clear
   * until he has come and gone.
   */
  readonly audience?: boolean;
  /** Room 10's guardian fight (doc 024): the Frontier Veteran stands in the room with its squad. */
  readonly guardian?: boolean;
  /** A special room's chest (doc 026): it stands beside the reward once the room clears. */
  readonly chest?: boolean;
}

/**
 * The three keyed spells, drawn from the slot list: each held item is one
 * self-contained spell, in slot order, padded to `SPELL_SLOTS`.
 */
function spellsFrom(
  slots: readonly (ItemInstance | null)[], items: ItemRegistry,
): (SpellSlot | null)[] {
  const out: (SpellSlot | null)[] = [];
  for (const inst of slots) {
    if (!inst || out.length >= SPELL_SLOTS) continue;
    if (items.has(inst.base)) out.push(makeSpell(inst));
  }
  while (out.length < SPELL_SLOTS) out.push(null);
  return out;
}

/**
 * Answers the offer: the run has chosen a card, so the exits open.
 *
 * Called by the scene rather than decided here, because the choice is a UI
 * event and its consequences — gold banked on the run, an item into the staff
 * — belong to the thing that survives the room. The simulation's only stake in
 * it is the gate: while `rewardPending` is set there is no way out.
 */
export function answerOffer(w: World): void {
  if (!w.rewardPending) return;
  w.rewardPending = false;
  w.rewardDrop = null;
  // In front of the player, where they took the reward — which is gone, so
  // the row need not keep clear of it.
  w.portals = portalsBefore(w.room.grid, w.room.extent, w.portalSpecs, w.player, w.portalKeepClear, hazardCells(w), w.viewHalf);
  raisePortals(w.portals);
  w.events.push({ kind: "portals_open", x: w.player.x, y: w.player.y });
}

/**
 * **The doors, decided.** The portals stood pending while the Director
 * answered; each takes its spec where it stands, keeping its place and its
 * rise, so what the player sees is the same door becoming a particular one.
 * Before the way out has opened there is nothing standing, and the specs are
 * what it will open with. A count that changed — a fallback that drew its
 * own — lays the row out again.
 */
export function resolvePortals(w: World, specs: readonly PortalSpec[]): void {
  w.portalSpecs = specs;
  if (w.portals.length === 0) return;
  if (w.portals.length !== specs.length) {
    w.portals = portalsBefore(w.room.grid, w.room.extent, specs, w.player, w.portalKeepClear, hazardCells(w), w.viewHalf);
    raisePortals(w.portals);
    return;
  }
  w.portals = w.portals.map((p, i) => {
    const next = makePortal(specs[i]!, p.x, p.y);
    next.open = p.open;
    next.riseMs = p.riseMs;
    return next;
  });
}

/**
 * Puts an item into the first free staff slot and rebuilds what depends on it.
 *
 * The keyed spells depend on the slots and forgetting to rebuild them is a
 * silent failure. Exported as one call so a reward taken mid-run cannot update
 * one without the other — which is the shape of bug that shows up as "the
 * spell I picked up does nothing".
 *
 * Returns false when the staff is full. Doc 003 wants that case to open the
 * staff editor with a mandatory discard; there is no editor yet, so the caller
 * has to decide what to do and is not allowed to ignore the answer.
 */
export function equipItem(
  w: World, baseId: string, uid: string, items: ItemRegistry = ITEMS,
  /**
   * Which slot to put it in. Left out, the first empty one, and a full staff
   * refuses; given, that slot's spell is **replaced** — the player's answer to
   * "which of these three goes", which is theirs to give and not the game's.
   */
  at?: number,
): boolean {
  const free = at ?? w.slots.findIndex((x) => x === null);
  if (free < 0 || free >= w.slots.length) return false;
  const slots = [...w.slots];
  slots[free] = plainInstance(baseId, uid, items);
  w.slots = slots;
  w.spells = spellsFrom(slots, items);
  return true;
}

export function createWorld(input: CreateWorldOptions): World {
  const w = buildWorld(input);
  if (input.guardian) placeGuardian(w);
  // The room's objective (doc 025), with its own waves kept to send again.
  const objective = input.room.objective;
  if (objective) {
    w.objective = makeObjective(objective, w.pendingWaves);
    if (objective === "destroy") placeTargets(w);
  }
  return w;
}

/**
 * **The Frontier Veteran takes its ground** (doc 024): as far from the door as
 * the opening view allows, awake, alone, and **in sight**, its bar and name
 * over it included. The room's own wave remains the opening fight; the
 * Veteran demonstrates a harmless line, then calls one fixed squad mid-fight.
 * The view is the camera's at the door: centred on
 * the player, held inside the room (`viewHalf`).
 */
function placeGuardian(w: World): void {
  const ext = w.room.extent, grid = w.room.grid, p = w.player;
  const roomW = ext.w * TILE_PX, roomH = ext.h * TILE_PX;
  const half = w.viewHalf;
  const cx = roomW <= half.x * 2 ? roomW / 2 : Math.max(half.x, Math.min(roomW - half.x, p.x));
  const cy = roomH <= half.y * 2 ? roomH / 2 : Math.max(half.y, Math.min(roomH - half.y, p.y));
  // Room for its body at the sides and below, and for its body, bar and name above.
  const side = TILE_PX * 2, above = TILE_PX * 4, below = TILE_PX * 2;
  const inView = (x: number, y: number): boolean =>
    Math.abs(x - cx) <= half.x - side && y - cy >= -(half.y - above) && y - cy <= half.y - below;
  let best: { x: number; y: number; d: number } | null = null;
  // Stage the entrance in the lane directly ahead of the player, toward the
  // room's centre, instead of placing the Veteran in a far corner.
  const roomCentre = { x: roomW / 2, y: roomH / 2 };
  const forward = normalise(roomCentre.x - p.x, roomCentre.y - p.y);
  const centreDistance = Math.hypot(roomCentre.x - p.x, roomCentre.y - p.y);
  const targetDistance = Math.max(TILE_PX * 4, Math.min(TILE_PX * 8, centreDistance - TILE_PX * 1.5));
  for (let gy = 3; gy < ext.h - 3; gy++)
    for (let gx = 3; gx < ext.w - 3; gx++) {
      let open = true;
      for (let dy = -1; dy <= 1 && open; dy++) for (let dx = -1; dx <= 1 && open; dx++)
        open = grid[(gy + dy) * GRID_W + gx + dx] === Tile.Floor;
      if (!open) continue;
      const x = (gx + 0.5) * TILE_PX, y = (gy + 0.5) * TILE_PX;
      if (w.props.some((q) => q.hp > 0 && Math.hypot(q.x - x, q.y - y) < TILE_PX * 2)) continue;
      const projected = (x - p.x) * forward.x + (y - p.y) * forward.y;
      const lateral = Math.abs((x - p.x) * forward.y - (y - p.y) * forward.x);
      // Out of sight is only ever a fallback: any cell in view beats every cell out of it.
      const d = (inView(x, y) ? 1e6 : 0)
        - Math.abs(projected - targetDistance) * 4
        - lateral * 2;
      if (!best || d > best.d) best = { x, y, d };
    }
  const at = best ?? { x: (ext.w / 2) * TILE_PX, y: (ext.h / 2) * TILE_PX };
  // Keep the room's own opening wave, but make it a light three-body beat:
  // the Veteran's later call is a separate, fixed squad rather than a second
  // crowd arriving on top of a full late-room wave.
  let openingLeft = GUARDIAN_OPENING_MAX;
  w.pendingWaves = w.pendingWaves.flatMap((wave) => {
    if (wave.atMs > 0) return [wave];
    if (openingLeft <= 0) return [];
    const spawns = wave.spawns.flatMap((spawn) => {
      const count = Math.min(openingLeft, spawn.count);
      openingLeft -= count;
      return count > 0 ? [{ ...spawn, count }] : [];
    });
    return spawns.length > 0 ? [{ ...wave, spawns }] : [];
  });
  const g = makeGuardian(w.nextEnemyId++, at.x, at.y, w.roomIndex);
  g.spawnFadeMs = 0;
  g.facing = Math.atan2(w.player.y - g.y, w.player.x - g.x);
  // The entrance composition is a face-to-face beat: the player looks at the
  // Veteran as soon as the room places it in the forward lane.
  w.player.facing = Math.atan2(g.y - w.player.y, g.x - w.player.x);
  w.enemies.push(g);
  w.cleared = false;
  w.events.push({ kind: "telegraph", x: at.x, y: at.y, what: "guardian_arrives" });
}

function buildWorld(input: CreateWorldOptions): World {
  /*
   * **The level is folded in here, once, for every caller.**
   *
   * The run hands in what the stat cards did and how much experience it has
   * earned; what the player actually fights with is the two together
   * (`withLevels`). Doing it here rather than in the scene and again in the
   * harness is the parity rule: both callers build the same body from the
   * same two numbers, and neither can forget half of it.
   */
  const baseMods = input.mods ? { ...input.mods } : noMods();
  const progress = levelAt(input.xp ?? 0);
  const mods = withLevels(baseMods, progress.level);
  /*
   * The run's max-mana modifier is applied to the staff here, once. It was
   * recorded (`deep_well` multiplied `mods.manaMax`) and read by nothing, so
   * the stat card said "+18% max mana" and the bar did not move.
   */
  const o: CreateWorldOptions = mods.manaMax !== 1
    ? { ...input, mods, staff: { ...input.staff, mana_max: Math.round(input.staff.mana_max * mods.manaMax) } }
    : { ...input, mods };
  const start = entryPosition(o.room.entry, o.room.extent);
  /*
   * The world owns a copy of the grid.
   *
   * Destructibles write themselves into it and erase themselves from it when
   * broken, so it has to be private: a `RoomPlan` is addressed by seed and
   * replayed, and mutating the plan's own grid would leak a broken pot into
   * every later world built from the same room.
   */
  const grid = Uint8Array.from(o.room.grid);
  const zones = o.room.zones;
  // Fixtures first: the zone's own pillars, which the scattered props then
  // keep clear of like any other solid.
  // Every prop breaks, fixtures too, so the boss room stands none (see below).
  const fixtures = o.room.room_type === "boss" ? [] : placeFixtures(grid, zones);
  const standing = placeStanding(grid, o.room.standing ?? []);
  const scattered = placeProps(
    grid, o.rng,
    // Clear of the entry and of every spawn point: a prop on a spawn buries
    // an enemy in solid terrain, and one on the entry is an obstacle before
    // the player has seen the room.
    [start, ...o.room.spawn_groups.flatMap((g) => g.cells.map((c) => ({
      x: (c[0] + 0.5) * TILE_PX, y: (c[1] + 0.5) * TILE_PX,
    })))],
    // None in the boss room: the arena is the fight's, and a pot there is a
    // wall the king's moves stop at and the player trips on mid-dodge.
    o.props ?? (o.room.room_type === "boss" ? 0 : PROPS_PER_ROOM),
    // Nor on a floor hazard: a pot standing in a poison pool is a thing the
    // player has to wade in to break, and reads as the pool being floor.
    hazardCellsOf(zones),
  );
  const props = [...fixtures, ...standing, ...scattered];
  return {
    tick: 0,
    room: { ...o.room, grid, zones },
    props,
    staff: o.staff,
    slots: o.slots,
    // The first three held items become the three keyed spells (doc 013).
    spells: spellsFrom(o.slots, o.items ?? ITEMS),
    pickups: makePickupPool(),
    gold: 0,
    xp: progress.xp,
    level: progress.level,
    baseMods,
    staffManaBase: input.staff.mana_max,
    /*
     * The portals exist from the first frame and are shut.
     *
     * Placed at room start rather than at clearing for two reasons. They are
     * part of the room's geometry — a portal is a solid-looking landmark the
     * player navigates around, and a landmark that appears mid-fight changes
     * the room under them. And placement has to avoid the spawn groups, which
     * are known now and gone later.
     *
     * Drawn shut, so the player can see where the exits will be and which type
     * each one leads to while they are still fighting. That is the whole
     * advantage a floor portal has over a door in the wall, and it would be
     * wasted by hiding them until the end.
     */
    // Made when the way out opens, in front of the player (`portalsBefore`).
    portals: [],
    portalSpecs: o.offer?.doors ?? [],
    portalKeepClear: [],
    rewardPending: false,
    rewardDrop: null,
    exited: null,
    offer: o.offer ?? null,
    player: {
      x: start.x, y: start.y,
      hearts: o.hearts,
      slipFired: 0,
      mods: o.mods ? { ...o.mods } : noMods(),
      invulnMs: 0,
      mana: o.staff.mana_max,
      castPending: -1, castWindupMs: 0, castCost: 0, castRecoverMs: 0, castMoveScale: 1,
      chargeKey: -1, chargeMs: 0, chargeVoid: -1, channelKey: -1, landing: null,
      aim: { x: start.x + 1, y: start.y },
      facing: 0,
      dashMs: 0, dashIframeMs: 0, dashCooldownMs: 0, dashX: 0, dashY: 0,
      hurtX: 0, hurtY: 0, hurtMs: 0,
      burnBuild: 0, poisonBuild: 0, burnFedMs: 0, poisonFedMs: 0, burnMs: 0, poisonMs: 0, dotTickMs: 0,
      rage: Math.max(0, Math.min(o.mods?.rageMax ?? Infinity, o.rage ?? 0)), swingStretch: 1, spinTurn: 0, spinBufferMs: 0, spellBuffer: -1, spellBufferMs: 0,
      strikeMs: 0, strikeDamage: 0, strikeRadius: 0,
      strikeElement: "none" as const, strikeElementPower: 1, strikePowers: noPowers(), strikeProc: 1, strikeStatusMult: 1, strikeHits: [], strikeWake: null,
      stunMs: 0, dragMs: 0, dragX: 0, dragY: 0, slipMs: 0, slideX: 0, slideY: 0,
      swingMs: 0, swingFacing: 0, swung: false, chainMs: 0, swingRun: 0, swingBreathMs: 0,
      trail: null, enchant: null, stance: null,
    },
    enemies: [],
    playerBullets: makePool(POOL_SIZES.player),
    enemyBullets: makePool(POOL_SIZES.enemy),
    particles: Array.from({ length: PARTICLE_POOL }, () => ({
      alive: false, x: 0, y: 0, vx: 0, vy: 0, lifeMs: 0, maxLifeMs: 1, kind: "hit" as const,
    })),
    pendingWaves: chunkWaves(trimToRamp((o.encounter?.waves ?? []).map((w) => ({
      atMs: w.at_ms,
      spawns: w.spawns.map((s) => ({ archetype: s.archetype, group: s.spawn_group, count: s.count })),
    })), o.roomIndex ?? 99, o.room.room_type === "combat" || o.room.room_type === "elite",
      PACING[o.encounter?.profile.wave_structure ?? "steady"].gapMs), o.roomIndex ?? 99),
    pacing: PACING[o.encounter?.profile.wave_structure ?? "steady"],
    affixes: o.encounter?.elite_affixes ?? [],
    normalElites: normalEliteCount(o.roomIndex ?? 99, o.encounter?.profile?.elite_presence),
    affixCtx: o.affixCtx ?? {
      roster_size: o.encounter?.waves.reduce((n, wv) => n + wv.spawns.reduce((m, sp) => m + sp.count, 0), 0) ?? 0,
      rooms_seen: o.roomIndex ?? 1,
      shielded_rooms: 0,
      build_elemental_only: false,
    },
    elitesPlaced: 0,
    affixPlaced: {},
    dealtMult: o.dealtMult ?? 1,
    resonance: [],
    spinRays: [],
    lodged: [],
    takenMult: o.takenMult ?? 1,
    invincible: o.invincible ?? false,
    viewHalf: o.viewHalf ?? DEFAULT_VIEW_HALF,
    viewCentre: null,
    placement: o.placement ?? "waves",
    events: [],
    stats: {
      enemiesSpawned: 0, heartsLost: 0, damageDealt: 0, shotsFired: 0, nearMisses: 0, elapsedMs: 0,
      castPresses: 0, castRefusedMana: 0, manaBelowKeyMs: 0, shotHits: 0, swordDamage: 0,
      hurtByRanged: 0, hurtByMelee: 0, hurtByHazard: 0,
      hurtByEnemy: {}, heartsLow: o.hearts ?? 0,
    },
    rng: o.rng,
    nextEnemyId: 1,
    nextEruptionCast: 1,
    lastSpellKey: null,
    lastWaveMs: -Infinity,
    cleared: false,
    // Charged, so the first step onto a hazard is paid for at once.
    playerTrail: [{ x: start.x, y: start.y }],
    /*
     * Where in the run this room is, for the ramp (doc 005). Defaults to the
     * end of it, so anything that does not say — a test, a frame capture —
     * plays the full-size game.
     */
    roomIndex: o.roomIndex ?? 99,
    ...(o.audience ? { audience: makeAudience(), awaitingBoss: true } : {}),
    ...(o.chest ? { chestDue: true } : {}),
    ...(o.guardian ? { guardianRoom: true } : {}),
    coinBoost: Math.max(1, Math.min(COIN_BOOST_MAX, o.coinBoost ?? 1)),
    attackTokens: ATTACK_TOKENS,
    fireTokens: o.fireTokens ?? FIRE_TOKENS,
    // The base the scaling adds to; an experiment may set it (`JR_FIRE_TOKENS`).
    fireTokenCap: o.fireTokens ?? FIRE_TOKENS,
    flightBudget: o.flightBudget ?? FLIGHT_BUDGET,
    hazardTimerMs: HAZARD_DAMAGE_INTERVAL_MS - HAZARD_GRACE_MS,
    hitstopMs: 0,
    hitstopRestMs: 0,
    trauma: 0,
    fires: makeFirePool(),
    grass: grassOf(o.room),
    pathGrid: lavaAsWall(o.room),
    /*
     * Eighteen, from six: a free cast is the spell's own shape now, so
     * `scatter` III on Void Maw opens six pulls a press, and at six slots
     * every press evicted the pull the press before had put under the body
     * it was holding. A pull is not a patch of fire, and there is no carpet
     * to cap (`FIRE_POOL`); eighteen is three presses of the widest cast,
     * which is more than the bar pays for in the time a pull lasts.
     */
    vortices: Array.from({ length: 18 }, () => ({
      alive: false, x: 0, y: 0, radius: 0, lifeMs: 0, maxLifeMs: 1, pull: 0, tickMs: 0, damage: 0,
      element: "none" as const, elementPower: 1, powers: noPowers(), proc: 1, statusMult: 1, spellIndex: -1,
      collapseDamage: 0,
    })),
    eruptions: Array.from({ length: ERUPTION_POOL }, () => ({
      alive: false, x: 0, y: 0, delayMs: 0, ageMs: 0, fired: false, radius: 0, damage: 0,
      element: "none", elementPower: 1, powers: noPowers(), proc: 1, statusMult: 1, weight: 1, burnMs: 0, kind: "earth" as const, spellIndex: -1, castId: 0,
      telegraphMs: 0, hostile: false,
    })),
    hostileCastHit: 0,
    pets: Array.from({ length: 2 }, () => ({
      alive: false, x: 0, y: 0, vx: 0, vy: 0, facing: 0, lifeMs: 0, maxLifeMs: 1, fireMs: 0,
      intervalMs: 700, damage: 0, range: 0, speed: 0,
      element: "none" as const, elementPower: 1, powers: noPowers(), proc: 1, statusMult: 1, spellIndex: -1, attackMs: 0,
    })),
    /*
     * Nine: three keys at the pool's largest cap of three. A key's own cap
     * (`max_alive`) is what bounds a held key; this only has to hold them.
     */
    orbs: Array.from({ length: 9 }, () => ({
      alive: false, x: 0, y: 0, vx: 0, vy: 0, radius: 0, lifeMs: 0, maxLifeMs: 1, zapClockMs: 0, zapMs: 300,
      zapReach: 0, zapCount: 1, damage: 0, element: "none" as const, elementPower: 0, powers: noPowers(), proc: 1, statusMult: 1,
      affixes: [], spellIndex: -1, manaSpent: 0, born: 0, lastTargetId: -1, lastTargetIds: [],
    })),
    wards: [],
    echoes: [],
    beams: [],
    freeStrikes: [],
    dooms: [],
    scorches: makeScorchPool(),
    rifts: [], mines: [], tethers: [], lobs: [], hasteFields: [], shockwaves: [], arms: [], flames: [], deathBursts: [],
    streak: 0, streakMs: 0, swordBlow: false, quietMs: 0,
    swing: makeSwingBox(),
    flow: null,
    flowTile: null,
  };
}

/** The cells of every zone with a feature in it, as grid indices. */
export /** The share of an elite room's non-heavy bodies that are elite; see the spawn. */
const ELITE_SHARE = 0.35;
const HEAVY_ELITES: ReadonlySet<string> = new Set(["tank", "summoner", "turret", "sentinel"]);
/** The most bodies an elite room makes elite: four things to pick a kill order for. */
export const ELITE_ROOM_CAP = 4;

/**
 * **How many elites a normal room hides** (doc 019).
 *
 * This replaces a flat 15% a room with a Director answer. A fixed rate is a
 * designer's taste written as a constant, and whether *this* room should hide
 * one reads on the player's state exactly as `density` and `anchor` do — so
 * it is `elite_presence`, asked in round 2, and this is only the conversion
 * from its label to a count.
 *
 * The caps stay code's, whatever the answer was: never before the ramp allows
 * an elite at all, and never more than two.
 */
export const NORMAL_ELITE_CAP = 2;
export const ELITE_COUNT: Readonly<Record<ElitePresence, number>> = { none: 0, one: 1, two: 2 };

export function normalEliteCount(roomIndex: number, presence: ElitePresence | undefined): number {
  if (!rampFor(roomIndex).elites) return 0;
  return Math.min(NORMAL_ELITE_CAP, ELITE_COUNT[presence ?? "none"]);
}

export function hazardCells(w: World): Set<number> {
  const out = new Set<number>();
  for (const z of w.room.zones)
    if (z.feature !== "none") for (const c of z.cells) out.add(c[1] * GRID_W + c[0]);
  return out;
}

/** No enemies, no pending waves and no summoner alive (doc 003). */
export function worldCleared(w: World): boolean {
  // A burst still hanging is part of the fight: the room clears once it has flown.
  // And a room whose king is still to come — the throne before he stands, room 5
  // before the roof gives (doc 022) — is empty, not clear.
  // Nor a room whose objective is still to meet (doc 025): a hold's clock, a destroy room's turrets.
  return !w.awaitingBoss && !(w.objective && !w.objective.done) && w.enemies.length === 0 && w.pendingWaves.length === 0 && livingSummoners(w) === 0
    && w.deathBursts.length === 0;
}

/** The Veteran's opening state, including the one-second stretch where the room is still live. */
function guardianIntroPending(w: World): Enemy | undefined {
  return w.enemies.find((e) => e.guardian && e.hp > 0 && e.pose === "guardian_intro");
}

/** The locked part of the entrance: notice, laser, and the smalls going under. */
function guardianIntro(w: World): Enemy | undefined {
  const g = guardianIntroPending(w);
  return g && g.poseMs <= GUARDIAN_INTRO_NOTICE_MS + 1900 ? g : undefined;
}

/** Put every body into the same readable noticing beat. */
function armGuardianIntroActors(w: World): void {
  const g = guardianIntro(w);
  if (!g) return;
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.gone) continue;
    e.awake = true;
    e.alertMs = GUARDIAN_INTRO_MS;
    e.velX = 0;
    e.velY = 0;
    e.attack = "approach";
    e.attackMs = 0;
    e.swing.active = false;
    e.pending = [];
    e.telegraphMs = 0;
    e.facing = Math.atan2(w.player.y - e.y, w.player.x - e.x);
  }
}

/** Advance only the cutscene clocks. The real rifts still run and can hurt a player who walks into them. */
function stepGuardianIntro(w: World, dtMs: number): void {
  const g = guardianIntroPending(w);
  if (!g) return;
  const gs = g.guardian!;
  if (!gs.introNoticeSent) {
    gs.introNoticeSent = true;
    armGuardianIntroActors(w);
    w.events.push({ kind: "telegraph", x: g.x, y: g.y, what: "guardian_intro_notice" });
  }
  g.poseMs -= dtMs;
  // Keep the alert marks and bodies planted for the one-second noticing beat.
  if (!gs.introVolleyArmed && g.poseMs > 1900) armGuardianIntroActors(w);
  // When the marks vanish, the warning lanes appear and the opening pack
  // begins sinking under the floor on the same beat.
  if (!gs.introVolleyArmed && g.poseMs <= 1900) {
    gs.introVolleyArmed = true;
    for (const e of w.enemies) if (e.hp > 0) e.alertMs = 0;
    armGuardianIntroVolley(w, g);
    for (const e of w.enemies) {
      if (e === g || e.hp <= 0 || e.hideMs > 0 || e.spawnFadeMs > 0) continue;
      e.hideMs = Math.max(0, g.poseMs) + GUARDIAN_SINK_MS;
      e.sinkMs = GUARDIAN_SINK_MS;
      e.airborne = true;
    }
  }
  for (const e of w.enemies) {
    if (e === g || e.hideMs <= 0) continue;
    e.hideMs = Math.max(0, e.hideMs - dtMs);
    if (e.sinkMs > 0) e.sinkMs -= dtMs;
    e.velX = 0;
    e.velY = 0;
    if (e.hideMs <= 0) {
      e.airborne = false;
      e.spawnFadeMs = SPAWN_FADE_MS + SPAWN_TELEGRAPH_MS;
      w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "boss_summon" });
    }
  }
  if (g.poseMs > 0) return;
  g.pose = "";
  g.poseMs = 0;
  g.guardian!.introGraceMs = GUARDIAN_INTRO_RECOVERY_MS;
  g.attackCooldownMs = Math.max(g.attackCooldownMs, GUARDIAN_INTRO_RECOVERY_MS);
  for (const e of w.enemies) {
    if (e.hp <= 0) continue;
    e.alertMs = 0;
    e.attackLockMs = Math.max(e.attackLockMs, GUARDIAN_INTRO_RECOVERY_MS);
  }
}

export function step(w: World, input0: Input, dtMs = STEP_MS, items: ItemRegistry = ITEMS): World {
  w.events.length = 0;
  w.tick++;
  // The first second belongs to the room: enemies keep their normal motion
  // until the cutscene clock reaches the notice beat. Once it crosses that
  // boundary, the locked intro path below takes over on this same frame.
  const pendingIntro = guardianIntroPending(w);
  if (pendingIntro && pendingIntro.poseMs > GUARDIAN_INTRO_NOTICE_MS + 1900)
    pendingIntro.poseMs -= dtMs;
  // A dead player does nothing: no moving, swinging, casting or dodging.
  const input: Input = w.player.hearts > 0 && !guardianIntro(w) ? input0 : NO_INPUT;

  // Trauma decays on the wall clock, so the camera keeps settling through a
  // freeze rather than holding a shake that never resolves.
  w.trauma = Math.max(0, w.trauma - TRAUMA_DECAY_PER_S * (dtMs / 1000));

  // The freeze holds everything: bodies, bullets, timers. Held for a frame or
  // three it reads as the hit having weight, not as the game hitching.
  /*
   * The boss's fight clock advances first — before the hitstop freeze, so it
   * is real time since the fight began and the music can be played to it,
   * and before any body moves, so everything this step reads the same beat
   * (doc 020). Advanced under the same conditions `stepBoss` runs under.
   */
  for (const e of w.enemies)
    if (e.archetype === "boss" && e.hp > 0 && (isActive(e) || e.airborne) && e.awake) e.bossFightMs += dtMs * bossTempo(e);
  if (w.hitstopMs > 0) {
    w.hitstopMs -= dtMs;
    if (w.hitstopMs <= 0) w.hitstopRestMs = HITSTOP_REST_MS;
    return w;
  }
  if (w.hitstopRestMs > 0) w.hitstopRestMs -= dtMs;
  /*
   * The boss's blade is held to its line here, before the bodies move, so the
   * windup that comes due in this step commits in this step — `stepEnemy`
   * takes the step off it next. Held in `stepBoss`, after the bodies, a blade
   * whose line fell inside a freeze landed two steps after the freeze ended.
   */
  for (const e of w.enemies)
    if (e.archetype === "boss" && e.attack === "windup" && e.attackMs > 0)
      e.attackMs = Math.max(0, Math.min(e.attackMs, e.bossBladeAt - e.bossFightMs + dtMs));

  // Counted after the freeze, because a frozen frame is presentation, not
  // game time. Charging it to the room would make every measurement of how
  // long a fight takes a measurement of how many hits landed in it.
  w.stats.elapsedMs += dtMs;

  stepPlayer(w, input, dtMs);
  // What runs on the caster (doc 006): the guard's clock, the trail's ground
  // for the distance just walked, the enchant's clock.
  stepStance(w, dtMs);
  stepTrail(w, dtMs);
  stepEnchant(w, dtMs);
  refreshFlow(w);
  // A room objective (doc 025): its clock, its targets, and the waves it sends again.
  stepObjective(w, dtMs);
  releaseWaves(w);

  /* Once the room's live first beat has elapsed, the Veteran's entrance is a
   * real cutscene in the simulation: the player and bodies are held while its
   * beams count down. */
  if (guardianIntro(w)) {
    stepGuardianIntro(w, dtMs);
    stepAttacks(w, dtMs, attackHooks(w));
    veteranBreaksProps(w);
    stepParticles(w, dtMs);
    return w;
  }

  resolveSwing(w, dtMs);
  resolveFires(w, dtMs);
  resolveStrikes(w, dtMs);
  // The king's chain leaves the floor on his clock, not on the steps (`Tether.dueAt`).
  for (const t of w.tethers) {
    if (!t.alive || t.phase !== "aim" || t.dueAt === undefined) continue;
    const king = w.enemies.find((x) => x.id === t.from);
    if (king) t.ms = t.dueAt - king.bossFightMs + dtMs;
  }
  // The expansion's rifts, mines, tethers, lobs, fields and discs.
  stepAttacks(w, dtMs, attackHooks(w));
  veteranBreaksProps(w);
  // A travelling band — the slam's, a sword wave — breaks the stone it runs into, once a wave each.
  for (const s of w.shockwaves) {
    if (!s.alive || s.chargeMs > 0 || s.byPlayer) continue;
    s.propsStruck ??= [];
    bossStrikesProps(w, (q) => shockwaveHits(s, q.x, q.y, q.radius), s.propsStruck, BOSS_PROP_WAVE_DAMAGE);
  }
  stepDeathBursts(w, dtMs);

  // A stun silences the spells too, or it would only be a movement penalty.
  // A charge being held goes out with it, unpaid: a stun is not a release.
  if (w.player.stunMs > 0 && w.player.chargeKey >= 0) cancelCharge(w.player);
  if (w.player.stunMs > 0 && w.player.channelKey >= 0) endChannel(w);
  const pressedSpell = w.player.stunMs > 0 ? null : input.spell ?? null;
  const cast = stepSpells(w, items, dtMs, pressedSpell, !!input.spellAuto);
  /*
   * A press that produced nothing is said out loud, so the renderer can
   * answer it. `stepSpells` already knows why — the whole point of
   * `SpellStep.refused` — and the value was being dropped here, which left
   * the browser's player with a key that silently did nothing whenever the
   * bar sat just under the cost.
   */
  const refusedKey = cast.key ?? pressedSpell;
  if (cast.refused !== null && refusedKey !== null)
    w.events.push({ kind: "cast_refused", x: w.player.x, y: w.player.y, what: cast.refused, amount: refusedKey });
  w.stats.shotsFired += cast.shots.length;
  for (const shot of cast.shots) emit(w, shot.x, shot.y, "muzzle", 2);
  for (const shot of stepEchoes(w, items, dtMs)) emit(w, shot.x, shot.y, "muzzle", 2);

  /*
   * Recorded before the enemies move, so what they read is genuinely a past
   * position rather than this frame's with an extra step of luck in it.
   */
  w.playerTrail.push({ x: w.player.x, y: w.player.y });
  if (w.playerTrail.length > PLAYER_TRAIL_DEPTH) w.playerTrail.shift();

  smashProps(w, dtMs);
  /*
   * The turn budget, re-sized each step against how many bodies are actually
   * awake (`TOKENS_PER_AWAKE`). Free turns are the cap less the ones being
   * held, so the count is self-correcting: a body that dies or is staggered
   * mid-attack cannot leak a turn, and a cap that shrinks as a room is
   * cleared never goes negative.
   */
  {
    const awake = w.enemies.filter((e) => e.hp > 0 && e.awake && isActive(e)).length;
    const extra = Math.floor(awake / TOKENS_PER_AWAKE);
    const heldMelee = w.enemies.filter((e) => e.hasToken).length;
    const heldFire = w.enemies.filter((e) => e.hasFireToken).length;
    // The ramp holds the base down early: one turn in the opening rooms.
    const base = Math.min(ATTACK_TOKENS, rampFor(w.roomIndex).tokens);
    w.attackTokens = Math.max(0, base + extra - heldMelee);
    w.fireTokens = Math.max(0, Math.min(w.fireTokenCap, rampFor(w.roomIndex).tokens) + extra - heldFire);
  }
  // The roof giving on room 5 (doc 022): held bodies first, so none of them takes a turn this step.
  stepAudience(w, dtMs);
  // The king lives on his own clock (`bossTempo`): everything he does runs faster in phase III, with the music.
  for (const e of w.enemies) stepEnemy(w, e, dtMs * bossTempo(e));
  for (const e of w.enemies) if (e.archetype === "boss" && e.hp > 0) stepBoss(w, e, dtMs * bossTempo(e));
  for (const e of w.enemies) if (e.guardian) stepGuardian(w, e, dtMs);
  resolveBodies(w);
  w.enemies = w.enemies.filter((e) => {
    // Gone up out of the room (doc 022): off the floor, and nothing a death pays.
    if (e.gone) return false;
    // The first audience never kills him: held on the retreat's line, he leaves from it.
    const floor = kingFloorHp(e);
    if (floor > 0 && e.hp < floor) e.hp = floor;
    if (e.hp > 0) return true;
    onEnemyKilled(w, e);
    return false;
  });

  // What is placed and alive before its clock runs, for `afterimage` to see which ran out this step.
  const placedBefore = placedAlive(w);
  // Before the shots: an orb's strike is born on its body and lands this step.
  stepOrbs(w, dtMs);
  stepPlayerBullets(w, dtMs, items);
  stepEnemyBullets(w, dtMs);
  resolveEnemySwings(w);
  stepProps(w.props, dtMs);
  // A conjured pillar that has run its time crumbles: the cell is floor again
  // and the flow field is stale, exactly as when one is broken.
  for (const p of expiredProps(w.props)) {
    p.hp = 0;
    p.brokenMs = 600;
    clearPropCell(w.room.grid, p);
    w.flow = null;
    w.flowTile = null;
  }
  collectPickups(w, dtMs);
  stepHazards(w, dtMs);
  poisonGround(w, dtMs);
  stepLava(w, dtMs);
  stepGrass(w, dtMs);
  stepStatuses(w, dtMs);
  stepDashStrike(w, dtMs);
  stepVortices(w, dtMs);
  stepBeams(w, dtMs);
  stepEruptions(w, dtMs);
  stepDooms(w, dtMs);
  stepPets(w, dtMs, items);
  afterimages(w, placedBefore);
  stepSlams(w, dtMs, hookSim(w));
  stepWards(w, dtMs);
  slipstream(w);
  stepParticles(w, dtMs);
  if (w.streakMs > 0) w.streakMs -= dtMs;
  stepQuiet(w, dtMs);

  // Not while the boss is still to come (`World.awaitingBoss`): the hall is empty until he stands.
  if (!w.cleared && !w.awaitingBoss && worldCleared(w)) {
    w.cleared = true;
    w.events.push({ kind: "room_cleared", x: w.player.x, y: w.player.y });
    /*
     * **The fight's leftovers go with it.** A seed armed on the floor, a shot
     * still in the air, a crack still growing: with every body dead they are
     * a hit with nobody behind it, landing while the player walks to the
     * reward. Each is put out where it is.
     */
    if (w.stats.enemiesSpawned > 0) {
      for (const m of w.mines) w.events.push({ kind: "bullet_spent", x: m.x, y: m.y, what: "mine" });
      w.mines = [];
      for (const b of w.enemyBullets) if (b.alive) {
        b.alive = false;
        w.events.push({ kind: "bullet_spent", x: b.x, y: b.y, what: b.from });
      }
      w.lobs = [];
      w.rifts = [];
      w.shockwaves = [];
      w.arms = [];
    }
    if (w.offer && w.offer.cards.length > 0) {
      w.rewardPending = true;
      // Beside the player: with the room larger than the view, the middle was often off it.
      w.rewardDrop = placeRewardNear(w.room.grid, w.offer.cards[0]!.kind, w.player, hazardCells(w));
      w.events.push({
        kind: "reward_shown", x: w.rewardDrop.x, y: w.rewardDrop.y,
        what: w.rewardDrop.kind,
      });
    }
    // The chest stands beside whatever the room pays; it never stands in for the reward's gate.
    if (w.chestDue) placeChest(w);
    if (w.offer && w.offer.cards.length === 0) {
      /*
       * **A gold room scatters coins and opens.**
       *
       * There is nothing to choose, so there is nothing to interact with: the
       * decision was made at the portal that led here. Coins rather than a
       * number appearing on the HUD, because the payout should be *seen*, and
       * they magnetise once the room is clear so collecting them is not a
       * chore.
       *
       * Without this the room had no reward object at all, so `rewardPending`
       * was never set, so the portals never rose — a gold door was a dead end
       * that ended the run.
       */
      for (let i = 0; i < (w.offer.coins ?? GOLD_ROOM_COINS); i++)
        drop(w.pickups, "coin", w.player.x, w.player.y, w.rng);
      w.portals = portalsBefore(w.room.grid, w.room.extent, w.portalSpecs, w.player, w.portalKeepClear, hazardCells(w), w.viewHalf);
      raisePortals(w.portals);
      w.events.push({ kind: "portals_open", x: w.player.x, y: w.player.y });
    }
  }
  stepExits(w, dtMs, input.interact === true);
  return w;
}

/**
 * The two beats after a fight: take a reward, then walk into a portal.
 *
 * Run every frame rather than only while cleared, because the portals animate
 * from the first frame of the room — they are shut landmarks during the fight,
 * not something that appears at the end.
 */
function stepExits(w: World, dtMs: number, interact: boolean): void {
  stepPortals(w.portals, dtMs);
  stepReward(w.rewardDrop, dtMs);
  if (!w.exited) {
    const through = enteredPortal(w.portals, w.player, interact);
    if (through) {
      w.exited = through;
      w.events.push({
        kind: "portal_entered", x: through.x, y: through.y, what: through.type,
      });
    }
  }
}

/**
 * **The chest takes its ground** (doc 026): beside the reward, on the next
 * free cell but one so the two are told apart, never on a hazard; beside the
 * player when the room has no reward to stand by.
 */
function placeChest(w: World): void {
  w.chestDue = false;
  const avoid = new Set(hazardCells(w));
  const r = w.rewardDrop;
  if (r) {
    const rx = Math.floor(r.x / TILE_PX), ry = Math.floor(r.y / TILE_PX);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) avoid.add((ry + dy) * GRID_W + rx + dx);
  }
  const at = r ? placeChestBy(w.room.grid, r, avoid) : placeRewardNear(w.room.grid, "stat", w.player, avoid);
  w.chest = { x: at.x, y: at.y, open: false };
  w.events.push({ kind: "telegraph", x: at.x, y: at.y, what: "chest_shown" });
}

/** The cell two tiles to one side of the reward, left or right, or the nearest free one to it. */
function placeChestBy(grid: Uint8Array, r: { x: number; y: number }, avoid: Set<number>): { x: number; y: number } {
  const rx = Math.floor(r.x / TILE_PX), ry = Math.floor(r.y / TILE_PX);
  for (const [dx, dy] of [[2, 0], [-2, 0], [2, 1], [-2, 1], [2, -1], [-2, -1], [0, 2], [0, -2]] as const) {
    const x = rx + dx, y = ry + dy;
    if (x < 1 || y < 1 || x >= GRID_W - 1 || y >= GRID_H - 1) continue;
    if (grid[y * GRID_W + x] !== Tile.Floor || avoid.has(y * GRID_W + x)) continue;
    return { x: (x + 0.5) * TILE_PX, y: (y + 0.5) * TILE_PX };
  }
  return placeRewardNear(grid, "stat", r, avoid);
}

/** How close the player stands for the chest's prompt, and for the interact key to open it: the reward's reach. */
export const CHEST_REACH = TILE_PX * 1.4;

/** Whether the player stands close enough to open the chest. */
export function chestInReach(w: World): boolean {
  const c = w.chest;
  return !!c && !c.open && Math.hypot(w.player.x - c.x, w.player.y - c.y) <= CHEST_REACH;
}

/**
 * **The chest opens** (doc 026), when the player has taken what the card
 * shows: its gold bursts out and flies home. Its stat is the caller's to
 * hand over, since the run's modifiers are not the world's.
 */
export function openChest(w: World): void {
  const c = w.chest;
  if (!c || c.open) return;
  c.open = true;
  burstCoins(w.pickups, c.x, c.y, CHEST_GOLD, w.rng);
  for (const p of w.pickups) if (p.alive && p.kind === "coin") p.homing = true;
  w.events.push({ kind: "telegraph", x: c.x, y: c.y, what: "chest_opened" });
}

/** Floor tiles a point can see, sampled on the tile grid. */
function visibleFloor(grid: Uint8Array, x: number, y: number): number {
  let seen = 0;
  for (let ty = 0; ty < GRID_H; ty += 2)
    for (let tx = 0; tx < GRID_W; tx += 2) {
      if (grid[ty * GRID_W + tx] !== Tile.Floor) continue;
      if (hasLineOfSight(grid, x, y, (tx + 0.5) * TILE_PX, (ty + 0.5) * TILE_PX)) seen++;
    }
  return seen;
}

/**
 * Where an enemy actually appears.
 *
 * A stationary enemy tucked behind cover cannot see the room, and the room
 * cannot see it, so it stops being a fight and becomes a hunt: the play
 * harness produced two-minute rooms whose only survivor was a turret with a
 * wall in front of it. Movers keep their cell; a turret is walked to the
 * nearby cell with the best view.
 */
/**
 * The nearest cell to `cell` that is free floor and unclaimed, searched in
 * rings so the result is the closest one rather than the first scanned.
 * Falls back to the requested cell, which is the generator's guarantee, when
 * nothing within reach is free.
 */
/**
 * The floor the player can walk to, from where they stand.
 *
 * A generated room guarantees most of its floor is one region, not all of
 * it: a stub can wall off a pocket. A body placed in a pocket could never be
 * reached, and a stationary one never leaves — measured as a two-minute
 * timeout with a sentinel shot to half health by spells and nothing else.
 */
function reachableFloor(w: World): Uint8Array {
  return floodFill(w.room.grid, [Math.floor(w.player.x / TILE_PX), Math.floor(w.player.y / TILE_PX)]);
}

/**
 * Cells of the room's floor hazards — spikes, poison, ice, lava — where no
 * body is placed. A turret mount or grass is a feature and
 * not a hazard, so a turret still stands on its plinth.
 */
function floorHazardCells(w: World): Set<number> {
  return hazardCellsOf(w.room.zones);
}

function hazardCellsOf(zones: RoomPlan["zones"]): Set<number> {
  const out = new Set<number>();
  for (const z of zones) {
    if (z.feature === "none" || feature(z.feature).resource !== "floor_hazard") continue;
    for (const c of z.cells) out.add(c[1] * GRID_W + c[0]);
  }
  return out;
}

function nearestFreeCell(
  w: World, cell: readonly [number, number], taken: Set<number>,
): readonly [number, number] {
  const reach = reachableFloor(w);
  /*
   * **Never in a hazard**, where the floor offers anything else: a spawn cell
   * beside a poison pool resolved into it, and the body began its fight
   * standing in the poison. Only a room with no clear floor within reach
   * falls back to a hazard cell rather than to no cell.
   */
  const hazards = floorHazardCells(w);
  const ok = (x: number, y: number, clear: boolean): boolean => {
    if (x < 1 || y < 1 || x >= GRID_W - 1 || y >= GRID_H - 1) return false;
    const key = y * GRID_W + x;
    return w.room.grid[key] === Tile.Floor && !taken.has(key) && reach[key] === 1 && (!clear || !hazards.has(key));
  };
  for (const clear of [true, false]) {
    if (ok(cell[0], cell[1], clear)) return cell;
    for (let r = 1; r <= 4; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cell[0] + dx;
          const y = cell[1] + dy;
          if (ok(x, y, clear)) return [x, y];
        }
  }
  return cell;
}

function placeFor(
  w: World,
  archetype: EnemyId,
  cell: readonly [number, number],
  taken: Set<number>,
): { x: number; y: number } {
  /*
   * Every spawn resolves to a cell that is actually free floor.
   *
   * This used to hand back the group's cell unchecked for anything that
   * moves, on the reasoning that the generator guarantees spawn groups are
   * floor. It does — but the *world* can make a cell solid afterwards, and
   * once destructibles started writing themselves into the grid a crate on a
   * spawn point buried the body inside it. A buried enemy never wakes, cannot
   * be reached and cannot be hit, so the room can never be cleared: the
   * harness found it as a two-minute timeout with `insideWall=true`.
   *
   * Fixed here rather than by widening where props may stand, because the
   * guarantee that belongs at a spawn is "this body is somewhere it can
   * stand", and that should not depend on every future feature remembering to
   * keep clear of spawn cells.
   */
  const free = nearestFreeCell(w, cell, taken);
  const centre = { x: (free[0] + 0.5) * TILE_PX, y: (free[1] + 0.5) * TILE_PX };
  if (ENEMIES[archetype].behaviour !== "stationary") {
    /*
     * The cell and its four neighbours are taken, so the next body lands two
     * tiles off rather than one. A group's cells are few and `nearestFreeCell`
     * is greedy, so a wave of six used to stand in a tight clump on one spawn
     * point, which reads as a stack and fights as one body.
     */
    taken.add(free[1] * GRID_W + free[0]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
      taken.add((free[1] + dy) * GRID_W + free[0] + dx);
    return centre;
  }

  // `taken` matters: without it every turret in a wave walks to the single
  // best cell and they stack into one tile, which is four turrets firing
  // from one point and reads as a bug, because it is one.
  let best: { x: number; y: number } | null = null;
  let bestKey = -1;
  let bestSeen = -1;
  const reach = reachableFloor(w);
  // An emplacement never moves again, so one set down in a hazard stood in it all fight.
  const hazards = floorHazardCells(w);
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const tx = cell[0] + dx;
      const ty = cell[1] + dy;
      if (tx < 1 || ty < 1 || tx >= GRID_W - 1 || ty >= GRID_H - 1) continue;
      const key = ty * GRID_W + tx;
      if (taken.has(key) || hazards.has(key)) continue;
      if (w.room.grid[key] !== Tile.Floor || reach[key] !== 1) continue;
      const p = { x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX };
      const seen = visibleFloor(w.room.grid, p.x, p.y);
      if (seen > bestSeen) {
        bestSeen = seen;
        bestKey = key;
        best = p;
      }
    }
  if (!best) return centre;
  taken.add(bestKey);
  return best;
}

/**
 * The field only changes when the player changes tile, so a fight of a
 * thousand frames does a handful of sweeps rather than a thousand.
 */
function refreshFlow(w: World): void {
  const tile = tileOf(w.player.x, w.player.y);
  if (w.flow && w.flowTile && w.flowTile[0] === tile[0] && w.flowTile[1] === tile[1]) return;
  w.flow = computeFlowField(w.pathGrid, w.player.x, w.player.y);
  w.flowTile = tile;
}

function stepPlayer(w: World, input: Input, dtMs: number): void {
  const p = w.player;
  const dt = dtMs / 1000;
  if (p.invulnMs > 0) p.invulnMs -= dtMs;

  /*
   * Stunned: the input is dropped for this step.
   *
   * The clocks below still run — the cooldowns, the invulnerability, the
   * knockback — because a stun takes away what the player *does*, not what is
   * already happening to them. Read before the input is interpreted rather
   * than after, so a swing pressed during a stun is not queued to come out at
   * the end of it: being stunned means that press did not happen.
   */
  /*
   * Dragged by a hook: carried toward the snarecaster, and — like a stun —
   * the input does nothing until it lets go (research §2.4).
   */
  const dragged = dragStep(w, dtMs);
  const stunned = p.stunMs > 0 || dragged;
  if (p.stunMs > 0) p.stunMs -= dtMs;
  const dir = stunned ? { x: 0, y: 0 } : normalise(input.moveX, input.moveY);

  if (p.dashCooldownMs > 0) p.dashCooldownMs -= dtMs;
  if (p.dashMs > 0) p.dashMs -= dtMs;
  // Ticked separately, so the cover outlives the travel. See `DASH_IFRAME_MS`.
  if (p.dashIframeMs > 0) p.dashIframeMs -= dtMs;

  // A dash commits to the direction it started in, so it is a decision and
  // not a steering aid.
  if (input.dash && !stunned && p.dashMs <= 0 && p.dashCooldownMs <= 0) {
    // Dash outranks the sword, so it cancels a swing in progress rather than
    // being refused by it. One priority ordering instead of a cancel table.
    cancelSwing(p);
    // And a held charge: the dash is the answer to a charge gone wrong, so it
    // puts the charge out at no cost (doc 006).
    if (p.chargeKey >= 0) cancelCharge(p);
    // And a beam: the dash is the answer to standing in the open holding one.
    if (p.channelKey >= 0) endChannel(w);
    /*
     * And a stance (doc 006). The dash keeps its place above everything
     * (doc 013): it drops the guard at once, and the guard answers as it
     * would have had it run out — at its expiry share, round where the
     * player stood — so the key pressed is never a dead press, and the
     * dodge is never refused because a guard was up.
     */
    if (p.stance) answerStance(w, p.stance.expireShare);
    onDashStart(w, { x: p.x, y: p.y }, hookSim(w));
    p.dashMs = DASH_MS;
    // And the sword's rest: a dash starts a fresh run of swings, so moving is
    // how the player keeps up the pressure (see `SWING_BREATH_MS`).
    p.swingRun = 0;
    p.swingBreathMs = 0;
    p.slipFired = 0;
    p.dashIframeMs = DASH_IFRAME_MS;
    p.dashCooldownMs = DASH_MS + DASH_COOLDOWN_MS * p.mods.dashCooldown;
    // Along the held direction when there is one, and **along the facing when
    // there is not**. Requiring a direction key made the dodge a two-handed
    // chord, and a player who is standing still is exactly the player who
    // most needs to move.
    const along = dir.x !== 0 || dir.y !== 0
      ? dir
      : { x: Math.cos(p.facing), y: Math.sin(p.facing) };
    p.dashX = along.x;
    p.dashY = along.y;
    w.events.push({ kind: "dash", x: p.x, y: p.y });
  }

  // The swing is free and always available, so it is checked before movement:
  // committing to it is what costs the player their mobility for the duration.
  /*
   * A spin press is **kept for a moment** when it cannot start — mid-dash,
   * or a frame before the rage lands — so a press is never silently dropped:
   * it goes the moment it can, or not at all.
   */
  if (input.spin) p.spinBufferMs = SPIN_BUFFER_MS;
  const spun = p.spinBufferMs > 0 && !stunned && beginSpin(p, w);
  if (spun) {
    p.spinBufferMs = 0;
    // A beam's spin cast is its rays in turn (`queueSpinRays`); every other spell's, at the bodies.
    const beams = beamSpells(w);
    onSpin(w, hookSim(w), (i) => beams[i] === true);
    queueSpinRays(w);
  }
  else {
    /*
     * A press with no charge banked is **said**, not dropped in silence: the
     * key did nothing, and a key that does nothing without a word reads as
     * a dropped input — the same lesson `cast_refused` taught the spells.
     * Still kept, so a charge landing in the window spins.
     */
    if (input.spin && p.rage < SPIN_RAGE) w.events.push({ kind: "spin_refused", x: p.x, y: p.y, what: "rage" });
    // A dash is the player's own commitment, and short: the press waits it
    // out rather than running down under it.
    if (p.dashMs <= 0) p.spinBufferMs = Math.max(0, p.spinBufferMs - dtMs);
    if (input.swing && !stunned) {
      if (input.autoMeleeAim && canSwing(p)) {
        const facing = autoMeleeFacing(w);
        if (facing !== null) p.facing = facing;
      }
      beginSwing(p, w);
    }
  }

  const dashing = p.dashMs > 0;
  // A swing only ever slows the player and never pushes them. Forced
  // displacement reads as losing control, whichever direction it is in.
  const speed = (dashing ? DASH_SPEED * p.mods.dashRange : PLAYER_SPEED * p.mods.speed)
    * swingMoveScale(p)
    // Poisoned: a quarter off, for as long as it lasts.
    * (p.poisonMs > 0 && !dashing ? POISON_SLOW : 1)
    // Winding a spell up and recovering from it: the heavier, the slower.
    * (!dashing && (p.castPending >= 0 || p.castRecoverMs > 0 || p.chargeKey >= 0 || p.channelKey >= 0) ? p.castMoveScale : 1)
    // Holding a stance: planted, and slowed for as long as it holds.
    * (!dashing && p.stance ? p.stance.moveScale : 1);
  const move = dashing ? { x: p.dashX, y: p.dashY } : dir;
  /*
   * Sliding: on ice the player keeps the velocity they had and steers it
   * rather than setting it.
   *
   * The blend is heavily weighted to what is already carried, so a change of
   * direction takes about a quarter of a second to take effect — enough to
   * overshoot a turn, which is the entire mechanic, and not enough to feel
   * like the controls have been taken away.
   */
  /*
   * A dash is not steered by ice. It used to be, and its speed became the
   * carried slide: once it ended the player kept travelling at dash pace
   * while the blend wound down, a quarter second at three times walking
   * speed — a dodge across ice shot them clean across the room. The dash
   * moves as a dash anywhere, and leaves behind only walking momentum.
   */
  if (p.slipMs > 0 && !dashing) {
    const want = { x: move.x * speed, y: move.y * speed };
    const k = Math.min(1, dt / 0.25);
    p.slideX += (want.x - p.slideX) * k;
    p.slideY += (want.y - p.slideY) * k;
    moveSliding(w.room.grid, p, p.slideX * dt, p.slideY * dt, PLAYER_RADIUS);
  } else {
    const carried = dashing ? PLAYER_SPEED * p.mods.speed : speed;
    p.slideX = move.x * carried;
    p.slideY = move.y * carried;
    if (move.x !== 0 || move.y !== 0) {
      moveSliding(w.room.grid, p, move.x * speed * dt, move.y * speed * dt, PLAYER_RADIUS);
    }
  }

  /*
   * The shove from the last hit, applied on top of whatever the player is
   * doing rather than instead of it — control is never taken away, the body
   * is only carried. It decays fast: it is punctuation, not a knockdown.
   */
  if (p.hurtMs > 0) {
    p.hurtMs -= dtMs;
    moveSliding(w.room.grid, p, p.hurtX * dt, p.hurtY * dt, PLAYER_RADIUS);
    p.hurtX *= 0.82;
    p.hurtY *= 0.82;
  }

  p.aim = { x: input.aimX, y: input.aimY };
  // Facing comes from movement, snapped to four, and **keeps updating during
  // a swing**. Freezing it made the next hit come out in the old direction,
  // which is what "cannot change direction mid-attack" actually was. The live
  // hitbox still holds the centre it was given, so turning re-aims the next
  // hit rather than widening this one.
  p.facing = snapFacing(dir.x, dir.y, p.facing);
}

/**
 * Advances the player's swing and applies whatever it connected with.
 *
 * Damage, knockback, impact feedback and the mana return all live here rather
 * than in `melee.ts`, which owns the geometry and the timing and nothing else.
 * That split is what lets the arc be tested without a world.
 */
function resolveSwing(w: World, dtMs: number): void {
  const struck = stepSwing(w, dtMs);
  // Scenery is checked whether or not a body was hit, so a swing into a crate
  // is not wasted just because nothing was standing behind it.
  breakProps(w);
  if (struck.length === 0) return;

  const box = w.swing;
  for (const e of struck) {
    // A blow of the swing proper, not the spin's: the one kind of kill a streak counts.
    w.swordBlow = w.player.swingStretch === 1;
    const swordPoise = w.player.swingStretch !== 1 ? SPIN_POISE : box.finisher ? SWORD_FINISHER_POISE : SWORD_POISE;
    const { broke, blocked } = hurtEnemy(w, e, box.damage, e.awake ? "" : "sneak", w.player, box.damage * swordPoise);
    w.swordBlow = false;
    // Off the roaring king: no damage, no gauge, no mana — only the clang and a jolt.
    if (blocked) { impact(w, HITSTOP_HIT, TRAUMA_HIT); continue; }
    w.stats.damageDealt += box.damage;
    w.stats.swordDamage += box.damage;
    e.hitFlashMs = HIT_FLASH_MS;
    // The sword fills the rage gauge: a little per connecting blow, more for
    // the one that kills. A spin's own hits do not refund it.
    if (w.player.swingStretch === 1)
      gainRage(w, e.hp <= 0 ? RAGE_PER_KILL : RAGE_PER_HIT);
    resonate(w, e);
    lodgeBlades(w, e);

    // Knockback away from the swing's origin, scaled down for heavy bodies so
    // a tank is shoved and a rusher is thrown.
    // A stationary body is bolted down. A turret that slides when struck is a
    // turret the player has to chase, and chasing an emplacement is absurd.
    if (ENEMIES[e.archetype].behaviour !== "stationary") {
      const dx = e.x - box.x;
      const dy = e.y - box.y;
      const d = Math.hypot(dx, dy) || 1;
      const push = box.knockback / Math.max(1, e.radius / 10);
      e.knockX += (dx / d) * push;
      e.knockY += (dy / d) * push;
    }

    // Being hit is the loudest way to be noticed, and it flinches a body that
    // is not already attacking (`swordStagger`).
    wake(w, e);
    // Breaking its poise is the one blow that cancels what it had started; the break staggered it already (`hurtEnemy`).
    if (broke) e.staggerImmuneMs = SWORD_STAGGER_IMMUNE_MS; else swordStagger(w, e);
    impact(w, box.finisher ? HITSTOP_FINISH : HITSTOP_HIT, TRAUMA_HIT);

    // The loop the whole design turns on: the sword pays for the spells, so
    // being in range is how the player affords being out of it.
    w.player.mana = Math.min(w.staff.mana_max, w.player.mana + manaPerHit(w.staff.mana_max) * w.player.mods.manaPerHit);

    w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: e.archetype, amount: box.damage });
    emit(w, e.x, e.y, "hit", 4);
    // Not `onEnemyKilled` here. The death filter in `step` is the one place a
    // body leaves the world, and calling the handler from the sword as well
    // fired it **twice** per kill — double loot, double hitstop, and a boss
    // room that reported two or three kills of its one boss.
  }
}

/**
 * The player's swing against scenery.
 *
 * Dedup rides on the swing box's own `hitIds`, offset past the player's slot,
 * so one swing breaks each prop once however many frames it spends inside it —
 * the same rule bodies get.
 */
function breakProps(w: World): void {
  const box = w.swing;
  if (!box.active) return;
  for (let i = 0; i < w.props.length; i++) {
    const p = w.props[i]!;
    if (p.hp <= 0) continue;
    if (!propHit(p, box.x, box.y, 0) && !sectorHits(box, p, p.radius)) continue;
    const id = PROP_HIT_ID_BASE - i;
    if (box.hitIds.includes(id)) continue;
    box.hitIds.push(id);
    damageProp(w, p, box.damage, true);
  }
}

/** Prop dedup ids, below the player's, so one list serves both. */
const PROP_HIT_ID_BASE = -2;

/**
 * Damage to an enemy, and to its poise.
 *
 * Centralised because poise has to be honoured wherever damage comes from,
 * and it arrives from five places: the sword, player bullets, burning ground,
 * a lightning strike and the burn tick. Applying it at one of them and not the
 * others is how a rule becomes a suggestion.
 *
 * Returns whether the hit broke its poise (`Enemy.poise`), which is its own
 * moment: the burst has knocked the body into a long stagger, and that has to
 * be announced rather than inferred from the body suddenly flinching.
 */
/**
 * `tag` says what dealt it, for the damage number's colour: an element
 * (fire, ice, poison) or a spell school, or nothing for the sword.
 */
export function hurtEnemy(
  w: World, e: Enemy, raw: number, tag = "", from?: { x: number; y: number },
  /**
   * What the blow does to the body's poise (doc 027), which is not what it
   * does to its health: a sword blow or a heavy spell is mass, a spray of
   * sparks is not. Every caller names it (`poiseOfWeight`, `SWORD_POISE`); a
   * burn, a cloud or lava leaves it at 0, since a tick is not a blow.
   */
  poiseDamage = 0,
): { broke: boolean; blocked?: boolean } {
  // The king roaring cannot be hurt (`Enemy.bossRoarMs`): the blow rings off him.
  if (e.bossRoarMs > 0) {
    if (raw > 0 && from) w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: "boss_immune" });
    return { broke: false, blocked: true };
  }
  /*
   * **Shatter.** The first hit on a frozen body breaks the ice and lands at
   * three times its damage: freezing is the setup, and this is the payoff
   * that makes ice a build rather than a slow.
   */
  let mult = 1;
  /*
   * **The ambush.** The first hit on a body that had not noticed the player
   * lands at double: sneaking up on a sleeper, or on a guard from outside its
   * cone, is worth doing (research: a body killed before it wakes should be
   * worth something).
   */
  if (tag === "sneak" && raw > 0) mult = AMBUSH_MULT;
  // **Breadth pays**: a body carrying two different elements takes more from
  // everything. See `STATUS_BREADTH_MULT`.
  if (raw > 0 && statusBreadth(e) >= 2) mult *= STATUS_BREADTH_MULT;
  if (e.frozenMs > 0 && raw > 0) {
    mult = SHATTER_MULT;
    e.frozenMs = 0;
    e.chillBuild = 0;
    e.slowMs = 0;
    tag = "shatter";
    impact(w, HITSTOP_KILL, TRAUMA_KILL);
    emit(w, e.x, e.y, "kill", 10);
    w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "shatter" });
  }
  // What the body is made of: an element it resists does less, one it is
  // immune to nothing at all (`EnemyDef.resist`).
  const resist = tag ? resistOf(e.archetype, tag) : 1;
  if (resist === 0) return { broke: false };
  mult *= resist;
  // The Frontier Veteran on its knees takes more from everything: the window the stance paid for (doc 024).
  if (e.guardian && e.guardian.brokenMs > 0) mult *= GUARDIAN_BROKEN_TAKEN;
  // Damage is a whole number: rounded down, never below one.
  const amount = raw > 0 ? Math.max(1, Math.floor(raw * mult * w.dealtMult)) : 0;
  /*
   * **A hit stops a toll** (doc 005, the bellringer). Any damage at all, on
   * armour or on health: the point of the move is that it can be answered, so
   * it is answered by reaching the ringer, not by out-damaging its shield.
   */
  if (amount > 0) interruptToll(w, e);
  if (amount > 0)
    w.events.push({ kind: "damage", x: e.x, y: e.y - e.radius, what: `hp${tag ? `:${tag}` : ""}`, amount });
  e.hp -= amount;
  // The blow's weight, by what it hit through: what made the damage larger makes the blow heavier.
  const poiseHit = amount > 0 ? poiseDamage * mult * w.dealtMult : 0;
  /*
   * **The Frontier Veteran's poise is its stance** (doc 024): the gold bar
   * over its head, which the same blows fill, and whose break puts it on its
   * knees. It is the fight's big payoff, and it lands as one: held longer than
   * a kill. It has no second, smaller poise under it — the bar every body
   * shows is the one that interrupts it.
   */
  if (e.guardian) {
    if (poiseHit > 0 && e.hp > 0 && wearStance(w, e, poiseHit)) {
      impact(w, HITSTOP_CAP, TRAUMA_KILL);
      emit(w, e.x, e.y, "kill", 14);
      return { broke: true };
    }
    return { broke: false };
  }
  /*
   * **Poise** (`Enemy.poise`, doc 027): all of the damage is health, and the
   * blow's weight (`poiseDamage`) wears the poise. A hit it holds through is
   * shown on the body's bar, and rings off a plated body with sparks; the hit
   * that wears it through knocks it into a long stagger and cancels what it
   * had started. After a break it cannot be broken again for a while
   * (`POISE_GUARD_MS`).
   */
  if (poiseHit <= 0 || e.maxPoise <= 0 || e.hp <= 0 || e.archetype === "boss") return { broke: false };
  e.poiseIdleMs = 0;
  if (e.poiseGuardMs > 0) {
    if (plated(e)) w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: `poise_hold:${e.archetype}` });
    return { broke: false };
  }
  e.poise -= poiseHit;
  if (e.poise > 0) {
    if (plated(e)) w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: `poise_hold:${e.archetype}` });
    return { broke: false };
  }
  e.poise = e.maxPoise;
  const held = breakStaggerMs(e);
  e.poiseGuardMs = held + POISE_GUARD_MS;
  e.poiseBreakMs = POISE_BREAK_MS;
  stagger(w, e, held, true);
  // A body with a bar is stunned by its break, with the stars that say so (`BARRED_BREAK_STUN_MS`).
  if (showsPoise(e)) e.stunMs = Math.max(e.stunMs, held);
  // A break is worth more than the hit that caused it: the fight changes.
  impact(w, HITSTOP_KILL, TRAUMA_KILL);
  w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: `poise_break:${e.archetype}` });
  emit(w, e.x, e.y, "kill", 8);
  return { broke: true };
}

function damageProp(w: World, p: Destructible, amount: number, bySword = false): void {
  // Carved stone rings when struck and that is all it does.
  if (!breakable(p)) { p.hitFlashMs = HIT_FLASH_MS; return; }
  p.hp -= amount;
  p.hitFlashMs = HIT_FLASH_MS;
  if (p.hp > 0) {
    w.events.push({ kind: "enemy_hit", x: p.x, y: p.y, what: `prop:${p.kind}` });
    emit(w, p.x, p.y, "hit", 3);
    return;
  }
  /*
   * Broken: the cell becomes floor, the flow field is invalidated so enemies
   * use the lane immediately, and a player who broke it with the sword is
   * paid in mana.
   *
   * Mana rather than gold or health because it is the resource the design
   * starves on purpose — the sword supplies it and spells spend it — so
   * scenery becomes part of that loop instead of a decoration with a reward
   * stapled on.
   */
  clearPropCell(w.room.grid, p);
  w.flow = null;
  w.flowTile = null;
  impact(w, HITSTOP_HIT, TRAUMA_HIT);
  // A conjured pillar is the player's own spell: breaking it pays nothing,
  // or a ward would be a coin purse the player raises and smashes.
  // And only the sword's blow pays mana: the sword supplies, spells spend,
  // and a spell that broke a crate refunded itself.
  if (p.kind !== "pillar") {
    if (bySword) w.player.mana = Math.min(
      w.staff.mana_max, w.player.mana + w.staff.mana_max * PROP_MANA_FRACTION,
    );
    dropPropLoot(w, p.x, p.y);
  }
  w.events.push({ kind: "enemy_killed", x: p.x, y: p.y, what: `prop:${p.kind}` });
  emit(w, p.x, p.y, "kill", 6);
}

/**
 * Applies burning-ground damage. Split from `fire.ts` for the same reason the
 * swing is: that module owns the geometry and the clocks, and this one owns
 * what damage means, which is where invulnerability and the death path live.
 */
/**
 * The burn a tick of the player's ground fire adds, as a share of a hit's
 * (`applyElementTo` floors power at 0.5). At a 520 ms tick a body standing
 * in it catches in about three seconds — slower than being shot, since it
 * costs nothing to keep standing a body in it.
 */
/*
 * **Standing in fire is a slow toll that lights a fast one.** The ground asks
 * once a second for a point (`FIRE_TICK_MS`, `FIRE_ENEMY_DAMAGE`), and this
 * is how quickly it sets what stands in it alight: at 1.4 a tick the gauge
 * fills on the second one, so a body that lingers catches in about two
 * seconds and then burns at four ticks a second, which is where a fire
 * spell's damage belongs.
 *
 * It is the *hazard* that was overtuned, not the gauge: at four damage twice
 * a second, overlapping patches made Wildfire Field 6.2 times the pool's pack
 * median. Slowing and shrinking the toll fixed that without making a field
 * bad at the one thing it is for, which is setting things on fire.
 */
const GROUND_BURN_POWER = GROUND_STATUS_POWER;

/*
 * **A body burns once for standing in fire, however many fires it is standing
 * in.** Every patch kept its own clock and billed every body inside it, so
 * overlapping patches multiplied: Wildfire Field drops one a cast, a held key
 * lays four or five over the same ground, and each of them billed the same
 * body its toll *and* fed its burn gauge — which is why the spell measured at
 * five times the sword's pack clearing and why shrinking the patch or
 * shortening its life changed nothing (the pack stands in the overlap either
 * way, and a recast renews it).
 *
 * So the toll is the **body's**, not the patch's: one tick per `FIRE_TICK_MS`
 * per body, and the second patch to reach it that second does nothing. A
 * field is still the best key against a crowd — it bills six bodies where a
 * bolt bills one — but re-lighting ground that is already alight is worth
 * nothing, which is the honest rule and the one a player can see.
 */
function resolveFires(w: World, dtMs: number): void {
  stepScorches(w, dtMs);
  const { enemies, playerBurning } = stepFires(w, dtMs);
  if (playerBurning) feedBurn(w, BURN_BUILD_PER_S * (dtMs / 1000));
  for (const e of w.enemies) if (e.groundBurnMs > 0) e.groundBurnMs -= dtMs;
  for (const e of w.enemies) if (e.groundPoisonMs > 0) e.groundPoisonMs -= dtMs;
  for (const e of w.enemies) if (e.groundChillMs > 0) e.groundChillMs -= dtMs;
  slowInClouds(w);
  for (const { id, damage, owner, statusMult, powers, proc, element } of enemies) {
    const e = w.enemies.find((x) => x.id === id);
    if (!e || e.hp <= 0) continue;
    // What flies passes over the room's own fire; the player's is a spell,
    // and a spell reaches whatever it was aimed at.
    if (ENEMIES[e.archetype].flying && owner !== "player") continue;
    if (element === "poison") {
      poisonCloudTick(w, e, damage, statusMult, powers, proc);
      continue;
    }
    if (element === "ice") {
      frostTick(w, e, damage, statusMult, powers, proc);
      continue;
    }
    // Already billed this second by some other patch: see above.
    if (e.groundBurnMs > 0) continue;
    e.groundBurnMs = FIRE_TICK_MS;
    /*
     * Burning ground feeds a cinderling rather than hurting it — but **only
     * the player's**.
     *
     * Its own fire lighting it was a loop with no exit: it lobs a coal, walks
     * into the pool, catches, trails fire while it burns, stands in the trail,
     * which refreshes the burn, and so on until the room is alight and the
     * body has been on fire since the first throw. What the design asks for
     * is "the player's element turned around" — the risk of answering a coal
     * with fire — so the player's fire is the only thing that lights it, and
     * enemy-owned fire (its own coals, its trail, a summoner's flame) feeds
     * it a little health and nothing else.
     */
    if (baseArchetype(e.archetype) === "cinderling") {
      e.hp = Math.min(e.maxHp, e.hp + damage);
      if (owner === "player") {
        e.burnMs = Math.max(e.burnMs, 1500);
        e.burnBuild = Math.min(1, e.burnBuild + 0.25);
      }
      continue;
    }
    hurtEnemy(w, e, damage, "fire");
    /*
     * **The player's burning ground builds the burn gauge**, a share of a
     * hit's worth each tick. It only dealt its tick, so a body stood in a
     * bloom or a wildfire and never caught — the one place fire is meant to
     * set things alight was the one place it could not.
     */
    /*
     * Burning ground burns by its nature, and carries anything else the spell
     * that lit it holds — a field with `rime` or `blight` on it chills or
     * poisons what stands in it, because that is what the card said.
     */
    /*
     * Its fire adds to the ground's own: `kindle` on a field says the ground
     * burns faster, and at the ground's figure alone the card attached and
     * changed nothing — `affix-shapes.test.ts` found it.
     */
    if (owner === "player") {
      applyElementTo(e, "fire", GROUND_BURN_POWER + powers.fire * proc, statusMult);
      if (powers.poison > 0) applyElementTo(e, "poison", powers.poison * proc, statusMult);
      if (powers.ice > 0) applyElementTo(e, "ice", powers.ice * proc, statusMult);
    }
    e.hitFlashMs = HIT_FLASH_MS;
    w.stats.damageDealt += damage;
    w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "fire" });
    // See `resolveSwing`: the death filter owns the kill.
  }
}

/**
 * How hard a tick of the player's poison cloud poisons what stands in it, as
 * a share of a hit's (the cloud's `GROUND_BURN_POWER`): the gauge fills on
 * the second tick, as burning ground lights on its second, so a body that
 * stays in the cloud is poisoned in about two seconds and every tick after
 * deepens it.
 */
const CLOUD_POISON_POWER = GROUND_STATUS_POWER;
/**
 * How long a body stays slowed after it was last inside a cloud. Short: the
 * slow is the cloud's, read every step, and it lets go a moment after the
 * body is out.
 */
const CLOUD_SLOW_MS = 250;

/**
 * **A poison field slows what stands in it** (doc 006), every step rather
 * than on the tick: the slow is the ground's grip, not a status it builds.
 * The cloud is the player's spell, so it reaches what flies too.
 */
function slowInClouds(w: World): void {
  for (const f of w.fires) {
    if (!f.alive || f.element === "fire" || f.owner !== "player") continue;
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.spawnFadeMs > 0) continue;
      if (!circlesOverlap(f.x, f.y, f.radius, e.x, e.y, e.radius)) continue;
      e.slowMs = Math.max(e.slowMs, CLOUD_SLOW_MS);
    }
  }
}

/**
 * **A poison field's tick** (doc 006): the cloud's small toll as poison
 * damage, and its poison into the body's gauge — never a burn. Like burning
 * ground, a body pays once a tick however many clouds it stands in
 * (`groundPoisonMs`), and the cloud carries whatever else the spell holds on
 * top (`kindle`, `rime`), because the card said it would. It feeds no
 * cinderling: a cinderling eats fire, and this is not fire.
 */
function poisonCloudTick(
  w: World, e: Enemy, damage: number, statusMult: number, powers: ElementPowers, proc: number,
): void {
  if (e.groundPoisonMs > 0) return;
  e.groundPoisonMs = CLOUD_TICK_MS;
  hurtEnemy(w, e, damage, "poison");
  applyElementTo(e, "poison", CLOUD_POISON_POWER + powers.poison * proc, statusMult);
  if (powers.fire > 0) applyElementTo(e, "fire", powers.fire * proc, statusMult);
  if (powers.ice > 0) applyElementTo(e, "ice", powers.ice * proc, statusMult);
  e.hitFlashMs = HIT_FLASH_MS;
  w.stats.damageDealt += damage;
  w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "poison" });
}

/**
 * **A frost field's tick**: the ground's small toll as ice damage, and its
 * chill into the body's gauge toward a freeze — the cloud's shape with ice in
 * it, on its own clock (`groundChillMs`), carrying whatever else the spell holds.
 */
function frostTick(
  w: World, e: Enemy, damage: number, statusMult: number, powers: ElementPowers, proc: number,
): void {
  if (e.groundChillMs > 0) return;
  e.groundChillMs = CLOUD_TICK_MS;
  hurtEnemy(w, e, damage, "ice");
  applyElementTo(e, "ice", CLOUD_POISON_POWER + powers.ice * proc, statusMult);
  if (powers.fire > 0) applyElementTo(e, "fire", powers.fire * proc, statusMult);
  if (powers.poison > 0) applyElementTo(e, "poison", powers.poison * proc, statusMult);
  e.hitFlashMs = HIT_FLASH_MS;
  w.stats.damageDealt += damage;
  w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "frost" });
}

/**
 * Advances every enemy's lightning marker and lands the ones that are due.
 *
 * A strike hits once and is over, so there is no retrigger rule to get wrong,
 * and it leaves the same burn mark a fire does, so the floor reads the same
 * way whichever kind made the mark.
 */
function resolveStrikes(w: World, dtMs: number): void {
  for (const e of w.enemies) {
    if (!stepStrike(e.strike, dtMs)) continue;
    const s = e.strike;
    scorch(w, s.x, s.y, s.radius);
    /*
     * The beacon's ground keeps burning (doc 019). The turret denies a place
     * for an instant, so the player steps out and steps back; the beacon takes
     * that ground out of play while it burns, so the answer is to leave and
     * stay left. Same marker, same 900 ms, same bolt — one verb changed.
     */
    if (e.archetype === "beacon") lightFire(w, s.x, s.y, "enemy", { radius: s.radius * 0.8, lifeMs: 2000 });
    impact(w, HITSTOP_HIT, TRAUMA_KILL);
    w.events.push({ kind: "hazard_tick", x: s.x, y: s.y, what: "lightning" });
    emit(w, s.x, s.y, "hit", 6);
    if (strikeHits(s, w.player.x, w.player.y, PLAYER_RADIUS)) {
      hurtPlayer(w, w.player.x, w.player.y, "lightning", STUN_LIGHTNING_MS, LIGHTNING_HEARTS * e.damageMult);
    }
    // It strikes from above and hits whatever is standing there, which is what
    // makes it a hazard the enemies can walk into as well.
    for (const other of w.enemies) {
      if (other.hp <= 0 || other.spawnFadeMs > 0) continue;
      if (!strikeHits(s, other.x, other.y, other.radius)) continue;
      hurtEnemy(w, other, FIRE_ENEMY_DAMAGE * 2);
      other.hitFlashMs = HIT_FLASH_MS;
      w.stats.damageDealt += FIRE_ENEMY_DAMAGE * 2;
      if (other.hp <= 0) onEnemyKilled(w, other);
    }
  }
}

/** No wave lands more bodies than this at once; the rest follow as a wave of their own. */
const WAVE_CHUNK = 5;
/**
 * A later wave waits for the room to thin out: it releases when its time has
 * come **and** no more than this many bodies are still up. A room where the
 * second wave lands on a first that is still standing is two fights at once,
 * which is the thing the player reported as unmanageable.
 */
const WAVE_GATE_ALIVE = 3;
/**
 * ...plus this many, because a reinforcement **commutes**.
 *
 * A wave lands out of the view and walks in (`reinforcementCell`), which is
 * about two seconds of floor it crosses before it is part of anything.
 * Releasing it only once the room was already down to the gate meant those
 * two seconds were always spent on an empty screen: measured, a wave walking
 * in was 5.2% of all uncleared room time, a quarter of the empty time in the
 * game. Called two bodies earlier, it arrives as the last of the group in
 * front of the player falls, and the gate's real job — that a wave never
 * lands *on* a fight still going — is unchanged, because the fight is over by
 * the time it gets there.
 */
const WAVE_PRE_RELEASE = 1;
/**
 * **What the room's pacing answer means** (doc 019).
 *
 * The Director picks how hard the room presses; these are the two knobs that
 * decide it, and they are the only thing the answer changes. Everything that
 * makes a fight *safe* — the alive cap, the ceiling on a gated release, the
 * minimum gap between waves — stays in code and is untouched by the answer.
 *
 * - `preRelease` is how many bodies may still be standing when the next beat
 *   is called. 0 waits for the floor to clear, which is the breather; 2 sends
 *   the next beat while the player is still finishing this one.
 * - `gapMs` is the nominal spacing of the beats the plan lays out.
 */
export const PACING: Readonly<Record<WaveStructure, { readonly preRelease: number; readonly gapMs: number }>> = {
  breathe: { preRelease: 0, gapMs: 4800 },
  steady: { preRelease: 1, gapMs: 3500 },
  relentless: { preRelease: 2, gapMs: 2400 },
};

/** The pacing this room was given, or the middle of the three. */
function pacingOf(w: World): { preRelease: number; gapMs: number } {
  return w.pacing;
}
/** ...but never waits longer than this past its time, so a room cannot stall. */
const WAVE_GATE_MAX_WAIT_MS = 16000;
/**
 * ...and even then never past the most bodies a gated release leaves up. The
 * ceiling alone released a chunk every 16 s to a player who was not killing,
 * until the whole roster stood at once — seventeen bodies in view, past doc
 * 005's cap of twelve, which the plan was checked against and the floor was not.
 */
const WAVE_CEILING_ALIVE = WAVE_GATE_ALIVE + WAVE_CHUNK;
/**
 * Waves after the opening never land closer together than this, gate or no
 * gate. Chunks cut from one planned wave share a time, so when the ceiling
 * released one it released the rest on the following frames — two waves
 * arriving as one, which is exactly what the gate exists to prevent.
 */
const WAVE_MIN_GAP_MS = 2000;
/** The nominal spacing of a room's beats; the gate decides when one lands. */
const BEAT_GAP_MS = 3500;

/**
 * Splits any wave larger than `WAVE_CHUNK` into consecutive waves at the same
 * time, which the live gate then spaces out. The plan's roster and order are
 * kept; only how many arrive together changes.
 */
function chunkWaves(waves: World["pendingWaves"], roomIndex = 99): World["pendingWaves"] {
  const out: World["pendingWaves"] = [];
  // The ramp's chunk: an early room's waves arrive two at a time, not five.
  // A beat arrives as a beat: the chunk is the ramp's own wave size.
  const chunk = Math.max(WAVE_CHUNK, rampFor(roomIndex).perWave);
  for (const wave of waves) {
    const flat: { archetype: EnemyId; group: string }[] = [];
    for (const s of wave.spawns) for (let i = 0; i < s.count; i++) flat.push({ archetype: s.archetype, group: s.group });
    for (let i = 0; i < flat.length; i += chunk) {
      const slice = flat.slice(i, i + chunk);
      const spawns: { archetype: EnemyId; group: string; count: number }[] = [];
      for (const f of slice) {
        const same = spawns.find((s) => s.archetype === f.archetype && s.group === f.group);
        if (same) same.count++;
        else spawns.push({ archetype: f.archetype, group: f.group, count: 1 });
      }
      out.push({ atMs: wave.atMs, spawns });
    }
  }
  return out;
}

/**
 * **The ramp's hard filter on a plan** (doc 005). An encounter is assembled
 * against a pressure band, which says how *intense* a fight should be and
 * nothing about how much game the player has had — so a room at index 1 was
 * being handed a seventeen-body trickle. Everything past the ramp's roster is
 * dropped, in the order the plan listed it, so what is kept is the front of
 * the fight the Director asked for rather than a different one.
 *
 * It is here, at the world, rather than in the assembler, because this is the
 * last place before the bodies exist: whatever either arm chose and whatever
 * fallback preset it reached, an early room is a small room.
 */
type PendingWave = World["pendingWaves"][number];
function trimToRamp(
  waves: readonly PendingWave[], roomIndex: number, fight: boolean, gapMs = BEAT_GAP_MS,
): PendingWave[] {
  const ramp = rampFor(roomIndex);
  /*
   * Everything the plan asked for, flattened and **dealt lightest first**.
   * The plan's own order puts the anchor at the front, which makes the first
   * beat the heaviest and every beat after it an anticlimax; a room should
   * open with a statement and end with one. Sorting by threat weight is the
   * cheapest thing that makes wave 1 the scene and the last wave the climax.
   */
  const flat: PendingWave["spawns"][number][] = [];
  for (const wave of waves)
    for (const s of wave.spawns)
      for (let i = 0; i < s.count; i++) flat.push({ ...s, count: 1 });
  flat.sort((a, b) => threatWeight(a.archetype) - threatWeight(b.archetype));

  /*
   * Then cut into beats. Each carries `perWave`, and the last — the climax —
   * may carry `climaxBonus` more, which is where the heaviest bodies land
   * because the deal was sorted. A plan with more waves than the ramp allows
   * is *not* stretched: it is told in this many beats or fewer, so a trickle
   * of eight arrivals becomes three (doc 005, the beat structure).
   */
  const out: PendingWave[] = [];
  const first = waves[0]?.atMs ?? 0;
  /*
   * **Never fewer beats than the bodies need, and never a room with none.**
   * Packing greedily by `perWave` collapsed a small plan into one beat — two
   * bodies at the late ramp became a single wave of two, and the room lost
   * its second half. The count comes from the bodies, capped by the ramp, and
   * is at least one whenever the plan had anything at all: a combat room with
   * an empty roster is a free reward room, which must never happen.
   */
  /*
   * **A fight room is never empty, and never a formality.** Below the ramp's
   * minimum the roster is padded from its own lightest bodies — the plan's
   * shape is kept, there is just enough of it — and a plan with nothing at
   * all gets rushers, which is the roster's floor. See `rampMinimum`.
   */
  // Only where a fight was actually planned: a world built with no encounter
  // at all is a fixture or a vendor's room, not a fight that came out empty.
  const floor = fight && waves.length > 0 ? rampMinimum(roomIndex) : 0;
  while (flat.length < floor) {
    const seed = flat[flat.length % Math.max(1, flat.length)]
      ?? { archetype: "rusher" as EnemyId, group: waves[0]?.spawns[0]?.group ?? "", count: 1 };
    flat.push({ ...seed, count: 1 });
  }
  const total2 = Math.min(flat.length, Math.max(floor, rampRoster(roomIndex)));
  if (total2 <= 0) return [];
  const beats = Math.max(1, Math.min(ramp.waves, Math.ceil(total2 / ramp.perWave)));
  const per = Math.floor(total2 / beats);
  const pool = flat.slice(0, total2);
  const seen = new Set<EnemyId>();
  let taken = 0;
  for (let k = 0; k < beats; k++) {
    const last = k === beats - 1;
    // The remainder falls to the climax, which is also where the heavy bodies
    // are: the deal was sorted lightest first.
    const room = last ? total2 - taken : per;
    const slice = pool.slice(taken, taken + room);
    /*
     * **A later beat is never just more of the same.** The weight sort alone
     * can hand a room three beats of rushers with the tank at the end, which
     * escalates in size and asks the same question three times. If a beat
     * would introduce nothing the player has not already met, one body of it
     * is swapped for the nearest unseen archetype further down the pool — the
     * nearest, so the beat is still about as heavy as its place in the room.
     */
    if (k > 0 && slice.every((f) => seen.has(f.archetype))) {
      const fresh = pool.findIndex((f, i) => i >= taken + room && !seen.has(f.archetype));
      if (fresh >= 0) {
        const swap = slice.length - 1;
        [pool[taken + swap], pool[fresh]] = [pool[fresh]!, pool[taken + swap]!];
        slice[swap] = pool[taken + swap]!;
      }
    }
    for (const f of slice) seen.add(f.archetype);
    taken += room;
    const spawns: PendingWave["spawns"] = [];
    for (const f of slice) {
      const same = spawns.find((x) => x.archetype === f.archetype && x.group === f.group);
      if (same) same.count++;
      else spawns.push({ ...f, count: 1 });
    }
    // The opening beat stands with the room; the rest are called by the gate.
    // Spaced, so each beat has a time of its own; the gate still holds it
    // until the floor thins and the breather has passed.
    out.push({ atMs: k === 0 ? first : first + k * gapMs, spawns });
  }
  return out;
}

function releaseWaves(w: World): void {
  /*
   * One wave at a time. The first wave stands with the room; every later
   * one waits for its time **and** for the floor to thin to `WAVE_GATE_ALIVE`
   * bodies, with a ceiling on the wait so a room whose survivors hide cannot
   * hold the next wave forever.
   */
  /*
   * **The run-progress ramp** (doc 005): whatever the plan asked for, an
   * early room holds a smaller fight. This is the floor under the option
   * filter — a Director that asks for a dense surround in room 1 still gets a
   * gate that releases two bodies at a time and holds three on the floor.
   */
  const ramp = rampFor(w.roomIndex);
  const pacing = pacingOf(w);
  const alive = w.enemies.filter((e) => e.hp > 0).length;
  // The first step: `elapsedMs` has already advanced by the time waves release.
  const opening = w.tick <= 1;
  const camps = opening && w.placement === "camps" && w.pendingWaves.length > 0 ? campsOf(w) : null;
  /*
   * **A cleared floor calls the next wave now.** Its time and the gap after
   * the last are for a fight still going; with nothing left standing the
   * player was left on an empty floor counting down to a wave they could not
   * hurry, which read as the room having stalled.
   */
  const cleared = !opening && alive === 0 && w.pendingWaves.length > 0;
  if (!opening && !cleared && w.stats.elapsedMs - w.lastWaveMs < WAVE_MIN_GAP_MS) return;
  const due = cleared ? [...w.pendingWaves].sort((a, b) => a.atMs - b.atMs) : w.pendingWaves.filter((wave) => {
    if (wave.atMs > w.stats.elapsedMs) return false;
    if (opening && wave.atMs <= 0) return true;
    if (alive <= Math.min(WAVE_GATE_ALIVE + pacing.preRelease, ramp.alive)) return true;
    const bodies = wave.spawns.reduce((n, s) => n + s.count, 0);
    return w.stats.elapsedMs - wave.atMs >= WAVE_GATE_MAX_WAIT_MS
      && alive + bodies <= Math.min(WAVE_CEILING_ALIVE, ramp.alive);
  });
  // One chunk per release, opening or not; the camps are all placed at once.
  const release = camps ? [...w.pendingWaves] : due.slice(0, 1);
  if (release.length === 0) return;
  if (!opening) w.lastWaveMs = w.stats.elapsedMs;
  w.pendingWaves = w.pendingWaves.filter((wave) => !release.includes(wave));
  /*
   * **A climax is a heavier beat, not a bigger crowd.** A beat may carry more
   * bodies than the ramp lets stand at once, so what does not fit arrives as
   * soon as there is room: the rest of the wave goes back on the queue rather
   * than onto the floor. Without it a six-body beat landing on a floor that
   * already held five put eleven on screen, and "more than six in view" —
   * which is the crowd the whole token and station design exists to prevent —
   * ran at nearly three per cent of room time.
   */
  const dueWaves: typeof release = [];
  let room = Math.max(1, ramp.alive - alive);
  for (const wave of release) {
    const spawns: PendingWave["spawns"] = [];
    const held: PendingWave["spawns"] = [];
    for (const s of wave.spawns) {
      const take = Math.max(0, Math.min(s.count, room));
      room -= take;
      if (take > 0) spawns.push({ ...s, count: take });
      if (take < s.count) held.push({ ...s, count: s.count - take });
    }
    if (spawns.length > 0) dueWaves.push({ ...wave, spawns });
    // The remainder keeps its place at the front of the queue.
    if (held.length > 0) w.pendingWaves.unshift({ ...wave, atMs: w.stats.elapsedMs, spawns: held });
  }
  if (dueWaves.length === 0) return;

  // Cells already claimed this room, so nothing stacks on anything.
  const taken = new Set<number>(
    w.enemies.map((e) => Math.floor(e.y / TILE_PX) * GRID_W + Math.floor(e.x / TILE_PX)),
  );
  /*
   * **The opening roster is dealt into stations across the room** — one of
   * them in the view the player walks into, the rest spread over the floor.
   * See `stationsOf` for why, and for what it replaces.
   */
  const stations = opening && !camps
    ? stationsOf(w, dueWaves.filter((x) => x.atMs <= 0).reduce((n, x) => n + x.spawns.reduce((m, sp) => m + sp.count, 0), 0))
    : null;
  /** Where each station's bodies have already been put, so they stand apart. */
  const placed: [number, number][][] = stations ? stations.map(() => []) : [];
  let stationTurn = 0;
  const view = opening && !camps && (!stations || stations.length === 0) ? entryView(w) : null;
  let shown = 0;
  for (const wave of dueWaves) {
    for (const spawn of wave.spawns) {
      const group = camps?.get(spawn.group) ?? w.room.spawn_groups.find((g) => g.id === spawn.group) ?? w.room.spawn_groups[0];
      if (!group) continue;
      /*
       * A turret mount is where turrets stand.
       *
       * The feature's whole description — "turns the zone into a turret spawn"
       * — was unimplemented, so the plinth was scenery and its turrets spawned
       * wherever the encounter's spawn group happened to be. A stationary
       * archetype is the one the room can genuinely place, and placing it is
       * what makes the feature a decision about the floor rather than a label.
       */
      const mountBase = baseArchetype(spawn.archetype);
        const mounts = mountBase === "turret" || mountBase === "sentinel" ? turretMounts(w) : [];
      // Across the group, in an order drawn per arrival: always filling it
      // from its first cells put every wave in the same few places.
      const cells = [...group.cells];
      for (let k = cells.length - 1; k > 0; k--) {
        const j = Math.floor(w.rng.next() * (k + 1));
        [cells[k], cells[j]] = [cells[j]!, cells[k]!];
      }
      for (let i = 0; i < spawn.count; i++) {
        const mount = mounts.find((c) => !taken.has(c[1] * GRID_W + c[0]));
        const inView = !mount && view !== null && shown < ENTRY_VIEW_BODIES && (wave.atMs <= 0);
        /*
         * A station for an opening body, a reinforcement cell out of view for
         * a later one, and the planned group only when neither has anywhere
         * to put it. Stations are filled round-robin so the room populates
         * evenly instead of one group at a time.
         */
        let spread: [number, number] | null = null;
        if (!mount && stations && stations.length > 0 && wave.atMs <= 0) {
          for (let tries = 0; tries < stations.length && !spread; tries++) {
            const k = (stationTurn + tries) % stations.length;
            spread = pickInStation(w, stations[k]!, placed[k]!, taken);
            if (spread) { placed[k]!.push(spread); stationTurn = k + 1; }
          }
        } else if (!mount && !opening) {
          spread = reinforcementCell(w, taken);
        }
        const cell = mount ?? spread ?? (inView ? view![shown % view!.length]! : cells[i % cells.length]!);
        if (!mount && !spread && inView) shown++;
        const at = placeFor(w, spawn.archetype, cell, taken);
        /*
         * In an elite room every rusher is a **lancer**: the lancer is the
         * rusher's elite form — the same spike drive from further out, the
         * spikes flying off after it, and a burst of them on death — rather
         * than a roster entry of its own, so the mixes never draw it and the
         * elite door is what promises it.
         */
        /*
         * **Not every body in an elite room is an elite.** Every one was, so
         * an elite room was the same room with every enemy pink, and the
         * elites stopped standing out from each other. Now the first body,
         * every heavy and about a third of the rest are; the others are the
         * ordinary kind, which is what makes the elite the one to watch.
         */
        let affixes: readonly EliteAffix[] = [];
        if (w.affixes.length > 0) {
          // An elite room: the door promised it, so the first body and every
          // heavy carry the room's affixes, to the cap.
          if (w.elitesPlaced < ELITE_ROOM_CAP
            && (w.elitesPlaced === 0 || HEAVY_ELITES.has(baseArchetype(spawn.archetype)) || w.rng.next() < ELITE_SHARE)) {
            affixes = w.affixes;
          }
        } else if (w.elitesPlaced < w.normalElites) {
          /*
           * A normal room hides as many as the Director asked for, each with
           * **one** affix drawn for that body (doc 019). Spread over the
           * roster rather than dealt to the first bodies: an elite the player
           * meets at the door is a warning, one they meet in the middle of a
           * fight is a surprise, and the surprise is the point.
           */
          if (w.rng.next() < 0.4) affixes = affixesFor(spawn.archetype, w.affixCtx, w.rng);
        }
        // Doc 001's per-room caps (`AFFIXES[id].max_enemies`): `shielded` on one
        // body, `volatile` on two. A capped affix is left off the next body.
        affixes = affixes.filter((id) => {
          const cap = AFFIXES[id].max_enemies;
          return cap === null || (w.affixPlaced[id] ?? 0) < cap;
        });
        for (const id of affixes) w.affixPlaced[id] = (w.affixPlaced[id] ?? 0) + 1;
        if (affixes.length > 0) w.elitesPlaced++;
        /*
         * The lancer is a **subspecies, not an elite form** (doc 005). Every
         * rusher in an elite room used to become one, which made it a
         * difficulty modifier rather than a body — the player met it only
         * behind an elite door and never learned it as its own thing. It is
         * an ordinary roster archetype now, drawn by the mixes like any
         * other and gated by the ramp, and it may carry affixes like any
         * other. The swap, and the cap that held it down, are gone.
         */
        /*
         * The run's own ramp, applied where the body is made: what a room-14
         * rusher is worth is not what a room-6 rusher is worth (doc 005).
         */
        const e = makeEnemy(w.nextEnemyId++, spawn.archetype, at.x, at.y, affixes, rampFor(w.roomIndex));
        w.stats.enemiesSpawned++;
        // Hold/destroy rooms begin with a readable arena beat. Bodies may
        // stand, turn and move, while every attack family remains locked;
        // music and the rest of the room continue normally.
        if (w.objective && !w.objective.done && w.objective.ms < OBJECTIVE_ENTRY_GRACE_MS) {
          e.attackLockMs = OBJECTIVE_ENTRY_GRACE_MS - w.objective.ms;
          e.telegraphMs = 0;
          e.pending = [];
        }
        // Facing the player from its first frame, not the default east.
        e.facing = Math.atan2(w.player.y - e.y, w.player.x - e.x);
        /*
         * The first wave is **already there** when the player walks in. The
         * telegraph and the climb are for bodies that arrive during a fight;
         * a room whose opening roster grows out of the floor in front of the
         * player reads as an ambush that was not planned as one.
         */
        if ((wave.atMs <= 0 || camps) && opening) e.spawnFadeMs = 0;
        /*
         * **A reinforcement walks in awake.** It lands out of the view and on
         * the far side of the room (`reinforcementCell`), which is further
         * than any aggro range, so left dormant it would stand where it
         * arrived until the player came to find it — a wave that adds nothing
         * to the fight it was called for. Woken, it crosses the floor and the
         * player watches it come, which is what a reinforcement is.
         */
        if (!opening) {
          wake(w, e);
          /*
           * And it arrives without the floor telegraph, when it arrives out
           * of sight. The rings and the climb are 0.76 s of warning for a
           * player who is about to have a body grow out of the ground beside
           * them (doc 008); a body appearing on floor they cannot see needs no
           * warning, and those 0.76 s were spent off screen on every wave.
           */
          if (Math.abs(at.x - w.player.x) > w.viewHalf.x || Math.abs(at.y - w.player.y) > w.viewHalf.y)
            e.spawnFadeMs = 0;
        }
        w.enemies.push(e);
      }
    }
    w.events.push({ kind: "wave_spawned", x: w.player.x, y: w.player.y, amount: wave.spawns.length });
  }
}

/** How many of the opening bodies stand in the first view, and how near the door they may. */
const ENTRY_VIEW_BODIES = 4;
const ENTRY_VIEW_CLEAR = TILE_PX * 5;

/* ------------------------- spreading a room out -------------------------- */

/**
 * **Stations**: the opening roster stood across the floor rather than piled
 * into the first view.
 *
 * The room used to be either a crowd or an empty hall. Four of the opening
 * bodies were placed inside two tiles of one point in the entry view and the
 * rest went to whatever spawn group the plan named, so a vast room read as a
 * knot of enemies by the door and several screens of nothing — and then each
 * later wave arrived at its own planned group once the floor thinned, so the
 * fight swung between a crowd and no fight at all.
 *
 * So the opening roster is dealt into small **stations** of two or three
 * bodies, one of them in the view the player walks into and the rest spread
 * over the room by farthest-point sampling. The count is set by how much open
 * floor there is — about one station per viewport of it — so a small room
 * gets two and a hall gets five or six, and a body never has more than two
 * companions within shouting distance.
 *
 * The alarm ripple still takes a station together (a station is tighter than
 * `ALERT_RADIUS`), and the next station is further than the radius, so the
 * room stays what doc 005 asks for: a set of fights whose order the player
 * chooses.
 */
const STATION_RADIUS_TILES = 2.2;
const STATION_MAX_BODIES = 3;
const MAX_STATIONS = 4;
/** How far apart two bodies of one station stand, in tiles. */
const STATION_SPACING_TILES = 1.6;
/**
 * How far apart two **stations** stand, in tiles, and the slack around it.
 *
 * Stations are placed as a **chain at a spacing**, not by farthest-point
 * sampling. Farthest-point is the right rule for "spread these as far apart
 * as possible" and the wrong one for a room somebody has to walk across: it
 * puts every station in a different corner, and measured, the single largest
 * reason a room had nothing on screen was the player walking from one corner
 * to the next — 10.2% of all uncleared room time, nearly half of the empty
 * time in the game.
 *
 * Seven tiles is most of a viewport (the view is sixteen by nine), so the
 * next station is a step beyond the edge of the screen rather than across the
 * hall: the player clears one, turns, and the next is already close. The
 * chain grows from the station in the entry view, so it runs along the way
 * the player is going.
 */
const STATION_SPACING_TARGET = 7;
const STATION_SPACING_SLACK = 2.5;
/** How much open ground round a station's centre is worth against its spacing. */
const STATION_OPEN_WEIGHT = 1.5;

/** The share of the 5x5 box round a cell that is floor: cheap visibility. */
function openness(w: World, c: readonly [number, number]): number {
  let open = 0;
  let total = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const gx = c[0] + dx;
      const gy = c[1] + dy;
      if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) continue;
      total++;
      if (w.room.grid[gy * GRID_W + gx] === Tile.Floor) open++;
    }
  return total > 0 ? open / total : 0;
}

function stationsOf(w: World, bodies: number): [number, number][][] {
  const hazards = hazardCells(w);
  const open: [number, number][] = [];
  for (let gy = 1; gy < w.room.extent.h - 1; gy++)
    for (let gx = 1; gx < w.room.extent.w - 1; gx++) {
      if (w.room.grid[gy * GRID_W + gx] !== Tile.Floor || hazards.has(gy * GRID_W + gx)) continue;
      open.push([gx, gy]);
    }
  if (open.length === 0) return [];
  const p = w.player;
  const viewTiles = Math.max(1, ((w.viewHalf.x * 2) / TILE_PX) * ((w.viewHalf.y * 2) / TILE_PX));
  // One station per viewport of open floor, and never fewer than the roster
  // needs to keep its groups down to two or three bodies.
  const regions = Math.max(2, Math.round(open.length / viewTiles));
  const wanted = Math.max(Math.ceil(bodies / STATION_MAX_BODIES), regions);
  const n = Math.max(1, Math.min(MAX_STATIONS, Math.min(bodies, wanted)));

  const centres: [number, number][] = [];
  // The first station is the one the player walks in to see, so the room
  // opens with a fight rather than with a hall.
  const first = entryView(w);
  if (first) centres.push(first[0]!);
  const far = open.filter(([gx, gy]) =>
    Math.hypot((gx + 0.5) * TILE_PX - p.x, (gy + 0.5) * TILE_PX - p.y) >= CAMP_ENTRY_CLEAR);
  const pool = far.length > 0 ? far : open;
  while (centres.length < n) {
    let best: [number, number] | null = null;
    let bestScore = -Infinity;
    for (const c of pool) {
      const toPlayer = Math.hypot((c[0] + 0.5) * TILE_PX - p.x, (c[1] + 0.5) * TILE_PX - p.y) / TILE_PX;
      const toOther = centres.length
        ? Math.min(...centres.map((o) => Math.hypot(c[0] - o[0], c[1] - o[1])))
        : toPlayer;
      /*
       * A link in the chain: about `STATION_SPACING_TARGET` from whatever is
       * nearest, never nearer than the alarm radius wants. Scoring the
       * *closeness to the target* rather than the distance itself is the whole
       * change — the old rule maximised the distance and therefore always
       * chose a corner.
       */
      const near = Math.min(toPlayer, toOther);
      if (near < STATION_SPACING_TARGET - STATION_SPACING_SLACK) continue;
      /*
       * And it stands somewhere the player can **see** it from. A station
       * tucked behind cover is a fight that is on screen and invisible, which
       * measured as 6.5% of all uncleared room time — the second largest
       * reason a room read as empty. Open floor around the centre is a cheap
       * stand-in for a sight line and costs one 5x5 scan rather than a
       * raycast per candidate.
       */
      const score = -Math.abs(near - STATION_SPACING_TARGET)
        + openness(w, c) * STATION_OPEN_WEIGHT + w.rng.next() * 0.4;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    // Nowhere at the target spacing: take the farthest thing left, which is
    // what a small room leaves.
    if (!best) {
      let far = -1;
      for (const c of pool) {
        const near = centres.length
          ? Math.min(...centres.map((o) => Math.hypot(c[0] - o[0], c[1] - o[1])))
          : Math.hypot((c[0] + 0.5) * TILE_PX - p.x, (c[1] + 0.5) * TILE_PX - p.y) / TILE_PX;
        if (near > far) { far = near; best = c; }
      }
      if (!best || far < STATION_RADIUS_TILES * 2) break;
    }
    centres.push(best);
  }
  return centres.map(([cx, cy]) => {
    const cells = open.filter(([x, y]) => Math.hypot(x - cx, y - cy) <= STATION_RADIUS_TILES);
    return cells.length > 0 ? cells : [[cx, cy] as [number, number]];
  });
}

/**
 * A free cell of a station, at least `STATION_SPACING_TILES` from the ones
 * its companions already hold: two bodies a station is a pair standing near
 * each other, not a pair standing on each other.
 */
function pickInStation(
  w: World, cells: readonly [number, number][], used: readonly [number, number][], taken: Set<number>,
): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = -1;
  for (const c of cells) {
    if (taken.has(c[1] * GRID_W + c[0])) continue;
    const d = used.length === 0
      ? w.rng.next()
      : Math.min(...used.map((o) => Math.hypot(c[0] - o[0], c[1] - o[1])));
    if (used.length > 0 && d < STATION_SPACING_TILES) continue;
    if (d > bestD) { bestD = d; best = c; }
  }
  // Nowhere far enough: any free cell of the station beats none at all.
  if (best) return best;
  return cells.find((c) => !taken.has(c[1] * GRID_W + c[0])) ?? null;
}

/** How far out of the view and away from the player reinforcements land. */
const REINFORCE_CLEAR_PX = TILE_PX * 6;

/**
 * Where a later wave arrives: **out of sight, on the far side**.
 *
 * A wave is a reinforcement, not a spawn: it should be something that walks
 * into the fight, so the player sees it coming and the floor refills from an
 * edge rather than around them. Landing outside the view and as far from the
 * player as the room allows gives both — and it is also, for free, the rule
 * that keeps a wave off the ground the player has just cleared, since the
 * ground the player has just cleared is the ground they are standing on.
 *
 * Falls back to the planned cell when the room has nowhere that qualifies,
 * which is what a small room is.
 */
function reinforcementCell(w: World, taken: Set<number>): [number, number] | null {
  const hazards = hazardCells(w);
  const p = w.player;
  let best: [number, number] | null = null;
  let bestD = -Infinity;
  for (let gy = 1; gy < w.room.extent.h - 1; gy++)
    for (let gx = 1; gx < w.room.extent.w - 1; gx++) {
      const i = gy * GRID_W + gx;
      if (w.room.grid[i] !== Tile.Floor || hazards.has(i) || taken.has(i)) continue;
      const x = (gx + 0.5) * TILE_PX;
      const y = (gy + 0.5) * TILE_PX;
      const outOfView = Math.abs(x - p.x) > w.viewHalf.x + TILE_PX || Math.abs(y - p.y) > w.viewHalf.y + TILE_PX;
      const d = Math.hypot(x - p.x, y - p.y);
      if (!outOfView || d < REINFORCE_CLEAR_PX) continue;
      /*
       * The **nearest** cell that qualifies, not the furthest. "Out of sight"
       * is the whole requirement — it is what makes a wave something that
       * walks in rather than something that appears — and picking the far
       * corner instead only added seconds of empty floor to every wave: the
       * median room went from 23 to 27 seconds and its p90 from 37 to 46,
       * which is a room spent watching reinforcements commute.
       */
      const score = -d + w.rng.next() * TILE_PX * 2;
      if (score > bestD) { bestD = score; best = [gx, gy]; }
    }
  return best;
}

/**
 * The cells of a small group in the view the player enters to: the camera's
 * view as it first frames the player (centred on them, held inside the
 * room), a tile in from its edges, and the group's middle as far from the
 * door as that view allows — at least `ENTRY_VIEW_CLEAR` — on open floor out
 * of the hazards. Null when the view holds no such floor.
 */
function entryView(w: World): [number, number][] | null {
  const p = w.player;
  const roomW = w.room.extent.w * TILE_PX, roomH = w.room.extent.h * TILE_PX;
  const half = w.viewHalf;
  const cx = half.x * 2 >= roomW ? roomW / 2 : Math.max(half.x, Math.min(roomW - half.x, p.x));
  const cy = half.y * 2 >= roomH ? roomH / 2 : Math.max(half.y, Math.min(roomH - half.y, p.y));
  const hazards = hazardCells(w);
  const open: [number, number][] = [];
  for (let gy = 1; gy < w.room.extent.h - 1; gy++)
    for (let gx = 1; gx < w.room.extent.w - 1; gx++) {
      const x = (gx + 0.5) * TILE_PX, y = (gy + 0.5) * TILE_PX;
      if (Math.abs(x - cx) > half.x - TILE_PX || Math.abs(y - cy) > half.y - TILE_PX) continue;
      if (w.room.grid[gy * GRID_W + gx] !== Tile.Floor || hazards.has(gy * GRID_W + gx)) continue;
      open.push([gx, gy]);
    }
  const far = open.filter(([gx, gy]) => Math.hypot((gx + 0.5) * TILE_PX - p.x, (gy + 0.5) * TILE_PX - p.y) >= ENTRY_VIEW_CLEAR);
  if (far.length === 0) return null;
  let best = far[0]!;
  let bestD = -1;
  for (const c of far) {
    const d = Math.hypot((c[0] + 0.5) * TILE_PX - p.x, (c[1] + 0.5) * TILE_PX - p.y) + w.rng.next() * TILE_PX;
    if (d > bestD) { bestD = d; best = c; }
  }
  const group = far.filter(([gx, gy]) => Math.hypot(gx - best[0], gy - best[1]) <= CAMP_RADIUS_TILES);
  return group.length > 0 ? group : [best];
}

/** The most camps a room is split into, how far they keep from the entry, and how wide one is. */
const MAX_CAMPS = 4;
const CAMP_ENTRY_CLEAR = TILE_PX * 6;
const CAMP_RADIUS_TILES = 2;

/**
 * The encounter as camps (`World.placement`): its waves dealt round-robin into
 * up to `MAX_CAMPS` groups, each placed round a centre chosen to be as far as
 * the room allows from the entry and from the other camps — farthest-point
 * sampling over reachable open floor out of the hazards, `CAMP_ENTRY_CLEAR`
 * from the door. A camp is tighter than the alarm radius, so the ripple
 * (`wake`) takes the whole camp when one of it notices the player; the next
 * camp is further than the radius, so it is its own fight.
 *
 * Returns each wave's spawns rewritten onto its camp's group, keyed by the
 * group id the spawns now carry.
 */
function campsOf(w: World): Map<string, SpawnGroup> {
  const hazards = hazardCells(w);
  const entry = w.player;
  const open: [number, number][] = [];
  for (let gy = 1; gy < GRID_H - 1; gy++)
    for (let gx = 1; gx < GRID_W - 1; gx++) {
      if (w.room.grid[gy * GRID_W + gx] !== Tile.Floor || hazards.has(gy * GRID_W + gx)) continue;
      open.push([gx, gy]);
    }
  const far = open.filter(([x, y]) => Math.hypot((x + 0.5) * TILE_PX - entry.x, (y + 0.5) * TILE_PX - entry.y) >= CAMP_ENTRY_CLEAR);
  const pool = far.length > 0 ? far : open;
  const n = Math.min(MAX_CAMPS, w.pendingWaves.length);
  const centres: [number, number][] = [];
  const ex = Math.floor(entry.x / TILE_PX), ey = Math.floor(entry.y / TILE_PX);
  // The first camp is the one the player walks in to see (`entryView`).
  const first = entryView(w);
  if (first && n > 0) centres.push(first[0]!);
  for (let k = centres.length; k < n; k++) {
    let best: [number, number] | null = null;
    let bestD = -1;
    for (const c of pool) {
      const toEntry = Math.hypot(c[0] - ex, c[1] - ey);
      const toCamp = centres.length ? Math.min(...centres.map((o) => Math.hypot(c[0] - o[0], c[1] - o[1]))) : toEntry;
      // Each camp after the first is the farthest from everything already
      // chosen, the door among them.
      const d = Math.min(toEntry, toCamp) + w.rng.next() * 0.5;
      if (d > bestD) { bestD = d; best = c; }
    }
    if (best) centres.push(best);
  }
  const groups = new Map<string, SpawnGroup>();
  centres.forEach(([cx, cy], k) => {
    const cells = pool.filter(([x, y]) => Math.hypot(x - cx, y - cy) <= CAMP_RADIUS_TILES) as [number, number][];
    groups.set(`camp_${k}`, { id: `camp_${k}`, cells: cells.length ? cells : [[cx, cy]] });
  });
  w.pendingWaves = w.pendingWaves.map((wave, i) => ({
    ...wave, atMs: 0,
    spawns: wave.spawns.map((sp) => ({ ...sp, group: `camp_${i % Math.max(1, centres.length)}` })),
  }));
  return groups;
}

/** Free cells of every `turret_mount` zone, in the order the room declares them. */
function turretMounts(w: World): [number, number][] {
  const out: [number, number][] = [];
  for (const zone of w.room.zones) {
    if (zone.feature !== "turret_mount") continue;
    for (const cell of zone.cells)
      if (w.room.grid[cell[1] * GRID_W + cell[0]] === Tile.Floor) out.push([cell[0], cell[1]]);
  }
  return out;
}

function onEnemyKilled(w: World, e: Enemy): void {
  audienceKill(w);
  /*
   * A `doom` mark outlives its body (doc 006): it still bursts, on its own
   * clock, where the body fell — which is what makes marking a pack and
   * killing into it the play the delay asks for. Handed over once and
   * cleared, so a second call for the same death cannot burst it twice.
   */
  if (e.doomMs > 0) {
    w.dooms.push({ x: e.x, y: e.y, ms: e.doomMs, damage: e.doomDamage, radius: e.doomRadius, spellIndex: e.doomSpell });
    e.doomMs = 0;
  }
  if (e.contagion > 0) spreadContagion(w, e);
  // Otherwise a room whose attackers all died would have no turns left in it
  // and every survivor would circle forever.
  dropToken(w, e);
  dropFireToken(w, e);
  onExpansionDeath(w, e);
  dropLoot(w, e.x, e.y, ENEMIES[e.archetype].threat_weight >= 4 ? 2 : 1);
  /*
   * **An elite pays in health, when health is what the player needs.**
   *
   * The heal is worth a tenth of the bar whenever it comes, and **how often it
   * comes scales against what is left of that bar**: near certain at a sliver,
   * near nothing at full. A drop that always came was a tenth of a bar handed
   * to a player who could not hold it — at full health the pickup is litter,
   * and a reward the player steps over teaches them to stop looking at the
   * floor. Scaled, the elite is a fight worth taking *because* it is the way
   * back from a bad room, which is the role doc 003's heart budget leaves
   * empty.
   *
   * The curve is the missing share, squared. Linear gave a coin-flip at half
   * health, which is where a player is for most of a run and where a heal is
   * merely nice; squaring pushes the mass to the bottom of the bar, so it is
   * about a tenth at three quarters, a quarter at half, and all but certain
   * under a sixth — a rescue rather than a trickle.
   */
  if (e.affixes.length > 0) {
    const max = MAX_HEARTS + w.player.mods.maxHearts;
    const missing = Math.max(0, Math.min(1, 1 - w.player.hearts / max));
    if (w.rng.next() < missing * missing) {
      drop(w.pickups, "heart", e.x, e.y, w.rng).value = max * ELITE_HEAL_FRACTION;
    }
  }
  killPays(w, e);
  gainXp(w, e);
  impact(w, HITSTOP_KILL, TRAUMA_KILL);
  w.events.push({ kind: "enemy_killed", x: e.x, y: e.y, what: e.archetype, facing: e.facing });
  emit(w, e.x, e.y, "kill", 8);
  if (e.affixes.includes("splitting") && e.archetype !== "rusher") {
    for (let i = 0; i < 2; i++)
      w.enemies.push(makeEnemy(w.nextEnemyId++, "rusher", e.x + (i ? 12 : -12), e.y, [], rampFor(w.roomIndex)));
  }
  /*
   * Bursts on death. `volatile` promised this in its description and never
   * did it; and an **elite lancer** always does it — its spikes go out in
   * the same eight directions its attack drove them, across the room. The
   * eight are at fixed angles, so the gaps are where they always are and a
   * kill made at a diagonal is a kill made safely.
   */
  if (e.archetype === "lancer" && e.affixes.length > 0) deathBurst(w, e, "lance");
  else if (e.affixes.includes("volatile")) deathBurst(w, e, "volatile");
  // The boss's adds go with it: the fight is the boss, and a run that ended
  // on a rusher still standing would not have ended. The Frontier Veteran's
  // squad goes with it the same way, and its death pays a room (doc 024).
  if (e.archetype === "boss" || e.guardian)
    for (const other of w.enemies) if (other !== e && other.hp > 0) { other.summoned = true; other.hp = 0; }
  if (e.guardian) {
    payXp(w, GUARDIAN_XP, e.x, e.y);
    for (let i = 0; i < GUARDIAN_HEARTS; i++) {
      const h = drop(w.pickups, "heart", e.x, e.y, w.rng);
      h.value = 0;
      h.homing = true;
    }
  }
}

/*
 * The boss's **signature moves**, one at a time, between its walking,
 * swinging and shooting (see doc 005, "Boss"):
 *
 * - **Slam**: it plants, a red ring grows round it, and a shockwave ring of
 *   shots goes out from just beyond its body. The safe place is *in* — next
 *   to it — which is the one move in the game that asks the player to close.
 *   Phase III slams twice, the second ring offset into the first's gaps.
 * - **Leap**: it goes up out of the hall — nothing hits it in the air — and
 *   its mark hunts the player, stops, and it comes down there with a
 *   smaller ring. The answer is to leave the mark once it has stopped, and
 *   the landing is the punish window.
 * - **Quake**: it drives the greatsword into the floor and the stone splits
 *   along four lines out from it (eight at phase III, and the second four are
 *   laid a beat later into the first four's gaps). The answer is to stand
 *   *between* the cracks, which is the one thing the slam's answer — get in
 *   close — does not help with.
 * - **Hook** (phase III): the chain the snarecaster taught the player, thrown
 *   by something four times its size. It reels the player onto the greatsword,
 *   and the chop that follows is the biggest hit in the game. Dash through the
 *   line while it lies on the floor, as with any chain.
 * - **Adds**: two bodies at each phase change, so phase II and III open with
 *   a kill-order question.
 *
 * Every move has a telegraph at least 0.6 s long, and nothing tracks once
 * it is committed.
 *
 * **Escalation is by moves, not by numbers** (research: the boss survey's
 * order of levers — add a move, then change a move's speed or range, then the
 * arena, then adds). Phase I teaches two, phase II adds the leap and shortens
 * the gaps, phase III adds the hook and doubles the quake; every phase keeps
 * the slam, so the fight stays the same fight.
 */
export type BossMove = "slam" | "leap" | "quake" | "hook" | "storm";
/*
 * **One turn at a time, chosen by where the player is** (doc 020).
 *
 * The king had three clocks of his own — a rotation of moves on one, his blade
 * on another, a volley that ran whenever neither was — and they overlapped, so
 * he never stopped attacking. A great boss (the Souls school) does one thing,
 * and then stands in its recovery and walks, and the walk is the player's:
 * the rest *is* the opening. So he now takes turns: one blade string, one
 * move or one volley, and after it a rest (`bossRestMs`) in which he only
 * stalks back round to face them. When it runs out he chooses the next turn
 * from where they stand — the reach of the answer is the question:
 *
 * - **Close** (inside his sweep): the sweep and the slash across his front,
 *   the backhand at a player beside or behind him.
 * - **Mid**: the slash and the sweep he steps into, the hook, a volley.
 * - **Far**: the long slash, the hook, a volley.
 *
 * The dashcut is in every band for a player level with him — its line is
 * sideways, its range is made by the hop back before it (`stepBossHop`).
 *
 * The slam and the quake are in every band too: the slam's band crosses
 * the whole hall, and the quake's cracks are turned off the player's line.
 * The leap and the storm are in every band, weighted low at his feet: the
 * leap goes up out of the hall and hunts the player from there, and the
 * storm hops back out of reach before the sword goes up, so where they stood
 * is not either one's question.
 *
 * Each band holds at least two turns, drawn by weight, and never the one he
 * has just taken, so a player who learns a range learns a set, not a move.
 * A phase adds turns rather than numbers (the slash strings, the dashcut and
 * the hook from II, more bolts to the storm), and the rests shorten.
 */
type BossAct = MeleeKind | BossMove | "volley";
/** Centre to centre, px: inside the first he answers with what is at his feet, past the second with what crosses the hall. */
const BOSS_CLOSE_PX = 96;
const BOSS_FAR_PX = 176;
/** A volley turn: two bars, fired standing. */
export const BOSS_VOLLEY_MS = beats(8);
/** How long he walks after a blade he chose before giving it up for another turn. */
// 3.5 s where it was 2.6: a blade given up for a turn that fits the range was a blade traded for a wave.
const BOSS_BLADE_CHASE_MS = 3500;
/** The rest after a turn, in beats, by phase; and up to this many more, drawn. */
// Down from 7 / 6 / 5 and up to 2 more: played, the rests were long enough that the fight felt slack.
// Phases I and II down again, by a beat: with the leap, the storm and the slam asked at any range the heavy
// turns went from a quarter of his turns to two fifths, and turn to turn slowed by about a twelfth. Measured
// on the bench's fights, turn to turn is now 4.4 s in both (4.5 and 4.7 before), phase II the quicker.
const BOSS_REST_BEATS: Readonly<Record<number, number>> = { 1: 4, 2: 3, 3: 3 };
const BOSS_REST_JITTER_BEATS = 1.5;
/**
 * After a heavy turn — a leap, a slam, a quake, a string of three — this many beats more: the big opening.
 * Two in phases I and II, where heavy turns are now two in five; phase III keeps three.
 */
const BOSS_HEAVY_REST_BEATS: Readonly<Record<number, number>> = { 1: 2, 2: 2, 3: 3 };
const BOSS_HEAVY_ACTS: ReadonlySet<string> = new Set(["leap", "slam", "quake", "storm"]);

/** The rest after the turn that has just ended, ms. */
function bossRestMs(w: World, e: Enemy): number {
  const heavy = BOSS_HEAVY_ACTS.has(e.bossLastAct) || e.bossStringN >= 3;
  const n = (BOSS_REST_BEATS[e.phase] ?? 6) + w.rng.next() * BOSS_REST_JITTER_BEATS + (heavy ? BOSS_HEAVY_REST_BEATS[e.phase] ?? 3 : 0);
  return beats(n);
}

/** The king's next turn, from where the player stands (see above); null when the lab holds every kind. */
function chooseBossAct(w: World, e: Enemy): BossAct | null {
  const p = w.player;
  const d = Math.hypot(p.x - e.x, p.y - e.y);
  const ph = e.phase;
  // Where they are now, not where his last glance put them: he has walked since.
  const level = bossLevel(e, p);
  const opts: [BossAct, number][] = [];
  /*
   * **The sword first, the ground strikes seldom.** Measured with a player
   * holding each range, the mid and far bands were three parts in four
   * waves, cracks, bands and lightning, and the sword's own blows — which are
   * the fight's rhythm and the cheaper hits — were a quarter; the backhand
   * never came at all, since it is only for a player behind him. The heavy
   * moves (`BOSS_HEAVY_ACTS`) are now drawn about half as often and rest
   * longer after, and the blades he walks into are in every band.
   */
  if (d < BOSS_CLOSE_PX) {
    // At his feet the side matters: his sweeps go out of his front only, so beside him is the cleave's, behind him the backhand's.
    if (bossBehind(e, p)) opts.push(["maul", 4], ["slam", 1]);
    // Beside him, where the sweeps do not reach, the backhand (the greatcleave was taken out: it read strangely).
    else if (level) opts.push(["maul", 4], ["slam", 1], ["dashcut", 1.5]);
    else opts.push(["greatsweep", 3], ["greatslash", 3], ["maul", 2], ["slam", 1]);
    // The quake's cracks are turned so none runs under the player; at his feet they still have to find the gap.
    opts.push(["quake", 0.8]);
    // The leap asks about the sky, not the range (`BOSS_LEAP_MS`), and the storm steps back out of
    // reach before it is called (`stepBossHop`): at his feet too, but seldom.
    opts.push(["leap", 0.6], ["storm", 0.6]);
  } else if (d < BOSS_FAR_PX) {
    // The slam's band crosses the whole hall, so it is asked here too, not only of a player at his feet.
    opts.push(["quake", 1], ["storm", 1], ["leap", 1], ["slam", 1]);
    // A player level with him is on the dashcut's line; it hops back for the room to run (`stepBossHop`).
    if (level) opts.push(["dashcut", 2]);
    if (ph >= 2) opts.push(["hook", 1.5]);
    if (bossBehind(e, p)) opts.push(["maul", 2]);
    opts.push(["greatslash", 3], ["greatsweep", 2]);
    opts.push(["volley", 1]);
  } else {
    opts.push(["leap", 2], ["storm", 1.5], ["volley", 1.5], ["quake", 0.5], ["slam", 1], ["greatslash", 2]);
    if (level) opts.push(["dashcut", ph >= 2 ? 3 : 2]);
    if (ph >= 2) opts.push(["hook", 2]);
  }
  const held = w.bossHold;
  const allowed = opts.filter(([a]) => {
    if (a === "hook" && (!hasLineOfSight(w.room.grid, e.x, e.y, p.x, p.y) || e.gapPx < TILE_PX * 2)) return false;
    const kind = a === "volley" ? "volleys" : (BOSS_MOVE_NAMES as readonly string[]).includes(a) ? "moves" : "blades";
    return !held?.[kind];
  });
  // Never the same turn twice running, while there is another.
  const fresh = allowed.filter(([a]) => a !== e.bossLastAct);
  const pool = fresh.length > 0 ? fresh : allowed;
  if (pool.length === 0) return null;
  let roll = w.rng.next() * pool.reduce((t, [, wt]) => t + wt, 0);
  for (const [a, wt] of pool) if ((roll -= wt) < 0) return a;
  return pool[pool.length - 1]![0];
}
/**
 * Three beats raised: the sword is driven into the ground round his feet as
 * well as throwing the band, so the player has two things to do — get off the
 * ground, then clear the band — and the raise is the time for the first.
 */
export const BOSS_SLAM_MS = beats(3);
/**
 * The slam's **shockwave** (doc 005): the ring of broken floor that travels
 * out from the impact, which is what the move is now about.
 *
 * The slam used to be a ring of bullets and a "come in close" safe spot, and
 * it shared its answer with the leap — be somewhere else when it lands. A
 * band that travels is the one question in the fight whose answer is the
 * dash itself: it reaches everywhere in the arena eventually, so distance is
 * only a delay, and crossing it needs the i-frames rather than a gap.
 *
 * It comes out of the floor where the sword went in, at his feet, so there
 * is no ground near him it has not already crossed. Phase III stomps twice
 * before it (`BOSS_SLAM_III_STOMPS`).
 */
const BOSS_SHOCK_SPEED: Readonly<Record<number, number>> = { 1: 230, 2: 260, 3: 290 };
/**
 * **The phase III slam is three blows, `o---o-----O`.** Two stomps two
 * beats apart, then three beats of gathering before the third. The stomps
 * throw no band: they heave up the ground round his feet only, wider than
 * the earlier phases' slam (`BOSS_SLAM_STOMP_PX`). The third is the slam
 * as it is in every phase — the struck ground and the band — and it is the
 * one on the downbeat, so the two stomps come before it, 5 and 3 beats out.
 * These are how long before the third each stomp falls.
 */
export const BOSS_SLAM_III_STOMPS: readonly number[] = [beats(5), beats(3)];
/**
 * How far each of the phase III slam's blows strikes the ground, px from his
 * centre — the two stomps and the third alike: the floor heaved up round him
 * two and a half tiles out, where phases I and II strike `BOSS_SLAM_IMPACT_PX`.
 */
export const BOSS_SLAM_STOMP_PX = 84;
/**
 * Half a heart — ten health at the boss's power — where it was a whole one:
 * a band that reaches the whole hall and is answered only by a timed dash
 * cost as much as a blow of the sword it takes a mistake to stand in.
 */
export const BOSS_SHOCK_DAMAGE = 0.5;
/**
 * How deep the band is, px: 22 where every other shockwave is 34
 * (`SHOCK_THICKNESS`). At 34 it took 165 ms to pass over a body standing
 * still, most of the dash's 200 ms of i-frames, so only a dash into it on the
 * right frame got through; at 22 it passes in under 140, and a dash any way
 * through it inside the right fifth of a second does.
 */
const BOSS_SHOCK_THICK_PX = 22;
/** A crack of the quake, and the leap's landing on a player under it, in hearts (see `BOSS_POWER`). */
const BOSS_QUAKE_DAMAGE = 1;
const BOSS_LAND_DAMAGE = 1;
/**
 * **The leap goes up out of the hall and comes down on the player.**
 *
 * It was an arc from where he stood to where the player stood, which made it
 * a move about distance: it was only chosen across the hall, and he walks
 * the player down in every rest, so it was almost never seen (measured: 7
 * turns in 892). An arc onto a player at his feet is a hop. So the move is
 * now about the sky, and asked at any range, in five parts on the beat:
 *
 * - **Gather** (`BOSS_LEAP_RISE_MS`): he crouches on the floor, still
 *   hittable, and the mark is already down under the player.
 * - **Rise** (`BOSS_LEAP_UP_MS`): he goes straight up out of the view
 *   (`BOSS_LEAP_SKY_PX`); from here nothing hits him.
 * - **Hunt** (`BOSS_LEAP_HUNT_MS`): out of sight, the mark follows the
 *   player at about their own pace (`BOSS_LEAP_HUNT_SPEED`), so running holds
 *   it off and a dash leaves it behind for a moment.
 * - **Lock** (`BOSS_LEAP_LOCK_MS`): the mark stops and its clock fills. This
 *   is the telegraph, and it is longer than the reaction floor with the walk
 *   out of the mark on top — nothing tracks once it is committed.
 * - **Fall** (`BOSS_LEAP_FALL_MS`, the end of the lock): he drops into view
 *   onto the mark, and the landing is what it was — hitstop, dust, the
 *   shake, the band — and the opening.
 *
 * His body's coordinates stay under the mark while he is up, so everything
 * that reads a position (the shadow, the flow field, the adds) reads a body
 * somewhere sensible, and the fall comes down exactly where he is.
 */
/** Seven beats: one gathering, one rising, two hunting, three locked; the landing on the downbeat (doc 020). */
export const BOSS_LEAP_MS = beats(7);
/** Of the leap, the part spent gathering on the floor before it is airborne: one beat. */
export const BOSS_LEAP_RISE_MS = beats(1);
/** The climb out of the view, after the gather. */
export const BOSS_LEAP_UP_MS = beats(1);
/** Out of sight, following the player. */
export const BOSS_LEAP_HUNT_MS = beats(2);
/** The mark held still before he lands on it: the telegraph proper. */
export const BOSS_LEAP_LOCK_MS = BOSS_LEAP_MS - BOSS_LEAP_RISE_MS - BOSS_LEAP_UP_MS - BOSS_LEAP_HUNT_MS;
/** The drop back into view, the last of the lock. */
export const BOSS_LEAP_FALL_MS = beats(0.5);
/** How high he goes, px: past the top of the view from anywhere on the hall's floor, with the sprite's height to spare. */
export const BOSS_LEAP_SKY_PX = 640;
/** How fast the mark follows the player while he is up, px/s: their own walk, a little over. */
export const BOSS_LEAP_HUNT_SPEED = PLAYER_SPEED * 1.1;
/*
 * **The fall into phase III** (the meteor). The armour breaks and he roars,
 * as into phase II; then, where phase II calls its adds, he goes up out of
 * the hall as the leap goes, and while he is up the roof comes down —
 * stones marked on the floor a beat apart, one at the player and the rest
 * anywhere in the hall — and once the last has fallen his mark shows in the
 * middle, and he comes down there on the downbeat, with the biggest landing in the fight and the band. The music
 * is held down under the fall and phase III's tempo (`BOSS_RAGE_TEMPO`) and
 * layers come in with the landing. Every answer in it is one the player has
 * already learned: leave the mark (the leap), keep moving (the storm), dash
 * the band (the slam).
 */
/** Crouched, then up: a beat each. */
export const BOSS_METEOR_GATHER_MS = beats(1);
export const BOSS_METEOR_UP_MS = beats(1);
/** The rain of stones and the landing's tell after it, at least: ten beats, and out to the next downbeat for the landing. */
export const BOSS_METEOR_RAIN_MS = beats(10);
/**
 * The landing's own tell, after the last stone has fallen: the mark in the
 * middle is only drawn once the roof has stopped coming down, so the two are
 * never read at once, and it is long enough to walk out of from its centre.
 */
export const BOSS_METEOR_LAND_TELL_MS = beats(3);
/** The drop onto the middle, the end of the rain. */
const BOSS_METEOR_FALL_MS = beats(0.5);
/** A stone's mark on the floor before it falls, its size, and what it costs. */
export const BOSS_METEOR_MARK_MS = beats(2);
const BOSS_METEOR_ROCK_RADIUS = 22;
const BOSS_METEOR_ROCK_DAMAGE = 0.5;
/** Stones a beat: one at the player, and this many more anywhere on the floor. */
const BOSS_METEOR_SCATTER = 2;
/** The landing's struck ground, px: wider than the leap's (`BOSS_LEAP_RADIUS`). */
export const BOSS_METEOR_LAND_PX = 64;
/*
 * **Where the sword strikes** (doc 020). The greatsword is driven into the
 * floor at his feet, so the ground round them is hit on the commit
 * (`BOSS_SLAM_IMPACT_DAMAGE`), and the shockwave is born at its edge. It was a
 * safe circle — "come closer" as the slam's answer — which put the one place
 * the sword lands at the one place it could not hurt, and made his feet the
 * safest ground in the fight. The answers now are to be off that ground when
 * the sword comes down, or to dash it, and then to jump the band.
 */
export const BOSS_SLAM_IMPACT_PX = 56;
/*
 * **What the king's blows do to the hall** (doc 020): his sword, his slam and
 * his landing take half a column's stone at a stroke, a travelling band a
 * third, so a column he has been driven into twice is gone and the cover the
 * player was using goes with it.
 */
const BOSS_PROP_DAMAGE = 18;
const BOSS_PROP_WAVE_DAMAGE = 12;
/**
 * **The Frontier Veteran's blows are not stopped by the room's clutter**
 * (doc 024). Its stakes, its volley's lines and its fire run through props
 * rather than ending at them (`isStone`) and smash each they reach: a line
 * when it fires, the fire as it rolls out. Only stone holds them. Its sweep,
 * bash and palisade smash what they hit where they land
 * (`resolveEnemySwings`, `stepEruptions`), and its ram already does
 * (`smashProps`).
 */
function veteranBreaksProps(w: World): void {
  for (const r of w.rifts) {
    if (!r.alive || !r.breaksProps || r.teleMs > 0 || r.activeMs <= 0) continue;
    r.breaksProps = false;
    smashPropsWhere(w, (q) => riftHits(r, q.x, q.y, q.radius));
  }
  for (const f of w.flames)
    if (f.alive && f.breaksProps) smashPropsWhere(w, (q) => flameCovers(f, q.x, q.y, q.radius));
}

/** Smashes outright every standing prop `hits` finds; not the throne hall's columns, which only the king's blows wear. */
function smashPropsWhere(w: World, hits: (q: Destructible) => boolean): void {
  for (const q of w.props) if (q.hp > 0 && !hallProp(q) && hits(q)) damageProp(w, q, q.hp);
}

/** Breaks what `hits` finds among the standing props, each at most once for the blow that `seen` belongs to. */
function bossStrikesProps(w: World, hits: (q: Destructible) => boolean, seen: number[], amount = BOSS_PROP_DAMAGE): void {
  w.props.forEach((q, i) => {
    if (q.hp <= 0 || seen.includes(-100 - i) || !hits(q)) return;
    seen.push(-100 - i);
    damageProp(w, q, amount);
  });
}
const BOSS_SLAM_IMPACT_DAMAGE = 1;
export const BOSS_LEAP_RADIUS = 46;
/**
 * The quake: how long the sword is up before it comes down, how far the
 * cracks run, and how long after the first four the second four are laid at
 * phase III. The cracks carry the rift's own 900 ms growth on top of the
 * raise, so the whole move is read for a second and a half before anything
 * lands — the longest tell in the fight, because it denies the most ground.
 */
export const BOSS_QUAKE_MS = beats(2);
/**
 * How long he stays down on the sword after a ground strike's last blow —
 * the slam and the quake — before he rises: two beats knelt in the broken
 * floor, the weight of the blow, and the opening it leaves.
 */
const BOSS_KNEEL_MS = beats(2);
/**
 * **The storm** (doc 020): he raises the greatsword over his head and calls
 * the lightning down on the player — a bolt a beat, each marked on the floor
 * two beats before it falls (the turret's ring, closing), the first where
 * they stand, the next ahead of where they are going, and so on by turns.
 * The answer is to keep moving and to change direction: running straight
 * walks into the lead, standing still is the first mark. He stands with the
 * sword up for all of it, which is the opening for a player who can reach him
 * between two marks. Three bolts in phase I, four in II, five in III.
 */
const BOSS_STORM_RAISE_MS = beats(2);
/*
 * **The hop back** (`aimBossHop`, `stepBossHop`). He walks the player down in
 * every rest, so the moves that want room — the storm's sword held up, the
 * dashcut's run — were only chosen across the hall and almost never came.
 * They make the room themselves now: half a beat crouched, a beat in the air
 * (the leap's own frames), back away from the player by up to three tiles
 * (less against a wall), and then the move. The storm's sword goes up as he
 * lands, half a beat before the first mark; the dashcut winds up from there.
 */
export const BOSS_HOP_GATHER_MS = beats(0.5);
export const BOSS_HOP_AIR_MS = beats(1);
export const BOSS_HOP_MS = BOSS_HOP_GATHER_MS + BOSS_HOP_AIR_MS;
export const BOSS_HOP_PX = 96;
const BOSS_HOP_HEIGHT = 30;

/** Where the hop back lands: away from the player, as far as the floor allows. */
function aimBossHop(w: World, e: Enemy): void {
  const a = Math.atan2(e.y - w.player.y, e.x - w.player.x);
  let len = Math.max(0, Math.min(BOSS_HOP_PX, lineToWall(w, e.x, e.y, a, BOSS_HOP_PX + e.radius) - e.radius));
  // The line is clear; the whole body at its end has to be too.
  while (len > 0 && circleHitsWall(w.room.grid, e.x + Math.cos(a) * len, e.y + Math.sin(a) * len, e.radius)) len = Math.max(0, len - 6);
  e.bossFromX = e.x;
  e.bossFromY = e.y;
  e.bossTargetX = e.x + Math.cos(a) * len;
  e.bossTargetY = e.y + Math.sin(a) * len;
  e.bossLift = 0;
}

/** The hop, `since` ms into it: the crouch, the arc, and down on the mark. */
function stepBossHop(w: World, e: Enemy, since: number): void {
  const wasUp = e.bossLift > 0;
  if (since < BOSS_HOP_GATHER_MS) {
    e.bossLift = -3 * Math.max(0, since) / BOSS_HOP_GATHER_MS;
  } else if (since < BOSS_HOP_MS) {
    const k = (since - BOSS_HOP_GATHER_MS) / BOSS_HOP_AIR_MS;
    const ease = k * k * (3 - 2 * k);
    e.x = e.bossFromX + (e.bossTargetX - e.bossFromX) * ease;
    e.y = e.bossFromY + (e.bossTargetY - e.bossFromY) * ease;
    e.bossLift = BOSS_HOP_HEIGHT * 4 * k * (1 - k);
    // Off the floor: heard (`boss_hop`).
    if (!wasUp && e.bossLift > 0) w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "boss_hop" });
  } else if (e.bossLift !== 0) {
    e.x = e.bossTargetX;
    e.y = e.bossTargetY;
    e.bossLift = 0;
    w.flow = null;
    w.flowTile = null;
  }
}
const BOSS_STORM_BOLTS: Readonly<Record<number, number>> = { 1: 3, 2: 4, 3: 5 };
const BOSS_STORM_MARK_MS = beats(2);
const BOSS_STORM_RADIUS = 26;
const BOSS_STORM_DAMAGE = 1;
/** How far ahead of the player the leading bolts are laid: this many times where they have gone since his last glance. */
const BOSS_STORM_LEAD = 1.6;
/** How long the storm holds him: the raise, a bolt a beat, and the last one's mark and fall. */
function bossStormMs(phase: number): number {
  return BOSS_STORM_RAISE_MS + ((BOSS_STORM_BOLTS[phase] ?? 3) - 1) * BEAT_MS + BOSS_STORM_MARK_MS + 250;
}
/**
 * The storm's bolt `i`, marked now: on the player, or ahead of them, by turns;
 * inside the hall. `late` is how far past its beat the stepped clock marked
 * it, given back out of the mark so the bolt still falls on the beat.
 */
function stormBolt(w: World, e: Enemy, i: number, late: number, summon = false): void {
  const p = w.player;
  const lead = i % 2 === 1 ? BOSS_STORM_LEAD : 0;
  const ext = w.room.extent;
  const x = Math.max(TILE_PX * 1.5, Math.min((ext.w - 1.5) * TILE_PX, p.x + (p.x - e.lookX) * lead));
  const y = Math.max(TILE_PX * 1.5, Math.min((ext.h - 1.5) * TILE_PX, p.y + (p.y - e.lookY) * lead));
  // The mark counts real time and his clock may run faster (`bossTempo`): given in real ms, so it falls on his beat.
  castRift(w, x, y, 0, 0, { width: BOSS_STORM_RADIUS * 2, teleMs: (BOSS_STORM_MARK_MS - late) / bossTempo(e), damage: BOSS_STORM_DAMAGE * e.damageMult, bolt: true, summon });
}

/**
 * How long the call holds him (`stepBossPhase`): a beat with the sword up,
 * then the storm's bolts after the player — as many as the phase's storm —
 * a beat apart, and the last one's mark and fall.
 */
function bossSummonMs(phase: number): number {
  return BEAT_MS + ((BOSS_STORM_BOLTS[phase] ?? 3) - 1) * BEAT_MS + BOSS_STORM_MARK_MS + 250;
}

/** The boss's chain lies on the floor three beats: heavier than a snarecaster's 730 ms. */
const BOSS_HOOK_AIM_MS = beats(3);
/** How far his chain reaches: across the hall, since it is his answer to a player who stays out of reach. */
export const BOSS_HOOK_REACH_PX = TILE_PX * 11;
const BOSS_QUAKE_REACH = TILE_PX * 5;
const BOSS_QUAKE_SECOND_MS = beats(1.25);
/**
 * **The call's adds**, by phase: the bodies every call brings (`sure`), and
 * `more` of them drawn from a wider mix, so no two fights' calls are the same
 * company. Phase II is a pack at his feet with a few things to watch past it;
 * phase III is heavier, a body to be walked round and a line to break.
 */
const BOSS_ADDS: Readonly<Record<number, { sure: readonly EnemyId[]; mix: readonly EnemyId[]; more: number }>> = {
  2: { sure: ["rusher", "rusher"], mix: ["lancer", "orbiter", "shooter", "cinderling", "wisp"], more: 2 },
  3: { sure: ["lancer", "tank"], mix: ["shooter", "warden", "snarecaster", "pinner", "wisp", "fusilier"], more: 3 },
};
/** How far from him the call's adds rise, px, and how near the player one may. */
const BOSS_SUMMON_RING_PX = 96;
const BOSS_SUMMON_CLEAR_PX = 48;

/** The call's company for `phase`: the sure bodies, and `more` drawn from the mix without repeats. */
function bossAddsFor(w: World, phase: number): EnemyId[] {
  const table = BOSS_ADDS[phase];
  if (!table) return [];
  const mix = [...table.mix];
  const out = [...table.sure];
  for (let i = 0; i < table.more && mix.length > 0; i++) out.push(mix.splice(Math.floor(w.rng.next() * mix.length), 1)[0]!);
  return out;
}

/** Where the call's adds rise: a ring about him, each on its own floor cell, none on the player. */
export function bossSummonSpots(w: World, e: Enemy, n: number): { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = [];
  const turn = w.rng.next() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    let best: { x: number; y: number } | null = null;
    // Round the ring from its own place until a cell is free of the others and clear of the player.
    for (let k = 0; k < 12 && !best; k++) {
      const a = turn + ((i + k / 12) / n) * Math.PI * 2;
      const r = BOSS_SUMMON_RING_PX + (k % 3) * 18;
      const [gx, gy] = nearestFloor(w, e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
      const x = (gx + 0.5) * TILE_PX, y = (gy + 0.5) * TILE_PX;
      if (spots.some((s) => Math.hypot(s.x - x, s.y - y) < TILE_PX * 1.5)) continue;
      if (Math.hypot(w.player.x - x, w.player.y - y) < BOSS_SUMMON_CLEAR_PX) continue;
      best = { x, y };
    }
    if (best) spots.push(best);
  }
  return spots;
}

/**
 * The travelling band the slam throws out. Born at the sword's own reach, so
 * the ground the player is standing on when they close is safe for the beat
 * it takes them to commit, and killed off past the arena's diagonal.
 */
/*
 * The slam's band is born at his feet, where the sword goes in, at nothing —
 * not at the edge of the struck ground, where it appeared already a ring two
 * tiles across. The leap's landing keeps its own radius.
 */
function bossShock(w: World, e: Enemy, inner = 0): void {
  // The band's own roll, under the strike that throws it (`boss_wave`).
  w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "boss_wave" });
  castShockwave(w, e.x, e.y, {
    chargeMs: 0,
    inner,
    thickness: BOSS_SHOCK_THICK_PX,
    speed: BOSS_SHOCK_SPEED[e.phase] ?? 260,
    maxRadius: Math.hypot(GRID_W * TILE_PX, GRID_H * TILE_PX),
    damage: BOSS_SHOCK_DAMAGE * e.damageMult,
  });
}

function bossRing(w: World, e: Enemy, count: number, speed: number, offsetDeg: number): void {
  const ring: BulletEmission[] = [];
  for (let i = 0; i < count; i++)
    ring.push({
      size: 1.1, at_ms: 0, aim: "fixed:0", angle_deg: offsetDeg + (360 / count) * i,
      speed, from: "ring", path: [0, i],
    });
  release(w, e, ring, BOSS_SLAM_IMPACT_PX);
}

/**
 * The quake's cracks: four rifts out from the boss, the first aimed at the
 * player so the set is never the same set twice, each stopping at stone.
 *
 * A rift carries its own growth before it erupts, so the player has the raise
 * *and* the crack to read — and the answer is to stand between two of them,
 * which is a different question from the slam's (come in) and the leap's
 * (leave the mark). Three moves, three answers.
 */
function bossQuake(w: World, e: Enemy, offset: number): void {
  const toward = Math.atan2(w.player.y - e.y, w.player.x - e.x) + offset;
  for (let i = 0; i < 4; i++) {
    const a = toward + (i / 4) * Math.PI * 2;
    // Stopped at the first stone, like the rifter's own crack: a fissure
    // does not run through a pillar, and one that did would be unanswerable.
    castRift(w, e.x, e.y, a, lineToWall(w, e.x, e.y, a, BOSS_QUAKE_REACH),
      { width: TILE_PX * 0.9, damage: BOSS_QUAKE_DAMAGE * e.damageMult });
  }
}

/** The boss's moves by name, for the boss lab. */
export const BOSS_MOVE_NAMES: readonly BossMove[] = ["slam", "quake", "leap", "hook", "storm"];

/**
 * The boss lab's "do this now": queue `move` on the beat grid exactly as the
 * rotation would — the commit on the next downbeat for a ground strike, the
 * next beat for the chains — skipping the gap and the hook's line test.
 * False when the boss is busy (a move, a blade, a phase change).
 */
export function queueBossMove(w: World, move: BossMove): boolean {
  const e = w.enemies.find((b) => b.archetype === "boss" && b.hp > 0);
  if (!e || e.bossCast !== "none" || e.attack !== "approach" || e.airborne || e.bossRoarMs > 0 || e.bossSummonMs > 0) return false;
  const unit = BOSS_ON_DOWNBEAT.has(move) ? BAR_MS : BEAT_MS;
  const commitAt = e.bossFightMs + bossCommitMs(move, e.phase);
  // It is his turn now, in place of whatever he had chosen.
  e.bossBlade = null;
  e.bossVolleyMs = 0;
  e.bossLastAct = move;
  e.bossNext = move;
  // To the next line strictly, as the rotation queues (the start is still ahead).
  e.bossStartAt = commitAt + untilGrid(commitAt, unit) - bossCommitMs(move, e.phase);
  e.bossMoveMs = 0;
  return true;
}

/** The boss lab's blade on demand: `kind` wound up at the player now, on its beat. */
export function forceBossBlade(w: World, kind: MeleeKind, opts: { hop?: boolean } = {}): boolean {
  const e = w.enemies.find((b) => b.archetype === "boss" && b.hp > 0);
  if (!e || e.bossCast !== "none" || e.attack !== "approach" || e.airborne || e.bossNext !== "none"
    || e.bossRoarMs > 0 || e.bossSummonMs > 0 || e.bossHopMs > 0) return false;
  // The dashcut as his turn throws it, the hop back before the windup (`stepBossHop`).
  if (kind === "dashcut" && opts.hop) {
    aimBossHop(w, e);
    e.bossHopMs = BOSS_HOP_MS;
    e.bossBusy = true;
    return true;
  }
  e.attackCooldownMs = 0;
  beginWindup(w, e, w.player, kind);
  return true;
}

function stepBoss(w: World, e: Enemy, dtMs: number): void {
  if (!isActive(e) && !e.airborne) return;
  if (!e.awake) return;
  /*
   * **What he costs**: his own figure (`BOSS_POWER`) times the boss band's
   * `power`, read when a volley is fired and when a blade is armed.
   *
   * The band was already written to apply to him — its note says only the
   * *beat* is the boss's and that "health and damage keep the late-run
   * figures" — and it did not, because nothing passes him a scale. That
   * mattered the moment the player's bar started growing on its own
   * (`run/levels.ts`): the fountain at the fixed stop refills half the bar,
   * so the health a player arrives at the king with is very nearly their
   * maximum whatever the fourteen fights cost, and a maximum that grew by
   * half while his blows did not is the whole fight rebalanced by the back
   * door. His **health** is still his own: scaling that would make the fight
   * longer rather than harder, and the length of it is doc 020's.
   */
  e.damageMult = BOSS_POWER * rampFor(w.roomIndex).power;
  /*
   * **The roar, then the call** (`stepBossPhase`). Through the roar he only
   * stands. As it ends, once per phase, he holds the greatsword up and calls:
   * the phase's adds rise about him (each out of its own spawn, as any body
   * arrives), and violet bolts are called down after the player a beat apart
   * — the storm's, aimed the same way — so the call is not a free moment to
   * stand at him and cut.
   */
  if (e.bossRoarMs > 0) {
    e.bossRoarMs -= dtMs;
    /*
     * The hall shakes under it for the whole of it: a hard jolt as it opens,
     * then a held rumble (the camera shakes by trauma squared, so 0.6 is a
     * steady tremor, not a blow), let go over its last quarter.
     */
    const into = BOSS_ROAR_MS - e.bossRoarMs;
    const rumble = into < 180 ? 0.85 : 0.6 * Math.min(1, e.bossRoarMs / (BOSS_ROAR_MS * 0.25));
    w.trauma = Math.max(w.trauma, rumble);
    if (e.bossRoarMs > 0) return;
    e.bossRoarMs = 0;
    // The end of the first audience (doc 022): where phase II would call, he goes back up.
    if (e.bossScript === "audience") {
      e.bossLeaving = true;
      e.bossCast = "meteor";
      e.bossCastEndAt = -1;
      w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "boss_retreat" });
      return;
    }
    // Into phase III, no call: the fall (`BOSS_METEOR_GATHER_MS`), set going on the next step.
    if (e.phase >= 3) {
      e.bossAddsPhase = Math.max(e.bossAddsPhase, e.phase);
      e.bossCast = "meteor";
      e.bossCastEndAt = -1;
      w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "boss_meteor" });
      return;
    }
    const adds = e.bossAddsPhase < e.phase ? bossAddsFor(w, e.phase) : [];
    e.bossAddsPhase = Math.max(e.bossAddsPhase, e.phase);
    if (adds.length > 0) {
      bossSummonSpots(w, e, adds.length).forEach((s, i) => {
        const add = makeEnemy(w.nextEnemyId++, adds[i]!, s.x, s.y, [], rampFor(w.roomIndex));
        add.awake = true;
        // The king's, like the king: nothing in this room pays experience,
        // because the run ends in it (`run/levels.ts`).
        add.summoned = true;
        w.enemies.push(add);
        w.events.push({ kind: "hazard_tick", x: s.x, y: s.y, what: "boss_summon" });
      });
      e.bossSummonMs = bossSummonMs(e.phase);
      e.bossBolts = 0;
      // The first bolt marked on the beat after next, so they fall on the beats as the storm's do.
      e.bossCommitAt = e.bossFightMs + BEAT_MS + untilGrid(e.bossFightMs + BEAT_MS, BEAT_MS);
      w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "boss_summon" });
      return;
    }
    e.bossBusy = false;
    e.bossMoveMs = 1400;
    return;
  }
  if (e.bossSummonMs > 0) {
    e.bossSummonMs -= dtMs;
    const n = BOSS_STORM_BOLTS[e.phase] ?? 3;
    while (e.bossBolts < n && e.bossFightMs >= e.bossCommitAt + e.bossBolts * BEAT_MS - 1e-6) {
      stormBolt(w, e, e.bossBolts, Math.max(0, e.bossFightMs - (e.bossCommitAt + e.bossBolts * BEAT_MS)), true);
      e.bossBolts++;
    }
    if (e.bossSummonMs > 0 || e.bossBolts < n) return;
    e.bossSummonMs = 0;
    e.bossBusy = false;
    e.bossMoveMs = 1400;
    return;
  }

  /*
   * **His turns** (`chooseBossAct`). Out of one — a move finished, a blade
   * string recovered, a volley spent, a stagger over — the rest starts, and
   * it is the player's: he only walks back round to face them.
   */
  if (e.bossCast === "none" && e.attack === "approach" && e.bossVolleyMs > 0) {
    e.bossVolleyMs -= dtMs;
    // A player who comes in through the volley is met with what is at his feet, not a rest.
    if (e.gapPx < BOSS_CLOSE_PX - e.radius - PLAYER_RADIUS) { e.bossVolleyMs = 0; e.bossBusy = false; e.bossMoveMs = 0; }
  }
  if (e.bossBlade !== null && e.attack === "approach") {
    e.bossPlanMs += dtMs;
    // Walked after too long: the turn is given up for one that fits where they are now, at once.
    if (e.bossPlanMs > BOSS_BLADE_CHASE_MS) { e.bossBlade = null; e.bossBusy = false; e.bossMoveMs = 0; }
  }
  /*
   * **The dashcut's hop back** (`stepBossHop`): room made first, and the
   * windup — the crouch with the line drawn, the tell — from where he lands.
   */
  if (e.bossHopMs > 0) {
    e.bossHopMs -= dtMs;
    stepBossHop(w, e, BOSS_HOP_MS - e.bossHopMs);
    if (e.bossHopMs > 0) return;
    e.bossHopMs = 0;
    stepBossHop(w, e, BOSS_HOP_MS);
    e.attackCooldownMs = 0;
    beginWindup(w, e, w.player, "dashcut");
    return;
  }
  const busy = e.bossCast !== "none" || e.attack !== "approach" || e.bossNext !== "none"
    || e.bossVolleyMs > 0 || e.bossBlade !== null || e.airborne || e.bossHopMs > 0;
  if (e.bossBusy && !busy) e.bossMoveMs = bossRestMs(w, e);
  e.bossBusy = busy;

  if (e.bossCast === "none") {
    if (e.attack !== "approach" || e.bossBlade !== null || e.bossVolleyMs > 0) return;
    if (e.bossNext === "none") {
      e.bossMoveMs -= dtMs;
      if (e.bossMoveMs > 0) return;
      const act = chooseBossAct(w, e);
      if (act === null) return;
      e.bossLastAct = act;
      e.bossBusy = true;
      if (act === "volley") {
        e.bossVolleyMs = BOSS_VOLLEY_MS;
        e.patternMs = 0;
        return;
      }
      // The dashcut hops back before its windup, wherever the player stands (`stepBossHop`).
      if (act === "dashcut") {
        aimBossHop(w, e);
        e.bossHopMs = BOSS_HOP_MS;
        return;
      }
      if (!(BOSS_MOVE_NAMES as readonly string[]).includes(act)) {
        e.bossBlade = act as MeleeKind;
        e.bossPlanMs = 0;
        return;
      }
      /*
       * **On the beat** (doc 020): a move is queued to start at the moment
       * that puts its commit — the instant it promises damage — on the grid
       * of the boss theme: the ground strikes on a downbeat, the chains on
       * any beat. What waits is the idle gap in front of the telegraph, by
       * less than a bar.
       */
      const next = act as BossMove;
      const unit = BOSS_ON_DOWNBEAT.has(next) ? BAR_MS : BEAT_MS;
      const commitAt = e.bossFightMs + bossCommitMs(next, e.phase);
      e.bossNext = next;
      // To the next line strictly: the start is still ahead, so there is no stepped clock to allow for yet.
      e.bossStartAt = commitAt + untilGrid(commitAt, unit) - bossCommitMs(next, e.phase);
    }
    if (e.bossFightMs < e.bossStartAt) return;
    const move = e.bossNext as Exclude<Enemy["bossNext"], "none">;
    const commitIn = bossCommitMs(move, e.phase);
    /*
     * The stepped clock arrives at or past the start — by a step, or by a
     * freeze when hitstop jumped it — and the telegraph gives that back, so
     * the commit is on the line rather than behind it. A freeze is at most
     * 100 ms against telegraphs of 357 ms and more, so none nears the floor.
     */
    const trim = Math.max(0, e.bossFightMs - e.bossStartAt);
    e.bossNext = "none";
    e.bossStartAt = -1;
    // Missed by more than a freeze (a backhand ran through the queue): queue it again for the next line
    // rather than eat into a telegraph.
    if (trim > BOSS_MAX_TRIM_MS) { e.bossLastAct = ""; e.bossBusy = false; e.bossMoveMs = 0; return; }
    e.bossMoveIndex++;
    e.bossCast = move;
    e.bossCastMs = (move === "slam" ? bossCommitMs("slam", e.phase)
      : move === "quake" ? BOSS_QUAKE_MS
        : move === "storm" ? bossStormMs(e.phase)
          : BOSS_LEAP_MS) - trim;
    e.bossBolts = 0;
    e.bossCastEndAt = e.bossFightMs + e.bossCastMs;
    e.bossCommitAt = e.bossFightMs + commitIn - trim;
    // Every move drops the volley in hand: two telegraphs on one body at one
    // moment is two telegraphs nobody reads (and see `fire`, which holds while he moves).
    e.pending = [];
    e.telegraphMs = 0;
    dropFireToken(w, e);
    if (move === "storm") aimBossHop(w, e);
    if (move === "leap") {
      e.bossTargetX = w.player.x;
      e.bossTargetY = w.player.y;
      e.bossFromX = e.x;
      e.bossFromY = e.y;
      e.bossLift = 0;
    }
    if (move === "hook") {
      /*
       * The snarecaster's own chain, thrown by the boss: the line lies on the
       * floor for its aim window, flies, and on a hit drags the player in.
       * Reusing the kind rather than authoring a grab is the whole point of
       * the boss being an `EnemyId` — the player has already learned how to
       * answer a chain, and what is new is what is standing at the other end.
       */
      castRanged(w, e, "hook", { x: w.player.x, y: w.player.y });
      /*
       * A heavier chain than the snarecaster's, and slower to throw. At the
       * snarecaster's 730 ms the grab and the greatsword behind it were two
       * hearts on one read, and the whole answer to a chain — dash across the
       * line while it lies on the floor — needs the line to lie there long
       * enough to be seen under everything else the boss has in the air.
       */
      const chain = w.tethers.find((t) => t.alive && t.kind === "hook" && t.from === e.id && t.phase === "aim");
      if (chain) { chain.ms = BOSS_HOOK_AIM_MS - trim; chain.dueAt = e.bossFightMs + chain.ms; }
      e.poseMs = BOSS_HOOK_AIM_MS - trim;
      // The pose owns the timing from here; the cast is over as far as the
      // move list is concerned once the chain is in the air.
      e.bossCastMs = beats(4);
      e.bossCastEndAt = e.bossFightMs + e.bossCastMs;
    }
    w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: `boss_${move}` });
    return;
  }

  if (e.bossCast === "meteor" && e.bossCastEndAt < 0) {
    if (e.bossLeaving) startKingLeaving(e);
    else startBossMeteor(w, e);
  }
  const before = e.bossCastMs;
  // From the absolute end, not by subtraction: hitstop freezes this function but not the clock, so a
  // countdown would come out late by every freeze inside the telegraph, and off the beat.
  e.bossCastMs = e.bossCastEndAt - e.bossFightMs;
  keepBossOnBeat(w, e);
  if (e.bossCast === "slam") {
    /*
     * Phase III: the two stomps first (`BOSS_SLAM_III_STOMPS`), the ground
     * round his feet struck and nothing thrown.
     *
     * **No bullet ring.** The slam threw one with each band, and the dash
     * that crossed the band came out of its i-frames into the bullets: two
     * questions whose answers cancel, which read as "dodged it and got hit
     * anyway". The band is the move.
     */
    if (e.phase >= 3) {
      for (const at of BOSS_SLAM_III_STOMPS) {
        if (!(before > at && e.bossCastMs <= at)) continue;
        if (Math.hypot(w.player.x - e.x, w.player.y - e.y) <= BOSS_SLAM_STOMP_PX + PLAYER_RADIUS)
          hurtPlayer(w, e.x, e.y, "melee:boss", 0, BOSS_SLAM_IMPACT_DAMAGE * e.damageMult);
        bossStrikesProps(w, (q) => Math.hypot(q.x - e.x, q.y - e.y) <= BOSS_SLAM_STOMP_PX + q.radius, []);
        impact(w, BOSS_STRIKE_STOP_MS * 0.5, BOSS_STRIKE_TRAUMA * 0.6);
        w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "boss_stomp" });
        // The floor heaved up out to the struck ground's edge: drawn, not heard (the stomp is).
        w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "heave", amount: BOSS_SLAM_STOMP_PX });
      }
    }
    if (before > 0 && e.bossCastMs <= 0) {
      // The sword into the floor at his feet: the ground round them is struck (wider in phase III).
      const struck = e.phase >= 3 ? BOSS_SLAM_STOMP_PX : BOSS_SLAM_IMPACT_PX;
      if (Math.hypot(w.player.x - e.x, w.player.y - e.y) <= struck + PLAYER_RADIUS)
        hurtPlayer(w, e.x, e.y, "melee:boss", 0, BOSS_SLAM_IMPACT_DAMAGE * e.damageMult);
      bossStrikesProps(w, (q) => Math.hypot(q.x - e.x, q.y - e.y) <= struck + q.radius, []);
      bossShock(w, e);
      // A greatsword driven into stone: a long freeze and the room shaking, so it lands like one.
      impact(w, BOSS_STRIKE_STOP_MS, BOSS_STRIKE_TRAUMA);
      w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "boss_slam" });
      if (e.phase >= 3) w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "heave", amount: struck });
    }
    if (e.bossCastMs <= -BOSS_KNEEL_MS) finishBossMove(e);
    return;
  }
  if (e.bossCast === "quake") {
    // The sword comes down: four cracks out along the compass, turned toward
    // the player so one of them is never the line they are standing on.
    if (before > 0 && e.bossCastMs <= 0) {
      bossQuake(w, e, 0);
      impact(w, BOSS_STRIKE_STOP_MS, BOSS_STRIKE_TRAUMA * 0.85);
      w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "boss_quake" });
    }
    // Phase III lays a second four into the first's gaps, so the gap the
    // player picked is the one that closes.
    if (e.phase >= 3 && before > -BOSS_QUAKE_SECOND_MS && e.bossCastMs <= -BOSS_QUAKE_SECOND_MS)
      bossQuake(w, e, Math.PI / 4);
    if (e.bossCastMs <= (e.phase >= 3 ? -BOSS_QUAKE_SECOND_MS : 0) - BOSS_KNEEL_MS) finishBossMove(e);
    return;
  }
  if (e.bossCast === "storm") {
    // The hop back before the sword goes up (`stepBossHop`).
    stepBossHop(w, e, e.bossFightMs - (e.bossCommitAt - BOSS_STORM_RAISE_MS));
    // A bolt a beat from the first, on the fight clock, so each falls on the beat two after it is marked.
    const n = BOSS_STORM_BOLTS[e.phase] ?? 3;
    while (e.bossBolts < n && e.bossFightMs >= e.bossCommitAt + e.bossBolts * BEAT_MS - 1e-6) {
      stormBolt(w, e, e.bossBolts, Math.max(0, e.bossFightMs - (e.bossCommitAt + e.bossBolts * BEAT_MS)));
      e.bossBolts++;
    }
    if (e.bossCastMs <= 0 && e.bossBolts >= n) finishBossMove(e);
    return;
  }
  if (e.bossCast === "meteor") {
    if (e.bossEntrance) stepKingEntrance(w, e, before);
    else if (e.bossLeaving) stepKingLeaving(w, e);
    else stepBossMeteor(w, e, before);
    return;
  }
  if (e.bossCast === "hook") {
    /*
     * **The hook** (doc 020). The chain lies on the floor aimed at the player
     * and follows them the whole time it lies there — he does not miss by
     * where they were — and is thrown from wherever they are when it goes;
     * the answer is the dash through its flight, or the step off its line as
     * it leaves. It costs nothing when it catches (`stepTether`): it drags
     * them to his feet, in front of him, and the light slash is already
     * coming as they land. The grab is the setup; the cut is the damage.
     */
    const p = w.player;
    for (const t of w.tethers) {
      if (!t.alive || t.from !== e.id || t.kind !== "hook") continue;
      if (t.phase === "aim") {
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        const len = lineToWall(w, e.x, e.y, a, BOSS_HOOK_REACH_PX);
        t.x1 = e.x + Math.cos(a) * len;
        t.y1 = e.y + Math.sin(a) * len;
      }
      if (t.phase === "drag") e.bossHooked = true;
    }
    const chain = w.tethers.some((t) => t.alive && t.from === e.id);
    if (e.bossHooked) {
      if (p.dragMs > 0 || chain) return;
      e.bossHooked = false;
      finishBossMove(e);
      // One cut, not a string: the grab was the first blow of it.
      e.bossString = [];
      e.bossStringN = 1;
      e.bossLinked = true;
      e.bossLinkedBlow = null;
      beginWindup(w, e, p, "greatslash");
      e.bossLinked = false;
      return;
    }
    if (!chain && e.bossCastMs <= 0) finishBossMove(e);
    if (e.bossCastMs <= -1600) finishBossMove(e);
    return;
  }
  /*
   * **The leap.** The gather, the climb out of the view, the hunt, the lock
   * and the fall — see `BOSS_LEAP_MS`. While he is up his coordinates are
   * the mark's, so the fall comes down where he is.
   */
  const elapsed = BOSS_LEAP_MS - e.bossCastMs;
  const upAt = BOSS_LEAP_RISE_MS, huntAt = upAt + BOSS_LEAP_UP_MS, lockAt = huntAt + BOSS_LEAP_HUNT_MS;
  const fallAt = BOSS_LEAP_MS - BOSS_LEAP_FALL_MS;
  const wasAir = e.airborne;
  e.airborne = elapsed > upAt && e.bossCastMs > 0;
  // Off the floor, and the mark locking: both heard (`boss_jump`, `boss_lock`), the second being the cue to go.
  if (!wasAir && e.airborne) w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "boss_jump" });
  if (BOSS_LEAP_MS - before < lockAt && elapsed >= lockAt)
    w.events.push({ kind: "telegraph", x: e.bossTargetX, y: e.bossTargetY, what: "boss_lock" });
  if (e.bossCastMs > 0) {
    if (!e.airborne) {
      // The gather: it sinks a little before it goes, which is the beat that says "now".
      e.bossLift = -3 * (elapsed / Math.max(1, BOSS_LEAP_RISE_MS));
    } else {
      e.knockX = 0;
      e.knockY = 0;
      e.vx = 0;
      e.vy = 0;
      if (elapsed < huntAt) {
        // Straight up, quickening: a greatsword and a body that size leaving the floor.
        const k = (elapsed - upAt) / BOSS_LEAP_UP_MS;
        e.bossLift = BOSS_LEAP_SKY_PX * k * k;
      } else {
        if (elapsed < lockAt) {
          // The hunt: the mark after the player, at about their own pace.
          const p = w.player;
          const dx = p.x - e.bossTargetX, dy = p.y - e.bossTargetY;
          const d = Math.hypot(dx, dy);
          const reach = BOSS_LEAP_HUNT_SPEED * (dtMs / 1000);
          if (d > 0) {
            const t = Math.min(1, reach / d);
            e.bossTargetX += dx * t;
            e.bossTargetY += dy * t;
          }
        }
        // Out of sight, under the mark.
        e.x = e.bossTargetX;
        e.y = e.bossTargetY;
        // The fall: in from the top of the view, quickening onto the mark.
        const k = Math.max(0, (elapsed - fallAt) / BOSS_LEAP_FALL_MS);
        e.bossLift = elapsed < fallAt ? BOSS_LEAP_SKY_PX : BOSS_LEAP_SKY_PX * (1 - k * k);
      }
    }
  }
  if (before > 0 && e.bossCastMs <= 0) {
    const [gx, gy] = nearestFloor(w, e.bossTargetX, e.bossTargetY);
    e.x = (gx + 0.5) * TILE_PX;
    e.y = (gy + 0.5) * TILE_PX;
    e.airborne = false;
    e.bossLift = 0;
    impact(w, HITSTOP_CAP, 0);
    // A landing this size is felt: the biggest single shake in the fight,
    // and the dust the renderer throws off it hangs on the same event.
    w.trauma = Math.min(1, w.trauma + 0.7);
    w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "boss_land" });
    bossStrikesProps(w, (q) => Math.hypot(q.x - e.x, q.y - e.y) <= BOSS_LEAP_RADIUS + q.radius, []);
    if (Math.hypot(w.player.x - e.x, w.player.y - e.y) <= BOSS_LEAP_RADIUS + PLAYER_RADIUS)
      hurtPlayer(w, e.x, e.y, "melee:boss", 0, BOSS_LAND_DAMAGE * e.damageMult);
    /*
     * **The landing throws the shockwave.** It is the same band the standing
     * slam sends, born at the same safe radius — so the answer the player
     * learned in phase I still works, and the leap is that question asked
     * about ground they did not choose. Without it the leap was a body
     * arriving and nothing else, which is why it read as a teleport even
     * once it had an arc.
     */
    bossShock(w, e, BOSS_LEAP_RADIUS);
    bossRing(w, e, 8, 110, 22);
    w.flow = null;
    w.flowTile = null;
  }
  // The landing is the opening: it stays down for half a second.
  if (e.bossCastMs <= -500) finishBossMove(e);
}

/** From a move's start to the moment it promises damage: the part the beat grid aligns. */
const BOSS_COMMIT_MS: Readonly<Record<Exclude<Enemy["bossCast"], "none">, number>> = {
  slam: BOSS_SLAM_MS, quake: BOSS_QUAKE_MS, leap: BOSS_LEAP_MS, hook: BOSS_HOOK_AIM_MS, storm: BOSS_STORM_RAISE_MS,
  // Never queued: the fall into phase III sets its own landing on the downbeat (`startBossMeteor`).
  meteor: 0,
};
/**
 * The slam's next blow, for the renderer: how far it strikes, how far
 * through its gathering he is (0 to 1), how long since the last blow fell
 * (for the drive frame), and whether it is the one that throws the band; or
 * null once the last has fallen.
 */
export function bossSlamNext(e: Enemy): { radius: number; t: number; since: number; last: boolean } | null {
  if (e.bossCast !== "slam" || e.bossCastMs <= 0) return null;
  const falls = e.phase >= 3 ? [...BOSS_SLAM_III_STOMPS, 0] : [0];
  const total = bossCommitMs("slam", e.phase);
  let from = total, since = Infinity;
  for (let i = 0; i < falls.length; i++) {
    const at = falls[i]!;
    if (e.bossCastMs > at) {
      return { radius: e.phase >= 3 ? BOSS_SLAM_STOMP_PX : BOSS_SLAM_IMPACT_PX, t: Math.max(0, Math.min(1, (from - e.bossCastMs) / (from - at))), since, last: at === 0 };
    }
    from = at;
    since = at - e.bossCastMs;
  }
  return null;
}
/** The commit of `move` at `phase`: the phase III slam's is its third, charged blow (`BOSS_SLAM_III_STOMPS`). */
function bossCommitMs(move: Exclude<Enemy["bossCast"], "none">, phase: number): number {
  return move === "slam" && phase >= 3 ? BOSS_SLAM_MS + BOSS_SLAM_III_STOMPS[0]! : BOSS_COMMIT_MS[move];
}
/**
 * What the boss's ground strikes cost the frame: four frames of freeze and a
 * shake. The roster's hits freeze a frame and never shake (`TRAUMA_HIT`); a
 * greatsword into the floor has to be felt in the hands, or it reads as the
 * floor cracking by itself while a body stands near it.
 */
const BOSS_STRIKE_STOP_MS = FRAME_MS * 4;
const BOSS_STRIKE_TRAUMA = 0.42;
/** The most a telegraph gives back to put its commit on the line: one freeze at its cap, and a step. */
const BOSS_MAX_TRIM_MS = HITSTOP_CAP + FRAME_MS;
/** The ground strikes take the downbeat; the chains take any beat. */
const BOSS_ON_DOWNBEAT: ReadonlySet<string> = new Set(["slam", "quake", "leap"]);

/**
 * The parts of a move that run on clocks of their own — the hook's chain,
 * the blade's windup — are held to the fight clock too, for the
 * same reason as `bossCastMs`: those clocks stop in hitstop and the beat does
 * not. A clock may only be brought *forward* to its target, never pushed back.
 */
function keepBossOnBeat(w: World, e: Enemy): void {
  const toCommit = e.bossCommitAt - e.bossFightMs;
  if (e.bossCast === "hook")
    for (const t of w.tethers) if (t.alive && t.from === e.id && t.phase === "aim") t.ms = Math.max(0, Math.min(t.ms, toCommit));
}

/** Sets the fall going (`BOSS_METEOR_GATHER_MS`): the landing on the downbeat after its shortest length, in the middle of the hall. */
function startBossMeteor(w: World, e: Enemy): void {
  const least = BOSS_METEOR_GATHER_MS + BOSS_METEOR_UP_MS + BOSS_METEOR_RAIN_MS;
  const landAt = e.bossFightMs + least + untilGrid(e.bossFightMs + least, BAR_MS);
  e.bossCastEndAt = landAt;
  e.bossCastMs = landAt - e.bossFightMs;
  // The landing is what it promises; the rain starts when he is up, and the stones are marked a beat apart from there
  // (in `bossStartAt`, which only a queued move uses otherwise, and none is queued through the fall).
  e.bossCommitAt = landAt;
  e.bossStartAt = e.bossFightMs + BOSS_METEOR_GATHER_MS + BOSS_METEOR_UP_MS;
  e.bossBolts = 0;
  const ext = w.room.extent;
  const [gx, gy] = nearestFloor(w, (ext.w / 2) * TILE_PX, (ext.h / 2) * TILE_PX);
  e.bossTargetX = (gx + 0.5) * TILE_PX;
  e.bossTargetY = (gy + 0.5) * TILE_PX;
  e.bossFromX = e.x;
  e.bossFromY = e.y;
  e.bossLift = 0;
}

/** A floor cell anywhere in the hall, drawn from the fight's stream, for a stone. */
function anyFloor(w: World): { x: number; y: number } {
  const ext = w.room.extent;
  for (let i = 0; i < 40; i++) {
    const gx = 1 + Math.floor(w.rng.next() * Math.max(1, ext.w - 2));
    const gy = 1 + Math.floor(w.rng.next() * Math.max(1, ext.h - 2));
    if (w.room.grid[gy * GRID_W + gx] === Tile.Floor) return { x: (gx + 0.5) * TILE_PX, y: (gy + 0.5) * TILE_PX };
  }
  return { x: w.player.x, y: w.player.y };
}

/** The fall, one step: up, the rain of stones while he is up, and the landing (`BOSS_METEOR_GATHER_MS`). */
function stepBossMeteor(w: World, e: Enemy, before: number): void {
  const upAt = e.bossStartAt - BOSS_METEOR_UP_MS;
  const since = e.bossFightMs - upAt;
  const wasAir = e.airborne;
  e.airborne = since > 0 && e.bossCastMs > 0;
  if (!wasAir && e.airborne) w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "boss_jump" });
  if (e.bossCastMs > 0) {
    e.knockX = 0; e.knockY = 0; e.vx = 0; e.vy = 0;
    if (since <= 0) {
      // The gather, as the leap's.
      e.bossLift = -3 * Math.min(1, (BOSS_METEOR_GATHER_MS + since) / BOSS_METEOR_GATHER_MS);
    } else if (since < BOSS_METEOR_UP_MS) {
      const k = since / BOSS_METEOR_UP_MS;
      e.bossLift = BOSS_LEAP_SKY_PX * k * k;
    } else {
      // Up out of the hall, over the middle, where he comes down.
      e.x = e.bossTargetX;
      e.y = e.bossTargetY;
      const k = Math.max(0, 1 - e.bossCastMs / BOSS_METEOR_FALL_MS);
      e.bossLift = e.bossCastMs > BOSS_METEOR_FALL_MS ? BOSS_LEAP_SKY_PX : BOSS_LEAP_SKY_PX * (1 - k * k);
    }
    /*
     * The stones, a beat apart from the rain's start, while there is time for
     * each to have fallen before the landing's tell (`BOSS_METEOR_LAND_TELL_MS`):
     * one where the player is, and the rest anywhere on the floor.
     */
    const lastMark = e.bossCastEndAt - BOSS_METEOR_MARK_MS - BOSS_METEOR_LAND_TELL_MS;
    for (;;) {
      const markAt = e.bossStartAt + e.bossBolts * BEAT_MS;
      if (markAt > lastMark + 1e-6 || e.bossFightMs < markAt - 1e-6) break;
      const late = Math.max(0, e.bossFightMs - markAt);
      const spots = [{ x: w.player.x, y: w.player.y }];
      for (let i = 0; i < BOSS_METEOR_SCATTER; i++) spots.push(anyFloor(w));
      for (const at of spots)
        castRift(w, at.x, at.y, 0, 0, {
          width: BOSS_METEOR_ROCK_RADIUS * 2, teleMs: BOSS_METEOR_MARK_MS - late,
          damage: BOSS_METEOR_ROCK_DAMAGE * e.damageMult, rock: true,
        });
      e.bossBolts++;
    }
  }
  if (before > 0 && e.bossCastMs <= 0) {
    e.bossStartAt = -1;
    e.x = e.bossTargetX;
    e.y = e.bossTargetY;
    e.airborne = false;
    e.bossLift = 0;
    impact(w, HITSTOP_CAP, 0);
    w.trauma = 1;
    w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "boss_land" });
    bossStrikesProps(w, (q) => Math.hypot(q.x - e.x, q.y - e.y) <= BOSS_METEOR_LAND_PX + q.radius, []);
    if (Math.hypot(w.player.x - e.x, w.player.y - e.y) <= BOSS_METEOR_LAND_PX + PLAYER_RADIUS)
      hurtPlayer(w, e.x, e.y, "melee:boss", 0, BOSS_LAND_DAMAGE * e.damageMult);
    bossShock(w, e, BOSS_METEOR_LAND_PX);
    w.flow = null;
    w.flowTile = null;
  }
  // Knelt in the crater: the opening phase III gives first.
  if (e.bossCastMs <= -BOSS_KNEEL_MS) finishBossMove(e);
}

/*
 * **The first audience's two ends** (doc 022): the king comes down into room 5
 * and goes back up out of it. Both are the fall into phase III's machinery —
 * `bossCast` "meteor", the leap's frames, the landing mark while
 * `bossCastMs <= BOSS_METEOR_LAND_TELL_MS` — so the renderer draws them as it
 * already draws the fall, with none of what makes the fall a threat.
 */

/**
 * How long he stands after coming down before his first turn. The landing is
 * already its own beat — the sword driven into the floor, then knelt on over
 * it (`BOSS_KNEEL_MS`) — so he rises and comes on a beat later; standing
 * through his whole name read as him waiting to be hit.
 */
export const KING_AUDIENCE_FIRST_TURN_MS = BEAT_MS;

/**
 * Puts the king above his mark, falling: he lands after the landing's tell
 * (`BOSS_METEOR_LAND_TELL_MS`), on the bar line after it, so the landing is on
 * the downbeat as every landing of his is.
 */
export function beginKingEntrance(e: Enemy, x: number, y: number): void {
  e.x = e.bossTargetX = e.bossFromX = x;
  e.y = e.bossTargetY = e.bossFromY = y;
  e.bossEntrance = true;
  e.bossCast = "meteor";
  e.bossBusy = true;
  e.awake = true;
  e.spawnFadeMs = 0;
  e.airborne = true;
  e.bossLift = BOSS_LEAP_SKY_PX;
  const least = BOSS_METEOR_LAND_TELL_MS;
  e.bossCastEndAt = e.bossFightMs + least + untilGrid(e.bossFightMs + least, BAR_MS);
  e.bossCastMs = e.bossCastEndAt - e.bossFightMs;
  e.bossCommitAt = e.bossCastEndAt;
}

/**
 * The entrance, one step: up out of sight over the mark, the drop onto it,
 * and a landing that is his arrival and nothing else — **no band, no struck
 * ground, no hurt**. The mark is far from the player (`KING_DROP_MIN_PX`), so
 * nothing about it could have reached them; the first band in the room is his
 * first slam's, and that one costs.
 */
function stepKingEntrance(w: World, e: Enemy, before: number): void {
  e.x = e.bossTargetX;
  e.y = e.bossTargetY;
  if (e.bossCastMs > 0) {
    e.airborne = true;
    e.knockX = 0; e.knockY = 0; e.vx = 0; e.vy = 0;
    const k = Math.max(0, 1 - e.bossCastMs / BOSS_LEAP_FALL_MS);
    e.bossLift = e.bossCastMs > BOSS_LEAP_FALL_MS ? BOSS_LEAP_SKY_PX : BOSS_LEAP_SKY_PX * (1 - k * k);
    return;
  }
  if (before > 0) {
    e.airborne = false;
    e.bossLift = 0;
    impact(w, HITSTOP_CAP, 0);
    w.trauma = 1;
    w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "boss_land" });
    w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "boss_arrives" });
    bossStrikesProps(w, (q) => Math.hypot(q.x - e.x, q.y - e.y) <= BOSS_METEOR_LAND_PX + q.radius, []);
    w.flow = null;
    w.flowTile = null;
  }
  // The sword driven in and knelt on, then up, and a beat later his first turn (`KING_AUDIENCE_FIRST_TURN_MS`).
  if (e.bossCastMs <= -BOSS_KNEEL_MS) {
    finishBossMove(e);
    e.bossEntrance = false;
    e.bossBusy = false;
    e.bossMoveMs = KING_AUDIENCE_FIRST_TURN_MS;
  }
}

/** Sets his leaving going: the leap's gather, then straight up out of the view, and he does not come down. */
function startKingLeaving(e: Enemy): void {
  e.bossCastEndAt = e.bossFightMs + BOSS_METEOR_GATHER_MS + BOSS_METEOR_UP_MS;
  e.bossCastMs = e.bossCastEndAt - e.bossFightMs;
  e.bossCommitAt = e.bossCastEndAt;
  e.bossTargetX = e.bossFromX = e.x;
  e.bossTargetY = e.bossFromY = e.y;
  e.bossLift = 0;
}

/**
 * His leaving, one step. Crouched on the floor he can still be struck, and
 * whatever lands is held on the retreat's line (`kingFloorHp`); once he is up
 * nothing reaches him, and at the top of the climb he is gone
 * (`Enemy.gone`) — the room clears behind him.
 */
function stepKingLeaving(w: World, e: Enemy): void {
  e.knockX = 0; e.knockY = 0; e.vx = 0; e.vy = 0;
  const since = BOSS_METEOR_UP_MS - e.bossCastMs;
  const wasAir = e.airborne;
  e.airborne = since > 0;
  if (!wasAir && e.airborne) w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "boss_jump" });
  if (since <= 0) {
    e.bossLift = -3 * Math.min(1, (BOSS_METEOR_GATHER_MS + since) / BOSS_METEOR_GATHER_MS);
    return;
  }
  const k = Math.min(1, since / BOSS_METEOR_UP_MS);
  e.bossLift = BOSS_LEAP_SKY_PX * k * k;
  if (e.bossCastMs > 0) return;
  e.gone = true;
  w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "boss_gone" });
  // Driving him off is what the room pays in experience (`KING_AUDIENCE_XP`): paid where he stood.
  payXp(w, KING_AUDIENCE_XP, e.bossFromX, e.bossFromY);
}

function finishBossMove(e: Enemy): void {
  e.bossCast = "none";
  e.bossCastMs = 0;
  e.airborne = false;
  e.bossLift = 0;
}

/** The floor cell nearest a point, in grid coordinates. */
function nearestFloor(w: World, x: number, y: number): [number, number] {
  const tx = Math.max(1, Math.min(GRID_W - 2, Math.floor(x / TILE_PX)));
  const ty = Math.max(1, Math.min(GRID_H - 2, Math.floor(y / TILE_PX)));
  for (let r = 0; r < Math.max(GRID_W, GRID_H); r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const gx = tx + dx;
        const gy = ty + dy;
        if (gx < 1 || gy < 1 || gx >= GRID_W - 1 || gy >= GRID_H - 1) continue;
        if (w.room.grid[gy * GRID_W + gx] === Tile.Floor) return [gx, gy];
      }
  return [tx, ty];
}

/**
 * A death that bursts, delayed (`DeathBurst`). It fired on the frame the body
 * died, from its centre and faster than the lancer's own spikes, so the
 * player who killed it with the sword — the mana source — was hit by eight
 * spikes with no warning at point-blank range. Now the spikes grow out of the
 * body and hang before they fly, as the lancer's attack does, and a little
 * longer, because the player is busy finishing it.
 */
export const DEATH_BURST_MS = { lance: 450, volatile: 520 } as const;
const DEATH_BURST_SPEED = { lance: 140, volatile: 150 } as const;

function deathBurst(w: World, e: Enemy, kind: DeathBurst["kind"]): void {
  // A lancer killed with its spikes already out keeps them out: they do not
  // draw back in to grow again.
  const grown = kind === "lance" && e.spikeMs > 0;
  const reach = kind === "lance" ? e.swing.reach : e.radius + 14;
  w.deathBursts.push({
    x: e.x, y: e.y, body: e, kind, reach,
    totalMs: DEATH_BURST_MS[kind], growShare: grown ? 0 : 0.35, ms: DEATH_BURST_MS[kind],
  });
  w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "death_burst" });
}

function stepDeathBursts(w: World, dtMs: number): void {
  if (w.deathBursts.length === 0) return;
  for (const d of w.deathBursts) {
    d.ms -= dtMs;
    if (d.ms > 0) continue;
    // The body is gone from the room; the volley is fired from where it fell.
    const body = { ...d.body, x: d.x, y: d.y } as Enemy;
    spikeVolley(w, body, DEATH_BURST_SPEED[d.kind], d.kind === "lance" ? SPIKE_SIZE : 1.0, d.reach + 4);
  }
  w.deathBursts = w.deathBursts.filter((d) => d.ms > 0);
}

/**
 * An elemental hit **builds** a status on a body; it does not start one:
 * fire to burning, poison to poisoned, ice to frozen.
 *
 * It used to: one fire bolt set a body burning for three seconds, so an
 * element was a damage-over-time rider on every shot, and the gauge the
 * player lives with was a rule enemies were exempt from. Now it is the same
 * rule both ways — a gauge over the head that hits fill (about three), that
 * drains when the hits stop, and that ignites when full; then the gauge is
 * the status's clock, and hits while it runs top it up and stack its
 * intensity. Ice stays immediate: it is control, not damage over time.
 *
 * How long each status then runs, and what it ticks for, is in `enemy.ts`
 * beside the tick itself (`ENEMY_BURN_MS`, `BURN_DPS`); `statusForecast` in
 * `spells.ts` adds them up for a card.
 */

function applyElement(e: Enemy, b: Bullet): void {
  applyElementsTo(e, b.powers, b.statusMult || 1, b.proc);
}

/**
 * **Every element the thing carried, each into its own gauge.** No reactions:
 * a body hit by a shot that burns and poisons ends up burning and poisoned,
 * and the two run on their own clocks.
 */
function applyElementsTo(e: Enemy, powers: ElementPowers, mult = 1, proc = 1): void {
  // A piece of a multi-hit fills a gauge by its share, not by a whole hit:
  // see `Bullet.proc`.
  for (const el of STATUS_ELEMENTS) {
    const p = powers[el] * proc;
    if (p > 0) applyElementTo(e, el, p, mult, el === "fire" && powers.borrowedFire ? BORROWED_BURN_SOURCES : 4);
  }
}

/** An element's hit on a body, whatever carried it: a shot, a cell of erupting ground. */
/**
 * `mult` is **how hard the build that landed this hit burns**: the spell's
 * level and every damage multiplier on it (`Enemy.statusMult`). A status
 * already running keeps the strongest thing feeding it; a fresh one starts at
 * whatever lit it.
 */
function applyElementTo(e: Enemy, element: string, power: number, mult = 1, burnCap = 4): void {
  /*
   * An immune body takes no status either; a resistant one builds it slower.
   * The king roaring is immune to everything (`hurtEnemy`), and only his
   * damage was refused: the hits still filled his burn, poison and chill, so
   * a roar spent pouring fire into him came out of it with a full burn to
   * spend as soon as it ended.
   */
  if (e.bossRoarMs > 0) return;
  const resist = resistOf(e.archetype, element);
  if (resist === 0) return;
  const add = ENEMY_BUILD_PER_HIT * Math.max(0.5, power || 1) * resist;
  const running = e.burnMs > 0 || e.poisonMs > 0;
  e.statusMult = running ? Math.max(e.statusMult, mult) : mult;
  if (element === "fire") {
    if (e.burnMs > 0) {
      e.burnMs = Math.min(ENEMY_BURN_MS, e.burnMs + ENEMY_BURN_MS * add * 0.6);
      // Up to this hit's own cap, never taking off what a stronger fire already lit.
      if (e.burnSources < burnCap) e.burnSources = Math.min(burnCap, e.burnSources + 1);
      return;
    }
    e.burnBuild = Math.min(1, e.burnBuild + add);
    e.buildFedMs = 600;
    if (e.burnBuild >= 1) { e.burnMs = ENEMY_BURN_MS; e.burnSources = ENEMY_BURN_SOURCES; e.burnBuild = 1; }
  } else if (element === "poison") {
    if (e.poisonMs > 0) {
      e.poisonMs = Math.min(ENEMY_POISON_MS, e.poisonMs + ENEMY_POISON_MS * add * 0.6);
      e.poisonStacks = Math.min(5, e.poisonStacks + 1);
      return;
    }
    e.poisonBuild = Math.min(1, e.poisonBuild + add);
    e.buildFedMs = 600;
    if (e.poisonBuild >= 1) { e.poisonMs = ENEMY_POISON_MS; e.poisonStacks = ENEMY_POISON_STACKS; e.poisonBuild = 1; }
  } else if (element === "ice") {
    // Ice builds too: each hit slows, a full gauge freezes.
    if (e.frozenMs > 0) return;
    e.chillBuild = Math.min(1, e.chillBuild + add);
    e.buildFedMs = 600;
    e.slowMs = 1500;
    /*
     * **The king is not frozen.** Every move he starts, he finishes
     * (`canStagger`), and a freeze cancelled the blade he was winding up: in
     * play, a warning and then no blow. A full gauge slows him hard and long
     * instead, and empties to fill again.
     */
    if (e.chillBuild >= 1 && e.archetype === "boss") {
      e.chillBuild = 0;
      e.slowMs = BOSS_CHILL_SLOW_MS;
      return;
    }
    if (e.chillBuild >= 1) {
      e.frozenMs = ENEMY_FREEZE_MS;
      e.pending = [];
      e.telegraphMs = 0;
      e.attack = "approach";
      e.swing.active = false;
    }
  }
}

/**
 * Projectiles against scenery, from either side.
 *
 * A bullet already stops on a prop, because a prop is a solid tile — this is
 * what makes it *break* it rather than simply die against it. Without that, a
 * spell aimed past a crate is silently eaten, which reads as the spell failing
 * rather than as the crate blocking.
 *
 * **Enemy fire breaks them too**, which turns cover into something that erodes
 * rather than something that is simply there. A crate the player ducks behind
 * is then a decision with a clock on it: it will be gone, and the question is
 * whether they spend it now or later. Cover that is permanent is terrain;
 * cover that wears out is a resource.
 */
/**
 * What one enemy shot takes out of a prop.
 *
 * It used to pass the bullet's own `damage`, which is **1** — and that 1 is a
 * heart, not structural damage. Two different currencies met at one call: the
 * player's sword does 9 on a scale where a crate was 14, while an enemy bullet
 * carries the number of hearts it costs the player. So "enemy fire erodes
 * cover" meant six shots to crack a pot, and the erosion the note below
 * describes was not observable.
 *
 * 2 is a little under a third of a crate, so cover behind which the player
 * hides from a shooter lasts about four hits — long enough to be worth getting
 * behind, short enough to have a clock on it, which is the whole point.
 *
 * **It applies to enemy fire only.** The player's projectiles already carry
 * damage on the sword's scale, and putting them through this conversion made a
 * spell weaker against a pot than the free swing is — which is the wrong way
 * round in a game where the sword is the mana source and spells are what the
 * mana is for. It also *looked* like the spell was broken, because the numbers
 * involved are small: a 3 hp pot took two bolts from a spell that does 8.
 */
const ENEMY_BULLET_PROP_DAMAGE = 2;

/**
 * Scenery in the path of a projectile that stopped.
 *
 * `damage` is the caller's, not the bullet's, because the two pools are on two
 * scales: a player bullet's damage is structural, an enemy bullet's is hearts.
 */
function bulletsBreakProps(
  w: World, stopped: readonly Bullet[], damage: ((b: Bullet) => number),
): void {
  for (const b of stopped)
    for (const p of w.props) {
      if (p.hp <= 0) continue;
      if (!propHit(p, b.x, b.y, b.radius + TILE_PX * 0.5)) continue;
      damageProp(w, p, damage(b));
      break;
    }
}

/**
 * A projectile that dies with `split` set comes apart into fragments.
 *
 * `Bullet.split` is set by `fork` on a hit and by `shatter` on a wall.
 *
 * The fragments are deliberately weak and short-reaching. What splitting buys is
 * **coverage**, not damage: the parent's damage is divided rather than copied,
 * so a fork is a decision to hit more things for less each, which is the trade
 * that makes it a choice against a straight damage upgrade.
 *
 * They also carry `split: 0`. A fragment that forks again is a chain reaction
 * that ends in the bullet cap, and the cap is shared with everything else the
 * player has in the air.
 *
 * **A shard is the spell again, smaller** — the rule `chain`'s copies follow
 * (`affix-hooks.ts`). It keeps the parent's speed, element, slot (which is
 * what it is drawn as), weight and fire, and loses damage and size. The
 * parent is read into a copy first: its slot is dead, so the first shard is
 * handed that very slot, and `acquire` wipes it before it could be read. Every
 * shard came out a plain element-less bolt, drawn as one, whatever split.
 */
const SPLIT_ARC_DEG = 54;
const SPLIT_LIFE = 0.45;
/** How far a shard carries at least: a bolt's shard flies it in `SPLIT_LIFE`, and a slow orb's is given the time to. */
const SPLIT_REACH_PX = 270;
/** A shard's size, and its weight, of the parent's. */
const SPLIT_SIZE = 0.7;

function splitBullets(w: World, dead: readonly Bullet[]): void {
  for (const b of dead) {
    const n = b.split | 0;
    if (n <= 0) continue;
    const parent = { ...b, powers: { ...b.powers }, hitIds: [...b.hitIds] };
    const speed = Math.hypot(parent.vx, parent.vy) || 1;
    const heading = Math.atan2(parent.vy, parent.vx);
    const spread = (SPLIT_ARC_DEG * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const child = acquire(w.playerBullets, false);
      if (!child) break;
      // Fanned evenly about the parent's heading, so the pattern reads as one
      // thing coming apart rather than as a fresh volley.
      const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      const angle = heading + t * spread;
      child.alive = true;
      child.x = parent.x;
      child.y = parent.y;
      // A streak is drawn back along its own path, so it starts where it broke off.
      child.originX = parent.x;
      child.originY = parent.y;
      child.vx = Math.cos(angle) * speed;
      child.vy = Math.sin(angle) * speed;
      child.radius = Math.max(2, parent.radius * SPLIT_SIZE);
      child.damage = Math.max(1, Math.round(parent.damage / n));
      child.lifeMs = 1000 * Math.max(SPLIT_LIFE, SPLIT_REACH_PX / speed);
      child.element = parent.element;
      child.elementPower = parent.elementPower;
      copyPowers(child.powers, parent.powers);
      // A shard is a piece of the shot that made it, and procs like one.
      child.proc = parent.proc * PROC_SPLIT;
      child.statusMult = parent.statusMult;
      child.weight = parent.weight * SPLIT_SIZE;
      child.leavesFire = parent.leavesFire;
      child.split = 0;
      child.pierce = 0;
      child.bounce = 0;
      child.homing = 0;
      // The shards **carry on forward** past whatever the parent hit. Letting
      // them re-hit the same body would make a fork a damage multiplier on
      // one target, which is a different and much duller item than one that
      // turns a single shot into a reason to fight things in a line.
      child.hitIds = [...parent.hitIds];
      // The spell's slot, which is what it is drawn as, but none of its
      // affixes: a `shatter` shard would break again on the next wall and a
      // `bloom` shard lay a field of its own, each one a chain reaction.
      child.affixes = [];
      child.spellIndex = parent.spellIndex;
      child.from = parent.from;
      child.manaSpent = 0;
      child.arcLeft = 0;
    }
    w.events.push({ kind: "shot", x: parent.x, y: parent.y, what: "split" });
  }
}

/**
 * What an affix hook is allowed to do to the world: hurt a body, or cast the
 * spell's own unit at a point. Built per call rather than stored, so it always
 * closes over the live world and never over a room that has been replaced.
 */

/** What a player shot's damage number is coloured by: its element, else its spell's school. */
function damageTag(_w: World, b: Bullet): string {
  // Only the three elements are coloured; lightning is not an element.
  return b.element && b.element !== "none" ? b.element : "";
}

function hookSim(w: World): HookSim {
  return {
    hurt: (e, amount) => {
      hurtEnemy(w, e, amount, "", undefined, amount * PROC_POISE);
      // Counted like every other hit: a mark's detonation or a harvest burst is damage the player dealt.
      w.stats.damageDealt += amount;
      e.hitFlashMs = HIT_FLASH_MS;
    },
    /*
     * A free cast keeps the spell's identity: its slot, affixes, element and
     * level, exactly as a keypress builds them (`freeCastScope`). Fired
     * through an empty scope, a `resonance` or `retort` shot carried
     * `spellIndex: -1` and no element, so it was drawn and sounded as a
     * generic bolt rather than as the spell it came from.
     */
    fire: (spellIndex, origin, target) => {
      const slot = w.spells[spellIndex];
      if (!slot) return;
      fireUnit(w, slot.item, freeCastScope(slot, spellIndex), ITEMS, [], origin, target);
    },
    status: (e, element, power) => applyElementTo(e, element, power, e.statusMult || 1),
    stagger: (e, weight) => spellStagger(w, e, weight),
  };
}

/** Which placed things — orbs, pulls, companions — are alive, by pool index. */
function placedAlive(w: World): { orbs: boolean[]; vortices: boolean[]; pets: boolean[] } {
  return {
    orbs: w.orbs.map((o) => o.alive), vortices: w.vortices.map((v) => v.alive), pets: w.pets.map((p) => p.alive),
  };
}

/**
 * `afterimage`: an orb, a pull or a companion that ran out this step — its
 * clock, not a recast writing over it — is cast once more, free, from where
 * it was at the nearest body in reach. What that cast places is an `echo`,
 * and an echo runs out for good.
 */
function afterimages(w: World, before: ReturnType<typeof placedAlive>): void {
  const ended: { x: number; y: number; spellIndex: number }[] = [];
  const see = <T extends { alive: boolean; lifeMs: number; spellIndex: number; echo?: boolean; x: number; y: number }>(
    xs: readonly T[], was: readonly boolean[],
  ) => xs.forEach((x, i) => {
    if (was[i] && !x.alive && x.lifeMs <= 0 && !x.echo && x.spellIndex >= 0) ended.push({ x: x.x, y: x.y, spellIndex: x.spellIndex });
  });
  see(w.orbs, before.orbs);
  see(w.vortices, before.vortices);
  see(w.pets, before.pets);
  for (const end of ended) {
    const range = afterimageOf(w.spells[end.spellIndex]);
    if (range <= 0) continue;
    const t = nearestWithin(w, end.x, end.y, range);
    if (!t) continue;
    w.castingEcho = true;
    hookSim(w).fire(end.spellIndex, { x: end.x, y: end.y }, t);
    w.castingEcho = false;
    w.events.push({ kind: "spell", x: end.x, y: end.y, what: "afterimage" });
  }
}

/**
 * `slipstream`: dashing through a body casts at it.
 *
 * The dash already passes through bodies, so "through" is an overlap while
 * dash-invulnerable. Counted per dash on the player, so a tier-one affix
 * crossing a crowd fires once and not once per frame per body.
 */
function slipstream(w: World): void {
  const p = w.player;
  if (!dashInvulnerable(p)) return;
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.spawnFadeMs > 0) continue;
    if (!circlesOverlap(p.x, p.y, PLAYER_RADIUS, e.x, e.y, e.radius)) continue;
    if (onDashThrough(w, e, p.slipFired, hookSim(w))) p.slipFired++;
  }
}

/**
 * **A lob coming down** (Mortar): the whole of its damage on every body
 * within its landing reach, each struck as a shot strikes — the hit affixes
 * first, the element, the kill affixes, a shove out from where it fell.
 */
function lobLand(w: World, b: Bullet): void {
  const sim = hookSim(w);
  w.events.push({ kind: "eruption", x: b.x, y: b.y, what: "mortar" });
  impact(w, HITSTOP_HIT, TRAUMA_HIT * 1.4);
  let struck = 0;
  for (const e of w.enemies) {
    if (!isActive(e) || e.hp <= 0) continue;
    const dx = e.x - b.x, dy = e.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d > b.lobRadius + e.radius) continue;
    wake(w, e);
    onHit(w, b, e, sim);
    const { blocked } = hurtEnemy(w, e, b.damage, damageTag(w, b), { x: b.x, y: b.y }, b.damage * poiseOfWeight(b.weight || 1));
    if (!blocked) applyElement(e, b);
    if (e.hp <= 0) onKill(w, b, e, sim);
    w.stats.damageDealt += b.damage;
    e.hitFlashMs = HIT_FLASH_MS;
    const push = (KNOCKBACK * (b.weight || 1)) / Math.max(1, e.radius / 10);
    e.knockX += (dx / (d || 1)) * push;
    e.knockY += (dy / (d || 1)) * push;
    if ((b.weight || 1) >= SPELL_STAGGER_WEIGHT && e.hp > 0) spellStagger(w, e, b.weight);
    w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: e.archetype, amount: b.damage });
    struck++;
  }
  if (struck > 0) w.stats.shotHits++;
}

/**
 * **The beams** (`beam`): a channelled one follows the caster and the aim
 * and ends with its key (`endChannel`) or its time; each ticks on its clock,
 * hurting every body across its line and filling their gauges with what it
 * carries. The line stops at the first wall.
 */
function stepBeams(w: World, dtMs: number): void {
  const p = w.player;
  for (const beam of w.beams) {
    if (!beam.alive) continue;
    beam.lifeMs -= dtMs;
    if (beam.lifeMs <= 0 || (beam.channel && p.channelKey !== beam.spellIndex)) {
      beam.alive = false;
      if (beam.channel && p.channelKey === beam.spellIndex) p.channelKey = -1;
      continue;
    }
    if (beam.channel) {
      /*
       * Held, the bar pays on as it burns, a little every step; dry, it goes out.
       */
      if (beam.drain > 0) {
        p.mana -= beam.drain * (dtMs / 1000);
        if (p.mana <= 0) { p.mana = 0; beam.alive = false; p.channelKey = -1; continue; }
      }
      /*
       * **It follows the bodies, not the four ways.** The facing is snapped
       * to four, and a line held along it missed everything off the axis. So
       * it turns toward the body the aim would seek within its reach — the
       * nearest the facing, in its cone — at a bounded rate, so it is seen
       * swinging onto the body and a body can outrun it; with none, back to
       * the facing.
       */
      const ax = p.aim.x - p.x, ay = p.aim.y - p.y;
      const al = Math.hypot(ax, ay) || 1;
      const mark = seekTargets(w, p.x, p.y, ax / al, ay / al)
        .find((t) => Math.hypot(t.x - p.x, t.y - p.y) <= beam.reach);
      const want = mark ? Math.atan2(mark.y - p.y, mark.x - p.x) : Math.atan2(ay, ax);
      let d = (want - beam.angle) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      const turn = (BEAM_TURN_DEG_PER_S * Math.PI / 180) * (dtMs / 1000);
      beam.angle += Math.sign(d) * Math.min(Math.abs(d), turn);
      beam.x0 = p.x; beam.y0 = p.y;
      beam.x1 = p.x + Math.cos(beam.angle) * beam.reach;
      beam.y1 = p.y + Math.sin(beam.angle) * beam.reach;
    }
    // Stopped by the first wall along it.
    const dx = beam.x1 - beam.x0, dy = beam.y1 - beam.y0;
    const full = Math.hypot(dx, dy) || 1;
    for (let t = 0; t <= full; t += 4) {
      const x = beam.x0 + (dx / full) * t, y = beam.y0 + (dy / full) * t;
      if (t > 8 && circleHitsWall(w.room.grid, x, y, 1)) { beam.x1 = x; beam.y1 = y; break; }
    }
    beam.clockMs -= dtMs;
    if (beam.clockMs > 0) continue;
    beam.clockMs += beam.tickMs;
    const lx = beam.x1 - beam.x0, ly = beam.y1 - beam.y0;
    const l2 = lx * lx + ly * ly || 1;
    for (const e of w.enemies) {
      if (!isActive(e) || e.hp <= 0) continue;
      const t = Math.max(0, Math.min(1, ((e.x - beam.x0) * lx + (e.y - beam.y0) * ly) / l2));
      const d = Math.hypot(e.x - (beam.x0 + lx * t), e.y - (beam.y0 + ly * t));
      if (d > beam.width + e.radius) continue;
      wake(w, e);
      const { blocked } = hurtEnemy(w, e, beam.damage, beam.element !== "none" ? beam.element : "", { x: beam.x0, y: beam.y0 },
        beam.damage * poiseOfWeight(beam.weight));
      if (!blocked) applyElementsTo(e, beam.powers, beam.statusMult, beam.proc);
      w.stats.damageDealt += beam.damage;
      e.hitFlashMs = HIT_FLASH_MS;
    }
  }
}

/**
 * **A spin fires a beam's rays one after another** (`whirl` on a `beam`): not
 * at the bodies, as it casts every other spell, but a flash along the blade
 * as it points at each moment, spaced evenly over the turning, so the rays
 * come out of the spin in turn and the room round the caster is raked.
 */
const beamSpells = (w: World) => w.spells.map((s) => String(ITEMS.get(s?.item.base ?? "")?.params["shape"] ?? "") === "beam");

function queueSpinRays(w: World): void {
  const beams = beamSpells(w);
  w.spells.forEach((slot, i) => {
    if (!slot || !beams[i]) return;
    const n = whirlTargets(slot);
    if (n <= 0) return;
    const turning = SWING_ACTIVE_MS * w.player.swingStretch;
    w.spinRays.push({ spellIndex: i, left: n, clockMs: SWING_WINDUP_MS * w.player.swingStretch, everyMs: turning / n });
  });
}

function stepSpinRays(w: World, dtMs: number): void {
  if (w.spinRays.length === 0) return;
  const p = w.player;
  if (p.swingMs <= 0 || p.swingStretch <= 1) { w.spinRays.length = 0; return; }
  const sim = hookSim(w);
  for (const r of w.spinRays) {
    r.clockMs -= dtMs;
    while (r.clockMs <= 0 && r.left > 0) {
      const a = bladeAngle(w.swing, p);
      sim.fire(r.spellIndex, p, { x: p.x + Math.cos(a) * 100, y: p.y + Math.sin(a) * 100 });
      r.left--;
      r.clockMs += r.everyMs;
    }
  }
  w.spinRays = w.spinRays.filter((r) => r.left > 0);
}

/** How fast a channelled line turns onto the body it follows. */
const BEAM_TURN_DEG_PER_S = 200;

/** How often an orbiting blade may hit the same body: about twice a second. */
const ORBIT_REHIT_MS = 450;

/**
 * How hard a bursting Blade Storm blade turns onto its body, and for how
 * long: a curl out of the ring into it, not a lock that turns it round again
 * once it has passed through.
 */
const BURST_TURN_DEG_PER_S = 900;
const BURST_SEEK_MS = 380;

function stepPlayerBullets(w: World, dtMs: number, items: ItemRegistry): void {
  /*
   * Orbiting shots are placed, not flown: on their circle round the player,
   * with a tangential velocity so a hit still knocks the body the way the
   * blade was moving. The rehit clock clears the hit list so a body that
   * stays in the ring keeps paying.
   */
  // How many of this step's bursting blades have gone for each body, so a burst spreads over the pack.
  const burstAt = new Map<number, number>();
  for (const b of w.playerBullets) {
    if (!b.alive || b.orbitMs <= 0) continue;
    /*
     * A full Blade Storm bursts (`Bullet.burstMs`): the blade leaves its
     * circle outward and curls onto a body within its reach — the one the
     * fewest blades of the burst have gone for, and of those the nearest —
     * so six blades find a lone body and share out a pack, where six straight
     * spokes would pass either side of anything but a crowd. From here it is
     * an ordinary piercing shot until its reach runs out.
     */
    if (b.burstMs > 0) {
      b.burstMs -= dtMs;
      if (b.burstMs <= 0) {
        const reach = b.burstSpeed * b.burstLifeMs / 1000;
        let pick: Enemy | null = null, best = Infinity;
        for (const e of w.enemies) {
          if (!isActive(e) || e.hp <= 0) continue;
          const d = Math.hypot(e.x - b.x, e.y - b.y);
          if (d > reach) continue;
          const score = (burstAt.get(e.id) ?? 0) * 1e4 + d;
          if (score < best) { best = score; pick = e; }
        }
        if (pick) burstAt.set(pick.id, (burstAt.get(pick.id) ?? 0) + 1);
        const ux = Math.cos(b.orbitAngle), uy = Math.sin(b.orbitAngle);
        b.orbitMs = 0;
        b.burstMs = 0;
        b.vx = ux * b.burstSpeed;
        b.vy = uy * b.burstSpeed;
        b.targetId = pick ? pick.id : -1;
        b.seekDegPerS = pick ? BURST_TURN_DEG_PER_S : 0;
        b.seekMs = pick ? BURST_SEEK_MS : 0;
        b.lifeMs = b.burstLifeMs;
        b.damage = b.burstDamage;
        b.originX = b.x;
        b.originY = b.y;
        b.hitIds.length = 0;
        w.events.push({ kind: "shot", x: b.x, y: b.y, what: "blade_burst", facing: b.orbitAngle });
        continue;
      }
    }
    const step = (b.orbitDegPerS * Math.PI / 180) * (dtMs / 1000);
    b.orbitAngle += step;
    // An anchored ring turns round its point on the floor; every other round the caster.
    const cx = b.anchored ? b.orbitX : w.player.x, cy = b.anchored ? b.orbitY : w.player.y;
    b.x = cx + Math.cos(b.orbitAngle) * b.orbitRadius;
    b.y = cy + Math.sin(b.orbitAngle) * b.orbitRadius;
    const tangential = b.orbitRadius * (b.orbitDegPerS * Math.PI / 180);
    b.vx = -Math.sin(b.orbitAngle) * tangential;
    b.vy = Math.cos(b.orbitAngle) * tangential;
    if (b.rehitMs <= 0) { b.hitIds.length = 0; b.rehitMs = ORBIT_REHIT_MS; }
  }

  /*
   * `emit` (doc 006): a shot that throws a shard every `emitMs` of its
   * flight, each turned a step further round than the last, so the orb
   * sprays the ground it crosses rather than one line of it.
   */
  for (const b of w.playerBullets) {
    if (!b.alive || b.emitMs <= 0 || b.orbitMs > 0) continue;
    b.emitClock -= dtMs;
    while (b.emitClock <= 0) {
      b.emitClock += b.emitMs;
      throwShard(w, b, b.emitAngle);
      b.emitAngle += EMIT_TURN;
    }
  }

  // The blades the sword left follow their bodies (`recall.ts`).
  stepLodged(w, dtMs);
  // A spin's beam rays, one at a time along the blade (`stepSpinRays`).
  stepSpinRays(w, dtMs);
  // The thrown blades fly out and home on their own path; see `stepBoomerangs`.
  stepBoomerangs(w, dtMs);
  // An enchant's waves fly forward as arcs, over whatever the room holds; see `stepWaves`.
  const wavesEnded = stepWaves(w, dtMs);

  const nearest = w.enemies.find(isActive) ?? null;
  const { expired, hitWall } = integrate(
    w.playerBullets, w.room.grid, dtMs,
    /*
     * Each shot steers toward the body it was cast at. A shot whose target has
     * died falls back to the nearest live one rather than flying on straight,
     * so a seeking spell that kills its mark mid-flight still behaves like a
     * seeking spell.
     */
    (b) => {
      if (b.targetId >= 0) {
        const t = w.enemies.find((e) => e.id === b.targetId);
        if (t && isActive(t) && t.hp > 0) return t;
      }
      return b.homing > 0 ? nearest : null;
    },
  );

  for (const b of w.playerBullets) {
    // A lob touches nothing in flight: it lands (`lobLand`).
    if (!b.alive || b.delivery === "lob") continue;
    for (const e of w.enemies) {
      if (!isActive(e) || e.hp <= 0) continue;
      if (b.hitIds.includes(e.id)) continue;
      // A wave is an arc, not a disc (`waveHits`).
      if (b.delivery === "wave" ? !waveHits(b, e, dtMs) : !circlesOverlap(b.x, b.y, b.radius, e.x, e.y, e.radius)) continue;

      // Being shot is the loudest way to be noticed. A sleeping enemy that
      // keeps dozing under fire is worse than having no aggro range at all,
      // and this also wakes its neighbours, so a sniped group turns together.
      const unaware = !e.awake;
      wake(w, e);

      /*
       * Where it struck, and the way the hit travels: a shot's at itself,
       * along its flight; a wave's where its arc crosses the body, outward
       * from its centre — the arc crosses a body at its flank as squarely as
       * at its middle.
       */
      const [hx, hy] = b.delivery === "wave" ? [e.x - waveCentre(b).x, e.y - waveCentre(b).y] : [b.vx, b.vy];
      const hl = Math.hypot(hx, hy) || 1;
      const ux = hx / hl, uy = hy / hl;
      const [px, py] = b.delivery === "wave"
        ? [e.x - ux * Math.min(e.radius, hl), e.y - uy * Math.min(e.radius, hl)]
        : [b.x, b.y];

      const immune = e.affixes.includes("shielded") && b.element !== "none";
      if (!immune) {
        // What the spell had attached fires here: an arc to the next body, or
        // a mark. Before the damage, so a detonation sees the body it is on.
        onHit(w, b, e, hookSim(w));
        // From where the shot came, a body-length back along its travel.
        const { blocked } = hurtEnemy(w, e, b.damage, unaware ? "sneak" : damageTag(w, b), { x: px - ux * 24, y: py - uy * 24 },
          b.damage * poiseOfWeight(b.weight || 1));
        // An enchant's wave is the sword's edge thrown, so it fills the rage
        // gauge too — at a fraction of a blow's rate, since it pierces a crowd.
        if (b.delivery === "wave" && !blocked)
          gainRage(w, (e.hp <= 0 ? RAGE_PER_KILL : RAGE_PER_HIT) * WAVE_RAGE_MULT);
        /*
         * `cull`: a hit that leaves the body at or under its share of health
         * fells it — never a boss, a guardian or the king roaring.
         */
        const cull = cullShare(b);
        if (cull > 0 && !blocked && e.hp > 0 && e.hp <= e.maxHp * cull && e.archetype !== "boss" && !e.guardian) {
          w.events.push({ kind: "damage", x: e.x, y: e.y - e.radius, what: "hp:cull", amount: Math.ceil(e.hp) });
          w.stats.damageDealt += e.hp;
          e.hp = 0;
        }
        if (e.hp <= 0) onKill(w, b, e, hookSim(w));
        w.stats.damageDealt += b.damage;
        // A shot that arrived: the numerator of "how often the player hits".
        w.stats.shotHits++;
        applyElement(e, b);
        /*
         * The two bolt options that stay on the body (doc 006). A `doom` hit
         * marks it, unless a mark is already counting down there: a second
         * hit is a hit, not a second payoff. A `contagion` hit that leaves
         * the body poisoned makes it a carrier for as long as the poison runs.
         */
        // Neither lands on the king roaring: a mark put on him then went off once he could be hurt.
        if (b.doomMs > 0 && e.doomMs <= 0 && e.hp > 0 && e.bossRoarMs <= 0) {
          e.doomMs = b.doomMs;
          e.doomDamage = b.doomDamage;
          e.doomRadius = b.doomRadius;
          e.doomSpell = b.spellIndex;
          w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "doom_mark" });
        }
        if (b.contagion > 0 && e.poisonMs > 0 && e.bossRoarMs <= 0) {
          e.contagion = Math.max(e.contagion, b.contagion);
          e.contagionReach = Math.max(e.contagionReach, b.contagionReach);
        }
        e.hitFlashMs = HIT_FLASH_MS;
        // A hit that does not move the target reads as no hit at all.
        const weight = b.weight || 1;
        /*
         * `drag` turns the shove round: toward the caster, and no further
         * than the caster, so a body pulled in lands in sword reach and not
         * behind the player.
         */
        const pull = dragPull(b);
        if (pull > 0) {
          const tx = w.player.x - e.x, ty = w.player.y - e.y;
          const td = Math.hypot(tx, ty) || 1;
          const v = Math.min(pull, Math.max(0, td - e.radius - PLAYER_RADIUS - 6) * DRAG_TRAVEL_INV)
            / Math.max(1, e.radius / 10);
          e.knockX += (tx / td) * v;
          e.knockY += (ty / td) * v;
        } else {
          const push = (KNOCKBACK * weight) / Math.max(1, e.radius / 10);
          e.knockX += ux * push;
          e.knockY += uy * push;
        }
        /*
         * **Mass decides what a hit does to a body**, not only how far it
         * moves it. A light shot — a spark, a pellet, a seeker — pushes and
         * no more; one heavier than the bolt interrupts, as the sword does,
         * for longer the heavier it is: a stone shard or a void orb stops a
         * windup where a fan of sparks cannot.
         */
        if (weight >= SPELL_STAGGER_WEIGHT) spellStagger(w, e, weight);
        // A heavy shot lands like one: a longer freeze, the room shakes, grit.
        if ((b.weight || 1) > 1) {
          impact(w, HITSTOP_HIT * (1 + b.weight), TRAUMA_HIT * 1.8 * b.weight);
          emit(w, px, py, "kill", 6);
          w.events.push({ kind: "hazard_tick", x: px, y: py, what: "heavy_hit" });
        } else impact(w, HITSTOP_HIT, TRAUMA_HIT);
      }
      w.events.push({ kind: "enemy_hit", x: px, y: py, what: e.archetype, amount: b.damage });
      emit(w, px, py, "hit", 4);
      b.hitIds.push(e.id);

      if (b.pierce > 0) b.pierce--;
      else {
        b.alive = false;
        // Dying on a body is dying. Splitting only on expiry would make the
        // fork worthless against exactly what the player aims at.
        splitBullets(w, [b]);
        burstShards(w, b);
        break;
      }
    }
  }

  /*
   * A wave breaks what it crosses, as the swing it came from does — a pot
   * or a crate under the arc — and flies on over it: each prop once, on the
   * wave's own list, below the bodies' ids.
   */
  for (const b of w.playerBullets) {
    if (!b.alive || b.delivery !== "wave") continue;
    for (let i = 0; i < w.props.length; i++) {
      const prop = w.props[i]!;
      const id = PROP_HIT_ID_BASE - i;
      if (prop.hp <= 0 || b.hitIds.includes(id) || !waveHits(b, prop, dtMs)) continue;
      b.hitIds.push(id);
      damageProp(w, prop, b.damage);
    }
  }

  // The player's own projectiles break scenery too. This was written and only
  // wired to the enemy pool, so a spell aimed at a crate was absorbed by it
  // and nothing happened — which reads as the spell being broken.
  for (const b of expired) if (b.delivery === "lob") lobLand(w, b);
  bulletsBreakProps(w, [...expired, ...hitWall], (b) => b.damage);

  // `bloom` leaves a field where a shot ran out; `shatter` breaks it on a wall.
  // The split itself already exists and only needs the count.
  // "Where the shot runs out" is anywhere it ended without finding a body: a
  // shot that stops on a wall has run out just as surely as one that timed
  // out, and at this room size nearly every miss ends on a wall.
  for (const b of [...expired, ...wavesEnded]) onExpire(w, b);
  for (const b of hitWall) { onExpire(w, b); b.split = Math.max(b.split, wallSplitCount(b)); }
  // An `emit` shot bursts into its ring wherever it ends: out of time, or on a wall.
  for (const b of [...expired, ...hitWall]) burstShards(w, b);
  for (const b of hitWall)
    w.events.push({ kind: "bullet_wall", x: b.x, y: b.y, what: `player:${b.element}`, facing: Math.atan2(b.vy, b.vx) });
  splitBullets(w, [...expired, ...hitWall]);
}

/**
 * An `emit` shard: a small, short, fast projectile of the spell's own
 * element, thrown off the shot that carries the option. **It carries the
 * element and none of the affixes**: the orb is the spell and carries what
 * the key attached, and a fork or a chain on every shard of it would turn one
 * affix into twenty. Worth little to an on-hit effect (`PROC_EMIT`), so a
 * spray of shards cannot fill a gauge faster than the hit that threw them.
 */
const EMIT_SPEED = 360;
const EMIT_LIFE_MS = 420;
const EMIT_RADIUS = 3;
/** How far round the next shard is thrown from the last, in radians: an odd step, so the spray does not settle into spokes. */
const EMIT_TURN = (137.5 * Math.PI) / 180;
/** A shard's proc weight, of the shot that threw it; see `procWeight`. */
const PROC_EMIT = 0.25;

function throwShard(w: World, from: Bullet, angle: number): void {
  const b = acquire(w.playerBullets, false);
  if (!b) return;
  b.alive = true;
  b.x = from.x;
  b.y = from.y;
  b.originX = from.x;
  b.originY = from.y;
  b.vx = Math.cos(angle) * EMIT_SPEED;
  b.vy = Math.sin(angle) * EMIT_SPEED;
  b.radius = EMIT_RADIUS;
  b.damage = from.emitDamage;
  b.lifeMs = EMIT_LIFE_MS;
  b.element = from.element;
  b.elementPower = from.elementPower;
  copyPowers(b.powers, from.powers);
  b.proc = Math.max(PROC_MIN, from.proc * PROC_EMIT);
  b.statusMult = from.statusMult;
  b.spellIndex = from.spellIndex;
  b.weight = 0.4;
  w.stats.shotsFired++;
}

/** The ring an `emit` shot bursts into as it ends, once; see `throwShard`. */
function burstShards(w: World, b: Bullet): void {
  if (b.emitRing <= 0) return;
  const n = b.emitRing;
  b.emitRing = 0;
  for (let i = 0; i < n; i++) throwShard(w, b, b.emitAngle + (i / n) * Math.PI * 2);
  w.events.push({ kind: "shot", x: b.x, y: b.y, what: "emit_burst" });
}

function stepEnemyBullets(w: World, dtMs: number): void {
  const enemyDead = integrate(w.enemyBullets, w.room.grid, dtMs, null);

  // A `ward` rune stops a projectile that crosses it, spending one of its
  // shots. Checked before the player overlap, since the rune is where the
  // player *was* and the point of it is to cover ground they have left.
  for (const b of w.enemyBullets) {
    if (!b.alive) continue;
    if (wardStops(w, b)) b.alive = false;
  }
  /*
   * `intercept`: an enemy shot that meets one of the player's shots, blades
   * or waves carrying it is put out, and the player's flies on.
   */
  const guards = w.playerBullets.filter((b) => b.alive && b.affixes.length > 0 && intercepts(b));
  if (guards.length > 0)
    for (const b of w.enemyBullets) {
      if (!b.alive) continue;
      const g = guards.find((x) => circlesOverlap(x.x, x.y, x.radius + 2, b.x, b.y, b.radius));
      if (!g) continue;
      b.alive = false;
      w.events.push({ kind: "shot", x: b.x, y: b.y, what: "intercept" });
    }
  // A thrown flame is an ordinary bullet whose ending differs: where it stops,
  // it burns. Reusing the bullet path means the throw arcs, collides and is
  // capped like everything else, and only the last frame is new.
  for (const b of [...enemyDead.expired, ...enemyDead.hitWall])
    if (b.leavesFire) lightFire(w, b.x, b.y);
  // Where a shot meets stone, for the spark it leaves (a blunderbuss spray
  // against a wall is most of what a player sees of it missing).
  for (const b of enemyDead.hitWall)
    w.events.push({ kind: "bullet_wall", x: b.x, y: b.y, what: b.from, facing: Math.atan2(b.vy, b.vx) });
  for (const b of enemyDead.expired) w.events.push({ kind: "bullet_spent", x: b.x, y: b.y, what: b.from });
  bulletsBreakProps(
    w, [...enemyDead.expired, ...enemyDead.hitWall], () => ENEMY_BULLET_PROP_DAMAGE,
  );
  const p = w.player;
  for (const b of w.enemyBullets) {
    if (!b.alive) continue;
    if (circlesOverlap(b.x, b.y, b.radius, p.x, p.y, PLAYER_RADIUS)) {
      /*
       * A dash **phases through** a projectile: it is not consumed.
       *
       * The invulnerability already meant no damage, but the bullet died on
       * contact anyway — so dashing into a volley deleted it. That is a free
       * clear rather than a dodge, and it quietly made the dash the answer to
       * bullets instead of *an* answer: there was no reason to move around
       * anything when going through it removed it.
       *
       * Passing through keeps the cost where it belongs. The player is safe
       * for the dash and the bullet is still there behind them, so the dodge
       * bought them a moment and a position, not the removal of the threat.
       */
      if (dashInvulnerable(p)) continue;
      b.alive = false;
      // A thrown flame burns where it stops, and stopping on the player is
      // still stopping. Skipping it here made a direct hit the *weakest*
      // outcome, which is backwards: the throw is aimed at the player, so the
      // case it was aimed at would have been the one with no fire in it.
      if (b.leavesFire) lightFire(w, b.x, b.y);
      // A burning shot feeds the fire gauge on top of the hit it lands.
      if (b.element === "fire") feedBurn(w, 0.5);
      hurtPlayer(w, b.x, b.y, `bullet:${b.from || "unknown"}`, 0, BULLET_HEARTS[b.from] ?? 1);
    } else if (circlesOverlap(b.x, b.y, b.radius, p.x, p.y, NEAR_MISS_RADIUS)) {
      w.stats.nearMisses++;
    }
  }
}

/**
 * Moves the drops and applies whatever the player walked over.
 *
 * A heart is capped at the player's maximum rather than refused, so taking one
 * at full health is wasted rather than blocked — refusing it would leave the
 * drop lying there as a reminder, which is worse than losing it.
 */
function collectPickups(w: World, dtMs: number): void {
  const taken = stepPickups(
    w.pickups, dtMs, w.player,
    (x, y, r) => circleHitsWall(w.room.grid, x, y, r),
    w.cleared,
    // A reserve waits while the hearts that fill the bar are still on their way (doc 022).
    w.player.hearts >= MAX_HEARTS + w.player.mods.maxHearts || w.pickups.some((q) => q.alive && q.homing),
  );
  for (const p of taken) {
    if (p.kind === "heart") {
      /*
       * A heart heals one; an **elite's** heart heals a share of the whole
       * bar, which `value` carries (see `ELITE_HEAL_FRACTION`). The health a
       * body is worth should scale with the health the player has, the way
       * the fountain's does.
       */
      const heal = p.value > 0 ? p.value : 1;
      w.player.hearts = Math.min(MAX_HEARTS + w.player.mods.maxHearts, w.player.hearts + heal);
      emit(w, p.x, p.y, "heal", 5);
    } else if (p.kind === "mana") {
      w.player.mana = Math.min(w.staff.mana_max, w.player.mana + MANA_ORB);
      emit(w, p.x, p.y, "pickup", 2);
    } else {
      w.gold += p.value;
      emit(w, p.x, p.y, "pickup", 4);
    }
    w.events.push({ kind: "pickup", x: p.x, y: p.y, what: p.kind });
  }
}

/**
 * What a body leaves behind.
 *
 * Coins from most things and a heart occasionally, weighted so health is a
 * relief rather than an income: the design's tension is that hearts do not
 * come back, and a steady trickle of them would dissolve it. One kill in
 * seven, and only when the player is actually hurt — a heart dropped at full
 * health is a reward the player watches expire.
 */
/**
 * What breaking scenery pays: **gold, usually, in a small random handful**.
 *
 * A pot in three scatters a coin or two: enough that a breakable is worth
 * the swing, not so much that scenery out-pays the fight. At four in five
 * and up to three coins, a player who broke everything took about thirty
 * gold a room from pots alone, twice what the fight paid, and ended a run
 * with twice the gold anything sold for. Hearts do not come from scenery; a
 * heart is something a fight pays.
 */
const PROP_COIN_CHANCE = 0.35;

function dropPropLoot(w: World, x: number, y: number): void {
  if (w.rng.next() >= PROP_COIN_CHANCE) return;
  const coins = 1 + Math.floor(w.rng.next() * 2);
  for (let i = 0; i < coins; i++) drop(w.pickups, "coin", x, y, w.rng);
}

/**
 * **Every kill pays** — beyond the chance of a coin or a heart, which was
 * nearly all a kill was worth, and a kill that pays nothing is a toll.
 *
 * - **No mana on the floor.** The sword is what refills the pool (doc 013);
 *   orbs dropped by bodies were one more thing to walk over and collect for
 *   a resource the fight already pays in.
 * - **A coin** from an elite, always: the harder body is the one worth
 *   going for.
 * - **A streak**: a third sword kill inside two seconds of the last one, and
 *   every one after it, banks extra rage — so clearing a pack fast with the
 *   blade is how the spin comes round. Only the sword's kills count: rage is
 *   the sword's gauge (doc 013), and a scatter shot that dropped three bodies
 *   at once filled it without a swing.
 */
function killPays(w: World, e: Enemy): void {
  if (e.archetype === "boss") return;
  const elite = e.affixes.length > 0;
  if (elite) drop(w.pickups, "coin", e.x, e.y, w.rng);
  if (!w.swordBlow) return;
  w.streak = w.streakMs > 0 ? w.streak + 1 : 1;
  w.streakMs = STREAK_MS;
  if (w.streak >= 3) {
    gainRage(w, STREAK_RAGE);
    w.events.push({ kind: "pickup", x: e.x, y: e.y, what: "streak", amount: w.streak });
  }
}

/**
 * **A quiet room comes to the player.**
 *
 * Two silences, and the second is the one the stations introduced. When
 * everything awake is dead and the bodies left have not noticed the player,
 * they notice the silence: after a few seconds the one nearest the player
 * wakes, and its alarm spreads. And when a fight is going on somewhere but
 * **nothing awake is in the player's view**, the same thing happens sooner —
 * because a roster spread over a hall means the player can otherwise spend a
 * third of a room walking between fights, which measured worse than the knot
 * by the door it replaced.
 *
 * Waking the nearest body rather than moving one is what keeps the room a set
 * of fights whose order the player chooses (doc 005): it is the room noticing
 * them, at the pace the alarm ripple already reads at.
 */
function stepQuiet(w: World, dtMs: number): void {
  const live = w.enemies.filter((e) => e.hp > 0 && e.spawnFadeMs <= 0);
  const p = w.player;
  const unaware = live.filter((e) => !e.awake);
  // Only once the fight has started: a room nobody has touched is not quiet, it is waiting.
  if (unaware.length === 0 || w.stats.damageDealt <= 0) { w.quietMs = 0; return; }
  const awakeInView = live.some((e) => e.awake
    && Math.abs(e.x - p.x) <= w.viewHalf.x + e.radius && Math.abs(e.y - p.y) <= w.viewHalf.y + e.radius);
  const anythingAwake = live.some((e) => e.awake);
  /*
   * A group down to its last body counts as quiet even while that body is on
   * screen: it is about to be gone, and the point is to have called the next
   * station by then.
   */
  const nearlyDone = live.filter((e) => e.awake).length <= LAST_BODY;
  if ((awakeInView && !nearlyDone)
    || (anythingAwake && w.pendingWaves.length > 0 && w.stats.elapsedMs - w.lastWaveMs < WAVE_MIN_GAP_MS)) {
    w.quietMs = 0;
    return;
  }
  /*
   * **The next station is called while the last one is still dying**, not
   * after the screen has already gone quiet. Waiting for the gap and then
   * waking somebody means the player always sees the gap; waking on the last
   * body of the group in front of them means the next fight is on its way
   * before they have finished the one they are in.
   */
  const awakeLeft = live.filter((e) => e.awake).length;
  w.quietMs += dtMs;
  const wait = !anythingAwake ? QUIET_WAKE_MS : awakeLeft <= LAST_BODY ? NEXT_STATION_MS : UNSEEN_WAKE_MS;
  if (w.quietMs < wait) return;
  w.quietMs = 0;
  const nearest = unaware.reduce((a, b) => (Math.hypot(a.x - p.x, a.y - p.y) <= Math.hypot(b.x - p.x, b.y - p.y) ? a : b));
  wake(w, nearest);
}

const QUIET_WAKE_MS = 4000;
/** With a fight going on but nothing of it in view, the room joins in sooner. */
const UNSEEN_WAKE_MS = 1600;
/**
 * A group is "down to its last" at this many awake bodies, and the next
 * station is called this long after it gets there — long enough that the
 * player is finishing the body in front of them rather than being interrupted
 * by the next fight arriving on top of it.
 */
const LAST_BODY = 1;
const NEXT_STATION_MS = 1300;

/** Kills this close together count as one streak. */
const STREAK_MS = 2000;
const STREAK_RAGE = 0.25;

/** What an elite kill heals, as a share of the whole bar (doc 005). */
export const ELITE_HEAL_FRACTION = 0.1;

/**
 * **What a kill pays in experience, and the level it may reach** (doc 003,
 * "Experience and levels"; `run/levels.ts`).
 *
 * In the simulation rather than in either caller, which is the whole point:
 * the scene and the balance harness both get the levels by running the game,
 * so a run measured headless and a run played in a browser grow the same body
 * at the same moments. Neither of them can hold a different table.
 *
 * A level raises the modifiers and hands back **the health it just added**.
 * Not a full heal — that would make levelling the way out of a bad room and
 * turn every summoner into a rest stop — and not nothing, because a maximum
 * that grows while the bar does not is a widening gap the player reads as
 * losing health.
 */
function gainXp(w: World, e: Enemy): void {
  payXp(w, xpForKill(e.archetype, { elite: e.affixes.length > 0, summoned: e.summoned }), e.x, e.y);
}

/** Experience paid from a point, and the levels it reaches. */
export function payXp(w: World, points: number, x: number, y: number): void {
  if (points <= 0) return;
  w.xp += points;
  w.events.push({ kind: "xp", x, y, amount: points });
  const now = levelAt(w.xp);
  while (w.level < now.level) {
    w.level++;
    w.player.mods = withLevels(w.baseMods, w.level);
    w.player.hearts = Math.min(MAX_HEARTS + w.player.mods.maxHearts, w.player.hearts + LEVEL_HEARTS);
    w.staff = { ...w.staff, mana_max: Math.round(w.staffManaBase * w.player.mods.manaMax) };
    w.events.push({ kind: "level_up", x: w.player.x, y: w.player.y, amount: w.level });
  }
}

function dropLoot(w: World, x: number, y: number, weight: number): void {
  const roll = w.rng.next();
  /*
   * A heart only when the player has somewhere to put it.
   *
   * Not merely because a wasted drop is wasted: a heart on the floor is a
   * promise, and one the player cannot take teaches them to ignore the next.
   */
  if (w.player.hearts < MAX_HEARTS + w.player.mods.maxHearts && roll < HEART_CHANCE * weight) {
    drop(w.pickups, "heart", x, y, w.rng).value = 0;
    return;
  }
  if (roll < HEART_CHANCE * weight + COIN_CHANCE * weight * w.coinBoost)
    drop(w.pickups, "coin", x, y, w.rng);
}

/**
 * How often a kill pays, per unit of threat weight.
 *
 * Both cut hard from the first guess — 14% and 55% — because at those rates
 * the floor after a fight was littered, and a reward that arrives from
 * everything is not a reward, it is a resource tick with a sprite on it. A
 * coin from about one body in four and a heart from one in twenty means
 * finding either is a thing that happened.
 *
 * Hearts stay rare on purpose. The design's central tension is that health
 * does not come back within a run, and a steady trickle of it dissolves that
 * more quietly than any other number here.
 */
/**
 * How many coins a gold room scatters.
 *
 * Times `COIN_VALUE`, this is what the room is worth. Paid as a handful
 * rather than one lump so the pickup magnet has something to do and the
 * payout reads as a payout.
 */
const GOLD_ROOM_COINS = 8;

/**
 * The most the early economy may raise a kill's coin chance (`coinBoost`).
 *
 * Doubling it takes a room of twelve bodies from about ten gold to about
 * twenty, which is a vendor stop's difference over four rooms and not a second
 * income. A cap rather than a free parameter, because the floor after a fight
 * being littered with coins is the failure this number has already had once.
 */
export const COIN_BOOST_MAX = 2;

const HEART_CHANCE = 0.05;
/** A coin from about one body in four: a room of twelve pays ten to fifteen, doc 003's band. */
const COIN_CHANCE = 0.22;

/**
 * Scenery can block a body. It must never trap one.
 *
 * Two cases, and the second exists because of a report: a tank stood pressed
 * against a pot indefinitely. A destructible is a solid cell, so a body with
 * line of sight walks straight into one and grinds — and the jam fallback that
 * switches to the flow field never fired, because a body holding its waiting
 * ring *is* moving, so `blockedMs` was reset every frame. A pot could hold an
 * enemy still for the rest of the room.
 *
 * **A charge clears its lane ahead of itself.** Run before the enemies move,
 * which is the whole trick: a crate in a tank's path would otherwise stop the
 * charge dead, and because a blocked charge stuns itself on impact, a barrel
 * was doing the job a wall is supposed to do. Clearing the cell first means
 * the ram goes through the scenery and only real masonry knocks it down. It is
 * also the obvious reading — a thing that size does not stop for a barrel, and
 * a player steering the charge gets the debris as a receipt.
 *
 * **Anything else shoulders its way through.** A body touching a prop chips
 * it, so a pot in the way costs a moment rather than the fight. The damage is
 * per second rather than per frame so that shoving scenery aside is visibly
 * work, and heavier bodies do it faster because the rate scales with their
 * radius.
 */
/** The throne hall's columns: worn by blows only, never by a dash or a body leaning on them. */
function hallProp(p: Destructible): boolean {
  return p.kind === "column";
}
/**
 * The throne hall's candelabra: tall iron on a narrow foot, knocked over by
 * anything that walks into them — the player, a dash, a body, the king
 * crossing his hall — as well as broken by a blow.
 */
function toppled(p: Destructible): boolean {
  return p.kind === "candelabrum";
}

function smashProps(w: World, dtMs: number): void {
  /*
   * The player's dodge breaks what it goes through. It already passes through
   * bodies; a pot it had to stop for was the one thing in the room a dodge
   * respected, and a movement verb that is also a way to clear scenery gives
   * the room's clutter a second use.
   */
  const pl = w.player;
  for (const p of w.props)
    if (p.hp > 0 && toppled(p) && propHit(p, pl.x, pl.y, PLAYER_RADIUS + 2)) damageProp(w, p, p.hp);
  if (pl.dashMs > 0) {
    const ahead = PLAYER_RADIUS + CHARGE_SMASH_LOOKAHEAD;
    for (const p of w.props) {
      // Not the throne hall's columns: only a blow breaks those (`HallKind`).
      if (p.hp <= 0 || hallProp(p)) continue;
      if (propHit(p, pl.x + pl.dashX * ahead, pl.y + pl.dashY * ahead, PLAYER_RADIUS)
        || propHit(p, pl.x, pl.y, PLAYER_RADIUS)) damageProp(w, p, p.hp);
    }
  }
  for (const e of w.enemies) {
    if (e.hp <= 0 || !isActive(e)) continue;
    const charging = e.attack === "lunge" && (e.meleeKind ?? ENEMIES[e.archetype].melee) === "charge";

    for (const p of w.props) {
      if (p.hp <= 0 || hallProp(p)) continue;
      // Walked into, it goes over.
      if (toppled(p)) {
        if (propHit(p, e.x, e.y, e.radius + 2)) damageProp(w, p, p.hp);
        continue;
      }
      if (charging) {
        // A little ahead of itself, so the cell is already floor by the time
        // the body arrives rather than on the frame it would have hit it.
        const ahead = e.radius + CHARGE_SMASH_LOOKAHEAD;
        const nx = e.x + e.lungeX * ahead;
        const ny = e.y + e.lungeY * ahead;
        if (!propHit(p, nx, ny, e.radius) && !propHit(p, e.x, e.y, e.radius)) continue;
        // Destroyed outright: a ram does not chip a pot.
        damageProp(w, p, p.hp);
        continue;
      }
      // Pressed against it: shoulder it aside over a moment.
      if (!propHit(p, e.x, e.y, e.radius + 2)) continue;
      damageProp(w, p, (PROP_SHOVE_DPS * (e.radius / 10) * dtMs) / 1000);
    }
  }
}

/** How fast a body shoves scenery aside, per second, for a 10 px body. */
const PROP_SHOVE_DPS = 9;

/** How far in front of itself a charge clears the way, in px. */
const CHARGE_SMASH_LOOKAHEAD = 14;

/**
 * Bodies do not overlap.
 *
 * The enemies had a separation *force* and nothing else, so two of them could
 * sit inside each other if both were pushing the same way, and the player
 * could walk straight through all of them. That is most of why a fight read as
 * standing in a heap: if position cannot be contested then there is no
 * positioning, only distance.
 *
 * Resolved after everybody has moved rather than during, so the order bodies
 * are stepped in does not decide who wins a shove. Two passes, because pushing
 * one pair apart can push a body into a third — two is enough at these radii
 * and is cheap, where solving it properly would be a physics engine.
 *
 * **The dash passes through.** It is the safety valve, and without one hard
 * bodies are a trap: a player pressed into a corner by three chasers would
 * have no legal move at all. Hades makes its dash pass through enemies for
 * exactly this reason, and it is also what makes the dash worth its cooldown
 * in a crowd rather than only against a projectile.
 */
function resolveBodies(w: World): void {
  const live = w.enemies.filter((e) => isActive(e) && e.hp > 0);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i]!;
        const b = live[j]!;
        push(w, a, b);
      }
    const p = w.player;
    if (p.dashMs > 0) continue;
    for (const e of live) {
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const min = e.radius + PLAYER_RADIUS;
      const d = Math.hypot(dx, dy);
      if (d >= min || d < 0.0001) continue;
      /*
       * A committed charge shoves the player; anything else gives way to them.
       *
       * The player being the one displaced by default is what keeps movement
       * feeling like theirs — being nudged by a body you walked into reads as
       * your own momentum. A charging tank is the exception because the whole
       * point of a ram is that it does not stop for you.
       */
      // A charge, a body bolted to the floor, and the king all hold their ground.
      const charging = (e.attack === "lunge" && e.maxPoise > 0) || anchored(e) || e.archetype === "boss";
      const overlap = min - d;
      const nx = dx / d;
      const ny = dy / d;
      if (charging) {
        moveSliding(w.room.grid, p, nx * overlap, ny * overlap, PLAYER_RADIUS);
      } else {
        moveSliding(w.room.grid, p, nx * overlap * 0.7, ny * overlap * 0.7, PLAYER_RADIUS);
        moveSliding(w.room.grid, e, -nx * overlap * 0.3, -ny * overlap * 0.3, e.radius);
      }
    }
  }
}

/**
 * Pushes two overlapping bodies apart, the heavier one moving less.
 *
 * Share of the correction goes by **mass, taken as radius squared**, not by
 * radius. Linear in radius, a 16 px tank still gave up nearly two fifths of
 * the shove to a 10 px rusher — so the heaviest thing in the roster was
 * visibly barged around by the lightest, which is the opposite of what its
 * whole design says. Squared, the same pair splits 28/72, and mass being an
 * area rather than a length is also just the right model for a disc.
 *
 * And a body mid-charge does not move at all. The ram's premise is that it
 * does not stop for anything, so being deflected off its line by a minion
 * would break the one property the player is being asked to read: where it is
 * going. It plows, and everything else gets out of the way.
 */
function push(w: World, a: Enemy, b: Enemy): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const min = a.radius + b.radius;
  const d = Math.hypot(dx, dy);
  if (d >= min) return;
  // Coincident bodies get an arbitrary but deterministic axis, or they stay
  // stuck inside each other forever.
  const nx = d < 0.0001 ? 1 : dx / d;
  const ny = d < 0.0001 ? 0 : dy / d;
  const overlap = min - Math.max(d, 0.0001);
  // A ram plows; an emplacement is bolted down; the king is moved by nothing. Either way the other body gives.
  const fixedA = plowing(a) || anchored(a) || a.archetype === "boss";
  const fixedB = plowing(b) || anchored(b) || b.archetype === "boss";
  if (fixedA && fixedB) return;
  const ma = a.radius * a.radius;
  const mb = b.radius * b.radius;
  const shareA = fixedA ? 0 : fixedB ? 1 : mb / (ma + mb);
  const shareB = fixedB ? 0 : fixedA ? 1 : ma / (ma + mb);
  if (shareA > 0)
    moveSliding(w.room.grid, a, -nx * overlap * shareA, -ny * overlap * shareA, a.radius);
  if (shareB > 0)
    moveSliding(w.room.grid, b, nx * overlap * shareB, ny * overlap * shareB, b.radius);

  // Two bodies wandering into each other turn around rather than grind.
  turnBackFromBump(w, a, -nx, -ny);
  turnBackFromBump(w, b, nx, ny);
}

/**
 * An unaware body that bumps into something turns away and **keeps walking**.
 *
 * Without the turn, two patrols walking into each other press on toward
 * targets that lie through one another: the overlap resolves every frame and
 * neither ever arrives, so they grind shoulder to shoulder indefinitely.
 *
 * The first version also paused for a beat, to make the turn visible, and that
 * was a deadlock: the pause stops the body moving, so the overlap is still
 * there next frame, so the bump fires again and renews the pause. **Two bodies
 * that touched froze against each other permanently.** A creature that has
 * bumped into something reconsiders while moving; the hesitation was
 * decoration and it cost the thing it was decorating.
 *
 * The new destination is well clear of the other body, so one turn separates
 * them rather than leaving them to bump their way apart.
 */
function turnBackFromBump(w: World, e: Enemy, nx: number, ny: number): void {
  if (e.awake) return;
  const away = Math.atan2(ny, nx) + (w.rng.next() - 0.5) * 0.8;
  const reach = 56 + w.rng.next() * 40;
  e.wanderX = e.x + Math.cos(away) * reach;
  e.wanderY = e.y + Math.sin(away) * reach;
  // Cancels any pause it was sitting in, so the turn takes effect now.
  e.wanderPauseMs = 0;
}

/** A committed charge is immovable: it does not stop for anything. */
function plowing(e: Enemy): boolean {
  return e.attack === "lunge" && (e.meleeKind ?? ENEMIES[e.archetype].melee) === "charge";
}

/**
 * Enemy blades against the player.
 *
 * **This replaces contact damage entirely.** Touching a body is now free; the
 * only way an enemy hurts the player in melee is with an attack it telegraphed.
 *
 * That was the largest single balance problem the melee turn produced, and it
 * was structural rather than a number. Measured over twelve reference runs,
 * body contact was 53% of all hearts lost — more than bullets and ground
 * hazards combined — and the reason is that a melee player has to be adjacent
 * to do anything at all. Charging for adjacency taxes the one thing the design
 * requires. Narrowing it to the lunge did not fix it either: `contact:tank`
 * alone was still a third of all damage, because a body that is on top of you
 * hits you whichever way either of you is facing.
 *
 * A hitbox fixes what narrowing could not, because it has the two properties a
 * collision cannot have: **a facing**, so stepping aside or getting behind the
 * enemy works, and **a window**, so the recovery is the player's turn. Doc 013
 * said contact damage "is not an attack, it is a collision", and the
 * windup-lunge-recover cycle was built to turn it into an attack; only half of
 * that shipped — the cycle arrived and the collision stayed.
 *
 * Ranged archetypes have no blade at all. Walking into a turret is harmless,
 * which is correct: its attack is the ring it fires, and being on top of it is
 * the safest place in the room rather than a second cost.
 */
function resolveEnemySwings(w: World): void {
  const p = w.player;
  for (const e of w.enemies) {
    if (!isActive(e) || e.hp <= 0) continue;
    const box = e.swing;
    if (!box.active) continue;
    const spec = meleeSpec(e);
    const ram = spec !== null && spec.commitSpeed >= 3 && e.attack === "lunge";
    const dashcut = e.archetype === "boss" && e.meleeKind === "dashcut" && e.attack === "lunge";
    // Enemy movement is resolved after the attack clock. Keep a live lunge's
    // hitbox on the body's final position for this step, rather than one frame
    // behind at the windup origin (especially important for a long ram).
    if (e.attack === "lunge") {
      box.x = e.x;
      box.y = e.y;
    }
    // The king's sword breaks what it passes through (`BOSS_PROP_DAMAGE`), once a swing each;
    // the Frontier Veteran's sweep and bash smash it outright (`veteranBreaksProps`).
    if (e.archetype === "boss") bossStrikesProps(w, (q) => sectorHits(box, q, q.radius), box.hitIds);
    else if (e.guardian) smashPropsWhere(w, (q) => sectorHits(box, q, q.radius));
    // Dedup per swing, the same way the player's own arc does: one attack is
    // one hit however many frames the player spends inside it.
    if (box.hitIds.includes(PLAYER_HIT_ID)) continue;
    // A committed charge is a body collision, not a directional sword arc:
    // catching the player from the side or back must still stop the charge.
    const chargeContact = (ram || dashcut) && circlesOverlap(e.x, e.y, e.radius, p.x, p.y, PLAYER_RADIUS);
    if (!chargeContact && !sectorHits(box, p, PLAYER_RADIUS)) continue;
    box.hitIds.push(PLAYER_HIT_ID);
    // A deliberately zero-damage blade still connects and is marked once, so
    // it cannot retrigger every frame. Normal melee specs are all live.
    if (box.damage <= 0) {
      w.events.push({ kind: "player_hit", x: e.x, y: e.y, what: `graze:${e.archetype}`, amount: 0 });
      if (dashcut) dashcutImpact(w, e);
      continue;
    }
    /* Ordinary blades do not stun. A committed charge is the exception: the
     * impact stops the heavy body and briefly takes control of the player so
     * the hit reads as a collision, without launching them across the room. */
    /*
     * A ram shoves along **its own line of travel**, not away from the body's
     * centre: a player caught at the edge of the front went sideways, which
     * is not what being hit by a moving mass does to you.
     */
    if (ram || dashcut) hurtPlayer(w, p.x - e.lungeX, p.y - e.lungeY, `melee:${e.archetype}`, RAM_HIT_STUN_MS, box.damage);
    else hurtPlayer(w, e.x, e.y, `melee:${e.archetype}`, 0, box.damage);

    if (dashcut) dashcutImpact(w, e);
    // The charge must stop on contact even through player invulnerability or
    // stance guard; the collision itself ends the committed movement.
    else if (ram && spec) ramImpact(w, e, spec);
  }
}

/**
 * **The king's dashcut stops on the player it catches** and puts them a
 * step down its line (the throw decays, so 44 px of it carries about 25) — inside the reach of the blow his string lays after it
 * (`BossPhase.strings`), which is the point of the throw being short. It ran
 * on through them to the far wall, as the tank's ram used to, so the blow
 * behind it cut at a player three tiles away. The run is spent, he plants
 * with a short slide, and the next blow of the string winds up from there.
 */
const BOSS_DASH_THROW_PX = 44;
const BOSS_DASH_THROW_MS = 160;
function dashcutImpact(w: World, e: Enemy): void {
  const p = w.player;
  const throwSpeed = BOSS_DASH_THROW_PX / (BOSS_DASH_THROW_MS / 1000);
  p.hurtX = e.lungeX * throwSpeed;
  p.hurtY = e.lungeY * throwSpeed;
  p.hurtMs = BOSS_DASH_THROW_MS;
  e.dashLeftPx = 0;
  e.attack = "recover";
  // Into the string's next blow at once, or the dashcut's own recovery when it was the whole turn.
  e.attackMs = e.bossString.length > 0 ? BOSS_LINK_RECOVER_MS : (meleeSpec(e)?.recoverMs ?? 0);
  e.swing.active = false;
  // A player collision ends the committed run immediately; the slide is only
  // used when the dash reaches its natural endpoint without hitting anyone.
  e.velX = 0;
  e.velY = 0;
  e.brakeMs = Math.min(meleeSpec(e)?.brakeMs ?? 0, RAM_BRAKE_FRAME_MS);
  w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: `brake:${e.archetype}` });
  bossDashWake(w, e);
}

/**
 * A ram that connects **exchanges momentum** with what it hit.
 *
 * The charge carried on through the player at full speed, as if they were
 * not there, and the player got the same small nudge every hit gives. Two
 * bodies colliding should read as one handing its motion to the other: the
 * player is thrown a short distance down the line of the charge, and the
 * charger's commit ends there — its speed drops to zero and it goes into the
 * braking recovery it would have had at the end of its run. The stop is
 * also the opening, so a ram that lands is punishable in the same way as one
 * that missed, which is what keeps taking the hit from being strictly worse
 * than dodging it in every respect.
 */
/** How far the player is thrown, in px, and over how long. Less than two tiles. */
const RAM_THROW_PX = 56;
const RAM_THROW_MS = 220;
/** A charge hit briefly takes control, but should not launch the player across the room. */
const RAM_HIT_STUN_MS = 600;
/** The impact is an immediate stop; the short brake timer is only for the authored stop frame. */
const RAM_BRAKE_FRAME_MS = 180;

function ramImpact(w: World, e: Enemy, spec: NonNullable<ReturnType<typeof meleeSpec>>): void {
  const p = w.player;
  const throwSpeed = RAM_THROW_PX / (RAM_THROW_MS / 1000);
  p.hurtX = e.lungeX * throwSpeed;
  p.hurtY = e.lungeY * throwSpeed;
  p.hurtMs = RAM_THROW_MS;
  e.attack = "recover";
  e.attackMs = spec.recoverMs;
  e.swing.active = false;
  e.velX = 0;
  e.velY = 0;
  e.brakeMs = Math.min(spec.brakeMs, RAM_BRAKE_FRAME_MS);
  /*
   * A ram lands like one: the room holds for a beat, and the
   * renderer is told where and which way (`ram`), so the impact has a burst
   * of its own rather than reading as a push.
   */
  impact(w, HITSTOP_CAP, 0);
  w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: `brake:${e.archetype}` });
  w.events.push({
    kind: "hazard_tick", x: (e.x + p.x) / 2, y: (e.y + p.y) / 2,
    what: `ram:${Math.atan2(e.lungeY, e.lungeX).toFixed(3)}`,
  });
}

/**
 * The player's slot in a hitbox's dedup list. Negative because enemy ids are
 * positive and the two share one list per box.
 */
const PLAYER_HIT_ID = -1;

function stepHazards(w: World, dtMs: number): void {
  const p = w.player;
  const on = hazardUnderfoot(w);

  /*
   * Each feature does what it says it does.
   *
   * Every one of them used to be contact damage, because the check was
   * `hazard_budget !== 0` — and the budget is a *cost against the room's cap*,
   * not a claim that something hurts. So the ice patch, the crumbling floor
   * and the turret's stone plinth all took a heart off anyone who touched
   * them, and the library's four carefully distinguished hazards were one
   * hazard with four sprites.
   *
   * Measured, this was the largest single thing wrong with the game's damage:
   * ground hazards were **79% of every heart lost**, more than everything
   * alive put together. For a design whose only verb is movement, a floor
   * that charges for being on it taxes the whole game.
   *
   * The clock belongs to the contact rather than to the room, which is what
   * makes any of this fair: it used to accumulate whether or not the player
   * was touching anything, so whether stepping onto spikes hurt at once or
   * half a second later depended on a timer that had nothing to do with them.
   * Left charged while they are clear, so entering costs immediately where
   * entering is supposed to cost, and only staying is on a clock.
   */
  if (!on) {
    /*
     * Pre-filled to within a reaction time of the first tick, not to the tick.
     *
     * It was pre-filled to the full interval, so the frame a foot touched a
     * spike strip cost a heart — a 100 ms crossing paid the same as standing
     * on it. Every other threat in the game is sized against a 250 ms reaction
     * floor; this was the one that gave none. The strip still bites anyone
     * who lingers a quarter second, and still every 1.1 s after that.
     */
    w.hazardTimerMs = HAZARD_DAMAGE_INTERVAL_MS - HAZARD_GRACE_MS;
    w.player.slipMs = Math.max(0, w.player.slipMs - dtMs);
    return;
  }

  switch (on.effect) {
    case "none":
      return;
    case "slip":
      // No damage at all. The cost is that the player keeps moving; see
      // `Player.slipMs`.
      w.player.slipMs = SLIP_CARRY_MS;
      return;
    case "contact": {
      // Retracted spikes are floor. The strip bites only while it is drawn
      // out, on the clock the renderer reads too.
      if (on.feature === "spike_strip" && !spikesOut(w.stats.elapsedMs)) return;
      w.hazardTimerMs += dtMs;
      if (w.hazardTimerMs < HAZARD_DAMAGE_INTERVAL_MS) return;
      w.hazardTimerMs = 0;
      break;
    }
    case "slow_tick": {
      // Crossing is free; standing costs — as a rising poison gauge, not a
      // heart on a clock. Its description always said so.
      feedPoison(w, POISON_BUILD_PER_S * (dtMs / 1000));
      return;
    }
    case "lava": {
      /*
       * A dash crosses it untouched — the i-frames cover a tile several times
       * over — and walking over it costs: it burns from the first step, and a
       * heart once the grace is up, on the contact clock. The channel is one
       * tile thick, so walking across is one heart and dashing is none.
       */
      if (dashInvulnerable(p)) return;
      feedBurn(w, LAVA_BURN_PER_S * (dtMs / 1000));
      w.hazardTimerMs += dtMs;
      if (w.hazardTimerMs < HAZARD_DAMAGE_INTERVAL_MS) return;
      w.hazardTimerMs = 0;
      break;
    }
  }
  w.events.push({ kind: "hazard_tick", x: on.x, y: on.y, what: on.feature });
  hurtPlayer(w, p.x, p.y, `hazard:${on.feature}`);
}

/** How long a spin press waits for the moment it can start. */
export const SPIN_BUFFER_MS = 180;

/**
 * **A poison pool poisons whatever walks in it**, not only the player.
 *
 * The pool is ground; the bodies that stand on the ground stand in it. So a
 * pool between the player and a rusher is a place to fight *from*: the
 * rusher's gauge fills as it crosses, the same gauge a venom spell feeds.
 * What flies and a leaping boss are in the air, so neither is touched.
 */
function poisonGround(w: World, dtMs: number): void {
  const pools = w.room.zones.filter((z) => z.feature === "poison_pool");
  if (pools.length === 0) return;
  const add = ENEMY_POOL_BUILD_PER_S * (dtMs / 1000);
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.airborne || ENEMIES[e.archetype].flying || e.spawnFadeMs > 0) continue;
    const inPool = pools.some((z) => z.cells.some((c) =>
      circlesOverlap((c[0] + 0.5) * TILE_PX, (c[1] + 0.5) * TILE_PX, TILE_PX / 2, e.x, e.y, e.radius * 0.6)));
    if (!inPool) continue;
    if (e.poisonMs > 0) { e.poisonMs = Math.max(e.poisonMs, ENEMY_POISON_MS * 0.5); continue; }
    e.poisonBuild = Math.min(1, e.poisonBuild + add);
    e.buildFedMs = 600;
    if (e.poisonBuild >= 1) { e.poisonMs = ENEMY_POISON_MS; e.poisonStacks = ENEMY_POISON_STACKS; e.poisonBuild = 1; }
  }
}

/** How fast lava fills the player's burn gauge, per second, on top of its hearts. */
const LAVA_BURN_PER_S = 1.2;
/** A body in lava takes this much every `LAVA_ENEMY_TICK_MS`. */
const LAVA_ENEMY_DAMAGE = 8;
const LAVA_ENEMY_TICK_MS = 450;
/** How long a grass cell burns, and how long into it the fire reaches its neighbours. */
export const GRASS_BURN_MS = 1500;
/**
 * How long touched grass smoulders before it goes up. Long enough that a
 * player walking or dashing across grass as they light it is a step past the
 * cell when it catches, short enough that the fire still reads as the spell's.
 */
export const GRASS_CATCH_MS = 300;
export const GRASS_SPREAD_MS = 260;

/** The room's grid with every lava cell a wall: what bodies route on. */
function lavaAsWall(room: RoomPlan): Uint8Array {
  const grid = new Uint8Array(room.grid);
  for (const z of room.zones)
    if (z.feature === "lava_channel")
      for (const [x, y] of featureCells(z.feature, z.cells)) grid[y * GRID_W + x] = Tile.Wall;
  return grid;
}

/** Every cell of every grass zone, whole. */
function grassOf(room: RoomPlan): GrassCell[] {
  return room.zones.filter((z) => z.feature === "grass_patch")
    .flatMap((z) => z.cells.map(([x, y]) => ({
      x, y, state: "grass" as const, ms: 0, owner: "enemy" as const, spread: false,
    })));
}

/**
 * Bodies in lava burn. They route round it (`World.pathGrid`), so a body is
 * in it because it was knocked there — which is the player's to use.
 * Airborne bodies and everything that flies pass over.
 */
function stepLava(w: World, dtMs: number): void {
  const channels = w.room.zones.filter((z) => z.feature === "lava_channel");
  if (channels.length === 0) return;
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.airborne || ENEMIES[e.archetype].flying || e.spawnFadeMs > 0) continue;
    const inLava = channels.some((z) => featureCells(z.feature, z.cells).some((c) =>
      circlesOverlap((c[0] + 0.5) * TILE_PX, (c[1] + 0.5) * TILE_PX, TILE_PX / 2, e.x, e.y, e.radius * 0.6)));
    if (!inLava) { e.lavaMs = 0; continue; }
    e.lavaMs += dtMs;
    if (e.lavaMs < LAVA_ENEMY_TICK_MS) continue;
    e.lavaMs = 0;
    hurtEnemy(w, e, LAVA_ENEMY_DAMAGE, "lava");
  }
}

/**
 * Grass burns once, and the fire runs through it.
 *
 * Any fire that reaches a whole cell lights it, whoever lit that fire —
 * a spell, a cinderling's trail, a burning shot, the player's own trail or
 * field — and the burning grass hurts **everyone** in it, the player who lit
 * it included: a player who sends fire across the grass under a pack burns
 * the pack, and has to be out of the patch when it goes up. What makes that
 * fair is the catch: touched grass smoulders for `GRASS_CATCH_MS` before it
 * burns, so a player walking or dashing across grass as they light it is past
 * the cell when it goes up, and only lingering costs them. The owner is kept
 * for the kill's credit. A burning cell lights its whole neighbours a beat later,
 * so the fire is seen to run, and is burnt ground after it. The fires the
 * grass lights do not light grass themselves: the spread is the grass's own
 * clock, not a chain reaction in one step.
 */
function stepGrass(w: World, dtMs: number): void {
  if (w.grass.length === 0) return;
  const at = new Map(w.grass.map((c) => [c.y * GRID_W + c.x, c]));
  // Touched: it smoulders first, and only a cell still standing can be touched.
  const light = (c: GrassCell, owner: "player" | "enemy") => {
    if (c.state !== "grass") return;
    c.state = "catching";
    c.ms = 0;
    c.owner = owner;
    c.spread = false;
  };
  const ignite = (c: GrassCell) => {
    c.state = "burning";
    c.ms = 0;
    const f = lightFire(w, (c.x + 0.5) * TILE_PX, (c.y + 0.5) * TILE_PX, c.owner, { radius: TILE_PX * 0.62, lifeMs: GRASS_BURN_MS });
    f.fromGrass = true;
  };
  for (const f of w.fires) {
    // A poison cloud is not fire, and lights nothing.
    if (!f.alive || f.fromGrass || f.element !== "fire") continue;
    for (const c of w.grass)
      if (c.state === "grass" && Math.hypot((c.x + 0.5) * TILE_PX - f.x, (c.y + 0.5) * TILE_PX - f.y) < f.radius + TILE_PX * 0.4) light(c, f.owner);
  }
  // A fire shot lights the cell it flies over, so a fire spell cast across a
  // patch leaves a burning line behind it. A lobbed throw is in the air and
  // lights only where it lands, as the fire it leaves.
  for (const [list, owner] of [[w.playerBullets, "player"], [w.enemyBullets, "enemy"]] as const)
    for (const b of list) {
      if (!b.alive || b.element !== "fire") continue;
      const c = at.get(Math.floor(b.y / TILE_PX) * GRID_W + Math.floor(b.x / TILE_PX));
      if (c && c.state === "grass") light(c, owner);
    }
  for (const c of w.grass) {
    if (c.state === "catching") {
      c.ms += dtMs;
      if (c.ms >= GRASS_CATCH_MS) ignite(c);
      continue;
    }
    if (c.state !== "burning") continue;
    c.ms += dtMs;
    if (!c.spread && c.ms >= GRASS_SPREAD_MS) {
      c.spread = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = at.get((c.y + dy) * GRID_W + c.x + dx);
        if (n && n.state === "grass") light(n, c.owner);
      }
    }
    if (c.ms >= GRASS_BURN_MS) { c.state = "burnt"; c.ms = 0; }
  }
}

/** How fast a pool fills a standing enemy's poison gauge, per second. */
export const ENEMY_POOL_BUILD_PER_S = 0.9;

/**
 * Standing in poison costs a heart this often. Long, because the pool's job is
 * to deny ground rather than to punish crossing it.
 */
const HAZARD_SLOW_TICK_MS = 1800;
/** How long the player keeps sliding after leaving ice. */
const SLIP_CARRY_MS = 260;

/** The feature cell the player is standing in, if any, and what it does. */
/**
 * The hazard a body of the player's radius standing at `x, y` would be on.
 *
 * Exported for the reference player, which had a cost term for burning ground
 * and **none for the room's own hazards** — it walked onto spike strips it
 * could see, and spikes were 61% of every heart it lost. A real player reads
 * the floor; the model has to be given the same floor to read.
 */
export function hazardAt(
  w: World, x: number, y: number,
): { x: number; y: number; feature: string; effect: HazardEffect } | null {
  for (const zone of w.room.zones) {
    if (zone.feature === "none") continue;
    const f = feature(zone.feature);
    if (!f || f.hazard_effect === "none") continue;
    for (const cell of featureCells(zone.feature, zone.cells)) {
      const cx = (cell[0] + 0.5) * TILE_PX;
      const cy = (cell[1] + 0.5) * TILE_PX;
      if (circlesOverlap(cx, cy, TILE_PX / 2, x, y, PLAYER_RADIUS))
        return { x: cx, y: cy, feature: zone.feature, effect: f.hazard_effect };
    }
  }
  return null;
}

function hazardUnderfoot(w: World): ReturnType<typeof hazardAt> {
  return hazardAt(w, w.player.x, w.player.y);
}

export function dashInvulnerable(p: World["player"]): boolean {
  return p.dashIframeMs > 0;
}

/**
 * The dash strike's hits: every body the moving player overlaps, once each,
 * while the strike lasts. Knocked away from the line of travel, so the path
 * the player took is clear behind them.
 */
function stepDashStrike(w: World, dtMs: number): void {
  const p = w.player;
  /*
   * A dash cast free cuts where it was aimed and nowhere else (`FreeStrike`):
   * every body inside the cut, once, and the player does not move.
   */
  if (w.freeStrikes.length > 0) {
    for (const s of w.freeStrikes) {
      for (const e of w.enemies) {
        if (!isActive(e) || e.hp <= 0) continue;
        if (!circlesOverlap(s.x, s.y, s.radius, e.x, e.y, e.radius)) continue;
        wake(w, e);
        hurtEnemy(w, e, s.damage, s.element !== "none" ? s.element : "", s, s.damage * STRIKE_POISE);
        w.stats.damageDealt += s.damage;
        applyElementsTo(e, s.powers, s.statusMult, s.proc);
        e.hitFlashMs = HIT_FLASH_MS;
        impact(w, HITSTOP_HIT, TRAUMA_HIT);
        w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: e.archetype, amount: s.damage });
        emit(w, e.x, e.y, "hit", 4);
      }
      w.events.push({ kind: "shot", x: s.x, y: s.y, what: "free_strike" });
    }
    w.freeStrikes = [];
  }
  stepPlayerWakes(w);
  if (p.strikeMs <= 0) return;
  p.strikeMs -= dtMs;
  // A Dash Slash's wake, laid where the player has got to; the rest of it as the run ends.
  if (p.strikeWake) {
    layWake(w, p.strikeWake, p.x, p.y, p.strikeMs <= 0);
    if (p.strikeMs <= 0) {
      const cut = p.strikeWake.byPlayer;
      if (cut && cut.finaleShare > 0) throwFinale(w, cut);
      p.strikeWake = null;
    }
  }
  /*
   * A `land` dash comes down (doc 006): the ring goes off where the player
   * actually is when the travel ends, which a wall may have made short of
   * the body it leapt at.
   */
  if (p.strikeMs <= 0 && p.landing) {
    const ring = p.landing;
    p.landing = null;
    eruptRing(w, p, ring, 0);
    w.events.push({ kind: "shot", x: p.x, y: p.y, what: "land" });
  }
  // A leap is in the air and cuts nothing on the way.
  if (p.strikeDamage <= 0) return;
  for (const e of w.enemies) {
    if (!isActive(e) || e.hp <= 0 || p.strikeHits.includes(e.id)) continue;
    if (!circlesOverlap(p.x, p.y, PLAYER_RADIUS + p.strikeRadius, e.x, e.y, e.radius)) continue;
    p.strikeHits.push(e.id);
    // A body the run itself cut is not cut again by its wake: the wake is for the ground beside the run.
    p.strikeWake?.byPlayer?.hits.push(e.id);
    wake(w, e);
    hurtEnemy(w, e, p.strikeDamage, p.strikeElement !== "none" ? p.strikeElement : "", p, p.strikeDamage * STRIKE_POISE);
    w.stats.damageDealt += p.strikeDamage;
    applyElementsTo(e, p.strikePowers, p.strikeStatusMult, p.strikeProc);
    e.hitFlashMs = HIT_FLASH_MS;
    const cut = p.strikeWake?.byPlayer;
    /*
     * `momentum`: the body the cut went through carries the run on — the
     * travel, the strike and the mercy frames all lengthened by what the
     * extra ground takes at dash speed — a few times at most.
     */
    if (cut && cut.momentumLeft > 0 && cut.momentumPx > 0) {
      const more = (cut.momentumPx / Math.max(1, DASH_SPEED * p.mods.dashRange)) * 1000;
      p.strikeMs += more;
      p.dashMs += more;
      p.dashIframeMs += more;
      cut.momentumLeft--;
      w.events.push({ kind: "spell", x: e.x, y: e.y, what: "momentum" });
    }
    if (cut && cut.pull > 0) {
      // `undertow`: the run only nudges what it passes on down the line, so the wake behind can draw it in.
      const push = (cut.knock * 0.3) / Math.max(1, e.radius / 10);
      e.knockX += p.dashX * push;
      e.knockY += p.dashY * push;
      if (cut.weight >= SPELL_STAGGER_WEIGHT) spellStagger(w, e, cut.weight);
      impact(w, HITSTOP_HIT * 1.6, TRAUMA_HIT * 1.5);
    } else if (cut && cut.knock > 0) {
      /*
       * **A Dash Slash throws the body off its line**, square to the run, to
       * whichever side it was on, hard: the pack parts round the player and
       * into the wake coming off either side.
       */
      const side = Math.sign(-p.dashY * (e.x - p.x) + p.dashX * (e.y - p.y)) || (e.id % 2 ? 1 : -1);
      const push = cut.knock / Math.max(1, e.radius / 10);
      e.knockX += -p.dashY * side * push + p.dashX * push * 0.25;
      e.knockY += p.dashX * side * push + p.dashY * push * 0.25;
      if (cut.weight >= SPELL_STAGGER_WEIGHT) spellStagger(w, e, cut.weight);
      impact(w, HITSTOP_HIT * 1.6, TRAUMA_HIT * 1.5);
    } else {
      const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
      const push = 260 / Math.max(1, e.radius / 10);
      e.knockX += ((e.x - p.x) / d) * push;
      e.knockY += ((e.y - p.y) / d) * push;
      impact(w, HITSTOP_HIT, TRAUMA_HIT);
    }
    w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: e.archetype, amount: p.strikeDamage });
    emit(w, e.x, e.y, "hit", 4);
  }
}

/**
 * How far a knock carries a body, px per px/s of it: the knock decays by
 * 0.82 a step at 60 steps a second, so it travels v / 60 / 0.18.
 */
const KNOCK_TRAVEL = 1 / 60 / 0.18;
/** A `finale`'s crescent: how wide, how deep, how fast it flies. */
const FINALE_HALF = (50 * Math.PI) / 180;
const FINALE_THICK = 12;
const FINALE_SPEED = 320;

/**
 * **`finale`**: where the run stops, its cut is thrown on ahead — a crescent
 * of the same sword energy out of the player's front, through each body in
 * its reach once, at a share of the run's cut.
 */
function throwFinale(w: World, cut: PlayerWakeCut): void {
  const p = w.player;
  const s = castShockwave(w, p.x, p.y, {
    chargeMs: 0, inner: PLAYER_RADIUS, thickness: FINALE_THICK, speed: FINALE_SPEED,
    maxRadius: PLAYER_RADIUS + cut.finaleReach, damage: 0, facing: Math.atan2(p.dashY, p.dashX), half: FINALE_HALF,
  });
  s.byPlayer = { ...cut, damage: cut.runDamage * cut.finaleShare, hits: [], momentumLeft: 0, finaleShare: 0 };
  w.events.push({ kind: "spell", x: p.x, y: p.y, what: "finale" });
}

/**
 * **A player's wake** (the Dash Slash, `layWake`): each stretch cuts the
 * bodies its band crosses, once each across the whole wake, and shoves them
 * on the way it is rolling. Stone stops it as it stops the king's.
 */
function stepPlayerWakes(w: World): void {
  for (const s of w.shockwaves) {
    const cut = s.byPlayer;
    if (!cut || !s.alive || s.chargeMs > 0) continue;
    for (const e of w.enemies) {
      if (!isActive(e) || e.hp <= 0 || e.airborne || cut.hits.includes(e.id)) continue;
      if (!shockwaveHits(s, e.x, e.y, e.radius) || !hasLineOfSight(w.room.grid, s.x, s.y, e.x, e.y)) continue;
      cut.hits.push(e.id);
      wake(w, e);
      hurtEnemy(w, e, cut.damage, cut.element !== "none" ? cut.element : "", s, cut.damage * poiseOfWeight(cut.weight));
      w.stats.damageDealt += cut.damage;
      applyElementsTo(e, cut.powers, cut.statusMult, cut.proc);
      e.hitFlashMs = HIT_FLASH_MS;
      // Out from a crescent's centre (a `finale`); square off the run for a wake's stretch.
      const d = Math.hypot(e.x - s.x, e.y - s.y) || 1;
      const ux = s.half !== undefined ? (e.x - s.x) / d : Math.cos(s.facing ?? 0);
      const uy = s.half !== undefined ? (e.y - s.y) / d : Math.sin(s.facing ?? 0);
      if (cut.pull > 0 && s.half === undefined) {
        /*
         * `undertow`: drawn back in toward the run's line — as far as the
         * body stands off it and no further, since a shove decays to about a
         * twelfth of itself in px (`KNOCK_TRAVEL`), so it lands on the line.
         */
        const off = Math.max(0, (e.x - s.x) * ux + (e.y - s.y) * uy);
        const pull = Math.min(cut.knock * cut.pull, off / KNOCK_TRAVEL) / Math.max(1, e.radius / 10);
        e.knockX -= ux * pull;
        e.knockY -= uy * pull;
      } else {
        // On the way the wake rolls, off the run: as hard as the spell's shove, a little under the run's own.
        const push = Math.max(160, cut.knock * 0.8) / Math.max(1, e.radius / 10);
        e.knockX += ux * push;
        e.knockY += uy * push;
      }
      if (cut.weight >= SPELL_STAGGER_WEIGHT) spellStagger(w, e, cut.weight);
      impact(w, HITSTOP_HIT, TRAUMA_HIT);
      w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: e.archetype, amount: cut.damage });
      emit(w, e.x, e.y, "hit", 4);
    }
  }
}

/** Eruption cells alive at once, across every cast. */
/*
 * Raised from 32 with the `ring` pattern: three rings of cells round the
 * caster are thirty-odd cells on their own, and a pool that recycled the
 * outer ring's cells before they went off would make the spell's reach a
 * fact about the pool size.
 */
const ERUPTION_POOL = 128;
/** How long a cell that went off is drawn. */
export const ERUPTION_SHOW_MS = 420;

/**
 * The ground erupting: each cell waits its turn, then goes off once on every
 * body standing in it — damage in its element, the element's status, a push
 * outward by its weight and, heavy enough, a stagger — and a fire cell leaves
 * the floor burning. The room jolts once for a cell that hit anything.
 */
function stepEruptions(w: World, dtMs: number): void {
  for (const c of w.eruptions) {
    if (!c.alive) continue;
    if (c.fired) {
      c.ageMs += dtMs;
      if (c.ageMs >= ERUPTION_SHOW_MS) c.alive = false;
      continue;
    }
    c.delayMs -= dtMs;
    if (c.delayMs > 0) continue;
    c.fired = true;
    c.ageMs = 0;
    // An enemy's cell (the Frontier Veteran's palisade): the player, once a cast, and nothing else.
    if (c.hostile) {
      // A stake comes up through whatever stands on its cell (`veteranBreaksProps`).
      smashPropsWhere(w, (q) => propHit(q, c.x, c.y, c.radius));
      const p = w.player;
      if (w.hostileCastHit !== c.castId && Math.hypot(p.x - c.x, p.y - c.y) <= c.radius + PLAYER_RADIUS) {
        w.hostileCastHit = c.castId;
        hurtPlayer(w, c.x, c.y, "stakes", 0, c.damage);
      }
      w.events.push({ kind: "eruption", x: c.x, y: c.y, what: "stakes" });
      continue;
    }
    let hit = false;
    for (const e of w.enemies) {
      if (!isActive(e) || e.hp <= 0) continue;
      const d = Math.hypot(e.x - c.x, e.y - c.y);
      if (d > c.radius + e.radius) continue;
      if (c.castId > 0) {
        if (e.eruptionCastId === c.castId) continue;
        e.eruptionCastId = c.castId;
      }
      hit = true;
      hurtEnemy(w, e, c.damage, c.element !== "none" ? c.element : "", { x: c.x, y: c.y }, c.damage * poiseOfWeight(c.weight));
      w.stats.damageDealt += c.damage;
      applyElementsTo(e, c.powers, c.statusMult, c.proc);
      e.hitFlashMs = HIT_FLASH_MS;
      const push = (KNOCKBACK * c.weight) / Math.max(1, e.radius / 10);
      const nx = d > 1 ? (e.x - c.x) / d : Math.cos(w.player.facing), ny = d > 1 ? (e.y - c.y) / d : Math.sin(w.player.facing);
      e.knockX += nx * push;
      e.knockY += ny * push;
      if (c.weight >= SPELL_STAGGER_WEIGHT) spellStagger(w, e, c.weight);
      w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: e.archetype, amount: c.damage });
      if (e.hp <= 0) onEnemyKilled(w, e);
    }
    if (c.burnMs > 0) lightFire(w, c.x, c.y, "player", { radius: c.radius, lifeMs: c.burnMs, damage: c.damage * 0.2 });
    if (hit) impact(w, HITSTOP_HIT * (1 + c.weight * 0.5), TRAUMA_HIT * Math.max(1, c.weight));
    // A rock from above (Meteor's fire landing) shakes the room when it lands,
    // hit or miss. Hostile earth uses `telegraphMs` only to expose its warning.
    if (c.telegraphMs > 0 && c.kind === "fire") w.trauma = Math.min(1, w.trauma + TRAUMA_SKY_LANDING);
    w.events.push({ kind: "eruption", x: c.x, y: c.y, what: c.kind });
  }
}

/** How often a vortex ticks its damage on what it holds. */
const VORTEX_TICK_MS = 500;

function stepVortices(w: World, dtMs: number): void {
  const dt = dtMs / 1000;
  for (const v of w.vortices) {
    if (!v.alive) continue;
    v.lifeMs -= dtMs;
    if (v.lifeMs <= 0) {
      v.alive = false;
      if (v.collapseDamage > 0) collapse(w, v);
      continue;
    }
    v.tickMs -= dtMs;
    const tick = v.tickMs <= 0;
    if (tick) v.tickMs = VORTEX_TICK_MS;
    for (const e of w.enemies) {
      if (!isActive(e) || e.hp <= 0) continue;
      if (ENEMIES[e.archetype].behaviour === "stationary" || e.archetype === "boss") continue;
      const dx = v.x - e.x;
      const dy = v.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d > v.radius + e.radius) continue;
      // Strongest at the rim and easing off at the centre, so bodies gather
      // rather than pile onto one point; heavy bodies come slower.
      const strength = v.pull * Math.min(1, d / Math.max(1, v.radius * 0.35)) / Math.max(1, e.radius / 10);
      if (d > 4) {
        moveSliding(w.room.grid, e, (dx / d) * strength * dt, (dy / d) * strength * dt, e.radius);
      }
      if (tick && d < v.radius * 0.75) {
        // The maw's pull is a grind, not a blow; its collapse is the blow.
        hurtEnemy(w, e, v.damage, v.element !== "none" ? v.element : "", undefined, v.damage * poiseOfWeight(0));
        w.stats.damageDealt += v.damage;
        applyElementsTo(e, v.powers, v.statusMult, v.proc);
        e.hitFlashMs = HIT_FLASH_MS;
        w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "vortex" });
      }
    }
  }
}

/**
 * **`collapse`** (doc 006): as the pull lets go it implodes, once, on every
 * body still inside its radius — the bodies it gathered and held, which is
 * the pull's payoff. A body that walked out, or was never in it, takes none.
 * Measured from the body's centre, not its edge: the implosion is at the
 * middle of what the pull holds, and a body only touching the rim was not held.
 */
function collapse(w: World, v: World["vortices"][number]): void {
  let hit = false;
  for (const e of w.enemies) {
    if (!isActive(e) || e.hp <= 0) continue;
    if (Math.hypot(e.x - v.x, e.y - v.y) > v.radius) continue;
    hit = true;
    hurtEnemy(w, e, v.collapseDamage, v.element !== "none" ? v.element : "", v, v.collapseDamage * poiseOfWeight(SPELL_STAGGER_WEIGHT));
    w.stats.damageDealt += v.collapseDamage;
    applyElementsTo(e, v.powers, v.statusMult, v.proc);
    e.hitFlashMs = HIT_FLASH_MS;
    w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: e.archetype, amount: v.collapseDamage });
  }
  if (hit) impact(w, HITSTOP_HIT * 2, TRAUMA_HIT);
  w.events.push({ kind: "eruption", x: v.x, y: v.y, what: "collapse" });
}

/**
 * The `doom` marks counting down, on bodies and where bodies died, and the
 * `contagion` a carrier loses when its poison runs out.
 */
function stepDooms(w: World, dtMs: number): void {
  for (const e of w.enemies) {
    if (e.contagion > 0 && e.poisonMs <= 0) e.contagion = 0;
    if (e.doomMs <= 0 || e.hp <= 0) continue;
    e.doomMs -= dtMs;
    if (e.doomMs > 0) continue;
    e.doomMs = 0;
    doomBurst(w, e.x, e.y, e.doomDamage, e.doomRadius);
  }
  if (w.dooms.length === 0) return;
  for (const d of w.dooms) {
    d.ms -= dtMs;
    if (d.ms <= 0) doomBurst(w, d.x, d.y, d.damage, d.radius, d.tag);
  }
  w.dooms = w.dooms.filter((d) => d.ms > 0);
}

/**
 * A `doom` mark going off: its stored damage on every body inside the burst,
 * the marked one with them. Reported as `dot:doom`, because doc 006 counts a
 * doom burst as the spell's status — the delayed payoff the caster left to
 * work — and the bench's affliction gate reads status damage by that tag.
 */
function doomBurst(w: World, x: number, y: number, damage: number, radius: number, tag = "dot:doom"): void {
  for (const e of w.enemies) {
    if (!isActive(e) || e.hp <= 0) continue;
    if (Math.hypot(e.x - x, e.y - y) > radius + e.radius) continue;
    hurtEnemy(w, e, damage, tag, { x, y }, damage * PROC_POISE);
    w.stats.damageDealt += damage;
    e.hitFlashMs = HIT_FLASH_MS;
    w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: e.archetype, amount: damage });
  }
  impact(w, HITSTOP_HIT * 2, TRAUMA_HIT);
  emit(w, x, y, "kill", 8);
  // An aftershock is the ground going off, not the void's mark: the renderer draws them apart.
  w.events.push({ kind: "eruption", x, y, what: tag === "aftershock" ? "aftershock" : "doom" });
}

/**
 * **A carrier died: its poison jumps** (doc 006). Up to `contagion` of the
 * nearest bodies within reach take the poison as it stood — its time left,
 * its stacks, the build behind it — and carry the contagion on in turn.
 *
 * It cannot loop. A jump happens only on a death and each body dies once,
 * so a chain of jumps is bounded by the room; and a body that already
 * carries the contagion is not a target, so two carriers dying side by side
 * do not spend their jumps on each other.
 */
function spreadContagion(w: World, e: Enemy): void {
  const n = e.contagion;
  e.contagion = 0;
  if (n <= 0 || e.poisonMs <= 0) return;
  const near = w.enemies
    // Not onto the king roaring: nothing lands on him then (`applyElementTo`).
    .filter((o) => o !== e && o.hp > 0 && isActive(o) && o.contagion <= 0 && o.bossRoarMs <= 0
      && resistOf(o.archetype, "poison") > 0)
    .map((o) => ({ o, d: Math.hypot(o.x - e.x, o.y - e.y) }))
    .filter((c) => c.d <= e.contagionReach + c.o.radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, n);
  for (const { o } of near) {
    o.poisonMs = Math.max(o.poisonMs, e.poisonMs);
    o.poisonStacks = Math.max(o.poisonStacks, e.poisonStacks);
    o.poisonBuild = 1;
    o.statusMult = Math.max(o.statusMult, e.statusMult);
    o.contagion = n;
    o.contagionReach = e.contagionReach;
    w.events.push({ kind: "hazard_tick", x: o.x, y: o.y, what: "contagion" });
  }
  if (near.length > 0) w.events.push({ kind: "shot", x: e.x, y: e.y, what: "contagion" });
}

/** How close behind the player the companion tries to stand, in px. */
const PET_FOLLOW_PX = 26;

function stepPets(w: World, dtMs: number, items: ItemRegistry): void {
  const dt = dtMs / 1000;
  const p = w.player;
  for (const pet of w.pets) {
    if (!pet.alive) continue;
    pet.lifeMs -= dtMs;
    if (pet.lifeMs <= 0) { pet.alive = false; continue; }
    if (pet.attackMs > 0) pet.attackMs -= dtMs;
    /*
     * It **roams** round the player rather than holding a spot behind them: a
     * point on a ring about the player that drifts, and every second or so a
     * new one, so the companion reads as a creature keeping close rather than
     * as something bolted to the player's back.
     */
    pet.wanderMs = (pet.wanderMs ?? 0) - dtMs;
    if (pet.wanderMs <= 0 || pet.wanderA === undefined) {
      pet.wanderMs = 700 + w.rng.next() * 900;
      pet.wanderA = (pet.wanderA ?? p.facing + Math.PI) + (w.rng.next() - 0.5) * 2.4;
      pet.wanderR = PET_FOLLOW_PX + w.rng.next() * 22;
    }
    pet.wanderA += dt * 0.6;
    const goalX = p.x + Math.cos(pet.wanderA) * (pet.wanderR ?? PET_FOLLOW_PX);
    const goalY = p.y + Math.sin(pet.wanderA) * (pet.wanderR ?? PET_FOLLOW_PX);
    const gx = goalX - pet.x;
    const gy = goalY - pet.y;
    const gd = Math.hypot(gx, gy);
    if (gd > 6) {
      const step = Math.min(gd, pet.speed * dt);
      pet.vx = (gx / gd) * step / dt;
      pet.vy = (gy / gd) * step / dt;
      moveSliding(w.room.grid, pet, (gx / gd) * step, (gy / gd) * step, 6);
      pet.facing = Math.atan2(gy, gx);
    } else {
      pet.vx = 0;
      pet.vy = 0;
    }
    // Fire at the nearest body in range, on its own clock.
    pet.fireMs -= dtMs;
    if (pet.fireMs > 0) continue;
    let best: Enemy | null = null;
    let bestD = pet.range;
    for (const e of w.enemies) {
      if (!isActive(e) || e.hp <= 0) continue;
      const d = Math.hypot(e.x - pet.x, e.y - pet.y);
      if (d < bestD && hasLineOfSight(w.room.grid, pet.x, pet.y, e.x, e.y)) { bestD = d; best = e; }
    }
    if (!best) continue;
    pet.fireMs = pet.intervalMs;
    pet.attackMs = 220;
    pet.facing = Math.atan2(best.y - pet.y, best.x - pet.x);
    const b = acquire(w.playerBullets, true);
    if (!b) continue;
    const d = bestD || 1;
    b.x = pet.x;
    b.y = pet.y;
    b.originX = pet.x;
    b.originY = pet.y;
    b.vx = ((best.x - pet.x) / d) * 520;
    b.vy = ((best.y - pet.y) / d) * 520;
    b.radius = 3;
    b.damage = pet.damage;
    b.lifeMs = 900;
    b.targetId = best.id;
    b.seekDegPerS = 200;
    b.spellIndex = pet.spellIndex;
    b.element = pet.element;
    b.elementPower = pet.elementPower;
    copyPowers(b.powers, pet.powers);
    b.proc = pet.proc;
    b.statusMult = pet.statusMult;
    w.stats.shotsFired++;
    void items;
  }
}

/*
 * Build-up rates, per second of exposure, and what a full gauge becomes.
 *
 * Burning ground fills the fire gauge in a little over a second, a poison
 * pool the poison gauge in just under two: a crossing costs nothing, a stand
 * costs a status. Unfed, a gauge drains back to empty in about three seconds.
 * A status drains health on a half-second clock: burning 0.1 heart a tick for
 * three seconds (0.6 in all), poison 0.06 for four (0.5) and a quarter off
 * the player's speed while it lasts.
 */
const BURN_BUILD_PER_S = 0.85;
const POISON_BUILD_PER_S = 0.55;
const BUILD_DECAY_PER_S = 0.35;
const BUILD_FED_HOLD_MS = 250;
export const BURN_STATUS_MS = 3000;
export const POISON_STATUS_MS = 2500;
const DOT_TICK_MS = 500;
const BURN_TICK_HEARTS = 0.1;
// A whole health point a tick (damage is an integer), over a shorter status:
// the same half a heart in all.
const POISON_TICK_HEARTS = 0.1;
export const POISON_SLOW = 0.75;

/*
 * While a status runs, **the gauge is its clock**: it ignites full and drains
 * to empty over the status, and the status ends when it does. It used to
 * reset to zero on igniting, so the bar vanished at the moment it mattered
 * most. A running status is not fed: standing in the pool while poisoned
 * does not extend it, or a pool is a status that never ends.
 */
/*
 * Standing in what caused a status keeps it full: already burning, the fire
 * underfoot holds the burn at its whole length rather than letting it run
 * down while the player stands in the flames — the gauge falling there read
 * as the fire having stopped working.
 */
function feedBurn(w: World, amount: number): void {
  const p = w.player;
  if (p.burnMs > 0) { p.burnMs = BURN_STATUS_MS; return; }
  p.burnBuild = Math.min(1, p.burnBuild + amount);
  p.burnFedMs = BUILD_FED_HOLD_MS;
}

function feedPoison(w: World, amount: number): void {
  const p = w.player;
  if (p.poisonMs > 0) { p.poisonMs = POISON_STATUS_MS; return; }
  p.poisonBuild = Math.min(1, p.poisonBuild + amount);
  p.poisonFedMs = BUILD_FED_HOLD_MS;
}

function stepStatuses(w: World, dtMs: number): void {
  const p = w.player;
  const dt = dtMs / 1000;
  if (p.burnFedMs > 0) p.burnFedMs -= dtMs;
  else p.burnBuild = Math.max(0, p.burnBuild - BUILD_DECAY_PER_S * dt);
  if (p.poisonFedMs > 0) p.poisonFedMs -= dtMs;
  else p.poisonBuild = Math.max(0, p.poisonBuild - BUILD_DECAY_PER_S * dt);

  if (p.burnBuild >= 1 && p.burnMs <= 0) {
    p.burnBuild = 0;
    p.burnMs = BURN_STATUS_MS;
    w.events.push({ kind: "player_hit", x: p.x, y: p.y, what: "status:burning", amount: 0 });
  }
  if (p.poisonBuild >= 1 && p.poisonMs <= 0) {
    p.poisonBuild = 0;
    p.poisonMs = POISON_STATUS_MS;
    w.events.push({ kind: "player_hit", x: p.x, y: p.y, what: "status:poisoned", amount: 0 });
  }

  if (p.burnMs <= 0 && p.poisonMs <= 0) { p.dotTickMs = 0; return; }
  if (p.burnMs > 0) p.burnMs -= dtMs;
  if (p.poisonMs > 0) p.poisonMs -= dtMs;
  // The gauge follows the clock, and is empty — reset — when the status ends.
  p.burnBuild = p.burnMs > 0 ? p.burnMs / BURN_STATUS_MS : 0;
  p.poisonBuild = p.poisonMs > 0 ? p.poisonMs / POISON_STATUS_MS : 0;
  p.dotTickMs -= dtMs;
  if (p.dotTickMs > 0) return;
  p.dotTickMs = DOT_TICK_MS;
  if (p.burnMs > 0) drainPlayer(w, BURN_TICK_HEARTS, "burn");
  if (p.poisonMs > 0) drainPlayer(w, POISON_TICK_HEARTS, "poison");
}

/**
 * A status tick: health leaves without a hit — no mercy frames, no nudge,
 * no freeze, because none of those belong to a thing already happening.
 */
function drainPlayer(w: World, hearts: number, cause: string): void {
  const p = w.player;
  if (p.hearts <= 0) return;
  const due = Math.min(p.hearts, wholeHp(hearts * w.takenMult * rampFor(w.roomIndex).hurt));
  // Invincible (testing): the tick is shown, not taken.
  const taken = w.invincible ? 0 : due;
  p.hearts -= taken;
  w.stats.heartsLost += taken;
  w.events.push({ kind: "player_hit", x: p.x, y: p.y, what: `dot:${cause}`, amount: due });
  hurtFamily(w, `dot:${cause}`, due);
}

/**
 * `resonance`: each spell carrying it counts connecting sword hits, and on the
 * count casts itself at the body struck, free.
 */
function resonate(w: World, e: Enemy): void {
  w.spells.forEach((slot, i) => {
    if (!slot) return;
    const held = slot.affixes.find((a) => a.id === "resonance");
    if (!held) return;
    const e0 = effectOf(held);
    const every = e0?.kind === "resonate" ? e0.every : 5;
    w.resonance[i] = (w.resonance[i] ?? 0) + 1;
    if (w.resonance[i]! < every) return;
    w.resonance[i] = 0;
    hookSim(w).fire(i, w.player, e);
    w.events.push({ kind: "shot", x: w.player.x, y: w.player.y, what: "resonance" });
  });
}

/**
 * The player's loss in whole health points (a heart is `HP_PER_HEART` of
 * them), rounded down and never below one, so the bar only ever shows whole
 * numbers.
 */
function wholeHp(hearts: number): number {
  return Math.max(1, Math.floor(hearts * HP_PER_HEART + 1e-6)) / HP_PER_HEART;
}

/** What the first hit on an unaware body is multiplied by. */
const AMBUSH_MULT = 2;

/** Rage per connecting sword hit and per sword kill, in segments. */
const RAGE_PER_HIT = 0.12;
const RAGE_PER_KILL = 0.35;
/** What an enchant's wave earns of that, per body it crosses (`stepPlayerBullets`). */
const WAVE_RAGE_MULT = 0.4;

function gainRage(w: World, amount: number): void {
  const p = w.player;
  p.rage = Math.min(p.mods.rageMax, p.rage + amount);
}

/**
 * What a hit costs, in hearts, by what landed it. One heart was the rule for
 * everything, which made a shooter's pellet and a tank's charge the same
 * event; with health fractional the light and the heavy hits can differ by
 * the amount they should. Melee attacks carry their own figure on the spec.
 */
const BULLET_HEARTS: Readonly<Record<string, number>> = {
  shooter: 0.6, orbiter: 0.5, boss: 0.6, summoner: 0.6, turret: 0.6, sentinel: 0.7, lancer: 0.4,
};
const LIGHTNING_HEARTS = 1.2;
/** How long a full chill gauge slows the king, who is never frozen (`applyElementTo`). */
const BOSS_CHILL_SLOW_MS = 3000;

/** What `attacks.ts` lands its damage through. */
function attackHooks(w: World): AttackHooks {
  return {
    hurtPlayer: (x, y, cause, stunMs, hearts) => hurtPlayer(w, x, y, cause, stunMs, hearts),
    playerInvulnerable: () => w.player.invulnMs > 0 || dashInvulnerable(w.player),
    burnPlayer: (amount) => feedBurn(w, amount),
    hatch: (x, y, from) => { hatchMinion(w, x, y, from); },
    knockDown: (e, ms) => {
      e.staggerMs = ms;
      e.stunMs = ms;
      e.attack = "approach";
      e.attackMs = 0;
      e.swing.active = false;
      e.pose = "";
      e.poseMs = 0;
      e.pending = [];
      e.telegraphMs = 0;
      dropToken(w, e);
      dropFireToken(w, e);
    },
  };
}

function hurtPlayer(
  w: World, x: number, y: number, cause: string, stunMs = 0, hearts = 1,
): void {
  const p = w.player;
  if (p.invulnMs > 0 || dashInvulnerable(p)) return;
  /*
   * **A stance takes the hit** (doc 006): the first enemy hit that would
   * land — a body's blade or contact, a shot, anything an enemy did — is
   * cancelled whole (no heart, no shove, no stun, no `retort`, since
   * nothing hurt), the caster is untouchable for a moment, and the stance
   * answers. The room's own hazards are the floor, not an enemy, and a
   * guard does not parry a spike strip.
   */
  if (p.stance && !cause.startsWith("hazard:")) {
    p.invulnMs = Math.max(p.invulnMs, STANCE_GUARD_MS);
    w.events.push({ kind: "spell", x, y, what: "stance_guard" });
    answerStance(w, 1);
    return;
  }
  // Always shorter than the invulnerability it arrives with, so a stun is
  // never a window in which the player is hit again. See `Player.stunMs`.
  if (stunMs > 0) p.stunMs = Math.min(stunMs, INVULN_MS - 120);
  // Invincible still takes the hit — the shove, the frames, the number shown —
  // just not the health.
  const due = Math.min(p.hearts, wholeHp(hearts * w.takenMult * rampFor(w.roomIndex).hurt));
  const taken = w.invincible ? 0 : due;
  p.hearts = Math.max(0, p.hearts - taken);
  // The floor of the bar this room, for the close calls the briefing reports.
  w.stats.heartsLow = Math.min(w.stats.heartsLow, p.hearts);
  p.invulnMs = INVULN_MS * p.mods.invuln;
  /*
   * Shoved off the line they were hit on.
   *
   * Invulnerability alone leaves the player exactly where the hit found them,
   * so the moment it lapses the same stream or the same blade takes the next
   * heart. Being moved is what turns a hit into an event with a recovery,
   * rather than the first of a series. Away from the source, so it reads as
   * the hit doing it.
   */
  const dx = p.x - x;
  const dy = p.y - y;
  const d = Math.hypot(dx, dy) || 1;
  p.hurtX = (dx / d) * HURT_NUDGE;
  p.hurtY = (dy / d) * HURT_NUDGE;
  p.hurtMs = HURT_NUDGE_MS;
  w.stats.heartsLost += taken;
  impact(w, HITSTOP_PLAYER_HIT, TRAUMA_PLAYER_HIT);
  w.events.push({ kind: "player_hit", x, y, what: cause, amount: due });
  hurtFamily(w, cause, taken);
  emit(w, p.x, p.y, "hit", 6);
  // `retort`: a spell with it fires back at whatever did this, free.
  onHurt(w, x, y, hookSim(w));
}

/**
 * The moment of invulnerability a stance buys when it takes a hit (doc 006):
 * long enough to outlast the rest of the blow that was cancelled — a blade's
 * active frames, the second pellet of a pair — and short of a real hit's
 * mercy frames, because nothing was lost.
 */
export const STANCE_GUARD_MS = 400;

/**
 * **The stance answers** (doc 006): a spin slash round the caster, of the
 * spell's damage at `share` of it — the whole of it for a hit taken, the
 * expiry share for a guard that ran out or was dropped by a dash — cutting
 * every body within the answer's radius once, carrying the spell's elements,
 * and staggering what it cuts. The stance ends here: it answers once.
 */
function answerStance(w: World, share: number): void {
  const p = w.player;
  const s = p.stance;
  if (!s) return;
  p.stance = null;
  const damage = s.damage * share;
  let hit = false;
  for (const e of w.enemies) {
    if (!isActive(e) || e.hp <= 0) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > s.radius + e.radius) continue;
    hit = true;
    wake(w, e);
    hurtEnemy(w, e, damage, s.element !== "none" ? s.element : "", p, damage * poiseOfWeight(s.weight));
    w.stats.damageDealt += damage;
    applyElementsTo(e, s.powers, s.statusMult, s.proc);
    e.hitFlashMs = HIT_FLASH_MS;
    if (ENEMIES[e.archetype].behaviour !== "stationary") {
      const push = (KNOCKBACK * s.weight) / Math.max(1, e.radius / 10);
      const nx = d > 1 ? (e.x - p.x) / d : Math.cos(p.facing), ny = d > 1 ? (e.y - p.y) / d : Math.sin(p.facing);
      e.knockX += nx * push;
      e.knockY += ny * push;
    }
    spellStagger(w, e, s.weight);
    w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: e.archetype, amount: damage });
    emit(w, e.x, e.y, "hit", 4);
  }
  if (hit) impact(w, HITSTOP_HIT * 3, TRAUMA_HIT);
  w.events.push({ kind: "spell", x: p.x, y: p.y, what: "stance_answer", amount: share });
}

/** The guard's clock: a stance that runs out with nothing taken answers at its expiry share. */
function stepStance(w: World, dtMs: number): void {
  const s = w.player.stance;
  if (!s) return;
  s.ms -= dtMs;
  if (s.ms <= 0) answerStance(w, s.expireShare);
}

/**
 * Health lost, split by **what took it** — the three families the playtest log
 * already groups causes into, so a log written by the browser and one written
 * by the harness answer "how much of this was ranged" the same way.
 *
 * It is the one thing the player knows about a bad stretch that no other label
 * carries: being shot from across the room and being cut down in melee are
 * different problems with different answers on a reward screen.
 */
function hurtFamily(w: World, cause: string, hearts: number): void {
  if (hearts <= 0) return;
  if (cause.startsWith("melee:") || cause.startsWith("contact:")) w.stats.hurtByMelee += hearts;
  else if (cause.startsWith("hazard:") || cause.startsWith("dot:") || cause.startsWith("status:"))
    w.stats.hurtByHazard += hearts;
  else w.stats.hurtByRanged += hearts;
  /*
   * And by the body itself. The cause already names it — `melee:tank`,
   * `bullet:shooter`, `hazard:lava_channel` — so the attribution costs a
   * split, and it is the difference between telling the Director "melee took
   * three hearts" and telling it which enemy to stop sending.
   */
  const who = cause.includes(":") ? cause.slice(cause.indexOf(":") + 1) : cause;
  if (who) w.stats.hurtByEnemy[who] = (w.stats.hurtByEnemy[who] ?? 0) + hearts;
}

function emit(w: World, x: number, y: number, kind: Particle["kind"], n: number): void {
  let made = 0;
  for (const q of w.particles) {
    if (made >= n) break;
    if (q.alive) continue;
    const a = w.rng.next() * Math.PI * 2;
    const s = 40 + w.rng.next() * 80;
    q.alive = true;
    q.x = x; q.y = y;
    q.vx = Math.cos(a) * s; q.vy = Math.sin(a) * s;
    q.maxLifeMs = kind === "kill" ? 320 : 200;
    q.lifeMs = q.maxLifeMs;
    q.kind = kind;
    made++;
  }
}

function stepParticles(w: World, dtMs: number): void {
  const dt = dtMs / 1000;
  for (const q of w.particles) {
    if (!q.alive) continue;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.vx *= 0.92;
    q.vy *= 0.92;
    q.lifeMs -= dtMs;
    if (q.lifeMs <= 0) q.alive = false;
  }
}

export { SPAWN_FADE_MS, SPAWN_TELEGRAPH_MS };
