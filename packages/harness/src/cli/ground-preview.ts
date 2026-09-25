/**
 * Bakes the enemy-and-boss vector drawings in `game/src/scenes/ground.ts` to
 * a PNG, so the boss's shockwave, its rotating arms, a bell's hurry cue and a
 * toll's conduction pulse can be looked at without a browser.
 *
 * It draws the **shipping code**, through the same `Pen` the play scene hands
 * it — a tiny software rasteriser stands in for Phaser's `Graphics` — so what
 * the picture shows is what the game draws. Two pens, because the drawings
 * need two: the soil, the furrow and the limbs are normal-blended and the hot
 * edges are additive, exactly as the scene's two layers are.
 *
 * The scene is the **boss arena**, not a swatch sheet: a floor at the game's
 * own tile pitch, the boss's body at its own radius and the player's at
 * theirs, so the band's thickness and the arm's reach can be judged against
 * the things they are aimed at.
 *
 * Run: `pnpm ground:preview [out.png] [scale]`
 */
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { TILE_PX } from "@jr/core";
import { drawArms, drawHasteCue, drawShockwaves, drawTollPulse } from "../../../game/src/scenes/ground.ts";
import type { Pen } from "../../../game/src/scenes/ground.ts";

const W = 900;
const H = 640;
const png = new PNG({ width: W, height: H });

/** The floor the arena is drawn on: the room's stone, at the game's pitch. */
function floor(): void {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const tile = (Math.floor(x / TILE_PX) + Math.floor(y / TILE_PX)) % 2;
      const grain = ((x * 7 + y * 13) % 11) - 5;
      const base = tile ? 38 : 34;
      png.data[i] = base + grain;
      png.data[i + 1] = base - 4 + grain;
      png.data[i + 2] = base + 18 + grain;
      png.data[i + 3] = 255;
    }
}
floor();

type Blend = "add" | "over";

function plot(x: number, y: number, colour: number, alpha: number, blend: Blend): void {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= W || py >= H || alpha <= 0) return;
  const i = (py * W + px) * 4;
  const r = (colour >> 16) & 255;
  const g = (colour >> 8) & 255;
  const b = colour & 255;
  const a = Math.min(1, alpha);
  if (blend === "add") {
    png.data[i] = Math.min(255, png.data[i]! + r * a);
    png.data[i + 1] = Math.min(255, png.data[i + 1]! + g * a);
    png.data[i + 2] = Math.min(255, png.data[i + 2]! + b * a);
  } else {
    png.data[i] = Math.round(png.data[i]! * (1 - a) + r * a);
    png.data[i + 1] = Math.round(png.data[i + 1]! * (1 - a) + g * a);
    png.data[i + 2] = Math.round(png.data[i + 2]! * (1 - a) + b * a);
  }
}

function makePen(blend: Blend): Pen {
  let lw = 1;
  let lc = 0xffffff;
  let la = 1;
  let fc = 0xffffff;
  let fa = 1;
  let path: { x: number; y: number }[] = [];
  const subpaths: { x: number; y: number }[][] = [];
  const stroke = (x0: number, y0: number, x1: number, y1: number, width: number, colour: number, alpha: number): void => {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const half = width / 2;
      for (let dy = -half; dy <= half; dy += 0.5)
        for (let dx = -half; dx <= half; dx += 0.5) plot(x + dx, y + dy, colour, alpha * 0.5, blend);
    }
  };
  const disc = (x: number, y: number, r: number, colour: number, alpha: number): void => {
    for (let dy = -r; dy <= r; dy += 0.5)
      for (let dx = -r; dx <= r; dx += 0.5)
        if (dx * dx + dy * dy <= r * r) plot(x + dx, y + dy, colour, alpha * 0.25, blend);
  };
  return {
    lineStyle(width, colour, alpha = 1) { lw = width; lc = colour; la = alpha; return this; },
    fillStyle(colour, alpha = 1) { fc = colour; fa = alpha; return this; },
    strokeCircle(x, y, r) {
      const n = Math.max(48, Math.ceil(r * 6));
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        stroke(x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r, lw, lc, la);
      }
      return this;
    },
    fillCircle(x, y, r) { disc(x, y, r, fc, fa); return this; },
    /** The one the pixel drawings are made of: a hard, unfiltered block. */
    fillRect(x, y, w, h) {
      for (let py = Math.round(y); py < Math.round(y + h); py++)
        for (let px = Math.round(x); px < Math.round(x + w); px++) plot(px, py, fc, fa, blend);
      return this;
    },
    lineBetween(x0, y0, x1, y1) { stroke(x0, y0, x1, y1, lw, lc, la); return this; },
    beginPath() { path = []; subpaths.length = 0; return this; },
    moveTo(x, y) { path = [{ x, y }]; return this; },
    lineTo(x, y) { path.push({ x, y }); return this; },
    arc(x, y, r, a0, a1, anticlockwise = false) {
      const pts: { x: number; y: number }[] = [];
      const n = 96;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const a = anticlockwise ? a1 + (a0 - a1) * t : a0 + (a1 - a0) * t;
        pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
      }
      subpaths.push(pts);
      path = pts;
      return this;
    },
    strokePath() {
      for (let i = 1; i < path.length; i++)
        stroke(path[i - 1]!.x, path[i - 1]!.y, path[i]!.x, path[i]!.y, lw, lc, la);
      return this;
    },
    /**
     * Even-odd fill of whatever sub-paths were pushed, which is how an
     * annulus (an outer arc plus a reversed inner one) comes out as a ring.
     */
    fillPath() {
      if (subpaths.length === 0) return this;
      const all = subpaths.flat();
      const minX = Math.min(...all.map((q) => q.x));
      const maxX = Math.max(...all.map((q) => q.x));
      const minY = Math.min(...all.map((q) => q.y));
      const maxY = Math.max(...all.map((q) => q.y));
      for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
        const xs: number[] = [];
        for (const sp of subpaths)
          for (let i = 1; i < sp.length; i++) {
            const a = sp[i - 1]!;
            const b = sp[i]!;
            if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y))
              xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
          }
        xs.sort((p, q) => p - q);
        for (let i = 0; i + 1 < xs.length; i += 2)
          for (let x = Math.ceil(xs[i]!); x <= Math.floor(xs[i + 1]!); x++) {
            if (x < minX - 1 || x > maxX + 1) continue;
            plot(x, y, fc, fa, blend);
          }
      }
      subpaths.length = 0;
      return this;
    },
  };
}

const ground = makePen("over");
const glow = makePen("add");
const view = { x0: 0, y0: 0, x1: W, y1: H };

/** A body, so the band and the limbs have something to be measured against. */
function body(x: number, y: number, r: number, colour: number): void {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      plot(x + dx, y + dy, d > r - 2 ? 0x000000 : colour, d > r - 2 ? 0.8 : 1, "over");
    }
}

const wave = (x: number, y: number, chargeMs: number, inner: number) => ({
  alive: true, x, y, chargeMs, chargeMaxMs: 520, inner, thickness: 34, maxRadius: 300,
});
/*
 * One panel per state, laid out so no two rings overlap: the charge, the
 * moment it sets off at the sword's own reach, the band well out, and the
 * band leaving. The player's body is 8 px across and the boss's 44, so the
 * scale here is the scale in the game.
 */
drawShockwaves(ground, glow, [wave(150, 150, 300, 64)], 0, view);
body(150, 150, 22, 0x6a4a7a);
drawShockwaves(ground, glow, [wave(450, 150, 0, 64)], 0, view);
body(450, 150, 22, 0x6a4a7a);
body(450, 96, 8, 0x7ad0ff);
drawShockwaves(ground, glow, [wave(760, 170, 0, 116)], 0, view);
body(760, 170, 22, 0x6a4a7a);
drawShockwaves(ground, glow, [wave(210, 460, 0, 258)], 0, view);
body(210, 460, 22, 0x6a4a7a);

/*
 * The lash: one arm still in its telegraph, and three mid-sweep, drawn on
 * the boss they grow out of.
 */
const arm = (x: number, y: number, angle: number, teleMs: number) => ({
  alive: true, x, y, angle, spin: 2.7, inner: 11, length: 120, width: 20,
  teleMs, teleMaxMs: 620, activeMs: 1400, activeMaxMs: 2000,
});
body(620, 470, 22, 0x6a4a7a);
drawArms(ground, glow, [arm(620, 470, 0.5, 420)]);
body(620, 470, 22, 0x6a4a7a);
body(830, 470, 22, 0x6a4a7a);
drawArms(ground, glow, [
  arm(830, 470, 0.2, 0), arm(830, 470, 0.2 + (Math.PI * 2) / 3, 0), arm(830, 470, 0.2 + (Math.PI * 4) / 3, 0),
]);
body(830, 470, 22, 0x6a4a7a);
body(830, 400, 8, 0x7ad0ff);

// Two hurried bodies, facing opposite ways, and a toll pulse mid-flight.
drawHasteCue(glow, { x: 470, y: 560, radius: 9, facing: 0 }, 4);
drawHasteCue(glow, { x: 540, y: 600, radius: 11, facing: Math.PI * 0.75 }, 7);
drawTollPulse(glow, { x0: 60, y0: 610, x1: 380, y1: 610 }, 0.55);

const out = process.argv[2] ?? "ground-preview.png";
const scale = Math.max(1, Math.round(Number(process.argv[3] ?? 1)));
if (scale === 1) {
  writeFileSync(out, PNG.sync.write(png));
} else {
  const big = new PNG({ width: W * scale, height: H * scale });
  for (let y = 0; y < H * scale; y++)
    for (let x = 0; x < W * scale; x++) {
      const si = (Math.floor(y / scale) * W + Math.floor(x / scale)) * 4;
      const di = (y * W * scale + x) * 4;
      big.data[di] = png.data[si]!;
      big.data[di + 1] = png.data[si + 1]!;
      big.data[di + 2] = png.data[si + 2]!;
      big.data[di + 3] = 255;
    }
  writeFileSync(out, PNG.sync.write(big));
}
console.log(`ground preview (${scale}x) → ${out}`);
