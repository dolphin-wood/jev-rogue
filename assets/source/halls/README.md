# Fixed hall art

These PNGs were generated with the built-in imagegen tool, using
`assets/source/melee/floors.png` and
`assets/source/melee/boss-king/throne_empty.png` as style references. The
selected drawings were cropped to 64 art pixels per room cell with nearest
sampling and alpha thresholded to 0 or 255. The source PNGs here are loaded
directly by `packages/game/src/scenes/hall-art.ts`.

The final prompt set specified:

- `throne-floor.png`: four large dark polished stone slab variants with sparse,
  faint antique gold inlay, low contrast and no red or orange.
- `throne-carpet.png`: a 3 × 3 deep violet royal runner with repeatable middle,
  frayed ends, worn holes and restrained gold thread.
- `throne-dais.png`: a 5 × 2 dark stone throne platform and shallow steps, with
  the existing empty throne used only for style and scale.
- `throne-column.png`: a 2 × 4 top-down 3/4 gothic stone column with a solid
  2 × 2 footprint and cool top-left highlights.
- `throne-banners.png`: three 2 × 3 violet royal banners, respectively intact,
  torn and hanging by a corner, with a faded crown device.
- `throne-candelabra.png`: two frames of one wrought-iron candelabrum, changing
  only its tiny candle flames.
- `market-floor.png`: four warmer, older flagstone variants with sparse straw
  and old wax in the joints.
- `market-rugs.png`: two flat 3 × 2 woven rugs with faded geometric patterns and
  lightly curled edges.
- `market-column.png` and `market-column-flicker.png`: one plain 2 × 4 stone
  column with a hung lantern; only the flame changes in the second frame.
- `market-dressing.png`: six separate flat floor details: rope, coins, chalk
  mark, rolled map, candle stubs and bedroll.

All prompts required hard pixel clusters, transparent isolated objects where
appropriate, top-left light, near-black outlines, no text, and no breakable
objects. The throne hall floor and carpet were kept dark so warm combat tells
remain legible.
