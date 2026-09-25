/**
 * Does the Jev arm adapt? (task 12)
 *
 * The reference player is strong — it clears fast and keeps its health — so
 * a harness run only ever shows Jev one kind of player. This plans the same
 * late room for two contrasting players, a strong one and one who is behind
 * (hurt, slow, heavy recent damage), and prints what each arm chose and how
 * sure it was, side by side with the rule table.
 *
 * Two Jev requests a player, the room's two rounds; `planDoors` asks nothing.
 *
 * Run: `pnpm jev-probe`
 */
import {
  ITEMS, RngSource, bucketClearSpeed, bucketGold, bucketHealth, bucketMovementPressure,
  bucketRecentDamage, bucketRunProgress, cardPool, emptyHistory, gapOf, heldDominantTags, plainInstance,
  portalChoices, runStaff,
} from "@jr/core";
import type { RoomType, RunContext, Tension } from "@jr/core";
import { createDirector } from "@jr/director";
import type { Decision, Director } from "@jr/director";
import { jevEvaluator } from "../play/jev.ts";

/*
 * Room 7, not 9: the pacing cap is `build_allowed` at 9, so `next_tension`
 * would be asked over two options and could never show a peak. The probe is
 * meant to exercise the decision, not the cap around it.
 */
const INDEX = 7;

/**
 * The typed intent both players carry. The affix lane (doc 007) is the one
 * question the player can answer in words, so the probe has to send words:
 * without them `typed_intent` is `none` and the question is only being asked
 * half.
 */
const FREE_TEXT = "I want to freeze things and shatter them";

function player(
  name: string, hearts: number, clearMs: number, lostRecent: number, gold: number,
  /** A short history, so the recent-history labels are something other than `none`. */
  past: { tensions: Tension[]; rooms: RoomType[]; hearts_lost?: number[] },
  /** How much of a build there is yet (doc 007) — what the offer reads. */
  buildShape: "raw" | "forming" | "formed" = "forming",
): RunContext {
  const staff = runStaff();
  const slots = [plainInstance("magic_bolt"), plainInstance("spark_spray"), null];
  return {
    // Each player seeds its own streams. Sharing one seed made both players
    // draw the same uniform, so an unlucky sample showed up twice and read as
    // a decision rather than as one draw.
    run_id: `probe-${name}`, seed: `probe-${name}`, room_index: INDEX,
    labels: {
      health: bucketHealth(hearts),
      recent_damage: bucketRecentDamage(lostRecent),
      clear_speed: bucketClearSpeed(clearMs, 30_000),
      movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(INDEX),
      gold: bucketGold(gold),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "on_plan" },
      build_shape: buildShape,
    },
    staff, slots, inventory: [], history: { ...emptyHistory(), ...past },
    intent: { preset: "spam", free_text: FREE_TEXT },
  };
}

/*
 * The struggling player has lost two hearts recently, not three. At `heavy`
 * recent damage doc 003 owes them a rest, which caps the run at `release_only`
 * and takes `next_tension` off the request entirely — so the probe would be
 * measuring the cap rather than the Director. Low health and slow clears still
 * say plainly that this player is behind.
 */
/*
 * The histories matter as much as the health. `strong` has had two builds, so
 * a peak is both legal and due; `behind` has just had a peak, which takes
 * `peak` off the option list entirely (`tensionsAfter`) and should draw a
 * release out of what is left.
 */
/* The first pair varies how the run has *gone*. */
const HISTORY = { tensions: ["build", "build"] as Tension[], rooms: ["combat", "combat"] as RoomType[], hearts_lost: [1, 1] };
/*
 * The second pair varies only **how complete the build is**, which is what the
 * portal question is grounded on (doc 007): the same health, the same clear
 * speed, the same gold, and a staff that is either two empty keys or a full
 * one. If `portal_kinds` and `elite_kind` do not move between those two, the
 * grounding is not being read.
 */
const players = [
  player("strong", 6, 14_000, 0, 80, HISTORY),
  player("behind", 2, 75_000, 2, 80, { tensions: ["peak"], rooms: ["combat"], hearts_lost: [1, 3] }),
  player("shape-raw", 5, 30_000, 1, 80, HISTORY, "raw"),
  player("shape-formed", 5, 30_000, 1, 80, HISTORY, "formed"),
];
/**
 * Every question the two players share, so a question that does not move
 * between them shows up beside the ones that do. Leaving a question out of
 * this list is how a degenerate answer stays invisible.
 */
const SHOWN = [
  "next_tension",
  "space", "symmetry", "size", "mood_temperature", "mood_brightness", "mood_particles",
  "composition", "density", "wave_structure", "anchor", "entry",
  "portal_kinds", "spell_school", "stat_family", "elite_portal", "elite_kind", "elite_grade",
  "normal_grade", "npc_room", "affix_intent",
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
  // An affix offer rides along, because `affix_intent` is only asked with one.
  const affixes = cardPool(ITEMS, [], "affix", [{ shape: "bolt", count: 1, affixes: [] }], {}, {
    style: ctx.intent.preset, revealed: ctx.labels.preference.dominant,
    gap: gapOf(ctx.labels.observed),
  });
  const room = await director.planRoom(
    ctx, { room_index: INDEX, door_slot: 0, room_type: "combat" }, tension,
    { portals, cards: [{ room_index: INDEX, pool: affixes, count: 3, pity: false, temptation: false }] },
  );
  for (const d of room.decisions) out.set(d.question ?? "?", d);
  for (const d of room.offer?.portals?.decisions ?? []) out.set(d.question ?? "?", d);
  for (const c of room.offer?.cards ?? []) for (const d of c.decisions) out.set(d.question ?? "?", d);
  return out;
}

/**
 * Logged like a run's requests are, because the readout below can only show
 * what was sampled: `Decision.confidence` is null by the time a plan carries
 * it, and confidence and the mass left on the escape option are exactly what
 * say whether a question is grounded. Reading them off the log afterwards
 * costs nothing; asking again costs money.
 */
const logFile = process.argv[2] ?? `${process.env["TMPDIR"] ?? "/tmp"}/jev-probe.jsonl`;
const { evaluate, ledger } = jevEvaluator({ budget: 16, logFile });
const show = (d: Decision | undefined) => {
  if (!d) return "—";
  const top = Object.entries(d.probabilities).sort((a, b) => b[1] - a[1])[0];
  return `${d.choice}${top ? ` (${top[0]} ${Math.round(top[1] * 100)}%)` : ""}${d.source === "jev" ? "" : ` [${d.source}]`}`;
};

for (const ctx of players) {
  const rule = await plan(createDirector("rule"), ctx);
  const jev = await plan(createDirector("jev", { evaluate }), ctx);
  const l = ctx.labels;
  console.log(`\n${ctx.run_id}: health ${l.health}, recent damage ${l.recent_damage}, clears ${l.clear_speed}, `
    + `gold ${l.gold}, build shape ${l.build_shape}`);
  console.log(`${"question".padEnd(16)}${"rule".padEnd(46)}jev`);
  for (const q of SHOWN) {
    if (!rule.has(q) && !jev.has(q)) continue;
    console.log(`${q.padEnd(16)}${show(rule.get(q)).padEnd(46)}${show(jev.get(q))}`);
  }
}
console.log(`\nJev calls: ${ledger.calls}, failed ${ledger.failures}; input tokens ${ledger.inputTokens}`);
console.log(`log: ${logFile}`);
