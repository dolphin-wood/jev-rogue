/**
 * The bullet pattern DSL (design doc 005, "Bullet pattern DSL").
 *
 * `PatternNode` itself lives in ../types.ts. This module owns the constructors
 * and the one piece of behaviour the DSL has: expanding a tree into the bullet
 * emissions it produces over a time window. `expandPattern` is pure -- no rng,
 * no clock, no world -- so the simulation, the harness and the tests all read
 * the same timing out of it.
 *
 * Timing contract:
 * - Every leaf fires its first volley at local time 0 and then every
 *   `interval` (or `cooldown`) seconds. A leaf runs until its owner dies or
 *   the enclosing `sequence` step ends.
 * - `sequence` runs each step for its `duration`, then the next, and loops.
 *   A step's child sees a clock that restarts at 0 every time the step starts.
 * - `parallel` runs every child on the same clock and never terminates.
 * - Emitted angles are offsets in degrees from the emission's `aim`
 *   direction, so the caller resolves "player" once per emission and stays
 *   the only thing that knows where the player is.
 */
import type { Aim, PatternNode } from "../types.ts";

export type LeafKind = "single" | "fan" | "ring" | "spiral" | "burst";

export interface BulletEmission {
  /** Radius multiplier from the leaf's `size`; 1 is the default bullet. */
  readonly size: number;
  /** Absolute time on the clock passed to `expandPattern`, in milliseconds. */
  readonly at_ms: number;
  /** The direction `angle_deg` is measured from. */
  readonly aim: Aim;
  /** Offset from the aim direction, in degrees. */
  readonly angle_deg: number;
  readonly speed: number;
  readonly from: LeafKind;
  /** Index path from the root of the pattern tree; ties break on it. */
  readonly path: readonly number[];
}

/** A `burst` has no spread parameter in the DSL; this is the arc it covers. */
export const BURST_SPREAD_DEG = 40;

/** Refuse to expand a window that would produce an unbounded volley count. */
export const MAX_VOLLEYS_PER_NODE = 4096;

/* ------------------------------ constructors ------------------------------ */

export function single(p: {
  speed: number; aim: Aim; interval: number; size?: number;
}): PatternNode {
  return { kind: "single", speed: p.speed, aim: p.aim, interval: p.interval, ...opt(p) };
}

export function fan(p: {
  count: number; spread_deg: number; speed: number; aim: Aim; interval: number;
  size?: number; gap_deg?: number;
}): PatternNode {
  return {
    kind: "fan",
    count: p.count,
    spread_deg: p.spread_deg,
    speed: p.speed,
    aim: p.aim,
    interval: p.interval,
    ...opt(p),
  };
}

export function ring(p: {
  count: number; speed: number; interval: number; rotate_deg: number;
  size?: number; gap_deg?: number;
}): PatternNode {
  return {
    kind: "ring",
    count: p.count,
    speed: p.speed,
    interval: p.interval,
    rotate_deg: p.rotate_deg,
    ...opt(p),
  };
}

export function spiral(p: {
  arms: number; angular_speed: number; speed: number; interval: number; size?: number;
}): PatternNode {
  return {
    kind: "spiral",
    arms: p.arms,
    angular_speed: p.angular_speed,
    speed: p.speed,
    interval: p.interval,
    ...opt(p),
  };
}

export function burst(p: {
  count: number; speed_min: number; speed_max: number; aim: Aim; cooldown: number; size?: number;
}): PatternNode {
  return {
    kind: "burst",
    count: p.count,
    speed_min: p.speed_min,
    speed_max: p.speed_max,
    aim: p.aim,
    cooldown: p.cooldown,
    ...opt(p),
  };
}

/** Carries the optional shape fields through without writing undefined keys. */
function opt(p: { size?: number; gap_deg?: number }): { size?: number; gap_deg?: number } {
  return {
    ...(p.size === undefined ? {} : { size: p.size }),
    ...(p.gap_deg === undefined ? {} : { gap_deg: p.gap_deg }),
  };
}

/** Emits nothing. Silence is a pattern: it is where the player repositions. */
export function rest(): PatternNode {
  return { kind: "rest" };
}

export function sequence(steps: readonly { pattern: PatternNode; duration: number }[]): PatternNode {
  return { kind: "sequence", steps };
}

export function parallel(patterns: readonly PatternNode[]): PatternNode {
  return { kind: "parallel", patterns };
}

/* -------------------------------- expansion ------------------------------- */

const EPS = 1e-9;

/** Fixed aim used by the kinds whose angles are absolute rather than aimed. */
const ABSOLUTE: Aim = "fixed:0";

/** Evenly spaced offsets covering `spread` degrees, centred on 0. */
function spreadOffsets(count: number, spread: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const step = spread / (count - 1);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(-spread / 2 + i * step);
  return out;
}

/** Volley indices whose time `k * period` falls in [t0, t1). */
function volleys(period: number, t0: number, t1: number, kind: string): number[] {
  if (!(period > 0) || !Number.isFinite(period)) {
    throw new Error(`pattern "${kind}" needs a positive interval, got ${period / 1000}s`);
  }
  const first = Math.max(0, Math.ceil(t0 / period - EPS));
  const out: number[] = [];
  for (let k = first; k * period < t1 - EPS; k++) {
    if (out.length >= MAX_VOLLEYS_PER_NODE) {
      throw new Error(`pattern "${kind}" would emit over ${MAX_VOLLEYS_PER_NODE} volleys in one window`);
    }
    out.push(k);
  }
  return out;
}

function expandNode(
  node: PatternNode,
  t0: number,
  t1: number,
  path: readonly number[],
  out: BulletEmission[],
): void {
  switch (node.kind) {
    case "rest":
      return;
    case "single": {
      for (const k of volleys(node.interval * 1000, t0, t1, "single")) {
        out.push({
          at_ms: k * node.interval * 1000,
          aim: node.aim,
          angle_deg: 0,
          speed: node.speed,
          size: node.size ?? 1,
          from: "single",
          path,
        });
      }
      return;
    }
    case "fan": {
      const offsets = spreadOffsets(node.count, node.spread_deg);
      for (const k of volleys(node.interval * 1000, t0, t1, "fan")) {
        const at = k * node.interval * 1000;
        for (const off of offsets) {
          if (inGap(off, node.gap_deg)) continue;
          out.push({ at_ms: at, aim: node.aim, angle_deg: off, speed: node.speed, size: node.size ?? 1, from: "fan", path });
        }
      }
      return;
    }
    case "ring": {
      if (node.count <= 0) return;
      const step = 360 / node.count;
      for (const k of volleys(node.interval * 1000, t0, t1, "ring")) {
        const at = k * node.interval * 1000;
        const base = k * node.rotate_deg;
        for (let i = 0; i < node.count; i++) {
          // The gap rotates with the ring, so the safe sector sweeps and the
          // player has to keep moving to stay in it rather than parking.
          const offset = i * step;
          if (inGap(offset - 180, node.gap_deg)) continue;
          out.push({
            at_ms: at,
            aim: ABSOLUTE,
            angle_deg: normalizeDeg(base + offset),
            speed: node.speed,
            size: node.size ?? 1,
            from: "ring",
            path,
          });
        }
      }
      return;
    }
    case "spiral": {
      if (node.arms <= 0) return;
      const step = 360 / node.arms;
      for (const k of volleys(node.interval * 1000, t0, t1, "spiral")) {
        const at = k * node.interval * 1000;
        // Arms turn continuously, so the base angle follows elapsed seconds.
        const base = node.angular_speed * (at / 1000);
        for (let i = 0; i < node.arms; i++) {
          out.push({
            at_ms: at,
            aim: ABSOLUTE,
            angle_deg: normalizeDeg(base + i * step),
            speed: node.speed,
            size: node.size ?? 1,
            from: "spiral",
            path,
          });
        }
      }
      return;
    }
    case "burst": {
      const offsets = spreadOffsets(node.count, BURST_SPREAD_DEG);
      for (const k of volleys(node.cooldown * 1000, t0, t1, "burst")) {
        const at = k * node.cooldown * 1000;
        for (let i = 0; i < offsets.length; i++) {
          const f = offsets.length === 1 ? 0 : i / (offsets.length - 1);
          out.push({
            at_ms: at,
            aim: node.aim,
            angle_deg: offsets[i]!,
            speed: node.speed_min + (node.speed_max - node.speed_min) * f,
            size: node.size ?? 1,
            from: "burst",
            path,
          });
        }
      }
      return;
    }
    case "sequence": {
      const durations = node.steps.map((s) => s.duration * 1000);
      const total = durations.reduce((a, b) => a + b, 0);
      if (!(total > 0) || !Number.isFinite(total)) {
        throw new Error("pattern \"sequence\" needs a positive total step duration");
      }
      let cycleStart = Math.floor(t0 / total) * total;
      let guard = 0;
      while (cycleStart < t1 - EPS) {
        if (++guard > MAX_VOLLEYS_PER_NODE) {
          throw new Error(`pattern "sequence" would loop over ${MAX_VOLLEYS_PER_NODE} times in one window`);
        }
        let stepStart = cycleStart;
        for (let i = 0; i < node.steps.length; i++) {
          const d = durations[i]!;
          const stepEnd = stepStart + d;
          if (stepEnd > t0 + EPS && stepStart < t1 - EPS) {
            const localFrom = Math.max(t0, stepStart) - stepStart;
            const localTo = Math.min(t1, stepEnd) - stepStart;
            const inner: BulletEmission[] = [];
            expandNode(node.steps[i]!.pattern, localFrom, localTo, [...path, i], inner);
            for (const e of inner) out.push({ ...e, at_ms: e.at_ms + stepStart });
          }
          stepStart = stepEnd;
        }
        cycleStart += total;
      }
      return;
    }
    case "parallel": {
      for (let i = 0; i < node.patterns.length; i++) {
        expandNode(node.patterns[i]!, t0, t1, [...path, i], out);
      }
      return;
    }
  }
}

function normalizeDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

function comparePath(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/**
 * Every bullet `node` emits with an emission time in [elapsedMs, elapsedMs +
 * windowMs), on the pattern's own clock (0 = the moment the pattern started).
 * Sorted by time, then by position in the tree.
 */
/** True when an offset falls inside the pattern's declared safe sector. */
function inGap(offsetDeg: number, gapDeg: number | undefined): boolean {
  if (!gapDeg || gapDeg <= 0) return false;
  const d = Math.abs(normalizeDeg(offsetDeg + 180) - 180);
  return d <= gapDeg / 2;
}

export function expandPattern(
  node: PatternNode,
  elapsedMs: number,
  windowMs: number,
): BulletEmission[] {
  if (!(windowMs > 0)) return [];
  if (!(elapsedMs >= 0) || !Number.isFinite(elapsedMs)) {
    throw new Error(`expandPattern needs a non-negative elapsed time, got ${elapsedMs}`);
  }
  const out: BulletEmission[] = [];
  expandNode(node, elapsedMs, elapsedMs + windowMs, [], out);
  out.sort((a, b) => a.at_ms - b.at_ms || comparePath(a.path, b.path) || a.angle_deg - b.angle_deg);
  return out;
}

/** Bullets per second a pattern sustains, averaged over `windowMs`. */
export function emissionRate(node: PatternNode, windowMs: number): number {
  return (expandPattern(node, 0, windowMs).length * 1000) / windowMs;
}

/** The leaf kinds a tree contains, in tree order, deduplicated. */
export function leafKinds(node: PatternNode): LeafKind[] {
  const seen: LeafKind[] = [];
  const walk = (n: PatternNode): void => {
    if (n.kind === "sequence") {
      for (const s of n.steps) walk(s.pattern);
    } else if (n.kind === "parallel") {
      for (const p of n.patterns) walk(p);
    } else if (n.kind !== "rest" && !seen.includes(n.kind)) {
      // A rest emits nothing, so it is not a leaf anything can be said about.
      seen.push(n.kind);
    }
  };
  walk(node);
  return seen;
}
