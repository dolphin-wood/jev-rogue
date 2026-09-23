/**
 * Which drawn frame an enemy is on.
 *
 * Pure, and in its own module so it can be tested: this logic produced a bug
 * that was both silent and catastrophic, and the only durable fix is a test
 * that enumerates every name it can emit against the sheet.
 *
 * **The bug is worth stating, because the shape of it recurs.** Phaser answers
 * a request for a missing frame name with the texture's *first* frame rather
 * than with null or nothing. The first frame in this sheet is `boss_p1_idle0`,
 * a 256 px boss. So one wrong name does not draw a blank — it draws a boss
 * four times the size of the body it replaced, in the middle of a fight.
 *
 * Two separate mistakes both produced exactly that:
 *
 * - The existence test was `textures.getFrame(key, name) !== null`, which is
 *   never null for the same reason: it returns the fallback. So every check
 *   passed and the turret, which has no directional frames at all, fell into
 *   the directional branch and asked for `enemy_turret_s_idle0`.
 * - The guard checked one name and the builder could pick another. Asking
 *   whether `${base}_s_hit0` exists says nothing about `${base}_n_hit0`, so an
 *   enemy that turned while being hit could still ask for a name that was
 *   never drawn.
 *
 * So existence is asked of the atlas JSON, and a pose is only admitted when
 * **every** name it could resolve to exists.
 */

/** Poses in the order they take priority; the first one drawn wins. */
export type EnemyPose = string;

/**
 * How far a body walks per frame of its cycle, from its own size.
 *
 * Distance-driven rather than clock-driven, which is the right idea and was
 * taken one step too far: the stride was a flat 22 px, borrowed from the
 * player, on the reasoning that one yardstick makes weight fall out of the
 * speeds already in the roster. It does — but the player moves at 240 px/s and
 * the roster was later cut to between 34 and 92, so the same stride produced
 * **1.3 to 4 frames a second**. Four drawn walk frames became a slideshow, and
 * the bodies looked like they had two.
 *
 * A creature's stride is proportional to its size, not to the protagonist's,
 * so it comes from the radius with a floor. A rusher then runs its cycle at
 * about 11 fps and a tank plods at 2 to 3, which is the weight distinction the
 * flat yardstick was supposed to give and did not survive a retune.
 */
export function strideFor(radius: number, speed = Infinity): number {
  return Math.min(Math.max(7, radius * 0.8), speed / MIN_WALK_FPS);
}

/**
 * The slowest a walk cycle may run before it stops reading as walking.
 *
 * A stride taken from the body's size is the right idea and it has one failure
 * mode: a body slow enough that a size-proportional stride takes a third of a
 * second to cross. The tank, at 34 px/s with an 11 px stride, ran its four
 * frames at **3 fps** — which is not a plod, it is stop motion, and it is most
 * of why the roster was reported as hard to read while moving. The summoner
 * was at 5.7.
 *
 * Note what this is *not*: adding drawn frames cannot fix it. The frame rate is
 * `speed / stride` and has nothing to do with how many frames the cycle has —
 * six frames at an 11 px stride is still 3 fps, just a longer loop. The only
 * levers are the speed, which is balance, and the stride, which is this.
 *
 * 8 is the low end of where a cycle reads as continuous motion rather than as
 * a sequence of stills. Above it the size-proportional stride still wins, so a
 * rusher at 11.5 fps and a shooter at 8.1 keep the weights they had; below it
 * the slow bodies take shorter steps, which is also what a heavy thing that is
 * barely moving actually does.
 */
const MIN_WALK_FPS = 8;

/** Ticks per idle frame: about 0.8 s for the pair, at 60 Hz. */
const IDLE_FRAME_TICKS = 24;

/**
 * Speed above which a body is walking rather than standing, in px/s.
 *
 * Low, because it is measured against smoothed velocity and the roster's slow
 * bodies barely clear it: a tank holding the waiting ring moves at about 44
 * px/s, and at a threshold of 20 the gate was being missed often enough that
 * the walk cycles — four frames per archetype, freshly wired — were reverting
 * to the two idle frames and the enemies looked like they had two frames
 * again.
 */
const WALKING_PX_PER_S = 10;

/** Enough of an enemy to choose a frame for it. */
export interface FramedEnemy {
  readonly awake: boolean;
  /** Counts down while a charge is skidding to a halt. See `enemyPose`. */
  readonly brakeMs: number;
  /**
   * Whether this body's attack ends braced rather than springing back — true
   * for a ram, false for a jab. It decides which pose the recovery holds.
   */
  readonly recoversBraced: boolean;
  /** Body radius, which sets the stride length. See `strideFor`. */
  readonly radius: number;
  /** Top speed in px/s, which floors the stride so slow bodies still animate. */
  readonly speed: number;
  /**
   * Whether the player is close enough for this body to look roused, even
   * though it has not noticed them. It is what separates the slumped `dormant`
   * drawing from the standing `idle` pair; see `enemyPose`.
   */
  readonly roused: boolean;
  readonly attack: string;
  /**
   * Whether this body is an emplacement: it never moves, so it cannot show
   * that it has noticed the player by moving. See `enemyPose`.
   */
  readonly stationary: boolean;
  readonly hitFlashMs: number;
  readonly telegraphMs: number;
  readonly vx: number;
  readonly vy: number;
  readonly travelled: number;
  readonly facing: number;
  /**
   * A drawn move that is not a melee phase — a warden's plant, a ringer's
   * bell, a delver coming up — as the pose's name. A name that ends in a
   * digit pair (`burrow` → `burrow0`/`burrow1`) alternates on the idle clock.
   * Null for none. See `specialPose` in the scene.
   */
  readonly special?: string | null;
}

/**
 * Whether a pose can be drawn at all, for every facing it might be drawn at.
 *
 * A body with no facings needs only `${base}_${pose}`; a body with facings
 * needs all three drawn directions, because the east facing is the west
 * drawing mirrored. Partial coverage is treated as absent rather than as
 * usable, since the alternative is discovering the gap as a boss.
 */
function poseReady(base: string, pose: string, has: (n: string) => boolean): boolean {
  if (has(`${base}_${pose}`)) return true;
  return has(`${base}_s_${pose}`) && has(`${base}_n_${pose}`) && has(`${base}_w_${pose}`);
}

/**
 * The pose an enemy should be drawn in.
 *
 * Order is by what the player most needs to read: the tell before the commit,
 * the commit before the recoil, and the recoil before the gait. Every pose
 * named here exists in the sheet, and most were being faked before — the walk
 * was two idle frames on a timer, the windup and the lunge were the idle frame
 * scaled, and the dormant pose was the idle frame dimmed. Scale tricks over an
 * idle pose are what made the bodies read as cardboard, and also why a hit
 * landing mid-attack was easy to miss: there was no pose change underneath the
 * flash to notice.
 */
export function enemyPose(
  e: FramedEnemy, tick: number, has: (n: string) => boolean, base: string,
): EnemyPose {
  const ready = (pose: string): boolean => poseReady(base, pose, has);

  /*
   * A special move first: it is the one thing the body is doing, and the
   * reason it is standing still.
   */
  if (e.special) {
    const pair = ready(`${e.special}0`) && ready(`${e.special}1`);
    if (pair) return ((tick / IDLE_FRAME_TICKS) | 0) % 2 === 0 ? `${e.special}0` : `${e.special}1`;
    if (ready(e.special)) return e.special;
  }

  /*
   * Dormant means **standing**, not merely unaware.
   *
   * Returning it for any unaware body was why the enemies looked like they
   * had no animation at all: an unaware body patrols, so it was walking
   * around the room drawn as a single static frame. There is one dormant
   * frame per facing, so that pose can only ever be a still — which makes it
   * the right answer for a body that is standing and the wrong answer for one
   * that is moving.
   */
  const moving = Math.hypot(e.vx, e.vy) > WALKING_PX_PER_S;
  const canWalk = ready("walk0") && ready("walk1") && ready("walk2") && ready("walk3");
  if (!e.awake) {
    if (moving && canWalk) return `walk${((e.travelled / strideFor(e.radius, e.speed)) | 0) % 4}`;
    /*
     * Moving with no walk cycle drawn — the orbiter, which circles constantly
     * and has none — falls back to the *idle pair* rather than to the single
     * dormant frame. It is not a gait, but it is two frames instead of one,
     * which is the difference between a body and a decal.
     */
    if (moving) return ((tick / IDLE_FRAME_TICKS) | 0) % 2 === 0 ? "idle0" : "idle1";
    /*
     * Standing and unaware: the drawn idle pair.
     *
     * Every archetype has `idle0`/`idle1`, which are two frames of one motion
     * and therefore actually animate. `dormant` is one drawing per facing, so
     * it cannot — and the two attempts to work around that both failed in
     * instructive ways. Alternating `dormant` with `idle0` made the body stand
     * up and sit down once a second, because they are different poses rather
     * than a cycle. Faking a breath with a scale was invisible at this size,
     * and faking it with a one-pixel bob is a hack standing in for art that
     * already exists.
     *
     * So the pair is used and the hacks are gone. `dormant` needs a second
     * frame of its own pose before it is usable; that is in the art work
     * order.
     */
    if (ready("dormant") && ready("dormant1"))
      return ((tick / IDLE_FRAME_TICKS) | 0) % 2 === 0 ? "dormant" : "dormant1";
    if (ready("idle0") && ready("idle1"))
      return ((tick / IDLE_FRAME_TICKS) | 0) % 2 === 0 ? "idle0" : "idle1";
    if (ready("dormant")) return "dormant";
  }
  /*
   * Braking uses the **windup** drawing, which is a body leaning back.
   *
   * It is the same shape a mass arriving makes: braced against its own
   * momentum, weight on the back foot. Reusing it means a charge's skid has a
   * pose rather than a rotation applied to a walk frame, and it costs no art —
   * the drawing already exists for the other end of the same move.
   */
  /*
   * Braking, and then recovering from a brake, both hold the **windup**
   * drawing — a body leaning back, braced against its own momentum.
   *
   * The recovery used to fall back to the lunge pose, so a ram went lean-back
   * and then snapped into a mid-charge stance for the two thirds of a second
   * it spent standing still afterwards. The whole move should read as one
   * arc: wind up, launch, arrive braced, hold braced. A jab is the opposite
   * and springs back out, which is what its lunge pose is for.
   */
  if (e.brakeMs > 0 && ready("windup")) return "windup";
  if (e.attack === "windup" && ready("windup")) return "windup";
  if (e.attack === "recover" && e.recoversBraced && ready("windup")) return "windup";
  if ((e.attack === "lunge" || e.attack === "recover") && ready("lunge")) return "lunge";
  // Every body now has a two-frame recoil, which interrupts the gait so the
  // damage reads even under the white contact flash.
  if (e.hitFlashMs > 0 && ready("hit0") && ready("hit1"))
    return ((tick >> 1) & 1) === 0 ? "hit0" : "hit1";
  /*
   * A live emplacement **holds** its lit frame.
   *
   * Every other body announces that it has noticed the player by moving at
   * them. A turret cannot, and it is the archetype where the player most needs
   * the answer, because it is area denial: the question is whether a patch of
   * floor is currently expensive to stand on, and a dormant turret and an
   * armed one were the same picture apart from a 320 ms flash at the moment
   * the shot was already coming.
   *
   * The frame for it was already drawn — `tele` lights the core and all four
   * gems magenta, against the cyan core of the idle pair — and was being used
   * for one third of a second per volley. Held instead, the roster reads in
   * three states with no new art and no tint: idle pair is powered and
   * scanning, `tele` is locked on, `tele` plus the red flash below is firing
   * now. A tint would have said the same thing worse, by multiplying over a
   * drawing that already says it.
   *
   * It costs the turret its idle animation, which for an emplacement is the
   * right trade: a steady lit eye is the read, and alternating `tele` with
   * `idle0` would pulse between magenta and cyan — which is two *states*
   * flickering, not one motion.
   */
  if ((e.telegraphMs > 0 || (e.awake && e.stationary)) && ready("tele")) {
    if (ready("tele1")) return ((tick / IDLE_FRAME_TICKS) | 0) % 2 === 0 ? "tele" : "tele1";
    return "tele";
  }
  if (moving && canWalk) return `walk${((e.travelled / strideFor(e.radius, e.speed)) | 0) % 4}`;
  /*
   * A full idle cycle takes about a second, not half of one.
   *
   * At 14 ticks a frame the pair alternated a bit over twice a second, which
   * does not read as breathing — it reads as a twitch, and on a body with
   * tentacles it read as a seizure. Two frames can only imply an idle at all
   * if the change is slow enough to be a settle rather than a flicker.
   */
  return ((tick / IDLE_FRAME_TICKS) | 0) % 2 === 0 ? "idle0" : "idle1";
}

export interface FrameChoice {
  readonly name: string;
  readonly flipX: boolean;
}

/** The frame name and mirroring for an enemy, given what the sheet contains. */
export function enemyFrame(
  e: FramedEnemy, tick: number, has: (n: string) => boolean, base: string,
): FrameChoice {
  const pose = enemyPose(e, tick, has, base);
  return frameForFacing(base, pose, e.facing, has);
}

/**
 * Resolves a base and pose to a drawn frame at a facing.
 *
 * Shared with the kill silhouette, which needs the same resolution for a body
 * that is already gone. The east facing is the west drawing flipped, which is
 * why only three directions are drawn.
 */
/*
 * Every other side view faces **west**, and east is that drawing mirrored.
 *
 * There was briefly one, for the shooter, and getting it wrong is worth
 * recording because the mistake was in reading the art rather than in the
 * code. Measured by accent pixels its mass sits right of centre, which looked
 * like a barrel pointing east — but the large cyan shapes on that side are
 * **fins**, and the small magenta dot on the other side is its **eye**. An eye
 * is a face. Measuring only the warm accents put it at 0.34, left of centre,
 * in line with every other body.
 *
 * The lesson for the next one of these: find the eye, not the brightest mass.
 */

export function frameForFacing(
  base: string, pose: string, facing: number, has: (n: string) => boolean,
): FrameChoice {
  // A body with no facings at all, like the turret, is drawn from one frame.
  if (has(`${base}_${pose}`) && !has(`${base}_s_${pose}`))
    return { name: `${base}_${pose}`, flipX: false };

  const deg = ((facing * 180) / Math.PI + 360) % 360;
  if (deg >= 45 && deg < 135) return { name: `${base}_s_${pose}`, flipX: false };
  if (deg >= 135 && deg < 225) return { name: `${base}_w_${pose}`, flipX: false };
  if (deg >= 225 && deg < 315) return { name: `${base}_n_${pose}`, flipX: false };
  return { name: `${base}_w_${pose}`, flipX: true };
}
