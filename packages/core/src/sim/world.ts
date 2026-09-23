/**
 * The fixed-step world (design doc 008). One `step` is 1/60 s of integer
 * milliseconds; nothing here reads a clock, a DOM or a renderer, so the
 * headless harness and the browser run the identical simulation.
 */
import { AFFIXES, ENEMIES } from "../encounters/index.ts";
import { ITEMS, parseCastTree, plainInstance } from "../spells/index.ts";
import type { ItemRegistry } from "../spells/items.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";
import type {
  EncounterPlan, EnemyId, HazardEffect, ItemInstance, RoomPlan, RoomType, Staff, EliteAffix,
} from "../types.ts";
import type { Rng } from "../rng.ts";
import {
  DASH_COOLDOWN_MS, DASH_IFRAME_MS, DASH_MS, DASH_SPEED,
  HURT_NUDGE, HURT_NUDGE_MS, INVULN_MS, MAX_HEARTS, PLAYER_RADIUS, PLAYER_SPEED, noMods, HP_PER_HEART, NO_INPUT,
  STEP_MS, STUN_LIGHTNING_MS,
} from "./types.ts";
import type { Bullet, DeathBurst, Enemy, Input, Particle, PlayerMods, World } from "./types.ts";
import { acquire, makePool, integrate, POOL_SIZES } from "./bullets.ts";
import {
  circleHitsWall, circlesOverlap, entryPosition, hasLineOfSight, moveSliding, normalise,
} from "./collide.ts";
import {
  beginSwing, cancelSwing, makeSwingBox, manaPerHit, sectorHits, snapFacing,
  stepStrike, stepSwing, strikeHits, swingMoveScale, beginSpin,
} from "./melee.ts";
import { FIRE_ENEMY_DAMAGE, lightFire, makeFirePool, makeScorchPool, scorch, stepFires, stepScorches } from "./fire.ts";
import { firePayloadChild, fireUnit } from "./cast.ts";
import {
  onDashThrough, onExpire, onHit, onHurt, onKill, stepWards,
  wallSplitCount, wardStops,
} from "./affix-hooks.ts";
import type { HookSim } from "./affix-hooks.ts";
import { emptyScope } from "../spells/execute.ts";
import {
  AFFIX_SLOTS, SPELL_SLOTS, MANA_REGEN_FRACTION_PER_S, makeSpell, stepSpells, stepEchoes, ENEMY_BUILD_PER_HIT,
} from "./spells.ts";
import { spikesOut } from "../rooms/features.ts";
import { floodFill } from "../rooms/measure.ts";
import {
  breakable, clearPropCell, expiredProps, placeFixtures, placeProps, propHit, stepProps,
  PROP_MANA_FRACTION,
} from "./props.ts";
import { COIN_VALUE, MANA_ORB, drop, makePickupPool, stepPickups } from "./pickups.ts";
import {
  enteredPortal, placePortals, placeReward, raisePortals, stepPortals, stepReward,
} from "./exits.ts";
import type { RoomOffer } from "./exits.ts";
import type { Destructible } from "./props.ts";
import type { SpellSlot } from "./spells.ts";
import type { BulletEmission } from "../encounters/patterns.ts";
import { turnToward } from "./aim.ts";
import { dragStep, onExpansionDeath, stepAttacks } from "./attacks.ts";
import type { AttackHooks } from "./attacks.ts";
import { computeFlowField, tileOf } from "./flow.ts";
import {
  isActive, livingSummoners, makeEnemy, stepEnemy, stagger, wake, dropToken,
  dropFireToken, ARMOUR_BREAK_MS, SPAWN_FADE_MS, SPAWN_TELEGRAPH_MS, ENEMY_FREEZE_MS,
  meleeSpec,
  spikeVolley, release,
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
/** Linear, and fast enough that a quiet second returns the camera to still. */
const TRAUMA_DECAY_PER_S = 1.5;

function impact(w: World, stopMs: number, trauma: number): void {
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
 * How many enemies may be attacking at once, whatever the room holds.
 *
 * Two, which is where the Arkham games sit. Three is defensible and six is
 * not: there is no position that answers six simultaneous commitments, so a
 * room that allows it has one strategy, which is to keep running. See
 * `World.attackTokens`.
 */
const ATTACK_TOKENS = 2;
/**
 * How many steps of the player's path the world remembers, which sets the
 * longest reaction an enemy can have. 24 steps is 400 ms; see `playerTrail`.
 */
const PLAYER_TRAIL_DEPTH = 24;
/**
 * How many ranged bodies may be winding up or shooting at once.
 *
 * Two. It was one, which was correct when the problem was volume and wrong
 * once the other four constraints landed — every shot is now telegraphed,
 * bodies are silent at close range, they cannot fire while repositioning and
 * they aim at a stale position. Stacked with a cap of one, ranged enemies
 * dealt no damage at all. The cap exists so that three shooters are not three
 * times the fire; it does not need to make them harmless.
 */
const FIRE_TOKENS = 2;

export interface CreateWorldOptions {
  readonly room: RoomPlan;
  readonly encounter: EncounterPlan | null;
  readonly staff: Staff;
  readonly slots: readonly (ItemInstance | null)[];
  readonly hearts: number;
  /** What the run has improved about the player; see `PlayerMods`. */
  readonly mods?: PlayerMods;
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
   * these affixes. See `strayEliteFor`.
   */
  readonly strayElite?: readonly EliteAffix[];
  /** Difficulty settings; see `World.dealtMult`. */
  readonly dealtMult?: number;
  readonly takenMult?: number;
  readonly invincible?: boolean;
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
}

/** The three keyed spells drawn from a slot list, padded to `SPELL_SLOTS`. */
/**
 * The three keyed spells, drawn from the staff.
 *
 * **An attack claims the modifiers that follow it**, up to its three slots,
 * until the next attack. That is the one reading of a flat slot list that
 * matches doc 013's "three spells, three affix slots each" without inventing a
 * second data structure for the player to arrange.
 *
 * Before this, every non-passive slot became its own spell — so a boost was a
 * key that did nothing, and it could not reach the attack beside it either.
 * Twenty of the forty items in the pool were inert as a result, which is why
 * `fracture_rune` never split anything and `power_rune` never raised any
 * damage.
 */
function spellsFrom(
  slots: readonly (ItemInstance | null)[], items: ItemRegistry,
): (SpellSlot | null)[] {
  const out: (SpellSlot | null)[] = [];
  let attack: ItemInstance | null = null;
  let mods: ItemInstance[] = [];

  const flush = (): void => {
    if (!attack || out.length >= SPELL_SLOTS) return;
    const spell = makeSpell(attack, items, mods);
    if (spell.unit) out.push(spell);
    attack = null;
    mods = [];
  };

  for (const inst of slots) {
    if (!inst) continue;
    const kind = items.get(inst.base)?.kind;
    // A passive is a stat on the whole staff, not something to press or attach.
    if (kind === "passive") continue;
    if (kind === "attack" || kind === "payload") {
      flush();
      attack = inst;
      continue;
    }
    // A boost or a multicast with no attack yet has nothing to modify; one
    // after an attack is that attack's affix.
    if (attack && mods.length < AFFIX_SLOTS) mods.push(inst);
  }
  flush();

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
  raisePortals(w.portals);
  w.events.push({ kind: "portals_open", x: w.player.x, y: w.player.y });
}

/**
 * Puts an item into the first free staff slot and rebuilds what depends on it.
 *
 * Three things depend on the slots and forgetting any one of them is a silent
 * failure: the parsed cast tree, the three keyed spells, and the slots
 * themselves. Exported as one call so a reward taken mid-run cannot rebuild
 * two of the three — which is the shape of bug that shows up as "the spell I
 * picked up does nothing".
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
  w.tree = parseCastTree(slots, items);
  w.spells = spellsFrom(slots, items);
  return true;
}

export function createWorld(input: CreateWorldOptions): World {
  /*
   * The run's max-mana modifier is applied to the staff here, once. It was
   * recorded (`deep_well` multiplied `mods.manaMax`) and read by nothing, so
   * the stat card said "+18% max mana" and the bar did not move.
   */
  const o: CreateWorldOptions = input.mods && input.mods.manaMax !== 1
    ? { ...input, staff: { ...input.staff, mana_max: Math.round(input.staff.mana_max * input.mods.manaMax) } }
    : input;
  const start = entryPosition(o.room.entry);
  const tree = parseCastTree(o.slots, o.items ?? ITEMS);
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
  const fixtures = placeFixtures(grid, zones);
  const scattered = placeProps(
    grid, o.rng,
    // Clear of the entry and of every spawn point: a prop on a spawn buries
    // an enemy in solid terrain, and one on the entry is an obstacle before
    // the player has seen the room.
    [start, ...o.room.spawn_groups.flatMap((g) => g.cells.map((c) => ({
      x: (c[0] + 0.5) * TILE_PX, y: (c[1] + 0.5) * TILE_PX,
    })))],
    o.props ?? PROPS_PER_ROOM,
  );
  const props = [...fixtures, ...scattered];
  return {
    tick: 0,
    room: { ...o.room, grid, zones },
    props,
    staff: o.staff,
    slots: o.slots,
    tree,
    /*
     * The first three non-passive items become the three keyed spells.
     *
     * Read off the same slot list doc 006 parses into a tree, so the Director
     * and the staff editor keep planning one inventory and nothing has to be
     * planned twice. What changes is only how it is spent: doc 006 cycled the
     * whole list on a held button, and doc 013 binds the first three to keys.
     */
    spells: spellsFrom(o.slots, o.items ?? ITEMS),
    pickups: makePickupPool(),
    gold: 0,
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
    /*
     * The portals exist from the first frame, shut and not yet drawn.
     *
     * Placed at room start rather than when the offer is answered so the
     * geometry is settled with the rest of the room, deterministically for a
     * seed — a layout decided mid-play would differ between a replay and the
     * run it was replaying. They become visible when they are raised, which is
     * the beat the player sees.
     *
     * Placement avoids the spawn groups, which are known now and gone later.
     */
    portals: o.offer
      ? placePortals(
        grid, o.offer.doors, start,
        [
          ...o.room.spawn_groups.flatMap((g) =>
            g.cells.map((c) => ({ x: (c[0] + 0.5) * TILE_PX, y: (c[1] + 0.5) * TILE_PX }))),
          // Never in a zone: a portal standing in a poison pool asks the
          // player to be hurt to leave, and one on a turret mount has a
          // turret on it.
          ...o.room.zones.filter((z) => z.feature !== "none").flatMap((z) =>
            z.cells.map((c) => ({ x: (c[0] + 0.5) * TILE_PX, y: (c[1] + 0.5) * TILE_PX }))),
        ],
        o.rng,
      )
      : [],
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
      castIndex: 0, castTimerMs: 0, cooldownMs: 0,
      firing: false,
      aim: { x: start.x + 1, y: start.y },
      facing: 0,
      dashMs: 0, dashIframeMs: 0, dashCooldownMs: 0, dashX: 0, dashY: 0,
      hurtX: 0, hurtY: 0, hurtMs: 0,
      burnBuild: 0, poisonBuild: 0, burnFedMs: 0, poisonFedMs: 0, burnMs: 0, poisonMs: 0, dotTickMs: 0,
      rage: Math.max(0, Math.min(o.mods?.rageMax ?? Infinity, o.rage ?? 0)), swingStretch: 1, spinTurn: 0, spinBufferMs: 0,
      strikeMs: 0, strikeDamage: 0, strikeRadius: 0, strikeHits: [],
      stunMs: 0, dragMs: 0, dragX: 0, dragY: 0, slowed: false, slipMs: 0, slideX: 0, slideY: 0,
      swingMs: 0, swingFacing: 0,
    },
    enemies: [],
    playerBullets: makePool(POOL_SIZES.player),
    enemyBullets: makePool(POOL_SIZES.enemy),
    particles: Array.from({ length: PARTICLE_POOL }, () => ({
      alive: false, x: 0, y: 0, vx: 0, vy: 0, lifeMs: 0, maxLifeMs: 1, kind: "hit" as const,
    })),
    pendingWaves: chunkWaves((o.encounter?.waves ?? []).map((w) => ({
      atMs: w.at_ms,
      spawns: w.spawns.map((s) => ({ archetype: s.archetype, group: s.spawn_group, count: s.count })),
    }))),
    affixes: o.encounter?.elite_affixes ?? [],
    strayElite: o.strayElite ?? [],
    elitesPlaced: 0,
    affixPlaced: {},
    dealtMult: o.dealtMult ?? 1,
    resonance: [],
    takenMult: o.takenMult ?? 1,
    invincible: o.invincible ?? false,
    events: [],
    stats: { heartsLost: 0, damageDealt: 0, shotsFired: 0, nearMisses: 0, elapsedMs: 0 },
    rng: o.rng,
    nextEnemyId: 1,
    lastWaveMs: -Infinity,
    cleared: false,
    // Charged, so the first step onto a hazard is paid for at once.
    playerTrail: [{ x: start.x, y: start.y }],
    attackTokens: ATTACK_TOKENS,
    fireTokens: FIRE_TOKENS,
    hazardTimerMs: HAZARD_DAMAGE_INTERVAL_MS - HAZARD_GRACE_MS,
    hitstopMs: 0,
    trauma: 0,
    fires: makeFirePool(),
    vortices: Array.from({ length: 6 }, () => ({
      alive: false, x: 0, y: 0, radius: 0, lifeMs: 0, maxLifeMs: 1, pull: 0, tickMs: 0, damage: 0, spellIndex: -1,
    })),
    pets: Array.from({ length: 2 }, () => ({
      alive: false, x: 0, y: 0, vx: 0, vy: 0, facing: 0, lifeMs: 0, maxLifeMs: 1, fireMs: 0,
      intervalMs: 700, damage: 0, range: 0, speed: 0, spellIndex: -1, attackMs: 0,
    })),
    wards: [],
    echoes: [],
    scorches: makeScorchPool(),
    rifts: [], mines: [], tethers: [], lobs: [], slowFields: [], flames: [], deathBursts: [],
    streak: 0, streakMs: 0, quietMs: 0,
    swing: makeSwingBox(),
    flow: null,
    flowTile: null,
  };
}

/** The cells of every zone with a feature in it, as grid indices. */
export /** The share of an elite room's non-heavy bodies that are elite; see the spawn. */
const ELITE_SHARE = 0.35;
const HEAVY_ELITES: ReadonlySet<string> = new Set(["tank", "summoner", "turret", "sentinel"]);

/**
 * A normal room's stray elite: from room 3, about one room in seven has one
 * body that is an elite — a single affix, the enraged tint — so an elite is
 * something a normal room can surprise the player with, not only a door.
 */
export function strayEliteFor(roomIndex: number, rng: { next(): number }): EliteAffix[] {
  if (roomIndex < 3 || rng.next() >= 0.15) return [];
  // Not burning: a stray elite that sets the floor alight turned out to be
  // the largest single source of burn in a run.
  const pool: EliteAffix[] = ["swift", "armored", "volatile"];
  return [pool[Math.floor(rng.next() * pool.length)]!];
}

/**
 * How many lancers an elite room holds at once. Every rusher became one, and
 * with rushers two thirds of a melee roster that was six bodies each firing
 * eight spikes every two seconds: measured, the spikes were a third of all
 * hearts lost in a run. Two is a pair to read; the rest stay rushers.
 */
const LANCER_CAP = 2;

function hazardCells(w: World): Set<number> {
  const out = new Set<number>();
  for (const z of w.room.zones)
    if (z.feature !== "none") for (const c of z.cells) out.add(c[1] * GRID_W + c[0]);
  return out;
}

/** No enemies, no pending waves and no summoner alive (doc 003). */
export function worldCleared(w: World): boolean {
  // A burst still hanging is part of the fight: the room clears once it has flown.
  return w.enemies.length === 0 && w.pendingWaves.length === 0 && livingSummoners(w) === 0
    && w.deathBursts.length === 0;
}

export function step(w: World, input0: Input, dtMs = STEP_MS, items: ItemRegistry = ITEMS): World {
  w.events.length = 0;
  w.tick++;
  // A dead player does nothing: no moving, swinging, casting or dodging.
  const input: Input = w.player.hearts > 0 ? input0 : NO_INPUT;

  // Trauma decays on the wall clock, so the camera keeps settling through a
  // freeze rather than holding a shake that never resolves.
  w.trauma = Math.max(0, w.trauma - TRAUMA_DECAY_PER_S * (dtMs / 1000));

  // The freeze holds everything: bodies, bullets, timers. Held for a frame or
  // three it reads as the hit having weight, not as the game hitching.
  if (w.hitstopMs > 0) {
    w.hitstopMs -= dtMs;
    return w;
  }

  // Counted after the freeze, because a frozen frame is presentation, not
  // game time. Charging it to the room would make every measurement of how
  // long a fight takes a measurement of how many hits landed in it.
  w.stats.elapsedMs += dtMs;

  stepPlayer(w, input, dtMs);
  refreshFlow(w);
  releaseWaves(w);

  resolveSwing(w, dtMs);
  resolveFires(w, dtMs);
  resolveStrikes(w, dtMs);
  // The expansion's rifts, mines, tethers, lobs, fields and discs.
  stepAttacks(w, dtMs, attackHooks(w));
  stepDeathBursts(w, dtMs);

  /*
   * Doc 013 replaces the held fire button with three keys. `stepCast`'s
   * auto-cycling tree is no longer stepped for the player: the sword is the
   * basic attack now, and a staff that fires on its own while the player is
   * swinging is a second basic attack competing with the first.
   */
  // A stun silences the spells too, or it would only be a movement penalty.
  const cast = stepSpells(
    w, items, dtMs, w.player.stunMs > 0 ? null : input.spell ?? null,
  );
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
  for (const e of w.enemies) stepEnemy(w, e, dtMs);
  for (const e of w.enemies) if (e.archetype === "boss" && e.hp > 0) stepBoss(w, e, dtMs);
  resolveBodies(w);
  w.enemies = w.enemies.filter((e) => {
    if (e.hp > 0) return true;
    onEnemyKilled(w, e);
    return false;
  });

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
  stepStatuses(w, dtMs);
  stepDashStrike(w, dtMs);
  stepVortices(w, dtMs);
  stepPets(w, dtMs, items);
  stepWards(w, dtMs);
  slipstream(w);
  stepParticles(w, dtMs);
  if (w.streakMs > 0) w.streakMs -= dtMs;
  stepQuiet(w, dtMs);

  if (!w.cleared && worldCleared(w)) {
    w.cleared = true;
    w.events.push({ kind: "room_cleared", x: w.player.x, y: w.player.y });
    if (w.offer && w.offer.cards.length > 0) {
      w.rewardPending = true;
      w.rewardDrop = placeReward(w.room.grid, w.offer.cards[0]!.kind, hazardCells(w));
      w.events.push({
        kind: "reward_shown", x: w.rewardDrop.x, y: w.rewardDrop.y,
        what: w.rewardDrop.kind,
      });
    } else if (w.offer) {
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

function nearestFreeCell(
  w: World, cell: readonly [number, number], taken: Set<number>,
): readonly [number, number] {
  const reach = reachableFloor(w);
  const ok = (x: number, y: number): boolean => {
    if (x < 1 || y < 1 || x >= GRID_W - 1 || y >= GRID_H - 1) return false;
    const key = y * GRID_W + x;
    return w.room.grid[key] === Tile.Floor && !taken.has(key) && reach[key] === 1;
  };
  if (ok(cell[0], cell[1])) return cell;
  for (let r = 1; r <= 4; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cell[0] + dx;
        const y = cell[1] + dy;
        if (ok(x, y)) return [x, y];
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
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const tx = cell[0] + dx;
      const ty = cell[1] + dy;
      if (tx < 1 || ty < 1 || tx >= GRID_W - 1 || ty >= GRID_H - 1) continue;
      const key = ty * GRID_W + tx;
      if (taken.has(key)) continue;
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
  w.flow = computeFlowField(w.room.grid, w.player.x, w.player.y);
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
    p.dashMs = DASH_MS;
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
  if (spun) p.spinBufferMs = 0;
  else {
    p.spinBufferMs = Math.max(0, p.spinBufferMs - dtMs);
    if (input.swing && !stunned) beginSwing(p, w);
  }

  const dashing = p.dashMs > 0;
  // A swing only ever slows the player and never pushes them. Forced
  // displacement reads as losing control, whichever direction it is in.
  const speed = (dashing ? DASH_SPEED * p.mods.dashRange : PLAYER_SPEED * p.mods.speed)
    * swingMoveScale(p)
    // Poisoned: a quarter off, for as long as it lasts.
    * (p.poisonMs > 0 && !dashing ? POISON_SLOW : 1)
    // A bellringer's slow field: a quarter off while inside it.
    * (p.slowed && !dashing ? 0.75 : 1);
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
  p.firing = input.fire;
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
    hurtEnemy(w, e, box.damage, e.awake ? "" : "sneak", w.player);
    w.stats.damageDealt += box.damage;
    e.hitFlashMs = HIT_FLASH_MS;
    // The sword fills the rage gauge: a little per connecting blow, more for
    // the one that kills. A spin's own hits do not refund it.
    if (w.player.swingStretch === 1)
      gainRage(w, e.hp <= 0 ? RAGE_PER_KILL : RAGE_PER_HIT);
    resonate(w, e);

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

    // Being hit is the loudest way to be noticed, and it interrupts whatever
    // the body was doing — which is most of why a hit reads as landing.
    wake(w, e);
    stagger(w, e);
    impact(w, HITSTOP_HIT, TRAUMA_HIT);

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
    damageProp(w, p, box.damage);
  }
}

/** Prop dedup ids, below the player's, so one list serves both. */
const PROP_HIT_ID_BASE = -2;

/**
 * Damage to an enemy, armour first.
 *
 * Centralised because armour has to be honoured wherever damage comes from,
 * and it arrives from five places: the sword, player bullets, burning ground,
 * a lightning strike and the burn tick. Applying it at one of them and not the
 * others is how a rule becomes a suggestion.
 *
 * Returns whether the armour broke on this hit, which is its own moment: the
 * player has just earned the right to interrupt this body, and that has to be
 * announced rather than inferred from the body suddenly flinching.
 */
/**
 * `tag` says what dealt it, for the damage number's colour: an element
 * (fire, ice, poison) or a spell school, or nothing for the sword.
 */
function hurtEnemy(
  w: World, e: Enemy, raw: number, tag = "", from?: { x: number; y: number },
): { broke: boolean } {
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
  // Damage is a whole number: rounded down, never below one.
  const amount = raw > 0 ? Math.max(1, Math.floor(raw * mult * w.dealtMult)) : 0;
  if (amount > 0)
    w.events.push({ kind: "damage", x: e.x, y: e.y - e.radius, what: `${e.armour > 0 ? "armour" : "hp"}${tag ? `:${tag}` : ""}`, amount });
  if (e.armour > 0) {
    e.armour -= amount;
    if (e.armour > 0) return { broke: false };
    // Overkill carries into health, so armour never converts a big hit into a
    // small one by absorbing all of it.
    const spill = -e.armour;
    e.armour = 0;
    e.hp -= spill;
    e.armourBreakMs = ARMOUR_BREAK_MS;
    // A break is worth more than the hit that caused it: the fight changes.
    impact(w, HITSTOP_KILL, TRAUMA_KILL);
    w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: `armour_break:${e.archetype}` });
    emit(w, e.x, e.y, "kill", 8);
    return { broke: true };
  }
  e.hp -= amount;
  return { broke: false };
}

function damageProp(w: World, p: Destructible, amount: number): void {
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
   * use the lane immediately, and the player is paid in mana.
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
  if (p.kind !== "pillar") {
    w.player.mana = Math.min(
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
function resolveFires(w: World, dtMs: number): void {
  stepScorches(w, dtMs);
  const { enemies, playerBurning } = stepFires(w, dtMs);
  if (playerBurning) feedBurn(w, BURN_BUILD_PER_S * (dtMs / 1000));
  for (const { id, damage } of enemies) {
    const e = w.enemies.find((x) => x.id === id);
    if (!e || e.hp <= 0) continue;
    // Burning ground feeds a cinderling rather than hurting it, and sets it alight.
    if (e.archetype === "cinderling") {
      e.hp = Math.min(e.maxHp, e.hp + damage);
      e.burnMs = Math.max(e.burnMs, 1500);
      e.burnBuild = Math.min(1, e.burnBuild + 0.25);
      continue;
    }
    hurtEnemy(w, e, damage, "fire");
    e.hitFlashMs = HIT_FLASH_MS;
    w.stats.damageDealt += damage;
    w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "fire" });
    // See `resolveSwing`: the death filter owns the kill.
  }
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
    impact(w, HITSTOP_HIT, TRAUMA_KILL);
    w.events.push({ kind: "hazard_tick", x: s.x, y: s.y, what: "lightning" });
    emit(w, s.x, s.y, "hit", 6);
    if (strikeHits(s, w.player.x, w.player.y, PLAYER_RADIUS)) {
      hurtPlayer(w, w.player.x, w.player.y, "lightning", STUN_LIGHTNING_MS, LIGHTNING_HEARTS);
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
/** ...but never waits longer than this past its time, so a room cannot stall. */
const WAVE_GATE_MAX_WAIT_MS = 16000;
/**
 * Waves after the opening never land closer together than this, gate or no
 * gate. Chunks cut from one planned wave share a time, so when the ceiling
 * released one it released the rest on the following frames — two waves
 * arriving as one, which is exactly what the gate exists to prevent.
 */
const WAVE_MIN_GAP_MS = 3500;

/**
 * Splits any wave larger than `WAVE_CHUNK` into consecutive waves at the same
 * time, which the live gate then spaces out. The plan's roster and order are
 * kept; only how many arrive together changes.
 */
function chunkWaves(waves: World["pendingWaves"]): World["pendingWaves"] {
  const out: World["pendingWaves"] = [];
  for (const wave of waves) {
    const flat: { archetype: EnemyId; group: string }[] = [];
    for (const s of wave.spawns) for (let i = 0; i < s.count; i++) flat.push({ archetype: s.archetype, group: s.group });
    for (let i = 0; i < flat.length; i += WAVE_CHUNK) {
      const slice = flat.slice(i, i + WAVE_CHUNK);
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

function releaseWaves(w: World): void {
  /*
   * One wave at a time. The first wave stands with the room; every later
   * one waits for its time **and** for the floor to thin to `WAVE_GATE_ALIVE`
   * bodies, with a ceiling on the wait so a room whose survivors hide cannot
   * hold the next wave forever.
   */
  const alive = w.enemies.filter((e) => e.hp > 0).length;
  // The first step: `elapsedMs` has already advanced by the time waves release.
  const opening = w.tick <= 1;
  if (!opening && w.stats.elapsedMs - w.lastWaveMs < WAVE_MIN_GAP_MS) return;
  const due = w.pendingWaves.filter((wave) => {
    if (wave.atMs > w.stats.elapsedMs) return false;
    if (opening && wave.atMs <= 0) return true;
    return alive <= WAVE_GATE_ALIVE || w.stats.elapsedMs - wave.atMs >= WAVE_GATE_MAX_WAIT_MS;
  });
  // One chunk per release, opening or not.
  const release = due.slice(0, 1);
  if (release.length === 0) return;
  if (!opening) w.lastWaveMs = w.stats.elapsedMs;
  w.pendingWaves = w.pendingWaves.filter((wave) => !release.includes(wave));
  const dueWaves = release;

  // Cells already claimed this room, so nothing stacks on anything.
  const taken = new Set<number>(
    w.enemies.map((e) => Math.floor(e.y / TILE_PX) * GRID_W + Math.floor(e.x / TILE_PX)),
  );
  for (const wave of dueWaves) {
    for (const spawn of wave.spawns) {
      const group = w.room.spawn_groups.find((g) => g.id === spawn.group) ?? w.room.spawn_groups[0];
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
      const mounts = spawn.archetype === "turret" || spawn.archetype === "sentinel" ? turretMounts(w) : [];
      for (let i = 0; i < spawn.count; i++) {
        const mount = mounts.find((c) => !taken.has(c[1] * GRID_W + c[0]));
        const cell = mount ?? group.cells[i % group.cells.length]!;
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
          if (w.elitesPlaced === 0 || HEAVY_ELITES.has(spawn.archetype) || w.rng.next() < ELITE_SHARE) affixes = w.affixes;
        } else if (w.strayElite.length > 0 && w.elitesPlaced === 0 && w.rng.next() < 0.35) affixes = w.strayElite;
        // Doc 001's per-room caps (`AFFIXES[id].max_enemies`): `shielded` on one
        // body, `volatile` on two. A capped affix is left off the next body.
        affixes = affixes.filter((id) => {
          const cap = AFFIXES[id].max_enemies;
          return cap === null || (w.affixPlaced[id] ?? 0) < cap;
        });
        for (const id of affixes) w.affixPlaced[id] = (w.affixPlaced[id] ?? 0) + 1;
        if (affixes.length > 0) w.elitesPlaced++;
        const lancers = w.enemies.filter((x) => x.archetype === "lancer" && x.hp > 0).length;
        const archetype = spawn.archetype === "rusher" && affixes.length > 0 && lancers < LANCER_CAP
          ? "lancer" : spawn.archetype;
        const e = makeEnemy(w.nextEnemyId++, archetype, at.x, at.y, affixes);
        // Facing the player from its first frame, not the default east.
        e.facing = Math.atan2(w.player.y - e.y, w.player.x - e.x);
        /*
         * The first wave is **already there** when the player walks in. The
         * telegraph and the climb are for bodies that arrive during a fight;
         * a room whose opening roster grows out of the floor in front of the
         * player reads as an ambush that was not planned as one.
         */
        if (wave.atMs <= 0 && opening) e.spawnFadeMs = 0;
        w.enemies.push(e);
      }
    }
    w.events.push({ kind: "wave_spawned", x: w.player.x, y: w.player.y, amount: wave.spawns.length });
  }
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
  // Otherwise a room whose attackers all died would have no turns left in it
  // and every survivor would circle forever.
  dropToken(w, e);
  dropFireToken(w, e);
  onExpansionDeath(w, e);
  dropLoot(w, e.x, e.y, ENEMIES[e.archetype].threat_weight >= 4 ? 2 : 1);
  killPays(w, e);
  impact(w, HITSTOP_KILL, TRAUMA_KILL);
  w.events.push({ kind: "enemy_killed", x: e.x, y: e.y, what: e.archetype, facing: e.facing });
  emit(w, e.x, e.y, "kill", 8);
  if (e.affixes.includes("splitting") && e.archetype !== "rusher") {
    for (let i = 0; i < 2; i++)
      w.enemies.push(makeEnemy(w.nextEnemyId++, "rusher", e.x + (i ? 12 : -12), e.y, []));
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
  // on a rusher still standing would not have ended.
  if (e.archetype === "boss")
    for (const other of w.enemies) if (other !== e && other.hp > 0) other.hp = 0;
}

/*
 * The boss's **signature moves**, one at a time, between its walking,
 * swinging and shooting (see doc 005, "Boss"):
 *
 * - **Slam**: it plants, a red ring grows round it, and a shockwave ring of
 *   shots goes out from just beyond its body. The safe place is *in* — next
 *   to it — which is the one move in the game that asks the player to close.
 *   Phase III slams twice, the second ring offset into the first's gaps.
 * - **Leap** (phase II on): it marks the player's spot, goes up — nothing
 *   hits it in the air — and comes down there with a smaller ring. The
 *   answer is to leave the mark, and the landing is the punish window.
 * - **Adds**: two bodies at each phase change, so phase II and III open with
 *   a kill-order question.
 *
 * Every move has a telegraph at least 0.6 s long, and nothing tracks once
 * it is committed.
 */
const BOSS_MOVES: Readonly<Record<number, readonly ("slam" | "leap")[]>> = {
  1: ["slam"],
  2: ["slam", "leap"],
  3: ["leap", "slam", "slam", "leap"],
};
const BOSS_MOVE_GAP_MS: Readonly<Record<number, number>> = { 1: 4200, 2: 3400, 3: 2600 };
export const BOSS_SLAM_MS = 700;
export const BOSS_LEAP_MS = 1300;
/** Of the leap, the part spent rising before it is out of reach. */
export const BOSS_LEAP_RISE_MS = 260;
/*
 * The shockwave starts here, so everything inside is safe. It was 30 — inside
 * the boss's own body — and the "come closer" answer did not exist: the sword
 * swings from 50 to 70 px out, exactly where the ring was born. At 64 the
 * sword's own range is the safe place.
 */
export const BOSS_SLAM_SAFE_PX = 64;
export const BOSS_LEAP_RADIUS = 46;
const BOSS_ADDS: Readonly<Record<number, readonly EnemyId[]>> = {
  2: ["rusher", "rusher"],
  3: ["lancer", "shooter"],
};

function bossRing(w: World, e: Enemy, count: number, speed: number, offsetDeg: number): void {
  const ring: BulletEmission[] = [];
  for (let i = 0; i < count; i++)
    ring.push({
      size: 1.1, at_ms: 0, aim: "fixed:0", angle_deg: offsetDeg + (360 / count) * i,
      speed, from: "ring", path: [0, i],
    });
  release(w, e, ring, BOSS_SLAM_SAFE_PX);
}

function stepBoss(w: World, e: Enemy, dtMs: number): void {
  if (!isActive(e) && !e.airborne) return;
  if (!e.awake) return;
  // Adds at a phase change, once per phase.
  const addsFor = BOSS_ADDS[e.phase];
  if (addsFor && e.bossAddsPhase < e.phase) {
    e.bossAddsPhase = e.phase;
    addsFor.forEach((id, i) => {
      const a = (i / addsFor.length) * Math.PI * 2 + Math.PI / 4;
      const [gx, gy] = nearestFloor(w, e.x + Math.cos(a) * 70, e.y + Math.sin(a) * 70);
      const add = makeEnemy(w.nextEnemyId++, id, (gx + 0.5) * TILE_PX, (gy + 0.5) * TILE_PX, []);
      add.awake = true;
      w.enemies.push(add);
    });
  }

  if (e.bossCast === "none") {
    if (e.attack !== "approach") return;
    e.bossMoveMs -= dtMs;
    if (e.bossMoveMs > 0) return;
    const list = BOSS_MOVES[e.phase] ?? BOSS_MOVES[1]!;
    const step = e.bossMoveIndex;
    const move = list[step % list.length]!;
    e.bossMoveIndex = step + 1;
    e.bossCast = move;
    e.bossCastMs = move === "slam" ? BOSS_SLAM_MS : BOSS_LEAP_MS;
    e.pending = [];
    e.telegraphMs = 0;
    dropFireToken(w, e);
    if (move === "leap") {
      e.bossTargetX = w.player.x;
      e.bossTargetY = w.player.y;
    }
    w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: `boss_${move}` });
    return;
  }

  const before = e.bossCastMs;
  e.bossCastMs -= dtMs;
  if (e.bossCast === "slam") {
    // Phase III: a second ring into the first's gaps, a beat later.
    if (e.phase >= 3 && before > -260 && e.bossCastMs <= -260) bossRing(w, e, 12, 115, 15);
    if (before > 0 && e.bossCastMs <= 0) {
      bossRing(w, e, e.phase >= 2 ? 14 : 12, 120, 0);
      impact(w, HITSTOP_HIT, 0);
      w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "boss_slam" });
    }
    if (e.bossCastMs <= (e.phase >= 3 ? -300 : 0)) finishBossMove(e);
    return;
  }
  // Leap.
  e.airborne = e.bossCastMs < BOSS_LEAP_MS - BOSS_LEAP_RISE_MS && e.bossCastMs > 0;
  if (before > 0 && e.bossCastMs <= 0) {
    const [gx, gy] = nearestFloor(w, e.bossTargetX, e.bossTargetY);
    e.x = (gx + 0.5) * TILE_PX;
    e.y = (gy + 0.5) * TILE_PX;
    e.airborne = false;
    impact(w, HITSTOP_KILL, 0);
    w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "boss_land" });
    if (Math.hypot(w.player.x - e.x, w.player.y - e.y) <= BOSS_LEAP_RADIUS + PLAYER_RADIUS)
      hurtPlayer(w, e.x, e.y, "melee:boss", 0, 1.4);
    bossRing(w, e, 8, 110, 22);
    w.flow = null;
    w.flowTile = null;
  }
  // The landing is the opening: it stays down for half a second.
  if (e.bossCastMs <= -500) finishBossMove(e);
}

function finishBossMove(e: Enemy): void {
  e.bossCast = "none";
  e.bossCastMs = 0;
  e.airborne = false;
  e.bossMoveMs = BOSS_MOVE_GAP_MS[e.phase] ?? 3400;
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
    spikeVolley(w, body, DEATH_BURST_SPEED[d.kind], d.kind === "lance" ? 0.8 : 0.9, d.reach + 4);
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
 */
export const ENEMY_BURN_MS = 3000;
export const ENEMY_POISON_MS = 4000;

function applyElement(e: Enemy, b: Bullet): void {
  const add = ENEMY_BUILD_PER_HIT * Math.max(0.5, b.elementPower || 1);
  if (b.element === "fire") {
    if (e.burnMs > 0) {
      e.burnMs = Math.min(ENEMY_BURN_MS, e.burnMs + ENEMY_BURN_MS * add * 0.6);
      e.burnSources = Math.min(4, e.burnSources + 1);
      return;
    }
    e.burnBuild = Math.min(1, e.burnBuild + add);
    e.buildFedMs = 600;
    if (e.burnBuild >= 1) { e.burnMs = ENEMY_BURN_MS; e.burnSources = 1; e.burnBuild = 1; }
  } else if (b.element === "poison") {
    if (e.poisonMs > 0) {
      e.poisonMs = Math.min(ENEMY_POISON_MS, e.poisonMs + ENEMY_POISON_MS * add * 0.6);
      e.poisonStacks = Math.min(5, e.poisonStacks + 1);
      return;
    }
    e.poisonBuild = Math.min(1, e.poisonBuild + add);
    e.buildFedMs = 600;
    if (e.poisonBuild >= 1) { e.poisonMs = ENEMY_POISON_MS; e.poisonStacks = 2; e.poisonBuild = 1; }
  } else if (b.element === "ice") {
    // Ice builds too: each hit slows, a full gauge freezes.
    if (e.frozenMs > 0) return;
    e.chillBuild = Math.min(1, e.chillBuild + add);
    e.buildFedMs = 600;
    e.slowMs = 1500;
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
 * `Bullet.split` was set from the item mods and **read by nothing**, so
 * `fracture_rune` — "splits projectiles after it into fragments when they die"
 * — had no effect whatsoever. Same class of defect as the multicast items:
 * authored content wired to a mechanism that was never written, invisible
 * because the item still appeared in offers and still cost mana.
 *
 * The fragments are deliberately weak and short-lived. What splitting buys is
 * **coverage**, not damage: the parent's damage is divided rather than copied,
 * so a fork is a decision to hit more things for less each, which is the trade
 * that makes it a choice against a straight damage upgrade.
 *
 * They also carry `split: 0`. A fragment that forks again is a chain reaction
 * that ends in the bullet cap, and the cap is shared with everything else the
 * player has in the air.
 */
const SPLIT_ARC_DEG = 54;
const SPLIT_LIFE = 0.45;

function splitBullets(w: World, dead: readonly Bullet[]): void {
  for (const parent of dead) {
    const n = parent.split | 0;
    if (n <= 0) continue;
    const speed = Math.hypot(parent.vx, parent.vy) || 1;
    const heading = Math.atan2(parent.vy, parent.vx);
    const spread = (SPLIT_ARC_DEG * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const child = acquire(w.playerBullets, false);
      if (!child) return;
      // Fanned evenly about the parent's heading, so the pattern reads as one
      // thing coming apart rather than as a fresh volley.
      const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      const angle = heading + t * spread;
      child.alive = true;
      child.x = parent.x;
      child.y = parent.y;
      child.vx = Math.cos(angle) * speed;
      child.vy = Math.sin(angle) * speed;
      child.radius = Math.max(2, parent.radius * 0.7);
      child.damage = Math.max(1, Math.round(parent.damage / n));
      child.lifeMs = parent.lifeMs > 0 ? parent.lifeMs : 1000 * SPLIT_LIFE;
      child.lifeMs = 1000 * SPLIT_LIFE;
      child.element = parent.element;
      child.elementPower = parent.elementPower;
      child.split = 0;
      child.pierce = 0;
      child.bounce = 0;
      child.homing = 0;
      child.payloadUnit = null;
      child.passthrough = false;
      // The shards **carry on forward** past whatever the parent hit. Letting
      // them re-hit the same body would make a fork a damage multiplier on
      // one target, which is a different and much duller item than one that
      // turns a single shot into a reason to fight things in a line.
      child.hitIds = [...parent.hitIds];
      child.affixes = parent.affixes;
      child.spellIndex = parent.spellIndex;
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
const SHATTER_MULT = 3;

/** What a player shot's damage number is coloured by: its element, else its spell's school. */
function damageTag(_w: World, b: Bullet): string {
  // Only the three elements are coloured; lightning is not an element.
  return b.element && b.element !== "none" ? b.element : "";
}

function hookSim(w: World): HookSim {
  return {
    hurt: (e, amount) => {
      hurtEnemy(w, e, amount);
      // Counted like every other hit: a mark's detonation or a harvest burst is damage the player dealt.
      w.stats.damageDealt += amount;
      e.hitFlashMs = HIT_FLASH_MS;
    },
    fire: (unit, origin, target) => {
      fireUnit(w, unit, emptyScope(), ITEMS, [], origin, target);
    },
  };
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

/** How often an orbiting blade may hit the same body: about twice a second. */
const ORBIT_REHIT_MS = 450;

function stepPlayerBullets(w: World, dtMs: number, items: ItemRegistry): void {
  /*
   * Orbiting shots are placed, not flown: on their circle round the player,
   * with a tangential velocity so a hit still knocks the body the way the
   * blade was moving. The rehit clock clears the hit list so a body that
   * stays in the ring keeps paying.
   */
  for (const b of w.playerBullets) {
    if (!b.alive || b.orbitMs <= 0) continue;
    const step = (b.orbitDegPerS * Math.PI / 180) * (dtMs / 1000);
    b.orbitAngle += step;
    b.x = w.player.x + Math.cos(b.orbitAngle) * b.orbitRadius;
    b.y = w.player.y + Math.sin(b.orbitAngle) * b.orbitRadius;
    const tangential = b.orbitRadius * (b.orbitDegPerS * Math.PI / 180);
    b.vx = -Math.sin(b.orbitAngle) * tangential;
    b.vy = Math.cos(b.orbitAngle) * tangential;
    if (b.rehitMs <= 0) { b.hitIds.length = 0; b.rehitMs = ORBIT_REHIT_MS; }
  }

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
    if (!b.alive) continue;
    for (const e of w.enemies) {
      if (!isActive(e) || e.hp <= 0) continue;
      if (b.hitIds.includes(e.id)) continue;
      if (!circlesOverlap(b.x, b.y, b.radius, e.x, e.y, e.radius)) continue;

      // Being shot is the loudest way to be noticed. A sleeping enemy that
      // keeps dozing under fire is worse than having no aggro range at all,
      // and this also wakes its neighbours, so a sniped group turns together.
      const unaware = !e.awake;
      wake(w, e);

      const immune = e.affixes.includes("shielded") && b.element !== "none";
      if (!immune) {
        // What the spell had attached fires here: an arc to the next body, or
        // a mark. Before the damage, so a detonation sees the body it is on.
        onHit(w, b, e, hookSim(w));
        // From where the shot came, a body-length back along its travel.
        const sp = Math.hypot(b.vx, b.vy) || 1;
        hurtEnemy(w, e, b.damage, unaware ? "sneak" : damageTag(w, b), { x: b.x - (b.vx / sp) * 24, y: b.y - (b.vy / sp) * 24 });
        if (e.hp <= 0) onKill(w, b, e, hookSim(w));
        w.stats.damageDealt += b.damage;
        applyElement(e, b);
        e.hitFlashMs = HIT_FLASH_MS;
        // A hit that does not move the target reads as no hit at all.
        const speed = Math.hypot(b.vx, b.vy) || 1;
        const push = (KNOCKBACK * (b.weight || 1)) / Math.max(1, e.radius / 10);
        e.knockX += (b.vx / speed) * push;
        e.knockY += (b.vy / speed) * push;
        // A heavy shot lands like one: a longer freeze, the room shakes, grit.
        if ((b.weight || 1) > 1) {
          impact(w, HITSTOP_HIT * (1 + b.weight), TRAUMA_HIT * 1.8 * b.weight);
          emit(w, b.x, b.y, "kill", 6);
          w.events.push({ kind: "hazard_tick", x: b.x, y: b.y, what: "heavy_hit" });
        } else impact(w, HITSTOP_HIT, TRAUMA_HIT);
      }
      w.events.push({ kind: "enemy_hit", x: b.x, y: b.y, what: e.archetype, amount: b.damage });
      emit(w, b.x, b.y, "hit", 4);
      b.hitIds.push(e.id);

      if (b.payloadUnit) {
        // A carrier triggers exactly once, however many bodies it pierces.
        for (const _ of firePayloadChild(w, b.payloadUnit, b.x, b.y, items)) void _;
        b.payloadUnit = null;
        if (!b.passthrough) { b.alive = false; break; }
      }
      if (b.pierce > 0) b.pierce--;
      else if (!b.passthrough) {
        b.alive = false;
        // Dying on a body is dying. Splitting only on expiry would make the
        // fork worthless against exactly what the player aims at.
        splitBullets(w, [b]);
        break;
      }
    }
  }

  // The player's own projectiles break scenery too. This was written and only
  // wired to the enemy pool, so a spell aimed at a crate was absorbed by it
  // and nothing happened — which reads as the spell being broken.
  bulletsBreakProps(w, [...expired, ...hitWall], (b) => b.damage);

  // `bloom` leaves a field where a shot ran out; `shatter` breaks it on a wall.
  // The split itself already exists and only needs the count.
  // "Where the shot runs out" is anywhere it ended without finding a body: a
  // shot that stops on a wall has run out just as surely as one that timed
  // out, and at this room size nearly every miss ends on a wall.
  for (const b of expired) onExpire(w, b);
  for (const b of hitWall) { onExpire(w, b); b.split = Math.max(b.split, wallSplitCount(b)); }
  for (const b of hitWall)
    w.events.push({ kind: "bullet_wall", x: b.x, y: b.y, what: `player:${b.element}`, facing: Math.atan2(b.vy, b.vx) });
  splitBullets(w, [...expired, ...hitWall]);

  // on_expire and on_wall carriers cast where they stopped.
  for (const b of [...expired, ...hitWall])
    if (b.payloadUnit) {
      firePayloadChild(w, b.payloadUnit, b.x, b.y, items);
      b.payloadUnit = null;
    }
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
  );
  for (const p of taken) {
    if (p.kind === "heart") {
      w.player.hearts = Math.min(MAX_HEARTS + w.player.mods.maxHearts, w.player.hearts + 1);
      emit(w, p.x, p.y, "heal", 5);
    } else if (p.kind === "mana") {
      w.player.mana = Math.min(w.staff.mana_max, w.player.mana + MANA_ORB);
      emit(w, p.x, p.y, "pickup", 2);
    } else {
      w.gold += COIN_VALUE;
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
 * It paid like a quarter of a kill — one coin from one pot in eight — which
 * made pots not worth the swing, and a breakable the player learns to walk
 * past is furniture with a health bar. Four pots in five now scatter one to
 * three coins, which is a handful on the floor without any new art: the
 * coins are the coin sprite, thrown a little apart. Hearts do not come from
 * scenery; a heart is something a fight pays.
 */
const PROP_COIN_CHANCE = 0.8;

function dropPropLoot(w: World, x: number, y: number): void {
  if (w.rng.next() >= PROP_COIN_CHANCE) return;
  const coins = 1 + Math.floor(w.rng.next() * 3);
  for (let i = 0; i < coins; i++) drop(w.pickups, "coin", x, y, w.rng);
}

/**
 * **Every kill pays** — beyond the chance of a coin or a heart, which was
 * nearly all a kill was worth, and a kill that pays nothing is a toll.
 *
 * - **Mana orbs**, always: one, plus one for a heavy body and two for an
 *   elite. They refund the spells, so killing is what fuels casting.
 * - **Coins** from an elite, always two: the harder body is the one worth
 *   going for.
 * - **A streak**: a third kill inside two seconds of the last one, and every
 *   kill after it, banks extra rage — so clearing a pack fast is how the spin
 *   comes round.
 */
function killPays(w: World, e: Enemy): void {
  if (e.archetype === "boss") return;
  const elite = e.affixes.length > 0;
  // Orbs from the bodies worth them — a heavy one, an elite — not from every
  // kill: an orb on every body paid more mana than the sword did (doc 013).
  const orbs = (ENEMIES[e.archetype].threat_weight >= 2 ? 1 : 0) + (elite ? 2 : 0);
  for (let i = 0; i < orbs; i++) drop(w.pickups, "mana", e.x, e.y, w.rng);
  if (elite) for (let i = 0; i < 2; i++) drop(w.pickups, "coin", e.x, e.y, w.rng);
  w.streak = w.streakMs > 0 ? w.streak + 1 : 1;
  w.streakMs = STREAK_MS;
  if (w.streak >= 3) {
    gainRage(w, STREAK_RAGE);
    w.events.push({ kind: "pickup", x: e.x, y: e.y, what: "streak", amount: w.streak });
  }
}

/**
 * **A quiet room wakes its sleepers.** When everything awake is dead and the
 * bodies left have not noticed the player, they notice the silence: after a
 * few seconds the one nearest the player wakes, and its alarm spreads. A
 * sleeper is a body the player may reach first; it is never a room that
 * cannot end.
 */
function stepQuiet(w: World, dtMs: number): void {
  const live = w.enemies.filter((e) => e.hp > 0 && e.spawnFadeMs <= 0);
  // Only once the fight has started: a room nobody has touched is not quiet, it is waiting.
  if (live.length === 0 || live.some((e) => e.awake) || w.pendingWaves.length > 0 || w.stats.damageDealt <= 0) {
    w.quietMs = 0;
    return;
  }
  w.quietMs += dtMs;
  if (w.quietMs < QUIET_WAKE_MS) return;
  w.quietMs = 0;
  const p = w.player;
  const nearest = live.reduce((a, b) => (Math.hypot(a.x - p.x, a.y - p.y) <= Math.hypot(b.x - p.x, b.y - p.y) ? a : b));
  wake(w, nearest);
}

const QUIET_WAKE_MS = 4000;

/** Kills this close together count as one streak. */
const STREAK_MS = 2000;
const STREAK_RAGE = 0.25;

function dropLoot(w: World, x: number, y: number, weight: number): void {
  const roll = w.rng.next();
  /*
   * A heart only when the player has somewhere to put it.
   *
   * Not merely because a wasted drop is wasted: a heart on the floor is a
   * promise, and one the player cannot take teaches them to ignore the next.
   */
  if (w.player.hearts < MAX_HEARTS + w.player.mods.maxHearts && roll < HEART_CHANCE * weight) {
    drop(w.pickups, "heart", x, y, w.rng);
    return;
  }
  if (roll < HEART_CHANCE * weight + COIN_CHANCE * weight)
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
const GOLD_ROOM_COINS = 14;

const HEART_CHANCE = 0.05;
/** Raised from 0.22: a kill should pay gold as often as not over a room. */
const COIN_CHANCE = 0.35;

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
function smashProps(w: World, dtMs: number): void {
  /*
   * The player's dodge breaks what it goes through. It already passes through
   * bodies; a pot it had to stop for was the one thing in the room a dodge
   * respected, and a movement verb that is also a way to clear scenery gives
   * the room's clutter a second use.
   */
  const pl = w.player;
  if (pl.dashMs > 0) {
    const ahead = PLAYER_RADIUS + CHARGE_SMASH_LOOKAHEAD;
    for (const p of w.props) {
      if (p.hp <= 0) continue;
      if (propHit(p, pl.x + pl.dashX * ahead, pl.y + pl.dashY * ahead, PLAYER_RADIUS)
        || propHit(p, pl.x, pl.y, PLAYER_RADIUS)) damageProp(w, p, p.hp);
    }
  }
  for (const e of w.enemies) {
    if (e.hp <= 0 || !isActive(e)) continue;
    const charging = e.attack === "lunge" && ENEMIES[e.archetype].melee === "charge";

    for (const p of w.props) {
      if (p.hp <= 0) continue;
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
      const charging = e.attack === "lunge" && e.armour > 0;
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
  const fixedA = plowing(a);
  const fixedB = plowing(b);
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
  return e.attack === "lunge" && ENEMIES[e.archetype].melee === "charge";
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
    // Dedup per swing, the same way the player's own arc does: one attack is
    // one hit however many frames the player spends inside it.
    if (box.hitIds.includes(PLAYER_HIT_ID)) continue;
    if (!sectorHits(box, p, PLAYER_RADIUS)) continue;
    box.hitIds.push(PLAYER_HIT_ID);
    /*
     * A zero-damage blade still connects, it just costs nothing. That is how
     * an archetype's first attack in a room teaches its reach for free (see
     * `Enemy.hasAttacked`) — the hit is marked as landed so the swing does not
     * keep looking for a second victim, and the player is told it grazed them.
     */
    if (box.damage <= 0) {
      w.events.push({ kind: "player_hit", x: e.x, y: e.y, what: `graze:${e.archetype}`, amount: 0 });
      continue;
    }
    /*
     * No blade stuns, not even a ram's.
     *
     * A charge did briefly, and it was too much: the player is already shoved,
     * already flashing, already down a heart, and a charge arrives often enough
     * that adding lost control on top made a single mistake compound. Lightning
     * keeps its stun because it is the one attack that gives nearly a second of
     * marked ground first — being under it is a decision, so it can afford a
     * consequence a melee hit cannot.
     */
    const spec = meleeSpec(e);
    const ram = spec !== null && spec.commitSpeed >= 3 && e.attack === "lunge";
    const before = p.hearts;
    /*
     * A ram shoves along **its own line of travel**, not away from the body's
     * centre: a player caught at the edge of the front went sideways, which
     * is not what being hit by a moving mass does to you.
     */
    if (ram) hurtPlayer(w, p.x - e.lungeX, p.y - e.lungeY, `melee:${e.archetype}`, 0, box.damage);
    else hurtPlayer(w, e.x, e.y, `melee:${e.archetype}`, 0, box.damage);
    if (ram && p.hearts < before) ramImpact(w, e, spec);
  }
}

/**
 * A ram that connects **exchanges momentum** with what it hit.
 *
 * The charge carried on through the player at full speed, as if they were
 * not there, and the player got the same small nudge every hit gives. Two
 * bodies colliding should read as one handing its motion to the other: the
 * player is thrown down the line of the charge, hard, and the charger's
 * commit ends there — its speed drops to a fraction and it goes into the
 * braking recovery it would have had at the end of its run. The stop is
 * also the opening, so a ram that lands is punishable in the same way as one
 * that missed, which is what keeps taking the hit from being strictly worse
 * than dodging it in every respect.
 */
/** How far the player is thrown, in px, and over how long. Three tiles. */
const RAM_THROW_PX = 96;
const RAM_THROW_MS = 260;
/** The charger's speed after the hit: a short slide, braked to a stop. */
const RAM_SLIDE_PX_PER_S = 90;

function ramImpact(w: World, e: Enemy, spec: NonNullable<ReturnType<typeof meleeSpec>>): void {
  const p = w.player;
  const throwSpeed = RAM_THROW_PX / (RAM_THROW_MS / 1000);
  p.hurtX = e.lungeX * throwSpeed;
  p.hurtY = e.lungeY * throwSpeed;
  p.hurtMs = RAM_THROW_MS;
  e.attack = "recover";
  e.attackMs = spec.recoverMs;
  e.swing.active = false;
  e.velX = e.lungeX * RAM_SLIDE_PX_PER_S;
  e.velY = e.lungeY * RAM_SLIDE_PX_PER_S;
  if (spec.brakeMs > 0) e.brakeMs = spec.brakeMs;
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
    case "collapse": {
      // Punishes camping, not movement, so the whole dwell time has to pass
      // before anything happens — and then it happens once.
      w.hazardTimerMs += dtMs;
      if (w.hazardTimerMs < HAZARD_COLLAPSE_MS) return;
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
 * The orbiter flies and a leaping boss is in the air, so neither is touched.
 */
function poisonGround(w: World, dtMs: number): void {
  const pools = w.room.zones.filter((z) => z.feature === "poison_pool");
  if (pools.length === 0) return;
  const add = ENEMY_POOL_BUILD_PER_S * (dtMs / 1000);
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.airborne || e.archetype === "orbiter" || e.spawnFadeMs > 0) continue;
    const inPool = pools.some((z) => z.cells.some((c) =>
      circlesOverlap((c[0] + 0.5) * TILE_PX, (c[1] + 0.5) * TILE_PX, TILE_PX / 2, e.x, e.y, e.radius * 0.6)));
    if (!inPool) continue;
    if (e.poisonMs > 0) { e.poisonMs = Math.max(e.poisonMs, ENEMY_POISON_MS * 0.5); continue; }
    e.poisonBuild = Math.min(1, e.poisonBuild + add);
    e.buildFedMs = 600;
    if (e.poisonBuild >= 1) { e.poisonMs = ENEMY_POISON_MS; e.poisonStacks = 2; e.poisonBuild = 1; }
  }
}

/** How fast a pool fills a standing enemy's poison gauge, per second. */
export const ENEMY_POOL_BUILD_PER_S = 0.9;

/**
 * Standing in poison costs a heart this often. Long, because the pool's job is
 * to deny ground rather than to punish crossing it.
 */
const HAZARD_SLOW_TICK_MS = 1800;
/** How long the player may stand on crumbling floor before it gives way. */
const HAZARD_COLLAPSE_MS = 2600;
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
    for (const cell of zone.cells) {
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
  if (p.strikeMs <= 0) return;
  p.strikeMs -= dtMs;
  for (const e of w.enemies) {
    if (!isActive(e) || e.hp <= 0 || p.strikeHits.includes(e.id)) continue;
    if (!circlesOverlap(p.x, p.y, PLAYER_RADIUS + p.strikeRadius, e.x, e.y, e.radius)) continue;
    p.strikeHits.push(e.id);
    wake(w, e);
    hurtEnemy(w, e, p.strikeDamage, "", p);
    w.stats.damageDealt += p.strikeDamage;
    e.hitFlashMs = HIT_FLASH_MS;
    const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
    const push = 260 / Math.max(1, e.radius / 10);
    e.knockX += ((e.x - p.x) / d) * push;
    e.knockY += ((e.y - p.y) / d) * push;
    impact(w, HITSTOP_HIT, TRAUMA_HIT);
    w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: e.archetype, amount: p.strikeDamage });
    emit(w, e.x, e.y, "hit", 4);
  }
}

/** How often a vortex ticks its damage on what it holds. */
const VORTEX_TICK_MS = 500;

function stepVortices(w: World, dtMs: number): void {
  const dt = dtMs / 1000;
  for (const v of w.vortices) {
    if (!v.alive) continue;
    v.lifeMs -= dtMs;
    if (v.lifeMs <= 0) { v.alive = false; continue; }
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
        hurtEnemy(w, e, v.damage);
        w.stats.damageDealt += v.damage;
        e.hitFlashMs = HIT_FLASH_MS;
        w.events.push({ kind: "hazard_tick", x: e.x, y: e.y, what: "vortex" });
      }
    }
  }
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
    b.element = "none";
    b.elementPower = 1;
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
function feedBurn(w: World, amount: number): void {
  const p = w.player;
  if (p.burnMs > 0) return;
  p.burnBuild = Math.min(1, p.burnBuild + amount);
  p.burnFedMs = BUILD_FED_HOLD_MS;
}

function feedPoison(w: World, amount: number): void {
  const p = w.player;
  if (p.poisonMs > 0) return;
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
  const due = Math.min(p.hearts, wholeHp(hearts * w.takenMult));
  // Invincible (testing): the tick is shown, not taken.
  const taken = w.invincible ? 0 : due;
  p.hearts -= taken;
  w.stats.heartsLost += taken;
  w.events.push({ kind: "player_hit", x: p.x, y: p.y, what: `dot:${cause}`, amount: due });
}

/**
 * `resonance`: each spell carrying it counts connecting sword hits, and on the
 * count casts itself at the body struck, free.
 */
function resonate(w: World, e: Enemy): void {
  w.spells.forEach((slot, i) => {
    if (!slot || !slot.unit) return;
    const held = slot.affixes.find((a) => a.id === "resonance");
    if (!held) return;
    const every = [5, 4, 3][held.tier - 1] ?? 5;
    w.resonance[i] = (w.resonance[i] ?? 0) + 1;
    if (w.resonance[i]! < every) return;
    w.resonance[i] = 0;
    hookSim(w).fire(slot.unit, w.player, e);
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

/** What `attacks.ts` lands its damage through. */
function attackHooks(w: World): AttackHooks {
  return {
    hurtPlayer: (x, y, cause, stunMs, hearts) => hurtPlayer(w, x, y, cause, stunMs, hearts),
    burnPlayer: (amount) => feedBurn(w, amount),
    knockDown: (e, ms) => {
      e.staggerMs = ms;
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
  // Always shorter than the invulnerability it arrives with, so a stun is
  // never a window in which the player is hit again. See `Player.stunMs`.
  if (stunMs > 0) p.stunMs = Math.min(stunMs, INVULN_MS - 120);
  // Invincible still takes the hit — the shove, the frames, the number shown —
  // just not the health.
  const due = Math.min(p.hearts, wholeHp(hearts * w.takenMult));
  const taken = w.invincible ? 0 : due;
  p.hearts = Math.max(0, p.hearts - taken);
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
  emit(w, p.x, p.y, "hit", 6);
  // `retort`: a spell with it fires back at whatever did this, free.
  onHurt(w, x, y, hookSim(w));
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
