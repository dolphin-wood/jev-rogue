/**
 * A readability check that runs against the live scene.
 *
 * Screenshots catch what someone happens to look at. Three of the four
 * problems that kept coming back — Chinese lines touching, a hint row running
 * out past its panel, a label drawn below the font's own size — are
 * measurable, and measuring them is the only way to be sure every screen in
 * every language is clean rather than the two that got photographed.
 *
 * Exposed on `window.__scene.checkLayout()` so it can be driven from the
 * browser; it reads the scene and changes nothing.
 */
import { getLang, lineLead, MIN_RENDERED_PX } from "../i18n/index.ts";

export interface LayoutViolation {
  readonly kind: "pitch" | "overflow" | "overlap" | "size" | "tiny" | "padding";
  readonly text: string;
  readonly detail: string;
}

/**
 * How far inside a box its contents have to start, in room px.
 *
 * The affix slots printed their label two pixels from their own border, and
 * the same was true in enough other places that "add padding" was not a fix
 * but a rule. See `PAD_S` in `play.ts`, which is the same number said where
 * the drawing happens.
 */
const MIN_PAD = 4;

export interface LayoutReport {
  readonly lang: string;
  readonly checked: number;
  readonly violations: readonly LayoutViolation[];
}

/** How much more than the glyph height a line of each script has to advance. */
const MIN_PITCH_CJK = 1.35;
const MIN_PITCH_LATIN = 1.25;

/** Text this small is a label on a gauge, not prose, and is measured anyway. */
const CJK = /[⺀-鿿぀-ヿ＀-｠]/;

interface Measured {
  readonly t: Phaser.GameObjects.Text;
  readonly rect: Phaser.Geom.Rectangle;
  readonly px: number;
  readonly lines: number;
}

/**
 * Every visible `Text` in the scene, with what it would take to read it.
 *
 * Phaser's display list is flat plus containers, so containers are walked
 * into: a key line is a container of words and caps, and its words are as
 * able to overflow a panel as anything else.
 */
function collect(scene: Phaser.Scene): Measured[] {
  const out: Measured[] = [];
  const walk = (objs: Phaser.GameObjects.GameObject[]): void => {
    for (const o of objs) {
      const asContainer = o as unknown as { list?: Phaser.GameObjects.GameObject[] };
      if (Array.isArray(asContainer.list)) { walk(asContainer.list); continue; }
      const t = o as Phaser.GameObjects.Text;
      if (t.type !== "Text" || !t.visible || !t.text?.trim()) continue;
      if ((t.alpha ?? 1) < 0.2) continue;
      const px = Number.parseFloat(String(t.style?.fontSize ?? "0"));
      if (!px) continue;
      out.push({
        t, rect: t.getBounds(), px,
        lines: Math.max(1, t.text.split("\n").length),
      });
    }
  };
  walk(scene.children.list);
  return out;
}

/** A box something is drawn inside: a panel, a card, a slot, a plate. */
interface Box {
  readonly rect: Phaser.Geom.Rectangle;
  readonly depth: number;
  readonly area: number;
}

/**
 * The boxes on screen, found rather than registered.
 *
 * Every panel, card and slot in the game is an `add.rectangle`, so the
 * display list already says where the boxes are and nothing has to be kept
 * in step with the drawing. Two kinds are left out: a rule or a divider,
 * which is a rectangle one or two pixels thin and has no inside, and a
 * backdrop, which covers the screen and would make every edge label a fault.
 */
function collectBoxes(scene: Phaser.Scene, bounds: Phaser.Geom.Rectangle): Box[] {
  const out: Box[] = [];
  const big = bounds.width * bounds.height * 0.5;
  const walk = (objs: Phaser.GameObjects.GameObject[]): void => {
    for (const o of objs) {
      const asContainer = o as unknown as { list?: Phaser.GameObjects.GameObject[] };
      if (Array.isArray(asContainer.list)) { walk(asContainer.list); continue; }
      const r = o as Phaser.GameObjects.Rectangle;
      if (r.type !== "Rectangle" || !r.visible || (r.alpha ?? 1) < 0.2) continue;
      const rect = r.getBounds();
      if (rect.width < 24 || rect.height < 12) continue;
      const area = rect.width * rect.height;
      if (area > big) continue;
      out.push({ rect, depth: r.depth, area });
    }
  };
  walk(scene.children.list);
  return out;
}

/**
 * Checks a screen and returns what is wrong with it.
 *
 * `bounds` is the frame everything is expected to stay inside — the camera's
 * view, in the same space `getBounds` reports.
 */
export function checkLayout(
  scene: Phaser.Scene, bounds: Phaser.Geom.Rectangle,
  /**
   * Rectangles nothing may be drawn under.
   *
   * The same-depth overlap rule cannot see these: a plate drawn *over* the
   * page at a higher depth is exactly the case where text disappears under
   * something, and comparing only within a depth was built to ignore
   * deliberate layering. A reserved rect says "this one is not layering, it
   * is covering", which is how the room plan's Begin plate sat on top of its
   * own last lines without the check noticing.
   */
  reserved: readonly Phaser.Geom.Rectangle[] = [],
  /**
   * Ignore everything drawn below this depth.
   *
   * A screen with an **opaque** backdrop — the room plan's is alpha 1 — hides
   * the HUD completely, and measuring text nobody can see reports faults that
   * are not there. A dimmed modal passes 0, because what is behind a dim is
   * still on screen and still has to be right.
   */
  minDepth = 0,
): LayoutReport {
  const items = collect(scene).filter((m) => m.t.depth >= minDepth);
  const violations: LayoutViolation[] = [];
  const lang = getLang();
  const say = (t: Phaser.GameObjects.Text) => t.text.replace(/\n/g, " / ").slice(0, 44);
  /*
   * **Backing-store pixels to the ones a person sees.**
   *
   * "Native size" is a count of the font's own pixels, and on a 2× display
   * that is half as tall on screen as it sounds — which is how the UI ended
   * up at nine CSS pixels of ink and unreadable while every number in the
   * code looked right. Taken from the canvas's own box so browser zoom and a
   * scaled canvas are included.
   */
  const canvas = (scene.game as unknown as { canvas: HTMLCanvasElement }).canvas;
  const rect = canvas?.getBoundingClientRect?.();
  const scale = (scene.scale as unknown as { width: number }).width;
  const toCss = rect && scale ? rect.width / scale : 1;
  // Ark Pixel puts this much of its em into ink; the rest is leading.
  const INK = 0.83;
  const MIN_INK_CSS = 11;

  for (const m of items) {
    const cjk = CJK.test(m.t.text);

    // Below the pixel font's own size is a blur, whatever else is true.
    if (m.px < MIN_RENDERED_PX - 0.5) {
      violations.push({
        kind: "size", text: say(m.t),
        detail: `${m.px.toFixed(1)} backing px, floor is ${MIN_RENDERED_PX}`,
      });
    }
    // And too small to read, however crisp it is.
    const inkCss = m.px * INK * toCss;
    if (inkCss < MIN_INK_CSS) {
      violations.push({
        kind: "tiny", text: say(m.t),
        detail: `${inkCss.toFixed(1)} CSS px of ink, wants ${MIN_INK_CSS}`,
      });
    }

    /*
     * Lines that touch. Only measurable on text that actually wrapped.
     *
     * The pitch is **baseline to baseline**, which is not the block's height
     * over its line count: a block of `n` lines is `n` line heights plus
     * `n - 1` gaps, so dividing by `n` under-counts by one gap's worth and
     * reported healthy leading as too tight. Solving for the pitch gives
     * `(height + lead) / n`.
     */
    if (m.lines > 1) {
      const lead = (m.t.lineSpacing ?? 0);
      const pitch = (m.rect.height / (m.t.scaleY || 1) + lead) / m.lines / m.px;
      const want = cjk ? MIN_PITCH_CJK : MIN_PITCH_LATIN;
      if (pitch < want) {
        violations.push({
          kind: "pitch", text: say(m.t),
          detail: `pitch ${pitch.toFixed(2)}, wants ${want} (lead ${lineLead(lang)})`,
        });
      }
    }

    // Off the edge of the view.
    if (m.rect.width > 0 && !Phaser.Geom.Rectangle.ContainsRect(bounds, m.rect)) {
      violations.push({
        kind: "overflow", text: say(m.t),
        detail: `x ${m.rect.left.toFixed(0)}..${m.rect.right.toFixed(0)}, `
          + `y ${m.rect.top.toFixed(0)}..${m.rect.bottom.toFixed(0)} outside `
          + `${bounds.left.toFixed(0)}..${bounds.right.toFixed(0)} / ${bounds.top.toFixed(0)}..${bounds.bottom.toFixed(0)}`,
      });
    }
  }

  /*
   * Two labels on top of each other.
   *
   * Only compared within a depth, because the game layers deliberately — a
   * dimmed screen behind a modal is not an overlap, and the room's own text
   * sits under every panel. Same depth and overlapping bounds is the case
   * that is always a mistake.
   */
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (Math.abs(a.t.depth - b.t.depth) > 0.001) continue;
      if (!Phaser.Geom.Rectangle.Overlaps(a.rect, b.rect)) continue;
      const over = Phaser.Geom.Rectangle.Intersection(a.rect, b.rect);
      // A pixel or two of touching bounds is kerning, not a collision.
      if (over.width < 3 || over.height < 3) continue;
      violations.push({
        kind: "overlap", text: say(a.t),
        detail: `over "${say(b.t)}" by ${over.width.toFixed(0)}x${over.height.toFixed(0)}`,
      });
    }
  }

  /*
   * What a box holds has to start inside it.
   *
   * The box a label belongs to is the smallest one its middle sits in that
   * is drawn under it — a slot inside a panel inside the screen picks the
   * slot. Only the two edges the label runs along are measured: a row is
   * centred in its slot vertically and pinned to one side horizontally, so
   * demanding four pixels above a line that fills its row's height would
   * report every list in the game.
   */
  const boxes = collectBoxes(scene, bounds);
  for (const m of items) {
    if (m.rect.width <= 0) continue;
    const cx = m.rect.centerX, cy = m.rect.centerY;
    let own: Box | null = null;
    for (const b of boxes) {
      // Under the label, but not far under it: a box and what it holds are
      // drawn together, a fraction of a depth apart. A world rectangle that
      // happens to lie beneath a HUD label is not that label's box.
      if (b.depth > m.t.depth + 0.001 || m.t.depth - b.depth > 12) continue;
      if (!b.rect.contains(cx, cy)) continue;
      if (b.area <= m.rect.width * m.rect.height * 1.05) continue;
      if (!own || b.area < own.area) own = b;
    }
    if (!own) continue;
    const pad = Math.min(m.rect.left - own.rect.left, own.rect.right - m.rect.right);
    if (pad < MIN_PAD - 0.5) {
      violations.push({
        kind: "padding", text: say(m.t),
        detail: `${pad.toFixed(1)} px inside a ${own.rect.width.toFixed(0)}x${own.rect.height.toFixed(0)} box, wants ${MIN_PAD}`,
      });
    }
  }

  for (const m of items)
    for (const box of reserved) {
      if (!Phaser.Geom.Rectangle.Overlaps(box, m.rect)) continue;
      const over = Phaser.Geom.Rectangle.Intersection(box, m.rect);
      if (over.width < 2 || over.height < 2) continue;
      violations.push({
        kind: "overlap", text: say(m.t),
        detail: `under a reserved plate by ${over.width.toFixed(0)}x${over.height.toFixed(0)}`,
      });
    }

  return { lang, checked: items.length, violations };
}
