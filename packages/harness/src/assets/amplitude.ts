/**
 * How much a body actually moves between frames (doc 016).
 *
 * The roster was rebuilt as sprite models and every body gained frames, and
 * it still read as stiff. The reason was not the frame count: it was the
 * **amplitude**. A foot that travels two pixels on a thirty-two pixel body is
 * a foot that has not moved, and eight frames of it is a slideshow of one
 * drawing. Measured, the first walk cycles changed 4% of their silhouette per
 * frame and moved a foot by two pixels fore and aft while the body crossed
 * half a tile — so the feet slid and nothing swung.
 *
 * Frame count is easy to add and easy to mistake for animation, so the thing
 * that is hard is the thing that gets measured here:
 *
 * - **Silhouette change**, as 1 − IoU of two frames' alpha masks: between
 *   consecutive frames, and between a cycle's two most different frames. The
 *   second is the one that matters — a cycle can change a little every frame
 *   and still never leave its rest pose.
 * - **Part travel**: how far each part's pivot moves over a cycle, in art
 *   pixels. Feet, hands and head are named separately because they are what
 *   the eye tracks.
 *
 * The thresholds are asserted in `amplitude.test.ts`, so a body cannot drift
 * back to near-static without the build saying so.
 */
import { compose, place, type Composed, type Facing, type Model } from "./models.ts";

export interface CycleAmplitude {
  readonly body: string;
  readonly facing: Facing;
  /** The cycle's name without its index: `walk`, `idle`, `dormant`, `watch`. */
  readonly cycle: string;
  readonly frames: number;
  /** Mean 1 − IoU between consecutive frames, wrapping. */
  readonly step: number;
  /** 1 − IoU between the two most different frames of the cycle. */
  readonly extremes: number;
  /** Part → how far its pivot travels over the cycle, in art px (max minus min, per axis, summed as a span). */
  readonly travel: Readonly<Record<string, number>>;
}

/** 1 − intersection over union of two frames' alpha masks. */
export function silhouetteDistance(a: Composed, b: Composed): number {
  let both = 0, either = 0;
  for (let i = 0; i < a.px.length; i++) {
    const pa = !!a.px[i], pb = !!b.px[i];
    if (pa && pb) both++;
    if (pa || pb) either++;
  }
  return either ? 1 - both / either : 0;
}

/** Where every part's pivot sits in a pose, in frame pixels. */
function pivots(model: Model, facing: Facing, pose: string): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const p of place(model, facing, pose))
    out[p.part] = [p.x + p.drawing.pivot[0], p.y + p.drawing.pivot[1]];
  return out;
}

/** Every cycle a model's frames contain, as pose lists in index order. */
export function cyclesOf(model: Model): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [template, pose] of Object.entries(model.anims.frames)) {
    const m = template.match(/_([a-z_]+?)(\d+)$/);
    if (!m) continue;
    const key = m[1]!;
    const list = out.get(key) ?? [];
    list[Number(m[2])] = pose;
    out.set(key, list);
  }
  for (const [k, v] of out) if (v.filter(Boolean).length < 2) out.delete(k);
  return out;
}

export function measureModel(name: string, model: Model): CycleAmplitude[] {
  const out: CycleAmplitude[] = [];
  for (const facing of model.anims.facings)
    for (const [cycle, poses] of cyclesOf(model)) {
      const frames = poses.filter(Boolean);
      const composed = frames.map((p) => compose(model, facing, p));
      let step = 0;
      for (let i = 0; i < composed.length; i++)
        step += silhouetteDistance(composed[i]!, composed[(i + 1) % composed.length]!);
      step /= composed.length;
      let extremes = 0;
      for (let i = 0; i < composed.length; i++)
        for (let j = i + 1; j < composed.length; j++)
          extremes = Math.max(extremes, silhouetteDistance(composed[i]!, composed[j]!));
      const spans = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
      for (const pose of frames)
        for (const [part, [x, y]] of Object.entries(pivots(model, facing, pose))) {
          const s = spans.get(part) ?? { x0: x, x1: x, y0: y, y1: y };
          s.x0 = Math.min(s.x0, x); s.x1 = Math.max(s.x1, x);
          s.y0 = Math.min(s.y0, y); s.y1 = Math.max(s.y1, y);
          spans.set(part, s);
        }
      const travel: Record<string, number> = {};
      for (const [part, s] of spans) travel[part] = Math.max(s.x1 - s.x0, s.y1 - s.y0);
      out.push({ body: name, facing, cycle, frames: frames.length, step, extremes, travel });
    }
  return out;
}

/** The two poses of a named move, for the windup-against-strike measurement. */
export function poseDistance(model: Model, facing: Facing, a: string, b: string): number | null {
  if (!model.poses[facing]?.[a] || !model.poses[facing]?.[b]) return null;
  return silhouetteDistance(compose(model, facing, a), compose(model, facing, b));
}
