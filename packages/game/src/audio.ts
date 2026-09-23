/**
 * Sound playback.
 *
 * Three rules, all of them about a room that fires several shots a second
 * rather than about any single sound.
 *
 * - **Never the same variant twice in a row.** Re-roll until the index
 *   differs. This is the cheapest anti-fatigue measure there is and it is
 *   what stops a repeated effect collapsing into a machine noise.
 * - **Small random pitch and volume per play.** Small deliberately: wide
 *   ranges sound jarring rather than natural.
 * - **A floor on how often one effect may retrigger.** A wave of eight
 *   enemies dying together should read as one event, not as eight. Without
 *   this the mix clips exactly at the loudest moment of the fight.
 */
import Phaser from "phaser";

export const SFX = [
  "shoot_player", "shoot_enemy", "hit_enemy", "kill",
  "hurt", "dash", "pickup", "clear", "telegraph",
] as const;

export type SfxName = (typeof SFX)[number];

/** Variants per effect, matching the generator in the harness package. */
const VARIANTS: Readonly<Record<SfxName, number>> = {
  shoot_player: 4,
  shoot_enemy: 4,
  hit_enemy: 4,
  kill: 3,
  hurt: 2,
  dash: 3,
  pickup: 2,
  clear: 1,
  telegraph: 2,
};

/**
 * Per-effect mix. Gameplay sounds sit above everything else and are lightly
 * compressed at source so they cut through; the quiet ones here are the
 * high-frequency events, which would otherwise dominate the whole mix by
 * sheer count rather than by importance.
 */
const GAIN: Readonly<Record<SfxName, number>> = {
  shoot_player: 0.3,
  shoot_enemy: 0.34,
  hit_enemy: 0.42,
  kill: 0.62,
  hurt: 0.85,
  dash: 0.4,
  pickup: 0.7,
  clear: 0.7,
  telegraph: 0.45,
};

/** Minimum ms between two plays of the same effect. */
const RETRIGGER_MS: Readonly<Record<SfxName, number>> = {
  shoot_player: 45,
  shoot_enemy: 55,
  hit_enemy: 45,
  kill: 70,
  hurt: 220,
  dash: 120,
  pickup: 90,
  clear: 600,
  telegraph: 180,
};

export function preloadSfx(scene: Phaser.Scene): void {
  for (const name of SFX) {
    for (let v = 0; v < VARIANTS[name]; v++) {
      scene.load.audio(`${name}_${v}`, `sfx/${name}_${v}.wav`);
    }
  }
}

export class Sfx {
  private readonly last = new Map<SfxName, number>();
  private readonly lastVariant = new Map<SfxName, number>();
  private muted = false;

  constructor(private readonly scene: Phaser.Scene) {}

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** `pitch` multiplies the playback rate: a metal "clink" is a hit played high. */
  play(name: SfxName, pitch = 1): void {
    if (this.muted) return;
    const now = this.scene.time.now;
    const since = now - (this.last.get(name) ?? -Infinity);
    if (since < RETRIGGER_MS[name]) return;
    this.last.set(name, now);

    const count = VARIANTS[name];
    let v = Math.floor(Math.random() * count);
    // Re-roll rather than advancing in order: a cycle is itself a pattern the
    // ear picks up over a long fight.
    if (count > 1 && v === this.lastVariant.get(name)) v = (v + 1 + Math.floor(Math.random() * (count - 1))) % count;
    this.lastVariant.set(name, v);

    const key = `${name}_${v}`;
    if (!this.scene.cache.audio.exists(key)) return;
    this.scene.sound.play(key, {
      volume: GAIN[name] * (0.88 + Math.random() * 0.24),
      rate: (0.94 + Math.random() * 0.12) * pitch,
    });
  }
}
