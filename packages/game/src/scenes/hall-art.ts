import Phaser from "phaser";
import { GRID_H, GRID_W, TILE_PX, Tile } from "@jr/core";
import { ART_SCALE } from "./telegraph.ts";
import { cellHash } from "./cell-hash.ts";

type Hall = "boss" | "shop";

const ART = "source/halls/";
const SCALE = 1 / ART_SCALE;

/** The hand-drawn hall sheets live beside the other source art under assets/. */
export function preloadHallArt(scene: Phaser.Scene): void {
  scene.load.spritesheet("hall_throne_floor", `${ART}throne-floor.png`, { frameWidth: 64, frameHeight: 64 });
  scene.load.spritesheet("hall_throne_carpet", `${ART}throne-carpet.png`, { frameWidth: 64, frameHeight: 64 });
  scene.load.image("hall_throne_dais", `${ART}throne-dais.png`);
  scene.load.image("hall_throne_column", `${ART}throne-column.png`);
  scene.load.image("hall_column_cracked", `${ART}throne-column-cracked.png`);
  scene.load.image("hall_column_broken", `${ART}throne-column-broken.png`);
  scene.load.spritesheet("hall_throne_banners", `${ART}throne-banners.png`, { frameWidth: 128, frameHeight: 192 });
  scene.load.spritesheet("hall_throne_candelabra", `${ART}throne-candelabra.png`, { frameWidth: 64, frameHeight: 128 });
  scene.load.image("hall_candelabrum_cracked", `${ART}throne-candelabra-cracked.png`);
  scene.load.image("hall_candelabrum_broken", `${ART}throne-candelabra-broken.png`);
  scene.load.spritesheet("hall_market_floor", `${ART}market-floor.png`, { frameWidth: 64, frameHeight: 64 });
  scene.load.spritesheet("hall_market_rugs", `${ART}market-rugs.png`, { frameWidth: 192, frameHeight: 128 });
  scene.load.image("hall_market_column", `${ART}market-column.png`);
  scene.load.image("hall_market_column_flicker", `${ART}market-column-flicker.png`);
  scene.load.spritesheet("hall_market_dressing", `${ART}market-dressing.png`, { frameWidth: 64, frameHeight: 64 });
}

function add(
  scene: Phaser.Scene, group: Phaser.GameObjects.Group, key: string, frame: number | undefined,
  x: number, y: number, depth: number,
): Phaser.GameObjects.Image {
  const img = (frame === undefined ? scene.add.image(x, y, key) : scene.add.image(x, y, key, frame))
    .setOrigin(0).setScale(SCALE).setDepth(depth);
  group.add(img);
  return img;
}

/** Uses the same narrow foot-depth band as bodies in play.ts. */
function columnDepth(footY: number): number {
  return 6 + Math.max(0, Math.min(1, footY / (GRID_H * TILE_PX))) * 0.06;
}

function column(scene: Phaser.Scene, group: Phaser.GameObjects.Group, key: string, x: number, y: number): void {
  const footY = (y + 2) * TILE_PX;
  if (key === "hall_market_column") {
    const img = scene.add.sprite((x + 1) * TILE_PX, footY, key)
      .setOrigin(0.5, 1).setScale(SCALE).setDepth(columnDepth(footY));
    group.add(img);
    if (!scene.anims.exists("hall_lantern_flicker")) scene.anims.create({
      key: "hall_lantern_flicker",
      frames: [{ key }, { key: "hall_market_column_flicker" }],
      frameRate: 2, repeat: -1,
    });
    img.play("hall_lantern_flicker");
    return;
  }
  add(scene, group, key, undefined, (x + 1) * TILE_PX, footY, columnDepth(footY)).setOrigin(0.5, 1);
}

/** Adds visual art only. The fixed room grid remains the source of collision. */
export function drawHallArt(scene: Phaser.Scene, group: Phaser.GameObjects.Group, hall: Hall, grid: Uint8Array): void {
  const throne = hall === "boss";
  // The halls' sizes in `rooms/fixed.ts`: the throne hall 23 × 13, the merchant's 25 × 13.
  const width = throne ? 23 : 25;
  const height = 13;
  const floor = throne ? "hall_throne_floor" : "hall_market_floor";
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const cell = grid[y * GRID_W + x];
    // Under the breakable props too (the columns, the candelabra), which are floor once broken.
    if (cell !== Tile.Floor && cell !== Tile.Pillar && cell !== Tile.Prop) continue;
    add(scene, group, floor, cellHash(x, y) & 3, x * TILE_PX, y * TILE_PX, 0.02);
  }
  if (throne) {
    // The runner, three cells wide on the centre line (cells 10–12), from under the dais (row 3) to the door (row 11).
    // The north row and the door end are separate frames; the middle repeats.
    for (let y = 3; y <= 11; y++) for (let dx = 0; dx < 3; dx++) {
      const row = y === 3 ? 0 : y === 11 ? 2 : 1;
      add(scene, group, "hall_throne_carpet", row * 3 + dx, (10 + dx) * TILE_PX, y * TILE_PX, 0.2);
    }
    // The dais is five cells wide, centred on the throne (cells 10–12): cells 9–13, rows 2–3 under the throne's row.
    add(scene, group, "hall_throne_dais", undefined, 9 * TILE_PX, 2 * TILE_PX, 0.35);
    // The columns and the candelabra are the hall's breakable props, drawn as they wear (`drawHallProp` in play.ts).
    // Banners on the north wall at its two ends, clear of the columns (4, 18) and the candelabra (8, 14).
    for (const [x, frame] of [[1, 0], [20, 2]] as const)
      add(scene, group, "hall_throne_banners", frame, x * TILE_PX, 0, 0.4);
  } else {
    // Three cells centred under the merchant (cell 8) and the smith (cell 16).
    for (const [left, frame] of [[7, 0], [15, 1]] as const)
      add(scene, group, "hall_market_rugs", frame, left * TILE_PX, 4 * TILE_PX, 0.2);
    // The 2×2 columns of `rooms/fixed.ts`: cells 3–4 and 20–21, rows 3–4 and 9–10.
    for (const x of [3, 20]) for (const y of [3, 9]) column(scene, group, "hall_market_column", x, y);
    const wallDressing = [[2, 2], [20, 2], [4, 11], [19, 11], [8, 11], [15, 11]] as const;
    wallDressing.forEach(([x, y], frame) => {
      add(scene, group, "hall_market_dressing", frame, x * TILE_PX, y * TILE_PX, 0.3);
    });
  }
}
