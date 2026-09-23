# Melee source sheets

These PNGs are the editable sources packed by
`packages/harness/src/assets/art.ts`. The complete generation prompts and grid
layouts are versioned in `docs/art-workorder.md`; the authoritative frame names
and sizes are in `assets/source/frames-melee.json`.

Production sources:

- `player-design.png`, `player-walk.png`, `player-idle.png`,
  `player-actions.png`: approved black hood void, gold eyes, same sword hand,
  empty off-hand.
- `offhand-flame.png`: four-frame independent mana flame.
- `swing-strip.png`: straight, seamless 256 × 64 body for procedural bending;
  it is symmetric and fills 91% of the radial texture axis.
- `swing-tip.png`: 64 × 64 leading cap. Its left edge matches the strip and
  its right edge tapers to a two-pixel point.
- `lightning-bolt.png`: three-column source for the 64 × 128 descending
  leader, full strike and broken afterimage. The packer removes the generated
  glow, aligns the strike at bottom centre and keeps the leader off the floor.
- `effects.png`: the third row supplies the three impact frames.
- `groundfire.png`: four drawn fire silhouettes with a stable dark scorch
  base; its `-draft` file is the unnormalised generation output.
- `enemy-*-hit.png`: drawn two-step recoil poses for rusher, shooter, orbiter,
  summoner and turret. `enemy-tank-hit.png` remains the previously approved
  tank sheet.
- `enemy-deaths-64.png`, `enemy-deaths-96.png`: six collapsed death poses,
  split by target size so no frame is oversampled beyond the 4x source limit.
- `enemy-weapons.png`: the rusher's separate monster claw. It is deliberately
  not a hilted dagger; `player-sword.png` remains the long hovering magic
  sword and is packed unchanged as `weapon_player_sword`.
- `companion-walk.png`: three facings with four distinct locomotion poses.
- `enemy-*.png`: walk, dormant, melee and hit sheets. Shooter keeps the
  shipped floating mechanical-orb identity; orbiter keeps four unbranched
  tentacles.
- `spell-icons.png`, `affix-icons.png`, `stat-icons.png`,
  `reward-badges.png`, `ward-rune.png`, `brand-mark.png`: topology-first UI
  and VFX sources authored on an exact 4x grid, packed without fractional
  resampling.
- `floors.png`, `walls.png`, `decorations.png`, `destructibles.png`,
  `portals-rewards.png`, `pickups.png`, `companion.png`, `vendors.png`: world,
  pickup and friendly-character additions.

Files containing `draft` are unnormalised generation outputs kept as
provenance, and `player-model.png` is an earlier model sheet. The packer does
not read either kind directly.

Run `pnpm assets:normalize-animations` only when one of the animation draft
sheets changes, then `pnpm assets:art`. The normalizer removes diffuse matte,
snaps each pose to its final pixel grid and stores the editable 4x source.
