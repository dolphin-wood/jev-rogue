/**
 * End to end over the real delivery in assets/: the sheet the checker accepted
 * must survive every mood's tint with the enemy-bullet hue held fixed.
 *
 * This is the test that would catch art whose bullets drift toward the room
 * colour, which is the failure mode that would quietly make a bullet hell
 * unreadable.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { moodTransform, tintRGBA, isProtected, rgbToHsl } from "@jr/core";
import type { Mood } from "@jr/core";
import { generatePlaceholders, PLACEHOLDER_MARKER } from "./placeholder.ts";
import { checkAssets } from "./check.ts";
import { EXPANSION_WALK_FRAMES } from "./art.ts";

const DIR = join(process.cwd(), "assets");

const ALL_MOODS: Mood[] = (["cold", "warm"] as const).flatMap((t) =>
  (["dim", "bright"] as const).flatMap((b) =>
    (["calm", "busy"] as const).map((p) => ({ temperature: t, brightness: b, particle_intensity: p })),
  ),
);

beforeAll(() => {
  // A placeholder delivery is regenerated so it can never drift behind a
  // manifest change; real art carries no marker and is left untouched.
  const isPlaceholder = existsSync(join(DIR, PLACEHOLDER_MARKER));
  if (!existsSync(join(DIR, "sprites.png")) || isPlaceholder) generatePlaceholders(DIR);
});

/*
 * The sheet is decoded once and each distinct mood transform is applied once,
 * shared by every test below. Each test decoded the 16-megapixel sheet and
 * tinted it for all eight moods on its own, which was thirty-two full tints
 * and most of a minute; the tint is a pure function of sheet and transform,
 * so sharing it changes nothing a test observes.
 */
let decoded: PNG | null = null;
function sheet(): PNG {
  return (decoded ??= PNG.sync.read(readFileSync(join(DIR, "sprites.png"))));
}

const tinted = new Map<string, { data: Uint8Array; report: ReturnType<typeof tintRGBA> }>();
function tintedFor(mood: Mood): { data: Uint8Array; report: ReturnType<typeof tintRGBA> } {
  const t = moodTransform(mood);
  // What `tintRGBA` reads; the particle scale does not tint, so the eight moods are four sheets.
  const key = `${t.hueShiftDeg}|${t.saturationMul}|${t.lightnessMul}`;
  let hit = tinted.get(key);
  if (!hit) {
    const data = Uint8Array.from(sheet().data);
    hit = { data, report: tintRGBA(data, t) };
    tinted.set(key, hit);
  }
  return hit;
}

function hexOf(data: Uint8Array | Uint8ClampedArray, i: number): string {
  return "#" + [data[i], data[i + 1], data[i + 2]].map((c) => c!.toString(16).padStart(2, "0")).join("");
}

describe("asset pipeline", () => {
  it("the checked-in delivery passes the spec", () => {
    expect(checkAssets(DIR, { write: false }).violations).toEqual([]);
  });

  it("gives every walking expansion enemy a drawn cycle, every frame its own drawing", () => {
    const png = sheet();
    const frames = JSON.parse(readFileSync(join(DIR, "sprites.json"), "utf8")).frames;
    for (const kind of ["warden", "bellringer", "snarecaster", "delver", "cinderling"])
      for (const facing of ["s", "n", "w"]) {
        const hashes = new Set<string>();
        for (let phase = 0; phase < EXPANSION_WALK_FRAMES; phase++) {
          const frame = frames[`enemy_${kind}_${facing}_walk${phase}`] as { x: number; y: number; w: number; h: number };
          const pixels = Buffer.alloc(frame.w * frame.h * 4);
          for (let y = 0; y < frame.h; y++) {
            const start = ((frame.y + y) * png.width + frame.x) * 4;
            png.data.copy(pixels, y * frame.w * 4, start, start + frame.w * 4);
          }
          hashes.add(createHash("sha1").update(pixels).digest("hex"));
        }
        expect(hashes.size, `${kind} ${facing} walk frames`).toBe(EXPANSION_WALK_FRAMES);
      }
  });

  it("tints for every mood, moving most of the art", () => {
    for (const mood of ALL_MOODS) {
      const { report } = tintedFor(mood);
      expect(report.opaque).toBeGreaterThan(0);
      expect(report.shifted).toBeGreaterThan(report.opaque * 0.5);
    }
  });

  it("holds every protected enemy-bullet pixel fixed, whatever the mood", () => {
    const base = sheet();
    const protectedIndices: number[] = [];
    // Judged once per distinct colour: the sheet has far fewer colours than pixels.
    const verdict = new Map<number, boolean>();
    for (let i = 0; i < base.data.length; i += 4) {
      if (base.data[i + 3] === 0) continue;
      const rgb = (base.data[i]! << 16) | (base.data[i + 1]! << 8) | base.data[i + 2]!;
      let p = verdict.get(rgb);
      if (p === undefined) {
        const [h, s] = rgbToHsl(hexOf(base.data, i));
        verdict.set(rgb, (p = isProtected(h, s)));
      }
      if (p) protectedIndices.push(i);
    }
    expect(protectedIndices.length).toBeGreaterThan(0);

    for (const mood of ALL_MOODS) {
      const { data } = tintedFor(mood);
      // Collected, then asserted once: an expect a pixel was most of the test.
      const moved: string[] = [];
      for (const i of protectedIndices)
        if (hexOf(data, i) !== hexOf(base.data, i)) moved.push(`${i / 4}: ${hexOf(base.data, i)} → ${hexOf(data, i)}`);
      expect(moved.slice(0, 20), JSON.stringify(mood)).toEqual([]);
    }
  });

  it("produces a different sheet for each distinct mood transform", () => {
    const seen = new Set<string>();
    for (const mood of ALL_MOODS) {
      const { data } = tintedFor(mood);
      // Sample rather than hash the whole sheet; the tint is global.
      const probe: string[] = [];
      for (let i = 0; i < data.length && probe.length < 40; i += 4 * 977)
        if (data[i + 3] !== 0) probe.push(hexOf(data, i));
      seen.add(probe.join(""));
    }
    // temperature x brightness give four distinct looks; particles do not tint.
    expect(seen.size).toBe(4);
  });

  it("holds complete enemy bullets fixed, including outlines and highlights", () => {
    const base = sheet();
    const atlas = JSON.parse(readFileSync(join(DIR, "sprites.json"), "utf8"));
    const indices: number[] = [];
    for (const [name, frame] of Object.entries(atlas.frames)) {
      if (!name.startsWith("bullet_enemy")) continue;
      const r = frame as { x: number; y: number; w: number; h: number };
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const i = ((r.y + y) * base.width + r.x + x) * 4;
        if (base.data[i + 3] !== 0) indices.push(i);
      }
    }
    expect(indices.length).toBeGreaterThan(0);
    for (const mood of ALL_MOODS) {
      const { data } = tintedFor(mood);
      const moved: string[] = [];
      for (const i of indices)
        for (let c = 0; c < 4; c++)
          if (data[i + c] !== base.data[i + c]) { moved.push(`${i / 4}`); break; }
      expect(moved.slice(0, 20), JSON.stringify(mood)).toEqual([]);
    }
  });
});
