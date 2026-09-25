/**
 * Renders every archetype at every facing, with the target marked, so the
 * question "is this body facing the player" can be settled by looking once.
 *
 * It exists because that question was got wrong three times in a row, each
 * time from a single screenshot: the turret drew a boss because a missing name
 * fell back to the sheet's first frame; the tank flipped left and right because
 * its facing came off a velocity that oscillated; and the shooter aims away
 * from the player for half the compass because **its side view is drawn facing
 * east** while every other body's faces west. Three different causes with one
 * symptom, and no way to tell them apart by eye on a moving sprite.
 *
 * So the whole product is composited into one sheet: six archetypes across,
 * four facings down, each cell showing the chosen frame with a marker on the
 * side the body is supposed to be looking at. A convention error is then
 * obvious rather than inferred — the marker and the face either agree or they
 * do not.
 *
 * ### Read the eye, not the bright mass
 *
 * The trap this tool exists to avoid catches you a second time if you measure
 * it. Scoring "which way does it face" by the centroid of a sprite's accent
 * pixels says the shooter and the orbiter are mirrored the wrong way — because
 * their largest accents are a **trailing** feature: the shooter's cyan fins
 * and the orbiter's cyan tentacles are its back. Their faces are a small
 * magenta dot and a small gold dot respectively.
 *
 * All six archetypes follow one convention: the `_w_` drawing faces west, and
 * east is that drawing mirrored. An exception was added for the shooter on the
 * strength of the bad measurement and has been removed.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PNG } from "pngjs";
import { ENEMIES, fillSubspecies } from "@jr/core";
import type { EnemyId } from "@jr/core";
import { enemyFrame } from "../../../game/src/scenes/enemy-frames.ts";
import type { FramedEnemy } from "../../../game/src/scenes/enemy-frames.ts";

const SHEET_PNG = new URL("../../../../assets/sprites.png", import.meta.url);
const SHEET_JSON = new URL("../../../../assets/sprites.json", import.meta.url);
// A review image, not a delivery: written beside the other review boards, which git ignores.
const OUT = new URL("../../../../art-review/facing-check.png", import.meta.url);

/** Frame base per archetype, matching the play scene's table. */
const ENEMY_FRAME: Record<EnemyId, string> = fillSubspecies<string>({
  rusher: "enemy_rusher", shooter: "enemy_shooter", turret: "enemy_turret",
  orbiter: "enemy_orbiter", tank: "enemy_tank", summoner: "enemy_summoner",
  lancer: "enemy_lancer", sentinel: "enemy_sentinel",
  warden: "enemy_warden", bellringer: "enemy_bellringer", rifter: "enemy_rifter",
  snarecaster: "enemy_snarecaster", delver: "enemy_delver", cinderling: "enemy_cinderling", sower: "enemy_sower",
  // Undirected and three-phase, like the turret is undirected.
  boss: "boss_p1",
});

const FACINGS: readonly { name: string; deg: number; dx: number; dy: number }[] = [
  { name: "east", deg: 0, dx: 1, dy: 0 },
  { name: "south", deg: 90, dx: 0, dy: 1 },
  { name: "west", deg: 180, dx: -1, dy: 0 },
  { name: "north", deg: 270, dx: 0, dy: -1 },
];

const CELL = 80;
const SCALE = 2;

interface Rect { x: number; y: number; w: number; h: number }

function main(): void {
  const sheet = JSON.parse(readFileSync(SHEET_JSON, "utf8")) as {
    frames: Record<string, Rect>;
  };
  const png = PNG.sync.read(readFileSync(SHEET_PNG));
  const has = (n: string): boolean => n in sheet.frames;

  const ids = Object.keys(ENEMIES) as EnemyId[];
  const out = new PNG({
    width: CELL * SCALE * ids.length,
    height: CELL * SCALE * FACINGS.length,
    fill: true,
  });
  // A flat dark ground, so alpha edges and the marker both read.
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 0x1a;
    out.data[i + 1] = 0x18;
    out.data[i + 2] = 0x2a;
    out.data[i + 3] = 0xff;
  }

  const report: string[] = [];
  ids.forEach((id, col) => {
    FACINGS.forEach((f, row) => {
      const e: FramedEnemy = {
        awake: true, roused: true, radius: ENEMIES[id].radius, brakeMs: 0,
        recoversBraced: false, attack: "approach", hitFlashMs: 0,
        stationary: ENEMIES[id].behaviour === "stationary",
        speed: ENEMIES[id].speed,
        telegraphMs: 0, vx: 0, vy: 0, travelled: 0,
        facing: (f.deg * Math.PI) / 180,
      };
      const chosen = enemyFrame(e, 0, has, ENEMY_FRAME[id]);
      if (!has(chosen.name)) {
        report.push(`MISSING ${id} ${f.name}: ${chosen.name}`);
        return;
      }
      const r = sheet.frames[chosen.name]!;
      blit(png, out, r, col * CELL * SCALE, row * CELL * SCALE, chosen.flipX);
      marker(out, col * CELL * SCALE, row * CELL * SCALE, f.dx, f.dy);
      report.push(
        `${id.padEnd(9)} ${f.name.padEnd(6)} -> ${chosen.name}${chosen.flipX ? " (mirrored)" : ""}`,
      );
    });
  });

  mkdirSync(dirname(OUT.pathname), { recursive: true });
  writeFileSync(OUT, PNG.sync.write(out));
  console.log(report.join("\n"));
  console.log(`\ncolumns: ${ids.join(", ")}`);
  console.log(`rows: ${FACINGS.map((f) => f.name).join(", ")}`);
  console.log("the dot marks the side the body should be looking at");
  console.log(`wrote ${OUT.pathname}`);
}

/** Copies one frame into a cell, centred, at `SCALE`, optionally mirrored. */
function blit(
  src: PNG, dst: PNG, r: Rect, cx: number, cy: number, flip: boolean,
): void {
  const ox = cx + ((CELL - r.w) * SCALE) / 2;
  const oy = cy + ((CELL - r.h) * SCALE) / 2;
  for (let y = 0; y < r.h * SCALE; y++)
    for (let x = 0; x < r.w * SCALE; x++) {
      const sx = r.x + (flip ? r.w - 1 - ((x / SCALE) | 0) : (x / SCALE) | 0);
      const sy = r.y + ((y / SCALE) | 0);
      const si = ((src.width * sy + sx) << 2);
      const a = src.data[si + 3]!;
      if (a < 16) continue;
      const dx = Math.round(ox + x);
      const dy = Math.round(oy + y);
      if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue;
      const di = ((dst.width * dy + dx) << 2);
      dst.data[di] = src.data[si]!;
      dst.data[di + 1] = src.data[si + 1]!;
      dst.data[di + 2] = src.data[si + 2]!;
      dst.data[di + 3] = 0xff;
    }
}

/** A bright dot on the side the body is meant to be looking at. */
function marker(dst: PNG, cx: number, cy: number, dx: number, dy: number): void {
  const half = (CELL * SCALE) / 2;
  const mx = cx + half + dx * (half - 8);
  const my = cy + half + dy * (half - 8);
  for (let y = -4; y <= 4; y++)
    for (let x = -4; x <= 4; x++) {
      if (x * x + y * y > 16) continue;
      const px = Math.round(mx + x);
      const py = Math.round(my + y);
      if (px < 0 || py < 0 || px >= dst.width || py >= dst.height) continue;
      const i = ((dst.width * py + px) << 2);
      dst.data[i] = 0xff;
      dst.data[i + 1] = 0xe9;
      dst.data[i + 2] = 0xa8;
      dst.data[i + 3] = 0xff;
    }
}

main();
