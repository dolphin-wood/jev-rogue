/** The complete, authoritative list of sprite frames the game expects. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { SUBSPECIES_ART } from "./subspecies.ts";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The art keeps the hard-edged pixel look of the shipped reference without
 * an indexed-palette restriction. It is authored at twice the world
 * resolution and the renderer draws into a 2x surface.
 * Simulation numbers are untouched: a 64px sprite still occupies one 32-unit
 * world tile.
 *
 * The earlier 16px and 32px classes lost the art. Measured on one character
 * cell of the delivery: 82 opaque samples at 16px, 323 at 32px, 1310 at 64px.
 * Detail needs pixels, and this art has detail worth keeping.
 */
export const ART_SCALE = 2;

export type SizeClass = "s64" | "s96" | "s256" | "s32";

/** World size a sprite class occupies, for the renderer and for collision. */
export const WORLD_SIZE: Record<SizeClass, number> = { s64: 32, s96: 48, s256: 128, s32: 16 };

/**
 * Delivered size of each class in art pixels: its world size at `ART_SCALE`.
 * The class names are the sizes at 2. Most sources are pixel art drawn on
 * this grid and delivered at four times it, so 2 is the art's own resolution:
 * exported at 3 they were resampled and their pixels came out uneven. How
 * large the art is on screen is the view's business — whole device pixels to
 * an art pixel (doc 008) — not the export's.
 */
export const SIZE: Record<SizeClass, number> = {
  s64: WORLD_SIZE.s64 * ART_SCALE, s96: WORLD_SIZE.s96 * ART_SCALE,
  s256: WORLD_SIZE.s256 * ART_SCALE, s32: WORLD_SIZE.s32 * ART_SCALE,
};

/** How many two-by-two drawings the two-thirds-grain floor has. */
export const MID_FLOOR_VARIANTS = 3;

/** An art size given at the first scale, 2, at the current one. */
export const atScale = (px: number): number => Math.round((px * ART_SCALE) / 2);

/** Entity sprites must be centred on their collision circle; decor need not be. */
export interface FrameSpec {
  name: string;
  size: SizeClass;
  /** Optional non-square delivery dimensions. */
  width?: number;
  height?: number;
  centred: boolean;
  /** Frames allowed to use the reserved `hot` slot. */
  mayUseHot: boolean;
}

const FACINGS = ["s", "n", "w"] as const;

function entity(
  base: string,
  size: SizeClass,
  opts: { facings: boolean; telegraph: boolean },
): FrameSpec[] {
  const out: FrameSpec[] = [];
  const parts = opts.facings ? FACINGS : ([null] as const);
  for (const f of parts) {
    const prefix = f ? `${base}_${f}` : base;
    for (const frame of ["idle0", "idle1"])
      out.push({ name: `${prefix}_${frame}`, size, centred: true, mayUseHot: false });
    if (opts.telegraph)
      out.push({ name: `${prefix}_tele`, size, centred: true, mayUseHot: true });
  }
  return out;
}

function list(names: string[], size: SizeClass, centred: boolean, hot = false): FrameSpec[] {
  return names.map((name) => ({ name, size, centred, mayUseHot: hot }));
}

/** The shipped 115-frame atlas, retained so the work-order diff stays reproducible. */
export const LEGACY_MANIFEST: FrameSpec[] = [
  // player: four facings via three drawings, e mirrors w
  ...FACINGS.flatMap((f) =>
    ["0", "1"].map((n) => ({
      name: `player_${f}_${n}`,
      size: "s64" as SizeClass,
      centred: true,
      mayUseHot: false,
    })),
  ),

  // enemies that chase or aim need facings; the turret is radially symmetric
  ...entity("enemy_rusher", "s64", { facings: true, telegraph: false }),
  ...entity("enemy_shooter", "s64", { facings: true, telegraph: true }),
  ...entity("enemy_orbiter", "s64", { facings: true, telegraph: true }),
  ...entity("enemy_turret", "s64", { facings: false, telegraph: true }),
  ...entity("enemy_tank", "s96", { facings: true, telegraph: true }),
  ...entity("enemy_summoner", "s96", { facings: true, telegraph: true }),

  // boss: radially symmetric, three phases
  ...["p1", "p2", "p3"].flatMap((p) =>
    entity(`boss_${p}`, "s256", { facings: false, telegraph: true }),
  ),

  // bullets
  ...["player_a", "player_b", "player_c"].flatMap((v) =>
    list([`bullet_${v}_0`, `bullet_${v}_1`], "s32", true),
  ),
  ...["enemy_a", "enemy_b"].flatMap((v) =>
    list([`bullet_${v}_0`, `bullet_${v}_1`], "s32", true, true),
  ),

  // terrain
  ...list(["tile_floor_0", "tile_floor_1", "tile_floor_2", "tile_floor_3"], "s64", false),
  ...list(
    ["c", "n", "e", "s", "w", "ne", "nw", "se", "sw"].map((d) => `tile_wall_${d}`),
    "s64",
    false,
  ),
  ...list(
    ["spike", "poison", "ice", "crumble"].flatMap((h) => [`hazard_${h}_0`, `hazard_${h}_1`]),
    "s64",
    false,
  ),
  ...list(
    ["pillar", "brazier", "mirror", "manawell", "chest", "shop", "restfire"].flatMap((p) => [
      `prop_${p}_0`,
      `prop_${p}_1`,
    ]),
    "s64",
    true,
  ),

  // ui
  ...list(
    ["combat", "elite", "treasure", "shop", "rest", "boss"].map((d) => `icon_door_${d}`),
    "s64",
    true,
  ),
  ...list(["ui_heart_full", "ui_heart_empty"], "s64", true, true),
  ...list(["ui_mana_pip", "ui_card_frame"], "s64", false),
];

const frame = (
  name: string,
  size: SizeClass,
  centred = true,
  mayUseHot = false,
  dimensions?: readonly [number, number],
): FrameSpec => ({ name, size, centred, mayUseHot, ...(dimensions ? { width: atScale(dimensions[0]), height: atScale(dimensions[1]) } : {}) });

/** The player's walk cycle, composed from the player's sprite model (doc 016). */
export const PLAYER_WALK_FRAMES = 8;

/**
 * The frames every sprite model delivers, read from the models themselves.
 *
 * A model's `anims.json` already names each atlas frame it composes, and its
 * `rig.json` gives the size the frame is composed at, so listing them again
 * here could only go out of date. Read directly rather than through
 * `models.ts`, because the manifest is what `models.ts` is checked against and
 * a cycle between the two would make each the other's source of truth.
 */
function modelManifest(): FrameSpec[] {
  const dir = fileURLToPath(new URL("../../../../assets/models/", import.meta.url));
  if (!existsSync(dir)) return [];
  const out: FrameSpec[] = [];
  for (const body of readdirSync(dir).sort()) {
    // B8 ships the Crypt King as painted full frames; its abandoned rig must
    // not append swordless model poses to the production atlas.
    if (/^boss_p[123]$/.test(body)) continue;
    const rigPath = join(dir, body, "rig.json");
    const animsPath = join(dir, body, "anims.json");
    if (!existsSync(rigPath) || !existsSync(animsPath)) continue;
    const rig = JSON.parse(readFileSync(rigPath, "utf8")) as { size: [number, number] };
    const anims = JSON.parse(readFileSync(animsPath, "utf8")) as { facings: string[]; frames: Record<string, string> };
    const size = (Object.entries(SIZE).find(([, px]) => px === rig.size[0])?.[0] ?? "s64") as SizeClass;
    for (const template of Object.keys(anims.frames))
      for (const f of template.includes("{f}") ? anims.facings : [""])
        // A telegraph frame is the one enemy drawing allowed the reserved
        // magenta, as the delivered telegraphs were.
        out.push(frame(template.replace("{f}", f), size, true, /tele|telegraph/.test(template)));
  }
  return out;
}

/** Consolidated art-request revision: the authoritative 896-frame runtime atlas. */
/* ------------------------------ marks (019) ------------------------------- */

/**
 * The frame a subspecies' mark is drawn as: a small sprite hung at the base
 * body's `mark` anchor, one per facing (doc 019, "Art, and what it costs").
 *
 * The measured alternative is why this is a frame rather than a model. A
 * walking body carries about 90 atlas frames and an emplacement 24, so
 * thirteen subspecies packed as their own models is roughly 980 frames —
 * **+58% on the character half of an atlas already packed 4096 wide because
 * the roster took it past 4300 rows at 2048**. Thirteen marks over three
 * facings is 39, about 2%, and the palette does the rest at runtime
 * (`game/src/fx/palette-swap.ts`).
 *
 * `s32` is 16 world pixels, which is a horn, a plume or a lens against a
 * 32-unit body: the mark has to change the silhouette at a glance without
 * becoming a second body. It is `centred: false`, because what is placed is
 * the anchor point, not the drawing's middle.
 */
export const MARK_SIZE: SizeClass = "s32";

export const markFrame = (id: string, facing: string): string => `mark_${id}_${facing}`;

/**
 * Frame specs for a set of subspecies marks.
 *
 * **Deliberately not spliced into `MANIFEST`.** Until the marks are drawn, a
 * row here would fail the manifest check and change the packed atlas; phase 2
 * adds `...markFrameSpecs(SUBSPECIES_IDS)` to the list in one line, once the
 * drawings exist.
 */
export function markFrameSpecs(ids: readonly string[]): FrameSpec[] {
  return ids.flatMap((id) =>
    FACINGS.map((f) => ({ name: markFrame(id, f), size: MARK_SIZE, centred: false, mayUseHot: false })));
}

export const MANIFEST: FrameSpec[] = (() => {
  const out: FrameSpec[] = [];
  // The subspecies marks (doc 019): 39 frames, against the 980 a model apiece
  // would have cost. `art.ts` draws them; the rigs carry where they hang.
  out.push(...markFrameSpecs(SUBSPECIES_ART.map((a) => a.id)));

  for (const f of FACINGS) {
    for (let i = 0; i < 4; i++) out.push(frame(`player_${f}_idle${i}`, "s64"));
    for (let i = 0; i < PLAYER_WALK_FRAMES; i++) out.push(frame(`player_${f}_walk${i}`, "s64"));
    // strike and slash are the cut's keys between the windup and the follow
    // through, recover the way back, cast the off hand raised; the player's
    // model composes them (doc 016).
    for (const pose of ["windup", "strike", "slash", "follow", "recover", "cast", "dash"])
      out.push(frame(`player_${f}_${pose}`, "s64"));
    out.push(frame(`player_${f}_hurt0`, "s64"), frame(`player_${f}_hurt1`, "s64"));
  }

  // The grip, not the asymmetric silhouette, sits at frame centre.
  out.push(frame("weapon_player_sword", "s64", false));
  /*
   * The staff as its own sprite, cut from the player's model, its **grip** at
   * the frame's centre so the renderer can turn it about the hand. Through a
   * swing the staff follows the cut rather than the drawn keys, because five
   * keys cannot follow a continuous aim (doc 016); the same drawing serves
   * the idle, where the model poses it.
   */
  out.push(frame("weapon_player_staff", "s96", false));
  /*
   * The closed fist that holds it, its grip at the frame's centre. One
   * drawing for every key and every facing, painted over the shaft so the
   * hand wraps it at whatever angle the staff is turned to.
   */
  out.push(frame("weapon_player_fist", "s32", false));
  for (let i = 0; i < 3; i++) out.push(frame(`vfx_impact_${i}`, "s64"));
  for (let i = 0; i < 3; i++) out.push(frame(`vfx_bolt_${i}`, "s64", false, false, [64, 128]));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_offhand_${i}`, "s64"));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_groundfire_${i}`, "s64", false));
  // The amber joint, rather than the asymmetric claw silhouette, is centred.
  out.push(frame("weapon_enemy_rusher", "s64", false));

  const enemySize = (kind: string): SizeClass => kind === "tank" || kind === "summoner" ? "s96" : "s64";
  for (const kind of ["rusher", "tank"]) for (const f of FACINGS)
    for (const pose of ["dormant", "idle0", "idle1", "windup", "lunge"])
      out.push(frame(`enemy_${kind}_${f}_${pose}`, enemySize(kind)));
  for (const kind of ["rusher", "tank", "shooter", "summoner"]) for (const f of FACINGS)
    for (let i = 0; i < 4; i++) out.push(frame(`enemy_${kind}_${f}_walk${i}`, enemySize(kind)));
  for (const f of FACINGS) for (let i = 0; i < 4; i++)
    out.push(frame(`enemy_orbiter_${f}_walk${i}`, "s64"));
  for (const kind of ["shooter", "orbiter", "summoner"]) for (const f of FACINGS)
    for (const pose of ["dormant", "idle0", "idle1", "tele"])
      out.push(frame(`enemy_${kind}_${f}_${pose}`, enemySize(kind), true, pose === "tele"));
  for (const kind of ["rusher", "shooter", "orbiter", "summoner", "tank"]) for (const f of FACINGS)
    out.push(frame(`enemy_${kind}_${f}_dormant1`, enemySize(kind)));
  for (const kind of ["rusher", "shooter", "orbiter", "summoner"]) for (const f of FACINGS)
    out.push(frame(`enemy_${kind}_${f}_hit0`, enemySize(kind)), frame(`enemy_${kind}_${f}_hit1`, enemySize(kind)));
  for (const f of FACINGS) {
    out.push(frame(`enemy_tank_${f}_tele`, "s96", true, true));
    out.push(frame(`enemy_tank_${f}_hit0`, "s96"), frame(`enemy_tank_${f}_hit1`, "s96"));
  }
  for (const pose of ["dormant", "dormant1", "idle0", "idle1", "tele", "tele1", "hit0", "hit1"])
    out.push(frame(`enemy_turret_${pose}`, "s64", true, pose.startsWith("tele")));
  for (const kind of ["rusher", "shooter", "turret", "orbiter", "tank", "summoner"])
    out.push(frame(`enemy_${kind}_death`, enemySize(kind)));

  // Part A enemy additions. Lancer spikes and the sentinel barrel are
  // independent sprites because gameplay moves/rotates them separately from
  // their bodies.
  for (const f of FACINGS) {
    for (const pose of ["idle0", "idle1", "walk0", "walk1", "walk2", "walk3", "dormant", "dormant1", "hit0", "hit1", "windup", "lunge"])
      out.push(frame(`enemy_lancer_${f}_${pose}`, "s64"));
  }
  out.push(frame("enemy_lancer_death", "s64"), frame("enemy_lancer_burst", "s64"));
  for (const pose of ["idle0", "idle1", "dormant", "dormant1", "hit0", "hit1", "tele", "tele1", "death"])
    out.push(frame(`enemy_sentinel_${pose}`, "s64", true, pose.startsWith("tele")));
  out.push(frame("vfx_spike_bone", "s32", false, false, [16, 6]));
  out.push(frame("vfx_spike_gold", "s32", false, false, [16, 6]));
  out.push(frame("weapon_enemy_sentinel_barrel", "s64", false));
  out.push(frame("weapon_enemy_tank", "s64", false));

  for (const kind of ["pot", "crate", "urn"]) for (let i = 0; i < 3; i++)
    out.push(frame(`prop_break_${kind}_${i}`, "s64"));
  for (const f of FACINGS) for (const pose of ["idle0", "idle1", "attack"])
    out.push(frame(`pet_${f}_${pose}`, "s64"));
  for (const f of FACINGS) for (let i = 0; i < 4; i++) out.push(frame(`pet_${f}_walk${i}`, "s64"));
  for (const vendor of ["merchant", "blacksmith"]) for (let i = 0; i < 2; i++)
    out.push(frame(`prop_${vendor}_${i}`, "s64"));
  /*
   * The fountain (doc 003): three frames of moving water while it is full,
   * and one still frame once it has been drunk. Drawn as text under
   * `assets/effects`, like the ground eruptions.
   */
  for (let i = 0; i < 3; i++) out.push(frame(`prop_fountain_${i}`, "s64"));
  out.push(frame("prop_fountain_dry_0", "s64"));

  for (let i = 0; i < 8; i++) out.push(frame(`tile_floor_${i}`, "s64", false));
  // The floor and the solid wall at half their grain, four half-size drawings
  // to a tile, for trying the room at a finer scale (`fineGrain` in art.ts).
  for (let i = 0; i < 8; i++) out.push(frame(`tile_floor_fine_${i}`, "s64", false));
  // The floor at two thirds of its grain: three stones to two tiles, a
  // two-by-two block of tiles cut from one drawing (`midGrain` in art.ts).
  for (let v = 0; v < MID_FLOOR_VARIANTS; v++) for (let q = 0; q < 4; q++) out.push(frame(`tile_floor_mid_${v}_${q}`, "s64", false));
  // The drain's grate alone, to lay over a finer floor (`drainGrate` in art.ts).
  out.push(frame("tile_floor_drain_grate", "s64", false));
  out.push(frame("tile_wall_solid_fine", "s64", false));
  for (const c of ["solid", "n", "e", "s", "w", "ne", "es", "sw", "wn", "ns", "ew", "nes", "esw", "swn", "wne", "nesw"])
    out.push(frame(`tile_wall_${c}`, "s64", false));
  // The inside of an L: the cap square a wall cell needs at a corner where its
  // two neighbours are walls and the floor is on the diagonal.
  for (const c of ["ne", "es", "sw", "wn"]) out.push(frame(`tile_wall_inner_${c}`, "s64", false));

  // Painted depth materials. Each depth's source sheet carries all named
  // cells, including the corner overlays used by the wall autotiler.
  for (const id of ["ossuary", "flooded", "furnace"]) {
    for (let i = 0; i < 4; i++) out.push(frame(`tile_${id}_floor_${i}`, "s64", false));
    for (const c of ["solid", "n", "e", "s", "w", "ne", "es", "sw", "wn", "ns", "ew", "nes", "esw", "swn", "wne", "nesw"])
      out.push(frame(`tile_${id}_wall_${c}`, "s64", false));
    for (const c of ["ne", "es", "sw", "wn"]) out.push(frame(`tile_${id}_wall_inner_${c}`, "s64", false));
    for (let i = 0; i < 8; i++) out.push(frame(`deco_${id}_${i}`, "s64", false));
    for (let i = 0; i < 3; i++) out.push(frame(`patch_${id}_${i}`, "s64", false, false, [128, 128]));
    out.push(frame(`prop_${id}_sconce`, "s64", false, false, [64, 128]));
  }

  out.push(frame("prop_portal_shut_0", "s64"), frame("prop_portal_shut_1", "s64"));
  for (let i = 0; i < 4; i++) out.push(frame(`prop_portal_open_${i}`, "s64"));
  for (const kind of ["spell", "affix", "gold"]) for (let i = 0; i < 2; i++)
    out.push(frame(`prop_reward_${kind}_${i}`, "s64"));
  for (const kind of ["heart", "coin"]) for (let i = 0; i < 2; i++)
    out.push(frame(`pickup_${kind}_${i}`, "s32"));
  for (const d of ["crack_0", "crack_1", "drain_0", "drain_1", "stain_0", "stain_1", "rubble_0", "rubble_1", "moss_0", "moss_1", "scorch", "bones"])
    out.push(frame(`deco_${d}`, "s64", false));

  for (const p of [1, 2, 3]) for (const pose of ["idle0", "idle1", "ceremony0", "ceremony1", "tele", "tele1"])
    out.push(frame(`boss_p${p}_${pose}`, "s256", true, pose.startsWith("tele")));
  for (const p of [1, 2, 3]) for (const pose of [
    "windup", "commit", "follow", "hit0", "hit1", "leap_gather", "leap_air",
    "slam", "slam_lift", "slam_drive", "hook", "backhand",
  ])
    out.push(frame(`boss_p${p}_${pose}`, "s256", true));
  for (const p of [1, 2, 3]) for (const pose of [
    "walk0", "walk1", "walk2", "walk3", "walk4", "walk5",
    "sweep_wind", "sweep_enter", "sweep_cross", "sweep_mid", "sweep_cut", "sweep_recover", "sweep_reset",
    "cleave_raise", "cleave_fall", "cleave_cut", "cleave_hold", "cleave_stuck",
    "dash_cut", "dash_skid", "recover",
    "chain_wind", "chain_cast", "chain_follow", "hook_wind", "hook_reel", "stagger0", "stagger1",
  ]) out.push(frame(`boss_p${p}_${pose}`, "s256", true));
  /*
   * **The wide cuts** (`assets/source/melee/boss-king/wide/`): 336 art px
   * cells, because a greatsword swung round the body does not fit 256. The
   * string's front and return sweeps from phase II, and the vertical
   * finisher in every phase; the renderer lays them on their own pivot
   * (`anchors.json`), the feet.
   */
  for (const p of [1, 2, 3]) for (const pose of [
    ...(p >= 2 ? ["sweep_front_wind", "sweep_front_enter", "sweep_front_mid", "sweep_front_cut", "sweep_back_wind", "sweep_back_cross", "sweep_back_cut"] : []),
    "cleave_front_raise", "cleave_front_fall", "cleave_front_cut", "cleave_front_follow",
  ]) out.push(frame(`boss_p${p}_${pose}`, "s256", true, false, [336, 336]));
  // Lightning invocation needs a taller cell to keep the raised sword at the
  // same body scale as the other Boss poses.
  for (const p of [1, 2, 3]) out.push(frame(`boss_p${p}_storm`, "s256", true, false, [384, 384]));
  out.push(frame("boss_unbind_1", "s256", false), frame("boss_unbind_2", "s256", false));
  // The same poses with the pieces coming off him cut away, held through the roar
  // while the thrown fragments (`boss_debris_*`) fly on their own.
  out.push(frame("boss_unbind_1_bare", "s256", false), frame("boss_unbind_2_bare", "s256", false));
  for (const piece of ["pauldron_l", "pauldron_r", "helm", "breastplate_l", "breastplate_r", "cape"])
    out.push(frame(`boss_debris_${piece}`, "s64", false));
  for (const piece of ["link_face", "link_edge", "hook_head"])
    out.push(frame(`boss_chain_${piece}`, "s64", false));
  // Story panels share a ground line; a collapsed body is intentionally low
  // in its cell, so visual-bounds centring is not an appropriate invariant.
  out.push(frame("boss_throne_seated", "s256", false), frame("boss_throne_empty", "s256", false));
  for (const pose of ["goblet", "notice", "throw", "rise"])
    out.push(frame(`boss_throne_${pose}`, "s256", false));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_goblet_${i}`, "s64", false));
  out.push(frame("deco_wine_splash", "s64", false, false, [128, 64]));
  for (let i = 0; i < 3; i++) out.push(frame(`boss_death${i}`, "s256", false));
  for (const kind of ["player_a", "player_b", "player_c"])
    for (let i = 0; i < 2; i++) out.push(frame(`bullet_${kind}_${i}`, "s32"));
  for (const kind of ["enemy_a", "enemy_b"])
    for (let i = 0; i < 2; i++) out.push(frame(`bullet_${kind}_${i}`, "s32", true, true));
  for (const kind of ["spike", "poison", "ice"])
    for (let i = 0; i < 2; i++) out.push(frame(`hazard_${kind}_${i}`, "s64", false));
  for (const kind of ["pillar", "brazier", "mirror", "manawell", "chest", "shop", "restfire"])
    for (let i = 0; i < 2; i++) {
      // Pillars rise two tiles above their one-tile footprint. The mana font
      // also needs a larger canvas so its basin can match its collision body
      // without clipping the raised bowl and cyan flame.
      const dimensions: readonly [number, number] | undefined = kind === "pillar" ? [64, 128]
        : kind === "manawell" ? [96, 96]
        : undefined;
      // A tall pillar is registered to the floor by its bottom edge, not to a
      // collision circle at the centre of its non-square canvas.
      out.push(frame(`prop_${kind}_${i}`, "s64", kind !== "pillar", false, dimensions));
    }
  for (const kind of ["combat", "elite", "treasure", "shop", "rest", "boss"])
    out.push(frame(`icon_door_${kind}`, "s64"));
  for (const id of [
    "magic_bolt", "shock_arc", "spark_spray", "stone_shard", "ember_dart", "frost_needle",
    "venom_spit", "arc_lance", "scatter_shot", "cinder_burst", "glacier_spike",
    "void_orb", "plague_bloom",
  ]) out.push(frame(`icon_${id}`, "s32", true, false, [16, 16]));
  for (const id of ["spirit_blades", "wildfire_field", "stone_ward", "blink_strike", "void_maw", "spirit_ally"])
    out.push(frame(`icon_${id}`, "s32", true, false, [16, 16]));
  // Drawn as text (`assets/icons`): the role spells and the ground eruptions.
  for (const id of ["frost_nova", "seeker_swarm", "fault_line", "earth_spikes", "flame_pillars", "cinder_geysers"])
    out.push(frame(`icon_${id}`, "s32", true, false, [16, 16]));
  // Drawn as text too, until they have art: the spells on doc 006's newer options.
  for (const id of ["mana_darts", "arcane_cannon", "doom_sigil", "frozen_orb", "contagion", "meteor", "quake_ring", "leap_slam"])
    out.push(frame(`icon_${id}`, "s32", true, false, [16, 16]));
  // And the spells on doc 006's newer shapes: the orb, the boomerang, the enchant, the stance, the trail, the cloud.
  for (const id of ["ball_lightning", "returning_edge", "crescent_edge", "counter_stance", "cinder_stride", "toxic_cloud", "dash_slash"])
    out.push(frame(`icon_${id}`, "s32", true, false, [16, 16]));
  // And the second spells of four shapes.
  for (const id of ["blizzard", "storm_totem", "blade_storm", "blade_recall", "blade_rift", "mortar", "void_ray"])
    out.push(frame(`icon_${id}`, "s32", true, false, [16, 16]));
  for (const id of [
    "fork", "chain", "brand", "harvest", "echo", "bloom", "shatter",
    "repeat", "scatter", "ward", "retort", "slipstream",
  ]) out.push(frame(`icon_affix_${id}`, "s32", true, false, [16, 16]));
  out.push(frame("icon_affix_resonance", "s32", true, false, [16, 16]));
  // Drawn as text (`assets/icons`): the run's own affixes.
  for (const id of ["momentum", "undertow", "finale"]) out.push(frame(`icon_affix_${id}`, "s32", true, false, [16, 16]));
  // And the second expansion's, drawn as text the same way.
  for (const id of [
    "repulse", "parting", "aftershock", "whirl", "spillover", "drag", "lodestar", "intercept", "cull", "overload", "slam", "afterimage",
    // And the ones that had none, drawn at last: the infusions, the trajectories, Expanse and Linger.
    "kindle", "rime", "blight", "pierce", "seek", "ricochet", "expanse", "linger",
  ])
    out.push(frame(`icon_affix_${id}`, "s32", true, false, [16, 16]));
  for (const id of [
    "fleet", "second_wind", "long_stride", "vigour", "steady_nerve",
    "deep_well", "quickening", "leeching_edge", "keen_edge", "long_reach", "swift_hand",
  ]) out.push(frame(`icon_stat_${id}`, "s32", true, false, [16, 16]));
  out.push(frame("icon_stat_wrath", "s32", true, false, [16, 16]));
  // The spell schools, drawn as text: the marks a spell door wears for the cards behind it.
  for (const id of ["flame", "frost", "venom", "storm", "void", "spirit", "stone"])
    out.push(frame(`icon_school_${id}`, "s32", true, false, [16, 16]));
  for (const kind of ["stat", "spell", "affix", "gold"])
    out.push(frame(`icon_reward_${kind}`, "s32", true, false, [16, 16]));
  out.push(frame("ui_elite_badge", "s32", true, false, [16, 16]));
  /*
   * The ground eruptions (`drawEruptions`), drawn as text under
   * `assets/effects`. Each is bottom-anchored on its cell rather than centred
   * on it, so the floor line sits at the foot of the frame and the spike or
   * column stands above it. Two spike variants, so a line of five cells is
   * not the same drawing stamped five times.
   */
  for (const variant of ["a", "b"]) for (let i = 0; i < 4; i++)
    out.push(frame(`vfx_earth_spike_${variant}${i}`, "s64", false, false, [48, 48]));
  for (let i = 0; i < 2; i++) out.push(frame(`vfx_earth_crack_${i}`, "s32", false, false, [32, 16]));
  for (let i = 0; i < 6; i++) out.push(frame(`vfx_flame_pillar_${i}`, "s64", false, false, [48, 80]));
  for (let i = 0; i < 5; i++) out.push(frame(`vfx_cinder_geyser_${i}`, "s64", false, false, [48, 64]));
  for (const phase of ["launch", "fly", "dissolve"] as const)
    for (let i = 0; i < (phase === "launch" ? 2 : 4); i++) out.push(frame(`vfx_crescent_wave_${phase}_${i}`, "s256", false, false, [96, 192]));
  for (let i = 0; i < 4; i++) {
    out.push(frame(`vfx_meteor_rock_${i}`, "s32"));
    // The stone school's rock, tumbling: Stone Shard's chunk at 12 world px, Mortar's shell at 16.
    out.push(frame(`vfx_stone_chunk_${i}`, "s32", false, false, [24, 24]));
    out.push(frame(`vfx_stone_shell_${i}`, "s32"));
    // Mortar's landing: the meteor's impact painting in the stone palette, the fire turned to dust.
    out.push(frame(`vfx_stone_impact_${i}`, "s256", false, false, [128, 128]));
    out.push(frame(`vfx_frost_orb_${i}`, "s32"));
    // Half again the size it was drawn at: at 16 px it read as a spark, not as the orb the spell is.
    out.push(frame(`vfx_ball_lightning_${i}`, "s64", true, false, [48, 48]));
    // Storm Totem: a plinth, a bronze pole and a gold orb between two prongs, 20 x 32 world px.
    out.push(frame(`vfx_storm_totem_${i}`, "s64", false, false, [40, 64]));
    out.push(frame(`vfx_arc_seg_${i}`, "s32", false, false, [32, 16]));
    out.push(frame(`vfx_doom_burst_${i}`, "s96"));
    out.push(frame(`vfx_vortex_${i}`, "s256", false, false, [128, 128]));
    out.push(frame(`vfx_vortex_gather_${i}`, "s256", false, false, [128, 128]));
    out.push(frame(`vfx_landing_dust_${i}`, "s256", false, false, [128, 64]));
    out.push(frame(`vfx_gas_puff_${i}`, "s32"));
  }
  for (let i = 0; i < 5; i++) {
    out.push(frame(`vfx_meteor_impact_${i}`, "s256", false, false, [128, 128]));
    out.push(frame(`vfx_doom_rune_${i}`, "s32"));
    out.push(frame(`vfx_guard_answer_${i}`, "s256", false, false, [128, 128]));
  }
  for (let i = 0; i < 2; i++) {
    out.push(frame(`vfx_arc_cap_${i}`, "s32", false, false, [16, 16]));
    out.push(frame(`vfx_contagion_glob_${i}`, "s32", false, false, [16, 16]));
  }
  out.push(frame("vfx_ward_0", "s32"), frame("vfx_ward_1", "s32"));
  out.push(frame("vfx_brand_mark", "s32", true, false, [16, 16]));
  out.push(frame("prop_reward_stat_0", "s64"));
  for (const id of ["npc_merchant", "npc_smith", "action_attack", "action_spin", "action_dodge"])
    out.push(frame(`icon_${id}`, "s32", true, false, [16, 16]));
  // The fountain's badge, over its head and on the portal that leads to it.
  out.push(frame("icon_npc_fountain", "s32", true, false, [16, 16]));
  for (const id of ["burn", "poison", "chill", "freeze", "stun", "stagger", "alert"])
    out.push(frame(`icon_status_${id}`, "s32", true, false, [16, 16]));
  out.push(frame("ui_shield", "s32", true, false, [16, 16]));
  for (const kind of ["rusher", "shooter", "turret", "orbiter", "summoner", "player"])
    out.push(frame(`shadow_${kind}`, "s64", false));
  out.push(frame("shadow_tank", "s96", false));
  out.push(frame("shadow_lancer", "s64", false), frame("shadow_sentinel", "s64", false));
  out.push(frame("shadow_boss_p1", "s256", false));
  out.push(frame("ui_heart_full", "s64"), frame("ui_heart_empty", "s64"));
  out.push(frame("ui_mana_pip", "s64", false), frame("ui_card_frame", "s64", false));

  // Expansion work order, Parts B-D.
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_rift_seg_${i}`, "s64", false));
  for (let i = 0; i < 2; i++) out.push(frame(`vfx_rift_cap_${i}`, "s64", false));
  for (let i = 0; i < 3; i++) out.push(frame(`vfx_rift_burst_${i}`, "s64", false));
  for (let i = 0; i < 2; i++) out.push(frame(`vfx_tether_seg_${i}`, "s64", false));
  for (let i = 0; i < 3; i++) out.push(frame(`vfx_tether_node_${i}`, "s64"));
  for (let i = 0; i < 3; i++) out.push(frame(`vfx_ward_aura_${i}`, "s64"));
  for (let i = 0; i < 3; i++) out.push(frame(`vfx_lob_shadow_${i}`, "s64"));
  for (let i = 0; i < 2; i++) out.push(frame(`vfx_lob_ring_${i}`, "s64"));
  for (const f of FACINGS) out.push(frame(`enemy_shooter_${f}_lob`, "s64"));
  out.push(frame("enemy_turret_telegraph_rift", "s64", true, true));
  out.push(frame("enemy_sentinel_telegraph_beam", "s64", true, true));
  for (const f of FACINGS) out.push(frame(`enemy_tank_${f}_cleave_shock`, "s96"));
  for (const f of FACINGS) out.push(frame(`enemy_summoner_${f}_tether`, "s96"));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_lob_shot_${i}`, "s32", true, true));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_beam_seg_${i}`, "s64", false));
  for (let i = 0; i < 2; i++) out.push(frame(`vfx_beam_cap_${i}`, "s64", false));

  // The expansion bodies' walks are drawn in the pipeline (`drawnWalk`), six frames a cycle.
  const EXPANSION_WALK = ["walk0", "walk1", "walk2", "walk3", "walk4", "walk5"];
  const facingFrames = (kind: string, size: SizeClass, poses: readonly string[]) => {
    for (const f of FACINGS) for (const pose of poses) out.push(frame(`enemy_${kind}_${f}_${pose}`, size));
  };
  facingFrames("warden", "s96", ["idle0", "idle1", ...EXPANSION_WALK, "dormant0", "dormant1", "windup", "lunge", "plant", "hit0", "hit1"]);
  out.push(frame("enemy_warden_death", "s96"));
  facingFrames("warden", "s96", ["throw_windup", "throw_release", "idle_bare0", "idle_bare1"]);
  out.push(frame("weapon_enemy_warden_shield", "s96", false, false, [64, 96]));
  facingFrames("bellringer", "s64", ["idle0", "idle1", ...EXPANSION_WALK, "dormant0", "dormant1", "windup", "cast", "field", "burst", "hit0", "hit1", "peal_windup", "peal_release"]);
  out.push(frame("enemy_bellringer_death", "s64"));
  for (const pose of ["dormant", "idle0", "idle1", "telegraph", "erupt", "hit0", "hit1", "death", "telegraph_walk"])
    out.push(frame(`enemy_rifter_${pose}`, "s64", true, pose.startsWith("telegraph")));

  for (let i = 0; i < 3; i++) out.push(frame(`vfx_plate_spark_${i}`, "s64"));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_plate_disc_${i}`, "s64"));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_slowfield_${i}`, "s64", false));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_peal_ring_${i}`, "s256", true, false, [128, 128]));
  for (let i = 0; i < 2; i++) out.push(frame(`vfx_mine_seed_${i}`, "s64"));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_mine_armed_${i}`, "s64", true, true));
  for (let i = 0; i < 3; i++) out.push(frame(`vfx_mine_burst_${i}`, "s64", true, true));

  facingFrames("snarecaster", "s64", ["idle0", "idle1", ...EXPANSION_WALK, "dormant0", "dormant1", "windup", "fire", "whip", "hit0", "hit1", "anchor_cast"]);
  out.push(frame("enemy_snarecaster_death", "s64"));
  facingFrames("delver", "s64", ["idle0", "idle1", ...EXPANSION_WALK, "dormant0", "dormant1", "burrow0", "burrow1", "emerge0", "emerge1", "windup", "lunge", "hit0", "hit1"]);
  out.push(frame("enemy_delver_death", "s64"));
  facingFrames("cinderling", "s64", ["idle0", "idle1", ...EXPANSION_WALK, "dormant0", "dormant1", "windup", "lob", "burning0", "burning1", "hit0", "hit1", "flare_windup"]);
  out.push(frame("enemy_cinderling_death", "s64"));
  facingFrames("sower", "s64", ["idle0", "idle1", "idle2", "idle3", "dormant0", "dormant1", "cast", "hit0", "hit1", "bloom_cast"]);
  out.push(frame("enemy_sower_death", "s64"));

  for (let i = 0; i < 2; i++) out.push(frame(`vfx_chain_seg_${i}`, "s64", false));
  for (let i = 0; i < 2; i++) out.push(frame(`vfx_chain_hook_${i}`, "s64", false));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_chain_live_${i}`, "s64", false));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_mound_${i}`, "s64", false));
  for (let i = 0; i < 3; i++) out.push(frame(`vfx_emerge_ring_${i}`, "s64"));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_coal_${i}`, "s32", true, true));

  // Every frame a sprite model composes, which is the model's own business
  // rather than a list kept beside it (doc 016): a body gains a pose by
  // gaining one in `anims.json`, and the atlas follows. Listed last, so a
  // name the sheets also deliver keeps the place it already had.
  const listed = new Set(out.map((f) => f.name));
  for (const f of modelManifest()) if (!listed.has(f.name)) { listed.add(f.name); out.push(f); }

  return out;
})();

export const PALETTE_SLOTS = {
  ink: "#0d0b1f",
  shadow: "#2b2d54",
  body: "#4a5480",
  light: "#8792b5",
  bone: "#e8e3d8",
  cool: "#3fa9f5",
  hot: "#ff3fa4",
  amber: "#f5a623",
} as const;

export type SlotName = keyof typeof PALETTE_SLOTS;
/**
 * Smooth art is not palette limited. What still matters is that the alpha
 * channel is edges only: the first delivery carried soft alpha across roughly
 * half its pixels, which reads as a washed-out sprite and blends badly.
 */
export const MAX_SOFT_ALPHA_SHARE = 0.25;

/** Hue degrees an edge pixel may sit from its frame's dominant hue. */
export const MAX_FRINGE_HUE_DEG = 60;
export const MAX_FRINGE_SHARE = 0.05;
/** Saturated edge pixels needed before the fringe rule can judge a frame. */
export const MIN_FRINGE_SAMPLE = 20;

/** Saturated share a frame needs before its dominant hue means anything. */
export const MIN_SATURATED_SHARE = 0.25;

/** The two bullet families must stay this far apart in hue. */
export const MIN_BULLET_HUE_SEPARATION_DEG = 90;
