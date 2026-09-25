/**
 * **The attack warnings, before and after, without a browser.**
 *
 * Every enemy and boss telegraph is baked here twice on the same floor: once
 * the way it was drawn before — Phaser vector strokes, antialiased and
 * alpha-blended, reproduced exactly as `play.ts` used to call them — and once
 * through the shipping code in `game/src/scenes/telegraph.ts`. Same geometry,
 * same clock, same panel, so the only difference in the picture is the one
 * being argued about.
 *
 * **It renders at the game's own zoom**, `ART_SCALE` output pixels per world
 * pixel, with the **real atlas** blitted one atlas pixel to one output pixel:
 * the room's floor tiles and a real enemy body stand beside the drawing. That
 * is the only way to answer the question that matters — is a telegraph's step
 * the same size as the step in the sprite's outline — and at one pixel per
 * world unit it cannot be asked at all, because an art texel is half a pixel
 * there and simply disappears.
 *
 * The three rows sit on three floors — the room's own stone, and two tinted
 * copies of it, cold and hot — because the claim being tested is not "this
 * looks nice" but "this stays readable on every mood the room generator can
 * hand it".
 *
 * Run: `pnpm telegraph:preview [out-prefix]`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import {
  ART_SCALE, drawAimLine, drawBlastRing, drawFlameCone, drawLeapMark, drawOverstayDial,
  drawQuakeTell, drawRiftCircle, drawRingTell, drawSectorTell, drawSlamTell, drawStrikeMark,
  resetTeleRects, teleRects,
} from "../../../game/src/scenes/telegraph.ts";
import type { Pen } from "../../../game/src/scenes/ground.ts";

/** Output pixels per world pixel: the camera's zoom, so one art texel is one pixel. */
const S = ART_SCALE;
const COLS = 4;
const ROWS = 3;
/** A panel, in world px. The boss's slam is 248 across and has to fit. */
const CELL = 270;
const W = COLS * CELL * S;
const H = ROWS * CELL * S;

const png = new PNG({ width: W, height: H });

/** The shipped atlas, so the bodies and the floor in these pictures are the game's. */
const sheet = PNG.sync.read(readFileSync("assets/sprites.png"));
const frames: Record<string, { x: number; y: number; w: number; h: number }> =
  JSON.parse(readFileSync("assets/sprites.json", "utf8")).frames;

/** Row 1 is the sheet as delivered; rows 2 and 3 are a cold and a hot room. */
const MOOD: readonly (readonly [number, number, number])[] = [
  [1, 1, 1], [0.78, 0.84, 1.25], [1.3, 1.0, 0.72],
];

function tint(r: number, g: number, b: number, row: number): [number, number, number] {
  const m = MOOD[Math.min(MOOD.length - 1, row)]!;
  return [Math.min(255, r * m[0]), Math.min(255, g * m[1]), Math.min(255, b * m[2])];
}

/** One output pixel. `x`/`y` are output pixels, not world px. */
function px(x: number, y: number, colour: number, alpha: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H || alpha <= 0) return;
  const i = (y * W + x) * 4;
  const a = Math.min(1, alpha);
  png.data[i] = Math.round(png.data[i]! * (1 - a) + ((colour >> 16) & 255) * a);
  png.data[i + 1] = Math.round(png.data[i + 1]! * (1 - a) + ((colour >> 8) & 255) * a);
  png.data[i + 2] = Math.round(png.data[i + 2]! * (1 - a) + (colour & 255) * a);
}

/** A point in world px, which at this zoom lands on `S` output pixels a side. */
function plot(wx: number, wy: number, colour: number, alpha: number): void {
  const x0 = Math.round(wx * S);
  const y0 = Math.round(wy * S);
  for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) px(x0 + dx, y0 + dy, colour, alpha);
}

/**
 * An atlas frame, **one atlas pixel to one output pixel**, centred on a world
 * point — exactly `setScale(1 / ART_SCALE)` at a zoom of `ART_SCALE`.
 */
function sprite(name: string, wx: number, wy: number, row: number, footed = false): void {
  const f = frames[name];
  if (!f) return;
  const ox = Math.round(wx * S - f.w / 2);
  const oy = Math.round(wy * S - (footed ? f.h : f.h / 2));
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const i = ((f.y + y) * sheet.width + f.x + x) * 4;
      const a = sheet.data[i + 3]! / 255;
      if (a <= 0) continue;
      const [r, g, b] = tint(sheet.data[i]!, sheet.data[i + 1]!, sheet.data[i + 2]!, row);
      px(ox + x, oy + y, ((r & 255) << 16) | ((g & 255) << 8) | (b & 255), a);
    }
}

/** The room's own floor, tiled at 32 world px and blitted 1:1. */
function floor(): void {
  const tiles = ["tile_floor_0", "tile_floor_1", "tile_floor_2", "tile_floor_4"];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    png.data[i] = 20;
    png.data[i + 1] = 18;
    png.data[i + 2] = 32;
    png.data[i + 3] = 255;
  }
  const side = 32 * S;
  for (let ty = 0; ty * side < H; ty++)
    for (let tx = 0; tx * side < W; tx++) {
      const row = Math.floor((ty * side) / (CELL * S));
      const f = frames[tiles[(tx + ty * 3) % tiles.length]!];
      if (!f) continue;
      for (let y = 0; y < f.h; y++)
        for (let x = 0; x < f.w; x++) {
          const i = ((f.y + y) * sheet.width + f.x + x) * 4;
          if (sheet.data[i + 3]! === 0) continue;
          const [r, g, b] = tint(sheet.data[i]!, sheet.data[i + 1]!, sheet.data[i + 2]!, row);
          px(tx * side + x, ty * side + y, ((r & 255) << 16) | ((g & 255) << 8) | (b & 255), 1);
        }
    }
}

/**
 * A pen that rasterises the smooth vector calls the way Phaser does —
 * antialiased strokes, alpha-blended fills, at the output resolution — and the
 * hard blocks the pixel code puts down exactly as blocks on the world grid.
 */
function makePen(): Pen {
  let lw = 1;
  let lc = 0xffffff;
  let la = 1;
  let fc = 0xffffff;
  let fa = 1;
  const stroke = (x0: number, y0: number, x1: number, y1: number): void => {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * S * 2));
    const half = (lw * S) / 2;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = (x0 + (x1 - x0) * t) * S;
      const y = (y0 + (y1 - y0) * t) * S;
      for (let dy = -half; dy <= half; dy += 0.5)
        for (let dx = -half; dx <= half; dx += 0.5) px(Math.round(x + dx), Math.round(y + dy), lc, la * 0.3);
    }
  };
  const pen: Pen = {
    lineStyle(width, colour, alpha = 1) { lw = width; lc = colour; la = alpha; return pen; },
    fillStyle(colour, alpha = 1) { fc = colour; fa = alpha; return pen; },
    strokeCircle(x, y, r) {
      const n = Math.max(64, Math.ceil(r * S * 8));
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        stroke(x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r);
      }
      return pen;
    },
    fillCircle(x, y, r) {
      const step = 1 / S;
      for (let dy = -r; dy <= r; dy += step)
        for (let dx = -r; dx <= r; dx += step)
          if (dx * dx + dy * dy <= r * r) px(Math.round((x + dx) * S), Math.round((y + dy) * S), fc, fa);
      return pen;
    },
    /** The one the pixel drawings are made of: a hard, unfiltered block. */
    fillRect(x, y, w, h) {
      const x0 = Math.round(x * S);
      const y0 = Math.round(y * S);
      for (let py = y0; py < Math.round((y + h) * S); py++)
        for (let pxx = x0; pxx < Math.round((x + w) * S); pxx++) px(pxx, py, fc, fa);
      return pen;
    },
    lineBetween(x0, y0, x1, y1) { stroke(x0, y0, x1, y1); return pen; },
    beginPath() { return pen; },
    moveTo() { return pen; },
    lineTo() { return pen; },
    arc() { return pen; },
    strokePath() { return pen; },
    fillPath() { return pen; },
  };
  return pen;
}

/** The old filled sector, alpha-blended the way `slice` + `fillPath` was. */
function fillSector(x: number, y: number, r: number, facing: number, half: number, colour: number, alpha: number): void {
  const step = 1 / S;
  for (let dy = -r; dy <= r; dy += step)
    for (let dx = -r; dx <= r; dx += step) {
      if (Math.hypot(dx, dy) > r) continue;
      let d = Math.atan2(dy, dx) - facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > half) continue;
      plot(x + dx, y + dy, colour, alpha);
    }
}

function strokeArc(pen: Pen, x: number, y: number, r: number, from: number, to: number): void {
  const n = 192;
  for (let i = 0; i < n; i++) {
    const a0 = from + ((to - from) * i) / n;
    const a1 = from + ((to - from) * (i + 1)) / n;
    pen.lineBetween(x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r);
  }
}

const pen = makePen();
const VIEW = { x0: -1e4, y0: -1e4, x1: 1e4, y1: 1e4 };

interface Panel {
  name: string;
  /** The body the telegraph belongs to, drawn under it as the game does. */
  under?: (cx: number, cy: number, row: number) => void;
  before: (cx: number, cy: number) => void;
  after: (cx: number, cy: number) => void;
}

const T = 0.75;
const TICK = 4;
const CONE_HALF = (48 / 2) * Math.PI / 180;
const CONE_RAYS = [92, 92, 90, 44, 42, 48, 88, 92, 92];

const PANELS: Panel[] = [
  {
    name: "melee windup sector (reach 44, arc 92 deg)",
    under: (x, y, r) => sprite("enemy_rusher_s_windup", x, y + 6, r, true),
    before: (x, y) => {
      fillSector(x, y, 44, 0.9, 0.8, 0xff5544, 0.14 + 0.28 * T);
      pen.lineStyle(1.5, 0xff8877, 0.5 + 0.4 * T);
      strokeArc(pen, x, y, 44, 0.9 - 0.8, 0.9 + 0.8);
    },
    after: (x, y) => drawSectorTell(pen, x, y, 44, 0.9, 0.8, T, TICK, VIEW),
  },
  {
    name: "spike drive: an all-round ring on the body",
    under: (x, y, r) => sprite("enemy_rusher_s_windup", x, y + 6, r, true),
    before: (x, y) => { pen.lineStyle(1.5 + T, 0xffd24a, 0.35 + 0.6 * T); pen.strokeCircle(x, y - 2, 40); },
    after: (x, y) => drawRingTell(pen, x, y - 2, 40, 0xffd24a, T, TICK, VIEW),
  },
  {
    name: "tank slam: the blade's reach and the wave's",
    under: (x, y, r) => sprite("enemy_tank_s_windup", x, y + 8, r, true),
    before: (x, y) => {
      pen.lineStyle(1 + T, 0xff8a5a, 0.18 + 0.3 * T);
      pen.strokeCircle(x, y - 2, 73.6 * (0.35 + 0.65 * T));
      pen.lineStyle(1.5 + T, 0xf0ead8, 0.35 + 0.6 * T);
      pen.strokeCircle(x, y - 2, 38 * (0.3 + 0.7 * T));
    },
    after: (x, y) => {
      drawRingTell(pen, x, y - 2, 73.6 * (0.35 + 0.65 * T), 0xffd08a, T, TICK, VIEW, { dim: true });
      drawRingTell(pen, x, y - 2, 38 * (0.3 + 0.7 * T), 0xf0ead8, T, TICK, VIEW);
    },
  },
  {
    name: "boss slam: the wave's ground and the safe circle",
    under: (x, y, r) => sprite("enemy_tank_s_idle0", x, y + 10, r, true),
    before: (x, y) => {
      pen.lineStyle(2, 0xff5a4a, 0.4 + 0.5 * T);
      pen.strokeCircle(x, y, 64 + 60 * T);
      pen.fillStyle(0xff5a4a, 0.08 + 0.12 * T);
      pen.fillCircle(x, y, 64 + 60 * T);
      pen.lineStyle(1.5, 0xffffff, 0.8);
      pen.strokeCircle(x, y, 64);
    },
    after: (x, y) => drawSlamTell(pen, x, y, 64, 64 + 60 * T, T, TICK, VIEW),
  },
  {
    name: "boss leap: where it comes down",
    before: (x, y) => {
      pen.lineStyle(2, 0xff5a4a, 0.55 + 0.45 * T);
      pen.strokeCircle(x, y, 46);
      pen.fillStyle(0xff5a4a, 0.1 + 0.3 * T);
      pen.fillCircle(x, y, 46 * T);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const r0 = 46 + 22 * (1 - T);
        pen.lineStyle(2, 0xffd08a, 0.3 + 0.6 * T);
        pen.lineBetween(x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * (r0 + 8), y + Math.sin(a) * (r0 + 8));
      }
      pen.lineStyle(1, 0xffffff, 0.25 + 0.4 * T);
      pen.strokeCircle(x, y, 64);
    },
    after: (x, y) => {
      drawLeapMark(pen, x, y, 46, 0, T, TICK, VIEW);
      drawRingTell(pen, x, y, 64, 0xff8877, T, TICK, VIEW, { dim: true });
    },
  },
  {
    name: "boss overstay dial",
    under: (x, y, r) => sprite("enemy_tank_s_idle0", x, y + 10, r, true),
    before: (x, y) => {
      const r = 92 - (92 - 20 - 14) * T;
      pen.lineStyle(1 + 2 * T, 0xffffff, 0.25 + 0.6 * T);
      pen.strokeCircle(x, y, r);
      for (let k = 0; k < 8; k++) {
        if (k / 8 > T) continue;
        const a = -Math.PI / 2 + (k / 8) * Math.PI * 2;
        pen.lineStyle(2, 0xffffff, 0.5 + 0.5 * T);
        pen.lineBetween(x + Math.cos(a) * r, y + Math.sin(a) * r, x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5));
      }
    },
    after: (x, y) => drawOverstayDial(pen, x, y, 92 - (92 - 20 - 14) * T, T, TICK, VIEW),
  },
  {
    name: "boss quake: a ring closing in",
    under: (x, y, r) => sprite("enemy_tank_s_idle0", x, y + 10, r, true),
    before: (x, y) => {
      const r = 92 - 60 * T;
      pen.lineStyle(2, 0xff5a4a, 0.3 + 0.6 * T);
      pen.strokeCircle(x, y, r);
      for (let k = 0; k < 4; k++) {
        const a = 0.4 + (k / 4) * Math.PI * 2;
        pen.lineStyle(2, 0xffd08a, 0.35 + 0.55 * T);
        pen.lineBetween(x + Math.cos(a) * r, y + Math.sin(a) * r, x + Math.cos(a) * (r + 10), y + Math.sin(a) * (r + 10));
      }
    },
    after: (x, y) => drawQuakeTell(pen, x, y, 92 - 60 * T, 0.4, T, TICK, VIEW),
  },
  {
    name: "sentinel sight line",
    under: (x, y, r) => sprite("enemy_sentinel_idle0", x - 100, y - 36, r, true),
    before: (x, y) => {
      pen.lineStyle(1, 0xff6a5a, 0.25 + 0.5 * T);
      pen.lineBetween(x - 100, y - 40, x - 100 + 0.93 * 240, y - 40 + 0.37 * 240);
      pen.fillStyle(0xff6a5a, 0.6 + 0.4 * T);
      pen.fillCircle(x - 100 + 0.93 * 130, y - 40 + 0.37 * 130, 1.5 + T);
    },
    after: (x, y) => drawAimLine(pen, x - 100, y - 40, 0.93, 0.37, 240,
      x - 100 + 0.93 * 130, y - 40 + 0.37 * 130, T, TICK, VIEW),
  },
  {
    name: "warden fire-shot cone, with a pillar biting it",
    under: (x, y, r) => sprite("enemy_warden_s_idle0", x - 70, y + 8, r, true),
    before: (x, y) => {
      const step = 1 / S;
      for (let dy = -100; dy <= 100; dy += step)
        for (let dx = -10; dx <= 100; dx += step) {
          const d = Math.hypot(dx, dy);
          const off = Math.atan2(dy, dx);
          if (Math.abs(off) > CONE_HALF) continue;
          const u = ((off + CONE_HALF) / (2 * CONE_HALF)) * (CONE_RAYS.length - 1);
          const i = Math.max(0, Math.min(CONE_RAYS.length - 2, Math.floor(u)));
          const k = u - i;
          if (d > CONE_RAYS[i]! * (1 - k) + CONE_RAYS[i + 1]! * k) continue;
          plot(x - 70 + dx, y + dy, 0xff5544, 0.06 + 0.22 * T);
        }
      pen.lineStyle(1.5, 0xff8877, 0.35 + 0.5 * T);
      let pxp = 0;
      let pyp = 0;
      for (let i = 0; i < CONE_RAYS.length; i++) {
        const a = -CONE_HALF + (2 * CONE_HALF * i) / (CONE_RAYS.length - 1);
        const qx = x - 70 + Math.cos(a) * CONE_RAYS[i]!;
        const qy = y + Math.sin(a) * CONE_RAYS[i]!;
        if (i > 0) pen.lineBetween(pxp, pyp, qx, qy);
        pxp = qx;
        pyp = qy;
      }
    },
    after: (x, y) => drawFlameCone(pen, x - 70, y, 0, CONE_HALF, CONE_RAYS, T, TICK, VIEW),
  },
  {
    name: "lightning strike mark",
    under: (x, y, r) => sprite("enemy_rusher_s_idle0", x + 46, y + 6, r, true),
    before: (x, y) => {
      pen.lineStyle(2, 0x9ad8ff, 0.9);
      pen.strokeCircle(x, y, 30);
      pen.fillStyle(0x9ad8ff, 0.18);
      pen.fillCircle(x, y, 30 * T);
    },
    after: (x, y) => drawStrikeMark(pen, x, y, 30, 1 - T, TICK, VIEW),
  },
  {
    name: "mine blast circle",
    under: (x, y, r) => sprite("enemy_rusher_s_idle0", x + 50, y + 6, r, true),
    before: (x, y) => {
      pen.lineStyle(1.5, 0xff5544, 0.5 + 0.5 * T);
      pen.strokeCircle(x, y, 32);
      pen.fillStyle(0xff5544, 0.12 + 0.18 * T);
      pen.fillCircle(x, y, 32);
    },
    after: (x, y) => drawBlastRing(pen, x, y, 32, T, TICK, VIEW),
  },
  {
    name: "rift heave (a circle opening under the floor)",
    under: (x, y, r) => sprite("enemy_rusher_s_idle0", x + 44, y + 6, r, true),
    before: (x, y) => {
      pen.lineStyle(1.5 + T * 1.5, 0xff5544, 0.35 + 0.55 * T);
      pen.strokeCircle(x, y, 24 * (1.25 - 0.25 * T));
      pen.fillStyle(0xff5544, 0.08 + 0.18 * T);
      pen.fillCircle(x, y, 24);
    },
    after: (x, y) => drawRiftCircle(pen, x, y, 24, T, TICK, VIEW),
  },
];

const prefix = process.argv[2] ?? "telegraphs";

/** A window of the sheet, nearest-neighbour enlarged — never smoothed. */
function cut(x0: number, y0: number, w: number, h: number, scale: number, out: string): void {
  const big = new PNG({ width: w * scale, height: h * scale });
  for (let y = 0; y < h * scale; y++)
    for (let x = 0; x < w * scale; x++) {
      const si = ((y0 + Math.floor(y / scale)) * W + x0 + Math.floor(x / scale)) * 4;
      const di = (y * w * scale + x) * 4;
      big.data[di] = png.data[si]!;
      big.data[di + 1] = png.data[si + 1]!;
      big.data[di + 2] = png.data[si + 2]!;
      big.data[di + 3] = 255;
    }
  writeFileSync(out, PNG.sync.write(big));
}

const slug = (s: string): string =>
  s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40);

function draw(which: "before" | "after"): void {
  floor();
  resetTeleRects();
  PANELS.forEach((p, i) => {
    const cx = (i % COLS) * CELL + CELL / 2;
    const cy = Math.floor(i / COLS) * CELL + CELL / 2;
    p.under?.(cx, cy, Math.floor(i / COLS));
    p[which](cx, cy);
  });
  cut(0, 0, W, H, 1, `${prefix}-sheet-${which}-1x.png`);
  PANELS.forEach((p, i) => {
    const x0 = (i % COLS) * CELL * S;
    const y0 = Math.floor(i / COLS) * CELL * S;
    const n = String(i + 1).padStart(2, "0");
    for (const s of [1, 3]) cut(x0, y0, CELL * S, CELL * S, s, `${prefix}-${n}-${slug(p.name)}-${which}-${s}x.png`);
  });
  console.log(`${which}: sheet at 1x + ${PANELS.length} panels at 1x and 3x`
    + (which === "after" ? `  (${teleRects()} rectangles for all ${PANELS.length})` : ""));
}

draw("before");
draw("after");
console.log(`zoom ${S}x: one art texel is one output pixel at 1x.`);
PANELS.forEach((p, i) => { console.log(`  ${String(i + 1).padStart(2, "0")}. ${p.name}`); });
