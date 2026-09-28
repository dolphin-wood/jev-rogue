/**
 * **The Frontier Veteran**: room 10's guardian (doc 024).
 *
 * The warden's body with a guardian's state: a heavy body's poise, its
 * blunderbuss and its shield shove, and the tank's ram (`chooseMelee`). A
 * head-on wall knocks it out (`guardianWallSlam`). It has no phases: an
 * elite's fight is one fight. What it has beyond a warden is **the call**: it
 * raises its arm and the room's dead answer, a squad round it; nothing breaks
 * it while its arm is up. The opening is a player-safe laser demonstration
 * (the lanes still have real hitboxes if the player walks into them); one
 * mid-fight call is the only squad it ever brings. It is not a new
 * archetype, so the warden's frames, death and renderer all hold; nothing
 * assembles it into an ordinary room.
 */
import { dropFireToken, dropToken, makeEnemy, POISE_BREAK_MS, POISE_GUARD_MS } from "./enemy.ts";
import type { Enemy, World } from "./types.ts";
import type { EnemyId } from "../types.ts";
import { rampFor } from "../encounters/ramp.ts";
import { ENEMIES } from "../encounters/enemies.ts";
import { bossSummonSpots } from "./world.ts";
import { castRift, lineToWall } from "./attacks.ts";
import { eruptRing } from "./cast.ts";
import { noPowers } from "../content/tags.ts";
import { GRID_W, TILE_PX, Tile } from "../types.ts";

/** Its bar. Sized for a room-10 build to take 40 to 60 s; `pnpm play` sets it (doc 024). */
export const GUARDIAN_HP = 1300;
/**
 * What its blows and shots cost, as a multiple of a warden's. Not the room's
 * ramp band (×1.45 at room 10): on a body that rams and sprays from across the
 * room that measured at five and a half hearts a fight, and nearly every run
 * ended here.
 */
export const GUARDIAN_POWER = 0.5;
/**
 * What one hit of its spray costs, in hearts: a warden's shot is a whole heart
 * and a burn, and it was the larger half of what the guardian cost a weaker
 * player — the burn stays, the heart does not.
 */
export const GUARDIAN_FLAME = 0.6;
/**
 * Its blunderbuss's period, as a multiple of a warden's 4.2 s. A warden's shot
 * is its whole threat; the guardian's is half of it, with the ram the other
 * half, and at a warden's pace the spray alone cost about four hearts a fight.
 * The current 3.5× period leaves a real punish window between shots while its
 * enlarged fire lane remains dangerous.
 */
export const GUARDIAN_SHOT_EVERY = 3.5;
/**
 * Its poise (`Enemy.poise`): about four sword hits in a row at room 10 before
 * one interrupts it, and none while it is still guarded after the last break.
 * It cannot be held down; it can be broken by a burst, or knocked out on a wall.
 */
export const GUARDIAN_POISE = 60;
/** How much larger it is than a warden, drawn and in body: not necessarily a whole number (doc 024). */
export const GUARDIAN_SCALE = 2;
/** The Veteran's close-range swings and fire breath reach this much farther. */
export const GUARDIAN_ATTACK_RANGE_MULT = 2;
/** A small extra pause after ordinary melee turns, without lengthening or shortening their tells. */
export const GUARDIAN_ATTACK_GAP_MULT = 2;
/** The ram needs a longer reset than the Veteran's other close attacks. */
export const GUARDIAN_CHARGE_GAP_MULT = 2.8;
/** A visible punish window after every completed Veteran action, shared by every attack family. */
export const GUARDIAN_ACTION_GAP_MS = 2500;
/** The Veteran's fire cone is wider than a warden's, while its length uses the range multiplier. */
export const GUARDIAN_MUSKET_SPREAD_MULT = 1.5;
/** What its death pays in experience: an ordinary room's take, at its top (`KING_AUDIENCE_XP`'s reasoning). */
export const GUARDIAN_XP = 110;
/**
 * Hearts its death leaves, flying to the player: the heal after the fight
 * (doc 024). It is the run's second-hardest room, and the rooms after it are
 * the last stretch before the throne; the first audience needs none, since
 * its spare hearts come home when he leaves.
 */
export const GUARDIAN_HEARTS = 2;
/** The squad a later call brings: bodies the player has known since the opening rooms. */
export const GUARDIAN_SQUAD: readonly EnemyId[] = ["rusher", "shooter"];
/** The cap on the one mid-fight squad call. */
export const GUARDIAN_ENTRANCE_MAX = 4;
/** The ordinary room wave is kept light because the Veteran adds its own squad later. */
export const GUARDIAN_OPENING_MAX = 3;
/** How long it holds its arm up before the dead answer: the call's telegraph, and the player's window. */
export const GUARDIAN_CALL_MS = 1100;
/** The room is live for this long before the Veteran and its pack notice the player. */
export const GUARDIAN_INTRO_PRE_MS = 1000;
/** The local noticing beat: the upper-right exclamation marks stay up for one second. */
export const GUARDIAN_INTRO_NOTICE_MS = 1000;
/** Long enough for the notice, all opening beams, and their live flashes before control returns. */
export const GUARDIAN_INTRO_MS = GUARDIAN_INTRO_PRE_MS + GUARDIAN_INTRO_NOTICE_MS + 1900;
/** A clean player turn after the entrance before the fight starts answering. */
export const GUARDIAN_INTRO_RECOVERY_MS = 3000;
/** How long after the opening demonstration before its one squad call. */
export const GUARDIAN_MID_CALL_DELAY_MS = 18_000;
/**
 * **Its stakes** (地刺): the old soldier's other move, the frontier's own —
 * the gun's butt driven into the floor and the ground answering in stakes.
 * Both are rifts, the roster's one "this ground erupts" (`castRift`), so the
 * warning is the one the player has read since the rifter: the lanes or the
 * ring drawn on the floor, then the stakes. It stands planted for all of it.
 *
 * - **The stake line**, at range: three lanes fanned at the player.
 * - **The palisade**, on a player who has stuck to it: rings of stakes
 *   breaking out round it one after another — the player's Quake Ring in its
 *   hands, larger and violet (`eruptRing`, a hostile cast) — so that standing
 *   in its shadow is not the answer to its poise.
 */
export const GUARDIAN_STAKES_EVERY_MS = 11_000;
/** How long the stakes' ground is drawn before it erupts. */
export const GUARDIAN_STAKES_TELE_MS = 1200;
/** How long it stands planted after they go up: the stakes' own window. */
const GUARDIAN_STAKES_REST_MS = 450;
/** The stake line's lanes, their spread either side of the player, and their reach. */
const STAKE_LANES = 3;
const STAKE_SPREAD = 0.4;
const STAKE_REACH = TILE_PX * 9;
/** Nearer than this the player is "stuck to it", and it throws the palisade instead. */
const PALISADE_NEAR = TILE_PX * 3;
/** The palisade: rings, the gap between them, and the beat between one ring and the next. */
const PALISADE_RINGS = 3;
const PALISADE_STEP = TILE_PX * 1.1;
const PALISADE_RING_MS = 150;
/** Each stake's size, a Quake Ring cell's and a half. */
const PALISADE_CELL = 20;
/**
 * **The volley** (排枪): the commander's own move. Its arm goes up and the
 * drowned line fires across the room out of its walls: lines from one side
 * of the room to the other, through whatever stands in the room, each run
 * out from its wall in a flash, then held for the player to read, then a
 * bolt of light down the whole of it at once, gone like lightning.
 *
 * **They are aimed at the player.** Every line crosses the ground within
 * `VOLLEY_NEAR` of where the player stands, at angles spread round the
 * clock, and one runs through the player's own feet: the lines cross thick
 * where the player is and part as they go, so the answer is to move — out
 * along a gap — and never to stand. Lines scattered across the room missed
 * a player who had not moved at all.
 *
 * **It stands for the whole of it**, arm raised, until the last line has
 * fired, and **its squad goes to ground** (`Enemy.hideMs`): the player reads
 * the lines and nothing else, and its planted body is there to be hit by a
 * player who finds a gap on its side.
 */
export const GUARDIAN_VOLLEY_EVERY_MS = 24_000;
/** How long a volley line is drawn before it fires: long, as the player has to read several at once. */
export const GUARDIAN_VOLLEY_TELE_MS = 2000;
/** The lines in a volley, and the beat between one and the next coming due. */
const VOLLEY_LINES = 9;
const VOLLEY_STAGGER_MS = 110;
/** How far from the player a line may cross: the rest pass within this, one through the player. */
const VOLLEY_NEAR = TILE_PX * 2.5;
/** How far a line's angle strays from its even share of the clock. */
const VOLLEY_ANGLE_JITTER = 0.18;
/**
 * How wide a volley line's hit is: thin, many of them rather than a few
 * broad ones, so the room reads as lanes and not as walls. What hits is the
 * line's white core; the glow round it is harmless (`riftHits`, `BEAM_GRAZE`).
 */
const VOLLEY_WIDTH = TILE_PX * 0.3;
/** The opening demonstration uses the same volley grammar, with lanes offset from the player. */
const INTRO_VOLLEY_LINES = 9;
const INTRO_VOLLEY_NEAR = TILE_PX * 2.5;
const INTRO_VOLLEY_MIN_OFFSET = TILE_PX * 0.72;
const INTRO_VOLLEY_STAGGER_MS = 70;
const INTRO_VOLLEY_TELE_MS = 950;
/** How long it stands after the last line has fired, its arm coming down. */
const VOLLEY_REST_MS = 400;
/** The whole of the volley, order to last bolt: it stands through it, and its squad stays under. */
export const GUARDIAN_VOLLEY_MS = GUARDIAN_VOLLEY_TELE_MS + (VOLLEY_LINES - 1) * VOLLEY_STAGGER_MS;
/** How long its squad takes to sink out of sight. */
export const GUARDIAN_SINK_MS = 400;
/**
 * **Its stance** (架势): the fight's big opening beside the wall. Every hit
 * on it wears the stance, shown as a gold bar under its health; a poise
 * break wears `GUARDIAN_BREAK_STANCE` of it more and a wall
 * `GUARDIAN_WALL_STANCE`. Worn through, it is **broken**: on its knees for
 * `GUARDIAN_BROKEN_MS` with stars over its head, whatever it was doing
 * dropped (a call it was making goes unanswered), taking
 * `GUARDIAN_BROKEN_TAKEN` from every hit. A poise break interrupts; this is
 * what the pressure was for. Left alone for `STANCE_HOLD_MS` it steadies,
 * `STANCE_DRAIN` a second.
 *
 * About 300 is eight seconds of a room-10 build's steady damage, so a
 * player who stays on it breaks it two or three times a fight.
 */
export const GUARDIAN_STANCE = 300;
export const GUARDIAN_BREAK_STANCE = 0.1;
export const GUARDIAN_WALL_STANCE = 0.35;
export const GUARDIAN_BROKEN_MS = 3200;
export const GUARDIAN_BROKEN_TAKEN = 1.5;
const STANCE_HOLD_MS = 3000;
const STANCE_DRAIN = 30;
/**
 * **The ram twice**: a ram that ends without its wall comes round again after
 * a deliberate beat, the second off the first's recovery. Each is another
 * chance at the wall, but the beat keeps the pair from reading as one loop.
 */
const GUARDIAN_CHAIN_REST_MS = 1500;
/** What a stake costs, in hearts: a warden's blow at the guardian's power. */
const STAKE_DAMAGE = 1;
/** Its one mid-fight squad is the only wave it ever calls. */

export interface GuardianState {
  /** Time until its one mid-fight call. It is infinite after that call starts. */
  callMs: number;
  /** Whether the one mid-fight wave has already been scheduled. */
  called: boolean;
  /** Time until it may drive its stakes again. */
  stakesMs: number;
  /** Time until it may order a volley. */
  volleyMs: number;
  /** Whether its last ram has already been followed by a second, and whether the next blow must be one. */
  chained: boolean;
  chainNext: boolean;
  /** Whether it was in a ram last step, to see the one that just ended. */
  wasCharging: boolean;
  /** Whether its arm is up in a call, to see the call end. */
  calling: boolean;
  /** Who the one mid-fight call brings. */
  answer: EnemyId[];
  /** Where they rise, fixed as the arm goes up and marked on the floor through the call. */
  spots: { x: number; y: number }[];
  /** Its stance worn so far, toward `GUARDIAN_STANCE`; the gold bar. */
  stance: number;
  /** Time since a hit last wore its stance; past `STANCE_HOLD_MS` it steadies. */
  stanceIdleMs: number;
  /** While its stance is broken: on its knees, counting down. */
  brokenMs: number;
  /** The two one-shot beats of the entrance cutscene. */
  introNoticeSent: boolean;
  introVolleyArmed: boolean;
  /** Post-entrance player turn: ordinary fire and guardian moves stay paused. */
  introGraceMs: number;
  /** One shared post-action window: melee, gunfire, stakes and volleys all wait on it. */
  actionGapMs: number;
  /** Whether it was in any combat action last step, used to start the shared gap on completion. */
  wasAttacking: boolean;
}

/** The guardian, standing where it is put, on its own bar, with its mid-fight call to make. */
export function makeGuardian(id: number, x: number, y: number, _roomIndex: number, entrance: readonly EnemyId[] = GUARDIAN_SQUAD): Enemy {
  const e = makeEnemy(id, "warden", x, y, [], { power: GUARDIAN_POWER });
  e.guardian = {
    callMs: GUARDIAN_MID_CALL_DELAY_MS, stakesMs: GUARDIAN_STAKES_EVERY_MS / 2, volleyMs: GUARDIAN_VOLLEY_EVERY_MS * 0.6,
    called: false, chained: false, chainNext: false, wasCharging: false, calling: false, answer: entrance.slice(0, GUARDIAN_ENTRANCE_MAX), spots: [],
    stance: 0, stanceIdleMs: 0, brokenMs: 0, introNoticeSent: false, introVolleyArmed: false, introGraceMs: 0,
    actionGapMs: 0, wasAttacking: false };
  e.hp = e.maxHp = GUARDIAN_HP;
  e.poise = e.maxPoise = GUARDIAN_POISE;
  e.radius = Math.round(e.radius * GUARDIAN_SCALE);
  /*
   * The tank's pace, so its ram is the tank's ram: a charge runs at seven
   * times the body's walk, and at the warden's 46 that is 322 px/s, faster
   * than the player can run from — a ram answered only by the dash.
   */
  e.speed = ENEMIES.tank.speed;
  e.phase = 1;
  e.awake = true;
  // The opening laser is staged away from the player, but its beam hitboxes
  // remain real once they appear; only the player's choice to walk into one
  // can make this demonstration hurt.
  e.pose = "guardian_intro";
  e.poseMs = GUARDIAN_INTRO_MS;
  e.attackCooldownMs = Math.max(e.attackCooldownMs, GUARDIAN_INTRO_PRE_MS + 100);
  return e;
}

/**
 * Arms the opening volley after the guardian has been placed in its room.
 * These are real beam rifts, not a decorative overlay: every lane is offset
 * from the player's current position so standing still is safe while walking
 * into a live line remains the player's mistake.
 */
export function armGuardianIntroVolley(w: World, e: Enemy): void {
  const ext = w.room.extent, p = w.player;
  const lo = TILE_PX + 1, hx = (ext.w - 1) * TILE_PX - 1, hy = (ext.h - 1) * TILE_PX - 1;
  const turn = (e.id * 0.71) % Math.PI;
  for (let i = 0; i < INTRO_VOLLEY_LINES; i++) {
    const angle = turn + (i / INTRO_VOLLEY_LINES) * Math.PI + Math.sin((i + 1) * 2.17) * 0.12;
    const side = i % 2 === 0 ? -1 : 1;
    const tier = Math.floor(i / 2);
    const offset = side * Math.min(INTRO_VOLLEY_NEAR, INTRO_VOLLEY_MIN_OFFSET + tier * TILE_PX * 0.42);
    const x = Math.min(hx, Math.max(lo, p.x - Math.sin(angle) * offset));
    const y = Math.min(hy, Math.max(lo, p.y + Math.cos(angle) * offset));
    const back = toRoomEdge(ext, x, y, angle + Math.PI), fore = toRoomEdge(ext, x, y, angle);
    const x0 = x + Math.cos(angle + Math.PI) * back, y0 = y + Math.sin(angle + Math.PI) * back;
    castRift(w, x0, y0, angle, back + fore, {
      width: VOLLEY_WIDTH, teleMs: INTRO_VOLLEY_TELE_MS + i * INTRO_VOLLEY_STAGGER_MS,
      damage: STAKE_DAMAGE, beam: true,
    });
  }
}

/** Its squad still standing: the bodies its calls brought. */
export function guardianSquad(w: World, e: Enemy): number {
  return w.enemies.filter((o) => o !== e && o.hp > 0 && !o.gone).length;
}

/**
 * One step of what the guardian is beyond a warden: **the call**. With the
 * call come round, its squad thin and nothing else in hand, it plants and
 * raises its arm (`guardian_call`, a planted pose) with the marks of what is
 * coming on the floor; when the arm comes down they rise. The call is never
 * interrupted: its poise is guarded while the arm is up. Its movement, shots
 * and blows are the warden's.
 */
export function stepGuardian(w: World, e: Enemy, dtMs: number): void {
  const g = e.guardian;
  if (!g || e.hp <= 0) return;
  // The first second is deliberately live. Do not spend the mid-fight call
  // timer while the room is still letting its enemies act naturally.
  if (e.pose === "guardian_intro") return;
  if (g.introGraceMs > 0) {
    g.introGraceMs = Math.max(0, g.introGraceMs - dtMs);
    return;
  }
  // On its knees: nothing comes round while it is down, and its stance is already whole again.
  if (g.brokenMs > 0) {
    g.brokenMs -= dtMs;
    return;
  }
  g.stanceIdleMs += dtMs;
  if (g.stanceIdleMs >= STANCE_HOLD_MS && g.stance > 0) g.stance = Math.max(0, g.stance - STANCE_DRAIN * dtMs / 1000);
  if (g.calling) {
    if (e.pose === "guardian_call") return;
    g.calling = false;
    answer(w, e, g.answer, g.spots);
    g.answer = [...GUARDIAN_SQUAD];
    g.spots = [];
    g.wasAttacking = false;
    g.actionGapMs = GUARDIAN_ACTION_GAP_MS;
    return;
  }
  /* The one mid-fight call is time-based; it does not wait for the opening pack to die. */
  if (!g.called && g.callMs > 0) g.callMs -= dtMs;
  if (g.stakesMs > 0) g.stakesMs -= dtMs;
  if (g.volleyMs > 0) g.volleyMs -= dtMs;
  // The ram twice: one that ended without its wall comes round again, once.
  const charging = e.attack !== "approach" && e.meleeKind === "charge";
  if (charging) g.chainNext = false;
  if (g.wasCharging && !charging) {
    if (!g.chained && e.staggerMs <= 0) {
      g.chained = true;
      g.chainNext = true;
      e.attackCooldownMs = Math.min(e.attackCooldownMs, GUARDIAN_CHAIN_REST_MS);
    } else g.chained = false;
  }
  g.wasCharging = charging;
  /*
   * Every attack family shares this one recovery window. The old tuning only
   * lengthened each family's private clock, so another already-due family
   * started on the very next frame. Remembering the busy -> idle edge makes
   * the gap begin when the whole animation ends, not when the attack begins.
   */
  const attacking = e.attack !== "approach"
    || e.pose !== "" && e.pose !== "guardian_intro"
    || e.telegraphMs > 0 || e.plantMs > 0;
  if (g.wasAttacking && !attacking)
    g.actionGapMs = Math.max(g.actionGapMs, GUARDIAN_ACTION_GAP_MS);
  g.wasAttacking = attacking;
  if (!attacking && g.actionGapMs > 0) {
    g.actionGapMs = Math.max(0, g.actionGapMs - dtMs);
    return;
  }
  if (e.attack !== "approach" || e.pose !== "" || e.staggerMs > 0 || e.plantMs > 0 || g.chainNext) return;
  const settled = w.stats.elapsedMs > GUARDIAN_CALL_MS;
  if (g.volleyMs <= 0 && settled) {
    g.wasAttacking = true;
    orderVolley(w, e, g);
    return;
  }
  if (g.stakesMs <= 0 && settled) {
    g.wasAttacking = true;
    driveStakes(w, e, g);
    return;
  }
  if (g.called || g.callMs > 0) return;
  g.calling = true;
  g.called = true;
  g.wasAttacking = true;
  // A one-shot entrance call must not become due again after its squad dies.
  g.callMs = Number.POSITIVE_INFINITY;
  g.spots = bossSummonSpots(w, e, g.answer.length);
  e.pose = "guardian_call";
  e.poseMs = GUARDIAN_CALL_MS;
  e.poiseGuardMs = Math.max(e.poiseGuardMs, GUARDIAN_CALL_MS);
  w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "guardian_call" });
}

/**
 * **The stakes**: planted, the gun's butt down, and the ground drawn where it
 * will erupt — three lanes at the player, or a ring round itself when the
 * player is on it. It holds the pose until they have gone up and a beat after.
 */
function driveStakes(w: World, e: Enemy, g: GuardianState): void {
  g.stakesMs = GUARDIAN_STAKES_EVERY_MS;
  const p = w.player;
  const near = Math.hypot(p.x - e.x, p.y - e.y) < PALISADE_NEAR;
  if (near) {
    eruptRing(w, { x: e.x, y: e.y }, {
      damage: STAKE_DAMAGE, radius: PALISADE_CELL, rings: PALISADE_RINGS,
      first: e.radius + TILE_PX * 0.5,
      step: PALISADE_STEP, delayMs: PALISADE_RING_MS, spacing: 2, weight: 0, kind: "earth", element: "none",
      elementPower: 0, powers: noPowers(), proc: 0, statusMult: 1, burnMs: 0, spellIndex: -1, hostile: true,
    }, GUARDIAN_STAKES_TELE_MS);
  } else {
    const at = Math.atan2(p.y - e.y, p.x - e.x);
    for (let i = 0; i < STAKE_LANES; i++) {
      const a = at + (i - (STAKE_LANES - 1) / 2) * STAKE_SPREAD;
      const x0 = e.x + Math.cos(a) * e.radius, y0 = e.y + Math.sin(a) * e.radius;
      castRift(w, x0, y0, a, lineToWall(w, x0, y0, a, STAKE_REACH), {
        teleMs: GUARDIAN_STAKES_TELE_MS, damage: STAKE_DAMAGE,
      });
    }
  }
  e.pose = "guardian_stakes";
  e.poseMs = GUARDIAN_STAKES_TELE_MS + GUARDIAN_STAKES_REST_MS;
  e.velX = 0;
  e.velY = 0;
  w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: near ? "guardian_palisade" : "guardian_stakes" });
}

/**
 * **The volley**: its arm up for the order and held, `VOLLEY_LINES` lines
 * across the room from wall to wall, crossing round the player at angles
 * spread round the clock, the first through the player's feet, coming due a
 * beat apart; and its squad under the floor until the last has fired.
 */
function orderVolley(w: World, e: Enemy, g: GuardianState): void {
  g.volleyMs = GUARDIAN_VOLLEY_EVERY_MS;
  const ext = w.room.extent, p = w.player;
  const turn = w.rng.next() * Math.PI;
  // Where each line crosses, across the player: spread evenly over the near
  // band so they do not bunch, then dealt to the angles at random.
  const offsets = Array.from({ length: VOLLEY_LINES - 1 }, (_, i) =>
    (((i + 0.5 + (w.rng.next() - 0.5) * 0.6) / (VOLLEY_LINES - 1)) * 2 - 1) * VOLLEY_NEAR);
  for (let i = offsets.length - 1; i > 0; i--) {
    const j = Math.floor(w.rng.next() * (i + 1));
    [offsets[i], offsets[j]] = [offsets[j]!, offsets[i]!];
  }
  const lo = TILE_PX + 1, hx = (ext.w - 1) * TILE_PX - 1, hy = (ext.h - 1) * TILE_PX - 1;
  for (let i = 0; i < VOLLEY_LINES; i++) {
    const angle = turn + (i / VOLLEY_LINES) * Math.PI + (w.rng.next() * 2 - 1) * VOLLEY_ANGLE_JITTER;
    const off = i === 0 ? 0 : offsets[i - 1]!;
    const x = Math.min(hx, Math.max(lo, p.x - Math.sin(angle) * off));
    const y = Math.min(hy, Math.max(lo, p.y + Math.cos(angle) * off));
    // Out of the room's walls: the whole room edge to edge, through pillars and all.
    const back = toRoomEdge(ext, x, y, angle + Math.PI), fore = toRoomEdge(ext, x, y, angle);
    const x0 = x + Math.cos(angle + Math.PI) * back, y0 = y + Math.sin(angle + Math.PI) * back;
    castRift(w, x0, y0, angle, back + fore, {
      width: VOLLEY_WIDTH, teleMs: GUARDIAN_VOLLEY_TELE_MS + i * VOLLEY_STAGGER_MS, damage: STAKE_DAMAGE, beam: true,
    });
  }
  for (const o of w.enemies) if (o !== e && o.hp > 0 && !o.gone) goToGround(w, o, GUARDIAN_VOLLEY_MS);
  e.pose = "guardian_order";
  e.poseMs = GUARDIAN_VOLLEY_MS + VOLLEY_REST_MS;
  // Turned on the player as the gun goes up, so the raised gun is seen and not its back.
  e.facing = Math.atan2(p.y - e.y, p.x - e.x);
  e.velX = 0;
  e.velY = 0;
  e.knockX = 0;
  e.knockY = 0;
  w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "guardian_volley" });
}

/**
 * One of its squad goes under the floor for `ms` (`Enemy.hideMs`): whatever it
 * had started is dropped, and a body still rising goes straight under.
 */
function goToGround(w: World, o: Enemy, ms: number): void {
  const rising = o.spawnFadeMs > 0;
  o.spawnFadeMs = 0;
  o.hideMs = ms;
  o.sinkMs = rising ? 0 : GUARDIAN_SINK_MS;
  o.airborne = true;
  o.attack = "approach";
  o.attackMs = 0;
  o.swing.active = false;
  o.swing.trackingMs = 0;
  o.comboLeft = 0;
  o.pending = [];
  o.telegraphMs = 0;
  o.plantMs = 0;
  o.pose = "";
  o.poseMs = 0;
  o.delve = "surface";
  o.staggerMs = 0;
  o.stunMs = 0;
  dropToken(w, o);
  dropFireToken(w, o);
  for (const t of w.tethers) if (t.alive && t.from === o.id) t.alive = false;
  if (!rising) w.events.push({ kind: "hazard_tick", x: o.x, y: o.y, what: "guardian_burrow" });
}

/**
 * Wears the guardian's stance by `amount`, and breaks it when worn through.
 * Returns whether this broke it. Nothing wears it while it is already down.
 */
export function wearStance(w: World, e: Enemy, amount: number): boolean {
  const g = e.guardian;
  if (!g || g.brokenMs > 0 || e.hp <= 0 || amount <= 0) return false;
  g.stanceIdleMs = 0;
  g.stance += amount;
  if (g.stance < GUARDIAN_STANCE) return false;
  breakStance(w, e, g);
  return true;
}

/**
 * **Broken**: on its knees for `GUARDIAN_BROKEN_MS`, stars over its head,
 * everything it had in hand dropped. A call it was making goes unanswered.
 * It cannot be broken or interrupted again while it is down.
 */
function breakStance(w: World, e: Enemy, g: GuardianState): void {
  g.stance = 0;
  g.brokenMs = GUARDIAN_BROKEN_MS;
  g.chained = false;
  g.chainNext = false;
  // The knockdown itself is already the long punish window; do not stack a
  // second hidden cooldown after it stands back up.
  g.wasAttacking = false;
  g.actionGapMs = 0;
  if (g.calling) {
    g.calling = false;
    g.spots = [];
    g.callMs = Number.POSITIVE_INFINITY;
  }
  e.staggerMs = Math.max(e.staggerMs, GUARDIAN_BROKEN_MS);
  e.stunMs = Math.max(e.stunMs, GUARDIAN_BROKEN_MS);
  e.attack = "approach";
  e.attackMs = 0;
  e.swing.active = false;
  e.swing.trackingMs = 0;
  e.comboLeft = 0;
  e.pending = [];
  e.telegraphMs = 0;
  e.plantMs = 0;
  e.pose = "";
  e.poseMs = 0;
  e.velX = 0;
  e.velY = 0;
  e.poiseGuardMs = GUARDIAN_BROKEN_MS + POISE_GUARD_MS;
  e.poise = e.maxPoise;
  e.poiseBreakMs = POISE_BREAK_MS;
  dropToken(w, e);
  dropFireToken(w, e);
  w.events.push({ kind: "enemy_hit", x: e.x, y: e.y, what: `poise_break:${e.archetype}` });
  w.events.push({ kind: "telegraph", x: e.x, y: e.y, what: "guardian_broken" });
}

/** How far from a point to the inside of the room's outer wall along an angle. */
function toRoomEdge(ext: { w: number; h: number }, x: number, y: number, angle: number): number {
  const lo = TILE_PX, hx = (ext.w - 1) * TILE_PX, hy = (ext.h - 1) * TILE_PX;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (hx - x) / dx);
  if (dx < -1e-6) t = Math.min(t, (lo - x) / dx);
  if (dy > 1e-6) t = Math.min(t, (hy - y) / dy);
  if (dy < -1e-6) t = Math.min(t, (lo - y) / dy);
  return Math.max(0, t);
}

/** The dead answer: the bodies rise round it. */
function answer(w: World, e: Enemy, who: readonly EnemyId[], spots: readonly { x: number; y: number }[]): void {
  w.trauma = Math.min(1, w.trauma + 0.3);
  spots.forEach((s, i) => {
    const add = makeEnemy(w.nextEnemyId++, who[i]!, s.x, s.y, [], rampFor(w.roomIndex));
    add.awake = true;
    add.summoned = true;
    w.enemies.push(add);
    w.events.push({ kind: "hazard_tick", x: s.x, y: s.y, what: "boss_summon" });
  });
}

/** Whether this body's next blow is the ram rather than the shove: the ram from range, the shove on top of it. */
export function guardianMelee(e: Enemy): "charge" | "bash" {
  return e.closeIn ? "bash" : "charge";
}
