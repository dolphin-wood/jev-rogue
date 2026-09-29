/**
 * Fire, drawn in code (doc 008, "Effects").
 *
 * Burning ground was a sprite, and a sprite of a fire cannot be layered: it
 * sat at the floor's depth, so a body standing in the fire covered the flames
 * and stood on a picture of fire rather than in one. A fire has a **back**
 * and a **front**. The flames on the far side of the patch are behind whoever
 * stands in it and the flames on the near side lick up over their feet, and
 * that split is the whole of what makes a body read as inside it. So a fire
 * is six layers at four depths:
 *
 * | layer | depth | what |
 * |---|---|---|
 * | char | 1.9 | the floor burnt dark; outlives the fire and fades |
 * | coals | 1.95 | a flickering bed of hot pixels, additive |
 * | floor light | 2 | the light the fire throws on the stone round it, additive |
 * | back tongues | 5.8 | flames rising from the far half, under every body |
 * | front tongues | 8.6 | flames from the near half, over every body, additive so a body shows through |
 * | sparks, smoke | 8.7, 8.8 | embers thrown up, and a thin smoke |
 *
 * A **poison cloud** is a `Fire` of the poison element and is drawn by the
 * same slots with none of a fire's layers: a wet green bed that bubbles, gas
 * puffs behind and in front of the bodies, and no tongues, sparks, smoke,
 * light or scorch (`cloud`).
 *
 * ### Cost
 *
 * The scene rebuilds most of what it draws every frame; this does not.
 * Flames are particles from **eight emitters for the whole room**, emitted by
 * hand (`emitParticleAt`) at a rate per fire, so there is one pooled particle
 * system per layer whatever the number of fires and nothing is allocated per
 * frame. The floor layers are three images per fire **slot**, created once
 * for the sim's fixed pool and reused. The emission rate is shared out when
 * many fires burn at once (`BUDGET_FIRES`), so a room full of fire costs what
 * a few do.
 *
 * ### Pixels
 *
 * Every texture is drawn here at the art's own pixel size — half a world
 * pixel, the size a delivered sprite's pixel is on screen — in flat bands,
 * no gradients. A tongue has four bands baked in, rim to core, so each flame
 * has a dark edge and a hot heart, which is what reads as fire rather than as
 * an orange blob; over its life it is only multiplied darker and redder.
 * Flames are **opaque**: additive flames over a pale floor wash out to white.
 * Their alpha fades in steps, as a sprite's frames would.
 */
import Phaser from "phaser";
import type { Fire, World } from "@jr/core";
import { fireProgress } from "@jr/core";

/** The fire texture's pixel, in world pixels: it is baked at two texels to one. */
const PX = 0.5;
const TEX = "fx_fire";

/** Past this many live fires, each one's emission is scaled down so the total holds. */
const BUDGET_FIRES = 6;
/** The share of a player fire's life over which it kindles to full flame (`burn`). */
const KINDLE_SHARE = 0.14;
/** How long the char outlives its fire. */
const CHAR_FADE_MS = 2600;

/**
 * A flame's four bands, rim to core, baked into its texture. Enemy fire is
 * red at the rim; the player's is gold, so two fires on one floor say whose
 * they are.
 */
const BANDS_ENEMY = [0xa8201a, 0xe8521f, 0xffa23a, 0xfff0b8];
const BANDS_PLAYER = [0xc26a18, 0xffa630, 0xffd96a, 0xffffff];
/** What a flame is multiplied by over its life: itself, then cooling to a dark red. */
const COOLING = [0xffffff, 0xfff0e0, 0xffb090, 0xd05038];
/** The bed a cloud sits on: the coals' texture, tinted a dark wet green, not lit. */
const BED_POISON = 0x6fcf52;
/** Frost's bed: a pale rime over the floor, and the blue under it. */
const BED_FROST = 0xd8f4ff;
const GLOW_FROST = 0x5aa8d8;
const GLOW_ENEMY = 0xff5a1e;
const GLOW_PLAYER = 0xffb040;

/* ------------------------------- the textures ------------------------------- */

/*
 * A tongue, 18 x 36 art pixels: a teardrop leaning a little to one side,
 * banded by distance from its edge — rim, body, inner, core — with the core
 * low in the flame, where a fire is hottest.
 */
const TONGUE_W = 18;
const TONGUE_H = 36;
function tongueBand(x: number, y: number, lean: number): number {
  const v = (y + 0.5) / TONGUE_H; // 0 at the tip, 1 at the base
  const half = v < 0.72 ? Math.pow(v / 0.72, 0.85) : Math.sqrt(Math.max(0, 1 - ((v - 0.72) / 0.28) ** 2));
  const u = ((x + 0.5) / TONGUE_W) * 2 - 1 - lean * (1 - v) * (1 - v);
  const edge = half * 0.96 - Math.abs(u);
  if (edge < 0) return -1;
  const d = edge / Math.max(half, 0.01);
  if (d > 0.55 && v > 0.5) return 3;
  if (d > 0.34 && v > 0.3) return 2;
  if (d > 0.14) return 1;
  return 0;
}

/** A tiny deterministic generator, so the textures are the same every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** `put` takes a colour (0xRRGGBB) and an alpha. Tinted frames are drawn in greys. */
interface FrameSpec { name: string; w: number; h: number; draw: (put: (x: number, y: number, rgb: number, a: number) => void) => void }
const grey = (v: number) => { const c = Math.round(255 * v); return (c << 16) | (c << 8) | c; };

/*
 * The floor layers are drawn for the default patch (radius 27 world pixels)
 * at the art's pixel, so an ordinary fire's floor shows at exactly the
 * sprites' pixel size; a bigger or smaller field scales them a little.
 */
const ELLIPSE_W = 108;
const ELLIPSE_H = 60;
const inEllipse = (x: number, y: number, w: number, h: number, k = 1) => {
  const dx = (x + 0.5 - w / 2) / (w / 2);
  const dy = (y + 0.5 - h / 2) / (h / 2);
  return dx * dx + dy * dy <= k * k;
};

const FRAMES: FrameSpec[] = [
  // Two leans per owner, so neighbouring flames are not the same shape.
  ...([["e", BANDS_ENEMY], ["p", BANDS_PLAYER]] as const).flatMap(([who, bands]) => [-0.35, 0.35].map((lean, i): FrameSpec => ({
    name: `tongue_${who}${i}`, w: TONGUE_W, h: TONGUE_H,
    draw: (put) => {
      for (let y = 0; y < TONGUE_H; y++) for (let x = 0; x < TONGUE_W; x++) {
        const band = tongueBand(x, y, lean);
        if (band >= 0) put(x, y, bands[band]!, 1);
      }
    },
  }))),
  { name: "ember", w: 2, h: 2, draw: (put) => { for (let i = 0; i < 4; i++) put(i % 2, i >> 1, 0xffffff, 1); } },
  {
    name: "smoke", w: 7, h: 7,
    draw: (put) => {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        if (!inEllipse(x, y, 7, 7)) continue;
        put(x, y, 0xffffff, inEllipse(x, y, 7, 7, 0.6) ? 0.55 : 0.3);
      }
    },
  },
  {
    // Light on the floor: four stepped rings, brightest at the middle.
    name: "glow", w: ELLIPSE_W, h: ELLIPSE_H,
    draw: (put) => {
      for (let y = 0; y < ELLIPSE_H; y++) for (let x = 0; x < ELLIPSE_W; x++) {
        const a = inEllipse(x, y, ELLIPSE_W, ELLIPSE_H, 0.35) ? 0.5
          : inEllipse(x, y, ELLIPSE_W, ELLIPSE_H, 0.6) ? 0.32
          : inEllipse(x, y, ELLIPSE_W, ELLIPSE_H, 0.82) ? 0.18
          : inEllipse(x, y, ELLIPSE_W, ELLIPSE_H) ? 0.08 : 0;
        if (a > 0) put(x, y, 0xffffff, a);
      }
    },
  },
  {
    // Burnt stone: solid in the middle, a dithered, ragged edge.
    name: "char", w: ELLIPSE_W, h: ELLIPSE_H,
    draw: (put) => {
      const rnd = lcg(7);
      for (let y = 0; y < ELLIPSE_H; y++) for (let x = 0; x < ELLIPSE_W; x++) {
        const r = rnd();
        if (inEllipse(x, y, ELLIPSE_W, ELLIPSE_H, 0.7)) put(x, y, 0xffffff, 0.85);
        else if (inEllipse(x, y, ELLIPSE_W, ELLIPSE_H, 0.9) && r < 0.6) put(x, y, 0xffffff, 0.6);
        else if (inEllipse(x, y, ELLIPSE_W, ELLIPSE_H) && r < 0.25) put(x, y, 0xffffff, 0.4);
      }
    },
  },
  {
    // A bubble, 5 x 5: a darker skin, a lighter body and one lit texel. No rim line.
    name: "bubble", w: 5, h: 5,
    draw: (put) => {
      for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
        if (!inEllipse(x, y, 5, 5)) continue;
        put(x, y, grey(inEllipse(x, y, 5, 5, 0.6) ? 0.9 : 0.6), 1);
      }
      put(1, 1, 0xffffff, 1);
    },
  },
  // Two beds of coals, alternated for the flicker: 2 x 2 clumps, not noise.
  ...[11, 23].map((seed, i): FrameSpec => ({
    name: `coals${i}`, w: ELLIPSE_W, h: ELLIPSE_H,
    draw: (put) => {
      const rnd = lcg(seed);
      for (let n = 0; n < 90; n++) {
        const x = Math.floor(rnd() * (ELLIPSE_W - 2));
        const y = Math.floor(rnd() * (ELLIPSE_H - 2));
        if (!inEllipse(x + 0.5, y + 0.5, ELLIPSE_W, ELLIPSE_H, 0.8)) continue;
        const hot = inEllipse(x, y, ELLIPSE_W, ELLIPSE_H, 0.45);
        const v = rnd() < (hot ? 0.45 : 0.15) ? 1 : rnd() < 0.5 ? 0.72 : 0.5;
        for (let k = 0; k < 4; k++) put(x + (k & 1), y + (k >> 1), grey(v), 1);
      }
    },
  })),
];

/** Draws every frame into one canvas texture, once per game. */
function ensureTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX)) return;
  const pad = 1;
  const width = FRAMES.reduce((w, f) => w + f.w + pad, 0);
  const height = Math.max(...FRAMES.map((f) => f.h));
  const tex = scene.textures.createCanvas(TEX, width, height)!;
  const ctx = tex.getContext();
  let ox = 0;
  for (const f of FRAMES) {
    f.draw((x, y, rgb, a) => {
      ctx.fillStyle = `rgba(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255},${a})`;
      ctx.fillRect(ox + x, y, 1, 1);
    });
    tex.add(f.name, 0, ox, 0, f.w, f.h);
    ox += f.w + pad;
  }
  tex.refresh();
}

/** Solid for most of a life, then two steps out: fading as frames do, not as a gradient. */
function stepFade(t: number, a: number): number {
  return t < 0.6 ? a : t < 0.82 ? a * 0.55 : a * 0.2;
}

/* -------------------------------- the system -------------------------------- */

interface Floor {
  char: Phaser.GameObjects.Image;
  coals: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  /** Where this slot last burned, and how long its char has left once out. */
  x: number;
  y: number;
  radius: number;
  charMs: number;
  lit: boolean;
  /** Emission owed, carried between frames so a low rate still emits. */
  owedBack: number;
  owedFront: number;
  owedSpark: number;
  owedSmoke: number;
  phase: number;
}

type Owner = Fire["owner"];

export class FireFx {
  private readonly back: Record<Owner, Phaser.GameObjects.Particles.ParticleEmitter>;
  private readonly front: Record<Owner, Phaser.GameObjects.Particles.ParticleEmitter>;
  private readonly bodyEnemy: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly bodyPlayer: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly spark: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  /**
   * **A poison cloud** (`Fire.element === "poison"`, doc 006's poison
   * field): gas, not flame. It has a back and a front as a fire does, so a
   * body stands in it — low puffs drifting sideways and swelling, the far
   * ones under the bodies, the near ones over their feet and thinner — and
   * bubbles swelling out of the bed and popping into droplets. Matter, so
   * opaque rather than additive; nothing of a fire's is drawn for it: no
   * tongues, no sparks, no smoke, no light, and no scorch after it thins.
   */
  private readonly gasBack: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly gasFront: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly bubbles: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly droplets: Phaser.GameObjects.Particles.ParticleEmitter;
  /**
   * **Frost on the floor** (`Fire.element === "ice"`): a pale mist that
   * creeps low over the patch, and glints of rime winking out of it. Matter
   * like the cloud, and like the cloud nothing of a fire's.
   */
  private readonly mist: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly glints: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Flame thrown along a direction: the warden's fire-shot. See `jet`. */
  private readonly jetEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private jetAngle = 0;
  private jetSpread = 0;
  private jetSpeed = 0;
  private readonly floors: Floor[] = [];
  private world: World | null = null;
  private clock = 0;

  constructor(private readonly scene: Phaser.Scene, spellTexture: string) {
    ensureTexture(scene);
    if (!scene.anims.exists("vfx_gas_puff")) scene.anims.create({
      key: "vfx_gas_puff",
      frames: Array.from({ length: 4 }, (_, i) => ({ key: spellTexture, frame: `vfx_gas_puff_${i}` })),
      frameRate: 4,
      repeat: 0,
    });
    /*
     * Flames are **opaque**, not additive: over a pale floor an additive
     * flame washes out to white and stops reading as fire. The light is the
     * floor glow's job; the tongue is a shape with a dark rim and a hot core.
     */
    const tongue = (depth: number, who: "e" | "p", lift: number, size: number, alpha = 1) =>
      scene.add.particles(0, 0, TEX, {
        frame: [`tongue_${who}0`, `tongue_${who}1`], emitting: false,
        lifespan: { min: 240, max: 440 },
        speedX: { min: -4, max: 4 },
        speedY: { min: -lift * 1.2, max: -lift * 0.8 },
        accelerationY: -lift * 1.4,
        // Born wide and low, drawn up thin: a lick, not a drop.
        scaleX: { start: PX * size * 1.25, end: PX * size * 0.3 },
        scaleY: { start: PX * size * 0.45, end: PX * size * 0.9 },
        // Stepped, as a sprite's frames would be: solid, then two fading steps.
        alpha: { onEmit: () => alpha, onUpdate: (_p: unknown, _k: string, t: number) => stepFade(t, alpha) },
        color: COOLING,
      }).setDepth(depth);
    this.back = { enemy: tongue(5.8, "e", 30, 1), player: tongue(5.8, "p", 30, 1) };
    // The near flames are shorter and a little translucent, so a body stays readable through them.
    this.front = { enemy: tongue(8.6, "e", 22, 0.8, 0.85), player: tongue(8.6, "p", 22, 0.8, 0.85) };
    // A burning body's flames: small, and on the body's own layer.
    this.bodyEnemy = tongue(6.5, "e", 20, 0.42);
    this.bodyPlayer = tongue(8.55, "e", 20, 0.42);
    this.spark = scene.add.particles(0, 0, TEX, {
      frame: "ember", emitting: false,
      lifespan: { min: 500, max: 900 },
      speedX: { min: -14, max: 14 },
      speedY: { min: -60, max: -30 },
      accelerationY: 18,
      scale: { start: PX, end: PX * 0.5 },
      alpha: { start: 1, end: 0 },
      color: [0xfff4c0, 0xffa040, 0xc03a1a],
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(8.7);
    this.smoke = scene.add.particles(0, 0, TEX, {
      frame: "smoke", emitting: false,
      lifespan: { min: 900, max: 1400 },
      speedX: { min: -5, max: 5 },
      speedY: { min: -16, max: -9 },
      scale: { start: PX * 1.2, end: PX * 2.4 },
      alpha: { start: 0.32, end: 0 },
      tint: 0x2a2233,
    }).setDepth(8.8);
    const gas = (depth: number, alpha: number) =>
      scene.add.particles(0, 0, spellTexture, {
        frame: "vfx_gas_puff_0", anim: "vfx_gas_puff", emitting: false,
        lifespan: { min: 900, max: 1500 },
        // Drifting, not rising: gas creeps along the floor.
        speedX: { min: -9, max: 9 },
        speedY: { min: -5, max: 1 },
        scale: PX,
        alpha: { onEmit: () => alpha, onUpdate: (_p: unknown, _k: string, t: number) => (t < 0.2 ? alpha * 0.55 : stepFade(t, alpha)) },
      }).setDepth(depth);
    this.gasBack = gas(5.8, 0.62);
    this.gasFront = gas(8.6, 0.42);
    this.bubbles = scene.add.particles(0, 0, TEX, {
      frame: "bubble", emitting: false,
      lifespan: { min: 380, max: 620 },
      speedX: { min: -2, max: 2 },
      speedY: { min: -9, max: -3 },
      // Swelling until it pops.
      scale: { start: PX * 0.5, end: PX * 1.25 },
      alpha: { onEmit: () => 1, onUpdate: (_p: unknown, _k: string, t: number) => (t < 0.9 ? 1 : 0) },
      tint: [0x8fe06a, 0x6fdc5a, 0xb8f090],
    }).setDepth(5.9);
    this.droplets = scene.add.particles(0, 0, TEX, {
      frame: "ember", emitting: false,
      lifespan: { min: 180, max: 300 },
      speedX: { min: -22, max: 22 },
      speedY: { min: -30, max: -12 },
      accelerationY: 140,
      scale: PX,
      alpha: { start: 1, end: 0.4 },
      tint: [0xa8f07a, 0x6fdc5a],
    }).setDepth(5.95);
    this.mist = scene.add.particles(0, 0, TEX, {
      frame: "smoke", emitting: false,
      lifespan: { min: 900, max: 1500 },
      speedX: { min: -7, max: 7 },
      speedY: { min: -3, max: 1 },
      scale: { start: PX * 1.1, end: PX * 1.9 },
      alpha: { start: 0.34, end: 0 },
      tint: [0xe8f8ff, 0xc8ecff, 0xa8dcff],
    }).setDepth(5.8);
    this.glints = scene.add.particles(0, 0, TEX, {
      frame: "ember", emitting: false,
      lifespan: { min: 260, max: 520 },
      speedY: { min: -4, max: 0 },
      scale: PX,
      alpha: { onEmit: () => 1, onUpdate: (_p: unknown, _k: string, t: number) => (t < 0.5 ? 1 : t < 0.75 ? 0.5 : 0) },
      tint: [0xffffff, 0xe0f6ff],
    }).setDepth(5.95);
    // A bubble popping throws a few droplets where it was.
    this.bubbles.onParticleDeath((p: Phaser.GameObjects.Particles.Particle) => {
      this.droplets.emitParticleAt(p.x, p.y, 3);
    });
    /*
     * The same tongues, thrown: each born at the muzzle and flung along a ray
     * of the gout at the speed that carries it to the ray's end within its
     * life, stretched along its travel. `jet` sets the direction and speed
     * before each emission; the ops read them.
     */
    this.jetEmitter = scene.add.particles(0, 0, TEX, {
      frame: ["tongue_e0", "tongue_e1"], emitting: false,
      lifespan: { min: 200, max: 320 },
      angle: { onEmit: () => this.jetAngle + (Math.random() - 0.5) * this.jetSpread },
      speed: { onEmit: () => this.jetSpeed * (0.75 + Math.random() * 0.5) },
      rotate: { onEmit: () => this.jetAngle + 90 },
      scaleX: { start: PX * 0.7, end: PX * 0.4 },
      scaleY: { start: PX * 0.6, end: PX * 1.1 },
      alpha: { onEmit: () => 1, onUpdate: (_p: unknown, _k: string, t: number) => stepFade(t, 1) },
      color: COOLING,
    }).setDepth(8.6);
  }

  /**
   * Flame out of a muzzle: `count` tongues along `angleRad` within
   * `spreadRad`, each reaching about `reach` px. Called each frame the gout
   * is rolling out, once per ray, so the thrown flame follows the rays the
   * sim cut short at walls.
   */
  jet(x: number, y: number, angleRad: number, spreadRad: number, reach: number, count: number): void {
    this.jetAngle = (angleRad * 180) / Math.PI;
    this.jetSpread = (spreadRad * 180) / Math.PI;
    this.jetSpeed = reach / 0.26;
    this.jetEmitter.emitParticleAt(x, y, count);
    if (Math.random() < 0.5) this.spark.emitParticleAt(x + Math.cos(angleRad) * reach * 0.6, y + Math.sin(angleRad) * reach * 0.6, 1);
  }

  /** Forgets the room: every flame in the air and every mark on the floor. */
  reset(): void {
    for (const e of this.emitters()) e.killAll();
    for (const f of this.floors) {
      f.lit = false;
      f.charMs = 0;
      f.char.setVisible(false);
      f.coals.setVisible(false);
      f.glow.setVisible(false);
    }
  }

  /** One frame: the floor layers follow the sim's fires, and flames are emitted for each. */
  update(w: World, deltaMs: number): void {
    if (w !== this.world) {
      this.world = w;
      this.reset();
    }
    const dt = Math.min(deltaMs, 50);
    this.clock += dt;
    const lit = w.fires.filter((f) => f.alive).length;
    const share = lit > BUDGET_FIRES ? BUDGET_FIRES / lit : 1;

    w.fires.forEach((fire, i) => {
      const fl = this.floor(i);
      if (fire.alive) {
        // A reused slot has moved: its char stays where it was only if it had burnt out.
        fl.lit = true;
        fl.x = fire.x;
        fl.y = fire.y;
        fl.radius = fire.radius;
        if (fire.element === "poison") {
          // A cloud leaves no scorch (`Fire.element`): nothing to fade once it thins.
          fl.charMs = 0;
          fl.char.setVisible(false);
          this.cloud(fire, fl, dt, share);
        } else if (fire.element === "ice") {
          // Nor does frost: it melts where it lay.
          fl.charMs = 0;
          fl.char.setVisible(false);
          this.frost(fire, fl, dt, share);
        } else {
          fl.charMs = CHAR_FADE_MS;
          this.burn(fire, fl, dt, share);
        }
      } else if (fl.lit) {
        fl.lit = false;
        fl.coals.setVisible(false);
        fl.glow.setVisible(false);
      }
      if (!fire.alive && fl.charMs > 0) {
        fl.charMs -= dt;
        fl.char.setAlpha(0.7 * Math.max(0, fl.charMs / CHAR_FADE_MS));
        if (fl.charMs <= 0) fl.char.setVisible(false);
      }
    });

    this.burningBodies(w, dt);
  }

  destroy(): void {
    for (const e of this.emitters()) e.destroy();
    for (const f of this.floors) { f.char.destroy(); f.coals.destroy(); f.glow.destroy(); }
    this.floors.length = 0;
  }

  private emitters(): Phaser.GameObjects.Particles.ParticleEmitter[] {
    return [this.back.enemy, this.back.player, this.front.enemy, this.front.player,
      this.bodyEnemy, this.bodyPlayer, this.spark, this.smoke, this.jetEmitter,
      this.gasBack, this.gasFront, this.bubbles, this.droplets];
  }

  private floor(i: number): Floor {
    let f = this.floors[i];
    if (f) return f;
    const img = (frame: string, depth: number, add: boolean) => {
      const im = this.scene.add.image(0, 0, TEX, frame).setDepth(depth).setVisible(false);
      if (add) im.setBlendMode(Phaser.BlendModes.ADD);
      return im;
    };
    f = {
      char: img("char", 1.9, false).setTint(0x0e0810),
      coals: img("coals0", 1.95, true),
      glow: img("glow", 2, true),
      x: 0, y: 0, radius: 0, charMs: 0, lit: false,
      owedBack: 0, owedFront: 0, owedSpark: 0, owedSmoke: 0,
      phase: i * 1.7,
    };
    this.floors[i] = f;
    return f;
  }

  private burn(fire: Fire, fl: Floor, dt: number, share: number): void {
    const t = fireProgress(fire);
    // Held at full strength, then drawn in toward its base over the last half.
    const out = t < 0.5 ? 0 : (t - 0.5) / 0.5;
    /*
     * The player's fire **kindles**: it grows up out of its coals over its
     * first moment rather than standing at full height on the frame it is
     * lit. A trail drops its patch at the caster's feet, and a patch at full
     * flame there drew the caster standing in a fire — the picture of a
     * burning player — when the fire is behind them by the time it is tall.
     * Enemy fire is at full height at once: a threat is never late.
     */
    const kindle = fire.owner === "player" ? Math.min(1, t / KINDLE_SHARE) : 1;
    const life = (1 - out * out) * kindle;
    const rx = fire.radius;
    const ry = fire.radius * 0.55;
    const sx = (rx * 2) / ELLIPSE_W;
    const sy = (ry * 2) / ELLIPSE_H;
    const flicker = 0.85 + 0.15 * Math.sin(this.clock / 90 + fl.phase) * Math.sin(this.clock / 37 + fl.phase * 2);
    const hot = fire.owner === "player" ? GLOW_PLAYER : GLOW_ENEMY;

    const bed = 0.4 + 0.6 * life;
    fl.char.setVisible(true).setPosition(fire.x, fire.y + 1).setScale(sx * 1.05, sy * 1.1).setAlpha(0.7);
    fl.coals.setVisible(true).setBlendMode(Phaser.BlendModes.ADD).setPosition(fire.x, fire.y + 1)
      .setFrame(((this.clock / 110 + fl.phase) | 0) & 1 ? "coals1" : "coals0")
      .setScale(sx * bed, sy * bed)
      .setTint(hot).setAlpha(0.9 * life);
    fl.glow.setVisible(true).setBlendMode(Phaser.BlendModes.ADD).setPosition(fire.x, fire.y)
      .setScale(sx * 1.9, sy * 1.9)
      .setTint(hot).setAlpha(0.3 * life * flicker);

    // Flames per second, from the patch's area and what is left of it.
    const area = rx / 27;
    const rate = (38 * area) * life * share;
    const spawnR = 0.35 + 0.65 * life;
    const s = dt / 1000;
    fl.owedBack += rate * s;
    fl.owedFront += rate * 0.8 * s;
    fl.owedSpark += 5 * area * life * share * s;
    fl.owedSmoke += 3 * area * life * share * s;
    const owner = fire.owner;
    const at = (half: -1 | 0 | 1): [number, number] => {
      // A point in the patch's ellipse; `half` keeps it to the far (-1) or near (1) side.
      for (;;) {
        const u = Math.random() * 2 - 1;
        const v = Math.random() * 2 - 1;
        if (u * u + v * v > 1) continue;
        const vy = half === 0 ? v : half * Math.abs(v);
        return [fire.x + u * rx * spawnR, fire.y + vy * ry * spawnR];
      }
    };
    for (; fl.owedBack >= 1; fl.owedBack--) this.back[owner].emitParticleAt(...at(-1), 1);
    for (; fl.owedFront >= 1; fl.owedFront--) this.front[owner].emitParticleAt(...at(1), 1);
    for (; fl.owedSpark >= 1; fl.owedSpark--) this.spark.emitParticleAt(...at(0), 1);
    for (; fl.owedSmoke >= 1; fl.owedSmoke--) {
      const [x, y] = at(0);
      this.smoke.emitParticleAt(x, y - ry * 1.4, 1);
    }
  }

  /**
   * A poison cloud, one frame: a dark wet bed under it that bubbles, and gas
   * puffs emitted over the patch, far half behind the bodies and near half
   * in front. It swells in over its first moment and thins over its last
   * third — fewer puffs, a paler bed — so a cloud about to go is seen going.
   */
  private cloud(fire: Fire, fl: Floor, dt: number, share: number): void {
    const t = fireProgress(fire);
    const grow = Math.min(1, t / 0.08);
    const out = t < 0.66 ? 0 : (t - 0.66) / 0.34;
    const life = grow * (1 - out * out);
    const rx = fire.radius;
    const ry = fire.radius * 0.55;
    const sx = (rx * 2) / ELLIPSE_W;
    const sy = (ry * 2) / ELLIPSE_H;
    /*
     * The ground it holds: a pool of the venom's dark in the glow's stepped
     * bands — matter, so normal blend, not light — out to the cloud's own
     * radius, so where it poisons is where it is seen. Over it the wet bed
     * glints, flickering slowly as it bubbles.
     */
    fl.glow.setVisible(true).setBlendMode(Phaser.BlendModes.NORMAL).setPosition(fire.x, fire.y)
      .setScale(sx * 1.1, sy * 1.1)
      .setTint(0x2a7a22).setAlpha(Math.min(1, 1.4 * life));
    fl.coals.setVisible(true).setBlendMode(Phaser.BlendModes.NORMAL).setPosition(fire.x, fire.y + 1)
      .setFrame(((this.clock / 260 + fl.phase) | 0) & 1 ? "coals1" : "coals0")
      .setScale(sx * (0.7 + 0.3 * life), sy * (0.7 + 0.3 * life))
      .setTint(BED_POISON).setAlpha(life);

    const area = rx / 27;
    const rate = 30 * area * life * share;
    const s = dt / 1000;
    fl.owedBack += rate * s;
    fl.owedFront += rate * 0.7 * s;
    fl.owedSpark += 7 * area * life * share * s;
    const at = (half: -1 | 0 | 1, spread = 0.85): [number, number] => {
      for (;;) {
        const u = Math.random() * 2 - 1;
        const v = Math.random() * 2 - 1;
        if (u * u + v * v > 1) continue;
        const vy = half === 0 ? v : half * Math.abs(v);
        return [fire.x + u * rx * spread, fire.y + vy * ry * spread];
      }
    };
    for (; fl.owedBack >= 1; fl.owedBack--) { const [x, y] = at(-1); this.gasBack.emitParticleAt(x, y - 3, 1); }
    for (; fl.owedFront >= 1; fl.owedFront--) { const [x, y] = at(1); this.gasFront.emitParticleAt(x, y - 2, 1); }
    // `owedSpark` carries the bubbles here: a cloud throws no sparks.
    for (; fl.owedSpark >= 1; fl.owedSpark--) this.bubbles.emitParticleAt(...at(0, 0.7), 1);
  }

  /**
   * Frost on the floor, one frame: a pale bed of rime out to the patch's
   * radius over a blue under-glow, a low mist crossing it and glints winking
   * out of it. It forms fast and melts over its last third, the bed paling
   * first, so frost about to go is seen going.
   */
  private frost(fire: Fire, fl: Floor, dt: number, share: number): void {
    const t = fireProgress(fire);
    const grow = Math.min(1, t / 0.06);
    const out = t < 0.66 ? 0 : (t - 0.66) / 0.34;
    const life = grow * (1 - out * out);
    const rx = fire.radius;
    const ry = fire.radius * 0.55;
    const sx = (rx * 2) / ELLIPSE_W;
    const sy = (ry * 2) / ELLIPSE_H;
    fl.glow.setVisible(true).setBlendMode(Phaser.BlendModes.NORMAL).setPosition(fire.x, fire.y)
      .setScale(sx * 1.08, sy * 1.08)
      .setTint(GLOW_FROST).setAlpha(Math.min(1, 0.9 * life));
    fl.coals.setVisible(true).setBlendMode(Phaser.BlendModes.NORMAL).setPosition(fire.x, fire.y + 1)
      .setFrame("coals0")
      .setScale(sx * (0.75 + 0.25 * life), sy * (0.75 + 0.25 * life))
      .setTint(BED_FROST).setAlpha(0.85 * life);
    const area = rx / 27;
    const s = dt / 1000;
    fl.owedBack += 14 * area * life * share * s;
    fl.owedSpark += 10 * area * life * share * s;
    const at = (spread = 0.85): [number, number] => {
      for (;;) {
        const u = Math.random() * 2 - 1;
        const v = Math.random() * 2 - 1;
        if (u * u + v * v > 1) continue;
        return [fire.x + u * rx * spread, fire.y + v * ry * spread];
      }
    };
    for (; fl.owedBack >= 1; fl.owedBack--) { const [x, y] = at(); this.mist.emitParticleAt(x, y - 2, 1); }
    for (; fl.owedSpark >= 1; fl.owedSpark--) this.glints.emitParticleAt(...at(0.8), 1);
  }

  /** Flames off anything burning: a few tongues from the shoulders, on the body's own layer. */
  private burningBodies(w: World, dt: number): void {
    const s = dt / 1000;
    const emit = (em: Phaser.GameObjects.Particles.ParticleEmitter, x: number, y: number, r: number, rate: number) => {
      // Probabilistic rather than owed: bodies come and go, and a missed flame is invisible.
      let n = rate * s;
      while (n > 0) {
        if (n >= 1 || Math.random() < n) {
          const a = Math.random() * Math.PI * 2;
          em.emitParticleAt(x + Math.cos(a) * r * 0.55, y - r * 0.2 + Math.sin(a) * r * 0.25, 1);
        }
        n -= 1;
      }
    };
    for (const e of w.enemies)
      if (e.hp > 0 && e.burnMs > 0) emit(this.bodyEnemy, e.x, e.y, e.radius, 16);
    const p = w.player;
    if (p.burnMs > 0) emit(this.bodyPlayer, p.x, p.y - 4, 7, 14);
  }
}
