---
id: 013
title: Basic Attack, Spells, Enchantments
status: accepted
date: 2026-09-21
summary: The combat and build design. Three layers, each doing one job. A free arc-melee sword that generates the mana spells cost; three spells on three keys, self-contained, where a summon and a thrown bolt are two spells rather than two systems; and three affixes per spell, where a duplicate upgrades what the player holds rather than taking a second slot. Movement is eight-directional while facing and attacks snap to four, so the mouse has no job and a player cannot retreat and swing at the same time. A spin runs on its own rage gauge, filled by the fight itself. Mana refills on entering a room, which keeps it a within-room resource so doc 005's pressure bands stay meaningful; base regeneration is a trickle so that hitting things remains the supply; and the one mana stat is maximum mana, with both regeneration and hit-to-earn expressed as percentages of it, so that neither goes proportionally worthless as the cap grows. Spell level is bought with gold from the blacksmith and base-tier affixes from the merchant beside him, while affix tier comes only from drops, so gold buys breadth and power, never depth. Replacing a spell dismantles it into gold at a lossy rate, which makes a late spell offer a trade rather than a sacrifice. Ranged enemies stay, because without them room geometry is inert, but they fire single slow telegraphed shots a melee player can arrive through. Also carries statuses and build-up, the intrinsic stat pool, the character screen, the HUD and the menus.
depends_on: [001, 003, 006, 007, 008]
---

# 013 Basic Attack, Spells, Enchantments

This is the combat layer and the build layer: what the player presses, what it
costs, and what a run does to it.

## The structure

Three layers, and the discipline is that each does exactly one job.

| Layer | What it is | What improves it |
|---|---|---|
| **Basic attack** | A free arc melee swing that generates the mana spells cost | Intrinsic stats only |
| **Spells** | Three, on three keys, self-contained, costing mana | Level, bought with gold |
| **Affixes** | Three per spell, attached to that named spell | Duplicates, from drops |

The player's answer to a room cannot be one verb. The sword is the reliable
floor — it always works, it costs nothing, and its improvement is legible
without reading anything — and the spells are the reach, the safety and the
crowd control that have to be paid for. Every enemy in the game is built
against that pair.

### Everything that is not the sword is a spell

There is no pet system and no ranged-weapon system. **A summon is a spell and
a thrown bolt is a spell.** The delivery — at the sword, from the player, at a
point on the floor, or as a body that walks around — is part of what that
particular spell *is*, not a category the player chooses between.

This collapse is what makes the rest work. The alternative is a set of
carriers onto which each spell is installed, which means every spell needs a
melee version, a ranged version and a pet version; a frost effect that is
simultaneously a swing nova, a projectile and a companion aura is not one thing
with three modes, it is three weaker things sharing a name. Triple the content
cost, and the identity is mush.

A consequence worth stating: **spells carry no melee-or-ranged tag.** A sword
art and a thrown bolt are both just spells, the reward pool is never split, and
a specialised build never faces a pool half of which is inert. Doc 001 forbids
reducing a build's primary damage path below 50% effectiveness and sets a 40%
floor on showcase rooms; a two-way tag would have had the *reward system* doing
to the build exactly what the charter forbids encounters from doing.

### The basic attack generates mana

Hitting something with the sword regenerates mana, and mana is what spells
cost. This is Astral Ascent's loop and it is the best single thing this design
takes from it.

It turns two separate systems into one cycle. Without it the sword is free and
the spells are costed, which are merely two facts; with it **being in melee
range is how the player pays for their ranged options.** Closing is not just a
damage choice, it is the resource engine.

Three consequences worth stating:

- **Running dry pushes the player toward aggression** rather than into nothing.
- **Attack speed is an economy stat, not only a damage stat**, which is what
  earns it a place in a pool that must otherwise be capped to stay
  uninteresting.
- **A spell-heavy build still has to come in sometimes.** That is a
  self-balancing pressure no encounter has to supply.

### No mouse: facing comes from movement

With a melee basic attack and spells that either ride the swing or find their
own target, **the mouse has no job.** Movement supplies the facing, and the
game is fully playable on a keyboard alone or on a gamepad. The keys are `WASD`
or the arrows to move, `J` to attack, `U I O` to cast, `Space` to cast
whichever spell is ready (doc 008's auto-cast), `L` to spin, `K` to
dodge, `E` to use, `X` to dismantle, `Tab` for the character screen and `Esc`
to pause.

These are the defaults. **Every one of them but Enter, Esc and the arrows
can be put on another key** from the controls page (`keybinds.ts`): a
player whose thumbs or little fingers sit differently from the layout the
game was built round should not have to play it anyway. The menus' own keys
stay put, so a binding gone wrong can always be backed out of; a key
another action held is swapped onto the rebound action's old key rather
than doubled; and a binding keeps the label the key printed when it was
pressed, so a JIS board's caps read as its own. Every prompt that names a
key names an action (`[@interact]`) and draws whatever key it is on.

**Movement is eight-directional; facing and attacks are four.** This is A Link
to the Past's arrangement. Diagonal movement stays, which matters because enemy
projectiles are still in the game and cardinal-only movement against them is
miserable; but the body snaps to one of four facings, taken from the dominant
axis of the movement vector.

Four rather than eight for a reason that is not only art budget: **an
eight-way facing makes the commitment vaguer.** The swing roots the player's
direction for its duration, and a four-way lock is a decision the player can
feel they made. It is also what the reference games do — Zelda 1 cannot attack
diagonally at all.

**Facing is held when movement stops**, so a player can stand still facing the
way they were last going, and it is **locked at the start of a swing**: the
hitbox keeps the centre it was given even while the sprite's facing carries on
updating for the next swing. A live hitbox that followed the facing would let a
turning player sweep a full circle, which dissolves the point of a bounded arc.

The consequence the player feels, and it is the point: **you cannot back away
while attacking.** Retreating means not swinging. That is the spacing game this
whole direction exists to get, and it arrives from the control scheme rather
than needing a mechanic.

Aim assist survives for casts and is deliberately small for the sword. A swing
is aimed with the body, so it gets a hair's correction inside a 14 degree cone;
a keyed spell is pressed while the left hand is steering and the facing is
whatever the last step left it at, so it gets a wider 52 degree **seeking**
cone. A single shot leaves toward the body it picked there and corrects in
flight at its own rate, which is what tells the kinds apart: **lightning**
holds on hard (Shock Arc 480°/s, Arc Lance 420), a **bolt** barely (Magic Bolt
90, Frost Needle 60, Stone Shard 30), so a body that moves steps out of it,
and a **spread** keeps the facing and does not seek at all.

### Targeting follows delivery

The delivery taxonomy does double duty as the targeting rule, so there is no
separate targeting system to design:

| Delivery | Targeting |
|---|---|
| **Art**, riding the swing | Along the locked facing |
| **Projectile** | Seeks the nearest body inside the cone |
| **Summon** | Placed relative to the player, then acts on its own |

Projectiles seek rather than flying straight along the facing because a rooted
player facing slightly wrong should not be punished twice. Arts fire along the
facing because they *are* the swing. Summons need no target at all.

## The sword

One swing is sixteen frames: four of windup with no hitbox, **eight active**,
four of recovery. Under half the animation does anything, which is what makes
it a commitment, and the eight-frame window is what the enemy telegraphs are
sized against.

The arc covers **170 degrees**, composed of a 34 degree blade travelling
through a 136 degree sweep, because a swing is a small hitbox moving rather
than a wide one appearing — and a spin is then the same primitive with more
degrees. Reach is 1.8 tiles, split into a 1.0-tile blade and a 0.8-tile
crescent that spreads past it. Past the steel the reach is a **magic blade**, after
Elden Ring's Carian Slicer: a blade of light drawn in code that grows out of the
sword's grip only while it swings — gathering in the windup, full through the
active frames, dissolving from the point in the recovery — and ends exactly at
the hitbox's reach, so the range the player gets is the blade they see and a
reach upgrade lengthens it. The sword's drawing is never stretched; **everything the affix and stat systems add pushes the crescent's
outer edge further out**, so a reach upgrade is visible on the character rather
than in a menu. Nothing detaches: the crescent is a widening band, not a
projectile.

170 rather than A Link to the Past's measured 80 because 80 degrees at this
reach is 63 px long and 26 px thick — a stubby lozenge rather than a crescent,
and undrawable for that geometric reason. The cost is small and measured:
geometric coverage roughly doubles, but **enemies actually caught per
connecting swing moves about ten percent**, because chasers cluster at their
standoff distance and are already inside the narrow arc. ALttP's tile is half
the size of this one, so its angle covers far less of its room; the reference
number does not transfer.

A hit does 9 damage and 80 knockback. Knockback is feedback, not displacement:
a bigger impulse moved a body half the sword's reach per hit, so the third
swing of a chain missed and the player walked after their own target.
Interrupting a body is the stagger's job, not the impulse's.

**The swing only ever slows the player, never pushes them.** Movement runs at
0.35 of input speed during the windup, 0.7 during the active frames and full
speed through the recovery. A forward lunge on the active frames is forced
displacement — it moves the player somewhere they did not choose, which reads
as losing control rather than as committing — and a flat slow across the whole
267 ms reads as sludge. The recovery handing movement straight back is what
makes the commitment bounded.

**Every swing is identical, including its direction.** No combo index, no
alternating sweep, no doubled finisher: a combo asks the player to track where
they are in a sequence, and that attention is better spent on the enemies. One
motion, every time, is a thing the player never has to think about.

**The sword never gains behaviour.** It gains reach, speed, damage and crit,
and that is all. Its progression being purely numeric is the point rather than
a shortfall — it is the reliable floor, and the *spells* are where the
interesting power lives. This is where the evidence says flat numbers belong:
Hades separates its axes explicitly, with boons changing behaviour and Poms of
Power as the pure-numbers tier that decays (80%, 60%, 40%, 30%, 20%, 15%, 10%,
then 10% forever); Isaac caps fire rate with a square root,
`TearDelay = 16 − 6√(1.3T + 1)` floored at 5, so stacking every tears item in
the game at most roughly doubles fire rate. **Isaac mathematically forbids
stats from carrying a run**, and the intrinsic pool here is capped for the same
reason.

### The blade floats

The sword is not held. It is a blade that **hovers in front of the caster**:
the grip sits 13.5 px out, the blade points outward, and the tip lands on the
hitbox radius, so reach comes from where the blade floats rather than from how
long it is.

A held weapon cannot do what this design asks. The drawn blade is about 18
world px from grip to tip against a hitbox that reaches 32, so a held sprite
depicts a reach the attack does not have — and a sword that visibly falls short
of where it hits feels broken to swing, because the player aims by the drawing.
Stretching it produces a thin over-long strip and scaling it produces a club,
because for a held weapon **reach is length**.

Floating settles three things at once. A human shoulder does not sweep 170
degrees; a blade orbiting its owner does, trivially. Reach progression has
somewhere to live, because a floating blade can simply hover further out, which
is legible at a glance and needs no new art. And it matches the character
already drawn: a hooded figure holding a glowing orb in the off hand was never
a knight.

It also opens a line of content that is consistent rather than novel: a spell
that sends the sword out — a thrown blade that returns, a second blade that
orbits, a blade that plants itself and holds a zone — is the *same object*
behaving differently. The sword's position is renderer state driven by the
player's facing, so a spell that overrides where the blade hovers needs no new
primitive.

### The spin and the rage gauge

`L` is a **spin**: two and a half turns of the blade over three times a swing's
duration, reach a third longer, damage 1.3 times a swing's, and **each body
struck once per turn** — a blender, with the knockback cut to half so a body
inside stays inside for the next pass. It is the one answer the sword otherwise
lacks to being surrounded, because a swing has a front and a rusher behind you
is behind it.

It runs on **rage**, a third resource with its own gauge: two segments to
start, filled by the sword (0.12 per connecting swing, 0.35 for a kill, never
by a spell or by the spin itself), and spent a whole segment at a time. Costed
in mana it would compete with every spell and lose; on its own gauge it is what
the fight itself pays for. The key is a press, never a hold, so a finger
resting on it cannot spend a segment. The `wrath` stat adds a segment.

### The dash

`K` dashes: 110 ms of travel at 580 px/s, invulnerable for the travel and 90 ms
past it, then a 420 ms cooldown. It is the approach tool as much as the evasion
tool, which is what earns it two of the three movement stat cards.

**A dash cancels a swing outright.** Hyper Light Drifter orders dash above
sword above gun, and that single ordering generates all of its cancel
behaviour: one priority per action replaces a matrix of per-move windows, and
it is the largest single thing that keeps a committed attack from feeling like
a trap.

## Mana

Mana comes from four places, and they are deliberately unequal:

| Source | Magnitude | Scaling |
|---|---|---|
| Entering a room | Full refill | — |
| Hitting things with the sword | The main supply, 9% of the cap a hit | A percentage of max |
| Breaking a destructible | 12% of the cap | A percentage of max |
| Natural regeneration | A trickle, 2% of the cap a second | A percentage of max |

**The room-entry refill is right for a structural reason**, not only for
comfort: it makes mana a *within-room* resource. Doc 005 measures pressure per
room and bands it; a resource carried between rooms couples them, so a room's
measured pressure would depend on how much the player hoarded two rooms ago and
the measurement would mean nothing. Refilling on entry is what makes the
evaluation machinery correct rather than merely convenient, and it removes a
whole class of bad moment: arriving at a peak room empty.

**Natural regeneration is low, and that is load-bearing.** With several sources
there is a real risk mana stops binding at all, and if mana never binds then
spells are free, and if spells are free the sword has no job — the structure of
a reliable floor plus costed reach collapses. Regeneration is the source that
would do the damage, because a meaningful trickle dominates the hit-to-earn
loop. At 2% a second a full bar takes fifty seconds from empty and a cheap
spell about four: a floor under a bad fight rather than an income. Measured
at 5%, the bar paid a plain bolt every 1.7 s from standing still, and with an
orb on every kill mana never bound at all.

### Max mana is the only mana stat

The intrinsic mana stat is **maximum mana**, with regeneration and hit-to-earn
both expressed as percentages of it. Raising the cap therefore does everything
at once: more spells castable before running dry, a larger absolute recovery
per second, and more mana per connecting hit.

**One number improves several things, in the same direction.** The player never
has to work out whether they are short of capacity or short of throughput, and
a pool that must stay small benefits from every collapse available.

**Percentage scaling is scale-invariant, and a flat rate is not.** With a flat
figure and a growing cap, both regeneration and hit-to-earn go proportionally
worthless as the cap rises — and hit-to-earn going worthless is the worse of
the two, because the melee-feeds-spells loop would die exactly when the build is
most developed: a late-run player with three times the starting cap would find
that hitting things barely moved the bar, so the reason to close distance would
evaporate at the point they had most invested in being able to. Risk of Rain 2
codifies this choice by giving its stackable items three explicit shapes —
linear, hyperbolic, exponential — and picking per item the one that stays
meaningful at high stacks.

This is not exponential. Total mana available over a window is
`max × (1 + rate × seconds)`, linear in the cap; the gain is that the stat
improves several quantities rather than one, not that the curve steepens. And
percentage regeneration means the bar takes the **same time to fill whatever
the cap**, so fill time is a single design constant and the decision "cast now
or wait" keeps its shape all run.

### What a cast costs

A cast costs a **number of mana**: 5 at rank 1 and 2.5 more per rank, to 20 at
rank 7, reading doc 006's item cost as a rank. A cost that was a share of the
cap meant every well held the same number of casts, so a deeper well bought
nothing and the HUD had nothing to show but a percentage — a number the player
cannot add up against the bar. A bigger well is more casts, which is what a
player reads it as.

Against the sword's 9% a hit that is **about one connecting hit for the
cheapest spell and four for the dearest**. That ratio is the whole economy: it
is what makes closing to melee range the way the player affords standing away
from it. The floor is deliberately cheap — a basic ranged option has to be a
tool the player uses freely, and rationing the plainest thing they own teaches
them that spells are not worth pressing. Rationing belongs at the top of the
range, where a spell is an event.

Cooldowns are proportional to cost, 240 ms plus 1300 ms times the cost
fraction. Without them the mana cost is the only limit and a cheap spell
pressed every frame is a held button again, which is the thing the keyed layer
exists to remove. A spell key **may be held**: the cooldown already stops a
held key buying a cast a frame, so holding simply casts again when the cooldown
clears, at the rate the cost was sized for, and the player is not asked to drum
a rhythm the game can keep for them.

The run plays one fixed staff record: 90 mana, three slots. There is nothing to
choose there — the player has a sword and three keys — and 90 is measured: 70
left half the runs dead at the boss and 120 was no better.

## Spells

The player holds **three spells, bound to `U`, `I` and `O`**. A key holds one
spell and a spell is **self-contained**: its behaviour never depends on what sits
on the other keys, nothing modifies "the next attack", and no spell captures or
repeats another. The pool, its shapes and its rules are doc 006.

The run starts with one spell, the chosen style's starter, and the other two
keys fill from rewards. With independently bound keys the player finds their
best spell and presses it, so what makes the third key matter is the
investment in it — its level and its affixes — rather than an input scheme
that forces rotation (Astral Ascent disables a cast spell until the others have
been cast; this design gives that up).

### Spell shapes

Thirteen projectiles that differ in speed, count and colour are one spell. The
difference between spells in Astral Ascent and Magicraft is the **shape** — what
the spell is, and the decision it asks — not the numbers. A shape is a param on
the item; the cast dispatches on it, and the spell check knows where each
shape's dummy has to stand. Doc 006 lists the thirteen shapes (bolt, orbit,
field, pillar, dash, vortex, summon, eruption, boomerang, orb, trail, enchant,
stance) and the rules of each.

**Weight and speed.** Projectiles differ in how they travel and land, not only
in numbers: light spells fly fast and heavy ones slow and large. Every shot
carries a `weight`, its mass: light ones below 1 (a seeker 0.3, a spark 0.4, a
pellet 0.5), the bolt 1, heavy ones above. It multiplies the knockback, and a
shot of 1.2 or more **staggers** what it hits for its weight times the sword's
stagger, interrupting a windup, which a swing does not; a heavy one also lengthens the
hit freeze, shakes the room and throws a larger burst. A light shot only
pushes. A spell may scale its own cooldown (`cooldown_scale`), so a slow, heavy
shot is thrown seldom whatever it costs.

**Enchant and the sword.** "The sword never gains behaviour" is a rule about
the sword's own progression: stats give it reach, speed, damage and crit, and
nothing else. An `enchant` spell is a spell, paid for in mana and on its own
cooldown, that for a few seconds makes each swing throw a wave; when it ends
the sword is the plain sword again.

### Levels

**A spell has a level, 1 to 5, and a level is damage only** — plus 20% a level,
for plus 10% mana a level — so it never changes what a spell is. A level comes
from an elite door, whose spell card arrives at the door's grade, or from the
blacksmith for gold, and it survives the room like the affixes do. The
character screen shows each key's level and the damage it adds; the HUD shows
it as a numeral after the name.

## Affixes

Each spell carries up to **three affixes**: nine slots in a run.

An affix picked up when the player already holds it **upgrades the one they
have** rather than occupying a second slot. Nine slots against a continuous
stream of offers would otherwise dilute the pool until most draws read as
"another thing I cannot use". Duplicates-as-upgrades means every draw is worth
something, which is Risk of Rain's stacking model bounded by slot count instead
of running unbounded.

**An affix has one number, not two.** Giving an affix both a rarity from its
drop and a stack count from duplicates means the player cannot tell what they
are holding. There is a single **tier**, I to III, and a drop's rarity is a
head start on the same ladder that duplicates climb. Three tiers is fine enough
that a duplicate always means something and coarse enough that a low-tier
duplicate of a high-tier affix is not a wasted draw; past three or four the low
end of the ladder becomes drops nobody wants, which is the failure the
mechanism exists to avoid.

Tier comes only from the draw. An elite door's affix card arrives at tier II or
III (III a third of the time); a normal door's is tier I, and from the ninth
room a normal door is graded up to II a quarter of the time. **Nothing sells
tier.**

### An affix adds an event

The obvious failure is that affixes become a stat screen and the system reduces
to numbers with extra steps. Hades avoids it because a boon adds an event: Zeus
on Attack does not raise attack damage, it makes the attack call lightning. So:

> **An affix adds or changes an event. A spell level and a gold purchase scale
> numbers. They are different kinds and they come from different pools.**

This is enforced by the content schema, because the cheaper kind is easier to
author and the pool would silently fill with it otherwise. An affix must name a
`hook` — a moment — and an `effect` that happens at it, and `AffixEffect` is a
closed union in which no member can reach the spell's damage, mana or cooldown.
**There is nowhere to put "+35% damage", because damage is not an event.** A
tier may only scale its own effect's magnitude, and a test asserts the rule over
the authored data so a future member of the union cannot quietly reintroduce a
number.

Every hook is a moment the simulation already has, which is what separates the
pool from a wishlist:

| hook | fires when |
|---|---|
| `hit` | a player projectile overlaps a body |
| `expire` | a projectile's lifetime ends |
| `wall` | a projectile stops on geometry |
| `kill` | a body's hp reaches zero |
| `cast` | the spell is fired |
| `hurt` | the player takes a hit |
| `dash` | the player dashes |
| `swing` | a sword hit connects |
| `spin` | the sword's spin starts |
| `end` | a placed pull, companion or orb runs out |

The simulation already fires a spell's effect at a position and at a body, so
an affix is a *use* of existing machinery rather than a request for new
machinery.

### An affix fits some shapes and not others

A hook is only reachable from some spell shapes: a bolt hits, expires and meets
walls, a field does none of those, and a chain attached to a burning patch of
ground would be a card that does nothing. So each affix names the shapes it
works on, the card says so in its last sentence ("Fits bolt, orbit."), the
character screen greys out the spells it cannot go on and says why, and an
affix offer deals only affixes **some spell the player holds can take** — a
dead draw dressed as a choice is worse than a smaller pool.

| affix | hook | fits |
|---|---|---|
| Fork, Shatter, Pierce, Seek, Ricochet | hit / wall / cast | bolt |
| Chain | hit | bolt, boomerang, orb |
| Brand, Harvest, Haste, Drag, Cull, Overload | hit / kill | bolt, orbit, boomerang, orb, enchant |
| Slam | hit | bolt, orbit, boomerang, enchant: a body the spell throws into a wall is hurt and staggered |
| Intercept | cast | bolt, orbit, boomerang, enchant: the spell's shots and blades put out enemy shots |
| Lodestar | cast | eruption, field, vortex, pillar: the cast lands under the nearest body |
| Afterimage | end | vortex, summon, orb: the effect is cast once more when it runs out |
| Spillover | kill | the same, on a spell that carries an element of its own or an infusion: a kill hands the body's burn, chill and poison, and the killing hit's element, to the bodies near it |
| Bloom | expire | bolt, orbit |
| Repeat | cast | bolt, eruption, boomerang |
| Scatter | cast | bolt, field, pillar, vortex, dash, eruption, boomerang |
| Repulse, Aftershock | cast | any spell; an aftershock bursts for a share of one of the spell's own hits, so it is as heavy as the spell |
| Kindle, Rime, Blight | cast | any spell but a pillar, which strikes nothing to put an element on |
| Ward, Retort, Slipstream | cast / hurt / dash | any spell but a stance: cast free, a guard puts the sword away where it stands, and a ward's rune eats the hit the guard is up to answer |
| Parting Shot | dash | the same, and not a beam or any spell tagged `long`: casting behind on a dash away is a close-quarters answer |
| Resonance, Whirl | swing / spin | any spell but a stance, which forbids the swing it counts: every fifth connecting sword hit, or the start of a spin, casts the spell free — the melee build's affixes |
| Momentum, Undertow, Finale | cast | a dash with a wake (Dash Slash) |

Beside the shape lists, a few pairs are kept apart because the review
(`pnpm spell-bench matrix`, every spell against every affix it takes)
measured them making the spell worse: no `fork` or `seek` on a spell that
passes through bodies (the split ends the pass; the curl turns a line onto one
body), none of a shot's flight on a lob, and no `repeat`, `retort`,
`slipstream` or `scatter` on a recall, which finds its blades already home.

A spell cast by an affix — a `scatter` side cast, a `retort`, a `slipstream`,
a `resonance` — is **the spell's own shape**, fired from the caster toward the
body the hook names: a field or a pull opens under that body, a line of spikes
runs toward it, a ring or a ring of blades renews at the caster, a pillar
rises between the two, and a dash spell cuts that body once **without moving
the player**, because a sword hit must never throw the caster across the room.
Each list above is what a test measured: `affix-shapes.test.ts` casts every
affix on a spell of every shape it lists and asserts the effect is visible, so
a shape is added to a list by adding the behaviour, never by editing the list.

Attaching to a specific named spell is also a better decision than attaching to
an abstract slot, because the player knows what each of their three spells does
and can therefore predict the result. "Fork on my homing bolt" is a plan.

Four things the composition of the pool is doing deliberately:

- **`repeat` is the only way a spell casts more than once**, attached to a
  spell the player named rather than being a spell of its own with nothing to
  repeat.
- **Several fire when the player is losing** (`retort`, `slipstream`,
  `parting`, `repulse`). A pool that only pays out while winning is a pool
  that widens every gap it is meant to close.
- **`shatter` makes a cluttered room better than an open one**, which is the
  only thing in the build system that argues with doc 015's geometry rather
  than agreeing with it. That tension is wanted.
- **The pool a build can draw from is larger than what a run is shown.** An
  affix is one fixed effect and a key that holds one is not dealt it again,
  so a duplicate is not an upgrade: a card the run has already seen is only a
  repeat. What sizes the pool is how many affix cards a run meets — measured
  on the Jev arm, about seventeen, against the thirteen a build could be dealt
  when the pool held twenty-two — and a pool smaller than that is a run that
  sees all of it, and the next run seeing the same. The pool is thirty-four,
  and **every shape gets a share of it**: fourteen of the first twenty-two
  hung on a projectile's hooks, so a staff of ground, a run or a guard drew
  the same six any-shape cards, three of them the infusions, on every
  strength-I door. `repulse`, `aftershock`, `parting` and `whirl` act at
  moments nearly every shape reaches; `drag`, `spillover`, `cull`, `overload`,
  `slam` and `intercept` give the projectile keys a pull, a spread, a
  finish, a cadence payout, the walls and a guard; `lodestar` is the aiming
  answer for ground and pulls, and `afterimage` the strength III of the
  placed shapes. Every lane of the Director's affix intent (007) holds
  something for every shape. A bolt starter can be dealt twenty-seven, Earth
  Spikes fourteen, Crescent Edge nineteen.

The implementation follows the same rule. A spell's affixes ride the cast scope
onto every projectile it fires, so a bullet knows what it carries when it hits,
dies or kills; the hooks that are not about a projectile read the spell
directly. `fork` and `shatter` are the split count `splitBullets` already
reads, `repeat` is the scope's own field, `bloom` is a fire patch, and `retort`
and `slipstream` fire the spell's own unit through the same call a keypress
uses. One honest caveat: `bloom`'s field is a fire patch, because fire is the
only lingering-zone mechanism the simulation has and a second one would be a
second thing to balance. The card says "leaves a field", which is true; it
burns.

### Do nine slots fit the run?

Doc 014's run is 14 combat rooms with a reward roughly every other one. Three
things fill the slots: the **affix door**, which the player can choose when
they want breadth; the **merchant**, who sells base-tier affixes for gold
without consuming a room reward; and **dismantling**, which converts a spell
into the gold that buys them. Nine filled slots is the ceiling of a lucky run,
not the expectation.

## Statuses, build-up and damage

All damage is a whole number: rounded down, never below one, and status damage
lands in whole ticks twice a second. Damage numbers are coloured by what dealt
them — fire orange, ice pale blue, poison green, armour grey, the sword and
everything else white.

Fire and poison are **statuses, not hearts on a clock**, and the gauge over the
head is the whole story of one. It fills while the body stands in the hazard or
takes elemental hits — fire in a little over a second, poison in just under two
— ignites when full, and then **drains as the status's clock**: the status ends
when the gauge is empty, and a running status is not fed, or a pool would be a
status that never ends. A gauge that is not being fed drains back in about three
seconds. Burning costs 0.1 heart every half second for three seconds; poison the
same tick for two and a half and takes a quarter off movement speed. A crossing
therefore costs a bar that rises and falls, and lingering costs a status the
player watched arrive.

Ice is the same kind of build-up: each ice hit fills a gauge and slows, and a
full gauge **freezes** the body for 1.3 s — it cannot move or act, and the
gauge drains as the freeze's clock. The first hit on a frozen body **shatters**
it: triple damage, the ice gone, a pale burst and shards flung out, and a
damage number marked with `!`. Lightning is not an element and carries no
status, because it already reaches several bodies at once.

Enemies carry the same three gauges from the player's elements and show them:
warm and flickering while burning, green and bubbling while poisoned, blue while
slowed. A spell's hit fills an enemy's gauge by its **weight**: about a third
for a light spell's hit, more for a heavier one in proportion to its damage,
the whole gauge at most — so a Mortar shell or a Meteor sets a body burning
as it lands, where a gauge that drains between blows three seconds apart
would never fill. A burning enemy shot adds half a gauge on top of its hit. A poison pool
poisons whatever walks in it, not only the player, so a pool between the player
and a rusher is a place to fight from; the orbiter flies and a leaping boss is
in the air, so neither is touched. Spikes take a heart on contact.

A hazard's clock belongs to the contact: it runs only while the player is
standing in one and is left charged when they are clear, so **entering always
costs immediately and only staying is on a clock**, which is the reading a
player already has of a hazard — the edge is the threat. The interval is
1100 ms, comfortably longer than the 600 ms of invulnerability a tick grants.

Health is shown as a **bar with a number** beside the mana bar, both reading
`now/max`; a heart is still the unit inside the simulation (a hit is one) and is
drawn as ten.

## The intrinsic stat pool

The `stat` door offers one of twelve cards in four families — movement,
survival, mana, sword. A player who walks through that door must get something
they can use whatever they are building, or the door is a trap for half the
builds in the game, so the pool is majority **build-agnostic** — movement
speed, dash cooldown, dash range, health, the mana economy — with a minority of
sword-specific entries that are the reason the category is called "intrinsic"
rather than "generic".

**These are numbers, and this is where numbers belong.** Affixes cannot express
one by construction; stats are nothing but numbers; a pool that tried to be
both would collapse into the stat screen the rule exists to prevent.

Each card is a percentage of the player's *current* value rather than a flat
amount, for the same scale-invariance reason mana has: a flat figure goes
proportionally worthless as the stat it adds to grows, so the last one the
player finds would be the one that matters least. `Fleet` has the smallest step
in the pool because movement speed improves every part of the game at once.
`Vigour` is the run's healing on the card screen; the other half is the
fountain (003), which restores 50% of maximum health for a fight's reward
rather than for the other two cards. `Wrath` reads "+1 spin charge", which is what it
is. Every card reaches what it names: the mana cap when the room is built and
at once when the card is taken, regeneration and hit-to-earn when they happen,
and the sword's damage, reach and recovery when it swings — the last as the
tail of the recovery being cancellable into the next swing.

## Gold: dismantling, and the stop before the boss

Breaking a destructible pays mana, and four pots in five also drop one to three
coins. Gold otherwise comes from the gold door, which shows no cards and
scatters coins, and from taking a spell apart.

### Replacing a spell dismantles it into gold

A spell card shows **its affix slots** under its numbers: the three squares a
key has, holding what the spell will carry once taken — nothing on most new
spells, the affix a strength III door's new spell comes with (007), and on an
upgrade the held key's own, which the copy keeps.

Replacing a spell **dismantles** it, and the spell plus the affixes invested in
it convert into gold. `X` dismantles a spell card on the reward screen outright.
A spell replaced on a full set of keys **drops on the floor as it was** — its
level and its affixes — and waits there: a **tap** of `E` picks it back up (onto
a free key, or through the same replace step, which swaps it with the spell
that comes off), and **holding** `E` for about half a second takes it apart. The
destructive choice is the hold, because a levelled, affixed spell turned to gold
by one mistimed press is a loss the player did not choose.

**A second copy of a held spell levels it up** instead of taking a key — its card says so, tagged UPGRADE in a gold frame with "upgrade Lv 1 → 2", and taking it announces the level with a banner and a burst, since no new key appears: the
copy's level is added to the held one's, to the cap of three, and its affixes
stay. So a held spell below the cap stays in the reward pool — a spell card can
be an upgrade, and says so ("upgrade Lv 1 → 2") — and only a spell already at
the cap leaves it; a capped copy that still arrives pays its dismantle value.

This closes two problems at once.

**Late spell offers stop being dead.** If affixes are simply lost with the
spell — Astral Ascent's rule, where a modifier slotted into a discarded spell is
gone — then by the late run a fresh spell is worth less than three invested
affixes, so nobody takes one and a whole reward type quietly dies. Dismantling
makes the offer a **trade** rather than a sacrifice: the investment comes back
in a different form and pays for levels on what the player keeps.

**Gold stops merely accumulating.** It has two sources, and the second is under
the player's control, which turns gold from a number that arrives into a
**liquidity layer** that makes spells and affixes partly fungible.

And it opens a strategy that otherwise does not exist: **a deeply invested spell
is worth a lot of gold.** Consolidating three mediocre spells into two strong
ones by cashing the third is a coherent build rather than a mistake.

Two rules the mechanism does not work without, both expressed in
`dismantleValue`:

**The value scales with what was invested** — 12, plus 14 a level above the
first, plus 6 per affix tier. A flat payout means the player always dismantles
their weakest spell and the decision is empty; scaling means dismantling the
*best* spell is a real option, painful and occasionally correct.

**The exchange loses value.** If dismantling returned full value the optimal
play would be churning spells to farm gold, and a system built to express a
build becomes a grind. Hades' free respec is the deliberate exception in the
genre precisely because its Mirror is meta-progression rather than an in-run
economy; an in-run conversion charges. Sunk investment is still what makes a
slot matter, because dismantling costs real value rather than refunding it.

### The merchant, the blacksmith and the fountain

The room before the boss holds a **merchant**, who sells one card of each kind
gold can buy — a stat for 20, an affix for 30, a spell for 45 — and a
**blacksmith**, who raises a spell's level for 35 and then 60. Both take gold,
and a rare mid-run vendor room holds one of the two alone.

It also holds a **fountain**, which takes nothing: one drink restores 50% of
maximum health, and it is then dry (003). It stands in front of the two of them,
so the free thing is met on the way in rather than found after the gold is
spent, and the heal is something the player does rather than a number the room
applied while it was still fading in.

Two vendors rather than one shop, because it turns a single currency into a real
allocation problem: **breadth or power.** More affixes across the three spells,
or higher levels on the ones already held. Combined with dismantling, a player
who cashes in a spell arrives with gold they must split, which makes that room
the run's one genuine planning moment — roughly what Hades achieves by putting
Charon's shop and a Daedalus Hammer in the same stretch of a biome.

The merchant sells affixes at **base tier only**, and the stock is three cards
rather than a catalogue, so the build stays luck-shaped. Charon's stock in
Hades is random for the same reason. The stock is never the door's own kind and
never gold: the merchant's room is reached through a portal like any other, and
a gold door leading to a shop that scattered coins and sold nothing is not a
reward.

| | Bought with gold | Only from the draw |
|---|---|---|
| Spell level | Yes, at the blacksmith | Elite spell cards |
| Affix, at base tier | Yes, at the merchant | — |
| Affix tier | Never | Duplicates and high-tier draws |
| New spells | Yes, at the merchant | Yes |

**Gold buys breadth and power, never depth.** The vocabulary carries the rule:
a *level* is bought, a *tier* is found.

## Four reward kinds

| Kind | What it changes | Character |
|---|---|---|
| **Spell** | What the player can do | Rare, and rarer later |
| **Affix** | How one spell behaves | The steady stream |
| **Stat** | The body's own numbers | Always usable, never decisive |
| **Gold** | Spell levels and merchant stock | The safe pick, and the liquidity |

A small, independent option set with no counting in it is precisely the question
shape doc 002 says to give Jev, and this is the part of the design that serves
the project rather than only the game. "Does this player need a new spell, an
affix, a stat or gold" is answerable from labels the run already tracks — how
many spells are held, how invested each one is, whether mana has been the
binding constraint, how much gold is unspent. It gives doc 007's pity and
temptation machinery somewhere natural to live, and revealed preference a free
second axis: which kind the player has been taking is a fact about their build
needing no new question.

Gold in the consolation position is the role Hades gives Poms of Power against
boons. With dismantling it is also the layer that lets the other kinds convert
into each other, which is a larger job than a consolation prize usually has.

## Ranged enemies stay; bullet patterns do not

There is a version of "make it Zelda" that would destroy the project's premise.
Stout's finding is that ranged enemies are what make level geometry matter, and
the inverse holds: **a melee-only enemy set makes room geometry tactically
inert.** A game where nothing shoots has no use for cover, sightlines, pillar
counts or openness, which is to say no use for doc 004. Zelda 1 was never
melee-only; the Octorok throws rocks and the Wizzrobe fires through walls. So
the ranged role is load-bearing here in a way it would not be in a pure melee
game, and anything done to bullet counts has to keep it.

But a melee player cannot arrive through a bullet pattern. A ranged enemy fires
**single, slow, telegraphed shots** — one projectile, seconds apart, after a
visible windup — and there are two bullet behaviours in the game rather than six
archetypes' worth of patterns, with no spread anywhere. A ranged enemy's job is
to **deny ground**: one slow projectile down a corridor makes that corridor cost
something to cross, which is a positional problem the room's geometry
participates in. That is the same job Stout gives Far enemies and it survives
the density cut completely.

The windup is not invented: it is Zelda 1's own pause before an Octorok throws,
and it agrees with the finding that a readable anticipation runs 15 to 20 frames
at 30 fps, two to two-and-a-half times the 0.25 second reaction floor. A shot
the player cannot see coming is not a hazard, it is a tax.

Doc 005's pattern DSL — rhythm, shape, texture, `rest`, `gap_deg`, `size` —
exists to make dense volleys readable, and the answer here is to stop emitting
dense volleys. It earns its keep only for **boss phases**, where density is the
point and the player is not trying to close on anything.

## What the melee game asks of the enemies

Doc 005 owns the roster; these are the rules a melee player's existence imposes
on it, and they are the reason arriving is possible at all.

**No contact damage.** An enemy hurts the player with a hitbox that has a
facing and a window, never by occupying the same space. Those two properties are
exactly what a collision cannot have: a facing means stepping aside works and
standing behind a charging body is safe, and a window means the recovery is the
player's turn. A body on top of the player hits them whichever way either is
facing, which is not an attack, and narrowing it to the lunge frames does not
help. Ranged archetypes have no blade at all — walking into a turret is
harmless, because its attack is the ring it fires and being on top of it should
be the safest place in the room rather than a second cost for having closed.

**Perception is delayed, per archetype**, from 130 to 320 ms. The player reacts
in about a quarter of a second and an enemy reading the live world every frame
reacts in none, which is an unfairness rather than a difficulty setting. The
rusher is quick-witted and the tank is slow, so the tank can be *led*: walk
across its face and it commits to where you were, which is the entire reason its
charge can be dodged and steered.

**A body glances rather than tracks.** Facing follows a position sampled every
520 ms, turned toward at a rate scaled by weight. A room of creatures aiming at
the live player every frame swivels in lockstep, never late and never mistaken,
which is unnerving rather than dangerous; a head that is usually a little behind
and occasionally quite wrong is what makes it an animal.

**A telegraph stops tracking before it commits.** Tracking until the instant of
commitment cannot be dodged by angle at all — every sidestep is answered by the
blade turning — so the only answer left is distance and every attack kind
collapses into one. The first 150 ms of the 280 ms windup tracks and the
remaining 130 ms is locked, which with the 190 ms lunge gives 320 ms to leave
the sector. The hitbox is armed inert at the start of the windup, so what the
renderer draws *is* the box that will be tested: the player is reading the
attack rather than a decoration of it.

**Only two bodies may attack at once, and only two may be shooting.** A shared
token pool, claimed to commit and returned when the attack ends or is
interrupted. Six bodies that may each commit whenever they like will sometimes
all commit at once, and no position answers six simultaneous attacks, so the
only strategy left is to keep running. The Arkham games cap it at two or three
and this is the standard construction. Its visible half matters as much: a body
with no turn holds a ring *further out* than it strikes from, so the floor
around the player stays theirs and the two that came closer are legible as the
two that are committed.

**A sword hit flinches; it does not cancel an attack.** A body that is not
attacking stops for a moment and its turn goes back to the pool, once a second
at most. An attack already under way — a windup, a lunge, a shot being aimed —
is finished through the blows. Every hit used to cancel whatever the body was
doing, and a held sword swings faster than any windup, so holding the button
kept everything in reach from ever attacking: the tell is there to be dodged,
not out-clicked. What does cancel an attack is a heavy spell (weight 1.2 and
up, once in 900 ms) and **breaking a body's armour**, because **an enemy whose
state the player cannot touch is an obstacle, not an opponent**: a tank's
armour is the right to interrupt it, earned two hits into the fight, and the
break is its own moment.

**Bodies have mass.** Acceleration is 320 px/s² scaled by weight, so every
archetype takes about a third of a second to reach its speed and the same to
give it up, and turn rate is 400 degrees a second likewise scaled. That is what
makes juking work; raw speed never was the issue, since the fastest body moves
at 92 against the player's 240. The same weight figure drives the turn, the
acceleration, the lean, the bob and the gait, declared once in the stat line
rather than authored five times. Nothing alive travels at a constant speed:
each archetype has a **gait**, a push-and-settle cycle whose average is exactly
1, so the balance is untouched and only the texture changes. A rusher darts, a
tank plods.

**Fairness is cheaper than difficulty**, and two techniques from Lars Lidén's
*Artificial Stupidity: The Art of Intentional Mistakes* are worth more than any
tuning pass. A body **moves before it fires**: the alert beat says *it has seen
me*, the engage delay says *and it is coming*, and only then does anything land.
And it **misses the first time**: the first attack each body makes in a room
does no damage, so the shape, the reach and the rhythm are shown at full
strength without charging the player a heart for learning them.

**A ranged body is silent up close and cannot move and shoot.** Inside 78 px it
stops shooting and backs off, because arriving is the answer and arriving has to
be worth something; inside 125 px it may only fire while standing still, because
an archer must not have a completely safe firing position and "always one more
step backwards" is one. Retreating is a budget — a second and a half of giving
ground, then three-quarters of a second winded — because a player who is also
dodging, and whose swing slows them, never quite arrives otherwise.

## Screens, menus and the HUD

**Menus.** The game opens on a title card over the first room, which stands
still behind it. `Esc` pauses and opens the menu — Resume, Character, Settings,
Controls, Return to title — and every menu page, like every modal screen, stops
the fight. Settings: damage dealt and damage taken as multiples from x0.25 to x3
for tuning the difficulty to the player, floating damage numbers, an invincible
switch for testing (hits land, no health is lost), the room plan page, sound,
and a language row that shows English until the game is translated. Settings are
remembered in the browser.

**Between rooms**, a portal opens onto a screen that says the next room is being
generated — with the seconds counting once it passes one, because the Director
waits on Jev's round trips and a frozen frame reads as a hang — and then lays
out the plan: the space, mood, tension and floor features, the encounter
profile, bodies, waves and pressure against its band, any elite affixes, what
the room pays, and **who decided each part**, Jev or the rule arm. The room
starts when the player presses Enter. The page can be turned off in Settings (it
is on by default), and then the room starts the moment its plan is ready; the
generating screen stays either way.

**The HUD is an overlay on the room**, laid over its border walls, not a strip
below it: health and mana top left, gold as a coin and a number top right, and
along the bottom centre an **action bar** after Diablo's — a slot per verb
(attack, the three spells, spin, dodge), each with its icon, its cooldown
sweeping down over it, dimmed when it cannot be afforded, a count or level in
the corner, and its key on a **keycap** beneath. Key letters mixed into words
("L spin", "U Magic Bolt") cannot be told from the words; a keycap is a
different shape from text. The bar is **two groups**: the three spells in the
middle at full size in blue — the build, which changes from run to run — and
the attack, spin and dodge to their right, smaller and in bone, on their own
backing, because they are the body's own verbs and in one row the six read as
the same kind of thing. The boss's bar sits above the action bar. The status
line only speaks when there is something to say — a reward waiting, a death,
what was just taken — and the room number, stage and enemy count live on the
character screen.

Banked spins show twice: as pips **over the player's head**, the one number the
player needs mid-fight and where their eyes already are, and as the gauge in the
status bar, which carries how close the next one is. The status bar names both
gauges with their keys, "L spin" and "K dodge".

**The character screen** (`Tab`), after Astral Ascent's inventory: the spells
down the left with their keys and filled affix pips, the chosen one's card on
the right — what it does, what it costs, and its three affix slots, filled or
empty. Under the spells are the **attributes**: health, mana and rage as
`now/max`, gold, and every modifier the run has applied as the change it made,
with the stat cards taken named. Enter picks a spell up and Enter on another
swaps their keys.

The same screen is how an affix is attached. An affix card opens it with the
affix in hand and asks which spell takes it; a spell that already holds it shows
the tier it would rise to, one that cannot use it is greyed out with the reason,
and a full one asks which of its three affixes is given up — lost, not sold.
Taking a spell card with all three keys full opens the screen with the spell in
hand and asks which key it takes, showing what is on that key now and which
affixes go with it (doc 003).

**The affix slots are what replace the rotation.** A spell the player has fed
three affixes into is a spell they want to press, and the investment is what
makes the slot matter rather than the input scheme. This is why three keys with
three affix slots works where three keys with none would not: the commitment
lives in the spell, not in the rotation.

## Architecture

Attacks are short-lived hitbox entities carrying
`{ damage, force, team, hitid }` with a lifetime equal to the animation window,
rather than a per-frame geometric query against the player's position.

Three independent codebases converged on this: Nuclear Throne's `Slash` (a
projectile subclass whose `hitid` exists precisely so a multi-frame hitbox
cannot hit one target twice), CrossCode's spawned proxy entities, and Oracle of
Ages. It also suits a fixed-timestep headless simulation, because the hitbox is
state a test can inspect between ticks.

Two deduplication strategies, chosen per attack:

- **One hit per instance** (`hitid`) for a swing. The spin is the same
  mechanism with the list cleared once a turn, so a body inside the ring is
  struck once per pass.
- **A per-target retrigger cooldown** for anything lingering. Vampire Survivors
  ships `hitBoxDelay: 1700`: a persistent hitbox may re-hit the same enemy only
  every 1.7 seconds.

Multi-target resolution needs a deterministic tie-break, or the simulation stops
being reproducible the moment an arc catches two enemies. Crypt of the
NecroDancer's rule is the one to copy and it is already phrased as a game rule
rather than an implementation detail: **nearest first, then leftmost.**

**Animation priority replaces per-move cancel tables**: dash above sword, one
number per action instead of a matrix of windows.

**Hitstop is asymmetric.** Doc 008 freezes the world for one to six frames; for
melee the victim freezes longer than the attacker, which produces the sense of
keeping pressure rather than trading. Hyper Light Drifter players exploit
exactly this to lock bosses while continuing to act. Three frames on a light
hit, five to six on a heavy, eight to twelve on a kill, victim longer than
attacker throughout.

## Where the numbers come from

Two sources, used for different things. A Link to the Past supplies arc
geometry, measured from the ROM's own tables rather than from any secondary
description. bobbylight/ZeldaJS supplies frame choreography, which is
frame-counted in gameplay logic and therefore ports directly.

| A Link to the Past | Measured |
|---|---|
| Swing arc | 79.3 degrees left and right, 82.3 down, 94.4 up |
| Tip radius | 17 to 29 px through the swing, about 1.8 tiles |
| Swing | 3 frames windup, 7 active, 3 recovery, 13 total, rooted |
| Per-enemy hit immunity | 29 frames |
| Attacker lockout on connect | 4 frames |
| Spin attack | 48 frames charge, 34 committed, 44x45 box, knockback 64 against 80 normal |

**The arc there is 80 to 94 degrees, not 180.** Worth stating plainly because
the folklore says otherwise and a 180-degree sweep is a much more forgiving
weapon. The wide cleave in that game is the spin, and it is gated behind 48
frames of charge, 34 of commitment, and *reduced* per-target knockback. Area is
paid for, which is why the spin here costs a rage segment.

From ZeldaJS, whose sword is a box rather than an arc, so the geometry is not
reusable but the timing is: a 15-frame swing whose frames 4 to 11 are the only
active window, two frames of visual retraction with the hitbox zeroed, a forced
pause, and a lockout of about 16. Knockback 4 px per frame, with enemies
sliding 30 frames and **the player 15** — the same hit is half as disruptive to
the person holding the controller. Player invulnerability 60 frames.

Cross-checked on reach and cadence: Death's Door exposes reach ratios of
1.8 : 2.5 : 3.0 for dagger, sword and greatsword, swing times of 0.35, 0.40 and
0.50 seconds, and scaling of +0.2 damage and +0.1 range per upgrade; Nuclear
Throne puts melee cooldowns at 9 to 35 frames at 30 fps against 1 to 6 for its
rapid guns. **Melee is the slow, high-commitment option by an order of
magnitude**, and that is what earns it the damage and the area. Brotato states
the trade in one field: its sweeping Mace has *shorter* reach than its thrusting
Sword, 150 against 200 units, and pays a full attack-speed penalty for double
damage. A sweep is wide and short.

## Out of scope

- **A melee-or-ranged tag on spells.** It would leave a specialised build
  looking at a pool half of which is inert, the reward system doing what doc 001
  forbids encounters from doing.
- **Carriers.** Every spell installable onto a melee, a ranged or a pet carrier
  would require three implementations each, tripling content cost and dissolving
  every spell's identity into three weaker variants.
- **Compulsory melee.** Removing ranged output entirely makes arriving a tax the
  player pays every room with no say in it, and by Sid Meier's test it is not a
  decision at all: no trade-off, no situational variation, the same correct
  answer every time.
- **Frequency-based art stacking**, and combos generally. Arts firing on
  different swing intervals so they interleave asks the player to count, and
  players do not count.
- **A four-spell rotation.** Its virtue is real — every slot matters constantly
  — but the player never chooses which spell to cast. Direct key binding wins
  and the affix investment does the work the rotation was doing.
- **A regeneration-rate stat** beside max mana, and any numeric affix. Both
  re-create the stat screen the two-pool rule exists to prevent.
