/**
 * The intrinsic stat pool: what the `stat` door offers.
 *
 * Doc 013 asks a question and declines to answer it — "whether intrinsic stats
 * touch spells at all... Not decided here" — and notes the failure mode: a
 * pool that only improves the sword leaves a spell-heavy build finding it
 * weak, which re-creates the dead-pool problem in a new place.
 *
 * Making `stat` a **door the player chooses** answers it. A player who walks
 * through that door must get something they can use whatever they are
 * building, or the door is a trap for half the builds in the game. So the pool
 * is majority **build-agnostic** — movement, survival and the mana economy,
 * which every build spends — with a minority of sword-specific entries that
 * are the reason the category is called "intrinsic" rather than "generic".
 *
 * ### These are numbers, and that is correct here
 *
 * Doc 013's anti-collapse rule says an affix adds an event and a number comes
 * from somewhere else. **This is the somewhere else.** Keeping the two apart is
 * the whole structure: affixes cannot express a number by construction
 * (`spells/affixes.ts`), and stats are nothing but numbers. A pool that tried
 * to be both would collapse into the stat screen the rule exists to prevent.
 *
 * Each entry is a percentage of the player's *current* value rather than a
 * flat amount, for the reason doc 013 gives about mana: a flat figure goes
 * proportionally worthless as the stat it adds to grows, so the last one the
 * player finds is the one that matters least.
 */

import type { PlayerMods } from "../sim/types.ts";
import { HP_PER_HEART } from "../sim/types.ts";

/** What a stat upgrade touches. Used for the icon and for the card's colour. */
export type StatFamily = "movement" | "survival" | "mana" | "sword";

export interface StatUpgrade {
  readonly id: string;
  readonly name: string;
  readonly family: StatFamily;
  /** Fractional change applied to the player's current value. */
  readonly magnitude: number;
  readonly description: string;
}

export const STAT_UPGRADES: readonly StatUpgrade[] = [
  {
    id: "fleet",
    name: "Fleet",
    family: "movement",
    magnitude: 0.08,
    description:
      "Move faster. The only stat that improves every part of the game at once, "
      + "which is why its step is the smallest in the pool.",
  },
  {
    id: "second_wind",
    name: "Second Wind",
    family: "movement",
    magnitude: -0.12,
    description:
      "The dash comes back sooner. Worth most to a player who is already using "
      + "it to attack rather than to escape.",
  },
  {
    id: "long_stride",
    name: "Long Stride",
    family: "movement",
    magnitude: 0.15,
    description:
      "The dash travels further. Turns a dodge into a repositioning tool, and "
      + "makes crossing a room between volleys a plan rather than a gamble.",
  },
  {
    id: "wrath",
    name: "Wrath",
    family: "survival",
    magnitude: 1,
    description:
      "One more segment on the rage gauge, so the spin can be held in reserve "
      + "twice as often. Worth most to a player whose answer to a crowd is to "
      + "stand in it.",
  },
  {
    id: "vigour",
    name: "Vigour",
    family: "survival",
    magnitude: 1,
    description:
      "More health, filled. The run's attrition budget is thin, so every point "
      + "of it is a large share of the whole margin.",
  },
  {
    id: "steady_nerve",
    name: "Steady Nerve",
    family: "survival",
    magnitude: 0.2,
    description:
      "Longer invulnerability after a hit. Buys the moment needed to leave a "
      + "bad position, which is when a second hit usually arrives.",
  },
  {
    id: "deep_well",
    name: "Deep Well",
    family: "mana",
    magnitude: 0.18,
    description:
      "A larger mana pool. Everything that earns or spends mana is a percentage "
      + "of this, so it raises the ceiling of the whole economy rather than one "
      + "part of it.",
  },
  {
    id: "quickening",
    name: "Quickening",
    family: "mana",
    magnitude: 0.25,
    description:
      "Mana returns faster on its own. The stat for a build that wants to cast "
      + "between fights rather than during them.",
  },
  {
    id: "leeching_edge",
    name: "Leeching Edge",
    family: "mana",
    magnitude: 0.22,
    description:
      "The sword returns more mana per hit. Pays for closing distance, which is "
      + "the risk the whole design asks the player to take.",
  },
  {
    id: "keen_edge",
    name: "Keen Edge",
    family: "sword",
    magnitude: 0.15,
    description:
      "The sword hits harder. Never runs out and never costs anything, which is "
      + "what makes it the floor the rest of the build stands on.",
  },
  {
    id: "long_reach",
    name: "Long Reach",
    family: "sword",
    magnitude: 0.12,
    description:
      "The swing's crescent spreads further. Reach is the one thing that changes "
      + "which fights are winnable rather than how fast they end.",
  },
  {
    id: "swift_hand",
    name: "Swift Hand",
    family: "sword",
    magnitude: -0.1,
    description:
      "The swing recovers sooner. More swings is more mana as well as more "
      + "damage, so this one compounds with everything else.",
  },
];

export const STAT_FAMILIES: readonly StatFamily[] = ["movement", "survival", "mana", "sword"];

export function statById(id: string): StatUpgrade | null {
  return STAT_UPGRADES.find((s) => s.id === id) ?? null;
}

export function statIcon(s: StatUpgrade): string {
  return `icon_stat_${s.id}`;
}

/**
 * How a stat upgrade reads on a card.
 *
 * A reduction is shown as the improvement it is: "Second Wind" lowers the dash
 * cooldown, and "-12% cooldown" is a number the player has to translate into
 * "better". Health is the one flat entry, and it is written in the bar's
 * units rather than in hearts, because the bar is what the player sees.
 */
export function statLine(s: StatUpgrade, times = 1): string {
  // The two flat entries. `wrath` is survival-family and magnitude 1 like
  // `vigour`, and read as "+10 health" — while what it does is add a spin
  // charge. Said by id, so a flat entry says what it is.
  const n = Math.max(1, times);
  if (s.id === "wrath") return `+${s.magnitude * n} spin charge${s.magnitude * n === 1 ? "" : "s"}`;
  if (s.id === "vigour") return `+${s.magnitude * HP_PER_HEART * n} health`;
  // Applied `times` over, it compounds (see `applyStat`), so the line states
  // the compounded change rather than "x2" beside the single one.
  const pct = Math.round(Math.abs(Math.pow(1 + s.magnitude, n) - 1) * 100);
  const label: Record<StatFamily, string> = {
    movement: s.id === "fleet" ? "move speed" : s.id === "long_stride" ? "dash range" : "dash recovery",
    survival: "invulnerability",
    mana: s.id === "deep_well" ? "max mana" : s.id === "quickening" ? "mana regen" : "mana per hit",
    sword: s.id === "keen_edge" ? "sword damage" : s.id === "long_reach" ? "reach" : "swing recovery",
  };
  return `${s.magnitude < 0 ? "-" : "+"}${pct}% ${label[s.family]}`;
}

/**
 * Applies a stat upgrade to a run's modifiers, returning a new set.
 *
 * A pure function over `PlayerMods` rather than a mutation of the player,
 * because the modifiers belong to the **run** and the player is rebuilt every
 * room. Storing them on the player and mutating there would lose them at the
 * next portal, which is the shape of bug that looks like "the upgrade only
 * worked in the room I took it".
 *
 * Multiplicative stacking, so the tenth upgrade is worth the same proportion
 * as the first. Cooldowns and recovery multiply by a factor **below** one, so
 * repeated picks approach a floor rather than crossing zero — a cast time that
 * additively reaches zero is an infinite fire rate, which is the failure mode
 * Isaac caps with a square root.
 */
export function applyStat(mods: PlayerMods, id: string): PlayerMods {
  const up = statById(id);
  if (!up) return mods;
  const m = { ...mods };
  const k = 1 + up.magnitude;
  switch (up.id) {
    case "fleet": m.speed *= k; break;
    case "second_wind": m.dashCooldown *= k; break;
    case "long_stride": m.dashRange *= k; break;
    case "vigour": m.maxHearts += up.magnitude; break;
    case "wrath": m.rageMax += up.magnitude; break;
    case "steady_nerve": m.invuln *= k; break;
    case "deep_well": m.manaMax *= k; break;
    case "quickening": m.manaRegen *= k; break;
    case "leeching_edge": m.manaPerHit *= k; break;
    case "keen_edge": m.swordDamage *= k; break;
    case "long_reach": m.swordReach *= k; break;
    case "swift_hand": m.swingRecovery *= k; break;
  }
  return m;
}
