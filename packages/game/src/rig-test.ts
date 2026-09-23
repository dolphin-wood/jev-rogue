/**
 * A test of cut-out skeletal animation against the delivered frames, on the
 * warden (dev page: `/rig-test.html`).
 *
 * The drawing is the south-facing `idle_bare0` frame, cut into six parts by
 * pixel — each pixel belongs to exactly one part — and hung on a skeleton:
 * pelvis → torso → head and both arms, pelvis → both legs. Moves are curves
 * on the joints, with easing, a lag on the head and a recoil on the gun, so
 * the comparison is motion that is continuous against motion that is four
 * drawings.
 *
 * Rendered at the art's own resolution and scaled up, by default, because
 * that is what the game would show: rotating pixel art resamples it, and the
 * cost of a skeleton for sprites this small is visible there or nowhere.
 */

const SCALE = 4;
const FRAME = "enemy_warden_s_idle_bare0";

interface Part {
  readonly name: string;
  /** Pixel rectangles this part claims, in frame px, first match wins. */
  readonly claim: readonly (readonly [number, number, number, number])[];
  /** The joint it turns about, in frame px. */
  readonly pivot: readonly [number, number];
  readonly parent: string | null;
  /** Draw order: low first. */
  readonly z: number;
}

/*
 * Read off the frame on an 8 px grid. Order is priority: the head and the
 * two arms take what they overlap from the torso; the legs take the hips.
 */
const PARTS: readonly Part[] = [
  { name: "head", claim: [[34, 8, 62, 42]], pivot: [48, 41], parent: "torso", z: 4 },
  { name: "gun", claim: [[62, 24, 92, 60]], pivot: [66, 38], parent: "torso", z: 5 },
  { name: "fist", claim: [[6, 26, 34, 62], [6, 62, 18, 70]], pivot: [32, 36], parent: "torso", z: 5 },
  { name: "legL", claim: [[16, 62, 42, 90]], pivot: [36, 64], parent: "pelvis", z: 1 },
  { name: "legR", claim: [[56, 62, 82, 90]], pivot: [60, 64], parent: "pelvis", z: 1 },
  { name: "torso", claim: [[0, 0, 96, 96]], pivot: [48, 62], parent: "pelvis", z: 2 },
];

type Pose = Record<string, { rot: number; dx: number; dy: number }>;
type Move = "idle" | "walk" | "fire" | "hit";

const ease = {
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  out: (t: number) => 1 - (1 - t) ** 3,
};

/** The skeleton's pose at `ms` into a move. Angles in radians, offsets in frame px. */
function poseAt(move: Move, ms: number): Pose {
  const p: Pose = {};
  for (const part of PARTS) p[part.name] = { rot: 0, dx: 0, dy: 0 };
  p["pelvis"] = { rot: 0, dx: 0, dy: 0 };
  const set = (n: string, rot: number, dx = 0, dy = 0) => { p[n] = { rot, dx, dy }; };
  if (move === "idle") {
    const b = Math.sin((ms / 1400) * Math.PI * 2);
    set("pelvis", 0, 0, 0);
    set("torso", b * 0.01, 0, -b * 0.8);
    set("head", Math.sin((ms / 1400) * Math.PI * 2 - 0.6) * 0.03);
    set("gun", b * 0.04);
    set("fist", -b * 0.05);
  } else if (move === "walk") {
    // Heavy: a long stride, the body dropping onto each foot.
    const t = (ms / 900) * Math.PI * 2;
    const s = Math.sin(t);
    const drop = Math.abs(Math.cos(t));
    set("pelvis", s * 0.04, 0, -drop * 2);
    set("legL", s * 0.32, 0, s > 0 ? -s * 2 : 0);
    set("legR", -s * 0.32, 0, s < 0 ? s * 2 : 0);
    set("torso", -s * 0.05, 0, 0);
    set("head", Math.sin(t - 0.5) * 0.06);
    set("fist", -s * 0.25);
    set("gun", s * 0.18);
  } else if (move === "fire") {
    // Raise (0–950 ms), level (950–1100), fire with recoil, hold, lower.
    const raise = ease.inOut(Math.min(1, ms / 950));
    const level = ease.out(Math.max(0, Math.min(1, (ms - 950) / 150)));
    const kick = ms > 1100 ? Math.exp(-(ms - 1100) / 120) : 0;
    const lower = ease.inOut(Math.max(0, Math.min(1, (ms - 1900) / 500)));
    const aim = (-1.1 * raise + 1.1 * level) * (1 - lower) - 1.35 * level * (1 - lower);
    set("gun", aim - kick * 0.35, -kick * 3, 0);
    set("torso", -kick * 0.06 + raise * 0.03 * (1 - level), 0, raise * 1.2 * (1 - lower));
    set("head", -kick * 0.08);
    set("fist", 0.2 * raise * (1 - lower));
    set("pelvis", 0, 0, raise * 1.5 * (1 - lower));
  } else {
    // Hit: snapped back, then settling with an overshoot.
    const k = Math.exp(-ms / 160) * Math.cos(ms / 60);
    set("torso", -k * 0.15, -k * 2);
    set("head", -k * 0.25);
    set("gun", k * 0.3);
    set("fist", k * 0.3);
  }
  return p;
}

const MOVE_MS: Record<Move, number> = { idle: 2800, walk: 1800, fire: 2600, hit: 900 };

async function main(): Promise<void> {
  const [img, json] = await Promise.all([
    new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = "/sprites.png";
    }),
    fetch("/sprites.json").then((r) => r.json()) as Promise<{ frames: Record<string, { x: number; y: number; w: number; h: number }> }>,
  ]);
  const rect = (name: string) => json.frames[name]!;

  // Cut the drawing into parts: each pixel goes to the first part that claims it.
  const f = rect(FRAME);
  const src = document.createElement("canvas");
  src.width = f.w;
  src.height = f.h;
  const sctx = src.getContext("2d")!;
  sctx.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
  const data = sctx.getImageData(0, 0, f.w, f.h);
  const layers = new Map<string, HTMLCanvasElement>();
  for (const part of PARTS) {
    const c = document.createElement("canvas");
    c.width = f.w;
    c.height = f.h;
    layers.set(part.name, c);
  }
  const owned = new ImageData(f.w, f.h);
  for (const part of PARTS) {
    const out = new ImageData(f.w, f.h);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const i = (y * f.w + x) * 4;
      if (data.data[i + 3] === 0 || owned.data[i + 3] !== 0) continue;
      if (!part.claim.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)) continue;
      out.data.set(data.data.subarray(i, i + 4), i);
      owned.data[i + 3] = 255;
    }
    layers.get(part.name)!.getContext("2d")!.putImageData(out, 0, 0);
  }

  const framesCanvas = document.getElementById("frames") as HTMLCanvasElement;
  const rigCanvas = document.getElementById("rig") as HTMLCanvasElement;
  const pixel = document.getElementById("pixel") as HTMLInputElement;
  const joints = document.getElementById("joints") as HTMLInputElement;
  const art = document.createElement("canvas");
  art.width = f.w;
  art.height = f.h;

  let move: Move = "walk";
  let started = performance.now();
  const moves = document.getElementById("moves")!;
  for (const m of ["idle", "walk", "fire", "hit"] as Move[]) {
    const b = document.createElement("button");
    b.textContent = m;
    b.setAttribute("aria-pressed", String(m === move));
    b.onclick = () => {
      move = m;
      started = performance.now();
      for (const x of Array.from(moves.children)) x.setAttribute("aria-pressed", String(x === b));
    };
    moves.appendChild(b);
  }

  /** What the game draws for the same move: the delivered frames, at the game's cadence. */
  function frameFor(ms: number): string {
    if (move === "walk") return `enemy_warden_s_walk${Math.floor(ms / 125) % 4}`;
    if (move === "idle") return `enemy_warden_s_idle${Math.floor(ms / 400) % 2}`;
    if (move === "hit") return ms < 200 ? "enemy_warden_s_hit0" : ms < 400 ? "enemy_warden_s_hit1" : "enemy_warden_s_idle0";
    return ms < 950 ? "enemy_warden_s_windup" : ms < 2300 ? "enemy_warden_s_lunge" : "enemy_warden_s_idle0";
  }

  /** Walks the skeleton from the root, applying each joint's turn about its pivot. */
  function drawRig(ctx: CanvasRenderingContext2D, pose: Pose, scale: number): void {
    const byName = new Map(PARTS.map((p) => [p.name, p]));
    const chain = (name: string): string[] => {
      const part = byName.get(name);
      return part?.parent ? [...chain(part.parent), name] : part ? ["pelvis", name] : [name];
    };
    for (const part of [...PARTS].sort((a, b) => a.z - b.z)) {
      ctx.save();
      ctx.scale(scale, scale);
      for (const n of chain(part.name)) {
        const j = pose[n]!;
        const pv = n === "pelvis" ? [48, 64] : byName.get(n)!.pivot;
        ctx.translate(pv[0]! + j.dx, pv[1]! + j.dy);
        ctx.rotate(j.rot);
        ctx.translate(-pv[0]!, -pv[1]!);
      }
      ctx.drawImage(layers.get(part.name)!, 0, 0);
      ctx.restore();
    }
    if (joints.checked) {
      ctx.fillStyle = "#8fdcff";
      for (const part of PARTS) ctx.fillRect(part.pivot[0] * scale - 2, part.pivot[1] * scale - 2, 4, 4);
    }
  }

  function frame(now: number): void {
    // A frame's timestamp can precede the click that set `started`.
    const ms = Math.max(0, now - started) % MOVE_MS[move];
    const fctx = framesCanvas.getContext("2d")!;
    fctx.imageSmoothingEnabled = false;
    fctx.clearRect(0, 0, framesCanvas.width, framesCanvas.height);
    const fr = rect(frameFor(ms));
    fctx.drawImage(img, fr.x, fr.y, fr.w, fr.h, 0, 0, fr.w * SCALE, fr.h * SCALE);

    const pose = poseAt(move, ms);
    const rctx = rigCanvas.getContext("2d")!;
    rctx.imageSmoothingEnabled = false;
    rctx.clearRect(0, 0, rigCanvas.width, rigCanvas.height);
    if (pixel.checked) {
      // At art resolution with nearest sampling, then scaled: the game's view.
      const actx = art.getContext("2d")!;
      actx.imageSmoothingEnabled = false;
      actx.clearRect(0, 0, art.width, art.height);
      drawRig(actx, pose, 1);
      rctx.drawImage(art, 0, 0, art.width * SCALE, art.height * SCALE);
    } else {
      drawRig(rctx, pose, SCALE);
    }
    if (move === "fire" && ms > 1100 && ms < 1220) {
      // The muzzle, for timing only: the effect is the game's, not this page's.
      rctx.fillStyle = "#ffcd50";
      rctx.beginPath();
      rctx.arc(92 * SCALE, 44 * SCALE, 10 * SCALE * (1 - (ms - 1100) / 120), 0, Math.PI * 2);
      rctx.fill();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
