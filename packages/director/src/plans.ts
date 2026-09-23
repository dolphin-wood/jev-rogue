/**
 * Plan shapes returned by every Director (design doc 009, "Director and plan
 * schemas"; doc 002, "Decision interface").
 *
 * Two rules hold for all of them:
 *
 * - every sub-decision carries its own `source`, so a run is reportable as the
 *   mix it actually was even when one question fell back and the rest did not;
 * - the `Decision` records that produced the plan travel with it, because the
 *   trace (011) needs the distribution that was sampled from, not just the
 *   answer.
 */
import type {
  AffixId, Anchor, Composition, Density, EliteAffix, EntryPattern, ItemInstance,
  PatternNode, RestOption, Role, RoomPlan, RoomType, Staff, StaffProfile, Tension,
  WaveStructure,
} from "@jr/core";
import type { CardPool, DoorOffer, Distribution, PortalChoices } from "@jr/core";
import type { Decision, DecisionSource, FallbackPath } from "./types.ts";

/** Which door of the offered set a room plan belongs to (doc 009). */
export interface DoorRef {
  readonly room_index: number;
  readonly door_slot: 0 | 1 | 2;
  readonly room_type: RoomType;
}

/* --------------------------------- doors ---------------------------------- */

export interface DoorPlan {
  readonly room_index: number;
  readonly sets_offered: readonly RoomType[];
  readonly tension: Tension;
  readonly source: {
    readonly door_set: DecisionSource;
    readonly tension: DecisionSource;
  };
  readonly decisions: readonly Decision[];
}

/**
 * The portals out of a room (doc 003's per-portal question): which reward
 * kinds, whether one is elite, the spell door's school, the stat door's
 * family, the grades, and whether a vendor's room replaces a door. Code drew
 * the count and enumerated the legal answers (`portalChoices`); the Director
 * chose among them; code assembled them (`assemblePortals`).
 */
export interface PortalPlan {
  readonly room_index: number;
  readonly doors: readonly DoorOffer[];
  readonly source: DecisionSource;
  readonly decisions: readonly Decision[];
}

/* ---------------------------------- cards ---------------------------------- */

/** One offer's legal cards and what code has already decided about its shape. */
export interface CardRequest {
  readonly room_index: number;
  readonly pool: CardPool;
  /** How many cards: three for a reward, one per kind on a vendor's shelf. */
  readonly count: number;
  /** Doc 007's pity: no card of a need in the last three offers. Code-triggered. */
  readonly pity: boolean;
  /** Doc 007's temptation: every fourth offer. Code-triggered. */
  readonly temptation: boolean;
  /** Separates two requests made for one room (a shelf asks per kind). */
  readonly salt?: string;
}

export interface CardPlan {
  readonly room_index: number;
  readonly ids: readonly string[];
  readonly origins: readonly CardOrigin[];
  readonly blended: Distribution;
  readonly variety: "low" | "medium" | "high";
  readonly source: DecisionSource;
  readonly decisions: readonly Decision[];
}

/* ---------------------------------- room ---------------------------------- */

/**
 * The room plan plus the per-sub-decision bookkeeping doc 009 asks for.
 * `plan` is core's `RoomPlan`, so the game consumes exactly what the generator
 * produced; nothing here re-describes the grid.
 */
export interface RoomPlanResult {
  readonly door: DoorRef;
  readonly plan: RoomPlan;
  readonly source: {
    readonly params: DecisionSource;
    readonly mood: DecisionSource;
    readonly reward_kind: DecisionSource;
    readonly zones: DecisionSource;
    readonly encounter: DecisionSource;
    /** `null` for a room that has no elite affix set. */
    readonly affixes: DecisionSource | null;
    readonly layout: "generated" | "authored";
  };
  readonly profile: {
    readonly composition: Composition;
    readonly density: Density;
    readonly wave_structure: WaveStructure;
    readonly anchor: Anchor;
    readonly entry: EntryPattern;
  } | null;
  readonly elite_affixes: readonly EliteAffix[];
  /** Set by the commit check when it had to cut the plan down (doc 003). */
  readonly trimmed: boolean;
  readonly decisions: readonly Decision[];
  /** The offer asked in round 1 alongside the room, when one was passed. */
  readonly offer?: OfferPlan;
}

/**
 * A room's offer, asked as **one request**: the portals out (doc 003) and any
 * number of card offers (doc 007). They read the same state, so they are
 * asked together, in parallel questions, as doc 002 prefers. A card request
 * with a `salt` has its question names and state keys prefixed by it, so a
 * vendor's three shelves can share one request without two `overall`s.
 */
export interface OfferRequest {
  readonly portals?: PortalChoices;
  readonly cards?: readonly CardRequest[];
}

export interface OfferPlan {
  readonly portals?: PortalPlan;
  /** One per card request, in the order asked. */
  readonly cards: readonly CardPlan[];
}

/* -------------------------------- rewards --------------------------------- */

export type CardOrigin = "sampled" | "wildcard" | "pity" | "temptation" | "filler" | "forced";

export type OfferCard =
  | {
      readonly kind: "item";
      readonly item: ItemInstance;
      readonly origin: CardOrigin;
      /** Rank of the base item in the blended distribution, 1-based. */
      readonly rank: number;
      readonly blended: number;
    }
  | { readonly kind: "gold"; readonly gold: number; readonly origin: "filler" };

export interface PityRecord {
  readonly fired: boolean;
  readonly role: Role | null;
  /** True when pity triggered but the chosen role had no eligible item (doc 007). */
  readonly skipped: boolean;
  readonly source: DecisionSource | null;
}

export interface TemptationRecord {
  readonly fired: boolean;
  readonly base: string | null;
  /** True when code picked the only candidate without asking (doc 007). */
  readonly unasked: boolean;
  readonly source: DecisionSource | null;
}

export interface RewardPlan {
  readonly room_index: number;
  readonly room_type: RoomType;
  readonly offer: readonly OfferCard[];
  /** Rank in the blended distribution per offered card, aligned with `offer`. */
  readonly ranks: readonly number[];
  readonly blended: Distribution;
  readonly variety: "low" | "medium" | "high";
  readonly affix_intent: AffixId | "none";
  /** Items dropped to fit the request size budget (doc 007). */
  readonly trimmed_items: readonly string[];
  readonly pool: readonly string[];
  readonly pity: PityRecord;
  readonly temptation: TemptationRecord;
  readonly source: {
    readonly overall: DecisionSource;
    readonly style: DecisionSource;
    readonly needs: DecisionSource;
    readonly variety: DecisionSource;
    readonly affix_intent: DecisionSource;
  };
  readonly decisions: readonly Decision[];
}

/* ---------------------------------- rest ---------------------------------- */

export interface RestPlan {
  readonly room_index: number;
  readonly options: readonly [RestOption, RestOption];
  readonly source: { readonly pair: DecisionSource };
  readonly decisions: readonly Decision[];
}

/* ---------------------------------- boss ---------------------------------- */

export type PatternFamily = "fan" | "ring" | "spiral" | "burst_mix";
export type PhaseTempo = "slow" | "fast";
export type PhaseCoverage = "wide" | "tight";
export type PhaseMovement = "stationary" | "closing" | "orbiting";
export type PhaseAdds = "none" | "turrets" | "rushers";

export interface PhaseParams {
  readonly pattern_family: PatternFamily;
  readonly tempo: PhaseTempo;
  readonly coverage: PhaseCoverage;
  readonly movement: PhaseMovement;
  readonly adds: PhaseAdds;
}

export interface PhaseDanger {
  readonly density_mean: number;
  readonly density_peak: number;
  readonly safe_lane_ratio: number;
}

export interface BossPhasePlan extends PhaseParams {
  readonly index: 0 | 1 | 2;
  readonly pattern: PatternNode;
  readonly measured: PhaseDanger;
  readonly band: {
    readonly density: readonly [number, number];
    readonly safe_lane_min: number;
  };
  /** True for at most one phase in a plan (doc 001, "Boss"). */
  readonly counters_build: boolean;
  readonly source: DecisionSource;
  readonly fallback_path?: FallbackPath;
}

export interface BossPlan {
  readonly arena: RoomPlan;
  readonly phases: readonly [BossPhasePlan, BossPhasePlan, BossPhasePlan];
  readonly source: {
    readonly arena: DecisionSource;
    readonly mood: DecisionSource;
    readonly phases: DecisionSource;
    readonly layout: "generated" | "authored";
  };
  readonly decisions: readonly Decision[];
}
