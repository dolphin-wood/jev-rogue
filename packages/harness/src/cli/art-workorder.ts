/**
 * Emits the art work order: every frame the melee design needs, its size, and
 * whether it already exists, needs renaming, or has to be drawn.
 *
 * Generated rather than written by hand so the list cannot drift from the
 * naming rules or contain a typo, and so the counts in the brief are true.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LEGACY_MANIFEST, MANIFEST, SIZE } from "../assets/manifest.ts";
import type { SizeClass } from "../assets/manifest.ts";

type Row = { name: string; size: SizeClass; status: "reuse" | "rename" | "draw"; from?: string; px?: string };

const rows: Row[] = [];
const have = new Map(LEGACY_MANIFEST.map((f) => [f.name, f.size]));
/** Frames whose art carries over under a new name. */
const RENAMES: Record<string, string> = {
  tile_wall_solid: "tile_wall_c",
  tile_wall_wn: "tile_wall_nw",
  tile_wall_es: "tile_wall_se",
};

/**
 * `px` overrides the size class for the handful of frames that are not
 * square. The manifest's size classes are square by construction, and the
 * swing strip has to be long and shallow because it is mapped around an arc
 * rather than drawn as a shape.
 */
function want(name: string, size: SizeClass, px?: string): void {
  const from = RENAMES[name];
  const base = { name, size, ...(px ? { px } : {}) };
  if (from && have.has(from)) rows.push({ ...base, status: "rename", from });
  else if (have.has(name)) rows.push({ ...base, status: "reuse" });
  else rows.push({ ...base, status: "draw" });
}

for (const spec of MANIFEST)
  want(
    spec.name,
    spec.size,
    spec.width || spec.height ? `${spec.width ?? SIZE[spec.size]}x${spec.height ?? SIZE[spec.size]}` : undefined,
  );

const counts = { reuse: 0, rename: 0, draw: 0 };
for (const r of rows) counts[r.status]++;
const retired = LEGACY_MANIFEST.map((f) => f.name)
  .filter((n) => !rows.some((r) => r.name === n || r.from === n)).sort();

const out = {
  total: rows.length,
  counts,
  retired,
  drawBySize: Object.fromEntries(
    (["s32", "s64", "s96", "s256"] as SizeClass[]).map((s) => [
      `${SIZE[s]}px`, rows.filter((r) => r.status === "draw" && r.size === s).length,
    ]),
  ),
  frames: rows.map((r) => ({ name: r.name, px: r.px ?? `${SIZE[r.size]}x${SIZE[r.size]}`, status: r.status, ...(r.from ? { from: r.from } : {}) })),
};
const outputPath = fileURLToPath(new URL("../../../../assets/source/frames-melee.json", import.meta.url));
writeFileSync(outputPath, JSON.stringify(out, null, 2) + "\n");
console.log(`total ${out.total}  reuse ${counts.reuse}  rename ${counts.rename}  draw ${counts.draw}`);
console.log("to draw, by size:", out.drawBySize);
console.log(`retired ${retired.length}: ${retired.join(" ")}`);
console.log(`written to ${outputPath}`);
