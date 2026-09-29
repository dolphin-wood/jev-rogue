/**
 * **Which of the key guide's rows a player has seen**, so a hint added after
 * their first run still reaches them.
 *
 * Every row of the guide, and the assist page after it, carries an id. The
 * ids a player has been shown are saved; a run opens with the rows whose id
 * is not among them, and only those. A first-time player has seen none and
 * gets the whole guide; a returning one gets the rows added since, or nothing.
 *
 * Only what this record holds counts as seen. The one flag the guide was
 * before (`jr.seenControls`) said a guide had been seen, not which rows it
 * had then, so a player who has only the flag is shown the whole guide once.
 */

/** The ids a player has seen. A list that does not parse counts as none, so a broken save shows the guide again rather than never. */
export function seenHintsOf(saved: string | null): Set<string> {
  const seen = new Set<string>();
  if (saved === null) return seen;
  try {
    const list: unknown = JSON.parse(saved);
    if (Array.isArray(list)) for (const id of list) if (typeof id === "string") seen.add(id);
  } catch { /* none */ }
  return seen;
}

/** The saved form of what has been seen, with `shown` added. */
export function withShown(seen: ReadonlySet<string>, shown: Iterable<string>): string {
  return JSON.stringify([...new Set([...seen, ...shown])].sort());
}
