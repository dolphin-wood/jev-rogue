/**
 * Prints a region of any delivered frame as a `.px` part, in a model's
 * palette and letters, for pasting into that model's `<facing>.px` as a new
 * variant (doc 016). This is how an existing drawing — a raised arm in some
 * other sheet — becomes a part rather than being drawn again.
 *
 * Run: `pnpm sprite:cut <body> <frame> <x0,y0,x1,y1> <part.variant> [pivot x,y]`
 * (the rectangle is in frame pixels, end exclusive; the pivot is in frame
 * pixels too and defaults to the rectangle's centre).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deliveredFrame } from "../assets/art.ts";
import { MANIFEST } from "../assets/manifest.ts";
import { MODELS_DIR } from "../assets/models.ts";
import { quantise, type MaterialRule, type Palette } from "../assets/palette.ts";
import { assignLetters, writePx, type Shade } from "../assets/px.ts";

const [body, frame, rect, name, pivotArg] = process.argv.slice(2);
if (!body || !frame || !rect || !name?.includes(".")) throw new Error("usage: sprite-cut <body> <frame> <x0,y0,x1,y1> <part.variant> [pivot x,y]");
const dir = join(MODELS_DIR.pathname, body);
const palette = JSON.parse(readFileSync(join(dir, "palette.json"), "utf8")) as Palette;
const split = JSON.parse(readFileSync(join(dir, "split.json"), "utf8")) as { rules: MaterialRule[]; outlineLuma: number };
const spec = MANIFEST.find((f) => f.name === frame);
if (!spec) throw new Error(`no manifest frame ${frame}`);
const png = deliveredFrame(spec);
const [x0, y0, x1, y1] = rect.split(",").map(Number) as [number, number, number, number];
const [px0, py0] = pivotArg ? pivotArg.split(",").map(Number) as [number, number] : [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)];
const px: (Shade | null)[] = [];
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
  const i = (y * png.width + x) * 4;
  px.push(png.data[i + 3] ? quantise([png.data[i]!, png.data[i + 1]!, png.data[i + 2]!], palette, split.rules, split.outlineLuma) : null);
}
const [part, variant] = name.split(".") as [string, string];
const text = writePx(assignLetters(palette.ramps), [{ part, variant, pivot: [px0 - x0, py0 - y0], joints: {}, w: x1 - x0, h: y1 - y0, px }]);
// The legend is the model's; print only the part, for pasting under it.
console.log(text.split("\n").slice(2).join("\n"));
