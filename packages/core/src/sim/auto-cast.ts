/**
 * **Auto-cast**, an assist: the spell keys press themselves.
 *
 * **On a beat.** Once the hands are free — no windup, recovery, charge or
 * guard running — the assist waits a **random** moment
 * (`AUTO_CAST_DELAY_MS` plus up to `AUTO_CAST_SPREAD_MS`) and then draws
 * one key. So between any two auto-casts there is the cast's own windup and
 * recovery and then a fresh wait: one spell at a time, never two back to
 * back, and the random part keeps it from reading as a metronome the player
 * has to play around. The player's own press starts the wait over, so the
 * assist never casts on top of a choice just made.
 *
 * **The draw is among the keys that can go now**: back from cooldown, with
 * a body in reach, not still running, and paid for above the reserve. If
 * none can, the beat waits on, frame by frame, and no weight moves. Each key
 * in the draw counts by its weight:
 *
 * - the key cast goes back to `AUTO_CAST_MIN_WEIGHT`;
 * - **every other key gains** `AUTO_CAST_MISS_WEIGHT`, up to
 *   `AUTO_CAST_MAX_WEIGHT` — the ones in the draw and the ones that sat it
 *   out cooling, out of reach or still running: they were skipped, not
 *   given their turn, so they come back owed;
 * - a key the player casts by hand has had its turn, and goes back down too.
 *
 * **The bar is saved for the key most owed.** When the key with the most
 * weight is back but the bar is short of it, nothing is cast: any other key
 * would spend what it is waiting for. Without this the cheap short keys,
 * always affordable, held the bar under what a dear long one costs, and a
 * 20 s key went once in ten minutes of simulated fight.
 *
 * It also keeps a floor under the bar (`AUTO_CAST_RESERVE`): it never casts
 * a key whose cost would take the bar below that share, so a spell the
 * player reaches for is still paid for.
 *
 * **A ring built by pressing again is built whole** (`stacks`, Blade
 * Storm). Once the draw casts it, the assist presses it again at
 * `AUTO_CAST_RUN_MS` until it is full, waiting a moment on its
 * short cooldown, and then goes back to the draw. On the ordinary beat, a
 * turn in three, its blades ran out as fast as they were added.
 *
 * **It does not break the player's stride.** A spell's windup and recovery
 * slow the caster, and a slow the player did not choose, dropped into a
 * walk or a run of swings, is a stumble. So the press goes as
 * `Input.spellAuto` and its cast keeps its timing but not its slow.
 *
 * Input only. It decides which key to report as pressed and nothing else;
 * the simulation sees a press, exactly as if the player had made it.
 */

import { TILE_PX } from "../types.ts";
import { ITEMS } from "../spells/items.ts";
import type { ItemRegistry } from "../spells/items.ts";
import { castsItself, chargeMsOf, slotCost, spellReady } from "./spells.ts";
import { lodgeMaxOf } from "./recall.ts";
import { hasLineOfSight } from "./collide.ts";
import type { Enemy, World } from "./types.ts";


/**
 * **How far a spell reaches, for auto-cast**, in px: the farthest a body can
 * stand and still be hit by a press aimed at it. A key casts itself only at
 * a body inside its own reach, so a short spell is not thrown into the air
 * at a body five tiles off, and a long one is not held back while one is.
 *
 * Read off the spell's shape and figures, not measured: a shot flies
 * `speed × lifetime`; a line or ring of eruptions reaches its last cell; a
 * thing put on the floor stands at `reach`; a ring round the caster reaches
 * its radius. Capped at `AUTO_CAST_MAX_REACH_PX`, so nothing is cast at a
 * body the player cannot see. Affixes that stretch a shot are not counted:
 * the reach is a spell's base, which errs short.
 */
export function autoCastReach(params: Readonly<Record<string, number | string>>): number {
  const n = (k: string, d = 0): number => (typeof params[k] === "number" ? params[k] as number : d);
  const shape = typeof params["shape"] === "string" ? params["shape"] : "bolt";
  const radius = n("radius");
  let reach: number;
  switch (shape) {
    case "eruption": {
      const pattern = params["pattern"] ?? "line";
      const first = n("first", 1.2) * TILE_PX, step = n("step", 1) * TILE_PX;
      // A rock out of the sky (Meteor) seeks the whole screen; one out of the floor, `reach` tiles.
      if (pattern === "scatter") reach = n("telegraph_ms") > 0 ? AUTO_CAST_MAX_REACH_PX : n("reach", 4) * TILE_PX + n("area") * TILE_PX;
      else reach = first + (Math.max(1, n("count", 1)) - 1) * step + radius;
      break;
    }
    case "field": case "vortex": case "pillar": case "boomerang": reach = n("reach", 64) + radius; break;
    // The ring lasts seconds: put it up as a body closes, not once it is inside.
    case "orbit": reach = n("orbit_radius", 48) + radius + 2 * TILE_PX; break;
    // A slow orb drifts out and strikes what comes within its reach.
    case "orb": reach = n("speed") * n("lifetime") + n("zap_reach"); break;
    // The sword's swing, and the wave it throws.
    case "enchant": reach = n("wave_reach", 80) + 40; break;
    // A companion shoots what is in its own reach.
    case "summon": reach = n("reach", 200); break;
    // Fire left under the feet: worth laying only with a body close.
    case "trail": reach = 3 * TILE_PX; break;
    default: reach = n("speed") * n("lifetime", 1.2) + radius;
  }
  return Math.min(AUTO_CAST_MAX_REACH_PX, reach);
}

/** **Whether a spell may ever press itself**: core's `castsItself`, which the spell's card quotes too. */
export function autoCastable(params: Readonly<Record<string, number | string>>, chargeMs: number): boolean {
  return chargeMs === 0 && castsItself(params);
}

/**
 * **An enchant or a companion is cast at the fight, not at a body.** An
 * enchant runs on the sword for seconds and is spent by the swings; a
 * companion follows the player and finds its own targets. So either goes up
 * whenever a body is awake in the room, however far. Held to a reach, the
 * enchant waited for a body inside four tiles, and a key with a long reach
 * beside it (Meteor) took every turn first.
 */
export function autoCastAnyReach(params: Readonly<Record<string, number | string>>): boolean {
  // A recall's blades come home from wherever the sword left them (`lodge_max`).
  return params["shape"] === "enchant" || params["shape"] === "summon" || Number(params["lodge_max"] ?? 0) > 0;
}

/**
 * **A recall is cast with blades to call** (`lodge_max`): half its most, or
 * any blade about to run out. One blade called home as each lands spends a
 * press on every blow; waiting for the whole six lets the oldest lapse.
 */
export const AUTO_RECALL_SHARE = 0.5;
/** How near its end a lone blade is called home anyway, ms. */
export const AUTO_RECALL_LAPSE_MS = 1500;
export function autoRecallDue(out: number, max: number, soonestLeftMs: number): boolean {
  if (max <= 0) return true;
  return out >= Math.ceil(max * AUTO_RECALL_SHARE) || (out > 0 && soonestLeftMs <= AUTO_RECALL_LAPSE_MS);
}

/**
 * **How much of the casting the assist does.** `off`: every cast is a key
 * the player presses. `space`: one key under the thumb casts a ready spell
 * at the player's moment, and the assist picks which (`pickNow`) — the
 * spell keys sit under the fingers that swing, dash and spin, and the
 * thumbs had nothing to do. `auto`: the assist picks the moment too
 * (`pick`). U, I and O cast the key chosen in all three.
 */
export type AutoCastMode = "off" | "space" | "auto";
/** In the order the setting steps through them. */
export const AUTO_CAST_MODES: readonly AutoCastMode[] = ["off", "space", "auto"];

/**
 * The mode a saved setting names, and for none, the style's own: `auto` for
 * the spell spammer, whose run is many keys cast often, and `space` for the
 * rest. `"0"` and `"1"` are the on/off switch it was, and keep their
 * meaning: a player who turned the assist on keeps it on. A setting the
 * player picked is theirs whatever the style.
 */
export function autoCastModeOf(saved: string | null, style?: string): AutoCastMode {
  if (saved === "0" || saved === "off") return "off";
  if (saved === "1" || saved === "auto") return "auto";
  if (saved === "space") return "space";
  return style === "spam" ? "auto" : "space";
}

/** The farthest any key reaches for auto-cast: about what the screen shows round the player. */
export const AUTO_CAST_MAX_REACH_PX = 10 * TILE_PX;

/** The least the beat waits, from the hands coming free, in ms of fight time. */
export const AUTO_CAST_DELAY_MS = 700;
/** The most on top of that, drawn afresh for each wait. */
export const AUTO_CAST_SPREAD_MS = 900;
/** The share of the bar an auto-cast never spends into. */
export const AUTO_CAST_RESERVE = 0.3;
/** A key's weight in the draw just after it casts, by the assist or by hand. */
export const AUTO_CAST_MIN_WEIGHT = 0.1;
/** A key's weight before it has ever cast. */
export const AUTO_CAST_START_WEIGHT = 1;
/** What a key gains for each draw it does not win, in it or sitting it out. */
export const AUTO_CAST_MISS_WEIGHT = 0.5;
/** The most a key's weight grows to. */
export const AUTO_CAST_MAX_WEIGHT = 4;
/**
 * **The beat of a ring being built** (`AutoCastKey.stacks`, Blade Storm): once
 * the draw casts a key that grows with each press, the assist presses it
 * again this soon after the hands are free, until the ring is full — the
 * spell is a cheap key pressed again and again to keep a storm up, and on
 * the ordinary beat, a turn in three, its blades ran out as fast as they
 * were added and it never got past two.
 */
export const AUTO_CAST_RUN_MS = 150;
/**
 * How long the run waits on its key coming back — its short cooldown, the
 * bar, a body stepping out of reach — before it gives the turn back to the
 * draw. A run held for a key that cannot go would hold every other key too.
 */
export const AUTO_CAST_RUN_WAIT_MS = 1000;

/** What the scene says about one key on this step. */
export interface AutoCastKey {
  /**
   * Whether this key holds a spell the assist may ever press
   * (`autoCastable`), whatever it can do now. A held key that sits a draw
   * out gains weight as if it had lost it.
   */
  readonly held: boolean;
  /**
   * Whether it could go now but for the bar: held, back from cooldown, with
   * a body in its reach, and not still running (an enchant, a ring of
   * blades, a trail, a companion).
   */
  readonly ready: boolean;
  /** What a cast of it takes off the bar. */
  readonly cost: number;
  /** Whether it grows with each press (`stack_max`): drawn, it is pressed again at `AUTO_CAST_RUN_MS`. */
  readonly stacks?: boolean;
  /** Whether it is part built: some of it up and not yet full. The run goes on while this holds. */
  readonly building?: boolean;
}

/** The bar on this step: what is in it, the reserve it keeps, and all it can hold. */
export interface AutoCastBar {
  readonly mana: number;
  readonly floor: number;
  readonly max: number;
}

export class AutoCaster {
  /** When the next draw is, or null until the hands are free again. */
  private next: number | null = null;
  /** Each key's weight in the draw; `AUTO_CAST_START_WEIGHT` until it has one. */
  private readonly weights: number[] = [];
  /**
   * The next draw's roll, made ahead of it, so `peek` can say which key the
   * next cast is before it is made and be right: the same roll over the
   * same keys and weights is the same key.
   */
  private roll: number | null = null;
  /** The key being built at the run's beat (`AUTO_CAST_RUN_MS`), or null. */
  private running: number | null = null;

  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /** A key's weight in the draw now. */
  weight(key: number): number {
    return this.weights[key] ?? AUTO_CAST_START_WEIGHT;
  }

  /** The player cast a key themselves: it has had its turn, and the beat starts over. */
  noteManual(key: number): void {
    this.weights[key] = AUTO_CAST_MIN_WEIGHT;
    this.next = null;
    // The player pressing another key has taken the hands: the run is over.
    if (key !== this.running) this.running = null;
  }

  /** Forgets the beat and every weight: a new room, a paused fight, the assist switched off. */
  reset(): void {
    this.next = null;
    this.roll = null;
    this.running = null;
    this.weights.length = 0;
  }

  /**
   * **The key the next cast would be, without casting it**: for a Space
   * press (`now`), the key `pickNow` would give on this step; for the
   * assist's own beat, the key `pick` would give when the beat comes — the
   * key the bar is being saved for, if it is. Null when no key could go.
   * Nothing moves: no weight, no roll, no beat.
   */
  peek(keys: readonly AutoCastKey[], bar: AutoCastBar, now: boolean): number | null {
    if (now) return this.draw(keys, { ...bar, floor: 0 }, false);
    if (this.running !== null && keys[this.running]?.building) return this.running;
    const saved = this.savedFor(keys, bar);
    return saved ?? this.draw(keys, bar, false);
  }

  /**
   * The key to press on this step, or null.
   *
   * `now` is fight time in ms (a paused fight does not count down a wait).
   * `free` is whether the caster could cast at all — no windup, recovery,
   * charge or guard running — so a key never presses into a refusal.
   */
  pick(now: number, keys: readonly AutoCastKey[], free: boolean, bar: AutoCastBar): number | null {
    if (!free) return null;
    // A ring being built is pressed again at the run's beat, and no weight moves: it is one turn, taken whole.
    if (this.running !== null) {
      const k = keys[this.running];
      if (k?.building) {
        if (this.next === null) { this.next = now + AUTO_CAST_RUN_MS; return null; }
        if (now < this.next) return null;
        if (this.runGoesOn(keys, bar)) {
          this.next = null;
          return this.running;
        }
        // Not back yet: wait on it a while, and then let the draw have the turn.
        if (now < this.next + AUTO_CAST_RUN_WAIT_MS) return null;
      }
      this.running = null;
      this.next = null;
    }
    // The beat is counted from the hands coming free.
    if (this.next === null) { this.next = now + AUTO_CAST_DELAY_MS + this.random() * AUTO_CAST_SPREAD_MS; return null; }
    if (now < this.next) return null;
    if (this.savedFor(keys, bar) !== null) return null;
    const key = this.draw(keys, bar, true);
    // Nothing can go: the beat waits on, and no weight moves.
    if (key !== null) {
      this.next = null;
      if (keys[key]!.stacks) this.running = key;
    }
    return key;
  }

  /**
   * Whether the run's key can be pressed now: part built (some of it up,
   * not yet full), back, and paid for. A full ring is no longer
   * building, and the run ends with it.
   */
  private runGoesOn(keys: readonly AutoCastKey[], bar: AutoCastBar): boolean {
    if (this.running === null) return false;
    const k = keys[this.running];
    return !!k && !!k.building && k.ready && bar.mana - k.cost >= bar.floor;
  }

  /**
   * **The key to cast now, for a press of the one cast key** (`Space`), or
   * null when none can go.
   *
   * The player chose the moment, so there is no beat, no reserve and no
   * saving up: a press that casts nothing while a key stands ready reads as
   * a dropped input. Which key is still the draw's, by the same owed
   * weights, so the dear key comes round as the cheap ones are spent.
   */
  pickNow(keys: readonly AutoCastKey[], free: boolean, bar: AutoCastBar): number | null {
    if (!free) return null;
    const key = this.draw(keys, { ...bar, floor: 0 }, true);
    // The beat of `pick` is for the assist; a key cast here has had its turn all the same.
    if (key !== null) this.next = null;
    return key;
  }

  /** The key the bar is saved for: the most owed, back, and short of the bar — but one it could ever pay. */
  private savedFor(keys: readonly AutoCastKey[], bar: AutoCastBar): number | null {
    const top = Math.max(0, ...keys.map((k, i) => (k.held ? this.weight(i) : 0)));
    const i = keys.findIndex((k, j) => k.ready && bar.mana - k.cost < bar.floor && k.cost + bar.floor <= bar.max && this.weight(j) >= top);
    return i < 0 ? null : i;
  }

  /**
   * The weighted draw among the keys ready and paid for; null for none.
   * `commit` casts it — the weights move and the roll is spent — and
   * without it the draw is only looked at (`peek`).
   */
  private draw(keys: readonly AutoCastKey[], bar: AutoCastBar, commit: boolean): number | null {
    const paid = (k: AutoCastKey) => bar.mana - k.cost >= bar.floor;
    const pool = keys.flatMap((k, i) => (k.ready && paid(k) ? [i] : []));
    if (pool.length === 0) return null;
    const weights = pool.map((i) => this.weight(i));
    this.roll ??= this.random();
    let r = this.roll * weights.reduce((a, b) => a + b, 0);
    let key = pool[pool.length - 1]!;
    for (let n = 0; n < pool.length; n++) {
      r -= weights[n]!;
      if (r < 0) { key = pool[n]!; break; }
    }
    if (!commit) return key;
    this.roll = null;
    // Every other key lost this draw, whether it was in it or sat it out.
    keys.forEach((k, i) => {
      if (i !== key && k.held) this.weights[i] = Math.min(AUTO_CAST_MAX_WEIGHT, this.weight(i) + AUTO_CAST_MISS_WEIGHT);
    });
    this.weights[key] = AUTO_CAST_MIN_WEIGHT;
    return key;
  }
}

/*
 * ========================= the assist, read off a world =========================
 *
 * The draw above sees keys, a bar and a clock. What follows reads those off
 * a `World`, and holds the body a cast goes at, so the game and the harness
 * press through the one assist: a harness run measured with its own spell
 * rotation was measuring a player who does not exist, since the player the
 * game is tuned for fights with the sword and leaves the spells to this.
 */

/**
 * **What an auto-cast is cast at**: the nearest body awake, within reach,
 * and in plain sight. A hand press goes the way the player faces, because
 * they chose the moment and can turn first; the assist chose the moment,
 * so it has to choose the target too, or a cast fired while the player
 * walks away from the fight goes into the empty floor ahead. A body behind
 * a wall is passed over: a bolt spent on stone is the same waste.
 */
export function autoCastTarget(w: World): Enemy | null {
  const p = w.player;
  let best: Enemy | null = null;
  let bestD = AUTO_CAST_MAX_REACH_PX;
  for (const e of w.enemies) {
    if (e.hp <= 0 || !e.awake || e.spawnFadeMs > 0) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > bestD || !hasLineOfSight(w.room.grid, p.x, p.y, e.x, e.y)) continue;
    best = e;
    bestD = d;
  }
  return best;
}

/**
 * **How long a key's last cast is still running**, in ms, for the spells
 * a recast renews rather than adds to: an enchant on the sword, a trail
 * underfoot, a ring of orbiting blades (not one that grows), a companion. Zero for everything
 * else, and for a key whose effect has run out.
 */
export function autoKeyRunningMs(w: World, key: number, items: ItemRegistry = ITEMS): number {
  const p = w.player;
  let ms = 0;
  if (p.enchant?.spellIndex === key) ms = Math.max(ms, p.enchant.ms);
  if (p.trail?.spellIndex === key) ms = Math.max(ms, p.trail.ms);
  /*
   * A ring a recast renews is running; one a recast grows (`stack_max`,
   * Blade Storm) is not — it is built by pressing again, and a ring held
   * back as running never got past its first blade.
   */
  const stacks = Number(items.get(w.spells[key]?.item.base ?? "")?.params["stack_max"] ?? 0) > 0;
  if (!stacks) for (const b of w.playerBullets) if (b.alive && b.orbitMs > 0 && b.spellIndex === key) ms = Math.max(ms, b.orbitMs);
  for (const pet of w.pets) if (pet.alive && pet.spellIndex === key) ms = Math.max(ms, pet.lifeMs);
  return Math.max(0, ms);
}

/** Whether a recall key has blades enough out to be worth its press (`autoRecallDue`); true for any other key. */
export function autoRecallDueIn(w: World, key: number, items: ItemRegistry = ITEMS): boolean {
  const slot = w.spells[key];
  const max = slot ? lodgeMaxOf(items, slot.item.base) : 0;
  if (max <= 0) return true;
  let out = 0, soonest = Infinity;
  for (const b of w.lodged) if (b.spellIndex === key) { out++; soonest = Math.min(soonest, b.ms); }
  return autoRecallDue(out, max, soonest);
}

/** What the assist's draw sees on a step: each key, whether the hands are free, the bar, and the body it would aim at. */
export interface AutoCastView {
  readonly keys: AutoCastKey[];
  readonly free: boolean;
  readonly bar: AutoCastBar;
  readonly target: Enemy | null;
}

/** The draw's view of a world on this step. */
export function autoCastView(w: World, items: ItemRegistry = ITEMS): AutoCastView {
  const p = w.player;
  const free = p.castPending < 0 && p.castRecoverMs <= 0 && p.chargeKey < 0 && !p.stance && p.stunMs <= 0 && p.dashMs <= 0;
  const target = autoCastTarget(w);
  // A body awake anywhere in the room: what an enchant or a companion is cast for (`autoCastAnyReach`).
  const fight = w.enemies.some((e) => e.hp > 0 && e.awake && e.spawnFadeMs <= 0);
  const floor = w.staff.mana_max * AUTO_CAST_RESERVE;
  const dist = target ? Math.hypot(target.x - p.x, target.y - p.y) : Infinity;
  const keys = w.spells.map((slot, i): AutoCastKey => {
    const params = items.get(slot?.item.base ?? "")?.params;
    if (!slot || !params) return { held: false, ready: false, cost: 0 };
    // A tap, never a guard or a move of the body (`autoCastable`).
    const held = autoCastable(params, chargeMsOf(items, slot.item.base));
    /*
     * Only a key whose own reach the body stands in: a short spell is not
     * thrown at a far body. An enchant or a companion needs only a fight.
     * And no spell that is still running (`autoKeyRunningMs`) — an enchant on
     * the sword, the blades round the body, a trail underfoot, the
     * companion: recast early, it spends the bar to renew what is already
     * there. It sits the draws out meanwhile, and comes back owed for them.
     */
    const inReach = autoCastAnyReach(params) ? fight : !!target && dist <= autoCastReach(params);
    // A ring built by pressing again (`stack_max`): how much of it is up, for the run that builds it (`AUTO_CAST_RUN_MS`).
    const stackMax = Number(params["stack_max"] ?? 0);
    const up = stackMax > 0 ? w.playerBullets.filter((b) => b.alive && b.orbitMs > 0 && b.spellIndex === i).length : 0;
    return {
      held,
      ready: held && inReach && autoKeyRunningMs(w, i, items) <= 0 && spellReady(slot, items) && autoRecallDueIn(w, i, items),
      cost: slotCost(slot, items, w.staff),
      ...(stackMax > 0 ? { stacks: true, building: up > 0 && up < stackMax } : {}),
    };
  });
  return { keys, free, bar: { mana: p.mana, floor, max: w.staff.mana_max }, target };
}

/**
 * **The assist whole**: the draw (`AutoCaster`) fed from a world, and the
 * body its cast goes at, held through the windup. The game's scene and the
 * harness's reference player both press through one of these.
 */
export class AutoCastAssist {
  readonly caster: AutoCaster;
  /** The body an auto-cast goes at, from its press until it has left the hand; null for none. */
  private targetId: number | null = null;

  private readonly items: ItemRegistry;

  constructor(random: () => number = Math.random, items: ItemRegistry = ITEMS) {
    this.caster = new AutoCaster(random);
    this.items = items;
  }

  /** A new room, a paused fight, the assist switched off: the beat, the weights and the target all go. */
  reset(): void {
    this.caster.reset();
    this.targetId = null;
  }

  /** The player cast a key by hand: it has had its turn, the beat starts over, and the target is let go. */
  noteManual(key: number): void {
    this.caster.noteManual(key);
    this.targetId = null;
  }

  /** The key the assist casts on this step, or null: on its own beat, or `now` for a press of the one cast key. */
  cast(w: World, now: boolean, clockMs: number): number | null {
    const { keys, free, bar, target } = autoCastView(w, this.items);
    const key = now ? this.caster.pickNow(keys, free, bar) : this.caster.pick(clockMs, keys, free, bar);
    // An enchant or a companion with no body in reach aims nowhere in particular: the facing the player has.
    if (key !== null) this.targetId = target?.id ?? null;
    return key;
  }

  /** The key the next assisted cast would be, without casting it (`AutoCaster.peek`). */
  peek(w: World, now: boolean): number | null {
    const { keys, bar } = autoCastView(w, this.items);
    return this.caster.peek(keys, bar, now);
  }

  /**
   * The facing an auto-cast aims along on this step, in radians, or null to
   * use the player's own. Held on its body **through the windup**, since the
   * shot leaves at the end of it and the body keeps moving; a body that dies
   * first hands the aim to the next nearest. Let go once the cast has left.
   */
  aim(w: World, pressedNow: boolean): number | null {
    if (this.targetId === null) return null;
    const p = w.player;
    if (!pressedNow && p.castPending < 0) { this.targetId = null; return null; }
    let e = w.enemies.find((b) => b.id === this.targetId && b.hp > 0);
    if (!e) {
      e = autoCastTarget(w) ?? undefined;
      this.targetId = e?.id ?? null;
    }
    return e ? Math.atan2(e.y - p.y, e.x - p.x) : null;
  }
}
