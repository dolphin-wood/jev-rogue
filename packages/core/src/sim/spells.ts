/**
 * Three spells on three keys (design doc 013).
 *
 * This is the layer that replaces doc 006's auto-firing staff for the player.
 * The staff cycled a parsed tree on a held button, which was the right shape
 * for a bullet hell where the wand *is* the basic attack. With an arc melee
 * basic attack the wand has no job: the sword is what the player presses by
 * default, and a spell has to be **a decision at a moment**, which a button
 * held down cannot be.
 *
 * A spell is one `ItemInstance` fired through `fireUnit`, so "a summon is a
 * spell and a thrown bolt is a spell" costs nothing to be true: the delivery
 * is what the item already describes, and this module only owns when it
 * happens and what it costs. Spells are self-contained: nothing on one key
 * modifies another.
 *
 * ### Mana is a fraction of the cap, not an amount
 *
 * Doc 013's one mana stat is **maximum mana**, with everything else expressed
 * as a percentage of it, so that neither regeneration nor the sword's return
 * goes proportionally worthless as the cap grows. Doc 006's items carry an
 * absolute `mana` from 1 to 7, and against a cap of 60 a cost of 3 is five per
 * cent — while one sword hit returns nine. One hit paid for nearly two spells,
 * which is exactly the failure doc 013 names: *if mana never binds then spells
 * are free, and if spells are free the sword has no job.*
 *
 * So the item's doc-006 cost is read as a **rank** and mapped onto a share of
 * the cap. The cheapest spell is about one and a half sword hits and the
 * dearest about four, so a room entered on a full bar buys two to six casts
 * before the sword has to earn the next one.
 */
import type { BaseItem, ItemInstance, Staff } from "../types.ts";
import type { ItemRegistry } from "../spells/items.ts";
import { num, str } from "../spells/items.ts";
import { emptyScope, fireUnit, freeCastReach } from "./cast.ts";
import { castAdditions, lodestarTarget, onCast, spreadDirections } from "./affix-hooks.ts";
import { addPowers, dominantElement, noPowers } from "../content/tags.ts";
import { affixCostMult } from "../spells/affixes.ts";
import {
  BURN_DPS, ENEMY_BURN_MS, ENEMY_BURN_SOURCES, ENEMY_FREEZE_MS, ENEMY_POISON_MS,
  ENEMY_POISON_STACKS, POISON_DPS_PER_STACK, SHATTER_MULT,
} from "./enemy.ts";
import type { AttachedAffix } from "./affix-hooks.ts";
import type { FiredShot } from "./cast.ts";
import type { World } from "./types.ts";
import { lodgeMaxOf, lodgedOn } from "./recall.ts";
import { GROUND_STATUS_POWER } from "./fire.ts";

/** Spells the player may hold at once, bound to keys in order. */
export const SPELL_SLOTS = 3;

/**
 * How much of an enemy's elemental gauge one hit fills, at `element_power` 1.
 * A spell's own `element_power` scales it, so a fast needle and a slow spike
 * of the same element do not freeze in the same number of hits.
 */
export const ENEMY_BUILD_PER_HIT = 0.36;

/** The share of the gauge one hit of this item fills, or 0 for no element. */
export function buildPerHit(item: BaseItem): number {
  const element = item.params.element;
  if (typeof element !== "string" || element === "none") return 0;
  const power = typeof item.params.element_power === "number" ? item.params.element_power : 1;
  return ENEMY_BUILD_PER_HIT * power;
}

/**
 * What this spell's element is **worth**, in the numbers a card can show:
 * how many hits fill the gauge, how long the status then runs, and what it
 * deals over that run.
 *
 * A card used to say "Burn: 36% of the gauge a hit, 3 hits to ignite", which
 * is the mechanism and not the value — the player still could not tell
 * whether igniting was worth three hits. Every figure here is read off the
 * simulation's own constants, so a balance pass that moves `BURN_DPS` or
 * `ENEMY_POISON_MS` moves the card with it and cannot leave the two
 * disagreeing.
 *
 * The damage is the status **as it ignites**, on an unresisting body: a burn
 * at one source, a poison at two stacks (`applyElementTo`). Hits landed while
 * it runs stack it higher, and a resistant body takes less; both are the
 * enemy's property rather than the spell's, so neither belongs on the card.
 *
 * Ice deals nothing and says the freeze instead: its payoff is the shatter,
 * which is a multiplier on the next hit.
 */
export interface StatusForecast {
  readonly element: "fire" | "poison" | "ice";
  /** Hits to fill an empty gauge and trigger the status. */
  readonly hits: number;
  /** How long the status runs, in seconds. */
  readonly seconds: number;
  /** What it deals over that run, in whole damage. Zero for ice. */
  readonly damage: number;
  /** What the hit that breaks a freeze is multiplied by. Ice only. */
  readonly shatter: number;
}

/**
 * The share of the gauge one hit — or, for ground, one tick — of this item
 * fills. A field or a trail builds with its ground's own power, whatever its
 * `element_power` says: the ground does its element by its nature
 * (`GROUND_STATUS_POWER`), and a card that read the item's power said a
 * burning patch took eight hits to light what it lights on the second tick.
 */
export function statusPerHit(item: BaseItem): number {
  const ground = item.params.shape === "field" || item.params.shape === "trail";
  const element = item.params.element;
  if (ground && (element === "fire" || element === "poison")) return ENEMY_BUILD_PER_HIT * GROUND_STATUS_POWER;
  return buildPerHit(item);
}

export function statusForecast(item: BaseItem): StatusForecast | null {
  const per = statusPerHit(item);
  if (per <= 0) return null;
  const element = item.params.element;
  if (element !== "fire" && element !== "poison" && element !== "ice") return null;
  // The same count `statusLine` says: the hit that takes the gauge to full.
  const hits = Math.ceil(1 / per - 1e-9);
  if (element === "ice")
    return { element, hits, seconds: ENEMY_FREEZE_MS / 1000, damage: 0, shatter: SHATTER_MULT };
  const [ms, dps] = element === "fire"
    ? [ENEMY_BURN_MS, BURN_DPS * ENEMY_BURN_SOURCES]
    : [ENEMY_POISON_MS, POISON_DPS_PER_STACK * ENEMY_POISON_STACKS];
  const seconds = ms / 1000;
  // `stepEnemy` accrues `dps` a second and pays it out twice a second as a
  // whole number, carrying the remainder, so the run totals exactly this —
  // times the spell's own `status_scale` (`fireOnce`).
  const scale = typeof item.params.status_scale === "number" ? item.params.status_scale : 1;
  return { element, hits, seconds, damage: Math.round(dps * seconds * scale), shatter: 1 };
}

/**
 * **The one staff every run plays.** Doc 013 retired the staff as a thing the
 * player has — there is a sword and there are three keyed spells — so the
 * record that carries the mana pool and the slot count is fixed rather than
 * chosen.
 */
// 90, measured: 70 left half the runs dead at the boss and 120 was no better.
export const RUN_MANA_MAX = 90;
export function runStaff(): Staff {
  return { slots: SPELL_SLOTS, mana_max: RUN_MANA_MAX };
}

/**
 * The share of maximum mana the cheapest and dearest spells cost.
 *
 * Set against `MANA_PER_HIT_FRACTION`, which is 0.09, so the bounds are read
 * as connecting sword hits: **about one hit for the cheapest spell and four
 * for the dearest.** That ratio is the whole economy — it is what makes
 * closing to melee range the way the player affords standing away from it.
 *
 * The floor was 0.15, which put the starting bolt — the cheapest, plainest
 * attack in the pool — at two sword hits a cast. That is the wrong shape at
 * the bottom of the range. A basic ranged option has to be a **tool the player
 * uses freely**, and rationing the plainest thing they own teaches them that
 * spells are not worth pressing. Rationing belongs at the top of the range,
 * where a spell is an event.
 *
 * At 0.08 a full bar is eight casts of the basic bolt and under three of the
 * largest spell, which is the spread that makes the choice between keys mean
 * something.
 */
export const SPELL_COST_MIN_FRACTION = 0.08;
export const SPELL_COST_MAX_FRACTION = 0.35;

/**
 * A cast costs a **number of mana**, not a share of the pool.
 *
 * It was a share: `mana_max x fraction(rank)`, so a staff with a deeper well
 * charged proportionally more for the same spell and held exactly as many
 * casts as a shallow one. The pool was therefore a display unit rather than a
 * resource, `deep_well` bought nothing, and the HUD had nothing to show but a
 * percentage — which is a number the player cannot add up against the bar.
 *
 * The figures are the old ones at the baseline sixty-mana staff, so nothing
 * about the existing balance moves: rank 1 cost 4.8 and now costs 5, rank 2
 * cost 7.5 and still does, rank 7 cost 21 and now costs 20. What changes is
 * everywhere else — a bigger well is now more casts, which is what a player
 * reads it as.
 */
/**
 * **A quarter off every cast**, from 5 + 2.5 a rank.
 *
 * This is where the pool's level against the sword had to come from. Damage
 * per second is damage a hit times casts a second, and the hit is pinned at
 * the top by the first room: a hit big enough to reach the sword's damage per
 * second at the old prices killed a room-1 body outright, and a hit small
 * enough not to left the whole pool at a quarter of the sword and the harness
 * losing every run. Neither is any spell's damage number's fault, so neither
 * was fixed there.
 *
 * A cheaper cast fixes both at once: the same hit, thrown half again as
 * often. A full bar is about eleven casts of the starting bolt and four of
 * the largest spell, against eight and under three, and the sword's refund
 * (`MANA_PER_HIT_FRACTION`) buys correspondingly more — which is the loop the
 * design wants louder, not quieter.
 */
/*
 * **And the quarter back on.** At 3.75 + 1.875 a rank, with the bar full at
 * the start of every room and the sword refunding a cast every hit or two,
 * the bar was never the limit: a held cheap key ran all fight, and the mana
 * upgrades had nothing to buy. 5 + 2.5 a rank is the old price again; the
 * cooldowns do not move with it (`BASELINE_MANA_MAX`).
 */
export const SPELL_COST_BASE = 5;
export const SPELL_COST_PER_RANK = 2.5;
/**
 * The pool the cooldown scale is written against; see `spellCooldownMs`.
 * 80 rather than 60 since the price rose by a third: the rise is meant to
 * make the bar the limit, not to slow every key down, so the cooldowns stay
 * where they were measured.
 */
export const BASELINE_MANA_MAX = 80;

/** The doc-006 mana ranks a spell's cost is interpolated between. */
const RANK_MIN = 1;
const RANK_MAX = 7;

/**
 * Per-spell cooldown, from a floor plus a share proportional to cost.
 *
 * A cooldown proportional to price is what stops a full bar being emptied into
 * one key in a third of a second. Without it the mana cost is the only limit,
 * and a cheap spell pressed every frame is a held button again — the thing
 * this module exists to get rid of.
 */
/*
 * Shortened — 300 to 240 on the floor and 1500 to 1300 on the slope — because
 * the key may now be **held**. A held key casts again the moment the cooldown
 * clears, so the cooldown is the cast rate, and at the old figures the
 * cheapest spell fired about twice a second while a held sword swings faster.
 * The cheap end moves most: the starting bolt goes from 462 ms to 402 ms
 * between casts and the dearest spell barely changes, which is where the
 * "a spell is an event" rationing was always meant to sit.
 */
const COOLDOWN_FLOOR_MS = 240;
const COOLDOWN_PER_FRACTION_MS = 1300;

/**
 * One of the three keyed spells: **an attack, plus the event affixes on it.**
 */
export interface SpellSlot {
  /** The attack this key fires. */
  readonly item: ItemInstance;
  /** Doc 013's event affixes on this spell, each at a tier; up to `AFFIX_SLOTS`. */
  readonly affixes: readonly AttachedAffix[];
  cooldownMs: number;
  /**
   * The spell's **level**, 1 to `SPELL_LEVEL_MAX` (doc 013: "spells have a
   * level, affixes have a tier"). Raised by the blacksmith for gold, or given
   * by an elite room's spell card; it scales damage only.
   */
  readonly level: number;
  /**
   * A `charges` spell's bank (doc 006): the charges held, and how far the
   * next one has come. Unset reads as a full bank, so a spell put on a key —
   * or carried into a new room — starts with every charge ready. See
   * `refillBanks`.
   */
  bank?: number;
  bankMs?: number;
}

/**
 * Five levels: the same reach from first to last as three were — 1.8 times
 * the damage for 1.4 times the mana at the top — in smaller steps, so a run
 * raises its spells more often and each raise is a smaller decision.
 */
export const SPELL_LEVEL_MAX = 5;

/** What a level does to damage: +20% a level. It never changes the spell's shape. */
export function levelDamageMult(level: number): number {
  return 1 + 0.2 * (Math.max(1, Math.min(SPELL_LEVEL_MAX, level)) - 1);
}

/**
 * **A level costs mana too**, at half the rate it adds damage: +10% a level,
 * so a level-5 spell hits 1.8x as hard for 1.4x the mana. More power has to
 * be paid for or a level is free, and paying less than it gives is what keeps
 * a level worth taking.
 */
export function levelManaMult(level: number): number {
  return 1 + 0.1 * (Math.max(1, Math.min(SPELL_LEVEL_MAX, level)) - 1);
}

/** The slot at `level`. */
export function withLevel(slot: SpellSlot, level: number): SpellSlot {
  return { ...slot, level: Math.max(1, Math.min(SPELL_LEVEL_MAX, level)) };
}

/**
 * Gold for taking a spell apart: its level, and every affix tier invested in
 * it, at a lossy rate (doc 013, "Replacing a spell dismantles it into gold").
 */
/** `affixStrengths`: each attached affix's strength (`affixStrengthFloor`), what it is worth. */
export function dismantleValue(level: number, affixStrengths: readonly number[] = []): number {
  return 12 + 8 * (Math.max(1, level) - 1) + 6 * affixStrengths.reduce((a, b) => a + b, 0);
}

/** Doc 013: three affix slots per spell, nine in the run. */
export const AFFIX_SLOTS = 3;

/**
 * Base regeneration, as a share of the cap per second.
 *
 * A trickle, deliberately. Doc 013: base regeneration exists to prevent total
 * lockout, not to supply — if it supplied, the sword would again have no job.
 * It was 5% a second, which is 4.5 mana: a plain bolt every 1.7 s from
 * standing still, so the bar never ran dry and the sword's return meant
 * nothing. At 2% a full bar takes fifty seconds, a cheap spell about four:
 * a floor under a bad fight, not an income.
 */
export const MANA_REGEN_FRACTION_PER_S = 0.02;

/** What one cast of this spell costs, in mana. */
export function spellCost(_item: ItemInstance | null, base: number): number {
  const rank = Math.max(RANK_MIN, Math.min(RANK_MAX, base));
  return SPELL_COST_BASE + (rank - RANK_MIN) * SPELL_COST_PER_RANK;
}

/**
 * A spell's own multiple of the cooldown its cost gives it (`cooldown_scale`
 * in its params): a slow, heavy shot is meant to be thrown seldom, whatever
 * it costs.
 */
export function cooldownScale(items: ItemRegistry, base: string): number {
  const v = Number((items.get(base)?.params as Record<string, unknown> | undefined)?.cooldown_scale);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** How long this spell is unavailable after a cast. */
export function spellCooldownMs(costFraction: number): number {
  return COOLDOWN_FLOOR_MS + costFraction * COOLDOWN_PER_FRACTION_MS;
}

/**
 * **What a cast of this spell leaves behind, and for how long** — the floor
 * under its cooldown (doc 006): "a spell whose damage keeps coming after the
 * press has a cooldown at least as long as what it leaves behind lasts, so a
 * held key keeps one of it up rather than stacking several".
 *
 * Held here for the three shapes that are nothing but what they leave: a
 * trail and an enchant last their `trail_ms` and `enchant_ms`, so a held key
 * renews each as it ends; an orb lasts its `lifetime` and a key may keep
 * `max_alive` of them up, so the floor is the lifetime over that cap — a
 * held key keeps its cap of orbs up and never replaces one before it has
 * run. The field and the summon keep the cooldowns they were levelled on
 * (a body pays a field's toll once however many patches it stands in, and
 * a summon renews its one companion), and a field that wants the rule — Toxic
 * Cloud — carries it in its own `cooldown_scale`.
 */
export function lastingMs(items: ItemRegistry, base: string): number {
  const params = (items.get(base)?.params ?? {}) as Record<string, unknown>;
  const n = (k: string, d = 0) => (typeof params[k] === "number" ? (params[k] as number) : d);
  switch (params.shape) {
    case "trail": return n("trail_ms", 4000);
    case "enchant": return n("enchant_ms", 5000);
    case "orb": return (n("lifetime", 3) * 1000) / Math.max(1, Math.round(n("max_alive", 3)));
    default: return 0;
  }
}

/** The cooldown a cast of this slot starts, at `cost`: the cost's, the spell's own scale, and what it leaves behind. */
export function slotCooldownMs(slot: SpellSlot, items: ItemRegistry, cost: number): number {
  return Math.max(
    spellCooldownMs(cost / BASELINE_MANA_MAX) * cooldownScale(items, slot.item.base),
    lastingMs(items, slot.item.base),
  );
}

/**
 * The mana cost of a slot, or Infinity for an empty or unresolvable one.
 *
 * `staff` is still taken and no longer read: a cost is absolute now, and the
 * parameter stays so the call sites keep reading as "what this staff's slot
 * costs" rather than being rewritten across four packages for nothing.
 */
export function slotCost(slot: SpellSlot | null, items: ItemRegistry, _staff: Staff): number {
  if (!slot) return Infinity;
  const base = items.get(slot.item.base)?.mana ?? RANK_MAX;
  // What the attached affixes add: see `affixCostMult`.
  const affixes = (slot.affixes ?? []).reduce((m, a) => m * affixCostMult(a.id), 1);
  return Math.round(spellCost(slot.item, base) * levelManaMult(slot.level ?? 1) * affixes * 10) / 10;
}

export interface SpellStep {
  readonly shots: readonly FiredShot[];
  /** Set when a key was pressed and the cast did not happen, and why. */
  readonly refused: "cooldown" | "mana" | "empty" | "busy" | null;
  /** The key the refusal is about, when it is not the one held (a kept press). */
  readonly key?: number;
}

/**
 * How long a spell press is kept when it cannot cast yet (`Player.spellBuffer`).
 * The caster's own windup and recovery do not count against it. Long enough
 * to cover a tap that lands a beat early; short enough that a press never
 * fires so late it reads as the game acting on its own.
 */
export const SPELL_BUFFER_MS = 200;

/**
 * Binds an item to a key as a self-contained spell: its behaviour depends on
 * the item and the affixes attached to it, never on what sits on another key.
 */
export function makeSpell(item: ItemInstance): SpellSlot {
  return { item, affixes: [], cooldownMs: 0, level: 1 };
}

/**
 * Attaches an event affix. An affix is one fixed effect with no ladder to
 * climb (`SpellAffix.effect`), so one already on the key is not attached
 * again: the key is returned as it was. `replace` names an affix to take off
 * a full spell to make room — that one is simply lost, it is not worth gold.
 * Returns null when the affix is new and the slots are full.
 */
export function attachAffix(slot: SpellSlot, id: string, replace?: string): SpellSlot | null {
  if (slot.affixes.some((a) => a.id === id)) return slot;
  if (replace) {
    if (!slot.affixes.some((a) => a.id === replace)) return null;
    return { ...slot, affixes: slot.affixes.map((a) => (a.id === replace ? { id } : a)) };
  }
  if (slot.affixes.length >= AFFIX_SLOTS) return null;
  return { ...slot, affixes: [...slot.affixes, { id }] };
}

/**
 * Regenerates mana, advances the three cooldowns, and casts whichever key is
 * pressed. Returns what was fired, and why nothing was if a key was refused.
 *
 * The refusal is reported rather than silent because the player pressed a key:
 * doc 006 could skip an unaffordable unit quietly, since the staff was
 * cycling on its own and no one had asked for that particular shot.
 */
export function stepSpells(
  world: World,
  items: ItemRegistry,
  dtMs: number,
  pressed: number | null,
  /** The press is the auto-cast assist's: its cast does not slow the caster (`Input.spellAuto`). */
  auto = false,
): SpellStep {
  const p = world.player;
  const staff = world.staff;

  p.mana = Math.min(
    staff.mana_max,
    p.mana + staff.mana_max * MANA_REGEN_FRACTION_PER_S * p.mods.manaRegen * (dtMs / 1000),
  );
  for (const slot of world.spells) if (slot && slot.cooldownMs > 0) slot.cooldownMs -= dtMs;
  if (p.castRecoverMs > 0) p.castRecoverMs -= dtMs;
  refillBanks(world, items, dtMs);

  /*
   * **What the mana bar actually cost the player**, measured here because this
   * is the only place that knows both the bar and what a cast is worth.
   *
   * Doc 002's state is facts, not verdicts: `mana_sustain` used to be a
   * *prediction* from an offline cast loop firing on cooldown, which is not
   * how anyone plays — it read "tight" for nine builds in ten while real runs
   * refused no press at all. These two counters are what the player would say
   * if asked: how often the bar said no, and how much of the fight they spent
   * unable to afford anything.
   */
  {
    let cheapest = Infinity;
    for (const slot of world.spells)
      if (slot) cheapest = Math.min(cheapest, slotCost(slot, items, staff));
    if (Number.isFinite(cheapest) && p.mana < cheapest) world.stats.manaBelowKeyMs += dtMs;
  }

  /*
   * **The press, read first**, before anything that can swallow it.
   *
   * A spell key tapped while the last spell was still winding up or
   * recovering used to be lost: the windup returned before the key was
   * looked at, and the recovery refused it as `busy` — and a tap is up again
   * before either ends. So a fresh press is **kept** (`Player.spellBuffer`)
   * and goes the moment the caster is free.
   *
   * One slot, and **the newest press wins**. Three keys tapped through one
   * recovery cast the last of them, not all three in a row: a queue would
   * spend the bar on spells the player has already changed their mind about
   * and root them through casts they no longer want, where the last press is
   * the one that says what they want now.
   */
  const fresh = pressed !== null && pressed !== world.lastSpellKey;
  world.lastSpellKey = pressed;
  // The window waits out the caster's own cast, which the player cannot hurry;
  // it runs down against everything else.
  const casting = p.castPending >= 0 || p.castRecoverMs > 0 || p.chargeKey >= 0 || p.channelKey >= 0;
  if (!casting) p.spellBufferMs = Math.max(0, p.spellBufferMs - dtMs);
  if (p.spellBufferMs <= 0) p.spellBuffer = -1;
  const pressedSlot = pressed === null ? null : world.spells[pressed] ?? null;
  if (fresh && pressedSlot) {
    p.spellBuffer = pressed;
    p.spellBufferMs = SPELL_BUFFER_MS;
    /*
     * **Counted on the press, not on the cast** (doc 011).
     *
     * Every press of a key that holds a spell counts, and a press whose cost the
     * bar cannot meet counts as refused — whatever else would also have stopped
     * it. Counting only presses that were otherwise ready measured the wrong
     * thing twice over: the browser's player presses anyway and wants to know
     * why nothing came out, and the reference model *declines* to press what it
     * cannot afford, so the refusal rate came back 0 of 27,978 and said mana was
     * free when the bar was the reason the model stayed quiet.
     *
     * The bar rarely reaches zero, which is the other half of the report: it
     * sits in single figures and the cast is refused because what is left is
     * under the key's cost. So the test is against **the cost of the key
     * pressed**, never against zero.
     *
     * On the key going down only. The input carries a held key every step, so
     * counting each step counted sixty presses a second of holding — a room
     * read 290 presses and 27 refusals for 22 casts.
     */
    world.stats.castPresses++;
    if (p.mana < slotCost(pressedSlot, items, staff)) world.stats.castRefusedMana++;
  }

  // A windup running: the spell leaves when it ends, already paid for.
  if (p.castPending >= 0) {
    p.castWindupMs -= dtMs;
    if (p.castWindupMs > 0) return { shots: [], refused: null };
    const at = p.castPending;
    p.castPending = -1;
    const held = world.spells[at];
    if (!held) return { shots: [], refused: null };
    return release(world, items, held, at, p.castCost);
  }

  /*
   * **A beam being channelled** (`beam`): held for as long as its key is the
   * one held and its time lasts, and nothing else is cast meanwhile. The key
   * coming up, or another taking its place, puts it out.
   */
  if (p.channelKey >= 0) {
    const at = p.channelKey;
    const beam = world.beams.find((b) => b.alive && b.channel && b.spellIndex === at);
    if (!beam) p.channelKey = -1;
    else if (pressed === at) return { shots: [], refused: null };
    else endChannel(world);
  }

  // A charge put out by a dash or a stun: its key does nothing until it comes up.
  if (p.chargeVoid >= 0) {
    if (pressed === p.chargeVoid) return { shots: [], refused: null };
    p.chargeVoid = -1;
  }
  /*
   * **A `charge` spell being held** (doc 006). Holding is the charge: the
   * clock runs while its key is the one held, and the shot leaves the moment
   * it is not — the key coming up, or another key taking its place, which is
   * the same release. Nothing else is cast meanwhile: the charge is this
   * key's cast, and one spell at a time is the rule.
   */
  if (p.chargeKey >= 0) {
    const at = p.chargeKey;
    const held = world.spells[at];
    if (!held) { cancelCharge(p); return { shots: [], refused: null }; }
    if (pressed === at) {
      p.chargeMs = Math.min(chargeMsOf(items, held.item.base), p.chargeMs + dtMs);
      return { shots: [], refused: null };
    }
    return releaseCharge(world, items, held, at);
  }

  /*
   * The key to try: the kept press while it lasts, else the key held. A held
   * key casts again when it can (`pressedSpell` in the game), and a newer tap
   * of another key goes first rather than waiting behind it.
   */
  const buffered = p.spellBuffer >= 0 && p.stunMs <= 0 ? p.spellBuffer : null;
  const key = buffered ?? pressed;
  if (key === null) return { shots: [], refused: null };
  const slot = world.spells[key];
  if (!slot) { p.spellBuffer = -1; return { shots: [], refused: "empty", key }; }
  const cost = slotCost(slot, items, staff);
  /*
   * A refusal the kept press will outlive is not said: the cast is coming.
   * One it will not — a cooldown longer than the window, the bar short —
   * is said at once and the press let go, so the key held (if any) is
   * tried again and the player hears why.
   */
  const wait = (why: "busy" | "cooldown", leftMs: number): SpellStep => {
    if (key === buffered && (why === "busy" || leftMs <= p.spellBufferMs)) return { shots: [], refused: null };
    if (key === buffered) p.spellBuffer = -1;
    return { shots: [], refused: why, key };
  };

  // One spell at a time: nothing is cast while another recovers.
  if (p.castRecoverMs > 0) return wait("busy", p.castRecoverMs);
  if (slot.cooldownMs > 0) return wait("cooldown", slot.cooldownMs);
  /*
   * An empty bank is a cooldown in all but name: the key comes back when a
   * charge does, and the player is told so in the same words.
   */
  const banked = chargesOf(items, slot.item.base) > 0;
  if (banked && bankOf(slot, items) < 1)
    return wait("cooldown", chargeIntervalMs(items, slot.item.base) - (slot.bankMs ?? 0));
  // So is a recall with no blade out (`recall.ts`): it waits on the sword, not on a clock.
  if (lodgeMaxOf(items, slot.item.base) > 0 && lodgedOn(world, key) < 1) return wait("cooldown", Infinity);
  if (p.mana < cost) { if (key === buffered) p.spellBuffer = -1; return { shots: [], refused: "mana", key }; }
  // The cast goes: whatever was kept for it is spent.
  if (key === p.spellBuffer) p.spellBuffer = -1;
  // How the caster moves through it: at the spell's weight, or at full pace for the assist's press.
  const moveScale = (base: string) => (auto && key === pressed ? 1 : castTiming(items, base).moveScale);

  /*
   * **The key going down starts a charge, and costs nothing yet** (doc 006).
   * The bar is checked here so the player is not left holding a charge the
   * bar cannot pay for, and paid on release, so a charge put out by a dash
   * costs nothing. The caster moves at the spell's `move_scale` while it is
   * held (`stepPlayer`).
   */
  if (chargeMsOf(items, slot.item.base) > 0) {
    p.chargeKey = key;
    p.chargeMs = 0;
    p.castMoveScale = moveScale(slot.item.base);
    return { shots: [], refused: null };
  }

  p.mana -= cost;
  tallyCast(world, slot, cost);
  /*
   * A `charges` press looses the whole bank for one cast's cost, and the
   * bank, not a cooldown, is what says when the key is back: the charge rate
   * is the spell's ceiling on damage per second, so tapping each charge is
   * the fastest and dearest way to use it and banking the full five the
   * slowest and cheapest (doc 006).
   */
  if (banked) {
    const volley = bankOf(slot, items);
    slot.bank = 0;
    slot.bankMs = 0;
    p.castMoveScale = moveScale(slot.item.base);
    return release(world, items, slot, key, cost, { volley });
  }
  // Against the baseline pool, not this staff's: a cooldown that shortened
  // because the player found a deeper well would make the well twice a reward.
  slot.cooldownMs = slotCooldownMs(slot, items, cost);
  const timing = castTiming(items, slot.item.base);
  p.castMoveScale = moveScale(slot.item.base);
  if (timing.windupMs > 0) {
    p.castPending = key;
    p.castWindupMs = timing.windupMs;
    p.castCost = cost;
    return { shots: [], refused: null };
  }
  return release(world, items, slot, key, cost);
}

/**
 * A spell's **windup and recovery**, and how fast the caster moves through
 * them. Read from its params (`windup_ms`, `recover_ms`, `move_scale`), and
 * otherwise from its mass: a spark leaves at once and is shaken off in a
 * blink; a bolt takes a breath; a stone or a void orb is heaved — longer to
 * leave, longer to recover, the caster slowed to half or less — so the
 * weight of a spell is felt in the hand as well as on the target.
 */
export function castTiming(items: ItemRegistry, base: string): { windupMs: number; recoverMs: number; moveScale: number } {
  const params = (items.get(base)?.params ?? {}) as Record<string, unknown>;
  const weight = Number(params.weight ?? 1) || 1;
  const own = (k: string) => (Number.isFinite(Number(params[k])) && params[k] !== undefined ? Number(params[k]) : null);
  const windupMs = own("windup_ms") ?? (weight < 1 ? 0 : weight <= 1 ? 40 : Math.round(60 + 80 * (weight - 1)));
  const recoverMs = own("recover_ms") ?? Math.round(80 + 100 * weight);
  const moveScale = own("move_scale") ?? Math.max(0.35, Math.min(0.95, 1 - 0.25 * weight));
  return { windupMs, recoverMs, moveScale };
}

/**
 * The `charge` a spell has, in ms to a full charge, or 0 for a spell that is
 * cast on the press like every other (doc 006).
 */
export function chargeMsOf(items: ItemRegistry, base: string): number {
  const v = Number((items.get(base)?.params as Record<string, unknown> | undefined)?.charge);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * **Whether auto-cast may ever press this spell** (the game's assist).
 * Only one that casts on a tap: a `charge` spell is a hold and a `stance` a
 * guard, both the player's call; a `beam` is held on its key, and the
 * assist's press is a tap; and never a `dash` — Blink Strike, Leap Slam,
 * Dash Slash — which moves the body: the game throwing the player across
 * the room is the one thing an assist must not do. The card says so of the
 * rest (`stat.manualCast`), or a key the assist never presses reads as broken.
 */
export function castsItself(params: Readonly<Record<string, unknown>>): boolean {
  const charge = Number(params["charge"]);
  const shape = params["shape"];
  return !(Number.isFinite(charge) && charge > 0) && shape !== "stance" && shape !== "dash" && shape !== "beam";
}

/** The most charges a `charges` spell banks, or 0 for a spell without a bank. */
export function chargesOf(items: ItemRegistry, base: string): number {
  const v = Number((items.get(base)?.params as Record<string, unknown> | undefined)?.charges);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/** How long a `charges` spell takes to bank one charge, in ms. */
export function chargeIntervalMs(items: ItemRegistry, base: string): number {
  const v = Number((items.get(base)?.params as Record<string, unknown> | undefined)?.charge_ms);
  return Number.isFinite(v) && v > 0 ? v : 500;
}

/** The charges this slot holds now: its bank, or a full one where it has not been touched. */
export function bankOf(slot: SpellSlot, items: ItemRegistry): number {
  const max = chargesOf(items, slot.item.base);
  return max > 0 ? Math.min(max, slot.bank ?? max) : 0;
}

/**
 * Whether a press of this key would find the spell ready: off cooldown, and
 * holding a charge if it banks them. The mana is a separate question — the
 * bar and the key are two different reasons, and the player is told which.
 */
export function spellReady(slot: SpellSlot, items: ItemRegistry): boolean {
  if (slot.cooldownMs > 0) return false;
  return chargesOf(items, slot.item.base) === 0 || bankOf(slot, items) >= 1;
}

/**
 * **A bank fills on its own clock** (doc 006): one charge every `charge_ms`,
 * up to `charges`, whether or not the key is down. A held key therefore
 * behaves like every other held key — it casts the moment it can, which for a
 * bank is each charge as it arrives — and the choice stays the same one:
 * spend the charges as they come, or let them pile up and loose them at once.
 * It used to fill only while the key was up, so a held key banked nothing and
 * fired nothing, and read as a cooldown that had stopped.
 */
function refillBanks(world: World, items: ItemRegistry, dtMs: number): void {
  world.spells.forEach((slot) => {
    if (!slot) return;
    const max = chargesOf(items, slot.item.base);
    if (max === 0) return;
    let bank = bankOf(slot, items);
    if (bank >= max) { slot.bank = bank; slot.bankMs = 0; return; }
    const every = chargeIntervalMs(items, slot.item.base);
    let ms = (slot.bankMs ?? 0) + dtMs;
    while (ms >= every && bank < max) { bank++; ms -= every; }
    slot.bank = bank;
    slot.bankMs = bank >= max ? 0 : ms;
  });
}

/**
 * Puts a held charge out, **at no cost** (doc 006): a dash cancels it, and
 * so does anything that takes the hands away — a stun, a key emptied under
 * it. The cooldown does not start either, because nothing was cast.
 */
/** A press that cast, and what it paid, by spell id (`WorldStats.castsBy`, `manaBy`). */
export function tallyCast(world: World, slot: SpellSlot, mana: number): void {
  const id = slot.item.base;
  world.stats.castsBy[id] = (world.stats.castsBy[id] ?? 0) + 1;
  world.stats.manaBy[id] = (world.stats.manaBy[id] ?? 0) + mana;
}

/** Puts out the beam being channelled, if any: the key came up, a dash, a stun. */
export function endChannel(world: World): void {
  const p = world.player;
  if (p.channelKey < 0) return;
  for (const b of world.beams) if (b.alive && b.channel && b.spellIndex === p.channelKey) b.alive = false;
  p.channelKey = -1;
}

export function cancelCharge(p: World["player"]): void {
  // The key stays dead until it comes up: see `Player.chargeVoid`.
  if (p.chargeKey >= 0) p.chargeVoid = p.chargeKey;
  p.chargeKey = -1;
  p.chargeMs = 0;
}

/** How far through its charge the held key is, 0 to 1; 0 when nothing is held. */
export function chargeShare(world: World, items: ItemRegistry): number {
  const p = world.player;
  if (p.chargeKey < 0) return 0;
  const slot = world.spells[p.chargeKey];
  const full = slot ? chargeMsOf(items, slot.item.base) : 0;
  return full > 0 ? Math.min(1, p.chargeMs / full) : 0;
}

/**
 * **The key came up**: a held charge leaves, and is paid for now (doc 006).
 * The share is the time held over the full charge; the cost is the key's
 * whole cost however short the hold, which is the price of a tap. A bar
 * that dropped under the cost while the key was down — another key's mana
 * went, a refund was spent — refuses the release, and the charge goes out
 * unpaid rather than firing on credit.
 */
function releaseCharge(world: World, items: ItemRegistry, slot: SpellSlot, at: number): SpellStep {
  const p = world.player;
  const share = chargeShare(world, items);
  p.chargeKey = -1;
  p.chargeMs = 0;
  const cost = slotCost(slot, items, world.staff);
  if (p.mana < cost) return { shots: [], refused: "mana" };
  p.mana -= cost;
  tallyCast(world, slot, cost);
  slot.cooldownMs = slotCooldownMs(slot, items, cost);
  return release(world, items, slot, at, cost, { charge: share });
}

/** A paid-for spell leaving the hand, and its recovery starting. */
function release(
  world: World, items: ItemRegistry, slot: SpellSlot, pressed: number, cost: number,
  /** How far a `charge` spell was held, and how many shots a `charges` spell looses. */
  opts: { charge?: number; volley?: number } = {},
): SpellStep {
  const p = world.player;
  p.castRecoverMs = castTiming(items, slot.item.base).recoverMs;
  const shots: FiredShot[] = [];

  /*
   * The cast-time affixes go onto the scope the spell fires with, and the
   * spell's identity rides along so every projectile knows what it carries.
   * `fork`'s split count is a scope field the cast already reads; `repeat` is
   * owed as echoes below; `spread` fires the spell again in other directions;
   * `ward` leaves a rune.
   */
  const extra = castAdditions(slot.affixes);
  const scope = {
    ...shaped(emptyScope(), extra.mods),
    damageMult: levelDamageMult(slot.level ?? 1) * extra.mods.damageMult,
    split: extra.split,
    affixes: slot.affixes,
    spellIndex: pressed,
    manaSpent: cost,
    charge: opts.charge ?? 1,
    volley: opts.volley ?? 0,
  };
  fireSpread(world, slot, scope, items, shots, extra.spreadDirs);
  for (let i = 1; i <= extra.repeat; i++)
    /*
     * An echo is the cast that was made: a charge released at the share it
     * was held to. But **not the volley** of a `charges` press — the press
     * spent the bank, and an echo is the spell cast again on an empty one,
     * which is the spell's own single shot. Echoing the volley made the bank
     * a multiplier on `repeat`: measured, a finished Mana Darts with
     * `repeat` went past five times the sword, because a bar that could not
     * keep up let the bank fill and every echo fired all of it again.
     */
    world.echoes.push({ slot: pressed, delayMs: repeatGapMs(items, slot.item.base) * i, n: i, charge: opts.charge });
  onCast(world, slot, pressed, cost);
  return { shots, refused: null };
}

/**
 * The gap between a cast and its `repeat` echo, and between echoes, for a
 * spell that is over when it leaves the hand: a bolt.
 *
 * It was 110 ms for every spell, a quarter of a sword swing. Two bolts that
 * close read as one shot stuttering rather than the spell cast twice; at
 * 160 ms they are two beats.
 */
export const REPEAT_GAP_MS = 160;
/** A boomerang's: the second blade leaves once the first is clearly away. */
const REPEAT_GAP_BOOMERANG_MS = 250;

/**
 * **An echo waits for the cast it repeats to be done.**
 *
 * A spell that plays out over time — a line of spikes going off cell by
 * cell, geysers each on their own beat, a rock that lands after its mark —
 * was echoed 110 ms in, while the first was still going: the second line
 * chased the first down the same path, and a second meteor's mark came down
 * on top of the first before either had landed, so "casts again" read as one
 * muddled cast. The echo now starts as the last cell of the first goes off.
 */
export function repeatGapMs(items: ItemRegistry, base: string): number {
  const params = items.get(base)?.params ?? {};
  const shape = str(params, "shape", "bolt");
  if (shape === "boomerang") return REPEAT_GAP_BOOMERANG_MS;
  if (shape !== "eruption") return REPEAT_GAP_MS;
  const count = Math.max(1, num(params, "count", 1));
  const delay = num(params, "delay_ms", 70);
  // A scatter's cells go off at random inside `delay × count`; a line's and a ring's one `delay` apart.
  const span = str(params, "pattern", "line") === "scatter" ? delay * count : delay * (count - 1);
  return Math.max(REPEAT_GAP_MS, span + num(params, "telegraph_ms", 0));
}

/**
 * The scope a **free** cast fires with: an echo, a `resonance` answer to a
 * sword hit, a `retort` fired back at whatever hurt the player.
 *
 * It is the pressed cast's scope minus the mana and minus the echoes, and the
 * reason it is a function rather than three copies is what went wrong without
 * it. `resonance` and `retort` fired through an **empty** scope, so their
 * shots carried `spellIndex: -1`, no affixes, no element and no level. A
 * projectile with no slot behind it cannot be looked up, so the renderer fell
 * through to the element's generic dart and the impact sound to the element's
 * generic thud: the same spell, cast by an affix, came out as a pale cyan bolt
 * with none of its own colour or shape. The spell's identity is not a
 * decoration on the cast, it *is* the cast, so every path that fires a slot
 * builds it the same way.
 *
 * A free cast is one cast: an affix `repeat` owes echoes to the press that
 * paid for it, not to every hook that fires after.
 */
export function freeCastScope(
  slot: SpellSlot, spellIndex: number, damageMult = 1, procMult = 1,
): ReturnType<typeof emptyScope> {
  const extra = castAdditions(slot.affixes);
  return {
    ...shaped(emptyScope(), extra.mods),
    damageMult: levelDamageMult(slot.level ?? 1) * extra.mods.damageMult * damageMult,
    procMult,
    split: extra.split,
    affixes: slot.affixes,
    spellIndex,
    manaSpent: 0,
  };
}

/** The spell fired on the aim, and in the scatter directions if any. */
function fireSpread(
  world: World, slot: SpellSlot, scope: ReturnType<typeof emptyScope>,
  items: ItemRegistry, shots: FiredShot[], spreadDirs: number,
): void {
  const p = world.player;
  /*
   * `lodestar`: the cast is aimed at the nearest body in reach rather than
   * where the caster aims — the aim itself, for this one cast, so the spell
   * places its ground, its pull or its wall there as a press aimed at it would.
   */
  const lode = lodestarTarget(world, slot);
  const aimed = { x: p.aim.x, y: p.aim.y };
  if (lode) { p.aim.x = lode.x; p.aim.y = lode.y; }
  fireUnit(world, slot.item, scope, items, shots);
  if (lode) { p.aim.x = aimed.x; p.aim.y = aimed.y; }
  if (spreadDirs > 0) {
    const ax = p.aim.x - p.x;
    const ay = p.aim.y - p.y;
    // The other directions land at half: `scatter` is cover, not a second main cast.
    const side = { ...scope, damageMult: scope.damageMult * SPREAD_DAMAGE };
    /*
     * Each side cast is aimed at a point the spell's own reach out along its
     * direction (`freeCastReach`): a shot only needs the direction, but a
     * field, a pull or a burst of ground has to land somewhere, and where a
     * press would have put it, turned, is where it goes.
     */
    const base = items.get(slot.item.base);
    const reach = base ? freeCastReach(base) : 64;
    for (const d of spreadDirections(ax, ay, spreadDirs))
      fireUnit(world, slot.item, side, items, shots, p, { x: p.x + d.x * reach, y: p.y + d.y * reach });
  }
}

/**
 * What a `repeat` echo deals, of the main cast: four fifths for the first,
 * and four fifths of the one before for each after it (0.8, 0.64, 0.51).
 *
 * It fell flat at 0.8 once, and with the mana surcharge charged the same 15%
 * a tier as fork and chain, `repeat` became the strongest affix in the pool
 * (×2.27 of the bare bolt, where fork sat at ×1.00): a third copy was worth
 * as much as the first. The user kept the cost — "if it costs as much as a
 * recast the affix is worthless" — and had the copies weaken instead.
 */
export function echoDamage(n: number): number {
  return ECHO_DAMAGE ** Math.max(1, n);
}
const ECHO_DAMAGE = 0.8;
/**
 * What an echo is worth to an on-hit effect, of the main cast's proc weight.
 * Half: every copy carried the spell's affixes whole, so `kindle` + `repeat`
 * filled the burn gauge four times a press and was the top build in the
 * ladder. An echo still burns; it no longer lights as fast as a press does.
 */
export const ECHO_PROC = 0.5;
/** What a `scatter` side cast deals, of the main cast. */
const SPREAD_DAMAGE = 0.5;

/** A scope with the `shape` affixes' projectile changes applied. */
function shaped(scope: ReturnType<typeof emptyScope>, mods: ReturnType<typeof castAdditions>["mods"]): ReturnType<typeof emptyScope> {
  const elements = noPowers();
  addPowers(elements, scope.elements);
  addPowers(elements, mods.elements);
  return {
    ...scope,
    pierceAdd: scope.pierceAdd + mods.pierceAdd,
    homing: scope.homing + mods.homing,
    bounce: scope.bounce + mods.bounce,
    radiusMult: scope.radiusMult * mods.radiusMult,
    speedMult: scope.speedMult * mods.speedMult,
    // The affixes' elements add to whatever the scope already carried.
    ...(elements ? { elements, element: dominantElement(elements), elementPower: elements[dominantElement(elements) as "fire"] ?? 0 } : {}),
  };
}

/**
 * Fires the echoes that have come due.
 *
 * Free: no mana, no cooldown, and `manaSpent` is zero so an `echo` refund
 * pays out once per press rather than once per copy. The echo is aimed
 * where the player is aiming *now*, which is what lets a repeat follow a
 * body that stepped aside after the first copy.
 */
export function stepEchoes(world: World, items: ItemRegistry, dtMs: number): FiredShot[] {
  const shots: FiredShot[] = [];
  if (world.echoes.length === 0) return shots;
  const due: typeof world.echoes = [];
  const keep: typeof world.echoes = [];
  for (const e of world.echoes) {
    e.delayMs -= dtMs;
    (e.delayMs <= 0 ? due : keep).push(e);
  }
  world.echoes = keep;
  for (const e of due) {
    const slot = world.spells[e.slot];
    if (!slot || world.player.hearts <= 0) continue;
    // Each echo lands weaker than the last, and fills gauges at half: `repeat`
    // is more casts, not more copies of the first (`echoDamage`, `ECHO_PROC`).
    const scope = { ...freeCastScope(slot, e.slot, echoDamage(e.n ?? 1), ECHO_PROC), charge: e.charge ?? 1, volley: e.volley ?? 0 };
    fireSpread(world, slot, scope, items, shots, castAdditions(slot.affixes).spreadDirs);
  }
  return shots;
}
