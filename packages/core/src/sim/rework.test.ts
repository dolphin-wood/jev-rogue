import { describe, it, expect } from "vitest";
import { rampFor } from "../encounters/ramp.ts";
import { addPower, clearPowers } from "../content/tags.ts";
import { createWorld, step, queueBossMove, forceBossBlade, BOSS_SLAM_MS, BOSS_LEAP_MS, BOSS_LEAP_RISE_MS, BOSS_QUAKE_MS } from "./world.ts";
import { BAR_MS, BEAT_MS } from "./beat.ts";
import { NO_INPUT, noMods } from "./types.ts";
import type { World } from "./types.ts";
import { makeEnemy } from "./enemy.ts";
import { armHits } from "./attacks.ts";
import { PLAYER_RADIUS, STEP_MS } from "./types.ts";
import { acquire } from "./bullets.ts";
import { drop } from "./pickups.ts";
import { beginSwing, SWING_DAMAGE } from "./melee.ts";
import { attachAffix, dismantleValue, levelDamageMult, makeSpell, statusForecast, withLevel } from "./spells.ts";
import { generateRoom, throneHall, toRoomPlan } from "../rooms/index.ts";
import { plainInstance, ITEMS, schoolOf } from "../spells/index.ts";
import { applyStat, statById, statLine } from "../run/stats.ts";
import { offerCards, ruleOffer } from "../run/offer.ts";
import { ruleDoors, RUN_BOSS_ROOM } from "../run/doors.ts";
import { RngSource } from "../rng.ts";
import { GRID_W, Tile } from "../types.ts";
import type { Element } from "../types.ts";

const src = new RngSource("rework");
const STAFF = { slots: 6, mana_max: 120 };

function world(mods = noMods()): World {
  const g = generateRoom(
    { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
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
    b.lifeMs = 400; b.damage = 1; b.element = "fire"; b.elementPower = 1; b.powers.fire = 1;
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

  /**
   * What a card promises about an element, measured.
   *
   * `statusForecast` is what the offer screen prints — "Burn · 3 hits · 15 dmg
   * / 3 s" — and it is arithmetic over the simulation's constants rather than
   * a reading of the simulation itself. That is exactly the kind of number
   * that goes quietly wrong: a balance pass moves `BURN_DPS`, the card is
   * right because it reads the constant, and then the *tick* changes shape —
   * rounding, a carried remainder, a different stack count on ignition — and
   * the card is confidently wrong. So a body is put in a room, hit until it
   * ignites, and left alone while the status runs out.
   *
   * Nothing here names a spell's own figures: the hits come from the item's
   * `element_power` through `statusForecast`, so a retune of the pool cannot
   * make this test lie either.
   */
  const elemental = (id: string, element: Element) => {
    const base = ITEMS.get(id);
    if (!base) throw new Error(`no item ${id}`);
    const forecast = statusForecast(base);
    if (!forecast || forecast.element !== element) throw new Error(`${id} is not ${element}`);
    return { base, forecast };
  };

  // `statusMult` is what the cast would carry: the spell's own `status_scale`, at level one.
  const hit = (w: World, e: { x: number; y: number }, element: Element, power: number, statusMult = 1) => {
    const b = acquire(w.playerBullets, true);
    if (!b) throw new Error("no bullet");
    b.alive = true; b.x = e.x - 4; b.y = e.y; b.vx = 300; b.vy = 0; b.radius = 4;
    b.lifeMs = 400; b.damage = 0; b.element = element; b.elementPower = power; b.statusMult = statusMult;
    // A shot carries its elements as powers now; `element` is only the colour.
    clearPowers(b.powers); addPower(b.powers, element, power);
    for (let i = 0; i < 4; i++) step(w, NO_INPUT);
  };

  for (const [id, element] of [["ember_dart", "fire"], ["venom_spit", "poison"]] as const) {
    it(`deals what the card says a ${element} status deals`, () => {
      const { base, forecast } = elemental(id, element);
      const power = typeof base.params.element_power === "number" ? base.params.element_power : 1;
      const scale = typeof base.params.status_scale === "number" ? base.params.status_scale : 1;
      const w = world();
      // A shooter that cannot move, cannot die and resists nothing, so what
      // its hp loses is the status and only the status.
      const e = makeEnemy(1, "shooter", 336, 250, []);
      e.spawnFadeMs = 0; e.awake = true; e.speed = 0; e.hp = 100000; e.maxHp = 100000;
      w.enemies.push(e);

      // Hit it exactly as many times as the card says it takes.
      for (let k = 0; k < forecast.hits; k++) hit(w, e, element, power, scale);
      expect(e[element === "fire" ? "burnMs" : "poisonMs"], "the card's hit count should ignite").toBeGreaterThan(0);

      // Then nothing but time, until the status has run its course twice over.
      expect(forecast.damage, "a status worth nothing would pass this trivially").toBeGreaterThan(0);
      const before = e.hp;
      const frames = Math.ceil((forecast.seconds * 2 * 1000) / 16);
      for (let i = 0; i < frames; i++) step(w, NO_INPUT);
      expect(before - e.hp, "the status total the card printed").toBe(forecast.damage);
    });
  }

  it("says the freeze a card promises, and the shatter that pays for it", () => {
    const { base, forecast } = elemental("frost_needle", "ice");
    const power = typeof base.params.element_power === "number" ? base.params.element_power : 1;
    const w = world();
    const e = makeEnemy(1, "shooter", 336, 250, []);
    e.spawnFadeMs = 0; e.awake = true; e.speed = 0; e.hp = 100000; e.maxHp = 100000;
    w.enemies.push(e);
    for (let k = 0; k < forecast.hits; k++) hit(w, e, "ice", power);
    expect(e.frozenMs, "the card's hit count should freeze").toBeGreaterThan(0);
    expect(e.frozenMs / 1000).toBeCloseTo(forecast.seconds, 1);

    // The next hit breaks the ice, at the multiple the card names.
    const b = acquire(w.playerBullets, true);
    if (!b) throw new Error("no bullet");
    b.alive = true; b.x = e.x - 4; b.y = e.y; b.vx = 300; b.vy = 0; b.radius = 4;
    b.lifeMs = 400; b.damage = 10; b.element = "none"; b.elementPower = 1; clearPowers(b.powers);
    const before = e.hp;
    for (let i = 0; i < 4; i++) step(w, NO_INPUT);
    expect(before - e.hp).toBe(10 * forecast.shatter);
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
    b.lifeMs = 400; b.damage = dmg; b.element = "ice"; b.elementPower = 1; b.powers.ice = 1;
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
    expect(levelDamageMult(5)).toBeCloseTo(1.8, 5);
    expect(dismantleValue(2, [2])).toBeGreaterThan(dismantleValue(1));
    const slot = withLevel(makeSpell(plainInstance("magic_bolt")), 7);
    expect(slot.level).toBe(5);
  });

  it("attaches at a drop's tier and replaces an affix on a full spell", () => {
    let slot = makeSpell(plainInstance("magic_bolt"));
    slot = attachAffix(slot, "fork", 2)!;
    expect(slot.affixes[0]).toEqual({ id: "fork", tier: 2 });
    slot = attachAffix(attachAffix(slot, "chain")!, "brand")!;
    expect(attachAffix(slot, "bloom")).toBeNull();
    const swapped = attachAffix(slot, "bloom", 1, "chain")!;
    expect(swapped.affixes.map((a) => a.id)).toEqual(["fork", "bloom", "brand"]);
  });
});

describe("doors promise more than a kind", () => {
  it("grades an elite door up, and names no school: a badge is read off the cards behind it", () => {
    for (let i = 0; i < 20; i++) {
      for (const d of ruleDoors({ roomIndex: 5, lastWasElite: false, critical: false }, src.stream("d", i), 3)) {
        if (d.difficulty === "elite") expect(d.grade).toBeGreaterThanOrEqual(2);
        expect(d.schools).toBeUndefined();
        expect(d.families).toBeUndefined();
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
  /**
   * Moves are started so they commit on the beat grid (doc 020), so a test
   * that wants a move *now* puts the fight clock where the next step's move
   * lands on a line: a bar for the ground strikes, a beat for the chains.
   */
  const onGrid = (b: ReturnType<typeof boss>, commitMs: number, unit = BAR_MS) => {
    b.bossFightMs = unit * 20 - commitMs - STEP_MS;
  };

  /*
   * **Played to its music** (doc 020): over a real fight in every phase, each
   * ground strike lands on a downbeat of the 168 BPM theme and each chain and
   * blade on a beat, to within a step of the sim — the stepped clock can only
   * land on a line or just after it — and hitstop, which freezes the fight but
   * not the music, does not push it off.
   */
  for (const [phase, hp] of [[1, 1], [2, 0.5], [3, 0.2]] as const) {
    it(`commits on the beat grid in phase ${phase}`, () => {
      const w = world();
      const b = boss(w);
      b.hp = b.maxHp * hp;
      const off = (t: number, unit: number): number => { const r = ((t % unit) + unit) % unit; return Math.min(r, unit - r); };
      const seen: string[] = [];
      let was = b.attack;
      let wasFlying = false;
      // A commit due inside a freeze lands as the freeze ends: the body is frozen, so that is when it can.
      let frozeBefore = false;
      const tol = (): number => (frozeBefore ? 50 : 0) + STEP_MS * 1.01;
      // Two minutes: he takes a turn, then rests (`chooseBossAct`), and the ground strikes are drawn seldom.
      for (let i = 0; i < 60 * 120; i++) {
        // The player circles him, in close, at blade's length and across the hall by turns, so the fight uses every move it has.
        const a = i / 90;
        const r = [120, 64, 210][Math.floor(i / 300) % 3]!;
        w.player.x = b.x + Math.cos(a) * r;
        w.player.y = b.y + Math.sin(a) * r;
        w.player.hearts = 6;
        w.player.invulnMs = 1e9;
        // A player landing hits: the freeze they cost comes every few hundred ms, and the beat must not slip.
        if (i % 37 === 0) w.hitstopMs = Math.max(w.hitstopMs, 50);
        w.events.length = 0;
        const frozen = w.hitstopMs > 0;
        step(w, NO_INPUT);
        for (const ev of w.events) {
          if (ev.kind !== "hazard_tick") continue;
          if (ev.what === "boss_slam" || ev.what === "boss_quake" || ev.what === "boss_land") {
            expect(off(b.bossFightMs, BAR_MS), `${ev.what} at ${b.bossFightMs.toFixed(0)} ms`).toBeLessThanOrEqual(tol());
            seen.push(ev.what);
          }
          if (ev.what === "arm") { expect(off(b.bossFightMs, BEAT_MS), `arm at ${b.bossFightMs.toFixed(0)} ms`).toBeLessThanOrEqual(tol()); seen.push("arm"); }
        }
        // The hook is thrown on a beat: its chain leaves the floor there.
        const flying = w.tethers.some((t) => t.alive && t.from === b.id && t.kind === "hook" && t.phase === "fly");
        if (flying && !wasFlying) {
          expect(off(b.bossFightMs, BEAT_MS), `hook at ${b.bossFightMs.toFixed(0)} ms`).toBeLessThanOrEqual(tol());
          seen.push("hook");
        }
        wasFlying = flying;
        if (was === "windup" && b.attack === "lunge") {
          // A string's later blows are laid on the eighths (`BossPhase.strings`); every blow is on that grid.
          expect(off(b.bossFightMs, BEAT_MS / 2), `blade at ${b.bossFightMs.toFixed(0)} ms`).toBeLessThanOrEqual(tol());
          seen.push("blade");
        }
        was = b.attack;
        frozeBefore = frozen;
      }
      // It did fight: at least two kinds of move were checked.
      expect(new Set(seen).size).toBeGreaterThanOrEqual(2);
    });
  }

  it("held by the boss lab, starts nothing itself, and throws what it is asked for on its line", () => {
    const w = world();
    const b = boss(w);
    w.bossHold = { moves: true, blades: true, volleys: true };
    w.player.x = b.x + 60;
    w.player.y = b.y;
    for (let i = 0; i < 60 * 8; i++) {
      w.player.hearts = 6;
      step(w, NO_INPUT);
      expect(b.bossCast).toBe("none");
      expect(b.attack).toBe("approach");
    }
    expect(w.enemyBullets.filter((x) => x.alive).length).toBe(0);
    expect(queueBossMove(w, "quake")).toBe(true);
    let landed = -1;
    for (let i = 0; i < 60 * 3 && landed < 0; i++) {
      w.events.length = 0;
      step(w, NO_INPUT);
      if (w.events.some((ev) => ev.kind === "hazard_tick" && ev.what === "boss_quake")) landed = b.bossFightMs;
    }
    const r = ((landed % BAR_MS) + BAR_MS) % BAR_MS;
    expect(landed).toBeGreaterThan(0);
    expect(Math.min(r, BAR_MS - r)).toBeLessThanOrEqual(STEP_MS * 1.01);
    for (let i = 0; i < 60 * 2 && b.bossCast !== "none"; i++) step(w, NO_INPUT);
    expect(forceBossBlade(w, "cleave")).toBe(true);
    expect(b.attack).toBe("windup");
    expect(b.meleeKind).toBe("cleave");
  });

  it("slams: the band comes out of the floor at his feet, and no ring of shots with it", () => {
    const w = world();
    const b = boss(w);
    onGrid(b, BOSS_SLAM_MS);
    expect(queueBossMove(w, "slam")).toBe(true);
    step(w, NO_INPUT);
    expect(b.bossCast).toBe("slam");
    for (let i = 0; i < Math.ceil(BOSS_SLAM_MS / 16) + 3; i++) step(w, NO_INPUT);
    const band = w.shockwaves.find((x) => x.alive);
    expect(band).toBeDefined();
    expect(Math.hypot(band!.x - b.x, band!.y - b.y)).toBeLessThan(1);
    // Born at nothing: three steps out it has run a few px, not the struck ground's 56.
    expect(band!.inner).toBeLessThan(30);
    // A dash through the band came out of its i-frames into the ring, so there is no ring.
    expect(w.enemyBullets.filter((x) => x.alive).length).toBe(0);
  });

  it("leaps in phase two: it travels, is untouchable in the air, and the landing throws the band", () => {
    const w = world();
    const b = boss(w);
    b.hp = b.maxHp * 0.5;
    step(w, NO_INPUT);
    expect(b.phase).toBe(2);
    // Phase two opens with adds.
    expect(w.enemies.filter((x) => x !== b && x.hp > 0).length).toBe(2);
    b.attack = "approach";
    b.bossCast = "none";
    w.player.x = b.x + 200;
    w.player.y = b.y;
    onGrid(b, BOSS_LEAP_MS);
    expect(queueBossMove(w, "leap")).toBe(true);
    step(w, NO_INPUT);
    expect(b.bossCast).toBe("leap");
    const fromX = b.x;
    // It gathers on the floor first: still down, still hittable.
    for (let i = 0; i < Math.floor(BOSS_LEAP_RISE_MS / 16) - 2; i++) step(w, NO_INPUT);
    expect(b.airborne).toBe(false);
    expect(Math.abs(b.x - fromX)).toBeLessThan(2);
    // Then it is in the air, lifted, and **travelling** rather than waiting.
    for (let i = 0; i < 20; i++) step(w, NO_INPUT);
    expect(b.airborne).toBe(true);
    expect(b.bossLift).toBeGreaterThan(10);
    expect(Math.abs(b.x - fromX)).toBeGreaterThan(10);
    const tx = b.bossTargetX;
    for (let i = 0; i < Math.ceil(BOSS_LEAP_MS / 16); i++) step(w, NO_INPUT);
    expect(b.airborne).toBe(false);
    expect(b.bossLift).toBe(0);
    expect(Math.abs(b.x - tx)).toBeLessThan(40);
    // The landing throws the shockwave, from the place it landed.
    const band = w.shockwaves.find((x) => x.alive);
    expect(band).toBeDefined();
    expect(Math.hypot(band!.x - b.x, band!.y - b.y)).toBeLessThan(30);
  });

  it("strings climb in cost, and a hit's mercy frames still cover what falls inside them", () => {
    const w = world();
    const b = boss(w);
    b.hp = b.maxHp * 0.5;
    b.hasAttacked = true;
    w.bossHold = { moves: true, blades: true, volleys: true };
    step(w, NO_INPUT);
    // In front of him (below, on the screen), where the slashes cross and the cleave can still find them.
    w.player.x = b.x - 14;
    w.player.y = b.y + 60;
    w.player.hearts = 6;
    expect(forceBossBlade(w, "greatslash")).toBe(true);
    const lost: number[] = [];
    for (let i = 0; i < 60 * 3; i++) {
      w.player.x = b.x - 14;
      w.player.y = b.y + 60;
      const before = w.player.hearts;
      step(w, NO_INPUT);
      if (w.player.hearts < before) lost.push(Math.round((before - w.player.hearts) * 10));
    }
    /*
     * x--x----X: the first blow's mercy frames (950 ms) cover the second, not
     * the heavy one a bar later. Eight and twelve points of his own
     * (`bossStringHearts`), times the boss band's `power` — the king takes the
     * ramp's late figure like every other body, which is what keeps his blows
     * worth something against a bar that levels grow (`run/levels.ts`).
     */
    const power = rampFor(w.roomIndex).power;
    // Down to the whole point the bar draws (`wholeHp`), which is why these
    // are floored rather than rounded.
    expect(lost).toEqual([Math.floor(0.8 * power * 10), Math.floor(1.2 * power * 10)]);
  });

  it("is never moved by the player: not by the sword's knockback, and not by walking into him", () => {
    const w = world();
    const b = boss(w);
    w.bossHold = { moves: true, blades: true, volleys: true };
    const at = { x: b.x, y: b.y };
    for (let i = 0; i < 60 * 3; i++) {
      w.player.hearts = 6;
      w.player.invulnMs = 1e9;
      // Standing in the ceremony, where he does not walk of his own accord: anything that moves him is the player.
      b.bossLastAct = "";
      // Pressed against him from below, facing him, swinging the whole time.
      step(w, { ...NO_INPUT, moveY: -1, aimX: b.x, aimY: b.y, swing: true });
    }
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(Math.hypot(b.x - at.x, b.y - at.y)).toBeLessThan(0.5);
  });

  it("knocks a candelabrum over when he walks into it, and a column stands", () => {
    const w = createWorld({
      room: throneHall(), encounter: null, props: 0, staff: STAFF, mods: noMods(),
      slots: [plainInstance("magic_bolt"), null, null, null, null, null], hearts: 6, rng: src.stream("hall"),
    });
    const lamp = w.props.find((p) => p.kind === "candelabrum")!;
    const column = w.props.find((p) => p.kind === "column")!;
    const b = makeEnemy(w.nextEnemyId++, "boss", lamp.x, lamp.y + 40, []);
    b.spawnFadeMs = 0; b.awake = true;
    w.enemies.push(b);
    w.bossHold = { moves: true, blades: true, volleys: true };
    for (let i = 0; i < 30; i++) { b.x = lamp.x; b.y = lamp.y + 24; step(w, NO_INPUT); }
    expect(lamp.hp).toBeLessThanOrEqual(0);
    // A column is worn by blows only: walked into, it stands.
    for (let i = 0; i < 60; i++) { w.player.x = column.x; w.player.y = column.y + 20; step(w, NO_INPUT); }
    expect(column.hp).toBeGreaterThan(0);
  });

  it("calls the storm: a bolt a beat, each marked two beats before it falls, the first on the player", () => {
    const w = world();
    const b = boss(w);
    b.hp = b.maxHp * 0.5;
    step(w, NO_INPUT);
    b.attack = "approach";
    w.bossHold = { moves: true, blades: true, volleys: true };
    w.player.x = b.x + 140;
    w.player.y = b.y + 40;
    expect(queueBossMove(w, "storm")).toBe(true);
    for (let i = 0; i < 60 * 3 && b.bossCast !== "storm"; i++) step(w, NO_INPUT);
    expect(b.bossCast).toBe("storm");
    const falls: number[] = [];
    const marks: { x: number; y: number }[] = [];
    const off = (t: number): number => { const r = ((t % BEAT_MS) + BEAT_MS) % BEAT_MS; return Math.min(r, BEAT_MS - r); };
    for (let i = 0; i < 60 * 6 && b.bossCast === "storm"; i++) {
      w.player.hearts = 6;
      w.player.invulnMs = 1e9;
      w.events.length = 0;
      step(w, NO_INPUT);
      for (const ev of w.events) {
        if (ev.kind === "telegraph" && ev.what === "bolt") marks.push({ x: ev.x, y: ev.y });
        if (ev.kind === "hazard_tick" && ev.what === "lightning") falls.push(b.bossFightMs);
      }
    }
    // Phase II: four bolts, each on a beat; the first on where the player stood.
    expect(marks.length).toBe(4);
    expect(falls.length).toBe(4);
    for (const t of falls) expect(off(t)).toBeLessThanOrEqual(STEP_MS * 1.01);
    expect(Math.hypot(marks[0]!.x - w.player.x, marks[0]!.y - w.player.y)).toBeLessThan(2);
    for (const r of w.rifts.filter((x) => x.bolt)) expect(r.teleMaxMs).toBeGreaterThanOrEqual(260);
  });

  it("hooks: the chain follows the player while it lies there, catches for nothing, and the slash comes as they land", () => {
    const w = world();
    const b = boss(w);
    b.hasAttacked = true;
    w.bossHold = { moves: true, blades: true, volleys: true };
    w.player.x = b.x + 150;
    w.player.y = b.y;
    expect(queueBossMove(w, "hook")).toBe(true);
    for (let i = 0; i < 60 * 3 && b.bossCast !== "hook"; i++) step(w, NO_INPUT);
    expect(b.bossCast).toBe("hook");
    // The player walks off the line it was laid on; it comes with them.
    w.player.y = b.y + 60;
    step(w, NO_INPUT);
    const chain = w.tethers.find((t) => t.alive && t.kind === "hook" && t.from === b.id)!;
    expect(chain.phase).toBe("aim");
    const laid = Math.atan2(chain.y1 - b.y, chain.x1 - b.x);
    expect(Math.abs(laid - Math.atan2(w.player.y - b.y, w.player.x - b.x))).toBeLessThan(0.02);
    // Standing still, they are caught: no hearts, then drawn to his front and cut at.
    const hearts = w.player.hearts;
    let dragged = false;
    for (let i = 0; i < 60 * 4 && !(dragged && b.attack === "windup"); i++) {
      step(w, NO_INPUT);
      if (w.player.dragMs > 0) dragged = true;
    }
    expect(dragged).toBe(true);
    expect(w.player.hearts).toBe(hearts);
    expect(b.attack).toBe("windup");
    expect(b.meleeKind).toBe("greatslash");
    expect(b.bossString).toEqual([]);
    expect(w.player.y).toBeGreaterThan(b.y);
    expect(Math.hypot(w.player.x - b.x, w.player.y - b.y)).toBeLessThan(80);
  });

  /** Runs the fight until his next turn is chosen, with the player held at (dx, dy) from him; returns it. */
  const nextTurn = (w: World, body: ReturnType<typeof boss> | null, dx: number, dy: number, n: number): string => {
    const b = body ?? boss(w);
    // A draw of its own for each fight, and a moment for him to see where they stand before he chooses.
    w.rng = src.stream(`turn${n}`);
    b.bossMoveMs = 200;
    for (let i = 0; i < 60 * 12; i++) {
      w.player.x = b.x + dx;
      w.player.y = b.y + dy;
      w.player.hearts = 6;
      w.player.invulnMs = 1e9;
      const before = b.bossLastAct;
      b.bossLastAct = before === "" ? "-" : before;
      step(w, NO_INPUT);
      if (b.bossLastAct !== (before === "" ? "-" : before)) return b.bossLastAct;
      b.bossLastAct = before;
    }
    return "none";
  };

  it("chooses his turn by where the player stands: the leap and the long cuts across the hall, what is at his feet up close", () => {
    const far = new Set<string>(), close = new Set<string>(), behind = new Set<string>();
    for (let n = 0; n < 24; n++) {
      const w = world();
      const b = boss(w);
      b.hp = b.maxHp * 0.2;
      step(w, NO_INPUT);
      far.add(nextTurn(w, b, 230, 0, n));
      close.add(nextTurn(world(), null, 0, 60, n));
      behind.add(nextTurn(world(), null, 0, -60, n));
    }
    expect([...far].every((a) => ["leap", "dashcut", "hook", "storm", "volley", "quake", "greatslash"].includes(a))).toBe(true);
    expect(far.has("leap")).toBe(true);
    expect([...close].every((a) => ["greatsweep", "slam", "greatslash", "greatcleave", "maul"].includes(a))).toBe(true);
    expect([...behind].every((a) => ["maul", "slam"].includes(a))).toBe(true);
    // Never one answer to a range.
    for (const set of [far, close, behind]) expect(set.size).toBeGreaterThanOrEqual(2);
  });

  it("rests between turns: after one, nothing is thrown or fired for the rest, however close the player stands", () => {
    const w = world();
    const b = boss(w);
    b.hasAttacked = true;
    let restFrom = -1;
    for (let i = 0; i < 60 * 20; i++) {
      w.player.x = b.x;
      w.player.y = b.y + 60;
      w.player.hearts = 6;
      w.player.invulnMs = 1e9;
      const wasBusy = b.bossBusy;
      step(w, NO_INPUT);
      if (wasBusy && !b.bossBusy) { restFrom = b.bossFightMs; break; }
    }
    expect(restFrom).toBeGreaterThan(0);
    const rest = b.bossMoveMs;
    expect(rest).toBeGreaterThanOrEqual(BEAT_MS * 5);
    const shots = w.enemyBullets.filter((x) => x.alive).length;
    for (let i = 0; i < Math.floor(rest / STEP_MS) - 2; i++) {
      w.player.x = b.x;
      w.player.y = b.y + 60;
      step(w, NO_INPUT);
      expect(b.attack).toBe("approach");
      expect(b.bossCast).toBe("none");
    }
    expect(w.enemyBullets.filter((x) => x.alive).length).toBeLessThanOrEqual(shots);
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
    const slot = makeSpell(plainInstance("frost_needle"));
    const c1 = slotCost(withLevel(slot, 1), ITEMS, STAFF);
    const c2 = slotCost(withLevel(slot, 2), ITEMS, STAFF);
    const c5 = slotCost(withLevel(slot, 5), ITEMS, STAFF);
    expect(c2).toBeGreaterThanOrEqual(c1);
    expect(c5).toBeGreaterThan(c2);
    expect(c5 / c1).toBeLessThan(levelDamageMult(5));
    expect(levelManaMult(5)).toBeCloseTo(1.4, 6);
  });
});
