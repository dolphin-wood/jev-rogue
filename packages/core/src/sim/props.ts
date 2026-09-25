/**
 * Destructibles: pots, crates and urns that block until they are broken.
 *
 * These are the one piece of scenery the player can change, and for a melee
 * game that matters more than it sounds. Doc 015's finding was that melee does
 * **not** want mazing — the detour ratio has to stay near 1.1 to 1.3, so a room
 * cannot be made interesting by adding walls. What it can have is cover that
 * the player edits: a crate is a sight-line while it stands and a lane once it
 * is gone, and which of those it is, is the player's decision.
 *
 * ### They occupy grid cells
 *
 * A prop writes `Tile.Prop` into the world's own copy of the grid, which means
 * blocking movement, stopping bullets, breaking line of sight and diverting the
 * flow field all come for free from logic that already exists. Breaking one
 * writes `Tile.Floor` back, and the flow field is invalidated so enemies
 * immediately path through the gap that just opened.
 *
 * The alternative — a separate occupancy list consulted by every collision
 * site — would mean touching `isSolid`, `circleHitsWall`, the flow field,
 * both bullet integrators and the sight test, and any one of them missed is a
 * prop that half exists.
 *
 * ### Breaking pays mana
 *
 * Not gold, and not health. Mana is the resource the spell economy is starved
 * of by design — the sword is the supply and spells are the sink — so paying
 * mana for a broken pot makes scenery part of that loop rather than a
 * decoration with a reward stapled to it. It is also the reward that costs no
 * new art, which is why it is this and not a dropped pickup.
 */
import { TILE_PX, Tile, GRID_W, GRID_H } from "../types.ts";
import type { FixtureKind, ConjuredKind } from "../types.ts";
import { feature } from "../rooms/features.ts";
import type { Rng } from "../rng.ts";

/**
 * The three breakable kinds, which differ in silhouette because they differ in
 * footprint, and the two **fixtures** a zone feature stands: a brazier and a
 * mana font. Fixtures are props because a prop is already everything a
 * standing feature needs to be — a solid cell, a bullet stop, a break in the
 * sight line, a hole in the flow field — and the alternative was a feature
 * drawn as an object that bodies and bullets passed straight through, which
 * is what both were.
 */
/** The throne hall's standing stone and iron (`RoomPlan.standing`, doc 020): cover that wears away. */
export type HallKind = "column" | "candelabrum";
export type PropKind = "pot" | "crate" | "urn" | FixtureKind | ConjuredKind | HallKind;

/** The kinds the room scatters at random. Fixtures are placed by their zone. */
export const PROP_KINDS: readonly PropKind[] = ["pot", "crate", "urn"];

/** Every prop can be broken. */
export function breakable(p: Pick<Destructible, "kind">): boolean {
  void p;
  return true;
}

/**
 * Hit points. **The sword does 9, and every kind breaks in one swing.**
 *
 * They were one, two and three swings, on the reasoning that an urn should be
 * "a decision about where the swing went". In play it is not a decision, it is
 * a refusal: a swing costs its recovery window and the player is being shot at
 * while they take it, so three swings on a static object is never the right
 * trade and the urn became a wall with a drawing on it. Content the player
 * learns to ignore is worse than content that is cheap.
 *
 * So the melee cost is flattened to one swing for all three, which is also the
 * shape the rest of the game has settled into — this is a melee game with
 * spells, and the sword should be the thing that is unambiguously good at
 * hitting what is in front of it.
 *
 * The three kinds still differ, in what it costs to break them **at range**,
 * where the sword is not available: the starter bolt does 8, so it takes a pot
 * and a crate in one and an urn in two, and a 3-damage spray pellet takes only
 * a pot. That is a gradient the player meets while kiting, which is when the
 * choice is real, rather than one they meet mid-melee, when it never was.
 */
/*
 * The brazier is cover the player can spend — doc 004: "blocks bullets both
 * ways and breaks when shot enough" — so it is dearer than an urn: two swings,
 * or two starter bolts. The font's figure is never read; see `breakable`.
 */
const PROP_HP: Readonly<Record<PropKind, number>> = {
  pot: 3, crate: 7, urn: 9, brazier: 16,
  // The conjured pillar: enemy fire wears it down, and it goes on its own
  // clock regardless. Dear enough that a shooter takes several volleys to
  // clear it, cheap enough that a tank's charge removes it in one.
  pillar: 24,
  /*
   * The throne hall's columns take four of the player's swings, and two of
   * the king's (`BOSS_PROP_DAMAGE`): cover the fight wears away, a chip at a
   * time, until the hall is open. A candelabrum goes in one.
   */
  column: 36, candelabrum: 9,
};

/** Mana returned on break, as a share of the cap — the same currency as a hit. */
export const PROP_MANA_FRACTION = 0.12;

/** How long the shards stay before the cell is purely floor again. */
export const PROP_BROKEN_MS = 100_000;

/** Below this share of its health a prop is drawn cracked. */
export const PROP_CRACKED_AT = 0.5;

export interface Destructible {
  readonly kind: PropKind;
  /** Grid cell, which is what makes it solid. */
  readonly gx: number;
  readonly gy: number;
  /** Centre in world px, for drawing and for hit tests. */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  hp: number;
  readonly maxHp: number;
  /** Counts down after breaking, for the shard pile. */
  brokenMs: number;
  hitFlashMs: number;
  /** A conjured prop's remaining life; 0 for one that stands until broken. */
  lifeMs?: number;
}

/**
 * Raises a conjured solid on the free floor cell nearest `x, y`.
 *
 * The same rule as every other prop: it writes `Tile.Prop` into the grid and
 * may not be the only way between two parts of the floor. It also may not
 * stand on a body, because a pillar raised inside a rusher would trap it in
 * masonry. Returns null when nowhere within two tiles qualifies.
 */
export function raisePillar(
  grid: Uint8Array,
  x: number, y: number,
  bodies: readonly { x: number; y: number; radius: number }[],
  lifeMs: number,
): Destructible | null {
  const cx = Math.floor(x / TILE_PX);
  const cy = Math.floor(y / TILE_PX);
  const reachable = floorReach(grid);
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      if (gx < 1 || gy < 1 || gx >= GRID_W - 1 || gy >= GRID_H - 1) continue;
      if (grid[gy * GRID_W + gx] !== Tile.Floor) continue;
      const px = (gx + 0.5) * TILE_PX;
      const py = (gy + 0.5) * TILE_PX;
      if (bodies.some((b) => Math.hypot(b.x - px, b.y - py) < b.radius + TILE_PX * 0.55)) continue;
      const d = Math.hypot(px - x, py - y);
      if (d >= bestD) continue;
      grid[gy * GRID_W + gx] = Tile.Prop;
      const ok = floorReach(grid) === reachable - 1;
      grid[gy * GRID_W + gx] = Tile.Floor;
      if (!ok) continue;
      bestD = d;
      best = [gx, gy];
    }
  if (!best) return null;
  const [gx, gy] = best;
  grid[gy * GRID_W + gx] = Tile.Prop;
  const hp = PROP_HP.pillar;
  return {
    kind: "pillar", gx, gy,
    x: (gx + 0.5) * TILE_PX, y: (gy + 0.5) * TILE_PX,
    radius: TILE_PX * 0.45,
    hp, maxHp: hp, brokenMs: 0, hitFlashMs: 0, lifeMs,
  };
}

export function propState(p: Destructible): "intact" | "cracked" | "broken" {
  if (p.hp <= 0) return "broken";
  return p.hp / p.maxHp <= PROP_CRACKED_AT ? "cracked" : "intact";
}

/**
 * Places destructibles on floor cells, writing them into `grid`.
 *
 * Deliberately conservative about where. A prop in a doorway is a door that
 * has to be broken, a prop on a spawn point buries an enemy inside solid
 * terrain, and a prop against the entry is an obstacle before the player has
 * seen the room. None of those are interesting and all of them read as bugs,
 * so the eligible set is interior floor with floor on every side.
 */
export function placeProps(
  grid: Uint8Array,
  rng: Rng,
  avoid: readonly { x: number; y: number }[],
  count: number,
  /** Cells (`y * GRID_W + x`) no prop may stand on. */
  blocked: ReadonlySet<number> = new Set(),
): Destructible[] {
  const open = (gx: number, gy: number): boolean =>
    gx >= 1 && gy >= 1 && gx < GRID_W - 1 && gy < GRID_H - 1
    && grid[gy * GRID_W + gx] === Tile.Floor;

  const eligible: [number, number][] = [];
  for (let gy = 1; gy < GRID_H - 1; gy++)
    for (let gx = 1; gx < GRID_W - 1; gx++) {
      if (!open(gx, gy) || blocked.has(gy * GRID_W + gx)) continue;
      // Floor all round, so breaking one never opens the only route and
      // standing one never plugs a gap the generator sized deliberately.
      if (!open(gx - 1, gy) || !open(gx + 1, gy) || !open(gx, gy - 1) || !open(gx, gy + 1)) continue;
      const cx = (gx + 0.5) * TILE_PX;
      const cy = (gy + 0.5) * TILE_PX;
      if (avoid.some((a) => Math.hypot(a.x - cx, a.y - cy) < TILE_PX * 2.5)) continue;
      eligible.push([gx, gy]);
    }

  /*
   * "Floor on every side" is not connectivity. A cell can have floor on all
   * four sides and still be the only way between two halves of a room — the
   * floor above it a dead-end pocket behind a pillar, the floor below the
   * same — and a crate there cut a cover ring in two. The reference player
   * cannot break what it cannot route to and stood for two minutes facing a
   * crate with seven enemies asleep behind it; a person would have smashed it,
   * but a room whose only door is a crate is still a bug. So a prop may only
   * stand where the floor stays one region without it.
   */
  const out: Destructible[] = [];
  let reachable = floorReach(grid);
  for (let i = 0; i < count && eligible.length > 0; i++) {
    const pick = Math.floor(rng.next() * eligible.length);
    const [gx, gy] = eligible[pick]!;
    // Swap-remove, and also drop the neighbours so props never form a wall.
    eligible.splice(pick, 1);
    for (let j = eligible.length - 1; j >= 0; j--) {
      const [ex, ey] = eligible[j]!;
      if (Math.abs(ex - gx) <= 1 && Math.abs(ey - gy) <= 1) eligible.splice(j, 1);
    }
    grid[gy * GRID_W + gx] = Tile.Prop;
    const after = floorReach(grid);
    if (after !== reachable - 1) {
      // A cut vertex: put the floor back and spend this pick on nothing.
      grid[gy * GRID_W + gx] = Tile.Floor;
      i--;
      continue;
    }
    reachable = after;
    const kind = PROP_KINDS[Math.floor(rng.next() * PROP_KINDS.length)]!;
    const hp = PROP_HP[kind];
    out.push({
      kind, gx, gy,
      x: (gx + 0.5) * TILE_PX,
      y: (gy + 0.5) * TILE_PX,
      radius: TILE_PX * 0.45,
      hp, maxHp: hp,
      brokenMs: 0,
      hitFlashMs: 0,
    });
  }
  return out;
}

/**
 * Ticks the props' own clocks.
 *
 * Nothing did, which meant `hitFlashMs` was set on a hit and never came down:
 * one swing at a crate turned it permanently into a white silhouette. A timer
 * with no owner is not a small bug when a renderer is watching it — it is a
 * piece of scenery that never goes back to normal.
 */
export function stepProps(props: readonly Destructible[], dtMs: number): void {
  for (const p of props) {
    if (p.hitFlashMs > 0) p.hitFlashMs -= dtMs;
    if (p.hp <= 0 && p.brokenMs > 0) p.brokenMs -= dtMs;
    if (p.lifeMs !== undefined && p.lifeMs > 0 && p.hp > 0) p.lifeMs -= dtMs;
  }
}

/** Conjured props whose time has run out this step, still standing. */
export function expiredProps(props: readonly Destructible[]): Destructible[] {
  return props.filter((p) => p.lifeMs !== undefined && p.lifeMs <= 0 && p.hp > 0);
}

/** Whether a circle overlaps this prop's footprint. */
export function propHit(p: Destructible, x: number, y: number, r: number): boolean {
  if (p.hp <= 0) return false;
  return Math.hypot(p.x - x, p.y - y) <= p.radius + r;
}

/**
 * Where a blocker feature stands its pillars within its zone.
 *
 * A zone slot is three by three, or a lane of five, or a shallow arc — and
 * stamping the object on every cell made a 5-cell lane a row of five identical
 * pillars, which is not a pillar, it is a fence. A pillar is a pillar: a
 * compact slot (no side longer than three) gets **one**, at its centre, and a
 * long slot gets **a pair at its two ends**, which reads as a gateway and
 * leaves the middle open. Both leave the zone walkable round and through.
 */
export function fixtureCells(cells: readonly (readonly [number, number])[]): [number, number][] {
  if (cells.length === 0) return [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of cells) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const nearest = (pick: readonly (readonly [number, number])[], tx: number, ty: number) =>
    [...pick].sort((a, b) => Math.hypot(a[0] - tx, a[1] - ty) - Math.hypot(b[0] - tx, b[1] - ty))[0]!;
  if (Math.max(w, h) <= 3) {
    const c = nearest(cells, cx, cy);
    return [[c[0], c[1]]];
  }
  const along = w >= h ? 0 : 1;
  const lo = Math.min(...cells.map((c) => c[along]));
  const hi = Math.max(...cells.map((c) => c[along]));
  const a = nearest(cells.filter((c) => c[along] === lo), cx, cy);
  const b = nearest(cells.filter((c) => c[along] === hi), cx, cy);
  return [[a[0], a[1]], [b[0], b[1]]];
}

/**
 * Stands the fixtures a room's zone features call for, writing them into
 * `grid` like any other prop. Called before the random props, so those keep
 * clear of them, and subject to the same rule: a pillar may not be the only
 * way between two parts of the floor.
 */
/** Stands a room's placed destructibles (`RoomPlan.standing`) on their cells, writing them into `grid`. */
export function placeStanding(
  grid: Uint8Array, standing: readonly { readonly kind: HallKind; readonly gx: number; readonly gy: number }[],
): Destructible[] {
  return standing.map(({ kind, gx, gy }) => {
    grid[gy * GRID_W + gx] = Tile.Prop;
    const hp = PROP_HP[kind];
    return {
      kind, gx, gy,
      x: (gx + 0.5) * TILE_PX, y: (gy + 0.5) * TILE_PX,
      radius: TILE_PX * 0.45,
      hp, maxHp: hp, brokenMs: 0, hitFlashMs: 0,
    };
  });
}

export function placeFixtures(
  grid: Uint8Array,
  zones: readonly { readonly cells: readonly (readonly [number, number])[]; readonly feature: string }[],
): Destructible[] {
  const out: Destructible[] = [];
  let reachable = floorReach(grid);
  for (const zone of zones) {
    // The feature library is the obstacle list; see `FixtureKind`.
    const kind = zone.feature === "none" ? null : feature(zone.feature).fixture ?? null;
    if (!kind) continue;
    const cells = fixtureCells(zone.cells);
    for (const [gx, gy] of cells) {
      if (grid[gy * GRID_W + gx] !== Tile.Floor) continue;
      grid[gy * GRID_W + gx] = Tile.Prop;
      const after = floorReach(grid);
      if (after !== reachable - 1) { grid[gy * GRID_W + gx] = Tile.Floor; continue; }
      reachable = after;
      const hp = PROP_HP[kind];
      out.push({
        kind, gx, gy,
        x: (gx + 0.5) * TILE_PX, y: (gy + 0.5) * TILE_PX,
        radius: TILE_PX * 0.45,
        hp, maxHp: hp, brokenMs: 0, hitFlashMs: 0,
      });
    }
  }
  return out;
}

/** Frees the cell a broken prop was holding. */
export function clearPropCell(grid: Uint8Array, p: Destructible): void {
  grid[p.gy * GRID_W + p.gx] = Tile.Floor;
}

/**
 * How many floor cells the first floor cell can walk to, four ways. Equal to
 * the floor count exactly when the floor is one region, which is the generator's
 * own guarantee and the one props must not break.
 */
function floorReach(grid: Uint8Array): number {
  let start = -1;
  for (let i = 0; i < grid.length; i++) if (grid[i] === Tile.Floor) { start = i; break; }
  if (start < 0) return 0;
  const seen = new Uint8Array(grid.length);
  const queue = [start];
  seen[start] = 1;
  let n = 0;
  while (queue.length > 0) {
    const c = queue.pop()!;
    n++;
    const cx = c % GRID_W;
    const cy = (c - cx) / GRID_W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      const ni = ny * GRID_W + nx;
      if (seen[ni] || grid[ni] !== Tile.Floor) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return n;
}
