/**
 * The music: two pieces of looping stems, remixed live.
 *
 * - **Stems, not a sequencer.** Each piece is rendered offline in its style —
 *   8-bit (2A03 + VRC6) or 16-bit (S-DSP samples and echo) — as five layers
 *   that loop seamlessly and sum back to the full mix: lead, harm, pad, bass,
 *   drums, and the boss splits its drums into kick and kit and adds `rage`.
 *   Every layer of a piece starts on the same sample and loops on its own
 *   buffer, so they never drift.
 * - **A state is a set of layer gains.** Walking into a fight does not start
 *   a fight track; it raises the drums and the bass of the bar already
 *   playing. The boss room has its own piece, and its three phases differ in
 *   what plays, not only how loud: phase one is the riff, the bass, the kick
 *   and the organ; phase two brings the kit and the harmony; phase three the
 *   rage layer, the fastest thing in either piece.
 * - **The room's mood is a remix.** Temperature moves weight between the
 *   theme and the organ/choir, brightness puts a lowpass over the melodic
 *   layers, particle intensity scales the drums. No extra files: the same
 *   stems, differently balanced, per room.
 * - **Nothing restarts.** Both styles are the same score at the same length,
 *   so switching style picks the new stems up at the bar the old ones had
 *   reached — the old style keeps playing until the new one has downloaded,
 *   then the two cross over in time. Leaving a piece remembers where it was:
 *   back from the boss room, the room theme carries on from there.
 * - **Loaded when chosen.** A style's stems are fetched the first time it is
 *   selected, not at boot, so a player who never turns sound on downloads
 *   none of them.
 */
import type { Mood, MusicState } from "@jr/core";

export type MusicStyle = "8bit" | "16bit";
export type Layer = "lead" | "harm" | "pad" | "bass" | "drums" | "kick" | "kit" | "rage" | "counter" | "perc" | "harm2" | "drums2";
type Piece = "room" | "boss";
const LAYERS: Readonly<Record<Piece, readonly Layer[]>> = {
  room: ["lead", "harm", "pad", "bass", "drums", "counter", "perc", "harm2", "drums2"],
  boss: ["lead", "harm", "pad", "bass", "kick", "kit", "rage"],
};
type Gains = Readonly<Partial<Record<Layer, number>>>;

/** The room piece's states. The two styles were balanced separately, so their tables differ slightly. */
const ROOM: Readonly<Record<MusicStyle, Readonly<Record<Exclude<MusicState, "boss">, Gains>>>> = {
  "8bit": {
    title: { lead: 0.75, harm: 0.6, pad: 0.8, bass: 0.5, drums: 0, perc: 0 },
    explore: { lead: 0.9, harm: 0.8, pad: 0.7, bass: 0.85, drums: 0.35, perc: 0 },
    fight: { lead: 1, harm: 1, pad: 1, bass: 1, drums: 1, perc: 1 },
  },
  "16bit": {
    title: { lead: 0.75, harm: 0.65, pad: 0.9, bass: 0.5, drums: 0, perc: 0 },
    explore: { lead: 0.9, harm: 0.85, pad: 0.8, bass: 0.85, drums: 0.3, perc: 0 },
    fight: { lead: 1, harm: 1, pad: 1, bass: 1, drums: 1, perc: 1 },
  },
};

/** The boss piece, by phase: the same table for both styles, since both were arranged to it. */
const BOSS: readonly [Gains, Gains, Gains] = [
  { lead: 0.8, harm: 0, pad: 1, bass: 0.8, kick: 0.85, kit: 0, rage: 0 },
  { lead: 1, harm: 1, pad: 0.8, bass: 0.9, kick: 1, kit: 1, rage: 0 },
  { lead: 1, harm: 1, pad: 0.8, bass: 1, kick: 1, kit: 1, rage: 1 },
];

/**
 * The mood remix: multipliers on the state's gains, and a lowpass for a dim
 * room. Cold leans on the organ and choir, warm on the theme; a dim room is
 * heard through stone; a calm one lets the drums back off.
 */
const MOOD_GAIN: Readonly<Record<string, Partial<Record<Layer, number>>>> = {
  cold: { lead: 0.9, pad: 1.35 },
  warm: { lead: 1.12, harm: 1.1, pad: 0.6 },
  dim: {},
  bright: { lead: 1.05 },
  calm: { drums: 0.45, harm: 0.85 },
  busy: { drums: 1.1, harm: 1.1 },
};
const DIM_CUTOFF: Partial<Record<Layer, number>> = { lead: 2800, harm: 2800, harm2: 2800, counter: 2800, pad: 2800, rage: 2800, drums: 5000, drums2: 5000, kit: 5000, perc: 5000 };
const OPEN = 20000;

/** How long a state change takes, and how long the room and the boss pieces take to trade places. */
const RAMP_S = 1.2;
const PIECE_FADE_S = 1.6;
/** How long the music takes to come back up after an effect ducked it. */
const DUCK_RECOVER_S = 0.75;
/** Headroom: the stems are mastered hot, and this bus sits under the effects. */
const TRIM = 0.42;
/** How long a fight runs before the counter-melody joins, and how long it takes to arrive. */
const COUNTER_AFTER_S = 18;
const COUNTER_FADE_S = 4;

/**
 * The layers with a B version, swapped at the top of each pass so a 51 s
 * loop is not heard the same way twice in a row: which variant of each is
 * sounding decides where that layer's gain goes.
 */
type Variant = { harm: "harm" | "harm2"; drums: "drums" | "drums2" };

interface Channel { src: AudioBufferSourceNode; lp: BiquadFilterNode; g: GainNode }
/** One piece sounding: its layers, and when its loop's first sample was (or would have been) played. */
interface Playing { piece: Piece; out: GainNode; ch: Partial<Record<Layer, Channel>>; t0: number; loopLen: number }

export class StemMusic {
  private readonly out: GainNode;
  private readonly cache = new Map<string, Promise<Partial<Record<Layer, AudioBuffer>>>>();
  private style: MusicStyle | null = null;
  private playing: Playing | null = null;
  private state: MusicState = "title";
  private mood: Mood | null = null;
  private bossPhase = 1;
  private duckedUntil = 0;
  /** Where each piece was when it was last faded out, in seconds into its loop. */
  private readonly resumeAt = new Map<Piece, number>();
  private reseating = false;
  private variant: Variant = { harm: "harm", drums: "drums" };
  /** The loop boundary the next variant has already been scheduled for. */
  private variantAt = 0;
  /** When the current fight began, on the audio clock, for the counter-melody. */
  private fightSince = Infinity;
  private counterOn = false;
  /**
   * The boss fight's beat clock as the sim last reported it, and when on the
   * audio clock that report came in. The boss piece is played to it: started
   * at its position, and re-seated if it drifts (doc 020).
   */
  private bossClock: { sec: number; at: number } | null = null;
  /** Bumped by every style change, so a slow download cannot start a style that was since switched away from. */
  private epoch = 0;

  constructor(private readonly ctx: AudioContext, destination: AudioNode, private readonly base = "") {
    this.out = ctx.createGain();
    this.out.gain.value = TRIM;
    this.out.connect(destination);
    setInterval(() => this.tick(), 250);
  }

  /**
   * The slow clock: the counter-melody arriving in a long fight, and the
   * variant swap scheduled a moment before each pass begins.
   */
  private tick(): void {
    const now = this.ctx.currentTime;
    this.holdBossOnClock(now);
    const counter = this.state === "fight" && now - this.fightSince > COUNTER_AFTER_S;
    if (counter !== this.counterOn) { this.counterOn = counter; this.apply(COUNTER_FADE_S); }
    const p = this.playing;
    if (!p || p.piece !== "room") return;
    const next = p.t0 + Math.ceil((now - p.t0 + 0.001) / p.loopLen) * p.loopLen;
    if (next === this.variantAt || next - now > 1) return;
    this.variantAt = next;
    const pick: Variant = { harm: Math.random() < 0.5 ? "harm" : "harm2", drums: Math.random() < 0.5 ? "drums" : "drums2" };
    const gains = this.gains(pick);
    for (const layer of ["harm", "harm2", "drums", "drums2"] as const) {
      const g = p.ch[layer]?.g.gain;
      if (!g) continue;
      // The swap lands on the loop's first sample, with a 12 ms edge either side so it does not click.
      g.setValueAtTime(g.value, Math.max(now, next - 0.012));
      g.linearRampToValueAtTime(gains[layer] ?? 0, next + 0.012);
    }
    setTimeout(() => { this.variant = pick; }, Math.max(0, (next - now) * 1000));
  }

  /**
   * Which style plays, or none. A change keeps the old stems going until the
   * new ones are ready, then crosses over at the same place in the loop.
   */
  setStyle(style: MusicStyle | null): void {
    if (style === this.style) return;
    this.style = style;
    const epoch = ++this.epoch;
    if (!style) {
      if (this.playing) this.resumeAt.set(this.playing.piece, this.position(this.playing));
      this.fadeOut(this.playing, PIECE_FADE_S * 0.5);
      this.playing = null;
      return;
    }
    void this.startPiece(this.pieceFor(this.state), epoch, "align");
  }

  /** What the game is doing. Free to call every frame: an unchanged state costs nothing. */
  setState(state: MusicState, mood: Mood | null, bossPhase = 1, bossClockMs?: number): void {
    if (bossClockMs !== undefined) this.bossClock = { sec: bossClockMs / 1000, at: this.ctx.currentTime };
    const moodKey = (m: Mood | null): string => (m ? `${m.temperature}/${m.brightness}/${m.particle_intensity}` : "");
    if (state === this.state && moodKey(mood) === moodKey(this.mood) && bossPhase === this.bossPhase) return;
    const pieceChanged = this.pieceFor(state) !== this.pieceFor(this.state);
    if (state === "fight" && this.state !== "fight") this.fightSince = this.ctx.currentTime;
    if (state !== "fight") { this.fightSince = Infinity; this.counterOn = false; }
    this.state = state; this.mood = mood; this.bossPhase = bossPhase;
    if (!this.style) return;
    if (pieceChanged) {
      const epoch = this.epoch;
      if (this.playing) this.resumeAt.set(this.playing.piece, this.position(this.playing));
      this.fadeOut(this.playing, PIECE_FADE_S);
      this.playing = null;
      void this.startPiece(this.pieceFor(state), epoch, this.resumeAt.get(this.pieceFor(state)) ?? 0);
    } else {
      this.apply(RAMP_S);
    }
  }

  /** Steps the music aside for a moment. The recovery is slower than the dip, so it is heard as room being made, not as a pump. */
  duck(depth: number): void {
    const now = this.ctx.currentTime;
    if (now < this.duckedUntil - 0.28) return;
    this.duckedUntil = now + DUCK_RECOVER_S;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(TRIM * (1 - Math.max(0, Math.min(0.8, depth))), now + 0.05);
    g.linearRampToValueAtTime(TRIM, now + DUCK_RECOVER_S);
  }

  /** Where the boss piece should be, at audio time `at`: the fight's beat clock, run on from its last report. */
  private bossPosition(loopLen: number, at = this.ctx.currentTime): number | null {
    const c = this.bossClock;
    if (!c || at - c.at > 0.5) return null;
    return (((c.sec + (at - c.at)) % loopLen) + loopLen) % loopLen;
  }

  /**
   * The fight moves on its beat clock and the music on the audio clock; they
   * agree unless the page dropped frames or the tab slept. Past 60 ms apart,
   * the music is re-seated at the fight's position with a short crossfade.
   */
  private holdBossOnClock(now: number): void {
    const p = this.playing;
    if (!p || p.piece !== "boss" || this.reseating) return;
    const want = this.bossPosition(p.loopLen, now);
    if (want === null) return;
    let diff = this.position(p, now) - want;
    diff -= Math.round(diff / p.loopLen) * p.loopLen;
    if (Math.abs(diff) <= 0.06) return;
    this.reseating = true;
    void this.startPiece("boss", this.epoch, "clock").finally(() => { this.reseating = false; });
  }

  /** Seconds into the loop a playing piece is at. */
  private position(p: Playing, at = this.ctx.currentTime): number {
    return (((at - p.t0) % p.loopLen) + p.loopLen) % p.loopLen;
  }

  private pieceFor(state: MusicState): Piece {
    return state === "boss" ? "boss" : "room";
  }

  private gains(variant: Variant = this.variant): Gains {
    const style = this.style ?? "8bit";
    if (this.state === "boss") return this.moodOn(BOSS[Math.max(0, Math.min(2, this.bossPhase - 1))]!);
    const base: Partial<Record<Layer, number>> = { ...ROOM[style][this.state] };
    // The B versions take the A version's gain when they are the one sounding.
    for (const [a, b] of [["harm", "harm2"], ["drums", "drums2"]] as const) {
      const g = base[a] ?? 0;
      base[a] = variant[a] === a ? g : 0;
      base[b] = variant[a] === b ? g : 0;
    }
    base.counter = this.counterOn ? 1 : 0;
    return this.moodOn(base);
  }

  private moodOn(base: Gains): Gains {
    if (!this.mood || this.state === "title") return base;
    const out: Partial<Record<Layer, number>> = { ...base };
    for (const key of [this.mood.temperature, this.mood.brightness, this.mood.particle_intensity]) {
      for (const [layer, k] of Object.entries(MOOD_GAIN[key] ?? {}) as [Layer, number][]) {
        // Every drum layer and every harmony variant moves with its family.
        const family: readonly Layer[] = layer === "drums" ? ["drums", "drums2", "kick", "kit", "perc"] : layer === "harm" ? ["harm", "harm2"] : layer === "lead" ? ["lead", "counter"] : [layer];
        for (const l of family) if (out[l] !== undefined) out[l] = out[l]! * k;
      }
    }
    return out;
  }

  private apply(seconds: number): void {
    const p = this.playing;
    if (!p) return;
    const now = this.ctx.currentTime;
    const gains = this.gains();
    const dim = this.mood?.brightness === "dim" && this.state !== "title";
    for (const layer of LAYERS[p.piece]) {
      const c = p.ch[layer];
      if (!c) continue;
      c.g.gain.cancelScheduledValues(now);
      c.g.gain.setValueAtTime(c.g.gain.value, now);
      c.g.gain.linearRampToValueAtTime(gains[layer] ?? 0, now + seconds);
      c.lp.frequency.cancelScheduledValues(now);
      c.lp.frequency.setValueAtTime(c.lp.frequency.value, now);
      c.lp.frequency.exponentialRampToValueAtTime(dim ? DIM_CUTOFF[layer] ?? OPEN : OPEN, now + seconds);
    }
  }

  /**
   * Starts a piece `offset` seconds into its loop, or — with `"align"` — at
   * whatever point the piece already playing has reached, crossing over from
   * it; that is the style switch, and the two styles share one timeline.
   */
  private async startPiece(piece: Piece, epoch: number, offset: number | "align" | "clock"): Promise<void> {
    const style = this.style;
    if (!style) return;
    let buffers: Partial<Record<Layer, AudioBuffer>>;
    try { buffers = await this.load(style, piece); } catch { return; }
    // Superseded while it downloaded: another style, another piece, or off.
    if (epoch !== this.epoch || this.style !== style || this.pieceFor(this.state) !== piece) return;
    const old = this.playing;
    if (old && offset !== "align" && offset !== "clock") return;
    const loopLen = Object.values(buffers)[0]?.duration ?? 1;
    const when = this.ctx.currentTime + 0.05;
    // The boss piece is always where the fight's beat clock is; the room piece resumes where it was left.
    const onClock = piece === "boss" ? this.bossPosition(loopLen, when) : null;
    const from = onClock ?? (offset === "align" ? (old && old.piece === piece ? this.position(old, when) : this.resumeAt.get(piece) ?? 0)
      : typeof offset === "number" ? offset : 0);
    const out = this.ctx.createGain();
    out.gain.value = 0;
    out.connect(this.out);
    const ch: Partial<Record<Layer, Channel>> = {};
    for (const layer of LAYERS[piece]) {
      const buffer = buffers[layer];
      if (!buffer) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = OPEN; lp.Q.value = 0.5;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(lp).connect(g).connect(out);
      src.start(when, from % loopLen);
      ch[layer] = { src, lp, g };
    }
    this.playing = { piece, out, ch, t0: when - from, loopLen };
    this.apply(0.05);
    // A style switch is a crossover in place, so it can be quick; a new piece fades in at its own pace.
    // A re-seat is the same music a few tens of ms apart, so it crosses fast or it would flam.
    const fade = offset === "clock" ? 0.08 : old ? PIECE_FADE_S * 0.6 : PIECE_FADE_S;
    out.gain.setValueAtTime(0, when);
    out.gain.linearRampToValueAtTime(1, when + fade);
    if (old) this.fadeOut(old, fade);
  }

  private fadeOut(p: Playing | null, seconds: number): void {
    if (!p) return;
    const now = this.ctx.currentTime;
    p.out.gain.cancelScheduledValues(now);
    p.out.gain.setValueAtTime(p.out.gain.value, now);
    p.out.gain.linearRampToValueAtTime(0, now + seconds);
    for (const c of Object.values(p.ch) as Channel[]) {
      c.src.stop(now + seconds + 0.05);
      c.src.onended = () => { c.src.disconnect(); c.lp.disconnect(); c.g.disconnect(); };
    }
    setTimeout(() => p.out.disconnect(), (seconds + 0.2) * 1000);
  }

  private load(style: MusicStyle, piece: Piece): Promise<Partial<Record<Layer, AudioBuffer>>> {
    const key = `${style}/${piece}`;
    let hit = this.cache.get(key);
    if (!hit) {
      hit = Promise.all(LAYERS[piece].map(async (layer) => {
        const res = await fetch(`${this.base}music/${key}/${layer}.ogg`);
        if (!res.ok) throw new Error(`music ${key}/${layer}: ${res.status}`);
        return [layer, await this.ctx.decodeAudioData(await res.arrayBuffer())] as const;
      })).then((pairs) => Object.fromEntries(pairs) as Partial<Record<Layer, AudioBuffer>>);
      // A failed download is not cached, so the next attempt can succeed.
      hit.catch(() => this.cache.delete(key));
      this.cache.set(key, hit);
    }
    return hit;
  }
}
