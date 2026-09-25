/**
 * The regression this file exists for: a screen drawn from a literal.
 *
 * Every other test here checks that a key is translated. None of them can see
 * the failure that actually keeps happening — a new label written straight
 * into the call that draws it, which is perfect English and invisible in
 * every other language until somebody plays in it.
 *
 * So this reads the source. It finds the calls that put words on the screen
 * and insists the words came from `t`, `term`, `contentName` or one of the
 * other lookups, rather than from quotes at the call site. It is a lint rule
 * rather than a proof: it knows the call shapes the UI actually uses, and a
 * new drawing helper would have to be added to `DRAWS`.
 *
 * `debug-panel.ts` is not scanned. It is a developer's readout, it prints
 * core's own words on purpose, and translating it would make it useless for
 * the thing it is for.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const FILES = [
  "../scenes/play.ts",
  "../director-readout.ts",
].map((rel) => resolve(here, rel));

/** The calls that put a string on the screen, and where its text sits. */
const DRAWS: readonly RegExp[] = [
  // `prompt.setText("…")`, `label.setText("…")`
  /\.setText\(\s*"([^"]*)"/g,
  // `this.add.text(x, y, "…")` and the scene's own wrappers, which all take
  // the text after two coordinates.
  /(?:add\.text|menuText|uiText|keys_|fittedKeys)\(\s*[^,]+,\s*[^,]+,\s*"([^"]*)"/g,
  // `this.ftext("key", x, y, "…")` — one id, then the coordinates.
  /ftext\(\s*"[^"]*",\s*[^,]+,\s*[^,]+,\s*"([^"]*)"/g,
];

/**
 * What is allowed to be a literal: markup, punctuation, arrows and the pixel
 * glyphs the scroll indicators draw. Anything with two letters next to a
 * space is prose and belongs in a table.
 */
function isProse(text: string): boolean {
  if (!/[A-Za-z]{2}/.test(text)) return false;
  // A lone keycap or atlas id is not prose: `[E]`, `pet_s_idle0`.
  if (/^\[?\w+\]?$/.test(text)) return false;
  return /[A-Za-z]\s+[A-Za-z]/.test(text) || /[A-Za-z]{4}/.test(text);
}

describe("no words written at the call site", () => {
  for (const file of FILES) {
    it(`draws nothing from a literal in ${file.split("/").pop()}`, () => {
      const source = readFileSync(file, "utf8");
      const found: string[] = [];
      for (const pattern of DRAWS)
        for (const m of source.matchAll(pattern)) {
          const text = m[1] ?? "";
          if (isProse(text)) found.push(text);
        }
      expect(found, "these belong in en.ts / zh.ts / ja.ts").toEqual([]);
    });
  }

  it("never puts the Director's English prompt on the plan page", () => {
    /*
     * The instructions a request carries are written for Jev and stay English
     * on the wire; the page says the same question from `term.q.*`. Drawing
     * `instructions` again is how half the page ended up English.
     */
    const source = readFileSync(resolve(here, "../scenes/play.ts"), "utf8");
    expect(source).not.toMatch(/text:\s*q\.instructions/);
  });
});
