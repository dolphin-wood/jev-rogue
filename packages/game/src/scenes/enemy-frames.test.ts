/**
 * Every frame name the enemy renderer can ask for must exist in the sheet.
 *
 * This test exists because of one bug, and it is the kind that only a test
 * like this catches. Phaser answers a request for a missing frame with the
 * texture's *first* frame, and the first frame in this sheet is a 256 px boss
 * — so a single wrong name draws a boss in the middle of a fight instead of
 * drawing nothing. It is silent, it is enormous, and no type checks it.
 *
 * So rather than assert the naming scheme, this enumerates the whole product
 * of archetype, pose and facing and checks each against the real atlas.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ENEMIES } from "@jr/core";
import type { EnemyId } from "@jr/core";
import { strideFor, enemyFrame, frameForFacing } from "./enemy-frames.ts";
import type { FramedEnemy } from "./enemy-frames.ts";

const sheet = JSON.parse(readFileSync(new URL("../../../../assets/sprites.json", import.meta.url), "utf8")) as {
  frames: Record<string, unknown>;
};
const has = (n: string): boolean => n in sheet.frames;

/** What the play scene maps archetypes to. Kept in step by the test below. */
const ENEMY_FRAME: Record<EnemyId, string> = {
  rusher: "enemy_rusher", shooter: "enemy_shooter", turret: "enemy_turret",
  orbiter: "enemy_orbiter", tank: "enemy_tank", summoner: "enemy_summoner",
  lancer: "enemy_lancer", sentinel: "enemy_sentinel",
  warden: "enemy_warden", bellringer: "enemy_bellringer", rifter: "enemy_rifter",
  snarecaster: "enemy_snarecaster", delver: "enemy_delver", cinderling: "enemy_cinderling", sower: "enemy_sower",
  // Undirected and three-phase, like the turret is undirected.
  boss: "boss_p1",
};

const FACINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, 2.4, 4.0, 5.6];
const PHASES = ["approach", "windup", "lunge", "recover"];

function enemy(over: Partial<FramedEnemy>): FramedEnemy {
  return {
    awake: true, roused: true, radius: 10, brakeMs: 0, recoversBraced: false,
    stationary: false, speed: 92,
    attack: "approach", hitFlashMs: 0, telegraphMs: 0,
    vx: 0, vy: 0, travelled: 0, facing: 0, ...over,
  };
}

describe("enemy frame naming", () => {
  it("keeps every walk cycle above the rate that reads as motion", () => {
    // The failure this guards is a slideshow, and it does not announce itself:
    // the tank ran four perfectly good drawn frames at 3 fps and was reported
    // as being hard to see while moving.
    for (const id of Object.keys(ENEMIES) as EnemyId[]) {
      const { speed, radius } = ENEMIES[id];
      if (speed === 0) continue;
      const fps = speed / strideFor(radius, speed);
      expect(fps, `${id} walk cycle`).toBeGreaterThanOrEqual(8);
    }
  });

  it("still takes the stride from the body's size where the speed allows it", () => {
    // The floor is a floor, not a replacement: a rusher and a tank must not
    // end up walking at the same rate, or the weights go with the slideshow.
    expect(strideFor(ENEMIES.rusher.radius, ENEMIES.rusher.speed)).toBeCloseTo(8, 5);
    expect(strideFor(ENEMIES.tank.radius, ENEMIES.tank.speed)).toBeLessThan(14 * 0.8);
  });

  it("covers every archetype in the roster", () => {
    expect(Object.keys(ENEMY_FRAME).sort()).toEqual(Object.keys(ENEMIES).sort());
  });

  it("never asks the sheet for a frame it does not have", () => {
    const missing: string[] = [];
    for (const id of Object.keys(ENEMIES) as EnemyId[]) {
      const base = ENEMY_FRAME[id];
      for (const facing of FACINGS)
        for (const attack of PHASES)
          for (const awake of [true, false])
            for (const hitFlashMs of [0, 90])
              for (const roused of [true, false])
              for (const brakeMs of [0, 120])
              for (const recoversBraced of [true, false])
              for (const telegraphMs of [0, 200])
              for (const stationary of [true, false])
                for (const moving of [true, false])
                  // Four walk frames and two idle frames, so the tick and the
                  // distance both have to be swept to reach every branch.
                  for (const travelled of [0, 22, 44, 66, 88])
                    for (const tick of [0, 1, 2, 3, 14, 15, 28]) {
                      const e = enemy({
                        awake, roused, brakeMs, recoversBraced, attack, hitFlashMs,
                        telegraphMs, stationary, facing, travelled,
                        vx: moving ? 80 : 0,
                      });
                      const { name } = enemyFrame(e, tick, has, base);
                      if (!has(name)) missing.push(`${id}: ${name}`);
                    }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("draws the turret from its one undirected frame", () => {
    // The archetype that found the bug: it has no facings, so a directional
    // name for it is exactly the mistake that rendered a boss.
    for (const facing of FACINGS) {
      const { name, flipX } = enemyFrame(enemy({ facing, roused: true }), 0, has, "enemy_turret");
      expect(name).toMatch(/^enemy_turret_(dormant|dormant1|idle0|idle1)$/);
      expect(flipX).toBe(false);
    }
  });

  it("reads an emplacement's three states from three different drawings", () => {
    // Unaware, live, and firing must not be the same picture: a turret cannot
    // tell the player it has woken up by walking at them.
    const at = (over: Partial<FramedEnemy>): string =>
      enemyFrame(enemy({ stationary: true, ...over }), 0, has, "enemy_turret").name;

    const scanning = at({ awake: false });
    const live = at({ awake: true });
    const firing = at({ awake: true, telegraphMs: 200 });

    expect(scanning).toMatch(/^enemy_turret_dormant1?$/);
    expect(live).toBe("enemy_turret_tele");
    // Firing shares the pose and is separated by the renderer's red flash,
    // which is the one state that may reuse a drawing.
    expect(firing).toBe(live);
    expect(live).not.toBe(scanning);
  });

  it("animates an emplacement's lit state from its own drawn pair", () => {
    /*
     * The live state has to *move*, and it has to move without changing what
     * it says. `tele` and `tele1` are two frames of one lit pose, so the pair
     * animates; alternating `tele` with an idle frame would flick between
     * magenta and cyan, which reads as two states fighting rather than as one
     * motion. That was the shape of an earlier attempt and is why the second
     * lit frame was asked for.
     *
     * Before it arrived the renderer faked the motion with an additive copy of
     * the same frame at a pulsing alpha. The frame exists now and the hack is
     * gone.
     */
    const seen = new Set<string>();
    for (const tick of [0, 1, 12, 23, 24, 47, 48, 71])
      seen.add(
        enemyFrame(enemy({ stationary: true, awake: true }), tick, has, "enemy_turret").name,
      );
    expect([...seen].sort()).toEqual(["enemy_turret_tele", "enemy_turret_tele1"]);
  });

  it("leaves a body that can move to announce itself by moving", () => {
    // The rule is about emplacements, not about being awake. A mobile body
    // with a `tele` drawing must keep it for its actual telegraph.
    const walking = enemyFrame(
      enemy({ stationary: false, awake: true, vx: 80, travelled: 0, radius: 9 }),
      0, has, "enemy_shooter",
    ).name;
    expect(walking).toBe("enemy_shooter_w_walk0");
  });

  it("shows a struck pose for every body that has one drawn", () => {
    /*
     * `hit0`/`hit1` were the tank's alone and are now drawn for the whole
     * roster, which is what this asserts — but the assertion is written
     * against **the sheet**, not against a list of archetypes, because the
     * original test hard-coded "the tank and nobody else" and silently became
     * a test that the new art was *not* being used.
     *
     * A hit now interrupts what an enemy was doing, so a body that visibly
     * reels is carrying real information rather than decoration.
     */
    for (const id of Object.keys(ENEMIES) as EnemyId[]) {
      const base = ENEMY_FRAME[id];
      const { name } = enemyFrame(enemy({ hitFlashMs: 90 }), 0, has, base);
      const drawn = has(`${base}_hit0`) || has(`${base}_s_hit0`);
      expect({ id, reels: name.includes("hit") }).toEqual({ id, reels: drawn });
      expect(has(name)).toBe(true);
    }
  });

  it("only admits a pose when every facing of it is drawn", () => {
    // A fully drawn idle, and a windup that exists only facing south. The
    // windup must be declined rather than drawn for the two facings that were
    // never illustrated — which is the mistake that reached the screen.
    const drawn = new Set(["fake_s_idle0", "fake_n_idle0", "fake_w_idle0",
                           "fake_s_idle1", "fake_n_idle1", "fake_w_idle1",
                           "fake_s_windup"]);
    const partial = (n: string): boolean => drawn.has(n);
    for (const facing of FACINGS) {
      const { name } = enemyFrame(enemy({ attack: "windup", facing }), 0, partial, "fake");
      expect(name).not.toContain("windup");
      expect(partial(name)).toBe(true);
    }
  });

  it("resolves a kill silhouette the same way, at the facing it died on", () => {
    for (const facing of FACINGS) {
      const { name } = frameForFacing("enemy_rusher", "idle0", facing, has);
      expect(has(name)).toBe(true);
    }
    expect(frameForFacing("enemy_turret", "idle0", 0, has).name).toBe("enemy_turret_idle0");
  });
});
