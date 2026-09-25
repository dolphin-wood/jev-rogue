/**
 * Composites one frame of a live world exactly as the play scene would, and
 * writes it to a PNG. This checks the rendering logic (frame names, scale,
 * placement, mood tint) without a browser, and unlike a screenshot it is
 * reproducible: same seed, same tick, same image.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  GRID_W, GRID_H, TILE_PX, Tile, MAX_HEARTS, STEP_MS, ITEMS,
  RngSource, assembleEncounter, createWorld, generateRoom, plainInstance,
  step, toRoomPlan, worldCleared, PRESSURE_BANDS, PLAYABLE_ARCHETYPES,
  moodTransform, tintRGBA,
} from "@jr/core";
import type { Enemy, EnemyId, ItemInstance, Mood, World } from "@jr/core";
import { fillSubspecies } from "@jr/core";
import { referenceInput } from "../play/player-model.ts";
import { cellHash } from "../../../game/src/scenes/cell-hash.ts";

const ART_SCALE = 2;
const DIR = join(process.cwd(), "assets");
const atlas = JSON.parse(readFileSync(join(DIR, "sprites.json"), "utf8")) as {
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
};
const sheet = PNG.sync.read(readFileSync(join(DIR, "sprites.png")));

const ENEMY_FRAME: Record<EnemyId, string> = fillSubspecies<string>({
  rusher: "enemy_rusher", shooter: "enemy_shooter", turret: "enemy_turret",
  orbiter: "enemy_orbiter", tank: "enemy_tank", summoner: "enemy_summoner",
  lancer: "enemy_lancer", sentinel: "enemy_sentinel",
  warden: "enemy_warden", bellringer: "enemy_bellringer", rifter: "enemy_rifter",
  snarecaster: "enemy_snarecaster", delver: "enemy_delver", cinderling: "enemy_cinderling", sower: "enemy_sower",
  boss: "boss_p1",
});

const seed = process.argv[2] ?? "frame-1";
const ticks = Number(process.argv[3] ?? 180);
const out = process.argv[4] ?? "frame.png";

const src = new RngSource(seed);
const arch = PLAYABLE_ARCHETYPES[3]!;
const mood: Mood = { temperature: "cold", brightness: "dim", particle_intensity: "calm" };
const generated = generateRoom(
  { space: arch.id, symmetry: "mirrored", size: "standard", mood }, arch.doors[0]!, "combat", src.stream("room"),
);
const room = toRoomPlan(generated, { id: "f", seed_key: seed, reward_kind: "item", params_source: "rule" });
const encounter = assembleEncounter(
  { composition: "mixed", density: "normal", wave_structure: "steady", anchor: "none", entry: "far_front" },
  room, PRESSURE_BANDS.build, src.stream("enc"), { source: "rule" },
);
const staff = { slots: 6, mana_max: 120 };
const slots: (ItemInstance | null)[] = Array.from({ length: staff.slots }, (_, i) =>
  i === 0 ? plainInstance("magic_bolt") : i === 1 ? plainInstance("stone_shard") : null);

const world = createWorld({ room, encounter, staff, slots, hearts: MAX_HEARTS, rng: src.stream("gameplay") });
for (let i = 0; i < ticks && world.player.hearts > 0 && !worldCleared(world); i++)
  step(world, referenceInput(world), STEP_MS, ITEMS);

// The scene tints the sheet once per mood; do the same here.
const tinted = Uint8Array.from(sheet.data);
tintRGBA(tinted, moodTransform(mood));

const W = GRID_W * TILE_PX;
const H = GRID_H * TILE_PX + 40;
const img = new PNG({ width: W, height: H });
for (let i = 0; i < img.data.length; i += 4) {
  img.data[i] = 13; img.data[i + 1] = 11; img.data[i + 2] = 31; img.data[i + 3] = 255;
}

function blit(name: string, cx: number, cy: number, origin: "centre" | "corner" = "centre"): void {
  const r = atlas.frames[name];
  if (!r) return;
  const w = Math.round(r.w / ART_SCALE);
  const h = Math.round(r.h / ART_SCALE);
  const ox = Math.round(origin === "centre" ? cx - w / 2 : cx);
  const oy = Math.round(origin === "centre" ? cy - h / 2 : cy);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = r.x + Math.floor(x * ART_SCALE);
      const sy = r.y + Math.floor(y * ART_SCALE);
      const si = (sy * sheet.width + sx) * 4;
      const a = tinted[si + 3]! / 255;
      if (a === 0) continue;
      const px = ox + x;
      const py = oy + y;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const di = (py * W + px) * 4;
      for (let k = 0; k < 3; k++)
        img.data[di + k] = Math.round(tinted[si + k]! * a + img.data[di + k]! * (1 - a));
    }
}

const drains = drainCells(room.grid);
for (let y = 0; y < GRID_H; y++)
  for (let x = 0; x < GRID_W; x++) {
    const t = room.grid[y * GRID_W + x];
    blit(t === Tile.Floor || t === Tile.Prop ? floorFrame(x, y, drains) : wallFrame(room.grid, x, y), x * TILE_PX, y * TILE_PX, "corner");
  }
for (const zone of room.zones)
  if (zone.feature !== "none")
    for (const [cx, cy] of zone.cells) blit("hazard_spike_1", cx * TILE_PX, cy * TILE_PX, "corner");

for (const b of world.playerBullets) if (b.alive) blit("bullet_player_a_0", b.x, b.y);
for (const e of world.enemies) blit(enemyFrame(e), e.x, e.y);
for (const b of world.enemyBullets) if (b.alive) blit("bullet_enemy_a_0", b.x, b.y);
blit("player_s_idle0", world.player.x, world.player.y);
for (let i = 0; i < MAX_HEARTS; i++)
  blit(i < world.player.hearts ? "ui_heart_full" : "ui_heart_empty", 8 + i * 26, GRID_H * TILE_PX + 6, "corner");

writeFileSync(out, PNG.sync.write(img));
console.log(
  `${out}: tick ${world.tick}, ${world.enemies.length} enemies, ` +
  `${world.playerBullets.filter((b) => b.alive).length} player bullets, ` +
  `${world.enemyBullets.filter((b) => b.alive).length} enemy bullets, ` +
  `${world.player.hearts} hearts, space ${room.params.space}`,
);

function enemyFrame(e: Enemy): string {
  const base = ENEMY_FRAME[e.archetype];
  const phase = e.telegraphMs > 0 ? "tele" : "idle0";
  if (e.archetype === "turret") return `${base}_${phase}`;
  const deg = ((e.facing * 180) / Math.PI + 360) % 360;
  const side = deg >= 45 && deg < 135 ? "s" : deg >= 225 && deg < 315 ? "n" : "w";
  return `${base}_${side}_${phase}`;
}

export type { World };

/**
 * Floor frames. `tile_floor_3` is a drain grate, which is an object rather
 * than a texture: scattering it like wear puts a drain on one tile in eight
 * and the room reads as a sewer grid. Wear (1 and 2) scatters; drains are
 * placed, two per room, at hashed floor cells.
 */
// The game's own cell hash, so a frame here lays the floor the game does.
const hash2 = cellHash;

function floorFrame(x: number, y: number, drains: ReadonlySet<number>): string {
  if (drains.has(y * GRID_W + x)) return "tile_floor_3";
  const h = hash2(x, y);
  return h % 6 === 0 ? `tile_floor_${1 + (h >>> 3) % 2}` : "tile_floor_0";
}

/** Two drains per room, deterministic in the grid so they never flicker. */
function drainCells(grid: Uint8Array): Set<number> {
  const floor: number[] = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] === Tile.Floor) floor.push(i);
  const out = new Set<number>();
  if (floor.length === 0) return out;
  for (let n = 0; n < 2; n++) {
    const pick = floor[(hash2(n + 1, floor.length) % floor.length)];
    if (pick !== undefined) out.add(pick);
  }
  return out;
}

/**
 * Picks the wall frame from which sides face open floor, so a wall gets its
 * lit cap and reads as a wall. Drawing `tile_wall_c` everywhere leaves the
 * blocks flat and nearly indistinguishable from the floor, which in a bullet
 * hell means not knowing where you can move.
 */
function wallFrame(grid: Uint8Array, x: number, y: number): string {
  const open = (dx: number, dy: number): boolean => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) return false;
    const tile = grid[ny * GRID_W + nx];
    return tile === Tile.Floor || tile === Tile.Prop;
  };
  const cases = [
    "solid", "n", "e", "ne", "s", "ns", "es", "nes",
    "w", "wn", "ew", "wne", "sw", "swn", "esw", "nesw",
  ] as const;
  let mask = 0;
  if (open(0, -1)) mask |= 1;
  if (open(1, 0)) mask |= 2;
  if (open(0, 1)) mask |= 4;
  if (open(-1, 0)) mask |= 8;
  return `tile_wall_${cases[mask]!}`;
}
