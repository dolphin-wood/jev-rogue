/**
 * **The king's room, set with a build**: the ladders `boss-bench` and
 * `king-pressure` share, and the room they both build from a rung. A rung
 * is a build forced rather than earned, so a change to the king reads the
 * same against each rung whatever the reward economy does.
 */
import {
  RngSource, TILE_PX, THRONE_CELLS, attachAffix, createWorld, throneHall,
  makeKing, noMods, plainInstance, runStaff, withLevel, applyStat, RUN_AUDIENCE_ROOM,
  LEVEL_HEARTS, XP_TO_NEXT,
} from "@jr/core";
import type { Enemy, ItemInstance, PlayerMods, World } from "@jr/core";

/**
 * A rung of the build ladder. `spells` is what is in the staff, each with the
 * level it is at and the affixes attached to it; `stats` is how many stat
 * cards the run took, and `hearts` what it walked in on.
 *
 * The four rungs are the four build shapes doc 007 names, pinned to numbers
 * so a boss change can be read against each of them separately:
 *
 * - **blank** is the run that took nothing: the starting bolt, unlevelled and
 *   bare. It is supposed to lose.
 * - **forming** is halfway: a second key, a level or two, one affix each.
 * - **formed** is the target — two keys with filled affix slots and some
 *   levels. It is supposed to win, and to pay for it.
 * - **rich** is what the measured runs actually reach the boss with (three
 *   keys, ~11 levels, ~8 affixes), kept as the upper reference.
 */
export interface Tier {
  readonly name: string;
  readonly spells: readonly { readonly id: string; readonly level: number; readonly affixes: readonly [string, number][] }[];
  readonly stats: readonly string[];
  readonly hearts: number;
}

/**
 * **The level every tier arrives at, which is not a rung of the ladder.**
 *
 * The ladder is about *cards* — what the run was offered and kept — and a
 * level is not offered and cannot be declined (`core/run/levels.ts`): fourteen
 * fights pay for about seven of them whatever the staff looks like. So the
 * bench gives all four tiers the same level, and the rungs stay what they were
 * meant to be. Giving the blank build a lower one would be measuring a body
 * the game never brings to this room.
 */
export const LEVEL_AT_BOSS = 7;
/** The experience that level takes, so the world builds the body from a total as the run does. */
const XP_AT_BOSS = XP_TO_NEXT.slice(0, LEVEL_AT_BOSS - 1).reduce((a, b) => a + b, 0);

/**
 * **What a run brings to room 5** (doc 022): four fights in, one or two spells,
 * a level or two. `blank` never took a spell; `typical` took a second one and
 * an affix; `strong` levelled both. The first audience is sized against the
 * middle one: 40 to 50 s from the drop to his leaving.
 */
export const AUDIENCE_LEVEL = 3;
const AUDIENCE_XP = XP_TO_NEXT.slice(0, AUDIENCE_LEVEL - 1).reduce((a, b) => a + b, 0);
export const AUDIENCE_TIERS: readonly Tier[] = [
  { name: "blank", spells: [{ id: "magic_bolt", level: 1, affixes: [] }], stats: [], hearts: 6 },
  {
    name: "typical",
    spells: [{ id: "magic_bolt", level: 1, affixes: [["scatter", 1]] }, { id: "frost_needle", level: 1, affixes: [] }],
    stats: [], hearts: 6,
  },
  {
    name: "strong",
    spells: [{ id: "magic_bolt", level: 2, affixes: [["scatter", 1]] }, { id: "frost_needle", level: 2, affixes: [["seek", 1]] }],
    stats: ["vigour"], hearts: 6,
  },
];

export const TIERS: readonly Tier[] = [
  {
    name: "blank",
    spells: [{ id: "magic_bolt", level: 1, affixes: [] }],
    stats: [], hearts: 6,
  },
  {
    name: "forming",
    spells: [
      { id: "magic_bolt", level: 2, affixes: [["scatter", 1]] },
      { id: "frost_needle", level: 2, affixes: [["seek", 1]] },
    ],
    stats: ["vigour"], hearts: 6,
  },
  {
    name: "formed",
    spells: [
      { id: "magic_bolt", level: 4, affixes: [["scatter", 2], ["kindle", 2], ["repeat", 1]] },
      { id: "frost_needle", level: 3, affixes: [["seek", 2], ["fork", 1], ["rime", 1]] },
    ],
    stats: ["vigour", "focus"], hearts: 6,
  },
  {
    name: "rich",
    spells: [
      { id: "magic_bolt", level: 5, affixes: [["scatter", 2], ["kindle", 3], ["repeat", 2]] },
      { id: "frost_needle", level: 4, affixes: [["seek", 3], ["fork", 2], ["rime", 2]] },
      { id: "seeker_swarm", level: 3, affixes: [["harvest", 2], ["bloom", 1]] },
    ],
    stats: ["vigour", "focus", "alacrity"], hearts: 6,
  },
];

/**
 * **The melee ladders**, the same four rungs for the player most runs are:
 * the sword doing the work, the sword-style spells beside it (Crescent Edge
 * rides the sword's damage, Blade Recall calls home what the blows lodge),
 * and the stat cards a sword run takes — reach, recovery, health — rather
 * than the sword-damage card, which the levels already pay for. `rich` is
 * the build a logged run of 2026-09-30 walked into the throne hall with.
 */
export const MELEE_AUDIENCE_TIERS: readonly Tier[] = [
  { name: "blank", spells: [{ id: "crescent_edge", level: 1, affixes: [] }], stats: [], hearts: 6 },
  {
    name: "typical",
    spells: [{ id: "crescent_edge", level: 1, affixes: [["expanse", 1]] }, { id: "blade_recall", level: 1, affixes: [] }],
    stats: [], hearts: 6,
  },
  {
    name: "strong",
    spells: [{ id: "crescent_edge", level: 2, affixes: [["expanse", 1]] }, { id: "blade_recall", level: 2, affixes: [] }],
    stats: ["vigour"], hearts: 6,
  },
];
export const MELEE_TIERS: readonly Tier[] = [
  { name: "blank", spells: [{ id: "crescent_edge", level: 1, affixes: [] }], stats: [], hearts: 6 },
  {
    name: "forming",
    spells: [
      { id: "crescent_edge", level: 2, affixes: [["expanse", 1]] },
      { id: "blade_recall", level: 2, affixes: [] },
    ],
    stats: ["vigour"], hearts: 6,
  },
  {
    name: "formed",
    spells: [
      { id: "crescent_edge", level: 3, affixes: [["expanse", 1], ["intercept", 1], ["brand", 1]] },
      { id: "blade_recall", level: 4, affixes: [["whirl", 1]] },
      { id: "doom_sigil", level: 1, affixes: [["harvest", 1]] },
    ],
    stats: ["vigour", "long_reach", "swift_hand"], hearts: 6,
  },
  {
    name: "rich",
    spells: [
      { id: "crescent_edge", level: 5, affixes: [["expanse", 1], ["intercept", 1], ["brand", 1]] },
      { id: "blade_recall", level: 5, affixes: [["whirl", 1], ["repulse", 1]] },
      { id: "doom_sigil", level: 3, affixes: [["retort", 1], ["harvest", 1], ["fork", 1]] },
    ],
    stats: ["vigour", "vigour", "long_reach", "long_reach", "swift_hand", "steady_nerve"], hearts: 6,
  },
];

/** Which meeting (doc 022): the throne hall, room 5's first audience, or the one fight he was before. */
export type Meeting = "final" | "audience" | "whole";
/** Which ladder: the sword run most players make, or the caster ladder kept as the second check. */
export type LadderStyle = "melee" | "spell";

export function ladderFor(style: LadderStyle, meeting: Meeting): readonly Tier[] {
  return style === "melee"
    ? (meeting === "audience" ? MELEE_AUDIENCE_TIERS : MELEE_TIERS)
    : (meeting === "audience" ? AUDIENCE_TIERS : TIERS);
}

/** The throne hall (or room 5's audience) with the rung's build in the staff and the king stood up, awake. */
export function kingRoom(tier: Tier, seed: string, meeting: Meeting = "final", opts: { invincible?: boolean } = {}): { world: World; boss: Enemy } {
  const src = new RngSource(seed);
  const staff = runStaff();
  const slots: (ItemInstance | null)[] = Array.from({ length: staff.slots }, (_, i) => {
    const s = tier.spells[i];
    return s ? plainInstance(s.id, `${s.id}-fixture`) : null;
  });
  let mods: PlayerMods = noMods();
  let hearts = tier.hearts;
  for (const s of tier.stats) {
    mods = applyStat(mods, s);
    if (s === "vigour") hearts += 1;
  }
  // And the bar the levels grew, filled: the fountain at the fixed stop is the
  // room before this one, so a run walks in on very nearly its whole bar.
  const level = meeting === "audience" ? AUDIENCE_LEVEL : LEVEL_AT_BOSS;
  hearts += LEVEL_HEARTS * (level - 1);

  // The throne hall the game fights in (`rooms/fixed.ts`): the bench and the run meet the same room.
  const plan = throneHall();

  const world = createWorld({
    room: plan, encounter: null, staff, slots,
    hearts, rng: src.stream("gameplay", 1), mods, xp: meeting === "audience" ? AUDIENCE_XP : XP_AT_BOSS, rage: 0,
    // The room's own ramp band: room 5's for the first audience, the boss band's for the hall.
    coinBoost: 1, roomIndex: meeting === "audience" ? RUN_AUDIENCE_ROOM : 16, placement: "waves",
    ...(opts.invincible ? { invincible: true } : {}),
  });
  // The staff the fixture asked for, levelled and affixed, as the run's own
  // room loop does it: `createWorld` builds plain slots and the run layers
  // what it earned on top.
  tier.spells.forEach((s, i) => {
    let slot = world.spells[i];
    if (!slot) return;
    for (const [id] of s.affixes) slot = attachAffix(slot, id) ?? slot;
    if (s.level > 1) slot = withLevel(slot, s.level);
    world.spells[i] = slot;
  });

  // Where the game's king stands up from his throne (`spawnBoss` in play.ts): two rows out in front of it.
  const [tx, ty] = THRONE_CELLS[1]!;
  const boss = makeKing(world.nextEnemyId++, (tx + 0.5) * TILE_PX, (ty + 2.1) * TILE_PX, meeting === "whole" ? undefined : meeting);
  boss.spawnFadeMs = 0;
  boss.awake = true;
  world.enemies.push(boss);

  return { world, boss };
}
