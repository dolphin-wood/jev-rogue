import { describe, expect, it } from "vitest";
import { LEGACY_HINTS, seenHintsOf, withShown } from "./seen-hints.ts";

describe("which of the key guide a player has seen", () => {
  it("has seen none on a first visit", () => {
    expect(seenHintsOf(null, null).size).toBe(0);
  });

  it("reads the old one flag as the guide as it stood, so a row added since is new", () => {
    const seen = seenHintsOf(null, "1");
    for (const id of LEGACY_HINTS) expect(seen.has(id)).toBe(true);
    expect(seen.has("a_row_added_later")).toBe(false);
  });

  it("keeps what it was shown, and a broken save shows the guide again", () => {
    const saved = withShown(seenHintsOf(null, null), ["walk", "dodge"]);
    expect([...seenHintsOf(withShown(seenHintsOf(saved, null), ["assists"]), null)].sort()).toEqual(["assists", "dodge", "walk"]);
    expect(seenHintsOf("{not json", null).size).toBe(0);
  });
});
