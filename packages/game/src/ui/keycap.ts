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
 */

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

type Part = { key: true; text: string } | { key: false; text: string };

/** Splits `"[E] open  [A][D] move"` into words and keys. */
export function parseKeyLine(str: string): Part[] {
  const parts: Part[] = [];
  const re = /\[([^\]]+)\]/g;
  let at = 0;
  for (let m = re.exec(str); m; m = re.exec(str)) {
    if (m.index > at) parts.push({ key: false, text: str.slice(at, m.index) });
    parts.push({ key: true, text: m[1]! });
    at = m.index + m[0].length;
  }
  if (at < str.length) parts.push({ key: false, text: str.slice(at) });
  return parts;
}

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
    if (!part.key) {
      const t = scene.add.text(cx, 0, part.text, {
        fontFamily: "monospace", fontSize: `${Math.round(px * z)}px`, color: style.colour,
      }).setOrigin(0, 0.5).setScale(1 / z);
      items.push(t);
      cx += t.width / z;
      continue;
    }
    const label = scene.add.text(0, -0.5, part.text, {
      fontFamily: "monospace", fontSize: `${Math.round(px * 0.85 * z)}px`, color: "#e8e3d8",
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
