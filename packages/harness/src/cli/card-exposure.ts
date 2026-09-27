/**
 * **How often each spell and affix reaches a reward screen**, per arm.
 *
 * Reported from play: in the Jev arm some spells and affixes seem never to
 * come up. The degeneracy table in `jev-run` reads a question's argmax, which
 * cannot show a tail — a card that is always a candidate and never drawn is
 * invisible there. This reads the tail directly.
 *
 * For every card request it records the candidates and the three card
 * distributions, and replays the Director's own draw (`cardAsk`: blend,
 * variety temperature, two sampled without replacement) many times, so each
 * card gets an **expected exposure per offer it was a candidate in**, set
 * against the uniform draw's 2/n. The repeat penalty and the wildcard slot are
 * left out on purpose: they are code's, the same on every arm, and what is
 * being measured is what the arm itself wants.
 *
 * It also counts what actually reached the screen in the played run.
 *
 * Styles rotate over the seeds (`JEV_STYLE=all`, the default), so a card that
 * is rare because it belongs to no style being played is told apart from one
 * that is rare everywhere.
 *
 * Run: `pnpm card-exposure <seeds> <budget> [arm] [log]`
 *   `JR_ROOMS=<n>` shortens each run; `JEV_STYLE=<style>` fixes the style.
 */
import { ARCHETYPES, ITEMS, SPELL_AFFIXES, RngSource, sampleOne, sampleWithoutReplacement, withTemperature } from "@jr/core";
import type { Archetype, Distribution } from "@jr/core";
import type { DirectorArm } from "@jr/director";
import { playRun } from "../play/run.ts";
import { jevEvaluator } from "../play/jev.ts";

const seeds = Number(process.argv[2] ?? 5);
const budget = Number(process.argv[3] ?? 200);
const arm = (process.argv[4] ?? "jev") as DirectorArm;
const logFile = process.argv[5] ?? `${process.env["TMPDIR"] ?? "/tmp"}/card-exposure-${arm}.jsonl`;
const styleEnv = process.env["JEV_STYLE"] ?? "all";
const styles: readonly Archetype[] = styleEnv === "all" ? ARCHETYPES : [styleEnv as Archetype];

const SPELL_IDS = new Set([...ITEMS.keys()]);
const AFFIX_IDS = new Set(SPELL_AFFIXES.map((a) => a.id));
type Kind = "spell" | "affix";

/** Mirrors `director.ts`: the same constants the offer is drawn with. */
const VARIETY_TEMPERATURE: Readonly<Record<string, number>> = { low: 0.4, medium: 0.7, high: 1.0 };
const STYLE_WEIGHT = 0.25;
const SAMPLED = 2;
const TRIALS = 2000;

interface Tally { candidate: number; exposure: number; overallRel: number; shown: number; topOverall: number }
const tallies: Record<Kind, Map<string, Tally>> = { spell: new Map(), affix: new Map() };
const offers: Record<Kind, number> = { spell: 0, affix: 0 };
const poolSizes: Record<Kind, number[]> = { spell: [], affix: [] };
const tally = (k: Kind, id: string) => {
  const t = tallies[k].get(id) ?? { candidate: 0, exposure: 0, overallRel: 0, shown: 0, topOverall: 0 };
  tallies[k].set(id, t);
  return t;
};

function blend(o: Distribution, s: Distribution, n: Distribution, w: number): Distribution {
  const keys = new Set([...Object.keys(o), ...Object.keys(s), ...Object.keys(n)]);
  const out: Record<string, number> = {};
  let total = 0;
  for (const k of keys) {
    const v = 0.5 * (o[k] ?? 0) + 0.5 * w * (s[k] ?? 0) + 0.5 * (1 - w) * (n[k] ?? 0);
    out[k] = v; total += v;
  }
  for (const k of keys) out[k] = total > 0 ? out[k]! / total : 1 / keys.size;
  return out;
}

const mc = new RngSource("card-exposure").stream("mc", 0, null);

const ledgerOf = arm === "jev" ? jevEvaluator({ budget, logFile }) : null;
for (let i = 0; i < seeds; i++) {
  const preset = styles[i % styles.length]!;
  const out = await playRun(`seed-${i}`, arm, preset, {
    ...(ledgerOf ? { evaluate: ledgerOf.evaluate } : {}),
    state_format: "briefing",
    observe: (r) => {
      for (const [name, overall] of Object.entries(r.dists)) {
        const m = /^(.*?)overall$/.exec(name);
        if (!m) continue;
        const prefix = m[1]!;
        const ids = Object.keys(overall);
        const kind: Kind | null = ids.every((id) => SPELL_IDS.has(id)) ? "spell"
          : ids.every((id) => AFFIX_IDS.has(id)) ? "affix" : null;
        if (!kind || ids.length <= SAMPLED) continue;
        offers[kind]++;
        poolSizes[kind].push(ids.length);
        const blended = blend(overall, r.dists[`${prefix}for_style`] ?? {}, r.dists[`${prefix}for_needs`] ?? {}, STYLE_WEIGHT);
        const variety = r.dists[`${prefix}variety`] ?? { medium: 1 };
        const top = Object.entries(overall).sort((a, b) => b[1] - a[1])[0]![0];
        for (const id of ids) {
          const t = tally(kind, id);
          t.candidate++;
          t.overallRel += (overall[id] ?? 0) * ids.length;
          if (id === top) t.topOverall++;
        }
        const tempered = Object.fromEntries(Object.entries(VARIETY_TEMPERATURE)
          .map(([v, temp]) => [v, withTemperature(blended, temp)]));
        const hits = new Map<string, number>();
        for (let n = 0; n < TRIALS; n++) {
          const v = sampleOne(variety, mc);
          for (const id of sampleWithoutReplacement(tempered[v]!, SAMPLED, mc)) hits.set(id, (hits.get(id) ?? 0) + 1);
        }
        for (const [id, h] of hits) tally(kind, id).exposure += h / TRIALS;
      }
    },
  });
  for (const room of out.rooms) for (const c of room.route.cards) {
    const id = c.replace(/@\d+$/, "");
    if (SPELL_IDS.has(id)) tally("spell", id).shown++;
    else if (AFFIX_IDS.has(id)) tally("affix", id).shown++;
  }
  console.error(`seed-${i} (${preset}): ${out.rooms.length} rooms${ledgerOf ? `, ${ledgerOf.ledger.calls} calls so far` : ""}`);
}

for (const kind of ["spell", "affix"] as const) {
  const all = kind === "spell" ? [...SPELL_IDS] : [...AFFIX_IDS];
  const sizes = poolSizes[kind];
  const meanN = sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length);
  const rows = all.map((id) => {
    const t = tallies[kind].get(id) ?? { candidate: 0, exposure: 0, overallRel: 0, shown: 0, topOverall: 0 };
    // Exposure per offer it could have appeared in, against the uniform draw's.
    const rate = t.candidate ? t.exposure / t.candidate : 0;
    const uniform = SAMPLED / meanN;
    return { id, ...t, rate, ratio: rate / uniform, rel: t.candidate ? t.overallRel / t.candidate : 0 };
  }).sort((a, b) => a.ratio - b.ratio);
  console.log(`\n=== ${arm}: ${kind} offers ${offers[kind]}, mean pool ${meanN.toFixed(1)}, uniform exposure ${(SAMPLED / meanN * 100).toFixed(1)}% ===`);
  console.log(`${"id".padEnd(20)} cand  exp/offer  vs-uniform  overall-p×n  top  shown`);
  for (const r of rows)
    console.log(`${r.id.padEnd(20)} ${String(r.candidate).padStart(4)}  ${(r.rate * 100).toFixed(1).padStart(8)}%  ${r.ratio.toFixed(2).padStart(9)}  ${r.rel.toFixed(2).padStart(11)}  ${String(r.topOverall).padStart(3)}  ${String(r.shown).padStart(5)}`);
  // Concentration: share of total exposure held by the top quarter of cards.
  const exp = rows.map((r) => r.exposure).sort((a, b) => b - a);
  const total = exp.reduce((a, b) => a + b, 0);
  const q = Math.ceil(exp.length / 4);
  console.log(`top ${q} of ${exp.length} ${kind}s hold ${((exp.slice(0, q).reduce((a, b) => a + b, 0) / Math.max(1e-9, total)) * 100).toFixed(0)}% of exposure;` +
    ` ${rows.filter((r) => r.ratio < 0.25).length} below a quarter of uniform`);
}
if (ledgerOf) console.log(`\nJev calls ${ledgerOf.ledger.calls}, failures ${ledgerOf.ledger.failures}, refused ${ledgerOf.ledger.refused}; log ${logFile}`);
