/**
 * The `.px` text pixel format sprite model parts are drawn in (doc 016).
 *
 * ```
 * legend outline:k cloth:abcd trim:efgh
 *
 * part arm_near.forward pivot 2,1
 * joint grip 4,5
 * ..aab.
 * .abbcc
 * ```
 *
 * One character per pixel. A letter is a material shade, darkest first, from
 * the file's `legend`; `.` is transparent. A part is `part <name>.<variant>`
 * followed by its `pivot` (the pixel that sits on its parent's joint, or the
 * frame origin for the root), any `joint` lines, and its rows up to the next
 * blank line. `#` starts a comment line.
 */

/** A material shade: the material's name and its index in the ramp, darkest first. */
export interface Shade { readonly material: string; readonly shade: number }

export interface PxPart {
  readonly part: string;
  readonly variant: string;
  readonly pivot: readonly [number, number];
  readonly joints: Readonly<Record<string, readonly [number, number]>>;
  readonly w: number;
  readonly h: number;
  /** Row-major, `null` for transparent. */
  readonly px: readonly (Shade | null)[];
}

export interface PxFile {
  /** Letter → shade. */
  readonly legend: ReadonlyMap<string, Shade>;
  readonly parts: readonly PxPart[];
}

const XY = /^(-?\d+),(-?\d+)$/;

function xy(s: string | undefined, where: string): [number, number] {
  const m = s?.match(XY);
  if (!m) throw new Error(`${where}: expected x,y, got ${s ?? "nothing"}`);
  return [Number(m[1]), Number(m[2])];
}

export function parseLegend(spec: string): Map<string, Shade> {
  const legend = new Map<string, Shade>();
  for (const entry of spec.trim().split(/\s+/)) {
    const [material, letters] = entry.split(":");
    if (!material || !letters) throw new Error(`legend: bad entry ${entry}`);
    [...letters].forEach((ch, shade) => {
      if (ch === "." || legend.has(ch)) throw new Error(`legend: letter ${ch} reused`);
      legend.set(ch, { material, shade });
    });
  }
  return legend;
}

export function parsePx(text: string, file = "<px>"): PxFile {
  const lines = text.split("\n");
  let legend: Map<string, Shade> | null = null;
  const parts: PxPart[] = [];
  let i = 0;
  const fail = (msg: string): never => { throw new Error(`${file}:${i + 1}: ${msg}`); };
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("#")) { i++; continue; }
    if (line.startsWith("legend ")) { legend = parseLegend(line.slice(7)); i++; continue; }
    if (!line.startsWith("part ")) fail(`expected legend or part, got "${line}"`);
    if (!legend) fail("part before legend");
    const words = line.split(/\s+/);
    const [part, variant] = (words[1] ?? "").split(".");
    if (!part || !variant) fail("part needs <name>.<variant>");
    const pivotAt = words.indexOf("pivot");
    const pivot = pivotAt > 0 ? xy(words[pivotAt + 1], `${file}:${i + 1}`) : fail("part needs a pivot");
    const joints: Record<string, [number, number]> = {};
    const rows: string[] = [];
    i++;
    while (i < lines.length && lines[i]!.trim() !== "") {
      const l = lines[i]!.trim();
      if (l.startsWith("#")) { i++; continue; }
      if (l.startsWith("joint ")) {
        const [, name, at] = l.split(/\s+/);
        joints[name!] = xy(at, `${file}:${i + 1}`);
      } else rows.push(l);
      i++;
    }
    const w = Math.max(0, ...rows.map((r) => r.length));
    const px: (Shade | null)[] = [];
    rows.forEach((r, y) => {
      for (let x = 0; x < w; x++) {
        const ch = r[x] ?? ".";
        if (ch === ".") { px.push(null); continue; }
        const s = legend!.get(ch);
        if (!s) throw new Error(`${file}: part ${part}.${variant} row ${y}: letter ${ch} not in legend`);
        px.push(s);
      }
    });
    parts.push({ part: part!, variant: variant!, pivot, joints, w, h: rows.length, px });
  }
  if (!legend) throw new Error(`${file}: no legend`);
  return { legend, parts };
}

/** Writes parts back out; the legend's letters are reused for their shades. */
export function writePx(legend: ReadonlyMap<string, Shade>, parts: readonly PxPart[], header = ""): string {
  const byMaterial = new Map<string, string[]>();
  for (const [ch, s] of legend) {
    const list = byMaterial.get(s.material) ?? [];
    list[s.shade] = ch;
    byMaterial.set(s.material, list);
  }
  const letterOf = new Map<string, string>();
  for (const [ch, s] of legend) letterOf.set(`${s.material}.${s.shade}`, ch);
  const out: string[] = [];
  if (header) out.push(...header.trimEnd().split("\n").map((l) => `# ${l}`), "");
  out.push("legend " + [...byMaterial].map(([m, l]) => `${m}:${l.join("")}`).join(" "), "");
  for (const p of parts) {
    out.push(`part ${p.part}.${p.variant} pivot ${p.pivot[0]},${p.pivot[1]}`);
    for (const [name, [x, y]] of Object.entries(p.joints)) out.push(`joint ${name} ${x},${y}`);
    for (let y = 0; y < p.h; y++) {
      let row = "";
      for (let x = 0; x < p.w; x++) {
        const s = p.px[y * p.w + x];
        row += s ? letterOf.get(`${s.material}.${s.shade}`) ?? "?" : ".";
      }
      out.push(row.replace(/\.+$/, "") || ".");
    }
    out.push("");
  }
  return out.join("\n");
}

/** Letters handed out to a palette's shades, material by material, in order. */
export function assignLetters(ramps: Readonly<Record<string, readonly unknown[]>>): Map<string, Shade> {
  const pool = "abcdefghijlmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  const legend = new Map<string, Shade>();
  let n = 0;
  const reserved: Record<string, string> = { outline: "k" };
  for (const [material, ramp] of Object.entries(ramps)) {
    ramp.forEach((_, shade) => {
      let ch = reserved[material] && shade === 0 ? reserved[material]! : "";
      while (!ch || legend.has(ch) || (ch === "k" && material !== "outline")) ch = pool[n++]!;
      legend.set(ch, { material, shade });
    });
  }
  return legend;
}
