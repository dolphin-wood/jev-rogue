/**
 * Sprite sheet plus the mood tint (design doc 008 and the asset spec).
 * Everything here is pixel arrays and frame rectangles, with no Phaser and no
 * DOM, so the pipeline is testable headless and Phaser only has to hand the
 * result to a texture.
 *
 * The art uses a hard-edged pixel look without an indexed palette, so mood is
 * an HSL shift with the enemy-bullet hue band excluded.
 */
import { moodTransform, tintRGBA } from "@jr/core";
import type { Mood, MoodTransform, TintReport } from "@jr/core";

export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface AtlasJson {
  readonly frames: Readonly<Record<string, FrameRect>>;
  readonly playerAnchors?: Readonly<Record<string, PlayerAnchor>>;
}

export interface PlayerAnchor {
  readonly grip: readonly [number, number];
  readonly offhand: readonly [number, number];
  readonly bladeAngleDeg: number;
}

export interface SheetSource {
  readonly width: number;
  readonly height: number;
  /** RGBA, row major, length width * height * 4. */
  readonly data: Uint8Array | Uint8ClampedArray;
}

export class RecolourableAtlas {
  /**
   * The sheet as delivered, before any mood transform.
   *
   * Readable because some things must not be recoloured by the room: a
   * dropped heart in a cold room came out purple, which reads as a different
   * item rather than the same item in bluer light. Rewards and HUD pieces are
   * promises and have to mean one thing everywhere.
   */
  readonly base: Uint8Array;

  private readonly atlas: AtlasJson;
  private readonly width: number;

  constructor(source: SheetSource, atlas: AtlasJson) {
    this.atlas = atlas;
    this.width = source.width;
    const expected = source.width * source.height * 4;
    if (source.data.length !== expected)
      throw new Error(`sheet is ${source.data.length} bytes, expected ${expected} for ${source.width}x${source.height}`);
    this.base = Uint8Array.from(source.data);
  }

  get sheetWidth(): number {
    return this.width;
  }

  get frameNames(): string[] {
    return Object.keys(this.atlas.frames);
  }

  /**
   * The vertical extent of a frame's opaque pixels, cached.
   *
   * Needed because two things that have to line up are both properties of the
   * **art**, not of the code: where a body's feet are, and where a shadow's
   * blob sits in its own frame. Measured across the delivered roster the foot
   * line ranges from 0.84 to 0.94 of the frame height, and `shadow_summoner`
   * is not centred in its frame at all — so any constant is wrong for
   * somebody, and a constant chosen from today's sheet goes stale on the next
   * delivery without failing.
   *
   * Asking the pixels costs one pass per frame, once.
   */
  contentTop(name: string): number {
    return this.bounds(name).top;
  }

  contentBottom(name: string): number {
    return this.bounds(name).bottom;
  }

  /** The width of a frame's opaque pixels, in art px. */
  contentWidth(name: string): number {
    const b = this.bounds(name);
    return b.right - b.left + 1;
  }

  private readonly boundsCache =
    new Map<string, { top: number; bottom: number; left: number; right: number }>();

  private bounds(name: string): { top: number; bottom: number; left: number; right: number } {
    const hit = this.boundsCache.get(name);
    if (hit) return hit;
    const r = this.frame(name);
    let top = r.h;
    let bottom = -1;
    let left = r.w;
    let right = -1;
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        if (this.base[(((r.y + y) * this.sheetWidth + (r.x + x)) << 2) + 3]! < 16) continue;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    // An empty frame reports the whole frame, so callers never divide by -1.
    const out = bottom < 0
      ? { top: 0, bottom: r.h - 1, left: 0, right: r.w - 1 }
      : { top, bottom, left, right };
    this.boundsCache.set(name, out);
    return out;
  }

  frame(name: string): FrameRect {
    const r = this.atlas.frames[name];
    if (!r) throw new Error(`no frame named "${name}" in the sheet`);
    return r;
  }

  has(name: string): boolean {
    return name in this.atlas.frames;
  }

  playerAnchor(name: string): PlayerAnchor | undefined {
    return this.atlas.playerAnchors?.[name];
  }

  /** A fresh tinted copy; the original is never mutated, so moods are independent. */
  forMood(mood: Mood): { data: Uint8Array; transform: MoodTransform; report: TintReport } {
    const transform = moodTransform(mood);
    const data = Uint8Array.from(this.base);
    const report = tintRGBA(data, transform);
    return { data, transform, report };
  }

  /** Frames whose names start with a prefix, for animation sets. */
  sequence(prefix: string): string[] {
    return this.frameNames.filter((n) => n.startsWith(prefix)).sort();
  }
}

/** Picks the facing frame for a direction, mirroring east from west. */
export function facingFrame(base: string, angleDeg: number, frame: string | number): { name: string; flipX: boolean } {
  const a = ((angleDeg % 360) + 360) % 360;
  if (a >= 45 && a < 135) return { name: `${base}_s_${frame}`, flipX: false };
  if (a >= 135 && a < 225) return { name: `${base}_w_${frame}`, flipX: false };
  if (a >= 225 && a < 315) return { name: `${base}_n_${frame}`, flipX: false };
  return { name: `${base}_w_${frame}`, flipX: true };
}
