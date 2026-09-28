/**
 * The Frontier Veteran (doc 024): what makes the guardian more than a warden,
 * each held to what the document promises.
 */
import { describe, expect, it } from "vitest";
import { createWorld, hurtEnemy, step, worldCleared } from "./world.ts";
import { beginWindup, fire, makeEnemy, meleeSpec } from "./enemy.ts";
import { NO_INPUT } from "./types.ts";
import type { Enemy, World } from "./types.ts";
import { WORLD_H, WORLD_W } from "./collide.ts";
import {
  GUARDIAN_POISE, GUARDIAN_CALL_MS, GUARDIAN_INTRO_MS, GUARDIAN_INTRO_NOTICE_MS, GUARDIAN_INTRO_PRE_MS, GUARDIAN_INTRO_RECOVERY_MS, GUARDIAN_MID_CALL_DELAY_MS, GUARDIAN_HEARTS, GUARDIAN_HP, GUARDIAN_ACTION_GAP_MS, GUARDIAN_ATTACK_RANGE_MULT, GUARDIAN_SCALE, GUARDIAN_SHOT_EVERY, GUARDIAN_SQUAD, GUARDIAN_STAKES_TELE_MS, GUARDIAN_VOLLEY_TELE_MS, GUARDIAN_VOLLEY_MS, GUARDIAN_XP, GUARDIAN_STANCE, GUARDIAN_BROKEN_MS, GUARDIAN_BROKEN_TAKEN, makeGuardian, stepGuardian,
} from "./guardian.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { TILE_PX } from "../types.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import { ENEMIES } from "../encounters/enemies.ts";
import { RUN_GUARDIAN_ROOM, leadsToFixedFight, isFixedFightRoom } from "../run/doors.ts";

function guardianWorld(seed: string): World {
  const src = new RngSource(seed);
  const g = generateRoom(
    { space: "audience_arena", symmetry: "mirrored", size: "compact", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "combat", src.stream("room"),
  );
  return createWorld({
    room: toRoomPlan(g, { id: "g", seed_key: seed, reward_kind: "item", params_source: "rule" }),
    encounter: null, props: 0, staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), null, null, null, null, null], hearts: 6,
    rng: src.stream("world"), roomIndex: RUN_GUARDIAN_ROOM, guardian: true, invincible: true,
    viewHalf: { x: WORLD_W, y: WORLD_H },
  });
}
const guardianOf = (w: World): Enemy => w.enemies.find((e) => e.guardian)!;
function summonMid(w: World, g: Enemy): void {
  const steps = (ms: number) => Math.ceil(ms / (1000 / 60));
  for (let i = 0; i < steps(GUARDIAN_CALL_MS) + 2; i++) step(w, NO_INPUT);
  g.guardian!.callMs = 0;
  g.attack = "approach"; g.pose = ""; g.poseMs = 0; g.staggerMs = 0; g.plantMs = 0; g.attackCooldownMs = 1e9;
  step(w, NO_INPUT);
  expect(g.pose).toBe("guardian_call");
  for (let i = 0; i < steps(GUARDIAN_CALL_MS) + 2; i++) step(w, NO_INPUT);
}

describe("the Frontier Veteran: the body", () => {
  it("is a warden, larger, with a heavy body's poise, on its own bar", () => {
    const g = makeGuardian(1, 100, 100, RUN_GUARDIAN_ROOM);
    expect(g.archetype).toBe("warden");
    expect(g.maxHp).toBe(GUARDIAN_HP);
    expect(g.maxPoise).toBe(GUARDIAN_POISE);
    expect(g.radius).toBe(Math.round(ENEMIES.warden.radius * GUARDIAN_SCALE));
    expect(g.phase).toBe(1);
  });

  it("rams from range", () => {
    const g = makeGuardian(1, 100, 100, RUN_GUARDIAN_ROOM);
    g.closeIn = false;
    expect(meleeSpec(g)?.kind).toBe("charge");
  });

  it("scales its melee tell and hit shape with its larger body", () => {
    const w = guardianWorld("melee-reach");
    const g = guardianOf(w);
    beginWindup(w, g, w.player, "sweep");
    expect(g.swing.bladeReach).toBeCloseTo(TILE_PX * 1.65 * GUARDIAN_ATTACK_RANGE_MULT);
    expect(g.swing.reach).toBe(g.swing.bladeReach);
  });

  it("keeps the ram's travel geometry unchanged", () => {
    const w = guardianWorld("ram-reach");
    const g = guardianOf(w);
    beginWindup(w, g, w.player, "charge");
    expect(g.swing.reach).toBeCloseTo(TILE_PX * meleeSpec(g)!.reachTiles);
  });

  it("keeps its gun turn off screen and outside the squad's firing budget", () => {
    const w = guardianWorld("own-fire-turn");
    const g = guardianOf(w);
    w.stats.elapsedMs = 5000;
    w.fireTokenCap = 0;
    w.viewHalf = { x: 1, y: 1 };
    w.player.x = g.x + 1; w.player.y = g.y;
    w.viewCentre = { x: 0, y: 0 };
    g.alertMs = 0;
    g.telegraphMs = 0;
    g.plantMs = 0;
    g.attackCooldownMs = 1e9;
    g.pose = ""; g.poseMs = 0;
    g.guardian!.callMs = g.guardian!.stakesMs = g.guardian!.volleyMs = 1e9;
    g.patternMs = ENEMIES.warden.ranged!.interval_s * 1000 * GUARDIAN_SHOT_EVERY - 1;
    fire(w, g, 1000 / 60);
    expect(g.pose).toBe("musket_windup");
    expect(g.hasFireToken).toBe(false);
  });

  it("leaves one shared 2.5 second window before any other attack family may start", () => {
    const w = guardianWorld("shared-attack-gap");
    const g = guardianOf(w);
    const state = g.guardian!;
    g.pose = "";
    g.poseMs = 0;
    g.attack = "approach";
    g.attackMs = 0;
    g.attackCooldownMs = 0;
    g.attackLockMs = 0;
    g.alertMs = 0;
    g.staggerMs = 0;
    g.plantMs = 0;
    g.telegraphMs = 0;
    g.pending = [];
    state.introGraceMs = 0;
    state.callMs = 0;
    state.stakesMs = 0;
    state.volleyMs = 0;
    // Model the frame on which the preceding complete action became idle.
    state.wasAttacking = true;
    state.actionGapMs = 0;
    stepGuardian(w, g, 1000 / 60);
    expect(state.actionGapMs).toBeGreaterThan(GUARDIAN_ACTION_GAP_MS - 30);

    const steps = (ms: number) => Math.ceil(ms / (1000 / 60));
    for (let i = 0; i < steps(GUARDIAN_ACTION_GAP_MS - 100); i++) {
      step(w, NO_INPUT);
      expect(g.attack).toBe("approach");
      expect(g.pose).toBe("");
    }
    // Once the window is genuinely over, one of the already-due specials may begin.
    for (let i = 0; i < steps(150); i++) step(w, NO_INPUT);
    expect(g.pose).not.toBe("");
  });

  it("has no phases: low on its bar it is the body it was at the top", () => {
    const w = guardianWorld("nophase");
    const g = guardianOf(w);
    g.hp = Math.floor(GUARDIAN_HP * 0.1);
    for (let i = 0; i < 60; i++) step(w, NO_INPUT);
    expect(g.phase).toBe(1);
  });
});

describe("the Frontier Veteran: the room", () => {
  it("stands in front of the door, and the room is a fight until it falls", () => {
    const w = guardianWorld("stand");
    const g = guardianOf(w);
    expect(g).toBeTruthy();
    expect(Math.hypot(g.x - w.player.x, g.y - w.player.y)).toBeGreaterThan(100);
    expect(w.player.facing).toBeCloseTo(Math.atan2(g.y - w.player.y, g.x - w.player.x));
    step(w, NO_INPUT);
    expect(worldCleared(w)).toBe(false);
  });

  it("opens alone with a player-safe laser demonstration", () => {
    const w = guardianWorld("entrance");
    const g = guardianOf(w);
    expect(w.enemies.filter((e) => e !== g)).toHaveLength(0);
    expect(w.pendingWaves).toHaveLength(0);
    expect(w.rifts.filter((r) => r.beam)).toHaveLength(0);
    const steps = (ms: number) => Math.ceil(ms / (1000 / 60));
    for (let i = 0; i < steps(GUARDIAN_INTRO_PRE_MS + GUARDIAN_INTRO_NOTICE_MS) + 2; i++) step(w, NO_INPUT);
    const lines = w.rifts.filter((r) => r.beam);
    expect(lines).toHaveLength(9);
    const near = (r: typeof lines[number]) => {
      const vx = Math.cos(r.angle), vy = Math.sin(r.angle);
      const t = Math.max(0, Math.min(r.length, (w.player.x - r.x) * vx + (w.player.y - r.y) * vy));
      return Math.hypot(w.player.x - (r.x + vx * t), w.player.y - (r.y + vy * t));
    };
    // The lines are real hazards, but the initial pose is deliberately outside
    // every lane; walking into one is the player's choice.
    expect(Math.min(...lines.map(near))).toBeGreaterThan(TILE_PX * 0.5);
    expect(g.pose).toBe("guardian_intro");
    expect(g.guardian!.callMs).toBe(GUARDIAN_MID_CALL_DELAY_MS);
    for (let i = 0; i < steps(GUARDIAN_INTRO_MS - GUARDIAN_INTRO_PRE_MS - GUARDIAN_INTRO_NOTICE_MS) + 2; i++) step(w, NO_INPUT);
    expect(g.pose).not.toBe("guardian_intro");
    expect(g.guardian!.introGraceMs).toBeGreaterThan(0);
    expect(g.attackCooldownMs).toBeGreaterThan(0);
    expect(g.guardian!.called).toBe(false);
    expect(w.enemies.filter((e) => e !== g)).toHaveLength(0);
  });

  it("alarms the opening pack, then sends it under the floor", () => {
    const w = guardianWorld("intro-pack");
    const g = guardianOf(w);
    const minion = makeEnemy(99, "rusher", g.x + 90, g.y, []);
    minion.spawnFadeMs = 0;
    w.enemies.push(minion);
    const steps = (ms: number) => Math.ceil(ms / (1000 / 60));
    for (let i = 0; i < steps(GUARDIAN_INTRO_PRE_MS / 2); i++) step(w, NO_INPUT);
    expect(g.guardian!.introNoticeSent).toBe(false);
    expect(minion.awake).toBe(false);
    while (!g.guardian!.introNoticeSent) step(w, NO_INPUT);
    expect(minion.awake).toBe(true);
    expect(minion.hideMs).toBe(0);
    while (!g.guardian!.introVolleyArmed) step(w, NO_INPUT);
    expect(minion.hideMs).toBeGreaterThan(0);
    while (g.pose === "guardian_intro") step(w, NO_INPUT);
    expect(g.pose).not.toBe("guardian_intro");
    // The laser is finished and the body is either still under the floor or
    // already showing its rise telegraph before rejoining the live room.
    expect(minion.airborne || minion.spawnFadeMs > 0).toBe(true);
    expect(minion.attackLockMs).toBe(GUARDIAN_INTRO_RECOVERY_MS);
  });

  it("calls one squad once in the middle, never again", () => {
    const w = guardianWorld("one-call");
    const g = guardianOf(w);
    const steps = (ms: number) => Math.ceil(ms / (1000 / 60));
    for (let i = 0; i < steps(GUARDIAN_INTRO_MS) + 2; i++) step(w, NO_INPUT);
    g.guardian!.introGraceMs = 0;
    g.guardian!.callMs = 0;
    g.attack = "approach"; g.pose = ""; g.poseMs = 0; g.staggerMs = 0; g.plantMs = 0; g.attackCooldownMs = 1e9;
    step(w, NO_INPUT);
    expect(g.pose).toBe("guardian_call");
    for (let i = 0; i < steps(GUARDIAN_CALL_MS) + 2; i++) step(w, NO_INPUT);
    expect(g.guardian!.called).toBe(true);
    expect(w.enemies.filter((e) => e !== g && e.hp > 0).length).toBe(GUARDIAN_SQUAD.length);
    for (const e of w.enemies) if (e !== g) e.hp = 0;
    for (let i = 0; i < steps(60_000); i++) {
      step(w, NO_INPUT);
      expect(w.enemies.filter((e) => e !== g && e.hp > 0)).toHaveLength(0);
    }
  });

  it("cannot be broken while its arm is up: the call is never interrupted", () => {
    const w = guardianWorld("unbroken");
    const g = guardianOf(w);
    const steps = (ms: number) => Math.ceil(ms / (1000 / 60));
    for (let i = 0; i < steps(GUARDIAN_CALL_MS) + 2; i++) step(w, NO_INPUT);
    g.guardian!.callMs = 0;
    g.attack = "approach"; g.pose = ""; g.poseMs = 0; g.staggerMs = 0; g.plantMs = 0; g.attackCooldownMs = 1e9;
    step(w, NO_INPUT);
    expect(g.pose).toBe("guardian_call");
    // Short of its stance: poise alone never interrupts the call.
    for (let i = 0; i < 6; i++) expect(hurtEnemy(w, g, 40).broke).toBe(false);
    expect(g.pose).toBe("guardian_call");
    expect(g.staggerMs).toBe(0);
  });

  it("goes to its knees when its stance is worn through: stunned, taking more, the call it was making unanswered", () => {
    const w = guardianWorld("stance");
    const g = guardianOf(w);
    const steps = (ms: number) => Math.ceil(ms / (1000 / 60));
    for (let i = 0; i < steps(GUARDIAN_CALL_MS) + 2; i++) step(w, NO_INPUT);
    g.guardian!.callMs = 0;
    g.attack = "approach"; g.pose = ""; g.poseMs = 0; g.staggerMs = 0; g.plantMs = 0; g.attackCooldownMs = 1e9;
    step(w, NO_INPUT);
    expect(g.guardian!.calling).toBe(true);
    const before = w.enemies.length;
    let broke = false;
    for (let i = 0; i < 20 && !broke; i++) broke = hurtEnemy(w, g, 40).broke && g.guardian!.brokenMs > 0;
    expect(broke).toBe(true);
    expect(g.stunMs).toBeGreaterThanOrEqual(GUARDIAN_BROKEN_MS - 1);
    expect(g.staggerMs).toBeGreaterThanOrEqual(GUARDIAN_BROKEN_MS - 1);
    expect(g.guardian!.calling).toBe(false);
    expect(g.guardian!.stance).toBe(0);
    const hp = g.hp;
    hurtEnemy(w, g, 20);
    expect(hp - g.hp).toBe(Math.floor(20 * GUARDIAN_BROKEN_TAKEN));
    // Nothing wears it while it is down, and it gets up when the window is over.
    expect(g.guardian!.stance).toBe(0);
    for (let i = 0; i < steps(GUARDIAN_BROKEN_MS + 300); i++) step(w, NO_INPUT);
    expect(g.guardian!.brokenMs).toBeLessThanOrEqual(0);
    expect(g.stunMs).toBeLessThanOrEqual(0);
    expect(w.enemies.length).toBe(before);
  });

  it("is not stunned by a poise break: the break interrupts, the stars are a stun's", () => {
    const w = guardianWorld("poise-stars");
    const g = guardianOf(w);
    const steps = (ms: number) => Math.ceil(ms / (1000 / 60));
    for (let i = 0; i < steps(GUARDIAN_CALL_MS) + 4; i++) step(w, NO_INPUT);
    g.poiseGuardMs = 0; g.poise = g.maxPoise;
    expect(hurtEnemy(w, g, g.maxPoise + 1).broke).toBe(true);
    expect(g.staggerMs).toBeGreaterThan(0);
    expect(g.stunMs).toBeLessThanOrEqual(0);
    expect(g.guardian!.stance).toBeLessThan(GUARDIAN_STANCE);
  });

  it("drives its stakes: three lanes at a player at range, a ring round itself on a player close by", () => {
    for (const near of [false, true]) {
      const w = guardianWorld(near ? "palisade" : "stakes");
      const g = guardianOf(w);
      const steps = (ms: number) => Math.ceil(ms / (1000 / 60));
      for (let i = 0; i < steps(GUARDIAN_CALL_MS) + 4; i++) step(w, NO_INPUT);
      for (const e of w.enemies) if (e !== g) e.hp = 0;
      g.x = 320; g.y = 200;
      w.player.x = near ? g.x + 50 : g.x + 200; w.player.y = g.y;
      g.guardian!.stakesMs = 0;
      g.guardian!.volleyMs = 1e9;
      g.guardian!.chainNext = false; g.guardian!.wasCharging = false;
      g.attack = "approach"; g.pose = ""; g.poseMs = 0; g.staggerMs = 0; g.plantMs = 0; g.attackCooldownMs = 1e9;
      w.rifts.length = 0;
      step(w, NO_INPUT);
      expect(g.pose, String(near)).toBe("guardian_stakes");
      const rifts = w.rifts.filter((r) => r.alive);
      if (near) {
        // The palisade: the player's Quake Ring in its hands, cells that hit the player.
        expect(rifts).toHaveLength(0);
        const cells = w.eruptions.filter((c) => c.alive && c.hostile);
        expect(cells.length).toBeGreaterThan(8);
        expect(Math.min(...cells.map((c) => c.delayMs))).toBeGreaterThanOrEqual(GUARDIAN_STAKES_TELE_MS - 20);
        expect(cells.every((c) => c.telegraphMs === GUARDIAN_STAKES_TELE_MS)).toBe(true);
      } else {
        expect(rifts).toHaveLength(3);
        expect(rifts.every((r) => r.length > 0 && r.teleMs >= GUARDIAN_STAKES_TELE_MS - 20)).toBe(true);
      }
      expect(g.guardian!.stakesMs).toBeGreaterThan(0);
    }
  });

  it("hurts the player with its palisade, once however many stakes they stand in", () => {
    const w = guardianWorld("palisade-hit");
    const g = guardianOf(w);
    const steps = (ms: number) => Math.ceil(ms / (1000 / 60));
    for (let i = 0; i < steps(GUARDIAN_CALL_MS) + 4; i++) step(w, NO_INPUT);
    for (const e of w.enemies) if (e !== g) e.hp = 0;
    g.x = 320; g.y = 200;
    w.player.x = g.x + g.radius + 20; w.player.y = g.y;
    w.player.hearts = 6;
    (w as { invincible?: boolean }).invincible = false;
    g.guardian!.stakesMs = 0; g.guardian!.volleyMs = 1e9;
    g.guardian!.chainNext = false; g.guardian!.wasCharging = false;
    g.attack = "approach"; g.pose = ""; g.poseMs = 0; g.staggerMs = 0; g.plantMs = 0; g.attackCooldownMs = 1e9; g.speed = 0;
    let hits = 0;
    for (let i = 0; i < steps(GUARDIAN_STAKES_TELE_MS + 800); i++) {
      step(w, NO_INPUT);
      hits += w.events.filter((ev) => ev.kind === "player_hit" && ev.what === "stakes").length;
    }
    expect(hits).toBe(1);
  });

  it("orders a volley: lines from wall to wall, drawn long before they fire, all crossing close round the player", () => {
    const w = guardianWorld("volley");
    const g = guardianOf(w);
    const steps = (ms: number) => Math.ceil(ms / (1000 / 60));
    for (let i = 0; i < steps(GUARDIAN_CALL_MS) + 4; i++) step(w, NO_INPUT);
    g.guardian!.volleyMs = 0;
    g.guardian!.chainNext = false; g.guardian!.wasCharging = false;
    g.attack = "approach"; g.pose = ""; g.poseMs = 0; g.staggerMs = 0; g.plantMs = 0; g.attackCooldownMs = 1e9;
    w.rifts.length = 0;
    step(w, NO_INPUT);
    const lines = w.rifts.filter((r) => r.alive && r.beam);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.every((r) => r.teleMs >= GUARDIAN_VOLLEY_TELE_MS - 20 && r.length > 64)).toBe(true);
    const near = (r: (typeof lines)[number]): number => {
      const vx = Math.cos(r.angle), vy = Math.sin(r.angle);
      const t = Math.max(0, Math.min(r.length, (w.player.x - r.x) * vx + (w.player.y - r.y) * vy));
      return Math.hypot(w.player.x - (r.x + vx * t), w.player.y - (r.y + vy * t));
    };
    expect(Math.min(...lines.map(near))).toBeLessThan(TILE_PX * 0.5);
    expect(lines.every((r) => near(r) <= TILE_PX * 2.5)).toBe(true);
    // Spread round the clock, so the gaps run out from the player and are not all one lane.
    const angles = lines.map((r) => ((r.angle % Math.PI) + Math.PI) % Math.PI).sort((a, b) => a - b);
    expect(angles[angles.length - 1]! - angles[0]!).toBeGreaterThan(Math.PI * 0.5);
  });

  it("stands for the whole volley, and its squad goes to ground until it is over", () => {
    const w = guardianWorld("volley-still");
    const g = guardianOf(w);
    const steps = (ms: number) => Math.ceil(ms / (1000 / 60));
    summonMid(w, g);
    const squad = w.enemies.filter((e) => e !== g && e.hp > 0);
    expect(squad.length).toBeGreaterThan(0);
    g.guardian!.volleyMs = 0; g.guardian!.stakesMs = 1e9;
    g.guardian!.chainNext = false; g.guardian!.wasCharging = false;
    g.guardian!.actionGapMs = 0; g.guardian!.wasAttacking = false;
    g.attack = "approach"; g.pose = ""; g.poseMs = 0; g.staggerMs = 0; g.plantMs = 0;
    step(w, NO_INPUT);
    expect(g.pose).toBe("guardian_order");
    expect(squad.every((e) => e.hideMs > 0 && e.airborne)).toBe(true);
    const x = g.x, y = g.y;
    for (let i = 0; i < steps(GUARDIAN_VOLLEY_MS) - 2; i++) {
      step(w, NO_INPUT);
      expect(g.pose).toBe("guardian_order");
      expect(squad.every((e) => e.hp <= 0 || e.hideMs > 0)).toBe(true);
    }
    expect(Math.hypot(g.x - x, g.y - y)).toBeLessThan(1);
    // And they come back up, as a spawn does.
    for (let i = 0; i < steps(1500); i++) step(w, NO_INPUT);
    expect(squad.every((e) => e.hp <= 0 || (e.hideMs <= 0 && !e.airborne))).toBe(true);
  });

  it("sweeps and shoves by turns up close, and rams twice when the first finds no wall", () => {
    const g = makeGuardian(1, 100, 100, RUN_GUARDIAN_ROOM);
    g.closeIn = true;
    const kinds = new Set<string>();
    for (let i = 0; i < 4; i++) { g.casts = i; kinds.add(meleeSpec(g)!.kind); }
    expect([...kinds].sort()).toEqual(["bash", "sweep"]);
    g.guardian!.chainNext = true;
    expect(meleeSpec(g)?.kind).toBe("charge");
  });

  it("leaves hearts that fly to the player when it falls", () => {
    const w = guardianWorld("hearts");
    const g = guardianOf(w);
    step(w, NO_INPUT);
    w.player.hearts = 2;
    g.hp = 0;
    for (let i = 0; i < 60 * 4; i++) step(w, NO_INPUT);
    expect(w.player.hearts).toBeGreaterThanOrEqual(2 + GUARDIAN_HEARTS);
  });

  it("takes its squad with it, and pays a room's experience", () => {
    const w = guardianWorld("death");
    const g = guardianOf(w);
    summonMid(w, g);
    expect(w.enemies.length).toBeGreaterThan(1);
    const xp0 = w.xp;
    g.hp = 0;
    for (let i = 0; i < 30; i++) step(w, NO_INPUT);
    expect(w.enemies).toHaveLength(0);
    expect(w.xp - xp0).toBeGreaterThanOrEqual(GUARDIAN_XP);
  });
});

describe("the Frontier Veteran: the doors", () => {
  it("is room 10, a fixed fight, whose doors in are narrowed as room 5's are", () => {
    expect(RUN_GUARDIAN_ROOM).toBe(10);
    expect(isFixedFightRoom(10)).toBe(true);
    expect(leadsToFixedFight(9)).toBe(true);
    expect(leadsToFixedFight(4)).toBe(true);
    expect(leadsToFixedFight(8)).toBe(false);
  });
});
