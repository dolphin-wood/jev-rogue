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
}

export interface ReadoutRequest {
  readonly title: string;
  readonly source: string;
  readonly fallback?: string;
  /** The state sent, flattened to one line per field. */
  readonly state: readonly (readonly [string, string])[];
  readonly questions: readonly ReadoutQuestion[];
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

export function buildReadout(
  log: readonly ObservedRequest[], plans: ReadonlyMap<string, PlanRecord>,
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
        // What the answer was drawn from: the source's distribution after the
        // question's temperature, or before it for one that was not drawn.
        probs: sorted(Object.keys(own).length > 0 ? own : dist),
        source: d?.source ?? req.source,
        ...(restricted ? { note: "renormalised over what was on offer" }
          : !d && BLENDED.has(unscoped(name)) ? { note: "blended, not drawn on its own" }
          : !d ? { note: "not needed this time" } : {}),
      };
    });
    // Answers code drew itself, recorded with the plan (an elite affix set).
    // A room's two rounds share one plan, so they go under round 2, which is
    // when they were drawn.
    const all = new Set(log.filter((r) => r.meta.purpose === purpose).flatMap((r) => Object.keys(r.questions)));
    if (purpose !== "room" || req.meta.round === 2)
      for (const d of plan?.decisions ?? []) {
        const name = d.question ?? "";
        if (!name || all.has(name)) continue;
        questions.push({ name, choice: d.choice, probs: sorted(d.probabilities), source: d.source, note: "drawn by code" });
      }
    for (const o of plan?.offers ?? [])
      if (req.questions[`${o.prefix}overall`] && Object.keys(o.blended).length > 0)
        questions.push({
          name: `blended offer: ${o.label}`, choice: o.ids.join(", ") || null, probs: sorted(o.blended),
          source: "code", note: "overall + style + needs, at the variety's temperature; two sampled, one wildcard",
        });
    return {
      title: titleOf(purpose, req.meta.round),
      source: req.source,
      ...(req.fallback_path ? { fallback: req.fallback_path } : {}),
      state: flatten(req.state),
      questions,
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

const CATEGORY_OF: Readonly<Record<string, Category>> = {
  next_tension: "pacing", door_set: "pacing",
  space: "room", symmetry: "room",
  mood_temperature: "mood", mood_brightness: "mood", mood_particles: "mood",
  composition: "enemies", density: "enemies", wave_structure: "enemies", anchor: "enemies", entry: "enemies",
  "elite_affixes (code draw)": "enemies", elite_kind_code: "enemies",
  portal_kinds: "portals", spell_school: "portals", stat_family: "portals", elite_portal: "portals",
  elite_kind: "portals", elite_grade: "portals", normal_grade: "portals", npc_room: "portals",
  overall: "cards", for_style: "cards", for_needs: "cards", variety: "cards", temptation: "cards", pity: "cards",
};

export function categoryOf(name: string): Category {
  if (name.startsWith("zone_")) return "layout";
  if (name.startsWith("blended offer")) return "cards";
  return CATEGORY_OF[unscoped(name)] ?? "other";
}

/** One question with the request it came in. */
export interface GroupedQuestion extends ReadoutQuestion {
  readonly request: string;
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
  if (purpose === "room") return round === 1 ? "room, round 1: space, symmetry, mood, portals, cards" : "room, round 2: zones and encounter";
  if (purpose === "offer") return "this room's offer: portals and the merchant's shelf";
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
