/**
 * What the reference player is allowed to know, and when.
 *
 * The model read the world directly, which made it a liar in the one direction
 * that matters: it dodged attacks on the frame they were declared and stepped
 * off bullets on the frame they spawned. A person cannot. So every number the
 * harness produced — the four pressure bands, the per-room heart costs, the
 * survival rate — described a difficulty nobody was playing at, and "the bands
 * are in band" coexisted with dying in the second room.
 *
 * The fix is not to make the model worse at deciding. It is to make it decide
 * from **the world as it was a reaction time ago**. A player's eyes and hands
 * are behind the simulation by a fixed lag; their *reasoning* is not impaired,
 * they simply cannot answer something they have not seen yet. Modelling that
 * as stale input rather than as added noise keeps the model deterministic,
 * which is what the replay and the seeded runs depend on.
 *
 * ### Why 230 ms
 *
 * Simple visual reaction time is about 200 to 250 ms, and the design documents
 * already size two telegraphs against a 250 ms floor: the lightning marker and
 * the locked portion of an enemy windup. Using the same figure here means the
 * harness measures the windows those numbers were chosen for, instead of
 * measuring what a frame-perfect machine can do with them.
 *
 * The player's own position and the room are **not** delayed. Proprioception
 * is not vision: a person always knows where they are standing and what the
 * walls are, and delaying those would model confusion rather than reaction.
 */
import type { Enemy, World } from "@jr/core";

/** A reaction time, in ms. See the note above. */
export const REACTION_MS = 230;

const STEP_MS = 1000 / 60;
const DEPTH = Math.max(1, Math.round(REACTION_MS / STEP_MS));

/** The parts of the world the model's cost function reads. */
interface Frame {
  readonly enemies: Enemy[];
  readonly enemyBullets: World["enemyBullets"];
  readonly fires: World["fires"];
}

/**
 * Per-world history. A `WeakMap` rather than a module-level array because the
 * harness plays many worlds and a leaked buffer would let one room's bullets
 * be perceived in the next.
 */
const history = new WeakMap<World, Frame[]>();

/**
 * Copies only the fields that are read.
 *
 * Deliberately a shallow, explicit copy rather than a deep clone: a clone
 * would be slow enough to matter across twenty-four runs, and an explicit list
 * fails loudly when the model starts reading something new — which is better
 * than silently perceiving one field live and the rest delayed.
 */
function snapshot(w: World): Frame {
  return {
    enemies: w.enemies.map((e) => ({
      ...e,
      swing: { ...e.swing, hitIds: e.swing.hitIds.slice() },
      strike: { ...e.strike },
      nudge: { ...e.nudge },
      affixes: e.affixes,
    })),
    enemyBullets: w.enemyBullets.filter((b) => b.alive).map((b) => ({ ...b, hitIds: [] })),
    fires: w.fires.filter((f) => f.alive).map((f) => ({ ...f })),
  };
}

/**
 * The world as the player can see it: their own body and the room now, and
 * everything that threatens them as it was a reaction time ago.
 *
 * Returns the live world unchanged until the history is deep enough, which is
 * the first few frames of a room — where there is nothing to react to anyway.
 */
export function perceive(w: World): World {
  let frames = history.get(w);
  if (!frames) {
    frames = [];
    history.set(w, frames);
  }
  frames.push(snapshot(w));
  if (frames.length > DEPTH + 1) frames.shift();
  const seen = frames.length > DEPTH ? frames[0]! : null;
  if (!seen) return w;

  /*
   * The enemies are matched back to the live list by id, and anything that has
   * since died is dropped. A remembered corpse is a different error from a
   * delayed sighting: the player would keep attacking a body that is not
   * there, which is not what reaction time does.
   */
  const alive = new Set(w.enemies.map((e) => e.id));
  return {
    ...w,
    enemies: seen.enemies.filter((e) => alive.has(e.id)),
    enemyBullets: seen.enemyBullets,
    fires: seen.fires,
  };
}
