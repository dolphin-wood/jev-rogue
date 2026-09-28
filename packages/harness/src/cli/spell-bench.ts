/**
 * Sustained spell damage, against the sword, for balance (task 8).
 *
 * `spell-check` fires each spell three times at one dummy, which answers
 * "does it work" and nothing about balance: a damage-over-time spell's burn
 * has not finished ticking, an area spell has one body to hit, and mana and
 * cooldowns never come into it. This casts each spell on its own key for
 * twenty seconds, whenever it can — the mana pool and regeneration of a run,
 * its own cooldown — at two targets:
 *
 * - **single**: one pinned body at 150 px;
 * - **pack**: six pinned bodies bunched at 170 px, where area and chain spells
 *   are meant to earn their keep.
 *
 * **The yardstick is the sword**, not the pool's own median. A median moves
 * when the pool moves, so a pool that drifts together drifts past the tool it
 * is supposed to be measured against: the free, no-cooldown attack the player
 * already owns. The sword is swung on its ideal chain at the same two targets
 * and every spell is reported as a fraction of it.
 *
 * The shape the run is balanced to:
 *
 * - **A base spell is a worse single-target tool than the sword** — about
 *   `BASE_TARGET` of it — because the sword is free and a spell costs mana.
 *   Early, the answer to one body in front of you is the sword; a spell buys
 *   range, an element, or several bodies at once.
 * - **A spell at level five with affixes passes the sword.** That is the whole
 *   reason to build one. See `LADDER_FLOOR`.
 * - **Stacked multiplying affixes are allowed to be explosive**, and only a
 *   loose sanity ceiling catches a combination that has run away from every
 *   other build (`LADDER_CEILING`, `LADDER_SPREAD`).
 *
 * **At level 1, on both sides, and deliberately.** The player's own level
 * (`core/run/levels.ts`) raises the sword 5% a level and nothing else here, so
 * a bench run at the level a run *reaches* would measure every spell against a
 * yardstick a third longer than the one the first rooms hand the player. The
 * question this bench answers is whether a base spell is worth casting instead
 * of swinging, and that question is asked in room 1 with a level-1 sword
 * against a room-1 body. Nothing in it passes `xp`, so nothing in it levels;
 * the run-level balance is `pnpm play`'s.
 *
 * Run: `pnpm spell-bench` (add `quick` to skip the upgrade ladder while
 * tuning base numbers; the ladder assertions are then not checked).
 */
import {
  createWorld, step, makeEnemy, generateRoom, toRoomPlan, runStaff, plainInstance,
  RngSource, NO_INPUT, ITEMS, STEP_MS, GRID_W, GRID_H, TILE_PX, Tile, STYLE_START, attachAffix,
  withLevel, SPELL_LEVEL_MAX, SPELL_AFFIXES, affixFitsSpell, itemShape,
  SWING_DAMAGE, SPELL_DAMAGE_SCALE, rampFor, ENEMIES, ENEMY_HP_SCALE, procWeight, MANA_PER_HIT_FRACTION,
} from "@jr/core";
import type { BaseItem, Enemy, World } from "@jr/core";
import { holdsKey } from "../play/hands.ts";
import type { ChargeHold } from "../play/hands.ts";

/**
 * Damage tags that are a **status**: the ticks of a burn or a poison.
 *
 * It used to match `fire` as well, and an elemental hit reports itself as
 * `hp:fire` — so every direct hit of a fire spell was counted as its status
 * and the share it printed was meaningless (Flame Pillars read 103%). A
 * status is what keeps working after the hit, and that is what `dot:` is.
 */
const LINGERING = /(^|:)dot:/;

const DURATION_MS = 20_000;
const BURST_MS = 3000;
const QUICK = process.argv.slice(2).includes("quick");

const src = new RngSource("spell-bench");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "standard", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("r"), { plain: true },
);
const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
// An empty floor: the measurement is of the spell, not of where the kiting block landed.
const grid = built.grid.slice();
for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
const room = { ...built, grid };

const PLAYER = { x: 140, y: 208 };

/** Sets up the arena: the player pinned, and pinned dummies that cannot die. */
function arena(
  spell: string, targets: readonly [number, number][], seed: string,
): { w: World; bodies: Enemy[]; home: { x: number; y: number }[]; aim: { x: number; y: number } } {
  const w: World = createWorld({
    room, encounter: null, props: 0,
    staff: runStaff(),
    slots: [plainInstance(spell), null, null],
    hearts: 999, rng: src.stream("w", spell, seed, targets.length),
    invincible: true,
  });
  w.player.x = PLAYER.x;
  w.player.y = PLAYER.y;
  const bodies: Enemy[] = targets.map(([dx, dy]) => {
    const e = makeEnemy(w.nextEnemyId++, "rusher", PLAYER.x + dx, PLAYER.y + dy, []);
    e.spawnFadeMs = 0;
    e.hp = 1e7;
    e.maxHp = 1e7;
    e.speed = 0;
    e.awake = true;
    e.attackCooldownMs = 1e9;
    w.enemies.push(e);
    return e;
  });
  const home = bodies.map((e) => ({ x: e.x, y: e.y }));
  const aim = {
    x: home.reduce((t, h) => t + h.x, 0) / home.length,
    y: home.reduce((t, h) => t + h.y, 0) / home.length,
  };
  return { w, bodies, home, aim };
}

/** Puts the bodies and the player back where they started, every step. */
function repin(w: World, bodies: readonly Enemy[], home: readonly { x: number; y: number }[], walking = false): void {
  // Pinned: knockback and pulls are part of what a spell does, but a body
  // shoved out of range would measure the shove, not the damage.
  bodies.forEach((e, i) => { e.x = home[i]!.x; e.y = home[i]!.y; e.attackCooldownMs = 1e9; e.attack = "approach"; });
  // The player is held too, except while a dash spell carries them, and
  // except in the walking scenario, whose whole point is the walk.
  if (!walking && w.player.dashMs <= 0 && w.player.strikeMs <= 0) {
    w.player.x = PLAYER.x;
    w.player.y = PLAYER.y;
  }
}

/**
 * **The player this bench measures is a player who swings.**
 *
 * The sword returns a share of the mana bar on every connecting hit
 * (`MANA_PER_HIT_FRACTION`), and that refund — not passive regeneration — is
 * what actually pays for a spell. Measuring a caster who never touches
 * anything put every spell on a trickle the real game never gives, and the
 * pool was levelled against the sword on that number.
 *
 * Rather than swinging in the bench — which would only feed the spells whose
 * station is inside the sword's reach, and measure the far ones on the old
 * trickle — the refund is **credited directly**, at the rate of a player who
 * lands `SWORD_HITS_PER_S` swings a second. Every station gets the same
 * income, so the pool is compared like for like.
 *
 * **Measured, not guessed.** `pnpm play rule 30 player` prints what the
 * harness's hands actually do over three hours of fighting — `hands: 1.13
 * swings a second, 1.14 casts a second`, and 1.08 to 1.14 over the runs of
 * the difficulty pass — and this is that number. It is the
 * one constant in the bench that decides how hard the whole pool may hit, so a
 * guess here is a guess about every spell: at 1.5 the pool measured a third
 * stronger than it plays and every spell was cut to compensate.
 *
 * It was 0.93, measured on `average` — a profile fitted to logs recorded while
 * the browser ran every room as room 99, and provisional for that reason. The
 * profile to level the pool against is `player`, which is fitted to a real
 * session of the build that shipped, and it swings a sixth more often.
 */
const SWORD_HITS_PER_S = 1.1;

/*
 * **How the key is pressed** (`holdsKey`). Held down, for every spell whose
 * key recasts when the cooldown clears. A `charge` spell is held to a full
 * charge and let go, and its tap — pressed and let go at once — is reported
 * beside it (`tap`), because a key whose tap does nothing would be a dead
 * key and one whose tap does nearly as much would make the charge
 * pointless. A `charges` spell is pressed on every charge, which is the most
 * it can deal a second: its ceiling is the charge rate, never the bank.
 */
/*
 * **Three shapes cannot show their value against a pinned dummy** (doc 006,
 * "Balance gates"), so each is measured in a scenario of its own and held to
 * the same bands as everything else:
 *
 * - **walking** (`trail`): the caster walks a fixed loop through the targets
 *   — a figure of eight about their middle, crossing it twice a lap — at
 *   walking speed, so the ground is laid by the distance walked, as it is
 *   in a fight. A pinned caster lays nothing, which is the rule and not a
 *   measurement.
 * - **attacked** (`stance`): one body strikes the caster on a fixed clock
 *   (`ATTACK_EVERY_MS`), a shot landing on them, and the stance is cast
 *   `STANCE_LEAD_MS` before each strike when the key is ready; the expiry
 *   answer alone — the key held and nothing ever striking — is reported
 *   beside it (`expire`).
 * - **swinging** (`enchant`): the caster swings the sword into the targets
 *   on its ideal chain with the key held, and only the waves' damage is
 *   counted. The sword's own refund is switched off, so the bar is paid the
 *   same credited income every other station is, and a scenario that swings
 *   is not also a scenario with four times the mana.
 */
type Scenario = "pinned" | "walking" | "attacked" | "swinging";
function scenarioOf(i: BaseItem | undefined): Scenario {
  switch (String(i?.params["shape"] ?? "")) {
    case "trail": return "walking";
    case "stance": return "attacked";
    case "enchant": return "swinging";
    default: return "pinned";
  }
}
/** How often the attacked scenario's body lands a strike on the caster. */
const ATTACK_EVERY_MS = 1400;
/** How long before each strike the stance is cast. */
const STANCE_LEAD_MS = 250;
/** The walking loop's half-width and half-height about the targets' middle, px. */
const WALK_RX = 70;
const WALK_RY = 36;

/** The point on the walking loop the caster heads for at `t` ms: a figure of eight at walking pace. */
function walkPoint(aim: { x: number; y: number }, t: number): { x: number; y: number } {
  // About 2 * PI * 58 px a lap at 120 px/s: a lap every three seconds.
  const a = (t / 3000) * Math.PI * 2;
  return { x: aim.x + Math.sin(a) * WALK_RX, y: aim.y + Math.sin(a) * Math.cos(a) * 2 * WALK_RY };
}

/** A shot landed on the caster, from the attacked scenario's body. */
function strikeCaster(w: World): void {
  const b = w.enemyBullets.find((x) => !x.alive);
  if (!b) return;
  b.alive = true; b.x = w.player.x; b.y = w.player.y; b.vx = 0; b.vy = 0;
  b.radius = 3; b.lifeMs = 200; b.damage = 1; b.from = "shooter";
}

function run(
  spell: string, targets: readonly [number, number][],
  affixes: readonly [string, number][] = [], level = 1, hold: ChargeHold = "full",
  scenario: Scenario = scenarioOf(ITEMS.get(spell)),
): { dps: number; burst: number; statusShare: number } {
  // The seed key is the one every existing figure was measured under; a tap run gets its own.
  const key = `${level}:${affixes.map((a) => a.join("")).join(",")}${hold === "tap" ? ":tap" : ""}${scenario === "pinned" || scenario === scenarioOf(ITEMS.get(spell)) ? "" : `:${scenario}`}`;
  const { w, bodies, home, aim } = arena(spell, targets, key);
  if (scenario === "swinging") w.player.mods.manaPerHit = 0;
  // An affix is one fixed effect now; the pair's number is only the seed key it was measured under.
  for (const [id] of affixes) {
    const next = w.spells[0] ? attachAffix(w.spells[0], id) : null;
    if (next) w.spells[0] = next;
  }
  // A level is the other half of a build: +20% damage a level and +10% mana,
  // so a level-five spell is 1.8x the hit for 1.4x the price.
  if (level > 1 && w.spells[0]) w.spells[0] = withLevel(w.spells[0], level);
  let burst = 0;
  // What the **status** did, as against what the hit did: every tick of a
  // burn or a poison reports itself as a `dot:` damage event.
  let status = 0;
  for (let t = 0; t < DURATION_MS; t += STEP_MS) {
    // What the sword would have paid in, had the player been swinging.
    w.player.mana = Math.min(
      w.staff.mana_max,
      w.player.mana + SWORD_HITS_PER_S * MANA_PER_HIT_FRACTION * w.staff.mana_max * (STEP_MS / 1000),
    );
    let input = { ...NO_INPUT, aimX: aim.x, aimY: aim.y, spell: holdsKey(w, 0, hold) ? 0 : null };
    if (scenario === "walking") {
      const to = walkPoint(aim, t + 250);
      input = { ...input, moveX: to.x - w.player.x, moveY: to.y - w.player.y };
    } else if (scenario === "swinging") input = { ...input, swing: true };
    else if (scenario === "attacked") {
      // The press is an edge a lead ahead of each strike; the strike lands on its clock.
      const phase = t % ATTACK_EVERY_MS;
      const due = phase >= ATTACK_EVERY_MS - STANCE_LEAD_MS && phase < ATTACK_EVERY_MS - STANCE_LEAD_MS + STEP_MS;
      input = { ...input, spell: due ? 0 : null };
      if (t > 0 && phase < STEP_MS) strikeCaster(w);
    }
    step(w, input);
    // The ticks of a burn or a poison: what the spell does after it has hit.
    for (const ev of w.events)
      if (ev.kind === "damage" && LINGERING.test(String(ev.what))) status += ev.amount ?? 0;
    repin(w, bodies, home, scenario === "walking");
    if (t < BURST_MS) burst = spellDamage(w, scenario);
  }
  const dealt = spellDamage(w, scenario);
  return {
    dps: dealt / (DURATION_MS / 1000),
    burst,
    statusShare: dealt > 0 ? status / dealt : 0,
  };
}

/** What the spell dealt: everything, or in the swinging scenario everything but the sword's own blows. */
function spellDamage(w: World, scenario: Scenario): number {
  return scenario === "swinging" ? w.stats.damageDealt - w.stats.swordDamage : w.stats.damageDealt;
}

/**
 * **A body that will not stand still.** One dummy at the single station,
 * strafing across the aim, and the cast aimed at where it *was* — which is
 * what a keyboard-aimed shot at a moving body actually is.
 *
 * Without this the bench had nowhere for accuracy to show up: every target
 * was pinned in front of the muzzle, so `seek`, `homing` and the aim assist
 * measured as pure cost. The bare bolt misses a lot of this one.
 */
const STRAFE_PX = 90;
const STRAFE_HZ = 0.55;

function runMoving(spell: string, affixes: readonly [string, number][] = [], level = 1): number {
  const { w, bodies, home, aim } = arena(spell, single, `move:${level}:${affixes.map((a) => a.join("")).join(",")}`);
  // An affix is one fixed effect now; the pair's number is only the seed key it was measured under.
  for (const [id] of affixes) {
    const next = w.spells[0] ? attachAffix(w.spells[0], id) : null;
    if (next) w.spells[0] = next;
  }
  if (level > 1 && w.spells[0]) w.spells[0] = withLevel(w.spells[0], level);
  const body = bodies[0];
  const at = home[0];
  if (!body || !at) return 0;
  for (let t = 0; t < DURATION_MS; t += STEP_MS) {
    // Aimed a fifth of a second behind, at where the body was: a player
    // tracking by hand, not a turret.
    const lag = Math.sin(((t - 200) / 1000) * STRAFE_HZ * Math.PI * 2) * STRAFE_PX;
    step(w, { ...NO_INPUT, aimX: aim.x, aimY: at.y + lag, spell: 0 });
    body.x = at.x;
    body.y = at.y + Math.sin((t / 1000) * STRAFE_HZ * Math.PI * 2) * STRAFE_PX;
    body.attackCooldownMs = 1e9;
    body.attack = "approach";
    if (w.player.dashMs <= 0 && w.player.strikeMs <= 0) { w.player.x = PLAYER.x; w.player.y = PLAYER.y; }
  }
  return w.stats.damageDealt / (DURATION_MS / 1000);
}

/**
 * **The yardstick.** The sword with the key held down for the same twenty
 * seconds at the same pinned bodies, which is the chain at its fastest:
 * `beginSwing` refuses while a swing is still out, so holding gives one swing
 * every `SWING_TOTAL_MS` and never an eaten press.
 *
 * (Pressing on a timer instead measures worse than holding — a press on the
 * frame the last swing is still releasing the player is dropped, so a cadence
 * one frame too fast halves the connects. The key is held here for that
 * reason: the measurement is of the weapon, not of a player's timing.)
 *
 * This is the sword at its best and the player is never at their best, but a
 * ceiling is the honest thing to hang a pool off: a spell that beats the
 * sword's ideal is better than melee in every fight, not only in the ones
 * where the player swings well.
 */
function runSword(targets: readonly [number, number][]): number {
  const { w, bodies, home, aim } = arena("magic_bolt", targets, "sword");
  for (let t = 0; t < DURATION_MS; t += STEP_MS) {
    step(w, { ...NO_INPUT, aimX: aim.x, aimY: aim.y, swing: true });
    repin(w, bodies, home);
  }
  return w.stats.damageDealt / (DURATION_MS / 1000);
}

/**
 * **How many casts a first-room body takes**, which is the thing a player
 * actually feels and the thing a pool levelled by damage-per-second gets
 * wrong. A room-1 rusher and the room-1 ramp, exactly as the game builds it.
 */
function castsToKill(spell: string, dx: number): { casts: number; ms: number } {
  const w: World = createWorld({
    room, encounter: null, props: 0, staff: runStaff(),
    slots: [plainInstance(spell), null, null],
    hearts: 999, rng: src.stream("k", spell), invincible: true,
  });
  w.roomIndex = 1;
  w.player.x = PLAYER.x;
  w.player.y = PLAYER.y;
  const e = makeEnemy(w.nextEnemyId++, "rusher", PLAYER.x + dx, PLAYER.y, [], rampFor(1));
  e.spawnFadeMs = 0;
  e.speed = 0;
  e.awake = true;
  e.attackCooldownMs = 1e9;
  w.enemies.push(e);
  let casts = 0;
  for (let t = 0; t < 30_000; t += STEP_MS) {
    const mana = w.player.mana;
    step(w, { ...NO_INPUT, aimX: e.x, aimY: e.y, spell: holdsKey(w, 0) ? 0 : null });
    if (w.player.mana < mana) casts++;
    if (e.hp <= 0) return { casts, ms: t };
    e.x = PLAYER.x + dx;
    e.y = PLAYER.y;
    e.attackCooldownMs = 1e9;
    e.attack = "approach";
    if (w.player.dashMs <= 0 && w.player.strikeMs <= 0) { w.player.x = PLAYER.x; w.player.y = PLAYER.y; }
  }
  return { casts: Infinity, ms: Infinity };
}

/**
 * **Swings to kill a room-1 body**, swinging on the ideal chain at arm's
 * length: with the key held (an `enchant` kept up, so every swing throws its
 * wave) or with no spell at all (`sword`). `waves` counts only the waves'
 * damage, as swings — what the enchant alone would take. An enchant's casts
 * cannot be counted the way a shot's are, because the cast only arms the
 * sword; the swings are the presses.
 */
function swingsToKill(spell: string | null, dx: number): { swings: number; waves: number } {
  const w: World = createWorld({
    room, encounter: null, props: 0, staff: runStaff(),
    slots: [spell ? plainInstance(spell) : null, null, null],
    hearts: 999, rng: src.stream("s", spell ?? "sword"), invincible: true,
  });
  w.roomIndex = 1;
  w.player.x = PLAYER.x;
  w.player.y = PLAYER.y;
  const e = makeEnemy(w.nextEnemyId++, "rusher", PLAYER.x + dx, PLAYER.y, [], rampFor(1));
  e.spawnFadeMs = 0;
  e.speed = 0;
  e.awake = true;
  e.attackCooldownMs = 1e9;
  w.enemies.push(e);
  let swings = 0;
  let was = 0;
  for (let t = 0; t < 30_000; t += STEP_MS) {
    step(w, { ...NO_INPUT, aimX: e.x, aimY: e.y, swing: true, spell: spell && holdsKey(w, 0) ? 0 : null });
    if (w.player.swingMs > was) swings++;
    was = w.player.swingMs;
    if (e.hp <= 0) break;
    e.x = PLAYER.x + dx;
    e.y = PLAYER.y;
    e.attackCooldownMs = 1e9;
    e.attack = "approach";
    w.player.x = PLAYER.x;
    w.player.y = PLAYER.y;
  }
  const waveHit = spell ? perHit(ITEMS.get(spell)!) : 0;
  return { swings: e.hp <= 0 ? swings : Infinity, waves: waveHit > 0 ? Math.ceil(e.maxHp / waveHit) : Infinity };
}

/**
 * A spell the pool calls a `nuke`, or one that carries its own
 * `cooldown_scale` and so is thrown seldom by design: see `NUKE_HIT_HI`.
 */
const slow = (i: BaseItem) => (i.tags ?? []).includes("nuke") || Number(i.params["cooldown_scale"] ?? 1) >= 1.4;

/** What one projectile of this spell lands, as the damage numbers show it. */
const perHit = (i: BaseItem) =>
  Math.max(1, Math.floor(Number(i.params["damage"] ?? 0) * SPELL_DAMAGE_SCALE));

/*
 * The far station. A `telegraph_ms` spell (Meteor) is measured here too, on
 * a body that is pinned and so **cannot walk out of the mark**: the figure is
 * the landing every time, which a room of moving bodies will sometimes
 * refuse. That is the risk the spell's size is priced for (doc 006), and it
 * is the one thing this bench cannot show.
 */
const single: [number, number][] = [[150, 0]];
const pack: [number, number][] = [[160, -26], [160, 0], [160, 26], [186, -13], [186, 13], [212, 0]];
/*
 * The close-range shapes — blades circling the caster, a dash through what is
 * in front — are measured where they are meant to be used: bodies at arm's
 * length. Measured at 150 px they read as dead, which they are there.
 */
const closeSingle: [number, number][] = [[36, 0]];
const closePack: [number, number][] = [[34, -20], [36, 0], [34, 20], [54, -12], [54, 12], [70, 0]];
const close = (i: BaseItem) => ["orbit", "dash"].includes(String(i.params["shape"] ?? ""))
  // Rings round the caster reach the bodies next to it: a `ring` eruption is
  // cast from inside the crowd, as a `land` dash comes down in it.
  || String(i.params["pattern"] ?? "") === "ring"
  /*
   * A spell the pool calls `melee` is one the player casts from inside the
   * crowd, so that is where it is measured. A ring thrown out all round is a
   * close answer too — and so is a wide cone: a shotgun's pellets only all
   * land at arm's length, which is the whole of what it is, so measuring one
   * at 150 px measures it where it is meant to be weak and reports the
   * identity as a fault.
   */
  || (i.tags ?? []).includes("melee")
  || Number(i.params["spread"] ?? 0) >= 50
  /*
   * A trail is laid wherever the caster walks, and the walking scenario's
   * loop is centred on the targets whichever station they stand at; at arm's
   * length the first lap starts at once rather than after a walk across the
   * room.
   */
  || String(i.params["shape"] ?? "") === "trail";

/* ------------------------------- the sword -------------------------------- */

/**
 * The body the first room is made of, and what the two weapons cost against
 * it. The sword has to stay decisive — a first-room body is a handful of
 * swings, never a chore — and no spell may delete it in one press.
 */
/*
 * **The room-1 body as room 1 actually builds it.** `castsToKill` spawns it
 * through `rampFor(1)`, so the health the bench compares against has to carry
 * the ramp's room-1 multiplier too — otherwise raising body health in the ramp
 * moves the cast count and leaves the swing count quoting a body that does not
 * exist in the game.
 */
const rusherHp = ENEMIES.rusher.hp * ENEMY_HP_SCALE * rampFor(1).hp;
const swordSwings = Math.ceil(rusherHp / SWING_DAMAGE);
/** A first-room body is a few swings, not a chore and not a formality. */
const SWINGS_LO = 3;
const SWINGS_HI = 5;

// The sword only ever reaches what is next to the player, so it is measured
// at the close stations; the far ones would report zero and mean nothing.
const swordSingle = runSword(closeSingle);
/** The sword alone against the room-1 body, in swings, for the enchant starter (`ENCHANT_SAVES`). */
const swordAlone = swingsToKill(null, closeSingle[0]![0]);
const swordPack = runSword(closePack);


/* --------------------------- the upgrade ladder --------------------------- */

/**
 * The affixes a build actually multiplies damage with, in the order they are
 * tried. Everything else in the pool changes a shot's path, its safety or its
 * economy; these are the ones that make a spell hit more, or more often.
 */
const LADDER_SINGLES: readonly string[] = ["kindle", "blight", "rime", "repeat", "fork", "chain", "brand", "pierce"];
/**
 * The pairs that **multiply** rather than add: an element on top of more
 * shots, or more shots on top of more casts. This is the build payoff the run
 * is for, and it is allowed to be loud.
 */
const LADDER_PAIRS: readonly (readonly [string, string])[] = [
  ["kindle", "fork"], ["kindle", "repeat"], ["kindle", "chain"], ["kindle", "scatter"],
  ["blight", "fork"], ["blight", "repeat"], ["blight", "scatter"],
  ["rime", "fork"], ["rime", "repeat"], ["rime", "chain"],
  ["repeat", "fork"], ["repeat", "chain"], ["pierce", "chain"], ["pierce", "repeat"],
];
const TOP = 3;

function fits(item: BaseItem, id: string, held: readonly string[]): boolean {
  const a = SPELL_AFFIXES.find((x) => x.id === id);
  return !!a && affixFitsSpell(a, item, held);
}

/** The best single affix and the best pair on a level-five spell. */
function ladder(item: BaseItem, targets: readonly [number, number][]): {
  best: { name: string; dps: number }; stacked: { name: string; dps: number; affixes: [string, number][] };
} {
  let best = { name: "none", dps: run(item.id, targets, [], SPELL_LEVEL_MAX).dps };
  for (const id of LADDER_SINGLES) {
    if (!fits(item, id, [])) continue;
    const dps = run(item.id, targets, [[id, TOP]], SPELL_LEVEL_MAX).dps;
    if (dps > best.dps) best = { name: id, dps };
  }
  let stacked = { name: best.name, dps: best.dps, affixes: (best.name === "none" ? [] : [[best.name, TOP]]) as [string, number][] };
  for (const [a, b] of LADDER_PAIRS) {
    if (!fits(item, a, []) || !fits(item, b, [a])) continue;
    const affixes: [string, number][] = [[a, TOP], [b, TOP]];
    const dps = run(item.id, targets, affixes, SPELL_LEVEL_MAX).dps;
    if (dps > stacked.dps) stacked = { name: `${a}+${b}`, dps, affixes };
  }
  return { best, stacked };
}

/* --------------------------------- the pool ------------------------------- */

const spells = [...ITEMS.values()];
const rows = spells.map((i) => {
  const near = close(i);
  const one = near ? closeSingle : single;
  const many = near ? closePack : pack;
  const a = run(i.id, one);
  const b = run(i.id, many);
  const lad = QUICK ? null : ladder(i, one);
  const kill = castsToKill(i.id, near ? closeSingle[0]![0] : single[0]![0]);
  const swung = itemShape(i) === "enchant" ? swingsToKill(i.id, closeSingle[0]![0]) : null;
  const tap = Number(i.params["charge"] ?? 0) > 0 ? run(i.id, one, [], 1, "tap").dps : null;
  const stackedPack = QUICK || !lad ? 0 : run(i.id, many, lad.stacked.affixes, SPELL_LEVEL_MAX).dps;
  // A stance's expiry answer alone: the key held, nothing ever striking.
  const expire = itemShape(i) === "stance" ? run(i.id, one, [], 1, "full", "pinned").dps : null;
  return {
    id: i.id, mana: i.mana, single: a.dps, pack: b.dps, burst: a.burst, statusShare: a.statusShare,
    tags: i.tags ?? [], shape: itemShape(i), hit: perHit(i), kill: kill.casts, killMs: kill.ms, swung, slow: slow(i),
    proc: procWeight(i.params, Number(i.params["count"] ?? 1)),
    maxLevel: lad ? run(i.id, one, [], SPELL_LEVEL_MAX).dps : 0,
    best: lad?.best ?? { name: "-", dps: 0 },
    stacked: lad?.stacked ?? { name: "-", dps: 0, affixes: [] as [string, number][] },
    stackedPack, tap, expire, scenario: scenarioOf(i),
  };
});
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
const mPack = median(rows.map((r) => r.pack));

/**
 * What the run asserts. Doc 006's first balance rule — "each attack, placed
 * alone on the run staff, must land in its rarity's DPS band" — was printed
 * and not enforced, so a spell could sit at three times the pool's median
 * through a whole release and the only thing that noticed was a person
 * reading a table.
 */
const failures: string[] = [];
/** The least of a `dot` spell's damage that has to come from its status. */
const DOT_STATUS_SHARE = 0.6;

/**
 * **How hard a base spell may land in one hit**, as a multiple of a swing.
 *
 * Big hits, thrown seldom: a swing lands every 267 ms and a spell about once
 * a second, so a spell that is worth a key has to arrive with two or three
 * swings' worth at once. What stops that becoming a one-shot is the roster's
 * health (`ENEMY_HP_SCALE`), not a small number here — this only catches a
 * spell that has run away from the rest of the pool.
 *
 * A spell of several pieces — a fan of pellets, a ring of shards, three
 * circling blades — is measured **per piece**, because that is the number the
 * player sees over one body. What all of them land on one body together is
 * the damage-per-second band's business, and the bench measures it where the
 * spell is meant to be used (see `close`).
 */
const HIT_HI = 3.0;
/**
 * **The slow-nuke exception.** A spell the pool calls a `nuke`, or one that
 * carries its own `cooldown_scale` and so is thrown seldom by design, lands
 * proportionally harder — that is the whole of what a nuke is. Eight swings
 * is the dearest spell in the pool thrown at its own rate.
 */
const NUKE_HIT_HI = 8.0;
/**
 * **What a first-room body costs**, in casts, against the sword's three
 * swings. Two is a spell worth pressing; six is a spell the player stops
 * pressing. Asserted on the five style starters, which are the spells a
 * player meets before they have any choice about it.
 */
const KILL_LO = 2;
const KILL_HI = 3;
/*
 * **An `enchant` starter is judged in swings**, because its cast only arms
 * the sword and the swings are what the player presses (`swingsToKill`). The
 * same promise said that way: with the enchant up a room-1 body dies
 * **clearly faster** than to the sword alone — at least `ENCHANT_SAVES`
 * swings fewer — and the waves alone would take it in a handful of swings,
 * no more than `ENCHANT_WAVES_HI`, so the waves are a weapon and not a
 * garnish on the sword.
 */
const ENCHANT_SAVES = 1;
const ENCHANT_WAVES_HI = 6;
/**
 * And how long a first-room body may take a `dot` starter, in ms. Its damage
 * arrives on the status's clock rather than on the press, so presses are the
 * wrong unit; this is the same target said in seconds. The sword takes about
 * a second and a quarter.
 */
const KILL_MS = 4000;
/** The five style starters: the one spell each run begins with (`STYLE_START`). */
const STARTERS: readonly string[] = Object.values(STYLE_START);
/**
 * **Damage per second, against the sword: the pool's real level.**
 *
 * Just under it, and not over: the sword is free, has no cooldown and is
 * always loaded, so a spell that beat it per second on one body would make
 * the mana bar the only weapon that mattered. Just under means a key is worth
 * pressing at the body in front of you as well as at the one across the room.
 *
 * A spell of several pieces counts **everything that lands on one body at the
 * range it is meant to be used at** — every pellet of the cone, every shard
 * of the ring — which is why those are measured at arm's length (`close`).
 * Their advantage on a crowd is their identity and is billed separately
 * (`AREA_PACK_FLOOR`, `PACK_CEILING`).
 */
/*
 * Lowered from 0.875 and 0.75 when spells went back to the old price and
 * Echo was taken out: the bar is now the limit on a held key, so a cheap
 * spell sustains about two thirds of the sword over twenty seconds rather
 * than nine tenths, and the sword is the income as well as the weapon. The
 * heavy spells, which their cooldowns already held back, barely moved.
 */
const BASE_TARGET = 0.7;
const BASE_HI = 1.0;
const BASE_LO = 0.55;
/**
 * How far below the cluster an **area** spell may sit on one body. A crowd
 * specialist trades single-target for a crowd; what it owes for the privilege
 * is `AREA_PACK_FLOOR`.
 *
 * A **damage-over-time** spell gets no such allowance, even when it is also
 * tagged `area`: a status is paid out on one body as well as on many, and the
 * Affliction style is built of these spells from its first room, so a burn or
 * a poison below the generalists' floor left that style the only one whose
 * average player seldom reached the boss. It is held to `BASE_LO` like the rest.
 */
const AREA_LO = 0.45;
/**
 * **What an `area` spell has to be worth against six bodies**, as a multiple
 * of what it does to one. Measured against itself rather than against the
 * pool, because a pool median moves whenever the pool does and an area
 * spell's promise does not: cast into a crowd, it does more than it would
 * into one body. Below this it is a single-target spell wearing the tag.
 */
const AREA_PACK_FLOOR = 1.3;
/**
 * And the crowd advantage no *base* spell may exceed, as a share of what the
 * sword clears in the same twenty seconds. The sword sweeps 170 degrees and
 * catches five bodies at arm's length, so its pack figure is already the best
 * in the game; an area spell may beat it by a third, which is what makes it
 * the answer to a crowd, and not by half again, which would make it the
 * answer to every room before a single upgrade is taken.
 */
const PACK_CEILING = 1.35;
/**
 * The widest the base cluster may spread, best over worst — over the
 * generalists only. An `area` or `dot` specialist is allowed to sit below
 * them because `AREA_PACK_FLOOR` bills it for the difference.
 */
// Widened from x1.45 with the price: the cheap keys fell and the cooldown-bound heavy ones did not.
const SPREAD_MAX = 1.6;
/**
 * **Every spell must have a build that clearly passes the sword**, or there is
 * no reason to put gold into it. Measured at level five with the best pair of
 * affixes that fits its shape, on whichever of the two targets that build is
 * for — a field or a pull is built to clear a crowd, not to out-damage a
 * swing on one body.
 */
const LADDER_FLOOR = 1.15;
/**
 * And a loose sanity ceiling. Explosive is the point — a finished build is
 * meant to be two or three times the sword, and the best of them more — so
 * this only catches a combination that has stopped being a build and started
 * being a bug. `LADDER_SPREAD` is the real guard: it is the top build against
 * the *median* one, which is what "no single combo far beyond every other"
 * actually means.
 */
const LADDER_CEILING = 5.0;
/** No one build may be this far past the median finished build. */
const LADDER_SPREAD = 3.0;

// A ward is a defence; its value is the shots and bodies it stops, which a
// pinned dummy cannot show, so it is reported and not asserted on.
const defence = (r: { shape: string }) => r.shape === "pillar";

console.log(
  `${rows.length} spells, each alone on a key for ${DURATION_MS / 1000}s with a run's mana.\n`
  + `sword, swung on its ideal chain for the same ${DURATION_MS / 1000}s: `
  + `${swordSingle.toFixed(1)} dps single, ${swordPack.toFixed(1)} dps pack. Pool pack median ${mPack.toFixed(1)}.\n`
  + `a sword hit is ${SWING_DAMAGE}; a room-1 rusher has ${rusherHp} hp (roster x${ENEMY_HP_SCALE}, room-1 ramp x${rampFor(1).hp}) and takes ${swordSwings} swings.\n`
  + `base spells land near ${(BASE_TARGET * 100).toFixed(0)}% of the sword a second, in hits of up to ${HIT_HI}x a swing `
  + `(${NUKE_HIT_HI}x for a slow nuke); a finished build must pass the sword.\n`,
);
console.log(`${"id".padEnd(16)} mana   hit  xsword  proc  kill  time  single  pack    dps vs sword   pack vs own`);
for (const r of [...rows].sort((a, b) => b.single / swordSingle - a.single / swordSingle)) {
  const s = r.single / swordSingle;
  const p = r.pack / swordPack;
  const hit = r.hit / SWING_DAMAGE;
  // What the crowd is worth to this spell: its pack against its own single.
  const pool = r.single > 0 ? r.pack / r.single : 0;
  const area = r.tags.includes("area");
  const lo = area && !r.tags.includes("dot") ? AREA_LO : BASE_LO;
  const flags: string[] = [];
  const nuke = r.slow;
  if (!defence(r)) {
    // The hit first: it is what the player reads, and what one-shots a room.
    if (hit > (nuke ? NUKE_HIT_HI : HIT_HI))
      flags.push(`HIT ${r.hit} is ${hit.toFixed(2)}x a sword's${nuke ? " (nuke, cap 1.5x)" : ""}`);
    /*
     * **No single projectile may delete a first-room body**, whatever else a
     * cast does. That is what "one shot kills a monster" meant, and it is the
     * rule a fan can keep while still being lethal pressed against a body: a
     * shotgun emptied point-blank is meant to end a trash mob, one pellet is
     * not. A slow nuke is exempt — deleting one body is what it is bought for
     * — and pays for it in mana and cooldown.
     */
    if (!nuke && r.hit >= rusherHp)
      flags.push(`one projectile (${r.hit}) deletes a room-1 rusher (${rusherHp} hp)`);
    /*
     * And a starter must be worth pressing: not a chore, and not a formality.
     *
     * A spell of several projectiles is exempt from the floor, because what
     * makes it lethal is standing close enough to land all of them. A `dot`
     * starter is judged on **time** instead of on presses: a burn is paid out
     * over its own two and a half seconds, so counting the presses a player
     * makes while it works counts the same kill several times. What matters
     * either way is that a first-room body does not become a chore.
     */
    if (STARTERS.includes(r.id)) {
      const pieces = Number(ITEMS.get(r.id)?.params["count"] ?? 1);
      if (r.swung) {
        if (r.swung.swings > swordAlone.swings - ENCHANT_SAVES || r.swung.waves > ENCHANT_WAVES_HI)
          flags.push(`a room-1 rusher takes ${r.swung.swings} swings enchanted against the sword's ${swordAlone.swings}, and ${r.swung.waves} swings of waves alone (want at least ${ENCHANT_SAVES} fewer, and at most ${ENCHANT_WAVES_HI})`);
      } else if (r.tags.includes("dot")) {
        if (r.killMs > KILL_MS)
          flags.push(`a room-1 rusher takes ${(r.killMs / 1000).toFixed(1)}s (want under ${KILL_MS / 1000}s)`);
      } else if (r.kill > KILL_HI || (r.kill < KILL_LO && pieces <= 1)) {
        flags.push(`a room-1 rusher takes ${r.kill} casts (want ${KILL_LO}-${KILL_HI})`);
      }
    }
    if (s > BASE_HI) flags.push(`OVER ${(s * 100).toFixed(0)}% of the sword a second`);
    if (s < lo) flags.push(`UNDER ${(s * 100).toFixed(0)}% of the sword a second`);
    // An area spell owes a crowd advantage, whatever else it does.
    if (area && pool < AREA_PACK_FLOOR)
      flags.push(`AREA but only ${pool.toFixed(2)}x its own single on a pack`);
    if (p > PACK_CEILING) flags.push(`PACK ${(p * 100).toFixed(0)}% of the sword's`);
  }
  for (const f of flags) failures.push(`${r.id}: ${f}`);
  /*
   * **Most of a damage-over-time spell's value is in its status** (doc 006).
   * A `dot` spell whose burn or poison is a decoration on a direct hit is a
   * direct-damage spell wearing the wrong tag, and the player who took it for
   * the element gets neither: at six damage a hit and a gauge needing three
   * of them, the body died on the hit that would have lit it.
   */
  const dot = r.tags.includes("dot");
  if (dot && r.statusShare < DOT_STATUS_SHARE)
    failures.push(`${r.id} is tagged dot but only ${(r.statusShare * 100).toFixed(0)}% of its damage is the status`);
  console.log(
    `${r.id.padEnd(16)} ${String(r.mana).padStart(4)}  ${String(r.hit).padStart(4)}  ${hit.toFixed(2).padStart(6)}  ${r.proc.toFixed(2).padStart(4)}  `
    + `${(Number.isFinite(r.kill) ? String(r.kill) : "-").padStart(4)} ${(Number.isFinite(r.killMs) ? (r.killMs / 1000).toFixed(1) : "-").padStart(5)}s  ${r.single.toFixed(1).padStart(6)}  ${r.pack.toFixed(1).padStart(5)}   `
    + `${s.toFixed(2)} / ${p.toFixed(2)}`
    + `          ${pool.toFixed(2)}`
    + `${dot ? `  status ${(r.statusShare * 100).toFixed(0)}%` : ""}`
    + `${defence(r) ? "  (defence: not measured by damage)" : ""}`
    + `${r.tap !== null ? `  tapped ${(r.tap / swordSingle).toFixed(2)}` : ""}`
    + `${r.scenario !== "pinned" ? `  (${r.scenario})` : ""}`
    + `${r.expire !== null ? `  expire-only ${(r.expire / swordSingle).toFixed(2)}` : ""}`
    + `${flags.length ? `  ${flags.join("; ")}` : ""}`,
  );
}

if (swordSwings < SWINGS_LO || swordSwings > SWINGS_HI)
  failures.push(`the sword takes ${swordSwings} swings on a room-1 rusher (want ${SWINGS_LO}-${SWINGS_HI}); ENEMY_HP_SCALE is ${ENEMY_HP_SCALE} and the room-1 ramp is x${rampFor(1).hp}`);

// The cluster's spread, over the generalists: see `SPREAD_MAX`.
const cluster = rows
  .filter((r) => !defence(r) && !r.tags.includes("area") && !r.tags.includes("dot"))
  .map((r) => r.single / swordSingle);
const spread = Math.max(...cluster) / Math.min(...cluster);
console.log(`\nbase dps cluster (generalists): ${(Math.min(...cluster) * 100).toFixed(0)}%-${(Math.max(...cluster) * 100).toFixed(0)}% of the sword, spread x${spread.toFixed(2)} (max x${SPREAD_MAX})`);
if (spread > SPREAD_MAX) failures.push(`the base cluster spreads x${spread.toFixed(2)}, wider than x${SPREAD_MAX}`);
const all = rows.filter((r) => !defence(r)).map((r) => r.single / swordSingle);
console.log(`whole pool: ${(Math.min(...all) * 100).toFixed(0)}%-${(Math.max(...all) * 100).toFixed(0)}% of the sword`);

/*
 * The three scenarios (doc 006), each spell measured in its own beside the
 * sword's figures at the same station, so the rows above are read knowing
 * which of them were not measured pinned.
 */
for (const r of rows)
  if (r.swung)
    console.log(`${r.id}: a room-1 rusher takes ${r.swung.swings} swings enchanted, ${swordAlone.swings} to the sword alone, ${r.swung.waves} swings of waves alone`);
console.log(`\nscenarios: walking (a figure-eight loop through the targets), attacked (a strike every ${ATTACK_EVERY_MS} ms, the stance cast ${STANCE_LEAD_MS} ms before it), swinging (the sword on its ideal chain, waves only)`);
for (const r of rows.filter((x) => x.scenario !== "pinned"))
  console.log(
    `  ${r.id.padEnd(16)} ${r.scenario.padEnd(9)} single ${(r.single / swordSingle).toFixed(2)}  pack ${(r.pack / swordPack).toFixed(2)}`
    + `${r.expire !== null ? `  expire-only ${(r.expire / swordSingle).toFixed(2)}` : ""}`,
  );

/* ------------------------------- the ladder ------------------------------- */

if (!QUICK) {
  console.log(`\nwhat a build does to each spell, against the sword (level ${SPELL_LEVEL_MAX}, affixes as they are):`);
  console.log(`${"id".padEnd(16)} base   max    max+affix         max+stack                  stack pack`);
  const finished = rows.filter((r) => !defence(r)).map((r) => r.stacked.dps / swordSingle);
  const mFinished = median(finished);
  for (const r of [...rows].sort((a, b) => b.stacked.dps - a.stacked.dps)) {
    const x = (v: number) => (v / swordSingle).toFixed(2);
    console.log(
      `${r.id.padEnd(16)} ${x(r.single).padStart(5)}  ${x(r.maxLevel).padStart(5)}  `
      + `${(`${r.best.name} ${x(r.best.dps)}`).padEnd(18)}${(`${r.stacked.name} ${x(r.stacked.dps)}`).padEnd(27)}`
      + `${(r.stackedPack / swordPack).toFixed(2).padStart(5)}`,
    );
    if (defence(r)) continue;
    /*
     * Against the sword on **whichever target the build is for**. A field or a
     * pull is built to clear a crowd, not to out-damage a swing on one body,
     * and asking it to beat the sword single-target would be asking it to
     * stop being what it is.
     */
    const top = Math.max(r.stacked.dps / swordSingle, r.stackedPack / swordPack);
    if (top < LADDER_FLOOR)
      failures.push(`${r.id} has no build that passes the sword: best is ${top.toFixed(2)}x with ${r.stacked.name}`);
    if (top > LADDER_CEILING)
      failures.push(`${r.id} at ${top.toFixed(2)}x the sword with ${r.stacked.name} is past the sanity ceiling`);
    if (top > mFinished * LADDER_SPREAD)
      failures.push(`${r.id} with ${r.stacked.name} is ${(top / mFinished).toFixed(1)}x the median finished build`);
  }
  console.log(`median finished build: ${mFinished.toFixed(2)}x the sword (floor ${LADDER_FLOOR}, ceiling ${LADDER_CEILING})`);
}

/*
 * The affixes, on the plain bolt, at their top tier — and the pairs that
 * multiply. The question is whether any one loadout is so far ahead that the
 * rest are not worth taking, which is what `scatter + repeat` was.
 */
const LOADOUTS: readonly [string, readonly [string, number][]][] = [
  ["bare", []],
  ["repeat 3", [["repeat", 3]]],
  ["scatter 3", [["scatter", 3]]],
  ["repeat 3 + scatter 3", [["repeat", 3], ["scatter", 3]]],
  ["fork 3", [["fork", 3]]],
  ["chain 3", [["chain", 3]]],
  ["pierce 3", [["pierce", 3]]],
  ["seek 3", [["seek", 3]]],
  ["kindle 3", [["kindle", 3]]],
  ["blight 3", [["blight", 3]]],
  ["brand 3", [["brand", 3]]],
  ["harvest 3", [["harvest", 3]]],
  ["pierce 3 + chain 3", [["pierce", 3], ["chain", 3]]],
  ["kindle 3 + fork 3", [["kindle", 3], ["fork", 3]]],
];
console.log(`\naffix loadouts on magic_bolt, same 20 s (moving: a strafing body, aimed at where it was):`);
console.log(`${"loadout".padEnd(24)} single  pack  moving      vs bare`);
const bare = run("magic_bolt", single);
const bareMoving = runMoving("magic_bolt");
for (const [name, affixes] of LOADOUTS) {
  const a = run("magic_bolt", single, affixes);
  const b = run("magic_bolt", pack, affixes);
  const m = runMoving("magic_bolt", affixes);
  console.log(
    `${name.padEnd(24)} ${a.dps.toFixed(1).padStart(6)}  ${b.dps.toFixed(1).padStart(5)}  ${m.toFixed(1).padStart(6)}`
    + `   x${(a.dps / bare.dps).toFixed(2)} single, x${(m / bareMoving).toFixed(2)} moving`,
  );
}

/*
 * **`seek` may not be a loss.** It measured at 0.56 of the bare bolt on a
 * dummy the shot was already pointed at: a 75% mana surcharge on a spell the
 * mana bar rations, for steering that a pinned target cannot show. The
 * surcharge is gone (`affixCostMult`), so it is now free on one body and
 * worth taking on a body that moves — which is the only place accuracy has
 * ever been worth anything.
 */
const seekSingle = run("magic_bolt", single, [["seek", 3]]).dps / bare.dps;
const seekMoving = runMoving("magic_bolt", [["seek", 3]]) / bareMoving;
console.log(`\nseek 3 on the bolt: x${seekSingle.toFixed(2)} on a pinned body, x${seekMoving.toFixed(2)} on a moving one`);
if (seekSingle < 0.99) failures.push(`seek 3 is a loss on a pinned body at x${seekSingle.toFixed(2)} of the bare bolt`);
if (seekMoving <= 1.05) failures.push(`seek 3 buys nothing against a moving body: x${seekMoving.toFixed(2)} of the bare bolt`);

/*
 * The gate. Doc 006's balance rules were printed and never asserted, so a
 * spell could sit at three times the pool's median for a whole release with
 * nothing but a table to notice. `pnpm verify` runs this.
 */
if (failures.length > 0) {
  console.log(`\nspell-bench: FAIL, ${failures.length} balance violations`);
  for (const f of failures) console.log(`  ${f}`);
  process.exitCode = 1;
} else {
  console.log(`\nspell-bench: OK — every base spell under the sword and clustered, every dot carried by its status, every spell with a build that passes the sword`);
}
