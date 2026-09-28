import { describe, expect, it } from "vitest";
import { energyElements, energyTurn, swordEnergyLook } from "./spell-look.ts";

describe("sword energy's colours", () => {
  it("lists every element it carries, in a fixed order, and plain when none", () => {
    expect(energyElements({ fire: 0.5, ice: 0.5, poison: 0 })).toEqual(["fire", "ice"]);
    expect(energyElements({ poison: 1, fire: 0.2 })).toEqual(["fire", "poison"]);
    expect(energyElements({})).toEqual(["none"]);
    expect(energyElements(undefined, "ice")).toEqual(["ice"]);
  });

  it("takes turns equally, whatever each is worth", () => {
    const els = energyElements({ fire: 2, ice: 0.1 });
    expect([0, 1, 2, 3].map((t) => energyTurn(els, t))).toEqual(["fire", "ice", "fire", "ice"]);
    expect(energyTurn(["fire", "ice", "poison"], 4.9)).toBe("ice");
  });

  it("wears the element's light, and the spell's own when plain", () => {
    expect(swordEnergyLook("crescent_edge", "fire").glow).not.toBe(swordEnergyLook("crescent_edge", "none").glow);
    expect(swordEnergyLook("crescent_edge", "none")).toEqual(swordEnergyLook("crescent_edge", "none"));
  });
});
