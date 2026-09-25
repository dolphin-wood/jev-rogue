---
id: 019
title: Subspecies and Elites
status: proposed
date: 2026-09-24
summary: Every base archetype has exactly one subspecies — a known body with one verb changed, its own name, threat weight and telegraph — and subspecies are common, about a fifth of the bodies a room holds once the ramp allows them. The attacks doc 005 gave to elites become the subspecies' twists, because a different attack belongs where the player meets it often enough to learn it. What is left for the elite tier is the enrage and one affix: health doubled, damage a third higher, speed at most a seventh higher, and no telegraph ever shortened, with a heal worth a tenth of maximum health and a coin on the kill. Three new round-2 questions put all of this where doc 002 puts a preference — with the Director: two slot questions for which subspecies a room holds, one for how heavily, and `elite_presence` for how many elites a normal room hides. The ramp only bounds them: when each subspecies unlocks, the ceiling on the share, and the hard caps of two elites a normal room and none before room 3. The mixes are untouched and the pressure model prices the chosen share as an expected weight before it measures. Art is a mark decal at a new anchor plus a runtime palette swap, which is 39 atlas frames rather than the 58% the frames would have cost.
depends_on: [005, 011, 013, 016]
---

# 019 Subspecies and Elites

## Stance

The roster has fifteen bodies and two tiers of variation on top of them, and
until now both tiers were the same tier. An elite was a different attack
(doc 005, "An elite is a different attack, not a multiplier") **and** a stat
package **and** an affix, and it appeared in about one room in seven. So the
most interesting content in the roster — the sentinel's beam, the rifter's
walking cracks, the sower's ring of seeds, all of it already written in
`sim/attacks.ts` — was shown to the player a handful of times a run, in the
rooms where they were also being asked to read a pink tint, a pulsing ring,
two affixes and a 15% enrage at the same time.

This document splits the tier in two along the line that was always there:

- A **subspecies** is a body with **one verb changed**. It is a fight to learn,
  so it has to be **common**: about a fifth of the bodies in a room once the
  ramp allows it. It is not harder to answer, it is answered **differently**.
- An **elite** is a body that is **the same fight, more expensive to get
  wrong**. It is a spike in a fight the player already knows, so it has to be
  **rare**, and every one of its numbers is chosen so that the answer the
  player learned still works.

The two are drawn in different channels, read as different things on screen and
are measured separately. A body can be both: an elite pinner is a pinner, and
it is the pinner's telegraph the player reads, at the pinner's duration.

## The frequency tiers

| Tier | Share of bodies | Who decides, inside what bound |
|---|---|---|
| base archetype | 75–85% | the composition's mix ratios (`MIX_RATIOS`) |
| subspecies | 0, about 15% or about 25% | **the Director** picks the weight and which ones; the ramp caps the share and unlocks the ids |
| elite | 0, 1 or 2 a normal room; up to 4 an elite room | **the Director** picks how many; code holds the caps and the placement |

The ratio between the two upper tiers is the point. A subspecies is met four
to eight times in a run and learned; an elite is met once or twice and
survived.

**Both tiers are experience preferences, so both are Jev's** (doc 002, "Not
every parameter is a Jev parameter"). Whether this room is the one that shows
the player a pealer, and whether it hides an elite, reads on exactly the inputs
that table reserves for the Director — what the player is holding, how the last
rooms went, where the run is. What stays code is what that table calls safety
and budget: when an id is allowed to exist at all, the ceiling on how much of a
room may be strange, the per-room caps, and the pressure re-measurement. The
sections below say which is which for every number in this document.

## One subspecies per archetype

A subspecies changes **one verb** of its base's kit, keeps every other rule,
and draws a telegraph its base does not have. That is the same rule the lancer
and the sentinel were made under (doc 005): a known body with one rule
changed is learnable, and a new body with four is a second roster.

**The lancer is the rusher's subspecies**, and it stops being an elite form.
It is what a rusher becomes under the substitution, from room 3, in any room —
the mixes still never draw it. Its death burst stays elite-only, because the
spikes were measured at a third of all hearts lost in a run when every lancer
had it.

**The boss has no subspecies and takes no affixes.** Its three phases are
already one body learned three times, and doc 005's reason for authoring it —
a bad roll in a normal room costs a heart, a bad roll in the boss ends the run
— is exactly the reason not to vary it.

| Base | Subspecies | The verb that changed | Telegraph | Threat | From |
|---|---|---|---|---|---|
| rusher 1.25 | **lancer** | the spike drive commits from 1.5 tiles, and the spikes fly off it | the longer windup, the wider ring | 1.6 | 3 |
| shooter 2.2 | **pinner** | the aimed shot is **two down one lane**: the slow fat one, then a fast thin one 0.35 s behind it | the aim ray is drawn doubled | 2.6 | 3 |
| orbiter 2.6 | **wisp** | its shot **curls** — homing for its first 0.5 s, then straight | a brighter bullet with a tail; the curl is visible in flight | 3.0 | 3 |
| sentinel 1.7 | **watcher** | the sight line **is** the shot: no travel, live for 0.3 s | the same drawn lane, then it whitens | 2.1 | 3 |
| delver 1.7 | **burrower** | it erupts **three times along its heading**, 0.4 s apart | three rings on the floor, ahead of the mound | 2.1 | 3 |
| cinderling 1.8 | **emberling** | it lights **itself** at half health and flares into a ring of fire | the body goes bright, then a growing ring | 2.2 | 3 |
| turret 2.0 | **beacon** | the strike **leaves the ground burning** for 2 s | the marker stays after the bolt, live and moving | 2.5 | 6 |
| rifter 1.9 | **quaker** | four short cracks **walk toward** the player, each a beat after the last | each crack's own 0.42 s growth, placed ahead of the last | 2.3 | 6 |
| snarecaster 2.2 | **chainer** | it **anchors** the chain across the floor as a live line instead of throwing it | the chain lies drawn, then goes taut and bright | 2.6 | 6 |
| sower 2.0 | **planter** | it plants a **ring of eight seeds round the player**, with two gaps | the ring is drawn before it arms | 2.5 | 6 |
| bellringer 2.0 | **pealer** | it **peals** instead of tethering: everything within four tiles is warded at once | the 1.1 s swell, the ring at its own feet | 2.4 | 6 |
| warden 2.6 | **fusilier** | a **second barrel** 0.38 s after the first, 25° off it | the gun is raised with both muzzles lit | 3.1 | 6 |
| tank 5.0 | **breaker** | the overhead chop **cracks the floor** three tiles ahead of it | the chop's raise, plus the lane drawn on the floor | 5.8 | 10 |
| summoner 4.5 | **brooder** | the thrown flame is a **thrown minion**: the coal hatches a rusher where it lands | the lob arc, and the coal is drawn with a seam | 5.4 | 10 |

Every weight is 1.15 to 1.30 times its base's, mean 1.21. That is the band the
substitution is priced in, and it is deliberately narrow: a subspecies is a
different question, not a bigger one.

**Ten of the fourteen twists are already written.** Fissure walk, peal, anchor,
bloom, breach line, sight beam, shock cleave, flare, the second barrel and the
lancer are in `sim/attacks.ts` and `sim/melee.ts` today, behind `isElite(e)`.
Phase 2 re-keys those branches to the subspecies and adds four: the pinner's
pattern (data only), the wisp's curl, the beacon's live ground and the
brooder's hatching coal.

**Two of doc 005's elite moves are dropped.** The turret's "rift lance" was the
rifter's attack on the turret's body, and the orbiter's "seeds in its own wake"
was the sower's; a subspecies that answers like another archetype teaches the
player nothing. The beacon and the wisp replace them.

## Combining with affixes

An elite carries **exactly one** affix (below). These pairs are excluded,
because each is either unreadable or unanswerable:

| Excluded | Why |
|---|---|
| lancer, planter + `volatile` | two death bursts from one body: the player cannot tell which ring is which |
| beacon, emberling + `burning` | its own attack already lays fire; a second source is invisible on top of the first |
| beacon, emberling, planter + `shielded` | fire and ice are the stated answer to all three (doc 001: no nullification) |
| brooder, summoner + `splitting` | a body that makes bodies must not also make bodies when it dies; the kill order stops being readable |
| tank, breaker + `swift` on the commit | the enrage and `swift` raise the **walk**; no affix ever raises a `commitSpeed` |
| watcher + anything that shortens a tell | nothing shortens a tell; stated here because the beam has only its line |

Everything else is legal. The rule the table implements is one sentence: **an
affix may never touch the thing the subspecies changed.**

## The elite rework

An elite is the enrage plus one affix, and nothing else.

| | Value | Why it is fair |
|---|---|---|
| health | ×2.0 | the health bar is the one number that never surprises the player mid-attack |
| damage | ×1.3 | every attack's **answer** is unchanged; only the cost of getting it wrong moves |
| move speed | ×1.15, and never a commit speed | the fastest elite body is the lancer at 120 px/s, exactly half the player's 240, so no elite can outrun a retreat |
| telegraphs | **unchanged, all of them** | windups, aims, primes, marker delays and growth times are the contract the player learned; an elite is answered with the moves they already have |
| rests | ×0.85 | the only cadence the enrage touches: the gap **between** turns, which is pressure without being a shorter question |
| affixes | exactly one | a pair was two new rules to read on a body already reading as harder |
| drop | a heal of 10% of maximum health, **and** a coin, always | the harder body is the one worth going for; at a run budget of about half a heart a room, an elite kill is most of a room paid back |

`ENRAGED_INTERVAL = 0.85` today multiplies **every** pattern interval, which
includes the wind-up-shaped ones, and `swift` multiplies them by 0.8 on top.
Both are replaced by a rest-only multiplier, and a test enumerates every
telegraph constant in the sim and asserts an elite's equals its base's.

**`armored` becomes armour, not health.** At ×2 health an `armored` elite was
3.2 tanks; and armour is the more interesting rule — it is the right to
interrupt, which the player buys with their first hits (doc 013). So
`armored` grants 18 armour, re-armed once when it breaks, and the elite's
health multiplier is the only thing that lengthens the bar.

### Affix assignment

Code draws the affix, as it draws the set today, evenly from what is legal for
**that body** — the charter filters in `affixes.ts` (shielded's room share, the
elemental-only build, `splitting` at roster ≥ 8, the per-room caps of one
`shielded` and two `volatile`) plus the exclusion table above. The draw is
recorded as a decision with its distribution, so the readout shows what was
possible. Jev is not asked: the judgement is all in the enumeration, and what
is left after it differs only in flavour (doc 005).

### Caps and placement

**How many elites a normal room hides is the Director's answer**, not a rate.
A fixed 4% a body is a designer's taste written as a constant, which is the
thing doc 002 converts: whether *this* room should hide one is a judgement
about the player's state, and it is the same judgement `density` and `anchor`
already ask. It is asked as `elite_presence`, below.

| Room | Elites | Who decides |
|---|---|---|
| rooms 1–2 | none | the ramp; the question is not asked |
| normal, rooms 3–5 | 0 or 1 | the Director, from `none` or `one` |
| normal, room 6+ | 0, 1 or 2 | the Director, from `none`, `one` or `two` |
| elite room | up to **4** | code: the first body, then every heavy present (tank, summoner, turret, sentinel and their subspecies), to the cap. The door already promised it, so there is nothing left to prefer |

The **cap of two in a normal room is a hard bound**, not an option Jev may
exceed: `two` is the largest value the question offers, and the placement loop
stops at `NORMAL_ELITE_CAP` whatever it was told.

This replaces `ELITE_SHARE = 0.35` and `strayEliteFor`. At ×2 health, a third
of an elite room's bodies being elite is a room that does not end; four is a
room with four things in it the player picks a kill order for. An elite room
stays an elite room because **its subspecies share is raised a step** rather
than its elite count — the door promises a strange room, and strange is cheaper
and better than tough.

### The visual language

Three channels, each saying one thing, so a body that is both reads as both:

- **A subspecies is a silhouette and a colour**: its mark at the `mark` anchor,
  and its own palette.
- **An elite is warm**: the whole body's ramp shifted toward pink, the pulsing
  ring at its feet (both exist today), and the affix as a small sigil orbiting
  the body at half a turn a second, drawn from the icon frames the HUD already
  has.
- **Neither ever changes the other's channel.** An elite's ramp shift is
  applied over whatever palette the body has, so the pinner is still blue and
  visibly angry.

## Art, and what it costs

The measured alternative first. A walking body carries about 90 atlas frames
and an emplacement 24; thirteen subspecies packed as their own models is about
980 frames, **+58% on the character half of a 6.6 MB atlas** that is already
packed 4096 wide because the roster took it past 4300 rows at 2048. That is
not affordable, and it buys nothing a cheaper pair of channels does not.

So a subspecies is **not a new model**. It is two things:

1. **A mark**, drawn once per facing as its own small sprite in a 32 px frame,
   `mark_<subspecies>_<facing>` — **39 atlas frames in all, about 2%**. The
   base model gains one anchor, `mark`, on the part named below; doc 016's
   anchors already follow every pose without a table, so the mark rides the
   idle, the walk, the windup and the sleep for free. The anchor is **an
   offset from that part's pivot**, not a joint drawn into every variant of
   it, because a point that changes no pixel should not mean editing dozens of
   `.px` drawings; the offsets are calibrated so the mark's ink straddles the
   body's crown, and a pose that hides the part simply carries no anchor. The
   renderer draws it a hair over the body's own depth, and rings it in the
   same near-black ink a body's outline uses — against a hue it would be a
   stain, against ink it is a silhouette.
2. **A palette**, applied at runtime as a 32-entry LUT over the body's ramps
   by a Phaser pipeline: **Phaser's own single-texture shader with the lookup
   spliced in front of the tint arithmetic**, so tint and tint-fill still
   reach a swapped body and the hit flash is not lost on exactly the bodies
   this marks out. No atlas growth. The table is rebuilt in the room's light,
   because the sheet the shader samples has already been through the mood.
   The elite's `setTint(0xffa8b8)` stays where it is, in its own channel.

The shift carries the colour and the mark carries the shape, and **the shift
has to be large**: twenty or thirty degrees with the chroma pulled down is a
difference that survives a contact sheet and dies in a room. Everything but
the emberling — whose tell is going grey around a hot core — moves at least
fifty-five degrees and keeps its chroma. Lightness is never touched, so a body
stays inside doc 016's value band, and the outline is never touched, because
two rings of near-black ink are most of what separates any body from the
stone.

| Subspecies | Anchor part | The mark | Palette move |
|---|---|---|---|
| pinner | `core` | a forked tip | steel → rose |
| wisp | `core` | a curled horn | teal → violet |
| beacon | `core` | a signal flare | iron → ember teal-green |
| watcher | `core` | a lens barrel | brass → pale blue glass |
| fusilier | `head` | a plume on the helmet | gold → hot rose |
| pealer | `head` | a crown of three small bells | bronze → verdigris |
| quaker | `core` | an angled spur | stone → pale green basalt |
| chainer | `head` | a hooked crest | rust → magenta |
| burrower | `head` | a pair of tusks | clay → wet teal |
| emberling | `head` | a split, glowing vent | coal → ash grey, hot core |
| planter | `shard_l` | a frond in place of the shard | blue → deep green |
| breaker | `head` | a blunt ram wedge | iron → rose and verdigris |
| brooder | `head` | an egg sac on the shoulder | robe → bruised magenta |

No two marks share a silhouette, and no accent sits in doc 008's reserved
enemy-bullet band — a mark in that band is a pixel the player has been trained
to read as a bullet, sitting on a body's head.

Thirteen marks × three facings, thirteen LUTs, thirteen anchors added to
existing rigs. **No new poses, no new cycles, `pnpm sprite:motion` is not
re-run**, and the amplitude and one-silhouette checks are unaffected.

## The Director chooses; the ramp bounds

Three questions join the encounter profile in **round 2** (004, 005), beside
`composition`, `density`, `wave_structure`, `anchor` and `entry`. They read the
state that request already carries and no room question reads their answers, so
they are questions *in* round 2 rather than a request of their own: **a run
makes no more Jev calls than it does today**, and the cost table in 002 is
unchanged.

The division is doc 002's, applied line by line:

| | Owner |
|---|---|
| when a subspecies id may exist at all (its unlock room) | code, the ramp |
| the ceiling on how much of a room may be strange | code, the ramp |
| at most two distinct subspecies in a room | code, doc 005's readability rule |
| at most 2 elites a normal room, none before room 3, 4 in an elite room | code, hard |
| which subspecies this room shows | **Jev** |
| how heavily | **Jev** |
| how many elites a normal room hides | **Jev** |
| which affix an elite carries | code (the enumeration is the judgement, doc 005) |
| the pressure re-measurement and the retry | code |

### `subspecies` — which ones

One **ranked** question over single bodies, and code takes the top two distinct
answers for the room's two slots. Asking per body would be counting, which Jev
does not do; asking one question for a set would be a question over a product
space; and asking two questions over one list is a set question in disguise —
they could name the same body, the second had to be told in prose that it was
the second, and neither said which of the two the room wanted more.

- **Options are the subspecies whose base is actually in the assembled roster**
  and whose unlock room the ramp has reached, plus `fallback`. A roster holds
  three to five distinct bases, so the list is three to five options long rather
  than fourteen — the length that measured well on the live model, and the
  reason the list is filtered rather than described away.
- **`none` is not one of them.** It was, as a stop in the ranking, and measured
  on the briefing arm it took 66% of rooms. It is a yes-or-no wearing a
  which-one: a question that reads a slate of bodies had one option that was not
  a body, and `subspecies_weight` already carried the same answer. Whether the
  room shows variants at all is that question; this one is only which, if it
  does. When the weight answers `none` the slate is not used and this question
  is not read.
- **The slate can be empty** — the ramp unlocks nothing before room 3 — and a
  question with fewer than two options is not asked, as with `density` and
  `anchor`.
- On the briefing arm each option's negative is generated from the enemy table
  (`subspeciesSpec`): the base body, which the change is only legible against,
  and the tags, which say which kind of pressure it is more of.
- Each option is grounded in what the twist *asks of the player*, so the fit
  clauses partition state rather than restating the flavour:

| Subspecies | Fits when |
|---|---|
| lancer, breaker | `sword_share` none; `movement_pressure_recent` light |
| pinner, watcher | `sword_share` most; `keys_lean` spam |
| wisp, planter | `sword_share` some; `keys_lean` area, dot |
| beacon, quaker | `keys_lean` nuke; `clear_speed` fast |
| chainer, burrower | `movement_pressure_recent` light; `clear_speed` normal |
| emberling, fusilier | `sword_share` most, some; `clear_speed` slow |
| pealer, brooder | `clear_speed` fast; `damage_rate` high |

Taken over the **unfiltered** set, every level of `sword_share` and of
`movement_pressure_recent` appears, so no state falls through to `fallback`
(002, "Some field must be covered end to end"). Each clause names one field;
none is a conjunction.

### `subspecies_weight` — whether, and how heavily

One question, three gameplay options and `fallback`. Doc 002 allows this
shape explicitly: *choosing a quantity from a short option list is a Choice,
not counting.* It is also where the yes-or-no lives: `none` is a real room —
the one the strangeness of the next room is read against, and the only one
where what the player has learnt this run is simply true — and it is read
before the slate, so an answer of `none` means the room takes no variants
whatever the ranking said.

| Option | Share | Fits when |
|---|---|---|
| `none` | 0 | `run_progress` early; `damage_rate` low; `last_room_kind` elite; `health` low or critical |
| `some` | 0.15 | `run_progress` mid; `damage_rate` fair; `clear_speed` normal |
| `many` | 0.25 | `run_progress` late or pre_boss; `damage_rate` high; `clear_speed` fast; `last_room_kind` rest |

**The share is code; the label is Jev's.** 0.15 and 0.25 are the ends of this
document's own 15–25% band, and the ramp clamps whatever was chosen against its
ceiling: at rooms 3–5 the ceiling is 0.12, so `many` is not offered there at
all and `some` lands at 0.12; at rooms 6–9 a `many` answer lands at 0.20. Only
from room 10 does `many` mean the full 0.25. An elite room raises the chosen
label one step — `some` behaves as `many` — because the door promised a strange
room, and it is still clamped by the same ceiling.

`last_room_kind: elite` on `none` is the pacing rule this question exists to
make available: two strange rooms running read as one long strange room, and a
Director that can see what the last room was can answer that without a
"not twice running" rule, which would be a count and therefore code.

### `elite_presence` — how many elites a normal room hides

One question, asked only for a **normal** combat room from room 3.

| Option | Fits when |
|---|---|
| `none` | `health` low or critical; `recent_damage` heavy; `damage_trend` rising; `damage_rate` low |
| `one` | `health` ok; `tension` build; `damage_rate` fair; `last_room_kind` rest |
| `two` | `health` full; `clear_speed` fast; `tension` peak; `damage_rate` high |

`two` is offered from room 6 and `none`/`one` from room 3, which is the ramp
narrowing the list before either arm answers rather than an instruction not to
overdo it. Every level of `health` appears across the three, so the question is
covered end to end.

### What code still does with the answers

1. **The room picks its subspecies, not each body.** The two slots name the
   room's kinds; every body of those bases is then substituted at the chosen
   share, from `rng("gameplay")`. So a subspecies reads as a theme — "this
   room's shooters are pinners" — which is also how the player learns one. Doc
   005 holds a room to three or four enemy types the player can tell apart, and
   a subspecies counts as a type.
2. **`ROSTER_CAP` counts a subspecies as its base**, so a room never holds both
   a tank and a breaker, or two turrets wearing different marks.
3. **The ramp bounds it**, in `ramp.ts` beside the rest, as a hard filter at
   the world — so whatever either arm asked for and whatever fallback preset it
   reached, an early room is a plain room:

| rooms | share ceiling | ids unlocked | elite options |
|---|---|---|---|
| 1–2 | 0 | none | none; not asked |
| 3–5 | 0.12 | the five from room 3 | none, one |
| 6–9 | 0.20 | those plus the six from room 6 | none, one, two |
| 10+ | 0.25 | all fourteen | none, one, two |

4. **Pressure prices the chosen share as an expected weight**, exactly as
   `affixPressureMultiplier` prices an affix over the share of the roster that
   carries it: a body of base *b* eligible for substitution is measured at
   `w_b × (1 + share × (w_sub/w_b − 1))`. At a 0.20 share and a mean ratio of
   1.21 that is about +4% on a roster's pressure, well inside the retry loop,
   and it is **exact rather than approximate** because the answers arrive in
   round 2 *before* the roster is assembled and measured. The alternative —
   measuring the base roster and substituting afterwards — is the bug doc 005
   describes for the two threat tables: the tier a composition is offered as
   and the pressure it delivers coming from different numbers. Jev choosing the
   share does not weaken this; it only means the number being priced came from
   an answer rather than from a table.
5. **The rule arm answers the same three questions** from `weights.ts`, as it
   does every other profile question, so a rule run and a degraded Jev run are
   still the control the experiment needs (002's fallback contract). Its
   weights: `many` scales with `damage_rate` and against `since_release`;
   `elite_presence` scales with health and against `damage_trend` rising.
6. **Every answer is a recorded decision**, with its distribution and its
   `source`, so the readout shows which subspecies were possible, which came
   up, and which arm chose.

**`MIX_RATIOS` is still untouched**, and no subspecies appears in `ENEMY_IDS`.
The Director chooses a room's strangeness; it never chooses a roster entry.

## Data sketch

```ts
// types.ts
export type EnemyId =
  | "rusher" | "shooter" | "turret" | "orbiter" | "tank" | "summoner"
  | "lancer" | "sentinel" | "warden" | "bellringer" | "rifter"
  | "snarecaster" | "delver" | "cinderling" | "sower" | "boss"
  // The subspecies, one per base. `lancer` is the rusher's and predates them.
  | "pinner" | "wisp" | "beacon" | "watcher" | "fusilier" | "pealer"
  | "quaker" | "chainer" | "burrower" | "emberling" | "planter"
  | "breaker" | "brooder";

// encounters/enemies.ts
export interface EnemyDef extends EnemyArchetype {
  /** The archetype this is a subspecies of, or null for a base body. */
  readonly base: EnemyId | null;
  /** The first room index it may be substituted in. Null for a base body. */
  readonly from_room: number | null;
  /** Affixes that may never ride on this body (doc 019). */
  readonly affix_excluded?: readonly EliteAffix[];
  /** The anchor its mark hangs from; the model gains the anchor, not a part. */
  readonly mark_anchor?: string;
  // …aggro_range, summon, flying, resist as today
}

const PINNER: EnemyDef = {
  ...SHOOTER, id: "pinner", base: "shooter", from_room: 3,
  threat_weight: 2.6, mark_anchor: "fin_l",
  // The whole twist: one lane, twice. No code, only the pattern.
  pattern: sequence([
    { pattern: single({ speed: 165, aim: "player", interval: 1.0, size: 1 }), duration: 1.0 },
    { pattern: single({ speed: 300, aim: "last", interval: 1.0, size: 0.7 }), duration: 0.35 },
    { pattern: rest(), duration: 2.6 },
    // …the base's second and third windows, each doubled the same way
  ]),
  description: "Puts two shots down one lane, the second a beat behind the first: step off, and keep going.",
};

/** The subspecies of a base, or null. Total over `EnemyId`. */
export const SUBSPECIES_OF: Readonly<Record<EnemyId, EnemyId | null>>;
export function baseOf(id: EnemyId): EnemyId;          // a base maps to itself
export function isSubspecies(id: EnemyId): boolean;

// encounters/ramp.ts — the bounds, and only the bounds
export interface Ramp {
  // …waves, perWave, climaxBonus, alive, densities, anchors, elites, tokens
  /** The most of a room that may be subspecies, whatever the Director asked. */
  readonly subspeciesCeiling: number;
  /** Distinct subspecies one room may hold. */
  readonly subspeciesKinds: number;
  /** The `elite_presence` options this point in the run may be offered. */
  readonly elitePresence: readonly ElitePresence[];
}
/** The ids unlocked at this room index, for the slot questions' option list. */
export function rampSubspecies(roomIndex: number): readonly EnemyId[];

// types.ts — the three answers, beside the five profile fields
export type SubspeciesWeight = "none" | "some" | "many";
export type ElitePresence = "none" | "one" | "two";
export interface EncounterProfile {
  // …composition, density, wave_structure, anchor, entry
  /** Up to two ids, `none` dropped, duplicates collapsed by the resource rule. */
  readonly subspecies: readonly EnemyId[];
  readonly subspecies_weight: SubspeciesWeight;
  /** Normal rooms only; an elite room is placed by code. */
  readonly elite_presence: ElitePresence;
}

// encounters/substitute.ts — new, pure
/** The Director's label, as a share. Code owns the numbers (doc 002). */
export const SUBSPECIES_SHARE: Readonly<Record<SubspeciesWeight, number>> =
  { none: 0, some: 0.15, many: 0.25 };
/** An elite room raises the chosen weight one step: the door promised strange. */
export function weightForRoom(w: SubspeciesWeight, elite: boolean): SubspeciesWeight;

export interface Substitution {
  readonly roster: readonly EnemyId[];
  readonly kinds: readonly EnemyId[];
  /** The share actually used: the Director's, clamped by the ramp's ceiling. */
  readonly share: number;
  /** What the pressure model multiplies each eligible body by. */
  readonly expected_weight: Readonly<Partial<Record<EnemyId, number>>>;
}
export function substitute(
  roster: readonly EnemyId[], profile: EncounterProfile, roomIndex: number,
  elite: boolean, rng: Rng,
): Substitution;

// encounters/affixes.ts
export const ELITE_HP = 2.0;
export const ELITE_DAMAGE = 1.3;
export const ELITE_SPEED = 1.15;
/** The gap between turns, and nothing that is a telegraph. */
export const ELITE_REST = 0.85;
/** One affix, from what is legal for this body. */
export function affixesFor(id: EnemyId, ctx: AffixContext, rng: Rng): EliteAffix[];

// sim/world.ts — the caps are code's whatever the answer said
export const NORMAL_ELITE_CAP = 2;
export const ELITE_ROOM_CAP = 4;
export const ELITE_COUNT: Readonly<Record<ElitePresence, number>> = { none: 0, one: 1, two: 2 };
/** An elite kill always heals this share of maximum health, and drops a coin. */
export const ELITE_HEAL_FRACTION = 0.1;

// sim/pickups.ts
export type PickupKind = "coin" | "heart" | "mana" | "mote";
```

## Balance method

The harness measures three things, and each has a number it has to hit before
phase 2 is done. All three are already collected per archetype; the work is
keying them by the concrete id rather than by the base.

- **Hearts by subspecies.** `HURT_BY` keys become the spawned id, so
  `bullet:pinner` and `contact:breaker` separate from their bases. Targets: no
  single subspecies over **8%** of a run's hearts (the shooter's 28% is the
  failure this guards against), and each subspecies' hearts per encounter
  between **1.0 and 1.6×** its base's — under 1.0 and the twist is decoration,
  over 1.6 and the weight is wrong. Threat weights are re-fitted against
  measured hearts until Spearman ≥ 0.7 holds over the sample with the
  substitution priced in (doc 011).
- **Idle share.** `STATES` by id. A subspecies' `idle` may not exceed its
  base's by more than **3 points**. A twist that makes a body wait longer for a
  turn is a worse body however interesting it reads, and the anchor, the peal
  and the planted ring are all at risk of it.
- **Dodge checks.** Per new move, two tests and one measurement. The tests are
  static: the tell is **≥ 260 ms** (the reaction floor every telegraph in the
  game is sized against), and the ground the player must cross to leave it is
  reachable at 240 px/s inside the tell. The measurement is the reference
  player (`REACTION_MS = 230`): **≥ 90%** of each move's instances dodged, and
  — the elite rework's headline number — **an elite's figure within 2 points
  of its base's**, which is what "telegraphs are never shortened" means when it
  is measured rather than asserted.

Three more that guard the shape rather than the difficulty: the measured
subspecies share lands in **15–25%** from room 6 and is **0** before room 3;
`BY_INDEX` for rooms 1 and 2 is unchanged (they see none of this); and elite
rooms stay under doc 005's ceiling of 4 hearts and 90 s **net of the heal**.

And two that measure the *Director* rather than the content, as doc 011
measures every other question — because a question that is always answered the
same way is a constant with a request attached:

- **Spread.** Over a run, `subspecies_weight` and `elite_presence` must each
  use more than one option, and no option may take more than **70%** of the
  answers. The failure this catches is the one 002 records for
  `mood_temperature` and `elite_portal`: an ungrounded option list that
  collapses onto one answer.
- **Escape mass.** `fallback` under **0.1** mean on all three questions, which
  is what the grounding tables above are for. The grounding test asserts
  statically that every field a fit clause names is a field the round-2 state
  carries; this is the measured half.

## Implementation plan (phase 2)

By file, each line covered by the test beside it.

| File | Work | Test |
|---|---|---|
| `core/src/types.ts` | 13 ids; `EnemyDef.base`, `from_room`, `affix_excluded`, `mark_anchor`; `Enemy.damageMult`; `PickupKind` gains `mote`; `EncounterProfile` gains `subspecies`, `subspecies_weight`, `elite_presence`; `SubspeciesWeight`, `ElitePresence` | type-level, via the totality tests below |
| `core/src/encounters/enemies.ts` | 13 defs spread from their bases; `SUBSPECIES_OF`, `baseOf`, `isSubspecies`; `CLASSES` and `ALL_ENEMY_IDS` entries; `ENEMY_IDS` **unchanged** | every base but `lancer` and `boss` has exactly one subspecies; every weight is 1.15–1.30× its base's; `baseOf` total; no subspecies in `ENEMY_IDS` |
| `core/src/encounters/ramp.ts` | `subspeciesCeiling`, `subspeciesKinds`, `elitePresence` per step; `rampSubspecies(roomIndex)` | ceilings and unlocks by room index; nothing before room 3; `two` not offered before room 6 |
| `core/src/encounters/substitute.ts` *(new)* | `SUBSPECIES_SHARE`, `weightForRoom`, and the substitution from the profile's answers, pure over an `Rng` | determinism from a seed; ≤ 2 distinct kinds; the ramp's ceiling clamps a `many` answer at rooms 3–5; measured share 15–25% at room 6 over 10 000 draws; `ROSTER_CAP` honoured through `baseOf` |
| `core/src/encounters/pressure.ts` | the expected-weight multiplier, from the chosen share | monotone in roster size; the 432-profile space still lands in band or reaches a preset, at every weight |
| `core/src/encounters/assemble.ts` | carry the three answers onto the plan and price them before measuring; the presets answer `none`/`none` | a preset roster is never substituted; the band holds at `many` |
| `core/src/encounters/affixes.ts` | one affix, not a set; `affix_excluded`; `armored` → 18 armour | the exclusion table holds for every id; charter invariants unchanged |
| `core/src/sim/enemy.ts` | `ELITE_HP/DAMAGE/SPEED/REST` in `makeEnemy`; `isElite` twist branches re-keyed to the id | **a table over every windup, aim, prime and growth constant: an elite's equals its base's** |
| `core/src/sim/attacks.ts` | re-key ten twists; add the wisp's curl, the beacon's live ground, the brooder's hatching coal | one per twist: the telegraph is emitted, at its duration, and the hit lands where it was drawn |
| `core/src/sim/melee.ts` | the breaker's crack (reuses `shockCleave`); damage × `damageMult` | the crack's lane is drawn before it is live |
| `core/src/sim/world.ts` | substitution at spawn replaces the lancer case; `ELITE_COUNT` from the profile, held by the two caps; `killPays` drops the mote | ≤ 2 elites in a normal room whatever the profile said, ≤ 4 in an elite one; none before room 3; an elite kill always drops a coin **and** a mote |
| `director/src/director.ts` | `subspecies`, `subspecies`, `subspecies_weight`, `elite_presence` in `encounterQuestions`, options filtered by the roster and the ramp; the `resource` collapse and the under-two-options drop reuse what is there | the option list is only unlocked ids whose base is in the roster; two slots naming one id collapse to one; the questions vanish in rooms 1–2 |
| `director/src/questions/fits.ts` | no new `FIT_FIELDS` — every clause above uses fields the round-2 state already carries | `grounding.test.ts`: every field named is in that request's state, every level is one it can take |
| `director/src/weights.ts` | the rule arm's weights for the three questions | the rule arm answers all three for every state, and never exceeds the ramp |
| `director/src/plans.ts`, `trace.ts` | the three answers on the plan and in the trace, with `source` | the readout names the subspecies, the weight and the elite count |
| `core/src/sim/pickups.ts` | the mote heals `ELITE_HEAL_FRACTION` of maximum health | heals 10%, never over the cap |
| `game/src/scenes/enemy-frames.ts` | frames resolve through `baseOf`; the mark drawn at the `mark` anchor | every id resolves to frames that exist — the boss-fallback bug this module exists for |
| `game/src/scenes/play.ts` | the palette-LUT pipeline; elite ring and affix sigil; `setTint` removed | the readout names the subspecies and the affix |
| `assets/models/*/rig.json` | one `mark` anchor per base | `models.test.ts`: every frame gives every anchor the rig names |
| `assets/` | 13 marks × 3 facings, 13 LUTs, manifest rows | the manifest lists every frame the game asks for |
| `harness/src/play/run.ts`, `cli/play.ts` | key `HURT_BY` and `STATES` by id; the subspecies share and the per-move dodge table in the printout | — |
| `docs/planning/005` | the elite section points here; the lancer moves from elite form to subspecies; the encounter-profile table gains the three questions | — |
| `docs/planning/011` | the two Director-spread measures join the question readout | — |
