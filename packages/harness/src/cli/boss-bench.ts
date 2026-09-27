/**
 * **The boss, measured against the build rather than against the run.**
 *
 * `pnpm play` reports whether the boss was beaten, but the build it was
 * beaten with is whatever the Director happened to hand out, so a change to
 * the boss and a change to the reward economy read the same in that number.
 * This walks a fixed ladder of builds instead — blank, forming, formed, rich
 * — puts each one in the boss room at every skill profile, and reports the
 * win rate and the hearts each tier paid.
 *
 * The design target doc 003 sets, and what this is here to check: **a blank
 * build loses and a near-formed build wins with effort.** A boss the blank
 * build beats is a boss the run was not building toward; a boss the formed
 * build loses is a reaction test wearing a build gate.
 *
 * `pnpm boss-bench [seeds] [tier|all] [profile|all] [final|audience|whole]`
 *
 * The last argument is which meeting (doc 022): `final` (the default) is the
 * throne hall as the run plays it now, phase II from full on the larger bar;
 * `audience` is room 5's first audience, phase I until he leaves, against the
 * builds a run brings to room 5; `whole` is the single three-phase fight the
 * king was before the document, for comparison.
 */
import {
  ITEMS, RngSource, TILE_PX, THRONE_CELLS, attachAffix, createWorld, throneHall,
  makeKing, noMods, plainInstance, runStaff, withLevel, applyStat, RUN_AUDIENCE_ROOM,
  LEVEL_HEARTS, XP_TO_NEXT, withLevels,
} from "@jr/core";
import type { ItemInstance, PlayerMods } from "@jr/core";
import { BOSS_TIMEOUT_MS, fight } from "../play/run.ts";
import { SKILL_PROFILES, skillProfile } from "../play/skill.ts";
import { emptyRoom } from "../play/playtest-log.ts";

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
interface Tier {
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
const LEVEL_AT_BOSS = 7;
/** The experience that level takes, so the world builds the body from a total as the run does. */
const XP_AT_BOSS = XP_TO_NEXT.slice(0, LEVEL_AT_BOSS - 1).reduce((a, b) => a + b, 0);

/**
 * **What a run brings to room 5** (doc 022): four fights in, one or two spells,
 * a level or two. `blank` never took a spell; `typical` took a second one and
 * an affix; `strong` levelled both. The first audience is sized against the
 * middle one: 40 to 50 s from the drop to his leaving.
 */
const AUDIENCE_LEVEL = 3;
const AUDIENCE_XP = XP_TO_NEXT.slice(0, AUDIENCE_LEVEL - 1).reduce((a, b) => a + b, 0);
const AUDIENCE_TIERS: readonly Tier[] = [
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

const TIERS: readonly Tier[] = [
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

/** One boss fight, with the build forced rather than earned. */
type Meeting = "final" | "audience" | "whole";

function bossFight(tier: Tier, profileName: string, seed: string, meeting: Meeting = "final"): { won: boolean; hearts: number; ms: number; timedOut: boolean; bySource: Record<string, number> } {
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
  });
  // The staff the fixture asked for, levelled and affixed, as the run's own
  // room loop does it: `createWorld` builds plain slots and the run layers
  // what it earned on top.
  tier.spells.forEach((s, i) => {
    let slot = world.spells[i];
    if (!slot) return;
    for (const [id, t] of s.affixes) slot = attachAffix(slot, id, t) ?? slot;
    if (s.level > 1) slot = withLevel(slot, s.level);
    world.spells[i] = slot;
  });

  // Where the game's king stands up from his throne (`spawnBoss` in play.ts): two rows out in front of it.
  const [tx, ty] = THRONE_CELLS[1]!;
  const boss = makeKing(world.nextEnemyId++, (tx + 0.5) * TILE_PX, (ty + 2.1) * TILE_PX, meeting === "whole" ? undefined : meeting);
  boss.spawnFadeMs = 0;
  boss.awake = true;
  world.enemies.push(boss);

  const before = world.player.hearts;
  const log = emptyRoom(16, "boss");
  const r = fight(world, SKILL_PROFILES[profileName as keyof typeof SKILL_PROFILES] ?? skillProfile(profileName), BOSS_TIMEOUT_MS, false, log);
  return {
    won: r.cleared,
    hearts: before - world.player.hearts,
    ms: r.ms,
    timedOut: !r.cleared && world.player.hearts > 0,
    bySource: log.bySource,
  };
}

const seeds = Number(process.argv[2] ?? 8);
const tierArg = process.argv[3] ?? "all";
const profileArg = process.argv[4] ?? "all";
const meeting = (process.argv[5] ?? "final") as Meeting;
const ladder = meeting === "audience" ? AUDIENCE_TIERS : TIERS;
const tiers = tierArg === "all" ? ladder : ladder.filter((t) => t.name === tierArg);
const profiles = profileArg === "all" ? ["novice", "average", "player", "expert"] : [profileArg];

console.log(`boss bench (${meeting}): ${tiers.length} build tiers x ${profiles.length} profiles x ${seeds} seeds`);
for (const t of tiers) {
  const desc = t.spells.map((s) => `${s.id}@${s.level}${s.affixes.length ? `[${s.affixes.map(([a, n]) => `${a}${n}`).join(",")}]` : ""}`).join(" ");
  console.log(`\n${t.name}: ${desc}  stats ${t.stats.length}  level ${meeting === "audience" ? AUDIENCE_LEVEL : LEVEL_AT_BOSS}  hearts ${t.hearts + LEVEL_HEARTS * ((meeting === "audience" ? AUDIENCE_LEVEL : LEVEL_AT_BOSS) - 1) + t.stats.filter((x) => x === "vigour").length}`);
  console.log(`  ${"profile".padEnd(9)} ${"win".padStart(6)}  ${"rate".padStart(5)}  ${"hearts".padStart(6)}  ${"secs".padStart(5)}  deaths  timeouts`);
  for (const p of profiles) {
    let won = 0; let heartsSum = 0; let msSum = 0; let timedOut = 0;
    // What the hearts went to, summed over the seeds: which move is doing the damage.
    const sources: Record<string, number> = {};
    for (let i = 0; i < seeds; i++) {
      const r = bossFight(t, p, `boss-${i}`, meeting);
      if (r.won) won++;
      if (r.timedOut) timedOut++;
      heartsSum += r.hearts;
      msSum += r.ms;
      for (const [k, v] of Object.entries(r.bySource)) sources[k] = (sources[k] ?? 0) + v;
    }
    console.log(
      `  ${p.padEnd(9)} ${`${won}/${seeds}`.padStart(6)}  ${`${((100 * won) / seeds).toFixed(0)}%`.padStart(5)}  `
      + `${(heartsSum / seeds).toFixed(2).padStart(6)}  ${(msSum / seeds / 1000).toFixed(0).padStart(5)}  `
      + `${String(seeds - won - timedOut).padStart(6)}  ${String(timedOut).padStart(8)}`,
    );
    const lost = Object.entries(sources).sort((a, b) => b[1] - a[1]);
    if (lost.length) console.log(`            lost to, hearts per fight: ${lost.map(([k, v]) => `${k} ${(v / seeds).toFixed(2)}`).join(" · ")}`);
  }
}
