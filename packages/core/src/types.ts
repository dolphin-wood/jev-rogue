/**
 * Shared shapes. Domain modules (spells, rooms, encounters) import from here
 * and must not redefine these. Sources are cited as `doc NNN`.
 */
import type {
  Archetype, BuildArchetype, Bottleneck, ClearSpeed, Consistency, CounterScore,
  Element, Gold, HazardCap, Health, ManaSustain, Range as RangeTag, Rarity,
  RecentDamage, Role, RunProgress, Scatter, Suitability, Tension, TensionCap,
} from "./content/tags.ts";

/* ============================ geometry (doc 004) ============================ */

export const GRID_W = 21;
export const GRID_H = 13;
export const TILE_PX = 32;

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
  | "boss_open" | "boss_scattered" | "boss_pillared";

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
  /** The outline it was built in (doc 004, "Skeletons"); absent for a fixed room. */
  readonly skeleton?: string;
  readonly doors: readonly DoorSide[];
  readonly entry: DoorSide;
  readonly zones: readonly { id: string; cells: readonly Cell[]; feature: string | "none" }[];
  readonly spawn_groups: readonly SpawnGroup[];
  readonly encounter: EncounterPlan | null;
  readonly reward_kind: RewardKind;
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
 * - `collapse` — no charge for crossing, and a fall for camping on it.
 */
export type HazardEffect = "none" | "contact" | "slow_tick" | "slip" | "collapse";

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
  /** Placed by the boss room only; never assembled into an encounter. */
  | "boss";

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
export type MeleeKind = "thrust" | "slash" | "whirlwind" | "charge" | "lance" | "cleave" | "bristle";

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
export type WaveStructure = "single" | "two_waves" | "trickle";
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
}

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

/* ============================= spells (doc 006) ============================= */

export type ItemKind = "attack" | "boost" | "passive" | "payload" | "multicast";
export type PayloadTrigger = "on_hit" | "on_expire" | "on_wall";
export type AffixId = "homing" | "cheaper" | "wider" | "heavier" | "elemental";

export interface BaseItem {
  readonly id: string;
  readonly kind: ItemKind;
  readonly rarity: Rarity;
  readonly tags: readonly string[];
  readonly description: string;
  readonly mana: number;
  /** Kind-specific numeric parameters, validated per kind by the content schema. */
  readonly params: Readonly<Record<string, number | string>>;
  readonly jev_hints?: { favor_when?: readonly string[]; avoid_when?: readonly string[] };
  readonly resource?: string;
  readonly numeric_ok?: boolean;
}

/** An affix produces an instance, not a new base item (doc 006). */
export interface ItemInstance {
  readonly uid: string;
  readonly base: string;
  readonly affix: AffixId | null;
  readonly magnitude: number;
  readonly modifier: Readonly<Record<string, number>> | null;
  readonly rarity: Rarity;
}

export interface StaffProfile {
  readonly slots: "few" | "many";
  readonly mana: "low" | "high";
  readonly tempo: "quick" | "steady";
  readonly special: "none" | "regen" | "crit";
}

export interface Staff {
  readonly profile: StaffProfile;
  readonly slots: number;
  readonly mana_max: number;
  readonly mana_regen: number;
  readonly cast_interval: number;
  readonly cooldown: number;
  readonly crit_bonus: number;
}

/** Parsed cast tree (doc 006, "Parse"). A unit occupies one cast tick. */
export type CastUnit =
  | { kind: "attack"; slot: number; item: ItemInstance; boosts: readonly ItemInstance[] }
  | { kind: "payload"; slot: number; item: ItemInstance; boosts: readonly ItemInstance[]; child: CastUnit | null }
  | { kind: "multicast"; slot: number; item: ItemInstance; boosts: readonly ItemInstance[]; units: readonly CastUnit[]; n: number };

export interface CastTree {
  readonly units: readonly CastUnit[];
  readonly passives: readonly ItemInstance[];
  /** Slots dropped because the depth cap was hit; surfaced by the staff editor. */
  readonly droppedForDepth: readonly number[];
}

export interface StaffSim {
  readonly dps_stationary: number;
  readonly dps_moving: number;
  readonly mana_sustain: ManaSustain;
  readonly cycle_time: number;
  readonly scatter: Scatter;
  readonly archetype: BuildArchetype;
  readonly bottleneck: Bottleneck;
  readonly missing_roles: readonly Role[];
  readonly dominant_tags: readonly string[];
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
    readonly archetype: BuildArchetype;
    readonly bottleneck: Bottleneck;
    readonly mana_sustain: ManaSustain;
    readonly range: RangeTag;
    readonly missing_roles: readonly Role[];
    readonly dominant_tags: readonly string[];
  };
  readonly preference: { readonly dominant: readonly string[]; readonly consistency: Consistency };
}

export interface RunHistory {
  readonly rooms: readonly RoomType[];
  readonly tensions: readonly Tension[];
  readonly profiles: readonly EncounterProfile[];
  readonly spaces: readonly SpaceArchetypeId[];
  /** The skeletons of the rooms so far, most recent first; see `generateRoom`'s `avoid`. */
  readonly skeletons?: readonly string[];
  readonly counter_scores: readonly CounterScore[];
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
  readonly staff: Staff;
  readonly slots: readonly (ItemInstance | null)[];
  readonly inventory: readonly ItemInstance[];
  readonly history: RunHistory;
  readonly intent: { readonly preset: Archetype; readonly free_text?: string };
}

export type DoorSet = readonly RoomType[];

export interface PacingLabels {
  readonly tension_cap: TensionCap;
  readonly hazard_cap: HazardCap;
  readonly pressure_cap: number;
}

/** Re-exported so domain modules can take everything they need from types.ts. */
export type {
  Archetype, BuildArchetype, Bottleneck, ClearSpeed, Consistency, CounterScore,
  Element, Gold, HazardCap, Health, ManaSustain, RangeTag, Rarity,
  RecentDamage, Role, RunProgress, Scatter, Suitability, Tension, TensionCap,
};
