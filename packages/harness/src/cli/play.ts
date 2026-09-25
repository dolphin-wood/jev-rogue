import { playRun, HURT_BY, MELEE_HITS, MANA, WAVES, DENSITY, VIEW, STATES, STATE_KEYS, BY_INDEX, THIN_ROOMS, SPELL_USE } from "../play/run.ts";
import { skillProfile } from "../play/skill.ts";
import { byFamily } from "../play/playtest-log.ts";
import type { RoomLog } from "../play/playtest-log.ts";
import type { DirectorArm } from "@jr/director";
import { HP_PER_HEART, MAX_HEARTS, noMods, withLevels } from "@jr/core";

const arm = (process.argv[2] ?? "rule") as DirectorArm;
const seeds = Number(process.argv[3] ?? 1);
/**
 * Which player is being measured: `pnpm play rule 12 novice`. Defaults to
 * `expert`, which is the model as it was before profiles existed, so a command
 * written before this argument existed still reports the same numbers.
 */
const profile = skillProfile(process.argv[4]);
console.log(`profile ${profile.name}: reaction ${profile.reactionMs}ms`
  + `${profile.blindSpotMs ? ` (+${profile.blindSpotMs}ms behind)` : ""}`
  + `, re-plans every ${profile.decisionMs || 17}ms`
  + `, attends ${profile.attentionBullets} bullets / ${profile.attentionEnemies} bodies`
  + `, aim ±${profile.aimErrorDeg}deg, dash skipped ${(profile.dashSkipChance * 100).toFixed(0)}%`);

/** Every room every profile-run played, for the by-index playtest table. */
const playtest: RoomLog[] = [];

let survived = 0;
/**
 * Cleared and unfinished rooms are kept apart.
 *
 * A room the reference player could not finish bleeds for the whole two-minute
 * timeout, so folding those into the average reports the model's failure to
 * reach something as the encounter being overtuned. Those are opposite fixes,
 * and the band verdict is taken on the cleared rooms because they are the only
 * ones that measure the encounter rather than the model.
 */
const byTension = new Map<string, {
  rooms: number; hearts: number; ms: number; failed: number;
  clearedRooms: number; clearedHearts: number; clearedMs: number;
}>();
const depths: number[] = [];
/**
 * **What a whole run cost**, in the units the difficulty target is written
 * in: gross HP taken from the first door to the last, and the health left at
 * the end. Per room it was already reported; per run it was not, and the run
 * is what the player experiences — a game where every room costs four HP and
 * every reward heals six is a game nobody is ever in danger in, and the
 * per-room table cannot say so.
 */
const runHp: { taken: number; left: number; rooms: number; survived: boolean }[] = [];
/** Every cleared combat room's length, for the distribution doc 014 sizes the run against. */
const combatMs: number[] = [];
let combatZeroDamage = 0;
const boss = { rooms: 0, cleared: 0, hearts: 0, ms: 0, died: 0, timedOut: 0 };
/** The builds runs reached the boss with, and whether they won there (task 10). */
const builds: { won: boolean; keys: number; levels: number; affixes: number; stats: number; hearts: number; level: number; maxHp: number; sword: number; line: string }[] = [];
/** How the fights were built, so a short room can be traced to its shape rather than guessed at. */
const shapes = new Map<string, { rooms: number; roster: number; ms: number; hearts: number }>();
/** The rooms that cost the most, individually: an average hides a room that takes six hearts in thirty seconds. */
const worst: { seed: string; index: number; type: string; space: string; tension: string; shape: string; hearts: number; ms: number; kills: number }[] = [];

for (let i = 0; i < seeds; i++) {
  const out = await playRun(`seed-${i}`, arm, "spam", {}, undefined, profile);
  playtest.push(...out.log);
  if (out.survived) survived++;
  if (out.atBoss) {
    const b = out.atBoss;
    const won = out.rooms.some((r) => r.type === "boss" && r.cleared);
    builds.push({
      won, keys: b.spells.length,
      levels: b.spells.reduce((t, x) => t + x.level, 0),
      affixes: b.spells.reduce((t, x) => t + x.affixes.length, 0),
      stats: b.stats, hearts: b.hearts,
      /*
       * **The body at the boss** (`run/levels.ts`): the level the kills paid
       * for, the bar it grew to, and what the sword hits for. The build line
       * above is the staff; this is the player holding it, which is the half
       * the run had no numbers for.
       */
      level: b.level,
      maxHp: (MAX_HEARTS + withLevels(noMods(), b.level).maxHearts) * HP_PER_HEART,
      sword: withLevels(noMods(), b.level).swordDamage,
      line: `${b.spells.map((x) => `${x.id}@${x.level}${x.affixes.length ? `[${x.affixes.join(",")}]` : ""}`).join(" ")}  stats ${b.stats}  hearts ${b.hearts.toFixed(1)}`,
    });
  }
  depths.push(out.rooms.length);
  runHp.push({
    taken: out.log.reduce((t, r) => t + r.hpLost, 0),
    left: out.heartsLeft * HP_PER_HEART,
    rooms: out.rooms.length,
    survived: out.survived,
  });
  for (const r of out.rooms) {
    if (r.type === "boss") {
      boss.rooms++;
      boss.hearts += r.heartsLost;
      boss.ms += r.ms;
      if (r.cleared) boss.cleared++;
      else if (out.survived) boss.timedOut++;
      else boss.died++;
      continue;
    }
    if (r.type !== "combat" && r.type !== "elite") continue;
    if (r.cleared) {
      combatMs.push(r.ms);
      if (r.heartsLost === 0) combatZeroDamage++;
    }
    if (r.heartsLost >= 3)
      worst.push({ seed: out.seed, index: r.index, type: r.type, space: r.space, tension: r.tension,
        shape: r.shape ? `${r.shape.density}/${r.shape.waves} x${r.shape.roster}` : "-", hearts: r.heartsLost, ms: r.ms, kills: r.enemies });
    // The shape of a run, not only of a band: see `BY_INDEX` / the ramp.
    {
      const e = BY_INDEX.get(r.index) ?? { rooms: 0, hearts: 0, ms: 0, bodies: 0 };
      e.rooms++; e.hearts += r.heartsLost; e.ms += r.ms; e.bodies += r.shape?.roster ?? 0;
      BY_INDEX.set(r.index, e);
    }
    if (r.shape) {
      const k = `${r.shape.density}/${r.shape.waves}`;
      const e = shapes.get(k) ?? { rooms: 0, roster: 0, ms: 0, hearts: 0 };
      e.rooms++; e.roster += r.shape.roster; e.ms += r.ms; e.hearts += r.heartsLost;
      shapes.set(k, e);
    }
    const key = r.type === "elite" ? "elite" : r.tension;
    const e = byTension.get(key)
      ?? { rooms: 0, hearts: 0, ms: 0, failed: 0, clearedRooms: 0, clearedHearts: 0, clearedMs: 0 };
    e.rooms++;
    e.hearts += r.heartsLost;
    e.ms += r.ms;
    if (r.cleared) {
      e.clearedRooms++;
      e.clearedHearts += r.heartsLost;
      e.clearedMs += r.ms;
    } else {
      e.failed++;
    }
    byTension.set(key, e);
  }
  if (seeds === 1) {
    console.log(`run ${out.seed} on ${out.arm}: ${out.survived ? "survived" : "died"}, ${out.heartsLeft} hearts, ${(out.totalMs / 1000).toFixed(0)}s`);
    for (const r of out.rooms)
      console.log(
        `  ${String(r.index).padStart(2)} ${r.type.padEnd(8)} ${r.space.padEnd(16)} ${r.tension.padEnd(7)} ` +
        `${r.cleared ? "cleared" : "FAILED "} ${String(r.enemies).padStart(2)} kills  -${r.heartsLost} hearts  ` +
        `${String(Math.round(r.ms / 1000)).padStart(3)}s  ${r.reward ?? "-"}`,
      );
    console.log(`  staff: ${out.items.join(", ")}`);
  }
}
if (seeds > 1) {
  console.log(`${arm}: ${survived}/${seeds} runs survived, median depth ${median(depths)} rooms`);
  {
    const mean = (f: (r: (typeof runHp)[number]) => number): number =>
      runHp.reduce((t, r) => t + f(r), 0) / Math.max(1, runHp.length);
    const full = runHp.filter((r) => r.survived);
    console.log(
      `  a run costs ${mean((r) => r.taken).toFixed(0)} HP gross over ${mean((r) => r.rooms).toFixed(1)} rooms `
      + `(${(mean((r) => r.taken) / Math.max(1, mean((r) => r.rooms))).toFixed(1)} a room); `
      + `ended on ${mean((r) => r.left).toFixed(0)} of ${MAX_HEARTS * HP_PER_HEART} HP`
      + (full.length > 0
        ? `; full clears (${full.length}): ${(full.reduce((t, r) => t + r.taken, 0) / full.length).toFixed(0)} HP gross, `
          + `ended on ${(full.reduce((t, r) => t + r.left, 0) / full.length).toFixed(0)}`
        : ""),
    );
  }
  if (MELEE_HITS.length > 0) {
    const by = new Map<string, typeof MELEE_HITS>();
    for (const h of MELEE_HITS) {
      const list = by.get(h.cause) ?? [];
      list.push(h);
      by.set(h.cause, list);
    }
    console.log("  melee hits, geometry at the moment of the hit:");
    for (const [cause, hits] of [...by].sort((a, b) => b[1].length - a[1].length)) {
      const med = (pick: (h: typeof hits[number]) => number): string => {
        const v = hits.map(pick).sort((a, b) => a - b);
        return (v[v.length >> 1] ?? 0).toFixed(0);
      };
      const phases = new Map<string, number>();
      for (const h of hits) phases.set(h.phase, (phases.get(h.phase) ?? 0) + 1);
      console.log(
        `    ${cause.padEnd(14)} n=${String(hits.length).padStart(3)}` +
        `  median dist ${med((h) => h.dist)}px  reach ${med((h) => h.reach)}px` +
        `  body ${med((h) => h.radius)}px  off-axis ${med((h) => h.offAxisDeg)}deg` +
        // Whether the model had seen this body attacking when it chose the step
        // it was standing on, and how stale that choice was. See `MELEE_HITS`.
        `  saw the attack ${((100 * hits.filter((h) => h.saw).length) / hits.length).toFixed(0)}%` +
        `  plan age ${med((h) => h.planAgeMs)}ms` +
        `  phases ${[...phases].map(([k, n]) => `${k}:${n}`).join(" ")}`,
      );
    }
  }
  const total = [...HURT_BY.values()].reduce((a, b) => a + b, 0);
  if (total > 0) {
    const by = [...HURT_BY.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`  hearts lost by cause, ${total} total:`);
    for (const [cause, n] of by)
      console.log(`    ${cause.padEnd(14)} ${String(n).padStart(4)}  ${((n / total) * 100).toFixed(0)}%`);
  }
  if (combatMs.length > 0) {
    const s = [...combatMs].sort((a, b) => a - b);
    const q = (f: number): string => ((s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0) / 1000).toFixed(0);
    const under = (secs: number): number => s.filter((v) => v < secs * 1000).length;
    // Doc 014 asks 30 to 40 seconds a room; a room under five is a formality.
    console.log(
      `  combat rooms cleared: ${s.length}  length p10/p50/p90 ${q(0.1)}/${q(0.5)}/${q(0.9)}s  ` +
      `under 5s ${under(5)}  under 15s ${under(15)}  over 60s ${s.length - under(60)}  ` +
      `zero damage ${combatZeroDamage} (${((combatZeroDamage / s.length) * 100).toFixed(0)}%)`,
    );
  }
  if (shapes.size > 0) {
    console.log("  fights by shape (density/staging), mean roster, length, hearts:");
    for (const [k, e] of [...shapes].sort((a, b) => b[1].rooms - a[1].rooms))
      console.log(`    ${k.padEnd(24)} n=${String(e.rooms).padStart(3)}  roster ${(e.roster / e.rooms).toFixed(1).padStart(4)}  ${(e.ms / e.rooms / 1000).toFixed(0).padStart(3)}s  ${(e.hearts / e.rooms).toFixed(2)} hearts`);
  }
  if (worst.length > 0) {
    console.log(`  rooms costing 3+ hearts (${worst.length}):`);
    for (const r of worst.sort((a, b) => b.hearts - a.hearts).slice(0, 10))
      console.log(`    ${r.seed} #${String(r.index).padStart(2)} ${r.type.padEnd(6)} ${r.space.padEnd(16)} ${r.tension.padEnd(7)} ${r.shape.padEnd(22)} -${r.hearts} hearts  ${Math.round(r.ms / 1000)}s  ${r.kills} kills`);
  }
  if (builds.length > 0) {
    const mean = (f: (b: (typeof builds)[number]) => number, xs = builds) => (xs.reduce((t, b) => t + f(b), 0) / Math.max(1, xs.length)).toFixed(1);
    const won = builds.filter((b) => b.won);
    const lost = builds.filter((b) => !b.won);
    console.log(`  builds at the boss: keys ${mean((b) => b.keys)}, spell levels ${mean((b) => b.levels)}, affixes ${mean((b) => b.affixes)}, stats ${mean((b) => b.stats)}, hearts ${mean((b) => b.hearts)}`);
    console.log(`    won  (${won.length}): levels ${mean((b) => b.levels, won)}, affixes ${mean((b) => b.affixes, won)}, stats ${mean((b) => b.stats, won)}, hearts ${mean((b) => b.hearts, won)}`);
    console.log(`    lost (${lost.length}): levels ${mean((b) => b.levels, lost)}, affixes ${mean((b) => b.affixes, lost)}, stats ${mean((b) => b.stats, lost)}, hearts ${mean((b) => b.hearts, lost)}`);
    // The body, not the staff: what the kills grew, before the stat cards.
    console.log(
      `    the body at the boss: level ${mean((b) => b.level)}, max health ${mean((b) => b.maxHp)} `
      + `(levels only, before stat cards), sword x${(builds.reduce((t, b) => t + b.sword, 0) / builds.length).toFixed(2)}`,
    );
    for (const b of lost) console.log(`      lost with ${b.line}`);
  }
  if (boss.rooms > 0) {
    // Doc 003: two to three minutes, one to two hearts.
    console.log(
      `  boss: ${boss.cleared}/${boss.rooms} beaten, ${boss.died} deaths, ${boss.timedOut} timeouts, ` +
      `mean ${(boss.ms / boss.rooms / 1000).toFixed(0)}s, ${(boss.hearts / boss.rooms).toFixed(2)} hearts lost`,
    );
  }
  /*
   * **Doc 005's calibration targets, two-sided and per profile.**
   *
   * They were one ceiling for every profile — 1, 2, 3, 4 hearts with half a
   * heart of slack, and 45 to 90 seconds — and nothing ever came close to
   * either: the measured figures sat at 0.15 to 1.5 hearts and 10 to 26
   * seconds, so every band printed "in band" whatever the game did. A check
   * that cannot fail is not a check, and it did not fail while the run
   * collapsed into a game a full clear cost 24 of 60 health.
   *
   * So there is a **floor** as well as a ceiling now, and that is the point of
   * the rewrite: the failure this pass exists to catch is a room that costs
   * nothing, not a room that costs too much. And the windows are per profile,
   * because one set of numbers cannot describe both a model that never misses
   * a dodge and one that skips four dashes in five — holding them to the same
   * band is what made the band meaningless.
   *
   * Set from the measured run (12 seeds, rule arm) with room to move either
   * way. `average` is the one to read: it is the profile whose mistakes look
   * like a person's, and it is what the difficulty targets are written
   * against. `novice` never clears an elite room at all, which is a known gap
   * in the model rather than a band.
   */
  const target: Record<string, Record<string, { hearts: [number, number]; secs: number }>> = {
    expert: {
      release: { hearts: [0, 0.5], secs: 25 },
      build: { hearts: [0.15, 1.1], secs: 35 },
      peak: { hearts: [0.1, 1.0], secs: 35 },
      elite: { hearts: [0.15, 1.2], secs: 35 },
    },
    /**
     * The fitted profile, and the one the difficulty targets are now written
     * against. Set from the measured run at the raised ramp (30 seeds, rule
     * arm): release 0.34, build 0.90, peak 1.10, elite 1.60 hearts, with room
     * to move either way. The floors are the point — the failure this pass
     * exists to catch is a room that costs nothing.
     */
    player: {
      release: { hearts: [0.15, 0.8], secs: 30 },
      build: { hearts: [0.5, 1.5], secs: 40 },
      peak: { hearts: [0.6, 1.8], secs: 40 },
      elite: { hearts: [0.9, 2.4], secs: 45 },
    },
    average: {
      release: { hearts: [0.1, 0.9], secs: 30 },
      build: { hearts: [0.4, 1.8], secs: 40 },
      peak: { hearts: [0.3, 1.7], secs: 40 },
      elite: { hearts: [0.7, 2.6], secs: 45 },
    },
    novice: {
      release: { hearts: [0.3, 2.2], secs: 75 },
      build: { hearts: [0.2, 2.4], secs: 75 },
      peak: { hearts: [0.1, 2.0], secs: 65 },
      elite: { hearts: [0, 4.5], secs: 95 },
    },
  };
  for (const [band, e] of [...byTension].sort()) {
    const t = target[profile.name]?.[band];
    const hearts = e.clearedRooms > 0 ? e.clearedHearts / e.clearedRooms : 0;
    const secs = e.clearedRooms > 0 ? e.clearedMs / e.clearedRooms / 1000 : 0;
    const all = e.hearts / e.rooms;
    const verdict = !t || e.clearedRooms === 0 ? ""
      : hearts < t.hearts[0] ? `UNDER target ${t.hearts[0]} hearts`
      : hearts > t.hearts[1] ? `OVER target ${t.hearts[1]} hearts`
      : secs > t.secs ? `OVER target ${t.secs}s`
      : "in band";
    console.log(
      `  ${band.padEnd(8)} ${String(e.clearedRooms).padStart(3)}/${String(e.rooms).padEnd(3)} cleared  ` +
      `${hearts.toFixed(2)} hearts  ${secs.toFixed(0)}s  ` +
      `(${all.toFixed(2)} incl. ${e.failed} unfinished)  ${verdict}`,
    );
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

// The mana economy and the waves, across every fight above.
console.log(`\nmana: mean fill ${(100 * MANA.fillSum / Math.max(1, MANA.samples)).toFixed(0)}%, ` +
  `below the cheapest key ${(100 * MANA.starvedMs / Math.max(1, MANA.ms)).toFixed(1)}% of fight time, ` +
  `${MANA.refused}/${MANA.presses} ready presses refused for mana`);
// How each held spell was used (`SPELL_USE`): a key held and never pressed
// says nothing about the spell, and a run's outcome cannot tell the two apart.
if (SPELL_USE.size > 0) {
  console.log("spells held, by time on a key: casts a minute held, the sword's share of the damage in those rooms,"
    + " and alone on the staff (the opening rooms) the spell's own damage a second");
  for (const [id, u] of [...SPELL_USE].sort((a, b) => b[1].heldMs - a[1].heldMs).slice(0, 16))
    console.log(`  ${id.padEnd(15)} held ${(u.heldMs / 1000).toFixed(0).padStart(5)}s  ${(u.casts / (u.heldMs / 60000)).toFixed(0).padStart(3)} casts/min`
      + `  sword ${((100 * u.swordDamage) / Math.max(1, u.roomDamage)).toFixed(0).padStart(3)}%`
      + (u.soloMs > 0 ? `  alone ${(u.soloMs / 1000).toFixed(0)}s: ${(u.soloSpellDamage / (u.soloMs / 1000)).toFixed(1)} dps, `
        + `${(u.soloSpellDamage / Math.max(1, u.soloCasts)).toFixed(1)} a cast` : ""));
}
for (const [k, v] of WAVES) {
  const hist = new Map<number, number>();
  for (const n of v) hist.set(n, (hist.get(n) ?? 0) + 1);
  console.log(`waves in ${k} rooms: ${[...hist].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n}×${c}`).join(", ")}`);
}


// The fight-room floor, asserted (doc 005, `rampMinimum`).
if (THIN_ROOMS.length > 0) {
  console.log(`FAIL: ${THIN_ROOMS.length} fight rooms below the ramp's minimum roster`);
  for (const r of THIN_ROOMS.slice(0, 8)) console.log(`  ${r.seed} #${r.index}: ${r.spawned} bodies, minimum ${r.least}`);
  process.exitCode = 1;
} else {
  console.log("every combat and elite room met the ramp's minimum roster");
}

// How a run climbs: hearts and length by room index (doc 005, the ramp).
if (BY_INDEX.size > 0) {
  console.log("by room index: rooms, mean hearts, mean seconds, mean roster");
  for (const [i, e] of [...BY_INDEX].sort((a, b) => a[0] - b[0]))
    console.log(`  #${String(i).padStart(2)}  n=${String(e.rooms).padStart(3)}  ${(e.hearts / e.rooms).toFixed(2).padStart(5)} hearts  ${(e.ms / e.rooms / 1000).toFixed(0).padStart(3)}s  ${(e.bodies / e.rooms).toFixed(1).padStart(5)} bodies`);
}

/*
 * **The playtest table**, in the same units and the same shape the browser
 * exports from the debug panel (`playtest-log.ts`). This is the half of the
 * output a real log can be laid against: seconds, HP, and where the HP went.
 * Everything above it is measured in hearts and bands, which a person cannot
 * report about their own session.
 */
{
  const fights = playtest.filter((r) => r.type === "combat" || r.type === "elite" || r.type === "boss");
  if (fights.length > 0) {
    const by = new Map<number, RoomLog[]>();
    for (const r of fights) by.set(r.index, [...(by.get(r.index) ?? []), r]);
    console.log(`\nplaytest log, profile ${profile.name} (HP out of 60; the shape the debug panel exports):`);
    console.log("  room   n   seconds   HP lost   ranged  melee  hazard   kills  level  dashes  casts  swings  near-bullet");
    for (const [i, xs] of [...by].sort((a, b) => a[0] - b[0])) {
      const mean = (f: (r: RoomLog) => number): number => xs.reduce((t, r) => t + f(r), 0) / xs.length;
      const fam = byFamily(xs);
      const total = fam.ranged + fam.melee + fam.hazard || 1;
      const pct = (v: number): string => `${((v / total) * 100).toFixed(0)}%`.padStart(6);
      console.log(
        `  #${String(i).padStart(2)}  ${String(xs.length).padStart(3)}  ${(mean((r) => r.ms) / 1000).toFixed(0).padStart(8)}  `
        + `${mean((r) => r.hpLost).toFixed(1).padStart(8)}  ${pct(fam.ranged)} ${pct(fam.melee)} ${pct(fam.hazard)}  `
        + `${mean((r) => r.kills).toFixed(1).padStart(6)}  ${mean((r) => r.level ?? 1).toFixed(1).padStart(5)}  `
        + `${mean((r) => r.dashes).toFixed(1).padStart(6)}  `
        + `${mean((r) => r.casts).toFixed(1).padStart(5)}  ${mean((r) => r.swings).toFixed(1).padStart(6)}  `
        + `${((100 * mean((r) => r.nearMs)) / Math.max(1, mean((r) => r.ms))).toFixed(0).padStart(10)}%`,
      );
    }
    const fam = byFamily(fights);
    const total = fam.ranged + fam.melee + fam.hazard || 1;
    console.log(
      `  all rooms: ${(fights.reduce((t, r) => t + r.hpLost, 0) / fights.length).toFixed(1)} HP a room, `
      + `ranged ${((100 * fam.ranged) / total).toFixed(0)}%  melee ${((100 * fam.melee) / total).toFixed(0)}%  `
      + `hazard ${((100 * fam.hazard) / total).toFixed(0)}%`,
    );
    /*
     * **What the player's hands were actually doing.** `spell-bench` models a
     * caster who is also swinging — the sword's refund is what pays for a
     * spell (`MANA_PER_HIT_FRACTION`) — and the rate it assumes has to be a
     * measured number rather than a guess, or the whole pool is levelled
     * against a player nobody plays. This is that number.
     */
    const secs = fights.reduce((t, r) => t + r.ms, 0) / 1000 || 1;
    const swings = fights.reduce((t, r) => t + r.swings, 0);
    const casts = fights.reduce((t, r) => t + r.casts, 0);
    console.log(
      `  hands: ${(swings / secs).toFixed(2)} swings a second, ${(casts / secs).toFixed(2)} casts a second, `
      + `over ${secs.toFixed(0)}s of fighting`,
    );
  }
}

// What awake bodies are doing with their time, by archetype; see `STATES`.
if (STATES.size > 0) {
  console.log("what an awake body is doing, by archetype (share of its awake time):");
  console.log(`  ${"archetype".padEnd(12)} ${STATE_KEYS.map((k) => k.padStart(10)).join("")}   idle`);
  let idleAll = 0;
  let allAll = 0;
  for (const [id, row] of [...STATES].sort()) {
    const total = STATE_KEYS.reduce((t, k) => t + (row[k] ?? 0), 0) || 1;
    // Neither attacking nor making a visible threat move.
    const idle = (row.wait_melee ?? 0) + (row.wait_fire ?? 0) + (row.silenced ?? 0) + (row.other ?? 0);
    idleAll += idle;
    allAll += total;
    console.log(`  ${id.padEnd(12)} ${STATE_KEYS.map((k) => `${((100 * (row[k] ?? 0)) / total).toFixed(0)}%`.padStart(10)).join("")}   ${((100 * idle) / total).toFixed(0)}%`);
  }
  console.log(`  ${"ALL".padEnd(12)} ${" ".repeat(10 * STATE_KEYS.length)}   ${((100 * idleAll) / Math.max(1, allAll)).toFixed(1)}%`);
}

// How the fight is spread over the room, not only how much of it there is.
if (VIEW.samples) {
  const pct = (n: number): string => `${((n / VIEW.samples) * 100).toFixed(1)}%`;
  console.log(
    `spread: ${(VIEW.inView / VIEW.samples).toFixed(2)} visible bodies in view on average, peak ${VIEW.peak};`
    + ` nothing in view ${pct(VIEW.empty)} of uncleared room time,`
    + ` more than six in view ${pct(VIEW.crowded)}`,
  );
  // What was keeping the fight off the screen, one cause per empty sample.
  console.log(
    `  nothing in view, by cause: behind cover ${pct(VIEW.occluded)}`
    + `  next station not found ${pct(VIEW.unfound)}`
    + `  waiting on a wave ${pct(VIEW.gate)}`
    + `  a wave walking in ${pct(VIEW.commute)}`
    + `  stragglers ${pct(VIEW.stragglers)}`
    + `  other ${pct(VIEW.other)}`,
  );
}

if (DENSITY.samples) console.log(
  `density: ${(DENSITY.bullets / DENSITY.samples).toFixed(1)} enemy bullets in the air on average, peak ${DENSITY.peakBullets},`
  + ` over 30 for ${((DENSITY.over30 / DENSITY.samples) * 100).toFixed(1)}% of the time; ${(DENSITY.attackers / DENSITY.samples).toFixed(2)} bodies attacking on average`,
);
