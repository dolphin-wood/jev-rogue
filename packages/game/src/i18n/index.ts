/**
 * The game's three languages, and the one place a string becomes words.
 *
 * Every player-facing string in the game package comes from here. Two rules
 * decide what belongs:
 *
 * - **UI chrome** — headings, menu rows, hints, prompts, toasts — lives in
 *   `en.ts`, `zh.ts` and `ja.ts`, keyed by a dotted name. `en.ts` is the
 *   canonical key set: `t` is typed against it, so a key added in English and
 *   forgotten elsewhere is a type error rather than a blank label.
 * - **Content** — spell, affix, stat, enemy, school and style names and
 *   descriptions — is keyed by the **id** it already has in `core`. Core keeps
 *   its English, because the harness and the tests read it and because that
 *   is the text the Director is sent; the translations sit beside it here and
 *   are looked up by id, falling back to core when they are missing.
 *
 * Nothing here ever reaches Jev. The Director's state, questions and options
 * are English identifiers and stay that way (`docs/planning/002`): a run
 * planned in Chinese must be the same run planned in English.
 */
import { EN } from "./en.ts";
import { ZH } from "./zh.ts";
import { JA } from "./ja.ts";
import { EN_CONTENT } from "./content-en.ts";
import { ZH_CONTENT } from "./content-zh.ts";
import { JA_CONTENT } from "./content-ja.ts";

export type Lang = "en" | "zh" | "ja";

/** Every language the game offers, in the order the menu cycles them. */
export const LANGS: readonly Lang[] = ["en", "zh", "ja"];

/**
 * Each language named **in its own script**, which is the only naming that
 * works: a player who has landed in a language they cannot read needs to
 * recognise their own, and "Chinese" is no help to someone looking for 中文.
 */
export const LANG_NAMES: Readonly<Record<Lang, string>> = {
  en: "English",
  zh: "简体中文",
  ja: "日本語",
};

/** The key set, taken from English so the others cannot drift from it. */
export type StringKey = keyof typeof EN;

/** What a translated table must provide: all of it. */
export type Table = Readonly<Record<StringKey, string>>;

const TABLES: Readonly<Record<Lang, Table>> = { en: EN, zh: ZH, ja: JA };

/**
 * The text a content id carries, when a language has one of its own.
 *
 * `name` and `description` are separate because they are used separately: a
 * card shows both, the action bar and the character list show only the name.
 */
export interface ContentText {
  readonly name?: string;
  readonly description?: string;
}

export type ContentTable = Readonly<Record<string, ContentText>>;

const CONTENT: Readonly<Record<Lang, ContentTable>> = {
  en: EN_CONTENT,
  zh: ZH_CONTENT,
  ja: JA_CONTENT,
};

const LANG_STORAGE_KEY = "jr.lang";

/**
 * The language this browser starts in.
 *
 * `navigator.languages[0]` first, because it is the ordered preference list
 * the person actually set; `navigator.language` is the fallback for the few
 * environments that do not provide it. Only consulted while nothing is
 * stored — once a player has chosen, their choice wins over the browser's.
 */
export function defaultLang(): Lang {
  const tags = typeof navigator === "undefined" ? [] : [
    ...(navigator.languages ?? []),
    navigator.language ?? "",
  ];
  const tag = (tags.find((x) => !!x) ?? "").toLowerCase();
  if (tag.startsWith("zh")) return "zh";
  if (tag.startsWith("ja")) return "ja";
  return "en";
}

let current: Lang = (() => {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === "en" || saved === "zh" || saved === "ja") return saved;
  } catch { /* the browser's, then */ }
  return defaultLang();
})();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* this session's only */ }
}

/**
 * A string, in the current language, with `{name}` placeholders filled.
 *
 * A missing translation falls back to English rather than showing the key:
 * a player reading a word in the wrong language has still been told
 * something, and a player reading `character.attributes` has not.
 *
 * Keycap and icon tokens — `[E]`, `{coin}`, `{pips:1/5}` — are left alone.
 * They are markup for `ui/keycap.ts`, not words, and the same tokens have to
 * survive translation for the keycaps to still be drawn.
 */
export function t(key: StringKey, params?: Readonly<Record<string, string | number>>): string {
  const table = TABLES[current];
  const raw = table[key] || EN[key] || key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    (name in params ? String(params[name]) : whole));
}

/**
 * A content id's display name, or `fallback` — which is core's English.
 *
 * Called with what core already produced, so English costs nothing and needs
 * no table of its own.
 */
export function contentName(id: string, fallback: string): string {
  return CONTENT[current][id]?.name ?? fallback;
}

export function contentDescription(id: string, fallback: string): string {
  return CONTENT[current][id]?.description ?? fallback;
}

/**
 * A number line or rules sentence that **core** produced, said in the player's
 * language.
 *
 * Core writes every one of these in English — "7 fire dmg x3", "+35% damage",
 * "Burn: 36% of the gauge a hit, 3 hits to ignite." — because the harness, the
 * tests and the Director read that text and doc 002 requires a run planned in
 * Chinese to be the same run planned in English. So core also hands over a
 * `key` and `args`, and this is the one place they become words.
 *
 * `args` carry numbers and **ids**, never English: an element arrives as
 * `fire` and a modifier as `damage_mult`, and each is named from this table
 * through a key of its own. A part with no key, or a key no table has, falls
 * back to core's English — which is a line in the wrong language, but a line.
 */
export interface StatText {
  readonly text: string;
  readonly key?: string;
  readonly args?: Readonly<Record<string, string | number>>;
}

/** Whether a key is in the tables at all, without widening `StringKey`. */
function lookup(key: string): string | null {
  const table = TABLES[current] as Readonly<Record<string, string>>;
  return table[key] || (EN as Readonly<Record<string, string>>)[key] || null;
}

/** An id argument, named from the table that holds that kind of id. */
function localizeArg(name: string, value: string | number): string | number {
  if (typeof value !== "string") return value;
  if (name === "element") return lookup(`element.${value}`) ?? value;
  if (name === "label") return lookup(`statlabel.${value}`) ?? value;
  // An affix travels as its id and is named from the content table.
  if (name === "affix") return contentName(value, value);
  if (name === "shapes")
    return value.split(",").map((s) => lookup(`shape.${s}`) ?? s).join(lookup("list.sep") ?? ", ");
  return value;
}

export function localizeStat(part: StatText): string {
  if (!part.key) return part.text;
  const raw = lookup(part.key);
  if (!raw) return part.text;
  const args: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(part.args ?? {})) args[name] = localizeArg(name, value);
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    (name in args ? String(args[name]) : whole));
}

/**
 * **A Director id, in the player's language.**
 *
 * The room plan page shows what the Director was sent and what it answered,
 * and all of it is ids: a state field (`run_progress`), the bucket it was in
 * (`pre_boss`), a question (`space`), an option (`open_arena`). None of that
 * is translated on the wire — the request Jev is sent keeps every id exactly
 * as core spells it, because doc 002 requires a run planned in Chinese to be
 * the same run planned in English — so this is the display layer over it, and
 * the only one.
 *
 * `field` scopes the lookup for the handful of ids that mean two things: `mid`
 * is a build's range and also the middle of a run, `long` is a range and also
 * a long time without a breather. `term.<field>.<value>` wins where it exists
 * and the bare `term.<value>` serves everything else.
 *
 * Three fallbacks, in order, and each is a smaller promise than the last: a
 * content name (spells, affixes, stats and schools are named in the content
 * tables already, so they are not repeated here), then the id with its
 * underscores opened out. An id that reaches the last one is a missing
 * translation rather than a design choice, which is what `i18n.test.ts`
 * walks core's own enums to catch.
 */
export function term(id: string, field?: string): string {
  if (id === "") return "";
  // A composite key — a portal set (`stat+spell+gold`), a door set — is its
  // parts, each named on its own and joined the way the language joins a list.
  if (id.includes("+")) return id.split("+").map((part) => term(part, field)).join(termJoin());
  const scoped = field ? lookup(`term.${field}.${id}`) : null;
  if (scoped) return scoped;
  const flat = lookup(`term.${id}`);
  if (flat) return flat;
  const content = CONTENT[current][id]?.name ?? EN_CONTENT[id]?.name;
  if (content) return content;
  return id.replace(/_/g, " ");
}

/** How a composite id's parts are joined: " + " reads as an id, not a list. */
function termJoin(): string {
  return lookup("term.plus") ?? " + ";
}

/** For the test that every id core knows has a translation on both sides. */
export function contentTable(lang: Lang): ContentTable {
  return CONTENT[lang];
}

export function stringTable(lang: Lang): Table {
  return TABLES[lang];
}

/**
 * The font stack, which is the same for every language.
 *
 * **All of it is pixel type.** Latin used to be the system `monospace` —
 * Menlo, Consolas, whatever the machine had — which is not a pixel font, and
 * it showed: a line of Chinese with "Jev Director" or `x1` in it changed
 * typeface mid-sentence, and even an English-only screen was anti-aliased
 * text inside a pixel-art game.
 *
 * Ark Pixel covers Latin and Fusion Pixel covers CJK, and Fusion takes its
 * Latin *from* Ark, so the two match by design rather than by luck. Ark is
 * first in the stack for every language, so Latin inside a Chinese line is
 * drawn by the same face that draws an English screen; the browser picks per
 * glyph from the `unicode-range`s declared in `index.html`, so an English
 * player never downloads the CJK files.
 *
 * `monospace` stays at the end as the last resort, for the frames before the
 * faces have loaded and for anything neither of them covers.
 */
export function fontFamily(_lang: Lang = current): string {
  return "\"Ark Pixel 12\", \"Fusion Pixel 12\", monospace";
}

/** A few glyphs from each face's range, so `loadFont` fetches the file the language draws with. */
const FONT_PROBE: Readonly<Record<Lang, string>> = { en: "", zh: "继续设置", ja: "つづけるセッティング設定" };
/** Latin is drawn on every screen in every language, so it always loads first. */
const LATIN_PROBE = "New Game 0123";
/** How long a start waits for the font before drawing with the fallback anyway. */
const FONT_WAIT_MS = 1500;

/**
 * Loads the language's CJK face before anything is drawn with it.
 *
 * Each face loads only when a glyph in its `unicode-range` is first drawn, so
 * the game's first frames were drawn in the fallback and then again when the
 * file arrived — the flash on every start. Canvas text is drawn once, so it
 * cannot swap in place as page text does; asking the browser for the face
 * first, from its cache after the first visit, draws the first frame in it.
 * Never throws and never waits longer than `FONT_WAIT_MS`.
 */
export async function loadFont(lang: Lang = current): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const quiet = (p: Promise<unknown>) => p.then(() => undefined, () => undefined);
  // Latin always: every screen in every language draws some.
  const loads = [quiet(document.fonts.load(`12px "Ark Pixel 12"`, LATIN_PROBE))];
  const probe = FONT_PROBE[lang];
  if (probe) loads.push(quiet(document.fonts.load(`12px "Fusion Pixel 12"`, probe)));
  await Promise.race([
    Promise.all(loads).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, FONT_WAIT_MS)),
  ]);
}

/**
 * The size to author a label at so the CJK font lands on its own pixel grid.
 *
 * Fusion Pixel is a 12 px bitmap face: drawn at any other size it is
 * resampled, and a resampled pixel font is a blur — the one thing the whole
 * fixed-size authoring scheme exists to avoid.
 *
 * The game writes text at `px` and renders it at `px * zoom`, so what has to
 * be a multiple of 12 is **the rendered size**, not the authored one.
 * Snapping the authored number instead is what made every Chinese label
 * twice the size of the English it replaced: at a zoom of 8, a 7 px label is
 * rendered at 56, and rounding 7 up to 12 asked for 96.
 *
 * Snapping the rendered size and dividing back keeps the label the size it
 * was designed at — 7 becomes 7.5 — and puts it on the grid.
 */
export function fontPx(px: number, zoom = 1, floor = MIN_RENDERED_PX): number {
  // Both faces are 12 px natives now, so every language snaps — English used
  // to be exempt only because it was drawn in a scalable system font.
  const rendered = Math.max(floor, Math.round((px * zoom) / 12) * 12);
  return rendered / zoom;
}

/**
 * The smallest a glyph is ever rendered, in backing-store pixels.
 *
 * Two 12s, because one is not enough to read. Ark Pixel puts 0.83 of its em
 * into ink against the system monospace's 0.94, and the snapping rounds sizes
 * down as often as up — between them the switch to pixel type cost about a
 * quarter of the apparent size, which is what "字小得看不见了" was. Three
 * multiples is where a body line measures about the same ink as the system
 * font it replaced.
 */
export const MIN_RENDERED_PX = 24;
/** Prose and labels: never below this, whatever the call site asked for. */
export const MIN_BODY_PX = 36;

/** `fontPx` for anything the player reads as words rather than as a marker. */
export function bodyPx(px: number, zoom = 1): number {
  return fontPx(px, zoom, MIN_BODY_PX);
}

/**
 * Extra space between glyphs, in authored pixels.
 *
 * Fusion Pixel is monospaced and packs its glyphs edge to edge, which at
 * this size reads as a solid block: Latin text has ascenders and descenders
 * and varied widths to separate its words, and a column of full-width CJK
 * squares has none of that. One pixel is enough to give each character an
 * edge.
 */
export function letterSpacing(lang: Lang = current): number {
  return lang === "en" ? 0 : 1;
}

/**
 * How far apart rows of this language sit, as a multiple of the row pitch
 * the English was laid out on.
 *
 * CJK glyphs are full-height squares with no space above or below them, so
 * lines that were comfortable in Latin touch. A sixth again is the smallest
 * that reads as separate rows.
 */
export function linePitch(lang: Lang = current): number {
  return lang === "en" ? 1 : 1.18;
}

/**
 * Extra leading between wrapped lines, as a fraction of the glyph height.
 *
 * A pixel face draws its glyphs to the full em box with nothing above or
 * below, so consecutive lines touch: `lineSpacing` of zero is not "normal
 * leading", it is none at all. CJK needs the most, because every glyph is a
 * full square that reaches both edges; Latin has ascenders and descenders
 * doing some of the work but still needs a third of a line.
 *
 * One number, here, so every wrapped text on every screen gets the same
 * answer — this was set per call site and most call sites did not set it.
 */
export function lineLead(lang: Lang = current): number {
  return lang === "en" ? 0.35 : 0.5;
}

/**
 * Whether a character takes a full em in these monospaced pixel faces.
 *
 * Ark and Fusion are "monospaced" in the CJK sense: a han character, a kana
 * or a full-width mark is one em, and Latin is half of one. Knowing which is
 * which is what lets `wrapText` measure a mixed line without asking the
 * renderer.
 */
function fullWidth(code: number): boolean {
  return (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0x303e)
    || (code >= 0x3041 && code <= 0x33ff)
    || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xa000 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6);
}

/**
 * Kinsoku, the short version: marks that may not open a line, and marks that
 * may not close one.
 *
 * A break before a full stop or after an opening bracket reads as a typo in
 * both scripts, and in Chinese and Japanese — where the break can land
 * between any two characters — it would otherwise happen constantly.
 */
const NO_LINE_START = "、。，．・ー：；？！）〕］｝」』〉》”’?!,.:;)]}";
const NO_LINE_END = "（〔［｛「『〈《“‘([{";

/**
 * How wide a string is drawn, in the monospaced pixel faces, without asking
 * the renderer.
 *
 * A han character, a kana and a full-width mark are one em; Latin is half of
 * one. Every fitting decision in the UI used to assume the Latin half —
 * `text.length * px * 0.6` — which is right for English and about twice too
 * narrow for Chinese, and is exactly why a row that fitted in English ran off
 * the edge of the room plan page in Chinese.
 */
export function measureText(text: string, px: number, spacing = letterSpacing()): number {
  let w = 0;
  for (const c of text) w += (fullWidth(c.codePointAt(0) ?? 0) ? px : px * 0.5) + spacing;
  return w;
}

/**
 * A character that may not be parted from the one beside it, because the two
 * are inside one Latin word.
 *
 * This is the rule the wrap was missing. Chinese and Japanese break between
 * any two characters, and applying that to Latin gives `fan ou / t.` and
 * `fight / s.` — which is what the style cards on the new-run screen actually
 * showed, because the break was decided by the *kinsoku* branch below, where
 * the full stop pushed the letter before it onto the next line without ever
 * looking for the space a few characters back.
 *
 * Letters, digits and the marks that live inside a word (an apostrophe, a
 * combining accent) all count. A hyphen deliberately does not: a hyphen is a
 * place a Latin line is *allowed* to break, and `breakAt` below records it as
 * one.
 */
export function wordChar(c: string): boolean {
  const code = c.codePointAt(0) ?? 0;
  return !fullWidth(code) && (/[\p{L}\p{N}\p{M}]/u.test(c) || c === "'" || c === "’");
}

/**
 * Breaks a string to `maxPx`, per character in CJK and per word in Latin.
 *
 * Phaser wraps on whitespace, and Chinese and Japanese have none: a card's
 * description came back as one line that ran clean across its neighbours and
 * off both sides of the screen. Wrapping per character is how those scripts
 * are actually set, with the usual two rules — a closing mark never starts a
 * line, an opening mark never ends one.
 *
 * Latin is the other half, and it is a rule about what may *not* be parted
 * rather than about what may: a break is refused between two characters of
 * one word, and the line goes back to the last space or hyphen instead. Only
 * a word wider than the whole column is cut, because there is nowhere else
 * for it to go. A mixed line gets both, decided at each break by the two
 * characters the break would fall between.
 */
export function wrapText(text: string, maxPx: number, px: number, spacing = 0): string {
  const width = (c: string) => (fullWidth(c.codePointAt(0) ?? 0) ? px : px * 0.5) + spacing;
  const measure = (s: string) => [...s].reduce((n, ch) => n + width(ch), 0);
  const lines: string[] = [];
  let line = "";
  let used = 0;
  /**
   * The last place this line may be broken without splitting a word: the
   * index of a space (which is dropped at the break) or the index just past
   * a hyphen (which stays on the upper line). -1 while there is none.
   */
  let breakAt = -1;
  let breakDrops = false;
  /** A break: the space at the end of the upper line goes with the break. */
  const newLine = (head: string, tail: string): void => {
    lines.push(head.replace(/ +$/, ""));
    line = tail;
    used = measure(tail);
    breakAt = -1;
    breakDrops = false;
  };
  for (const c of [...text]) {
    if (c === "\n") { newLine(line, ""); continue; }
    const w = width(c);
    if (used + w > maxPx && line.length > 0) {
      const prev = [...line].pop()!;
      // Three reasons a break may not fall here: a closing mark would open
      // the next line, an opening mark would close this one, or the break is
      // inside a Latin word — including one a hyphen holds together, since a
      // hyphen belongs at the end of the upper line and never at the start of
      // the lower one.
      const refused = NO_LINE_START.includes(c) || NO_LINE_END.includes(prev)
        || (wordChar(prev) && (wordChar(c) || c === "-"));
      if (!refused) {
        newLine(line, "");
      } else if (breakAt > 0) {
        // Back to the last space or hyphen. This is the Latin case, and it is
        // also the right answer for a mark in a mixed line: the whole word
        // goes down together rather than losing its last letter.
        newLine(line.slice(0, breakAt), line.slice(breakAt + (breakDrops ? 1 : 0)));
      } else if (NO_LINE_START.includes(c)) {
        /*
         * A closing mark never starts a line, so the character before it goes
         * down with it — *oidashi*, pushing out.
         *
         * It used to hang the mark off the end of the line instead, which is
         * also a real setting, but here the line is already at the width of a
         * card's inner column: one glyph past it lands on the border. Pushing
         * out keeps the rule and the padding both.
         */
        const kept = [...line];
        const pushed = kept.length > 1 ? kept.pop()! : "";
        newLine(kept.join(""), pushed + c);
        continue;
      } else {
        // No space to go back to: an opening mark at the end of the line goes
        // down with what follows it, and a word wider than the whole column
        // is cut, because nothing else will make it fit.
        let head = line;
        let tail = "";
        while ([...head].length > 1 && NO_LINE_END.includes(head[head.length - 1]!)) {
          tail = head[head.length - 1]! + tail;
          head = head.slice(0, -1);
        }
        newLine(head, tail);
      }
    }
    // A line never opens with a space — the one the break fell on, or one
    // left after a newline — or the word under a break would sit a glyph in
    // from the ones above it.
    if (c === " " && line.length === 0) continue;
    if (c === " ") { breakAt = line.length; breakDrops = true; }
    line += c;
    used += w;
    // After the hyphen, not before it: `hit-and-run` breaks as `hit-` / `and-`.
    if ((c === "-" || c === "/") && line.length > 1) { breakAt = line.length; breakDrops = false; }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}
