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
  readonly bossAnchors?: Readonly<Record<string, BossAnchor>>;
  /**
   * Where a subspecies' mark hangs on each frame of its base body (doc 019),
   * in art pixels from that frame's top-left.
   *
   * Per frame rather than per body, because the point rides the pose: a horn
   * is somewhere else on a windup than on an idle, and a mark pinned to the
   * body's centre would slide about on its head as the body moved. The rig
   * declares it once (`models.ts`, `rig.marks`) and the pipeline resolves it
   * for every frame it delivers.
   */
  readonly markAnchors?: Readonly<Record<string, readonly [number, number]>>;
}

export interface PlayerAnchor {
  readonly grip: readonly [number, number];
  readonly offhand: readonly [number, number];
  readonly bladeAngleDeg: number;
  /** The sword fist's centre, from a sprite model's joint (doc 016). */
  readonly hand?: readonly [number, number];
  /**
   * The staff, which **no player frame draws** any more: one sprite the
   * renderer places in every state, from the model's own `staff.up`.
   *
   * `staffAngleDeg` is the way this frame holds it, so the idle keeps the
   * look the drawing had; `staffGripPx` is how far the crystal is from the
   * fist along the shaft in art pixels, which the back view grips higher up
   * than the other two; `staffDepth` is positive to paint it over the body
   * and negative to paint it behind. All three come from the model
   * (`anims.json`), so they are data rather than a table in the renderer.
   */
  readonly staffAngleDeg?: number;
  readonly staffGripPx?: number;
  readonly staffDepth?: number;
  /**
   * The crystal, on `weapon_player_staff` only: the staff **sprite's** own
   * joint, which says how far its grip — the frame's centre — is from its
   * head. No body frame carries one, because no body frame draws a staff.
   */
  readonly crystal?: readonly [number, number];
}

export interface BossAnchor {
  readonly grip?: readonly [number, number];
  readonly chain?: readonly [number, number];
  /** Where the feet meet the floor, art px of the frame: the wide cuts' 336 px cells are laid on this. */
  readonly pivot?: readonly [number, number];
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

  /**
   * Where a frame's **body** stands across it, art px from its left: the
   * middle of its armour, leaving out the cape (violet) and the blade
   * (unsaturated light steel), cached.
   *
   * For the Crypt King, whose action frames were drawn with the body in a
   * different place across each frame — the crown at 175 on one key and 73
   * on the next — so a cut snapped the whole body sideways, and mirroring a
   * cut for the other direction doubled it. Held to this, the body stays
   * where he stands and only the sword and the cape move (`drawEnemy`).
   */
  bodyCentreX(name: string): number {
    return this.body(name).x;
  }

  /**
   * How much armour a frame shows, in art px²: the same measure, counted.
   * Across one body's frames it is nearly the same whatever the pose, which
   * makes it the size of the drawing — the king's cuts were delivered drawn
   * smaller than his idle, some by a third (`bossFrameScale` in play.ts).
   */
  bodyArea(name: string): number {
    return this.body(name).n;
  }

  private body(name: string): { x: number; n: number } {
    const hit = this.bodyCache.get(name);
    if (hit !== undefined) return hit;
    const r = this.frame(name);
    let sum = 0;
    let n = 0;
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const i = ((r.y + y) * this.sheetWidth + (r.x + x)) << 2;
        if (this.base[i + 3]! < 16) continue;
        const R = this.base[i]!, G = this.base[i + 1]!, B = this.base[i + 2]!;
        if (B > R + 15 && B > G + 25) continue;
        const hi = Math.max(R, G, B), lo = Math.min(R, G, B);
        if (hi - lo < 28 && hi > 120) continue;
        sum += x;
        n++;
      }
    const out = { x: n > 0 ? sum / n : r.w / 2, n };
    this.bodyCache.set(name, out);
    return out;
  }

  private readonly bodyCache = new Map<string, { x: number; n: number }>();

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

  bossAnchor(name: string): BossAnchor | undefined {
    return this.atlas.bossAnchors?.[name];
  }

  /**
   * Where this frame carries a subspecies' mark, in art px from its top-left,
   * or `undefined` for a frame whose pose hides the part it hangs from.
   */
  markAnchor(name: string): readonly [number, number] | undefined {
    return this.atlas.markAnchors?.[name];
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
