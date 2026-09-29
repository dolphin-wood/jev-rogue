/**
 * Key prompts with the keys drawn as keys.
 *
 * Every prompt used to be a line of text — "E  spirit spell", "move with A D",
 * "Enter begin" — and a key letter set in the same font as the words around
 * it does not read as a key: "E" was just the first word. So a key is written
 * in brackets in the string (`[E] open`, `[A][D] move`, `[Enter] begin`) and
 * drawn as a **keycap**: a small raised box with a dark lower lip and the
 * key's name inside, which the eye separates from the words without reading.
 *
 * Text is built at the scene's zoom and scaled back down, like every other
 * label in the game, so it stays crisp.
 *
 * A cap may name an **action** rather than a key — `[@interact] open`,
 * `[Hold @dismantle]` — and reads whatever key the player has put that
 * action on (`setKeyTokens`), so no prompt goes stale when a key is rebound.
 * The label goes in after the markup is split, so a key whose label is a
 * bracket still draws as a cap.
 *
 * Two tokens stand for drawings rather than words: `{coin}` is the coin, so a
 * price reads as money without the word "gold", and `{pips:3/5}` is a row of
 * five small squares with three filled, a level read at a glance.
 */

import { bodyPx, fontFamily, letterSpacing } from "../i18n/index.ts";

/** How the scene's text is built: fonts are sized at this zoom and scaled down. */
export interface KeyLineStyle {
  readonly px: number;
  readonly colour: string;
  readonly zoom: number;
  readonly depth: number;
  /** 0 left, 0.5 centre, 1 right, as a text origin. */
  readonly originX?: number;
  /** A dark panel behind the whole line, for prompts over the room. */
  readonly panel?: boolean;
}

type Part =
  | { key: true; text: string }
  | { key: false; text: string }
  | { key: false; icon: "coin"; text: "" }
  | { key: false; pips: [number, number]; text: "" };

/** What an `@action` in a cap reads as: set by the scene from its bindings; unknown names are left as written. */
let keyTokens: (name: string) => string | undefined = () => undefined;
export function setKeyTokens(fn: (name: string) => string | undefined): void {
  keyTokens = fn;
}

/** Splits `"[E] open  [A][D] move  {coin} 30  {pips:2/5}"` into words, keys and drawings. */
export function parseKeyLine(str: string): Part[] {
  const parts: Part[] = [];
  const re = /\[([^\]]+)\]|\{coin\}|\{pips:(\d+)\/(\d+)\}/g;
  let at = 0;
  for (let m = re.exec(str); m; m = re.exec(str)) {
    if (m.index > at) parts.push({ key: false, text: str.slice(at, m.index) });
    if (m[0] === "{coin}") parts.push({ key: false, icon: "coin", text: "" });
    else if (m[2] !== undefined) parts.push({ key: false, pips: [Number(m[2]), Number(m[3])], text: "" });
    else parts.push({ key: true, text: m[1]!.replace(/@(\w+)/g, (tok, name: string) => keyTokens(name) ?? tok) });
    at = m.index + m[0].length;
  }
  if (at < str.length) parts.push({ key: false, text: str.slice(at) });
  return parts;
}

/** Where the coin is drawn from: the scene sets it once its sheet is loaded. */
let coinArt: { texture: string; frame: string } | null = null;
export function setCoinArt(texture: string, frame: string): void {
  coinArt = { texture, frame };
}

/** A level's pips' colours: filled, and the empty frame. */
const PIP_ON = 0xffd45e;
const PIP_OFF = 0x3a3660;

/** A line of words and keycaps, as one container positioned by `originX` and its vertical centre. */
export function keyLine(
  scene: Phaser.Scene, x: number, y: number, str: string, style: KeyLineStyle,
): Phaser.GameObjects.Container {
  const box = scene.add.container(x, y).setDepth(style.depth);
  fillKeyLine(scene, box, str, style);
  return box;
}

/** Rebuilds a key line's contents in place (for a prompt that changes). */
export function fillKeyLine(
  scene: Phaser.Scene, box: Phaser.GameObjects.Container, str: string, style: KeyLineStyle,
): void {
  box.removeAll(true);
  const z = style.zoom;
  const px = style.px;
  const capH = px + 5;
  const items: Phaser.GameObjects.GameObject[] = [];
  let cx = 0;
  for (const part of parseKeyLine(str)) {
    if ("icon" in part) {
      const size = px + 2;
      if (coinArt) {
        const img = scene.add.image(cx + size / 2, 0, coinArt.texture, coinArt.frame).setDisplaySize(size, size);
        items.push(img);
      } else items.push(scene.add.circle(cx + size / 2, 0, size / 2 - 1, PIP_ON));
      cx += size + 1;
      continue;
    }
    if ("pips" in part) {
      const [on, of] = part.pips;
      const s = Math.max(3, Math.round(px * 0.6));
      for (let i = 0; i < of; i++) {
        const r = scene.add.rectangle(cx + s / 2, 0, s, s, i < on ? PIP_ON : 0x0d0b1f, 1)
          .setStrokeStyle(1, i < on ? 0xfff0b0 : PIP_OFF, 1);
        items.push(r);
        cx += s + 1.5;
      }
      cx += 2;
      continue;
    }
    if (!part.key) {
      const t = scene.add.text(cx, 0, part.text, {
        // The words between the caps are UI text and follow the language;
        // a cap's own label is always a Latin key name and does not.
        fontFamily: fontFamily(), fontSize: `${Math.round(bodyPx(px, z) * z)}px`, color: style.colour,
        letterSpacing: letterSpacing() * z,
      }).setOrigin(0, 0.5).setScale(1 / z);
      items.push(t);
      cx += t.width / z;
      continue;
    }
    const label = scene.add.text(0, -0.5, part.text, {
      /*
       * A cap's label is a Latin key name, and it is **read**, so it takes
       * the same floor as the words beside it. It used to be drawn at 0.85 of
       * the line's size, which after the switch to pixel type came out at ten
       * CSS pixels of ink — small enough that the key on the chip was the
       * least legible thing in the prompt telling you to press it.
       */
      fontFamily: fontFamily(), fontSize: `${Math.round(bodyPx(px * 0.85, z) * z)}px`, color: "#e8e3d8",
    }).setOrigin(0.5, 0.5).setScale(1 / z);
    const w = Math.max(capH, label.width / z + 7);
    const cap = scene.add.rectangle(cx + w / 2, 0, w, capH, 0x2a2656, 1).setStrokeStyle(1, 0x8792b5, 1);
    // The lower lip: what makes a box read as a key rather than a tag.
    const lip = scene.add.rectangle(cx + w / 2, capH / 2 - 1, w - 2, 2, 0x0d0b1f, 0.9);
    label.setX(cx + w / 2);
    items.push(cap, lip, label);
    cx += w + 2;
  }
  const width = cx;
  const shift = -width * (style.originX ?? 0.5);
  for (const it of items) (it as unknown as { x: number }).x += shift;
  if (style.panel && width > 0) {
    const bg = scene.add.rectangle(shift - 4, 0, width + 8, capH + 6, 0x0d0b1f, 0.87).setOrigin(0, 0.5);
    box.add(bg);
  }
  box.add(items);
}

/** A prompt that is set and moved every frame: rebuilds only when its text changes. */
export class KeyPrompt {
  readonly box: Phaser.GameObjects.Container;
  private str = "";

  constructor(private readonly scene: Phaser.Scene, private readonly style: KeyLineStyle) {
    this.box = scene.add.container(0, 0).setDepth(style.depth).setVisible(false);
  }

  get text(): string {
    return this.str;
  }

  setText(str: string): this {
    if (str !== this.str) {
      this.str = str;
      fillKeyLine(this.scene, this.box, str, this.style);
    }
    return this;
  }

  setPosition(x: number, y: number): this {
    this.box.setPosition(x, y);
    return this;
  }

  setVisible(v: boolean): this {
    this.box.setVisible(v);
    return this;
  }
}
