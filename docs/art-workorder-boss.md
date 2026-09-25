# Art work order — the Crypt King (boss)

For whoever draws the boss. What it is and why is in
`docs/planning/020-the-crypt-king.md`; this is only what to deliver.

The current boss — a ring of stone plates round a gold core — is replaced
entirely. The new one is a new **identity**, so it goes to the image
generator as doc 016 allows: one standing figure per phase, split into a
model, plus the key poses the rig cannot reach. Nothing here reuses the old
boss art.

## B0. Rules

Everything in **E0** of `docs/art-workorder-codex.md` applies unchanged and is
not repeated here: parts separable, joints where the idle has them, hard alpha
(binarised at 128), the body's own near-black outline, light from the top
left, 1× pixel grid delivered at **4×**, magenta `#ff3fa4` reserved for enemy
projectiles, telegraph accents only in the warm range round `#ff5544`, enemy
value band. Read it first.

What is specific to this body:

- **Size.** Every cell is **256 × 256 art px, delivered at 1024 × 1024**, on
  transparency. One facing only — south, towards the camera — as the current
  boss.
- **Placement.** The figure's footprint (where the feet meet the floor) sits
  where the current boss's floor shadow `shadow_boss_p1` sits under it: centred
  horizontally, in the lower third. Keep a 6 px (1×) margin inside the cell on
  every side **in every pose**, sword and chains included. If a pose cannot fit,
  say so in the delivery notes rather than cropping.
- **Scale against the player.** The player is about 64 art px tall. The king
  stands about **3×** that (180–200 art px to the top of the crown), and the
  greatsword is about as long as the player is tall and half again.
- **Palette.** This body gets its own `palette.json` from its delivery, so
  there is no ramp to match — but draw from these materials and nothing else,
  so the split can find them:

  | material | used for | direction |
  |---|---|---|
  | outline | the ink | one near-black, a hair cooler than the roster's (e.g. `#040409`); used everywhere |
  | iron | armour, chains | cold blue-grey, 5–6 shades, sitting with the dungeon's stone blues — the room is blue stone, so the armour must separate from it by value, not hue |
  | bone | skull, hands, phase III frame | the roster's warm ivory, 4–5 shades |
  | cloth | the cape | deep royal violet or wine, 4 shades — **nowhere near** the magenta projectile band or the red telegraph range |
  | gold | crown, trim, sword hilt | 4–5 shades, warm |
  | heart | the core | gold-to-orange glow, 4 shades, the brightest thing on him — it is the weak point |
  | eye | eye sockets | a small cold cyan glow, 3 shades, as the roster's eyes |

- **Separable parts.** The model needs these as parts that do not touch by a
  continuous band of one shade (an outline or a one-shade step between them is
  enough): crown · head · cape · torso (with the core) · left arm · right arm ·
  **greatsword** (its own part, not fused to the hands) · legs/feet · **each
  chain** · and, on phases I and II, **each armour piece that comes off at the
  next phase** (see B2). The crown, the chains and the shedding armour are
  *detached* parts in the rig (thrown or swung independently), like the
  current boss's plates.

## B1. Deliverables

Eight files. `n` is the phase, 1–3.

| File | Layout | Cells |
|---|---|---|
| `assets/source/originals/boss-king-p{n}.png` | 1 cell | the standing figure, idle neutral — the identity the model is split from |
| `assets/source/melee/boss-king-p{n}-keys.png` | 5 columns × 2 rows | the ten key poses in B3 |
| `assets/source/melee/boss-king-throne.png` | 2 columns × 1 row | phase I seated on the throne · the throne empty |
| `assets/source/melee/boss-king-death.png` | 3 columns × 1 row | phase III: kneeling on the sword · core guttering, head bowed · collapsed, crown fallen beside him |

Also deliver each file's un-quantised draft beside it as `…-draft.png`, as the
other batches do.

## B2. The three phases

Draw phase I first; phases II and III are phase I with things removed or
broken, and the proportions, joints and sword must stay the same across all
three so the rig carries over.

**Phase I — The King.** Full plate armour, dark and heavy, with a torn royal
cape hanging from the shoulders. A closed great-helm with the crown fixed on
it, straight. Two chains wrapped round the forearms, the loose ends hanging to
the knees. The greatsword held point-down in front of him, both hands on the
pommel. The core shows only as a thin glow between the seams of the
breastplate. Shedding parts to draw separately: **both pauldrons, the helm,
the two halves of the breastplate.**

**Phase II — The Broken Crown.** Pauldrons and helm gone: a bare skull with
cold eyes. The breastplate split down the middle and hanging open, the core
visible through the break and brighter. The complete skull must remain visible
under a level, centred crown. The chains torn loose from the forearms and trailing on the floor
from the wrists. The cape ragged. Shedding parts: **the two breastplate halves,
the cape.**

**Phase III — The Unbound Heart.** No armour. A tall skeletal frame, the rib
cage open round the core, which is fully exposed and blazing. The crown sits
directly on the complete skull, with no visible gap. **Three** chains trail from the
core itself. Still holding the greatsword. Thinner and taller-looking than
phase I — the same joints, less bulk.

## B3. Key poses

The rig moves parts; these are the poses it cannot reach because the
silhouette changes. Row-major in each `keys` sheet:

| # | Pose | What it must show | Feeds |
|---|---|---|---|
| 1 | `idle_low` | The bottom of a slow breath: shoulders down, head sunk, sword planted, core dim. | the breath across `idle0`–`idle3` |
| 2 | `idle_high` | The top of it: shoulders up and back, head raised, core bright. Must read as the same figure inhaling, not a different stance. | the same |
| 3 | `windup` | The greatsword raised two-handed over the right shoulder, body wound back against it, weight on the back foot. | every blade windup |
| 4 | `commit` | The cut landing: sword brought down and across to his left, low in front, body driven forward over the front foot. | every blade commit |
| 5 | `slam` | Kneeling on one knee, the sword driven point-down into the floor in front of him with both hands on the hilt. | slam, quake |
| 6 | `leap_gather` | A deep crouch, sword drawn back low behind him, about to spring. | the leap's gather |
| 7 | `leap_air` | In the air: knees tucked, sword raised straight over his head in both hands, cape flying up. Drawn in the cell like any other pose — the renderer lifts it. | the leap's arc |
| 8 | `throw` | The left arm flung out straight towards the camera, hand open, a chain leaving it; sword held back in the right. | the hook |
| 9 | `backhand` | The sword swept flat round to his right at waist height, pommel leading, body twisted after it. | the backhand |
| 10 | `hurt` | Recoiling: head thrown back, shoulders hunched, sword arm pulled in. | hit reactions |

In phase III the chains in `throw` leave from the core rather than the hand,
and in phases II–III they may swing free in any pose — draw them where they
would fall.

## B4. Acceptance

Measured by `pnpm sprite:amplitude` after the split (1 − IoU of the alpha
masks between the two poses):

| Pair | Floor |
|---|---|
| `idle_low` ↔ `idle_high` | ≥ 0.12 |
| `windup` ↔ `commit` | ≥ 0.40 |
| `leap_gather` ↔ `leap_air` | ≥ 0.40 |
| `idle_high` ↔ `slam` | ≥ 0.35 |

And:

- The split (`pnpm sprite:split boss_king_p{n}`) claims every part listed in
  B0 with nothing left over, on all three phases.
- No colour outside the materials in B0; no pixel with alpha other than 0 or
  255.
- Every pose inside the cell with the 6 px margin.
- The three phases overlay at the same scale: the hilt, the shoulders and the
  feet line up between `boss-king-p1.png`, `-p2` and `-p3`.

## B5. References

- Style: `assets/source/melee/player-actions.png` (the player), the rusher
  and lancer sheets in `assets/source/melee/`. Regenerate a contact sheet of
  any body with `pnpm sprite:preview <body> --facings s --zoom 3 --out <path>`.
- The room he stands in: blue stone floor and walls — see any arena preview
  (`pnpm arena:preview out.png shock 1 3`).
- The mood: an undead king in heavy black-iron plate, royal and ruined, a
  greatsword and chains, a burning heart — gothic, not grotesque. He should
  look like the thing the whole dungeon has been leading to.

## B6. Prompts for the image generator

One per identity figure; the key poses are drawn from the split figure, not
generated. Append the project's standard style line (top-down 3/4 view,
single sprite, transparent background, 1× pixel art with a near-black
outline, light from the top left).

- **Phase I:** *A towering undead king in heavy dark iron plate armour and a
  closed great-helm with a gold crown fixed on it, a torn deep-violet royal
  cape, two iron chains wrapped round his forearms with the ends hanging to
  his knees, holding a huge greatsword point-down in front of him with both
  hands on the pommel; a thin gold-orange glow between the seams of his
  breastplate. Facing the camera, standing still.*
- **Phase II:** *The same undead king with his pauldrons and helm torn away,
  a complete bare skull with small cold cyan eyes, the gold crown level on it,
  his breastplate split open down the middle showing a glowing gold-orange
  heart, iron chains torn loose and trailing from his wrists to the floor, a
  ragged violet cape, the same greatsword planted in front of him.*
- **Phase III:** *The same king with no armour left: a tall skeletal frame,
  the rib cage open round a blazing gold-orange heart, the gold crown resting
  directly on the complete skull, three iron chains trailing from the heart,
  still holding the same greatsword point-down in front of him.*

## B7. Review of the first delivery

The first delivery (`assets/source/melee/boss-king/`, the `boss-king-p{n}-{slash,cast}-draft.png`
boards and `normalize-boss-king.ts`) is **in the atlas and in the game**. The identity is right and
it reads as the finale: three phases told apart at a glance, the sword, the chains, the crown and
the burning heart all where B2 asks, about 3.5× the player on the blue floor. It passes
`pnpm assets:check`; every frame is on the body's 29 colours with hard alpha and the 6 px margin.

What it does not yet do, measured on the atlas frames with the B4 method (1 − IoU of alpha):

### Must fix

1. **The breath.** `idle0` ↔ `idle1`: phase I **0.013** (reads as a still image), phase II 0.179,
   phase III **0.579** — phase III alternates between two different stances, so the skeleton jumps
   on every idle frame. Draw `idle_low` / `idle_high` as B3 rows 1–2 ask: the *same* stance
   inhaling. Target 0.12–0.25 in every phase.
2. **The key poses the fight needs.** Several runtime frames are copies of others:
   - `slam` is `idle0` (0.000). It must be B3 row 5 — kneeling, the sword driven point-down into
     the floor. The slam and the quake both play on it, on the downbeat (doc 020).
   - `leap` is the `windup` frame. It needs B3 rows 6 and 7: the crouch and the airborne pose.
   - `hit0` / `hit1` are the two idles. They need B3 row 10, a recoil.
   - The hook (B3 row 8) and the backhand (row 9) are missing. The `tele` cast pose — an open hand
     with fire — is not a throw: the chain has to leave the hand.
3. **Windup to commit, phase I: 0.372** against the 0.40 floor (phase II sits exactly on it). Take
   the sword higher in the windup or lower and further across in the commit.
4. **The throne and the death sheets** (B1) are not delivered.

### Should fix

5. **Phase details from B2.** Keep the owner's approved crown treatment: level on the complete
   skull in phase II and seated directly on the skull in phase III. Do not reintroduce the earlier
   crooked or floating crown drafts. Phase III's chains should trail from the heart rather than
   the wrists.
6. **Heart against telegraphs.** The two lowest `heart` shades (`#7b230c`, `#bc3a0b`) sit close to
   the warm telegraph range round `#ff5544`. Keep the core's glow on the orange-to-gold side
   (hue ≥ 25°) so a glowing chest is never read as a warning.

### A decision for the owner, not for the artist

7. **Frames or a model.** The delivery bypasses doc 016: poses were generated as boards and
   resampled straight into runtime frames, so the sword, the chains and the armour are not parts.
   That costs what doc 020 builds on — the rig cannot breathe or swing them, the armour cannot be
   thrown off as parts at a phase change, and the slam's band cannot start from the blade's point.
   Either the boss becomes a model (deliver B1's identity figures with B0's separable parts, and
   the keys as poses of them), or it stays a frame set and doc 020's part-driven staging is dropped.
   **Decided: frames.** With the king's cuts aimed only to his sides, a drawn sword matches them;
   B8 is the order.

### Housekeeping

8. `art-review/` (34 MB of drafts and contact sheets) is at the repository root and is not
   ignored. Keep review material out of the repository, or under an ignored folder.

## B8. The king in frames

**2026-09-25 choreography correction:** B11 at the end of this order supersedes B8's
description of `greatcleave` as a sword planted in the floor and its reuse of `windup`
for `slam`/`quake`. Keep the two attacks visually and mechanically distinct.

**The model route is withdrawn; the king stays a frame set.** His blade cuts are now aimed only to
his sides (doc 020): the sweep, the slash, the backhand and the chain sweep are centred on the side
the player is on, and the cleave and the dashcut are thrown only at a player level with him. With
every cut going left or right, a sword drawn into the frame can match the hitbox exactly, and a
hand-drawn cut reads heavier than a sprite turned by code. The motion style is 大起大落: the game
snaps from one key pose to the next and holds it, with no in-betweens, so each frame must be the
extreme of its beat.

So: **every frame carries its sword**, as the delivered `p{n}/*.png` frames already do. The
sword-less model composites now in the atlas (`boss_p{n}_idle0` and the rest drawn without a sword,
plus `weapon_boss_sword`), the arm variants (`arm_0`–`arm_9`), the `model_*` keys and
`boss-king-fists.png` are not used. When the atlas packs the sworded frames, the game's
`BOSS_PLACED_SWORD` (`play.ts`) is set to `false` and the renderer stops placing a sword.

### Rules

B0 applies: one facing, south, **every cut drawn to his right** (the screen's; the game mirrors it
for the left), 256 × 256 art px cells delivered at 1024 × 1024 — **including the windup and leap
cells, which are delivered at 1344 × 1344 today and which the packer now refuses** — with the floor
line 91 art px below the cell's centre, the body's palette, hard alpha, the 6 px margin.

### What the fight plays, and what is still needed

| Move | Frames | Status |
|---|---|---|
| idle, walk | `idle0`–`idle3`, `walk0`–`walk5` | delivered |
| greatsweep / greatslash | `sweep_wind`, `sweep_cut`, `sweep_recover` | delivered |
| greatcleave | `windup`, `cleave_cut`, `cleave_hold` | **`cleave_cut` redrawn**: the sword brought down *to his right side*, tip on the floor at full reach to that side, body driven over the front foot — today it is planted straight down in front of him, which a cut along his side cannot be. **`cleave_hold` new**: the same stance a moment later, the sword still in the floor, shoulders heaving — held for the punish window. `cleave_stuck` (a kneel) is retired. |
| dashcut | `leap_gather`, `dash_cut`, `dash_skid` | **new**: `dash_cut` — running flat out to his right, sword thrust out ahead level with the floor; `dash_skid` — skidding to a stop, feet braced, sword dragged behind. |
| any cut's recovery | `recover` | **new**: half risen from a cut, the sword coming back to guard across the body — the second half of every recovery. |
| slam, quake, leap | `windup`, `slam`, `leap_gather`, `leap_air` | delivered |
| chain sweep | `chain_wind`, `chain_cast`, `chain_follow` | delivered |
| hook | `hook_wind`, `hook`, `hook_reel` | delivered |
| storm | `storm` | **new**: the greatsword held straight up over the head in both hands, blade vertical, feet planted wide — the raise already drawn (2026-09-25, not yet packed). Pack it as `boss_p{n}_storm` for all three phases, at `idle0`'s scale and centre line. The game holds it for the whole storm and draws the blue pulse round its outline itself; until it is packed, `windup` stands in. |
| heart volley | `tele`, `tele1` | delivered |
| hits, broken armour | `hit0`, `hit1`, `hurt`, `stagger0`, `stagger1` | delivered; `hit0` and `hit1` should differ (B7) |
| phase change, death, throne | `boss-king-unbind.png`, `boss-king-debris.png`, the death and throne sheets | delivered |

Fixes on the delivered frames: phase III `slam` has no cape (second pass). The three `idle1` frames
now share `idle0`'s exact alpha silhouette, feet, sword, crown and cape; only the chest and shoulder
interiors rise by one or two art pixels and the core brightens by one palette shade. The source and
atlas are ready for the game to restore the breath cycle (restored).

**The frames are not all at one scale.** Against `idle0`, the king is drawn larger in `tele`,
`tele1`, `hit0`, `hit1`, `chain_wind` and `chain_cast` — broader in the shoulders, a bigger helm —
and smaller and thinner in `windup`, so in play he swells when he is struck, when he casts and when
he winds the chain, and shrinks as he raises the sword. A pose may change his silhouette, not his
size: redraw those frames so the helm, the crown, the pauldrons and the boots are the size they are
in `idle0`, on the same floor line, in every phase.

Measured on the delivered sheet (the armour's pixel area against `idle0`'s, root taken; the cape and
the blade left out), the cut frames are the worst: `sweep_wind` 0.73–0.81, `cleave_raise`
0.65–0.69, `cleave_fall` 0.73–0.76, `dash_cut` 0.64–0.70, `dash_skid` 0.64–0.72, `recover`
0.79–0.82. The game draws any frame under 0.89 up to `idle0`'s size from its feet
(`bossFrameScale` in play.ts). That is a stopgap and turns itself off once the frames are drawn to
one scale.

**The body is not in one place across the frame.** In every phase the king's body stands at a
different x in each cut key: the crown is at 175 in `p2 sweep_cut` and at 73 in `p2 sweep_recover`,
and mirroring a cut for the stroke coming back doubles the jump. So in play the whole king leapt
from side to side through a string. Redraw every action frame with the body (the pelvis over the
midpoint between the feet) on the cell's centre line, x = 128, as `idle0` has it; only the sword,
the arms and the cape may reach off to one side. The game currently re-centres each frame on the
middle of its armour (`bossBodyShift`); keep that measure centred and the correction is zero.

**Pinholes.** The cut frames have holes punched through the body: single transparent pixels inside
the silhouette, 4–8 % of the body in `sweep_wind`, `sweep_enter`, `sweep_cross`, `sweep_mid`,
`sweep_reset`, `cleave_raise`, `cleave_hold`, `cleave_fall`, `cleave_cut`, `dash_cut`, `dash_skid`
and `recover`, in all three phases (the idle and walk frames are under 0.3 %). In play the floor
shows through and the king reads as half transparent. Fill every hole inside the outline with the
neighbouring colour; hard alpha means no transparent pixel with opaque pixels on three or four
sides of it.

**The sweeps' recovery keys are drawn for the wrong side.** The strike ends with the sword off to
the screen's left (`sweep_cut`, tip at x 19), and `sweep_recover` and `sweep_reset` then put it
low on the right (tips at 229 and 214), so the blade jumped across him as the cut ended; `recover`
then raised it high to the right. The game now mirrors both recovery keys against the cut
(`BOSS_BLADE_FRAMES`, keys marked `~`) and ends the sweeps on them without `recover`. Redraw
`sweep_recover` (the follow-through, low on the side the cut went to) and `sweep_reset` (standing,
the sword coming back to the middle) for that side, and the marks can go.

**Review of the 2026-09-25 09:51 delivery** (new `idle0`/`idle1` as the guard, `windup` redrawn,
the throne entrance, the goblet and the wine splash, all packed):

- The guard idle and the windup read well, and the scale is much closer: against the new `idle0`
  only `cleave_raise` (1.14–1.25), `dash_cut` (1.12–1.26), `dash_skid` (1.13–1.23) and phase III
  `sweep_wind` (1.13) are still drawn small.
- **The pinholes are in the sources, and they are the ink.** The 1024 px sources have no single-pixel
  holes, but the near-black outline between the plates is transparent: `p2/idle0.png` holds 464
  pixels of ink (`#08070d`) in the whole figure, and every seam between pauldron, gauntlet, greave
  and cuirass is alpha 0. Downscaled to the 256 px cell those seams become the holes (455 of them in
  `p2 idle0`; 1.7–7.5 % of the body across the cut frames, now the idle too), and the floor shows
  through every seam in play. The background removal took the ink with it. Only the ground outside
  the figure may be transparent: restore the outline and the seams as ink in every frame and phase
  (phase III's gaps between the bones are the one place the floor may show, and only where they are
  wider than the ink line).
- `idle_ceremonial.png` is in the sources but not packed; pack it as `boss_p{n}_ceremony0`/`1`.

**The wide cuts are in the game (2026-09-25).** The 336 px `sweep_front_*`, `sweep_back_*` and
`cleave_front_*` cells are packed into the atlas (`manifest.ts`, `art.ts`, with `wide/anchors.json`
merged into `bossAnchors` and its `pivot` kept), laid on their pivot so the feet stay on his floor
line, and played by `choreography.json`: a string's sweeps and slashes alternate front and return
cuts by which way each blow goes against the opening one, a cleave at a player before him is the
vertical finisher, and the whole string is mirrored or not together (`Enemy.bossComboFlip`), never
a flip per blow. Phase I, which has no strings, keeps the 256 px sweep keys. Still open: a combo
ends on `cleave_front_follow` with the sword low on his right, and his walk carries it low on his
left, so the blade changes sides as he walks off — a `cleave_front_settle` (the sword brought back
to his left hand, low) would close it.

**The fight's idle is the guard, not the planted sword.** `idle0`/`idle1` hold the sword planted
point-down before him with both hands on the pommel, which is a ceremony (the throne, the name
card), and between turns in the fight he stood in it like a sentry. Redraw `idle0`/`idle1` as the
guard of `recover` — the sword in hand across the body, the weight ready to move — breathing as B3
asks, and draw the planted pose as `ceremony0`/`ceremony1` for the entrance. The game measures every
frame's scale and centre against `idle0`, so the new idle is the reference: keep it at the size and
the centre line the current one has.

**The cleave at a player in front of him** is drawn from `windup` and `cleave_stuck` (the sword
planted before his feet). A dedicated front cleave — raised over the head facing the camera, the
blade coming straight down at the viewer, planted — would read better: `cleave_front_raise`,
`cleave_front_fall`, `cleave_front_cut`, one frame each per phase.

### Anchors

`assets/source/melee/boss-king-anchors.json`: for every frame of every phase, in art px of its
cell, `tip` (the sword's point) and `hand_l` (where a thrown chain leaves the hand; phase III: the
core). The crescents, the sword waves, the cleave's cracks and the chain start from these.

### Acceptance

- The atlas packs every frame above from the sworded sources; `pnpm assets:check` passes.
- In `?lab=boss`, each cut's drawn sword lies inside the ground telegraph it fills: the sweep's at
  full reach across the arc, the cleave's tip at the end of its line.
- B4's amplitude floors: `sweep_wind` ↔ `sweep_cut` ≥ 0.40, `windup` ↔ `cleave_cut` ≥ 0.40,
  `leap_gather` ↔ `dash_cut` ≥ 0.35.

## B10. The entrance, and the hall that breaks

### The entrance

The king is on his throne with a goblet of wine when the player comes in (doc 020, "Staging"). He
sees them, throws the goblet down — it breaks on the carpet before the dais — and stands; the fight
and its music start as he stands. The game plays it as held keys, snapping from one to the next
(大起大落), so each is the extreme of its beat. All are phase I, on the delivered throne, in the
throne's cell and placement (`boss-king-throne.png`), so they swap in for `throne_seated` exactly.

| Frame | What it must show |
|---|---|
| `throne_goblet` | Seated at ease, one leg forward, the goblet of dark red wine held loosely in his left hand at the armrest; the sword leaning against the throne at his right. |
| `throne_notice` | The same, the head raised and turned to the door (south), the goblet stopped halfway to him. |
| `throne_throw` | The left arm flung out and down to his left, hand open, the goblet just leaving it, wine spilling; the body already leaning forward. |
| `throne_rise` | Half risen, weight forward over his feet, right hand closing on the sword's grip; the goblet gone. The next frame the game shows is the standing king (`walk0`–`walk5`) on the dais, his boots where these frames have them (art y ≈ 210), walking down the steps to `ceremony0` at their foot. |
| `throne_sip` | **New.** `throne_goblet` itself with only the left forearm, the hand and the goblet moved: the cup raised to the helm's visor, tilted to drink. Every other pixel — the throne, the sword, the legs, the cape, the torso — identical to `throne_goblet`, so the two can loop while he waits. The delivered `goblet` and `notice` are two separate drawings of the whole figure (the sword, legs and cape all move between them), and looped they shook everything but the throne; the game holds `goblet` until this exists. |

Loose pieces, `assets/source/melee/boss-king-goblet.png`, 64 art px cells:

| Frame | What |
|---|---|
| `vfx_goblet_0`–`vfx_goblet_3` | The goblet spinning in flight, four turns of it, a trail of wine off it. |
| `deco_wine_splash` | Where it broke, on the floor: a spray of wine and a few shards of glass, flat, 2 × 1 cells. It stays for the fight, so it is dark (a deep wine red, well below the warm telegraph range round `#ff5544`) and low contrast against the violet carpet. |

### The columns and the candelabra

The four columns and the two candelabra in the throne hall are now **breakable** (the player's
sword chips a column in four blows, the king's in two; a candelabrum goes in one), and each stands
on one cell. Draw each in its three states, bottom-anchored in its cell as `throne-column.png` and
`throne-candelabra.png` are, delivered beside them in `assets/source/halls/`:

| File | Cells | What |
|---|---|---|
| `throne-column-cracked.png` | 1, 128 × 256 | The column split through, chunks gone from its edge, dust at its foot. |
| `throne-column-broken.png` | 1, 128 × 128 | What is left once it falls: the stump of its base and a heap of broken drums on the floor. Flat enough to read as floor, which it now is. |
| `throne-candelabra-cracked.png` | 1, 64 × 128 | Bent, one arm snapped, its candles guttering. |
| `throne-candelabra-broken.png` | 1, 64 × 64 | Lying on the floor, the candles out and spilled. |

Load them in `preloadHallArt` (`hall-art.ts`) as `hall_column_cracked`, `hall_column_broken`,
`hall_candelabrum_cracked` and `hall_candelabrum_broken`: the game's `drawHallProp` picks each up by
that key the moment it exists. Until they arrive it tints the whole drawing for cracked and puts a
rubble frame down for broken.

## B11. Front cleave, ground magic, and the phase II/III sword strings

This section records the latest art direction and overrides the earlier cleave/ground-strike
descriptions. The illustrated `windup` puts the blade horizontally behind the head, so it reads
like a golf swing when it precedes a ground plunge. The attempted overhead sketch held both fists
like a static vertical staff; that is not the hand path of a sword cut. Neither is an approved
new attack frame.

### Three distinct actions

| Action | Hand and blade path | Landing |
|---|---|---|
| `greatcleave` (the sword-string finisher) | Front-facing, two-handed Japanese kendo-style vertical cut. Hands travel in an arc from above the brow to forward of the chest; elbows, shoulders, torso and lead foot visibly follow through. Show the cutting edge toward the player. The blade retains its full apparent length. | The sword does **not** enter the floor. Its point passes in front of the king and the sword wave continues the cut. A static central grip with a blade pointing down is a ground spell, not this cut. |
| `slam` and `quake` | Still front-facing, lift the whole sword a short distance **in front of the body**, with the point down, then drive both hands and the point straight into the floor. Keep the broad back of the blade facing the player in lift, drive, and held impact; never turn a narrow cutting edge into the broad back between frames. This is a lift and plunge, not the overhead kendo windup. | Sword point is embedded in the floor; the ground spell starts at the sword-tip anchor. Distinguish slam from quake with code effects, not a different hand path. |
| Future lightning invocation | Keep the separate front-facing sword-aloft ritual drawing. | This is neither a cleave nor a ground plunge. CC will add the spell later. |

### Connected horizontal cuts in phases II and III

The phases' strings are `greatslash → greatslash → greatcleave` in II and
`greatslash → greatslash → greatslash → greatcleave` in III; a `greatsweep` opener can also
link into a light slash and then the cleave. Today `BOSS_BLADE_FRAMES` reuses the same
`sweep_wind`/`sweep_cut` for every light slash and mirrors the whole sprite for the return.
The body therefore rocks left and right even though the attack is supposed to travel across
the front, reverse across it, then finish with the vertical cut.

New illustrated keys needed in **both II and III**:

| Key | Silhouette and purpose |
|---|---|
| `sweep_back_wind` | After a right-to-left cut, the sword remains on the left; hips and shoulders coil for the return. Do not teleport it back to the right or swap the sword to the other hand. |
| `sweep_back_cross` | Two-handed return cut travels left-to-right across the chest; lead foot steps and the torso turns through the blow. This cannot be a full-body mirror of the first cut: keep crown, pelvis and feet at the same character scale and cell centre. |
| `sweep_back_cut` | Follow-through ends on the right with arms extended and cape/chain lagging, ready for the next beat or vertical finisher. |
| `cleave_front_raise` | Both hands travel above the brow with the **full-length** sword edge toward the player; knees load for a downward cut. It is not the sword-aloft lightning invocation. |
| `cleave_front_fall` | Mid-swing: hands descend in a visible arc, elbows extend, torso and front foot drive toward the player. The blade is in motion and still clear of the ground. |
| `cleave_front_cut` | End of the kendo-style cut; both hands project forward, blade passes in front of the body, point above the floor. Sword wave launches from the tip here. |
| `cleave_front_follow` | Overswing and heavy recovery; shoulders are low and exposed before returning to guard. |

For the first horizontal blow, existing `sweep_enter`/`sweep_cross`/`sweep_mid`/`sweep_cut`
can remain if their centre and scale are corrected. The return needs its own contact and
follow-through rather than another whole-body flip. The next forward blow starts from the
right-side finish. CC owns the gameplay timing and sequence mapping; the art delivery supplies
named attack keys for all three phases where relevant and `tip`/`hand_l` anchors in
`boss-king/wide/anchors.json`. Add separate `slam_lift` and `slam_drive` keys in all three phases.
Keep the boots on the same floor line, pelvis centred at x≈128, and sword grip consistent between
adjacent keys. Review the sequence as an animation, not as isolated stills.

**Cell-size constraint found during the redraw:** shrinking every pose to a 256 art px cell
recreates the in-game size pop. In the first 256 px review, the phase-II front-raise body was
0.84× the idle body and phase III was 0.80×; enlarging either to idle scale clips its raised
sword. The phase-II reverse-cut finish was 0.87×, because the extended full-length blade had to
fit across the cell. These are measured square-root armour-area ratios, using the same yardstick
as `bossFrameScale`. Do not approve those 256 px drafts as final. Use a larger attack canvas
(336 art px is sufficient for the observed bounds) at the **same art-pixel-to-world scale**, with
a per-frame body/feet pivot; do not scale the full 336 px canvas into the old 256 px draw size.
The atlas currently exposes only `s256` for the king, so this needs the packer and renderer to
accept the wider source and pivot before such frames can be shipped without a size jump. Keep
the present gameplay mappings until the corrected frames and pivots exist.

### 2026-09-25 art delivery for the combo correction

The corrected **336 art px / 1344 source px** frames are in
`assets/source/melee/boss-king/wide/p{phase}/`. Phase II and III each have
`sweep_front_{wind,enter,mid,cut}` and `sweep_back_{wind,cross,cut}`; all three
phases have `cleave_front_{raise,fall,cut,follow}`. The first cut uses the
existing drawing with its body re-centred and brought to the idle body scale;
the return cut and finisher are distinct drawings. The final kendo-style cut
leaves the tip above the floor, while `follow` exposes the king for the punish
window. Do not use the old 256 px review versions: they shrink his body.

`assets/source/melee/boss-king/wide/anchors.json` gives every wide frame's
source, sword-tip point, left-hand point and `[168,272]` foot pivot in 336 art
px. `assets/source/melee/boss-king/wide/choreography.json` gives the forward,
return and vertical-finisher frame order for each phase's `greatslash` and
`greatsweep` string. The slash directions alternate because **the sword travels
across the body and back**; do not flip the entire sprite on alternate hits.
Mirror the entire string consistently only when the fight faces its other side.

Separately, `slam_lift` and `slam_drive` are finished and packed in the regular
256 px boss frames for all three phases. They are the short front lift and
point-down ground plunge for both `slam` and `quake`, with tip and hand anchors
in the regular `boss-king-anchors.json`. The previously drawn sword-aloft
lightning pose is retained as `assets/source/melee/boss-king-lightning-p{phase}-draft.png`
for CC's future lightning spell; it is not packed as a ground-strike or cleave
frame. It still needs a dedicated canvas fit before gameplay use.

**2026-09-25 facing correction:** The three phases' `cleave_front_fall`,
`cleave_front_cut`, and `cleave_front_follow` have been redrawn and repacked
with the sword's narrow cutting edge on the front-facing centre line; the
formerly diagonal side-facing cuts are retired. The full raise → fall → cut →
follow sequence now reads as a two-handed vertical swing. The tip remains
above the foot pivot through contact and recovery, without planting in the
floor. All three phases' `slam_lift` and `slam_drive` have also been redrawn
and repacked with the broad blade back facing forward, matching the held
`slam` frame. Both anchor JSON files contain the revised sword-tip and hand
positions. The 336 px cells are now in the live atlas at the original art-pixel
scale, and the game selects the named cleave poses. CC owns the attack timing,
wave direction, and effect placement in gameplay.
