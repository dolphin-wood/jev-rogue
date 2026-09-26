import Phaser from "phaser";

/**
 * **Arcs and circles at the resolution they are seen at.**
 *
 * Phaser's WebGL renderer turns every `arc` into a hundred points whatever
 * its size or sweep — a two-pixel spark, a quarter-circle keycap corner and a
 * room-wide ring alike — allocates an object for each point every frame, and
 * a filled one then goes through earcut. The scene draws sixty-odd arcs a
 * frame (every `fillCircle`, `strokeCircle` and rounded rectangle is made of
 * them), which made the renderer the largest source of garbage in the game by
 * far and the collector's pauses the occasional hitch in a fight.
 *
 * Here an arc is emitted as line segments, as many as keep the polygon within
 * a third of a screen pixel of the true curve (never more than Phaser's own
 * hundred), and a filled circle as a fan of triangles, which the renderer
 * batches directly with no path and no triangulation. The command semantics
 * are Phaser's: a `lineTo` with no path open starts one, exactly as an `arc`
 * does, and the angle normalisation below is the renderer's own.
 */

const PI2 = Math.PI * 2;
/** The furthest the polygon may stray inside the true circle, in screen pixels. */
const CHORD_ERROR_PX = 0.35;
/** Phaser's own step is a hundredth of the arc, so this is never coarser-than-needed nor finer than before. */
const MAX_STEPS = 100;
const MIN_FULL_STEPS = 8;

type Gfx = Phaser.GameObjects.Graphics;

/** The most zoomed camera in a scene: the largest a thing in it can be drawn, before its own scale. */
export function maxZoom(scene: Phaser.Scene | undefined): number {
  let zoom = 1;
  const cams = scene?.cameras?.cameras;
  if (cams) for (const c of cams) if (c.zoom > zoom) zoom = c.zoom;
  return zoom;
}

/** The largest scale this graphics object is drawn at: its own scale times the most zoomed camera. */
function screenScale(g: Gfx): number {
  return maxZoom(g.scene) * Math.max(Math.abs(g.scaleX), Math.abs(g.scaleY), 1e-6);
}

/** Segments for a whole circle of this radius, drawn on this object. */
export function circleSteps(radiusPx: number): number {
  if (!(radiusPx > CHORD_ERROR_PX)) return MIN_FULL_STEPS;
  const n = Math.ceil(Math.PI / Math.acos(1 - CHORD_ERROR_PX / radiusPx));
  return Math.max(MIN_FULL_STEPS, Math.min(MAX_STEPS, n));
}

/** The renderer's normalisation of a sweep (`GraphicsWebGLRenderer`, `Commands.ARC`). */
function sweepOf(startAngle: number, endAngle: number, anticlockwise: boolean): number {
  let sweep = endAngle - startAngle;
  if (anticlockwise) {
    if (sweep < -PI2) sweep = -PI2;
    else if (sweep > 0) sweep = -PI2 + sweep % PI2;
  } else if (sweep > PI2) sweep = PI2;
  else if (sweep < 0) sweep = PI2 + sweep % PI2;
  return sweep;
}

let installed = false;

export function installCheapArcs(): void {
  if (installed) return;
  installed = true;
  const proto = Phaser.GameObjects.Graphics.prototype as Gfx;

  proto.arc = function (this: Gfx, x, y, radius, startAngle, endAngle, anticlockwise = false, overshoot = 0) {
    const sweep = sweepOf(startAngle, endAngle, anticlockwise);
    const full = circleSteps(Math.abs(radius) * screenScale(this));
    const steps = Math.max(1, Math.min(MAX_STEPS, Math.ceil(full * Math.abs(sweep) / PI2)));
    // The renderer walks t from 0 while t < 1 + overshoot, then lands on the end exactly.
    const last = Math.ceil(steps * (1 + overshoot)) - 1;
    for (let i = 0; i <= last; i++) {
      const a = startAngle + sweep * (i / steps);
      this.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    }
    const a = startAngle + sweep;
    this.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    return this;
  };

  const pathFill = proto.fillCircle;
  proto.fillCircle = function (this: Gfx, x, y, radius) {
    // The canvas renderer draws a true arc natively; only WebGL's hundred-point path is worth replacing.
    if (!this.scene?.sys.game || this.scene.sys.game.renderer.type !== Phaser.WEBGL) return pathFill.call(this, x, y, radius);
    const steps = circleSteps(Math.abs(radius) * screenScale(this));
    let px = x + radius, py = y;
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * PI2;
      const nx = x + Math.cos(a) * radius, ny = y + Math.sin(a) * radius;
      this.fillTriangle(x, y, px, py, nx, ny);
      px = nx; py = ny;
    }
    return this;
  };
}
