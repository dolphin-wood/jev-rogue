/**
 * Reference runs on one Director arm, with the metrics doc 011 compares arms
 * on, and a hard call budget (task 12).
 *
 * Every Jev request is logged as a JSON line (state, questions, answers or the
 * error — never the key) so a bad answer can be read after the fact without
 * paying for it again. Past the budget the Director answers from the rule
 * table, so a run always finishes.
 *
 * The **arm** is an argument, and the rule arm costs nothing, so the control
 * and the subject are measured by the same code over the same seeds rather
 * than by two readouts that happen to print similar words. What it reports,
 * per doc 011: hearts lost per band against doc 005's targets, room variety,
 * style adherence, the fallback rate, and the answer distribution of every
 * question — the last of which is how a degenerate question is caught, since a
 * question that always answers the same way is invisible in every other number
 * here.
 *
 * Run: `pnpm jev-run <seeds> <budget> [arm] [log] [intent-free-text]`
 *   (the rule and random arms ignore the budget and make no request)
 */
import { ITEMS, SCHOOL_OF, STAT_UPGRADES, STYLE_SCHOOLS } from "@jr/core";
import type { Archetype, Distribution } from "@jr/core";
import type { DirectorArm } from "@jr/director";
import { playRun } from "../play/run.ts";
import type { RunOutcome } from "../play/run.ts";
import { jevEvaluator } from "../play/jev.ts";

const seeds = Number(process.argv[2] ?? 1);
const budget = Number(process.argv[3] ?? 4);
const arm = (process.argv[4] ?? "jev") as DirectorArm;
const logFile = process.argv[5] ?? `${process.env["TMPDIR"] ?? "/tmp"}/jev-run.jsonl`;
const preset: Archetype = "spam";
/** The player's typed intent, so style adherence can be measured against words. */
const freeText = process.argv[6];

/** Doc 005's per-band ceilings: hearts lost, and seconds, in a cleared room. */
const BAND_TARGET: Readonly<Record<string, readonly [number, number]>> = {
  release: [1, 45], build: [2, 60], peak: [3, 75], elite: [4, 90],
};

const ledgerOf = arm === "jev"
  ? jevEvaluator({ budget, logFile })
  : { evaluate: undefined, ledger: { calls: 0, refused: 0, failures: 0, rateLimited: 0, retried: 0, latencies: [] as number[], inputTokens: 0 } };

/** Requests by arm that answered them, so the fallback rate is per request. */
const answered = new Map<string, number>();
const fellBack = new Map<string, number>();
/**
 * Every question's top option per request. A distribution's argmax is not the
 * answer that was sampled, but it is what the arm *wanted*, and a question
 * whose argmax never moves across a whole run is a question that is not
 * reading the state whatever the sampler does with it.
 */
const wanted = new Map<string, Map<string, number>>();
/**
 * The mass on the top option, averaged over the requests. Without it the table
 * above cannot tell a question that is genuinely sure of one answer from one
 * whose distribution is nearly flat and whose argmax is therefore whichever
 * option the tie broke toward — two very different faults with the same
 * printout.
 */
const topMass = new Map<string, number[]>();

function topOf(dist: Distribution): { choice: string; mass: number } | null {
  let best: string | null = null;
  let mass = -1;
  for (const [k, v] of Object.entries(dist)) if (v > mass) { mass = v; best = k; }
  return best === null ? null : { choice: best, mass };
}

const runs: RunOutcome[] = [];
for (let i = 0; i < seeds; i++) {
  const out = await playRun(`seed-${i}`, arm, preset, {
    ...(ledgerOf.evaluate ? { evaluate: ledgerOf.evaluate } : {}),
    observe: (r) => {
      const key = `${r.meta.purpose.split(":")[0]}#${r.meta.round}`;
      const path = `${key} ${r.fallback_path ?? ""}`.trim();
      const into = r.source === "jev" || arm !== "jev" ? answered : fellBack;
      into.set(path, (into.get(path) ?? 0) + 1);
      for (const [name, dist] of Object.entries(r.dists)) {
        const top = topOf(dist);
        if (!top) continue;
        const q = name.replace(/^zone_.*/, "zone_*").replace(/^.*__/, "");
        const tally = wanted.get(q) ?? new Map<string, number>();
        tally.set(top.choice, (tally.get(top.choice) ?? 0) + 1);
        wanted.set(q, tally);
        topMass.set(q, [...(topMass.get(q) ?? []), top.mass]);
      }
    },
  }, freeText);
  runs.push(out);
  const boss = out.rooms.find((r) => r.type === "boss");
  console.log(`seed-${i}: ${out.survived ? "survived" : "died"} after ${out.rooms.length} rooms` +
    `${boss ? `, boss ${boss.cleared ? "beaten" : "not beaten"}` : ""}` +
    `${out.atBoss ? `; at the boss ${out.atBoss.spells.map((s) => `${s.id}@${s.level}${s.affixes.length ? `[${s.affixes.join(",")}]` : ""}`).join(" ")}, hearts ${out.atBoss.hearts.toFixed(1)}` : ""}`);
}

/* ------------------------------ the metrics ------------------------------- */

const combat = runs.flatMap((r) => r.rooms.filter((x) => x.type === "combat" || x.type === "elite"));
const cleared = combat.filter((r) => r.cleared);
const survived = runs.filter((r) => r.survived).length;

console.log(`\n=== ${arm} arm, ${seeds} seeds, intent ${preset}${freeText ? ` "${freeText}"` : ""} ===`);
console.log(`survived ${survived}/${seeds}; ${cleared.length}/${combat.length} combat rooms cleared`);

console.log("\nhearts lost per band, cleared rooms only (doc 005 targets):");
const bands = new Map<string, { n: number; hearts: number; ms: number }>();
for (const r of cleared) {
  const band = r.type === "elite" ? "elite" : r.tension;
  const e = bands.get(band) ?? { n: 0, hearts: 0, ms: 0 };
  e.n++; e.hearts += r.heartsLost; e.ms += r.ms;
  bands.set(band, e);
}
for (const [band, e] of [...bands].sort()) {
  const t = BAND_TARGET[band];
  const hearts = e.hearts / e.n;
  const secs = e.ms / e.n / 1000;
  console.log(
    `  ${band.padEnd(8)} n=${String(e.n).padStart(3)}  ${hearts.toFixed(2)} hearts  ${secs.toFixed(0)}s  ` +
    `${t ? (hearts <= t[0] + 0.5 && secs <= t[1] ? "in band" : `OVER ${t[0]} hearts / ${t[1]}s`) : ""}`,
  );
}

/*
 * Variety is a count of *distinct* things the run built, not a spread: a
 * Director that answers one space for every room scores the same on hearts as
 * one that answers twelve, and only this number tells them apart.
 */
const distinct = (xs: readonly string[]) => new Set(xs).size;
const shapes = combat.flatMap((r) => (r.shape ? [`${r.shape.density}/${r.shape.waves}`] : []));
console.log("\nroom variety, over every combat room:");
console.log(`  spaces ${distinct(combat.map((r) => r.space))} of 12 used` +
  `, most common ${share(combat.map((r) => r.space))}`);
console.log(`  encounter shapes ${distinct(shapes)} of 9 used, most common ${share(shapes)}`);

/*
 * **The arc**, which per-room averages cannot show. A Director that answers
 * every room correctly on its own can still produce three peaks running or
 * five builds with no breather, and the run reads as noise. Measured per run,
 * because a sequence only means anything inside one.
 */
let backToBackPeaks = 0;
let peaks = 0;
let releaseAfterHurt = 0;
let hurtRooms = 0;
const gaps: number[] = [];
for (const run of runs) {
  const fights = run.rooms.filter((r) => r.type === "combat" || r.type === "elite");
  let sinceRelease = 0;
  for (const [i, r] of fights.entries()) {
    if (r.tension === "peak") {
      peaks++;
      if (fights[i - 1]?.tension === "peak") backToBackPeaks++;
    }
    // "Hurt" as the summarizer sees it: two hearts or more off in this room.
    if (fights[i - 1] && fights[i - 1]!.heartsLost >= 2) {
      hurtRooms++;
      if (r.tension === "release") releaseAfterHurt++;
    }
    if (r.tension === "release") { gaps.push(sinceRelease); sinceRelease = 0; } else sinceRelease++;
  }
  gaps.push(sinceRelease);
}
const longestGap = gaps.length ? Math.max(...gaps) : 0;
console.log(`\narc: ${peaks} peaks, ${backToBackPeaks} back to back` +
  `; release after a room that cost 2+ hearts ${releaseAfterHurt}/${hurtRooms}` +
  `; longest run of fights with no release ${longestGap}`);

/*
 * Style adherence: the share of cards the player actually took that belong to
 * the intent's schools, or carry its tag. The Director does not choose the
 * pick, but it chooses the offer, so a run whose offers never held the style
 * cannot score here however the player picks.
 */
const styleSchools = new Set<string>(STYLE_SCHOOLS[preset] ?? []);
// A room records what was taken by its display label ("Magic Bolt"), which is
// the id title-cased; reading it back is how this stays out of `run.ts`.
const idOf = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
const taken = runs.flatMap((r) => r.rooms.flatMap((x) => (x.reward && x.reward !== "gold" ? [idOf(x.reward)] : [])));
/** Which stat families read as each build style; doc 007's `STAT_STYLE`. */
const STAT_STYLE: Readonly<Record<string, readonly string[]>> = {
  spam: ["mana"], nuke: ["mana"], area: ["movement"], dot: ["movement"], melee: ["sword"],
};
const statFamily = new Map(STAT_UPGRADES.map((u) => [u.id, u.family]));
const known = taken.filter((id) => id in SCHOOL_OF || ITEMS.has(id) || statFamily.has(id));
const onStyle = known.filter((id) => {
  const school = (SCHOOL_OF as Record<string, string>)[id];
  if (school) return styleSchools.has(school);
  const family = statFamily.get(id);
  if (family) return STAT_STYLE[preset]?.includes(family) ?? false;
  return ITEMS.get(id)?.tags.includes(preset) ?? false;
});
console.log(`\nstyle adherence: ${onStyle.length}/${known.length} cards taken were ${preset}` +
  `${known.length ? ` (${((onStyle.length / known.length) * 100).toFixed(0)}%)` : ""}` +
  `; ${taken.length - known.length} of ${taken.length} not resolvable to content`);

/*
 * The degeneracy table. One line per question: how many requests asked it, how
 * many different options it ever wanted, and the share of the most wanted one.
 * A question at 100% is answering a constant, whatever the state said.
 */
console.log("\nwhat each question wanted, by request (top share of 100% is a question ignoring the state):");
for (const [q, tally] of [...wanted].sort((a, b) => total(b[1]) - total(a[1]))) {
  const n = total(tally);
  const sorted = [...tally].sort((a, b) => b[1] - a[1]);
  const top = sorted[0]!;
  const masses = topMass.get(q) ?? [];
  const mean = masses.length ? masses.reduce((a, b) => a + b, 0) / masses.length : 0;
  console.log(
    `  ${q.padEnd(18)} n=${String(n).padStart(3)}  ${String(sorted.length).padStart(2)} distinct  ` +
    `top ${((top[1] / n) * 100).toFixed(0)}%  mass ${(mean * 100).toFixed(0)}%  ` +
    `${sorted.slice(0, 5).map(([k, v]) => `${k}:${v}`).join(" ")}`,
  );
}

function total(m: Map<string, number>): number {
  let t = 0;
  for (const v of m.values()) t += v;
  return t;
}

function share(xs: readonly string[]): string {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  const top = [...m].sort((a, b) => b[1] - a[1])[0];
  return top ? `${top[0]} ${((top[1] / xs.length) * 100).toFixed(0)}%` : "none";
}

/* ------------------------------ the arm itself ----------------------------- */

const requestsMade = [...answered.values()].reduce((a, b) => a + b, 0)
  + [...fellBack.values()].reduce((a, b) => a + b, 0);
const fallbacks = [...fellBack.values()].reduce((a, b) => a + b, 0);
console.log(`\nfallback rate: ${fallbacks}/${requestsMade} requests` +
  `${requestsMade ? ` (${((fallbacks / requestsMade) * 100).toFixed(0)}%)` : ""}`);
console.log(`answered by ${arm}: ${[...answered].map(([k, n]) => `${k} ×${n}`).join(", ") || "none"}`);
console.log(`answered by the rule table: ${[...fellBack].map(([k, n]) => `${k} ×${n}`).join(", ") || "none"}`);

if (arm === "jev") {
  const { ledger } = ledgerOf;
  const lat = [...ledger.latencies].sort((a, b) => a - b);
  const q = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : 0);
  console.log(`\nJev calls: ${ledger.calls} sent (budget ${budget}), ${ledger.failures} failed, ${ledger.refused} refused past the budget`);
  console.log(`rate limits: ${ledger.rateLimited} attempts throttled, ${ledger.retried} evaluations a retry rescued`);
  console.log(`latency: p50 ${q(0.5)} ms, p90 ${q(0.9)} ms, max ${lat.at(-1) ?? 0} ms; input tokens ${ledger.inputTokens}`);
  console.log(`log: ${logFile}`);
}
