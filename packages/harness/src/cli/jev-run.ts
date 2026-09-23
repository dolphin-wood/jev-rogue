/**
 * Runs of the reference player with the Jev arm, on a hard call budget (task 12).
 *
 * Every request is logged as a JSON line (state, questions, answers or the
 * error — never the key) so a bad answer can be read after the fact without
 * paying for it again. Past the budget the Director answers from the rule
 * table, so a run always finishes.
 *
 * Run: `node --env-file=.env.local --experimental-strip-types packages/harness/src/cli/jev-run.ts <seeds> <budget> [log]`
 *   (`pnpm jev-run <seeds> <budget>`)
 */
import { playRun } from "../play/run.ts";
import { jevEvaluator } from "../play/jev.ts";

const seeds = Number(process.argv[2] ?? 1);
const budget = Number(process.argv[3] ?? 4);
const logFile = process.argv[4] ?? `${process.env["TMPDIR"] ?? "/tmp"}/jev-run.jsonl`;

const { evaluate, ledger } = jevEvaluator({ budget, logFile });
const answered = new Map<string, number>();
const fellBack = new Map<string, number>();

let survived = 0;
for (let i = 0; i < seeds; i++) {
  const out = await playRun(`seed-${i}`, "jev", "spam", {
    evaluate,
    observe: (r) => {
      const key = `${r.meta.purpose.split(":")[0]}#${r.meta.round}`;
      const into = r.source === "jev" ? answered : fellBack;
      into.set(`${key} ${r.fallback_path ?? ""}`.trim(), (into.get(`${key} ${r.fallback_path ?? ""}`.trim()) ?? 0) + 1);
    },
  });
  if (out.survived) survived++;
  const boss = out.rooms.find((r) => r.type === "boss");
  console.log(`seed-${i}: ${out.survived ? "survived" : "died"} after ${out.rooms.length} rooms` +
    `${boss ? `, boss ${boss.cleared ? "beaten" : "not beaten"}` : ""}` +
    `${out.atBoss ? `; at the boss ${out.atBoss.spells.map((s) => `${s.id}@${s.level}${s.affixes.length ? `[${s.affixes.join(",")}]` : ""}`).join(" ")}, hearts ${out.atBoss.hearts.toFixed(1)}` : ""}`);
}

const lat = [...ledger.latencies].sort((a, b) => a - b);
const q = (p: number) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : 0;
console.log(`\n${survived}/${seeds} survived`);
console.log(`Jev calls: ${ledger.calls} sent (budget ${budget}), ${ledger.failures} failed, ${ledger.refused} refused past the budget`);
console.log(`latency: p50 ${q(0.5)} ms, p90 ${q(0.9)} ms, max ${lat.at(-1) ?? 0} ms; input tokens ${ledger.inputTokens}`);
console.log(`answered by Jev: ${[...answered].map(([k, n]) => `${k} ×${n}`).join(", ") || "none"}`);
console.log(`answered by the rule table: ${[...fellBack].map(([k, n]) => `${k} ×${n}`).join(", ") || "none"}`);
console.log(`log: ${logFile}`);
