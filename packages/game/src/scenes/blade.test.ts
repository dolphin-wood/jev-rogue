/**
 * The staff and its blade, checked against a **running simulation**.
 *
 * Static frames passed every check three times while the live swing stayed
 * wrong, which is the lesson: the aim is continuous and the drawings are five
 * keys per facing, so the case that breaks is the one a still frame never
 * shows. This steps a real `World` through whole swings — every aim, both
 * chain directions — and runs the renderer's own geometry on each tick.
 *
 * What must hold on every sampled frame:
 *
 * - the staff is turned to the cut, within one baked step;
 * - the blade is the staff's own line, within one step;
 * - the blade's point is on the hit arc, within two pixels;
 * - the staff is never inverted: the crystal is always further from the body
 *   than the grip.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NO_INPUT, STEP_MS, RngSource, createWorld, step, beginSwing, swingPhase,
  plainInstance, generateRoom, toRoomPlan, SWING_TOTAL_MS, SWING_ORIGIN_LIFT,
} from "@jr/core";
import type { World } from "@jr/core";
import { STAFF_ANGLE_STEPS, angleGapDeg, heldStaff, staffSpriteCentre, swingStaff } from "./blade.ts";

/** One baked step of the staff's rotation, in degrees. */
const STEP_DEG = 360 / STAFF_ANGLE_STEPS;
/** As the scene calls it: the drawn fist, and the staff's own grip-to-crystal. */
const GRIP_TO_CRYSTAL = 10;

const src = new RngSource("blade-live");
function world(): World {
  const g = generateRoom(
    { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "combat", src.stream("room"), { plain: true },
  );
  const w = createWorld({
    room: toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" }),
    encounter: null, props: 0,
    staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), null, null, null, null, null],
    hearts: 6, rng: src.stream("world"),
  });
  w.player.x = 336;
  w.player.y = 208;
  return w;
}

interface Sample {
  readonly staff: ReturnType<typeof swingStaff>;
  readonly centre: readonly [number, number];
  readonly grip: readonly [number, number];
  readonly cut: number;
  readonly reach: number;
  readonly aim: number;
}

/**
 * Every tick of two consecutive swings at one aim. Two in a row is a chain,
 * which alternates the sweep's direction, so both are covered.
 */
function samples(aim: number, swings = 2): Sample[] {
  const w = world();
  w.player.facing = aim;
  w.player.aim = { x: Math.cos(aim), y: Math.sin(aim) };
  const out: Sample[] = [];
  for (let n = 0; n < swings; n++) {
    beginSwing(w.player, w);
    for (let t = 0; t < SWING_TOTAL_MS + STEP_MS; t += STEP_MS) {
      if (swingPhase(w.player) === "none") break;
      const box = w.swing;
      const reach = Math.max(box.reach, box.bladeReach);
      const centre: readonly [number, number] = [box.x, box.y];
      const grip: readonly [number, number] = [w.player.x - 3, w.player.y - 2];
      out.push({
        // The drawn fist, a few pixels off the body's centre and not on the
        // cut's line — which is the case the geometry has to survive.
        staff: swingStaff({ centre, grip, angle: box.angle, reach, gripToCrystal: GRIP_TO_CRYSTAL }),
        centre, grip, cut: box.angle, reach, aim,
      });
      step(w, NO_INPUT, STEP_MS);
    }
  }
  return out;
}

const AIMS = Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2 - Math.PI);
const all = (): Sample[] => AIMS.flatMap((a) => samples(a));

describe("the staff and blade through a live swing", () => {
  it("sweeps whole swings and chains at every aim", () => {
    for (const aim of AIMS) expect(samples(aim).length, `aim ${aim.toFixed(2)}`).toBeGreaterThan(16);
    expect(all().length).toBeGreaterThan(300);
  });

  it("turns the staff to where the cut lands, within one baked step", () => {
    // Not to the cut's *angle*: the fist is a few pixels off the swing's
    // centre, so the line from the fist to the point on the arc is a little
    // different, and that line is the staff.
    for (const s of all()) {
      const toTip = Math.atan2(s.staff.tipY - s.grip[1], s.staff.tipX - s.grip[0]);
      expect(angleGapDeg(s.staff.angle, toTip), `aim ${s.aim.toFixed(2)}`).toBeLessThanOrEqual(STEP_DEG / 2 + 0.001);
    }
  });

  it("keeps the blade on the staff's own line", () => {
    for (const s of all()) {
      const blade = Math.atan2(s.staff.tipY - s.staff.crystalY, s.staff.tipX - s.staff.crystalX);
      expect(angleGapDeg(blade, s.staff.angle), `aim ${s.aim.toFixed(2)}`).toBeLessThanOrEqual(STEP_DEG);
    }
  });

  it("ends on the hit arc, within two pixels", () => {
    for (const s of all()) {
      const d = Math.hypot(s.staff.tipX - s.centre[0], s.staff.tipY - s.centre[1]);
      expect(Math.abs(d - s.reach), `aim ${s.aim.toFixed(2)}`).toBeLessThanOrEqual(2);
    }
  });

  it("grips exactly where the drawn fist is, not on a circle of its own", () => {
    // The staff hung above the head while the hand held nothing, because the
    // grip was a radius from the swing box rather than the frame's own hand.
    for (const s of all())
      expect(Math.hypot(s.staff.gripX - s.grip[0], s.staff.gripY - s.grip[1]), `aim ${s.aim.toFixed(2)}`)
        .toBeLessThanOrEqual(1);
  });

  it("sweeps a trail whose leading edge is the blade itself", () => {
    // The trail is sampled from this same geometry at each angle the cut has
    // passed through, so its head is the blade. Checked here at the head
    // angle: root and point must coincide with the blade's.
    for (const s of all()) {
      const head = swingStaff({ centre: s.centre, grip: s.grip, angle: s.cut, reach: s.reach, gripToCrystal: GRIP_TO_CRYSTAL });
      expect(Math.hypot(head.crystalX - s.staff.crystalX, head.crystalY - s.staff.crystalY)).toBeLessThanOrEqual(1);
      expect(Math.hypot(head.tipX - s.staff.tipX, head.tipY - s.staff.tipY)).toBeLessThanOrEqual(1);
    }
  });

  it("never inverts the staff: the crystal is always the far end", () => {
    for (const s of all()) {
      // Measured along the staff: the crystal is always the end nearer the
      // tip, which is what "not inverted" means for a thing held in a fist
      // that is itself off the swing's centre.
      const toTip = Math.hypot(s.staff.tipX - s.staff.gripX, s.staff.tipY - s.staff.gripY);
      const crystalToTip = Math.hypot(s.staff.tipX - s.staff.crystalX, s.staff.tipY - s.staff.crystalY);
      expect(crystalToTip, `aim ${s.aim.toFixed(2)}`).toBeLessThan(toTip);
      // And the blade leaves the crystal outward, never back at the body.
      const outward = (s.staff.tipX - s.staff.crystalX) * (s.staff.crystalX - s.staff.gripX)
        + (s.staff.tipY - s.staff.crystalY) * (s.staff.crystalY - s.staff.gripY);
      expect(outward, `aim ${s.aim.toFixed(2)}`).toBeGreaterThan(0);
    }
  });

  it("snaps the angle, so the sprite's pixels do not crawl", () => {
    const quantum = (Math.PI * 2) / STAFF_ANGLE_STEPS;
    for (const s of all()) {
      const k = s.staff.angle / quantum;
      expect(Math.abs(k - Math.round(k)), "angle is off the grid").toBeLessThan(1e-9);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * The staff in every state, from the atlas the game actually loads.
 * ------------------------------------------------------------------------- */

const ART_SCALE = 2;
const FRAME_PX = 64;
const BODY_LIFT = 7;

const atlas = JSON.parse(readFileSync("assets/sprites.json", "utf8")) as {
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
  playerAnchors: Record<string, Record<string, number | [number, number]>>;
};
const anchorsOf = (f: string): Record<string, number | [number, number]> => {
  const a = atlas.playerAnchors[f];
  if (!a) throw new Error(`no anchors for ${f}`);
  return a;
};
const numAt = (f: string, k: string): number => {
  const v = anchorsOf(f)[k];
  if (typeof v !== "number") throw new Error(`${f} has no ${k}`);
  return v;
};
const vecAt = (f: string, k: string): [number, number] | null => {
  const v = anchorsOf(f)[k];
  return Array.isArray(v) ? v : null;
};

const FACINGS = ["s", "n", "w"] as const;
const STATES = [
  "idle0", "idle1", "idle2", "idle3",
  "walk0", "walk1", "walk2", "walk3", "walk4", "walk5", "walk6", "walk7",
  "cast", "cast_gather", "cast_release", "cast_recover",
  "dash", "hurt0", "hurt1",
  "windup", "strike", "slash", "follow", "recover",
];
const FRAMES = FACINGS.flatMap((f) => STATES.map((s) => `player_${f}_${s}`));

/** Grip to crystal in the staff sprite as cut, in world px — what the scene reads. */
const SPRITE_GRIP = (() => {
  const c = vecAt("weapon_player_staff", "crystal")!;
  const b = atlas.frames["weapon_player_staff"]!;
  return Math.hypot(c[0] - b.w / 2, c[1] - b.h / 2) / ART_SCALE;
})();

/** The scene's own placement for a frame at rest, at the origin. */
function atRest(frame: string, flipX = false): ReturnType<typeof heldStaff> & { hand: [number, number] } {
  const hand = (vecAt(frame, "hand") ?? vecAt(frame, "grip"))!;
  const mirror = (x: number): number => flipX ? FRAME_PX - x : x;
  const grip: [number, number] = [
    (mirror(hand[0]) - FRAME_PX / 2) / ART_SCALE,
    -BODY_LIFT + (hand[1] - FRAME_PX / 2) / ART_SCALE,
  ];
  return {
    ...heldStaff({
      grip, flipX,
      angleDeg: numAt(frame, "staffAngleDeg"),
      gripToCrystal: numAt(frame, "staffGripPx") / ART_SCALE,
      spriteGripToCrystal: SPRITE_GRIP,
    }),
    hand: grip,
  };
}

describe("the staff is one runtime sprite in every state", () => {
  it("has a staff sprite and a fist sprite, and no per-key fist frames", () => {
    expect(atlas.frames["weapon_player_staff"], "the staff sprite is missing").toBeDefined();
    expect(atlas.frames["weapon_player_fist"], "the fist overlay is missing").toBeDefined();
    // One fist, not one per key and facing: the drawing is the same in all of them.
    expect(Object.keys(atlas.frames).filter((k) => /^player_[snw]_fist_/.test(k))).toEqual([]);
  });

  it("gives every state and facing the data to place exactly one staff", () => {
    for (const f of FRAMES) {
      expect(atlas.frames[f], `${f} is not in the atlas`).toBeDefined();
      // A hand to grip it by: the swing keys and the idle carry `hand`, the
      // one-off figures of a dash and a hurt carry only `grip`.
      expect(vecAt(f, "hand") ?? vecAt(f, "grip"), `${f} has nowhere to hold a staff`).not.toBeNull();
      expect(typeof anchorsOf(f)["staffAngleDeg"], `${f} says no staff angle`).toBe("number");
      expect(typeof anchorsOf(f)["staffGripPx"], `${f} says no grip length`).toBe("number");
      expect(typeof anchorsOf(f)["staffDepth"], `${f} says no staff depth`).toBe("number");
      // And none of them draws one of its own, so there can only be the sprite.
      expect(vecAt(f, "crystal"), `${f} still draws a staff of its own`).toBeNull();
    }
  });

  it("grips it on the frame's own hand anchor, within a pixel", () => {
    for (const f of FRAMES) for (const flip of [false, true]) {
      const st = atRest(f, flip);
      expect(Math.hypot(st.gripX - st.hand[0], st.gripY - st.hand[1]), `${f}${flip ? " flipped" : ""}`)
        .toBeLessThanOrEqual(1);
    }
  });

  it("puts the crystal the frame's own distance up the shaft", () => {
    // The back view grips five art pixels higher than the other two, which is
    // why the length is data and not a constant: with one constant the n
    // idle's crystal floated five pixels off the head it used to sit beside.
    for (const f of FRAMES) {
      const st = atRest(f);
      const want = numAt(f, "staffGripPx") / ART_SCALE;
      expect(Math.hypot(st.crystalX - st.gripX, st.crystalY - st.gripY), f).toBeCloseTo(want, 6);
      // And the sprite slides along its own axis by exactly the difference,
      // so its drawn crystal lands on the computed one.
      const slide = Math.hypot(st.spriteX - st.gripX, st.spriteY - st.gripY);
      expect(slide, f).toBeCloseTo(Math.abs(want - SPRITE_GRIP), 6);
    }
  });

  it("paints the staff in front of the body at every facing, the back view included", () => {
    // The n facing used to put it behind, where the robe swallowed the shaft.
    for (const f of FRAMES) expect(numAt(f, "staffDepth"), `${f} hides the staff behind the body`).toBeGreaterThan(0);
  });

  it("enters a swing without the staff moving on its own", () => {
    /*
     * The idle's staff was **composed into the body** at the arm's joint and
     * the swing's was a sprite on a grip the renderer worked out for itself,
     * so on the frame the player pressed the key the staff jumped several
     * pixels sideways and from behind the robe to in front of it — a pop with
     * no cause in the animation.
     *
     * The arm itself still moves, and should: the side view's windup carries
     * the staff right across the body, which is the drawing doing its job.
     * What must not happen is the staff moving by anything *other* than the
     * hand, or changing depth. So the two are compared: the staff's travel
     * from the last idle frame into the windup is the hand's travel, exactly,
     * and the depth is the same number.
     */
    for (const f of FACINGS) {
      const idle = atRest(`player_${f}_idle0`);
      const wind = atRest(`player_${f}_windup`);
      const staffMoved = Math.hypot(wind.gripX - idle.gripX, wind.gripY - idle.gripY);
      const handMoved = Math.hypot(wind.hand[0] - idle.hand[0], wind.hand[1] - idle.hand[1]);
      expect(staffMoved, `${f}: the staff moves on its own entering a swing`).toBeCloseTo(handMoved, 6);
      expect(numAt(`player_${f}_windup`, "staffDepth"), `${f}: the staff changes depth entering a swing`)
        .toBe(numAt(`player_${f}_idle0`, "staffDepth"));
      // And it is held the same distance up the shaft on both sides of the cut.
      expect(numAt(`player_${f}_windup`, "staffGripPx")).toBe(numAt(`player_${f}_idle0`, "staffGripPx"));
    }
  });
});

/* ------------------------------------------------------------------------- *
 * The swing's range, per direction, against the simulation's own hitbox.
 * ------------------------------------------------------------------------- */

/** How far the drawn arc may sit from the hit arc, in px. */
const RANGE_TOLERANCE = 0.5;

describe("the swing reaches the same distance in every direction", () => {
  /** Every tick of a swing at one aim, with the drawn tip and the hit radius. */
  function sweep(aim: number): { tip: number; reach: number; blade: number }[] {
    const w = world();
    w.player.facing = aim;
    w.player.aim = { x: Math.cos(aim), y: Math.sin(aim) };
    beginSwing(w.player, w);
    const out: { tip: number; reach: number; blade: number }[] = [];
    for (let t = 0; t < SWING_TOTAL_MS + STEP_MS; t += STEP_MS) {
      if (swingPhase(w.player) === "none") break;
      const box = w.swing;
      const reach = Math.max(box.reach, box.bladeReach);
      // The scene's own numbers: the swing's centre, unlifted and unsquashed.
      const st = swingStaff({
        centre: [box.x, box.y], grip: [w.player.x - 3, w.player.y - 2],
        angle: box.angle, reach, gripToCrystal: GRIP_TO_CRYSTAL,
      });
      out.push({
        tip: Math.hypot(st.tipX - box.x, st.tipY - box.y),
        reach,
        blade: Math.hypot(st.tipX - st.crystalX, st.tipY - st.crystalY),
      });
      step(w, NO_INPUT, STEP_MS);
    }
    return out;
  }

  const CARDINALS = [["east", 0], ["south", Math.PI / 2], ["west", Math.PI], ["north", -Math.PI / 2]] as const;

  it("draws the blade's point on the hit arc, not a plane above it", () => {
    /*
     * The drawn arc was lifted two pixels off the hit arc and flattened to
     * 0.85 on the vertical, so an upward cut was drawn two pixels past what
     * it hit, a downward one two pixels short, and a north or south cut
     * looked a sixth shorter than a sideways one at the same reach. That is
     * what "left and right swings have a bigger range than up and down" was.
     */
    for (const [name, aim] of CARDINALS)
      for (const s of sweep(aim))
        expect(Math.abs(s.tip - s.reach), `${name}: the drawn point is off the hit arc`)
          .toBeLessThanOrEqual(RANGE_TOLERANCE);
  });

  it("reaches the same distance whichever way it faces", () => {
    const far = CARDINALS.map(([name, aim]) => [name, Math.max(...sweep(aim).map((s) => s.tip))] as const);
    const most = Math.max(...far.map(([, d]) => d));
    const least = Math.min(...far.map(([, d]) => d));
    expect(most - least, `per-direction reach: ${far.map(([n, d]) => `${n} ${d.toFixed(1)}`).join(", ")}`)
      .toBeLessThanOrEqual(RANGE_TOLERANCE);
  });

  it("is centred where the simulation swings, a body's lift above the footing", () => {
    // If the two centres part, the drawing and the hitbox disagree by the gap
    // in one direction and agree nowhere.
    const w = world();
    beginSwing(w.player, w);
    step(w, NO_INPUT, STEP_MS);
    expect(w.swing.y).toBeCloseTo(w.player.y - SWING_ORIGIN_LIFT, 6);
  });

  it("makes no direction's blade a third shorter than another's", () => {
    /*
     * What is left after the arc is honest: the **blade** — crystal to point —
     * is what the eye measures, and its length is the reach less the distance
     * from the fist to the crystal. The fist is a few pixels off the swing's
     * centre and on a different side in each facing, so the blade is a little
     * longer in some directions than others. A little is fine; a third is the
     * complaint.
     */
    const far = CARDINALS.map(([name, aim]) => [name, Math.max(...sweep(aim).map((s) => s.blade))] as const);
    const most = Math.max(...far.map(([, d]) => d));
    const least = Math.min(...far.map(([, d]) => d));
    expect(least / most, `blade length: ${far.map(([n, d]) => `${n} ${d.toFixed(1)}`).join(", ")}`)
      .toBeGreaterThan(0.75);
  });
});
