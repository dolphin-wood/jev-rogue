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
 * Each one is a place the simulation already reaches, and `fireUnit` with an
 * origin is the primitive that fires the spell at a position. Nothing here
 * needs a new kind of thing to exist:
 *
 * | hook | where it fires |
 * |---|---|
 * | `hit` | a player projectile overlaps a body |
 * | `expire` | a projectile's lifetime ends |
 * | `wall` | a projectile stops on geometry |
 * | `kill` | a body a projectile hit reaches zero hp |
 * | `cast` | the spell is fired |
 * | `hurt` | the player takes a hit |
 * | `dash` | the player dashes through a body |
 * | `swing` | the sword connects |
 *
 * ### Two things are called "affix" in this repository
 *
 * They are different and the names here are deliberate:
 *
 * - **`SPELL_AFFIXES`, this file.** Doc 013's affixes: three per spell, event
 *   changing, one fixed effect each. What a reward card offers.
 * - **`AFFIXES` in `encounters/affixes.ts`** — *elite affixes*, which modify
 *   an enemy. Unrelated.
 *
 * ### One effect each, and a strength
 *
 * Doc 013 gave every affix three tiers that a duplicate climbed. They were
 * taken out: an affix is one fixed effect — what was its first tier — and the
 * only grade it has is its **strength** (`minStrength`, I to III), which says
 * how strong a kind of affix it is and so which doors deal it. A strength is a
 * difference between affixes, not a ladder inside one, so an affix already on
 * a key is not dealt to that key again.
 */
import type { BaseItem, Element } from "../types.ts";

/**
 * The shapes a spell can have; see `fireUnit` in `sim/cast.ts` and doc 013,
 * "Spell shapes". An affix names the shapes it works on, because a hook is
 * only reachable from some of them: a bolt hits, expires and meets walls, a
 * field does none of those, and a card that attaches to a field and does
 * nothing is a lie told in the reward screen.
 *
 * `eruption` is the ground going off in cells (`stepEruptions` in
 * `sim/world.ts`): it hurts and fills element gauges, and fires none of the
 * projectile hooks — no hit, kill, expire or wall event — so only the affixes
 * that act at the cast or through the element gauges list it.
 *
 * The five newer shapes (doc 006) sort the same way, by what the simulation
 * actually fires on them:
 *
 * - A `boomerang` is a projectile that hits (twice a body) and kills, but is
 *   caught rather than running out and turns on a wall rather than stopping
 *   on one, and it already passes through everything — so the hit and kill
 *   affixes list it, and the expire, wall and pierce ones do not.
 * - An `orb` strikes: each strike is a hit and can kill, so the hit and kill
 *   affixes list it. The orb itself is no projectile and never runs out on a
 *   body or a wall.
 * - An `enchant`'s waves are projectiles that pass through every body and
 *   run out at their reach, so the hit, kill and expire affixes list it.
 * - A `trail` and a `stance` put no projectile into the world at all — a
 *   trail is ground, a stance's answer is a cut round the caster — so only
 *   the affixes that act at the cast, through the element gauges, or by
 *   casting the spell free list them.
 */
export type SpellShape =
  | "bolt" | "orbit" | "field" | "pillar" | "dash" | "vortex" | "summon" | "eruption"
  | "boomerang" | "orb" | "trail" | "enchant" | "stance";
export const SPELL_SHAPES: readonly SpellShape[] = [
  "bolt", "orbit", "field", "pillar", "dash", "vortex", "summon", "eruption",
  "boomerang", "orb", "trail", "enchant", "stance",
];

/**
 * The shapes whose projectiles hit and kill: where `chain`, `brand`,
 * `harvest`, `echo` and `haste` do something. See `SpellShape`.
 */
const HITTING: readonly SpellShape[] = ["bolt", "orbit", "boomerang", "orb", "enchant"];

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
  | { readonly kind: "haste"; readonly fraction: number }
  /** Each body a run's cut goes through carries the run on `px` further, `times` at most. */
  | { readonly kind: "momentum"; readonly px: number; readonly times: number }
  /** A run's wake draws bodies in to the run's line, at `pull` of its shove, instead of throwing them off. */
  | { readonly kind: "undertow"; readonly pull: number }
  /** A run ends by throwing its cut on ahead: a crescent at `share` of the cut, out `reachPx`. */
  | { readonly kind: "finale"; readonly share: number; readonly reachPx: number };

export interface SpellAffix {
  readonly id: string;
  readonly name: string;
  readonly hook: AffixHook;
  /**
   * The spell shapes this affix does something on. Decided by where the hook
   * fires: `hit`, `kill` and `expire` need a projectile (a bolt or an orbiting
   * blade), `wall` needs one that flies, `cast` needs a cast that placing in
   * more directions or firing again changes. `hurt`, `dash` and `swing` fire
   * the spell *at* a body, and every shape has an answer to that (`fireUnit`,
   * cast with an origin). An eruption fires no projectile hook; see
   * `SpellShape`. `affix-shapes.test.ts` casts every affix on every shape it
   * lists and fails on any that does nothing there.
   */
  readonly shapes: readonly SpellShape[];
  /**
   * The element this affix colours its effect with, or null to inherit the
   * spell's. An affix is not an element source in its own right — doc 013 puts
   * element on the spell — but a field or a burst has to be *some* element to
   * resolve, and inheriting is almost always right.
   */
  readonly element: Element | null;
  /**
   * **Its strength** (`affixStrengthFloor`), I to III; absent is I. It is the
   * affix's own grade — what its card says — and the least strength of door
   * that deals it, so an affix that multiplies what a press is worth waits for
   * the doors late in the run.
   */
  readonly minStrength?: 1 | 2 | 3;
  /** What it does: one fixed effect. */
  readonly effect: AffixEffect;
  /** What the card says it does. One clause, no numbers the icon shows. */
  readonly text: string;
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
    effect: { kind: "split", count: 2 },
    text: "splits in two on impact",
    description:
      "Impact breaks the projectile into shards that carry on forward.",
  },
  {
    id: "chain",
    name: "Chain",
    hook: "hit",
    /*
     * **Only what is thrown.** A lesser copy is a thing that flies to the next
     * body, and on a bolt, a boomerang or an orb's strike that is the spell
     * again. On a ring of blades at the caster or a wave of sword energy it
     * was neither: each hit spat a small homing shot drawn as a blade or a
     * crescent, a projectile the spell does not have.
     */
    shapes: ["bolt", "boomerang", "orb"],
    element: null,
    effect: { kind: "arc", jumps: 1, rangePx: 120 },
    text: "releases a lesser copy of itself at one more body",
    /*
     * **A copy of the spell, not an arc.** The effect used to be one generic
     * white streak whatever it was attached to, so the affix read the same on
     * all twelve attacks and told the player nothing about their own build.
     * What it releases now is the spell itself again — the same shape, the
     * same element, the same light — smaller and weaker, at the next body.
     */
    description:
      "The hit releases a smaller copy of the spell, doing less damage, at the "
      + "next body nearby.",
  },
  {
    id: "brand",
    name: "Brand",
    hook: "hit",
    shapes: [...HITTING],
    element: null,
    effect: { kind: "mark", radiusPx: 32 },
    text: "a second hit detonates the mark",
    description:
      "The first hit marks the body; the next hit on it sets the mark off in a "
      + "burst that hits the bodies round it.",
  },
  {
    id: "harvest",
    name: "Harvest",
    hook: "kill",
    shapes: [...HITTING],
    element: null,
    effect: { kind: "burst", radiusPx: 44 },
    text: "kills burst",
    description:
      "A body killed by this spell bursts where it falls, hitting the bodies "
      + "round it.",
  },
  {
    id: "bloom",
    name: "Bloom",
    hook: "expire",
    /*
     * Where a shot lands or a ring of blades winds down. Not an enchant: its
     * wave runs out in the air at its reach, four times a second while the
     * sword swings, so every swing set a patch of floor alight at arm's
     * length and a held key carpeted the room — ground that no shot landed on.
     */
    shapes: ["bolt", "orbit"],
    element: null,
    effect: { kind: "field", radiusPx: 36, durationMs: 1400 },
    text: "leaves burning ground",
    description:
      "Where the shot runs out, hit or miss, the ground catches fire for a "
      + "moment and burns what stands in it.",
  },
  {
    id: "shatter",
    name: "Shatter",
    hook: "wall",
    shapes: ["bolt"],
    element: null,
    effect: { kind: "split", count: 3 },
    text: "breaks into three on a wall",
    description:
      "A projectile that stops on a wall or a prop breaks into shards there, "
      + "which fly on into the room.",
  },
  {
    id: "repeat",
    name: "Repeat",
    hook: "cast",
    /*
     * An echo is a whole cast again, so an eruption erupts again and a
     * boomerang is thrown again. Not an orb: a key keeps its cap of orbs up
     * already, and an echo's orb only replaces one of them. Not a trail, an
     * enchant or a stance: an echo renews what the press just started.
     */
    shapes: ["bolt", "eruption", "boomerang"],
    element: null,
    effect: { kind: "repeat", extra: 1 },
    text: "casts again a beat later",
    description:
      "The spell casts again a beat after the press, aimed where the caster is "
      + "facing by then.",
  },
  {
    id: "scatter",
    name: "Scatter",
    hook: "cast",
    /*
     * Every shape whose side casts land somewhere new. A side cast is the
     * spell's real shape aimed along another direction (`freeCastReach`):
     * more shots, more patches, more pulls, more cuts round the caster, more
     * ground going off. Not an orbit or a summon: those renew the one ring
     * or the one companion the key keeps, so three more casts of either are
     * the same ring and the same companion — measured, nothing changes.
     * A boomerang thrown to the sides is more blades; an orb to the sides is
     * one of the key's capped orbs moved, and a trail, an enchant or a stance
     * is on the caster, so a side cast renews the one already running.
     */
    shapes: ["bolt", "field", "pillar", "vortex", "dash", "eruption", "boomerang"],
    element: null,
    effect: { kind: "spread", dirs: 1 },
    text: "also casts behind you",
    description:
      "The cast also goes out behind the caster, beside the one sent forward.",
  },
  {
    id: "ward",
    name: "Ward",
    hook: "cast",
    shapes: [...SPELL_SHAPES],
    element: null,
    effect: { kind: "ward", shots: 1 },
    text: "leaves a rune that eats one shot",
    description:
      "Casting leaves a rune where the caster stood that stops enemy shots "
      + "reaching it, a few at most, for a short while.",
  },
  {
    id: "retort",
    name: "Retort",
    hook: "hurt",
    // Every shape: a free cast is the spell's own shape at the body (`fireUnit`).
    shapes: [...SPELL_SHAPES],
    element: null,
    effect: { kind: "riposte", targets: 1 },
    text: "being hit fires back",
    description:
      "Taking a hit casts this spell at whatever dealt it, free.",
  },
  {
    id: "slipstream",
    name: "Slipstream",
    hook: "dash",
    // Every shape: a free cast is the spell's own shape at the body (`fireUnit`).
    shapes: [...SPELL_SHAPES],
    element: null,
    effect: { kind: "riposte", targets: 1 },
    text: "dashing through a body casts",
    description:
      "Dashing through a body casts this spell at it, free.",
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
/** The one sentence all three element affixes end with; see `STATUS_BREADTH_MULT`. */
const BREADTH = " A body carrying two different elements takes more from every hit.";

BASE_AFFIXES.push(
  {
    id: "pierce", name: "Pierce", hook: "cast", shapes: ["bolt"], element: null,
    effect: { kind: "shape", pierce: 1 },
    text: "passes through one body",
    description: "The shot keeps going through the bodies it hits.",
  },
  {
    id: "seek", name: "Seek", hook: "cast", shapes: ["bolt"], element: null,
    effect: { kind: "shape", homing: 0.8 },
    text: "hunts bodies down",
    description: "The shot turns toward the nearest body as it flies.",
  },
  {
    id: "ricochet", name: "Ricochet", hook: "wall", shapes: ["bolt"], element: null,
    effect: { kind: "shape", bounce: 1 },
    text: "bounces once off walls",
    description: "The shot bounces off walls back into the room instead of stopping.",
  },
  {
    id: "kindle", name: "Kindle", hook: "cast", shapes: [...SPELL_SHAPES], element: "fire",
    effect: { kind: "shape", element: "fire", power: 0.9 },
    text: "burns what it hits",
    description: "The spell's hits fill the burn gauge, on top of whatever element it already carries." + BREADTH,
  },
  {
    id: "rime", name: "Rime", hook: "cast", shapes: [...SPELL_SHAPES], element: "ice",
    effect: { kind: "shape", element: "ice", power: 0.9 },
    text: "chills what it hits",
    description: "The spell's hits slow a body and fill its chill gauge toward a freeze, alongside any element it carries; a frozen body's next hit lands for triple." + BREADTH,
  },
  {
    id: "blight", name: "Blight", hook: "cast", shapes: [...SPELL_SHAPES], element: "poison",
    effect: { kind: "shape", element: "poison", power: 0.9 },
    text: "poisons what it hits",
    description: "The spell's hits fill the poison gauge, alongside any element it already carries; a poisoned body loses health over time." + BREADTH,
  },
  {
    id: "haste", name: "Haste", hook: "kill", shapes: [...HITTING], element: null,
    effect: { kind: "haste", fraction: 0.5 },
    text: "a kill halves the cooldown",
    description: "A kill with this spell takes half of its cooldown off.",
  },
);

export const SPELL_AFFIXES: readonly SpellAffix[] = BASE_AFFIXES;

/**
 * What an affix does to its spell's **mana cost**.
 *
 * ### One rule: an affix that multiplies the hits pays for them
 *
 * `fork`, `chain`, `scatter`, `pierce` and `repeat` all answer one press with
 * more damage events than the press bought — a shard per body, a copy at the
 * next body, a cast to each side, a body further down the line, the whole cast
 * again. They pay `AFFIX_SURCHARGE` for it, multiplied together, so
 * stacking two of them costs like stacking two of them: fork and repeat on
 * one spell cost about a third more than the bare cast, which is the shape
 * the user asked for: the build still happens, and the bar decides how often.
 *
 * `repeat` used to be the only one that paid, at 35% a tier, and it paid alone
 * because it was the only affix that added whole *casts*. That was the wrong
 * line: a fork at tier three turns one hit into four and a chain at tier three
 * reaches three more bodies, and neither cost anything. Folded into this rule,
 * `repeat` is charged the same 15% as the rest (the one tier each has now).
 *
 * ### And an affix that only changes a shot's path pays nothing
 *
 * `seek`, `ricochet`, the element affixes, `brand`, `harvest`, `haste`, `ward`,
 * `echo`, `bloom`, `retort`, `slipstream`, `resonance`, `shatter` — none of
 * them multiplies what a press is worth against what is in front of the
 * player, and several are defensive.
 *
 * **`seek`'s surcharge was removed on purpose and does not come back.** It used
 * to charge 25% a tier for "accuracy", and measured at **0.56 of the bare
 * bolt** on a dummy the shot was already aimed at: three quarters more mana on
 * a spell the mana bar rations is a quarter fewer casts, and homing buys
 * nothing against something standing still. So the card the player took to stop
 * missing made them do half the damage. Accuracy is paid for with the affix
 * slot, which is the scarcest thing a spell has; charging mana on top charged
 * twice.
 *
 * `shatter` is left free although it splits: it only fires on a *miss*, so
 * charging it would be charging the player for hitting the wall.
 *
 * ### Except the ones that only pay on a crowd
 *
 * `chain`, `scatter` and `pierce` were charged with the rest and measured at
 * **0.67 of the bare bolt** on one body: they add nothing to a lone target, so
 * the surcharge was all they did there — a card that is a loss in front of the
 * player at an elite. Their payoff is the pack, which is the build the user
 * wants to feel enormous, and the proc weights already stop them multiplying
 * the element gauges. So they are free, and only the two that multiply what
 * one press does to **one** body pay: `fork` (a shard per hit) and `repeat`
 * (the whole cast again). The sections above still describe why those two pay.
 */
/** What an affix that multiplies the hits adds to its spell's mana: one tier's worth of the old ladder. */
export const AFFIX_SURCHARGE = 0.15;

/**
 * The affixes that multiply how many times one press lands, and so pay
 * `AFFIX_SURCHARGE` for the privilege. The card says so
 * (`affixSurchargeText`), because a cost the player only meets at the mana bar
 * is a cost they were not offered.
 */
export const COUNT_AFFIXES: readonly string[] = ["fork", "repeat"];

export function affixCostMult(id: string): number {
  return COUNT_AFFIXES.includes(id) ? 1 + AFFIX_SURCHARGE : 1;
}

/**
 * What the card says the affix adds to the spell's mana, at this tier — or
 * null for an affix that adds nothing, which says nothing rather than "+0%".
 *
 * The percentage rather than the multiplier, because the card is attached to
 * an affix and not yet to a spell: what a slotted spell will actually cost is
 * `slotCost`, and a reward screen that knows which spell the card would go on
 * prints that figure too.
 */
export function affixSurchargePct(id: string): number | null {
  const mult = affixCostMult(id);
  return mult === 1 ? null : Math.round((mult - 1) * 100);
}

/** The same, as the one clause a card appends to its line. */
export function affixSurchargeText(id: string): string | null {
  const pct = affixSurchargePct(id);
  return pct === null ? null : `+${pct}% mana cost`;
}

/** The identifier a renderer looks that clause up by. */
export const AFFIX_SURCHARGE_KEY = "affix.surcharge";

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
  /*
   * Every shape. A cast from the sword is the spell's own shape aimed at the
   * body struck (`fireUnit`): a line of ground toward it, a pull or a patch
   * under it, a cut at it, the ring of blades or the companion renewed at
   * the caster. It used to leave as a projectile whatever the spell was,
   * which for every shape with no speed was a bolt standing still at the
   * player's feet — on Spirit Blades, the style's own starter, five of them
   * and no damage — so it was kept off the eruptions and quietly broken on
   * the rest.
   *
   * **Every shape but the stance.** A stance forbids the swing for as long as
   * it holds (doc 006), so a sword hit that raised one would switch off the
   * very hits the affix counts: the sword stops, and the card is a way to
   * lose the sword for a second rather than a guard.   *
   * **Nor the enchant.** A sword hit that casts the sword's own enchant
   * renews it: every few hits it was up again for nothing, so the waves ran
   * for the whole fight free and the key was pressed once.
   */
  shapes: SPELL_SHAPES.filter((s) => s !== "stance" && s !== "enchant"),
  element: null,
  effect: { kind: "resonate", every: 5 },
  text: "every fifth sword hit casts it",
  description:
    "The sword casts this spell: every few connecting hits, free, at the body "
    + "struck.",
});

/*
 * **The run's own affixes** (Dash Slash). A spell that runs the caster
 * through a pack with its wake coming off either side had only the affixes
 * every spell takes — an element, a rune, a free cast — and none that
 * changed the run. These three do: how far it goes, where the bodies it
 * leaves end up, and what it does when it stops. Each needs a wake
 * (`affixFitsSpell`), so they are dealt only to a key that has one.
 */
BASE_AFFIXES.push(
  {
    id: "momentum",
    name: "Momentum",
    // Read once at the cast into the run's figures (`runAffixes`), not by a projectile's hook.
    hook: "cast",
    shapes: ["dash"],
    element: null,
    effect: { kind: "momentum", px: 18, times: 3 },
    text: "each body cut carries the run on",
    description:
      "Every body the run cuts carries it on a little further, so a run into a pack goes deeper; up to three.",
  },
  {
    id: "undertow",
    name: "Undertow",
    hook: "cast",
    shapes: ["dash"],
    element: null,
    effect: { kind: "undertow", pull: 0.6 },
    text: "the wake draws bodies in",
    description:
      "The wake draws the bodies it cuts in toward the run's line instead of throwing them off, and the run only "
      + "nudges what it passes: the pack is left in a line.",
  },
  {
    id: "finale",
    name: "Finale",
    // Read once at the cast into the run's figures (`runAffixes`), not by a projectile's hook.
    hook: "cast",
    shapes: ["dash"],
    element: null,
    effect: { kind: "finale", share: 0.6, reachPx: 72 },
    text: "the run ends in a thrown cut",
    description:
      "Where the run stops, its cut is thrown on ahead as a crescent of sword energy that passes through each "
      + "body in its reach.",
  },
);

/** The affixes that change a run, and need its wake to mean anything. */
const RUN_AFFIXES: ReadonlySet<string> = new Set(["momentum", "undertow", "finale"]);

/*
 * **The strength each affix waits for.** Measured on the bench (`pnpm
 * spell-bench`, the affix loadouts on the bolt): `repeat` doubles what a key
 * does to one body for a fifth more mana and tops most spells' best build, so
 * it is a strength-III door's alone; the affixes that reach more bodies, turn
 * a kill or a hit into more, or change what a spell does wait for II; the
 * rest — defences, aim, elements — are dealt from the first room.
 */
const STRENGTH_FLOOR: Readonly<Record<string, 2 | 3>> = {
  repeat: 3,
  chain: 2, brand: 2, scatter: 2, haste: 2, resonance: 2, fork: 2,
  momentum: 2, undertow: 2, finale: 2,
};
for (const a of BASE_AFFIXES) {
  const floor = STRENGTH_FLOOR[a.id];
  if (floor) (a as { minStrength?: 1 | 2 | 3 }).minStrength = floor;
}

/** The least door strength that deals this affix; 1 for any door. */
export function affixStrengthFloor(id: string): 1 | 2 | 3 {
  return spellAffixById(id)?.minStrength ?? 1;
}


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

/**
 * Whether an affix may go on this spell alongside the affixes it holds: its
 * shape, and two rules about spread and homing. **A spread does not home** —
 * a fan of shots that all bend onto one body is every shot of the fan on
 * that body, which made every scatter spell a single heavy bolt that never
 * missed — so `seek` does not go on a spell that fires several shots, nor
 * with `scatter`, and `scatter` not with `seek`.
 */
/** A spell's own `seek` from which the affix's turn adds nothing. */
const STRONG_SEEK = 250;
/** A spell's own `pierce` that is every body in its path. */
const PIERCES_ALL = 99;

export function affixFitsSpell(affix: SpellAffix, item: Pick<BaseItem, "params"> | null | undefined, held: readonly string[]): boolean {
  if (!affixFits(affix, itemShape(item))) return false;
  const count = Number(item?.params["count"] ?? 1);
  if (affix.id === "seek" && (count > 1 || held.includes("scatter"))) return false;
  if (affix.id === "scatter" && held.includes("seek")) return false;
  /*
   * **And a spell that already goes out all round cannot also be cast to all
   * sides.** Frost Nova throws eleven shards across 330 degrees; `scatter` at
   * tier three casts it in six directions, which is sixty-six shards for one
   * press and free, and it measured at nearly five times the sword where the
   * next best build was one and a half. A ring is already the answer to being
   * surrounded — that is the card's own promise — so the two are the same
   * card twice.
   */
  if (affix.id === "scatter" && Number(item?.params["spread"] ?? 0) >= 180) return false;
  /*
   * **Nor a run with a wake** (Dash Slash). A dash's side cast is its cut
   * at a point in that direction with the caster left where they are — so
   * "also behind you" on a Dash Slash was a cut behind with no run and no
   * wake, the one part of the spell it is for. Its wake is already its
   * answer to the sides.
   */
  if (affix.id === "scatter" && Number(item?.params["wake_reach"] ?? 0) > 0) return false;
  // And for the same reason no `slipstream`: a dash through a body cast it as that cut at the body, and nothing more.
  if (affix.id === "slipstream" && Number(item?.params["wake_reach"] ?? 0) > 0) return false;
  /*
   * **An affix a spell already is, is no affix.** Each of these was a pick
   * that changed nothing and took a slot:
   * - `seek` on a shot that already steers hard (Shock Arc, Arc Lance, Mana
   *   Darts): the affix's turn is below the spell's own.
   * - `pierce` on a shot that already passes through everything (Fault Line,
   *   Frozen Orb).
   * - `fork` on a spell that already goes out all round (Frost Nova), for
   *   the reason `scatter` is kept off it: eleven shards split three ways.
   */
  if (RUN_AFFIXES.has(affix.id) && Number(item?.params["wake_reach"] ?? 0) <= 0) return false;
  if (affix.id === "seek" && Number(item?.params["seek"] ?? 0) >= STRONG_SEEK) return false;
  if (affix.id === "pierce" && Number(item?.params["pierce"] ?? 0) >= PIERCES_ALL) return false;
  if (affix.id === "fork" && Number(item?.params["spread"] ?? 0) >= 180) return false;
  return true;
}

/** What the card and the staff screen say about where an affix goes. */
export function affixFitsLine(affix: SpellAffix): string {
  return affixFitsPart(affix).text;
}

/**
 * The same line with the identifier a renderer translates it through. The
 * shapes travel as their ids, comma-separated, so the renderer names each one
 * from its own table and joins them with its own punctuation.
 */
export function affixFitsPart(affix: SpellAffix): {
  readonly text: string;
  readonly key: string;
  readonly args?: Readonly<Record<string, string | number>>;
} {
  if (affix.shapes.length >= SPELL_SHAPES.length)
    return { text: "fits any spell", key: "affix.fitsAny" };
  return {
    text: `fits ${affix.shapes.join(", ")}`,
    key: "affix.fits",
    args: { shapes: affix.shapes.join(",") },
  };
}

/**
 * The identifier for what an affix says on a card and in a slot.
 *
 * The English lives on the affix itself (`text`), because that is what the
 * schema test and the Director read; this is the handle a renderer looks the
 * same sentence up by.
 */
export function affixTextKey(affixId: string): string {
  return `affixtier.${affixId}`;
}

/** The icon frame an affix's card and slot are drawn with. */
export function spellAffixIcon(a: SpellAffix): string {
  return `icon_affix_${a.id}`;
}

