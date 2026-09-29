/**
 * The thrown crescent's drawing, and the frames the spell effects ask the
 * atlas for by name.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SPELL_FX_FRAMES, drawCrescentWave, impactFrame, wavePalette } from "./wave-art.ts";
import { TELE_PIX } from "./telegraph.ts";

const atlas = JSON.parse(readFileSync(new URL("../../../../assets/sprites.json", import.meta.url), "utf8")) as {
  frames: Record<string, unknown>;
};

/** A pen that records the rectangles it is asked for. */
function recorder() {
  const rects: { x: number; y: number; w: number; h: number; colour: number }[] = [];
  let colour = 0;
  const pen = {
    fillStyle: (c: number) => { colour = c; }, fillRect: (x: number, y: number, w: number, h: number) => { rects.push({ x, y, w, h, colour }); },
    lineStyle: () => {}, strokeCircle: () => {}, fillCircle: () => { throw new Error("no discs"); },
    lineBetween: () => { throw new Error("no strokes"); }, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
    arc: () => {}, strokePath: () => {}, fillPath: () => {},
  };
  return { pen, rects };
}

const wave = {
  x: 100, y: 100, radius: 57.6, facing: 0, half: (55 * Math.PI) / 180, thick: 11, life: 1,
  flash: false, tick: 0, seed: 3, palette: wavePalette(0xb9a7ff, 0xf4f0ff),
};

describe("impact frames", () => {
  it("are always a frame the atlas has, however long the impact lives", () => {
    for (let t = -2; t <= 2; t += 0.05) expect(atlas.frames[impactFrame(t)], `t ${t}`).toBeDefined();
  });
  it("every frame the spell effects name exists", () => {
    for (const name of SPELL_FX_FRAMES) expect(atlas.frames[name], name).toBeDefined();
  });
});

describe("the thrown crescent", () => {
  it("is whole texels on the art's grid, and nothing but filled rows", () => {
    const { pen, rects } = recorder();
    drawCrescentWave(pen, wave);
    expect(rects.length).toBeGreaterThan(20);
    for (const r of rects) {
      expect(Math.abs(r.x / TELE_PIX - Math.round(r.x / TELE_PIX))).toBeLessThan(1e-6);
      expect(Math.abs(r.y / TELE_PIX - Math.round(r.y / TELE_PIX))).toBeLessThan(1e-6);
      expect(r.h).toBeCloseTo(TELE_PIX, 9);
    }
  });
  it("stays inside its arc: the leading edge at the radius, the span its half-angle", () => {
    const { pen, rects } = recorder();
    drawCrescentWave(pen, wave);
    for (const r of rects) for (const x of [r.x, r.x + r.w]) {
      const d = Math.hypot(x - wave.x, r.y + TELE_PIX / 2 - wave.y);
      expect(d).toBeLessThanOrEqual(wave.radius + TELE_PIX * 3);
    }
  });
  it("keeps its span as it fades, so it goes on spreading rather than sliding", () => {
    const span = (life: number) => {
      const { pen, rects } = recorder();
      drawCrescentWave(pen, { ...wave, life });
      let most = 0;
      for (const r of rects) for (const x of [r.x, r.x + r.w])
        most = Math.max(most, Math.abs(Math.atan2(r.y + TELE_PIX / 2 - wave.y, x - wave.x)));
      return most;
    };
    expect(span(0.3)).toBeGreaterThan(span(1) * 0.85);
  });
  it("dissolves from the tips: less of it drawn as it fades, and nothing at the end", () => {
    const area = (life: number) => { const { pen, rects } = recorder(); drawCrescentWave(pen, { ...wave, life }); return rects.reduce((a, r) => a + r.w, 0); };
    expect(area(0.5)).toBeLessThan(area(1));
    expect(area(0)).toBe(0);
  });
});
