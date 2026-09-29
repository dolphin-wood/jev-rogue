# Painted spell effects

The twelve transparent PNG sheets in `drafts/` are the ImageGen painting
deliveries for `docs/art-workorder-spells.md`. They cover the crescent wave,
meteor rock and impact, frozen orb, ball lightning, arc segments and caps,
doom rune and burst, vortex and gather, guard answer, contagion glob, landing
dust, and gas puff. Each sheet was prompted as pixel art on transparent
background with top-left light, hard stepped edges, the work order's school
palette, and no text, soft halo, or enemy magenta.

Run `node scripts/normalize-spell-art.mjs` from the repository root to crop
those paintings into exact atlas frame sizes, reduce their shading to the
school palette, and harden alpha. `pnpm assets:art` packs the resulting
`vfx_*.png` frames. The source sheets and normalization are retained so the
frames can be rebuilt without a generation service.

The stone school's sprites are made by `node scripts/draw-stone-art.mjs`: the
tumbling chunk (`vfx_stone_chunk_*`, Stone Shard) and shell
(`vfx_stone_shell_*`, Mortar) are drawn there, and the shell's landing
(`vfx_stone_impact_*`) is the meteor impact draft reduced to the stone palette,
its fire turned to dust.
