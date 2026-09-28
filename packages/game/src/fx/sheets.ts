/**
 * Effect sprites drawn by code, at the art's own pixel (doc 008, "Rules for
 * effects drawn in code").
 *
 * Every frame here is generated pixel by pixel — shapes, then colour taken
 * from a short ramp in flat bands, then a one-pixel dark rim where the thing
 * is matter, dithering rather than alpha where it thins out — so an effect
 * sits in the sheet's style instead of reading as a vector overlay, and no
 * effect waits on the art pipeline. Pure: no Phaser, no DOM, so the same
 * code bakes textures at boot (`fx/textures.ts`) and writes a preview sheet
 * from Node (`pnpm fx:preview`).
 *
 * One texel is half a world pixel, as the delivered sprites are: draw them at
 * scale 0.5.
 */

export interface FxFrame {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
}

export interface FxSheet {
  /** Frame names are `${name}_${i}`. */
  readonly name: string;
  readonly frames: readonly FxFrame[];
  /** Where the effect's origin sits, in texels (the muzzle, the impact point). */
  readonly origin: readonly [number, number];
  /** Per frame, where frames differ in size; else `origin` for all. */
  readonly frameOrigins?: readonly (readonly [number, number])[];
}

type Rgb = readonly [number, number, number];

const hex = (h: number): Rgb => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/** Ramps, dark to light. Enemy shot magenta is reserved for enemy projectiles (doc 008). */
const RAMP = {
  fire: [0x5a1a14, 0xa8401c, 0xf07a28, 0xffc440, 0xffe98a, 0xfffbe8].map(hex),
  enemy: [0x3a0626, 0x9a0f52, 0xe81f7a, 0xff6aaa, 0xffe0ef].map(hex),
  spark: [0x7a4a1c, 0xd08a30, 0xffd27a, 0xfff4d0].map(hex),
  dust: [0x3e3446, 0x6a6070, 0x9a8f9a, 0xc4b8b8].map(hex),
  smoke: [0x3a3440, 0x5e5864, 0x847e8a, 0xaaa4ae].map(hex),
  hurt: [0x5a0a14, 0xb01e28, 0xff5a4a, 0xffb0a0, 0xffffff].map(hex),
  blast: [0x6a4a30, 0xb08a60, 0xe8c890, 0xfff0c0, 0xffffff].map(hex),
  lava: [0x2a1a1c, 0x8a3414, 0xc8561a, 0xe2701e, 0xf28c32, 0xf8a848, 0xffd070].map(hex),
  grass: [0x16301a, 0x224826, 0x33662e, 0x4f8a38, 0x7cb24c, 0xb4da74].map(hex),
  char: [0x141014, 0x221c1e, 0x34292a, 0x4a3e3a, 0x6a5e56, 0xe0602a, 0xffb848].map(hex),
} as const;

/** A deterministic generator, so a sheet is the same drawing every boot. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A frame as an index grid: -1 empty, else a ramp index; resolved to colour at the end. */
class Canvas {
  readonly idx: Int8Array;
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.idx = new Int8Array(w * h).fill(-1);
  }
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return this.idx[y * this.w + x]!;
  }
  /** Sets the higher of the existing and the new index: light paints over dark. */
  put(x: number, y: number, i: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const k = y * this.w + x;
    if (i > this.idx[k]!) this.idx[k] = i;
  }
  /** A disc whose index falls off toward its edge in `bands` flat steps. */
  disc(cx: number, cy: number, r: number, top: number, bands: number, dither = false): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = Math.hypot(x - cx, y - cy) / Math.max(0.5, r);
        if (d > 1) continue;
        if (dither && d > 0.72 && (x + y) % 2 === 0) continue;
        this.put(x, y, Math.max(0, top - Math.floor(d * bands)));
      }
  }
  line(x0: number, y0: number, x1: number, y1: number, i: number, width = 1): void {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let s = 0; s <= n; s++) {
      const x = x0 + ((x1 - x0) * s) / Math.max(1, n);
      const y = y0 + ((y1 - y0) * s) / Math.max(1, n);
      for (let a = 0; a < width; a++) for (let b = 0; b < width; b++) this.put(x + a - (width >> 1), y + b - (width >> 1), i);
    }
  }
  /** A one-texel rim of index 0 round everything drawn: matter has an edge. */
  rim(): void {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) >= 0) continue;
        if (this.get(x + 1, y) > 0 || this.get(x - 1, y) > 0 || this.get(x, y + 1) > 0 || this.get(x, y - 1) > 0) add.push(y * this.w + x);
      }
    for (const k of add) this.idx[k] = 0;
  }
  paint(ramp: readonly Rgb[]): FxFrame {
    const data = new Uint8ClampedArray(this.w * this.h * 4);
    for (let k = 0; k < this.idx.length; k++) {
      const i = this.idx[k]!;
      if (i < 0) continue;
      const c = ramp[Math.min(ramp.length - 1, i)]!;
      data[k * 4] = c[0];
      data[k * 4 + 1] = c[1];
      data[k * 4 + 2] = c[2];
      data[k * 4 + 3] = 255;
    }
    return { w: this.w, h: this.h, data };
  }
}

/**
 * A muzzle flash pointing right, origin at the left middle: a star thrown
 * forward — the long ray along the barrel, shorter ones fanning back — with a
 * white core; then shorter and fatter; then embers and a ring going out.
 */
function muzzle(name: string, r: number, seed: number): FxSheet {
  const w = Math.ceil(r * 2.6) + 4;
  const h = Math.ceil(r * 1.9) + 4;
  const oy = Math.floor(h / 2);
  const ox = 2;
  const R = rng(seed);
  const frames: FxFrame[] = [];
  const rays = [0, 0.38, -0.38, 0.8, -0.8, 1.3, -1.3];
  for (let f = 0; f < 3; f++) {
    const c = new Canvas(w, h);
    const k = 1 - f * 0.34;
    for (const [i, a] of rays.entries()) {
      const len = r * (i === 0 ? 2.3 : i < 3 ? 1.5 : i < 5 ? 1.0 : 0.6) * k * (0.9 + R() * 0.2);
      const x1 = ox + Math.cos(a) * len;
      const y1 = oy + Math.sin(a) * len;
      c.line(ox, oy, x1, y1, f === 2 ? 2 : 3, f === 0 ? 3 : 2);
      c.line(ox, oy, ox + (x1 - ox) * 0.6, oy + (y1 - oy) * 0.6, f === 2 ? 3 : 4, 1);
    }
    if (f < 2) c.disc(ox + r * 0.35, oy, r * (0.55 - f * 0.12), 5 - f, 3);
    if (f === 2) for (let e = 0; e < 5; e++) c.put(ox + R() * r * 2, oy + (R() - 0.5) * r * 1.4, 4);
    frames.push(c.paint(RAMP.fire));
  }
  return { name, frames, origin: [ox, oy] };
}

/**
 * An enemy tracer pointing right, origin at its head: a hot white head, the
 * body in the reserved magenta, tapering to a dark tail. Two frames, the
 * second a little longer, for the flicker a moving shot has.
 */
function tracer(name: string, len: number, thick: number): FxSheet {
  const frames: FxFrame[] = [];
  for (let f = 0; f < 2; f++) {
    const L = len + f * 3;
    const w = L + 3;
    const h = thick + 4;
    const c = new Canvas(w, h);
    const cy = (h - 1) / 2;
    for (let x = 1; x < w - 1; x++) {
      const t = (x - 1) / L; // 0 tail .. 1 head
      const half = (thick / 2) * (0.35 + 0.65 * Math.min(1, t * 1.6));
      for (let y = 0; y < h; y++) {
        const d = Math.abs(y - cy) / Math.max(0.5, half);
        if (d > 1) continue;
        const heat = t * (1 - d * 0.6);
        c.put(x, y, 1 + Math.min(3, Math.floor(heat * 4)));
      }
    }
    c.disc(w - 3, cy, thick * 0.32, 4, 1);
    c.rim();
    frames.push(c.paint(RAMP.enemy));
  }
  const oy = Math.floor((thick + 4) / 2);
  return { name, frames, origin: [len + 1, oy], frameOrigins: [[len + 1, oy], [len + 4, oy]] };
}

/**
 * The Crypt King's shot, one sheet a phase (`heartfire_p1`..`_p3`): the fire
 * his palm is lit with in `tele`, not a roster body's magenta orb. A round
 * head with a white-hot core and a four-point glint, as the heart and the
 * palm are drawn, and a flame licked back behind it along the flight; three
 * frames of flicker. Pointing right, origin at the head's centre, whose
 * radius is `HEARTFIRE_HEAD_TX` — the renderer scales that to the shot's
 * hitbox, so what is seen is what hits. No rim: it is fire, not matter.
 */
export const HEARTFIRE_HEAD_TX = 16;
const HEARTFIRE_RAMPS: readonly (readonly Rgb[])[] = [
  // I: the gold of his armoured heart.
  [0x5a1a14, 0xb8481c, 0xf08a2a, 0xffc848, 0xffeca0, 0xfffcec].map(hex),
  // II: darker gold, its tail going to the violet of his cape.
  [0x2a1438, 0x6a2a5a, 0xd06a2a, 0xf4b040, 0xffe290, 0xfff8e0].map(hex),
  // III: the bare heart, burned pale as the bone round it.
  [0x4a3424, 0x9a6a3a, 0xe8b070, 0xf8dcb0, 0xfff4e0, 0xffffff].map(hex),
];

function heartfire(name: string, ramp: readonly Rgb[], seed: number): FxSheet {
  const R = rng(seed);
  const head = HEARTFIRE_HEAD_TX;
  const tail = head * 2.6;
  const w = Math.ceil(head + tail) + 4;
  const h = head * 2 + 10;
  const cx = w - head - 2;
  const cy = h / 2;
  const frames: FxFrame[] = [];
  for (let f = 0; f < 3; f++) {
    const c = new Canvas(w, h);
    // The flame behind: tapering, licking up and down along its length.
    for (let x = Math.floor(cx - tail); x <= cx; x++) {
      const t = (cx - x) / tail; // 0 at the head, 1 at the tip
      const wave = Math.sin(t * 5.2 + f * 2.1) * 3.2 * t;
      const half = head * Math.pow(1 - t, 0.75) * (0.9 + 0.1 * Math.sin(f * 1.7 + t * 9));
      for (let y = 0; y < h; y++) {
        const d = Math.abs(y - cy - wave) / Math.max(0.5, half);
        if (d > 1) continue;
        // Thin at its ends into dither rather than alpha.
        if (d > 0.8 && t > 0.45 && (x + y + f) % 2 === 0) continue;
        const heat = (1 - t) * (1 - d * 0.65);
        c.put(x, y, 1 + Math.min(3, Math.floor(heat * 4)));
      }
    }
    // Tongues torn off the flame, different each frame.
    for (let n = 0; n < 7; n++) {
      const t = 0.25 + R() * 0.75;
      c.put(cx - t * tail, cy + (R() - 0.5) * head * 2 * (1 - t * 0.6), R() < 0.5 ? 2 : 1);
    }
    // The head, banded to a white-hot core just forward of its middle.
    c.disc(cx, cy, head, 3, 2);
    c.disc(cx + 1, cy, head * 0.7, 4, 1);
    c.disc(cx + 2, cy, head * 0.38 + (f === 1 ? 1 : 0), 5, 1);
    // The glint: the four-point star the heart and the palm are drawn with.
    const g = head * (f === 2 ? 0.95 : 0.8);
    c.line(cx + 2 - g, cy, cx + 2 + g, cy, 5);
    c.line(cx + 2, cy - g, cx + 2, cy + g, 5);
    frames.push(c.paint(ramp));
  }
  return { name, frames, origin: [cx, cy] };
}

/**
 * Where one of the king's shots ends — on stone, on the player, or spent in
 * the air — it goes up in a small burst of the same fire (`heartburst_p1`..
 * `_p3`). Small on purpose: at most `HEARTBURST_R_TX` across the radius, a
 * little over the shot's own head, so a volley breaking on a wall is a row of
 * pops and never a curtain. It is a picture only; nothing in it hurts.
 * Four frames: a white flash, the fireball, flames torn outward, embers.
 */
export const HEARTBURST_R_TX = 24;

function heartburst(name: string, ramp: readonly Rgb[], seed: number): FxSheet {
  const R = rng(seed);
  const r = HEARTBURST_R_TX;
  const size = r * 2 + 6;
  const c0 = size / 2;
  const tongues = Array.from({ length: 9 }, (_, i) => ({ a: (i / 9) * Math.PI * 2 + R() * 0.5, l: 0.7 + R() * 0.3 }));
  const frames: FxFrame[] = [];
  for (let f = 0; f < 4; f++) {
    const c = new Canvas(size, size);
    if (f === 0) {
      c.disc(c0, c0, r * 0.45, 5, 2);
      for (const t of tongues) c.line(c0, c0, c0 + Math.cos(t.a) * r * 0.6 * t.l, c0 + Math.sin(t.a) * r * 0.6 * t.l, 4);
    } else if (f === 1) {
      c.disc(c0, c0, r * 0.85, 4, 3, true);
      c.disc(c0, c0, r * 0.4, 5, 1);
      for (const t of tongues) c.line(c0, c0, c0 + Math.cos(t.a) * r * t.l, c0 + Math.sin(t.a) * r * t.l, 3, 2);
    } else if (f === 2) {
      // Hollowing out: flames at the edge, the middle burned through.
      for (const t of tongues) {
        c.disc(c0 + Math.cos(t.a) * r * t.l * 0.72, c0 + Math.sin(t.a) * r * t.l * 0.72, r * 0.17, 3, 2, true);
        c.put(c0 + Math.cos(t.a) * r * t.l, c0 + Math.sin(t.a) * r * t.l, 1);
      }
      c.disc(c0, c0 - 1, r * 0.34, 2, 1, true);
    } else {
      for (const t of tongues) {
        c.put(c0 + Math.cos(t.a) * r * t.l, c0 + Math.sin(t.a) * r * t.l - 2, R() < 0.5 ? 3 : 2);
        if (R() < 0.6) c.put(c0 + Math.cos(t.a) * r * t.l * 0.7, c0 + Math.sin(t.a) * r * t.l * 0.7 - 3, 1);
      }
    }
    frames.push(c.paint(ramp));
  }
  return { name, frames, origin: [c0, c0] };
}

/** Sparks and grit where a shot meets stone, facing right (back toward the shooter). */
function wallHit(name: string, seed: number): FxSheet {
  const w = 26;
  const h = 26;
  const ox = 4;
  const oy = 13;
  const R = rng(seed);
  const sparks = Array.from({ length: 6 }, () => ({ a: (R() - 0.5) * 2.2, v: 0.6 + R() * 0.6 }));
  const frames: FxFrame[] = [];
  for (let f = 0; f < 4; f++) {
    const c = new Canvas(w, h);
    if (f === 0) {
      c.disc(ox + 2, oy, 4, 3, 2);
      for (const s of sparks) c.line(ox, oy, ox + Math.cos(s.a) * 8 * s.v, oy + Math.sin(s.a) * 8 * s.v, 2);
      frames.push(c.paint(RAMP.spark));
      continue;
    }
    const dust = new Canvas(w, h);
    for (const s of sparks) {
      const d = 6 + f * 5 * s.v;
      if (f < 3) c.line(ox + Math.cos(s.a) * (d - 3), oy + Math.sin(s.a) * (d - 3), ox + Math.cos(s.a) * d, oy + Math.sin(s.a) * d + f * 0.6, 3 - f);
    }
    for (let p = 0; p < 4; p++) dust.disc(ox + 3 + f * 2 + R() * 5, oy + (R() - 0.5) * 8 - f, 2 + f * 1.1, 3 - (f === 3 ? 1 : 0), 3, f === 3);
    // Grit under the sparks: the two are separate ramps, merged by painting.
    const a = c.paint(RAMP.spark);
    const b = dust.paint(RAMP.dust);
    frames.push(merge(b, a));
  }
  return { name, frames, origin: [ox, oy] };
}

/** A shot spent in the air: its magenta pinches to a ring and out. */
function fizzle(name: string): FxSheet {
  const frames: FxFrame[] = [];
  for (let f = 0; f < 3; f++) {
    const c = new Canvas(16, 16);
    const r = 3 + f * 2;
    for (let a = 0; a < 16; a++) {
      if (f === 2 && a % 2) continue;
      const t = (a / 16) * Math.PI * 2;
      c.put(8 + Math.cos(t) * r, 8 + Math.sin(t) * r, 3 - f);
    }
    if (f === 0) c.disc(8, 8, 2, 4, 1);
    frames.push(c.paint(RAMP.enemy));
  }
  return { name, frames, origin: [8, 8] };
}

/** The player struck: a white star, then a red ring throwing shards. */
function hurtBurst(name: string, seed: number): FxSheet {
  const R = rng(seed);
  const shards = Array.from({ length: 8 }, (_, i) => ({ a: (i / 8) * Math.PI * 2 + R() * 0.5, v: 0.7 + R() * 0.5 }));
  const frames: FxFrame[] = [];
  for (let f = 0; f < 4; f++) {
    const c = new Canvas(36, 36);
    if (f === 0) {
      c.disc(18, 18, 6, 4, 2);
      for (const s of shards) c.line(18, 18, 18 + Math.cos(s.a) * 13 * s.v, 18 + Math.sin(s.a) * 13 * s.v, 3, 2);
    } else {
      const r = 6 + f * 4;
      for (let a = 0; a < 56; a++) {
        if (f === 3 && a % 3 === 0) continue;
        const t = (a / 56) * Math.PI * 2;
        for (const dr of f === 3 ? [0] : [0, 1]) c.put(18 + Math.cos(t) * (r + dr), 18 + Math.sin(t) * (r + dr), Math.max(1, 4 - f));
      }
      for (const s of shards) {
        const d = 8 + f * 4 * s.v;
        c.line(18 + Math.cos(s.a) * d, 18 + Math.sin(s.a) * d, 18 + Math.cos(s.a) * (d + 3), 18 + Math.sin(s.a) * (d + 3), Math.max(1, 3 - f));
      }
    }
    frames.push(c.paint(RAMP.hurt));
  }
  return { name, frames, origin: [18, 18] };
}

/** A puff of smoke: a banded blob, lit from above, growing and breaking up. */
function smoke(name: string, seed: number): FxSheet {
  const R = rng(seed);
  const lobes = Array.from({ length: 5 }, () => ({ x: (R() - 0.5) * 8, y: (R() - 0.5) * 6, r: 3 + R() * 3 }));
  const frames: FxFrame[] = [];
  for (let f = 0; f < 4; f++) {
    const c = new Canvas(28, 28);
    const g = 0.8 + f * 0.35;
    for (const l of lobes) {
      c.disc(14 + l.x * g, 15 + l.y * g - f, l.r * g, 2, 2, f >= 2);
      c.disc(14 + l.x * g - 1, 15 + l.y * g - f - 1.5, l.r * g * 0.6, 3 - (f === 3 ? 1 : 0), 1, f >= 2);
    }
    frames.push(c.paint(RAMP.smoke));
  }
  return { name, frames, origin: [14, 15] };
}

/**
 * The warden's blast, pointing right, origin at the muzzle on the left: after
 * Metal Slug's shotgun, a fan of grain narrow at the gun and wide at the far
 * end over a dithered pale body, which flies apart, cools, and becomes smoke
 * at the far end. `len` and `spreadDeg` match the sim's reach and cone.
 */
function blast(name: string, len: number, spreadDeg: number, seed: number): FxSheet {
  const half = (spreadDeg / 2) * Math.PI / 180;
  const w = len + 16;
  const h = Math.ceil(Math.sin(half) * len * 2) + 20;
  const ox = 2;
  const oy = Math.floor(h / 2);
  const R = rng(seed);
  // A ragged far edge: the reach wobbles with angle, so the end is a burst, not an arc.
  const edge = Array.from({ length: 24 }, () => 0.78 + R() * 0.3);
  const edgeAt = (a: number) => {
    const t = ((a + half) / (2 * half)) * (edge.length - 1);
    const i = Math.max(0, Math.min(edge.length - 2, Math.floor(t)));
    const k = t - i;
    return edge[i]! * (1 - k) + edge[i + 1]! * k;
  };
  // A coarse value noise for the body's density.
  const N = 12;
  const grid = Array.from({ length: N * N }, () => R());
  const noise = (x: number, y: number) => {
    const gx = (x / w) * (N - 1);
    const gy = (y / h) * (N - 1);
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const fx = gx - i;
    const fy = gy - j;
    const at = (a: number, b: number) => grid[Math.min(N - 1, b) * N + Math.min(N - 1, a)]!;
    return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
  };
  const grains = Array.from({ length: 1100 }, () => {
    const along = Math.sqrt(R());
    // Bunched toward the middle line: the product of two uniforms leans to zero.
    const lateral = (R() * 2 - 1) * (0.35 + 0.65 * R());
    return { along, off: lateral * half * (0.25 + 0.75 * along), s: R() > 0.9 ? 2 : 1, heat: R(), drift: R() };
  });
  const clouds = Array.from({ length: 16 }, () => ({ off: (R() * 2 - 1) * half * 0.85, d: 0.35 + R() * 0.62, r: 4 + R() * 6 }));
  const frames: FxFrame[] = [];
  for (let f = 0; f < 6; f++) {
    const light = new Canvas(w, h);
    if (f < 2) {
      // The body: its density from noise and from the middle line, thinning
      // out toward the rim and the far end; hottest near the gun.
      for (let y = 0; y < h; y++)
        for (let x = ox; x < w; x++) {
          const d = Math.hypot(x - ox, y - oy);
          const a = Math.atan2(y - oy, x - ox);
          const lim = half * (0.28 + 0.72 * (d / len));
          if (Math.abs(a) > lim || d > len * edgeAt(a)) continue;
          const mid = 1 - Math.abs(a) / lim;
          const p = (0.25 + 0.75 * mid) * (0.55 + 0.6 * noise(x, y)) * (f === 0 ? 1 : 0.55) * (1 - 0.35 * (d / len));
          const bayer = [0, 0.5, 0.75, 0.25][(x % 2) + 2 * (y % 2)]!;
          if (p <= bayer) continue;
          light.put(x, y, d < len * 0.25 && mid > 0.4 ? 4 : mid > 0.55 ? 3 : 2);
        }
    }
    for (const g of grains) {
      if (f >= 4) break;
      const reach = len * edgeAt(g.off) * 1.04;
      const d = g.along * reach * (1 + f * 0.07 * g.drift);
      const x = ox + Math.cos(g.off) * d;
      const y = oy + Math.sin(g.off) * d - f * g.drift * 2.5;
      if (x > w - 2) continue;
      const mid = 1 - Math.abs(g.off) / half;
      const hot = f === 0 ? (mid > 0.5 || g.heat > 0.6 ? 4 : 3)
        : f === 1 ? (g.heat > 0.55 ? 4 : 3)
        : f === 2 ? (g.heat > 0.7 ? 3 : 2) : 1;
      if (f >= 2 && g.heat < 0.35) continue;
      if (f === 3 && g.heat < 0.7) continue;
      for (let a = 0; a < g.s; a++) for (let b = 0; b < g.s; b++) light.put(x + a, y + b, hot);
    }
    const lit = light.paint(RAMP.blast);
    const cloud = new Canvas(w, h);
    if (f >= 2) {
      const k = (f - 2) / 3;
      for (const cl of clouds) {
        const x = ox + Math.cos(cl.off) * len * cl.d + k * 6;
        const y = oy + Math.sin(cl.off) * len * cl.d - k * 7;
        const r = cl.r * (0.7 + 0.7 * k);
        cloud.disc(x, y, r, f === 5 ? 1 : 2, 2, f >= 4);
        cloud.disc(x - 1, y - 2, r * 0.55, f === 5 ? 2 : 3, 1, f >= 4);
      }
    }
    frames.push(merge(cloud.paint(RAMP.smoke), lit));
  }
  return { name, frames, origin: [ox, oy] };
}

/** Paints `top` over `base` where `top` has a pixel. */
function merge(base: FxFrame, top: FxFrame): FxFrame {
  const data = new Uint8ClampedArray(base.data);
  for (let k = 0; k < data.length; k += 4) if (top.data[k + 3]! > 0) data.set(top.data.subarray(k, k + 4), k);
  return { w: base.w, h: base.h, data };
}

/** Every sheet, keyed by name. `blastLen` is the warden's reach in texels. */
/** The floor tile's size in texels: one world tile, at half a world pixel a texel. */
const TILE_TX = 64;

/** How many frames the lava loop has. */
export const LAVA_FRAMES = 32;
/** The lava field is two tiles long, so a channel repeats half as often; each cell takes one half. */
const LAVA_W = TILE_TX * 2;
const LAVA_DRIFT = LAVA_W / LAVA_FRAMES;

/**
 * Lava, flowing along x in a loop of `LAVA_FRAMES`, after the pixel games that
 * draw it well: **one flat orange**, with flecks a shade lighter and a few a
 * shade darker drifting on it at two speeds. What makes it lava is its edge,
 * drawn by the scene (`groundEdges`): a ragged bank of dark stone biting into
 * it and a band of brighter melt along the bank. Two tiles long and cut in
 * halves (`lava` and `lavab`), alternating along a channel.
 *
 * Three versions came first and each was busier inside than at its edge —
 * yellow blobs boiling in place, cracked plates of crust that read as
 * beetles, a dark melt with ripples that read as a rust-coloured rug.
 * Everything moves a whole number of fields over the loop and wraps on x, so
 * every cell shows the same frame and the flow is continuous; a channel
 * running north–south is the tile turned.
 */
function lavaField(): Canvas[] {
  const R = rng(91);
  // Flecks: short dashes a shade off the body, a few darker, drifting slowly.
  const flecks = Array.from({ length: 34 }, () => ({
    x: R() * LAVA_W, y: 4 + R() * (TILE_TX - 8), len: 2 + Math.floor(R() * 4), dark: R() < 0.3, fast: R() < 0.4,
  }));
  const out: Canvas[] = [];
  for (let f = 0; f < LAVA_FRAMES; f++) {
    const c = new Canvas(LAVA_W, TILE_TX);
    const shift = f * LAVA_DRIFT;
    for (let y = 0; y < TILE_TX; y++) for (let x = 0; x < LAVA_W; x++) c.put(x, y, 3);
    for (const fl of flecks) {
      const x0 = fl.x + shift * (fl.fast ? 2 : 1);
      for (let k = 0; k < fl.len; k++) {
        const wx = ((Math.round(x0 + k) % LAVA_W) + LAVA_W) % LAVA_W;
        c.idx[Math.round(fl.y) * LAVA_W + wx] = fl.dark ? 2 : 4;
      }
    }
    out.push(c);
  }
  return out;
}

function lavaHalves(): [FxSheet, FxSheet] {
  const field = lavaField();
  const half = (off: number): FxFrame[] => field.map((c) => {
    const h = new Canvas(TILE_TX, TILE_TX);
    for (let y = 0; y < TILE_TX; y++) for (let x = 0; x < TILE_TX; x++) h.idx[y * TILE_TX + x] = c.idx[y * LAVA_W + x + off]!;
    return h.paint(RAMP.lava);
  });
  return [{ name: "lava", frames: half(0), origin: [0, 0] }, { name: "lavab", frames: half(TILE_TX), origin: [0, 0] }];
}

/** Grass over a floor tile: a dark ground of it, then tufts of blades lit at the tip. Two variants. */
function grass(name: string, seed: number): FxSheet {
  const frames: FxFrame[] = [];
  for (let v = 0; v < 2; v++) {
    const R = rng(seed + v * 17);
    const c = new Canvas(TILE_TX, TILE_TX);
    for (let y = 0; y < TILE_TX; y++) for (let x = 0; x < TILE_TX; x++) c.put(x, y, R() < 0.18 ? 0 : 1);
    for (let n = 0; n < 70; n++) {
      const x = Math.floor(R() * TILE_TX), y = 4 + Math.floor(R() * (TILE_TX - 4));
      const h = 3 + Math.floor(R() * 4), lean = R() < 0.5 ? -1 : 1;
      for (let k = 0; k < h; k++) c.put(x + (k > h / 2 ? lean : 0), y - k, k === h - 1 ? 5 : k > h / 2 ? 4 : 3);
      if (R() < 0.5) for (let k = 0; k < h - 1; k++) c.put(x - lean, y - k, k === h - 2 ? 4 : 2);
    }
    frames.push(c.paint(RAMP.grass));
  }
  return { name, frames, origin: [0, 0] };
}

/**
 * Burnt grass: charred ground, ash and stubble; and while it is still
 * burning, two frames of embers glowing through it.
 */
function char(name: string, seed: number, embers: boolean): FxSheet {
  const frames: FxFrame[] = [];
  for (let v = 0; v < 2; v++) {
    const R = rng(seed + v * 13);
    const c = new Canvas(TILE_TX, TILE_TX);
    for (let y = 0; y < TILE_TX; y++) for (let x = 0; x < TILE_TX; x++) c.put(x, y, R() < 0.25 ? 0 : 1);
    for (let n = 0; n < 40; n++) {
      const x = Math.floor(R() * TILE_TX), y = 3 + Math.floor(R() * (TILE_TX - 3));
      const h = 1 + Math.floor(R() * 2);
      for (let k = 0; k < h; k++) c.put(x, y - k, 2);
      if (R() < 0.35) c.put(x + 1, y, 4);
    }
    if (embers) for (let n = 0; n < 26; n++) {
      const x = Math.floor(R() * TILE_TX), y = Math.floor(R() * TILE_TX);
      c.put(x, y, R() < 0.4 ? 6 : 5);
      if (R() < 0.5) c.put(x + 1, y, 5);
    }
    frames.push(c.paint(RAMP.char));
  }
  return { name, frames, origin: [0, 0] };
}

export function bakeSheets(opts: { blastLen: number; blastSpreadDeg: number }): FxSheet[] {
  return [
    muzzle("muzzle_s", 5, 11),
    muzzle("muzzle_m", 8, 12),
    muzzle("muzzle_l", 12, 13),
    tracer("tracer_s", 14, 6),
    tracer("tracer_l", 22, 8),
    ...HEARTFIRE_RAMPS.map((ramp, i) => heartfire(`heartfire_p${i + 1}`, ramp, 91 + i)),
    ...HEARTFIRE_RAMPS.map((ramp, i) => heartburst(`heartburst_p${i + 1}`, ramp, 101 + i)),
    wallHit("hit_wall", 21),
    fizzle("fizzle"),
    hurtBurst("hit_player", 31),
    smoke("smoke", 41),
    blast("blast", opts.blastLen, opts.blastSpreadDeg, 51),
    ...lavaHalves(),
    grass("grass", 61),
    char("grass_burnt", 71, false),
    char("grass_burning", 81, true),
  ];
}
