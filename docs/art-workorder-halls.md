# Art work order — the two fixed halls

For whoever draws the rooms. The throne hall (the Crypt King's arena) and the
merchant's hall are now the same room in every run (`packages/core/src/rooms/fixed.ts`),
so they can be dressed like places rather than tiled like generated rooms. Today
both are drawn with the ordinary dungeon floor and walls; the finale of the run
looks like room nine.

## H0. Rules

Everything in **E0** of `docs/art-workorder-codex.md` and the tile conventions of
`docs/art-workorder.md` apply: a tile is **64 × 64 art px** (32 world px, delivered
at 4×), light from the top left, hard alpha, the near-black ink, the room palettes'
value band. Top-down 3/4, as every room.

- **Only what is marked solid below may look solid.** Everything else is floor
  dressing the player walks over: flat, low contrast against the floor, no
  silhouette that reads as an obstacle. A player must never dodge round a
  banner's shadow.
- **Nothing breaks.** No pots, crates or urns in either hall — a broken pot in
  the boss's arena is a wall his moves stop at, and a vendor's stall behind
  crates is one the player smashes their way to.
- **Keep the fight readable.** The middle of the throne hall is where every
  telegraph is drawn (red floor tells, cracks, crescents in orange and white):
  its floor stays dark and quiet, with no warm reds or oranges and no busy
  pattern under the fight.

## H1. The throne hall — 29 × 15 cells

```
#############################
#............TTT............#   T  the throne on its dais (solid)
#...........................#
#....OO...............OO....#   O  four columns, 2 × 2 cells each (solid)
#....OO...............OO....#
#...........................#
#.............|.............#   |  the carpet runner, door to throne
#.............|.............#
#.............|.............#
#...........................#
#....OO...............OO....#
#....OO...............OO....#
#...........................#
#...........................#
##############+##############   +  the one door, the way the player came in
```

| File | Size | What |
|---|---|---|
| `assets/source/halls/throne-floor.png` | 4 × 1 tiles | The hall's floor: dark polished stone, larger slabs than the dungeon's, a faint gold inlay line at the slab joins on one variant. Four variants, laid by the game at random. |
| `assets/source/halls/throne-carpet.png` | 3 × 3 tiles | The runner from the door to the dais, three tiles wide: its north end, a straight middle that repeats, its south end at the door. Deep violet, frayed and worn through in places — the king has been dead a long time. |
| `assets/source/halls/throne-dais.png` | 5 × 2 tiles | Steps up to the throne across the north wall, under where the delivered `throne_empty` / `throne_seated` stands. |
| `assets/source/halls/throne-column.png` | 2 × 4 tiles | One gothic column seen top-down 3/4: its 2 × 2 footprint on the floor, the shaft rising above it into the wall's dark. Solid. Drawn once; the game places it four times. |
| `assets/source/halls/throne-banners.png` | 3 × 1, each 2 × 3 tiles | Torn royal banners hung on the north wall face either side of the throne: the crown device on violet, one intact, one torn, one hanging by a corner. |
| `assets/source/halls/throne-candelabra.png` | 2 × 1, each 1 × 2 tiles | A tall iron candelabrum, two frames of candle flicker. Stands against the north wall beside the dais, not on the floor of the fight. |
| `assets/source/halls/throne-wall.png` | the wall autotile set | The dungeon's wall set redrawn in the hall's stone, if the plain walls fight the new floor. Same frame names with a `throne_` prefix. |

## H2. The merchant's hall — 25 × 13 cells

```
############+############
#.......................#
#.......................#
#..OO...............OO..#
#..OO...............OO..#
#.......M.......S.......#   M  the merchant   S  the smith  (their stalls exist)
+.......................+
#.......................#
#...........F...........#   F  the fountain (exists)
#..OO...............OO..#
#..OO...............OO..#
#.......................#
############+############
```

| File | Size | What |
|---|---|---|
| `assets/source/halls/market-floor.png` | 4 × 1 tiles | Warmer, worn flagstones with straw and old wax in the joins: a place people stop in. |
| `assets/source/halls/market-rugs.png` | 2 × 1, each 3 × 2 tiles | A rug under each stall, laid flat, patterned, edges curled. |
| `assets/source/halls/market-column.png` | 2 × 4 tiles | A column like the throne hall's, plainer, with a lantern hung on its south face (two frames of flame). Solid. |
| `assets/source/halls/market-dressing.png` | 6 × 1 tiles | Flat floor dressing scattered round the walls, never in the lanes between the doors: a coiled rope, dropped coins, a chalk price mark, a rolled map, candle stubs, a bedroll. |

## H3. Acceptance

- The throne hall and the merchant's hall read as two different places from each
  other and from every generated room, at a glance, in `?lab=boss` and in a shop.
- Every telegraph (`?lab=boss`: slam, quake, chain sweep, dashcut) stays readable
  over the throne hall's floor and carpet.
- Only the columns and the dais read as solid; everything else as floor.
- `pnpm assets:check` passes; hard alpha, the palette's value band.
