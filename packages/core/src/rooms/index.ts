/** Public surface of room generation (doc 004). */
export {
  DOOR_CELL, ENTRY_CELL, INTERIOR_X0, INTERIOR_X1, INTERIOR_Y0, INTERIOR_Y1,
  arenaMask, corridorMask, crossMask, ringMask, maskFor, maskFloorCount,
  applyDoors, at, idx, inBounds, inInterior, isFloor, manhattan, mirrorX, rect, walkable,
} from "./masks.ts";

export {
  BOSS_ARCHETYPES, BOSS_CENTRE, BOSS_COVER_CLEARANCE, ENTRY_CLEAR_RADIUS,
  HAZARD_DOOR_CLEARANCE, PLAYABLE_ARCHETYPES, SPACE_ARCHETYPES, SPAWN_ENTRY_CLEARANCE,
  archetype, checkArchetypeDeclarations,
} from "./archetypes.ts";

export {
  COVER_BANDS, OPENNESS_BANDS, bandsFor, countPillars, floodFill, inMetricBand,
  measureRoom, measurementProblems, symmetryError,
} from "./measure.ts";
export type { Band, RoomMetrics } from "./measure.ts";

export {
  MIN_REACHABLE_RATIO, bossCentreDistance, deadEnds, entryClearCells,
  hasThreeWideBlock, narrowCells, validateRoom,
} from "./validate.ts";
export type { ValidateInput, ValidationResult } from "./validate.ts";

export {
  AUTHORED_ROOMS, FALLBACK_ARENA, FALLBACK_CORRIDOR, FALLBACK_CROSS, authoredFor,
} from "./authored.ts";
export type { AuthoredRoom } from "./authored.ts";

export {
  MAX_RELAXED_ATTEMPTS, MAX_SEED_ATTEMPTS, generateRoom, relaxArchetype,
  renderGrid, resolveEntry, toRoomPlan,
} from "./generate.ts";
export type { GeneratedRoom, RoomZone } from "./generate.ts";

export {
  FEATURES, HAZARD_CAP_BUDGET, feature, featuresByResource, featuresForCap, featuresForZone,
  centralZone, assignZoneFeatures, SPIKE_PERIOD_MS, spikesOut,
  isHazard, totalHazardBudget,
} from "./features.ts";
export type { FeatureId } from "./features.ts";
export * from "./melee-metrics.ts";
export {
  SKELETONS, inSkeleton, skeletonById, skeletonFits, skeletonMask, skeletonSymmetric, skeletonsFor,
} from "./skeletons.ts";
export type { Skeleton } from "./skeletons.ts";
