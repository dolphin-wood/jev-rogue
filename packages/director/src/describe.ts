/**
 * Description generation (design doc 010). Jev sees only words, so the basis
 * for every decision has to be in the option text, phrased in the same closed
 * label vocabulary the state uses. Nothing here is model output: every sentence
 * comes from a template, which is why hover text in the game can reuse it.
 */
import { isKnownLabelRef } from "@jr/core";

export const MAX_STATIC_DESCRIPTION = 220;

export interface Describable {
  readonly id: string;
  readonly description: string;
  readonly jev_hints?: { favor_when?: readonly string[]; avoid_when?: readonly string[] };
}

/** Current summary labels flattened to "field:value" strings. */
export type LabelSet = ReadonlySet<string>;

/**
 * Emits both the nested path and the bare field name, so a hint can be written
 * as `bottleneck:accuracy` regardless of whether the label sits at the top
 * level or under `build`. Hint authors should not have to know the shape of
 * the state object, and `isKnownLabelRef` only knows bare field names.
 */
export function labelSet(labels: Readonly<Record<string, unknown>>, prefix = ""): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(labels)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const add = (value: string) => {
      out.add(`${path}:${value}`);
      out.add(`${k}:${value}`);
    };
    if (typeof v === "string") {
      add(v);
    } else if (Array.isArray(v)) {
      // Braces matter here: an unbraced for/if would swallow the next else-if.
      for (const item of v) if (typeof item === "string") add(item);
    } else if (v && typeof v === "object") {
      for (const nested of labelSet(v as Record<string, unknown>, path)) out.add(nested);
    }
  }
  return out;
}

/** Sentences fired when a hint matches the current state. Editing these changes the prompt hash. */
export const STATE_SENTENCES: Readonly<Record<string, string>> = {
  "bottleneck:accuracy": "Directly addresses the current accuracy bottleneck.",
  "bottleneck:cast_frequency": "Directly addresses the current cast-frequency bottleneck.",
  "bottleneck:mana": "Directly addresses the current mana bottleneck.",
  "bottleneck:damage": "Directly addresses the current damage bottleneck.",
  "mana_sustain:starved": "Mana is already starved, so this costs more than it gives.",
  "mana_sustain:tight": "Mana is tight, so the extra cost matters.",
  "health:critical": "The player is one hit from dying.",
  "health:low": "The player is low on health.",
  "recent_damage:heavy": "The player has taken heavy damage recently.",
  "movement_pressure_recent:heavy": "The player has been under heavy movement pressure.",
  "consistency:pivoted": "The player has changed direction twice in a row.",
  "clear_speed:fast": "The player is clearing quickly.",
  "clear_speed:slow": "The player is clearing slowly.",
};

/** Label transitions the simulator can report between the current and the best arrangement. */
export function deltaSentence(field: string, from: string, to: string): string | null {
  if (from === to) return null;
  const pretty = field.replace(/_/g, " ");
  if (field === "bottleneck" && to === "none") return `Would clear the ${from} bottleneck.`;
  if (field === "bottleneck") return `Would shift the bottleneck from ${from} to ${to}.`;
  return `Would move ${pretty} from ${from} to ${to}.`;
}

/** Order matters: the most decision-relevant transition is stated first (doc 010). */
const DELTA_PRIORITY = ["bottleneck", "mana_sustain", "archetype", "scatter"];

export function orderDeltas(
  deltas: readonly { field: string; from: string; to: string }[],
): { field: string; from: string; to: string }[] {
  const rank = (f: string) => {
    const i = DELTA_PRIORITY.indexOf(f);
    return i < 0 ? DELTA_PRIORITY.length : i;
  };
  return [...deltas].sort((a, b) => rank(a.field) - rank(b.field) || a.field.localeCompare(b.field));
}

export interface DescribeOptions {
  /** Cap on delta sentences appended; doc 010 says at most two. */
  readonly maxDeltas?: number;
  /** Appended verbatim, for example an encounter's suitability word. */
  readonly suffix?: string;
  /** Short form drops hint and delta sentences, for the narrow reward axes (doc 007). */
  readonly short?: boolean;
}

export function describe(
  entry: Describable,
  labels: LabelSet,
  deltas: readonly { field: string; from: string; to: string }[] = [],
  options: DescribeOptions = {},
): string {
  const parts = [entry.description.trim()];
  if (options.short) return parts[0]!;

  for (const ref of [...(entry.jev_hints?.favor_when ?? []), ...(entry.jev_hints?.avoid_when ?? [])]) {
    if (!labels.has(ref)) continue;
    const sentence = STATE_SENTENCES[ref];
    if (sentence) parts.push(sentence);
  }

  for (const d of orderDeltas(deltas).slice(0, options.maxDeltas ?? 2)) {
    const s = deltaSentence(d.field, d.from, d.to);
    if (s) parts.push(s);
  }

  if (options.suffix) parts.push(options.suffix);
  return parts.join(" ");
}

/** Every hint must have a sentence, or the hint silently does nothing (doc 010). */
export function missingSentences(entries: readonly Describable[]): string[] {
  const missing = new Set<string>();
  for (const e of entries)
    for (const ref of [...(e.jev_hints?.favor_when ?? []), ...(e.jev_hints?.avoid_when ?? [])]) {
      if (!isKnownLabelRef(ref)) missing.add(`${ref} (not a known label)`);
      else if (!STATE_SENTENCES[ref]) missing.add(ref);
    }
  return [...missing].sort();
}

/** Stable hash over every template, so a metric shift can be attributed (doc 010). */
export function promptHash(extra: readonly string[] = []): string {
  const material = [
    ...Object.entries(STATE_SENTENCES).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`),
    ...DELTA_PRIORITY,
    ...extra,
  ].join("\n");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < material.length; i++) {
    const c = material.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 12);
}
