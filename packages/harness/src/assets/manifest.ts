/** The complete, authoritative list of sprite frames the game expects. */

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

export const SIZE: Record<SizeClass, number> = { s64: 64, s96: 96, s256: 256, s32: 32 };

/** World size a sprite class occupies, for the renderer and for collision. */
export const WORLD_SIZE: Record<SizeClass, number> = { s64: 32, s96: 48, s256: 128, s32: 16 };

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
): FrameSpec => ({ name, size, centred, mayUseHot, ...(dimensions ? { width: dimensions[0], height: dimensions[1] } : {}) });

/** Consolidated art-request revision: the authoritative 896-frame runtime atlas. */
export const MANIFEST: FrameSpec[] = (() => {
  const out: FrameSpec[] = [];

  for (const f of FACINGS) {
    for (let i = 0; i < 4; i++) {
      out.push(frame(`player_${f}_idle${i}`, "s64"));
      out.push(frame(`player_${f}_walk${i}`, "s64"));
    }
    for (const pose of ["windup", "follow", "dash"])
      out.push(frame(`player_${f}_${pose}`, "s64"));
    out.push(frame(`player_${f}_hurt0`, "s64"), frame(`player_${f}_hurt1`, "s64"));
  }

  // The grip, not the asymmetric silhouette, sits at frame centre.
  out.push(frame("weapon_player_sword", "s64", false));
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

  for (let i = 0; i < 8; i++) out.push(frame(`tile_floor_${i}`, "s64", false));
  for (const c of ["solid", "n", "e", "s", "w", "ne", "es", "sw", "wn", "ns", "ew", "nes", "esw", "swn", "wne", "nesw"])
    out.push(frame(`tile_wall_${c}`, "s64", false));

  out.push(frame("prop_portal_shut_0", "s64"), frame("prop_portal_shut_1", "s64"));
  for (let i = 0; i < 4; i++) out.push(frame(`prop_portal_open_${i}`, "s64"));
  for (const kind of ["spell", "affix", "gold"]) for (let i = 0; i < 2; i++)
    out.push(frame(`prop_reward_${kind}_${i}`, "s64"));
  for (const kind of ["heart", "coin"]) for (let i = 0; i < 2; i++)
    out.push(frame(`pickup_${kind}_${i}`, "s32"));
  for (const d of ["crack_0", "crack_1", "drain_0", "drain_1", "stain_0", "stain_1", "rubble_0", "rubble_1", "moss_0", "moss_1", "scorch", "bones"])
    out.push(frame(`deco_${d}`, "s64", false));

  for (const p of [1, 2, 3]) for (const pose of ["idle0", "idle1", "tele"])
    out.push(frame(`boss_p${p}_${pose}`, "s256", true, pose === "tele"));
  for (const p of [1, 2, 3]) for (const pose of ["windup", "commit", "hit0", "hit1", "leap", "slam"])
    out.push(frame(`boss_p${p}_${pose}`, "s256"));
  for (const kind of ["player_a", "player_b", "player_c"])
    for (let i = 0; i < 2; i++) out.push(frame(`bullet_${kind}_${i}`, "s32"));
  for (const kind of ["enemy_a", "enemy_b"])
    for (let i = 0; i < 2; i++) out.push(frame(`bullet_${kind}_${i}`, "s32", true, true));
  for (const kind of ["spike", "poison", "ice", "crumble"])
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
    "void_orb", "plague_bloom", "impact_carrier", "fuse_carrier", "wall_carrier",
    "piercing_carrier", "mortar_carrier",
  ]) out.push(frame(`icon_${id}`, "s32", true, false, [16, 16]));
  for (const id of ["spirit_blades", "wildfire_field", "stone_ward", "blink_strike", "void_maw", "spirit_ally"])
    out.push(frame(`icon_${id}`, "s32", true, false, [16, 16]));
  for (const id of [
    "fork", "chain", "brand", "harvest", "echo", "bloom", "shatter",
    "repeat", "scatter", "ward", "retort", "slipstream",
  ]) out.push(frame(`icon_affix_${id}`, "s32", true, false, [16, 16]));
  out.push(frame("icon_affix_resonance", "s32", true, false, [16, 16]));
  for (const id of [
    "fleet", "second_wind", "long_stride", "vigour", "steady_nerve",
    "deep_well", "quickening", "leeching_edge", "keen_edge", "long_reach", "swift_hand",
  ]) out.push(frame(`icon_stat_${id}`, "s32", true, false, [16, 16]));
  out.push(frame("icon_stat_wrath", "s32", true, false, [16, 16]));
  for (const kind of ["stat", "spell", "affix", "gold"])
    out.push(frame(`icon_reward_${kind}`, "s32", true, false, [16, 16]));
  out.push(frame("ui_elite_badge", "s32", true, false, [16, 16]));
  out.push(frame("vfx_ward_0", "s32"), frame("vfx_ward_1", "s32"));
  out.push(frame("vfx_brand_mark", "s32", true, false, [16, 16]));
  out.push(frame("prop_reward_stat_0", "s64"));
  for (const id of ["npc_merchant", "npc_smith", "action_attack", "action_spin", "action_dodge"])
    out.push(frame(`icon_${id}`, "s32", true, false, [16, 16]));
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

  const facingFrames = (kind: string, size: SizeClass, poses: readonly string[]) => {
    for (const f of FACINGS) for (const pose of poses) out.push(frame(`enemy_${kind}_${f}_${pose}`, size));
  };
  facingFrames("warden", "s96", ["idle0", "idle1", "walk0", "walk1", "walk2", "walk3", "dormant0", "dormant1", "windup", "lunge", "plant", "hit0", "hit1"]);
  out.push(frame("enemy_warden_death", "s96"));
  facingFrames("warden", "s96", ["throw_windup", "throw_release", "idle_bare0", "idle_bare1"]);
  out.push(frame("weapon_enemy_warden_shield", "s96", false, false, [64, 96]));
  facingFrames("bellringer", "s64", ["idle0", "idle1", "walk0", "walk1", "walk2", "walk3", "dormant0", "dormant1", "windup", "cast", "field", "burst", "hit0", "hit1", "peal_windup", "peal_release"]);
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

  facingFrames("snarecaster", "s64", ["idle0", "idle1", "walk0", "walk1", "walk2", "walk3", "dormant0", "dormant1", "windup", "fire", "whip", "hit0", "hit1", "anchor_cast"]);
  out.push(frame("enemy_snarecaster_death", "s64"));
  facingFrames("delver", "s64", ["idle0", "idle1", "walk0", "walk1", "walk2", "walk3", "dormant0", "dormant1", "burrow0", "burrow1", "emerge0", "emerge1", "windup", "lunge", "hit0", "hit1"]);
  out.push(frame("enemy_delver_death", "s64"));
  facingFrames("cinderling", "s64", ["idle0", "idle1", "walk0", "walk1", "walk2", "walk3", "dormant0", "dormant1", "windup", "lob", "burning0", "burning1", "hit0", "hit1", "flare_windup"]);
  out.push(frame("enemy_cinderling_death", "s64"));
  facingFrames("sower", "s64", ["idle0", "idle1", "idle2", "idle3", "dormant0", "dormant1", "cast", "hit0", "hit1", "bloom_cast"]);
  out.push(frame("enemy_sower_death", "s64"));

  for (let i = 0; i < 2; i++) out.push(frame(`vfx_chain_seg_${i}`, "s64", false));
  for (let i = 0; i < 2; i++) out.push(frame(`vfx_chain_hook_${i}`, "s64", false));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_chain_live_${i}`, "s64", false));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_mound_${i}`, "s64", false));
  for (let i = 0; i < 3; i++) out.push(frame(`vfx_emerge_ring_${i}`, "s64"));
  for (let i = 0; i < 4; i++) out.push(frame(`vfx_coal_${i}`, "s32", true, true));

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
