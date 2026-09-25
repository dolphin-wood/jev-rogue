/**
 * Shape fill: new part variants drawn from a few strokes, in a model's
 * palette, lit from the top left in flat bands (doc 016).
 *
 * A stroke is a capsule (a limb, a staff's shaft) or a disc (a fist, a
 * crystal). Each pixel it covers takes a shade of its material by where it
 * falls across the stroke and which way that side faces: the edge away from
 * the light darkest, the edge toward it lightest, the middle between. The
 * result is a drawing in the `.px` format, which is then touched up by hand
 * like any other part; the strokes are how it was started, not what it is.
 */
import type { PxPart, Shade } from "./px.ts";

type Pt = readonly [number, number];

/** Shades of the stroke's material, darkest to lightest: shadow edge, shadow, body, light, lit edge. */
export interface Bands {
  readonly material: string;
  readonly shadowEdge: number;
  readonly shadow: number;
  readonly body: number;
  readonly light: number;
  readonly litEdge: number;
}

export type Stroke =
  | { readonly kind: "capsule"; readonly from: Pt; readonly to: Pt; readonly width: readonly [number, number]; readonly bands: Bands }
  | { readonly kind: "disc"; readonly at: Pt; readonly r: number; readonly bands: Bands };

/** The light comes from the top left. */
const LIGHT: Pt = [-0.6, -0.8];

function shadeFor(b: Bands, side: number, facing: number): number {
  // `side` is -1..1 across the stroke; `facing` is how much that side of the
  // stroke faces the light, -1..1.
  const lit = side * facing;
  if (Math.abs(side) > 0.72) return lit > 0 ? b.litEdge : b.shadowEdge;
  if (lit > 0.25) return b.light;
  if (lit < -0.25) return b.shadow;
  return b.body;
}

/** Paints strokes, later over earlier, into a frame-sized map. */
export function paint(strokes: readonly Stroke[], w: number, h: number): (Shade | null)[] {
  const px: (Shade | null)[] = new Array(w * h).fill(null);
  const put = (x: number, y: number, s: Shade) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    px[y * w + x] = s;
  };
  for (const st of strokes) {
    if (st.kind === "disc") {
      const [cx, cy] = st.at;
      for (let y = Math.floor(cy - st.r); y <= Math.ceil(cy + st.r); y++)
        for (let x = Math.floor(cx - st.r); x <= Math.ceil(cx + st.r); x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          const d = Math.hypot(dx, dy);
          if (d > st.r) continue;
          const facing = d > 0 ? (dx * LIGHT[0] + dy * LIGHT[1]) / d : 0;
          put(x, y, { material: st.bands.material, shade: shadeFor(st.bands, d / st.r, facing) });
        }
      continue;
    }
    const [x0, y0] = st.from, [x1, y1] = st.to;
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    const nx = -uy, ny = ux;
    // Which way the stroke's positive side faces the light.
    const facing = nx * LIGHT[0] + ny * LIGHT[1];
    const pad = Math.max(st.width[0], st.width[1]) / 2 + 1;
    const xs = [x0, x1].sort((a, b) => a - b), ys = [y0, y1].sort((a, b) => a - b);
    for (let y = Math.floor(ys[0]! - pad); y <= Math.ceil(ys[1]! + pad); y++)
      for (let x = Math.floor(xs[0]! - pad); x <= Math.ceil(xs[1]! + pad); x++) {
        const px_ = x + 0.5 - x0, py_ = y + 0.5 - y0;
        const along = Math.max(0, Math.min(len, px_ * ux + py_ * uy));
        const across = px_ * nx + py_ * ny;
        const t = along / len;
        const half = (st.width[0] + (st.width[1] - st.width[0]) * t) / 2;
        // The rounded ends: distance to the nearest point on the axis.
        const ax = x0 + ux * along, ay = y0 + uy * along;
        const d = Math.hypot(x + 0.5 - ax, y + 0.5 - ay);
        if (d > half) continue;
        put(x, y, { material: st.bands.material, shade: shadeFor(st.bands, across / Math.max(0.5, half), facing) });
      }
  }
  return px;
}

/** Crops a painted map to its drawing and makes it a part, pivot and joints given in frame pixels. */
export function toPart(
  px: readonly (Shade | null)[], w: number, h: number,
  part: string, variant: string, pivot: Pt, joints: Readonly<Record<string, Pt>> = {},
): PxPart {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  px.forEach((s, k) => {
    if (!s) return;
    const x = k % w, y = (k / w) | 0;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  });
  if (x1 < 0) throw new Error(`${part}.${variant}: nothing painted`);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out: (Shade | null)[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(px[y * w + x]!);
  const rel: Record<string, [number, number]> = {};
  for (const [n, [jx, jy]] of Object.entries(joints)) rel[n] = [Math.round(jx - x0), Math.round(jy - y0)];
  return { part, variant, pivot: [Math.round(pivot[0] - x0), Math.round(pivot[1] - y0)], joints: rel, w: cw, h: ch, px: out };
}
