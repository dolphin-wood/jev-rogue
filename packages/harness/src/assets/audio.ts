/**
 * Procedural sound effects.
 *
 * The game shipped with no audio at all, which on Jan Willem Nijman's
 * ordering in *The Art of Screenshake* is the second thing to fix, ahead of
 * every visual effect in the game. Joonas Turner, who did the audio for
 * Nuclear Throne and Downwell, puts it at "one third of the overall
 * immersion and feel".
 *
 * Sounds are synthesised rather than sourced, for the same reason the sprite
 * sheet is generated: the source of truth is a function, the output is
 * byte-reproducible, and a change is a diff in a parameter rather than a
 * binary nobody can review.
 *
 * Two principles from Turner carry most of the weight here.
 *
 * - **A sound is layers, not a waveform.** He decomposes a gunshot into "a
 *   sum of projectile shooting out, chassis sounds, any animated part,
 *   trigger click". Every effect below is built the same way, because a
 *   single oscillator with an envelope reads as a beep whatever you do to it.
 * - **Variants defeat fatigue.** A shot fires several times a second, so one
 *   recording becomes a machine noise within a room. Each frequent effect is
 *   emitted in several variants and the player picks between them, never
 *   twice the same in a row.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SAMPLE_RATE = 22050;

/* ------------------------------ tiny synth -------------------------------- */

/**
 * Deterministic noise. `Math.random` would make the output unreproducible,
 * which would cost the pipeline the property that makes it reviewable.
 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export type Wave = "sine" | "square" | "saw" | "triangle" | "noise";

export interface Layer {
  readonly wave: Wave;
  /** Hz at the start of the layer. */
  readonly from: number;
  /** Hz at the end; equal to `from` for a steady tone. */
  readonly to?: number;
  /** Seconds. */
  readonly length: number;
  /** Linear gain before the master mix. */
  readonly gain: number;
  /** Seconds of fade-in; a click is sometimes the point, so this can be 0. */
  readonly attack?: number;
  /** Curve of the decay: 1 is linear, higher is snappier. */
  readonly decay?: number;
  /** Seconds before the layer starts, which is what makes a sound layered. */
  readonly delay?: number;
  /** One-pole lowpass in Hz; omitted leaves the layer bright. */
  readonly lowpass?: number;
}

function oscillate(wave: Wave, phase: number, noise: () => number): number {
  switch (wave) {
    case "sine":
      return Math.sin(phase * Math.PI * 2);
    case "square":
      return phase % 1 < 0.5 ? 1 : -1;
    case "saw":
      return 2 * (phase % 1) - 1;
    case "triangle": {
      const p = phase % 1;
      return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    }
    case "noise":
      return noise() * 2 - 1;
  }
}

/** Renders one layer additively into `out`. */
function render(out: Float32Array, layer: Layer, noise: () => number): void {
  const start = Math.round((layer.delay ?? 0) * SAMPLE_RATE);
  const n = Math.round(layer.length * SAMPLE_RATE);
  const attack = Math.max(1, Math.round((layer.attack ?? 0.002) * SAMPLE_RATE));
  const decayCurve = layer.decay ?? 2;
  const to = layer.to ?? layer.from;

  // One-pole lowpass coefficient, if the layer asked for one.
  const cutoff = layer.lowpass;
  const alpha = cutoff ? 1 - Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE) : 1;
  let filtered = 0;
  let phase = 0;

  for (let i = 0; i < n; i++) {
    const idx = start + i;
    if (idx >= out.length) break;
    const t = i / n;

    // Exponential pitch travel reads as a sweep; linear reads as a slide.
    const freq = layer.from * Math.pow(to / layer.from, t);
    phase += freq / SAMPLE_RATE;

    let s = oscillate(layer.wave, phase, noise);
    if (cutoff) {
      filtered += alpha * (s - filtered);
      s = filtered;
    }

    const env = Math.min(1, i / attack) * Math.pow(1 - t, decayCurve);
    out[idx] = (out[idx] ?? 0) + s * env * layer.gain;
  }
}

/** Mixes layers, then soft-clips so a busy stack never wraps around. */
export function synth(layers: readonly Layer[], seed: number): Float32Array {
  const noise = rng(seed);
  let end = 0;
  for (const l of layers) end = Math.max(end, (l.delay ?? 0) + l.length);
  const out = new Float32Array(Math.round(end * SAMPLE_RATE) + 1);
  for (const l of layers) render(out, l, noise);

  for (let i = 0; i < out.length; i++) {
    // tanh rather than a hard clamp: a hard clamp on a transient is audible
    // as a buzz exactly where the sound is supposed to be loudest.
    out[i] = Math.tanh((out[i] ?? 0) * 1.1);
  }
  return out;
}

/* -------------------------------- wav out --------------------------------- */

export function toWav(samples: Float32Array): Buffer {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

/* --------------------------------- voices --------------------------------- */

/**
 * `jitter` shifts a voice's pitch slightly per variant. The variants exist so
 * a repeated event does not become a machine noise; the shift is kept small
 * because, as practitioners put it, wide ranges sound jarring rather than
 * natural.
 */
export type Voice = (jitter: number) => Layer[];

export const VOICES: Readonly<Record<string, { voice: Voice; variants: number }>> = {
  /**
   * The player's shot. Four layers, after Turner's decomposition: the bolt
   * itself, a body thump so it has weight, a bright transient so it cuts
   * through a busy room, and a breath of air behind it.
   */
  shoot_player: {
    variants: 4,
    voice: (j) => [
      { wave: "square", from: 760 * j, to: 300 * j, length: 0.1, gain: 0.22, decay: 3 },
      { wave: "sine", from: 200 * j, to: 90 * j, length: 0.13, gain: 0.3, decay: 2.4 },
      { wave: "noise", from: 1, length: 0.035, gain: 0.16, decay: 4, lowpass: 5200 },
      { wave: "noise", from: 1, length: 0.09, gain: 0.05, decay: 2, lowpass: 1400, delay: 0.01 },
    ],
  },

  /**
   * An enemy volley. Deliberately darker and hollower than the player's, so
   * the two are told apart with the eyes elsewhere. Bullet colour separates
   * them visually; this is the same separation in the other channel.
   */
  shoot_enemy: {
    variants: 4,
    voice: (j) => [
      { wave: "triangle", from: 330 * j, to: 150 * j, length: 0.14, gain: 0.2, decay: 2.2 },
      { wave: "sine", from: 120 * j, to: 62 * j, length: 0.18, gain: 0.22, decay: 2 },
      { wave: "noise", from: 1, length: 0.05, gain: 0.07, decay: 3, lowpass: 1800 },
    ],
  },

  /** A shot connecting: a click for the contact, a body for the damage. */
  hit_enemy: {
    variants: 4,
    voice: (j) => [
      { wave: "noise", from: 1, length: 0.045, gain: 0.3, decay: 5, lowpass: 7000, attack: 0 },
      { wave: "square", from: 420 * j, to: 180 * j, length: 0.06, gain: 0.16, decay: 4 },
      { wave: "sine", from: 150 * j, to: 70 * j, length: 0.1, gain: 0.2, decay: 3 },
    ],
  },

  /**
   * A kill. Longer and lower than a hit, with a downward sweep, because the
   * difference between hurting a thing and ending it should be audible
   * without looking.
   */
  kill: {
    variants: 3,
    voice: (j) => [
      { wave: "noise", from: 1, length: 0.26, gain: 0.3, decay: 2.2, lowpass: 3200 },
      { wave: "saw", from: 300 * j, to: 48 * j, length: 0.24, gain: 0.2, decay: 2.6 },
      { wave: "sine", from: 140 * j, to: 40 * j, length: 0.3, gain: 0.26, decay: 2 },
      { wave: "noise", from: 1, length: 0.1, gain: 0.14, decay: 4, lowpass: 900, delay: 0.03 },
    ],
  },

  /**
   * Losing a heart. The one sound allowed to be unpleasant, and the only one
   * that descends into the low register, so it is never mistaken for a hit
   * the player landed.
   */
  hurt: {
    variants: 2,
    voice: (j) => [
      { wave: "saw", from: 420 * j, to: 70 * j, length: 0.34, gain: 0.26, decay: 1.7 },
      { wave: "square", from: 210 * j, to: 52 * j, length: 0.3, gain: 0.14, decay: 2 },
      { wave: "noise", from: 1, length: 0.12, gain: 0.16, decay: 3, lowpass: 2400, attack: 0 },
    ],
  },

  /** The dash: air, not a tone. Filtered noise swept open and shut again. */
  dash: {
    variants: 3,
    voice: (j) => [
      { wave: "noise", from: 1, length: 0.19, gain: 0.26, decay: 1.9, lowpass: 2600 * j, attack: 0.02 },
      { wave: "sine", from: 520 * j, to: 900 * j, length: 0.12, gain: 0.08, decay: 3 },
    ],
  },

  /** A reward taken: the one unambiguously bright sound in the set. */
  pickup: {
    variants: 2,
    voice: (j) => [
      { wave: "sine", from: 720 * j, length: 0.08, gain: 0.2, decay: 3 },
      { wave: "sine", from: 1080 * j, length: 0.14, gain: 0.18, decay: 2.4, delay: 0.05 },
      { wave: "triangle", from: 1440 * j, length: 0.12, gain: 0.1, decay: 3, delay: 0.1 },
    ],
  },

  /**
   * The room clears. A rising third, long enough to be a punctuation mark on
   * the fight rather than another effect inside it. Sid Meier's minimum:
   * "At least have a sound effect that says, I've heard what you said."
   */
  clear: {
    variants: 1,
    voice: () => [
      { wave: "triangle", from: 392, length: 0.16, gain: 0.2, decay: 2.2 },
      { wave: "triangle", from: 523, length: 0.18, gain: 0.2, decay: 2.2, delay: 0.1 },
      { wave: "triangle", from: 659, length: 0.34, gain: 0.22, decay: 1.8, delay: 0.2 },
      { wave: "sine", from: 131, length: 0.5, gain: 0.14, decay: 1.6 },
    ],
  },

  /** An enemy winding up to lunge: the tell, in the channel eyes are not on. */
  telegraph: {
    variants: 2,
    voice: (j) => [
      { wave: "sine", from: 190 * j, to: 400 * j, length: 0.26, gain: 0.16, decay: 0.7, attack: 0.05 },
      { wave: "noise", from: 1, length: 0.26, gain: 0.05, decay: 1, lowpass: 1100 },
    ],
  },
};

/** `name` of every file the generator writes, in order. */
export function audioManifest(): string[] {
  const out: string[] = [];
  for (const [name, def] of Object.entries(VOICES)) {
    for (let v = 0; v < def.variants; v++) out.push(`${name}_${v}`);
  }
  return out.sort();
}

/**
 * Writes every variant of every voice under `dir/sfx`, and returns a digest
 * of the whole set so the pipeline test can assert the output is
 * reproducible rather than merely present.
 */
export function generateAudio(dir: string): { files: number; digest: string } {
  const out = join(dir, "sfx");
  mkdirSync(out, { recursive: true });
  const hash = createHash("sha256");
  let files = 0;

  for (const [name, def] of Object.entries(VOICES)) {
    for (let v = 0; v < def.variants; v++) {
      // The jitter is per variant and small: a few percent either side, so
      // the variants are the same sound and not a scale.
      const jitter = 1 + (v - (def.variants - 1) / 2) * 0.045;
      const seed = [...`${name}${v}`].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
      const wav = toWav(synth(def.voice(jitter), seed));
      writeFileSync(join(out, `${name}_${v}.wav`), wav);
      hash.update(`${name}_${v}`).update(wav);
      files++;
    }
  }
  return { files, digest: hash.digest("hex").slice(0, 16) };
}
