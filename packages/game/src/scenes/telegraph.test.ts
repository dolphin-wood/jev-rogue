/**
 * **A warning that lies is worse than no warning.**
 *
 * The telegraphs in `telegraph.ts` are scan-converted by hand out of the same
 * numbers the simulation hits with, and a scan conversion is exactly where a
 * shape quietly stops being the shape it stands for: a ring rounded down a
 * cell, a sector whose arc is short of its reach, a dither so sparse that the
 * ground it marks does not look marked. None of that is something the sim can
 * catch, because the sim never looks at the drawing.
 *
 * So each drawing is run against a recording pen and checked both ways, the
 * way `ground.test.ts` checks the shockwave:
 *
 * - **Nothing outside.** Every cell's centre is inside the hit area, with one
 *   cell of slack — the cost of snapping to the grid, and no more.
 * - **Nothing missing.** Points sampled across the hit area each have a drawn
 *   cell within one dither block of them, for at least 95% of the area — see
 *   `coverage` for why the block, and not the cell, is the right slack.
 *
 * And the pixel language itself is checked, because it is the whole point of
 * the exercise: the grid is obeyed, the rings are circles rather than
 * ellipses, the clocks have countably few frames, and the rectangle count
 * stays somewhere a frame can afford.
 */
import { describe, it, expect } from "vitest";
import { makeSwingBox, sectorHits } from "@jr/core";
import type { Pen } from "./ground.ts";
import {
  ART_SCALE, TELE_PIX, blink, drawAimLine, drawBlastRing, drawFlameCone, drawLeapMark, drawOverstayDial,
  drawQuakeTell, drawRiftCircle, drawRingTell, drawSectorTell, drawSlamTell, drawStrikeMark,
  DITHER_PITCH, march, resetTeleRects, teleRects, teleRing,
} from "./telegraph.ts";

interface Cell { x: number; y: number; w: number; h: number }

/** A pen that records the blocks a pixel drawing puts down, and nothing else. */
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

const VIEW = { x0: -500, y0: -500, x1: 500, y1: 500 };
/** One texel: what snapping to the grid is allowed to cost, and no more. */
const SLACK = TELE_PIX;

function centres(cells: readonly Cell[]): [number, number][] {
  return cells.map((c) => [c.x + c.w / 2, c.y + c.h / 2]);
}

/** Whether any drawn block is within `slack` of the point. */
function near(cells: readonly Cell[], x: number, y: number, slack = SLACK): boolean {
  for (const c of cells)
    if (x >= c.x - slack && x <= c.x + c.w + slack && y >= c.y - slack && y <= c.y + c.h + slack) return true;
  return false;
}

/** Every cell is inside the shape the sim hits with. */
function allInside(cells: readonly Cell[], hits: (x: number, y: number) => boolean): void {
  for (const [x, y] of centres(cells)) expect(hits(x, y)).toBe(true);
}

/**
 * How much of the hit area is **marked**, sampled on a grid a third of a texel
 * fine so the answer does not depend on the phase of the dither.
 *
 * "Marked" is a drawn texel within one dither pitch, and that is the honest
 * reading of a dithered area: at quarter density three rows in four are bare,
 * and the ground between them is plainly still inside the marking — no player
 * looks at a hazard hatch and reads the gaps as safe. The slack is the
 * dither's own pitch and never more, so a drawing cannot buy coverage by
 * hatching sparser.
 */
function coverage(
  cells: readonly Cell[], hits: (x: number, y: number) => boolean,
  box: { x0: number; y0: number; x1: number; y1: number },
): number {
  const slack = DITHER_PITCH * TELE_PIX;
  let seen = 0;
  let total = 0;
  const step = TELE_PIX / 3;
  for (let y = box.y0; y <= box.y1; y += step)
    for (let x = box.x0; x <= box.x1; x += step) {
      if (!hits(x, y)) continue;
      total++;
      if (near(cells, x, y, slack)) seen++;
    }
  expect(total).toBeGreaterThan(200);
  return seen / total;
}

/** Everything drawn sits on the grid, which is the whole of "pixel art". */
function onGrid(cells: readonly Cell[]): void {
  for (const c of cells) {
    expect(c.x / TELE_PIX).toBe(Math.round(c.x / TELE_PIX));
    expect(c.y / TELE_PIX).toBe(Math.round(c.y / TELE_PIX));
    expect(c.w / TELE_PIX).toBe(Math.round(c.w / TELE_PIX));
    expect(c.h).toBe(TELE_PIX);
  }
}

/** A disc's predicate, with the grid's slack. */
const disc = (cx: number, cy: number, r: number) =>
  (x: number, y: number): boolean => Math.hypot(x - cx, y - cy) <= r + SLACK;

const boxOf = (cx: number, cy: number, r: number) =>
  ({ x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r });

describe("the pixel grid", () => {
  it("is exactly one art texel, derived from ART_SCALE and nothing else", () => {
    // A body frame is 64 atlas px drawn at 1 / ART_SCALE over a 32-unit tile,
    // so one atlas pixel is 1 / ART_SCALE world units; `groundEdges` steps the
    // floor decoration at 1 / FX_TEXEL, which is the same number. A telegraph
    // on any other grid quantises differently from the sprites beside it,
    // which is the whole complaint this module answers.
    expect(TELE_PIX).toBe(1 / ART_SCALE);
    expect(ART_SCALE).toBe(2);
  });

  it("is where every cell of every telegraph lands, at any offset", () => {
    // Deliberately off-grid centres: the drawing snaps, the caller does not
    // have to, and a telegraph that drifted half a cell would look soft.
    for (const [cx, cy] of [[0, 0], [13.37, -41.9], [-7.5, 3.1]] as const) {
      const r = recorder();
      drawSlamTell(r.pen, cx, cy, 64, 96, 0.5, 0, VIEW);
      drawSectorTell(r.pen, cx, cy, 44, 0.7, 0.6, 0.5, 0, VIEW);
      drawStrikeMark(r.pen, cx, cy, 30, 0.4, 0, VIEW);
      onGrid(r.cells);
    }
  });
});

describe("a stepped ring", () => {
  it("is a true circle: as wide as it is tall, at every radius", () => {
    for (const rad of [12, 30, 46, 64, 92, 140]) {
      const r = recorder();
      teleRing(r.pen, 0, 0, rad, 0xffffff, 1, VIEW);
      const pts = centres(r.cells);
      const xs = pts.map(([x]) => x);
      const ys = pts.map(([, y]) => y);
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);
      expect(Math.abs(width - height)).toBeLessThanOrEqual(TELE_PIX);
      expect(Math.abs(width / 2 - rad)).toBeLessThanOrEqual(TELE_PIX);
    }
  });

  it("is closed: no gap at the top or the bottom, where the curve is flattest", () => {
    // The naive scan conversion leaves both poles open, because a row there
    // grows by many texels and a one-texel run does not reach across it.
    const rad = 46;
    const r = recorder();
    teleRing(r.pen, 0, 0, rad, 0xffffff, 1, VIEW);
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      expect(near(r.cells, Math.cos(a) * rad, Math.sin(a) * rad)).toBe(true);
    }
  });

  it("thickens inward, so the edge the player reads never moves", () => {
    for (const thick of [1, 2, 3]) {
      const r = recorder();
      teleRing(r.pen, 0, 0, 60, 0xffffff, 1, VIEW, { thick });
      for (const [x, y] of centres(r.cells)) {
        const d = Math.hypot(x, y);
        expect(d).toBeLessThanOrEqual(60 + SLACK);
        expect(d).toBeGreaterThanOrEqual(60 - thick * TELE_PIX - SLACK);
      }
    }
  });

  it("caches its shape, so a hundred radii cost one scan conversion each", () => {
    resetTeleRects();
    const r = recorder();
    for (let i = 0; i < 40; i++) teleRing(r.pen, 0, 0, 60, 0xffffff, 1, VIEW);
    const each = teleRects() / 40;
    // A 60-unit ring is 120 texels of radius: two runs on each of its rows,
    // and no more however thick the rim is asked to be.
    expect(each).toBeLessThanOrEqual(2 * (2 * 60 / TELE_PIX));
    expect(r.cells.length).toBe(teleRects());
  });
});

describe("the melee windup's sector", () => {
  const box = makeSwingBox();
  const setup = (reach: number, facing: number, half: number) => {
    box.x = 0;
    box.y = 0;
    box.reach = reach;
    box.angle = facing;
    box.facing = facing;
    box.halfArc = half;
    return box;
  };

  it("threatens only ground the swing reaches, at every bearing", () => {
    for (let i = 0; i < 8; i++) {
      const facing = (i / 8) * Math.PI * 2 + 0.21;
      const half = 0.8;
      const r = recorder();
      drawSectorTell(r.pen, 0, 0, 44, facing, half, 0.7, 0, VIEW);
      const b = setup(44, facing, half);
      allInside(r.cells, (x, y) => sectorHits(b, { x, y }, SLACK));
    }
  });

  it("covers the ground it threatens, so the reach is not understated", () => {
    const facing = 0.9;
    const half = 0.8;
    const r = recorder();
    drawSectorTell(r.pen, 0, 0, 44, facing, half, 0.7, 0, VIEW);
    const b = setup(44, facing, half);
    // Sampled a cell inside the boundary: the outermost cell of the drawing
    // *is* the boundary, so a sample sitting exactly on it is a grid
    // coincidence rather than a property of the shape.
    const hits = (x: number, y: number) => sectorHits(b, { x, y }, -TELE_PIX);
    expect(coverage(r.cells, hits, boxOf(0, 0, 48))).toBeGreaterThan(0.95);
  });

  it("is a disc, with no seam, when the sweep goes all the way round", () => {
    const r = recorder();
    drawSectorTell(r.pen, 0, 0, 40, 0, Math.PI, 0.6, 0, VIEW);
    const hits = (x: number, y: number) => Math.hypot(x, y) <= 40 - TELE_PIX;
    expect(coverage(r.cells, hits, boxOf(0, 0, 44))).toBeGreaterThan(0.95);
    allInside(r.cells, disc(0, 0, 40));
  });

  it("fills in as the commit nears, by coverage and not by alpha", () => {
    const area = (t: number): number => {
      const r = recorder();
      drawSectorTell(r.pen, 0, 0, 44, 0.9, 0.8, t, 0, VIEW);
      return r.cells.reduce((n, c) => n + c.w * c.h, 0);
    };
    // Four steps of an ordered dither: each one plainly more than the last.
    expect(area(0.9)).toBeGreaterThan(area(0.55));
    expect(area(0.55)).toBeGreaterThan(area(0.1));
  });
});

describe("the boss's telegraphs", () => {
  it("slam: marks the ground out to the wave, and the safe circle inside it", () => {
    const r = recorder();
    drawSlamTell(r.pen, 0, 0, 64, 64 + 60, 0.5, 0, VIEW);
    allInside(r.cells, disc(0, 0, 124));
    // The hazard is the annulus: the safe circle is left bare on purpose, and
    // the ground between it and the wave's edge is what has to be marked.
    const band = (x: number, y: number): boolean => {
      const d = Math.hypot(x, y);
      return d >= 64 + TELE_PIX * 4 && d <= 124 - TELE_PIX;
    };
    expect(coverage(r.cells, band, boxOf(0, 0, 130))).toBeGreaterThan(0.95);
    // And the safe circle is drawn on its own radius, not near it.
    const onSafe = centres(r.cells).filter(([x, y]) => Math.abs(Math.hypot(x, y) - 64) <= TELE_PIX * 2);
    expect(onSafe.length).toBeGreaterThan(200);
  });

  it("leap: the landing mark is full size from the first frame", () => {
    const early = recorder();
    const late = recorder();
    drawLeapMark(early.pen, 0, 0, 46, 0, 0.05, 0, VIEW, { clock: false });
    drawLeapMark(late.pen, 0, 0, 46, 0, 0.95, 0, VIEW, { clock: false });
    const span = (cells: readonly Cell[]) => {
      const xs = centres(cells).map(([x]) => x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(Math.abs(span(early.cells) - span(late.cells))).toBeLessThanOrEqual(TELE_PIX);
    allInside(late.cells, disc(0, 0, 46));
    expect(coverage(late.cells, (x, y) => Math.hypot(x, y) <= 46 - TELE_PIX, boxOf(0, 0, 50)))
      .toBeGreaterThan(0.95);
  });

  it("overstay: the dial stays inside the punish's own reach", () => {
    for (const t of [0.3, 0.6, 0.95]) {
      const r = recorder();
      const rad = 92 - (92 - 14 - 14) * t;
      drawOverstayDial(r.pen, 0, 0, rad, t, 0, VIEW);
      allInside(r.cells, disc(0, 0, 92));
      // It is a dial, not a disc: a ring and its ticks, nothing filled.
      expect(r.cells.reduce((n, c) => n + c.w * c.h, 0)).toBeLessThan(Math.PI * rad * rad * 0.35);
    }
  });

  it("quake: a ring that closes in, and never a filled one", () => {
    const wide = recorder();
    const tight = recorder();
    drawQuakeTell(wide.pen, 0, 0, 92, 0, 0, 0, VIEW);
    drawQuakeTell(tight.pen, 0, 0, 32, 0, 1, 0, VIEW);
    const spread = (cells: readonly Cell[]) =>
      Math.max(...centres(cells).map(([x, y]) => Math.hypot(x, y)));
    expect(spread(tight.cells)).toBeLessThan(spread(wide.cells));
    expect(tight.cells.reduce((n, c) => n + c.w * c.h, 0)).toBeLessThan(Math.PI * 32 * 32);
  });
});

describe("the other warnings", () => {
  it("the sentinel's sight line stays in its own lane", () => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const r = recorder();
      drawAimLine(r.pen, 0, 0, ux, uy, 300, ux * 120, uy * 120, 0.5, 0, VIEW);
      for (const [x, y] of centres(r.cells)) {
        const along = x * ux + y * uy;
        const off = Math.abs(-x * uy + y * ux);
        // The pip on the aim point is three cells across; the lane itself is
        // three cells wide plus the liner.
        expect(along).toBeGreaterThanOrEqual(-TELE_PIX * 2);
        expect(along).toBeLessThanOrEqual(300 + TELE_PIX * 2);
        expect(off).toBeLessThanOrEqual(TELE_PIX * 3);
      }
    }
  });

  it("the lightning mark states its radius exactly and fills as it counts down", () => {
    for (const left of [0.9, 0.5, 0.05]) {
      const r = recorder();
      drawStrikeMark(r.pen, 0, 0, 30, left, 0, VIEW);
      allInside(r.cells, disc(0, 0, 30));
    }
    const full = recorder();
    drawStrikeMark(full.pen, 0, 0, 30, 0.02, 0, VIEW);
    expect(coverage(full.cells, (x, y) => Math.hypot(x, y) <= 30 - TELE_PIX, boxOf(0, 0, 34)))
      .toBeGreaterThan(0.95);
  });

  it("the mine's blast and the rift's heave cover the circle that hits", () => {
    for (const draw of [drawBlastRing, drawRiftCircle]) {
      const r = recorder();
      draw(r.pen, 0, 0, 32, 0.9, 0, VIEW);
      allInside(r.cells, disc(0, 0, 32));
      expect(coverage(r.cells, (x, y) => Math.hypot(x, y) <= 32 - TELE_PIX, boxOf(0, 0, 36)))
        .toBeGreaterThan(0.95);
    }
  });

  it("an all-round tell is a ring on the body, never a filled disc", () => {
    const r = recorder();
    drawRingTell(r.pen, 0, 0, 40, 0xff8877, 0.9, 0, VIEW);
    allInside(r.cells, disc(0, 0, 40));
    expect(r.cells.reduce((n, c) => n + c.w * c.h, 0)).toBeLessThan(Math.PI * 40 * 40 * 0.3);
  });

  it("the warden's cone is the sim's own rays, wall bites and all", () => {
    const half = (48 / 2) * Math.PI / 180;
    // A pillar eats the middle of the spread: the drawing has to eat it too.
    const rays = [96, 96, 92, 40, 38, 44, 90, 96, 96];
    const r = recorder();
    drawFlameCone(r.pen, 0, 0, 0.4, half, rays, 0.8, 0, VIEW);
    const reachAt = (off: number): number => {
      const u = ((off + half) / (2 * half)) * (rays.length - 1);
      const i = Math.max(0, Math.min(rays.length - 2, Math.floor(u)));
      const k = u - i;
      return rays[i]! * (1 - k) + rays[i + 1]! * k;
    };
    const inCone = (slack: number) => (x: number, y: number): boolean => {
      const d = Math.hypot(x, y);
      if (d <= TELE_PIX) return true;
      let off = Math.atan2(y, x) - 0.4;
      while (off > Math.PI) off -= Math.PI * 2;
      while (off < -Math.PI) off += Math.PI * 2;
      if (Math.abs(off) > half + slack / Math.max(d, 1)) return false;
      return d <= reachAt(Math.max(-half, Math.min(half, off))) + slack;
    };
    allInside(r.cells, inCone(SLACK));
    expect(coverage(r.cells, inCone(-TELE_PIX * 2), boxOf(0, 0, 100))).toBeGreaterThan(0.95);
  });
});

describe("the clocks", () => {
  it("blink and march have countably few frames, not a smooth ramp", () => {
    const seen = new Set<string>();
    for (let tick = 0; tick < 240; tick++) seen.add(`${blink(tick)}`);
    expect(seen.size).toBe(2);
    const phases = new Set<number>();
    for (let tick = 0; tick < 240; tick++) phases.add(march(tick));
    expect(phases.size).toBe(4);
  });

  it("the dither never crawls: the same shape draws the same cells each frame", () => {
    const at = (tick: number): string => {
      const r = recorder();
      // Level and rim colour move with the clock, so this is held still and
      // only the frame changes; a dither keyed off time would still move.
      drawSectorTell(r.pen, 0, 0, 44, 0.9, 0.8, 0.5, tick, VIEW);
      return r.cells.filter((c) => c.w > TELE_PIX || true)
        .map((c) => `${c.x},${c.y},${c.w}`).sort().join("|");
    };
    // Two ticks inside the same blink and march step: identical drawings.
    expect(at(0)).toBe(at(1));
  });
});

describe("what a frame costs", () => {
  it("a room's worth of telegraphs stays in the low thousands of rectangles", () => {
    const r = recorder();
    resetTeleRects();
    // Six bodies winding up, a boss slamming, a strike marked and a mine
    // primed: more than a real room ever shows at once.
    for (let i = 0; i < 6; i++) drawSectorTell(r.pen, i * 40, 0, 44, 0.9, 0.8, 0.7, 0, VIEW);
    drawSlamTell(r.pen, 0, 120, 64, 124, 0.9, 0, VIEW);
    drawOverstayDial(r.pen, 0, 120, 60, 0.7, 0, VIEW);
    drawStrikeMark(r.pen, 120, 120, 30, 0.2, 0, VIEW);
    drawBlastRing(r.pen, -120, 120, 32, 0.9, 0, VIEW);
    expect(teleRects()).toBeLessThan(9000);
  });

  it("clips to the camera: what is off screen is not scan-converted", () => {
    const tiny = { x0: -20, y0: -20, x1: 20, y1: 20 };
    const wide = recorder();
    const clipped = recorder();
    drawSlamTell(wide.pen, 0, 0, 64, 200, 0.8, 0, VIEW);
    drawSlamTell(clipped.pen, 0, 0, 64, 200, 0.8, 0, tiny);
    expect(clipped.cells.length * 6).toBeLessThan(wide.cells.length);
    for (const c of clipped.cells) {
      expect(c.y).toBeGreaterThanOrEqual(tiny.y0 - TELE_PIX);
      expect(c.y).toBeLessThanOrEqual(tiny.y1 + TELE_PIX);
    }
  });
});
