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
import type { RoomType } from "../types.ts";
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
  /** The same line in parts, each with the kind of thing it says, for colouring. */
  readonly statParts?: readonly { readonly text: string; readonly tone: string }[];
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
  readonly npc?: "merchant" | "smith";
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
  grid: Uint8Array, kind: RewardCardKind, avoid: Set<number> = new Set(),
): RewardDrop {
  const [gx, gy] = nearestOpen(grid, Math.round(GRID_W / 2), Math.round(GRID_H / 2), avoid);
  return { kind, x: (gx + 0.5) * TILE_PX, y: (gy + 0.5) * TILE_PX, riseMs: 0 };
}

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

/**
 * Scatters one portal per offered room type across the open floor.
 *
 * Scattered rather than in a row, which is the second time this has changed
 * and the reasoning is worth keeping. A row is the better shape for comparing
 * three options *when comparing them is the work* — and it is not, any more:
 * the offer screen carries the build decision, and a portal's badge says only
 * which kind of room is behind it. Three badges do not need to be side by side
 * to be read, and putting them on a row meant the room's geometry had to
 * guarantee a clear span, which turned a two-line placement into a constraint
 * on the level generator.
 *
 * Scattering also buys back what the row gave up: the level-design rule that
 * the goal belongs on the far side of the threat, and a reason for the player
 * to cross the room they just fought in.
 *
 * Placement is maximum spread subject to hard minimums — reachable floor with
 * floor all round it, clear of the entry, and far enough from each other that
 * two interact circles cannot overlap, because a press must never be
 * ambiguous.
 */
export interface PortalSpec {
  readonly reward: RewardCardKind;
  readonly elite: boolean;
  readonly type: RoomType;
  /** A spell door's school, a stat door's family; see `DoorOffer`. */
  readonly school?: string;
  readonly family?: string;
  /** The reward's grade, 1 to 3: a spell's level, an affix's tier, a stat or gold multiple. */
  readonly grade?: number;
  readonly npc?: "merchant" | "smith";
}

export function placePortals(
  grid: Uint8Array,
  specs: readonly PortalSpec[],
  entry: { x: number; y: number },
  spawns: readonly { x: number; y: number }[],
  rng: Rng,
): Portal[] {
  const candidates: [number, number][] = [];
  for (let gy = 1; gy < GRID_H - 1; gy++)
    for (let gx = 1; gx < GRID_W - 1; gx++) {
      if (!open(grid, gx, gy)) continue;
      // Floor all round, so a portal is never the plug in a gap the generator
      // sized deliberately and is always approachable from a turn.
      if (!open(grid, gx - 1, gy) || !open(grid, gx + 1, gy)) continue;
      if (!open(grid, gx, gy - 1) || !open(grid, gx, gy + 1)) continue;
      candidates.push([gx, gy]);
    }

  const placed: Portal[] = [];
  const keepAway = [
    // Not on the doorstep: a badge over the player's head on arrival, and an
    // exit they reach before the room has happened.
    { x: entry.x, y: entry.y, min: TILE_PX * 4 },
    ...spawns.map((s) => ({ x: s.x, y: s.y, min: TILE_PX * 1.5 })),
  ];

  for (const spec of specs) {
    let best: [number, number] | null = null;
    let bestScore = -1;
    for (const [gx, gy] of candidates) {
      const cx = (gx + 0.5) * TILE_PX;
      const cy = (gy + 0.5) * TILE_PX;
      let worst = Infinity;
      let legal = true;
      for (const a of keepAway) {
        const d = Math.hypot(a.x - cx, a.y - cy);
        if (d < a.min) { legal = false; break; }
        worst = Math.min(worst, d - a.min);
      }
      if (!legal) continue;
      for (const p of placed) {
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d < PORTAL_MIN_SEPARATION) { legal = false; break; }
        worst = Math.min(worst, d - PORTAL_MIN_SEPARATION);
      }
      if (!legal) continue;
      // A stable tiebreak, so two equally good cells do not depend on scan
      // order — which would make the layout shift under an unrelated edit.
      const score = worst + rng.next() * TILE_PX * 0.5;
      if (score > bestScore) { bestScore = score; best = [gx, gy]; }
    }

    if (!best) {
      /*
       * Nothing legal left. Falls back to the nearest open cell to the corner
       * furthest from the entry, which is at least not on top of anything.
       *
       * This matters more than it looks: a room that produced fewer portals
       * than types offered would silently drop a door the Director chose, and
       * a room that produced none would end the run.
       */
      const fx = entry.x < (GRID_W * TILE_PX) / 2 ? GRID_W - 2 : 1;
      const fy = entry.y < (GRID_H * TILE_PX) / 2 ? GRID_H - 2 : 1;
      const taken = new Set(placed.map(
        (p) => Math.floor(p.y / TILE_PX) * GRID_W + Math.floor(p.x / TILE_PX),
      ));
      best = nearestOpen(grid, fx, fy, taken);
    }

    placed.push({
      reward: spec.reward,
      elite: spec.elite,
      type: spec.type,
      ...(spec.school ? { school: spec.school } : {}),
      ...(spec.family ? { family: spec.family } : {}),
      grade: spec.grade ?? 1,
      ...(spec.npc ? { npc: spec.npc } : {}),
      x: (best[0] + 0.5) * TILE_PX,
      y: (best[1] + 0.5) * TILE_PX,
      open: false,
      riseMs: 0,
    });
  }
  return placed;
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
