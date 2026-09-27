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

/*
 * **Each depth is a kind of ground, not only a kind of wall** (the depths'
 * gameplay identity). The three depths were three skins over one room: a
 * flooded catacomb could stand spikes and dry grass, and the burnt undercroft
 * ice. So the floor features a depth may offer are narrowed to the ones it is
 * made of, and the Director chooses among those as it always has (doc 002:
 * code narrows what is legal, the Director judges what fits). Cover and the
 * turret's plinth are the dungeon's everywhere.
 *
 * - **ossuary**: dry crypt — trap spikes in the flags and dead weeds that burn.
 * - **flooded**: standing water — poison pools and slick, frozen ground.
 * - **furnace**: the burnt undercroft — spikes, tinder that catches, and the
 *   lava channels once their tiles are drawn (`UNDRAWN` in features.ts).
 */
export const BIOME_GROUND: Readonly<Record<Biome, readonly string[]>> = {
  ossuary: ["spike_strip", "grass_patch"],
  flooded: ["poison_pool", "ice_patch"],
  furnace: ["spike_strip", "grass_patch", "lava_channel"],
};

/** The features that are ground: what a depth is made of, and so what it narrows. */
export const GROUND_FEATURES: ReadonlySet<string> = new Set([
  "spike_strip", "poison_pool", "ice_patch", "lava_channel", "grass_patch",
]);

/** Whether a feature may stand in this depth: any that is not ground, and the ground the depth is made of. */
export function groundFits(biome: Biome | undefined, featureId: string): boolean {
  return !biome || !GROUND_FEATURES.has(featureId) || BIOME_GROUND[biome].includes(featureId);
}

/**
 * **A depth's light** (the room mood's temperature). The flooded catacombs are
 * cold and the burnt undercroft warm, whatever else a room is, so the music's
 * warm and cold versions (doc 018) and the colour filter both say which depth
 * the player is in. The ossuary is left to the Director.
 */
export const BIOME_TEMPERATURE: Readonly<Partial<Record<Biome, "warm" | "cold">>> = {
  flooded: "cold",
  furnace: "warm",
};
