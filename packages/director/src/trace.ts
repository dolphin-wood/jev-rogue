/**
 * Decision traces and run logs (design doc 011). Every Director call emits a
 * trace whether it was served by Jev, the rule table or random, so a run is
 * always reportable as the mix it actually was.
 */
import type { CounterScore } from "@jr/core";
import type { Distribution } from "@jr/core";
import type { DecisionSource, FallbackPath } from "./types.ts";

export type Purpose =
  | "staff" | "doors" | "room" | "encounter" | "rewards"
  | "rest" | "boss" | "pity" | "temptation";

export type DirectorMode = "jev" | "rule" | "random" | "scripted";

export interface OfferRecord {
  readonly cards: readonly string[];
  readonly rank_in_pool: readonly number[];
  readonly blended_prob: readonly number[];
  readonly affixes: readonly (string | null)[];
  readonly trimmed_items: readonly string[];
}

export interface DecisionTrace {
  readonly run_id: string;
  readonly run_seed: string;
  readonly room_index: number;
  readonly door_slot: number | null;
  readonly round: number;
  readonly purpose: Purpose;
  readonly director_mode: DirectorMode;
  readonly source: DecisionSource;
  readonly fallback_path?: FallbackPath;
  readonly content_hash: string;
  readonly prompt_hash: string;
  readonly model: string;
  readonly state: unknown;
  readonly questions: unknown;
  readonly answers?: Readonly<Record<string, { choice: string; probabilities: Distribution; confidence: number | null }>>;
  readonly sampled: readonly string[];
  readonly offer?: OfferRecord;
  readonly validation_failures: readonly string[];
  readonly retries: number;
  readonly latency_ms: number | null;
  readonly input_tokens: number | null;
  readonly error?: string;
  readonly applied: boolean;
  /** True when what reached the player is exactly what Jev answered. */
  readonly unmodified: boolean;
  readonly player_choice?: string;
  readonly player_choice_rank_in_offer?: number;
  readonly player_choice_rank_in_pool?: number;
}

/** Player actions that inputs alone cannot reproduce (doc 011). */
export type RunEvent =
  | { tick: number; kind: "door"; room_index: number; choice: string }
  | { tick: number; kind: "pick"; uid: string }
  | { tick: number; kind: "skip" }
  | { tick: number; kind: "discard"; uid: string }
  | { tick: number; kind: "edit"; from: number; to: number }
  | { tick: number; kind: "buy"; uid: string; gold: number }
  | { tick: number; kind: "reroll"; gold: number }
  | { tick: number; kind: "rest"; option: string };

export interface CommitmentRecord {
  readonly plan_id: string;
  readonly purpose: Purpose;
  readonly source: DecisionSource;
  readonly committed_at_tick: number;
  readonly trimmed: boolean;
}

export interface RunLog {
  readonly run_id: string;
  readonly run_seed: string;
  readonly director_mode: DirectorMode;
  readonly code_version: string;
  readonly content_hash: string;
  readonly prompt_hash: string;
  /** Run-length encoded: [repeatCount, moveX, moveY, aimDeg, fire] per entry. */
  readonly inputs: readonly (readonly [number, number, number, number, 0 | 1])[];
  readonly events: readonly RunEvent[];
  readonly commitments: readonly CommitmentRecord[];
  readonly traces: readonly DecisionTrace[];
  readonly counter_scores: readonly CounterScore[];
  readonly final_world_hash: string;
}

export interface TraceSink {
  write(trace: DecisionTrace): void;
  flush(): Promise<void>;
}

export function consoleSink(log: (s: string) => void = console.log): TraceSink {
  return {
    write: (t) => log(`[${t.purpose}/${t.source}] room ${t.room_index} -> ${t.sampled.join(", ")}`),
    flush: async () => {},
  };
}

export function memorySink(): TraceSink & { readonly traces: DecisionTrace[] } {
  const traces: DecisionTrace[] = [];
  return { traces, write: (t) => void traces.push(t), flush: async () => {} };
}
