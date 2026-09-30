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
 * `pnpm boss-bench [seeds] [tier|all] [profile|all] [final|audience|whole] [melee|spell]`
 *
 * The last argument is which meeting (doc 022): `final` (the default) is the
 * throne hall as the run plays it now, a short phase I then II and III on the larger bar;
 * `audience` is room 5's first audience, phase I until he leaves, against the
 * builds a run brings to room 5; `whole` is the single three-phase fight the
 * king was before the document, for comparison.
 *
 * The last is which ladder: `melee` (the default) is the player the game is
 * tuned for — the sword in the hands, sword-style spells beside it, and the
 * spells left to the auto-cast assist, as every profile but `expert` plays
 * them (`SkillProfile.autoCast`). `spell` is the caster ladder the bench had
 * before, kept as the second check.
 */
import { LEVEL_HEARTS } from "@jr/core";
import { AUDIENCE_LEVEL, LEVEL_AT_BOSS, kingRoom, ladderFor } from "../play/boss-ladder.ts";
import type { Tier } from "../play/boss-ladder.ts";
import { BOSS_TIMEOUT_MS, fight } from "../play/run.ts";
import { skillProfile } from "../play/skill.ts";
import { emptyRoom } from "../play/playtest-log.ts";
import type { Meeting } from "../play/boss-ladder.ts";

/** One boss fight, with the build forced rather than earned. */
function bossFight(tier: Tier, profileName: string, seed: string, meeting: Meeting = "final"): { won: boolean; hearts: number; ms: number; timedOut: boolean; bySource: Record<string, number> } {
  const { world } = kingRoom(tier, seed, meeting);
  const before = world.player.hearts;
  const log = emptyRoom(16, "boss");
  const r = fight(world, skillProfile(profileName), BOSS_TIMEOUT_MS, false, log);
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
const style = process.argv[6] ?? "melee";
if (style !== "melee" && style !== "spell") throw new Error(`style "${style}": expected melee or spell`);
const ladder = ladderFor(style, meeting);
const tiers = tierArg === "all" ? ladder : ladder.filter((t) => t.name === tierArg);
const profiles = profileArg === "all" ? ["novice", "average", "player", "expert"] : [profileArg];

console.log(`boss bench (${meeting}, ${style}): ${tiers.length} build tiers x ${profiles.length} profiles x ${seeds} seeds`
  + ` (auto-cast: ${profiles.filter((p) => skillProfile(p).autoCast).join(", ") || "none"})`);
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
