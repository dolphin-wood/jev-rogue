---
id: 017
title: Rooms Larger Than the View
status: proposed
date: 2026-09-23
summary: The world is seen through a fixed viewport of 16 × 9 tiles, fitted to the window, and a room is larger than it — half again, three quarters again or twice the viewport a side, by a size label the Director picks. Every room is declared once on a base grid of 21 × 13 and carried to its size, so the archetypes, skeletons and fallbacks serve every size. The first view of a room holds part of its fight; a body sees further while a fight goes on beside it; the reward and the portals rise beside the player and show on the minimap. Walls never meet at a corner only.
depends_on: [002, 004, 005, 008, 014, 015]
---

# 017 Rooms Larger Than the View

## Why

With the whole room on one screen, the encounter had to be released in waves
to last its 30 to 40 seconds, and a wave was every body in the room at once.
A room larger than the screen gives the fight somewhere to go: groups met one
or two at a time, an approach to choose, a sneak attack that means something.

Zooming the camera in to make the room larger than the screen was tried and
dropped (doc 008): it coarsened every pixel. The view is a fixed number of
tiles and the room grows instead.

## The measures

| Measure | Value |
|---|---|
| Viewport | 16 × 9 tiles, 512 × 288 world px, fitted to the window (doc 008) |
| Tile | 32 px; a body is about 0.8 of a tile tall, so the view is 11.5 bodies tall |
| Base grid | 21 × 13, where every declaration is written |
| Room | its size label's extent, in the top-left of a 33 × 19 grid; wall beyond it |
| Sword reach, dash, spell ranges, bullet speeds, aggro | unchanged |

## Size is a parameter

A room's **size** is a round-1 room parameter beside space and symmetry (doc
004), one question the Director answers per room:

| Label | Extent | Views a side | Fits |
|---|---|---|---|
| `compact` | 25 × 13 | 1.5 | release rooms, the merchant and blacksmith |
| `standard` | 29 × 15 | 1.75 | most combat, the boss arena |
| `vast` | 33 × 19 | 2 | peaks and elite rooms |

Each extent is odd a side, so a room keeps a centre column and a centre row
for its doors and its mirror. The rule arm gives rooms without a fight
`compact`, leans a release to `compact`, a build to `standard` and a peak or
an elite room to `vast`.

## One declaration, every size

The masks, the skeletons (doc 004), the archetypes' zone slots and spawn
groups and the authored fallbacks are written on the base grid and carried
to the room's extent (`rooms/extent.ts`), three ways for three kinds of
thing:

- **Outlines stretch.** A mask's band or core, a skeleton's rectangle: its
  edges are spread evenly from the base interior to the room's.
- **Spawn cells spread.** A spawn cell lands in the middle of the block its
  base cell stretched to.
- **Zone slots move, keeping their shape.** A hazard is as large round a body
  in a large room as in a small one, only further away.

All three commute with the mirror, so a mirrored declaration stays mirrored
and the base's centre column lands on the room's. On the base grid the map is
the identity. Every declaration is checked at every size: free floor under
the mask, clear of the doors, disjoint from the others. The authored
fallbacks stretch each base cell to its block and stamp the doors at the
extent's own midpoints.

The obstacle bands are shares and hold at every size. The pillar bands are
counts, and grow with the floor at the 0.85 power of the area: the 3-tile
lanes do not grow, and in proportion a mirrored gallery in the pinched
corridor at the standard size relaxed 26 rooms in 100, against 6 at the
0.85 power. Across all sizes the generator relaxes a label for about one
room in 150 and never falls back to an authored room.

## The fight is spread over the room, and one station of it is in the first view

A room larger than the view has two ways to read wrong, and it had both at
once: the opening roster put four bodies inside two tiles of one point in the
entry view and sent the rest to planned spawn cells a large room spreads past
the edge, so the room was a knot by the door and several screens of nothing.

The opening roster is dealt into **stations** instead — small groups of two or
three, about **one per viewport of open floor**, to a maximum of four. The
first station stands in the view the player enters to (the camera's view as it
first frames them, held inside the room), a tile in from its edges and at
least **five tiles** from the door. The rest form a **chain**: each next
station is placed about **seven tiles** — most of a viewport — from whatever
is already nearest, preferring open ground, so the chain runs along the way
the player is going rather than into the corners. Within a station the bodies
stand at least **1.6 tiles** apart. A station is tighter than the alarm radius
and the next station is further than it, so the ripple takes a station
together and the room stays a set of fights whose order the player chooses
(doc 005).

Later waves are **reinforcements**: each body lands on the nearest floor that
is outside the player's view and at least six tiles from them, and it arrives
**awake** and without the floor telegraph, so it walks into the fight from off
the edge of the screen rather than growing out of the floor beside the player
— and never back onto the ground the player has just cleared, which is the
ground they are standing on. Choosing the nearest such cell rather than the
furthest is deliberate: the far corner added seconds of empty floor to every
wave. The gate opens **one body early**, because the walk in takes a second or
two and the wave should arrive as the last of the group in front of the player
falls.

**The room is called in before the screen goes quiet.** With the awake bodies
down to one, the nearest body that has not noticed the player wakes 0.95 s
later; with a fight going on but nothing visible in the view, after 1.1 s;
with nothing awake at all, after 4 s. And nothing leaves the screen to avoid a
fight: a body giving ground stops at the edge of the view and holds, and a
body inside the view never stops to search when it loses the line.

A vendor's room is `compact`, and its merchant or smith stands at its middle,
inside the first view from any door.

When the encounter is placed in **camps** instead of waves — one or two to a
region of the room, each tighter than the alarm so the first body to notice
the player brings its camp — the first camp is the one in the first view,
and each after it is as far as the floor allows from the door and from the
camps before it.

Measured over twenty-four runs across every uncleared combat and elite room,
counting a body as in view only when the player can actually **see** it:
**2.11 visible bodies in view on average, nothing in view 12.5% of the time
and more than six in view 0.6%** — against 1.67, 22.6% and 0.2% for the
placement this replaces. Of the 12.5%, 3.6 points are a body on screen with a
pillar between it and the player for a moment, which is what doc 015 puts the
pillars there for.

## What the player can see and hear

A body's aggression fades past the viewport's edge rather than stopping at
it, measured in px from the edge, so neither the window nor the room's size
changes what it means:

- **Its fire** fades from full at the edge to none **64 px past it**; a volley
  it was aiming past that is dropped, and it takes no turn to attack.
- **Its closing speed** eases to 60% over **160 px** past the edge, so bodies
  still come to the fight but none arrives at a sprint.

After the alarm's ripple the fight is still **heard** (doc 005): a body with
an awake neighbour inside its own aggro range sees 1.3 times as far, and a
sleeper with one wakes at its whole range, so nothing sleeps through a fight
it could watch.

The reward rises beside the player and the portals are made in a row in
front of them (doc 003); the minimap marks the reward and every open portal,
so neither is lost in a room larger than the screen.

## Walls meet along an edge

Two solids never meet at a corner only — solid on one diagonal of a 2 × 2 of
cells and floor on the other. It looks like it closes the space between them
and does not; a space closed by it is closed by a point. The generator
refuses an obstacle placed so, and closes any the mask or the fixtures leave
by filling one of the two floor cells, so the solids share an edge, where
that cuts nothing off.

## What changes, by document

- **004 Room Generation**: the size question; every declaration on the base
  grid and carried to the extent; pillar bands by area.
- **005 Encounters**: the first four opening bodies in the first view; a
  fight nearby is heard.
- **008 Combat Core**: the fixed 16 × 9 viewport fitted to the window.
- **014 Run Length**: a `standard` room is still 30 to 40 s; a `vast` one is
  a peak.
