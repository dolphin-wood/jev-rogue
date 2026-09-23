/**
 * The player's spell projectiles, drawn in code: one shape per kind of spell,
 * and the particles each one sheds in flight.
 *
 * Most spells flew as the same round sprite in a different tint, so a frost
 * needle, a venom spit and a fire dart were three coloured balls. A spell's
 * shape is most of how it is recognised in a busy frame — the needle is thin
 * and fast, the spike is heavy and faceted, the flame licks backward, the rock
 * tumbles — so each kind has its own silhouette, pointed along its flight, and
 * its own trail of particles: embers rise off fire, frost hangs behind ice,
 * venom drips, sparks crackle round lightning, and a void orb draws motes in.
 *
 * Presentation only. Shapes wobble on the tick and particles use
 * `Math.random`, because nothing here is read back by the simulation.
 */
import type { Bullet } from "@jr/core";

export type ProjectileShape =
  | "dart" | "lightning" | "orb" | "needle" | "spike" | "flame" | "glob"
  | "rock" | "pellet" | "spark" | "blade" | "bubbles";

export interface ProjectileLook {
  readonly core: number;
  readonly glow: number;
  readonly shape: ProjectileShape;
}

/** One particle a projectile throws off; the scene owns the pool. */
export interface ShedParticle {
  x: number; y: number; vx: number; vy: number;
  ms: number; life: number; size: number; colour: number; gravity: number;
}

type Emit = (p: ShedParticle) => void;
type Pt = readonly [number, number];

/** Rotates local points (x forward along the flight) into place. */
function place(b: Bullet, angle: number, pts: readonly Pt[], scale = 1): [number, number][] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return pts.map(([x, y]) => [b.x + (x * c - y * s) * scale, b.y + (x * s + y * c) * scale]);
}

function fillPoly(g: Phaser.GameObjects.Graphics, pts: readonly (readonly [number, number])[], colour: number, alpha: number): void {
  if (pts.length < 3) return;
  g.fillStyle(colour, alpha);
  g.beginPath();
  g.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
  g.closePath();
  g.fillPath();
}

/** A teardrop along the flight: a round head of radius `r`, tapering to a tail `len` behind. */
function comet(r: number, len: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = -6; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  pts.push([-len * 0.35, r * 0.55], [-len, 0], [-len * 0.35, -r * 0.55]);
  return pts;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Draws one projectile. `glow` is additive (the light), `solid` is normal
 * blend (anything that should read as matter — a rock). Particles go to `emit`.
 */
export function drawProjectile(
  glow: Phaser.GameObjects.Graphics, solid: Phaser.GameObjects.Graphics,
  b: Bullet, look: ProjectileLook, tick: number, emit: Emit,
): void {
  // A stable per-shot number, from where it was cast, so its wobble and
  // tumble are its own rather than every shot's in step.
  const id = Math.abs(Math.floor(b.originX * 7.3 + b.originY * 13.1)) % 97;
  const speed = Math.hypot(b.vx, b.vy);
  const angle = speed > 1 ? Math.atan2(b.vy, b.vx) : (id % 8) * 0.785;
  const back = speed > 1 ? [-b.vx / speed, -b.vy / speed] as const : [0, 0] as const;
  const s = Math.max(0.7, b.radius / 4);
  const wob = Math.sin(tick / 3 + id);

  switch (look.shape) {
    case "dart": {
      // An arcane comet: a bright head and a tapering tail, with motes left behind.
      fillPoly(glow, place(b, angle, comet(4.2, 16), s), look.glow, 0.22);
      fillPoly(glow, place(b, angle, comet(2.6, 11), s), look.glow, 0.5);
      fillPoly(glow, place(b, angle, comet(1.4, 6), s), look.core, 0.95);
      if (Math.random() < 0.5)
        emit({ x: b.x + back[0] * 5, y: b.y + back[1] * 5, vx: rand(-15, 15), vy: rand(-15, 15), ms: 0, life: rand(160, 260), size: rand(0.8, 1.3), colour: look.glow, gravity: 0 });
      return;
    }
    case "needle": {
      // A thin diamond of ice, white along its spine, frost hanging behind.
      const body: Pt[] = [[9, 0], [1, 1.9], [-8, 0], [1, -1.9]];
      fillPoly(glow, place(b, angle, [[12, 0], [1, 4], [-11, 0], [1, -4]], s), look.glow, 0.2);
      fillPoly(glow, place(b, angle, body, s), look.glow, 0.6);
      fillPoly(glow, place(b, angle, [[9, 0], [1, 0.7], [-6, 0], [1, -0.7]], s), 0xffffff, 0.95);
      frost(b, back, look, emit, 0.7);
      return;
    }
    case "spike": {
      // A heavy faceted crystal: a lit face, a shadowed face, a white ridge.
      const tipX = 13;
      const upper: Pt[] = [[tipX, 0], [4, -4.2], [-9, -2.6], [-12, 0]];
      const lower: Pt[] = [[tipX, 0], [-12, 0], [-9, 2.6], [4, 4.2]];
      fillPoly(glow, place(b, angle, [[tipX + 4, 0], [4, -7], [-14, -4], [-16, 0], [-14, 4], [4, 7]], s), look.glow, 0.22);
      fillPoly(glow, place(b, angle, upper, s), 0xcfefff, 0.75);
      fillPoly(glow, place(b, angle, lower, s), look.glow, 0.6);
      const ridge = place(b, angle, [[tipX, 0], [-11, 0]], s);
      glow.lineStyle(1.1, 0xffffff, 0.95);
      glow.lineBetween(ridge[0]![0], ridge[0]![1], ridge[1]![0], ridge[1]![1]);
      frost(b, back, look, emit, 1.4);
      return;
    }
    case "flame": {
      // A fireball: a hot core and tongues licking back, flickering, and embers rising.
      const r = 3.2 * s;
      for (let k = 0; k < 3; k++) {
        const len = (10 + 5 * Math.sin(tick / 2 + k * 2.1 + id)) * s;
        const off = (k - 1) * 1.6 * s;
        const tongue = place(b, angle, [[r * 0.2, off - r * 0.8], [-len, off * 1.6], [r * 0.2, off + r * 0.8]]);
        // Matter, not light: additive red over a cold floor turns magenta.
        fillPoly(solid, tongue, k === 1 ? 0xff8a2a : 0xe0401a, 0.8);
      }
      glow.fillStyle(0xff9a3a, 0.22);
      glow.fillCircle(b.x, b.y, r * 2.1);
      solid.fillStyle(0xffa83a, 0.95);
      solid.fillCircle(b.x, b.y, r * 1.05);
      solid.fillStyle(0xfff0c0, 1);
      solid.fillCircle(b.x + Math.cos(angle) * r * 0.25, b.y + Math.sin(angle) * r * 0.25, r * 0.55);
      if (Math.random() < 0.7)
        emit({ x: b.x + back[0] * r + rand(-2, 2), y: b.y + back[1] * r + rand(-2, 2), vx: back[0] * 30 + rand(-20, 20), vy: back[1] * 30 + rand(-30, 0), ms: 0, life: rand(220, 380), size: rand(0.8, 1.4), colour: Math.random() < 0.5 ? 0xffc85a : 0xff7a2a, gravity: -90 });
      return;
    }
    case "glob": {
      // A venom droplet, wobbling, with a highlight, dripping as it flies.
      const squash = 1 + 0.12 * wob;
      const drop = comet(3.4 * squash, 9);
      fillPoly(glow, place(b, angle, comet(5.2, 13), s), look.glow, 0.2);
      fillPoly(solid, place(b, angle, drop, s), 0x4fbf3a, 0.9);
      glow.fillStyle(0xf2ffe0, 0.85);
      glow.fillCircle(b.x - Math.sin(angle) * 1.2 * s + Math.cos(angle) * 1 * s, b.y + Math.cos(angle) * 1.2 * s * -1 + Math.sin(angle) * s, 1.1 * s);
      if (Math.random() < 0.35)
        emit({ x: b.x + rand(-2, 2), y: b.y + rand(-1, 2), vx: rand(-10, 10), vy: rand(10, 30), ms: 0, life: rand(260, 420), size: rand(0.9, 1.5), colour: look.glow, gravity: 160 });
      return;
    }
    case "bubbles": {
      // A cluster of poison bubbles orbiting each other, each with a rim and a glint.
      for (let k = 0; k < 3; k++) {
        const a = tick / 6 + (k * Math.PI * 2) / 3 + id;
        const cx = b.x + Math.cos(a) * 2.6 * s;
        const cy = b.y + Math.sin(a) * 2.6 * s;
        const r = (2.4 + 0.5 * Math.sin(tick / 4 + k)) * s;
        glow.fillStyle(look.glow, 0.28);
        glow.fillCircle(cx, cy, r * 1.5);
        glow.lineStyle(1, look.core, 0.8);
        glow.strokeCircle(cx, cy, r);
        glow.fillStyle(0xffffff, 0.8);
        glow.fillCircle(cx - r * 0.35, cy - r * 0.35, 0.7);
      }
      if (Math.random() < 0.4)
        emit({ x: b.x + rand(-3, 3), y: b.y + rand(-3, 3), vx: rand(-8, 8), vy: rand(-25, -5), ms: 0, life: rand(300, 500), size: rand(0.8, 1.3), colour: look.glow, gravity: -20 });
      return;
    }
    case "rock": {
      // A tumbling chunk of stone: irregular, solid, lit on one side, trailing dust.
      const n = 7;
      const spin = tick / 5 + id;
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = spin + (i / n) * Math.PI * 2;
        const r = (3.6 + 1.1 * Math.sin(i * 2.7 + id)) * s;
        pts.push([b.x + Math.cos(a) * r, b.y + Math.sin(a) * r]);
      }
      fillPoly(solid, pts.map(([x, y]) => [b.x + (x - b.x) * 1.25, b.y + (y - b.y) * 1.25] as [number, number]), 0x0d0b1f, 0.55);
      fillPoly(solid, pts, 0x8a6a48, 1);
      fillPoly(solid, pts.slice(0, 4).concat([[b.x, b.y]]), 0xc8a878, 1);
      if (Math.random() < 0.4)
        emit({ x: b.x + back[0] * 3, y: b.y + back[1] * 3, vx: rand(-12, 12), vy: rand(-12, 12), ms: 0, life: rand(200, 320), size: rand(1, 1.8), colour: 0x6a5a48, gravity: 20 });
      return;
    }
    case "pellet": {
      // A tracer: a short bright streak and a hot head.
      const len = 9 * s;
      glow.lineStyle(2.6 * s, look.glow, 0.35);
      glow.lineBetween(b.x, b.y, b.x + back[0] * len, b.y + back[1] * len);
      glow.lineStyle(1.1 * s, look.core, 0.95);
      glow.lineBetween(b.x, b.y, b.x + back[0] * len * 0.7, b.y + back[1] * len * 0.7);
      glow.fillStyle(0xffffff, 0.95);
      glow.fillCircle(b.x, b.y, 1.2 * s);
      return;
    }
    case "spark": {
      // A crackling spark: a tiny jagged filament that never holds its shape.
      const pts: [number, number][] = [[b.x, b.y]];
      let x = b.x;
      let y = b.y;
      for (let k = 0; k < 3; k++) {
        x += back[0] * 3.5 * s + rand(-2, 2);
        y += back[1] * 3.5 * s + rand(-2, 2);
        pts.push([x, y]);
      }
      glow.lineStyle(2.2, look.glow, 0.4);
      for (let k = 1; k < pts.length; k++) glow.lineBetween(pts[k - 1]![0], pts[k - 1]![1], pts[k]![0], pts[k]![1]);
      glow.lineStyle(0.9, 0xffffff, 0.95);
      for (let k = 1; k < pts.length; k++) glow.lineBetween(pts[k - 1]![0], pts[k - 1]![1], pts[k]![0], pts[k]![1]);
      glow.fillStyle(0xffffff, 1);
      glow.fillCircle(b.x, b.y, 1.3);
      if (Math.random() < 0.4) crackle(b.x, b.y, look, emit, 1);
      return;
    }
    case "blade": {
      // A small flying knife of light, turning as it goes.
      const a = angle + Math.sin(tick / 4 + id) * 0.25;
      const knife: Pt[] = [[8, 0], [2, 2.2], [-6, 1.2], [-7, 0], [-6, -1.2], [2, -2.2]];
      fillPoly(glow, place(b, a, knife, s * 1.5), look.glow, 0.25);
      fillPoly(glow, place(b, a, knife, s), look.glow, 0.65);
      fillPoly(glow, place(b, a, [[8, 0], [1, 0.6], [-5, 0], [1, -0.6]], s), 0xffffff, 0.9);
      return;
    }
    case "orb": {
      // A void orb: a dark heart, a turning ring, motes falling into it.
      const r = 4.2 * s;
      glow.fillStyle(look.glow, 0.2);
      glow.fillCircle(b.x, b.y, r * 2.2);
      glow.fillStyle(look.glow, 0.45);
      glow.fillCircle(b.x, b.y, r * 1.2);
      solid.fillStyle(0x1a0b2e, 0.85);
      solid.fillCircle(b.x, b.y, r * 0.7);
      for (let k = 0; k < 2; k++) {
        const a0 = tick / 7 + k * Math.PI;
        glow.lineStyle(1.3, look.core, 0.85);
        glow.beginPath();
        glow.arc(b.x, b.y, r * (1.05 + 0.2 * k), a0, a0 + 1.9);
        glow.strokePath();
      }
      if (Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        const d = r * 3;
        emit({ x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d, vx: -Math.cos(a) * d * 3 + b.vx, vy: -Math.sin(a) * d * 3 + b.vy, ms: 0, life: 280, size: rand(0.8, 1.3), colour: look.core, gravity: 0 });
      }
      return;
    }
    case "lightning":
      // Drawn by the scene as a bolt along its path; here only its crackle.
      if (Math.random() < 0.8) crackle(b.x, b.y, look, emit, 2);
      return;
  }
}

/** Frost hanging behind an ice shot, and the odd glint. */
function frost(b: Bullet, back: readonly [number, number], look: ProjectileLook, emit: Emit, amount: number): void {
  if (Math.random() < 0.6 * amount)
    emit({ x: b.x + back[0] * 6 + rand(-2, 2), y: b.y + back[1] * 6 + rand(-2, 2), vx: back[0] * 10 + rand(-8, 8), vy: back[1] * 10 + rand(-8, 8), ms: 0, life: rand(300, 520), size: rand(1.2, 2.2), colour: 0x9fd6ff, gravity: 8 });
  if (Math.random() < 0.3 * amount)
    emit({ x: b.x + rand(-4, 4), y: b.y + rand(-4, 4), vx: rand(-5, 5), vy: rand(-5, 5), ms: 0, life: rand(180, 280), size: rand(0.6, 1), colour: 0xffffff, gravity: 0 });
}

/** Sparks jumping off a charged point in random directions. */
function crackle(x: number, y: number, look: ProjectileLook, emit: Emit, n: number): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = rand(60, 160);
    emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ms: 0, life: rand(80, 160), size: rand(0.7, 1.2), colour: Math.random() < 0.5 ? 0xffffff : look.glow, gravity: 0 });
  }
}

/**
 * A few short jagged arcs round a lightning shot's head, redrawn each frame:
 * the charge the bolt carries, reaching for something to jump to.
 */
export function drawCrackle(g: Phaser.GameObjects.Graphics, x: number, y: number, look: ProjectileLook): void {
  for (let k = 0; k < 2; k++) {
    if (Math.random() < 0.4) continue;
    let a = Math.random() * Math.PI * 2;
    let px = x;
    let py = y;
    g.lineStyle(0.9, Math.random() < 0.5 ? 0xffffff : look.glow, 0.85);
    for (let i = 0; i < 3; i++) {
      a += rand(-0.8, 0.8);
      const nx = px + Math.cos(a) * rand(2.5, 5);
      const ny = py + Math.sin(a) * rand(2.5, 5);
      g.lineBetween(px, py, nx, ny);
      px = nx;
      py = ny;
    }
  }
}
