/**
 * **The Director's question names, in the player's language.**
 *
 * Lifted out of `play.ts` so a test can call exactly what the plan page calls.
 * The failure these guard against is not a crash: it is the page printing its
 * own lookup key — `term.qs.next_tension (advisory)` — in the middle of a
 * Chinese row, which looks fine to anyone reading the English and is caught by
 * nothing else (`i18n.test.ts`, "every key the Director emits").
 */
import { t, term } from "../i18n/index.ts";
import type { StringKey } from "../i18n/index.ts";

/**
 * A question's name, in words.
 *
 * The Director's question names are ids like every other word on the plan
 * page, with two twists: a zone's question is named after the slot it fills
 * (`zone_edge_n`), and a vendor's shelf prefixes every question it carries
 * (`shop_stat__overall`). Both are stripped down to the question underneath,
 * so one key serves every zone and every shelf, and the slot is said beside
 * it rather than baked into a key per slot.
 */
export function questionBase(name: string): string {
  const at = name.indexOf("__");
  const bare = at < 0 ? name : name.slice(at + 2);
  if (bare.startsWith("zone_")) return "zone";
  if (bare.startsWith("blended offer")) return "blendedOffer";
  /*
   * **A parenthetical is a note on the answer, not part of the question.**
   *
   * The Director names three answers this way — `next_tension (advisory)`,
   * `elite_affixes (code draw)`, `elite_kind (from the need ranking)` — and
   * only the last of them ever had a key, spelt out in full with the brackets
   * in it. So the plan page printed the raw `term.qs.next_tension (advisory)`
   * across the answer column, which is a key on screen and a row overlapping
   * its neighbour. The bracket is stripped here whatever is in it, and said
   * beside the question by `questionNote`.
   */
  return bare.replace(/\s*\([^)]*\)\s*$/, "");
}

/** The parenthetical on a question's name, as an id, or `""`. */
export function questionNote(name: string): string {
  const found = /\(([^)]*)\)\s*$/.exec(name);
  return found ? found[1]!.trim().toLowerCase().replace(/\s+/g, "_") : "";
}

/**
 * A `term.*` lookup that can never print its own key.
 *
 * `t()` returns the key it was given when no table has it, which is right for
 * a string the code controls and wrong for one built from a Director id: the
 * Director can name a question the tables have not caught up with, and the
 * page has to say *something* a player can read. `term()` already falls back
 * to the id in words, so a miss here reads as "next tension" rather than as
 * `term.qs.next_tension`.
 */
export function saidKey(prefix: string, id: string, fallback: string): string {
  const key = `${prefix}${id}`;
  const said = t(key as StringKey);
  return said === key ? fallback : said;
}

export function questionName(name: string): string {
  const base = questionBase(name);
  const label = saidKey("term.qs.", base, term(base));
  const note = questionNote(name);
  const said = note ? `${label} (${term(note, "qnote")})` : label;
  const bare = name.indexOf("__") < 0 ? name : name.slice(name.indexOf("__") + 2);
  if (bare.startsWith("zone_")) return `${said} · ${term(bare.slice(5))}`;
  if (bare.startsWith("blended offer")) return `${said} · ${term(bare.slice("blended offer: ".length), "reward_kind")}`;
  return said;
}

/**
 * What a question actually asked, as a sentence.
 *
 * The page used to print the instructions verbatim — the English prose the
 * request carries, which is written for Jev and stays English on the wire.
 * This is the same question in the player's language; the request is
 * untouched.
 */
export function questionAsked(name: string): string {
  const base = questionBase(name);
  const bare = name.indexOf("__") < 0 ? name : name.slice(name.indexOf("__") + 2);
  if (bare.startsWith("blended offer"))
    return t("term.q.blendedOffer", { label: term(bare.slice("blended offer: ".length), "reward_kind") });
  // A question the table has not caught up with says nothing rather than
  // printing its own key: the line is an aside, and an aside can be missing.
  return saidKey("term.q.", base, "");
}

