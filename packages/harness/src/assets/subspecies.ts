/**
 * **How a subspecies is told apart from its base** (doc 019): a palette shift
 * and one small mark, generated from the base body's own model.
 *
 * The measured alternative is why nothing here is a new drawing of a body. A
 * walking body carries about ninety atlas frames and an emplacement
 * twenty-four, so thirteen subspecies packed as their own models is roughly
 * 980 frames — **+58% on the character half of an atlas already packed 4096
 * wide**. What a player needs instead is two things a base body can be
 * *given*: a different colour, and a different outline against the sky.
 *
 * So this module produces
 *
 * - a **palette table**: for each subspecies, the exact colours of its base's
 *   ramps and what each becomes. The game swaps them on the GPU, so no frame
 *   is copied and no texture is added (`fx/palette-swap.ts`);
 * - the **mark drawings**: one tiny sprite per facing, drawn here from the
 *   subspecies' own accent so it reads against its new palette, hung in play
 *   at the `mark` anchor the base's rig declares.
 *
 * Thirteen marks over three facings is 39 frames, about 2% of the atlas.
 */
import { PNG } from "pngjs";
import { hex, hsl, rgb, type Palette, type Rgb } from "./palette.ts";

/** The shape a mark is drawn as. Each reads as a different silhouette at 1x. */
export type MarkShape = "horn" | "crest" | "plume" | "lens" | "tusk" | "frond" | "bells" | "spur" | "vent" | "sac" | "fork" | "flare" | "wedge";

export interface SubspeciesArt {
  readonly id: string;
  readonly base: string;
  /**
   * How far round the wheel the body's colours are carried, and what happens
   * to their chroma. A **shift**, not a replacement: a pinner has to still
   * read as a shooter at a glance, or the player has learned a new body
   * rather than a variant of one.
   */
  readonly hueShift: number;
  readonly chroma: number;
  /** The mark: its shape, and where it sits relative to the anchor. */
  readonly mark: MarkShape;
  /** The mark's own hue, as an absolute angle: the one part allowed to shout. */
  readonly accentHue: number;
}

/**
 * The thirteen, with the lancer left out: it has its own drawn model and
 * predates the mark pipeline, so it needs neither half of this.
 *
 * Hue shifts are spread round the wheel and chosen against the base's own
 * colour rather than in the abstract — the cinderling is already hot, so the
 * emberling goes **grey and keeps a hot core** (chroma below 1) rather than
 * getting hotter, where the sentinel's cool brass takes a straight shift.
 *
 * They are also **large**. The first pass gave several of these twenty or
 * thirty degrees with the chroma pulled down, which is a difference that
 * survives a contact sheet and dies in a room: a breaker at eighteen degrees
 * off a tank was, at 1x, a tank. Everything but the emberling now moves at
 * least fifty-five degrees and keeps its chroma, which is still a shift
 * rather than a replacement — a pinner reads as a shooter in another colour,
 * not as a body the player has to learn.
 */
export const SUBSPECIES_ART: readonly SubspeciesArt[] = [
  { id: "pinner", base: "shooter", hueShift: -62, chroma: 0.9, mark: "fork", accentHue: 205 },
  { id: "wisp", base: "orbiter", hueShift: 62, chroma: 1.15, mark: "horn", accentHue: 285 },
  { id: "beacon", base: "turret", hueShift: -52, chroma: 1.3, mark: "flare", accentHue: 28 },
  { id: "watcher", base: "sentinel", hueShift: 74, chroma: 0.85, mark: "lens", accentHue: 190 },
  { id: "fusilier", base: "warden", hueShift: -58, chroma: 1.2, mark: "plume", accentHue: 44 },
  { id: "pealer", base: "bellringer", hueShift: 66, chroma: 1.15, mark: "bells", accentHue: 160 },
  { id: "quaker", base: "rifter", hueShift: 78, chroma: 0.85, mark: "spur", accentHue: 210 },
  { id: "chainer", base: "snarecaster", hueShift: 76, chroma: 0.9, mark: "crest", accentHue: 220 },
  { id: "burrower", base: "delver", hueShift: -46, chroma: 0.8, mark: "tusk", accentHue: 40 },
  { id: "emberling", base: "cinderling", hueShift: 14, chroma: 0.45, mark: "vent", accentHue: 20 },
  { id: "planter", base: "sower", hueShift: -96, chroma: 1.1, mark: "frond", accentHue: 100 },
  { id: "breaker", base: "tank", hueShift: -60, chroma: 1.25, mark: "wedge", accentHue: 12 },
  { id: "brooder", base: "summoner", hueShift: 62, chroma: 1.1, mark: "sac", accentHue: 272 },
];

export const SUBSPECIES_ART_BY_ID: Readonly<Record<string, SubspeciesArt>> =
  Object.fromEntries(SUBSPECIES_ART.map((s) => [s.id, s]));

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = l - c / 2;
  const t: Rgb = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x]
    : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  return [Math.round((t[0] + m) * 255), Math.round((t[1] + m) * 255), Math.round((t[2] + m) * 255)];
}

/**
 * The subspecies' palette, from its base's.
 *
 * **Lightness is never touched.** Doc 016's value band is what keeps a body
 * readable against the floor and below the brightness of pickups and effects,
 * and it is applied where a delivered frame is made — so a variant that
 * brightened or darkened its ramps would walk straight out of the band that
 * the base was checked against. Hue and chroma carry the whole difference,
 * and the outline is left exactly as it is, because two rings of near-black
 * ink is most of what separates any body from the stone.
 */
export function shiftPalette(base: Palette, art: SubspeciesArt): Palette {
  const ramps: Record<string, string[]> = {};
  for (const [material, ramp] of Object.entries(base.ramps)) {
    if (material === "outline") { ramps[material] = [...ramp]; continue; }
    ramps[material] = ramp.map((c) => {
      const [h, s, l] = hsl(rgb(c));
      return hex(hslToRgb(h + art.hueShift, Math.min(1, s * art.chroma), l));
    });
  }
  return { ramps };
}

/** One entry of the table the game swaps with: this colour becomes that one. */
export interface PaletteSwap {
  readonly id: string;
  readonly base: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
}

/**
 * The whole table, in the order the game reads it.
 *
 * Duplicated source colours are dropped: a lookup is by colour and cannot know
 * which material a pixel came from, so a shade two ramps share swaps once and
 * swaps the same way for both.
 */
export function paletteTable(palettes: Readonly<Record<string, Palette>>): PaletteSwap[] {
  const out: PaletteSwap[] = [];
  for (const art of SUBSPECIES_ART) {
    const base = palettes[art.base];
    if (!base) continue;
    const shifted = shiftPalette(base, art);
    const from: string[] = [];
    const to: string[] = [];
    const seen = new Set<string>();
    for (const [material, ramp] of Object.entries(base.ramps)) {
      ramp.forEach((c, i) => {
        const key = c.toLowerCase();
        const dst = shifted.ramps[material]![i]!;
        if (seen.has(key) || dst.toLowerCase() === key) return;
        seen.add(key);
        from.push(c);
        to.push(dst);
      });
    }
    out.push({ id: art.id, base: art.base, from, to });
  }
  return out;
}

/* ---------------------------------- marks --------------------------------- */

/**
 * The mark's frame, in art pixels: the `s32` class, which is 16 world pixels
 * at the art's 2x. Small on purpose — it is a mark, not a body — and the
 * drawing sits in the middle of it, so the anchor can be placed at the frame's
 * centre and the shape hangs off that.
 *
 * Every accent hue is kept **out of the reserved enemy-bullet band** (doc 008:
 * 328 degrees, ±25, above half saturation). A mark in that band is a pixel the
 * player has been trained to read as a bullet, sitting on a body's head.
 */
export const MARK_PX = 32;

type Facing = "s" | "n" | "w";

/**
 * Draws one mark.
 *
 * Code-drawn rather than delivered, for the reason doc 016 gives for effects:
 * these have no anatomy to compose and one pose each, so a model would add a
 * round trip and nothing else. Each shape is a few primitives, in the
 * subspecies' accent over a dark rim, so it holds its edge against whatever
 * the palette shift did to the body underneath.
 */
export function drawMark(art: SubspeciesArt, facing: Facing): PNG {
  const png = new PNG({ width: MARK_PX, height: MARK_PX });
  png.data.fill(0);
  const light = hslToRgb(art.accentHue, 0.72, 0.62);
  const mid = hslToRgb(art.accentHue, 0.78, 0.44);
  const dark = hslToRgb(art.accentHue, 0.6, 0.2);
  const put = (x0: number, y0: number, c: Rgb): void => {
    const x = x0;
    const y = y0 + cy;
    if (x < 0 || y < 0 || x >= MARK_PX || y >= MARK_PX) return;
    const i = (y * MARK_PX + x) * 4;
    png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = 255;
  };
  const bar = (x0: number, y0: number, w: number, h: number, c: Rgb): void => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, c);
  };
  // A back view hides what a front view shows, so the two side marks swap and
  // a facing-forward mark loses a pixel of height: the body is between.
  const back = facing === "n";
  const cx = MARK_PX / 2;
  // The shapes below were drawn against a 16 px frame; the middle of a 32 px
  // one is 8 px lower, so they hang from the same point on a body.
  const cy = MARK_PX / 4;

  switch (art.mark) {
    case "horn": case "tusk": {
      // Two curved points, out and up; tusks point down instead.
      const dir = art.mark === "horn" ? -1 : 1;
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          const x = cx + side * (2 + Math.round(i * 0.7));
          const y = 8 + dir * i;
          put(x, y, i > 2 ? light : mid);
          put(x, y + dir, dark);
        }
      }
      break;
    }
    case "crest": {
      // A raised ridge along the top, tallest in the middle.
      for (let i = -3; i <= 3; i++) {
        const h = 5 - Math.abs(i);
        bar(cx + i, 8 - h, 1, h, i === 0 ? light : mid);
        put(cx + i, 8 - h - 1, dark);
      }
      break;
    }
    case "plume": {
      // A single tall feather, leaning with the facing.
      const lean = back ? 0 : 1;
      for (let i = 0; i < 7; i++) {
        put(cx + Math.round(i * 0.35) * lean, 9 - i, i > 4 ? light : mid);
        put(cx + Math.round(i * 0.35) * lean + 1, 9 - i, dark);
      }
      break;
    }
    case "lens": {
      // A barrel with a bright eye at the end.
      bar(cx - 1, 6, 3, 5, mid);
      bar(cx - 2, 5, 5, 1, dark);
      bar(cx, 7, 1, 2, light);
      break;
    }
    case "frond": {
      // Three fronds fanning out.
      for (const side of [-1, 0, 1]) {
        for (let i = 0; i < 4; i++) put(cx + side * i, 10 - i, i > 2 ? light : mid);
      }
      bar(cx - 1, 10, 3, 1, dark);
      break;
    }
    case "bells": {
      // Three small bells in a row along the crown.
      for (const side of [-3, 0, 3]) {
        bar(cx + side - 1, 6, 3, 3, mid);
        put(cx + side, 9, light);
        bar(cx + side - 1, 5, 3, 1, dark);
      }
      break;
    }
    case "spur": {
      // One angled wedge, unmistakably off-centre.
      for (let i = 0; i < 6; i++) bar(cx + i - 2, 10 - i, Math.max(1, 3 - Math.floor(i / 2)), 1, i > 3 ? light : mid);
      break;
    }
    case "vent": {
      // A split with a hot core showing through it.
      bar(cx - 3, 7, 7, 1, dark);
      bar(cx - 2, 8, 5, 2, mid);
      bar(cx - 1, 8, 3, 1, light);
      break;
    }
    case "sac": {
      // A round growth on one shoulder, which the back view puts on the other.
      const side = back ? -4 : 4;
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
        if (x * x + y * y > 5) continue;
        put(cx + side + x, 9 + y, x + y <= -1 ? light : mid);
      }
      bar(cx + side - 2, 12, 5, 1, dark);
      break;
    }
    case "fork": {
      // A forked tip: two prongs with a notch between them.
      for (const side of [-2, 2]) for (let i = 0; i < 5; i++) put(cx + side, 10 - i, i > 2 ? light : mid);
      bar(cx - 2, 11, 5, 1, dark);
      break;
    }
    case "flare": {
      // A signal: a thin mast under a wide cap, with two short rays off it.
      for (let i = 0; i < 4; i++) put(cx, 9 - i, mid);
      bar(cx - 3, 5, 7, 1, light);
      bar(cx - 2, 4, 5, 1, dark);
      put(cx - 4, 7, mid);
      put(cx + 4, 7, mid);
      bar(cx - 1, 10, 3, 1, dark);
      break;
    }
    case "wedge": {
      // A ram: two blunt blocks either side of a low plate. Broad and flat,
      // where a crest is narrow and tall — the two must not read alike.
      for (const side of [-1, 1]) {
        bar(cx + side * 4 - 1, 7, 3, 3, mid);
        bar(cx + side * 4 - 1, 6, 3, 1, light);
        bar(cx + side * 4 - 1, 10, 3, 1, dark);
      }
      bar(cx - 2, 8, 5, 2, mid);
      bar(cx - 2, 10, 5, 1, dark);
      break;
    }
  }
  return rim(png);
}

/**
 * One ring of near-black ink round the shape, the same ink a body's outline is
 * drawn in.
 *
 * Without it a mark is the subspecies' accent laid straight on the subspecies'
 * own body, which is a hue against a hue — and hue is exactly what does not
 * survive being small, moving, and lit by whatever the room's mood is. The ink
 * is what makes it a *silhouette* instead of a stain, and it is the same
 * reason doc 016 rings every body: two shades apart at the same value is a
 * blur, and anything against near-black is an edge.
 */
const MARK_INK: Rgb = [13, 11, 31];

function rim(png: PNG): PNG {
  const opaque = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < MARK_PX && y < MARK_PX && png.data[((y * MARK_PX + x) * 4) + 3]! > 0;
  const add: number[] = [];
  for (let y = 0; y < MARK_PX; y++) for (let x = 0; x < MARK_PX; x++) {
    if (opaque(x, y)) continue;
    if (opaque(x + 1, y) || opaque(x - 1, y) || opaque(x, y + 1) || opaque(x, y - 1)) add.push(y * MARK_PX + x);
  }
  for (const p of add) {
    const i = p * 4;
    png.data[i] = MARK_INK[0]; png.data[i + 1] = MARK_INK[1]; png.data[i + 2] = MARK_INK[2]; png.data[i + 3] = 255;
  }
  return png;
}

export const markFrameName = (id: string, facing: string): string => `mark_${id}_${facing}`;
