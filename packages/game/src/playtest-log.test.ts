import { describe, expect, it } from "vitest";
import { PlaytestRecorder } from "./debug-panel.ts";
import { createWorld, generateRoom, makeEnemy, noMods, plainInstance, RngSource, step, toRoomPlan, NO_INPUT, GRID_W, GRID_H, Tile } from "@jr/core";
import type { World } from "@jr/core";

/** Just enough of a world for `sample` to count a step. */
const world = {
  player: { x: 0, y: 0, swingMs: 0, dashMs: 0, hearts: 6, mods: noMods() },
  stats: { shotsFired: 0, castPresses: 0, castRefusedMana: 0, manaBelowKeyMs: 0, dealtBy: {}, castsBy: {}, manaBy: {} },
  enemyBullets: [], enemies: [], spells: [], events: [], level: 1,
} as unknown as World;

const decision = (question: string, choice: string, source = "jev") => ({
  question, choice, source, confidence: 0.8,
  probabilities: { [choice]: 0.7, other: 0.3, never: 0.001 },
});

describe("the playtest log", () => {
  it("keeps every Director answer against the room it was for, including one decided before that room began", () => {
    const log = new PlaytestRecorder();
    log.startRun({ director: "jev", style: "spam" });
    log.begin("s", 1, "combat");
    log.decide(1, "room", [decision("density", "normal")]);
    log.attach(1, (r) => { r.doors = ["spell:storm", "stat:mana"]; });
    // The next room's pacing is decided on the way out of this one.
    log.decide(2, "doors", [decision("next_tension (advisory)", "peak", "rule")]);
    log.sample(world, 16);
    log.begin("s", 2, "combat");
    log.sample(world, 16);
    const out = JSON.parse(log.json());
    expect(out.run).toEqual({ director: "jev", style: "spam" });
    expect(out.rooms[0].decisions).toEqual([
      { purpose: "room", question: "density", choice: "normal", source: "jev", confidence: 0.8, p: { normal: 0.7, other: 0.3 } },
    ]);
    expect(out.rooms[0].doors).toEqual(["spell:storm", "stat:mana"]);
    expect(out.rooms[1].decisions[0]).toMatchObject({ purpose: "doors", choice: "peak", source: "rule" });
  });

  it("starts over with each run, and leaves out a room no step was played in", () => {
    const log = new PlaytestRecorder();
    log.startRun({ director: "rule", style: "melee" });
    log.begin("a", 1, "combat");
    log.sample(world, 16);
    log.begin("a", 2, "combat");
    log.sample(world, 16);
    log.startRun({ director: "rule", style: "nuke" });
    // The title's backdrop: begun and replaced without a step.
    log.begin("b", 1, "combat");
    log.begin("b", 1, "combat");
    log.sample(world, 16);
    const out = JSON.parse(log.json());
    expect(out.run.style).toBe("nuke");
    expect(out.rooms).toHaveLength(1);
  });

  it("keeps what balance is read from for the session, and writes storage the lean record", () => {
    const store = new Map<string, string>();
    const was = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    try {
      const src = new RngSource("log");
      const g = generateRoom(
        { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
        "S", "combat", src.stream("room"), { plain: true },
      );
      const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
      const grid = built.grid.slice();
      for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
      const w = createWorld({
        room: { ...built, grid, zones: [] }, encounter: null, props: 0, staff: { slots: 6, mana_max: 200 },
        slots: [plainInstance("magic_bolt"), null, null, null, null, null], hearts: 6, rng: src.stream("w"),
      });
      w.player.x = 300; w.player.y = 300; w.player.facing = 0;
      const e = makeEnemy(w.nextEnemyId++, "rusher", 322, 300, []);
      e.spawnFadeMs = 0; e.awake = true; e.speed = 0; e.attackCooldownMs = 1e9;
      w.enemies.push(e);
      const log = new PlaytestRecorder();
      log.startRun({ director: "rule", style: "melee" });
      log.begin("s", 1, "combat");
      for (let t = 0; t < 400 && w.enemies.length > 0; t++) {
        step(w, { ...NO_INPUT, aimX: 400, aimY: 300, swing: true });
        w.player.hearts = 6;
        log.sample(w, 16);
      }
      log.begin("s", 2, "combat");
      const room = JSON.parse(log.json()).rooms[0];
      expect(room.build.spells).toEqual([{ key: 0, id: "magic_bolt", level: 1, affixes: [] }]);
      expect(room.hp.max).toBeGreaterThan(0);
      expect(room.dealtBy.sword).toBeGreaterThan(0);
      expect(room.killTime.rusher.n).toBe(1);
      expect(room.killTime.rusher.maxMs).toBeGreaterThan(0);
      // Storage keeps the lean record: none of the balance fields.
      const saved = JSON.parse(store.get("jr-playtest-log")!)[0];
      for (const k of ["build", "hp", "dealtBy", "castsBy", "manaBy", "killTime", "statuses"]) expect(saved[k], k).toBeUndefined();
      expect(saved.kills).toBe(1);
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = was;
    }
  });
});
