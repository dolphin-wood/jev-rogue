/**
 * **What this request is actually asking**, in the player's terms.
 *
 * The briefing used to end with one line — "Deciding: the reward each of the 3
 * doors out of this room promises" — written by hand at the call site. It was
 * wrong in the way a hand-written summary of generated content always ends up
 * wrong: a room's round 1 asks up to seventeen questions at once (the pitch,
 * the space, the size, the symmetry, three moods, and the whole offer riding
 * along), and the line named one of them. A Director told it is deciding one
 * thing and then handed seventeen has been lied to about the shape of its own
 * job.
 *
 * So the line is generated from the question names the request is carrying.
 * It cannot drift, it is plural when the request is plural, and questions that
 * are one decision split across several names — the three moods, the five
 * encounter knobs, the four card axes — are named once between them.
 */

/** One phrase per group, in the order the groups are listed here. */
const GROUPS: readonly { readonly phrase: string; readonly matches: (name: string) => boolean }[] = [
  { phrase: "how hard this room is pitched", matches: (n) => n === "next_tension" },
  { phrase: "what kind of space this room is, and how large", matches: (n) => n === "space" || n === "size" },
  { phrase: "whether this room's layout is mirrored or asymmetric", matches: (n) => n === "symmetry" },
  { phrase: "how this room looks: its colour, its brightness and its particles", matches: (n) => n.startsWith("mood_") },
  { phrase: "what fills each of this room's zone slots", matches: (n) => n.startsWith("zone_") },
  {
    phrase: "how this room's fight is built: the mix of bodies, how many, where they arrive from, "
      + "whether there is a priority target, and how soon the next group comes",
    matches: (n) => ["composition", "density", "entry", "anchor", "wave_structure"].includes(n),
  },
  {
    phrase: "which variant bodies this room shows and how much of it is made of them",
    matches: (n) => n === "subspecies" || n === "subspecies_weight",
  },
  { phrase: "how many enraged bodies this room hides", matches: (n) => n === "elite_presence" },
  { phrase: "which reward each door out of this room promises, in rank order", matches: (n) => n === "portal_need" },
  { phrase: "which kind of reward this room, the run's first, pays", matches: (n) => n === "opening_reward" },
  {
    phrase: "whether one of those doors leads to an elite fight, and how far its reward is graded up",
    matches: (n) => ["elite_portal", "elite_grade", "normal_grade"].includes(n),
  },
  {
    phrase: "which cards this room's reward screen shows, and how widely the offer spreads",
    matches: (n) => ["overall", "for_style", "for_needs", "variety", "temptation"].includes(n) || n.startsWith("fit_"),
  },
  { phrase: "which way this player's spells are modified", matches: (n) => n === "affix_intent" },
];

export function decidingPhrases(names: readonly string[]): string[] {
  // A vendor's shelves scope their questions by a prefix; they are the same
  // question asked about three shelves, and they get one phrase between them.
  const bare = names.map((n) => (n.includes("__") ? n.slice(n.indexOf("__") + 2) : n));
  const out: string[] = [];
  for (const group of GROUPS)
    if (bare.some((n) => group.matches(n))) out.push(group.phrase);
  const named = new Set(GROUPS.flatMap((g) => bare.filter((n) => g.matches(n))));
  for (const n of bare) if (!named.has(n) && !out.includes(n)) out.push(n.replace(/_/g, " "));
  return out;
}
