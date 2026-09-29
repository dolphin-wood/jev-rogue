/**
 * The damage a spell's card prints is the damage its hit lands.
 *
 * A global spell scale went into the cast and not into the card, and every
 * card read a little over half of what landed — 8 on a bolt that hit for 14,
 * 5 on a pellet that hit for 9. This casts each attack once, alone, at an
 * awake dummy (no ambush, no status yet) and compares the first plain hit
 * with the figure on its card.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step } from "../sim/world.ts";
import { makeEnemy } from "../sim/enemy.ts";
import { runStaff } from "../sim/spells.ts";
import { plainInstance, ITEMS } from "../spells/index.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { RngSource } from "../rng.ts";
import { GRID_H, GRID_W, Tile } from "../types.ts";
import { NO_INPUT, STEP_MS } from "../sim/types.ts";
import { offerStatParts } from "./offer.ts";
import { SPELL_DAMAGE_SCALE } from "../sim/cast.ts";
import { lodgeBlades, lodgeMaxOf } from "../sim/recall.ts";

const src = new RngSource("card-damage");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "standard", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("r"), { plain: true },
);
const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
const grid = built.grid.slice();
for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
const room = { ...built, grid };
const P = { x: 140, y: 208 };

function firstHit(id: string): number | null {
  const item = ITEMS.get(id)!;
  // Where each shape lands: blades, a dash and a wide cone at arm's length, a
  // raised pillar beside the body it shoves at its own reach.
  const shape = String(item.params["shape"] ?? "");
  const close = ["orbit", "dash", "boomerang", "stance", "trail"].includes(shape) || Number(item.params["spread"] ?? 0) >= 50
    // Rings of ground round the caster reach a few tiles and no further.
    || item.params["pattern"] === "ring";
  /*
   * An enchant's card prints its wave, so its body stands past the sword's
   * reach and inside the wave's, where the first blow it takes is a wave's.
   */
  const dx = shape === "pillar" ? Number(item.params["reach"] ?? 64) : shape === "enchant" ? 80 : close ? 36 : 150;
  const w = createWorld({ room, encounter: null, props: 0, staff: runStaff(), slots: [plainInstance(id), null, null], hearts: 999, rng: src.stream("w", id), invincible: true });
  w.player.x = P.x; w.player.y = P.y;
  const at = { x: P.x + dx, y: P.y };
  const e = makeEnemy(w.nextEnemyId++, "rusher", at.x, at.y, []);
  e.spawnFadeMs = 0; e.hp = 1e7; e.maxHp = 1e7; e.speed = 0; e.awake = true; e.alertMs = 0; e.attackCooldownMs = 1e9;
  w.enemies.push(e);
  // Held until the cast goes off, then let go: one cast, whatever its wind-up.
  // A `charge` spell is held to a full charge first, which is what its card
  // prints; letting go is what fires it.
  const charge = Number(item.params["charge"] ?? 0);
  // An `emit` spell's shards outrun it; the card prints the orb, so the
  // shards' own figure is not its first hit.
  const shard = Number(item.params["emit"] ?? 0) > 0
    ? Math.max(1, Math.floor(Number(item.params["emit_damage"] ?? 0) * SPELL_DAMAGE_SCALE)) : -1;
  let cast = false;
  /*
   * What the newer shapes need of the hands (doc 006): an enchant's caster
   * swings, a trail's walks over the body, and a stance's is struck while
   * the guard is up — the card prints the answer to a hit taken, not the
   * weaker one a guard that runs out gives.
   */
  let struck = false;
  // A recall is loaded by the sword: one blow's blade in the body first.
  if (lodgeMaxOf(ITEMS, id) > 0) lodgeBlades(w, e);
  for (let t = 0; t < 2500; t += STEP_MS) {
    const fired = w.stats.shotsFired;
    const letGo = cast || (charge > 0 && w.player.chargeKey === 0 && w.player.chargeMs >= charge);
    if (shape === "stance" && w.player.stance && !struck) {
      struck = true;
      const b = w.enemyBullets.find((x) => !x.alive)!;
      b.alive = true; b.x = w.player.x; b.y = w.player.y; b.vx = 0; b.vy = 0;
      b.radius = 3; b.lifeMs = 200; b.damage = 1; b.from = "shooter";
    }
    const hands = shape === "enchant" ? { swing: true }
      : shape === "trail" ? { moveX: Math.floor(t / 400) % 2 === 0 ? 1 : -1 } : {};
    step(w, { ...NO_INPUT, aimX: at.x, aimY: at.y, spell: letGo ? -1 : 0, ...hands });
    if (w.stats.shotsFired > fired || w.player.enchant || w.player.trail || w.player.stance) cast = true;
    e.x = at.x; e.y = at.y; e.attackCooldownMs = 1e9;
    if (shape !== "trail") { w.player.x = P.x; w.player.y = P.y; }
    const hit = w.events.find((ev) => ev.kind === "damage" && (ev.what === "hp" || String(ev.what).startsWith("hp:"))
      && ev.amount !== shard);
    if (hit) return hit.amount ?? 0;
  }
  return null;
}

describe("a spell card's damage (doc 010)", () => {
  const attacks = [...ITEMS.values()];
  for (const item of attacks) {
    const printed = offerStatParts(item, 1).find((p) => p.tone !== "mana" && /dmg/.test(p.text));
    const n = printed ? Number(/^(\d+) dmg/.exec(printed.text)?.[1]) : NaN;
    if (!Number.isFinite(n)) continue;
    it(`is what ${item.id}'s first hit lands`, () => {
      const hit = firstHit(item.id);
      expect(hit).toBe(n);
    });
  }
});
