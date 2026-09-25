import { describe, expect, it } from "vitest";
import { OBSERVED_CUTS, UNMEASURED, emptyMeasure, observedLabels } from "./observed.ts";
import type { RoomMeasure } from "./observed.ts";

const fight = (over: Partial<RoomMeasure> = {}): RoomMeasure =>
  ({ ...emptyMeasure(), elapsedMs: 60_000, ...over });

describe("the observed labels (doc 002: facts, not verdicts)", () => {
  it("says nothing about a run that has not fought", () => {
    expect(observedLabels([])).toEqual({ ...UNMEASURED, hurt_by: "nothing" });
  });

  it("counts a refusal against the presses, not against the casts", () => {
    expect(observedLabels([fight({ castPresses: 100, castRefusedMana: 0 })]).mana_refused).toBe("never");
    expect(observedLabels([fight({ castPresses: 100, castRefusedMana: 8 })]).mana_refused).toBe("sometimes");
    expect(observedLabels([fight({ castPresses: 100, castRefusedMana: 30 })]).mana_refused).toBe("often");
  });

  /*
   * The bar almost never empties; it sits in single figures and refuses
   * because what is left will not pay for the key. So the measure is time
   * under the cheapest key's cost, not time at zero.
   */
  it("reads the empty bar as time under the cheapest key", () => {
    expect(observedLabels([fight({ manaBelowKeyMs: 0 })]).mana_short_time).toBe("little");
    expect(observedLabels([fight({ manaBelowKeyMs: 60_000 * OBSERVED_CUTS.manaShortSome })]).mana_short_time).toBe("some");
    expect(observedLabels([fight({ manaBelowKeyMs: 60_000 * 0.9 })]).mana_short_time).toBe("most");
  });

  it("lets a shot hit more than one body", () => {
    expect(observedLabels([fight({ shotsFired: 100, shotHits: 20 })]).hits_per_shot).toBe("few");
    expect(observedLabels([fight({ shotsFired: 100, shotHits: 80 })]).hits_per_shot).toBe("one");
    expect(observedLabels([fight({ shotsFired: 100, shotHits: 250 })]).hits_per_shot).toBe("several");
  });

  it("names the family that took the most health, and nothing when none did", () => {
    expect(observedLabels([fight()]).hurt_by).toBe("nothing");
    expect(observedLabels([fight({ hurtByRanged: 3, hurtByMelee: 1 })]).hurt_by).toBe("shots");
    expect(observedLabels([fight({ hurtByRanged: 1, hurtByMelee: 4 })]).hurt_by).toBe("blades");
    expect(observedLabels([fight({ hurtByHazard: 2 })]).hurt_by).toBe("hazards");
  });

  /* One room is a sample of one; the window is the last two, as `recent_damage` is. */
  it("reads the last two fights and no more", () => {
    const quiet = fight({ castPresses: 100, castRefusedMana: 0 });
    const starved = fight({ castPresses: 100, castRefusedMana: 40 });
    expect(observedLabels([starved, quiet, quiet]).mana_refused).toBe("never");
    expect(observedLabels([quiet, quiet, starved]).mana_refused).toBe("often");
  });
});
