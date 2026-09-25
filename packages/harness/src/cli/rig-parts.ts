/**
 * Draws the player's skeleton parts for the rig test (`/anim-lab.html`).
 *
 * The first rig cut the warden's frame into parts and nothing more, so a limb
 * that swung left a hole in the body and stray outline behind it. These parts
 * are drawn to be moved: cut from the delivered `player_s_idle0`, then
 *
 * - the body is **filled in** where an arm or a leg covered it — the hidden
 *   robe inpainted from the robe round it — and outlined afresh, so a limb
 *   swinging away shows cloth, not a gap;
 * - each limb gets a **joint cap** at its pivot, a round of its own sleeve or
 *   trouser under it, so turning never opens a seam.
 *
 * Writes `assets/source/rig/player-parts.png` (the parts side by side, each
 * on the frame's own 64 px canvas, so a part drawn at the origin is in place)
 * and `player-parts.json` (names, pivots, parents, order).
 *
 * Run: `pnpm rig:parts`
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const ROOT = new URL("../../../../", import.meta.url);
const atlas = PNG.sync.read(readFileSync(new URL("assets/sprites.png", ROOT)));
const frames = JSON.parse(readFileSync(new URL("assets/sprites.json", ROOT), "utf8")).frames as Record<string, { x: number; y: number; w: number; h: number }>;
const F = frames["player_s_idle0"]!;
const W = F.w;
const H = F.h;

type Px = [number, number, number, number];
const src: (Px | null)[] = [];
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = ((F.y + y) * atlas.width + F.x + x) * 4;
    src.push(atlas.data[i + 3]! > 0 ? [atlas.data[i]!, atlas.data[i + 1]!, atlas.data[i + 2]!, atlas.data[i + 3]!] : null);
  }

interface Part {
  readonly name: string;
  readonly claim: readonly (readonly [number, number, number, number])[];
  readonly pivot: readonly [number, number];
  readonly parent: string | null;
  readonly z: number;
  /** A joint cap under the part at its pivot, in px radius; 0 for none. */
  readonly cap: number;
}

/*
 * Read off the frame on an 8 px grid. The screen-left hand holds the sword
 * (the anchors' grip), the right is the casting hand. First claim wins.
 */
const PARTS: readonly Part[] = [
  { name: "head", claim: [[15, 1, 49, 32]], pivot: [32, 30], parent: "torso", z: 4, cap: 0 },
  { name: "swordArm", claim: [[4, 23, 23, 41]], pivot: [21, 30], parent: "torso", z: 5, cap: 3 },
  { name: "castArm", claim: [[41, 25, 60, 42]], pivot: [42, 31], parent: "torso", z: 5, cap: 3 },
  // Below the robe's hem, so the hem stays with the body; the hips turn under it.
  { name: "legL", claim: [[10, 51, 31, 63]], pivot: [25, 48], parent: "pelvis", z: 1, cap: 3 },
  { name: "legR", claim: [[33, 51, 52, 63]], pivot: [38, 48], parent: "pelvis", z: 1, cap: 3 },
  { name: "torso", claim: [[0, 0, 64, 64]], pivot: [32, 46], parent: "pelvis", z: 2, cap: 0 },
];

/** The robe's own outline, where it would be if nothing stood in front of it. */
const BODY_HULL: readonly [number, number][] = [
  [23, 27], [41, 27], [45, 30], [46, 34], [47, 40], [49, 47], [47, 50], [17, 50], [15, 47], [17, 40], [18, 34], [19, 30],
];

/** Where the sleeves overlapped the body in the drawing: repainted as cloth. */
const inArmShadow = (x: number, y: number) => (x < 22 || x > 42) && y > 27 && y < 42;

const inHull = (x: number, y: number, hull: readonly [number, number][]) => {
  let inside = false;
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
    const [xi, yi] = hull[i]!;
    const [xj, yj] = hull[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const lum = (p: Px) => p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11;
// The sheet's outline colour: its darkest common pixel.
const OUTLINE: Px = (() => {
  const seen = new Map<string, { p: Px; n: number }>();
  for (const p of src) if (p) { const k = p.slice(0, 3).join(); seen.set(k, { p, n: (seen.get(k)?.n ?? 0) + 1 }); }
  return [...seen.values()].filter((v) => v.n > 10).sort((a, b) => lum(a.p) - lum(b.p))[0]!.p;
})();

const layers = new Map<string, (Px | null)[]>();
const owner: (string | null)[] = src.map(() => null);
for (const part of PARTS) {
  const layer: (Px | null)[] = src.map(() => null);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      if (!src[k] || owner[k]) continue;
      if (!part.claim.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)) continue;
      layer[k] = src[k];
      owner[k] = part.name;
    }
  layers.set(part.name, layer);
}

// The body, filled in: every hull pixel with no robe of its own takes the
// nearest robe pixel's colour (a breadth-first flood from the robe inward),
// ignoring outline, so the fill is cloth and not a smear of black.
{
  const body = layers.get("torso")!;
  const queue: number[] = [];
  const dist = new Int32Array(W * H).fill(-1);
  // Seeds are the robe's own cloth — its blue mid tones — not the pale trim or
  // the rim, which smeared into beige patches where a sleeve had been.
  const cloth = (p: Px | null) => !!p && lum(p) > lum(OUTLINE) + 25 && lum(p) < 150 && p[2] > p[0] + 20;
  for (let k = 0; k < W * H; k++) if (cloth(body[k]!)) { dist[k] = 0; queue.push(k); }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q]!;
    const x = k % W;
    const y = (k / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (dist[n]! >= 0 || !inHull(nx, ny, BODY_HULL)) continue;
      if (body[n] && lum(body[n]!) > lum(OUTLINE) + 25 && !inArmShadow(nx, ny)) continue;
      dist[n] = dist[k]! + 1;
      body[n] = body[k]!;
      queue.push(n);
    }
  }
  // A fresh outline round the filled body.
  const edge: number[] = [];
  for (let k = 0; k < W * H; k++) {
    if (body[k]) continue;
    const x = k % W;
    const y = (k / W) | 0;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => body[(y + dy!) * W + x + dx!] && x + dx! >= 0 && x + dx! < W)) edge.push(k);
  }
  for (const k of edge) body[k] = OUTLINE;
}

// Joint caps: a disc of the limb's mid tone at its pivot, outlined, under the limb.
for (const part of PARTS) {
  if (!part.cap) continue;
  const layer = layers.get(part.name)!;
  const [px, py] = part.pivot;
  // The cloth at the joint: the commonest mid tone within a few px of the
  // pivot, not the hand's skin or the rim.
  const near = new Map<string, { p: Px; n: number }>();
  for (let y = -7; y <= 7; y++)
    for (let x = -7; x <= 7; x++) {
      const p = layer[(py + y) * W + px + x];
      // Blue cloth only: the cuff's beige made a pale blot at the shoulder.
      if (!p || lum(p) < lum(OUTLINE) + 25 || lum(p) > 150 || p[2] < p[0] + 20) continue;
      const key = p.slice(0, 3).join();
      near.set(key, { p, n: (near.get(key)?.n ?? 0) + 1 });
    }
  const mid = [...near.values()].sort((a, b) => b.n - a.n)[0]?.p ?? OUTLINE;
  for (let y = -part.cap - 1; y <= part.cap + 1; y++)
    for (let x = -part.cap - 1; x <= part.cap + 1; x++) {
      const d = Math.hypot(x, y);
      const k = (py + y) * W + px + x;
      if (d > part.cap + 1 || layer[k]) continue;
      layer[k] = d > part.cap ? OUTLINE : mid;
    }
}

// The sheet: each part on its own full frame, left to right.
const out = new PNG({ width: W * PARTS.length, height: H });
PARTS.forEach((part, i) => {
  const layer = layers.get(part.name)!;
  for (let k = 0; k < W * H; k++) {
    const p = layer[k];
    if (!p) continue;
    const x = (k % W) + i * W;
    const y = (k / W) | 0;
    out.data.set(p, (y * out.width + x) * 4);
  }
});
const dir = new URL("assets/source/rig/", ROOT);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("player-parts.png", dir), PNG.sync.write(out));
writeFileSync(new URL("player-parts.json", dir), JSON.stringify({
  frame: { w: W, h: H },
  parts: PARTS.map((p, i) => ({ name: p.name, x: i * W, pivot: p.pivot, parent: p.parent, z: p.z })),
}, null, 2) + "\n");
console.log(`${PARTS.length} parts → assets/source/rig/player-parts.png`);
