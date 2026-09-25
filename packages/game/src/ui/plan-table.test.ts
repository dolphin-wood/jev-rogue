/**
 * The decisions table, measured against the longest rows the game can build.
 *
 * The report this answers: in Chinese the rows were "too dense to read" —
 * consecutive lines of full-height glyphs touched, the sections ran together,
 * nothing lined up, and the widest row ("传送门奖励" with a compound portal
 * set) pushed the source tag off the edge and had its alternatives cut with
 * an ellipsis. Every one of those is a measurement, so every one is here.
 *
 * The rows are built from the real tables — every question the Director can
 * ask, answered with the widest option it can be answered with — so a label
 * that grows past the column fails here rather than on somebody's screen.
 */
import { describe, expect, it } from "vitest";
import { PLAYABLE_ARCHETYPES, REWARD_KINDS, SPELL_SCHOOLS, STAT_FAMILIES } from "@jr/core";
import { CATEGORY_OF } from "../director-readout.ts";
import { LANGS, letterSpacing, measureText, setLang, t, term } from "../i18n/index.ts";
import type { TableRow } from "./plan-table.ts";
import { cellLeft, cellRight, layoutDecisionTable, maxScrollFor, rowPitch } from "./plan-table.ts";

/** The page's own geometry, as `renderDecisions` lays it out. */
const UI_W = 740;
const X = UI_W / 2 + 40;
const RIGHT = UI_W - 30;
const TOP = 96;
const FLOOR = 330;
/** The sizes the page draws at, after the body floor has raised them. */
const PX = 8.67;
const SMALL_PX = 8.67;

function style(cjk: boolean, spacing: number) {
  return { x: X, rightEdge: RIGHT, top: TOP, floor: FLOOR, px: PX, smallPx: SMALL_PX, spacing, cjk };
}

/** The widest answer the page can draw: a portal set is several kinds joined. */
function widestAnswers(): string[] {
  return [
    term([...REWARD_KINDS].join("+"), "portal_kinds"),
    term([...REWARD_KINDS].slice(0, 3).join("+"), "portal_kinds"),
    ...PLAYABLE_ARCHETYPES.map((a) => term(a.id, "space")),
    ...[...SPELL_SCHOOLS].map((s) => term(s, "spell_school")),
    ...[...STAT_FAMILIES].map((f) => term(f, "stat_family")),
  ].sort((a, b) => b.length - a.length);
}

/** Every question, each answered with the widest answer, under every heading. */
function longestRows(): TableRow[] {
  const answers = widestAnswers();
  const bases = [...new Set(
    Object.keys(CATEGORY_OF).map((n) => n.replace(/^zone_.*/, "zone").replace(/ \(code draw\)$/, "")),
  )];
  const out: TableRow[] = [];
  for (const [i, base] of bases.entries()) {
    if (i % 4 === 0) out.push({ head: term("pacing") });
    out.push({
      key: t(`term.qs.${base}` as never),
      answer: `${answers[i % answers.length]} 47%`,
      others: `${answers[(i + 1) % answers.length]} 29%${t("list.sep")}${answers[(i + 2) % answers.length]} 24%`,
      source: term("rule"),
      jev: false,
    });
  }
  return out;
}

describe("the decisions table", () => {
  it("gives CJK rows half a line again, and every row a whole pixel", () => {
    // Glyphs that fill their em box top to bottom touch at a Latin pitch:
    // this is the "too dense to read" report, as a number.
    expect(rowPitch(PX, true)).toBeGreaterThanOrEqual(PX * 1.5);
    expect(rowPitch(PX, false)).toBeGreaterThanOrEqual(PX * 1.25);
    expect(rowPitch(PX, true)).toBeGreaterThan(rowPitch(PX, false));
    for (const cjk of [true, false]) expect(rowPitch(PX, cjk) % 1).toBe(0);
  });

  it("keeps every cell inside the table, in every language", () => {
    const over: string[] = [];
    try {
      for (const lang of LANGS) {
        setLang(lang);
        const spacing = letterSpacing(lang);
        const laid = layoutDecisionTable(longestRows(), style(lang !== "en", spacing));
        for (const cell of laid.cells) {
          if (cellRight(cell, spacing) > RIGHT + 0.5) over.push(`${lang} right: ${cell.text}`);
          if (cellLeft(cell, spacing) < X - 0.5) over.push(`${lang} left: ${cell.text}`);
          if (cell.y + cell.px / 2 > FLOOR + 0.5) over.push(`${lang} below: ${cell.text}`);
        }
      }
    } finally {
      setLang("en");
    }
    expect(over.slice(0, 5)).toEqual([]);
  });

  it("never truncates: a row with no room drops its alternatives to a line of their own", () => {
    // The report's other half — "…" in the middle of the alternatives.
    const wide = "属性 ＋ 法术 ＋ 词条 ＋ 金币";
    const rows: TableRow[] = [{
      key: "传送门奖励", answer: `${wide} 19%`,
      others: `${wide} 35%、${wide} 27%`, source: "规则",
    }];
    const laid = layoutDecisionTable(rows, style(true, 1));
    for (const cell of laid.cells) {
      expect(cell.text).not.toContain("…");
      expect(cellRight(cell, 1)).toBeLessThanOrEqual(RIGHT + 0.5);
    }
    // The alternatives are on their own line, under the answer.
    const answer = laid.cells.find((c) => c.text.endsWith("19%"))!;
    const others = laid.cells.find((c) => c.text.includes("35%"))!;
    expect(others.y).toBeGreaterThan(answer.y);
    expect(others.x).toBe(answer.x);
  });

  it("aligns the questions, the answers and the sources into columns", () => {
    setLang("en");
    const laid = layoutDecisionTable(longestRows(), style(false, 0));
    const keys = laid.cells.filter((c) => c.origin === 0 && c.color === "#8792b5");
    const sources = laid.cells.filter((c) => c.origin === 1);
    expect(new Set(keys.map((c) => c.x)).size).toBe(1);
    expect(new Set(sources.map((c) => c.x)).size).toBe(1);
    expect(sources[0]!.x).toBe(RIGHT);
  });

  it("puts air above a section heading and a little under it", () => {
    setLang("en");
    const rows: TableRow[] = [
      { key: "a", answer: "x 1%", source: "rule" },
      { head: "room" },
      { key: "b", answer: "y 2%", source: "rule" },
    ];
    const laid = layoutDecisionTable(rows, style(false, 0));
    const pitch = rowPitch(PX, false);
    const first = laid.cells.find((c) => c.text === "a")!;
    const head = laid.cells.find((c) => c.text === "room")!;
    const next = laid.cells.find((c) => c.text === "b")!;
    expect(head.y - first.y).toBeGreaterThan(pitch);
    expect(next.y - head.y).toBeGreaterThan(pitch);
  });

  it("stops at a whole row and says how many are left", () => {
    setLang("en");
    const rows = longestRows();
    const laid = layoutDecisionTable(rows, { ...style(false, 0), floor: TOP + rowPitch(PX, false) * 3 });
    expect(laid.shown).toBeGreaterThan(0);
    expect(laid.shown).toBeLessThan(rows.length);
    for (const cell of laid.cells) expect(cell.y + cell.px / 2).toBeLessThanOrEqual(TOP + rowPitch(PX, false) * 3 + 0.5);
  });

  it("scrolls when the table is taller than the column", () => {
    /*
     * The report this answers: the page stopped scrolling, so the decisions
     * past the first screenful could not be read at all. A table that does
     * not fit has somewhere to scroll to, and the last step shows the last
     * row.
     */
    setLang("en");
    const rows = longestRows();
    const short = { ...style(false, 0), floor: TOP + rowPitch(PX, false) * 6 };
    const first = layoutDecisionTable(rows, short);
    expect(first.shown).toBeLessThan(rows.length);
    const max = maxScrollFor(rows, short);
    expect(max).toBeGreaterThan(0);
    // From the last step, everything left is on screen.
    const last = layoutDecisionTable(rows.slice(max), short, false);
    expect(last.shown).toBe(rows.length - max);
    // And every step in between shows something.
    for (const from of [1, Math.floor(max / 2), max])
      expect(layoutDecisionTable(rows.slice(from), short).shown).toBeGreaterThan(0);
  });

  it("does not scroll a table that already fits", () => {
    setLang("en");
    const rows: TableRow[] = [{ key: "a", answer: "x 1%", source: "rule" }];
    expect(maxScrollFor(rows, style(false, 0))).toBe(0);
  });

  it("wraps a long question inside its own column, never across the answer", () => {
    /*
     * The report: a question printed across "peak 24%". The key column is
     * capped at two fifths of the table and the key was drawn at full length
     * regardless, so a name longer than the cap ran into the answer beside
     * it. It wraps the way the answer does, and the row grows to hold it.
     */
    setLang("en");
    const st = style(false, 0);
    const long = "a question with a name far longer than two fifths of this table can hold";
    const rows: TableRow[] = [{ key: long, answer: "peak 24%", source: "rule" }];
    const laid = layoutDecisionTable(rows, st);
    const keyCells = laid.cells.filter((c) => c.x === st.x && c.origin === 0);
    expect(keyCells.length).toBeGreaterThan(1);
    const answerCell = laid.cells.find((c) => c.text === "peak 24%");
    expect(answerCell).toBeTruthy();
    for (const c of keyCells)
      expect(cellRight(c, st.spacing), c.text).toBeLessThanOrEqual(answerCell!.x);
    // And the row is as tall as the question needed, so nothing lands on it.
    expect(laid.endY - TOP).toBeGreaterThanOrEqual(rowPitch(PX, false) * keyCells.length);
  });

  it("measures a han character as twice a Latin one", () => {
    // The assumption every one of these rules rests on.
    expect(measureText("場", 12, 0)).toBe(measureText("aa", 12, 0));
  });
});
