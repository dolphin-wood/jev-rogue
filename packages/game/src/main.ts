import Phaser from "phaser";
import { PlayScene, DPR, VIEW_W, VIEW_H, worldZoom, presentScale } from "./scenes/play.ts";
import { BootScene } from "./scenes/boot.ts";
import { installCheapArcs } from "./scenes/graphics-arcs.ts";
import { BASE_PALETTE } from "@jr/core";

/**
 * The canvas: the **viewport**, a fixed 16 x 9 tiles of the world (doc 008),
 * fitted to the window whole with the rest of the window black. It is drawn
 * at a whole number of canvas pixels to an art pixel (`worldZoom`) and shown
 * at `presentScale` device pixels to a canvas pixel — one to one when the fit
 * is whole, smoothly scaled down otherwise. The camera follows the player
 * across the room.
 */
function canvasSize(): { css: [number, number]; px: [number, number]; shown: number } {
  const zoom = worldZoom();
  const px: [number, number] = [Math.round(VIEW_W * zoom), Math.round(VIEW_H * zoom)];
  const shown = presentScale();
  return { css: [(px[0] * shown) / DPR, (px[1] * shown) / DPR], px, shown };
}

installCheapArcs();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  // In physical pixels, so a HiDPI screen is sharp; see `canvasSize`.
  width: canvasSize().px[0],
  height: canvasSize().px[1],
  // The current delivery is pixel art. Texture canvases also opt into nearest
  // filtering after mood recolouring; this covers the initial sheet as well.
  pixelArt: true,
  antialias: false,
  roundPixels: false,
  backgroundColor: BASE_PALETTE.ink,
  // Presentation is done below rather than by a scale mode: FIT measures the
  // parent before layout settles and left the canvas at its backing size,
  // overflowing the window and clipping the HUD.
  scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, PlayScene],
});

// Exposed for debugging from the browser console and from automated checks.
// The game is otherwise unreachable from the page, since Phaser's own registry
// is not populated by this configuration.
(globalThis as unknown as { jr?: unknown }).jr = game;

/**
 * Sizes the canvas to the window, shown at one device pixel per canvas pixel.
 * Done through the scale manager rather than by setting canvas styles, which
 * it overwrites on its own refresh.
 */
function present(): void {
  const { px, shown } = canvasSize();
  game.scale.resize(px[0], px[1]);
  game.scale.setZoom(shown / DPR);
  game.scale.refresh();
  // Scaled down, the canvas is filtered, so every art pixel stays one width;
  // one to one it is shown as it is.
  game.canvas.style.imageRendering = shown < 1 - 1e-6 ? "auto" : "pixelated";
}

window.addEventListener("resize", present);
game.events.once("ready", present);
present();
