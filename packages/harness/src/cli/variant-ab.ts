/**
 * **How often does Jev want variant bodies?** The two variant questions on
 * the live model, read raw.
 *
 * Reported from play: the room readout said "declined: subspecies" on most
 * rooms, and variants were rare. This plans whole rooms — both rounds — for
 * a grid of players past room 3, where the ramp unlocks variants, and prints
 * what Jev answered to `subspecies_weight` and `subspecies` before code's
 * temperature touched it, beside what the room was then built with.
 *
 * Two Jev requests a room.
 *
 * Run: `pnpm variant-ab <out.json> [repeats]`
 */
import { writeFileSync } from "node:fs";
import {
  ITEMS, UNMEASURED, bucketClearSpeed, bucketGold, bucketHealth, bucketMovementPressure,
  bucketRecentDamage, bucketRunProgress, emptyHistory, heldDominantTags, plainInstance, runStaff,
  withTemperature, STYLE_START,
} from "@jr/core";
import type { Archetype, RunContext, Tension } from "@jr/core";
import { createDirector } from "@jr/director";
import type { Evaluator } from "@jr/director";
import { jevEvaluator } from "../play/jev.ts";

interface State {
  readonly name: string;
  readonly index: number;
  readonly style: Archetype;
  readonly hearts: number;
  readonly lost: number;
  readonly clearMs: number;
  readonly observed: Partial<NonNullable<RunContext["labels"]["observed"]>>;
}

const ROOMS = [3, 6, 9, 12];
const STATES: readonly State[] = ROOMS.flatMap((index, i) => {
  const style = (["spam", "nuke", "area", "melee"] as const)[i]!;
  return [
    { name: `room${index + 1}-${style}-cruising`, index, style, hearts: 6, lost: 0, clearMs: 18_000,
      observed: { damage_rate: "high", hurt_by: "nothing" } },
    { name: `room${index + 1}-${style}-steady`, index, style, hearts: 4, lost: 1, clearMs: 30_000,
      observed: { damage_rate: "fair", hurt_by: "shots" } },
  ];
});

function ctxFor(s: State): RunContext {
  const staff = runStaff();
  const slots = [plainInstance(STYLE_START[s.style]), plainInstance("magic_bolt"), plainInstance("spark_spray")];
  return {
    run_id: `var-${s.name}`, seed: `var-${s.name}`, room_index: s.index,
    labels: {
      health: bucketHealth(s.hearts), recent_damage: bucketRecentDamage(s.lost),
      clear_speed: bucketClearSpeed(s.clearMs, 30_000), movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(s.index), gold: bucketGold(40),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "on_plan" },
      build_shape: "formed",
      observed: { ...UNMEASURED, ...s.observed },
    },
    staff, slots, inventory: [],
    history: {
      ...emptyHistory(),
      rooms: Array(s.index).fill("combat"), tensions: Array(s.index).fill("build") as Tension[],
      hearts_lost: Array(s.index).fill(s.lost),
    },
    intent: { preset: s.style },
  };
}

const out = process.argv[2];
if (!out) throw new Error("usage: variant-ab <out.json> [repeats]");
const repeats = Number(process.argv[3] ?? 2);
const { evaluate: inner, ledger } = jevEvaluator({ budget: STATES.length * repeats * 2 + 4 });

type Dist = Record<string, number>;
let seen: { weight?: Dist; which?: Dist } = {};
const evaluate: Evaluator = async (req) => {
  const res = await inner(req);
  const w = res.answers["subspecies_weight"]?.probabilities;
  const s = res.answers["subspecies"]?.probabilities;
  if (w) seen.weight = w;
  if (s) seen.which = s;
  return res;
};

/** What the game draws from, as `pickProfile` does: escape removed, then the encounter temperature. */
function drawn(d: Dist): Dist {
  const kept = Object.fromEntries(Object.entries(d).filter(([k]) => k !== "fallback"));
  const total = Object.values(kept).reduce((a, b) => a + b, 0) || 1;
  return withTemperature(Object.fromEntries(Object.entries(kept).map(([k, v]) => [k, v / total])), 0.4);
}

interface Row { weight?: Dist; which?: Dist; built: string[]; builtWeight: string }
const results: Record<string, Row[]> = {};
const f = (x: number | undefined) => (x ?? 0).toFixed(2);
for (const s of STATES) {
  results[s.name] = [];
  for (let r = 0; r < repeats; r++) {
    seen = {};
    const ctx = ctxFor(s);
    const director = createDirector("jev", { evaluate, state_format: "briefing" });
    const plan = await director.planRoom(ctx, { room_index: s.index, door_slot: 0, room_type: "combat" }, "build");
    const enc = plan.plan.encounter;
    const row: Row = {
      ...(seen.weight ? { weight: seen.weight } : {}), ...(seen.which ? { which: seen.which } : {}),
      built: [...(enc?.profile.subspecies ?? [])], builtWeight: enc?.profile.subspecies_weight ?? "—",
    };
    results[s.name]!.push(row);
    const w = seen.weight;
    const g = w ? drawn(w) : undefined;
    console.log(`${s.name.padEnd(24)} weight raw none ${f(w?.["none"])} some ${f(w?.["some"])} many ${f(w?.["many"])}`
      + ` esc ${f(w?.["fallback"])} | drawn none ${f(g?.["none"])}`
      + ` | which esc ${f(seen.which?.["fallback"])} | built ${row.builtWeight} [${row.built.join(",")}]`);
  }
}
const rows = Object.values(results).flat();
const declined = rows.filter((r) => (r.which?.["fallback"] ?? 0) > 0.5).length;
const withVariants = rows.filter((r) => r.built.length > 0).length;
const meanNone = rows.reduce((a, r) => a + (r.weight?.["none"] ?? 0), 0) / Math.max(1, rows.length);
const meanDrawnNone = rows.reduce((a, r) => a + (r.weight ? drawn(r.weight)["none"] ?? 0 : 0), 0) / Math.max(1, rows.length);
console.log(`ALL rooms ${rows.length}: weight none raw ${meanNone.toFixed(2)}, drawn ${meanDrawnNone.toFixed(2)}; `
  + `"which" declined ${declined}; built with variants ${withVariants}`);
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`Jev calls: ${ledger.calls}, failed ${ledger.failures}, refused ${ledger.refused}`);
