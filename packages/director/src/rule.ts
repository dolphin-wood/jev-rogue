/**
 * The control Director (design docs 002 and 011). Same labels, same option
 * filters, same generators, same sampling as `JevDirector`; only the source of
 * the distribution differs, so a blind test compares that one component.
 *
 * It is also the single fallback for every failed Jev decision (doc 002, "The
 * fallback contract"). `RandomDirector` is never a fallback, because degrading
 * to state-blind weights would make a broken jev run lose to its own control.
 */
import { withTemperature } from "@jr/core";
import type { DoorSet, SummaryLabels, Tension } from "@jr/core";
import type { Distribution } from "@jr/core";
import { doorSetKey } from "./questions/doors.ts";

/** Hand-tuned weights. Editing these changes the control, so it changes the experiment. */
export const DOOR_WEIGHTS = {
  base: 1,
  restWhenHurt: 3.0,
  restWhenHealthy: 0.5,
  shopWhenRich: 2.0,
  shopWhenPoor: 0.6,
  eliteWhenFull: 1.8,
  eliteWhenLow: 0.3,
  treasureWhenMissingRole: 1.6,
  perExtraDoor: 1.15,
} as const;

export function ruleDoorWeights(legalSets: readonly DoorSet[], labels: SummaryLabels): Distribution {
  const hurt = labels.health === "low" || labels.health === "critical" || labels.recent_damage === "heavy";
  const out: Record<string, number> = {};
  for (const set of legalSets) {
    let w = DOOR_WEIGHTS.base * Math.pow(DOOR_WEIGHTS.perExtraDoor, set.length - 1);
    if (set.includes("rest")) w *= hurt ? DOOR_WEIGHTS.restWhenHurt : DOOR_WEIGHTS.restWhenHealthy;
    if (set.includes("shop")) w *= labels.gold === "rich" ? DOOR_WEIGHTS.shopWhenRich : labels.gold === "poor" ? DOOR_WEIGHTS.shopWhenPoor : 1;
    if (set.includes("elite")) w *= labels.health === "full" ? DOOR_WEIGHTS.eliteWhenFull : hurt ? DOOR_WEIGHTS.eliteWhenLow : 1;
    if (set.includes("treasure") && labels.build.missing_roles.length > 0) w *= DOOR_WEIGHTS.treasureWhenMissingRole;
    out[doorSetKey(set)] = w;
  }
  return normalise(out);
}

export function ruleTensionWeights(allowed: readonly Tension[], labels: SummaryLabels): Distribution {
  const out: Record<string, number> = {};
  for (const t of allowed) {
    let w = 1;
    if (t === "release") w *= labels.recent_damage === "heavy" ? 3 : labels.health === "critical" ? 4 : 1;
    if (t === "build") w *= 1.5;
    if (t === "peak") w *= labels.clear_speed === "fast" && labels.health !== "low" ? 2.5 : 0.8;
    out[t] = w;
  }
  return normalise(out);
}

/** Ignores every label. The experimental floor only (doc 002). */
export function randomDoorWeights(legalSets: readonly DoorSet[]): Distribution {
  return normalise(Object.fromEntries(legalSets.map((s) => [doorSetKey(s), 1])));
}

export function normalise(weights: Readonly<Record<string, number>>): Distribution {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total <= 0) {
    const keys = Object.keys(weights);
    return Object.fromEntries(keys.map((k) => [k, 1 / keys.length]));
  }
  return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / total]));
}

/** The rule table is a distribution like any other, so it samples identically. */
export function ruleDistribution(
  weights: Readonly<Record<string, number>>,
  temperature = 1,
): Distribution {
  return withTemperature(normalise(weights), temperature);
}
