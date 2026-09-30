/**
 * **How hard the king presses, read as a rate rather than a verdict.**
 *
 * `boss-bench` asks whether a build wins, and its answer is only as good as
 * the reference player's dodging. Against the king that answer came out the
 * wrong way round: a person who had met him once won the final without
 * losing a heart, while even `expert` died every fight. He is built to be
 * read — one turn at a time, on the beat, chosen by range — and a model
 * with a fixed reaction time gets none of that. So the bench's win rate is
 * no gauge of him for people.
 *
 * This plays each rung **invincible** to the end and reports rates:
 *
 * - **how long** the build takes to kill him, overall and per phase, which
 *   is what his bar is sized against;
 * - **how often he starts a turn** and **how much of the fight he rests**,
 *   per phase, which is his tempo;
 * - **the health his blows would have cost**, per minute and per phase,
 *   which is the pressure.
 *
 * The rates move with a change to the king whatever the model's skill, so a
 * change is read here before and after, and a person plays it to say
 * whether it is right.
 *
 * `pnpm king-pressure [seeds] [profile] [melee|spell] [tier|all]`
 */
import { STEP_MS, step } from "@jr/core";
import { referenceInput } from "../play/player-model.ts";
import { skillProfile } from "../play/skill.ts";
import { kingRoom, ladderFor } from "../play/boss-ladder.ts";
import type { LadderStyle } from "../play/boss-ladder.ts";

const seeds = Number(process.argv[2] ?? 6);
const profile = skillProfile(process.argv[3] ?? "expert");
const style = (process.argv[4] ?? "melee") as LadderStyle;
if (style !== "melee" && style !== "spell") throw new Error(`style "${style}": expected melee or spell`);
const tierArg = process.argv[5] ?? "all";
/** Past this the build is not killing him, and the fight is reported as unfinished. */
const LIMIT_MS = 300_000;
const HP_PER_HEART = 10;

interface Phase { ms: number; restMs: number; turns: number; hp: number }
const blank = (): Phase => ({ ms: 0, restMs: 0, turns: 0, hp: 0 });

const ladder = ladderFor(style, "final").filter((t) => tierArg === "all" || t.name === tierArg);
console.log(`king pressure (final, ${style}, ${profile.name}${profile.autoCast ? ", auto-cast" : ""}): ${seeds} seeds, invincible`);
console.log("  per phase: seconds · turns a minute · share of time resting · hp his blows cost a minute");
for (const tier of ladder) {
  const phases = [blank(), blank(), blank()];
  let total = 0, unfinished = 0;
  const bySource: Record<string, number> = {};
  for (let i = 0; i < seeds; i++) {
    const { world, boss } = kingRoom(tier, `boss-${i}`, "final", { invincible: true });
    let ms = 0, wasBusy = boss.bossBusy;
    while (ms < LIMIT_MS && boss.hp > 0) {
      const ph = phases[Math.min(3, Math.max(1, boss.phase)) - 1]!;
      step(world, referenceInput(world, profile));
      ph.ms += STEP_MS;
      if (!boss.bossBusy && boss.bossRoarMs <= 0) ph.restMs += STEP_MS;
      if (boss.bossBusy && !wasBusy) ph.turns++;
      wasBusy = boss.bossBusy;
      for (const ev of world.events) {
        if (ev.kind !== "player_hit" || !ev.amount) continue;
        const hp = ev.amount * HP_PER_HEART;
        ph.hp += hp;
        const why = ev.what ?? "?";
        bySource[why] = (bySource[why] ?? 0) + hp;
      }
      ms += STEP_MS;
    }
    if (boss.hp > 0) unfinished++;
    total += ms;
  }
  const s = (ms: number) => ms / seeds / 1000;
  console.log(`\n${tier.name}: ${s(total).toFixed(0)} s to kill${unfinished ? ` (${unfinished} unfinished at ${LIMIT_MS / 1000} s)` : ""}`);
  phases.forEach((p, i) => {
    const min = p.ms / 60_000;
    if (min <= 0) return;
    console.log(`  ${["I  ", "II ", "III"][i]} ${s(p.ms).toFixed(0).padStart(4)} s · ${(p.turns / min).toFixed(1).padStart(4)} turns/min · rest ${((100 * p.restMs) / p.ms).toFixed(0).padStart(3)}% · ${(p.hp / min).toFixed(0).padStart(4)} hp/min`);
  });
  const top = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, v]) => `${k} ${(v / seeds).toFixed(0)}`).join(" · ");
  console.log(`  hp a fight by source: ${top}`);
}
