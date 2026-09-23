/**
 * The affix pool: what a spell gains that is not a number.
 *
 * Doc 013 sets the rule this file exists to enforce:
 *
 * > **An affix adds or changes an event. A spell level and a gold purchase
 * > scale numbers. They are different kinds and they come from different
 * > pools.**
 *
 * and then says why it has to be enforced structurally rather than by
 * discipline: "the cheaper kind is easier to author and the pool will silently
 * fill with it otherwise." The cheap kind is `damage_mult: 1.35`. It takes
 * seconds to write, it is trivially balanced, and twenty of them turn the
 * build system into a stat screen with extra steps — which is the failure the
 * whole mechanism exists to avoid.
 *
 * So **the schema cannot express a number on its own.** Every affix must name
 * a `hook` — a moment that already exists in the simulation — and an `effect`
 * that happens at it. Tiers may only scale that effect's own magnitude. There
 * is nowhere to put "+35% damage", because damage is not an event.
 *
 * ### The hooks are real, which is what separates this from a wishlist
 *
 * Each one is a place the simulation already reaches, and `firePayloadChild`
 * is the primitive that fires an effect at a position — the payload mechanism
 * generalised. Nothing here needs a new kind of thing to exist:
 *
 * | hook | where it fires | already used by |
 * |---|---|---|
 * | `hit` | a player projectile overlaps a body | `on_hit` carriers |
 * | `expire` | a projectile's lifetime ends | `on_expire` carriers |
 * | `wall` | a projectile stops on geometry | `on_wall` carriers |
 * | `kill` | a body's hp reaches zero | the `enemy_killed` event |
 * | `cast` | the spell is fired | `fireUnit` |
 * | `hurt` | the player takes a hit | the `player_hit` event |
 * | `dash` | the player dashes | the `dash` event |
 *
 * ### Three things are called "affix" in this repository
 *
 * They are different and the names here are deliberate:
 *
 * - **`SPELL_AFFIXES`, this file.** Doc 013's affixes: three per spell, event
 *   changing, three tiers, duplicates upgrade. What a reward card offers.
 * - **`AffixId` in `affix.ts`** — doc 006's *instance rolls*: `homing`,
 *   `cheaper`, `wider`, `heavier`, `elemental`. A numeric modifier Jev picks
 *   an intent for and code calibrates into a rarity band. A property of a
 *   dropped item, not something the player slots.
 * - **`AFFIXES` in `encounters/affixes.ts`** — *elite affixes*, which modify
 *   an enemy. Unrelated to both.
 *
 * ### Three tiers, one ladder
 *
 * Doc 013: a duplicate upgrades the affix rather than taking a second slot, a
 * drop's rarity is a head start on the same ladder, and there is exactly one
 * number the player has to track. Three tiers is "fine enough that a duplicate
 * always means something, coarse enough that a low-tier duplicate of a
 * high-tier affix is not a wasted draw".
 */
import type { BaseItem, Element } from "../types.ts";

/**
 * The shapes a spell can have; see `fireOnce` in `sim/cast.ts` and doc 013,
 * "Spell shapes". An affix names the shapes it works on, because a hook is
 * only reachable from some of them: a bolt hits, expires and meets walls, a
 * field does none of those, and a card that attaches to a field and does
 * nothing is a lie told in the reward screen.
 */
export type SpellShape = "bolt" | "orbit" | "field" | "pillar" | "dash" | "vortex" | "summon";
export const SPELL_SHAPES: readonly SpellShape[] = ["bolt", "orbit", "field", "pillar", "dash", "vortex", "summon"];

/** The moments an affix can attach to. Every one already exists in `sim`. */
export type AffixHook = "hit" | "expire" | "wall" | "kill" | "cast" | "hurt" | "dash" | "swing";

/**
 * What happens at the hook.
 *
 * A closed union, deliberately. Each member is a *thing that occurs* and
 * carries only the magnitude of its own occurrence — how many shards, how far
 * the arc reaches, how long the field lasts. None of them can reach the
 * spell's damage, cost or cooldown, because that is the whole point.
 */
export type AffixEffect =
  /** Splits into `count` smaller projectiles, fanned forward. */
  | { readonly kind: "split"; readonly count: number }
  /** Seeks the nearest other body within `rangePx`, `jumps` times. */
  | { readonly kind: "arc"; readonly jumps: number; readonly rangePx: number }
  /** Leaves a lingering field of `radiusPx` for `durationMs`. */
  | { readonly kind: "field"; readonly radiusPx: number; readonly durationMs: number }
  /** Bursts outward for `radiusPx`. */
  | { readonly kind: "burst"; readonly radiusPx: number }
  /** Marks a body; the next hit on a marked body detonates for `radiusPx`. */
  | { readonly kind: "mark"; readonly radiusPx: number }
  /** Fires the spell again, `extra` more times. */
  | { readonly kind: "repeat"; readonly extra: number }
  /** Fires the spell along `dirs` extra directions spaced evenly around. */
  | { readonly kind: "spread"; readonly dirs: number }
  /** Returns `fraction` of the spell's cost. */
  | { readonly kind: "refund"; readonly fraction: number }
  /** Leaves a rune that stops `shots` enemy projectiles. */
  | { readonly kind: "ward"; readonly shots: number }
  /** Fires the spell at up to `targets` bodies, free. */
  | { readonly kind: "riposte"; readonly targets: number }
  /** Every `every` connecting sword hits, casts the spell at the body struck, free. */
  | { readonly kind: "resonate"; readonly every: number }
  /**
   * Changes the projectile itself: through bodies, toward them, off walls,
   * heavier, or carrying an element. Each tier raises the one number it names.
   */
  | {
    readonly kind: "shape";
    readonly pierce?: number; readonly homing?: number; readonly bounce?: number;
    readonly damage?: number; readonly radius?: number; readonly speed?: number;
    readonly element?: Element; readonly power?: number;
  }
  /** A kill with this spell takes `fraction` off its cooldown. */
  | { readonly kind: "haste"; readonly fraction: number };

export interface AffixTier {
  readonly effect: AffixEffect;
  /** What the card says at this tier. One clause, no numbers the icon shows. */
  readonly text: string;
}

export interface SpellAffix {
  readonly id: string;
  readonly name: string;
  readonly hook: AffixHook;
  /**
   * The spell shapes this affix does something on. Decided by where the hook
   * fires: `hit`, `kill` and `expire` need a projectile (a bolt or an orbiting
   * blade), `wall` needs one that flies, `cast` needs a cast that placing in
   * more directions or firing again changes, `hurt` and `dash` need a spell
   * that can be fired *at* a body.
   */
  readonly shapes: readonly SpellShape[];
  /**
   * The element this affix colours its effect with, or null to inherit the
   * spell's. An affix is not an element source in its own right — doc 013 puts
   * element on the spell — but a field or a burst has to be *some* element to
   * resolve, and inheriting is almost always right.
   */
  readonly element: Element | null;
  /** Exactly three, weakest first. Enforced by the schema test. */
  readonly tiers: readonly [AffixTier, AffixTier, AffixTier];
  /** One sentence, the kind a player reads once and remembers. */
  readonly description: string;
}

/* --------------------------------- the pool -------------------------------- */

const BASE_AFFIXES: SpellAffix[] = [
  {
    id: "fork",
    name: "Fork",
    hook: "hit",
    shapes: ["bolt"],
    element: null,
    tiers: [
      { effect: { kind: "split", count: 2 }, text: "splits in two on impact" },
      { effect: { kind: "split", count: 3 }, text: "splits in three on impact" },
      { effect: { kind: "split", count: 4 }, text: "splits in four on impact" },
    ],
    description:
      "Impact breaks the projectile into shards that carry on forward. Turns a "
      + "single accurate shot into a reason to fight things in a line.",
  },
  {
    id: "chain",
    name: "Chain",
    hook: "hit",
    shapes: ["bolt", "orbit"],
    element: null,
    tiers: [
      { effect: { kind: "arc", jumps: 1, rangePx: 120 }, text: "arcs to one more body" },
      { effect: { kind: "arc", jumps: 2, rangePx: 140 }, text: "arcs to two more bodies" },
      { effect: { kind: "arc", jumps: 3, rangePx: 160 }, text: "arcs to three more bodies" },
    ],
    description:
      "The hit jumps to whatever else is close. Rewards letting a group gather "
      + "rather than picking it apart.",
  },
  {
    id: "brand",
    name: "Brand",
    hook: "hit",
    shapes: ["bolt", "orbit"],
    element: null,
    tiers: [
      { effect: { kind: "mark", radiusPx: 32 }, text: "a second hit detonates the mark" },
      { effect: { kind: "mark", radiusPx: 44 }, text: "a second hit detonates the mark" },
      { effect: { kind: "mark", radiusPx: 58 }, text: "a second hit detonates the mark wide" },
    ],
    description:
      "The first hit marks, the second sets the mark off. Pays for staying on "
      + "one target while everything else is asking you not to.",
  },
  {
    id: "harvest",
    name: "Harvest",
    hook: "kill",
    shapes: ["bolt", "orbit"],
    element: null,
    tiers: [
      { effect: { kind: "burst", radiusPx: 44 }, text: "kills burst" },
      { effect: { kind: "burst", radiusPx: 62 }, text: "kills burst" },
      { effect: { kind: "burst", radiusPx: 84 }, text: "kills burst wide" },
    ],
    description:
      "A body killed by this spell comes apart. The first kill in a pack is "
      + "worth more than the last, which is the opposite of how a fight usually goes.",
  },
  {
    id: "echo",
    name: "Echo",
    hook: "kill",
    shapes: ["bolt", "orbit"],
    element: null,
    tiers: [
      { effect: { kind: "refund", fraction: 0.5 }, text: "a kill returns half the mana" },
      { effect: { kind: "refund", fraction: 1 }, text: "a kill returns the mana" },
      { effect: { kind: "refund", fraction: 1.5 }, text: "a kill returns more than it cost" },
    ],
    description:
      "Killing with this spell pays for the next one. Makes a finisher into an "
      + "engine, and only while it is actually finishing.",
  },
  {
    id: "bloom",
    name: "Bloom",
    hook: "expire",
    shapes: ["bolt", "orbit"],
    element: null,
    tiers: [
      { effect: { kind: "field", radiusPx: 36, durationMs: 1400 }, text: "leaves a field" },
      { effect: { kind: "field", radiusPx: 46, durationMs: 2000 }, text: "leaves a field" },
      { effect: { kind: "field", radiusPx: 58, durationMs: 2600 }, text: "leaves a lasting field" },
    ],
    description:
      "Where the shot runs out, something stays. Turns a miss into area denial, "
      + "so range becomes a placement decision instead of a failure.",
  },
  {
    id: "shatter",
    name: "Shatter",
    hook: "wall",
    shapes: ["bolt"],
    element: null,
    tiers: [
      { effect: { kind: "split", count: 3 }, text: "breaks into three on a wall" },
      { effect: { kind: "split", count: 5 }, text: "breaks into five on a wall" },
      { effect: { kind: "split", count: 7 }, text: "breaks into seven on a wall" },
    ],
    description:
      "Hitting the room instead of a body is no longer wasted. The one affix "
      + "that makes a cluttered room better to fight in than an open one.",
  },
  {
    id: "repeat",
    name: "Repeat",
    hook: "cast",
    shapes: ["bolt"],
    element: null,
    tiers: [
      { effect: { kind: "repeat", extra: 1 }, text: "casts again a beat later" },
      { effect: { kind: "repeat", extra: 2 }, text: "casts twice more, a beat apart" },
      { effect: { kind: "repeat", extra: 3 }, text: "casts three times more, a beat apart" },
    ],
    description:
      "The spell fires again a beat after the press, on where you are aiming "
      + "then. This is where the old multicast items belong: attached to a spell "
      + "the player named, rather than being a spell of their own.",
  },
  {
    id: "scatter",
    name: "Scatter",
    hook: "cast",
    shapes: ["bolt", "field", "pillar"],
    element: null,
    tiers: [
      { effect: { kind: "spread", dirs: 1 }, text: "also casts behind you" },
      { effect: { kind: "spread", dirs: 3 }, text: "also casts to all sides" },
      { effect: { kind: "spread", dirs: 5 }, text: "casts in six directions" },
    ],
    description:
      "The cast goes outward as well as forward. The answer to being surrounded, "
      + "and useless when you are not.",
  },
  {
    id: "ward",
    name: "Ward",
    hook: "cast",
    shapes: [...SPELL_SHAPES],
    element: null,
    tiers: [
      { effect: { kind: "ward", shots: 1 }, text: "leaves a rune that eats one shot" },
      { effect: { kind: "ward", shots: 2 }, text: "leaves a rune that eats two shots" },
      { effect: { kind: "ward", shots: 3 }, text: "leaves a rune that eats three shots" },
    ],
    description:
      "Casting plants a rune where you stood that stops enemy fire. The only "
      + "affix that makes standing still correct, briefly.",
  },
  {
    id: "retort",
    name: "Retort",
    hook: "hurt",
    shapes: ["bolt", "field", "vortex"],
    element: null,
    tiers: [
      { effect: { kind: "riposte", targets: 1 }, text: "being hit fires back" },
      { effect: { kind: "riposte", targets: 2 }, text: "being hit fires back at two" },
      { effect: { kind: "riposte", targets: 3 }, text: "being hit fires back at three" },
    ],
    description:
      "Taking a heart casts this spell at whatever took it, free. Does not "
      + "reward being hit — it stops one mistake from becoming three.",
  },
  {
    id: "slipstream",
    name: "Slipstream",
    hook: "dash",
    shapes: ["bolt", "field", "vortex"],
    element: null,
    tiers: [
      { effect: { kind: "riposte", targets: 1 }, text: "dashing through a body casts" },
      { effect: { kind: "riposte", targets: 2 }, text: "dashing through two bodies casts" },
      { effect: { kind: "riposte", targets: 3 }, text: "dashing through a crowd casts" },
    ],
    description:
      "The dash already passes through bodies. This makes passing through one "
      + "an attack, which is the most aggressive way to use a defensive button.",
  },
];

/*
 * The expansion of the pool (task 7): three families the pool had nothing in.
 * All of them change an event, none scales a number (doc 013's rule, which
 * the schema test enforces).
 *
 * - **Trajectory** — `pierce`, `seek`, `ricochet`: what the shot does on its
 *   way, where the old pool only had what it does on arrival.
 * - **Element** — `kindle`, `rime`, `blight`: a spell of any school can carry
 *   fire, ice or poison, so a status build is not tied to three spells.
 * - **Tempo** — `haste`: a finisher that comes back sooner, the cooldown's
 *   counterpart to `echo`'s mana.
 */
BASE_AFFIXES.push(
  {
    id: "pierce", name: "Pierce", hook: "cast", shapes: ["bolt"], element: null,
    tiers: [
      { effect: { kind: "shape", pierce: 1 }, text: "passes through one body" },
      { effect: { kind: "shape", pierce: 2 }, text: "passes through two bodies" },
      { effect: { kind: "shape", pierce: 3 }, text: "passes through three bodies" },
    ],
    description: "The shot keeps going through what it hits. Lines the room up for you: a corridor fight becomes one cast.",
  },
  {
    id: "seek", name: "Seek", hook: "cast", shapes: ["bolt"], element: null,
    tiers: [
      { effect: { kind: "shape", homing: 0.35 }, text: "bends toward bodies" },
      { effect: { kind: "shape", homing: 0.55 }, text: "turns toward bodies" },
      { effect: { kind: "shape", homing: 0.8 }, text: "hunts bodies down" },
    ],
    description: "The shot curves onto the nearest body. Buys accuracy with nothing but a slot, so it suits a spell you cannot afford to miss.",
  },
  {
    id: "ricochet", name: "Ricochet", hook: "wall", shapes: ["bolt"], element: null,
    tiers: [
      { effect: { kind: "shape", bounce: 1 }, text: "bounces once off walls" },
      { effect: { kind: "shape", bounce: 2 }, text: "bounces twice off walls" },
      { effect: { kind: "shape", bounce: 3 }, text: "bounces three times" },
    ],
    description: "Walls send the shot back into the room. The more cluttered the room, the more each cast is worth.",
  },
  {
    id: "kindle", name: "Kindle", hook: "cast", shapes: [...SPELL_SHAPES], element: "fire",
    tiers: [
      { effect: { kind: "shape", element: "fire", power: 0.6 }, text: "sets bodies alight" },
      { effect: { kind: "shape", element: "fire", power: 0.9 }, text: "burns what it hits" },
      { effect: { kind: "shape", element: "fire", power: 1.2 }, text: "burns hard" },
    ],
    description: "Any spell becomes a fire spell: its hits fill the burn gauge. A fire build no longer waits for a fire spell to drop.",
  },
  {
    id: "rime", name: "Rime", hook: "cast", shapes: [...SPELL_SHAPES], element: "ice",
    tiers: [
      { effect: { kind: "shape", element: "ice", power: 0.6 }, text: "chills what it hits" },
      { effect: { kind: "shape", element: "ice", power: 0.9 }, text: "chills hard" },
      { effect: { kind: "shape", element: "ice", power: 1.2 }, text: "freezes fast" },
    ],
    description: "Any spell becomes an ice spell: its hits fill the chill gauge toward a freeze, and a frozen body shatters for triple.",
  },
  {
    id: "blight", name: "Blight", hook: "cast", shapes: [...SPELL_SHAPES], element: "poison",
    tiers: [
      { effect: { kind: "shape", element: "poison", power: 0.6 }, text: "poisons what it hits" },
      { effect: { kind: "shape", element: "poison", power: 0.9 }, text: "poisons hard" },
      { effect: { kind: "shape", element: "poison", power: 1.2 }, text: "poisons deep" },
    ],
    description: "Any spell becomes a poison spell: its hits fill the poison gauge, which slows and wears a body down.",
  },
  {
    id: "haste", name: "Haste", hook: "kill", shapes: ["bolt", "orbit"], element: null,
    tiers: [
      { effect: { kind: "haste", fraction: 0.5 }, text: "a kill halves the cooldown" },
      { effect: { kind: "haste", fraction: 0.75 }, text: "a kill nearly resets it" },
      { effect: { kind: "haste", fraction: 1 }, text: "a kill resets the cooldown" },
    ],
    description: "Killing with this spell brings it back sooner. A heavy spell that finishes a body is ready for the next.",
  },
);

export const SPELL_AFFIXES: readonly SpellAffix[] = BASE_AFFIXES;

/**
 * What an affix does to its spell's **mana cost**, per tier (task 7).
 *
 * `repeat` fired whole extra casts for nothing, and with `scatter` it
 * multiplied: a tier-three pair was twenty-four shots for one press at one
 * price. `repeat` now costs for the casts it adds. `scatter` stays free and
 * its side casts land at half (`SPREAD_DAMAGE`): costing it made the spell
 * *worse* in front — measured at 0.57 of the bare bolt — which is a card that
 * punishes taking it, and the harness lost eight more runs to it. Free and
 * half-strength, it is no loss in front and the answer when surrounded.
 * Everything else is free: it changes what a cast does, not how many there are.
 */
export function affixCostMult(id: string, tier: number): number {
  const t = Math.max(1, Math.min(3, tier));
  return id === "repeat" ? 1 + 0.35 * t : 1;
}

/*
 * The melee build's affix. A spell with it is cast by the **sword**: every
 * few connecting hits, free, at the body just struck. It is what turns a
 * spell into part of the combo rather than a second thing to press, and the
 * reason a player who lives in sword range has a build at all.
 */
BASE_AFFIXES.push({
  id: "resonance",
  name: "Resonance",
  hook: "swing",
  shapes: [...SPELL_SHAPES],
  element: null,
  tiers: [
    { effect: { kind: "resonate", every: 5 }, text: "every fifth sword hit casts it" },
    { effect: { kind: "resonate", every: 4 }, text: "every fourth sword hit casts it" },
    { effect: { kind: "resonate", every: 3 }, text: "every third sword hit casts it" },
  ],
  description:
    "The sword casts this spell for you: every few connecting hits, free, at the "
    + "body struck. Turns a spell into part of the combo.",
});

export const AFFIX_TIERS = 3;

export function spellAffixById(id: string): SpellAffix | null {
  return SPELL_AFFIXES.find((a) => a.id === id) ?? null;
}

/** The shape an attack item casts as; a projectile unless it says otherwise. */
export function itemShape(item: Pick<BaseItem, "params"> | null | undefined): SpellShape {
  const s = item?.params["shape"];
  return typeof s === "string" && (SPELL_SHAPES as readonly string[]).includes(s) ? (s as SpellShape) : "bolt";
}

/** Whether this affix does anything on a spell of this shape. */
export function affixFits(affix: SpellAffix, shape: SpellShape): boolean {
  return affix.shapes.includes(shape);
}

/** What the card and the staff screen say about where an affix goes. */
export function affixFitsLine(affix: SpellAffix): string {
  if (affix.shapes.length >= SPELL_SHAPES.length) return "fits any spell";
  return `fits ${affix.shapes.join(", ")}`;
}

/** The icon frame an affix's card and slot are drawn with. */
export function spellAffixIcon(a: SpellAffix): string {
  return `icon_affix_${a.id}`;
}

/**
 * The magnitude of a tier, used only to assert that the ladder climbs.
 *
 * Every effect carries exactly one number that means "more of this", and
 * returning it here is what lets a test prove tier 3 beats tier 1 without
 * knowing what any particular effect does.
 */
export function spellAffixMagnitude(e: AffixEffect): number {
  switch (e.kind) {
    case "split": return e.count;
    case "arc": return e.jumps;
    case "field": return e.radiusPx * e.durationMs;
    case "burst": return e.radiusPx;
    case "mark": return e.radiusPx;
    case "repeat": return e.extra;
    case "spread": return e.dirs;
    case "refund": return e.fraction;
    case "ward": return e.shots;
    case "riposte": return e.targets;
    case "resonate": return 1 / e.every;
    case "shape": return (e.pierce ?? 0) + (e.homing ?? 0) + (e.bounce ?? 0) + (e.damage ?? 0) + (e.power ?? 0);
    case "haste": return e.fraction;
  }
}
