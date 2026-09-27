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
 * nearly back* (`AUTO_CAST_SOON_MS`, whatever the bar says), each by its
 * weight. **A key's weight grows with every draw it does not win** —
 * `AUTO_CAST_MISS_WEIGHT` a draw, up to `AUTO_CAST_MAX_WEIGHT` — and that
 * counts the draws it sat out: a key cooling down, out of reach, or an
 * enchant still running on the sword was skipped, not given its turn, so
 * it comes back owed. A cast, by the assist or by the player's own hand,
 * puts the key back to `AUTO_CAST_MIN_WEIGHT`. (It was a clock: a key's
 * weight grew back over six seconds whatever happened, so a key that sat
 * out a dozen draws came back no likelier than one that sat out none.)
 * A key drawn while still coming back **holds the
 * turn** — nothing else is auto-cast, and the bar saves up for it — until it
 * is ready, or until `AUTO_CAST_YIELD_MS` passes and the turn is drawn
 * again, so a key that keeps not arriving never stalls the rest.
 *
 * **The player's press takes the turn it answers.** A key the player casts
 * themselves has had its turn, so its weight goes back down rather than up;
 * and if the assist was holding the turn for that very key, the turn is
 * drawn again among the others, so the press does not leave the assist
 * waiting on a key that has just been spent.
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
  /**
   * Whether this key holds a spell the assist may ever press
   * (`autoCastable`), whatever it can do now. A held key that is not in a
   * draw sat it out, and its weight grows as if it had lost it.
   */
  readonly held: boolean;
}

export class AutoCaster {
  /** When each key may press itself, or null while it is not waiting. */
  private readonly due: (number | null)[] = [];
  /** Each key's weight in the draw; `AUTO_CAST_START_WEIGHT` until it has one. */
  private readonly weights: number[] = [];
  /** The key the draw gave the turn to, and when. */
  private turn: { key: number; at: number } | null = null;
  /** The player spent the key the turn was held for: draw again at once, without it. */
  private redrawWithout: number | null = null;

  constructor(private readonly random: () => number = Math.random) {}

  /** A key's weight in the draw now. */
  weight(key: number): number {
    return this.weights[key] ?? AUTO_CAST_START_WEIGHT;
  }

  /**
   * The player pressed a spell key themselves: every wait starts over, so
   * the assist never casts on top of a choice just made, and that key has
   * had its turn — its weight goes down, and a turn held for it is drawn
   * again among the others.
   */
  noteManual(key: number, _now: number): void {
    this.due.fill(null);
    this.weights[key] = AUTO_CAST_MIN_WEIGHT;
    if (this.turn?.key === key) {
      this.turn = null;
      this.redrawWithout = key;
    }
  }

  /** Forgets every wait and weight: a new room, a paused fight, the assist switched off. */
  reset(): void {
    this.due.length = 0;
    this.weights.length = 0;
    this.turn = null;
    this.redrawWithout = null;
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
    // The draw happens when some key is ready to go, or at once when the player spent the held key.
    const without = this.redrawWithout;
    if (!this.turn && (without !== null || keys.some((_, i) => ready(i)))) {
      this.redrawWithout = null;
      const pool = keys.flatMap((k, i) => (k.coming && i !== without ? [i] : []));
      if (pool.length > 0) {
        const weights = pool.map((i) => this.weight(i));
        let r = this.random() * weights.reduce((a, b) => a + b, 0);
        let key = pool[pool.length - 1]!;
        for (let n = 0; n < pool.length; n++) {
          r -= weights[n]!;
          if (r < 0) { key = pool[n]!; break; }
        }
        this.turn = { key, at: now };
        // Every other key lost this draw, whether it was in it or sat it out —
        // but not the one the player has just spent: it had its turn by hand.
        keys.forEach((k, i) => {
          if (i !== key && i !== without && k.held) this.weights[i] = Math.min(AUTO_CAST_MAX_WEIGHT, this.weight(i) + AUTO_CAST_MISS_WEIGHT);
        });
      }
    }
    if (!free || !this.turn || !ready(this.turn.key)) return null;
    const key = this.turn.key;
    this.turn = null;
    // Every wait starts over, not only this key's: the next cast waits its own beat.
    this.due.fill(null);
    this.weights[key] = AUTO_CAST_MIN_WEIGHT;
    return key;
  }
}
