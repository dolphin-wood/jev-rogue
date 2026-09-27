/**
 * **Experience and levels**: the base stats the run grows on its own.
 *
 * ### Why the run needed this
 *
 * Every number on the player's body — health, sword damage, the mana bar —
 * came from one place, the `stat` door, and a measured `player` run takes
 * **1.8 stat cards** against 10.7 spell levels and 6 affixes. One of the
 * thirteen stats is health. So over sixteen rooms the body the player fights
 * with is very nearly the body they started with, while the ramp takes a
 * body's health to ×1.78 and its damage to ×1.3 (`encounters/ramp.ts`). Only
 * one side of that was growing, and the side that was not is the one the
 * player *is*.
 *
 * Kills pay experience and levels arrive on their own. No choice screen: the
 * `stat` door is where the player chooses what their body becomes, and a
 * second, more frequent version of that choice would drown it. A level is the
 * floor under the build rather than part of it.
 *
 * ### What a body is worth is derived, not typed in
 *
 * A per-archetype table of hand-picked numbers goes stale the moment a body's
 * health moves, and there are twenty-nine bodies. So the value is read off
 * the roster's own definition:
 *
 *     xp = round(base hp × kit × variant) / XP_PER_HP
 *
 * - **Base health, before the ramp and before `ENEMY_HP_SCALE`.** A late room
 *   already holds more bodies and bigger ones; experience that also rode the
 *   ramp would make the last levels the fastest, which is the opposite of the
 *   curve below. The ramp is the fight's difficulty, and the XP table is the
 *   only brake on the pace of levelling.
 * - **A kit factor**, because health is what a body costs to kill and not what
 *   it costs to fight. A body that threatens from across the room, or lays
 *   ground the player has to walk around, asks a question a chaser does not;
 *   a body that keeps *making* bodies asks the largest one in the roster.
 * - **A variant factor**, because a subspecies is its base with one verb
 *   changed (doc 019) — a different question, not a bigger one, so a little
 *   more and no more.
 *
 * On top of that sit the two multipliers that are about the encounter rather
 * than the body: an **elite** is worth two and a half, because an elite is the
 * risk the room was built around; and a body **another body put on the floor**
 * is worth nothing, because a summoner is an infinite tap and a run that can
 * farm one is a run with no curve at all.
 */

import { ENEMIES, type EnemyDef } from "../encounters/enemies.ts";
import type { EnemyId } from "../types.ts";
import { HP_PER_HEART, type PlayerMods } from "../sim/types.ts";
import { SWING_DAMAGE } from "../sim/melee.ts";

/* ------------------------------ what a kill pays --------------------------- */

/**
 * Health per point of experience.
 *
 * Sets the *scale* of every number here and nothing else: the roster spans 16
 * to 52 base health, and at four health a point that is a body worth 4 to 18,
 * which is a figure a player can hold in their head and a bar that visibly
 * moves on a single kill.
 */
export const XP_PER_HP = 4;

/**
 * What a body's kit is worth on top of its health.
 *
 * Read off `EnemyDef`, so a body that gains a pattern gains the factor with
 * it. Deliberately coarse — three cases, widely spaced — because this is a
 * correction to a health figure and not a second threat model; `threat_weight`
 * is the game's threat model and it is calibrated against hearts lost, which
 * is a different question from what a kill should pay.
 */
export const KIT_SUMMONER = 1.4;
export const KIT_RANGED = 1.2;
export const KIT_MELEE = 1;
/** A subspecies is its base with one verb changed: a little more, and no more. */
export const XP_VARIANT = 1.15;
/** An elite is the risk the room was built around. */
export const XP_ELITE = 2.5;

function kitFactor(def: EnemyDef): number {
  if (def.summon) return KIT_SUMMONER;
  // A pattern or a ranged attack both mean the body reaches the player from
  // where it stands; the sower's mines and the cinderling's lobs are ranged
  // attacks in the roster's own terms, so "area" needs no third case.
  return def.pattern || def.ranged ? KIT_RANGED : KIT_MELEE;
}

/** What a body is worth before the encounter's own multipliers. */
export function baseXp(id: EnemyId): number {
  const def = ENEMIES[id];
  const variant = def.base ? XP_VARIANT : 1;
  return Math.round((def.hp * kitFactor(def) * variant) / XP_PER_HP);
}

export interface KillXpContext {
  /** The body carried affixes: an elite (`Enemy.affixes`). */
  readonly elite?: boolean;
  /**
   * Another body put it on the floor — a summoner's minion, a brooder's
   * hatchling. Worth nothing, so a summoner cannot be farmed for levels.
   */
  readonly summoned?: boolean;
}

/**
 * What killing this body pays.
 *
 * **The boss pays nothing**, and neither do props. The run ends with the boss,
 * so a level earned on it is a level earned after the last thing it could
 * change; paying for it would be a number going up on the results screen.
 */
export function xpForKill(id: EnemyId, ctx: KillXpContext = {}): number {
  if (id === "boss" || ctx.summoned) return 0;
  return Math.round(baseXp(id) * (ctx.elite ? XP_ELITE : 1));
}

/**
 * **What driving the king off in room 5 pays** (doc 022). Nothing else in that
 * room does: the bodies are crushed by the roof, not killed by the player, and
 * he is not killed at all but leaves. A room the player fought hardest in that
 * paid no experience would be the one room of the run with no level in it, so
 * his leaving pays **an ordinary room's whole take at its top**, the 110 that
 * a fight of 10 to 14 bodies is worth (`XP_TO_NEXT`) — at room 5 about a level.
 */
export const KING_AUDIENCE_XP = 110;

/* --------------------------------- the curve ------------------------------- */

/**
 * Experience from one level to the next, the first entry being level 1 → 2.
 *
 * **Written against the measured kill counts, not picked.** The fitted
 * `player` profile kills 10 to 14 bodies a room over the fourteen fights, and
 * a room is worth 70 to 110 experience at the values above — so the first
 * entry is inside one room's takings and the run totals a little over a
 * thousand. That puts the first level-up in room 1 or 2, which is the point of
 * the shape: the earliest rooms are where a run is most fragile and where a
 * player has least reason to believe the run is going anywhere.
 *
 * It climbs faster than the takings do, which is the brake. Rooms get bigger
 * and hold heavier bodies, so a flat table would hand out the last levels
 * fastest; the gaps roughly double over the first four and then widen by a
 * fixed step, which lands a full run at **six to seven levels** and makes the
 * seventh something a player has to have cleared well to reach.
 */
export const XP_TO_NEXT: readonly number[] = [45, 85, 130, 180, 235, 295, 360, 430, 505];

/** Past the table, the last gap widens by this much per level; nothing is capped. */
export const XP_STEP_BEYOND = 85;

/** Experience needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  const at = XP_TO_NEXT[level - 1];
  if (at !== undefined) return at;
  const last = XP_TO_NEXT[XP_TO_NEXT.length - 1]!;
  return last + XP_STEP_BEYOND * (level - XP_TO_NEXT.length);
}

export interface LevelProgress {
  /** 1 at the start of a run. */
  readonly level: number;
  /** Experience banked toward the next level, and what it takes. */
  readonly into: number;
  readonly toNext: number;
  /** Total experience earned this run, as handed in. */
  readonly xp: number;
}

/** The level a run's total experience has reached, and how far into the next. */
export function levelAt(xp: number): LevelProgress {
  let level = 1;
  let left = Math.max(0, xp);
  for (;;) {
    const need = xpToNext(level);
    if (left < need) return { level, into: left, toNext: need, xp: Math.max(0, xp) };
    left -= need;
    level++;
  }
}

/* ------------------------------ what a level gives ------------------------- */

/**
 * What one level adds.
 *
 * **Five health, one point of sword damage, three percent of the bar.**
 *
 * ### Every level has to move a number the player can see
 *
 * The first version of this was a percentage on all three, and the sword's 5%
 * was reported back as a bug: "at level 4 the sword still hits 9". It was not
 * wrong, it was invisible. A swing is `SWING_DAMAGE` 9 and the damage numbers
 * over a body are whole, so 5% compounding reads 9, 9, 10, 10, 11 — three
 * levels in which the player is told, in the one place they are looking, that
 * nothing happened. A reward the player cannot see did not happen.
 *
 * So the sword's gain is **a whole point a level**, and the level-up banner
 * names the new figure rather than a percentage. Health is five, which is the
 * bar's own unit and half a heart. The bar is the one percentage left, and it
 * survives the same test by arithmetic rather than by design: a run staff is
 * 90 mana and 3% of it rounds to 93, 96, 98, 101, 104, 107 — every level moves
 * the number on the gauge.
 *
 * ### The size of it
 *
 * Six levels is the sword at **15 against 9**, the bar at 90 health against
 * 60, and the mana gauge at 107 against 90, met against a ramp that takes a
 * body to ×2.2 health and ×1.65 damage over the same run. The whole point is
 * measured rather than argued: see doc 003.
 *
 * `vigour` is **still the best health in the game** — a whole heart, twice a
 * level, taken by choice at a door the player walked through for it. A level
 * is the floor; a card is a decision, and a card the player could have had by
 * waiting is not one. `keen_edge` is 15% of the sword, which passes a level's
 * point as soon as the flat gains have grown the base it multiplies.
 */
export const LEVEL_HEARTS = 0.5;
/** Whole points of sword damage a level adds, on top of `SWING_DAMAGE`. */
export const LEVEL_SWORD_DAMAGE = 1;
export const LEVEL_MANA = 0.03;

/** The health a level adds, in the units the bar is drawn in. */
export const LEVEL_HP = LEVEL_HEARTS * HP_PER_HEART;

/**
 * What a swing hits for at `level`, as the damage numbers show it.
 *
 * The one place the figure is computed, because three things quote it — the
 * level-up banner, the character screen and the briefing — and a banner that
 * promised a number the sword did not deliver would be worse than no banner.
 */
export function swordAt(level: number): number {
  return SWING_DAMAGE + LEVEL_SWORD_DAMAGE * Math.max(0, level - 1);
}

/**
 * The run's modifiers with the level's contribution folded in.
 *
 * Pure, and applied to the **stat-card modifiers** rather than accumulated on
 * top of themselves: the run owns one `PlayerMods` holding what the cards did,
 * and the level's share is recomputed from the level every time a world is
 * built. Accumulating instead would double every level the moment a room was
 * rebuilt, which is the shape of bug that reads as "my damage kept climbing
 * between rooms".
 */
export function withLevels(mods: PlayerMods, level: number): PlayerMods {
  const gained = Math.max(0, level - 1);
  if (gained === 0) return mods;
  return {
    ...mods,
    maxHearts: mods.maxHearts + LEVEL_HEARTS * gained,
    /*
     * A flat gain, carried as a multiple. `PlayerMods.swordDamage` is what
     * `melee.ts` multiplies `SWING_DAMAGE` by, and it is where the stat cards'
     * percentages live; expressing the level's whole point as the multiple
     * that produces it keeps one field, one multiplication at the swing, and
     * the cards stacking on top exactly as they did.
     */
    swordDamage: mods.swordDamage * (swordAt(level) / SWING_DAMAGE),
    manaMax: mods.manaMax * Math.pow(1 + LEVEL_MANA, gained),
  };
}

/** What the level alone is worth, for the character screen's own column. */
export function levelBonus(level: number): {
  readonly hp: number;
  /** Whole points of sword damage, which is what the damage numbers show. */
  readonly swordPoints: number;
  readonly mana: number;
} {
  const gained = Math.max(0, level - 1);
  return {
    hp: LEVEL_HP * gained,
    swordPoints: LEVEL_SWORD_DAMAGE * gained,
    mana: Math.pow(1 + LEVEL_MANA, gained) - 1,
  };
}
