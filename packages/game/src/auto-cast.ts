/**
 * **Auto-cast**, an assist: the spell keys press themselves.
 *
 * Not the moment a key is ready. A spell cast the instant its cooldown ends
 * spends the bar as fast as the cooldowns allow, and leaves nothing for the
 * press the player was about to make themselves — so a ready key waits a
 * **random** moment first (`AUTO_CAST_DELAY_MS` plus up to
 * `AUTO_CAST_SPREAD_MS`), and the player's own press in that time wins: it
 * casts what they chose and starts every key's wait again. The random part
 * is what keeps it from reading as a metronome the player has to play
 * around.
 *
 * It also keeps a floor under the bar (`AUTO_CAST_RESERVE`): it never casts
 * a key whose cost would take the bar below that share, so a spell the
 * player reaches for is still paid for.
 *
 * **Which key, by a weighted draw.** Left to "whichever is ready first",
 * the key with the shortest cooldown wins every time: it comes back first,
 * and — cheap as short-cooldown spells are — it keeps the bar under what
 * the dearer keys cost, so they never become affordable either. So when a
 * key is due, the turn is **drawn** among every key that is ready *or
 * nearly back* (`AUTO_CAST_SOON_MS`, whatever the bar says), each weighted
 * by how long since it last cast (`recencyWeight`): a key just cast weighs
 * `AUTO_CAST_MIN_WEIGHT`, and it grows back to 1 over
 * `AUTO_CAST_FORGET_MS`. A key drawn while still coming back **holds the
 * turn** — nothing else is auto-cast, and the bar saves up for it — until it
 * is ready, or until `AUTO_CAST_YIELD_MS` passes and the turn is drawn
 * again, so a key that keeps not arriving never stalls the rest.
 *
 * **One cast at a time, on a beat.** A cast starts every key's wait over,
 * as the player's own press does, and no wait starts while a cast is still
 * in the hand (`free`): so between any two auto-casts there is the cast's
 * own windup and recovery and then a fresh random wait. Waits only used to
 * be cleared for the key that cast, so a key whose wait had already run out
 * went the moment the caster was free again — two spells back to back,
 * which reads as a stutter rather than a rhythm.
 *
 * **It does not break the player's stride.** A spell's windup and recovery
 * slow the caster, and a slow the player did not choose, dropped into a
 * walk or a run of swings, is a stumble. So the press goes as
 * `Input.spellAuto` and its cast keeps its timing but not its slow. (It
 * first waited for a gap — standing, or the sword's rest — which left a
 * player who fights on the move with no heavy spell cast for them at all.)
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

/** The farthest any key reaches for auto-cast: about what the screen shows round the player. */
export const AUTO_CAST_MAX_REACH_PX = 10 * TILE_PX;

/** The least a ready key waits before it presses itself, in ms of fight time. */
export const AUTO_CAST_DELAY_MS = 700;
/** The most on top of that, drawn afresh for each wait. */
export const AUTO_CAST_SPREAD_MS = 900;
/** The share of the bar an auto-cast never spends into. */
export const AUTO_CAST_RESERVE = 0.3;
/** How near its return a key has to be to be in the draw while not yet ready. */
export const AUTO_CAST_SOON_MS = 1500;
/** The longest a drawn key holds the turn before it is drawn again. */
export const AUTO_CAST_YIELD_MS = 3000;
/** A key's weight in the draw the moment after it casts. */
export const AUTO_CAST_MIN_WEIGHT = 0.1;
/** How long after a cast a key's weight takes to grow back to 1. */
export const AUTO_CAST_FORGET_MS = 6000;

/**
 * A key's weight in the draw: `AUTO_CAST_MIN_WEIGHT` just after it cast,
 * rising in a straight line to 1 over `AUTO_CAST_FORGET_MS`; 1 for a key
 * that has not cast at all.
 */
export function recencyWeight(sinceMs: number): number {
  const k = Math.max(0, Math.min(1, sinceMs / AUTO_CAST_FORGET_MS));
  return AUTO_CAST_MIN_WEIGHT + (1 - AUTO_CAST_MIN_WEIGHT) * k;
}

/** What the scene says about one key on this step. */
export interface AutoCastKey {
  /**
   * Whether this key may press itself now: it holds a spell that casts on a
   * tap (not a charge or a stance), it is ready, it is affordable above the
   * reserve, and there is a body to cast at.
   */
  readonly eligible: boolean;
  /**
   * Whether this key is **in the draw**: a tap-cast spell with a body to
   * cast at, back within `AUTO_CAST_SOON_MS`, and one the bar could ever pay
   * for above the reserve — whether or not it can pay now. Eligible implies
   * coming.
   */
  readonly coming: boolean;
}

export class AutoCaster {
  /** When each key may press itself, or null while it is not waiting. */
  private readonly due: (number | null)[] = [];
  /** When each key last cast, by the assist or by the player. */
  private readonly last: number[] = [];
  /** The key the draw gave the turn to, and when. */
  private turn: { key: number; at: number } | null = null;

  constructor(private readonly random: () => number = Math.random) {}

  /**
   * The player pressed a spell key themselves: every wait starts over, so
   * the assist never casts on top of a choice just made, and that key has
   * had its turn.
   */
  noteManual(key: number, now: number): void {
    this.due.fill(null);
    this.last[key] = now;
    this.turn = null;
  }

  /** Forgets every wait: a new room, a paused fight, the assist switched off. */
  reset(): void {
    this.due.length = 0;
    this.last.length = 0;
    this.turn = null;
  }

  /**
   * The key to press on this step, or null.
   *
   * `now` is fight time in ms (a paused fight does not count down a wait).
   * `free` is whether the caster could cast at all — no windup, recovery,
   * charge or guard running — so a key never presses into a refusal.
   */
  pick(now: number, keys: readonly AutoCastKey[], free: boolean): number | null {
    keys.forEach((k, i) => {
      if (!k.eligible) this.due[i] = null;
      // A wait starts only with the hands free, so it is counted from the end of the last cast.
      else if (free) this.due[i] ??= now + AUTO_CAST_DELAY_MS + this.random() * AUTO_CAST_SPREAD_MS;
    });
    const ready = (i: number) => keys[i]!.eligible && this.due[i] != null && this.due[i]! <= now;
    // A turn given to a key that has dropped out of the draw, or waited too long, is drawn again.
    if (this.turn && (!keys[this.turn.key]?.coming || now - this.turn.at > AUTO_CAST_YIELD_MS)) this.turn = null;
    // The draw happens when some key is ready to go, among every key in it.
    if (!this.turn && keys.some((_, i) => ready(i))) {
      const pool = keys.flatMap((k, i) => (k.coming ? [i] : []));
      const weights = pool.map((i) => recencyWeight(now - (this.last[i] ?? -Infinity)));
      let r = this.random() * weights.reduce((a, b) => a + b, 0);
      let key = pool[pool.length - 1]!;
      for (let n = 0; n < pool.length; n++) {
        r -= weights[n]!;
        if (r < 0) { key = pool[n]!; break; }
      }
      this.turn = { key, at: now };
    }
    if (!free || !this.turn || !ready(this.turn.key)) return null;
    const key = this.turn.key;
    this.turn = null;
    // Every wait starts over, not only this key's: the next cast waits its own beat.
    this.due.fill(null);
    this.last[key] = now;
    return key;
  }
}
