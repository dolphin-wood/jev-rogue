/**
 * How far every body actually moves between frames (doc 016).
 *
 * Prints, per body and cycle: the mean silhouette change between consecutive
 * frames, the change between the cycle's two most different frames, and how
 * far the feet, hands and head travel across it — the numbers
 * `amplitude.test.ts` asserts. `--facing` picks one; the default is the side
 * view, which is where a gait reads.
 *
 * Run: `pnpm sprite:amplitude [body] [--facing w] [--all]`
 */
import { loadModel, modelNames, type Facing } from "../assets/models.ts";
import { measureModel, poseDistance } from "../assets/amplitude.ts";

const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith("--"));
const facing = (args[args.indexOf("--facing") + 1] ?? "w") as Facing;
const all = args.includes("--all");

const row = (a: string, b: string, c: string, d: string, e: string) =>
  `${a.padEnd(14)} ${b.padEnd(9)} ${c.padStart(6)} ${d.padStart(9)}  ${e}`;
console.log(row("body", "cycle", "step", "extremes", "part travel, art px"));
for (const name of only ? [only] : modelNames()) {
  const model = loadModel(name);
  for (const m of measureModel(name, model)) {
    if (!all && m.facing !== facing && model.anims.facings.includes(facing)) continue;
    const parts = Object.entries(m.travel).filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]).map(([p, v]) => `${p} ${v}`).join("  ") || "nothing moves";
    console.log(row(`${name}`, `${m.cycle}x${m.frames}`, m.step.toFixed(3), m.extremes.toFixed(3), parts));
  }
  for (const [a, b] of [["windup", "lunge"], ["windup", "follow"], ["swing_windup", "strike"], ["swing_windup", "follow"]]) {
    const d = poseDistance(model, model.anims.facings.includes(facing) ? facing : model.anims.facings[0]!, a!, b!);
    if (d !== null) console.log(row(name, `${a}→${b}`, "", d.toFixed(3), ""));
  }
}
