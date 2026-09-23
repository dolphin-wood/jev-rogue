---
id: 006
title: Spells and Items
status: proposed
date: 2026-09-21
summary: The item pool behind the three keyed spells and how a cast resolves. 47 base items in four kinds; a parse into a cast tree with payload subtrees and scoped boosts; mana cost read off an item's rank, with a cooldown proportional to price; elements, damage and levels; a deterministic simulator owned by core that emits the build labels the Director reads. Item instances carry a modifier calibrated at build time. Jev never reasons about arrangements or numbers.
depends_on: [002, 010]
---

# 006 Spells and Items

## What a spell is

The player holds a sword and **three spells bound to three keys** (013). One
key is one spell: an attack item, up to three modifier items attached to it,
and up to three event affixes. A cast happens on the key's edge, costs mana and
starts that spell's own cooldown. Nothing fires on its own, and a refused cast
says why — cooldown, mana or an empty key — because the player pressed a key
and is owed an answer.

A spell parses as `[...mods, attack]`, one little sequence, so every scope rule
below applies **inside one spell**, to the attack the player attached the
modifier to.

Borrowed from Magicraft: boosts modify what follows them, passives apply to the
whole tree, payload items open nested spell groups, and mana bounds everything.
Deliberately not borrowed: secondary charge slots and item fusion.

## The run staff

`runStaff()` is a fixed record rather than a choice: 90 maximum mana, three
slots, and the reference tempo numbers. It is where the cast code and the
simulator read the pool and the slot count from, so both agree. There is no
profile to pick and no Director question about it.

90 mana, measured: 70 left half the runs dead at the boss, and 120 was no
better than 90.

## Item kinds

| Kind | Effect | Count |
|---|---|---|
| attack | projectile with damage, speed, radius, count, spread, lifetime, pierce, element, plus `seek`, `curve` and `chain` | 22 |
| boost | damage ×, speed ×, size ×, +count, +pierce, homing, bounce, split, element infusion, repeat | 15 |
| passive | mana regen, cast interval, cooldown, crit chance, thorns, lifesteal, tracking | 8 |
| payload | carrier that casts its child on hit; variants: `on_hit`, `on_expire`, `on_wall` | 5 |

Total 50 **base items**, each with `id`, `kind`, `rarity`, `tags`, numeric
params and a `description` (010). Base items keep their names and identities;
variety above common rarity comes from the modifier an instance carries.

Only an **attack** or a **payload** is castable on its own (`castableAlone`),
so only those two kinds are ever offered as a spell card. Boosts and passives
are attached to a spell the player already holds. "This spell casts twice" is a
`repeat` boost on a named spell rather than a spell of its own.

`seek`, `curve` and `chain` are what give a spell a path of its own instead of
a dot travelling in a straight line at a different speed. `seek` is degrees a
second the shot turns toward the body it was cast at, which is both the aim
assist a keyboard-only game needs and the curve the shot traces; a shot that
seeks is still a shot to line up, but it should not miss a body it was pointed
at. `curve` is degrees off the aim, alternating side per projectile, which with
`seek` is an arc out and back in. `chain` is how many bodies it arcs to after
the first, without the `chain` affix attached.

Every attack belongs to one of seven **schools** (`spells/schools.ts`), which
is what a spell portal's badge promises (003).

Three attacks fill roles the others leave open, each built from the bolt with
no shape of its own: **Frost Nova**, a short ring of ice all round the caster
(the answer to being surrounded); **Seeker Swarm**, a handful of darts that
hunt the nearest bodies (the answer to not being able to aim); and **Fault
Line**, a stone blade that pierces everything in a line (the answer to a
corridor).

**Balance is measured, not asserted by eye.** `pnpm spell-bench` casts each
attack alone on a key for twenty seconds with a run's mana and its own
cooldown, at one pinned body and at a bunched pack of six — close-range shapes
(orbit, dash, a ring) at arm's length, everything else at 150 px — and reports
sustained damage per second against the pool's median. The rule: no attack is
far above the median on both targets (overtuned) or far below it on both
(dead); a specialist is strong on one and ordinary on the other. It also runs
the affix loadouts on the plain bolt, top tier, so a pair that multiplies — as
`repeat` and `scatter` did — shows up as a number.

## Cast loop

Casting is two stages: a **parse** of the sequence into a tree, cached and
recomputed only when the arrangement changes, and **execution** of that tree.
Sharing code between the game and the simulator guarantees they agree with each
other; it does not define the rules, so the rules are stated here.

### Parse

Walk the sequence left to right, producing *units*. A unit is the thing that
occupies one cast tick.

- **attack** is a unit.
- **passive** is not a unit and is lifted out of the sequence; it applies to the
  whole tree wherever it sits.
- **boost** is not a unit; it attaches to the scope it appears in, from its
  position onward.
- **payload** consumes **the next unit** (not the next slot) as its child and
  becomes one unit containing that subtree.
- **multicast N** consumes **the next N units** and becomes one unit containing
  them. Consumption is recursive: a payload that follows a multicast resolves
  its own child first, and the resulting payload unit counts as one of the N.
  The parser and the cost rules support this; no base item is a multicast.
- If fewer units remain than a payload or multicast requires, it takes what
  exists. A payload with no child fires as a plain projectile using its carrier
  stats. A multicast with one unit behaves as that unit with no discount.
- Nesting depth is capped at 3, 1-based at the root. A subtree deeper than that
  has its innermost child dropped at parse time; the slots are still consumed,
  so they cannot resurface as root units, and they are reported in
  `droppedForDepth`.

### Scopes and boosts

The whole tree is the root scope. Each payload subtree and each multicast group
opens a nested scope. A boost applies to every attack in its own scope at a
position after it, **and** to every scope opened after it within that scope.
Boosts never escape upward.

Worked examples, on the sequence the parser sees:

`[boost_dmg, attack_a, multicast2, attack_b, attack_c]`
Two units: `attack_a`, then `multicast2{attack_b, attack_c}`. The boost is in
the root scope before both, and the multicast scope opens after it, so all
three attacks are boosted.

`[attack_a, boost_dmg, payload_onhit, attack_b, attack_c]`
Three units: `attack_a` (unboosted), `payload_onhit{attack_b}` (carrier and
`attack_b` boosted, since the payload scope opens after the boost), `attack_c`
(boosted, same root scope, later position).

`[payload_onhit, boost_dmg, attack_a, attack_b]`
`payload_onhit` takes the next unit. `boost_dmg` is not a unit, so it is
absorbed into the payload's scope and the payload's child is `attack_a`,
boosted. `attack_b` is a separate root unit and is **not** boosted, because the
boost lives in the payload's scope.

### Mana

An item's `mana` field is a **rank**, 1 to 7. A keyed cast costs
`5 + 2.5 × (rank − 1)` mana off the run staff's 90, read from the spell's
attack item alone (`slotCost`). A connecting sword hit returns 9% of the cap,
so the cheapest spell is about one and a half hits and the dearest about four:
a room entered on a full bar buys two to six casts before the sword has to earn
the next one. That ratio is the whole economy — closing to melee range is how
the player affords standing away from it.

A cost in mana rather than a share of the pool is what makes a deeper well
*more casts*, which is what a player reads a bar as.

Per-spell cooldown is `240 ms + 1300 ms × cost / 60`: a floor, plus a share
proportional to price. A key may be held, and a held key recasts the moment the
cooldown clears, so the cooldown is the cast rate. Base mana regeneration is 5%
of the cap per second — a floor under a bad fight, not an income, because if
spells were free the sword would have no job (013).

Inside the tree, which is what the simulator prices:

- An attack pays at fire time. Insufficient mana skips the unit.
- A payload pays its carrier cost **and its whole subtree's cost at fire time**,
  reserved together. Insufficient mana for the subtree fires the carrier alone.
  Deferring the child's cost to impact would make the cost depend on hit timing
  and would not be simulable.
- A boost pays its mana on every projectile-firing unit in its scope. A boost
  never occupies a tick, so nothing else in the cast loop would charge it.
- A multicast pays `sum(cost of its units, including their subtrees) × 0.8^(N−1)`
  once, at fire time; multicast items themselves cost zero, so the formula holds
  exactly. The exponent uses the *captured* count, not the declared N, which is
  what makes "one unit, no discount" fall out of the arithmetic. Stacked
  multicasts add casts, not discount: the exponent is the outermost group's.

### Timing and triggers

- The cursor advances **one unit** per `cast_interval`, so a multicast group of
  three items costs one tick, not three. Cycle time is
  `(units − 1) × cast_interval + cooldown`: the cooldown replaces the interval
  after the last unit rather than adding to it.
- A payload's child triggers **once per carrier**, on the first qualifying event
  for its variant (`on_hit`, `on_expire`, `on_wall`). A carrier with pierce that
  hits three enemies still triggers once. This single rule is what keeps payload
  chains from scaling exponentially with enemy count.
- `on_expire` and `on_wall` carriers pass through: they damage on contact but
  keep flying to their trigger, otherwise a fuse dies on its first hit and its
  child never fires.

## Elements

| Element | Rule |
|---|---|
| fire | burn 2 dmg/s for 3 s; sources stack multiplicatively (2 sources → ×2 tick) |
| poison | 1 dmg/s per stack for 4 s; stacks add linearly, no cap |
| ice | 40% slow for 2 s; does not stack, refreshes |

Fire stacking is capped at four sources, because the multiplicative rule
diverges without a cap.

## Damage

`hit = base × Π(boost multipliers in scope) × Π(passive multipliers) ×
(crit ? 2 : 1) + Σ(flat bonuses)`. The same function runs in the game and in the
simulator because both are the same code in core (009).

A spell's **level**, 1 to 3, multiplies damage by `1 + 0.4 × (level − 1)` and
changes nothing else, so a level never changes the spell's shape (013).

## Simulator

`simulateStaff(staff, slots[], items) → StaffSim` runs the cast loop for 30
simulated seconds at a fixed 60 Hz step against two targets: a stationary dummy
and a dummy moving at 120 px/s in a circle. Only the two DPS numbers come from
both runs; `cycle_time`, `scatter`, `archetype`, `bottleneck` and the rest are
single-valued and are taken from the moving run, because that is the case the
player actually faces. It uses the real projectile, collision and element code
from core, so it is the game minus rendering, input and enemies.

```ts
interface StaffSim {
  dps_stationary: number;
  dps_moving: number;
  mana_sustain: "starved" | "tight" | "comfortable";
  cycle_time: number;
  scatter: "tight" | "medium" | "wide";
  archetype: "spam" | "nuke" | "area" | "dot" | "mixed";
  bottleneck: "damage" | "cast_frequency" | "mana" | "accuracy" | "none";
  missing_roles: Role[];
  dominant_tags: string[];
}
```

Only the label fields go into Jev state. `archetype` uses exactly the vocabulary
of 010 (`nuke`, not `burst`; `mixed` for no dominant pattern). The game runs the
simulator over the spells the player holds every time it builds the Director's
context, so `build.archetype`, `build.bottleneck`, `build.mana_sustain`,
`build.missing_roles` and `preference.dominant` in the state are all the
simulator's output, not the player's self-report.

## Evaluating a candidate item

"What would this item do for the current build" is answered by **best legal
placement** (`bestLegalPlacement`), not by appending: appending is wrong for a
boost with nothing after it and undefined when every key is taken.

1. If a slot is free: try the item at every position, keep the arrangement with
   the highest `dps_moving`.
2. If every slot is taken: try replacing each one, keep the best.
3. Report the label deltas (`mana_sustain` tight → starved, `bottleneck`
   accuracy → none) between the current build and the best arrangement, at most
   two, most important first.

Those deltas are the material for 010's delta sentences.

## Base items and item instances

An affix produces an **instance**, not a new base item. Everything downstream
refers to instances: offers, inventory, keys, shop, simulator, traces and
replay.

```ts
interface ItemInstance {
  uid: string;                                 // unique within the run
  base: ItemId;                                // one of the 47 base items
  affix: AffixId | null;
  magnitude: number;                           // resolved by calibration, 0 < m ≤ 1.5
  modifier: Record<string, number> | null;     // the concrete resolved deltas actually applied
  rarity: Rarity;                              // may exceed the base item's rarity
}
```

The five instance rolls — `homing`, `cheaper`, `wider`, `heavier`, `elemental` —
are numeric modifiers applied per item kind, distinct from the event affixes a
player slots onto a spell (013). `magnitude` is a number rather than one of two
constants because calibration may scale a modifier up to three times before it
lands inside its rarity band (uncommon 1.15 to 1.35× the base value, rare 1.35
to 1.7×); a roll that cannot reach its band at any magnitude degrades to `none`.
The resolved `modifier` is stored alongside it, so the simulator, the shop and
replay read the instance rather than recomputing.

Calibration depends only on `(base, affix, starting magnitude)` and the
reference arrangements, never on what the player holds, so `resolveAffixTable()`
resolves the whole table at build time under `pnpm content:check` and the run
only looks values up. It is memoised rather than eager because it costs about
half a second of simulation and every import of an item definition would
otherwise pay it. A whole roll that degrades on every row fails the build: an
option whose effect is silently nothing must not be offered.

Two rolls are bounded by arithmetic rather than by tuning. `cheaper`'s best case
is restoring full cast uptime, so its ceiling is `1 / T₀` for base throughput
`T₀`, and reaching the rare band needs an item already running below 74%
uptime — 22 of 80 rows therefore degrade to `none`. `homing` on an item that
already hits is a guaranteed `none` by construction.

Two instances of the same base with different rolls coexist in one build.
Eligibility rules that speak of ownership and exclusivity in 007 are evaluated
on `base`, never on `uid`.

## Balance rules (harness, 011)

Rules are per kind and per legal arrangement, not universal DPS monotonicity:

- Each attack, placed alone on the run staff, must land in its rarity's DPS band.
- Each boost must raise `dps_moving` by at least 10% in *some* reference
  arrangement where an attack is to its right; it may lower DPS in others.
- Each passive must change at least one label in the reference arrangements.
- Each payload must produce a cycle that is mana-sustainable (`tight` or better)
  with common items.
- Every base item × every roll at both magnitudes stays inside its rarity band
  or degrades to `none`.

`pnpm spell-check` fires every castable item in a real room against a dummy and
asserts three things per spell: that it fires at all, that it reaches and hurts
something, and that it is distinguishable from its neighbours. Each modifier is
then attached to `magic_bolt` and compared against the bare bolt by **the
projectile's own properties at spawn**, not by damage: speed, size, pierce,
homing, bounce and element all change the shot without changing what it does to
a pinned dummy at one fixed range, so scoring by damage reports six working
modifiers as broken. The listing prints what each one changed, so a silent
regression shows up as a missing column rather than as a number nobody reads.
Damage per mana is printed and deliberately **not** asserted: a pool is meant to
have a cheap reliable option and an expensive situational one, and a band would
flatten that.

## Jev's role

Jev makes no numeric decision here. It never sees slot order, never judges
whether a boost reaches an attack, and never estimates DPS; those are the
simulator's. It consumes `StaffSim` labels when shaping rewards (007).

## Implementation notes

Settled during implementation, each covered by a test.

- **Aim is modelled with a varying lead factor**, `0.6 + 0.4·sin(2πt/1.7)`,
  whose period divides no cast interval. A constant lead makes accuracy binary
  against a dummy orbiting at fixed radius and speed: an attack either always
  hits or always misses, and then `bottleneck: "accuracy"` and the `homing` and
  `wider` rolls are unmeasurable. This is the one place the simulator models the
  caster rather than the rules.
- **Pierce is credited as expected extra targets**, `×(1 + pierce × 0.35)`,
  because there is only one dummy to pierce. It is the only damage term that is
  a proxy rather than a measurement. Bounce, split, homing and elements are
  simulated properly.
- **`Bullet.split` must be read by the game, not only by the simulator.** A
  property the simulator models and the game ignores is a divergence that shares
  the *item* without sharing the *behaviour*, which is exactly what sharing code
  between the two exists to prevent.
