/**
 * **Does Jev read what the player typed, with nothing turning it into a label?**
 * On the live model, two questions:
 *
 * - `AB_SET=opening` (the default): the run's first room's reward kind
 *   (`opening_reward`), asked as the scene asks it — beside the cards for every
 *   kind — over typed sentences in three languages that ask for a stat, a spell
 *   or an affix, and the five styles with nothing typed as the control.
 * - `AB_SET=lane`: the affix lane (`affix_intent`) on a build whose measured
 *   facts point elsewhere — a tight bar and shots that miss, the state in which
 *   a typed sentence once lost to two matching labels — now that the keyword
 *   table that read the sentence for Jev is gone.
 * - `AB_SET=variety`: the first room again, read for the cards' `variety`
 *   rather than the room's kind. Nothing has been kept in the first room, so
 *   the count of off-style picks the question reads is empty, and a sentence
 *   that named one thing to build toward came back declined.
 *
 * Every set also reports the cards' `variety` answers beside its own
 * question: their mean, how many Jev declined, and, where a state says how
 * wide its words ask the offer to be, how often the top answer agrees.
 *
 * The sentences are not written into any question, option or instruction:
 * they are held out, and a change made to pass this should hold for sentences
 * that are not on the list. Add new ones rather than tuning to these.
 *
 * One Jev request per state per repeat.
 *
 * Run: `pnpm words-ab <out.json> [repeats]`
 */
import { writeFileSync } from "node:fs";
import {
  CARDS_PER_OFFER, ITEMS, OPENING_CARD_KINDS, OPENING_SALT, REWARD_KINDS, STYLE_START, UNMEASURED,
  bucketClearSpeed, bucketGold, bucketHealth, bucketMovementPressure, bucketRecentDamage, bucketRunProgress,
  cardNeedsFor, cardPool, emptyHistory, heldDominantTags, heldSpell, plainInstance, portalChoices, RngSource, runStaff,
} from "@jr/core";
import type { Archetype, RunContext } from "@jr/core";
import { createDirector } from "@jr/director";
import type { CardRequest, Evaluator } from "@jr/director";
import { jevEvaluator } from "../play/jev.ts";

interface State {
  readonly name: string;
  readonly style: Archetype;
  readonly words?: string;
  /** What the words ask for, by a person's reading; printed beside the answer, never sent. */
  readonly expect?: string;
  /**
   * How wide the words ask the first offer to be, by a person's reading:
   * `narrow` (one thing named to build toward: `variety` low) or `wide`
   * (asking to try many things: medium or high). Never sent.
   */
  readonly breadth?: "narrow" | "wide";
  /**
   * Spells the player has kept, oldest first: the state is then room 4's
   * spell offer, not the first room, for checking that what the variety
   * question says about the first room leaves a kept count read as before.
   */
  readonly kept?: readonly string[];
}

const OPENING_STATES: readonly State[] = [
  { name: "ja-sword-faster", style: "spam", words: "剣を素早く振りたい", expect: "stat" },
  { name: "ja-sword-faster-blade", style: "melee", words: "剣を素早く振りたい", expect: "stat" },
  { name: "en-sword-harder", style: "area", words: "I want my sword to hit harder", expect: "stat" },
  { name: "en-sword-faster", style: "spam", words: "I want to swing my sword faster", expect: "stat" },
  { name: "zh-sword-faster", style: "spam", words: "想让剑挥得更快", expect: "stat" },
  { name: "ja-sword-harder", style: "spam", words: "剣でもっと強く斬りたい", expect: "stat" },
  { name: "zh-tougher", style: "dot", words: "我老是被打死，想更耐打一点", expect: "stat" },
  { name: "ja-more-spells", style: "melee", words: "魔法をいろいろ使ってみたい", expect: "spell" },
  { name: "en-more-spells", style: "spam", words: "give me more spells to play with", expect: "spell" },
  { name: "en-freeze", style: "spam", words: "I want to freeze things and shatter them", expect: "affix" },
  { name: "zh-chain", style: "dot", words: "想让法术在敌人之间连锁弹跳", expect: "affix" },
  ...(["spam", "nuke", "area", "dot", "melee"] as const).map((style) => ({ name: `${style}-no-words`, style })),
  /*
   * **Held out**: written before the opening instruction was rewritten
   * against the sentences above, and never looked at while it was. Read
   * these first when judging a change to it.
   */
  { name: "heldout-ja-dash", style: "spam", words: "もっと動き回りたい、ダッシュを多用したい", expect: "stat" },
  { name: "heldout-en-mana", style: "nuke", words: "I always run out of mana", expect: "stat" },
  { name: "heldout-ja-new-magic", style: "melee", words: "新しい魔法を覚えたい", expect: "spell" },
  { name: "heldout-en-bounce", style: "spam", words: "I want my spell to bounce off the walls", expect: "affix" },
  { name: "heldout-ja-sturdy", style: "area", words: "攻撃を受けても倒れにくくなりたい", expect: "stat" },
  { name: "heldout-zh-new-spell", style: "dot", words: "想多学几个新法术", expect: "spell" },
  /* Held out of the doors' reading (`NEED_READING`), written after it was changed and before it was measured. */
  { name: "heldout2-ja-dodge", style: "dot", words: "敵の攻撃をかわしながら戦いたい", expect: "stat" },
  { name: "heldout2-en-dash", style: "nuke", words: "I'd like to dash around a lot more", expect: "stat" },
  { name: "heldout2-ja-chain", style: "area", words: "呪文を連鎖させたい", expect: "affix" },
  { name: "heldout2-zh-more-spells", style: "melee", words: "我想多带几个法术", expect: "spell" },
];

/*
 * **One meaning, several Japanese wordings** (`AB_SET=paraphrase`), on the
 * first room's question: whether a weak answer is the request or the wording.
 */
const PARAPHRASE_STATES: readonly State[] = [
  "剣を素早く振りたい", "剣をすばやく振りたい", "剣をもっと速く振りたい", "剣の振りを速くしたい",
  "剣の攻撃速度を上げたい", "攻撃速度を上げたい", "素早く斬りたい", "剣の手数を増やしたい",
].map((words, i) => ({ name: `ja-${i}`, style: "melee" as const, words, expect: "stat" }));

/*
 * **Playstyles, held out** (`AB_SET=playstyle`): sentences that say how the
 * player wants to play rather than ask for a reward, written before the first
 * room's instruction was changed to read them and never used to tune it. A
 * third of them want a spell and a third an affix, so a change that only
 * opened the way from "a playstyle" to the stat door shows up as those turning.
 */
const PLAYSTYLE_STATES: readonly State[] = [
  { name: "ps-ja-run-around", style: "spam", words: "走り回りながら戦いたい", expect: "stat" },
  { name: "ps-en-dodge", style: "nuke", words: "I want to dodge everything", expect: "stat" },
  { name: "ps-zh-sword-only", style: "melee", words: "想一直用剑砍，不太想放法术", expect: "stat" },
  { name: "ps-en-tank", style: "area", words: "I like to stand my ground and soak up hits", expect: "stat" },
  { name: "ps-ja-ranged-magic", style: "melee", words: "遠くから魔法で戦いたい", expect: "spell" },
  { name: "ps-en-summons", style: "spam", words: "I like summoning things to fight for me", expect: "spell" },
  { name: "ps-zh-many-spells", style: "dot", words: "喜欢用很多不同的法术", expect: "spell" },
  { name: "ps-ja-summon", style: "nuke", words: "召喚して戦いたい", expect: "spell" },
  { name: "ps-en-bounce", style: "melee", words: "I want my spells to bounce between enemies", expect: "affix" },
  { name: "ps-ja-poison", style: "spam", words: "魔法に毒を付けたい", expect: "affix" },
  { name: "ps-zh-burn", style: "nuke", words: "想让我的法术都带火", expect: "affix" },
  { name: "ps-en-pierce", style: "area", words: "I want my shots to go through a whole line of them", expect: "affix" },
];

/*
 * **How wide the first offer is drawn** (`AB_SET=variety`). The first is the
 * sentence that was reported declined; the rest were written before the
 * variety question was changed to read typed words, and never used to tune it.
 */
const VARIETY_STATES: readonly State[] = [
  { name: "reported-ja-thunder", style: "spam", words: "雷系の呪文を使いたい", breadth: "narrow" },
  { name: "heldout-ja-fire-only", style: "nuke", words: "炎の魔法だけで戦いたい", breadth: "narrow" },
  { name: "heldout-en-poison", style: "area", words: "I want to build around poison", breadth: "narrow" },
  { name: "heldout-zh-ice", style: "dot", words: "想用冰冻法术控场", breadth: "narrow" },
  { name: "heldout-en-meteor", style: "melee", words: "I want Meteor to be my main spell", breadth: "narrow" },
  { name: "heldout-ja-try-many", style: "spam", words: "いろんな呪文を試してみたい", breadth: "wide" },
  { name: "heldout-en-everything", style: "nuke", words: "I want to try a bit of everything", breadth: "wide" },
  { name: "heldout-zh-different", style: "area", words: "想每局都玩点不一样的", breadth: "wide" },
  { name: "heldout-en-weird", style: "dot", words: "surprise me with weird spells", breadth: "wide" },
  ...(["spam", "melee"] as const).map((style) => ({ name: `${style}-no-words`, style })),
  /* A kept count, read as finding 30 measured it: none off the style is narrow, two running wide. */
  { name: "kept-0-off", style: "spam", kept: ["magic_bolt", "ball_lightning", "mana_darts"], breadth: "narrow" },
  { name: "kept-2-off", style: "spam", kept: ["magic_bolt", "meteor", "toxic_cloud"], breadth: "wide" },
  { name: "kept-2-off-thunder", style: "spam", words: "雷系の呪文を使いたい", kept: ["magic_bolt", "meteor", "toxic_cloud"] },
];

const LANE_STATES: readonly State[] = [
  { name: "en-freeze", style: "spam", words: "I want to freeze things and shatter them", expect: "elemental" },
  { name: "ja-burn", style: "spam", words: "敵を全部燃やしたい", expect: "elemental" },
  { name: "zh-miss", style: "spam", words: "我的法术老是打不中", expect: "homing" },
  { name: "ja-one-big", style: "spam", words: "一発の重い魔法で仕留めたい", expect: "heavier" },
  { name: "en-swarmed", style: "spam", words: "there are always too many of them at once", expect: "wider" },
  { name: "zh-survive", style: "spam", words: "想活得久一点", expect: "survival" },
  { name: "no-words", style: "spam" },
];

/*
 * `AB_SET=doors`: the opening states again, but asking the doors out of the
 * first room (`portal_need`, three portals) — the ranking whose top three
 * become doors — for comparing with the room's own kind on the same words.
 */
const set = process.env["AB_SET"] === "lane" ? "lane" : process.env["AB_SET"] === "doors" ? "doors" : "opening";
const STATES = set === "lane" ? LANE_STATES
  : process.env["AB_SET"] === "paraphrase" ? PARAPHRASE_STATES
  : process.env["AB_SET"] === "playstyle" ? PLAYSTYLE_STATES
  : process.env["AB_SET"] === "variety" ? VARIETY_STATES : OPENING_STATES;
const QUESTION = set === "lane" ? "affix_intent" : set === "doors" ? "portal_need" : "opening_reward";

function ctxFor(s: State): RunContext {
  if (s.kept) return keptCtx(s, s.kept);
  const opening = set !== "lane";
  const index = opening ? 1 : 6;
  const held = opening ? [STYLE_START[s.style]] : [STYLE_START[s.style], "spark_spray"];
  const slots = [0, 1, 2].map((i) => (held[i] ? plainInstance(held[i]!) : null));
  return {
    run_id: `words-${s.name}`, seed: `words-${s.name}`, room_index: index,
    labels: {
      health: bucketHealth(6), recent_damage: bucketRecentDamage(0),
      clear_speed: bucketClearSpeed(30_000, 30_000), movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(index), gold: bucketGold(opening ? 0 : 20),
      tension_cap: "build_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "on_plan" },
      build_shape: opening ? "raw" : "forming",
      // The lane's adversarial build: a bar that refuses casts and shots that miss.
      ...(opening ? {} : { observed: { ...UNMEASURED, mana_refused: "often", hits_per_shot: "few", cast_rate: "slow" } }),
    },
    staff: runStaff(), slots, inventory: [],
    history: opening ? emptyHistory() : {
      ...emptyHistory(), rooms: Array(index - 1).fill("combat"), tensions: Array(index - 1).fill("build"),
      hearts_lost: Array(index - 1).fill(0),
    },
    intent: { preset: s.style, ...(s.words ? { free_text: s.words } : {}) },
  };
}

/** Room 4, one spell kept in each room before it and the newest two on the keys beside the starter. */
function keptCtx(s: State, kept: readonly string[]): RunContext {
  const index = kept.length + 1;
  const slots = [STYLE_START[s.style], ...kept.slice(-2)].map((id) => plainInstance(id));
  return {
    run_id: `words-${s.name}`, seed: `words-${s.name}`, room_index: index,
    labels: {
      health: bucketHealth(6), recent_damage: bucketRecentDamage(0),
      clear_speed: bucketClearSpeed(30_000, 30_000), movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(index), gold: bucketGold(20),
      tension_cap: "build_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "on_plan" },
      build_shape: "forming",
    },
    staff: runStaff(), slots, inventory: [],
    history: {
      ...emptyHistory(), rooms: Array(index - 1).fill("combat"), tensions: Array(index - 1).fill("build"),
      hearts_lost: Array(index - 1).fill(0),
      journal: kept.map((id, i) => ({ index: i + 1, type: "combat", picked: [id] })),
    },
    intent: { preset: s.style, ...(s.words ? { free_text: s.words } : {}) },
  };
}

function requestsFor(ctx: RunContext, s: State): CardRequest[] {
  const keys = ctx.slots.flatMap((x) => (x ? [{ base: x.base, affixes: [] }] : []));
  const held = keys.map((k) => heldSpell(ITEMS.get(k.base), []));
  const needs = cardNeedsFor(ctx.labels, s.style, keys, ITEMS, []);
  const promise = { grade: 1, style: s.style, salt: `words:${s.name}`, held: keys.map((k) => k.base) };
  const kinds = set === "lane" ? (["affix"] as const) : s.kept ? (["spell"] as const) : OPENING_CARD_KINDS;
  return kinds.map((k) => ({
    room_index: ctx.room_index, pool: cardPool(ITEMS, [], k, held, promise, needs),
    count: CARDS_PER_OFFER, pity: false, temptation: false,
    ...(set === "lane" || s.kept ? {} : { salt: `${OPENING_SALT}${k}` }),
  }));
}

const out = process.argv[2];
if (!out) throw new Error("usage: words-ab <out.json> [repeats]");
const repeats = Number(process.argv[3] ?? 3);
const only = process.env["AB_ONLY"] ? new RegExp(process.env["AB_ONLY"]) : null;
const states = STATES.filter((x) => !only || only.test(x.name));
const { evaluate: inner, ledger } = jevEvaluator({
  budget: states.length * repeats + 4, ...(process.env["AB_LOG"] ? { logFile: process.env["AB_LOG"] } : {}),
});

/** Jev's raw answer to the question under test, before code draws from it. */
let last: Record<string, number> | null = null;
/** Every card offer's `variety` answer in the last request, raw. */
let varieties: Record<string, number>[] = [];
/** Declined as the Jev source declines it: the escape chosen, or more than half on it. */
const isDeclined = (p: Record<string, number>, choice: unknown) => choice === "fallback" || (p["fallback"] ?? 0) > 0.5;
const evaluate: Evaluator = async (req) => {
  // `AB_DUMP=1` prints the request instead of sending it: free, for reading what Jev reads.
  if (process.env["AB_DUMP"]) {
    console.log(JSON.stringify({ state: req.state, questions: req.questions }, null, 2));
    throw new Error("dumped");
  }
  const res = await inner(req);
  last = res.answers[QUESTION]?.probabilities ?? null;
  varieties = Object.entries(res.answers).flatMap(([n, a]) =>
    n === "variety" || n.endsWith("__variety") ? [{ ...a.probabilities, ...(isDeclined(a.probabilities, a.choice) ? { declined: 1 } : {}) }] : []);
  return res;
};

const results: Record<string, Record<string, number>[]> = {};
const varietyResults: Record<string, Record<string, number>[]> = {};
const options = set === "lane"
  ? ["homing", "freecast", "elemental", "heavier", "wider", "survival"] : [...REWARD_KINDS];
for (const s of states) {
  results[s.name] = [];
  varietyResults[s.name] = [];
  for (let r = 0; r < repeats; r++) {
    last = null;
    varieties = [];
    const ctx = ctxFor(s);
    const director = createDirector("jev", { evaluate, state_format: "briefing" });
    const cards = requestsFor(ctx, s);
    if (set === "lane" || s.kept) await director.planCards(ctx, cards[0]!);
    else if (set === "doors") await director.planOffer(ctx, {
      portals: { ...portalChoices({ roomIndex: 1, lastWasElite: false, critical: false, style: s.style },
        new RngSource(`words-${s.name}-${r}`).stream("portal-count"), 3), npcKinds: [], elite: false },
    });
    else await director.planOffer(ctx, { opening: REWARD_KINDS, cards });
    varietyResults[s.name]!.push(...varieties);
    if (last) results[s.name]!.push(last);
    else if (!s.kept) console.log(`${s.name} #${r}: no Jev answer (fell to the rule table)`);
  }
  const runs = results[s.name]!;
  const mean = (k: string) => runs.reduce((a, p) => a + (p[k] ?? 0), 0) / Math.max(1, runs.length);
  const tops = runs.map((p) => Object.entries(p).sort((a, b) => b[1] - a[1])[0]?.[0]);
  console.log(`${s.name.padEnd(22)} ${s.words && ["paraphrase", "playstyle"].includes(process.env["AB_SET"] ?? "") ? `${s.words}  ` : ""}${(s.expect ? `want ${s.expect}` : "control").padEnd(15)} n=${runs.length}  `
    + [...options, "fallback"].map((k) => `${k} ${mean(k).toFixed(2)}`).join("  ")
    + `  top ${tops.join(",")}`);
  const vs = varietyResults[s.name]!;
  if (vs.length) {
    const vmean = (k: string) => vs.reduce((a, p) => a + (p[k] ?? 0), 0) / vs.length;
    const vtops = vs.filter((p) => !p["declined"]).map(varietyTop);
    console.log(`${"".padEnd(22)} variety${s.breadth ? ` want ${s.breadth}` : ""}  n=${vs.length}  `
      + ["low", "medium", "high", "fallback"].map((k) => `${k} ${vmean(k).toFixed(2)}`).join("  ")
      + `  declined ${vs.filter((p) => p["declined"]).length}/${vs.length}  top ${vtops.join(",")}`);
  }
}
/** The top kept option of a `variety` answer, the escape left out. */
function varietyTop(p: Record<string, number>): string {
  return ["low", "medium", "high"].reduce((a, b) => ((p[b] ?? 0) > (p[a] ?? 0) ? b : a));
}
const allVarieties = states.flatMap((s) => varietyResults[s.name] ?? []);
console.log(`variety declined: ${allVarieties.filter((p) => p["declined"]).length}/${allVarieties.length}`);
const broad = states.filter((s) => s.breadth);
if (broad.length) {
  const answered = broad.flatMap((s) => (varietyResults[s.name] ?? []).filter((p) => !p["declined"]).map((p) => ({ s, p })));
  const agree = answered.filter(({ s, p }) => (varietyTop(p) === "low") === (s.breadth === "narrow")).length;
  console.log(`variety top answer is as wide as the words ask: ${agree}/${answered.length} answered`);
}
const judged = states.filter((s) => s.expect);
const hits = judged.reduce((a, s) => a + (results[s.name] ?? []).filter((p) =>
  Object.entries(p).sort((x, y) => y[1] - x[1])[0]?.[0] === s.expect).length, 0);
const total = judged.reduce((a, s) => a + (results[s.name]?.length ?? 0), 0);
console.log(`top answer is what the words ask for: ${hits}/${total}`);
writeFileSync(out, JSON.stringify({ results, variety: varietyResults }, null, 2));
console.log(`Jev calls: ${ledger.calls}, failed ${ledger.failures}, refused ${ledger.refused}`);
