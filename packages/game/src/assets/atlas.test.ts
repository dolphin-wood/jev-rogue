import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { RecolourableAtlas, facingFrame } from "./atlas.ts";
import type { AtlasJson } from "./atlas.ts";
import type { Mood } from "@jr/core";
import { generatePlaceholders } from "../../../harness/src/assets/placeholder.ts";

const DIR = join(process.cwd(), "assets");
let atlas: RecolourableAtlas;

beforeAll(() => {
  if (!existsSync(join(DIR, "sprites.png"))) generatePlaceholders(DIR);
  const png = PNG.sync.read(readFileSync(join(DIR, "sprites.png")));
  const json = JSON.parse(readFileSync(join(DIR, "sprites.json"), "utf8")) as AtlasJson;
  atlas = new RecolourableAtlas({ width: png.width, height: png.height, data: png.data }, json);
});

const mood = (over: Partial<Mood> = {}): Mood => ({
  temperature: "cold", brightness: "dim", particle_intensity: "calm", ...over,
});

describe("RecolourableAtlas", () => {
  it("loads the delivered sheet and exposes its frames", () => {
    expect(atlas.frameNames.length).toBeGreaterThan(100);
    expect(atlas.has("player_s_idle0")).toBe(true);
    expect(atlas.frame("player_s_idle0").w).toBe(64);
    expect(() => atlas.frame("nope")).toThrow(/no frame named/);
  });

  it("tints per mood without mutating the source, so moods stay independent", () => {
    const a = atlas.forMood(mood({ brightness: "dim" }));
    const b = atlas.forMood(mood({ brightness: "bright" }));
    expect(a.report.opaque).toBeGreaterThan(0);
    expect(b.report.shifted).toBeGreaterThan(0);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(false);
    // A third call with the first mood must match the first result exactly.
    const again = atlas.forMood(mood({ brightness: "dim" }));
    expect(Buffer.from(again.data).equals(Buffer.from(a.data))).toBe(true);
  });

  it("keeps the enemy-bullet hue across every mood", () => {
    const r = atlas.frame("bullet_enemy_a_0");
    const base = PNG.sync.read(readFileSync(join(DIR, "sprites.png")));
    const sheetWidth = base.width;
    for (const m of [mood(), mood({ temperature: "warm" }), mood({ brightness: "bright" })]) {
      const { data } = atlas.forMood(m);
      let found = 0;
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) {
          const i = ((r.y + y) * sheetWidth + (r.x + x)) * 4;
          if (data[i + 3] === 0) continue;
          // Smooth art uses a hue band, not one exact palette hex.
          expect(Array.from(data.subarray(i, i + 4))).toEqual(Array.from(base.data.subarray(i, i + 4)));
          found++;
        }
      expect(found).toBeGreaterThan(0);
    }
  });

  it("rejects a sheet whose data length does not match its dimensions", () => {
    expect(() => new RecolourableAtlas({ width: 4, height: 4, data: new Uint8Array(8) }, { frames: {} }))
      .toThrow(/expected 64/);
  });

  it("groups animation frames by prefix", () => {
    /*
     * Asserted as a **sorted set against the sheet**, not as a hard-coded
     * list. The hard-coded version broke the moment the turret gained its
     * `death`, `dormant1`, `hit0/1` and `tele1` frames — and a test that has
     * to be edited every time art is delivered is a test that will be edited
     * without being read. What this has to prove is that the grouping is by
     * prefix and in a stable order, which does not depend on which frames
     * exist.
     */
    const seq = atlas.sequence("enemy_turret_");
    expect(seq).toEqual([...seq].sort());
    expect(seq).toEqual(atlas.frameNames.filter((n) => n.startsWith("enemy_turret_")).sort());
    expect(seq).toContain("enemy_turret_tele");
    expect(seq.every((n) => n.startsWith("enemy_turret_"))).toBe(true);
  });
});

describe("facingFrame", () => {
  it("maps the four quadrants and mirrors east from west", () => {
    expect(facingFrame("player", 90, "idle0")).toEqual({ name: "player_s_idle0", flipX: false });
    expect(facingFrame("player", 180, "idle0")).toEqual({ name: "player_w_idle0", flipX: false });
    expect(facingFrame("player", 270, "idle0")).toEqual({ name: "player_n_idle0", flipX: false });
    expect(facingFrame("player", 0, "idle0")).toEqual({ name: "player_w_idle0", flipX: true });
  });

  it("normalises angles outside zero to 360", () => {
    expect(facingFrame("player", -90, "idle1")).toEqual(facingFrame("player", 270, "idle1"));
    expect(facingFrame("player", 450, "idle1")).toEqual(facingFrame("player", 90, "idle1"));
  });

  it("only names frames the sheet actually contains", () => {
    for (const deg of [0, 45, 90, 135, 180, 225, 270, 315])
      for (const f of ["idle0", "idle1"] as const)
        expect(atlas.has(facingFrame("player", deg, f).name)).toBe(true);
  });
});
