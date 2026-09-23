import { describe, it, expect } from "vitest";
import { createWorld, step, BOSS_SLAM_MS, BOSS_LEAP_MS } from "./world.ts";
import { NO_INPUT, noMods } from "./types.ts";
import type { World } from "./types.ts";
import { makeEnemy } from "./enemy.ts";
import { acquire } from "./bullets.ts";
import { drop } from "./pickups.ts";
import { beginSwing, SWING_DAMAGE } from "./melee.ts";
import { attachAffix, dismantleValue, levelDamageMult, makeSpell, withLevel } from "./spells.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { staffFor, plainInstance, ITEMS, schoolOf } from "../spells/index.ts";
import { applyStat, statById, statLine } from "../run/stats.ts";
import { offerCards, ruleOffer } from "../run/offer.ts";
import { ruleDoors, RUN_BOSS_ROOM } from "../run/doors.ts";
import { RngSource } from "../rng.ts";
import { GRID_W, Tile } from "../types.ts";

const src = new RngSource("rework");
const STAFF = staffFor({ slots: "many", mana: "high", tempo: "steady", special: "none" });

function world(mods = noMods()): World {
  const g = generateRoom(
    { space: "open_arena", symmetry: "mirrored", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "combat", src.stream("room"), { plain: true },
  );
  const w = createWorld({
    room: toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" }),
    encounter: null, props: 0, staff: STAFF, mods,
    slots: [plainInstance("magic_bolt"), null, null, null, null, null],
    hearts: 6, rng: src.stream("world"),
  });
  w.player.x = 336;
  w.player.y = 208;
  return w;
}

describe("stat cards that did nothing", () => {
  it("deep well raises the live mana cap", () => {
    const mods = applyStat(noMods(), "deep_well");
    expect(world(mods).staff.mana_max).toBe(Math.round(STAFF.mana_max * 1.18));
  });

  it("keen edge and long reach reach the sword", () => {
    const w = world(applyStat(applyStat(noMods(), "keen_edge"), "long_reach"));
    beginSwing(w.player, w);
    expect(w.swing.damage).toBeCloseTo(SWING_DAMAGE * 1.15, 5);
    const plain = world();
    beginSwing(plain.player, plain);
    expect(w.swing.bladeReach).toBeGreaterThan(plain.swing.bladeReach);
  });

  it("names wrath as what it does", () => {
    expect(statLine(statById("wrath")!)).toBe("+1 spin charge");
    expect(statLine(statById("vigour")!)).toBe("+10 health");
  });
});

describe("enemy statuses build up", () => {
  const fireBolt = (w: World, x: number, y: number) => {
    const b = acquire(w.playerBullets, true)!;
    b.alive = true; b.x = x - 4; b.y = y; b.vx = 300; b.vy = 0; b.radius = 4;
    b.lifeMs = 400; b.damage = 1; b.element = "fire"; b.elementPower = 1;
  };

  it("does not ignite on one hit, and does on a few", () => {
    const w = world();
    const e = makeEnemy(1, "shooter", 336, 250, []);
    e.spawnFadeMs = 0; e.awake = true; e.speed = 0; e.hp = 500; e.maxHp = 500;
    w.enemies.push(e);
    fireBolt(w, e.x, e.y);
    const hp0 = e.hp;
    for (let i = 0; i < 4; i++) step(w, NO_INPUT);
    expect(e.burnMs).toBe(0);
    expect(e.burnBuild).toBeGreaterThan(0);
    for (let k = 0; k < 3; k++) { fireBolt(w, e.x, e.y); for (let i = 0; i < 4; i++) step(w, NO_INPUT); }
    expect(e.burnMs).toBeGreaterThan(0);
  });
});

describe("a cleared room, and a dead player", () => {
  it("pulls every coin in a cleared room to the player, from anywhere", () => {
    const w = world();
    w.cleared = true;
    drop(w.pickups, "coin", 80, 80, w.rng);
    const before = w.gold;
    for (let i = 0; i < 240; i++) step(w, NO_INPUT);
    expect(w.gold).toBeGreaterThan(before);
  });

  it("stops a dead player acting", () => {
    const w = world();
    w.player.hearts = 0;
    const x = w.player.x;
    for (let i = 0; i < 30; i++) step(w, { ...NO_INPUT, moveX: 1 });
    expect(w.player.x).toBe(x);
  });
});

describe("ice freezes, and a frozen body shatters", () => {
  const iceBolt = (w: World, x: number, y: number, dmg = 2) => {
    const b = acquire(w.playerBullets, true)!;
    b.alive = true; b.x = x - 4; b.y = y; b.vx = 300; b.vy = 0; b.radius = 4;
    b.lifeMs = 400; b.damage = dmg; b.element = "ice"; b.elementPower = 1;
  };

  it("fills the ice gauge and freezes at full, then the next hit is triple", () => {
    const w = world();
    const e = makeEnemy(1, "shooter", 336, 250, []);
    e.spawnFadeMs = 0; e.awake = true; e.speed = 0; e.hp = 500; e.maxHp = 500;
    w.enemies.push(e);
    for (let k = 0; k < 3 && e.frozenMs <= 0; k++) { iceBolt(w, e.x, e.y); for (let i = 0; i < 4; i++) step(w, NO_INPUT); }
    expect(e.frozenMs).toBeGreaterThan(0);
    const before = e.hp;
    iceBolt(w, e.x, e.y, 10);
    for (let i = 0; i < 4; i++) step(w, NO_INPUT);
    expect(before - e.hp).toBeGreaterThanOrEqual(30);
    expect(e.frozenMs).toBe(0);
  });
});

describe("spell levels and affix tiers", () => {
  it("scales damage by level and dismantles for more at a higher level", () => {
    expect(levelDamageMult(1)).toBe(1);
    expect(levelDamageMult(3)).toBeCloseTo(1.8, 5);
    expect(dismantleValue(2, [2])).toBeGreaterThan(dismantleValue(1));
    const slot = withLevel(makeSpell(plainInstance("magic_bolt"), ITEMS), 5);
    expect(slot.level).toBe(3);
  });

  it("attaches at a drop's tier and replaces an affix on a full spell", () => {
    let slot = makeSpell(plainInstance("magic_bolt"), ITEMS);
    slot = attachAffix(slot, "fork", 2)!;
    expect(slot.affixes[0]).toEqual({ id: "fork", tier: 2 });
    slot = attachAffix(attachAffix(slot, "chain")!, "brand")!;
    expect(attachAffix(slot, "bloom")).toBeNull();
    const swapped = attachAffix(slot, "bloom", 1, "chain")!;
    expect(swapped.affixes.map((a) => a.id)).toEqual(["fork", "bloom", "brand"]);
  });
});

describe("doors promise more than a kind", () => {
  it("grades an elite door up and names a spell door's school", () => {
    for (let i = 0; i < 20; i++) {
      for (const d of ruleDoors({ roomIndex: 5, lastWasElite: false, critical: false }, src.stream("d", i), 3)) {
        if (d.difficulty === "elite") expect(d.grade).toBeGreaterThanOrEqual(2);
        if (d.reward === "spell") expect(d.school).toBeTruthy();
        if (d.reward === "stat") expect(d.family).toBeTruthy();
      }
    }
  });

  it("deals the promised school first, and grades the cards", () => {
    const cards = offerCards(ITEMS, src.stream("o"), [], "spell", [], { school: "flame", grade: 2 });
    expect(cards.every((c) => c.grade === 2)).toBe(true);
    expect(cards.filter((c) => schoolOf(c.itemId) === "flame").length).toBe(3);
  });

  it("offers no way on out of the boss's room", () => {
    const offer = ruleOffer(ITEMS, src.stream("b"), [], { roomIndex: RUN_BOSS_ROOM, lastWasElite: false, critical: false }, "spell");
    expect(offer.doors).toHaveLength(0);
    expect(offer.cards).toHaveLength(0);
  });
});

describe("the boss", () => {
  const boss = (w: World) => {
    const b = makeEnemy(1, "boss", 336, 150, []);
    b.spawnFadeMs = 0; b.awake = true; b.alertMs = 0; b.armour = 0;
    w.enemies.push(b);
    return b;
  };

  it("slams: a ring of shots out from beyond its body", () => {
    const w = world();
    const b = boss(w);
    b.bossMoveMs = 0;
    step(w, NO_INPUT);
    expect(b.bossCast).toBe("slam");
    for (let i = 0; i < Math.ceil(BOSS_SLAM_MS / 16) + 3; i++) step(w, NO_INPUT);
    expect(w.enemyBullets.filter((x) => x.alive).length).toBeGreaterThanOrEqual(10);
  });

  it("leaps in phase two, untouchable in the air, and lands on the mark", () => {
    const w = world();
    const b = boss(w);
    b.hp = b.maxHp * 0.5;
    step(w, NO_INPUT);
    expect(b.phase).toBe(2);
    // Phase two opens with adds.
    expect(w.enemies.filter((x) => x !== b && x.hp > 0).length).toBe(2);
    b.bossMoveIndex = 1;
    b.bossMoveMs = 0;
    b.attack = "approach";
    step(w, NO_INPUT);
    expect(b.bossCast).toBe("leap");
    for (let i = 0; i < 30; i++) step(w, NO_INPUT);
    expect(b.airborne).toBe(true);
    const tx = b.bossTargetX;
    for (let i = 0; i < Math.ceil(BOSS_LEAP_MS / 16); i++) step(w, NO_INPUT);
    expect(b.airborne).toBe(false);
    expect(Math.abs(b.x - tx)).toBeLessThan(40);
  });

  it("takes its adds with it", () => {
    const w = world();
    const b = boss(w);
    b.hp = b.maxHp * 0.5;
    step(w, NO_INPUT);
    b.hp = 0;
    step(w, NO_INPUT);
    step(w, NO_INPUT);
    expect(w.enemies.filter((x) => x.hp > 0).length).toBe(0);
  });
});

describe("poison pools and the invincible setting", () => {
  /** A room with one poison pool cell under (400, 208). */
  function pooled(): World {
    const w = world();
    const cell: [number, number] = [Math.floor(400 / 32), Math.floor(208 / 32)];
    w.room = { ...w.room, zones: [{ id: "z", cells: [cell], feature: "poison_pool" }] };
    return w;
  }

  it("poisons a ground enemy that stands in the pool, and not a flier", () => {
    const w = pooled();
    const walker = makeEnemy(1, "tank", 400, 208, []);
    const flier = makeEnemy(2, "orbiter", 400, 208, []);
    for (const e of [walker, flier]) { e.spawnFadeMs = 0; e.speed = 0; }
    w.enemies.push(walker, flier);
    for (let i = 0; i < 90; i++) {
      walker.x = 400; walker.y = 208; flier.x = 400; flier.y = 208;
      step(w, NO_INPUT);
    }
    expect(walker.poisonMs > 0 || walker.poisonBuild > 0.5).toBe(true);
    expect(flier.poisonBuild).toBe(0);
    expect(flier.poisonMs).toBe(0);
  });

  it("an invincible player loses no health to hits or to statuses", () => {
    const w = world();
    w.invincible = true;
    const before = w.player.hearts;
    const e = makeEnemy(1, "shooter", 336, 250, []);
    e.spawnFadeMs = 0;
    w.enemies.push(e);
    w.player.poisonMs = 2000;
    for (let i = 0; i < 600; i++) step(w, NO_INPUT);
    expect(w.player.hearts).toBe(before);
  });
});

describe("the spin cuts where it is drawn", () => {
  it("hits a body at any angle round the player, out to the drawn ring, in its first turn", async () => {
    const { beginSpin, stepSwing, fullReach, SPIN_TURNS } = await import("./melee.ts");
    const { STEP_MS } = await import("./types.ts");
    for (let k = 0; k < 24; k++) {
      const w = world();
      w.player.rage = 5;
      expect(beginSpin(w.player, w)).toBe(true);
      const reach = fullReach(w.swing);
      const a = (k / 24) * Math.PI * 2;
      const e = makeEnemy(1, "tank", w.player.x + Math.cos(a) * (reach - 4), w.player.y + Math.sin(a) * (reach - 4), []);
      e.spawnFadeMs = 0;
      w.enemies = [e];
      let hitAt = -1;
      // Step until the first turn is over.
      for (let i = 0; i < 200 && hitAt < 0; i++) {
        const before = w.player.spinTurn;
        if (stepSwing(w, STEP_MS).length > 0) hitAt = before;
        if (w.player.swingMs <= 0) break;
      }
      expect({ k, hitAt }).toEqual({ k, hitAt: 0 });
      void SPIN_TURNS;
    }
  });
});

describe("the spin answers at once", () => {
  it("cancels a swing in any phase, and a press mid-dash goes when the dash ends", async () => {
    const { STEP_MS } = await import("./types.ts");
    for (const frames of [1, 6, 13]) {
      const w = world();
      w.player.rage = 2;
      step(w, { ...NO_INPUT, swing: true });
      for (let i = 0; i < frames; i++) step(w, NO_INPUT);
      expect(w.player.swingStretch).toBe(1);
      step(w, { ...NO_INPUT, spin: true });
      expect({ frames, stretch: w.player.swingStretch }).toEqual({ frames, stretch: 3 });
    }
    const w = world();
    w.player.rage = 2;
    step(w, { ...NO_INPUT, dash: true });
    expect(w.player.dashMs).toBeGreaterThan(0);
    step(w, { ...NO_INPUT, spin: true });
    expect(w.player.swingStretch).toBe(1);
    for (let i = 0; i < 20 && w.player.swingStretch === 1; i++) step(w, NO_INPUT);
    expect(w.player.swingStretch).toBe(3);
    void STEP_MS;
  });
});

describe("a dash across ice", () => {
  it("travels about as far as a dash on stone, not at dash pace after it ends", () => {
    const travel = (icy: boolean) => {
      const w = world();
      // A clear lane, so a wall does not cut the slide short.
      for (let x = 1; x < GRID_W - 1; x++) for (let y = 5; y < 8; y++) w.room.grid[y * GRID_W + x] = Tile.Floor;
      w.flow = null;
      if (icy) {
        const cells: [number, number][] = [];
        // Starting just ahead of the player: the dash leaves stone onto ice.
        for (let x = 12; x < 20; x++) for (let y = 5; y < 8; y++) cells.push([x, y]);
        w.room = { ...w.room, zones: [{ id: "z", cells, feature: "ice_patch" }] };
      }
      const x0 = w.player.x;
      step(w, { ...NO_INPUT, moveX: 1 });
      step(w, { ...NO_INPUT, moveX: 1, dash: true });
      for (let i = 0; i < 40; i++) step(w, NO_INPUT);
      return w.player.x - x0;
    };
    const stone = travel(false);
    const ice = travel(true);
    expect(ice).toBeGreaterThan(stone);
    // Walking momentum carried for a moment, not the dash's speed.
    expect(ice - stone).toBeLessThan(45);
  });
});

describe("a spell level costs mana as well as adding damage", () => {
  it("raises the cost by less than it raises the damage", async () => {
    const { slotCost, levelDamageMult, levelManaMult } = await import("./spells.ts");
    const slot = makeSpell(plainInstance("frost_needle"), ITEMS);
    const c1 = slotCost(withLevel(slot, 1), ITEMS, STAFF);
    const c2 = slotCost(withLevel(slot, 2), ITEMS, STAFF);
    const c3 = slotCost(withLevel(slot, 3), ITEMS, STAFF);
    expect(c2).toBeGreaterThan(c1);
    expect(c3).toBeGreaterThan(c2);
    expect(c3 / c1).toBeLessThan(levelDamageMult(3));
    expect(levelManaMult(3)).toBeCloseTo(1.4, 6);
  });
});
