import { describe, expect, it } from "vitest";
import { ACTIONS, DEFAULT_BINDINGS, Keybinds, labelOfKey } from "./keybinds.ts";

const codes = (k: Keybinds) => ACTIONS.map((a) => k.get(a).code);

describe("keybinds", () => {
  it("starts on the shipped layout, one key per action", () => {
    const k = new Keybinds();
    expect(k.isDefault()).toBe(true);
    expect(k.label("attack")).toBe("J");
    expect(k.label("autoCast")).toBe("Space");
    expect(new Set(codes(k)).size).toBe(ACTIONS.length);
  });

  it("swaps a key another action held, so no key is on two and none is left without", () => {
    const k = new Keybinds();
    const r = k.set("autoCast", { code: 186, label: ";" });
    expect(r).toEqual({ ok: true, swapped: null });
    expect(k.label("autoCast")).toBe(";");
    // J is the sword's: the sword takes the dash's old K.
    expect(k.set("dash", { code: 74, label: "J" })).toEqual({ ok: true, swapped: "attack" });
    expect(k.label("dash")).toBe("J");
    expect(k.label("attack")).toBe("K");
    expect(new Set(codes(k)).size).toBe(ACTIONS.length);
  });

  it("refuses the menus' own keys: Enter, Esc, the arrows", () => {
    const k = new Keybinds();
    for (const code of [13, 27, 37, 38, 39, 40]) expect(k.set("up", { code, label: "x" }).ok).toBe(false);
    expect(k.label("up")).toBe("W");
  });

  it("round-trips through what it saves, and resets", () => {
    const k = new Keybinds();
    k.set("autoCast", { code: 186, label: ";" });
    k.set("up", { code: 69, label: "E" });
    const back = new Keybinds(k.serialize());
    expect(ACTIONS.map((a) => back.get(a))).toEqual(ACTIONS.map((a) => k.get(a)));
    back.reset();
    expect(back.isDefault()).toBe(true);
  });

  it("falls back to the defaults on a save it cannot trust", () => {
    expect(new Keybinds("not json").isDefault()).toBe(true);
    // A reserved key and a doubled key are each dropped; the rest of the save stands.
    const saved = JSON.stringify({ attack: { code: 13, label: "Enter" }, dash: { code: 186, label: ";" }, spin: { code: 186, label: ";" } });
    const k = new Keybinds(saved);
    expect(k.label("attack")).toBe("J");
    expect(k.label("dash")).toBe(";");
    expect(k.label("spin")).toBe("L");
    // A saved key on another action's default pushes that action onto a free default.
    const clash = new Keybinds(JSON.stringify({ dash: { code: 74, label: "J" } }));
    expect(clash.label("dash")).toBe("J");
    expect(clash.get("attack").code).not.toBe(74);
    expect(new Set(codes(clash)).size).toBe(ACTIONS.length);
    expect(ACTIONS.every((a) => Object.values(DEFAULT_BINDINGS).some((d) => d.code === clash.get(a).code) || a === "dash")).toBe(true);
  });

  it("labels a key by what it prints, so a JIS board reads as its own", () => {
    expect(labelOfKey({ key: " " })).toBe("Space");
    expect(labelOfKey({ key: ";", code: "Semicolon" })).toBe(";");
    expect(labelOfKey({ key: "q", code: "KeyQ" })).toBe("Q");
    expect(labelOfKey({ key: "Shift", code: "ShiftLeft" })).toBe("Shift");
    expect(labelOfKey({ key: "1", code: "Numpad1" })).toBe("Num1");
  });
});
