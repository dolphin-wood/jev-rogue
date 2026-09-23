/**
 * Sampling (design doc 002, "Sampling conventions"). Code samples; Jev never
 * picks the final answer. Argmax is not used for gameplay decisions.
 */
import type { Rng } from "../rng.ts";

export type Distribution = Readonly<Record<string, number>>;

/** Drops a key, renormalises, and reports the mass that was dropped. */
export function dropKey(dist: Distribution, key: string): { dist: Distribution; dropped: number } {
  const dropped = dist[key] ?? 0;
  const rest = Object.entries(dist).filter(([k]) => k !== key);
  const total = rest.reduce((a, [, v]) => a + v, 0);
  if (total <= 0) return { dist: {}, dropped };
  return { dist: Object.fromEntries(rest.map(([k, v]) => [k, v / total])), dropped };
}

export function restrict(dist: Distribution, keys: readonly string[]): Distribution {
  const allow = new Set(keys);
  const rest = Object.entries(dist).filter(([k]) => allow.has(k));
  const total = rest.reduce((a, [, v]) => a + v, 0);
  if (total <= 0) return Object.fromEntries(keys.map((k) => [k, 1 / keys.length]));
  return Object.fromEntries(rest.map(([k, v]) => [k, v / total]));
}

/**
 * p^(1/T), renormalised. T below 1 sharpens toward the mode, T above 1 spreads.
 * The variety levels in doc 007 map to 0.4 low, 0.7 medium, 1.0 high.
 */
export function withTemperature(dist: Distribution, temperature: number): Distribution {
  if (!(temperature > 0) || !Number.isFinite(temperature))
    throw new Error(`temperature ${temperature} must be finite and positive`);
  const exp = 1 / temperature;
  const raised = Object.entries(dist).map(([k, v]) => [k, Math.pow(Math.max(v, 0), exp)] as const);
  const total = raised.reduce((a, [, v]) => a + v, 0);
  if (total <= 0) {
    const n = raised.length || 1;
    return Object.fromEntries(raised.map(([k]) => [k, 1 / n]));
  }
  return Object.fromEntries(raised.map(([k, v]) => [k, v / total]));
}

export function sampleOne(dist: Distribution, rng: Rng): string {
  const keys = Object.keys(dist);
  if (keys.length === 0) throw new Error("cannot sample an empty distribution");
  return keys[rng.weighted(keys.map((k) => dist[k]!))]!;
}

export function sampleWithoutReplacement(dist: Distribution, n: number, rng: Rng): string[] {
  let remaining: Distribution = dist;
  const out: string[] = [];
  for (let i = 0; i < n && Object.keys(remaining).length > 0; i++) {
    const pick = sampleOne(remaining, rng);
    out.push(pick);
    remaining = dropKey(remaining, pick).dist;
  }
  return out;
}

/** The wildcard is uniform and is never influenced by Jev (doc 007). */
export function sampleUniform(pool: readonly string[], exclude: readonly string[], rng: Rng): string | null {
  const banned = new Set(exclude);
  const options = pool.filter((p) => !banned.has(p));
  return options.length ? rng.pick(options) : null;
}

/** Rank of a key, 1-based, by descending probability. Ties break by key order. */
export function rankIn(dist: Distribution, key: string): number {
  const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const i = sorted.findIndex(([k]) => k === key);
  return i < 0 ? -1 : i + 1;
}

/**
 * Validates a response distribution (doc 002, "Probability validation").
 * Returns null when valid, otherwise the reason it was rejected.
 */
export function validateDistribution(
  dist: Distribution,
  offered: readonly string[],
): string | null {
  const keys = Object.keys(dist);
  const offeredSet = new Set(offered);
  if (keys.length !== offered.length) return `expected ${offered.length} keys, got ${keys.length}`;
  let total = 0;
  for (const k of keys) {
    if (!offeredSet.has(k)) return `key ${k} was not offered`;
    const v = dist[k]!;
    if (!Number.isFinite(v) || v < 0) return `key ${k} has a non-finite or negative value`;
    total += v;
  }
  // Jev reports each probability to two decimals, so rounding alone drifts
  // the sum by up to half a hundredth per option (doc 002).
  const tolerance = Math.max(0.01, 0.005 * keys.length) + 1e-9;
  if (Math.abs(total - 1) > tolerance) return `probabilities sum to ${total.toFixed(4)}, not 1`;
  return null;
}
