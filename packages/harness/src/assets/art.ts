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
import { SUBSPECIES_ART_BY_ID, drawMark, paletteTable } from "./subspecies.ts";
import { MANIFEST, MID_FLOOR_VARIANTS, SIZE, atScale, type FrameSpec } from "./manifest.ts";
import { checkAssets, formatReport } from "./check.ts";
import { loadModel, modelFrames, modelNames, partFrame } from "./models.ts";
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
/**
 * The atlas's width, which is what keeps its height inside a texture limit.
 *
 * The sheet packs into rows, so the width sets how tall it ends up: at 2048
 * the roster's sprite models (doc 016) took it past 4300 rows, and 4096 is
 * the largest texture a WebGL implementation is obliged to support in either
 * direction. Widening rather than dropping frames keeps both sides under the
 * limit with room to spare.
 */
const WIDTH = 4096;
const originals = "originals/characters.png";
const props = "originals/props-boss.png";
const fileCache = new Map<string, PNG>();
const boundaryCache = new Map<string, number>();
const biomeLayouts = new Map<string, Record<string, { x: number; y: number; w: number; h: number }>>();

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
/** Frames in the drawn walk cycles of the expansion bodies; see `drawnWalk`. */
export const EXPANSION_WALK_FRAMES = 6;

function sourceFor(name: string): Recipe {
  const bossWeapon = /^weapon_boss_(sword|fist_p[123])$/.exec(name);
  if (bossWeapon) return {
    source: { file: `melee/${bossWeapon[1] === "sword" ? "boss-king-sword" : `boss-king/${bossWeapon[1]}`}.png`, crop: [0, 0, 1, 1], fractional: true },
    motion: "none",
  };
  const bossIdentity = /^boss_p([123])_model_stand$/.exec(name);
  if (bossIdentity) return {
    source: { file: `originals/boss-king-p${bossIdentity[1]}.png`, crop: [0, 0, 1, 1], fractional: true },
    motion: "none",
  };
  const wideBoss = /^boss_p([123])_((?:sweep_(?:front|back)|cleave_front)_[a-z]+)$/.exec(name);
  if (wideBoss) return {
    source: { file: `melee/boss-king/wide/p${wideBoss[1]}/${wideBoss[2]}.png`, crop: [0, 0, 1, 1], fractional: true },
    motion: "none",
  };
  const approvedBoss = /^boss_p([123])_(idle[0-3]|ceremony[01]|tele1?|windup|commit|follow|hit[01]|leap_gather|leap_air|slam(?:_lift|_drive)?|hook|backhand|walk[0-5]|sweep_(?:wind|enter|cross|mid|cut|recover|reset)|cleave_(?:raise|fall|cut|hold|stuck)|dash_(?:cut|skid)|recover|chain_(?:wind|cast|follow)|hook_(?:wind|reel)|stagger[01])$/.exec(name);
  if (approvedBoss) return {
    source: { file: `melee/boss-king/p${approvedBoss[1]}/${approvedBoss[2]}.png`, crop: [0, 0, 1, 1], fractional: true },
    motion: "none",
  };
  const kingPart = /^(boss_(?:unbind_[12]|debris_(?:pauldron_[lr]|helm|breastplate_[lr]|cape)|chain_(?:link_face|link_edge|hook_head)))$/.exec(name);
  if (kingPart) return {
    source: { file: `melee/boss-king/${name.slice(5)}.png`, crop: [0, 0, 1, 1], fractional: true },
    motion: "none",
  };
  const kingStory = /^(?:boss_throne_(seated|empty|goblet|notice|throw|rise)|boss_death([012]))$/.exec(name);
  if (kingStory) return {
    source: { file: `melee/boss-king/${kingStory[1] ? `throne_${kingStory[1]}` : `death${kingStory[2]}`}.png`, crop: [0, 0, 1, 1], fractional: true },
    motion: "none",
  };
  const gobletTurn = /^vfx_goblet_([0-3])$/.exec(name);
  if (gobletTurn) return {
    source: { file: "melee/boss-king-goblet.png", crop: [Number(gobletTurn[1]) * 256, 0, (Number(gobletTurn[1]) + 1) * 256, 256] },
    motion: "none",
  };
  if (name === "deco_wine_splash") return {
    source: { file: "melee/boss-king-wine-splash.png", crop: [0, 0, 1, 1], fractional: true },
    motion: "none",
  };
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
    // The inner corners are cut from the corners (`innerCorner`); they name one.
    if (name.startsWith("tile_wall_inner_")) {
      const corner = name.slice("tile_wall_inner_".length);
      return sourceFor(`tile_wall_${corner}`);
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
      "void_orb", "plague_bloom",
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
  if (wallCase.startsWith("inner_")) return innerCorner(wallCase.slice("inner_".length), width, height);
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
 * The cap square for the inside of an L, taken from the authored corner of
 * the same name and nothing else of it.
 *
 * A wall cell whose two neighbours at a corner are walls, with the floor on
 * the diagonal between them, is closed on every side the four-neighbour mask
 * sees, so it is drawn solid; the caps of the two neighbours then both stop
 * at its corner and the lit edge breaks there. The renderer lays this square
 * over that corner (`innerCorners`), so the cap turns it.
 */
function innerCorner(corner: string, width: number, height: number): PNG {
  const legacyIndex: Readonly<Record<string, number>> = { ne: 9, wn: 10, es: 11, sw: 12 };
  const i = legacyIndex[corner];
  if (i === undefined) throw new Error(`No wall corner ${corner}`);
  const src = fit(readSource({ ...grid("terrain", i % 4, Math.floor(i / 4), 4, 4), full: true }), width, true, height);
  const bandX = Math.max(1, Math.round(width / 4));
  const bandY = Math.max(1, Math.round(height / 4));
  const x0 = corner === "ne" || corner === "es" ? width - bandX : 0;
  const y0 = corner === "es" || corner === "sw" ? height - bandY : 0;
  const out = new PNG({ width, height });
  out.data.fill(0);
  for (let y = y0; y < y0 + bandY; y++) for (let x = x0; x < x0 + bandX; x++) {
    const k = (y * width + x) * 4;
    out.data.set(src.data.subarray(k, k + 4), k);
  }
  return out;
}

/**
 * Breaks the seam a wall tile makes with its neighbour.
 *
 * Every course of bricks in the delivered wall ends at the tile's edge, so
 * tiled side by side the joints lined up into one mortar line down the whole
 * wall every tile: the wall read as a grid of blocks, not as masonry. Every
 * other course is turned half a tile round, so its joint at the edge moves to
 * the middle and the courses break joint across the boundary as bricks do. A
 * whole-pixel rotation of rows the tile already has: nothing is redrawn.
 *
 * Only where courses run the tile's width: the solid wall and walls whose cap
 * is along the top or bottom. A course holding cap is left, since the cap's
 * ends are drawn to meet the tile's edge.
 */
function staggerCourses(image: PNG, name: string): PNG {
  const wallCase = name.slice("tile_wall_".length);
  if (!["solid", "n", "s", "ns"].includes(wallCase)) return image;
  const { width: w, height: h } = image;
  const luma = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return image.data[i]! * 0.3 + image.data[i + 1]! * 0.59 + image.data[i + 2]! * 0.11;
  };
  // A mortar row is mostly dark; a cap row is bright on average.
  const mortar: boolean[] = [], cap: boolean[] = [];
  for (let y = 0; y < h; y++) {
    let dark = 0, sum = 0;
    for (let x = 0; x < w; x++) { const l = luma(x, y); sum += l; if (l < 45) dark++; }
    mortar.push(dark >= w * 0.3);
    cap.push(sum / w > 90);
  }
  const courses: [number, number][] = [];
  let start = -1;
  for (let y = 0; y <= h; y++) {
    const inCourse = y < h && !mortar[y];
    if (inCourse && start < 0) start = y;
    if (!inCourse && start >= 0) { courses.push([start, y]); start = -1; }
  }
  const out = new PNG({ width: w, height: h });
  image.data.copy(out.data);
  const shift = Math.round(w / 2);
  courses.forEach(([y0, y1], i) => {
    if (i % 2 === 0) return;
    for (let y = y0; y < y1; y++) if (cap[y]) return;
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
      const si = (y * w + ((x + shift) % w)) * 4, di = (y * w + x) * 4;
      out.data.set(image.data.subarray(si, si + 4), di);
    }
  });
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

/** Older boss keys use a larger cell; fit their painted silhouette to the same feet line. */
function fitBossKey(input: PNG, width: number, height: number): PNG {
  if (input.width === width * 4 && input.height === height * 4) return fitAuthored4x(input, width, height);
  if (input.width % 4 || input.height % 4) throw new Error(`boss key is not on a 4x grid: ${input.width}x${input.height}`);
  const sourceWidth = input.width / 4, sourceHeight = input.height / 4;
  let left = sourceWidth, top = sourceHeight, right = -1, bottom = -1;
  const pixel = (x: number, y: number) => (((y * 4) + 2) * input.width + (x * 4) + 2) * 4;
  for (let y = 0; y < sourceHeight; y++) for (let x = 0; x < sourceWidth; x++) {
    if (input.data[pixel(x, y) + 3]! < 220) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error("empty boss key");
  const scale = Math.min((width - 16) / (right - left + 1), (height - 48) / (bottom - top + 1));
  const cx = (left + right) / 2, floor = height - 32;
  const out = new PNG({ width, height }); out.data.fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.floor(cx + (x + .5 - width / 2) / scale);
    const sy = Math.floor(bottom + (y + .5 - floor) / scale);
    if (sx < 0 || sx >= sourceWidth || sy < 0 || sy >= sourceHeight) continue;
    const si = pixel(sx, sy), di = (y * width + x) * 4;
    if (input.data[si + 3]! >= 220) out.data.set(input.data.subarray(si, si + 4), di);
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
 * A walk cycle drawn from one standing frame, by moving parts in whole pixels
 * — the way a small pixel-art walk is drawn, never by turning anything, so
 * every frame is the sheet's own pixels (doc 008).
 *
 * The body is split by its own bounds: the legs are the band below 72% of
 * its height, left and right of the middle; the arms are the outer thirds of
 * the band above; the rest is the body and head. Then, for frame `i` of `n`:
 *
 * - each foot travels along the facing (down the screen for a body facing
 *   south, up for north, along x for the side view) and **lifts** as it
 *   passes under the body — one or two pixels at the passing position;
 * - the body **rises a pixel as the feet pass** and, for a heavy body, sinks
 *   one as a foot lands;
 * - the arms swing against the legs (seen from the side, they ride the body);
 * - seams the moves open inside the body's own outline are closed from their
 *   neighbours.
 *
 * The cycle replaced a shift of the lower half left and right by a pixel or
 * two, which kept the feet on the ground and the body still: it read as a
 * body sliding, not walking.
 */
function drawnWalk(base: PNG, i: number, n: number, facing: "s" | "n" | "w", heavy: boolean): PNG {
  const W = base.width;
  const H = base.height;
  let top = H, bottom = 0, left = W, right = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (base.data[(y * W + x) * 4 + 3] === 0) continue;
    top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x);
  }
  const h = bottom - top + 1;
  const w = right - left + 1;
  const mid = Math.round((left + right) / 2);
  const legTop = top + Math.round(h * 0.72);
  const armTop = top + Math.round(h * 0.34);
  const armSpan = w * 0.3;

  const phase = (k: number) => (2 * Math.PI * (((k % n) + n) % n)) / n;
  const stride = (k: number) => Math.sin(phase(k));
  // The swing foot is highest as it passes under the body: at phase 0 for the left, π for the right.
  // Two pixels at the pass, one either side of it: every frame of the cycle is its own drawing.
  const lift = (k: number, right: boolean) => -Math.round(2 * Math.max(0, (right ? -1 : 1) * Math.cos(phase(k))) ** 1.5);
  const bob = (k: number) => {
    const c = Math.abs(Math.cos(phase(k)));
    const s = Math.abs(Math.sin(phase(k)));
    return c > 0.9 ? -1 : heavy && s > 0.85 ? 1 : 0;
  };

  type Off = [number, number];
  const foot = (right: boolean): Off => {
    const f = (right ? -1 : 1) * stride(i);
    const along = Math.round(f * (facing === "w" ? 1.5 : 1));
    const l = lift(i, right);
    if (facing === "w") return [-along, l];
    return [0, (facing === "s" ? along : -along) + l];
  };
  const arm = (right: boolean): Off => {
    const f = (right ? 1 : -1) * stride(i);
    const along = Math.round(f * 0.8);
    // Seen from the side the arms are over the body; they ride it rather than
    // slide across it, which opened columns through the torso.
    if (facing === "w") return [0, bob(i)];
    return [0, (facing === "s" ? along : -along) + bob(i)];
  };
  const regionOf = (x: number, y: number): "legL" | "legR" | "armL" | "armR" | "body" | "head" => {
    if (y >= legTop) return x < mid ? "legL" : "legR";
    if (y >= armTop && x < left + armSpan) return "armL";
    if (y >= armTop && x > right - armSpan) return "armR";
    return y < armTop ? "head" : "body";
  };
  const offsets: Record<string, Off> = {
    legL: foot(false), legR: foot(true), armL: arm(false), armR: arm(true),
    // The head rides with the body. A frame's lag split it from the body at
    // a line that, on a helmeted body, runs through the face.
    body: [0, bob(i)], head: [0, bob(i)],
  };

  const out = new PNG({ width: W, height: H });
  out.data.fill(0);
  // Legs first, then the body over their tops, then the arms: what is
  // further from the eye is painted first.
  for (const layer of [["legL", "legR"], ["body", "head"], ["armL", "armR"]] as const) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      if (base.data[si + 3] === 0) continue;
      const r = regionOf(x, y);
      if (!(layer as readonly string[]).includes(r)) continue;
      const [dx, dy] = offsets[r]!;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      out.data.set(base.data.subarray(si, si + 4), (yy * W + xx) * 4);
      // A leg lowered by a pixel shows where it meets the body: carry its top
      // row up into the gap rather than leave a hole.
      if (r.startsWith("leg") && y === legTop && dy > 0)
        for (let g = 1; g <= dy; g++) if (yy - g >= 0) out.data.set(base.data.subarray(si, si + 4), ((yy - g) * W + xx) * 4);
    }
  }
  // Close the seams: a pixel the standing body had, left empty by the moves,
  // with the body on both sides of it across or down, takes a neighbour's colour.
  for (let pass = 0; pass < 2; pass++) {
    const src = Buffer.from(out.data);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = (y * W + x) * 4;
      if (src[k + 3] !== 0 || base.data[k + 3] === 0) continue;
      const at = (xx: number, yy: number) => (yy * W + xx) * 4;
      const pair = src[at(x - 1, y) + 3] !== 0 && src[at(x + 1, y) + 3] !== 0 ? at(x - 1, y)
        : src[at(x, y - 1) + 3] !== 0 && src[at(x, y + 1) + 3] !== 0 ? at(x, y - 1)
        : -1;
      if (pair < 0) continue;
      out.data.set(src.subarray(pair, pair + 4), k);
    }
  }
  return out;
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
/**
 * A body's telegraph frame, which is the one enemy drawing allowed the
 * reserved magenta. `_tele1` is the second frame of the same lit pose — a
 * sprite model composes the pair so a locked-on emplacement breathes rather
 * than holding a still (doc 016) — and it has to be exempt for the same
 * reason `_tele` is: swept to the cool hue, the pair alternated between
 * magenta and cyan, which reads as two states flickering rather than one.
 */
const TELEGRAPH_FRAME = /_tele\d?$/;

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
      !name.startsWith("bullet_enemy") && !enemyAirProjectile && !TELEGRAPH_FRAME.test(name) && name !== "vfx_enemy_threat_wedge" &&
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

/**
 * The roster's value band: how dark a body is allowed to be, and how light.
 *
 * Every enemy used to be **multiplied** into readability. The floor sits at a
 * mean luminance of about 83, the check asks a body to stay twelve points off
 * it, and the cheapest way to do that is upward — so the legacy bodies were
 * scaled by 1.34 to 1.58 and came out at 104 to 122, with a fifth of their
 * pixels at pure white. In a bright room the mood lifts everything another
 * 14% and they read as pale blobs that glow: brighter than the floor they
 * stand on, brighter than the player, and the same value as a pickup.
 *
 * Twelve points off the floor is the right rule and *up* was the wrong
 * direction. A body is a solid thing in a lit room: it should be darker than
 * the stone, and what separates it from the stone is its own ink, its hue and
 * its cast shadow, not its brightness. So instead of a multiply per body
 * there is one curve for the whole roster, applied in HSL so hue and
 * saturation are untouched:
 *
 *     L' = CAP * L ** GAMMA
 *
 * The exponent pulls the mass down — a mid tone at 0.5 lands near 0.36 —
 * while leaving the top of the ramp near the top, so highlights still read as
 * highlights. The cap holds even a pure white below the white of pickups,
 * effects and the HUD, which are the things that are *meant* to be the
 * brightest pixels on the screen.
 *
 * The protected enemy-bullet hue is skipped, as it is everywhere else.
 *
 * Sprite models inherit the band rather than repeating it: a model is split
 * from these frames, so its palette is already banded and its composed frames
 * are never put through this again (`generateArt`).
 */
const ENEMY_VALUE_GAMMA = 1.3;
const ENEMY_VALUE_CAP = 0.84;

export function enemyValueBand(image: PNG, name: string): PNG {
  if (!name.startsWith("enemy_") && !name.startsWith("boss_")) return image;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] === 0) continue;
    const hex = "#" + [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!]
      .map((v) => v.toString(16).padStart(2, "0")).join("");
    const [h, s, l] = rgbToHsl(hex);
    if (isProtected(h, s)) continue;
    const lit = ENEMY_VALUE_CAP * l ** ENEMY_VALUE_GAMMA;
    /*
     * Carry the **chroma** down, not the saturation.
     *
     * Saturation in HSL is measured against how much room the lightness
     * leaves, so a near-white keeps a saturation it never shows: the
     * summoner's cream trim is 0.5 saturated at a lightness of 0.92, where it
     * reads as white. Held at 0.5 and dropped to 0.75 it reads as **tan** —
     * the body's identity colour changes, which is not what a value band is
     * for. Chroma is the absolute colourfulness and is what the eye actually
     * sees, so it is what is preserved; the clamp keeps the rule one-way, so
     * a mid tone that gains room in the shadows does not come out louder than
     * it was drawn.
     */
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const room = Math.max(1e-3, 1 - Math.abs(2 * lit - 1));
    image.data.set(hexToRgb(hslToHex(h, Math.min(s, chroma / room), lit)), i);
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

/**
 * One frame as the delivered sheets make it: fitted from its source, moved,
 * made readable and centred. This is the figure a sprite model is split from
 * (`sprite:split`), so it never reads the models.
 */
/** Where the icons drawn as text live: `assets/icons/<id>.txt`, one per `icon_<id>`. */
const ICON_DIR = fileURLToPath(new URL("../../../../assets/icons/", import.meta.url));
/** And the effect frames: `assets/effects/<frame name>.txt`, drawn at the frame's own size. */
const EFFECT_DIR = fileURLToPath(new URL("../../../../assets/effects/", import.meta.url));

/**
 * An icon drawn as text: a header line of colours and sixteen rows of sixteen
 * characters. `.` is clear, `o` the outline ink, `w` the bone highlight, and
 * each digit the colour its header names (`1=#5a4a3a 2=#8a7a64 ...`), so a
 * school's ramp is three or four digits and the icons share one ink and one
 * highlight. Scaled by whole pixels to the frame, never resampled.
 */
export function textIcon(text: string, width: number, height: number, name: string): PNG {
  const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0 && !l.startsWith("#"));
  const header = lines.shift() ?? "";
  const colours = new Map<string, string>([["o", "#0d0b1f"], ["w", "#e8e3d8"]]);
  for (const m of header.matchAll(/([0-9a-z])=#([0-9a-fA-F]{6})/g)) colours.set(m[1]!, `#${m[2]}`);
  // The drawing's own size, so an effect frame can be authored at 48×80 as
  // readily as an icon at 16×16; a drawing smaller than its frame is scaled
  // by a whole number and centred, which is how the 16×16 icons are placed.
  const rows = lines.length;
  const cols = lines[0]?.length ?? 0;
  if (rows === 0 || cols === 0) throw new Error(`${name}: no rows`);
  if (lines.some((l) => l.length !== cols)) throw new Error(`${name}: every row must be ${cols} characters`);
  const k = Math.min(Math.floor(width / cols), Math.floor(height / rows));
  if (k < 1) throw new Error(`${name}: frame ${width}x${height} is smaller than its ${cols}x${rows} drawing`);
  const out = new PNG({ width, height });
  out.data.fill(0);
  const x0 = Math.floor((width - cols * k) / 2), y0 = Math.floor((height - rows * k) / 2);
  lines.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === ".") return;
    const hex = colours.get(ch);
    if (!hex) throw new Error(`${name}: no colour for ${ch}`);
    const [r, g, b] = hexToRgb(hex);
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++)
      out.data.set([r, g, b, 255], ((y0 + y * k + dy) * width + x0 + x * k + dx) * 4);
  }));
  return out;
}

export function deliveredFrame(spec: FrameSpec): PNG {
  const biomeId = /^(?:tile|deco|patch|prop)_(ossuary|flooded|furnace)_/.exec(spec.name)?.[1];
  if (biomeId) {
    let layout = biomeLayouts.get(biomeId);
    if (!layout) {
      layout = (JSON.parse(readFileSync(join(SOURCE_DIR, `biomes/${biomeId}.json`), "utf8")) as { frames: Record<string, { x: number; y: number; w: number; h: number }> }).frames;
      biomeLayouts.set(biomeId, layout);
    }
    const rect = layout[spec.name];
    if (!rect) throw new Error(`${spec.name}: missing painted biome cell`);
    const width = spec.width ?? SIZE[spec.size], height = spec.height ?? SIZE[spec.size];
    if (rect.w !== width || rect.h !== height) throw new Error(`${spec.name}: biome cell dimensions differ from manifest`);
    return readSource({ file: `biomes/${biomeId}.png`, crop: [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h] });
  }
  // Spell effects are painted at their final atlas dimensions; keep the
  // authored origin intact (especially the crescent's leading-edge anchor).
  if (/^vfx_(?:crescent_wave|meteor_rock|meteor_impact|frost_orb|ball_lightning|arc_seg|arc_cap|doom_rune|doom_burst|vortex|guard_answer|contagion_glob|landing_dust|gas_puff)/.test(spec.name)) {
    const file = join(SOURCE_DIR, `spells/${spec.name}.png`);
    const image = PNG.sync.read(readFileSync(file));
    if (image.width !== (spec.width ?? SIZE[spec.size]) || image.height !== (spec.height ?? SIZE[spec.size]))
      throw new Error(`${spec.name}: spell frame dimensions differ from manifest`);
    return image;
  }
  // These are already painted, placed, hard-alpha art pixels. In particular,
  // recentering their sword/cape bounds would move the feet between poses.
  if (/^(?:boss_p[123]_|boss_throne_|boss_death|boss_unbind_|boss_debris_|boss_chain_|weapon_boss_|vfx_goblet_|deco_wine_splash$)/.test(spec.name)) {
    const input = readSource(sourceFor(spec.name).source);
    try { return /^boss_p[123]_(?!model_stand)/.test(spec.name)
      ? fitBossKey(input, spec.width ?? SIZE[spec.size], spec.height ?? SIZE[spec.size])
      : fitAuthored4x(input, spec.width ?? SIZE[spec.size], spec.height ?? SIZE[spec.size]); }
    catch (error) { throw new Error(`${spec.name}: ${String(error)}`, { cause: error }); }
  }
  // An icon drawn as text takes precedence over any sheet (`textIcon`).
  if (spec.name.startsWith("icon_")) {
    const file = join(ICON_DIR, `${spec.name.slice(5)}.txt`);
    if (existsSync(file)) return textIcon(readFileSync(file, "utf8"), spec.width ?? SIZE[spec.size], spec.height ?? SIZE[spec.size], spec.name);
  }
  // Effect frames drawn as text, the same format at the frame's own size.
  {
    const file = join(EFFECT_DIR, `${spec.name}.txt`);
    if (existsSync(file)) return textIcon(readFileSync(file, "utf8"), spec.width ?? SIZE[spec.size], spec.height ?? SIZE[spec.size], spec.name);
  }
  // Made from the others after they are all fitted (`fineGrain`); a stand-in until then.
  if (spec.name.startsWith("tile_floor_fine_") || spec.name.startsWith("tile_floor_mid_") || spec.name === "tile_floor_drain_grate" || spec.name === "tile_wall_solid_fine")
    return deliveredFrame({ ...spec, name: spec.name.startsWith("tile_floor") ? "tile_floor_0" : "tile_wall_solid" });
  const recipe = sourceFor(spec.name);
  const width = spec.width ?? SIZE[spec.size];
  const height = spec.height ?? SIZE[spec.size];
  const wall = spec.name.startsWith("tile_wall_");
  const input = wall ? null : readSource(recipe.source);
  const exact4x = input !== null && input.width === width * 4 && input.height === height * 4;
  const fitted = wall
    ? harmonizeWallValue(staggerCourses(composeWall(spec.name, width, height), spec.name))
    : exact4x && input !== null
    ? fitAuthored4x(input, width, height)
    : spec.name.startsWith("vfx_offhand_")
    ? fitAtContentHeight(input!, width, height, 20)
    : spec.name.startsWith("vfx_bolt_")
        ? fitLightningBolt(input!, width, height, Number(spec.name.at(-1)))
      : fit(input!, width, recipe.source.full ?? false, height);
  const prepared = spec.name === "prop_reward_stat_0" ? paintStatPedestal(fitted) : fitted;
  const expansionWalk = spec.name.match(/^enemy_(warden|bellringer|snarecaster|delver|cinderling)_([snw])_walk(\d)$/);
  const animated = expansionWalk
    ? drawnWalk(prepared, Number(expansionWalk[3]), EXPANSION_WALK_FRAMES, expansionWalk[2] as "s" | "n" | "w", expansionWalk[1] === "warden")
    : sealAnimationScanlines(animate(prepared, recipe.motion), recipe.motion);
  const image = enforceReadability(enemyValueBand(animated, spec.name), spec.name);
  const aligned = spec.name === "weapon_player_sword" ? alignSwordGrip(image)
    : spec.name === "weapon_enemy_rusher" ? alignEnemyClawJoint(image)
    : image;
  return spec.centred ? recenter(aligned) : aligned;
}

/**
 * Halves a drawing's grain: 64 art pixels to 32, each 2×2 block becoming the
 * block's darkest pixel when it holds line work — so outlines and mortar
 * survive, a pixel thinner — and its median colour otherwise, which keeps the
 * drawing's own palette rather than averaging new colours into it.
 */
function halve(src: PNG): PNG {
  const w = src.width >> 1, h = src.height >> 1;
  const out = new PNG({ width: w, height: h });
  const lum = (i: number) => src.data[i]! * 0.3 + src.data[i + 1]! * 0.59 + src.data[i + 2]! * 0.11;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = [0, 1, 2, 3].map((k) => (((y * 2 + (k >> 1)) * src.width) + x * 2 + (k & 1)) * 4);
    const ls = px.map(lum);
    const darkest = ls.indexOf(Math.min(...ls));
    const mean = ls.reduce((a, b) => a + b, 0) / 4;
    const pick = ls[darkest]! < mean * 0.62 ? darkest : [...ls.keys()].sort((a, b) => ls[a]! - ls[b]!)[1]!;
    out.data.set(src.data.subarray(px[pick]!, px[pick]! + 4), (y * w + x) * 4);
  }
  return out;
}

/**
 * The fine-grained floor and solid wall (`tile_floor_fine_*`,
 * `tile_wall_solid_fine`): each tile four half-size drawings of the delivered
 * ones, the floor's taken from four different variants so the quarters do
 * not repeat. The delivered floor's stones are as big as a body, which at the
 * near camera read as standing on an enlarged floor.
 */
function fineGrain(entries: { spec: FrameSpec; image: PNG }[]): void {
  const get = (n: string) => entries.find((e) => e.spec.name === n)?.image;
  const plain = ["tile_floor_0", "tile_floor_4", "tile_floor_5", "tile_floor_6", "tile_floor_7"].map(get).filter((x): x is PNG => !!x).map(halve);
  const worn = ["tile_floor_1", "tile_floor_2"].map(get).filter((x): x is PNG => !!x).map(halve);
  const mosaic = (quarters: PNG[]): PNG => {
    const q = quarters[0]!;
    const out = new PNG({ width: q.width * 2, height: q.height * 2 });
    quarters.forEach((img, k) => PNG.bitblt(img, out, 0, 0, img.width, img.height, (k & 1) * q.width, (k >> 1) * q.height));
    return out;
  };
  for (const e of entries) {
    const m = e.spec.name.match(/^tile_floor_fine_(\d)$/);
    if (m) {
      const i = Number(m[1]);
      const pool = i === 1 || i === 2 ? [...worn, ...plain] : plain;
      e.image = mosaic([0, 1, 2, 3].map((k) => pool[(i * 3 + k * 2) % pool.length]!));
    }
    if (e.spec.name === "tile_wall_solid_fine") {
      const solid = get("tile_wall_solid");
      if (solid) { const h = halve(solid); e.image = mosaic([h, h, h, h]); }
    }
  }
}

/**
 * The floor at two thirds of its grain (`tile_floor_mid_<v>_<q>`): a drawing
 * two tiles square of three by three stones, each a delivered floor fitted
 * from its source at a third of the drawing rather than shrunk from the
 * delivered tile, and cut in four, one quarter a tile. Half the grain
 * (`fineGrain`) was too busy to stand on; the delivered one as big as a body.
 */
function midGrain(entries: { spec: FrameSpec; image: PNG }[]): void {
  const side = SIZE.s64 * 2;
  const edge = (k: number) => Math.round((k * side) / 3);
  const clean = ["tile_floor_0", "tile_floor_4", "tile_floor_5", "tile_floor_6", "tile_floor_7"];
  const worn = ["tile_floor_1", "tile_floor_2"];
  const slabs = new Map<string, PNG>();
  const slab = (name: string, w: number, h: number): PNG => {
    const key = `${name}:${w}x${h}`;
    let img = slabs.get(key);
    if (!img) { img = deliveredFrame({ name, size: "s64", centred: false, mayUseHot: false, width: w, height: h }); slabs.set(key, img); }
    return img;
  };
  const drawings: PNG[] = [];
  for (let v = 0; v < MID_FLOOR_VARIANTS; v++) {
    const out = new PNG({ width: side, height: side });
    for (let j = 0; j < 9; j++) {
      const cx = j % 3, cy = Math.floor(j / 3);
      const s = v * 9 + j;
      // Mostly clean stone, one worn slab in a drawing or so, no two alike side by side.
      const name = s % 11 === 4 ? worn[s % 2]! : clean[(s * 3 + cy) % clean.length]!;
      const x0 = edge(cx), y0 = edge(cy), w = edge(cx + 1) - x0, h = edge(cy + 1) - y0;
      const img = slab(name, w, h);
      PNG.bitblt(img, out, 0, 0, w, h, x0, y0);
    }
    drawings.push(out);
  }
  for (const e of entries) {
    const m = e.spec.name.match(/^tile_floor_mid_(\d+)_(\d)$/);
    if (!m) continue;
    const d = drawings[Number(m[1])]!, q = Number(m[2]);
    const out = new PNG({ width: SIZE.s64, height: SIZE.s64 });
    PNG.bitblt(d, out, (q & 1) * SIZE.s64, (q >> 1) * SIZE.s64, SIZE.s64, SIZE.s64, 0, 0);
    e.image = out;
  }
}

/**
 * The drain's grate and its riveted frame, cut from the drain tile onto
 * nothing, so a finer floor (`midGrain`, `fineGrain`) can lie round it: the
 * drain tile's own stones are a tile each and stood out among smaller ones.
 * The box is the frame's outline in the delivered tile, at the first scale.
 */
function drainGrate(entries: { spec: FrameSpec; image: PNG }[]): void {
  const drain = entries.find((e) => e.spec.name === "tile_floor_3")?.image;
  const grate = entries.find((e) => e.spec.name === "tile_floor_drain_grate");
  if (!drain || !grate) return;
  const [x0, y0, x1, y1] = [14, 12, 49, 47].map(atScale) as [number, number, number, number];
  const out = new PNG({ width: drain.width, height: drain.height });
  out.data.fill(0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * drain.width + x) * 4;
    out.data.set(drain.data.subarray(i, i + 4), i);
  }
  grate.image = out;
}

export function generateArt(dir: string): { frames: number; sheet: [number, number] } {
  fileCache.clear();
  boundaryCache.clear();
  // Bodies that are sprite models are composed, not fitted from a sheet
  // (doc 016). Their frames are already on the pixel grid and already placed
  // in the frame, so none of the fitting, motion or recentring below applies.
  const composed = new Map<string, { png: PNG; anchors: Record<string, unknown> }>();
  for (const name of modelNames())
    for (const [frame, f] of modelFrames(loadModel(name))) composed.set(frame, { png: f.png, anchors: f.composed.anchors });
  /*
   * The staff and the fist that holds it, cut from the player's model and
   * placed by the renderer rather than posed into the frames (doc 016).
   *
   * **No player frame draws a staff any more.** It used to be composed into
   * the idle, the walk and the cast and turned as a sprite only through a
   * cut, which meant two staffs to keep agreeing with each other and a jump
   * in position and depth the moment a swing began. One sprite in every
   * state is one thing to be right about: the model still owns the drawing,
   * the pose still owns where the hand is (`hand`) and which way the staff
   * points (`staffAngleDeg`), and the renderer does the placing.
   *
   * The fist is the same 8 px drawing in every key and every facing, so it
   * is one frame, not fifteen: it is painted over the shaft at the grip so
   * the hand visibly wraps it whichever way the staff is turned.
   */
  if (modelNames().includes("player")) {
    const player = loadModel("player");
    composed.set("weapon_player_staff", partFrame(player, "s", "staff", "up", null, SIZE.s96));
    composed.set("weapon_player_fist", partFrame(player, "s", "fist_overlay", "grip", "grip", SIZE.s32, undefined, 0));
  }
  const entries = MANIFEST.map(spec => {
    const model = composed.get(spec.name);
    if (model) return { spec, image: enforceReadability(model.png, spec.name) };
    if (/^(?:boss_p[123]_|boss_throne_|boss_death|boss_unbind_|boss_debris_|boss_chain_|weapon_boss_|vfx_goblet_|deco_wine_splash$)/.test(spec.name)) return { spec, image: deliveredFrame(spec) };
    // A subspecies' mark is drawn here, not delivered: one pose, no anatomy
    // to compose, so a model would add a round trip and nothing else (doc 016).
    const mark = /^mark_(.+)_([snw])$/.exec(spec.name);
    if (mark && SUBSPECIES_ART_BY_ID[mark[1]!]) {
      return { spec, image: drawMark(SUBSPECIES_ART_BY_ID[mark[1]!]!, mark[2] as "s" | "n" | "w") };
    }
    return { spec, image: deliveredFrame(spec) };
  });
  fineGrain(entries);
  midGrain(entries);
  drainGrate(entries);
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
  // A composed frame's anchors come from its parts' joints, not the table.
  // The staff sprite's own joints ride along, so the renderer knows how far
  // the crystal is from the grip without a constant of its own.
  for (const [frame, { anchors }] of composed)
    if (frame.startsWith("player_") || frame === "weapon_player_staff") playerAnchors[frame] = anchors;
  // B8: baked-sword boss frames use measured art anchors, not the withdrawn
  // model's joints. Keep `chain` as the runtime alias for `hand_l`.
  const bossAnchorSource = JSON.parse(readFileSync(join(SOURCE_DIR, "melee/boss-king-anchors.json"), "utf8")) as {
    frames: Record<string, { tip: [number, number]; hand_l: [number, number] }>;
  };
  const bossAnchors: Record<string, Record<string, unknown>> = {};
  for (const [frame, anchors] of Object.entries(bossAnchorSource.frames)) {
    if (!frames[frame]) continue;
    bossAnchors[frame] = { tip: anchors.tip, hand_l: anchors.hand_l, chain: anchors.hand_l };
  }
  // The wide cuts' own table, in their 336 px cells, with the pivot they are laid on (the feet).
  const wideAnchorSource = JSON.parse(readFileSync(join(SOURCE_DIR, "melee/boss-king/wide/anchors.json"), "utf8")) as {
    frames: Record<string, { tip: [number, number]; hand_l: [number, number]; pivot: [number, number] }>;
  };
  for (const [frame, anchors] of Object.entries(wideAnchorSource.frames)) {
    if (!frames[frame]) continue;
    bossAnchors[frame] = { tip: anchors.tip, hand_l: anchors.hand_l, chain: anchors.hand_l, pivot: anchors.pivot };
  }
  /*
   * **Enemy mark anchors** (doc 019): where a subspecies' mark hangs on each
   * of its base's frames. Only the `mark` anchor, and only the frames that
   * carry one, so the file grows by the bodies that have a variant rather
   * than by the whole roster — the player's own anchors stay in their table.
   */
  const markAnchors: Record<string, [number, number]> = {};
  for (const [frame, { anchors }] of composed) {
    const at = anchors.mark;
    if (Array.isArray(at)) markAnchors[frame] = [at[0], at[1]];
  }
  /*
   * **The palette table** (doc 019): what each subspecies' colours become,
   * from its base model's own ramps. It ships beside the frames because the
   * game already fetches this file, and because the two must agree — a table
   * built from a different palette than the atlas was packed from would swap
   * colours that are not in the sheet.
   */
  const subspecies = paletteTable(
    Object.fromEntries(modelNames().map((n) => [n, loadModel(n).palette])),
  );
  writeFileSync(join(dir, "sprites.json"),
    JSON.stringify({ frames, playerAnchors, bossAnchors, markAnchors, subspecies }, null, 2) + "\n");
  const report = checkAssets(dir);
  if (!report.ok) throw new Error(formatReport(report));
  const marker = join(dir, ".placeholder");
  if (existsSync(marker)) unlinkSync(marker);
  return { frames: entries.length, sheet: [sheet.width, sheet.height] };
}
