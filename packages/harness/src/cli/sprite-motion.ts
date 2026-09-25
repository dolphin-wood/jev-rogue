/**
 * Writes a sprite model's poses and its atlas frames from the roster's shared
 * motion table (doc 016).
 *
 * The split gives a body its drawings and one pose per drawing. This turns
 * those into the set the game animates in — a breathing idle, a gait, an
 * attack with anticipation and follow-through, a recoil, a sleep that
 * breathes, a stir — using `motion.ts`, so every body in the roster moves on
 * the same conventions and only its weight and its parts differ.
 *
 * Reads `assets/models/<body>/motion.json` (a `MotionSpec` plus the atlas
 * base name and any extra frames the body delivers), rewrites the generated
 * poses in `poses.json` and the generated frames in `anims.json`, and leaves
 * every pose it did not generate — the split's keys, anything drawn by hand —
 * exactly as it found it.
 *
 * Run: `pnpm sprite:motion <body>`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MODELS_DIR, type Facing, type Pose } from "../assets/models.ts";
import { motionFrames, motionPoses, type MotionSpec } from "../assets/motion.ts";
import { parsePx } from "../assets/px.ts";

interface MotionFile extends MotionSpec {
  /** The atlas name this body's frames start with, e.g. `enemy_rusher`. */
  readonly base: string;
  readonly facings: readonly Facing[];
  /** Atlas frame suffix → pose, for a frame the shared set does not cover. */
  readonly extra?: Readonly<Record<string, string>>;
  /** True for a body drawn once rather than per facing, whose frames carry no direction. */
  readonly flatNames?: boolean;
  /**
   * The shared set's frames this body actually delivers, when it does not
   * want all of them. The boss is drawn at 256 px and has no gait and no
   * sleep: giving it the whole set would be fifty frames of atlas for poses
   * nothing ever asks for.
   */
  readonly deliver?: readonly string[];
  /** Frames the model delivers under a name with no facing in it. */
  readonly flat?: Readonly<Record<string, string>>;
  /**
   * Poses the shared set does not cover, merged into every facing: a body's
   * own moves — a telegraph lighting up, a lob, a plant. Written here rather
   * than by hand in `poses.json` so that a rerun keeps them.
   */
  readonly poses?: Readonly<Record<string, Pose>>;
}

const body = process.argv[2];
if (!body) throw new Error("usage: sprite-motion <body>");
const dir = join(MODELS_DIR.pathname, body);
const spec = JSON.parse(readFileSync(join(dir, "motion.json"), "utf8")) as MotionFile;

const poses = JSON.parse(readFileSync(join(dir, "poses.json"), "utf8")) as Record<Facing, Record<string, Pose>>;
let written = 0;
for (const facing of spec.facings) {
  const px = parsePx(readFileSync(join(dir, `${facing}.px`), "utf8"));
  const drawn = new Set(px.parts.map((p) => `${p.part}.${p.variant}`));
  const made = { ...motionPoses(spec, facing, (part, variant) => drawn.has(`${part}.${variant}`)), ...(spec.poses ?? {}) };
  poses[facing] = { ...(poses[facing] ?? {}), ...made };
  written += Object.keys(made).length;
}
writeFileSync(join(dir, "poses.json"), JSON.stringify(poses, null, 2) + "\n");

const anims = {
  facings: spec.facings,
  frames: {
    ...Object.fromEntries(Object.entries(motionFrames(spec.base, spec, spec.flatNames))
      .filter(([name]) => !spec.deliver || spec.deliver.some((s) => name.endsWith(`_${s}`)))),
    ...Object.fromEntries(Object.entries(spec.extra ?? {}).map(([suffix, pose]) => [spec.flatNames ? `${spec.base}_${suffix}` : `${spec.base}_{f}_${suffix}`, pose])),
    ...Object.fromEntries(Object.entries(spec.flat ?? {}).map(([suffix, pose]) => [`${spec.base}_${suffix}`, pose])),
  },
};
writeFileSync(join(dir, "anims.json"), JSON.stringify(anims, null, 2) + "\n");
console.log(`${body}: ${written} poses over ${spec.facings.length} facings, ${Object.keys(anims.frames).length} frame templates`);
