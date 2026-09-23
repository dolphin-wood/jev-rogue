import { playRun, HURT_BY, MELEE_HITS, MANA, WAVES } from "../play/run.ts";
import type { DirectorArm } from "@jr/director";

const arm = (process.argv[2] ?? "rule") as DirectorArm;
const seeds = Number(process.argv[3] ?? 1);

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
/** Every cleared combat room's length, for the distribution doc 014 sizes the run against. */
const combatMs: number[] = [];
let combatZeroDamage = 0;
const boss = { rooms: 0, cleared: 0, hearts: 0, ms: 0, died: 0, timedOut: 0 };
/** The builds runs reached the boss with, and whether they won there (task 10). */
const builds: { won: boolean; keys: number; levels: number; affixes: number; stats: number; hearts: number; line: string }[] = [];
/** How the fights were built, so a short room can be traced to its shape rather than guessed at. */
const shapes = new Map<string, { rooms: number; roster: number; ms: number; hearts: number }>();
/** The rooms that cost the most, individually: an average hides a room that takes six hearts in thirty seconds. */
const worst: { seed: string; index: number; type: string; space: string; tension: string; shape: string; hearts: number; ms: number; kills: number }[] = [];

for (let i = 0; i < seeds; i++) {
  const out = await playRun(`seed-${i}`, arm);
  if (out.survived) survived++;
  if (out.atBoss) {
    const b = out.atBoss;
    const won = out.rooms.some((r) => r.type === "boss" && r.cleared);
    builds.push({
      won, keys: b.spells.length,
      levels: b.spells.reduce((t, x) => t + x.level, 0),
      affixes: b.spells.reduce((t, x) => t + x.affixes.length, 0),
      stats: b.stats, hearts: b.hearts,
      line: `${b.spells.map((x) => `${x.id}@${x.level}${x.affixes.length ? `[${x.affixes.join(",")}]` : ""}`).join(" ")}  stats ${b.stats}  hearts ${b.hearts.toFixed(1)}`,
    });
  }
  depths.push(out.rooms.length);
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
    for (const b of lost) console.log(`      lost with ${b.line}`);
  }
  if (boss.rooms > 0) {
    // Doc 003: two to three minutes, one to two hearts.
    console.log(
      `  boss: ${boss.cleared}/${boss.rooms} beaten, ${boss.died} deaths, ${boss.timedOut} timeouts, ` +
      `mean ${(boss.ms / boss.rooms / 1000).toFixed(0)}s, ${(boss.hearts / boss.rooms).toFixed(2)} hearts lost`,
    );
  }
  // Doc 005's calibration targets, per band.
  const target: Record<string, [number, number]> = {
    release: [1, 45], build: [2, 60], peak: [3, 75], elite: [4, 90],
  };
  for (const [band, e] of [...byTension].sort()) {
    const t = target[band];
    const hearts = e.clearedRooms > 0 ? e.clearedHearts / e.clearedRooms : 0;
    const secs = e.clearedRooms > 0 ? e.clearedMs / e.clearedRooms / 1000 : 0;
    const all = e.hearts / e.rooms;
    const ok = t ? hearts <= t[0] + 0.5 && secs <= t[1] : true;
    console.log(
      `  ${band.padEnd(8)} ${String(e.clearedRooms).padStart(3)}/${String(e.rooms).padEnd(3)} cleared  ` +
      `${hearts.toFixed(2)} hearts  ${secs.toFixed(0)}s  ` +
      `(${all.toFixed(2)} incl. ${e.failed} unfinished)  ` +
      `${t ? (ok ? "in band" : `OVER target ${t[0]} hearts / ${t[1]}s`) : ""}`,
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
for (const [k, v] of WAVES) {
  const hist = new Map<number, number>();
  for (const n of v) hist.set(n, (hist.get(n) ?? 0) + 1);
  console.log(`waves in ${k} rooms: ${[...hist].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n}×${c}`).join(", ")}`);
}

