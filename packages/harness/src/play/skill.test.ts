import { describe, expect, it } from "vitest";
import {
  MAX_HEARTS, RngSource, contextFor, createWorld, measurePressure, plainInstance,
  step, worldCleared, STEP_MS, generateRoom, toRoomPlan, PLAYABLE_ARCHETYPES,
} from "@jr/core";
import type { EncounterPlan } from "@jr/core";
import { SKILL_NAMES, SKILL_PROFILES, noise, skillProfile } from "./skill.ts";
import { referenceInput } from "./player-model.ts";

describe("skill profiles", () => {
  /**
   * The harness asserts on `expert`, and it may only do that as long as
   * `expert` is the model unchanged. Every limit at zero and every budget
   * unbounded is what "unchanged" means in code, so it is checked rather than
   * remembered: a profile parameter added later with a non-zero expert default
   * would silently move every band the harness reports.
   */
  it("leaves the expert profile with no human limits at all", () => {
    const p = SKILL_PROFILES.expert;
    expect(p.attentionBullets).toBe(Infinity);
    expect(p.attentionEnemies).toBe(Infinity);
    for (const [key, value] of Object.entries(p)) {
      if (key === "name" || key === "reactionMs" || key.startsWith("attention") || key === "autoCast") continue;
      expect(value, key).toBe(0);
    }
    // And its own hands on the spell keys: the rotation every asserted number was measured with.
    expect(p.autoCast).toBe(false);
    // The one limit `expert` keeps: a person's eyes are still 230 ms behind.
    expect(p.reactionMs).toBe(230);
  });

  it("orders the presets from novice to expert on every limit", () => {
    const { novice, average, expert } = SKILL_PROFILES;
    expect(novice.reactionMs).toBeGreaterThan(average.reactionMs);
    expect(average.reactionMs).toBeGreaterThan(expert.reactionMs);
    for (const key of ["decisionMs", "aimErrorDeg", "castGapMs", "dashSkipChance", "bodyFearPx"] as const) {
      expect(novice[key], key).toBeGreaterThan(average[key]);
      expect(average[key], key).toBeGreaterThanOrEqual(expert[key]);
    }
    expect(novice.attentionBullets).toBeLessThan(average.attentionBullets);
    expect(average.attentionBullets).toBeLessThan(expert.attentionBullets);
  });

  it("refuses a name that is not a profile", () => {
    expect(() => skillProfile("pro")).toThrow(/unknown skill profile/);
    for (const name of SKILL_NAMES) expect(skillProfile(name).name).toBe(name);
    expect(skillProfile(undefined).name).toBe("expert");
  });

  /**
   * The whole value of the harness is that a seed replays. The human limits are
   * modelled with a hash of the world clock rather than `Math.random`, and this
   * is the assertion that says so: two worlds built from one seed and played by
   * one profile end in the same place, to the pixel.
   */
  it("plays deterministically under a profile that skips, hesitates and misaims", () => {
    const end = (): { x: number; y: number; hearts: number; ms: number } => {
      const w = fixture();
      let ms = 0;
      while (ms < 20_000 && w.player.hearts > 0 && !worldCleared(w)) {
        step(w, referenceInput(w, SKILL_PROFILES.novice));
        ms += STEP_MS;
      }
      return { x: w.player.x, y: w.player.y, hearts: w.player.hearts, ms };
    };
    expect(end()).toEqual(end());
  });

  it("hashes its rolls to a stable, bounded value", () => {
    expect(noise(7, 11)).toBe(noise(7, 11));
    expect(noise(7, 11)).not.toBe(noise(7, 12));
    for (let i = 0; i < 200; i++) {
      const v = noise(i, i * 31);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

/** One small fight, built the way `pnpm calibrate` builds one. */
function fixture() {
  const arch = PLAYABLE_ARCHETYPES[0]!;
  const src = new RngSource("skill-test");
  const g = generateRoom(
    { space: arch.id, symmetry: "mirrored", size: "standard", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    arch.doors[0]!, "combat", src.stream("r"),
  );
  const room = toRoomPlan(g, { id: "skill", seed_key: "skill", reward_kind: "item", params_source: "rule" });
  const waves = [{
    at_ms: 0,
    spawns: [
      { archetype: "rusher" as const, spawn_group: room.spawn_groups[0]!.id, count: 2 },
      { archetype: "shooter" as const, spawn_group: room.spawn_groups[0]!.id, count: 2 },
    ],
  }];
  const plan: EncounterPlan = {
    profile: { composition: "mixed", density: "normal", wave_structure: "relentless", anchor: "none", entry: "far_front" },
    waves, measured_pressure: measurePressure(waves, contextFor(room, "mixed")), band: [0, 99],
    elite_affixes: [], source: "rule",
  };
  return createWorld({
    room, encounter: plan,
    staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), plainInstance("stone_shard"), null, null, null, null],
    hearts: MAX_HEARTS, rng: new RngSource("skill-play").stream("g"),
  });
}
