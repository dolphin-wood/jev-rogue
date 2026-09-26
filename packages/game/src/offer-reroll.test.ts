import { describe, expect, it } from "vitest";
import type { CardPool } from "@jr/core";
import { freshRerollPool, rerollPrice } from "./offer-reroll.ts";

const card = (id: string, promised = false) => ({
  id, description: id, facts: promised ? ["promised" as const] : [],
});

describe("paid offer rerolls", () => {
  it("raises the price for each reroll across rewards and shops", () => {
    expect([0, 1, 2, 3].map(rerollPrice)).toEqual([16, 32, 64, 128]);
  });

  it("keeps unseen choices in the Director pool when a fully fresh offer is possible", () => {
    const pool: CardPool = { kind: "spell", forced: [],
      candidates: [card("shown"), card("a", true), card("b"), card("c"), card("d")],
      guarantee: [["shown", "a"], ["b", "c"]],
    };
    const result = freshRerollPool(pool, ["shown"], 3);
    expect(result?.candidates.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(result?.guarantee).toEqual([["a"], ["b", "c"]]);
  });

  it("uses a few old cards only when needed to preserve the promise and both groups", () => {
    const pool: CardPool = { kind: "spell", forced: [],
      candidates: [card("old-upgrade", true), card("old-new"), card("fresh-new")],
      guarantee: [["old-upgrade"], ["old-new", "fresh-new"]],
    };
    const result = freshRerollPool(pool, ["old-upgrade", "old-new"], 3);
    expect(result?.candidates.map((c) => c.id)).toEqual(["fresh-new", "old-upgrade", "old-new"]);
    expect(result?.guarantee).toEqual([["old-upgrade"], ["old-new", "fresh-new"]]);
  });

  it("lets a one-card merchant shelf refresh even when a full-staff pool has two groups", () => {
    const pool: CardPool = { kind: "spell", forced: [],
      candidates: [card("upgrade"), card("new")], guarantee: [["upgrade"], ["new"]],
    };
    expect(freshRerollPool(pool, ["upgrade"], 1)?.candidates.map((c) => c.id)).toEqual(["new"]);
    expect(freshRerollPool(pool, ["upgrade"], 1)?.guarantee).toBeUndefined();
    expect(freshRerollPool(pool, ["upgrade", "new"], 1)).toBeNull();
  });
});
