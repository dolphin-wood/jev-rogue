/**
 * **Does the door question read the player's own words?** An A/B on the live
 * model, over the question `portal_need` alone.
 *
 * Reported from play: a player typed 想要更快的攻击速度 ("I want faster
 * attacks") and the first room's doors held no stat door. Run this once on
 * the text before a change and once after, on the same states, and compare
 * the mass each arm puts on each door kind. The controls — no words, and a
 * mid-run player with nothing short — are there to catch the stat door
 * turning into the answer to every state (finding 1).
 *
 * One Jev request per state per repeat, the portals asked alone.
 *
 * Run: `pnpm door-intent-ab <out.json> [repeats]`
 */
import { writeFileSync } from "node:fs";
import {
  ITEMS, RngSource, UNMEASURED, bucketClearSpeed, bucketGold, bucketHealth, bucketMovementPressure,
  bucketRecentDamage, bucketRunProgress, emptyHistory, heldDominantTags, plainInstance, portalChoices,
  runStaff, STYLE_START,
} from "@jr/core";
import type { RunContext } from "@jr/core";
import { createDirector } from "@jr/director";
import type { Evaluator } from "@jr/director";
import { jevEvaluator } from "../play/jev.ts";

interface State {
  readonly name: string;
  readonly index: number;
  readonly words?: string;
  /** Keys held beyond the starter, which is what "an empty key" is about. */
  readonly extra: readonly string[];
  readonly observed?: Partial<NonNullable<RunContext["labels"]["observed"]>>;
  /** The style picked at the start; Barrage when left out. */
  readonly style?: "spam" | "melee";
}

const STATES: readonly State[] = [
  { name: "room1-zh-faster", index: 0, words: "想要更快的攻击速度", extra: [] },
  { name: "room1-en-faster", index: 0, words: "I want to attack faster", extra: [] },
  { name: "room1-no-words", index: 0, extra: [] },
  /*
   * The same sentence from a Blade player, for whom "attack" is the swing —
   * which a stat door does raise (`swift_hand`). From a Barrage player it is
   * the cast, which no stat raises, so a spell door is a fair reading of it.
   */
  { name: "room1-blade-zh-faster", index: 0, words: "想要更快的攻击速度", extra: [], style: "melee" },
  { name: "room1-blade-no-words", index: 0, extra: [], style: "melee" },
  {
    name: "room5-no-words-comfortable", index: 5, extra: ["spark_spray"],
    observed: { mana_refused: "never", damage_rate: "fair", hurt_by: "nothing" },
  },
];

function ctxFor(s: State): RunContext {
  const staff = runStaff();
  const held = [plainInstance(STYLE_START[s.style ?? "spam"]), ...s.extra.map((b) => plainInstance(b))];
  const slots = [0, 1, 2].map((i) => held[i] ?? null);
  return {
    run_id: `ab-${s.name}`, seed: `ab-${s.name}`, room_index: s.index,
    labels: {
      health: bucketHealth(6), recent_damage: bucketRecentDamage(0),
      clear_speed: bucketClearSpeed(30_000, 30_000), movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(s.index), gold: bucketGold(20),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "on_plan" },
      build_shape: s.extra.length ? "forming" : "raw",
      ...(s.observed ? { observed: { ...UNMEASURED, ...s.observed } } : {}),
    },
    staff, slots, inventory: [],
    history: {
      ...emptyHistory(),
      rooms: Array(s.index).fill("combat"), tensions: Array(s.index).fill("build"),
      hearts_lost: Array(s.index).fill(0),
    },
    intent: { preset: s.style ?? "spam", ...(s.words ? { free_text: s.words } : {}) },
  };
}

const out = process.argv[2];
if (!out) throw new Error("usage: door-intent-ab <out.json> [repeats]");
const repeats = Number(process.argv[3] ?? 3);
const { evaluate: inner, ledger } = jevEvaluator({
  budget: STATES.length * repeats + 4, ...(process.env["AB_LOG"] ? { logFile: process.env["AB_LOG"] } : {}),
});

/** The raw answer to `portal_need`, before code's temperature and filters touch it. */
let last: Record<string, number> | null = null;
const evaluate: Evaluator = async (req) => {
  // `AB_DUMP=1` prints the request instead of sending it: free, for reading what Jev reads.
  if (process.env["AB_DUMP"]) {
    console.log(JSON.stringify({ state: req.state, questions: req.questions }, null, 2));
    throw new Error("dumped");
  }
  const res = await inner(req);
  last = res.answers["portal_need"]?.probabilities ?? null;
  return res;
};

const results: Record<string, Record<string, number>[]> = {};
// `AB_ONLY=<regex>` runs the matching states alone, so adding a state does not re-buy the rest.
const only = process.env["AB_ONLY"] ? new RegExp(process.env["AB_ONLY"]) : null;
for (const s of STATES.filter((x) => !only || only.test(x.name))) {
  results[s.name] = [];
  for (let r = 0; r < repeats; r++) {
    last = null;
    const ctx = ctxFor(s);
    const director = createDirector("jev", { evaluate, state_format: "briefing" });
    // Three doors, no vendor, no elite: the kinds alone.
    const choices = { ...portalChoices(
      { roomIndex: s.index, lastWasElite: false, critical: false, style: s.style ?? "spam" },
      new RngSource(`ab-${s.name}-${r}`).stream("portal-count"), 3,
    ), npcKinds: [], elite: false };
    await director.planOffer(ctx, { portals: choices, cards: [] });
    if (last) results[s.name]!.push(last);
    else console.log(`${s.name} #${r}: no Jev answer (fell to the rule table)`);
  }
  const runs = results[s.name]!;
  const mean = (k: string) => runs.reduce((a, p) => a + (p[k] ?? 0), 0) / Math.max(1, runs.length);
  console.log(`${s.name.padEnd(28)} n=${runs.length}  `
    + ["spell", "affix", "stat", "gold", "fallback"].map((k) => `${k} ${mean(k).toFixed(2)}`).join("  "));
}
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`Jev calls: ${ledger.calls}, failed ${ledger.failures}, refused ${ledger.refused}`);
