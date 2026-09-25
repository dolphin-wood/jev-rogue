/**
 * **Putting a spell on one key without touching the other two.**
 *
 * `equipItem` (core) writes the item into the staff and rebuilds every keyed
 * spell from the slots, which is right for a world being built and wrong for
 * a run in progress: a key's affixes, its level, its cooldown and a `charges`
 * bank live on the `SpellSlot`, not on the item, so a floor spell picked up
 * mid-room stripped the other keys back to bare level-one spells until the
 * next room rebuilt them. The scene equips through this instead: the key
 * being changed is rebuilt, and every other key keeps the very slot object it
 * had, so nothing on it moves.
 */
import type { ItemRegistry, World } from "@jr/core";
import { equipItem } from "@jr/core";

/**
 * Equips `itemId` on key `at` (or the first free slot when `at` is left out)
 * and puts every other key's spell back as it was. Returns what `equipItem`
 * returns.
 */
export function equipKeepingOthers(
  w: World, itemId: string, uid: string, items: ItemRegistry, at?: number,
): boolean {
  const before = [...w.spells];
  const target = at ?? w.slots.findIndex((x) => x === null);
  if (!equipItem(w, itemId, uid, items, at)) return false;
  for (let i = 0; i < w.spells.length; i++) {
    if (i === target) continue;
    w.spells[i] = before[i] ?? null;
  }
  return true;
}
