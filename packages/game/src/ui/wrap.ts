/**
 * Wrapping a coloured line to a column, in pixels.
 *
 * The room plan's Director Questions page draws each row as several coloured
 * pieces — the question, who answered, the answer, then every option with its
 * probability — and it wrapped them by counting characters. That is the Latin
 * assumption twice over: a han character is a full em against Latin's half,
 * and a piece longer than the whole column was never broken at all, so the
 * longest rows ran past the column and under the scroll bar. In Chinese and
 * Japanese, where the answers are wider and there is no space to break at,
 * that was most of the page.
 *
 * So the wrap is measured rather than counted, and a piece that does not fit
 * on its own is split rather than left to overflow. Nothing here draws: it
 * returns rows, which is what makes it testable against the longest labels
 * the tables actually hold.
 */
import { measureText, wordChar } from "../i18n/index.ts";

/** One coloured piece of a line. Matches `PlanSpan` in `scenes/play.ts`. */
export interface Span {
  readonly text: string;
  readonly color: string;
  readonly bold?: boolean;
}

/**
 * Marks that may not open a line, in the two scripts that can break anywhere.
 * A break before a full stop or a closing bracket reads as a typo.
 */
const NO_LINE_START = "、。，．・ー：；？！）〕］｝」』〉》”’?!,.:;)]}%";

/**
 * The longest prefix of `text` that fits `maxPx`, and what is left.
 *
 * Latin breaks at the last space or hyphen, because a word split down the
 * middle is unreadable; CJK breaks between any two characters, because that
 * is how the scripts are set and there are no spaces to find. Which of the
 * two applies is decided by the pair of characters the break would fall
 * between, so a mixed line gets both rules in the places they belong.
 *
 * It used to take the space only when it sat past halfway, on the argument
 * that an earlier one wastes the column — but the waste is a ragged edge and
 * the alternative is `fan ou / t.`, which reads as a rendering fault. At
 * least one character is always taken, so a column too narrow for a single
 * glyph cannot loop, and a word wider than the whole column is still cut.
 */
export function cutToWidth(text: string, maxPx: number, px: number, spacing: number): [string, string] {
  const chars = [...text];
  let taken = 0;
  let used = 0;
  for (const c of chars) {
    const w = measureText(c, px, spacing);
    if (used + w > maxPx && taken > 0) break;
    used += w;
    taken++;
  }
  // Never leave a closing mark to open the next line.
  while (taken > 1 && NO_LINE_START.includes(chars[taken] ?? "")) taken--;
  const hard = chars.slice(0, taken).join("").length;
  const prev = chars[taken - 1] ?? "";
  const next = chars[taken] ?? "";
  // Inside a word: back up to the last space, or to just after the last
  // hyphen, and only cut where it stands if there is neither.
  if (wordChar(prev) && (wordChar(next) || next === "-")) {
    const space = text.lastIndexOf(" ", hard);
    const hyphen = text.lastIndexOf("-", hard - 1);
    if (space > 0 && space >= hyphen) return [text.slice(0, space), text.slice(space + 1).replace(/^ +/, "")];
    if (hyphen > 0) return [text.slice(0, hyphen + 1), text.slice(hyphen + 1)];
  }
  return [text.slice(0, hard).replace(/ +$/, ""), text.slice(hard).replace(/^ +/, "")];
}

/** A wrapped row: the pieces on it, and how far it is indented. */
export interface WrappedRow {
  readonly spans: Span[];
  readonly indent: number;
  readonly first: boolean;
}

/**
 * Breaks one line of coloured pieces into rows no wider than `maxPx`.
 *
 * `indent` is the line's own indent; continuation rows take `indent + hang`,
 * so a wrapped option list reads as a continuation rather than as a new line.
 * A piece keeps its colour across a break.
 */
export function wrapSpans(
  spans: readonly Span[], maxPx: number, px: number, spacing: number, indent = 0, hang = 8,
): WrappedRow[] {
  const out: WrappedRow[] = [];
  let row: Span[] = [];
  let used = 0;
  let first = true;
  const room = () => Math.max(px, maxPx - indent - (first ? 0 : hang));
  const flush = () => {
    if (row.length === 0) return;
    out.push({ spans: row, indent: indent + (first ? 0 : hang), first });
    row = [];
    used = 0;
    first = false;
  };
  for (const span of spans) {
    let text = span.text;
    while (text.length > 0) {
      // The piece that opens a row never opens it with a space.
      if (row.length === 0 && used === 0) text = text.replace(/^ +/, "");
      if (text.length === 0) break;
      const w = measureText(text, px, spacing);
      if (used + w <= room()) {
        row.push({ ...span, text });
        used += w;
        break;
      }
      // It does not fit. Start a new row first, unless this row is empty —
      // in which case the piece is wider than the column and has to be cut.
      if (used > 0) { flush(); continue; }
      const [head, rest] = cutToWidth(text, room(), px, spacing);
      row.push({ ...span, text: head });
      used += measureText(head, px, spacing);
      text = rest;
      flush();
    }
  }
  flush();
  return out;
}

/** The width a wrapped row is drawn at, for the test that none overflows. */
export function rowWidth(row: WrappedRow, px: number, spacing: number): number {
  return row.indent + row.spans.reduce((w, s) => w + measureText(s.text, px, spacing), 0);
}
