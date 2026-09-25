/**
 * **The floor marks of the player's own spells**, drawn in the game's pixels.
 *
 * Two of doc 006's options put something on the ground before they pay out:
 * Meteor says where its rock will land, and a leap where it will come down.
 * Each is drawn on the same texel grid the enemy telegraphs use
 * (`telegraph.ts`), and deliberately **not in their language**.
 *
 * An enemy's danger is read as a hard bright rim over a hatched fill, in the
 * warning reds; a player who has learned that must never meet the same
 * drawing and have it mean "this is yours". So a mark of the player's has no
 * rim, no hatch and no ticks: it is a **shadow** — solid, dark, soft-edged by
 * two flat bands rather than a line — that grows and darkens as the thing
 * casting it comes down, with the spell's own light in its heart where the
 * thing is burning. The falling rock and the arcing body already say when;
 * the shadow says where, the way a shadow does.
 *
 * Headless, like `telegraph.ts`: it draws through `Pen`, so it can be baked
 * and tested without Phaser.
 */
import type { Pen, ViewBox } from "./ground.ts";
import { teleDisc } from "./telegraph.ts";

/** The shadow a falling thing casts: the ink every sprite outline is drawn in. */
export const SHADOW_INK = 0x0d0b1f;

/**
 * **Where the meteor lands.** `t` runs 0 to 1 over the telegraph.
 *
 * The whole landing, faintly, from the first frame, so the ground it will take
 * is known while there is time to use it — a body can be walked out of it or
 * lured into it — and inside that the rock's own shadow, gathering from a
 * third of the mark to all of it and darkening as the rock comes down, until
 * at the impact the two are one dark disc. No outline: the edge of a shadow
 * is where it stops.
 */
export function drawMeteorShadow(
  pen: Pen, x: number, y: number, r: number, t: number, view: ViewBox,
): void {
  const k = Math.max(0, Math.min(1, t));
  teleDisc(pen, x, y, r, SHADOW_INK, 0.16, 1, view);
  const inner = r * (0.35 + 0.65 * k * k);
  // Two flat bands, the rim a step lighter than the heart: soft without a gradient.
  teleDisc(pen, x, y, inner, SHADOW_INK, 0.12 + 0.2 * k, 1, view);
  teleDisc(pen, x, y, inner * 0.72, SHADOW_INK, 0.14 + 0.22 * k, 1, view);
}

/**
 * **Where a leap comes down**: the body's own shadow waiting on the spot,
 * small while the player is high over it and full-sized as they land.
 */
export function drawLeapShadow(
  pen: Pen, x: number, y: number, t: number, view: ViewBox,
): void {
  const k = Math.max(0, Math.min(1, t));
  const r = 3 + 5 * k;
  teleDisc(pen, x, y, r, SHADOW_INK, 0.16 + 0.22 * k, 1, view);
  teleDisc(pen, x, y, r * 0.6, SHADOW_INK, 0.12 + 0.16 * k, 1, view);
}
