/**
 * The king's two meetings (doc 022): the first audience is phase I and ends in
 * his leaving at the retreat's line; the final opens in a short phase I on a larger
 * bar. What each asserts is a promise the document makes to the player.
 */
import { describe, expect, it } from "vitest";
import { beginKingEntrance, createWorld, hurtEnemy, step, worldCleared } from "./world.ts";
import { kingFloorHp, makeKing } from "./enemy.ts";
import { NO_INPUT, noMods } from "./types.ts";
import type { World } from "./types.ts";
import { throneHall } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import { KING_AUDIENCE_XP } from "../run/levels.ts";
import {
  bossPhaseAt, kingMarks, kingPhaseStart, ENEMIES, KING_AUDIENCE_HP, KING_FINAL_HP, KING_FINAL_II_AT, KING_FINAL_III_AT, KING_RETREAT_AT,
} from "../encounters/enemies.ts";

function hall(seed: string): World {
  return createWorld({
    room: throneHall(), encounter: null, props: 0, staff: { slots: 6, mana_max: 120 }, mods: noMods(),
    slots: [plainInstance("magic_bolt"), null, null, null, null, null], hearts: 6, rng: new RngSource(seed).stream("w"),
  });
}

function stepUntil(w: World, done: () => boolean, maxSteps = 60 * 30): number {
  for (let i = 0; i < maxSteps; i++) {
    if (done()) return i;
    step(w, NO_INPUT);
  }
  return -1;
}

describe("the king's scripts: phases", () => {
  it("leaves the unscripted fight exactly as it was", () => {
    expect(bossPhaseAt(0.61)).toBe(1);
    expect(bossPhaseAt(0.6)).toBe(2);
    expect(bossPhaseAt(0.3)).toBe(3);
    expect(makeKing(1, 0, 0).maxHp).toBe(ENEMIES.boss.hp);
  });

  it("plays the first audience in phase I until the retreat's line", () => {
    expect(bossPhaseAt(1, "audience")).toBe(1);
    expect(bossPhaseAt(KING_RETREAT_AT + 0.01, "audience")).toBe(1);
    // The change at the line is the armour breaking; what follows it is his leaving, never phase III.
    expect(bossPhaseAt(KING_RETREAT_AT, "audience")).toBe(2);
    expect(bossPhaseAt(0.01, "audience")).toBe(2);
    const k = makeKing(1, 0, 0, "audience");
    expect(k.maxHp).toBe(KING_AUDIENCE_HP);
    expect(k.phase).toBe(1);
    expect(kingFloorHp(k)).toBe(Math.ceil(KING_AUDIENCE_HP * KING_RETREAT_AT));
  });

  it("opens the final in a short phase I, in the armour the throne shows, then II and III", () => {
    const k = makeKing(1, 0, 0, "final");
    expect(k.maxHp).toBe(KING_FINAL_HP);
    expect(k.hp).toBe(KING_FINAL_HP);
    expect(k.phase).toBe(1);
    expect(kingFloorHp(k)).toBe(0);
    expect(bossPhaseAt(1, "final")).toBe(1);
    expect(bossPhaseAt(KING_FINAL_II_AT + 0.01, "final")).toBe(1);
    expect(bossPhaseAt(KING_FINAL_II_AT, "final")).toBe(2);
    expect(bossPhaseAt(KING_FINAL_III_AT + 0.01, "final")).toBe(2);
    expect(bossPhaseAt(KING_FINAL_III_AT, "final")).toBe(3);
    // Phase I is the short stretch; II and III are the fight's weight.
    expect(1 - KING_FINAL_II_AT).toBeLessThan(KING_FINAL_II_AT - KING_FINAL_III_AT);
  });

  it("marks each script's own changes on the bar", () => {
    expect(kingMarks("final")).toEqual([KING_FINAL_II_AT, KING_FINAL_III_AT]);
    expect(kingMarks("audience")).toEqual([KING_RETREAT_AT]);
    expect(kingMarks()).toEqual([0.6, 0.3]);
    expect(kingPhaseStart("final", 1)).toBe(1);
    expect(kingPhaseStart("final", 2)).toBe(KING_FINAL_II_AT);
    expect(kingPhaseStart("final", 3)).toBe(KING_FINAL_III_AT);
    expect(kingPhaseStart(undefined, 2)).toBe(0.6);
  });

  it("breaks the final's armour at its line with the roar and phase II's call, as the fight always has", () => {
    const w = hall("final-break");
    const k = makeKing(w.nextEnemyId++, 368, 200, "final");
    k.spawnFadeMs = 0; k.awake = true;
    w.enemies.push(k);
    step(w, NO_INPUT);
    k.hp = Math.floor(KING_FINAL_HP * KING_FINAL_II_AT);
    step(w, NO_INPUT);
    expect(k.phase).toBe(2);
    expect(k.bossRoarMs).toBeGreaterThan(0);
  });
});

describe("the king's scripts: the first audience's end", () => {
  it("can't be killed: a blow past the line is held on it, and he roars", () => {
    const w = hall("audience-hold");
    const k = makeKing(w.nextEnemyId++, 368, 200, "audience");
    k.spawnFadeMs = 0; k.awake = true;
    w.enemies.push(k);
    step(w, NO_INPUT);
    hurtEnemy(w, k, KING_AUDIENCE_HP * 10);
    step(w, NO_INPUT);
    expect(w.enemies).toContain(k);
    expect(k.hp).toBeGreaterThanOrEqual(kingFloorHp(k));
    step(w, NO_INPUT);
    expect(k.phase).toBe(2);
    expect(k.bossRoarMs).toBeGreaterThan(0);
    // Through the roar nothing lands.
    expect(hurtEnemy(w, k, 100).blocked).toBe(true);
  });

  it("goes up out of the room after the roar, and the room clears behind him", () => {
    const w = hall("audience-leave");
    const k = makeKing(w.nextEnemyId++, 368, 200, "audience");
    k.spawnFadeMs = 0; k.awake = true;
    w.enemies.push(k);
    step(w, NO_INPUT);
    k.hp = kingFloorHp(k);
    const xp0 = w.xp;
    const saw: string[] = [];
    let killed = false;
    const gone = stepUntil(w, () => {
      for (const ev of w.events) {
        if (ev.what === "boss_retreat" || ev.what === "boss_gone") saw.push(ev.what!);
        if (ev.kind === "enemy_killed") killed = true;
      }
      return !w.enemies.includes(k);
    });
    expect(gone).toBeGreaterThan(0);
    expect(saw).toEqual(["boss_retreat", "boss_gone"]);
    // Gone, not killed: nothing a death pays.
    expect(killed).toBe(false);
    // Driven off, not killed: the room still pays, and it pays for him (doc 022).
    expect(w.xp).toBe(xp0 + KING_AUDIENCE_XP);
    expect(worldCleared(w)).toBe(true);
    stepUntil(w, () => w.cleared, 5);
    expect(w.cleared).toBe(true);
  });
});

describe("the king's scripts: the entrance", () => {
  it("comes down on his mark and hurts nobody: no band, no struck ground", () => {
    const w = hall("audience-drop");
    const k = makeKing(w.nextEnemyId++, 0, 0, "audience");
    w.enemies.push(k);
    // The player stands a long way off; the entrance's landing reaches nothing.
    w.player.x = 100; w.player.y = 200;
    beginKingEntrance(k, 600, 200);
    const hearts = w.player.hearts;
    let arrived = false;
    stepUntil(w, () => {
      if (w.events.some((ev) => ev.what === "boss_arrives")) arrived = true;
      return arrived;
    });
    expect(arrived).toBe(true);
    expect(k.airborne).toBe(false);
    expect(w.shockwaves).toHaveLength(0);
    expect(w.player.hearts).toBe(hearts);
    // He drives the sword in and kneels on it, rises, and comes on a beat later: no standing about.
    stepUntil(w, () => k.bossCast === "none");
    expect(k.bossEntrance).toBe(false);
    expect(k.bossMoveMs).toBeLessThan(500);
  });
});
