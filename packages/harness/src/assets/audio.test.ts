import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_RATE, VOICES, audioManifest, generateAudio, synth, toWav } from "./audio.ts";

describe("the sound synthesiser", () => {
  it("is deterministic, so the shipped set is reviewable as a diff", () => {
    const a = generateAudio(mkdtempSync(join(tmpdir(), "sfx-a-")));
    const b = generateAudio(mkdtempSync(join(tmpdir(), "sfx-b-")));
    expect(a.digest).toBe(b.digest);
    expect(a.files).toBe(audioManifest().length);
  });

  it("writes a playable wav header", () => {
    const dir = mkdtempSync(join(tmpdir(), "sfx-h-"));
    generateAudio(dir);
    const buf = readFileSync(join(dir, "sfx", "kill_0.wav"));
    expect(buf.subarray(0, 4).toString()).toBe("RIFF");
    expect(buf.subarray(8, 12).toString()).toBe("WAVE");
    expect(buf.readUInt16LE(20)).toBe(1); // PCM
    expect(buf.readUInt16LE(22)).toBe(1); // mono
    expect(buf.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(buf.readUInt16LE(34)).toBe(16); // bit depth
    // The declared data length must match what is actually there, or a
    // decoder truncates the tail of every sound.
    expect(buf.readUInt32LE(40)).toBe(buf.length - 44);
  });

  it("emits every declared variant and nothing else", () => {
    const dir = mkdtempSync(join(tmpdir(), "sfx-m-"));
    generateAudio(dir);
    const found = readdirSync(join(dir, "sfx")).map((f) => f.replace(/\.wav$/, "")).sort();
    expect(found).toEqual(audioManifest());
  });

  it("never clips, however many layers a voice stacks", () => {
    for (const [name, def] of Object.entries(VOICES)) {
      const samples = synth(def.voice(1), 1);
      let peak = 0;
      for (const s of samples) peak = Math.max(peak, Math.abs(s));
      // Soft-clipped at source, so a full-scale sample means the waveform
      // was flattened where it should have been loudest.
      expect(peak, name).toBeLessThan(0.999);
      expect(peak, name).toBeGreaterThan(0.05);
    }
  });

  it("gives each variant an audibly different waveform", () => {
    for (const [name, def] of Object.entries(VOICES)) {
      if (def.variants < 2) continue;
      const a = synth(def.voice(0.96), 1);
      const b = synth(def.voice(1.04), 2);
      const n = Math.min(a.length, b.length);
      let diff = 0;
      for (let i = 0; i < n; i++) diff += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
      expect(diff / n, name).toBeGreaterThan(0.01);
    }
  });

  it("produces no silent file, which would be a voice that failed to render", () => {
    for (const [name, def] of Object.entries(VOICES)) {
      for (let v = 0; v < def.variants; v++) {
        const samples = synth(def.voice(1), v + 1);
        let energy = 0;
        for (const s of samples) energy += s * s;
        expect(Math.sqrt(energy / samples.length), `${name}_${v}`).toBeGreaterThan(0.01);
      }
    }
  });

  it("writes a wav whose samples round-trip", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buf = toWav(samples);
    expect(buf.readInt16LE(44)).toBe(0);
    expect(buf.readInt16LE(46)).toBe(Math.round(0.5 * 32767));
    expect(buf.readInt16LE(50)).toBe(32767);
    expect(buf.readInt16LE(52)).toBe(-32767);
  });
});

describe("the shipped sound set", () => {
  it("is byte-identical to what the generator produces", () => {
    const dir = mkdtempSync(join(tmpdir(), "sfx-ship-"));
    generateAudio(dir);
    const root = new URL("../../../../assets/sfx/", import.meta.url).pathname;
    for (const name of audioManifest()) {
      const fresh = readFileSync(join(dir, "sfx", `${name}.wav`));
      const shipped = readFileSync(join(root, `${name}.wav`));
      // If this fails the committed audio has drifted from its source, and
      // the generator is no longer the thing anyone can review.
      expect(shipped.equals(fresh), name).toBe(true);
    }
  });
});
