/**
 * **Which affixes an eruption can carry, measured rather than assumed.**
 *
 * An eruption (`stepEruptions` in `world.ts`) hurts what stands on its cells
 * and fills their element gauges, and fires none of the projectile hooks: no
 * hit, kill, expire or wall event reaches an affix. It used to be read as a
 * `bolt` by `itemShape`, so every bolt affix was dealt for it and most of them
 * did nothing. Now `eruption` is a shape of its own, and an affix lists it
 * only where this file can see the affix do something on one.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step } from "./world.ts";
import { NO_INPUT } from "./types.ts";
import type { World } from "./types.ts";
import { makeEnemy } from "./enemy.ts";
import { attachAffix } from "./spells.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { ITEMS, plainInstance } from "../spells/index.ts";
import { SPELL_AFFIXES, affixFitsSpell, itemShape, spellAffixById } from "../spells/affixes.ts";
import type { SpellAffix } from "../spells/affixes.ts";
import { fittingAffixes, heldSpell, offerCards } from "../run/offer.ts";
import { RngSource } from "../rng.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";

const src = new RngSource("eruption-affixes");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("room"), { plain: true },
);
const room = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });

function onFloor(x: number, y: number): [number, number] {
  const gx0 = Math.floor(x / TILE_PX);
  const gy0 = Math.floor(y / TILE_PX);
  const free = (gx: number, gy: number): boolean =>
    gx >= 1 && gy >= 1 && gx < GRID_W - 1 && gy < GRID_H - 1
    && room.grid[gy * GRID_W + gx] === Tile.Floor;
  for (let r = 0; r < GRID_W; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (free(gx0 + dx, gy0 + dy)) return [(gx0 + dx + 0.5) * TILE_PX, (gy0 + dy + 0.5) * TILE_PX];
      }
  return [x, y];
}

const [PX, PY] = onFloor(300, 300);

/**
 * The line eruption, with no element of its own: whatever element or echo an
 * affix adds shows up against nothing.
 */
const SPELL = "earth_spikes";

/** What one cast into a line of pinned bodies left behind. */
interface Seen {
  readonly eruptions: number;
  readonly wards: number;
  readonly burn: number;
  readonly poison: number;
  readonly chill: number;
  readonly damage: number;
  /** Casts that threw bodies back (`repulse`), and damage the bursts under a body dealt (`aftershock`). */
  readonly repulses: number;
  readonly aftershock: number;
}

function cast(affix?: string): Seen {
  const w: World = createWorld({
    room, encounter: null, props: 0,
    staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance(SPELL), null, null, null, null, null],
    hearts: 6, rng: src.stream("w", affix ?? "bare"),
  });
  w.player.x = PX;
  w.player.y = PY;
  w.player.facing = 0;
  w.player.mana = w.staff.mana_max;
  if (affix) {
    let slot = w.spells[0]!;
    for (let t = 0; t < 3; t++) slot = attachAffix(slot, affix) ?? slot;
    w.spells[0] = slot;
  }
  const bodies = [40, 72, 104, 136, 168].map((d) => {
    const [x, y] = onFloor(PX + d, PY);
    const e = makeEnemy(w.nextEnemyId++, "rusher", x, y, []);
    e.spawnFadeMs = 0;
    e.awake = true;
    e.hp = 100_000;
    e.maxHp = 100_000;
    e.speed = 0;
    w.enemies.push(e);
    return e;
  });
  const aim = { ...NO_INPUT, aimX: PX + 200, aimY: PY };
  let eruptions = 0, burn = 0, poison = 0, chill = 0, repulses = 0, aftershock = 0;
  const observe = (): void => {
    eruptions += w.events.filter((e) => e.kind === "eruption").length;
    repulses += w.events.filter((e) => e.kind === "shot" && e.what === "repulse").length;
    for (const e of w.events) if (e.kind === "damage" && e.what === "hp:aftershock") aftershock += e.amount ?? 0;
    for (const e of bodies) {
      burn = Math.max(burn, e.burnBuild + (e.burnMs > 0 ? 1 : 0));
      poison = Math.max(poison, e.poisonBuild + e.poisonStacks);
      chill = Math.max(chill, e.chillBuild + (e.frozenMs > 0 ? 1 : 0));
    }
  };
  step(w, { ...aim, spell: 0 });
  observe();
  for (let i = 0; i < 240; i++) {
    step(w, aim);
    observe();
  }
  const damage = bodies.reduce((t, e) => t + (100_000 - e.hp), 0);
  return { eruptions, wards: w.wards.length, burn, poison, chill, damage, repulses, aftershock };
}

/**
 * How each kind of effect shows on an eruption, against the bare spell. An
 * affix that lists `eruption` with an effect missing here fails the test: a
 * new claim needs a new measurement.
 */
function observable(a: SpellAffix, bare: Seen, withIt: Seen): boolean | null {
  const e = a.effect;
  switch (e.kind) {
    case "repeat": return withIt.eruptions > bare.eruptions && withIt.damage > bare.damage;
    // The side casts are lines of ground in other directions: more cells go off.
    case "spread": return withIt.eruptions > bare.eruptions;
    case "ward": return withIt.wards > bare.wards;
    case "repulse": return withIt.repulses > bare.repulses;
    case "aftershock": return withIt.aftershock > bare.aftershock;
    case "shape":
      if (e.element === "fire") return withIt.burn > bare.burn;
      if (e.element === "poison") return withIt.poison > bare.poison;
      if (e.element === "ice") return withIt.chill > bare.chill;
      return null;
    default: return null;
  }
}

describe("the eruption shape", () => {
  it("is its own shape, not a bolt", () => {
    const eruptions = [...ITEMS.values()].filter((i) => itemShape(i) === "eruption").map((i) => i.id).sort();
    expect(eruptions).toEqual(["cinder_geysers", "earth_spikes", "flame_pillars", "meteor", "quake_ring"]);
  });

  it("shows the effect of every affix that lists it", () => {
    const bare = cast();
    // The bare cast erupts and lights nothing, or every comparison below is empty.
    expect(bare.eruptions).toBeGreaterThan(0);
    expect(bare.damage).toBeGreaterThan(0);
    expect([bare.wards, bare.burn, bare.poison, bare.chill]).toEqual([0, 0, 0, 0]);
    const listed = SPELL_AFFIXES.filter((a) => a.shapes.includes("eruption"));
    expect(listed.map((a) => a.id).sort()).toEqual(
      ["aftershock", "blight", "kindle", "lodestar", "parting", "repeat", "repulse", "resonance", "retort", "rime",
        "scatter", "slipstream", "ward", "whirl"]);
    /*
     * The cast-time ones here, on a press. `retort`, `slipstream`,
     * `parting`, `resonance` and `whirl` fire the eruption free from a hit
     * taken, a dash, the sword and its spin, which this press cannot set off; `affix-shapes.test.ts` sets off
     * each of them on every shape they list, this one included.
     */
    // `lodestar` changes where the ground lands, which a press at bodies already aimed at cannot show; `affix-shapes.test.ts` aims away.
    for (const a of listed.filter((x) => x.hook === "cast" && x.id !== "lodestar")) {
      const seen = observable(a, bare, cast(a.id));
      expect({ affix: a.id, seen }).toEqual({ affix: a.id, seen: true });
    }
  });

  it("is attachable by exactly the affixes that list it, on every eruption", () => {
    for (const id of ["earth_spikes", "flame_pillars", "cinder_geysers", "meteor", "quake_ring"])
      for (const a of SPELL_AFFIXES)
        expect({ id, affix: a.id, fits: affixFitsSpell(a, ITEMS.get(id), []) })
          // A long spell takes no `parting`: casting behind on a dash away is a close answer.
          .toEqual({ id, affix: a.id, fits: a.shapes.includes("eruption") && !(a.id === "parting" && ITEMS.get(id)!.tags?.includes("long")) });
  });

  it("is not dealt a bolt affix: fork never reaches an eruption-only staff", () => {
    const fork = spellAffixById("fork")!;
    expect(fork.shapes).not.toContain("eruption");
    // On an eruption fork splits nothing — there is no projectile to split —
    // and it still charges its surcharge; the bare figures are the proof.
    expect(cast("fork")).toEqual(cast());
    const held = [heldSpell(ITEMS.get(SPELL))];
    expect(fittingAffixes(held).map((a) => a.id)).not.toContain("fork");
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const cards = offerCards(ITEMS, new RngSource(seed).stream("offer"), [], "affix", held);
      expect(cards.map((c) => c.itemId), seed).not.toContain("fork");
    }
  });
});
