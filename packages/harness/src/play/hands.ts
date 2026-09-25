/**
 * **What the hands do with a spell key this step**, given the player wants
 * that key's spell: hold it, or let it up.
 *
 * For most spells that is simply "hold it" — a held key recasts the moment
 * its cooldown clears (doc 006). Two of doc 006's options change what the
 * key itself means, and a measurement that pressed them like every other
 * key would measure a player who does not know how they work:
 *
 * - **`charge`**: holding is the charge and letting go is the cast, so a key
 *   held for ever never fires. The hands hold it to a full charge and let it
 *   up for one step (`"full"`), or let it up at once for the tap figure
 *   (`"tap"`).
 * - **`charges`**: the bank refills only while the key is up, so a key held
 *   down between presses never banks a second charge. The hands press only
 *   when a press would fire — a charge banked, the last cast recovered, the
 *   bar able to pay — and leave the key up otherwise, which is tapping on
 *   every charge.
 *
 * One function for the bench and the reference player, so the numbers the
 * pool is levelled against and the runs the Director is measured on press
 * these keys the same way (the harness and the game have to agree on what a
 * press is, or the one tunes the other with the wrong input).
 */
import { ITEMS, PLAYER_RADIUS, TILE_PX, bankOf, chargeMsOf, chargesOf, hasLineOfSight, meleeSpec, slotCost, spellReady } from "@jr/core";
import type { ItemRegistry, World } from "@jr/core";

export type ChargeHold = "full" | "tap";

export function holdsKey(w: World, key: number, hold: ChargeHold = "full", items: ItemRegistry = ITEMS): boolean {
  const slot = w.spells[key];
  if (!slot) return false;
  const p = w.player;
  const full = chargeMsOf(items, slot.item.base);
  if (full > 0) {
    // Already charging this key: keep holding until the charge is full, then let it up.
    if (p.chargeKey === key) return hold === "full" && p.chargeMs < full;
    return true;
  }
  if (chargesOf(items, slot.item.base) > 0)
    return spellReady(slot, items) && bankOf(slot, items) >= 1 && p.castRecoverMs <= 0
      && p.castPending < 0 && p.mana >= slotCost(slot, items, w.staff);
  return true;
}

/**
 * **Whether the hands would press this key at all, now**, for the shapes of
 * doc 006 whose key only makes sense at a moment — beside `holdsKey`, which
 * is *how* a key is pressed. One function for the reference player so that
 * what a measured run does with these keys is what a player who knows them
 * does, and no new input is asked of the game: each answer is a press of the
 * same key at a better time.
 *
 * - **`stance`**: when a hit is about to land — a body's blade winding up or
 *   lunging within reach of the caster, or an enemy shot that will reach
 *   them — inside the guard's own span, and never while a guard is up.
 * - **`enchant`**: before closing to swing — a body within a few steps — and
 *   not while the sword is still enchanted.
 * - **`trail`**: while moving, with a body near enough to walk the ground
 *   into, and not while a trail is still running.
 * - **`boomerang`**: at a body the throw reaches; a blade that turns short of
 *   its target is a press for nothing.
 * - **A line of eruptions**: at a body the line reaches, for the same reason.
 *
 * Every other shape is pressed whenever the rotation offers it.
 */
export interface KeyMoment {
  /** Whether the caster is moving this step. */
  readonly moving: boolean;
  /** The body the key would be cast at, if any. */
  readonly target: { readonly x: number; readonly y: number } | null;
}

/** Within a few steps: how close a body is before an enchant is worth raising for the swing. */
const ENCHANT_CLOSE_PX = 110;
/** How near a body is before a trail is worth laying: a few strides. */
const TRAIL_NEAR_PX = 140;
/** How far past a blade's reach a body may stand and still be worth the throw: its own width. */
const THROW_SLACK_PX = 16;

export function keyWanted(w: World, key: number, at: KeyMoment, items: ItemRegistry = ITEMS): boolean {
  const slot = w.spells[key];
  if (!slot) return false;
  const params = (items.get(slot.item.base)?.params ?? {}) as Record<string, unknown>;
  const n = (k: string, d: number) => (typeof params[k] === "number" ? (params[k] as number) : d);
  const p = w.player;
  switch (params.shape) {
    case "stance": return !p.stance && hitIncoming(w, n("stance_ms", 700));
    case "enchant": return !p.enchant && nearestBody(w) <= ENCHANT_CLOSE_PX;
    case "trail": return !p.trail && at.moving && nearestBody(w) <= TRAIL_NEAR_PX;
    case "boomerang":
      return at.target !== null && Math.hypot(at.target.x - p.x, at.target.y - p.y) <= n("reach", 110) + THROW_SLACK_PX;
  }
  if (params.shape === "eruption" && (params.pattern ?? "line") === "line") {
    const length = (n("first", 1.2) + (n("count", 1) - 1) * n("step", 1)) * TILE_PX;
    if (!at.target || Math.hypot(at.target.x - p.x, at.target.y - p.y) > length + THROW_SLACK_PX) return false;
  }
  return true;
}

function nearestBody(w: World): number {
  let best = Infinity;
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.spawnFadeMs > 0 || e.airborne) continue;
    best = Math.min(best, Math.hypot(e.x - w.player.x, e.y - w.player.y) - e.radius);
  }
  return best;
}

/**
 * Whether an enemy hit will land on the caster within `withinMs`, as far as
 * a player can read one: a blade in its windup or lunge whose reach covers
 * them, a body with its turn to attack already at arm's length, a shooter's
 * aim telegraphed at them, or a shot on a line that passes through them
 * before then. Everything here is on the screen: a windup is a pose, a turn
 * to attack is a body stepping in, a telegraph is drawn.
 */
export function hitIncoming(w: World, withinMs: number): boolean {
  const p = w.player;
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.spawnFadeMs > 0) continue;
    // A shooter's volley wound up and about to leave, with the caster in its sight.
    if (e.telegraphMs > 0 && e.telegraphMs <= withinMs && hasLineOfSight(w.room.grid, e.x, e.y, p.x, p.y)) return true;
    const committed = e.attack === "windup" || e.attack === "lunge";
    if (!committed && !(e.hasToken && e.attack === "approach")) continue;
    if (e.attack === "windup" && e.attackMs > withinMs) continue;
    // The armed blade's reach, or — read off the telegraph before it is armed — the attack's own.
    const reach = e.swing.reach > 0 ? e.swing.reach : (meleeSpec(e)?.reachTiles ?? 1) * TILE_PX;
    const gap = Math.hypot(e.x - p.x, e.y - p.y);
    if (gap <= reach + PLAYER_RADIUS + e.radius) return true;
  }
  const s = withinMs / 1000;
  for (const b of w.enemyBullets) {
    if (!b.alive) continue;
    // The closest the shot comes to the caster within the span, on its line.
    const rx = p.x - b.x, ry = p.y - b.y;
    const v2 = b.vx * b.vx + b.vy * b.vy;
    const t = v2 > 0 ? Math.max(0, Math.min(s, (rx * b.vx + ry * b.vy) / v2)) : 0;
    const cx = b.x + b.vx * t - p.x, cy = b.y + b.vy * t - p.y;
    if (Math.hypot(cx, cy) <= b.radius + PLAYER_RADIUS) return true;
  }
  return false;
}
