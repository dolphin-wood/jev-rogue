/**
 * The boss fight's beat grid (doc 020).
 *
 * The fight is played to its theme: 168 BPM, four beats to the bar. The grid
 * is laid on the boss's own fight clock (`Enemy.bossFightMs`, zero when the
 * fight starts), so it is a pure function of the simulation and the harness,
 * the replays and the bench stay deterministic. The client starts the boss
 * piece at the same point of that clock, so the music follows the fight and
 * never the other way round.
 */

export const BOSS_BPM = 168;
/** One beat, in ms: 357.14… */
export const BEAT_MS = 60_000 / BOSS_BPM;
/** One bar of four beats: 1428.57… ms. */
export const BAR_MS = BEAT_MS * 4;

/**
 * **Phase III runs faster** (doc 020): from the landing that opens it, the
 * king's own clock — the fight clock the grid is laid on, and everything he
 * does — runs this much faster than real time, and the boss piece is played
 * at the same rate, so it is heard faster (and a little higher) and the grid
 * stays on the music. 168 BPM becomes about 185.
 */
export const BOSS_RAGE_TEMPO = 1.1;

/** A length of `n` beats, in ms. */
export const beats = (n: number): number => n * BEAT_MS;

/**
 * How long from `t` until the next line of the grid of `unit` (a beat or a
 * bar), in ms. A `t` that is on a line, or past one by no more than
 * `tolerance` — one sim step, when the caller is a stepped clock that can
 * only land on or just after a line — is on it, and the answer is 0.
 */
export function untilGrid(t: number, unit: number, tolerance = 0): number {
  let r = ((t % unit) + unit) % unit;
  // A beat is not a whole number of ms, so a time exactly on a line can come
  // back from the modulo a hair *under* a whole unit. That is the line.
  if (unit - r < 1e-6) r = 0;
  if (r <= tolerance + 1e-6) return 0;
  return unit - r;
}

/** How far `t` is past the last line of the grid of `unit`, in [0, unit). */
export function pastGrid(t: number, unit: number): number {
  const r = ((t % unit) + unit) % unit;
  return unit - r < 1e-6 ? 0 : r;
}
