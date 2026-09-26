/**
 * Every sound effect in the game, as a function.
 *
 * The set is built for **a melee-plus-spells action RPG in a busy room**, not
 * for the bullet hell this started as, and three rules shape all of it.
 *
 * - **Weight is audible.** A hit is not one sound with a volume knob: a light
 *   tick, a thwack and a heavy crunch are three different spectra, and the
 *   heavy one alone has a sub layer under it. A player should know what a
 *   blow did without reading a number.
 * - **A school is a timbre family, not a pitch.** Arcane is a chime inside a
 *   rising resonance, storm a crack plus an arc, stone a thud plus rubble,
 *   flame a whoosh into a roar, frost a crystalline tink, venom a wet hiss,
 *   void a low suck, spirit breath. Elements are already told apart by colour;
 *   this is the same separation in the channel the eyes are not on. Frost is
 *   the *only* school allowed a bell-like decay: a tuned partial with a long
 *   tail reads as glass or ice whatever the designer meant by it, which is
 *   how storm came to sound like ice cubes in a glass.
 * - **A telegraph is a promise, and different promises must not rhyme.** A
 *   charge winds up (rising and tightening), a slam gathers (falling and
 *   swelling), a ranged body aims (a thin steady two-tone). Three families,
 *   three contours, so the answer — sidestep, leave the circle, break the
 *   line — can be chosen from the sound alone.
 *
 * Loudness is set per category by RMS and only limited by peak: matching
 * peaks would make a 40 ms click meter as loud as a 400 ms boom and sound
 * half as loud. Nothing here is allowed past -1 dBFS.
 */
import {
  SAMPLE_RATE, buffer, mixInto, noiseBurst, tone,
  bandpass, highpass, lowpass, sweepBandpass, sweepLowpass, tail, saturate, crush,
  normaliseRms, trim, rng, seedOf,
} from "./dsp.ts";

export type SfxCategory = "combat" | "world" | "ui";

/** The eight timbre families a spell can speak in. */
export const SFX_SCHOOLS = ["arcane", "storm", "stone", "flame", "frost", "venom", "void", "spirit"] as const;
export type SfxSchool = (typeof SFX_SCHOOLS)[number];

export interface SfxDef {
  readonly category: SfxCategory;
  /** How many files this effect ships. More for the effects that repeat most. */
  readonly variants: number;
  /** Playback gain in the game mix. */
  readonly gain: number;
  /** Minimum ms between two plays of this effect. */
  readonly retriggerMs: number;
  /** One variant, rendered. `j` is the per-variant pitch jitter, around 1. */
  readonly render: (r: () => number, j: number) => Float32Array;
}

/* ------------------------------ house levels ------------------------------ */

/**
 * Where each category sits. Combat is loudest because it is the channel the
 * player acts on; the world sits under it; the UI under that, since a menu is
 * never competing with anything.
 */
const LEVEL: Readonly<Record<SfxCategory, { rms: number; peak: number }>> = {
  // A -1.4 dBFS ceiling rather than -1.0: the client also applies a small
  // random per-play volume, and some of those rolls are above unity.
  combat: { rms: 0.125, peak: 0.85 },
  world: { rms: 0.105, peak: 0.85 },
  ui: { rms: 0.085, peak: 0.8 },
};

/* --------------------------------- pieces --------------------------------- */

/** A bright transient. What a hit's snap is made of, in front of its body. */
function click(r: () => number, hz: number, len = 0.02, gain = 1): Float32Array {
  return highpass(bandpass(noiseBurst(len, r, gain, { attack: 0, curve: 6 }), hz, 0.8), hz * 0.5);
}

/** The low body of an impact: a short pitch drop with no top end at all. */
function thump(from: number, to: number, len: number, gain = 1, curve = 3): Float32Array {
  return lowpass(tone({ wave: "sine", from, to, length: len, gain, env: { attack: 0.001, curve } }), 380);
}

/** Air: noise through a filter that opens and shuts. A whoosh, sized by `len`. */
function air(r: () => number, len: number, open: number, close: number, gain = 1): Float32Array {
  return highpass(sweepLowpass(noiseBurst(len, r, gain, { attack: len * 0.25, curve: 1.6 }), open, close, 1.1), 240);
}

/** Grit: a narrow band of noise. Stone, dust, and the rasp on a heavy blow. */
function grit(r: () => number, len: number, hz: number, gain = 1, q = 1.4): Float32Array {
  return bandpass(noiseBurst(len, r, gain, { attack: 0.001, curve: 3 }), hz, q);
}

/** An FM bell. An inharmonic `ratio` makes metal and glass; an integer makes a tone. */
function bell(hz: number, len: number, ratio: number, index: number, gain = 1, curve = 2.4): Float32Array {
  return tone({ from: hz, length: len, gain, fm: { ratio, index, decay: 2.2 }, env: { attack: 0.001, curve } });
}

/** Scattered short pops: the crackle in storm and in flame. */
function crackle(r: () => number, len: number, hz: number, count: number, gain = 1): Float32Array {
  const out = buffer(len);
  for (let i = 0; i < count; i++) {
    const at = r() * len * 0.78;
    const pop = bandpass(
      noiseBurst(0.01 + r() * 0.018, r, gain * (0.45 + r() * 0.55), { attack: 0, curve: 7 }),
      hz * (0.6 + r() * 1.2), 3,
    );
    mixInto(out, pop, at);
  }
  return out;
}

/* ------------------------------ electricity ------------------------------- */

/**
 * The discharge front: broadband noise with no attack at all, driven hard.
 *
 * A spark is not a note. It has no fundamental, it starts at full amplitude
 * on its first sample, and everything above a couple of hundred hertz arrives
 * at once — which is exactly what a filtered, saturated noise click is, and
 * exactly what an FM bell is not.
 */
function crack(r: () => number, len = 0.05, gain = 1, hz = 700): Float32Array {
  return saturate(highpass(noiseBurst(len, r, gain, { attack: 0, curve: 9 }), hz, 0.6), 2.4);
}

/**
 * Sparks: very short noise bursts, randomised in time, length and band, and
 * clustered toward the front so the discharge thins out rather than stopping.
 *
 * Deliberately narrower and shorter than `crackle`, which is fire's: a spark
 * is a millisecond-scale tick with nothing under 1.5 kHz in it, and a dozen of
 * them irregularly spaced is what the ear calls electricity.
 */
function sparks(r: () => number, len: number, count: number, gain = 1, hz = 4200): Float32Array {
  const out = buffer(len);
  for (let i = 0; i < count; i++) {
    // `r()^1.7` rather than `r()`: uniform spacing reads as a machine.
    const at = Math.pow(r(), 1.7) * len * 0.88;
    const pop = highpass(
      bandpass(noiseBurst(0.003 + r() * 0.011, r, gain * (0.25 + r() * 0.75), { attack: 0, curve: 10 }), hz * (0.45 + r() * 1.7), 5),
      1500,
    );
    mixInto(out, pop, at);
  }
  return out;
}

/**
 * The arc itself: two detuned saws whose pitch is re-rolled a hundred-odd
 * times a second, ring-modulated against noise.
 *
 * The sample-and-hold is the whole trick. A saw at a *stable* pitch is a note,
 * and a note with a decay is a bell however it was made; a saw whose pitch
 * jumps every few milliseconds has no perceived fundamental at all, and the
 * noise ring on top removes what is left of the periodicity.
 */
function arcBuzz(r: () => number, len: number, hz: number, gain = 1, curve = 1.8): Float32Array {
  const n = Math.max(1, Math.round(len * SAMPLE_RATE));
  const out = new Float32Array(n);
  const hold = Math.max(1, Math.round(SAMPLE_RATE / 150));
  let p1 = 0, p2 = 0, jitter = 1, ring = 0;
  for (let i = 0; i < n; i++) {
    if (i % hold === 0) jitter = 0.62 + r() * 0.76;
    const t = i / n;
    const f = hz * jitter;
    p1 += f / SAMPLE_RATE;
    p2 += (f * 1.009 + 2.5) / SAMPLE_RATE;
    const saw = (2 * (p1 - Math.floor(p1)) - 1) + (2 * (p2 - Math.floor(p2)) - 1);
    // A slewed noise ring: full-rate noise would only add hiss.
    ring += 0.35 * ((r() * 2 - 1) - ring);
    out[i] = saw * 0.5 * (0.6 + 0.4 * ring) * Math.pow(1 - t, curve) * gain;
  }
  return out;
}

/**
 * A roar rather than a whoosh: the filter sits still and the amplitude
 * flutters at two unrelated rates. Moving air is a sweep; burning is this.
 */
function roar(r: () => number, len: number, hz: number, gain = 1, seedPhase = 0): Float32Array {
  const out = lowpass(noiseBurst(len, r, gain, { attack: len * 0.08, curve: 1.2, sustain: 0.45 }), hz);
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE + seedPhase;
    out[i] = out[i]! * (0.55 + 0.45 * Math.sin(t * 19 * Math.PI * 2) * Math.sin(t * 7.3 * Math.PI * 2));
  }
  return out;
}

/** Finishes a voice: a touch of saturation, levelled, and the dead tail cut. */
function finish(buf: Float32Array, category: SfxCategory, drive = 1.15): Float32Array {
  return trim(normaliseRms(saturate(buf, drive), LEVEL[category].rms, LEVEL[category].peak));
}

/* -------------------------------- the set --------------------------------- */

const DEFS = {

  /* ------------------------------ the sword ------------------------------ */

  /**
   * A swing. Air with a little metal in it and nothing low: the sword makes
   * this noise several times a second, so anything with body in it turns a
   * fight to mud inside one room.
   */
  swing_light: {
    category: "combat", variants: 3, gain: 0.22, retriggerMs: 55,
    render: (r, j) => {
      const out = buffer(0.2);
      mixInto(out, air(r, 0.15, 900 * j, 4200 * j, 0.7), 0);
      mixInto(out, air(r, 0.11, 3800 * j, 1100 * j, 0.35), 0.03);
      mixInto(out, bell(2600 * j, 0.07, 2.1, 1.2, 0.1), 0.02);
      return finish(out, "combat");
    },
  },

  /**
   * The chain's last blow: slower air over a wider range with a body under
   * it, because the third swing of a chain is the one that moves something.
   */
  swing_heavy: {
    category: "combat", variants: 3, gain: 0.3, retriggerMs: 90,
    render: (r, j) => {
      const out = buffer(0.34);
      mixInto(out, air(r, 0.26, 500 * j, 3400 * j, 0.85), 0);
      mixInto(out, air(r, 0.18, 3000 * j, 700 * j, 0.45), 0.07);
      mixInto(out, thump(190 * j, 80 * j, 0.14, 0.3), 0.04);
      mixInto(out, bell(1500 * j, 0.11, 1.7, 1.6, 0.12), 0.03);
      return finish(out, "combat");
    },
  },

  /** The spin: one long turning whoosh rather than a swing played three times. */
  swing_spin: {
    category: "combat", variants: 2, gain: 0.32, retriggerMs: 400,
    render: (r, j) => {
      const out = buffer(0.62);
      for (let k = 0; k < 3; k++) {
        mixInto(out, air(r, 0.2, 700 * j * (1 + k * 0.3), 3000 * j * (1 + k * 0.35), 0.5 + k * 0.12), 0.06 + k * 0.14);
      }
      mixInto(out, tone({ wave: "triangle", from: 150 * j, to: 300 * j, length: 0.5, gain: 0.16, env: { attack: 0.18, curve: 1.4 } }), 0);
      return finish(out, "combat");
    },
  },

  /** The dodge: air, no tone. Short, so it never masks what was dodged. */
  dash: {
    category: "combat", variants: 3, gain: 0.26, retriggerMs: 120,
    render: (r, j) => {
      const out = buffer(0.26);
      mixInto(out, air(r, 0.2, 400 * j, 2600 * j, 0.8), 0);
      mixInto(out, lowpass(noiseBurst(0.09, r, 0.25, { attack: 0, curve: 3 }), 700 * j), 0);
      return finish(out, "combat");
    },
  },

  /** The dash strike landing: the dash's air cut off by a metal contact. */
  dash_strike: {
    category: "combat", variants: 2, gain: 0.42, retriggerMs: 140,
    render: (r, j) => {
      const out = buffer(0.34);
      mixInto(out, air(r, 0.09, 600 * j, 3600 * j, 0.6), 0);
      mixInto(out, click(r, 5200 * j, 0.024, 0.9), 0.07);
      mixInto(out, bell(900 * j, 0.19, 2.9, 4.5, 0.45), 0.07);
      mixInto(out, thump(210 * j, 62, 0.16, 0.5), 0.07);
      return finish(out, "combat", 1.3);
    },
  },

  /* ------------------------ landing a blow, by weight --------------------- */

  /** A tick: a graze, a light spell, a blow on something small. */
  hit_light: {
    category: "combat", variants: 4, gain: 0.34, retriggerMs: 40,
    render: (r, j) => {
      const out = buffer(0.1);
      mixInto(out, click(r, 4600 * j, 0.016, 1), 0);
      mixInto(out, bell(1400 * j, 0.06, 3.4, 2.2, 0.35), 0.001);
      mixInto(out, thump(300 * j, 150 * j, 0.05, 0.2), 0.001);
      return finish(out, "combat", 1.1);
    },
  },

  /**
   * A thwack: the ordinary sword hit, and the sound the room hears most. The
   * old name is kept, so every call site that meant "a blow landed" still
   * does and the set reads as a change of sound rather than of vocabulary.
   */
  hit_enemy: {
    category: "combat", variants: 4, gain: 0.4, retriggerMs: 45,
    render: (r, j) => {
      const out = buffer(0.17);
      mixInto(out, click(r, 3200 * j, 0.02, 0.85), 0);
      mixInto(out, grit(r, 0.05, 1500 * j, 0.5, 1), 0.002);
      mixInto(out, bell(760 * j, 0.1, 2.4, 3, 0.4), 0.002);
      mixInto(out, thump(220 * j, 90 * j, 0.1, 0.5), 0.002);
      return finish(out, "combat", 1.2);
    },
  },

  /**
   * A crunch. The heavy end: a slower transient, a rasp of grit, and a sub
   * layer that none of the lighter hits has, which is what makes the weight
   * read rather than merely the loudness.
   */
  hit_heavy: {
    category: "combat", variants: 3, gain: 0.52, retriggerMs: 70,
    render: (r, j) => {
      const out = buffer(0.36);
      mixInto(out, click(r, 2200 * j, 0.03, 0.8), 0);
      mixInto(out, grit(r, 0.13, 800 * j, 0.7, 0.9), 0.004);
      mixInto(out, bell(420 * j, 0.19, 1.9, 5, 0.5), 0.004);
      mixInto(out, thump(150 * j, 44, 0.3, 0.95, 2.2), 0.006);
      mixInto(out, lowpass(noiseBurst(0.09, r, 0.28, { attack: 0.002, curve: 2.5 }), 420), 0.01);
      return finish(out, "combat", 1.35);
    },
  },

  /** Steel on steel: a blow that armour ate. Bright, ringing, and unrewarding. */
  hit_armour: {
    category: "combat", variants: 3, gain: 0.38, retriggerMs: 50,
    render: (r, j) => {
      const out = buffer(0.3);
      mixInto(out, click(r, 6200 * j, 0.014, 0.9), 0);
      mixInto(out, bell(1850 * j, 0.24, 3.83, 3.4, 0.5, 1.7), 0.001);
      mixInto(out, bell(2790 * j, 0.16, 5.4, 1.8, 0.22, 2), 0.002);
      mixInto(out, thump(260 * j, 170 * j, 0.05, 0.18), 0.001);
      return finish(tail(out, 0.035, 0.35, 0.22, 5200), "combat", 1.1);
    },
  },

  /** Armour giving way: the ring cut short by a tear and a fall of plate. */
  armour_break: {
    category: "combat", variants: 2, gain: 0.55, retriggerMs: 160,
    render: (r, j) => {
      const out = buffer(0.42);
      mixInto(out, click(r, 5000 * j, 0.03, 1), 0);
      mixInto(out, bell(1500 * j, 0.1, 4.1, 6, 0.5, 3), 0);
      mixInto(out, grit(r, 0.22, 2300 * j, 0.55, 0.8), 0.03);
      for (let k = 0; k < 4; k++) mixInto(out, bell(900 * j * (1 + k * 0.4), 0.09, 3.3, 2, 0.16), 0.06 + k * 0.05);
      mixInto(out, thump(180 * j, 55, 0.2, 0.5), 0.005);
      return finish(out, "combat", 1.3);
    },
  },

  /* --------------------------------- deaths ------------------------------- */

  /** A body ending. Lower and longer than a hit, and it falls. */
  kill: {
    category: "combat", variants: 3, gain: 0.6, retriggerMs: 80,
    render: (r, j) => {
      const out = buffer(0.44);
      mixInto(out, click(r, 2600 * j, 0.026, 0.7), 0);
      mixInto(out, tone({ wave: "saw", from: 420 * j, to: 70 * j, length: 0.26, gain: 0.34, env: { attack: 0.001, curve: 2.4 } }), 0);
      mixInto(out, thump(190 * j, 42, 0.34, 0.75, 2), 0.004);
      mixInto(out, sweepLowpass(noiseBurst(0.3, r, 0.42, { attack: 0.004, curve: 2.2 }), 3400, 500, 1), 0.006);
      return finish(tail(out, 0.05, 0.3, 0.2, 2400), "combat", 1.25);
    },
  },

  /** Something large ending: the same shape an octave down, with a collapse. */
  kill_heavy: {
    category: "combat", variants: 2, gain: 0.72, retriggerMs: 200,
    render: (r, j) => {
      const out = buffer(0.78);
      mixInto(out, click(r, 1800 * j, 0.035, 0.7), 0);
      mixInto(out, tone({ wave: "saw", from: 260 * j, to: 40 * j, length: 0.42, gain: 0.4, env: { attack: 0.002, curve: 2 } }), 0);
      mixInto(out, thump(110 * j, 28, 0.6, 0.95, 1.7), 0.006);
      mixInto(out, sweepLowpass(noiseBurst(0.5, r, 0.4, { attack: 0.01, curve: 1.8 }), 2600, 260, 0.9), 0.01);
      mixInto(out, grit(r, 0.34, 520 * j, 0.4, 0.8), 0.12);
      return finish(tail(out, 0.07, 0.36, 0.26, 1800), "combat", 1.3);
    },
  },

  /** A pot or a crate going: dry, wooden, no tone, over at once. */
  prop_break: {
    category: "combat", variants: 3, gain: 0.44, retriggerMs: 60,
    render: (r, j) => {
      const out = buffer(0.3);
      mixInto(out, click(r, 2400 * j, 0.02, 0.8), 0);
      mixInto(out, crush(grit(r, 0.14, 1100 * j, 0.7, 0.7), 7), 0.003);
      for (let k = 0; k < 6; k++) mixInto(out, grit(r, 0.05, 1600 * j * (0.6 + r() * 1.3), 0.3, 3), 0.02 + r() * 0.16);
      mixInto(out, thump(170 * j, 70, 0.1, 0.35), 0.002);
      return finish(out, "combat", 1.2);
    },
  },

  /**
   * Losing a heart. The one sound in the set allowed to be unpleasant, and
   * the only one with a rising bite in it: it has to arrive over a full room
   * of fighting, so it is louder, it holds a dissonant pair, and its transient
   * sits in the 2-3 kHz band the ear is most sensitive to.
   */
  hurt: {
    category: "combat", variants: 3, gain: 0.95, retriggerMs: 240,
    render: (r, j) => {
      const out = buffer(0.5);
      mixInto(out, click(r, 2900 * j, 0.03, 1), 0);
      mixInto(out, tone({ wave: "saw", from: 520 * j, to: 88 * j, length: 0.36, gain: 0.42, env: { attack: 0, curve: 1.7 } }), 0);
      // A minor second against it: two tones a semitone apart beat, and a beat
      // is heard through anything.
      mixInto(out, tone({ wave: "square", from: 551 * j, to: 93 * j, length: 0.3, gain: 0.2, env: { attack: 0, curve: 2 } }), 0.002);
      mixInto(out, thump(200 * j, 50, 0.3, 0.6, 2.2), 0.001);
      mixInto(out, bandpass(noiseBurst(0.16, r, 0.4, { attack: 0, curve: 3 }), 2600, 1.1), 0);
      return finish(out, "combat", 1.5);
    },
  },

  /** The run ending: the hurt, stretched, with the room falling away under it. */
  player_down: {
    category: "combat", variants: 1, gain: 0.9, retriggerMs: 1200,
    render: (r, j) => {
      const out = buffer(1.5);
      mixInto(out, tone({ wave: "saw", from: 430 * j, to: 52 * j, length: 1.1, gain: 0.34, env: { attack: 0.004, curve: 1.3 } }), 0);
      mixInto(out, tone({ wave: "triangle", from: 215 * j, to: 26 * j, length: 1.2, gain: 0.3, env: { attack: 0.01, curve: 1.2 } }), 0.02);
      mixInto(out, sweepLowpass(noiseBurst(0.9, r, 0.3, { attack: 0.02, curve: 1.4 }), 2600, 200, 0.9), 0.05);
      mixInto(out, bell(196, 0.9, 1.4, 3, 0.2, 1.2), 0.12);
      return finish(tail(out, 0.11, 0.42, 0.3, 1600), "combat", 1.2);
    },
  },

  /* --------------------------------- spells ------------------------------- */

  /**
   * The windup before a cast leaves the hand. Rising, quiet, and the same for
   * every school: it says "something is coming", and which something is said
   * by the cast that follows a moment later.
   */
  cast_windup: {
    category: "combat", variants: 2, gain: 0.3, retriggerMs: 160,
    render: (r, j) => {
      const out = buffer(0.34);
      mixInto(out, tone({ from: 200 * j, to: 620 * j, length: 0.3, gain: 0.3, env: { attack: 0.1, curve: 1.2 }, fm: { ratio: 2.01, index: 1.4, decay: 0.4 } }), 0);
      mixInto(out, highpass(noiseBurst(0.3, r, 0.12, { attack: 0.16, curve: 1.2 }), 2400), 0);
      return finish(out, "combat");
    },
  },

  /**
   * Arcane: released energy. A resonance that opens upward with a chime
   * inside it, in the middle of the register.
   *
   * It keeps one FM partial, because arcane is the school that is *meant* to
   * be tuned — but the body is now a swept resonance rather than a second
   * bell, which is what keeps it out of frost's territory an octave and a half
   * above it.
   */
  cast_arcane: {
    category: "combat", variants: 3, gain: 0.28, retriggerMs: 95,
    render: (r, j) => {
      const out = buffer(0.32);
      mixInto(out, bell(660 * j, 0.2, 3.51, 4, 0.5, 2.6), 0);
      mixInto(out, sweepBandpass(noiseBurst(0.22, r, 0.5, { attack: 0.002, curve: 2.4 }), 900 * j, 3600 * j, 3), 0);
      mixInto(out, tone({ wave: "triangle", from: 520 * j, to: 1560 * j, length: 0.1, gain: 0.2, env: { attack: 0.002, curve: 3 } }), 0);
      mixInto(out, highpass(noiseBurst(0.03, r, 0.16, { attack: 0, curve: 6 }), 4200), 0);
      return finish(tail(out, 0.04, 0.3, 0.18, 6000), "combat");
    },
  },

  /**
   * Storm: a discharge. Crack, arc, sparks — and not one periodic partial in
   * it.
   *
   * This used to be a pulse wave under a bed of pops, and a pulse wave with a
   * decay is a pitch: it read as ice cubes in a glass, which is precisely the
   * sound frost is supposed to own. The rebuild has no stable oscillator
   * anywhere. The front is broadband noise with a zero-sample attack; the body
   * is `arcBuzz`, whose pitch is re-rolled every seven milliseconds and then
   * dragged through a bandpass that climbs two octaves while it plays; the
   * sparks on top are three-to-fourteen-millisecond ticks at random heights.
   * The only tuned layer is a thump far below anything the crackle occupies,
   * and it is there for weight rather than for pitch.
   */
  cast_storm: {
    category: "combat", variants: 3, gain: 0.3, retriggerMs: 95,
    render: (r, j) => {
      const out = buffer(0.34);
      mixInto(out, crack(r, 0.05, 0.85, 800 * j), 0);
      mixInto(out, sweepBandpass(arcBuzz(r, 0.24, 780 * j, 0.6), 1500 * j, 5600 * j, 2.2), 0.003);
      mixInto(out, sparks(r, 0.3, 24, 0.5, 4600 * j), 0.002);
      mixInto(out, thump(120 * j, 48, 0.12, 0.35, 3.4), 0);
      return finish(out, "combat", 1.5);
    },
  },

  /**
   * Stone: a thud with grit on it, and no tuned layer at all.
   *
   * The FM partial it used to carry was the only thing in it with a pitch,
   * which meant a rock landing had a small bell inside it. The weight now
   * comes from the drop alone, and the character from the rubble that falls
   * after it.
   */
  cast_stone: {
    category: "combat", variants: 2, gain: 0.36, retriggerMs: 110,
    render: (r, j) => {
      const out = buffer(0.4);
      mixInto(out, thump(230 * j, 52, 0.32, 0.95, 2.2), 0);
      mixInto(out, grit(r, 0.22, 800 * j, 0.62, 0.7), 0.004);
      mixInto(out, grit(r, 0.12, 2200 * j, 0.28, 1.8), 0.002);
      // The rubble: a handful of chips arriving late and unevenly.
      for (let k = 0; k < 7; k++) mixInto(out, grit(r, 0.04, 1500 * j * (0.6 + r() * 1.4), 0.22, 3.2), 0.05 + r() * 0.24);
      return finish(out, "combat", 1.3);
    },
  },

  /** Flame: a whoosh into a roar, with embers coming off it. */
  cast_flame: {
    category: "combat", variants: 2, gain: 0.32, retriggerMs: 100,
    render: (r, j) => {
      const out = buffer(0.48);
      // The ignition is air *accelerating* — a fast filter sweep — landing in
      // a roar, whose filter sits still while its amplitude flutters. That
      // pair is the difference between fire and a portal, which is air alone.
      mixInto(out, sweepLowpass(noiseBurst(0.14, r, 0.8, { attack: 0.002, curve: 2.2 }), 600 * j, 4200 * j, 1.1), 0);
      mixInto(out, roar(r, 0.36, 900 * j, 0.6, j), 0.02);
      mixInto(out, crackle(r, 0.36, 1700 * j, 12, 0.3), 0.05);
      mixInto(out, thump(150 * j, 58, 0.22, 0.55, 2.4), 0);
      return finish(out, "combat", 1.25);
    },
  },

  /** Frost: a crystalline tink with a shimmer of ice behind it. */
  cast_frost: {
    category: "combat", variants: 3, gain: 0.28, retriggerMs: 95,
    render: (r, j) => {
      const out = buffer(0.36);
      mixInto(out, bell(2100 * j, 0.2, 7.03, 2.6, 0.42, 3), 0);
      mixInto(out, bell(3150 * j, 0.13, 4.77, 1.4, 0.2, 3.4), 0.006);
      mixInto(out, bandpass(noiseBurst(0.24, r, 0.3, { attack: 0.004, curve: 2.4 }), 6200, 1.6), 0.002);
      mixInto(out, tone({ from: 620 * j, to: 900 * j, length: 0.1, gain: 0.12, env: { attack: 0, curve: 3 } }), 0);
      return finish(tail(out, 0.03, 0.34, 0.2, 7000), "combat");
    },
  },

  /**
   * Venom: a wet hiss with a bubble in it. The hiss carries the school — a
   * mid band of noise that swells and falls away — and the bubble is only
   * there to say the hiss came out of a liquid.
   */
  cast_venom: {
    category: "combat", variants: 2, gain: 0.3, retriggerMs: 100,
    render: (r, j) => {
      const out = buffer(0.4);
      const hiss = bandpass(noiseBurst(0.34, r, 0.55, { attack: 0.02, curve: 1.6 }), 2200 * j, 1.1);
      // The wobble is what makes it wet rather than merely noisy.
      for (let i = 0; i < hiss.length; i++) {
        hiss[i] = hiss[i]! * (0.6 + 0.4 * Math.sin((i / SAMPLE_RATE) * 13 * Math.PI * 2));
      }
      mixInto(out, hiss, 0.01);
      mixInto(out, lowpass(tone({ from: 700 * j, to: 190 * j, length: 0.14, gain: 0.45, env: { attack: 0.002, curve: 2.6 }, vibrato: { hz: 26, cents: 180 } }), 1600), 0);
      mixInto(out, lowpass(noiseBurst(0.2, r, 0.24, { attack: 0.012, curve: 1.8 }), 900), 0.02);
      mixInto(out, thump(150 * j, 78, 0.1, 0.28), 0);
      return finish(out, "combat", 1.2);
    },
  },

  /** Void: a sub pull. It arrives from under the mix rather than over it. */
  cast_void: {
    category: "combat", variants: 2, gain: 0.42, retriggerMs: 90,
    render: (r, j) => {
      const out = buffer(0.6);
      mixInto(out, tone({ from: 55 * j, to: 34 * j, length: 0.5, gain: 0.9, env: { attack: 0.08, curve: 1.6 } }), 0);
      mixInto(out, tone({ from: 110 * j, to: 68 * j, length: 0.42, gain: 0.26, env: { attack: 0.06, curve: 1.8 }, fm: { ratio: 1.414, index: 3, decay: 1.2 } }), 0);
      // Air pulled inward: both sweeps run the other way from every other
      // cast, and the band closing on the sub is what makes it a *suck*
      // rather than a hum with noise over it.
      mixInto(out, sweepLowpass(noiseBurst(0.42, r, 0.24, { attack: 0.28, curve: 3 }), 3200, 300, 1), 0);
      mixInto(out, sweepBandpass(noiseBurst(0.44, r, 0.34, { attack: 0.34, curve: 2.4 }), 2600, 220, 1.6), 0);
      return finish(out, "combat", 1.1);
    },
  },

  /**
   * Spirit: breath. Two vowel-ish noise bands over a barely-there fifth.
   *
   * The noise carries it and the tones only tint it: a pair of formants is
   * heard as a voice, and a voice with no attack is the one thing in the set
   * that arrives without an event happening.
   */
  cast_spirit: {
    category: "combat", variants: 2, gain: 0.3, retriggerMs: 60,
    render: (r, j) => {
      const out = buffer(0.58);
      mixInto(out, bandpass(noiseBurst(0.46, r, 0.5, { attack: 0.14, curve: 1.3 }), 720 * j, 5), 0);
      mixInto(out, bandpass(noiseBurst(0.44, r, 0.4, { attack: 0.16, curve: 1.3 }), 2100 * j, 4), 0.01);
      mixInto(out, highpass(noiseBurst(0.4, r, 0.18, { attack: 0.1, curve: 1.5 }), 5200), 0.02);
      mixInto(out, tone({ wave: "triangle", from: 660 * j, length: 0.36, gain: 0.16, env: { attack: 0.09, curve: 2 }, vibrato: { hz: 5.5, cents: 22 } }), 0);
      mixInto(out, tone({ wave: "triangle", from: 990 * j, length: 0.3, gain: 0.1, env: { attack: 0.11, curve: 2.2 }, vibrato: { hz: 4.2, cents: 26 } }), 0.03);
      return finish(tail(out, 0.06, 0.4, 0.3, 4200), "combat");
    },
  },

  /* --------------------- a spell landing, by school family ---------------- */

  /**
   * Storm landing: the arc earthing. The same material as the cast, shorter
   * and with the sweep running the other way — the discharge closes rather
   * than opening, and the sparks die in a tenth of a second.
   */
  impact_storm: {
    category: "combat", variants: 2, gain: 0.44, retriggerMs: 55,
    render: (r, j) => {
      const out = buffer(0.28);
      mixInto(out, crack(r, 0.035, 1, 1100 * j), 0);
      mixInto(out, sweepBandpass(arcBuzz(r, 0.13, 1100 * j, 0.55, 2.6), 5200 * j, 1400 * j, 2.4), 0.002);
      mixInto(out, sparks(r, 0.18, 14, 0.45, 5200 * j), 0.002);
      mixInto(out, thump(170 * j, 52, 0.12, 0.5, 3), 0);
      return finish(out, "combat", 1.5);
    },
  },

  /** Flame landing: a woof of ignition with embers after it. */
  impact_flame: {
    category: "combat", variants: 2, gain: 0.46, retriggerMs: 60,
    render: (r, j) => {
      const out = buffer(0.44);
      mixInto(out, sweepLowpass(noiseBurst(0.3, r, 0.7, { attack: 0.004, curve: 2 }), 2600, 500, 0.9), 0);
      mixInto(out, thump(140 * j, 46, 0.24, 0.7, 2.2), 0);
      mixInto(out, crackle(r, 0.34, 2200 * j, 9, 0.28), 0.06);
      return finish(out, "combat", 1.3);
    },
  },

  /** Frost landing: glass breaking, not stone. Bright, and it rings a moment. */
  impact_frost: {
    category: "combat", variants: 2, gain: 0.44, retriggerMs: 55,
    render: (r, j) => {
      const out = buffer(0.42);
      mixInto(out, click(r, 6400 * j, 0.014, 0.9), 0);
      mixInto(out, bell(1700 * j, 0.26, 6.7, 4.5, 0.5, 2.2), 0);
      for (let k = 0; k < 5; k++) mixInto(out, bell(2600 * j * (0.8 + r() * 0.9), 0.08, 5.1, 2, 0.13), 0.02 + r() * 0.16);
      mixInto(out, thump(210 * j, 90, 0.1, 0.3), 0);
      return finish(tail(out, 0.03, 0.34, 0.22, 7200), "combat", 1.2);
    },
  },

  /** Venom landing: a splat. All body, no top, and it stays wet. */
  impact_venom: {
    category: "combat", variants: 2, gain: 0.42, retriggerMs: 60,
    render: (r, j) => {
      const out = buffer(0.36);
      mixInto(out, lowpass(noiseBurst(0.06, r, 0.8, { attack: 0, curve: 5 }), 1400), 0);
      mixInto(out, lowpass(tone({ from: 420 * j, to: 110 * j, length: 0.2, gain: 0.55, env: { attack: 0.001, curve: 2.4 }, vibrato: { hz: 18, cents: 140 } }), 1600), 0);
      mixInto(out, lowpass(noiseBurst(0.24, r, 0.2, { attack: 0.02, curve: 1.8 }), 800), 0.03);
      return finish(out, "combat", 1.25);
    },
  },

  /** Stone landing: a rock arriving on a body. Dull, short, and all low. */
  impact_stone: {
    category: "combat", variants: 2, gain: 0.44, retriggerMs: 55,
    render: (r, j) => {
      const out = buffer(0.3);
      mixInto(out, click(r, 1800 * j, 0.018, 0.7), 0);
      mixInto(out, thump(200 * j, 56, 0.18, 0.9, 2.6), 0);
      mixInto(out, grit(r, 0.12, 900 * j, 0.5, 0.9), 0.002);
      for (let k = 0; k < 4; k++) mixInto(out, grit(r, 0.03, 2000 * j * (0.7 + r()), 0.18, 3.4), 0.03 + r() * 0.12);
      return finish(out, "combat", 1.35);
    },
  },

  /** Void landing: the body falls into it. A drop, and the air after it. */
  impact_void: {
    category: "combat", variants: 2, gain: 0.42, retriggerMs: 70,
    render: (r, j) => {
      const out = buffer(0.42);
      mixInto(out, tone({ from: 190 * j, to: 42, length: 0.3, gain: 0.85, env: { attack: 0.001, curve: 2 } }), 0);
      mixInto(out, sweepBandpass(noiseBurst(0.3, r, 0.4, { attack: 0.02, curve: 2 }), 2200, 240, 1.4), 0);
      mixInto(out, lowpass(noiseBurst(0.05, r, 0.35, { attack: 0, curve: 5 }), 900), 0);
      return finish(out, "combat", 1.2);
    },
  },

  /* --------------------- a spell's form, not its element ------------------ */

  /**
   * These exist because a school is not a spell. Eight school voices meant a
   * shotgun, a summon, an orbit and a dash all announced themselves with the
   * same noise, and the player could not hear *what they had cast* — only
   * which element it was tinted in, which the screen already says. Each of
   * these is a **form**: the sound of the thing the spell does.
   */

  /** A heavy shard thrown: air with a rock in it, and no ring at all. */
  cast_shard: {
    category: "combat", variants: 2, gain: 0.34, retriggerMs: 90,
    render: (r, j) => {
      const out = buffer(0.3);
      mixInto(out, air(r, 0.18, 320 * j, 1500 * j, 0.8), 0);
      mixInto(out, grit(r, 0.1, 850 * j, 0.45, 0.9), 0.01);
      mixInto(out, thump(190 * j, 96, 0.1, 0.4, 3), 0);
      return finish(out, "combat", 1.25);
    },
  },

  /**
   * A cone of pellets: a shotgun. One flat broadband report, a boom under it,
   * and the pellets themselves arriving inside the first sixtieth of a second
   * — which is the detail that makes it a shot rather than an explosion.
   */
  cast_scatter: {
    category: "combat", variants: 2, gain: 0.42, retriggerMs: 130,
    render: (r, j) => {
      const out = buffer(0.42);
      mixInto(out, lowpass(noiseBurst(0.04, r, 1, { attack: 0, curve: 6 }), 4200), 0);
      mixInto(out, thump(140 * j, 40, 0.24, 0.9, 2.2), 0);
      mixInto(out, sweepLowpass(noiseBurst(0.3, r, 0.4, { attack: 0.003, curve: 2 }), 3000, 420, 0.9), 0.004);
      for (let k = 0; k < 6; k++) mixInto(out, grit(r, 0.025, 2600 * j * (0.7 + r() * 0.8), 0.28, 3.4), 0.004 + r() * 0.055);
      return finish(out, "combat", 1.4);
    },
  },

  /** A lance of current: the arc, stretched into a line and thrown. */
  cast_lance: {
    category: "combat", variants: 2, gain: 0.34, retriggerMs: 80,
    render: (r, j) => {
      const out = buffer(0.34);
      // Quieter front, longer arc than the cast: a lance is a line held open
      // for a moment, where a chip off a wall is over in twenty milliseconds
      // — and with a louder crack these two measured as the same sound.
      mixInto(out, crack(r, 0.02, 0.35, 1600 * j), 0);
      mixInto(out, sweepBandpass(arcBuzz(r, 0.3, 900 * j, 0.9, 1.1), 2600 * j, 1100 * j, 3), 0);
      mixInto(out, sparks(r, 0.26, 8, 0.22, 5200 * j), 0.006);
      return finish(out, "combat", 1.4);
    },
  },

  /** A heavy orb leaving the hand: a launch felt rather than heard. */
  cast_orb: {
    category: "combat", variants: 2, gain: 0.42, retriggerMs: 200,
    render: (r, j) => {
      const out = buffer(0.46);
      mixInto(out, tone({ from: 120 * j, to: 62 * j, length: 0.34, gain: 0.9, env: { attack: 0.006, curve: 1.8 } }), 0);
      mixInto(out, lowpass(tone({ wave: "triangle", from: 240 * j, to: 130 * j, length: 0.2, gain: 0.3, env: { attack: 0.004, curve: 2.2 } }), 900), 0);
      mixInto(out, sweepLowpass(noiseBurst(0.26, r, 0.3, { attack: 0.006, curve: 2 }), 1800, 400, 0.9), 0);
      return finish(out, "combat", 1.15);
    },
  },

  /**
   * Blades taking up an orbit: a rotating whoosh that settles into a hum.
   *
   * Three airs a fifth of a second apart *is* the rotation — the ear reads
   * evenly spaced whooshes as something going round — and the hum under them
   * is what says it stayed.
   */
  cast_orbit: {
    category: "combat", variants: 2, gain: 0.3, retriggerMs: 300,
    render: (r, j) => {
      const out = buffer(0.66);
      for (let k = 0; k < 3; k++) mixInto(out, air(r, 0.16, 600 * j, 2400 * j, 0.5 - k * 0.08), 0.02 + k * 0.15);
      const hum = lowpass(tone({ wave: "triangle", from: 180 * j, length: 0.6, gain: 0.3, env: { attack: 0.08, curve: 1.2, sustain: 0.5 } }), 1200);
      for (let i = 0; i < hum.length; i++) hum[i] = hum[i]! * (0.6 + 0.4 * Math.sin((i / SAMPLE_RATE) * 6.5 * Math.PI * 2));
      mixInto(out, hum, 0.02);
      return finish(out, "combat", 1.15);
    },
  },

  /** A field taking: the ignition, and then the ground quietly burning. */
  cast_field: {
    category: "combat", variants: 2, gain: 0.36, retriggerMs: 400,
    render: (r, j) => {
      const out = buffer(0.72);
      mixInto(out, sweepLowpass(noiseBurst(0.12, r, 0.75, { attack: 0.002, curve: 2.4 }), 500 * j, 3600 * j, 1.1), 0);
      mixInto(out, roar(r, 0.58, 700 * j, 0.45, j * 3), 0.05);
      mixInto(out, crackle(r, 0.55, 1900 * j, 9, 0.2), 0.1);
      mixInto(out, thump(120 * j, 52, 0.2, 0.4, 2.4), 0);
      return finish(out, "combat", 1.2);
    },
  },

  /** A blink: one swish, over before the eye has finished moving. */
  cast_blink: {
    category: "combat", variants: 2, gain: 0.3, retriggerMs: 140,
    render: (r, j) => {
      const out = buffer(0.22);
      mixInto(out, air(r, 0.07, 1800 * j, 700 * j, 0.45), 0);
      mixInto(out, air(r, 0.13, 700 * j, 5200 * j, 0.85), 0.04);
      mixInto(out, highpass(noiseBurst(0.02, r, 0.25, { attack: 0, curve: 7 }), 3800), 0.05);
      return finish(out, "combat", 1.2);
    },
  },

  /** A summon arriving: a breath in, answered by a chime. */
  cast_summon: {
    category: "combat", variants: 2, gain: 0.34, retriggerMs: 400,
    render: (r, j) => {
      const out = buffer(0.62);
      mixInto(out, sweepLowpass(noiseBurst(0.22, r, 0.4, { attack: 0.14, curve: 1.4 }), 400, 3200, 1.1), 0);
      mixInto(out, bell(784 * j, 0.36, 2.01, 1.8, 0.4, 2.2), 0.16);
      mixInto(out, bell(1176 * j, 0.28, 3.01, 1.2, 0.22, 2.6), 0.2);
      mixInto(out, tone({ from: 196 * j, length: 0.4, gain: 0.18, env: { attack: 0.04, curve: 1.8 } }), 0.14);
      return finish(tail(out, 0.05, 0.34, 0.24, 5000), "combat");
    },
  },

  /** A nova: everything leaving at once, outward. */
  cast_nova: {
    category: "combat", variants: 2, gain: 0.44, retriggerMs: 300,
    render: (r, j) => {
      const out = buffer(0.56);
      // The front is deliberately soft for a burst: a hard broadband click
      // here made this the twin of a shot chipping a wall, and the two are
      // answered very differently.
      mixInto(out, lowpass(noiseBurst(0.05, r, 0.5, { attack: 0.002, curve: 3.4 }), 3600), 0);
      mixInto(out, sweepLowpass(noiseBurst(0.44, r, 0.7, { attack: 0.01, curve: 1.4 }), 6000, 700, 1), 0);
      mixInto(out, thump(180 * j, 44, 0.3, 0.75, 2), 0);
      // The ring of shards going out, thinning as it widens.
      for (let k = 0; k < 9; k++) mixInto(out, bell(2400 * j * (0.8 + r() * 0.7), 0.09, 5.1, 1.6, 0.16, 2.2), 0.03 + k * 0.042);
      return finish(tail(out, 0.035, 0.32, 0.2, 6400), "combat", 1.3);
    },
  },

  /** A swarm leaving: several small wings, none of them together. */
  cast_swarm: {
    category: "combat", variants: 2, gain: 0.3, retriggerMs: 160,
    render: (r, j) => {
      const out = buffer(0.44);
      for (let k = 0; k < 5; k++) {
        const flutter = bandpass(noiseBurst(0.12 + r() * 0.08, r, 0.4, { attack: 0.01, curve: 2 }), (1800 + r() * 2200) * j, 3);
        const rate = 34 + r() * 26;
        for (let i = 0; i < flutter.length; i++) flutter[i] = flutter[i]! * (0.4 + 0.6 * Math.sin((i / SAMPLE_RATE) * rate * Math.PI * 2));
        mixInto(out, flutter, r() * 0.14);
      }
      mixInto(out, tone({ wave: "triangle", from: 520 * j, to: 900 * j, length: 0.16, gain: 0.16, env: { attack: 0.01, curve: 2.4 } }), 0);
      return finish(out, "combat", 1.2);
    },
  },

  /** A fault opening: the floor tearing along a line, away from the caster. */
  cast_rift: {
    category: "combat", variants: 2, gain: 0.4, retriggerMs: 260,
    render: (r, j) => {
      const out = buffer(0.56);
      mixInto(out, thump(150 * j, 38, 0.36, 0.9, 1.8), 0);
      mixInto(out, lowpass(noiseBurst(0.44, r, 0.55, { attack: 0.01, curve: 1.4, sustain: 0.3 }), 520 * j), 0);
      mixInto(out, sweepBandpass(noiseBurst(0.4, r, 0.4, { attack: 0.006, curve: 1.6 }), 900 * j, 2600 * j, 2), 0.01);
      for (let k = 0; k < 6; k++) mixInto(out, grit(r, 0.05, 1800 * j * (0.6 + r() * 1.2), 0.24, 3), 0.06 + r() * 0.3);
      return finish(out, "combat", 1.3);
    },
  },

  /** A ward coming up out of the floor: stone grinding, then standing still. */
  cast_ward: {
    category: "combat", variants: 2, gain: 0.36, retriggerMs: 400,
    render: (r, j) => {
      const out = buffer(0.66);
      mixInto(out, grit(r, 0.42, 620 * j, 0.55, 0.6), 0);
      mixInto(out, sweepBandpass(noiseBurst(0.4, r, 0.45, { attack: 0.06, curve: 1.2, sustain: 0.4 }), 700 * j, 2000 * j, 1.8), 0.01);
      mixInto(out, tone({ from: 70 * j, to: 128 * j, length: 0.44, gain: 0.45, env: { attack: 0.1, curve: 1.3 } }), 0);
      // The stop: a ward that fades out never arrived anywhere.
      mixInto(out, thump(180 * j, 74, 0.14, 0.6, 3), 0.42);
      return finish(out, "combat", 1.2);
    },
  },

  /* -------------------------------- enemies ------------------------------- */

  /**
   * An enemy volley. Darker and hollower than anything the player makes, and
   * with no bright transient: the player's sounds own the top of the mix, so
   * a shot fired at you never masks the swing you are answering it with.
   */
  shoot_enemy: {
    category: "combat", variants: 4, gain: 0.3, retriggerMs: 55,
    render: (r, j) => {
      const out = buffer(0.22);
      mixInto(out, tone({ wave: "triangle", from: 400 * j, to: 150 * j, length: 0.14, gain: 0.4, env: { attack: 0.001, curve: 2.6 } }), 0);
      mixInto(out, thump(130 * j, 62, 0.16, 0.4), 0);
      mixInto(out, lowpass(noiseBurst(0.06, r, 0.2, { attack: 0, curve: 4 }), 2000 * j), 0);
      return finish(out, "combat");
    },
  },

  /** The blunderbuss: a boom with a cloud of powder behind it. */
  shoot_heavy: {
    category: "combat", variants: 2, gain: 0.5, retriggerMs: 200,
    render: (r, j) => {
      const out = buffer(0.5);
      mixInto(out, lowpass(noiseBurst(0.05, r, 1, { attack: 0, curve: 5 }), 3600), 0);
      mixInto(out, thump(120 * j, 34, 0.34, 1, 2), 0);
      mixInto(out, sweepLowpass(noiseBurst(0.38, r, 0.45, { attack: 0.003, curve: 1.9 }), 3000, 300, 0.9), 0.004);
      mixInto(out, grit(r, 0.2, 700 * j, 0.25, 0.7), 0.03);
      return finish(tail(out, 0.06, 0.32, 0.22, 1600), "combat", 1.4);
    },
  },

  /**
   * A charge winding up: rising and tightening. The contour is the
   * instruction — it says a body is about to cross the room in a straight
   * line, and the answer is to stop being on that line.
   */
  tele_charge: {
    category: "combat", variants: 2, gain: 0.44, retriggerMs: 200,
    render: (r, j) => {
      const out = buffer(0.42);
      mixInto(out, tone({ wave: "saw", from: 150 * j, to: 640 * j, length: 0.34, gain: 0.3, env: { attack: 0.06, curve: 0.7, sustain: 0.5 } }), 0);
      mixInto(out, sweepLowpass(noiseBurst(0.34, r, 0.3, { attack: 0.08, curve: 0.8, sustain: 0.4 }), 600, 4200, 1.3), 0);
      // The scuff of the foot that starts it.
      mixInto(out, grit(r, 0.08, 1800 * j, 0.3, 1.2), 0.26);
      return finish(out, "combat", 1.2);
    },
  },

  /**
   * A slam gathering: falling and swelling, with a dread pair under it. The
   * opposite contour to a charge on purpose — this one says the ground under
   * the circle is about to stop being ground.
   */
  tele_slam: {
    category: "combat", variants: 2, gain: 0.48, retriggerMs: 220,
    render: (r, j) => {
      const out = buffer(0.54);
      mixInto(out, tone({ wave: "triangle", from: 260 * j, to: 96 * j, length: 0.46, gain: 0.44, env: { attack: 0.14, curve: 0.8, sustain: 0.5 } }), 0);
      mixInto(out, tone({ from: 130 * j, to: 48 * j, length: 0.48, gain: 0.45, env: { attack: 0.2, curve: 0.8, sustain: 0.6 } }), 0);
      mixInto(out, lowpass(noiseBurst(0.46, r, 0.24, { attack: 0.3, curve: 1, sustain: 0.3 }), 1200), 0);
      return finish(out, "combat", 1.15);
    },
  },

  /**
   * A ranged body taking aim: two thin steady tones, no sweep at all. It has
   * to be told from the two movement telegraphs while several of each are
   * running, so it is the only one that does not move in pitch.
   */
  tele_aim: {
    category: "combat", variants: 2, gain: 0.34, retriggerMs: 200,
    render: (r, j) => {
      const out = buffer(0.4);
      mixInto(out, tone({ wave: "square", from: 1180 * j, length: 0.1, gain: 0.2, env: { attack: 0.004, curve: 2 } }), 0);
      mixInto(out, tone({ wave: "square", from: 1180 * j, length: 0.16, gain: 0.22, env: { attack: 0.004, curve: 2 } }), 0.16);
      mixInto(out, highpass(noiseBurst(0.3, r, 0.07, { attack: 0.02, curve: 1.2 }), 3600), 0);
      return finish(out, "combat", 1.1);
    },
  },

  /*
   * The blow itself, on the step a windup commits. A telegraph promises an
   * attack; this is the attack arriving, and a dodged blow used to be
   * silent — the only sound it ever made was the player's hurt, which is
   * the one outcome the telegraph exists to avoid. Air and weight only, no
   * pitch: three shapes for three families of move.
   */

  /** A line attack leaving: charge, thrust, lance, bash. A rush of air forward, with the body behind it. */
  enemy_lunge: {
    category: "combat", variants: 3, gain: 0.4, retriggerMs: 90,
    render: (r, j) => {
      const out = buffer(0.3);
      mixInto(out, air(r, 0.2, 700 * j, 3000 * j, 0.9), 0);
      mixInto(out, thump(170 * j, 70, 0.14, 0.45), 0.01);
      mixInto(out, grit(r, 0.05, 1100 * j, 0.3, 1.2), 0);
      return finish(out, "combat", 1.2);
    },
  },

  /** A blade or claw crossing an arc: slash, claw, sweep, whirlwind, cleave, slam. Darker and broader than the player's swing. */
  enemy_swipe: {
    category: "combat", variants: 3, gain: 0.38, retriggerMs: 90,
    render: (r, j) => {
      const out = buffer(0.3);
      mixInto(out, air(r, 0.22, 500 * j, 2400 * j, 0.95), 0);
      mixInto(out, air(r, 0.14, 2000 * j, 600 * j, 0.4), 0.05);
      mixInto(out, thump(130 * j, 60, 0.12, 0.3), 0.06);
      return finish(out, "combat", 1.2);
    },
  },

  /** Spines shot out all round at once: bristle. A handful of sharp scrapes on one instant, over a dull push. */
  enemy_spikes: {
    category: "combat", variants: 2, gain: 0.42, retriggerMs: 120,
    render: (r, j) => {
      const out = buffer(0.26);
      for (let k = 0; k < 6; k++) mixInto(out, grit(r, 0.04 + r() * 0.03, (1600 + r() * 1800) * j, 0.35, 2), k * 0.006 + r() * 0.01);
      mixInto(out, air(r, 0.12, 2400 * j, 900 * j, 0.5), 0);
      mixInto(out, thump(210 * j, 90, 0.1, 0.4), 0);
      return finish(out, "combat", 1.25);
    },
  },

  /**
   * The boss's ground strikes — the slam, the quake, the landing of the leap.
   * Its own sound rather than a heavy hit played low: the hit is the
   * player's answer and fires several times a second in this fight, so the
   * boss's biggest moves were losing their voice to the player's blows. A
   * sub drop, the crack of stone, and debris settling after.
   */
  boss_impact: {
    category: "combat", variants: 3, gain: 0.6, retriggerMs: 160,
    render: (r, j) => {
      const out = buffer(0.7);
      mixInto(out, thump(90 * j, 32, 0.5, 1, 2), 0);
      mixInto(out, click(r, 1800 * j, 0.03, 0.8), 0);
      mixInto(out, grit(r, 0.22, 900 * j, 0.7, 1), 0.01);
      mixInto(out, lowpass(noiseBurst(0.3, r, 0.4, { attack: 0.01, curve: 2 }), 600), 0.02);
      for (let k = 0; k < 5; k++) mixInto(out, grit(r, 0.04, (1400 + r() * 1600) * j, 0.12 + r() * 0.1, 2), 0.15 + r() * 0.35);
      return finish(out, "combat", 1.3);
    },
  },

  /**
   * The king's footfall. He walks on the beat of his theme, two beats to a
   * step, and each one lands: armour on stone, low and short, a thud rather
   * than a tone. Quiet — it is weight under the fight, not a cue in it.
   */
  boss_step: {
    category: "world", variants: 3, gain: 0.3, retriggerMs: 300,
    render: (r, j) => {
      const out = buffer(0.22);
      mixInto(out, thump(80 * j, 38, 0.18, 1, 2.5), 0);
      mixInto(out, lowpass(noiseBurst(0.06, r, 0.35, { attack: 0.002, curve: 3 }), 700), 0);
      mixInto(out, grit(r, 0.05, 1200 * j, 0.12, 1.4), 0.01);
      return finish(out, "world", 1.2);
    },
  },

  /** The boss's arms sweeping the floor: a long heavy rush of air, low and wide. */
  boss_sweep: {
    category: "combat", variants: 2, gain: 0.46, retriggerMs: 140,
    render: (r, j) => {
      const out = buffer(0.5);
      mixInto(out, air(r, 0.42, 300 * j, 1800 * j, 1), 0);
      mixInto(out, air(r, 0.3, 1500 * j, 400 * j, 0.5), 0.1);
      mixInto(out, thump(100 * j, 50, 0.3, 0.4, 1.5), 0.08);
      return finish(out, "combat", 1.2);
    },
  },

  /** A sleeper waking: a breath in, and a body finding its feet. */
  enemy_wake: {
    category: "combat", variants: 3, gain: 0.4, retriggerMs: 260,
    render: (r, j) => {
      const out = buffer(0.44);
      mixInto(out, sweepLowpass(noiseBurst(0.22, r, 0.5, { attack: 0.09, curve: 1.6 }), 500, 2600, 1.2), 0);
      mixInto(out, tone({ wave: "triangle", from: 190 * j, to: 300 * j, length: 0.24, gain: 0.26, env: { attack: 0.05, curve: 1.6 } }), 0.02);
      mixInto(out, grit(r, 0.1, 1400 * j, 0.25, 1.2), 0.22);
      return finish(out, "combat", 1.15);
    },
  },

  /** The boss turning over into its next phase: a low horn and a shudder. */
  boss_phase: {
    category: "combat", variants: 2, gain: 0.8, retriggerMs: 1500,
    render: (r, j) => {
      const out = buffer(1.5);
      mixInto(out, tone({ wave: "saw", from: 74 * j, length: 1, gain: 0.34, env: { attack: 0.1, curve: 1.4 }, vibrato: { hz: 4.5, cents: 16 } }), 0);
      mixInto(out, tone({ wave: "saw", from: 111 * j, length: 0.86, gain: 0.2, env: { attack: 0.16, curve: 1.6 } }), 0.06);
      mixInto(out, thump(90 * j, 34, 0.7, 0.8, 1.6), 0);
      mixInto(out, sweepLowpass(noiseBurst(0.9, r, 0.3, { attack: 0.02, curve: 1.5 }), 2400, 260, 0.9), 0.02);
      mixInto(out, grit(r, 0.6, 600 * j, 0.2, 0.7), 0.1);
      return finish(tail(out, 0.1, 0.42, 0.3, 1800), "combat", 1.25);
    },
  },

  /**
   * **The king's roar** at a phase change (`Enemy.bossRoarMs`, five beats).
   * A throat, not a tone: two low saws a fifth apart sliding down under a
   * rough vibrato, a sub under them, and the whole voice fluttered at a
   * jaw's rate so it growls rather than hums; through it, breath swept up
   * the vowel of an "ah" and back. A blow of armour at its head, where the
   * plates burst off him, and the hall's tail after, since it fills the room.
   */
  boss_roar: {
    category: "combat", variants: 2, gain: 0.9, retriggerMs: 1500,
    render: (r, j) => {
      const len = 1.7;
      const voice = buffer(len);
      const shape = { attack: 0.16, hold: 0.9, curve: 1.2 };
      mixInto(voice, tone({ wave: "saw", from: 96 * j, to: 68 * j, length: len, gain: 0.5, env: shape, vibrato: { hz: 6.5, cents: 38 } }), 0);
      mixInto(voice, tone({ wave: "saw", from: 144 * j, to: 101 * j, length: len * 0.94, gain: 0.26, env: shape, vibrato: { hz: 5.3, cents: 30 } }), 0.02);
      mixInto(voice, tone({ wave: "saw", from: 48 * j, to: 36 * j, length: len, gain: 0.34, env: shape }), 0);
      // The flutter of a throat: amplitude shaken at a jaw's rate, a little unevenly.
      for (let i = 0, ph = 0; i < voice.length; i++) {
        ph += (26 + 6 * Math.sin(i / SAMPLE_RATE * 3.1)) / SAMPLE_RATE;
        voice[i]! *= 0.62 + 0.38 * Math.sin(ph * Math.PI * 2);
      }
      const out = buffer(len + 0.9);
      // The voice through the mouth: its vowel opened, over its own dark body.
      mixInto(out, sweepBandpass(Float32Array.from(voice), 420 * j, 880 * j, 1.1), 0, 1.1);
      mixInto(out, lowpass(voice, 520), 0, 0.8);
      // Breath, swept up the vowel and back down.
      const breath = noiseBurst(len * 0.95, r, 0.34, { attack: 0.2, hold: 0.8, curve: 1.4 });
      mixInto(out, sweepBandpass(breath, 650 * j, 1500 * j, 1.4), 0.03);
      mixInto(out, grit(r, len * 0.8, 380 * j, 0.22, 0.8), 0.05);
      // The plates bursting off him as it begins.
      mixInto(out, thump(92 * j, 30, 0.6, 0.45, 2), 0);
      mixInto(out, click(r, 1600 * j, 0.03, 0.35), 0);
      for (let k = 0; k < 4; k++) mixInto(out, grit(r, 0.05, (1500 + r() * 1800) * j, 0.14 + r() * 0.1, 2), 0.04 + r() * 0.3);
      return finish(tail(out, 0.12, 0.45, 0.34, 1500), "combat", 1.6);
    },
  },

  /* --------------------------------- world -------------------------------- */

  /** Anything picked up that is not a coin and not health. */
  pickup: {
    category: "world", variants: 2, gain: 0.6, retriggerMs: 80,
    render: (r, j) => {
      const out = buffer(0.34);
      mixInto(out, bell(784 * j, 0.16, 3.01, 2.2, 0.4, 2.6), 0);
      mixInto(out, bell(1175 * j, 0.22, 2.51, 1.4, 0.3, 2.2), 0.055);
      mixInto(out, thump(196 * j, 160 * j, 0.14, 0.3, 2), 0);
      return finish(tail(out, 0.03, 0.3, 0.18, 6000), "world");
    },
  },

  /** A coin. Two small bright partials and nothing else; it repeats a lot. */
  pickup_coin: {
    category: "world", variants: 3, gain: 0.5, retriggerMs: 45,
    render: (r, j) => {
      const out = buffer(0.2);
      mixInto(out, bell(2200 * j, 0.1, 3.7, 1.5, 0.4, 3.2), 0);
      mixInto(out, bell(3300 * j, 0.08, 2.9, 1, 0.22, 3.6), 0.022);
      return finish(out, "world");
    },
  },

  /** Health. The one warm, consonant arpeggio in the whole set. */
  pickup_heal: {
    category: "world", variants: 2, gain: 0.7, retriggerMs: 200,
    render: (r, j) => {
      const out = buffer(0.5);
      mixInto(out, tone({ wave: "triangle", from: 523 * j, length: 0.16, gain: 0.3, env: { attack: 0.006, curve: 2.4 } }), 0);
      mixInto(out, tone({ wave: "triangle", from: 659 * j, length: 0.18, gain: 0.3, env: { attack: 0.006, curve: 2.4 } }), 0.06);
      mixInto(out, tone({ wave: "triangle", from: 784 * j, length: 0.3, gain: 0.32, env: { attack: 0.006, curve: 2 } }), 0.12);
      mixInto(out, tone({ from: 262 * j, length: 0.4, gain: 0.16, env: { attack: 0.02, curve: 1.8 } }), 0.02);
      return finish(tail(out, 0.05, 0.34, 0.22, 5000), "world");
    },
  },

  /**
   * **A level** (`run/levels.ts`). The set's one *rising* figure that ends
   * held.
   *
   * It has to be recognised over a fight, once every two or three rooms, and
   * it must never be taken for a pickup — a heal and a coin are both short
   * bright things, and a third one would make the three a family. So it is
   * built the other way round from all of them: a swell underneath that grows
   * rather than decays, three steps up a major triad in the square-wave
   * register nothing else in the set uses, and a fifth left ringing over the
   * top after the steps have stopped. Long for its category, deliberately:
   * the length is what says something happened to the player rather than to
   * the floor.
   */
  level_up: {
    category: "world", variants: 1, gain: 0.85, retriggerMs: 900,
    render: (r, j) => {
      const out = buffer(1.3);
      // The swell: it opens rather than lands, which is what makes it read forward.
      mixInto(out, tone({ from: 131 * j, to: 196 * j, length: 0.72, gain: 0.24, env: { attack: 0.24, curve: 1.2 } }), 0);
      // Three steps up. Square, which nothing else in `world` speaks in.
      [392, 494, 587].forEach((hz, k) => {
        mixInto(out, tone({
          wave: "square", from: hz * j, length: 0.13, gain: 0.14,
          env: { attack: 0.004, curve: 2.8 },
        }), k * 0.08);
      });
      // And the fifth over the top, held: the note the figure arrives on.
      mixInto(out, bell(784 * j, 0.7, 2, 1.1, 0.26, 1.6), 0.24);
      mixInto(out, bell(1175 * j, 0.5, 3.01, 0.9, 0.16, 1.9), 0.3);
      // A breath of air under the arrival, so it lifts instead of pinging.
      mixInto(out, air(r, 0.42, 900, 4200, 0.16), 0.16);
      return finish(tail(out, 0.06, 0.4, 0.3, 4200), "world", 1.1);
    },
  },

  /** The way out rising out of the floor: stone moving, then a hum settling. */
  portal_open: {
    category: "world", variants: 1, gain: 0.75, retriggerMs: 900,
    render: (r, j) => {
      const out = buffer(1.3);
      mixInto(out, grit(r, 0.7, 500 * j, 0.5, 0.6), 0);
      mixInto(out, tone({ from: 70 * j, to: 140 * j, length: 0.8, gain: 0.4, env: { attack: 0.14, curve: 1.2 } }), 0);
      mixInto(out, tone({ wave: "triangle", from: 294 * j, length: 0.7, gain: 0.2, env: { attack: 0.3, curve: 1.6 }, vibrato: { hz: 3.4, cents: 14 } }), 0.3);
      mixInto(out, bell(588 * j, 0.5, 2, 1.4, 0.2, 2), 0.55);
      return finish(tail(out, 0.09, 0.4, 0.28, 3000), "world");
    },
  },

  /** Stepping through: everything swept away at once. */
  portal_enter: {
    category: "world", variants: 1, gain: 0.75, retriggerMs: 900,
    render: (r, j) => {
      const out = buffer(0.8);
      mixInto(out, sweepLowpass(noiseBurst(0.5, r, 0.6, { attack: 0.03, curve: 1.6 }), 400, 5000, 1.2), 0);
      mixInto(out, tone({ from: 180 * j, to: 900 * j, length: 0.4, gain: 0.3, env: { attack: 0.04, curve: 1.6 } }), 0);
      mixInto(out, tone({ from: 900 * j, to: 120 * j, length: 0.3, gain: 0.2, env: { attack: 0.004, curve: 2.4 } }), 0.4);
      return finish(tail(out, 0.07, 0.4, 0.3, 4000), "world");
    },
  },

  /** The reward standing up out of the floor: a lift, and a light on it. */
  reward_reveal: {
    category: "world", variants: 1, gain: 0.8, retriggerMs: 900,
    render: (r, j) => {
      const out = buffer(1.1);
      mixInto(out, sweepLowpass(noiseBurst(0.44, r, 0.4, { attack: 0.2, curve: 1.2 }), 300, 3200, 1.1), 0);
      mixInto(out, bell(523 * j, 0.5, 2, 2, 0.34, 2), 0.3);
      mixInto(out, bell(1046 * j, 0.42, 3, 1.2, 0.22, 2.4), 0.36);
      mixInto(out, tone({ from: 131 * j, length: 0.7, gain: 0.2, env: { attack: 0.06, curve: 1.6 } }), 0.26);
      return finish(tail(out, 0.06, 0.4, 0.3, 5000), "world");
    },
  },

  /**
   * The room clears. Short on purpose: the music answers a clear with its own
   * sting, and two fanfares on the same beat is one too many.
   */
  clear: {
    category: "world", variants: 1, gain: 0.7, retriggerMs: 900,
    render: (r, j) => {
      const out = buffer(0.66);
      mixInto(out, bell(392 * j, 0.16, 2, 1.6, 0.34, 3), 0);
      mixInto(out, bell(587 * j, 0.18, 2, 1.4, 0.34, 2.8), 0.08);
      mixInto(out, bell(784 * j, 0.4, 2, 1.2, 0.36, 2), 0.16);
      mixInto(out, tone({ from: 98 * j, length: 0.5, gain: 0.2, env: { attack: 0.01, curve: 1.8 } }), 0);
      return finish(tail(out, 0.05, 0.36, 0.24, 5000), "world");
    },
  },

  /** Standing in fire: a low roar with embers in it. Loops badly on purpose. */
  hazard_fire: {
    category: "world", variants: 2, gain: 0.34, retriggerMs: 300,
    render: (r, j) => {
      const out = buffer(0.44);
      // A roar, not a whoosh: the filter sits still and the amplitude
      // flutters, which is what separates burning from moving air.
      const roar = lowpass(noiseBurst(0.42, r, 0.6, { attack: 0.06, curve: 1.1, sustain: 0.5 }), 340 * j);
      for (let i = 0; i < roar.length; i++) {
        roar[i] = roar[i]! * (0.6 + 0.4 * Math.sin((i / 22050) * 17 * Math.PI * 2) * Math.sin((i / 22050) * 6.3 * Math.PI * 2));
      }
      mixInto(out, roar, 0);
      mixInto(out, crackle(r, 0.4, 2600 * j, 10, 0.22), 0);
      return finish(out, "world", 1.2);
    },
  },

  /** Ice underfoot: a thin scrape, no body at all. */
  hazard_ice: {
    category: "world", variants: 2, gain: 0.28, retriggerMs: 300,
    render: (r, j) => {
      const out = buffer(0.4);
      // A creak rather than a chime: a narrow band walked slowly upward, with
      // the groan of the sheet under it. The frost *spell* owns the tink.
      mixInto(out, bandpass(sweepLowpass(noiseBurst(0.34, r, 0.6, { attack: 0.06, curve: 1.2, sustain: 0.4 }), 1400, 3600, 2.4), 2400 * j, 4), 0);
      mixInto(out, lowpass(tone({ wave: "saw", from: 118 * j, to: 132 * j, length: 0.3, gain: 0.2, env: { attack: 0.08, curve: 1.4 }, vibrato: { hz: 11, cents: 40 } }), 700), 0.02);
      return finish(out, "world");
    },
  },

  /** A cell of stone erupting: the crack, then the shower. */
  eruption_stone: {
    category: "world", variants: 2, gain: 0.44, retriggerMs: 55,
    render: (r, j) => {
      const out = buffer(0.36);
      // The crack is the sound; the body under it is deliberately short, so
      // a line of these does not read as a line of deaths.
      mixInto(out, click(r, 2600 * j, 0.02, 1), 0);
      mixInto(out, thump(210 * j, 110, 0.08, 0.5, 3.4), 0);
      mixInto(out, grit(r, 0.1, 1900 * j, 0.55, 1.6), 0.004);
      for (let k = 0; k < 9; k++) mixInto(out, grit(r, 0.035, 3000 * j * (0.7 + r() * 0.9), 0.24, 4), 0.06 + r() * 0.24);
      return finish(out, "world", 1.3);
    },
  },

  /** A cell of fire erupting: the ignition upward, with no stone in it. */
  eruption_fire: {
    category: "world", variants: 2, gain: 0.42, retriggerMs: 55,
    render: (r, j) => {
      const out = buffer(0.46);
      // It goes *up*: the pitched column is what tells it from a fireball
      // landing, which goes down and outward.
      mixInto(out, tone({ wave: "triangle", from: 180 * j, to: 720 * j, length: 0.24, gain: 0.45, env: { attack: 0.006, curve: 2 } }), 0);
      mixInto(out, sweepLowpass(noiseBurst(0.34, r, 0.5, { attack: 0.01, curve: 1.6 }), 700, 4200, 1.1), 0);
      mixInto(out, crackle(r, 0.36, 3200 * j, 7, 0.22), 0.06);
      return finish(out, "world", 1.25);
    },
  },

  /**
   * A shot meeting stone: a chip off the wall and nothing behind it. Quiet
   * and sparse: a volley meeting a wall played it up to twenty times a
   * second, a bright tinkling over the whole fight.
   */
  wall_hit: {
    category: "world", variants: 3, gain: 0.18, retriggerMs: 140,
    render: (r, j) => {
      const out = buffer(0.1);
      mixInto(out, click(r, 5400 * j, 0.01, 1), 0);
      mixInto(out, grit(r, 0.045, 4200 * j, 0.5, 2.2), 0.001);
      mixInto(out, grit(r, 0.03, 7000 * j, 0.22, 3), 0.004);
      return finish(out, "world", 1.15);
    },
  },

  /** A shot running out in the air: it pinches out rather than stopping. */
  fizzle: {
    category: "world", variants: 2, gain: 0.26, retriggerMs: 60,
    render: (r, j) => {
      const out = buffer(0.2);
      mixInto(out, tone({ from: 900 * j, to: 2400 * j, length: 0.1, gain: 0.3, env: { attack: 0.004, curve: 3 } }), 0);
      mixInto(out, highpass(noiseBurst(0.14, r, 0.22, { attack: 0.01, curve: 2.4 }), 3200), 0);
      return finish(out, "world");
    },
  },

  /* ----------------------------------- UI --------------------------------- */

  /** Moving the highlight. Tiny: it fires on every key the player holds. */
  ui_move: {
    category: "ui", variants: 2, gain: 0.4, retriggerMs: 40,
    render: (r, j) => {
      const out = buffer(0.07);
      mixInto(out, bell(1320 * j, 0.045, 2, 0.8, 0.4, 4), 0);
      mixInto(out, highpass(noiseBurst(0.01, r, 0.1, { attack: 0, curve: 6 }), 4000), 0);
      return finish(out, "ui", 1.05);
    },
  },

  /** Committing to a row: the move's chime, answered a fourth higher. */
  ui_select: {
    category: "ui", variants: 1, gain: 0.55, retriggerMs: 90,
    render: (r, j) => {
      const out = buffer(0.24);
      mixInto(out, bell(880 * j, 0.09, 2, 1, 0.4, 3.4), 0);
      mixInto(out, bell(1320 * j, 0.16, 2, 0.9, 0.4, 2.6), 0.045);
      return finish(out, "ui", 1.05);
    },
  },

  /** Backing out: the select, inverted. */
  ui_back: {
    category: "ui", variants: 1, gain: 0.5, retriggerMs: 90,
    render: (r, j) => {
      const out = buffer(0.16);
      mixInto(out, tone({ wave: "pulse", width: 0.3, from: 880 * j, length: 0.05, gain: 0.4, env: { attack: 0.002, curve: 3.4 } }), 0);
      mixInto(out, tone({ wave: "pulse", width: 0.3, from: 587 * j, length: 0.09, gain: 0.4, env: { attack: 0.002, curve: 3 } }), 0.045);
      return finish(lowpass(out, 4200), "ui", 1.05);
    },
  },

  /** Refused: not enough gold, no free key, nothing to raise. A flat buzz. */
  ui_deny: {
    category: "ui", variants: 1, gain: 0.55, retriggerMs: 140,
    render: (r, j) => {
      const out = buffer(0.24);
      mixInto(out, tone({ wave: "square", from: 190 * j, length: 0.09, gain: 0.35, env: { attack: 0.002, curve: 3 } }), 0);
      mixInto(out, tone({ wave: "square", from: 150 * j, length: 0.13, gain: 0.35, env: { attack: 0.002, curve: 2.6 } }), 0.1);
      return finish(lowpass(out, 2200), "ui", 1.2);
    },
  },

  /** Taking a card: a bigger select, with a page turn under it. */
  card_pick: {
    category: "ui", variants: 1, gain: 0.7, retriggerMs: 200,
    render: (r, j) => {
      const out = buffer(0.42);
      mixInto(out, highpass(noiseBurst(0.1, r, 0.3, { attack: 0.006, curve: 2.4 }), 2600), 0);
      mixInto(out, bell(659 * j, 0.14, 2, 1.4, 0.36, 3), 0.02);
      mixInto(out, bell(988 * j, 0.26, 2, 1.1, 0.36, 2.2), 0.08);
      mixInto(out, tone({ from: 165 * j, length: 0.3, gain: 0.16, env: { attack: 0.01, curve: 2 } }), 0.02);
      return finish(tail(out, 0.04, 0.32, 0.2, 5000), "ui");
    },
  },

  /** The smith raising a spell: hammer, then the metal ringing up a step. */
  smith_upgrade: {
    category: "ui", variants: 1, gain: 0.8, retriggerMs: 300,
    render: (r, j) => {
      const out = buffer(0.8);
      for (let k = 0; k < 2; k++) {
        mixInto(out, click(r, 3000 * j, 0.02, 0.7), k * 0.13);
        mixInto(out, bell(1240 * j, 0.22, 3.83, 3, 0.35, 2), k * 0.13);
        mixInto(out, thump(190 * j, 70, 0.1, 0.4), k * 0.13);
      }
      mixInto(out, bell(1568 * j, 0.42, 2, 1.6, 0.34, 1.8), 0.3);
      mixInto(out, bell(2093 * j, 0.36, 3, 1.2, 0.24, 2), 0.38);
      return finish(tail(out, 0.05, 0.36, 0.24, 5200), "ui", 1.15);
    },
  },
} as const satisfies Readonly<Record<string, SfxDef>>;

export const SFX_DEFS: Readonly<Record<string, SfxDef>> = DEFS;

/** Every effect's name, in declaration order. */
export const SFX_NAMES = Object.keys(DEFS) as (keyof typeof DEFS)[];

export type SfxName = keyof typeof DEFS;

/**
 * How many sounds of a category may start inside one window.
 *
 * The per-effect retrigger floor stops one effect stacking on itself. It does
 * nothing about eight *different* deaths, four hits and a wall chip landing on
 * the same frame, which is what the end of a fight actually is — and that mix
 * clips at the loudest, most important moment in the room. A category cap
 * turns the pile into one event.
 */
export const CATEGORY_LIMIT: Readonly<Record<SfxCategory, { voices: number; windowMs: number }>> = {
  combat: { voices: 5, windowMs: 70 },
  world: { voices: 3, windowMs: 90 },
  // The UI is never a pile: it is one key press at a time, by construction.
  ui: { voices: 2, windowMs: 60 },
};

/**
 * The pitch offset of variant `v`, small and centred on 1.
 *
 * Small deliberately. The variants exist so a repeated event does not become
 * a machine noise, and a wide spread reads as a scale being played rather
 * than as the same thing happening again.
 */
export function variantJitter(v: number, variants: number): number {
  return 1 + (v - (variants - 1) / 2) * 0.045;
}

/** One variant of one effect, rendered. Deterministic in `name` and `v`. */
export function renderSfx(name: SfxName, v: number): Float32Array {
  const def = SFX_DEFS[name];
  if (!def) throw new Error(`no such sound: ${name}`);
  return def.render(rng(seedOf(`${name}:${v}`)), variantJitter(v, def.variants));
}

/** The name of every file the generator writes, sorted. */
export function sfxManifest(): string[] {
  const out: string[] = [];
  for (const name of SFX_NAMES) {
    for (let v = 0; v < SFX_DEFS[name]!.variants; v++) out.push(`${name}_${v}`);
  }
  return out.sort();
}
