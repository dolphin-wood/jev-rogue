import { describe, it, expect } from "vitest";
import {
  ARC_DEG, ARC_REACH, BLADE_DEG, BLADE_REACH, MANA_PER_HIT_FRACTION,
  SPREAD_BASE, SWEEP_DEG, SWING_ACTIVE_MS, SWING_TOTAL_MS, SWING_WINDUP_MS,
  beginSwing, fullReach, makeSpin, makeSwingBox, manaPerHit, sectorHits,
  snapFacing, stepSwing, sweepFor, SWING_CHAIN_MS, swingMoveScale, swingPhase, totalCoverageDeg,
  wallSlamSquareness, SWING_RUN, SWING_BREATH_MS, THRUST_DAMAGE,
} from "./melee.ts";
import { createWorld, step } from "./world.ts";
import { NO_INPUT, PLAYER_RADIUS, STEP_MS } from "./types.ts";
import type { Input, World } from "./types.ts";
import { makeEnemy } from "./enemy.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import { TILE_PX } from "../types.ts";

const src = new RngSource("melee-test");

function world(): World {
  const g = generateRoom(
    { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "combat", src.stream("room"), { plain: true },
  );
  const w = createWorld({
    room: toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" }),
    encounter: null,
    // No destructibles: a swing aimed at empty floor would otherwise be able
    // to earn mana from a pot the test never asked for.
    props: 0,
    staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), null, null, null, null, null],
    hearts: 6,
    rng: src.stream("world"),
  });
  w.player.x = 336;
  w.player.y = 208;
  w.player.facing = 0; // east
  return w;
}

const input = (o: Partial<Input> = {}): Input => ({ ...NO_INPUT, ...o });

/** A woken, active enemy at a position. */
function put(w: World, id: number, x: number, y: number, kind = "rusher" as const) {
  const e = makeEnemy(id, kind, x, y, []);
  e.spawnFadeMs = 0;
  e.awake = true;
  e.hp = 1000;
  e.maxHp = 1000;
  w.enemies.push(e);
  return e;
}

describe("the swing's timing", () => {
  it("carries a hitbox for only eight of its fifteen frames", () => {
    const w = world();
    beginSwing(w.player, w);
    const phases: string[] = [];
    let activeSteps = 0;
    for (let i = 0; i < 20; i++) {
      stepSwing(w, STEP_MS);
      phases.push(swingPhase(w.player));
      if (w.swing.active) activeSteps++;
    }
    expect(phases[0]).toBe("windup");
    // Eight frames at 60 Hz, within a frame of rounding.
    expect(activeSteps).toBeGreaterThanOrEqual(7);
    expect(activeSteps).toBeLessThanOrEqual(9);
    expect(Math.round(SWING_ACTIVE_MS / STEP_MS)).toBe(8);
    expect(Math.round(SWING_TOTAL_MS / STEP_MS)).toBe(16);
  });

  it("never lands a hit during the windup", () => {
    const w = world();
    put(w, 1, w.player.x + 20, w.player.y);
    beginSwing(w.player, w);
    let struck = 0;
    for (let i = 0; i < Math.floor(SWING_WINDUP_MS / STEP_MS); i++) {
      struck += stepSwing(w, STEP_MS).length;
    }
    expect(struck).toBe(0);
  });

  it("roots the player while committed, and frees them after", () => {
    const w = world();
    expect(swingMoveScale(w.player)).toBe(1);
    beginSwing(w.player, w);
    expect(swingMoveScale(w.player)).toBeLessThan(0.5);
    for (let i = 0; i < 20; i++) stepSwing(w, STEP_MS);
    expect(swingMoveScale(w.player)).toBe(1);
  });
});

describe("the swing's geometry", () => {
  it("is a wide arc reaching 1.8 tiles", () => {
    // Widened from ALttP's measured 80 because that angle at this reach is a
    // stubby lozenge rather than a crescent, and the measured cost of widening
    // is about ten percent more enemies caught per swing.
    expect(ARC_DEG).toBe(170);
    expect(BLADE_DEG + SWEEP_DEG).toBe(ARC_DEG);
    expect(ARC_REACH).toBeCloseTo(TILE_PX * 1.8, 6);
  });

  it("hits in front and misses behind", () => {
    const w = world();
    const front = put(w, 1, w.player.x + 30, w.player.y);
    const behind = put(w, 2, w.player.x - 30, w.player.y);
    beginSwing(w.player, w);
    const hit = new Set<number>();
    for (let i = 0; i < 20; i++) for (const e of stepSwing(w, STEP_MS)) hit.add(e.id);
    expect(hit.has(front.id)).toBe(true);
    expect(hit.has(behind.id)).toBe(false);
  });

  it("misses past its reach", () => {
    const w = world();
    const far = put(w, 1, w.player.x + ARC_REACH + 40, w.player.y);
    beginSwing(w.player, w);
    const hit = new Set<number>();
    for (let i = 0; i < 20; i++) for (const e of stepSwing(w, STEP_MS)) hit.add(e.id);
    expect(hit.has(far.id)).toBe(false);
  });

  it("widens the sector by the target's radius, so a body clipped by the edge is hit", () => {
    const box = makeSwingBox();
    box.x = 0; box.y = 0; box.facing = 0;
    box.halfArc = ((ARC_DEG / 2) * Math.PI) / 180;
    box.reach = ARC_REACH;
    // Just outside the angular edge as a point, inside once its radius counts.
    // Measured against the blade's own width rather than the whole sweep,
    // since that is what the sector test uses.
    box.halfArc = (17 * Math.PI) / 180;
    const edge = 22 * (Math.PI / 180);
    const p = { x: Math.cos(edge) * 40, y: Math.sin(edge) * 40 };
    expect(sectorHits(box, p, 0)).toBe(false);
    expect(sectorHits(box, p, 14)).toBe(true);
  });

  it("hits anything overlapping the origin whatever the angle", () => {
    const box = makeSwingBox();
    box.x = 0; box.y = 0; box.facing = 0;
    box.halfArc = ((ARC_DEG / 2) * Math.PI) / 180;
    box.reach = ARC_REACH;
    expect(sectorHits(box, { x: -3, y: 0 }, 10)).toBe(true);
  });
});

describe("the swing's commitment", () => {
  it("locks its direction, so it can be walked out of", () => {
    const w = world();
    beginSwing(w.player, w);
    const locked = w.swing.facing;
    w.player.facing = Math.PI; // the player turns mid-swing
    for (let i = 0; i < 6; i++) stepSwing(w, STEP_MS);
    expect(w.swing.facing).toBeCloseTo(locked, 6);
  });

  it("hits each body once per swing, however long the hitbox lives", () => {
    const w = world();
    put(w, 1, w.player.x + 30, w.player.y);
    beginSwing(w.player, w);
    let total = 0;
    for (let i = 0; i < 20; i++) total += stepSwing(w, STEP_MS).length;
    expect(total).toBe(1);
  });
});

describe("a run of swings: a cut, a cut back, a thrust, then a rest", () => {
  /** Swings once and lets it play out, then a few steps more: still inside the chain window. */
  const swingThrough = (w: ReturnType<typeof world>) => {
    beginSwing(w.player, w);
    const s = { damage: w.swing.damage, reach: fullReach(w.swing), sweep: w.swing.sweep, sweepDeg: w.swing.sweepDeg, thrust: w.swing.thrust, started: w.player.swingMs > 0 };
    for (let i = 0; i < 20; i++) stepSwing(w, STEP_MS);
    return s;
  };

  it("cuts twice alike and thrusts harder and further on the third", () => {
    const w = world();
    const [a, b, c] = [swingThrough(w), swingThrough(w), swingThrough(w)];
    expect(b.damage).toBeCloseTo(a.damage, 6);
    expect(b.reach).toBeCloseTo(a.reach, 6);
    expect(a.thrust || b.thrust).toBe(false);
    expect(c.thrust).toBe(true);
    expect(c.sweepDeg).toBe(0);
    expect(c.damage).toBeCloseTo(a.damage * THRUST_DAMAGE, 6);
    expect(c.reach).toBeGreaterThan(a.reach);
  });

  it("brings the second cut back the way the first came", () => {
    const w = world();
    w.player.facing = Math.PI;
    expect([swingThrough(w).sweep, swingThrough(w).sweep]).toEqual([1, -1]);
  });

  it("rests after the thrust, then starts the run afresh", () => {
    const w = world();
    for (let n = 0; n < SWING_RUN; n++) swingThrough(w);
    // A press during the rest does nothing.
    expect(swingThrough(w).started).toBe(false);
    for (let i = 0; i < Math.ceil(SWING_BREATH_MS / STEP_MS); i++) stepSwing(w, STEP_MS);
    const next = swingThrough(w);
    expect(next.started).toBe(true);
    expect(next.thrust).toBe(false);
    expect(w.swing.chained).toBe(false);
  });

  it("marks a swing that follows closely as continuing the chain, and one after a pause as not", () => {
    const w = world();
    beginSwing(w.player, w);
    expect(w.swing.chained).toBe(false);
    for (let i = 0; i < 20; i++) stepSwing(w, STEP_MS);
    beginSwing(w.player, w);
    expect(w.swing.chained).toBe(true);
    for (let i = 0; i < 20 + Math.ceil(SWING_CHAIN_MS / STEP_MS) + 1; i++) stepSwing(w, STEP_MS);
    beginSwing(w.player, w);
    expect(w.swing.chained).toBe(false);
  });

  it("reverses in world space for the facing that is drawn mirrored", () => {
    // East is the west sprite flipped, and a horizontal flip does not change
    // vertical order, so the world sweep has to be reversed instead or the
    // drawn swing and the real one disagree.
    expect(sweepFor(0)).toBe(-1);
    expect(sweepFor(Math.PI)).toBe(1);
    expect(sweepFor(Math.PI / 2)).toBe(1);
    expect(sweepFor(-Math.PI / 2)).toBe(1);
  });

  it("keeps the blade travelling the same way relative to the body", () => {
    // Measured as the vertical order of travel: down to up in both facings.
    const travel = (facing: number): number => {
      const w = world();
      w.player.facing = facing;
      beginSwing(w.player, w);
      const ys: number[] = [];
      for (let i = 0; i < 20; i++) {
        stepSwing(w, STEP_MS);
        if (w.swing.active) ys.push(Math.sin(w.swing.angle));
      }
      return ys[ys.length - 1]! - ys[0]!;
    };
    expect(Math.sign(travel(0))).toBe(Math.sign(travel(Math.PI)));
  });
});

describe("multi-target resolution", () => {
  it("resolves nearest first, then leftmost, so a seed reproduces", () => {
    const w = world();
    // Two at the same distance, one further, all on one bearing so the blade
    // crosses them in the same step: the order is the rule's, not the sweep's.
    const far = put(w, 1, w.player.x + 50, w.player.y);
    const nearRight = put(w, 2, w.player.x + 25, w.player.y + 2);
    const nearLeft = put(w, 3, w.player.x + 24.9, w.player.y - 2);
    beginSwing(w.player, w);
    const order: number[] = [];
    for (let i = 0; i < 20; i++) for (const e of stepSwing(w, STEP_MS)) order.push(e.id);
    expect(order).toHaveLength(3);
    // Nearest first. The two near bodies precede the far one.
    expect(order.indexOf(far.id)).toBe(2);
    expect(new Set([nearLeft.id, nearRight.id])).toEqual(new Set(order.slice(0, 2)));
  });

  it("catches several bodies in one arc", () => {
    const w = world();
    for (let i = 0; i < 4; i++) put(w, i + 1, w.player.x + 34, w.player.y - 18 + i * 12);
    beginSwing(w.player, w);
    let total = 0;
    for (let i = 0; i < 20; i++) total += stepSwing(w, STEP_MS).length;
    expect(total).toBeGreaterThan(1);
  });
});

describe("mana from hitting things", () => {
  it("scales with the cap, so it never goes stale as the cap grows", () => {
    expect(manaPerHit(70)).toBeCloseTo(70 * MANA_PER_HIT_FRACTION, 6);
    expect(manaPerHit(210)).toBeCloseTo(3 * manaPerHit(70), 6);
  });

  it("is returned by a connecting swing, through the world step", () => {
    const w = world();
    put(w, 1, w.player.x + 30, w.player.y);
    w.player.mana = 0;
    for (let i = 0; i < 20; i++) step(w, input({ swing: i === 0 }));
    expect(w.player.mana).toBeGreaterThan(0);
  });

  it("returns nothing for a swing that connects with nothing", () => {
    const w = world();
    w.player.mana = 0;
    for (let i = 0; i < 20; i++) step(w, input({ swing: i === 0 }));
    // Only natural regeneration, which is a trickle, so well under one hit.
    expect(w.player.mana).toBeLessThan(manaPerHit(w.staff.mana_max));
  });
});

describe("facing", () => {
  it("snaps to four directions from the movement vector", () => {
    expect(snapFacing(1, 0, 0)).toBeCloseTo(0, 6);
    expect(snapFacing(-1, 0, 0)).toBeCloseTo(Math.PI, 6);
    expect(snapFacing(0, 1, 0)).toBeCloseTo(Math.PI / 2, 6);
    expect(snapFacing(0, -1, 0)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it("resolves a diagonal to its dominant axis", () => {
    expect(snapFacing(1, 0.4, 0)).toBeCloseTo(0, 6);
    expect(snapFacing(0.4, 1, 0)).toBeCloseTo(Math.PI / 2, 6);
  });

  it("holds the last facing when movement stops", () => {
    expect(snapFacing(0, 0, Math.PI)).toBeCloseTo(Math.PI, 6);
  });

  it("keeps turning during a swing, so the next hit re-aims", () => {
    const w = world();
    w.player.facing = 0;
    step(w, input({ swing: true }));
    for (let i = 0; i < 4; i++) step(w, input({ moveY: 1 }));
    // Freezing this is what "cannot change direction mid-attack" was: the
    // next hit came out in the old direction.
    expect(w.player.facing).toBeCloseTo(Math.PI / 2, 6);
  });

  it("but holds the live hitbox on the centre it was given", () => {
    const w = world();
    w.player.facing = 0;
    step(w, input({ swing: true }));
    const centre = w.swing.facing;
    for (let i = 0; i < 4; i++) step(w, input({ moveY: 1 }));
    // Otherwise turning while swinging would widen the arc to a full circle
    // and dissolve the point of an 80 degree commitment.
    expect(w.swing.facing).toBeCloseTo(centre, 6);
    expect(w.player.facing).not.toBeCloseTo(centre, 3);
  });

  it("aims the next hit where the player turned to", () => {
    const w = world();
    w.player.facing = 0;
    step(w, input({ swing: true }));
    for (let i = 0; i < 20; i++) step(w, input({ moveY: 1 }));
    step(w, input({ swing: true, moveY: 1 }));
    expect(w.swing.facing).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("the blade sweeps rather than appearing", () => {
  it("travels across the active window", () => {
    const w = world();
    beginSwing(w.player, w);
    const seen: number[] = [];
    for (let i = 0; i < 20; i++) {
      stepSwing(w, STEP_MS);
      if (w.swing.active) seen.push(w.swing.angle);
    }
    expect(seen.length).toBeGreaterThan(4);
    // It moves, and it moves monotonically in one direction.
    const first = seen[0]!;
    const last = seen[seen.length - 1]!;
    expect(Math.abs(last - first)).toBeGreaterThan(0.2);
    // Monotonic in one direction, whichever the facing's sweep sign gives.
    const deltas = seen.slice(1).map((a, i) => a - seen[i]!);
    const sign = Math.sign(last - first);
    expect(deltas.every((d) => Math.sign(d) === sign || d === 0)).toBe(true);
  });

  it("covers the measured 80 degrees in total, blade plus travel", () => {
    const w = world();
    beginSwing(w.player, w);
    stepSwing(w, STEP_MS);
    expect(totalCoverageDeg(w.swing)).toBeCloseTo(ARC_DEG, 6);
    expect(BLADE_DEG + SWEEP_DEG).toBe(ARC_DEG);
  });

  it("travels the same way on the first cut of every run", () => {
    const w = world();
    const travel = (): number => {
      beginSwing(w.player, w);
      const seen: number[] = [];
      for (let i = 0; i < 20; i++) {
        stepSwing(w, STEP_MS);
        if (w.swing.active) seen.push(w.swing.angle);
      }
      return seen[seen.length - 1]! - seen[0]!;
    };
    // The first cut of every run; the second of a run comes back the other way.
    const first = travel();
    for (let i = 0; i < 60; i++) stepSwing(w, STEP_MS);
    expect(Math.sign(travel())).toBe(Math.sign(first));
  });

  it("keeps the locked centre while the blade moves", () => {
    const w = world();
    w.player.facing = 0;
    beginSwing(w.player, w);
    const centre = w.swing.facing;
    const offsets: number[] = [];
    for (let i = 0; i < 20; i++) {
      stepSwing(w, STEP_MS);
      // The centre is fixed for the whole swing, however far the blade has
      // travelled from it.
      expect(w.swing.facing).toBeCloseTo(centre, 6);
      if (w.swing.active) offsets.push(w.swing.angle - centre);
    }
    // The blade sits either side of the centre and passes through it, so the
    // extremes are what prove it moved. Sampling the midpoint would find the
    // blade exactly on the centre, which is correct and proves nothing.
    expect(Math.min(...offsets)).toBeLessThan(-0.2);
    expect(Math.max(...offsets)).toBeGreaterThan(0.2);
  });
});

describe("a spin", () => {
  it("covers a full turn per rotation", () => {
    const w = world();
    beginSwing(w.player, w);
    makeSpin(w.swing, 2);
    stepSwing(w, STEP_MS);
    expect(totalCoverageDeg(w.swing)).toBeCloseTo(720 + BLADE_DEG, 6);
  });

  it("sweeps past bodies in sequence rather than striking all at once", () => {
    const w = world();
    // A ring of four, one in each cardinal direction, inside reach.
    const ids = [0, 1, 2, 3].map((i) => {
      const a = (i * Math.PI) / 2;
      return put(w, i + 1, w.player.x + Math.cos(a) * 30, w.player.y + Math.sin(a) * 30).id;
    });
    beginSwing(w.player, w);
    makeSpin(w.swing, 1);

    const stepsWithHits: number[] = [];
    const hit = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const struck = stepSwing(w, STEP_MS);
      if (struck.length > 0) stepsWithHits.push(i);
      for (const e of struck) hit.add(e.id);
    }
    // All four are eventually caught by a full turn.
    expect(hit.size).toBe(ids.length);
    // But not in a single frame: a spin is a rotating blade, not a nova.
    expect(stepsWithHits.length).toBeGreaterThan(1);
  });

  it("is still one hit per body per sweep", () => {
    const w = world();
    put(w, 1, w.player.x + 30, w.player.y);
    beginSwing(w.player, w);
    makeSpin(w.swing, 2);
    let total = 0;
    for (let i = 0; i < 30; i++) total += stepSwing(w, STEP_MS).length;
    expect(total).toBe(1);
  });
});

describe("reach, split into steel and a spreading crescent", () => {
  it("keeps the steel fixed and grows only the spread", () => {
    expect(BLADE_REACH).toBeCloseTo(TILE_PX, 6);
    expect(BLADE_REACH + SPREAD_BASE).toBeCloseTo(ARC_REACH, 6);
    // The measured 1.8 tiles survives as the baseline total.
    expect(ARC_REACH).toBeCloseTo(TILE_PX * 1.8, 6);
  });

  it("covers only the steel on the first active frame, then spreads", () => {
    const w = world();
    beginSwing(w.player, w);
    const reaches: number[] = [];
    for (let i = 0; i < 20; i++) {
      stepSwing(w, STEP_MS);
      if (w.swing.active) reaches.push(w.swing.reach);
    }
    expect(reaches[0]).toBeLessThan(fullReach(w.swing));
    expect(reaches[0]).toBeGreaterThanOrEqual(BLADE_REACH);
    expect(reaches[reaches.length - 1]!).toBeCloseTo(fullReach(w.swing), 0);
    // Monotonic: the edge travels out, it does not pulse.
    for (let i = 1; i < reaches.length; i++) expect(reaches[i]!).toBeGreaterThanOrEqual(reaches[i - 1]!);
  });

  it("strikes a distant body later in the swing than a close one", () => {
    const w = world();
    const near = put(w, 1, w.player.x + BLADE_REACH * 0.6, w.player.y);
    const far = put(w, 2, w.player.x + ARC_REACH * 0.98, w.player.y);
    beginSwing(w.player, w);
    const at: Record<number, number> = {};
    for (let i = 0; i < 20; i++)
      for (const e of stepSwing(w, STEP_MS)) if (at[e.id] === undefined) at[e.id] = i;
    expect(at[near.id]).toBeDefined();
    expect(at[far.id]).toBeDefined();
    expect(at[far.id]!).toBeGreaterThan(at[near.id]!);
  });

  it("leaves no dead zone at the player's feet when reach grows", () => {
    const w = world();
    const touching = put(w, 1, w.player.x + 12, w.player.y);
    beginSwing(w.player, w);
    // A long spread, as a reach upgrade would give.
    w.swing.spread = TILE_PX * 4;
    const hit = new Set<number>();
    for (let i = 0; i < 20; i++) for (const e of stepSwing(w, STEP_MS)) hit.add(e.id);
    expect(hit.has(touching.id)).toBe(true);
  });
});


describe("a charge against a wall", () => {
  it("counts a head-on impact as square and a graze as not", () => {
    /*
     * The blocked axis is the surface normal, so squareness is a dot product.
     * Charging *along* a wall blocks one axis on every frame, and without this
     * distinction a tank that set off parallel to the stonework knocked itself
     * out immediately — which is both wrong and the opposite of interesting,
     * since steering a charge down a corridor is what a corridor is for.
     */
    // Straight into a vertical wall: fully square.
    expect(wallSlamSquareness(true, false, 1, 0)).toBeCloseTo(1, 6);
    expect(wallSlamSquareness(true, false, -1, 0)).toBeCloseTo(1, 6);
    // Straight along it: not square at all.
    expect(wallSlamSquareness(true, false, 0, 1)).toBeCloseTo(0, 6);
    // Forty-five degrees: halfway, and above the 0.62 threshold.
    const diag = Math.SQRT1_2;
    expect(wallSlamSquareness(true, false, diag, diag)).toBeCloseTo(diag, 6);
    // A corner has nowhere to slide, so it is head-on whatever the angle.
    expect(wallSlamSquareness(true, true, 0.1, 0.99)).toBe(1);
    // Nothing blocked is no impact.
    expect(wallSlamSquareness(false, false, 1, 0)).toBe(0);
  });

  it("is symmetric between the two axes", () => {
    expect(wallSlamSquareness(false, true, 0, 1)).toBeCloseTo(1, 6);
    expect(wallSlamSquareness(false, true, 1, 0)).toBeCloseTo(0, 6);
  });
});
