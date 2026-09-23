/**
 * Generates a complete, spec-valid placeholder sheet so the renderer can be
 * built and run before real art exists. Dropping the real sprites.png and
 * sprites.json into assets/ is the whole integration step.
 *
 * It is also the checker's fixture: if the checker passes this and rejects the
 * deliberately broken variants in the tests, the checker itself works.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { MANIFEST, SIZE, PALETTE_SLOTS } from "./manifest.ts";
import type { FrameSpec, SlotName } from "./manifest.ts";

const SHEET_W = 2048;

export const PLACEHOLDER_MARKER = ".placeholder";

function rgba(slot: SlotName): [number, number, number, number] {
  const v = parseInt(PALETTE_SLOTS[slot].slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
}

interface Tile {
  w: number;
  h: number;
  px: Uint8Array; // rgba
}

function blank(w: number, h: number): Tile {
  return { w, h, px: new Uint8Array(w * h * 4) };
}

function set(t: Tile, x: number, y: number, slot: SlotName) {
  if (x < 0 || y < 0 || x >= t.w || y >= t.h) return;
  const [r, g, b, a] = rgba(slot);
  const i = (y * t.w + x) * 4;
  t.px[i] = r; t.px[i + 1] = g; t.px[i + 2] = b; t.px[i + 3] = a;
}

/** Symmetric shapes only, so the content bounding box is centred by construction. */
function blob(t: Tile, margin: number, fill: SlotName, edge: SlotName, kind: "round" | "diamond" | "square") {
  const lo = margin;
  const hi = t.w - 1 - margin;
  const c = (t.w - 1) / 2;
  const r = (hi - lo) / 2 + 0.5;
  for (let y = lo; y <= hi; y++) {
    for (let x = lo; x <= hi; x++) {
      const dx = Math.abs(x - c);
      const dy = Math.abs(y - c);
      const inside =
        kind === "round" ? Math.hypot(dx, dy) <= r
        : kind === "diamond" ? dx + dy <= r + 0.5
        : true;
      if (!inside) continue;
      const onEdge =
        kind === "round" ? Math.hypot(dx, dy) > r - 1
        : kind === "diamond" ? dx + dy > r - 0.5
        : x === lo || x === hi || y === lo || y === hi;
      set(t, x, y, onEdge ? edge : fill);
    }
  }
}

/** A symmetric pair of highlight pixels keeps the bounding box centred. */
function glint(t: Tile, slot: SlotName, dy: number) {
  const c = (t.w - 1) / 2;
  set(t, Math.floor(c) - 1, Math.floor(c) + dy, slot);
  set(t, Math.ceil(c) + 1, Math.floor(c) + dy, slot);
}

function fillAll(t: Tile, slot: SlotName) {
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) set(t, x, y, slot);
}

function draw(spec: FrameSpec): Tile {
  const n = SIZE[spec.size];
  const t = blank(spec.width ?? n, spec.height ?? n);
  const name = spec.name;
  const alt = name.endsWith("1") || name.endsWith("idle1");
  const tele = name.endsWith("tele");

  if (name.startsWith("vfx_bolt_")) {
    const frame = Number(name.at(-1));
    const top = 3, bottom = frame === 0 ? Math.floor(t.h * 0.68) : t.h - 1;
    for (let y = top; y <= bottom; y++) {
      if (frame === 2 && Math.floor(y / 10) % 2 === 1) continue;
      const x = Math.round(t.w / 2 + Math.sin(y * 0.22) * (frame === 1 ? 5 : 3));
      set(t, x - 1, y, "cool"); set(t, x, y, "bone"); set(t, x + 1, y, "cool");
    }
    if (frame === 1) for (let d = -9; d <= 9; d++)
      set(t, Math.round(t.w / 2) + d, t.h - 1 - Math.floor(Math.abs(d) / 3), "bone");
    return t;
  }

  // Terrain and flat decor fill the frame edge to edge.
  if (name.startsWith("tile_floor")) {
    fillAll(t, "shadow");
    const seed = name.charCodeAt(name.length - 1);
    for (let i = 0; i < 4; i++) set(t, (seed * (i + 3)) % n, (seed * (i + 7)) % n, "body");
    return t;
  }
  if (name.startsWith("tile_wall")) {
    fillAll(t, "body");
    for (let x = 0; x < n; x++) set(t, x, 0, "light");
    for (let y = 0; y < n; y++) set(t, 0, y, "ink");
    return t;
  }
  if (name.startsWith("hazard_")) {
    fillAll(t, "shadow");
    for (let i = 0; i < n; i++) {
      set(t, i, 0, "ink"); set(t, i, n - 1, "ink");
      set(t, 0, i, "ink"); set(t, n - 1, i, "ink");
    }
    for (let i = 2; i < n - 2; i += alt ? 3 : 4) set(t, i, Math.floor(n / 2), "amber");
    return t;
  }
  if (name === "ui_mana_pip") {
    for (let y = 2; y < n - 2; y++) for (let x = 6; x < 10; x++) set(t, x, y, "cool");
    for (let y = 2; y < n - 2; y++) { set(t, 6, y, "ink"); set(t, 9, y, "ink"); }
    return t;
  }
  if (name === "ui_card_frame") {
    for (let i = 0; i < n; i++) { set(t, i, 0, "light"); set(t, 0, i, "light"); }
    set(t, 0, 0, "ink");
    return t;
  }

  // Centred entity-like sprites.
  const kind: "round" | "diamond" | "square" =
    name.includes("rusher") || name.startsWith("bullet_player_a") ? "diamond"
    : name.startsWith("tile_") || name.startsWith("prop_pillar") ? "square"
    : "round";

  if (tele) {
    // Amber body with a small magenta core, not a magenta body. A telegraph
    // whose dominant hue is the reserved enemy-bullet colour never tints and
    // reads as a giant bullet, which the checker rejects.
    blob(t, 2, "amber", "ink", kind);
    glint(t, "hot", 0);
    return t;
  }
  if (name.startsWith("bullet_enemy")) {
    blob(t, 1, "hot", "ink", "round");
    set(t, 3, alt ? 3 : 4, "bone");
    set(t, 4, alt ? 3 : 4, "bone");
    // Even outlines/highlights belong to the protected magenta band.
    for (let i = 0; i < t.px.length; i += 4) {
      if (!t.px[i + 3]) continue;
      if (t.px[i] === 13) t.px.set([72, 10, 43, 255], i);
      else if (t.px[i] === 232) t.px.set([255, 228, 242, 255], i);
    }
    return t;
  }
  if (name.startsWith("bullet_player")) {
    blob(t, 1, "cool", "ink", kind);
    set(t, 3, alt ? 3 : 4, "bone");
    set(t, 4, alt ? 3 : 4, "bone");
    return t;
  }
  if (name.startsWith("player_")) {
    blob(t, alt ? 2 : 1, "body", "ink", "round");
    glint(t, "cool", alt ? -1 : 0);
    return t;
  }
  if (name === "ui_heart_full") {
    blob(t, 3, "hot", "ink", "diamond");
    glint(t, "bone", -1);
    return t;
  }
  if (name === "ui_heart_empty") {
    blob(t, 3, "shadow", "ink", "diamond");
    return t;
  }
  if (name.startsWith("icon_door_")) {
    blob(t, 3, "bone", "ink", kind);
    return t;
  }
  if (name.startsWith("prop_")) {
    blob(t, 2, "body", "ink", kind);
    glint(t, "amber", alt ? 1 : 0);
    return t;
  }
  // Enemy placeholders must exercise the same value-separation contract as
  // production art. Bosses are exempt because they do not share the enemy_
  // namespace checked by the delivery validator.
  if (name.startsWith("enemy_")) {
    blob(t, alt ? 2 : 1, "light", "ink", kind);
    glint(t, "bone", alt ? -1 : 0);
    return t;
  }
  // boss and remaining entity-like frames
  blob(t, alt ? 2 : 1, "shadow", "ink", kind);
  glint(t, "light", alt ? -1 : 0);
  return t;
}

export function generatePlaceholders(dir: string): { frames: number; sheet: [number, number] } {
  mkdirSync(dir, { recursive: true });
  const tiles = MANIFEST.map((spec) => ({ spec, tile: draw(spec) }));
  // shelf pack, tallest first, so rows stay tight
  const order = [...tiles].sort((a, b) => b.tile.h - a.tile.h);
  const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
  let x = 0, y = 0, rowH = 0;
  for (const { spec, tile } of order) {
    if (x + tile.w > SHEET_W) { x = 0; y += rowH; rowH = 0; }
    frames[spec.name] = { x, y, w: tile.w, h: tile.h };
    x += tile.w;
    rowH = Math.max(rowH, tile.h);
  }
  const height = y + rowH;
  const png = new PNG({ width: SHEET_W, height });
  png.data.fill(0);
  for (const { spec, tile } of order) {
    const r = frames[spec.name]!;
    for (let ty = 0; ty < tile.h; ty++)
      for (let tx = 0; tx < tile.w; tx++) {
        const si = (ty * tile.w + tx) * 4;
        const di = ((r.y + ty) * SHEET_W + (r.x + tx)) * 4;
        png.data[di] = tile.px[si]!;
        png.data[di + 1] = tile.px[si + 1]!;
        png.data[di + 2] = tile.px[si + 2]!;
        png.data[di + 3] = tile.px[si + 3]!;
      }
  }
  writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
  const anchorPath = new URL("../../../../assets/source/player-anchors.json", import.meta.url);
  const playerAnchors = JSON.parse(readFileSync(anchorPath, "utf8")) as Record<string, unknown>;
  writeFileSync(join(dir, "sprites.json"), JSON.stringify({ frames, playerAnchors }, null, 2) + "\n");
  // Marks the delivery as generated, so tooling may regenerate it freely.
  // Real art never carries this file and is therefore never overwritten.
  writeFileSync(join(dir, PLACEHOLDER_MARKER), "generated by pnpm assets:placeholder\n");
  return { frames: MANIFEST.length, sheet: [SHEET_W, height] };
}
