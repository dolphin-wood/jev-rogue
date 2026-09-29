/**
 * **Blades left in the bodies the sword strikes** (`lodge_max`, Blade Recall;
 * doc 006).
 *
 * While a key holds a spell with `lodge_max`, every connecting sword blow
 * leaves one of its spectral blades in the body struck, up to `lodge_max`
 * across the room, past which the oldest goes. A blade stays `lodge_ms`, and
 * outlives its body: when the body dies the blade stays where it fell, so a
 * kill does not waste it. The key's press rips every blade out at once and
 * flies it home to the caster (`cast.ts`), through the body it was in and
 * everything between. With no blade out the key does nothing, and is shown
 * as cooling, as an empty bank is. The blow that fills the key calls them
 * home by itself, free: the press is for calling them sooner, not a chore
 * every sixth swing.
 *
 * The one spell that is loaded by the sword rather than by the bar: the
 * swings are the ammunition, the press the payoff.
 */
import type { ItemRegistry } from "../spells/items.ts";
import type { Enemy, World } from "./types.ts";
import { ITEMS } from "../spells/items.ts";

/** One blade left in a body, or on the floor where its body fell. */
export interface LodgedBlade {
  spellIndex: number;
  /** The body it is in; -1 once the body has died and the blade lies where it fell. */
  enemyId: number;
  x: number;
  y: number;
  /** Where on the body it went in, and at what slant, for the renderer. */
  angle: number;
  /** How long it stays. */
  ms: number;
}

function param(items: ItemRegistry, base: string, key: string): number {
  const v = Number((items.get(base)?.params as Record<string, unknown> | undefined)?.[key]);
  return Number.isFinite(v) ? v : 0;
}

/** The most blades a spell leaves out at once, or 0 for a spell that leaves none. */
export function lodgeMaxOf(items: ItemRegistry, base: string): number {
  return Math.max(0, Math.round(param(items, base, "lodge_max")));
}

/** How many of this key's blades are out now. */
export function lodgedOn(w: World, spellIndex: number): number {
  let n = 0;
  for (const b of w.lodged) if (b.spellIndex === spellIndex) n++;
  return n;
}

/**
 * A connecting sword blow: each key holding a `lodge_max` spell leaves a
 * blade in the body. Returns the keys this blow filled, whose blades come
 * home on their own (`world.ts`): six blows are a recall without the press,
 * and the key is there to call them sooner.
 */
export function lodgeBlades(w: World, e: Enemy, items: ItemRegistry = ITEMS): number[] {
  const full: number[] = [];
  w.spells.forEach((slot, i) => {
    if (!slot) return;
    const max = lodgeMaxOf(items, slot.item.base);
    if (max <= 0) return;
    const mine = w.lodged.filter((b) => b.spellIndex === i);
    if (mine.length >= max) {
      const oldest = mine.reduce((a, b) => (b.ms < a.ms ? b : a));
      w.lodged.splice(w.lodged.indexOf(oldest), 1);
    }
    // Round the body a step at a time, so the blades in one body fan out rather than stack.
    const onBody = w.lodged.filter((b) => b.enemyId === e.id).length;
    w.lodged.push({
      spellIndex: i, enemyId: e.id, x: e.x, y: e.y,
      angle: -Math.PI / 2 + ((onBody % 5) - 2) * 0.55 + (e.id % 3) * 0.2,
      ms: param(items, slot.item.base, "lodge_ms") || 8000,
    });
    w.events.push({ kind: "spell", x: e.x, y: e.y, what: "lodge" });
    if (mine.length + 1 >= max) full.push(i);
  });
  return full;
}

/** The blades follow their bodies, lie where a body fell, and run out. */
export function stepLodged(w: World, dtMs: number): void {
  if (w.lodged.length === 0) return;
  for (const b of w.lodged) {
    b.ms -= dtMs;
    if (b.enemyId < 0) continue;
    const e = w.enemies.find((x) => x.id === b.enemyId);
    if (!e || e.hp <= 0) { b.enemyId = -1; continue; }
    b.x = e.x;
    b.y = e.y;
  }
  // A key emptied of its spell, or moved, takes its blades with it.
  w.lodged = w.lodged.filter((b) => b.ms > 0 && !!w.spells[b.spellIndex] && lodgeMaxOf(ITEMS, w.spells[b.spellIndex]!.item.base) > 0);
}

/** Takes every blade this key has out, for the press that recalls them. */
export function takeLodged(w: World, spellIndex: number): LodgedBlade[] {
  const taken = w.lodged.filter((b) => b.spellIndex === spellIndex);
  if (taken.length > 0) w.lodged = w.lodged.filter((b) => b.spellIndex !== spellIndex);
  return taken;
}
