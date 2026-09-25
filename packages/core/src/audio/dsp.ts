/**
 * The sample-level synthesis kit every sound in the game is built from.
 *
 * It lives in core rather than in the harness because two very different
 * consumers need **the same** arithmetic: the offline generator that writes
 * `assets/sfx/*.wav`, and the browser, which renders the music one note at a
 * time at runtime. If those two ever drift, the mixdown that gets listened to
 * and analysed is not the thing that plays, and the verification is theatre.
 *
 * Everything here is pure and seeded. No `Math.random`, no `AudioContext`, no
 * DOM: a sound is a function of its parameters, so a change to one is a diff
 * in a number rather than a binary nobody can review.
 *
 * The primitives are chosen for one house style: **crunchy, not harsh**.
 * - FM for metal and glass, because a two-operator pair gives inharmonic
 *   partials that a filtered saw cannot.
 * - Filtered noise for air, grit and crackle.
 * - Pitch envelopes, which are what make a sound read as an *event* rather
 *   than as a note.
 * - Transient layering: a short bright click in front of a body, which is how
 *   a hit gets its snap without the whole sound being bright.
 * - A feedback delay for the tail. No convolution, no impulse responses: a
 *   short diffuse tail is three delays and a lowpass, and it costs nothing.
 */

/** Everything is rendered at this rate: a wav on disk, a note in the browser. */
export const SAMPLE_RATE = 22050;

/* --------------------------------- noise ---------------------------------- */

/**
 * Deterministic uniform noise in [0, 1). The whole point of the pipeline is
 * that the output is reproducible, so this is the only source of randomness
 * anywhere in the audio code.
 */
export function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

/** A stable seed for a name, so a voice's seed survives reordering the file. */
export function seedOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* -------------------------------- buffers --------------------------------- */

export function buffer(seconds: number): Float32Array {
  return new Float32Array(Math.max(1, Math.round(seconds * SAMPLE_RATE)));
}

/** Adds `src` into `dst` at `atSec`, scaled. Out-of-range samples are dropped. */
export function mixInto(dst: Float32Array, src: Float32Array, atSec = 0, gain = 1): void {
  const off = Math.round(atSec * SAMPLE_RATE);
  const n = Math.min(src.length, dst.length - off);
  for (let i = 0; i < n; i++) {
    if (off + i < 0) continue;
    dst[off + i]! += src[i]! * gain;
  }
}

/* ------------------------------- envelopes -------------------------------- */

export interface Env {
  /** Seconds of fade-in. Zero is a click, and a click is often the point. */
  readonly attack?: number;
  /** Seconds held at full before the decay starts. */
  readonly hold?: number;
  /** Shape of the decay: 1 linear, 2 natural, 5 percussive. */
  readonly curve?: number;
  /** Floor the decay lands on, for a layer that sustains rather than dies. */
  readonly sustain?: number;
}

/** The envelope's value at normalised time `t` in [0, 1] over `n` samples. */
function envAt(i: number, n: number, e: Env): number {
  const attack = Math.max(1, Math.round((e.attack ?? 0.002) * SAMPLE_RATE));
  const hold = Math.round((e.hold ?? 0) * SAMPLE_RATE);
  const rise = Math.min(1, i / attack);
  if (i < attack + hold) return rise;
  const t = Math.min(1, (i - attack - hold) / Math.max(1, n - attack - hold));
  const fall = Math.pow(1 - t, e.curve ?? 2);
  const floor = e.sustain ?? 0;
  return floor + (1 - floor) * fall;
}

/* ------------------------------ oscillators ------------------------------- */

export type Waveform = "sine" | "square" | "saw" | "triangle" | "pulse" | "noise";

function osc(wave: Waveform, phase: number, noise: () => number, width: number): number {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case "sine": return Math.sin(p * Math.PI * 2);
    case "square": return p < 0.5 ? 1 : -1;
    case "pulse": return p < width ? 1 : -1;
    case "saw": return 2 * p - 1;
    case "triangle": return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case "noise": return noise() * 2 - 1;
  }
}

export interface ToneOpts {
  readonly wave?: Waveform;
  /** Hz at the start. */
  readonly from: number;
  /** Hz at the end; defaults to `from` for a steady note. */
  readonly to?: number;
  /** Seconds. */
  readonly length: number;
  readonly gain?: number;
  /** Pulse width for the `pulse` wave. */
  readonly width?: number;
  /**
   * Frequency modulation, the workhorse for metal, glass and bells: the
   * modulator runs at `fm.ratio` times the carrier and deviates it by
   * `fm.index` times the carrier frequency, with its own decay so the sound
   * starts bright and settles.
   */
  readonly fm?: { readonly ratio: number; readonly index: number; readonly decay?: number };
  /** Vibrato, for a sustained layer that would otherwise sit dead still. */
  readonly vibrato?: { readonly hz: number; readonly cents: number };
  readonly env?: Env;
  /** How the pitch travels: `exp` is a sweep, `lin` is a slide. */
  readonly glide?: "exp" | "lin";
}

/** One oscillator with a pitch envelope and an amplitude envelope. */
export function tone(o: ToneOpts, noise: () => number = () => 0.5): Float32Array {
  const n = Math.max(1, Math.round(o.length * SAMPLE_RATE));
  const out = new Float32Array(n);
  const wave = o.wave ?? "sine";
  const to = o.to ?? o.from;
  const gain = o.gain ?? 1;
  const env = o.env ?? {};
  const width = o.width ?? 0.5;
  let phase = 0;
  let modPhase = 0;

  for (let i = 0; i < n; i++) {
    const t = i / n;
    const base = o.glide === "lin"
      ? o.from + (to - o.from) * t
      : o.from * Math.pow(Math.max(1e-6, to / o.from), t);
    let freq = base;
    if (o.vibrato) {
      const cents = Math.sin((i / SAMPLE_RATE) * o.vibrato.hz * Math.PI * 2) * o.vibrato.cents;
      freq *= Math.pow(2, cents / 1200);
    }
    let sample: number;
    if (o.fm) {
      modPhase += (freq * o.fm.ratio) / SAMPLE_RATE;
      const index = o.fm.index * Math.pow(1 - t, o.fm.decay ?? 2);
      phase += freq / SAMPLE_RATE;
      sample = Math.sin(phase * Math.PI * 2 + Math.sin(modPhase * Math.PI * 2) * index);
    } else {
      phase += freq / SAMPLE_RATE;
      sample = osc(wave, phase, noise, width);
    }
    out[i] = sample * envAt(i, n, env) * gain;
  }
  return out;
}

/** Noise through an envelope. Filter it afterwards; unfiltered noise is hiss. */
export function noiseBurst(length: number, noise: () => number, gain = 1, env: Env = {}): Float32Array {
  const n = Math.max(1, Math.round(length * SAMPLE_RATE));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (noise() * 2 - 1) * envAt(i, n, env) * gain;
  return out;
}

/* --------------------------------- filters -------------------------------- */

type Coeffs = readonly [number, number, number, number, number];

function lowpassCoeffs(hz: number, q: number): Coeffs {
  const w = (2 * Math.PI * Math.min(hz, SAMPLE_RATE * 0.49)) / SAMPLE_RATE;
  const a = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2;
  const a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function highpassCoeffs(hz: number, q: number): Coeffs {
  const w = (2 * Math.PI * Math.min(hz, SAMPLE_RATE * 0.49)) / SAMPLE_RATE;
  const a = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const b0 = (1 + c) / 2, b1 = -(1 + c), b2 = (1 + c) / 2;
  const a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function bandpassCoeffs(hz: number, q: number): Coeffs {
  const w = (2 * Math.PI * Math.min(hz, SAMPLE_RATE * 0.49)) / SAMPLE_RATE;
  const a = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const b0 = a, b1 = 0, b2 = -a;
  const a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function highShelfCoeffs(hz: number, gainDb: number): Coeffs {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * Math.min(hz, SAMPLE_RATE * 0.49)) / SAMPLE_RATE;
  const c = Math.cos(w), s = Math.sin(w);
  const alpha = s / 2 * Math.sqrt(2);
  const sq = 2 * Math.sqrt(A) * alpha;
  const b0 = A * ((A + 1) + (A - 1) * c + sq);
  const b1 = -2 * A * ((A - 1) + (A + 1) * c);
  const b2 = A * ((A + 1) + (A - 1) * c - sq);
  const a0 = (A + 1) - (A - 1) * c + sq;
  const a1 = 2 * ((A - 1) - (A + 1) * c);
  const a2 = (A + 1) - (A - 1) * c - sq;
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function biquad(buf: Float32Array, k: Coeffs): void {
  const [b0, b1, b2, a1, a2] = k;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x0 = buf[i]!;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    buf[i] = y0;
  }
}

export function lowpass(buf: Float32Array, hz: number, q = 0.707): Float32Array { biquad(buf, lowpassCoeffs(hz, q)); return buf; }
export function highpass(buf: Float32Array, hz: number, q = 0.707): Float32Array { biquad(buf, highpassCoeffs(hz, q)); return buf; }
export function bandpass(buf: Float32Array, hz: number, q = 2): Float32Array { biquad(buf, bandpassCoeffs(hz, q)); return buf; }
export function highShelf(buf: Float32Array, hz: number, gainDb: number): Float32Array { biquad(buf, highShelfCoeffs(hz, gainDb)); return buf; }

/**
 * A lowpass whose cutoff travels while the sound plays. This is what makes a
 * whoosh a whoosh: a static filter on noise is a hiss whatever its envelope.
 */
export function sweepLowpass(buf: Float32Array, fromHz: number, toHz: number, q = 0.9): Float32Array {
  const n = buf.length;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    const hz = fromHz * Math.pow(Math.max(1e-6, toHz / fromHz), t);
    const [b0, b1, b2, a1, a2] = lowpassCoeffs(hz, q);
    const x0 = buf[i]!;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    buf[i] = y0;
  }
  return buf;
}

/**
 * A bandpass whose centre travels while the sound plays.
 *
 * Electricity is the reason this exists: an arc is a narrow band of energy
 * that *moves*, and a static band on the same material is a kazoo. The sweep
 * is exponential, so an octave costs the same distance wherever it starts.
 */
export function sweepBandpass(buf: Float32Array, fromHz: number, toHz: number, q = 2): Float32Array {
  const n = buf.length;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    const hz = fromHz * Math.pow(Math.max(1e-6, toHz / fromHz), t);
    const [b0, b1, b2, a1, a2] = bandpassCoeffs(hz, q);
    const x0 = buf[i]!;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    buf[i] = y0;
  }
  return buf;
}

/* ---------------------------------- tails --------------------------------- */

/**
 * A short room tail from three feedback delays and a lowpass on the feedback
 * path. Prime-ish delay lengths so the repeats never line up into a flutter.
 *
 * This is the whole reverb budget. A real convolution would need an impulse
 * response to ship, and an impulse response is exactly the sourced binary the
 * pipeline exists to avoid.
 */
export function tail(buf: Float32Array, timeSec: number, feedback: number, mix: number, damp = 3200): Float32Array {
  const taps = [1, 0.79, 1.31];
  const wet = new Float32Array(buf.length);
  const alpha = 1 - Math.exp((-2 * Math.PI * damp) / SAMPLE_RATE);
  for (const scale of taps) {
    const delay = Math.max(1, Math.round(timeSec * scale * SAMPLE_RATE));
    const line = new Float32Array(buf.length);
    let lp = 0;
    for (let i = 0; i < buf.length; i++) {
      const back = i - delay;
      const echo = back >= 0 ? line[back]! : 0;
      lp += alpha * (echo - lp);
      line[i] = buf[i]! + lp * feedback;
      wet[i] = wet[i]! + lp * feedback;
    }
  }
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i]! + (wet[i]! / taps.length) * mix;
  return buf;
}

/* -------------------------------- shaping --------------------------------- */

/**
 * Soft saturation. `tanh` rather than a clamp: a clamp on a transient buzzes
 * exactly where the sound is supposed to be loudest, which is the one place
 * the ear is listening.
 */
export function saturate(buf: Float32Array, drive = 1.2): Float32Array {
  const k = Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i]! * drive) / k * Math.min(1, k);
  return buf;
}

/** Quantises the sample values. A touch of this is the era; a lot is a fault. */
export function crush(buf: Float32Array, bits: number): Float32Array {
  const steps = Math.pow(2, bits - 1);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.round(buf[i]! * steps) / steps;
  return buf;
}

export function peak(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]!));
  return p;
}

export function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
  return Math.sqrt(sum / Math.max(1, buf.length));
}

/** Scales the buffer so its loudest sample sits at `target` (linear). */
export function normalisePeak(buf: Float32Array, target: number): Float32Array {
  const p = peak(buf);
  if (p <= 1e-9) return buf;
  const k = target / p;
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i]! * k;
  return buf;
}

/**
 * Scales toward a target RMS, but never past a peak ceiling.
 *
 * This is how a category is levelled: matching peaks makes a short click as
 * loud as a long boom on the meter and half as loud to the ear, so the mix is
 * set by energy and only *limited* by peak.
 */
export function normaliseRms(buf: Float32Array, targetRms: number, peakCeiling: number): Float32Array {
  const r = rms(buf);
  if (r <= 1e-9) return buf;
  let k = targetRms / r;
  const p = peak(buf) * k;
  if (p > peakCeiling) k *= peakCeiling / p;
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i]! * k;
  return buf;
}

/** Trims trailing near-silence and applies a short fade, so no file ends in a click. */
export function trim(buf: Float32Array, threshold = 0.0008, fadeSec = 0.006): Float32Array {
  let end = buf.length;
  while (end > 1 && Math.abs(buf[end - 1]!) < threshold) end--;
  const fade = Math.round(fadeSec * SAMPLE_RATE);
  const out = buf.slice(0, Math.min(buf.length, end + fade));
  for (let i = 0; i < fade && i < out.length; i++) {
    out[out.length - 1 - i] = out[out.length - 1 - i]! * (i / fade);
  }
  return out;
}

/* ---------------------------------- wav ----------------------------------- */

/** 16-bit mono PCM at `SAMPLE_RATE`. Bytes, not a Node Buffer: core is pure. */
export function toWavBytes(samples: Float32Array): Uint8Array {
  const n = samples.length;
  const bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return bytes;
}

/* -------------------------------- analysis -------------------------------- */

export function dbfs(linear: number): number {
  return linear <= 1e-9 ? -Infinity : 20 * Math.log10(linear);
}

/**
 * Loudness after ITU-R BS.1770's K-weighting: a high shelf for the head's
 * response and a highpass for everything the speaker cannot reproduce, then
 * mean square over the whole file. Approximate — there is no gating and no
 * channel weighting, because with one mono channel and sounds a fifth of a
 * second long the gate would reject the entire signal. It is used to compare
 * one effect against another, which is all the mix needs.
 */
export function approxLufs(buf: Float32Array): number {
  const k = buf.slice();
  highShelf(k, 1500, 4);
  highpass(k, 38, 0.5);
  const ms = rms(k);
  return ms <= 1e-9 ? -Infinity : -0.691 + 10 * Math.log10(ms * ms);
}

/**
 * A radix-2 FFT magnitude spectrum of the first `size` samples, Hann-windowed.
 * Small and iterative; it is used for the centroid and the fingerprint, both
 * of which are comparisons rather than measurements.
 */
export function spectrum(buf: Float32Array, size = 2048, at = 0): Float32Array {
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const s = buf[at + i] ?? 0;
    re[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < size; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!, ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const mag = new Float32Array(size / 2);
  for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i]!, im[i]!);
  return mag;
}

/** The spectral centre of mass, in Hz: how bright the sound is, in one number. */
export function spectralCentroid(buf: Float32Array): number {
  const size = 2048;
  let num = 0;
  let den = 0;
  const frames = Math.max(1, Math.floor(buf.length / size));
  for (let f = 0; f < frames; f++) {
    const mag = spectrum(buf, size, f * size);
    for (let i = 1; i < mag.length; i++) {
      const hz = (i * SAMPLE_RATE) / size;
      num += hz * mag[i]!;
      den += mag[i]!;
    }
  }
  return den <= 1e-9 ? 0 : num / den;
}

/**
 * A 20-band log-spaced spectral fingerprint with the envelope shape appended,
 * unit length so it can be compared with a cosine distance.
 *
 * Both halves matter: two sounds with the same spectrum and different
 * envelopes are a bell and a pad, and the ear does not confuse them.
 */
export function fingerprint(buf: Float32Array): Float32Array {
  const bands = 20;
  const out = new Float32Array(bands + 8);
  const size = 2048;
  const frames = Math.max(1, Math.floor(buf.length / size));
  for (let f = 0; f < frames; f++) {
    const mag = spectrum(buf, size, f * size);
    for (let i = 1; i < mag.length; i++) {
      const hz = (i * SAMPLE_RATE) / size;
      const b = Math.min(bands - 1, Math.max(0, Math.floor((Math.log2(Math.max(40, hz) / 40) / Math.log2(SAMPLE_RATE / 2 / 40)) * bands)));
      out[b] = out[b]! + mag[i]!;
    }
  }
  // Eight envelope buckets: where the energy sits in time.
  const seg = Math.max(1, Math.floor(buf.length / 8));
  for (let k = 0; k < 8; k++) {
    let e = 0;
    for (let i = k * seg; i < Math.min(buf.length, (k + 1) * seg); i++) e += buf[i]! * buf[i]!;
    out[bands + k] = Math.sqrt(e / seg);
  }
  // Each half normalised on its own, so the louder half cannot swamp the other.
  const norm = (from: number, to: number): void => {
    let s = 0;
    for (let i = from; i < to; i++) s += out[i]! * out[i]!;
    const k = Math.sqrt(s);
    if (k > 1e-9) for (let i = from; i < to; i++) out[i] = out[i]! / k;
  };
  norm(0, bands);
  norm(bands, out.length);
  return out;
}

/** Cosine distance in [0, 2]; 0 is identical. */
export function spectralDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na <= 1e-12 || nb <= 1e-12) return 2;
  return 1 - dot / Math.sqrt(na * nb);
}
