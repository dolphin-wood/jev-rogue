/**
 * Encounter assembly (design doc 005, "Assembly"). The six numbered steps are
 * marked in `assembleEncounterDetailed` below.
 *
 * Deterministic given the profile, the room and the rng stream.
 */
import type {
  Composition, Density, EncounterPlan, EncounterProfile, EnemyId, EntryPattern,
  RoomPlan, SpawnGroup, Wave, WaveStructure, AssemblableId,} from "../types.ts";
import type { Rng } from "../rng.ts";
import { ENEMY_IDS, MAX_CONCURRENT_ENEMIES, SUMMONER_MINION_CAP } from "./enemies.ts";
import {
  ASSUMED_TTK_MS, contextFor, inBand, measurePressure, peakConcurrency, round3,
} from "./pressure.ts";
import type { PressureContext } from "./pressure.ts";
import { PRESETS, presetForBand, presetRoster } from "./presets.ts";
import type { EncounterPreset, PresetTier } from "./presets.ts";

/* -------------------------------- step 2 ---------------------------------- */

/** Archetype ratios per composition (doc 005 step 2). */
export const MIX_RATIOS: Readonly<Record<Composition, Readonly<Record<AssemblableId, number>>>> = {
  /*
   * The lancer is not rostered: it is what a rusher becomes in an elite room.
   *
   * The expansion gives each composition bodies that change its question
   * rather than more of the same one (research §1.9): `melee_heavy` gets a
   * body that is not there (delver) and a coal that feeds on fire
   * (cinderling); `ranged_heavy` and `siege` get a support (bellringer), a
   * line (rifter), a pull (snarecaster), delayed mines (sower) and a heavy
   * gunner whose spray is answered by distance (warden). `mixed` draws
   * everything.
   */
  melee_heavy: {
    rusher: 0.5, lancer: 0, orbiter: 0.15, tank: 0.1, shooter: 0, turret: 0, summoner: 0, sentinel: 0,
    warden: 0, delver: 0.15, cinderling: 0.1, bellringer: 0, rifter: 0, snarecaster: 0, sower: 0,
  },
  ranged_heavy: {
    shooter: 0.22, turret: 0.12, sentinel: 0.12, orbiter: 0.1, rusher: 0, tank: 0, summoner: 0, lancer: 0,
    bellringer: 0.1, snarecaster: 0.1, sower: 0.08, rifter: 0.08, warden: 0.08, delver: 0, cinderling: 0,
  },
  mixed: {
    rusher: 1 / 14, shooter: 1 / 14, turret: 1 / 14, orbiter: 1 / 14, tank: 1 / 14, summoner: 1 / 14, lancer: 0,
    sentinel: 1 / 14, warden: 1 / 14, bellringer: 1 / 14, rifter: 1 / 14, snarecaster: 1 / 14, delver: 1 / 14,
    cinderling: 1 / 14, sower: 1 / 14,
  },
  siege: {
    turret: 0.22, sentinel: 0.18, shooter: 0.14, rusher: 0.1, orbiter: 0, tank: 0, summoner: 0, lancer: 0,
    rifter: 0.14, warden: 0.12, bellringer: 0.05, sower: 0.05, snarecaster: 0, delver: 0, cinderling: 0,
  },
};

/** Mean threat weight of a composition, which is what sets its option tier. */
export function meanThreatOf(composition: Composition): number {
  const ratios = MIX_RATIOS[composition];
  let sum = 0;
  for (const id of ENEMY_IDS) sum += ratios[id] * THREAT[id];
  return round3(sum);
}

const THREAT: Readonly<Record<AssemblableId, number>> = {
  rusher: 1.0, shooter: 1.5, turret: 2.0, orbiter: 2.0, tank: 3.0, summoner: 3.0,
  lancer: 1.4, sentinel: 1.7,
  warden: 2.6, bellringer: 2.4, rifter: 2.0, snarecaster: 2.2, delver: 1.8, cinderling: 2.0, sower: 2.2,
};

/**
 * A repeating draw order over the composition's ratios (highest-average
 * apportionment, ties broken by the rng). Drawn once per assembly so that
 * adjusting the count by one only ever adds or removes the last body, which
 * keeps pressure monotone across retries.
 */
/**
 * How many of each archetype one encounter may hold.
 *
 * The heavies are capped at **one**. Two tanks in a room is two charges to
 * read at once and two bodies the sword cannot get behind; two turrets is
 * two strike markers on a floor built for one; two summoners is a floor of
 * rushers. Each of the three is designed to be *the* thing the room is about,
 * and the pressure model rewards a second one exactly as much as the first,
 * which is how rooms came to have two. The mix ratios still say how often the
 * heavy appears at all; this says it appears once.
 */
const ROSTER_CAP: Readonly<Record<AssemblableId, number>> = {
  rusher: Infinity, shooter: Infinity, orbiter: Infinity, lancer: Infinity,
  turret: 1, tank: 1, summoner: 1, sentinel: 1,
  // One of each question per room: two wardens is a crossfire, two sowers a floor of pips.
  warden: 1, bellringer: 1, rifter: 1, snarecaster: 1, sower: 1, delver: 2, cinderling: 2,
};

export function rosterOrder(composition: Composition, rng: Rng, length = MAX_CONCURRENT_ENEMIES * 3): EnemyId[] {
  const ratios = MIX_RATIOS[composition];
  const taken: Record<AssemblableId, number> = {
    rusher: 0, shooter: 0, turret: 0, orbiter: 0, tank: 0, summoner: 0, lancer: 0, sentinel: 0,
    warden: 0, bellringer: 0, rifter: 0, snarecaster: 0, delver: 0, cinderling: 0, sower: 0,
  };
  const out: EnemyId[] = [];
  for (let k = 0; k < length; k++) {
    let bestScore = -1;
    let best: AssemblableId[] = [];
    for (const id of ENEMY_IDS) {
      const r = ratios[id];
      if (r <= 0) continue;
      if (taken[id] >= ROSTER_CAP[id]) continue;
      const score = r / (taken[id] + 1);
      if (score > bestScore + 1e-12) {
        bestScore = score;
        best = [id];
      } else if (Math.abs(score - bestScore) <= 1e-12) {
        best.push(id);
      }
    }
    if (best.length === 0) break;
    const chosen = best.length === 1 ? best[0]! : rng.pick(best);
    taken[chosen]++;
    out.push(chosen);
  }
  return out;
}

/**
 * The largest roster the concurrency cap allows. Minions are not reserved for
 * here: they share the same twelve slots at runtime through `canSpawnMinion`,
 * which keeps a roster's size from jumping the moment a summoner is drawn.
 */
/**
 * The most bodies one encounter may schedule **in total**.
 *
 * This returned `MAX_CONCURRENT_ENEMIES`, which capped the whole roster at
 * twelve however it was staged — so a trickle of five waves could hold no more
 * bodies than one wave, and the concurrency discount that makes staging cheap
 * in pressure terms bought nothing. Concurrency has its own check
 * (`concurrency_cap` in validation, on `peakConcurrency`); this is the other
 * limit, and it is what doc 014's room length has to come out of. Median room
 * was seven seconds against a target of thirty to forty.
 */
export const MAX_ROSTER = 40;

/** A trickle's most bodies in one round (it has fewer up at once than in its roster). */
export const TRICKLE_ROUND_MAX = 24;

/** The rounds a profile plays; see `EncounterProfile.rounds`. */
export function roundsOf(profile: EncounterProfile): number {
  return Math.max(1, Math.floor(profile.rounds ?? 1));
}

/**
 * The gap between one round's last wave and the next round's first. Longer
 * than `ASSUMED_TTK_MS`, so the pressure model counts the rounds as separate
 * fights — a round is in band on its own, and more rounds make a room longer,
 * not harder. At runtime the wave gate holds the round until the floor thins.
 */
export const ROUND_GAP_MS = ASSUMED_TTK_MS + 500;

export function maxCountFor(profile: EncounterProfile): number {
  // `peakConcurrency` counts every wave inside one time-to-kill of another as
  // on screen together. A single wave is all on screen; two waves three
  // seconds apart are too. Only a trickle — one chunk every TRICKLE_STEP_MS,
  // chunks of TRICKLE_CHUNK — has fewer bodies up than in its roster, so only
  // a trickle may draw on the larger figure. Rounds are apart, so each brings
  // its own share.
  const perRound = profile.wave_structure === "trickle" ? TRICKLE_ROUND_MAX : MAX_CONCURRENT_ENEMIES;
  return Math.min(MAX_ROSTER, perRound * roundsOf(profile));
}

/** Doc 005 step 2: the anchor adds exactly one tank or summoner first. */
export function buildRoster(profile: EncounterProfile, count: number, order: readonly EnemyId[]): EnemyId[] {
  const roster: EnemyId[] = [];
  if (profile.anchor !== "none" && count > 0) roster.push(profile.anchor);
  for (const id of order) {
    if (roster.length >= count) break;
    roster.push(id);
  }
  return roster;
}

/** Bodies a roster could put on the floor if every minion slot were free.
 *  A diagnostic: the runtime gate, not this number, enforces the cap. */
export function effectivePopulation(roster: readonly EnemyId[]): number {
  return roster.length + (roster.includes("summoner") ? SUMMONER_MINION_CAP : 0);
}

/* -------------------------------- step 3 ---------------------------------- */

/** Concurrent-enemy target per density (doc 005 step 3). */
export const DENSITY_TARGETS: Readonly<Record<Density, readonly [number, number]>> = {
  /*
   * Roughly doubled, and read as **bodies in the room over its whole fight**,
   * not on screen at once — that is the concurrency cap's job. Doc 014 asks for
   * thirty to forty seconds a room; at the roster's measured kill rate the old
   * targets produced seven. The assembler still stops when pressure enters the
   * band, so a single-wave profile cannot use most of this; a staged one can.
   */
  sparse: [5, 7],
  normal: [9, 12],
  dense: [14, 18],
};


export const DENSITY_ORDER: readonly Density[] = ["sparse", "normal", "dense"];

/** The fewest bodies a combat room is assembled with; see `assembleEncounterDetailed`. */
export const MIN_ROOM_BODIES = 6;

/** Bodies for the whole room: the density's target for one round, times the rounds. */
export function targetCount(density: Density, rng: Rng, rounds = 1): number {
  const [lo, hi] = DENSITY_TARGETS[density];
  return Math.min(MAX_ROSTER, (lo + rng.int(hi - lo + 1)) * Math.max(1, rounds));
}

/** One step toward `direction` (+1 harder, -1 softer); null at the end. */
export function relaxDensity(density: Density, direction: 1 | -1): Density | null {
  const i = DENSITY_ORDER.indexOf(density) + direction;
  return DENSITY_ORDER[i] ?? null;
}

/* -------------------------------- step 4 ---------------------------------- */

export const TWO_WAVE_SPLIT = 0.6;
/**
 * Three seconds, and 6000 was tried and taken back. At six the second wave
 * left the pressure model's six-second concurrency window, the discount made
 * every two-wave roster cheaper, and the fit bought more bodies to reach the
 * same band: survival fell from ten runs in twelve to nine and the costliest
 * rooms got costlier. The stagger is a beat, not a second fight.
 */
export const TWO_WAVE_DELAY_MS = 3000;
/**
 * 4000, from 2500. A wave every two and a half seconds stacked on the one
 * before it — the roster's time-to-kill is about six — so a trickle was a
 * single wave arriving in instalments. Four seconds lets one wave be mostly
 * down before the next, which is what makes staging read as staging.
 */
export const TRICKLE_STEP_MS = 4000;
/** Overflow that cannot fit in any existing wave opens one this far later. */
export const DEFER_STEP_MS = TRICKLE_STEP_MS;
export const TRICKLE_CHUNK: readonly [number, number] = [3, 4];

export interface PlannedWave {
  readonly at_ms: number;
  readonly enemies: readonly EnemyId[];
}

/** Per-wave trickle sizes, 2 or 3 each (doc 005 step 4). */
export function trickleChunks(rng: Rng, length = MAX_CONCURRENT_ENEMIES): number[] {
  const out: number[] = [];
  const span = TRICKLE_CHUNK[1] - TRICKLE_CHUNK[0] + 1;
  for (let i = 0; i < length; i++) out.push(TRICKLE_CHUNK[0] + rng.int(span));
  return out;
}

export function splitWaves(
  roster: readonly EnemyId[],
  structure: WaveStructure,
  chunks: readonly number[],
): PlannedWave[] {
  if (roster.length === 0) return [];
  switch (structure) {
    case "single":
      return [{ at_ms: 0, enemies: [...roster] }];
    case "two_waves": {
      if (roster.length === 1) return [{ at_ms: 0, enemies: [...roster] }];
      const first = Math.max(1, Math.min(roster.length - 1, Math.round(roster.length * TWO_WAVE_SPLIT)));
      return [
        { at_ms: 0, enemies: roster.slice(0, first) },
        { at_ms: TWO_WAVE_DELAY_MS, enemies: roster.slice(first) },
      ];
    }
    case "trickle": {
      const out: PlannedWave[] = [];
      let i = 0;
      let w = 0;
      while (i < roster.length) {
        const size = Math.max(1, chunks[w % Math.max(1, chunks.length)] ?? TRICKLE_CHUNK[0]);
        out.push({ at_ms: w * TRICKLE_STEP_MS, enemies: roster.slice(i, i + size) });
        i += size;
        w++;
      }
      return out;
    }
  }
}

/* -------------------------------- step 4b --------------------------------- */

/** Spawn-group name hints per entry pattern. Doc 004 owns the ids, so this
 *  matches on substrings and falls back to every group. */
export const ENTRY_HINTS: Readonly<Record<EntryPattern, readonly string[]>> = {
  far_front: ["far", "front", "north", "top", "back"],
  flanks: ["flank", "side", "east", "west", "left", "right"],
  surround: [],
  turrets_center: ["center", "centre", "core", "middle"],
};

function matches(group: SpawnGroup, hints: readonly string[]): boolean {
  const id = group.id.toLowerCase();
  return hints.some((h) => id.includes(h));
}

export function capacityOf(group: SpawnGroup): number {
  return Math.max(1, group.cells.length);
}

/**
 * The groups an enemy of this archetype may use. `turrets_center` puts
 * turrets in the middle and everyone else around them; every other entry
 * gives one list to the whole roster.
 */
export function groupsFor(
  groups: readonly SpawnGroup[],
  entry: EntryPattern,
  archetype: EnemyId,
): readonly SpawnGroup[] {
  if (groups.length === 0) return groups;
  if (entry === "surround") return groups;
  if (entry === "turrets_center") {
    const centre = groups.filter((g) => matches(g, ENTRY_HINTS.turrets_center));
    if (archetype === "turret") return centre.length > 0 ? centre : groups;
    const rest = groups.filter((g) => !matches(g, ENTRY_HINTS.turrets_center));
    return rest.length > 0 ? rest : groups;
  }
  const hinted = groups.filter((g) => matches(g, ENTRY_HINTS[entry]));
  return hinted.length > 0 ? hinted : groups;
}

export interface Assignment {
  readonly waves: readonly Wave[];
  /** Enemies that did not spawn in the wave they were planned for. Each one
   *  is counted once however many waves it ends up waiting. */
  readonly deferred: number;
}

/**
 * Doc 005 step 4: "overflow beyond a group's capacity moves to the next
 * wave". Capacity is per wave. Nothing is ever dropped: when the last wave
 * still has overflow, a new wave opens `DEFER_STEP_MS` later.
 */
export function assignSpawns(
  planned: readonly PlannedWave[],
  groups: readonly SpawnGroup[],
  entry: EntryPattern,
): Assignment {
  if (planned.length === 0) return { waves: [], deferred: 0 };
  if (groups.length === 0) throw new Error("assignSpawns needs at least one spawn group");

  interface Pending { readonly archetype: EnemyId; readonly planned: number }
  const times = planned.map((w) => w.at_ms);
  const queues: Pending[][] = planned.map((w, i) => w.enemies.map((e) => ({ archetype: e, planned: i })));
  const out: Wave[] = [];
  let carry: Pending[] = [];
  let deferred = 0;

  for (let i = 0; i < queues.length; i++) {
    const enemies = [...carry, ...queues[i]!];
    carry = [];
    const used = new Map<string, number>();
    const placed: { archetype: EnemyId; spawn_group: string }[] = [];
    for (const e of enemies) {
      const candidates = groupsFor(groups, entry, e.archetype);
      let chosen: SpawnGroup | null = null;
      let chosenUsed = Infinity;
      for (const g of candidates) {
        const u = used.get(g.id) ?? 0;
        if (u >= capacityOf(g)) continue;
        if (u < chosenUsed) {
          chosen = g;
          chosenUsed = u;
        }
      }
      if (chosen === null) {
        carry.push(e);
        continue;
      }
      used.set(chosen.id, chosenUsed + 1);
      if (i > e.planned) deferred++;
      placed.push({ archetype: e.archetype, spawn_group: chosen.id });
    }
    if (placed.length > 0) out.push({ at_ms: times[i]!, spawns: mergeSpawns(placed) });
    if (carry.length > 0 && i === queues.length - 1) {
      queues.push([]);
      times.push((times[i] ?? 0) + DEFER_STEP_MS);
    }
  }
  return { waves: out, deferred };
}

function mergeSpawns(
  placed: readonly { archetype: EnemyId; spawn_group: string }[],
): Wave["spawns"] {
  const keys: string[] = [];
  const byKey = new Map<string, { archetype: EnemyId; spawn_group: string; count: number }>();
  for (const p of placed) {
    const key = `${p.archetype}\u0000${p.spawn_group}`;
    const found = byKey.get(key);
    if (found) {
      found.count++;
    } else {
      keys.push(key);
      byKey.set(key, { archetype: p.archetype, spawn_group: p.spawn_group, count: 1 });
    }
  }
  return keys.map((k) => byKey.get(k)!);
}

/* ------------------------------ candidates -------------------------------- */

export interface Candidate {
  readonly roster: readonly EnemyId[];
  readonly waves: readonly Wave[];
  readonly pressure: number;
  readonly deferred: number;
}

/** Steps 4 and 5 for one concrete roster. */
export function buildFromRoster(
  roster: readonly EnemyId[],
  profile: EncounterProfile,
  room: Pick<RoomPlan, "measured" | "spawn_groups">,
  chunks: readonly number[],
  ctx?: PressureContext,
): Candidate {
  const c = ctx ?? contextFor(room, profile.composition);
  const rounds = Math.min(roundsOf(profile), roster.length);
  if (rounds <= 1) {
    const planned = splitWaves(roster, profile.wave_structure, chunks);
    const { waves, deferred } = assignSpawns(planned, room.spawn_groups, profile.entry);
    return { roster, waves, pressure: measurePressure(waves, c), deferred };
  }
  /*
   * Rounds (doc 014). Each is staged and measured as a fight of its own, and
   * the room's pressure is its hardest round's: the band is how intense the
   * room gets, and more rounds make it longer, not harder. Measured as one
   * schedule instead, the concurrency share spread every body's weight over
   * the whole roster, so a three-round room had to hold each round to a third
   * of a fight to stay in band.
   */
  const waves: Wave[] = [];
  let deferred = 0;
  let pressure = 0;
  let offset = 0;
  let start = 0;
  for (let r = 0; r < rounds; r++) {
    // Even shares in roster order, so the anchor opens the first round.
    const size = Math.round((roster.length - start) / (rounds - r));
    const part = roster.slice(start, start + size);
    start += size;
    const staged = assignSpawns(splitWaves(part, profile.wave_structure, chunks), room.spawn_groups, profile.entry);
    pressure = Math.max(pressure, measurePressure(staged.waves, c));
    deferred += staged.deferred;
    for (const w of staged.waves) waves.push({ ...w, at_ms: w.at_ms + offset });
    offset += (staged.waves.at(-1)?.at_ms ?? 0) + ROUND_GAP_MS;
  }
  return { roster, waves, pressure, deferred };
}

/* -------------------------------- step 6 ---------------------------------- */

export const MAX_COUNT_RETRIES = 5;

export type AssemblyOutcome = "in_band" | "count_adjusted" | "density_relaxed" | "preset";

export interface AssemblyDiagnostics {
  readonly outcome: AssemblyOutcome;
  /** Count adjustments made after the initial growth phase. */
  readonly retries: number;
  readonly relaxed_density: Density | null;
  readonly preset: PresetTier | null;
  readonly roster: readonly EnemyId[];
  readonly deferred: number;
  readonly chunks: readonly number[];
  readonly peak_concurrency: number;
  readonly in_band: boolean;
}

export interface EncounterAssembly {
  readonly plan: EncounterPlan;
  readonly diagnostics: AssemblyDiagnostics;
}

export interface AssembleOptions {
  /** Stamped on the plan when no preset was needed. */
  readonly source?: "jev" | "rule" | "random";
}

function fit(
  profile: EncounterProfile,
  room: Pick<RoomPlan, "measured" | "spawn_groups">,
  band: readonly [number, number],
  order: readonly EnemyId[],
  chunks: readonly number[],
  target: number,
  ctx: PressureContext,
): { candidate: Candidate; retries: number; ok: boolean } {
  const cap = maxCountFor(profile);
  const bounded = Math.max(1, Math.min(target, cap));
  const at = (n: number): Candidate => buildFromRoster(buildRoster(profile, n, order), profile, room, chunks, ctx);

  /*
   * Step 3, read as **density decides, the band guards**.
   *
   * It used to add bodies one at a time and stop at the first count whose
   * estimate entered the band — which is always the smallest such count, so
   * every room was the lightest thing its band allowed and `density` decided
   * nothing. Measured: a median combat room of seven seconds, 91% of rooms
   * cleared without losing a heart, against doc 014's thirty to forty.
   *
   * Now every count up to the cap is measured and, among those in the band,
   * the one nearest the density target is taken. A single wave is still held
   * down by the band, because its pressure climbs with every body; a staged
   * room, whose pressure is nearly flat in its size, gets the size that was
   * asked for.
   */
  let candidate = at(1);
  let best: Candidate | null = null;
  let bestGap = Infinity;
  for (let n = 1; n <= cap; n++) {
    candidate = at(n);
    if (!inBand(candidate.pressure, band)) continue;
    const gap = Math.abs(n - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }
  if (best) return { candidate: best, retries: 0, ok: true };
  candidate = at(bounded);

  // Step 6: adjust count by one and re-measure, up to five times.
  let count = bounded;
  for (let i = 1; i <= MAX_COUNT_RETRIES; i++) {
    const direction = candidate.pressure < band[0] ? 1 : -1;
    const next = Math.max(1, Math.min(cap, count + direction));
    if (next === count) return { candidate, retries: i - 1, ok: false };
    count = next;
    candidate = at(count);
    if (inBand(candidate.pressure, band)) return { candidate, retries: i, ok: true };
  }
  return { candidate, retries: MAX_COUNT_RETRIES, ok: false };
}

/** Fits an authored preset roster to the room it landed in. */
export function fitPreset(
  preset: EncounterPreset,
  profile: EncounterProfile,
  room: Pick<RoomPlan, "measured" | "spawn_groups">,
  band: readonly [number, number],
  chunks: readonly number[],
): { candidate: Candidate; profile: EncounterProfile } {
  // The preset is what runs when the asked-for profile could not be made to
  // work, so it brings its own entry too: an authored roster that has to
  // squeeze through one small spawn group is not a fallback.
  // It keeps the room's rounds: the preset is the fight, the rounds are the room's length.
  const presetProfile: EncounterProfile = { ...preset.profile, ...(profile.rounds ? { rounds: profile.rounds } : {}) };
  const ctx = contextFor(room, presetProfile.composition);
  const rounds = roundsOf(presetProfile);
  const start = Math.min(preset.roster.length, MAX_CONCURRENT_ENEMIES) * rounds;
  const at = (n: number): Candidate =>
    buildFromRoster(presetRoster(preset, n), presetProfile, room, chunks, ctx);

  let best = at(start);
  if (inBand(best.pressure, band)) return { candidate: best, profile: presetProfile };
  let bestError = bandError(best.pressure, band);
  for (let n = 1; n <= MAX_CONCURRENT_ENEMIES * rounds; n++) {
    if (n === start) continue;
    const c = at(n);
    if (inBand(c.pressure, band)) return { candidate: c, profile: presetProfile };
    const err = bandError(c.pressure, band);
    if (err < bestError - 1e-9) {
      bestError = err;
      best = c;
    }
  }
  return { candidate: best, profile: presetProfile };
}

export function bandError(p: number, band: readonly [number, number]): number {
  if (p < band[0]) return band[0] - p;
  if (p > band[1]) return p - band[1];
  return 0;
}

/**
 * Doc 005, "Assembly". Returns the plan plus why it looks the way it does.
 *
 * 1. Budget -- `band` is computed by `bandForRoom` and passed in.
 * 2. Mix    -- `MIX_RATIOS` plus the anchor, via `rosterOrder`/`buildRoster`.
 * 3. Count  -- `DENSITY_TARGETS`, growing until the estimate enters the band.
 * 4. Waves  -- `splitWaves` then `assignSpawns`, overflow deferred.
 * 5. Measure-- `measurePressure`.
 * 6. Retry  -- count +-1 five times, then one density step, then the preset.
 */
export function assembleEncounterDetailed(
  profile: EncounterProfile,
  room: Pick<RoomPlan, "measured" | "spawn_groups">,
  band: readonly [number, number],
  rng: Rng,
  options: AssembleOptions = {},
): EncounterAssembly {
  const source = options.source ?? "jev";
  const order = rosterOrder(profile.composition, rng);
  const chunks = trickleChunks(rng);
  const ctx = contextFor(room, profile.composition);

  const first = fit(profile, room, band, order, chunks, targetCount(profile.density, rng, roundsOf(profile)), ctx);
  /*
   * **A floor on bodies.** A single wave's pressure climbs with every body,
   * so a release band held it to three or four and a room was over before it
   * was a fight — "some rooms have almost no enemies". Below the floor the
   * same roster is staged as a trickle instead, whose pressure is nearly flat
   * in its size, and the room gets the bodies its density asked for.
   */
  if (first.ok && first.candidate.roster.length < MIN_ROOM_BODIES * roundsOf(profile) && profile.wave_structure !== "trickle") {
    const staged: EncounterProfile = { ...profile, wave_structure: "trickle" };
    const again = fit(staged, room, band, order, chunks, Math.max(MIN_ROOM_BODIES * roundsOf(profile), targetCount(profile.density, rng, roundsOf(profile))), ctx);
    if (again.ok && again.candidate.roster.length > first.candidate.roster.length)
      return done(staged, again.candidate, band, source, {
        outcome: "count_adjusted", retries: again.retries, relaxed_density: null, preset: null, chunks,
      });
  }
  if (first.ok) {
    return done(profile, first.candidate, band, source, {
      outcome: first.retries === 0 ? "in_band" : "count_adjusted",
      retries: first.retries,
      relaxed_density: null,
      preset: null,
      chunks,
    });
  }

  // Relax density one step toward whatever the band is asking for.
  const direction: 1 | -1 = first.candidate.pressure < band[0] ? 1 : -1;
  const relaxed = relaxDensity(profile.density, direction);
  let retriesUsed = first.retries;
  if (relaxed !== null) {
    const relaxedProfile: EncounterProfile = { ...profile, density: relaxed };
    const second = fit(relaxedProfile, room, band, order, chunks, targetCount(relaxed, rng, roundsOf(profile)), ctx);
    retriesUsed += second.retries;
    if (second.ok) {
      return done(relaxedProfile, second.candidate, band, source, {
        outcome: "density_relaxed",
        retries: retriesUsed,
        relaxed_density: relaxed,
        preset: null,
        chunks,
      });
    }
  }

  // Tiered preset for the band.
  const preset = presetForBand(band);
  const fitted = fitPreset(preset, profile, room, band, chunks);
  return done(fitted.profile, fitted.candidate, band, "rule", {
    outcome: "preset",
    retries: retriesUsed,
    relaxed_density: relaxed,
    preset: preset.tier,
    chunks,
  });
}

function done(
  profile: EncounterProfile,
  candidate: Candidate,
  band: readonly [number, number],
  source: "jev" | "rule" | "random",
  meta: {
    outcome: AssemblyOutcome;
    retries: number;
    relaxed_density: Density | null;
    preset: PresetTier | null;
    chunks: readonly number[];
  },
): EncounterAssembly {
  const plan: EncounterPlan = {
    profile,
    waves: candidate.waves,
    measured_pressure: candidate.pressure,
    band: [band[0], band[1]],
    elite_affixes: [],
    source,
  };
  return {
    plan,
    diagnostics: {
      outcome: meta.outcome,
      retries: meta.retries,
      relaxed_density: meta.relaxed_density,
      preset: meta.preset,
      roster: candidate.roster,
      deferred: candidate.deferred,
      chunks: meta.chunks,
      peak_concurrency: peakConcurrency(candidate.waves),
      in_band: inBand(candidate.pressure, band),
    },
  };
}

export function assembleEncounter(
  profile: EncounterProfile,
  room: Pick<RoomPlan, "measured" | "spawn_groups">,
  band: readonly [number, number],
  rng: Rng,
  options: AssembleOptions = {},
): EncounterPlan {
  return assembleEncounterDetailed(profile, room, band, rng, options).plan;
}

/* ------------------------------- validation ------------------------------- */

export interface ValidationIssue {
  readonly rule: string;
  readonly detail: string;
}

/** Doc 005, "Validation". */
export function validateEncounter(
  plan: EncounterPlan,
  room: Pick<RoomPlan, "spawn_groups">,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const capacity = new Map(room.spawn_groups.map((g) => [g.id, capacityOf(g)]));
  for (const wave of plan.waves) {
    const used = new Map<string, number>();
    for (const s of wave.spawns) {
      used.set(s.spawn_group, (used.get(s.spawn_group) ?? 0) + s.count);
    }
    for (const [id, n] of used) {
      const cap = capacity.get(id);
      if (cap === undefined) {
        issues.push({ rule: "spawn_group_exists", detail: `wave ${wave.at_ms}ms uses unknown group "${id}"` });
      } else if (n > cap) {
        issues.push({
          rule: "spawn_group_capacity",
          detail: `wave ${wave.at_ms}ms puts ${n} in "${id}" which holds ${cap}`,
        });
      }
    }
  }
  const peak = peakConcurrency(plan.waves);
  if (peak > MAX_CONCURRENT_ENEMIES) {
    issues.push({
      rule: "concurrency_cap",
      detail: `${peak} scheduled concurrent enemies exceeds ${MAX_CONCURRENT_ENEMIES}`,
    });
  }
  return issues;
}
