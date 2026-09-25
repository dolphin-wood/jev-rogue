import { describe, expect, it } from "vitest";
import { MUSIC_DUCK, REPEAT_FLOOR, SAME_TARGET_MS, SfxMixer, TAIL_MS, VOICES, sfxPriority } from "./mix.ts";
import { SFX_DEFS, SFX_NAMES } from "./sfx.ts";

const req = (name: Parameters<SfxMixer["admit"]>[0]["name"], now: number, target?: number, durationMs = 200) => ({ name, now, durationMs, target });

describe("SfxMixer", () => {
  it("keeps the retrigger floor", () => {
    const m = new SfxMixer();
    expect(m.admit(req("hit_enemy", 0, 1))).not.toBeNull();
    expect(m.admit(req("hit_enemy", SFX_DEFS.hit_enemy!.retriggerMs - 1, 2))).toBeNull();
  });

  it("hears two blows on one body inside the window as one", () => {
    const m = new SfxMixer();
    expect(m.admit(req("hit_enemy", 0, 7))).not.toBeNull();
    // A different weight on the same body still counts as the same blow.
    expect(m.admit(req("hit_heavy", SAME_TARGET_MS - 10, 7))).toBeNull();
    expect(m.admit(req("hit_heavy", SAME_TARGET_MS - 10, 8))).not.toBeNull();
    expect(m.admit(req("hit_heavy", SAME_TARGET_MS + 200, 7))).not.toBeNull();
  });

  it("plays one tail per school per window", () => {
    const m = new SfxMixer();
    expect(m.admit(req("impact_venom", 0))).not.toBeNull();
    expect(m.admit(req("impact_venom", TAIL_MS - 1))).toBeNull();
    expect(m.admit(req("impact_frost", TAIL_MS - 1))).not.toBeNull();
    expect(m.admit(req("impact_venom", TAIL_MS + 1))).not.toBeNull();
  });

  it("fades repeats down to the floor and recovers after a pause", () => {
    const m = new SfxMixer();
    const gains: number[] = [];
    for (let i = 0; i < 8; i++) gains.push(m.admit(req("swing_light", i * 60, undefined, 20))!.gain);
    for (let i = 1; i < gains.length; i++) expect(gains[i]!).toBeLessThanOrEqual(gains[i - 1]!);
    expect(gains[gains.length - 1]!).toBeGreaterThanOrEqual(REPEAT_FLOOR * 0.5);
    expect(m.admit(req("swing_light", 5000, undefined, 20))!.gain).toBe(1);
  });

  it("drops texture when the budget is full, and lets survival cues steal", () => {
    const m = new SfxMixer();
    const names = ["hit_enemy", "hit_heavy", "cast_arcane", "swing_light"] as const;
    names.forEach((n, i) => expect(m.admit(req(n, i * 80, i, 5000))).not.toBeNull());
    // Full: a tail (priority 0) cannot get in.
    expect(m.admit(req("impact_frost", 400, undefined, 200))).toBeNull();
    // A hurt (priority 3) takes the lowest voice.
    const hurt = m.admit(req("hurt", 450, undefined, 300));
    expect(hurt).not.toBeNull();
    expect(hurt!.steal).toBeDefined();
  });

  it("never lets more than the budget of combat voices sound at once", () => {
    const m = new SfxMixer();
    const live: { id: number; end: number }[] = [];
    let t = 0;
    for (let i = 0; i < 400; i++) {
      t += 25;
      const name = SFX_NAMES.filter((n) => SFX_DEFS[n]!.category === "combat")[i % 30]!;
      const d = m.admit(req(name, t, i % 5, 300));
      if (!d) continue;
      if (d.steal !== undefined) live.splice(live.findIndex((v) => v.id === d.steal), 1);
      live.push({ id: d.id, end: t + 300 });
      expect(live.filter((v) => v.end > t).length).toBeLessThanOrEqual(VOICES);
    }
  });

  it("does not quieten survival cues in a crowd", () => {
    const m = new SfxMixer();
    ["hit_enemy", "cast_arcane", "swing_light"].forEach((n, i) => m.admit(req(n as never, i * 80, i, 5000)));
    expect(m.admit(req("tele_slam", 300, undefined, 400))!.gain).toBe(1);
  });

  it("ducks the music only for the moments on the list", () => {
    const m = new SfxMixer();
    expect(m.admit(req("hit_heavy", 0, 1))!.duck).toBe(0);
    expect(m.admit(req("hurt", 1000))!.duck).toBe(MUSIC_DUCK.hurt);
  });

  it("ranks every catalogued effect", () => {
    for (const n of SFX_NAMES) expect([0, 1, 2, 3]).toContain(sfxPriority(n));
    expect(sfxPriority("hurt")).toBeGreaterThan(sfxPriority("hit_enemy"));
    expect(sfxPriority("hit_enemy")).toBeGreaterThan(sfxPriority("swing_light"));
    expect(sfxPriority("swing_light")).toBeGreaterThan(sfxPriority("impact_venom"));
  });
});
