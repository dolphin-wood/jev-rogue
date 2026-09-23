/**
 * Bakes the code-drawn effect sheets (`fx/sheets.ts`) into one canvas texture
 * at boot, one frame per drawing, and says where each sheet's origin sits.
 */
import Phaser from "phaser";
import { bakeSheets } from "./sheets.ts";
import type { FxSheet } from "./sheets.ts";

export const FX_TEXTURE = "fx_baked";

export interface FxSheetInfo {
  readonly frames: number;
  /** Each frame's origin as a fraction of that frame, for `setOrigin`. */
  readonly origins: readonly (readonly [number, number])[];
}

export function bakeFxTextures(
  scene: Phaser.Scene, opts: { blastLen: number; blastSpreadDeg: number },
): ReadonlyMap<string, FxSheetInfo> {
  const sheets: FxSheet[] = bakeSheets(opts);
  const info = new Map<string, FxSheetInfo>();
  if (scene.textures.exists(FX_TEXTURE)) scene.textures.remove(FX_TEXTURE);
  const pad = 1;
  const width = sheets.reduce((t, s) => Math.max(t, s.frames.reduce((a, f) => a + f.w + pad, 0)), 0);
  const height = sheets.reduce((t, s) => t + Math.max(...s.frames.map((f) => f.h)) + pad, 0);
  const tex = scene.textures.createCanvas(FX_TEXTURE, width, height)!;
  const ctx = tex.getContext();
  let y = 0;
  for (const s of sheets) {
    let x = 0;
    s.frames.forEach((f, i) => {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(f.data), f.w, f.h), x, y);
      tex.add(`${s.name}_${i}`, 0, x, y, f.w, f.h);
      x += f.w + pad;
    });
    info.set(s.name, {
      frames: s.frames.length,
      origins: s.frames.map((f, i) => {
        const o = s.frameOrigins?.[i] ?? s.origin;
        return [o[0] / f.w, o[1] / f.h] as const;
      }),
    });
    y += Math.max(...s.frames.map((f) => f.h)) + pad;
  }
  tex.refresh();
  return info;
}
