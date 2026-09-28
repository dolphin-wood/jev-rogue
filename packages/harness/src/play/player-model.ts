/**
 * The reference player (design doc 011). Competent, not optimal, and above
 * all stable: balance numbers only mean something measured against a fixed
 * opponent, so this model is the constant every band is calibrated with.
 *
 * **Rewritten for the melee turn.** Every number in it used to serve holding a
 * firing line at 200 px; the model now closes to the sword's reach instead,
 * swings when a target is inside the arc it happens to be facing, and saves
 * its mana for what the sword cannot reach. The positioning term did not need
 * new machinery so much as the opposite sign.
 *
 * It scans candidate directions and scores each one rather than summing
 * forces. A force sum looks simpler but has a failure mode that quietly
 * ruins the numbers: repulsion from enemies and repulsion from walls cancel
 * in a corner, and the model parks there and is shot to pieces. Scoring
 * positions cannot cancel, because a corner simply scores badly.
 */
import {
  ARC_DEG, ARC_REACH, PLAYER_RADIUS, PLAYER_SPEED, SWING_TOTAL_MS, WORLD_W, WORLD_H,
  circleHitsWall, computeFlowField, followField, hasLineOfSight, sectorHits, slotCost, snapFacing,
  tileOf, ITEMS, ENEMIES, MELEE_ATTACKS, TILE_PX, hazardAt,
  distanceAt, UNREACHABLE, Tile, GRID_W, GRID_H, MAX_HEARTS,
  riftHits, tetherEnds, MINE_TRIGGER, MINE_BLAST, MUSKET_RANGE, MUSKET_SPREAD_DEG,
  armDistance, BOSS_LEAP_RADIUS, BOSS_SLAM_IMPACT_PX, spellReady,
} from "@jr/core";
import { holdsKey, keyWanted } from "./hands.ts";
/**
 * How far ahead of a turning arm the model reads the limb: the ground the
 * sweep will have covered by the time a step is taken. Without it the model
 * walks out of where the arm *is* and into where it is going, which is not
 * how a person reads a rotating threat — they read the direction of travel.
 */
const ARM_LOOKAHEAD_MS = 260;
/** How far ahead of a travelling shockwave the model reads its band. */
const SHOCK_LOOKAHEAD_MS = 320;
import type { Enemy, EnemyId, FlowField, Input, World } from "@jr/core";
import { perceive } from "./perception.ts";
import { SKILL_PROFILES, noise, salt, signedNoise } from "./skill.ts";
import type { SkillProfile } from "./skill.ts";

/**
 * A field toward the current target, cached on the target's tile.
 *
 * Scoring sixteen directions a third of a second ahead is a greedy local
 * search, and a greedy local search parks behind a wall: every direction
 * that leads around it scores worse in the short term. One room in the play
 * harness timed out at two minutes for exactly that reason.
 */
let cached: { field: FlowField; tile: readonly [number, number]; grid: Uint8Array; bare: boolean } | null = null;
let routing: { grid: Uint8Array; source: Uint8Array } | null = null;

/**
 * The room's grid with every contact hazard marked solid, for routing only.
 *
 * The route used to be planned on the bare grid, so it would happily run
 * straight across a spike strip; the step scanner then refused the step (a
 * strip is priced like a bullet about to land), and with a wall on one side
 * and the route on the other, the two remaining directions tied to the
 * decimal and the model **dithered in place for two minutes** — east one
 * frame, west the next, never moving a pixel. A person walks around the
 * strip. Now so does the route.
 */
function routingGrid(w: World): Uint8Array {
  if (routing && routing.source === w.room.grid) return routing.grid;
  const grid = new Uint8Array(w.room.grid);
  for (let ty = 0; ty < GRID_H; ty++)
    for (let tx = 0; tx < GRID_W; tx++) {
      const hz = hazardAt(w, (tx + 0.5) * TILE_PX, (ty + 0.5) * TILE_PX);
      if (hz && (hz.effect === "contact" || hz.effect === "lava")) grid[ty * GRID_W + tx] = Tile.Wall;
    }
  routing = { grid, source: w.room.grid };
  return grid;
}

function fieldTo(w: World, tx: number, ty: number): FlowField {
  const tile = tileOf(tx, ty);
  // Keyed on the grid as well: a cache keyed on the target tile alone
  // survived into the next room and routed the model through its walls.
  if (cached && cached.grid === w.room.grid && cached.tile[0] === tile[0] && cached.tile[1] === tile[1]) {
    // A field planned around the strips is only good while the player stands
    // on the side of them it was planned from. Cross one — shoved, or by
    // choice — and that field says "unreachable" from the new side; the model
    // then stood with no route at all. So a hit is re-checked from where the
    // player is now, and falls back to the bare grid when it has to.
    if (cached.bare || distanceAt(cached.field, w.player.x, w.player.y) !== UNREACHABLE) return cached.field;
  }
  let field = computeFlowField(routingGrid(w), tx, ty);
  let bare = false;
  // A strip may wall the target off entirely; then the bare grid is the only
  // route there is, and crossing the strip is priced at the step instead.
  if (distanceAt(field, w.player.x, w.player.y) === UNREACHABLE) {
    field = computeFlowField(w.room.grid, tx, ty);
    bare = true;
  }
  cached = { field, tile, grid: w.room.grid, bare };
  return field;
}

/**
 * How much the step chosen last frame is preferred, so two directions of equal
 * cost do not alternate every frame — a body that alternates between east and
 * west does not move.
 *
 * The step itself is on the **per-world state** (`ModelState.lastX/lastY`).
 * It was a module-level `let`, which meant the second world played in a
 * process started from the first world's last step: two runs of one seed
 * diverged from their first frame whenever that step broke a tie, which is
 * exactly the guarantee the harness exists to provide. The `states` WeakMap's
 * own comment already said why — "one room's hesitation must not leak into
 * the next" — and this was the one field left outside it.
 */
const PERSISTENCE = 4;

const DIRECTIONS = 16;
/** How far ahead a candidate step is judged. */
const LOOKAHEAD_S = 0.3;
/** Bullets further than this are not worth scoring. */
const THREAT_RANGE = 220;
/**
 * How far inside its own maximum reach the model stands.
 *
 * Spacing, and it is per-target rather than a constant, because the distance
 * worth holding is set by **both** reaches. Against the tank the numbers are:
 * the player's arc runs 57.6 px from their own centre, so with a 16 px body it
 * connects out to 73.6 px between centres; the tank's slash runs 51 px from
 * its centre, so it connects in to 58 px. Between those is a 15 px band where
 * the player hits and is not hit, and standing in it is the whole skill of the
 * matchup.
 *
 * The old constant was 0.72 of the arc — about 41 px — which is inside every
 * enemy's reach in the roster. The model was not losing the trade, it was
 * declining to take it: it stood where both blades landed and paid for the
 * privilege. That is a spacing bug that looks exactly like an enemy being
 * overtuned, which is why `melee:tank` survived two rounds of nerfs.
 */
const SPACING_MARGIN = 6;

const WALL_MARGIN = PLAYER_RADIUS * 6;
const ROUTE_WEIGHT = 55;
/** Cost above which no step is safe enough and the dash is worth spending. */
/**
 * Below this step cost the model will turn toward a reachable target rather
 * than take the dodge step it computed. Above it, the dodge is worth more than
 * the hit. A fraction of the dash threshold, so "safe enough to commit" is
 * strictly safer than "dangerous enough to dash".
 */
const DASH_THRESHOLD = 260;
const COMMIT_COST = DASH_THRESHOLD * 0.25;
/**
 * How much room the model tries to leave in front of something that has
 * committed to an attack. A little further than the lunge travels, so the
 * dodge clears it rather than trading with it.
 */
/**
 * Slack added to the player's radius when testing an enemy blade, so the model
 * aims to be clear of an attack rather than exactly on its edge. A model that
 * plays to the pixel is not a reference for balance, because a person does not.
 */
const BLADE_MARGIN = 10;

/** What the last call decided and why; read by the harness trace only. */
export const lastDecision = { route: null as { x: number; y: number } | null, bestCost: 0, costs: [] as string[], target: "", here: 0 };

/**
 * What the last **movement plan** knew, for diagnosing a hit after the fact.
 *
 * "The novice is hit by rushers half the time" has three different causes with
 * one symptom: it was standing too close, or it never saw the windup, or it saw
 * it and was still committed to a dodge chosen before the windup existed. Those
 * are opposite fixes — spacing, reaction time, decision rate — and nothing in
 * the hit itself distinguishes them. So the plan records, at the moment it is
 * made, which attended bodies were visibly winding up or lunging; `run.ts` reads
 * it at the hit under `JR_MELEE=1`.
 */
export const lastPlan = {
  atMs: 0,
  /** The ids of attended bodies whose attack was already visible when the plan was made. */
  sawAttacking: [] as number[],
  /** Distance to the nearest attended body at plan time, or Infinity. */
  nearestPx: Infinity,
};

/**
 * The part of a player that persists between frames, per world.
 *
 * A model that re-derives everything from the current frame has no habits, and
 * habits are most of what separates a person from a search. Commitment to a
 * dodge, commitment to a target, a rotation that is not instant, a dash that is
 * spent late — all of them need somewhere to remember what was already decided.
 * A `WeakMap` on the world rather than module state, because the harness plays
 * many worlds and one room's hesitation must not leak into the next.
 */
interface ModelState {
  /** When the movement plan was last redone, and what it decided. */
  planAtMs: number;
  moveX: number;
  moveY: number;
  /** The step chosen on the last scored frame; see `PERSISTENCE`. */
  lastX: number;
  lastY: number;
  bestCost: number;
  /** The body being fought, and the nearer one that is trying to steal attention. */
  targetId: number;
  candidateId: number;
  candidateSinceMs: number;
  /** Health last seen, so a hit can be noticed, and how long it flusters the player. */
  hearts: number;
  flusteredUntilMs: number;
  /** The dash: when it first became worth spending, and whether this one goes unused. */
  dashWantedAtMs: number;
  dashSkipped: boolean;
  /** When the swing became available, for the beat before it is thrown. */
  swingOnSinceMs: number;
  /** The rotation: when a key first came up, and the earliest the next press may be. */
  castableSinceMs: number;
  nextCastAtMs: number;
  /**
   * When each key last went off, and what it looked like the step before, so
   * the rotation can go round the keys (`pickSpell`) rather than lean on the
   * first. Read off the live world — a cooldown starting, a bank emptying, a
   * charge let go — because a press the sim refused is not a cast.
   */
  lastCastMs: number[];
  keySeen: ({ cooldownMs: number; bank: number; base: string } | null)[];
  chargeKeySeen: number;
}

const states = new WeakMap<World, ModelState>();

function stateFor(w: World): ModelState {
  let st = states.get(w);
  if (!st) {
    st = {
      planAtMs: -Infinity, moveX: 0, moveY: 0, lastX: 0, lastY: 0, bestCost: 0,
      targetId: -1, candidateId: -1, candidateSinceMs: 0,
      hearts: w.player.hearts, flusteredUntilMs: -Infinity,
      dashWantedAtMs: -1, dashSkipped: false, swingOnSinceMs: -1,
      castableSinceMs: -1, nextCastAtMs: -Infinity,
      lastCastMs: [], keySeen: [], chargeKeySeen: -1,
    };
    states.set(w, st);
  }
  return st;
}

/**
 * The threats the model is currently paying attention to.
 *
 * Built once per movement decision and handed to every candidate direction, so
 * all sixteen are scored against the same picture — which is what "attention"
 * means. Bullets carry a perturbed velocity (`velocityErr`), because reading a
 * trajectory by eye is not the same as reading `vx`.
 *
 * Room hazards, rifts, mines and the rest are deliberately **not** budgeted:
 * they sit still, and a player learns where the spikes are after walking on
 * them once. What overflows attention in this game is things that move.
 */
interface Attention {
  readonly bullets: readonly { x: number; y: number; vx: number; vy: number }[];
  readonly enemies: readonly Enemy[];
}

function attend(w: World, prof: SkillProfile): Attention {
  const p = w.player;
  const tick = w.tick | 0;

  const seen: { x: number; y: number; vx: number; vy: number; key: number }[] = [];
  for (let i = 0; i < w.enemyBullets.length; i++) {
    const b = w.enemyBullets[i]!;
    if (!b.alive) continue;
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.hypot(dx, dy);
    // Salience, not distance alone: a bullet already past the player is not
    // what a person is looking at, however near it still is.
    const closing = b.vx * dx + b.vy * dy > 0;
    const err = prof.velocityErr > 0 ? 1 + prof.velocityErr * signedNoise(tick, i ^ salt("bullet")) : 1;
    seen.push({ x: b.x, y: b.y, vx: b.vx * err, vy: b.vy * err, key: d + (closing ? 0 : 400) });
  }
  seen.sort((a, b) => a.key - b.key);

  const bodies = w.enemies.filter((e) => e.hp > 0 && e.spawnFadeMs <= 0);
  if (Number.isFinite(prof.attentionEnemies))
    bodies.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));

  return {
    bullets: Number.isFinite(prof.attentionBullets) ? seen.slice(0, prof.attentionBullets) : seen,
    enemies: Number.isFinite(prof.attentionEnemies) ? bodies.slice(0, prof.attentionEnemies) : bodies,
  };
}

/**
 * The body the model is fighting, which is not always the nearest one.
 *
 * Swapping to whatever is closest on this frame is free re-planning by another
 * name: it lets the model carve a crowd in whatever order is optimal at each
 * instant. A person finishes what they started, or takes a beat to change their
 * mind, and `targetSwitchMs` is that beat.
 */
function committedTarget(w: World, st: ModelState, prof: SkillProfile): Target | null {
  const fresh = nearestEnemy(w);
  if (prof.targetSwitchMs <= 0) {
    st.targetId = fresh ? fresh.id : -1;
    return fresh;
  }
  const now = w.stats.elapsedMs;
  const held = st.targetId >= 0 ? enemyById(w, st.targetId) : null;
  if (!held) {
    st.targetId = fresh ? fresh.id : -1;
    st.candidateId = -1;
    return fresh;
  }
  if (!fresh || fresh.id === held.id) {
    st.candidateId = -1;
    return held;
  }
  if (st.candidateId !== fresh.id) {
    st.candidateId = fresh.id;
    st.candidateSinceMs = now;
  }
  if (now - st.candidateSinceMs >= prof.targetSwitchMs) {
    st.targetId = fresh.id;
    st.candidateId = -1;
    return fresh;
  }
  return held;
}

function enemyById(w: World, id: number): Target | null {
  for (const e of w.enemies) {
    if (e.id !== id || e.hp <= 0 || e.spawnFadeMs > 0) continue;
    return { ...e, visible: hasLineOfSight(w.room.grid, w.player.x, w.player.y, e.x, e.y) };
  }
  return null;
}

/** Nothing pressed: the door-reading pause at entry, and the beat after a hit. */
function idleInput(w: World): Input {
  return {
    dash: false, moveX: 0, moveY: 0,
    aimX: w.player.x + 1, aimY: w.player.y,
    swing: false, spell: null,
  };
}

/**
 * The model's input, with the spell key held the way doc 006's options ask
 * (`holdsKey`): a `charge` spell that has started charging is **held to a
 * full charge and then let go**, whatever the rest of the model decided about
 * the key this step. Without this the model would press a charge spell for
 * the one frame its rotation allows and fire every shot as a tap — a quarter
 * of the spell, for its whole cost — and the harness would measure a spell
 * nobody plays. The dash still wins: dashing is how a charge is cancelled,
 * and a model that dodges mid-charge loses the charge, as a player does.
 * A `charges` spell is pressed only when a press would fire, so its bank
 * refills between presses as the game's does.
 */
export function referenceInput(live: World, profile: SkillProfile = SKILL_PROFILES.expert): Input {
  const input = decideInput(live, profile);
  const p = live.player;
  if (p.chargeKey >= 0 && !input.dash)
    return { ...input, spell: holdsKey(live, p.chargeKey) ? p.chargeKey : null };
  if (input.spell !== null && input.spell !== undefined && !holdsKey(live, input.spell)) return { ...input, spell: null };
  return input;
}

function decideInput(live: World, profile: SkillProfile): Input {
  /*
   * Everything below reads a **delayed** view of the threats and a live view
   * of the player and the room. See `perception.ts`: the model used to dodge
   * attacks on the frame they were declared, which made every number the
   * harness produced describe a difficulty nobody plays at.
   */
  const prof = profile;
  const w = perceive(live, prof);
  const p = w.player;
  const st = stateFor(live);
  const now = w.stats.elapsedMs;
  noteCasts(live, st, now);

  // Reading the room from the door. A new player stops and looks at what is in
  // front of them before walking into it; the model charged in from frame one.
  if (now < prof.entryIdleMs) return idleInput(w);

  // Hit: for a moment the plan is gone. Chains of hits are most of what a bad
  // run is made of, and they exist because the second hit lands while the
  // player is still reacting to the first.
  if (p.hearts < st.hearts && prof.recoverMs > 0) st.flusteredUntilMs = now + prof.recoverMs;
  st.hearts = p.hearts;
  if (now < st.flusteredUntilMs) {
    st.moveX = 0;
    st.moveY = 0;
    return idleInput(w);
  }

  const target = committedTarget(w, st, prof);
  const hurt = p.hearts <= 2;
  const distance = target ? Math.hypot(target.x - p.x, target.y - p.y) : Infinity;

  /*
   * **Patience.** If the target has not lost health for a while the model is
   * stuck — holding a firing line with no mana to fire, or swinging at a body
   * behind a pillar the sweep cannot reach through — so it stops holding its
   * line and walks the field to the body itself. A person gets bored of a
   * stalemate; the harness timed them out at two minutes.
   */
  const stalled = target ? stall(live, target.id, target.hp) : false;

  // Out of sight: bias the scan toward the route rather than overriding it.
  // Overriding walks the model straight into fire, because it stops dodging
  // the moment the target steps behind cover.
  let route = target && (!target.visible || stalled)
    ? followField(fieldTo(w, target.x, target.y), p.x, p.y)
    : null;
  // No field reaches it — a body parked on a door or a prop tile, or a room
  // whose graph the tile walk cannot see — then the straight line is the
  // route, and the walls it meets are slid along. Standing still was the
  // alternative, and the harness timed that out at two minutes.
  if (target && !target.visible && !route) {
    const d = Math.max(1, distance);
    route = { x: (target.x - p.x) / d, y: (target.y - p.y) / d };
  }

  /*
   * A heart on the floor, when the model is missing one.
   *
   * The model never picked one up. Hearts drop from about one kill in twenty
   * while the player is hurt (doc 003's attrition table) and are the run's
   * only healing besides the Vigour card, so a model that ignores them
   * measures a run with no healing at all: four runs in twelve died of
   * attrition with hearts lying behind them. A person turns for a heart, and
   * so does this — as a route bias, the same as an unseen enemy, so it is
   * still dodging on the way.
   */
  const heart = nearestHeart(w);
  if (heart && p.hearts < MAX_HEARTS + p.mods.maxHearts) {
    const dh = Math.hypot(heart.x - p.x, heart.y - p.y);
    if (hurt || dh < HEART_DETOUR_PX) {
      const toHeart = followField(fieldTo(w, heart.x, heart.y), p.x, p.y)
        ?? { x: (heart.x - p.x) / Math.max(1, dh), y: (heart.y - p.y) / Math.max(1, dh) };
      route = toHeart;
    }
  }

  /*
   * **The decision clock.** The plan is only redone every `decisionMs`; between
   * decisions the model holds the direction it committed to.
   *
   * This is the single biggest difference between the model and a person, and
   * the reason the model cleared room one in five seconds. Scoring sixteen
   * directions at 60 Hz means it can reverse into a gap that opened one frame
   * ago and be back out of it before anything arrives. A human picks a way out,
   * commits, and lives with it — which is what being hit is mostly made of.
   */
  const replan = prof.decisionMs <= 0 || now - st.planAtMs >= prof.decisionMs;
  let bestX = st.moveX;
  let bestY = st.moveY;
  let bestCost = st.bestCost;
  if (!replan) {
    lastDecision.route = route;
    lastDecision.bestCost = bestCost;
    return finish(w, st, prof, target, distance, bestX, bestY);
  }
  st.planAtMs = now;
  const att = attend(w, prof);
  if (process.env.JR_MELEE === "1") {
    lastPlan.atMs = now;
    lastPlan.sawAttacking = att.enemies.filter((e) => e.attack !== "approach").map((e) => e.id);
    lastPlan.nearestPx = att.enemies.reduce(
      (best, e) => Math.min(best, Math.hypot(e.x - p.x, e.y - p.y)), Infinity);
  }
  bestX = 0;
  bestY = 0;
  bestCost = Infinity;

  // Standing still is a candidate too, so the model does not jitter when
  // every direction is worse than holding position.
  for (let i = 0; i <= DIRECTIONS; i++) {
    const [dx, dy] = i === DIRECTIONS
      ? [0, 0]
      : [Math.cos((i / DIRECTIONS) * Math.PI * 2), Math.sin((i / DIRECTIONS) * Math.PI * 2)];
    // Graded probe. At the full lookahead alone, every direction can be
    // blocked at once in a doorway or between two pillars, and the scan then
    // has nothing left but standing still: the model froze there for the
    // whole room, mana full and firing at nothing. A real player slides along
    // the wall instead, so a direction is only rejected when even a short
    // step into it is solid.
    const probe = clearStep(w, p.x, p.y, dx, dy);
    if (probe === null) continue;
    const nx = probe.x;
    const ny = probe.y;

    let cost = score(w, nx, ny, stalled ? null : target, hurt, att, prof) + (i === DIRECTIONS ? 0.5 : 0);
    // Stalled: a step from which the sword's own line to the body is blocked
    // (it swings from a little above the feet) is not worth standing on.
    if (stalled && target && !hasLineOfSight(w.room.grid, nx, ny - 7, target.x, target.y)) cost += 120;
    // Agreeing with the route is worth about as much as a modest threat, and
    // more when the room is quiet: with nothing incoming, crossing it is the
    // only thing left to do.
    if (route) {
      const weight = ROUTE_WEIGHT * (1 + 1.6 * (1 - threatScale(w)));
      cost -= (dx * route.x + dy * route.y) * weight;
    }
    cost -= (dx * st.lastX + dy * st.lastY) * PERSISTENCE;
    if (cost < bestCost) {
      bestCost = cost;
      bestX = dx;
      bestY = dy;
    }
    if (process.env.JR_TRACE) lastDecision.costs[i] = `${i === DIRECTIONS ? "stay" : Math.round((i / DIRECTIONS) * 360)}:${cost.toFixed(1)}`;
  }
  lastDecision.route = route;
  lastDecision.bestCost = bestCost;
  if (process.env.JR_TRACE) {
    lastDecision.target = target ? `${target.archetype}@${Math.round(target.x)},${Math.round(target.y)} vis=${target.visible}` : "none";
    lastDecision.here = target ? distanceAt(fieldTo(w, target.x, target.y), p.x, p.y) : -9;
  }
  st.lastX = bestX;
  st.lastY = bestY;
  st.moveX = bestX;
  st.moveY = bestY;
  st.bestCost = bestCost;
  return finish(w, st, prof, target, distance, bestX, bestY);
}

/**
 * Everything that is decided from the committed movement plan: whether to turn
 * into the target, whether to swing, what to cast and where to aim.
 *
 * Split out of `referenceInput` because it runs on **every** frame while the
 * movement plan runs on the decision clock. Facing, the swing window and the
 * dash all have to be answered at 60 Hz even when the direction is held: the
 * simulation reads them every step, and a person's hands do keep working
 * between the moments they change their mind about where to stand.
 */
function finish(
  w: World,
  st: ModelState,
  prof: SkillProfile,
  target: Target | null,
  distance: number,
  moveX: number,
  moveY: number,
): Input {
  const p = w.player;
  let bestX = moveX;
  let bestY = moveY;
  const bestCost = st.bestCost;

  // Aims where the target will be. A player leads instinctively; a model
  // that does not cannot hit anything moving across its line.
  const lead = target ? leadPoint(p.x, p.y, target) : null;
  const dash = wantsDash(w, st, prof, bestCost);

  /*
   * In range but facing the wrong way: turn, by stepping toward it.
   *
   * Facing comes from movement — there is no mouse — so a model that has
   * arrived at its preferred spacing and stopped can no longer turn, and a
   * swing at something off its facing is refused. That is a deadlock, and the
   * harness found it as a two-minute room with **eight swings in it**: the
   * model stood 36 px from a turret it was facing away from, declining to
   * attack and declining to move.
   *
   * A real player has the same constraint and solves it the same way, by
   * nudging toward what they want to hit, so this is the model learning the
   * control scheme rather than being given a way around it.
   */
  /*
   * The nudge used to fire only when the model had chosen not to move, and
   * against anything that shoots it never chooses that: it strafes the shots,
   * strafing sets its facing sideways, and a sideways facing forbids the
   * swing. Measured against a lone turret it parked at 34 px and swung twice
   * in twenty seconds. Against a body it could reach.
   *
   * So the nudge also overrides a **cheap** dodge. If the target is in reach
   * and the best step would not let the swing land, and nothing is about to
   * hit the model, it steps toward the target instead — which is what
   * committing to an attack means under a control scheme where facing is
   * movement. A dangerous step (a shot inbound) still wins; the model does not
   * walk into a bullet to land a hit.
   */
  if (target && target.visible) {
    const reachable = distance <= ARC_REACH + target.radius + 3;
    const safeToCommit = bestCost <= COMMIT_COST;
    if (reachable && safeToCommit && !swingIsOn(w, target, distance, bestX, bestY)) {
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      if (Math.abs(dx) > Math.abs(dy)) { bestX = Math.sign(dx); bestY = 0; }
      else { bestY = Math.sign(dy); bestX = 0; }
    }
  }

  // Thrown at what the sword cannot reach, which is not necessarily the body
  // the model is standing next to.
  const far = spellTarget(w);
  const cast = wantsCast(w, st, prof, far, bestX !== 0 || bestY !== 0);
  const aimAt = far ? leadPoint(p.x, p.y, far) : lead;
  const aimed = aimAt ? offAim(p.x, p.y, aimAt, far ?? target, prof) : null;
  return {
    dash,
    moveX: bestX,
    moveY: bestY,
    aimX: aimed ? aimed.x : p.x + 1,
    aimY: aimed ? aimed.y : p.y,
    swing: wantsSwing(w, st, prof, target, distance, bestX, bestY),
    spell: cast,
  };
}

/**
 * Whether to swing this step.
 *
 * Three conditions, and the second is the one that makes this a melee model
 * rather than a shooter with a shorter range.
 *
 * **In reach**, allowing for the windup: the blade is not live for the first
 * four frames, so a target closing fast should be swung at slightly early
 * rather than once it has already arrived.
 *
 * **Within the arc of where the model is facing.** Facing comes from movement
 * now, so the model can only hit what it is walking toward — there is no
 * independent aim. This couples attacking to approaching in a way the old
 * model never had to consider, and it is the constraint a human feels most.
 *
 * **Not already swinging**, since the input would be ignored and the model
 * should spend the frame moving instead.
 */
function wantsSwing(
  w: World,
  st: ModelState,
  prof: SkillProfile,
  target: Target | null,
  distance: number,
  moveX: number,
  moveY: number,
): boolean {
  const on = swingIsOn(w, target, distance, moveX, moveY);
  /*
   * The beat before the swing. The model threw one on the first frame the arc
   * covered a body, which is not a decision so much as the absence of one; a
   * person sees the opening and then acts on it. The delay is not only slower,
   * it misses, because both bodies keep moving through it.
   */
  if (!on) { st.swingOnSinceMs = -1; return false; }
  if (prof.swingReactionMs <= 0) return true;
  const now = w.stats.elapsedMs;
  if (st.swingOnSinceMs < 0) st.swingOnSinceMs = now;
  return now - st.swingOnSinceMs >= prof.swingReactionMs;
}

/** The three conditions themselves, unchanged; see `wantsSwing`. */
function swingIsOn(
  w: World,
  target: Target | null,
  distance: number,
  moveX: number,
  moveY: number,
): boolean {
  if (!target) return false;
  const p = w.player;
  if (p.swingMs > 0 || p.dashMs > 0) return false;
  // Measured to the body's edge, not its centre, and a little past full reach
  // because the swing takes four frames to go live and anything chasing the
  // model has closed by then. A flat multiple of the reach gave up on a tank
  // at a range where the arc still lands on it.
  if (distance > ARC_REACH + target.radius + 3) return false;

  // The facing the swing will use: the snapped movement direction if the model
  // is moving, else the facing it is holding.
  const facing = snapFacing(moveX, moveY, p.facing);
  const toTarget = Math.atan2(target.y - p.y, target.x - p.x);
  let delta = (toTarget - facing) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  // Half the total coverage, less a margin, so the model does not rely on the
  // very edge of the arc where a body is only clipped.
  const half = ((ARC_DEG / 2) * Math.PI) / 180;
  if (Math.abs(delta) > half * 0.8) return false;

  /*
   * Do not swing into a windup.
   *
   * A swing is 267 ms during which the model moves at a third to two thirds of
   * its speed, so starting one is a commitment for about as long as an enemy's
   * own attack takes to arrive. Swinging whenever something was in range meant
   * the model spent every fight half-committed, and a chaser closing at 52 px/s
   * simply walked through the spacing while it did: measured, the tank landed
   * its slash at a median 42 px against a 38 px reach and 3 degrees off its
   * axis — the model was standing in front of it, mid-swing, every time.
   *
   * This is the read the whole windup-lunge-recover cycle exists to ask for,
   * and doc 013 already names the answer: **the recovery is the player's
   * turn.** Declining the exchange while an attack is inbound is not caution,
   * it is the only way the recovery window is worth anything.
   */
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.spawnFadeMs > 0) continue;
    if (e.attack !== "windup") continue;
    // Only if it is close enough that the attack could reach the model, and
    // lands inside the swing the model is about to start.
    if (e.attackMs > SWING_TOTAL_MS) continue;
    const gap = Math.hypot(e.x - p.x, e.y - p.y);
    if (gap < e.swing.reach + PLAYER_RADIUS + BLADE_MARGIN * 2) return false;
  }
  return true;
}

/**
 * The enemy a spell should be thrown at: the nearest visible one the sword
 * cannot reach.
 *
 * Chosen **independently of the melee target**, which is the whole point. The
 * first version cast only when the nearest enemy was out of sword range, so a
 * model trading blows with a rusher while a turret shot it from across the
 * room never cast at all — it banked mana it had no other use for while the
 * thing it could not reach stayed alive. The sword handles what is close and
 * the spells handle what is not, at the same time, which is the loop doc 013
 * describes rather than two modes the player switches between.
 *
 * `aim` is free for this because the sword does not use it: a swing takes its
 * direction from the facing, which comes from movement.
 *
 * **But out of reach is a preference, not a condition.** It was a condition,
 * and the one fight in the game that is a single body standing on top of the
 * player — the boss — therefore had no spell target at all: the model swung
 * ninety times and cast four in a fifty-second fight, and the boss measured
 * as a pure melee test whatever build was handed to it. That made the one
 * encounter the whole run builds toward the one the build could not be
 * measured on. Nobody stops casting because the thing is close.
 */
function spellTarget(w: World): Target | null {
  let far: Target | null = null;
  let farD = Infinity;
  let near: Target | null = null;
  let nearD = Infinity;
  const p = w.player;
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.spawnFadeMs > 0 || e.airborne) continue;
    if (!hasLineOfSight(w.room.grid, p.x, p.y, e.x, e.y)) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > ARC_REACH + e.radius) {
      if (d < farD) { farD = d; far = { ...e, visible: true }; }
    } else if (d < nearD) { nearD = d; near = { ...e, visible: true }; }
  }
  return far ?? near;
}

/**
 * Which spell key to press, or null.
 *
 * The next key in the rotation rather than the best one. A reference player
 * exists to calibrate encounters, so it should play competently and not
 * optimally: picking the strongest affordable spell every time would measure
 * the ceiling of the build rather than the difficulty of the room.
 *
 * **The rotation goes round the keys** (`rotation`): of the keys that are
 * ready, the one that went off longest ago is pressed first. It used to be
 * the first ready key, on the reasoning that cooldowns stagger on their own —
 * and they do not whenever a key's cooldown is shorter than its own windup
 * and recovery, or shorter than the rotation's human gap (`castGapMs`): the
 * first key is then ready again every time the hands are free, and the other
 * two are never pressed. Measured, an expert Heavy run cast Earth Spikes 214
 * times and its second and third keys 11 and 0; an `average` player never
 * pressed anything but the first key in any style. A person with three keys
 * plays all three.
 */
function pickSpell(w: World, st: ModelState, target: Target | null, moving: boolean): number | null {
  if (!target) return null;
  for (const i of rotation(w, st)) {
    const slot = w.spells[i];
    // Ready means off cooldown and, for a spell that banks charges, holding one.
    if (!slot || !spellReady(slot, ITEMS)) continue;
    if (w.player.mana < slotCost(slot, ITEMS, w.staff)) continue;
    /*
     * And pressed at its moment, for the shapes whose key only makes sense
     * at one (`keyWanted`): a stance as a hit is about to land, an enchant
     * before closing to swing, a trail while moving, a thrown blade at a
     * body it reaches. A key that is not wanted now is passed over, and the
     * next ready one is pressed instead.
     */
    if (!keyWanted(w, i, { moving, target })) continue;
    return i;
  }
  return null;
}

/** The keys in the order the rotation tries them: least recently cast first, then by key. */
function rotation(w: World, st: ModelState): number[] {
  const keys = w.spells.map((_, i) => i);
  const last = (i: number) => st.lastCastMs[i] ?? -Infinity;
  return keys.sort((a, b) => last(a) - last(b) || a - b);
}

/**
 * Notes which keys went off since the last step, off the live world: a
 * cooldown that started, a bank that emptied, a charge that was let go. A
 * spell newly bound to a key starts as never cast, so it is tried first.
 */
function noteCasts(live: World, st: ModelState, now: number): void {
  live.spells.forEach((slot, i) => {
    const seen = st.keySeen[i] ?? null;
    if (!slot) { st.keySeen[i] = null; return; }
    const bank = slot.bank ?? -1;
    if (seen && seen.base !== slot.item.base) st.lastCastMs[i] = -Infinity;
    else if (seen && (slot.cooldownMs > seen.cooldownMs + 1
      || (seen.bank >= 1 && bank >= 0 && bank < 1)
      || (st.chargeKeySeen === i && live.player.chargeKey !== i)))
      st.lastCastMs[i] = now;
    st.keySeen[i] = { cooldownMs: slot.cooldownMs, bank, base: slot.item.base };
  });
  st.chargeKeySeen = live.player.chargeKey;
}

/**
 * The rotation, at human speed.
 *
 * The model pressed every key on the frame it came off cooldown, which nobody
 * runs: there is a beat before you notice a key is up (`castReactionMs`) and a
 * rhythm you settle into rather than a metronome (`castGapMs`). This matters
 * more than it sounds, because a slower rotation is less damage per second, and
 * less damage per second is a longer room, and a longer room is more time under
 * fire. The three compound, which is why the effect is worth two parameters.
 */
function wantsCast(w: World, st: ModelState, prof: SkillProfile, target: Target | null, moving: boolean): number | null {
  const pick = pickSpell(w, st, target, moving);
  if (pick === null) {
    st.castableSinceMs = -1;
    return null;
  }
  if (prof.castReactionMs <= 0 && prof.castGapMs <= 0) return pick;
  const now = w.stats.elapsedMs;
  if (st.castableSinceMs < 0) st.castableSinceMs = now;
  if (now - st.castableSinceMs < prof.castReactionMs) return null;
  if (now < st.nextCastAtMs) return null;
  st.nextCastAtMs = now + prof.castGapMs;
  st.castableSinceMs = -1;
  return pick;
}

/**
 * The dash, spent late or not at all.
 *
 * The model dashed on the frame the best available step was still dangerous,
 * which is the theoretically correct moment and not one people find. They dash
 * after the shot is already on them (`dashDelayMs`), or they were saving it, or
 * they simply did not think of it (`dashSkipChance`). The skip is rolled once
 * per opportunity from the world clock, so a seed always skips the same ones.
 */
function wantsDash(w: World, st: ModelState, prof: SkillProfile, bestCost: number): boolean {
  const p = w.player;
  if (bestCost <= DASH_THRESHOLD) {
    st.dashWantedAtMs = -1;
    return false;
  }
  const now = w.stats.elapsedMs;
  if (st.dashWantedAtMs < 0) {
    st.dashWantedAtMs = now;
    st.dashSkipped = prof.dashSkipChance > 0
      && noise(Math.round(now), salt("dash")) < prof.dashSkipChance;
  }
  if (st.dashSkipped) return false;
  if (now - st.dashWantedAtMs < prof.dashDelayMs) return false;
  return p.dashCooldownMs <= 0 && p.dashMs <= 0;
}

/**
 * The aim, a few degrees out.
 *
 * Rotated about the player rather than jittered at the destination, so the
 * error grows with range the way a mis-aimed throw does. Seeded on the target's
 * id, so it is held for as long as the target is — a player aiming slightly
 * wrong, not a hand shaking at 60 Hz.
 */
function offAim(
  px: number, py: number, at: { x: number; y: number }, target: Target | null, prof: SkillProfile,
): { x: number; y: number } {
  if (prof.aimErrorDeg <= 0 || !target) return at;
  const err = ((prof.aimErrorDeg * Math.PI) / 180) * signedNoise(target.id, salt("aim"));
  const dx = at.x - px;
  const dy = at.y - py;
  const c = Math.cos(err);
  const s = Math.sin(err);
  return { x: px + dx * c - dy * s, y: py + dx * s + dy * c };
}

/**
 * How dangerous the room is right now, from 0 on an empty floor to 1 under
 * fire. Terms that trade safety against progress are scaled by it.
 */
/**
 * The furthest clear point along `dx, dy`, tried long first. `null` when even
 * the shortest step is inside a wall, which is the only case a direction is
 * genuinely unavailable.
 */
function clearStep(
  w: World,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { x: number; y: number } | null {
  if (dx === 0 && dy === 0) return { x, y };
  for (const s of [LOOKAHEAD_S, LOOKAHEAD_S * 0.5, LOOKAHEAD_S * 0.2]) {
    const nx = x + dx * PLAYER_SPEED * s;
    const ny = y + dy * PLAYER_SPEED * s;
    if (!circleHitsWall(w.room.grid, nx, ny, PLAYER_RADIUS)) return { x: nx, y: ny };
  }
  return null;
}

function threatScale(w: World): number {
  let live = 0;
  for (const b of w.enemyBullets) if (b.alive) live++;
  return Math.min(1, live / 8);
}

/** Enough of an enemy to position against: where it is, how big, and what it is. */
type Target = {
  x: number; y: number; vx: number; vy: number;
  radius: number; archetype: EnemyId; visible: boolean;
  id: number; hp: number;
};

/**
 * How far this body can hurt the player with a blade, from its own centre.
 * Zero for anything that only shoots, which is why walking into a turret is
 * free and the model has no reason to stand off one.
 */
function threatReach(archetype: EnemyId): number {
  const kind = ENEMIES[archetype].melee;
  return kind ? MELEE_ATTACKS[kind].reachTiles * TILE_PX : 0;
}

/**
 * Where to stand: the middle of the band where the player's arc lands and the
 * enemy's does not.
 *
 * Standing at the outer edge of the band was safe and barely worked. The arc's
 * tip arrives late in the sweep and covers the least ground, so a target held
 * at maximum reach is grazed rather than hit — measured, the reference player
 * was clearing rooms at about nine damage per second against a sword capable
 * of thirty-four, which is roughly a quarter of its swings landing. Safety and
 * a reliable hit are not in tension here: there is a whole band between the
 * two reaches, and the middle of it is both.
 */
function standoff(t: Target, prof: SkillProfile): number {
  const inner = threatReach(t.archetype) + PLAYER_RADIUS;
  const outer = ARC_REACH + t.radius - SPACING_MARGIN;
  const band = inner >= outer ? outer : (inner + outer) / 2;
  /*
   * Sloppy spacing, biased **inward**. The band where the player's arc lands
   * and the enemy's does not is about fifteen px wide, so a player who is off
   * by twenty px is not slightly worse at this, they are standing inside the
   * blade. Inward rather than either way because closing feels like attacking:
   * nobody's error is to stand too far back.
   */
  return band + prof.timidityPx + prof.spacingSlopPx * signedNoise(t.id, salt("spacing"));
}

function score(
  w: World,
  x: number,
  y: number,
  target: Target | null,
  hurt: boolean,
  att: Attention,
  prof: SkillProfile,
): number {
  let cost = 0;

  // Incoming fire, weighted by how near the bullet's path passes. Only the
  // bullets attention is on: see `attend`.
  for (const b of att.bullets) {
    if (Math.abs(b.x - x) > THREAT_RANGE || Math.abs(b.y - y) > THREAT_RANGE) continue;
    for (const t of [0.1, 0.25, 0.45]) {
      const d = Math.hypot(b.x + b.vx * t - x, b.y + b.vy * t - y);
      if (d < 60) cost += (60 - d) * (t === 0.1 ? 3 : 1.5);
    }
  }

  /**
   * Bodies, but priced as a **melee** fighter would price them.
   *
   * The old term charged for being within `radius + 7 + 50`, about 70 px, of
   * any enemy at all. Against a sword that reaches 58 px that is a direct
   * contradiction: the model was penalised for standing where it could
   * attack, so it hovered just outside its own range, and the first run of the
   * melee model died in room one having killed five enemies and lost six
   * hearts.
   *
   * So proximity is **free** and being inside an attack is expensive. Contact
   * damage is gone: a body cannot hurt the player at all, only a blade can, so
   * the only thing worth avoiding is the sector an attack covers. Charging for
   * nearness would make the model refuse to stand where it can swing, which is
   * the contradiction that killed the first melee version of this model.
   */
  for (const e of att.enemies) {
    /*
     * **Fear of the body itself**, which is a beginner's mistake and an
     * expensive one. See `SkillProfile.bodyFearPx`: contact costs nothing in
     * this game, so a player who backs away from bodies rather than from blades
     * spends the fight in the open, kills nothing, and is shot the whole time.
     */
    if (prof.bodyFearPx > 0) {
      const d = Math.hypot(e.x - x, e.y - y);
      /*
       * But **not** for a body already inside the player's own reach. Backing
       * away from something faster than you is not an escape, it is a chase you
       * lose: measured, the novice was hit by rushers at a median 33 px — dead
       * inside a 32 px thrust — while fleeing them, and swinging less than twice
       * a room because it was always running. Somebody who has just been caught
       * turns and mashes the attack button, which is both what people do and
       * the only thing that works. So fear is what keeps a beginner out of a
       * fight, and it stops mattering once the fight has arrived.
       */
      const arrived = d <= ARC_REACH + e.radius;
      if (!arrived && d < prof.bodyFearPx) cost += (prof.bodyFearPx - d) * 2;
    }

    /*
     * The attack's own hitbox, tested against the same function the simulation
     * uses. Reading the box rather than approximating it with a radius is the
     * point: the model then dodges by leaving the arc, including by moving
     * *through* to the enemy's flank, which a distance term cannot express and
     * which is the answer the thrust is designed to have.
     */
    if (e.attack === "windup") {
      const tracking = e.swing.trackingMs > 0;
      if (tracking) {
        /*
         * While the telegraph still tracks, angle is not an answer: every
         * sidestep is met by the blade turning. So the only thing worth
         * costing is being within reach at all, from any direction.
         */
        if (Math.hypot(e.x - x, e.y - y) < e.swing.reach + PLAYER_RADIUS + BLADE_MARGIN)
          cost += 300;
      } else {
        // Locked. This is the window the sidestep exists for, so it is scored
        // against the sector it actually committed to.
        const armed = { ...e.swing, x: e.x, y: e.y };
        armed.halfArc = e.swing.halfArc + Math.abs((e.swing.sweepDeg * Math.PI) / 180) / 2;
        armed.angle = e.swing.facing;
        if (sectorHits(armed, { x, y }, PLAYER_RADIUS + BLADE_MARGIN)) cost += 300;
      }
    } else if (e.attack === "lunge") {
      /*
       * Led, the same way a bullet is.
       *
       * Scoring a charge against where its body is *now* is what let the model
       * think a step backwards was safe while a body travelling 347 px/s
       * arrived anyway: measured, it was hit a median 9 degrees off the blade's
       * axis, which is to say it had not stepped aside at all.
       */
      const carry = Math.min(LOOKAHEAD_S, Math.max(0, e.attackMs) / 1000);
      for (const ahead of [0, carry]) {
        const armed = { ...e.swing, x: e.x + e.vx * ahead, y: e.y + e.vy * ahead };
        if (sectorHits(armed, { x, y }, PLAYER_RADIUS + BLADE_MARGIN)) {
          cost += 300;
          break;
        }
      }
    }

    /*
     * The warden's blunderbuss, raised: its spray covers a cone out to its
     * range, so the model leaves the cone or the range while the gun is up —
     * the answers the telegraph is drawn to give.
     */
    if (e.archetype === "warden" && e.pose === "musket_windup") {
      const d = Math.hypot(e.x - x, e.y - y);
      let da = Math.atan2(y - e.y, x - e.x) - e.facing;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (d < MUSKET_RANGE + 10 && Math.abs(da) < ((MUSKET_SPREAD_DEG / 2 + 8) * Math.PI) / 180) cost += 160;
    }

    // A marked strike takes the ground away for as long as the marker lasts.
    if (e.strike.markMs > 0) {
      const dm = Math.hypot(e.strike.x - x, e.strike.y - y);
      if (dm < e.strike.radius + PLAYER_RADIUS + 8) cost += 220;
    }
  }

  /*
   * The expansion's attack kinds (`attacks.ts`), priced as a player who has
   * learned them would: a rift's line is left across it while it grows, an
   * armed seed is walked round, a lob's landing ring is stepped out of once
   * the throw is on its way, a hook's drawn line and a live chain or beam are
   * not stood on.
   */
  for (const r of w.rifts) {
    if (!r.alive || (r.teleMs <= 0 && r.activeMs <= 0)) continue;
    if (riftHits(r, x, y, PLAYER_RADIUS + 8)) cost += r.teleMs > 350 ? 180 : 280;
  }
  for (const m of w.mines) {
    if (!m.alive || m.burstMs > 0) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    // Set off: get out of the blast before it goes.
    if (m.primeMs > 0) { if (d < MINE_BLAST + PLAYER_RADIUS + 6) cost += 300; continue; }
    if (d < MINE_TRIGGER + PLAYER_RADIUS + 10) cost += m.inertMs > 0 ? 50 : 200;
    else if (m.inertMs <= 0 && d < MINE_BLAST + PLAYER_RADIUS) cost += 40;
  }
  for (const l of w.lobs) {
    if (!l.alive || l.t < 0.3) continue;
    if (Math.hypot(l.x1 - x, l.y1 - y) < l.radius + PLAYER_RADIUS + 6) cost += 240;
  }
  for (const t of w.tethers) {
    if (!t.alive || t.kind === "ward") continue;
    if (t.kind === "hook" && t.phase !== "aim" && t.phase !== "fly") continue;
    const ends = tetherEnds(w, t);
    if (!ends) continue;
    const vx = ends.x1 - ends.x0;
    const vy = ends.y1 - ends.y0;
    const len2 = vx * vx + vy * vy || 1;
    const k = Math.max(0, Math.min(1, ((x - ends.x0) * vx + (y - ends.y0) * vy) / len2));
    if (Math.hypot(x - (ends.x0 + vx * k), y - (ends.y0 + vy * k)) < PLAYER_RADIUS + 12) cost += 240;
  }
  /*
   * A travelling shockwave (the boss's slam). The band the ring will occupy
   * over the next third of a second is what the model steps out of — the
   * live band alone is already too late to price, because by the time a
   * candidate step is taken the ring has moved.
   */
  for (const s of w.shockwaves) {
    if (!s.alive) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    const lead = s.chargeMs > 0 ? 0 : (s.speed * SHOCK_LOOKAHEAD_MS) / 1000;
    // A sword wave is one arc of the ring; outside its arc is safe, and is the answer.
    if (s.facing !== undefined && s.half !== undefined) {
      let off = Math.atan2(y - s.y, x - s.x) - s.facing;
      while (off > Math.PI) off -= Math.PI * 2;
      while (off < -Math.PI) off += Math.PI * 2;
      if (Math.abs(off) > s.half + Math.asin(Math.min(1, (PLAYER_RADIUS + 8) / Math.max(d, 1)))) continue;
    }
    if (d >= s.inner - PLAYER_RADIUS && d <= s.inner + s.thickness + lead + PLAYER_RADIUS)
      cost += s.chargeMs > 0 ? 200 : 320;
  }

  /*
   * **A turning arm.** Priced along its spine and along the spine it will
   * have swung to, so the cost is a wedge rather than a line and the model
   * leaves *against* the rotation or crosses it, which is the move.
   */
  for (const a of w.arms) {
    if (!a.alive) continue;
    /*
     * Laid on the floor, the chain's sweep is drawn as the wedge it will cross
     * (the renderer's tell), so a player reads that wedge, not the line: priced
     * the same, between the ground under his body it passes over and its reach.
     */
    if (a.teleMs > 0) {
      const span = (a.spin * a.activeMaxMs) / 1000;
      const d = Math.hypot(x - a.x, y - a.y);
      let off = (Math.atan2(y - a.y, x - a.x) - a.angle) * Math.sign(span || 1);
      while (off < 0) off += Math.PI * 2;
      while (off >= Math.PI * 2) off -= Math.PI * 2;
      const pad = Math.asin(Math.min(1, (PLAYER_RADIUS + a.width / 2) / Math.max(d, 1)));
      if (d > a.inner - PLAYER_RADIUS && d < a.length + PLAYER_RADIUS + 10
        && (off <= Math.abs(span) + pad || off >= Math.PI * 2 - pad)) cost += 220;
      continue;
    }
    const lead = (a.spin * ARM_LOOKAHEAD_MS) / 1000;
    const here = armDistance(a, x, y);
    const soon = armDistance({ ...a, angle: a.angle + lead }, x, y);
    const near = Math.min(here, soon) <= a.width / 2 + PLAYER_RADIUS + 10;
    if (near) cost += a.teleMs > 0 ? 160 : 300;
  }

  /*
   * **The leap's landing.** The mark is drawn on the floor from the gather,
   * and the shadow closes on it, so the ground under it is priced for the
   * whole of the move — the model had no term for it and stood under the king.
   */
  for (const e of w.enemies) {
    if (e.archetype !== "boss" || e.hp <= 0 || e.bossCastMs <= 0) continue;
    if (e.bossCast === "leap" && Math.hypot(e.bossTargetX - x, e.bossTargetY - y) <= BOSS_LEAP_RADIUS + PLAYER_RADIUS + 10) cost += 280;
    // And the slam's: the sword is driven into the ground round his feet, drawn filled from the raise.
    if (e.bossCast === "slam" && Math.hypot(e.x - x, e.y - y) <= BOSS_SLAM_IMPACT_PX + PLAYER_RADIUS + 10) cost += 280;
  }

  /*
   * Burning ground, which is the one hazard that persists — **somebody
   * else's**. The player's own ground never burns the player (doc 006), and
   * a player who knows that walks through it: the model priced every patch
   * alike and so stepped round its own fields, trails and burning floors,
   * which gave the fight away to the spells built to be stood in. Burning
   * grass is the room's fire whatever lit it, and priced as such.
   */
  for (const f of w.fires) {
    if (!f.alive) continue;
    if (f.owner === "player" && !f.fromGrass) continue;
    if (Math.hypot(f.x - x, f.y - y) < f.radius + PLAYER_RADIUS + 4) cost += 160;
  }

  /*
   * The room's own hazards, which the model could always see and never
   * priced. Spike strips were 61% of every heart it lost — not because spikes
   * are strong, but because a model with no term for them treats a spike
   * strip as floor. A contact hazard costs a heart on the first frame, so it
   * is weighted like a bullet about to land; a slow-ticking pool is a place to
   * leave, not a place never to step.
   */
  const hz = hazardAt(w, x, y);
  // Lava costs as much as spikes to walk on; the model does not plan dashes over it, so it goes round.
  if (hz) cost += hz.effect === "contact" || hz.effect === "lava" ? 220 : hz.effect === "slip" ? 30 : 120;

  // Walls are not damage, but they remove the room to dodge into, which is
  // what actually kills a cornered player.
  //
  // Scaled by how much is actually in the air. At a flat weight this term
  // peaked above the route bonus, so the model would rather circle an open
  // floor forever than squeeze down a corridor to reach the last turret:
  // every timeout in the harness traced back to that trade. Space to dodge
  // into is only worth anything when there is something to dodge.
  const wall = Math.min(x, y, WORLD_W - x, WORLD_H - y);
  if (wall < WALL_MARGIN) cost += (WALL_MARGIN - wall) * 2 * threatScale(w);

  // Hold a firing line, further out when hurt.
  if (target) {
    // Holding range only makes sense against something it can see; out of
    // sight, the route term above is what moves it.
    if (target.visible) {
      const edge = standoff(target, prof);
      const want = hurt ? edge * 1.6 : edge;
      const d = Math.hypot(target.x - x, target.y - y);
      /*
       * Asymmetric, and much heavier on the near side.
       *
       * Both halves of this were wrong for melee. The weight was 0.5 per px
       * either way, which was calibrated for a shooter holding a line at 200
       * px where being twenty px off is nothing; the melee band is fifteen px
       * wide, so at 0.5 the term could not outvote anything and the model sat
       * wherever the route pull left it. Measured, that was a **median 36 px
       * from the tank's centre at the moment it was hit** — twenty px off its
       * body, dead on the axis of the blade, and barely half the distance it
       * should have been holding.
       *
       * And symmetry is wrong on its face: standing too far away costs a beat
       * of tempo, standing too close costs a heart. Pricing them the same is
       * what let a cheap pull inwards go unanswered.
       */
      cost += d < want ? (want - d) * 4 : (d - want) * 0.5;
    } else if (hasLineOfSight(w.room.grid, x, y, target.x, target.y)) {
      // Any step that opens the shot is worth taking.
      cost -= 90;
    }
  }

  return cost;
}

/**
 * The nearest enemy the player can actually shoot, and how far it is.
 *
 * Preferring line of sight matters more than it sounds: without it the model
 * locks onto the nearest turret behind a pillar and empties the staff into
 * cover forever, which the harness then reports as an unclearable room
 * rather than as a bad target choice.
 */
const PROJECTILE_SPEED = 600;

function leadPoint(px: number, py: number, t: { x: number; y: number; vx: number; vy: number }) {
  const flight = Math.hypot(t.x - px, t.y - py) / PROJECTILE_SPEED;
  return { x: t.x + t.vx * flight, y: t.y + t.vy * flight };
}

/** How far out of its way the model goes for a heart when it is not yet hurt. */
const HEART_DETOUR_PX = 160;

function nearestHeart(w: World): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const k of w.pickups) {
    if (!k.alive || k.kind !== "heart") continue;
    const d = (k.x - w.player.x) ** 2 + (k.y - w.player.y) ** 2;
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

/** How long a target may go unhurt before the model stops holding its line. */
const STALL_MS = 5000;
const stalls = new WeakMap<World, { id: number; hp: number; since: number }>();

/** Whether the model has been failing to hurt this target for `STALL_MS`. */
function stall(w: World, id: number, hp: number): boolean {
  const now = w.stats.elapsedMs;
  const s = stalls.get(w);
  if (!s || s.id !== id || s.hp !== hp) {
    stalls.set(w, { id, hp, since: now });
    return false;
  }
  return now - s.since > STALL_MS;
}

function nearestEnemy(w: World): Target | null {
  let visible: Omit<Target, "visible"> | null = null;
  let visibleD = Infinity;
  let any: Omit<Target, "visible"> | null = null;
  let anyD = Infinity;

  for (const e of w.enemies) {
    if (e.hp <= 0 || e.spawnFadeMs > 0) continue;
    // A destroy room's marked turrets are what a person goes for (doc 025): read as a third as far.
    const d = ((e.x - w.player.x) ** 2 + (e.y - w.player.y) ** 2) / (e.objectiveTarget ? 9 : 1);
    if (d < anyD) { anyD = d; any = e; }
    if (hasLineOfSight(w.room.grid, w.player.x, w.player.y, e.x, e.y) && d < visibleD) {
      visibleD = d;
      visible = e;
    }
  }
  if (visible) return { ...visible, visible: true };
  return any ? { ...any, visible: false } : null;
}

