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
 * ### Why 230 ms, and why it is now a parameter
 *
 * Simple visual reaction time is about 200 to 250 ms, and the design documents
 * already size two telegraphs against a 250 ms floor: the lightning marker and
 * the locked portion of an enemy windup. Using the same figure means the
 * harness measures the windows those numbers were chosen for, instead of
 * measuring what a frame-perfect machine can do with them. That figure is the
 * `expert` profile's; `novice` and `average` sit above it, because recognising
 * what a telegraph *means* is part of the delay for anyone still learning them
 * (`skill.ts`).
 *
 * ### The blind spot
 *
 * Reaction time alone still models a player with eyes in the back of their
 * head. A second, deeper delay applies to threats **behind the player or off
 * the screen**: those are noticed late, or — if they were not yet fired when
 * the player last could have looked — not at all. This is where a novice's
 * ranged damage comes from, and it is the one thing a uniform lag cannot
 * produce.
 *
 * The player's own position and the room are **not** delayed. Proprioception
 * is not vision: a person always knows where they are standing and what the
 * walls are, and delaying those would model confusion rather than reaction.
 */
import type { Enemy, World } from "@jr/core";
import type { SkillProfile } from "./skill.ts";

/** The `expert` profile's reaction time, kept exported for documentation and tests. */
export const REACTION_MS = 230;

const STEP_MS = 1000 / 60;

/** A perceived bullet keeps its pool index, so the same bullet can be matched across frames. */
type SeenBullet = World["enemyBullets"][number] & { readonly slot: number };

/** The parts of the world the model's cost function reads. */
interface Frame {
  readonly enemies: Enemy[];
  readonly bullets: SeenBullet[];
  readonly fires: World["fires"];
  /** Where the player was standing, so "behind me" means behind them at the time. */
  readonly px: number;
  readonly py: number;
  readonly facing: number;
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
  const bullets: SeenBullet[] = [];
  for (let i = 0; i < w.enemyBullets.length; i++) {
    const b = w.enemyBullets[i]!;
    if (b.alive) bullets.push({ ...b, hitIds: [], slot: i });
  }
  return {
    enemies: w.enemies.map((e) => ({
      ...e,
      swing: { ...e.swing, hitIds: e.swing.hitIds.slice() },
      strike: { ...e.strike },
      nudge: { ...e.nudge },
      affixes: e.affixes,
    })),
    bullets,
    fires: w.fires.filter((f) => f.alive).map((f) => ({ ...f })),
    px: w.player.x, py: w.player.y, facing: w.player.facing,
  };
}

/**
 * Whether a threat at `x, y` was outside the player's attention at that moment:
 * behind them, or off the screen. Both are the same failure — it was not where
 * they were looking — so they are priced with the same deeper delay.
 */
function outOfSight(f: Frame, w: World, x: number, y: number): boolean {
  if (Math.abs(x - f.px) > w.viewHalf.x || Math.abs(y - f.py) > w.viewHalf.y) return true;
  const dx = x - f.px;
  const dy = y - f.py;
  const d = Math.hypot(dx, dy) || 1;
  // Behind: more than 90 degrees off the way the player is facing. Facing comes
  // from movement in this game, so this is literally "coming at my back".
  return (dx / d) * Math.cos(f.facing) + (dy / d) * Math.sin(f.facing) < 0;
}

/**
 * The world as the player can see it: their own body and the room now, and
 * everything that threatens them as it was a reaction time ago — or, for what
 * was behind them, a reaction time plus a blind-spot delay ago.
 *
 * Returns the live world unchanged until the history is deep enough, which is
 * the first few frames of a room — where there is nothing to react to anyway.
 */
export function perceive(w: World, profile: SkillProfile): World {
  let frames = history.get(w);
  if (!frames) {
    frames = [];
    history.set(w, frames);
  }
  frames.push(snapshot(w));
  const near = Math.max(1, Math.round(profile.reactionMs / STEP_MS));
  const far = near + Math.round(profile.blindSpotMs / STEP_MS);
  if (frames.length > far + 1) frames.shift();
  // Index from the end: the last entry is this frame.
  const at = (depth: number): Frame | null =>
    frames!.length > depth ? frames![frames!.length - 1 - depth]! : null;
  const seen = at(near);
  if (!seen) return w;
  const late = at(far);

  /*
   * The enemies are matched back to the live list by id, and anything that has
   * since died is dropped. A remembered corpse is a different error from a
   * delayed sighting: the player would keep attacking a body that is not
   * there, which is not what reaction time does.
   */
  const alive = new Set(w.enemies.map((e) => e.id));
  const enemies = seen.enemies.filter((e) => alive.has(e.id));

  /*
   * Bullets, one delay each. A bullet that was in front of the player is seen
   * at the reaction time; one that was behind them or off the screen is seen as
   * it was at the deeper delay, and if it did not exist that long ago it is not
   * seen at all yet. Matching is by pool slot, which is stable for a live
   * bullet and is why the snapshot keeps it.
   */
  let bullets: World["enemyBullets"];
  if (profile.blindSpotMs <= 0) {
    bullets = seen.bullets;
  } else {
    const older = new Map<number, SeenBullet>();
    if (late) for (const b of late.bullets) older.set(b.slot, b);
    const out: SeenBullet[] = [];
    for (const b of seen.bullets) {
      if (!outOfSight(seen, w, b.x, b.y)) { out.push(b); continue; }
      const was = older.get(b.slot);
      if (was) out.push(was);
    }
    bullets = out;
  }

  return { ...w, enemies, enemyBullets: bullets, fires: seen.fires };
}
