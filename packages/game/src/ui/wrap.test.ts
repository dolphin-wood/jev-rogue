/**
 * The room plan's Director Questions page, wrapped to its column.
 *
 * This is the page that overflowed: its rows are coloured pieces — the
 * question, who answered, the answer, then every option with its probability
 * — and they were wrapped by counting characters. A han character is a full
 * em against Latin's half, so a Chinese row came out about twice its budget
 * and ran past the column and under the scroll bar, and a piece longer than
 * the whole column was never broken at all.
 *
 * So the rows are built here out of the **longest labels the tables actually
 * hold**, in every language, and measured. A label that grows past the column
 * fails here rather than on somebody's screen.
 */
import { describe, expect, it } from "vitest";
import {
  ELITE_AFFIX_IDS, FEATURES, PLAYABLE_ARCHETYPES, REWARD_KINDS, SPELL_SCHOOLS, STAT_FAMILIES,
} from "@jr/core";
import { CATEGORY_OF } from "../director-readout.ts";
import { LANGS, letterSpacing, measureText, setLang, stringTable, t, term } from "../i18n/index.ts";
import type { Span } from "./wrap.ts";
import { rowWidth, wrapSpans } from "./wrap.ts";

/*
 * The page's own geometry, as `renderPlanLines` lays it out: the column runs
 * from `left` to `left + colW`, and the scroll bar sits at `left + colW + 6`.
 * These are the numbers in `scenes/play.ts`; if they move, this moves.
 */
const UI_W = 740;
const LEFT = 40;
const COL_W = UI_W - LEFT * 2 - 12;
/** The two sizes the page draws at, after the body floor has raised them. */
const ROW_PX = [12, 10.5] as const;
/** The indents the page uses: a request head, a subject, a question, its options. */
const INDENTS = [0, 8, 16, 24, 28] as const;

/** Every question the Director can ask, as the page names it. */
function questionBases(): string[] {
  return [...new Set(
    Object.keys(CATEGORY_OF)
      .map((n) => n.replace(/^zone_.*/, "zone").replace(/ \(code draw\)$/, ""))
      .concat(["zone", "blendedOffer"]),
  )];
}

/**
 * The widest option list the page can draw: every option of the question with
 * the most of them, each with a probability.
 *
 * `space` is that question — twelve archetypes — and the other long ones are
 * here too, because a school or a feature can be the longer word in a
 * language even when there are fewer of them.
 */
function optionSets(): string[][] {
  return [
    PLAYABLE_ARCHETYPES.map((a) => term(a.id, "space")),
    FEATURES.map((f) => term(f.id, "feature")).concat(term("none", "feature")),
    [...SPELL_SCHOOLS].map((s) => term(s, "spell_school")),
    [...STAT_FAMILIES].map((f) => term(f, "stat_family")),
    [...ELITE_AFFIX_IDS].map((a) => term(a)),
    // A portal set is several reward kinds joined, which is the longest single
    // option on the page.
    [[...REWARD_KINDS].join("+"), [...REWARD_KINDS].slice(0, 3).join("+")]
      .map((k) => term(k, "portal_kinds")),
  ];
}

/** One question's row, as `questionLines` builds it. */
function questionRow(base: string, options: readonly string[]): Span[] {
  return [
    { text: t(`term.qs.${base}` as never), color: "#e8e3d8", bold: true },
    { text: ` ${term("jev")}`, color: "#8fdcff" },
    { text: " →", color: "#6a7396" },
    { text: ` ${options[0] ?? ""}`, color: "#ffe9a8", bold: true },
    { text: ` (${t("plan.note.renormalised")})`, color: "#6a7396" },
  ];
}

/** The options row under it: every option, each with its probability. */
function optionsRow(options: readonly string[]): Span[] {
  return options.flatMap((o, i) => [
    ...(i > 0 ? [{ text: " ·", color: "#4f5570" }] : []),
    { text: ` ${o} 8.3%`, color: "#8792b5" },
  ]);
}

describe("the Director Questions page", () => {
  it("keeps every row inside the column, in every language", () => {
    const over: string[] = [];
    try {
      for (const lang of LANGS) {
        setLang(lang);
        const spacing = letterSpacing(lang);
        const lines: { spans: Span[]; indent: number }[] = [];
        for (const base of questionBases())
          for (const options of optionSets()) {
            lines.push({ spans: questionRow(base, options), indent: 16 });
            lines.push({ spans: optionsRow(options), indent: 28 });
          }
        // The request heads and the sentence under each question, too.
        for (const base of questionBases())
          lines.push({
            spans: [{ text: t(`term.q.${base}` as never), color: "#5a5f7a" }],
            indent: 24,
          });
        for (const px of ROW_PX)
          for (const { spans, indent } of lines)
            for (const row of wrapSpans(spans, COL_W, px, spacing, indent)) {
              const w = rowWidth(row, px, spacing);
              if (w > COL_W) over.push(`${lang} @${px} ${Math.round(w)} > ${COL_W}: ${row.spans.map((s) => s.text).join("")}`);
            }
      }
    } finally {
      setLang("en");
    }
    expect(over.slice(0, 5), "rows wider than the column").toEqual([]);
  });

  it("breaks a piece that is wider than the column on its own", () => {
    // The old wrap only ever broke *between* pieces, so one long piece ran
    // off the page however narrow the column was.
    const long = "a".repeat(400);
    const rows = wrapSpans([{ text: long, color: "#fff" }], COL_W, 12, 0, 0);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(rowWidth(row, 12, 0)).toBeLessThanOrEqual(COL_W);
    expect(rows.map((r) => r.spans.map((s) => s.text).join("")).join("")).toBe(long);
  });

  it("breaks Chinese between characters and English between words", () => {
    const zh = "散布竞技场".repeat(40);
    for (const row of wrapSpans([{ text: zh, color: "#fff" }], COL_W, 12, 1, 0))
      expect(rowWidth(row, 12, 1)).toBeLessThanOrEqual(COL_W);
    const en = "scattered arena ".repeat(20).trim();
    for (const row of wrapSpans([{ text: en, color: "#fff" }], COL_W, 12, 0, 0)) {
      expect(rowWidth(row, 12, 0)).toBeLessThanOrEqual(COL_W);
      // No word was cut in half.
      for (const word of row.spans.map((s) => s.text).join("").trim().split(" "))
        expect(["scattered", "arena"]).toContain(word);
    }
  });

  it("indents the rows a line wrapped onto", () => {
    const rows = wrapSpans([{ text: "x".repeat(400), color: "#fff" }], COL_W, 12, 0, 16);
    expect(rows[0]!.indent).toBe(16);
    expect(rows[1]!.indent).toBe(24);
    expect(rows[0]!.first).toBe(true);
    expect(rows[1]!.first).toBe(false);
  });

  it("measures a han character as twice a Latin one", () => {
    // The assumption the page was built on, stated: this is why counting
    // characters could not work.
    expect(measureText("場", 12, 0)).toBe(measureText("aa", 12, 0));
  });

  it("has a short label for every question the page can name", () => {
    for (const lang of LANGS) {
      const table = stringTable(lang) as Record<string, string>;
      for (const base of questionBases()) expect(table[`term.qs.${base}`], `${lang} ${base}`).toBeTruthy();
    }
  });
});
