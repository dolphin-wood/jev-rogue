/**
 * **Which of the key guide's rows a player has seen**, so a hint added after
 * their first run still reaches them.
 *
 * Every row of the guide, and the assist page after it, carries an id. The
 * ids a player has been shown are saved; a run opens with the rows whose id
 * is not among them, and only those. A first-time player has seen none and
 * gets the whole guide; a returning one gets the rows added since, or nothing.
 *
 * Before this the guide was one flag, `jr.seenControls`. A player who has
 * the flag and no list saw the guide as it stood then: `LEGACY_HINTS`, which
 * stays the list it was so that every id added later reads as new to them.
 */

/** The ids of the guide as it was when one flag stood for all of it. Never edited: add new ids to the guide only. */
export const LEGACY_HINTS: readonly string[] = [
  "walk", "dodge", "sword", "spin", "castAuto", "cast", "use", "character", "menu", "assists",
];

/**
 * The ids a player has seen, from the saved list and the old flag. A list
 * that does not parse counts as none, so a broken save shows the guide again
 * rather than never.
 */
export function seenHintsOf(saved: string | null, legacyFlag: string | null): Set<string> {
  const seen = new Set<string>();
  if (saved !== null) {
    try {
      const list: unknown = JSON.parse(saved);
      if (Array.isArray(list)) for (const id of list) if (typeof id === "string") seen.add(id);
    } catch { /* none */ }
  }
  if (legacyFlag === "1") for (const id of LEGACY_HINTS) seen.add(id);
  return seen;
}

/** The saved form of what has been seen, with `shown` added. */
export function withShown(seen: ReadonlySet<string>, shown: Iterable<string>): string {
  return JSON.stringify([...new Set([...seen, ...shown])].sort());
}
