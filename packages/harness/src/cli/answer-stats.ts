/**
 * **What each question actually answered**, over a log of real Jev requests.
 *
 * `route-review` says what the player saw; this says what the Director was
 * asked and what came back. It exists because a question can be answered the
 * same way every single time and still look fine from the route: `symmetry`,
 * `mood_temperature`, `mood_brightness` and `mood_particles` were each 100%
 * one answer over two runs, which is four requests' worth of tokens spent on
 * a constant.
 *
 * Reads the JSON-lines log `jevEvaluator` writes (`logFile`), so it costs
 * nothing to run and can be pointed at a log taken before a change and one
 * taken after.
 *
 * Run: `pnpm answer-stats <log.jsonl> [question-prefix ...]`
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: pnpm answer-stats <log.jsonl> [question ...]");
  process.exit(1);
}
const wanted = process.argv.slice(3);

interface Entry {
  answers?: Record<string, { choice?: string; probabilities?: Record<string, number>; confidence?: number | null }>;
}

/** Per question: how often each option was chosen, and the mean confidence. */
const picks = new Map<string, Map<string, number>>();
const confidence = new Map<string, number[]>();
/**
 * **How often the question was declined**, which the modal column cannot show.
 *
 * Choosing the escape option, or putting more than half the mass on it, hands
 * that one question to the rule table (doc 002) — so a question answered
 * confidently four times in five and declined the fifth is a question that is
 * a rule-table question a fifth of the time, and the route looks fine either
 * way. `stat_family` sat at about 19% on the live model with nothing in the
 * route to show for it.
 */
const declines = new Map<string, number>();
const escapeMass = new Map<string, number[]>();
/** Every log's totals, for the one line a format is compared on. */
let answered = 0;
let declinedAll = 0;

for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let entry: Entry;
  try { entry = JSON.parse(line) as Entry; } catch { continue; }
  for (const [name, answer] of Object.entries(entry.answers ?? {})) {
    // A shelf's questions are scoped by a prefix; they are the same question.
    const q = name.includes("__") ? name.slice(name.indexOf("__") + 2) : name;
    if (wanted.length > 0 && !wanted.some((w) => q.startsWith(w))) continue;
    const choice = answer.choice ?? topOf(answer.probabilities);
    if (!choice) continue;
    const escape = answer.probabilities?.["fallback"] ?? 0;
    escapeMass.set(q, [...(escapeMass.get(q) ?? []), escape]);
    answered++;
    if (choice === "fallback" || escape > 0.5) {
      declines.set(q, (declines.get(q) ?? 0) + 1);
      declinedAll++;
    }
    const seen = picks.get(q) ?? new Map<string, number>();
    seen.set(choice, (seen.get(choice) ?? 0) + 1);
    picks.set(q, seen);
    if (typeof answer.confidence === "number")
      confidence.set(q, [...(confidence.get(q) ?? []), answer.confidence]);
  }
}

function topOf(p: Record<string, number> | undefined): string | null {
  if (!p) return null;
  return Object.entries(p).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const rows = [...picks].sort((a, b) => a[0].localeCompare(b[0]));
for (const [question, seen] of rows) {
  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  const conf = confidence.get(question) ?? [];
  const mean = conf.length > 0 ? conf.reduce((a, b) => a + b, 0) / conf.length : null;
  const top = [...seen].sort((a, b) => b[1] - a[1]);
  // The share of the modal answer: 100% is a question that is not a question.
  const modal = (100 * (top[0]?.[1] ?? 0)) / total;
  const declined = declines.get(question) ?? 0;
  const escape = escapeMass.get(question) ?? [];
  const meanEscape = escape.length ? escape.reduce((a, b) => a + b, 0) / escape.length : 0;
  console.log(
    `${question.padEnd(24)} n=${String(total).padStart(4)}  modal ${modal.toFixed(0).padStart(3)}%`
    + (mean === null ? "" : `  conf ${mean.toFixed(2)}`)
    + `  declined ${((100 * declined) / total).toFixed(0).padStart(3)}%`
    + `  escape ${meanEscape.toFixed(2)}`
    + `  ${top.map(([k, n]) => `${k} ${((100 * n) / total).toFixed(0)}%`).join("  ")}`,
  );
}
if (rows.length === 0) console.log("no answers in the log");
else console.log(`\nover the whole log: ${answered} answers, ${declinedAll} declined `
  + `(${((100 * declinedAll) / Math.max(1, answered)).toFixed(1)}%)`);
