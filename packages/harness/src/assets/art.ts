/**
 * Packs the approved raster artwork. No palette quantisation or geometric
 * redraws: every frame originates in a versioned PNG under assets/source/.
 *
 * Generated PNGs have a native alpha matte with interior values around 253.
 * Normalize that matte before premultiplied-alpha area resampling; never
 * infer transparency from a background colour.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { MANIFEST, SIZE } from "./manifest.ts";
import { checkAssets, formatReport } from "./check.ts";
import { rgbToHsl, hslToHex, hexToRgb } from "../../../core/src/render/palette.ts";
import { isProtected } from "../../../core/src/render/mood.ts";

type Rect = readonly [number, number, number, number];
type Motion = "none" | "bob" | "legs" | "ribbons" | "shoulders" | "sigil" | "pulse" | "flame" | "sheen" | "ring" | "breath" | "hit0" | "hit1" | "death";
interface Source {
  file: string;
  /** Fractional bounds for regular grids, absolute pixels for original sheets. */
  crop: Rect;
  fractional?: boolean;
  /** Grid shape used to snap generated sheets to their real transparent gutters. */
  gridShape?: readonly [number, number];
  flip?: boolean;
  full?: boolean;
}
interface Recipe { source: Source; motion: Motion }

const SOURCE_DIR = fileURLToPath(new URL("../../../../assets/source/", import.meta.url));
const WIDTH = 2048;
const originals = "originals/characters.png";
const props = "originals/props-boss.png";
const fileCache = new Map<string, PNG>();
const boundaryCache = new Map<string, number>();

function grid(file: string, col: number, row: number, cols: number, rows: number): Source {
  return { file: "smooth/" + file + ".png", crop: [col / cols, row / rows, (col + 1) / cols, (row + 1) / rows], fractional: true };
}

function meleeGrid(file: string, col: number, row: number, cols: number, rows: number, full = false): Source {
  return {
    file: "melee/" + file + ".png",
    crop: [col / cols, row / rows, (col + 1) / cols, (row + 1) / rows],
    fractional: true,
    gridShape: [cols, rows],
    full,
  };
}

/** Exact 4x sheets have mathematical cell boundaries; do not gutter-snap. */
function meleeExactGrid(file: string, col: number, row: number, cols: number, rows: number): Source {
  return {
    file: "melee/" + file + ".png",
    crop: [col / cols, row / rows, (col + 1) / cols, (row + 1) / rows],
    fractional: true,
  };
}

const EXPANSION_VFX64 = [
  ...Array.from({length:4},(_,i)=>`vfx_rift_seg_${i}`), ...Array.from({length:2},(_,i)=>`vfx_rift_cap_${i}`),
  ...Array.from({length:3},(_,i)=>`vfx_rift_burst_${i}`), ...Array.from({length:2},(_,i)=>`vfx_tether_seg_${i}`),
  ...Array.from({length:3},(_,i)=>`vfx_tether_node_${i}`), ...Array.from({length:3},(_,i)=>`vfx_ward_aura_${i}`),
  ...Array.from({length:3},(_,i)=>`vfx_lob_shadow_${i}`), ...Array.from({length:2},(_,i)=>`vfx_lob_ring_${i}`),
  ...Array.from({length:4},(_,i)=>`vfx_beam_seg_${i}`), ...Array.from({length:2},(_,i)=>`vfx_beam_cap_${i}`),
  ...Array.from({length:3},(_,i)=>`vfx_plate_spark_${i}`), ...Array.from({length:4},(_,i)=>`vfx_plate_disc_${i}`),
  ...Array.from({length:4},(_,i)=>`vfx_slowfield_${i}`), ...Array.from({length:2},(_,i)=>`vfx_mine_seed_${i}`),
  ...Array.from({length:4},(_,i)=>`vfx_mine_armed_${i}`), ...Array.from({length:3},(_,i)=>`vfx_mine_burst_${i}`),
  ...Array.from({length:2},(_,i)=>`vfx_chain_seg_${i}`), ...Array.from({length:2},(_,i)=>`vfx_chain_hook_${i}`),
  ...Array.from({length:4},(_,i)=>`vfx_chain_live_${i}`), ...Array.from({length:4},(_,i)=>`vfx_mound_${i}`),
  ...Array.from({length:3},(_,i)=>`vfx_emerge_ring_${i}`),
] as const;

const EXPANSION_BODY_KINDS = ["warden", "bellringer", "snarecaster", "delver", "cinderling", "sower"] as const;

function sourceFor(name: string): Recipe {
  const alt = /(?:idle1|_1)$/.test(name);
  const tele = name.endsWith("_tele") || name.endsWith("_tele1");
  const facing = name.split("_")[2] ?? "s";
  const col = ["s", "n", "w"].indexOf(facing);
  let source: Source;
  let motion: Motion = "none";
  if (name.startsWith("player_")) {
    const f = ["s", "n", "w"].indexOf(name.split("_")[1]!);
    const pose = name.split("_")[2]!;
    if (pose.startsWith("idle")) source = meleeGrid("player-idle", Number(pose.at(-1)), f, 4, 3);
    else if (pose.startsWith("walk")) source = meleeGrid("player-walk", Number(pose.at(-1)), f, 4, 3);
    else {
      const actionCol: Record<string, number> = { windup: 0, follow: 1, dash: 2, hurt0: 3, hurt1: 4 };
      source = meleeGrid("player-actions", actionCol[pose]!, f, 5, 3);
    }
  } else if (name === "weapon_player_sword") {
    source = meleeGrid("player-sword", 0, 0, 1, 1);
  } else if (name.startsWith("vfx_offhand_")) {
    source = meleeGrid("offhand-flame", Number(name.at(-1)), 0, 4, 1);
  } else if (name.startsWith("vfx_bolt_")) {
    source = meleeGrid("lightning-bolt", Number(name.at(-1)), 0, 3, 1);
  } else if (name.startsWith("vfx_impact_")) {
    source = meleeGrid("effects", Number(name.at(-1)), 2, 3, 3);
  } else if (name.startsWith("vfx_groundfire_")) {
    source = meleeGrid("groundfire", Number(name.at(-1)), 0, 4, 1);
  } else if (name === "weapon_enemy_rusher") {
    source = meleeGrid("enemy-weapons", 0, 0, 1, 1);
  } else if (name === "weapon_enemy_tank") {
    source = meleeExactGrid("enemy-tank-weapon", 0, 0, 1, 1);
  } else if (name === "weapon_enemy_sentinel_barrel") {
    source = meleeExactGrid("enemy-sentinel-barrel", 0, 0, 1, 1);
  } else if (name === "vfx_spike_bone" || name === "vfx_spike_gold") {
    source = meleeExactGrid(name === "vfx_spike_bone" ? "enemy-lancer-spike-bone" : "enemy-lancer-spike-gold", 0, 0, 1, 1);
  } else if (/^enemy_lancer_[snw]_walk[0-3]$/.test(name)) {
    const f = ["s", "n", "w"].indexOf(name.split("_")[2]!);
    source = meleeExactGrid("enemy-lancer-walk", Number(name.at(-1)), f, 4, 3);
  } else if (/^enemy_lancer_[snw]_(idle[01]|dormant1?)$/.test(name)) {
    const f = ["s", "n", "w"].indexOf(name.split("_")[2]!);
    const pose = name.split("_")[3]!;
    const c = ["idle0", "idle1", "dormant", "dormant1"].indexOf(pose);
    source = meleeExactGrid("enemy-lancer-idle-dormant", c, f, 4, 3);
  } else if (/^enemy_lancer_[snw]_(hit[01]|windup|lunge)$/.test(name)) {
    const f = ["s", "n", "w"].indexOf(name.split("_")[2]!);
    const pose = name.split("_")[3]!;
    const c = ["hit0", "hit1", "windup", "lunge"].indexOf(pose);
    source = meleeExactGrid("enemy-lancer-actions", c, f, 4, 3);
  } else if (name === "enemy_lancer_death" || name === "enemy_lancer_burst") {
    source = meleeExactGrid("enemy-lancer-death-burst", name.endsWith("burst") ? 1 : 0, 0, 2, 1);
  } else if (name.startsWith("enemy_sentinel_") && name !== "enemy_sentinel_telegraph_beam") {
    const poses = ["idle0", "idle1", "dormant", "dormant1", "hit0", "hit1", "tele", "tele1", "death"];
    const i = poses.indexOf(name.slice("enemy_sentinel_".length));
    source = meleeExactGrid("enemy-sentinel", i % 3, Math.floor(i / 3), 3, 3);
  } else if (name === "weapon_enemy_warden_shield") {
    return { source: meleeExactGrid("weapon-warden-shield", 0, 0, 1, 1), motion: "none" };
  } else if (name.startsWith("enemy_rifter_")) {
    const poses = ["dormant", "idle0", "idle1", "telegraph", "erupt", "hit0", "hit1", "death", "telegraph_walk"];
    const i = poses.indexOf(name.slice("enemy_rifter_".length));
    const motion: Motion = name.endsWith("hit0") ? "hit0" : name.endsWith("hit1") ? "hit1" : name.endsWith("death") ? "death" : name.endsWith("idle1") ? "pulse" : "none";
    return { source: meleeExactGrid("enemy-rifter-expansion", i % 3, Math.floor(i / 3), 3, 3), motion };
  } else if (EXPANSION_BODY_KINDS.some((kind) => name.startsWith(`enemy_${kind}_`))) {
    const kind = EXPANSION_BODY_KINDS.find((candidate) => name.startsWith(`enemy_${candidate}_`))!;
    const parts = name.split("_");
    const isDeath = parts.at(-1) === "death";
    const f = isDeath ? 0 : ["s", "n", "w"].indexOf(parts[2]!);
    const pose = isDeath ? "death" : parts.slice(3).join("_");
    const columns: Record<typeof kind, (pose: string) => number> = {
      warden: (p) => /^(windup|throw_windup)$/.test(p) ? 1 : /^(lunge|plant|throw_release)$/.test(p) ? 2 : p.startsWith("idle_bare") ? 3 : 0,
      bellringer: (p) => /^(windup|peal_windup)$/.test(p) ? 1 : /^(cast|field|peal_release)$/.test(p) ? 2 : p === "burst" ? 3 : 0,
      snarecaster: (p) => /^(windup|anchor_cast)$/.test(p) ? 1 : p === "fire" ? 2 : p === "whip" ? 3 : 0,
      delver: (p) => p.startsWith("burrow") ? 1 : p.startsWith("emerge") ? 2 : p === "lunge" ? 3 : 0,
      cinderling: (p) => /^(windup|flare_windup)$/.test(p) ? 1 : p === "lob" ? 2 : p.startsWith("burning") ? 3 : 0,
      sower: (p) => p.startsWith("dormant") ? 1 : p === "cast" ? 2 : p === "bloom_cast" ? 3 : 0,
    };
    const col = columns[kind](pose);
    const motion: Motion = pose.startsWith("walk") ? "legs"
      : pose === "hit0" ? "hit0" : pose === "hit1" ? "hit1" : pose === "death" ? "death"
      : /(?:idle1|idle3|dormant1|burning1)$/.test(pose) ? "bob" : "none";
    return { source: meleeExactGrid(`enemy-${kind}-expansion`, col, f, 4, 3), motion };
  } else if (/^enemy_shooter_[snw]_lob$/.test(name)) {
    const f = ["s","n","w"].indexOf(name.split("_")[2]!);
    return { source: { file: "smooth/telegraphs.png", crop: [f*341,20,(f+1)*341,289] }, motion: "none" };
  } else if (name === "enemy_turret_telegraph_rift") {
    return { source: grid("turret-chest",1,0,2,2), motion: "pulse" };
  } else if (name === "enemy_sentinel_telegraph_beam") {
    return { source: meleeExactGrid("enemy-sentinel",0,2,3,3), motion: "pulse" };
  } else if (/^enemy_tank_[snw]_cleave_shock$/.test(name)) {
    const f=["s","n","w"].indexOf(name.split("_")[2]!);
    return { source: meleeGrid("enemy-tank-actions",1,f,2,3), motion:"none" };
  } else if (/^enemy_summoner_[snw]_tether$/.test(name)) {
    const f=["s","n","w"].indexOf(name.split("_")[2]!);
    return { source:{file:"smooth/telegraphs.png",crop:[f*341,1006,(f+1)*341,1520],flip:f===2},motion:"none" };
  } else if (EXPANSION_VFX64.includes(name as typeof EXPANSION_VFX64[number])) {
    const i=EXPANSION_VFX64.indexOf(name as typeof EXPANSION_VFX64[number]);
    return { source: meleeExactGrid("expansion-vfx-64",i%9,Math.floor(i/9),9,7),motion:"none" };
  } else if (/^vfx_(lob_shot|coal)_[0-3]$/.test(name)) {
    const i=(name.startsWith("vfx_coal")?4:0)+Number(name.at(-1));
    return { source:meleeExactGrid("expansion-vfx-32",i,0,8,1),motion:"none" };
  } else if (/^vfx_peal_ring_[0-3]$/.test(name)) {
    return { source:meleeExactGrid("expansion-vfx-128",Number(name.at(-1)),0,4,1),motion:"none" };
  } else if (name.startsWith("enemy_") && /_dormant1?$/.test(name) && !name.startsWith("enemy_turret_")) {
    const kind = name.split("_")[1]!;
    const f = ["s", "n", "w"].indexOf(name.split("_")[2]!);
    const c = ["rusher", "tank", "shooter", "orbiter", "summoner"].indexOf(kind);
    source = meleeGrid("enemy-dormant", c, f, 5, 3);
    if (name.endsWith("dormant1")) motion = "breath";
  } else if (name.startsWith("enemy_") && /_walk[0-3]$/.test(name)) {
    const kind = name.split("_")[1]!;
    const f = ["s", "n", "w"].indexOf(name.split("_")[2]!);
    source = meleeGrid(`enemy-${kind}-walk`, Number(name.at(-1)), f, 4, 3);
    if (kind === "summoner" && f === 2) source.flip = true;
  } else if (/^enemy_(rusher|tank)_[snw]_(windup|lunge)$/.test(name)) {
    const kind = name.split("_")[1]!;
    const f = ["s", "n", "w"].indexOf(name.split("_")[2]!);
    const pose = name.split("_")[3]!;
    source = meleeGrid(`enemy-${kind}-actions`, pose === "windup" ? 0 : 1, f, 2, 3);
  } else if (/^enemy_(rusher|shooter|orbiter|summoner)_[snw]_hit[01]$/.test(name)) {
    const kind = name.split("_")[1]!;
    const f = ["s", "n", "w"].indexOf(name.split("_")[2]!);
    source = meleeGrid(`enemy-${kind}-hit`, Number(name.at(-1)), f, 2, 3);
  } else if (/^enemy_tank_[snw]_hit[01]$/.test(name)) {
    const f = ["s", "n", "w"].indexOf(name.split("_")[2]!);
    source = meleeGrid("enemy-tank-hit", Number(name.at(-1)), f, 2, 3);
  } else if (/^enemy_turret_hit[01]$/.test(name)) {
    source = meleeGrid("enemy-turret-hit", Number(name.at(-1)), 0, 2, 1);
  } else if (/^enemy_(rusher|shooter|turret|orbiter|tank|summoner)_death$/.test(name)) {
    const kind = name.split("_")[1]!;
    const small = ["rusher", "shooter", "turret", "orbiter"];
    const large = ["tank", "summoner"];
    source = small.includes(kind)
      ? meleeGrid("enemy-deaths-64", small.indexOf(kind), 0, 4, 1)
      : meleeGrid("enemy-deaths-96", large.indexOf(kind), 0, 2, 1);
  } else if (name === "enemy_turret_dormant" || name === "enemy_turret_dormant1") {
    source = meleeGrid("enemy-turret-dormant", 0, 0, 1, 1);
    if (name.endsWith("dormant1")) motion = "breath";
  } else if (name.startsWith("enemy_orbiter_")) {
    source = col === 2 ? grid("orbiter-side", 0, tele ? 1 : 0, 1, 2) : grid("orbiter", col, tele ? 1 : 0, 3, 2);
    motion = name.endsWith("hit0") ? "hit0" : name.endsWith("hit1") ? "hit1" : "ribbons";
  } else if (name.startsWith("enemy_turret_")) {
    source = grid("turret-chest", tele ? 1 : 0, 0, 2, 2);
    motion = name.endsWith("hit0") ? "hit0" : name.endsWith("hit1") ? "hit1" : "pulse";
  } else if (name.startsWith("enemy_")) {
    const kind = name.split("_")[1]!;
    const rows: Record<string, readonly [number, number]> = {
      rusher: [253, 447], shooter: [454, 624], tank: [864, 1138], summoner: [1142, 1526],
    };
    const teleRows: Record<string, readonly [number, number]> = {
      shooter: [20, 289], tank: [586, 1005], summoner: [1006, 1520],
    };
    if (tele) {
      const row = teleRows[kind];
      if (!row) throw new Error("No telegraph art for " + name);
      source = { file: "smooth/telegraphs.png", crop: [col * 341, row[0], (col + 1) * 341, row[1]], flip: col === 2 && (kind === "tank" || kind === "summoner") };
    } else {
      const row = rows[kind];
      if (!row) throw new Error("No character art for " + name);
      const edges = [0, 373, 684, 1024];
      source = { file: originals, crop: [edges[col]!, row[0], edges[col + 1]!, row[1]], flip: col === 2 && kind !== "shooter" };
    }
    motion = name.endsWith("hit0") ? "hit0" : name.endsWith("hit1") ? "hit1"
      : kind === "rusher" ? "legs" : kind === "tank" ? "shoulders" : kind === "summoner" ? "sigil" : "bob";
  } else if (/^boss_p[123]_(windup|commit|hit0|hit1|leap|slam)$/.test(name)) {
    const phase = Number(name[6]);
    const pose = name.slice(8);
    const i = ["windup", "commit", "hit0", "hit1", "leap", "slam"].indexOf(pose);
    source = meleeExactGrid(`boss-p${phase}-actions`, i % 3, Math.floor(i / 3), 3, 2);
  } else if (name.startsWith("boss_")) {
    source = grid("boss", Number(name[6]) - 1, tele ? 1 : 0, 3, 2);
    motion = "ring";
  } else if (name.startsWith("bullet_")) {
    const kinds = ["player_a", "player_b", "player_c", "enemy_a", "enemy_b"];
    const kind = name.slice(7, -2);
    source = grid("icons-bullets", kinds.indexOf(kind), 2, 5, 3);
    motion = "pulse";
  } else if (name.startsWith("prop_break_")) {
    const row = ["pot", "crate", "urn"].indexOf(name.split("_")[2]!);
    source = meleeGrid("destructibles", Number(name.at(-1)), row, 3, 3);
  } else if (/^pet_[snw]_walk[0-3]$/.test(name)) {
    const f = ["s", "n", "w"].indexOf(name.split("_")[1]!);
    source = meleeGrid("companion-walk", Number(name.at(-1)), f, 4, 3);
  } else if (name.startsWith("pet_")) {
    const f = ["s", "n", "w"].indexOf(name.split("_")[1]!);
    const pose = name.split("_")[2]!;
    const petCol = ["idle0", "idle1", "attack"].indexOf(pose);
    source = meleeGrid("companion", petCol, f, 3, 3);
  } else if (/^prop_(merchant|blacksmith)_[01]$/.test(name)) {
    const row = name.includes("merchant") ? 0 : 1;
    source = meleeGrid("vendors", Number(name.at(-1)), row, 2, 2);
  } else if (name === "prop_reward_stat_0") {
    // Start from the shipped affix plinth so stone, perspective and outline
    // remain identical; a green upward stat sigil is painted after fitting.
    source = meleeGrid("portals-rewards", 0, 2, 4, 3);
  } else if (name.startsWith("prop_portal_") || name.startsWith("prop_reward_")) {
    const order = [
      "prop_portal_shut_0", "prop_portal_shut_1", "prop_portal_open_0", "prop_portal_open_1",
      "prop_portal_open_2", "prop_portal_open_3", "prop_reward_spell_0", "prop_reward_spell_1",
      "prop_reward_affix_0", "prop_reward_affix_1", "prop_reward_gold_0", "prop_reward_gold_1",
    ];
    const i = order.indexOf(name);
    source = meleeGrid("portals-rewards", i % 4, Math.floor(i / 4), 4, 3);
  } else if (name.startsWith("pickup_")) {
    const order = ["pickup_heart_0", "pickup_heart_1", "pickup_coin_0", "pickup_coin_1"];
    source = meleeGrid("pickups", order.indexOf(name), 0, 4, 1);
  } else if (name.startsWith("deco_")) {
    const order = ["crack_0", "crack_1", "drain_0", "drain_1", "stain_0", "stain_1", "rubble_0", "rubble_1", "moss_0", "moss_1", "scorch", "bones"];
    const i = order.indexOf(name.slice(5));
    source = meleeGrid("decorations", i % 4, Math.floor(i / 4), 4, 3);
  } else if (name.startsWith("tile_")) {
    if (/^tile_floor_[4-7]$/.test(name)) {
      const col = Number(name.at(-1)) - 4;
      const left = Math.round(col * 1983 / 4), right = Math.round((col + 1) * 1983 / 4);
      source = { file: "melee/floors.png", crop: [left, 145, right, 647], full: true };
      return { source, motion };
    }
    const newWalls = ["ns", "ew", "nes", "esw", "swn", "wne", "nesw"];
    const wallCase = name.slice("tile_wall_".length);
    const newIndex = newWalls.indexOf(wallCase);
    if (newIndex >= 0) {
      const left = Math.round(newIndex * 2079 / 7), right = Math.round((newIndex + 1) * 2079 / 7);
      source = { file: "melee/walls.png", crop: [left, 180, right, 573], full: true };
      return { source, motion };
    }
    const legacyName = name === "tile_wall_solid" ? "tile_wall_c"
      : name === "tile_wall_es" ? "tile_wall_se"
      : name === "tile_wall_wn" ? "tile_wall_nw" : name;
    const names = ["tile_floor_0", "tile_floor_1", "tile_floor_2", "tile_floor_3",
      "tile_wall_c", "tile_wall_n", "tile_wall_e", "tile_wall_s",
      "tile_wall_w", "tile_wall_ne", "tile_wall_nw", "tile_wall_se", "tile_wall_sw"];
    const i = names.indexOf(legacyName);
    if (i < 0) throw new Error("No terrain art for " + name);
    source = { ...grid("terrain", i % 4, Math.floor(i / 4), 4, 4), full: true };
  } else if (name.startsWith("hazard_")) {
    const kind = name.split("_")[1]!;
    if (kind === "spike") source = { ...grid("terrain", alt ? 2 : 1, 3, 4, 4), full: true };
    else if (kind === "crumble") source = { ...grid("terrain", alt ? 3 : 0, alt ? 3 : 0, 4, 4), full: true };
    else {
      source = { file: props, crop: kind === "poison" ? [163, 386, 293, 584] : [301, 386, 444, 590] };
      motion = kind === "poison" ? "pulse" : "sheen";
    }
  } else if (name.startsWith("prop_")) {
    const kind = name.split("_")[1]!;
    const crops: Record<string, Rect> = {
      pillar: [600, 390, 705, 596], brazier: [706, 386, 818, 590],
      mirror: [821, 389, 938, 596], manawell: [940, 407, 1073, 596],
      shop: [1211, 377, 1383, 604], restfire: [1384, 414, 1536, 615],
    };
    if (kind === "chest") source = grid("turret-chest", alt ? 1 : 0, 1, 2, 2);
    else {
      if (!crops[kind]) throw new Error("No prop art for " + name);
      source = { file: props, crop: crops[kind]! };
      motion = kind === "brazier" || kind === "restfire" ? "flame" : "sheen";
    }
  } else if (name.startsWith("icon_door_")) {
    const i = ["combat", "elite", "treasure", "shop", "rest", "boss"].indexOf(name.slice(10));
    source = grid("icons-bullets", i % 5, Math.floor(i / 5), 5, 3);
  } else if (name.startsWith("icon_affix_")) {
    if (name === "icon_affix_resonance") return { source: meleeExactGrid("part-a-icons", 6, 0, 7, 3), motion: "none" };
    const ids = ["fork", "chain", "brand", "harvest", "echo", "bloom", "shatter", "repeat", "scatter", "ward", "retort", "slipstream"];
    const i = ids.indexOf(name.slice("icon_affix_".length));
    source = meleeGrid("affix-icons", i % 6, Math.floor(i / 6), 6, 2);
  } else if (name.startsWith("icon_stat_")) {
    if (name === "icon_stat_wrath") return { source: meleeExactGrid("part-a-icons", 0, 1, 7, 3), motion: "none" };
    const ids = ["fleet", "second_wind", "long_stride", "vigour", "steady_nerve", "deep_well", "quickening", "leeching_edge", "keen_edge", "long_reach", "swift_hand"];
    const i = ids.indexOf(name.slice("icon_stat_".length));
    source = meleeGrid("stat-icons", i % 6, Math.floor(i / 6), 6, 2);
  } else if (name.startsWith("icon_reward_")) {
    const i = ["stat", "spell", "affix", "gold"].indexOf(name.slice("icon_reward_".length));
    source = meleeGrid("reward-badges", i, 0, 5, 1);
  } else if (name === "ui_elite_badge") {
    source = meleeGrid("reward-badges", 4, 0, 5, 1);
  } else if (name.startsWith("vfx_ward_")) {
    source = meleeGrid("ward-rune", Number(name.at(-1)), 0, 2, 1);
  } else if (name === "vfx_brand_mark") {
    source = meleeGrid("brand-mark", 0, 0, 1, 1);
  } else if (/^icon_(spirit_blades|wildfire_field|stone_ward|blink_strike|void_maw|spirit_ally)$/.test(name)) {
    const ids = ["spirit_blades", "wildfire_field", "stone_ward", "blink_strike", "void_maw", "spirit_ally"];
    return { source: meleeExactGrid("part-a-icons", ids.indexOf(name.slice(5)), 0, 7, 3), motion: "none" };
  } else if (/^icon_(npc_merchant|npc_smith|action_attack|action_spin|action_dodge)$/.test(name)) {
    const ids = ["npc_merchant", "npc_smith", "action_attack", "action_spin", "action_dodge"];
    const i = ids.indexOf(name.slice(5)) + 1;
    return { source: meleeExactGrid("part-a-icons", i, 1, 7, 3), motion: "none" };
  } else if (name.startsWith("icon_status_")) {
    const ids = ["burn", "poison", "chill", "freeze", "stun", "stagger", "alert"];
    const i = ids.indexOf(name.slice("icon_status_".length));
    return { source: meleeExactGrid("part-a-icons", i, 2, 7, 3), motion: "none" };
  } else if (name === "ui_shield") {
    return { source: meleeExactGrid("part-a-icons", 6, 1, 7, 3), motion: "none" };
  } else if (name.startsWith("icon_")) {
    const ids = [
      "magic_bolt", "shock_arc", "spark_spray", "stone_shard", "ember_dart", "frost_needle",
      "venom_spit", "arc_lance", "scatter_shot", "cinder_burst", "glacier_spike",
      "void_orb", "plague_bloom", "impact_carrier", "fuse_carrier", "wall_carrier",
      "piercing_carrier", "mortar_carrier",
    ];
    const i = ids.indexOf(name.slice(5));
    source = meleeGrid("spell-icons", i % 5, Math.floor(i / 5), 5, 4);
  } else if (name.startsWith("shadow_")) {
    if (["shadow_lancer", "shadow_sentinel", "shadow_boss_p1"].includes(name)) {
      const i = ["shadow_lancer", "shadow_sentinel", "shadow_boss_p1"].indexOf(name);
      return { source: i < 2 ? meleeExactGrid("part-a-shadows", i, 0, 2, 1) : meleeExactGrid("part-a-boss-shadow", 0, 0, 1, 1), motion: "none" };
    }
    const order = ["rusher", "shooter", "turret", "orbiter", "tank", "summoner", "player"];
    source = meleeGrid("shadows", order.indexOf(name.slice(7)), 0, 7, 1);
  } else {
    const i = ["ui_heart_full", "ui_heart_empty", "ui_mana_pip", "ui_card_frame"].indexOf(name);
    if (i < 0) throw new Error("No source art for " + name);
    source = grid("icons-bullets", i + 1, 1, 5, 3);
  }
  const derivedPose = /(?:dormant1|hit[01]|_death|tele1|pet_[snw]_walk[0-3])$/.test(name);
  return { source, motion: derivedPose || (alt && !tele) ? motion : "none" };
}

function snappedBoundary(source: Source, original: PNG, horizontal: boolean, fraction: number): number {
  const length = horizontal ? original.width : original.height;
  if (fraction <= 0) return 0;
  if (fraction >= 1) return length;
  if (!source.gridShape) return Math.round(fraction * length);

  const parts = horizontal ? source.gridShape[0] : source.gridShape[1];
  const key = `${source.file}:${horizontal ? "x" : "y"}:${fraction}:${parts}`;
  const cached = boundaryCache.get(key);
  if (cached !== undefined) return cached;

  const nominal = fraction * length;
  const radius = Math.max(4, Math.floor(length / parts / 4));
  const lo = Math.max(2, Math.floor(nominal - radius));
  const hi = Math.min(length - 3, Math.ceil(nominal + radius));
  let best = Math.round(nominal), bestScore = Infinity, bestDistance = Infinity;
  for (let candidate = lo; candidate <= hi; candidate++) {
    let score = 0;
    for (let d = -2; d <= 2; d++) {
      if (horizontal) {
        const x = candidate + d;
        for (let y = 0; y < original.height; y++)
          if (original.data[(y * original.width + x) * 4 + 3]! > 180) score++;
      } else {
        const y = candidate + d;
        for (let x = 0; x < original.width; x++)
          if (original.data[(y * original.width + x) * 4 + 3]! > 180) score++;
      }
    }
    const distance = Math.abs(candidate - nominal);
    if (score < bestScore || (score === bestScore && distance < bestDistance)) {
      best = candidate; bestScore = score; bestDistance = distance;
    }
  }
  boundaryCache.set(key, best);
  return best;
}

function readSource(source: Source): PNG {
  let original = fileCache.get(source.file);
  if (!original) {
    original = PNG.sync.read(readFileSync(join(SOURCE_DIR, source.file)));
    fileCache.set(source.file, original);
  }
  const [left, top, right, bottom] = source.crop.map((v, i) => {
    if (!source.fractional) return Math.round(v);
    return snappedBoundary(source, original!, i % 2 === 0, v);
  }) as [number, number, number, number];
  if (left < 0 || top < 0 || right > original.width || bottom > original.height || right <= left || bottom <= top)
    throw new Error("Invalid source crop: " + JSON.stringify(source));
  const out = new PNG({ width: right - left, height: bottom - top });
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const si = ((top + y) * original.width + left + (source.flip ? out.width - 1 - x : x)) * 4;
    const di = (y * out.width + x) * 4;
    out.data.set(original.data.subarray(si, si + 4), di);
    // Native alpha only: discard very faint diffuse matte and recover opaque
    // painted interiors. RGB is never used as a colour-key.
    const a = out.data[di + 3]!;
    out.data[di + 3] = source.full ? 255 : a <= 180 ? 0 : a >= 240 ? 255 : Math.round((a - 180) * 255 / 60);
    if (out.data[di + 3] === 0) out.data.fill(0, di, di + 4);
  }
  return out;
}

function contentBounds(png: PNG): Rect {
  let l = png.width, t = png.height, r = 0, b = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    if (png.data[(y * png.width + x) * 4 + 3] === 0) continue;
    l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x + 1); b = Math.max(b, y + 1);
  }
  if (r <= l || b <= t) throw new Error("Empty source artwork");
  return [l, t, r, b];
}

/** Exact area integration with premultiplied alpha avoids background fringes. */
function fit(input: PNG, width: number, full: boolean, height = width): PNG {
  const [l, t, r, b] = full ? [0, 0, input.width, input.height] : contentBounds(input);
  const margin = width === 256 && height === 256 ? 20 : width === 96 ? 10 : width === 32 ? 6 : width === 16 ? 2 : 8;
  const scale = full ? 1 : Math.min((width - margin) / (r - l), (height - Math.min(margin, height / 4)) / (b - t));
  const w = full ? width : Math.max(1, Math.round((r - l) * scale));
  const h = full ? height : Math.max(1, Math.round((b - t) * scale));
  const x0 = Math.floor((width - w) / 2), y0 = Math.floor((height - h) / 2);
  const out = new PNG({ width, height }); out.data.fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx0 = l + x * (r - l) / w, sx1 = l + (x + 1) * (r - l) / w;
    const sy0 = t + y * (b - t) / h, sy1 = t + (y + 1) * (b - t) / h;
    let alpha = 0, red = 0, green = 0, blue = 0;
    const area = (sx1 - sx0) * (sy1 - sy0);
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
      const weight = (Math.min(sx + 1, sx1) - Math.max(sx, sx0)) * (Math.min(sy + 1, sy1) - Math.max(sy, sy0));
      const i = (sy * input.width + sx) * 4, a = input.data[i + 3]! / 255 * weight;
      alpha += a; red += input.data[i]! * a; green += input.data[i + 1]! * a; blue += input.data[i + 2]! * a;
    }
    const a = Math.round(alpha / area * 255), i = ((y0 + y) * width + x0 + x) * 4;
    if (a < 24 || alpha === 0) continue;
    out.data[i] = Math.round(red / alpha); out.data[i + 1] = Math.round(green / alpha); out.data[i + 2] = Math.round(blue / alpha);
    out.data[i + 3] = a >= 208 ? 255 : Math.round((a - 24) * 255 / 184);
  }
  return out;
}

const WALL_SIDES = { n: 1, e: 2, s: 4, w: 8 } as const;
const WALL_MASK: Readonly<Record<string, number>> = {
  solid: 0,
  n: 1, e: 2, s: 4, w: 8,
  ne: 3, es: 6, sw: 12, wn: 9,
  ns: 5, ew: 10,
  nes: 7, esw: 14, swn: 13, wne: 11,
  nesw: 15,
};

/**
 * Builds the seven missing autotile cases from the approved legacy wall set.
 *
 * The first delivery mixed nine cells from `smooth/terrain.png` with seven
 * cells from a separately generated `melee/walls.png`. Their cap thickness,
 * brick courses and corner endpoints did not agree, so a continuous boundary
 * visibly changed construction at every mask transition. The legacy set has
 * a coherent solid, four sides and four corners. Those are sufficient to
 * compose every four-neighbour mask while keeping every cap on one grid.
 */
function composeWall(name: string, width: number, height: number): PNG {
  const wallCase = name.slice("tile_wall_".length);
  const mask = WALL_MASK[wallCase];
  if (mask === undefined) throw new Error(`Unknown wall case ${wallCase}`);

  const legacyIndex: Readonly<Record<string, number>> = {
    solid: 4, n: 5, e: 6, s: 7, w: 8, ne: 9, wn: 10, es: 11, sw: 12,
  };
  const load = (key: string): PNG => {
    const i = legacyIndex[key];
    if (i === undefined) throw new Error(`No legacy wall source for ${key}`);
    return fit(readSource({ ...grid("terrain", i % 4, Math.floor(i / 4), 4, 4), full: true }), width, true, height);
  };

  // Preserve an authored frame wholesale whenever one already represents the
  // requested case. The composition path is only for opposite, triple and
  // four-sided masks.
  if (wallCase in legacyIndex) return load(wallCase);

  const baseKey = ["ne", "es", "sw", "wn"].find((key) => {
    const bits = WALL_MASK[key]!;
    return (mask & bits) === bits;
  }) ?? ["n", "e", "s", "w"].find((key) => (mask & WALL_SIDES[key as keyof typeof WALL_SIDES]) !== 0) ?? "solid";
  const out = load(baseKey);
  const bandX = Math.max(1, Math.round(width / 4));
  const bandY = Math.max(1, Math.round(height / 4));
  const copy = (src: PNG, x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      out.data.set(src.data.subarray(i, i + 4), i);
    }
  };

  const baseMask = WALL_MASK[baseKey]!;
  for (const [side, bit] of Object.entries(WALL_SIDES) as [keyof typeof WALL_SIDES, number][]) {
    if ((mask & bit) === 0 || (baseMask & bit) !== 0) continue;
    const src = load(side);
    if (side === "n") copy(src, 0, 0, width, bandY);
    else if (side === "s") copy(src, 0, height - bandY, width, height);
    else if (side === "w") copy(src, 0, 0, bandX, height);
    else copy(src, width - bandX, 0, width, height);
  }

  // Adjacent open sides own their corner. Copying the authored corner last
  // prevents one side strip from cutting the other off at a T or cross.
  const corners = [
    ["ne", width - bandX, 0, width, bandY],
    ["es", width - bandX, height - bandY, width, height],
    ["sw", 0, height - bandY, bandX, height],
    ["wn", 0, 0, bandX, bandY],
  ] as const;
  for (const [key, x0, y0, x1, y1] of corners) {
    const bits = WALL_MASK[key]!;
    if ((mask & bits) === bits) copy(load(key), x0, y0, x1, y1);
  }
  return out;
}

/**
 * Keeps the wall cap readable without making it look like a second material.
 *
 * The authored cap pixels reached almost 200 luminance while the stone body
 * sits near 63. Mood lighting amplified that gap, turning connected edges
 * into a pale, glowing U-shape. Compress only the upper value range so the
 * cap still marks the walkable side and the brick detail stays intact.
 */
function harmonizeWallValue(image: PNG): PNG {
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3]! < 24) continue;
    const red = image.data[i]!;
    const green = image.data[i + 1]!;
    const blue = image.data[i + 2]!;
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    if (luminance <= 80) continue;
    const target = 80 + (luminance - 80) * 0.55;
    const scale = target / luminance;
    image.data[i] = Math.round(red * scale);
    image.data[i + 1] = Math.round(green * scale);
    image.data[i + 2] = Math.round(blue * scale);
  }
  return image;
}

/**
 * Sources authored on an exact 4x pixel grid are already composed, padded and
 * centred. Sampling one cell from each 4x4 block restores the intended final
 * pixel instead of cropping the silhouette and resampling it by a fractional
 * factor, which is what made the first small-icon delivery look blurry.
 */
function fitAuthored4x(input: PNG, width: number, height: number): PNG {
  if (input.width !== width * 4 || input.height !== height * 4)
    throw new Error(`4x source must be ${width * 4}x${height * 4}, got ${input.width}x${input.height}`);
  const out = new PNG({ width, height });
  out.data.fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const si = (((y * 4) + 2) * input.width + (x * 4) + 2) * 4;
    const di = (y * width + x) * 4;
    if (input.data[si + 3] === 0) continue;
    out.data.set(input.data.subarray(si, si + 4), di);
  }
  return out;
}

/** Keeps a small overlay crisp by authoring it at its actual on-screen size. */
function fitAtContentHeight(input: PNG, width: number, height: number, targetHeight: number): PNG {
  const [l, t, r, b] = contentBounds(input);
  const scale = targetHeight / (b - t);
  const w = Math.max(1, Math.round((r - l) * scale));
  const h = targetHeight;
  const out = new PNG({ width, height }); out.data.fill(0);
  const x0 = Math.floor((width - w) / 2), y0 = Math.floor((height - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(r - 1, l + Math.floor(x * (r - l) / w));
    const sy = Math.min(b - 1, t + Math.floor(y * (b - t) / h));
    const si = (sy * input.width + sx) * 4, di = ((y0 + y) * width + x0 + x) * 4;
    out.data.set(input.data.subarray(si, si + 4), di);
  }
  return out;
}

/** Reuses the shipped reward plinth and replaces its badge with a stat arrow. */
function paintStatPedestal(input: PNG): PNG {
  const out = new PNG({ width: input.width, height: input.height });
  out.data.set(input.data);
  const set = (x: number, y: number, c: readonly [number, number, number, number]) => {
    if (x < 0 || y < 0 || x >= out.width || y >= out.height) return;
    out.data.set(c, (y * out.width + x) * 4);
  };
  const ink = [13, 11, 31, 255] as const;
  const green = [74, 190, 105, 255] as const;
  const bone = [232, 227, 216, 255] as const;
  const cx = Math.floor(out.width / 2), top = Math.floor(out.height * 0.25);
  // Solid stepped arrow with a two-pixel dark boundary, sized to cover the
  // old badge while leaving the authored stone and perspective untouched.
  for (let y = 0; y < 15; y++) for (let x = -8; x <= 8; x++) {
    const arrow = y < 7 ? Math.abs(x) <= y : Math.abs(x) <= 2;
    const inner = y >= 2 && (y < 7 ? Math.abs(x) <= y - 2 : y < 13 && Math.abs(x) <= 1);
    if (arrow) set(cx + x, top + y, inner ? green : ink);
  }
  set(cx - 1, top + 3, bone); set(cx, top + 3, bone);
  return out;
}

/**
 * The swing source supplies the colour and pixel texture, but the renderer
 * needs a topology-safe strip: no tip or tail, identical seam columns,
 * constant radial thickness, and the same cross-section when a strike flips.
 */
function fitSwingStrip(input: PNG, width: number, height: number): PNG {
  const [l, t, r, b] = contentBounds(input);
  const out = new PNG({ width, height });
  out.data.fill(0);
  // Three transparent rows per side leave a clean cutout while filling
  // 58/64 = 90.6% of the texture height, above the rope contract's 88% floor.
  const margin = 3;
  const stripHeight = height - margin * 2;
  const half = Math.ceil(stripHeight / 2);

  for (let x = 0; x < width - 1; x++) {
    const mappedX = Math.min(r - 1, l + Math.floor((x / (width - 1)) * (r - l)));
    let sx = mappedX, top = t, bottom = b - 1;
    const scan = (candidate: number) => {
      let first = t, last = b - 1;
      while (first < b && input.data[(first * input.width + candidate) * 4 + 3] === 0) first++;
      while (last >= t && input.data[(last * input.width + candidate) * 4 + 3] === 0) last--;
      return [first, last] as const;
    };
    [top, bottom] = scan(sx);
    for (let d = 1; bottom < top && (mappedX - d >= l || mappedX + d < r); d++) {
      sx = mappedX - d >= l ? mappedX - d : mappedX + d;
      [top, bottom] = scan(sx);
      if (bottom < top && mappedX + d < r) {
        sx = mappedX + d;
        [top, bottom] = scan(sx);
      }
    }
    if (bottom < top) throw new Error("Swing strip source has no paint in its content bounds");
    const sourceHalf = Math.max(1, Math.ceil((bottom - top + 1) / 2));
    for (let y = 0; y < stripHeight; y++) {
      const mirrored = Math.min(y, stripHeight - 1 - y);
      const sy = top + Math.min(sourceHalf - 1, Math.floor((mirrored / Math.max(1, half - 1)) * sourceHalf));
      const si = (sy * input.width + sx) * 4;
      const di = ((margin + y) * width + x) * 4;
      out.data.set(input.data.subarray(si, si + 4), di);
      // This is a texture cross-section, not an antialiased silhouette. Its
      // outer edge is the same hard pixel row in every column.
      out.data[di + 3] = 255;
    }
  }
  // The texture wraps from the last sample back to the first. Copying the
  // seam column makes the join exact rather than merely visually similar.
  for (let y = 0; y < height; y++) {
    const first = (y * width) * 4;
    const last = (y * width + width - 1) * 4;
    out.data.set(out.data.subarray(first, first + 4), last);
  }
  return out;
}

/** The cap is already authored at its final 64x64 topology. */
function fitSwingTip(input: PNG, width: number, height: number): PNG {
  if (input.width !== width || input.height !== height)
    throw new Error(`Swing tip must be delivered at ${width}x${height}, got ${input.width}x${input.height}`);
  const out = new PNG({ width, height });
  out.data.set(input.data);
  return out;
}

/** Fits the fixed lightning shape while keeping its world anchor at bottom centre. */
function fitLightningBolt(input: PNG, width: number, height: number, frame: number): PNG {
  const centred = fit(input, width, false, height);
  const [l, _t, r, b] = contentBounds(centred);
  const dx = Math.round(width / 2 - (l + r) / 2);
  const dy = height - b;
  const out = new PNG({ width, height });
  out.data.fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const si = (y * width + x) * 4;
    if (centred.data[si + 3] === 0) continue;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    // Frame zero is the leader descending from above. It has not contacted
    // the floor yet; the complete grounded channel belongs to frame one.
    if (frame === 0 && ny > Math.floor(height * 0.68)) continue;
    out.data.set(centred.data.subarray(si, si + 4), (ny * width + nx) * 4);
  }
  return out;
}

/** Small raster animation transforms preserve the anatomy of the approved art. */
function animate(base: PNG, motion: Motion): PNG {
  if (motion === "none") return base;
  const out = new PNG({ width: base.width, height: base.height }); out.data.fill(0);
  const w = base.width, h = base.height;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (base.data[i + 3] === 0) continue;
    let dx = 0, dy = 0;
    if (motion === "bob") dy = 1;
    if ((motion === "legs" || motion === "ribbons") && y > h * 0.62) dx = x < w / 2 ? -1 : 1;
    if (motion === "shoulders" && y > h * 0.14 && y < h * 0.48) dy = 1;
    if (motion === "sigil" && y < h * 0.22) dy = -1;
    if (motion === "breath" && y > h * 0.18 && y < h * 0.7) dy = y < h * 0.42 ? -1 : 0;
    if (motion === "hit0") { dx = y < h * 0.72 ? -3 : -1; dy = y < h * 0.35 ? 1 : 0; }
    if (motion === "hit1") { dx = y < h * 0.72 ? -5 : -2; dy = y < h * 0.45 ? 2 : 1; }
    if (motion === "death") {
      // One undirected collapsed pose: wider, lower and compressed without
      // inventing anatomy that can drift between archetypes.
      const xx = Math.round(w / 2 + (x - w / 2) * 1.18);
      const yy = Math.round(h * 0.58 + (y - h * 0.28) * 0.48);
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const di = (yy * w + xx) * 4;
      out.data.set(base.data.subarray(i, i + 4), di);
      continue;
    }
    if (motion === "flame" && y < h * 0.5) dx = y % 4 < 2 ? 1 : -1;
    if (motion === "ring" && Math.hypot(x - w / 2, y - h / 2) > Math.min(w, h) * 0.27) {
      dx = Math.sign(h / 2 - y); dy = Math.sign(x - w / 2);
    }
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const di = (yy * w + xx) * 4;
    out.data.set(base.data.subarray(i, i + 4), di);
    if (motion === "pulse" || motion === "sheen") {
      const n = Math.min(w, h);
      const factor = motion === "pulse" ? 1.1 : (Math.abs(x - y - n * 0.1) < n * 0.12 ? 1.14 : 1);
      for (let c = 0; c < 3; c++) out.data[di + c] = Math.min(255, Math.round(out.data[di + c]! * factor));
    }
  }
  return out;
}

/**
 * Makes a real four-frame gait from the expansion sheets' neutral body pose.
 *
 * Those sheets supplied one locomotion drawing per facing, while the manifest
 * promises walk0..3. Reusing the same `legs` transform four times left the
 * atlas with four byte-identical frames; the renderer's cadence then looked
 * like the whole enemy was hopping in place. Keep the torso and weapon socket
 * fixed and alternate only the separated lower limbs around the planted
 * centre cloth/body.
 */
function animateWalkCycle(base: PNG, phase: number): PNG {
  const out = new PNG({ width: base.width, height: base.height });
  out.data.fill(0);
  const centre = base.width / 2;
  const jointY = base.height * 0.6;
  const centreBand = base.width * 0.13;
  const xShift = [
    [-2, 2],
    [-1, 1],
    [1, -1],
    [-1, 1],
  ][phase] ?? [0, 0];
  const yShift = [
    [0, 0],
    [1, -1],
    [0, 0],
    [-1, 1],
  ][phase] ?? [0, 0];

  for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) {
    const si = (y * base.width + x) * 4;
    if (base.data[si + 3] === 0) continue;
    let dx = 0, dy = 0;
    if (y > jointY && Math.abs(x - centre) > centreBand) {
      const side = x < centre ? 0 : 1;
      dx = xShift[side]!;
      dy = yShift[side]!;
    }
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= base.width || yy >= base.height) continue;
    out.data.set(base.data.subarray(si, si + 4), (yy * base.width + xx) * 4);
  }
  return sealAnimationScanlines(out, "legs");
}

/**
 * Repairs the one-pixel transparent scanline left by a piecewise animation.
 *
 * `animate` moves regions of a sprite independently. At a moving region's
 * boundary, forward mapping can leave one destination row unwritten even
 * though the painted body continues immediately above and below it. That was
 * the horizontal "crack" visible across dormant and idle enemies. Only holes
 * bracketed by opaque paint on both vertical sides are filled, so exterior
 * transparency and intentional gaps between limbs remain untouched.
 */
function sealAnimationScanlines(image: PNG, motion: Motion): PNG {
  if (motion === "none") return image;
  const source = Buffer.from(image.data);
  for (let y = 1; y < image.height - 1; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4;
    if (source[i + 3] !== 0) continue;
    const above = i - image.width * 4;
    const below = i + image.width * 4;
    if (source[above + 3] === 0 || source[below + 3] === 0) continue;
    image.data[i] = Math.round((source[above]! + source[below]!) / 2);
    image.data[i + 1] = Math.round((source[above + 1]! + source[below + 1]!) / 2);
    image.data[i + 2] = Math.round((source[above + 2]! + source[below + 2]!) / 2);
    image.data[i + 3] = 255;
  }
  return image;
}

/**
 * Honour the reserved enemy-magenta band without reducing colour count.
 * Imported shop stock becomes amber and the UI heart is red, not enemy pink.
 * Restore pink saturation in any clipped highlight of the enemy pulse frame,
 * so every visible enemy-bullet pixel survives room mood unchanged.
 */
function enforceReadability(image: PNG, name: string): PNG {
  const darkenFloorDamage = ["deco_crack_", "deco_stain_", "deco_scorch"]
    .some((prefix) => name.startsWith(prefix));
  const enemyAirProjectile = name.startsWith("vfx_lob_shot_") || name.startsWith("vfx_coal_");
  for (let i = 0; i < image.data.length; i += 4) {
    // The melee revision deliberately keeps the native pixel-art edge. Area
    // fitting can create a soft one-pixel fringe, so snap it back to binary
    // alpha after resampling instead of letting a third of a tiny effect fade.
    if (image.data[i + 3]! < 128) {
      image.data.fill(0, i, i + 4);
      continue;
    }
    image.data[i + 3] = 255;
    // Cracks, stains and scorches are damage to the floor surface. They must
    // read as shadow instead of emitted light, especially now that a bright
    // branching lightning attack shares the play field with them.
    if (darkenFloorDamage) {
      image.data[i] = Math.round(image.data[i]! * 0.55);
      image.data[i + 1] = Math.round(image.data[i + 1]! * 0.55);
      image.data[i + 2] = Math.round(image.data[i + 2]! * 0.55);
    }
    if (name.startsWith("pickup_heart_") && image.data[i + 2]! > image.data[i]! + 40) {
      const blue = image.data[i + 2]!;
      image.data[i + 2] = image.data[i]!;
      image.data[i] = blue;
    }
    const hex = "#" + [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!]
      .map((v) => v.toString(16).padStart(2, "0")).join("");
    const [h, s, l] = rgbToHsl(hex);
    let replacement: string | undefined;
    if ((name.startsWith("bullet_enemy") || enemyAirProjectile) && !isProtected(h, s))
      replacement = hslToHex(328, Math.max(0.7, s), Math.min(0.96, Math.max(0.03, l)));
    else if (
      !name.startsWith("bullet_enemy") && !enemyAirProjectile && !name.endsWith("_tele") && name !== "vfx_enemy_threat_wedge" &&
      s >= 0.25 && (isProtected(h, s) || h > 275)
    )
      /*
       * The dropped heart is red, like the one in the HUD.
       *
       * It was coming out **blue**. The rule above sweeps everything purple or
       * magenta to the cool hue, which is what keeps the sheet clear of the
       * enemy-bullet band — and the delivered heart sits inside that band, so
       * the sweep caught the one pickup in the game whose entire job is to say
       * *health*. The red/blue swap below the sweep was written for a heart
       * delivered blue and never fired on a heart delivered purple.
       *
       * A pickup that means health and a heart in the HUD that means health
       * must be the same colour or neither means anything.
       */
      replacement = hslToHex(
        name.startsWith("prop_shop") ? 42
          : name === "ui_heart_full" || name.startsWith("pickup_heart") ? 0
          : name === "ui_mana_pip" ? 190
          : 240,
        s,
        l,
      );
    if (replacement) image.data.set(hexToRgb(replacement), i);
  }
  return image;
}

/** Every enemy body frame must keep twelve luminance points clear of floor. */
function liftEnemyValue(image: PNG, name: string): PNG {
  if (!name.startsWith("enemy_")) return image;
  const expansionEnemy = name.startsWith("enemy_rifter_") || EXPANSION_BODY_KINDS.some((kind) => name.startsWith(`enemy_${kind}_`));
  // These sheets were authored against the floor value directly; the legacy
  // lift would move their dark blue mean toward the floor instead of away.
  if (expansionEnemy) {
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i + 3] === 0) continue;
      for (let c = 0; c < 3; c++) image.data[i + c] = Math.round(image.data[i + c]! * 0.8);
    }
    return image;
  }
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] === 0) continue;
    const hex = "#" + [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!]
      .map((v) => v.toString(16).padStart(2, "0")).join("");
    const [h, s] = rgbToHsl(hex);
    if (isProtected(h, s)) continue;
    const reaction = /(?:_hit[01]|_death)$/.test(name);
    const factor = name === "enemy_lancer_burst" ? 2.05
      : reaction ? 1.55
      : name.startsWith("enemy_lancer_") ? 1.58
      : /^enemy_rusher_[snw]_(windup|lunge)$/.test(name) ? 1.46
      : name.startsWith("enemy_tank_") ? 1.38
      : 1.34;
    for (let c = 0; c < 3; c++) image.data[i + c] = Math.min(255, Math.round(image.data[i + c]! * factor));
  }
  return image;
}

function recenter(image: PNG): PNG {
  const [l, t, r, b] = contentBounds(image);
  const dx = Math.round(image.width / 2 - (l + r) / 2);
  const dy = Math.round(image.height / 2 - (t + b) / 2);
  if (dx === 0 && dy === 0) return image;
  const out = new PNG({ width: image.width, height: image.height });
  out.data.fill(0);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue;
    const si = (y * image.width + x) * 4;
    if (image.data[si + 3] === 0) continue;
    out.data.set(image.data.subarray(si, si + 4), (ny * image.width + nx) * 4);
  }
  return out;
}

/** Put the sword's brown grip at the rotation origin in the frame centre. */
function alignSwordGrip(image: PNG): PNG {
  const [l, _t, r] = contentBounds(image);
  const cyan: number[] = [];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4;
    if (image.data[i + 3] === 0) continue;
    const [h, s, light] = rgbToHsl("#" + [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!]
      .map((v) => v.toString(16).padStart(2, "0")).join(""));
    if (h >= 165 && h <= 205 && s > 0.45 && light > 0.2) cyan.push(x);
  }
  if (!cyan.length) throw new Error("weapon_player_sword has no cyan grip gem to anchor");
  // In the approved design the wrapped grip is five final pixels left of the
  // gem's centre. The crossguard is on its right, so it is not the hand pivot.
  const gemX = cyan.reduce((a, b) => a + b, 0) / cyan.length;
  const pivot = gemX - 5;
  const cx = (image.width - 1) / 2;
  const scaleX = Math.min(1, cx / Math.max(1, pivot - l), cx / Math.max(1, r - pivot));
  const out = new PNG({ width: image.width, height: image.height });
  out.data.fill(0);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const sourceX = Math.round(pivot + (x - cx) / scaleX);
    if (sourceX < 0 || sourceX >= image.width) continue;
    const si = (y * image.width + sourceX) * 4;
    if (image.data[si + 3] === 0) continue;
    out.data.set(image.data.subarray(si, si + 4), (y * image.width + x) * 4);
  }
  return out;
}

/** Put the rusher claw's amber joint at its rotation origin. */
function alignEnemyClawJoint(image: PNG): PNG {
  const [l, t, r, b] = contentBounds(image);
  const amber: [number, number][] = [];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4;
    if (image.data[i + 3] === 0) continue;
    const [h, s, light] = rgbToHsl("#" + [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!]
      .map((v) => v.toString(16).padStart(2, "0")).join(""));
    if (h >= 28 && h <= 58 && s > 0.55 && light > 0.25) amber.push([x, y]);
  }
  if (!amber.length) throw new Error("weapon_enemy_rusher has no amber joint to anchor");
  const pivotX = amber.reduce((sum, p) => sum + p[0], 0) / amber.length;
  const pivotY = amber.reduce((sum, p) => sum + p[1], 0) / amber.length;
  const cx = (image.width - 1) / 2, cy = (image.height - 1) / 2;
  const scale = Math.min(
    1,
    cx / Math.max(1, pivotX - l), cx / Math.max(1, r - pivotX),
    cy / Math.max(1, pivotY - t), cy / Math.max(1, b - pivotY),
  );
  const out = new PNG({ width: image.width, height: image.height });
  out.data.fill(0);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const sx = Math.round(pivotX + (x - cx) / scale);
    const sy = Math.round(pivotY + (y - cy) / scale);
    if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
    const si = (sy * image.width + sx) * 4;
    if (image.data[si + 3] === 0) continue;
    out.data.set(image.data.subarray(si, si + 4), (y * image.width + x) * 4);
  }
  return out;
}

/**
 * The delivered spike states contain two differently painted metal plates.
 * Keep the retracted plate byte-for-byte and copy only the six raised spikes
 * (plus their two-pixel ink edge) from the active state. The trap can then
 * animate without the entire square flashing to a different blue.
 */
function shareSpikePlate(retracted: PNG, raised: PNG): PNG {
  if (retracted.width !== raised.width || retracted.height !== raised.height)
    throw new Error("Spike states must have matching dimensions");
  const { width, height } = raised;
  const bright = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // Ignore the plate rim and its corner rivets. Spike faces are the only
    // sizeable bright, narrow connected components in the inner panel.
    if (x < width * 0.18 || x >= width * 0.82 || y < height * 0.14 || y >= height * 0.72) continue;
    const i = (y * width + x) * 4;
    const value = 0.2126 * raised.data[i]! + 0.7152 * raised.data[i + 1]! + 0.0722 * raised.data[i + 2]!;
    if (raised.data[i + 3]! > 0 && value > 115) bright[y * width + x] = 1;
  }

  const seen = new Uint8Array(width * height);
  const spikePixels: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const start = y * width + x;
    if (!bright[start] || seen[start]) continue;
    const queue = [start], component: number[] = [];
    seen[start] = 1;
    while (queue.length) {
      const p = queue.pop()!;
      component.push(p);
      const px = p % width, py = Math.floor(p / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (bright[q] && !seen[q]) { seen[q] = 1; queue.push(q); }
      }
    }
    if (component.length >= 20) spikePixels.push(...component);
  }
  if (spikePixels.length < 6 * 20) throw new Error("Could not isolate all six raised spikes");

  const mask = new Uint8Array(width * height);
  for (const p of spikePixels) {
    const x = p % width, y = Math.floor(p / width);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) mask[ny * width + nx] = 1;
    }
  }
  const out = new PNG({ width, height });
  out.data.set(retracted.data);
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    out.data.set(raised.data.subarray(i, i + 4), i);
  }
  return out;
}

export function generateArt(dir: string): { frames: number; sheet: [number, number] } {
  fileCache.clear();
  boundaryCache.clear();
  const entries = MANIFEST.map(spec => {
    const recipe = sourceFor(spec.name);
    const width = spec.width ?? SIZE[spec.size];
    const height = spec.height ?? SIZE[spec.size];
    const wall = spec.name.startsWith("tile_wall_");
    const input = wall ? null : readSource(recipe.source);
    const exact4x = input !== null && input.width === width * 4 && input.height === height * 4;
    const fitted = wall
      ? harmonizeWallValue(composeWall(spec.name, width, height))
      : exact4x && input !== null
      ? fitAuthored4x(input, width, height)
      : spec.name.startsWith("vfx_offhand_")
      ? fitAtContentHeight(input!, width, height, 20)
      : spec.name.startsWith("vfx_bolt_")
          ? fitLightningBolt(input!, width, height, Number(spec.name.at(-1)))
        : fit(input!, width, recipe.source.full ?? false, height);
    const prepared = spec.name === "prop_reward_stat_0" ? paintStatPedestal(fitted) : fitted;
    const expansionWalk = spec.name.match(/^enemy_(?:warden|bellringer|snarecaster|delver|cinderling)_[snw]_walk([0-3])$/);
    const animated = expansionWalk
      ? animateWalkCycle(prepared, Number(expansionWalk[1]))
      : sealAnimationScanlines(animate(prepared, recipe.motion), recipe.motion);
    const image = enforceReadability(liftEnemyValue(animated, spec.name), spec.name);
    const aligned = spec.name === "weapon_player_sword" ? alignSwordGrip(image)
      : spec.name === "weapon_enemy_rusher" ? alignEnemyClawJoint(image)
      : image;
    return { spec, image: spec.centred ? recenter(aligned) : aligned };
  });
  const spikeOff = entries.find(({ spec }) => spec.name === "hazard_spike_0");
  const spikeOn = entries.find(({ spec }) => spec.name === "hazard_spike_1");
  if (!spikeOff || !spikeOn) throw new Error("Spike states missing from manifest");
  spikeOn.image = shareSpikePlate(spikeOff.image, spikeOn.image);
  entries.sort((a, b) => b.image.height - a.image.height);
  const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
  let x = 0, y = 0, rowHeight = 0;
  for (const { spec, image } of entries) {
    if (x + image.width > WIDTH) { x = 0; y += rowHeight; rowHeight = 0; }
    frames[spec.name] = { x, y, w: image.width, h: image.height };
    x += image.width; rowHeight = Math.max(rowHeight, image.height);
  }
  const sheet = new PNG({ width: WIDTH, height: y + rowHeight }); sheet.data.fill(0);
  for (const { spec, image } of entries) {
    const f = frames[spec.name]!;
    PNG.bitblt(image, sheet, 0, 0, image.width, image.height, f.x, f.y);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sprites.png"), PNG.sync.write(sheet));
  const playerAnchors = JSON.parse(
    readFileSync(join(SOURCE_DIR, "player-anchors.json"), "utf8"),
  ) as Record<string, unknown>;
  writeFileSync(join(dir, "sprites.json"), JSON.stringify({ frames, playerAnchors }, null, 2) + "\n");
  const report = checkAssets(dir);
  if (!report.ok) throw new Error(formatReport(report));
  const marker = join(dir, ".placeholder");
  if (existsSync(marker)) unlinkSync(marker);
  return { frames: entries.length, sheet: [sheet.width, sheet.height] };
}
