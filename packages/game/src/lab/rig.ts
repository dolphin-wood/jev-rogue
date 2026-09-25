/**
 * Cut-out skeletal rigs: parts on joints, posed by curves, drawn to a 2D
 * canvas. Shared by the animation lab (`/anim-lab.html`) and whatever takes a
 * rig into the game.
 *
 * Drawing a rig at the art's own resolution is where pixel art suffers: a
 * rotation resamples the part, so a turn of a few hundredths of a radian
 * moves individual pixels about (the shimmer), and sub-pixel offsets round
 * to whole pixels at different moments for different parts (the wobble).
 * `RenderOptions` carries the usual answers — snap angles to steps, snap
 * positions to whole pixels, rotate cleanly (upscale, rotate, downscale by
 * majority, cached per angle) — so they can be judged side by side.
 */

export interface Part {
  readonly name: string;
  readonly pivot: readonly [number, number];
  readonly parent: string | null;
  readonly z: number;
}

export interface Held {
  readonly part: string;
  readonly image: HTMLCanvasElement;
  /** Where the grip is in the held sprite. */
  readonly grip: readonly [number, number];
  /** Where the hand is in the part's frame. */
  readonly at: readonly [number, number];
  readonly angle: number;
}

export interface Rig {
  readonly name: string;
  readonly size: number;
  readonly parts: readonly Part[];
  readonly layers: ReadonlyMap<string, HTMLCanvasElement>;
  readonly held?: Held;
  readonly moves: readonly string[];
  readonly moveMs: Readonly<Record<string, number>>;
  pose(move: string, ms: number): Pose;
}

export type Pose = Record<string, { rot: number; dx: number; dy: number }>;

export interface RenderOptions {
  /** Draw at the art's pixel and scale up (true), or at the display's resolution. */
  readonly pixel: boolean;
  /** Angle steps per full turn; 0 for none. */
  readonly angleSteps: number;
  /** Round every part's position to a whole art pixel. */
  readonly snapPosition: boolean;
  /** Rotate by upscale-rotate-majority-downscale, cached per angle step. */
  readonly cleanRotation: boolean;
  readonly joints: boolean;
  /** Mirror left-right about the rig's centre (a character facing the other way). */
  readonly mirror: boolean;
}

const ease = {
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  out: (t: number) => 1 - (1 - t) ** 3,
};
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const seg = (ms: number, from: number, to: number) => clamp01((ms - from) / (to - from));

export function blankPose(parts: readonly Part[]): Pose {
  const p: Pose = { pelvis: { rot: 0, dx: 0, dy: 0 } };
  for (const part of parts) p[part.name] = { rot: 0, dx: 0, dy: 0 };
  return p;
}

export function playerPose(move: string, ms: number, parts: readonly Part[]): Pose {
  const p = blankPose(parts);
  const set = (n: string, rot: number, dx = 0, dy = 0) => { p[n] = { rot, dx, dy }; };
  if (move === "idle") {
    const b = Math.sin((ms / 1400) * Math.PI * 2);
    set("torso", 0, 0, -b * 0.6);
    set("head", Math.sin((ms / 1400) * Math.PI * 2 - 0.7) * 0.04, 0, -b * 0.3);
    set("swordArm", b * 0.05);
    set("castArm", -b * 0.07);
  } else if (move === "walk") {
    /*
     * A robe's shuffle, not a hop: short steps under the hem, the body rising
     * barely half a pixel as the legs pass, only the leg swinging forward
     * lifting its foot, the arms swinging a little against the legs. At a
     * 1.5 px bob with both feet lifting, it read as bouncing.
     */
    const t = (ms / 500) * Math.PI;
    const s = Math.sin(t);
    set("pelvis", 0, 0, -Math.abs(Math.cos(t)) * 0.6);
    set("legL", s * 0.22, 0, s > 0 ? -s * 0.8 : 0);
    set("legR", -s * 0.22, 0, s < 0 ? s * 0.8 : 0);
    set("torso", s * 0.025);
    set("head", Math.sin(t - 0.6) * 0.03);
    set("swordArm", -s * 0.2);
    set("castArm", s * 0.2);
  } else if (move === "cast") {
    // The casting hand thrown forward and up, a kick as the spell leaves, back.
    const raise = ease.out(seg(ms, 0, 160));
    const kick = ms > 220 ? Math.exp(-(ms - 220) / 90) : 0;
    const back = ease.inOut(seg(ms, 600, 1000));
    set("castArm", (-1.25 * raise + 0.25 * kick) * (1 - back), 0, -2 * raise * (1 - back));
    set("torso", (0.08 * raise - 0.05 * kick) * (1 - back));
    set("head", 0.06 * raise * (1 - back) - kick * 0.05);
    set("swordArm", 0.15 * raise * (1 - back));
  } else if (move === "swing") {
    // Raised (anticipation), a fast cut down in front (ease-out), a follow-
    // through, and a settle — the body turning into it. The hand rests out
    // to the left: +1.3 lifts it overhead, −1.6 brings it down in front.
    const up = ease.inOut(seg(ms, 0, 260));
    const cut = ease.out(seg(ms, 260, 350));
    const settle = ease.inOut(seg(ms, 520, 900));
    set("swordArm", (1.3 * up - 2.9 * cut) * (1 - settle));
    set("torso", (0.12 * up - 0.24 * cut) * (1 - settle), (-1.5 * up + 2.5 * cut) * (1 - settle));
    set("head", (0.05 * up - 0.12 * cut) * (1 - settle));
    set("castArm", (-0.3 * up + 0.5 * cut) * (1 - settle));
    set("pelvis", 0, 1.5 * cut * (1 - settle), cut * (1 - settle));
    set("legL", -0.15 * cut * (1 - settle));
    set("legR", 0.1 * cut * (1 - settle));
  } else if (move === "hurt") {
    const k = Math.exp(-ms / 150) * Math.cos(ms / 55);
    set("torso", -k * 0.18, 0, -k * 1.5);
    set("head", -k * 0.3);
    set("swordArm", k * 0.4);
    set("castArm", -k * 0.4);
  }
  return p;
}

export function wardenPose(move: string, ms: number, parts: readonly Part[]): Pose {
  const p = blankPose(parts);
  const set = (n: string, rot: number, dx = 0, dy = 0) => { p[n] = { rot, dx, dy }; };
  if (move === "idle") {
    const b = Math.sin((ms / 1400) * Math.PI * 2);
    set("torso", b * 0.01, 0, -b * 0.8);
    set("head", Math.sin((ms / 1400) * Math.PI * 2 - 0.6) * 0.03);
    set("gun", b * 0.04);
    set("fist", -b * 0.05);
  } else if (move === "walk") {
    const t = (ms / 500) * Math.PI;
    const s = Math.sin(t);
    set("pelvis", s * 0.04, 0, -Math.abs(Math.cos(t)) * 2);
    set("legL", s * 0.32, 0, s > 0 ? -s * 2 : 0);
    set("legR", -s * 0.32, 0, s < 0 ? s * 2 : 0);
    set("torso", -s * 0.05);
    set("head", Math.sin(t - 0.5) * 0.06);
    set("fist", -s * 0.25);
    set("gun", s * 0.18);
  } else if (move === "fire") {
    const raise = ease.inOut(seg(ms, 0, 950));
    const level = ease.out(seg(ms, 950, 1100));
    const kick = ms > 1100 ? Math.exp(-(ms - 1100) / 120) : 0;
    const lower = ease.inOut(seg(ms, 1900, 2400));
    set("gun", (-1.1 * raise * (1 - level) - 0.25 * level) * (1 - lower) - kick * 0.35, -kick * 3);
    set("torso", -kick * 0.06, 0, raise * 1.2 * (1 - lower));
    set("head", -kick * 0.08);
    set("fist", 0.2 * raise * (1 - lower));
  } else if (move === "hit") {
    const k = Math.exp(-ms / 160) * Math.cos(ms / 60);
    set("torso", -k * 0.15, -k * 2);
    set("head", -k * 0.25);
    set("gun", k * 0.3);
    set("fist", k * 0.3);
  }
  return p;
}

type Atlas = Record<string, { x: number; y: number; w: number; h: number }>;

export function frameCanvas(img: CanvasImageSource, r: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = r.w;
  c.height = r.h;
  c.getContext("2d")!.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error(`could not load ${src}`));
    i.src = src;
  });
}

/** The player, from its drawn parts sheet (`pnpm rig:parts`), with the sword in its hand. */
export async function playerRig(img: HTMLImageElement, atlas: Atlas): Promise<Rig> {
  const [sheet, meta] = await Promise.all([
    loadImage("/source/rig/player-parts.png"),
    fetch("/source/rig/player-parts.json").then((r) => r.json()) as Promise<{ frame: { w: number; h: number }; parts: (Part & { x: number })[] }>,
  ]);
  const layers = new Map<string, HTMLCanvasElement>();
  for (const part of meta.parts) layers.set(part.name, frameCanvas(sheet, { x: part.x, y: 0, w: meta.frame.w, h: meta.frame.h }));
  const parts: readonly Part[] = meta.parts;
  return {
    name: "player",
    size: meta.frame.w,
    parts,
    layers,
    held: { part: "swordArm", image: frameCanvas(img, atlas["weapon_player_sword"]!), grip: [25, 32], at: [9, 32], angle: -Math.PI / 2 - 0.5 },
    moves: ["idle", "walk", "cast", "swing", "hurt"],
    moveMs: { idle: 2800, walk: 1000, cast: 1100, swing: 1000, hurt: 800 },
    pose: (move, ms) => playerPose(move, ms, parts),
  };
}

/** The warden, cut from one frame by rectangles and nothing more: the first attempt, kept to compare. */
export function wardenRig(img: HTMLImageElement, atlas: Atlas): Rig {
  const claims: Record<string, readonly (readonly [number, number, number, number])[]> = {
    head: [[34, 8, 62, 42]], gun: [[62, 24, 92, 60]], fist: [[6, 26, 34, 62], [6, 62, 18, 70]],
    legL: [[16, 62, 42, 90]], legR: [[56, 62, 82, 90]], torso: [[0, 0, 96, 96]],
  };
  const parts: Part[] = [
    { name: "head", pivot: [48, 41], parent: "torso", z: 4 },
    { name: "gun", pivot: [66, 38], parent: "torso", z: 5 },
    { name: "fist", pivot: [32, 36], parent: "torso", z: 5 },
    { name: "legL", pivot: [36, 64], parent: "pelvis", z: 1 },
    { name: "legR", pivot: [60, 64], parent: "pelvis", z: 1 },
    { name: "torso", pivot: [48, 62], parent: "pelvis", z: 2 },
  ];
  const src = frameCanvas(img, atlas["enemy_warden_s_idle_bare0"]!);
  const data = src.getContext("2d")!.getImageData(0, 0, 96, 96);
  const owned = new Uint8Array(96 * 96);
  const layers = new Map<string, HTMLCanvasElement>();
  for (const part of parts) {
    const out = new ImageData(96, 96);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      const i = (y * 96 + x) * 4;
      if (data.data[i + 3] === 0 || owned[y * 96 + x]) continue;
      if (!claims[part.name]!.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)) continue;
      out.data.set(data.data.subarray(i, i + 4), i);
      owned[y * 96 + x] = 1;
    }
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 96;
    c.getContext("2d")!.putImageData(out, 0, 0);
    layers.set(part.name, c);
  }
  return {
    name: "warden", size: 96, parts, layers,
    moves: ["idle", "walk", "fire", "hit"],
    moveMs: { idle: 2800, walk: 1000, fire: 2600, hit: 900 },
    pose: (move, ms) => wardenPose(move, ms, parts),
  };
}

/* ------------------------------- drawing -------------------------------- */

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const T = (x: number, y: number): M => [1, 0, 0, 1, x, y];
const R = (a: number): M => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** A drawing turned about a point, and where that point is in the result. */
interface Turned { readonly canvas: HTMLCanvasElement; readonly pivot: readonly [number, number] }

const cleanCache = new WeakMap<HTMLCanvasElement, Map<number, Turned>>();

/**
 * Turns `src` by `angle` about `pivot` without the shimmer of a plain
 * nearest-neighbour turn: upscaled 4×, turned at that size, and brought back
 * down by taking each 4×4 block's commonest colour, which keeps single-pixel
 * detail from flickering in and out. Cached per angle, so it is only paid
 * once per step when angles are snapped.
 */
function turnClean(src: HTMLCanvasElement, angle: number, pivot: readonly [number, number]): Turned {
  let byAngle = cleanCache.get(src);
  if (!byAngle) { byAngle = new Map(); cleanCache.set(src, byAngle); }
  const key = Math.round(angle * 1e4);
  const hit = byAngle.get(key);
  if (hit) return hit;
  const K = 4;
  const size = Math.ceil(Math.hypot(src.width, src.height)) + 4;
  const big = document.createElement("canvas");
  big.width = size * K;
  big.height = size * K;
  const g = big.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.translate((size / 2) * K, (size / 2) * K);
  g.rotate(angle);
  g.translate(-pivot[0] * K, -pivot[1] * K);
  g.drawImage(src, 0, 0, src.width * K, src.height * K);
  const bd = g.getImageData(0, 0, big.width, big.height).data;
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const od = new ImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const counts = new Map<number, number>();
      let best = 0;
      let bestN = 0;
      for (let dy = 0; dy < K; dy++)
        for (let dx = 0; dx < K; dx++) {
          const i = ((y * K + dy) * big.width + x * K + dx) * 4;
          const a = bd[i + 3]! > 127 ? 1 : 0;
          const c = a ? ((bd[i]! << 16) | (bd[i + 1]! << 8) | bd[i + 2]!) + 1 : 0;
          const n = (counts.get(c) ?? 0) + 1;
          counts.set(c, n);
          if (n > bestN) { bestN = n; best = c; }
        }
      if (best === 0) continue;
      const c = best - 1;
      const o = (y * size + x) * 4;
      od.data[o] = (c >> 16) & 255;
      od.data[o + 1] = (c >> 8) & 255;
      od.data[o + 2] = c & 255;
      od.data[o + 3] = 255;
    }
  out.getContext("2d")!.putImageData(od, 0, 0);
  const turned = { canvas: out, pivot: [size / 2, size / 2] as const };
  byAngle.set(key, turned);
  return turned;
}

/**
 * Draws a posed rig. Each part's place is its joint chain composed from the
 * pelvis; then, by the options, its angle is snapped to a step and its pivot
 * to a whole pixel, and it is drawn either turned by the canvas or turned
 * cleanly from the cache.
 */
export function drawRig(
  ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose, scale: number, opt: RenderOptions,
): void {
  const byName = new Map(rig.parts.map((p) => [p.name, p]));
  const chain = (name: string): string[] => {
    const part = byName.get(name);
    return part?.parent ? [...chain(part.parent), name] : ["pelvis", name];
  };
  const place = (name: string): { m: M; angle: number } => {
    let m: M = T(0, 0);
    let angle = 0;
    for (const n of chain(name)) {
      const j = pose[n] ?? { rot: 0, dx: 0, dy: 0 };
      const pv = n === "pelvis" ? byName.get("torso")!.pivot : byName.get(n)!.pivot;
      m = mul(m, mul(T(pv[0] + j.dx, pv[1] + j.dy), mul(R(j.rot), T(-pv[0], -pv[1]))));
      angle += j.rot;
    }
    return { m, angle };
  };
  const step = opt.angleSteps > 0 ? (Math.PI * 2) / opt.angleSteps : 0;
  const drawTurned = (src: HTMLCanvasElement, pivot: readonly [number, number], at: [number, number], angle: number) => {
    const a = step ? Math.round(angle / step) * step : angle;
    let [x, y] = at;
    if (opt.snapPosition) { x = Math.round(x); y = Math.round(y); }
    ctx.save();
    ctx.scale(scale, scale);
    if (opt.mirror) { ctx.translate(rig.size, 0); ctx.scale(-1, 1); }
    if (opt.cleanRotation && opt.pixel) {
      const t = turnClean(src, a, pivot);
      ctx.drawImage(t.canvas, Math.round(x - t.pivot[0]), Math.round(y - t.pivot[1]));
    } else {
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.drawImage(src, -pivot[0], -pivot[1]);
    }
    ctx.restore();
  };
  for (const part of [...rig.parts].sort((a, b) => a.z - b.z)) {
    const { m, angle } = place(part.name);
    // What the hand holds is drawn under the hand, in its space.
    if (rig.held && rig.held.part === part.name) {
      const h = rig.held;
      const at = apply(m, h.at[0], h.at[1]);
      drawTurned(h.image, h.grip, at, angle + h.angle);
    }
    drawTurned(rig.layers.get(part.name)!, part.pivot, apply(m, part.pivot[0], part.pivot[1]), angle);
  }
  if (opt.joints) {
    ctx.save();
    ctx.scale(scale, scale);
    if (opt.mirror) { ctx.translate(rig.size, 0); ctx.scale(-1, 1); }
    ctx.fillStyle = "#8fdcff";
    for (const part of rig.parts) {
      const [x, y] = apply(place(part.name).m, part.pivot[0], part.pivot[1]);
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    ctx.restore();
  }
}
