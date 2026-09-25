/**
 * **The boss's fairness contract** (doc 005, "Boss: pressure and footwork").
 *
 * Three promises, each of which is the sort of thing that is true when it is
 * written and quietly stops being true two tuning passes later:
 *
 * 1. **Every volley leaves a lane.** A bullet pattern with no angular gap wide
 *    enough to stand in is not a hard pattern, it is a tax, and the whole
 *    design of the boss's ranged phases is dense-but-readable.
 * 2. **Every telegraph outlasts the reaction floor.** 260 ms is what the
 *    roster's own windup floor is set to, and nothing the boss does may
 *    promise damage sooner than a person can answer it.
 * 3. **The escalation is by kinds of move.** Each phase adds a move the last
 *    did not have, rather than more of one.
 */
import { describe, it, expect } from "vitest";
import { BOSS_PHASES, bossPhaseAt } from "./enemies.ts";
import { expandPattern } from "./patterns.ts";
import { MELEE_ATTACKS } from "../sim/melee.ts";
import { ARM_TELE_MS, RIFT_TELE_MS } from "../sim/attacks.ts";
import { BOSS_LEAP_MS, BOSS_LEAP_RISE_MS, BOSS_QUAKE_MS, BOSS_SLAM_MS } from "../sim/world.ts";

/**
 * The reaction floor: the shortest promise of damage the game is allowed to
 * make. It is `WINDUP_FLOOR_MS` in `sim/enemy.ts`, repeated here rather than
 * imported because what is being asserted is the *number*, and a test that
 * imports the number it checks asserts nothing.
 */
const REACTION_FLOOR_MS = 260;

/**
 * The widest angular gap in a set of simultaneous bullets, in degrees.
 *
 * Measured over the whole circle, so a pattern that only covers an arc — a
 * fan, an aimed burst — trivially has one, which is correct: the lane is
 * everywhere it is not shooting.
 */
function widestGapDeg(angles: readonly number[]): number {
  if (angles.length === 0) return 360;
  const sorted = [...angles].map((a) => ((a % 360) + 360) % 360).sort((p, q) => p - q);
  let widest = 360 - (sorted[sorted.length - 1]! - sorted[0]!);
  for (let i = 1; i < sorted.length; i++) widest = Math.max(widest, sorted[i]! - sorted[i - 1]!);
  return widest;
}

describe("every boss volley leaves a lane", () => {
  /**
   * Eighteen degrees at the range the patterns are read from — a hundred and
   * fifty px or so — is about forty px of arc, against a player eight px
   * across. It is a gap somebody has to walk to and can then stand in, which
   * is the standard: narrower than that and the pattern is asking for a dash
   * rather than for footwork, and the dash has a cooldown.
   */
  const MIN_LANE_DEG = 18;

  for (const phase of BOSS_PHASES) {
    it(`phase ${phase.name}`, () => {
      // A full cycle and a bit, at the pace the phase actually runs at.
      const shots = expandPattern(phase.pattern, 0, 24_000);
      expect(shots.length).toBeGreaterThan(20);
      const byTime = new Map<number, number[]>();
      for (const s of shots) {
        // Within a frame of each other is "at once" as far as the player is
        // concerned: they cannot step between two volleys 16 ms apart.
        const slot = Math.round(s.at_ms / 34);
        const at = byTime.get(slot) ?? [];
        /*
         * An aimed shot's absolute angle is wherever the player is, which is
         * nothing this can know — so the aim is taken as zero and everything
         * else is measured against it. That is the worst case for the lane,
         * because it puts the aimed bullet inside whatever the fixed pattern
         * is doing rather than beside it.
         */
        at.push(s.angle_deg);
        byTime.set(slot, at);
      }
      let worst = 360;
      let worstAt = -1;
      for (const [slot, angles] of byTime) {
        const gap = widestGapDeg(angles);
        if (gap < worst) { worst = gap; worstAt = slot * 34; }
      }
      expect(`${worst.toFixed(1)}deg at ${worstAt}ms`)
        .toBe(`${Math.max(worst, MIN_LANE_DEG).toFixed(1)}deg at ${worstAt}ms`);
    });
  }
});

describe("every boss telegraph outlasts the reaction floor", () => {
  it("the moves", () => {
    // The slam's raise, the quake's gather (and the cracks' own growth on top
    // of it), the leap's gather before it is even in the air, and the arms
    // lying still before they turn.
    expect(BOSS_SLAM_MS).toBeGreaterThanOrEqual(REACTION_FLOOR_MS);
    expect(BOSS_QUAKE_MS + RIFT_TELE_MS).toBeGreaterThanOrEqual(REACTION_FLOOR_MS);
    expect(BOSS_LEAP_RISE_MS).toBeGreaterThanOrEqual(REACTION_FLOOR_MS);
    expect(BOSS_LEAP_MS).toBeGreaterThan(BOSS_LEAP_RISE_MS + REACTION_FLOOR_MS);
    expect(ARM_TELE_MS).toBeGreaterThanOrEqual(REACTION_FLOOR_MS);
  });

  it("the blades, including the backhand", () => {
    for (const kind of ["slash", "cleave", "charge", "maul", "greatsweep", "greatcleave", "greatslash", "dashcut"] as const)
      expect([kind, MELEE_ATTACKS[kind].windupMs >= REACTION_FLOOR_MS]).toEqual([kind, true]);
  });

  it("the backhand reaches past where the player's own arc lands", () => {
    // The player's sword lands out to about 80 px between centres against a
    // 22 px body. A punish for standing in sword range has to cover all of
    // it, or there is a standing place that hits and cannot be answered.
    expect(MELEE_ATTACKS.maul.reachTiles * 32 + 22).toBeGreaterThan(80);
  });
});

describe("the phases escalate by kinds of move", () => {
  // Heavier by what he does — longer strings, more sweeps — not by a damage multiplier (`BOSS_POWER`).
  it("each one is faster and wider than the last", () => {
    for (let i = 1; i < BOSS_PHASES.length; i++) {
      const prev = BOSS_PHASES[i - 1]!;
      const now = BOSS_PHASES[i]!;
      expect(now.rate).toBeGreaterThan(prev.rate);
      expect(now.speed).toBeGreaterThan(prev.speed);
      expect(now.at).toBeLessThan(prev.at);
    }
  });

  it("phase I is the only one with nothing layered on top of the pattern", () => {
    // A `parallel` node is two threats at once. Phase I has none and the
    // later phases do: that is the escalation, written where it can be read.
    const layered = (node: { kind: string; steps?: { pattern: { kind: string } }[] }): number =>
      (node.steps ?? []).filter((s) => s.pattern.kind === "parallel").length;
    expect(layered(BOSS_PHASES[0]!.pattern as never)).toBe(0);
    expect(layered(BOSS_PHASES[1]!.pattern as never)).toBeGreaterThan(0);
    expect(layered(BOSS_PHASES[2]!.pattern as never)).toBeGreaterThan(1);
  });

  it("reads its phase off its health", () => {
    expect(bossPhaseAt(1)).toBe(1);
    expect(bossPhaseAt(0.61)).toBe(1);
    expect(bossPhaseAt(0.6)).toBe(2);
    expect(bossPhaseAt(0.31)).toBe(2);
    expect(bossPhaseAt(0.3)).toBe(3);
    expect(bossPhaseAt(0.01)).toBe(3);
  });
});
