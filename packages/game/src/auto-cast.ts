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
 * Input only. It decides which key to report as pressed and nothing else;
 * the simulation sees a press, exactly as if the player had made it.
 */

/** The least a ready key waits before it presses itself, in ms of fight time. */
export const AUTO_CAST_DELAY_MS = 700;
/** The most on top of that, drawn afresh for each wait. */
export const AUTO_CAST_SPREAD_MS = 900;
/** The share of the bar an auto-cast never spends into. */
export const AUTO_CAST_RESERVE = 0.3;

/** What the scene says about one key on this step. */
export interface AutoCastKey {
  /**
   * Whether this key may press itself now: it holds a spell that casts on a
   * tap (not a charge or a stance), it is ready, it is affordable above the
   * reserve, and there is a body to cast at.
   */
  readonly eligible: boolean;
}

export class AutoCaster {
  /** When each key may press itself, or null while it is not waiting. */
  private readonly due: (number | null)[] = [];

  constructor(private readonly random: () => number = Math.random) {}

  /**
   * The player pressed a spell key themselves: every wait starts over, so
   * the assist never casts on top of a choice just made.
   */
  noteManual(): void {
    this.due.fill(null);
  }

  /** Forgets every wait: a new room, a paused fight, the assist switched off. */
  reset(): void {
    this.due.length = 0;
  }

  /**
   * The key to press on this step, or null.
   *
   * `now` is fight time in ms (a paused fight does not count down a wait).
   * `free` is whether the caster could cast at all — no windup, recovery,
   * charge or guard running — so a key never presses into a refusal.
   */
  pick(now: number, keys: readonly AutoCastKey[], free: boolean): number | null {
    let best: number | null = null;
    keys.forEach((k, i) => {
      if (!k.eligible) { this.due[i] = null; return; }
      const due = this.due[i] ??= now + AUTO_CAST_DELAY_MS + this.random() * AUTO_CAST_SPREAD_MS;
      if (free && due <= now && (best === null || due < this.due[best]!)) best = i;
    });
    if (best !== null) this.due[best] = null;
    return best;
  }
}
