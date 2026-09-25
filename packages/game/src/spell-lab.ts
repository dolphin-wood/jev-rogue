/**
 * The spell lab: the debug panel's SPELLS tab, opened with `?lab=spells`.
 *
 * Looking at one spell meant playing to it, and comparing two meant a run
 * that offered both. The lab is the real game — the same simulation,
 * renderer, effects and sounds — with the run replaced by a practice arena:
 * any of the thirty-nine spells on any key, at any level and with any affix
 * that fits it, cast by hand or by the lab itself, against bodies that stand
 * up again, with the fight slowed, paused or stepped. The gallery walks
 * through every spell in turn, so the whole pool can be watched in one
 * sitting.
 *
 * Nothing here runs outside the lab. The scene makes a `SpellLab` only when
 * the URL asks for one (`spellLabAsked`), and every hook it offers the scene
 * (`input`, `afterStep`, `frame`) does nothing unless the world in play is
 * the arena the lab built — a room entered any other way is left alone.
 *
 * Two halves: `SpellLab`, the controller that owns the arena and drives the
 * player, and `SpellLabPanel`, the tab's DOM, built once like the boss lab's.
 */

import {
  AFFIX_SLOTS, ARCHETYPES, GRID_H, GRID_W, ITEMS, MELEE_ATTACKS, NO_INPUT, SPELL_AFFIXES, SPELL_DAMAGE_SCALE,
  SPELL_LEVEL_MAX, STYLE_CARDS, TILE_PX, Tile, acquire, affixFitsSpell, bankOf, castShockwave, chargeMsOf,
  chargeShare, chargesOf, itemShape, makeEnemy, merchantHall, slotCost, spellAffixById, spellReady,
  statusForecast,
} from "@jr/core";
import type { AttachedAffix, Enemy, EnemyId, Input, RoomPlan, SpellShape, World } from "@jr/core";
import { contentName } from "./i18n/index.ts";

/** Whether this page asked for the spell lab. */
export function spellLabAsked(): boolean {
  return new URLSearchParams(globalThis.location?.search ?? "").get("lab") === "spells";
}

/* ------------------------------------------------------------------------ *
 * The arena.
 * ------------------------------------------------------------------------ */

/** What stands in the arena, each on its own switch. */
export interface LabStage {
  /** One body that stands where it is put, and walks back there after a knock. */
  pinned: boolean;
  /** Six bodies bunched together, for chains, bursts and rings. */
  pack: boolean;
  /** One body walking back and forth, for spells that have to follow. */
  mover: boolean;
  /** A body that shoots the player on a clock, for Counter Stance to answer. */
  attacker: boolean;
  /** A patch of grass round the targets, for fire to run through. */
  grass: boolean;
  /** A pillar between the player and the pinned body. */
  pillar: boolean;
  /** A short wall below it. */
  wall: boolean;
}

/** What one key holds. */
export interface LabKey {
  readonly spell: string;
  readonly level: number;
  readonly affixes: readonly AttachedAffix[];
}

/** The arena's size in cells: wider than the view, so the camera rests against its left wall. */
const ROOM_W = 22;
const ROOM_H = 11;
/** Where the player stands, px: left of the view's middle, so the targets are clear of the panel. */
const HOME = { x: 5.5 * TILE_PX, y: 5.5 * TILE_PX };
/** Where a spell that works at arm's length is cast from: in among the targets. */
const CLOSE_HOME = { x: HOME.x + 56, y: HOME.y + 30 };
const PINNED_AT = { x: HOME.x + 100, y: HOME.y };
/** The pack: three by two, a body's width apart. */
const PACK_AT: readonly { x: number; y: number }[] = [0, 1, 2].flatMap((c) => [0, 1].map((r) => ({
  x: HOME.x + 130 + c * 20, y: HOME.y - 12 + r * 24,
})));
/** The mover's beat: up and down beyond the pack, clear of the grass, the pillar and the wall. */
const MOVER_X = HOME.x + 230;
const MOVER_Y0 = HOME.y - 90;
const MOVER_Y1 = HOME.y + 90;
const MOVER_SPEED = 55;
const ATTACKER_AT = { x: HOME.x + 60, y: HOME.y - 64 };
/** How often the attacker shoots, and how fast. */
const ATTACK_EVERY_MS = 1800;
/** Its first shot comes sooner, so a short gallery slot still sees a stance answer one. */
const ATTACK_FIRST_MS = 700;
const ATTACK_SHOT_SPEED = 170;
/** The grass: the cells between the player and the targets, and under them. */
const GRASS_CELLS: readonly (readonly [number, number])[] = [6, 7, 8, 9, 10, 11].flatMap((x) => [4, 5, 6].map((y) => [x, y] as const));
const PILLAR_CELL = [7, 5] as const;
const WALL_CELLS: readonly (readonly [number, number])[] = [[8, 7], [8, 8]];
/** Burnt grass grows back this long after the last of it stopped burning. */
const GRASS_REGROW_MS = 2500;
/** A fallen body stands again after this long. */
const RESPAWN_MS = 600;
/** The walk a worn spell (an orbit, a pillar, a trail) is shown with: out through the targets and back. */
const WALK_Y = HOME.y + 34;
const WALK_X0 = HOME.x - 20;
const WALK_X1 = HOME.x + 175;
/** How far an enchanted sword walks in before it swings. */
const SWING_REACH = 26;
/** An immortal body's pool, topped up every step. */
const IMMORTAL_HP = 99999;

/** The shapes shown by walking the caster through the targets and back (the style screen's demo does the same). */
const WALKED: ReadonlySet<SpellShape> = new Set<SpellShape>(["orbit", "pillar", "trail"]);

/**
 * The boss's sword wave, thrown beside the player for comparison.
 *
 * The figures are **copied** from `enemy.ts` (`BOSS_WAVE_THICK_PX`,
 * `BOSS_WAVE_SPEED`, `BOSS_WAVE_CLEAVE_HALF`), which keeps them private; the
 * reach and the sweep's width are read from `MELEE_ATTACKS`, as the boss's
 * own cast reads them. If the boss's figures change, change these.
 */
const BOSS_WAVE_THICK_PX = 14;
const BOSS_WAVE_SPEED = 300;
const BOSS_WAVE_CLEAVE_HALF = (16 * Math.PI) / 180;

/** The arena's room: open floor, with the grass, the pillar and the wall as the stage asks. */
export function labRoom(stage: LabStage): RoomPlan {
  const base = merchantHall({ temperature: "warm", brightness: "bright", particle_intensity: "calm" });
  const grid = new Uint8Array(GRID_W * GRID_H).fill(Tile.Wall);
  for (let y = 1; y < ROOM_H - 1; y++) for (let x = 1; x < ROOM_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
  if (stage.pillar) grid[PILLAR_CELL[1] * GRID_W + PILLAR_CELL[0]] = Tile.Pillar;
  if (stage.wall) for (const [x, y] of WALL_CELLS) grid[y * GRID_W + x] = Tile.Wall;
  const grass = GRASS_CELLS.filter(([x, y]) => grid[y * GRID_W + x] === Tile.Floor);
  return {
    ...base,
    id: "spell-lab",
    room_type: "combat",
    grid,
    extent: { w: ROOM_W, h: ROOM_H },
    doors: [],
    entry: "W",
    zones: stage.grass ? [{ id: "lab-grass", cells: grass, feature: "grass_patch" }] : [],
    spawn_groups: [],
    standing: [],
    encounter: null,
    seed_key: "spell-lab",
  };
}

/* ------------------------------------------------------------------------ *
 * The controller.
 * ------------------------------------------------------------------------ */

/** What the scene does for the lab. */
export interface SpellLabHost {
  /** Builds the arena's world in the scene from this room and these keys, and returns it; null while the scene is busy. */
  readonly build: (room: RoomPlan, keys: readonly (LabKey | null)[]) => World | null;
  /** The world in play now. */
  readonly world: () => World | null;
  /** The scene's clock: 1, ½, ¼, or 0 for paused; and one step while paused. */
  readonly speed: () => number;
  readonly setSpeed: (speed: number) => void;
  readonly stepFrame: () => void;
  /** A crisp-atlas frame as a data URL, or null. */
  readonly icon: (frame: string) => string | null;
}

/** What the panel reads back, all at once. */
export interface SpellLabView {
  /** Bumped by every change, so the panel repaints only when something moved. */
  readonly version: number;
  /** Whether the world in play is the lab's arena. */
  readonly inLab: boolean;
  /** The key the list puts spells on, and the auto-caster casts: 0 U, 1 I, 2 O. */
  readonly key: number;
  readonly keys: readonly (LabKey | null)[];
  readonly stage: Readonly<LabStage>;
  readonly auto: boolean;
  readonly manaUnlimited: boolean;
  readonly immortal: boolean;
  readonly gallery: { readonly on: boolean; readonly index: number; readonly total: number; readonly leftMs: number; readonly perMs: number };
}

export interface SpellLabActions {
  readonly view: () => SpellLabView;
  /** Builds the arena, or rebuilds it as it is set now. */
  readonly start: () => void;
  readonly pick: (spell: string) => void;
  readonly setKey: (key: number) => void;
  readonly setLevel: (level: number) => void;
  /** An affix on the chosen key at this tier; 0 takes it off. */
  readonly setAffix: (id: string, tier: 0 | 1 | 2 | 3) => void;
  readonly setStage: (patch: Partial<LabStage>) => void;
  readonly setAuto: (on: boolean) => void;
  readonly setGallery: (on: boolean) => void;
  readonly galleryStep: (by: 1 | -1) => void;
  readonly setGallerySeconds: (s: number) => void;
  readonly setManaUnlimited: (on: boolean) => void;
  readonly setImmortal: (on: boolean) => void;
  readonly speed: () => number;
  readonly setSpeed: (speed: number) => void;
  readonly stepFrame: () => void;
  /** The boss's sword wave, thrown from the player's feet toward the targets. */
  readonly bossWave: (kind: "greatsweep" | "greatcleave") => void;
  readonly icon: (frame: string) => string | null;
}

/** Every spell, in the pool's own order: the gallery's order. */
const ALL_SPELLS: readonly string[] = [...ITEMS.keys()];

/** A body the lab placed, what it is for, and where it goes back to. */
interface Target {
  readonly role: "pinned" | "pack" | "mover" | "attacker";
  id: number;
  readonly homeX: number;
  readonly homeY: number;
  downMs: number;
}

/** A spell's display name, in the game's language where it has one. */
export function spellName(id: string): string {
  return contentName(id, id.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
}

/** `?spells=a+affix,b` or `?demo=a`, read as the lab's first keys; magic bolt on U when neither is given. */
function askedKeys(): (LabKey | null)[] {
  const q = new URLSearchParams(globalThis.location?.search ?? "");
  const listed = (q.get("spells") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const keys: (LabKey | null)[] = [null, null, null];
  listed.slice(0, 3).forEach((entry, i) => {
    // `+` arrives from a URL as a space, so either joins an affix on.
    const [id, ...affixes] = entry.split(/[+\s]+/).filter(Boolean);
    if (!id || !ITEMS.get(id)) return;
    keys[i] = { spell: id, level: 1, affixes: affixes.filter((a) => spellAffixById(a)).map((a) => ({ id: a, tier: 1 as const })) };
  });
  const demo = q.get("demo");
  if (!keys[0] && demo && ITEMS.get(demo)) keys[0] = { spell: demo, level: 1, affixes: [] };
  if (!keys.some(Boolean)) keys[0] = { spell: ALL_SPELLS[0]!, level: 1, affixes: [] };
  return keys;
}

export class SpellLab implements SpellLabActions {
  private version = 0;
  private arena: World | null = null;
  private key = 0;
  private keys: (LabKey | null)[] = askedKeys();
  private stage: LabStage = { pinned: true, pack: true, mover: false, attacker: false, grass: false, pillar: false, wall: false };
  private auto = true;
  private manaUnlimited = true;
  private immortal = true;
  private targets: Target[] = [];
  private attackMs = ATTACK_EVERY_MS;
  private grassIdleMs = 0;
  /** The worn-spell walk's direction: out (1) or back (-1). */
  private walkDir = 1;
  private gallery = { on: false, index: 0, leftMs: 0, perMs: 5000 };
  /** The gallery's keys before it started, put back when it stops. */
  private beforeGallery: (LabKey | null)[] | null = null;
  private caption: HTMLElement | null = null;
  private captionText = "";

  constructor(private readonly host: SpellLabHost) {
    // For the console, like `__scene`.
    (globalThis as unknown as { __spellLab?: SpellLab }).__spellLab = this;
  }

  /* ---- the actions the panel calls ---- */

  readonly view = (): SpellLabView => ({
    version: this.version,
    inLab: this.inLab(),
    key: this.key,
    keys: this.keys,
    stage: this.stage,
    auto: this.auto,
    manaUnlimited: this.manaUnlimited,
    immortal: this.immortal,
    gallery: { on: this.gallery.on, index: this.gallery.index, total: ALL_SPELLS.length, leftMs: this.gallery.leftMs, perMs: this.gallery.perMs },
  });

  readonly start = (): void => { this.rebuild(); };

  readonly pick = (spell: string): void => {
    if (!ITEMS.get(spell)) return;
    this.stopGallery();
    const level = this.keys[this.key]?.level ?? 1;
    this.keys[this.key] = { spell, level, affixes: [] };
    this.rebuild();
  };

  readonly setKey = (key: number): void => {
    this.key = Math.max(0, Math.min(2, Math.round(key)));
    this.changed();
  };

  readonly setLevel = (level: number): void => {
    const k = this.keys[this.key];
    if (!k) return;
    this.keys[this.key] = { ...k, level: Math.max(1, Math.min(SPELL_LEVEL_MAX, Math.round(level))) };
    this.rebuild();
  };

  readonly setAffix = (id: string, tier: 0 | 1 | 2 | 3): void => {
    const k = this.keys[this.key];
    if (!k || !spellAffixById(id)) return;
    const others = k.affixes.filter((a) => a.id !== id);
    if (tier > 0 && others.length >= AFFIX_SLOTS) return;
    const affixes = tier === 0 ? others
      : k.affixes.some((a) => a.id === id) ? k.affixes.map((a) => (a.id === id ? { id, tier } : a))
      : [...k.affixes, { id, tier }];
    this.keys[this.key] = { ...k, affixes };
    this.rebuild();
  };

  readonly setStage = (patch: Partial<LabStage>): void => {
    this.stage = { ...this.stage, ...patch };
    this.rebuild();
  };

  readonly setAuto = (on: boolean): void => { this.auto = on; this.changed(); };

  readonly setGallery = (on: boolean): void => {
    if (on === this.gallery.on) return;
    if (!on) { this.stopGallery(true); this.rebuild(); return; }
    this.beforeGallery = [...this.keys];
    this.gallery.on = true;
    this.auto = true;
    // From the spell on the chosen key, if there is one, so the gallery can be started where the reader is.
    const at = ALL_SPELLS.indexOf(this.keys[this.key]?.spell ?? "");
    this.showGallery(at >= 0 ? at : 0);
  };

  readonly galleryStep = (by: 1 | -1): void => {
    if (this.gallery.on) { this.showGallery(this.gallery.index + by); return; }
    // Outside the gallery the same buttons walk the chosen key through the pool.
    const at = ALL_SPELLS.indexOf(this.keys[this.key]?.spell ?? "");
    const next = ALL_SPELLS[((at < 0 ? 0 : at + by) + ALL_SPELLS.length) % ALL_SPELLS.length]!;
    this.pick(next);
  };

  readonly setGallerySeconds = (s: number): void => {
    this.gallery.perMs = Math.max(1000, s * 1000);
    this.gallery.leftMs = Math.min(this.gallery.leftMs, this.gallery.perMs);
    this.changed();
  };

  readonly setManaUnlimited = (on: boolean): void => { this.manaUnlimited = on; this.changed(); };

  readonly setImmortal = (on: boolean): void => { this.immortal = on; this.rebuild(); };

  readonly speed = (): number => this.host.speed();
  readonly setSpeed = (speed: number): void => { this.host.setSpeed(speed); this.changed(); };
  readonly stepFrame = (): void => { this.host.stepFrame(); this.changed(); };
  readonly icon = (frame: string): string | null => this.host.icon(frame);

  readonly bossWave = (kind: "greatsweep" | "greatcleave"): void => {
    const w = this.lab();
    if (!w) return;
    const spec = MELEE_ATTACKS[kind];
    const half = kind === "greatsweep" ? ((spec.sweepDeg + spec.bladeDeg) * Math.PI) / 360 : BOSS_WAVE_CLEAVE_HALF;
    // Thrown the way the targets are, from the player's own feet, so it starts a sword's reach ahead as the boss's does.
    const aim = this.target(w);
    const facing = aim ? Math.atan2(aim.y - w.player.y, aim.x - w.player.x) : 0;
    castShockwave(w, w.player.x, w.player.y, {
      chargeMs: 0, inner: TILE_PX * spec.reachTiles, thickness: BOSS_WAVE_THICK_PX,
      speed: BOSS_WAVE_SPEED, maxRadius: TILE_PX * 10, damage: 0, facing, half,
    });
  };

  /* ---- the scene's hooks ---- */

  /** The input the step runs on: the keyboard's, with the auto-caster's cast, aim and walk where the keys leave them. */
  input(w: World, base: Input): Input {
    if (w !== this.arena) return base;
    if (this.manaUnlimited) w.player.mana = w.staff.mana_max;
    if (!this.auto) return base;
    const auto = this.autoInput(w);
    const moving = base.moveX !== 0 || base.moveY !== 0;
    return {
      ...base,
      moveX: moving ? base.moveX : auto.moveX,
      moveY: moving ? base.moveY : auto.moveY,
      aimX: auto.aimX,
      aimY: auto.aimY,
      spell: base.spell ?? auto.spell ?? null,
      swing: !!base.swing || !!auto.swing,
    };
  }

  /** After each step: the bodies kept standing, the attacker's clock, the grass, the bar, and the gallery. */
  afterStep(w: World, dtMs: number): void {
    if (w !== this.arena) return;
    const p = w.player;
    if (this.manaUnlimited) p.mana = w.staff.mana_max;
    // What falls from a body is not the lab's subject; the pool is fixed-size, so each is put out, not removed.
    for (const drop of w.pickups) drop.alive = false;
    for (const t of this.targets) this.keepTarget(w, t, dtMs);
    this.stepAttacker(w, dtMs);
    this.regrowGrass(w, dtMs);
    if (this.gallery.on) {
      this.gallery.leftMs -= dtMs;
      if (this.gallery.leftMs <= 0) this.showGallery(this.gallery.index + 1);
    }
  }

  /** Every frame: the caption over the canvas. */
  frame(): void {
    const w = this.host.world();
    const text = w && w === this.arena ? this.captionLine(w) : "";
    if (text === this.captionText) return;
    this.captionText = text;
    const el = this.captionEl();
    el.textContent = text;
    el.style.display = text ? "block" : "none";
  }

  /* ---- inside ---- */

  private inLab(): boolean {
    const w = this.host.world();
    return !!w && w === this.arena;
  }

  private lab(): World | null {
    const w = this.host.world();
    return w && w === this.arena ? w : null;
  }

  private changed(): void { this.version++; }

  private rebuild(): void {
    const keys = [...this.keys];
    // The gallery's stage: a stance is shown answering a blow, a trail laid through grass.
    const shape = itemShape(ITEMS.get(this.keys[this.key]?.spell ?? ""));
    const stage: LabStage = this.gallery.on
      ? { ...this.stage, attacker: this.stage.attacker || shape === "stance", grass: this.stage.grass || shape === "trail" }
      : this.stage;
    const w = this.host.build(labRoom(stage), keys);
    this.changed();
    if (!w) return;
    this.arena = w;
    w.player.x = HOME.x;
    w.player.y = HOME.y;
    w.player.facing = 0;
    w.player.aim = { x: HOME.x + 64, y: HOME.y };
    // Cleared from the first frame: the room's end — its sound, its leftovers put out — never comes.
    w.cleared = true;
    this.targets = [];
    this.attackMs = ATTACK_FIRST_MS;
    this.grassIdleMs = 0;
    this.walkDir = 1;
    if (stage.pinned) this.targets.push(this.spawn(w, "pinned", PINNED_AT.x, PINNED_AT.y, true));
    if (stage.pack) for (const at of PACK_AT) this.targets.push(this.spawn(w, "pack", at.x, at.y, true));
    if (stage.mover) this.targets.push(this.spawn(w, "mover", MOVER_X, MOVER_Y0, true));
    if (stage.attacker) this.targets.push(this.spawn(w, "attacker", ATTACKER_AT.x, ATTACKER_AT.y, true));
  }

  private stopGallery(restore = false): void {
    if (!this.gallery.on) return;
    this.gallery.on = false;
    if (restore && this.beforeGallery) this.keys = this.beforeGallery;
    this.beforeGallery = null;
  }

  private showGallery(index: number): void {
    const n = ALL_SPELLS.length;
    this.gallery.index = ((index % n) + n) % n;
    this.gallery.leftMs = this.gallery.perMs;
    const level = this.keys[this.key]?.level ?? 1;
    this.keys[this.key] = { spell: ALL_SPELLS[this.gallery.index]!, level, affixes: [] };
    this.rebuild();
  }

  /** One of the lab's bodies: awake, harmless, and as hard to put down as the switch says. */
  private spawn(w: World, role: Target["role"], x: number, y: number, standing: boolean): Target {
    // Rushers, whose hits and statuses are the plain case; the attacker is drawn as a shooter so it can be told apart.
    const kind: EnemyId = role === "attacker" ? "shooter" : "rusher";
    const e = makeEnemy(w.nextEnemyId++, kind, x, y, []);
    e.facing = Math.atan2(w.player.y - y, w.player.x - x);
    if (standing) e.spawnFadeMs = 0;
    e.awake = true;
    e.speed = 0;
    e.attackCooldownMs = 99999;
    e.hp = e.maxHp = this.immortal ? IMMORTAL_HP : this.mortalHp();
    w.enemies.push(e);
    return { role, id: e.id, homeX: x, homeY: y, downMs: 0 };
  }

  /**
   * A mortal body's pool, as the style screen's demo sizes it: about six
   * casts of the spell on the chosen key, or long enough for its status to
   * fill and run its course, so the spell is seen finishing a body.
   */
  private mortalHp(): number {
    const k = this.keys[this.key];
    const def = k ? ITEMS.get(k.spell) : undefined;
    const damage = Number(def?.params["damage"] ?? 8) * SPELL_DAMAGE_SCALE * (1 + 0.2 * ((k?.level ?? 1) - 1));
    const status = def ? statusForecast(def) : null;
    const toStatus = status ? status.hits + 1 : 0;
    return Math.max(12, Math.round(damage * Math.max(6, toStatus) + (status?.damage ?? 0)));
  }

  private keepTarget(w: World, t: Target, dtMs: number): void {
    const e = w.enemies.find((x) => x.id === t.id);
    if (!e || e.hp <= 0) {
      t.downMs += dtMs;
      if (t.downMs >= RESPAWN_MS) {
        const fresh = this.spawn(w, t.role, t.homeX, t.homeY, false);
        t.id = fresh.id;
        t.downMs = 0;
        if (t.role === "attacker") this.attackMs = ATTACK_FIRST_MS;
      }
      return;
    }
    t.downMs = 0;
    e.speed = 0;
    e.attackCooldownMs = 99999;
    if (this.immortal) e.hp = e.maxHp;
    if (t.role === "mover") {
      // Walked by the lab rather than by its own legs, so it keeps its beat whatever the player does.
      const dir = Math.sin(e.facing) >= 0 ? 1 : -1;
      let y = e.y + dir * MOVER_SPEED * (dtMs / 1000);
      let face = dir;
      if (y > MOVER_Y1) { y = MOVER_Y1; face = -1; }
      if (y < MOVER_Y0) { y = MOVER_Y0; face = 1; }
      e.y = y;
      e.x += (MOVER_X - e.x) * Math.min(1, dtMs / 200);
      e.facing = face > 0 ? Math.PI / 2 : -Math.PI / 2;
      return;
    }
    // Knocked, it is seen knocked, and then it walks back to its mark.
    const dx = t.homeX - e.x, dy = t.homeY - e.y, d = Math.hypot(dx, dy);
    if (d > 0.5) {
      const stepPx = Math.min(d, 40 * (dtMs / 1000));
      e.x += (dx / d) * stepPx;
      e.y += (dy / d) * stepPx;
    }
  }

  /** The attacker's shot, on its clock, straight at the player. */
  private stepAttacker(w: World, dtMs: number): void {
    const t = this.targets.find((x) => x.role === "attacker");
    const e = t ? w.enemies.find((x) => x.id === t.id && x.hp > 0 && x.spawnFadeMs <= 0) : undefined;
    if (!e) return;
    const p = w.player;
    e.facing = Math.atan2(p.y - e.y, p.x - e.x);
    this.attackMs -= dtMs;
    if (this.attackMs > 0) return;
    this.attackMs = ATTACK_EVERY_MS;
    const b = acquire(w.enemyBullets, true);
    if (!b) return;
    const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
    b.x = e.x; b.y = e.y; b.originX = e.x; b.originY = e.y;
    b.vx = ((p.x - e.x) / d) * ATTACK_SHOT_SPEED;
    b.vy = ((p.y - e.y) / d) * ATTACK_SHOT_SPEED;
    b.radius = 3;
    b.damage = 1;
    b.lifeMs = 2000;
    b.from = "shooter";
  }

  /** Grass burns once; in the lab it grows back once the fire is out, so it can be lit again. */
  private regrowGrass(w: World, dtMs: number): void {
    if (w.grass.length === 0) return;
    const alight = w.grass.some((c) => c.state === "catching" || c.state === "burning");
    const burnt = w.grass.some((c) => c.state === "burnt");
    if (alight || !burnt) { this.grassIdleMs = 0; return; }
    this.grassIdleMs += dtMs;
    if (this.grassIdleMs < GRASS_REGROW_MS) return;
    this.grassIdleMs = 0;
    for (const c of w.grass) { c.state = "grass"; c.ms = 0; c.owner = "enemy"; c.spread = false; }
  }

  /** The body the auto-caster aims at: the nearest standing one, the pinned body first. */
  private target(w: World): Enemy | null {
    const p = w.player;
    const standing = w.enemies.filter((e) => e.hp > 0 && e.spawnFadeMs <= 0);
    const pinned = this.targets.find((t) => t.role === "pinned");
    const first = pinned ? standing.find((e) => e.id === pinned.id) : undefined;
    if (first) return first;
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of standing) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /**
   * **The auto-caster.** Each shape is cast the way it is played: most are
   * pressed the moment the key is ready; a charge is held to full and let go;
   * a bank is loosed full; an enchant is kept up and swung into the targets;
   * a stance is raised as the attacker's shot comes in; a worn spell — an
   * orbit, a pillar, a trail — is walked out through the targets and back.
   * Everything else walks the caster back to its mark between casts, so a
   * dash is seen from the same place every time.
   */
  private autoInput(w: World): Input {
    const p = w.player;
    const i = this.key;
    const slot = w.spells[i];
    const target = this.target(w);
    const aimX = target?.x ?? p.x + 64;
    const aimY = target?.y ?? p.y;
    if (!slot) return { ...NO_INPUT, aimX, aimY };
    const item = ITEMS.get(slot.item.base);
    const shape = itemShape(item);
    const close = !!item && (item.tags.includes("short") || shape === "stance");
    let moveX = 0, moveY = 0, swing = false;
    const walkTo = (x: number, y: number, within: number): void => {
      const dx = x - p.x, dy = y - p.y;
      if (Math.hypot(dx, dy) <= within) return;
      // The sim reads a direction; a small dead band keeps it from dithering on the spot.
      moveX = Math.abs(dx) > 3 ? Math.sign(dx) : 0;
      moveY = Math.abs(dy) > 3 ? Math.sign(dy) : 0;
    };
    if (WALKED.has(shape)) {
      if (p.x >= WALK_X1) this.walkDir = -1;
      if (p.x <= WALK_X0) this.walkDir = 1;
      moveX = this.walkDir;
      moveY = Math.abs(WALK_Y - p.y) > 3 ? Math.sign(WALK_Y - p.y) : 0;
    } else if (shape === "enchant" && p.enchant && target) {
      walkTo(target.x - SWING_REACH, target.y, 4);
      // Facing comes from the walk; standing, it is turned to the target with a last short step.
      if (moveX === 0 && moveY === 0 && Math.cos(p.facing) < 0.9) moveX = 1;
      swing = true;
    } else {
      const home = close ? CLOSE_HOME : HOME;
      walkTo(home.x, home.y, 6);
    }

    const busy = p.castPending >= 0 || p.castRecoverMs > 0;
    const affordable = this.manaUnlimited || p.mana >= slotCost(slot, ITEMS, w.staff);
    const ready = spellReady(slot, ITEMS) && !busy && affordable;
    let spell: number | null = null;
    if (chargeMsOf(ITEMS, slot.item.base) > 0) {
      // Held to a full charge, then let go.
      if (p.chargeKey === i) spell = chargeShare(w, ITEMS) >= 1 ? null : i;
      else if (ready && p.chargeVoid !== i) spell = i;
    } else if (chargesOf(ITEMS, slot.item.base) > 0) {
      if (ready && bankOf(slot, ITEMS) >= chargesOf(ITEMS, slot.item.base)) spell = i;
    } else if (shape === "enchant") {
      if (ready && (!p.enchant || p.enchant.ms < 400)) spell = i;
    } else if (shape === "trail") {
      if (ready && !p.trail) spell = i;
    } else if (shape === "stance") {
      const attacker = this.targets.some((t) => t.role === "attacker");
      if (ready && !p.stance && (!attacker || this.shotComing(w))) spell = i;
    } else if (ready) {
      spell = i;
    }
    return { ...NO_INPUT, moveX, moveY, aimX, aimY, spell, swing };
  }

  /** Whether an enemy shot is closing on the player and near enough that a guard raised now will take it. */
  private shotComing(w: World): boolean {
    const p = w.player;
    return w.enemyBullets.some((b) => {
      if (!b.alive) return false;
      const dx = p.x - b.x, dy = p.y - b.y;
      const d = Math.hypot(dx, dy);
      return d < 70 && dx * b.vx + dy * b.vy > 0;
    });
  }

  private captionLine(w: World): string {
    const k = this.keys[this.key];
    if (!k) return "";
    const item = ITEMS.get(k.spell);
    const styles = (item?.tags ?? []).filter((t) => (ARCHETYPES as readonly string[]).includes(t)).join("/");
    const affixes = k.affixes.map((a) => `${contentName(a.id, spellAffixById(a.id)?.name ?? a.id)} ${"I".repeat(a.tier)}`).join(", ");
    const head = `${"UIO"[this.key]}  ${spellName(k.spell)}  L${k.level}${affixes ? `  + ${affixes}` : ""}`;
    const sub = `${styles} · ${itemShape(item)}${w.spells[this.key] ? "" : "  (not equipped)"}`;
    const g = this.gallery;
    const gallery = g.on ? `\ngallery ${g.index + 1}/${ALL_SPELLS.length} · next in ${Math.max(0, g.leftMs / 1000).toFixed(1)} s` : "";
    const speed = this.host.speed();
    const clock = speed === 1 ? "" : speed === 0 ? "  [paused]" : `  [${speed}×]`;
    return `${head}${clock}\n${sub}${gallery}`;
  }

  private captionEl(): HTMLElement {
    if (this.caption) return this.caption;
    const el = document.createElement("div");
    el.id = "jr-spell-lab-caption";
    Object.assign(el.style, {
      position: "fixed", left: "50%", top: "8px", transform: "translateX(-50%)", zIndex: "19",
      background: "rgba(13, 11, 31, 0.82)", color: "#ffe9a8", border: "1px solid #2a2750", borderRadius: "3px",
      fontFamily: "ui-monospace, Menlo, monospace", fontSize: "13px", lineHeight: "1.4", padding: "4px 10px",
      whiteSpace: "pre", pointerEvents: "none", display: "none", textAlign: "center",
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
    this.caption = el;
    return el;
  }
}

/* ------------------------------------------------------------------------ *
 * The panel.
 * ------------------------------------------------------------------------ */

const SPEEDS: readonly [number, string][] = [[1, "1×"], [0.5, "½×"], [0.25, "¼×"], [0, "pause"]];
const GALLERY_SECONDS: readonly number[] = [3, 5, 8, 12];

const BTN = "background:#221d46;color:#c9cfe8;border:1px solid #2a2750;font:inherit;padding:1px 6px;margin:0 3px 3px 0;cursor:pointer;border-radius:2px";
const HEAD = "font-size:13px;margin:14px 0 4px;color:#ffe9a8;border-bottom:1px solid #2a2750;padding-bottom:2px";
const NOTE = "color:#5a5f7a";
const LIT = "#ffe9a8";
const DIM = "#2a2750";

/** The stage's switches, in the order the panel lists them, with what each is for. */
const STAGE_SWITCHES: readonly [keyof LabStage, string][] = [
  ["pinned", "pinned dummy"], ["pack", "pack of six"], ["mover", "moving body"], ["attacker", "attacker (shoots on a clock)"],
  ["grass", "grass patch"], ["pillar", "pillar"], ["wall", "wall segment"],
];

export class SpellLabPanel {
  readonly root: HTMLElement;
  private painted = -1;
  private iconsDone = false;
  private readonly status: HTMLElement;
  private readonly affixBox: HTMLElement;
  private affixFor = "";

  constructor(private readonly actions: SpellLabActions) {
    this.root = document.createElement("div");
    const r = this.root;
    r.innerHTML =
      `<h2 style="${HEAD}">spell lab</h2>`
      + `<div data-status style="white-space:pre;color:#c9cfe8;min-height:2.9em"></div>`
      + `<div><button data-start style="${BTN}">rebuild arena</button></div>`
      + `<div style="${NOTE}">the real game, the run replaced by a practice arena; the player cannot die. <b>?lab=spells</b> opens here.</div>`
      + `<h2 style="${HEAD}">cast</h2>`
      + `<div><label style="cursor:pointer;margin-right:8px"><input type="checkbox" data-auto> auto-cast</label>`
      + `<label style="cursor:pointer"><input type="checkbox" data-mana> unlimited mana</label></div>`
      + `<div style="${NOTE}">auto-cast casts the chosen key when ready — holds a charge to full, keeps an enchant up and swings, walks a trail or an orbit through the targets. The keys still work: J U I O K L, WASD.</div>`
      + `<div style="margin-top:4px">key <span data-keys></span></div>`
      + `<div style="margin-top:2px">level <span data-levels></span></div>`
      + `<h2 style="${HEAD}">gallery</h2>`
      + `<div><button data-gallery style="${BTN}">play all</button>`
      + `<button data-prev style="${BTN}">◀ prev</button><button data-next style="${BTN}">next ▶</button>`
      + `<select data-seconds style="${BTN}">${GALLERY_SECONDS.map((s) => `<option value="${s}">${s} s each</option>`).join("")}</select></div>`
      + `<div style="${NOTE}">every spell in turn on the chosen key, auto-cast, affixes off; a stance gets the attacker and a trail the grass. prev / next also step the key outside it.</div>`
      + `<h2 style="${HEAD}">speed</h2>`
      + `<div data-speeds></div>`
      + `<div><button data-step style="${BTN}">step 1 frame</button></div>`
      + `<h2 style="${HEAD}">spells</h2>`
      + `<div data-list></div>`
      + `<h2 style="${HEAD}">affixes on the chosen key</h2>`
      + `<div data-affixes></div>`
      + `<h2 style="${HEAD}">arena</h2>`
      + `<div data-stage></div>`
      + `<div style="margin-top:2px"><label style="cursor:pointer"><input type="checkbox" data-immortal> bodies never fall</label></div>`
      + `<div style="${NOTE}">unticked, a body takes about six casts (or its status run) and stands up again 0.6 s after it falls. Burnt grass grows back.</div>`
      + `<h2 style="${HEAD}">compare</h2>`
      + `<div><button data-wave="greatsweep" style="${BTN}">boss wave: sweep</button><button data-wave="greatcleave" style="${BTN}">boss wave: cleave</button></div>`
      + `<div style="${NOTE}">the Crypt King's sword wave, thrown from the player's feet toward the targets (harmless). Its figures are copied from the boss code; see <b>spell-lab.ts</b>.</div>`;

    /*
     * A button clicked here must not keep the keyboard. The game is played
     * on the keys while the panel is open, and a focused button takes Enter
     * and Space as clicks and Tab as a walk to the next one — playing on
     * after a click put spell after spell on the key.
     */
    r.addEventListener("mousedown", (ev) => {
      if ((ev.target as HTMLElement | null)?.closest("button")) ev.preventDefault();
    });
    this.status = r.querySelector<HTMLElement>("[data-status]")!;
    this.affixBox = r.querySelector<HTMLElement>("[data-affixes]")!;
    r.querySelector("[data-start]")!.addEventListener("click", () => this.actions.start());
    const auto = r.querySelector<HTMLInputElement>("[data-auto]")!;
    auto.addEventListener("change", () => this.actions.setAuto(auto.checked));
    const mana = r.querySelector<HTMLInputElement>("[data-mana]")!;
    mana.addEventListener("change", () => this.actions.setManaUnlimited(mana.checked));
    const immortal = r.querySelector<HTMLInputElement>("[data-immortal]")!;
    immortal.addEventListener("change", () => this.actions.setImmortal(immortal.checked));

    const keys = r.querySelector<HTMLElement>("[data-keys]")!;
    ["U", "I", "O"].forEach((name, i) => {
      const b = document.createElement("button");
      b.textContent = name;
      b.dataset.key = String(i);
      b.setAttribute("style", BTN);
      b.addEventListener("click", () => this.actions.setKey(i));
      keys.appendChild(b);
    });
    const levels = r.querySelector<HTMLElement>("[data-levels]")!;
    for (let l = 1; l <= SPELL_LEVEL_MAX; l++) {
      const b = document.createElement("button");
      b.textContent = String(l);
      b.dataset.level = String(l);
      b.setAttribute("style", BTN);
      b.addEventListener("click", () => this.actions.setLevel(l));
      levels.appendChild(b);
    }

    r.querySelector("[data-gallery]")!.addEventListener("click", () => this.actions.setGallery(!this.actions.view().gallery.on));
    r.querySelector("[data-prev]")!.addEventListener("click", () => this.actions.galleryStep(-1));
    r.querySelector("[data-next]")!.addEventListener("click", () => this.actions.galleryStep(1));
    const seconds = r.querySelector<HTMLSelectElement>("[data-seconds]")!;
    seconds.value = String(Math.round(this.actions.view().gallery.perMs / 1000));
    seconds.addEventListener("change", () => this.actions.setGallerySeconds(Number(seconds.value)));

    const speeds = r.querySelector<HTMLElement>("[data-speeds]")!;
    for (const [value, label] of SPEEDS) {
      const b = document.createElement("button");
      b.textContent = label;
      b.dataset.speed = String(value);
      b.setAttribute("style", BTN);
      b.addEventListener("click", () => this.actions.setSpeed(value));
      speeds.appendChild(b);
    }
    r.querySelector("[data-step]")!.addEventListener("click", () => this.actions.stepFrame());

    this.buildList(r.querySelector<HTMLElement>("[data-list]")!);

    const stage = r.querySelector<HTMLElement>("[data-stage]")!;
    for (const [k, label] of STAGE_SWITCHES) {
      const l = document.createElement("label");
      l.setAttribute("style", "cursor:pointer;display:block");
      l.innerHTML = `<input type="checkbox" data-stage-key="${k}"> ${label}`;
      const box = l.querySelector("input")!;
      box.addEventListener("change", () => this.actions.setStage({ [k]: box.checked }));
      stage.appendChild(l);
    }
    for (const b of Array.from(r.querySelectorAll<HTMLButtonElement>("[data-wave]")))
      b.addEventListener("click", () => this.actions.bossWave(b.dataset.wave as "greatsweep" | "greatcleave"));
  }

  /** The pool by style, each spell under every style it carries; a click puts it on the chosen key. */
  private buildList(list: HTMLElement): void {
    for (const style of ARCHETYPES) {
      const head = document.createElement("div");
      head.setAttribute("style", "color:#8792b5;margin:6px 0 2px;text-transform:uppercase;letter-spacing:0.05em;font-size:11px");
      head.textContent = `${STYLE_CARDS[style].name} (${style})`;
      list.appendChild(head);
      const grid = document.createElement("div");
      grid.setAttribute("style", "display:grid;grid-template-columns:1fr 1fr;gap:2px");
      for (const [id, item] of ITEMS) {
        if (!item.tags.includes(style)) continue;
        const b = document.createElement("button");
        b.dataset.spell = id;
        b.title = item.description;
        b.setAttribute("style", `${BTN};margin:0;display:flex;align-items:center;gap:4px;text-align:left;padding:1px 3px;white-space:nowrap;overflow:hidden`);
        b.innerHTML = `<img data-icon="icon_${id}" width="20" height="20" style="image-rendering:pixelated;flex:0 0 auto" alt="">`
          + `<span style="overflow:hidden;text-overflow:ellipsis">${spellName(id)}</span>`;
        b.addEventListener("click", () => this.actions.pick(id));
        grid.appendChild(b);
      }
      list.appendChild(grid);
    }
  }

  /** The icons, once the atlas is in: the panel is built before the sheet is. */
  private fillIcons(): void {
    if (this.iconsDone) return;
    let all = true;
    for (const img of Array.from(this.root.querySelectorAll<HTMLImageElement>("img[data-icon]"))) {
      if (img.src) continue;
      const url = this.actions.icon(img.dataset.icon!);
      if (url) img.src = url; else all = false;
    }
    this.iconsDone = all;
  }

  /** Every frame the tab is on screen: repaints what changed. */
  frame(): void {
    this.fillIcons();
    const v = this.actions.view();
    const speedNow = this.actions.speed();
    const k = v.keys[v.key];
    this.status.textContent = !v.inLab ? "not in the arena — rebuild arena"
      : `${"UIO"[v.key]}: ${k ? `${spellName(k.spell)} L${k.level}` : "empty"}`
        + `\n${v.keys.map((x, i) => `${"UIO"[i]} ${x ? spellName(x.spell) : "-"}`).join("   ")}`
        + (v.gallery.on ? `\ngallery ${v.gallery.index + 1}/${v.gallery.total}, next in ${Math.max(0, v.gallery.leftMs / 1000).toFixed(1)} s` : "");
    const paintSpeed = (b: HTMLButtonElement, on: boolean) => { b.style.color = on ? LIT : "#c9cfe8"; b.style.borderColor = on ? LIT : DIM; };
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>("[data-speed]")))
      paintSpeed(b, Number(b.dataset.speed) === speedNow);
    if (v.version === this.painted) return;
    this.painted = v.version;
    const r = this.root;
    r.querySelector<HTMLInputElement>("[data-auto]")!.checked = v.auto;
    r.querySelector<HTMLInputElement>("[data-mana]")!.checked = v.manaUnlimited;
    r.querySelector<HTMLInputElement>("[data-immortal]")!.checked = v.immortal;
    r.querySelector<HTMLButtonElement>("[data-gallery]")!.textContent = v.gallery.on ? "■ stop gallery" : "▶ play all";
    for (const b of Array.from(r.querySelectorAll<HTMLButtonElement>("[data-key]")))
      paintSpeed(b, Number(b.dataset.key) === v.key);
    for (const b of Array.from(r.querySelectorAll<HTMLButtonElement>("[data-level]")))
      paintSpeed(b, Number(b.dataset.level) === (k?.level ?? 0));
    for (const b of Array.from(r.querySelectorAll<HTMLButtonElement>("[data-spell]"))) {
      const on = b.dataset.spell === k?.spell;
      const held = v.keys.some((x) => x?.spell === b.dataset.spell);
      b.style.borderColor = on ? LIT : held ? "#8792b5" : DIM;
      b.style.color = on ? LIT : "#c9cfe8";
    }
    for (const box of Array.from(r.querySelectorAll<HTMLInputElement>("[data-stage-key]")))
      box.checked = v.stage[box.dataset.stageKey as keyof LabStage];
    this.paintAffixes(k);
  }

  /**
   * The affixes that fit the chosen key's spell (`affixFitsSpell`), each with
   * its tier. Rebuilt when the spell or what is on it changes; a full key
   * offers only the tiers of what it holds.
   */
  private paintAffixes(k: LabKey | null | undefined): void {
    const sig = k ? `${k.spell}|${k.affixes.map((a) => `${a.id}:${a.tier}`).join(",")}` : "";
    if (sig === this.affixFor) return;
    this.affixFor = sig;
    const box = this.affixBox;
    box.innerHTML = "";
    if (!k) { box.innerHTML = `<div style="${NOTE}">no spell on this key</div>`; return; }
    const item = ITEMS.get(k.spell);
    const heldIds = k.affixes.map((a) => a.id);
    const full = k.affixes.length >= AFFIX_SLOTS;
    const fitting = SPELL_AFFIXES.filter((a) => affixFitsSpell(a, item, heldIds.filter((h) => h !== a.id)));
    if (fitting.length === 0) { box.innerHTML = `<div style="${NOTE}">none fit this spell</div>`; return; }
    for (const a of fitting) {
      const tier = k.affixes.find((x) => x.id === a.id)?.tier ?? 0;
      const row = document.createElement("div");
      row.setAttribute("style", "display:flex;align-items:center;gap:2px;margin:1px 0");
      const name = document.createElement("span");
      name.setAttribute("style", `flex:1 1 auto;color:${tier > 0 ? LIT : "#c9cfe8"}`);
      name.textContent = contentName(a.id, a.name);
      name.title = a.tiers[0]?.text ?? "";
      row.appendChild(name);
      ([0, 1, 2, 3] as const).forEach((t) => {
        const b = document.createElement("button");
        b.textContent = t === 0 ? "–" : "I".repeat(t);
        b.setAttribute("style", `${BTN};margin:0;min-width:26px`);
        const on = t === tier;
        b.style.color = on ? LIT : "#c9cfe8";
        b.style.borderColor = on ? LIT : DIM;
        const blocked = full && tier === 0 && t > 0;
        b.disabled = blocked;
        if (blocked) b.style.opacity = "0.4";
        b.addEventListener("click", () => this.actions.setAffix(a.id, t));
        row.appendChild(b);
      });
      box.appendChild(row);
    }
    box.insertAdjacentHTML("beforeend", `<div style="${NOTE}">up to ${AFFIX_SLOTS} on a key; the list is what fits ${spellName(k.spell)}'s shape</div>`);
  }
}
