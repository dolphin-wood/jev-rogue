# Enemy expansion — new archetypes, new attack kinds, elite attacks

A **proposal**, not a decision. Nothing here is committed; the point is to put
concrete numbers, telegraphs and art costs on the table so the choice of what to
build is made against figures rather than against adjectives.

Conventions follow the ones already in force: a telegraph that can cost more
than chip runs **≥ 36 frames at 60 Hz** (`docs/research/enemy-design-survey.md`,
§1), facing **locks before the active window** and never tracks during it (doc
013, "A telegraph stops tracking before it commits"), **one trick per body**,
and an elite changes **where you may stand or when you may hit**, never how long
the body takes to die (survey §3).

Frame counts below are at 60 Hz. Where the code carries ms, both are given.

---

## 1. What the roster lacks, by role

Eight assemblable bodies (`ENEMY_IDS` in `packages/core/src/encounters/enemies.ts`)
plus the boss. Each gap below is a thing the code makes *structurally* absent,
not merely unrepresented.

### 1.1 Nothing denies an area over time except one body's flame

`RangedKind` in `packages/core/src/types.ts` is exactly two values,
`"lightning" | "flame"`, and each is carried by exactly one archetype: the
turret (`ranged: { kind: "lightning", interval_s: 5.2 }`) and the summoner
(`ranged: { kind: "flame", interval_s: 7 }`). Lightning is instantaneous — a
`Strike` with `STRIKE_MARK_MS = 900` then an 180 ms flash, and `stepStrike`
returns true on exactly one step. So the only attack in the game that takes
floor out of play is one summoner's fire, about **one patch per seven seconds**,
`FIRE_RADIUS = TILE_PX * 0.85`, `FIRE_LIFETIME_MS = 3200`, and `ROSTER_CAP`
holds the summoner at one per roster. A room's floor is essentially never
contested.

`HazardEffect` already names `slow_tick`, `slip` and `collapse`, but those are
*room features* (doc 004). **No enemy can create any of them.**

### 1.2 Nothing punishes dash spam

Every attack in the roster resolves inside a single active window.
`MELEE_ATTACKS` entries are `windupMs / lungeMs / recoverMs` with one hitbox
armed by `armMeleeAttack` and advanced by `advanceBox`; there is no scheduler
for a second beat, no delayed hitbox, no hazard left behind by an attack. The
`Strike` is one flash. Bullets are points in flight.

Consequence: the dash's i-frames beat **100% of the roster's damage sources**,
because none of them is still dangerous after the window the dash covers. There
is nothing that is fine to dash *through* and fatal to stand in afterwards, and
nothing whose second hit lands where the dash ends.

### 1.3 No shielded front — no damage in this game has a direction

`hurtEnemy` in `packages/core/src/sim/world.ts` takes `(w, e, raw, tag)`. It
reads `e.frozenMs`, `e.armour`, `w.dealtMult`. **It does not take an angle and
has no access to one.** `canStagger(e)` is `e.armour <= 0` — armour is an
omnidirectional pool, per-archetype in `ARMOUR`, and the tank's is the only
sizeable one (18 of its 34 hp).

So "get behind it" is never a damage question. The tank's back is safe only in
the narrow sense that `chooseMelee` picks `cleave` over `charge` when the player
is behind it. Flanking is not a mechanic the game contains.

### 1.4 No support — the only enemy-to-enemy relation is `SummonRule`

`EnemyDef.summon: SummonRule | null` is the whole of it, and only the summoner
carries one. Nothing heals, shields, hastens, re-arms or resurrects another
body. Elite affixes are baked in at spawn: `makeEnemy(id, archetype, x, y,
affixes)` sets `armour: (ARMOUR[archetype] ?? 0) * stats.hp_mult` once, and
`applyEliteAffixes` runs at assembly time. **There is no runtime path that gives
a living body armour**, which is exactly the Bell-Caster the survey (§7, item 8)
named as "the cleanest decision object". The roster has one kill-order question
(the summoner) and it is a production question, not a protection one.

### 1.5 No zoning line attack

Every threat shape in the game is a **point** or a **blob**: the strike circle
(`STRIKE_RADIUS = TILE_PX * 1.2`), the fire patch (0.85 tile), the melee sector
(`sectorHits` — an arc about an origin), the bullet. The sentinel "draws a sight
line along the lane while it aims" (doc 005) but that line is aiming decoration;
the hitbox is the bullet travelling down it. Nothing occupies a long thin region
of floor, so the answer to every attack in the game is *distance* or *which side
of a body*, never *which side of a line*.

### 1.6 Nothing uses the player's elements against them

The status fields on `Enemy` — `burnBuild`, `poisonBuild`, `chillBuild`,
`frozenMs` — are strictly player→enemy. `stepFires` returns `{ enemies, playerBurning }`,
so a fire hurts enemies at `FIRE_ENEMY_DAMAGE = 4` and the player via a gauge;
the sign is the same for everyone. The only element-facing enemy property in the
game is the `shielded` affix, which is pure negation ("immune to elements; only
direct damage"), i.e. it deletes a build's answer rather than changing it. There
is no body that *wants* to be set on fire, none that a freeze opens up
differently from a stagger, none that makes a fire build read the room
differently.

### 1.7 Nothing moves the player

`spec.knockback` shoves whoever is hit, and `SWING_KNOCKBACK = 80` was cut from
220 precisely because displacement broke the exchange. Nothing **pulls**, and
nothing relocates the player deliberately into another body's arc. The one thing
that makes a room composition more than a sum — one enemy putting you inside
another's answer — has no mechanism.

### 1.8 Nothing is untargetable, though the flag exists

`Enemy.airborne` is in the type, `stepSwing` skips `e.airborne`, and only the
boss's leap sets it. No trash body can remove itself from the player's reach, so
the player always chooses when to fight everything. Burrow/blink-out is one flag
away and unused.

### 1.9 Composition holes in `assemble.ts`

`MIX_RATIOS.melee_heavy` is `{ rusher: 0.65, orbiter: 0.25, tank: 0.1 }` — three
ids, and the orbiter is classed `ranged` in `CLASSES`. So the game's melee room
is **two-thirds one archetype** and its only other melee body is capped at one by
`ROSTER_CAP`. `siege` is `turret .35 / sentinel .25 / shooter .25 / rusher .15`,
three of which are point or bullet threats, and its two emplacements are both
capped at one — a dense siege room is mostly shooters.

The Director's `anchor` has exactly two non-`none` values, `tank` and `summoner`
(doc 005's profile table): one that walks you down and one that produces. There
is no anchor that *protects*.

### 1.10 Two smaller findings, noted in passing

- **The threat tables disagree.** `THREAT` in `assemble.ts` reads
  `rusher 1.0, tank 3.0, summoner 3.0, lancer 1.4`; `threat_weight` in
  `enemies.ts` reads `1.25, 5.0, 4.5, 1.6`. `THREAT` feeds `meanThreatOf` only,
  but any new weight has to be added in both places or the composition's option
  tier drifts from its measured pressure.
- **Two melee kinds are already free.** `thrust` and `whirlwind` are complete
  `MELEE_ATTACKS` blocks that no body carries (the `whirlwind` comment says so
  outright). Doc 005: "a new archetype is a parameter block away." Any proposal
  below that needs a blade needs no new melee system.

---

## 2. Seven proposed archetypes

Each is written as: fantasy — trick — attacks with frame-exact telegraphs —
movement — compositions — threat weight — **elite form, which is a different
attack** — implementation cost.

### 2.1 Warden — the shielded front

**Fantasy.** A walking door with a temper.

**The trick.** A **150° frontal plate**. Direct damage landing inside it does
15% and never staggers (`canStagger` already gates on a pool; this gates on an
angle). Everything outside the arc is normal. It is the first body in the game
whose answer is *position*, not spacing or timing.

**Attack A — `bash`** (a new `MELEE_ATTACKS` block, no new system):
`bladeDeg 90, sweepDeg 0, reachTiles 1.0, damage 0.8, knockback 520,
commitSpeed 1.8, windupMs 640, lungeMs 200, recoverMs 620, restMs 1600,
commitRange 60, stunsOnWall true, recoilSpeed 0`.

| phase | frames | what is drawn |
|---|---|---|
| windup | **38** (640 ms) | plate raised, body leaned back; a 90°-wide threat wedge at 1 tile. Tracks for the first 9 frames (150 ms per doc 013), locked for the last 29 |
| active | 12 (200 ms) | the plate slams forward at 1.8× its walk |
| recover | 37 (620 ms) | planted, back fully open |

**The knockback is the attack, not the damage.** 520 is the largest in the game
(the tank's charge is 420). 0.8 hearts is cheap; being shoved onto a turret's
marker or into a fire patch is not. This is the body that makes the rest of the
room's ground matter.

**Attack B — `plant`** (its second move, per doc 005's validation rule): 18
frames of grounding the plate, then 120 frames standing, during which it cannot
turn (turn rate 0) and **bullets do not cross its 150° arc** — so it screens the
room's shooters. The counterplay is free: walk around it. The cost is tempo.

**Counterplay.** Dash through it (i-frames carry the player past the plate, and
the plate *is* its facing, so a committed bash is 37 frames of open back); spin
behind it once rage is up. **Ice** is the specific element answer: chill halves
its turn rate, which is the single stat the plate depends on, so flanking
becomes free; a **frozen** warden's plate drops with its action and the shatter
lands at full ×3. **Fire** does nothing special to it — deliberately, because
doc 001 permits pressuring a build and forbids nullifying one, and one body per
room that a fire build must solve positionally is pressure.

**Movement.** `chase`, speed 46, heavy turn scale, always orienting to the
player. It does not need to catch you; it needs to be between you and the room.

**Compositions.** `melee_heavy` (which needs a second melee body badly),
`siege` (a mobile screen for emplacements), `mixed`. **Anchor-eligible** — the
third anchor flavour: not "it walks you down" and not "it produces" but "it
stands in the way".

**Threat weight** 3.4, `ROSTER_CAP` 1.

**Elite — Shield Throw** (a different attack, not a stat). 54 frames of the
plate drawn back and spinning up, then it is hurled as a disc: 36 frames out
across 5 tiles, 44 frames back, 1.1 hearts on either leg, travelling a fixed
line it cannot re-aim. **For those 80 frames the warden has no plate at all** —
it is the most open body in the room and the disc must be dodged twice. The
elite's change is that it *opens a window it did not have*, which is the survey's
rule exactly: where you stand and when you may hit.

**Implementation.** Reuses `MELEE_ATTACKS`, the attack-token pool, `stagger`,
the threat-wedge renderer, `stunsOnWall`. **New:** an angular damage filter —
one function read by `hurtEnemy` and by the bullet hit path, where nothing
currently reads an angle — plus a `plate` flag. The elite disc wants a return
leg, which `bullets.ts` has no concept of (~20 lines, or a small dedicated
entity).

### 2.2 Bellringer — the support

**Fantasy.** A hooded chime on a pole that never once swings at you.

**The trick.** It **arms other bodies**. The pure kill-order object the survey
names, and the roster's first enemy-to-enemy relation that is not production.

**Attack A — `tether` (ward).** 40 frames of raising the chime — the only
telegraph it has — then a pale, steady line attaches to the nearest living ally
and **stays**. While it holds, that ally carries 18 armour (a tank's) and cannot
be staggered. It re-attaches 90 frames after its ward dies. Nothing about it
damages the player except the self-destruct described below.

**The cut.** Standing anywhere on the tether line for **20 continuous frames**
breaks it and staggers the bellringer for 60. So the line is a *place the player
is invited into*, and it usually runs across the room's worst ground — which is
the entire design: the support makes the floor the question.

**Attack B — `slow field`** (its second move): 30 frames of the chime rung
downward, then a 2.5-tile **cool, still, non-damaging patch** under itself for
4 s that takes 25% off the player's move speed. It protects itself exactly where
the player must stand to kill it.

**Two rules taken from Hades' Voidstone** (§7.1). **Its death strips every ward
it placed**, immediately — so the kill-order answer pays off visibly rather than
merely stopping future wards. And **with no living ally for 90 frames it
self-destructs**: 48 frames of telegraph, then a 2-tile ring for 1 heart. A
support with nothing to support is otherwise a 16-hp body standing still at the
end of a cleared room.

**Counterplay.** Kill it — hp 16, the lowest in the roster — or cut the line.
**Poison** is the element answer: poison takes a quarter off movement speed
(doc 013), and re-tethering is a walk, so a poisoned bellringer is one that
cannot re-arm.

**Movement.** `keep_distance`, far (target ~180 px), and it retreats *behind* the
body it is warding, so its own ward is its cover.

**Compositions.** `ranged_heavy`, `mixed`, `siege`. **Anchor-eligible.**

**Threat weight** 3.4 nominal. Its real cost is the body it arms, which the
pressure formula cannot express as a constant; flag for the harness (doc 011)
that it should be measured as `2.6 + 0.5 × mean roster threat` or calibrated
directly against hearts lost, not assumed.

**Elite — Peal** (a different attack). No tether at all. It rings, and the ring
is a **radial wave**: 66 frames of windup (chime drawn back, a growing ring
decal), 12 active, 48 recover, arming **every ally within 4 tiles for 4 s** on a
5 s cycle. There is no line to cut, so the counterplay inverts — the only answer
is to be *on* the bellringer during the 66-frame windup, and the 48-frame
recovery is the one moment the room is not armed.

**Implementation.** Reuses `armour` and `canStagger` wholesale (armour is
already a runtime field, not an affix). **New:** a tether entity — two ids, a
point-to-segment test, a break timer — and its renderer. The elite peal reuses
`Strike`'s ring decal at a larger radius. The slow field reuses the fire pool's
shape with damage 0 and a speed multiplier.

### 2.3 Rifter — the zoning line

**Fantasy.** Something half-buried that cracks the floor open toward you.

**The trick.** It denies a **lane**, not a point. Where the turret says "not
there", the rifter says "not that route".

**Attack A — `rift`.** 54 frames of the floor cracking along a **6 × 1 tile
capsule** from the rifter toward the player's last-seen position (doc 013: a body
aims where it last saw them; the line is fixed the instant it is drawn and never
re-aims). Then 14 frames of eruption, 1 heart. The spent rift stays as a cooling
scar for 90 frames with no effect, which reuses `scorch`.

**Attack B — the cross.** Every third rift is **two capsules at 90°**, so
"step sideways" is the wrong answer once in three and the player has to read
which decal was drawn before they move. The archetype's first rule plus one
inversion of it, as doc 005's validation rule asks.

**Counterplay.** The lane is long and thin: the answer is *across* it — one dash
or two steps — and it is the first attack in the game whose answer is a
direction rather than a distance. It is stationary and fragile (hp 24), so it is
a body the melee player gets to walk up to and delete; the price is that the
walk is along its lane.

**Element.** **Ice** freezes it mid-telegraph and the rift never opens, which is
a clean demonstration that a freeze cancels a wind-up — something no body in the
roster currently shows, because nothing has a wind-up long enough for the player
to react to it *with a spell*.

**Movement.** `stationary`, `aggro_range` 250.

**Compositions.** `siege` (its natural home — siege's four bodies are three
point/bullet threats and a rusher), `ranged_heavy`, `mixed`. Not an anchor.

**Threat weight** 2.2 — just above the turret's 2.0: the same "be somewhere
else", over more floor.

**Elite — Fissure Walk** (a different attack). Not one line but **four segments
walking toward the player's current position, one placed every 12 frames, each
erupting 24 frames after it appears** (the survey's Rootcaller, §7 item 6). The
question becomes sustained lateral movement for a second and a half rather than
one sidestep. The segments track *while being placed*, which is legal because
the placement **is** the telegraph — nothing tracks after it is drawn.

**Implementation.** Reuses `Strike` (`markStrike` already fixes the spot at mark
time; `strikeHits` generalises from circle to capsule — one function),
`scorch`, the telegraph renderer. **New:** the capsule decal and, for the elite,
a small multi-segment scheduler.

### 2.4 Snarecaster — the pull

**Fantasy.** A chain on a long arm.

**The trick.** It **moves the player**, into other bodies' arcs. The roster's
first mechanism for a composition to be more than a sum.

**Attack A — `tether` (hook).** 44 frames with the chain drawn on the floor
along the exact line it will fire (the survey's grappler: the line is the
telegraph). 20 frames of travel. On a hit, 40 frames of retract that drag the
player about 4 tiles toward it, dropping them a tile short, staggered 12 frames.
Damage 0.5 — the displacement is the attack.

**Attack B — the whip-back.** On a **miss**, 24 frames later the chain snaps
back through a 180° arc **behind** the snarecaster. This is the roster's first
attack with a second beat, and it is aimed squarely at the reflex it exists to
break: dashing *through* a telegraph and landing behind the body is currently
free everywhere in the game.

**Counterplay.** Dash through the chain — the i-frames beat it, and this is the
clearest lesson in the game that the dash is a tool and not a retreat. Or break
line of sight on a pillar, which finally makes doc 004's geometry matter to a
melee threat. The 50-frame retract is the punish window.

**Movement.** `keep_distance` at ~150 px. It never closes.

**Compositions.** `mixed`, `ranged_heavy`, `siege`. Not an anchor — it is a
partner, not a centre, and its weight should be measured in a room that has
something to throw you at.

**Threat weight** 2.8.

**Elite — Chain Mine** (a different attack). The elite does not pull. It hooks
the floor and leaves the chain **anchored between itself and a point 5 tiles
away**: a live line costing half a heart to cross, for 5 s, re-cast every 7 s.
It cages ground instead of moving the player — the Dead Cells elite pattern the
survey names in §3 (the electric cage, the force field held by crystals).

**Implementation.** Reuses the tether primitive (shared with the bellringer) and
the existing knockback displacement path. **New:** a retract that *sets player
position from an enemy*, which nothing currently does; the whip-back is a second
`MELEE_ATTACKS` block scheduled off the first.

### 2.5 Delver — burrow and emerge

**Fantasy.** Something that treats the floor as a door.

**The trick.** It is **not there**. The player does not get to choose when to
fight it, which inverts the `aggro_range` design (doc 005, "Enemies sleep until
noticed") for exactly one body.

**Cycle.** Surfaces → 2.5 s as an ordinary short-reach melee body (`bristle`,
damage 0.6) → **burrows** (30 frames) → travels as a visible mound at 1.4× its
walk for 60–120 frames along a line locked at burrow → **emerges**: 36 frames of
the mound halting and the floor humping, then 12 frames of eruption in a
1.2-tile circle, 0.9 hearts.

**Counterplay.** The mound is visible and slower than the player; the emerge spot
is fixed the moment the mound stops, 36 frames ahead. The lesson is **lead it**
— walk it into a fire patch or under a turret's marker. It cannot be hit while
under, which makes it the roster's first untargetable trash body.

**Element.** Burn and poison **persist through the burrow** (the gauges live on
the body, not on the surface), so a burning delver that dives comes up nearly
dead. It is the one body where a status build is rewarded for hitting something
that then runs away.

**Movement.** `chase` surfaced; a straight, locked line under.

**Compositions.** `melee_heavy`, `mixed`. Not an anchor.

**Threat weight** 2.0 — low damage, high tempo cost.

**Elite — Breach Line** (a different attack). It does not emerge under the
player; it emerges **three times in a row along its travel line, 24 frames
apart**, each a smaller circle. The answer changes from "step off one spot" to
"move perpendicular to the mound's heading", which is a different read of the
same telegraph.

**Implementation.** Reuses `airborne` (already skipped by `stepSwing`),
`bristle`, `Strike` with a shorter mark. **New:** the travelling mound decal and
a submerged state that skips collision, bullets and the swing.

### 2.6 Cinderling — the element turned around

**Fantasy.** A coal that walks, and is delighted to be set on fire.

**The trick.** **It eats the player's fire.** Burn damage heals it instead
(`stepFires` already returns a list of enemies to damage — one sign flip, on one
archetype), and while it is burning it moves 30% faster and its patch attack is
a third larger. The room's own fires feed it too, so a summoner in the roster
makes the terrain ambiguous.

**Attack A — `lob`.** 48 frames of windup, then an arcing coal with a visible
shadow and a growing landing ring, ~40 frames of flight, landing in a patch of
burning ground (`lightFire`, existing radius, existing pool and cap). The
landing point is fixed at release.

**Attack B — the cinder trail.** While burning, it drops a half-size, half-life
patch every 40 frames along its path. Its second move is its first one made
involuntary, which keeps it learnable.

**Counterplay.** **Ice**, exactly: chill cancels the speed bonus, a freeze makes
it brittle, and the shatter is ×3. **Poison** works normally. The **sword** works
normally. This is pressure on one element, not immunity to it, which is the line
doc 001 draws and which the `shielded` affix currently crosses from the wrong
side.

**Movement.** `chase`, slow (speed 60), and it steers *toward* fire rather than
around it.

**Compositions.** `melee_heavy`, `mixed`; and it pairs with the summoner, which
makes those two a composition rather than two bodies. Not an anchor.

**Threat weight** 2.4, with a note for the harness: it is the first archetype
whose threat depends on another body in the roster, and it must be sampled with
and without a summoner.

**Elite — Flare** (a different attack). When its burn gauge fills, the elite
**detonates it**: 60 frames of the body going white-hot with a growing ring,
then a 2.5-tile ring of burning ground placed at once. Setting it on fire stops
being merely useless and becomes the timer on an attack, so the answer becomes
"stop applying fire and close", which is a real decision a fire build has to
make mid-room.

**Implementation.** Reuses `fire.ts` entirely — `lightFire`, `stepFires`,
`FIRE_POOL`, the burn gauge on `Enemy` — and the `leavesFire` bullet path the
summoner's throw already uses. **New:** a per-archetype sign on fire damage
(three lines in `stepFires`' consumer), and the lob's arc plus reticle, which is
the one genuinely new visual.

### 2.7 Sower — the delayed mine

**Fantasy.** A drifting pod that plants.

**The trick.** It punishes **the dodge, not the position**. Its seeds arm after
the window a dash covers.

**Attack A — `mine`.** It drifts and drops a seed every 90 frames. A seed is
inert for 48 frames (a dim pip), arms with a 12-frame flicker, then detonates on
proximity (0.8 tile) or after 8 s: 0.7 hearts in a 1.2-tile circle. Up to 6
alive per sower.

**Why it answers 1.2.** An i-frame dash crosses a seed harmlessly — and the seed
is still there when the dash ends, and the dash's recovery is where the player
stands. Nothing in the roster is dangerous after the dodge; this is the cheapest
thing that is.

**Attack B — the shed.** On death it drops its whole held cluster at once, armed
immediately. Killing it is correct and is not free.

**Counterplay.** **The sword detonates a seed at reach** — a mine is
destructible — so clearing ground becomes a job for the swing that is not a
body, and the spin clears a cluster, which is a second use for the rage gauge.
**Fire** chains a whole cluster at once, which makes a fire build a minesweeper:
an element working *for* the player, which the roster currently never offers.

**Movement.** `orbit`, at a wide radius — the orbiter's behaviour with a
different job, so the ring of seeds closes on the player over the fight.

**Compositions.** `ranged_heavy`, `siege`, `mixed`. Not an anchor.
`ROSTER_CAP` 1: two sowers is a floor of pips.

**Threat weight** 2.6.

**Elite — Bloom** (a different attack). No drip. It plants **a ring of eight at
once** around the player's position: 54 frames as eight pips appear, all arming
together, with **two gaps at fixed angles** — doc 005's own `gap_deg` reasoning,
that a spray with a visible hole is a question the player can read. The answer
becomes reading the gap and leaving once, rather than tracking a field.

**Implementation.** Reuses the fire pool's shape (a pooled, position-only,
lifetimed entity), `Strike`'s ring decal for the arming pulse, and the swing's
circle test. **New:** a mine pool with an arm/detonate state machine, and mines
as sword-destructible targets — `stepSwing` currently iterates `world.enemies`
only.

### 2.8 Summary table

| Archetype | Role filled (§1) | Behaviour | Threat | Anchor | Compositions |
|---|---|---|---|---|---|
| Warden | 1.3 shielded front, 1.9 melee_heavy depth | chase | 3.4 | yes | melee_heavy, siege, mixed |
| Bellringer | 1.4 support, 1.1 slow field | keep_distance | 3.4 | yes | ranged_heavy, mixed, siege |
| Rifter | 1.5 line zoning, 1.1 area denial | stationary | 2.2 | no | siege, ranged_heavy, mixed |
| Snarecaster | 1.7 forced reposition, 1.2 second beat | keep_distance | 2.8 | no | mixed, ranged_heavy, siege |
| Delver | 1.8 untargetable, 1.1 tempo denial | chase | 2.0 | no | melee_heavy, mixed |
| Cinderling | 1.6 elements turned around | chase | 2.4 | no | melee_heavy, mixed |
| Sower | 1.2 dash-spam punish, 1.1 area denial | orbit | 2.6 | no | ranged_heavy, siege, mixed |

---

## 3. Seven new attack kinds, as shared primitives

The point of a kind is that several bodies carry it and the player learns it
once. Each entry states its **telegraph grammar** — the thing that must never be
ambiguous against what already exists.

The existing vocabulary, which these must not collide with:

| Existing | Shape on screen | Says |
|---|---|---|
| strike marker (`Strike`) | a **circle** on the floor, contracting, 900 ms | leave this place |
| fire patch | a **warm, moving blob** | this floor is gone for a while |
| scorch | a **dark, still blob** | this floor *was* gone |
| melee wedge | an **arc about a body** | leave this body's front |
| sentinel sight line | a **thin bright line from a body, fading into nothing** | a bullet is coming down here |
| bullet | a **magenta object in flight** (hard rule 8) | a projectile exists |
| ring volley (boss slam) | an expanding **ring** | radial; the centre is safe |

### 3.1 `rift` — a ground line

A floor decal shaped as a **capsule** (a rounded bar), amber, drawn from the
caster and **growing along its length** through the telegraph, then flashing
white on the active frames. Length and width are parameters.

**Reads against:** the strike marker is a *circle* (radial, "not here"); the rift
is a *bar* ("not across here"). The growth direction says where it came from.
Never drawn as a ring; never in the magenta band.

**Drawn versus live.** Taken from Hades II's Goldwraith (§7.1): the existence of
the line and the *liveness* of the line are two signals, not one. The rift is
matte and still through the telegraph and **luminous and moving** on the active
frames. By luminance and motion, not by hue — the room tint shifts hue by up to
14 degrees at load, so hue cannot carry a safety signal. This convention applies
to `tether` and `mine` too and is the one piece of visual grammar this proposal
adds to the whole game.

**Carried by:** Rifter, elite turret, elite tank. Telegraph 54 frames, active 14.

### 3.2 `mine` — a delayed seed

A small pip, a quarter tile, plus a **contracting ring at pip scale** while
inert, then a **12-frame flicker** at arm, then a burst.

**Reads against:** the strike marker by *size* and by *waiting*. Lightning is one
big circle that resolves on a clock; a mine is small, and the flicker is the only
moment it changes. Inert pips are dim and desaturated, armed pips are bright —
the same pose-not-colour discipline the dormant sheets use.

**Carried by:** Sower, elite orbiter.

### 3.3 `tether` — a taut line between two objects

**Always two visible endpoints, both of them entities.** That is the whole
disambiguation from the sentinel's sight line, which starts at a body and fades
into nothing. Two skins, same primitive:

- **ward tether** — pale, steady, slack; grants armour; broken by standing in it.
- **hook tether** — dark, drawn on the floor during the windup, snaps taut on
  fire; retracts and pulls.

**Carried by:** Bellringer (ward), Snarecaster (hook), elite summoner (ward),
elite sentinel (as a beam: a tether with one end on the wall, live for 20 frames).

### 3.4 `lob` — an arcing projectile with a landing reticle

The projectile is **visible in the air, with a shadow under it**, plus a ground
ring the shadow shrinks toward.

**Reads against:** lightning, which arrives from above with no visible source.
A lob is thrown by a body the player watched throw it, so the counterplay is
different — the reticle can be read from the thrower's pose, earlier than from
the decal.

**Carried by:** Cinderling, elite shooter. Windup 48 frames, flight ~40.

### 3.5 `bash` — a short, wide, heavy-knockback blade

A `MELEE_ATTACKS` parameter block: wide (90°), short (1 tile), small damage, the
largest knockback in the game.

**Reads against:** the existing melee wedge — same grammar, wider and shorter,
with a plate flash on the active frame. It is the only attack whose damage is not
the point, and the reading it must carry is *"you are about to be somewhere
else"*.

**Carried by:** Warden. Cost: one table entry.

### 3.6 `burrow` — submerge, travel, emerge

A **moving floor decal with a heading** while under; a circle telegraph at the
emerge, sharing the strike marker's shape at a different hue.

**Reads against:** everything, because it is the only telegraph in the game that
**travels**. That alone makes it unambiguous, which is why the emerge is allowed
to reuse the strike circle.

**Carried by:** Delver.

### 3.7 `slow field` — a cool, still, non-damaging patch

**Cool blue-grey and static**, against fire's warm and moving. No damage; a
movement multiplier. `HazardEffect` already names `slow_tick` and `slip` for room
features, so the floor vocabulary exists — this is the first one an enemy places.

**Reads against:** fire by temperature and motion, scorch by being live (scorch
is dark and fading, a slow field is pale and steady).

**Carried by:** Bellringer.

---

## 4. Elite attack variants for the existing roster

The rusher already has one: in an elite room it spawns as a **lancer**
(`world.ts`, the `LANCER_CAP` branch), which is a genuinely different attack —
the same drive from 1.5 tiles, with spikes that hang and fly off, plus a
death burst. Every other archetype's elite form is **stats only**.

That is the gap. `AFFIXES` in `packages/core/src/encounters/affixes.ts` is six
entries and four of them are pure multipliers (`armored` hp ×1.6, `swift` speed
×1.35 / interval ×0.8, `burning` a status on bullets, `shielded` an immunity);
only `splitting` and `volatile` change behaviour, and both only on death. On top
of that every body in an elite room is "enraged": `ENRAGED_SPEED = 1.15`,
`ENRAGED_INTERVAL = 0.85`. So an elite room is currently **the same fight, faster
and with more health** — precisely the thing the survey (§3) says the genre has
settled against, and precisely what doc 005 says it wants to avoid ("a harder
room that is the same bodies with longer health bars reads as the sword being
weak").

Each variant below is **one extra attack on a known body**, reusing a kind from
§3. They are applied on the same path as the lancer: a body that has drawn
affixes swaps in its elite move. Nothing about `applyEliteAffixes`,
`ELITE_SHARE`, `HEAVY_ELITES` or `strayEliteFor` needs to change — the swap is a
lookup keyed on `archetype` and `affixes.length > 0`.

### 4.1 Elite shooter — **Pin Shot** (`lob`)

Replaces the three-shot burst that closes its cycle. 48 frames of the barrel
rising, then one fat arcing shot with a landing ring, ~40 frames of flight,
landing **1.5 tiles behind the player's last-seen position** — i.e. on their
retreat line, not on them. 1 heart, 1.4-tile circle.

**Why.** The shooter's whole design is that the answer is *closing* (`enemies.ts`
at length on this). The elite does not make closing harder; it makes **backing
off** cost something, which is the one inversion the archetype has left.

**Counterplay.** Step forward. A player who reads it correctly ends the exchange
closer than they started, which is what the archetype wants taught.

### 4.2 Elite turret — **Rift Lance** (`rift`)

Replaces the point strike. 54 frames of a crack opening along a 6 × 1 tile
capsule from the turret toward the player's last-seen position, then 14 frames of
eruption, 1 heart. Interval unchanged at 5.2 s.

**Why.** The turret's comment explains that the rotating ring was replaced
because "a ring denies every direction at once, so there is no approach to
find". The rift is the next step along the same axis: it denies the *approach
route* while leaving every other route open, so the elite turret changes the way
in rather than closing it.

**Counterplay.** Cross the lane. The turret is stationary, so its lane is
predictable from where you are standing — the elite is answered by choosing a
different angle of approach before the telegraph, not after.

### 4.3 Elite sentinel — **Sight Beam** (`tether`)

Its sight line becomes real. 48 frames of aim with the existing line brightening
and thickening, then the lane is **live for 20 frames**, 1.2 hearts, full room
length, no travel time.

**Why.** The sentinel currently draws a sight line that is decoration; the elite
makes the decoration the hitbox. That is the cleanest possible elite because the
player has already been reading that line all run — the elite changes what it
*means*, not what it looks like. It is also the only attack in the proposal with
no travel time, so it teaches that the aim window, not the flight, is the dodge.

**Counterplay.** Leave the lane in the 48 frames, or break line of sight — doc
004's pillars, finally load-bearing for a melee player.

### 4.4 Elite orbiter — **Seedwake** (`mine`)

It drops a seed every second step of its orbit, up to 5 alive, each inert 48
frames then armed. Its shots are unchanged.

**Why.** The orbiter's design note says its point is "pressure from the flank, so
standing still is punished and turning to face it is the answer". The elite adds
the other half: **chasing it around the circle** is now punished too, because its
own path is where the seeds are. It closes the loop the archetype opened.

**Counterplay.** Cut across the circle instead of following it — which is the
correct answer to an orbiter anyway, taught by force.

### 4.5 Elite tank — **Shock Cleave** (`rift`)

Its overhead chop (`cleave`) sends a **4 × 1 tile rift forward** from the impact
point: the existing 620 ms windup is the telegraph, and the rift decal is drawn
during the last 20 frames of it. 0.8 hearts on the lane, on top of the chop's
1.6 in the wedge.

**Why.** The cleave is chosen when the player is on top of the tank or behind it
(`chooseMelee`), and its answer is "a step to either side". The elite keeps that
answer correct only if the step is *far enough*, which is a spacing question the
tank does not otherwise ask. It also gives the tank a reason to be feared at
1–2 tiles, where currently it is safest.

**Counterplay.** Step wider, or dash — the rift's active window is 14 frames and
lands after the chop.

### 4.6 Elite summoner — **Ward Tether** (`tether`)

It tethers its newest living minion and gives it 18 armour while the line holds.
Re-tethers 90 frames after the warded minion dies. Its flame and summon cadence
are unchanged.

**Why.** The summoner is already the roster's kill-order question, and the elite
sharpens it rather than adding a second one: a rusher you cannot stagger is a
rusher you must either walk past or pay for. And the tether is cuttable by
standing in it, so it also hands the player a route they can *take*, which is
what keeps the elite from being a tax.

**Counterplay.** Cut the line (20 continuous frames in it), or accept the armour
and go for the summoner — the tether line points straight at it, which is a
telegraph the archetype has never had.

### 4.7 What this does to the elite room

Six elite variants, each reusing a kind from §3, give an elite room a different
*shape* rather than a different scale. The existing multipliers stay; they are
fine as texture. What changes is that the elite door now promises a fight the
player has to re-read, which is what doc 005 says it was always supposed to
promise.

---

## 5. Recommended first batch

### Build order: elite attacks before new archetypes

**Batch 0 — three attack kinds plus the six elite variants that use them.**
**Batch 1 — three new archetypes.**

Five reasons, in order of weight:

1. **The elite variants are almost free in art.** Six of them need **11 new body
   frames and 10 new VFX frames** (§6.4) because the bodies, walks, dormant poses
   and death frames already exist. The three new archetypes in batch 1 need
   **110 body frames** between them. Art is the scarce resource in this repo —
   the work order's own history is three failed deliveries — so the cheapest
   legibility per frame wins.
2. **They validate the new kinds on bodies the player already knows.** A rift on
   a turret is one new thing to learn; a rift on a Rifter is two. If `rift` reads
   badly, that is discovered against a known silhouette rather than blamed on a
   new one.
3. **The elite room is the roster's most visible defect right now.** Stats-only
   affixes plus a 15% enrage is exactly the "HP sponge" failure the survey lists
   first, and the elite door promises otherwise.
4. **Every elite variant is a lookup, not a system.** `applyEliteAffixes`,
   `ELITE_SHARE`, `HEAVY_ELITES` and `strayEliteFor` are untouched; the swap
   keys on `(archetype, affixes.length > 0)`, exactly as the lancer already does.
5. **They do not move the pressure model.** Adding an archetype means new
   `threat_weight` entries in two tables that currently disagree (§1.10), new
   `MIX_RATIOS` rows, new `ROSTER_CAP` entries, and a recalibration pass (doc 005:
   "Calibration is re-run whenever an archetype's stats or attack change"). An
   elite variant changes only the elite band's measurements.

### The three attack kinds: `rift`, `tether`, `lob`

They are the three that **the elite variants already need**: rift for the elite
turret and elite tank, tether for the elite sentinel and elite summoner, lob for
the elite shooter. Building them buys six elite fights and three archetypes.

They are also the three that close the widest gaps: `rift` is §1.5 (no line
attack anywhere), `tether` is §1.4 and §1.7 (no support, nothing moves the
player), `lob` is §1.1 (area denial on more than one body).

`bash` is not counted among the three because it is a `MELEE_ATTACKS` table
entry — doc 005 says so outright — and it arrives with the Warden at no
systems cost. `mine`, `burrow` and `slow field` are deferred: each needs a pool
and a state machine of its own, and none of them is required by an elite variant.

### The three archetypes: Warden, Bellringer, Rifter

| | Why this one |
|---|---|
| **Warden** | The only proposal that adds a *mechanic* rather than an attack: damage with a direction. `hurtEnemy` has no angle parameter today, so flanking does not exist in the game; one function changes that for every future body. It also fixes `melee_heavy`, which is 65% rushers out of three ids. Anchor-eligible. |
| **Bellringer** | The roster's first support, the survey's "cleanest decision object", and the second new anchor. It needs no new damage path at all — it writes to `e.armour`, a field that already exists and is already honoured everywhere by `hurtEnemy`. Highest ratio of decision added to code written. |
| **Rifter** | The cheapest of the three to build (it is a `Strike` with a capsule instead of a circle, on a stationary body with no walk cycle) and it carries the kind that two elite variants also want, so `rift` gets three consumers immediately. It fixes `siege`, whose four bodies are currently three point/bullet threats and a rusher. |

**Deferred, and why:** Snarecaster needs a system that sets the player's position
from an enemy, which touches the player's movement authority and deserves its own
pass. Delver needs a submerged state that four subsystems must agree about
(collision, bullets, the swing, the renderer). Cinderling is the most interesting
of the three and the most dependent on calibration, because its threat is a
function of the rest of the roster. Sower needs a pool and destructible non-enemy
targets in `stepSwing`.

---

## 6. Art work order

Conventions from `docs/art-workorder.md`: frames are
`enemy_<id>_<dir>_<pose><n>`, directions are `n` / `s` / `w` with **`e`
generated as a mirror of `w`, never drawn**; 64 × 64 for standard bodies,
96 × 96 for big ones, 32 × 32 for bullets, 64 × 64 for VFX unless stated.
Radially symmetric entities (the turret's class) get one facing. Hard rule 8
applies: **only enemy projectiles may use the magenta band**, telegraph accents
use the warm range around `#ff5544`. Hard rule 9 applies: **no single-axis
scaling**, so anything that must cover a variable length is delivered as a
tileable segment plus end caps, never as one stretched sprite.

### 6.1 New archetypes — body sheets

| Archetype | Size | Facings | Poses | Frames |
|---|---|---|---|---|
| **Warden** | 96 × 96 | n, s, w | `idle0..1` (6), `walk0..3` (12), `dormant0..1` (6), `windup` (3, shield arm raised and leaned back), `lunge` (3, shield arm thrust forward), `plant` (3, shield arm grounded, second move); the shield is always an independent overlay, `hit0..1` (6), `death` (1, non-directional) | **40** |
| Warden, elite | 96 × 96 | n, s, w | `throw_windup` (3, empty shield arm drawn back), `throw_release` (3), `idle_bare0..1` (6); `weapon_enemy_warden_shield` detaches and becomes `vfx_plate_disc_*` | **12** |
| **Bellringer** | 64 × 64 | n, s, w | `idle0..1` (6), `walk0..3` (12), `dormant0..1` (6), `windup` (3, chime raised), `cast` (3, chime struck), `field` (3, chime rung downward, second move), `burst` (3, chime cracking — the alone-and-self-destructing pose), `hit0..1` (6), `death` (1) | **43** |
| Bellringer, elite | 64 × 64 | n, s, w | `peal_windup` (3, chime hauled fully back), `peal_release` (3) | **6** |
| **Rifter** | 64 × 64 | one (radially symmetric, per the turret's class) | `dormant` (1), `idle0..1` (2), `telegraph` (1, plates splitting, a warm core), `erupt` (1), `hit0..1` (2), `death` (1) | **8** |
| Rifter, elite | 64 × 64 | one | `telegraph_walk` (1, the core splitting into four) | **1** |
| **Snarecaster** | 64 × 64 | n, s, w | `idle0..1` (6), `walk0..3` (12), `dormant0..1` (6), `windup` (3, arm cocked, chain gathered), `fire` (3, arm fully extended), `whip` (3, the miss-whip arm behind it; chain and hook are independent layers), `hit0..1` (6), `death` (1) | **40** |
| Snarecaster, elite | 64 × 64 | n, s, w | `anchor_cast` (3, chain driven into the floor) | **3** |
| **Delver** | 64 × 64 | n, s, w | `idle0..1` (6), `walk0..3` (12), `dormant0..1` (6), `burrow0..1` (6, sinking), `emerge0..1` (6, rising), `windup` (3), `lunge` (3), `hit0..1` (6), `death` (1) | **49** |
| Delver, elite | — | — | none: the elite is three emerges, which reuses `emerge0..1` | **0** |
| **Cinderling** | 64 × 64 | n, s, w | `idle0..1` (6), `walk0..3` (12), `dormant0..1` (6), `windup` (3, empty hands around the independent coal layer), `lob` (3, empty-handed release), `burning0..1` (6, **the fed state** — brighter, faster gait, must read as *pleased*), `hit0..1` (6), `death` (1) | **43** |
| Cinderling, elite | 64 × 64 | n, s, w | `flare_windup` (3, white-hot, body swelling) | **3** |
| **Sower** | 64 × 64 | n, s, w | `idle0..3` (12, its drift — it floats, so no walk sheet, following the orbiter's rule), `dormant0..1` (6), `cast` (3, pod opening), `hit0..1` (6), `death` (1) | **28** |
| Sower, elite | 64 × 64 | n, s, w | `bloom_cast` (3, pod fully split, eight empty sockets visible; seed sprites are independent) | **3** |
| | | | **Subtotal, new archetype bodies** | **279** |

### 6.2 New archetypes — VFX

| Frames | Size | Purpose | Used by |
|---|---|---|---|
| `vfx_rift_seg_0..3` | 64 × 64 | **tileable** rift segment, growing across the four frames; the renderer repeats it along the capsule (hard rule 9: never stretched) | Rifter, elite turret, elite tank |
| `vfx_rift_cap_0..1` | 64 × 64 | the rift's two end caps, matching the segment's growth | same |
| `vfx_rift_burst_0..2` | 64 × 64 | the eruption, white, on the active frames | same |
| `vfx_tether_seg_0..1` | 64 × 64 | **tileable** ward tether segment, pale and steady | Bellringer, elite summoner |
| `vfx_tether_node_0..2` | 64 × 64 | the tether's endpoint clasp, pulsing; the thing that says "both ends land on something" | same |
| `vfx_ward_aura_0..2` | 64 × 64 | the ring on a warded body. **Not** `vfx_ward_0..1`, which is the player's stone ward and already exists | Bellringer, elite summoner |
| `vfx_slowfield_0..3` | 64 × 64 | a cool, still, non-damaging patch; deliberately flat against `vfx_groundfire_0..3`'s motion | Bellringer |
| `vfx_peal_ring_0..3` | 128 × 128 | the elite bellringer's expanding wave; also serves the self-destruct ring | Bellringer, Bellringer elite |
| `vfx_lob_shadow_0..2` | 64 × 64 | the growing ground shadow under a thrown object | Cinderling, elite shooter |
| `vfx_lob_ring_0..1` | 64 × 64 | the landing reticle | same |
| `vfx_coal_0..3` | 32 × 32 | the thrown coal in flight. **See the open question below** | Cinderling |
| `vfx_chain_seg_0..1` | 64 × 64 | **tileable** hook-tether segment, dark, snapping taut | Snarecaster |
| `vfx_chain_hook_0..1` | 64 × 64 | the hook head | Snarecaster |
| `vfx_chain_live_0..3` | 64 × 64 | the elite's anchored, energised line | Snarecaster elite |
| `vfx_mound_0..3` | 64 × 64 | the travelling mound; the only telegraph in the game that moves | Delver |
| `vfx_emerge_ring_0..2` | 64 × 64 | the emerge marker — the strike circle's shape, an earthen hue | Delver |
| `vfx_mine_seed_0..1` | 64 × 64 | the inert pip, dim, with its contracting ring | Sower, elite orbiter |
| `vfx_mine_armed_0..3` | 64 × 64 | the arming flicker and the live pulse | same |
| `vfx_mine_burst_0..2` | 64 × 64 | the detonation | same |
| `weapon_enemy_warden_shield` | 64 × 96 | the independently placed guard/bash shield; detaches on throw | Warden |
| `vfx_plate_spark_0..2` | 64 × 64 | a hit absorbed by the Warden's plate — this is the only feedback that teaches the mechanic, so it matters more than it looks | Warden |
| `vfx_plate_disc_0..3` | 64 × 64 | the thrown plate spinning (radially symmetric) | Warden elite |
| | | **Subtotal, new VFX** | **57** |

**Open question for the art order.** `vfx_coal_*` and the elite shooter's lob
are projectiles, so hard rule 8 puts them inside the magenta band — and a thrown
*coal* drawn magenta reads wrong. The summoner's existing thrown flame has the
same problem and doc 005 confirms it reuses the bullet path. Two ways out: name
a second protected band for thrown incendiaries, or keep the body of the coal
warm and give it a magenta rim wide enough to satisfy the checker. This needs
deciding before either sheet is drawn, not after.

### 6.3 New attack kinds — which VFX each one owns

| Kind | Frames it needs | Already listed under |
|---|---|---|
| `rift` | `vfx_rift_seg_0..3`, `vfx_rift_cap_0..1`, `vfx_rift_burst_0..2` | 9 frames |
| `mine` | `vfx_mine_seed_0..1`, `vfx_mine_armed_0..3`, `vfx_mine_burst_0..2` | 9 frames |
| `tether` | `vfx_tether_seg_0..1`, `vfx_tether_node_0..2`, `vfx_ward_aura_0..2`, plus `vfx_chain_seg_0..1` / `vfx_chain_hook_0..1` for the hook skin | 12 frames |
| `lob` | `vfx_lob_shadow_0..2`, `vfx_lob_ring_0..1`, plus a projectile per carrier | 5 + per-carrier |
| `bash` | none — it reuses the existing threat wedge; `vfx_plate_spark_0..2` belongs to the Warden, not to the kind | 0 |
| `burrow` | `vfx_mound_0..3`, `vfx_emerge_ring_0..2` | 7 frames |
| `slow field` | `vfx_slowfield_0..3` | 4 frames |

### 6.4 Elite attacks for the existing roster — art

This is the batch-0 table, and it is the argument for building it first.

| Elite | New body frames | New VFX | Reuses |
|---|---|---|---|
| **Elite shooter — Pin Shot** | `enemy_shooter_{n,s,w}_lob` (3, barrel raised at an angle) | `vfx_lob_shot_0..3` (4, 32 × 32, magenta band) | `vfx_lob_shadow_*`, `vfx_lob_ring_*` |
| **Elite turret — Rift Lance** | `enemy_turret_telegraph_rift` (1, one facing) | none | `vfx_rift_*` (9) |
| **Elite sentinel — Sight Beam** | `enemy_sentinel_telegraph_beam` (1, one facing) — **owed anyway**: doc 005 says the sentinel still ships on a tinted turret sheet | `vfx_beam_seg_0..3` (4, 64 × 64, tileable), `vfx_beam_cap_0..1` (2) | `vfx_tether_node_*` for the muzzle end |
| **Elite orbiter — Seedwake** | none | none | `vfx_mine_seed_*`, `vfx_mine_armed_*`, `vfx_mine_burst_*` |
| **Elite tank — Shock Cleave** | `enemy_tank_{n,s,w}_cleave_shock` (3, the chop landed, ground splitting under it) | none | `vfx_rift_*` |
| **Elite summoner — Ward Tether** | `enemy_summoner_{n,s,w}_tether` (3, orb extended toward a minion) | none | `vfx_tether_seg_*`, `vfx_tether_node_*`, `vfx_ward_aura_*` |
| | **11** | **10** | |

### 6.5 Totals, for scheduling

| Batch | Body frames | VFX frames | Total |
|---|---|---|---|
| **Batch 0** — `rift`, `tether`, `lob` + six elite variants | 11 | 10 + 30 (the three kinds' own VFX) = **40** | **51** |
| **Batch 1** — Warden, Bellringer, Rifter (+ their elites) | 40 + 12 + 43 + 6 + 8 + 1 = **110** | `vfx_plate_spark_*` (3), `vfx_plate_disc_*` (4), `vfx_ward_aura_*` (3, if not already in batch 0), `vfx_slowfield_*` (4), `vfx_peal_ring_*` (4), `weapon_enemy_warden_shield` (1) = **19** | **129** |
| **Later** — Snarecaster, Delver, Cinderling, Sower (+ elites) | 43 + 49 + 46 + 31 = **169** | ~29 | **198** |

Batch 0 is a tenth of the whole proposal's art and it changes every elite room
in the game. That is the recommendation.

---

## 7. Reference designs behind each proposal

The earlier survey (`docs/research/enemy-design-survey.md`) carries the sourcing
on telegraph lengths, role taxonomy and elite philosophy. This section names the
shipped design each proposal argues from. Sourcing is strongest for the Hades
pair (community wikis, accurate but not developer statements); the other games
are the survey's citations.

| Proposal | Argued from |
|---|---|
| **Warden**'s frontal plate | Hades' **Exalted Greatshield**: holds a shield up and blocks most attacks from the front *when not attacking and not stunned* — so the block drops during its own attack, which is exactly the 37-frame open recovery proposed here. https://hades.fandom.com/wiki/Greatshield |
| Warden's bash and its charge | Hades II's **Satyr Raider**: plants the shield and charges up for a full **2 seconds** before a shield bash, and the wiki notes that if there is no room to charge, the shield fires a projectile instead. A long, plainly-read commit on a shielded body is the shipped precedent for a 38-frame windup on a 0.8-heart attack |
| Warden's shield-throw elite | Hades II's **Talos**, who throws one or both shields as returning straight-line projectiles that come back — line zoning that hits twice. The elite's real content is that the body is *unshielded* while they are away. https://hades.fandom.com/wiki/Talos |
| Warden as an inverted case worth watching | Hades II's **Shadow-Spiller** inverts it: a dome you can only damage it from *inside*, with adds entrenched outside. Better as a boss idea than a trash archetype, but it is the same axis. https://hades.fandom.com/wiki/Shadow-Spiller |
| **Bellringer** | Hades' **Voidstone**: immobile, no direct attack, pulses a limited-duration invulnerability shield onto nearby enemies. Two shipped properties adopted below in §7.1. https://hades.fandom.com/wiki/Voidstone |
| Bellringer's cuttable line | Hades II's **Satyr Vierophant** and **Lamia**: both channel, and both are **cancelled by stagger** — the support's contribution is interruptible rather than instantaneous, which is what gives the player a second answer besides killing it. https://hades.fandom.com/wiki/Lamia |
| Bellringer's peal elite | Hades' **Auto-Watcher**, whose shield state is chosen by a scan of what is nearby, and Dead Cells' force field held by respawning crystals: an area effect with no single line to cut |
| The re-arm idea, for later | Hades' **Disarmed Exalted Souls** — a killed Exalted becomes a low-HP soul that travels to a weapon on the floor and channels on it, returning at full health as whatever weapon it reached. Out of scope here (it needs floor objects) but it is the richest support design found |
| **Rifter** | Hades II's **Goldwraith**: stops, then fires a beam spanning the whole chamber. Its telegraph grammar is adopted directly in §3.1. https://hades.fandom.com/wiki/Goldwraith |
| Rifter's cross | Hades' **Exalted Brightsword**, whose elite fires shockwaves in **all four cardinal directions** relative to its facing: the same "the sidestep is now wrong" inversion from a different body. https://hades.fandom.com/wiki/Brightsword |
| Rifter's Fissure Walk elite | Hades' **Snakestone**: multiple beams that start apart and **converge on the player**, so the safe gap closes rather than sitting still. Plus the survey's Rootcaller (§7.6). https://hades.fandom.com/wiki/Snakestone |
| The beam-maze warning | Hades' **Doomstone** sheds Fragments when damaged, and Fragments near each other form beam barriers — i.e. hitting it builds the maze. A caution, not a proposal: a rift body that multiplies its own lanes is a room the melee player cannot enter. https://hades.fandom.com/wiki/Doomstone |
| **Snarecaster** | Hades II's **Bloat-Shade**: a long-range vacuum that drags the player into melee range, then **after a brief delay** bursts its spikes. The pull and the payload are separate beats, which is the anti-dash-reflex structure. https://hades.fandom.com/wiki/Bloat-Shade |
| Snarecaster's grab window | Hades' **Wringer**: a grab that chains the player for **1 second**, escapable only by mashing dash. A shorter, cheaper version of the same idea; the proposal's 12-frame stagger is deliberately milder |
| Snarecaster's Chain Mine elite | Dead Cells' **electric cage**, which hurts you for leaving a region, and Hades II's **Hellifish Swarm**, which fills a chamber with stationary bodies that damage on proximity. https://hades.fandom.com/wiki/Hellifish |
| **Delver** | Hades' **Dracon**: a burrowing worm that, uniquely in that game, **erupts directly out of the ground with no summoning circle**, fires, then burrows away and repeats elsewhere. The "it decides when the fight happens" property, exactly. https://hades.fandom.com/wiki/Dracon |
| Delver's mound | Hades II's **Root-Stalker**, whose burrowing tendril roams the field as a separately-killable body — a visible under-floor threat with its own position. https://hades.fandom.com/wiki/Root-Stalker |
| **Cinderling** | Hades II's **Phantom**, which **heals on every attack that connects**, is the shipped shape of "the obvious thing you do is the wrong thing". The Cinderling moves that from attacks to elements. https://hades.fandom.com/wiki/Phantom |
| Cinderling's patches | Hades II's **Lubber**, whose thrown barrel leaves fire that can linger **upwards of 30 s**, so a pair of them progressively shrink the arena; and **Talos**, whose jetpack writes fire along his own pursuit path |
| **Sower** | Hades' **Wretched Pest**: no direct attack at all, throws proximity mines that explode after a brief delay, **and all of them detonate when the Pest itself dies** (40 HP, 5 damage per mine). The proposal's "shed" is that rule. https://hades.fandom.com/wiki/Wretched_Pest |
| Sower's elite ring | Hades II's **Holeheart**, whose armoured version throws **a line of three** mines — a mine wall rather than a scatter. https://hades.fandom.com/wiki/Holeheart |
| The `lob` reticle | Hades' **Bother**: a high-arc projectile with **a large red indicator showing both the landing spot and the whole blast area appearing the instant it is fired**, deflectable only while near the ground. That is the grammar in §3.4. https://hades.fandom.com/wiki/Bother |
| Elite room philosophy | Hades' **armour** (an outline plus a second bar, broken for a stun) and Dead Cells' **spatial** elite modifiers, against Gungeon's **Jammed** HP multiplier, which the survey names as the outlier. Note also that Hades' elites are mostly *pattern* changes — Brightsword gains four directions, Strongbow a volley of three, Snakestone a rotating fan — which is the model §4 follows |

### 7.1 Three shipped rules worth adopting verbatim

**From the Voidstone, for the Bellringer.** Killing it **strips the ward from
everything it had warded**, and if there is nobody left to protect it
**self-destructs in a damaging wave**. Both are worth taking: the first makes the
kill-order answer *pay off visibly* rather than merely stopping future wards, and
the second stops a lone bellringer from being a 16-hp body that stands there
doing nothing once the room is cleared around it. Proposed: on death, every
warded body loses its armour immediately; with no living ally for 90 frames, it
detonates in a 2-tile ring for 1 heart, 48 frames of telegraph.

**From the Goldwraith, for `rift` and the elite sentinel's beam.** Its beam is
drawn **red while it is still harmless, and only becomes damaging once it starts
pulsating black-and-white**. The existence of the line and the liveness of the
line are two separate signals. This repo has no such convention — the strike
marker's only cue is that it contracts — and adopting it costs one extra frame
per VFX set: `vfx_rift_seg_*` should read *drawn* through the telegraph and
*live* on the active frames, by luminance and motion rather than by hue, since
hue shifts up to 14 degrees at room load.

**From the Wretched Lout, for §1.2.** The wiki states it outright: *"Dashing
through their charge will still damage Zagreus if not timed properly."* That is
the shape the Sower and the Snarecaster's whip-back are after — not "the dash
does not work" but "the dash has a right moment". And Hades II's **Boozer**
"hops backward, then lurches forward covering roughly the same distance as
Melinoë's own Dash", which is the other half: an attack sized to the player's
dodge rather than to the player's body. Worth considering as a cheap change to
the tank's charge distance independently of anything in this proposal.

### 7.2 One pattern to avoid, now that it is named

Hades II's **Anchor** has an AoE that is **large and invisible until the attack
has already gone off** — only then is the radius marked. The wiki's own advice is
to stay far away. That is a telegraph the player cannot read, and it is exactly
what this repo's ≥36-frame rule and doc 013's "what the renderer draws *is* the
box that will be tested" exist to prevent. Named here so that no proposal above
drifts toward it: **every attack in §2 and §4 draws its full footprint before it
is live**, with no exceptions.

---

## 8. Open questions this proposal does not settle

1. **The magenta band and thrown incendiaries** (§6.2). Affects the Cinderling,
   the elite shooter and the summoner's existing flame.
2. **How to price a support in the pressure model.** The Bellringer's threat is a
   function of what else is in the roster, and `measurePressure` sums per-enemy
   constants. Either a special case or a harness-calibrated constant — the
   Cinderling has the same problem for the same reason.
3. **The two threat tables** (§1.10) must be reconciled before any new weight is
   added, or `meanThreatOf` drifts further from measured pressure.
4. **Whether the Warden's plate should block bullets as well as the sword.**
   Blocking both is the clean reading and it makes an elite Warden in front of a
   sentinel a genuinely hard room; blocking only direct damage is safer for the
   ranged compositions. This is a calibration question, not a design one.
5. **Whether elite attack variants should also appear on stray elites**
   (`strayEliteFor`, about one normal room in seven from room 3). Probably yes —
   a stray elite with a different attack is a better surprise than one with more
   health — but it widens what a normal room can contain, which doc 005 was
   deliberate about.

---

## Appendix A — reference designs from ten more games

§7 is sourced from the Hades pair. This appendix adds ten more games, grouped
by the same eight pressure categories as §1: **Hyper Light Drifter (HLD)**,
**Death's Door (DD)**, **Tunic**, **Enter the Gungeon (EtG)**, **Nuclear Throne
(NT)**, **Soul Knight (SK)**, **Dead Cells (DC)**, **The Binding of Isaac**,
**Moonlighter** and **Children of Morta (CoM)**.

Source quality varies. HLD's, EtG's, NT's, SK's, Dead Cells' and Isaac's
community wikis are detailed and some give numbers; Moonlighter's has usable
per-enemy strategy fields; Death's Door and Tunic are documented mainly by
walkthrough sites (qualitative); Children of Morta has almost nothing online
beyond one-line descriptions and one boss guide. Entries that could not be
pinned down are marked *[uncertain]*. Community wikis are accurate but are not
developer statements. (Tooling note: `*.fandom.com` refuses WebFetch but
answers `curl` against its `api.php`.)

Each entry: **name** — game — the mechanism — the counterplay — source — and,
where it applies, the proposal it supports (→).

### A.1 Area denial over time

- **Conjoined Fatty** — Isaac — pauses and farts out a *growing line* of damaging creep; killing it mid-fart stops the line growing at once. The hazard races the player's damage. https://bindingofisaacrebirth.fandom.com/wiki/Fatty → a Rifter variant whose line grows until interrupted.
- **Gasbag** / **Gush** — Isaac — a stationary body permanently emitting a ring of gas (Gasbag) or slowly expanding slowing creep (Gush); the zone dies with the body. https://bindingofisaacrebirth.fandom.com/wiki/Gasbag · https://bindingofisaacrebirth.fandom.com/wiki/Boil → the "kill this first" target the roster lacks (§1.1).
- **Poot Mine** — Isaac — seeds gas clouds, and on death chain-detonates every cloud it laid: killing it late is the trap. https://bindingofisaacrebirth.fandom.com/wiki/Poot_Mine → Sower's "shed" rule, stated with a stronger payoff.
- **Candler** — Isaac — its flight path becomes lingering flame. https://bindingofisaacrebirth.fandom.com/wiki/Candler
- **Poisbulon family** — EtG — lays a continuous poison trail and splits on death into smaller, faster trailing copies, so the arena fills. https://enterthegungeon.fandom.com/wiki/Blobulon
- **Dead Blow** — EtG — a red ground reticle marks the targeted player before a hammer drops: a fire patch plus a ring of 12 bullets. https://enterthegungeon.fandom.com/wiki/Dead_Blow
- **Muzzle Wisp / Flare** — EtG — three random dashes (the dashes are the telegraph), then a flame ring; leaves fire on death — **unless killed frozen**, which leaves none. https://enterthegungeon.fandom.com/wiki/Muzzle_Wisp → the element interaction the Cinderling wants: ice as the clean kill.
- **Toxic Ballguy** — NT — heals by standing in toxic gas and dumps many gas clouds on death. https://nuclearthrone.fandom.com/wiki/Toxic_Ballguy → Cinderling's "the hazard feeds it".
- **Fire Goblin Priest** — SK — its fireballs make pools *around itself*, so it self-zones: fight it from outside its own ring. https://soulknight.fandom.com/wiki/Fire_Goblin_Priest
- **Varkolyn Leader** — SK boss — four poison pools in a line along its facing; it is invulnerable while standing in its own pool, then forced vulnerable. https://soulknight.fandom.com/wiki/Varkolyn_Leader/Tactics
- **Gas Suit** — Moonlighter — fires gas that drifts forward slowly: a moving wall, beaten by flanking. https://moonlighter.fandom.com/wiki/Gas_Suit
- **Poison knight** — DD — hammer slams leave a lingering poison cloud, so the player cannot orbit; hook in, hit once or twice, roll perpendicular out. https://eip.gg/deaths-door/guides/walkthrough-part-16-overgrown-ruins-flooded-fortress-night/
- **The Hierophant — Vortex Trail** — HLD boss — detonating tiles drawn along the player's *own path*. https://hyperlightdrifter.fandom.com/wiki/The_Hierophant

### A.2 Punishes dash spam

- **Dead Cells' legality flags.** Every move in Dead Cells is documented as blockable / parryable / dodge-rollable, and several of its strongest enemies are defined by switching the roll flag **off**: the **Impaler** (spikes from under the player, a red ground marker, only escaped by moving away), the **Shocker** (a multi-hit aura), the **Cavern Skeleton** (a shockwave on every landing), the **Ground Shaker**'s forward shockwave, the **Royal Guard**'s ground wave, the **Kamikaze**'s wide blast. https://deadcells.fandom.com/wiki/Impaler_(Enemy) · https://deadcells.fandom.com/wiki/Shocker · https://deadcells.fandom.com/wiki/Ground_Shaker → a per-attack field `dodgeable: boolean` in this game's melee and strike specs would make "must reposition" a designable property rather than an accident. Worth adding with the first batch.
- **Ground Shaker — Avalanche** — DC — rocks fall from a shine telegraph; the wiki's counterplay is *do not dodge on the shine, wait for the fall, then roll*: a delayed second hit that eats the panic dash. https://deadcells.fandom.com/wiki/Ground_Shaker
- **The Archer — Volley Mines** — HLD boss — four mines laid in a square or diamond, **triggered by dashing over them**, accumulating over the fight. The cleanest shipped anti-dash mine. https://hyperlightdrifter.fandom.com/wiki/The_Archer → Sower: make mines trigger on a dash passing over them as well as on contact.
- **Plant Beast** — HLD — turns black (invulnerable) and locks the player's position, then charges; the dash window is about 0.2–0.3 s *on the colour change* — dash late, not early. https://hyperlightdrifter.fandom.com/wiki/Plant_Beast
- **Crystal Brute** — HLD — a slam ring plus radiating spike lines, and a **second slam if the player is still close**; the first hit's knockback can push them into the lines. https://hyperlightdrifter.fandom.com/wiki/Crystal_Brute
- **Plant Beastling** — HLD — detonates about **1.5 s after dying**, hurting enemies too. https://hyperlightdrifter.fandom.com/wiki/Plant_Beastling
- **Lead Maiden** — EtG — fires rings that stick to the walls, hold, then fire inward: the second beat lands after a normal roll has ended. Invulnerable while closed. https://enterthegungeon.fandom.com/wiki/Lead_Maiden
- **Cubulead** — EtG — its volley stops mid-flight, then flies back to it: the return leg catches the player who rolled through the first pass. https://enterthegungeon.fandom.com/wiki/Cubulon
- **Gunjurer** — EtG — absorbs any projectile fired at it during its cast and adds it to the return volley; **melee is not absorbed**. https://enterthegungeon.fandom.com/wiki/Gunjurer → a caster that is correct to attack with the sword and wrong to attack with spells.
- **Veteran Shotgun / Bullet Kin** — EtG — predictive spreads aimed where the player is going; the veteran pauses a burst when line of sight breaks and finishes it on re-acquire. https://enterthegungeon.fandom.com/wiki/Shotgun_Kin
- **Mine Flayer** / **Beholster** — EtG bosses — their wikis say outright *do not roll* for several patterns: walk the gaps. https://enterthegungeon.fandom.com/wiki/Mine_Flayer · https://enterthegungeon.fandom.com/wiki/Beholster
- **Blood Cultist** — Isaac — bone traps placed where it *predicts* the player will be; stepping on one roots for 1 s; they despawn after 3 s. https://bindingofisaacrebirth.fandom.com/wiki/Cultist
- **Failed Experiment** — DC — if the player rolls behind before its slam it turns mid-combo, and it has a dodge-behind reaction on a 15 s cooldown. https://deadcells.fandom.com/wiki/Failed_Experiment
- **Chompignom** / **Frog Spearman** — Tunic — a fast biter that cannot turn (sidestep, never back off straight) and a spearman who "always tries to attack 3 times". https://tunic.fandom.com/wiki/Enemies

### A.3 Shielded front, forces flanking

- **Shieldbearer** — DC — immune from the front, stuns the player on melee contact with the shield, slow to turn: a free window from behind. https://deadcells.fandom.com/wiki/Shieldbearer → Warden, including "hitting the plate costs you something", not only "does nothing".
- **Oven Knight** — DC — a breakable shield; when it breaks, the furnace in its chest turns from blue to red and it becomes fast and aggressive. A colour state cue for a second phase. https://deadcells.fandom.com/wiki/Oven_Knight → an alternative Warden elite: plate breakable, enraged without it.
- **Thorny** — DC — the *back* is spiked, and it telegraphs its turn-around like an attack. **Ground Shaker** is immune from behind. https://deadcells.fandom.com/wiki/Thorny → the two inversions that stop "always flank" becoming a reflex; one of them belongs in the roster once the Warden exists.
- **Stone Butler** — Moonlighter — a shield blocking front and sides; the wiki's counterplay is "roll through it, then attack its exposed back", and it turns faster than its peers. https://moonlighter.fandom.com/wiki/Stone_Butler → the dash-through-to-flank read, exactly what this player's dash already does.
- **Shielder / Elite Shielder** — NT — a reflective shield with a deliberate startup delay; **melee swings, lasers and explosions pass through it**; the elite teleports when its shield drops. https://nuclearthrone.fandom.com/wiki/Shielder
- **Ruins Guard** — SK — a shield stance that ignores all damage, a lance burst, and a 0.5 s heat-up charge during which it is immune; **freeze stops the charge**. https://soulknight.fandom.com/wiki/Ruins_Guard
- **Grave Guard Scarab Archon** — SK boss — armour as a second bar capping every hit at 2 until it breaks, then a 5.5 s vulnerable window. https://soulknight.fandom.com/wiki/Grave_Guard_Scarab_Archon/Tactics
- **Knight** — Isaac — damageable only from the exposed back of the head; its Black variant stuns itself on hitting a wall. https://bindingofisaacrebirth.fandom.com/wiki/Knight
- **Dirk Gunman** — HLD — tracks only within a 90° arc, ≈2.5 s cooldown: flank during the cooldown. https://hyperlightdrifter.fandom.com/wiki/Dirk_Gunman
- **Elite Custodian**, **Envoy** — Tunic — frontal blockers; bait, roll past, hit the back. *[uncertain on exact behaviour]* https://tunic.fandom.com/wiki/Enemies

### A.4 Support and buffers

- **Protector** — DC — immobile; gives every enemy in a large radius a force field (full invulnerability) that periodically drops; **a visible lightning tether joins it to each shielded enemy**; freezing or stunning it disables the fields. https://deadcells.fandom.com/wiki/Protector → Bellringer's tether is this design; freeze-disables-the-support is worth adopting as its element interaction.
- **Defender** — DC — a *mobile* Protector shielding one enemy at a time, able to attack only when shielding nobody. https://deadcells.fandom.com/wiki/Defender
- **Death Generator** — Moonlighter — a coloured tether to another monster: red means it cannot be hurt, blue means it can. https://moonlighter.fandom.com/wiki/Death_Generator
- **The Summoner — Node Command** — HLD — five orbiting nodes; it opens its chest to reactivate destroyed ones: **the refill is the punish window**. https://hyperlightdrifter.fandom.com/wiki/The_Summoner
- **The Hanged Man** — HLD boss — summons knights frozen in destructible crystals that never regenerate once broken, and its own slashes break them: bait it into disarming itself. https://hyperlightdrifter.fandom.com/wiki/The_Hanged_Man
- **Ammomancer / Gunsinger / Jammomancer** — EtG — stand still and summon or buff; **closing the distance cancels the cast and makes them flee**. https://enterthegungeon.fandom.com/wiki/Gunsinger → a support whose answer is the dash in, which suits this player.
- **Necromancer** — NT — marks a circle at range; every corpse inside rises. Corpse removal nullifies it. https://nuclearthrone.fandom.com/wiki/Necromancer
- **Cultist** — Isaac — walks to a corpse and resurrects it at full health, up to five; cannot revive other Cultists. https://bindingofisaacrebirth.fandom.com/wiki/Cultist
- **Apostate** — DC — revives the slain and wakes dormant bodies; **killing it can kill what it revived**; walls itself behind a one-hit barrier. https://deadcells.fandom.com/wiki/Apostate
- **Elite Mummy (Staff)** — SK — heals itself and allies periodically. https://soulknight.fandom.com/wiki/Elite_Mummy_(Staff)
- **Dirk Gunman — command** — HLD — a snarl makes every nearby Dirk rush the player at once. https://hyperlightdrifter.fandom.com/wiki/Dirk_Gunman
- Finding: no enemy in HLD, DD or Tunic heals another. The genre's supports are **shield, re-arm, revive, command** — heal is rare, and Bellringer (armour) is the common case.

### A.5 Zoning line attacks

- **Vis family** — Isaac — fire a beam the instant the player lines up on a cardinal axis; Double Vis front and back, Scarred Double Vis all four; the Brimstone Death's Head shows a faint warning line first. https://bindingofisaacrebirth.fandom.com/wiki/Vis → a cardinal-alignment trigger, which reads instantly top-down, for the elite sentinel.
- **Inquisitor** — DC — a trajectory line drawn during the charge; **moving behind it before it fires cancels the attack**. https://deadcells.fandom.com/wiki/Inquisitor
- **Vulture Acolyte** — HLD — a straight beam after ≈2 s of charge that knocks the player down; it has 2 HP and is meant to die during the charge. https://hyperlightdrifter.fandom.com/wiki/Vulture_Acolyte
- **Judgement — Hyper Laser** — HLD boss — sweeps from the wall nearest the player; two crouch frames reveal the sweep direction. https://hyperlightdrifter.fandom.com/wiki/Judgement
- **Ou — Kaleidoscope Beam** — CoM boss — a cone marker sweeps after the player, **locks**, then fires: dodge on the lock, not the sweep. https://childrenofmorta.fandom.com/wiki/Ou,_the_Mountain_God → the lock beat, for any tracking line.
- **Laser Crystal** — NT — the aim is pre-drawn as a line of sparkles; it neither moves nor leads while firing. https://nuclearthrone.fandom.com/wiki/Laser_Crystal
- **Ruins Turret** — SK — a strict horizontal or vertical beam, warned by a sound and a thin warning beam; its champion has no warning beam. https://soulknight.fandom.com/wiki/Ruins_Turret
- **Knight-X** — SK — aims for 2 s, then fires: the cleanest fixed-duration beam telegraph. https://soulknight.fandom.com/wiki/Knight-X
- **Headless Knight's Horse** — SK — a sweep that is slower close in; the wiki's advice is to run *into* it for one tick rather than be clipped twice. https://soulknight.fandom.com/wiki/Headless_Knight/Tactics
- **Fuselier** — EtG — four persistent lines of flame bullets that shrink the floor; melee destroys the lines. https://enterthegungeon.fandom.com/wiki/Fuselier
- **Mom's Dead Hand** — Isaac — landing sends rock waves out along the cardinals. https://bindingofisaacrebirth.fandom.com/wiki/Mom%27s_Hand → the elite tank's Shock Cleave, from a landing instead of a chop.
- **The Lord of Doors** — DD boss — energy pillars in three directions on landing; it always faces the player before leaping, so perpendicular is safe. https://deathsdoor.fandom.com/wiki/The_Lord_of_Doors
- **Tech Turret / Golem Turret** — Moonlighter — cardinal death rays; the Golem Turret slides until it lines up. https://moonlighter.fandom.com/wiki/Golem_Turret

### A.6 Grab, pull, tether

- **Catcher** — DC — a grappling hook that roots and pulls, then a charged slash; the further away the player was hooked, the easier the slash is to roll out of. https://deadcells.fandom.com/wiki/Catcher → Snarecaster's pull-then-payload, with a distance-based escape.
- **Guardian Knight** — DC — a spinning pull that the wiki says *not* to dodge: leave the area. https://deadcells.fandom.com/wiki/Guardian_Knight
- **Crystal Spider** — HLD — disguised as a crystal; on hit it encases the player, who must mash to break free while the pack hits. https://hyperlightdrifter.fandom.com/wiki/Crystal_Spider
- **Tarnisher / Gripmaster** — EtG — both **flash blue on the frame the player must dash**. https://enterthegungeon.fandom.com/wiki/Tarnisher → a single "dash now" colour cue could serve every grab in this game.
- **Inspector** — NT — telekinesis that pulls the player in while pushing projectiles away, then a sword swing. https://nuclearthrone.fandom.com/wiki/Inspector
- **Mom's Hand** — Isaac — a floor shadow marks the landing; after a miss it sits stunned (the damage window). https://bindingofisaacrebirth.fandom.com/wiki/Mom%27s_Hand
- **Frog Warrior** — Tunic — pulls the player in with its tongue ("Grownups have hooks on their tongues"). https://tunic.fandom.com/wiki/Enemies
- **Poison / Fire Slime** — Moonlighter — engulfs the player for several seconds while the rest of the room keeps hitting. https://moonlighter.fandom.com/wiki/Poison_Slime
- **Yeeter** — DC — knocks the player away, **aiming the knockback into nearby spikes**. https://deadcells.fandom.com/wiki/Yeeter → knockback into this game's own hazards (spike strips, poison pools) is a pressure the Warden's bash could use.

### A.7 Burrow, teleport, emerge

- **Mole** — Isaac — travels underground as small moving rubble; pokes out, fires, jumps on. https://bindingofisaacrebirth.fandom.com/wiki/Mole → Delver's mound.
- **Para-Bite** — Isaac — pops up elsewhere but **never directly under the player**: a fairness rule worth copying for the Delver. https://bindingofisaacrebirth.fandom.com/wiki/Para-Bite
- **Needle** — Isaac — a lump in the ground before it emerges and lunges. https://bindingofisaacrebirth.fandom.com/wiki/Needle
- **Volcanic Sandworm** — SK boss — a dirt pile tracks it underground; every burrow and surfacing is a shockwave; **freeze prevents burrowing**. https://soulknight.fandom.com/wiki/Volcanic_Sandworm/Tactics → ice as the Delver's element answer.
- **Ice Bug Larva** — SK — ice spikes appear *at its underground position*, so the hazard is the position readout. https://soulknight.fandom.com/wiki/Ice_Bug_Larva
- **Guardian** — NT — teleports in behind the player; **hitting it during the teleport animation cancels it**. https://nuclearthrone.fandom.com/wiki/Guardian
- **Automaton** — DC — cloaked, dashes the platform twice, then teleports away; the only enemy that disengages when damaged. https://deadcells.fandom.com/wiki/Automaton
- **Phaser Spider** — EtG — burrows and reappears; rarely on top of the player. https://enterthegungeon.fandom.com/wiki/Phaser_Spider
- **Wizard (Enemy)** — SK — teleports between attacks; its champion *loses* the teleport and gains an orb attack: an elite by subtraction. https://soulknight.fandom.com/wiki/Wizard_(Enemy)
- **Custodians** — Tunic — teleport away if the player does not commit. https://tunic.fandom.com/wiki/Enemies
- **Crystal Spider / Plant Beast / Plant Beastling** — HLD — pre-placed as ordinary floor decoration until they spring. https://hyperlightdrifter.fandom.com/wiki/Plant_Beastling

### A.8 Delayed mines, landing markers, lobs

- **Grenadier / Bombardier** — DC — a lob at the player's current position that detonates after a delay; **the elite Grenadier's bombs explode the instant they land** (an elite that removes a delay); the Bombardier's bomb splits into three delayed bomblets; a parry reflects them. https://deadcells.fandom.com/wiki/Grenadier · https://deadcells.fandom.com/wiki/Bombardier → the elite shooter's Pin Shot could split on landing instead of pinning.
- **Vulture Shaman** — HLD — a purple square painted on the ground detonates after a brief delay, hurts its own allies, and **still goes off after the Shaman dies**. https://hyperlightdrifter.fandom.com/wiki/Vulture_Shaman
- **The Hierophant — Cross Vortex** — HLD boss — detonating tiles in a ✕ or ＋ at the player's feet: leave diagonally for ＋, orthogonally for ✕. https://hyperlightdrifter.fandom.com/wiki/The_Hierophant → a readable shaped strike for the elite turret.
- **Bomber Toad** — HLD — lobs flasks that burst into five shots on landing; slashing the flask as it lands sends them back. https://hyperlightdrifter.fandom.com/wiki/Bomber_Toad
- **Infected Worker** — DC — sets a barrel down and jumps back; hitting the barrel knocks it away to hurt enemies. https://deadcells.fandom.com/wiki/Infected_Worker → Sower's seeds could be kicked by the sword rather than only detonated.
- **Anubis — obelisk** — SK boss — the landing spot is marked by a small pool that vanishes as the obelisk lands: the most explicit ground-marker-then-impact found. https://soulknight.fandom.com/wiki/Anubis/Tactics
- **Mummy (Bomb)** — SK — the bomb turns red and detonates 2 s later, even if the mummy is killed first. https://soulknight.fandom.com/wiki/Mummy_(Bomb)
- **Bombgagger** — Isaac — killing it during its vomit animation still spawns the bomb: "kill it fast" is a trap. https://bindingofisaacrebirth.fandom.com/wiki/Bombgagger
- **Holy Bony** — Isaac — arcing bones whose landing spots become lingering flames. https://bindingofisaacrebirth.fandom.com/wiki/Bony
- **Betty — Snowball Rain** — DD boss — shadows on the floor mark each impact. https://deathsdoor.fandom.com/wiki/Betty
- **Lil' Hunter** — NT boss — a ground shadow shows exactly where the divebomb lands; a ring of flame on landing. https://nuclearthrone.fandom.com/wiki/Lil%27_Hunter
- **Carnivorous Mutae** — Moonlighter boss — root spikes sprout under the player and *follow* them for a few seconds: a chasing marker that punishes running straight. https://moonlighter.fandom.com/wiki/Carnivorous_Mutae

### A.9 Cross-cutting findings

1. **Make "can the dash beat it" a property of each attack.** Dead Cells documents every move as blockable / parryable / rollable, and its most memorable enemies are the ones with the roll flag off. Here: a `dodgeable` field on melee, strike and rift specs, false for a few attacks whose counterplay is to be elsewhere. The dash then stays the answer to most things without being the answer to everything.
2. **Telegraph vocabulary, all portable to top-down**: a floor shadow (Mom's Hand, Betty, Lil' Hunter); a red ground polygon (Impaler, Dead Blow, Vulture Shaman); a ground lump or moving rubble for a burrower (Needle, Mole, Sandworm's dirt pile); a drawn aim line during the charge (Inquisitor, Laser Crystal, Knight-X); a visible range during the charge (Toxic Miasma); a tether from a support to what it protects (Protector, Death Generator); a colour change on a state flip (Oven Knight's furnace); flashing before detonation (Corn Mine, Mummy bomb); a sweep that **locks** before it fires (Ou); **one colour meaning "dash now"** (EtG's blue flash on grabs).
3. **The melee answer is a designed asymmetry in the genre.** EtG's Gunjurer absorbs bullets but not blades; NT's Shielder is bypassed by melee; SK's boss guides say "bring melee" because swings clear parked bullets and summoned turrets. For a sword-first player, enemies that are *correct* to engage with the sword and *wrong* to engage with spells are the pressure that suits the game.
4. **Anti-flank inversions** (Thorny's spiked back, Ground Shaker's immune back) keep flanking from becoming a reflex once the Warden teaches it. One of them belongs in a later batch.
5. **Closing the distance cancels a support** (Ammomancer, Gunsinger, Jammomancer; the Guardian's teleport; the Inquisitor's charge). Interrupt-by-approach suits a dash player and gives the Bellringer a second answer besides cutting its tether.
6. **Death as a second beat** (Plant Beastling 1.5 s, Mummy bomb 2 s, Vulture Shaman's square, Snow Tank's delayed explosions, Bombgagger): a kill that is not yet safe is a cheap way to punish standing on the body, and it pairs with the lancer's existing death burst.

### A.10 What this changes in the proposal

- §3: add a `dodgeable` flag to the new kinds, and set it false on the Rifter's eruption and the Sower's armed mine, so they are answered by position (A.9 point 1).
- §2.4 Snarecaster: a hooked player escapes the payload more easily the further away they were caught (Catcher).
- §2.5 Delver: never emerge directly under the player (Para-Bite); freeze prevents the dive (Sandworm).
- §2.7 Sower: mines also trigger when a dash passes over them (the Archer), and the sword can kick a seed (Infected Worker).
- §2.2 Bellringer: freezing it drops its wards (Protector); closing on it interrupts the ring (Gunsinger).
- §4.1 elite shooter: an alternative Pin Shot that splits into three delayed bomblets on landing (Bombardier).
- §4.3 elite sentinel: trigger the Sight Beam on cardinal alignment, like Vis, rather than on a timer.
