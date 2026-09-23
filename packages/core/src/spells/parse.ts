/**
 * Slot sequence -> cast tree (design doc 006, "Parse" and "Scopes and boosts").
 *
 * The parse is pure and cheap; the game caches it and recomputes it only when
 * the arrangement changes.
 */

import type { CastTree, CastUnit, ItemInstance } from "../types.ts";
import { baseOf, num, type ItemRegistry } from "./items.ts";

/** Doc 006: "Nesting depth is capped at 3." Root units sit at depth 1, so a
 *  unit that would land at depth 4 is dropped and reported. */
export const MAX_DEPTH = 3;

interface ParseState {
  readonly slots: readonly (ItemInstance | null)[];
  readonly items: ItemRegistry;
  i: number;
  readonly passives: ItemInstance[];
  readonly dropped: number[];
}

/** Every slot index a unit and its subtree occupy, for depth-drop reporting. */
function slotsOf(unit: CastUnit, out: number[]): void {
  out.push(unit.slot);
  if (unit.kind === "payload" && unit.child) slotsOf(unit.child, out);
  if (unit.kind === "multicast") for (const u of unit.units) slotsOf(u, out);
}

/**
 * Consume slots until `count` units have been produced or the sequence ends.
 *
 * `scopeBoosts` is the live boost set of the scope being read. It starts as a
 * copy of the enclosing scope's set, which is what makes a boost apply to every
 * scope opened after it, and boosts appended here never escape upward.
 */
function takeUnits(state: ParseState, count: number, scopeBoosts: ItemInstance[], depth: number): CastUnit[] {
  const units: CastUnit[] = [];
  while (units.length < count && state.i < state.slots.length) {
    const slot = state.i;
    const inst = state.slots[slot] ?? null;
    state.i++;
    if (!inst) continue;
    const base = baseOf(inst, state.items);

    if (base.kind === "passive") {
      // Not a unit: it applies to the whole staff wherever it sits.
      state.passives.push(inst);
      continue;
    }
    if (base.kind === "boost") {
      // Not a unit: it joins this scope from this position onward.
      scopeBoosts.push(inst);
      continue;
    }

    const boosts: readonly ItemInstance[] = [...scopeBoosts];
    if (base.kind === "attack") {
      units.push({ kind: "attack", slot, item: inst, boosts });
      continue;
    }
    if (base.kind === "payload") {
      // The payload's child scope inherits this scope's boosts and may collect
      // more; those extra boosts stay inside the payload (doc 006, example 4).
      const childScope = [...scopeBoosts];
      const child = takeUnits(state, 1, childScope, depth + 1)[0] ?? null;
      units.push({ kind: "payload", slot, item: inst, boosts, child });
      continue;
    }
    // multicast
    const n = Math.max(1, Math.round(num(base.params, "n", 2)));
    const groupScope = [...scopeBoosts];
    const captured = takeUnits(state, n, groupScope, depth + 1);
    units.push({ kind: "multicast", slot, item: inst, boosts, units: captured, n });
  }

  if (depth > MAX_DEPTH) {
    // Too deep: the slots are still consumed (so they do not resurface as root
    // units) but the units are discarded and the editor is told which.
    for (const unit of units) slotsOf(unit, state.dropped);
    return [];
  }
  return units;
}

export function parseCastTree(
  slots: readonly (ItemInstance | null)[],
  items: ItemRegistry,
): CastTree {
  const state: ParseState = { slots, items, i: 0, passives: [], dropped: [] };
  const units = takeUnits(state, Number.POSITIVE_INFINITY, [], 1);
  state.dropped.sort((a, b) => a - b);
  return { units, passives: state.passives, droppedForDepth: state.dropped };
}

/** Number of cast ticks in one cycle: the cursor advances one *unit* per tick. */
export function tickCount(tree: CastTree): number {
  return tree.units.length;
}
