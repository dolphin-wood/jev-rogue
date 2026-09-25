/**
 * `pnpm play:calibrate <log.json> [seeds] [arm]` — design doc 011,
 * "Calibration against real play".
 *
 * Takes a playtest log exported from the game's debug panel and lays it beside
 * what each skill profile does **on the same room indices**, so the gap is a
 * number rather than an impression. The three columns that matter are the room
 * time, the HP lost, and the share of the damage that was ranged: those are the
 * three a person can report about their own session, and the three the model
 * was most obviously wrong about.
 *
 * It does not tune anything. Fitting is done by hand with `JR_SKILL=` (see
 * `skill.ts`) and then written into the preset, because a profile is a claim
 * about how people play and should be readable as one.
 */
import { readFileSync } from "node:fs";
import { playRun } from "../play/run.ts";
import { skillProfile } from "../play/skill.ts";
import { byFamily } from "../play/playtest-log.ts";
import type { PlaytestLog, RoomLog } from "../play/playtest-log.ts";
import type { SkillName } from "../play/skill.ts";
import type { DirectorArm } from "@jr/director";

const file = process.argv[2];
if (!file) {
  console.error("usage: pnpm play:calibrate <log.json> [seeds] [arm]");
  console.error("  the log comes from the game's debug panel, tools tab, \"playtest log\"");
  process.exit(1);
}
const seeds = Number(process.argv[3] ?? 4);
const arm = (process.argv[4] ?? "rule") as DirectorArm;

/**
 * Which profiles are compared. `player` is the one fitted to a real log and the
 * one to read; `expert` is the floor — the model as it was — and `novice` and
 * `average` are the provisional room-99 presets, kept for reference.
 */
const AGAINST: SkillName[] = ["novice", "average", "player", "expert"];

const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
const real = parse(raw);
const realFights = real.rooms.filter((r) => r.type === "combat" || r.type === "elite" || r.type === "boss");
if (realFights.length === 0) {
  console.error(`${file}: no combat rooms in the log`);
  process.exit(1);
}

console.log(`real log: ${file}`);
console.log(`  ${realFights.length} fight rooms, seed ${real.seed || "(unknown)"}, recorded ${real.at || "(unknown)"}`);
console.log(`  room indices ${realFights.map((r) => r.index).join(", ")}`);

/** Only the indices the person actually played; anything else is not a comparison. */
const indices = new Set(realFights.map((r) => r.index));

const played = new Map<SkillName, RoomLog[]>();
for (const name of AGAINST) {
  const profile = skillProfile(name);
  const rooms: RoomLog[] = [];
  for (let i = 0; i < seeds; i++) {
    const out = await playRun(`seed-${i}`, arm, "spam", {}, undefined, profile);
    rooms.push(...out.log.filter((r) => indices.has(r.index) && r.type !== "shop"));
  }
  played.set(name, rooms);
}

console.log(`\n${seeds} seeds on the ${arm} arm, ${AGAINST.join(" / ")}.`);
console.log("Every number is a mean over the rooms with that index; `real` is the log.\n");

/* Room time and HP, per index. */
console.log("room time (s) and HP lost, per room index");
console.log(`  ${"room".padEnd(6)}${head("real")}${AGAINST.map((n) => head(n)).join("")}`);
for (const i of [...indices].sort((a, b) => a - b)) {
  const realAt = realFights.filter((r) => r.index === i);
  console.log(
    `  #${String(i).padStart(2)}   ${cell(realAt)}`
    + AGAINST.map((n) => cell((played.get(n) ?? []).filter((r) => r.index === i))).join(""),
  );
}

/* The gap, which is the number this command exists to print. */
console.log("\nhow far each profile is from the real session (room time, HP lost)");
for (const name of AGAINST) {
  const rows = played.get(name) ?? [];
  const t = ratio(rows, realFights, (r) => r.ms);
  const h = ratio(rows, realFights, (r) => r.hpLost);
  console.log(
    `  ${name.padEnd(8)} time ${verdict(t)}  HP ${verdict(h)}`,
  );
}

/* Where the damage came from, which is the other half of "plays like a person". */
console.log("\ndamage by source (share of HP lost)");
console.log(`  ${"who".padEnd(10)}${"ranged".padStart(9)}${"melee".padStart(9)}${"hazard".padStart(9)}   top causes`);
printFamily("real", realFights);
for (const name of AGAINST) printFamily(name, played.get(name) ?? []);

console.log(
  "\n`player` is the profile fitted to this kind of log; `novice` and `average` are"
  + " provisional, fitted while the browser ran every room as room 99."
  + " Refit any of them with JR_SKILL=<param>=<value>,… (see packages/harness/src/play/skill.ts)"
  + " and write the result into SKILL_PROFILES.",
);

function head(name: string): string {
  return `${name}`.padStart(9) + "".padStart(8);
}

function cell(rows: readonly RoomLog[]): string {
  if (rows.length === 0) return `${"—".padStart(9)}${"—".padStart(8)}`;
  const s = rows.reduce((t, r) => t + r.ms, 0) / rows.length / 1000;
  const hp = rows.reduce((t, r) => t + r.hpLost, 0) / rows.length;
  return `${`${s.toFixed(0)}s`.padStart(9)}${`${hp.toFixed(1)}hp`.padStart(8)}`;
}

/** The profile's mean over the real session's mean, per index, then averaged. */
function ratio(rows: readonly RoomLog[], realRows: readonly RoomLog[], of: (r: RoomLog) => number): number {
  const ratios: number[] = [];
  for (const i of indices) {
    const mine = rows.filter((r) => r.index === i);
    const theirs = realRows.filter((r) => r.index === i);
    if (mine.length === 0 || theirs.length === 0) continue;
    const a = mine.reduce((t, r) => t + of(r), 0) / mine.length;
    const b = theirs.reduce((t, r) => t + of(r), 0) / theirs.length;
    if (b > 0) ratios.push(a / b);
  }
  return ratios.length === 0 ? NaN : ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

function verdict(r: number): string {
  if (!Number.isFinite(r)) return "(no overlap)";
  const pct = `${(r * 100).toFixed(0)}% of real`;
  // Within a quarter either way is as close as a four-seed sample can claim.
  return `${pct.padEnd(16)}${r >= 0.75 && r <= 1.33 ? "close" : r < 1 ? "too strong" : "too weak"}`;
}

function printFamily(name: string, rows: readonly RoomLog[]): void {
  const fam = byFamily(rows);
  const total = fam.ranged + fam.melee + fam.hazard;
  if (total <= 0) {
    console.log(`  ${name.padEnd(10)}${"—".padStart(9)}${"—".padStart(9)}${"—".padStart(9)}`);
    return;
  }
  const causes = new Map<string, number>();
  for (const r of rows)
    for (const [c, hp] of Object.entries(r.bySource)) causes.set(c, (causes.get(c) ?? 0) + hp);
  const top = [...causes].sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([c, hp]) => `${c} ${((hp / total) * 100).toFixed(0)}%`).join(", ");
  const pct = (v: number): string => `${((v / total) * 100).toFixed(0)}%`.padStart(9);
  console.log(`  ${name.padEnd(10)}${pct(fam.ranged)}${pct(fam.melee)}${pct(fam.hazard)}   ${top}`);
}

/**
 * Reads a log without trusting it. It comes out of a browser's localStorage and
 * through a clipboard, so a field may be missing or the wrong type; a
 * calibration command that throws on a stray `undefined` is a calibration
 * command nobody can use.
 */
function parse(value: unknown): PlaytestLog {
  const o = (value ?? {}) as Record<string, unknown>;
  const rooms = Array.isArray(o.rooms) ? o.rooms : [];
  return {
    source: "game",
    seed: typeof o.seed === "string" ? o.seed : "",
    at: typeof o.at === "string" ? o.at : "",
    ...(typeof o.profile === "string" ? { profile: o.profile } : {}),
    rooms: rooms.map((r): RoomLog => {
      const x = (r ?? {}) as Record<string, unknown>;
      const src = (x.bySource ?? {}) as Record<string, unknown>;
      return {
        index: num(x.index), type: typeof x.type === "string" ? x.type : "combat",
        ms: num(x.ms), hpLost: num(x.hpLost),
        bySource: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, num(v)])),
        kills: num(x.kills), dashes: num(x.dashes), casts: num(x.casts),
        swings: num(x.swings), nearMs: num(x.nearMs),
      };
    }),
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
