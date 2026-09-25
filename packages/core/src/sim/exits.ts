/**
 * How a room ends: the reward, then the way out.
 *
 * Doc 003's revision replaces doors cut into the border wall with **portals
 * standing on open floor**, and splits the end of a room into two beats:
 *
 * 1. The room clears and the offer is presented — as **three cards in the UI**,
 *    not as pickups on the floor.
 * 2. Choosing one **raises the portals**. Until then there is no exit.
 *
 * Both halves live here because the coupling is the design. Splitting the two
 * decisions in time is the whole point: the build decision is answered first
 * and alone, the route decision second with the build already known. Offered
 * together each is worse, because the player picks a card partly for where it
 * lets them go.
 *
 * ### The reward is a card screen, not three things on the ground
 *
 * Floor pickups shipped first and were wrong for a reason that only shows up
 * once the content is real: **a reward has to be read, not just seen.** An
 * item is a name, a rarity and a sentence of rules text, and doc 010 generates
 * that text — none of which fits under a 64 px sprite on a dungeon floor. The
 * floor version could show a kind and a name and had nowhere to put the rest,
 * so the player was choosing between three icons.
 *
 * It also put a layout problem in the way of a decision: three pickups have to
 * stand on clear floor, far enough apart that walking near one does not take
 * it, in a room that may be full of pillars. Two versions of that layout were
 * written and the second needed the room generator to reserve a row. A card
 * screen has no geometry, so none of that exists.
 *
 * What the simulation keeps is only the **gate**: the offer is pending, and
 * nothing can leave until it is answered. Which card, and what it does, is the
 * run's business and the UI's.
 *
 * ### Why the exit moved onto the floor
 *
 * The border wall caused every problem it could. `Tile.Door` was not solid, so
 * walking east in an open arena put the player's body inside the wall with the
 * collision test reporting no contact. There was nowhere to put the type badge
 * — squeezed into a border tile at the screen edge, the six door icons read as
 * a coin stuck to a wall. And it is the worst place in a room to put a choice,
 * because the player finishes a fight in the middle and the options are behind
 * them at the edge, only one comfortably in view at a time.
 *
 * A floor portal fixes all three, and gains two things:
 *
 * - **Every option is visible at once**, from where the fight ended, which is
 *   what Sid Meier's objection to the blind choice actually asks for.
 * - **A portal can be placed behind enemies**, which is the level-design rule
 *   that the goal belongs on the far side of the threat. A door at the
 *   player's back cannot be used that way.
 *
 * The fiction it gives up was never paid for: doc 003 already says previous
 * rooms are gone and there is no map.
 */
import { TILE_PX, Tile, GRID_W, GRID_H } from "../types.ts";
import type { Extent, RoomType } from "../types.ts";
import type { Rng } from "../rng.ts";

/**
 * The four reward kinds, named as the player sees them.
 *
 * Doc 007's `RewardKind` is the Director's older vocabulary (`item`, `gold`,
 * `heal`, `staff_upgrade`); this is the drawn one. `spell` and `affix` are both
 * doc 007's `item` — a castable and a modifier — and they are separate kinds
 * because they are separate decisions for the player even though they are one
 * kind for the Director.
 *
 * `stat` is doc 003's addition and it resolves something doc 013 left open.
 * That document asks "whether intrinsic stats touch spells at all" and declines
 * to answer; once `stat` is a door the player can *choose*, the answer is
 * forced — the pool must be usable by every build, or the door is a trap for
 * half of them. `heal` is not a kind of its own for the same reason: it is one
 * entry in the stat pool, so recovery costs the other two cards rather than
 * being a free stop.
 */
export type RewardCardKind = "stat" | "gold" | "spell" | "affix";

/** One card on the offer screen. */
export interface OfferCard {
  readonly kind: RewardCardKind;
  /** The specific item id, for `spell` and `affix`. Empty for `gold`. */
  readonly itemId: string;
  /** The name on the card. */
  readonly label: string;
  /**
   * The numbers, in one short line: what it costs and what it does.
   *
   * Separate from `description` because they answer different questions and
   * the player reads them in a different order. The description says what kind
   * of thing this is; this says whether they can afford it and how much of it
   * they get, which is the part a player comparing three cards under no time
   * pressure still wants first.
   */
  readonly stats: string;
  /**
   * The same line in parts, each with the kind of thing it says, for
   * colouring — and with the identifier a renderer says it in another
   * language through (`run/offer.ts`, `StatPart`). `text` is the English and
   * stays authoritative; a renderer with no entry for `key` shows it.
   */
  readonly statParts?: readonly {
    readonly text: string;
    readonly tone: string;
    readonly key?: string;
    readonly args?: Readonly<Record<string, string | number>>;
  }[];
  /** Doc 010's rules text. The whole reason the offer is a screen. */
  readonly description: string;
  /**
   * The card's grade, 1 to 3: a spell arrives at this level, an affix at this
   * tier, a stat is applied this many times (capped at two), gold is paid this
   * many times over. An elite door's reward is graded up — the reason to
   * take the harder room.
   */
  readonly grade?: number;
}

/**
 * The offer a cleared room will present, decided before the fight.
 *
 * Doc 003 requires the reward pipeline to start at the room's own ENTERING and
 * have the whole fight to finish, so the offer is an *input* to the world
 * rather than something computed at the moment of clearing. That also makes
 * the cards deterministic for a seed: a replay of the same room shows the same
 * three, which is what makes a failure reproducible.
 */
export interface RoomOffer {
  readonly cards: readonly OfferCard[];
  readonly doors: readonly PortalSpec[];
  /** Coins a card-less room scatters on clearing; a graded gold door pays more. */
  readonly coins?: number;
}

/**
 * The reward standing on the floor, waiting to be opened.
 *
 * A step between the fight and the card screen, and it earns its place three
 * times over.
 *
 * The screen used to open by itself a second after the last kill, which reads
 * as the game interrupting a follow-through — the player is still moving, the
 * death is still resolving, and a decision arrives over the top of it. Putting
 * an object on the floor hands the timing back: the cards open when the player
 * walks over and asks for them.
 *
 * It also restores what the floor-pickup version had and the screen lost. A
 * prize in the middle of the arena **pulls the player off the foothold they
 * won on**, which is the Reward for Risk pattern, and it gives the cleared
 * room something to be — doc 014 asks for a trough of thirty to forty-five
 * seconds after each peak and observes that the game has nothing in it.
 *
 * And it costs nothing in legibility, because the reading is split: the object
 * and its beam say *there is a reward here and it is that kind*, which is all
 * a landmark has to say from across a room, while the text stays on the cards
 * where there is room for it.
 */
export interface RewardDrop {
  readonly kind: RewardCardKind;
  x: number;
  y: number;
  /** Counts up from the moment it appears, for the rise and the beam. */
  riseMs: number;
}

/** How long the reward takes to rise, and how close to press interact at. */
export const REWARD_RISE_MS = 520;
export const REWARD_REACH = TILE_PX * 0.9;

export interface Portal {
  /**
   * What the room behind it is, as the badge shows it.
   *
   * A **reward kind**, not a room type. Doc 003 removed room types as a
   * player-facing choice: every room before the merchant is a fight, and what
   * differs is the currency behind it and how hard it is. The badge said
   * "combat" before, which told the player nothing they could act on — the
   * reward was decided somewhere else entirely.
   */
  readonly reward: RewardCardKind;
  /** Whether the encounter behind it is an elite one. */
  readonly elite: boolean;
  /** The stage of the run, for the two rooms that are not fights. */
  readonly type: RoomType;
  readonly school?: string;
  readonly family?: string;
  readonly grade?: number;
  /** A vendor's room rather than a fight; see `DoorOffer.npc`. */
  readonly npc?: "merchant" | "smith" | "fountain";
  /** The vendors' stop's one exit; see `bossExit`. */
  readonly boss?: boolean;
  /**
   * **A door that promises no reward, only the room ahead** (`fixedExit`).
   *
   * The run narrows twice — the last fight opens onto the vendors' stop, the
   * stop opens onto the boss — and both of those doors used to be dressed as
   * reward portals, because every portal was. A badge reading "gold" over a
   * door that pays nothing is a lie the player catches within one room, so
   * these are drawn as the room ahead instead.
   */
  readonly onward?: boolean;
  x: number;
  y: number;
  /** Shut until the offer is answered. A shut portal is not drawn. */
  open: boolean;
  /** Counts up from the moment it opens, for the rise animation. */
  riseMs: number;
}

/**
 * The radius within which a portal can be entered, **on a press**.
 *
 * Generous, because the press is what commits. A press rather than contact
 * because a mistouch here does not cost a card — it ends the room, which is
 * the most expensive accident the game has available.
 */
export const PORTAL_ENTER_RADIUS = TILE_PX * 0.85;

/** How long a portal takes to rise, for the renderer. */
export const PORTAL_RISE_MS = 420;

/**
 * Where the reward stands: the middle of the room, nudged onto real floor.
 *
 * Central and not where the last body died, because the point is to move the
 * player. A reward that appeared under their feet would reward nothing.
 *
 * `avoid` is the cells the pedestal may not stand on: the hazard zones. A
 * reward on a spike strip asks the player to be hurt to collect it, which
 * is the portal rule again, and it came up because an arena's spikes are
 * laid out around its centre — exactly where this looks first.
 */
export function placeReward(
  grid: Uint8Array, ext: Extent, kind: RewardCardKind, avoid: Set<number> = new Set(),
): RewardDrop {
  const [gx, gy] = nearestOpen(grid, (ext.w - 1) / 2, (ext.h - 1) / 2, avoid);
  return { kind, x: (gx + 0.5) * TILE_PX, y: (gy + 0.5) * TILE_PX, riseMs: 0 };
}

/**
 * The reward, **beside the player** when the room is cleared: the open cell
 * reachable from where they stand that is nearest to `REWARD_NEAR` away.
 * With the camera near, the room is larger than the screen, and a reward in
 * the middle of it was often off the view and had to be looked for.
 */
export function placeRewardNear(
  grid: Uint8Array, kind: RewardCardKind, near: { x: number; y: number }, avoid: Set<number> = new Set(),
): RewardDrop {
  const cell = nearCell(grid, near, REWARD_NEAR, [], avoid) ?? nearestOpen(grid, Math.floor(near.x / TILE_PX), Math.floor(near.y / TILE_PX), avoid);
  return { kind, x: (cell[0] + 0.5) * TILE_PX, y: (cell[1] + 0.5) * TILE_PX, riseMs: 0 };
}

/** How far from the player the reward rises. */
const REWARD_NEAR = TILE_PX * 2.5;

/** Cells the player can walk to from where they stand. */
function reachableFrom(grid: Uint8Array, from: { x: number; y: number }): Set<number> {
  const start = Math.floor(from.y / TILE_PX) * GRID_W + Math.floor(from.x / TILE_PX);
  const seen = new Set<number>([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i]!;
    const x = k % GRID_W, y = (k / GRID_W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      const n = ny * GRID_W + nx;
      if (seen.has(n) || grid[n] !== Tile.Floor) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

/**
 * An open cell, with floor all round, reachable from `near`, whose distance
 * from it is as close to `want` as can be (or inside `want` when it is a
 * range, nearest its middle), at least `apart` from each point in `others`.
 */
function nearCell(
  grid: Uint8Array, near: { x: number; y: number }, want: number | readonly [number, number],
  others: readonly { x: number; y: number; apart: number }[], avoid: Set<number>,
  /** When given, the cell nearest this point instead. */
  toward?: { x: number; y: number },
): [number, number] | null {
  const reach = reachableFrom(grid, near);
  const [lo, hi] = typeof want === "number" ? [want, want] : want;
  const mid = (lo + hi) / 2;
  let best: [number, number] | null = null;
  let bestCost = Infinity;
  for (const k of reach) {
    const gx = k % GRID_W, gy = (k / GRID_W) | 0;
    if (avoid.has(k) || !open(grid, gx, gy)) continue;
    if (!open(grid, gx - 1, gy) || !open(grid, gx + 1, gy) || !open(grid, gx, gy - 1) || !open(grid, gx, gy + 1)) continue;
    const cx = (gx + 0.5) * TILE_PX, cy = (gy + 0.5) * TILE_PX;
    if (others.some((o) => Math.hypot(o.x - cx, o.y - cy) < o.apart)) continue;
    const d = Math.hypot(cx - near.x, cy - near.y);
    const cost = toward ? Math.hypot(cx - toward.x, cy - toward.y)
      : d < lo ? (lo - d) * 3 : d > hi ? d - hi : Math.abs(d - mid) * 0.1;
    if (cost < bestCost) { bestCost = cost; best = [gx, gy]; }
  }
  return best;
}

/**
 * The portals, made **when the way out opens, in front of the player**: a row
 * across their facing three tiles ahead, each on the reachable open cell
 * nearest its place, clear of the others and of the reward. With the room
 * larger than the view, portals scattered across it at its start — on the
 * rule that the goal belongs across the threat — were ones the player had to
 * go and look for once the fight was over; and made then, there is nothing
 * to hide during it.
 */
export function portalsBefore(
  grid: Uint8Array, ext: Extent, specs: readonly PortalSpec[], player: { x: number; y: number; facing: number },
  keepClear: readonly { x: number; y: number }[] = [], avoid: Set<number> = new Set(),
  viewHalf?: { x: number; y: number },
): Portal[] {
  // A straight row in view, when the floor there has one.
  const row = viewHalf ? portalRow(grid, ext, specs.length, player, keepClear, avoid, viewHalf) : null;
  if (row) return specs.map((spec, i) => makePortal(spec, (row[i]![0] + 0.5) * TILE_PX, (row[i]![1] + 0.5) * TILE_PX));
  const out: Portal[] = [];
  const taken: { x: number; y: number; apart: number }[] = keepClear.map((c) => ({ ...c, apart: TILE_PX * 2 }));
  const ax = Math.cos(player.facing), ay = Math.sin(player.facing);
  const wants = specs.map((_, i) => {
    const across = (i - (specs.length - 1) / 2) * PORTAL_ROW_GAP;
    return { x: player.x + ax * PORTAL_AHEAD - ay * across, y: player.y + ay * PORTAL_AHEAD + ax * across };
  });
  // The row slides as a whole to fit inside the room, rather than one end of
  // it being pushed back onto the player by a wall.
  const fit = (vals: number[], lo: number, hi: number) => {
    const a = Math.min(...vals), b = Math.max(...vals);
    return b - a > hi - lo ? (lo + hi) / 2 - (a + b) / 2 : a < lo ? lo - a : b > hi ? hi - b : 0;
  };
  const sx = fit(wants.map((w) => w.x), TILE_PX * 2.5, (ext.w - 2.5) * TILE_PX);
  const sy = fit(wants.map((w) => w.y), TILE_PX * 2.5, (ext.h - 2.5) * TILE_PX);
  specs.forEach((spec, i) => {
    const want = { x: wants[i]!.x + sx, y: wants[i]!.y + sy };
    const used = new Set([...avoid, ...out.map((p) => Math.floor(p.y / TILE_PX) * GRID_W + Math.floor(p.x / TILE_PX))]);
    const cell = nearCell(grid, player, [0, Infinity], taken, avoid, want)
      ?? nearestOpen(grid, Math.floor(want.x / TILE_PX), Math.floor(want.y / TILE_PX), used);
    const x = (cell[0] + 0.5) * TILE_PX, y = (cell[1] + 0.5) * TILE_PX;
    taken.push({ x, y, apart: PORTAL_MIN_SEPARATION });
    out.push(makePortal(spec, x, y));
  });
  return out;
}

/**
 * The portals' cells as **one straight row in view**: across the room's grid,
 * level or upright, `PORTAL_ROW_CELLS` apart, every cell reachable open
 * floor with open floor round it, out of the hazards and clear of what must
 * be kept clear, and all of it inside the view the camera frames the player
 * in, a tile and a half in from its edges. The row nearest the spot three
 * tiles ahead of the player wins, one across their facing before one along
 * it. Null when the view holds no such row.
 */
function portalRow(
  grid: Uint8Array, ext: Extent, n: number, player: { x: number; y: number; facing: number },
  keepClear: readonly { x: number; y: number }[], avoid: Set<number>, half: { x: number; y: number },
): [number, number][] | null {
  if (n === 0) return [];
  const roomW = ext.w * TILE_PX, roomH = ext.h * TILE_PX;
  const cx = half.x * 2 >= roomW ? roomW / 2 : Math.max(half.x, Math.min(roomW - half.x, player.x));
  const cy = half.y * 2 >= roomH ? roomH / 2 : Math.max(half.y, Math.min(roomH - half.y, player.y));
  const inset = TILE_PX * 1.5;
  const inView = (gx: number, gy: number) => {
    const x = (gx + 0.5) * TILE_PX, y = (gy + 0.5) * TILE_PX;
    return Math.abs(x - cx) <= half.x - inset && Math.abs(y - cy) <= half.y - inset;
  };
  const reach = reachableFrom(grid, player);
  const good = (gx: number, gy: number) => {
    const k = gy * GRID_W + gx;
    if (!reach.has(k) || avoid.has(k) || !inView(gx, gy)) return false;
    if (!open(grid, gx, gy) || !open(grid, gx - 1, gy) || !open(grid, gx + 1, gy) || !open(grid, gx, gy - 1) || !open(grid, gx, gy + 1)) return false;
    const x = (gx + 0.5) * TILE_PX, y = (gy + 0.5) * TILE_PX;
    if (Math.hypot(x - player.x, y - player.y) < TILE_PX * 1.5) return false;
    return !keepClear.some((c) => Math.hypot(c.x - x, c.y - y) < TILE_PX * 2);
  };
  const ax = Math.cos(player.facing), ay = Math.sin(player.facing);
  const want = { x: player.x + ax * PORTAL_AHEAD, y: player.y + ay * PORTAL_AHEAD };
  // Across the facing: a level row when facing up or down, upright when facing sideways.
  const across: "level" | "upright" = Math.abs(ay) >= Math.abs(ax) ? "level" : "upright";
  let best: [number, number][] | null = null;
  let bestCost = Infinity;
  for (const dir of ["level", "upright"] as const) {
    const [dx, dy] = dir === "level" ? [PORTAL_ROW_CELLS, 0] : [0, PORTAL_ROW_CELLS];
    for (let gy = 1; gy < ext.h - 1; gy++)
      for (let gx = 1; gx < ext.w - 1; gx++) {
        const cells: [number, number][] = [];
        for (let i = 0; i < n; i++) cells.push([gx + dx * i, gy + dy * i]);
        if (!cells.every(([x, y]) => good(x, y))) continue;
        const mx = cells.reduce((s, c) => s + c[0] + 0.5, 0) / n * TILE_PX;
        const my = cells.reduce((s, c) => s + c[1] + 0.5, 0) / n * TILE_PX;
        const cost = Math.hypot(mx - want.x, my - want.y) + (dir === across ? 0 : TILE_PX * 2);
        if (cost < bestCost) { bestCost = cost; best = cells; }
      }
  }
  return best;
}

/** Cells between neighbouring portals in a row: clear of each other's entering reach. */
const PORTAL_ROW_CELLS = 3;

/** How far ahead of the player the row of portals stands, and how far apart they are in it. */
const PORTAL_AHEAD = TILE_PX * 3;
const PORTAL_ROW_GAP = TILE_PX * 2.4;

export function stepReward(drop: RewardDrop | null, dtMs: number): void {
  if (drop) drop.riseMs += dtMs;
}

/**
 * Whether the player is standing close enough to open the offer.
 *
 * Gated on the rise finishing, so the prompt cannot appear before the thing it
 * points at has arrived.
 */
export function rewardInReach(
  drop: RewardDrop | null, player: { x: number; y: number },
): boolean {
  if (!drop || drop.riseMs < REWARD_RISE_MS) return false;
  return Math.hypot(drop.x - player.x, drop.y - player.y) <= REWARD_REACH;
}

function open(grid: Uint8Array, gx: number, gy: number): boolean {
  return gx >= 1 && gy >= 1 && gx < GRID_W - 1 && gy < GRID_H - 1
    && grid[gy * GRID_W + gx] === Tile.Floor;
}

export interface PortalSpec {
  readonly reward: RewardCardKind;
  readonly elite: boolean;
  readonly type: RoomType;
  /** A spell door's school, a stat door's family; see `DoorOffer`. */
  readonly school?: string;
  readonly family?: string;
  /** The reward's grade, 1 to 3: a spell's level, an affix's tier, a stat or gold multiple. */
  readonly grade?: number;
  readonly npc?: "merchant" | "smith" | "fountain";
  /**
   * The boss door at the vendors' stop. It promises no currency — what is
   * behind it is the end of the run — so the badge says the boss rather than
   * naming a reward the room will never hand out (`bossExit`).
   */
  readonly boss?: boolean;
  /** No reward behind it, only the room ahead; see `PortalSpec.onward`. */
  readonly onward?: boolean;
}

function makePortal(spec: PortalSpec, x: number, y: number): Portal {
  return {
    reward: spec.reward,
    elite: spec.elite,
    type: spec.type,
    ...(spec.boss ? { boss: true } : {}),
    ...(spec.onward ? { onward: true } : {}),
    ...(spec.school ? { school: spec.school } : {}),
    ...(spec.family ? { family: spec.family } : {}),
    grade: spec.grade ?? 1,
    ...(spec.npc ? { npc: spec.npc } : {}),
    x, y,
    open: false,
    riseMs: 0,
  };
}

/**
 * The closest two portals may stand.
 *
 * Twice the interact radius plus a tile, so the circles have real air between
 * them: at exactly twice they touch, and touching is where the game would have
 * to guess which one a press meant.
 */
const PORTAL_MIN_SEPARATION = PORTAL_ENTER_RADIUS * 2 + TILE_PX;

/** The nearest open cell to a wanted one, searched outward in rings. */
function nearestOpen(
  grid: Uint8Array, gx: number, gy: number, avoid: Set<number> = new Set(),
): [number, number] {
  const ok = (x: number, y: number): boolean =>
    open(grid, x, y) && !avoid.has(y * GRID_W + x);
  if (ok(gx, gy)) return [gx, gy];
  for (let r = 1; r <= Math.max(GRID_W, GRID_H); r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (ok(gx + dx, gy + dy)) return [gx + dx, gy + dy];
      }
  return [gx, gy];
}

/** Raises every portal. Called once, when the offer is answered. */
export function raisePortals(portals: Portal[]): void {
  for (const p of portals) {
    if (p.open) continue;
    p.open = true;
    p.riseMs = 0;
  }
}

export function stepPortals(portals: Portal[], dtMs: number): void {
  for (const p of portals) if (p.open) p.riseMs += dtMs;
}

/**
 * The open portal the player is standing by, or null. Drives the prompt.
 *
 * The **nearest** one, not the first in range, so the prompt is also the
 * answer to "which one will the key take" — the question a player standing
 * between two of them actually has.
 *
 * Gated on the rise finishing, so a portal the player happens to be standing
 * on when it comes up is not usable before they have seen it.
 */
export function portalInReach(
  portals: readonly Portal[], player: { x: number; y: number },
): Portal | null {
  let best: Portal | null = null;
  let bestD = PORTAL_ENTER_RADIUS;
  for (const p of portals) {
    if (!p.open || p.riseMs < PORTAL_RISE_MS) continue;
    const d = Math.hypot(p.x - player.x, p.y - player.y);
    if (d > bestD) continue;
    bestD = d;
    best = p;
  }
  return best;
}

/** The portal the player chose to step through, on a press. */
export function enteredPortal(
  portals: readonly Portal[], player: { x: number; y: number }, interact = false,
): Portal | null {
  return interact ? portalInReach(portals, player) : null;
}
