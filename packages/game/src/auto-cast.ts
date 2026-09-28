/**
 * **Auto-cast**, an assist: the spell keys press themselves.
 *
 * **On a beat.** Once the hands are free — no windup, recovery, charge or
 * guard running — the assist waits a **random** moment
 * (`AUTO_CAST_DELAY_MS` plus up to `AUTO_CAST_SPREAD_MS`) and then draws
 * one key. So between any two auto-casts there is the cast's own windup and
 * recovery and then a fresh wait: one spell at a time, never two back to
 * back, and the random part keeps it from reading as a metronome the player
 * has to play around. The player's own press starts the wait over, so the
 * assist never casts on top of a choice just made.
 *
 * **The draw is among the keys that can go now**: back from cooldown, with
 * a body in reach, not still running, and paid for above the reserve. If
 * none can, the beat waits on, frame by frame, and no weight moves. Each key
 * in the draw counts by its weight:
 *
 * - the key cast goes back to `AUTO_CAST_MIN_WEIGHT`;
 * - **every other key gains** `AUTO_CAST_MISS_WEIGHT`, up to
 *   `AUTO_CAST_MAX_WEIGHT` — the ones in the draw and the ones that sat it
 *   out cooling, out of reach or still running: they were skipped, not
 *   given their turn, so they come back owed;
 * - a key the player casts by hand has had its turn, and goes back down too.
 *
 * **The bar is saved for the key most owed.** When the key with the most
 * weight is back but the bar is short of it, nothing is cast: any other key
 * would spend what it is waiting for. Without this the cheap short keys,
 * always affordable, held the bar under what a dear long one costs, and a
 * 20 s key went once in ten minutes of simulated fight.
 *
 * It also keeps a floor under the bar (`AUTO_CAST_RESERVE`): it never casts
 * a key whose cost would take the bar below that share, so a spell the
 * player reaches for is still paid for.
 *
 * **It does not break the player's stride.** A spell's windup and recovery
 * slow the caster, and a slow the player did not choose, dropped into a
 * walk or a run of swings, is a stumble. So the press goes as
 * `Input.spellAuto` and its cast keeps its timing but not its slow.
 *
 * Input only. It decides which key to report as pressed and nothing else;
 * the simulation sees a press, exactly as if the player had made it.
 */

import { TILE_PX } from "@jr/core";


/**
 * **How far a spell reaches, for auto-cast**, in px: the farthest a body can
 * stand and still be hit by a press aimed at it. A key casts itself only at
 * a body inside its own reach, so a short spell is not thrown into the air
 * at a body five tiles off, and a long one is not held back while one is.
 *
 * Read off the spell's shape and figures, not measured: a shot flies
 * `speed × lifetime`; a line or ring of eruptions reaches its last cell; a
 * thing put on the floor stands at `reach`; a ring round the caster reaches
 * its radius. Capped at `AUTO_CAST_MAX_REACH_PX`, so nothing is cast at a
 * body the player cannot see. Affixes that stretch a shot are not counted:
 * the reach is a spell's base, which errs short.
 */
export function autoCastReach(params: Readonly<Record<string, number | string>>): number {
  const n = (k: string, d = 0): number => (typeof params[k] === "number" ? params[k] as number : d);
  const shape = typeof params["shape"] === "string" ? params["shape"] : "bolt";
  const radius = n("radius");
  let reach: number;
  switch (shape) {
    case "eruption": {
      const pattern = params["pattern"] ?? "line";
      const first = n("first", 1.2) * TILE_PX, step = n("step", 1) * TILE_PX;
      // A rock out of the sky (Meteor) seeks the whole screen; one out of the floor, `reach` tiles.
      if (pattern === "scatter") reach = n("telegraph_ms") > 0 ? AUTO_CAST_MAX_REACH_PX : n("reach", 4) * TILE_PX + n("area") * TILE_PX;
      else reach = first + (Math.max(1, n("count", 1)) - 1) * step + radius;
      break;
    }
    case "field": case "vortex": case "pillar": case "boomerang": reach = n("reach", 64) + radius; break;
    // The ring lasts seconds: put it up as a body closes, not once it is inside.
    case "orbit": reach = n("orbit_radius", 48) + radius + 2 * TILE_PX; break;
    // A slow orb drifts out and strikes what comes within its reach.
    case "orb": reach = n("speed") * n("lifetime") + n("zap_reach"); break;
    // The sword's swing, and the wave it throws.
    case "enchant": reach = n("wave_reach", 80) + 40; break;
    // A companion shoots what is in its own reach.
    case "summon": reach = n("reach", 200); break;
    // Fire left under the feet: worth laying only with a body close.
    case "trail": reach = 3 * TILE_PX; break;
    default: reach = n("speed") * n("lifetime", 1.2) + radius;
  }
  return Math.min(AUTO_CAST_MAX_REACH_PX, reach);
}

/**
 * **Whether a spell may ever press itself.** Only one that casts on a tap:
 * a `charge` spell is a hold and a `stance` a guard, both the player's call;
 * and never a `dash` — Blink Strike, Leap Slam, Dash Slash — which moves the
 * body: the game throwing the player across the room is the one thing an
 * assist must not do.
 */
export function autoCastable(params: Readonly<Record<string, number | string>>, chargeMs: number): boolean {
  const shape = params["shape"];
  return chargeMs === 0 && shape !== "stance" && shape !== "dash";
}

/**
 * **An enchant or a companion is cast at the fight, not at a body.** An
 * enchant runs on the sword for seconds and is spent by the swings; a
 * companion follows the player and finds its own targets. So either goes up
 * whenever a body is awake in the room, however far. Held to a reach, the
 * enchant waited for a body inside four tiles, and a key with a long reach
 * beside it (Meteor) took every turn first.
 */
export function autoCastAnyReach(params: Readonly<Record<string, number | string>>): boolean {
  return params["shape"] === "enchant" || params["shape"] === "summon";
}

/** The farthest any key reaches for auto-cast: about what the screen shows round the player. */
export const AUTO_CAST_MAX_REACH_PX = 10 * TILE_PX;

/** The least the beat waits, from the hands coming free, in ms of fight time. */
export const AUTO_CAST_DELAY_MS = 700;
/** The most on top of that, drawn afresh for each wait. */
export const AUTO_CAST_SPREAD_MS = 900;
/** The share of the bar an auto-cast never spends into. */
export const AUTO_CAST_RESERVE = 0.3;
/** A key's weight in the draw just after it casts, by the assist or by hand. */
export const AUTO_CAST_MIN_WEIGHT = 0.1;
/** A key's weight before it has ever cast. */
export const AUTO_CAST_START_WEIGHT = 1;
/** What a key gains for each draw it does not win, in it or sitting it out. */
export const AUTO_CAST_MISS_WEIGHT = 0.5;
/** The most a key's weight grows to. */
export const AUTO_CAST_MAX_WEIGHT = 4;

/** What the scene says about one key on this step. */
export interface AutoCastKey {
  /**
   * Whether this key holds a spell the assist may ever press
   * (`autoCastable`), whatever it can do now. A held key that sits a draw
   * out gains weight as if it had lost it.
   */
  readonly held: boolean;
  /**
   * Whether it could go now but for the bar: held, back from cooldown, with
   * a body in its reach, and not still running (an enchant, a ring of
   * blades, a trail, a companion).
   */
  readonly ready: boolean;
  /** What a cast of it takes off the bar. */
  readonly cost: number;
}

/** The bar on this step: what is in it, the reserve it keeps, and all it can hold. */
export interface AutoCastBar {
  readonly mana: number;
  readonly floor: number;
  readonly max: number;
}

export class AutoCaster {
  /** When the next draw is, or null until the hands are free again. */
  private next: number | null = null;
  /** Each key's weight in the draw; `AUTO_CAST_START_WEIGHT` until it has one. */
  private readonly weights: number[] = [];

  constructor(private readonly random: () => number = Math.random) {}

  /** A key's weight in the draw now. */
  weight(key: number): number {
    return this.weights[key] ?? AUTO_CAST_START_WEIGHT;
  }

  /** The player cast a key themselves: it has had its turn, and the beat starts over. */
  noteManual(key: number): void {
    this.weights[key] = AUTO_CAST_MIN_WEIGHT;
    this.next = null;
  }

  /** Forgets the beat and every weight: a new room, a paused fight, the assist switched off. */
  reset(): void {
    this.next = null;
    this.weights.length = 0;
  }

  /**
   * The key to press on this step, or null.
   *
   * `now` is fight time in ms (a paused fight does not count down a wait).
   * `free` is whether the caster could cast at all — no windup, recovery,
   * charge or guard running — so a key never presses into a refusal.
   */
  pick(now: number, keys: readonly AutoCastKey[], free: boolean, bar: AutoCastBar): number | null {
    if (!free) return null;
    // The beat is counted from the hands coming free.
    if (this.next === null) { this.next = now + AUTO_CAST_DELAY_MS + this.random() * AUTO_CAST_SPREAD_MS; return null; }
    if (now < this.next) return null;
    const paid = (k: AutoCastKey) => bar.mana - k.cost >= bar.floor;
    // The bar saved for the key most owed, when it is back and the bar is short of it — and could ever pay.
    const top = Math.max(0, ...keys.map((k, i) => (k.held ? this.weight(i) : 0)));
    if (keys.some((k, i) => k.ready && !paid(k) && k.cost + bar.floor <= bar.max && this.weight(i) >= top)) return null;
    const pool = keys.flatMap((k, i) => (k.ready && paid(k) ? [i] : []));
    // Nothing can go: the beat waits on, and no weight moves.
    if (pool.length === 0) return null;
    this.next = null;
    const weights = pool.map((i) => this.weight(i));
    let r = this.random() * weights.reduce((a, b) => a + b, 0);
    let key = pool[pool.length - 1]!;
    for (let n = 0; n < pool.length; n++) {
      r -= weights[n]!;
      if (r < 0) { key = pool[n]!; break; }
    }
    // Every other key lost this draw, whether it was in it or sat it out.
    keys.forEach((k, i) => {
      if (i !== key && k.held) this.weights[i] = Math.min(AUTO_CAST_MAX_WEIGHT, this.weight(i) + AUTO_CAST_MISS_WEIGHT);
    });
    this.weights[key] = AUTO_CAST_MIN_WEIGHT;
    return key;
  }
}
