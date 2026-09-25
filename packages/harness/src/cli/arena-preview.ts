/**
 * **The boss fight, in context, without a browser.**
 *
 * `ground:preview` bakes the drawings on a blank floor, which answers "is the
 * ring a circle" and does not answer "does any of this read". This steps a
 * **real boss fight** — the `boss-bench` fixture at the `average` profile — to
 * the moment asked for, and bakes the room's own floor, its stone, the
 * bodies, the bullets and `ground.ts`'s own drawings into one picture, at the
 * scale the game renders them.
 *
 * Run: `pnpm arena:preview [out.png] [shock|lash|air] [phase] [scale]`
 */
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import {
  BOSS_ARCHETYPES, GRID_H, GRID_W, RngSource, TILE_PX, Tile, attachAffix, createWorld,
  generateRoom, makeEnemy, noMods, plainInstance, runStaff, step, toRoomPlan, withLevel, applyStat,
} from "@jr/core";
import type { ItemInstance, PlayerMods } from "@jr/core";
import { drawArms, drawShockwaves } from "../../../game/src/scenes/ground.ts";
import type { Pen } from "../../../game/src/scenes/ground.ts";
import { SKILL_PROFILES } from "../play/skill.ts";
import { referenceInput } from "../play/player-model.ts";

const W = GRID_W * TILE_PX;
const H = GRID_H * TILE_PX;

function build() {
  const src = new RngSource("arena");
  const staff = runStaff();
  const spells = [
    { id: "magic_bolt", level: 4, affixes: [["scatter", 2], ["kindle", 2], ["repeat", 1]] as [string, number][] },
    { id: "frost_needle", level: 3, affixes: [["seek", 2], ["fork", 1], ["rime", 1]] as [string, number][] },
  ];
  const slots: (ItemInstance | null)[] = Array.from({ length: staff.slots }, (_, i) => {
    const s = spells[i];
    return s ? plainInstance(s.id, `${s.id}-fixture`) : null;
  });
  let mods: PlayerMods = noMods();
  mods = applyStat(mods, "vigour");
  mods = applyStat(mods, "focus");
  const space = BOSS_ARCHETYPES[0]!.id;
  const g = generateRoom(
    { space, symmetry: "mirrored", size: "standard", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "boss", src.stream("fixed", 1), { plain: true },
  );
  const plan = toRoomPlan(g, { id: "fixed-boss", seed_key: "fixed-boss", reward_kind: "item", params_source: "rule" });
  const world = createWorld({
    room: plan, encounter: null, staff, slots, hearts: 7,
    rng: src.stream("gameplay", 1), mods, rage: 0, coinBoost: 1, roomIndex: 16, placement: "waves",
  });
  spells.forEach((s, i) => {
    let slot = world.spells[i];
    if (!slot) return;
    for (const [id, t] of s.affixes) slot = attachAffix(slot, id, t) ?? slot;
    if (s.level > 1) slot = withLevel(slot, s.level);
    world.spells[i] = slot;
  });
  const boss = makeEnemy(world.nextEnemyId++, "boss", (GRID_W / 2) * TILE_PX, (GRID_H / 2) * TILE_PX, []);
  boss.spawnFadeMs = 0;
  boss.awake = true;
  world.enemies.push(boss);
  return { world, boss };
}

type Want = "shock" | "lash" | "air";

function run(want: Want, phase: number) {
  const { world, boss } = build();
  const prof = SKILL_PROFILES.average;
  for (let i = 0; i < 60 * 240; i++) {
    if (phase >= 2 && boss.hp > boss.maxHp * 0.55) boss.hp = boss.maxHp * 0.5;
    if (phase >= 3 && boss.hp > boss.maxHp * 0.28) boss.hp = boss.maxHp * 0.25;
    step(world, referenceInput(world, prof));
    if (want === "shock" && world.shockwaves.some((s) => s.alive && s.chargeMs <= 0 && s.inner > 90 && s.inner < 170)) break;
    if (want === "lash" && world.arms.some((a) => a.alive && a.teleMs <= 0)) break;
    if (want === "air" && boss.airborne && boss.bossLift > 50) break;
  }
  return { world, boss };
}

const png = new PNG({ width: W, height: H });

function plot(x: number, y: number, colour: number, alpha: number, add: boolean): void {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= W || py >= H || alpha <= 0) return;
  const i = (py * W + px) * 4;
  const r = (colour >> 16) & 255;
  const g = (colour >> 8) & 255;
  const b = colour & 255;
  const a = Math.min(1, alpha);
  if (add) {
    png.data[i] = Math.min(255, png.data[i]! + r * a);
    png.data[i + 1] = Math.min(255, png.data[i + 1]! + g * a);
    png.data[i + 2] = Math.min(255, png.data[i + 2]! + b * a);
  } else {
    png.data[i] = Math.round(png.data[i]! * (1 - a) + r * a);
    png.data[i + 1] = Math.round(png.data[i + 1]! * (1 - a) + g * a);
    png.data[i + 2] = Math.round(png.data[i + 2]! * (1 - a) + b * a);
  }
}

function makePen(add: boolean): Pen {
  let fc = 0xffffff;
  let fa = 1;
  const pen: Pen = {
    lineStyle: () => pen,
    fillStyle(colour, alpha = 1) { fc = colour; fa = alpha; return pen; },
    strokeCircle: () => pen,
    fillCircle(x, y, r) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
        if (dx * dx + dy * dy <= r * r) plot(x + dx, y + dy, fc, fa, add);
      return pen;
    },
    fillRect(x, y, w, h) {
      for (let py = Math.round(y); py < Math.round(y + h); py++)
        for (let px = Math.round(x); px < Math.round(x + w); px++) plot(px, py, fc, fa, add);
      return pen;
    },
    lineBetween: () => pen,
    beginPath: () => pen,
    moveTo: () => pen,
    lineTo: () => pen,
    arc: () => pen,
    strokePath: () => pen,
    fillPath: () => pen,
  };
  return pen;
}

function disc(x: number, y: number, r: number, colour: number, edge = 0x120d20): void {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const d = Math.hypot(dx, dy);
    if (d > r) continue;
    plot(x + dx, y + dy, d > r - 2 ? edge : colour, 1, false);
  }
}

const want = (process.argv[3] ?? "shock") as Want;
const phase = Number(process.argv[4] ?? 1);
const { world, boss } = run(want, phase);

// The floor and the stone, at the room's own grid.
for (let gy = 0; gy < GRID_H; gy++) for (let gx = 0; gx < GRID_W; gx++) {
  const t = world.room.grid[gy * GRID_W + gx];
  for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) {
    const px = gx * TILE_PX + x;
    const py = gy * TILE_PX + y;
    const grain = ((px * 7 + py * 13) % 11) - 5;
    let base = [34, 30, 52];
    if (t === Tile.Wall) base = [22, 19, 36];
    if (t === Tile.Pillar) base = [58, 50, 78];
    if ((gx + gy) % 2 === 0 && t === Tile.Floor) base = [38, 34, 56];
    const i = (py * W + px) * 4;
    png.data[i] = base[0]! + grain;
    png.data[i + 1] = base[1]! + grain;
    png.data[i + 2] = base[2]! + grain;
    png.data[i + 3] = 255;
  }
}

const ground = makePen(false);
const glow = makePen(true);
const view = { x0: 0, y0: 0, x1: W, y1: H };
drawShockwaves(ground, glow, world.shockwaves, world.tick * 16.667, view);
drawArms(ground, glow, world.arms);

// Bodies: the boss (lifted while it flies, with its shadow on the floor), the
// adds, and the player.
for (const e of world.enemies) {
  if (e.hp <= 0) continue;
  const lift = e.bossLift ?? 0;
  const air = Math.min(1, Math.abs(lift) / 84);
  for (let dy = -e.radius * 0.6; dy <= e.radius * 0.6; dy++)
    for (let dx = -e.radius * 1.4; dx <= e.radius * 1.4; dx++) {
      const s = 1 - 0.45 * air;
      if ((dx / (e.radius * 1.4 * s)) ** 2 + (dy / (e.radius * 0.6 * s)) ** 2 > 1) continue;
      plot(e.x + dx, e.y + e.radius * 0.6 + dy, 0x0d0b1f, 0.45 * (1 - 0.25 * air), false);
    }
  disc(e.x, e.y - lift, e.radius, e.archetype === "boss" ? 0x7a4a86 : 0x9a5a4a);
}
disc(world.player.x, world.player.y, 8, 0x7ad0ff);
for (const b of world.enemyBullets) if (b.alive) disc(b.x, b.y, Math.max(2, b.radius), 0xff5aa8, 0xff5aa8);

const out = process.argv[2] ?? "arena.png";
const scale = Math.max(1, Math.round(Number(process.argv[5] ?? 1)));
if (scale === 1) writeFileSync(out, PNG.sync.write(png));
else {
  const big = new PNG({ width: W * scale, height: H * scale });
  for (let y = 0; y < H * scale; y++) for (let x = 0; x < W * scale; x++) {
    const si = (Math.floor(y / scale) * W + Math.floor(x / scale)) * 4;
    const di = (y * W * scale + x) * 4;
    big.data[di] = png.data[si]!;
    big.data[di + 1] = png.data[si + 1]!;
    big.data[di + 2] = png.data[si + 2]!;
    big.data[di + 3] = 255;
  }
  writeFileSync(out, PNG.sync.write(big));
}
console.log(`arena (${want}, phase ${phase}, ${scale}x) → ${out}  boss=(${boss.x | 0},${boss.y | 0}) cast=${boss.bossCast} arms=${world.arms.length} waves=${world.shockwaves.length}`);
