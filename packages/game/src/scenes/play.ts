/**
 * The play scene. It owns no game state: `core` steps the world at a fixed
 * 60 Hz and this draws whatever the world says, so what you see here is the
 * same simulation the headless harness measures.
 */
import Phaser from "phaser";
import {
  GRID_W, GRID_H, TILE_PX, Tile, STEP_MS, MAX_HEARTS, HP_PER_HEART, ITEMS, SPELL_SLOTS, slotCost, runStaff,
  RngSource, createWorld, step, worldCleared, plainInstance,
  generateRoom, toRoomPlan,
  moodTransform, dashInvulnerable, MELEE, ARMOUR_BREAK_MS, brakeFraction, ENEMIES,
  BOSS_ARCHETYPES, makeEnemy, ENEMY_IDS, seenPlayer,
  pickupFading, STAGGER_MS, ruleOffer, emptyHistory, GOLD_CARD_VALUE, equipItem,
  BLADE_REACH, noMods, applyStat, stageFor, attachAffix, AFFIX_SLOTS, spellAffixById, offerStats, angleDelta,
  affixFits, affixFitsLine, itemShape,
  spikesOut,
  simulateStaff, bucketClearSpeed, bucketGold, bucketMovementPressure, bucketRunProgress,
  portalInReach, answerOffer, PORTAL_RISE_MS, bucketHealth, bucketRecentDamage,
  rewardInReach, REWARD_RISE_MS, NO_INPUT, tetherEnds, ALERT_MS, MINE_BLAST, MINE_PRIME_MS,
  MUSKET_RANGE, MUSKET_SPREAD_DEG, MUSKET_WINDUP_MS, FLAME_ROLL_MS, FLAME_LIFE_MS, flameRays, muzzleOf,
} from "@jr/core";
import type {
  Bullet, Enemy, EnemyId, Input, ItemInstance, Mood, Offer, OfferCard, Portal,
  PlayerMods, RewardCardKind, RoomPlan, RoomType, RunHistory, World, AttachedAffix,
  Element, Tension, RunContext, Staff, SpellSlot,
} from "@jr/core";
import { createDirector, createEvaluator } from "@jr/director";
import type {
  Decision, Director, DirectorArm, RoomPlanResult, DoorPlan, PortalPlan, CardPlan, CardRequest, ObservedRequest, OfferPlan, OfferRequest,
} from "@jr/director";
import { buildReadout, CATEGORIES, categoryOf, groupByCategory } from "../director-readout.ts";
import { bakeFxTextures, FX_TEXTURE } from "../fx/textures.ts";
import type { FxSheetInfo } from "../fx/textures.ts";
import type { OfferRecord, PlanRecord, ReadoutRequest } from "../director-readout.ts";
import {
  cardPool, cardsFor, doorSpecs, goldRoomCoins, portalChoices, ruleDoors, CARDS_PER_OFFER, cardNeedsFor,
  SMITH_PRICE, PREBOSS_MEND_HEARTS,
} from "@jr/core";
import type { CardNeeds, NpcKind, OfferPromise, RoomStage, RunShape } from "@jr/core";
import {
  BOSS_LEAP_MS, BOSS_LEAP_RISE_MS, BOSS_SLAM_MS, BOSS_SLAM_SAFE_PX, BOSS_LEAP_RADIUS,
  withLevel, levelDamageMult, dismantleValue, spellDetail, offerStatParts, rarityOf, STAT_UPGRADES, statById, SPELL_LEVEL_MAX, SCHOOL_COLOUR, schoolOf, offerCards,
  spellCooldownMs, BASELINE_MANA_MAX, DASH_COOLDOWN_MS, DASH_MS, strayEliteFor,
} from "@jr/core";
import { DebugPanel } from "../debug-panel.ts";
import type { DebugSnapshot } from "../debug-panel.ts";
import {
  INVULN_MS, SPAWN_FADE_MS, SPAWN_TELEGRAPH_MS, STRIKE_FLASH_MS, STRIKE_MARK_MS, SWING_RECOVER_MS,
  SWING_TOTAL_MS, SWING_WINDUP_MS, SWING_ACTIVE_MS, swingElapsed, fullReach,
  drawnBladeAngle, scorchProgress, strikeFlashing,
  strikeMarked, swingPhase,
} from "@jr/core";
import { RecolourableAtlas, facingFrame } from "../assets/atlas.ts";
import { enemyFrame, frameForFacing, strideFor } from "./enemy-frames.ts";
import { drawCrescent, ENEMY_CRESCENT, PLAYER_CRESCENT } from "./crescent.ts";
import { drawCrackle, drawProjectile } from "./projectiles.ts";
import { FireFx } from "./fire-fx.ts";
import { KeyPrompt, keyLine } from "../ui/keycap.ts";
import type { ProjectileLook } from "./projectiles.ts";
import { propState } from "@jr/core";
import type { CrescentOptions } from "./crescent.ts";
import type { FrameChoice } from "./enemy-frames.ts";
import { Sfx, preloadSfx } from "../audio.ts";
import type { AtlasJson } from "../assets/atlas.ts";

const ART_SCALE = 2;
/**
 * Bullet art is a 32px frame. Drawn honestly a bullet would span exactly its
 * own hitbox; a small margin keeps a radius-3 bolt visible without lying about
 * where it hits.
 */
const BULLET_ART_PX = 32;
/** Mirrors `MELEE.windupMs` in the sim, for the windup tell's progress. */
/*
 * The enemy melee cycle's own timings, read from the simulation rather than
 * copied. They were duplicated here as literals, which is a drift waiting to
 * happen: a renderer that disagrees with the sim about how long a windup lasts
 * draws a telegraph that finishes at the wrong moment, and a telegraph that
 * lies is worse than none.
 */
const MELEE_WINDUP_MS = MELEE.windupMs;
const MELEE_LUNGE_MS = MELEE.lungeMs;
/**
 * The hand-drawn strip the swing's crescent is textured with, if the sheet has
 * it. A straight strip: horizontal runs along the sweep, vertical is the
 * radial cross-section from inner edge through the core to the outer edge.
 */
/** Half-thickness of the swing stroke's bright core, in world pixels. */
const STROKE_PX = 3.6;
/**
 * The crescent is drawn at the hitbox's own radius.
 *
 * Briefly 0.62, and that was a mistake in the opposite direction to the one
 * the rule is written against. "The hitbox may never be narrower than the
 * visual" guards against *"that clearly hit and did nothing"*. Drawing the
 * visual at 62% of the reach avoids that and buys the reverse: the player aims
 * at the crescent they can see, under-reaches by the missing 38%, and cannot
 * tell why they are losing fights.
 *
 * So the radius matches. Thickness is where the crescent stays modest, which
 * is the part that reads as a blade rather than as a fan.
 */
const VISUAL_RADIUS_SCALE = 1;
/** Scattered dots along the band. */
const SPARK_COUNT = 5;
/** How many quads the trail is drawn as, which is its alpha resolution. */
const TRAIL_SEGMENTS = 14;
/** Higher fades the tail harder; 1 is linear. */
const TRAIL_FALLOFF = 1.6;
/** Where the blade streak starts, clear of the body sprite. */
const BODY_CLEAR_PX = 7;
/** Frames of position history kept, which bounds how far a ghost can lag. */
const TRAIL_HISTORY = 12;
/** How many afterimages a dash leaves, and how many frames apart they sit. */
/**
 * How long one dash afterimage lingers, in ms.
 *
 * Three times the dash itself, so the chain is still on screen when the player
 * has arrived and is looking back along it. Shorter than the dash cooldown, so
 * two dashes never overlap into a smear.
 */
const GHOST_MS = 340;

/**
 * Half-width along the sweep, as a fraction of the peak: zero at both ends,
 * thickest about three-quarters along, which is where a real blade trail is
 * widest because the tip is travelling fastest near the end of the swing.
 */
function taperProfile(t: number): number {
  const A = TAPER_PEAK * 2;
  const B = (1 - TAPER_PEAK) * 2;
  const norm = Math.pow(TAPER_PEAK, A) * Math.pow(1 - TAPER_PEAK, B);
  return (Math.pow(Math.max(0, t), A) * Math.pow(Math.max(0, 1 - t), B)) / norm;
}
/** Where along the sweep the trail is thickest, as a fraction. */
const TAPER_PEAK = 0.72;

/**
 * The shape every arc swing is drawn with, player or enemy. Only the palette
 * and the clearance around the body differ; see `crescent.ts`.
 */
const CRESCENT: Omit<CrescentOptions, "width" | "fade" | "tailCut"> = {
  style: PLAYER_CRESCENT,
  strokePx: STROKE_PX,
  taperPeak: TAPER_PEAK,
  segments: TRAIL_SEGMENTS,
  falloff: TRAIL_FALLOFF,
  sparks: SPARK_COUNT,
  bodyClearPx: BODY_CLEAR_PX,
  radiusScale: VISUAL_RADIUS_SCALE,
};
/** How thick the crescent starts, as a fraction of its full thickness. */
const SWING_MIN_WIDTH = 0.3;
/**
 * The off-hand flame, scaled down hard.
 *
 * Measured, the delivered frame's content is 34 by 56 px in a 64 px frame,
 * which is 88% of the frame height — the same as the player's own body. The
 * brief asked for "about the size of a fist relative to the character" and got
 * a torso, so at the default scale it rendered as a second character standing
 * next to the first.
 *
 * A fist is roughly a third of the body's height, so the target is about 20 px
 * of the 56 delivered. Scaling in code is the immediate fix; the frame should
 * eventually be redrawn at that size, because downscaling a 56 px drawing to
 * 20 loses the crispness the rest of the sheet has.
 */
const FLAME_SCALE = 1 / ART_SCALE;
/** Grip-to-tip length of the delivered sword at its native half scale. */
/**
 * Where the grip sits in the sword frame, in art pixels from its left edge.
 *
 * Measured from the delivered art: `weapon_player_sword` spans x 24..62 in a
 * 64 px frame, so the hilt is at 24 and the tip at 62. Rotating about this
 * point is what makes the blade turn in the hand.
 */
const SWORD_GRIP_X = 25;
/** The tip, in the same units. Grip to tip is the blade's native reach. */
const SWORD_TIP_X = 62;

/**
 * The sword **floats**, and that is what fixes its proportions.
 *
 * Two versions tried to make a held sword reach the hitbox and both failed on
 * the same arithmetic. The art is a normal sword: 37 art pixels grip to tip,
 * about 18 world px at native scale. The hitbox reaches a full tile, 32. A
 * sword that visibly falls short of where it hits feels broken to swing, so
 * something has to give.
 *
 * - Stretching the x axis to 32 made a long thin strip — a sword out of
 *   proportion with the body holding it.
 * - Scaling both axes made a club as thick as the player's torso, at a
 *   non-integer factor that resampled the pixels into a blur.
 *
 * Neither is fixable, because a held weapon's reach *is* its length, and this
 * weapon needs to be 1.7x longer than it is drawn.
 *
 * So it is not held. It is a **magic sword that hovers in front of the
 * caster**, and then reach comes from *where it floats* rather than from how
 * long it is: the grip sits `SWORD_HOVER_PX` out along the facing, the blade
 * points outward from there, and the tip lands exactly on the hitbox radius
 * with the drawing at **native, unstretched, whole-pixel scale**.
 *
 * It also fits what is already on screen better than a held sword did. The
 * character is a hooded caster with a glowing orb in the off hand, not a
 * knight — and a blade that orbits its owner is a much more natural
 * explanation for a 170 degree arc than a human shoulder is.
 */
const SWORD_NATIVE_REACH = (SWORD_TIP_X - SWORD_GRIP_X) / ART_SCALE;
const SWORD_HOVER_PX = BLADE_REACH - SWORD_NATIVE_REACH;
/** How far the float drifts in and out when nothing is being swung at. */
const SWORD_BOB_PX = 1.6;

/*
 * The float is a **plain circle about the sprite's centre**: no vertical
 * compression, no lift. Both were tried and both were wrong, and the reasons
 * are different.
 *
 * *Compression*, on the theory that the floor is drawn straight down and the
 * bodies in three-quarter view, so a vertical world distance covers less
 * screen. True — it is why the contact shadows are ellipses — and it does not
 * apply here, because what the float has to clear is **the body**, and the
 * body is not wider than it is tall: the player's silhouette is about 25 world
 * px across and 27 down. Compressing pulled the blade *into* the sprite when
 * facing down. Shadows are ellipses because they lie on the floor; the sword
 * is at the body's own height, so it keeps the body's proportions.
 *
 * *A lift*, on the theory that the sprite's centre is at the waist and a blade
 * orbiting the waist reads as dragging. It does, but a constant lift makes the
 * facings uneven in two visible ways: the two vertical ones stop being
 * symmetric, and the two horizontal ones stop being level with the body they
 * point out of.
 *
 * Centred and uncompressed, all four agree: level when sideways, above when
 * facing up, below when facing down, the same distance each time.
 */

/**
 * Where the rusher claw's amber joint sits in its packed frame.
 *
 * The packer centres that joint at x=32. The claw has no human grip, pommel or
 * crossguard; the joint is the rotation origin where it meets the creature.
 */
const ENEMY_WEAPON_GRIP_X = 32;

/**
 * The blade trail's band, in world px from the player's centre.
 *
 * Derived from `SWORD_DRAWN_REACH` rather than written down, so the trail
 * cannot end up describing a sword of a different length — which is exactly
 * what the arc it replaced did. The band is the outer third of the blade,
 * because that is the part of a sword that moves fast enough to blur.
 */
const SWORD_TRAIL_OUTER = BLADE_REACH;
const SWORD_TRAIL_INNER = BLADE_REACH * 0.62;
/** Two frames of history: enough to imply speed, not enough to be a shape. */
const SWORD_TRAIL_SAMPLES = 4;

/**
 * How far below a body's drawn centre its shadow belongs, in world px.
 *
 * Both halves are measured from the art, because both are properties of the
 * drawings: a body's **feet** are the bottom of its opaque pixels, and a
 * shadow's blob has its own position inside its own frame. Lining up their
 * centres would put the shadow at the waist, which is exactly what shipped —
 * the enemy version used `radius * 0.46`, about 5 px on a rusher whose feet
 * are 12 px below its centre.
 *
 * Every shadow but the summoner's happens to be centred in its frame, so a
 * constant would have worked for five bodies out of seven and failed silently
 * on the sixth. Asking the pixels is the same amount of code and cannot drift.
 */
/**
 * How wide to draw a shadow, as an x scale.
 *
 * The delivered shadows are drawn wider than the bodies that cast them —
 * `shadow_player` spans 55 of its 64 px while the player spans 50, and at
 * native scale the blob came out visibly broader than the figure standing on
 * it, which reads as a stain on the floor rather than as a shadow.
 *
 * Narrowed to the body's own footprint. Only the x axis: the y extent is
 * already the foreshortening the three-quarter view needs, and squashing it
 * further would flatten the shadow into a line.
 */
function shadowScale(
  atlas: RecolourableAtlas, bodyFrame: string, shadowFrame: string,
): number {
  const body = atlas.contentWidth(bodyFrame);
  const shade = atlas.contentWidth(shadowFrame);
  if (shade <= 0) return 1 / ART_SCALE;
  return (1 / ART_SCALE) * Math.min(1, (body * 1.05) / shade);
}

function shadowOffset(atlas: RecolourableAtlas, bodyFrame: string, shadowFrame: string): number {
  const body = atlas.frame(bodyFrame);
  const shade = atlas.frame(shadowFrame);
  const feet = atlas.contentBottom(bodyFrame) - body.h / 2;
  const blob = (atlas.contentTop(shadowFrame) + atlas.contentBottom(shadowFrame)) / 2
    - shade.h / 2;
  return (feet - blob) / ART_SCALE;
}
/**
 * World pixels per walk frame.
 *
 * Deliberately **not** matched to the character's stride. At 28 world px tall
 * and 240 px per second the player covers eight and a half body heights every
 * second, so no leg animation can line up with the ground; trying to match it
 * gave 13 px per frame, an 18 fps cycle, which read as a twitch.
 *
 * So the cadence is chosen as a run instead: 22 px per frame is about eleven
 * frames a second, which is where a four-frame run cycle normally sits.
 */
/*
 * 17 rather than 22: at 22 the four-frame cycle turned over about seven times
 * a second at the current walking speed, which on a body this small read as a
 * shuffle. 17 is about nine steps a second, the brisk end of a walk, and the
 * feet still land roughly with the distance covered.
 */
const WALK_FRAME_PX = 17;
/** How long the walk pose survives after movement stops. */
const WALK_HOLD_MS = 90;
const IDLE_FRAME_TICKS = 15;
/** How long the recoil pose is held out of the 600 ms invulnerability. */
const HURT_POSE_MS = 110;
/** Minimum radial thickness of the crescent, so it is never a hairline. */
const MIN_BAND_PX = 14;

const BULLET_SPRITE_MARGIN = 1.25;
function bulletScale(radius: number): number {
  return (radius * 2 * BULLET_SPRITE_MARGIN) / BULLET_ART_PX;
}
const VIEW_W = GRID_W * TILE_PX;
const VIEW_H = GRID_H * TILE_PX;
/*
 * The HUD is an **overlay on the room**, not a strip under it. The strip put
 * every number the player reads a hand's width below the fight; laid over the
 * room's own border walls, the top row carries the body (health, mana, spin,
 * dodge, gold) and the bottom row the spells, and nothing covers the floor.
 */
const HUD_H = 0;
/** The two HUD rows, over the top and bottom wall rows. */
const HUD_TOP_Y = 9;
const HUD_BOTTOM_Y = VIEW_H - 12;

/**
 * Device pixel ratio, capped so a 3x phone does not ask for a nine-times
 * backing store. The canvas is sized in physical pixels and presented at
 * 1/dpr, which is the only way a HiDPI screen gets a sharp image: sizing the
 * canvas in CSS pixels makes the browser upscale it, and that is the blur.
 */
export const DPR = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 3);

/** World units to backing-store pixels. */
export const ZOOM = ART_SCALE * DPR;

/**
 * The frame a kill pop is drawn from.
 *
 * Taken from the facing the body died on rather than a fixed one: the pop is a
 * silhouette of what was just standing there, and a body that dies facing away
 * from the player should not turn to face them on the way out. Resolved through
 * the same function the live body uses, so it cannot ask for a name the sheet
 * does not have — which it did, and which drew a boss.
 */
function popFrame(id: EnemyId, facing: number, has: (n: string) => boolean): FrameChoice {
  const base = ENEMY_FRAME[id];
  if (has(`${base}_death`)) return { name: `${base}_death`, flipX: false };
  return frameForFacing(base, "idle0", facing, has);
}

const ENEMY_FRAME: Record<EnemyId, string> = {
  rusher: "enemy_rusher", shooter: "enemy_shooter", turret: "enemy_turret",
  orbiter: "enemy_orbiter", tank: "enemy_tank", summoner: "enemy_summoner",
  lancer: "enemy_lancer", sentinel: "enemy_sentinel",
  warden: "enemy_warden", bellringer: "enemy_bellringer", rifter: "enemy_rifter",
  snarecaster: "enemy_snarecaster", delver: "enemy_delver", cinderling: "enemy_cinderling", sower: "enemy_sower",
  // Undirected and three-phase, like the turret is undirected.
  boss: "boss_p1",
};

export class PlayScene extends Phaser.Scene {
  private atlas!: RecolourableAtlas;
  private textureKey = "sheet_mood";
  private world!: World;
  private accumulator = 0;
  private sfx!: Sfx;
  private swingGfx!: Phaser.GameObjects.Graphics;
  /** The magic blade drawn over the sword while it swings; see `drawMagicBlade`. */
  private magicGfx!: Phaser.GameObjects.Graphics;
  /** Enemy attack ground, under the bodies; and enemy blades, over them. */
  private threatGfx!: Phaser.GameObjects.Graphics;
  private bladeGfx!: Phaser.GameObjects.Graphics;
  private hazardGfx!: Phaser.GameObjects.Graphics;
  private readonly hazardMarks: Phaser.GameObjects.Image[] = [];
  /**
   * One-line lessons for mechanics the room cannot explain by itself — a
   * ward's link is cut by standing in it, a plate is walked round — shown the
   * first time each comes up in a session and then never again.
   */
  private readonly taught = new Set<string>();
  /** A blunderbuss firing: its flame, then its smoke, by age. See `drawMuzzles`. */
  private muzzleFx: { x: number; y: number; a: number; ms: number }[] = [];
  /** The code-drawn effect sheets (`fx/sheets.ts`), baked at boot. */
  private fxSheets: ReadonlyMap<string, FxSheetInfo> = new Map();
  /** Each live blast's wall-cut shape, as the mask its frames are drawn through. */
  private readonly blastMasks = new Map<World["flames"][number], Phaser.GameObjects.Graphics>();
  /** A dear spell's kick on the player's body, render only. */
  private recoil: { a: number; ms: number } | null = null;
  /** Effect animations playing: each a baked sheet stepped on its own clock. See `drawFxAnims`. */
  private fxAnims: { sheet: string; x: number; y: number; rot: number; ms: number; frameMs: number; depth: number; tint?: number }[] = [];
  private readonly teachAt = new Map<string, { x: number; y: number; ms: number }>();
  private walkDistance = 0;
  private walkHoldMs = 0;
  private readonly trail: { x: number; y: number }[] = [];
  private lastX = 0;
  private lastY = 0;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private tiles!: Phaser.GameObjects.Group;
  /** The upper halves of lone columns, drawn over the bodies; see `drawTiles`. */
  private pillarTops: { img: Phaser.GameObjects.Image; x: number; y: number; h: number }[] = [];
  private sprites!: Phaser.GameObjects.Group;
  private hud!: Phaser.GameObjects.Text;
  private roomIndex = 1;
  /**
   * The Director. The scene used to build every room from one fixed
   * encounter profile at the `build` band, whatever the run's state — so an
   * elite room was an ordinary room with a badge on its door, and nothing the
   * design calls a decision was ever taken in the browser. The rule arm is
   * the default and the one the harness measures; `?director=jev` asks Jev
   * through the proxy (`/api/decide` in development), `?director=random` the
   * experimental floor.
   */
  /**
   * Every request the Director answered for the current room, as it was
   * answered, and what each plan returned — read by the debug sidebar and the
   * room plan page (`buildReadout`). Cleared when the next room begins.
   */
  private directorLog: ObservedRequest[] = [];
  private planRecords = new Map<string, PlanRecord>();
  private readonly director: Director = createDirector(directorArm(), {
    observe: (r) => { this.directorLog.push(r); },
    ...(directorArm() === "jev" ? { evaluate: createEvaluator({ url: DECIDE_URL }) } : {}),
  });
  /**
   * The run's seed. It was the constant "play", so every run was the same
   * run: the same rooms in the same order with the same enemies, which is
   * what "is there no randomness" was. A fresh seed per run, or `?seed=` in
   * the URL to replay one; the debug panel shows it.
   */
  private runSeed = freshSeed();
  /** What the Director decided about the current room, for the debug panel. */
  private planned: RoomPlanResult | null = null;
  private doorPlan: DoorPlan | null = null;
  /** The Director's portals out of this room and its cards in it (docs 003, 007). */
  private portalPlan: PortalPlan | null = null;
  private cardPlan: CardPlan | null = null;
  /** A vendor's room mid-run: which vendor stands in it, or null for a fight. */
  private npcRoom: NpcKind | null = null;
  private npcRooms = 0;
  private lastWasNpc = false;
  /** Doc 007's pity and temptation clocks: offers made, and offers since one held a need. */
  private offersMade = 0;
  private needMisses = 0;
  private tension: Tension = "build";
  /** Set while a room is being planned, so nothing steps a world that is being replaced. */
  private entering = false;
  private lastClearMs = 30_000;
  private heartsLostRecent = 0;
  private debug!: DebugPanel;
  private debugAt = 0;
  /**
   * The "replace which spell" step, between choosing a spell card on a full
   * staff and equipping it. See `chooseReward`.
   */
  /**
   * The staff screen: the three spells, what each does, and what is attached
   * to it. Opened with Tab to read and reorder; opened by an affix card to
   * choose which spell takes it. See `showStaff`.
   */
  private staffUi: {
    mode: "view" | "attach" | "replace" | "smith";
    card: OfferCard | null;
    /** Attaching to a full spell: which of its affixes the new one replaces. */
    swapAffix?: number | null;
    selected: number;
    /** In view mode, the spell picked up to swap with the next one chosen. */
    swapFrom: number | null;
    objects: Phaser.GameObjects.GameObject[];
  } | null = null;
  /**
   * The run, which is what survives a room.
   *
   * Held on the scene rather than in the world because a world is one room:
   * doc 003's history feeds the pacing rules, the owned ids keep an offer from
   * repeating what the player already took, and the gold is banked across
   * rooms. Everything here is state the simulation deliberately does not know
   * about.
   */
  private history: RunHistory = emptyHistory();
  private owned: string[] = [];
  private runGold = 0;
  /** The reward kind the player chose at the portal into this room. */
  private roomReward: RewardCardKind = "spell";
  /** Whether this room is an elite one, from the portal that led here. */
  private elite = false;
  private lastWasElite = false;
  /** What the run has improved. Survives the room; the player does not. */
  private mods: PlayerMods = noMods();
  /** The staff. Also survives the room; see `enterRoom`. */
  private slots: (ItemInstance | null)[] = [];
  /**
   * The event affixes on each of the three spells, by key index. Kept by the
   * run for the same reason as `slots` and `mods`: the world is rebuilt every
   * room and would otherwise forget them at the next portal.
   */
  private spellAffixes: (readonly AttachedAffix[])[] = [];
  /** Each key's spell level, carried across rooms like its affixes. */
  private spellLevels: number[] = [];
  /** The merchant's stock in the pre-boss room: one of each kind, bought one at a time. */
  private shopStock: OfferCard[] = [];
  /** A card being bought, charged when it lands (a staff-screen step may still be cancelled). */
  private shopPending: OfferCard | null = null;
  /** The two vendors, drawn in the merchant's room. */
  private npcs: {
    kind: "merchant" | "smith"; x: number; y: number;
    img: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Ellipse; badge: Phaser.GameObjects.Image | null;
  }[] = [];
  /**
   * Spells taken off a key, lying on the floor with the level and affixes
   * they had. A tap on E picks one up (onto a free key, or into the replace
   * step); holding E takes it apart for gold.
   */
  private floorSpells: FloorSpell[] = [];
  /** The floor spell being put on a key through the replace step. */
  private floorPending: FloorSpell | null = null;
  /** How long E has been held over a floor spell, and whether that hold already dismantled it. */
  private floorHoldMs = 0;
  private floorHoldSpent = false;
  /** How long the current E press has lasted, to tell a tap from a hold. */
  private floorPressMs = 0;
  private holdGfx!: Phaser.GameObjects.Graphics;
  /** What the portal this room was entered through promised. */
  private roomPromise: { school?: string; family?: string; grade: number } = { grade: 1 };
  /** True in the merchant's room, where the cards cost gold instead of a slot. */
  private shopping = false;
  /** Set once the boss is down. The run is over; nothing loads after it. */
  private won = false;
  /** The last reward taken, shown briefly so a pickup reads as an acquisition. */
  private tookMs = 0;
  private tookLabel = "";
  /** Rebuilt per room: portals with their type badge, and the reward cards. */
  /** "ELITE" over the portals that lead to one. Rebuilt with the portals. */
  private eliteMarks: { portal: Portal; mark: Phaser.GameObjects.Image | Phaser.GameObjects.Text }[] = [];
  private portalGfx: {
    portal: Portal; body: Phaser.GameObjects.Image;
    badge: Phaser.GameObjects.Image; plate: Phaser.GameObjects.Image;
    /** What the badge promises beyond the kind: school or family, and grade. */
    tag: Phaser.GameObjects.Text | null;
  }[] = [];
  /** The offer screen. Null whenever there is nothing to choose. */
  private offerUi: {
    dim: Phaser.GameObjects.Rectangle;
    heading: Phaser.GameObjects.Text;
    hint: Phaser.GameObjects.Container;
    /** Which card Enter or the attack key would take. */
    selected: number;
    cards: {
      card: OfferCard;
      panel: Phaser.GameObjects.Rectangle;
      /** The frame's decoration: corner ticks and an inner line, redrawn in the rarity's colour. */
      deco: Phaser.GameObjects.Graphics; decoRect: { x: number; y: number; w: number; h: number };
      icon: Phaser.GameObjects.Image;
      name: Phaser.GameObjects.Text; stats: Phaser.GameObjects.Container;
      body: Phaser.GameObjects.Text;
      key: Phaser.GameObjects.Text; zone: Phaser.GameObjects.Zone;
      kindTag: Phaser.GameObjects.Text;
      /** The price chip in the merchant's room, and anything else a card owns. */
      extras: Phaser.GameObjects.GameObject[];
    }[];
  } | null = null;
  /** The offer this room will present, kept for the card screen. */
  private offer: Offer | null = null;
  /**
   * Counts down between the room clearing and the cards appearing.
   *
   * The screen used to open on the frame the last body died, which reads as
   * the game interrupting the player mid-follow-through: the kill's hitstop is
   * still resolving, the death silhouette is still expanding, the coins are
   * still flying in. Doc 014 asks for a trough after each peak and this is the
   * front edge of it — the fight is allowed to finish before the next decision
   * is put on screen.
   */
  /**
   * The interact key, read **once** per frame and shared.
   *
   * It has two consumers — opening the reward here in the scene, and entering
   * a portal through the simulation's `interact` input — and
   * `Phaser.Input.Keyboard.JustDown` *clears* the flag it reads. So whichever
   * ran first ate the press and the other never saw it: with the reward gone,
   * pressing E on an open portal did nothing at all, because `updateExits`
   * had already consumed the edge before `readInput` was called.
   */
  private interactPressed = false;
  private spinPressed = false;
  /** The stat cards taken this run, by id, for the attributes panel. */
  private statsTaken: string[] = [];
  private lastSpinPhase: ReturnType<typeof swingPhase> = "none";

  /** The reward standing on the floor, its beam, and its glow. */
  /** The reward's column of light, redrawn each frame; see `buildRewardDrop`. */
  private beamGfx!: Phaser.GameObjects.Graphics;
  private rewardGfx: {
    body: Phaser.GameObjects.Image;
    glow: Phaser.GameObjects.Image;
    /** The kind badge, only where the pedestal is a stand-in. */
    badge: Phaser.GameObjects.Image | null;
  } | null = null;
  /** The one key prompt, moved onto whatever is in reach. See `updateExits`. */
  private prompt!: KeyPrompt;
  /**
   * The sword's resting angle for this frame's facing, cached by `draw`.
   *
   * `drawSwing` needs it to sample the same `drawnBladeAngle` the sword itself
   * uses, and it comes from the atlas's hand anchor for the *current* frame —
   * which `draw` has already resolved. Recomputing it would mean duplicating
   * the pose selection, and the two copies would eventually disagree about
   * where the blade is.
   */
  private swordRestAngle = 0;
  /** Where the blade hangs when not swinging, eased between sheathed and ready. */
  private swordPose = { dx: -7, dy: -5, rot: -Math.PI / 2 };
  /** Short-lived visuals that outlive the entity that caused them. */
  private pops: { x: number; y: number; frame: string; flipX: boolean; ms: number }[] = [];
  /**
   * Standing features with a light in them, so the flame or the glow has two
   * frames rather than one. Rebuilt per room with the tile layer.
   */
  private featureLights: {
    img: Phaser.GameObjects.Image; a: string; b: string;
    /** Whether the pair is a state worth animating; see the update loop. */
    cycles: boolean;
  }[] = [];
  /** Dash afterimages, each standing where it was left. See `GHOST_MS`. */
  private ghosts: { x: number; y: number; frame: string; flipX: boolean; ms: number }[] = [];
  /** One burst per hit, at the point of contact. See `IMPACT_MS`. */
  /**
   * Damage numbers, off unless the player turns them on (Tab screen, N).
   * Remembered in the browser: a preference, not a save.
   */
  private damageNumbersOn = (() => { try { return localStorage.getItem(DAMAGE_NUMBERS_KEY) === "1"; } catch { return false; } })();
  private damageNumbers: { id: number; x: number; y: number; text: string; colour: string; ms: number; drift: number }[] = [];
  private damageNumberId = 0;
  /**
   * Text drawn every frame, **kept** rather than rebuilt (task 11).
   *
   * Every HUD number, keycap, boss title and damage number was a new `Text`
   * each frame and destroyed the next, and a Phaser text is a canvas drawn
   * with the font and uploaded as a texture: a dozen damage numbers over
   * burning bodies halved the frame rate while the script barely moved. A
   * text is now fetched by a key, redrawn only when its string changes, and
   * hidden at the end of a frame nothing asked for it in.
   */
  private readonly textCache = new Map<string, { t: Phaser.GameObjects.Text; used: boolean; style: string; idle: number }>();
  private shards: { x: number; y: number; a: number; ms: number }[] = [];
  /** Settings: damage dealt and taken, as multiples. Remembered like the rest. */
  private dealtMult = readSetting(DEALT_KEY, 1);
  private takenMult = readSetting(TAKEN_KEY, 1);
  /** Settings: take no damage at all. For testing a room without dying in it. */
  /** Screen shake: on, reduced (the default) or off. See `holdCamera`. */
  private shakeSetting: ShakeSetting = (() => {
    try {
      const v = localStorage.getItem(SHAKE_KEY);
      return (SHAKE_SETTINGS as readonly string[]).includes(v ?? "") ? v as ShakeSetting : "reduced";
    } catch { return "reduced"; }
  })();
  private invincible = (() => { try { return localStorage.getItem(INVINCIBLE_KEY) === "1"; } catch { return false; } })();
  /** The pause menu (Esc): its page, the highlighted row, and what it drew. */
  private pauseUi: { page: "main" | "settings" | "controls"; selected: number; objects: Phaser.GameObjects.GameObject[] } | null = null;
  /** The title screen, over a fresh first room until a key is pressed. */
  private titleUi: Phaser.GameObjects.GameObject[] | null = null;
  /**
   * The run's intent (doc 003's intent screen): a build style, and in Jev
   * mode the player's own words. It reaches the Director's context, the
   * starting staff, the second starting spell, and which spells the doors
   * and cards lean toward.
   */
  private intent: { preset: "spam" | "nuke" | "area" | "dot" | "melee"; free_text?: string } = { preset: "spam" };
  private intentUi: { selected: number; text: string; objects: Phaser.GameObjects.GameObject[] } | null = null;
  private demo: { spell: string; world: World; acc: number; ageMs: number; numbers: { x: number; y: number; text: string; colour: string; ms: number }[] } | null = null;
  private demoCam: Phaser.Cameras.Scene2D.Camera | null = null;
  /** Screen objects made once (the controls line) that the demo camera must not show. */
  private demoIgnore: Phaser.GameObjects.GameObject[] = [];
  /** While true, `draw` renders the demo world and stops before the HUD. */
  private renderingDemo = false;
  /** The character screen was opened from the pause menu, so Esc goes back there. */
  private staffFromPause = false;
  /** The game-over card, while the run is dead. */
  private gameOverUi: Phaser.GameObjects.GameObject[] | null = null;
  private gameOverKeys: (() => void) | null = null;
  /** Set by "Return to title": the title goes up once the new run's first room is built. */
  private pendingTitle = false;
  /**
   * The screen between rooms: "generating" while the Director plans the next
   * room (Jev's round trips can take seconds, and a frozen frame reads as a
   * hang), then "ready" with the plan laid out until the player starts it.
   */
  private transitionUi: {
    phase: "generating" | "ready"; startedMs: number; ms: number;
    objects: Phaser.GameObjects.GameObject[]; dots: Phaser.GameObjects.Text | null;
    /** The plan page's tab (room, Director inputs, Director questions) and scroll, in lines. */
    page: number; scroll: number; maxScroll: number;
  } | null = null;
  /** Settings: show the plan before a room starts (on), or start it as soon as it is ready. */
  /** How long the Director took over the last room's plan, doors included. */
  private lastPlanMs = 0;
  /** When a held arrow next scrolls the plan page. */
  private planScrollAt = 0;
  private doorPlanMs = 0;
  private showRoomParams = (() => { try { return localStorage.getItem(ROOM_PARAMS_KEY) !== "0"; } catch { return true; } })();
  private impacts: {
    x: number; y: number; ms: number; scale: number; slashAngle?: number;
    /** A spell's hit is coloured by its element; the sword's stays white. */
    color?: number;
  }[] = [];
  /** Where a shot came into being: the hand, or a carrier's burst. See `CAST_MS`. */
  private casts: { x: number; y: number; ms: number; element: Element; scale: number }[] = [];
  /** Where a shot stopped without hitting a body. See `PUFF_MS`. */
  private puffs: { x: number; y: number; ms: number; element: Element; scale: number }[] = [];
  /**
   * Last known state of every pooled player bullet, so births and deaths can
   * be read as edges. The sim recycles bullet objects in place and publishes
   * no event for either, so the renderer has to remember for itself.
   */
  private readonly bulletMemory = new Map<Bullet, {
    x: number; y: number; alive: boolean; payload: boolean; element: Element;
    /** Where it has been, oldest first, for shots drawn as the path they took. */
    trail: { x: number; y: number }[];
  }>();
  /** The off-hand flame flares on a cast, then settles. Counts down from `CAST_MS`. */
  private flareMs = 0;
  /** Additive layers for spell light: under the bodies, and over them. */
  private fxGfx!: Phaser.GameObjects.Graphics;
  private fxTopGfx!: Phaser.GameObjects.Graphics;
  /**
   * Hit sparks, kill bursts and slash marks: short-lived, additive, drawn as
   * streaks along their velocity. Presentation only — nothing here is read by
   * the simulation, so it is free to use `Math.random`.
   */
  private sparkGfx!: Phaser.GameObjects.Graphics;
  /** Projectiles that read as matter rather than light (a rock), in normal blend. */
  private projGfx!: Phaser.GameObjects.Graphics;
  private fxSparks: FxSpark[] = [];
  /** Burning ground and burning bodies, as persistent layered particles (`fire-fx.ts`). */
  private fireFx!: FireFx;
  private fxSlashes: { x: number; y: number; angle: number; ms: number; colour: number; len: number }[] = [];
  /** The dust skid behind a player thrown by a ram, while it lasts. */
  private ramSkidMs = 0;
  private ramSkidDir = 0;
  private fxRings: { x: number; y: number; ms: number; life: number; r0: number; r1: number; colour: number; width: number }[] = [];
  /** Edges for the cues that are states in the sim rather than events. */
  private wasCommitting = false;
  private wasNoticing = false;

  constructor() {
    super("play");
  }

  preload(): void {
    this.load.image("sheet", "sprites.png");
    this.load.json("atlasJson", "sprites.json");
    preloadSfx(this);
  }

  create(): void {
    this.sfx = new Sfx(this);
    this.swingGfx = this.add.graphics().setDepth(9);
    this.magicGfx = this.add.graphics().setDepth(8.7).setBlendMode(Phaser.BlendModes.ADD);
    // Under the bodies (6) so a telegraph never hides what is standing on it,
    // and over them for the live blade so the thing that hits you is on top.
    this.threatGfx = this.add.graphics().setDepth(4);
    this.bladeGfx = this.add.graphics().setDepth(8);
    // Under the bodies: burning ground and a marker are floor, not effects.
    this.hazardGfx = this.add.graphics().setDepth(2);
    // Spell light. Additive, because light adds: a glow over the floor
    // brightens it rather than painting over it. The lower layer carries what
    // travels with the shot and sits just above the shot itself; the upper
    // layer carries the flash and the fizzle, which must not hide behind the
    // body they happen on.
    this.fxGfx = this.add.graphics().setDepth(5.5).setBlendMode(Phaser.BlendModes.ADD);
    this.fxTopGfx = this.add.graphics().setDepth(9.6).setBlendMode(Phaser.BlendModes.ADD);
    this.sparkGfx = this.add.graphics().setDepth(9.65).setBlendMode(Phaser.BlendModes.ADD);
    this.projGfx = this.add.graphics().setDepth(5.4);
    this.holdGfx = this.add.graphics().setDepth(9.3);
    this.beamGfx = this.add.graphics().setDepth(9.2).setBlendMode(Phaser.BlendModes.ADD);
    this.fireFx = new FireFx(this);
    this.fxSheets = bakeFxTextures(this, { blastLen: Math.round(MUSKET_RANGE * 2), blastSpreadDeg: MUSKET_SPREAD_DEG });
    const image = this.textures.get("sheet").getSourceImage() as HTMLImageElement;
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height);
    this.atlas = new RecolourableAtlas(
      { width: image.width, height: image.height, data: pixels.data },
      this.cache.json.get("atlasJson") as AtlasJson,
    );

    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,LEFT,DOWN,RIGHT,E,R,M,J,K,L,U,I,O,X,N,ONE,TWO,THREE,SPACE,SHIFT,ENTER,ESC,BACKTICK,TAB") as Record<string, Phaser.Input.Keyboard.Key>;
    this.debug = new DebugPanel({
      swapSpells: (a, b) => this.swapSpells(a, b),
      spawnEnemy: (id, elite) => this.debugSpawn(id, elite),
    });
    this.tiles = this.add.group();
    this.sprites = this.add.group();
    // Text is rasterised at its font size and then scaled by the camera, so
    // asking for the final size and scaling back down is what keeps it sharp.
    /*
     * One status line, small. It was a 13 px line naming the room, the gold,
     * the enemy count, the dodge, the mute and the beat, and at that size it
     * ran under the controls; the dodge moved to a key letter beside the rage
     * gauge, where the spin's already is, and the rest fits at 9 px.
     */
    this.hud = this.add.text(VIEW_W - 8, 22, "", {
      fontFamily: "monospace", fontSize: `${Math.round(8 * ZOOM)}px`, color: "#c9cfe8", align: "right",
      backgroundColor: "#0d0b1f99", padding: { x: 3 * ZOOM, y: 1 * ZOOM },
    }).setScale(1 / ZOOM).setOrigin(1, 0).setDepth(100);

    // The key drawn as a key: see `ui/keycap.ts`.
    this.prompt = new KeyPrompt(this, { px: 9, colour: "#ffe9a8", zoom: ZOOM, depth: 9, panel: true });

    /*
     * The controls, on screen, permanently.
     *
     * Not a nicety. The ranged attack moved from a held button to three keys
     * when spells became keyed, and with nothing on screen saying so the only
     * available reading was that the ranged attack had been deleted. A control
     * scheme that is only in the source is not a control scheme.
     */
    /*
     * On the **second** row, right of the spell names.
     *
     * It shared row one with the status line, which grows with the beat it is
     * naming, so "a reward waits in the middle" printed straight through the
     * controls and both became unreadable. Two rows, each with one owner: the
     * state above, the controls below. The keys the row below already names —
     * U, I and O, each beside the spell it casts — are dropped from it.
     */
    // L and K are on the gauges they spend; the rest is here.
    this.demoIgnore.push(keyLine(this, VIEW_W - 8, HUD_BOTTOM_Y, "[E] use  [Tab] character  [Esc] menu", {
      px: 7, colour: "#8a84a0", zoom: ZOOM, depth: 100, originX: 1, panel: true,
    }));

    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    // Zoom is applied about the centre, so the origin has to be re-anchored.
    cam.centerOn(VIEW_W / 2, (VIEW_H + HUD_H) / 2);

    // Dev builds expose the scene for poking at from the console.
    // Muted is a setting too, and is remembered like the others.
    try { if (localStorage.getItem(MUTE_KEY) === "1") this.sfx.setMuted(true); } catch { /* not available */ }
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { __scene?: PlayScene }).__scene = this;
    void this.enterRoom(1).then(() => this.showTitle());
  }

  /**
   * Builds and enters a room.
   *
   * `hearts` is explicit because it used to be inferred from the previous
   * world, which meant restarting after a death carried the zero across and
   * the caller had to remember to reset it first. A parameter that has to be
   * fixed up before the call is a parameter waiting to be forgotten.
   */
  private async enterRoom(index: number, hearts?: number, through?: Portal): Promise<void> {
    this.entering = true;
    this.roomIndex = index;
    this.roomReward = through?.reward ?? "spell";
    this.roomPromise = { school: through?.school, family: through?.family, grade: through?.grade ?? 1 };
    this.lastWasElite = this.elite;
    this.elite = through?.elite ?? false;
    this.lastWasNpc = this.npcRoom !== null;
    this.npcRoom = through?.npc ?? null;
    if (this.npcRoom) this.npcRooms++;
    const src = new RngSource(`${this.runSeed}-${index}`);
    /*
     * The run's shape decides what this room is: fights, then the merchant,
     * then the boss. Doc 003 removed room *types* as a player-facing choice,
     * so this is the only place a room is anything other than a fight, and it
     * is a function of the index rather than of anything the player picked.
     */
    const stage = stageFor(index);
    // A vendor's room mid-run is a shop room with one vendor in it and no fight.
    const fight = stage === "combat" && !this.npcRoom;
    const roomType: RoomType = fight ? (this.elite ? "elite" : "combat") : stage === "boss" ? "boss" : "shop";
    const hearts0 = hearts ?? this.world?.player.hearts ?? MAX_HEARTS + this.mods.maxHearts;
    const staff = runStaff();

    /*
     * The Director plans every fight: space, mood, zone features, encounter,
     * elite affixes, all from the run's state and the tension its doors set.
     * The same call the harness measures, with the same context. The merchant
     * and the boss build no encounter — a shop with enemies in it is a fight,
     * and a boss room with an assembled encounter is a fight with a boss
     * somewhere in it — so both are placed directly.
     */
    /*
     * The staff **survives the room**, like the stat modifiers do.
     *
     * It was rebuilt from scratch every room, so every spell and every
     * modifier the player picked up was discarded at the next portal: a run
     * ended holding exactly the two items it started with. The bug is quiet
     * because the reward screen still says the item was taken, and the HUD
     * still shows three spell keys — the loss only shows up if you look at
     * what is bound to them.
     */
    if (this.slots.length === 0) {
      this.slots = Array.from({ length: staff.slots }, (_, i) =>
        i === 0 ? plainInstance("magic_bolt") : i === 1 ? plainInstance(STYLE_START[this.intent.preset]) : null);
      /*
       * The starting staff counts as owned, or the first room offers
       * `magic_bolt` to a player already holding one.
       */
      for (const inst of this.slots) if (inst) this.owned.push(inst.base);
    }
    const slots = this.slots;

    /*
     * The offer is decided **before** the fight, not when the room clears.
     *
     * Doc 003 starts the reward pipeline at the room's own ENTERING so it has
     * the whole fight to resolve — which is where the Jev request will go. It
     * also makes the cards deterministic for a seed, so a room that went wrong
     * can be replayed with the same three on the floor, and it is why the
     * portals can be placed at room start and stand shut where the player can
     * read them during the fight.
     */
    const startHearts = hearts ?? this.world?.player.hearts ?? MAX_HEARTS + this.mods.maxHearts;
    this.won = false;
    const held = this.slots.flatMap((x) => (x ? [itemShape(ITEMS.get(x.base))] : []));
    const run: RunShape = {
      style: this.intent.preset,
      roomIndex: index,
      lastWasElite: this.lastWasElite,
      // Doc 003 forbids an elite while the player is one hit from dying.
      critical: startHearts <= 1,
      npcRooms: this.npcRooms,
      lastWasNpc: this.npcRoom !== null,
    };
    const ctx = this.directorContext(index, startHearts, staff);
    const ask = this.offerRequest(ctx, src, run, stage, fight, held);
    const planStart = performance.now();
    /*
     * The room's offer rides in the room's own round-1 request: the portals
     * and the cards read the same state as the room and depend on nothing it
     * decides, so they are parallel questions in one request rather than
     * requests of their own (doc 002).
     */
    const planned = fight
      ? await this.director.planRoom(ctx, { room_index: index, door_slot: 0, room_type: roomType }, this.tension, ask.request)
      : null;
    this.planned = planned;
    if (planned) this.planRecords.set("room", { decisions: planned.decisions });
    const room: RoomPlan = planned ? planned.plan : fixedRoom(stage === "boss" ? "boss" : "shop", src.stream("room"));
    const encounter = planned?.plan.encounter ?? null;
    const mood: Mood = room.params.mood;
    const { offer, stock } = await this.planOffer(ctx, src, run, stage, fight, held, ask, planned?.offer);
    this.lastPlanMs = performance.now() - planStart + (this.doorPlanMs ?? 0);
    this.doorPlanMs = 0;

    /*
     * The merchant's room: the stock is the merchant's, one card of each kind
     * gold can buy, and it is bought **from the merchant**, as many as the
     * player can afford — not opened once from a pedestal like a reward. The
     * world gets no cards, so the room opens its portals at once and there is
     * no pedestal; the blacksmith beside the merchant raises spell levels. A
     * vendor's room mid-run is the same room with only one of the two in it.
     */
    this.shopStock = stock;
    this.shopPending = null;
    const worldOffer: Offer = fight ? offer : { ...offer, cards: [], coins: 0 };
    this.offer = worldOffer;
    this.world = createWorld({
      room, encounter, staff, slots,
      hearts: startHearts,
      rng: src.stream("gameplay"),
      offer: worldOffer,
      dealtMult: this.dealtMult,
      takenMult: this.takenMult,
      invincible: this.invincible,
      // The spin charges banked in the last room come through the portal.
      rage: index > 1 && this.world ? this.world.player.rage : 0,
      // A normal room may hide one elite body.
      strayElite: fight && !this.elite ? strayEliteFor(index, src.stream("stray")) : [],
      // What the run has permanently improved, carried across the room
      // boundary: the player is rebuilt every room and the upgrades are not.
      mods: this.mods,
    });

    if (stage === "boss") this.spawnBoss();
    /*
     * The merchant's room clears itself, because it has no enemies.
     *
     * `worldCleared` is true from the first frame, so the reward object rises
     * immediately and the room is what the player walked into it for: one
     * screen, three things to buy, then the boss. Doc 013 puts the merchant
     * and the blacksmith together before the boss and this is that stop.
     */
    this.shopping = !fight && stage !== "boss";
    // A vendor stands on clear ground: nothing solid and nothing breakable in front of it.
    if (this.shopping) this.clearVendorGround();
    // The stop before the boss mends: see `PREBOSS_MEND_HEARTS`.
    if (stage === "shop" && !this.npcRoom) {
      const cap = MAX_HEARTS + this.mods.maxHearts;
      const before = this.world.player.hearts;
      this.world.player.hearts = Math.min(cap, before + PREBOSS_MEND_HEARTS);
      if (this.world.player.hearts > before) this.levelUpFx("The fire mends you", "");
    }

    // Re-attach what the run has put on each spell: the world's slots are
    // fresh, and an affix that vanished at a portal would look like a bug in
    // the affix rather than in the room change.
    this.spellAffixes.forEach((affixes, i) => {
      const slot = this.world.spells[i];
      if (!slot || !affixes) return;
      let next = slot;
      for (const a of affixes) next = attachAffix(next, a.id, a.tier) ?? next;
      this.world.spells[i] = next;
    });
    this.spellLevels.forEach((level, i) => {
      const slot = this.world.spells[i];
      if (slot && level > 1) this.world.spells[i] = withLevel(slot, level);
    });

    this.applyMood(mood);
    this.drawTiles();
    this.buildExits();
    this.entering = false;
    if (this.pendingTitle) { this.pendingTitle = false; this.showTitle(); }
  }

  /**
   * This room's offer questions: the portals out of it (doc 003's per-portal
   * question), the cards in it (doc 007's offer), and a vendor's shelves,
   * each over the legal answers code enumerated. Built before the room is
   * planned, so they can travel in its request.
   */
  private offerRequest(
    ctx: RunContext, src: RngSource, run: RunShape, stage: RoomStage, fight: boolean, held: HeldShape[],
  ): OfferAsk {
    const kind = this.roomReward;
    const promise: OfferPromise = fight ? { ...this.roomPromise, style: this.intent.preset } : {};
    if (stage === "boss") return { kind, promise, request: {} };
    const needs = this.cardNeeds(ctx);
    const cards: CardRequest[] = [];
    if (fight && kind !== "gold")
      cards.push({
        room_index: run.roomIndex, pool: cardPool(ITEMS, this.ownedFor(kind), kind, held, promise, needs),
        count: CARDS_PER_OFFER, pity: this.needMisses >= 3, temptation: this.offersMade % 4 === 3,
      });
    // The merchant's shelf: one card of each kind gold buys.
    if (!fight && (stage === "shop" || this.npcRoom === "merchant"))
      for (const k of SHELF_KINDS)
        cards.push({
          room_index: run.roomIndex, pool: cardPool(ITEMS, this.ownedFor(k), k, held, {}, needs),
          count: 1, pity: false, temptation: false, salt: `shop_${k}`,
        });
    return {
      kind, promise,
      request: {
        // The last shop's portals open onto the boss; nothing to ask about them.
        ...(stage === "shop" ? {} : { portals: portalChoices(run, src.stream("portal-count")) }),
        cards,
      },
    };
  }

  /**
   * This room's offer, **from the Director**: the answer that came with the
   * room plan, or — for a vendor's room, which has no room plan — one
   * request of its own. `ruleOffer` is what ships if the Director cannot
   * answer at all; its own fallback to the rule table covers a failed Jev
   * call, and this covers everything else.
   */
  private async planOffer(
    ctx: RunContext, src: RngSource, run: RunShape, stage: RoomStage, fight: boolean, held: HeldShape[],
    ask: OfferAsk, answered?: OfferPlan,
  ): Promise<{ offer: Offer; stock: OfferCard[] }> {
    this.portalPlan = null;
    this.cardPlan = null;
    const { kind, promise } = ask;
    if (stage === "boss") return { offer: { cards: [], doors: [], coins: 0 }, stock: [] };
    try {
      const plan = answered ?? await this.director.planOffer(ctx, ask.request);
      /*
       * Recorded against the request the questions travelled in — the room's
       * round 1, or the vendor room's own offer request — so the readout can
       * join each answer to the question it answered. A shelf's decisions are
       * named as its questions were, with their prefix.
       */
      const purpose = answered ? "room" : "offer";
      const record = (decisions: readonly Decision[], offer?: OfferRecord) => {
        const prev = this.planRecords.get(purpose);
        this.planRecords.set(purpose, {
          decisions: [...(prev?.decisions ?? []), ...decisions],
          offers: [...(prev?.offers ?? []), ...(offer ? [offer] : [])],
        });
      };
      if (plan.portals) {
        this.portalPlan = plan.portals;
        record(plan.portals.decisions);
      }
      const doors = plan.portals
        ? doorSpecs(plan.portals.doors, run.roomIndex)
        : doorSpecs(ruleDoors(run, src.stream("offer")), run.roomIndex);
      let cards: OfferCard[] = [];
      let stock: OfferCard[] = [];
      const reqs = ask.request.cards ?? [];
      const cardPlan = plan.cards[0];
      if (fight && kind !== "gold" && cardPlan && reqs[0]) {
        this.cardPlan = cardPlan;
        record(cardPlan.decisions, { prefix: "", label: `${kind} cards`, blended: cardPlan.blended, ids: cardPlan.ids });
        cards = cardsFor(ITEMS, kind, cardPlan.ids, promise);
        const pool = reqs[0].pool;
        const hadNeed = cardPlan.ids.some((id) => pool.candidates.find((c) => c.id === id)?.facts.includes("need"));
        this.needMisses = hadNeed ? 0 : this.needMisses + 1;
        this.offersMade++;
      } else if (!fight) {
        stock = plan.cards.flatMap((p, i) => {
          const k = reqs[i]!.pool.kind;
          const prefix = `shop_${k}__`;
          record(p.decisions.map((d) => ({ ...d, question: `${prefix}${d.question ?? ""}` })),
            { prefix, label: `shelf: ${k}`, blended: p.blended, ids: p.ids });
          const c = cardsFor(ITEMS, k, p.ids)[0];
          return c ? [c] : [];
        });
      }
      return {
        offer: { cards, doors, ...(fight && kind === "gold" ? { coins: goldRoomCoins(this.roomPromise.grade) } : {}) },
        stock,
      };
    } catch (err) {
      console.warn("[director] offer fell back to the rules:", err);
      const offer = ruleOffer(ITEMS, src.stream("offer"), this.owned, run,
        stage === "shop" ? shopKind(src.stream("shop")) : kind, held, promise);
      const stockRng = src.stream("stock");
      const stock = fight ? [] : SHELF_KINDS
        .map((k) => offerCards(ITEMS, stockRng, this.owned, k, held)[0])
        .filter((c): c is OfferCard => !!c);
      return { offer, stock };
    }
  }

  /**
   * What "owned" means per kind. A spell held below the level cap stays in
   * the pool — a second copy levels it up — so only a held spell at the cap
   * is spent; stats and affixes keep the run's whole history.
   */
  private ownedFor(k: RewardCardKind): string[] {
    return k === "spell"
      ? this.world?.spells.flatMap((x, i) => (x && (this.spellLevels[i] ?? 1) >= SPELL_LEVEL_MAX ? [x.item.base] : [])) ?? []
      : this.owned;
  }

  /** What the offer's facts read off the run: doc 007's needs. */
  private cardNeeds(ctx: RunContext): CardNeeds {
    const keys = this.slots.flatMap((x, i) => (x ? [{ base: x.base, affixes: this.spellAffixes[i] ?? [] }] : []));
    return cardNeedsFor(ctx.labels, this.intent.preset, keys, ITEMS);
  }

  /**
   * The run's state as the Director reads it — the same labels the harness
   * builds, so the browser and the measurement plan from the same facts.
   */
  private directorContext(index: number, hearts: number, staff: Staff): RunContext {
    const sim = simulateStaff(staff, this.slots, ITEMS);
    // Doc 003's pacing rule: no hazards when the player is critical or has
    // just taken heavy damage.
    const hazard_cap = hearts <= 1 || this.heartsLostRecent >= 2 ? "none" : hearts <= 2 ? "low" : "high";
    return {
      run_id: this.runSeed, seed: this.runSeed, room_index: index,
      labels: {
        health: bucketHealth(hearts),
        recent_damage: bucketRecentDamage(this.heartsLostRecent),
        clear_speed: bucketClearSpeed(this.lastClearMs, 30_000),
        movement_pressure_recent: bucketMovementPressure(0.5),
        run_progress: bucketRunProgress(index),
        gold: bucketGold(this.runGold),
        tension_cap: "peak_allowed", hazard_cap, pressure_cap: 5,
        build: {
          archetype: sim.archetype, bottleneck: sim.bottleneck,
          mana_sustain: sim.mana_sustain, range: "mid",
          missing_roles: sim.missing_roles, dominant_tags: sim.dominant_tags,
        },
        preference: { dominant: sim.dominant_tags.slice(0, 3), consistency: "on_plan" },
      },
      staff, slots: this.slots, inventory: [], history: this.history, intent: this.intent,
    };
  }

  /** Reorders two spell keys, with the affixes riding on their spells. */
  private swapSpells(a: number, b: number): void {
    const w = this.world;
    if (!w || a === b || a < 0 || b < 0 || a >= w.spells.length || b >= w.spells.length) return;
    const spells = w.spells;
    [spells[a], spells[b]] = [spells[b] ?? null, spells[a] ?? null];
    const slots = [...w.slots];
    [slots[a], slots[b]] = [slots[b] ?? null, slots[a] ?? null];
    w.slots = slots;
    this.slots = [...slots];
    [this.spellAffixes[a], this.spellAffixes[b]] = [this.spellAffixes[b] ?? [], this.spellAffixes[a] ?? []];
    [this.spellLevels[a], this.spellLevels[b]] = [this.spellLevels[b] ?? 1, this.spellLevels[a] ?? 1];
  }

  /** What the debug panel shows. Read off the plan and the live world. */
  private debugSnapshot(): DebugSnapshot {
    const w = this.world;
    const plan = this.planned;
    const room = w.room;
    const enc = plan?.plan.encounter ?? null;
    const byArchetype: Record<string, number> = {};
    for (const e of w.enemies) if (e.hp > 0) byArchetype[e.archetype] = (byArchetype[e.archetype] ?? 0) + 1;
    const mods = this.mods as unknown as Record<string, number>;
    return {
      seed: this.runSeed,
      room: {
        index: this.roomIndex, stage: stageFor(this.roomIndex), type: room.room_type, elite: this.elite,
        tension: this.tension,
        space: room.params.space, symmetry: room.params.symmetry,
        mood: `${room.params.mood.temperature} / ${room.params.mood.brightness} / ${room.params.mood.particle_intensity}`,
        measured: room.measured as unknown as Record<string, number>,
        zones: room.zones.map((z) => ({ id: z.id, feature: z.feature })),
        sources: plan
          ? {
            params: plan.source.params, mood: plan.source.mood, zones: plan.source.zones,
            encounter: plan.source.encounter, affixes: plan.source.affixes ?? "none", layout: plan.source.layout,
          }
          : { layout: "fixed (merchant or boss)" },
        trimmed: plan?.trimmed ?? false,
      },
      encounter: enc
        ? {
          profile: enc.profile as unknown as Record<string, string | number>,
          band: enc.band, pressure: enc.measured_pressure, source: enc.source,
          affixes: enc.elite_affixes,
          roster: enc.waves.reduce((a, wave) => a + wave.spawns.reduce((b, x) => b + x.count, 0), 0),
          waves: enc.waves.map((wave) => ({
            atMs: wave.at_ms,
            spawns: wave.spawns.map((x) => `${x.count} ${x.archetype}${x.count > 1 ? "s" : ""} @${x.spawn_group}`).join(", "),
          })),
        }
        : null,
      reward: this.offer
        ? {
          kind: this.npcRoom ? `${this.npcRoom}'s room` : this.roomReward,
          cards: this.offer.cards.map((c, i) => ({
            kind: c.kind, label: c.label, stats: c.stats, origin: this.cardPlan?.origins[i] ?? "",
          })),
          cardsBy: this.cardPlan
            ? `Director (${this.cardPlan.source}), asked with the room, variety ${this.cardPlan.variety}`
            : this.offer.cards.length ? "rule code (fallback)" : "no cards",
          portalsBy: this.portalPlan ? `Director (${this.portalPlan.source})` : this.offer.doors.length ? "rule code (the merchant's doors to the boss)" : "no portals",
          portals: this.offer.doors.map((d) => ({
            reward: d.npc ? `${d.npc} (vendor)` : d.reward, elite: d.elite, type: d.type,
            promise: [d.school, d.family, (d.grade ?? 1) > 1 ? `grade ${d.grade}` : ""].filter(Boolean).join(" · "),
          })),
        }
        : null,
      doors: this.doorPlan
        ? {
          tension: this.doorPlan.tension,
          sources: { tension: this.doorPlan.source.tension },
        }
        : null,
      player: {
        hearts: w.player.hearts, maxHealth: (MAX_HEARTS + w.player.mods.maxHearts) * HP_PER_HEART, mana: w.player.mana, manaMax: w.staff.mana_max,
        gold: this.runGold + w.gold, mods,
      },
      spells: w.spells.map((slot, i) => ({
        key: SPELL_KEYS[i] ?? String(i + 1),
        name: slot ? titleOfId(slot.item.base) : null,
        cost: slot ? slotCost(slot, ITEMS, w.staff) : null,
        cooldownMs: slot?.cooldownMs ?? 0,
        affixes: slot ? slot.affixes.map((a) => `${a.id}${a.tier > 1 ? ` x${a.tier}` : ""}`) : [],
      })),
      enemies: { alive: w.enemies.filter((e) => e.hp > 0).length, pending: w.pendingWaves.length, byArchetype },
      history: { rooms: this.history.rooms, tensions: this.history.tensions },
      director: buildReadout(this.directorLog, this.planRecords),
    };
  }

  /**
   * Puts the boss in the middle of its arena.
   *
   * Placed directly rather than assembled, because `assembleEncounter` builds
   * to a measured pressure band out of the six-body roster and the boss is
   * neither — it is excluded from that roster **by type** (`AssemblableId`) so
   * it cannot leak into a normal room, which means the one room it belongs in
   * has to place it by hand.
   *
   * Awake from the first frame, and with no spawn fade. Everything else in the
   * game gets a moment of not having noticed the player; the boss is the one
   * body the player walked in to fight, and a boss that has to be woken up
   * reads as the room not having started.
   */
  /**
   * The debug panel's "put one of these in front of me". Awake, on the
   * nearest floor a few tiles along the player's facing, with an elite's
   * enrage and a pair of affixes when asked. It is a normal body once it is
   * in — it counts toward clearing and it drops what its kind drops.
   */
  private debugSpawn(id: string, elite: boolean): void {
    const w = this.world;
    if (!(ENEMY_IDS as readonly string[]).includes(id) && id !== "boss") return;
    const p = w.player;
    const want = { x: p.x + Math.cos(p.facing) * 110, y: p.y + Math.sin(p.facing) * 110 };
    let gx = Math.max(1, Math.min(GRID_W - 2, Math.floor(want.x / TILE_PX)));
    let gy = Math.max(1, Math.min(GRID_H - 2, Math.floor(want.y / TILE_PX)));
    const floor = (x: number, y: number) =>
      x >= 1 && y >= 1 && x < GRID_W - 1 && y < GRID_H - 1 && w.room.grid[y * GRID_W + x] === Tile.Floor;
    search: for (let r = 0; r < Math.max(GRID_W, GRID_H); r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (floor(gx + dx, gy + dy)) { gx += dx; gy += dy; break search; }
        }
    const nextId = w.enemies.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    const e = makeEnemy(
      nextId, id as EnemyId, (gx + 0.5) * TILE_PX, (gy + 0.5) * TILE_PX,
      elite ? ["armored", "swift"] : [],
    );
    e.spawnFadeMs = 0;
    e.awake = true;
    w.enemies.push(e);
    w.cleared = false;
  }

  private spawnBoss(): void {
    const w = this.world;
    const boss = makeEnemy(1, "boss", (GRID_W / 2) * TILE_PX, (GRID_H / 2) * TILE_PX, []);
    boss.spawnFadeMs = 0;
    boss.awake = true;
    w.enemies.push(boss);
  }

  /**
   * Builds the portal and reward sprites for the room.
   *
   * Persistent objects rather than per-frame draws, because a portal is a
   * landmark: it is in the same place for the whole room, and rebuilding it
   * sixty times a second to animate a glow would be the expensive way to do
   * what a per-frame property update does.
   *
   * The reward group starts empty and is filled when the room clears, since
   * the cards do not exist until then.
   */
  private buildExits(): void {
    // A new room: nothing from the last one is still in the air.
    this.fxSparks = [];
    this.fxRings = [];
    this.fxSlashes = [];
    this.ramSkidMs = 0;
    for (const n of this.npcs) { n.img.destroy(); n.glow.destroy(); n.badge?.destroy(); }
    this.npcs = [];
    for (const f of this.floorSpells) { f.img?.destroy(); f.glow.destroy(); }
    this.floorSpells = [];
    if (this.shopping) {
      /*
       * **Large, lit and badged**, because a vendor is the reason the room
       * exists. At the sheet's own scale it was a body-sized sprite among
       * crates and pots, and a player walking in did not find it; now it is
       * half again as tall as the player, stands in a pool of warm light, and
       * carries its trade's badge over its head.
       */
      for (const { kind, gx, gy } of this.vendorSpots()) {
        const x = (gx + 0.5) * TILE_PX;
        const y = (gy + 0.5) * TILE_PX;
        const frame = kind === "merchant" ? "prop_merchant_0" : "prop_blacksmith_0";
        const glow = this.add.ellipse(x, y + 10, 58, 20, 0xffc868, 0.28).setDepth(1.9)
          .setBlendMode(Phaser.BlendModes.ADD);
        const img = this.add.image(x, y + 10, this.uiTextureKey, safeFrame(this.atlas, frame, "prop_shop_0"))
          .setOrigin(0.5, 0.85).setScale(1.6 / ART_SCALE).setDepth(5);
        const badgeFrame = kind === "merchant" ? "icon_npc_merchant" : "icon_npc_smith";
        const badge = this.atlas.has(badgeFrame)
          ? this.add.image(x, y - 44, this.crispTextureKey, badgeFrame).setOrigin(0.5).setScale(1.25).setDepth(9.4)
          : null;
        this.npcs.push({ kind, x, y, img, glow, badge });
      }
    }
    for (const g of this.portalGfx) { g.body.destroy(); g.badge.destroy(); g.plate.destroy(); g.tag?.destroy(); }
    for (const m of this.eliteMarks) m.mark.destroy();
    this.portalGfx = [];
    this.eliteMarks = [];
    this.hideRewards();
    this.destroyRewardDrop();

    for (const portal of this.world.portals) {
      const body = this.add.image(portal.x, portal.y, this.textureKey, "prop_portal_shut_0")
        .setOrigin(0.5).setScale(1 / ART_SCALE).setDepth(2.5);
      /*
       * The badge is drawn from the **untinted** sheet, like the HUD.
       *
       * A door type is a promise about where the player is going, and the room
       * mood must not recolour a promise — the same reasoning that made a cold
       * room's dropped heart purple. The plate behind it is `ui_card_frame`,
       * which exists in the sheet and had never been drawn anywhere: without
       * it the icon floats with nothing to say it is a label.
       */
      const plate = this.add.image(portal.x, portal.y - TILE_PX * 1.15, this.uiTextureKey, "ui_card_frame")
        .setOrigin(0.5).setScale(0.62 / ART_SCALE).setDepth(8.4);
      /*
       * The badge is the **reward kind**, which is the thing being chosen
       * between. It used to be the room type, and that said "combat" — which
       * told the player nothing, because the reward was decided somewhere they
       * could not see.
       *
       * Spell, affix and gold borrow the reward pedestal art they share with
       * the card screen; `stat` has no art at all yet and falls through to the
       * old door icon. All four are requested in the art work order.
       */
      const npcFrame = portal.npc === "merchant" ? "icon_npc_merchant" : portal.npc === "smith" ? "icon_npc_smith" : "";
      const badgeFrame = portal.npc
        ? (this.atlas.has(npcFrame) ? npcFrame : portal.npc === "merchant" ? "prop_merchant_0" : "prop_blacksmith_0")
        : this.atlas.has(`icon_reward_${portal.reward}`)
        ? `icon_reward_${portal.reward}`
        : this.atlas.has(`prop_reward_${portal.reward}_0`)
          ? `prop_reward_${portal.reward}_0`
          : `icon_door_${portal.type}`;
      const badge = this.add.image(portal.x, portal.y - TILE_PX * 1.15, this.uiTextureKey, badgeFrame)
        .setOrigin(0.5).setDisplaySize(16, 16).setDepth(8.5);
      /*
       * An elite portal is marked, not recoloured. Doc 003 makes difficulty a
       * second axis, so it has to read *alongside* the kind rather than
       * instead of it; a red badge would say one thing where two are meant.
       */
      if (portal.elite) {
        const mark = this.atlas.has("ui_elite_badge")
          ? this.add.image(portal.x, portal.y - TILE_PX * 1.72, this.crispTextureKey, "ui_elite_badge")
            .setOrigin(0.5).setScale(1).setDepth(8.6)
          : this.add.text(
            portal.x, portal.y - TILE_PX * 1.75, "ELITE",
            { fontFamily: "monospace", fontSize: `${Math.round(7 * ZOOM)}px`, color: "#ff8877" },
          ).setOrigin(0.5).setScale(1 / ZOOM).setDepth(8.6);
        // Hidden with its portal; see `updateExits`. It was created visible
        // and never touched again, so the badge stood on bare floor for the
        // whole fight, over a portal that had not risen yet.
        mark.setVisible(false);
        this.eliteMarks.push({ portal, mark });
      }
      /*
       * The promise, under the badge: a spell door's school in its colour, a
       * stat door's family, and the grade as pips — "the build question at
       * the door". An elite door's grade is why it is worth the harder room.
       */
      const grade = portal.grade ?? 1;
      const pips = grade > 1 ? ` ${"★".repeat(grade - 1)}` : "";
      const label = portal.npc ? (portal.npc === "merchant" ? "merchant" : "blacksmith")
        : portal.school ? `${portal.school}${pips}` : portal.family ? `${portal.family}${pips}` : pips.trim();
      const colour = portal.school ? (SCHOOL_COLOUR as Record<string, string>)[portal.school] ?? "#e8e3d8" : grade > 1 ? "#ffd45e" : "#c9cfe8";
      const tag = label
        ? this.add.text(portal.x, portal.y - TILE_PX * 0.55, label.toUpperCase(), {
          fontFamily: "monospace", fontSize: `${Math.round(7 * ZOOM)}px`, color: colour,
          backgroundColor: "#0d0b1fcc", padding: { x: 2 * ZOOM, y: 1 * ZOOM },
        }).setOrigin(0.5).setScale(1 / ZOOM).setDepth(8.6).setVisible(false)
        : null;
      this.portalGfx.push({ portal, body, badge, plate, tag });
    }
  }

  /**
   * The action bar, after Diablo's: every verb a **slot** with its icon, its
   * state drawn on the icon — a cooldown sweeping down over it, dim when it
   * cannot be afforded, a count in the corner — and its key on a **keycap**
   * under it. The key letters had been mixed into the words ("L spin",
   * "U Magic Bolt") and could not be told from them; a keycap is a different
   * shape from text, so the eye separates the two without reading. The
   * spells' names are on the Tab screen.
   */
  /**
   * Fades what was drawn since `from` when a body is under it. The HUD lies
   * over the room, and a room whose floor reaches the edge put the player —
   * or a rusher — behind the action bar; faded, the HUD stays readable and
   * the thing behind it is seen.
   */
  private fadeIfCovering(from: number, x: number, y: number, w: number, h: number): void {
    const world = this.world;
    const under = (px: number, py: number, r: number) =>
      px + r > x && px - r < x + w && py + r > y && py - r < y + h;
    const covering = under(world.player.x, world.player.y - BODY_LIFT, 14)
      || world.enemies.some((e) => e.hp > 0 && under(e.x, e.y, e.radius));
    if (!covering) return;
    const kids = this.sprites.getChildren();
    for (let i = from; i < kids.length; i++) {
      const k = kids[i] as unknown as { setAlpha?: (a: number) => void; alpha?: number };
      k.setAlpha?.((k.alpha ?? 1) * 0.28);
    }
  }

  private drawActionBar(w: World): void {
    const fadeFrom = this.sprites.getLength();
    const SLOT = 22;
    const GAP = 5;
    const p = w.player;
    type Slot = {
      key: string; icon: string | null; sheet: "crisp" | "art";
      /** 0..1 of the slot covered by the cooldown, from the top. */
      cooling: number; usable: boolean; corner: string; accent: number; ring?: number;
    };
    const slots: Slot[] = [];
    // The three innate verbs have their own delivered icons.
    const verb = (own: string, fallback: string) => (this.atlas.has(own) ? own : fallback);
    slots.push({ key: "J", icon: verb("icon_action_attack", "icon_stat_keen_edge"), sheet: "crisp", cooling: 0, usable: true, corner: "", accent: 0xe8e3d8 });
    for (let i = 0; i < SPELL_KEYS.length; i++) {
      const slot = w.spells[i] ?? null;
      if (!slot) { slots.push({ key: SPELL_KEYS[i]!, icon: null, sheet: "crisp", cooling: 0, usable: false, corner: "", accent: 0x4a5480 }); continue; }
      const cost = slotCost(slot, ITEMS, w.staff);
      const full = spellCooldownMs(cost / BASELINE_MANA_MAX);
      const level = this.spellLevels[i] ?? 1;
      slots.push({
        key: SPELL_KEYS[i]!, icon: `icon_${slot.item.base}`, sheet: "crisp",
        cooling: slot.cooldownMs > 0 ? Math.min(1, slot.cooldownMs / Math.max(1, full)) : 0,
        usable: p.mana >= cost, corner: level > 1 ? "I".repeat(level) : "",
        accent: 0x8fdcff,
      });
    }
    const charges = Math.floor(p.rage);
    slots.push({
      key: "L", icon: verb("icon_action_spin", "icon_stat_keen_edge"), sheet: "crisp",
      // The spin's slot fills from the bottom as the next charge is earned.
      cooling: charges > 0 ? 0 : 1 - (p.rage - charges), usable: charges > 0,
      corner: `${charges}`, accent: 0xff7a4a, ring: 0xff7a4a,
    });
    slots.push({
      key: "K", icon: verb("icon_action_dodge", "icon_stat_second_wind"), sheet: "crisp",
      cooling: p.dashCooldownMs > 0 ? Math.min(1, p.dashCooldownMs / (DASH_COOLDOWN_MS * p.mods.dashCooldown + DASH_MS)) : 0,
      usable: p.dashCooldownMs <= 0, corner: "", accent: 0x8fdcff,
    });

    /*
     * Two groups, not one row. The spells are the build — what changes from
     * run to run — and the attack, spin and dodge are the body's own verbs;
     * in one row they read as six of the same thing. The spells sit in the
     * middle, full size, on their own backing; the innate three sit to their
     * right, smaller and in bone rather than the spells' blue.
     */
    const spells = slots.slice(1, 1 + SPELL_KEYS.length);
    const innate = [slots[0]!, ...slots.slice(1 + SPELL_KEYS.length)];
    const y = VIEW_H - 27;
    // No names on the bar: there is no room for them, and the Tab screen has them.
    const SMALL = 17;
    const spellPitch = SLOT + GAP;
    const innatePitch = SMALL + GAP;
    const spellW = (spells.length - 1) * spellPitch + SLOT;
    const innateW = (innate.length - 1) * innatePitch + SMALL;
    const GROUP_GAP = 18;
    const sx0 = VIEW_W / 2 - (spellW + GROUP_GAP + innateW) / 2;
    const ix0 = sx0 + spellW + GROUP_GAP;
    const top = 0;
    this.sprites.add(this.add.rectangle(sx0 - 7, y - SLOT / 2 - 5 - top, spellW + 14, SLOT + 22 + top, 0x0d0b1f, 0.7).setOrigin(0).setDepth(99));
    this.sprites.add(this.add.rectangle(ix0 - 6, y - SMALL / 2 - 4 - top, innateW + 12, SMALL + 20 + top, 0x0d0b1f, 0.55).setOrigin(0).setDepth(99));
    spells.forEach((sl, i) => this.drawSlot(sl, sx0 + i * spellPitch + SLOT / 2, y, SLOT, 0x8fdcff));
    innate.forEach((sl, i) => this.drawSlot(sl, ix0 + i * innatePitch + SMALL / 2, y + (SLOT - SMALL) / 2, SMALL, 0xd8d0bc));
    this.fadeIfCovering(fadeFrom, sx0 - 7, y - SLOT / 2 - 18, ix0 + innateW + 6 - (sx0 - 7), SLOT + 36);
  }

  /** One action-bar slot: frame, icon, cooldown, corner count, and its keycap. */
  private drawSlot(
    sl: { key: string; icon: string | null; cooling: number; usable: boolean; corner: string; accent: number; ring?: number },
    x: number, y: number, size: number, groupAccent: number,
  ): void {
    const accent = sl.ring ?? groupAccent;
    this.sprites.add(this.add.rectangle(x, y, size, size, 0x161334, 1).setDepth(101)
      .setStrokeStyle(1.5, sl.usable ? accent : 0x3a3f5a, sl.usable ? 0.9 : 0.7));
    if (sl.icon && this.atlas.has(sl.icon)) {
      const img = this.add.image(x, y, this.crispTextureKey, sl.icon).setOrigin(0.5).setScale(size / 20).setDepth(102);
      if (!sl.usable) img.setTint(0x55506a);
      this.sprites.add(img);
    }
    // The spin: a ring round its sword, so it is not read as the attack.
    if (sl.ring)
      this.sprites.add(this.add.circle(x, y, size / 2 - 2.5, 0, 0).setStrokeStyle(1.2, sl.ring, sl.usable ? 0.9 : 0.35).setDepth(102.5));
    if (sl.cooling > 0)
      this.sprites.add(this.add.rectangle(x - size / 2, y - size / 2, size, size * sl.cooling, 0x0d0b1f, 0.72).setOrigin(0).setDepth(103));
    if (sl.corner)
      this.ftext(`slot:corner:${sl.key}`, x + size / 2 - 1, y + size / 2 - 1, sl.corner, {
        fontFamily: "monospace", fontSize: `${Math.round(6 * ZOOM)}px`, color: "#ffffff",
        stroke: "#0d0b1f", strokeThickness: 2 * ZOOM,
      }).setScale(1 / ZOOM).setOrigin(1, 1).setDepth(104);
    const capY = y + size / 2 + 7;
    const cap = this.add.graphics().setDepth(103);
    cap.fillStyle(0x2a2750, 1);
    cap.fillRoundedRect(x - 6, capY - 5, 12, 10, 2.5);
    cap.lineStyle(1, 0x8792b5, 0.9);
    cap.strokeRoundedRect(x - 6, capY - 5, 12, 10, 2.5);
    this.sprites.add(cap);
    this.ftext(`slot:key:${sl.key}`, x, capY, sl.key, {
      fontFamily: "monospace", fontSize: `${Math.round(7 * ZOOM)}px`, color: "#e8e3d8",
    }).setScale(1 / ZOOM).setOrigin(0.5).setDepth(104);
  }

  /* -------------------------------- game over -------------------------------- */

  private showGameOver(): void {
    const o: Phaser.GameObjects.GameObject[] = [];
    o.push(this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0x0d0b1f, 0.78).setDepth(229));
    o.push(this.menuText(VIEW_W / 2, VIEW_H / 2 - 30, "GAME OVER", 22, "#ff8877"));
    o.push(this.menuText(VIEW_W / 2, VIEW_H / 2, `room ${this.roomIndex} · ${stageFor(this.roomIndex)} · ${this.runGold + this.world.gold} gold`, 8, "#c9cfe8"));
    // A new run from room one, not a revive: everything the run carried goes.
    o.push(this.keys_(VIEW_W / 2, VIEW_H / 2 + 30, "[R] new run from room 1     [Esc] title", 9, "#e8e3d8"));
    this.gameOverUi = o;
    /*
     * Answered by key events rather than by polling `JustDown`: the polled
     * edge could be consumed by another reader in the same frame, and the
     * card then ignored Esc. The listeners go when the card does.
     */
    const kb = this.input.keyboard!;
    const toTitle = () => { this.pendingTitle = true; this.restartRun(); };
    const again = () => this.restartRun();
    kb.once("keydown-ESC", toTitle);
    kb.once("keydown-R", again);
    this.gameOverKeys = () => { kb.off("keydown-ESC", toTitle); kb.off("keydown-R", again); };
  }

  private hideGameOver(): void {
    for (const g of this.gameOverUi ?? []) g.destroy();
    this.gameOverUi = null;
    this.gameOverKeys?.();
    this.gameOverKeys = null;
  }

  /* ------------------------------ title, pause ------------------------------ */

  /* --------------------------------- intent --------------------------------- */

  /**
   * The intent screen, before the run: four build styles, and — when the
   * Director is Jev — a line for the player's own words. The rule arm cannot
   * read free text, so in rule mode the line says so rather than taking
   * input that would be ignored.
   */
  private showIntent(): void {
    this.intentUi = { selected: STYLES.findIndex((x) => x.id === this.intent.preset), text: this.intent.free_text ?? "", objects: [] };
    if (this.intentUi.selected < 0) this.intentUi.selected = 0;
    if (this.director.mode === "jev") this.input.keyboard!.on("keydown", this.onIntentType, this);
    this.renderIntent();
  }

  private readonly onIntentType = (ev: KeyboardEvent): void => {
    const ui = this.intentUi;
    if (!ui) return;
    if (ev.key === "Backspace") ui.text = ui.text.slice(0, -1);
    else if (ev.key.length === 1 && ui.text.length < 80 && !/[wsad]/i.test(ev.key) || (ev.key.length === 1 && ev.shiftKey)) ui.text += ev.key;
    this.renderIntent();
  };

  private hideIntent(): void {
    for (const g of this.intentUi?.objects ?? []) g.destroy();
    this.demo = null;
    if (this.demoCam) { this.cameras.remove(this.demoCam); this.demoCam = null; }
    this.input.keyboard!.off("keydown", this.onIntentType, this);
    this.intentUi = null;
  }

  private renderIntent(): void {
    const ui = this.intentUi;
    if (!ui) return;
    for (const g of ui.objects) g.destroy();
    ui.objects = [];
    const cx = VIEW_W / 2;
    // Opaque: the demo is drawn in the room behind this screen, and at 0.94
    // the bodies moving there showed through.
    ui.objects.push(this.add.rectangle(cx, VIEW_H / 2, VIEW_W, VIEW_H, 0x0d0b1f, 1).setDepth(230));
    ui.objects.push(this.menuText(cx, 34, "HOW DO YOU WANT TO PLAY?", 13, "#ffe9a8"));
    ui.objects.push(this.menuText(cx, 52, "the Director leans the run toward it: your second spell, the doors, the cards", 7, "#8792b5"));
    const W = 116;
    const H = 128;
    const CY = 136;
    STYLES.forEach((st, i) => {
      const x = cx + (i - (STYLES.length - 1) / 2) * (W + 10);
      const on = i === ui.selected;
      const panel = this.add.rectangle(x, CY, W, H, on ? 0x221d46 : 0x161334, 0.97).setDepth(231)
        .setStrokeStyle(on ? 2 : 1, on ? 0xffe9a8 : 0x4a5480, 1);
      ui.objects.push(panel);
      // The style's own picture: its starting spell's icon.
      // Spirit Blades has no icon drawn yet; the sword stands in for the Blade style.
      const own = `icon_${STYLE_START[st.id]}`;
      const icon = this.atlas.has(own) ? own : "icon_stat_keen_edge";
      if (this.atlas.has(icon)) ui.objects.push(this.add.image(x, CY - 42, this.crispTextureKey, icon).setScale(2).setDepth(232));
      ui.objects.push(this.menuText(x, CY - 16, st.name, 10, on ? "#ffe9a8" : "#e8e3d8").setDepth(232));
      ui.objects.push(this.menuText(x, CY - 4, st.id.toUpperCase(), 6, "#6a7396").setDepth(232));
      ui.objects.push(this.add.text(x, CY + 6, st.desc, {
        fontFamily: "monospace", fontSize: `${Math.round(7 * ZOOM)}px`, color: "#c9cfe8", align: "center",
        wordWrap: { width: (W - 14) * ZOOM },
      }).setOrigin(0.5, 0).setScale(1 / ZOOM).setDepth(232));
    });
    /*
     * The starting spell of the chosen style, shown: its card on the right,
     * and on the left a small stage where it is cast at two dummies on a
     * loop (`drawIntentDemo`), so the difference between the styles is
     * something the player sees rather than reads.
     */
    const start = STYLE_START[STYLES[ui.selected]!.id];
    const def = ITEMS.get(start);
    const PY = 262;
    ui.objects.push(this.add.rectangle(cx, PY, 560, 92, 0x161334, 0.97).setStrokeStyle(1, 0x4a5480, 1).setDepth(231));
    ui.objects.push(this.add.rectangle(cx - 190, PY, 170, 80, 0x0d0b1f, 1).setStrokeStyle(1, 0x2a2750, 1).setDepth(231.5));
    ui.objects.push(this.menuText(cx + 90, PY - 34, `STARTING SPELL  ·  ${titleOfId(start).toUpperCase()}`, 8, "#ffe9a8").setDepth(232));
    if (def) {
      const row = this.statRow(offerStatParts(def), 330, 7, 232, "center");
      row.box.setPosition(cx + 90, PY - 24);
      ui.objects.push(row.box);
    }
    ui.objects.push(this.add.text(cx + 90, PY - 8, (def ? spellDetail(def) : ""), {
      fontFamily: "monospace", fontSize: `${Math.round(6.5 * ZOOM)}px`, color: "#c9cfe8", align: "center",
      wordWrap: { width: 330 * ZOOM },
    }).setOrigin(0.5, 0).setScale(1 / ZOOM).setDepth(232));
    ui.objects.push(this.menuText(cx + 90, PY + 38, "with Magic Bolt, which every style starts with", 6, "#6a7396").setDepth(232));
    const jev = this.director.mode === "jev";
    /*
     * An input field, drawn as one: a label above, a bordered box, and inside
     * it either what the player has typed with a caret, or — when the rule
     * arm plans the run and cannot read words — a greyed placeholder in a
     * dimmed box, the way a disabled field looks.
     */
    const FW = 380;
    const FH = 18;
    const fy = 340;
    ui.objects.push(this.add.text(cx - FW / 2, fy - FH / 2 - 8, jev ? "In your own words (optional)" : "In your own words", {
      fontFamily: "monospace", fontSize: `${Math.round(7 * ZOOM)}px`, color: jev ? "#c9cfe8" : "#5a5f7a",
    }).setOrigin(0, 0.5).setScale(1 / ZOOM).setDepth(232));
    const field = this.add.graphics().setDepth(231.5);
    field.fillStyle(jev ? 0x0d0b1f : 0x14122a, 1);
    field.fillRoundedRect(cx - FW / 2, fy - FH / 2, FW, FH, 3);
    field.lineStyle(1, jev ? 0x8792b5 : 0x2e2b4a, 1);
    field.strokeRoundedRect(cx - FW / 2, fy - FH / 2, FW, FH, 3);
    ui.objects.push(field);
    const typed = jev && ui.text.length > 0;
    ui.objects.push(this.add.text(cx - FW / 2 + 6, fy, jev
      ? `${typed ? ui.text : ""}${(this.time.now >> 9) & 1 ? "|" : ""}${typed ? "" : "  e.g. I want to freeze things and shatter them"}`
      : "Needs the Jev Director. This run is planned by the rule arm.", {
      fontFamily: "monospace", fontSize: `${Math.round(7 * ZOOM)}px`,
      color: typed ? "#e8e3d8" : jev ? "#5a5f7a" : "#46435e",
    }).setOrigin(0, 0.5).setScale(1 / ZOOM).setDepth(232));
    ui.objects.push(this.keys_(cx, VIEW_H - 40, "[A][D] choose     [Enter] begin", 8, "#8792b5", 232));
  }

  /**
   * The starting spell's stage on the style screen: **the real simulation**,
   * not a drawing of it. A small world with the player and two enemies, the
   * chosen style's starting spell on a key, stepped every frame and cast
   * whenever it is ready; what is drawn is what the world holds — the same
   * bullets, fields, pets and pillars the game makes — scaled into the box.
   * Rebuilt every few seconds so a dash or a pillar starts over.
   */
  private drawIntentDemo(): void {
    const ui = this.intentUi;
    if (!ui) { this.demo = null; return; }
    const spell = STYLE_START[STYLES[ui.selected]!.id];
    const delta = this.game.loop.delta;
    if (!this.demo || this.demo.spell !== spell || this.demo.ageMs > 3600) this.demo = { spell, world: this.demoWorld(spell), acc: 0, ageMs: 0, numbers: [] };
    const d = this.demo;
    d.ageMs += delta;
    d.acc += Math.min(delta, 100);
    const w = d.world;
    while (d.acc >= STEP_MS) {
      d.acc -= STEP_MS;
      const target = w.enemies.find((e) => e.hp > 0);
      const slot = w.spells[0];
      const ready = !!slot && slot.cooldownMs <= 0 && d.ageMs > 250;
      // A spell that works at the caster's side is shown by walking it
      // through the enemies and back, which is how it is played.
      const close = ["orbit", "pillar"].includes(String(ITEMS.get(spell)?.params["shape"] ?? ""));
      const walk = close ? (d.ageMs < 400 ? 0 : d.ageMs < 1900 ? 1 : d.ageMs < 3400 ? -1 : 0) : 0;
      step(w, {
        ...NO_INPUT, moveX: walk, aimX: target?.x ?? w.player.x + 64, aimY: target?.y ?? w.player.y,
        spell: ready ? 0 : null,
      }, STEP_MS, ITEMS);
      w.player.mana = w.staff.mana_max;
      w.player.hearts = 99;
      for (const e of w.enemies) { e.attackCooldownMs = 99999; if (e.hp < 1) e.hp = e.maxHp; }
      for (const ev of w.events)
        if (ev.kind === "damage" && (ev.amount ?? 0) > 0)
          d.numbers.push({ x: ev.x, y: ev.y, text: `${Math.floor(ev.amount!)}`, colour: damageColour(ev.what ?? ""), ms: 0 });
    }
  }

  /**
   * The demo's picture: the game's own renderer, drawn with the demo world in
   * place of the room's, seen through a second camera whose viewport is the
   * preview box. So the preview is the spell as it looks in play — the
   * lightning's bent arcs, the blades, the burning ground — not a sketch.
   */
  private renderDemo(): void {
    const d = this.demo;
    if (!d) return;
    const real = this.world;
    this.world = d.world;
    this.renderingDemo = true;
    try {
      this.trackSpellBullets();
      this.draw();
      this.drawHazards();
      this.drawExpansion();
      this.drawSwing();
      this.drawEnemyBlades();
      // The spell's particles in the preview too.
      this.drawFx(this.game.loop.delta);
      this.fireFx.update(this.world, this.game.loop.delta);
      for (const n of d.numbers) {
        n.ms += this.game.loop.delta;
        this.sprites.add(this.add.text(n.x, n.y - (n.ms / 700) * 16, n.text, {
          fontFamily: "monospace", fontSize: `${Math.round(8 * ZOOM)}px`, color: n.colour, stroke: "#0d0b1f", strokeThickness: 2 * ZOOM,
        }).setScale(1 / ZOOM).setOrigin(0.5).setAlpha(1 - n.ms / 700).setDepth(9.9));
      }
      d.numbers = d.numbers.filter((n) => n.ms < 700);
    } finally {
      this.world = real;
      this.renderingDemo = false;
    }
    // The camera over the preview box, following the demo's player.
    const bx = VIEW_W / 2 - 190;
    const by = 262;
    const BW = 170;
    const BH = 80;
    if (!this.demoCam) {
      this.demoCam = this.cameras.add((bx - BW / 2) * ZOOM, (by - BH / 2) * ZOOM, BW * ZOOM, BH * ZOOM);
      this.demoCam.setZoom(ZOOM * 0.62);
    }
    this.demoCam.centerOn(d.world.player.x + 52, d.world.player.y - 4);
    // Only the world: every screen and HUD object stays off this camera.
    const ui = this.intentUi?.objects ?? [];
    this.demoCam.ignore([...ui, this.hud, this.prompt.box, ...this.demoIgnore]);
  }

  /** A small world for the style screen's demo: the player, the spell, two enemies that stand still. */
  private demoWorld(spell: string): World {
    const src = new RngSource(`demo-${spell}`);
    /*
     * Its own room: an open arena with nothing in the middle, so no enemy can
     * stand in a wall. Borrowing the current room put the demo wherever a
     * clear stretch happened to be, and a room without one put the enemies in
     * the stone. The arena's tiles replace the room's while the style screen
     * is up; the first room is rebuilt, tiles and all, when the run begins.
     */
    const w = createWorld({
      room: openDemoRoom(), encounter: null, props: 0,
      staff: runStaff(),
      slots: [plainInstance(spell), null, null, null, null, null], hearts: 99, rng: src.stream("world"),
    });
    w.player.x = VIEW_W / 2 - 70;
    w.player.y = VIEW_H / 2;
    const real = this.world;
    this.world = w;
    try { this.drawTiles(); } finally { this.world = real; }
    // Three, so a chain has somewhere to go twice.
    for (const [dx, dy] of [[70, -26], [96, 22], [128, -6]] as const) {
      const e = makeEnemy(w.nextEnemyId++, "rusher", w.player.x + dx, w.player.y + dy, []);
      // Facing the caster from the first frame, not the default east.
      e.facing = Math.atan2(w.player.y - e.y, w.player.x - e.x);
      e.spawnFadeMs = 0;
      e.awake = true;
      e.speed = 0;
      e.hp = e.maxHp = 99999;
      e.attackCooldownMs = 99999;
      w.enemies.push(e);
    }
    return w;
  }

  private readIntentKeys(): void {
    const ui = this.intentUi;
    if (!ui) return;
    const down = (k?: Phaser.Input.Keyboard.Key) => !!k && Phaser.Input.Keyboard.JustDown(k);
    let moved = false;
    if (down(this.keys.A) || down(this.keys.LEFT)) { ui.selected = (ui.selected + STYLES.length - 1) % STYLES.length; moved = true; }
    if (down(this.keys.D) || down(this.keys.RIGHT)) { ui.selected = (ui.selected + 1) % STYLES.length; moved = true; }
    if (moved) this.renderIntent();
    if (down(this.keys.ENTER)) void this.beginRun();
  }

  /**
   * The intent is in: the first room is rebuilt for the chosen style (its
   * second spell, and what the Director leans toward), then its plan is shown.
   */
  private async beginRun(): Promise<void> {
    const ui = this.intentUi;
    if (!ui) return;
    const text = ui.text.trim();
    this.intent = { preset: STYLES[ui.selected]!.id, ...(text ? { free_text: text } : {}) };
    this.hideIntent();
    this.showTransition();
    this.clearDirectorLog();
    this.slots = [];
    this.owned = [];
    await this.enterRoom(1, MAX_HEARTS + this.mods.maxHearts);
    if (this.showRoomParams) this.showRoomPlan();
    else this.hideTransition();
  }

  /** The title card, over the first room, which stands still behind it. */
  private showTitle(): void {
    this.hideTitle();
    // The room's own frame, not the camera's view: before the first render
    // the view is still empty, and the title is drawn before it.
    const view = new Phaser.Geom.Rectangle(0, 0, VIEW_W, VIEW_H);
    const o: Phaser.GameObjects.GameObject[] = [];
    o.push(this.add.rectangle(view.centerX, view.centerY, view.width, view.height, 0x0d0b1f, 0.86).setDepth(230));
    o.push(this.menuText(view.centerX, view.centerY - 36, "JEV ROGUE", 22, "#ffe9a8"));
    o.push(this.keys_(view.centerX, view.centerY + 26, "press [Enter] to start", 10, "#e8e3d8"));
    // The seed, small, in the corner: something to quote, not something to read.
    o.push(this.add.text(8, VIEW_H - 8, `seed ${this.runSeed}`, {
      fontFamily: "monospace", fontSize: `${Math.round(6 * ZOOM)}px`, color: "#5a5f7a",
    }).setOrigin(0, 1).setScale(1 / ZOOM).setDepth(231));
    this.titleUi = o;
  }

  private hideTitle(): void {
    for (const g of this.titleUi ?? []) g.destroy();
    this.titleUi = null;
  }

  private readTitleKeys(): void {
    const down = (k?: Phaser.Input.Keyboard.Key) => !!k && Phaser.Input.Keyboard.JustDown(k);
    if (down(this.keys.ENTER) || down(this.keys.SPACE) || down(this.keys.J)) {
      this.hideTitle();
      this.showIntent();
    }
  }

  /**
   * A numbers line in coloured parts: cost in mana blue, damage in white or
   * its element's colour, what the spell does in grey, modifiers in gold.
   * One run of gold was hard to read because nothing in it said where one
   * figure ended and the next began. Wraps at `width`; `align` places each line.
   */
  private statRow(
    parts: readonly { text: string; tone: string }[], width: number, px: number, depth: number,
    align: "left" | "center" = "left",
  ): { box: Phaser.GameObjects.Container; height: number } {
    const box = this.add.container(0, 0).setDepth(depth);
    const gap = px * 0.9;
    const lineH = px + 3;
    type Line = { items: Phaser.GameObjects.Text[]; w: number; y: number; h: number };
    const lines: Line[] = [{ items: [], w: 0, y: 0, h: lineH }];
    const newLine = (): Line => {
      const last = lines[lines.length - 1]!;
      const line = { items: [], w: 0, y: last.y + last.h, h: lineH };
      lines.push(line);
      return line;
    };
    for (const part of parts) {
      const t = this.add.text(0, 0, part.text, {
        fontFamily: "monospace", fontSize: `${Math.round(px * ZOOM)}px`, color: TONE_COLOUR[part.tone] ?? "#f5a623",
      }).setOrigin(0, 0).setScale(1 / ZOOM);
      let line = lines[lines.length - 1]!;
      // A part wider than the row wraps inside itself, on a line of its own.
      if (t.width / ZOOM > width) {
        t.setWordWrapWidth(width * ZOOM);
        if (line.items.length > 0) line = newLine();
        t.setPosition(0, line.y);
        line.items.push(t);
        line.w = t.width / ZOOM;
        line.h = Math.ceil(t.height / ZOOM) + 3;
        box.add(t);
        newLine();
        continue;
      }
      const w = t.width / ZOOM;
      if (line.items.length > 0 && line.w + gap + w > width) line = newLine();
      t.setPosition(line.w + (line.items.length > 0 ? gap : 0), line.y);
      line.w = t.x + w;
      line.items.push(t);
      box.add(t);
    }
    if (align === "center")
      for (const line of lines) for (const t of line.items) t.x -= line.w / 2;
    const used = lines.filter((l) => l.items.length > 0);
    const last = used[used.length - 1];
    return { box, height: last ? last.y + last.h - 3 : 0 };
  }

  /** A line of words and keycaps (`[E] open`); see `ui/keycap.ts`. */
  private keys_(x: number, y: number, str: string, px: number, colour: string, depth = 231, originX = 0.5): Phaser.GameObjects.Container {
    return keyLine(this, x, y, str, { px, colour, zoom: ZOOM, depth, originX });
  }

  private menuText(x: number, y: number, str: string, px: number, color: string): Phaser.GameObjects.Text {
    return this.add.text(x, y, str, {
      fontFamily: "monospace", fontSize: `${Math.round(px * ZOOM)}px`, color, align: "center",
    }).setOrigin(0.5).setScale(1 / ZOOM).setDepth(231);
  }

  private showPause(): void {
    this.pauseUi = { page: "main", selected: 0, objects: [] };
    this.renderPause();
  }

  private hidePause(): void {
    for (const g of this.pauseUi?.objects ?? []) g.destroy();
    this.pauseUi = null;
  }

  /** The rows of the current page: a label and what Enter does. */
  private pauseRows(): { label: string; act: () => void; adjust?: (dir: 1 | -1) => void }[] {
    const ui = this.pauseUi!;
    const step = (key: string, now: number, dir: 1 | -1): number => {
      const i = MULT_STEPS.indexOf(now);
      const next = MULT_STEPS[Math.max(0, Math.min(MULT_STEPS.length - 1, (i < 0 ? MULT_STEPS.indexOf(1) : i) + dir))]!;
      try { localStorage.setItem(key, String(next)); } catch { /* still applies */ }
      return next;
    };
    const setDealt = (dir: 1 | -1) => { this.dealtMult = step(DEALT_KEY, this.dealtMult, dir); this.world.dealtMult = this.dealtMult; };
    const setTaken = (dir: 1 | -1) => { this.takenMult = step(TAKEN_KEY, this.takenMult, dir); this.world.takenMult = this.takenMult; };
    const setShake = (dir: 1 | -1) => {
      const i = SHAKE_SETTINGS.indexOf(this.shakeSetting);
      this.shakeSetting = SHAKE_SETTINGS[(i + dir + SHAKE_SETTINGS.length) % SHAKE_SETTINGS.length]!;
      try { localStorage.setItem(SHAKE_KEY, this.shakeSetting); } catch { /* still applies */ }
    };
    if (ui.page === "settings") return [
      { label: `◂ Damage dealt   x${this.dealtMult} ▸`, act: () => setDealt(this.dealtMult >= MULT_STEPS[MULT_STEPS.length - 1]! ? -1 : 1), adjust: setDealt },
      { label: `◂ Damage taken   x${this.takenMult} ▸`, act: () => setTaken(this.takenMult >= MULT_STEPS[MULT_STEPS.length - 1]! ? -1 : 1), adjust: setTaken },
      { label: `Invincible (testing)   ${this.invincible ? "on" : "off"}`, act: () => {
        this.invincible = !this.invincible;
        this.world.invincible = this.invincible;
        try { localStorage.setItem(INVINCIBLE_KEY, this.invincible ? "1" : "0"); } catch { /* still toggles */ }
      } },
      { label: `Damage numbers   ${this.damageNumbersOn ? "on" : "off"}`, act: () => {
        this.damageNumbersOn = !this.damageNumbersOn;
        if (!this.damageNumbersOn) this.damageNumbers = [];
        try { localStorage.setItem(DAMAGE_NUMBERS_KEY, this.damageNumbersOn ? "1" : "0"); } catch { /* still toggles */ }
      } },
      { label: `Room plan before each room   ${this.showRoomParams ? "on" : "off"}`, act: () => {
        this.showRoomParams = !this.showRoomParams;
        try { localStorage.setItem(ROOM_PARAMS_KEY, this.showRoomParams ? "1" : "0"); } catch { /* still toggles */ }
      } },
      { label: `◂ Screen shake   ${this.shakeSetting} ▸`, act: () => setShake(1), adjust: setShake },
      { label: `Sound   ${this.sfx.isMuted() ? "off" : "on"}`, act: () => {
        this.sfx.setMuted(!this.sfx.isMuted());
        try { localStorage.setItem(MUTE_KEY, this.sfx.isMuted() ? "1" : "0"); } catch { /* still toggles */ }
      } },
      // One language for now; the row is here so the menu has its shape.
      { label: "Language   English  (more to come)", act: () => undefined },
      { label: "Back", act: () => { ui.page = "main"; ui.selected = 2; } },
    ];
    if (ui.page === "controls") return [{ label: "Back", act: () => { ui.page = "main"; ui.selected = 3; } }];
    return [
      { label: "Resume", act: () => this.hidePause() },
      { label: "Character", act: () => { this.hidePause(); this.showStaff("view", null); this.staffFromPause = true; } },
      { label: "Settings", act: () => { ui.page = "settings"; ui.selected = 0; } },
      { label: "Controls", act: () => { ui.page = "controls"; ui.selected = 0; } },
      { label: "Return to title", act: () => { this.hidePause(); this.pendingTitle = true; this.restartRun(); } },
    ];
  }

  private renderPause(): void {
    const ui = this.pauseUi;
    if (!ui) return;
    for (const g of ui.objects) g.destroy();
    ui.objects = [];
    // The room's own frame, not the camera's view: before the first render
    // the view is still empty, and the title is drawn before it.
    const view = new Phaser.Geom.Rectangle(0, 0, VIEW_W, VIEW_H);
    const cx = view.centerX;
    const cy = view.centerY;
    ui.objects.push(this.add.rectangle(cx, cy, view.width, view.height, 0x0d0b1f, 0.8).setDepth(230));
    const title = ui.page === "settings" ? "SETTINGS" : ui.page === "controls" ? "CONTROLS" : "PAUSED";
    ui.objects.push(this.menuText(cx, cy - 78, `—  ${title}  —`, 13, "#ffe9a8"));
    if (ui.page === "controls") {
      const lines = [
        ["W A S D / arrows", "move"], ["J", "attack"], ["U  I  O", "cast a spell (hold to repeat)"],
        ["L", "spin attack (spends a charge)"], ["K", "dodge"], ["E", "use: rewards, portals, vendors, dropped spells"],
        ["X", "dismantle a spell card for gold"], ["Tab", "character"], ["Esc", "pause"], ["M", "mute"],
      ];
      lines.forEach(([k, v], i) => {
        // Each key as a keycap: "W A S D / arrows" becomes four caps and a word.
        const caps = k!.split(/\s+/).map((t) => (t === "/" || t === "arrows" ? ` ${t} ` : `[${t}]`)).join("");
        ui.objects.push(this.keys_(cx - 20, cy - 52 + i * 12, caps, 7, "#8792b5", 231, 1));
        ui.objects.push(this.add.text(cx - 6, cy - 52 + i * 12, v!, { fontFamily: "monospace", fontSize: `${Math.round(8 * ZOOM)}px`, color: "#c9cfe8" }).setOrigin(0, 0.5).setScale(1 / ZOOM).setDepth(231));
      });
    }
    const rows = this.pauseRows();
    const startY = ui.page === "controls" ? cy + 70 : cy - 40;
    rows.forEach((r, i) => {
      const on = i === ui.selected;
      ui.objects.push(this.menuText(cx, startY + i * 17, on && !r.adjust ? `▸ ${r.label} ◂` : r.label, 10, on ? "#ffe9a8" : "#8792b5"));
    });
    // Clear of the action bar along the bottom.
    ui.objects.push(this.keys_(cx, view.bottom - 70, ui.page === "settings"
      ? "[W][S] choose     [A][D] or [Enter] change     [Esc] back" : "[W][S] choose     [Enter] select     [Esc] back", 7, "#8792b5"));
  }

  private readPauseKeys(): void {
    const ui = this.pauseUi;
    if (!ui) return;
    const down = (k?: Phaser.Input.Keyboard.Key) => !!k && Phaser.Input.Keyboard.JustDown(k);
    const rows = this.pauseRows();
    if (down(this.keys.ESC)) {
      if (ui.page === "main") this.hidePause();
      else { ui.page = "main"; ui.selected = 0; this.renderPause(); }
      return;
    }
    let changed = false;
    if (down(this.keys.W) || down(this.keys.UP)) { ui.selected = (ui.selected + rows.length - 1) % rows.length; changed = true; }
    if (down(this.keys.S) || down(this.keys.DOWN)) { ui.selected = (ui.selected + 1) % rows.length; changed = true; }
    const row = rows[ui.selected];
    if (row?.adjust && (down(this.keys.A) || down(this.keys.LEFT))) { row.adjust(-1); changed = true; }
    if (row?.adjust && (down(this.keys.D) || down(this.keys.RIGHT))) { row.adjust(1); changed = true; }
    if (down(this.keys.ENTER) || down(this.keys.J) || down(this.keys.SPACE)) {
      rows[ui.selected]?.act();
      changed = true;
    }
    if (changed && this.pauseUi) this.renderPause();
  }

  /** Turns a world event into a floating number, when numbers are on. */
  private noteDamage(ev: { kind: string; x: number; y: number; what?: string; amount?: number }): void {
    const n = ev.amount ?? 0;
    if (ev.kind === "damage" && n > 0) {
      const colour = damageColour(ev.what ?? "");
      const shatter = (ev.what ?? "").endsWith(":shatter") || (ev.what ?? "").endsWith(":sneak");
      this.damageNumbers.push({ id: this.damageNumberId++, x: ev.x, y: ev.y, text: `${Math.floor(n)}${shatter ? "!" : ""}`, colour, ms: 0, drift: (Math.random() - 0.5) * 10 });
    } else if (ev.kind === "player_hit" && n > 0) {
      this.damageNumbers.push({ id: this.damageNumberId++, x: this.world.player.x, y: this.world.player.y - 24, text: `-${Math.round(n * HP_PER_HEART)}`, colour: "#ff6a5a", ms: 0, drift: 0 });
    }
    if (this.damageNumbers.length > 40) this.damageNumbers.splice(0, this.damageNumbers.length - 40);
  }

  /** Ice shards from a shatter: pale slivers flung outward, spinning, gone in half a second. */
  private drawShards(dtMs: number): void {
    for (const sh of this.shards) {
      sh.ms += dtMs;
      const t = sh.ms / 500;
      const d = 6 + 34 * Math.sqrt(t);
      this.sprites.add(this.add.rectangle(sh.x + Math.cos(sh.a) * d, sh.y + Math.sin(sh.a) * d, 5, 2, 0xe8fbff, 1 - t)
        .setRotation(sh.a + t * 6).setStrokeStyle(0.6, 0x6fa8d8, 1 - t).setDepth(9.8));
    }
    this.shards = this.shards.filter((sh) => sh.ms < 500);
  }

  /** A kept text for this frame, by key; see `textCache`. */
  private ftext(key: string, x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    const sig = JSON.stringify(style);
    let c = this.textCache.get(key);
    if (!c || c.style !== sig) {
      c?.t.destroy();
      c = { t: this.add.text(x, y, text, style), used: true, style: sig, idle: 0 };
      this.textCache.set(key, c);
    } else if (c.t.text !== text) c.t.setText(text);
    c.used = true;
    c.idle = 0;
    return c.t.setPosition(x, y).setVisible(true).setAlpha(1).setRotation(0);
  }

  /** Hides the kept texts this frame did not ask for, and forgets the ones gone a while. */
  /**
   * The warden's fire-shot. While the gun is raised, the ground its flame
   * will cover is drawn — ray by ray, cut short where a wall stops it —
   * filling in as the shot nears; the answer is outside that shape. When it
   * fires, dragon's breath: a burning pellet out along every ray with a
   * streak behind it, thrown tongues of flame under them, a flash at the
   * muzzle and then smoke. Nothing lands on the floor.
   */
  private drawMuzzles(): void {
    const w = this.world;
    const g = this.threatGfx;
    const half = (MUSKET_SPREAD_DEG / 2) * Math.PI / 180;
    const angleOf = (aim: number, i: number, n: number) => aim - half + (2 * half * i) / (n - 1);
    for (const e of w.enemies) {
      if (e.archetype !== "warden" || e.pose !== "musket_windup" || e.hp <= 0) continue;
      const t = 1 - e.poseMs / MUSKET_WINDUP_MS;
      const m = muzzleOf(w, e, e.facing);
      const rays = flameRays(w, m.x, m.y, e.facing);
      const pts = [{ x: m.x, y: m.y }, ...rays.map((r, i) => {
        const a = angleOf(e.facing, i, rays.length);
        return { x: m.x + Math.cos(a) * r, y: m.y + Math.sin(a) * r };
      })];
      g.fillStyle(0xff5544, 0.06 + 0.22 * t);
      g.fillPoints(pts, true);
      g.lineStyle(1.5, 0xff8877, 0.35 + 0.5 * t);
      g.strokePoints(pts.slice(1), false);
    }
    const f = this.bladeGfx;
    for (const fl of w.flames) {
      const n = fl.rays.length;
      const reachAt = (off: number) => {
        const t = ((off + half) / (2 * half)) * (n - 1);
        const i = Math.max(0, Math.min(n - 2, Math.floor(t)));
        const k = Math.max(0, Math.min(1, t - i));
        return fl.rays[i]! * (1 - k) + fl.rays[i + 1]! * k;
      };
      const age = fl.ms / FLAME_LIFE_MS;
      // The bang: a white bloom over the muzzle, a ring thrown off it, and
      // the floor lit for a moment.
      if (fl.ms < 160) {
        const k = 1 - fl.ms / 160;
        this.hazardGfx.fillStyle(0xffe6a0, 0.26 * k);
        this.hazardGfx.fillCircle(fl.x + Math.cos(fl.aim) * 22, fl.y + 4 + Math.sin(fl.aim) * 22, 28 * (1.1 - 0.4 * k));
        f.lineStyle(2.5 * k + 0.5, 0xfff2c0, 0.9 * k);
        f.strokeCircle(fl.x, fl.y, 6 + 30 * (1 - k));
      }
      if (fl.ms < 90) {
        const k = 1 - fl.ms / 90;
        f.fillStyle(0xffcd50, 0.95);
        f.fillCircle(fl.x, fl.y, 4 + 7 * k);
        f.fillStyle(0xffffff, 1);
        f.fillCircle(fl.x, fl.y, 2 + 5 * k);
      }
      /*
       * The blast itself is the baked sheet (`fx/sheets.ts`, after Metal
       * Slug's shotgun), stepped on its own schedule, and masked to the shape
       * the sim cut at walls so no grain shows through stone.
       */
      const fi = BLAST_FRAME_MS.findIndex((t) => fl.ms < t);
      if (fi >= 0 && this.fxSheets.has("blast")) {
        let mask = this.blastMasks.get(fl);
        if (!mask) {
          mask = this.make.graphics({}, false);
          this.blastMasks.set(fl, mask);
        }
        mask.clear();
        mask.fillStyle(0xffffff, 1);
        const pts = [{ x: fl.x, y: fl.y }];
        for (let i = 0; i <= 12; i++) {
          const off = -half * 1.1 + (2.2 * half * i) / 12;
          const r = reachAt(Math.max(-half, Math.min(half, off))) + 10;
          pts.push({ x: fl.x + Math.cos(fl.aim + off) * r, y: fl.y + Math.sin(fl.aim + off) * r });
        }
        mask.fillPoints(pts, true);
        const o = this.fxSheets.get("blast")!.origins[fi]!;
        const im = this.add.image(fl.x, fl.y, FX_TEXTURE, `blast_${fi}`)
          .setOrigin(o[0], o[1]).setRotation(fl.aim).setScale(0.5).setDepth(8.7);
        im.setMask(mask.createGeometryMask());
        this.sprites.add(im);
      }
    }
    for (const [fl, g] of this.blastMasks) if (!fl.alive || !w.flames.includes(fl)) { g.destroy(); this.blastMasks.delete(fl); }
    // Smoke off the muzzle after the shot, rolling along the aim and rising.
    const dt = this.game.loop.delta;
    for (const m of this.muzzleFx) {
      m.ms += dt;
      if (m.ms < 80) continue;
      const k = Math.min(1, (m.ms - 80) / 900);
      const ca = Math.cos(m.a);
      const sa = Math.sin(m.a);
      f.fillStyle(0x96929f, 0.45 * (1 - k));
      for (let i = 0; i < 4; i++) {
        const d = 4 + i * 4 + k * (8 + i * 3);
        f.fillCircle(m.x + ca * d, m.y + sa * d - k * (8 + i * 3), 2.5 + i * 0.8 + k * 4);
      }
    }
    this.muzzleFx = this.muzzleFx.filter((m) => m.ms < 980);
  }

  /**
   * The cast, at the hand: a small flash along the newest shot, in its
   * element's colour, and for a dear spell the body kicked back a pixel or
   * two. Read off the sim's bullets, because a cast is a state change there.
   */
  private castFlash(): void {
    const p = this.world.player;
    let best: (typeof this.world.playerBullets)[number] | null = null;
    let bestD = Infinity;
    for (const b of this.world.playerBullets) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best || bestD > 40) return;
    const a = Math.atan2(best.vy, best.vx);
    const tint = ELEMENT_TINT[best.element ?? "none"] ?? ELEMENT_TINT.none;
    this.playFx("muzzle_s", p.x + Math.cos(a) * 8, p.y - BODY_LIFT + Math.sin(a) * 6, a, 35, 9.1, tint.glow);
    if (best.damage >= 12) this.recoil = { a, ms: 90 };
  }

  /** Starts a baked effect at a point, turned to `rot`, stepping every `frameMs`. */
  private playFx(sheet: string, x: number, y: number, rot: number, frameMs: number, depth = 8.9, tint?: number): void {
    if (!this.fxSheets.has(sheet)) return;
    this.fxAnims.push({ sheet, x, y, rot, ms: 0, frameMs, depth, ...(tint !== undefined ? { tint } : {}) });
    // A budget, so a room at the bullet cap cannot pile up effects.
    if (this.fxAnims.length > 90) this.fxAnims.splice(0, this.fxAnims.length - 90);
  }

  private drawFxAnims(dtMs: number): void {
    for (const a of this.fxAnims) {
      a.ms += dtMs;
      const info = this.fxSheets.get(a.sheet)!;
      const i = Math.floor(a.ms / a.frameMs);
      if (i >= info.frames) continue;
      const o = info.origins[i]!;
      const im = this.add.image(a.x, a.y, FX_TEXTURE, `${a.sheet}_${i}`)
        .setOrigin(o[0], o[1]).setRotation(a.rot).setScale(0.5).setDepth(a.depth);
      if (a.tint !== undefined) im.setTint(a.tint);
      this.sprites.add(im);
    }
    this.fxAnims = this.fxAnims.filter((a) => a.ms < this.fxSheets.get(a.sheet)!.frames * a.frameMs);
  }

  /** Marks a lesson due at a place, once per session; `drawLessons` shows it. */
  private teach(key: string, x: number, y: number): void {
    if (this.taught.has(key)) return;
    const at = this.teachAt.get(key);
    if (at) { at.x = x; at.y = y; return; }
    this.teachAt.set(key, { x, y, ms: TEACH_MS });
  }

  /** Draws the lessons that are due, fading out; each is marked taught when it ends. */
  private drawLessons(dtMs: number): void {
    for (const [key, at] of this.teachAt) {
      if (this.taught.has(key) && at.ms > 400) at.ms = 400;
      at.ms -= dtMs;
      if (at.ms <= 0) { this.teachAt.delete(key); this.taught.add(key); continue; }
      const a = Math.min(1, at.ms / 400, (TEACH_MS - at.ms) / 200 + 0.001);
      this.ftext(`teach:${key}`, at.x, at.y, LESSONS[key] ?? key, {
        fontFamily: "monospace", fontSize: `${Math.round(8 * ZOOM)}px`, color: "#fff6d8",
        stroke: "#1a1422", strokeThickness: 2 * ZOOM,
      }).setScale(1 / ZOOM).setOrigin(0.5).setDepth(9.95).setAlpha(a);
    }
  }

  private sweepTexts(): void {
    for (const [key, c] of this.textCache) {
      if (c.used) { c.used = false; continue; }
      // A damage number is done for good; anything else unused for two seconds is let go.
      if (key.startsWith("dmg:") || ++c.idle > 120) { c.t.destroy(); this.textCache.delete(key); continue; }
      c.t.setVisible(false);
    }
  }

  /** Draws and ages the floating numbers: a short rise, then a fade. */
  private drawDamageNumbers(dtMs: number): void {
    const LIFE = 700;
    for (const d of this.damageNumbers) {
      d.ms += dtMs;
      const t = d.ms / LIFE;
      this.ftext(`dmg:${d.id}`, d.x + d.drift * t, d.y - 14 * Math.sqrt(t), d.text, {
        fontFamily: "monospace", fontSize: `${Math.round(8 * ZOOM)}px`, color: d.colour,
        stroke: "#0d0b1f", strokeThickness: 2 * ZOOM,
      }).setScale((1 / ZOOM) * (t < 0.12 ? 1.3 - t * 2.5 : 1)).setOrigin(0.5).setAlpha(t > 0.6 ? (1 - t) / 0.4 : 1).setDepth(9.9);
    }
    this.damageNumbers = this.damageNumbers.filter((d) => d.ms < LIFE);
  }

  /** The floor cell nearest a point, in grid coordinates. */
  /** Where the vendors stand: the pre-boss stop has both, a vendor's room mid-run one. */
  private vendorSpots(): { kind: "merchant" | "smith"; gx: number; gy: number }[] {
    const vendors = this.npcRoom
      ? [[this.npcRoom, 0] as const]
      : [["merchant", -3], ["smith", 3]] as const;
    return vendors.map(([kind, dx]) => {
      const gx = Math.floor(GRID_W / 2 + dx);
      const gy = Math.floor(GRID_H / 2 - 1);
      return { kind, gx, gy };
    });
  }

  /**
   * Clears the ground round each vendor and in front of it: walls, pillars
   * and anything breakable. A merchant behind a crate is a merchant the player
   * has to smash their way to, and a pillar in front of one hid it entirely.
   * The cell it stands on and the three rows toward the entry are cleared,
   * with a tile either side.
   */
  private clearVendorGround(): void {
    const w = this.world;
    const grid = w.room.grid;
    const clear = (gx: number, gy: number): boolean =>
      gx >= 1 && gy >= 1 && gx < GRID_W - 1 && gy < GRID_H - 1;
    for (const { gx, gy } of this.vendorSpots()) {
      for (let y = gy - 1; y <= gy + 3; y++)
        for (let x = gx - 1; x <= gx + 1; x++)
          if (clear(x, y) && grid[y * GRID_W + x] !== Tile.Door) grid[y * GRID_W + x] = Tile.Floor;
      w.props = w.props.filter((p) => {
        const near = Math.abs(p.gx - gx) <= 2 && p.gy >= gy - 2 && p.gy <= gy + 4;
        if (near) grid[p.gy * GRID_W + p.gx] = Tile.Floor;
        return !near;
      });
    }
    w.flow = null;
    w.flowTile = null;
  }

  private floorNear(x: number, y: number): [number, number] {
    const grid = this.world.room.grid;
    const tx = Math.max(1, Math.min(GRID_W - 2, Math.floor(x / TILE_PX)));
    const ty = Math.max(1, Math.min(GRID_H - 2, Math.floor(y / TILE_PX)));
    for (let r = 0; r < GRID_W; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const gx = tx + dx;
          const gy = ty + dy;
          if (gx >= 1 && gy >= 1 && gx < GRID_W - 1 && gy < GRID_H - 1 && grid[gy * GRID_W + gx] === Tile.Floor) return [gx, gy];
        }
    return [tx, ty];
  }

  /** Gold the player holds right now: the run's, and what this room has paid so far. */
  private goldHeld(): number {
    return this.runGold + this.world.gold;
  }

  /** Lays a spell taken off a key on the floor, as it was: its level and its affixes. */
  private dropFloorSpell(itemId: string, value: number, level = 1, affixes: readonly AttachedAffix[] = []): void {
    const p = this.world.player;
    const [gx, gy] = this.floorNear(p.x + 20, p.y);
    const x = (gx + 0.5) * TILE_PX;
    const y = (gy + 0.5) * TILE_PX;
    const glow = this.add.circle(x, y, 9, 0x8fdcff, 0.18).setDepth(4.2).setBlendMode(Phaser.BlendModes.ADD);
    const icon = `icon_${itemId}`;
    const img = this.atlas.has(icon)
      ? this.add.image(x, y, this.crispTextureKey, icon).setOrigin(0.5).setScale(1).setDepth(4.4)
      : null;
    this.floorSpells.push({ x, y, itemId, level, affixes: [...affixes], label: titleOfId(itemId), value, img, glow });
  }

  private removeFloorSpell(f: FloorSpell): void {
    f.img?.destroy();
    f.glow.destroy();
    this.floorSpells = this.floorSpells.filter((x) => x !== f);
  }

  /** "Lv 1 → 2" on a spell card the player already holds, since taking it levels that spell. */
  private upgradeNote(card: OfferCard): string {
    if (card.kind !== "spell" || !card.itemId || !this.world) return "";
    const at = this.heldIndex(card.itemId);
    if (at < 0) return "";
    const level = this.spellLevels[at] ?? 1;
    return level >= SPELL_LEVEL_MAX ? `held at Lv ${level}  ` : `upgrade Lv ${level} → ${Math.min(SPELL_LEVEL_MAX, level + (card.grade ?? 1))}  `;
  }

  /** Which key holds this spell, or -1. */
  private heldIndex(itemId: string): number {
    return this.world.spells.findIndex((x) => x?.item.base === itemId);
  }

  /**
   * **A second copy of a held spell raises the held one's level** by the
   * copy's level, to the cap, keeping its affixes — the way a duplicate affix
   * adds its tier. Returns false when the held one is already at the cap.
   */
  private upgradeHeld(i: number, by: number): boolean {
    const slot = this.world.spells[i];
    const level = this.spellLevels[i] ?? 1;
    if (!slot || level >= SPELL_LEVEL_MAX) return false;
    const next = Math.min(SPELL_LEVEL_MAX, level + Math.max(1, by));
    this.spellLevels[i] = next;
    this.world.spells[i] = withLevel(slot, next);
    this.tookLabel = `${titleOfId(slot.item.base)} to Lv ${next}`;
    this.tookMs = 1800;
    this.levelUpFx(`${titleOfId(slot.item.base)}  Lv ${level} → ${next}`, SPELL_KEYS[i] ?? "");
    return true;
  }

  /** Whether a card is a copy of a spell already on a key, which levels it up. */
  private isUpgradeCard(card: OfferCard): boolean {
    return card.kind === "spell" && !!card.itemId && !!this.world && this.heldIndex(card.itemId) >= 0;
  }

  /**
   * A level gained is announced: a gold burst round the player and a banner
   * over the room naming the spell and its key. Without it an upgrade looked
   * like a card that did nothing.
   */
  private levelUpFx(text: string, key: string): void {
    const p = this.world.player;
    this.ring(p.x, p.y - BODY_LIFT, 6, 34, 0xffd45e, 420, 3);
    this.ring(p.x, p.y - BODY_LIFT, 3, 20, 0xffffff, 260, 2);
    this.burst(p.x, p.y - BODY_LIFT, 0xffd45e, 16, 200, -Math.PI / 2, Math.PI * 1.6, 1.2, -40);
    const banner = this.add.text(VIEW_W / 2, VIEW_H * 0.3, `LEVEL UP   ${text}${key ? `   [${key}]` : ""}`, {
      fontFamily: "monospace", fontSize: `${Math.round(11 * ZOOM)}px`, color: "#ffd45e",
      backgroundColor: "#0d0b1fcc", padding: { x: 8 * ZOOM, y: 4 * ZOOM },
    }).setOrigin(0.5).setScale(1 / ZOOM).setDepth(215).setScrollFactor(0);
    this.tweens.add({
      targets: banner, y: VIEW_H * 0.3 - 12, alpha: 0, delay: 1100, duration: 500,
      onComplete: () => banner.destroy(),
    });
    this.sfx.play("pickup");
  }

  /** Puts a spell on key `i` at a level, with affixes carried over. */
  private equipAt(i: number, itemId: string, level: number, affixes: readonly AttachedAffix[]): boolean {
    const fitted = equipItem(this.world, itemId, `${itemId}-${this.roomIndex}-${this.world.tick}`, ITEMS, i);
    if (!fitted) return false;
    this.slots = [...this.world.slots];
    let slot = this.world.spells[i];
    if (slot) {
      for (const a of affixes) slot = attachAffix(slot, a.id, a.tier) ?? slot;
      this.world.spells[i] = withLevel(slot, level);
    }
    this.spellAffixes[i] = [...affixes];
    this.spellLevels[i] = level;
    this.owned.push(itemId);
    return true;
  }

  /**
   * A tap on a floor spell: the same spell held is levelled up by it; a free
   * key takes it; otherwise the replace step asks which key it goes on, and
   * the spell that comes off drops where this one lay.
   */
  private pickFloorSpell(f: FloorSpell): void {
    const held = this.heldIndex(f.itemId);
    if (held >= 0) {
      if (!this.upgradeHeld(held, f.level)) {
        this.tookLabel = `${f.label} is already Lv ${SPELL_LEVEL_MAX}: hold E to dismantle`;
        this.tookMs = 1600;
        this.sfx.play("hurt");
        return;
      }
      this.removeFloorSpell(f);
      this.sfx.play("pickup");
      return;
    }
    const free = this.world.spells.findIndex((x) => x === null);
    if (free >= 0) {
      if (this.equipAt(free, f.itemId, f.level, f.affixes)) {
        this.removeFloorSpell(f);
        this.tookLabel = `${f.label} on ${SPELL_KEYS[free]}`;
        this.tookMs = 1600;
        this.sfx.play("pickup");
      }
      return;
    }
    const card = cardsFor(ITEMS, "spell", [f.itemId], { grade: f.level })[0];
    if (!card) return;
    this.floorPending = f;
    this.showStaff("replace", card);
  }

  /**
   * The sheet with no mood applied, for anything that is not *in* the room.
   *
   * The mood transform tints the whole sheet so a cold room reads cold — which
   * is right for stone, bodies and hazards, and wrong for a reward: a dropped
   * heart came out **purple** in a cold room, which reads as a different item
   * rather than as the same item in bluer light. Rewards and HUD pieces are
   * promises to the player and have to mean one thing everywhere.
   */
  private uiTextureKey = "sheet_plain";

  private applyMood(mood: Mood): void {
    this.ensurePlainSheet();
    this.ensureCrispSheet();
    const key = `sheet_${mood.temperature}_${mood.brightness}`;
    this.textureKey = key;
    if (this.textures.exists(key)) return;
    const { data } = this.atlas.forMood(mood);
    const w = this.atlas.sheetWidth;
    const h = data.length / 4 / w;
    const tex = this.textures.createCanvas(key, w, h)!;
    const img = tex.context.createImageData(w, h);
    img.data.set(data);
    tex.context.putImageData(img, 0, 0);
    tex.refresh();
    // The delivered sheet is pixel art. Linear sampling both softens it and,
    // on a fractional presentation scale, can turn a single transparent row
    // into a visible line across a moving body.
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (const name of this.atlas.frameNames) {
      const r = this.atlas.frame(name);
      tex.add(name, 0, r.x, r.y, r.w, r.h);
    }
    // Phaser sizes the mood transform once; the scene never tints per sprite.
    void moodTransform(mood);
  }

  /**
   * The 16 px icons come from a **nearest-filtered** copy of the plain sheet.
   *
   * The icons are pixel art at 16 x 16 and were drawn from the same linearly
   * filtered texture as the smooth 64 px sprites, then stretched to 34 px on
   * the cards by `setDisplaySize` — a 2.125x bilinear blow-up of a 16 px
   * drawing, which is a blur with a shape in it. Filtering is per texture in
   * Phaser, so the icons get their own copy of the sheet with the filter the
   * art was drawn for, and are placed at whole multiples of their size.
   */
  private crispTextureKey = "sheet_crisp";

  private ensureCrispSheet(): void {
    if (this.textures.exists(this.crispTextureKey)) return;
    const w = this.atlas.sheetWidth;
    const h = this.atlas.base.length / 4 / w;
    const tex = this.textures.createCanvas(this.crispTextureKey, w, h)!;
    const img = tex.context.createImageData(w, h);
    img.data.set(this.atlas.base);
    tex.context.putImageData(img, 0, 0);
    tex.refresh();
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (const name of this.atlas.frameNames) {
      const r = this.atlas.frame(name);
      tex.add(name, 0, r.x, r.y, r.w, r.h);
    }
  }

  /** Registers the untinted sheet once. See `uiTextureKey`. */
  private ensurePlainSheet(): void {
    if (this.textures.exists(this.uiTextureKey)) return;
    const w = this.atlas.sheetWidth;
    // A copy, because the base is shared with the mood transform.
    const data = Uint8Array.from(this.atlas.base);
    const h = data.length / 4 / w;
    const tex = this.textures.createCanvas(this.uiTextureKey, w, h)!;
    const img = tex.context.createImageData(w, h);
    img.data.set(data);
    tex.context.putImageData(img, 0, 0);
    tex.refresh();
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (const name of this.atlas.frameNames) {
      const r = this.atlas.frame(name);
      tex.add(name, 0, r.x, r.y, r.w, r.h);
    }
  }

  private drawTiles(): void {
    this.tiles.clear(true, true);
    this.featureLights = [];
    this.pillarTops = [];
    const grid = this.world.room.grid;
    const drains = drainCells(grid);
    for (let y = 0; y < GRID_H; y++)
      for (let x = 0; x < GRID_W; x++) {
        const t = grid[y * GRID_W + x];
        /*
         * A destructible's cell draws as **floor**.
         *
         * It is solid, so it is `Tile.Prop` in the grid, and that sent it down
         * the wall branch — where the autotiler saw an isolated solid cell and
         * drew a single wall stub. The result was a pale block sitting in the
         * middle of the room with no relation to anything, which is what a
         * destructible looked like before this: architecture, briefly, and then
         * a flash when hit. The pot itself is a sprite drawn on top; see
         * `drawProps`.
         */
        /*
         * A lone pillar cell is a **column standing on floor**, not a wall.
         *
         * Drawn through the autotiler it was a one-tile wall open on every
         * side, and with the thin-wall wash on top it was a pale glowing
         * square — the reader's word for it was "not a pillar at all". The
         * floor is drawn under it and `prop_pillar` stands on it with a
         * shadow, like the other standing objects; the column art itself is
         * on the work order, because the delivered frame reads as a lump.
         * Pillar blocks of more than one cell keep the wall face: they are
         * masonry, and read as it.
         */
        const lonePillar = t === Tile.Pillar && isolatedSolid(grid, x, y);
        const name = t === Tile.Floor || t === Tile.Prop || lonePillar
          ? floorFrame(x, y, drains)
          : wallFrame(grid, x, y);
        this.tiles.add(
          this.add.image(x * TILE_PX, y * TILE_PX, this.textureKey, name)
            .setOrigin(0).setScale(1 / ART_SCALE).setDepth(0),
        );
        if (lonePillar) {
          const cx = x * TILE_PX + TILE_PX / 2;
          const cy = y * TILE_PX + TILE_PX / 2;
          this.tiles.add(this.add.ellipse(cx, cy + 9, 22, 8, 0x0d0b1f, 0.35).setDepth(3));
          /*
           * **Two pieces.** The column is two tiles tall on a one-tile
           * footing, so its upper half stands over the floor cell behind it.
           * Drawn as one image under the bodies, a player walking behind the
           * column was drawn in front of its shaft and read as standing on
           * top of it. The footing stays under the bodies; the upper half is
           * drawn over them, and turns see-through while a body is behind it
           * so nobody is lost there.
           */
          const pillarFrame = safeFrame(this.atlas, "prop_pillar_0", "prop_break_crate_0");
          const frameH = this.atlas.has(pillarFrame) ? this.atlas.frame(pillarFrame).h : TILE_PX * ART_SCALE;
          const cut = Math.max(0, frameH - TILE_PX * ART_SCALE);
          const base = this.add.image(cx, cy + TILE_PX / 2, this.textureKey, pillarFrame)
            .setOrigin(0.5, 1).setScale(1 / ART_SCALE).setDepth(5);
          this.tiles.add(base);
          if (cut > 0) {
            base.setCrop(0, cut, base.frame.width, base.frame.height - cut);
            const top = this.add.image(cx, cy + TILE_PX / 2, this.textureKey, pillarFrame)
              .setOrigin(0.5, 1).setScale(1 / ART_SCALE).setDepth(8.3);
            top.setCrop(0, 0, top.frame.width, cut);
            this.tiles.add(top);
            this.pillarTops.push({ img: top, x: cx, y: cy - TILE_PX, h: cut / ART_SCALE });
          }
        }
        /*
         * A wall open on two opposite sides is a **thin wall**, and the frame
         * for it is a dark brick face between two light caps — which, drawn
         * between two floors, reads as a passage in shadow rather than a wall.
         * A pale additive wash over the face lifts it toward the caps, so the
         * strip reads as a raised ridge the player cannot enter.
         */
        if (t !== Tile.Floor && t !== Tile.Prop && !lonePillar && thinWall(grid, x, y)) {
          this.tiles.add(
            this.add.rectangle(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX, 0x6f86c8, 0.28)
              .setOrigin(0).setDepth(0.5).setBlendMode(Phaser.BlendModes.ADD),
          );
        }
        /*
         * A `Tile.Door` is drawn as plain wall and carries no badge.
         *
         * It briefly carried one, from `roomIndex * 3 + side` — a number with
         * no relationship to what was behind the door, so the game's central
         * promise was illustrated with **fabricated data**. By Sid Meier's
         * taxonomy an unlabelled door is a blind choice and a mislabelled one
         * is worse than blind.
         *
         * The exit is now a portal standing on open floor, which is where the
         * badge belongs and where it can be read from the middle of the room.
         * The tile stays in the grid as a solid wall until the grid-level
         * removal doc 003 asks for; nothing walks through it.
         */
      }
    /*
     * Scenery: bones, cracks, moss, rubble, stains and drains.
     *
     * Eleven drawings delivered and none of them placed, so every room was
     * bare paving with hazards on it. They are placed from a hash of the cell
     * rather than from the room's RNG, so the same room always looks the same
     * and the decoration does not consume the sequence the encounter depends
     * on — and sparsely, because a decal has to be ignorable at a glance.
     */
    const DECO = [
      "deco_bones", "deco_crack_0", "deco_crack_1", "deco_moss_0", "deco_moss_1",
      "deco_rubble_0", "deco_rubble_1", "deco_stain_0", "deco_stain_1",
      "deco_drain_0", "deco_drain_1",
    ];
    for (let y = 1; y < GRID_H - 1; y++)
      for (let x = 1; x < GRID_W - 1; x++) {
        if (grid[y * GRID_W + x] !== Tile.Floor) continue;
        const h = hash2(x, y);
        // About one floor tile in nine, so the floor reads as worn rather
        // than as patterned.
        if (h % 9 !== 0) continue;
        const name = DECO[(h >>> 4) % DECO.length]!;
        if (!this.atlas.has(name)) continue;
        this.tiles.add(
          this.add.image(
            x * TILE_PX + TILE_PX / 2, y * TILE_PX + TILE_PX / 2, this.textureKey, name,
          ).setOrigin(0.5).setScale(1 / ART_SCALE).setDepth(1).setAlpha(0.75)
            .setFlipX(((h >>> 8) & 1) === 1),
        );
      }

    for (const zone of this.world.room.zones) {
      if (zone.feature === "none") continue;
      const art = featureArt(zone.feature);
      // Mirror pillars and braziers are props now — solid, in `world.props`,
      // drawn by `drawProps` — so the zone draws nothing for them.
      if (art.fixture) continue;
      /*
       * One object for the zone, not one per cell.
       *
       * A 3 x 3 mana font was nine wells and a 5 x 3 turret mount was fifteen
       * columns, because the loop stamped the feature's art on every cell it
       * covered. A font is one well with an area of effect round it, and a
       * turret mount is where turrets stand — the turrets are its picture, and
       * a column under each would be a column the sword could not reach past.
       */
      if (art.hidden) continue;
      for (const [cx, cy] of zone.cells) {
        if (art.standing) {
          /*
           * An object on the floor, not a texture in it: centred on the tile,
           * above the ground layer and below the bodies, and remembered so the
           * animated ones can be flickered.
           */
          const img = this.add.image(
            cx * TILE_PX + TILE_PX / 2, cy * TILE_PX + TILE_PX / 2,
            this.textureKey, safeFrame(this.atlas, art.frame, "prop_pillar_0"),
          ).setOrigin(0.5).setScale(1 / ART_SCALE).setDepth(2);
          this.tiles.add(img);
          if (art.pair) this.featureLights.push({ img, a: art.frame, b: art.pair, cycles: art.cycles === true });
        } else if (art.slab && this.atlas.has(art.frame)) {
          const has = (x: number, y: number) => zone.cells.some(([zx, zy]) => zx === x && zy === y);
          for (let q = 0; q < 4; q++) {
            const east = q & 1;
            const south = q >> 1;
            // Joined to a neighbour on this quarter's side: take the frame's
            // middle column or row, so no rim is drawn across the join.
            const col = has(cx + (east ? 1 : -1), cy) ? 1 : east ? 2 : 0;
            const row = has(cx, cy + (south ? 1 : -1)) ? 1 : south ? 2 : 0;
            const a = this.slabFrame(art.frame, col, row);
            const b = art.pair ? this.slabFrame(art.pair, col, row) : a;
            const img = this.add.image(
              cx * TILE_PX + (east * TILE_PX) / 2, cy * TILE_PX + (south * TILE_PX) / 2,
              this.textureKey, a,
            ).setOrigin(0).setScale(1 / ART_SCALE).setDepth(1).setAlpha(0.9);
            this.tiles.add(img);
            if (art.pair) this.featureLights.push({ img, a, b, cycles: art.cycles === true });
          }
        } else {
          const img = this.add.image(cx * TILE_PX, cy * TILE_PX, this.textureKey,
            safeFrame(this.atlas, art.frame, "hazard_crumble_0"))
            .setOrigin(0).setScale(1 / ART_SCALE).setDepth(1).setAlpha(0.9);
          this.tiles.add(img);
          if (art.pair) this.featureLights.push({ img, a: art.frame, b: art.pair, cycles: art.cycles === true });
        }
      }
    }
  }

  /**
   * A quarter-tile cut from a framed plate, registered on the current sheet.
   *
   * `col` and `row` are 0, 1 or 2: the plate's left/top edge, its middle, or
   * its right/bottom edge. The three cuts overlap — 0 starts at the frame's
   * origin, 1 a quarter in, 2 halfway — so the middle cut is the plate's
   * interior and the edge cuts keep the rim. Registered lazily, per mood sheet,
   * because each mood is its own canvas texture.
   */
  private slabFrame(frame: string, col: number, row: number): string {
    const name = `${frame}@${col}${row}`;
    const tex = this.textures.get(this.textureKey);
    if (!tex.has(name)) {
      const r = this.atlas.frame(frame);
      tex.add(name, 0, r.x + (col * r.w) / 4, r.y + (row * r.h) / 4, r.w / 2, r.h / 2);
    }
    return name;
  }

  /**
   * The elemental gauges over the player's head, and the status once one fills.
   *
   * A gauge is drawn only while it has something in it, so a player who
   * crosses a pool sees a bar rise and fall and nothing more. Burning is
   * tongues of flame off the shoulders; poison is bubbles rising. Both are
   * drawn, not sprited, because they have to sit on whatever pose the body is
   * in and last exactly as long as the status does.
   */
  private drawPlayerStatus(): void {
    const w = this.world;
    const p = w.player;
    const g = this.fxTopGfx;
    const top = p.y - BODY_LIFT - 22;
    const gauges: [number, number, number][] = [];
    // Building: the gauge fills. Burning: it is the status's clock and drains.
    if (p.burnBuild > 0 || p.burnMs > 0) gauges.push([p.burnBuild, p.burnMs > 0 ? 0xffb050 : 0xc0602a, 0]);
    if (p.poisonBuild > 0 || p.poisonMs > 0) gauges.push([p.poisonBuild, p.poisonMs > 0 ? 0x9ff07a : 0x4f9a40, 1]);
    gauges.forEach(([fill, colour], i) => {
      const y = top - i * 4;
      this.sprites.add(this.add.rectangle(p.x, y, 20, 2.4, 0x0d0b1f, 0.8).setOrigin(0.5).setDepth(9.7));
      this.sprites.add(this.add.rectangle(p.x - 10, y, 20 * fill, 2.4, colour, 1).setOrigin(0, 0.5).setDepth(9.8));
    });
    /*
     * Spin charges, over the head: one pip per banked spin. The gauge in the
     * status bar is the detail (how close the next one is); this is the one
     * number the player needs mid-fight, where their eyes are.
     */
    const charges = Math.floor(p.rage);
    const pipY = top - gauges.length * 4 - 3;
    for (let i = 0; i < charges; i++) {
      const x = p.x + (i - (charges - 1) / 2) * 6;
      this.sprites.add(this.add.rectangle(x, pipY, 3.4, 3.4, 0xff7a4a, 1).setAngle(45)
        .setStrokeStyle(0.8, 0xffe0c0, 0.9).setDepth(9.8));
    }
    // A burning player's flames are `FireFx`'s.
    if (p.poisonMs > 0) {
      for (let i = 0; i < 3; i++) {
        const u = ((w.tick / 40) + i / 3) % 1;
        g.fillStyle(0x8fe08f, 0.7 * (1 - u));
        g.fillCircle(p.x - 6 + i * 6 + Math.sin(w.tick / 8 + i) * 1.5, p.y - 6 - u * 16, 1.4 + (1 - u));
      }
    }
  }

  /**
   * A vortex: three additive arcs turning inward, and motes falling to the
   * centre. The turn is the tell — a still spiral is a decal.
   */
  private drawVortices(): void {
    const w = this.world;
    const g = this.fxGfx;
    for (const v of w.vortices) {
      if (!v.alive) continue;
      const life = Math.min(1, v.lifeMs / 400) * Math.min(1, (v.maxLifeMs - v.lifeMs) / 200);
      const spin = w.tick / 9;
      g.fillStyle(0x7a4fd6, 0.12 * life);
      g.fillCircle(v.x, v.y, v.radius);
      for (let k = 0; k < 3; k++) {
        const a0 = spin + (k / 3) * Math.PI * 2;
        for (let i = 0; i < 8; i++) {
          const t = i / 8;
          const r = v.radius * (1 - t * 0.85);
          const a = a0 + t * 2.2;
          g.fillStyle(i % 2 ? 0xd9c6ff : 0x9a7bff, (0.55 - t * 0.4) * life);
          g.fillCircle(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r, 2.6 - t * 1.6);
        }
      }
      g.fillStyle(0xffffff, 0.8 * life);
      g.fillCircle(v.x, v.y, 3 + Math.sin(w.tick / 4) * 0.8);
    }
  }

  /** The companion: the pet frames at its facing, with a shadow and a flicker as it runs out. */
  private drawPets(): void {
    const w = this.world;
    for (const pet of w.pets) {
      if (!pet.alive) continue;
      const moving = Math.hypot(pet.vx, pet.vy) > 8;
      const pose = pet.attackMs > 0 ? "attack" : moving ? `walk${(w.tick >> 3) & 3}` : `idle${(w.tick >> 4) & 1}`;
      const f = facingFrame("pet", (pet.facing * 180) / Math.PI, pose);
      const name = this.atlas.has(f.name) ? f.name : "pet_s_idle0";
      if (!this.atlas.has(name)) continue;
      this.sprites.add(this.add.ellipse(pet.x, pet.y + 5, 12, 5, 0x0d0b1f, 0.32).setDepth(3));
      const img = this.add.image(pet.x, pet.y - 6, this.textureKey, name)
        .setOrigin(0.5).setScale(1 / ART_SCALE).setDepth(7.6).setFlipX(f.flipX);
      if (pet.lifeMs < 1500) img.setAlpha((w.tick >> 2) & 1 ? 0.45 : 1);
      this.sprites.add(img);
    }
  }

  /** The dash strike's path: a bright streak the ghosts lie along. */
  private drawDashStrike(): void {
    const w = this.world;
    const p = w.player;
    if (p.strikeMs <= 0) return;
    const g = this.fxTopGfx;
    const len = 34;
    g.lineStyle(6, 0xffe9a8, 0.35);
    g.lineBetween(p.x - p.dashX * len, p.y - p.dashY * len - BODY_LIFT, p.x, p.y - BODY_LIFT);
    g.lineStyle(2, 0xffffff, 0.9);
    g.lineBetween(p.x - p.dashX * len, p.y - p.dashY * len - BODY_LIFT, p.x, p.y - BODY_LIFT);
  }

  /** How much the off-hand flame is enlarged this frame: 1 at rest, up to 1.7 on a cast. */
  private flare(): number {
    return 1 + 0.7 * Math.max(0, this.flareMs / CAST_MS);
  }

  /**
   * Reads births and deaths off the player bullet pool, once per sim step.
   *
   * A shot that was dead or unknown last step and is alive now was cast this
   * step, at the point it now stands: the hand for a spell, the carrier's
   * stopping point for a payload. A shot that was alive and is dead now
   * stopped this step, at the point it was last seen. Neither is an event in
   * the simulation, and both are the moments a spell needs to be visible at.
   */
  private trackSpellBullets(): void {
    const w = this.world;
    const born: Bullet[] = [];
    for (const b of w.playerBullets) {
      const m = this.bulletMemory.get(b);
      if (b.alive) {
        if (!m || !m.alive) born.push(b);
        if (m && m.alive) {
          m.x = b.x; m.y = b.y;
          m.payload = b.payloadUnit !== null; m.element = b.element;
          m.trail.push({ x: b.x, y: b.y });
          if (m.trail.length > TRAIL_POINTS) m.trail.shift();
        } else if (m) {
          // A recycled slot: a new shot, a new path.
          m.x = b.x; m.y = b.y; m.alive = true;
          m.payload = b.payloadUnit !== null; m.element = b.element;
          m.trail = [{ x: b.originX, y: b.originY }, { x: b.x, y: b.y }];
        } else {
          this.bulletMemory.set(b, {
            x: b.x, y: b.y, alive: true, payload: b.payloadUnit !== null, element: b.element,
            trail: [{ x: b.originX, y: b.originY }, { x: b.x, y: b.y }],
          });
        }
      } else if (m?.alive) {
        m.alive = false;
        // A carrier bursting is the spell going off; a plain shot running out
        // is a fizzle, sized to the shot.
        this.puffs.push({
          x: m.x, y: m.y, ms: PUFF_MS, element: m.element,
          scale: m.payload ? 1.8 : 0.6 + b.radius / 10,
        });
        // Running out is a scatter of motes drifting up, not a stop.
        const tint = ELEMENT_TINT[m.element] ?? ELEMENT_TINT.none;
        this.burst(m.x, m.y, tint.glow, m.payload ? 10 : 4, m.payload ? 160 : 60, undefined, Math.PI * 2, 0.8, -60);
      }
    }
    if (this.bulletMemory.size > w.playerBullets.length)
      for (const b of this.bulletMemory.keys()) if (!w.playerBullets.includes(b)) this.bulletMemory.delete(b);

    // A spray is one cast, not five: births within a few pixels of a flash
    // already started this step feed it instead of stacking.
    for (const b of born) {
      // Ahead of the birth point along the shot, so a spell leaves the hand
      // rather than ringing the body: a ring centred on the caster reads as
      // a shield, and a shield is the opposite of what just happened.
      const speed = Math.hypot(b.vx, b.vy) || 1;
      const x = b.x + (b.vx / speed) * 7;
      const y = b.y + (b.vy / speed) * 7;
      const near = this.casts.find((c) => c.ms === CAST_MS && Math.hypot(c.x - x, c.y - y) < 12);
      if (near) { near.scale = Math.min(1.8, near.scale + 0.2); continue; }
      this.casts.push({ x, y, ms: CAST_MS, element: b.element, scale: 1 });
      // A spray of the element's light thrown forward with the shot.
      const tint = ELEMENT_TINT[b.element] ?? ELEMENT_TINT.none;
      this.burst(x, y, tint.glow, 5, 170, Math.atan2(b.vy, b.vx), 0.9, 0.8);
    }
    if (born.some((b) => b.spellIndex >= 0)) this.flareMs = CAST_MS;
  }

  /** The element of the spell that most plausibly just landed at (x, y), if one did. */
  private spellElementNear(x: number, y: number): Element | null {
    let best: Element | null = null;
    let bestD = 12;
    for (const m of this.bulletMemory.values()) {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bestD) { bestD = d; best = m.element; }
    }
    return best;
  }

  /**
   * The flash where a shot is born and the fizzle where one stops.
   *
   * Both are rings with a bright centre, in the element's light, on the
   * additive layer above the bodies. The cast opens fast and throws a few
   * short rays, which is a thing going off; the fizzle is a slower ring with
   * no rays, which is a thing running out. Drawn, not sprited, for the same
   * reason as the impact ring: neither has a direction to be wrong about.
   */
  private drawSpellLight(): void {
    const g = this.fxTopGfx;
    for (const c of this.casts) {
      const t = 1 - c.ms / CAST_MS;
      const tint = ELEMENT_TINT[c.element] ?? ELEMENT_TINT.none;
      // A soft bloom behind the flash, so the cast lights the ground round the hand.
      g.fillStyle(tint.glow, (1 - t) * 0.18);
      g.fillCircle(c.x, c.y, c.scale * (8 + 6 * t));
      g.fillStyle(tint.core, (1 - t) * 0.85);
      g.fillCircle(c.x, c.y, c.scale * 3.5 * (1 - t * 0.6));
      g.lineStyle(Math.max(0.6, 1.8 * (1 - t)), tint.glow, (1 - t) * 0.9);
      g.strokeCircle(c.x, c.y, c.scale * (1.5 + 7.5 * Math.sqrt(t)));
      const rays = 5;
      const reach = c.scale * (4 + 8 * t);
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2 + c.x * 0.37 + c.y * 0.53;
        g.lineBetween(
          c.x + Math.cos(a) * reach * 0.55, c.y + Math.sin(a) * reach * 0.55,
          c.x + Math.cos(a) * reach, c.y + Math.sin(a) * reach,
        );
      }
    }
    for (const q of this.puffs) {
      const t = 1 - q.ms / PUFF_MS;
      const tint = ELEMENT_TINT[q.element] ?? ELEMENT_TINT.none;
      g.fillStyle(tint.glow, (1 - t) * 0.45);
      g.fillCircle(q.x, q.y, q.scale * 5 * (1 - t));
      g.lineStyle(Math.max(0.5, 1.6 * (1 - t)), tint.glow, (1 - t) * 0.8);
      g.strokeCircle(q.x, q.y, q.scale * (2 + 11 * t));
    }
  }

  override update(_time: number, delta: number): void {
    // The transition animates while the next room is being planned.
    if (this.transitionUi) this.tickTransition(delta);
    // No world yet, or one being replaced: nothing to step or draw.
    if (!this.world || this.entering) return;
    if (this.keys.BACKTICK && Phaser.Input.Keyboard.JustDown(this.keys.BACKTICK)) this.debug.toggle();
    this.debugAt += delta;
    if (this.debugAt > 250) { this.debugAt = 0; if (this.debug.isOpen()) this.debug.render(this.debugSnapshot()); }
    /*
     * Read **before** the fixed-step loop, because the loop is what forwards
     * it to the simulation.
     *
     * The first version read it further down, next to the other per-frame
     * timers, which is after `step` has already run — so the sim saw the
     * previous frame's value, which `JustDown` had by then cleared. Opening
     * the reward worked, because that consumer is also below the loop, and
     * entering a portal never did: the one path that goes *through* the
     * simulation was the one path reading a stale flag.
     */
    /*
     * Latched, not sampled.
     *
     * This was `interactPressed = JustDown(E)` every frame — and `JustDown`
     * consumes the edge. On a frame that ran **no** simulation step (the
     * accumulator had not reached 16.7 ms: any display faster than 60 Hz, or
     * an early frame), the press was read, cleared, and never forwarded, so
     * the portal needed several stabs at the key before one landed on a frame
     * with a step in it. The edge is now held until a step has seen it.
     */
    if (this.keys.E && Phaser.Input.Keyboard.JustDown(this.keys.E)) this.interactPressed = true;
    if (this.keys.L && Phaser.Input.Keyboard.JustDown(this.keys.L)) this.spinPressed = true;
    this.accumulator += Math.min(delta, 100);
    let stepped = false;
    // Tab or Escape: the menu. Escape also closes it (see `readStaffKeys`).
    // The title, the transition and the pause menu own the keys while they are up.
    if (this.transitionUi?.phase === "ready") this.readTransitionKeys();
    else if (this.intentUi) { this.readIntentKeys(); this.drawIntentDemo(); }
    else if (this.titleUi) this.readTitleKeys();
    else if (this.pauseUi) this.readPauseKeys();
    else if (this.gameOverUi) { /* the card's own key listeners answer; see showGameOver */ }
    else if (!this.staffUi && !this.offerUi && !this.transitionUi && this.keys.ESC && Phaser.Input.Keyboard.JustDown(this.keys.ESC)) this.showPause();
    // Tab: the character screen, directly.
    if (!this.titleUi && !this.intentUi && !this.pauseUi && !this.offerUi && this.keys.TAB && Phaser.Input.Keyboard.JustDown(this.keys.TAB)) {
      if (this.staffUi) this.hideStaff();
      else this.showStaff("view", null);
    }
    // Every modal screen pauses the fight — the staff screen, the cards, the
    // replace step, the pause menu, the title. Reading a build is not a thing
    // to do while a rusher is closing.
    /*
     * Game over stops the room. The simulation kept running after death —
     * bodies walking, the camera free, keys still casting — so a dead run
     * could be played on. Now the room freezes and the game-over card is up.
     */
    // Not while a new run is being built: the restart is called from the key
    // handling above, and the dead world is still `this.world` until the new
    // first room replaces it, which put the card straight back up.
    const dead = this.world.player.hearts <= 0 && !this.won && !this.entering;
    if (dead && !this.gameOverUi) this.showGameOver();
    if (this.staffUi || this.offerUi || this.pauseUi || this.titleUi || this.transitionUi || this.intentUi || dead) this.accumulator = 0;
    while (this.accumulator >= STEP_MS) {
      stepped = true;
      const wasCleared = worldCleared(this.world);
      const dashBefore = this.world.player.dashMs;
      const shotsBefore = this.world.stats.shotsFired;
      const enemyBulletsBefore = this.enemyBulletCount();

      step(this.world, this.readInput(), STEP_MS, ITEMS);
      this.trackSpellBullets();

      // A body that simply stops existing reads as a bug. The pop outlives
      // it by a fifth of a second so the kill has a moment of its own.
      for (const ev of this.world.events) {
        if (this.damageNumbersOn) this.noteDamage(ev);
        // A heavy shot's landing: a larger burst than a hit's.
        if (ev.kind === "hazard_tick" && ev.what?.startsWith("ram:")) {
          /*
           * A tank's ram connecting: a white flash and two shockwaves at the
           * point of contact, a fan of grit and sparks thrown the way the tank
           * was going, and a skid of dust behind the player as they are thrown.
           */
          const dir = Number(ev.what.slice(4));
          this.ring(ev.x, ev.y, 4, 44, 0xffffff, 240, 3.5);
          this.ring(ev.x, ev.y, 3, 30, 0xffb080, 420, 5);
          this.burst(ev.x, ev.y, 0xffffff, 10, 360, dir, 1.3, 1.3);
          this.burst(ev.x, ev.y, 0xffc890, 12, 240, dir, 2, 1.1);
          this.burst(ev.x, ev.y, 0x8a7a68, 12, 160, dir, 2.6, 1.6, 120);
          this.fxSlashes.push({ x: ev.x, y: ev.y, angle: dir + Math.PI / 2, ms: 0, colour: 0xffffff, len: 30 });
          this.fxSlashes.push({ x: ev.x, y: ev.y, angle: dir, ms: 0, colour: 0xffe0c0, len: 22 });
          this.ramSkidMs = 260;
          this.ramSkidDir = dir;
          this.sfx.play("hurt");
        }
        if (ev.kind === "hazard_tick" && ev.what === "heavy_hit") {
          this.impacts.push({ x: ev.x, y: ev.y, ms: IMPACT_MS, scale: 1.9 });
          this.ring(ev.x, ev.y, 4, 26, 0xd8d4e8, 260, 2);
          this.burst(ev.x, ev.y, 0xb8b0d8, 8, 120, undefined, Math.PI * 2, 0.5);
        }
        // Shatter: a wide pale burst and shards flung out.
        if (ev.kind === "hazard_tick" && ev.what === "shatter") {
          this.impacts.push({ x: ev.x, y: ev.y, ms: IMPACT_MS * 1.6, scale: 2.6, color: 0xcfefff });
          this.ring(ev.x, ev.y, 6, 34, 0xcfefff, 320, 2.5);
          this.burst(ev.x, ev.y, 0xe8f8ff, 14, 220, undefined, Math.PI * 2, 0.9);
          for (let k = 0; k < 8; k++) this.shards.push({ x: ev.x, y: ev.y, a: (k / 8) * Math.PI * 2 + Math.random() * 0.4, ms: 0 });
          this.sfx.play("kill");
        }
        /*
         * A broken prop is not a dead body.
         *
         * `damageProp` publishes `enemy_killed` with `what: "prop:pot"`, which
         * went through the enemy silhouette path — `ENEMY_FRAME["prop:pot"]`
         * is undefined, so the name resolved to nothing and the guard fell
         * back to `player_s_idle0`. A smashed pot flashed up a white
         * swordsman. It gets the impact burst instead, which is what a thing
         * shattering should look like anyway.
         */
        if (ev.kind === "enemy_killed" && ev.what?.startsWith("prop:")) {
          this.impacts.push({ x: ev.x, y: ev.y, ms: IMPACT_MS, scale: 1 });
          // Splinters: dull, heavy, falling.
          this.burst(ev.x, ev.y, 0x9a8fb8, 9, 150, undefined, Math.PI * 2, 0.8, 260);
          this.sfx.play("kill");
        } else if (ev.kind === "enemy_killed" && ev.what) {
          // `enemy_rusher_idle0` is not a frame — the sheet names them
          // `enemy_rusher_s_idle0` — so this asked for a name that never
          // existed and every directional body died with no pop at all. Which
          // meant the killing blow had no feedback of its own: a rusher dies
          // in two swings, so half of all hits on one showed nothing.
          const pose = popFrame(ev.what as EnemyId, ev.facing ?? 0, (n) => this.atlas.has(n));
          this.pops.push({
            x: ev.x, y: ev.y, flipX: pose.flipX, ms: 200,
            frame: safeFrame(this.atlas, pose.name, `${ENEMY_FRAME[ev.what as EnemyId]}_idle0`),
          });
          this.sfx.play("kill");
        }
        if (ev.kind === "shot" && ev.what && ev.what !== "musket" && ev.what !== "disc" && ev.facing !== undefined) {
          /*
           * Every enemy shot is an event: a flash at the muzzle, sized by
           * the weapon's weight, along the way the volley left. A ring has
           * no muzzle to speak of, so it gets a puff at the body instead.
           */
          const def = ENEMIES[ev.what as EnemyId];
          if ((ev.amount ?? 1) >= 8) this.playFx("smoke", ev.x, ev.y - 4, 0, 60, 6.3);
          else if (def) {
            const size = MUZZLE_WEIGHT[ev.what] ?? "s";
            const r = def.radius + 2;
            this.playFx(`muzzle_${size}`, ev.x + Math.cos(ev.facing) * r, ev.y - 3 + Math.sin(ev.facing) * r, ev.facing, 40, 8.9);
            // A heavy gun has a low layer under its report.
            if (size === "l") this.sfx.play("hit_enemy", 0.55);
          }
        }
        if (ev.kind === "shot" && ev.what === "musket") {
          // The blunderbuss: a boom, the flame out of the muzzle, then smoke.
          this.sfx.play("shoot_enemy", 0.45);
          this.sfx.play("kill", 0.6);
          this.muzzleFx.push({ x: ev.x, y: ev.y, a: ev.facing ?? 0, ms: 0 });
        } else if (ev.kind === "bullet_wall") {
          // Shot meeting stone: sparks thrown back off the face, then grit.
          this.playFx("hit_wall", ev.x, ev.y, (ev.facing ?? 0) + Math.PI, 45, 8.8);
        } else if (ev.kind === "bullet_spent") {
          // Spent in the air: it pinches out rather than vanishing.
          this.playFx("fizzle", ev.x, ev.y, 0, 50, 7.1);
        } else if (ev.kind === "enemy_hit" && ev.what === "tether_cut") {
          // The cut: the line breaks into sparks along its length.
          this.sfx.play("hit_enemy", 1.5);
          this.burst(ev.x, ev.y, 0xd8f4ff, 14, 260, undefined, Math.PI * 2, 0.7);
          this.ring(ev.x, ev.y, 4, 34, 0xd8f4ff, 240, 2);
          this.taught.add("ward");
        } else if (ev.kind === "enemy_hit") {
          this.sfx.play("hit_enemy");
          if (!ev.what?.startsWith("brake:")) {
            const swinging = swingPhase(this.world.player) !== "none";
            if (swinging) {
              // Sparks thrown the way the blade was travelling, and a cut across the body.
              const along = this.world.swing.angle + this.world.swing.sweep * Math.PI / 2;
              this.burst(ev.x, ev.y, 0xe8f6ff, 7, 200, along, 1.1, 0.7);
              this.fxSlashes.push({ x: ev.x, y: ev.y, angle: along, ms: 0, colour: 0xffffff, len: 20 });
            } else {
              const element = this.spellElementNear(ev.x, ev.y);
              const tint = ELEMENT_TINT[element ?? "none"] ?? ELEMENT_TINT.none;
              this.burst(ev.x, ev.y, tint.glow, 6, 150, undefined, Math.PI * 2, 0.6);
            }
          }
          // Rotated per hit so repeated strikes on one body do not stamp the
          // same shape, and scaled up for a kill.
          const spell = swingPhase(this.world.player) === "none" ? this.spellElementNear(ev.x, ev.y) : null;
          this.impacts.push({
            x: ev.x, y: ev.y, ms: IMPACT_MS, scale: 0.7,
            ...(swingPhase(this.world.player) !== "none"
              ? { slashAngle: this.world.swing.angle + Math.PI / 2 }
              : {}),
            ...(spell ? { color: ELEMENT_TINT[spell].glow } : {}),
          });
        }
        if (ev.kind === "enemy_killed") {
          this.impacts.push({ x: ev.x, y: ev.y, ms: IMPACT_MS, scale: 1.15 });
          if (!ev.what?.startsWith("prop:")) {
            // A kill is a burst: a flash, two rings at two speeds, and a spray.
            this.ring(ev.x, ev.y, 3, 30, 0xffffff, 220, 2.2);
            this.ring(ev.x, ev.y, 2, 18, 0xffe9a8, 360, 3.5);
            this.burst(ev.x, ev.y, 0xffe9a8, 10, 230, undefined, Math.PI * 2, 1);
            this.burst(ev.x, ev.y, 0xffffff, 6, 320, undefined, Math.PI * 2, 0.7);
          }
        }
        if (ev.kind === "player_hit" && ev.amount !== 0) {
          this.impacts.push({ x: ev.x, y: ev.y, ms: IMPACT_MS, scale: 0.9 });
          if (!ev.what?.startsWith("dot:")) this.playFx("hit_player", this.world.player.x, this.world.player.y - BODY_LIFT, 0, 45, 9.6);
          if (!ev.what?.startsWith("dot:")) this.burst(ev.x, ev.y - BODY_LIFT, 0xff6a5a, 9, 190, undefined, Math.PI * 2, 0.8);
        }
        if (ev.kind === "pickup") this.sfx.play("pickup");
        // The summoner's blink: a puff where it left and where it arrived.
        if (ev.kind === "telegraph" && ev.what?.startsWith("blink"))
          this.puffs.push({ x: ev.x, y: ev.y, ms: PUFF_MS, element: "none", scale: 1.7 });
        if (ev.kind === "player_hit" && !ev.what?.startsWith("dot:") && !ev.what?.startsWith("status:"))
          this.sfx.play("hurt");
        if (ev.kind === "reward_shown") this.buildRewardDrop();
      }
      // Shots and dashes are state changes rather than events, so they are
      // read as edges off the sim instead of being plumbed through it.
      if (this.world.stats.shotsFired > shotsBefore) {
        this.sfx.play("shoot_player");
        this.castFlash();
      }
      if (this.enemyBulletCount() > enemyBulletsBefore) this.sfx.play("shoot_enemy");
      if (dashBefore <= 0 && this.world.player.dashMs > 0) this.sfx.play("dash");
      // The spin: one cue as the charge gathers, one as the ring lets go.
      const spinPhase = this.world.player.swingStretch > 1 ? swingPhase(this.world.player) : "none";
      if (spinPhase === "windup" && this.lastSpinPhase !== "windup") this.sfx.play("telegraph");
      if (spinPhase === "recover" && this.lastSpinPhase === "active") this.sfx.play("kill");
      this.lastSpinPhase = spinPhase;
      /*
       * On the edge, not every step.
       *
       * This played once per simulation step for as long as any body was
       * winding up — seventeen times for one 280 ms windup. The retrigger
       * guard in `Sfx` hid the worst of it and the result was still a sound
       * that smeared instead of a cue that arrived, which is the opposite of
       * what a telegraph is for.
       */
      const committing = this.world.enemies.some((e) => e.attack === "windup");
      if (committing && !this.wasCommitting) this.sfx.play("telegraph");
      this.wasCommitting = committing;
      // Noticing is its own beat, so it gets its own cue.
      const noticing = this.world.enemies.some((e) => e.alertMs > 0);
      if (noticing && !this.wasNoticing) this.sfx.play("telegraph");
      this.wasNoticing = noticing;
      if (!wasCleared && worldCleared(this.world)) this.sfx.play("clear");

      this.accumulator -= STEP_MS;
    }
    /*
     * Braziers gutter and spikes cycle: two frames on a slow clock.
     *
     * Not the ice, the poison or the crumbling floor. Their second frame is a
     * **variant**, not a state — the same surface drawn again — so alternating
     * them made the floor itself twitch twice a second, over the whole area of
     * the zone. The spike strip keeps its pair because there the two frames
     * are retracted and out, which is a threat the player is meant to time.
     */
    for (const f of this.featureLights) {
      if (!f.cycles) continue;
      // Spikes on the simulation's own clock, so what is drawn out is what
      // bites; lights on a slow flicker of their own.
      const spikes = f.a.startsWith("hazard_spike");
      const second = spikes ? spikesOut(this.world.stats.elapsedMs) : ((this.world.tick >> 5) & 1) === 1;
      f.img.setFrame(second ? f.b : f.a);
    }
    for (const g of this.ghosts) g.ms -= delta;
    this.ghosts = this.ghosts.filter((g) => g.ms > 0);
    for (const hit of this.impacts) hit.ms -= delta;
    this.impacts = this.impacts.filter((hit) => hit.ms > 0);
    for (const c of this.casts) c.ms -= delta;
    this.casts = this.casts.filter((c) => c.ms > 0);
    for (const q of this.puffs) q.ms -= delta;
    this.puffs = this.puffs.filter((q) => q.ms > 0);
    if (this.flareMs > 0) this.flareMs -= delta;
    for (const pop of this.pops) pop.ms -= delta;
    this.pops = this.pops.filter((pop) => pop.ms > 0);
    if (this.tookMs > 0) this.tookMs -= delta;

    if (this.intentUi && this.demo) this.renderDemo();
    else {
      this.draw();
      this.drawHazards();
      this.drawExpansion();
      this.drawAffixMarks();
      this.drawSwing();
      this.drawEnemyBlades();
      this.drawFx(delta);
      this.fireFx.update(this.world, delta);
    }
    this.sweepTexts();
    this.holdCamera();
    this.updateExits();
    this.readOfferKeys();
    this.readStaffKeys();
    // The press has now been offered to the simulation and to the reward; a
    // frame with no step keeps it for the next one.
    if (stepped) { this.interactPressed = false; this.spinPressed = false; }

    if (this.keys.M && Phaser.Input.Keyboard.JustDown(this.keys.M)) {
      this.sfx.setMuted(!this.sfx.isMuted());
      try { localStorage.setItem(MUTE_KEY, this.sfx.isMuted() ? "1" : "0"); } catch { /* still toggles */ }
    }

    /*
     * Walking into an open portal is how a room ends. `R` no longer skips.
     *
     * The keypress was a placeholder from before there was an exit, and it
     * bypassed the reward beat entirely — which is why the reward and the
     * portals could be missing without the loop appearing broken: there was a
     * key that made the loop work without them.
     */
    /*
     * **The boss room has no way out, only a run that ends.**
     *
     * Without this `stageFor` kept returning "boss" for every index past the
     * last, so beating it spawned another boss, forever. A terminal room is
     * the one place the portal loop must not close.
     */
    if (stageFor(this.roomIndex) === "boss" && worldCleared(this.world) && !this.won) {
      this.won = true;
      this.tookLabel = `RUN COMPLETE  ${this.roomIndex} rooms, ${this.runGold} gold`;
      this.tookMs = 1e9;
      this.sfx.play("clear");
    }
    if (this.world.exited && !this.won && !this.entering) void this.leaveThrough(this.world.exited);
    if (this.won
      && Phaser.Input.Keyboard.JustDown(this.keys.R!)) {
      this.restartRun();
    }
  }

  /** Forgets the last room's Director requests: the next room's are about to be made. */
  private clearDirectorLog(): void {
    this.directorLog = [];
    this.planRecords = new Map();
  }

  /** A new run from room one: everything the run carried is dropped. */
  private restartRun(): void {
    this.hideGameOver();
    this.clearDirectorLog();
    {
      this.history = emptyHistory();
      this.owned = [];
      this.slots = [];
      this.spellAffixes = [];
      this.spellLevels = [];
      this.statsTaken = [];
      this.runGold = 0;
      this.mods = noMods();
      this.won = false;
      this.tension = "build";
      this.doorPlan = null;
      this.portalPlan = null;
      this.cardPlan = null;
      this.npcRoom = null;
      this.npcRooms = 0;
      this.lastWasNpc = false;
      this.offersMade = 0;
      this.needMisses = 0;
      this.elite = false;
      this.lastClearMs = 30_000;
      this.heartsLostRecent = 0;
      // A new run is a new seed, unless the URL pinned one.
      this.runSeed = freshSeed();
      const cam = this.cameras.main;
      cam.setZoom(ZOOM);
      // Zoom is applied about the centre, so the origin has to be re-anchored.
      cam.centerOn(VIEW_W / 2, (VIEW_H + HUD_H) / 2);

      if (!this.pendingTitle) this.showTransition();
      void this.enterRoom(1, MAX_HEARTS).then(() => {
        if (!this.transitionUi) return;
        if (this.showRoomParams) this.showRoomPlan();
        else this.hideTransition();
      });
    }
  }

  /**
   * Eiserloh's trauma model. The camera offset is the square of a single
   * accumulator, which is what makes a chip hit nearly invisible and a death
   * large without either needing its own tuning. Translation and rotation
   * together, because in 2D rotation is most of the effect.
   *
   * The displacement is driven by smooth noise rather than a fresh random
   * number per frame: random-per-frame buzzes, noise rumbles.
   */
  /**
   * Takes the portal the player walked into.
   *
   * The run's history is appended here rather than at arrival, because the
   * type the player *chose* is what the pacing rules are about: doc 003's
   * `shop_entered` tracks entry and not offer, and rule 5 forbids an elite
   * immediately after an elite. Both need the room being entered, recorded
   * once, at the moment of the choice.
   */
  private async leaveThrough(portal: Portal): Promise<void> {
    this.entering = true;
    const plan = this.planned;
    this.history = {
      ...this.history,
      rooms: [...this.history.rooms, portal.type],
      tensions: [...this.history.tensions, this.tension],
      spaces: [this.world.room.params.space, ...this.history.spaces],
      skeletons: this.world.room.skeleton ? [this.world.room.skeleton, ...(this.history.skeletons ?? [])] : this.history.skeletons ?? [],
      profiles: plan?.profile ? [...this.history.profiles, plan.profile] : this.history.profiles,
      shop_entered: this.history.shop_entered || (portal.type === "shop" && !portal.npc),
      elite_last_room: portal.elite,
    };
    this.runGold += this.world.gold;
    this.lastClearMs = this.world.stats.elapsedMs;
    this.heartsLostRecent = this.world.stats.heartsLost;
    /*
     * The Director sets the next room's tension from the run so far — the
     * one decision that makes a run a shape rather than a list of rooms.
     * The portal's reward and difficulty were already decided with the offer.
     */
    const staff = this.world.staff;
    this.showTransition();
    this.clearDirectorLog();
    const doorStart = performance.now();
    const doors = await this.director.planDoors(
      this.directorContext(this.roomIndex, this.world.player.hearts, staff),
    );
    this.doorPlanMs = performance.now() - doorStart;
    this.doorPlan = doors;
    this.planRecords.set("doors", { decisions: doors.decisions });
    this.tension = doors.tension;
    await this.enterRoom(this.roomIndex + 1, this.world.player.hearts, portal);
    // The plan is in: lay it out and wait, or start at once if the player
    // turned the page off.
    if (this.showRoomParams) this.showRoomPlan();
    else this.hideTransition();
  }

  /* ------------------------------- transition ------------------------------- */

  private showTransition(): void {
    this.hideTransition();
    const o: Phaser.GameObjects.GameObject[] = [];
    o.push(this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0x0d0b1f, 1).setDepth(240));
    const dots = this.menuText(VIEW_W / 2, VIEW_H / 2, "generating the next room", 10, "#c9cfe8").setDepth(241);
    o.push(dots);
    this.transitionUi = { phase: "generating", startedMs: 0, ms: 0, objects: o, dots, page: 0, scroll: 0, maxScroll: 0 };
  }

  private tickTransition(delta: number): void {
    const t = this.transitionUi;
    if (!t) return;
    t.ms += delta;
    if (t.phase === "generating" && t.dots) {
      const n = Math.floor(t.ms / 300) % 4;
      // After a second, say how long: a Director waiting on Jev is slow, not stuck.
      t.dots.setText(`generating the next room${".".repeat(n)}${" ".repeat(3 - n)}${t.ms > 1000 ? `   ${(t.ms / 1000).toFixed(1)} s` : ""}`);
    }
  }

  private hideTransition(): void {
    for (const g of this.transitionUi?.objects ?? []) g.destroy();
    this.transitionUi = null;
  }

  /**
   * The plan the Director made, before the room starts: what the room is,
   * who is in it, what it pays, and **who decided each part** — Jev or the
   * rule arm — which is the project's thesis made visible.
   */
  private showRoomPlan(): void {
    const t = this.transitionUi;
    if (!t) return;
    t.dots = null;
    t.phase = "ready";
    t.page = 0;
    t.scroll = 0;
    this.renderRoomPlan();
  }

  /** The tabs of the plan page. */
  private static readonly PLAN_PAGES = ["ROOM", "DIRECTOR INPUTS", "DIRECTOR QUESTIONS"] as const;

  /**
   * The plan page, one tab at a time: the room as built; every state field
   * each Director request was sent; every question in every request with all
   * its options. The last two are the debug sidebar's readout at a size that
   * scrolls. Left and right change tab, up and down scroll.
   */
  private renderRoomPlan(): void {
    const t = this.transitionUi;
    if (!t) return;
    const took = this.lastPlanMs;
    for (const g of t.objects) if (g !== t.objects[0]) g.destroy();
    t.objects = t.objects.slice(0, 1);
    const snap = this.debugSnapshot();
    const r = snap.room;
    const e = snap.encounter;
    const cx = VIEW_W / 2;
    const add = (x: number, y: number, str: string, px: number, color: string, origin = 0.5) => {
      const txt = this.add.text(x, y, str, { fontFamily: "monospace", fontSize: `${Math.round(px * ZOOM)}px`, color })
        .setOrigin(origin, 0.5).setScale(1 / ZOOM).setDepth(241);
      t.objects.push(txt);
    };
    const title = this.npcRoom ? (this.npcRoom === "merchant" ? "THE MERCHANT" : "THE BLACKSMITH") : r.type.toUpperCase();
    add(cx, 34, `ROOM ${r.index}  ·  ${title}${r.elite ? "  ·  ELITE" : ""}`, 14, r.elite ? "#ff9a8a" : "#ffe9a8");
    add(cx, 49, `planned in ${took < 1000 ? `${Math.round(took)} ms` : `${(took / 1000).toFixed(1)} s`}  ·  ${snap.director.length} Director requests`, 7, "#5a5f7a");
    // The tabs.
    const pages = PlayScene.PLAN_PAGES;
    const tabW = 150;
    pages.forEach((name, i) => {
      const x = cx + (i - (pages.length - 1) / 2) * tabW;
      add(x, 62, i === t.page ? `[ ${name} ]` : name, 7, i === t.page ? "#ffe9a8" : "#5a5f7a");
    });
    t.objects.push(this.keys_(cx, VIEW_H - 58, "[Enter] begin", 10, "#ffe9a8", 241));
    t.objects.push(this.keys_(cx, VIEW_H - 44, "[◂][▸] tab    [▴][▾] scroll    this page can be turned off in Settings", 7, "#6a7396", 241));
    if (t.page === 1) { this.renderPlanLines(this.inputLines(snap.director), add); return; }
    if (t.page === 2) { this.renderPlanLines(this.questionLines(snap.director), add); return; }
    t.maxScroll = 0;
    const promise = this.roomPromise;
    const reward = `${this.roomReward}${promise.school ? ` (${promise.school})` : promise.family ? ` (${promise.family})` : ""}${promise.grade > 1 ? `  grade ${promise.grade}` : ""}`;
    const m = r.measured;
    const fmt = (v: number) => (Number.isInteger(v) ? `${v}` : v.toFixed(2));
    // Left: what the room is.
    const left: [string, string][] = [
      ["space", `${r.space} · ${r.symmetry}`],
      ["mood", r.mood],
      ["tension", r.tension],
      ["stage", r.stage],
      ["measured", Object.entries(m).map(([k, v]) => `${k.replace(/_/g, " ")} ${fmt(v as number)}`).slice(0, 3).join(" · ")],
      ["", Object.entries(m).map(([k, v]) => `${k.replace(/_/g, " ")} ${fmt(v as number)}`).slice(3).join(" · ")],
      ...r.zones.map((z, i) => [i === 0 ? "zones" : "", `${z.id}: ${z.feature}`] as [string, string]),
      ...(e ? [
        ["encounter", `${e.profile.composition} · ${e.profile.density}`] as [string, string],
        ["", `${e.profile.wave_structure} · anchor ${e.profile.anchor} · entry ${e.profile.entry}`] as [string, string],
        ["pressure", `${e.pressure.toFixed(2)} in ${e.band[0]}..${e.band[1]}  ·  ${e.roster} bodies`] as [string, string],
        ...e.waves.map((wv, i) => [i === 0 ? "waves" : "", `t+${(wv.atMs / 1000).toFixed(1)}s  ${wv.spawns}`] as [string, string]),
        ["elite affixes", e.affixes.length ? e.affixes.join(", ") : "none"] as [string, string],
      ] : []),
      ["reward", reward],
      ...(this.cardPlan && this.offer
        ? [["cards", this.offer.cards.map((c, i) => `${c.label} (${this.cardPlan!.origins[i] ?? "?"})`).join(", ")] as [string, string]]
        : []),
      ...(this.offer?.doors ?? []).map((d, i) => [i === 0 ? "portals" : "",
        d.npc ? `${d.npc === "smith" ? "blacksmith" : "merchant"}'s room`
          : `${d.elite ? "ELITE " : ""}${d.reward}${d.school ? ` ${d.school}` : d.family ? ` ${d.family}` : ""}${(d.grade ?? 1) > 1 ? ` grade ${d.grade}` : ""}`,
      ] as [string, string]),
      ["trimmed", r.trimmed ? "yes, the commit check cut the plan" : "no"],
    ].filter(([k, v]) => k !== "" || v !== "") as [string, string][];
    /*
     * When the assembler could not fit the chosen profile into the band it
     * stands a preset in, so the encounter shown differs from the answer in
     * the decision list; say so rather than leave the two disagreeing.
     */
    const chosen = this.planned?.decisions.find((d) => d.question === "composition")?.choice;
    if (e && chosen && chosen !== e.profile.composition)
      left.push(["note", `chose ${chosen}; it could not fit the band, a preset stood in`]);
    const lx = 118;
    const clip = (v: string) => (v.length > 46 ? `${v.slice(0, 45)}…` : v);
    const leftH = Math.max(9, Math.min(12, Math.floor((VIEW_H - 160) / Math.max(1, left.length))));
    left.forEach(([k, v], i) => {
      add(lx, 82 + i * leftH, k, leftH < 12 ? 6 : 7, "#8792b5", 1);
      add(lx + 8, 82 + i * leftH, clip(v), leftH < 12 ? 6 : 7, k === "note" ? "#ffb080" : "#e8e3d8", 0);
    });
    /*
     * Right: **every decision the Director made**, by question — the answer,
     * how sure the distribution was of it, the runners-up, and whether Jev or
     * the rule arm answered. The thesis of the project, on the screen where
     * the player is already reading the plan.
     */
    // By subject (`categoryOf`), each group under its name: pacing, the room,
    // its mood and layout, the enemies, the portals, the cards.
    const decisions = [
      ...(this.doorPlan?.decisions ?? []), ...(this.planned?.decisions ?? []),
      ...(this.cardPlan?.decisions ?? []), ...(this.portalPlan?.decisions ?? []),
    ].map((d, i) => ({ d, c: categoryOf(d.question ?? ""), i }))
      .sort((a, b) => CATEGORIES.indexOf(a.c) - CATEGORIES.indexOf(b.c) || a.i - b.i);
    const rows: ({ head: string } | { d: Decision })[] = [];
    for (const [i, x] of decisions.entries()) {
      if (i === 0 || decisions[i - 1]!.c !== x.c) rows.push({ head: x.c });
      rows.push({ d: x.d });
    }
    const rx = VIEW_W / 2 + 40;
    add(rx, 80, "DIRECTOR DECISIONS", 8, "#8fdcff", 0);
    // Room for every decision: the rows close up, and drop their runners-up,
    // when a planned room and its portals ask more than fit at full height.
    const rowH = Math.max(8, Math.min(12, Math.floor((VIEW_H - 175) / Math.max(1, rows.length))));
    const compact = rowH < 12;
    rows.slice(0, Math.floor((VIEW_H - 175) / rowH)).forEach((row, i) => {
      const y = 94 + i * rowH;
      if ("head" in row) { add(rx, y, row.head.toUpperCase(), 6, "#8fdcff", 0); return; }
      const d = row.d;
      const probs = Object.entries(d.probabilities).sort((a, b) => b[1] - a[1]);
      const p = d.probabilities[d.choice] ?? 0;
      const others = probs.filter(([k]) => k !== d.choice).slice(0, 2).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(", ");
      add(rx, y, `${(d.question ?? "?").replace(/_/g, " ")}: ${d.choice} ${Math.round(p * 100)}%${compact && others ? `   (${others})` : ""}`, compact ? 6 : 7, d.source === "jev" ? "#ffe9a8" : "#c9cfe8", 0);
      if (others && !compact) add(rx + 6, y + 6, others, 5, "#6a7396", 0);
      add(VIEW_W - 12, y, d.source, 6, d.source === "jev" ? "#8fdcff" : "#6a7396", 1);
    });
    if (decisions.length === 0) add(rx, 94, "none: this room is placed, not planned", 7, "#6a7396", 0);
    else add(rx, VIEW_H - 72, "every option of every question: ▸ DIRECTOR QUESTIONS", 6, "#6a7396", 0);
  }

  /**
   * The state each request carried. Fields every request shared are listed
   * once at the top; each request then lists only what was its own — a room
   * round's tension and last spaces, a card offer's facts, the portal count.
   */
  private inputLines(reqs: readonly ReadoutRequest[]): PlanLine[] {
    if (reqs.length === 0) return [{ text: "no requests: this room was placed, not planned", color: "#6a7396" }];
    const same = (k: string, v: string) => reqs.every((r) => r.state.some(([k2, v2]) => k2 === k && v2 === v));
    const shared = reqs[0]!.state.filter(([k, v]) => reqs.length > 1 && same(k, v));
    const sharedKeys = new Set(shared.map(([k]) => k));
    const out: PlanLine[] = [];
    if (shared.length) {
      out.push({ text: `every request (${reqs.length}) carried`, color: "#8fdcff" });
      for (const [k, v] of shared) out.push({ text: `${k}  ${v}`, color: "#e8e3d8", indent: 12 });
    }
    for (const r of reqs) {
      const own = r.state.filter(([k]) => !sharedKeys.has(k));
      out.push({ text: `${r.title}  ·  ${r.source}${r.fallback ? `  (fell back: ${r.fallback})` : ""}`, color: "#8fdcff", gap: true });
      if (own.length === 0) out.push({ text: "nothing of its own", color: "#6a7396", indent: 12 });
      for (const [k, v] of own) out.push({ text: `${k}  ${v}`, color: "#e8e3d8", indent: 12 });
    }
    return out;
  }

  /** Every question, its answer, and every option with its probability. */
  private questionLines(reqs: readonly ReadoutRequest[]): PlanLine[] {
    if (reqs.length === 0) return [{ text: "no requests: this room was placed, not planned", color: "#6a7396" }];
    const out: PlanLine[] = [];
    // By subject — pacing, room, mood, layout, enemies, portals, cards — not
    // by the request that carried them; the request is named on each line.
    for (const group of groupByCategory(reqs)) {
      out.push({ text: group.category, color: "#8fdcff", gap: out.length > 0 });
      for (const q of group.questions) {
        const pct = (p: number) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
        out.push({
          text: `${q.name}${q.choice ? `  →  ${q.choice}` : ""}   ${q.source}${q.note ? `  (${q.note})` : ""}   · ${q.request}`,
          color: q.source === "jev" ? "#ffe9a8" : "#e8e3d8", indent: 8,
        });
        out.push({ text: q.probs.map(([k, p]) => `${k} ${pct(p)}`).join("  ·  ") || "no options", color: "#8792b5", indent: 20, px: 6 });
      }
    }
    return out;
  }

  /** Lays out wrapped lines under the tabs, from the scroll offset, as many as fit. */
  private renderPlanLines(
    lines: readonly PlanLine[],
    add: (x: number, y: number, str: string, px: number, color: string, origin?: number) => void,
  ): void {
    const t = this.transitionUi!;
    const left = 40;
    const rows: { text: string; color: string; px: number; indent: number; gap: boolean }[] = [];
    for (const l of lines) {
      const px = l.px ?? 7;
      const indent = l.indent ?? 0;
      // Monospace: a character is about 0.6 of the font size wide.
      const max = Math.max(20, Math.floor((VIEW_W - left * 2 - indent) / (px * 0.6)));
      wrapWords(l.text, max).forEach((text, i) => rows.push({ text, color: l.color, px, indent: indent + (i > 0 ? 8 : 0), gap: i === 0 && !!l.gap }));
    }
    const top = 82;
    const bottom = VIEW_H - 76;
    // How many rows fit from each start; the scroll stops where the last row shows.
    const fits = (from: number) => {
      let y = top;
      let n = 0;
      for (let i = from; i < rows.length; i++) {
        y += rows[i]!.px + 4 + (rows[i]!.gap && i > from ? 5 : 0);
        if (y > bottom) break;
        n++;
      }
      return n;
    };
    let last = rows.length - 1;
    while (last > 0 && fits(last - 1) >= rows.length - (last - 1)) last--;
    t.maxScroll = Math.max(0, last);
    t.scroll = Math.max(0, Math.min(t.scroll, t.maxScroll));
    let y = top;
    const n = fits(t.scroll);
    for (let i = t.scroll; i < t.scroll + n; i++) {
      const row = rows[i]!;
      if (row.gap && i > t.scroll) y += 5;
      add(left + row.indent, y + row.px / 2, row.text, row.px, row.color, 0);
      y += row.px + 4;
    }
    if (t.scroll > 0) add(VIEW_W - left, top - 4, "▴ more", 6, "#6a7396", 1);
    if (t.scroll + n < rows.length) add(VIEW_W - left, bottom + 4, `▾ ${rows.length - t.scroll - n} more lines`, 6, "#6a7396", 1);
  }

  private readTransitionKeys(): void {
    const down = (k?: Phaser.Input.Keyboard.Key) => !!k && Phaser.Input.Keyboard.JustDown(k);
    const t = this.transitionUi;
    if (t) {
      const pages = PlayScene.PLAN_PAGES.length;
      let redraw = false;
      if (down(this.keys.RIGHT) || down(this.keys.D) || down(this.keys.TAB)) { t.page = (t.page + 1) % pages; t.scroll = 0; redraw = true; }
      if (down(this.keys.LEFT) || down(this.keys.A)) { t.page = (t.page + pages - 1) % pages; t.scroll = 0; redraw = true; }
      // Held keys scroll on after a beat, a line every 45 ms.
      const now = this.time.now;
      const held = (k?: Phaser.Input.Keyboard.Key) => {
        if (!k || !k.isDown || k.getDuration() < 260 || now < this.planScrollAt) return false;
        this.planScrollAt = now + 45;
        return true;
      };
      const step = this.keys.SHIFT?.isDown ? 8 : 1;
      if (down(this.keys.DOWN) || down(this.keys.S) || held(this.keys.DOWN) || held(this.keys.S)) {
        if (t.scroll < t.maxScroll) { t.scroll = Math.min(t.maxScroll, t.scroll + step); redraw = true; }
      }
      if (down(this.keys.UP) || down(this.keys.W) || held(this.keys.UP) || held(this.keys.W)) {
        if (t.scroll > 0) { t.scroll = Math.max(0, t.scroll - step); redraw = true; }
      }
      if (redraw) this.renderRoomPlan();
    }
    if (down(this.keys.ENTER) || down(this.keys.SPACE) || down(this.keys.J) || down(this.keys.E)) this.hideTransition();
  }

  /**
   * The reward object on the floor, under a beam.
   *
   * Built when the simulation places it, not when the room clears, so the two
   * cannot disagree about where it is. The beam is a plain tall rectangle
   * rather than a sprite: it is the one effect in the game whose whole purpose
   * is to be visible through everything else, and a drawn one would be tinted
   * by the room's mood along with the walls it has to stand out from.
   */
  private buildRewardDrop(): void {
    this.destroyRewardDrop();
    const drop = this.world.rewardDrop;
    if (!drop) return;
    /*
     * The beam, as three stacked additive rectangles.
     *
     * The first version was one flat rectangle at 14% alpha and could not be
     * seen at all — normal blending over a dark floor at that opacity is
     * nothing, and a single-width column does not read as light anyway. Light
     * is **additive** and it is **brightest at its core**, so this is a wide
     * dim wash, a narrower brighter one, and a thin hot centre. Three
     * primitives is cheaper than a sprite and, unlike a sprite, cannot be
     * recoloured by the room's mood — which matters, because the one thing the
     * beam has to do is stand out from the walls it is drawn against.
     *
     * Drawn *over* the bodies rather than under them. A light column is in the
     * air, and one that enemies walked in front of would read as a decal.
     */
    /*
     * The column itself is now drawn per frame in `beamGfx` — tapered, swaying,
     * rooted on the item — because three fixed rectangles standing on the floor
     * while the item floated above them read as a cheap decal the item happened
     * to be near. See the reward block in `updateExits`.
     */
    /*
     * The pedestal, **by name that exists**. `prop_reward_stat_0` was never
     * drawn, and asking the texture for a frame it does not have hands back
     * its first frame — which, alphabetically, is the boss. So a stat reward
     * stood on the floor as a crowned construct, and an elite room's portal
     * was reported as "a boss icon". The affix pedestal stands in for the
     * stat one, with the stat badge over it so the two still read apart; the
     * drawn pedestal is on the art work order.
     */
    const pedestal = safeFrame(this.atlas, `prop_reward_${drop.kind}_0`, "prop_reward_affix_0");
    const glow = this.add.image(drop.x, drop.y, this.uiTextureKey, pedestal)
      .setOrigin(0.5).setScale(1 / ART_SCALE).setDepth(4.4)
      .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.3);
    const body = this.add.image(drop.x, drop.y, this.uiTextureKey, pedestal)
      .setOrigin(0.5).setScale(1 / ART_SCALE).setDepth(4.5);
    const badgeName = `icon_reward_${drop.kind}`;
    const badge = this.atlas.has(badgeName) && !this.atlas.has(`prop_reward_${drop.kind}_0`)
      ? this.add.image(drop.x, drop.y - 14, this.crispTextureKey, badgeName).setOrigin(0.5).setScale(1).setDepth(4.6)
      : null;
    this.rewardGfx = { body, glow, badge };
    this.sfx.play("pickup");
  }

  /**
   * The reward's light, on the **floor**.
   *
   * It was a column: three additive shafts, then a tapered one, rising a
   * hundred and ninety px off the pedestal. A column is a side-view idiom —
   * light going *up* — and in a top-down room there is no up for it to go;
   * it read as a pale bar pasted across the floor whatever its shape. What a
   * top-down reward has instead is a glow on the ground it stands on: a soft
   * additive disc that breathes, a ring of motes orbiting the pedestal, and
   * a few sparks that rise a little way and fade. Findable from across the
   * room by the breathing, and it sits in the room rather than on it.
   */
  private drawRewardBeam(x: number, baseY: number, strength: number, ms: number): void {
    const g = this.beamGfx;
    g.clear();
    if (strength <= 0) return;
    const breathe = 0.85 + 0.15 * Math.sin(ms / 520);
    // The floor glow, three discs from wide and dim to tight and bright.
    for (const [r, alpha] of [[38, 0.07], [24, 0.12], [13, 0.22]] as const) {
      g.fillStyle(0xffe9a8, alpha * strength * breathe);
      g.fillEllipse(x, baseY + 6, r * 2 * breathe, r * 1.1 * breathe);
    }
    // Motes orbiting the pedestal on the floor plane.
    for (let i = 0; i < 6; i++) {
      const a = ms / 700 + (i / 6) * Math.PI * 2;
      g.fillStyle(i % 2 ? 0xffffff : 0xffe9a8, 0.7 * strength);
      g.fillCircle(x + Math.cos(a) * 20, baseY + 6 + Math.sin(a) * 9, 1.4);
    }
    // Sparks rising a hand's breadth and gone.
    for (let i = 0; i < 5; i++) {
      const u = ((ms / 1100) + i * 0.41) % 1;
      const mx = x + Math.sin(ms / 400 + i * 1.9) * 9;
      const my = baseY - 4 - u * 22;
      g.fillStyle(0xffffff, 0.6 * (1 - u) * strength);
      g.fillCircle(mx, my, 1 + (1 - u) * 0.8);
    }
  }

  private destroyRewardDrop(): void {
    if (!this.rewardGfx) return;
    this.rewardGfx.body.destroy();
    this.rewardGfx.glow.destroy();
    this.rewardGfx.badge?.destroy();
    this.rewardGfx = null;
    this.beamGfx.clear();
  }

  /**
   * The offer screen: three cards, chosen with a key or a click.
   *
   * A screen rather than pickups on the floor, because **a reward has to be
   * read**. An item is a name, a rarity and a sentence of rules text that doc
   * 010 generates, and none of that fits under a 64 px sprite on a dungeon
   * floor — so the floor version had the player choosing between three icons.
   * It is also where affix text will go when affixes arrive, which is the
   * other half of why this shape is the right one.
   *
   * Built from `ui_card_frame`, which has been in the sheet since the first
   * delivery and had never been drawn anywhere.
   */
  private showRewards(): void {
    this.hideRewards();
    const cards = this.shopping ? this.shopStock : this.offer?.cards ?? [];
    /*
     * **A gold room never reaches here.** It has nothing to choose, so the
     * simulation scatters coins on clearing and raises the portals itself;
     * there is no object to open and no screen to show.
     */
    if (cards.length === 0) return;

    /*
     * Positioned in **world** coordinates at the camera's centre, not pinned
     * to the screen with `setScrollFactor(0)`.
     *
     * The first version did pin it and the panel never appeared. Phaser's
     * scroll factor removes the camera's *scroll* from a position but not its
     * **zoom**, and this camera runs at `ART_SCALE * DPR` — so a panel placed
     * at `VIEW_W / 2` landed several screens off to the side. The camera here
     * never moves during a room, so its own centre is a fixed world point and
     * the simplest correct anchor.
     */
    const view = this.cameras.main.worldView;
    const cx = view.centerX;
    const cy = view.centerY;
    const dim = this.add.rectangle(cx, cy, view.width, view.height, 0x0d0b1f, 0.78)
      .setDepth(200);
    const dismantle = !this.shopping && cards.some((c) => c.kind === "spell")
      ? `     [X] dismantle a spell (+${dismantleValue(cards.find((c) => c.kind === "spell")?.grade ?? 1)} gold)` : "";
    const hint = this.keys_(cx, 0, this.shopping
      ? `[A][D] move     [Enter] or [J] buy     [Esc] leave     gold ${this.goldHeld()}`
      : `[A][D] move     [Enter] or [J] take${dismantle}`, 8, "#8792b5", 201);
    const heading = this.add.text(cx, cy - 104, this.shopping ? "THE MERCHANT" : "CHOOSE ONE", {
      fontFamily: "monospace", fontSize: `${Math.round(14 * ZOOM)}px`, color: "#ffe9a8",
    }).setOrigin(0.5).setScale(1 / ZOOM).setDepth(201);

    /*
     * The frame is the **card**, stretched to hold everything.
     *
     * `ui_card_frame` is a 64 px corner-bracket, drawn to be stretched rather
     * than scaled — the first version scaled it uniformly and got a small
     * square that framed the name only, with the icon floating above it and
     * the rules text spilling out of the bottom. A frame that does not contain
     * its contents is worse than no frame, because it reads as a separate
     * object sitting behind them.
     */
    const CARD_W = 128;
    /**
     * Fixed, and generous enough that the fit almost never has to step down:
     * it holds the longest description in the current pool at full size.
     */
    const CARD_H = 196;
    /** One line of the name font; a name that wraps to two is allowed to. */
    const NAME_H = 11;
    /** One line of the stat font, which is always one line by construction. */
    const STAT_H = 10;
    /** Air between cards, so two panels never share an edge. */
    const CARD_GAP = 22;
    const PAD = 12;
    /** The height of the lower corner brackets, which text must not cross. */
    const CARD_FOOT = 22;
    const ICON_PX = 34;
    const SPREAD = CARD_W + CARD_GAP;

    /*
     * Built text first, panel second, because **the card is sized to fit its
     * contents** rather than the other way round.
     *
     * A fixed height was tried and the rules text ran out of the bottom of the
     * card, straight through the lower corner brackets. It is not a matter of
     * picking a taller number either: doc 010 *generates* these descriptions,
     * so their length is not known here and will change. Measuring the wrapped
     * text and sizing the panel to it is the only version that cannot overflow.
     */
    /*
     * A **fixed** card height, with the text auto-fitted into it.
     *
     * Three layouts were tried. A fixed height with fixed text overflowed the
     * card and ran through the lower corner brackets. Sizing each card to its
     * own text fixed that and made the row ragged — three different heights on
     * one line, and a card's size starts to look like a statement about its
     * value. Sizing every card to the tallest fixed the raggedness and left
     * the height of the whole screen at the mercy of one long description.
     *
     * So the height is a constant and the *text* yields. The alternative
     * considered was a scrolling region per card, which is easy enough with a
     * geometry mask, and it is the wrong answer here: these three cards are
     * meant to be **compared**, and a player cannot compare what is scrolled
     * out of view. Hiding part of an option is a worse cost than a smaller
     * font, and it puts a scroll gesture between the player and a decision
     * they want to make quickly.
     *
     * Descriptions are generated (doc 010), so the fit has to be computed
     * rather than eyeballed: tighten the line spacing first, then step the
     * font down, and stop as soon as it fits.
     */
    const wrap = (CARD_W - PAD * 2) * ZOOM;
    const texts = cards.map((card) => {
      /*
       * **Left-aligned**, all three blocks. Centred, a wrapped line started
       * somewhere different every row and the eye had to hunt for each one;
       * a card is read, and reading wants one left edge.
       */
      const name = this.add.text(0, 0, card.label, {
        fontFamily: "monospace", fontSize: `${Math.round(9 * ZOOM)}px`, color: "#e8e3d8",
        align: "left", wordWrap: { width: wrap },
      }).setOrigin(0, 0).setScale(1 / ZOOM).setDepth(202);

      /*
       * The numbers, in the pickup gold, above the prose.
       *
       * Gold because it is the same colour as every other affordance in the
       * HUD — the mana pips, the key prompts — so it reads as *a number the
       * game is telling you* rather than as part of the sentence below it.
       */
      /*
       * In the merchant's room the price is part of the numbers line, because
       * "what does it cost" and "what does it do" are the same question there.
       */
      // The price is a chip in the corner (below), never mixed into the numbers.
      /*
       * Built before the body, because the body is laid out **under the
       * measured stat line**. The stat line was assumed to be one line high;
       * an affix's tier text wraps to three at this width, and the body was
       * drawn on top of it.
       */
      const note = this.upgradeNote(card).trim();
      const row = this.statRow([
        ...(note ? [{ text: note, tone: "grade" }] : []),
        ...(card.statParts ?? [{ text: card.stats, tone: "mod" }]),
      ], wrap / ZOOM, 8, 202);
      const stats = row.box;
      const statH = Math.max(STAT_H, Math.ceil(row.height));
      // The name's measured height too: a long name wraps to two lines and
      // the stat line was drawn over its second one.
      const nameH = Math.max(NAME_H, Math.ceil(name.height / ZOOM));
      const bodyTop = PAD + ICON_PX + 6 + nameH + 2 + statH + 6;
      /*
       * The room the rules text has: from under the stat line to above the
       * lower corner brackets. It was measured to the padding, and the
       * brackets are taller than the padding, so a long description fitted
       * the card by this arithmetic and still ran through the bracket art.
       */
      const bodyRoom = CARD_H - bodyTop - CARD_FOOT;

      let body!: Phaser.GameObjects.Text;
      for (const [px, lead] of BODY_FITS) {
        body?.destroy();
        body = this.add.text(0, 0, card.description, {
          fontFamily: "monospace", fontSize: `${Math.round(px * ZOOM)}px`, color: "#8792b5",
          align: "left", wordWrap: { width: wrap }, lineSpacing: lead * ZOOM,
        }).setOrigin(0, 0).setScale(1 / ZOOM).setDepth(202);
        if (body.height / ZOOM <= bodyRoom) break;
      }
      // Still too long at the smallest size: cut at a word and say so, rather
      // than run the text through the corner art.
      if (body.height / ZOOM > bodyRoom) {
        const words = card.description.split(" ");
        while (words.length > 4 && body.height / ZOOM > bodyRoom) {
          words.pop();
          body.setText(`${words.join(" ")}…`);
        }
      }
      return { name, stats, body, bodyTop, nameH };
    });
    const cardH = CARD_H;
    const top = cy - cardH / 2;

    const built = cards.map((card, i) => {
      const x = cx + (i - (cards.length - 1) / 2) * SPREAD;
      const { name, stats, body, bodyTop, nameH } = texts[i]!;

      /*
       * A spell card shows **its own icon**, not the generic kind.
       *
       * The twenty castables now have one each, which is the whole point of
       * asking for them: a player learns "the red spiky one is the fire nuke"
       * from the shape long before they read the name, and that only works if
       * the card shows the spell rather than the category. Affixes have no
       * icons drawn yet and gold does not need one, so both keep the kind art.
       */
      const specificIcon = card.kind === "spell" ? `icon_${card.itemId}`
        : card.kind === "stat" ? `icon_stat_${card.itemId}`
        : card.kind === "affix" ? `icon_affix_${card.itemId}`
        : "";
      /*
       * Vigour shows the HUD's own red heart. Its delivered icon is a **blue**
       * heart, which is the mana bar's colour — a healing card that reads as
       * mana. The icon is in the art work order to be redrawn.
       */
      /*
       * The first of these the sheet actually has. A name missing from the
       * atlas does not fail — Phaser draws some other frame — so every
       * fallback is checked, down to a pedestal that exists. `wrath` is the
       * spin's charge and borrows the spin's own action-bar icon until its
       * icon is drawn (art work order A2).
       */
      const iconFrame = [
        card.itemId === "vigour" ? "ui_heart_full" : "",
        specificIcon,
        card.itemId === "wrath" ? "icon_stat_keen_edge" : "",
        card.kind === "stat" ? STAT_UPGRADES.filter((u) => u.family === statById(card.itemId)?.family).map((u) => `icon_stat_${u.id}`).find((n) => this.atlas.has(n)) ?? "" : "",
        `prop_reward_${card.kind}_0`,
        "prop_reward_spell_0",
      ].find((n) => n && this.atlas.has(n)) ?? "prop_reward_spell_0";

      const panel = this.add.rectangle(x, cy, CARD_W, cardH, 0x161334, 0.96)
        .setStrokeStyle(1, 0x4a5480, 0.9).setDepth(200.5);
      /*
       * `ui_card_frame` is **four corner brackets**, so it is drawn four times
       * and **inset by half its own size**.
       *
       * Two mistakes in a row here. It was first stretched to the card with
       * `setDisplaySize`, which pulled the corner Ls into two smeared blobs on
       * the left and right edges. Then it was placed at native scale but
       * centred *on* each corner, so half of every bracket hung outside the
       * panel — and since the brackets are 32 drawn px wide, the pair between
       * two neighbouring cards met exactly, which is the overlap that got
       * reported. Corner art is positioned to fit, never scaled to fit, and it
       * has to sit inside the corner rather than on it.
       */
      /*
       * **The border is the decoration**: a tick at each corner and a fine
       * line inside the edge, in the rarity's colour. The corner bracket art
       * was 32 px a corner and took every corner of the card, so the tags and
       * the price had nowhere to sit that was not on top of it.
       */
      const deco = this.add.graphics().setDepth(201);
      const decoRect = { x: x - CARD_W / 2, y: top, w: CARD_W, h: cardH };

      // A 16 px icon at exactly 2x; the kind art is 64 px smooth and scales as before.
      const crisp = iconFrame.startsWith("icon_");
      const icon = this.add.image(
        x, top + PAD + ICON_PX / 2, crisp ? this.crispTextureKey : this.uiTextureKey, iconFrame,
      ).setOrigin(0.5).setDepth(202);
      if (crisp) icon.setScale(2);
      else icon.setDisplaySize(ICON_PX, ICON_PX);
      const left = x - CARD_W / 2 + PAD;
      name.setPosition(left, top + PAD + ICON_PX + 6);
      stats.setPosition(left, top + PAD + ICON_PX + 6 + nameH + 2);
      body.setPosition(left, top + bodyTop);
      /*
       * **The price, as a coin and a number in the bottom-right corner**, on
       * a dark chip over the bracket. It was the first words of the numbers
       * line — "30 gold casts again a beat later" — where it read as part of
       * what the card does. Red when it cannot be afforded.
       */
      const extras: Phaser.GameObjects.GameObject[] = [];
      if (this.shopping) {
        const price = SHOP_PRICE[card.kind] ?? 0;
        const afford = this.goldHeld() >= price;
        // Inside the corner tick, clear of it.
        const px = x + CARD_W / 2 - 11;
        const py = top + cardH - 13;
        const label = this.add.text(px, py, String(price), {
          fontFamily: "monospace", fontSize: `${Math.round(9 * ZOOM)}px`, color: afford ? "#ffd45e" : "#ff6a5a",
        }).setOrigin(1, 0.5).setScale(1 / ZOOM).setDepth(203);
        const chipW = label.width / ZOOM + 16;
        extras.push(this.add.rectangle(px + 3, py, chipW + 4, 13, 0x0d0b1f, 0.95).setOrigin(1, 0.5)
          .setStrokeStyle(1, afford ? 0x8a6a28 : 0x7a2a2a, 1).setDepth(202.6));
        extras.push(this.add.image(px - label.width / ZOOM - 7, py, this.uiTextureKey, "pickup_coin_0")
          .setOrigin(0.5).setDisplaySize(10, 10).setDepth(203));
        extras.push(label);
      }

      /*
       * **No number on the card.**
       *
       * The number row still works, and the hint at the foot of the screen
       * says so once. Printing 1, 2, 3 above each card put the *input* on the
       * thing being chosen, which is the wrong emphasis for a screen whose job
       * is comparing three items — the player reads the digits before they
       * read the names, and three big gold numerals are the loudest thing in
       * a layout where the loudest thing should be what the cards say.
       *
       * Kept as an object so the layout code has one shape; it draws nothing.
       */
      const key = this.add.text(x, top - 13, "", {
        fontFamily: "monospace", fontSize: `${Math.round(11 * ZOOM)}px`, color: "#ffe9a8",
      }).setOrigin(0.5).setScale(1 / ZOOM).setDepth(202).setVisible(false);
      /*
       * A click target as well as a key, because a card screen that can only
       * be answered by the number row is a card screen that looks clickable
       * and is not — and the player's hand is on the mouse for aiming anyway.
       */
      const zone = this.add.zone(x, cy, CARD_W, cardH)
        .setOrigin(0.5).setDepth(203).setInteractive();
      zone.on("pointerdown", () => this.chooseReward(i));
      // Hovering says which card the click will take, the same job the key
      // number does for the keyboard.
      // Hovering moves the selection rather than drawing a second kind of
      // highlight, so the mouse and the keyboard cannot disagree about which
      // card is the current one.
      zone.on("pointerover", () => {
        if (this.offerUi) { this.offerUi.selected = i; this.paintSelection(); }
      });
      /*
       * The kind, named, in its own colour, above the icon.
       *
       * A spell card and an affix card were the same panel with a different
       * small picture on it, and a player who has not memorised twenty icons
       * could not tell which of the two they were being offered — which is the
       * one thing the card has to say before anything else, because it is the
       * difference between a new key and a change to an existing one.
       */
      /*
       * A spell the player already holds is an **upgrade**, and says so the
       * way a different kind would: its own tag and a gold frame. Drawn like
       * any other spell card it was taken for a new spell, and taking it
       * seemed to do nothing, because no new key appeared.
       */
      const upgrade = this.isUpgradeCard(card);
      /*
       * **Rarity** is the grade, said by the card itself: its frame, its
       * ground and a small label in the top-right corner. It was "tier III"
       * in the numbers line, which the eye read as one more number.
       */
      const rarity = RARITY_STYLE[rarityOf(card.grade)];
      // Both tags sit inside the top corners, just past the corner ticks and
      // either side of the icon: the border is thin enough to leave room.
      const tagY = top + 10;
      const rarityLabel = this.add.text(x + CARD_W / 2 - 8, tagY, rarity.label, {
        fontFamily: "monospace", fontSize: `${Math.round(6 * ZOOM)}px`, color: rarity.text,
      }).setOrigin(1, 0.5).setScale(1 / ZOOM).setDepth(202.6);
      // The kind top-left, the rarity top-right: one corner each.
      const kindTag = this.add.text(x - CARD_W / 2 + 8, tagY, upgrade ? "UPGRADE" : KIND_TAG[card.kind].label, {
        fontFamily: "monospace", fontSize: `${Math.round(7 * ZOOM)}px`, color: upgrade ? "#ffd45e" : KIND_TAG[card.kind].color,
      }).setOrigin(0, 0.5).setScale(1 / ZOOM).setDepth(202.5);
      extras.push(rarityLabel);
      return { card, panel, deco, decoRect, icon, name, stats, body, key, zone, kindTag, extras };
    });

    // Above the tallest card, so the heading never sits on top of one.
    heading.setY(top - 30);
    // Under the row, quiet: it is instruction, not content.
    hint.setY(top + cardH + 18);

    this.offerUi = { dim, heading, hint, cards: built, selected: 0 };
    this.paintSelection();
    this.sfx.play("clear");
  }

  private hideRewards(): void {
    if (!this.offerUi) return;
    this.offerUi.dim.destroy();
    this.offerUi.heading.destroy();
    this.offerUi.hint.destroy();
    for (const c of this.offerUi.cards) {
      c.panel.destroy();
      c.deco.destroy();
      c.icon.destroy(); c.name.destroy(); c.stats.destroy();
      c.body.destroy(); c.key.destroy(); c.zone.destroy(); c.kindTag.destroy();
      for (const o of c.extras) o.destroy();
    }
    this.offerUi = null;
  }

  /**
   * "Replace which spell?" — the step between choosing a spell card on a full
   * staff and putting it on a key.
   *
   * The staff used to refuse: "(staff full)" on the HUD and the card lost. Doc
   * 003 wants a full staff to open the editor with a mandatory discard, and
   * this is that discard in its smallest honest form — the three spells the
   * player holds, on the keys they are held on, and one press to say which
   * goes. Escape keeps the old staff and returns to the cards.
   */
  /**
   * The replace step **is the staff screen**, with the new spell in hand: the
   * three spells down the left with their affixes, the chosen one's full card
   * on the right, and Enter puts the new spell on that key. It was a bare list
   * of three names, which asked the player to give up a spell without showing
   * them what it did or what was attached to it.
   */
  private showReplace(card: OfferCard): void {
    this.showStaff("replace", card);
  }

  /**
   * The staff screen, after Astral Ascent's inventory: the spells down the
   * left, the chosen one's card on the right — what it does, what it costs,
   * and its three affix slots, filled or empty. In `view` mode Enter picks a
   * spell up and Enter on another swaps their keys, which is how the order is
   * changed; in `attach` mode the screen is the question "which spell takes
   * this affix", and Enter answers it. Escape closes; in attach mode it puts
   * the affix card back on the table.
   */
  private showStaff(mode: "view" | "attach" | "replace" | "smith", card: OfferCard | null): void {
    this.staffFromPause = false;
    this.hideRewards();
    this.hideStaff();
    this.staffUi = { mode, card, selected: this.firstEligibleSpell(card), swapFrom: null, objects: [] };
    this.renderStaff();
  }

  private hideStaff(): void {
    if (!this.staffUi) return;
    for (const o of this.staffUi.objects) o.destroy();
    this.staffUi = null;
  }

  /** Whether the affix in hand can go on this spell: a free slot, or already held. */
  private canTakeAffix(slot: SpellSlot | null, affixId: string | undefined): boolean {
    if (!slot || !affixId) return false;
    // The affix has to do something on this shape of spell: a chain needs a
    // projectile to jump from, a shatter needs one that meets a wall. A full
    // spell can still take it, by giving one up.
    const def = spellAffixById(affixId);
    return !(def && !affixFits(def, itemShape(ITEMS.get(slot.item.base))));
  }

  private firstEligibleSpell(card: OfferCard | null): number {
    if (!card) return 0;
    const at = this.world.spells.findIndex((s) => this.canTakeAffix(s ?? null, card.itemId));
    return at < 0 ? 0 : at;
  }

  private renderStaff(): void {
    const ui = this.staffUi;
    if (!ui) return;
    for (const o of ui.objects) o.destroy();
    ui.objects = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { ui.objects.push(o); return o; };
    const view = this.cameras.main.worldView;
    const cx = view.centerX;
    const cy = view.centerY;
    const text = (x: number, y: number, str: string, px: number, color: string, extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}) =>
      add(this.add.text(x, y, str, {
        fontFamily: "monospace", fontSize: `${Math.round(px * ZOOM)}px`, color, ...extra,
      }).setScale(1 / ZOOM).setDepth(211));

    /*
     * Full screen. The panel is the run's whole account of the player — the
     * spells and what is on them, the body and what the run has done to it,
     * the run itself — and it opens on the menu key, so it fills the view
     * rather than floating over a fight it has paused.
     */
    add(this.add.rectangle(cx, cy, view.width, view.height, 0x0d0b1f, 0.94).setDepth(210));
    const affix = ui.card?.itemId ? spellAffixById(ui.card.itemId) : null;
    const heading = ui.mode === "attach"
      ? `ATTACH ${(affix?.name ?? ui.card?.label ?? "").toUpperCase()} TO WHICH SPELL?`
      : ui.mode === "replace" ? `REPLACE WHICH SPELL WITH ${(ui.card?.label ?? "").toUpperCase()}?`
      : ui.mode === "smith" ? "THE BLACKSMITH: RAISE WHICH SPELL?"
      : ui.swapFrom !== null ? "SWAP WITH WHICH SPELL?" : "CHARACTER";
    const top = view.top + 14;
    text(cx, top, heading, 13, "#ffe9a8").setOrigin(0.5, 0);
    if (ui.mode === "attach" && affix) text(cx, top + 30, affixFitsLine(affix), 7, "#d9a5ff").setOrigin(0.5, 0);
    const runLine = `room ${this.roomIndex} · ${stageFor(this.roomIndex)}${this.elite ? " · elite" : ""}    gold ${this.runGold + this.world.gold}    seed ${this.runSeed}`;
    text(cx, top + 18, runLine, 7, "#8792b5").setOrigin(0.5, 0);
    add(this.add.rectangle(cx, top + 32, view.width - 40, 1, 0x2a2750, 1).setDepth(210.5));

    // Left column: the three keys.
    const leftX = cx - 200;
    const rowY = (i: number) => cy - 88 + i * 44;
    this.world.spells.forEach((slot, i) => {
      const on = i === ui.selected;
      const eligible = ui.mode !== "attach" || this.canTakeAffix(slot ?? null, ui.card?.itemId);
      const picked = ui.swapFrom === i;
      const panel = add(this.add.rectangle(leftX, rowY(i), 150, 38, on ? 0x221d46 : 0x161334, 0.96)
        .setStrokeStyle(on ? 2 : 1, picked ? 0x8fdcff : on ? 0xffe9a8 : 0x4a5480, 1).setDepth(210.5));
      if (!eligible) panel.setAlpha(0.55);
      text(leftX - 66, rowY(i), SPELL_KEYS[i] ?? "", 11, on ? "#ffe9a8" : "#8792b5").setOrigin(0, 0.5);
      if (slot) {
        const icon = `icon_${slot.item.base}`;
        if (this.atlas.has(icon))
          add(this.add.image(leftX - 44, rowY(i), this.crispTextureKey, icon).setOrigin(0.5).setScale(1).setDepth(211));
        text(leftX - 30, rowY(i) - 7, titleOfId(slot.item.base), 8, eligible ? "#e8e3d8" : "#6b6480").setOrigin(0, 0);
        const lv = this.spellLevels[i] ?? 1;
        text(leftX + 70, rowY(i) - 7, `Lv ${lv}`, 7, lv > 1 ? "#ffd45e" : "#6a7396").setOrigin(1, 0);
        const pips = `${"◆".repeat(slot.affixes.length)}${"◇".repeat(Math.max(0, AFFIX_SLOTS - slot.affixes.length))}`;
        text(leftX - 30, rowY(i) + 3, pips, 7, "#d9a5ff").setOrigin(0, 0);
      } else {
        text(leftX - 30, rowY(i), "empty", 8, "#5a5f7a").setOrigin(0, 0.5);
      }
    });

    /*
     * Attributes, under the spells: what the run has made of the body. The
     * modifiers are shown as the change they make, the resources as
     * `now/max`, and the stat cards taken are named, so a player can see
     * what "Fleet, Fleet, Vigour" added up to without doing the arithmetic.
     */
    const m = this.world.player.mods;
    const pct = (v: number) => `${v >= 1 ? "+" : ""}${Math.round((v - 1) * 100)}%`;
    const p = this.world.player;
    const attrs: [string, string][] = [
      ["health", `${Math.round(p.hearts * HP_PER_HEART)}/${(MAX_HEARTS + m.maxHearts) * HP_PER_HEART}`],
      ["mana", `${Math.floor(p.mana)}/${this.world.staff.mana_max}${m.manaMax !== 1 ? `  (${pct(m.manaMax)})` : ""}`],
      ["rage", `${Math.floor(p.rage)}/${m.rageMax} segments`],
      ["gold", `${this.runGold + this.world.gold}`],
      ["speed", pct(m.speed)], ["dash", `${pct(m.dashRange)} range, ${pct(m.dashCooldown)} cooldown`],
      ["sword", `${pct(m.swordDamage)} damage, ${pct(m.swordReach)} reach`],
      ["mercy frames", pct(m.invuln)], ["mana regen", pct(m.manaRegen)], ["mana per hit", pct(m.manaPerHit)],
    ];
    // The body, across the bottom: three columns of attribute lines.
    const bandY = cy + 56;
    add(this.add.rectangle(cx, bandY - 8, view.width - 40, 1, 0x2a2750, 1).setDepth(210.5));
    text(view.left + 20, bandY, "ATTRIBUTES", 8, "#8792b5").setOrigin(0, 0);
    const colW = (view.width - 40) / 3;
    attrs.forEach(([k, v], i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      text(view.left + 20 + col * colW, bandY + 14 + row * 11, k, 7, "#8792b5").setOrigin(0, 0);
      text(view.left + 20 + col * colW + 78, bandY + 14 + row * 11, v, 7, "#e8e3d8").setOrigin(0, 0);
    });
    const takenY = bandY + 14 + Math.ceil(attrs.length / 3) * 11 + 4;

    text(view.left + 20, takenY, "UPGRADES TAKEN", 8, "#8792b5").setOrigin(0, 0);
    text(view.left + 20, takenY + 12,
      this.statsTaken.length > 0 ? this.statsTaken.map(titleOfId).join("  ·  ") : "none yet",
      7, this.statsTaken.length > 0 ? "#a8f0a0" : "#5a5f7a", { wordWrap: { width: (view.width - 40) * ZOOM } },
    ).setOrigin(0, 0);

    // Right panel: the selected spell's card.
    const rightX = cx + 70;
    const panelW = 250;
    // Top at cy - 128, bottom at cy + 44: above the attributes rule at cy + 48.
    add(this.add.rectangle(rightX, cy - 42, panelW, 172, 0x161334, 0.96)
      .setStrokeStyle(1, 0x4a5480, 0.9).setDepth(210.5));
    const slot = this.world.spells[ui.selected] ?? null;
    if (slot) {
      const def = ITEMS.get(slot.item.base);
      text(rightX, cy - 108, titleOfId(slot.item.base).toUpperCase(), 11, "#ffe9a8").setOrigin(0.5, 0);
      // The same numbers line the card showed: mana, damage per cast, what the shape does.
      const lvl = this.spellLevels[ui.selected] ?? 1;
      const school = schoolOf(slot.item.base);
      if (school)
        text(rightX - panelW / 2 + 10, cy - 117, school.toUpperCase(), 6, (SCHOOL_COLOUR as Record<string, string>)[school] ?? "#c9cfe8").setOrigin(0, 0.5);
      text(rightX + panelW / 2 - 10, cy - 117, `Lv ${lvl}${lvl > 1 ? `  +${Math.round((levelDamageMult(lvl) - 1) * 100)}% damage` : ""}`, 6, lvl > 1 ? "#ffd45e" : "#6a7396").setOrigin(1, 0.5);
      const leftX = rightX - panelW / 2 + 12;
      const row = this.statRow(def ? offerStatParts(def, lvl) : [{ text: `${slotCost(slot, ITEMS, this.world.staff)} mana`, tone: "mana" }], panelW - 24, 8, 211);
      row.box.setPosition(leftX, cy - 92);
      add(row.box);
      text(leftX, cy - 92 + row.height + 5, (def ? spellDetail(def) : ""), 7, "#c9cfe8", {
        align: "left", wordWrap: { width: (panelW - 24) * ZOOM },
      }).setOrigin(0, 0);
      // Three affix slots, as Astral Ascent lists gambits: filled, empty, or
      // — in attach mode — the one this card would fill.
      for (let k = 0; k < AFFIX_SLOTS; k++) {
        const y = cy - 30 + k * 22;
        const held = slot.affixes[k];
        const swapping = ui.mode === "attach" && ui.swapAffix === k;
        add(this.add.rectangle(rightX, y, panelW - 20, 19, swapping ? 0x3a1a22 : 0x0d0b1f, 0.9)
          .setStrokeStyle(swapping ? 2 : 1, swapping ? 0xff8877 : held ? 0x7a4fd6 : 0x2a2750, 1).setDepth(210.6));
        if (held) {
          const def2 = spellAffixById(held.id);
          const tier = def2?.tiers[held.tier - 1];
          const icon = `icon_affix_${held.id}`;
          if (this.atlas.has(icon))
            add(this.add.image(rightX - panelW / 2 + 20, y, this.crispTextureKey, icon).setOrigin(0.5).setScale(1).setDepth(211));
          // One line, centred in the row: the name, then what it does.
          // Named in its rarity's colour, as its card was.
          const nameT = text(rightX - panelW / 2 + 32, y, def2?.name ?? held.id, 7, RARITY_STYLE[rarityOf(held.tier)].text).setOrigin(0, 0.5);
          text(nameT.x + nameT.width / ZOOM + 6, y, tier?.text ?? "", 6, "#8792b5").setOrigin(0, 0.5);
        } else if (ui.mode === "attach" && affix && k === slot.affixes.length && !slot.affixes.some((a) => a.id === affix.id) && affixFits(affix, itemShape(ITEMS.get(slot.item.base)))) {
          text(rightX - panelW / 2 + 12, y, `▸ ${affix.name}: ${affix.tiers[0].text}`, 7, "#ffe9a8").setOrigin(0, 0.5);
        } else {
          text(rightX - panelW / 2 + 12, y, "empty", 7, "#3f4460").setOrigin(0, 0.5);
        }
      }
      if (ui.mode === "smith") {
        const price = SMITH_PRICE[lvl] ?? 0;
        text(rightX, cy + 36, lvl >= SPELL_LEVEL_MAX
          ? "at the highest level"
          : `Enter: raise to Lv ${lvl + 1} (+${Math.round((levelDamageMult(lvl + 1) - 1) * 100)}% damage) for ${price} gold · you have ${this.goldHeld()}`,
        7, lvl >= SPELL_LEVEL_MAX ? "#6a7396" : "#ffe9a8").setOrigin(0.5);
      }
      if (ui.mode === "replace" && ui.card) {
        const lost = slot.affixes.length
          ? `${slot.affixes.map((a) => spellAffixById(a.id)?.name ?? a.id).join(", ")} lost with it`
          : "no affixes to lose";
        ui.objects.push(this.keys_(rightX, cy + 36, `[Enter] ${ui.card.label} takes this key · ${lost}`, 7, "#ffe9a8", 211));
      }
      if (ui.mode === "attach" && affix) {
        const heldAlready = slot.affixes.find((a) => a.id === affix.id);
        const shape = itemShape(ITEMS.get(slot.item.base));
        if (!affixFits(affix, shape))
          text(rightX, cy + 36, `does not fit: needs a ${affix.shapes.join(" or ")} spell, this one is a ${shape}`, 7, "#ff8877").setOrigin(0.5);
        else if (heldAlready)
          text(rightX, cy + 36, `already held: raises to tier ${Math.min(3, heldAlready.tier + 1)}`, 7, "#ffe9a8").setOrigin(0.5);
        else if (slot.affixes.length >= AFFIX_SLOTS)
          text(rightX, cy + 36, ui.swapAffix !== null && ui.swapAffix !== undefined
            ? `choose the affix to give up · it is lost`
            : "full: choose which affix it replaces", 7, "#ffb080").setOrigin(0.5);
      }
    } else {
      text(rightX, cy - 32, "an empty key", 8, "#5a5f7a").setOrigin(0.5);
    }

    const hint = ui.mode === "attach"
      ? "[W][S] choose     [Enter] attach     [Esc] back to the cards"
      : ui.mode === "replace"
        ? `[W][S] choose     [Enter] replace (the old spell drops)     [X] dismantle this one (+${this.floorPending?.value ?? dismantleValue(ui.card?.grade ?? 1)} gold)     [Esc] back`
        : ui.mode === "smith"
          ? "[W][S] choose     [Enter] raise the level     [Esc] close"
          : "[W][S] choose     [Enter] pick up / swap order     [Tab] or [Esc] close";
    ui.objects.push(this.keys_(cx, view.bottom - 16, hint, 8, "#8792b5", 211));
  }

  private readStaffKeys(): void {
    const ui = this.staffUi;
    if (!ui) return;
    const down = (key?: Phaser.Input.Keyboard.Key): boolean =>
      !!key && Phaser.Input.Keyboard.JustDown(key);
    const n = this.world.spells.length;
    let moved = false;

    // Choosing which affix a full spell gives up: W S move among its three.
    if (ui.swapAffix !== null && ui.swapAffix !== undefined) {
      if (down(this.keys.W) || down(this.keys.UP)) { ui.swapAffix = (ui.swapAffix + AFFIX_SLOTS - 1) % AFFIX_SLOTS; this.renderStaff(); }
      if (down(this.keys.S) || down(this.keys.DOWN)) { ui.swapAffix = (ui.swapAffix + 1) % AFFIX_SLOTS; this.renderStaff(); }
      if (down(this.keys.ESC)) { ui.swapAffix = null; this.renderStaff(); return; }
    } else {
    if (down(this.keys.W) || down(this.keys.UP)) { ui.selected = (ui.selected + n - 1) % n; moved = true; }
    if (down(this.keys.S) || down(this.keys.DOWN)) { ui.selected = (ui.selected + 1) % n; moved = true; }
    }
    for (let i = 0; i < n; i++)
      if (down(this.keys[["U", "I", "O"][i] ?? ""])) { ui.selected = i; moved = true; }

    if (down(this.keys.ESC) || ((ui.mode === "view" || ui.mode === "smith") && down(this.keys.TAB))) {
      this.shopPending = null;
      if (ui.mode === "replace" && this.floorPending) { this.floorPending = null; this.hideStaff(); return; }
      if (ui.mode === "replace") { this.hideStaff(); this.showRewards(); return; }
      const card = ui.card;
      this.hideStaff();
      if (ui.mode === "view" && this.staffFromPause) {
        this.staffFromPause = false;
        this.showPause();
        if (this.pauseUi) { this.pauseUi.selected = 1; this.renderPause(); }
        return;
      }
      if (ui.mode === "attach" && card) this.showRewards();
      return;
    }
    // The spell in hand may be taken apart instead of put on a key.
    if (ui.mode === "replace" && ui.card && this.floorPending && down(this.keys.X)) {
      const f = this.floorPending;
      this.floorPending = null;
      this.runGold += f.value;
      this.tookLabel = `${f.label} dismantled  +${f.value} gold`;
      this.tookMs = 1600;
      this.removeFloorSpell(f);
      this.hideStaff();
      this.sfx.play("pickup");
      return;
    }
    if (ui.mode === "replace" && ui.card && !this.shopping && down(this.keys.X)) {
      const value = dismantleValue(ui.card.grade ?? 1);
      this.runGold += value;
      this.tookLabel = `${ui.card.label} dismantled  +${value} gold`;
      this.tookMs = 1800;
      this.finishTake();
      return;
    }

    if (down(this.keys.ENTER) || down(this.keys.J) || down(this.keys.SPACE)) {
      if (ui.mode === "replace" && ui.card) {
        this.replaceSpell(ui.selected, ui.card);
        return;
      }
      if (ui.mode === "smith") {
        // The blacksmith: a level for gold, up to the cap.
        const i = ui.selected;
        const slot = this.world.spells[i] ?? null;
        const level = this.spellLevels[i] ?? 1;
        const price = SMITH_PRICE[level] ?? 0;
        if (!slot || level >= SPELL_LEVEL_MAX) { this.sfx.play("hurt"); return; }
        if (this.goldHeld() < price) { this.tookLabel = `need ${price} gold`; this.tookMs = 1400; this.sfx.play("hurt"); return; }
        this.runGold -= price;
        this.spellLevels[i] = level + 1;
        this.world.spells[i] = withLevel(slot, level + 1);
        this.tookLabel = `${titleOfId(slot.item.base)} to Lv ${level + 1}`;
        this.tookMs = 1600;
        this.sfx.play("pickup");
        this.renderStaff();
        return;
      }
      if (ui.mode === "attach" && ui.card) {
        const at = ui.selected;
        const slot = this.world.spells[at] ?? null;
        if (!this.canTakeAffix(slot, ui.card.itemId) || !slot || !ui.card.itemId) { this.sfx.play("hurt"); return; }
        const full = !slot.affixes.some((a) => a.id === ui.card!.itemId) && slot.affixes.length >= AFFIX_SLOTS;
        // A full spell: first choose which affix goes (it is lost, not sold).
        if (full && (ui.swapAffix === null || ui.swapAffix === undefined)) { ui.swapAffix = 0; this.renderStaff(); return; }
        const next = full
          ? attachAffix(slot, ui.card.itemId, ui.card.grade ?? 1, slot.affixes[ui.swapAffix ?? 0]?.id)
          : attachAffix(slot, ui.card.itemId, ui.card.grade ?? 1);
        if (!next) return;
        this.world.spells[at] = next;
        this.spellAffixes[at] = next.affixes;
        this.owned.push(ui.card.itemId);
        const tier = next.affixes.find((a) => a.id === ui.card!.itemId)?.tier ?? 1;
        this.tookLabel = `${ui.card.label} on ${titleOfId(next.item.base)}${tier > 1 ? ` (tier ${tier})` : ""}`;
        this.tookMs = 1800;
        this.finishTake();
        return;
      }
      // View mode: pick up, then swap.
      if (ui.swapFrom === null) ui.swapFrom = ui.selected;
      else {
        this.swapSpells(ui.swapFrom, ui.selected);
        ui.swapFrom = null;
      }
      moved = true;
    }
    if (moved) this.renderStaff();
  }

  /** Puts the card's spell on key `i`, dropping what was there and its affixes. */
  private replaceSpell(i: number, card: OfferCard): void {
    if (!card.itemId) return;
    const old = this.world.spells[i] ?? null;
    const oldLevel = this.spellLevels[i] ?? 1;
    const oldAffixes = old ? [...old.affixes] : [];
    const oldValue = old ? dismantleValue(oldLevel, oldAffixes.map((a) => a.tier)) : 0;
    // A floor spell keeps what it had; a card's spell starts bare, at the card's level.
    const floor = this.floorPending;
    const fitted = this.equipAt(i, card.itemId, floor ? floor.level : card.grade ?? 1, floor ? floor.affixes : []);
    if (!fitted) { this.sfx.play("hurt"); return; }
    // The spell that came off the key lies on the floor, as it was.
    if (old) this.dropFloorSpell(old.item.base, oldValue, oldLevel, oldAffixes);
    this.tookLabel = `${card.label} on ${SPELL_KEYS[i]}`;
    this.tookMs = 1800;
    if (floor) {
      // Picked up off the floor: no reward was being answered.
      this.floorPending = null;
      this.removeFloorSpell(floor);
      this.hideStaff();
      this.sfx.play("pickup");
      return;
    }
    this.finishTake();
  }

  /**
   * Applies the card the player chose, and opens the exits.
   *
   * The simulation deliberately does not do this. Gold is banked on the run,
   * and an item goes into the staff — which means re-parsing the cast tree and
   * is a decision about the build, so it belongs to the thing that survives
   * the room. `answerOffer` only lifts the gate.
   */
  private chooseReward(index: number): void {
    const card = this.offerUi?.cards[index]?.card;
    if (!card) return;
    if (!this.shopping && !this.world.rewardPending) return;
    /*
     * In the merchant's room a card is **bought**, and an unaffordable one is
     * refused rather than hidden: showing the price and letting the player
     * press a card they cannot afford is how they learn what to save for. It
     * is charged when it lands — an affix or a spell still asks which spell
     * on the staff screen, and cancelling that must not cost anything.
     */
    if (this.shopping) {
      const price = SHOP_PRICE[card.kind] ?? 0;
      if (this.goldHeld() < price) {
        this.tookLabel = `need ${price} gold`;
        this.tookMs = 1400;
        return;
      }
      this.shopPending = card;
    }
    this.tookLabel = card.label;
    this.tookMs = 1800;

    if (card.kind === "gold") {
      this.runGold += GOLD_CARD_VALUE * (card.grade ?? 1);
    } else if (card.kind === "affix") {
      /*
       * Attached to **a named spell**, which is doc 013's whole point: "fork on
       * my homing bolt" is a plan, "fork" is a stat. The staff screen is where
       * that choice is the player's: it opens on the three spells with this
       * affix in hand, and the one they pick takes it. See `showStaff`.
       */
      this.showStaff("attach", card);
      return;
    } else if (card.kind === "stat") {
      /*
       * Applied to the **run's** modifiers, not to the player, because the
       * player is rebuilt every room and the upgrade is not. The heart bonus
       * is also granted immediately: an upgrade that raises the cap and leaves
       * the player at their old total reads as having done nothing.
       */
      // An elite door's stat is applied twice.
      for (let k = 0; k < Math.min(2, card.grade ?? 1); k++) {
        this.mods = applyStat(this.mods, card.itemId);
        this.statsTaken.push(card.itemId);
        if (card.itemId === "vigour") this.world.player.hearts += 1;
      }
      this.world.player.mods = { ...this.mods };
      // The run's new modifiers reach this room's live numbers too.
      if (card.itemId === "deep_well") {
        const base = runStaff().mana_max;
        this.world.staff = { ...this.world.staff, mana_max: Math.round(base * this.mods.manaMax) };
      }
    } else if (card.itemId && this.heldIndex(card.itemId) >= 0) {
      // A copy of a held spell raises it; at the cap it is paid out instead.
      const at = this.heldIndex(card.itemId);
      if (!this.upgradeHeld(at, card.grade ?? 1)) {
        const value = dismantleValue(card.grade ?? 1);
        this.runGold += value;
        this.tookLabel = `${card.label} is at Lv ${SPELL_LEVEL_MAX}: +${value} gold`;
        this.tookMs = 1800;
      }
    } else if (card.itemId) {
      /*
       * Into the first empty slot; on a full staff, the player says which
       * spell goes. See `showReplace`.
       */
      // "Full" means the three keys, not the slot array: the slots past the
      // third are not castable, and a spell put there would vanish.
      if (this.world.spells.every((x) => x !== null)) {
        this.showReplace(card);
        return;
      }
      this.owned.push(card.itemId);
      const free = this.world.slots.findIndex((x) => x === null);
      const fitted = equipItem(
        this.world, card.itemId, `${card.itemId}-${this.roomIndex}`, ITEMS,
      );
      // `equipItem` builds a new slot list on the world; the run has to take a
      // copy or the pickup is lost at the next portal.
      if (fitted) {
        this.slots = [...this.world.slots];
        this.spellLevels[free] = card.grade ?? 1;
        const slot = this.world.spells[free];
        if (slot) this.world.spells[free] = withLevel(slot, card.grade ?? 1);
      }
    }
    this.finishTake();
  }

  /** A reward has landed: pay for it if it was bought, close the screens, open the way on. */
  private finishTake(): void {
    const bought = this.shopPending;
    this.shopPending = null;
    if (bought && this.shopping) {
      this.runGold -= SHOP_PRICE[bought.kind] ?? 0;
      this.shopStock = this.shopStock.filter((c) => c !== bought);
    }
    this.hideRewards();
    this.hideStaff();
    if (!this.shopping) {
      this.destroyRewardDrop();
      answerOffer(this.world);
    }
    this.sfx.play("pickup");
  }

  /**
   * Portals and reward cards, once a frame.
   *
   * Replaces the old border-door update, which pulsed six type icons drawn
   * into the wall from a frame chosen by `roomIndex * 3 + side` — a number
   * with no relationship to anything, so the icons were **fabricated data**
   * presented as a choice. A portal's badge comes from the offer that actually
   * decided the next room.
   */
  private updateExits(): void {
    for (const { portal, body, badge, plate, tag } of this.portalGfx) {
      /*
       * A shut portal is not drawn at all.
       *
       * It was drawn dimmed, so the player could read the exits during the
       * fight. That put three badges over the arena while it mattered least
       * and made the raise a brightening rather than an arrival — and the
       * thing the raise has to say is *now there is a way out*, which is a
       * change of state and reads best against nothing.
       */
      const eliteMark = this.eliteMarks.find((m) => m.portal === portal)?.mark;
      if (!portal.open) {
        body.setVisible(false);
        plate.setVisible(false);
        badge.setVisible(false);
        eliteMark?.setVisible(false);
        tag?.setVisible(false);
        continue;
      }
      body.setVisible(true);
      plate.setVisible(true);
      badge.setVisible(true);
      eliteMark?.setVisible(true);
      tag?.setVisible(true);
      if (portal.open) {
        /*
         * Four frames of the open portal on a distance-free clock, and a rise.
         *
         * The rise is a scale from nothing rather than an alpha fade, because
         * the thing is described as coming *up* out of the floor and a fade
         * reads as appearing rather than as arriving.
         */
        const rise = Math.min(1, portal.riseMs / PORTAL_RISE_MS);
        body.setFrame(`prop_portal_open_${((this.world.tick >> 3) & 3)}`);
        body.setScale((1 / ART_SCALE) * (0.2 + 0.8 * rise));
        body.setAlpha(1);
        plate.setAlpha(rise);
        badge.setAlpha(rise);
        eliteMark?.setAlpha(rise);
        tag?.setAlpha(rise);
        badge.clearTint();
        plate.clearTint();
      }
    }

    /*
     * The prompt, on the portal in reach.
     *
     * One prompt, never two: the portals are placed far enough apart that two
     * interact circles cannot overlap, and `portalInReach` returns the nearest
     * — so the prompt is also the answer to "which one will the key take",
     * which is the question a player standing between two of them has.
     *
     * A prompt is not optional once the interaction is keyed. Proximity is
     * self-explanatory and a keypress is not: without it a portal reads as
     * broken, which is exactly how it looked before the key existed.
     */
    const drop = this.world.rewardDrop;
    if (drop && this.rewardGfx) {
      const rise = Math.min(1, drop.riseMs / REWARD_RISE_MS);
      const float = Math.sin(drop.riseMs / 420) * 2.5;
      // Rising out of the floor rather than fading in: it is described as
      // arriving, and a fade reads as having been there all along.
      this.rewardGfx.body.setY(drop.y - 8 * rise + float);
      this.rewardGfx.body.setScale((1 / ART_SCALE) * (0.4 + 0.6 * rise));
      this.rewardGfx.glow.setY(this.rewardGfx.body.y);
      this.rewardGfx.glow.setScale(this.rewardGfx.body.scaleX);
      this.rewardGfx.badge?.setY(this.rewardGfx.body.y - 14).setAlpha(rise);
      // The beam breathes, so a landmark the player has walked past twice is
      // still saying something.
      this.rewardGfx.glow.setAlpha(rise * (0.22 + 0.16 * Math.sin(drop.riseMs / 300)));
      /*
       * The column brightens as it rises and then breathes. Alphas are low
       * because they are *additive* and they stack: the three together are
       * what makes a core, and any one of them at a readable opacity on its
       * own would be a white bar.
       */
      const pulse = 0.82 + 0.18 * Math.sin(drop.riseMs / 520);
      this.drawRewardBeam(drop.x, this.rewardGfx.body.y, rise * pulse, drop.riseMs);
    }

    /*
     * One prompt, on whichever thing is in reach.
     *
     * The reward and the portals never coexist — the portals are gated on the
     * offer being answered, and answering it removes the reward — so there is
     * no case where both want the prompt.
     */
    const near = portalInReach(this.world.portals, this.world.player);
    const pl = this.world.player;
    const spellNear = this.floorSpells.find((f) => Math.hypot(f.x - pl.x, f.y - pl.y) <= 22);
    const npcNear = this.npcs.find((n) => Math.hypot(n.x - pl.x, n.y - pl.y) <= 34);
    for (const f of this.floorSpells) f.glow.setAlpha(0.14 + 0.1 * Math.sin(this.world.tick / 12));
    for (const n of this.npcs) {
      n.img.setFrame(safeFrame(this.atlas, `${n.kind === "merchant" ? "prop_merchant" : "prop_blacksmith"}_${(this.world.tick >> 5) & 1}`, "prop_shop_0"));
      n.badge?.setY(n.y - 44 + Math.sin(this.world.tick / 18) * 2);
      n.glow.setAlpha(0.22 + 0.08 * Math.sin(this.world.tick / 24));
    }
    if (spellNear && !this.offerUi && !this.staffUi) {
      /*
       * **Tap to pick up, hold to dismantle.** A dropped spell is a choice
       * between two things, and the destructive one is the hold: a tap that
       * turned a levelled, affixed spell into gold was a mistake one frame
       * wide.
       */
      const e = this.keys.E;
      this.interactPressed = false;
      const dt = this.game.loop.delta;
      /*
       * A tap is a press released within `FLOOR_TAP_MS`; only a press held
       * past it starts filling the bar, and a bar let go drains back rather
       * than snapping to nothing — so a hold abandoned halfway is seen to be
       * abandoned, and a second hold picks up where it is.
       */
      if (e?.isDown && !this.floorHoldSpent) {
        this.floorPressMs += dt;
        if (this.floorPressMs > FLOOR_TAP_MS) this.floorHoldMs += dt;
        if (this.floorHoldMs >= FLOOR_HOLD_MS) {
          this.floorHoldSpent = true;
          this.runGold += spellNear.value;
          this.tookLabel = `${spellNear.label} dismantled  +${spellNear.value} gold`;
          this.tookMs = 1600;
          this.burst(spellNear.x, spellNear.y, 0xffd45e, 12, 160, undefined, Math.PI * 2, 1, -40);
          this.removeFloorSpell(spellNear);
          this.sfx.play("pickup");
          this.floorHoldMs = 0;
          this.holdGfx.clear();
          return;
        }
      } else if (!e?.isDown) {
        if (this.floorPressMs > 0 && this.floorPressMs <= FLOOR_TAP_MS && !this.floorHoldSpent) this.pickFloorSpell(spellNear);
        this.floorPressMs = 0;
        this.floorHoldSpent = false;
        this.floorHoldMs = Math.max(0, this.floorHoldMs - dt * 1.5);
      }
      const held = this.heldIndex(spellNear.itemId);
      const tap = held >= 0 ? `level up your ${spellNear.label}` : `pick up ${spellNear.label}${spellNear.level > 1 ? ` Lv ${spellNear.level}` : ""}`;
      this.prompt.setVisible(true);
      this.prompt.setText(`[E] ${tap}    hold [E] dismantle +${spellNear.value} gold`);
      // The hold's bar, under the prompt: fills while held, drains when let go.
      this.holdGfx.clear();
      if (this.floorHoldMs > 0) {
        const W = 46;
        const bx = spellNear.x - W / 2;
        const by = spellNear.y - TILE_PX + 9;
        const k = Math.min(1, this.floorHoldMs / FLOOR_HOLD_MS);
        this.holdGfx.fillStyle(0x0d0b1f, 0.9);
        this.holdGfx.fillRect(bx - 1, by - 1, W + 2, 5);
        this.holdGfx.fillStyle(e?.isDown ? 0xffd45e : 0x9a7a3a, 1);
        this.holdGfx.fillRect(bx, by, W * k, 3);
      }
      this.prompt.setPosition(spellNear.x, spellNear.y - TILE_PX);
      return;
    }
    // Away from any floor spell: the bar drains and the press is forgotten.
    if (!this.keys.E?.isDown) { this.floorHoldSpent = false; this.floorPressMs = 0; }
    this.floorHoldMs = Math.max(0, this.floorHoldMs - this.game.loop.delta * 1.5);
    this.holdGfx.clear();
    if (npcNear && !this.offerUi && !this.staffUi) {
      this.prompt.setVisible(true);
      this.prompt.setText(npcNear.kind === "merchant"
        ? (this.shopStock.length > 0 ? "[E] merchant" : "sold out")
        : "[E] blacksmith: raise a spell's level");
      this.prompt.setPosition(npcNear.x, npcNear.y - TILE_PX * 1.3);
      if (this.interactPressed) {
        this.interactPressed = false;
        if (npcNear.kind === "merchant") { if (this.shopStock.length > 0) this.showRewards(); }
        else this.showStaff("smith", null);
      }
      return;
    }
    if (drop && rewardInReach(drop, this.world.player)) {
      this.prompt.setVisible(true);
      this.prompt.setText("[E] open");
      this.prompt.setPosition(drop.x, drop.y - TILE_PX * 2.1);
    } else if (near) {
      this.prompt.setVisible(true);
      const what = near.npc ? (near.npc === "merchant" ? "the merchant" : "the blacksmith")
        : near.school ? `${near.school} spell` : near.family ? `${near.family} stat` : near.reward;
      this.prompt.setText(`[E] ${near.elite ? "ELITE " : ""}${what}${(near.grade ?? 1) > 1 ? ` ${"★".repeat((near.grade ?? 1) - 1)}` : ""}`);
      this.prompt.setPosition(near.x, near.y - TILE_PX * 1.75);
    } else {
      this.prompt.setVisible(false);
    }

    // Opening the offer is the interact key, like every other world object.
    if (this.interactPressed && !this.offerUi && rewardInReach(drop, this.world.player)) {
      this.showRewards();
      // Consumed here, so the same press cannot also walk into a portal.
      this.interactPressed = false;
    }
  }

  /**
   * Answers the offer screen: move with the direction keys, confirm with
   * Enter or the attack key, or click, or press a number.
   *
   * Four ways in because the screen interrupts a fight, and the player's hands
   * are wherever the fight left them. The direction keys and the attack key
   * are the ones already under their fingers; Enter is the convention; the
   * numbers are the fastest once the screen is familiar; the mouse is there
   * because the cards look clickable.
   *
   * **`chooseReward` destroys `offerUi`**, so nothing here may keep reading it
   * after calling one. The first version looped `for (i < this.offerUi.cards.length)`
   * and called `chooseReward` inside the loop, which crashed on the next
   * iteration — a real crash, reachable by pressing two number keys on the
   * same frame.
   */
  private readOfferKeys(): void {
    const ui = this.offerUi;
    if (!ui) return;
    const k = this.keys;
    const down = (key?: Phaser.Input.Keyboard.Key): boolean =>
      !!key && Phaser.Input.Keyboard.JustDown(key);

    const count = ui.cards.length;
    if (this.shopping && down(k.ESC)) { this.hideRewards(); return; }
    /*
     * Dismantling: a spell card may be taken apart for gold instead of taken,
     * so a room whose three spells are all wrong for the build is not a room
     * that forces one onto a key.
     */
    if (!this.shopping && down(k.X)) {
      const c = ui.cards[ui.selected]?.card;
      if (c?.kind === "spell") {
        const value = dismantleValue(c.grade ?? 1);
        this.runGold += value;
        this.tookLabel = `${c.label} dismantled  +${value} gold`;
        this.tookMs = 1800;
        this.finishTake();
        return;
      }
    }
    if (down(k.A) || down(k.LEFT)) ui.selected = (ui.selected + count - 1) % count;
    if (down(k.D) || down(k.RIGHT)) ui.selected = (ui.selected + 1) % count;

    // One decision per frame: the index is read before anything can invalidate
    // the screen it indexes into.
    let pick = -1;
    for (let i = 0; i < count; i++)
      if (down(k[["ONE", "TWO", "THREE"][i] ?? ""])) { pick = i; break; }
    if (pick < 0 && (down(k.ENTER) || down(k.J) || down(k.SPACE))) pick = ui.selected;

    this.paintSelection();
    if (pick >= 0) this.chooseReward(pick);
  }

  /** The highlight, which is the only thing that says what Enter will take. */
  private paintSelection(): void {
    const ui = this.offerUi;
    if (!ui) return;
    ui.cards.forEach((c, i) => {
      const on = i === ui.selected;
      // The frame and the ground are the card's rarity; selection brightens them.
      const r = RARITY_STYLE[rarityOf(c.card.grade)];
      c.panel.setStrokeStyle(on ? 2 : 1, on ? r.strokeOn : r.stroke, 1);
      c.panel.setFillStyle(on ? r.fillOn : r.fill, 0.97);
      drawCardDeco(c.deco, c.decoRect, on ? r.strokeOn : r.corner);
    });
  }

  /**
   * Draws the swing as a **slender stroke along the blade's path**, not as a
   * crescent displaying the hitbox.
   *
   * Three earlier versions tried to draw the sector itself and all of them
   * looked wrong, for a reason that turned out to be geometric rather than a
   * bug. An 80 degree arc at a radius of 45 px is 63 px long and 26 px thick:
   * that is a stubby lozenge, not a crescent. The visual language of a sword
   * slash needs its length to dwarf its thickness, and 80 degrees at this
   * reach cannot provide that. The hitbox is correctly 80 degrees — it is
   * measured from A Link to the Past — so the visual is what has to change.
   *
   * And the reference had the answer all along: **ALttP has no crescent.** Its
   * swing is the sword sprite sweeping, and the glowing arc is a modern
   * addition. So the sword sprite carries the attack and this is an accent on
   * the blade's path: thin, bright, hugging the outer edge, gone quickly.
   *
   * Drawing narrower than the hitbox is allowed and deliberate. The rule is
   * that the hitbox may never be *narrower* than the visual, which is why
   * Enter the Gungeon extends a hitbox slightly behind the player relative to
   * what is drawn. Overstating is the failure; understating is free.
   */
  /**
   * The player's swing draws **no arc**. The sword is the swing.
   *
   * There was a procedural crescent here — a tapered band along the blade's
   * path, with a radius ramp, a fading tail and sparks — and every one of
   * those properties existed to solve one problem: there was no drawn sword,
   * so something had to say an attack was happening. A weapon layer arrived
   * and the crescent became a second, larger, differently-shaped sword swung
   * alongside the real one. That is what it looked like.
   *
   * The reference had this answer from the start and it is worth restating
   * now that it applies: **A Link to the Past has no crescent.** Its swing is
   * the sword sprite sweeping. The glowing arc is a modern addition, and it is
   * the right addition when the weapon is not drawn.
   *
   * What replaces it is a **trail on the blade's own path**: a few segments
   * swept between where the drawn tip was a moment ago and where it is now,
   * thin, brief, and at the sword's real radius. That is motion blur on a
   * moving object rather than a second object.
   *
   * The radius is the point. The old crescent was drawn at `box.reach`, the
   * **hitbox** radius of one full tile, while the drawn blade reaches about
   * fifteen world pixels from the grip — so the arc was twice the length of
   * the sword that was supposedly making it, detached from the steel, in front
   * of a body it did not touch. It was not too *bright*, it was the wrong
   * size, and that is why it read as a weapon of its own.
   *
   * `crescent.ts` stays, because enemy blades still use it — the arc there
   * marks the *threatened area* of a telegraphed attack, which is a different
   * job from showing that something moved.
   */
  /** Throws `n` sparks from a point: along `dir` within `spread`, or all round. */
  private burst(
    x: number, y: number, colour: number, n: number, speed: number,
    dir?: number, spread = Math.PI * 2, size = 1, gravity = 0,
  ): void {
    if (this.fxSparks.length > 380) this.fxSparks.splice(0, this.fxSparks.length - 380);
    for (let i = 0; i < n; i++) {
      const a = dir === undefined ? Math.random() * Math.PI * 2 : dir + (Math.random() - 0.5) * spread;
      const v = speed * (0.45 + Math.random() * 0.75);
      const life = 180 + Math.random() * 200;
      this.fxSparks.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ms: 0, life,
        size: size * (1.3 + Math.random() * 0.9), colour, gravity,
      });
    }
  }

  /** Takes one particle a projectile threw off, within the pool's cap. */
  private shed(sp: FxSpark): void {
    if (this.fxSparks.length >= 420) return;
    this.fxSparks.push(sp);
  }

  /** A ring that expands from `r0` to `r1` over `life` ms and thins as it goes. */
  private ring(x: number, y: number, r0: number, r1: number, colour: number, life: number, width: number): void {
    this.fxRings.push({ x, y, ms: 0, life, r0, r1, colour, width });
  }

  /**
   * Sparks, slash marks and rings, advanced on the frame clock and drawn
   * additively. A spark is a **streak** along its velocity, long while fast
   * and a dot as it slows, which is what makes it read as thrown rather than
   * as confetti.
   */
  private drawFx(delta: number): void {
    const g = this.sparkGfx;
    g.clear();
    const dt = Math.min(delta, 50) / 1000;
    if (this.ramSkidMs > 0) {
      this.ramSkidMs -= delta;
      const p = this.world.player;
      for (let i = 0; i < 2; i++)
        this.shed({
          x: p.x + (Math.random() - 0.5) * 6, y: p.y + 5, vx: -Math.cos(this.ramSkidDir) * 30 + (Math.random() - 0.5) * 30,
          vy: -Math.sin(this.ramSkidDir) * 30 - Math.random() * 25, ms: 0, life: 320 + Math.random() * 200,
          size: 1.4 + Math.random(), colour: 0x8a7a68, gravity: 40,
        });
    }
    for (const sp of this.fxSparks) {
      sp.ms += delta;
      const drag = Math.exp(-6 * dt);
      sp.vx *= drag;
      sp.vy = sp.vy * drag + sp.gravity * dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      const t = sp.ms / sp.life;
      if (t >= 1) continue;
      const k = 1 - t;
      const tail = 0.04;
      g.lineStyle(sp.size * (0.6 + 0.8 * k), sp.colour, 0.9 * k);
      g.lineBetween(sp.x - sp.vx * tail, sp.y - sp.vy * tail, sp.x, sp.y);
      g.fillStyle(0xffffff, 0.8 * k * k);
      g.fillCircle(sp.x, sp.y, sp.size * 0.55);
    }
    this.fxSparks = this.fxSparks.filter((sp) => sp.ms < sp.life);
    for (const sl of this.fxSlashes) {
      sl.ms += delta;
      const t = sl.ms / 150;
      if (t >= 1) continue;
      // Quick out: full length at once, then thinning and shortening.
      const len = sl.len * (1 - t * 0.5);
      const ux = Math.cos(sl.angle);
      const uy = Math.sin(sl.angle);
      g.lineStyle(3.2 * (1 - t), 0xcfeeff, 0.45 * (1 - t));
      g.lineBetween(sl.x - ux * len * 0.6, sl.y - uy * len * 0.6, sl.x + ux * len * 0.6, sl.y + uy * len * 0.6);
      g.lineStyle(1.2 * (1 - t) + 0.3, sl.colour, 0.95 * (1 - t));
      g.lineBetween(sl.x - ux * len * 0.5, sl.y - uy * len * 0.5, sl.x + ux * len * 0.5, sl.y + uy * len * 0.5);
    }
    this.fxSlashes = this.fxSlashes.filter((sl) => sl.ms < 150);
    for (const rg of this.fxRings) {
      rg.ms += delta;
      const t = rg.ms / rg.life;
      if (t >= 1) continue;
      const e = 1 - (1 - t) * (1 - t);
      const r = rg.r0 + (rg.r1 - rg.r0) * e;
      if (t < 0.25) {
        g.fillStyle(rg.colour, 0.28 * (1 - t / 0.25));
        g.fillCircle(rg.x, rg.y, r * 0.8);
      }
      g.lineStyle(Math.max(0.5, rg.width * (1 - t)), rg.colour, 0.8 * (1 - t));
      g.strokeCircle(rg.x, rg.y, r);
    }
    this.fxRings = this.fxRings.filter((rg) => rg.ms < rg.life);
  }

  /**
   * Where a sword swing is drawn: on the swing box itself, which the
   * simulation already centres on the body rather than the footing
   * (`SWING_ORIGIN_LIFT`). **A circle, not flattened**: the floor is drawn
   * square, so an ellipse made a sideways swing look narrower than its hitbox
   * and than an upward one. Kept as a hook for any later offset.
   */
  private slashFrame(): { dx: number; dy: number; lift: number; squash: number } {
    return { dx: 0, dy: 0, lift: 0, squash: 1 };
  }

  /**
   * **The magic blade**, after Elden Ring's Carian Slicer: a blade of light
   * that grows out of the sword only while it is swung, and is what makes a
   * one-tile sword reach 1.8. It starts at the steel's grip and ends where the
   * hitbox ends — the crescent's outer edge — so the range the player gets is
   * the blade they see, and a reach upgrade lengthens it.
   *
   * It gathers in the windup (short and faint, a shimmer along the steel),
   * is at full length and brightness through the active frames, and in the
   * recovery dissolves from the tip inward, shedding motes. Drawn additively
   * in three layers — a wide soft glow, a translucent body, a white core —
   * over a leaf-shaped outline that swells a third of the way up and draws to
   * a needle point.
   */
  private drawMagicBlade(): void {
    const g = this.magicGfx;
    g.clear();
    const w = this.world;
    const p = w.player;
    const phase = swingPhase(p);
    if (phase === "none") return;
    const box = w.swing;
    const angle = drawnBladeAngle(box, p, this.swordRestAngle);
    const f = this.slashFrame();
    const spinning = p.swingStretch > 1;
    // In the swing's drawn plane: raised and flattened like the crescent.
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle) * (spinning ? 1 : f.squash);
    const dl = Math.hypot(dirX, dirY) || 1;
    const ux = dirX / dl;
    const uy = dirY / dl;
    const nx = -uy;
    const ny = ux;
    const reach = spinning ? fullReach(box) : Math.max(box.reach, box.bladeReach);
    // From the grip to the reach. A swing's centre is the slash's; the spin's
    // grip is on the lifted body and its point on the floor ring.
    // Both on the swing's own centre, where the steel and the hitbox are.
    const ox = box.x + f.dx;
    const oy = box.y - f.lift + f.dy;
    const bx = ox + dirX * SWORD_HOVER_PX;
    const by = oy + dirY * SWORD_HOVER_PX;
    const tx = ox + dirX * reach;
    const ty = oy + dirY * reach;
    const full = Math.hypot(tx - bx, ty - by);
    const elapsed = swingElapsed(p);
    let grow = 1;
    let alpha = 1;
    let cut = 0;
    if (phase === "windup") {
      const t = Math.min(1, elapsed / SWING_WINDUP_MS);
      grow = 0.35 + 0.4 * t;
      alpha = 0.3 + 0.5 * t;
    } else if (phase === "recover") {
      const k = Math.max(0, p.swingMs / (SWING_RECOVER_MS * p.swingStretch));
      cut = 1 - k;
      alpha = 0.25 + 0.75 * k;
    }
    const len = full * grow * (1 - cut * 0.85);
    if (len < 2) return;
    const dx = (tx - bx) / full;
    const dy = (ty - by) / full;
    // Leaf profile: half-width along the blade, u from grip (0) to point (1).
    const half = (u: number, wmax: number) => {
      const swell = u < 0.32 ? 0.55 + 0.45 * (u / 0.32) : Math.pow(Math.max(0, (1 - u) / 0.68), 0.8);
      return wmax * swell;
    };
    const blade = (wmax: number, colour: number, a: number) => {
      const n = 10;
      const left: [number, number][] = [];
      const right: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const cx = bx + dx * len * u;
        const cy = by + dy * len * u;
        const h = half(u, wmax);
        left.push([cx + nx * h, cy + ny * h]);
        right.push([cx - nx * h, cy - ny * h]);
      }
      g.fillStyle(colour, a);
      g.beginPath();
      g.moveTo(left[0]![0], left[0]![1]);
      for (const [x, y] of left.slice(1)) g.lineTo(x, y);
      for (const [x, y] of right.reverse()) g.lineTo(x, y);
      g.closePath();
      g.fillPath();
    };
    // A slow shimmer, so the light is alive rather than a decal.
    const shimmer = 0.85 + 0.15 * Math.sin(w.tick / 3);
    blade(7, 0x2f63c8, 0.26 * alpha * shimmer);
    blade(4, 0x5aa0ff, 0.42 * alpha);
    blade(2.2, 0x9fd6ff, 0.45 * alpha);
    blade(0.8, 0xffffff, 0.8 * alpha);
    // The point's glint.
    const px = bx + dx * len;
    const py = by + dy * len;
    g.fillStyle(0xffffff, 0.9 * alpha);
    g.fillCircle(px, py, 1.3);
    g.fillStyle(0x8fd0ff, 0.35 * alpha * shimmer);
    g.fillCircle(px, py, 4.5);
    // Motes shed along the blade: a trickle while it is out, a shower as it goes.
    const shed = phase === "recover" ? 3 : phase === "active" ? 1 : 0;
    for (let i = 0; i < shed; i++) {
      const u = Math.random();
      this.fxSparks.push({
        x: bx + dx * len * u + nx * (Math.random() - 0.5) * 5,
        y: by + dy * len * u + ny * (Math.random() - 0.5) * 5,
        vx: nx * (Math.random() - 0.5) * 40 - ux * 10, vy: ny * (Math.random() - 0.5) * 40 - 18,
        ms: 0, life: 260 + Math.random() * 220, size: 0.9 + Math.random() * 0.6,
        colour: Math.random() < 0.5 ? 0xcfeeff : 0x7fb8ff, gravity: -20,
      });
    }
  }

  private drawSwing(): void {
    this.drawMagicBlade();
    this.swingGfx.clear();
    const box = this.world.swing;
    const phase = swingPhase(this.world.player);
    if (this.world.player.swingStretch > 1) { this.drawSpin(phase); return; }
    // Drawn through the recovery as well as the active window. Ending on the
    // last active frame made the crescent vanish in one frame, which reads as
    // a dropped sprite rather than as a swing finishing.
    if (phase !== "active" && phase !== "recover") return;

    // How far through the sweep, from the reach the crescent has spread to.
    const grown = box.spread > 0 ? (box.reach - box.bladeReach) / box.spread : 1;
    // Growing rather than appearing at full size: the first version was at
    // full thickness on its first frame, so the swing had no build at all.
    const width = SWING_MIN_WIDTH + (1 - SWING_MIN_WIDTH) * Math.min(1, grown);
    // Fading and thinning through the recovery.
    const fade = phase === "recover"
      ? Math.max(0, this.world.player.swingMs / (SWING_RECOVER_MS * this.world.player.swingStretch))
      : 1;
    /*
     * The tail is cut forward during the recovery, so the trail **shortens
     * from the back** instead of the whole band vanishing at once. Combined
     * with the per-segment alpha, the ground the blade has already passed
     * fades and then disappears, which is what a trail does.
     */
    const tailCut = phase === "recover" ? 1 - fade : 0;

    drawCrescent(this.swingGfx, box, { ...CRESCENT, width, fade, tailCut, ...this.slashFrame() });
  }

  /**
   * The spin, after *A Link to the Past*: a gathered charge, a full bright
   * ring, and a shower of sparks.
   *
   * The crescent renderer drew it as its 900-degree self, which was a thin
   * trail looping the body — technically the hitbox, and cheap. What ALttP
   * does is three beats: the sword goes **up** and flashes while sparks
   * gather on the blade; the body twirls inside a **complete ring** of light
   * with the blade's afterimages chasing it; and the ring bursts into sparks
   * as the twirl ends. None of that is the hitbox and all of it is what the
   * player remembers.
   */
  private drawSpin(phase: ReturnType<typeof swingPhase>): void {
    const w = this.world;
    const p = w.player;
    const box = w.swing;
    const g = this.swingGfx;
    // Centred where the hitbox is — the body's footing, like the crescent —
    // so the ring the player sees is the ring that cuts.
    const cx = box.x;
    const cy = box.y;
    const reach = fullReach(box);
    const elapsed = swingElapsed(p);
    if (phase === "windup") {
      // Sparks gathering on the raised blade: the charge.
      const t = Math.min(1, elapsed / SWING_WINDUP_MS);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + w.tick / 4;
        const r = 14 * (1 - t) + 3;
        g.fillStyle(i % 2 ? 0xffffff : 0xffe9a8, 0.9 * t);
        g.fillCircle(cx + Math.cos(a) * r, cy - 16 + Math.sin(a) * r * 0.5, 1.4 + t);
      }
      return;
    }
    if (phase === "active") {
      /*
       * A **band that follows the blade**, not a ring. The first version drew
       * a complete circle with the blade's afterimages as spokes from the
       * centre, and it read as a clock face. What ALttP's spin leaves behind
       * is a thick arc of light trailing the sword and fading toward its
       * tail — the sweep is *seen* as a sweep because the light is only where
       * the blade has just been.
       */
      const angle = box.angle;
      const trail = Math.PI * 1.15;
      const steps = 14;
      for (let i = 0; i < steps; i++) {
        const a1 = angle - box.sweep * (trail * i / steps);
        const a0 = angle - box.sweep * (trail * (i + 1) / steps);
        const k = 1 - i / steps;
        const lo = Math.min(a0, a1);
        const hi = Math.max(a0, a1);
        g.fillStyle(0xffe9a8, 0.28 * k);
        this.ringSlice(cx, cy, reach - 12 * k - 2, reach + 1, lo, hi);
        g.fillPath();
        g.fillStyle(0xffffff, 0.75 * k * k);
        this.ringSlice(cx, cy, reach - 4 * k - 1, reach - 0.5, lo, hi);
        g.fillPath();
      }
      // Sparks off the leading edge only.
      for (let i = 0; i < 4; i++) {
        const a = angle + box.sweep * (0.05 + i * 0.06);
        const r = reach + 3 + ((w.tick * 3 + i * 7) % 10);
        g.fillStyle(0xffffff, 0.85 - i * 0.18);
        g.fillCircle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.3);
      }
      return;
    }
    // Recovery: the band's tail lets go and sparks fly outward from the rim.
    const fade = Math.max(0, p.swingMs / (SWING_RECOVER_MS * p.swingStretch));
    const end = box.facing + box.sweep * ((box.sweepDeg / 2) * Math.PI / 180);
    const lo = Math.min(end, end - box.sweep * Math.PI * 0.6 * fade);
    const hi = Math.max(end, end - box.sweep * Math.PI * 0.6 * fade);
    g.fillStyle(0xffe9a8, 0.25 * fade);
    this.ringSlice(cx, cy, reach - 8 * fade, reach + 1, lo, hi);
    g.fillPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 10) * Math.PI * 2 + p.swingFacing;
      const r = reach + (1 - fade) * 26;
      g.fillStyle(i % 2 ? 0xffffff : 0xffe9a8, 0.9 * fade);
      g.fillCircle(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 1.2 + fade);
    }
  }

  /** A frame's delivered pixel height, for scaling geometry against art. */
  private frameHeight(name: string): number {
    const f = this.textures.getFrame(this.textureKey, name);
    return f && f.height > 0 ? f.height : 64;
  }

  /** An annular slice between two radii, from `a0` to `a1`. */
  private ringSlice(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, g: Phaser.GameObjects.Graphics = this.swingGfx): void {
    const steps = Math.max(4, Math.ceil(((a1 - a0) * 180) / Math.PI / 6));
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]);
    }
    for (let i = steps; i >= 0; i--) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0]);
    }
    g.moveTo(pts[0]![0], pts[0]![1]);
    for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
    g.closePath();
  }

  /**
   * Burning ground and lightning markers.
   *
   * Both procedural, and for the marker that is not a cost decision: a
   * marker's entire job is to state exactly which ground will be hit, and its
   * radius is a parameter an affix can change. A fixed-size sprite would
   * misstate the area the moment the radius moved, which is the same defect as
   * a crescent wider than its hitbox. It also has to animate on the countdown,
   * which two frames cannot do.
   *
   * The bolt itself is a sprite (`vfx_bolt_*`) because it is a fixed shape
   * that never varies, exactly like the impact burst, and because the marker
   * has already carried the information.
   */
  /**
   * The enemy's own attack, in two parts: the ground it is about to cover, and
   * the steel once it is live.
   *
   * This has to be drawn, not implied, because it is now the *only* way an
   * enemy hurts the player in melee. Contact damage needed no art — it applied
   * wherever a body was — and that was half of why it felt arbitrary. An
   * attack the player is expected to dodge has to be visible for the whole
   * window in which dodging works.
   *
   * The telegraph is the armed hitbox drawn at full sweep, so it cannot
   * misrepresent reach or arc: the shape shown is the shape tested. It tracks
   * the player through the windup and stops at the commit, which is exactly
   * the information the player needs — first "it is coming for me", then "it
   * is now committed *there*".
   */
  private drawEnemyBlades(): void {
    this.threatGfx.clear();
    this.bladeGfx.clear();
    this.drawMuzzles();
    /*
     * A death that bursts (`DeathBurst`): the spikes grow out of where the body
     * fell, quiver while they hang, and fly — the same sprites, slid along
     * their angles, as the lancer's own drive. A ring on the floor at the
     * spikes' reach tightens and brightens as the flight nears.
     */
    for (const d of this.world.deathBursts) {
      const elapsed = d.totalMs - d.ms;
      const grow = d.totalMs * d.growShare;
      const out = grow > 0 ? Math.min(1, elapsed / grow) : 1;
      const near = 1 - d.ms / d.totalMs;
      this.threatGfx.lineStyle(1.5, 0xff8877, 0.3 + 0.6 * near);
      this.threatGfx.strokeCircle(d.x, d.y, d.reach + 4 + 6 * (1 - near));
      const spike = d.kind === "lance" ? "vfx_spike_gold" : "vfx_spike_bone";
      const len = (16 / ART_SCALE) * 1.2;
      const r0 = 4;
      const quiver = out >= 1 ? 0.03 * Math.sin(this.world.tick * 1.3) : 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const r1 = r0 + (d.reach - r0) * out * (1 + quiver);
        const tip = Math.max(r0 + len * 0.5, r1);
        if (this.atlas.has(spike)) {
          const im = this.add.image(d.x + Math.cos(a) * (tip - len / 2), d.y - 2 + Math.sin(a) * (tip - len / 2), this.textureKey, spike)
            .setOrigin(0.5).setRotation(a).setScale(1.2 / ART_SCALE).setDepth(8);
          this.hazardMarks.push(im);
        } else {
          this.bladeGfx.lineStyle(1.6, d.kind === "lance" ? 0xffd24a : 0xf0ead8, 0.95);
          this.bladeGfx.lineBetween(d.x + Math.cos(a) * r0, d.y - 2 + Math.sin(a) * r0, d.x + Math.cos(a) * r1, d.y - 2 + Math.sin(a) * r1);
        }
      }
    }

    const w = this.world;
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.spawnFadeMs > 0) continue;
      if (e.archetype === "boss" && e.bossCast === "slam" && e.bossCastMs > 0) {
        /*
         * The slam's tell: a red ring growing out to where the shockwave
         * will pass, and the **safe circle** at its feet drawn in white —
         * the one attack whose answer is to come closer.
         */
        const t = 1 - e.bossCastMs / BOSS_SLAM_MS;
        this.threatGfx.lineStyle(2, 0xff5a4a, 0.4 + 0.5 * t);
        this.threatGfx.strokeCircle(e.x, e.y, BOSS_SLAM_SAFE_PX + 60 * t);
        this.threatGfx.fillStyle(0xff5a4a, 0.08 + 0.12 * t);
        this.threatGfx.fillCircle(e.x, e.y, BOSS_SLAM_SAFE_PX + 60 * t);
        this.threatGfx.lineStyle(1.5, 0xffffff, 0.8);
        this.threatGfx.strokeCircle(e.x, e.y, BOSS_SLAM_SAFE_PX);
      }
      if (e.archetype === "boss" && e.bossCast === "leap" && e.bossCastMs > 0) {
        // Where it comes down: a mark that fills, and a shadow that grows.
        const t = 1 - e.bossCastMs / BOSS_LEAP_MS;
        this.threatGfx.fillStyle(0x0d0b1f, 0.25 + 0.35 * t);
        this.threatGfx.fillEllipse(e.bossTargetX, e.bossTargetY + 6, BOSS_LEAP_RADIUS * 1.6 * t, BOSS_LEAP_RADIUS * 0.7 * t);
        this.threatGfx.lineStyle(2, 0xff5a4a, 0.5 + 0.5 * t);
        this.threatGfx.strokeCircle(e.bossTargetX, e.bossTargetY, BOSS_LEAP_RADIUS);
        this.threatGfx.fillStyle(0xff5a4a, 0.1 + 0.25 * t);
        this.threatGfx.fillCircle(e.bossTargetX, e.bossTargetY, BOSS_LEAP_RADIUS * t);
      }
      /*
       * The sentinel's tell is a **sight line**. It wears the turret's sheet
       * in green, and a green turret that then fires a ball instead of
       * calling lightning read as the turret misbehaving. Its threat is a
       * lane, so the lane is drawn: a thin line from the body through where
       * it last saw the player, brightening as the shot comes, and gone the
       * moment it fires. Step off the line and the shot is answered.
       */
      if (e.archetype === "sentinel" && e.telegraphMs > 0 && e.pending.length > 0) {
        const aim = seenPlayer(w, e);
        const d = Math.hypot(aim.x - e.x, aim.y - e.y) || 1;
        const ux = (aim.x - e.x) / d;
        const uy = (aim.y - e.y) / d;
        const t = 1 - Math.min(1, e.telegraphMs / 700);
        this.threatGfx.lineStyle(1, 0xff6a5a, 0.25 + 0.5 * t);
        this.threatGfx.lineBetween(e.x, e.y, e.x + ux * 420, e.y + uy * 420);
        this.threatGfx.fillStyle(0xff6a5a, 0.6 + 0.4 * t);
        this.threatGfx.fillCircle(aim.x, aim.y, 1.5 + t);
      }
      const box = e.swing;
      if (box.reach <= 0) continue;
      const sweep = (box.sweepDeg * Math.PI) / 180;

      if (e.attack === "windup" && (e.meleeKind === "bristle" || e.meleeKind === "lance")) {
        /*
         * A spike drive's tell is a **ring closing on the body**, not an area:
         * the spikes go everywhere, so a filled disc says nothing the shape
         * of the body does not, and it was reported as noise. The ring
         * contracts from beyond the reach to the body's edge over the windup,
         * so its size is the clock; its colour is the body's spikes.
         */
        const t = 1 - Math.max(0, e.attackMs) / (e.meleeKind === "lance" ? 400 : 320);
        const r = box.reach * 1.6 * (1 - t) + e.radius * 0.9 * t;
        this.threatGfx.lineStyle(1.5 + t, spikeColour(e), 0.35 + 0.6 * t);
        this.threatGfx.strokeCircle(e.x, e.y - 2, r);
      } else if (e.attack === "windup") {
        // Brightening as the commit approaches, so the tell has a clock in it
        // as well as a place.
        const t = 1 - e.attackMs / MELEE_WINDUP_MS;
        // A spin's threat is the whole ring; past a full turn the sector is a disc.
        const half = Math.min(Math.PI, Math.abs(sweep) / 2 + box.halfArc);
        const from = box.facing - half;
        const to = box.facing + half;
        /*
         * The threatened area is **drawn, not stamped**.
         *
         * `vfx_enemy_threat_wedge` was delivered for this and is not used, for
         * two reasons and only one of them is taste.
         *
         * The hard one: it is **magenta**, and magenta is the protected band
         * reserved for enemy bullets — excluded from the room's colour shift
         * precisely so that one thing always means "a projectile". A telegraph
         * in that colour tells the player a shot has been fired.
         *
         * The soft one: a wedge sprite has a fixed aspect and the threatened
         * area does not. The reach and the arc differ per archetype and the
         * sweep changes during the windup, so the sprite has to be stretched
         * on two axes — and a stretched drawing of a sector reads as a
         * cardboard triangle laid on the floor, which is what was reported.
         * A filled sector is generated, but it is generated *correctly*, and
         * it has a clock in it.
         */
        this.threatGfx.fillStyle(0xff5544, 0.14 + 0.28 * t);
        this.threatGfx.slice(e.x, e.y, box.reach, from, to, false);
        this.threatGfx.fillPath();
        /*
         * The outer edge, as a line.
         *
         * The fill alone was not readable: what the player needs from a
         * telegraph is not "danger is roughly here" but **where the edge is**,
         * because the decision is whether one step backwards is enough. A
         * gradient cannot answer that and a stroked boundary can, and it costs
         * one more path.
         */
        this.threatGfx.lineStyle(1.5, 0xff8877, 0.5 + 0.4 * t);
        this.threatGfx.beginPath();
        this.threatGfx.arc(e.x, e.y, box.reach, from, to, false);
        this.threatGfx.strokePath();
        // The tank's greatsword, raised: the tell for the chop is the blade
        // going up, and it comes down along the wedge below it.
        if (e.meleeKind === "cleave") this.drawGreatsword(e, box.facing, -Math.PI / 2 + Math.cos(box.facing) * 0.35, 0.8 + 0.2 * t);
      } else if ((box.active && (e.meleeKind === "bristle" || e.meleeKind === "lance")) || (e.meleeKind === "lance" && e.spikeMs > 0)) {
        /*
         * Eight spikes driven out at once, at the compass points: a tapered
         * stroke from the body to the reach with a bright tip, shot out over
         * the first frames and drawn back over the rest.
         */
        const g = this.bladeGfx;
        const t = 1 - Math.max(0, e.attackMs) / MELEE_LUNGE_MS;
        // The lancer's hang: spikes held at full length, quivering, until they go.
        const hanging = e.meleeKind === "lance" && e.spikeMs > 0;
        const out = hanging ? 1 + 0.03 * Math.sin(this.world.tick * 1.3)
          : e.meleeKind === "lance" ? Math.min(1, t / 0.35)
          : t < 0.35 ? t / 0.35 : 1 - ((t - 0.35) / 0.65) * 0.4;
        /*
         * Each spike is the delivered sprite, **slid** along its angle from its
         * stub to the reach — never stretched — so the spike that flies off a
         * lancer is visibly the one that was driven out.
         */
        const spike = e.archetype === "lancer" ? "vfx_spike_gold" : "vfx_spike_bone";
        const len = (16 / ART_SCALE) * 1.2;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const r0 = e.radius * 0.7;
          const r1 = r0 + (box.reach - r0) * out;
          const tip = Math.max(r0 + len * 0.5, r1);
          if (this.atlas.has(spike)) {
            const im = this.add.image(e.x + Math.cos(a) * (tip - len / 2), e.y - 2 + Math.sin(a) * (tip - len / 2), this.textureKey, spike)
              .setOrigin(0.5).setRotation(a).setScale(1.2 / ART_SCALE).setDepth(8);
            this.hazardMarks.push(im);
          } else {
            g.lineStyle(1.6, spikeColour(e), 0.95);
            g.lineBetween(e.x + Math.cos(a) * r0, e.y - 2 + Math.sin(a) * r0, e.x + Math.cos(a) * r1, e.y - 2 + Math.sin(a) * r1);
          }
        }
      } else if (box.active && e.meleeKind === "cleave") {
        // The chop landing: the blade along the facing, and a flash of ground
        // at its tip for the first frames.
        this.drawGreatsword(e, box.facing, box.facing, 1);
        const early = Math.max(0, e.attackMs / MELEE_LUNGE_MS - 0.5) * 2;
        if (early > 0) {
          this.bladeGfx.fillStyle(0xffffff, 0.35 * early);
          this.bladeGfx.slice(e.x, e.y, box.reach, box.facing - box.halfArc, box.facing + box.halfArc, false);
          this.bladeGfx.fillPath();
        }
      } else if (box.active) {
        /*
         * A drawn weapon only for a body that **swings** one.
         *
         * `weapon_enemy_tank` was delivered and is deliberately unused. The
         * tank's attack is a charge — it throws its shoulder forward, doc 013
         * replaced its sweep with a ram — so a blade appearing during the
         * commit is a weapon for an attack it no longer has. Drawn at the
         * body's centre with a centre origin, it read as a plank stuck through
         * its middle, which is what was reported.
         *
         * The rusher thrusts, so it gets its claw: pivoted at the grip and
         * pushed out to arm's length along the blade's own angle, the same two
         * corrections the player's sword needed.
         */
        // The lancer carries the rusher's claw drawn long: the lance is most
        // of its silhouette until its own sheet arrives.
        // Only a body that thrusts a blade gets one drawn; the spike drives draw their own.
        const weaponName = e.meleeKind === "thrust" ? "weapon_enemy_rusher" : null;
        if (weaponName && this.atlas.has(weaponName)) {
          const out = e.radius * 0.7;
          const weapon = this.add.image(
            e.x + Math.cos(box.angle) * out,
            e.y + Math.sin(box.angle) * out,
            this.textureKey, weaponName,
          ).setOrigin(ENEMY_WEAPON_GRIP_X / 64, 0.5)
            .setRotation(box.angle)
            .setScale((1 / ART_SCALE) * (e.archetype === "lancer" ? 1.7 : 1), 1 / ART_SCALE)
            .setDepth(8.8);
          if (e.archetype === "lancer") weapon.setTint(0xffd24a);
          this.hazardMarks.push(weapon);
        }
        /*
         * The same crescent the player's sword draws, in a hostile palette.
         *
         * It was a flat filled sector before — one `slice()` and one fill —
         * and it read as a debug overlay, which is what it was. Everything
         * that stopped the player's swing looking abstract is a property of an
         * arc attack rather than of the player: tapered ends, alpha falling off
         * behind the blade, a radius ramp, sparks, and a streak filling the
         * inner sector the hitbox also covers. Sharing the renderer means the
         * player learns one shape and it means *an arc is being swung here*,
         * whoever is swinging it, with colour carrying whose it is.
         */
        this.bladeGfx.fillStyle(0xffffff, 1);
        drawCrescent(this.bladeGfx, box, {
          ...CRESCENT,
          style: ENEMY_CRESCENT,
          // Clear of the body it belongs to, which is larger than the player's.
          bodyClearPx: e.radius * 0.8,
          width: 1,
          // Fading out over the back half of the commit, so the swing finishes
          // rather than being dropped.
          fade: Math.min(1, (e.attackMs / MELEE_LUNGE_MS) * 2),
          tailCut: 0,
        });
      }
    }
  }

  /**
   * The tank's greatsword, as a drawn blade: no sheet has one, and the claw
   * scaled up read as a plank. A thick pale stroke with a dark edge, from a
   * grip just off the body to `reach`; `angle` is where it points and
   * `facing` is where the body faces, which differ while it is raised.
   */
  private drawGreatsword(e: Enemy, facing: number, angle: number, alpha: number): void {
    const box = e.swing;
    const gx = e.x + Math.cos(facing) * e.radius * 0.4;
    const gy = e.y - 6 + Math.sin(facing) * e.radius * 0.4;
    // The delivered blade, pivoted at its grip and pointed along the swing.
    if (this.atlas.has("weapon_enemy_tank")) {
      const blade = this.add.image(gx, gy, this.textureKey, "weapon_enemy_tank")
        .setOrigin(ENEMY_WEAPON_GRIP_X / 64, 0.5).setRotation(angle)
        .setScale(1 / ART_SCALE).setAlpha(alpha).setDepth(8.8);
      this.hazardMarks.push(blade);
      return;
    }
    const len = box.reach * 0.95;
    const tx = gx + Math.cos(angle) * len;
    const ty = gy + Math.sin(angle) * len;
    this.bladeGfx.lineStyle(5, 0x2a2438, alpha);
    this.bladeGfx.lineBetween(gx, gy, tx, ty);
    this.bladeGfx.lineStyle(3, 0xd8d4e8, alpha);
    this.bladeGfx.lineBetween(gx, gy, tx, ty);
    // The crossguard.
    const px = Math.cos(angle + Math.PI / 2) * 4;
    const py = Math.sin(angle + Math.PI / 2) * 4;
    const hx = gx + Math.cos(angle) * 6;
    const hy = gy + Math.sin(angle) * 6;
    this.bladeGfx.lineStyle(2, 0xffd24a, alpha);
    this.bladeGfx.lineBetween(hx - px, hy - py, hx + px, hy + py);
  }

  /**
   * Destructibles, in the state their health says they are in.
   *
   * The sheet delivers three kinds by three states — intact, cracked, broken —
   * and the middle state is the one that earns its place: a pot that shows a
   * split before it goes tells the player their hit landed on scenery, which
   * is otherwise indistinguishable from having missed. Broken is drawn flat on
   * the floor and under everything, because by then it is a mark rather than
   * an object.
   */
  private drawProps(): void {
    const w = this.world;
    for (const p of w.props) {
      const state = propState(p);
      const frame = propFrame(p, state, w.tick);
      const standing = state !== "broken";
      const img = this.add.image(
        p.x, standing ? p.y + TILE_PX / 2 : p.y,
        this.textureKey, safeFrame(this.atlas, frame, "prop_break_crate_0"),
      )
        // Standing props share a one-cell footprint but may rise above it.
        // Anchor their frame bottom to the footprint's south edge; centring a
        // 128px column on the collision circle sinks half of it into the floor.
        .setOrigin(0.5, standing ? 1 : 0.5)
        // Shards sit under the bodies; a standing object sits among them, so
        // a pot in front of an enemy actually reads as being in front of it.
        .setDepth(state === "broken" ? 1 : 5)
        .setScale(1 / ART_SCALE);
      if (state === "broken") img.setAlpha(0.85);
      // A conjured pillar is the spell's colour, so it is not mistaken for the
      // room's own stone: the same cool light the player's bolts carry.
      if (p.kind === "pillar" && state !== "broken") img.setTint(0x9ad8ff).setAlpha(0.92);
      // A conjured pillar fades over its last second, so its going is seen coming.
      if (p.lifeMs !== undefined && p.hp > 0 && p.lifeMs < 1000) img.setAlpha(0.35 + 0.65 * (p.lifeMs / 1000));
      /*
       * Struck: squashed and brightened, not filled white.
       *
       * `setTintFill` replaces every pixel, so a hit crate became a solid
       * silhouette — and since nothing was decrementing the prop's flash
       * timer, it stayed one. Even working, a full white fill is the wrong
       * weight for scenery: the flash on a body says *that mattered*, and a
       * pot needs to say only *that landed*.
       */
      if (p.hitFlashMs > 0) {
        img.setScale((1 / ART_SCALE) * 1.1, (1 / ART_SCALE) * 0.92);
        img.setTint(0xffd9b0);
      }
      this.sprites.add(img);
    }
  }

  /**
   * The expansion's attack kinds (`attacks.ts`), from the delivered sheets:
   * rifts, mines, tethers, lobs, slow fields, the warden's disc, the delver's
   * mound and the ward aura on an armoured ally.
   *
   * Every telegraph reads as **drawn** (dim, still) or **live** (bright,
   * moving) by luminance and motion, never by hue, since the room's tint
   * shifts hue (research §3.1). Anything whose length varies is tiled from a
   * segment rather than stretched.
   */
  private drawExpansion(): void {
    const w = this.world;
    const tick = w.tick;
    const has = (n: string) => this.atlas.has(n);
    const img = (x: number, y: number, name: string, depth: number, scale = 1 / ART_SCALE) => {
      if (!has(name)) return null;
      const im = this.add.image(x, y, this.textureKey, name).setScale(scale).setDepth(depth);
      this.sprites.add(im);
      return im;
    };
    /** A segment sprite repeated along a line, each tile rotated to it. */
    const tile = (base: string, x0: number, y0: number, x1: number, y1: number, depth: number, alpha: number, frame: (i: number) => number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1) return;
      const a = Math.atan2(y1 - y0, x1 - x0);
      const seg = 64 / ART_SCALE;
      const n = Math.max(1, Math.ceil(len / seg));
      for (let i = 0; i < n; i++) {
        const along = Math.min(len, (i + 0.5) * seg);
        const im = img(x0 + Math.cos(a) * along, y0 + Math.sin(a) * along, `${base}_${frame(i)}`, depth);
        if (!im) return;
        im.setRotation(a).setAlpha(alpha);
        // The last tile is cut to the line's end rather than overshooting it.
        const left = len - i * seg;
        if (left < seg) im.setCrop(0, 0, (left / seg) * 64, 64).setX(x0 + Math.cos(a) * (i * seg + left / 2));
      }
    };

    for (const r of w.rifts) {
      const ex = r.x + Math.cos(r.angle) * r.length;
      const ey = r.y + Math.sin(r.angle) * r.length;
      if (r.length <= 0) {
        // A circle: the ground heaving under a closing ring, then the eruption.
        if (r.teleMs > 0) {
          const t = 1 - r.teleMs / r.teleMaxMs;
          this.threatGfx.lineStyle(1.5 + t * 1.5, 0xff5544, 0.35 + 0.55 * t);
          this.threatGfx.strokeCircle(r.x, r.y, r.width / 2 * (1.25 - 0.25 * t));
          this.threatGfx.fillStyle(0xff5544, 0.08 + 0.18 * t);
          this.threatGfx.fillCircle(r.x, r.y, r.width / 2);
        } else if (r.activeMs > 0) {
          const k = Math.min(2, Math.floor((1 - r.activeMs / 230) * 3));
          const ring = img(r.x, r.y, `vfx_emerge_ring_${k}`, 5.6);
          ring?.setDisplaySize(r.width * 1.3, r.width * 1.3);
        }
        continue;
      }
      if (r.teleMs > 0) {
        // Growing from the caster along its length: the crack has a direction.
        const t = 1 - r.teleMs / r.teleMaxMs;
        const grow = Math.min(1, t * 1.6);
        const stage = Math.min(3, Math.floor(t * 4));
        tile("vfx_rift_seg", r.x, r.y, r.x + (ex - r.x) * grow, r.y + (ey - r.y) * grow, 2.4, 0.55 + 0.35 * t, () => stage);
        img(r.x, r.y, `vfx_rift_cap_0`, 2.45)?.setRotation(r.angle + Math.PI).setAlpha(0.8);
        if (grow >= 1) img(ex, ey, `vfx_rift_cap_1`, 2.45)?.setRotation(r.angle).setAlpha(0.8);
      } else if (r.activeMs > 0) {
        const k = Math.min(2, Math.floor((1 - r.activeMs / 230) * 3));
        tile("vfx_rift_burst", r.x, r.y, ex, ey, 5.6, 1, () => k);
      } else {
        // The scar: dark and fading, no longer anything.
        tile("vfx_rift_seg", r.x, r.y, ex, ey, 2.3, 0.35 * Math.max(0, r.scarMs / 1500), () => 0);
      }
    }


    for (const m of w.mines) {
      if (m.burstMs > 0) {
        const k = Math.min(2, Math.floor((1 - m.burstMs / 300) * 3));
        img(m.x, m.y, `vfx_mine_burst_${k}`, 5.6)?.setDisplaySize(TILE_PX * 2.6, TILE_PX * 2.6);
      } else if (m.primeMs > 0) {
        // Set off: it swells and flashes fast, and the blast it is about to
        // make is drawn on the floor, so the way out is visible.
        const k = 1 - m.primeMs / MINE_PRIME_MS;
        img(m.x, m.y, `vfx_mine_armed_${(tick >> 1) & 3}`, 2.5)?.setScale((0.8 + 0.35 * k) / ART_SCALE)
          .setTint((tick >> 2) & 1 ? 0xffffff : 0xff5544);
        this.fxTopGfx.lineStyle(1.5, 0xff5544, 0.5 + 0.5 * k);
        this.fxTopGfx.strokeCircle(m.x, m.y, MINE_BLAST);
        this.fxTopGfx.fillStyle(0xff5544, 0.12 + 0.18 * k);
        this.fxTopGfx.fillCircle(m.x, m.y, MINE_BLAST);
      } else if (m.inertMs > 0) {
        img(m.x, m.y, `vfx_mine_seed_${(tick >> 4) & 1}`, 2.5)?.setScale(0.8 / ART_SCALE);
      } else {
        img(m.x, m.y, `vfx_mine_armed_${(tick >> 3) & 3}`, 2.5)?.setScale(0.8 / ART_SCALE);
      }
    }

    for (const t of w.tethers) {
      const ends = tetherEnds(w, t);
      if (!ends) continue;
      if (t.kind === "ward") {
        if (t.phase === "live") continue; // a peal's ward shows as the aura only
        tile("vfx_tether_seg", ends.x0, ends.y0 - 4, ends.x1, ends.y1 - 4, 5.7, 0.85, (i) => (i + (tick >> 4)) & 1);
        /*
         * Stood in, the line strains: a white stroke over it that jitters and
         * brightens as the cut fills, so the player sees that standing there
         * is doing something before the ring round them completes.
         */
        if (t.cutMs > 0) {
          const k = Math.min(1, t.cutMs / 330);
          const jx = (Math.random() - 0.5) * 3 * k;
          const jy = (Math.random() - 0.5) * 3 * k;
          this.fxTopGfx.lineStyle(1 + 2 * k, 0xffffff, 0.35 + 0.55 * k);
          this.fxTopGfx.lineBetween(ends.x0 + jx, ends.y0 - 4 + jy, ends.x1 - jx, ends.y1 - 4 - jy);
        }
        // The first ward of the run says what it is for.
        this.teach("ward", (ends.x0 + ends.x1) / 2, (ends.y0 + ends.y1) / 2 - 16);
        img(ends.x0, ends.y0 - 4, `vfx_tether_node_${(tick >> 3) % 3}`, 5.75)?.setScale(0.6 / ART_SCALE);
        img(ends.x1, ends.y1 - 4, `vfx_tether_node_${(tick >> 3) % 3}`, 5.75)?.setScale(0.6 / ART_SCALE);
        // The cut, as a ring filling round the player while they stand in it.
        if (t.cutMs > 0) {
          this.fxTopGfx.lineStyle(2, 0xd8f4ff, 0.8);
          this.fxTopGfx.beginPath();
          this.fxTopGfx.arc(w.player.x, w.player.y - 6, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, t.cutMs / 330));
          this.fxTopGfx.strokePath();
        }
      } else if (t.kind === "hook") {
        if (t.phase === "aim") {
          // The chain laid on the floor along the line it will be thrown: matte and still.
          tile("vfx_chain_seg", ends.x0, ends.y0, ends.x1, ends.y1, 2.5, 0.55, () => 0);
        } else if (t.phase === "fly") {
          const k = 1 - Math.max(0, t.ms) / 330;
          const hx = ends.x0 + (ends.x1 - ends.x0) * k;
          const hy = ends.y0 + (ends.y1 - ends.y0) * k;
          tile("vfx_chain_seg", ends.x0, ends.y0 - 3, hx, hy - 3, 5.7, 1, (i) => i & 1);
          img(hx, hy - 3, `vfx_chain_hook_${(tick >> 2) & 1}`, 5.75)?.setRotation(Math.atan2(hy - ends.y0, hx - ends.x0));
        } else if (t.phase === "drag") {
          const p = w.player;
          tile("vfx_chain_seg", ends.x0, ends.y0 - 3, p.x, p.y - 3, 8.5, 1, (i) => i & 1);
          img(p.x, p.y - 3, `vfx_chain_hook_1`, 8.55)?.setRotation(Math.atan2(p.y - ends.y0, p.x - ends.x0));
        }
      } else if (t.kind === "chain") {
        // Live: bright and moving.
        tile("vfx_chain_live", ends.x0, ends.y0, ends.x1, ends.y1, 2.6, 1, (i) => (i + (tick >> 2)) & 3);
      } else if (t.kind === "beam") {
        const k = (tick >> 2) & 3;
        tile("vfx_beam_seg", ends.x0, ends.y0 - 3, ends.x1, ends.y1 - 3, 8.6, 1, () => k);
        img(ends.x0, ends.y0 - 3, `vfx_beam_cap_0`, 8.65)?.setRotation(Math.atan2(ends.y1 - ends.y0, ends.x1 - ends.x0));
        img(ends.x1, ends.y1 - 3, `vfx_beam_cap_1`, 8.65)?.setRotation(Math.atan2(ends.y1 - ends.y0, ends.x1 - ends.x0));
      }
    }

    for (const l of w.lobs) {
      const t = Math.min(1, l.t);
      const gx = l.x0 + (l.x1 - l.x0) * t;
      const gy = l.y0 + (l.y1 - l.y0) * t;
      // The landing ring the shadow shrinks toward, fixed at release.
      img(l.x1, l.y1, `vfx_lob_ring_${(tick >> 4) & 1}`, 2.5)?.setDisplaySize(l.radius * 2.2, l.radius * 2.2).setAlpha(0.6 + 0.4 * t);
      img(gx, gy, `vfx_lob_shadow_${Math.min(2, Math.floor(t * 3))}`, 2.55)?.setScale(0.7 / ART_SCALE);
      const lift = Math.sin(t * Math.PI) * 46;
      const shot = l.from === "cinderling" ? `vfx_coal_${(tick >> 2) & 3}` : `vfx_lob_shot_${(tick >> 2) & 3}`;
      img(gx, gy - lift - 6, shot, 7.2, 1 / ART_SCALE);
    }

    for (const f of w.slowFields) {
      const fade = Math.min(1, f.lifeMs / 500) * Math.min(1, (f.maxLifeMs - f.lifeMs) / 300);
      img(f.x, f.y, `vfx_slowfield_${(tick >> 5) & 3}`, 1.95)?.setDisplaySize(f.radius * 2, f.radius * 2).setAlpha(0.85 * fade);
    }

    for (const e of w.enemies) {
      if (e.hp <= 0) continue;
      if (e.archetype === "delver" && e.delve === "under")
        img(e.x, e.y + 2, `vfx_mound_${((e.travelled / 6) | 0) & 3}`, 2.6)?.setRotation(Math.atan2(e.delveY, e.delveX));
      if (e.wardArmour > 0)
        img(e.x, e.y - 2, `vfx_ward_aura_${(tick >> 3) % 3}`, 6.05)?.setDisplaySize(e.radius * 3.4, e.radius * 3.4).setAlpha(0.85);
      // The elite peal's windup: a ring growing on the ringer, the only warning the room is about to be armed.
      if (e.archetype === "bellringer" && e.pose === "peal_windup") {
        const t = 1 - Math.max(0, e.poseMs) / 1100;
        img(e.x, e.y, `vfx_peal_ring_${Math.min(3, Math.floor(t * 4))}`, 5.65, 1 / ART_SCALE)
          ?.setDisplaySize(TILE_PX * 8 * (0.3 + 0.7 * t), TILE_PX * 8 * (0.3 + 0.7 * t)).setAlpha(0.5 + 0.5 * t);
      }
    }
  }

  private drawHazards(): void {
    for (const m of this.hazardMarks) m.destroy();
    this.hazardMarks.length = 0;
    this.hazardGfx.clear();
    const w = this.world;

    // Marks first, under everything: they are the floor's memory, not an
    // effect, and they must never compete with an active hazard for attention.
    // Separated from live fire by being dark and still where fire is bright
    // and moving.
    for (const sc of w.scorches) {
      if (!sc.alive) continue;
      /*
       * A scar, not a stain.
       *
       * This was drawn at 2.4 tiles across and 0.7 alpha, and against a strike
       * every few seconds the marks overlapped into pale patches across the
       * whole arena. Three things were wrong at once and all three are fixed
       * here: it is drawn **inside** the struck radius rather than around it,
       * at a third of the opacity, and tinted toward the floor's own shadow so
       * it reads as scorched stone instead of as a spill.
       */
      const fade = 1 - scorchProgress(sc);
      if (this.atlas.has("deco_scorch")) {
        const img = this.add.image(sc.x, sc.y, this.textureKey, "deco_scorch")
          .setOrigin(0.5)
          .setDepth(1)
          .setAlpha(0.26 * fade)
          .setTint(0x2b2740)
          .setScale(((sc.radius * 1.15) / TILE_PX) / ART_SCALE);
        this.hazardMarks.push(img);
      } else {
        this.hazardGfx.fillStyle(0x1a1730, 0.3 * fade);
        this.hazardGfx.fillCircle(sc.x, sc.y, sc.radius * 0.6);
      }
    }

    // Burning ground is `FireFx`: layered particles, not a per-frame draw.

    for (const e of w.enemies) {
      const s = e.strike;
      if (strikeFlashing(s)) {
        const progress = 1 - Math.max(0, Math.min(1, s.flashMs / STRIKE_FLASH_MS));
        const boltFrame = `vfx_bolt_${Math.min(2, Math.floor(progress * 3))}`;
        if (this.atlas.has(boltFrame)) {
          const bolt = this.add.image(s.x, s.y, this.textureKey, boltFrame)
            .setOrigin(0.5, 1)
            .setScale(1 / ART_SCALE)
            .setDepth(10);
          this.hazardMarks.push(bolt);
        } else {
          this.hazardGfx.fillStyle(0xffffff, 0.75);
          this.hazardGfx.fillCircle(s.x, s.y, s.radius);
        }
        continue;
      }
      if (!strikeMarked(s)) continue;
      // The ring closes as the countdown runs, so the remaining time is
      // readable from the shape rather than from a colour the player has to
      // have learned.
      const left = s.markMs / STRIKE_MARK_MS;
      /*
       * A stroked ring and a growing centre, both generated.
       *
       * `vfx_strikemark_0/1` was delivered for this and is not used. The rune
       * is a better *drawing* than a circle and a worse **marker**, which is
       * the distinction that matters: this thing has one job, to say how long
       * is left and exactly which floor is about to be hit. A hard ring states
       * the boundary at pixel accuracy and the filled centre states the time,
       * and neither survives being replaced by ornament — the rune's detail
       * reads as decoration on the floor, so the player stops treating the
       * edge as an edge.
       *
       * The radius is also a parameter, and a drawing scaled to an arbitrary
       * radius loses the crisp edge that is the entire information.
       */
      this.hazardGfx.lineStyle(2, 0x9ad8ff, 0.9);
      this.hazardGfx.strokeCircle(s.x, s.y, s.radius);
      this.hazardGfx.fillStyle(0x9ad8ff, 0.18);
      this.hazardGfx.fillCircle(s.x, s.y, s.radius * (1 - left));
    }
  }

  /**
   * The two affix effects that are *state on the floor or on a body* rather
   * than a projectile: `ward` runes and `brand` marks.
   *
   * Both were invisible when first wired — the simulation had them and the
   * screen did not — and a mechanic the player cannot see is a mechanic that
   * does not exist for them. The rune has to say *this ground is covered*,
   * and the mark has to say *hit this one again*, from across the room.
   *
   * Drawn procedurally for now: a ring with a spinning tick for the rune, a
   * bright chevron over the head for the mark. Both are requested as art in
   * the work order; the shapes here are what the drawings have to beat.
   */
  private drawAffixMarks(): void {
    const gfx = this.hazardGfx;
    const w = this.world;
    for (const ward of w.wards) {
      const t = w.tick / 12;
      // Fades as its shots and its life run down, so a nearly spent rune reads
      // as nearly spent rather than as full until it vanishes.
      const life = Math.min(1, ward.lifeMs / 2000);
      if (this.atlas.has("vfx_ward_0")) {
        const rune = this.add.image(
          ward.x, ward.y, this.textureKey, `vfx_ward_${(w.tick >> 3) & 1}`,
        ).setOrigin(0.5).setScale(1).setAlpha(0.35 + 0.65 * life).setDepth(2.8);
        this.hazardMarks.push(rune);
      } else {
        gfx.lineStyle(2, 0xffe9a8, 0.35 + 0.45 * life);
        gfx.strokeCircle(ward.x, ward.y, ward.radius);
        gfx.fillStyle(0xffe9a8, 0.12 * life);
        gfx.fillCircle(ward.x, ward.y, ward.radius);
      }
      // One tick per remaining shot, orbiting.
      for (let i = 0; i < ward.shots; i++) {
        const a = t + (i * Math.PI * 2) / Math.max(1, ward.shots);
        gfx.fillStyle(0xffffff, 0.9);
        gfx.fillCircle(ward.x + Math.cos(a) * ward.radius, ward.y + Math.sin(a) * ward.radius, 2);
      }
    }
    for (const e of w.enemies) {
      if (!e.marked || e.hp <= 0) continue;
      const y = e.y - e.radius - 10 + Math.sin(w.tick / 5) * 1.5;
      if (this.atlas.has("vfx_brand_mark")) {
        const mark = this.add.image(e.x, y, this.uiTextureKey, "vfx_brand_mark")
          .setOrigin(0.5).setScale(1).setDepth(9.4);
        this.hazardMarks.push(mark);
      } else {
        gfx.fillStyle(0xff8877, 0.95);
        gfx.beginPath();
        gfx.moveTo(e.x - 5, y - 5);
        gfx.lineTo(e.x, y);
        gfx.lineTo(e.x + 5, y - 5);
        gfx.lineTo(e.x, y + 2);
        gfx.closePath();
        gfx.fillPath();
      }
    }
  }

  /**
   * The camera does not move. Deliberately.
   *
   * The shake is Eiserloh's model — one accumulator, squared — and it makes
   * some people motion sick, so it is a setting (on, reduced, off; reduced
   * by default) and translation only. Impact is carried first by everything
   * that does not move the frame: the hitstop, the white flash on the struck
   * body, the dust and the lean on a charge braking, the pop on a kill.
   */
  private holdCamera(): void {
    const cam = this.cameras.main;
    /*
     * The shake, as a setting: on, reduced or off (Settings). Translation
     * only, from the trauma accumulator squared — no roll, which is the part
     * of a shake most likely to make someone ill — and two incommensurate
     * sines per axis rather than noise, so it reads as a jolt, not a jitter.
     */
    const level = SHAKE_LEVEL[this.shakeSetting];
    const t = this.world.trauma * this.world.trauma * level;
    const now = this.time.now / 1000;
    const dx = t * SHAKE_MAX_PX * (Math.sin(now * 61) * 0.6 + Math.sin(now * 97 + 1.3) * 0.4);
    const dy = t * SHAKE_MAX_PX * (Math.sin(now * 73 + 0.7) * 0.6 + Math.sin(now * 89 + 2.1) * 0.4);
    cam.centerOn(VIEW_W / 2 + dx, (VIEW_H + HUD_H) / 2 + dy);
    cam.setRotation(0);
  }

  private enemyBulletCount(): number {
    let n = 0;
    for (const b of this.world.enemyBullets) if (b.alive) n++;
    return n;
  }

  /**
   * Input, with no pointer.
   *
   * Doc 013 removes the mouse: a melee basic attack plus spells that find
   * their own target leaves it with no job, and facing now comes from
   * movement. So the game is playable on a keyboard alone or a gamepad, and
   * `aim` is derived from the player's facing rather than read from a cursor.
   *
   * Both bindings are offered for each verb because players arrive with
   * different habits: a keyboard player reaches for J and K, a mouse player
   * for the buttons.
   */
  /**
   * Which of the player's poses to draw.
   *
   * Ordered as a **priority**, not as a set of cancel rules. One ordering
   * generates all the behaviour, which is how Hyper Light Drifter gets its
   * cancel tech from a single rule rather than a matrix of windows.
   *
   * The walk frame advances with **distance travelled**, not with a clock.
   * Driving it from a clock is what made the original build read as a figure
   * sliding across the floor with a bob: the legs moved whether or not the
   * body did.
   */
  private playerPose(): string {
    const p = this.world.player;

    // Hurt reads first and briefly. Invulnerability runs 600 ms, which is far
    // too long to hold a recoil, so only its opening belongs to the pose.
    const hurtFor = INVULN_MS - HURT_POSE_MS;
    if (p.invulnMs > hurtFor) return "hurt0";
    if (p.invulnMs > hurtFor - HURT_POSE_MS) return "hurt1";

    if (p.dashMs > 0) return "dash";

    const phase = swingPhase(p);
    if (phase === "windup") return "windup";
    if (phase === "active" || phase === "recover") return "follow";

    const moved = Math.hypot(p.x - this.lastX, p.y - this.lastY);
    this.lastX = p.x;
    this.lastY = p.y;
    if (moved > 0.2) {
      this.walkDistance += moved;
      this.walkHoldMs = WALK_HOLD_MS;
    } else if (this.walkHoldMs > 0) {
      // A short hold before dropping back to idle. Without it, tapping a
      // direction flips between walking and standing every few frames, which
      // is half of what reads as a twitch.
      this.walkHoldMs -= STEP_MS;
    }
    if (this.walkHoldMs > 0) return `walk${Math.floor(this.walkDistance / WALK_FRAME_PX) % 4}`;
    return `idle${Math.floor(this.world.tick / IDLE_FRAME_TICKS) % 4}`;
  }

  /**
   * Which spell key is **held**, or null.
   *
   * It was the edge — one cast per press — on the argument that a spell is a
   * decision and a held key must not buy a cast every frame. The sim already
   * has the thing that stops that: the cooldown, sized to the cost. So a held
   * key casts again when the cooldown clears, which is the rate the design
   * intended, and the player's hand is not asked to drum a rhythm the game
   * could keep for them. U, I, O rather than 1, 2, 3: the right hand already
   * rests on J to attack and K to dash.
   */
  private pressedSpell(): number | null {
    if (this.offerUi || this.staffUi) return null;
    const bound: (Phaser.Input.Keyboard.Key | undefined)[] =
      [this.keys.U, this.keys.I, this.keys.O];
    for (let i = 0; i < bound.length; i++) if (bound[i]?.isDown) return i;
    return null;
  }

  private readInput(): Input {
    /*
     * The offer screen is **modal**: no movement, no swing, no cast.
     *
     * It has to be, because its keys overlap the game's — A and D move the
     * selection, J takes a card — so without this, confirming a reward also
     * swung the sword and browsing the cards walked the player across the
     * room. The screen only ever opens in a cleared room, so nothing is lost
     * by holding the body still while it is up.
     */
    if (this.offerUi) return NO_INPUT;
    const k = this.keys;
    const p = this.input.activePointer;
    const x = (down(k.D) || down(k.RIGHT) ? 1 : 0) - (down(k.A) || down(k.LEFT) ? 1 : 0);
    const y = (down(k.S) || down(k.DOWN) ? 1 : 0) - (down(k.W) || down(k.UP) ? 1 : 0);

    // Aim is a point one reach ahead along the facing. Spells still travel
    // along it until they are rebuilt to auto-target.
    const f = this.world.player.facing;
    return {
      moveX: x, moveY: y,
      aimX: this.world.player.x + Math.cos(f) * 64,
      aimY: this.world.player.y + Math.sin(f) * 64,
      swing: down(k.J) || p.leftButtonDown(),
      // A press, never a hold: a spin is a segment of rage and must not be
      // spent by a finger resting on the key. Latched like the interact key,
      // so a frame with no step cannot lose it.
      spin: this.spinPressed,
      /*
       * One index rather than three flags, and read as a **just-pressed edge**.
       *
       * A spell is a decision, so holding the key must not buy a cast every
       * frame. The sim refuses the repeats anyway, on the cooldown, but reading
       * the edge here is what makes the two agree about what a press is — and
       * the edge is also what the sword does not need, since a held swing
       * queueing the next one is exactly right for a basic attack.
       */
      spell: this.pressedSpell(),
      // Doc 006's auto-firing staff. The world no longer steps it; spells are
      // keyed, on 1, 2 and 3.
      fire: false,
      dash: down(k.K) || down(k.SPACE) || down(k.SHIFT) || p.rightButtonDown(),
      // An edge, like the spell index: taking a card and stepping through a
      // portal are both decisions that must cost one press, not one frame.
      interact: this.interactPressed,
    };
  }

  private draw(): void {
    this.sprites.clear(true, true);
    // A column's upper half goes see-through while a body stands behind it.
    for (const top of this.pillarTops) {
      const behind = (x: number, y: number, r: number) =>
        Math.abs(x - top.x) < TILE_PX / 2 + r && y < top.y + TILE_PX / 2 + r && y > top.y + TILE_PX / 2 - top.h - r * 2;
      const hidden = behind(this.world.player.x, this.world.player.y, 8)
        || this.world.enemies.some((e) => e.hp > 0 && behind(e.x, e.y, e.radius));
      top.img.setAlpha(hidden ? 0.45 : 1);
    }
    // A short history of where the player has been, for the dash ghosts.
    this.trail.push({ x: this.world.player.x, y: this.world.player.y });
    if (this.trail.length > TRAIL_HISTORY) this.trail.shift();
    const w = this.world;
    const frame = (n: string) => (this.atlas.has(n) ? n : "player_s_idle0");
    const put = (x: number, y: number, name: string, depth: number, scale = 1 / ART_SCALE) =>
      this.sprites.add(
        this.add.image(x, y, this.textureKey, frame(name)).setOrigin(0.5).setScale(scale).setDepth(depth),
      );

    // Bullets are drawn from their own radius, not a fixed scale. The 32px
    // frame at a flat half scale made every bullet 16 world px across while
    // the bodies they hit are radius 3 to 5, so the sprite read as more than
    // twice its own hitbox and wider than the player's whole body.
    this.fxGfx.clear();
    this.fxTopGfx.clear();
    this.projGfx.clear();
    for (const b of w.playerBullets) {
      if (!b.alive) continue;
      const look = lookOf(b, w.spells);
      const tint = look;
      if (look.shape === "lightning") {
        /*
         * No sprite at all. The bolt is the line it has travelled: from where
         * it was cast — or, for an arc, from the body it left — to where it
         * has got to. That is why `Bullet` carries an origin.
         */
        /*
         * A new bend every other frame, and the last two bends left behind
         * fainter. Lightning that holds one shape for its whole flight is a
         * drawing of lightning; what reads as the thing itself is that it
         * never looks the same twice and that the eye keeps a ghost of where
         * it just was. The seed is the tick, not a random number, so the
         * harness and the browser agree frame for frame.
         */
        /*
         * Along the path it actually took, not a straight line to where it
         * is. A seeking spark bends toward its body over its flight, and a
         * bolt drawn from its origin to its position was a straight segment
         * sliding sideways onto the target — which reads as the drawing being
         * moved, not as lightning reaching round. The renderer remembers the
         * last few positions and the bolt is threaded through them.
         */
        // Only the last stretch behind the head: a streak, not a wire back to the hand.
        const pts = tailOf([...(this.bulletMemory.get(b)?.trail ?? []), { x: b.x, y: b.y }], LIGHTNING_TAIL_PX);
        const beat = w.tick >> 1;
        const seedOf = (k: number) => (beat - k) * 1.618 + b.originX * 0.11 + b.originY * 0.17;
        /*
         * Thinner with every jump. An arc carries half its parent's damage,
         * and the line carries the same fraction of its parent's width and
         * light, so the chain visibly runs down the way it actually does: the
         * first bolt is the bolt, the third is a thread.
         */
        const slot = b.spellIndex >= 0 ? w.spells[b.spellIndex] : null;
        const baseDamage = slot ? Number(ITEMS.get(slot.item.base)?.params.damage ?? b.damage) : b.damage;
        const hop = Math.max(0.3, Math.min(1, b.damage / Math.max(1, baseDamage)));
        // The last two shapes, left behind as ghosts; then the live bolt as a
        // wide soft glow, a tighter glow, and a thin white-hot core.
        for (let k = 2; k >= 1; k--)
          strokeBolt(this.fxGfx, lightningBolt(pts, seedOf(k), hop), look.glow, (2.4 - k * 0.5) * hop, (0.12 / k) * hop);
        const live = lightningBolt(pts, seedOf(0), hop);
        strokeBolt(this.fxGfx, live, look.glow, 6 * hop, 0.16 * hop);
        strokeBolt(this.fxGfx, live, look.glow, 3 * hop, 0.34 * hop);
        strokeBolt(this.fxGfx, live, look.core, 1.2 + 0.5 * hop, 0.6 + 0.35 * hop);
        this.fxGfx.fillStyle(look.core, 0.9);
        this.fxGfx.fillCircle(b.x, b.y, b.radius * 0.9);
        this.fxGfx.fillStyle(look.glow, 0.35);
        this.fxGfx.fillCircle(b.x, b.y, b.radius * 2.2);
        // The charge it carries: short arcs reaching off the head, and sparks.
        drawCrackle(this.fxGfx, b.x, b.y, look);
        drawProjectile(this.fxGfx, this.projGfx, b, look, w.tick, (sp) => this.shed(sp));
        continue;
      }
      // Its own shape, pointed along its flight, and its own particles.
      drawProjectile(this.fxGfx, this.projGfx, b, look, w.tick, (sp) => this.shed(sp));
    }
    this.drawProps();
    /*
     * Drops, on the floor and animated.
     *
     * Two frames each and both were unused. They flicker on a slow clock so
     * they catch the eye against a still floor, and flash out over their last
     * couple of seconds so an expiring reward is something the player can
     * decide to run for rather than something that silently stops existing.
     */
    for (const q of w.pickups) {
      if (!q.alive) continue;
      /*
       * A mana orb, drawn: a small bright mote in the mana bar's blue with a
       * soft light round it, bobbing so it reads as loose rather than lying.
       * It is the one drop every kill leaves, so it is small and many.
       */
      if (q.kind === "mana") {
        const bob = Math.sin((w.tick + q.x) / 7) * 1.2;
        const fade = pickupFading(q) && (w.tick >> 2) & 1 ? 0.35 : 1;
        this.sprites.add(this.add.circle(q.x, q.y - 3 + bob, 4.2, 0x3f7fe0, 0.28 * fade).setDepth(4).setBlendMode(Phaser.BlendModes.ADD));
        this.sprites.add(this.add.circle(q.x, q.y - 3 + bob, 2.1, 0x8fdcff, 0.95 * fade).setDepth(4.1));
        this.sprites.add(this.add.rectangle(q.x - 0.5, q.y - 3.5 + bob, 1, 1, 0xffffff, fade).setDepth(4.2));
        continue;
      }
      const name = `pickup_${q.kind}_${(w.tick >> 4) & 1}`;
      if (!this.atlas.has(name)) continue;
      const img = this.add.image(q.x, q.y, this.uiTextureKey, name)
        .setOrigin(0.5).setScale(1 / ART_SCALE).setDepth(4);

      if (pickupFading(q)) img.setAlpha((w.tick >> 2) & 1 ? 0.35 : 1);
      // A shadow, so it reads as lying on the floor rather than floating.
      const sh = this.add.ellipse(q.x, q.y + 4, 9, 4, 0);
      sh.setFillStyle(0x0d0b1f, 0.3).setDepth(3);
      this.sprites.add(sh);
      this.sprites.add(img);
    }
    const label = (k: string, x: number, y: number, t: string, st: Phaser.Types.GameObjects.Text.TextStyle) => this.ftext(k, x, y, t, st);
    for (const e of w.enemies) drawEnemy(this, w, e, this.textureKey, this.atlas, this.sprites, label);
    for (const b of w.enemyBullets) {
      if (!b.alive) continue;
      /*
       * A lancer's flying spike is drawn as **the spike**: a short gold shaft
       * with a dark edge, pointed the way it travels. It broke off the body a
       * moment ago and the eye has to be able to follow it from there; the
       * round bullet frame said "a shot" and lost the thread.
       */
      if (b.from === "lancer") {
        const a = Math.atan2(b.vy, b.vx);
        if (this.atlas.has("vfx_spike_gold"))
          this.sprites.add(this.add.image(b.x, b.y, this.textureKey, "vfx_spike_gold")
            .setOrigin(0.5).setRotation(a).setScale(1.2 / ART_SCALE).setDepth(7));
        continue;
      }
      /*
       * Fast shots are tracers: a stretched magenta streak with a white-hot
       * head, pointed along its flight — what a shot at speed looks like, and
       * a direction the eye can read at a glance. Slow pattern shots stay
       * round (a bullet-hell orb is read by its place, not its heading), with
       * a faint copy behind so they read as moving.
       */
      const speed = Math.hypot(b.vx, b.vy);
      if (speed >= TRACER_SPEED && !b.leavesFire) {
        const sheet = b.radius > 3.2 ? "tracer_l" : "tracer_s";
        const info = this.fxSheets.get(sheet);
        if (info) {
          const i = (w.tick >> 2) & 1;
          const o = info.origins[i]!;
          this.sprites.add(this.add.image(b.x, b.y, FX_TEXTURE, `${sheet}_${i}`)
            .setOrigin(o[0], o[1]).setRotation(Math.atan2(b.vy, b.vx)).setScale(0.5).setDepth(7));
          continue;
        }
      }
      const ghost = this.add.image(b.x - b.vx * 0.03, b.y - b.vy * 0.03, this.textureKey, frame(bulletFrame(b, w.tick, true)))
        .setOrigin(0.5).setScale(bulletScale(b.radius) * 0.8).setAlpha(0.3).setDepth(6.95);
      this.sprites.add(ghost);
      put(b.x, b.y, bulletFrame(b, w.tick, true), 7, bulletScale(b.radius));
    }

    const spinning = w.player.swingStretch > 1 && swingPhase(w.player) === "active";
    const spin = facingFrame(
      "player", ((spinning ? w.swing.angle : w.player.facing) * 180) / Math.PI, this.playerPose(),
    );
    const flameName = `vfx_offhand_${Math.floor(w.tick / 6) % 4}`;
    // A slow bob on top of everything else, so the flame is alive even when
    // the character is standing perfectly still.
    const flameBob = Math.sin(w.tick / 9) * 0.8;
    const anchor = this.atlas.playerAnchor(spin.name);
    const mirrorX = (x: number) => spin.flipX ? 64 - x : x;
    const offhand = anchor?.offhand ?? [spin.flipX ? 14 : 50, 34];
    const grip = anchor?.grip ?? [spin.flipX ? 50 : 14, 34];
    const facing = spin.name.split("_")[1];
    const flameOffset = {
      x: (mirrorX(offhand[0]) - 32) / ART_SCALE,
      y: (offhand[1] - 32) / ART_SCALE + flameBob - BODY_LIFT,
      behind: facing === "n",
    };
    if (w.player.mana > 0 && flameOffset.behind)
      put(w.player.x + flameOffset.x, w.player.y + flameOffset.y, flameName, 7.9, FLAME_SCALE * this.flare());
    /*
     * Afterimages, Symphony of the Night's kind.
     *
     * The first version read the last few entries of a position history and
     * drew them only *while* dashing — so the trail existed for the six frames
     * the dash lasts and vanished with it, which is the same moment the player
     * is looking at where they ended up. What the reference does is leave a
     * **chain of copies standing in place**, each fading on its own clock, so
     * the path is still there after the move is over and the eye can follow it
     * back.
     *
     * So they are spawned rather than sampled: one per dash frame, at that
     * frame's position and pose, with its own lifetime. `GHOST_MS` outlasts the
     * dash by three times, which is what makes it a streak rather than a
     * flicker.
     */
    if (w.player.dashMs > 0)
      this.ghosts.push({
        x: w.player.x, y: w.player.y - BODY_LIFT, frame: frame(spin.name),
        flipX: spin.flipX, ms: GHOST_MS,
      });
    for (const g of this.ghosts) {
      const k = 1 - g.ms / GHOST_MS;
      this.sprites.add(
        this.add.image(g.x, g.y, this.textureKey, g.frame)
          .setOrigin(0.5)
          // Shrinking very slightly as it fades, so the chain reads as
          // receding rather than as a row of identical cut-outs.
          .setScale((1 / ART_SCALE) * (1 - k * 0.12))
          .setDepth(7.5)
          .setFlipX(g.flipX)
          .setAlpha(0.42 * (1 - k) ** 1.4)
          .setTint(0x9ad8ff),
      );
    }


    /*
     * Stunned: stars over the head, the same as a knocked-down enemy gets.
     *
     * One visual language for one state — a player who has learned what stars
     * mean on a tank reads them instantly on themselves, and the alternative
     * (a tint, a shake) competes with the hurt flash that is already running.
     */
    if (w.player.stunMs > 0) {
      for (let i = 0; i < 3; i++) {
        const a = w.tick / 8 + (i / 3) * Math.PI * 2;
        this.sprites.add(
          this.add.star(
            w.player.x + Math.cos(a) * 10, w.player.y - 17 + Math.sin(a) * 3.5,
            4, 1.7, 3.8, 0xffe9a8,
          ).setDepth(11).setAlpha(0.92),
        );
      }
    }

    if (this.atlas.has("shadow_player")) {
      const shadow = this.add.image(
        w.player.x,
        w.player.y - BODY_LIFT + shadowOffset(this.atlas, frame(spin.name), "shadow_player"),
        this.textureKey, "shadow_player",
      ).setOrigin(0.5)
        .setScale(shadowScale(this.atlas, frame(spin.name), "shadow_player"), 1 / ART_SCALE)
        .setDepth(3)
        .setAlpha(0.5);
      this.sprites.add(shadow);
    }

    /*
     * The sword's angle for **every** frame of the swing, not just the live
     * ones. See `drawnBladeAngle`: windup pulls back, the active frames follow
     * the hitbox exactly, recovery settles.
     */
    /*
     * A floating blade rests **along the facing**, not at a hand angle.
     *
     * This was the atlas's `bladeAngleDeg` — the angle the sword is drawn at in
     * the hand for each facing, which is authored art data and is the right
     * answer for a *held* sword. For a blade that hovers it is the wrong
     * answer in a way that showed up immediately: the hand angle points up and
     * to the right in every facing, so facing **down** still put the sword
     * above the player's head. The two facings that were reported as wrong
     * were both of the vertical ones, because those are the two where a fixed
     * hand angle disagrees most with where the player is looking.
     *
     * The facing is also the more useful thing for it to say. The sword is
     * where the attack is about to come from, so pointing it at what the
     * player is aiming at makes it a second read on the facing rather than
     * decoration — and the hand anchors stay in the atlas for the off-hand
     * flame, which really is held.
     */
    /*
     * Three states, not one. A blade that hangs level in front of the player
     * for the whole run is a stick they carry. **Sheathed** — no enemy awake
     * — it rides behind the shoulder, point up, barely moving. **Ready** —
     * something is awake — it comes round to the facing, where the attack
     * will come from, and sinks a little when the mana is gone, along with
     * the flame. **Striking** is the swing, unchanged. The move between the
     * first two is eased, so the sword is seen to come out.
     */
    const anyAwake = w.enemies.some((e) => e.hp > 0 && e.awake && e.spawnFadeMs <= 0);
    const readyRot = w.player.facing + (w.player.mana <= 0 ? 0.45 : 0);
    // Sheathed: slung across the back, hilt at the hip, blade up and out over
    // the shoulder away from the facing, behind the body.
    const side = Math.cos(w.player.facing) >= 0 ? 1 : -1;
    const want = anyAwake
      ? { dx: Math.cos(readyRot) * SWORD_HOVER_PX, dy: Math.sin(readyRot) * SWORD_HOVER_PX - BODY_LIFT, rot: readyRot }
      : { dx: -7 * side, dy: 2 - BODY_LIFT, rot: -Math.PI / 2 + 0.55 * side };
    const ease = 1 - Math.exp(-STEP_MS / 140);
    this.swordPose.dx += (want.dx - this.swordPose.dx) * ease;
    this.swordPose.dy += (want.dy - this.swordPose.dy) * ease;
    this.swordPose.rot += angleDelta(this.swordPose.rot, want.rot) * ease;
    const restingAngle = readyRot;
    this.swordRestAngle = restingAngle;
    const swordAngle = drawnBladeAngle(w.swing, w.player, restingAngle);
    /*
     * Hovering at the blade's own angle rather than pinned to a hand anchor.
     *
     * The hand anchors stay in the atlas and are still what the off-hand flame
     * uses; the sword left the hand when it became a floating blade, so its
     * position is now polar — a radius out along wherever it is pointing.
     *
     * The bob only happens at rest. A swing is fast enough that an extra
     * oscillation on top of it would read as the blade wobbling rather than as
     * it floating, and the one thing the swing must not look like is loose.
     */
    const swinging = swingPhase(w.player) !== "none";
    const bob = Math.sin(w.tick / 22) * SWORD_BOB_PX * (anyAwake ? 1 : 0.4);
    const spinWindup = w.player.swingStretch > 1 && swingPhase(w.player) === "windup";
    /*
     * At rest the blade **floats beside the body, point down**, bobbing a
     * little; it comes out of that pose for the swing and drops straight back
     * into it after, where it is. It used to hang level in front of the
     * facing, then to sheathe on the back, then to vanish; each read as
     * either a stick carried or furniture. A blade hanging point-down at the
     * shoulder is a companion waiting, which is what a floating sword is.
     */
    const resting = !swinging && !spinWindup;
    // The steel stays in hand; the reach past it is the magic blade's (`drawMagicBlade`).
    const flyPx = SWORD_HOVER_PX;
    const flyLift = BODY_LIFT;
    // A swing's sword sits in the slash plane: raised, flattened, lunging.
    const sf = this.slashFrame();
    const inPlane = swinging && w.player.swingStretch === 1;
    const planeAngle = Math.atan2(Math.sin(swordAngle) * sf.squash, Math.cos(swordAngle));
    const restSide = Math.sign(mirrorX(grip[0]) - 32) || (spin.flipX ? -1 : 1);
    const heldAngle = resting ? Math.PI / 2 : swordAngle;
    const swordX = spinWindup ? w.player.x + 3
      // At the **sword hand**, from the frame's grip anchor: the flame has the
      // other hand, so the blade floats over the empty one whichever way the
      // player faces.
      : resting ? w.player.x + restSide * (Math.abs(mirrorX(grip[0]) - 32) / ART_SCALE + 6)
      : inPlane ? w.swing.x + sf.dx + Math.cos(swordAngle) * flyPx
      : w.player.x + Math.cos(swordAngle) * flyPx;
    const swordY = spinWindup ? w.player.y - BODY_LIFT - 14
      // The hilt at the hand, the blade hanging down past the hip: clear of
      // the face, which the raised version covered.
      : resting ? w.player.y - BODY_LIFT + (grip[1] - 32) / ART_SCALE - 2 + bob
      : inPlane ? w.swing.y - sf.lift + sf.dy + Math.sin(swordAngle) * sf.squash * flyPx
      : w.player.y - flyLift + Math.sin(swordAngle) * flyPx;
    /*
     * The blade is seen **only while it is being used**: through the swing
     * and for a short linger after it, and while the spin charges. A blade
     * that hung in the air beside the player for the whole run was a stick
     * they carried; sheathing it on the back was better and still furniture.
     * Now the sword is the attack, and nothing else.
     */
    const sword = this.add.image(
      swordX,
      swordY,
      this.textureKey,
      "weapon_player_sword",
      /*
       * Pivoted at the **hilt**, and never stretched.
       *
       * Both were wrong together. The origin was the frame's centre, so the
       * whole sword orbited the grip point instead of rotating in the hand —
       * the hilt swung out as far as the tip. And the x scale was
       * `bladeReach / 16`, which at the current reach of one tile is a **2x
       * stretch on one axis**: the delivered blade is 30 art pixels from grip
       * to tip and was being drawn 60 long. Stretching pixel art on one axis
       * is the thing the art rules forbid outright, and it is exactly what
       * "the sword is too long" was.
       *
       * A reach upgrade does not stretch the drawing. The hitbox grows, and
       * what shows it is the spread the arc attack already has; a blade that
       * physically lengthens with a stat is not something this art can say.
       */
    ).setOrigin(SWORD_GRIP_X / 64, 0.5)
      .setScale(1 / ART_SCALE)
      .setRotation(spinWindup ? -Math.PI / 2 : inPlane ? planeAngle : heldAngle)
      // Behind the body while sheathed; in front, or behind when facing away, when out.
      .setDepth(facing === "n" ? 7.8 : 8.6);
    if (dashInvulnerable(w.player)) sword.setAlpha(0.55);
    else if (w.player.invulnMs > 0) sword.setAlpha((w.tick >> 2) & 1 ? 0.35 : 1);
    // Charged: the blade goes white and swells, the way ALttP's does.
    if (spinWindup) { sword.setTintFill((w.tick >> 1) & 1 ? 0xffffff : 0xffe9a8); sword.setScale((1 / ART_SCALE) * 1.15); }
    this.sprites.add(sword);

    // A dear spell kicks the body back along its line for a few frames.
    let kickX = 0;
    let kickY = 0;
    if (this.recoil) {
      const k = this.recoil.ms / 90;
      kickX = -Math.cos(this.recoil.a) * 2 * k;
      kickY = -Math.sin(this.recoil.a) * 2 * k;
      this.recoil.ms -= this.game.loop.delta;
      if (this.recoil.ms <= 0) this.recoil = null;
    }
    const player = this.add.image(w.player.x + kickX, w.player.y - BODY_LIFT + kickY, this.textureKey, frame(spin.name))
      .setOrigin(0.5).setScale(1 / ART_SCALE).setDepth(8).setFlipX(spin.flipX);
    if (dashInvulnerable(w.player)) player.setAlpha(0.55);
    else if (w.player.invulnMs > 0) player.setAlpha((w.tick >> 2) & 1 ? 0.35 : 1);
    // A status shows on the body: warm while burning, green while poisoned.
    if (w.player.burnMs > 0) player.setTint((w.tick >> 2) & 1 ? 0xffb080 : 0xffd0a8);
    else if (w.player.poisonMs > 0) player.setTint(0xa8f0a8);
    this.sprites.add(player);
    this.drawPlayerStatus();
    if (w.player.mana > 0 && !flameOffset.behind)
      put(w.player.x + flameOffset.x, w.player.y + flameOffset.y, flameName, 9, FLAME_SCALE * this.flare());

    for (const pop of this.pops) {
      const t = 1 - pop.ms / 200;
      const name = pop.frame;
      this.sprites.add(
        this.add.image(pop.x, pop.y, this.textureKey, name)
          .setOrigin(0.5)
          .setFlipX(pop.flipX)
          .setScale((1 / ART_SCALE) * (1 + t * 0.6))
          .setAlpha(1 - t)
          .setTintFill(0xffffff)
          .setDepth(7),
      );
    }

    /*
     * Sparks: small, dim dots.
     *
     * These were briefly drawn from `vfx_impact_0..2`, which was the wrong
     * read of what those frames are. They are one **burst** — three frames of
     * a single impact — so using them per particle sprayed six crescents per
     * hit and looked like confetti. They are played once at the hit point
     * instead; see `this.impacts`.
     */
    for (const q of w.particles) {
      if (!q.alive) continue;
      const t = q.lifeMs / q.maxLifeMs;
      const size = q.kind === "kill" ? 4 : 3;
      this.sprites.add(
        this.add.rectangle(q.x, q.y, size, size, 0xe8e3d8, t).setDepth(9),
      );
    }

    /*
     * The impact: a white ring, expanding and thinning, once per hit.
     *
     * Drawn rather than sprited. `vfx_impact_0..2` were tried and they are
     * **directional crescents** — fine as a slash decal, wrong as the mark of
     * a hit, which has to read the same whichever way the blow came from. A
     * ring has no direction to be wrong about, it is unmistakably an impact,
     * and it can be sized by how much the hit mattered without needing a
     * second drawing.
     */
    for (const hit of this.impacts) {
      const t = 1 - hit.ms / IMPACT_MS;
      if (hit.slashAngle !== undefined && this.atlas.has("vfx_impact_0")) {
        const impact = this.add.image(
          hit.x, hit.y, this.textureKey, `vfx_impact_${Math.min(2, Math.floor(t * 3))}`,
        ).setOrigin(0.5)
          .setRotation(hit.slashAngle)
          .setScale((1 / ART_SCALE) * hit.scale)
          .setAlpha(1 - t)
          .setDepth(9.5);
        this.sprites.add(impact);
        continue;
      }
      const r = hit.scale * (3 + 15 * t);
      this.hazardGfx.lineStyle(Math.max(0.6, 2.4 * (1 - t)), hit.color ?? 0xffffff, (1 - t) * 0.9);
      this.hazardGfx.strokeCircle(hit.x, hit.y, r);
    }
    this.drawSpellLight();
    this.drawDamageNumbers(this.game.loop.delta);
    this.drawShards(this.game.loop.delta);
    this.drawVortices();
    this.drawPets();
    this.drawDashStrike();
    if (this.renderingDemo) return;
    this.drawFxAnims(this.game.loop.delta);
    this.drawLessons(this.game.loop.delta);

    // Soft backing behind the body's gauges, so they read over stone.
    const topBacking = this.add.rectangle(4, 2, HUD_BAR_X + HUD_BAR_W + 8, 25, 0x0d0b1f, 0.6).setOrigin(0).setDepth(99);

    /*
     * Health as a **bar with a number**, matching the mana bar below it.
     *
     * Hearts were discrete pictures, and the moment fire and poison became
     * statuses that drain a tenth of a heart at a time there was nothing on
     * the HUD that could show a tenth. The two resources now read the same
     * way — a bar and `now/max` on it — so a player learns one gauge and has
     * two. Internally a heart is still the unit (a hit is one), and ten HP
     * is what one heart is shown as.
     */
    /*
     * The boss's bar, across the top: the one health bar an enemy gets on the
     * HUD, because the boss is the one fight whose length is the point. Phase
     * marks at 60% and 30% so the change is seen coming; the armour as a
     * pale band above the health, as on the body's own bar; the phase named.
     */
    const bossFade = this.sprites.getLength();
    const boss = w.enemies.find((e) => e.archetype === "boss" && e.hp > 0);
    if (boss) {
      const BW = 280;
      const BX = VIEW_W / 2 - BW / 2;
      // At the bottom, above the spell row, so the top row is the player's.
      const BY = VIEW_H - 52;
      this.sprites.add(this.add.rectangle(BX - 2, BY, BW + 4, 11, 0x0d0b1f, 0.85).setOrigin(0, 0.5).setDepth(100));
      this.sprites.add(this.add.rectangle(BX, BY, BW, 7, 0x2a1418, 1).setOrigin(0, 0.5).setDepth(100.5));
      const frac = Math.max(0, boss.hp / Math.max(1, boss.maxHp));
      this.sprites.add(this.add.rectangle(BX, BY, BW * frac, 7, boss.phase >= 3 ? 0xff5a3a : 0xd83a3a, 1).setOrigin(0, 0.5).setDepth(101));
      if (boss.maxArmour > 0) {
        this.sprites.add(this.add.rectangle(BX, BY - 7, BW, 3, 0x0f1c3a, 0.9).setOrigin(0, 0.5).setDepth(100.8));
        this.sprites.add(this.add.rectangle(BX, BY - 7, BW * Math.max(0, boss.armour / boss.maxArmour), 3, SHIELD_BLUE, boss.armour > 0 ? 1 : 0.15).setOrigin(0, 0.5).setDepth(101));
        this.sprites.add(shieldMark(this, this.atlas, this.uiTextureKey, BX - 7, BY - 7, 8).setDepth(102));
      }
      for (const mark of [0.6, 0.3])
        this.sprites.add(this.add.rectangle(BX + BW * mark, BY, 1, 9, 0xffe9a8, 0.8).setOrigin(0.5).setDepth(102));
      this.ftext("boss:title", BX, BY - 11, "THE FLOOR'S MASTER", {
        fontFamily: "monospace", fontSize: `${Math.round(7 * ZOOM)}px`, color: "#ffe9a8",
      }).setScale(1 / ZOOM).setOrigin(0, 0.5).setDepth(102);
      this.ftext("boss:phase", BX + BW, BY - 11, `phase ${["I", "II", "III"][boss.phase - 1] ?? boss.phase}`, {
        fontFamily: "monospace", fontSize: `${Math.round(7 * ZOOM)}px`, color: boss.phase >= 3 ? "#ff9a6a" : "#c9cfe8",
      }).setScale(1 / ZOOM).setOrigin(1, 0.5).setDepth(102);
      this.fadeIfCovering(bossFade, BX - 2, BY - 18, BW + 4, 26);
    }

    const topFade = this.sprites.getLength();
    this.sprites.add(topBacking);
    const hpMax = (MAX_HEARTS + w.player.mods.maxHearts) * HP_PER_HEART;
    const hp = Math.max(0, Math.round(w.player.hearts * HP_PER_HEART));
    const HP_Y = HUD_TOP_Y;
    this.sprites.add(this.add.rectangle(HUD_BAR_X, HP_Y, HUD_BAR_W, 7, 0x2a1418, 1).setOrigin(0, 0.5).setDepth(100));
    this.sprites.add(
      this.add.rectangle(HUD_BAR_X, HP_Y, HUD_BAR_W * (hp / Math.max(1, hpMax)), 7,
        w.player.hearts <= 1 ? 0xff6a5a : 0xd83a3a, 1).setOrigin(0, 0.5).setDepth(101),
    );
    if (this.atlas.has("ui_heart_full"))
      this.sprites.add(this.add.image(HUD_BAR_X - 2, HP_Y, this.uiTextureKey, "ui_heart_full")
        .setOrigin(1, 0.5).setDisplaySize(12, 12).setDepth(101));
    this.ftext("hud:hp", HUD_BAR_X + HUD_BAR_W / 2, HP_Y, `${hp}/${hpMax}`, {
      fontFamily: "monospace", fontSize: `${Math.round(7 * ZOOM)}px`, color: "#ffffff",
    }).setScale(1 / ZOOM).setOrigin(0.5).setDepth(102);

    /*
     * The three spells, as a mana bar with the cost of each marked on it.
     *
     * Drawn against the bar rather than as three separate numbers because the
     * question the player is asking is one question — *which of these can I
     * afford right now* — and doc 013 makes every cost a share of the cap, so
     * a cost is a position on the bar rather than a quantity to compare. A
     * marker left of the fill is castable and one right of it is not, which is
     * readable without reading.
     */
    /*
     * The mana bar, and the three spells beside it.
     *
     * The costs used to be drawn as marks **on** the bar, at the position each
     * one occupied. It was the wrong widget for the job in a way worth
     * recording: a mark on a gauge reads as a *gradation*, so unevenly spaced
     * marks read as a broken scale rather than as three thresholds. Nobody
     * asked "what are those ticks" about a number.
     *
     * So the bar shows mana and only mana, gradated evenly at quarters so it
     * reads as a gauge, and each spell states its own cost as a percentage
     * next to its key. Two questions, two widgets.
     */
    const BAR_X = HUD_BAR_X;
    const BAR_Y = HUD_TOP_Y + 11;
    // The spells have their own row now, along the bottom.
    const SPELL_Y = HUD_BOTTOM_Y;
    const BAR_W = HUD_BAR_W;
    const PIPS_X = BAR_X + BAR_W + 8;
    const filled = w.player.mana / w.staff.mana_max;
    this.sprites.add(
      this.add.rectangle(BAR_X, BAR_Y, BAR_W, 7, 0x1a1f3d, 1).setOrigin(0, 0.5).setDepth(100),
    );
    this.sprites.add(
      this.add.rectangle(BAR_X, BAR_Y, BAR_W * filled, 7, 0x6fa8ff, 1)
        .setOrigin(0, 0.5).setDepth(101),
    );
    if (this.atlas.has("ui_mana_pip"))
      // The same size as the heart beside the bar above, so the two gauges
      // read as a pair; the pip's own scale was half again as tall.
      this.sprites.add(this.add.image(BAR_X - 2, BAR_Y, this.uiTextureKey, "ui_mana_pip")
        .setOrigin(1, 0.5).setDisplaySize(12, 12).setDepth(101).setTint(0x8fdcff));
    // The number, as on the health bar: what the player is adding costs against.
    this.ftext("hud:mana", BAR_X + BAR_W / 2, BAR_Y, `${Math.floor(w.player.mana)}/${w.staff.mana_max}`, {
      fontFamily: "monospace", fontSize: `${Math.round(7 * ZOOM)}px`, color: "#ffffff",
    }).setScale(1 / ZOOM).setOrigin(0.5).setDepth(102);

    this.fadeIfCovering(topFade, 0, 0, HUD_BAR_X + HUD_BAR_W + 16, 30);
    this.drawActionBar(w);

    /*
     * The HUD names the beat the player is in, because the two beats after a
     * fight are new and neither is self-explanatory the first time: a reward
     * on the floor could be scenery, and a shut portal could be broken.
     */
    const beat = this.won ? `${this.tookLabel}  —  R to run again`
      : w.player.hearts <= 0 ? ""
      : this.tookMs > 0 ? `took ${this.tookLabel}`
      : w.rewardPending ? "a reward waits in the middle"
      : w.portals.some((p) => p.open) ? "step into a portal"
      : worldCleared(w) ? "cleared"
      : "";
    this.hud.setText(
      // Mana is the bar below; printing it as a percentage as well was the
      // same number twice, in the units the bar exists to avoid.
      // Only what the player needs told: the beat, and a muted game. The room
      // number, stage and enemy count are on the Tab screen and the debug panel.
      [beat, this.sfx.isMuted() ? "muted (M)" : ""].filter(Boolean).join("  ·  "),
    );
    this.hud.setVisible(this.hud.text.length > 0);
    /*
     * Gold as a coin and a number, beside the body's gauges: the pickup's own
     * frame, so the thing on the floor and the count in the corner are
     * visibly the same thing.
     */
    // Top right, on its own: the one number the player carries between rooms.
    const goldText = this.ftext("hud:gold", VIEW_W - 10, HUD_TOP_Y + 3, `${this.runGold + w.gold}`, {
      fontFamily: "monospace", fontSize: `${Math.round(9 * ZOOM)}px`, color: "#ffd45e",
    }).setScale(1 / ZOOM).setOrigin(1, 0.5).setDepth(102);
    const goldX = VIEW_W - 10 - goldText.displayWidth - 8;
    this.sprites.add(this.add.rectangle(goldX - 8, HUD_TOP_Y + 3, VIEW_W - goldX + 4, 16, 0x0d0b1f, 0.6).setOrigin(0, 0.5).setDepth(99));
    if (this.atlas.has("pickup_coin_0"))
      this.sprites.add(this.add.image(goldX, HUD_TOP_Y + 3, this.uiTextureKey, "pickup_coin_0")
        .setOrigin(0.5).setDisplaySize(11, 11).setDepth(102));
  }
}

function down(k: Phaser.Input.Keyboard.Key | undefined): boolean {
  return k?.isDown ?? false;
}

/**
 * An enemy's frame.
 *
 * The idle pair alternates on a clock that runs faster the faster the body
 * is moving. The first version of this picked `idle0` and nothing else, so
 * every enemy was one static image: the art had two frames and the renderer
 * never showed the second, which is what made them read as target dummies.
 */
/**
 * One enemy stride, in px.
 *
 * The same yardstick as the player's `WALK_FRAME_PX`, and deliberately shared:
 * when every body advances a frame per fixed distance rather than per fixed
 * time, weight falls out of the speeds already in the roster. A rusher at 112
 * px/s runs its cycle at 5 fps and a tank at 52 plods at 2.4, with nothing
 * authored per archetype to say so.
 */

/**
 * Draws one enemy with the motion the art does not carry: a bob while it
 * moves, a lean into its travel, a squash as it fades in, and a white flash
 * on damage. Two idle frames cannot make a body look alive on their own;
 * what sells it is that the sprite answers what the body is doing.
 */
/** The colour of a body's spikes: bone for the rusher, the lancer's own gold. */
function spikeColour(e: Enemy): number {
  return e.archetype === "lancer" ? 0xffd24a : 0xf0ead8;
}

/**
 * The drawn move a body is in, when it is not a melee phase: the expansion's
 * poses (`attacks.ts`), and the elite forms of the old roster, each of which
 * has its own drawing. Null for none.
 */
function specialPose(w: World, e: Enemy): string | null {
  switch (e.archetype) {
    case "warden":
      // The drawn aim: raised to load, levelled to fire, and held level
      // through the start of the reload while the smoke clears.
      if (e.pose === "musket_windup") return "windup";
      if (e.pose === "musket_fire" || e.pose === "musket_second") return "lunge";
      if (e.pose === "musket_reload" && e.poseMs > 800) return "lunge";
      return null;
    case "bellringer":
      if (e.pose === "cast") return e.poseMs > 260 ? "windup" : "cast";
      if (e.pose === "field" || e.pose === "burst" || e.pose === "peal_windup" || e.pose === "peal_release") return e.pose;
      return null;
    case "rifter":
      if (e.pose === "telegraph_walk") return "telegraph_walk";
      if (e.pose === "telegraph") return e.poseMs < 120 ? "erupt" : "telegraph";
      return null;
    case "snarecaster":
      if (e.pose === "windup_hook") return "windup";
      if (e.pose === "fire" || e.pose === "anchor_cast") return e.pose;
      if (w.tethers.some((t) => t.kind === "hook" && t.from === e.id && t.phase === "hold")) return "whip";
      return null;
    case "delver":
      if (e.delve === "diving") return "burrow";
      if (e.delve === "emerging") return "emerge";
      return null;
    case "cinderling":
      if (e.pose === "lob_windup") return e.poseMs > 200 ? "windup" : "lob";
      if (e.pose === "flare_windup") return "flare_windup";
      if (e.burnMs > 0 && e.attack === "approach") return "burning";
      return null;
    case "sower":
      return e.pose === "bloom_cast" ? "bloom_cast" : null;
    case "shooter":
      return e.pose === "lob" ? "lob" : null;
    case "turret":
      // The elite's rift lance: its crack is open while a rift from it grows.
      return e.affixes.length > 0 && e.telegraphMs <= 0 && e.patternMs % 5200 > 4300 ? "telegraph_rift" : null;
    case "sentinel":
      return e.affixes.length > 0 && e.telegraphMs > 0 ? "telegraph_beam" : null;
    case "tank":
      return e.pose === "cleave_shock" && e.attack === "lunge" ? "cleave_shock" : null;
    case "summoner":
      return w.tethers.some((t) => t.kind === "ward" && t.from === e.id) && e.attack === "approach" && e.velX === 0 ? "tether" : null;
    case "lancer":
      return e.spikeMs > 0 ? "burst" : null;
    case "boss":
      // Its own attack poses, per phase: the slam and the leap, then the blade.
      if (e.bossCast === "slam") return "slam";
      if (e.bossCast === "leap") return "leap";
      if (e.attack === "windup") return "windup";
      if (e.attack === "lunge") return "commit";
      return null;
    default:
      return null;
  }
}

/** The sheet a body is drawn from; the boss changes sheet with its phase. */
function frameBaseOf(e: Enemy): string {
  return e.archetype === "boss" ? `boss_p${Math.min(3, Math.max(1, e.phase))}` : ENEMY_FRAME[e.archetype];
}

function drawEnemy(
  scene: Phaser.Scene,
  w: World,
  e: Enemy,
  textureKey: string,
  atlas: RecolourableAtlas,
  group: Phaser.GameObjects.Group,
  /** A kept text by key (the scene's `ftext`), so a mark over a head is not rebuilt each frame. */
  label?: (key: string, x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle) => Phaser.GameObjects.Text,
): void {
  /*
   * Roused, but not yet alerted: close enough to be standing, not close
   * enough to have noticed. Measured against the archetype's own aggro range
   * so it is always a little wider than the distance at which it wakes —
   * which makes the stand-up a warning that the fight is about to start.
   */
  const roused = Math.hypot(e.x - w.player.x, e.y - w.player.y)
    < ENEMIES[e.archetype].aggro_range * 1.5;
  /*
   * Under the floor, the body is not drawn at all: the mound is (see
   * `drawExpansion`). What cannot be hit must not be seen as a target.
   */
  if (e.archetype === "delver" && e.delve === "under") return;
  const chosen = enemyFrame(
    {
      ...e, roused,
      recoversBraced: ENEMIES[e.archetype].melee === "charge",
      stationary: ENEMIES[e.archetype].behaviour === "stationary",
      special: specialPose(w, e),
    },
    w.tick, (n) => atlas.has(n), frameBaseOf(e),
  );
  const name = safeFrame(atlas, chosen.name, `${frameBaseOf(e)}_idle0`);
  const flipX = chosen.flipX;



  const speed = Math.hypot(e.vx, e.vy);
  /*
   * A footfall, not a wobble.
   *
   * The bob ran off the tick at about three cycles a second for every body
   * that was moving at all, and the lean came off the *measured* velocity —
   * which now includes being shoved by other bodies, so its sign flipped
   * constantly and the sprite rocked side to side. On a tank the two together
   * read as a heavy thing squirming.
   *
   * So the bob is driven by **distance travelled**, the same clock as the walk
   * cycle, which makes it a footfall that lands with the stride; and both are
   * scaled by how light the body is, taking the rusher as the reference. A
   * slow heavy archetype barely bobs and barely leans, which is what weight
   * looks like.
   */
  const lightness = Math.min(1, ENEMIES[e.archetype].speed / 112);
  const bob = speed > 12
    // On the same stride as the walk cycle, so the bob lands with a footfall.
    ? Math.sin((e.travelled / strideFor(e.radius)) * Math.PI) * 1.3 * lightness
    : 0;
  const shadowName = `shadow_${ENEMY_FRAME[e.archetype].replace("enemy_", "")}`;
  if (atlas.has(shadowName)) {
    const shadow = scene.add.image(
      e.x, e.y + shadowOffset(atlas, name, shadowName), textureKey, shadowName,
    ).setOrigin(0.5)
      .setScale(shadowScale(atlas, name, shadowName), 1 / ART_SCALE)
      .setDepth(3)
      .setAlpha(e.awake ? 0.5 : 0.34);
    group.add(shadow);
  } else {
    const shadow = scene.add.ellipse(
      e.x, e.y + e.radius * 0.66, e.radius * 1.55, e.radius * 0.62, 0,
    );
    shadow.setFillStyle(0x0d0b1f, e.awake ? 0.4 : 0.28);
    shadow.setDepth(3);
    group.add(shadow);
  }



  const img = scene.add.image(e.x, e.y + bob, textureKey, name)
    .setOrigin(0.5)
    .setDepth(6)
    .setFlipX(flipX);
  /*
   * A waddle for the sheets whose walk cycle has no steps in it. The
   * expansion bodies were delivered with one standing column per facing, and
   * the pipeline's `legs` motion shifts the same pixels the same way for all
   * four walk frames, so their walks are four identical stills (measured: 0%
   * difference, against 23–65% for the drawn cycles). Until they are drawn,
   * the body rocks from foot to foot on its own stride: a small tilt, a lift
   * on each step and a settle as it lands.
   */
  let waddle = 0;
  if (STILL_WALKS.has(e.archetype) && /_walk[0-3]$/.test(name)) {
    const phase = (e.travelled / strideFor(e.radius, e.speed)) * Math.PI * 0.5;
    // Pivot at the feet, so the tilt rocks the body over them rather than spinning it.
    img.setOrigin(0.5, 0.82).setY(img.y + (img.height / ART_SCALE) * 0.32 - Math.abs(Math.sin(phase)) * 1.6);
    waddle = Math.sin(phase) * 0.06;
  }
  // The boss's leap: it rises out of the frame, is gone while airborne, and
  // drops onto the mark (drawn by `drawEnemyBlades`).
  if (e.archetype === "boss" && e.bossCast === "leap" && e.bossCastMs > 0) {
    const elapsed = BOSS_LEAP_MS - e.bossCastMs;
    if (elapsed < BOSS_LEAP_RISE_MS) img.y -= (elapsed / BOSS_LEAP_RISE_MS) * 60;
    else img.setVisible(false);
  }
  // Slamming: a shudder in the plant.
  if (e.archetype === "boss" && e.bossCast === "slam" && e.bossCastMs > 0) img.x += Math.sin(w.tick * 2.3) * 1.2;
  /*
   * Elemental statuses show on the body. The sim has carried burn, poison and
   * slow for a while and nothing about the sprite said so — a burning body
   * looked like a body. The hit flash below still overrides all three.
   */
  /*
   * The variants wear their parents' frames with a tint and a size of their
   * own, so a lancer is not mistaken for a rusher at a glance — the warm
   * cast and the extra tenth are the tell until its own sheet arrives.
   */
  /*
   * The sentinel's barrel, turned on where it last saw the player: "this one
   * aims" is the whole difference from the turret. Its own sprite, pivoted
   * near its left end, over the body.
   */
  if (e.archetype === "sentinel" && e.hp > 0 && e.spawnFadeMs <= 0) {
    const aim = e.awake ? seenPlayer(w, e) : { x: e.x + 1, y: e.y };
    const a = Math.atan2(aim.y - e.y, aim.x - e.x);
    if (atlas.has("weapon_enemy_sentinel_barrel"))
      group.add(scene.add.image(e.x, e.y - 3, textureKey, "weapon_enemy_sentinel_barrel")
        .setOrigin(0.2, 0.5).setRotation(a).setScale(1 / ART_SCALE).setDepth(6.1));
  }
  /*
   * An elite body is **enraged**: the warm pink cast the player picked out
   * on a tinted body and asked for on every elite, plus the ring at its feet
   * below. It goes with the speed and attack rate the sim gives it.
   */
  if (e.affixes.length > 0 && e.hp > 0) img.setTint(0xffa8b8);

  // Fire and poison gauges, as the player has them: filling on hits, the
  // status's clock once it runs.
  if (e.hp > 0 && e.spawnFadeMs <= 0 && (e.burnBuild > 0 || e.poisonBuild > 0 || e.chillBuild > 0)) {
    // Above the armour bar when there is one (it sits at radius + 9).
    const gy = e.y - e.radius - (e.maxArmour > 0 && e.armour > 0 ? 14 : 9);
    const bars: [number, number][] = [];
    if (e.burnBuild > 0) bars.push([e.burnBuild, e.burnMs > 0 ? 0xffb050 : 0xc0602a]);
    if (e.poisonBuild > 0) bars.push([e.poisonBuild, e.poisonMs > 0 ? 0x9ff07a : 0x4f9a40]);
    if (e.chillBuild > 0) bars.push([e.chillBuild, e.frozenMs > 0 ? 0xd8f4ff : 0x6fa8d8]);
    bars.forEach(([fill, colour], i) => {
      const y = gy - i * 3.5;
      group.add(scene.add.rectangle(e.x, y, 16, 2.2, 0x0d0b1f, 0.8).setOrigin(0.5).setDepth(9.6));
      group.add(scene.add.rectangle(e.x - 8, y, 16 * Math.min(1, fill), 2.2, colour, 1).setOrigin(0, 0.5).setDepth(9.7));
    });
  }
  if (e.hp > 0 && e.spawnFadeMs <= 0) {
    if (e.burnMs > 0) {
      // Warm while it burns; the flames off it are `FireFx`'s.
      img.setTint((w.tick >> 2) & 1 ? 0xffb080 : 0xffd8b0);
    } else if (e.poisonMs > 0) {
      img.setTint(0x9fe89f);
      for (let i = 0; i < 2; i++) {
        const u = ((w.tick / 40) + i / 2 + e.id * 0.3) % 1;
        const bubble = scene.add.circle(e.x - 4 + i * 8, e.y - e.radius - u * 12, 1.2 + (1 - u), 0x8fe08f, 0.7 * (1 - u))
          .setDepth(6.5);
        group.add(bubble);
      }
    } else if (e.frozenMs > 0) {
      // Frozen: pale and still, with a glint.
      img.setTint(0xcfefff);
      if ((w.tick >> 3) % 6 === 0)
        group.add(scene.add.circle(e.x + e.radius * 0.4, e.y - e.radius * 0.5, 1.6, 0xffffff, 0.9).setDepth(6.6));
    } else if (e.slowMs > 0) {
      img.setTint(0x9ad8ff);
    }
  }

  /*
   * An elite body is marked as one.
   *
   * The elite affixes change a body's numbers — health, speed, what its
   * shots do — and nothing about how it looked, so an elite room's enemies
   * were ordinary enemies that took longer to die, which reads as the sword
   * being weak rather than the body being strong. A slow additive ring at the
   * feet and a tenth more size say "this one is different" before it has
   * acted, which is when the information is worth having.
   */
  if (e.affixes.length > 0 && e.hp > 0) {
    const pulse = 0.85 + 0.15 * Math.sin(w.tick / 7 + e.id);
    const ring = scene.add.circle(e.x, e.y + e.radius * 0.7, e.radius * 1.35 * pulse, 0xff8a5a, 0.22)
      .setDepth(3.5).setBlendMode(Phaser.BlendModes.ADD);
    ring.setStrokeStyle(1.2, 0xffb37a, 0.55);
    group.add(ring);
  }

  // Leaning into travel costs nothing and reads as weight — from the velocity
  // it is steering at rather than the one it was shoved to.
  const lean = Math.max(-0.14, Math.min(0.14, (e.velX / 900) * lightness));
  img.setRotation((speed > 12 ? lean * (flipX ? -1 : 1) : 0) + waddle);

  const base = (1 / ART_SCALE) * (e.affixes.length > 0 ? 1.1 : 1);

  // A body still arriving is drawn by the spawn block below, awake or not.
  // This branch came first and caught every dormant spawn — which is every
  // wave spawn — so the telegraph and the climb were never seen.
  if (!e.awake && e.spawnFadeMs <= 0) {
    /*
     * Unaware: the drawn idle pair carries it, so there is no faked breath
     * here any more. Legible rather than dimmed into the stonework, because a
     * body that has not noticed the player is information they are planning a
     * route around.
     */
    img.setAlpha(0.92);
    img.setScale(base);
    if (e.hitFlashMs > 0) img.setTintFill(0xffffff);
    group.add(img);
    return;
  }

  /*
   * The attack poses are drawn frames now, so the scale tricks that stood in
   * for them are gone. What is kept is the collapsing ring, because it states
   * the *timing* and a pose cannot: the windup art says an attack is coming
   * and the ring says how long there is left to answer it.
   */
  if (e.attack === "windup") {
    const t = 1 - e.attackMs / MELEE_WINDUP_MS;
    const ring = scene.add.circle(e.x, e.y, e.radius + 22 * (1 - t), 0, 0);
    ring.setStrokeStyle(2, 0xff6a6a, 0.85);
    ring.setDepth(5);
    group.add(ring);
  }

  /*
   * Aiming: the body flashes red, and nothing else.
   *
   * The first version added a closing ring and a line along the firing
   * direction, which was too much furniture for what the cue has to say. A
   * ranged wind-up only needs to answer *something is about to come out of
   * that one*; where it will go is already stated by the body's facing, and a
   * drawn line makes the player read a diagram instead of the fight.
   *
   * A blink rather than a ramp, because a flash is noticed peripherally and a
   * slow fade is not — and peripheral is exactly where this will be, since the
   * player is looking at whatever they are hitting.
   */
  if (e.telegraphMs > 0 && e.pending.length > 0) {
    if (((e.telegraphMs / 70) | 0) % 2 === 0) img.setTint(0xff6a5a);
  }

  /*
   * Armour, as a bar over the head.
   *
   * It was a pulsing ring around the body, which stated *that something is
   * different about this one* and nothing about how much was left or what it
   * would take. A bar answers both, and it is the form every player already
   * knows, so it needs no learning at all.
   *
   * It has to be visible before the player swings, because armour changes what
   * swinging does: while it holds the body cannot be interrupted, and a player
   * who does not know that reads an un-staggering enemy as a broken game.
   */
  if (e.armour > 0 && e.spawnFadeMs <= 0) {
    /*
     * Blue, with a shield at its left end: a yellow bar over a head read as
     * a second health bar, or as nothing. Shield blue is the one blue in the
     * HUD vocabulary not already taken — ice is the pale cyan.
     */
    const W = Math.max(16, e.radius * 2.2);
    const y = e.y + bob - e.radius - 9;
    const back = scene.add.rectangle(e.x - W / 2, y, W, 3, 0x0f1c3a, 0.9)
      .setOrigin(0, 0.5).setDepth(9);
    const fill = scene.add.rectangle(
      e.x - W / 2, y, W * (e.armour / Math.max(1, e.maxArmour)), 3, SHIELD_BLUE, 1,
    ).setOrigin(0, 0.5).setDepth(10);
    group.add(back);
    group.add(fill);
    group.add(shieldMark(scene, atlas, textureKey, e.x - W / 2 - 4, y, 6));
  } else if (e.armourBreakMs > 0) {
    const t = e.armourBreakMs / ARMOUR_BREAK_MS;
    const burst = scene.add.circle(e.x, e.y + bob, e.radius + 3 + 18 * (1 - t), 0, 0);
    burst.setStrokeStyle(2, SHIELD_BLUE, t);
    burst.setDepth(8);
    group.add(burst);
  }

  /*
   * Noticing, and reeling. Both are states the simulation now has and the
   * player could not see, which is the same defect as the poses being faked:
   * feel that only exists in the step function is feel nobody gets.
   */
  if (e.alertMs > 0) {
    // The delivered alert mark, popping up as it notices.
    const pop = Math.min(1, (ALERT_MS - e.alertMs) / 90);
    if (atlas.has("icon_status_alert")) {
      group.add(scene.add.image(e.x, e.y - e.radius - 14 - (1 - pop) * 4, textureKey, "icon_status_alert")
        .setOrigin(0.5).setScale(0.9 * (0.6 + 0.4 * pop)).setDepth(8));
    } else if (label) {
      label(`alert:${e.id}`, e.x, e.y - e.radius - 12, "!", {
        fontFamily: "monospace", fontSize: "12px", color: "#ffe9a8",
      }).setOrigin(0.5).setDepth(8);
    }
  }
  /*
   * **One status mark over the head**, the delivered icons, the one that
   * matters most first: frozen, stunned, burning, poisoned, chilled, reeling.
   * The gauges say how full; the mark says what it is.
   */
  if (e.hp > 0 && e.spawnFadeMs <= 0) {
    const status = e.frozenMs > 0 ? "freeze"
      : e.staggerMs > 400 ? "stun"
      : e.burnMs > 0 ? "burn"
      : e.poisonMs > 0 ? "poison"
      : e.chillBuild > 0.3 ? "chill"
      : e.staggerMs > 0 ? "stagger" : null;
    if (status && atlas.has(`icon_status_${status}`))
      group.add(scene.add.image(e.x + e.radius * 0.9, e.y - e.radius - 8, textureKey, `icon_status_${status}`)
        .setOrigin(0.5).setScale(0.62).setDepth(9.65));
  }
  /*
   * Asleep: a small "z" drifting up, so a sleeper — the body the player can
   * reach first and hit for double — reads as one from across the room.
   */
  if (!e.awake && e.idleRole === "sleeper" && e.hp > 0 && e.spawnFadeMs <= 0 && e.wakeDelayMs <= 0) {
    const u = ((w.tick + e.id * 17) % 90) / 90;
    label?.(`sleep:${e.id}`, e.x + 5 + u * 4, e.y - e.radius - 6 - u * 10, "z", {
      fontFamily: "monospace", fontSize: `${Math.round(7 * ZOOM)}px`, color: "#c9cfe8",
    }).setOrigin(0.5).setScale(1 / ZOOM).setAlpha(0.8 * (1 - u)).setDepth(8);
  }
  /*
   * Braking: the body leans back against its own momentum and throws grit.
   *
   * This is where a charge's weight lives now that the camera does not move.
   * The lean is against the direction it was travelling, which is what a mass
   * arriving looks like, and the dust marks the ground it stopped on.
   */
  if (e.brakeMs > 0) {
    const t = brakeFraction(e);
    // The lean is the pose now (see `enemyPose`), so this is only the last of
    // it — a small tip that eases out as the skid ends.
    img.setRotation(-e.lungeX * 0.12 * t * (flipX ? -1 : 1));
    for (let i = 0; i < 3; i++) {
      const spread = (i - 1) * 0.5;
      const a = Math.atan2(-e.lungeY, -e.lungeX) + spread;
      const d = e.radius * (0.7 + (1 - t) * 1.4);
      const puff = scene.add.circle(
        e.x + Math.cos(a) * d, e.y + Math.sin(a) * d + e.radius * 0.4,
        2 + (1 - t) * 3.5, 0,
      );
      puff.setFillStyle(0xb9b9c6, 0.45 * t);
      puff.setDepth(4);
      group.add(puff);
    }
  }

  if (e.staggerMs > 0) {
    // Jittered against its own clock rather than at random, so it reads as one
    // body being rattled instead of as the sprite flickering.
    img.x += Math.sin(e.staggerMs * 0.9) * 1.6;
    img.setTint(0xffc0b0);
    /*
     * A long stagger is a knockdown, and it gets a mark of its own.
     *
     * A charge that slams into a wall knocks itself out — the player's only
     * lever on an armoured body — and that was being shown with the same
     * faint tint as a chip hit, on a sprite that also carries an armour bar
     * and a jitter. The most important state in the fight was the least
     * visible one. Above the head, where the armour bar is, because that is
     * where the player already looks for what a body is doing.
     */
    if (e.staggerMs > STAGGER_MS) {
      const y = e.y + bob - e.radius - 14;
      for (let i = 0; i < 3; i++) {
        const a = (w.tick / 9) + (i / 3) * Math.PI * 2;
        const star = scene.add.star(
          e.x + Math.cos(a) * 9, y + Math.sin(a) * 3.5, 4, 1.6, 3.6, 0xffe9a8,
        );
        star.setDepth(11).setAlpha(0.9);
        group.add(star);
      }
    }
  }

  if (e.spawnFadeMs > 0) {
    /*
     * Arriving: the ground opens, the body rises out of it, and the landing
     * lands.
     *
     * This used to be an alpha fade with a squash, which reads as a sprite
     * being switched on — and a body that simply appears is the same defect as
     * one that simply stops existing, which the kill pop was added to fix. A
     * spawn is the one moment the player is being told *a new thing is in the
     * room now*, and they have to be told before it can hurt them. The enemy
     * is intangible throughout, so all of this is grace.
     *
     * Three beats in one parameter: the mark opens over the first half, the
     * body climbs out of it over the whole span, and the last fifth is the
     * landing — a short overshoot squash plus a ring off the floor.
     */
    /*
     * Before any of that: the floor says where. Rings widen from the spawn
     * point for `SPAWN_TELEGRAPH_MS`, two of them a beat apart so the eye
     * reads a pulse rather than a mark, in the enemy-threat red that nothing
     * else on the floor uses. No body yet — the body is the answer to the
     * question the rings ask.
     */
    /*
     * The rings and the rise are **one motion**. They were two in sequence —
     * rings alone, then the body — and it read as two unrelated things: a
     * mark that did nothing, then a sprite that arrived from nowhere. Now
     * the rings pulse for the whole arrival and the body climbs out of the
     * ground under them from the first frame, so the pulse is visibly *the
     * ground giving way* to what is coming up through it.
     */
    const total = SPAWN_FADE_MS + SPAWN_TELEGRAPH_MS;
    const t = 1 - e.spawnFadeMs / total;
    for (let k = 0; k < 2; k++) {
      const phase = ((t * 3 + k * 0.5) % 1);
      const r = e.radius * (0.5 + 2.6 * phase);
      const ring = scene.add.circle(e.x, e.y + e.radius * 0.5, r, 0, 0);
      ring.setStrokeStyle(2.4 * (1 - phase * 0.5), 0xff5a4a, 0.95 * (1 - phase) * (1 - t * 0.5)).setDepth(2.5)
        .setScale(1, 0.55);
      group.add(ring);
    }

    // The ground opening: a dark hole that widens and then closes around it.
    const open = Math.min(1, t * 2);
    const hole = scene.add.ellipse(
      e.x, e.y + e.radius * 0.5,
      e.radius * 2.4 * open, e.radius * 0.95 * open, 0,
    );
    hole.setFillStyle(0x120d22, 0.72 * (1 - t * 0.35)).setDepth(2);
    group.add(hole);

    // Climbing out. It is clipped by nothing, so the rise is sold by the body
    // starting low and by the hole sitting over its feet.
    img.y += (1 - t) * e.radius * 1.5;
    // Flickering in over the first half of the climb, solid by the landing.
    const flicker = t < 0.55 ? (((e.id * 7 + Math.floor(t * 22)) & 1) === 0 ? 0.35 : 1) : 1;
    img.setAlpha(Math.min(1, t * 1.6) * flicker);
    // Stretched while rising, then a brief squash as it takes its weight.
    const land = Math.max(0, (t - 0.8) / 0.2);
    const squash = land > 0 ? 1 - Math.sin(land * Math.PI) * 0.18 : 1;
    img.setScale(
      base * (0.82 + 0.18 * t) / squash,
      base * (1.18 - 0.18 * t) * squash,
    );

    if (land > 0) {
      // The landing: one ring off the floor, and grit.
      const ring = scene.add.circle(e.x, e.y + e.radius * 0.5, e.radius * (1 + land * 1.6), 0, 0);
      ring.setStrokeStyle(2, 0x9a8f7a, 0.55 * (1 - land)).setDepth(3);
      group.add(ring);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + e.id;
        const d = e.radius * (0.6 + land * 1.5);
        const grit = scene.add.circle(
          e.x + Math.cos(a) * d, e.y + e.radius * 0.5 + Math.sin(a) * d * 0.4,
          1.8 + (1 - land) * 1.6, 0,
        );
        grit.setFillStyle(0xb9b9c6, 0.5 * (1 - land)).setDepth(4);
        group.add(grit);
      }
    }
  } else if ((e.meleeKind === "bristle" || e.meleeKind === "lance") && e.attack === "windup") {
    // Bracing to drive the spikes out: drawn in and down a touch.
    img.setScale(base * 1.04, base * 0.94);
  } else {
    img.setScale(base);
  }

  /*
   * Being hit is **feedback, not a pose**, so it is applied over whatever the
   * body is doing rather than competing with it.
   *
   * It used to be checked after the pose branches, each of which returned, so
   * an enemy struck while winding up or lunging showed no flash at all —
   * missing precisely when the player was hitting it.
   */
  if (e.hitFlashMs > 0) img.setTintFill(0xffffff);

  group.add(img);
}

/** Door types, in the order doc 003 offers them. */
/**
 * A frame name guaranteed to exist, with the reason this exists at all.
 *
 * **Phaser answers a request for a missing frame with the texture's first
 * frame.** The first frame in this sheet is `boss_p1_idle0`, a 256 px boss, so
 * a single wrong name does not draw nothing — it draws a boss four times the
 * size of the body it replaced, in the middle of a fight, silently. Two
 * separate naming mistakes both surfaced that way.
 *
 * The naming logic is now exhaustively tested against the real sheet, so this
 * should never fire. It exists because the failure mode is so much worse than
 * the bug that causes it: the cost of being wrong here is not a missing sprite
 * but a boss, and a guard is three lines.
 */
function safeFrame(atlas: RecolourableAtlas, name: string, fallback: string): string {
  if (atlas.has(name)) return name;
  // Loud, because silence is what let this reach the screen twice.
  console.warn(`[frames] no "${name}" in the sheet; drew "${fallback}" instead`);
  return atlas.has(fallback) ? fallback : "player_s_idle0";
}

/**
 * Which drawing a projectile uses.
 *
 * Ten bullet frames were delivered — three player families and two enemy
 * ones, each with two frames — and the renderer used exactly one of them for
 * every bullet in the game. So an ice shard and a fire bolt were the same
 * grey dot, and none of them spun.
 *
 * The family comes from the element, because that is the distinction the
 * player has to make at a glance: *can this be walked through, and will it
 * leave something behind*. The second frame is a two-tick flicker, which on a
 * small sprite reads as spin.
 */
function bulletFrame(b: Bullet, tick: number, enemy: boolean): string {
  const phase = (tick >> 2) & 1;
  if (enemy) {
    // `b` is the heavier drawing: used for anything that lands as terrain.
    const family = b.leavesFire || b.element === "fire" ? "b" : "a";
    return `bullet_enemy_${family}_${phase}`;
  }
  const family = b.element === "fire" ? "b" : b.element === "ice" || b.element === "poison" ? "c" : "a";
  return `bullet_player_${family}_${phase}`;
}

/** How long one impact burst lasts: three frames at about 50 ms each. */
const IMPACT_MS = 150;

/**
 * What a spell looks like, by element.
 *
 * The bullet art is three cyan shapes, and the renderer picked one by element
 * and drew it as-is, so a fire bolt, a frost needle and a venom spit were the
 * same pale sprite at different sizes: the player could not tell what they
 * had cast, and nothing else about the shot — no trail, no flash where it
 * left the hand, no mark where it stopped — said "spell" rather than "dot".
 *
 * Everything the spell does on screen is keyed off this table: the sprite's
 * tint (`core`), and the additive glow, trail, cast flash and fizzle
 * (`glow`). `none` is the arcane cyan the sprites were drawn in, so an
 * unelemented shot looks the way the art intended.
 *
 * Doc 008 keeps player bullets more than 90 degrees of hue from the enemy
 * magenta. Fire is the one element that cannot honour that literally — a red
 * fire is unreadable as fire — so it is pushed to amber, about 70 degrees
 * away, and only the glow carries it; the sprite itself stays pale.
 */
const ELEMENT_TINT: Readonly<Record<Element, { core: number; glow: number }>> = {
  none: { core: 0xe4faff, glow: 0x4fd2ff },
  fire: { core: 0xfff1c0, glow: 0xffc44a },
  ice: { core: 0xf2fbff, glow: 0x8fdcff },
  poison: { core: 0xe8ffd4, glow: 0x6fdc5a },
};

/**
 * What a **named spell** looks like, where the element alone is not enough.
 *
 * Element gives a colour, which separates fire from frost and no more: the
 * five unelemented attacks were one cyan dot at five sizes, and a player
 * cannot learn which key they pressed from that. This table is the per-spell
 * layer on top — its own light, and a `shape` the renderer draws differently.
 *
 * Every shape is drawn in code (`projectiles.ts`): a round sprite in a tint
 * made a needle, a spit and a dart the same ball. `lightning` is a bolt along
 * the shot's recent path, which no sprite can carry, because its length
 * changes every frame and an arc between two bodies is a different line each
 * time.
 */
type SpellLook = ProjectileLook;
const SPELL_LOOK: Readonly<Record<string, SpellLook>> = {
  magic_bolt: { core: 0xe4faff, glow: 0x4fd2ff, shape: "dart" },
  shock_arc: { core: 0xffffff, glow: 0x9ad2ff, shape: "lightning" },
  arc_lance: { core: 0xffffff, glow: 0x7fb4ff, shape: "lightning" },
  spark_spray: { core: 0xfff6d6, glow: 0xffd45e, shape: "spark" },
  scatter_shot: { core: 0xffeccc, glow: 0xffa94f, shape: "pellet" },
  stone_shard: { core: 0xe9dcc4, glow: 0xb08a58, shape: "rock" },
  ember_dart: { core: 0xfff1c0, glow: 0xff8a3a, shape: "flame" },
  frost_needle: { core: 0xf2fbff, glow: 0x7fd0ff, shape: "needle" },
  venom_spit: { core: 0xe8ffd4, glow: 0x6fdc5a, shape: "glob" },
  glacier_spike: { core: 0xf2fbff, glow: 0x7fd0ff, shape: "spike" },
  void_orb: { core: 0xd9c6ff, glow: 0x7a4fd6, shape: "orb" },
  plague_bloom: { core: 0xe8ffd4, glow: 0x6fdc5a, shape: "bubbles" },
  cinder_burst: { core: 0xfff1c0, glow: 0xff8a3a, shape: "flame" },
  spirit_blades: { core: 0xf4f0ff, glow: 0xb9a7ff, shape: "blade" },
  spirit_ally: { core: 0xe6fff4, glow: 0x7fe8c0, shape: "dart" },
};

/** A shot with no spell of its own takes its element's shape. */
const ELEMENT_SHAPE: Readonly<Record<Element, SpellLook["shape"]>> = {
  none: "dart", fire: "flame", ice: "needle", poison: "glob",
} as Record<Element, SpellLook["shape"]>;

/** The look for a shot: its spell's if it has one, else its element's. */
function lookOf(b: Bullet, spells: World["spells"]): SpellLook {
  const slot = b.spellIndex >= 0 ? spells[b.spellIndex] : null;
  const named = slot ? SPELL_LOOK[slot.item.base] : undefined;
  if (named) return named;
  const t = ELEMENT_TINT[b.element] ?? ELEMENT_TINT.none;
  return { core: t.core, glow: t.glow, shape: ELEMENT_SHAPE[b.element] ?? "dart" };
}

/**
 * A lightning bolt along a path: the main channel and a fork or two.
 *
 * **Fractal, not a zigzag.** The first version threw one knee per recorded
 * point to alternating sides, and the recorded points of a shot flying
 * straight are evenly spaced — so every bolt was the same regular zigzag, a
 * spring. Lightning is self-similar: a few big bends, each carrying smaller
 * ones. So the path is first **simplified** (a straight flight keeps only its
 * two ends; a seeking spark keeps the bends it really made), then each
 * stretch is split at its midpoint and the midpoint pushed a random distance
 * to a random side, recursively, the push shrinking each level. Sizes and
 * sides are irregular, the ends stay pinned to where the shot is and where it
 * came from, and a short fork or two leaves the channel.
 *
 * Seeded rather than random, so the harness and the browser draw the same
 * bolt on the same tick.
 */
interface BoltShape {
  readonly main: readonly { x: number; y: number }[];
  readonly forks: readonly (readonly { x: number; y: number }[])[];
}

function lightningBolt(pts: readonly { x: number; y: number }[], seed: number, scale: number): BoltShape {
  let n = 0;
  const rand = () => {
    const v = Math.sin((n++ + 1) * 127.1 + seed * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const guide = simplifyPath(pts, 3);
  if (guide.length < 2) return { main: guide, forks: [] };
  const displace = (
    out: { x: number; y: number }[], a: { x: number; y: number }, c: { x: number; y: number }, amp: number,
  ): void => {
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 6 || amp < 0.6) { out.push(c); return; }
    const off = (rand() * 2 - 1) * amp;
    // A little along the line too, so the knees are not evenly spaced.
    const along = 0.5 + (rand() - 0.5) * 0.3;
    const m = { x: a.x + dx * along - (dy / len) * off, y: a.y + dy * along + (dx / len) * off };
    displace(out, a, m, amp * 0.55);
    displace(out, m, c, amp * 0.55);
  };
  const main: { x: number; y: number }[] = [guide[0]!];
  let total = 0;
  for (let i = 1; i < guide.length; i++) {
    const a = guide[i - 1]!;
    const c = guide[i]!;
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    total += len;
    displace(main, a, c, Math.min(10 * scale + 2, len * 0.2));
  }
  const forks: { x: number; y: number }[][] = [];
  if (total > 26 && main.length > 4) {
    const count = rand() < 0.45 ? 2 : 1;
    for (let f = 0; f < count; f++) {
      const i = 1 + Math.floor((0.2 + rand() * 0.55) * (main.length - 2));
      const p = main[i]!;
      const q = main[Math.min(main.length - 1, i + 1)]!;
      const heading = Math.atan2(q.y - p.y, q.x - p.x) + (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.5);
      const reach = Math.min(28, total * (0.14 + rand() * 0.16));
      const end = { x: p.x + Math.cos(heading) * reach, y: p.y + Math.sin(heading) * reach };
      const fork: { x: number; y: number }[] = [p];
      displace(fork, p, end, reach * 0.3);
      forks.push(fork);
    }
  }
  return { main, forks };
}

/**
 * Strokes a bolt: the channel at `width`, **fading toward its tail** so the
 * streak dies off behind the head rather than ending in a cut; its forks
 * thinner and fainter.
 */
function strokeBolt(
  g: Phaser.GameObjects.Graphics, bolt: BoltShape, colour: number, width: number, alpha: number,
): void {
  const main = bolt.main;
  if (main.length < 2) return;
  const lens = [0];
  for (let i = 1; i < main.length; i++)
    lens.push(lens[i - 1]! + Math.hypot(main[i]!.x - main[i - 1]!.x, main[i]!.y - main[i - 1]!.y));
  const total = lens[lens.length - 1]! || 1;
  const fadeAt = (d: number) => {
    const t = d / total;
    return t * t * (3 - 2 * t);
  };
  for (let i = 1; i < main.length; i++) {
    const k = fadeAt((lens[i - 1]! + lens[i]!) / 2);
    g.lineStyle(width * (0.45 + 0.55 * k), colour, alpha * (0.08 + 0.92 * k));
    g.lineBetween(main[i - 1]!.x, main[i - 1]!.y, main[i]!.x, main[i]!.y);
  }
  for (const f of bolt.forks) {
    if (f.length < 2) continue;
    // A fork is as bright as the channel where it leaves it, and dies out.
    const start = main.indexOf(f[0]!);
    const k = start >= 0 ? fadeAt(lens[start]!) : 0.6;
    for (let i = 1; i < f.length; i++) {
      const u = 1 - i / f.length;
      g.lineStyle(Math.max(0.6, width * 0.5), colour, alpha * 0.75 * k * (0.3 + 0.7 * u));
      g.lineBetween(f[i - 1]!.x, f[i - 1]!.y, f[i]!.x, f[i]!.y);
    }
  }
}

/** The last `px` of a path, ending at its head, cut mid-segment where it runs out. */
function tailOf(pts: readonly { x: number; y: number }[], px: number): { x: number; y: number }[] {
  if (pts.length < 2) return [...pts];
  const out: { x: number; y: number }[] = [pts[pts.length - 1]!];
  let left = px;
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i]!;
    const b = pts[i - 1]!;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d >= left) {
      const t = left / Math.max(d, 1e-6);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      break;
    }
    out.push(b);
    left -= d;
  }
  return out.reverse();
}

/** How long a lightning shot's streak is behind its head. */
const LIGHTNING_TAIL_PX = 96;

/** Ramer-Douglas-Peucker: the fewest points within `tol` px of the path. */
function simplifyPath(pts: readonly { x: number; y: number }[], tol: number): { x: number; y: number }[] {
  const clean = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) > 0.5);
  if (clean.length <= 2) return [...clean];
  const a = clean[0]!;
  const c = clean[clean.length - 1]!;
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < clean.length - 1; i++) {
    const d = Math.abs((clean[i]!.x - a.x) * dy - (clean[i]!.y - a.y) * dx) / len;
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= tol) return [a, c];
  const left = simplifyPath(clean.slice(0, at + 1), tol);
  return [...left.slice(0, -1), ...simplifyPath(clean.slice(at), tol)];
}

/** The flash where a shot is born: at the hand, or where a carrier bursts. */
const CAST_MS = 140;
/** The fizzle where a shot stops without a body: a wall, or its own lifetime. */
const PUFF_MS = 170;
/** Afterimages behind a shot, one sim step apart; doc 008's "short alpha trail". */
const TRAIL_GHOSTS = 3;
/** Positions a lightning shot remembers: about a sixth of a second of flight. */
const TRAIL_POINTS = 10;

/**
 * How tall the reward's beam of light stands, in world px.
 *
 * Tall enough to clear the walls and be seen from the far corner of the room,
 * which is the whole job: the object itself is 32 px on a floor of the same
 * value, and a landmark that has to be hunted for is not a landmark.
 */
const REWARD_BEAM_H = 190;

/**
 * What a gold room pays.
 *
 * Larger than the gold *card* in a mixed offer, because taking that card
 * costs two other cards while a gold room costs a whole room — the player
 * gave up a spell, an affix and a stat by walking through that portal, and
 * the payout has to be worth a room rather than worth a card.
 */
const GOLD_ROOM_VALUE = GOLD_CARD_VALUE * 2;

/**
 * What the merchant charges, by kind. Doc 003's economy: 15 / 30 / 50 for
 * common, uncommon and rare, and a combat room pays 10 to 15.
 *
 * A stat is the cheapest because it is the safest — it always does something.
 * A spell is the most expensive because it can change what the build *is*, and
 * the merchant is the last place a run can still change direction.
 */
/**
 * A damage number's colour: armour grey, the sword white, an element or a
 * spell school in its own colour, so what dealt a number can be read off it.
 */
function damageColour(what: string): string {
  const [kind, tag] = what.split(":");
  if (kind === "armour") return "#7fa8ff";
  if (tag === "shatter") return "#e8fbff";
  if (kind === "dot") return tag === "burn" ? "#ffb050" : "#9ff07a";
  // The three elements only: fire, ice, poison. Lightning is not an element.
  const byTag: Record<string, string> = { fire: "#ffb050", ice: "#9ad8ff", poison: "#9ff07a" };
  return (tag && byTag[tag]) || "#ffffff";
}

/** The four build styles of doc 003's intent screen, and what each starts with. */
const STYLES: readonly { id: "spam" | "nuke" | "area" | "dot" | "melee"; name: string; desc: string }[] = [
  { id: "spam", name: "Barrage", desc: "Many cheap casts, kept up. Fast spells that chain and fan out." },
  { id: "nuke", name: "Heavy", desc: "Few big hits, placed well. Slow, expensive spells that end fights." },
  { id: "area", name: "Crowd", desc: "Hit many at once. Bursts, rings and ground that rewards a bunched room." },
  { id: "dot", name: "Affliction", desc: "Burn and poison. Let it tick, and keep moving while it does." },
  { id: "melee", name: "Blade", desc: "Live in sword range. Spells that circle and strike close, cast by the sword itself." },
];
const STYLE_START: Readonly<Record<"spam" | "nuke" | "area" | "dot" | "melee", string>> = {
  spam: "shock_arc", nuke: "stone_shard", area: "scatter_shot", dot: "ember_dart", melee: "spirit_blades",
};

const DAMAGE_NUMBERS_KEY = "jr-damage-numbers";
const ROOM_PARAMS_KEY = "jr-room-params";
const MUTE_KEY = "jr-muted";
const SHAKE_KEY = "jr-shake";
const SHAKE_SETTINGS = ["on", "reduced", "off"] as const;
type ShakeSetting = (typeof SHAKE_SETTINGS)[number];
/** How much of the trauma each setting lets reach the camera. */
const SHAKE_LEVEL: Readonly<Record<ShakeSetting, number>> = { on: 1, reduced: 0.4, off: 0 };
/** The camera's largest offset at full trauma, in world px. */
const SHAKE_MAX_PX = 6;
const DEALT_KEY = "jr-damage-dealt";
const TAKEN_KEY = "jr-damage-taken";
const INVINCIBLE_KEY = "jr-invincible";

/** One hit spark; see `PlayScene.drawFx`. */
interface FxSpark {
  x: number; y: number; vx: number; vy: number;
  ms: number; life: number; size: number; colour: number; gravity: number;
}

/** How long E is held over a floor spell to take it apart. */
const FLOOR_HOLD_MS = 600;
/** A press released sooner than this is a tap: pick up, not the start of a hold. */
const FLOOR_TAP_MS = 200;

/** A spell lying on the floor, as it was when it came off its key. */
interface FloorSpell {
  x: number; y: number;
  itemId: string; level: number; affixes: AttachedAffix[];
  label: string; value: number;
  img: Phaser.GameObjects.Image | null; glow: Phaser.GameObjects.Arc;
}

/** A held spell's shape, as the card pool reads it. */
type HeldShape = ReturnType<typeof itemShape>;

/** A room's offer questions, built before the room is planned; see `offerRequest`. */
interface OfferAsk {
  readonly kind: RewardCardKind;
  readonly promise: OfferPromise;
  readonly request: OfferRequest;
}

/** What a vendor's shelf stocks: one card of each kind gold buys. */
const SHELF_KINDS = ["stat", "affix", "spell"] as const;

/** One line of the plan page's scrolling tabs. */
interface PlanLine {
  readonly text: string;
  readonly color: string;
  readonly indent?: number;
  readonly px?: number;
  /** A little space above: the start of a request. */
  readonly gap?: boolean;
}

/** Breaks text at spaces into lines of at most `max` characters. */
function wrapWords(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && (line + " " + word).length > max) { out.push(line.trimEnd()); line = ""; }
    line = line ? `${line} ${word}` : word;
    while (line.length > max) { out.push(line.slice(0, max)); line = line.slice(max); }
  }
  if (line.trim()) out.push(line.trimEnd());
  return out.length ? out : [""];
}
/** The difficulty multiples the settings step through. */
const MULT_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function readSetting(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return MULT_STEPS.includes(v) ? v : fallback;
  } catch { return fallback; }
}


/** Enemy shots at least this fast (px/s) are drawn as tracers. */
const TRACER_SPEED = 190;

/** Muzzle flash size by the weapon's weight. */
const MUZZLE_WEIGHT: Readonly<Record<string, "s" | "m" | "l">> = {
  tank: "l", boss: "l", turret: "l", sentinel: "l",
  shooter: "m", orbiter: "m", summoner: "m", snarecaster: "m",
};

/** When each of the warden blast's six baked frames ends, in ms from the shot. */
const BLAST_FRAME_MS = [45, 110, 220, 380, 600, 900] as const;

/** Bodies whose delivered walk frames are all the same drawing; see the waddle in the body renderer. */
const STILL_WALKS: ReadonlySet<string> = new Set(["warden", "bellringer", "snarecaster", "delver", "cinderling"]);

/** How long a lesson stays up. */
const TEACH_MS = 4500;
const LESSONS: Readonly<Record<string, string>> = {
  ward: "Stand on the link to cut it",
};

const SHOP_PRICE: Readonly<Record<string, number>> = {
  stat: 20, affix: 30, spell: 45, gold: 0,
};

/**
 * What the merchant stocks.
 *
 * Never the door's kind, and never gold. The merchant's room is reached through
 * a portal like any other, so following that portal's promise would have meant
 * a gold door leading to a shop that scattered coins and sold nothing — which
 * is what happened. What the player came here for is to *spend*, so the stock
 * is one of the three things gold can buy.
 */
function shopKind(rng: { next(): number }): RewardCardKind {
  const kinds: RewardCardKind[] = ["stat", "affix", "spell"];
  return kinds[Math.floor(rng.next() * kinds.length)] ?? "stat";
}

/**
 * Font sizes and line leading the card body will try, in order.
 *
 * Stepping rather than scaling continuously, because a monospace pixel font at
 * a fractional size resamples and the card text is the smallest text in the
 * game — the one place a blur is least affordable.
 */
const BODY_FITS: readonly (readonly [number, number])[] = [[7, 1], [7, 0], [6, 0], [6, -1], [5, 0]];

/**
 * A run seed: the URL's `?seed=` if given, else a short random one. Random
 * from the clock and `Math.random`, which is exactly as unpredictable as a
 * roguelike needs and reproducible the moment it is written down.
 */
function directorArm(): DirectorArm {
  const asked = new URLSearchParams(window.location.search).get("director");
  return asked === "jev" || asked === "random" ? asked : "rule";
}

/** The proxy the Jev arm posts to: the dev server's, or a hosted build's own (doc 009). */
const DECIDE_URL: string =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.["VITE_DECIDE_URL"] || "/api/decide";

function freshSeed(): string {
  const pinned = new URLSearchParams(window.location.search).get("seed");
  if (pinned) return pinned;
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
}

/** `magic_bolt` as "Magic Bolt", for a HUD line. */
function titleOfId(id: string): string {
  return id.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** The keys the three spells are bound to, in slot order. */
const SPELL_KEYS = ["U", "I", "O"] as const;
/**
 * How far above the body's position the player sprite is drawn, in world px.
 *
 * The simulation's circle is the **feet**: a radius-7 body against a wall
 * stands with its centre 7 px from the stone. Drawn centred on that point,
 * a 28 px sprite put its boots 14 px past it — visibly inside the wall below.
 * Lifting the drawing puts the boots on the circle, which is where a
 * top-down body's contact with the floor is read. The shadow, the flame, the
 * sword and the dash ghosts all move with it; the hit tests do not.
 */
const BODY_LIFT = 7;
/** A card frame's decoration: an L tick in each corner and a fine inner line. */
function drawCardDeco(
  g: Phaser.GameObjects.Graphics, r: { x: number; y: number; w: number; h: number }, colour: number,
): void {
  g.clear();
  const inset = 3;
  const len = 8;
  const x0 = r.x + inset;
  const y0 = r.y + inset;
  const x1 = r.x + r.w - inset;
  const y1 = r.y + r.h - inset;
  g.lineStyle(1, colour, 0.28);
  g.strokeRect(x0, y0, x1 - x0, y1 - y0);
  g.lineStyle(2, colour, 1);
  for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
    g.beginPath();
    g.moveTo(cx + sx * len, cy);
    g.lineTo(cx, cy);
    g.lineTo(cx, cy + sy * len);
    g.strokePath();
  }
}

/** A card's look by rarity: its label, frame, ground and corner decoration. */
const RARITY_STYLE: Readonly<Record<"common" | "rare" | "legendary", {
  label: string; text: string; stroke: number; strokeOn: number; fill: number; fillOn: number; corner: number;
}>> = {
  common: { label: "COMMON", text: "#c9cfe8", stroke: 0x5a628f, strokeOn: 0xe8e3d8, fill: 0x161334, fillOn: 0x221d46, corner: 0x8792b5 },
  rare: { label: "RARE", text: "#6fb4ff", stroke: 0x3f7fe0, strokeOn: 0x9fd0ff, fill: 0x13203f, fillOn: 0x1b2c58, corner: 0x5a9ef0 },
  legendary: { label: "LEGENDARY", text: "#ffb040", stroke: 0xd08a30, strokeOn: 0xffd080, fill: 0x2a1d18, fillOn: 0x3a2818, corner: 0xe8a040 },
};

/** The colour of each kind of figure on a numbers line; see `statRow`. */
const TONE_COLOUR: Readonly<Record<string, string>> = {
  mana: "#6fb4ff", damage: "#ffffff", fire: "#ffb050", ice: "#9ad8ff", poison: "#9ff07a",
  trait: "#c9cfe8", mod: "#f5a623", grade: "#ffd45e",
};

/** Armour's colour: a shield blue, distinct from ice's pale cyan. */
const SHIELD_BLUE = 0x4f86ff;

/** The armour mark: the delivered `ui_shield`, or the drawn shield when the sheet has none. */
function shieldMark(scene: Phaser.Scene, atlas: RecolourableAtlas, key: string, x: number, y: number, size: number): Phaser.GameObjects.Image | Phaser.GameObjects.Polygon {
  if (atlas.has("ui_shield"))
    return scene.add.image(x, y, key, "ui_shield").setOrigin(0.5).setDisplaySize(size * 1.25, size * 1.25).setDepth(10.5);
  return shieldIcon(scene, x, y, size);
}

/** A small heater shield, centred at `x, y`, `size` px tall: the mark beside an armour bar. */
function shieldIcon(scene: Phaser.Scene, x: number, y: number, size: number): Phaser.GameObjects.Polygon {
  const w = size * 0.8;
  const h = size;
  return scene.add.polygon(x, y, [0, 0, w, 0, w, h * 0.5, w / 2, h, 0, h * 0.5], SHIELD_BLUE, 1)
    .setStrokeStyle(1, 0x0d0b1f, 1).setDepth(10.5);
}


/** The two resource bars share one left edge and one width. */
const HUD_BAR_X = 22;
const HUD_BAR_W = 96;
/** Room the rage segments take between the mana pips and the spell names. */
const RAGE_W = 44;

/** What a card is, said in a word and a colour. See `showRewards`. */
const KIND_TAG: Readonly<Record<RewardCardKind, { label: string; color: string }>> = {
  spell: { label: "SPELL", color: "#8fdcff" },
  affix: { label: "AFFIX", color: "#d9a5ff" },
  stat: { label: "STAT", color: "#a8f0a0" },
  gold: { label: "GOLD", color: "#ffd45e" },
};

/**
 * The merchant's and the boss's rooms, which the Director does not plan.
 * The same fixed rooms the harness uses.
 */
/** The style screen's demo room: an open arena with every interior cell cleared to floor. */
function openDemoRoom(): RoomPlan {
  const base = fixedRoom("shop", new RngSource("demo-room").stream("room"));
  const grid = Uint8Array.from(base.grid);
  for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
  return { ...base, grid, zones: base.zones.map((z) => ({ ...z, feature: "none" })) };
}

function fixedRoom(stage: "shop" | "boss", rng: ReturnType<RngSource["stream"]>): RoomPlan {
  const space = stage === "boss" ? BOSS_ARCHETYPES[0]!.id : "open_arena";
  const g = generateRoom(
    { space, symmetry: "mirrored", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", stage === "boss" ? "boss" : "combat", rng, { plain: true },
  );
  return toRoomPlan(g, { id: `fixed-${stage}`, seed_key: `fixed-${stage}`, reward_kind: "item", params_source: "rule" });
}

/**
 * A room feature's art, and whether it lies on the floor or stands on it.
 *
 * The old version tested for three hazards and returned crumbling floor for
 * **everything else** — so a brazier, a mirror pillar, a mana font and a
 * turret mount were all drawn as broken paving, while `prop_brazier`,
 * `prop_mirror`, `prop_manawell` and `prop_pillar` sat unused in the sheet.
 * Four of the eight features in the library were lying about what they were.
 *
 * Floor features are a texture on the ground; the others are objects standing
 * on it, which is a different depth and a different footprint, so the two are
 * distinguished here rather than at the call site.
 */
interface FeatureArt {
  readonly frame: string;
  readonly standing: boolean;
  /** Two-frame flicker for anything with a light in it. */
  readonly pair?: string;
  /**
   * Drawn as one surface across the zone rather than one panel per cell.
   *
   * The ice, poison and spike frames are each a framed plate: a stone rim
   * with the hazard inside it. Stamped per cell, a 3 x 3 ice patch was nine
   * little windows in the floor, which is not what a patch of ice is. These
   * are composed instead: each cell is four quarter-tiles, and a quarter that
   * borders another cell of the same zone takes the frame's **middle** rather
   * than its edge, so the rim runs round the outside of the zone and the
   * inside is continuous. See `slabFrame`.
   */
  readonly slab?: true;
  /** Stood as a solid prop by the simulation rather than drawn per cell. */
  readonly fixture?: true;
  /** Nothing drawn: the feature's picture is what it spawns. */
  readonly hidden?: true;
  /**
   * Whether `pair` is a **state** the player should read, rather than a second
   * drawing of the same surface. Spikes cycle in and out and a brazier
   * gutters; ice, poison and broken paving simply are.
   */
  readonly cycles?: true;
}

/**
 * Which frame a prop shows. The breakables have a drawn intact / cracked /
 * broken triple; the brazier flickers while it stands and leaves shards when
 * it does not; the font pulses.
 */
function propFrame(p: { kind: string }, state: "intact" | "cracked" | "broken", tick: number): string {
  // The font is carved stone with a light in it: never broken, always lit.
  if (p.kind === "pillar") return state === "broken" ? "prop_break_urn_2" : "prop_pillar_0";
  if (p.kind === "brazier")
    return state === "broken" ? "prop_break_urn_2" : `prop_brazier_${(tick >> 5) & 1}`;
  return `prop_break_${p.kind}_${state === "intact" ? 0 : state === "cracked" ? 1 : 2}`;
}

function featureArt(feature: string): FeatureArt {
  // Both spike frames exist: 0 is retracted and 1 is out, which is a threat
  // that visibly cycles rather than a permanent texture.
  if (feature.includes("spike"))
    // Plates, not a slab: the composed interior did not match a lone plate,
    // and a row of plates is what a spike strip is.
    return { frame: "hazard_spike_0", standing: false, pair: "hazard_spike_1", cycles: true };
  if (feature.includes("poison"))
    return { frame: "hazard_poison_0", standing: false, pair: "hazard_poison_1", slab: true };
  if (feature.includes("ice"))
    return { frame: "hazard_ice_0", standing: false, pair: "hazard_ice_1", slab: true };
  if (feature.includes("crumble"))
    return { frame: "hazard_crumble_0", standing: false, pair: "hazard_crumble_1" };
  if (feature.includes("brazier"))
    return { frame: "prop_brazier_0", standing: true, pair: "prop_brazier_1", fixture: true, cycles: true };
  if (feature.includes("turret_mount")) return { frame: "prop_pillar_0", standing: true, hidden: true };
  return { frame: "hazard_crumble_0", standing: false };
}

/** Backing store in physical pixels: art resolution times the pixel ratio. */
export const VIEW = {
  width: Math.round(VIEW_W * ZOOM),
  height: Math.round((VIEW_H + HUD_H) * ZOOM),
};

/**
 * Floor frames. `tile_floor_3` is a drain grate, which is an object rather
 * than a texture: scattering it like wear puts a drain on one tile in eight
 * and the room reads as a sewer grid. Wear (1 and 2) scatters; drains are
 * placed, two per room, at hashed floor cells.
 */
function hash2(x: number, y: number): number {
  return ((x * 73856093) ^ (y * 19349663)) >>> 0;
}

function floorFrame(x: number, y: number, drains: ReadonlySet<number>): string {
  if (drains.has(y * GRID_W + x)) return "tile_floor_3";
  const h = hash2(x, y);
  if (h % 6 === 0) return `tile_floor_${1 + (h >>> 3) % 2}`;
  // Five clean layouts of stone — 0 and the delivered 4 to 7 — so the floor
  // does not repeat one flagstone pattern across the room.
  return `tile_floor_${[0, 4, 5, 6, 7][(h >>> 5) % 5]}`;
}

/** Two drains per room, deterministic in the grid so they never flicker. */
function drainCells(grid: Uint8Array): Set<number> {
  const floor: number[] = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] === Tile.Floor) floor.push(i);
  const out = new Set<number>();
  if (floor.length === 0) return out;
  for (let n = 0; n < 2; n++) {
    const pick = floor[(hash2(n + 1, floor.length) % floor.length)];
    if (pick !== undefined) out.add(pick);
  }
  return out;
}

/**
 * Picks the wall frame from which sides face open floor, so a wall gets its
 * lit cap and reads as a wall. Drawing `tile_wall_c` everywhere leaves the
 * blocks flat and nearly indistinguishable from the floor, which in a bullet
 * hell means not knowing where you can move.
 */
/**
 * Which wall frame belongs at `x, y`, from the full four-neighbour mask.
 *
 * The previous version tested the neighbours as a chain of `if` statements and
 * returned on the first match, which lost information and drew visibly broken
 * geometry in three cases:
 *
 * - a wall with three open sides (a stub end) matched the first two-sided
 *   branch and was drawn as a corner, so its lit edge stopped in mid-air;
 * - an isolated wall tile, open on all four sides, was likewise a corner;
 * - a wall one tile thick, open north *and* south, was drawn with only its
 *   north edge, so its south edge never appeared at all. That is the common
 *   case, because every interior wall segment an archetype produces is one
 *   tile thick.
 *
 * A mask has exactly sixteen cases and cannot lose information, and the sheet
 * now carries all sixteen, so this is a direct lookup.
 */
const N = 1, E = 2, S = 4, W = 8;

/** The frame each mask of open sides wants. Names list the open sides. */
const WALL_CASE: readonly string[] = (() => {
  const t = new Array<string>(16);
  t[0] = "solid";
  t[N] = "n"; t[E] = "e"; t[S] = "s"; t[W] = "w";
  t[N | E] = "ne"; t[E | S] = "es"; t[S | W] = "sw"; t[W | N] = "wn";
  t[N | S] = "ns"; t[E | W] = "ew";
  t[N | E | S] = "nes"; t[E | S | W] = "esw"; t[S | W | N] = "swn"; t[W | N | E] = "wne";
  t[N | E | S | W] = "nesw";
  return t;
})();

/** A solid with open floor on all four sides: a column, not a wall. */
function isolatedSolid(grid: Uint8Array, x: number, y: number): boolean {
  const open = (dx: number, dy: number): boolean => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) return false;
    return visuallyOpenTile(grid[ny * GRID_W + nx]!);
  };
  return open(0, -1) && open(0, 1) && open(-1, 0) && open(1, 0);
}

/** Open floor on both sides of one axis: a one-tile-thick wall. */
function thinWall(grid: Uint8Array, x: number, y: number): boolean {
  const open = (dx: number, dy: number): boolean => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) return false;
    return visuallyOpenTile(grid[ny * GRID_W + nx]!);
  };
  return (open(0, -1) && open(0, 1)) || (open(-1, 0) && open(1, 0));
}

function wallFrame(grid: Uint8Array, x: number, y: number): string {
  const open = (dx: number, dy: number): boolean => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) return false;
    return visuallyOpenTile(grid[ny * GRID_W + nx]!);
  };
  let mask = 0;
  if (open(0, -1)) mask |= N;
  if (open(1, 0)) mask |= E;
  if (open(0, 1)) mask |= S;
  if (open(-1, 0)) mask |= W;

  // A direct lookup with nothing to fall back to. The sheet carries all
  // sixteen cases, and the approximation table that stood in for the missing
  // seven is gone: while it existed it also silently remapped `solid` to a
  // name the new sheet no longer has, which drew the border walls as pieces
  // of the player.
  return `tile_wall_${WALL_CASE[mask]!}`;
}

/** Cells rendered with floor art must also open the neighbouring wall cap. */
function visuallyOpenTile(tile: number): boolean {
  return tile === Tile.Floor || tile === Tile.Prop;
}
