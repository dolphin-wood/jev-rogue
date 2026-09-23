import { describe, expect, it } from "vitest";
import { RngSource } from "../rng.ts";
import {
  RUN_BOSS_ROOM, RUN_COMBAT_ROOMS, REWARD_KINDS, RUN_SHOP_ROOM,
  legalDifficulties, ruleDoors, stageFor,
} from "./doors.ts";

const rng = (seed = "d"): ReturnType<RngSource["stream"]> => new RngSource(seed).stream("doors");
const run = (over: Partial<Parameters<typeof ruleDoors>[0]> = {}) =>
  ({ roomIndex: 5, lastWasElite: false, critical: false, ...over });

describe("the run's shape", () => {
  it("fights, then shops, then the boss, in that order and once each", () => {
    expect(stageFor(1)).toBe("combat");
    expect(stageFor(RUN_COMBAT_ROOMS)).toBe("combat");
    expect(stageFor(RUN_SHOP_ROOM)).toBe("shop");
    expect(stageFor(RUN_BOSS_ROOM)).toBe("boss");
    // The merchant is fixed rather than offered, because gold is a reward kind
    // and a run that never reached a shop would make it a dead card.
    expect(RUN_SHOP_ROOM).toBe(RUN_BOSS_ROOM - 1);
  });
});

describe("difficulty", () => {
  it("never offers an elite straight after an elite", () => {
    expect(legalDifficulties(run({ lastWasElite: true }))).toEqual(["normal"]);
  });

  it("never offers an elite to a player one hit from dying", () => {
    expect(legalDifficulties(run({ critical: true }))).toEqual(["normal"]);
  });

  it("holds elites back until the player knows what their build does", () => {
    expect(legalDifficulties(run({ roomIndex: 1 }))).toEqual(["normal"]);
    expect(legalDifficulties(run({ roomIndex: 3 }))).toContain("elite");
  });
});

describe("the portals offered", () => {
  it("never offers the same reward kind twice", () => {
    /*
     * Two portals promising the same currency is one portal with extra steps:
     * the player's question is *which* currency, and a duplicate answers it
     * twice while spending a door.
     */
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const doors = ruleDoors(run(), rng(seed));
      expect(new Set(doors.map((d) => d.reward)).size).toBe(doors.length);
    }
  });

  it("offers gold often, but not every time", () => {
    /*
     * Gold is the out: the portals are gated on answering the offer, so a
     * player who wants none of stat, spell or affix needs somewhere to go.
     * Three doors drawn from four kinds give it about three quarters of the
     * time, which is enough — it was forced into every offer once, and played
     * out that made half the doors taken gold, in a run with one place to
     * spend it.
     */
    const seeds = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
    const withGold = seeds.filter((s) => ruleDoors(run(), rng(s), 3).some((d) => d.reward === "gold"));
    expect(withGold.length).toBeGreaterThan(seeds.length * 0.5);
    expect(withGold.length).toBeLessThanOrEqual(seeds.length);
  });

  it("always leaves at least one kind out, so the offer is a choice", () => {
    // With all four present every time the player never weighs what they are
    // giving up, and the door stops being a decision.
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const doors = ruleDoors(run(), rng(seed));
      expect(new Set(doors.map((d) => d.reward)).size).toBe(doors.length);
      expect(doors.length).toBeGreaterThanOrEqual(1);
      expect(doors.length).toBeLessThanOrEqual(3);
    }
  });

  it("varies how many portals a room ends with", () => {
    // One to three, as doc 003 puts the question: three every time read as
    // no randomness at all.
    const counts = new Set<number>();
    for (let i = 0; i < 40; i++) counts.add(ruleDoors(run(), rng(`n${i}`)).length);
    expect(counts.has(3)).toBe(true);
    expect(counts.has(2)).toBe(true);
    expect(counts.size).toBeGreaterThanOrEqual(2);
  });

  it("offers at most one elite, so difficulty stays a choice", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const elites = ruleDoors(run(), rng(seed)).filter((d) => d.difficulty === "elite");
      expect(elites.length).toBeLessThanOrEqual(1);
    }
  });

  it("offers no elite at all when the rules forbid one", () => {
    const doors = ruleDoors(run({ lastWasElite: true }), rng());
    expect(doors.every((d) => d.difficulty === "normal")).toBe(true);
  });

  it("still offers something when only one portal is asked for", () => {
    // A single door is a legal set; it just is not a choice.
    const doors = ruleDoors(run(), rng(), 1);
    expect(doors).toHaveLength(1);
  });

  it("draws only from the four kinds", () => {
    for (const seed of ["a", "b", "c"])
      for (const d of ruleDoors(run(), rng(seed)))
        expect(REWARD_KINDS).toContain(d.reward);
  });
});
