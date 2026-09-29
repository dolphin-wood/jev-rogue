import { describe, expect, it } from "vitest";
import { RngSource } from "../rng.ts";
import {
  rollNormalGrades,
  RUN_BOSS_ROOM, RUN_COMBAT_ROOMS, REWARD_KINDS, RUN_SHOP_ROOM,
  bossExit, fixedExit, legalDifficulties, cardTypesOf, NPC_OFFERS_MAX, portalChoices, ruleDoors, shopExit, stageFor,
} from "./doors.ts";
import { fountainWanted } from "./offer.ts";

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

  /*
   * **The run narrows twice, and neither narrowing is a question.** Both used
   * to fall through to the rule draw and raise up to three portals with three
   * different reward badges on them, every one of which opened onto the same
   * room — the last fight onto the merchant, the merchant onto the boss.
   */
  it("leaves the last fight and the vendors' stop exactly one way on each", () => {
    expect(bossExit()).toEqual([
      { reward: "gold", elite: false, grade: 1, type: "boss", boss: true, onward: true },
    ]);
    expect(shopExit()).toEqual([
      { reward: "gold", elite: false, grade: 1, type: "shop", onward: true },
    ]);
    // The last fight opens onto the stop; the stop opens onto the boss.
    expect(fixedExit(RUN_COMBAT_ROOMS)).toEqual(shopExit());
    expect(fixedExit(RUN_SHOP_ROOM)).toEqual(bossExit());
    // Every other room's portals are the Director's, so there is nothing fixed.
    expect(fixedExit(RUN_COMBAT_ROOMS - 1)).toBeNull();
    expect(fixedExit(1)).toBeNull();
  });

  /*
   * A door the run's shape fixed promises **no reward**: what is behind it is
   * the room ahead. The badge read `gold` over both of them, which is the
   * reward screen naming a currency the room will never hand out.
   */
  it("never puts a reward badge on a door that pays nothing", () => {
    for (const spec of [...bossExit(), ...shopExit()]) expect(spec.onward).toBe(true);
  });

  /*
   * Doc 003's early economy: the merchant is offered often while the build is
   * unformed, so the run needs a ceiling on how often it may be *offered* as
   * well as on how often it may be entered. Without it a live run put the
   * merchant on the portal list in nine rooms of sixteen.
   */
  it("stops offering a vendor once the run has offered its share", () => {
    const shape = { roomIndex: 6, lastWasElite: false, critical: false, npcRooms: 0 };
    expect(portalChoices({ ...shape, npcOffers: NPC_OFFERS_MAX - 1 }, rng("a"), 3).npcKinds).toContain("merchant");
    expect(portalChoices({ ...shape, npcOffers: NPC_OFFERS_MAX }, rng("b"), 3).npcKinds).not.toContain("merchant");
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

describe("what a door's badge names", () => {
  it("is every school or family among its cards, once each, in the offer's order", () => {
    expect(cardTypesOf("spell", ["shock_arc", "ember_dart", "spark_spray"])).toEqual({ schools: ["storm", "flame"] });
    expect(cardTypesOf("spell", ["ember_dart", "shock_arc", "frost_needle"])).toEqual({ schools: ["flame", "storm", "frost"] });
    expect(cardTypesOf("stat", ["vigour", "fleet"]).families?.length).toBeGreaterThan(0);
  });

  it("names nothing for a kind whose cards have no school or family", () => {
    expect(cardTypesOf("affix", ["chain", "pierce", "fork"])).toEqual({});
    expect(cardTypesOf("spell", [])).toEqual({});
  });
});

describe("the mid-run fountain", () => {
  it("is offered only once the bar is down to two thirds, not after a scratch", () => {
    expect(fountainWanted(5.5, 6)).toBe(false);
    expect(fountainWanted(4.5, 6)).toBe(false);
    expect(fountainWanted(4, 6)).toBe(true);
    expect(fountainWanted(1, 7)).toBe(true);
    const at = (hurt: boolean) => portalChoices({ ...run({ roomIndex: 6 }), hurt }, rng(), 3).npcKinds;
    expect(at(false)).not.toContain("fountain");
    expect(at(true)).toContain("fountain");
  });
});

describe("the doors onto the king's first audience (doc 022)", () => {
  it("is room 5, one of the fourteen fights, and pays a grade higher up to 3", async () => {
    const { RUN_AUDIENCE_ROOM, isAudienceRoom, leadsToAudience, audienceGrade } = await import("./doors.ts");
    expect(RUN_AUDIENCE_ROOM).toBe(5);
    expect(stageFor(RUN_AUDIENCE_ROOM)).toBe("combat");
    expect(isAudienceRoom(5)).toBe(true);
    expect(isAudienceRoom(4)).toBe(false);
    expect(leadsToAudience(4)).toBe(true);
    expect(leadsToAudience(5)).toBe(false);
    expect([1, 2, 3].map(audienceGrade)).toEqual([2, 3, 3]);
  });

  it("never offers an elite, a vendor or the fountain out of room 4", () => {
    for (let s = 0; s < 40; s++) {
      const shape = run({
        roomIndex: 4, hurt: true, fightsSinceElite: 5, elitesSoFar: 0, npcRooms: 0, npcOffers: 0, fountains: 0, fountainOffers: 0,
      });
      expect(legalDifficulties(shape)).toEqual(["normal"]);
      const choices = portalChoices(shape, rng(`a${s}`), 3);
      expect(choices.elite).toBe(false);
      expect(choices.npcKinds).toEqual([]);
      expect(ruleDoors(shape, rng(`r${s}`)).every((d) => d.difficulty === "normal")).toBe(true);
    }
    // Out of room 5 the ordinary rules are back.
    const after = run({ roomIndex: 6, hurt: true, fightsSinceElite: 5, elitesSoFar: 0 });
    expect(legalDifficulties(after)).toContain("elite");
  });
});

describe("the doors onto a first audience drawn from rooms 4 to 6 (doc 022)", () => {
  it("narrow the doors out of the room before the drawn one, and only those", async () => {
    const { leadsToFixedFight } = await import("./doors.ts");
    for (const at of [4, 5, 6]) {
      for (let i = 2; i <= 8; i++) {
        const shape = run({ roomIndex: i, audienceRoom: at, hurt: true, fightsSinceElite: 5, elitesSoFar: 0 });
        expect(leadsToFixedFight(i, at), `${i}->${at}`).toBe(i + 1 === at || i + 1 === 10);
        if (i + 1 === at) expect(legalDifficulties(shape)).toEqual(["normal"]);
      }
    }
  });
});

describe("each normal door draws its own grade", () => {
  const draws = (base: 1 | 2 | 3, raised: boolean, n = 3, rooms = 400) => {
    const rng = new RngSource(`grades-${base}-${raised}`).stream("g");
    return Array.from({ length: rooms }, () => rollNormalGrades(n, base, raised, rng));
  };

  it("keeps every door within one of the run's own, and I to III", () => {
    for (const base of [1, 2, 3] as const)
      for (const room of draws(base, false))
        for (const g of room) {
          expect(g).toBeGreaterThanOrEqual(Math.max(1, base - 1));
          expect(g).toBeLessThanOrEqual(Math.min(3, base + 1));
        }
  });

  it("puts at least one door of every room at the run's own strength", () => {
    for (const base of [1, 2, 3] as const)
      for (const room of draws(base, false)) expect(Math.max(...room)).toBeGreaterThanOrEqual(base);
  });

  it("gives the doors of one room different grades often enough to choose between", () => {
    for (const base of [1, 2, 3] as const) {
      const mixed = draws(base, false).filter((room) => new Set(room).size > 1).length / 400;
      expect(mixed, `base ${base}`).toBeGreaterThan(0.3);
    }
  });

  it("leans higher when the room is raised", () => {
    const mean = (rooms: number[][]) => rooms.flat().reduce((a, b) => a + b, 0) / rooms.flat().length;
    expect(mean(draws(2, true))).toBeGreaterThan(mean(draws(2, false)) + 0.3);
  });
});
