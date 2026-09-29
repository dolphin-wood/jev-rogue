/**
 * **What a room's balance is read from** (doc 011), for both playtest
 * logs: the browser's recorder and the harness's run write it the same way
 * because both call this, one step at a time.
 *
 * The build the room is fought with, health in and out, kill times by
 * archetype and the statuses that took hold — a few numbers a room, never an
 * event list, so a long session costs nothing. The damage and cast tallies
 * are the world's own (`WorldStats.dealtBy`, `castsBy`, `manaBy`).
 */
import type { World } from "./types.ts";
import { noMods } from "./types.ts";
import { MAX_HEARTS } from "../run/summarize.ts";

/** A heart is ten HP, as the HUD draws it and as a person reports it. */
const HP_PER_HEART = 10;

export interface RoomBalance {
  /** Each key's spell, level and affixes, and every stat that moved off its base. */
  build: { spells: { key: number; id: string; level: number; affixes: string[] }[]; mods: Record<string, number> };
  /** Health at the room's start and end, and the most it could be, in HP. */
  hp: { start: number; end: number; max: number };
  /** Damage dealt by what dealt it: `spell:<id>`, `sword`, `affix:<id>`, `dot:burn`, `ground:fire`, … */
  dealtBy: Record<string, number>;
  /** Presses that cast, and the mana they spent, by spell id. */
  castsBy: Record<string, number>;
  manaBy: Record<string, number>;
  /** Bodies killed by archetype (an elite as `<archetype>*`): how many, and ms from first seen to dead. */
  killTime: Record<string, { n: number; totalMs: number; maxMs: number }>;
  /** Burns, poisons and freezes that took hold on a body, and frozen bodies shattered. */
  statuses: { burn: number; poison: number; freeze: number; shatter: number };
}

const rounded = (m: Readonly<Record<string, number>>): Record<string, number> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 10) / 10]));

/** One room's watch: `sample` after every step, `result` when the room closes. */
export class RoomWatch {
  private ms = 0;
  private build: RoomBalance["build"] | null = null;
  private hp: RoomBalance["hp"] | null = null;
  private stats: World["stats"] | null = null;
  private readonly killTime: RoomBalance["killTime"] = {};
  private readonly statuses: RoomBalance["statuses"] = { burn: 0, poison: 0, freeze: 0, shatter: 0 };
  /** The room's bodies as last seen: one entry a body, dropped with the watch. */
  private readonly bodies = new Map<number, { key: string; seenMs: number; dead: boolean; burn: boolean; poison: boolean; frozen: boolean }>();

  sample(w: World, dtMs: number): void {
    const p = w.player;
    this.build ??= buildOf(w);
    const max = (MAX_HEARTS + p.mods.maxHearts) * HP_PER_HEART;
    this.hp ??= { start: Math.round(p.hearts * HP_PER_HEART), end: 0, max };
    this.hp.end = Math.round(Math.max(0, p.hearts) * HP_PER_HEART);
    this.hp.max = max;
    this.stats = w.stats;
    for (const ev of w.events) if (ev.kind === "hazard_tick" && ev.what === "shatter") this.statuses.shatter++;
    // A body that died inside the step — its own burn's tick — is off the list before this sees it at nothing.
    const here = new Set(w.enemies.map((e) => e.id));
    for (const [id, seen] of this.bodies) if (!seen.dead && !here.has(id)) this.killed(seen);
    for (const e of w.enemies) {
      if (e.spawnFadeMs > 0) continue;
      let seen = this.bodies.get(e.id);
      if (!seen) {
        seen = { key: e.affixes.length > 0 ? `${e.archetype}*` : e.archetype, seenMs: this.ms, dead: false, burn: false, poison: false, frozen: false };
        this.bodies.set(e.id, seen);
      }
      if (seen.dead) continue;
      const burn = e.burnMs > 0, poison = e.poisonMs > 0, frozen = e.frozenMs > 0;
      if (burn && !seen.burn) this.statuses.burn++;
      if (poison && !seen.poison) this.statuses.poison++;
      if (frozen && !seen.frozen) this.statuses.freeze++;
      seen.burn = burn; seen.poison = poison; seen.frozen = frozen;
      if (e.hp <= 0) this.killed(seen);
    }
    this.ms += dtMs;
  }

  /** The room's record, or null for a room no step was watched in. */
  result(): RoomBalance | null {
    if (!this.build || !this.hp) return null;
    return {
      build: this.build, hp: this.hp,
      dealtBy: rounded(this.stats?.dealtBy ?? {}), castsBy: { ...(this.stats?.castsBy ?? {}) }, manaBy: rounded(this.stats?.manaBy ?? {}),
      killTime: this.killTime, statuses: this.statuses,
    };
  }

  private killed(seen: { key: string; seenMs: number; dead: boolean }): void {
    seen.dead = true;
    const k = (this.killTime[seen.key] ??= { n: 0, totalMs: 0, maxMs: 0 });
    const ms = Math.round(this.ms - seen.seenMs);
    k.n++; k.totalMs += ms; k.maxMs = Math.max(k.maxMs, ms);
  }
}

/** The build a room is fought with: keys, levels, affixes, and the stats that moved off their base. */
function buildOf(w: World): RoomBalance["build"] {
  const spells = w.spells.flatMap((s, key) => (s ? [{ key, id: s.item.base, level: s.level ?? 1, affixes: s.affixes.map((a) => a.id) }] : []));
  const base = noMods() as unknown as Record<string, number>;
  const now = w.player.mods as unknown as Record<string, number>;
  const mods: Record<string, number> = {};
  for (const [k, v] of Object.entries(now)) if (typeof v === "number" && v !== base[k]) mods[k] = Math.round(v * 100) / 100;
  return { spells, mods };
}
