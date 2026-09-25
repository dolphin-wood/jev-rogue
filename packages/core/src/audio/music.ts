/**
 * The score, as data, and the instruments that play it.
 *
 * **Why a sequencer rather than rendered loops.** The alternative was to
 * render each state's loop offline and ship it. Ninety seconds of stereo at
 * 32 kHz is eleven megabytes of wav per state, four states is forty-four, and
 * the only thing that brings that down is an encoder — Ogg or Opus — which is
 * not in this repository and cannot be added as a build dependency for one
 * asset. A sequencer costs a few kilobytes of pattern data and buys three
 * things the loops could not have given: layers that fade in and out
 * independently, so fight intensity is drums and brass *added* to the piece
 * the player is already hearing rather than a cut to a different song; a key
 * and an instrument set that follow the room's mood; and a loop that can be
 * long without being large, because length is arithmetic rather than bytes.
 *
 * **Why the instruments are sample-level and live in core.** The browser
 * could have built its notes out of `OscillatorNode`s, but then the mixdown
 * rendered offline for review would be a different piece of software from the
 * one that plays, and the verification would be measuring the wrong thing.
 * One renderer, used twice: the client renders each note once into a buffer
 * and schedules it; the harness sums the same notes into a wav.
 *
 * **The piece.** An epic dark-fantasy dungeon score in A aeolian, or in F
 * sharp phrygian when the room is cold. Slow: 76 to the minute, and the
 * harmony moves once every *two* bars — i · VI · III · VII · i · iv · VI · v,
 * sixteen bars of harmony under a thirty-two bar loop of figures, so the
 * chords come round twice while nothing above them repeats. Two and a half
 * minutes before a bar is heard twice exactly.
 *
 * What makes it epic rather than merely minor is the orchestration, and each
 * part of it is there for a reason the ear can name:
 *
 * - a **pedal drone** of detuned saws with the cutoff crawling across the
 *   note, which is the floor everything else is measured against;
 * - **strings** — four saws, none of them in tune with each other — moving
 *   only when the harmony does;
 * - a **choir**, built by running the string stack through two fixed formant
 *   bands with breath over them: vowels are absolute frequencies, not
 *   intervals, so the bands do not move with the pitch;
 * - **brass swells** on every chord change, a saw stack whose filter opens
 *   across the note, which is what a section crescendoing actually does;
 * - **taiko** on the strong beats and nowhere else: a pitched sine dropping
 *   an octave and a half in fifty milliseconds with a slap of noise on the
 *   front, with floor toms opening up only under the boss;
 * - a **heroic motif** — up a fifth, fall to the minor third, lean on the
 *   second — carried by the lead in the quiet states and doubled by the brass
 *   in the loud ones, so the same four notes are the thing the player
 *   remembers from the title screen and from the boss.
 *
 * And a rule that outranks all of it: **the score is quiet and it is sparse**.
 * It sits about six decibels under where an ordinary game score would, it has
 * no hats or sticks at all, and no state plays every layer. The epic is meant
 * to come from depth — a pedal four bars long, a brass swell with room around
 * it — rather than from how much is happening at once, because everything
 * happening at once is the same band the sword and the spells need.
 */
import {
  SAMPLE_RATE, buffer, mixInto, noiseBurst, tone, rng, seedOf,
  bandpass, highpass, lowpass, sweepLowpass, tail, saturate,
  normalisePeak, peak,
} from "./dsp.ts";

/* --------------------------------- shape ---------------------------------- */

export const TEMPO_BPM = 76;
export const BEATS_PER_BAR = 4;
export const LOOP_BARS = 32;
export const SEC_PER_BEAT = 60 / TEMPO_BPM;
export const SEC_PER_BAR = SEC_PER_BEAT * BEATS_PER_BAR;
/** A little over a hundred seconds before a bar repeats exactly. */
export const LOOP_SEC = SEC_PER_BAR * LOOP_BARS;

/** What the music is doing. The piece is the same in all of them. */
export const MUSIC_STATES = ["title", "explore", "fight", "boss"] as const;
export type MusicState = (typeof MUSIC_STATES)[number];

/** The room's temperature, as `Mood.temperature` gives it. */
export type MusicMood = "warm" | "cold";

export const MUSIC_LAYERS = [
  "drone", "pad", "choir", "bell", "bass", "arp", "lead", "brass", "drums", "toms",
] as const;
export type MusicLayer = (typeof MUSIC_LAYERS)[number];

export type MusicInstrument =
  | "drone" | "pad" | "choir" | "bell" | "bass" | "arp" | "lead" | "brass"
  | "taiko" | "frame" | "tom";

export interface MusicNote {
  readonly layer: MusicLayer;
  readonly instrument: MusicInstrument;
  /** Seconds from the start of the loop. */
  readonly atSec: number;
  readonly midi: number;
  readonly lengthSec: number;
  readonly velocity: number;
}

/**
 * How loud each layer is in each state.
 *
 * This table *is* the adaptive music. Every state plays the same notes; a
 * state change is ten gain ramps, and because the transport never restarts,
 * walking into a fight adds drums, a bass and a brass section to the bar
 * already running rather than cutting to another track.
 *
 * The four columns are deliberately *sparse*. The first version of this
 * table had eight or nine voices audible in every state, and the result was
 * a wall: a score that is busy everywhere has nowhere left to go when the
 * boss door opens, and it spends the 2-5 kHz band the sword and the spells
 * have to be heard in. Explore is now three voices — drone, strings and the
 * motif, with no bass and no pulse at all; a fight adds the taiko on the
 * strong beats, the bass and the brass; the boss adds the choir and the toms
 * on top of that. Nothing plays everything.
 */
export const LAYER_GAIN: Readonly<Record<MusicState, Readonly<Record<MusicLayer, number>>>> = {
  title: { drone: 0.6, pad: 0.55, choir: 0.4, bell: 0.3, bass: 0.22, arp: 0, lead: 0.3, brass: 0.2, drums: 0, toms: 0 },
  explore: { drone: 0.6, pad: 0.5, choir: 0.1, bell: 0.08, bass: 0, arp: 0, lead: 0.22, brass: 0, drums: 0, toms: 0 },
  fight: { drone: 0.5, pad: 0.4, choir: 0, bell: 0, bass: 0.6, arp: 0.08, lead: 0.26, brass: 0.34, drums: 0.5, toms: 0.14 },
  boss: { drone: 0.6, pad: 0.3, choir: 0.34, bell: 0, bass: 0.7, arp: 0.12, lead: 0.3, brass: 0.5, drums: 0.6, toms: 0.5 },
};

/* -------------------------------- harmony --------------------------------- */

/** A2, the tonic everything is measured from before the mood moves it. */
const TONIC_MIDI = 45;

/**
 * i · VI · III · VII · i · iv · VI · v, in semitones from the tonic, two bars
 * each.
 *
 * The three major chords in it — VI, III and VII — are what keep sixteen bars
 * of a minor key from becoming a dirge: each of them is a moment of light
 * that the return to i takes away again. Roots sit within a fifth of the
 * tonic so the bass walks rather than leaps.
 */
const PROGRESSION: readonly { readonly root: number; readonly triad: readonly number[] }[] = [
  { root: 0, triad: [0, 3, 7] },
  { root: -4, triad: [-4, 0, 3] },
  { root: -9, triad: [-9, -5, -2] },
  { root: -2, triad: [-2, 2, 5] },
  { root: 0, triad: [0, 3, 7] },
  { root: -7, triad: [-7, -4, 0] },
  { root: -4, triad: [-4, 0, 3] },
  { root: -5, triad: [-5, -2, 2] },
];

/** How many bars one chord lasts. Two: the harmony is meant to feel slow. */
const BARS_PER_CHORD = 2;

/**
 * The mood's key and mode.
 *
 * A warm room is aeolian; a cold room drops the key a minor third and
 * flattens the second into phrygian, which is the mode every dark fantasy
 * dungeon is written in. Two notes and three semitones: enough to hear, not
 * enough to be a different piece.
 */
export function moodKey(mood: MusicMood): { transpose: number; scale: readonly number[] } {
  return mood === "warm"
    ? { transpose: 0, scale: [0, 2, 3, 5, 7, 8, 10] }
    : { transpose: -3, scale: [0, 1, 3, 5, 7, 8, 10] };
}

/** Degree `d` of the scale, wrapping into octaves for degrees outside it. */
function degree(scale: readonly number[], d: number): number {
  const n = scale.length;
  const oct = Math.floor(d / n);
  return scale[((d % n) + n) % n]! + oct * 12;
}

/* -------------------------------- patterns -------------------------------- */

/**
 * Which figure each of the 32 bars uses.
 *
 * A fixed permutation rather than a modulo: `bar % 4` would repeat every four
 * bars, and the ear finds a four-bar repeat in about twenty seconds. This
 * sequence visits its four figures in an order that does not itself repeat
 * inside the loop, and because the harmony underneath runs on a sixteen-bar
 * cycle, a figure meets a different chord the second time it comes round.
 */
const FIGURE_ORDER: readonly number[] = [
  0, 1, 0, 2, 0, 1, 3, 2, 1, 0, 2, 1, 0, 3, 1, 2,
  0, 2, 1, 0, 3, 1, 0, 2, 1, 3, 0, 1, 2, 0, 3, 1,
];

/**
 * The heroic motif, as scale degrees over sixteen steps: the tonic, up to the
 * fifth, down to the third, leaning on the second. Four figures, all of them
 * the same four notes in different rhythms — a motif is recognised by its
 * contour, and a contour survives being re-barred.
 */
const MOTIF: readonly (readonly number[])[] = [
  [0, -1, -1, -1, 4, -1, -1, -1, 2, -1, -1, -1, 1, -1, -1, -1],
  [-1, -1, 0, -1, -1, -1, 4, -1, -1, -1, -1, 2, -1, -1, 1, -1],
  [4, -1, -1, 2, -1, -1, -1, 1, -1, -1, 0, -1, -1, -1, -1, -1],
  [0, -1, 4, -1, -1, 5, -1, 4, -1, -1, 2, -1, -1, 1, -1, -1],
];

/**
 * The brass answer: the motif in augmentation, one note per chord change.
 * Whole notes, because a brass section that plays sixteenths is a synthesiser.
 */
const BRASS_DEGREE: readonly number[] = [0, 4, 2, 1, 0, 4, 5, 4];

/** -1 is a rest. Sixteen steps to the bar; scale degrees over the bar's chord. */
const ARP_FIGURES: readonly (readonly number[])[] = [
  [0, -1, 2, -1, 4, -1, 2, -1, 0, -1, 4, -1, 2, -1, -1, -1],
  [0, -1, -1, 4, -1, 2, -1, -1, 4, -1, -1, 2, -1, 0, -1, -1],
  [4, -1, 2, -1, 0, -1, -1, 2, -1, 4, -1, -1, 2, -1, 0, -1],
  [0, 2, -1, 4, -1, -1, 5, -1, 4, -1, 2, -1, -1, 0, -1, -1],
];

/** Bass: the root, with the fifth and the octave for movement. */
const BASS_FIGURES: readonly (readonly number[])[] = [
  [0, -1, -1, -1, -1, -1, 0, -1, -1, -1, 0, -1, -1, -1, -1, -1],
  [0, -1, 0, -1, -1, -1, 7, -1, 0, -1, -1, -1, 0, -1, -1, -1],
  [0, -1, -1, 0, -1, -1, 0, -1, -1, 12, -1, -1, 0, -1, -1, -1],
  [0, -1, 0, -1, 0, -1, -1, 7, -1, -1, 0, -1, -1, 0, -1, -1],
];

/**
 * The taiko, the frame drum and the toms as sixteen-step masks.
 *
 * The taiko is on the strong beats and nowhere else — one and three, with a
 * single push before the bar line in two of the four figures. It used to run
 * a sixteenth-grid ostinato, which is a drum machine playing a taiko part:
 * loud, constant, and with nothing left for the boss. A big drum is big
 * because of the space around it.
 *
 * There are no sticks or hats anywhere in the score. That material lives at
 * 6 kHz and above, which is exactly where the sword, the sparks and the UI
 * are, and it is the first thing that makes a mix sound noisy.
 */
const TAIKO: readonly (readonly number[])[] = [
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
];
/** The frame drum answers on the backbeat, once a bar, and fills at eight. */
const FRAME: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
const FRAME_FILL: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0];
/** The toms: a half-bar figure, not a gallop. The boss is where they open up. */
const TOMS: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
  [0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0],
];

/* -------------------------------- the score ------------------------------- */

/**
 * Every note of bar `bar` (0-based, taken modulo the loop), at times measured
 * from the start of that bar.
 *
 * Bar by bar rather than the whole loop at once, because the client schedules
 * a bar ahead and has no use for the other thirty-one.
 */
export function barNotes(bar: number, mood: MusicMood): MusicNote[] {
  const { transpose, scale } = moodKey(mood);
  const b = ((bar % LOOP_BARS) + LOOP_BARS) % LOOP_BARS;
  const chordIndex = Math.floor(b / BARS_PER_CHORD) % PROGRESSION.length;
  const chord = PROGRESSION[chordIndex]!;
  /** True on the bar a chord arrives: what the swells and the pads hang off. */
  const onChange = b % BARS_PER_CHORD === 0;
  const fig = FIGURE_ORDER[b]!;
  const step = SEC_PER_BAR / 16;
  const base = TONIC_MIDI + transpose;
  const out: MusicNote[] = [];
  const add = (
    layer: MusicLayer, instrument: MusicInstrument, atStep: number,
    midi: number, lengthSec: number, velocity: number,
  ): void => {
    out.push({ layer, instrument, atSec: atStep * step, midi, lengthSec, velocity });
  };

  // The pedal: four bars long and on the tonic whatever the chord is, which
  // is what makes the III and the VII overhead sound like a departure.
  if (b % 4 === 0) add("drone", "drone", 0, base - 12, SEC_PER_BAR * 4.05, 1);

  // Strings and choir move only when the harmony does, and hold across both
  // bars of it: a pad retriggered every bar is a pulse, not a pad.
  if (onChange) {
    for (let v = 0; v < chord.triad.length; v++) {
      add("pad", "pad", 0, base + 12 + chord.triad[v]!, SEC_PER_BAR * BARS_PER_CHORD + 0.4, v === 0 ? 1 : 0.8);
    }
    // The choir takes the root and the fifth an octave up. Three-part voicing
    // at this register turns to mud once the brass is under it.
    add("choir", "choir", 0, base + 24 + chord.triad[0]!, SEC_PER_BAR * BARS_PER_CHORD + 0.6, 0.9);
    add("choir", "choir", 0, base + 24 + chord.triad[2]!, SEC_PER_BAR * BARS_PER_CHORD + 0.6, 0.7);

    // The brass swell: root, fifth and octave, arriving with the chord and
    // gone before the next one, so every change is a lift rather than a wall.
    const d = BRASS_DEGREE[chordIndex]!;
    add("brass", "brass", 0, base + 12 + chord.root, SEC_PER_BAR * 1.4, 1);
    add("brass", "brass", 0, base + 12 + chord.root + 7, SEC_PER_BAR * 1.3, 0.8);
    // And the motif over it, in augmentation: one note, held.
    add("brass", "brass", 8, base + 24 + degree(scale, d), SEC_PER_BAR * 0.9, 0.75);
  }

  // A bell every four bars: the piece's punctuation, and the one voice the
  // boss silences entirely.
  if (b % 4 === 0) add("bell", "bell", 0, base + 24 + chord.root, SEC_PER_BAR, 0.9);
  if (b % 8 === 5) add("bell", "bell", 8, base + 24 + chord.root + 7, SEC_PER_BAR * 0.5, 0.6);

  const bassFig = BASS_FIGURES[fig]!;
  for (let i = 0; i < 16; i++) {
    const n = bassFig[i]!;
    if (n < 0) continue;
    add("bass", "bass", i, base + chord.root + n, step * 2.4, i === 0 ? 1 : 0.78);
  }

  const arpFig = ARP_FIGURES[fig]!;
  for (let i = 0; i < 16; i++) {
    const d = arpFig[i]!;
    if (d < 0) continue;
    add("arp", "arp", i, base + 24 + chord.root + degree(scale, d), step * 1.8, 0.6 + (i % 4 === 0 ? 0.25 : 0));
  }

  // The motif, on the lead. It is stated on the first bar of each chord and
  // answered on the second, which is why it survives at explore's gain: there
  // is nothing else moving up there.
  const motif = MOTIF[fig]!;
  for (let i = 0; i < 16; i++) {
    const d = motif[i]!;
    if (d < 0) continue;
    add("lead", "lead", i, base + 24 + degree(scale, d), step * 3.6, onChange ? 0.9 : 0.75);
  }

  const fill = b % 8 === 7;
  const taiko = TAIKO[fig]!;
  const frame = fill ? FRAME_FILL : FRAME;
  for (let i = 0; i < 16; i++) {
    if (taiko[i]) add("drums", "taiko", i, base - 24, 0.5, i === 0 ? 1 : 0.8);
    if (frame[i]) add("drums", "frame", i, base - 5, 0.3, fill ? 0.6 : 0.8);
  }
  const toms = TOMS[b % 2]!;
  for (let i = 0; i < 16; i++) {
    if (toms[i]) add("toms", "tom", i, base - 7 + (i % 8 === 0 ? 0 : -4), 0.42, i % 8 === 0 ? 0.9 : 0.72);
  }
  return out;
}

/**
 * The room-clear sting: a triumphant cadence over the piece rather than
 * instead of it.
 *
 * iv · V · i, with the third of the last chord raised — a picardy ending is
 * the oldest way there is of saying *that is over and you won*, and it is the
 * one moment in the score allowed a major tonic. Brass, choir and a bell on
 * the landing, with a taiko under it. Three seconds: a full stop on the
 * fight, not a second piece of music.
 */
export function stingNotes(mood: MusicMood): MusicNote[] {
  const { transpose } = moodKey(mood);
  const base = TONIC_MIDI + transpose;
  const beat = SEC_PER_BEAT;
  const out: MusicNote[] = [];
  const chords: readonly { at: number; root: number; triad: readonly number[]; len: number }[] = [
    { at: 0, root: -7, triad: [-7, -4, 0], len: beat * 1.05 },
    { at: beat, root: -5, triad: [-5, -1, 2], len: beat * 1.05 },
    { at: beat * 2, root: 0, triad: [0, 4, 7], len: beat * 2.6 },
  ];
  for (const c of chords) {
    out.push({ layer: "brass", instrument: "brass", atSec: c.at, midi: base + 12 + c.root, lengthSec: c.len, velocity: 1 });
    out.push({ layer: "brass", instrument: "brass", atSec: c.at, midi: base + 12 + c.triad[2]!, lengthSec: c.len, velocity: 0.8 });
    out.push({ layer: "choir", instrument: "choir", atSec: c.at, midi: base + 24 + c.triad[1]!, lengthSec: c.len, velocity: 0.85 });
    out.push({ layer: "drums", instrument: "taiko", atSec: c.at, midi: base - 24, lengthSec: 0.5, velocity: c.at === 0 ? 0.9 : 1 });
  }
  out.push({ layer: "bell", instrument: "bell", atSec: beat * 2, midi: base + 36, lengthSec: 2.4, velocity: 1 });
  out.push({ layer: "drone", instrument: "drone", atSec: 0, midi: base - 12, lengthSec: 3, velocity: 0.8 });
  return out;
}

/* ------------------------------ instruments ------------------------------- */

function hz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * A stack of saws a few cents apart. Three of them, because two beat and four
 * are indistinguishable from three at twice the cost.
 *
 * Detuning is the entire difference between a synthesiser playing a chord and
 * a section playing one: real players are never in tune with each other, and
 * the slow beating between them is what the ear hears as *many*.
 */
function sawStack(out: Float32Array, f: number, lengthSec: number, gain: number, attack: number, sustain: number): void {
  const spread = [1, 1.0045, 0.9962];
  for (let i = 0; i < spread.length; i++) {
    mixInto(out, tone({
      wave: "saw", from: f * spread[i]!, length: lengthSec, gain: gain * (i === 0 ? 1 : 0.8),
      env: { attack: attack * (1 + i * 0.15), curve: 1.2, sustain },
      vibrato: i === 2 ? { hz: 4.6, cents: 6 } : undefined,
    }), 0);
  }
}

/**
 * One note, rendered.
 *
 * Deterministic in every argument, so the client can cache by
 * `instrument:midi:length` and the harness can sum the same buffers into a
 * wav and know it is listening to the game.
 */
export function renderNote(instrument: MusicInstrument, midi: number, lengthSec: number, velocity = 1): Float32Array {
  const f = hz(midi);
  const r = rng(seedOf(`${instrument}:${midi}:${Math.round(lengthSec * 100)}`));
  const v = velocity;

  switch (instrument) {
    /**
     * The floor of the piece: a saw stack and a sub, under a lowpass that
     * crawls from 180 Hz to 520 across the whole note. The filter motion is
     * what stops a four-bar pedal being a held chord nobody listens to.
     */
    case "drone": {
      const out = buffer(lengthSec);
      sawStack(out, f, lengthSec, 0.26 * v, 0.9, 0.85);
      mixInto(out, tone({ from: f / 2, length: lengthSec, gain: 0.4 * v, env: { attack: 0.6, curve: 1, sustain: 0.8 } }), 0);
      return normalisePeak(sweepLowpass(out, 180, 520, 0.9), 0.5 * v);
    }

    /** The strings: the same stack, opened up and breathing. */
    case "pad": {
      const out = buffer(lengthSec);
      sawStack(out, f, lengthSec, 0.24 * v, 0.55, 0.7);
      mixInto(out, tone({ wave: "triangle", from: f * 2, length: lengthSec * 0.8, gain: 0.06 * v, env: { attack: 0.7, curve: 1.4, sustain: 0.5 } }), 0);
      return normalisePeak(lowpass(out, 1700, 0.7), 0.4 * v);
    }

    /**
     * The choir: a string stack run through two fixed formant bands with a
     * breath of noise over them.
     *
     * The bands are absolute — around 620 Hz and 1180, an "ah" — and they do
     * *not* move with the note, which is the whole reason it reads as a voice
     * rather than as a filtered saw. A slow, deep vibrato on the way in keeps
     * a section of them from sounding like one singer.
     */
    case "choir": {
      const raw = buffer(lengthSec);
      sawStack(raw, f, lengthSec, 0.3 * v, 0.7, 0.75);
      const out = buffer(lengthSec);
      mixInto(out, bandpass(raw.slice(), 620, 4.5), 0, 1);
      mixInto(out, bandpass(raw.slice(), 1180, 5.5), 0, 0.7);
      mixInto(out, lowpass(raw, 420, 0.8), 0, 0.35);
      // Breath: without it the vowel is a formant filter and nothing else.
      mixInto(out, bandpass(noiseBurst(lengthSec, r, 0.1 * v, { attack: 0.8, curve: 1.2, sustain: 0.6 }), 2400, 1.2), 0);
      return normalisePeak(out, 0.34 * v);
    }

    /** The punctuation: an FM bell with a soft mallet on the front. */
    case "bell": {
      const out = buffer(lengthSec);
      mixInto(out, tone({ from: f, length: lengthSec, gain: 0.5 * v, fm: { ratio: 3.01, index: 2.6, decay: 2.4 }, env: { attack: 0.004, curve: 2.2 } }), 0);
      mixInto(out, tone({ from: f * 2, length: lengthSec * 0.55, gain: 0.14 * v, fm: { ratio: 2.01, index: 1.1, decay: 3 }, env: { attack: 0.002, curve: 3 } }), 0);
      return normalisePeak(lowpass(tail(out, 0.08, 0.3, 0.22, 3200), 3800, 0.8), 0.42 * v);
    }

    /** The bass: a saw and a sub, with a pitch drop on the front for attack. */
    case "bass": {
      const out = buffer(lengthSec);
      mixInto(out, tone({ wave: "saw", from: f * 1.7, to: f, length: Math.min(0.05, lengthSec), gain: 0.45 * v, env: { attack: 0.002, curve: 2 } }), 0);
      mixInto(out, tone({ wave: "saw", from: f, length: lengthSec, gain: 0.4 * v, env: { attack: 0.008, curve: 2, sustain: 0.3 } }), 0);
      mixInto(out, tone({ from: f / 2, length: lengthSec, gain: 0.45 * v, env: { attack: 0.004, curve: 2.2, sustain: 0.28 } }), 0);
      return normalisePeak(lowpass(out, 1100, 0.9), 0.62 * v);
    }

    /** The arpeggio: a thin pulse, the one voice allowed to be plainly chip. */
    case "arp": {
      const out = buffer(lengthSec);
      mixInto(out, tone({ wave: "pulse", width: 0.22, from: f, length: lengthSec, gain: 0.4 * v, env: { attack: 0.004, curve: 2.6 } }), 0);
      mixInto(out, tone({ wave: "triangle", from: f * 2, length: lengthSec * 0.5, gain: 0.1 * v, env: { attack: 0.003, curve: 3 } }), 0);
      return normalisePeak(lowpass(out, 3000, 0.8), 0.26 * v);
    }

    /** The motif's voice: a bowed-sounding saw and triangle pair with a tail. */
    case "lead": {
      const out = buffer(lengthSec + 0.3);
      mixInto(out, tone({ wave: "saw", from: f, length: lengthSec, gain: 0.3 * v, env: { attack: 0.06, curve: 1.6, sustain: 0.35 }, vibrato: { hz: 5, cents: 16 } }), 0);
      mixInto(out, tone({ wave: "triangle", from: f, length: lengthSec, gain: 0.34 * v, env: { attack: 0.04, curve: 1.8, sustain: 0.3 }, vibrato: { hz: 5.4, cents: 12 } }), 0);
      return normalisePeak(tail(lowpass(out, 3000, 0.8), 0.1, 0.3, 0.22, 3000), 0.42 * v);
    }

    /**
     * Brass: a saw stack under a filter that opens across the note.
     *
     * The filter envelope is the instrument. A section crescendoing does not
     * get louder evenly — it gets *brighter*, because the harmonics come up
     * faster than the fundamental, and a lowpass climbing from one times the
     * fundamental to eight is the cheapest honest model of that there is.
     */
    case "brass": {
      const out = buffer(lengthSec + 0.2);
      sawStack(out, f, lengthSec, 0.3 * v, 0.14, 0.7);
      mixInto(out, tone({ wave: "pulse", width: 0.42, from: f, length: lengthSec, gain: 0.12 * v, env: { attack: 0.2, curve: 1.4, sustain: 0.5 } }), 0);
      sweepLowpass(out, Math.max(160, f * 1.1), Math.min(2600, f * 6), 1.1);
      return normalisePeak(saturate(out, 1.4), 0.46 * v);
    }

    /**
     * The taiko: a sine falling an octave and a half in the first fifty
     * milliseconds, with the slap of the stick on the head over it.
     *
     * The drop is what gives it size. A drum with a steady pitch is a tom; a
     * drum whose pitch collapses is a much larger drum, and the ear reads the
     * rate of that collapse as the diameter of the skin.
     */
    case "taiko": {
      const out = buffer(lengthSec);
      mixInto(out, lowpass(tone({ from: f * 3.2, to: f * 0.92, length: lengthSec, gain: 1 * v, env: { attack: 0.001, curve: 2.2 } }), 220), 0);
      mixInto(out, lowpass(tone({ from: f * 1.6, to: f * 0.8, length: lengthSec * 0.5, gain: 0.3 * v, env: { attack: 0.001, curve: 3 } }), 600), 0);
      mixInto(out, lowpass(noiseBurst(0.02, r, 0.4 * v, { attack: 0, curve: 6 }), 2600), 0);
      return normalisePeak(saturate(out, 1.35), 0.8 * v);
    }

    /** The frame drum: a wide band of skin with a short pitch under it. */
    case "frame": {
      const out = buffer(lengthSec);
      mixInto(out, bandpass(noiseBurst(lengthSec, r, 0.7 * v, { attack: 0, curve: 3.4 }), 700, 0.7), 0);
      mixInto(out, tone({ from: f * 1.5, to: f * 0.8, length: lengthSec * 0.4, gain: 0.5 * v, env: { attack: 0, curve: 3 } }), 0);
      mixInto(out, bandpass(noiseBurst(0.02, r, 0.22 * v, { attack: 0, curve: 7 }), 2200, 1.2), 0);
      return normalisePeak(lowpass(highpass(out, 180), 2600, 0.8), 0.6 * v);
    }

    /** Floor toms: the ostinato, and the gallop under the boss. */
    case "tom": {
      const out = buffer(lengthSec);
      mixInto(out, tone({ from: f * 1.15, to: f * 0.6, length: lengthSec, gain: 0.85 * v, env: { attack: 0.001, curve: 2.2 } }), 0);
      mixInto(out, bandpass(noiseBurst(0.05, r, 0.24 * v, { attack: 0, curve: 5 }), 800, 1.2), 0);
      return normalisePeak(lowpass(out, 1000, 0.9), 0.6 * v);
    }
  }
}

/* ------------------------------- the mixdown ------------------------------ */

/**
 * Renders `seconds` of one state, for listening to and for measuring.
 *
 * Exactly what the client plays: the same notes, the same instruments, the
 * same per-layer gains, and a tail standing in for the client's convolver —
 * both are a diffuse decay of around two seconds, and the point of the
 * mixdown is to be the thing that gets judged. The only thing it does not
 * model is the crossfade, which is a gain ramp over a state change and has no
 * state of its own.
 */
export function renderMusic(state: MusicState, seconds: number, mood: MusicMood = "cold"): Float32Array {
  const out = buffer(seconds + 4);
  const gains = LAYER_GAIN[state];
  const cache = new Map<string, Float32Array>();
  const bars = Math.ceil(seconds / SEC_PER_BAR);
  for (let bar = 0; bar < bars; bar++) {
    for (const n of barNotes(bar, mood)) {
      const g = gains[n.layer];
      if (g <= 0) continue;
      const key = `${n.instrument}:${n.midi}:${Math.round(n.lengthSec * 100)}:${Math.round(n.velocity * 20)}`;
      let buf = cache.get(key);
      if (!buf) {
        buf = renderNote(n.instrument, n.midi, n.lengthSec, n.velocity);
        cache.set(key, buf);
      }
      mixInto(out, buf, bar * SEC_PER_BAR + n.atSec, g * MUSIC_TRIM);
    }
  }
  tail(out, HALL_SEC, HALL_FEEDBACK, HALL_MIX, HALL_DAMP_HZ);
  const cut = out.slice(0, Math.round(seconds * SAMPLE_RATE));
  // Saturation rather than a limiter: the layers are summed at fixed gains,
  // so the peak is known in advance and all this has to do is round it off.
  saturate(cut, 1.05);
  return cut;
}

/**
 * The headroom the per-layer gains are summed into.
 *
 * Halved from where this started, which is the -6 dB the music was asked to
 * come down by: it is a score under a game, and the moment a player has to
 * turn the music slider down to hear a telegraph, the adaptive mix has
 * failed. The client's own output gain carries the same figure, so the
 * mixdown measured here is the one that plays.
 */
export const MUSIC_TRIM = 0.2;

/**
 * The hall. These four numbers are shared with the client, which builds an
 * impulse response of the same length and decay for its convolver: a large
 * stone room, two seconds, with the top taken off it because stone is not a
 * mirror.
 */
export const HALL_SEC = 0.13;
export const HALL_FEEDBACK = 0.46;
export const HALL_MIX = 0.3;
export const HALL_DAMP_HZ = 2400;
/** How long the client's impulse response runs, in seconds. */
export const HALL_TAIL_SEC = 2.1;

/**
 * The sting, rendered on its own, for the same two purposes.
 *
 * Summed at the gain the client's sting bus and output gain multiply out to,
 * so this is the flourish at the level it is actually heard: over the piece
 * by a few decibels, and well under the room-clear effect, which is the sound
 * that is meant to land.
 */
export const STING_BUS_GAIN = 0.88;

export function renderSting(mood: MusicMood = "cold"): Float32Array {
  const out = buffer(5);
  for (const n of stingNotes(mood)) {
    mixInto(out, renderNote(n.instrument, n.midi, n.lengthSec, n.velocity), n.atSec, STING_BUS_GAIN * MUSIC_TRIM);
  }
  tail(out, HALL_SEC, HALL_FEEDBACK, HALL_MIX, HALL_DAMP_HZ);
  saturate(out, 1.05);
  return out;
}

/** The loudest sample in one loop of a state: the headroom check, in one call. */
export function musicPeak(state: MusicState, mood: MusicMood = "cold"): number {
  return peak(renderMusic(state, Math.min(LOOP_SEC, 24), mood));
}
