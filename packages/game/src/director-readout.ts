/**
 * Every Director parameter for one room, as a readout: each request it was
 * sent, the **state** that request carried, and every question in it with
 * **all** its options' probabilities, the answer drawn, and which arm gave the
 * distribution.
 *
 * Built from what the Director reported through `observe` — the requests as
 * they were actually answered — joined to the decisions the plans returned,
 * so the readout cannot describe a request that was not made. Shared by the
 * debug sidebar and the room plan page, which show the same thing at two
 * sizes.
 */
import type { Decision, ObservedRequest } from "@jr/director";

export interface ReadoutQuestion {
  readonly name: string;
  /** The answer drawn, or null for a distribution that was blended rather than sampled. */
  readonly choice: string | null;
  /** Every option, most likely first. */
  readonly probs: readonly (readonly [string, number])[];
  readonly source: string;
  /** How the answer was reached when it was not a plain draw from `probs`. */
  readonly note?: string;
  /**
   * The same thing as an id, for the room plan page, which says it in the
   * player's language. `note` stays English for the debug sidebar, which is
   * internal and reads in core's own words.
   */
  readonly noteKey?: NoteKey;
  /** What the request actually asked, as it was sent. */
  readonly instructions?: string;
}

/** Why an answer was not a plain draw from the distribution it was shown. */
export type NoteKey = "renormalised" | "blended" | "notNeeded" | "drawnByCode" | "offerBlend";

export interface ReadoutRequest {
  readonly title: string;
  readonly source: string;
  readonly fallback?: string;
  /** The state sent, flattened to one line per field. */
  readonly state: readonly (readonly [string, string])[];
  readonly questions: readonly ReadoutQuestion[];
  /** What the room asks for, spelled out: which round and what it decides. */
  readonly round: number;
  readonly purpose: string;
  readonly subjects: string;
  /**
   * What the call cost, when one was made.
   *
   * Not from the Director — it has no reason to know either — but recorded by
   * the evaluator wrapper in `play.ts`, which is the only place that sees a
   * request begin and end and reads the reply's own usage.
   */
  readonly ms?: number;
  readonly tokens?: number | null;
  /** The status a failed call came back with: `401`, `timeout`, `500`. */
  readonly error?: string;
  /**
   * How many times the evaluator had to ask again before this answer arrived,
   * after an overloaded upstream. Shown because a room that planned normally
   * on the third attempt and one that planned on the first are the same room
   * in every other number here, and only one of them is a warning.
   */
  readonly retries?: number;
  /** Round 2 is asked **of** round 1's room; this is what it was shown. */
  readonly askedOf?: string;
  /** The raw request and reply, for the debug sidebar to print. */
  readonly raw: {
    readonly state: Readonly<Record<string, unknown>>;
    readonly questions: Readonly<Record<string, unknown>>;
    readonly answers: Readonly<Record<string, unknown>>;
  };
}

/**
 * The request that opens a room's doors, once its reward is taken: which
 * kinds of door, and the cards behind every kind a door could be (`openDoors`).
 */
export const DOORS_OUT = "doors_out";
/** The same request, carried into the room its door led to: that room's cards were chosen in it. */
export const DOOR_IN = "door_in";

/** How a request is identified across the log and the stats recorded beside it. */
export function requestKey(purpose: string, round: number): string {
  return `${purpose}:${round}`;
}

/** What each request decides, in the player's words, for its header. */
function subjectsOf(purpose: string, round: number): string {
  if (purpose === "room") return round === 1 ? "room, portals, cards" : "zones, encounter, door promises";
  if (purpose === "staff") return "the starting staff";
  if (purpose === "doors") return "the next room's tension";
  if (purpose === "offer") return "the merchant's shelf";
  if (purpose.startsWith("reroll_reward_")) return "the refreshed reward cards";
  if (purpose.startsWith("reroll_shop_")) return "the refreshed merchant shelf";
  if (purpose === DOORS_OUT) return "the doors out, and the cards behind each kind";
  if (purpose === DOOR_IN) return "this room's cards, with the door that brought them";
  if (purpose === "portals") return "the portals out";
  if (purpose.startsWith("cards:")) {
    const [, kind, shelf] = purpose.split(":");
    return shelf ? `the merchant's ${kind} shelf` : `this room's ${kind} cards`;
  }
  return purpose;
}

/**
 * What the plans returned for one request purpose, to join to its request.
 * One request can carry several plans' questions (a room's round 1 carries
 * its portals and cards), so a record holds every decision drawn from it and
 * one entry per card offer in it.
 */
export interface PlanRecord {
  readonly decisions: readonly Decision[];
  readonly offers?: readonly OfferRecord[];
}

/** A card offer's blended distribution and the cards it produced. */
export interface OfferRecord {
  /** What its questions are prefixed with in the request (a shelf's `shop_stat__`), or "". */
  readonly prefix: string;
  readonly label: string;
  readonly blended: Readonly<Record<string, number>>;
  readonly ids: readonly string[];
}

/** Questions whose answer is blended with others rather than drawn on its own (doc 007). */
const BLENDED = new Set(["overall", "for_style", "for_needs"]);

/** What one request cost, as `play.ts` recorded it. */
export interface RequestStat {
  readonly ms: number;
  readonly tokens: number | null;
  readonly error?: string;
  /** Attempts beyond the first, after an overloaded upstream (`createEvaluator`). */
  readonly retries?: number;
}

export function buildReadout(
  log: readonly ObservedRequest[], plans: ReadonlyMap<string, PlanRecord>,
  stats: ReadonlyMap<string, RequestStat> = new Map(),
  askedOf = "",
): ReadoutRequest[] {
  return log.map((req) => {
    const purpose = req.meta.purpose;
    const plan = plans.get(purpose);
    const decided = new Map((plan?.decisions ?? []).map((d) => [d.question ?? "", d]));
    const questions: ReadoutQuestion[] = Object.keys(req.questions).map((name) => {
      const dist = req.dists[name] ?? {};
      const d = decided.get(name);
      const own = d?.probabilities ?? {};
      const restricted = Object.keys(own).length > 0 && Object.keys(own).length !== Object.keys(dist).length;
      return {
        name,
        choice: d ? d.choice : null,
        ...(req.questions[name]?.instructions ? { instructions: req.questions[name]!.instructions } : {}),
        // What the answer was drawn from: the source's distribution after the
        // question's temperature, or before it for one that was not drawn.
        probs: sorted(Object.keys(own).length > 0 ? own : dist),
        source: d?.source ?? req.source,
        ...(restricted ? { note: "renormalised over what was on offer", noteKey: "renormalised" as const }
          : !d && BLENDED.has(unscoped(name)) ? { note: "blended, not drawn on its own", noteKey: "blended" as const }
          : !d ? { note: "not needed this time", noteKey: "notNeeded" as const } : {}),
      };
    });
    // Answers code drew itself, recorded with the plan (an elite affix set).
    // A request's rounds share one plan, so they go under its last round,
    // which is when they were drawn.
    const rounds = log.filter((r) => r.meta.purpose === purpose);
    const all = new Set(rounds.flatMap((r) => Object.keys(r.questions)));
    if (req.meta.round === Math.max(...rounds.map((r) => r.meta.round)))
      for (const d of plan?.decisions ?? []) {
        const name = d.question ?? "";
        if (!name || all.has(name)) continue;
        questions.push({
          name, choice: d.choice, probs: sorted(d.probabilities), source: d.source,
          note: "drawn by code", noteKey: "drawnByCode",
        });
      }
    for (const o of plan?.offers ?? [])
      if (req.questions[`${o.prefix}overall`] && Object.keys(o.blended).length > 0)
        questions.push({
          name: `blended offer: ${o.label}`, choice: o.ids.join(", ") || null, probs: sorted(o.blended),
          source: "code", note: "overall + style + needs, at the variety's temperature; two sampled, one wildcard",
          noteKey: "offerBlend",
        });
    const stat = stats.get(requestKey(purpose, req.meta.round));
    return {
      title: titleOf(purpose, req.meta.round),
      source: req.source,
      ...(req.fallback_path ? { fallback: req.fallback_path } : {}),
      state: flatten(req.state),
      questions,
      round: req.meta.round,
      purpose,
      subjects: subjectsOf(purpose, req.meta.round),
      ...(stat ? {
        ms: stat.ms, tokens: stat.tokens,
        ...(stat.error ? { error: stat.error } : {}),
        ...(stat.retries ? { retries: stat.retries } : {}),
      } : {}),
      // Round 2 of a room is asked **of** the room round 1 produced, which is
      // the whole reason it is a second request rather than more questions in
      // the first: its options depend on a room that did not exist yet.
      ...(purpose === "room" && req.meta.round === 2 && askedOf ? { askedOf } : {}),
      raw: { state: req.state, questions: req.questions, answers: req.dists },
    };
  });
}

/**
 * What part of the game a question decides, for reading a room's decisions
 * by subject rather than by the request that happened to carry them — one
 * request can hold a room's space, its mood, its portals and its cards.
 */
export const CATEGORIES = ["pacing", "room", "mood", "layout", "enemies", "portals", "cards", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Every question the Director can ask, and which part of the game it decides.
 *
 * Exported because it is also the list of questions the room plan page has to
 * have words for: a question added here and not translated is caught by
 * `i18n.test.ts` rather than by a player reading an id.
 *
 * **Keyed by the bare question**, with no parenthetical. The Director names
 * three of its answers `question (how it was reached)` and two of them were
 * listed here with the bracket in the key — so `next_tension (advisory)`,
 * which was not, matched nothing and fell into `other`. That is what put the
 * run's pitch under "other" on the plan page with its own key printed as its
 * name.
 */
export const CATEGORY_OF: Readonly<Record<string, Category>> = {
  next_tension: "pacing", door_set: "pacing",
  space: "room", symmetry: "room", size: "room",
  mood_temperature: "mood", mood_brightness: "mood", mood_particles: "mood",
  composition: "enemies", density: "enemies", wave_structure: "enemies", anchor: "enemies", entry: "enemies",
  subspecies: "enemies", subspecies_weight: "enemies", elite_presence: "enemies",
  elite_affixes: "enemies", elite_kind_code: "enemies",
  portal_need: "portals", spell_school: "portals", stat_family: "portals", elite_portal: "portals",
  elite_kind: "portals", elite_grade: "portals", normal_grade: "portals",
  overall: "cards", for_style: "cards", for_needs: "cards", variety: "cards", temptation: "cards", pity: "cards",
  affix_intent: "cards",
};

export function categoryOf(name: string): Category {
  if (name.startsWith("zone_")) return "layout";
  if (name.startsWith("blended offer")) return "cards";
  return CATEGORY_OF[bare(unscoped(name))] ?? "other";
}

/** A question name without the parenthetical that says how it was reached. */
function bare(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "");
}

/** One question with the request it came in. */
export interface GroupedQuestion extends ReadoutQuestion {
  readonly request: string;
}

/**
 * Every question of one request, gathered by category in `CATEGORIES` order.
 *
 * The page groups by **request first** — that is the structure the player is
 * being shown, because a room takes two and the second is asked of what the
 * first produced — and by subject inside it, which is how the questions read.
 */
export function groupRequest(req: ReadoutRequest): { category: Category; questions: ReadoutQuestion[] }[] {
  const by = new Map<Category, ReadoutQuestion[]>();
  for (const q of req.questions) {
    const c = categoryOf(q.name);
    by.set(c, [...(by.get(c) ?? []), q]);
  }
  return CATEGORIES.flatMap((category) => (by.has(category) ? [{ category, questions: by.get(category)! }] : []));
}

/** Every question of a room's requests, gathered by category in `CATEGORIES` order; empty ones left out. */
export function groupByCategory(reqs: readonly ReadoutRequest[]): { category: Category; questions: GroupedQuestion[] }[] {
  const by = new Map<Category, GroupedQuestion[]>();
  for (const r of reqs)
    for (const q of r.questions) {
      const c = categoryOf(q.name);
      by.set(c, [...(by.get(c) ?? []), { ...q, request: r.title }]);
    }
  return CATEGORIES.flatMap((category) => (by.has(category) ? [{ category, questions: by.get(category)! }] : []));
}

function titleOf(purpose: string, round: number): string {
  if (purpose === "staff") return "run start: the starting staff";
  if (purpose === "doors") return "leaving the last room: next tension";
  if (purpose === "room") return round === 1 ? "room, round 1: space, symmetry, mood, portals, cards" : "room, round 2: zones, encounter, door promises";
  if (purpose === "offer") return "this room's offer: the merchant's shelf";
  if (purpose.startsWith("reroll_reward_")) return "paid refresh: this room's reward cards";
  if (purpose.startsWith("reroll_shop_")) return "paid refresh: the merchant's shelf";
  if (purpose === DOORS_OUT) return "reward taken: the doors out, and the cards behind each kind";
  if (purpose === DOOR_IN) return "the door taken in: this room's cards, asked in the room before";
  if (purpose === "portals") return "the portals out of this room";
  if (purpose.startsWith("cards:")) {
    const [, kind, shelf] = purpose.split(":");
    return shelf ? `merchant's shelf: ${kind}` : `this room's ${kind} cards`;
  }
  return purpose;
}

/** A question's name without a shelf's prefix (`shop_stat__overall` → `overall`). */
function unscoped(name: string): string {
  const at = name.indexOf("__");
  return at < 0 ? name : name.slice(at + 2);
}

function sorted(d: Readonly<Record<string, number>>): [string, number][] {
  return Object.entries(d).sort((a, b) => b[1] - a[1]);
}

/** Nested state as `path: value` lines; arrays joined, empties marked. */
function flatten(state: Readonly<Record<string, unknown>>, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(state)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) out.push([key, v.length ? v.map(String).join(", ") : "(none)"]);
    else if (v && typeof v === "object") out.push(...flatten(v as Record<string, unknown>, key));
    else out.push([key, v === undefined || v === null || v === "" ? "(none)" : String(v)]);
  }
  return out;
}
