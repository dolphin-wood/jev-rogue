import { describe, expect, it } from "vitest";
import { seenHintsOf, withShown } from "./seen-hints.ts";

describe("which of the key guide a player has seen", () => {
  it("has seen none on a first visit, or with only the old one-flag save", () => {
    expect(seenHintsOf(null).size).toBe(0);
  });

  it("keeps what it was shown, and a broken save shows the guide again", () => {
    const saved = withShown(seenHintsOf(null), ["walk", "dodge"]);
    expect([...seenHintsOf(withShown(seenHintsOf(saved), ["assists"]))].sort()).toEqual(["assists", "dodge", "walk"]);
    expect(seenHintsOf("{not json").size).toBe(0);
  });
});
