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
 * What is kept from doc 006 is the effect. A spell's projectiles, payload and
 * elements are still an `ItemInstance` fired through `fireUnit`, so "a summon
 * is a spell and a thrown bolt is a spell" costs nothing to be true: the
 * delivery is what the item already describes, and this module only owns when
 * it happens and what it costs.
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
import type { BaseItem, CastUnit, ItemInstance, Staff } from "../types.ts";
import type { ItemRegistry } from "../spells/items.ts";
import { parseCastTree } from "../spells/parse.ts";
import { REFERENCE_STAFF } from "../spells/staff.ts";
import { fireUnit } from "./cast.ts";
import { emptyScope } from "../spells/execute.ts";
import { castAdditions, onCast, spreadDirections } from "./affix-hooks.ts";
import { affixCostMult } from "../spells/affixes.ts";
import type { AttachedAffix } from "./affix-hooks.ts";
import type { FiredShot } from "./cast.ts";
import type { World } from "./types.ts";

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
 * **The one staff every run plays.** Doc 013 retired the staff as a thing the
 * player has — there is a sword and there are three keyed spells — so the
 * record that carries the mana pool and the slot count is fixed rather than
 * chosen. It used to be the Director's first question of a run, answered
 * uniformly on the rule arm over 24 profiles, which silently set the mana pool
 * anywhere from 60 to 120 and the slot count to 4 or 6 against three keys.
 */
// 90, measured: 70 left half the runs dead at the boss, 120 was no better
// than 90, and 90 matches the survival the random profiles averaged out to.
export const RUN_MANA_MAX = 90;
export function runStaff(): Staff {
  return { ...REFERENCE_STAFF, slots: SPELL_SLOTS, mana_max: RUN_MANA_MAX };
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
export const SPELL_COST_BASE = 5;
export const SPELL_COST_PER_RANK = 2.5;
/** The pool the cooldown scale is written against; see `spellCooldownMs`. */
export const BASELINE_MANA_MAX = 60;

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
 * One of the three keyed spells: **an attack, plus what is attached to it.**
 *
 * The `mods` are doc 013's three affix slots. They were missing entirely and
 * their absence made twenty items inert: `makeSpell` parsed a *single* item, so
 * a boost or a passive in a staff slot became its own "spell" that did nothing
 * when pressed, and could not reach the attack in the next slot either. Doc
 * 006's boost scoping — "boosts affect items to their right" — only works
 * across a sequence, and doc 013 replaced the sequence with three keys.
 *
 * Parsing `[...mods, attack]` as one little staff restores it. The scope rules
 * are unchanged and now apply where the design says they should: **inside one
 * spell**, to the attack the player attached them to.
 */
export interface SpellSlot {
  /** The attack this key fires. */
  readonly item: ItemInstance;
  /** Up to `AFFIX_SLOTS` modifiers attached to it, in application order. */
  readonly mods: readonly ItemInstance[];
  /**
   * Doc 013's event affixes on this spell, each at a tier. Distinct from
   * `mods`, which are numbers: see `spells/affixes.ts` for why the two pools
   * are kept apart by type rather than by discipline.
   */
  readonly affixes: readonly AttachedAffix[];
  /** The parsed unit that produces the effect; null while unresolvable. */
  readonly unit: CastUnit | null;
  cooldownMs: number;
  /**
   * The spell's **level**, 1 to `SPELL_LEVEL_MAX` (doc 013: "spells have a
   * level, affixes have a tier"). Raised by the blacksmith for gold, or given
   * by an elite room's spell card; it scales damage only.
   */
  readonly level: number;
}

export const SPELL_LEVEL_MAX = 3;

/** What a level does to damage: +40% a level. It never changes the spell's shape. */
export function levelDamageMult(level: number): number {
  return 1 + 0.4 * (Math.max(1, Math.min(SPELL_LEVEL_MAX, level)) - 1);
}

/**
 * **A level costs mana too**, at half the rate it adds damage: +20% a level,
 * so a level-3 spell hits 1.8x as hard for 1.4x the mana. More power has to
 * be paid for or a level is free, and paying less than it gives is what keeps
 * a level worth taking.
 */
export function levelManaMult(level: number): number {
  return 1 + 0.2 * (Math.max(1, Math.min(SPELL_LEVEL_MAX, level)) - 1);
}

/** The slot at `level`. */
export function withLevel(slot: SpellSlot, level: number): SpellSlot {
  return { ...slot, level: Math.max(1, Math.min(SPELL_LEVEL_MAX, level)) };
}

/**
 * Gold for taking a spell apart: its level, and every affix tier invested in
 * it, at a lossy rate (doc 013, "Replacing a spell dismantles it into gold").
 */
export function dismantleValue(level: number, affixTiers: readonly number[] = []): number {
  return 12 + 14 * (Math.max(1, level) - 1) + 6 * affixTiers.reduce((a, b) => a + b, 0);
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

/** How long this spell is unavailable after a cast. */
export function spellCooldownMs(costFraction: number): number {
  return COOLDOWN_FLOOR_MS + costFraction * COOLDOWN_PER_FRACTION_MS;
}

/**
 * The mana cost of a slot, or Infinity for an empty or unresolvable one.
 *
 * `staff` is still taken and no longer read: a cost is absolute now, and the
 * parameter stays so the call sites keep reading as "what this staff's slot
 * costs" rather than being rewritten across four packages for nothing.
 */
export function slotCost(slot: SpellSlot | null, items: ItemRegistry, _staff: Staff): number {
  if (!slot || !slot.unit) return Infinity;
  const base = items.get(slot.item.base)?.mana ?? RANK_MAX;
  // What the attached affixes add: see `affixCostMult`.
  const affixes = (slot.affixes ?? []).reduce((m, a) => m * affixCostMult(a.id, a.tier), 1);
  return Math.round(spellCost(slot.item, base) * levelManaMult(slot.level ?? 1) * affixes * 10) / 10;
}

export interface SpellStep {
  readonly shots: readonly FiredShot[];
  /** Set when a key was pressed and the cast did not happen, and why. */
  readonly refused: "cooldown" | "mana" | "empty" | null;
}

/**
 * Binds an item to a key as a self-contained spell.
 *
 * Parsed **alone**, which is the whole of doc 013's "self-contained": the unit
 * a spell fires is built from its own item and nothing else, so a spell's
 * behaviour does not depend on what sits next to it in a list. Doc 006's tree
 * was the opposite by design — a boost modified whatever followed it, and the
 * order of the slots was the build. That is a fine wand-building game and a
 * bad fit for three keys, because the player cannot press a relationship.
 */
/**
 * Whether an item can be a keyed spell **on its own**.
 *
 * Doc 013 binds three spells to three keys, each slot holding one item. Doc
 * 006's model was a staff *sequence*, where a container wrapped the items that
 * followed it — and the three multicast items were authored for that model and
 * never revisited. Parsed alone a multicast yields a unit with no children, so
 * `fireUnit` iterates an empty list and returns: the key does nothing, spends
 * no mana, and reports no refusal. A player given one has a dead key.
 *
 * That made it worse than useless, because the reward pool offered them as
 * spell cards: taking one was a trap that also cost the player the two real
 * options on that screen.
 *
 * The rule is therefore a property of the *pool*, checked here rather than at
 * the offer, because the offer is not the only thing that hands out items — a
 * shop and a starting staff will too.
 */
export function castableAlone(base: BaseItem): boolean {
  return base.kind === "attack" || base.kind === "payload";
}

export function makeSpell(
  item: ItemInstance, items: ItemRegistry, mods: readonly ItemInstance[] = [],
): SpellSlot {
  /*
   * The mods go **first**, because doc 006's boosts apply to what follows them.
   * Parsed as `[...mods, attack]` the whole thing is a one-attack staff, which
   * is exactly the structure the scope rules were written for.
   */
  const tree = parseCastTree([...mods, item], items);
  // The attack is the last unit: a boost is not a unit and a passive is lifted
  // out of the sequence, so whatever units survive, the attack is the one that
  // fires.
  const unit = tree.units[tree.units.length - 1] ?? null;
  return { item, mods, affixes: [], unit, cooldownMs: 0, level: 1 };
}

/**
 * Attaches a modifier to a spell, or reports that the slots are full.
 *
 * Returns a new slot rather than mutating, because the parsed unit has to be
 * rebuilt and a half-updated slot — new mods, old unit — is a spell that says
 * one thing and does another.
 */
export function attachMod(
  slot: SpellSlot, mod: ItemInstance, items: ItemRegistry,
): SpellSlot | null {
  if (slot.mods.length >= AFFIX_SLOTS) return null;
  const next = makeSpell(slot.item, items, [...slot.mods, mod]);
  // The cooldown carries over: attaching something must not be a free recharge.
  next.cooldownMs = slot.cooldownMs;
  return { ...next, affixes: slot.affixes };
}

/**
 * Attaches an event affix, or raises the tier of one already held.
 *
 * Doc 013: a duplicate **upgrades** rather than taking a second slot, and the
 * ladder has three rungs. Returns null only when the affix is new and the
 * three slots are full — a duplicate always fits, because it takes no slot.
 */
/**
 * Attaches an affix at `tier` (a drop's rarity is its head start on the
 * ladder). A duplicate raises the held one by the incoming tier; `replace`
 * names an affix to take off a full spell to make room — that one is simply
 * lost, it is not worth gold.
 */
export function attachAffix(slot: SpellSlot, id: string, tier = 1, replace?: string): SpellSlot | null {
  const held = slot.affixes.find((a) => a.id === id);
  if (held) {
    const next = Math.min(3, held.tier + tier) as 1 | 2 | 3;
    return { ...slot, affixes: slot.affixes.map((a) => (a.id === id ? { id, tier: next } : a)) };
  }
  const start = Math.max(1, Math.min(3, tier)) as 1 | 2 | 3;
  if (replace) {
    if (!slot.affixes.some((a) => a.id === replace)) return null;
    return { ...slot, affixes: slot.affixes.map((a) => (a.id === replace ? { id, tier: start } : a)) };
  }
  if (slot.affixes.length >= AFFIX_SLOTS) return null;
  return { ...slot, affixes: [...slot.affixes, { id, tier: start }] };
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
): SpellStep {
  const p = world.player;
  const staff = world.staff;

  p.mana = Math.min(
    staff.mana_max,
    p.mana + staff.mana_max * MANA_REGEN_FRACTION_PER_S * p.mods.manaRegen * (dtMs / 1000),
  );
  for (const slot of world.spells) if (slot && slot.cooldownMs > 0) slot.cooldownMs -= dtMs;

  if (pressed === null) return { shots: [], refused: null };
  const slot = world.spells[pressed];
  if (!slot || !slot.unit) return { shots: [], refused: "empty" };
  if (slot.cooldownMs > 0) return { shots: [], refused: "cooldown" };

  const cost = slotCost(slot, items, staff);
  if (p.mana < cost) return { shots: [], refused: "mana" };

  p.mana -= cost;
  // Against the baseline pool, not this staff's: a cooldown that shortened
  // because the player found a deeper well would make the well twice a reward.
  slot.cooldownMs = spellCooldownMs(cost / BASELINE_MANA_MAX);
  const shots: FiredShot[] = [];

  /*
   * The cast-time affixes go onto the scope the spell fires with, and the
   * spell's identity rides along so every projectile knows what it carries.
   * `repeat` and `fork`'s split count are scope fields the cast already reads;
   * `spread` fires the unit again in other directions; `ward` leaves a rune.
   */
  const extra = castAdditions(slot.affixes);
  const scope = {
    ...shaped(emptyScope(), extra.mods),
    damageMult: levelDamageMult(slot.level ?? 1) * extra.mods.damageMult,
    // The affix's repeat is not put on the scope: it is owed as echoes below.
    // A repeat *inside* the item (a doc-006 multicast boost) still recurses.
    repeat: 0,
    split: extra.split,
    affixes: slot.affixes,
    spellIndex: pressed,
    manaSpent: cost,
  };
  fireSpread(world, slot, scope, items, shots, extra.spreadDirs);
  for (let i = 1; i <= extra.repeat; i++)
    world.echoes.push({ slot: pressed, delayMs: REPEAT_GAP_MS * i });
  onCast(world, slot);
  return { shots, refused: null };
}

/**
 * The gap between a cast and its `repeat` echo, and between echoes.
 *
 * Long enough to be two events to the eye and to land on a body that has
 * moved; short enough that the echo is still the same press. Sword swings
 * are about 400 ms apart, so this is a quarter of a swing.
 */
export const REPEAT_GAP_MS = 110;

/** The unit fired on the aim, and in the scatter directions if any. */
function fireSpread(
  world: World, slot: SpellSlot, scope: ReturnType<typeof emptyScope>,
  items: ItemRegistry, shots: FiredShot[], spreadDirs: number,
): void {
  if (!slot.unit) return;
  const p = world.player;
  fireUnit(world, slot.unit, scope, items, shots);
  if (spreadDirs > 0) {
    const ax = p.aim.x - p.x;
    const ay = p.aim.y - p.y;
    // The other directions land at half: `scatter` is cover, not a second main cast.
    const side = { ...scope, damageMult: scope.damageMult * SPREAD_DAMAGE };
    for (const d of spreadDirections(ax, ay, spreadDirs))
      fireUnit(world, slot.unit, side, items, shots, p, { x: p.x + d.x * 64, y: p.y + d.y * 64 });
  }
}

/** What a `repeat` echo and a `scatter` side cast deal, of the main cast. */
const ECHO_DAMAGE = 0.8;
const SPREAD_DAMAGE = 0.5;

/** A scope with the `shape` affixes' projectile changes applied. */
function shaped(scope: ReturnType<typeof emptyScope>, mods: ReturnType<typeof castAdditions>["mods"]): ReturnType<typeof emptyScope> {
  return {
    ...scope,
    pierceAdd: scope.pierceAdd + mods.pierceAdd,
    homing: scope.homing + mods.homing,
    bounce: scope.bounce + mods.bounce,
    radiusMult: scope.radiusMult * mods.radiusMult,
    speedMult: scope.speedMult * mods.speedMult,
    ...(mods.element ? { element: mods.element, elementPower: mods.elementPower } : {}),
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
    if (!slot || !slot.unit || world.player.hearts <= 0) continue;
    const extra = castAdditions(slot.affixes);
    const scope = {
      ...shaped(emptyScope(), extra.mods),
      // An echo lands at four fifths: `repeat` is more casts, not more copies of the first.
      damageMult: levelDamageMult(slot.level ?? 1) * extra.mods.damageMult * ECHO_DAMAGE,
      repeat: 0,
      split: extra.split,
      affixes: slot.affixes,
      spellIndex: e.slot,
      manaSpent: 0,
    };
    fireSpread(world, slot, scope, items, shots, extra.spreadDirs);
  }
  return shots;
}
