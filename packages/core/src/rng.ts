/**
 * Keyed deterministic random streams (design doc 002, "Randomness").
 *
 * Every draw comes from a stream named by a key, so the order in which
 * asynchronous Jev responses arrive can never change which numbers a decision
 * consumes. `rng("gameplay")` advances inside the simulation step; each
 * decision uses its own key.
 */

/** FNV-1a over the string form of the key parts, so keys are stable across runs. */
export function hashKey(seed: string, parts: readonly (string | number | null)[]): number {
  let h = 0x811c9dc5;
  const s = seed + "\u0000" + parts.map((p) => (p === null ? "~" : String(p))).join("\u0000");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates, returns a new array. */
  shuffle<T>(items: readonly T[]): T[];
  /** Index sampled from non-negative weights. Throws if the total is not positive. */
  weighted(weights: readonly number[]): number;
  /** Number of draws taken, for assertions about consumption order. */
  readonly draws: number;
}

export function mulberry32(seedInt: number): Rng {
  let a = seedInt >>> 0;
  let draws = 0;
  const next = (): number => {
    draws++;
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (n) => {
      if (!Number.isInteger(n) || n <= 0) throw new Error(`int(${n}) needs a positive integer`);
      return Math.floor(next() * n);
    },
    range: (lo, hi) => lo + next() * (hi - lo),
    pick: (items) => {
      if (items.length === 0) throw new Error("pick from an empty list");
      return items[Math.floor(next() * items.length)]!;
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    weighted: (weights) => {
      let total = 0;
      for (const w of weights) {
        if (!(w >= 0) || !Number.isFinite(w)) throw new Error(`weight ${w} is not finite and non-negative`);
        total += w;
      }
      if (total <= 0) throw new Error("weighted() needs a positive total weight");
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i]!;
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    get draws() {
      return draws;
    },
  };
  return rng;
}

/** Root of a run's randomness. `stream(...key)` is the only way to get an Rng. */
export class RngSource {
  // Written out rather than a constructor parameter property: Node's
  // strip-only TypeScript mode, which every CLI in this repo runs under,
  // rejects parameter properties because they emit code.
  readonly seed: string;
  constructor(seed: string) {
    this.seed = seed;
  }
  stream(...key: (string | number | null)[]): Rng {
    return mulberry32(hashKey(this.seed, key));
  }
}
