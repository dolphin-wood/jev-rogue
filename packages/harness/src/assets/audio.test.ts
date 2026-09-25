import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CATEGORY_LIMIT, LOOP_SEC, MUSIC_STATES, SAMPLE_RATE, SFX_DEFS, SFX_NAMES,
  approxLufs, barNotes, dbfs, fingerprint, peak, renderMusic, renderSfx,
  renderSting, rms, spectralDistance, toWavBytes,
} from "@jr/core";
import { audioManifest, generateAudio } from "./audio.ts";

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

  it("holds every effect under -1 dBFS, however many layers it stacks", () => {
    for (const name of SFX_NAMES) {
      for (let v = 0; v < SFX_DEFS[name]!.variants; v++) {
        const p = peak(renderSfx(name, v));
        // A full-scale sample means the waveform was flattened where it
        // should have been loudest, which is the one place the ear listens.
        expect(dbfs(p), `${name}_${v}`).toBeLessThan(-1);
        expect(p, `${name}_${v}`).toBeGreaterThan(0.05);
      }
    }
  });

  it("levels each category, so nothing in it arrives twice as loud as its neighbour", () => {
    const byCategory = new Map<string, number[]>();
    for (const name of SFX_NAMES) {
      const l = approxLufs(renderSfx(name, 0));
      const at = byCategory.get(SFX_DEFS[name]!.category) ?? [];
      at.push(l);
      byCategory.set(SFX_DEFS[name]!.category, at);
    }
    for (const [category, levels] of byCategory) {
      // Nine decibels is the width of a category: enough for a coin to sit
      // under a death, not enough for either to disappear under the other.
      expect(Math.max(...levels) - Math.min(...levels), category).toBeLessThan(9);
    }
  });

  it("gives each variant an audibly different waveform", () => {
    for (const name of SFX_NAMES) {
      if (SFX_DEFS[name]!.variants < 2) continue;
      const a = renderSfx(name, 0);
      const b = renderSfx(name, 1);
      const n = Math.min(a.length, b.length);
      let diff = 0;
      for (let i = 0; i < n; i++) diff += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
      expect(diff / n, name).toBeGreaterThan(0.01);
    }
  });

  it("produces no silent file, which would be a voice that failed to render", () => {
    for (const name of SFX_NAMES) {
      for (let v = 0; v < SFX_DEFS[name]!.variants; v++) {
        expect(rms(renderSfx(name, v)), `${name}_${v}`).toBeGreaterThan(0.01);
      }
    }
  });

  /**
   * Two effects in *different* categories that sound alike is a design fault
   * rather than a mix fault: a coin and a sword hit must never be confusable,
   * because they are answered differently. Inside one category resemblance is
   * often the point — the three weights of hit are meant to be a family.
   */
  it("keeps the categories apart, so no world or UI sound reads as a combat one", () => {
    const prints = SFX_NAMES.map((name) => ({
      name, category: SFX_DEFS[name]!.category, print: fingerprint(renderSfx(name, 0)),
    }));
    const close: string[] = [];
    for (let i = 0; i < prints.length; i++) {
      for (let k = i + 1; k < prints.length; k++) {
        const a = prints[i]!;
        const b = prints[k]!;
        if (a.category === b.category) continue;
        if (spectralDistance(a.print, b.print) < 0.06) close.push(`${a.name} ~ ${b.name}`);
      }
    }
    expect(close).toEqual([]);
  });

  it("caps a category, so a pile of deaths is one event", () => {
    for (const limit of Object.values(CATEGORY_LIMIT)) {
      expect(limit.voices).toBeGreaterThan(0);
      expect(limit.windowMs).toBeGreaterThan(0);
    }
  });

  it("writes a wav whose samples round-trip", () => {
    const bytes = toWavBytes(new Float32Array([0, 0.5, -0.5, 1, -1]));
    const buf = Buffer.from(bytes);
    expect(buf.readInt16LE(44)).toBe(0);
    expect(buf.readInt16LE(46)).toBe(Math.round(0.5 * 32767));
    expect(buf.readInt16LE(50)).toBe(32767);
    expect(buf.readInt16LE(52)).toBe(-32767);
  });
});

describe("the music", () => {
  it("runs over ninety seconds before a bar repeats exactly", () => {
    expect(LOOP_SEC).toBeGreaterThan(90);
    // And the bars inside it are not all the same bar: two bars a whole
    // progression apart must differ, or the loop is eight bars wearing a hat.
    const a = JSON.stringify(barNotes(2, "cold"));
    expect(JSON.stringify(barNotes(10, "cold"))).not.toBe(a);
  });

  it("keeps every state under -1 dBFS with all its layers at once", () => {
    for (const state of MUSIC_STATES) {
      for (const mood of ["warm", "cold"] as const) {
        const p = peak(renderMusic(state, 24, mood));
        expect(dbfs(p), `${state}/${mood}`).toBeLessThan(-1);
        expect(p, `${state}/${mood}`).toBeGreaterThan(0.05);
      }
    }
    expect(dbfs(peak(renderSting("cold")))).toBeLessThan(-1);
  });

  it("gains intensity by layering rather than by changing piece", () => {
    // The fight's notes are the explore's notes. Only the gains differ, and
    // that is the whole claim the adaptive design rests on.
    expect(JSON.stringify(barNotes(5, "cold"))).toBe(JSON.stringify(barNotes(5, "cold")));
    const quiet = rms(renderMusic("explore", 12, "cold"));
    const loud = rms(renderMusic("fight", 12, "cold"));
    expect(loud).toBeGreaterThan(quiet);
  });

  it("moves key and mode with the room's temperature", () => {
    expect(JSON.stringify(barNotes(3, "warm"))).not.toBe(JSON.stringify(barNotes(3, "cold")));
  });

  it("is deterministic, so the mixdown that is reviewed is the one that plays", () => {
    const a = renderMusic("fight", 6, "cold");
    const b = renderMusic("fight", 6, "cold");
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 977) expect(a[i]).toBe(b[i]);
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

  it("ships a set small enough to download", () => {
    const root = new URL("../../../../assets/sfx/", import.meta.url).pathname;
    let bytes = 0;
    for (const name of audioManifest()) bytes += readFileSync(join(root, `${name}.wav`)).length;
    expect(bytes).toBeLessThan(2.5 * 1024 * 1024);
  });
});
