import { describe, expect, it } from "vitest";
import { FACING_MARGIN_DEG, newStride, settleStride, SETTLE_FRAME_MS, STILL_MS, stickyFacing } from "./stride-settle.ts";

const N = 6, STRIDE = 4, TICK = 1000 / 60;

/** Drives a body through a list of (pose, px moved this tick) and returns the walk frame shown each tick, or the pose. */
function run(steps: readonly [string, number][]): (number | string)[] {
  const s = newStride(0, 0);
  let travelled = 0, tick = 0;
  return steps.map(([pose, px]) => {
    travelled += px; tick++;
    const f = settleStride(s, pose, travelled, tick, N, STRIDE, TICK) ?? pose;
    return /^walk\d$/.test(f) ? Number(f.slice(4)) : f;
  });
}
const repeat = <T>(x: T, k: number): T[] => Array.from({ length: k }, () => x);
/** A start, then `frames` more frames of walking at a pixel a tick, ending on the tick the last is reached. */
const walk = (frames: number) => repeat(["walk0", 1] as [string, number], 1 + frames * STRIDE);
/** The same, a tick longer, so the last frame reached has gone up (it is shown a tick late). */
const walkOn = (frames: number) => [...walk(frames), ["walk0", 1] as [string, number]];
/** The distinct values in order, runs collapsed. */
const runs = (xs: readonly (number | string)[]) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);

describe("settleStride", () => {
  it("starts from standing on the frame after a foot leaves, then follows the ground", () => {
    const shown = run(walkOn(4));
    expect(runs(shown)).toEqual([1, 2, 3, 4, 5]);
  });

  it("finishes the step on the clock before standing, never cutting back", () => {
    const ticksPerFrame = Math.ceil(SETTLE_FRAME_MS / TICK);
    // Walk onto frame 3, where both feet are down wide, then stop.
    const shown = run([...walk(2), ...repeat(["idle1", 0] as [string, number], 3 * ticksPerFrame + 2)]);
    expect(runs(shown)).toEqual([1, 2, 3, 4, 5, "idle1"]);
  });

  it("stands from the frame before a foot lands once it has been seen for half a frame", () => {
    const shown = run([...walk(1), ...repeat(["idle0", 0] as [string, number], 8)]);
    expect(runs(shown)).toEqual([1, 2, "idle0"]);
    // Frame 2 is up for the first ticks of the stop, not flashed for one.
    const held = shown.filter((f) => f === 2).length;
    expect(held * TICK).toBeGreaterThanOrEqual(SETTLE_FRAME_MS / 2 - TICK);
  });

  it("starts the next walk on the other foot", () => {
    // Stops after frame 2 (left foot down next), so the next start is frame 4.
    const shown = run([...walk(1), ...repeat(["idle0", 0] as [string, number], 8), ["walk0", 1]]);
    expect(runs(shown)).toEqual([1, 2, "idle0", 4]);
  });

  it("stands, after finishing the step, when a walk covers no ground", () => {
    const ticksPerFrame = Math.ceil(SETTLE_FRAME_MS / TICK);
    const still = Math.ceil(STILL_MS / TICK) + 3 * ticksPerFrame + 2;
    const shown = run([...walk(2), ...repeat(["walk3", 0] as [string, number], still)]);
    expect(runs(shown)).toEqual([1, 2, 3, 4, 5, "idle0"]);
  });

  it("keeps walking through a tick that covers no ground", () => {
    const shown = run([...walk(1), ["walk0", 0], ...repeat(["walk0", 1] as [string, number], 2 * STRIDE + 1)]);
    expect(runs(shown)).toEqual([1, 2, 3, 4]);
  });

  it("never flashes a frame for one tick before an attack takes over", () => {
    // The walk reaches frame 3 on its last tick, and the windup starts on the next.
    const shown = run([...walk(2), ["windup", 0]]);
    expect(shown.filter((f) => f === 3)).toEqual([]);
  });

  it("treats an attack as standing", () => {
    const shown = run([...walk(2), ["windup", 0], ["walk0", 1]]);
    expect(runs(shown)).toEqual([1, 2, "windup", 1]);
  });
});

describe("stickyFacing", () => {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  it("reads the facing straight off the angle the first time", () => {
    expect(stickyFacing(null, rad(90))).toBe("s");
    expect(stickyFacing(null, rad(180))).toBe("w");
    expect(stickyFacing(null, rad(270))).toBe("n");
    expect(stickyFacing(null, rad(10))).toBe("e");
    expect(stickyFacing(null, rad(-10))).toBe("e");
  });

  it("holds a facing across a boundary until clearly past it", () => {
    // South is 45..135; a body on the diagonal at 135 must not flip to west.
    expect(stickyFacing("s", rad(140))).toBe("s");
    expect(stickyFacing("s", rad(135 + FACING_MARGIN_DEG + 1))).toBe("w");
    expect(stickyFacing("w", rad(130))).toBe("w");
    expect(stickyFacing("e", rad(360 - 50))).toBe("e");
    expect(stickyFacing("e", rad(360 - 45 - FACING_MARGIN_DEG - 1))).toBe("n");
  });

  it("turns at once to a facing that is not a neighbour's boundary", () => {
    expect(stickyFacing("s", rad(270))).toBe("n");
  });
});
