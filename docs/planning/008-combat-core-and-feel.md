---
id: 008
title: Combat Core and Game Feel
status: proposed
date: 2026-09-21
summary: Controls, player stats, circle collision layers, damage and invulnerability, and a feedback checklist that gives bullet-hell feel without animation frames — hitstop as a frame budget, camera shake as a single trauma accumulator, and sound. Room mood (temperature, brightness, particle intensity) is chosen by Jev per room and derived into a palette by code under contrast rules that protect the enemy-bullet hue. All simulation runs in core at a fixed 60 Hz step; Phaser only renders and reads input.
depends_on: [001, 005, 006, 009]
---

# 008 Combat Core and Game Feel

## Simulation ownership

Movement, collision, bullets, damage, elements, encounter waves and the spell cast loop all run in `packages/core` at a fixed 60 Hz step with integer-millisecond time. Phaser draws the state and forwards input; it never mutates simulation state. This is what makes the balance harness (011) and the spell simulator (006) identical to the game rather than approximations of it.

## Controls

- Move: WASD or arrows, 8 directions, normalized.
- Aim: **there is none.** Facing comes from movement and snaps to four
  directions, and it keeps updating during a swing — freezing it made the next
  hit come out in the old direction. A spell fires along the facing. Removing
  the mouse's job is the point: a player cannot retreat and attack at the same
  time, so every attack is a commitment to a direction. A keyed spell is
  allowed to *seek* a body within 52 degrees of the facing and curve in over
  its flight, because the three keys are pressed while the left hand is
  steering and the facing is wherever the last step left it.
- Attack: J or left mouse. Free, always available, and the mana supply. A held
  key queues the next swing, which is exactly right for a basic attack.
- Cast: **U, I and O**, one key per spell. There is no cycle: a cast is one
  decision, one key. A held key casts again when the spell's cooldown clears,
  sized to its cost, rather than asking the player's hand to drum a rhythm the
  game can keep for them.
- Spin attack: L. Spends one banked rage charge, so it is read as a press and
  never as a hold — a finger resting on the key must not empty the gauge.
- Dodge: K, space, shift or right mouse. A committed burst in the direction
  already held: 110 ms at 580 px/s, about two tiles, then 420 ms of cooldown.
  It commits to the direction it started in so it is a decision rather than a
  steering aid, and it is cut short of crossing the arena because a dodge
  should clear an attack, not relocate the fight.

  **The invulnerability outlasts the dodge** — 110 ms of travel plus 90 ms of
  grace, and it passes through bodies and projectiles alike. The thing being
  dodged takes time to pass through where the player was, so a window that
  ends with the travel means dashing *into* the gap and taking the hit on the
  last frames, and a dodge the player cannot trust is not a dodge. 200 ms of
  cover against a 420 ms cooldown clears an attack without being a way to live
  in the middle of a volley. Where the pressure belongs instead is in the
  patterns, which are cut accordingly (005).

- Interact: E. Takes a portal, a reward, a vendor or a dropped spell — an
  edge, not a hold, because each of those is a decision that must cost one
  press rather than one frame.
- Character screen: Tab. Esc pauses; M mutes; X dismantles a spell card.

## Player

| Stat | Value |
|---|---|
| speed | **120 px/s** |
| radius | 7 px, well inside the sprite |
| HP | 6 hearts |
| invulnerability after hit | **0.95 s**, sprite blinks |
| knockback on hit | three quarters of walking speed for 180 ms, away from what hit them |
| contact with enemy | **nothing** |

**The figure to hold is not the speed, it is the ratio.** The fastest body in
the roster runs at under 88% of the player. That relationship is what decides
whether a fight is a fight or a chase, and it is held by keeping the player
slow rather than by speeding the enemies up: a roster fast enough to match a
240 px/s player is a roster whose attacks the player cannot read. At 120 a
crossing of the room is about six seconds, the dodge is five times walking
pace rather than two and a half, and a step is a decision rather than a
correction.

**Contact damage does not exist.** An enemy hurts the player with a
telegraphed attack that has a facing and a window, never by touching them.
Contact damage has neither direction nor timing, so it charges the player for
being in a place rather than for misreading a move — and with a design that
requires closing, it charges them for playing correctly. Bodies still collide
and push; they just do not bill for it.

The long invulnerability is the other half of that. Damage arrives in discrete
readable hits, six hearts is not many for a design that requires crossing fire
to do anything at all, and at 0.6 s a second attacker could take a heart
before the player had moved. The knockback is Zelda's answer to the same
problem from the other side: invulnerability alone leaves the player exactly
where they were hit, so the moment it lapses the same stream takes the next
heart. Being moved is what turns a hit into an event with a recovery. A
lightning strike also stuns, for 620 ms, which is always shorter than the
invulnerability it arrives with.

## Collision

Circles only. Layers:

| A | B | Result |
|---|---|---|
| player bullet | enemy | damage, apply element, consume unless pierce or bounce remain |
| player bullet | wall | destroyed, or bounce if remaining |
| player bullet | brazier / other solid prop | destroyed, damaging a breakable one |
| enemy bullet | player | if vulnerable, by the body that fired it: 0.6 heart from a shooter, turret or the boss, 0.7 from a sentinel, 0.5 from an orbiter, 0.4 from a lancer's flying spike. An emplacement's point-blank pulse costs whatever that emplacement's bullets cost |
| enemy blade | player | if vulnerable: 0.7 heart from the rusher's spikes, 0.8 from the lancer's longer spikes, 1.0 from a slash, 1.5 from a charge, 1.6 from the tank's overhead chop; no blade stuns. A charge that lands throws the player down its own line and ends the charger's run on the spot |
| lightning strike | player | 1.2 hearts and a 620 ms stun, 900 ms after the marker lands |
| burning ground | player | fills the burn gauge while they stand in it; it damages enemies too, 520 ms a tick |
| enemy bullet | wall | destroyed |
| player | enemy | **push only, no damage** — see Player above |
| player, enemy | wall | slide |
| player dodge | breakable prop | breaks it outright, as a charge does |
| player | coin, room cleared | every coin in the room flies to the player through walls and is taken |
| boss slam ring | player | 0.6 heart a shot; the ring leaves from 64 px out, so inside it is safe |
| boss landing | player | 1.4 hearts within 46 px of the mark; the boss cannot be hit in the air |
| elemental player shot | enemy | **builds** a gauge (about three hits to fill) rather than starting a status; a full gauge ignites or poisons, and while the status runs the gauge is its clock and hits top it up and stack its intensity. Ice slows at once |
| player bullet | enemy bullet | none |

Bullet caps and firing discipline follow 005: enemy volleys skip at 600, player bullets recycle oldest at 900, and at most two ranged bodies wind up or shoot at once.

## Damage

Defined in 006; one function shared by game and simulator.

## Feel checklist

1. **Hit flash**: enemy tints white 60 ms on damage.
2. **Hit particles**: 4 to 8 squares in the enemy's palette color, 200 ms.
3. **Kill pop**: scale to 1.3× and vanish over 120 ms, larger burst, drawn from the facing the body died on.
4. **Hitstop and shake**: both are budgets rather than per-event effects — see "Impact" below.
5. **Player hit**: red vignette 150 ms.
6. **Bullet trails**: short alpha trail on player bullets only, and a trail along the blade's own path on a swing.
7. **Sound**: synthesised effects in three categories, built so a blow's weight, a spell's school and a telegraph's family are each audible, and adaptive music whose intensity is layers added to one piece. Four playback rules — never the same variant twice in a row, a small random pitch and volume per play, a floor on how often one effect may retrigger, and a cap on how many sounds of a category may start at once — so eight enemies dying together read as one event rather than as eight. Doc 018 holds the whole design.

## Readability rules

- Enemy bullets are one saturated hue (magenta) at a fixed radius; player bullets use the palette's cool hue.
- A spell is visible at every point of its life, not only in flight: a flash where it leaves the hand, an additive glow and a three-step trail on the shot, a coloured ring where it lands on a body, and a fizzle where it stops on a wall or runs out. All of it is drawn in the element's light — arcane cyan, ice white-blue, poison green, fire amber — so what was cast can be read from the shot. A player spell draws **at most one outline per effect, and preferably none** — fills, shadows, glow, particles and cracks carry it — and never borrows the enemy telegraph language (an outline ring over a hatched fill, red or magenta), which is kept for danger alone: a meteor's landing is a shadow that darkens, not a ringed and hatched circle. Fire is the one exception to the 90-degree rule: amber sits about 70 degrees from the enemy magenta, and only the glow carries it; the sprite itself stays pale.
- Every enemy volley is telegraphed before it leaves, for 320 ms scaled by the archetype's tempo and jittered a twelfth either way — about 260 ms for a skittish shooter, about 390 for an emplacement, and never below 260, the reaction floor (005). The emplacement pulse is 520 ms. The **length** of a tell varies per body and per repetition; the active window a blade or a bolt is live for never does, because a hit frame that moves is not a tell.
- **A blast is drawn from its brightest frame.** Damage from a ground blast
  lands on the first frame of it, so that frame has to be the flash: a mine's
  three drawn frames grow with their index, and played forwards they put the
  heart on the smallest of them and the picture of an explosion two hundred
  milliseconds later, which reads as the damage being judged before the blast.
  They play from the largest down, fading, and the hit stop then holds the
  flash rather than holding a puff.
- A spawn after the opening wave is announced before it happens: red rings pulse from the spawn point for 0.38 s, then the body climbs out of the ground under them over another 0.38 s — one motion of 0.76 s, and the enemy is intangible for all of it. The player reads the floor to plan, so a floor that can grow a rusher without notice cannot be planned on. The opening wave is simply there when the player walks in.
- Health and mana are two bars of one shape, each with `now/max` on it, with the banked spin charges beside them. Fire and poison are statuses with a build-up gauge over the player's head; enemies show burning, poisoned and slowed on the body.
- The boss's health bar runs along the bottom, above the spell row so the top row stays the player's, with its armour as a pale band and marks at 60% and 30%.
- Floor hazards draw beneath everything. The spike, poison and ice frames are each a framed plate, and a zone is drawn as **one plate**: the renderer composes each cell from quarter-tiles and takes the frame's interior wherever a cell borders another of the same zone, so the rim runs round the outside of the patch and a 3 x 3 ice patch is one sheet of ice rather than nine windows in the floor.
- A scorch mark is **dark and still** where live fire is **bright and moving**, so a mark is never mistakable for a hazard.
- Zones marked `none` are visually indistinguishable from plain floor.

## Room mood (Jev parameters, HSL tint)

Each room's look comes from three labels Jev chooses in round 1 of the room plan (004), each with `fallback`: `temperature` (cold / warm), `brightness` (dim / bright), `particle_intensity` (calm / busy). Instructions tie them to tension and state: warm and bright for release rooms after heavy damage, cold and dim for peak, busy particles for dense encounters. Temperature 0.9; mood is the one decision where variety matters more than fit.

The art is smooth and hand-drawn rather than palette-indexed, so a sprite carries on the order of a thousand colours and an index swap is impossible. Code applies an **HSL shift to the whole sheet once per mood and caches it**: hue ±14 degrees for warm and cold, lightness ×1.14 or ×0.86 for bright and dim, saturation nudged with it. Particle intensity sets particle counts (×0.6 / ×1.4) and does not tint.

The readability guarantee survives by exclusion rather than by a reserved palette slot. **Pixels inside a hue band around the enemy-bullet magenta are never shifted**: within 25 degrees of `#ff3fa4` at saturation 0.45 or above. Enemy bullets therefore look identical in every room whatever the Director asked for, and nothing else in the art may sit inside that band. Player bullets stay more than 90 degrees away in hue, which the asset checker measures from the delivered pixels rather than assuming.

Partial transparency is shifted like any other pixel. Leaving anti-aliased edges behind would draw a coloured rim around every sprite in a tinted room.

## Art direction

Pixel-art-look sprites matching `assets/source/style-reference.png`, delivered at twice the world resolution: the simulation works in world units where a tile is 32, and the renderer draws into a 2× surface, so a 64 px sprite occupies one tile. Characters are 64 × 64, the tank and summoner 96 × 96, the boss 256 × 256, bullets 32 × 32, tiles and props 64 × 64. No gameplay number depends on this; changing the art resolution changes only the renderer.

**Walls read as one construction.** A wall cell takes its frame from which of its four neighbours are open floor, and where two neighbours beside a corner are walls and the diagonal between them is floor it also takes an inner-corner cap square, so the lit edge turns the inside of an L instead of stopping at it (the four neighbours cannot see a diagonal). Walls whose courses run the tile's width — solid, and capped along the top or bottom — have every other course turned half a tile, so the joints break across the tile boundary as bricks do rather than lining up into a mortar line down the wall at every tile.

This keeps the shipped pixel-art appearance at 64 px instead of forcing an indexed eight-colour image into 16 or 32 px. Every body is a **sprite model** (016): a palette of at most 32 colours in material ramps, pixel parts with drawn variants, and poses that place them in whole pixels, composed into the atlas at build time. Nothing on a body is ever rotated or scaled. One character cell keeps 82 opaque pixels at 16 px and 1,310 at 64 px, so the higher delivery size is part of the style. The contract in `docs/asset-spec.md` also enforces the parts that break a bullet hell: soft alpha confined to edges, no matte halo, and the two bullet families far apart in hue.

Enemy shapes map to archetypes so the silhouette carries the read: rusher low and spiked, shooter a single-lens orb, turret a fixed radial emplacement, orbiter a crescent wisp, tank a broad armoured hulk, summoner a robed figure with a sigil, boss a crowned construct that sheds armour segments per phase. The lancer and the sentinel ship on tinted copies of the rusher's and turret's sheets until their own are drawn.

## Camera

The world is seen through a **fixed viewport of 16 × 9 tiles** (512 × 288 world px), whatever the window: eleven and a half bodies tall at 16:9, where the pixel-art top-down games that read best keep it (Enter the Gungeon and Hyper Light Drifter about eleven, Nuclear Throne about ten). A room is larger — half again to twice the viewport a side (doc 017) — and the camera follows the player across it. What a body past the view may do is measured from this viewport, so no window sees more of a fight than another. The HUD and menus are on a camera of their own, laid out in a frame 416 units tall and as wide as the viewport's shape.

- **Fitted to the window, whole.** The viewport fills the window along whichever side is tighter, and the rest of the window is black. The art is on a grid of two art pixels to a world pixel — most of it pixel art drawn on that grid, so exporting it larger only resampled it — and the fit is rarely a whole number of screen pixels to an art pixel: the world is drawn at the next whole number and the canvas shown smoothly scaled down to size, which keeps every art pixel the same width at the cost of a device pixel's blend at its edges. Three things were tried first and all were worse: a fixed backing store stretched by CSS to the window, which drew art pixels two and three screen pixels wide in turn so outlines wavered; a camera zoomed in over a window-sized canvas, which made every pixel coarse; and a scale setting over a fixed viewport, which could only make the canvas larger or smaller than the window.
- **It follows as pixel games' cameras do.** A dead zone in the middle of the view (34 × 20 px either side of its centre) the player moves about without moving it; outside it, a critically damped spring (smooth time 0.16 s) toward keeping them on the zone's edge, which never overshoots, with a top speed of 280 px/s, so a dash runs ahead of the view and the view catches up after rather than flinging the room past at dash speed. It is stepped on the simulation's clock: eased per display frame while the player moved per simulation step, the two moved on different beats and the view shook against the body. It settles by stopping within a quarter pixel, moves in whole-screen-pixel steps, never goes past the room's edge, and does not look ahead — led along the facing, turning on the spot swung the view; led along the movement, strafing did. Sprites are drawn at whole screen pixels too.
- **What is off the view is shown.** A body awake beyond the view's edge is a wedge on the edge along the line to it, brighter while it holds a turn to attack. A minimap top right, under the gold, has the walls, the part of the room in view, the player, and every body — dim asleep, bright awake, brightest and larger attacking.
- **A room starts with the camera on the player**, not panning from where the last room left it.

## Effects

Drawn in code, on top of the sheet, so each reads by shape as well as colour:

- **The sword swing** is a smear, not a stripe: a thick crescent thrown at chest height and flattened into the three-quarter view's ellipse, brightening toward the blade, with a white edge, a tip glint and sparks. The blade crosses its arc on an ease-out (two thirds of it in the first third of the active frames) and the crescent spreads on the same curve, so a cut is thrown rather than swept. The player is never moved by a swing. Past the steel the reach is a **magic blade** (013) that exists only while the sword swings.
- **Hits** throw sparks the way the blade was travelling and leave a short white cut; a spell's hit sparks in its element; a kill is a flash, two rings at two speeds and a spray. A tank's ram connecting holds the room for six frames and bursts grit and sparks along the charge, with dust skidding behind the thrown player.
- **Spell projectiles** each have their own silhouette and particles (`scenes/projectiles.ts`): a comet for the plain bolt, a needle and a faceted spike for ice (with frost behind), a fireball licking back (embers rising), a venom drop (dripping), poison bubbles, a tumbling rock (dust), tracers, crackling sparks, flying knives, and a void orb drawing motes in. Lightning is a fractal bolt with forks along the last 96 px of its path, with sparks and short arcs jumping off its head. Fire and venom are drawn as matter rather than light, because additive red over a cold floor turns magenta.
- **Armour** is a shield-blue bar with a shield at its left end, distinct from ice's pale cyan.
- **The warden's blast** is after Metal Slug's shotgun: there at once along its whole length, narrow at the muzzle and fanning wide, a grain of white-hot and pale-yellow flecks thickest along its middle over a pale body, a white bloom and a ring off the muzzle, and the floor lit ahead of it; over a fifth of a second the grain flies apart and cools and the far end becomes a grey cloud that hangs. The shot holds the room for two frames and throws the warden back a step. While the gun is raised its reach is drawn on the floor ray by ray, each ray cut short at the first wall, the same shape the damage uses.
- **Deaths that burst** (the elite lancer, `volatile`) grow their eight spikes out of where the body fell, quiver while they hang, and fly; a ring on the floor at the spikes' reach tightens as the flight nears.
- **A set-off mine** swells and flashes red and white for its fuse, with the blast it is about to make drawn on the floor.
- **Walks and every other cycle are poses of the body's model** (016): the feet travel along the facing and lift as they pass under the body, the body rises a pixel as they pass (a heavy body also sinks as a foot lands), and the arms swing against the legs, each by choosing a drawn variant and moving it in whole pixels. The outline is traced round the composed silhouette, so a moved part opens no seam.
- **Lava and grass are floor drawn in code** (`fx/sheets.ts`): lava one flat orange with flecks a shade either side drifting along the channel over a 32-frame loop two tiles long, every cell on the same frame so the flow is continuous, sunk below the floor behind a ragged bank of dark stone — deeper on the north, the face the view looks at — with the melt brighter along it; grass two drawings of tufts lit at the tip, turning to glowing embers while a cell burns and char after. Where grass meets the floor it reaches over in tufts, so it lies in the floor and not on it as a square.
- **Fire** is layered particles, not a sprite (`scenes/fire-fx.ts`). A fire has a back and a front, and a body stands *in* it only if the far flames are behind it and the near flames over its feet, which a single floor sprite cannot do. So a burning patch is: burnt stone (1.9), a flickering bed of coals (1.95) and the light it throws on the floor (2), all under the bodies; tongues rising from the far half of the patch (5.8), under every body; tongues from the near half (8.6), over every body, shorter and a little translucent so the body still reads; then sparks and a thin smoke (8.7, 8.8). The burnt stone outlives the fire by a few seconds. A burning body sheds small tongues on its own layer. Enemy fire is red at the rim; the player's is gold.

### Shots, after Metal Slug

A shot is an event at both ends. **Every enemy shot flashes at the muzzle**, along the way the volley left, sized by the weapon's weight (small, medium, large; a heavy gun adds a low layer under its report); a ring volley has no muzzle and puffs at the body instead. **Fast shots are tracers** (190 px/s and up): a stretched streak in the reserved magenta with a white-hot head and a dark tail, two frames, pointed along the flight; slow pattern shots stay round, since a bullet-hell orb is read by its place, and carry a faint copy behind them. **Where a shot ends, something happens**: against stone, sparks thrown back off the face and then grit; spent in the air, it pinches to a ring and goes out; on the player, a white star and a red ring throwing shards. The player's own casts flash at the hand in their element's colour, and a dear spell kicks the body back a pixel or two.

These are **baked sprites drawn by code** (`fx/sheets.ts`): generated at the art's pixel from a short ramp in flat bands, with a one-texel rim on matter and dithering where it thins, baked to a texture at boot and previewed with `pnpm fx:preview`. That sits between the two kinds below: a fixed drawing with an identity, as a sprite is, made without waiting on the art pipeline. What changes shape at run time is still drawn live; the warden's blast is both — baked frames, masked each frame to the shape the sim cut at walls.

### Rules for effects drawn in code

An effect whose size or shape is only known at run time — a chain, a beam, a field, a fire, anything a modifier or a level changes — is drawn in code; a thing with an identity — an icon, a body, a held or thrown object — is a sprite. Drawn in code, it still has to sit in the pixel art:

- **Textures at the art's pixel.** Particle and decal textures are drawn once, at start, into a canvas texture at half a world pixel per texel — the size a delivered sprite's pixel is on screen — and shown at about that scale. No texture is scaled so far that its texels stop matching the sprites'.
- **Flat bands, not gradients.** Colour steps: a flame's rim, body, inner and core are four flat bands baked into its texture. Alpha fades in two or three steps, as frames would, not smoothly.
- **Opaque matter, additive light.** Fire, venom and smoke are drawn opaque; only light — a glow on the floor, sparks, a flash — is additive, since additive colour over the pale floor washes to white and over the cold floor turns magenta.
- **Depth is the layering.** An effect that a body stands inside is split at the body's depth, the far part under it and the near part over it.

Cost, against the targets below:

- **Pooled, persistent objects.** A few particle emitters serve the whole room, one per layer, emitted into by hand at a rate per source (`emitParticleAt`), rather than an emitter or a new game object per effect per frame. Decals are created once per slot of the simulation's fixed pool and reused.
- **Kept text.** A `Text` is a canvas drawn with its font and uploaded as a texture, so text drawn every frame — the HUD numbers, keycaps, the boss's title, damage numbers, the marks over heads — is fetched by key from a cache (`ftext`), redrawn only when its string changes, and hidden in a frame that does not ask for it. Rebuilt each frame, a dozen damage numbers over burning bodies took the frame from 7 ms to 13.5 (p95 20); kept, it stays at 7.
- **A budget.** Emission is shared out when many sources are live, so a room at the simulation's cap costs what a few do. Measured with all 24 fire slots burning: under 0.03 ms of script per frame and about 7% of frame rate.

## Performance targets

60 fps on an integrated-GPU laptop in Chrome with 600 enemy bullets, 900 player bullets and 30 enemies. Simulation step under 4 ms at that load, measured in the debug panel.

## Impact: freeze and trauma

Both effects sit near the top of Jan Willem Nijman's ordering in *The Art of
Screenshake*, the closest thing this genre has to a canonical build order for
feel.

### Hitstop

The whole simulation holds still for one frame when a shot lands, three on a
kill, four when the player is hit, capped at six. Frames rather than
milliseconds is how the budget is actually reasoned about, and the numbers
come straight from Nijman's one-to-two-frame baseline scaled by consequence.

The cap is Sakurai's. He keeps Smash's hitstop shorter than he would like
because a freeze also freezes everyone else, which in a four-player fight
hands a third party a free approach. The same objection applies with more
force here: every frozen frame is a frame stolen from a player who was
reading an incoming wall of bullets. The freeze is worth having because it
sells the collision, and it is kept short because it is borrowed time.

Frozen frames do not count toward `elapsedMs`. A freeze is presentation, not
game time, and charging it to the room would turn every measurement of how
long a fight takes into a measurement of how many hits landed in it.

### Camera trauma

Shake is a single accumulator in `[0, 1]` rather than a shake per event,
after Squirrel Eiserloh's model. **Only the player being hurt adds to it**
(0.55): a hit or a kill the player lands, and an enemy attack that misses,
freeze the frame but do not shake it, and neither does a body braking out
of a lunge or charging into a wall, so a shake always means "that cost you".
The others are the boss's heavy blows and its changing phase, and on the
player's side one only: **a meteor landing** (0.5, hit or miss). It is the
one blow the player waits most of a second for, on a long cooldown, so it
is rare enough not to become the constant rumble this rule exists to stop;
nothing the player casts often may join it. It decays at 1.5 per second, and the
renderer displaces the camera by its **square**, at most 4 world px — sized
for the near camera, which draws a world pixel half as large again as the
room view did.

The square is the whole trick. It lets a chip hit and a death share one scale
without the chip hit becoming visible noise: at trauma 0.3 the displacement
is 9% of maximum, at 0.9 it is 81%. A single accumulator is also what stops a
busy moment from summing eight independent shakes into something unreadable.

Displacement is **translation only** — roll is the part of a shake most likely
to make someone motion sick — up to 6 px at full trauma, driven by two
incommensurate sines per axis rather than a fresh random number per frame.
Random per frame buzzes; a smooth signal rumbles. It is a **setting**: on,
reduced (the default, 40% of the displacement) or off. Impact is carried first
by what does not move the frame — hitstop, the struck body's flash, dust, the
kill pop — so a player with shake off loses little. There is no full-screen
flash, for the same reason.
