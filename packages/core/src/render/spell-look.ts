/**
 * **What a spell looks like**: its shape and its light, per attack item.
 *
 * Element alone gives a colour and no more, which left the five unelemented
 * attacks as one cyan dot at five sizes — a player cannot learn which key
 * they pressed from that. This is the per-spell layer on top: its own core
 * and glow, and a `shape` the renderer draws differently.
 *
 * It lives in core rather than in the play scene because **the simulation now
 * has to answer questions about it**. The `chain` affix releases a copy of
 * the spell that made it, and "a copy of the same spell" is a claim about
 * identity — the same shape, the same element, the same light — which is a
 * claim a test has to be able to check without a browser. A table that only
 * the renderer can read is a claim nobody can check.
 */
import type { Element } from "../types.ts";

export type ProjectileShape =
  | "dart" | "lightning" | "orb" | "needle" | "spike" | "flame" | "glob"
  | "rock" | "pellet" | "spark" | "blade" | "bubbles"
  /*
   * The shapes of doc 006's newer options. A charged shot whose look grows
   * with the charge it left at; a bolt carrying a mark; an orb of ice whose
   * shards are drawn as its own splinters; a slow ball of current; a thrown
   * sword; a crescent wave off a swing.
   */
  | "cannon" | "sigil" | "frost_orb" | "ball" | "edge" | "crescent";

export interface SpellLook {
  readonly core: number;
  readonly glow: number;
  readonly shape: ProjectileShape;
}

/**
 * Doc 008 keeps player bullets more than 90 degrees of hue from the enemy
 * magenta. Fire is the one element that cannot honour that literally — a red
 * fire is unreadable as fire — so it is pushed to amber, about 70 degrees
 * away, and only the glow carries it; the sprite itself stays pale.
 */
export const ELEMENT_TINT: Readonly<Record<Element, { core: number; glow: number }>> = {
  none: { core: 0xe4faff, glow: 0x4fd2ff },
  fire: { core: 0xfff1c0, glow: 0xffc44a },
  ice: { core: 0xf2fbff, glow: 0x8fdcff },
  poison: { core: 0xe8ffd4, glow: 0x6fdc5a },
};

/**
 * Every shape is drawn in code (`game/src/scenes/projectiles.ts`): a round
 * sprite in a tint made a needle, a spit and a dart the same ball.
 * `lightning` is a bolt along the shot's recent path, which no sprite can
 * carry, because its length changes every frame and an arc between two bodies
 * is a different line each time.
 */
export const SPELL_LOOK: Readonly<Record<string, SpellLook>> = {
  magic_bolt: { core: 0xe4faff, glow: 0x4fd2ff, shape: "dart" },
  shock_arc: { core: 0xffffff, glow: 0x9ad2ff, shape: "lightning" },
  arc_lance: { core: 0xffffff, glow: 0x7fb4ff, shape: "lightning" },
  spark_spray: { core: 0xfff6d6, glow: 0xffd45e, shape: "spark" },
  scatter_shot: { core: 0xffeccc, glow: 0xffa94f, shape: "pellet" },
  stone_shard: { core: 0xe9dcc4, glow: 0xb08a58, shape: "rock" },
  ember_dart: { core: 0xfff1c0, glow: 0xff8a3a, shape: "flame" },
  frost_needle: { core: 0xf2fbff, glow: 0x7fd0ff, shape: "needle" },
  venom_spit: { core: 0xe8ffd4, glow: 0x6fdc5a, shape: "glob" },
  glacier_spike: { core: 0xf2fbff, glow: 0x7fd0ff, shape: "spike" },
  void_orb: { core: 0xd9c6ff, glow: 0x7a4fd6, shape: "orb" },
  plague_bloom: { core: 0xe8ffd4, glow: 0x6fdc5a, shape: "bubbles" },
  cinder_burst: { core: 0xfff1c0, glow: 0xff8a3a, shape: "flame" },
  spirit_blades: { core: 0xf4f0ff, glow: 0xb9a7ff, shape: "blade" },
  spirit_ally: { core: 0xe6fff4, glow: 0x7fe8c0, shape: "dart" },
  mana_darts: { core: 0xeee4ff, glow: 0x9b7bff, shape: "dart" },
  arcane_cannon: { core: 0xe6e8ff, glow: 0x7462ff, shape: "cannon" },
  doom_sigil: { core: 0xe2d0ff, glow: 0x7a4fd6, shape: "sigil" },
  frozen_orb: { core: 0xf2fbff, glow: 0x7fd0ff, shape: "frost_orb" },
  contagion: { core: 0xe8ffd4, glow: 0x4fbf3a, shape: "glob" },
  ball_lightning: { core: 0xffffff, glow: 0x9ad2ff, shape: "ball" },
  returning_edge: { core: 0xe6fff4, glow: 0x7fe8c0, shape: "edge" },
  serpent_fang: { core: 0xecffd8, glow: 0x5fd64a, shape: "edge" },
  storm_totem: { core: 0xfffbe0, glow: 0xffe066, shape: "ball" },
  blade_storm: { core: 0xf4f0ff, glow: 0xb9a7ff, shape: "blade" },
  whirlwind: { core: 0xf4f0ff, glow: 0xb9a7ff, shape: "blade" },
  blade_recall: { core: 0xf4f0ff, glow: 0xb9a7ff, shape: "blade" },
  blade_rift: { core: 0xf0fffb, glow: 0x9ff0e0, shape: "blade" },
  mortar: { core: 0xe9dcc4, glow: 0xb08a58, shape: "rock" },
  void_ray: { core: 0xe2d0ff, glow: 0x7a4fd6, shape: "orb" },
  crescent_edge: { core: 0xf4f0ff, glow: 0xb9a7ff, shape: "crescent" },
  /*
   * Two spirit spells that throw no shot, given a light of their own for
   * what the renderer draws of them: a guard's shaft and its answering spin,
   * and a dash's cut when an affix casts it free. The shape is only a
   * fallback; neither flies.
   */
  counter_stance: { core: 0xf0fffb, glow: 0x9ff0e0, shape: "blade" },
  blink_strike: { core: 0xf0fffb, glow: 0x8fe8d8, shape: "dart" },
  // The run's wake is drawn as standing edges in this light (`drawShockwaves`).
  dash_slash: { core: 0xffffff, glow: 0xc3d2ee, shape: "blade" },
};

/** A shot with no spell of its own takes its element's shape. */
export const ELEMENT_SHAPE: Readonly<Record<Element, ProjectileShape>> = {
  none: "dart", fire: "flame", ice: "needle", poison: "glob",
};

/** The look for a shot: its spell's if it has one, else its element's. */
export function spellLookOf(base: string | null, element: Element): SpellLook {
  const named = base ? SPELL_LOOK[base] : undefined;
  if (named) return named;
  const t = ELEMENT_TINT[element] ?? ELEMENT_TINT.none;
  return { core: t.core, glow: t.glow, shape: ELEMENT_SHAPE[element] ?? "dart" };
}

/**
 * **Sword energy takes its element's colour** (Crescent Edge's waves, Dash
 * Slash's blade and wake). A spell's own look wins over its element for a
 * shot, because a shot's shape already says which spell it is; a wave of
 * sword energy is the same crescent or the same edge whatever carries it, so
 * the colour is the one thing that can say it burns, freezes or poisons.
 * Plain, it keeps the spell's own light.
 */
export const ENERGY_TINT: Readonly<Record<Exclude<Element, "none">, { core: number; glow: number }>> = {
  fire: { core: 0xfff0c0, glow: 0xff7a2a },
  ice: { core: 0xf0fcff, glow: 0x4fc3ff },
  poison: { core: 0xecffd8, glow: 0x5fd64a },
};

/**
 * **Every element sword energy carries, in turn** — fire, ice, poison, the
 * ones with any power — or `["none"]` for plain. Several are shown by taking
 * turns, one colour to a wave or a stretch of a wake, all equally: a blend
 * of two lights is a third that is neither (fire and ice made grey), and one
 * wave in two colours read as neither. Equal turns rather than by strength,
 * because what each is worth is the hit's to say, not the colour's.
 */
export function energyElements(powers: Readonly<Partial<Record<"fire" | "ice" | "poison", number>>> | null | undefined, fallback: Element | string = "none"): string[] {
  const out = (["fire", "ice", "poison"] as const).filter((el) => (powers?.[el] ?? 0) > 0);
  if (out.length > 0) return out;
  return [fallback === "fire" || fallback === "ice" || fallback === "poison" ? fallback : "none"];
}

/** The element whose turn it is, for the `turn`th wave or stripe. */
export function energyTurn(elements: readonly string[], turn: number): string {
  return elements[((Math.floor(turn) % elements.length) + elements.length) % elements.length] ?? "none";
}

/** How many of a wake's stretches wear one colour before the next takes its turn. */
export const WAKE_STRIPE = 3;

export function swordEnergyLook(base: string | null, element: Element | string): SpellLook {
  const own = spellLookOf(base, "none");
  const t = element === "fire" || element === "ice" || element === "poison" ? ENERGY_TINT[element] : null;
  return t ? { ...own, core: t.core, glow: t.glow } : own;
}

/** The shape a shot of this spell is drawn as. */
export function spellShapeOf(base: string | null, element: Element): ProjectileShape {
  return spellLookOf(base, element).shape;
}
