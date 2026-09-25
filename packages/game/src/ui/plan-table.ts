/**
 * The room plan's decisions table, laid out but not drawn.
 *
 * It was a list of sentences — question, answer, percentage, runners-up and
 * who answered, all run together at whatever x each row happened to reach —
 * set at a pitch chosen against Latin. In Chinese that fails twice over:
 * consecutive rows of full-height glyphs touch, so 地形 / 对称 / 大小 fuse
 * into a block, and with nothing aligned there is no column for the eye to
 * run down. The rules this file holds:
 *
 * - **the pitch follows the script.** CJK glyphs fill their em box top to
 *   bottom and need half a line again between rows; Latin has ascenders and
 *   descenders doing some of that work. Rounded to a whole pixel, so every
 *   row sits on the grid the pixel font is drawn on.
 * - **a section heading gets air above it** and a little below, so a subject
 *   reads as a group rather than as another row.
 * - **four columns**: the question, the answer with how sure it was, the
 *   runners-up, and — right-aligned in a column of its own — who answered. A
 *   page of "rule" turning into a page of "Jev" is the project's whole
 *   thesis, and it has to be scannable down one edge.
 * - **nothing is clipped.** A row with no room for its runners-up drops them
 *   to a second, indented, dimmer line; a table with no room for those drops
 *   the runners-up altogether, and one that still overruns stops at a whole
 *   row and says how many are left. Every option of every question is a tab
 *   away, which is what that tab is for.
 *
 * Returning cells rather than drawing them is what makes the rules testable
 * against the longest labels the tables actually hold.
 */
import { measureText } from "../i18n/index.ts";
import { cutToWidth } from "./wrap.ts";

/**
 * A string broken onto as many lines as it needs to stay inside `maxPx`.
 *
 * Nothing on this page is ever cut with an ellipsis: an answer that does not
 * fit its column wraps, because the answer is the one thing the row exists to
 * say. Latin breaks at spaces and CJK between characters; `cutToWidth` knows
 * the difference.
 */
function fitLines(text: string, maxPx: number, px: number, spacing: number): string[] {
  if (text === "" || measureText(text, px, spacing) <= maxPx) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > 0 && measureText(rest, px, spacing) > maxPx) {
    const [head, tail] = cutToWidth(rest, maxPx, px, spacing);
    if (head.length === 0) break;
    out.push(head);
    rest = tail;
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

/** One row: a section heading, or a decision. */
export interface TableRow {
  readonly head?: string;
  readonly key?: string;
  readonly answer?: string;
  /** The two runners-up, already joined the way the language joins a list. */
  readonly others?: string;
  readonly source?: string;
  readonly jev?: boolean;
}

export interface TableStyle {
  /** The table's left edge, and the right edge the source column hangs from. */
  readonly x: number;
  readonly rightEdge: number;
  readonly top: number;
  /** No row may cross this. */
  readonly floor: number;
  readonly px: number;
  readonly smallPx: number;
  readonly spacing: number;
  /** Whether the language is drawn in full-width glyphs, which need more room. */
  readonly cjk: boolean;
}

export interface TableCell {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly px: number;
  readonly color: string;
  /** 0 hangs from the left edge, 1 from the right. */
  readonly origin: 0 | 1;
  readonly bold?: boolean;
}

/** How far apart rows of this script sit, as a whole number of pixels. */
export function rowPitch(px: number, cjk: boolean): number {
  return Math.ceil(px * (cjk ? 1.55 : 1.35));
}

export interface TableLayout {
  readonly cells: readonly TableCell[];
  /** How many of `rows` were laid out; the rest did not fit. */
  readonly shown: number;
  readonly pitch: number;
  /** Where the table ended, for whatever goes under it. */
  readonly endY: number;
}

export function layoutDecisionTable(
  rows: readonly TableRow[], style: TableStyle, withOthers = true,
): TableLayout {
  const { x, rightEdge, top, floor, px, smallPx, spacing, cjk } = style;
  const pitch = rowPitch(px, cjk);
  const smallPitch = rowPitch(smallPx, cjk);
  const headGap = Math.round(pitch * 0.6);
  const headPad = Math.round(pitch * 0.2);
  const gap = Math.max(6, Math.round(px * 0.5));

  const decisions = rows.filter((r) => r.head === undefined);
  // The key column is as wide as the longest key this language has, and never
  // more than two fifths of the table — a language with a long question name
  // may not take the answer's room.
  const keyW = Math.min(
    (rightEdge - x) * 0.42,
    Math.max(0, ...decisions.map((r) => measureText(r.key ?? "", px, spacing))) + gap,
  );
  const srcW = Math.max(0, ...decisions.map((r) => measureText(r.source ?? "", smallPx, spacing))) + gap;
  const answerX = x + keyW;
  const answerRight = rightEdge - srcW;

  const cells: TableCell[] = [];
  let y = top;
  let shown = 0;
  for (const [i, row] of rows.entries()) {
    if (row.head !== undefined) {
      const at = i > 0 ? y + headGap : y;
      if (at + pitch > floor) break;
      cells.push({ x, y: at, text: row.head, px: smallPx, color: "#8fdcff", origin: 0, bold: true });
      y = at + pitch + headPad;
      shown++;
      continue;
    }
    if (y + pitch > floor) break;
    const rowY = y;
    /*
     * A long answer wraps inside its own column rather than running into the
     * source's. A portal set is several reward kinds joined — the widest
     * answer the page can draw — and in Chinese and Japanese it is wider than
     * the column on its own.
     */
    const answerLines = fitLines(row.answer ?? "", answerRight - answerX - gap, px, spacing);
    /*
     * **The question wraps inside its own column too.**
     *
     * `keyW` caps the column at two fifths of the table, and the key was then
     * drawn at full length regardless — so a long question name ran straight
     * through the answer beside it. Seen on the plan page as a question
     * printed across "peak 24%". It wraps the way the answer does; the row is
     * as tall as whichever of the two needed more lines.
     */
    const keyLines = fitLines(row.key ?? "", Math.max(1, keyW - gap), px, spacing);
    const lines = Math.max(answerLines.length, keyLines.length);
    if (rowY + pitch * lines > floor) break;
    keyLines.forEach((line, n) => {
      cells.push({ x, y: rowY + pitch * n, text: line, px, color: "#8792b5", origin: 0 });
    });
    answerLines.forEach((line, n) => {
      cells.push({
        x: answerX, y: rowY + pitch * n, text: line, px,
        color: row.jev ? "#ffe9a8" : "#e8e3d8", origin: 0, bold: true,
      });
    });
    cells.push({ x: rightEdge, y: rowY, text: row.source ?? "", px: smallPx, color: row.jev ? "#8fdcff" : "#5a5f7a", origin: 1 });
    y = rowY + pitch * lines;
    shown++;
    const others = withOthers ? row.others ?? "" : "";
    if (!others) continue;
    const answerW = measureText(answerLines[0] ?? "", px, spacing);
    const othersW = measureText(others, smallPx, spacing);
    if (answerLines.length === 1 && answerX + answerW + gap + othersW <= answerRight) {
      // Room beside the answer: the runners-up ride the same row.
      cells.push({ x: answerX + answerW + gap, y: rowY, text: others, px: smallPx, color: "#6a7396", origin: 0 });
      continue;
    }
    // No room: lines of their own under the answer, dimmer — never a cut.
    const otherLines = fitLines(others, rightEdge - answerX, smallPx, spacing);
    if (y + smallPitch * otherLines.length > floor) { y = rowY; shown--; break; }
    otherLines.forEach((line, n) => {
      cells.push({ x: answerX, y: y + smallPitch * n, text: line, px: smallPx, color: "#6a7396", origin: 0 });
    });
    y += smallPitch * otherLines.length;
  }
  return { cells, shown, pitch, endY: y };
}

/**
 * How far the table can be scrolled: the largest start that still shows
 * everything left.
 *
 * A planned room and its portals ask more than twenty questions, which is
 * more than the column holds at a readable size, so the page's ▴▾ move the
 * table as they move the column beside it. Stopping at the largest start that
 * fills the column means the last press lands on the last row rather than
 * past it.
 */
export function maxScrollFor(rows: readonly TableRow[], style: TableStyle): number {
  let max = 0;
  while (max < rows.length - 1
    && layoutDecisionTable(rows.slice(max), style, false).shown < rows.length - max) max++;
  return max;
}

/** The right edge a cell reaches, for the test that nothing leaves the table. */
export function cellRight(cell: TableCell, spacing: number): number {
  const w = measureText(cell.text, cell.px, spacing);
  return cell.origin === 1 ? cell.x : cell.x + w;
}

/** The left edge a cell starts at, likewise. */
export function cellLeft(cell: TableCell, spacing: number): number {
  const w = measureText(cell.text, cell.px, spacing);
  return cell.origin === 1 ? cell.x - w : cell.x;
}
