/** Export the player's staff-free swing poses and separate grip overlays. */
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { compose, loadModel, toPng, type Composed, type Facing } from "../assets/models.ts";
import type { Shade } from "../assets/px.ts";

const model = loadModel("player");
const facings: Facing[] = ["s", "n", "w"];
const keys = [
  ["swing_windup", "swing_windup"],
  ["strike", "swing_strike"],
  ["slash", "swing_slash"],
  ["swing_follow", "swing_follow"],
  ["recover", "swing_recover"],
] as const;
const zoom = 4;
const cell = 64;

function writeSheet(path: string, overlay: boolean): void {
  const sheet = new PNG({ width: keys.length * cell * zoom, height: facings.length * cell * zoom });
  sheet.data.fill(0);
  for (const [row, facing] of facings.entries()) for (const [col, [pose, variant]] of keys.entries()) {
    const body = compose(model, facing, pose);
    let image = toPng(model, body);
    if (overlay) {
      const part = model.parts.get(facing)?.get(`fist_overlay.${variant}`);
      const grip = body.anchors.grip;
      if (!part || !Array.isArray(grip)) throw new Error(`${facing}.${pose}: missing fist or grip`);
      const px: (Shade | null)[] = new Array(cell * cell).fill(null);
      const x0 = grip[0] - part.pivot[0], y0 = grip[1] - part.pivot[1];
      for (let y = 0; y < part.h; y++) for (let x = 0; x < part.w; x++) {
        const s = part.px[y * part.w + x];
        const fx = x0 + x, fy = y0 + y;
        if (s && fx >= 0 && fy >= 0 && fx < cell && fy < cell) px[fy * cell + fx] = s;
      }
      image = toPng(model, { w: cell, h: cell, px, anchors: {}, placed: [] } satisfies Composed);
    }
    for (let y = 0; y < cell * zoom; y++) for (let x = 0; x < cell * zoom; x++) {
      const si = (((y / zoom) | 0) * cell + ((x / zoom) | 0)) * 4;
      const di = ((row * cell * zoom + y) * sheet.width + col * cell * zoom + x) * 4;
      sheet.data.set(image.data.subarray(si, si + 4), di);
    }
  }
  writeFileSync(path, PNG.sync.write(sheet));
  console.log(`${path}: ${keys.length * facings.length} cells, ${sheet.width}x${sheet.height}`);
}

writeSheet("assets/source/melee/player-swing.png", false);
writeSheet("assets/source/melee/player-swing-fists.png", true);
