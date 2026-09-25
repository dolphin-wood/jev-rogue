# Art work order — the spells' own effects (batch S)

The spells added in doc 006's newer shapes and options were drawn in code:
translucent vector shapes, soft glow discs, outline rings. Played beside the
hand-painted sheets they read as cheap, and the report was blunt about it. The
standing rule is now:

- **A spell effect is delivered pixel art**, or it reuses delivered pixel art
  (`vfx_*`, `bullet_player_*`, `weapon_player_sword`). Code may place, turn,
  flip, fade and play frames; it may add hard-edged particles and fills on
  the art's texel grid. It does not draw translucent shapes or glow discs.
- **At most one outline per effect, and preferably none.** The near-black
  sprite outline counts as that one.
- **Never the enemy telegraph language**: no outline ring over a hatched
  fill, no warning reds or magenta on anything of the player's. The magenta
  band (`#ff3fa4`) is an enemy bullet in the air and nothing else.

What the game already reuses, so none of it is drawn here: the thrown sword
is `weapon_player_sword` spinning, its afterimages copies of the same sprite
filled with the spirit light; a frozen orb's shards are `bullet_player_a_*`;
ball lightning's body and a full charge's glint are `bullet_player_c_*`; the
cuts of a guard's clash and an orb's strike are `vfx_impact_*`. Everything
below is what is still drawn in code and has no delivered art to stand in for
it. Each row says **how the renderer consumes the frames**, because the art has
to be drawn for that and not for a still.

## S0. The rules every sheet here follows

Read **Hard rules**, **Sizes**, **Colour** and **Delivering** in
`docs/art-workorder.md` and **E0** in `docs/art-workorder-codex.md` first.
In short, and not negotiable:

- Authored on the 1× grid, delivered at the stated size (the atlas's 2× of
  world units: 64 px covers one tile), **hard alpha** — the importer
  binarises at 128, so draw the edge you want.
- Light from the **top left**; flat or two-step shading, stepped edges; no
  gradients, no dithered glow halos, no text.
- **No soft light round anything.** A glow is a band of the light colour
  with a hard edge, drawn as part of the shape, never a translucent disc
  behind it. The renderer draws these in normal blend; do not rely on
  additive blending to make them read.
- One facing unless a row says otherwise (these are `vfx_`, radially
  symmetric or turned by the renderer). Never draw `e`.
- **Never scale on one axis**, and the renderer does not scale these by
  non-integer amounts: each row gives the size it is drawn at.
- Palettes: the player's schools, as the icons and HUD use them —
  **spirit** `#f4f0ff` core / `#b9a7ff` light (Crescent Edge), `#e6fff4` /
  `#7fe8c0` (Returning Edge); **storm** `#ffffff` / `#9ad2ff`; **void**
  `#e2d0ff` / `#7a4fd6`, dark `#3a1a70`; **frost** `#f2fbff` / `#7fd0ff`,
  body `#1d5a86 #7fc4ef #d8f4ff`; **flame** `#fff1c0` / `#ffc44a` /
  `#ff8a3a`; **venom** `#e8ffd4` / `#6fdc5a`, dark `#1f4a14`. Ink
  `#0d0b1f`.
- Register every frame in `packages/harness/src/assets/manifest.ts`, keep the
  draft beside its normalised source under `assets/source/`, then
  `pnpm assets:art` and `pnpm assets:check`.

Every row here is **wired after delivery**: the renderer does not ask for
these names yet. Until they arrive the code-drawn interim stays, and each row
names that interim so it is removed in the same change.

## S1. The frames

### S1a. `vfx_crescent_wave` — Crescent Edge's thrown crescent — **priority 1**

> **10 frames, 96 × 192** (tall: the arc stands across its flight): `launch_0..1`, `fly_0..3` (loop), `dissolve_0..3`.
> A solid crescent of energy after Getsuga Tenshō, **facing east**: its
> convex leading edge on the right, its concave side toward the thrower on
> the left, fat in the middle and drawn to two sharp tips. From the leading
> edge in: a thin dark lip just outside the edge (the one outline), a thin
> band of the light, a white-hot core, and the light again, torn and ragged
> along the trailing side. `launch` is the same crescent white-hot and a
> texel fuller; `fly` flickers the lip and the ragged tail and nothing else,
> so the silhouette holds; `dissolve` eats the tips first, inward to the
> middle, thinning, and ends empty.

How it is consumed: the wave is the swing's own edge flying forward
(`waveHits` in `packages/core/src/sim/shapes.ts`): an arc of **radius 57.6
world px** — the swing's reach — spanning **110°**, which is 94 px chord and
about 36 px from tips to leading edge. So in the frame the leading edge is an
arc of radius **115 px** (2×) whose middle sits at `(86, 96)` — its centre is
off the frame, 115 px to the left — the tips at about `(37, 2)` and
`(37, 190)`, and the body about 22 px deep at the middle. It is drawn at
native scale, anchored at the leading edge's middle, rotated to the swing's
facing, never flipped. It flies about 80 px
in 0.25 s: `launch` for the first 2 frames, `fly` at 12 fps, `dissolve`
across the last half of its reach. The renderer sheds its own hard square
wisps behind it; draw none. In the spirit palette only — the king's sword
wave expands as it goes and stays drawn on the texel grid in the danger
palette (`drawCrescentWave`).

Draw none of: the sword, the swing's trail, motes, a glow behind it.
Interim: `drawCrescentWave` in `packages/game/src/scenes/wave-art.ts`.

### S1b. `vfx_meteor_rock` and `vfx_meteor_impact` — Meteor — priority 2

> **`vfx_meteor_rock_0..3`, 32 × 32**, loop: a burning rock falling on a
> slant — dark stone lit on the side away from its fire, cracks glowing, a
> short tail of flame thrown up behind it **toward the top left**. The
> renderer moves it from 190 px above the mark to the mark and does not turn
> it, so the slant is drawn in.
>
> **`vfx_meteor_impact_0..4`, 128 × 128**, one shot at 16 fps: the rock
> breaking on the floor — chips, a skirt of dust and fire thrown up, over in
> five frames. Drawn for the spell's default radius of 34 world px (68 px in
> the frame, centred), at native scale.

Draw none of: the mark's shadow (it is `drawMeteorShadow`, on the texel
grid), the burning ground left after (it is `FireFx`'s), a ring or a flash
disc. Interim: `drawFallingRock` and `meteorImpactAt` in `play.ts`.

### S1c. `vfx_frost_orb` — Frozen Orb's body — priority 3

> **4 frames, 32 × 32**, loop at 8 fps: a slow sphere of packed ice, a
> six-pointed facet turning inside it, a pale upper face. Its shards are
> `bullet_player_a_*` and must read as broken off it: the same blues.

Drawn at native scale, centred, not turned. Draw none of: shards, frost
motes, a halo. Interim: the `frost_orb` case in `projectiles.ts`.

### S1d. `vfx_ball_lightning` and `vfx_arc_seg` — Ball Lightning — priority 3

> **`vfx_ball_lightning_0..3`, 32 × 32**, loop at 12 fps: a slow ball of
> current, a hot white core in a hard band of storm blue, filaments that
> never hold still. Replaces `bullet_player_c_*` standing in for it.
>
> **`vfx_arc_seg_0..3` (32 × 16, tileable along x) and `vfx_arc_cap_0..1`
> (16 × 16)**: the jagged arc from the ball to the body it strikes, storm
> blue with a white core, for a moment after each strike. The renderer
> repeats the segment along the line and caps the far end on the body, as
> `vfx_beam_seg`/`vfx_beam_cap` are consumed; the segment's ends must meet
> at mid-height.

Draw none of: the enemy's chain or beam colours; a sky bolt (that is
`vfx_bolt_*`). Interim: `bullet_player_c_*` plus `lightningBolt`/`strokeBolt`.

### S1e. `vfx_doom_rune` and `vfx_doom_burst` — Doom Sigil — priority 4

> **`vfx_doom_rune_0..4`, 32 × 32**: the diamond that stands over a marked
> head, void dark with the void's light filling it from the bottom up —
> full, three quarters, half, a quarter, empty. The renderer picks the frame
> by the time left and blinks the last quarter white itself (a tint-fill).
>
> **`vfx_doom_burst_0..3`, 96 × 96**, one shot at 16 fps: the diamond
> shattering into four shards and a burst of void light out to the mark's
> 40 px radius (80 px in the frame), no ring.

Draw none of: a ring on the floor under the body (a ring round a body is an
enemy's attack). Interim: `drawDoomRune`, `doomBurstAt` in `play.ts`.

### S1f. `vfx_vortex` — Void Maw and its gather — priority 4

> **`vfx_vortex_0..3`, 128 × 128**, loop at 10 fps: three arms of void motes
> turning inward over a dark hole in the floor, seen at the game's angle.
> **`vfx_vortex_gather_0..3`, 128 × 128**, one shot across the last 400 ms:
> the arms tightening, streaks drawn in from past the rim, the heart swelling
> white, ending on the frame the implosion goes off.

Drawn at native scale for the pull's default radius; the renderer does not
scale it. Draw none of: the bodies, the burst after (motes). Interim:
`drawVortices` in `play.ts` (hard motes and a dark hole now; no disc).

### S1g. `vfx_guard_answer` — Counter Stance's answer sweep — priority 5

> **5 frames, 128 × 128**, one shot at 20 fps: a spin slash of the guard's
> teal light round the caster at the answer's 56 px radius (112 px in the
> frame), bright at its head and gone at its tail, sweeping the full circle.
> The weak answer plays the same frames tint-dimmed and stops at frame 3.

Draw none of: the player, a ring outline, anything under the feet. Interim:
`drawAnswers` in `play.ts` (bands of fill). The guard's shaft light stays a
two-band fill along the drawn staff and needs no frame.

### S1h. `vfx_contagion_glob` — Contagion's jump — priority 5

> **2 frames, 16 × 16**, loop: a venom glob in flight, dark rim, green body,
> a pale glint. The renderer lobs it on an arc from the body that died to
> each body the poison jumps to, and splashes motes on landing.

Interim: the `spores` loop in `drawSpellOptions` (solid circles).

### S1i. `vfx_landing_dust` — a leap's landing and a quake ring's cracks — priority 5

> **4 frames, 128 × 64**, one shot at 16 fps: a skirt of dust and grit thrown
> out round a landing, seen at the game's angle, low and wide. Played at a
> leap's landing and, smaller, on each ring of Quake Ring as it breaks.

Draw none of: spikes (they are `vfx_earth_spike_*`), a ring outline, a flash.
Interim: particle bursts in `landingAt` and the ring pass of
`noteSpellOptions`.

### S1j. `vfx_gas_puff` — Toxic Cloud's gas — optional

> **4 frames, 32 × 32**: one puff of venom gas rising and thinning, for the
> cloud's emitters. The cloud's bed is already a stepped-band texture and
> stays.

Interim: the baked puff texture of `FireFx`'s `gasBack`/`gasFront`.

## S2. Acceptance

- `pnpm assets:check` OK: outline, value band, magenta band, no soft alpha,
  frame sizes as stated.
- In game, each effect replaces its interim with nothing else drawn over it:
  **no glow disc, no outline ring**, one outline at most.
- The crescent (S1a) lines up with its hit arc: at release its leading edge
  sits on the swing's reach and its tips on the arc's 110° span, checked in
  a paused frame against `waveCentre`/`waveRadius` with the debug hook
  `?spells=crescent_edge`.
- Read at gameplay zoom beside `vfx_earth_spike_*`, `vfx_flame_pillar_*`
  and `weapon_player_sword`: the same pixel size, the same shading.

## S3. Priority

1. **S1a** the crescent — Blade's starting spell, on screen every swing.
2. **S1b** the meteor rock and impact.
3. **S1c**, **S1d** the frost and storm orbs.
4. **S1e**, **S1f** doom and the vortex.
5. **S1g**–**S1j**.
