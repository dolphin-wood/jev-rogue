/**
 * **How a subspecies is drawn** (doc 019): its base's frames, in a shifted
 * palette, with one small mark hung off the body.
 *
 * ## Why a shader and not baked frames
 *
 * Three ways to give thirteen bodies their own colour, measured against each
 * other rather than argued about:
 *
 * | | atlas | texture memory | per room | batches |
 * |---|---|---|---|---|
 * | a model each | **+58%** (~980 frames) | +6 MB | — | none |
 * | bake per subspecies at room start | none | +1.5 MB a body | recolour ~90 frames **per mood** | one per kind |
 * | swap on the GPU | none | none | build a 32-entry table | one per kind |
 *
 * The first is what doc 019 rejected on measurement. The second looks cheap
 * until the moods are counted: the sheet the GPU sees has already been
 * recoloured for the room (`applyMood` bakes one canvas texture per mood and
 * keeps it), so a baked variant is a second copy **per mood**, rebuilt at
 * every door, and the CPU cost lands exactly on the frame where a room is
 * loading.
 *
 * The third costs a uniform upload. Both of the others break batching in the
 * same way — a different texture and a different pipeline each cost one draw
 * call — so the shader is strictly cheaper, and a room holds at most two
 * subspecies kinds by design (doc 005's readability rule), which is the cap on
 * how many extra batches this can ever be.
 *
 * **What the shader cannot do is be the whole answer.** `Phaser.AUTO` may give
 * a canvas renderer, where there is no pipeline at all; and a hue shift is the
 * half of the difference that survives least at 1x, in a busy room, on a body
 * the size of a thumbnail. So the mark is not decoration on top of the swap —
 * it is the half that carries the read, and it is drawn from the atlas by the
 * renderer whether or not the swap ran (`markFrame`).
 *
 * ## Why the table is built per room, and lazily
 *
 * The swap matches **exact colours**, which doc 016 makes possible: every
 * pixel of a composed frame is a shade of that body's palette. But the sheet
 * has been through the room's mood transform by the time it is sampled, so
 * the colours to match are the *tinted* ones. Both ends of every pair get the
 * same transform, which keeps the swap exact and costs 32 conversions a body.
 *
 * A table built for another room's light would swap colours that are not in
 * the sheet, which shows up as a body that is simply not recoloured — the
 * quietest possible failure — so the mood a table was built in is kept beside
 * it and checked on every use rather than trusted to call order. And the work
 * is done on the first body of that kind that is actually drawn, not for all
 * thirteen at the first door: a pipeline is a compiled program, and the roster
 * only ever puts two kinds in a room.
 *
 * ## What it deliberately does not touch
 *
 * `setTint`. Four transient states already own it — the hit flash, freeze,
 * slow, and the elite's warm cast — and a subspecies is a permanent fact
 * about a body rather than a state it is in. Keeping them in different
 * channels is what lets an elite pinner read as both at once, and it is why
 * the fragment source below is **Phaser's own single-texture shader with the
 * lookup spliced in front of it**, tint effect and all: an earlier draft wrote
 * its own tint line, dropped `outTintEffect`, and took the white hit flash off
 * every subspecies in the game — the one piece of feedback a player needs
 * most, missing exactly on the bodies this module exists to mark out.
 */
import Phaser from "phaser";
import { moodTransform, tintRGBA } from "@jr/core";
import type { Mood } from "@jr/core";
import { LUT_MAX, parseHex, type Rgb } from "./palette-swap.ts";

/** One subspecies' swap, as `sprites.json` ships it. */
export interface SubspeciesSwap {
  readonly id: string;
  readonly base: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
}

/**
 * The atlas frame of a subspecies' mark, for a facing (doc 019). The sheet
 * carries one per facing: a back view hides what a front view shows.
 */
export const markFrame = (id: string, facing: "s" | "n" | "w"): string => `mark_${id}_${facing}`;

/*
 * Phaser's `Single-frag`, with the palette lookup applied to the sampled texel
 * before any of the tint arithmetic. Everything below the lookup is Phaser's
 * own, down to `outTint.bgr` — the tint arrives packed blue-first — so tint,
 * tint-fill and alpha behave on a swapped body exactly as on a plain one.
 */
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uMainSampler;
uniform vec3 uFrom[${LUT_MAX}];
uniform vec3 uTo[${LUT_MAX}];
uniform int uCount;
varying vec2 outTexCoord;
varying float outTintEffect;
varying vec4 outTint;
void main ()
{
    vec4 texture = texture2D(uMainSampler, outTexCoord);
    if (texture.a > 0.0)
    {
        for (int i = 0; i < ${LUT_MAX}; i++)
        {
            if (i >= uCount) break;
            if (all(lessThan(abs(texture.rgb - uFrom[i]), vec3(0.004)))) { texture.rgb = uTo[i]; break; }
        }
    }
    vec4 texel = vec4(outTint.bgr * outTint.a, outTint.a);
    vec4 color = texture * texel;
    if (outTintEffect == 1.0)
    {
        color.rgb = mix(texture.rgb, outTint.bgr * outTint.a, texture.a);
    }
    else if (outTintEffect == 2.0)
    {
        color = texel;
    }
    gl_FragColor = color;
}
`;

class SwapPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  constructor(game: Phaser.Game) {
    super({ game, fragShader: FRAG });
  }

  /** Uploads one subspecies' table. Called when the room's mood is known. */
  setTable(from: Float32Array, to: Float32Array, count: number): void {
    this.set3fv("uFrom", from);
    this.set3fv("uTo", to);
    this.set1i("uCount", count);
  }
}

/** A pipeline and the mood its table was built in. */
interface Built {
  readonly pipeline: SwapPipeline;
  mood: string;
}

/**
 * The palette swaps a room needs, built on demand and kept for the run.
 *
 * A pipeline is reused across rooms — compiling one is the expensive part —
 * and only its table is rebuilt, when the light it was made for is no longer
 * the light the sheet is in.
 */
export class SubspeciesVisuals {
  private readonly built = new Map<string, Built>();
  private readonly swaps: ReadonlyMap<string, SubspeciesSwap>;
  private readonly webgl: boolean;
  private mood: Mood | null = null;

  constructor(private readonly game: Phaser.Game, swaps: readonly SubspeciesSwap[]) {
    this.swaps = new Map(swaps.map((s) => [s.id, s]));
    this.webgl = game.renderer.type === Phaser.WEBGL;
  }

  /** The light the sheet is now in. Nothing is uploaded until a body is drawn. */
  retint(mood: Mood): void {
    this.mood = mood;
  }

  /** Whether this id has a palette swap at all — the lancer has its own model. */
  knows(id: string): boolean {
    return this.swaps.has(id);
  }

  /**
   * Draws `img` as this subspecies, if it is one.
   *
   * Returns whether the swap was applied, so the caller knows what the body is
   * carrying — on a canvas renderer there is no shader and the mark alone
   * carries the difference. That is a real degradation and it is the right
   * one: a silhouette reads at 1x where a hue does not, so the half that
   * survives is the half that matters.
   */
  apply(img: Phaser.GameObjects.Image, id: string): boolean {
    const pipeline = this.pipelineFor(id);
    if (!pipeline) return false;
    img.setPipeline(pipeline);
    return true;
  }

  private pipelineFor(id: string): SwapPipeline | null {
    const swap = this.swaps.get(id);
    if (!this.webgl || !swap || !this.mood) return null;
    const key = `${this.mood.temperature}_${this.mood.brightness}`;
    let built = this.built.get(id);
    if (!built) {
      const manager = (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).pipelines;
      const name = `subspecies_${id}`;
      const pipeline = (manager.get(name) as SwapPipeline | undefined)
        ?? (manager.add(name, new SwapPipeline(this.game)) as SwapPipeline);
      built = { pipeline, mood: "" };
      this.built.set(id, built);
    }
    if (built.mood !== key) {
      const t = moodTransform(this.mood);
      const from = new Float32Array(LUT_MAX * 3);
      const to = new Float32Array(LUT_MAX * 3);
      const n = Math.min(LUT_MAX, swap.from.length, swap.to.length);
      for (let i = 0; i < n; i++) {
        const a = tinted(parseHex(swap.from[i]!), t);
        const b = tinted(parseHex(swap.to[i]!), t);
        for (let k = 0; k < 3; k++) {
          from[i * 3 + k] = a[k]! / 255;
          to[i * 3 + k] = b[k]! / 255;
        }
      }
      built.pipeline.setTable(from, to, n);
      built.mood = key;
    }
    return built.pipeline;
  }
}

/** One colour through the room's light. `tintRGBA` works in place. */
function tinted(c: Rgb, t: ReturnType<typeof moodTransform>): Rgb {
  const px = new Uint8Array([c[0], c[1], c[2], 255]);
  tintRGBA(px, t);
  return [px[0]!, px[1]!, px[2]!];
}
