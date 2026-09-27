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
/** A per-card fit is raised to 4, 3 or 2 by the same answer (`FIT_SHARPNESS`). */
const FIT_TEMPERATURE: Readonly<Record<string, number>> = { low: 1 / 4, medium: 1 / 3, high: 1 / 2 };
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
/** What each run's reward screens actually showed, for the per-run readout. */
const screens: { style: Archetype; cards: string[] }[] = [];

const ledgerOf = arm === "jev" ? jevEvaluator({ budget, logFile }) : null;
for (let i = 0; i < seeds; i++) {
  const preset = styles[i % styles.length]!;
  const out = await playRun(`seed-${i}`, arm, preset, {
    ...(ledgerOf ? { evaluate: ledgerOf.evaluate } : {}),
    state_format: "briefing",
    observe: (r) => {
      /*
       * One offer per prefix that carries a `variety`: either the three blended
       * choice axes (`overall`, `for_style`, `for_needs`) or one Noul per card
       * (`fit_<id>`), drawn as `cardAsk` draws each.
       */
      for (const name of Object.keys(r.dists)) {
        const m = /^(.*?)variety$/.exec(name);
        if (!m) continue;
        const prefix = m[1]!;
        const variety = r.dists[name] ?? { medium: 1 };
        let fit: Distribution;
        let temperature: Readonly<Record<string, number>>;
        const overall = r.dists[`${prefix}overall`];
        if (overall) {
          fit = blend(overall, r.dists[`${prefix}for_style`] ?? {}, r.dists[`${prefix}for_needs`] ?? {}, STYLE_WEIGHT);
          temperature = VARIETY_TEMPERATURE;
        } else {
          const yes = Object.entries(r.dists).flatMap(([k, d]) =>
            k.startsWith(`${prefix}fit_`) ? [[k.slice(prefix.length + 4), d["yes"] ?? 0] as const] : []);
          const total = yes.reduce((a, [, v]) => a + v, 0);
          if (yes.length === 0) continue;
          fit = Object.fromEntries(yes.map(([id, v]) => [id, total > 0 ? v / total : 1 / yes.length]));
          temperature = FIT_TEMPERATURE;
        }
        const ids = Object.keys(fit);
        const kind: Kind | null = ids.every((id) => SPELL_IDS.has(id)) ? "spell"
          : ids.every((id) => AFFIX_IDS.has(id)) ? "affix" : null;
        if (!kind || ids.length <= SAMPLED) continue;
        offers[kind]++;
        poolSizes[kind].push(ids.length);
        const raw = overall ?? fit;
        const top = Object.entries(raw).sort((a, b) => b[1] - a[1])[0]![0];
        for (const id of ids) {
          const t = tally(kind, id);
          t.candidate++;
          t.overallRel += (raw[id] ?? 0) * ids.length;
          if (id === top) t.topOverall++;
        }
        const tempered = Object.fromEntries(Object.entries(temperature)
          .map(([v, temp]) => [v, withTemperature(fit, temp)]));
        const hits = new Map<string, number>();
        for (let n = 0; n < TRIALS; n++) {
          const v = sampleOne(variety, mc);
          for (const id of sampleWithoutReplacement(tempered[v]!, SAMPLED, mc)) hits.set(id, (hits.get(id) ?? 0) + 1);
        }
        for (const [id, h] of hits) tally(kind, id).exposure += h / TRIALS;
      }
    },
  });
  screens.push({
    style: preset,
    cards: out.rooms.flatMap((room) => room.route.cards.map((c) => c.replace(/@\d+$/, ""))),
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
/*
 * **What a player sees**, per run: the draw above leaves out code's own spread
 * (the repeat penalty, the wildcard, the unshown card), and a run is where the
 * complaint "the same cards every time" is made.
 */
console.log("\n=== per run, on the reward screens ===");
const mean = (xs: readonly number[]) => (xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(1);
const top5 = (xs: readonly string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.values()].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
};
const jaccard = (a: readonly string[], b: readonly string[]) => {
  const A = new Set(a); const B = new Set(b);
  return [...A].filter((x) => B.has(x)).length / Math.max(1, new Set([...A, ...B]).size);
};
for (const kind of ["spell", "affix"] as const) {
  const ids = kind === "spell" ? SPELL_IDS : AFFIX_IDS;
  const per = screens.map((r) => ({ style: r.style, cards: r.cards.filter((c) => ids.has(c)) }));
  const pairs = ARCHETYPES.map((st) => per.filter((r) => r.style === st)).filter((p) => p.length >= 2);
  const overlap = pairs.map((p) => jaccard(p[0]!.cards, p[1]!.cards));
  console.log(`${kind}: ${mean(per.map((r) => r.cards.length))} cards a run, ${mean(per.map((r) => new Set(r.cards).size))} distinct,` +
    ` top five ${(per.reduce((a, r) => a + top5(r.cards), 0) / Math.max(1, per.length) * 100).toFixed(0)}% of them;` +
    ` two runs of one style share ${overlap.length ? mean(overlap.map((x) => x * 100)) : "-"}% of what they saw;` +
    ` ${new Set(per.flatMap((r) => r.cards)).size}/${ids.size} ever shown`);
}
for (const st of styles) {
  const own = [...ITEMS.values()].filter((i) => i.tags.includes(st)).map((i) => i.id);
  const seen = new Set(screens.filter((r) => r.style === st).flatMap((r) => r.cards));
  const never = own.filter((id) => !seen.has(id));
  console.log(`  ${st.padEnd(6)} its own spells on a screen: ${own.length - never.length}/${own.length}${never.length ? `; never ${never.join(", ")}` : ""}`);
}

if (ledgerOf) console.log(`\nJev calls ${ledgerOf.ledger.calls}, failures ${ledgerOf.ledger.failures}, refused ${ledgerOf.ledger.refused}; log ${logFile}`);
