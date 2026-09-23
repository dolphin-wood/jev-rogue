/**
 * Does the Jev arm adapt? (task 12)
 *
 * The reference player is strong — it clears fast and keeps its health — so
 * a harness run only ever shows Jev one kind of player. This plans the same
 * late room for two contrasting players, a strong one and one who is behind
 * (hurt, slow, heavy recent damage), and prints what each arm chose and how
 * sure it was, side by side with the rule table.
 *
 * Six Jev requests: the doors, and the room's two rounds, for each player.
 *
 * Run: `pnpm jev-probe`
 */
import {
  ITEMS, RngSource, bucketClearSpeed, bucketGold, bucketHealth, bucketMovementPressure,
  bucketRecentDamage, bucketRunProgress, emptyHistory, plainInstance, portalChoices,
  runStaff, simulateStaff,
} from "@jr/core";
import type { RunContext } from "@jr/core";
import { createDirector } from "@jr/director";
import type { Decision, Director } from "@jr/director";
import { jevEvaluator } from "../play/jev.ts";

const INDEX = 9;

function player(name: string, hearts: number, clearMs: number, lostRecent: number, gold: number): RunContext {
  const staff = runStaff();
  const slots = [plainInstance("magic_bolt"), plainInstance("spark_spray"), null];
  const sim = simulateStaff(staff, slots, ITEMS);
  return {
    run_id: `probe-${name}`, seed: "probe", room_index: INDEX,
    labels: {
      health: bucketHealth(hearts),
      recent_damage: bucketRecentDamage(lostRecent),
      clear_speed: bucketClearSpeed(clearMs, 30_000),
      movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(INDEX),
      gold: bucketGold(gold),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: {
        archetype: sim.archetype, bottleneck: sim.bottleneck, mana_sustain: sim.mana_sustain, range: "mid",
        missing_roles: sim.missing_roles, dominant_tags: sim.dominant_tags,
      },
      preference: { dominant: sim.dominant_tags.slice(0, 3), consistency: "on_plan" },
    },
    staff, slots, inventory: [], history: emptyHistory(), intent: { preset: "spam" },
  };
}

const players = [player("strong", 6, 14_000, 0, 20), player("behind", 2, 75_000, 3, 20)];
const SHOWN = [
  "next_tension", "portal_kinds", "elite_portal", "elite_grade", "normal_grade", "npc_room",
  "space", "composition", "density", "wave_structure", "anchor", "entry",
];

async function plan(director: Director, ctx: RunContext): Promise<Map<string, Decision>> {
  const out = new Map<string, Decision>();
  const doors = await director.planDoors(ctx);
  for (const d of doors.decisions) out.set(d.question ?? "?", d);
  const tension = doors.tension;
  const portals = portalChoices(
    { roomIndex: INDEX, lastWasElite: false, critical: ctx.labels.health === "critical", style: "spam" },
    new RngSource("probe").stream("portal-count"), 3,
  );
  const room = await director.planRoom(ctx, { room_index: INDEX, door_slot: 0, room_type: "combat" }, tension, { portals, cards: [] });
  for (const d of room.decisions) out.set(d.question ?? "?", d);
  for (const d of room.offer?.portals?.decisions ?? []) out.set(d.question ?? "?", d);
  return out;
}

const { evaluate, ledger } = jevEvaluator({ budget: 6 });
const show = (d: Decision | undefined) => {
  if (!d) return "—";
  const top = Object.entries(d.probabilities).sort((a, b) => b[1] - a[1])[0];
  return `${d.choice}${top ? ` (${top[0]} ${Math.round(top[1] * 100)}%)` : ""}${d.source === "jev" ? "" : ` [${d.source}]`}`;
};

for (const ctx of players) {
  const rule = await plan(createDirector("rule"), ctx);
  const jev = await plan(createDirector("jev", { evaluate }), ctx);
  const l = ctx.labels;
  console.log(`\n${ctx.run_id}: health ${l.health}, recent damage ${l.recent_damage}, clears ${l.clear_speed}, gold ${l.gold}`);
  console.log(`${"question".padEnd(16)}${"rule".padEnd(46)}jev`);
  for (const q of SHOWN) {
    if (!rule.has(q) && !jev.has(q)) continue;
    console.log(`${q.padEnd(16)}${show(rule.get(q)).padEnd(46)}${show(jev.get(q))}`);
  }
}
console.log(`\nJev calls: ${ledger.calls}, failed ${ledger.failures}; input tokens ${ledger.inputTokens}`);
