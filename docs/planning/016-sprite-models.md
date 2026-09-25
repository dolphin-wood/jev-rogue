---
id: 016
title: Sprite Models
status: accepted
date: 2026-09-23
summary: Every body in the game — the player, all sixteen enemy archetypes and the boss — is a sprite model rather than a set of generated sheets. A model is a palette of material ramps, a set of pixel parts per facing, each with a few drawn variants, and a table of poses that place those variants in whole pixels; the art pipeline composes the frames into the same atlas names the game already reads. Nothing is ever rotated or scaled, so every frame stays on the pixel grid. A new frame is a pose, a new motion is a variant, and only a new identity goes to the image generator, as a single standing figure, split once. A shared motion table turns each model's parts and weight into the roster's frames, so every body breathes, walks, gathers, follows through, recoils and sleeps on the same conventions. Defines the model files, the compositor, the text pixel format parts are drawn in, the motion table, the roster's value band, the lab and preview tools, and the checks.
depends_on: [008, 009]
---

# 016 Sprite Models

## The problem this replaces

Every character frame in the atlas is a painting. The sheets were generated,
normalised and downscaled, so a 64 px frame carries 800 to 2,500 colours and no
structure: nothing in it says where the arm is. That has three costs.

- **Any new frame is a new sheet.** An eighth walk frame, an in-between for the
  swing, a raised arm for a cast: each is a round trip to the image generator,
  and the generator redraws the whole figure, so a new frame drifts from the
  approved ones in proportion, trim and shading.
- **Frames cannot be edited by hand.** With a thousand colours there is no
  "the cloth's shadow colour" to paint with, so a one-pixel fix means sampling
  and guessing, and the guess shows.
- **Code-drawn motion guesses at anatomy.** `drawnWalk` finds the legs as "the
  band below 72% of the bounds" and the arms as "the outer thirds". That holds
  for some bodies and cuts through a hem or a gun on others, and each fix is a
  new special case.

A skeletal rig does not fix this: rotating pixel art resamples it, and the
result wobbles and seams (tried in the animation lab; see 008). What pixel
games do instead is draw each pose, and the way to draw poses without
redrawing the figure is to draw **parts** once and compose them.

## A model

A body's art is a model in `assets/models/<body>/`:

| File | Holds |
|---|---|
| `palette.json` | the body's material ramps: `outline`, and per material (cloth, trim, belt, gem, eye, …) up to six shades from shadow to light. At most 32 colours in all; the player has 25. |
| `<facing>.px` | the parts for one facing (`s`, `n`, `w`; `e` is `w` mirrored), each with its variants, drawn in the text pixel format below. |
| `rig.json` | per facing: the parts, their parent, the joint on the parent a part hangs from, their depth order, and the frame origin the roots hang from; the outline width, the feet, and the anchors the game reads. |
| `poses.json` | per facing, named poses: for each part, a variant and a whole-pixel offset from its joint, optionally a depth override. |
| `anims.json` | the frames the model delivers: each atlas frame name mapped to a pose. A cycle is a list of poses; its length is whatever the list is. |
| `motion.json` | what each part *is* — a body, a head, a foot, a limb, a fin — how heavy the body reads, how it gets about, and which drawings are its gather, its commit and its slump. The roster's shared motion table turns that into the poses and the frame list. |
| `split.json`, `maps/` | how the model was split from its delivered figures (below): the material rules, the rig, and one part map per source frame. |

The rig is the body's, not a fixed skeleton. Every body in the roster is a
model. The player has seven parts per
facing: `torso` and the two feet hang from the frame, and `head`, `hem` (the
robe's lower edge), `arm_sword` and `arm_cast` from joints on the torso. The feet are roots so that the body
can bob and lean over planted feet. The enemies are three shapes of rig.
A walking body — the tank, the warden, the summoner, the lancer — has
`torso`, `head`, two feet and two arms; a quadruped has `shell`, `head` and
two legs; a hovering body has a `core` and two fins, which for the orbiter
are its tentacles and for the shooter its blades. An emplacement has a `core`
and two pods and never moves from the spot. A drawing that is used once and
never moves in parts — the player's dash, the two frames of a recoil — is one
part, `figure`, holding the whole body.

Two kinds of part are marked in the rig rather than moved. **Feet** are the
parts that take the ground, and no pose may lift all of them at once.
**Detached** parts are the ones meant to float free of the body: the shooter's
cast shadow, the summoner's motes, the plates the boss sheds. They are the
only thing allowed to break the one-silhouette rule, and naming them is what
lets the rule stay strict for everything else.

Variants are drawings, not transforms: the player's parts have `stand`,
`windup` and `follow`, each drawn as the delivered sheet drew it, and the hem
has `sway_l` and `sway_r`, its lower rows a pixel over — cloth swinging from
the waist drawn the way pixel art draws it, by offsetting rows, not by
bending an image. An arm raised at a different angle is a different variant,
drawn at that angle.

A pose inherits another (`base`) and changes some parts, or is an
**in-between** (`between` two poses at `t`): every part at the rounded
interpolation of where its pivot sits in the two, drawn in the variant of the
nearer. The player's walk is eight poses of `stand`. **Everything moves, not
only the feet**: the feet step and the swinging one lifts; the body rises a
pixel as a foot passes and sinks one as it lands; the head follows the body a
frame late, so it settles after the body does; the hem swings after the
stepping leg (seen from the side, it is pulled back as each step reaches, and
the body leans into the walk); the arms swing against the legs, two pixels,
three from the side, lifting a little at each end of the swing. Its swing is
`swing_windup` and `swing_follow` — the delivered windup and follow drawings
pushed apart along the facing, since the sheet drew them nearly the same
body — with the in-between `strike` and the in-between `recover` back to
standing. The poses named for a source figure are left as the split made
them, so the round trip always checks the drawing and not the performance;
a cast raises the off hand, where the mana flame burns. A pose can also carry
per-frame values the game reads with the anchors (`bladeAngleDeg`).

## The roster's motion

Sixteen archetypes posed one at a time drift: one gets a six-frame walk and
another four, one leans into its windup and another does not, and the roster
stops reading as one family. So the poses are not written per body. A model's
`motion.json` says what each part is and how heavy the body reads, and
`motion.ts` builds the set from one shared table
(`pnpm sprite:motion <body>` writes it into `poses.json` and `anims.json`,
leaving every pose it did not generate alone):

| Frames | What they are |
|---|---|
| `idle0`–`idle3` | The breath, awake and on guard. The body rises off its rest and settles back **through** it, and the head follows a frame late. Rounding a sine rather than lifting and returning is what makes four frames out of one pixel of movement: up, back, down, back is four drawings, whereas up and back is two. |
| `watch0`–`watch3` | Looking about, before the player has been seen. A different motion, not the same one slowed: the weight shifts from foot to foot and the head goes further than the body, because unaware and on guard are the difference between safe and not and the player reads them at a glance. |
| `walk0`–`walk7` (six for a heavy body) | The gait. The feet step along the facing and the swing foot lifts as it passes under the body; the body rises as a foot passes and, if it is heavy, sinks as one lands; the head follows a frame late; the arms swing against the legs. A hovering body has no contact to time against, so its body rises and falls and its fins beat across it. |
| `windup` | The gather: the drawn crouch where the sheets left one, pulled further back than the drawing sits, because the delivered windups were drawn as a stance rather than as a move. |
| `lunge`, `follow`, `recover` | The commit, the frame it carries past the commit, and the way back. The follow-through is the frame the delivered sheets never had and the one that sells the weight; the recovery is an in-between, so the whole move reads as one arc instead of a pose held for two thirds of a second. |
| `hit0`, `hit1` | The recoil. The one place in the set where a frame may jump: a hit that eases is a hit the player misses. |
| `dormant0`–`dormant3` | Asleep, and breathing. A four-frame settle around the drawn slump, run at half the idle clock. A dormant body used to be one drawing, so a sleeping room was a room of statues. |
| `stir` | Noticing: the head up and nothing else moved yet. One drawing, held, because a cycle would blur it back into idling. |

Only two numbers differ between a rusher and a tank — how far a limb travels
and how long the body takes to change its mind — so those are the two a body
gives (`TIMING`, by weight), and everything else is shared. Offsets are read
against a part's parent and every limb hangs from the body, so a whole-figure
move is the body's offset alone and a limb that should hold still while the
body bobs is given the bob back.

A pose never rotates or scales anything. It chooses variants and moves them in
whole pixels, and that is all it can do. That is the property that keeps a
composed frame indistinguishable from a drawn one.

## Composing a frame

The compositor (`packages/harness/src/assets/models.ts`) turns a pose into a
frame:

1. Place the roots (the parts that hang from the frame) at the rig's origin,
   then each part so that its pivot lands on its parent's joint, plus the
   pose's offset. Joints are variant-specific: `torso.windup` carries its
   shoulders where the windup drew them, so everything hanging from it
   follows without every pose restating it.
2. Paint parts back to front in depth order.
3. **Outline the composite, not the parts.** Parts are stored without their
   outer outline; their internal lines, where one part lies over another, are
   drawn in the part. The outline is traced around the finished silhouette,
   two art pixels wide as the delivered ink is (the art is at twice world
   resolution): a first ring touching the body at sides or corners, a second
   touching the first at sides only, which rounds its corners as the ink is
   rounded. This is what closes the seams a moved part opens: no part has an
   edge of its own for a gap to show against.
4. Take the anchors from the joints. The game's per-frame anchors (the
   sword's `grip`, the `offhand` the mana flame burns at) are joints on the
   parts that carry them, so they follow every pose without a table.
5. Write the frame into the atlas under its `anims.json` name.

### A part the renderer places

Not everything a body holds belongs in its frames. The player's staff points
wherever the cut points, and a cut is a continuous angle, so a drawn key can
only ever be near it: five keys per facing gave a staff held upside down with
its crystal at the floor. It is therefore **absent from every pose** and cut
out once by `partFrame` — the same drawing, alone in a frame with its grip at
the centre — for the renderer to place and turn.

Placing it takes three things the drawing cannot say, so each is a number in
`anims.json`'s per-facing `meta` (or a pose's own `meta`, which wins), carried
into every frame's anchors beside the joints:

| | |
|---|---|
| `staffAngleDeg` | the way this pose holds it, so the idle keeps the look the drawing had. The cut overrides it while one is running. |
| `staffGripPx` | grip to crystal along the shaft, in art pixels. It is per facing because the back view grips five pixels higher, and a single constant floated its crystal off the head. |
| `staffDepth` | positive paints it over the body, negative behind. |

The **grip** is an ordinary joint, `hand`, on whichever part carries the fist;
a one-off figure that has no arm to carry it (a dash, a hurt) falls back to
`grip`. Over the shaft goes a **fist overlay**: one small drawing of the
closed hand, cut with no traced outline because it already carries its own
ink, painted at the grip so the hand wraps the shaft at any angle. One
drawing serves every key and facing — a fist does not change shape with the
pose behind it.

The light is in the parts' shades, as the delivered figure lit them. A part
moved a pixel or two keeps its own light, which at these offsets reads right.

Frame names are unchanged (`player_s_walk3`, `enemy_warden_w_windup`), so the
game reads composed frames exactly as it reads delivered ones, and the
manifest is read **from** the models rather than kept beside them: a body
gains a pose by gaining one in its `anims.json`, and the atlas follows.
Nothing is lost by a rename, because a model still delivers every name the
sheets did — `dormant` is the first frame of the sleep, and a body that never
gained a `follow` keeps the `lunge` it had. and a composed
frame is placed in its frame by the rig, not recentred. The renderer reads
each cycle's length from the atlas rather than assuming it: the player's walk
advances one cycle per 68 px travelled however many frames the cycle has.

## Drawing parts: the `.px` format

Parts are drawn as text, one character per pixel, so that they can be written,
reviewed and diffed like code, and drawn by the agent as well as by a person:

```
legend outline:k eye:abc gem:def belt:ghij cloth:lmnpqr trim:stuvw umber:xyz

part arm_sword.fist pivot 6,6
joint grip 6,6
......kk
....kkkkkk
...kkkxxxkkk
..kkkswwvykk
..kkswwwwvyk
```

- A letter is a material shade from the `legend`, darkest first; `.` is
  transparent. The letters are handed out from the palette, so the same
  letter means the same colour in every file of a body, and `k` is always the
  outline.
- `pivot x,y` is the pixel that sits on the parent's joint; a part that
  carries joints declares them as `joint name x,y`.
- The format has no alpha. Soft edges are not part of the style (008).

Two helpers make new variants quick to draw without leaving the palette:

- **Shape fill**: `pnpm sprite:draw <body>` draws the variants listed in the
  model's `shapes.json` from strokes — capsules for a sleeve or a staff's
  shaft, discs for a fist or a crystal — each in a material's shades, banded
  by which side of it faces the light from the top left. The output replaces
  that variant in the `.px` file and is touched up there like any other
  part; the strokes are how it was started. The player's sword arm in each
  pose of the cut is drawn this way: code draws new parts of an existing
  figure, and a new figure is the only thing that goes to the image
  generator. (The staff is **not** drawn per angle — see *A part the renderer
  places* below.)
- **Cut from a frame**: `pnpm sprite:cut <body> <frame> <rect> <part.variant>`
  quantises a region of any delivered frame to the model's palette and prints
  it as a `.px` block, so an existing drawing becomes a variant rather than
  being drawn again.

## Making a model from a delivered figure

A body starts as approved figures per facing — a standing one, and any key
poses already drawn — from the image generator or an existing sheet.
`pnpm sprite:split <body>` turns them into a model once. It reads each figure
as the delivered sheets make it, never from the atlas, which by then holds the
model's own frames:

0. **Claim each part a region**, as fractions of the figure's own bounds
   (`claimsFrac`), so one table serves every facing and every variant: a
   figure's parts sit in the same proportion of its silhouette however it is
   drawn. The joints are read the same way.
1. **Quantise** the figure to the body's palette. The palette is found by
   clustering the figure's colours per material and keeping the ramp's
   distinct shades, and is then fixed by hand; from here on it is the only
   source of colour for that body. **Accents are declared before clustering**:
   an eye, a gem, a glyph is its own material with its own shades, because a
   dozen pixels of yellow lose every vote to a thousand of cloth. Measured on
   the player, clustering without that kept the figure at 24 colours and lost
   the eyes; the warden, with no small accent, held at 16.
2. **Make a part map**: every opaque pixel is assigned to a part, in
   `maps/<frame>.map`, a text grid with one letter per part. The split
   proposes one from rough rectangles each part claims and writes it for
   correcting by hand; from then on it reads the map. The map is the only
   judgement in the whole process.
3. **Complete the hidden pixels.** Where a part in front covered another
   (the torso behind the sword arm), the split fills the part from its own
   nearest colours of its body material (the torso's cloth, not its belt or
   trim, which drew streaks where an arm swung away), out to a radius
   (`fillRadius`) or inside an outline drawn for that part. Only pixels the
   figure had and a nearer part owned are filled: a gap in the figure stays a
   gap, and a part behind is never painted over. **Which part is in front
   matters more than it looks**: a robe's hem drawn behind its torso opens a
   black seam across the body the moment it swings, because nothing was
   completed under it. The hem goes in front of the torso and the torso is
   completed behind it.
4. **Strip the outer outline**: the ink touching the outside, two rings, the
   inverse of the compositor's trace. Ink at a part's edge that lies over
   another part's completion is kept in the part: it is that part's line
   against the one behind, and must move with it.
5. Write the `.px` files, the rig, and a pose per source figure (named for its
   variant) that composes back to it. Splitting again rewrites only the
   split's own drawings: a variant drawn since stays as it was drawn.

The palette a body ends up with is already inside the roster's **value band**
(below), because the figures it is split from are: the band is applied where a
delivered frame is made, so a model inherits it and is never put through it
again. A body that still needs a nudge of its own has `lift`, a multiply over
every ramp but the outline; the figure is then *matched* against the palette
with the lift taken back out, since nearest-shade matching only cares about
order and would otherwise send every pixel one shade darker and undo it.

The split is accepted when each source's pose reproduces its quantised figure
to within the outline. On the player every colour matches, and the silhouette
differs by 1 to 6% where the delivered ink wavered between one and two
pixels. After that the delivered figure is provenance; the model is the
source.

## The value band

Every body in the roster shares one value curve, applied in HSL where a
delivered frame is made (`enemyValueBand` in `art.ts`):

    L' = 0.84 * L ** 1.3,   chroma held, never raised

The exponent pulls the mass down — a mid tone at 0.5 lands near 0.36 — while
leaving the top of the ramp near the top, so highlights still read as
highlights; the cap holds even a pure white below the white of pickups,
effects and the HUD, which are the things that are *meant* to be the brightest
pixels on the screen. Chroma rather than saturation is what is carried down,
because saturation in HSL is measured against the room the lightness leaves:
a cream trim is half saturated at a lightness of 0.92, where it reads as
white, and held at that saturation and dropped it reads as **tan**. The clamp
keeps the rule one-way, so a mid tone that gains room in the shadows does not
come out louder than it was drawn. The protected enemy-bullet hue is skipped,
as everywhere else.

**This replaced a multiply per body.** The floor sits at a mean luminance of
about 83, the readability rule asked a body to stay twelve points off it, and
the cheapest way to satisfy that is upward — so the roster was scaled by 1.34
to 1.64 and came out at 104 to 122, with a fifth of its pixels at pure white.
A bright room's mood lifts everything another 14% on top. The result was a
roster of pale blobs that glowed: brighter than the floor they stood on,
brighter than the player, the same value as a pickup. After the band every
body sits between 24 and 64, against the player at 57 and the floor at 83, and
**0.01% of enemy pixels reach a lightness of 0.9 in the brightest room**,
against 6% of the player's and 13% of the effects'.

Twelve points off the floor was the right rule and up was the wrong direction,
so the rule itself changed with it (`enemy-floor-contrast` in `check.ts`). A
mean has no structure: a body of black ink and white plate averages to exactly
the floor and scores zero, while a uniformly pale one scores well. What makes
a body readable is that **most of its pixels** differ from the floor, in value
or in hue — its outline counts, because two rings of near-black ink against
grey stone is separation; its accents count, because a cyan eye on a blue-grey
floor is separation at the same value. So the rule is a share (55% of a body's
pixels, at 12 points of luminance or 40 degrees of hue), a body may be darker
than the floor as readily as lighter, and it is judged **as the moods tint
it**: a dim room shrinks every gap by a seventh and a bright one clips the top
of the ramp toward the floor's own rise, so a body has to hold up in the worst
of them rather than in the untinted sheet nobody ever sees. The boss is banded
in value with the rest of the roster but not held to the rule: it fills a
quarter of the room and cannot be lost in the stone.

## Amplitude

Frames are easy to add and easy to mistake for animation. The roster's first
pass gave every body twenty to thirty of them and still read as stiff, because
the poses moved a foot **two pixels** on a thirty-two pixel body: measured,
4% of the silhouette changed per frame and 10% between a cycle's extremes.

So amplitude is measured (`amplitude.ts`) and held to a floor
(`amplitude.test.ts`, in `pnpm verify`; `pnpm sprite:amplitude` prints the
table). Per cycle: the mean silhouette change between consecutive frames and
between the two most different frames, as 1 − IoU of the alpha masks, and how
far each part's pivot travels in art pixels. The masks are alpha, so a pair
that differs only in colour — a telegraph lighting, a flame flickering on a
still body — measures as nothing and is not held to the floor; only the
cycles a rig poses are.

| | before | after |
|---|---|---|
| foot travel in a walk | 4 px | 12–14 px |
| walk extremes, 1 − IoU | 0.10–0.14 | 0.17–0.38 |
| gather against commit | 0.24–0.46 | 0.34–0.66 |
| player walk extremes | 0.23 | 0.31 |

Two rules moved with it. `MAX_OFFSET` was 6 px, which is less than a leg's
travel in a walk that reads, so it was capping the animation rather than
catching a mistake; it is 10, and still catches a hand sent a third of a body
from its arm. `MAX_POP` was 0.14, which a cycle with a real stride passes
through at every contact; it is 0.32, and still catches a frame that
teleports. The two floors and the two ceilings together say what a cycle has
to look like.

**A step is foreshortened head-on.** The side view shows a stride at its full
length; the front and back views show the same stride pointing at the camera,
which on a flat sprite is a few pixels down the screen. Given the side view's
travel, the back foot leaves the body and reads as a boot lying on the floor,
so those facings take 60% of it — and, because the eye then has no stride to
read, half again as much bob.

## Tools

- **`pnpm sprite:preview <body>`** writes a contact sheet: every frame of the
  model at 4×, a row per facing; with `--parts` the part map beside each, and
  with `--against` the delivered frame it replaces and a difference image. It
  is the review loop, for a person and for the agent reading the image, the
  way `pnpm fx:preview` is for effects.
- **The animation lab** (`packages/game/anim-lab.html`) plays the atlas's
  frames as the game would, a cycle per move, and gains the model kind:
  choose a body, facing and pose; switch any part's variant and nudge it a
  pixel at a time; step or play a cycle at game speed with the previous and
  next frames ghosted; paint the part map. It writes nothing to disk: an
  edited pose is copied out as JSON and pasted into `poses.json`.
- **`pnpm sprite:motion <body>`** writes the shared motion set into the
  model's `poses.json` and `anims.json`, as above.
- **`pnpm sprite:cut`** and **`pnpm sprite:split`** as above.

## Checks

`models.test.ts`, run with the rest of `pnpm verify`, for every model:

- **Manifest.** Every frame the model delivers is one the manifest lists.
- **Reach.** No pose moves a part more than six pixels off its joint (a hand
  two pixels from its arm is a pose error, not a style).
- **One silhouette.** A composed frame is one connected shape, with no stray
  fragment, except parts the rig marks as detached.
- **A foot down.** No pose lifts every one of the rig's `feet` at once.
- **Distinct frames.** In a cycle of three or more, no two consecutive frames
  are the same drawing, and none changes more than 14% of the silhouette from
  the one before, which catches a pose that pops.
- **Anchors.** Every frame gives the game every anchor the rig names.

Every colour of a composed frame is in the body's palette by construction:
parts can only name palette shades. The round trip is reported by the split.

## What goes to the image generator

Only what has no model yet:

- **A new body**: one standing figure per facing, at the delivery size, on
  the style reference. It is split into a model and never asked for again.
- **A variant that cannot be drawn well by hand**, when that happens: asked
  for as that one part, at its size, on the body's palette and part grid,
  beside the part it replaces.

Frames, cycles, in-betweens and new poses are not generator work. They are
poses and variants, drawn in the repo.

## What is not a model

- **Effects** stay baked in code (`fx/sheets.ts`) or drawn live, as 008 sets
  out. They have no anatomy to compose.
- **Tiles, props, icons and pickups** stay single drawings. They are packed as
  now and quantised to the room palettes' ramps when they are next touched.
- **A one-off drawing that a body takes and does not animate in** — a death, a
  burst, a shattering prop — stays a delivered frame. It has one pose, so a
  model would only add a round trip to it.

The boss *is* a model like any other, with the plates it sheds as detached
parts, so a phase is a part removed rather than a sheet per phase. It is drawn
at 256 px, so it delivers only the frames it is ever asked for (`deliver`):
fifty frames of atlas for poses a boss never takes is a texture nobody can
afford. The atlas is packed 4096 wide for the same reason — the roster's
models took it past 4300 rows at 2048, and 4096 is the largest texture a
WebGL implementation is obliged to support in either direction.
