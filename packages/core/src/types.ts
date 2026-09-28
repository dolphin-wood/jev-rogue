/**
 * Shared shapes. Domain modules (spells, rooms, encounters) import from here
 * and must not redefine these. Sources are cited as `doc NNN`.
 */
import type {
  Archetype, BuildArchetype, ClearSpeed, Consistency, CounterScore,
  Element, ElementPowers, Gold, HazardCap, Health, Range as RangeTag, Rarity,
  StatusElement,
  RecentDamage, Role, RunProgress, Suitability, Tension, TensionCap,
} from "./content/tags.ts";
import type { ObservedLabels } from "./run/observed.ts";

/* ============================ geometry (doc 004) ============================ */

/**
 * The grid every room is stored in: the largest room's extent. A room's own
 * extent (`RoomPlan.extent`) sits in its top-left and everything past it is
 * wall, so indexing is one stride for every room and nothing that walks the
 * grid needs to know how large the room is (doc 017).
 */
export const GRID_W = 33;
export const GRID_H = 19;
export const TILE_PX = 32;

/** A room's size in cells, walls included. */
export interface Extent { readonly w: number; readonly h: number }

/**
 * A room's size, a round-1 room parameter (doc 017): how many views of the
 * 16 x 9-tile viewport it spans a side — half again, three quarters again,
 * twice — each rounded to an odd number of cells.
 */
export type RoomSize = "compact" | "standard" | "vast";
export const ROOM_SIZES: readonly RoomSize[] = ["compact", "standard", "vast"];
export const ROOM_EXTENT: Readonly<Record<RoomSize, Extent>> = {
  compact: { w: 25, h: 13 },
  standard: { w: 29, h: 15 },
  vast: { w: 33, h: 19 },
};

export type Cell = readonly [x: number, y: number];
export type DoorSide = "N" | "E" | "S" | "W";
export const DOOR_SIDES: readonly DoorSide[] = ["N", "E", "S", "W"];

/**
 * Tile codes packed into RoomPlan.grid. A const object rather than an enum:
 * Node's strip-only TypeScript mode, which every CLI here runs under, rejects
 * enums because they emit code. `Tile.Floor` and the `Tile` type both still
 * work exactly as before.
 */
/**
 * `Prop` is a destructible occupying a cell. It is a tile rather than an
 * entity list so that blocking movement, stopping bullets, breaking sight
 * lines and diverting the flow field all fall out of logic that already
 * exists; breaking one writes `Floor` back. See `sim/props.ts`.
 */
export const Tile = { Floor: 0, Wall: 1, Pillar: 2, Door: 3, Prop: 4 } as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export type Shape = "arena" | "corridor" | "ring" | "cross";
export type Openness = "open" | "mixed" | "tight";
export type Cover = "none" | "sparse" | "dense";
export type Symmetry = "mirrored" | "asymmetric";

export type SpaceArchetypeId =
  | "open_arena" | "scattered_arena" | "pillared_arena" | "tight_arena"
  | "long_corridor" | "broken_corridor" | "gallery" | "choked_corridor"
  | "open_ring" | "cover_ring" | "cross_open" | "cross_tight"
  | "boss_open" | "boss_scattered" | "boss_pillared" | "audience_arena";

export interface ZoneSlot { readonly id: string; readonly cells: readonly Cell[] }
export interface SpawnGroup { readonly id: string; readonly cells: readonly Cell[] }

/** A space archetype is a feasible (shape, openness, cover) triple plus the
 *  zone slots and spawn groups its mask guarantees are free floor (doc 004). */
export interface SpaceArchetype {
  readonly id: SpaceArchetypeId;
  readonly shape: Shape;
  readonly openness: Openness;
  readonly cover: Cover;
  readonly doors: readonly DoorSide[];
  readonly zoneSlots: readonly ZoneSlot[];
  readonly spawnGroups: readonly SpawnGroup[];
  readonly boss?: boolean;
  readonly description: string;
}

export interface Mood {
  readonly temperature: "cold" | "warm";
  readonly brightness: "dim" | "bright";
  readonly particle_intensity: "calm" | "busy";
}

export interface RoomParams {
  readonly space: SpaceArchetypeId;
  readonly symmetry: Symmetry;
  readonly size: RoomSize;
  readonly mood: Mood;
}

export interface RoomMeasurements {
  readonly open_ratio: number;
  readonly pillar_count: number;
  readonly symmetry_error: number;
  readonly reachable_ratio: number;
}

export type RoomType = "combat" | "elite" | "treasure" | "shop" | "rest" | "boss";

export interface RoomPlan {
  readonly id: string;
  readonly room_type: RoomType;
  readonly params: RoomParams;
  readonly measured: RoomMeasurements;
  readonly grid: Uint8Array;
  /** The room's size in cells, in the grid's top-left; wall beyond it. */
  readonly extent: Extent;
  /** The outline it was built in (doc 004, "Skeletons"); absent for a fixed room. */
  readonly skeleton?: string;
  readonly doors: readonly DoorSide[];
  readonly entry: DoorSide;
  readonly zones: readonly { id: string; cells: readonly Cell[]; feature: string | "none" }[];
  readonly spawn_groups: readonly SpawnGroup[];
  readonly encounter: EncounterPlan | null;
  readonly reward_kind: RewardKind;
  /**
   * Destructibles placed where the room says (the throne hall's columns and
   * candelabra, `rooms/fixed.ts`), beside the ones scattered and the ones a
   * zone stands.
   */
  readonly standing?: readonly { readonly kind: "column" | "candelabrum"; readonly gx: number; readonly gy: number }[];
  /**
   * **Another way to end the fight** (doc 025, `run/objectives.ts`): hold out,
   * or bring down the marked turrets. Absent for an ordinary fight.
   */
  readonly objective?: "hold" | "destroy";
  readonly source: {
    params: "jev" | "rule" | "random";
    layout: "generated" | "authored";
    encounter: "jev" | "rule" | "random" | "none";
  };
  readonly seed_key: string;
}

/* ============================ features (doc 004) ============================ */

/**
 * What standing on a feature does.
 *
 * The simulation used to treat **every** feature with a non-zero hazard budget
 * as contact damage, and the budget is a *cost against the room's cap*, not a
 * statement that something hurts. So all four floor hazards behaved
 * identically however differently they were described, and the turret's stone
 * plinth took a heart off anyone who stood on it.
 *
 * Measured, that mattered more than any of it looked: ground hazards were 79%
 * of every heart lost, more than everything alive in the game put together.
 * For a design that requires the player to keep moving, a floor that charges
 * for being on it is a tax on the only verb they have.
 *
 * - `none` — scenery. It costs the room's budget because it occupies a slot,
 *   and it does nothing to the player.
 * - `contact` — a heart on touch and again for lingering. The spike strip, and
 *   only the spike strip.
 * - `slow_tick` — damage for *staying*, on a long clock and with no charge for
 *   crossing. The poison pool, whose description already said so.
 * - `slip` — no damage at all; the player slides. The ice patch, likewise.
 *
 * `collapse` was here, for the crumbling floor. Both are gone: it charged for
 * dwelling exactly as the spike strip does, so the pool held two floor
 * hazards asking the player the same question.
 */
export type HazardEffect = "none" | "contact" | "slow_tick" | "slip" | "lava";

/**
 * The solid a feature stands in its zone, if it stands one.
 *
 * **This is the game's obstacle list**, and it is one list on purpose. Whether
 * a thing can be walked through was previously decided in three unrelated
 * places — the grid the generator wrote, the renderer's choice of frame, and
 * nothing at all for zone features — so a brazier and a mana font were drawn
 * as objects standing on the floor and were walked through,
 * shot through and pathed through like open ground. A player cannot learn a
 * rule with three authors.
 *
 * A fixture is a `Destructible` like a crate: it writes `Tile.Prop` into the
 * world's grid, which is what makes movement, bullets, line of sight and the
 * flow field agree about it without any of them being told separately.
 */
export type FixtureKind = "brazier";
/** A solid the player's own spell raises for a while. */
export type ConjuredKind = "pillar";

export interface Feature {
  readonly id: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly slot_kind: "zone";
  readonly hazard_budget: number;
  readonly hazard_effect: HazardEffect;
  /** The solid this feature stands, if any. See `FixtureKind`. */
  readonly fixture?: FixtureKind;
  readonly resource?: string;
}

/* =========================== encounters (doc 005) =========================== */

export type EnemyId =
  | "rusher" | "shooter" | "turret" | "orbiter" | "tank" | "summoner"
  /**
   * The lancer charges from range with a long weapon; the sentinel is an
   * emplacement that aims slow shots. Both ship on tinted variants of the
   * rusher's and turret's sheets until they have their own (art work order).
   */
  | "lancer" | "sentinel"
  /**
   * The expansion (research: `docs/research/enemy-expansion.md` §2): a
   * shield-bearer with a directional plate, a support that arms its allies, a
   * stationary body that splits the floor in a line, a hook that pulls the
   * player, a burrower, a coal that feeds on fire, and a drifting mine-layer.
   */
  | "warden" | "bellringer" | "rifter" | "snarecaster" | "delver" | "cinderling" | "sower"
  /**
   * The **subspecies** (doc 019): one per base archetype, each a known body
   * with one verb of its kit changed, so the player must answer it differently
   * without learning a new body. The lancer above is the rusher's and predates
   * them. They are ordinary roster entries gated by the ramp (`rampAllows`),
   * not a separate tier of enemy.
   */
  | "pinner" | "wisp" | "beacon" | "watcher" | "fusilier" | "pealer" | "quaker"
  | "chainer" | "burrower" | "emberling" | "planter" | "breaker" | "brooder"
  /** Placed by the boss room only; never assembled into an encounter. */
  | "boss";

/**
 * A base archetype: everything that is not a subspecies and not the boss.
 *
 * The mix ratios are keyed on these alone. A subspecies takes a share of its
 * base's ratio when the Director asks for it (doc 019), so a composition is
 * still a statement about *kinds of fight* rather than a table that grows by
 * one row every time a body gains a variant.
 */
export type BaseEnemyId =
  | "rusher" | "shooter" | "turret" | "orbiter" | "tank" | "summoner" | "sentinel"
  | "warden" | "bellringer" | "rifter" | "snarecaster" | "delver" | "cinderling" | "sower";

/**
 * The bodies an encounter may be built from.
 *
 * The boss is excluded **by type**, not by a check. Every composition weight,
 * pressure band and concurrency cap in `encounters/` was measured against these
 * six; a seventh leaking in would not fail loudly, it would quietly produce a
 * room with a boss in it and a pressure number that meant nothing.
 */
export type AssemblableId = Exclude<EnemyId, "boss">;

/**
 * `size` scales the bullet so a pattern can read at a glance: a slow fat
 * bullet is a wall to walk around, a fast thin one is a line to step off.
 * Every bullet the same size is the flattest a bullet hell can be.
 *
 * `gap_deg` cuts a sector out of a ring or fan. A dense uniform spray has no
 * answer to look for; a spray with a visible hole is a question the player
 * can read before it arrives, which is the whole game.
 *
 * `rest` emits nothing. Patterns need silence: a continuous stream has no
 * moment of pressure because it has no moment of relief.
 */
export type PatternNode =
  | { kind: "single"; speed: number; aim: Aim; interval: number; size?: number }
  | { kind: "fan"; count: number; spread_deg: number; speed: number; aim: Aim; interval: number; size?: number; gap_deg?: number }
  | { kind: "ring"; count: number; speed: number; interval: number; rotate_deg: number; size?: number; gap_deg?: number }
  | { kind: "spiral"; arms: number; angular_speed: number; speed: number; interval: number; size?: number }
  | { kind: "burst"; count: number; speed_min: number; speed_max: number; aim: Aim; cooldown: number; size?: number }
  | { kind: "rest" }
  | { kind: "sequence"; steps: readonly { pattern: PatternNode; duration: number }[] }
  | { kind: "parallel"; patterns: readonly PatternNode[] };

export type Aim = "player" | `fixed:${number}`;

export type Behaviour = "chase" | "keep_distance" | "orbit" | "stationary";

/**
 * The melee attack an archetype commits to, or null for a body that only
 * shoots. Declared here rather than in the simulation because it is a roster
 * property the Director reads, and defined as a union rather than imported
 * from `sim/melee.ts` to keep the dependency pointing one way.
 */
export type MeleeKind = "thrust" | "slash" | "whirlwind" | "charge" | "lance" | "cleave" | "bristle"
  | "claw" | "slam" | "sweep" | "bash" | "maul" | "greatsweep" | "greatcleave" | "greatslash" | "dashcut";

/**
 * What an archetype does at range, when it is not bullets.
 *
 * The three non-projectile kinds exist because a projectile can only ever
 * invalidate *standing in its path*, which is one tactic — and a roster whose
 * every member shoots is a roster of one enemy wearing six sprites. Each kind
 * here takes a different thing away from the player:
 *
 * - **lightning** marks a place and strikes it, so it punishes *being
 *   somewhere* rather than being somewhere at a moment. It is the only attack
 *   that makes the player move when nothing is near them, and cover is no
 *   answer because it comes from above.
 * - **flame** removes floor from play while it burns, which shrinks the arena.
 *   It is the only attack that changes the terrain, and it burns enemies too,
 *   so it is a tool as well as a threat.
 */
/*
 * - **rift** splits the floor along a line toward the player, so it denies a
 *   *route* rather than a spot; the answer is to cross it, not to leave.
 * - **ward** is no attack at all: a tether to an ally that armours it, cut by
 *   standing in the line — the support's kill-order question.
 * - **hook** throws a chain along a drawn line and drags the player in.
 * - **lob** arcs a projectile onto a marked landing spot, fixed at release.
 * - **mine** plants a seed that arms after the window a dash covers.
 */
export type RangedKind = "lightning" | "flame" | "rift" | "ward" | "hook" | "lob" | "mine" | "musket";

export interface RangedAttack {
  readonly kind: RangedKind;
  /** Seconds between attempts, once awake and past the telegraph. */
  readonly interval_s: number;
}

export interface EnemyArchetype {
  readonly id: EnemyId;
  readonly behaviour: Behaviour;
  readonly pattern: PatternNode | null;
  readonly threat_weight: number;
  readonly hp: number;
  readonly speed: number;
  readonly radius: number;
  /**
   * Replaces `contact_damage`.
   *
   * Contact damage had neither direction nor timing: it charged the player for
   * being next to a body, from any angle, at any moment. That is a tax on the
   * one thing a melee game asks the player to do, and it was measurably the
   * whole problem — across twelve reference runs body contact was more than
   * half of every heart lost, with one archetype alone at a third. A declared
   * attack has a windup to read, a facing to get out of, and a recovery to
   * punish, so the same pressure becomes something the player can answer.
   */
  readonly melee: MeleeKind | null;
  /**
   * A non-projectile ranged attack, or null. Mutually exclusive with
   * `pattern`: an archetype either shoots or it does one of these, because
   * the point of the taxonomy is that its members answer differently.
   */
  readonly ranged: RangedAttack | null;
  readonly tags: readonly string[];
  readonly description: string;
}

export type Composition = "melee_heavy" | "ranged_heavy" | "mixed" | "siege";
export type Density = "sparse" | "normal" | "dense";
/**
 * **How hard a room presses** (doc 019): the room's pacing, and the question
 * the Director answers about it.
 *
 * It used to name the *shape* a roster was split into — a single burst, two
 * waves, a trickle — which is a planning detail the player never sees as
 * such. What they feel is how quickly the next beat arrives once they have
 * dealt with this one, so that is what is asked: `breathe` lets the floor
 * clear first, `relentless` sends the next beat while they are still fighting.
 * The mapping to the two knobs that decide it is `PACING` in `world.ts`.
 */
export type WaveStructure = "breathe" | "steady" | "relentless";
export type Anchor = "none" | "tank" | "summoner";
export type EntryPattern = "far_front" | "flanks" | "surround" | "turrets_center";

export interface EncounterProfile {
  readonly composition: Composition;
  readonly density: Density;
  readonly wave_structure: WaveStructure;
  readonly anchor: Anchor;
  readonly entry: EntryPattern;
  /**
   * How many times the room's staging plays: each round is a whole
   * `wave_structure` of its own share of the roster, and the next begins only
   * once the last has mostly fallen (doc 014: room length is bought with
   * structure). Set by code from the room's tension, never asked; 1 when absent.
   */
  readonly rounds?: number;
  /**
   * The subspecies this room shows, at most two (doc 019). Asked as two slot
   * questions, because doc 002 asks scarce slots per slot: a room has two
   * subspecies slots and each is filled with one id or with `none`.
   *
   * Two rather than more because doc 005 holds a room to three or four enemy
   * types the player can tell apart and a subspecies counts as a type: a room
   * where every base has become something else has no baseline left to read
   * the strangeness against.
   */
  readonly subspecies?: readonly EnemyId[];
  /** How much of the eligible roster they take. Absent means `none`. */
  readonly subspecies_weight?: SubspeciesWeight;
  /**
   * How many elites a **normal** room hides. An elite room is placed by code —
   * its door already promised it, so there is nothing left to prefer.
   */
  readonly elite_presence?: ElitePresence;
}

/**
 * How heavily a room leans on its subspecies (doc 019).
 *
 * A label, not a number: doc 002 allows a quantity chosen from a short option
 * list as a Choice, and keeps the number that label means in code, where the
 * ramp can clamp it.
 */
export type SubspeciesWeight = "none" | "some" | "many";

/** How many elites a normal room hides (doc 019). Code holds the cap at two. */
export type ElitePresence = "none" | "one" | "two";

export interface Wave {
  readonly at_ms: number;
  readonly spawns: readonly { archetype: EnemyId; spawn_group: string; count: number }[];
}

export type EliteAffix = "armored" | "swift" | "burning" | "splitting" | "shielded" | "volatile";

export interface EncounterPlan {
  readonly profile: EncounterProfile;
  readonly waves: readonly Wave[];
  readonly measured_pressure: number;
  readonly band: readonly [number, number];
  readonly elite_affixes: readonly EliteAffix[];
  readonly source: "jev" | "rule" | "random";
}

/* ============================= spells (doc 013) ============================= */

/**
 * A spell in the pool. Every base item is an attack: a self-contained spell
 * that goes on one of the three keys and modifies nothing else.
 */
export interface BaseItem {
  readonly id: string;
  readonly rarity: Rarity;
  readonly tags: readonly string[];
  readonly description: string;
  /** The spell's cost **rank**, 1 to 7; `spellCost` turns it into mana. */
  readonly mana: number;
  /** The spell's numeric and shape parameters; see `spells/items.ts`. */
  readonly params: Readonly<Record<string, number | string>>;
  readonly resource?: string;
  readonly numeric_ok?: boolean;
}

/** One copy of a base item, as a slot holds it and an offer hands it out. */
export interface ItemInstance {
  readonly uid: string;
  readonly base: string;
  readonly rarity: Rarity;
}

/**
 * The run's mana pool and key count. Doc 013 retired the staff as a thing the
 * player chooses: every run plays the same one (`runStaff`), and the run's
 * stat upgrades scale its pool.
 */
export interface Staff {
  readonly slots: number;
  readonly mana_max: number;
}

/* =========================== run and plans (doc 003) ======================== */

export type RewardKind = "item" | "gold" | "heal" | "staff_upgrade";
export type RestOption = "heal" | "slot" | "purge" | "reroll_pool";

export interface SummaryLabels {
  readonly health: Health;
  readonly recent_damage: RecentDamage;
  readonly clear_speed: ClearSpeed;
  readonly movement_pressure_recent: "light" | "heavy";
  readonly run_progress: RunProgress;
  readonly gold: Gold;
  readonly tension_cap: TensionCap;
  readonly hazard_cap: HazardCap;
  readonly pressure_cap: number;
  readonly build: {
    /** The range the build fights at, for the counter score (doc 005). */
    readonly range: RangeTag;
  };
  /**
   * `dominant`: the most common style tags on the held spells, most first
   * (`heldDominantTags`). `consistency`: how the last picks sat against the
   * stated style (`bucketConsistency`).
   */
  readonly preference: { readonly dominant: readonly string[]; readonly consistency: Consistency };
  /**
   * How far the build has **taken shape** (`build-shape.ts`). Optional because
   * it needs the spell levels and affixes, which live on the world's slots.
   * Absent reads as `forming`, the middle.
   */
  readonly build_shape?: BuildShape;
  /**
   * **What the last two fights measured** (`run/observed.ts`). Optional
   * because a caller that has not fought yet has nothing to report; absent
   * reads as `UNMEASURED`.
   */
  readonly observed?: ObservedLabels;
}

/** Doc 007's bucket for how much of the build is filled in (`build-shape.ts`). */
export type BuildShape = "raw" | "forming" | "formed";

export type { ObservedLabels };



/**
 * **One room the run has already played**, as a designer would want it read
 * back: what it was, how it went, what it cost and what the player chose.
 *
 * Every field is a measurement, never a verdict — `health_lost: 9` and not
 * "a rough room" — and every one is optional, because the two callers that
 * fill it (the scene and the harness) know different amounts at different
 * moments and a briefing drops a phrase it has no number for.
 */
export interface RunJournalEntry {
  readonly index: number;
  /** combat, elite, merchant, smith, fountain, shop, boss. */
  readonly type: string;
  readonly tension?: Tension;
  readonly space?: string;
  readonly symmetry?: Symmetry;
  readonly mood?: Mood;
  /** Health lost in the room, in points of the health bar. */
  readonly health_lost?: number;
  /** The lowest the bar reached inside the room, in points. */
  readonly health_low?: number;
  /** How long the fight took, and what a run at this index usually takes. */
  readonly seconds?: number;
  readonly expected_seconds?: number;
  /** Which family took the most health here: shots, blades or hazards. */
  readonly hurt_by?: string;
  /**
   * What took the most, by the cause the hit named: the body's archetype for a
   * blade or a contact hit, the bullet's family for a shot, the feature's id
   * for a hazard.
   */
  readonly hurt_most_by?: string;
  /** The bodies the room actually put on the floor, by archetype id. */
  readonly enemies?: readonly string[];
  /** The reward kinds on the doors out, and the one the player walked through. */
  readonly doors_offered?: readonly string[];
  readonly door_taken?: string;
  /** Cards taken and cards left on the screen, by id. */
  readonly picked?: readonly string[];
  readonly passed_over?: readonly string[];
  /** A room whose reward was a purse rather than a card. */
  readonly took_gold_instead?: boolean;
  /** The room's size as it was built. */
  readonly size?: RoomSize;
  /**
   * **The fight as it was assembled**: the roster's shape, where it came in
   * from, which variant bodies it showed and how many it hid enraged. What
   * code built rather than what the Director asked for — the two differ
   * wherever the ramp or the commit check stepped in.
   */
  readonly encounter?: EncounterProfile;
  /**
   * **The doors out as they stood**, each with what it promised: a spell
   * door's school, a stat door's family, whether it was elite, its grade.
   * `doors_offered` keeps only the kinds, and a run of storm spell doors is
   * three words "spell" in it.
   */
  readonly doors?: readonly JournalDoor[];
}

/** One door out of a room, as the journal keeps it: its kind and what it promised. */
export interface JournalDoor {
  /** The reward kind, or the vendor's room the door leads to. */
  readonly kind: string;
  /** Every school, or family, among the door's cards, in the Director's order. */
  readonly schools?: readonly string[];
  readonly families?: readonly string[];
  readonly elite?: boolean;
  /** 1 ordinarily; 2 or 3 is a reward graded up. */
  readonly grade?: number;
}

/** A door as the journal keeps it, from either shape a door is held in. */
export function journalDoor(d: {
  readonly reward: string; readonly npc?: string; readonly schools?: readonly string[]; readonly families?: readonly string[];
  readonly grade?: number; readonly elite?: boolean; readonly difficulty?: string;
}): JournalDoor {
  const elite = d.elite ?? d.difficulty === "elite";
  return {
    kind: d.npc ?? d.reward,
    ...(!d.npc && d.schools?.length ? { schools: d.schools } : {}),
    ...(!d.npc && d.families?.length ? { families: d.families } : {}),
    ...(elite ? { elite: true } : {}),
    ...(!d.npc && d.grade && d.grade > 1 ? { grade: d.grade } : {}),
  };
}

export interface RunHistory {
  readonly rooms: readonly RoomType[];
  readonly tensions: readonly Tension[];
  /**
   * Hearts lost in each room so far, in room order. Optional, because the
   * scene and the harness populate it independently and neither should break
   * without it; a Director that cannot see it reads the trend as `steady`.
   * `recent_damage` is already the *sum* over the last two rooms, so a trend
   * cannot be recovered from the labels alone — it needs the series.
   */
  readonly hearts_lost?: readonly number[];
  readonly profiles: readonly EncounterProfile[];
  readonly spaces: readonly SpaceArchetypeId[];
  /** The skeletons of the rooms so far, most recent first; see `generateRoom`'s `avoid`. */
  readonly skeletons?: readonly string[];
  readonly counter_scores: readonly CounterScore[];
  /**
   * **What the doors have been offering, and what the player did with them.**
   *
   * Reported from play: once the affix slots opened, the affix door won
   * essentially every offer, so the player stopped choosing and simply walked
   * through whichever badge said affix. Nothing in the state could see it —
   * the Director answers each room from that room's labels, and a badge shown
   * six rooms running looks identical to one shown for the first time.
   *
   * Jev cannot count, so none of this reaches it as a list. Code walks these
   * and emits one label each (`director/questions/history.ts`): which kind has
   * been on the badge several rooms running, which the player leans toward,
   * and which they keep passing over.
   *
   * The reward kinds on each room's portals, in room order.
   */
  readonly doors_offered?: readonly (readonly string[])[];
  /** The kind of door the player walked through into each room, in room order. */
  readonly doors_taken?: readonly string[];
  /**
   * The mood and the symmetry of each room built so far, **most recent first**
   * as `spaces` is. Without them the four look-only questions were decided by
   * the same three health labels as each other, so a healthy player got the
   * same warm, dim, busy, asymmetric room sixteen times.
   */
  readonly moods?: readonly Mood[];
  readonly symmetries?: readonly Symmetry[];
  /** Every stat upgrade taken this run, by id, for `mana_stats_taken`. */
  readonly stats_taken?: readonly string[];
  /**
   * **The run written down room by room**, for the Director's briefing.
   *
   * The arrays above are each one fact per room, sliced apart so a label
   * function can walk one of them. A briefing needs them back together: what
   * room 4 was, how long it took, what it cost, which bodies were in it and
   * what the player did with its reward, all on one line. Optional, because a
   * caller with nothing to report should get a briefing that says so rather
   * than an exception.
   */
  readonly journal?: readonly RunJournalEntry[];
  readonly shop_entered: boolean;
  readonly rests_entered: number;
  readonly treasures_entered: number;
  readonly elite_last_room: boolean;
  readonly shielded_rooms: number;
}

export interface RunContext {
  readonly run_id: string;
  readonly seed: string;
  readonly room_index: number;
  readonly labels: SummaryLabels;
  /**
   * **The bar and the purse as numbers**, beside the buckets in `labels`.
   *
   * Doc 002 keeps raw numbers out of the *labels*, and that rule is about
   * labels: a bucket is what an option is grounded on. The Director's briefing
   * is not a set of labels — it is the run written out for a reader — and a
   * reader told "health is low" and never told how low cannot judge whether a
   * fountain is worth a room, nor whether 38 gold buys anything. `max_health`
   * tracks the upgrades the run has taken, so the denominator is the bar the
   * player actually has.
   *
   * Optional, because a caller with only the labels should still get a
   * briefing; it then reads the middle of the bucket and says so.
   */
  readonly health?: number;
  readonly max_health?: number;
  readonly gold?: number;
  /**
   * **The body's level, and how far into the next one** (`run/levels.ts`).
   *
   * Kills pay experience and levels arrive on their own, so this is a fact
   * about the player the Director cannot read off anything else: two runs in
   * room 10 with the same cards can be a level apart because one of them has
   * been clearing rooms whole. Numbers rather than a bucket, for the reason
   * `health` is a number here — the briefing is prose for a reader, and
   * "level 4, 60 of 180 into the next" is a fact where "mid" is a verdict.
   *
   * Nothing in the Director reacts to it: no question is grounded on it and
   * no option mentions it. It is in the briefing because the briefing is the
   * run written out, and the level is part of the run.
   */
  readonly level?: number;
  readonly xp_into?: number;
  readonly xp_to_next?: number;
  /**
   * The figures behind `labels.observed`, over the same two-fight window
   * (`observedFigures`). The buckets are what an option is grounded on; the
   * briefing prints both, because "steady" alone cannot distinguish a rotation
   * at the bottom of the band from one at the top.
   */
  readonly observed_figures?: {
    readonly castsPerMinute: number;
    readonly damagePerSecond: number;
    readonly bodiesPerShot: number;
    readonly swordShare: number;
  };
  readonly staff: Staff;
  readonly slots: readonly (ItemInstance | null)[];
  readonly inventory: readonly ItemInstance[];
  readonly history: RunHistory;
  readonly intent: { readonly preset: Archetype; readonly free_text?: string };
  /**
   * **What the keys are actually holding.** `slots` says which spells; this
   * says at what level, with what on them, and how big the bar they are cast
   * from is. Without it the Director could not be told that a key is at level
   * 5 with three affixes while another is bare at level 1 — the fact the
   * offer question is most about (`run/build-facts.ts`).
   *
   * Optional, because a caller that has no levels or affixes to report (a
   * test, the first room) should get a sane build rather than an exception;
   * absent reads as three bare keys at level 1.
   */
  readonly power?: {
    readonly levels: readonly number[];
    readonly affixes: readonly (readonly { readonly id: string }[])[];
    readonly mana_max: number;
  };
}

export type DoorSet = readonly RoomType[];

export interface PacingLabels {
  readonly tension_cap: TensionCap;
  readonly hazard_cap: HazardCap;
  readonly pressure_cap: number;
}

/** Re-exported so domain modules can take everything they need from types.ts. */
export type {
  Archetype, BuildArchetype, ClearSpeed, Consistency, CounterScore,
  Element, ElementPowers, Gold, HazardCap, Health, RangeTag, Rarity,
  RecentDamage, Role, RunProgress, StatusElement, Suitability, Tension, TensionCap,
};
