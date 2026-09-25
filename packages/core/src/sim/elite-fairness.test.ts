import { describe, expect, it } from "vitest";
import { createWorld, step } from "./world.ts";
import { NO_INPUT, PLAYER_SPEED } from "./types.ts";
import type { Enemy, Input, World } from "./types.ts";
import { ROSTER_SPEED_CEILING, makeEnemy, wake } from "./enemy.ts";
import { MELEE_ATTACKS } from "./melee.ts";
import {
  AFFIXES, ELITE_AFFIX_IDS, ELITE_DAMAGE, ELITE_HP, ELITE_REST, ELITE_SPEED,
  ENEMIES, ENEMY_IDS, affixContext, affixStats, affixesFor,
} from "../encounters/index.ts";
import type { EliteAffix } from "../types.ts";
import { GRID_W, GRID_H, Tile } from "../types.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";

/**
 * **The elite tier's fairness table** (doc 019, "The elite rework").
 *
 * Doc 019 makes one promise about elites, and every other number in the tier
 * depends on it: *an elite is answered with the moves the player already
 * learned*. Health, damage and speed may move, because none of them changes
 * what the answer to an attack is; a **tell may not**, because a tell is the
 * question.
 *
 * So this file enumerates every timing that is a tell and asserts an elite's
 * equals its base's — **behaviourally, out of the sim**, rather than by reading
 * the constants it is supposed to be guarding. That distinction is the whole
 * point of the file. What it was written to catch was `ENRAGED_INTERVAL`,
 * which divided the pattern clock three call sites away from any constant a
 * reader would think to check, and `swift`, which multiplied the same clock by
 * 0.8 on top — so an elite ran the cadence the player had learned at 0.68.
 */

const src = new RngSource("elite-fairness");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("room"), { plain: true },
);
const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
const grid = built.grid.slice();
for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
const room = { ...built, grid };

const idle: Input = NO_INPUT;

/**
 * A world off a **fixed seed**, so two of them run the same draws.
 *
 * That is what lets a base and an elite be compared exactly: every windup,
 * rest and aim in the roster wanders a twelfth either way, and against the
 * same stream the two bodies draw the same jitter — so any difference in a
 * tell is the affix, not the noise.
 */
function world(): World {
  const w = createWorld({
    room, encounter: null, props: 0,
    staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), null, null],
    hearts: 6, rng: new RngSource("fairness-fixed").stream("w"),
    roomIndex: 12,
  });
  w.player.x = 320;
  w.player.y = 208;
  return w;
}

function body(w: World, id: Parameters<typeof makeEnemy>[1], affixes: EliteAffix[] = []): Enemy {
  const e = makeEnemy(w.nextEnemyId++, id, w.player.x + 120, w.player.y, affixes);
  e.spawnFadeMs = 0;
  w.enemies.push(e);
  wake(w, e);
  return e;
}

/**
 * The three fields a tell lives in, and the only three: a melee body holds its
 * gather in `windupMs`, a shooting body its aim in `telegraphMs`, and every
 * non-projectile cast — the musket's raise, the rift's growth, the hook's lie,
 * the peal's swell, the seed's prime — holds the body in a pose for `poseMs`.
 */
const TELL_FIELDS = ["windupMs", "telegraphMs", "poseMs"] as const;

/**
 * Every tell a body arms over a fight, per field, in ms.
 *
 * **Distributions, not sequences.** Every windup, rest and aim in the roster
 * wanders a twelfth either way, drawn from the room's stream — so a body that
 * rests less reaches its next tell at a different moment, consumes different
 * draws, and lands on different jitter. Comparing the two lists element by
 * element measures that desync and nothing else; what the contract is actually
 * about is whether the *durations an elite arms* are the durations its base
 * arms, which is a question about their distributions.
 */
function tellsOf(id: Parameters<typeof makeEnemy>[1], affixes: EliteAffix[]): Record<string, number[]> {
  const w = world();
  const e = body(w, id, affixes);
  const seen: Record<string, number[]> = {};
  const held: Record<string, number> = {};
  for (let t = 0; t < 14_000; t += 1000 / 60) {
    step(w, idle);
    for (const f of TELL_FIELDS) {
      const v = (e as unknown as Record<string, number>)[f] ?? 0;
      // Recorded when it is armed, at the duration it was armed for — not as
      // it counts down.
      if (v >= 1 && v > (held[f] ?? 0)) (seen[f] ??= []).push(v);
      held[f] = v;
    }
    if (e.hp <= 0) break;
  }
  return seen;
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The reaction floor every telegraph in the game is sized against (doc 005). */
const REACTION_FLOOR_MS = 260;

describe("what an elite is (doc 019)", () => {
  it("is exactly the stat table the doc sets", () => {
    expect(ELITE_HP).toBe(2);
    expect(ELITE_DAMAGE).toBe(1.3);
    expect(ELITE_SPEED).toBe(1.15);
    expect(ELITE_REST).toBe(0.85);
  });

  it("builds every body as twice the health, a third more damage, a seventh more speed", () => {
    for (const id of ENEMY_IDS) {
      const base = makeEnemy(1, id, 0, 0, []);
      const elite = makeEnemy(2, id, 0, 0, ["volatile"]);
      expect(elite.maxHp, `${id} health`).toBeCloseTo(base.maxHp * 2, 5);
      // ×1.15, or the roster's speed ceiling where that would pass it.
      expect(elite.speed, `${id} speed`)
        .toBeCloseTo(Math.min(base.speed * 1.15, PLAYER_SPEED * ROSTER_SPEED_CEILING), 5);
      expect(elite.damageMult, `${id} damage`).toBeCloseTo(1.3, 5);
      expect(base.damageMult, `${id} is not elite`).toBe(1);
    }
  });

  it("never lets an elite outrun a retreat", () => {
    /*
     * Doc 005's roster rule — the fastest body stays under 0.88 of the
     * player's walk — is what makes disengaging possible, and the enrage is
     * capped by it rather than allowed through it. This test found that ×1.15
     * on the lancer's 104 is 119.6 against a player at 120, which is a body
     * you cannot walk away from.
     */
    for (const id of ENEMY_IDS) {
      for (const affix of ELITE_AFFIX_IDS) {
        const elite = makeEnemy(1, id, 0, 0, [affix]);
        expect(elite.speed, `${id} + ${affix}`)
          .toBeLessThanOrEqual(PLAYER_SPEED * ROSTER_SPEED_CEILING + 1e-6);
      }
    }
  });

  it("has no affix that adds speed: the enrage's 1.15 is the whole of it", () => {
    for (const id of ELITE_AFFIX_IDS) expect(AFFIXES[id].speed_mult, id).toBe(1);
  });

  it("lengthens the bar once: `armored` is armour, not more health", () => {
    expect(AFFIXES.armored.hp_mult).toBe(1);
    const armoured = makeEnemy(1, "shooter", 0, 0, ["armored"]);
    const plain = makeEnemy(2, "shooter", 0, 0, ["volatile"]);
    expect(armoured.maxHp).toBeCloseTo(plain.maxHp, 5);
    expect(armoured.maxArmour).toBeGreaterThan(plain.maxArmour);
  });

  it("never raises a commit speed: a ram is the ram the player learned", () => {
    // No affix reads a melee spec at all, which is the strongest form of this:
    // the table is shared and constant, so a charge crosses the same ground.
    for (const spec of Object.values(MELEE_ATTACKS)) {
      expect(spec.commitSpeed).toBe(MELEE_ATTACKS[spec.kind].commitSpeed);
    }
    const elite = makeEnemy(1, "tank", 0, 0, ["swift"]);
    const base = makeEnemy(2, "tank", 0, 0, []);
    expect(elite.speed / base.speed).toBeCloseTo(1.15, 5);
  });
});

describe("one affix, legal for that body (doc 019)", () => {
  const ctx = affixContext(6, { rooms: [], shielded_rooms: 0 }, false);

  it("gives an elite exactly one, and never an excluded one", () => {
    for (const id of ENEMY_IDS) {
      for (let seed = 0; seed < 40; seed++) {
        const rng = { next: () => ((seed * 37) % 100) / 100 };
        const set = affixesFor(id, ctx, rng);
        expect(set, `${id}`).toHaveLength(1);
        expect(ENEMIES[id].affix_excluded ?? [], `${id}`).not.toContain(set[0]);
      }
    }
  });

  it("excludes what would be unreadable or unfair", () => {
    // A second death burst on a body that already bursts.
    expect(ENEMIES.lancer.affix_excluded).toContain("volatile");
    expect(ENEMIES.sower.affix_excluded).toContain("volatile");
    // A second fire nobody can see on top of the first.
    expect(ENEMIES.beacon.affix_excluded).toContain("burning");
    expect(ENEMIES.emberling.affix_excluded).toContain("burning");
    // Doc 001: never nullify the stated answer to a body.
    expect(ENEMIES.emberling.affix_excluded).toContain("shielded");
    // A body that makes bodies must not make more when it dies.
    expect(ENEMIES.summoner.affix_excluded).toContain("splitting");
    expect(ENEMIES.brooder.affix_excluded).toContain("splitting");
  });
});

describe("no telegraph is ever shortened (doc 019)", () => {
  /*
   * The headline test. Everything else in the tier is a number; this is the
   * promise those numbers are allowed to be made under.
   */
  const SAMPLE = ["rusher", "lancer", "shooter", "pinner", "turret", "warden",
    "rifter", "snarecaster", "bellringer", "sower", "delver", "tank"] as const;

  it("arms every tell at the duration its base does, for every legal affix", () => {
    for (const id of SAMPLE) {
      const base = tellsOf(id, []);
      expect(Object.keys(base).length, `${id} showed no tell at all`).toBeGreaterThan(0);
      for (const affix of ELITE_AFFIX_IDS) {
        if ((ENEMIES[id].affix_excluded ?? []).includes(affix)) continue;
        const elite = tellsOf(id, [affix]);
        for (const [field, baseTells] of Object.entries(base)) {
          const eliteTells = elite[field];
          expect(eliteTells, `${id} + ${affix} stopped arming ${field}`).toBeTruthy();
          /*
           * A **band**, not a point, and the width is chosen against what it
           * has to catch.
           *
           * Two things move a mean here that are not a shortened tell: the
           * jitter is a twelfth either way, and a body that rests less gets
           * through a different *mixture* of its poses in the same fourteen
           * seconds — a snarecaster that hooks more often lashes more often
           * too, and a lash is the shorter pose. Neither is a tell changing
           * length.
           *
           * What the test exists to catch is a **multiplier**, and the two
           * that were there were 0.85 and 0.8. A twelfth of slack passes the
           * noise and fails either of them by a wide margin.
           */
          const ratio = mean(eliteTells!) / mean(baseTells);
          expect(ratio, `${id} + ${affix} moved ${field}`).toBeGreaterThan(0.88);
          expect(ratio, `${id} + ${affix} moved ${field}`).toBeLessThan(1.12);
          // And the absolute floor, which no tempo, jitter or affix may cross.
          expect(Math.min(...eliteTells!), `${id} + ${affix} ${field} floor`)
            .toBeGreaterThanOrEqual(REACTION_FLOOR_MS - 1);
        }
      }
    }
  });

  /*
   * **Bodies whose only attack is fired.**
   *
   * `swift` is `rest_mult`, and `rest_mult` divides the clock a *firing*
   * pattern runs on (`fire`). It does not reach `restAfter`, which is the
   * pause after a melee turn — so on a body that carries both, the count is
   * dominated by the blade the affix does not touch and the comparison
   * measures desync. The warden was in this list and is exactly that body: a
   * musket every 4.2 s behind a bash, so in fourteen seconds nearly every tell
   * it arms is the bash's, and which way the count fell was luck. The three
   * here fire and nothing else.
   */
  it("presses on the rest between turns, and only there", () => {
    for (const id of ["shooter", "orbiter", "rifter"] as const) {
      const base = tellsOf(id, []);
      const elite = tellsOf(id, ["swift"]);
      const count = (t: Record<string, number[]>) => Object.values(t).reduce((n, xs) => n + xs.length, 0);
      // The same questions, asked more often: that is the whole of what the
      // enrage and `swift` buy.
      expect(count(elite), `${id} did not press harder`).toBeGreaterThan(count(base));
    }
  });

  /**
   * The structural half: no multiplier an affix carries can reach a tell,
   * because the only one it carries is on the rest. Measuring is what catches
   * a multiplier applied somewhere the author forgot to name; this is what
   * catches one being *added*.
   */
  it("exposes no multiplier that a tell could read", () => {
    const stats = affixStats(["swift"]);
    expect(Object.keys(stats).sort())
      .toEqual(["armour", "damage_mult", "hp_mult", "rest_mult", "speed_mult"]);
  });

  it("is what `affixStats` says it is, so the two cannot drift apart", () => {
    expect(affixStats([]).rest_mult).toBe(1);
    expect(affixStats(["volatile"]).rest_mult).toBe(ELITE_REST);
    expect(affixStats(["swift"]).rest_mult).toBeCloseTo(ELITE_REST * 0.8, 6);
  });
});
