/**
 * The music player: a WebAudio sequencer over the score in `@jr/core/audio`.
 *
 * It owns three things and nothing else.
 *
 * - **A transport that never restarts.** One bar counter runs from the first
 *   note to the last. Walking into a fight does not start a fight track; it
 *   raises the gain on the drums and the bass of the bar already playing.
 *   That is the whole adaptive design, and it only works because the clock is
 *   shared.
 * - **A lookahead scheduler.** Notes are handed to WebAudio a bar ahead on a
 *   plain interval, not on the render loop: a frame that takes 40 ms would
 *   otherwise be a note that arrives late, and a late note is worse than a
 *   dropped frame because the ear is the better clock.
 * - **A note cache.** Each note is rendered once, by core, into an
 *   `AudioBuffer` at core's sample rate — the browser resamples on playback —
 *   and reused for every later occurrence of that pitch and length.
 * - **One hall.** A convolver on a send bus, over an impulse response built
 *   here out of shaped noise. It is the one thing in the audio path that is
 *   not shared with core — core approximates it with a feedback tail — and it
 *   costs one node for the whole piece however many voices are running.
 */
import {
  HALL_TAIL_SEC, LAYER_GAIN, MUSIC_TRIM, STING_BUS_GAIN, LOOP_BARS, MUSIC_LAYERS, SAMPLE_RATE, SEC_PER_BAR,
  barNotes, renderNote, stingNotes,
  type MusicLayer, type MusicMood, type MusicNote, type MusicState,
} from "@jr/core";

/** How long a state change takes. Long enough to be a fade, short enough to be an answer. */
const CROSSFADE_S = 1.8;

/**
 * How much of each layer goes to the hall.
 *
 * Not one number for the whole piece: reverb on a pad is the room the choir
 * is standing in, and the same reverb on a taiko is a taiko played in a
 * corridor — the transient smears and the groove goes with it. Percussion
 * gets a fraction of what the sustained voices get, and the bass gets almost
 * none, because low frequencies in a long tail are the fastest way to turn a
 * mix to mud.
 */
const SEND: Readonly<Record<MusicLayer, number>> = {
  drone: 0.3, pad: 0.55, choir: 0.7, bell: 0.6, bass: 0.05,
  arp: 0.35, lead: 0.5, brass: 0.45, drums: 0.12, toms: 0.18,
};

/** How long the music takes to come back up after an effect ducked it. */
const DUCK_RECOVER_S = 0.75;

/** How loud the hall's return is against the dry signal. */
const WET_GAIN = 0.34;
/** How far ahead notes are handed to WebAudio, and how often that is done. */
const LOOKAHEAD_S = SEC_PER_BAR;
const TICK_MS = 250;

export class Music {
  private readonly layerGain = new Map<MusicLayer, GainNode>();
  private readonly cache = new Map<string, AudioBuffer>();
  private readonly out: GainNode;
  /** The one reverb in the piece; every bus sends to it. */
  private readonly hall: ConvolverNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The next bar that has not been scheduled yet, and when it starts. */
  private nextBar = 0;
  private nextBarAt = 0;
  /** Built on the first sting, since most runs of the piece never need one. */
  private stingBus: GainNode | null = null;
  private state: MusicState = "title";
  private mood: MusicMood = "cold";
  private started = false;
  /** When the current duck finishes, so bursts do not re-trigger it endlessly. */
  private duckedUntil = 0;

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {
    this.out = ctx.createGain();
    // The same headroom the offline mixdown is summed at, so what is measured
    // in `pnpm audio:check` is what comes out of the speakers. It is *not* the
    // player's music volume, which is a separate gain further down the chain
    // and still defaults to a half.
    this.out.gain.value = MUSIC_TRIM;
    this.out.connect(destination);

    // The hall: one convolver, one return, built once. Every layer feeds it
    // through a fixed send, so the node count does not grow with the music.
    const hall = ctx.createConvolver();
    hall.buffer = impulse(ctx);
    this.hall = hall;
    const wet = ctx.createGain();
    wet.gain.value = WET_GAIN;
    hall.connect(wet);
    wet.connect(this.out);

    for (const layer of MUSIC_LAYERS) {
      const g = ctx.createGain();
      // Silent at birth and ramped up by the first `setState`, so the piece
      // fades in rather than arriving whole on the first bar.
      g.gain.value = 0;
      g.connect(this.out);
      const send = ctx.createGain();
      send.gain.value = SEND[layer];
      g.connect(send);
      send.connect(hall);
      this.layerGain.set(layer, g);
    }
  }

  /** The node every music voice passes through, for the volume control above. */
  get output(): GainNode {
    return this.out;
  }

  /**
   * Starts the transport. Safe to call more than once; the second call does
   * nothing, which is what lets it sit on "the first key the player presses"
   * without anyone having to remember whether that already happened.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.nextBar = 0;
    this.nextBarAt = this.ctx.currentTime + 0.15;
    this.applyState(0.6);
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    for (const g of this.layerGain.values()) g.gain.cancelScheduledValues(this.ctx.currentTime);
    for (const g of this.layerGain.values()) g.gain.setValueAtTime(0, this.ctx.currentTime);
  }

  isRunning(): boolean {
    return this.started;
  }

  /**
   * Which state the piece is in, and which key the room is in.
   *
   * A mood change takes effect at the next scheduled bar rather than at once,
   * because the bars already handed to WebAudio cannot be recalled — and a
   * key change that lands mid-bar sounds like a mistake rather than a room.
   */
  setState(state: MusicState, mood: MusicMood = this.mood): void {
    if (state === this.state && mood === this.mood) return;
    this.state = state;
    this.mood = mood;
    if (this.started) this.applyState(CROSSFADE_S);
  }

  currentState(): MusicState {
    return this.state;
  }

  /**
   * The room-clear flourish, over whatever is playing.
   *
   * On its own bus rather than on the layer buses its notes belong to: the
   * bell layer is silent in a boss room and near silent in a fight, and the
   * one moment the player has certainly earned a bell is the moment the fight
   * ends.
   */
  sting(): void {
    if (!this.started) return;
    if (!this.stingBus) {
      this.stingBus = this.ctx.createGain();
      this.stingBus.gain.value = STING_BUS_GAIN;
      this.stingBus.connect(this.out);
      // The cadence gets the most hall of anything in the piece: it is the
      // one moment the room is supposed to be heard answering.
      const send = this.ctx.createGain();
      send.gain.value = 0.8;
      this.stingBus.connect(send);
      send.connect(this.hall);
    }
    const at = this.ctx.currentTime + 0.02;
    for (const n of stingNotes(this.mood)) this.emit(n, at + n.atSec, this.stingBus);
  }

  /**
   * Steps the music aside for a moment, for a burst of effects.
   *
   * Not a compressor: a compressor needs the effects and the music on one bus
   * and a detector reading it, and the effects here are played by Phaser on
   * its own graph. This is the same idea done from the other end — the thing
   * making the noise says so — and it costs one scheduled ramp.
   *
   * The recovery is deliberately slower than the dip. A duck that comes back
   * as fast as it left is heard as a pump on every sword swing; one that
   * takes most of a second to return is heard as the music leaving room.
   */
  duck(depth = 0.45): void {
    const now = this.ctx.currentTime;
    if (now < this.duckedUntil - 0.28) return;
    this.duckedUntil = now + DUCK_RECOVER_S;
    const floor = MUSIC_TRIM * (1 - Math.max(0, Math.min(0.8, depth)));
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(floor, now + 0.05);
    g.linearRampToValueAtTime(MUSIC_TRIM, now + DUCK_RECOVER_S);
  }

  private applyState(seconds: number): void {
    const now = this.ctx.currentTime;
    const gains = LAYER_GAIN[this.state];
    for (const layer of MUSIC_LAYERS) {
      const g = this.layerGain.get(layer)!;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(gains[layer], now + seconds);
    }
  }

  /**
   * Hands WebAudio every bar that starts inside the lookahead window.
   *
   * Bars are scheduled whole. A bar is under three seconds at this tempo, so
   * the cost of one pass is a few dozen `start()` calls a second apart, and
   * the alternative — scheduling note by note — would put the interval's own
   * jitter into the groove.
   */
  private tick(): void {
    if (!this.started) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD_S;
    // If the tab was suspended the clock has run on without us; catch the
    // transport up rather than scheduling a burst of bars into the past.
    if (this.nextBarAt < this.ctx.currentTime - SEC_PER_BAR) {
      this.nextBarAt = this.ctx.currentTime + 0.05;
    }
    let guard = 0;
    while (this.nextBarAt < horizon && guard++ < 8) {
      for (const n of barNotes(this.nextBar, this.mood)) {
        // A silent layer still costs a buffer and a node, and nothing about
        // the piece depends on a muted layer having been played: the
        // transport is the bar counter rather than any note in it.
        if (LAYER_GAIN[this.state][n.layer] <= 0) continue;
        const bus = this.layerGain.get(n.layer);
        if (bus) this.emit(n, this.nextBarAt + n.atSec, bus);
      }
      this.nextBar = (this.nextBar + 1) % LOOP_BARS;
      this.nextBarAt += SEC_PER_BAR;
    }
  }

  private emit(note: MusicNote, atSec: number, destination: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer(note);
    src.connect(destination);
    // A finished source is not collected while it is still connected, and a
    // boss bar is about forty of them: without this the graph grows for as
    // long as the game runs.
    src.onended = () => { src.disconnect(); };
    src.start(Math.max(this.ctx.currentTime, atSec));
  }

  private buffer(note: MusicNote): AudioBuffer {
    const key = `${note.instrument}:${note.midi}:${Math.round(note.lengthSec * 100)}:${Math.round(note.velocity * 20)}`;
    const held = this.cache.get(key);
    if (held) return held;
    const samples = renderNote(note.instrument, note.midi, note.lengthSec, note.velocity);
    const buf = this.ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    // `set` rather than `copyToChannel`: core's buffers are plain typed
    // arrays and the channel copy insists on one backed by an `ArrayBuffer`.
    buf.getChannelData(0).set(samples);
    this.cache.set(key, buf);
    return buf;
  }
}

/**
 * The hall's impulse response, built rather than shipped.
 *
 * Two seconds of noise under an exponential decay, with the first eighty
 * milliseconds thinned out into discrete early reflections — a diffuse tail
 * with no early reflections is a plate, and a plate is not a dungeon. The two
 * channels are decorrelated, which is where the width comes from, and the
 * noise is progressively lowpassed by a one-pole whose coefficient falls with
 * time, because stone absorbs the top of a sound faster than the bottom.
 */
function impulse(ctx: AudioContext): AudioBuffer {
  const rate = ctx.sampleRate || 44100;
  const n = Math.round(HALL_TAIL_SEC * rate);
  const buf = ctx.createBuffer(2, n, rate);
  // A fixed seed: the room must be the same room on every load, or two
  // players comparing notes are not talking about the same mix.
  let seed = 0x9e3779b9;
  const noise = (): number => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return (seed / 0x100000000) * 2 - 1;
  };
  const early = [0.011, 0.019, 0.027, 0.038, 0.049, 0.063, 0.078];
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // The build-up over the first 25 ms is what stops the tail arriving as
      // a click on top of every transient sent to it.
      const rise = Math.min(1, i / (rate * 0.025));
      const decay = Math.pow(1 - t, 2.6);
      const damp = 0.5 - 0.42 * t;
      lp += damp * (noise() - lp);
      data[i] = lp * rise * decay * 0.55;
    }
    for (let k = 0; k < early.length; k++) {
      const at = Math.round((early[k]! + c * 0.0037) * rate);
      if (at < n) data[at] = (data[at] ?? 0) + (k % 2 === 0 ? 0.5 : -0.42) * Math.pow(0.82, k);
    }
  }
  return buf;
}
