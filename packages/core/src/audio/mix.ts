/**
 * Which effects start, how loud, and when the music steps aside.
 *
 * The catalogue says what each effect sounds like; this says what a room that
 * fires fifteen of them a second is allowed to sound like. Without it a boss
 * fight is a wall: every blow on the one big body plays in full with its
 * spell's tail on top, several times a second, and the music is ducked for
 * more than half the fight because each of those blows asks it to.
 *
 * Seven rules, applied in this order to every request:
 *
 * 1. **Retrigger floor.** One effect may not restart faster than its own
 *    `retriggerMs`.
 * 2. **Category start cap.** A category starts at most `voices` effects in
 *    any `windowMs` (see `CATEGORY_LIMIT`), so a wave dying together is one
 *    event.
 * 3. **One blow per body.** Hits on the same body within `SAME_TARGET_MS`
 *    are one hit. A body struck by a sword, a chain and a damage tick in the
 *    same instant was struck once, as far as the ear can tell.
 * 4. **One tail per school.** A spell's impact tail (`impact_*`) plays at
 *    most once per `TAIL_MS`. The tail says which element landed; the second
 *    one inside a quarter second says nothing new.
 * 5. **Repeats fade.** Each further play of an effect inside `REPEAT_MS` is
 *    quieter by `REPEAT_STEP`, down to `REPEAT_FLOOR`: the first of a flurry
 *    is the one that carries.
 * 6. **A voice budget, by priority.** At most `VOICES` combat effects sound
 *    at once. When full, a request outranking the lowest sounding voice
 *    steals it; otherwise the request is dropped. Priority is what the
 *    player needs to know to survive (being hurt, a telegraph, an enemy's
 *    blow arriving), then the answer to what they did,
 *    then what they did, then texture.
 * 7. **Density gain.** With `n` combat voices sounding, a new one starts at
 *    `sqrt(2 / n)` of its level, so a pile of sounds is not louder than the
 *    music it sits on. Survival cues are exempt.
 *
 * The music ducks for a short list of moments that matter, never for the
 * ordinary blow.
 *
 * Pure: no clock of its own, no randomness, no audio API. The client feeds
 * it time and durations; the harness can feed it a trace.
 */
import { CATEGORY_LIMIT, SFX_DEFS, type SfxCategory, type SfxName } from "./sfx.ts";

export const SAME_TARGET_MS = 140;
export const TAIL_MS = 250;
export const REPEAT_MS = 450;
export const REPEAT_STEP = 0.66;
export const REPEAT_FLOOR = 0.3;
export const VOICES = 4;

/** 3: survival information. 2: the answer to the player's action. 1: the action. 0: texture. */
export type SfxPriority = 0 | 1 | 2 | 3;

export function sfxPriority(name: SfxName): SfxPriority {
  if (/^(hurt|player_down|boss_|tele_|enemy_(lunge|swipe|spikes))/.test(name)) return 3;
  if (/^(kill|armour_break|hit_|dash_strike)/.test(name)) return 2;
  if (/^(swing|cast_|shoot_)/.test(name)) return 1;
  return 0;
}

/** The moments the music makes room for, and how far it dips. */
export const MUSIC_DUCK: Readonly<Partial<Record<SfxName, number>>> = {
  hurt: 0.35, player_down: 0.5, kill_heavy: 0.35, boss_impact: 0.25,
};

export interface MixRequest {
  readonly name: SfxName;
  /** Milliseconds, on any clock that only goes forward. */
  readonly now: number;
  /** How long this play will sound, in ms, for the voice budget. */
  readonly durationMs: number;
  /** The body a hit landed on, for rule 3. Omit when there is none. */
  readonly target?: number | string;
}

export interface MixDecision {
  /** Handle for this voice, so a later decision can name it for stealing. */
  readonly id: number;
  /** Multiplies the catalogue gain. */
  readonly gain: number;
  /** A voice the caller should stop now to make room, if any. */
  readonly steal?: number;
  /** How far to duck the music, or 0 for not at all. */
  readonly duck: number;
}

interface Voice { id: number; prio: SfxPriority; end: number }

export class SfxMixer {
  private readonly last = new Map<SfxName, number>();
  private readonly starts = new Map<SfxCategory, number[]>();
  private readonly lastHit = new Map<number | string, number>();
  private readonly lastTail = new Map<SfxName, number>();
  private readonly recent = new Map<SfxName, number[]>();
  private voices: Voice[] = [];
  private nextId = 1;

  /** Whether a request plays, and how. `null` is a no. */
  admit(r: MixRequest): MixDecision | null {
    const def = SFX_DEFS[r.name];
    if (!def) return null;
    const { now, name } = r;

    // 1. Retrigger floor.
    if (now - (this.last.get(name) ?? -Infinity) < def.retriggerMs) return null;

    // 2. Category start cap.
    const cap = CATEGORY_LIMIT[def.category];
    const started = (this.starts.get(def.category) ?? []).filter((t) => now - t < cap.windowMs);
    this.starts.set(def.category, started);
    if (started.length >= cap.voices) return null;

    // 3. One blow per body.
    const isHit = name.startsWith("hit_");
    if (isHit && r.target !== undefined && now - (this.lastHit.get(r.target) ?? -Infinity) < SAME_TARGET_MS) return null;

    // 4. One tail per school.
    const isTail = name.startsWith("impact_");
    if (isTail && now - (this.lastTail.get(name) ?? -Infinity) < TAIL_MS) return null;

    // 6. The voice budget, before anything is recorded, so a dropped request leaves no trace.
    const prio = sfxPriority(name);
    let steal: number | undefined;
    if (def.category === "combat") {
      this.voices = this.voices.filter((v) => v.end > now);
      if (this.voices.length >= VOICES) {
        const low = this.voices.reduce((a, b) => (b.prio < a.prio || (b.prio === a.prio && b.end < a.end) ? b : a));
        if (low.prio >= prio) return null;
        steal = low.id;
        this.voices = this.voices.filter((v) => v !== low);
      }
    }

    // Admitted: record it everywhere.
    this.last.set(name, now);
    started.push(now);
    if (isHit && r.target !== undefined) this.lastHit.set(r.target, now);
    if (isTail) this.lastTail.set(name, now);

    // 5. Repeats fade.
    const repeats = (this.recent.get(name) ?? []).filter((t) => now - t < REPEAT_MS);
    let gain = Math.max(REPEAT_FLOOR, Math.pow(REPEAT_STEP, repeats.length));
    repeats.push(now);
    this.recent.set(name, repeats);

    const id = this.nextId++;
    if (def.category === "combat") {
      this.voices.push({ id, prio, end: now + r.durationMs });
      // 7. Density gain.
      if (prio < 3) gain *= Math.min(1, Math.sqrt(2 / Math.max(2, this.voices.length)));
    }
    return { id, gain, steal, duck: MUSIC_DUCK[name] ?? 0 };
  }

  /** Forget a voice early, when the caller stopped it for its own reasons. */
  release(id: number): void {
    this.voices = this.voices.filter((v) => v.id !== id);
  }
}
