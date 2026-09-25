/**
 * Measuring the sound set, because nobody can listen to a hundred and
 * eighteen files and hold them in their head.
 *
 * It renders every effect and an excerpt of every music state from the same
 * code the game runs, then reports what the ear would have to be trusted for
 * otherwise: duration, peak, RMS, approximate LUFS and spectral centroid per
 * effect; whether anything clips; whether the levels inside a category agree;
 * and whether any two effects in *different* categories are near enough in
 * spectrum and envelope to be confused. A coin that reads as a sword hit is a
 * bug, and it is one that only shows up as a number.
 *
 *   pnpm audio:check              measure, and fail on a fault
 *   pnpm audio:check --listen     also write mixdowns somewhere playable
 *
 * With `--listen` it renders two minutes of each music state, the room-clear
 * sting, and a run through every effect in order, into a directory under the
 * system temp dir (or `--out <dir>`) — never into the repository, which holds
 * only what the game loads.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MUSIC_STATES, SAMPLE_RATE, SFX_DEFS, SFX_NAMES,
  approxLufs, buffer, dbfs, fingerprint, mixInto, peak, renderMusic, renderSfx,
  renderSting, rms, spectralCentroid, spectralDistance, toWavBytes,
  type MusicMood,
} from "@jr/core";

/** Nothing may peak above this. */
const CEILING_DB = -1;
/** Two effects in different categories closer than this are near-duplicates. */
const MIN_DISTANCE = 0.06;
/** The widest a category's loudness may spread, in LU. */
const MAX_CATEGORY_SPREAD = 9;

const args = process.argv.slice(2);
const listen = args.includes("--listen");
const outIndex = args.indexOf("--out");
const outDir = outIndex >= 0 ? args[outIndex + 1] ?? "" : join(tmpdir(), "jr-audio");

const faults: string[] = [];

/* ------------------------------ the effects ------------------------------- */

interface Row {
  name: string;
  category: string;
  variants: number;
  seconds: number;
  peakDb: number;
  rmsDb: number;
  lufs: number;
  centroid: number;
}

const rows: Row[] = [];
const prints = new Map<string, Float32Array>();
let bytes = 0;

for (const name of SFX_NAMES) {
  const def = SFX_DEFS[name]!;
  let worstPeak = 0;
  let totalSeconds = 0;
  const first = renderSfx(name, 0);
  for (let v = 0; v < def.variants; v++) {
    const buf = renderSfx(name, v);
    const p = peak(buf);
    worstPeak = Math.max(worstPeak, p);
    totalSeconds += buf.length / SAMPLE_RATE;
    bytes += 44 + buf.length * 2;
    if (dbfs(p) > CEILING_DB) faults.push(`${name}_${v} clips: ${dbfs(p).toFixed(2)} dBFS`);
    if (rms(buf) < 0.01) faults.push(`${name}_${v} is effectively silent`);
  }
  prints.set(name, fingerprint(first));
  rows.push({
    name, category: def.category, variants: def.variants,
    seconds: totalSeconds / def.variants,
    peakDb: dbfs(worstPeak), rmsDb: dbfs(rms(first)),
    lufs: approxLufs(first), centroid: spectralCentroid(first),
  });
}

const pad = (s: string | number, n: number, right = false): string => {
  const str = String(s);
  return right ? str.padStart(n) : str.padEnd(n);
};

console.log("effect            cat     var   sec   peak    rms    LUFS  centroid");
console.log("-".repeat(69));
for (const category of ["combat", "world", "ui"]) {
  for (const row of rows.filter((r) => r.category === category)) {
    console.log(
      pad(row.name, 18) + pad(row.category, 8) + pad(row.variants, 4, true) +
      pad(row.seconds.toFixed(2), 7, true) + pad(row.peakDb.toFixed(1), 7, true) +
      pad(row.rmsDb.toFixed(1), 7, true) + pad(row.lufs.toFixed(1), 8, true) +
      pad(Math.round(row.centroid), 10, true),
    );
  }
}

/* ------------------------------ the levelling ----------------------------- */

console.log("");
for (const category of ["combat", "world", "ui"]) {
  const levels = rows.filter((r) => r.category === category).map((r) => r.lufs);
  const spread = Math.max(...levels) - Math.min(...levels);
  console.log(`${pad(category, 8)} ${levels.length} effects, ${spread.toFixed(1)} LU spread, loudest ${Math.max(...levels).toFixed(1)} LUFS`);
  if (spread > MAX_CATEGORY_SPREAD) faults.push(`${category} spreads ${spread.toFixed(1)} LU, over ${MAX_CATEGORY_SPREAD}`);
}

/* --------------------------- the confusion check -------------------------- */

const near: { a: string; b: string; d: number }[] = [];
for (let i = 0; i < rows.length; i++) {
  for (let k = i + 1; k < rows.length; k++) {
    const a = rows[i]!;
    const b = rows[k]!;
    if (a.category === b.category) continue;
    const d = spectralDistance(prints.get(a.name)!, prints.get(b.name)!);
    if (d < MIN_DISTANCE) near.push({ a: a.name, b: b.name, d });
  }
}
near.sort((x, y) => x.d - y.d);
console.log("");
if (near.length === 0) {
  console.log(`no cross-category pair closer than ${MIN_DISTANCE}`);
} else {
  for (const n of near) {
    console.log(`near-duplicate: ${n.a} ~ ${n.b} (${n.d.toFixed(4)})`);
    faults.push(`${n.a} and ${n.b} are in different categories and sound alike (${n.d.toFixed(4)})`);
  }
}
console.log(`${SFX_NAMES.length} effects, ${rows.reduce((s, r) => s + r.variants, 0)} files, ${(bytes / 1048576).toFixed(2)} MB`);

/* --------------------------------- music ---------------------------------- */

console.log("");
console.log("music             peak    rms    LUFS  centroid");
console.log("-".repeat(46));
for (const state of MUSIC_STATES) {
  for (const mood of ["warm", "cold"] as const) {
    const buf = renderMusic(state, 24, mood);
    const p = dbfs(peak(buf));
    if (p > CEILING_DB) faults.push(`music ${state}/${mood} clips: ${p.toFixed(2)} dBFS`);
    console.log(
      pad(`${state}/${mood}`, 18) + pad(p.toFixed(1), 7, true) +
      pad(dbfs(rms(buf)).toFixed(1), 7, true) + pad(approxLufs(buf).toFixed(1), 8, true) +
      pad(Math.round(spectralCentroid(buf)), 10, true),
    );
  }
}
{
  const buf = renderSting("cold");
  const p = dbfs(peak(buf));
  if (p > CEILING_DB) faults.push(`the clear sting clips: ${p.toFixed(2)} dBFS`);
  console.log(pad("sting/cold", 18) + pad(p.toFixed(1), 7, true) + pad(dbfs(rms(buf)).toFixed(1), 7, true) + pad(approxLufs(buf).toFixed(1), 8, true) + pad(Math.round(spectralCentroid(buf)), 10, true));
}

/* ------------------------------- listening -------------------------------- */

if (listen) {
  mkdirSync(outDir, { recursive: true });
  const write = (file: string, samples: Float32Array): void => {
    writeFileSync(join(outDir, file), Buffer.from(toWavBytes(samples)));
    console.log(`  ${join(outDir, file)}  ${(samples.length / SAMPLE_RATE).toFixed(1)}s`);
  };
  console.log("");
  console.log("written for listening:");
  for (const state of MUSIC_STATES) {
    for (const mood of ["warm", "cold"] as MusicMood[]) {
      // Two minutes: longer than the loop, so a listener hears the seam.
      write(`music-${state}-${mood}.wav`, renderMusic(state, 120, mood));
    }
  }
  write("music-sting-cold.wav", renderSting("cold"));

  // Every effect in order, half a second apart, so the whole set can be
  // played through once: this is the fastest way to hear an outlier.
  const gap = 0.55;
  const all = buffer(SFX_NAMES.length * gap + 2);
  SFX_NAMES.forEach((name, i) => { mixInto(all, renderSfx(name, 0), i * gap); });
  write("sfx-all.wav", all);
  for (const category of ["combat", "world", "ui"] as const) {
    const names = SFX_NAMES.filter((n) => SFX_DEFS[n]!.category === category);
    const buf = buffer(names.length * gap + 2);
    names.forEach((name, i) => { mixInto(buf, renderSfx(name, 0), i * gap); });
    write(`sfx-${category}.wav`, buf);
  }
}

/* --------------------------------- verdict -------------------------------- */

console.log("");
if (faults.length > 0) {
  for (const f of faults) console.error(`audio: ${f}`);
  process.exit(1);
}
console.log("audio check: ok");
