/**
 * Room ambience: the sound of what is in the room, not a layer of the score.
 *
 * A dungeon room is indoors, so there is no wind in it; what makes a sound is
 * the furniture. A brazier crackles, a drain grate drips, a fountain runs.
 * One loop per kind, whose level is set by the nearest source of that kind —
 * loud enough to place it when the player is beside it, gone a few tiles
 * away — so each room sounds like its own contents, and a room with none of
 * them is just the music.
 *
 * Levels sit well under the score (see `NEAR`): ambience that competes with
 * the music is heard as noise rather than as a place.
 */
import type { MusicStyle } from "./stem-music.ts";

export type AmbienceKind = "fire" | "drip" | "fountain";
export const AMBIENCE_KINDS: readonly AmbienceKind[] = ["fire", "drip", "fountain"];

/**
 * The loop's gain at full proximity. The files are levelled to an RMS of 0.1
 * (-20 dBFS); against the music bus this puts a source the player stands
 * beside about 18 dB under the score.
 */
const NEAR: Readonly<Record<AmbienceKind, number>> = { fire: 0.05, drip: 0.06, fountain: 0.045 };
const RAMP_S = 0.35;

interface Loop { src: AudioBufferSourceNode; g: GainNode }

export class RoomAmbience {
  private readonly out: GainNode;
  private readonly cache = new Map<string, Promise<AudioBuffer>>();
  private loops = new Map<AmbienceKind, Loop>();
  private style: MusicStyle | null = null;
  private levels: Partial<Record<AmbienceKind, number>> = {};
  private epoch = 0;

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {
    this.out = ctx.createGain();
    this.out.connect(destination);
  }

  /** The style's loops replace the old ones; none plays while the style is off. */
  setStyle(style: MusicStyle | null): void {
    if (style === this.style) return;
    this.style = style;
    const epoch = ++this.epoch;
    const old = this.loops;
    this.loops = new Map();
    const now = this.ctx.currentTime;
    for (const l of old.values()) { l.g.gain.setTargetAtTime(0, now, 0.1); l.src.stop(now + 0.6); }
    if (!style) return;
    for (const kind of AMBIENCE_KINDS) void this.start(kind, style, epoch);
  }

  /**
   * How close the nearest source of each kind is, 0 (none, or out of
   * earshot) to 1 (beside it). Called every frame; unchanged levels cost
   * nothing.
   */
  setLevels(levels: Partial<Record<AmbienceKind, number>>): void {
    const now = this.ctx.currentTime;
    for (const kind of AMBIENCE_KINDS) {
      const v = levels[kind] ?? 0;
      if (Math.abs(v - (this.levels[kind] ?? 0)) < 0.01) continue;
      this.levels[kind] = v;
      this.loops.get(kind)?.g.gain.setTargetAtTime(v * v * NEAR[kind], now, RAMP_S / 3);
    }
  }

  /** The ambience follows the effects volume: it is sound from the room, not music. */
  setVolume(v: number): void {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }

  private async start(kind: AmbienceKind, style: MusicStyle, epoch: number): Promise<void> {
    let buffer: AudioBuffer;
    try { buffer = await this.load(style, kind); } catch { return; }
    if (epoch !== this.epoch) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = this.ctx.createGain();
    const v = this.levels[kind] ?? 0;
    g.gain.value = v * v * NEAR[kind];
    src.connect(g).connect(this.out);
    // Each kind starts at its own point in its loop, so two rooms' fires do not crackle in step.
    src.start(this.ctx.currentTime + 0.02, Math.random() * buffer.duration);
    this.loops.set(kind, { src, g });
  }

  private load(style: MusicStyle, kind: AmbienceKind): Promise<AudioBuffer> {
    const key = `${style}/${kind}`;
    let hit = this.cache.get(key);
    if (!hit) {
      hit = fetch(`ambience/${key}.ogg`).then(async (res) => {
        if (!res.ok) throw new Error(`ambience ${key}: ${res.status}`);
        return this.ctx.decodeAudioData(await res.arrayBuffer());
      });
      hit.catch(() => this.cache.delete(key));
      this.cache.set(key, hit);
    }
    return hit;
  }
}
