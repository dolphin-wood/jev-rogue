# Art work order — key poses (batch E)

Every body in the game is now a **sprite model** (`docs/planning/016-sprite-models.md`):
its frames are composed from drawn parts placed by a rig, so most new frames
are a pose rather than a drawing. What a pose cannot do is change a
silhouette that no part can reach — an arm crossing the body in a head-on
view, a leg leaving the ground under a shell that dwarfs it, a two-hundred-
and-fifty-six pixel construct that has no limbs to move.

This batch is exactly those frames, and nothing else. Each one is listed with
the number it misses: `amplitude` is 1 − IoU of the alpha masks between the
two poses named, measured by `pnpm sprite:amplitude`, and the floor each must
clear is in **Acceptance** below. Everything not listed here is already being
posed by the rig and must not be redrawn.

## E0. How these frames are consumed

They are **not** packed straight into the atlas. Each is delivered as a whole
figure and then cut into parts by `pnpm sprite:split <body>`, which is what
lets the rig go on posing it. That imposes five things beyond the usual
rules:

- **Parts must be separable.** Anything the rig moves has to be visually
  separable from what it hangs off: each foot from the hem, each arm from the
  torso, the head from the shoulders, a held weapon from the hand. A limb
  drawn fused into the body by a continuous band of the same shade cannot be
  cut out, and the split will take the torso with it. A one-pixel change of
  shade, or the outline running between them, is enough.
- **Keep every part inside its region.** The split claims parts by where they
  sit in the figure's own bounds (`claimsFrac` in each model's
  `split.json`): head in the top third and the middle 30% of the width, arms
  in the outer quarter, feet in the bottom quarter, torso everything else. A
  hand thrown across to the far side of the body will be cut as the other
  arm. If a pose needs that, say so in the delivery notes and the claim will
  be widened by hand.
- **Draw the joints where they already are.** Shoulders, waist, neck, hips
  and the grip stay at the proportions of the body's existing `idle0`, so
  the parts keep meeting. Move the limb, not the socket.
- **The palette is fixed per body** and no new colours may appear, **and that
  includes the outline**. The ink is the `outline` ramp in
  `assets/models/<body>/palette.json` — `#040407` for the player, `#030305`
  for the rusher, a different near-black for each body — and it is
  authoritative. The `#0d0b1f` quoted in `docs/art-workorder.md` is the
  *renderer's* ink slot, not a per-body value; nothing checks a drawing
  against it. In practice: **use the near-black already in that body's
  `palette.json`**. Anything darker than the body's outline luma is snapped
  to that ramp on import regardless, so a near-black that is a shade off is
  corrected rather than kept — but drawing the exact value is what lets you
  see what the atlas will show. The ramps for the two bodies most of this
  batch touches:

  | | player | rusher |
  |---|---|---|
  | outline | `#040407` | `#030305` |
  | body | cloth `#181934 #25264e #303162 #373a77 #404488 #706d8f` | shell `#1b1a35 #202043 #26264f #2a2c5d #333565 #383b73 #535279` |
  | trim | `#857766 #a89680 #c4b099 #e1c9ad #f7ddbd` | bone `#968278 #a79182 #b8a08c #c4ab98 #ccbfa8` |
  | accent | gem `#093b56 #1278a3 #08acd1`, eye `#4e4102 #ccb109 #f7e5bd` | eye `#045d6f #02a1a8 #26c9cc` |
  | leather / shadow | belt `#37201d #4e322d #6d4a40 #9b7362`, umber `#24201b #443d34 #64594c` | dusk `#282928 #534b46 #7c6d66` |

  Every other body's ramps are in its own `palette.json`; read it before
  drawing. Colours are quantised to these ramps on the way in, so an
  off-ramp colour is silently snapped rather than kept.
- **Value band.** Enemy bodies are held in a value band on import
  (`enemyValueBand`): highlights are capped and midtones pulled down, so draw
  them at the value the existing sheets sit at, not brighter. Do not
  compensate.

The usual rules still hold and are not negotiable: the body's own near-black
outline (above) on every entity, light from the **top left**, pixel art
authored on the 1× grid and delivered at **4×**, each entity **centred on its
collision circle** with its feet on the bottom centre, and **the magenta band
`#ff3fa4` means an enemy projectile in the air and nothing else** — telegraph
accents use the warm range around `#ff5544`.

**Hard alpha: no anti-aliasing, no soft edges.** This is not a stricter taste
than `docs/art-workorder.md`'s "soft alpha on edges only" (**Hard rules**) —
it is what the pipeline does. `enforceReadability` in
`packages/harness/src/assets/art.ts` **binarises alpha at 128**: below that a
pixel is thrown away, at or above it is made fully opaque. A feathered edge
is therefore not softened in the atlas, it is *rounded*, and which half of
each edge pixel survives is decided by a threshold rather than by you. Draw
the edge you want. (The `soft-alpha` check's 25% limit is measured on the
finished atlas, where alpha is already binary, so it cannot fire here; it
guards art that reaches the sheet by another path.)

**Delivery format.** One PNG grid per sheet under `assets/source/melee/`,
**columns are poses in the order listed, rows are facings in the order
`s`, `n`, `w`** (omit rows a sheet does not need and say so), each cell
exactly 4× the frame size — 256 px for a 64 frame, 384 for 96, 1024 for 256.
Never draw `e`; the game mirrors `w`. After delivery the frames are wired by
adding a `meleeGrid` recipe in `sourceFor` (`packages/harness/src/assets/art.ts`),
listing the sources in the body's `assets/models/<body>/split.json`, and
re-running `pnpm sprite:split <body> --force`.

**Nothing in this batch needs a manifest or `frames-melee.json` edit.** The
manifest is read from each model's `anims.json`
(`modelManifest` in `manifest.ts`), so a pose that becomes an atlas frame
appears in it the moment the model delivers it; and
`assets/source/frames-melee.json` is *generated* from that manifest by
`packages/harness/src/cli/art-workorder.ts`, so it is refreshed by re-running
that CLI rather than hand-edited. Source poses that never become atlas frames
(marked **split-only** below) never appear in either.

## E1. The frames

### What each delivered pose becomes

A delivered figure is cut into parts, so some poses become an atlas frame of
their own and some exist only to give the rig a set of part drawings to pose
*from*. The second kind is marked **split-only**: it is a source pose in
`split.json`, its name never reaches the sheet, and the frames it feeds are
generated.

| Delivered pose | Model pose(s) it feeds | Runtime frame name(s) |
|---|---|---|
| `player_s_cast_{gather,release,recover}` | `cast_gather`, `cast_release`, `cast_recover` (s) | `player_s_cast_gather`, `_cast_release`, `_cast_recover` |
| `player_n_cast_{gather,release,recover}` | the same three, n | `player_n_cast_gather`, `_cast_release`, `_cast_recover` |
| `player_{f}_{windup,strike,slash,follow,recover}`, f in s, n, w | `swing_windup`, `strike`, `slash`, `swing_follow`, `recover`, per facing | `player_{f}_windup`, `_strike`, `_slash`, `_follow`, `_recover` |
| `enemy_<body>_{f}_walk_contact` | **split-only** — the part variants `step_contact` | `enemy_<body>_{f}_walk0` … `walk7` |
| `enemy_<body>_{f}_walk_pass` | **split-only** — the part variants `step_pass` | the same eight frames |
| `enemy_lancer_burst` | the pose `burst` | `enemy_lancer_burst` |
| `enemy_sower_{f}_{windup,lunge}` | `windup`, `lunge`, per facing | `enemy_sower_{f}_windup`, `_lunge` |
| `boss_p{n}_idle_low` | **split-only** — the variant `breath_low` | `boss_p{n}_idle0` … `idle3` |
| `boss_p{n}_idle_high` | **split-only** — the variant `breath_high` | the same four frames |
| `boss_p{n}_{windup,lunge}` | `windup`, `lunge` | `boss_p{n}_windup`, `boss_p{n}_lunge` |

The three walk bodies and the boss are split-only because their cycles are
**generated** from the shared motion table
(`packages/harness/src/assets/motion.ts`): the gait already composes eight
frames by moving parts, and what it lacks is two drawings to move *between*.
Consuming them is a small addition to that file on delivery — the gait picks
`step_contact` at the cycle's two contact frames and `step_pass` at its two
passing frames, exactly as it already switches a skirt between `sway_l` and
`sway_r` — and the boss's breath interpolates `breath_low` and `breath_high`
across `idle0`–`idle3`. The boss's `windup` and `lunge` are poses it does not
ship today; they join its `deliver` list at the same time.

Throughout this order the two walk keys are called **`contact`** and
**`pass`**. There is no third name for them.

### E1a. The player's cast, head-on — 6 required, 3 optional, 64 px

`assets/source/melee/player-cast.png`, 3 columns (`gather`, `release`,
`recover`) × 3 rows (`s`, `n`, `w`). **The six `s` and `n` cells are
required; the three `w` cells are optional** — the posed side view already
clears the floor (gather→release 0.46). Leave the `w` row **empty** if you
skip it: an empty cell is layout only, it is never registered as a frame, and
the model keeps the pose it composes today. The grid keeps all three rows so
the row order is the same on every sheet in this batch.

The head-on views are the weakest thing in the player's whole set, because
reach toward the camera is a few pixels of foreshortening and the posed
version can only raise a hand.

Draw the player without the staff in every cell. The model supplies the
separate staff part; these keys supply the body, arms, and grip.

| Frame | Facing | Pose |
|---|---|---|
| `player_{f}_cast_gather` | s, n | Both hands drawn back to one hip, staff hand angled across the body, shoulders turned away from the aim, weight fully on the back foot, head dipped. The mana flame swells at the off hand, so leave the open palm clear. Amplitude against `idle0` today: **s 0.18, n 0.16** |
| `player_{f}_cast_release` | s, n | The off arm thrust straight at the camera — foreshortened, so the forearm is short and the **fist is large and low**, over the belt line — the staff arm flung back as counterweight, front foot planted a pixel forward, robe hem flared behind. Draw the hand and arm, not the staff. This is the frame that must not be the gather shifted. Against gather today: **s 0.24, n 0.26** |
| `player_{f}_cast_recover` | s, n | Halfway home: arm dropping, shoulders squaring, hem still trailing, weight coming back to centre. Against `idle0` today: **s 0.07, n 0.22** |
| `player_w_cast_{gather,release,recover}` | w | **Optional.** Redraw only if it is cheap; the posed side view already clears the floor. Leave the row empty otherwise. |

### E1b — delivered and accepted (24 Sep). Nothing outstanding.

Codex delivered the five swing keys in all three facings, drawn **without the
staff** with the sword hand a closed grip, plus a fist overlay. All of it is
in the model and the shipped atlas. What the integration changed on top of the
delivery, so a later sheet matches the code:

- **The fist overlay is one drawing, not fifteen.** Every `fist_overlay`
  variant in every facing was byte-identical — an 8 px closed hand with its own
  ink and a `grip` joint at its centre. It is now a single part,
  `fist_overlay.grip`, cut once into `weapon_player_fist`, painted over the
  shaft at the grip in **every** state and facing. A future key needs no fist
  of its own unless the hand is drawn differently.
- **Cut with no traced outline**, because the drawing already carries its own:
  traced, it came back a twelve-pixel double-ringed ball that read as a knob on
  the shaft rather than as a hand on it.
- **No player frame draws a staff at all now**, not only the swing keys. The
  idle, the walk, the cast, the dash and the hurt all had one composed in; the
  part is out of `rig.json` and out of every pose, and the renderer places one
  sprite in all of them (`drawHeldStaff` in `play.ts`).
- **Three new numbers per facing in `anims.json`**, which the atlas carries
  into every frame's anchors: `staffAngleDeg` (which way the pose holds it,
  `-90` for the standing keys and per-pose for the dash and the two hurts),
  `staffGripPx` (grip to crystal along the shaft — 20 art px, but 15 on the
  back view, which grips higher) and `staffDepth` (positive: over the body, at
  every facing including the back view).

Codex delivered the staff itself on 24 Sep — a forked cap cradling the
crystal, redrawn into `assets/models/player/{s,n,w}.px` (concept and poses in
`assets/source/previews/player-short-staff-*.png`). **Accepted**: every part
parses, no row is space-padded, and the crystal anchor lands within a pixel
of a drawn crystal. It is the single source for the staff everywhere: the
renderer turns that same drawing, because five drawn keys per facing cannot
follow a continuous aim — asked to, they gave a staff held upside down with
its crystal at the floor.

The hand grips it about **two fifths of its length up from the butt** —
measured from the idle frames, not chosen — with the crystal and the long end
above it. The shaft is 3 art px across at the grip; the forked crystal cap is
9 px wide.

**Do not draw the staff again, in any frame.** It is one part, attached at
runtime.

### E1b. The player's swing arc — 15 required, 64 px — **priority 1**

`assets/source/melee/player-swing.png`, **5 columns** (`windup`, `strike`,
`slash`, `follow`, `recover`) × **3 rows** (`s`, `n`, `w`). **Every cell is
required.**

**Delivered 24 Sep and in the atlas.** Kept here for the next body that needs
the same treatment, and for the standard a re-draw would have to meet. The
staff is a separate sprite the renderer turns continuously through the cut;
it is not in this sheet.

Draw the body and sword arm through one continuous arc in all three facings.
Each cell is one moment of the same cut, with a closed grip positioned for
the separately rendered staff. The five keys must read as five moments of
one motion when flipped through. Keep the fist and its attachment point
inside the 64 px frame; the separate staff and magic blade may extend beyond
the body's frame.

| Frame | Facing | Pose |
|---|---|---|
| `player_{f}_windup` | s, n, w | Wound fully back and *coiled*: grip pulled behind the far shoulder, both shoulders turned away from the cut, back foot loaded, front foot light, head last to turn. The extreme of the arc, not a lean. |
| `player_{f}_strike` | s, n, w | The blow crossing the body's centre line at full extension: arm straight, hips opened through, front foot planted hard, grip at the middle of its sweep. Head-on (`s`, `n`) the reach reads **laterally** — draw it across the frame, not toward the camera. |
| `player_{f}_slash` | s, n, w | The next quarter of the same arc, past centre and dropping: body turned further through, grip low and leading, hem carried around a frame behind the body. It must differ from `strike` by more than a shift. |
| `player_{f}_follow` | s, n, w | Carried past the blow and over-rotated: grip low and outside the far hip, weight fully on the front foot, shoulders squared past the aim, head arriving last. |
| `player_{f}_recover` | s, n, w | On the way home: grip rising across the body, shoulders unwinding, weight returning to centre, stance still open. Halfway between `follow` and `idle0`, drawn rather than interpolated. |

Draw the sword arm separately from the torso and keep its hand closed around
the absent shaft. **One** fist overlay is enough for the whole sheet: it is
painted over the rotating staff at the grip, at any angle, so a second copy of
the same drawing per key buys nothing.

### E1c. Walk keys for the three shell bodies — 18 required, 64 px

`assets/source/melee/enemy-{rusher,lancer,cinderling}-walk.png`, 2 columns
(`contact`, `pass`) × 3 rows (`s`, `n`, `w`).

These three walk with 14 px of foot travel and still measure **0.17 / 0.20 /
0.20** between the cycle's extremes, against a 0.13 floor and a 0.25 target,
because a spike shell or a burning hulk is most of the silhouette and the
legs barely dent it. What is needed is the **body** changing between the two
keys, not the legs: the mass rocking fore and aft, the shell dipping and
rising, the spikes swinging with it.

| Frame | Facing | Pose |
|---|---|---|
| `enemy_rusher_{f}_walk_contact` | s, n, w | Front legs planted wide and braced, shell pitched **forward and low** over them, head down, hind legs trailing. The forward extreme of a four-legged lope. |
| `enemy_rusher_{f}_walk_pass` | s, n, w | Body at its highest, shell level or tipped back, near legs gathered under the belly, spikes swung up with the rise. |
| `enemy_lancer_{f}_walk_{contact,pass}` | s, n, w | The same two keys, gold and taller: the eight spike stubs swing with the body, rowing back on the contact and raised on the pass. |
| `enemy_cinderling_{f}_walk_{contact,pass}` | s, n, w | The same two keys for the burning hulk: on the contact the mass slumps forward and the core flares low; on the pass it draws up and the arms hang behind. |

**The rusher's kit is spike stab only.** Do not draw the claw, and treat
`weapon_enemy_rusher` as dead. The lancer's spike sequence — the sockets
holding eight extended spikes, then releasing them — is drawn as the body
frame `enemy_lancer_burst` (**sockets open, no spikes baked in**) plus the
single `vfx_spike_gold` (16 × 6, pointing right, base at the left edge)
repeated eight times and slid out by the renderer; that pair is already in
the manifest and only `enemy_lancer_burst` needs the linger pose: braced
open, sockets lit, body straining, an instant before release.

### E1d. The sower's commit — 6 required, 64 px

`assets/source/melee/enemy-sower-attack.png`, 2 columns (`windup`, `lunge`)
× 3 rows. A seed pod with nothing to swing: `windup→lunge` measures **0.23**
and is the pod moved. Draw the pod **closing tight and drawing back** for
the windup — shards pulled in against the shell — and **cracking wide open**
for the commit, shards flung out to their full spread, the seam lit. The
shards are separate parts and must not touch the pod in either frame.

### E1e. The boss — 12 required, 256 px

`assets/source/melee/boss-p{1,2,3}-keys.png`, 4 columns (`idle_low`,
`idle_high`, `windup`, `lunge`) × 1 row.

The boss barely moves: its idle extremes measure **0.02–0.04** and
`windup→lunge` **0.08**, because the crowned construct is a rigid ring of
plates around a core and the rig can only breathe the core. It needs its
plates to move.

| Frame | Pose |
|---|---|
| `boss_p{n}_idle_low` | The ring drawn **in**: plates pulled toward the core, gaps closed, crown settled, core dim. The bottom of a slow breath. |
| `boss_p{n}_idle_high` | The ring drawn **out**: every plate pushed a clear three to four pixels off the core along its own radius, gaps open, crown lifted, core bright. The top of the same breath. These two are the extremes — they must read as the thing inhaling. |
| `boss_p{n}_windup` | The whole construct wound around its axis and **compressed**, plates tilted back against the turn, core pulled deep, crown low. |
| `boss_p{n}_lunge` | Unwound and thrown forward: plates flung to their outside, the core driven out ahead of the ring, crown snapped up. |

Phase 2 has shed the outer plates and phase 3 most of the ring; draw each
phase from the plates it still has, as the delivered `idle0` frames do.

## E2. Style references

Composed contact sheets of what exists today, at 3× (not checked in; render them locally):

- `player-all.png` — every player frame, s, n, w.
- `rusher-all.png` — rusher, all three facings.
- `lancer-all.png`, `cinderling-all.png`, `sower-all.png`.
- `boss-p1.png` — boss phase 1.
- `assets/source/style-reference.png` — the delivery style reference.

Render any of them with `pnpm sprite:preview <body> --facings s,n,w --zoom 3 --cols 12 --out <path>`.
In-repo sources to match: `assets/source/melee/player-actions.png`,
`player-idle.png`, `player-walk.png`, and each body's existing expansion
sheet in the same directory.

## E3. Acceptance

Every threshold is 1 − IoU of two frames' alpha masks, printed by
`pnpm sprite:amplitude` and asserted by
`packages/harness/src/assets/amplitude.test.ts`. The pair compared is named
for each item, in this order's own frame names.

| Item | Pair compared | Today | Must reach |
|---|---|---|---|
| E1a cast, s | `cast_gather` → `cast_release` | 0.24 | **≥ 0.40** |
| E1a cast, s | `idle0` → `cast_gather` | 0.18 | **≥ 0.30** |
| E1a cast, s | `cast_release` → `idle0` | 0.07 | **≥ 0.25** |
| E1a cast, n | `cast_gather` → `cast_release` | 0.26 | **≥ 0.40** |
| E1a cast, n | `idle0` → `cast_gather` | 0.16 | **≥ 0.30** |
| E1a cast, n | `cast_release` → `idle0` | 0.22 | **≥ 0.25** |
| E1b swing, s | `windup` → `strike` | 0.45 | **≥ 0.40** |
| E1b swing, s | `strike` → `slash` | **0.21** | **≥ 0.25** |
| E1b swing, s | `slash` → `follow` | 0.32 | **≥ 0.25** |
| E1b swing, s / n / w | `follow` → `recover` | 0.36 / 0.33 / 0.35 | hold **≥ 0.25** |
| E1b swing, s | `windup` → `follow` | 0.50 | **≥ 0.40** |
| E1b swing, n | `windup` → `strike` / `strike` → `slash` / `slash` → `follow` | 0.44 / 0.25 / 0.40 | **≥ 0.40 / 0.25 / 0.25** |
| E1b swing, w | the same three | 0.45 / 0.26 / 0.44 | **≥ 0.40 / 0.25 / 0.25** |
| E1b swing, s / n / w | grip and fist overlay of every key | — | **aligned with the separate staff; no staff pixels in the body frame** |
| E1c walk, rusher | the two most different of `walk0`…`walk7`, per facing | 0.17 | **≥ 0.25** |
| E1c walk, lancer | the same | 0.20 | **≥ 0.25** |
| E1c walk, cinderling | the same | 0.20 | **≥ 0.25** |
| E1c walk, all three | consecutive `walk<i>` → `walk<i+1>` | 0.09–0.10 | **≤ 0.32** (no frame may pop) |
| E1d sower | `windup` → `lunge` | 0.23 | **≥ 0.40** |
| E1e boss p1/p2/p3 | the two most different of `idle0`…`idle3` | 0.042 / 0.043 / 0.034 | **≥ 0.12** |
| E1e boss p1/p2/p3 | `windup` → `lunge` | 0.085 / 0.084 / 0.079 | **≥ 0.40** |

Two more that are not numbers: an idle must have **a secondary element that
moves** — a cloth, a spike, a plate — and not only the body rising; and every
walk key must keep at least one foot down.

On delivery I run, in order: `pnpm sprite:split <body> --force` and a part-map
review; `pnpm sprite:amplitude` against the table above;
`node packages/harness/src/cli/assets-art.ts` then `pnpm assets:check`, which
enforces the outline, the magenta band, the value band, the floor contrast and
the no-seam rule; `pnpm verify`; and a visual pass over the contact sheets at
1× and 3×. A frame that cannot be cut into parts, or that moves a joint,
comes back.

## E4. Priority

1. **E1b** the player's swing arc, all three facings — the player swings constantly, it is the animation reported as messy, and north and west have no drawn arc at all.
2. **E1a** the player's cast, head-on — "casting looks like standing to attention" was the report.
3. **E1c** the three shell bodies' walk keys — most enemy screen time.
4. **E1e** the boss — rarely seen, but nothing it does reads at all.
5. **E1d** the sower.

A partial delivery is useful at any point: each sheet is wired independently,
and a body keeps its posed frames until its drawn ones arrive.

---

## How to deliver

The contract is the one the baseline 436-frame atlas was delivered under; Parts A-D expand the production atlas to 896 frames. Read
these sections of `docs/art-workorder.md` before drawing anything: **Hard
rules**, **Sizes**, **Colour**, **Facings**, **The perspective, and the one
rule it imposes**, and **Delivering**. In short:

- Deliver at the stated size, matching `assets/source/style-reference.png`:
  hard stepped pixel edges, flat or two-step shading, a near-black `#0d0b1f`
  outline on every entity, no text in any sprite, soft alpha on edges only.
- Facings: draw `s`, `n` and `w`. **Never draw `e`**; the game mirrors `w`.
  Radially symmetric things (turret class, `vfx_`, `icon_`, `ui_`, `prop_`)
  get one facing.
- Centre every entity on its collision circle.
- **The magenta band (`#ff3fa4`) means exactly one thing: an enemy
  projectile in the air.** Nothing else may touch it. Enemy telegraph accents
  use the warm range around `#ff5544`.
- **Never scale on one axis.** Anything whose length varies at runtime (a
  rift, a tether, a beam) is delivered as a **tileable segment plus end
  caps**; the renderer repeats the segment.
- **Anything that moves apart from the body at runtime is never drawn into
  the body's frame.** Spikes that are driven out and then fly, a thrown
  weapon, a bell's ring, a shield bubble: the body frame shows the body
  only (at most the stub or socket the part comes out of), and the part is
  its own sprite that the renderer places, rotates, extends and releases. A
  part painted into the frame can neither grow out on the attack's clock nor
  leave the body when it is released.
- Icons are **16 × 16**, drawn for the crisp sheet and shown at 2×, like the
  delivered `icon_stat_*` and spell icons.
- Register every new frame in `packages/harness/src/assets/manifest.ts`
  (name, size class, `centred`, and `[w, h]` for 16 × 16 icons or non-square
  frames, following the existing entries), keep the draft next to its
  normalised source under `assets/source/`, then run:

```sh
pnpm assets:art      # packs, validates, decal-checks
pnpm assets:check    # must print OK
```

**Decision for thrown incendiaries** (the proposal's open question 6.2): a
thrown coal, flask or lobbed shot is a projectile while it is in the air, so it
is drawn **in the magenta band** like every other enemy bullet — a hot magenta
core with a darker magenta rim. What it leaves when it lands is the existing
`vfx_groundfire_*`, which is warm. The player learns one rule: magenta in the
air hurts; warm on the floor hurts if you stand in it.

Each row says whether the game **already asks for the frame** (it appears as
soon as it is in the atlas) or whether **the renderer is wired after
delivery** (the code does not look for it yet; that work follows the art).

---

## Delivered batches (A–D)

Everything below was delivered and has since been rebuilt as sprite models
(doc 016). It is kept as provenance for what each body was drawn to be; do
not draw from it again.

## Part A — owed art for the game as it is

### A0. Lava tiles — the one piece of floor that waits on art

| Frame(s) | Size | Count | What it is | Stands in today | Wiring |
|---|---|---|---|---|---|
| `tile_lava_{0..2}`, `tile_lava_edge_{n,e,s,w}_{0..2}`, `tile_lava_corner_{ne,es,sw,wn}_{0..2}` | 64 | 27 | A lava channel **one tile wide** sunk in the dungeon floor, drawn as `floors.png` is drawn — its outline weight, its light from the top left, its stone — so it belongs to that floor. The melt is a flat, bright orange with a few lighter flecks (not blobs, not crust plates); the bank is the floor's own stone breaking off into it, raggedly, deeper and lit on the north side (the face the three-quarter view sees), with the melt a shade brighter along it. Three frames of a slow flow along the channel; the centre tiles must tile left to right and loop in time. Edges and corners are for a channel's ends and turns. References: the lava of *Enter the Gungeon* and of a Sokoban-like dungeon with a lava river (screenshots in the conversation). | Nothing: `lava_channel` is withheld from rooms (`UNDRAWN` in `rooms/features.ts`). Four code-drawn versions each read as a strip laid on the floor. | `groundEdges` and the lava tiles in `drawTiles` read these instead of the baked sheet; remove it from `UNDRAWN`. |

### A1. Enemies

| Frame(s) | Size | Count | What it is | Stands in today | Wiring |
|---|---|---|---|---|---|
| `enemy_lancer_{n,s,w}_{idle0,idle1,walk0,walk1,walk2,walk3,dormant,dormant1,hit0,hit1,windup,lunge}`, `enemy_lancer_death` | 64 | 37 | The rusher's elite form: taller, lean, gold where the rusher is bone. Same family silhouette as the rusher so it reads as "the rusher, grown up". Its attack drives eight spikes out, holds them, then fires them across the room. The body shows eight short gold stubs at the compass points (the sockets the spikes come out of); `windup` is the body curled with the stubs pulled in, `lunge` the body flexed open with the stubs raised. | The rusher sheet tinted gold and scaled 1.15× | after delivery |
| `enemy_lancer_burst` | 64 | 1 | The lancer braced open with eight exposed sockets and **no full spikes baked in**. The renderer overlays eight copies of `vfx_spike_gold`, extends them during the hold, then releases those same layers as projectiles. | Ordinary death frame | after delivery |
| `vfx_spike_bone`, `vfx_spike_gold` | 16 × 6 | 2 | **One spike**, pointing right, base at the left edge, tip at the right: a tapered shaft with a bright tip, bone (rusher) and gold (lancer). The renderer draws eight of them at the compass points, slides each out from its stub to the attack's reach and back (it translates the sprite along its angle; it is never stretched), and for the lancer releases them as the flying bullets. | A two-colour line per spike and a white dot at the tip | after delivery |
| `enemy_sentinel_{idle0,idle1,dormant,dormant1,hit0,hit1,tele,tele1,death}` | 64 | 9 | A fixed green-grey emplacement with a circular pivot socket. **Do not bake the barrel into the body:** it must rotate freely. One facing. | Turret sheet tinted green, barrel drawn as a rectangle every frame | after delivery |
| `weapon_enemy_sentinel_barrel` | 64 | 1 | The sentinel's long barrel pointing right, with its rotation pivot near the left end. It is rendered over the body and rotates continuously toward its sight line. | Rectangle drawn in code | after delivery |
| `shadow_lancer`, `shadow_sentinel` | 64 | 2 | Their floor shadows, as the other seven `shadow_*`. | Borrowed from rusher / turret | after delivery |
| `shadow_boss_p1` | 256 | 1 | The boss's floor shadow (one serves all three phases). | A small procedural ellipse under a 256 px body | asked for already |
| `boss_p{1,2,3}_{windup,commit,hit0,hit1,leap,slam}` | 256 | 18 | Attack poses per phase: arm raised (windup), blow landing (commit), two hit reactions, crouched to leap, fists into the floor (slam). The crowned construct sheds armour plates phase by phase, as the delivered `idle`/`tele` frames do. | Slam reuses `tele`; the leap **hides the sprite** and draws an ellipse | after delivery |
| `weapon_enemy_tank` | 64 | 1 | The tank's greatsword: broad, chipped, held two-handed; drawn pointing right from the grip like `weapon_player_sword` (grip near the left edge). | Three strokes and a crossguard line | after delivery |
| `enemy_rusher_{n,s,w}_{windup,lunge}` — **redraw** | 64 | 6 | The rusher's attack is now `bristle`: spikes driven out all round the body, not a forward thrust. **The spikes are `vfx_spike_bone`, drawn by the renderer over these frames, so draw none of them here.** The body carries short bone stubs where the spikes come out. `windup`: curled tight, stubs pressed flat; `lunge`: body braced and open, stubs raised, nothing longer than a stub. | The old thrust frames with eight spikes drawn in code | asked for already |

| `enemy_{warden,bellringer,snarecaster,delver,cinderling}_{n,s,w}_walk{0..5}` — **not needed** | 96 (warden), 64 | 0 | Walks, in-betweens and other new frames are poses of the body's sprite model (doc 016), composed in the repo from parts split once out of the standing figure. Ask for a new body only as one standing figure per facing, plus any key pose already designed; never for a cycle. | Composed from the model | — |
| `enemy_warden_{n,s,w}_{windup,lunge}` — **keep, and match** | 96 | 6 | The warden is a **gunner** now: its right arm is a blunderbuss (the delivered sheet drew it so). `windup` is the gun raised to load and `lunge` the gun levelled to fire, as delivered; the muzzle flash and the blast are drawn in code, so draw neither. The idle and walk frames must show the same gun arm and **no shield**. | — | — |

### A2. Spells, affixes, stats

| Frame | Size | What it is | Stands in today | Wiring |
|---|---|---|---|---|
| `icon_spirit_blades` | 16 | Three small lilac knives circling a point. **The melee style's starting spell** — seen on the style screen, cards and the action bar. | A stat icon, or the spell pedestal | asked for already |
| `icon_wildfire_field` | 16 | A patch of flame on the ground. | Spell pedestal | asked for already |
| `icon_stone_ward` | 16 | A standing stone slab with a rune. | Spell pedestal | asked for already |
| `icon_blink_strike` | 16 | A figure-streak with a blade at its head (dash-through). | Spell pedestal | asked for already |
| `icon_void_maw` | 16 | A purple vortex, drawing inward. | Spell pedestal | asked for already |
| `icon_spirit_ally` | 16 | A small green spirit companion. | Spell pedestal | asked for already |
| `icon_affix_resonance` | 16 | A blade with a ring round it — "every Nth sword hit casts the spell". Same family as the twelve delivered affix icons. | Affix pedestal | asked for already |
| `icon_frost_nova` | 16 | A ring of ice shards bursting outward from a centre point. | Spell pedestal | asked for already |
| `icon_seeker_swarm` | 16 | Three small darts curving in toward one dot. | Spell pedestal | asked for already |
| `icon_fault_line` | 16 | A straight blade of stone breaking up through the floor in a line. | Spell pedestal | asked for already |
| `icon_affix_pierce` | 16 | A bolt passing clean through a small ring — "passes through bodies". Same family as the delivered affix icons. | Affix pedestal | asked for already |
| `icon_affix_seek` | 16 | A bolt on a curving path toward a dot — "bends toward bodies". | Affix pedestal | asked for already |
| `icon_affix_ricochet` | 16 | A bolt glancing off a wall edge at an angle — "bounces off walls". | Affix pedestal | asked for already |
| `icon_affix_kindle` | 16 | A bolt with a flame at its head, fire `#ffb050` — "sets bodies alight". | Affix pedestal | asked for already |
| `icon_affix_rime` | 16 | A bolt with a frost crystal at its head, ice `#9ad8ff` — "chills what it hits". | Affix pedestal | asked for already |
| `icon_affix_blight` | 16 | A bolt dripping green, poison `#9ff07a` — "poisons what it hits". | Affix pedestal | asked for already |
| `icon_affix_haste` | 16 | A cooldown ring with a notch jumping forward — "a kill brings the spell back sooner". | Affix pedestal | asked for already |
| `icon_stat_wrath` | 16 | Survival family: a banked spin — a blade circling, or a charge pip. | Pedestal | asked for already |
| `icon_stat_vigour` — **redraw** | 16 | A **red** heart, the HUD heart's `#b80202` with its highlights. The delivered one is blue (`#3434dc`), the mana colour, so the healing card reads as a mana card. | The 64 px HUD heart, forced by the renderer | asked for already |
| `prop_reward_stat_0` | 64 | The stat reward's pedestal, matching `prop_reward_{spell,affix,gold}_0`: an upward arrow / body sigil on the plinth. | Falls through to the affix pedestal | asked for already |

Projectiles are drawn in code now (`packages/game/src/scenes/projectiles.ts`),
the swing crescent, the magic blade, lightning and the impact rings too. **No
projectile or swing art is wanted.**

### A3. UI

| Frame(s) | Size | Count | What it is | Stands in today | Wiring |
|---|---|---|---|---|---|
| `icon_npc_merchant`, `icon_npc_smith` | 16 | 2 | Portal badges for the vendor rooms: a coin purse; an anvil. | The 64 px vendor sprite squeezed into 16 px | asked for already |
| `icon_action_attack`, `icon_action_spin`, `icon_action_dodge` | 16 | 3 | The three innate verbs on the action bar (J, L, K): a single slash; a blade in a circle; a figure with speed lines. | Two stat icons (attack and spin show the **same** picture) | after delivery |
| `icon_status_{burn,poison,chill,freeze,stun,stagger,alert}` | 16 | 7 | Status marks over heads: a flame; a green drop; a snowflake; an ice block; three stars; a cracked shield; an exclamation mark drawn as a shape, **not as a glyph** (no text in sprites). Warm/cool colours matching the damage numbers: fire `#ffb050`, poison `#9ff07a`, ice `#9ad8ff`. | Triangles, circles, stars and a `"!"` text object | after delivery |
| `ui_shield` | 16 | 1 | The armour mark at the left of an enemy's armour bar: a small heater shield in shield blue `#4f86ff`. | A code polygon | after delivery |

### A4. Map

The map is complete: 16 wall autotile cases, 8 floors, 11 decals, 9
destructibles with their states, the column (64 × 128, split by the renderer
into a footing and a top that goes see-through behind), portals, all six zone
features. **Nothing to draw.** (`tile_floor_4..7` are delivered but the
renderer only uses 0–3; that is a code fix, not art.) The new attacks below
add ground marks of their own (rifts, mines, the slow field, the burrow
mound), listed with them.

---

## Part B — elite attacks for the existing enemies (draw second)

Every elite today is a stat change. Each of these gives an elite of an
existing enemy **a different attack**, built on three new attack kinds —
`rift` (a ground line that erupts), `tether` (a taut line between two things)
and `lob` (an arc with a landing mark). Full behaviour, timings and
counterplay: `docs/research/enemy-expansion.md` §3 and §4.

### B1. The three attack kinds' marks

| Frames | Size | Count | What it is |
|---|---|---|---|
| `vfx_rift_seg_0..3` | 64 | 4 | **Tileable** ground-crack segment, growing across the four frames (telegraph → about to erupt). Warm `#ff5544` light in the crack, never magenta. |
| `vfx_rift_cap_0..1` | 64 | 2 | The rift's two ends, matching the segment. |
| `vfx_rift_burst_0..2` | 64 | 3 | The eruption along a segment: white-hot, on the active frames. |
| `vfx_tether_seg_0..1` | 64 | 2 | **Tileable** ward-tether segment: pale, steady, taut. |
| `vfx_tether_node_0..2` | 64 | 3 | The clasp at each end of a tether, pulsing — what says "both ends land on something" (the sentinel's sight line has one free end; a tether has none). |
| `vfx_ward_aura_0..2` | 64 | 3 | The ring on a warded enemy. Distinct from `vfx_ward_0..1`, which is the player's stone ward. |
| `vfx_lob_shadow_0..2` | 64 | 3 | The ground shadow under a thrown object, growing as it falls. |
| `vfx_lob_ring_0..1` | 64 | 2 | The landing reticle. |

**Drawn versus live**: every telegraph mark reads as *drawn* (dim, still) or
*live* (bright, moving) by **luminance and motion**, never by hue — the room
tint shifts hue by up to 14°.

### B2. The six elite variants

| Elite | New body frames | New VFX | Reuses |
|---|---|---|---|
| Shooter — **Pin Shot** (`lob`) | `enemy_shooter_{n,s,w}_lob` (3): barrel raised at an angle | `vfx_lob_shot_0..3` (4, 32 × 32, **magenta band**) | lob shadow, lob ring |
| Turret — **Rift Lance** (`rift`) | `enemy_turret_telegraph_rift` (1) | — | rift |
| Sentinel — **Sight Beam** (`tether`) | `enemy_sentinel_telegraph_beam` (1) | `vfx_beam_seg_0..3` (4, tileable), `vfx_beam_cap_0..1` (2) | tether node at the muzzle |
| Orbiter — **Seedwake** (`mine`) | — | — | mine marks, Part C |
| Tank — **Shock Cleave** (`rift`) | `enemy_tank_{n,s,w}_cleave_shock` (3): the chop landed, ground splitting under it | — | rift |
| Summoner — **Ward Tether** (`tether`) | `enemy_summoner_{n,s,w}_tether` (3): orb extended toward a minion | — | tether, ward aura |

The elite orbiter's mines are listed in Part C (`vfx_mine_*`); draw them with
this part if Part C is not yet scheduled.

---

## Part C — three new enemies (draw third)

Designs: `docs/research/enemy-expansion.md` §2.1–2.3. Every elite form has a
**different attack**, and its frames are in the second row of each.

| Archetype | Size | Facings | Poses | Frames |
|---|---|---|---|---|
| **Warden** — a shield-bearer: the body carries an arm socket; `weapon_enemy_warden_shield` supplies the tower plate | 96 | n, s, w | `idle0..1`, `walk0..3`, `dormant0..1`, `windup` (shield arm raised), `lunge` (shield arm thrust forward), `plant` (shield arm grounded), `hit0..1` per facing; `death` once. **No shield is baked into these body frames.** | 40 |
| Warden, elite — **Shield Throw** | 96 | n, s, w | `throw_windup` (empty shield arm drawn back), `throw_release`, `idle_bare0..1`; the renderer detaches `weapon_enemy_warden_shield` and changes to `vfx_plate_disc_*` in flight | 12 |
| **Bellringer** — support: a robed figure with a hand bell; arms allies with a ward tether | 64 | n, s, w | `idle0..1`, `walk0..3`, `dormant0..1`, `windup` (bell raised), `cast` (bell struck), `field` (bell rung downward), `burst` (bell cracking — alone, self-destructing), `hit0..1`; `death` once | 43 |
| Bellringer, elite — **Peal** | 64 | n, s, w | `peal_windup` (bell hauled fully back), `peal_release` | 6 |
| **Rifter** — a fixed stone totem that splits the ground in a line toward the player | 64 | one | `dormant`, `idle0..1`, `telegraph` (plates splitting, a warm core), `erupt`, `hit0..1`, `death` | 8 |
| Rifter, elite — **Fissure Walk** | 64 | one | `telegraph_walk` (the core splitting into four) | 1 |

| VFX | Size | Count | What it is |
|---|---|---|---|
| `weapon_enemy_warden_shield` | 64 × 96 | 1 | Upright tower shield with its arm pivot near the left edge; independently placed for guard, bash and throw. |
| `vfx_plate_spark_0..2` | 64 | 3 | A hit absorbed by the Warden's plate: sparks off steel. The only feedback that teaches the mechanic, so it has to be unmistakable. |
| `vfx_plate_disc_0..3` | 64 | 4 | The thrown plate spinning (radially symmetric). |
| `vfx_slowfield_0..3` | 64 | 4 | The Bellringer's slow field: cool, still, flat — deliberately unlike the moving warm `vfx_groundfire_*`. Does no damage. |
| `vfx_peal_ring_0..3` | 128 × 128 | 4 | The elite Bellringer's expanding wave; also its self-destruct ring. |
| `vfx_mine_seed_0..1` | 64 | 2 | An inert seed: a dim pip with a contracting ring. |
| `vfx_mine_armed_0..3` | 64 | 4 | The arming flicker and the live pulse. |
| `vfx_mine_burst_0..2` | 64 | 3 | The detonation. |

---

## Part D — four more enemies (draw last)

Designs: `docs/research/enemy-expansion.md` §2.4–2.7. Body sheets follow the
same pose grammar; exact pose lists are in §6.1 of that document.

| Archetype | Size | Body frames | Elite (different attack) | VFX |
|---|---|---|---|---|
| **Snarecaster** — throws a chain hook that drags the player; whips back after a miss | 64 | 40 | **Chain Mine** — anchors a live chain across the floor (`anchor_cast`, 3) | `vfx_chain_seg_0..1` (tileable), `vfx_chain_hook_0..1`, `vfx_chain_live_0..3` |
| **Delver** — burrows, travels as a mound, erupts under the player | 64 | 49 | **Breach Line** — three emerges in a row (reuses `emerge`) | `vfx_mound_0..3` (the only telegraph that moves), `vfx_emerge_ring_0..2` (earthen) |
| **Cinderling** — feeds on the player's fire: burning makes it faster | 64 | 43 (incl. `burning0..1`: brighter, faster, *pleased*) | **Flare** — a full burn gauge detonates into a fire ring (`flare_windup`, 3) | `vfx_coal_0..3` (32 × 32, **magenta band**, see the decision above) |
| **Sower** — floats and plants delayed mines | 64 | 28 (it floats: `idle0..3` is its drift, no walk) | **Bloom** — a ring of eight seeds with two gaps (`bloom_cast`, 3) | uses `vfx_mine_*` from Part C |

---

## Delivered art the game no longer uses

Do not redraw these. They can stay in the sheet or be dropped; nothing reads
them.

- `bullet_player_{a,b,c}_{0,1}` — player shots are drawn in code.
- `icon_door_{combat,elite,treasure,shop,rest,boss}` — portals show the reward kind.
- `prop_chest_*`, `prop_mirror_*`, `prop_manawell_*`, `prop_restfire_*` — their rooms and features are gone.
- `prop_reward_{gold,spell,affix}_1`, `prop_shop_0/1`, `prop_portal_shut_1`, `prop_pillar_1`, `ui_heart_empty`.
- `enemy_tank_{n,s,w}_tele` — the tank has no ranged tell.
- `weapon_enemy_rusher` — drawn for the rusher's old thrust; no enemy thrusts any more.
- `weapon_enemy_warden_shield`, `enemy_warden_{n,s,w}_{plant,throw_windup,throw_release,idle_bare*}`, `vfx_plate_disc_*` — the warden carries no plate any more.

## Totals

| Part | Frames |
|---|---|
| A — owed art for the game as it is: A1 enemies 138, A2 icons 20, A3 UI 13 | 171 |
| B — elite attacks: the three kinds' marks 22, elite bodies 11, elite VFX 10 | 43 |
| C — Warden, Bellringer, Rifter with elites, their independent shield, and VFX (incl. mines) | 110 + 1 + 24 = 135 |
| D — Snarecaster, Delver, Cinderling, Sower with elites 169, and their VFX 19 | 188 |

Draw **Part A first**: it is what the game shows wrong today. Part B next:
it changes every elite room using silhouettes the player already knows, for a
tenth of the new-enemy art. Parts C and D add new enemies.
