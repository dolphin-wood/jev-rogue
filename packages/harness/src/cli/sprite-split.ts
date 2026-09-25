/**
 * Turns delivered figures into a sprite model, once (doc 016).
 *
 * Reads `assets/models/<body>/split.json`: the material rules, the rig, and
 * per facing the delivered frames to take variants from, each with rough part
 * claims and its joints. For each source frame:
 *
 * 1. quantise it to the body's palette (found here the first time, then
 *    read from `palette.json`, so hand fixes to the palette stick);
 * 2. take its part map from `maps/<frame>.map` — a text grid, one letter per
 *    part — or propose one from the claims and write it, for correcting by
 *    hand; the map is the one judgement in the process;
 * 3. strip the outer outline, which the compositor traces afresh;
 * 4. complete each part where another covered it, inside the part's `fill`
 *    outline, from the part's own nearest colours;
 * 5. crop each part to its drawing, with its pivot and the joints its
 *    children and the game's anchors hang from.
 *
 * Writes `<facing>.px`, `rig.json`, `palette.json` and a pose per source
 * (named for its variant) into `poses.json`, each only where it does not
 * exist yet — `--force` rewrites the split's own drawings and the rig, and
 * keeps any variant drawn since — and reports how
 * closely each source's pose composes back to the frame it came from.
 *
 * Run: `pnpm sprite:split <body> [--force]`
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deliveredFrame } from "../assets/art.ts";
import { MANIFEST, atScale } from "../assets/manifest.ts";
import { findPalette, hex, quantise, rgb, type MaterialRule, type Palette, type Rgb } from "../assets/palette.ts";
import { assignLetters, parsePx, writePx, type PxPart, type Shade } from "../assets/px.ts";
import { compose, loadModel, MODELS_DIR, type Facing, type Pose, type Rig } from "../assets/models.ts";

type Rect = readonly [number, number, number, number];
type Pt = readonly [number, number];

interface Source {
  readonly variant: string;
  readonly frame: string;
  /** Part → rectangles `[x0, y0, x1, y1)` it claims; the first part to claim a pixel has it. */
  readonly claims?: Readonly<Record<string, readonly Rect[]>>;
  /** Joint name → frame position. */
  readonly joints?: Readonly<Record<string, Pt>>;
  /** Part → polygon it is completed inside, where another part covered it. */
  readonly fill?: Readonly<Record<string, readonly Pt[]>>;
}

interface SplitConfig {
  readonly rules: readonly MaterialRule[];
  readonly outlineLuma: number;
  /** The delivered frames the palette is found from. */
  readonly paletteFrames: readonly string[];
  /** Part → its letter in the map files. The part that takes unclaimed pixels is `rest`. */
  readonly letters: Readonly<Record<string, string>>;
  readonly rest: string;
  /** Part → the materials its completion is copied from (all but ink when absent). */
  readonly fillFrom?: Readonly<Record<string, readonly string[]>>;
  /**
   * Claims as fractions of the source figure's own bounds, `[x0, y0, x1, y1]`
   * in 0..1, used for every source that names none of its own. One table
   * serves every facing and every variant of a body, because a figure's parts
   * sit in the same proportion of its silhouette however it is drawn.
   */
  readonly claimsFrac?: Readonly<Partial<Record<Facing, Readonly<Record<string, readonly Rect[]>>>>>;
  /** Joints as fractions of the source's bounds, for the joints a source does not place itself. */
  readonly jointsFrac?: Readonly<Partial<Record<Facing, Readonly<Record<string, Pt>>>>>;
  /**
   * Part → how far its completion may reach, in pixels, where a nearer part
   * covered it. A radius rather than a polygon: on a body whose parts overlap
   * by a limb's width it says the same thing in one number, and the flood is
   * already distance-ordered.
   */
  readonly fillRadius?: Readonly<Record<string, number>>;
  /**
   * A value lift applied to every ramp but the outline when the palette is
   * found, 1 for none.
   *
   * The roster's value band is already in the figures a model is split from
   * (`enemyValueBand` in `art.ts`), so a body normally needs nothing here.
   * This is the per-body nudge for one that does: it puts the change in the
   * model's own colours, where it can be seen and edited, rather than in a
   * multiply over every frame.
   */
  readonly lift?: number;
  /** Which parts can carry each of the game's anchors (a joint of that name). */
  readonly anchorsOn: Readonly<Record<string, string | readonly string[]>>;
  /** Anchors read from `assets/source/player-anchors.json` when a source gives none. */
  readonly anchorsFile?: string;
  readonly rig: Omit<Rig, "facings" | "anchors"> & { readonly facings: Rig["facings"] };
  readonly facings: Readonly<Partial<Record<Facing, readonly Source[]>>>;
}

const ROOT = new URL("../../../../", import.meta.url);
const body = process.argv[2];
const force = process.argv.includes("--force");
if (!body) throw new Error("usage: sprite-split <body> [--force]");
const dir = join(MODELS_DIR.pathname, body);
const cfg = JSON.parse(readFileSync(join(dir, "split.json"), "utf8")) as SplitConfig;

// The table is in the first scale's frame pixels (2 per world px); scaled to this one.
const anchorFile: Record<string, Record<string, Pt>> = cfg.anchorsFile
  ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(new URL(cfg.anchorsFile, ROOT), "utf8")) as Record<string, Record<string, unknown>>)
    .map(([frame, a]) => [frame, Object.fromEntries(Object.entries(a).filter(([, v]) => Array.isArray(v))
      .map(([k, v]) => [k, (v as number[]).map((n) => atScale(n)) as unknown as Pt]))]))
  : {};

/** A frame as the delivered sheets make it — never the atlas, which may already hold the model. */
function grab(name: string): { w: number; h: number; px: (Rgb | null)[] } {
  const spec = MANIFEST.find((f) => f.name === name);
  if (!spec) throw new Error(`no manifest frame ${name}`);
  const png = deliveredFrame(spec);
  const px: (Rgb | null)[] = [];
  for (let i = 0; i < png.data.length; i += 4)
    px.push(png.data[i + 3]! ? [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!] : null);
  return { w: png.width, h: png.height, px };
}

/** A palette with every ramp but the outline scaled in value. */
function scaleRamps(p: Palette, k: number): Palette {
  if (k === 1) return p;
  const ramps: Record<string, string[]> = {};
  for (const [material, ramp] of Object.entries(p.ramps))
    ramps[material] = material === "outline" ? [...ramp]
      : ramp.map((h) => hex(rgb(h).map((v) => Math.max(0, Math.min(255, Math.round(v * k)))) as unknown as Rgb));
  return { ramps };
}

// 1. The palette.
const palettePath = join(dir, "palette.json");
let palette: Palette;
if (existsSync(palettePath) && !process.argv.includes("--palette")) palette = JSON.parse(readFileSync(palettePath, "utf8"));
else {
  const all: Rgb[] = [];
  for (const n of cfg.paletteFrames) all.push(...grab(n).px.filter((p): p is Rgb => !!p));
  palette = findPalette(all, cfg.rules, cfg.outlineLuma);
  palette = scaleRamps(palette, cfg.lift ?? 1);
  writeFileSync(palettePath, JSON.stringify(palette, null, 2) + "\n");
  console.log(`palette: ${Object.values(palette.ramps).flat().length} colours → palette.json`);
}
/**
 * The palette a figure is *matched* against, which is the model's own with
 * the lift taken back out.
 *
 * Quantising against the lifted ramp would undo the lift: nearest-shade
 * matching only cares about order, so a brighter ramp simply sends every
 * pixel one shade darker and the composed frame comes out exactly as bright
 * as the figure it was split from. The figure is matched at its own value and
 * painted at the model's.
 */
const matchPalette = scaleRamps(palette, 1 / (cfg.lift ?? 1));
const legend = assignLetters(palette.ramps);

const isInk = (s: Shade | null) => !!s && s.material === "outline";
const inPoly = (x: number, y: number, poly: readonly Pt[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const letterPart = new Map(Object.entries(cfg.letters).map(([p, l]) => [l, p]));
const mapsDir = join(dir, "maps");
mkdirSync(mapsDir, { recursive: true });
const pxOut = new Map<Facing, PxPart[]>();
const newPoses: Partial<Record<Facing, Record<string, Pose>>> = {};

for (const [facing, sources] of Object.entries(cfg.facings) as [Facing, Source[]][]) {
  const rigFacing = cfg.rig.facings[facing];
  const origin = rigFacing.origin;
  for (const src of sources) {
    const frame = src.frame;
    const g = grab(frame);
    const W = g.w, H = g.h;
    const q: (Shade | null)[] = g.px.map((p) => (p ? quantise(p, matchPalette, cfg.rules, cfg.outlineLuma) : null));

    // The figure's own bounds, which the fractional claims and joints are read
    // against: a body sits where its silhouette is, not where the frame is.
    let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
    q.forEach((s, k) => {
      if (!s) return;
      const x = k % W, y = (k / W) | 0;
      bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
    });
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    const atFrac = (fx: number, fy: number): Pt => [Math.round(bx0 + fx * (bw - 1)), Math.round(by0 + fy * (bh - 1))];
    const claims: Record<string, readonly Rect[]> = src.claims ?? Object.fromEntries(
      Object.entries(cfg.claimsFrac?.[facing] ?? {}).map(([part, rects]) => [part, rects.map(([x0, y0, x1, y1]) => {
        const a = atFrac(x0, y0), b = atFrac(x1, y1);
        return [a[0], a[1], b[0] + 1, b[1] + 1] as Rect;
      })]));
    const joints: Readonly<Record<string, Pt>> = {
      ...Object.fromEntries(Object.entries(cfg.jointsFrac?.[facing] ?? {}).map(([n, [fx, fy]]) => [n, atFrac(fx, fy)])),
      ...(src.joints ?? {}),
    };

    // 2. The part map.
    const mapPath = join(mapsDir, `${frame}.map`);
    let owner: (string | null)[];
    if (existsSync(mapPath)) {
      const rows = readFileSync(mapPath, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
      owner = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const ch = rows[y]?.[x] ?? ".";
        owner.push(ch === "." ? null : letterPart.get(ch) ?? (() => { throw new Error(`${mapPath}: unknown letter ${ch}`); })());
      }
      // A pixel the map leaves out but the frame has goes to the rest.
      owner = owner.map((o, k) => (q[k] ? o ?? cfg.rest : null));
    } else {
      owner = q.map((s, k) => {
        if (!s) return null;
        const x = k % W, y = (k / W) | 0;
        for (const [part, rects] of Object.entries(claims))
          if (rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)) return part;
        return cfg.rest;
      });
      const text = [`# ${frame}: one letter per part (${Object.entries(cfg.letters).map(([p, l]) => `${l}=${p}`).join(" ")}). Edit freely; sprite:split reads it.`];
      for (let y = 0; y < H; y++) {
        let row = "";
        for (let x = 0; x < W; x++) row += owner[y * W + x] ? cfg.letters[owner[y * W + x]!] : ".";
        text.push(row);
      }
      writeFileSync(mapPath, text.join("\n") + "\n");
      console.log(`${frame}: proposed part map → maps/${frame}.map`);
    }

    // 3. Strip the outer outline: the ring touching outside by a side, then
    // the one touching it at all — the inverse of the compositor's trace.
    const opaque = q.map((s) => !!s);
    for (const n8 of [false, true]) {
      const was = [...opaque];
      for (let k = 0; k < q.length; k++) {
        if (!was[k] || !isInk(q[k]!)) continue;
        const x = k % W, y = (k / W) | 0;
        let out = false;
        for (let dy = -1; dy <= 1 && !out; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || (!n8 && dx && dy)) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H || !was[yy * W + xx]) { out = true; break; }
        }
        if (out) opaque[k] = false;
      }
    }

    // 4. Each part's completion: where a part in front of it covered it — a
    // pixel the frame had and the map gave to something nearer the eye —
    // inside the part's fill outline. A gap in the figure stays a gap, and a
    // part behind this one is not painted over.
    const depthOf = new Map(rigFacing.parts.map((p) => [p.name, p.depth]));
    const filled = new Map<string, (Shade | null)[]>();
    for (const rp of rigFacing.parts) {
      const poly = src.fill?.[rp.name];
      const radius = cfg.fillRadius?.[rp.name];
      if (!poly && radius === undefined) continue;
      const add: (Shade | null)[] = q.map(() => null);
      const dist = new Int32Array(W * H).fill(-1);
      const queue: number[] = [];
      // Seeded from the part's body material only: a completion copied from
      // the nearest pixel of any kind drew streaks of belt and trim shadow.
      const from = cfg.fillFrom?.[rp.name];
      const own = (k: number) => owner[k] === rp.name && !!q[k] && !isInk(q[k]!) && (!from || from.includes(q[k]!.material));
      for (let k = 0; k < q.length; k++) if (own(k)) { dist[k] = 0; queue.push(k); }
      for (let qi = 0; qi < queue.length; qi++) {
        const k = queue[qi]!;
        const x = k % W, y = (k / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const n = yy * W + xx;
          if (dist[n]! >= 0 || !owner[n] || !(depthOf.get(owner[n]!)! > rp.depth)) continue;
          if (poly ? !inPoly(xx + 0.5, yy + 0.5, poly) : dist[k]! + 1 > radius!) continue;
          dist[n] = dist[k]! + 1;
          add[n] = add[k] ?? q[k]!;
          queue.push(n);
        }
      }
      filled.set(rp.name, add);
    }
    // An outer ink pixel with another part completed under it is not outline:
    // it is this part's edge against that one, and moves with this part.
    const under = (k: number) => [...filled].some(([part, add]) => part !== owner[k] && add[k]);

    // 5. Each part: its own pixels less the stripped outline, plus its
    // completion, cropped.
    for (const rp of rigFacing.parts) {
      const add = filled.get(rp.name);
      const layer: (Shade | null)[] = q.map((s, k) =>
        owner[k] === rp.name && (opaque[k] || under(k)) ? s : add?.[k] ?? null);
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      layer.forEach((s, k) => {
        if (!s) return;
        const x = k % W, y = (k / W) | 0;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      });
      if (x1 < 0) continue;
      const pivotFrame: Pt = rp.parent === null ? origin : joints[rp.joint!] ?? (() => { throw new Error(`${frame}: no joint ${rp.joint} for ${rp.name}`); })();
      const carried: Record<string, [number, number]> = {};
      for (const child of rigFacing.parts.filter((c) => c.parent === rp.name)) {
        const j = joints[child.joint!];
        if (!j) throw new Error(`${frame}: no joint ${child.joint} for ${child.name}`);
        carried[child.joint!] = [j[0] - x0, j[1] - y0];
      }
      for (const [anchor, parts] of Object.entries(cfg.anchorsOn)) {
        if (![parts].flat().includes(rp.name)) continue;
        const at = joints[anchor] ?? anchorFile[frame]?.[anchor];
        if (at) carried[anchor] = [at[0] - x0, at[1] - y0];
      }
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const px: (Shade | null)[] = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px.push(layer[y * W + x]!);
      (pxOut.get(facing) ?? pxOut.set(facing, []).get(facing)!).push({
        part: rp.name, variant: src.variant, pivot: [pivotFrame[0] - x0, pivotFrame[1] - y0], joints: carried, w, h, px,
      });
    }
    const parts: Record<string, string> = {};
    for (const rp of rigFacing.parts) if (pxOut.get(facing)!.some((p) => p.part === rp.name && p.variant === src.variant)) parts[rp.name] = src.variant;
    (newPoses[facing] ??= {})[src.variant] = { parts };
  }
}

// Write what is missing (or everything drawn, with --force).
for (const [facing, parts] of pxOut) {
  const file = join(dir, `${facing}.px`);
  if (existsSync(file) && !force) { console.log(`${facing}.px exists; kept (--force to rewrite)`); continue; }
  // Drawings the split did not make — variants drawn since — are kept as they are.
  const made = new Set(parts.map((p) => `${p.part}.${p.variant}`));
  const drawn = existsSync(file) ? parsePx(readFileSync(file, "utf8"), file).parts.filter((p) => !made.has(`${p.part}.${p.variant}`)) : [];
  writeFileSync(file, writePx(legend, [...parts, ...drawn], `${body}, facing ${facing}. Split from the delivered frames by sprite:split; the parts are now the source.`));
  console.log(`${facing}.px: ${parts.length} split, ${drawn.length} drawn since and kept`);
}
const rigPath = join(dir, "rig.json");
if (!existsSync(rigPath) || force) {
  const anchors = Object.fromEntries(Object.keys(cfg.anchorsOn).map((a) => [a, a]));
  writeFileSync(rigPath, JSON.stringify({ ...cfg.rig, anchors }, null, 2) + "\n");
}
const posesPath = join(dir, "poses.json");
const poses = existsSync(posesPath) ? JSON.parse(readFileSync(posesPath, "utf8")) : {};
for (const [facing, list] of Object.entries(newPoses)) for (const [n, p] of Object.entries(list!)) (poses[facing] ??= {})[n] ??= p;
writeFileSync(posesPath, JSON.stringify(poses, null, 2) + "\n");
const animsPath = join(dir, "anims.json");
if (!existsSync(animsPath)) writeFileSync(animsPath, JSON.stringify({ facings: Object.keys(cfg.facings), frames: {} }, null, 2) + "\n");

// The round trip: each source's pose against its own quantised frame.
const model = loadModel(body);
for (const [facing, sources] of Object.entries(cfg.facings) as [Facing, Source[]][])
  for (const src of sources) {
    const c = compose(model, facing, src.variant);
    const g = grab(src.frame);
    let diff = 0, shape = 0, total = 0;
    g.px.forEach((p, k) => {
      const want = p ? quantise(p, matchPalette, cfg.rules, cfg.outlineLuma) : null;
      const got = c.px[k];
      if (want || got) total++;
      if (!want !== !got) shape++;
      else if (want && got && (want.material !== got.material || want.shade !== got.shade)) diff++;
    });
    console.log(`round trip ${src.frame} as ${facing}/${src.variant}: ${shape} px of shape and ${diff} of colour differ, of ${total}`);
  }
