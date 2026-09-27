/**
 * The drop-in (doc 022): every promise the document makes about the moment
 * the roof gives on room 5, asserted over many seeds and player positions.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step, worldCleared } from "./world.ts";
import { MAX_HEARTS, NO_INPUT, PLAYER_RADIUS } from "./types.ts";
import type { World } from "./types.ts";
import { WORLD_H, WORLD_W } from "./collide.ts";
import { AUDIENCE_TRIGGER_MS, CRASH_HEARTS_SPARE, KING_DROP_MIN_PX } from "./audience.ts";
import { PICKUP_LIFETIME_MS } from "./pickups.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import type { EncounterPlan } from "../types.ts";

function room(seed: string) {
  const src = new RngSource(seed);
  const g = generateRoom(
    { space: "open_arena", symmetry: "mirrored", size: "compact", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "combat", src.stream("room"), { plain: true },
  );
  return toRoomPlan(g, { id: "r", seed_key: seed, reward_kind: "item", params_source: "rule" });
}

const encounter: EncounterPlan = {
  profile: { composition: "mixed", density: "sparse", wave_structure: "steady", anchor: "none", entry: "far_front" },
  waves: [
    { at_ms: 0, spawns: [{ archetype: "rusher", spawn_group: "far", count: 3 }, { archetype: "shooter", spawn_group: "flank_l", count: 2 }] },
    { at_ms: 4000, spawns: [{ archetype: "rusher", spawn_group: "far", count: 3 }] },
  ],
  measured_pressure: 2, band: [1, 3], elite_affixes: [], source: "rule",
};

function audienceWorld(seed: string, hearts = 3, props = 6): World {
  return createWorld({
    room: room(seed), encounter, props, staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), null, null, null, null, null], hearts,
    rng: new RngSource(seed).stream("world"), roomIndex: 5, audience: true,
    viewHalf: { x: WORLD_W, y: WORLD_H },
  });
}

interface Watch { stoneOverPlayer: boolean; bodyTouching: boolean; kingAt: { x: number; y: number } | null; playerAtDrop: { x: number; y: number } | null; xp: number; hurtBefore: number }

/** Runs the room with the player standing still until the king has stood up, recording what the document forbids. */
function runDrop(w: World, maxSteps = 60 * 30): Watch {
  const watch: Watch = { stoneOverPlayer: false, bodyTouching: false, kingAt: null, playerAtDrop: null, xp: w.xp, hurtBefore: 0 };
  // Nobody in the way of the test: the player stands, and cannot be hurt by the opening stretch's bodies.
  for (let i = 0; i < maxSteps; i++) {
    step(w, NO_INPUT);
    const p = w.player;
    for (const r of w.rifts)
      if (r.rock && r.teleMs > 0 && Math.hypot(r.x - p.x, r.y - p.y) < r.width / 2 + PLAYER_RADIUS) watch.stoneOverPlayer = true;
    for (const ev of w.events) {
      if (ev.what === "audience_drop") { watch.kingAt = { x: ev.x, y: ev.y }; watch.playerAtDrop = { x: p.x, y: p.y }; }
      if (ev.what === "rockfall")
        for (const e of w.enemies)
          if (e.archetype !== "boss" && e.hp > 0 && Math.hypot(e.x - p.x, e.y - p.y) <= e.radius + PLAYER_RADIUS) watch.bodyTouching = true;
    }
    const king = w.enemies.find((e) => e.archetype === "boss");
    if (king && !king.bossEntrance && king.bossCast === "none") break;
  }
  return watch;
}

describe("the drop-in: the roof gives", () => {
  it("waits for one kill, or for the opening stretch to run out, and the room is never clear before him", () => {
    const w = audienceWorld("wait");
    for (let i = 0; i < Math.floor(AUDIENCE_TRIGGER_MS / (1000 / 60)) - 5; i++) {
      step(w, NO_INPUT);
      expect(w.cleared).toBe(false);
    }
    expect(w.audience!.phase).toBe("setup");
    for (let i = 0; i < 10; i++) step(w, NO_INPUT);
    expect(w.audience!.phase).not.toBe("setup");
  });

  it("gives at the first kill", () => {
    const w = audienceWorld("kill");
    for (let i = 0; i < 240 && !w.enemies.some((e) => e.hp > 0 && e.spawnFadeMs <= 0); i++) step(w, NO_INPUT);
    const body = w.enemies.find((e) => e.hp > 0 && e.spawnFadeMs <= 0)!;
    body.hp = 0;
    // The kill's hitstop holds the world a few frames; the roof gives as soon as it lets go.
    for (let i = 0; i < 12 && w.audience!.phase === "setup"; i++) step(w, NO_INPUT);
    expect(w.audience!.phase).toBe("rumble");
    // The later waves never come.
    expect(w.pendingWaves).toHaveLength(0);
  });

  it("crushes every body under a stone of its own, none over the player, none touching them, and pays no experience", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const w = audienceWorld(seed);
      // Let the bodies close in on the player first, the hardest case for the stones.
      const watch = runDrop(w);
      expect(watch.stoneOverPlayer, seed).toBe(false);
      expect(watch.bodyTouching, seed).toBe(false);
      expect(w.xp, seed).toBe(watch.xp);
      expect(w.enemies.filter((e) => e.archetype !== "boss"), seed).toHaveLength(0);
    }
  });

  it("brings the king down at least eight tiles from the player, hurting nobody", () => {
    for (const seed of ["g", "h", "i", "j"]) {
      const w = audienceWorld(seed);
      const watch = runDrop(w);
      expect(watch.kingAt, seed).not.toBeNull();
      const d = Math.hypot(watch.kingAt!.x - watch.playerAtDrop!.x, watch.kingAt!.y - watch.playerAtDrop!.y);
      expect(d, seed).toBeGreaterThanOrEqual(KING_DROP_MIN_PX);
      expect(w.shockwaves, seed).toHaveLength(0);
      expect(w.enemies.filter((e) => e.archetype === "boss"), seed).toHaveLength(1);
    }
  });
});

describe("the drop-in: the hearts", () => {
  it("fills the bar and leaves exactly the spare on the floor, which a full bar does not take and time does not spoil", () => {
    for (const seed of ["k", "l", "m"]) {
      const w = audienceWorld(seed, 2);
      runDrop(w);
      // The pulled hearts may still be in flight when he stands; give them a moment.
      for (let i = 0; i < 90; i++) step(w, NO_INPUT);
      const max = MAX_HEARTS + w.player.mods.maxHearts;
      expect(w.player.hearts, seed).toBe(max);
      const spare = () => w.pickups.filter((p) => p.alive && p.kind === "heart" && p.reserve);
      expect(spare(), seed).toHaveLength(CRASH_HEARTS_SPARE);
      // Walk over one on a full bar: it stays.
      const h = spare()[0]!;
      w.player.x = h.x; w.player.y = h.y;
      // Hold the king still, so the test is about the heart.
      const king = w.enemies.find((e) => e.archetype === "boss")!;
      king.bossMoveMs = 1e9;
      for (let i = 0; i < 10; i++) step(w, NO_INPUT);
      expect(spare(), seed).toHaveLength(CRASH_HEARTS_SPARE);
      // Hurt, it is taken.
      w.player.hearts = max - 1;
      for (let i = 0; i < 10; i++) step(w, NO_INPUT);
      expect(spare(), seed).toHaveLength(CRASH_HEARTS_SPARE - 1);
      expect(w.player.hearts, seed).toBe(max);
      // And the rest outlive a pickup's ordinary life.
      w.player.x = 40; w.player.y = 40;
      for (let i = 0; i < Math.ceil(PICKUP_LIFETIME_MS / (1000 / 60)) + 60; i++) step(w, NO_INPUT);
      expect(spare().length, seed).toBe(CRASH_HEARTS_SPARE - 1);
    }
  });
});

describe("the drop-in: the room", () => {
  it("leaves the room's pots and crates to his blows: the stones fall on bodies, not on the room", () => {
    const w = audienceWorld("props", 3, 6);
    const standing = () => w.props.filter((q) => q.hp > 0 && (q.kind === "pot" || q.kind === "crate" || q.kind === "urn")).length;
    const before = standing();
    expect(before).toBeGreaterThan(0);
    while (w.audience!.phase !== "fight") step(w, NO_INPUT);
    expect(standing()).toBe(before);
  });

  it("is empty, not clear, while he is still to come: bodies all gone before he lands", () => {
    const w = audienceWorld("empty");
    w.enemies.length = 0;
    w.pendingWaves.length = 0;
    expect(worldCleared(w)).toBe(false);
    step(w, NO_INPUT);
    expect(w.cleared).toBe(false);
  });

  it("clears once he has gone", () => {
    const w = audienceWorld("clear");
    runDrop(w);
    const king = w.enemies.find((e) => e.archetype === "boss")!;
    king.hp = Math.ceil(king.maxHp * 0.6);
    for (let i = 0; i < 60 * 20 && !w.cleared; i++) step(w, NO_INPUT);
    step(w, NO_INPUT);
    expect(w.enemies).toHaveLength(0);
    expect(worldCleared(w)).toBe(true);
    expect(w.cleared).toBe(true);
    expect(w.audience!.phase).toBe("done");
  });
});
