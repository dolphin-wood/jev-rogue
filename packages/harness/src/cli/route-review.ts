/**
 * **A whole route, room by room** (design doc 011, "Reading a route back").
 *
 * `pnpm jev-run` answers "did the run survive, and how hard were the rooms".
 * It cannot answer the question the offer actually exists for: *did the doors
 * and cards in front of the player make sense to them?* A run can pass every
 * band target and still hand a player with three spells a fourth spell door,
 * or sell them gold in a run with no vendor in it. Pass rate hides that
 * completely, which is why this exists beside it.
 *
 * So this prints the route: for each room, the portal it was entered by, the
 * build at that moment, the cards it offered, the labels the offer was
 * grounded on, and the portals out. Then it flags the offers that do not make
 * sense, mechanically, against the rules doc 007 states — a spell door to a
 * full staff, an affix card nothing can take, gold in a run that never meets a
 * vendor, a stat door to a staff with an empty key.
 *
 * Run: `pnpm route-review <arm> <seeds> [profile]`, or `pnpm route-review:jev
 * <seeds> [profile] [budget] [labels|briefing]` for the real model. The last
 * argument (or `JR_STATE`) picks which of the two state formats the Jev arm
 * sends, so the same seeds can be run under both and compared.
 */
import { playRun } from "../play/run.ts";
import type { RoomOutcome, RunOutcome } from "../play/run.ts";
import { skillProfile } from "../play/skill.ts";
import { jevEvaluator } from "../play/jev.ts";
import { ITEMS, RUN_COMBAT_ROOMS, RUN_SHOP_ROOM, SPELL_AFFIXES, STAT_UPGRADES, cardStyleTags } from "@jr/core";
import type { Archetype } from "@jr/core";
import type { DirectorArm, QuestionStyle } from "@jr/director";

const arm = (process.argv[2] ?? "rule") as DirectorArm;
const seeds = Number(process.argv[3] ?? 2);
const profile = skillProfile(process.argv[4]);
/** The hard call ceiling, as `jev-run` has it: past it the rule table answers. */
const budget = Number(process.argv[5] ?? 400);
/**
 * **Which state format the Jev arm sends** (`DirectorDeps.state_format`).
 *
 * `labels`, the default, is the flat table of label values with `Fits when`
 * options. `briefing` sends the run written out as a designer would read it,
 * with options written as specs. Set `JR_STATE=briefing`, or pass it as the
 * sixth argument, to run the other arm on the same seeds.
 */
const stateFormat: QuestionStyle =
  (process.argv[6] ?? process.env["JR_STATE"]) === "briefing" ? "briefing" : "labels";
/** A separate log per format, so `answer-stats` can be pointed at either. */
const logFile = process.env["JR_LOG"]
  ?? `${process.env["TMPDIR"] ?? "/tmp"}/route-review-${stateFormat}.jsonl`;

const jev = arm === "jev" ? jevEvaluator({ budget, logFile }) : null;

/**
 * **Every seed is a different player.**
 *
 * The harness fixed the preset at `spam` and sent no typed intent, so
 * `affix_intent` answered `wider` in 22 offers of 22 — which reads as a
 * degenerate question and is actually a degenerate *input*: `wider` is the
 * lane grounded on `intent_preset` being spam or area, and every run was a
 * spam run. A review that varies neither the stated style nor the player's own
 * words cannot tell a stuck question from a stuck harness.
 *
 * The sentences are the kind of thing a person types into a 120-character box,
 * one per lane, so the free text and the preset disagree as often as they agree
 * — which is the case the Director has to get right.
 */
const PLAYERS: readonly { preset: Archetype; text: string }[] = [
  { preset: "spam", text: "lots of little shots, I never want to stop casting" },
  { preset: "nuke", text: "one big hit that deletes the room" },
  { preset: "area", text: "I keep getting surrounded, give me something that hits all at once" },
  { preset: "dot", text: "I want to set things on fire and walk away" },
  { preset: "melee", text: "sword range, up close, I want to stay alive in there" },
  { preset: "spam", text: "I can never hit anything, make the shots find them" },
  { preset: "nuke", text: "I keep running out of mana" },
  { preset: "area", text: "freeze them and shatter them" },
  // Two more, so ten seeds are two runs of every style.
  { preset: "dot", text: "poison everything and let it tick while I run" },
  { preset: "melee", text: "let the sword cast my spells for me" },
];

const runs: RunOutcome[] = [];
for (let i = 0; i < seeds; i++) {
  const who = PLAYERS[i % PLAYERS.length]!;
  runs.push(await playRun(
    `seed-${i}`, arm, who.preset,
    { state_format: stateFormat, ...(jev ? { evaluate: jev.evaluate } : {}) },
    who.text, profile,
  ));
}
console.log(`players: ${runs.map((_, i) => PLAYERS[i % PLAYERS.length]!.preset).join(", ")}`);
console.log(`state format: ${stateFormat}${arm === "jev" ? `  log: ${logFile}` : ""}`);
if (jev) {
  const calls = Math.max(1, jev.ledger.calls);
  console.log(`\njev: ${jev.ledger.calls} calls, ${jev.ledger.failures} failed, `
    + `${jev.ledger.rateLimited} rate-limited (${jev.ledger.retried} rescued by a retry), `
    + `${jev.ledger.refused} refused past the budget`);
  console.log(`     ${jev.ledger.inputTokens} input tokens, `
    + `${Math.round(jev.ledger.inputTokens / calls)} a call; `
    + `median latency ${median(jev.ledger.latencies)} ms`);
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]!);
}

/** One complaint about one offer: what was wrong, and which room it was in. */
interface Flag { room: number; what: string }

/**
 * The offers that do not make sense, as rules rather than as impressions.
 *
 * Every one of these was a real report, and each is a thing the player can see
 * for themselves without knowing anything about the Director.
 */
function flagsFor(rooms: readonly RoomOutcome[]): Flag[] {
  const out: Flag[] = [];
  const keys = (r: RoomOutcome) => r.route.build.length;
  for (const [i, r] of rooms.entries()) {
    const next = rooms[i + 1];
    const full = keys(r) >= 3;
    // A spell door to a full staff is only honest as an upgrade path.
    if (full && r.route.doorIn.startsWith("spell")) {
      const held = new Set(r.route.build.map((b) => b.split("@")[0]));
      const novel = r.route.cards.filter((c) => !held.has(c.split("@")[0]));
      if (novel.length === r.route.cards.length && r.route.cards.length > 0)
        out.push({ room: r.index, what: `spell door with every key full, and no card levels one: ${r.route.cards.join(", ")}` });
    }
    // A stat door while a key is empty: a number on a build that is not there.
    if (!full && r.route.doorIn.startsWith("stat") && r.route.labels.build_shape === "raw")
      out.push({ room: r.index, what: "stat door to a raw build with an empty key" });
    // Gold with nowhere to spend it: no vendor met, and none offered since.
    if (r.route.doorIn.startsWith("gold")) {
      const vendorAhead = rooms.slice(i).some((x) => /merchant|smith/.test(x.route.doorIn)
        || x.route.portalsOut.some((p) => /merchant|smith/.test(p)));
      if (!vendorAhead) out.push({ room: r.index, what: "gold door and no vendor left in the run" });
    }
    // Every portal out promising the same thing is not a choice.
    const fights = r.route.portalsOut.filter((p) => !/merchant|smith|fountain/.test(p));
    if (fights.length > 1 && new Set(fights.map((p) => p.split(":")[0]?.replace("ELITE ", ""))).size === 1)
      out.push({ room: r.index, what: `every portal out offers ${fights[0]}` });
    // An affix card nothing on the staff can take is a reward that cannot be
    // taken: the scatter build's Seek, which the shape filter could not see.
    for (const id of r.route.dead)
      out.push({ room: r.index, what: `dead affix card, no held key can take it: ${id}` });
    /*
     * **The run narrows twice, and both narrowings have to be honest**
     * (`fixedExit`). The last fight opens onto the vendors' stop and the stop
     * opens onto the boss, so each must end with exactly one door and that
     * door must promise the room ahead rather than a currency the room will
     * never pay. The old check only looked at the stop, and looked at it by
     * `type` — which a mid-run fountain room also carries, so it flagged
     * fountains and missed the room the complaint was actually about.
     */
    if (r.index === RUN_COMBAT_ROOMS || r.index === RUN_SHOP_ROOM) {
      const where = r.index === RUN_COMBAT_ROOMS ? "the last fight" : "the vendors' stop";
      if (r.route.portalsOut.length !== 1)
        out.push({ room: r.index, what: `${where} offered ${r.route.portalsOut.length} portals, not one` });
      else if (r.route.portalsOut[0] !== "onward")
        out.push({ room: r.index, what: `${where}'s one door wears a reward badge: ${r.route.portalsOut[0]}` });
    }
    void next;
  }
  return out;
}

for (const run of runs) {
  console.log(`\n=== ${run.seed} · ${run.arm} arm · ${run.profile} · ${run.survived ? "survived" : "died"} ===`);
  console.log(
    `${"room".padEnd(5)}${"in".padEnd(18)}${"shape".padEnd(9)}${"gold".padEnd(6)}`
    + `${"build".padEnd(46)}${"cards".padEnd(34)}out`,
  );
  for (const r of run.rooms) {
    console.log(
      `#${String(r.index).padStart(2)}  `
      + r.route.doorIn.padEnd(18)
      + (r.route.labels.build_shape ?? "").padEnd(9)
      + (r.route.labels.gold ?? "").padEnd(6)
      + r.route.build.join(" ").slice(0, 45).padEnd(46)
      + r.route.cards.join(" ").slice(0, 33).padEnd(34)
      + r.route.portalsOut.join("  "),
    );
  }
  const flags = flagsFor(run.rooms);
  console.log(flags.length === 0 ? "no offers flagged" : `${flags.length} offers flagged:`);
  for (const f of flags) console.log(`  #${String(f.room).padStart(2)}  ${f.what}`);
}

/* The same, totalled, which is the number a change is judged by. */
const all = runs.flatMap((r) => flagsFor(r.rooms));
const rooms = runs.reduce((n, r) => n + r.rooms.length, 0);
console.log(`\n=== ${arm}, ${seeds} seeds: ${all.length} flagged offers over ${rooms} rooms ===`);
const byKind = new Map<string, number>();
for (const f of all) {
  const kind = f.what.split(":")[0]!;
  byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
}
for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${kind}`);

/* What the doors actually offered, over every room: the mix the player saw. */
/** The two pools a card id can belong to besides the affixes. */
const STAT_IDS: ReadonlySet<string> = new Set(STAT_UPGRADES.map((s) => s.id));
const SPELL_POOL: ReadonlySet<string> = new Set([...ITEMS.keys()]);

/** A door word down to its kind: no elite mark, no promise, no grade. */
const kindOf = (word: string) => word.replace("ELITE ", "").split(":")[0]!.replace(/x\d$/, "");
const kinds = new Map<string, number>();
for (const run of runs)
  for (const r of run.rooms)
    for (const p of r.route.portalsOut) kinds.set(kindOf(p), (kinds.get(kindOf(p)) ?? 0) + 1);
const total = [...kinds.values()].reduce((a, b) => a + b, 0) || 1;
console.log("\nportals offered, by kind:");
for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1]))
  console.log(`  ${k.padEnd(10)} ${String(n).padStart(4)}  ${((100 * n) / total).toFixed(0)}%`);

/*
 * **Did the first door match what the build measurably needed?**
 *
 * The doors are assigned from a ranking now (doc 003), so the first portal is
 * the Director's top answer to "what does this player need most". Doc 007
 * states what that is at each stage of a build, and this counts how often the
 * two agree — the number the combination question could not produce at all,
 * because a set has no first element.
 */
const WANTED: Readonly<Record<string, readonly string[]>> = {
  raw: ["spell", "merchant"], forming: ["affix", "merchant"], formed: ["stat", "gold", "smith"],
};
let matched = 0;
let ranked = 0;
for (const run of runs)
  for (const r of run.rooms) {
    const first = r.route.portalsOut[0];
    if (!first) continue;
    ranked++;
    if (WANTED[r.route.labels.build_shape ?? ""]?.includes(kindOf(first))) matched++;
  }
/*
 * Expect this below 100%, and expect it to have *fallen* since the run history
 * became a fact: the Director's brief deliberately overrides the build-shape
 * table when the same badge has been shown three rooms running, or when the
 * player keeps walking past it. It is a measure of agreement with one rule,
 * not a score.
 */
console.log(`\ntop-ranked door matches doc 007's build-shape table alone: ${matched}/${ranked}`
  + ` (${ranked ? ((100 * matched) / ranked).toFixed(0) : 0}%)`);

/*
 * **The longest run of one badge.** The distribution above says the mix over a
 * whole run; it cannot say that six rooms in the middle all offered affix,
 * which is what the player actually complains about — "you just close your
 * eyes and pick affix". A streak is counted over the offers, not the takes: a
 * kind on every one of six consecutive offers is six, whatever was taken.
 */
console.log("\nlongest run of one badge, offer after offer:");
{
  const longest = new Map<string, number>();
  for (const run of runs) {
    const current = new Map<string, number>();
    for (const r of run.rooms) {
      const here = new Set(r.route.portalsOut.map(kindOf));
      for (const k of new Set([...current.keys(), ...here])) {
        const n = here.has(k) ? (current.get(k) ?? 0) + 1 : 0;
        current.set(k, n);
        if (n > (longest.get(k) ?? 0)) longest.set(k, n);
      }
    }
  }
  for (const [k, n] of [...longest].sort((a, b) => b[1] - a[1]).slice(0, 6))
    console.log(`  ${k.padEnd(10)} ${String(n).padStart(3)} offers running`);
}

/*
 * **How hard the run actually was, and how much of it was not a fight.**
 *
 * The distribution above says what was *offered*; these say what was
 * *entered*. Reported from play as two separate complaints — "four of the
 * fourteen fights were elites" and "it feels like the game is pushing you to
 * spend money" — and neither is visible in a share of portals, because the
 * player only walks through one door a room.
 */
{
  let fights = 0;
  let elites = 0;
  let vendorRooms = 0;
  let fountainRooms = 0;
  for (const run of runs)
    for (const r of run.rooms) {
      if (/merchant|smith/.test(r.route.doorIn)) { vendorRooms++; continue; }
      if (/fountain/.test(r.route.doorIn)) { fountainRooms++; continue; }
      if (r.type !== "combat" && r.type !== "elite") continue;
      fights++;
      if (r.type === "elite") elites++;
    }
  const per = (n: number) => `${(n / runs.length).toFixed(1)} a run`;
  console.log(`\nrooms entered: ${fights} fights, of which ${elites} elite `
    + `(${fights ? ((100 * elites) / fights).toFixed(0) : 0}%, ${per(elites)});`
    + ` ${vendorRooms} mid-run vendor rooms (${per(vendorRooms)});`
    + ` ${fountainRooms} fountains (${per(fountainRooms)})`);
}

/*
 * **How much of the pool a run shows.** "The spells and affixes feel like the
 * same ones over and over" is a claim about a *run*, and the pool-wide
 * histogram below cannot answer it: twenty affixes can all appear across
 * eight runs while each single run sees six. So this counts per run — how
 * many distinct cards of each kind reached a reward screen, how much of the
 * offer the five commonest took, and how many of the cards offered were ones
 * the run had already shown.
 */
{
  const affixIds = new Set(SPELL_AFFIXES.map((a) => a.id));
  const rows: { kind: string; pool: number; distinct: number[]; top5: number[]; repeats: number[] }[] = [
    { kind: "spell", pool: 0, distinct: [], top5: [], repeats: [] },
    { kind: "affix", pool: affixIds.size, distinct: [], top5: [], repeats: [] },
    { kind: "stat", pool: 0, distinct: [], top5: [], repeats: [] },
  ];
  const kindOfCard = (id: string) => (affixIds.has(id) ? "affix" : STAT_IDS.has(id) ? "stat" : "spell");
  rows[0]!.pool = SPELL_POOL.size;
  rows[2]!.pool = STAT_IDS.size;
  for (const run of runs) {
    const seen = new Map<string, Map<string, number>>();
    for (const r of run.rooms)
      for (const c of r.route.cards) {
        const id = c.split("@")[0]!;
        const kind = kindOfCard(id);
        const bag = seen.get(kind) ?? new Map<string, number>();
        bag.set(id, (bag.get(id) ?? 0) + 1);
        seen.set(kind, bag);
      }
    for (const row of rows) {
      const bag = seen.get(row.kind);
      if (!bag) continue;
      const counts = [...bag.values()].sort((a, b) => b - a);
      const total = counts.reduce((a, b) => a + b, 0);
      row.distinct.push(bag.size);
      row.top5.push(total ? counts.slice(0, 5).reduce((a, b) => a + b, 0) / total : 0);
      row.repeats.push(total - bag.size);
    }
  }
  const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log("\ncards a run shows (mean over the seeds):");
  for (const row of rows)
    console.log(`  ${row.kind.padEnd(6)} ${mean(row.distinct).toFixed(1)} distinct of ${row.pool} in the pool`
      + `   top-5 share ${(100 * mean(row.top5)).toFixed(0)}%`
      + `   repeats ${mean(row.repeats).toFixed(1)} a run`);
}

/*
 * **The affix pool, offered and taken.** "Affixes feel like the same few every
 * time" is a claim about a histogram, so this is the histogram: every affix
 * the game has, how often it reached a reward screen, and how often it was
 * taken. An affix with a zero in the first column is content nobody will ever
 * see, whatever the pool size says.
 */
{
  const offered = new Map<string, number>();
  const taken = new Map<string, number>();
  const ids = new Set(SPELL_AFFIXES.map((a) => a.id));
  for (const run of runs)
    for (const r of run.rooms) {
      for (const c of r.route.cards) {
        const id = c.split("@")[0]!;
        if (ids.has(id)) offered.set(id, (offered.get(id) ?? 0) + 1);
      }
      // What was taken is recorded as the card's label, which for an affix is
      // its name; match on the id's title form.
      const label = (r.reward ?? "").toLowerCase().replace(/ /g, "_");
      if (ids.has(label)) taken.set(label, (taken.get(label) ?? 0) + 1);
    }
  const rows = [...ids].map((id) => [id, offered.get(id) ?? 0, taken.get(id) ?? 0] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = rows.filter((r) => r[1] > 0).length;
  console.log(`\naffixes offered and taken (${shown} of ${ids.size} ever offered):`);
  for (const [id, n, t] of rows)
    console.log(`  ${id.padEnd(12)} offered ${String(n).padStart(3)}   taken ${String(t).padStart(3)}`);
}

/*
 * **Does the offer lean to the style the player chose?** (doc 006: a style
 * is a way of using a key, and each style sees eight to eleven spells.)
 *
 * Per run, by the stated style: how many of the spell, affix and stat cards
 * on its reward screens read as that style — a spell by its own tags, an
 * affix or a stat by the tables `cardStyleTags` reads (`AFFIX_STYLE`,
 * `STAT_STYLE`) — and how many of the cards taken did. Then every spell and
 * affix a style's runs were offered and took, so a card a style never sees,
 * or one it always takes, shows up by name.
 */
{
  const affixIds = new Set(SPELL_AFFIXES.map((a) => a.id));
  const statIds = new Set(STAT_UPGRADES.map((u) => u.id));
  const kindOfId = (id: string): "spell" | "affix" | "stat" | null =>
    ITEMS.has(id) ? "spell" : affixIds.has(id) ? "affix" : statIds.has(id) ? "stat" : null;
  const idOfLabel = (label: string | null): string | null => {
    if (!label) return null;
    const id = label.toLowerCase().replace(/ /g, "_");
    return kindOfId(id) ? id : null;
  };
  console.log("\ncards on the chosen style, by run (offered on-style / offered, taken on-style / taken):");
  const byStyle = new Map<string, { offered: Map<string, number>; taken: Map<string, number> }>();
  runs.forEach((run, i) => {
    const style = PLAYERS[i % PLAYERS.length]!.preset;
    const tally = { spell: [0, 0], affix: [0, 0], stat: [0, 0] } as Record<string, [number, number]>;
    const took: [number, number] = [0, 0];
    const bag = byStyle.get(style) ?? { offered: new Map<string, number>(), taken: new Map<string, number>() };
    for (const r of run.rooms) {
      for (const c of r.route.cards) {
        const id = c.split("@")[0]!;
        const kind = kindOfId(id);
        if (!kind) continue;
        const on = cardStyleTags(ITEMS, kind, id).includes(style);
        tally[kind]![1]++;
        if (on) tally[kind]![0]++;
        if (kind !== "stat") bag.offered.set(id, (bag.offered.get(id) ?? 0) + 1);
      }
      const taken = idOfLabel(r.reward);
      const kind = taken ? kindOfId(taken) : null;
      if (taken && kind && r.route.cards.some((c) => c.split("@")[0] === taken)) {
        took[1]++;
        if (cardStyleTags(ITEMS, kind, taken).includes(style)) took[0]++;
        if (kind !== "stat") bag.taken.set(taken, (bag.taken.get(taken) ?? 0) + 1);
      }
    }
    byStyle.set(style, bag);
    const cell = ([on, n]: readonly number[]) => `${on}/${n}${n ? ` (${Math.round((100 * on!) / n!)}%)` : ""}`;
    console.log(`  ${run.seed.padEnd(8)} ${style.padEnd(6)} spell ${cell(tally.spell!).padEnd(12)} `
      + `affix ${cell(tally.affix!).padEnd(12)} stat ${cell(tally.stat!).padEnd(12)} taken ${cell(took)}`);
  });
  for (const [style, bag] of byStyle) {
    const rows = [...bag.offered].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id, n]) => `${id} ${n}/${bag.taken.get(id) ?? 0}`);
    console.log(`  ${style}: offered/taken  ${rows.join(", ")}`);
  }
}

/*
 * **The levels, room by room.** A route review that printed only the build
 * string buried this: `magic_bolt@1` sixteen times in a row is a run where
 * nothing was ever raised, and it took reading every line to notice.
 */
console.log("\nspell levels over the run (mean of the keys held, by room):");
{
  const byRoom = new Map<number, number[]>();
  for (const run of runs)
    for (const r of run.rooms) {
      if (r.levels.length === 0) continue;
      const mean = r.levels.reduce((a, b) => a + b, 0) / r.levels.length;
      byRoom.set(r.index, [...(byRoom.get(r.index) ?? []), mean]);
    }
  const line = [...byRoom].sort((a, b) => a[0] - b[0]).map(([i, xs]) =>
    `${i}:${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)}`);
  console.log(`  ${line.join("  ")}`);
  const top = runs.flatMap((r) => r.rooms.flatMap((x) => [...x.levels]));
  const raised = top.filter((l) => l > 1).length;
  console.log(`  keys above level 1: ${raised}/${top.length}`
    + ` (${top.length ? ((100 * raised) / top.length).toFixed(0) : 0}%)`);
}

/*
 * **The look-only questions.** Four of them came back 91% to 100% one answer
 * on the live model, which is four requests' worth of tokens spent on a
 * constant. Printed here so a rule run shows it too.
 */
/*
 * **The anchor, as the rooms came out.** It is the one encounter parameter
 * code alternates (`LOOK_REPEAT_PENALTY`), so the answer Jev gave and the
 * room the player got are two different numbers and only the second is the
 * player's experience.
 */
{
  const seen = new Map<string, number>();
  for (const run of runs)
    for (const r of run.rooms)
      if (r.shape) seen.set(r.shape.anchor, (seen.get(r.shape.anchor) ?? 0) + 1);
  const n = [...seen.values()].reduce((a, b) => a + b, 0) || 1;
  console.log(`\nrooms with a priority target: ${[...seen].sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${((100 * v) / n).toFixed(0)}%`).join("  ")}`);
}

console.log("\nthe room's look, by answer:");
for (const [name, read] of [
  ["symmetry", (r: RoomOutcome) => r.symmetry],
  ["mood_temperature", (r: RoomOutcome) => r.mood.temperature],
  ["mood_brightness", (r: RoomOutcome) => r.mood.brightness],
  ["mood_particles", (r: RoomOutcome) => r.mood.particles],
] as const) {
  const seen = new Map<string, number>();
  for (const run of runs) for (const r of run.rooms) seen.set(read(r), (seen.get(read(r)) ?? 0) + 1);
  const total = [...seen.values()].reduce((a, b) => a + b, 0) || 1;
  const sorted = [...seen].sort((a, b) => b[1] - a[1]);
  console.log(`  ${name.padEnd(17)} modal ${((100 * (sorted[0]?.[1] ?? 0)) / total).toFixed(0).padStart(3)}%   `
    + sorted.map(([k, n]) => `${k} ${((100 * n) / total).toFixed(0)}%`).join("  "));
}

/*
 * **And how long each look holds.** A modal share says how often an answer
 * won; it cannot say that eight rooms in a row were calm, which is the thing
 * the player sees. `LOOK_REPEAT_PENALTY` is aimed at the run length rather
 * than at the share, so this is the number it is judged by.
 */
console.log("longest run of one look, room after room:");
for (const [name, read] of [
  ["symmetry", (r: RoomOutcome) => r.symmetry],
  ["mood_temperature", (r: RoomOutcome) => r.mood.temperature],
  ["mood_brightness", (r: RoomOutcome) => r.mood.brightness],
  ["mood_particles", (r: RoomOutcome) => r.mood.particles],
] as const) {
  let longest = 0;
  const lengths: number[] = [];
  for (const run of runs) {
    let last = "";
    let n = 0;
    for (const r of run.rooms) {
      const here = read(r);
      n = here === last ? n + 1 : 1;
      last = here;
      lengths.push(n);
      if (n > longest) longest = n;
    }
  }
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  console.log(`  ${name.padEnd(17)} longest ${String(longest).padStart(2)}   mean run ${mean.toFixed(1)}`);
}

/* And which of them the reference player walked through. */
const taken = new Map<string, number>();
for (const run of runs)
  for (const r of run.rooms) {
    const k = kindOf(r.route.doorIn);
    taken.set(k, (taken.get(k) ?? 0) + 1);
  }
console.log("doors taken, by kind:");
for (const [k, n] of [...taken].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(10)} ${String(n).padStart(4)}`);
