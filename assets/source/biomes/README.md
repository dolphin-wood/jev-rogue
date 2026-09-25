# Three depths: art delivery

The painted sources are `drafts/<id>-material.png`, `drafts/<id>-decals.png`, and
`drafts/<id>-patches.png`, plus `drafts/ossuary-plain-wall.png` for the long
quiet masonry runs. `normalize.mjs` cuts and reduces them to the final
art-pixel grid, applies hard alpha, and writes one named-cell sheet and one
cell map for each depth: `ossuary.png` / `ossuary.json`, `flooded.png` /
`flooded.json`, and `furnace.png` / `furnace.json`. The game atlas imports these
named cells directly; `comparison.png` is a same-mood room preview with a
combat warning across a patch.

Each sheet lists these 36 cells in its JSON, in this order:

- `tile_<id>_floor_0` through `tile_<id>_floor_3`: 64 × 64.
- `tile_<id>_wall_solid`, `_n`, `_e`, `_s`, `_w`, `_ne`, `_es`, `_sw`, `_wn`,
  `_ns`, `_ew`, `_nes`, `_esw`, `_swn`, `_wne`, `_nesw`: 64 × 64.
- `tile_<id>_wall_inner_ne`, `_inner_es`, `_inner_sw`, `_inner_wn`: 64 × 64.
- `deco_<id>_0` through `deco_<id>_7`: 64 × 64, transparent.
- `patch_<id>_0` through `patch_<id>_2`: 128 × 128, transparent.
- `prop_<id>_sconce`: 64 × 128, transparent.

Here `<id>` is `ossuary`, `flooded`, or `furnace`. The wall variants use
painted cells from each biome's wall sheet; the four inner corners retain only
the painted cap quadrant. Floor cells and patches are kept dark so the warm
combat warning remains legible. All final pixels are hard alpha.

To rebuild the source sheets and comparison image, run:

```sh
node assets/source/biomes/normalize.mjs
node assets/source/biomes/preview.mjs
```
