/**
 * **The newer shapes' clocks** (doc 006): the orb that drifts and strikes,
 * the boomerang that flies out and home, the trail that drops ground by the
 * distance walked, and the enchant's wave thrown by a sword swing.
 *
 * `fireUnit` in `cast.ts` is where each of them is *started*, as every shape
 * is; this is what each does on the steps after. None of them hurts a body
 * here. An orb's strike and an enchant's wave are bullets, and a boomerang
 * is one, so the hit, the element, the knockback and every hit and kill
 * affix resolve in `stepPlayerBullets` exactly as a shot's do; a trail's
 * patches are the player's ground, and `resolveFires` bills them. What this
 * module owns is only where those things go and when they appear.
 */
import type { Bullet, Enemy, World } from "./types.ts";
import { PLAYER_RADIUS } from "./types.ts";
import { acquire } from "./bullets.ts";
import { circleHitsWall, hasLineOfSight, moveSliding, normalise, WORLD_H, WORLD_W } from "./collide.ts";
import { arcJumps } from "./affix-hooks.ts";
import { angleDelta } from "./aim.ts";
import { copyPowers } from "../content/tags.ts";
import { lightOwnPatch } from "./fire.ts";

/* ----------------------------------- orb ---------------------------------- */

/**
 * How fast an orb's strike leaves the orb, in px/s. It is born on the body it
 * strikes and lands on the step it is born, so this is only the direction the
 * blow knocks the body — and it is kept above a crawl, so nothing reads a
 * strike as a bolt standing still.
 */
const STRIKE_SPEED = 60;
/** How long a strike may live if its body moved off it that same step: three frames, then it is gone. */
const STRIKE_LIFE_MS = 50;
/** How far out of the hand an orb is born, so it is seen leaving it. */
export const ORB_OFFSET_PX = 12;
/**
 * What an orb's strike weighs. Light: several a second, from each of several
 * orbs, and a stream of blows that each knocked a body back its own width
 * would carry it out of every orb's reach.
 */
const STRIKE_WEIGHT = 0.3;

function striking(e: Enemy): boolean {
  return e.hp > 0 && e.spawnFadeMs <= 0 && !e.airborne;
}

/**
 * Every orb drifts on, and each whose clock has come round strikes the
 * nearest body within its reach that it can see. The clock is held at zero
 * while nothing is in reach, so the first body to come into it is struck at
 * once rather than on whatever beat the clock happened to be on.
 */
export function stepOrbs(w: World, dtMs: number): void {
  const dt = dtMs / 1000;
  for (const o of w.orbs) {
    if (!o.alive) continue;
    o.lifeMs -= dtMs;
    if (o.lifeMs <= 0) { o.alive = false; continue; }
    // Drifts, and stops against a wall rather than passing through it.
    const moved = moveSliding(w.room.grid, o, o.vx * dt, o.vy * dt, 4);
    if (moved.blockedX) o.vx = 0;
    if (moved.blockedY) o.vy = 0;
    o.zapClockMs = Math.max(0, o.zapClockMs - dtMs);
    if (o.zapClockMs > 0) continue;
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of w.enemies) {
      if (!striking(e)) continue;
      const d = Math.hypot(e.x - o.x, e.y - o.y);
      if (d > o.zapReach + e.radius || d >= bestD) continue;
      if (!hasLineOfSight(w.room.grid, o.x, o.y, e.x, e.y)) continue;
      best = e;
      bestD = d;
    }
    if (!best) continue;
    o.zapClockMs = o.zapMs;
    o.lastTargetId = best.id;
    const b = acquire(w.playerBullets, true);
    if (!b) continue;
    const dir = normalise(best.x - o.x, best.y - o.y);
    b.delivery = "strike";
    b.x = best.x;
    b.y = best.y;
    // Where the blow came from, so it is drawn from the orb to the body.
    b.originX = o.x;
    b.originY = o.y;
    b.vx = dir.x * STRIKE_SPEED;
    b.vy = dir.y * STRIKE_SPEED;
    b.radius = 3;
    b.damage = o.damage;
    b.lifeMs = STRIKE_LIFE_MS;
    b.targetId = best.id;
    b.pierce = 0;
    // A strike never splits, bounces or homes: `fork`, `ricochet` and `seek`
    // do not list the orb, and a strike that split would be one affix
    // turned into a shard for every blow of every orb.
    b.split = 0;
    b.bounce = 0;
    b.homing = 0;
    b.weight = STRIKE_WEIGHT;
    b.affixes = o.affixes;
    b.spellIndex = o.spellIndex;
    b.manaSpent = o.manaSpent;
    b.arcLeft = arcJumps(o.affixes);
    b.element = o.element;
    b.elementPower = o.elementPower;
    copyPowers(b.powers, o.powers);
    b.proc = o.proc;
    b.statusMult = o.statusMult;
    /*
     * Not counted in `shotsFired`: that figure is the casts the player made
     * (the playtest log and the renderer's cast flash both read it), and a
     * strike is the orb's, several a second, long after the press.
     */
    w.events.push({ kind: "spell", x: o.x, y: o.y, what: "orb_strike", amount: best.id, facing: Math.atan2(dir.y, dir.x) });
  }
}

/* -------------------------------- boomerang ------------------------------- */

/**
 * The share of its throwing speed a boomerang has slowed to at the far end
 * of its flight, where it turns: it flies out, slows, and comes back.
 */
const BOOMERANG_SLOWEST = 0.3;
/** How long the return takes to come up to its full speed, in seconds. */
const BOOMERANG_WIND_S = 0.22;

/**
 * **The boomerangs fly**: out along their throw, slowing as the distance left
 * runs out, and turning for home at the end of it or at the first wall; then
 * home, at `returnSpeed`, steering every step at where the caster is **now**
 * (doc 006), until the caster catches it.
 *
 * The turn clears the blade's hit list, which is the whole of "each body is
 * hit once on the way out and once on the way back": the outward pass hits
 * each body once because a hit does not spend it (it pierces everything), and
 * the return is a fresh pass.
 *
 * The way home goes **through walls**. It is a spectral blade coming back to
 * the hand that threw it, and one that caught on a pillar between the caster
 * and where it turned would be a blade lost to the geometry every time the
 * player moved behind cover — the one thing the throw must never punish.
 *
 * Caught is not "run out": a boomerang fires no expire or wall affix, which
 * is why none of those lists it (`SpellShape`). Its lifetime is only a
 * backstop for a caster it can never reach.
 */
export function stepBoomerangs(w: World, dtMs: number): void {
  const dt = dtMs / 1000;
  const p = w.player;
  for (const b of w.playerBullets) {
    if (!b.alive || b.delivery !== "boomerang") continue;
    b.lifeMs -= dtMs;
    if (b.lifeMs <= 0) { b.alive = false; continue; }
    if (!b.returning) {
      const share = Math.max(0, Math.min(1, b.outLeftPx / Math.max(1, b.outPx)));
      const speed = b.launchSpeed * (BOOMERANG_SLOWEST + (1 - BOOMERANG_SLOWEST) * share);
      const dir = normalise(b.vx, b.vy);
      const stepPx = speed * dt;
      const nx = b.x + dir.x * stepPx;
      const ny = b.y + dir.y * stepPx;
      if (circleHitsWall(w.room.grid, nx, ny, b.radius) || nx < 0 || ny < 0 || nx > WORLD_W || ny > WORLD_H) {
        turnHome(w, b);
        continue;
      }
      b.x = nx;
      b.y = ny;
      b.vx = dir.x * speed;
      b.vy = dir.y * speed;
      b.outLeftPx -= stepPx;
      if (b.outLeftPx <= 0) turnHome(w, b);
      continue;
    }
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.hypot(dx, dy);
    const speed = Math.min(b.returnSpeed, Math.hypot(b.vx, b.vy) + (b.returnSpeed * dt) / BOOMERANG_WIND_S);
    const stepPx = speed * dt;
    if (d <= stepPx + PLAYER_RADIUS) {
      b.alive = false;
      w.events.push({ kind: "spell", x: p.x, y: p.y, what: "boomerang_caught" });
      continue;
    }
    b.vx = (dx / d) * speed;
    b.vy = (dy / d) * speed;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
}

function turnHome(w: World, b: Bullet): void {
  b.returning = true;
  b.outLeftPx = 0;
  // A fresh pass: every body it cut on the way out may be cut again.
  b.hitIds.length = 0;
  const home = normalise(w.player.x - b.x, w.player.y - b.y);
  const slow = b.launchSpeed * BOOMERANG_SLOWEST;
  b.vx = home.x * slow;
  b.vy = home.y * slow;
  w.events.push({ kind: "spell", x: b.x, y: b.y, what: "boomerang_turn" });
}

/* ---------------------------------- trail --------------------------------- */

/**
 * A single step's travel longer than this is not walking: the caster was put
 * somewhere (a room entered, a test placing them), and a line of patches
 * across the gap would be ground they never crossed.
 */
const TRAIL_JUMP_PX = 48;

/**
 * **The trail drops its ground** (doc 006): a patch every `dropPx` of the
 * caster's travel — the distance walked, dashed or shoved since the last
 * patch, carried from step to step — never on a clock, so standing still
 * drops nothing. The patches are laid at the points along the step's path
 * where each `dropPx` fell, so a dash lays an even line rather than a clump
 * at its end. The caster's own ground never harms the caster: a patch is
 * the player's, and the player's ground burns only what is not the player
 * (`stepFires`). At the fire pool's cap the trail eats its own tail
 * (`lightOwnPatch`).
 */
export function stepTrail(w: World, dtMs: number): void {
  const p = w.player;
  const t = p.trail;
  if (!t) return;
  const dx = p.x - t.lastX;
  const dy = p.y - t.lastY;
  const d = Math.hypot(dx, dy);
  if (d > 0 && d <= TRAIL_JUMP_PX) {
    const total = t.carriedPx + d;
    const drops = Math.floor(total / t.dropPx);
    for (let i = 1; i <= drops; i++) {
      const along = i * t.dropPx - t.carriedPx;
      const k = along / d;
      lightOwnPatch(w, t.lastX + dx * k, t.lastY + dy * k, { ...t.patch });
    }
    t.carriedPx = total - drops * t.dropPx;
  }
  t.lastX = p.x;
  t.lastY = p.y;
  t.ms -= dtMs;
  if (t.ms <= 0) p.trail = null;
}

/* --------------------------------- enchant -------------------------------- */

/**
 * How much of the swing's arc a wave carries, in degrees: the middle of the
 * sweep the tip travelled (136), so it reads as a thrown blade's edge and
 * not as a half-ring.
 */
export const WAVE_SPAN_DEG = 110;

/**
 * **The enchant's wave** (doc 006): the swing's own crescent edge, thrown.
 *
 * It leaves as the swing's active window **ends**, from the arc the blade's
 * tip has just traced: the middle `WAVE_SPAN_DEG` of it, at the swing's full
 * reach about the swing's centre where the player stands at release. It
 * does not grow. It keeps the size and curve of the edge it came from and
 * **flies forward** along the swing's facing — its centre travels out from
 * the player, its radius stays the reach — `reachPx` (`wave_reach`) past the
 * swing, passing through every body it crosses, each once. The room's
 * geometry never stops or cuts it: it is short, and a crescent with a bite
 * out of it where it met a pot reads as a broken drawing, not as a rule.
 * It is thrown by the swing and not by a hit, so a swing that misses still
 * throws it; the spin throws none (`stepSwing`).
 *
 * The sword's own box, damage and reach are untouched: the wave is the
 * spell's, and it hits as a shot of the spell does — its element, its level,
 * its hit and kill affixes.
 *
 * It is a bullet for everything a hit resolves, and its geometry rides on
 * the fields a thrown blade flies by: `originX`/`originY` are where its arc
 * was centred at release, `x`/`y` the middle of the arc now, `vx`/`vy` the
 * way it flies (which is the way the arc faces), `radius` **half the band's
 * thickness**, and `outPx`/`outLeftPx`/`launchSpeed` its travel past the
 * swing, what is left of it and its speed. So its centre now is the origin
 * moved on by the travel so far (`waveCentre`), and its radius is the
 * distance from there to `x`/`y` (`waveRadius`). It is flown by `stepWaves`,
 * not integrated, because a wall does not stop it.
 */
export function throwWave(w: World): void {
  const p = w.player;
  const box = w.swing;
  const en = p.enchant;
  if (!en) return;
  const b = acquire(w.playerBullets, true);
  if (!b) return;
  const dir = { x: Math.cos(box.facing), y: Math.sin(box.facing) };
  // Where the tip's arc was: the swing's fully spread reach.
  const reach = box.bladeReach + box.spread;
  b.delivery = "wave";
  b.originX = box.x;
  b.originY = box.y;
  b.x = box.x + dir.x * reach;
  b.y = box.y + dir.y * reach;
  b.vx = dir.x * en.speed;
  b.vy = dir.y * en.speed;
  b.radius = en.radius;
  b.damage = en.damage;
  b.outPx = en.reachPx;
  b.outLeftPx = en.reachPx;
  b.launchSpeed = Math.max(1, en.speed);
  // Its clock is its travel; `lifeMs` is only kept honest for the pool's recycling.
  b.lifeMs = (en.reachPx / b.launchSpeed) * 1000 + 100;
  // Through every body in its reach, and nothing else of a shot's: a wave
  // neither splits nor bounces, and `fork` and `ricochet` do not list it.
  b.pierce = 1e9;
  b.split = 0;
  b.bounce = 0;
  b.homing = 0;
  b.weight = en.weight;
  b.affixes = en.affixes;
  b.spellIndex = en.spellIndex;
  b.manaSpent = en.manaSpent;
  b.arcLeft = arcJumps(en.affixes);
  b.element = en.element;
  b.elementPower = en.elementPower;
  copyPowers(b.powers, en.powers);
  b.proc = en.proc;
  b.statusMult = en.statusMult;
  // A swing's, not a cast: not counted in `shotsFired` (see `stepOrbs`).
  // `amount` 2 for the run's last cut, whose wave is heard heavier (`shapeEventSound`).
  w.events.push({ kind: "spell", x: b.x, y: b.y, what: "wave", facing: box.facing, amount: box.finisher ? 2 : 1 });
}

/**
 * Flies the enchant's waves forward, and returns the ones that ran out this
 * step, for the expiry affixes (`bloom`) — a wave ends at its reach, where a
 * shot would. A wave that has just used up its travel lives one more step
 * where it stopped, so a body standing at the far end is still crossed.
 */
export function stepWaves(w: World, dtMs: number): Bullet[] {
  const ended: Bullet[] = [];
  for (const b of w.playerBullets) {
    if (!b.alive || b.delivery !== "wave") continue;
    b.lifeMs -= dtMs;
    if (b.outLeftPx <= 0 || b.lifeMs <= 0) {
      b.alive = false;
      ended.push(b);
      continue;
    }
    const stepPx = Math.min(b.outLeftPx, b.launchSpeed * (dtMs / 1000));
    const dir = normalise(b.vx, b.vy);
    b.x += dir.x * stepPx;
    b.y += dir.y * stepPx;
    b.outLeftPx -= stepPx;
  }
  return ended;
}

/** How far a wave has flown past the swing. */
function waveTravel(b: Bullet): number {
  return b.outPx - b.outLeftPx;
}

/** Where a wave's arc is centred now: where it was thrown from, moved on by its travel. */
export function waveCentre(b: Bullet): { x: number; y: number } {
  const dir = normalise(b.vx, b.vy);
  const t = waveTravel(b);
  return { x: b.originX + dir.x * t, y: b.originY + dir.y * t };
}

/** A wave's radius: the swing's reach it was thrown at, which it keeps. */
export function waveRadius(b: Bullet): number {
  return Math.max(0, Math.hypot(b.x - b.originX, b.y - b.originY) - waveTravel(b));
}

/** Half the angle a wave spans (`WAVE_SPAN_DEG`). */
export function waveHalfSpan(): number {
  return ((WAVE_SPAN_DEG / 2) * Math.PI) / 180;
}

/**
 * **Whether a wave crosses a body this step.** The arc, not a disc: the arc
 * swept this step, from where its centre was a step ago to where it is now,
 * came within half the band's thickness of the body's edge — the body's
 * distance from the centre, at one end of the step or the other or between,
 * is the wave's radius give or take half its thickness and the body's
 * radius — and the body's bearing from the centre lies inside the arc's
 * span, widened by the angle the body's radius subtends. The room's geometry
 * does not enter into it (`throwWave`).
 */
export function waveHits(b: Bullet, e: { x: number; y: number; radius: number }, dtMs: number): boolean {
  const c = waveCentre(b);
  const dir = normalise(b.vx, b.vy);
  const back = Math.min(waveTravel(b), b.launchSpeed * (dtMs / 1000));
  const R = waveRadius(b);
  const pad = b.radius + e.radius;
  const now = Math.hypot(e.x - c.x, e.y - c.y);
  const was = Math.hypot(e.x - (c.x - dir.x * back), e.y - (c.y - dir.y * back));
  // Crossed if the edge's circle passed over the body between the two ends of the step.
  if (Math.min(now, was) > R + pad || Math.max(now, was) < R - pad) return false;
  const d = Math.max(now, 0.001);
  const margin = Math.asin(Math.min(1, e.radius / d));
  const off = Math.abs(angleDelta(Math.atan2(dir.y, dir.x), Math.atan2(e.y - c.y, e.x - c.x)));
  return off <= waveHalfSpan() + margin;
}

/** The enchant's clock: when it runs out the sword is the plain sword again. */
export function stepEnchant(w: World, dtMs: number): void {
  const en = w.player.enchant;
  if (!en) return;
  en.ms -= dtMs;
  if (en.ms <= 0) w.player.enchant = null;
}
