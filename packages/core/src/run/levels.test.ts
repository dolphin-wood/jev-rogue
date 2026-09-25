/**
 * Experience and levels (`levels.ts`), and the two properties the design
 * rests on: a body is worth what its own definition says, and a level is
 * derived from a total rather than accumulated.
 */
import { describe, expect, it } from "vitest";
import {
  LEVEL_HEARTS, LEVEL_HP, LEVEL_MANA, LEVEL_SWORD_DAMAGE, XP_TO_NEXT,
  baseXp, levelAt, levelBonus, swordAt, withLevels, xpForKill, xpToNext,
} from "./levels.ts";
import { ENEMIES, ENEMY_IDS, baseArchetype, isSubspecies } from "../encounters/enemies.ts";
import { noMods } from "../sim/types.ts";
import { applyStat, statById } from "./stats.ts";
import { createWorld, step } from "../sim/world.ts";
import { makeEnemy } from "../sim/enemy.ts";
import { NO_INPUT } from "../sim/types.ts";
import { throneHall } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import { MAX_HEARTS } from "./summarize.ts";
import { SWING_DAMAGE } from "../sim/melee.ts";

describe("what a body pays", () => {
  it("is read off the roster, so every assemblable body has a value", () => {
    for (const id of ENEMY_IDS) expect(baseXp(id), id).toBeGreaterThan(0);
  });

  it("rises with base health: a tank is clearly more than a rusher", () => {
    // The point of deriving it: the heaviest melee body in the roster is worth
    // visibly more than the lightest, without either being typed in.
    expect(baseXp("tank")).toBeGreaterThan(baseXp("rusher") * 1.5);
    // And the summoner, which is both the largest body and the one kit that
    // keeps making work, is the most valuable base in the game.
    const bases = ENEMY_IDS.filter((id) => !isSubspecies(id));
    expect(bases.every((id) => baseXp(id) <= baseXp("summoner"))).toBe(true);
  });

  it("pays a ranged body more than a melee body of the same health", () => {
    // Constructed rather than found, so the rule is asserted and not a
    // coincidence of the roster's numbers: delver and rifter are both 24 hp.
    expect(ENEMIES.delver.hp).toBe(ENEMIES.rifter.hp);
    expect(baseXp("rifter")).toBeGreaterThan(baseXp("delver"));
  });

  it("gives a subspecies a little more than its base, and never a lot", () => {
    for (const id of ENEMY_IDS.filter(isSubspecies)) {
      const base = baseXp(baseArchetype(id));
      expect(baseXp(id), id).toBeGreaterThanOrEqual(base);
      expect(baseXp(id), id).toBeLessThanOrEqual(Math.ceil(base * 1.3));
    }
  });

  it("pays two and a half for an elite, nothing for the boss, nothing for an add", () => {
    expect(xpForKill("rusher", { elite: true })).toBe(Math.round(baseXp("rusher") * 2.5));
    expect(xpForKill("boss")).toBe(0);
    expect(xpForKill("boss", { elite: true })).toBe(0);
    // The farm the rule exists to close: a summoner's minions are free bodies.
    expect(xpForKill("rusher", { summoned: true })).toBe(0);
    expect(xpForKill("rusher", { summoned: true, elite: true })).toBe(0);
  });

  it("ignores the ramp: a late room's body pays exactly what an early one's does", () => {
    /*
     * The late run already holds more bodies and bigger ones, and its ramp
     * takes a body to more than twice its roster health. Experience that rode
     * that would make the last levels the fastest, which is the opposite of
     * the curve. Asserted through the world, because the world is where the
     * ramp is applied and where the kill is paid for.
     */
    const paid = (roomIndex: number): number => {
      const w = createWorld({
        room: throneHall(), encounter: null, props: 0,
        staff: { slots: 6, mana_max: 120 }, mods: noMods(), roomIndex,
        slots: [plainInstance("magic_bolt"), null, null, null, null, null],
        hearts: 3, rng: new RngSource("ramp-free").stream("w"),
      });
      const e = makeEnemy(w.nextEnemyId++, "tank", 368, 200, [], { hp: 4 });
      e.spawnFadeMs = 0;
      e.hp = 0;
      w.enemies.push(e);
      step(w, NO_INPUT);
      return w.xp;
    };
    expect(paid(1)).toBe(baseXp("tank"));
    expect(paid(16)).toBe(baseXp("tank"));
  });
});

describe("the curve", () => {
  it("puts the first level inside the first room's takings", () => {
    // A measured room is 10 to 14 bodies at 5 to 21 each, so ~70 to 110.
    expect(xpToNext(1)).toBeLessThan(70);
  });

  it("climbs, so the late levels are the slow ones", () => {
    for (let l = 1; l < XP_TO_NEXT.length + 3; l++)
      expect(xpToNext(l + 1), `level ${l + 1}`).toBeGreaterThan(xpToNext(l));
  });

  it("reads a total back as a level and a remainder", () => {
    expect(levelAt(0)).toMatchObject({ level: 1, into: 0 });
    expect(levelAt(xpToNext(1) - 1).level).toBe(1);
    expect(levelAt(xpToNext(1)).level).toBe(2);
    expect(levelAt(xpToNext(1)).into).toBe(0);
    const twoAndABit = xpToNext(1) + xpToNext(2) + 7;
    expect(levelAt(twoAndABit)).toMatchObject({ level: 3, into: 7, toNext: xpToNext(3) });
  });

  it("reaches six to seven levels over a run's worth of kills", () => {
    // The measured `player` run pays about 1150 over its fourteen fights.
    expect(levelAt(1000).level).toBeGreaterThanOrEqual(6);
    expect(levelAt(1300).level).toBeLessThanOrEqual(8);
  });
});

describe("what a level gives", () => {
  it("is derived from the level, never accumulated", () => {
    // The bug this shape exists to prevent: applying the level twice because
    // a world was rebuilt. Two calls with the same level are the same body.
    const once = withLevels(noMods(), 5);
    const twice = withLevels(withLevels(noMods(), 5), 5);
    expect(twice).toEqual(withLevels(once, 5));
    expect(withLevels(noMods(), 1)).toEqual(noMods());
  });

  it("adds half a heart, a whole point of sword and a little bar per level", () => {
    const at7 = withLevels(noMods(), 7);
    expect(at7.maxHearts).toBeCloseTo(LEVEL_HEARTS * 6, 6);
    expect(at7.swordDamage).toBeCloseTo(swordAt(7) / SWING_DAMAGE, 6);
    expect(at7.manaMax).toBeCloseTo((1 + LEVEL_MANA) ** 6, 6);
    // The target the run is tuned to: the boss met at 90 health and a 15 sword.
    expect((MAX_HEARTS + at7.maxHearts) * 10).toBeCloseTo(90, 6);
    expect(swordAt(7)).toBe(SWING_DAMAGE + 6);
  });

  it("moves a number the player can see at every single level", () => {
    /*
     * The bug this exists to stop coming back: the sword's gain was 5%, the
     * damage numbers over a body are whole, and so three levels running
     * printed the same 9. A reward the player cannot see did not happen.
     */
    for (let level = 2; level <= 10; level++) {
      expect(swordAt(level), `sword at ${level}`).toBe(swordAt(level - 1) + 1);
      expect(Number.isInteger(swordAt(level))).toBe(true);
      // Health is whole too, and it is the bar's own unit.
      expect(levelBonus(level).hp - levelBonus(level - 1).hp).toBe(LEVEL_HP);
      // And the mana gauge: a 90-point run staff moves every level once rounded.
      const bar = (l: number) => Math.round(90 * withLevels(noMods(), l).manaMax);
      expect(bar(level), `mana at ${level}`).toBeGreaterThan(bar(level - 1));
    }
  });

  it("leaves `vigour` the best health in the game", () => {
    // A stat card is a decision taken at a door; a level is the floor under
    // the run. If a level matched a card the card would be a worse version of
    // something that happens anyway.
    const vigour = statById("vigour")!;
    expect(applyStat(noMods(), "vigour").maxHearts).toBeGreaterThan(LEVEL_HEARTS);
    expect(vigour.magnitude).toBe(LEVEL_HEARTS * 2);
    // And `keen_edge` still passes a level's point once the flat gains have
    // grown the base it multiplies.
    const keen = statById("keen_edge")!.magnitude;
    expect(keen * swordAt(7)).toBeGreaterThan(LEVEL_SWORD_DAMAGE);
  });

  it("stacks with the cards rather than replacing them", () => {
    const carded = applyStat(applyStat(noMods(), "vigour"), "keen_edge");
    const both = withLevels(carded, 3);
    expect(both.maxHearts).toBeCloseTo(1 + LEVEL_HEARTS * 2, 6);
    expect(both.swordDamage).toBeCloseTo(1.15 * (swordAt(3) / SWING_DAMAGE), 6);
  });
});

describe("the world, levelling as it is played", () => {
  const world = (xp: number) => createWorld({
    room: throneHall(), encounter: null, props: 0,
    staff: { slots: 6, mana_max: 120 }, mods: noMods(), xp,
    slots: [plainInstance("magic_bolt"), null, null, null, null, null],
    hearts: 3, rng: new RngSource("levels").stream("w"),
  });

  it("builds the body from the cards and the experience together", () => {
    const w = world(XP_TO_NEXT[0]!);
    expect(w.level).toBe(2);
    expect(w.player.mods.maxHearts).toBeCloseTo(LEVEL_HEARTS, 6);
    expect(w.baseMods.maxHearts).toBe(0);
  });

  it("pays a kill, reaches the level, and hands back the health it just added", () => {
    const w = world(XP_TO_NEXT[0]! - 1);
    const before = w.player.hearts;
    // A summoner is worth 18: more than the one point left, so the kill levels.
    const e = makeEnemy(w.nextEnemyId++, "summoner", 368, 200, []);
    e.spawnFadeMs = 0;
    e.hp = 0;
    w.enemies.push(e);
    step(w, NO_INPUT);
    expect(w.level).toBe(2);
    expect(w.xp).toBe(XP_TO_NEXT[0]! - 1 + baseXp("summoner"));
    expect(w.player.hearts).toBeCloseTo(before + LEVEL_HEARTS, 6);
    expect(w.events.some((ev) => ev.kind === "level_up" && ev.amount === 2)).toBe(true);
    expect(w.events.some((ev) => ev.kind === "xp" && ev.amount === baseXp("summoner"))).toBe(true);
  });

  it("pays nothing for a summoned body, so a summoner cannot be farmed", () => {
    const w = world(0);
    const e = makeEnemy(w.nextEnemyId++, "rusher", 368, 200, []);
    e.spawnFadeMs = 0;
    e.summoned = true;
    e.hp = 0;
    w.enemies.push(e);
    step(w, NO_INPUT);
    expect(w.xp).toBe(0);
    expect(w.events.some((ev) => ev.kind === "xp")).toBe(false);
  });

  it("never lets the level's health overflow the bar it just grew", () => {
    const w = world(XP_TO_NEXT[0]! - 1);
    w.player.hearts = MAX_HEARTS;
    const e = makeEnemy(w.nextEnemyId++, "summoner", 368, 200, []);
    e.spawnFadeMs = 0;
    e.hp = 0;
    w.enemies.push(e);
    step(w, NO_INPUT);
    expect(w.player.hearts).toBeLessThanOrEqual(MAX_HEARTS + w.player.mods.maxHearts);
    expect(w.player.hearts).toBeCloseTo(MAX_HEARTS + LEVEL_HEARTS, 6);
  });
});

describe("the numbers the copy quotes", () => {
  it("states the health a level gives in the bar's own units", () => {
    // The toast and the character screen both print `LEVEL_HP`; it has to be
    // the health the world actually hands over, in the units the HUD draws.
    expect(LEVEL_HP).toBe(LEVEL_HEARTS * 10);
    expect(Number.isInteger(LEVEL_HP)).toBe(true);
  });
});
