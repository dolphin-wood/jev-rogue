# Art work order — the run's three depths

For whoever draws the rooms. Every fighting room is drawn from one set of flagstones and one set of
walls today, told apart only by the room mood's colour filter and a scatter of decals, so fifteen
rooms read as one room fifteen times. The run becomes three places as it goes down
(`packages/core/src/rooms/biome.ts`):

| Rooms | Depth | Id | What it is |
|---|---|---|---|
| 1–5 | The ossuary | `ossuary` | Pale, dry bone-grey stone under the crypt: niches of skulls in the walls, cobwebs, old dust. |
| 6–10 | The flooded catacombs | `flooded` | Blue-green, wet: moss in the joints, standing water, weeping walls, rusted iron grates. |
| 11–15 | The burnt undercroft | `furnace` | Soot-black brick over the king's hall: embers in the cracks, melted candle wax, chains, scorched plaster. |

The merchant's hall and the throne hall are drawn as themselves (`docs/art-workorder-halls.md`).

## Rules

The tile conventions of `docs/art-workorder.md` apply: a tile is **64 × 64 art px** (32 world px),
delivered at 4×, light from the top left, hard alpha, the near-black ink, the value band. The room
mood's colour filter is still laid over every room, so draw each depth in its own **neutral** light:
its identity is in its materials and shapes, not in a tint the filter will change.

- **The floor stays quiet.** Telegraphs are drawn on it in warm reds, oranges and white. Keep every
  floor's values inside the band and away from `#ff5544`'s warm range, including the furnace's
  embers, which are a sparse dark orange in the cracks, never a glow across a slab.
- **Walls read as walls** at a glance, with their lit top edge, as the common set does.
- **Decals and patches are flat**, never an obstacle's silhouette: the player walks over them.

## Deliverables, per depth (`<id>` is `ossuary`, `flooded` or `furnace`)

| Frames | Size | What |
|---|---|---|
| `tile_<id>_floor_0` – `_3` | 64 × 64 | Four floor slabs that tile with each other. The game lays them at random. |
| `tile_<id>_wall_*` | 64 × 64 | The wall autotile, **the same twenty names as the common set** with the depth's id put in: `solid`, `n`, `e`, `s`, `w`, `ne`, `es`, `sw`, `wn`, `ns`, `ew`, `nes`, `esw`, `swn`, `wne`, `nesw`, and the inner corners `inner_ne`, `inner_es`, `inner_sw`, `inner_wn` (so `tile_ossuary_wall_ne`, `tile_ossuary_wall_inner_sw` …). A missing name falls back to the common frame. |
| `deco_<id>_0` – `_7` | 64 × 64 | Eight small decals scattered one floor tile in nine: ossuary — a skull, scattered finger bones, a cobweb in a joint, a burial plaque; flooded — a puddle, moss, a dropped lantern, a rusted grate; furnace — a scorch, cold ash, a melted candle stub, a length of chain. |
| `patch_<id>_0` – `_2` | 128 × 128 (2 × 2 tiles) | Three larger pieces of floor with a story, two at most to a room: ossuary — a spread of bones round a broken coffin lid, a collapsed niche's rubble, a ring of candle stubs; flooded — a pool with its edge of moss, a silted drain, a fallen stone half under water; furnace — a burnt-out pyre, a spill of cold coals, a cracked slab with embers in the break. |
| `prop_<id>_sconce` | 64 × 128 | *(Delivered, not used — see below.)* A light hung on a north wall's face: an iron cage of candles (ossuary), a green-glass lantern (flooded), a brazier bowl on a bracket (furnace). |

### The wall autotile

The wall cells are **not decorative variants**. Each name says which of the cell's four sides touch
open floor, and the game picks the cell by exactly that (`wallFrame` in play.ts): `n` is a wall cell
with floor to its north and wall on the other three sides; `ns` has floor north and south; `nesw` is
a lone block with floor all round; `solid` has wall on all four sides and is the **inside of a mass
of wall**, with no edge at all. On every side named, draw the wall's lit top edge (the band the
common set has — see `tile_wall_*`, which is the reference for which edge goes where); on every side
not named, the cell must run on seamlessly into the next wall cell, with no cap, no ledge and no
seam. `inner_ne`, `inner_es`, `inner_sw` and `inner_wn` are only the small corner piece laid over a
wall cell whose two neighbours on those sides are wall but whose diagonal between them is floor —
draw the lit corner there and leave the rest transparent.

**Review of the first delivery (2026-09-25).** The floors, decals, patches and sconces are in the
game and read as three places. The walls are drawn as variants instead: `solid`, `n`, `e`, `s` and
`w` are the same brick with a cap across the top, and the combinations are niches, skulls, rubble
and grates. In a room, every row of a wall mass showed a cap band and niches appeared mid-wall, so
the game draws the common walls for now (`BIOME_WALLS` in play.ts). Redraw all twenty wall cells to
the rule above; a niche, a skull or a grate may appear only as a variant of a **south face** (floor to
the south, the face the camera sees), delivered as extra cells `tile_<id>_wall_s_1`, `_s_2`, … and
laid by the game at random among the plain `s`. Also: the ossuary's `tile_ossuary_floor_2` carries a
carved ring that reads as an area telegraph at a glance — take the ring out (the game lays it one
cell in sixteen until then); and the flooded depth's rust-red whorl decal is close to the warm
telegraph range — cool it or darken it.

The first sconces were drawn from the side, as lamps hung on a wall face, and the walls here are
seen from above with no face, so in a room they lay on the wall tops like fallen lanterns. A lamp
drawn from overhead in code read no better. The game draws no wall light at all for now; a redrawn
sconce is not needed until a lamp fits the view.

Deliver each set as a sheet of named cells in `assets/source/biomes/<id>.png` with its list in the
delivery notes, and pack it into the atlas under the names above. The game picks each name up the
moment the atlas has it; a depth with nothing delivered is drawn as the common dungeon.

## Acceptance

- Three rooms from the three depths, side by side in the same mood, read as three different places.
- Every enemy telegraph stays readable on every depth's floor, patches included.
- `pnpm assets:check` passes; hard alpha, the value band.
