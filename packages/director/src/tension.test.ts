/**
 * The room's intensity, now decided inside round 1 (design doc 004).
 *
 * Two things have to keep holding after the merge, and they pull against each
 * other. The **arc** must survive: the control still eases off a player who is
 * behind and presses one who is ahead, even though the question moved requests.
 * And the **independence** must survive: the room's own questions used to read
 * the answered tension, and now cannot, because they are answered in the same
 * request — so the room has to reach the same shape by reading the player
 * instead. A test that only checked the arc would miss a round 1 that had
 * quietly gone back to reading its own answer.
 */
import { describe, expect, it } from "vitest";
import {
  ITEMS, MAX_HEARTS, bucketClearSpeed, bucketGold, bucketHealth, bucketMovementPressure,
  bucketRecentDamage, bucketRunProgress, emptyHistory, plainInstance, heldDominantTags, UNMEASURED,
} from "@jr/core";
import type { RoomType, RunContext, Tension } from "@jr/core";
import { createDirector } from "./director.ts";
import type { ObservedRequest } from "./director.ts";

function ctx(over: {
  hearts?: number; damage?: number; clearMs?: number; index?: number; seed?: string;
  history?: { tensions: Tension[]; rooms: RoomType[] };
  /** What the last fights measured as damage a second (`run/observed.ts`). */
  power?: "low" | "fair" | "high";
} = {}): RunContext {
  // Room 6, not 5: room 5 is the king's first audience and asks no room questions (doc 022).
  const index = over.index ?? 6;
  const staff = { slots: 6, mana_max: 120 };
  const slots = [plainInstance("magic_bolt"), plainInstance("spark_spray"), null];
  const seed = over.seed ?? "tension";
  return {
    run_id: seed, seed, room_index: index,
    labels: {
      health: bucketHealth(over.hearts ?? MAX_HEARTS),
      recent_damage: bucketRecentDamage(over.damage ?? 0),
      clear_speed: bucketClearSpeed(over.clearMs ?? 30_000, 30_000),
      movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(index),
      gold: bucketGold(40),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "on_plan" },
      observed: { ...UNMEASURED, damage_rate: over.power ?? "fair" },
    },
    staff, slots, inventory: [],
    history: { ...emptyHistory(), ...(over.history ?? {}) },
    intent: { preset: "spam" },
  };
}

/** Plans one room many times and tallies what came out. */
async function rooms(over: NonNullable<Parameters<typeof ctx>[0]>, n = 200, roomType: RoomType = "combat") {
  const tensions: Tension[] = [];
  const sizes: string[] = [];
  const spaces: string[] = [];
  const densities: string[] = [];
  const requests: ObservedRequest[] = [];
  const director = createDirector("rule", { observe: (r) => requests.push(r) });
  for (let i = 0; i < n; i++) {
    const c = { ...ctx({ ...over, seed: `${over.seed ?? "t"}-${i}` }), room_index: [4, 6, 7, 8, 9, 10, 11, 12][i % 8]! };
    const plan = await director.planRoom(c, { room_index: c.room_index, door_slot: 0, room_type: roomType }, "build");
    tensions.push(plan.tension);
    sizes.push(plan.plan.params.size);
    spaces.push(plan.plan.params.space);
    if (plan.profile) densities.push(plan.profile.density);
  }
  const share = (xs: readonly string[], v: string) => xs.filter((x) => x === v).length / xs.length;
  return { tensions, sizes, spaces, densities, requests, share };
}

describe("the room's intensity, merged into round 1 (doc 004)", () => {
  it("costs one request, not two: the tension arrives with the room's own questions", async () => {
    const { requests } = await rooms({}, 4);
    const round1 = requests.filter((r) => r.meta.round === 1);
    expect(round1.length).toBe(4);
    for (const r of round1) {
      expect(Object.keys(r.questions)).toContain("next_tension");
      expect(Object.keys(r.questions)).toContain("space");
    }
    expect(requests.some((r) => r.meta.purpose === "doors")).toBe(false);
  });

  it("asks nothing at all in planDoors", async () => {
    const seen: ObservedRequest[] = [];
    const director = createDirector("rule", { observe: (r) => seen.push(r) });
    const plan = await director.planDoors(ctx());
    expect(seen).toEqual([]);
    expect(["release", "build", "peak"]).toContain(plan.tension);
  });

  /* ------------------------------- the arc -------------------------------- */

  it("eases off a player who has taken heavy damage", async () => {
    const hurt = await rooms({ hearts: 2, damage: 3, clearMs: 70_000, seed: "hurt" });
    const well = await rooms({ hearts: MAX_HEARTS, clearMs: 14_000, seed: "well" });
    expect(hurt.share(hurt.tensions, "release")).toBeGreaterThan(well.share(well.tensions, "release"));
    expect(hurt.share(hurt.tensions, "release")).toBeGreaterThan(0.4);
  });

  it("presses a player who is clearing fast and whole", async () => {
    const fast = await rooms({ hearts: MAX_HEARTS, clearMs: 14_000, seed: "fast" });
    const slow = await rooms({ hearts: MAX_HEARTS, clearMs: 70_000, seed: "slow" });
    // Peak is the modal answer for a fast clear, and far rarer for a slow one.
    expect(fast.share(fast.tensions, "peak")).toBeGreaterThan(0.4);
    expect(fast.share(fast.tensions, "peak")).toBeGreaterThan(slow.share(slow.tensions, "peak") + 0.2);
  });

  it("keeps the middle of the run on build", async () => {
    const steady = await rooms({ hearts: 4, damage: 1, clearMs: 30_000, seed: "steady" });
    expect(steady.share(steady.tensions, "build")).toBeGreaterThan(0.4);
  });

  it("never answers outside the range the pacing cap allows", async () => {
    for (const over of [{ hearts: 1, damage: 4 }, { hearts: MAX_HEARTS, clearMs: 12_000 }]) {
      const { tensions } = await rooms(over, 60);
      for (const t of tensions) expect(["release", "build", "peak"]).toContain(t);
    }
  });

  /* ------------------------- the recent history ---------------------------- */

  it("never offers a peak straight after a peak", async () => {
    const seen: ObservedRequest[] = [];
    const director = createDirector("rule", { observe: (r) => seen.push(r) });
    const c = ctx({ hearts: MAX_HEARTS, clearMs: 14_000 });
    const after = (tensions: Tension[], rooms: RoomType[]) => ({
      ...c, history: { ...c.history, tensions, rooms },
    });
    await director.planRoom(after(["peak"], ["combat"]), { room_index: 6, door_slot: 0, room_type: "combat" }, "build");
    const q = seen.at(-2)?.questions["next_tension"];
    expect(q, "next_tension was not asked").toBeTruthy();
    expect(Object.keys(q!.criteria)).not.toContain("peak");

    // ...but a peak after a build is still on the table.
    seen.length = 0;
    await director.planRoom(after(["build"], ["combat"]), { room_index: 6, door_slot: 0, room_type: "combat" }, "build");
    expect(Object.keys(seen.at(-2)?.questions["next_tension"]?.criteria ?? {})).toContain("peak");
  });

  it("owes a release when the run has not let up", async () => {
    const long = await rooms({ hearts: MAX_HEARTS, clearMs: 14_000, seed: "long", history: {
      tensions: ["build", "build", "build", "build"] as Tension[],
      rooms: ["combat", "combat", "combat", "combat"] as RoomType[],
    } });
    const just = await rooms({ hearts: MAX_HEARTS, clearMs: 14_000, seed: "just", history: {
      tensions: ["release"] as Tension[], rooms: ["combat"] as RoomType[],
    } });
    expect(long.share(long.tensions, "release")).toBeGreaterThan(just.share(just.tensions, "release"));
    expect(long.share(long.tensions, "peak")).toBeLessThan(just.share(just.tensions, "peak"));
  });

  /* ----------------------------- build power ------------------------------- */

  /*
   * Doc 002: `damage_rate` is what the last fights **measured** — damage a
   * second — where `clear_speed` says how long the room took. It replaced
   * `build_power`, which was a simulated figure against a curve. It moves
   * pacing only — the ramp still bounds everything — and it must never make
   * the same room harder for a stronger build by touching an enemy's numbers.
   */
  it("offers a hard-hitting run denser rooms than a struggling one at the same room index", async () => {
    const strong = await rooms({ power: "high", seed: "pw-strong" });
    const weak = await rooms({ power: "low", seed: "pw-weak" });
    expect(strong.share(strong.densities, "dense")).toBeGreaterThan(weak.share(weak.densities, "dense"));
    expect(weak.share(weak.densities, "sparse")).toBeGreaterThan(strong.share(strong.densities, "sparse"));
  });

  it("presses a hard-hitting run and eases a struggling one on the tension", async () => {
    const strong = await rooms({ power: "high", seed: "pt-strong" });
    const weak = await rooms({ power: "low", seed: "pt-weak" });
    expect(strong.share(strong.tensions, "peak")).toBeGreaterThan(weak.share(weak.tensions, "peak"));
  });

  it("does not push a strong build that also clears fast past the ramp", async () => {
    // The runaway case: every signal pointing the same way at once. The ramp
    // is the bound: room 1 offers sparse and normal, never dense, however
    // good the player is.
    const director = createDirector("rule");
    for (let i = 0; i < 20; i++) {
      const c = { ...ctx({ power: "high", hearts: MAX_HEARTS, clearMs: 12_000, seed: `ramp-${i}` }), room_index: 1 };
      const plan = await director.planRoom(c, { room_index: 1, door_slot: 0, room_type: "combat" }, "peak");
      // The Director's own answer: what it chose, before the assembler fits a
      // roster to it. The clamp inside the assembler is a separate backstop.
      expect(["sparse", "normal"]).toContain(plan.profile?.density);
      expect(plan.profile?.anchor).toBe("none");
    }
  });

  /* --------------------- the room still matches the pitch ------------------- */

  it("still sizes the room to the player, now that it cannot read the tension", async () => {
    // The relation `size` used to get from the tension it was handed, it now
    // gets from the labels the tension itself reads.
    const hurt = await rooms({ hearts: 2, damage: 3, clearMs: 70_000, seed: "hs" });
    const fast = await rooms({ hearts: MAX_HEARTS, clearMs: 14_000, seed: "fs" });
    expect(hurt.share(hurt.sizes, "compact")).toBeGreaterThan(fast.share(fast.sizes, "compact"));
    expect(fast.share(fast.sizes, "vast")).toBeGreaterThan(hurt.share(hurt.sizes, "vast"));
  });

  it("keeps the room varied: a run sees many spaces and every size", async () => {
    const { spaces, sizes } = await rooms({}, 80);
    expect(new Set(spaces).size).toBeGreaterThan(5);
    expect(new Set(sizes).size).toBe(3);
  });

  it("makes rooms without a fight compact whatever the player is doing", async () => {
    const shop = await rooms({ hearts: MAX_HEARTS, clearMs: 14_000, seed: "shop" }, 60, "shop");
    expect(shop.share(shop.sizes, "compact")).toBeGreaterThan(0.6);
  });
});
