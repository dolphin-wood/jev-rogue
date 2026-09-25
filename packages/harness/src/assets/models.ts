/**
 * Sprite models: a body's frames composed from pixel parts (doc 016).
 *
 * A model lives in `assets/models/<body>/`:
 *
 * - `palette.json` — material ramps, darkest first (`palette.ts`);
 * - `<facing>.px` — the parts of one facing and their variants (`px.ts`);
 * - `rig.json` — per facing, the parts, their parent and the joint they hang
 *   from, their depth, and where the root sits in the frame;
 * - `poses.json` — per facing, named poses: a variant and a whole-pixel offset
 *   per part;
 * - `anims.json` — the atlas frames the model delivers, each named to a pose.
 *
 * Composing never rotates or scales. It places each part's variant with its
 * pivot on its parent's joint plus the pose's offset, paints back to front,
 * and traces the outline round the finished silhouette — so a part that moved
 * opens no seam, because no part carries an outer edge of its own.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { parsePx, type PxPart, type Shade } from "./px.ts";
import { rgb, type Palette } from "./palette.ts";

export const MODELS_DIR = new URL("../../../../assets/models/", import.meta.url);

export type Facing = "s" | "n" | "w";

export interface RigPart {
  readonly name: string;
  /** The part this one hangs from; `null` hangs it from the frame origin. */
  readonly parent: string | null;
  /** The parent's joint its pivot sits on. Ignored for a root part. */
  readonly joint?: string;
  /** Paint order, low first. */
  readonly depth: number;
}

export interface Rig {
  readonly size: readonly [number, number];
  /** Outline width in art pixels, traced round the composed silhouette. */
  readonly outline: number;
  /** The parts that stand on the ground; in every frame at least one must be down. */
  readonly feet?: readonly string[];
  /**
   * Parts that are their own shape and are meant to float free of the body:
   * a cast shadow under a hovering drone, a spike thrown clear. They are the
   * only thing allowed to break the one-silhouette rule.
   */
  readonly detached?: readonly string[];
  /** Named anchors the game reads per frame, each the name of a joint some part carries. */
  readonly anchors: Readonly<Record<string, string>>;
  /** Anchors only some frames carry: a one-off figure — a dash, a hurt — has no arm to carry the fist. */
  readonly optionalAnchors?: readonly string[];
  /**
   * Anchors a **part** carries rather than a joint (doc 019): the point a
   * subspecies' mark hangs from — horns, a lens barrel, a plume.
   *
   * A joint anchor needs the joint drawn into every variant of the part that
   * carries it, which for a mark would mean editing dozens of `.px` drawings
   * to add a point that changes no pixel. A mark anchor is declared once here
   * instead, as an offset from the named part's **pivot**, so it is stable
   * across that part's variants and rides every pose the part is in — the walk,
   * the windup, the sleep — for free.
   *
   * It resolves like a joint anchor in every other way, and like one it is
   * simply absent from a frame whose pose hides the part.
   */
  readonly marks?: Readonly<Record<string, MarkAnchor>>;
  readonly facings: Readonly<Record<Facing, { readonly origin: readonly [number, number]; readonly parts: readonly RigPart[] }>>;
}

/** Where a mark rides: a part of the rig, and a whole-pixel offset from its pivot. */
export interface MarkAnchor {
  readonly part: string;
  readonly at: readonly [number, number];
  /**
   * Paint order against the body, for the renderer. Omitted means the mark is
   * drawn at its part's own depth, which is what a horn or a plume wants; a
   * mark on a part the body covers gives its own.
   */
  readonly z?: number;
}

/** A part's place in a pose: its variant, offset from its joint, and an optional depth. */
export interface PartPose { readonly v?: string; readonly at?: readonly [number, number]; readonly z?: number }

/**
 * A pose. `base` inherits another pose of the same facing; `null` hides a
 * part. `between` makes an in-between: every part at the rounded
 * interpolation of where it sits in the two poses, drawn in the variant of
 * the pose it is nearer (`t` 0 is the first).
 */
export interface Pose {
  readonly base?: string;
  readonly between?: readonly [string, string];
  readonly t?: number;
  readonly parts?: Readonly<Record<string, string | PartPose | null>>;
  /** Extra per-frame values carried into the atlas's anchors, e.g. `bladeAngleDeg`. */
  readonly meta?: Readonly<Record<string, number>>;
}

export interface Anims {
  readonly facings: readonly Facing[];
  /** Atlas frame name (with `{f}` for the facing) → pose name. */
  readonly frames: Readonly<Record<string, string>>;
  /** Per-facing values carried into every frame's anchors. */
  readonly meta?: Readonly<Partial<Record<Facing, Readonly<Record<string, number>>>>>;
}

export interface Model {
  readonly name: string;
  readonly palette: Palette;
  readonly rig: Rig;
  readonly poses: Readonly<Record<Facing, Readonly<Record<string, Pose>>>>;
  readonly anims: Anims;
  /** Facing → `part.variant` → drawing. */
  readonly parts: ReadonlyMap<Facing, ReadonlyMap<string, PxPart>>;
}

const readJson = <T>(dir: string, file: string): T => JSON.parse(readFileSync(join(dir, file), "utf8")) as T;

export function loadModel(name: string, root: string = MODELS_DIR.pathname): Model {
  const dir = join(root, name);
  const rig = readJson<Rig>(dir, "rig.json");
  const parts = new Map<Facing, Map<string, PxPart>>();
  for (const f of Object.keys(rig.facings) as Facing[]) {
    const file = join(dir, `${f}.px`);
    const px = parsePx(readFileSync(file, "utf8"), file);
    parts.set(f, new Map(px.parts.map((p) => [`${p.part}.${p.variant}`, p])));
  }
  return {
    name,
    palette: readJson<Palette>(dir, "palette.json"),
    rig,
    poses: readJson(dir, "poses.json"),
    anims: readJson<Anims>(dir, "anims.json"),
    parts,
  };
}

/** Every model with a `rig.json`, by directory name. */
export function modelNames(root: string = MODELS_DIR.pathname): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((d) => existsSync(join(root, d, "rig.json"))).sort();
}

/** A part as placed in a frame. */
export interface Placed {
  readonly part: string;
  readonly variant: string;
  readonly drawing: PxPart;
  /** Frame position of the drawing's top-left pixel. */
  readonly x: number;
  readonly y: number;
  readonly depth: number;
}

export type Resolved = Map<string, PartPose | null>;

/** Each part's variant and offset in a pose, after inheritance; `null` where it is hidden. */
export function resolvePose(model: Model, facing: Facing, name: string, seen: string[] = []): Resolved {
  const pose = model.poses[facing]?.[name];
  if (!pose) throw new Error(`${model.name}: no pose ${facing}/${name}`);
  if (seen.includes(name)) throw new Error(`${model.name}: pose cycle ${[...seen, name].join(" → ")}`);
  const out: Resolved = pose.base ? resolvePose(model, facing, pose.base, [...seen, name]) : new Map();
  for (const [part, v] of Object.entries(pose.parts ?? {})) {
    if (v === null) { out.set(part, null); continue; }
    const prev = out.get(part) ?? {};
    const next: PartPose = typeof v === "string" ? { ...prev, v } : { ...prev, ...v };
    out.set(part, next);
  }
  return out;
}

export function poseMeta(model: Model, facing: Facing, name: string): Record<string, number> {
  const pose = model.poses[facing]?.[name];
  if (!pose) return {};
  const inherited = pose.base ? poseMeta(model, facing, pose.base)
    : pose.between ? poseMeta(model, facing, (pose.t ?? 0.5) < 0.5 ? pose.between[0] : pose.between[1])
    : {};
  return { ...inherited, ...(pose.meta ?? {}) };
}

/** Where every visible part of a pose sits in the frame. */
export function place(model: Model, facing: Facing, name: string): Placed[] {
  const pose = model.poses[facing]?.[name];
  if (pose?.between) {
    const t = pose.t ?? 0.5;
    const a = new Map(place(model, facing, pose.between[0]).map((p) => [p.part, p]));
    const b = new Map(place(model, facing, pose.between[1]).map((p) => [p.part, p]));
    const out: Placed[] = [];
    for (const part of new Set([...a.keys(), ...b.keys()])) {
      const pa = a.get(part), pb = b.get(part);
      const take = (t < 0.5 ? pa : pb) ?? pa ?? pb!;
      // Interpolate the pivot, not the corner, so two different drawings of a
      // limb meet at the joint they share.
      const piv = (p: Placed | undefined) => p ? [p.x + p.drawing.pivot[0], p.y + p.drawing.pivot[1]] : null;
      const ka = piv(pa) ?? piv(pb)!, kb = piv(pb) ?? piv(pa)!;
      const px = Math.round(ka[0]! + (kb[0]! - ka[0]!) * t);
      const py = Math.round(ka[1]! + (kb[1]! - ka[1]!) * t);
      out.push({ ...take, x: px - take.drawing.pivot[0], y: py - take.drawing.pivot[1] });
    }
    /*
     * An in-between takes its drawings from the two poses it lies between and
     * ignores what the pose itself asks for, which is right for an offset —
     * there is nothing to offset, the position *is* the interpolation — and
     * wrong for a removal. Hiding a part is not a value to interpolate; it is
     * a statement that the part is not in this frame. The player's swing keys
     * hide the staff, because through a cut the renderer turns a staff sprite
     * of its own, and the two in-between keys went on drawing a posed one
     * underneath it.
     */
    const hidden = Object.entries(pose.parts ?? {}).filter(([, v]) => v === null).map(([k]) => k);
    return hidden.length ? out.filter((p) => !hidden.includes(p.part)) : out;
  }
  const resolved = resolvePose(model, facing, name);
  const rig = model.rig.facings[facing];
  const drawings = model.parts.get(facing)!;
  const placed = new Map<string, Placed>();
  const pending = [...rig.parts];
  // Parents before children, whatever order the rig lists them in.
  for (let guard = 0; pending.length && guard < 64; guard++) {
    for (let i = 0; i < pending.length; i++) {
      const rp = pending[i]!;
      const pp = resolved.get(rp.name);
      if (!pp || !pp.v) { pending.splice(i--, 1); continue; }
      let anchor: readonly [number, number];
      if (rp.parent === null) anchor = rig.origin;
      else {
        const parent = placed.get(rp.parent);
        if (!parent) {
          if (resolved.get(rp.parent)?.v && pending.some((q) => q.name === rp.parent)) continue;
          throw new Error(`${model.name}: ${facing}/${name}: ${rp.name} hangs from hidden ${rp.parent}`);
        }
        const j = parent.drawing.joints[rp.joint ?? ""];
        if (!j) throw new Error(`${model.name}: ${rp.parent}.${parent.variant} has no joint ${rp.joint}`);
        anchor = [parent.x + j[0], parent.y + j[1]];
      }
      const drawing = drawings.get(`${rp.name}.${pp.v}`);
      if (!drawing) throw new Error(`${model.name}: ${facing}/${name}: no drawing ${rp.name}.${pp.v}`);
      const at = pp.at ?? [0, 0];
      placed.set(rp.name, {
        part: rp.name, variant: pp.v, drawing,
        x: anchor[0] + at[0] - drawing.pivot[0],
        y: anchor[1] + at[1] - drawing.pivot[1],
        depth: pp.z ?? rp.depth,
      });
      pending.splice(i--, 1);
    }
  }
  return [...placed.values()];
}

export interface Composed {
  readonly w: number;
  readonly h: number;
  /** Row-major shades, `null` transparent; outline included. */
  readonly px: (Shade | null)[];
  /** Named anchors in frame pixels, plus the pose's meta values. */
  readonly anchors: Record<string, number | [number, number]>;
  readonly placed: readonly Placed[];
}

const OUTLINE: Shade = { material: "outline", shade: 0 };

/** Traces `width` rings of outline round whatever is opaque. */
export function traceOutline(px: (Shade | null)[], w: number, h: number, width: number): void {
  for (let ring = 0; ring < width; ring++) {
    const was = px.map((p) => p !== null);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (was[y * w + x]) continue;
      // The first ring takes corners too, so a diagonal edge is closed; the
      // second takes only sides, which rounds the corners the way the
      // delivered ink is rounded.
      const n8 = ring === 0;
      let touch = false;
      for (let dy = -1; dy <= 1 && !touch; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (!n8 && dx && dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && was[yy * w + xx]) { touch = true; break; }
      }
      if (touch) px[y * w + x] = OUTLINE;
    }
  }
}

export function compose(model: Model, facing: Facing, pose: string): Composed {
  const [w, h] = model.rig.size;
  const placed = place(model, facing, pose).sort((a, b) => a.depth - b.depth);
  const px: (Shade | null)[] = new Array(w * h).fill(null);
  for (const p of placed) {
    const d = p.drawing;
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
      const s = d.px[y * d.w + x];
      if (!s) continue;
      const fx = p.x + x, fy = p.y + y;
      if (fx < 0 || fy < 0 || fx >= w || fy >= h) continue;
      px[fy * w + fx] = s;
    }
  }
  traceOutline(px, w, h, model.rig.outline);
  const anchors: Record<string, number | [number, number]> = {
    ...(model.anims.meta?.[facing] ?? {}),
    ...poseMeta(model, facing, pose),
  };
  for (const [anchor, joint] of Object.entries(model.rig.anchors)) {
    const carrier = placed.find((p) => p.drawing.joints[joint]);
    if (carrier) {
      const j = carrier.drawing.joints[joint]!;
      anchors[anchor] = [carrier.x + j[0], carrier.y + j[1]];
    }
  }
  // A mark hangs from a part's pivot rather than from a drawn joint, so it is
  // the same point in every variant of that part (doc 019). A pose that hides
  // the part carries no mark, exactly as it carries no joint anchor.
  for (const [anchor, mark] of Object.entries(model.rig.marks ?? {})) {
    const carrier = placed.find((p) => p.part === mark.part);
    if (carrier) {
      anchors[anchor] = [
        carrier.x + carrier.drawing.pivot[0] + mark.at[0],
        carrier.y + carrier.drawing.pivot[1] + mark.at[1],
      ];
    }
  }
  return { w, h, px, anchors, placed };
}

export function toPng(model: Model, c: Composed): PNG {
  const png = new PNG({ width: c.w, height: c.h });
  png.data.fill(0);
  const cache = new Map<string, readonly number[]>();
  c.px.forEach((s, i) => {
    if (!s) return;
    const key = `${s.material}.${s.shade}`;
    let col = cache.get(key);
    if (!col) {
      const ramp = model.palette.ramps[s.material];
      const hexv = ramp?.[s.shade];
      if (!hexv) throw new Error(`${model.name}: no colour for ${key}`);
      col = [...rgb(hexv), 255];
      cache.set(key, col);
    }
    png.data.set(col, i * 4);
  });
  return png;
}

/**
 * One part of a model, alone in a frame, with a joint of its own at the
 * frame's centre.
 *
 * For the pieces the renderer places rather than the rig posing. The player's
 * staff is one of them in **every** state, not only through a cut: it points
 * wherever the pose or the cut points, five drawn keys per facing cannot
 * follow a continuous aim, and the frames that tried came out with the staff
 * upside down and its crystal at the floor. No pose draws one, so there is
 * one staff and one place it can be wrong. Cutting it from the model rather
 * than asking for a separate drawing is what keeps it the same staff.
 *
 * The fist that holds it is cut the same way, and asks for `outline: 0`.
 */
export function partFrame(
  model: Model, facing: Facing, part: string, variant: string, joint: string | null, size: number,
  /**
   * Where along the part the frame is centred, as a fraction from `joint`
   * toward the pixel furthest from it. `undefined` centres on `joint` itself,
   * or on the part's pivot when no joint is named.
   *
   * A staff is turned about the **hand**, and a hand holds a staff near its
   * butt, not in the middle. The part's own pivot is where the arm's `hand`
   * joint carries it inside the body, which for the player's staff is a
   * little over halfway up the shaft — turned about that, the staff span the
   * hand like a baton. 0.93 from the crystal is a grip a fourteenth of the
   * way up from the butt, which is where a hand goes.
   */
  alongTo?: number,
  /**
   * Rings of ink traced round the cut, defaulting to the rig's own width.
   *
   * A part that is **interior** to the body carries all the ink it needs
   * already: the fist is drawn with its own black border because in the
   * composed frame it sits inside a sleeve, where nothing traces round it.
   * Cut out and traced anyway, it came back a twelve-pixel ball with a double
   * outline, and painted over the staff it read as a knob on the shaft rather
   * than as a hand holding it. So a part like that asks for none.
   */
  outline?: number,
): { png: PNG; anchors: Record<string, number | [number, number]> } {
  const drawing = model.parts.get(facing)?.get(`${part}.${variant}`);
  if (!drawing) throw new Error(`${model.name}: no drawing ${part}.${variant} for ${facing}`);
  // `null` centres on the part's **pivot**, which for a held thing is where
  // the hand grips it — the point it is turned about.
  const from = joint === null ? drawing.pivot : drawing.joints[joint];
  if (!from) throw new Error(`${model.name}: ${part}.${variant} has no joint ${joint}`);
  let at: readonly [number, number] = from;
  if (alongTo !== undefined) {
    let far = from, best = -1;
    for (let y = 0; y < drawing.h; y++) for (let x = 0; x < drawing.w; x++) {
      if (!drawing.px[y * drawing.w + x]) continue;
      const d = (x - from[0]) ** 2 + (y - from[1]) ** 2;
      if (d > best) { best = d; far = [x, y]; }
    }
    at = [Math.round(from[0] + (far[0] - from[0]) * alongTo), Math.round(from[1] + (far[1] - from[1]) * alongTo)];
  }
  const px: (Shade | null)[] = new Array(size * size).fill(null);
  // The named joint lands on the frame's centre, so the renderer turns the
  // sprite about it by setting the origin to the middle.
  const ox = (size >> 1) - at[0], oy = (size >> 1) - at[1];
  for (let y = 0; y < drawing.h; y++) for (let x = 0; x < drawing.w; x++) {
    const s = drawing.px[y * drawing.w + x];
    if (!s) continue;
    const fx = ox + x, fy = oy + y;
    if (fx < 0 || fy < 0 || fx >= size || fy >= size) continue;
    px[fy * size + fx] = s;
  }
  traceOutline(px, size, size, outline ?? model.rig.outline);
  const composed: Composed = { w: size, h: size, px, anchors: {}, placed: [] };
  const anchors: Record<string, number | [number, number]> = {};
  for (const [name, [jx, jy]] of Object.entries(drawing.joints))
    anchors[name] = [ox + jx, oy + jy];
  return { png: toPng(model, composed), anchors };
}

/**
 * The names of the atlas frames the model delivers, without composing them.
 * `modelFrames(model).keys()` gives the same names, at the cost of drawing
 * and encoding every frame.
 */
export function modelFrameNames(model: Model): string[] {
  const out: string[] = [];
  for (const facing of model.anims.facings)
    for (const template of Object.keys(model.anims.frames)) out.push(template.replace("{f}", facing));
  return out;
}

/** Every atlas frame the model delivers, composed. */
export function modelFrames(model: Model): Map<string, { png: PNG; composed: Composed; facing: Facing; pose: string }> {
  const out = new Map<string, { png: PNG; composed: Composed; facing: Facing; pose: string }>();
  for (const facing of model.anims.facings)
    for (const [template, pose] of Object.entries(model.anims.frames)) {
      const composed = compose(model, facing, pose);
      out.set(template.replace("{f}", facing), { png: toPng(model, composed), composed, facing, pose });
    }
  return out;
}

/* ----------------------------------------------------------------------- *
 * Checks (doc 016). Each returns a list of problems, empty when it passes.
 * ----------------------------------------------------------------------- */

/** One connected silhouette, counting the outline, so no part floats free. */
export function checkSilhouette(c: Composed, detached: readonly string[] = []): string[] {
  const { w, h, px } = c;
  const seen = new Uint8Array(w * h);
  let islands = 0;
  let small = 0;
  for (let i = 0; i < px.length; i++) {
    if (!px[i] || seen[i]) continue;
    islands++;
    let size = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      const x = k % w, y = (k / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const n = yy * w + xx;
        if (px[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    if (size < 12) small++;
  }
  const allowed = 1 + detached.filter((d) => c.placed.some((p) => p.part === d)).length;
  const out: string[] = [];
  if (islands > allowed) out.push(`${islands} separate shapes, ${allowed} allowed`);
  if (small) out.push(`${small} stray fragments under 12 px`);
  return out;
}

/** Share of the union of two frames' silhouettes that only one of them covers. */
export function silhouetteChange(a: Composed, b: Composed): number {
  let only = 0, union = 0;
  for (let i = 0; i < a.px.length; i++) {
    const pa = !!a.px[i], pb = !!b.px[i];
    if (pa || pb) union++;
    if (pa !== pb) only++;
  }
  return union ? only / union : 0;
}

export function samePixels(a: Composed, b: Composed): boolean {
  for (let i = 0; i < a.px.length; i++) {
    const x = a.px[i], y = b.px[i];
    if (!x !== !y) return false;
    if (x && y && (x.material !== y.material || x.shade !== y.shade)) return false;
  }
  return true;
}

