/**
 * Draws part variants from strokes into a sprite model (doc 016's shape fill).
 *
 * Reads `assets/models/<body>/shapes.json`:
 *
 * ```
 * { "bands": { "sleeve": { "material": "cloth", "shadowEdge": 0, ... } },
 *   "parts": [ { "facing": "s", "part": "arm_sword", "variant": "cross",
 *                "pivot": [21, 30], "joints": { "hand": [34, 34] },
 *                "strokes": [ { "kind": "capsule", "from": [21, 30], "to": [34, 34],
 *                               "width": [7, 5], "bands": "sleeve" }, … ] }, … ] }
 * ```
 *
 * Coordinates are frame pixels, as the split measures them, so a drawn part
 * sits where a split one would. Each drawing replaces the variant of that
 * name in `<facing>.px` and leaves every other drawing as it is. The strokes
 * start a drawing; once written, the `.px` is the source and may be touched
 * up by hand — run this again only to redraw from the strokes.
 *
 * Run: `pnpm sprite:draw <body> [part.variant …]`
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MODELS_DIR, type Facing } from "../assets/models.ts";
import { assignLetters, parsePx, writePx, type PxPart } from "../assets/px.ts";
import { paint, toPart, type Bands, type Stroke } from "../assets/shapes.ts";
import type { Palette } from "../assets/palette.ts";

type RawStroke =
  | { kind: "capsule"; from: [number, number]; to: [number, number]; width: [number, number]; bands: string }
  | { kind: "disc"; at: [number, number]; r: number; bands: string };

interface Shapes {
  readonly bands: Readonly<Record<string, Bands>>;
  readonly parts: readonly {
    readonly facing: Facing;
    readonly part: string;
    readonly variant: string;
    readonly pivot: [number, number];
    readonly joints?: Record<string, [number, number]>;
    readonly outline?: boolean;
    readonly strokes: readonly RawStroke[];
  }[];
}

function outlined(part: PxPart): PxPart {
  const w = part.w + 2, h = part.h + 2;
  const px: (PxPart["px"][number])[] = new Array(w * h).fill(null);
  for (let y = 0; y < part.h; y++) for (let x = 0; x < part.w; x++) {
    if (!part.px[y * part.w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      px[(y + dy + 1) * w + x + dx + 1] = { material: "outline", shade: 0 };
  }
  for (let y = 0; y < part.h; y++) for (let x = 0; x < part.w; x++) {
    const shade = part.px[y * part.w + x];
    if (shade) px[(y + 1) * w + x + 1] = shade;
  }
  return {
    ...part, w, h, px,
    pivot: [part.pivot[0] + 1, part.pivot[1] + 1],
    joints: Object.fromEntries(Object.entries(part.joints).map(([key, [x, y]]) => [key, [x + 1, y + 1]])),
  };
}

const [body, ...only] = process.argv.slice(2);
if (!body) throw new Error("usage: sprite-draw <body> [part.variant …]");
const dir = join(MODELS_DIR.pathname, body);
const shapes = JSON.parse(readFileSync(join(dir, "shapes.json"), "utf8")) as Shapes;
const palette = JSON.parse(readFileSync(join(dir, "palette.json"), "utf8")) as Palette;
const rig = JSON.parse(readFileSync(join(dir, "rig.json"), "utf8")) as { size: [number, number] };
const [W, H] = rig.size;
const legend = assignLetters(palette.ramps);

const drawn = new Map<Facing, PxPart[]>();
for (const spec of shapes.parts) {
  const name = `${spec.part}.${spec.variant}`;
  if (only.length && !only.includes(name)) continue;
  const strokes: Stroke[] = spec.strokes.map((s) => {
    const bands = shapes.bands[s.bands];
    if (!bands) throw new Error(`${name}: no bands ${s.bands}`);
    return s.kind === "disc" ? { kind: "disc", at: s.at, r: s.r, bands } : { kind: "capsule", from: s.from, to: s.to, width: s.width, bands };
  });
  const drawnPart = toPart(paint(strokes, W, H), W, H, spec.part, spec.variant, spec.pivot, spec.joints ?? {});
  const part = spec.outline ? outlined(drawnPart) : drawnPart;
  (drawn.get(spec.facing) ?? drawn.set(spec.facing, []).get(spec.facing)!).push(part);
}

for (const [facing, parts] of drawn) {
  const file = join(dir, `${facing}.px`);
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const existing = text ? parsePx(text, file).parts : [];
  const replaced = new Set(parts.map((p) => `${p.part}.${p.variant}`));
  const header = text.split("\n").filter((l) => l.startsWith("# ")).map((l) => l.slice(2)).join("\n");
  writeFileSync(file, writePx(legend, [...existing.filter((p) => !replaced.has(`${p.part}.${p.variant}`)), ...parts], header));
  console.log(`${facing}.px: ${parts.length} drawn (${[...replaced].join(", ")})`);
}
