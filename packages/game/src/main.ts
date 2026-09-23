import Phaser from "phaser";
import { PlayScene, VIEW } from "./scenes/play.ts";
import { BASE_PALETTE } from "@jr/core";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  // The backing store is sized in physical pixels, art resolution times the
  // device pixel ratio. That is what makes a HiDPI screen sharp; the earlier
  // blur came from a 672-wide backing store stretched across the window.
  width: VIEW.width,
  height: VIEW.height,
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
  scene: PlayScene,
});

// Exposed for debugging from the browser console and from automated checks.
// The game is otherwise unreachable from the page, since Phaser's own registry
// is not populated by this configuration.
(globalThis as unknown as { jr?: unknown }).jr = game;

/**
 * Presents the fixed backing store at the largest size that fits the window.
 * Done through the scale manager rather than by setting canvas styles, which
 * it overwrites on its own refresh.
 */
function present(): void {
  const zoom = Math.min(window.innerWidth / VIEW.width, window.innerHeight / VIEW.height);
  game.scale.setZoom(zoom);
  game.scale.refresh();
}

window.addEventListener("resize", present);
game.events.once("ready", present);
present();
