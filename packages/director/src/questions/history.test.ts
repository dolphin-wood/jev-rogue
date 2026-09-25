/**
 * The counts code keeps for the Director, which Jev cannot keep for itself
 * (findings 5 and 7): what the doors have been doing, and for how long.
 */
import { describe, expect, it } from "vitest";
import { DOOR_STREAK_CAP, doorStreaksSpent, goldOverdue, staleFirst } from "./history.ts";

describe("the door streak the cap is written against", () => {
  it("names nothing until there are enough offers to have a streak", () => {
    const offers = Array.from({ length: DOOR_STREAK_CAP - 1 }, () => ["affix", "spell"]);
    expect(doorStreaksSpent(offers)).toEqual([]);
    expect(doorStreaksSpent(undefined)).toEqual([]);
  });

  /*
   * The bug this file exists for. Two kinds streak together often — with three
   * doors drawn from four kinds, any pair is on most offers — and reading only
   * the first of them let the second run to a fifth offer with the cap at
   * four. Measured on a live run: rooms 1 to 4 all offered spell and affix,
   * spell was withheld, affix went on.
   */
  it("names every kind that was on all of the last few offers, not just the first", () => {
    const offers = [
      ["spell", "stat", "affix"], ["spell", "gold", "affix"],
      ["spell", "affix", "stat"], ["stat", "spell", "affix"],
    ];
    expect(doorStreaksSpent(offers)).toEqual(["spell", "affix"]);
  });

  /*
   * Three can trip it at once, and the caller may only withhold so many before
   * the ranking has nothing to rank. Longest first, so the badge allowed to
   * run on is the one that has run on least.
   */
  it("puts the longest run first", () => {
    const offers = [
      ["spell", "stat"], ["spell", "stat", "affix"],
      ["spell", "affix", "stat"], ["stat", "spell", "affix"], ["spell", "affix", "stat"],
    ];
    expect(doorStreaksSpent(offers)).toEqual(["spell", "stat", "affix"]);
  });

  it("names none where the offers varied", () => {
    expect(doorStreaksSpent([["spell"], ["affix"], ["stat"], ["gold"]])).toEqual([]);
  });
});

describe("the two counts that are rates rather than judgements", () => {
  it("calls gold overdue only once it has been off every recent offer", () => {
    expect(goldOverdue([["spell"], ["affix"]])).toBe(false);
    expect(goldOverdue(Array.from({ length: 5 }, () => ["spell", "affix"]))).toBe(true);
    expect(goldOverdue([["gold"], ["spell"], ["affix"], ["stat"], ["spell"]])).toBe(false);
  });

  it("fills a short ranking from the kind least recently offered", () => {
    expect(staleFirst(["spell", "affix", "stat", "gold"], [
      ["gold", "stat"], ["stat", "affix"], ["affix", "spell"],
    ])[0]).toBe("gold");
  });
});
