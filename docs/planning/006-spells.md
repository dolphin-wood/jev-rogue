---
id: 006
title: Spells
status: accepted
date: 2026-09-25
summary: The spell pool behind the three keys. A spell is one self-contained item on one key; nothing composes with anything else, and the only things attached to a spell are doc 013's event affixes and its level. Thirty-nine spells, grouped by the five play styles, where a style is a way of using a key — Barrage a cadence, Heavy a commitment, Crowd a geometry, Affliction a time profile, Blade a range band coupled to the sword — rather than an element. Each spell is a shape (its delivery) plus parameters; the shapes and their rules, the roster, the starters, the schools, how delivery is priced, the balance gates spell-bench asserts, and the neutral-fact rule for what a spell tells Jev.
depends_on: [002, 010, 013]
---

# 006 Spells

## What a spell is

The player holds a sword and **three spells bound to three keys** (013). A key
holds exactly one spell. A spell is one item from the pool, its level (1 to 5)
and up to three event affixes (013). Nothing else attaches to it and **no spell
reads or changes another**: there are no modifiers that apply to "the next
attack", no carriers that capture a second spell, no multicasts, and no
reactions between spells or between elements. A player can predict what a key
does from that key alone.

A cast happens on the key going down, costs mana and starts that spell's own
cooldown. A refused cast says why — cooldown, mana, busy or an empty key —
because the player pressed a key and is owed an answer. A key may be held: a
held key recasts the moment its cooldown clears, except on a spell whose shape
is `charge`, where holding is the charge (below).

The run starts with **one** spell, the chosen style's starter, on the first key.
The other two keys fill from rewards.

## Styles are ways of using a key

The five styles the player picks on the intent screen (007) are defined by what
the player does with the key, not by element or colour. The games that make
archetypes feel different key them to cadence and delivery — Hades by the verb
slot, Wizard of Legend by the arcana slot, Diablo 4 by the resource rule
(`docs/research/spell-roster-survey.md`) — and colour and status come second.

| Style | Tag | The verb | The decision a key asks |
|---|---|---|---|
| Barrage | `spam` | cadence | press often, or bank it and release at once |
| Heavy | `nuke` | commitment | take a risk — a windup, a charge, a predicted landing — for one large hit |
| Crowd | `area` | geometry | make the bodies stand together or in a line, then hit all of them |
| Affliction | `dot` | time and movement | put a status on, then keep moving while it pays out |
| Blade | `melee` | range band and the sword | stay in sword reach; the spell makes the sword stronger or is set off by it |

A spell carries one or two style tags. A spell with two counts for both styles,
so each style sees eight to eleven spells in its offers while the pool holds
thirty-nine.

## Shapes

A spell's **shape** is its delivery: what appears in the world when the key is
pressed. It is a parameter on the item (`shape`), the cast dispatches on it,
and it decides which affix hooks can fire (013, "An affix fits some shapes and
not others"). Parameters listed under a shape are read only by that shape.

| Shape | What appears | Parameters beyond the common ones |
|---|---|---|
| `bolt` | projectiles from the hand | `seek`, `curve`, `chain`, `pierce`, `count`, `spread`, `weight`; optional `charges`, `charge`, `doom`, `emit`, `contagion`, `lob` (below) |
| `orbit` | bodies circling the caster; a recast renews the ring | `orbit_radius`, `spin`; optional `stack_max`, `anchor_reach` (below) |
| `field` | a patch of ground under the nearest body or ahead of the hand | `reach`; the element decides what the ground does (fire burns, poison poisons and slows, ice slows harder and chills toward a freeze) |
| `pillar` | a solid raised between the caster and what they face, with a shove as it rises | `reach` |
| `dash` | the caster thrown forward, cutting each body once, untouchable for the travel; with `land`, a leap that cuts nothing in the air and lands in a ring | optional `land` (below) |
| `vortex` | a pull under the nearest body | `reach`, `pull`; optional `collapse` (below) |
| `summon` | one companion that follows and fires on its own clock; a recast renews it | `interval`, `reach` |
| `eruption` | ground cells that burst after a beat, in a line, a scatter or a ring | `pattern` (`line`, `scatter`, `ring`), `step`, `first`, `delay_ms`, `reach`, `area`, `burn_ms`; optional `telegraph_ms` (below) |
| `boomerang` | a thrown blade that flies out, slows, and returns to the caster | `reach`, `return_speed`; optional `lodge_max` (below) |
| `orb` | a sphere, drifting or at `speed` 0 set down beside the caster, that strikes the nearest body in reach on its own clock | `zap_ms`, `zap_reach`, `max_alive`; `place_px`, how far from the caster it starts; `zap_count`, how many of the nearest bodies one discharge strikes (default 1) |
| `trail` | for a while, the ground the caster walks over catches | `trail_ms`, `drop_px`, `patch_ms` |
| `enchant` | for a while, every sword swing also throws a wave | `enchant_ms`, `wave_reach` |
| `stance` | a short guard; a hit taken during it is cancelled and answered | `stance_ms`, `answer_radius`, `expire_share` |
| `beam` | held: a line along the aim to the first wall that hurts what it crosses each tick | `reach`, `tick_ms`, `flash_ms` (below) |

Common parameters on every item: `damage`, `radius`, `lifetime`, `element`,
`element_power`, `status_scale` (how hard its burn or poison ticks against the
roster's standard status), `speed`, `windup_ms`, `recover_ms`, `move_scale`,
`cooldown_scale`.

### The rules of the newer shapes and options

- **`charges` (bolt).** The key banks one charge every `charge_ms`, up to
  `charges`, whether or not it is held. A press fires every banked charge at once,
  in a tight fan, for one cast's cost; held, the key looses each charge as it
  arrives, like any held key. Pressing on every charge is the most
  damage per second and the most mana per damage; banking five is the cheapest
  damage and the slowest. The damage-per-second ceiling is the charge rate, so
  banking can never out-damage tapping.
- **`charge` (bolt).** Holding the key charges the shot for up to `charge` ms,
  with the caster slowed to `move_scale`; releasing fires it, and the shot's
  damage and size scale from a fraction at a tap to the full figure at a full
  charge. Mana is paid on release. A dash cancels the charge and costs nothing.
  A full charge staggers.
  - **The charge's shield.** Standing to charge is standing in the open, so a
    charge raises a shield round the caster as it starts. The shield holds
    `CHARGE_SHIELD_HEARTS` (one heart): about one ordinary body's blow, and
    short of the king's sword.
  - A hit the shield holds whole costs nothing. No heart is lost, the caster
    is not shoved or stunned, and the charge is still held. The hit that breaks
    the shield lands with what was left over, stun and all.
  - The shield goes with the charge: when it is released, dashed out or
    stunned out.
  - Only a charge that was released **and paid for** raises a shield on the
    next charge. A dash-cancel costs nothing, so without this rule "charge,
    take a hit, dash, charge again" would give a free shield every time.
  - It is drawn as a faint bubble of the spell's own light with a single rim.
    A hit it holds ripples the bubble. Its breaking is a white flash, a ring
    blown out and shards flung off, with the frost's shatter as its sound.
- **`doom` (bolt).** A hit marks the body; `doom` ms later the mark bursts for
  the spell's `doom_damage` in a small radius. A marked body cannot be marked
  again until its mark bursts. The delayed burst is the spell's payoff, so the
  caster is free to leave, and it lands as the spell's hit: the marking shot's
  affixes fire on every body it reaches and its element goes on each (a mark
  handed on by a body that died keeps them).
- **`emit` (bolt).** While it flies, the shot throws a small shard every
  `emit_ms` in a direction that turns with each shard, and at the end of its
  life it bursts into a ring of them. The shards are projectiles and carry the
  spell's element.
- **`contagion` (bolt).** A body poisoned by this spell carries the contagion
  for as long as its poison lasts. When it dies, its poison jumps to up to
  `contagion` bodies within reach, which carry the contagion in turn.
- **`telegraph_ms` (eruption).** The cells are marked on the floor and burst
  after the telegraph. A body can walk out of the mark; that is the spell's
  risk, and its size is the payoff.
- **`ring` pattern (eruption).** Cells in a circle round the caster, or round
  the target body when the spell seeks one, in successive rings `step` tiles
  apart, each ring a beat after the last.
- **`land` (dash).** The caster leaps at the body the spell seeks, untouchable
  in the air, and lands in a ring eruption of the spell's damage.
- **`collapse` (vortex).** When the pull ends it implodes, dealing
  `collapse_damage` to every body still inside its radius.
- **`boomerang`.** Each body is hit once on the way out and once on the way
  back. The blade returns to where the caster is now, not to where it was
  thrown from.
- **`orb`.** An orb deals no contact damage; its damage is its strikes. At most
  `max_alive` orbs from one key are alive at once; a new one replaces the
  oldest.
- **`trail`.** A patch is dropped every `drop_px` of the caster's travel, not
  on a clock, so standing still drops nothing. The caster's own patches never
  harm the caster; grass they set alight is the room's fire and burns
  everyone, the caster too (004, `grass_patch`), after the beat it takes to
  catch.
- **`enchant`.** As each swing ends, the edge of its crescent flies on as a
  wave: the arc the blade's tip traced, trimmed to its middle, carried
  forward along the swing's facing at the swing's own size for `wave_reach`,
  passing through every body it crosses, fading as it goes. Nothing in the
  room cuts it — not a prop, a pillar or a wall: it always flies its whole
  reach, which is short enough that crossing a wall's edge reads as the
  swing's, not as a shot through stone. A swing that misses still
  throws its wave; the spin does not. Because the cooldown is at least the
  enchant's length, a press renews it only as it runs out; an affix's free
  cast renews it at any time.
- **`stance`.** For `stance_ms` the caster is slowed and cannot swing. The first
  enemy hit that would land — a body's contact or a projectile — is cancelled,
  the caster gets a moment of invulnerability, and the stance answers with a
  spin slash of the spell's damage round the caster, staggering what it cuts.
  If nothing lands before the stance ends, it answers anyway at
  `expire_share` of the damage, so the key is never a dead press. A dash
  drops the stance and answers at once at `expire_share`, because the dash
  keeps its priority over everything. The stance guards against bodies and
  projectiles, not against the room's own hazards.
- **`beam`.** Channelled: the press pays the key's cost, and the beam holds
  for as long as the key stays down while the bar pays `drain_per_s` on
  continuously, with no clock of its own, going out when the bar is dry (a
  beam with no drain holds for `lifetime`). It leaves the
  caster toward the body the press sought, and turns after the body nearest
  the facing within its reach at a bounded rate (back to the facing with none),
  since a line held along one of four ways missed everything off the axis. The
  caster moves at `move_scale`, nothing else is cast meanwhile, and the key
  coming up, another key, a dash or a stun puts it out. It fires none of the projectile hooks. Cast free by an affix it is a
  `flash_ms` flash at the body the affix names.
- **`lob` (bolt).** The shell flies in an arc over every body and wall to the
  body it seeks, or the aim's point at `reach`, for `lob` seconds, and lands
  for its whole damage on every body within `lob_radius`. Its landing is its
  hit: the hit and kill affixes fire there, and those that act on a shot's
  flight (`pierce`, `seek`, `ricochet`, `shatter`, `fork`) are not dealt to it.
- **`stack_max` (orbit).** A recast adds its blades to the ring instead of
  replacing it, up to `stack_max`, past which the oldest go; each blade keeps
  its own `lifetime` from the cast that made it, so a ring not pressed thins; the ring is re-spaced evenly each time and widens and quickens by
  `orbit_grow` px and `spin_grow` °/s a blade. With `burst_speed`, the cast
  that fills the ring bursts it `burst_ms` later: each blade leaves the circle
  outward and curls onto a body within `burst_reach` (the one the fewest
  blades of the burst went for, then the nearest), piercing, at `burst_scale`
  of its damage; the next cast starts a new ring. The ring is the build, the
  burst the release — where Spirit Blades is a ring that is simply there.
- **`anchor_reach` (orbit).** The ring turns round a point on the floor — the
  body the cast sought, or the aim's point at `anchor_reach` — and stays there
  as the caster moves.
- **`lodge_max` (boomerang).** Loaded by the sword, not thrown: while a key
  holds it, every connecting sword blow leaves one of its blades in the body
  struck, up to `lodge_max` out at once (the oldest goes), each for
  `lodge_ms`; a blade whose body dies stays where it fell. The press rips every
  blade out at once and flies it home as a boomerang already on its way back,
  cutting the body it was in and everything between. With no blade out the key
  does nothing and costs nothing, and is shown cooling. The free casts that
  would find none out (`retort`, `slipstream`, `scatter`) are not dealt to it;
  the assist calls the blades home with half of them out, or one about to
  lapse.

## The roster

Forty-seven spells. ★ marks each style's starter. A spell appears under every
style it is tagged with; its first row is its primary style.

### Barrage (`spam`)

| Spell | School | Rarity | Shape | What it does |
|---|---|---|---|---|
| ★ Shock Arc `shock_arc` | storm | common | bolt | a fast seeking spark that leaps to up to two more nearby bodies, each jump weaker |
| Magic Bolt `magic_bolt` | void | common | bolt | one quick bolt that steers gently toward the body it was cast at |
| Frost Needle `frost_needle` | frost | common | bolt | a fast needle that chills toward a freeze |
| Seeker Swarm `seeker_swarm` | storm | uncommon | bolt | a handful of darts that each find the nearest body |
| Spark Spray `spark_spray` | storm | common | bolt | a short fan of sparks (also Blade) |
| Spirit Ally `spirit_ally` | spirit | rare | summon | a companion that follows and shoots the nearest body for a while |
| Mana Darts `mana_darts` | void | uncommon | bolt + `charges` | banks darts while the key rests; a press looses all of them |
| Ball Lightning `ball_lightning` | storm | uncommon | orb | a slow orb that strikes the nearest body in reach several times a second; several can be out at once |
| Storm Totem `storm_totem` | storm | uncommon | orb (still) | a totem set down beside the caster that charges and discharges at up to three bodies in its reach at once (`zap_count`); two at most (also Crowd) |
| Blade Storm `blade_storm` | spirit | rare | orbit + `stack_max` | see Blade |

### Heavy (`nuke`)

| Spell | School | Rarity | Shape | What it does |
|---|---|---|---|---|
| ★ Earth Spikes `earth_spikes` | stone | common | eruption (line) | a line of stone spikes out of the floor, one after another, staggering what they catch |
| Stone Shard `stone_shard` | stone | common | bolt | one slow heavy shard |
| Arc Lance `arc_lance` | storm | uncommon | bolt | a fast lance that passes through its target |
| Glacier Spike `glacier_spike` | frost | rare | bolt | one large ice spike that chills hard |
| Blink Strike `blink_strike` | spirit | uncommon | dash | the caster dashes through the body in front, cutting it (also Blade) |
| Fault Line `fault_line` | stone | uncommon | bolt | a stone blade through everything in a line (also Crowd) |
| Meteor `meteor` | flame | rare | eruption + `telegraph_ms` | marks the ground at the body it seeks; a moment later a burning rock lands there |
| Arcane Cannon `arcane_cannon` | void | rare | bolt + `charge` | hold to charge, release to fire a piercing shot that grows with the charge |
| Doom Sigil `doom_sigil` | void | uncommon | bolt + `doom` | a hit marks the body, and the mark bursts a few seconds later (also Affliction) |
| Leap Slam `leap_slam` | stone | uncommon | dash + `land` | leaps at a body and lands in a ring of broken ground (also Blade) |
| Mortar `mortar` | stone | rare | bolt + `lob` | a shell lobbed over everything to the body it seeks, bursting where it lands (also Crowd) |
| Void Ray `void_ray` | void | rare | beam | held: a line of void light to the first wall, turning after the nearest body faced and burning every body across it; drains mana while held |

### Crowd (`area`)

| Spell | School | Rarity | Shape | What it does |
|---|---|---|---|---|
| ★ Scatter Shot `scatter_shot` | stone | uncommon | bolt | a wide cone of pellets, all of which land only at arm's length |
| Void Orb `void_orb` | void | rare | bolt | a slow heavy orb that passes through everything, knocking each body back |
| Void Maw `void_maw` | void | uncommon | vortex + `collapse` | a pull that drags bodies together, then implodes on what it holds |
| Frost Nova `frost_nova` | frost | uncommon | bolt | a ring of ice shards out from the caster that stops short (also Blade) |
| Cinder Geysers `cinder_geysers` | flame | rare | eruption (scatter) | fire bursting out of the floor round the body it seeks, each on its own beat |
| Quake Ring `quake_ring` | stone | uncommon | eruption (ring) | rings of broken ground out from the caster, one after another (also Blade) |
| Frozen Orb `frozen_orb` | frost | rare | bolt + `emit` | a slow orb that throws ice shards round itself as it flies and bursts at the end |
| Fault Line `fault_line` | stone | uncommon | bolt | see Heavy |
| Plague Bloom `plague_bloom` | venom | rare | bolt | a spray of spores that poison on contact (also Affliction) |
| Flame Pillars `flame_pillars` | flame | uncommon | eruption (line) | see Affliction |
| Cinder Burst `cinder_burst` | flame | uncommon | bolt | see Affliction |
| Blizzard `blizzard` | frost | uncommon | field (ice) | frost under the nearest body that slows what stands in it and chills it toward a freeze |
| Storm Totem `storm_totem` | storm | uncommon | orb (still) | see Barrage |
| Mortar `mortar` | stone | rare | bolt + `lob` | see Heavy |
| Blade Rift `blade_rift` | spirit | uncommon | orbit + `anchor_reach` | see Blade |

### Affliction (`dot`)

| Spell | School | Rarity | Shape | What it does |
|---|---|---|---|---|
| ★ Ember Dart `ember_dart` | flame | common | bolt | a dart that sets its target burning |
| Venom Spit `venom_spit` | venom | uncommon | bolt | a glob that leaves stacking poison |
| Wildfire Field `wildfire_field` | flame | uncommon | field | sets the ground alight under the nearest body |
| Flame Pillars `flame_pillars` | flame | uncommon | eruption (line) | a line of fire columns; the floor under each keeps burning (also Crowd) |
| Cinder Burst `cinder_burst` | flame | uncommon | bolt | a pair of burning motes that pass through the first body (also Crowd) |
| Toxic Cloud `toxic_cloud` | venom | uncommon | field | a cloud under the nearest body that poisons and slows what stands in it |
| Cinder Stride `cinder_stride` | flame | uncommon | trail | for a few seconds, the ground behind the caster catches fire |
| Contagion `contagion` | venom | rare | bolt + `contagion` | a heavy poison that jumps to nearby bodies when its carrier dies |
| Plague Bloom `plague_bloom` | venom | rare | bolt | see Crowd |
| Doom Sigil `doom_sigil` | void | uncommon | bolt + `doom` | see Heavy |

### Blade (`melee`)

| Spell | School | Rarity | Shape | What it does |
|---|---|---|---|---|
| ★ Crescent Edge `crescent_edge` | spirit | common | enchant | for a while, each sword swing ends by throwing its crescent forward as a wave |
| Spirit Blades `spirit_blades` | spirit | common | orbit | three blades circling the caster for a while |
| Returning Edge `returning_edge` | spirit | common | boomerang | a spectral sword thrown ahead that comes back, cutting on both passes |
| Counter Stance `counter_stance` | spirit | uncommon | stance | a short guard that cancels the next hit and answers with a spin slash |
| Dash Slash `dash_slash` | spirit | uncommon | dash + wake | a run through the bodies ahead whose wake cuts those to either side |
| Blade Storm `blade_storm` | spirit | rare | orbit + `stack_max` | each cast adds a blade to a ring round the caster that widens and quickens; the sixth flings them all out at nearby bodies (also Barrage) |
| Blade Recall `blade_recall` | spirit | uncommon | boomerang + `lodge_max` | each sword blow leaves a blade in the body struck, up to ten for fifteen seconds; the press calls them all home through everything between |
| Blade Rift `blade_rift` | spirit | uncommon | orbit + `anchor_reach` | a whirl of three blades set spinning on the floor ahead, cutting what stands in it (also Crowd) |
| Stone Ward `stone_ward` | stone | common | pillar | a pillar between the caster and what they face that blocks bodies and shots |
| Spark Spray, Blink Strike, Frost Nova, Quake Ring, Leap Slam | | | | see above |

Stone Ward is the pool's one defence: its value is the shots and bodies it
stops, so the damage gates below report it and do not assert on it.

## Starters

| Style | Starter |
|---|---|
| Barrage | Shock Arc |
| Heavy | Earth Spikes |
| Crowd | Scatter Shot |
| Affliction | Ember Dart |
| Blade | Crescent Edge |

A starter is the only spell the player has for the first rooms, so it must
answer a first-room body on its own: two or three casts, or under four seconds
for an Affliction starter whose damage arrives on its status's clock. The Blade
starter is an enchant, which is not cast at a body: with it up, the sword and
its waves must put a first-room body down clearly faster than the sword alone. The
starter is also the style card's icon and the intent screen's demonstration.

## Schools

Every spell belongs to one of seven schools (`spells/schools.ts`), which is what
a spell portal's badge promises (003). A school is a spell's identity, not only
its element; element-less spells are split by what they do. Every school holds
at least four spells, so a promised school is a choice rather than a single
card.

| School | Spells |
|---|---|
| flame | ember_dart, cinder_burst, wildfire_field, flame_pillars, cinder_geysers, meteor, cinder_stride |
| frost | frost_needle, glacier_spike, frost_nova, frozen_orb, blizzard |
| venom | venom_spit, plague_bloom, toxic_cloud, contagion |
| storm | shock_arc, spark_spray, arc_lance, seeker_swarm, ball_lightning, storm_totem |
| void | magic_bolt, void_orb, void_maw, mana_darts, arcane_cannon, doom_sigil, void_ray |
| spirit | spirit_blades, spirit_ally, blink_strike, returning_edge, crescent_edge, counter_stance, dash_slash, blade_storm, blade_recall, blade_rift |
| stone | stone_shard, stone_ward, scatter_shot, fault_line, earth_spikes, quake_ring, leap_slam, mortar |

`STYLE_SCHOOLS` (`run/doors.ts`), the schools a style's door may promise, is
derived from this table and the style tags: a school serves a style when it
holds at least two spells tagged with it.

## Mana, cooldown and level

An item's `mana` is a **rank**, 1 to 7. A cast costs `3.75 + 1.875 × (rank − 1)`
mana off the run's 90 (`slotCost`), times the level's mana factor and each
count affix's surcharge (013). A connecting sword hit returns 9% of the cap, so
the cheapest spell is about one hit and the dearest about four: closing to
sword range is how the player affords standing away from it.

Per-spell cooldown is `240 ms + 1300 ms × cost / 60`, times the spell's own
`cooldown_scale`. A trail and an enchant have a cooldown at least as long as
they last (`slotCooldownMs`), so a held key keeps one up rather than stacking
several; an orb's floor is its lifetime divided by `max_alive`, so a held key
keeps that many out at once and no more.

A spell's **level**, 1 to 5, multiplies its damage by `1 + 0.2 × (level − 1)`
and its mana by `1 + 0.1 × (level − 1)`, and changes nothing else.

## Pricing delivery

A spell's base figures are set by what it asks of the player, after the rule
the surveyed games share: **convenience costs damage, risk earns it.** Hades'
casts pay a lobbed or short-range shot 90–100 against 60–70 for one that seeks
or chains; Path of Exile's totems and traps give up half their damage for
casting themselves.

- **Discounted:** delivery that aims itself or keeps working without the
  player — seeking and chaining shots, orbs, fields, trails, enchants,
  summons. These sit in the lower half of the damage band.
- **Premium:** delivery that commits the player — a windup, a charge, a
  predicted landing, a stance, a leap into the pack, sword range. These sit in
  the upper half of the band, and their single hit may go to the slow-nuke
  ceiling.
- **Deterministic, never a small chance.** A spell does what it says every
  cast. No "sometimes".
- **Control carries damage.** A spell that slows, pulls or blocks also hurts,
  or it is a card nobody takes.

## Balance gates (`pnpm spell-bench`)

Every spell is cast alone on a key with a run's mana against pinned dummies
for twenty seconds and compared against the sword swung on the same dummies. A
spell is measured where it is meant to be used: close-range shapes and anything
tagged `melee` at arm's length, everything else at 150 px. The gates, all
asserted:

- **Base damage per second**: 0.75 to 1.0 of the sword on one body; an `area`
  specialist may go to 0.6, because a crowd pays it back. A `dot` spell may
  not, even when it is also tagged `area`: a status pays out on one body as
  well as on many, and the Affliction style is built of these spells from its
  first room. A dot spell's level is set by its `status_scale`, not its hit,
  so its status share stays above the gate. The generalists' spread, best over worst,
  is at most 1.45. An `enchant` is held to neither: its waves ride on the
  sword's own swings and add to them, so it is judged as sword plus waves (an
  enchanted sword clearly faster than the bare one, the waves alone no answer),
  and a wave is three quarters of a swing, never more than the blade.
- **One hit**: at most 3 sword swings' worth, or 8 for a slow nuke (a `nuke`
  tag or a `cooldown_scale` of 1.4 or more). Only a slow nuke may kill a
  first-room body with one projectile.
- **Crowd**: an `area` spell deals at least 1.3 times against a pack of six
  what it deals to one body, and no base spell clears a pack faster than 1.35
  times the sword.
- **Affliction**: at least 60% of a `dot` spell's damage comes from its status
  (burn, poison, the ground it leaves, a doom burst).
- **Starters**: two or three casts on a first-room body, or under four seconds
  for a `dot` starter.
- **Every spell has a build that passes the sword**: at level 5 with its best
  pair of fitting affixes at tier III, on whichever target it is built for, at
  least 1.15 times the sword; no build past 5 times the sword; none past 3
  times the median finished build.

Three shapes cannot show their value against a pinned dummy, so the bench
gives each its own scenario and holds it to the same bands:

| Scenario | Used by | What happens |
|---|---|---|
| **walking** | `trail` | the caster walks a fixed loop through the pack |
| **attacked** | `stance` | a body strikes the caster on a fixed clock; the stance is cast before each strike |
| **swinging** | `enchant` | the caster swings the sword into the pack on its ideal chain; only the waves' damage is counted |

`pnpm spell-check` fires every spell in a real room and asserts that it fires
and that it reaches and hurts something (a pillar raises, a summon appears),
along with each option's own evidence (a bank empties, a charge scales, a mark
bursts). That each affix a shape lists does something observable on it is
asserted by `affix-shapes.test.ts` (013).

Two things the bench cannot show and does not claim to: Meteor's risk (its
dummies are pinned and cannot walk out of the mark) and Contagion's jump (its
dummies never die), so both are measured on their direct figures alone.

## What a spell tells Jev

Jev reads a spell twice: as a held key in the build (the briefing) and as a
card on offer. Both are **neutral facts** (002): what the spell does — its
shape, reach, element, cost and cooldown — and never who it suits, how it
compares with the rest of the pool, or whether it is good. "Suits a spam
build" and "hits harder than any other common attack" are verdicts; a Director
that reads them is being told the answer to the question it is asked.

- A spell's `description` (the card's `what`) says what it does in one or two
  plain clauses, under 220 characters, no digits.
- Its `not_for` names an objective situation in which it does little —
  "bodies spread across the room", "a fight held at sword range" — derived from
  its shape and parameters (`spellNegative`), never "weak" or "bad".
- The player's chosen style reaches Jev as `STYLE_CARDS[id].does` — what the
  style's spells do and which starter it begins with — never as the intent
  card's blurb, which is copy written for the player. Its style tags reach Jev
  as facts about what is held or offered, never as advice: `keys_lean` (a count of the tags on the held spells), a card's
  `style` and `build` flags (it carries the stated style, or the style the
  keys lean), and a school's option text (which styles two or more of its
  spells are tagged with). Its school reaches Jev as the school a door
  promised and the schools on the keys.

Jev makes no numeric decision about spells: it never sees damage, cost or a
simulated figure, and it never judges whether an affix fits a spell — code
deals only affixes some held spell can take (013).
