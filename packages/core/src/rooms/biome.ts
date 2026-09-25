/**
 * **The run's three depths** (art order `docs/art-workorder-biomes.md`).
 *
 * Every fighting room was the same flagstones and the same walls, told apart
 * only by the mood's colour filter and a scattering of decals, so a run of
 * fifteen rooms read as one room fifteen times. The run is now three places,
 * one after another as it goes down: the ossuary under the crypt, the
 * flooded catacombs below it, and the burnt undercroft over the king's hall.
 * Each has its own floor, walls, floor patches, decals and wall lights; the
 * renderer draws a room from its depth's sheet where the sheet has the
 * frame, and from the common one where it does not, so a depth that is not
 * yet drawn is simply the dungeon it was.
 *
 * The depth is set by the room's place in the run, not chosen: it is the
 * run's shape, as the shop and the boss are. What is chosen within it — which
 * patches and lights a room gets — comes from the room's own seed.
 */
export const BIOMES = ["ossuary", "flooded", "furnace"] as const;
export type Biome = (typeof BIOMES)[number];

/** The first room of each depth; the boss's hall and the merchant's are drawn as themselves. */
const BIOME_FROM: readonly (readonly [number, Biome])[] = [[1, "ossuary"], [6, "flooded"], [11, "furnace"]];

export function biomeFor(roomIndex: number): Biome {
  let biome: Biome = "ossuary";
  for (const [from, b] of BIOME_FROM) if (roomIndex >= from) biome = b;
  return biome;
}
