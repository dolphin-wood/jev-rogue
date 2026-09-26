import type { CardCandidate, CardPool } from "@jr/core";

/** Refreshes double in price across the whole run. */
export function rerollPrice(rollsThisRun: number): number {
  return 16 * 2 ** Math.max(0, rollsThisRun);
}

/** Keep a reroll visibly fresh without breaking a door promise or a card guarantee. */
export function freshRerollPool(
  pool: CardPool, shown: readonly string[], count: number,
): CardPool | null {
  if (count < 1) return null;
  const seen = new Set(shown);
  const fresh = pool.candidates.filter((candidate) => !seen.has(candidate.id));
  if (fresh.length === 0) return null;
  const promised = pool.candidates.some((candidate) => candidate.facts.includes("promised"));
  // A one-card merchant shelf cannot contain both upgrade and replacement.
  const guarantees = (pool.guarantee?.length ?? 0) <= count ? pool.guarantee ?? [] : [];
  const valid = (cards: readonly CardCandidate[]): boolean =>
    cards.some((candidate) => !seen.has(candidate.id))
    && (!promised || cards.some((candidate) => candidate.facts.includes("promised")))
    && guarantees.every((group) => cards.some((candidate) => group.includes(candidate.id)));
  const subset = (candidates: readonly CardCandidate[]): CardCandidate[] | null => {
    const picked: CardCandidate[] = [];
    const visit = (start: number): CardCandidate[] | null => {
      if (picked.length === count) return valid(picked) ? [...picked] : null;
      for (let i = start; i <= candidates.length - (count - picked.length); i++) {
        picked.push(candidates[i]!);
        const result = visit(i + 1);
        if (result) return result;
        picked.pop();
      }
      return null;
    };
    return candidates.length >= count ? visit(0) : null;
  };
  // Keep the whole unseen pool when it can make a legal offer, leaving the
  // Director real choices. Only bring old cards back once it cannot.
  const freshChoice = subset(fresh);
  const candidates = freshChoice ? fresh : subset([...fresh, ...pool.candidates.filter((c) => seen.has(c.id))]);
  if (!candidates) return null;
  const guarantee = guarantees.map((group) => group.filter((id) => candidates.some((c) => c.id === id)));
  return { ...pool, candidates, guarantee: guarantee.length > 0 ? guarantee : undefined };
}
