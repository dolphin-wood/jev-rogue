/**
 * Sound and music playback: one object, one setting (off, 8-bit or 16-bit),
 * two volumes.
 *
 * Two rules here are about variety rather than the mix:
 *
 * - **Never the same variant twice in a row.** Re-roll until the index
 *   differs. This is the cheapest anti-fatigue measure there is and it is
 *   what stops a repeated effect collapsing into a machine noise.
 * - **Small random pitch and volume per play.** Small deliberately: wide
 *   ranges sound jarring rather than natural.
 *
 * Everything about a room that fires fifteen effects a second — retrigger
 * floors, category caps, one blow per body, one tail per school, fading
 * repeats, a voice budget by priority, density gain and which moments duck
 * the music — is `SfxMixer` in core, so it is one pure, tested policy
 * rather than state scattered through this class. This class only carries
 * out its decisions: it starts the sound, stops the one it was told to steal,
 * and ducks the music.
 *
 * The catalogue itself — names, variants, gains, floors, categories — lives in
 * `@jr/core/audio` beside the synthesis that produced the files, so there is
 * one list rather than two that have to agree.
 */
import Phaser from "phaser";
import { SFX_DEFS, SFX_NAMES, SfxMixer, type SfxName } from "@jr/core";
import { StemMusic, type MusicStyle } from "./stem-music.ts";
import { RoomAmbience, type AmbienceKind } from "./ambience.ts";
import type { Mood, MusicState } from "@jr/core";

export { SFX_NAMES as SFX };
export type { SfxName };

/**
 * The one sound setting: off, or which of the two styles plays. The style is
 * the music and the effects together — an 8-bit score under recorded hits,
 * or the reverse, is a mix nobody chose.
 */
export type SoundStyle = "off" | MusicStyle;
export const SOUND_STYLES: readonly SoundStyle[] = ["off", "8bit", "16bit"];

/**
 * The effects each style has its own version of: the ones heard dozens of
 * times a minute, where the style is most audible. Everything else plays the
 * shared set in `assets/sfx`. Must match `assets/sfx-8bit` and
 * `assets/sfx-16bit` file for file.
 */
const STYLED: readonly SfxName[] = [
  "swing_light", "swing_heavy", "swing_spin", "dash_strike",
  "hit_light", "hit_enemy", "hit_heavy", "hit_armour", "kill", "hurt", "wall_hit",
  "cast_windup", "cast_arcane", "cast_storm", "cast_flame", "cast_frost", "cast_venom",
  "impact_frost", "impact_flame", "impact_storm", "impact_venom", "impact_stone",
  "pickup_coin",
];

const SFX_VOLUME_KEY = "jr.vol.sfx";
const MUSIC_VOLUME_KEY = "jr.vol.music";

/**
 * The alternative sound set, behind `?sfx=next`.
 *
 * Opt-in and nothing else: without the parameter the game loads `assets/sfx`
 * and uses the catalogue's own gains, exactly as before. With it, the same
 * filenames are loaded from `assets/sfx-next` instead, so the two sets can be
 * A/B'd in a real fight rather than one hit at a time.
 */
const NEXT_SET = ((): boolean => {
  try { return new URLSearchParams(location.search).get("sfx") === "next"; } catch { return false; }
})();

/**
 * The playback trims the next set comes with.
 *
 * Levels inside a category are set by RMS in the wav and `audio:check` holds
 * the spread to 9 LU, so the effects that fire sixty to a hundred times a
 * minute cannot be made quieter in the file without breaking that rule. They
 * are made quieter here, which is where a "this one fires too often to be
 * this loud" decision belongs anyway.
 */
const NEXT_GAIN: Partial<Record<SfxName, number>> = {
  wall_hit: 0.20, hit_enemy: 0.36, hit_light: 0.28, hit_armour: 0.32,
  swing_heavy: 0.26, swing_light: 0.19, cast_arcane: 0.22, cast_windup: 0.22,
  pickup_coin: 0.38, impact_frost: 0.36, impact_venom: 0.36, tele_aim: 0.30,
  ui_move: 0.34,
};

function storedVolume(key: string, fallback: number): number {
  try {
    // Nothing stored is the default, not zero: `Number(null)` is 0, and every
    // fresh browser started with both volumes silently at nothing.
    const raw = localStorage.getItem(key);
    if (raw === null || raw.trim() === "") return fallback;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function preloadSfx(scene: Phaser.Scene): void {
  for (const name of SFX_NAMES) {
    for (let v = 0; v < SFX_DEFS[name]!.variants; v++) {
      scene.load.audio(`${name}_${v}`, `${NEXT_SET ? "sfx-next" : "sfx"}/${name}_${v}.wav`);
    }
  }
  // Both styles' own effects: small (a few hundred KB each), and switching
  // style mid-run should not wait on a download.
  for (const style of ["8bit", "16bit"] as const) {
    for (const name of STYLED) {
      for (let v = 0; v < SFX_DEFS[name]!.variants; v++) {
        scene.load.audio(`${style}:${name}_${v}`, `sfx-${style}/${name}_${v}.wav`);
      }
    }
  }
}

/**
 * The one audio object. The settings menu talks to this and to nothing else:
 * `setStyle` is the one setting both effects and music obey (off, 8-bit or
 * 16-bit), and the two volumes are independent of it and of each other.
 */
export class Sfx {
  private readonly lastVariant = new Map<SfxName, number>();
  private readonly mixer = new SfxMixer();
  /** Sounding voices by mixer handle, so a steal can find what to stop. */
  private readonly voices = new Map<number, Phaser.Sound.BaseSound>();
  private style: SoundStyle = "off";
  private sfxVolume = storedVolume(SFX_VOLUME_KEY, 0.8);
  private musicVolume = storedVolume(MUSIC_VOLUME_KEY, 0.5);
  private musicHeld = false;
  private music: StemMusic | null = null;
  private ambience: RoomAmbience | null = null;
  private musicOut: GainNode | null = null;
  private pendingState: { state: MusicState; mood: Mood | null; bossPhase: number } = { state: "title", mood: null, bossPhase: 1 };

  constructor(private readonly scene: Phaser.Scene) {}

  /* ------------------------------ the switch ----------------------------- */

  /**
   * Off, 8-bit or 16-bit. Off stops effects and takes the music bus to
   * silence; a style picks both the score and the styled effects. Changing
   * style mid-room fades one score out and the other in.
   */
  setStyle(style: SoundStyle): void {
    this.style = style;
    this.applyMusicVolume();
    this.music?.setStyle(style === "off" ? null : style);
    this.ambience?.setStyle(style === "off" ? null : style);
  }

  getStyle(): SoundStyle {
    return this.style;
  }

  isEnabled(): boolean {
    return this.style !== "off";
  }

  /* ------------------------------- volumes ------------------------------- */

  setSfxVolume(v: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    try { localStorage.setItem(SFX_VOLUME_KEY, String(this.sfxVolume)); } catch { /* still applies */ }
    this.ambience?.setVolume(this.sfxVolume);
  }

  getSfxVolume(): number {
    return this.sfxVolume;
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    try { localStorage.setItem(MUSIC_VOLUME_KEY, String(this.musicVolume)); } catch { /* still applies */ }
    this.applyMusicVolume();
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  /* -------------------------------- effects ------------------------------ */

  /**
   * `pitch` multiplies the playback rate: a metal clink is a hit played high.
   * `target` is the body a hit landed on, so two blows on it at once are heard
   * as one (see `SfxMixer`).
   */
  play(name: SfxName, pitch = 1, target?: number): void {
    if (this.style === "off") return;
    const def = SFX_DEFS[name];
    if (!def) return;

    const count = def.variants;
    let v = Math.floor(Math.random() * count);
    // Re-roll rather than advancing in order: a cycle is itself a pattern the
    // ear picks up over a long fight.
    if (count > 1 && v === this.lastVariant.get(name)) v = (v + 1 + Math.floor(Math.random() * (count - 1))) % count;

    const styled = `${this.style}:${name}_${v}`;
    const key = this.scene.cache.audio.exists(styled) ? styled : `${name}_${v}`;
    if (!this.scene.cache.audio.exists(key)) return;
    const rate = (0.94 + Math.random() * 0.12) * pitch;
    const buffer = this.scene.cache.audio.get(key) as { duration?: number } | undefined;
    const durationMs = ((buffer?.duration ?? 0.25) * 1000) / rate;
    const d = this.mixer.admit({ name, now: this.scene.time.now, durationMs, target });
    if (!d) return;
    this.lastVariant.set(name, v);

    if (d.steal !== undefined) this.fadeOut(d.steal);
    if (d.duck > 0) this.music?.duck(d.duck);
    const gain = (NEXT_SET ? NEXT_GAIN[name] : undefined) ?? def.gain;
    const sound = this.scene.sound.add(key);
    this.voices.set(d.id, sound);
    sound.once("complete", () => { this.voices.delete(d.id); this.mixer.release(d.id); sound.destroy(); });
    sound.play({ volume: gain * d.gain * this.sfxVolume * (0.9 + Math.random() * 0.2), rate });
  }

  /**
   * A stolen voice leaves over 40 ms: stopped dead, it would click.
   *
   * The fade owns the sound from here: its own end-of-play handler is taken
   * off first, because a sound that finished inside the fade used to be
   * destroyed under it, and the next volume step then wrote to a destroyed
   * sound — an uncaught throw in the game loop, which froze the boss fight.
   * Every step also checks the sound is still alive, since a scene change
   * destroys every sound at once.
   */
  private fadeOut(id: number): void {
    const sound = this.voices.get(id) as (Phaser.Sound.BaseSound & { volume: number }) | undefined;
    this.voices.delete(id);
    if (!sound) return;
    sound.off("complete");
    const alive = (): boolean => !sound.pendingRemove && (sound as unknown as { manager?: unknown }).manager !== null;
    const from = sound.volume;
    const steps = 4;
    for (let k = 1; k <= steps; k++) {
      this.scene.time.delayedCall(k * 10, () => {
        if (!alive()) return;
        if (k < steps) { sound.volume = from * (1 - k / steps); return; }
        sound.stop();
        sound.destroy();
      });
    }
  }

  /* --------------------------------- music ------------------------------- */

  /**
   * Starts the audio context and the music.
   *
   * Browsers refuse to make a sound before a gesture, so this is called from
   * the first key press and the first click, and does nothing on every call
   * after the first that succeeds.
   */
  unlock(): void {
    const manager = this.scene.sound as Phaser.Sound.WebAudioSoundManager;
    const ctx = manager.context as AudioContext | undefined;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    if (!this.music) {
      this.musicOut = ctx.createGain();
      this.musicOut.connect(ctx.destination);
      this.music = new StemMusic(ctx, this.musicOut);
      this.applyMusicVolume();
      this.music.setState(this.pendingState.state, this.pendingState.mood, this.pendingState.bossPhase);
      this.music.setStyle(this.style === "off" ? null : this.style);
      this.ambience = new RoomAmbience(ctx, ctx.destination);
      this.ambience.setVolume(this.sfxVolume);
      this.ambience.setStyle(this.style === "off" ? null : this.style);
    }
  }

  /** How near the player is to the room's fire, dripping water and fountain, 0..1 each. */
  setAmbience(levels: Partial<Record<AmbienceKind, number>>): void {
    this.ambience?.setLevels(levels);
  }

  /**
   * What the music should be doing: the game state, the room's mood (which
   * remixes the layers) and, in the boss room, the boss's phase. Called every
   * frame; a repeat is free, so the caller never has to track edges.
   */
  setMusic(state: MusicState, mood: Mood | null, bossPhase = 1, bossClockMs?: number): void {
    this.pendingState = { state, mood, bossPhase };
    this.music?.setState(state, mood, bossPhase, bossClockMs);
  }

  musicState(): MusicState {
    return this.pendingState.state;
  }

  /** The boss lab's slowed or paused fight: the music cannot slow with it, so it goes quiet. */
  setMusicHeld(on: boolean): void {
    if (on === this.musicHeld) return;
    this.musicHeld = on;
    this.applyMusicVolume();
  }

  private applyMusicVolume(): void {
    if (!this.musicOut) return;
    const target = this.style !== "off" && !this.musicHeld ? this.musicVolume : 0;
    const ctx = this.musicOut.context;
    this.musicOut.gain.cancelScheduledValues(ctx.currentTime);
    this.musicOut.gain.setValueAtTime(this.musicOut.gain.value, ctx.currentTime);
    this.musicOut.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.25);
  }
}
