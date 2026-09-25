/**
 * The sequencer, driven against a stub `AudioContext`.
 *
 * There is no browser here, so this cannot hear anything. What it can check is
 * the part that is arithmetic rather than sound: that the transport advances,
 * that a state change is a set of gain ramps and not a restart, and that a
 * suspended tab does not come back to a burst of bars scheduled into the past
 * — which is the failure this class is most likely to have and the one that is
 * hardest to notice by playing.
 */
import { describe, it, expect } from "vitest";
import { LOOP_BARS, MUSIC_LAYERS, SEC_PER_BAR } from "@jr/core";
import { Music } from "./music.ts";

interface Stub {
  ctx: AudioContext;
  advance: (seconds: number) => void;
  starts: number[];
  ramps: number[];
}

function stubContext(): Stub {
  let now = 0;
  const starts: number[] = [];
  const ramps: number[] = [];
  const param = (): AudioParam => ({
    value: 0,
    cancelScheduledValues() { return this as unknown as AudioParam; },
    setValueAtTime() { return this as unknown as AudioParam; },
    linearRampToValueAtTime(v: number) { ramps.push(v); return this as unknown as AudioParam; },
  } as unknown as AudioParam);
  const node = (): GainNode => ({ gain: param(), connect() { /* graph is not under test */ } } as unknown as GainNode);
  const ctx = {
    get currentTime() { return now; },
    sampleRate: 44100,
    destination: node(),
    createGain: () => node(),
    // The hall. Its impulse response is arithmetic like everything else here,
    // so the stub only has to hold the buffer it is handed.
    createConvolver: () => ({ buffer: null, connect() { /* graph is not under test */ } }),
    createBufferSource: () => ({
      buffer: null,
      connect() { /* graph is not under test */ },
      disconnect() { /* graph is not under test */ },
      onended: null,
      start(at: number) { starts.push(at); },
    }),
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
  } as unknown as AudioContext;
  return { ctx, advance: (s) => { now += s; }, starts, ramps };
}

/** The scheduler's own interval, reached without waiting for real time. */
function pump(music: Music, stub: Stub, seconds: number, step = 0.25): void {
  for (let t = 0; t < seconds; t += step) {
    stub.advance(step);
    (music as unknown as { tick(): void }).tick();
  }
}

describe("the music sequencer", () => {
  it("schedules ahead of the clock and never behind it", () => {
    const stub = stubContext();
    const music = new Music(stub.ctx, stub.ctx.destination);
    music.start();
    pump(music, stub, SEC_PER_BAR * 8);
    expect(music.isRunning()).toBe(true);
    expect(stub.starts.length).toBeGreaterThan(50);
    for (const at of stub.starts) expect(at).toBeGreaterThanOrEqual(0);
  });

  it("changes state by ramping gains rather than restarting the transport", () => {
    const stub = stubContext();
    const music = new Music(stub.ctx, stub.ctx.destination);
    music.start();
    pump(music, stub, SEC_PER_BAR * 4);
    const before = (music as unknown as { nextBar: number }).nextBar;
    const ramped = stub.ramps.length;
    music.setState("fight", "cold");
    expect(stub.ramps.length - ramped).toBe(MUSIC_LAYERS.length); // one per layer
    // The bar counter is untouched: the fight joins the piece already playing.
    expect((music as unknown as { nextBar: number }).nextBar).toBe(before);
    expect(music.currentState()).toBe("fight");
  });

  it("catches up rather than flooding when the tab comes back", () => {
    const stub = stubContext();
    const music = new Music(stub.ctx, stub.ctx.destination);
    music.start();
    pump(music, stub, SEC_PER_BAR);
    const before = stub.starts.length;
    // Five minutes of a suspended tab, then one tick.
    stub.advance(300);
    (music as unknown as { tick(): void }).tick();
    const added = stub.starts.length - before;
    // One bar's worth of notes, not a hundred bars' worth.
    expect(added).toBeLessThan(80);
    for (const at of stub.starts.slice(before)) expect(at).toBeGreaterThanOrEqual(300);
  });

  it("wraps at the end of the loop", () => {
    const stub = stubContext();
    const music = new Music(stub.ctx, stub.ctx.destination);
    music.start();
    pump(music, stub, SEC_PER_BAR * (LOOP_BARS + 2), 1);
    expect((music as unknown as { nextBar: number }).nextBar).toBeLessThan(LOOP_BARS);
  });

  it("stops without leaving the transport running", () => {
    const stub = stubContext();
    const music = new Music(stub.ctx, stub.ctx.destination);
    music.start();
    pump(music, stub, SEC_PER_BAR);
    music.stop();
    const after = stub.starts.length;
    pump(music, stub, SEC_PER_BAR * 4);
    expect(stub.starts.length).toBe(after);
    expect(music.isRunning()).toBe(false);
  });
});
