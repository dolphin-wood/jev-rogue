/**
 * **The drawing is the hitbox.**
 *
 * The boss's two new floor threats — the travelling shockwave and the rotating
 * arm — are drawn by hand out of the sim's own numbers, and a drawing that is
 * a few pixels wider or narrower than the thing it stands for is a lie the
 * player pays for. There is no way for the simulation to catch that, because
 * the simulation never looks at the drawing; so the drawing is run here
 * against a recording pen and every cell it puts down is checked against the
 * same predicate the sim hits with (`shockwaveHits`, `armHits`).
 *
 * The other thing checked here is that the shockwave is a **circle**. It is
 * scan-converted, and a scan conversion is exactly where a circle quietly
 * turns into an ellipse: two different quantisations on the two axes, or a
 * half-cell offset applied to one of them, and the ring is 2% wider than it is
 * tall for the rest of the game's life.
 */
import { describe, it, expect } from "vitest";
import { armHits, shockwaveHits, ARM_TELE_MS } from "@jr/core";
import type { Arm, Shockwave } from "@jr/core";
import { drawArms, drawShockwaves, SHOCK_PIX } from "./ground.ts";
import type { Pen } from "./ground.ts";

interface Cell { x: number; y: number; w: number; h: number }

/** A pen that records the blocks the pixel drawings put down, and nothing else. */
function recorder(): { pen: Pen; cells: Cell[] } {
  const cells: Cell[] = [];
  const pen: Pen = {
    lineStyle: () => pen,
    fillStyle: () => pen,
    strokeCircle: () => pen,
    fillCircle: () => pen,
    fillRect: (x, y, w, h) => { cells.push({ x, y, w, h }); return pen; },
    lineBetween: () => pen,
    beginPath: () => pen,
    moveTo: () => pen,
    lineTo: () => pen,
    arc: () => pen,
    strokePath: () => pen,
    fillPath: () => pen,
  };
  return { pen, cells };
}

/** Every drawn cell's centre. */
function centres(cells: readonly Cell[]): [number, number][] {
  return cells.map((c) => [c.x + c.w / 2, c.y + c.h / 2]);
}

const VIEW = { x0: -400, y0: -400, x1: 400, y1: 400 };

function wave(inner: number): Shockwave {
  return {
    alive: true, x: 0, y: 0, chargeMs: 0, chargeMaxMs: 520,
    inner, thickness: 34, speed: 260, maxRadius: 400, damage: 1, struck: false,
  };
}

describe("the shockwave's drawing", () => {
  it("is a true circle: as wide as it is tall, at every radius", () => {
    for (const inner of [64, 120, 240]) {
      const s = wave(inner);
      const g = recorder();
      const glow = recorder();
      drawShockwaves(g.pen, glow.pen, [s], 0, VIEW);
      // Measured on the leading edge, which is the line the player reads and
      // the only part of the drawing whose position is a promise. The soil
      // layer also carries thrown debris, which is deliberately off the band.
      const pts = centres(glow.cells);
      const xs = pts.map(([x]) => x);
      const ys = pts.map(([, y]) => y);
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);
      // Within a cell either way: any more and it is an ellipse.
      expect(Math.abs(width - height)).toBeLessThanOrEqual(SHOCK_PIX * 2);
      // And it is the band's own outer radius, not some drawn approximation.
      expect(Math.abs(width / 2 - (s.inner + s.thickness))).toBeLessThanOrEqual(SHOCK_PIX * 2);
    }
  });

  it("puts nothing outside the band the sim hits with", () => {
    const s = wave(120);
    const g = recorder();
    const glow = recorder();
    drawShockwaves(g.pen, glow.pen, [s], 0, VIEW);
    // The soil layer minus the debris and dust, which are deliberately thrown
    // clear of the band; the glow layer is the leading edge and must be on it.
    const outer = s.inner + s.thickness;
    let off = 0;
    for (const [x, y] of centres(g.cells)) {
      const d = Math.hypot(x - s.x, y - s.y);
      // A cell may hang one cell either side of the band: it is a cell wide.
      if (d < s.inner - SHOCK_PIX * 2 || d > outer + SHOCK_PIX * 2) off++;
    }
    // Under a tenth: the debris and dust, and nothing else.
    expect(off / g.cells.length).toBeLessThan(0.1);
    for (const [x, y] of centres(glow.cells))
      expect(shockwaveHits(s, x, y, SHOCK_PIX * 2)).toBe(true);
  });

  it("covers the whole band, so the drawing is not narrower than the hit", () => {
    const s = wave(120);
    const g = recorder();
    const glow = recorder();
    drawShockwaves(g.pen, glow.pen, [s], 0, VIEW);
    const drawn = new Set(g.cells.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`));
    // Sixty bearings, three depths each: every one should be inside a block.
    let covered = 0;
    let total = 0;
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      for (const f of [0.15, 0.5, 0.85]) {
        const r = s.inner + s.thickness * f;
        const x = Math.round(Math.cos(a) * r);
        const y = Math.round(Math.sin(a) * r);
        total++;
        // Any drawn block within a cell of the sample.
        const near = g.cells.some((c) => x >= c.x - 1 && x <= c.x + c.w + 1 && y >= c.y - 1 && y <= c.y + c.h + 1);
        if (near) covered++;
      }
    }
    expect(drawn.size).toBeGreaterThan(100);
    expect(covered / total).toBeGreaterThan(0.99);
  });
});

function arm(angle: number, teleMs = 0): Arm {
  return {
    alive: true, owner: 1, x: 0, y: 0, angle, spin: 2.7,
    inner: 11, length: 120, width: 20,
    teleMs, teleMaxMs: ARM_TELE_MS, activeMs: 1400, activeMaxMs: 2000,
    damage: 0.65, hitCooldownMs: 0,
  };
}

describe("the rotating arm's drawing", () => {
  it("draws only steel that cuts, at every angle", () => {
    for (let i = 0; i < 8; i++) {
      const a = arm((i / 8) * Math.PI * 2 + 0.17);
      const g = recorder();
      const glow = recorder();
      drawArms(g.pen, glow.pen, [a]);
      for (const [x, y] of centres(g.cells)) {
        // A cell of slack for the grid, and none for the shape.
        expect(armHits(a, x, y, SHOCK_PIX)).toBe(true);
      }
    }
  });

  it("draws the whole limb, so its reach is not understated", () => {
    const a = arm(0.9);
    const g = recorder();
    const glow = recorder();
    drawArms(g.pen, glow.pen, [a]);
    const ux = Math.cos(a.angle);
    const uy = Math.sin(a.angle);
    for (let d = a.inner; d <= a.length; d += 4)
      for (const off of [-a.width / 2 + 2, 0, a.width / 2 - 2]) {
        const x = ux * d - uy * off;
        const y = uy * d + ux * off;
        const near = g.cells.some((c) => x >= c.x - 1 && x <= c.x + c.w + 1 && y >= c.y - 1 && y <= c.y + c.h + 1);
        expect(near).toBe(true);
      }
  });

  it("draws an outline and nothing solid while it is still being read", () => {
    const area = (cells: readonly Cell[]): number => cells.reduce((n, c) => n + c.w * c.h, 0);
    const telegraph = recorder();
    const glow = recorder();
    drawArms(telegraph.pen, glow.pen, [arm(0.9, ARM_TELE_MS * 0.5)]);
    const live = recorder();
    const glow2 = recorder();
    drawArms(live.pen, glow2.pen, [arm(0.9, 0)]);
    // A hollow limb covers a fraction of a filled one: the telegraph has to
    // be plainly not-yet-steel at a glance, not a dimmer copy of the hit.
    expect(area(telegraph.cells) * 3).toBeLessThan(area(live.cells));
  });
});
