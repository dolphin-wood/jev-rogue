import { describe, expect, it } from "vitest";
import { CURSOR_IDLE_MS, CursorHider } from "./cursor.ts";

describe("the pointer, out of the way while the game is played", () => {
  it("goes at a key press and comes back when the mouse moves", () => {
    const h = new CursorHider();
    h.move(0);
    expect(h.visible(10)).toBe(true);
    h.key();
    expect(h.visible(20)).toBe(false);
    h.move(30);
    expect(h.visible(40)).toBe(true);
  });

  it("goes once the mouse has lain still long enough", () => {
    const h = new CursorHider();
    h.move(0);
    expect(h.visible(CURSOR_IDLE_MS - 1)).toBe(true);
    expect(h.visible(CURSOR_IDLE_MS)).toBe(false);
  });

  it("stays while a button is held, and starts the idle wait when it is let go", () => {
    const h = new CursorHider();
    h.press(true, 0);
    h.key();
    expect(h.visible(CURSOR_IDLE_MS * 3)).toBe(true);
    h.press(false, 5000);
    expect(h.visible(5000 + CURSOR_IDLE_MS - 1)).toBe(true);
    expect(h.visible(5000 + CURSOR_IDLE_MS)).toBe(false);
  });
});
